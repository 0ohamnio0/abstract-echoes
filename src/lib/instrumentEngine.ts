// ══════════════════════════════════════════════════════════════════
//  Instrument Engine (2026-04-23 v3)
//
//  체험 세션이 활성화된 동안, 4종 동물 악기 레이어가 띄엄띄엄 노트를
//  떨어뜨린다. 우연히 겹치는 순간이 합주로 들린다.
//  (브레멘 음악대 서사: 당나귀 → 개 → 고양이 → 닭 순으로 합류)
//
//  전부 WebAudio 합성. 스템 파일 없음.
//  v2: 지속 드론 제거, 간헐적 노트만 남김.
//  v3: PeriodicWave 벨 하모닉스 + 짧은 feedback delay로 맑은 톤.
//  v4: 옥타브 전부 +1, 배음 단순화, 필터 완화, 공간 깊이 확장.
// ══════════════════════════════════════════════════════════════════

import type { AudioFeatures } from './audioAnalyzer';

type InstrumentName = 'donkey' | 'dog' | 'cat' | 'rooster';

// A minor pentatonic base frequencies (A1 기준)
const PENTA = [55, 65.41, 73.42, 82.41, 98];

interface PatchDef {
  name: InstrumentName;
  startAt: number;
  octaveShift: number;
  interval: number;
  gain: number;
}

// 인터벌은 평균치. 실제 발생은 ±60% 지터.
const PATCHES: PatchDef[] = [
  { name: 'donkey',  startAt: 0,  octaveShift: 3, interval: 11.0, gain: 0.18 },
  { name: 'dog',     startAt: 20, octaveShift: 3, interval: 9.0,  gain: 0.17 },
  { name: 'cat',     startAt: 40, octaveShift: 4, interval: 7.5,  gain: 0.15 },
  { name: 'rooster', startAt: 60, octaveShift: 5, interval: 6.0,  gain: 0.12 },
];

// ── Bell-like PeriodicWave spectra (Fourier 진폭 계수) ──
// 배열 index i → (i+1)번째 하모닉. 0은 DC라 빠짐.
const BELL_SPECTRA: Record<InstrumentName, number[]> = {
  donkey:  [1, 0.3, 0.1                    ], // 거의 sine + 살짝 옥타브 (하모니움 느낌)
  dog:     [1, 0,   0.25, 0,    0.08       ], // sine + 약한 홀수 배음 (플루트)
  cat:     [1, 0,   0.15, 0,    0.05       ], // 순수 sine 중심 (셀레스타)
  rooster: [1, 0.2, 0.15, 0,    0.05       ], // 가벼운 벨 (투명한 트라이앵글)
};

function buildWave(ctx: AudioContext, spectrum: number[]): PeriodicWave {
  const real = new Float32Array(spectrum.length + 1);
  const imag = new Float32Array(spectrum.length + 1);
  real[0] = 0;
  for (let i = 0; i < spectrum.length; i++) real[i + 1] = spectrum[i];
  return ctx.createPeriodicWave(real, imag);
}

export class InstrumentEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private voiceMod: GainNode | null = null;

  private layers: InstrumentLayer[] = [];
  private sessionAnchor: number | null = null;

  private volEnv = 0;
  private muted = false;

  async start(): Promise<void> {
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
    this.ctx = ctx;

    // master → voiceMod → destination (dry 경로)
    this.master = ctx.createGain();
    this.master.gain.value = 0.5;

    this.voiceMod = ctx.createGain();
    this.voiceMod.gain.value = 1.0;

    this.master.connect(this.voiceMod);
    this.voiceMod.connect(ctx.destination);

    // 공간감 — 더 깊은 feedback delay (v4: wet·feedback·tone 확장)
    const wetSend = ctx.createGain();
    wetSend.gain.value = 0.32;
    const delay = ctx.createDelay(0.8);
    delay.delayTime.value = 0.22;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 4500; // delay tail 더 밝게

    this.master.connect(wetSend);
    wetSend.connect(delay);
    delay.connect(tone);
    tone.connect(fb);
    fb.connect(delay); // feedback loop
    tone.connect(this.voiceMod); // wet → mix

    // 악기 레이어 — PeriodicWave 주입
    const waves = {
      donkey:  buildWave(ctx, BELL_SPECTRA.donkey),
      dog:     buildWave(ctx, BELL_SPECTRA.dog),
      cat:     buildWave(ctx, BELL_SPECTRA.cat),
      rooster: buildWave(ctx, BELL_SPECTRA.rooster),
    };
    this.layers = PATCHES.map(p => new InstrumentLayer(ctx, this.master!, p, waves[p.name]));
  }

  feed(f: AudioFeatures, sessionActive: boolean): void {
    if (!this.ctx || !this.master || !this.voiceMod) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (sessionActive && this.sessionAnchor === null) {
      this.sessionAnchor = now;
    }

    if (!sessionActive && this.sessionAnchor !== null) {
      this.sessionAnchor = null;
      this.layers.forEach(l => l.deactivate());
      this.volEnv = 0;
      return;
    }

    if (this.sessionAnchor === null) return;

    const target = Math.min(1, (f.volume || 0) * 3);
    const k = target > this.volEnv ? 0.25 : 0.08;
    this.volEnv += (target - this.volEnv) * k;
    const voiceGain = this.muted ? 0 : (0.8 + this.volEnv * 0.4);
    this.voiceMod.gain.setTargetAtTime(voiceGain, now, 0.08);

    const elapsed = now - this.sessionAnchor;
    this.layers.forEach(l => l.tick(elapsed, f, now));
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }

  setMasterGain(v: number): void {
    if (this.master) this.master.gain.value = Math.max(0, Math.min(1, v));
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    if (this.master) {
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setValueAtTime(this.master.gain.value, now);
      this.master.gain.linearRampToValueAtTime(0, now + 0.5);
    }

    const toClose = ctx;
    this.ctx = null;
    this.master = null;
    this.voiceMod = null;
    this.layers = [];
    this.sessionAnchor = null;
    this.volEnv = 0;

    setTimeout(() => { toClose.close().catch(() => {}); }, 700);
  }
}

// ── Layer (per instrument) ───────────────────────────────────────
class InstrumentLayer {
  private active = false;
  private lastNoteCtxTime = -Infinity;
  private nextGapJitter = 0;

  constructor(
    private ctx: AudioContext,
    private dest: AudioNode,
    private def: PatchDef,
    private wave: PeriodicWave,
  ) {}

  deactivate() {
    this.active = false;
  }

  tick(elapsed: number, f: AudioFeatures, now: number) {
    if (elapsed < this.def.startAt) return;
    if (!this.active) {
      this.active = true;
      this.lastNoteCtxTime = now - this.def.interval + Math.random() * this.def.interval * 0.8;
      this.nextGapJitter = 0;
    }

    const interval = this.def.interval + this.nextGapJitter;
    if (now - this.lastNoteCtxTime < interval) return;

    const pitch = Math.max(60, Math.min(600, f.pitch || 220));
    const binIdx = Math.min(PENTA.length - 1,
      Math.max(0, Math.floor(((pitch - 60) / 540) * PENTA.length)));
    const freq = PENTA[binIdx] * Math.pow(2, this.def.octaveShift);

    this.triggerNote(freq, now);
    this.lastNoteCtxTime = now;
    this.nextGapJitter = (Math.random() - 0.5) * this.def.interval * 1.2;
  }

  private triggerNote(freq: number, t: number) {
    switch (this.def.name) {
      case 'donkey':  this.donkey(freq, t);  break;
      case 'dog':     this.dog(freq, t);     break;
      case 'cat':     this.cat(freq, t);     break;
      case 'rooster': this.rooster(freq, t); break;
    }
  }

  // 당나귀 — 하모니움 (v4: 더 투명, 긴 꼬리)
  private donkey(freq: number, t: number) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 3200; filt.Q.value = 0.5;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.setPeriodicWave(this.wave);
    o2.frequency.value = freq;
    o2.detune.value = 5;
    o.connect(filt); o2.connect(filt); filt.connect(g); g.connect(this.dest);
    const peak = this.def.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.0);
    o.start(t); o2.start(t);
    o.stop(t + 2.05); o2.stop(t + 2.05);
  }

  // 개 — 플루트 (v4: 맑고 가볍게)
  private dog(freq: number, t: number) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 5000; filt.Q.value = 0.5;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = freq;
    o.connect(filt); filt.connect(g); g.connect(this.dest);
    const peak = this.def.gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.start(t); o.stop(t + 1.25);
  }

  // 고양이 — 셀레스타 (v4: 즉시 attack + 맑은 긴 꼬리)
  private cat(freq: number, t: number) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 400;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = freq;
    o.connect(filt); filt.connect(g); g.connect(this.dest);
    const peak = this.def.gain;
    g.gain.setValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    o.start(t); o.stop(t + 1.45);
  }

  // 닭 — 투명한 트라이앵글 (v4: 약한 트레몰로, 긴 꼬리)
  private rooster(freq: number, t: number) {
    const ctx = this.ctx;
    const envGain = ctx.createGain(); envGain.gain.value = 0.0001;
    const amGain = ctx.createGain(); amGain.gain.value = 1;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass'; filt.frequency.value = 800;
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.wave);
    o.frequency.value = freq;
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 5;
    const lfoDepth = ctx.createGain(); lfoDepth.gain.value = 0.2;
    lfo.connect(lfoDepth); lfoDepth.connect(amGain.gain);

    o.connect(filt); filt.connect(amGain); amGain.connect(envGain); envGain.connect(this.dest);
    const peak = this.def.gain;
    envGain.gain.setValueAtTime(0.0001, t);
    envGain.gain.linearRampToValueAtTime(peak, t + 0.008);
    envGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.start(t); lfo.start(t);
    o.stop(t + 1.25); lfo.stop(t + 1.25);
  }
}
