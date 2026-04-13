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
  private sessionActive = false;     // 세션 중 여부 (portrait 세션 간 여백 삽입용)

  private history: number[] = [];    // 최근 N 샘플 (waveform amplitude -1~1)
  private time = 0;
  private idle = false;
  private idleT = 0;
  private session: SessionColorTracker;
  private volEnv = 0;                // 볼륨 엔벨로프 (0..1, attack/release 적용)
  private lastVoiceAt = -Infinity;   // 마지막 발화 시각 (ms)

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

    // 볼륨 엔벨로프 — 빠른 attack(5프레임 ≈ 80ms), 느린 release(30프레임 ≈ 500ms)
    // 즉각 반응하면서 꺼질 땐 부드럽게 사라지는 인과성 연출
    const targetVol = f.isSpeaking ? Math.min(1, f.volume * 3) : 0;
    const attack = 0.35, release = 0.08;
    const k = targetVol > this.volEnv ? attack : release;
    this.volEnv += (targetVol - this.volEnv) * k;

    // 현재 파형 스냅샷 × 엔벨로프 → 침묵에선 평평한 선, 발화하면 즉시 부풀어오름
    const w = f.waveform;
    if (w && w.length > 0) {
      const target = p.historyLen ?? 1024;
      const snap = new Array<number>(target);
      for (let i = 0; i < target; i++) {
        const srcIdx = Math.floor((i * w.length) / target);
        const v = (w[srcIdx] - 128) / 128;
        snap[i] = Math.max(-1, Math.min(1, v * gain * this.volEnv));
      }
      this.history = snap;
    }

    // 발화 중엔 실시간으로 portrait 버퍼에 한 줄씩 누적
    if (f.isSpeaking) this.lastVoiceAt = now;
    if (this.volEnv > 0.02) this.paintPortraitLive();

    // 세션 갭 넘으면 portrait 커서에 여백 주어 세션 간 시각 구분
    if (this.sessionActive && now - this.lastVoiceAt > gapMs) {
      this.portraitCursorY += 24; // gap separator
      this.sessionActive = false;
    }
    if (f.isSpeaking && !this.sessionActive) this.sessionActive = true;

    this.render(false);
  }

  updateIdle() {
    this.time += 1 / 60;
    this.idleT += 1 / 60;
    // idle: 가로 전체에 걸쳐 낮은 진폭 사인파(느리게 위상 이동)
    const amp = (this.params.idleAmplitude ?? 0.08);
    const target = this.params.historyLen ?? 1024;
    const snap = new Array<number>(target);
    const cycles = 2.4;
    for (let i = 0; i < target; i++) {
      const t = i / target;
      snap[i] = Math.sin(t * Math.PI * 2 * cycles + this.idleT * 0.8) * amp
             + (Math.random() - 0.5) * amp * 0.15;
    }
    this.history = snap;
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
    this.sessionActive = false;
    this.volEnv = 0;
  }

  triggerSpecialEvent(_word: TriggerWord) {
    // TODO(task 64/65): 오실로스코프 버전에서의 키워드 이펙트 재설계 대기
    // 현재는 no-op (다음 update에서 파형 스냅샷이 덮어쓰므로 영향 없음)
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
      // 가우시안 7탭 커널 (1,6,15,20,15,6,1 / 64) + 인접 중점 경유 quadratic
      const smooth = (i: number) => {
        const h = this.history;
        const g = (off: number) => h[Math.max(0, Math.min(len - 1, i + off))];
        return (g(-3) + g(3)) * (1 / 64)
             + (g(-2) + g(2)) * (6 / 64)
             + (g(-1) + g(1)) * (15 / 64)
             +  g(0)          * (20 / 64);
      };
      const pt = (i: number) => ({ x: i * step, y: midY - smooth(i) * (H * 0.38) });
      let prev = pt(0);
      ctx.moveTo(prev.x, prev.y);
      for (let i = 1; i < len - 1; i++) {
        const cur = pt(i);
        const mx = (prev.x + cur.x) / 2;
        const my = (prev.y + cur.y) / 2;
        ctx.quadraticCurveTo(prev.x, prev.y, mx, my);
        prev = cur;
      }
      const last = pt(len - 1);
      ctx.quadraticCurveTo(prev.x, prev.y, last.x, last.y);
      ctx.stroke();
      ctx.restore();
    }

    // 체험 화면으로 복사
    this.ctx.drawImage(this.trailCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ── 세로 월페이퍼 라이브 누적 ──
  // 발화 중 매 프레임 한 줄(가로 파형 → 세로 중앙에 얇은 스캔라인)을 portrait에 그리고
  // 커서를 pixelAdvance 만큼 내려 시간축을 세로 방향으로 누적한다
  private paintPortraitLive() {
    const buf = this.portraitBuffer;
    const bctx = this.portraitCtx;
    const pixelAdvance = 2.0; // 프레임당 세로 진행 (60fps × 2px ≈ 120px/s)

    // 공간 부족 시 위로 스크롤
    if (this.portraitCursorY + pixelAdvance > buf.height - 40) {
      const shift = buf.height * 0.25;
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
    const marginX = 80;
    const drawW = W - marginX * 2;
    // 이번 프레임의 파형을 가로 방향으로 압축 — 세로 폭(진폭)만 표현
    let peak = 0;
    for (const v of this.history) if (Math.abs(v) > peak) peak = Math.abs(v);
    const halfAmp = peak * 160; // 세로 진폭 스케일 (픽셀)
    const cx = W / 2;
    const y = this.portraitCursorY;

    bctx.save();
    bctx.strokeStyle = `hsl(${h}, ${s}%, ${Math.max(25, l - 25)}%)`;
    bctx.lineCap = 'round';
    // 얇은 수평 스캔 라인: 중앙에서 좌우로 진폭에 비례하는 폭
    bctx.lineWidth = 1.4;
    bctx.beginPath();
    bctx.moveTo(cx - halfAmp, y);
    bctx.lineTo(cx + halfAmp, y);
    bctx.stroke();
    // 파형 shape도 살짝 겹쳐 그려 텍스처감 — 가로 파장의 존재 암시
    bctx.globalAlpha = 0.35;
    bctx.lineWidth = 0.8;
    bctx.beginPath();
    const len = this.history.length;
    for (let i = 0; i < len; i += 4) {
      const x = marginX + (i / len) * drawW;
      const yy = y + this.history[i] * 6;
      if (i === 0) bctx.moveTo(x, yy); else bctx.lineTo(x, yy);
    }
    bctx.stroke();
    bctx.restore();

    this.portraitCursorY += pixelAdvance;
  }

  // ── Export ──────────────────────────────────────────────────
  toDataURL(): string {
    // 가로(체험) 이미지 — 현재 trail 상태 그대로
    return this.trailCanvas.toDataURL('image/png');
  }

  toPortraitDataURL(w = 1080, h = 2340): string {
    // 발화가 없었으면 portraitBuffer가 비어 있을 수 있음 → 그대로 흰 배경 반환
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
