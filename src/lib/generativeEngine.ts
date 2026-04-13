// ══════════════════════════════════════════════════════════════════
//  Oscilloscope Engine (2026-04-13 재설계)
//
//  - 중앙 가로축 웨이브폼 렌더 (얇은 코어 + bloom 3~4단)
//  - 피치 → 5-band HSL 보간 → 세션 컬러 1개 (침묵 갭 ≥2s 시 새 세션)
//  - 세로 누적 슬라이스 버퍼 (폰 월페이퍼 export용, 260406 스타일)
//  - 레거시 NEON/flow 엔진은 archive/neon-flow-v1 + 별도 폴더 보존
// ══════════════════════════════════════════════════════════════════

import type { AudioFeatures } from './audioAnalyzer';
import type { TriggerWord } from './speechTrigger';

// ── 피치 5-band (저음 blue → 고음 red) ────────────────────────────
interface ColorStop { pitch: number; h: number; s: number; l: number; }
const PITCH_STOPS: ColorStop[] = [
  { pitch:  80, h: 220, s: 90, l: 55 }, // 저음  파랑
  { pitch: 180, h: 180, s: 85, l: 50 }, // 중저  청록
  { pitch: 280, h:  80, s: 80, l: 55 }, // 중    연녹
  { pitch: 400, h:  25, s: 95, l: 55 }, // 중고  주황
  { pitch: 600, h:   0, s: 90, l: 55 }, // 고음  빨강
];

function pitchToHsl(pitch: number): [number, number, number] {
  if (pitch <= PITCH_STOPS[0].pitch) {
    const s = PITCH_STOPS[0]; return [s.h, s.s, s.l];
  }
  const last = PITCH_STOPS[PITCH_STOPS.length - 1];
  if (pitch >= last.pitch) return [last.h, last.s, last.l];
  for (let i = 0; i < PITCH_STOPS.length - 1; i++) {
    const a = PITCH_STOPS[i], b = PITCH_STOPS[i + 1];
    if (pitch >= a.pitch && pitch < b.pitch) {
      const t = (pitch - a.pitch) / (b.pitch - a.pitch);
      // hue 최단 경로 보간
      let dh = b.h - a.h;
      if (dh > 180) dh -= 360;
      if (dh < -180) dh += 360;
      const h = ((a.h + dh * t) % 360 + 360) % 360;
      return [h, a.s + (b.s - a.s) * t, a.l + (b.l - a.l) * t];
    }
  }
  return [200, 80, 55];
}

// ── 세션 컬러 추적기 ──────────────────────────────────────────────
class SessionColorTracker {
  private pitchSamples: number[] = [];
  private lastVoiceTime = -Infinity;
  private currentHsl: [number, number, number] | null = null;
  private sessionGapMs: number;

  constructor(gapMs = 2000) { this.sessionGapMs = gapMs; }
  setGapMs(ms: number) { this.sessionGapMs = ms; }

  feed(f: AudioFeatures, now: number) {
    if (!f.isSpeaking || f.pitch < 60 || f.pitch > 800) return;
    if (now - this.lastVoiceTime > this.sessionGapMs) {
      // 새 세션 시작: 컬러 리셋
      this.pitchSamples = [];
      this.currentHsl = null;
    }
    this.lastVoiceTime = now;
    this.pitchSamples.push(f.pitch);
    if (this.pitchSamples.length > 120) this.pitchSamples.shift(); // 약 2초치
    // 처음 6샘플(~100ms)까지는 즉각 반응, 이후 중앙값으로 안정화
    if (this.pitchSamples.length >= 6 && !this.currentHsl) {
      const sorted = [...this.pitchSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      this.currentHsl = pitchToHsl(median);
    } else if (!this.currentHsl) {
      this.currentHsl = pitchToHsl(f.pitch);
    }
  }

  getHsl(): [number, number, number] {
    return this.currentHsl ?? [220, 85, 55];
  }

  // QR export 시점에 세션 기준 색을 얻기 위해
  getLockedHsl(): [number, number, number] | null {
    return this.currentHsl;
  }
}

// ── 파라미터 기본값 ───────────────────────────────────────────────
interface OscParams {
  lineCore?: number;         // 코어 스트로크 두께 (px)
  bloomPasses?: number;      // 블룸 레이어 수 (1~4)
  bloomIntensity?: number;   // shadowBlur 기본값 (px)
  waveformGain?: number;     // 진폭 배율
  sessionGapMs?: number;     // 침묵 갭 (ms)
  historyLen?: number;       // 가로 히스토리 샘플 수
  idleAmplitude?: number;    // idle 시 파형 강도
  trailDecay?: number;       // 잔상 페이드 (0~1, 1=즉시 지움)
  portraitWidth?: number;    // 폰 월페이퍼 가로
  portraitHeight?: number;   // 폰 월페이퍼 세로
}

export class GenerativeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  // 가로 체험 레이어(잔상 포함)
  private trailCanvas: HTMLCanvasElement;
  private trailCtx: CanvasRenderingContext2D;

  // 세로 월페이퍼 버퍼 (세션 누적)
  private portraitBuffer: HTMLCanvasElement;
  private portraitCtx: CanvasRenderingContext2D;
  private portraitCursorY = 0;
  private sessionPeakAmp = 0;        // 현재 세션 진행 중 누적된 최대 진폭
  private sessionActive = false;     // 세션 중 여부 (portrait slice 확정 타이밍)

  private history: number[] = [];    // 최근 N 샘플 (waveform amplitude -1~1)
  private time = 0;
  private idle = false;
  private idleT = 0;
  private session: SessionColorTracker;

  // 레거시 API 유지용 — 튜닝 패널이 채우는 자리
  public params: OscParams = {};

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = canvas.width;
    this.trailCanvas.height = canvas.height;
    this.trailCtx = this.trailCanvas.getContext('2d', { alpha: false })!;
    this.trailCtx.fillStyle = '#2C2C2C';
    this.trailCtx.fillRect(0, 0, canvas.width, canvas.height);

    // 세로 월페이퍼: 처음엔 가로×세로 비율 기반, 실제 export는 getter에서 사이즈 조정
    this.portraitBuffer = document.createElement('canvas');
    this.portraitBuffer.width = 1080;
    this.portraitBuffer.height = 2340;
    this.portraitCtx = this.portraitBuffer.getContext('2d', { alpha: false })!;
    this.portraitCtx.fillStyle = '#FFFFFF';
    this.portraitCtx.fillRect(0, 0, this.portraitBuffer.width, this.portraitBuffer.height);
    this.portraitCursorY = 40;

    this.session = new SessionColorTracker(2000);
    this.history = new Array(1024).fill(0);
  }

  // ── 외부 API (SoundCanvas.tsx가 호출) ─────────────────────────
  setIdleMode(on: boolean) { this.idle = on; }

  update(f: AudioFeatures) {
    this.time += 1 / 60;
    const p = this.params;
    const gapMs = p.sessionGapMs ?? 2000;
    this.session.setGapMs(gapMs);

    const now = performance.now();
    this.session.feed(f, now);

    const gain = p.waveformGain ?? 1.6;
    // waveform(Uint8Array 0..255, 128 중앙)을 -1~1로 변환 후 히스토리에 최신 샘플 누적
    const w = f.waveform;
    if (w && w.length > 0) {
      // 프레임당 여러 샘플을 평균해 한 포인트 추가 (히스토리 속도 조절)
      const stride = Math.max(1, Math.floor(w.length / 6));
      let maxAbs = 0;
      for (let i = 0; i < w.length; i += stride) {
        const v = (w[i] - 128) / 128;
        if (Math.abs(v) > Math.abs(maxAbs)) maxAbs = v;
      }
      this.history.push(Math.max(-1, Math.min(1, maxAbs * gain)));
      while (this.history.length > (p.historyLen ?? 1024)) this.history.shift();
    }

    // 세션 상태 전이: 말하는 중이면 세션 활성, 2s 갭 후 첫 발화 시 portrait slice 확정
    if (f.isSpeaking) {
      if (!this.sessionActive) {
        this.sessionActive = true;
        this.sessionPeakAmp = 0;
      }
      this.sessionPeakAmp = Math.max(this.sessionPeakAmp, f.volume);
    } else {
      // 침묵 > gap 이면 세션 종료 + portrait에 한 슬라이스 확정
      if (this.sessionActive && now - (this.session as any).lastVoiceTime > gapMs) {
        this.commitPortraitSlice();
        this.sessionActive = false;
      }
    }

    this.render(false);
  }

  updateIdle() {
    this.time += 1 / 60;
    this.idleT += 1 / 60;
    // idle: 낮은 진폭 사인 + 미세 노이즈
    const amp = (this.params.idleAmplitude ?? 0.08);
    const v = Math.sin(this.idleT * 1.2) * amp * 0.5 + (Math.random() - 0.5) * amp * 0.3;
    this.history.push(v);
    while (this.history.length > (this.params.historyLen ?? 1024)) this.history.shift();
    this.render(true);
  }

  clear() {
    this.history = new Array(this.history.length).fill(0);
    this.trailCtx.fillStyle = '#2C2C2C';
    this.trailCtx.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    this.ctx.fillStyle = '#2C2C2C';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // portrait도 리셋
    this.portraitCtx.fillStyle = '#FFFFFF';
    this.portraitCtx.fillRect(0, 0, this.portraitBuffer.width, this.portraitBuffer.height);
    this.portraitCursorY = 40;
    this.sessionPeakAmp = 0;
    this.sessionActive = false;
  }

  triggerSpecialEvent(_word: TriggerWord) {
    // 오실로스코프 버전에서는 키워드 이펙트를 단순화 — 일시적 컬러 플래시
    // TODO(64/65 이후 재방문): 동물 요소 버스트와 통합할지 결정
    const flashAmp = 0.6;
    for (let i = 0; i < 20; i++) {
      this.history.push(flashAmp * (Math.random() * 2 - 1));
    }
    while (this.history.length > (this.params.historyLen ?? 1024)) this.history.shift();
  }

  // ── 렌더 ─────────────────────────────────────────────────────
  private render(isIdle: boolean) {
    const ctx = this.trailCtx;
    const W = this.trailCanvas.width;
    const H = this.trailCanvas.height;

    // 잔상 페이드 — decay 비율만큼 배경색으로 덮기
    const decay = this.params.trailDecay ?? 0.22;
    ctx.save();
    ctx.globalAlpha = decay;
    ctx.fillStyle = '#2C2C2C';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const [h, s, l] = this.session.getHsl();
    const core = this.params.lineCore ?? 1.5;
    const bloomBase = this.params.bloomIntensity ?? 16;
    const passes = Math.max(1, Math.min(4, Math.floor(this.params.bloomPasses ?? 3)));

    const midY = H / 2;
    const len = this.history.length;
    const step = W / len;

    // 블룸 레이어 (큰 blur + 낮은 알파부터 쌓고, 마지막에 코어)
    for (let pass = passes; pass >= 0; pass--) {
      ctx.save();
      if (pass === 0) {
        // 코어: 얇고 밝은 스트로크 (거의 흰색에 가까운 라이트 색)
        ctx.strokeStyle = `hsl(${h}, ${Math.min(100, s + 10)}%, ${Math.min(95, l + 30)}%)`;
        ctx.lineWidth = core;
        ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.shadowBlur = bloomBase * 0.4;
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.lineWidth = core + pass * 1.2;
        ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.shadowBlur = bloomBase * pass;
        ctx.globalAlpha = isIdle ? 0.25 : 0.4 / pass;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < len; i++) {
        const x = i * step;
        const y = midY - this.history[i] * (H * 0.38);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 체험 화면으로 복사
    this.ctx.drawImage(this.trailCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ── 세로 월페이퍼: 세션 한 번마다 가로 슬라이스를 세로로 쌓기 ──
  private commitPortraitSlice() {
    const buf = this.portraitBuffer;
    const bctx = this.portraitCtx;
    const sliceH = 120;
    if (this.portraitCursorY + sliceH > buf.height - 40) {
      // 공간 부족 시 위로 스크롤
      const shift = sliceH;
      const tmp = document.createElement('canvas');
      tmp.width = buf.width; tmp.height = buf.height;
      tmp.getContext('2d')!.drawImage(buf, 0, 0);
      bctx.fillStyle = '#FFFFFF';
      bctx.fillRect(0, 0, buf.width, buf.height);
      bctx.drawImage(tmp, 0, -shift);
      this.portraitCursorY -= shift;
    }

    const [h, s, l] = this.session.getLockedHsl() ?? [220, 85, 45];
    const W = buf.width;
    const cx = W / 2;
    const len = Math.min(this.history.length, 600);
    const slice = this.history.slice(-len);
    const cy = this.portraitCursorY + sliceH / 2;

    // 폰 월페이퍼는 흰 배경 + 진한 컬러(밝기 낮춤) 단색, 260406 스타일
    bctx.save();
    bctx.strokeStyle = `hsl(${h}, ${s}%, ${Math.max(25, l - 25)}%)`;
    bctx.lineWidth = 2;
    bctx.lineCap = 'round';
    bctx.lineJoin = 'round';
    bctx.beginPath();
    const step = (W - 120) / len;
    for (let i = 0; i < len; i++) {
      const x = 60 + i * step;
      const y = cy - slice[i] * (sliceH * 0.45);
      if (i === 0) bctx.moveTo(x, y); else bctx.lineTo(x, y);
    }
    bctx.stroke();
    // 중앙 축 흐린 가이드
    bctx.globalAlpha = 0.12;
    bctx.strokeStyle = `hsl(${h}, ${s}%, ${l}%)`;
    bctx.lineWidth = 1;
    bctx.beginPath();
    bctx.moveTo(cx - (W - 120) / 2, cy);
    bctx.lineTo(cx + (W - 120) / 2, cy);
    bctx.stroke();
    bctx.restore();

    this.portraitCursorY += sliceH;
  }

  // ── Export ──────────────────────────────────────────────────
  toDataURL(): string {
    // 가로(체험) 이미지 — 현재 trail 상태 그대로
    return this.trailCanvas.toDataURL('image/png');
  }

  toPortraitDataURL(w = 1080, h = 2340): string {
    // 세로 월페이퍼: portraitBuffer 내용이 있으면 그대로, 없으면 현재 히스토리로 한 슬라이스 즉석 생성
    const hasContent = this.portraitCursorY > 40;
    if (!hasContent) {
      // 아직 세션이 commit 안 됐으면 지금 강제 커밋
      this.commitPortraitSlice();
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d')!;
    o.fillStyle = '#FFFFFF';
    o.fillRect(0, 0, w, h);
    // portraitBuffer 전체를 타겟 크기에 맞춰 복사 (레터박스 없이 fit)
    const srcRatio = this.portraitBuffer.width / this.portraitBuffer.height;
    const dstRatio = w / h;
    let dw = w, dh = h, dx = 0, dy = 0;
    if (srcRatio > dstRatio) {
      dh = w / srcRatio;
      dy = (h - dh) / 2;
    } else {
      dw = h * srcRatio;
      dx = (w - dw) / 2;
    }
    o.drawImage(this.portraitBuffer, dx, dy, dw, dh);
    return out.toDataURL('image/png');
  }
}
