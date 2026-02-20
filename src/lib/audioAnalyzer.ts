export interface AudioFeatures {
  volume: number;
  bass: number;
  mid: number;
  treble: number;
  frequencies: Uint8Array;
  waveform: Uint8Array;
  pitch: number;
  isSpeaking: boolean;
  isSnap: boolean;
  spectralCentroid: number;
}

export class AudioAnalyzer {
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private frequencyData: Uint8Array = new Uint8Array(0);
  private waveformData: Uint8Array = new Uint8Array(0);
  private prevVolume = 0;
  private snapCooldown = 0;
  private volumeHistory: number[] = [];

  async start(): Promise<void> {
    this.context = new AudioContext();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      }
    });
    const source = this.context.createMediaStreamSource(this.stream);
    
    // Boost input significantly
    const gainNode = this.context.createGain();
    gainNode.gain.value = 4.0;
    source.connect(gainNode);
    
    this.analyser = this.context.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.5;
    this.analyser.minDecibels = -100;
    this.analyser.maxDecibels = -5;
    gainNode.connect(this.analyser);
    
    this.frequencyData = new Uint8Array(this.analyser.frequencyBinCount);
    this.waveformData = new Uint8Array(this.analyser.frequencyBinCount);
  }

  getFeatures(): AudioFeatures {
    if (!this.analyser) {
      return { volume: 0, bass: 0, mid: 0, treble: 0, frequencies: new Uint8Array(0), waveform: new Uint8Array(0), pitch: 0, isSpeaking: false, isSnap: false, spectralCentroid: 0 };
    }

    this.analyser.getByteFrequencyData(this.frequencyData as any);
    this.analyser.getByteTimeDomainData(this.waveformData as any);

    const len = this.frequencyData.length;
    const bassEnd = Math.floor(len * 0.1);
    const midEnd = Math.floor(len * 0.4);

    let bassSum = 0, midSum = 0, trebleSum = 0, totalSum = 0;
    let maxVal = 0, maxIdx = 0;
    let weightedSum = 0;

    for (let i = 0; i < len; i++) {
      const v = this.frequencyData[i];
      totalSum += v;
      weightedSum += v * i;
      if (i < bassEnd) bassSum += v;
      else if (i < midEnd) midSum += v;
      else trebleSum += v;
      if (v > maxVal) { maxVal = v; maxIdx = i; }
    }

    const rawVolume = totalSum / (len * 255);
    // Aggressively boost volume for sensitivity
    const volume = Math.min(1, rawVolume * 5);
    
    this.volumeHistory.push(volume);
    if (this.volumeHistory.length > 10) this.volumeHistory.shift();
    
    const bass = Math.min(1, (bassSum / (bassEnd * 255)) * 5);
    const mid = Math.min(1, (midSum / ((midEnd - bassEnd) * 255)) * 6);
    const treble = Math.min(1, (trebleSum / ((len - midEnd) * 255)) * 7);
    const sampleRate = this.context?.sampleRate || 44100;
    const pitch = (maxIdx * sampleRate) / (this.analyser.fftSize);
    const spectralCentroid = totalSum > 0 ? weightedSum / totalSum / len : 0;

    // Snap detection
    const volumeDelta = volume - this.prevVolume;
    this.prevVolume = volume;
    if (this.snapCooldown > 0) this.snapCooldown--;

    const isSnap = this.snapCooldown === 0 &&
      volumeDelta > 0.12 &&
      treble > bass * 1.2 &&
      spectralCentroid > 0.25 &&
      volume > 0.08;

    if (isSnap) this.snapCooldown = 15;

    return {
      volume,
      bass,
      mid,
      treble,
      frequencies: this.frequencyData,
      waveform: this.waveformData,
      pitch,
      isSpeaking: volume > 0.005,
      isSnap,
      spectralCentroid,
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
