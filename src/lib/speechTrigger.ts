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
  private consecutiveRestarts = 0;
  private lastStartTime = 0;
  private hadResult = false;

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
    this.consecutiveRestarts = 0;
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
    this.hadResult = false;
    this.lastStartTime = Date.now();

    this.recognition.onresult = (event: any) => {
      this.hadResult = true;
      this.consecutiveRestarts = 0;
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
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        console.warn('[SpeechTrigger] Permission denied, stopping');
        this.running = false;
        return;
      }
      console.warn('[SpeechTrigger] error:', event.error);
    };

    this.recognition.onend = () => {
      if (!this.running) return;

      const sessionDuration = Date.now() - this.lastStartTime;

      // If session lasted less than 2 seconds and had no results, it's a bad restart
      if (sessionDuration < 2000 && !this.hadResult) {
        this.consecutiveRestarts++;
      } else {
        this.consecutiveRestarts = 0;
      }

      // Exponential backoff: give up after too many rapid restarts
      if (this.consecutiveRestarts >= 5) {
        console.warn('[SpeechTrigger] Too many rapid restarts, pausing for 30s');
        this.scheduleRestart(30000);
        this.consecutiveRestarts = 0;
        return;
      }

      // Normal restart with increasing delay
      const delay = Math.min(1000 + this.consecutiveRestarts * 1000, 5000);
      this.scheduleRestart(delay);
    };

    try {
      this.recognition.start();
      if (this.consecutiveRestarts === 0) {
        console.log('[SpeechTrigger] Started Korean speech recognition');
      }
    } catch {
      this.scheduleRestart(3000);
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
