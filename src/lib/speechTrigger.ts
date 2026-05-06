// Real-time Korean speech recognition for trigger word detection
// 5-06 — Web Speech API → Vosk WASM(로컬) 교체. 인터넷·API 키 불필요.
//
// 모델: vosk-model-small-ko-0.22 (~80MB), public/models/vosk-ko/에 setup 단계로 배치.
// 첫 실행 시 IndexedDB로 모델 캐시 → 이후 오프라인 동작.

import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser';

export type TriggerWord = 'love' | 'hello' | 'happy' | 'wow' | 'thanks' | 'sorry' | 'missyou';

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
  { pattern: /고마워|고맙|감사|땡큐|땡스/, word: 'thanks' },
  { pattern: /미안|죄송|sorry/, word: 'sorry' },
  { pattern: /보고\s?싶|그리워|그립/, word: 'missyou' },
];

const MODEL_URL = '/models/vosk-ko/vosk-model-small-ko-0.22.zip';
// Vosk small ko 권장 16kHz. AudioContext가 hint를 못 따르면 실측값 사용.
const TARGET_SAMPLE_RATE = 16000;

export class SpeechTrigger {
  private model: Model | null = null;
  private recognizer: KaldiRecognizer | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private running = false;
  private onTrigger: ((event: TriggerEvent) => void) | null = null;
  private cooldowns = new Map<TriggerWord, number>();
  private cooldownMs = 2000;
  private lastSeenPartial = '';

  constructor(onTrigger: (event: TriggerEvent) => void) {
    this.onTrigger = onTrigger;
  }

  // 비동기지만 호출자는 `await` 없이 fire-and-forget OK — 모델 로드 중엔 인식 못하지만
  // 마이크 캡처는 즉시 시작되고, 로드 완료 시점부터 자동으로 인식 시작.
  async start(): Promise<boolean> {
    if (this.running) return true;
    this.running = true;

    try {
      // 1. 마이크 + 오디오 그래프 즉시 구성 (모델 로드와 병렬)
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: TARGET_SAMPLE_RATE,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      this.audioContext = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE });
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
      // ScriptProcessorNode — deprecated이지만 Chrome에서 안정적, AudioWorklet 부담 회피
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      const ctxRate = this.audioContext.sampleRate;
      this.processor.onaudioprocess = (e) => {
        if (!this.running || !this.recognizer) return; // 모델 로드 전엔 chunk 폐기
        const ch = e.inputBuffer.getChannelData(0);
        // ScriptProcessor 버퍼는 재사용되므로 복사 필수
        const buf = new Float32Array(ch.length);
        buf.set(ch);
        try {
          this.recognizer.acceptWaveformFloat(buf, ctxRate);
        } catch (err) {
          console.warn('[SpeechTrigger] acceptWaveformFloat failed:', err);
        }
      };
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // 2. 모델 로드 (첫 실행 ~1-3s, 이후 IndexedDB 캐시)
      console.log('[SpeechTrigger] vosk model loading...');
      const t0 = performance.now();
      this.model = await createModel(MODEL_URL);
      console.log(`[SpeechTrigger] vosk loaded in ${Math.round(performance.now() - t0)}ms`);

      // 로드 중 stop() 호출됐으면 정리
      if (!this.running) {
        this.cleanup();
        return false;
      }

      this.recognizer = new this.model.KaldiRecognizer(TARGET_SAMPLE_RATE);

      this.recognizer.on('partialresult', (msg: any) => {
        const partial: string = msg.result?.partial?.trim() ?? '';
        if (!partial || partial === this.lastSeenPartial) return;
        this.lastSeenPartial = partial;
        this.matchTriggers(partial);
      });

      this.recognizer.on('result', (msg: any) => {
        const text: string = msg.result?.text?.trim() ?? '';
        this.lastSeenPartial = '';
        if (!text) return;
        this.matchTriggers(text);
      });

      console.log('[SpeechTrigger] running');
      return true;
    } catch (err) {
      console.error('[SpeechTrigger] init failed:', err);
      this.cleanup();
      this.running = false;
      return false;
    }
  }

  private matchTriggers(transcript: string) {
    const now = Date.now();
    for (const { pattern, word } of TRIGGER_MAP) {
      if (pattern.test(transcript)) {
        const last = this.cooldowns.get(word) ?? 0;
        if (now - last > this.cooldownMs) {
          this.cooldowns.set(word, now);
          this.onTrigger?.({ word, transcript });
          console.log(`[SpeechTrigger] "${transcript}" → ${word}`);
        }
      }
    }
  }

  stop() {
    this.running = false;
    this.cleanup();
    console.log('[SpeechTrigger] stopped');
  }

  private cleanup() {
    try { this.processor?.disconnect(); } catch { /* noop */ }
    try { this.source?.disconnect(); } catch { /* noop */ }
    try { this.audioContext?.close(); } catch { /* noop */ }
    try { this.recognizer?.remove(); } catch { /* noop */ }
    try { this.model?.terminate(); } catch { /* noop */ }
    this.processor = null;
    this.source = null;
    this.audioContext = null;
    this.recognizer = null;
    this.model = null;
    if (this.mediaStream) {
      for (const track of this.mediaStream.getTracks()) track.stop();
      this.mediaStream = null;
    }
    this.lastSeenPartial = '';
  }
}
