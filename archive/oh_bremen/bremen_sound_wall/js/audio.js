export class AudioAnalyzer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        this.isReady = false;
    }

    async init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048; // Higher resolution for frequency analysis
            this.analyser.smoothingTimeConstant = 0.8; // Smooth out jitter
            
            this.source = this.audioContext.createMediaStreamSource(stream);
            this.source.connect(this.analyser);
            
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
            this.isReady = true;
            
            // Resume if suspended (browser policy)
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }
            
            console.log("Audio Initialized");
        } catch (e) {
            console.error("Audio Access Denied", e);
            alert("Microphone access is required for this experience.");
        }
    }

    getAudioData() {
        if (!this.isReady) return { amplitude: 0, frequency: 0, complexity: 0 };

        this.analyser.getByteFrequencyData(this.dataArray);

        // 1. Calculate Amplitude
        let sum = 0;
        let max = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            sum += this.dataArray[i];
            max = Math.max(max, this.dataArray[i]);
        }
        // Bolt Logic: Math.max(avg, max * 0.5)
        const amplitude = Math.max(sum / this.dataArray.length / 255, (max / 255) * 0.5);

        // 2. Estimate Pitch (Peak Index)
        let maxValue = 0;
        let maxIndex = 0;
        // Start from index 10 to ignore DC/hum
        for (let i = 10; i < this.dataArray.length; i++) {
            if (this.dataArray[i] > maxValue) {
                maxValue = this.dataArray[i];
                maxIndex = i;
            }
        }
        
        // Normalize Frequency
        // Bolt: maxIndex * sampleRate/2 / length / 8000
        const nyquist = this.audioContext.sampleRate / 2;
        const frequencyHz = maxIndex * (nyquist / this.dataArray.length);
        const frequency = maxValue < 30 ? 0 : Math.min(frequencyHz / 8000, 1);

        // 3. Complexity (Peak Count)
        let peakCount = 0;
        for (let i = 1; i < this.dataArray.length - 1; i++) {
            if (this.dataArray[i] > 100 && 
                this.dataArray[i] > this.dataArray[i - 1] && 
                this.dataArray[i] > this.dataArray[i + 1]) {
                peakCount++;
            }
        }
        const complexity = Math.min(peakCount / 20, 1);

        return {
            amplitude: amplitude,
            frequency: frequency, // 0-1
            complexity: complexity // 0-1
        };
    }
}
