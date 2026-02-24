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
  private cooldownMs = 2000; // prevent rapid re-triggers

  constructor(onTrigger: (event: TriggerEvent) => void) {
    this.onTrigger = onTrigger;
  }

  start(): boolean {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.warn('[SpeechTrigger] Web Speech API not supported');
      return false;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.lang = 'ko-KR';
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.maxAlternatives = 1;

    this.recognition.onresult = (event: any) => {
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
      console.warn('[SpeechTrigger] error:', event.error);
      // Auto-restart on non-fatal errors
      if (event.error !== 'not-allowed' && this.running) {
        setTimeout(() => this.restartRecognition(), 500);
      }
    };

    this.recognition.onend = () => {
      // Auto-restart when recognition ends (it times out periodically)
      if (this.running) {
        setTimeout(() => this.restartRecognition(), 200);
      }
    };

    this.running = true;
    this.recognition.start();
    console.log('[SpeechTrigger] Started Korean speech recognition');
    return true;
  }

  private restartRecognition() {
    if (!this.running || !this.recognition) return;
    try {
      this.recognition.start();
    } catch {
      // Already started, ignore
    }
  }

  stop() {
    this.running = false;
    try {
      this.recognition?.stop();
    } catch {
      // ignore
    }
    this.recognition = null;
  }

  isRunning(): boolean {
    return this.running;
  }
}
