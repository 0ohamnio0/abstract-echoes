import { YamnetClassifier } from './yamnetClassifier';

export type SoundType = 'voice' | 'snap' | 'clap' | 'laugh' | 'silence';

export interface AudioFeatures {
  volume: number;
  bass: number;
  mid: number;
  treble: number;
  frequencies: Uint8Array;
  waveform: Uint8Array;
  pitch: number;
  isSpeaking: boolean;
  soundType: SoundType;
  spectralCentroid: number;
  spectralFlatness: number;
  yamnetLabel: string;
  yamnetConfidence: number;
}

export class AudioAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private waveformData: Uint8Array = new Uint8Array(0);
  private scriptNode: ScriptProcessorNode | null = null;

  private prevVolume = 0;
  private prevPrevVolume = 0;

  // YAMNet classifier
  private yamnet = new YamnetClassifier();
  private yamnetSoundType: SoundType = 'silence';
  private yamnetRawLabel = '';
  private yamnetConfidence = 0;
  private classifyBuffer: Float32Array = new Float32Array(16000); // 1s at 16kHz
  private classifyOffset = 0;
  private classifySampleRate = 16000;

  sensitivity = 1.0;
  threshold = 0.05;

  async start(): Promise<void> {
    // Start YAMNet loading in parallel
    this.yamnet.init().then(() => {
      console.log('[AudioAnalyzer] YAMNet ready');
    });

    this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
    });
    const source = this.context.createMediaStreamSource(this.stream);

    // Gain node for volume boosting (used by frequency analysis)
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.sensitivity * 2;
    source.connect(this.gainNode);

    // Analyser for frequency/waveform data
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -5;
    this.gainNode.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.frequencyBinCount);

    // ScriptProcessor to capture raw audio for YAMNet (connected to raw source, not gain)
    this.scriptNode = this.context.createScriptProcessor(4096, 1, 1);
    this.classifySampleRate = this.context.sampleRate;
    // Resize buffer for ~1 second of audio at native sample rate
    const bufferSize = Math.ceil(this.classifySampleRate);
    this.classifyBuffer = new Float32Array(bufferSize);
    this.classifyOffset = 0;

    this.scriptNode.onaudioprocess = (e) => {
      if (!this.yamnet.isReady()) return;
      const input = e.inputBuffer.getChannelData(0);
      const remaining = this.classifyBuffer.length - this.classifyOffset;
      const toCopy = Math.min(input.length, remaining);
      this.classifyBuffer.set(input.subarray(0, toCopy), this.classifyOffset);
      this.classifyOffset += toCopy;

      if (this.classifyOffset >= this.classifyBuffer.length) {
        // Classify the accumulated buffer
        const result = this.yamnet.classify(this.classifyBuffer, this.classifySampleRate);
        this.yamnetSoundType = result.type;
        this.yamnetRawLabel = result.rawLabel;
        this.yamnetConfidence = result.confidence;
        this.classifyOffset = 0;
      }
    };

    source.connect(this.scriptNode);
    this.scriptNode.connect(this.context.destination); // Required for ScriptProcessor to work
  }

  setSensitivity(v: number) { this.sensitivity = v; if (this.gainNode) this.gainNode.gain.value = v * 2; }
  setThreshold(v: number) { this.threshold = v; }

  async resumeIfSuspended(): Promise<void> {
    if (this.context && this.context.state === 'suspended') {
      await this.context.resume();
    }
  }

  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, frequencies: new Uint8Array(0), waveform: new Uint8Array(0), pitch: 0, isSpeaking: false, soundType: 'silence', spectralCentroid: 0, spectralFlatness: 0, yamnetLabel: '', yamnetConfidence: 0 };
    }

    this.analyser.getByteFrequencyData(this.frequencyData as any);
    this.analyser.getByteTimeDomainData(this.waveformData as any);

    const len = this.frequencyData.length;
    const bassEnd = Math.floor(len * 0.1);
    const midEnd = Math.floor(len * 0.4);

    let bassSum = 0, midSum = 0, trebleSum = 0, totalSum = 0;
    let maxVal = 0, maxIdx = 0, weightedSum = 0;
    let logSum = 0, nonZeroCount = 0;

    for (let i = 0; i < len; i++) {
      const v = this.frequencyData[i];
      totalSum += v;
      weightedSum += v * i;
      if (i < bassEnd) bassSum += v;
      else if (i < midEnd) midSum += v;
      else trebleSum += v;
      if (v > maxVal) { maxVal = v; maxIdx = i; }
      if (v > 0) { logSum += Math.log(v); nonZeroCount++; }
    }

    const rawVolume = totalSum / (len * 255);
    const volume = Math.min(1, rawVolume * 3);
    const bass = Math.min(1, (bassSum / (bassEnd * 255)) * 4);
    const mid = Math.min(1, (midSum / ((midEnd - bassEnd) * 255)) * 5);
    const treble = Math.min(1, (trebleSum / ((len - midEnd) * 255)) * 6);
    const sampleRate = this.context?.sampleRate || 44100;
    const pitch = (maxIdx * sampleRate) / this.analyser.fftSize;
    const spectralCentroid = totalSum > 0 ? weightedSum / totalSum / len : 0;

    const arithmeticMean = totalSum / len;
    const geometricMean = nonZeroCount > 0 ? Math.exp(logSum / nonZeroCount) : 0;
    const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

    this.prevPrevVolume = this.prevVolume;
    this.prevVolume = volume;

    const isSpeaking = volume > this.threshold;

    // Use YAMNet classification if available, otherwise fallback to 'voice'
    let soundType: SoundType = 'silence';
    if (isSpeaking) {
      if (this.yamnet.isReady() && this.yamnetSoundType !== 'silence') {
        soundType = this.yamnetSoundType;
      } else {
        soundType = 'voice';
      }
    }

    return {
      volume, bass, mid, treble,
      frequencies: this.frequencyData, waveform: this.waveformData,
      pitch, isSpeaking, soundType, spectralCentroid, spectralFlatness,
      yamnetLabel: this.yamnetRawLabel,
      yamnetConfidence: this.yamnetConfidence,
    };
  }

  stop(): void {
    this.scriptNode?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
    this.yamnet.destroy();
    this.context = null;
    this.analyser = null;
    this.gainNode = null;
    this.scriptNode = null;
    this.stream = null;
  }
}
