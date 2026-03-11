/**
 * speech-polyfill.js
 * Replaces window.webkitSpeechRecognition with a Vosk-backed implementation
 * that communicates with the Electron main process via __sttBridge (contextBridge).
 *
 * Expects: window.__sttBridge = { start, stop, sendAudio, onResult }
 * Provides: window.webkitSpeechRecognition, window.SpeechRecognition
 */
(function () {
  "use strict";

  if (!window.__sttBridge) {
    console.warn("[speech-polyfill] __sttBridge not found – polyfill skipped");
    return;
  }

  // ── Target sample rate for Vosk (16 kHz mono Int16) ────────────────────────
  const TARGET_SR = 16000;
  const CHUNK_SAMPLES = 4096; // ~256 ms at 16 kHz

  // ── Simple event-target mixin ───────────────────────────────────────────────
  class EventTarget2 {
    constructor() { this._listeners = {}; }
    addEventListener(type, fn) {
      (this._listeners[type] = this._listeners[type] || []).push(fn);
    }
    removeEventListener(type, fn) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter((f) => f !== fn);
    }
    _emit(type, event) {
      const handler = this["on" + type];
      if (typeof handler === "function") handler.call(this, event);
      (this._listeners[type] || []).forEach((fn) => fn.call(this, event));
    }
  }

  // ── VoskSpeechRecognition ───────────────────────────────────────────────────
  class VoskSpeechRecognition extends EventTarget2 {
    constructor() {
      super();
      this.continuous      = false;
      this.interimResults  = false;
      this.lang            = "ko-KR";
      this.maxAlternatives = 1;

      this._running        = false;
      this._audioCtx       = null;
      this._stream         = null;
      this._source         = null;
      this._processor      = null;
      this._resampleBuf    = [];
      this._resampleCount  = 0;
    }

    // ── start ────────────────────────────────────────────────────────────────
    async start() {
      if (this._running) return;
      this._running = true;

      try {
        // 1. Start Vosk recognizer in main process
        const res = await window.__sttBridge.start();
        if (!res || !res.ok) {
          // model_not_ready → "network" error so SpeechTrigger retries (not permanent stop)
          this._running = false;
          this._fireError("network", res && res.error);
          this._emit("end", { type: "end" });  // trigger SpeechTrigger restart
          return;
        }

        // 2. Listen for results from main process
        window.__sttBridge.onResult((text, isFinal) => {
          if (!this._running) return;
          if (!isFinal && !this.interimResults) return;

          const alt = { transcript: text, confidence: isFinal ? 0.9 : 0.5 };
          const resultItem = Object.assign([alt], {
            isFinal,
            length: 1,
            item: (i) => [alt][i],
          });
          const results = Object.assign([resultItem], {
            length: 1,
            item: (i) => [resultItem][i],
          });
          this._emit("result", {
            type: "result",
            results,
            resultIndex: 0,
          });

          if (isFinal && !this.continuous) this.stop();
        });

        // 3. Capture microphone
        this._stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this._audioCtx = new AudioContext();
        this._source = this._audioCtx.createMediaStreamSource(this._stream);

        const nativeSR = this._audioCtx.sampleRate;
        const ratio = nativeSR / TARGET_SR; // e.g. 48000/16000 = 3

        // ScriptProcessor for raw PCM access (deprecated but universally available in Electron)
        const bufSize = 4096;
        this._processor = this._audioCtx.createScriptProcessor(bufSize, 1, 1);
        this._processor.onaudioprocess = (ev) => {
          const input = ev.inputBuffer.getChannelData(0); // Float32 at nativeSR

          // Simple nearest-neighbour downsampling to TARGET_SR
          for (let i = 0; i < input.length; i++) {
            this._resampleBuf.push(input[i]);
          }

          // Flush full chunks at TARGET_SR
          const targetChunk = Math.round(bufSize * ratio); // samples in nativeSR for one chunk
          while (this._resampleBuf.length >= targetChunk) {
            const slice = this._resampleBuf.splice(0, targetChunk);
            const out = new Int16Array(Math.round(slice.length / ratio));
            for (let j = 0; j < out.length; j++) {
              const s = slice[Math.round(j * ratio)];
              out[j] = Math.max(-32768, Math.min(32767, s * 32767));
            }
            window.__sttBridge.sendAudio(out.buffer);
          }
        };

        this._source.connect(this._processor);
        this._processor.connect(this._audioCtx.destination);

        this._emit("start", { type: "start" });

      } catch (e) {
        console.error("[speech-polyfill] start error:", e);
        this._fireError("audio-capture", e.message);
        this._running = false;
      }
    }

    // ── stop ─────────────────────────────────────────────────────────────────
    stop() {
      if (!this._running) return;
      this._running = false;

      try { this._processor && this._processor.disconnect(); } catch {}
      try { this._source    && this._source.disconnect(); }    catch {}
      try { this._audioCtx  && this._audioCtx.close(); }      catch {}
      if (this._stream) {
        this._stream.getTracks().forEach((t) => t.stop());
      }
      this._processor = this._source = this._audioCtx = this._stream = null;
      this._resampleBuf = [];

      window.__sttBridge.stop().catch(() => {});
      this._emit("end", { type: "end" });
    }

    abort() { this.stop(); }

    // ── helpers ──────────────────────────────────────────────────────────────
    _fireError(error, message) {
      const ev = { type: "error", error, message: message || error };
      this._emit("error", ev);
    }
  }

  // ── Install polyfill ────────────────────────────────────────────────────────
  window.SpeechRecognition        = VoskSpeechRecognition;
  window.webkitSpeechRecognition  = VoskSpeechRecognition;

  console.log("[speech-polyfill] webkitSpeechRecognition → VoskSpeechRecognition installed ✓");
})();
