export interface AudioFeatures {
  volume: number;        // 0-1
  bass: number;          // 0-1
  mid: number;           // 0-1
  treble: number;        // 0-1
  frequencies: Uint8Array;
  waveform: Uint8Array;
  pitch: number;         // estimated dominant frequency
  isSpeaking: boolean;
}

export class AudioAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private waveformData: Uint8Array = new Uint8Array(0);

  async start(): Promise<void> {
    this.context = new AudioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = this.context.createMediaStreamSource(this.stream);
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    source.connect(this.analyser);
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, frequencies: new Uint8Array(0), waveform: new Uint8Array(0), pitch: 0, isSpeaking: false };
    }

    this.analyser.getByteFrequencyData(this.frequencyData as any);
    this.analyser.getByteTimeDomainData(this.waveformData as any);

    const len = this.frequencyData.length;
    const bassEnd = Math.floor(len * 0.1);
    const midEnd = Math.floor(len * 0.4);

    let bassSum = 0, midSum = 0, trebleSum = 0, totalSum = 0;
    let maxVal = 0, maxIdx = 0;

    for (let i = 0; i < len; i++) {
      const v = this.frequencyData[i];
      totalSum += v;
      if (i < bassEnd) bassSum += v;
      else if (i < midEnd) midSum += v;
      else trebleSum += v;
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }

    const volume = totalSum / (len * 255);
    const bass = bassSum / (bassEnd * 255);
    const mid = midSum / ((midEnd - bassEnd) * 255);
    const treble = trebleSum / ((len - midEnd) * 255);
    const sampleRate = this.context?.sampleRate || 44100;
    const pitch = (maxIdx * sampleRate) / (this.analyser.fftSize);

    return {
      volume,
      bass: Math.min(1, bass * 2),
      mid: Math.min(1, mid * 3),
      treble: Math.min(1, treble * 4),
      frequencies: this.frequencyData,
      waveform: this.waveformData,
      pitch,
      isSpeaking: volume > 0.05,
    };
  }

  stop(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.context?.close();
    this.context = null;
    this.analyser = null;
    this.stream = null;
  }
}
