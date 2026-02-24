// Real-time Korean speech recognition for trigger word detection
// Uses Web Speech API (SpeechRecognition)

export type TriggerWord = 'love' | 'hello' | 'happy' | 'wow';

export interface TriggerEvent {
  word: TriggerWord;
  transcript: string;
}

// Trigger word mapping: Korean phrases → event type
const TRIGGER_MAP: { pattern: RegExp; word: TriggerWord }[] = [
  { pattern: /사랑해|사랑|좋아해|좋아/, word: 'love' },
  { pattern: /안녕|하이|헬로|반가/, word: 'hello' },
  { pattern: /행복|기뻐|즐거|신나/, word: 'happy' },
  { pattern: /와|우와|대박|멋져|짱|최고/, word: 'wow' },
];

export class SpeechTrigger {
  private recognition: any = null;
  private running = false;
  private onTrigger: ((event: TriggerEvent) => void) | null = null;
  private cooldowns = new Map<TriggerWord, number>();
  private cooldownMs = 2000;
  private restartTimer: number = 0;
  private consecutiveErrors = 0;
  private maxConsecutiveErrors = 5;

  constructor(onTrigger: (event: TriggerEvent) => void) {
    this.onTrigger = onTrigger;
  }

  start(): boolean {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[SpeechTrigger] Web Speech API not supported');
      return false;
    }

    this.running = true;
    this.consecutiveErrors = 0;
    this.createRecognition(SpeechRecognition);
    return true;
  }

  private createRecognition(SpeechRecognition?: any) {
    if (!this.running) return;

    const Ctor = SpeechRecognition || (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;

    // Clean up old instance
    try { this.recognition?.stop(); } catch {}
    this.recognition = new Ctor();
    this.recognition.lang = 'ko-KR';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
      this.consecutiveErrors = 0; // successful result resets error count
      const now = Date.now();
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript.trim();
        if (!transcript) continue;

        for (const { pattern, word } of TRIGGER_MAP) {
          if (pattern.test(transcript)) {
            const lastTime = this.cooldowns.get(word) || 0;
            if (now - lastTime > this.cooldownMs) {
              this.cooldowns.set(word, now);
              this.onTrigger?.({ word, transcript });
              console.log(`[SpeechTrigger] "${transcript}" → ${word}`);
            }
            break;
          }
        }
      }
    };

    this.recognition.onerror = (event: any) => {
      if (!this.running) return;
      // 'aborted' errors often cascade — don't log or restart aggressively
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.warn('[SpeechTrigger] Permission denied, stopping');
        this.running = false;
        return;
      }
      console.warn('[SpeechTrigger] error:', event.error);
      this.consecutiveErrors++;
      if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
        console.warn('[SpeechTrigger] Too many errors, pausing for 10s');
        this.scheduleRestart(10000);
      }
    };

    this.recognition.onend = () => {
      if (!this.running) return;
      // Restart with backoff based on error count
      const delay = this.consecutiveErrors > 0 ? 2000 : 500;
      this.scheduleRestart(delay);
    };

    try {
      this.recognition.start();
      console.log('[SpeechTrigger] Started Korean speech recognition');
    } catch {
      this.scheduleRestart(2000);
    }
  }

  private scheduleRestart(delay: number) {
    clearTimeout(this.restartTimer);
    if (!this.running) return;
    this.restartTimer = window.setTimeout(() => {
      if (this.running) this.createRecognition();
    }, delay);
  }

  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    try { this.recognition?.stop(); } catch {}
    this.recognition = null;
  }

  isRunning(): boolean {
    return this.running;
  }
}
