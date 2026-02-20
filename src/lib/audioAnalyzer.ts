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
}

export class AudioAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private gainNode: GainNode | null = null;
  private stream: MediaStream | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private waveformData: Uint8Array = new Uint8Array(0);

  private prevVolume = 0;
  private prevPrevVolume = 0;
  private snapCooldown = 0;
  private volumeHistory: number[] = [];
  private onsetHistory: boolean[] = [];
  private volumeDeltaHistory: number[] = [];

  sensitivity = 1.0;
  threshold = 0.05;

  async start(): Promise<void> {
    this.context = new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true }
    });
    const source = this.context.createMediaStreamSource(this.stream);
    this.gainNode = this.context.createGain();
    this.gainNode.gain.value = this.sensitivity * 2;
    source.connect(this.gainNode);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -5;
    this.gainNode.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  setSensitivity(v: number) { this.sensitivity = v; if (this.gainNode) this.gainNode.gain.value = v * 2; }
  setThreshold(v: number) { this.threshold = v; }

  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, frequencies: new Uint8Array(0), waveform: new Uint8Array(0), pitch: 0, isSpeaking: false, soundType: 'silence', spectralCentroid: 0, spectralFlatness: 0 };
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

    // Spectral flatness: geometric mean / arithmetic mean (1 = noise, 0 = tonal)
    const arithmeticMean = totalSum / len;
    const geometricMean = nonZeroCount > 0 ? Math.exp(logSum / nonZeroCount) : 0;
    const spectralFlatness = arithmeticMean > 0 ? geometricMean / arithmeticMean : 0;

    // Volume dynamics
    const volumeDelta = volume - this.prevVolume;
    const isSuddenOnset = volumeDelta > 0.03;
    this.prevPrevVolume = this.prevVolume;
    this.prevVolume = volume;

    // Track histories
    this.volumeHistory.push(volume);
    if (this.volumeHistory.length > 30) this.volumeHistory.shift();
    this.volumeDeltaHistory.push(volumeDelta);
    if (this.volumeDeltaHistory.length > 30) this.volumeDeltaHistory.shift();
    this.onsetHistory.push(isSuddenOnset && volume > this.threshold);
    if (this.onsetHistory.length > 40) this.onsetHistory.shift();

    if (this.snapCooldown > 0) this.snapCooldown--;

    // Classify sound type
    const isSpeaking = volume > this.threshold;
    let soundType: SoundType = 'silence';

    if (isSpeaking) {
      soundType = this.classifySound(volume, volumeDelta, bass, mid, treble, spectralCentroid, spectralFlatness);
    }

    return {
      volume, bass, mid, treble,
      frequencies: this.frequencyData, waveform: this.waveformData,
      pitch, isSpeaking, soundType, spectralCentroid, spectralFlatness,
    };
  }

  private classifySound(
    volume: number, volumeDelta: number,
    bass: number, mid: number, treble: number,
    centroid: number, flatness: number
  ): SoundType {
    // Count recent onsets for laugh detection
    const recentOnsets = this.onsetHistory.slice(-25).filter(Boolean).length;
    
    // Check if volume just appeared from near-silence (transient detection)
    const wasQuiet = this.volumeHistory.length >= 3 && 
      this.volumeHistory[this.volumeHistory.length - 3] < this.threshold * 1.5;
    const isTransient = wasQuiet && volumeDelta > 0.04;

    // SNAP: sharp transient, tends to have more high-frequency energy
    // Relaxed: any sharp transient with treble presence
    if (this.snapCooldown === 0 && isTransient && treble > 0.05 && centroid > 0.25 && volume > this.threshold * 1.5) {
      // Distinguish from clap: snaps have narrower frequency spread (less flat)
      if (flatness < 0.35 || treble > mid * 1.2) {
        this.snapCooldown = 25;
        return 'snap';
      }
    }

    // CLAP: sudden broadband noise — more spectrally flat than snap
    if (this.snapCooldown === 0 && isTransient && flatness > 0.15 && volume > this.threshold * 1.5) {
      this.snapCooldown = 20;
      return 'clap';
    }

    // Also catch non-transient but sudden loud bursts as clap
    if (this.snapCooldown === 0 && volumeDelta > 0.06 && flatness > 0.2 && volume > this.threshold * 2) {
      this.snapCooldown = 20;
      return 'clap';
    }

    // LAUGH: multiple rapid volume oscillations
    if (recentOnsets >= 2 && centroid > 0.08) {
      // Check for oscillating pattern (up-down-up)
      const recent = this.volumeDeltaHistory.slice(-15);
      let oscillations = 0;
      for (let i = 1; i < recent.length; i++) {
        if (recent[i] * recent[i - 1] < 0) oscillations++;
      }
      if (oscillations >= 3) {
        return 'laugh';
      }
    }

    // VOICE: everything else that's sustained
    return 'voice';
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
    this.context = null;
    this.analyser = null;
    this.gainNode = null;
    this.stream = null;
  }
}
