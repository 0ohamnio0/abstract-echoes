// Real-time Korean speech recognition for trigger word detection
// Vosk WASM (로컬). 구글 클라우드 STT·Chrome 버전·--app 키오스크 의존 없이 브라우저 안에서 직접 인식.
// 모델(82MB)만 Vercel Blob에서 로드 (public, CORS). 첫 로드 후 IndexedDB 캐시.

import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser';

export type TriggerWord = 'love' | 'hello' | 'happy' | 'wow' | 'thanks' | 'sorry' | 'missyou';

export interface TriggerEvent {
  word: TriggerWord;
  transcript: string;
}

// SoundCanvas / 디버그 오버레이 호환 유지. Vosk는 항상 로컬이라 processLocally=true 고정.
export interface SpeechTriggerState {
  status: 'idle' | 'starting' | 'running' | 'error' | 'stopped';
  lastError: string | null;
  lastTranscript: string | null;
  transcriptCount: number;
  restartCount: number;
  availability: 'unknown' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unsupported';
  processLocally: boolean;
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

// 82MB 모델은 Vercel 정적 배포 한계로 404 → Vercel Blob에서 서빙 (public, CORS 허용).
const MODEL_URL = 'https://rtab0znq66rtnyyh.public.blob.vercel-storage.com/vosk-model-small-ko-0.22.zip';
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
  private onStateChange: ((state: SpeechTriggerState) => void) | null = null;
  private cooldowns = new Map<TriggerWord, number>();
  private cooldownMs = 2000;
  private lastSeenPartial = '';
  private state: SpeechTriggerState = {
    status: 'idle',
    lastError: null,
    lastTranscript: null,
    transcriptCount: 0,
    restartCount: 0,
    availability: 'unknown',
    processLocally: true,
  };

  constructor(
    onTrigger: (event: TriggerEvent) => void,
    onStateChange?: (state: SpeechTriggerState) => void,
  ) {
    this.onTrigger = onTrigger;
    this.onStateChange = onStateChange ?? null;
  }

  private emitState() {
    this.onStateChange?.({ ...this.state });
  }

  // 마이크 캡처는 즉시 시작, 모델 로드는 병렬. 로드 완료 시점부터 인식 시작.
  start(): boolean {
    if (this.running) return true;
    this.running = true;
    this.state.status = 'starting';
    this.state.availability = 'downloading';
    this.state.lastError = null;
    this.emitState();
    void this.init();
    return true;
  }

  private async init() {
    try {
      // 1. 마이크 + 오디오 그래프 (모델 로드와 병렬)
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

      if (!this.running) {
        this.cleanup();
        return;
      }

      this.recognizer = new this.model.KaldiRecognizer(TARGET_SAMPLE_RATE);

      this.recognizer.on('partialresult', (msg: any) => {
        const partial: string = msg.result?.partial?.trim() ?? '';
        if (!partial || partial === this.lastSeenPartial) return;
        this.lastSeenPartial = partial;
        this.handleTranscript(partial);
      });

      this.recognizer.on('result', (msg: any) => {
        const text: string = msg.result?.text?.trim() ?? '';
        this.lastSeenPartial = '';
        if (!text) return;
        this.handleTranscript(text);
      });

      this.state.status = 'running';
      this.state.availability = 'available';
      this.emitState();
      console.log('[SpeechTrigger] running (Vosk local)');
    } catch (err: any) {
      console.error('[SpeechTrigger] init failed:', err);
      this.state.status = 'error';
      this.state.lastError =
        err?.name === 'NotAllowedError' ? 'not-allowed' : (err?.message ?? 'init-failed');
      this.state.availability = 'unavailable';
      this.emitState();
      this.cleanup();
      this.running = false;
    }
  }

  private handleTranscript(transcript: string) {
    this.state.transcriptCount++;
    this.state.lastTranscript = transcript;
    this.emitState();
    console.log('[SpeechTrigger:transcript]', transcript);
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
    this.state.status = 'stopped';
    this.emitState();
    console.log('[SpeechTrigger] stopped');
  }

  isRunning(): boolean {
    return this.running;
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
