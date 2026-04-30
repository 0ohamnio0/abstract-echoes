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

// ── 피치 컬러 팔레트 ─────────────────────────────────────────────
// 기본(아동/일반): 5-band 비비드 (저음 blue → 고음 red)
// 성인 모드: 4-key 톤다운 — 디프 블루 / 모브 / 머스타드 / 버건디
interface ColorStop { pitch: number; h: number; s: number; l: number; }

export type PalettePreset = 'default' | 'adult';

const PALETTES: Record<PalettePreset, ColorStop[]> = {
  default: [
    { pitch:  80, h: 220, s: 90, l: 55 }, // 저  파랑
    { pitch: 180, h: 180, s: 85, l: 50 }, // 중저 청록
    { pitch: 280, h:  80, s: 80, l: 55 }, // 중  연녹
    { pitch: 400, h:  25, s: 95, l: 55 }, // 중고 주황
    { pitch: 600, h:   0, s: 90, l: 55 }, // 고  빨강
  ],
  adult: [
    { pitch: 100, h: 215, s: 55, l: 42 }, // 저  딥 블루
    { pitch: 220, h: 280, s: 35, l: 50 }, // 중저 모브
    { pitch: 360, h:  40, s: 60, l: 50 }, // 중고 머스타드
    { pitch: 550, h: 350, s: 55, l: 42 }, // 고  버건디
  ],
};

function pitchToHsl(pitch: number, preset: PalettePreset = 'default'): [number, number, number] {
  const stops = PALETTES[preset];
  if (pitch <= stops[0].pitch) {
    const s = stops[0]; return [s.h, s.s, s.l];
  }
  const last = stops[stops.length - 1];
  if (pitch >= last.pitch) return [last.h, last.s, last.l];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
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
  private preset: PalettePreset = 'default';

  constructor(gapMs = 2000) { this.sessionGapMs = gapMs; }
  setGapMs(ms: number) { this.sessionGapMs = ms; }
  setPreset(p: PalettePreset) {
    if (this.preset !== p) {
      this.preset = p;
      // 활성 세션이 있다면 즉시 새 팔레트로 갱신
      if (this.pitchSamples.length > 0) {
        const sorted = [...this.pitchSamples].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        this.currentHsl = pitchToHsl(median, p);
      } else {
        this.currentHsl = null;
      }
    }
  }

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
      this.currentHsl = pitchToHsl(median, this.preset);
    } else if (!this.currentHsl) {
      this.currentHsl = pitchToHsl(f.pitch, this.preset);
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

// ── 타임라인 상수 ─────────────────────────────────────────────────
const SESSION_CAP_MS = 30_000;   // 30초 — 9차 합의: cap 도달 시 showcase phase 자동 진입
const LIVE_PORTION = 0.6;          // 화면 오른쪽 라이브 영역 비율 (최근 3초)
const LIVE_WINDOW_MS = 3000;      // 라이브 영역에 매핑되는 최근 시간
const DOWNSAMPLE_PER_FRAME = 8;   // 프레임당 누적 샘플 개수 (waveform에서 다운샘플)


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
  private sliceFrameCounter = 0;     // legacy 스로틀링 (남겨둠, 영향 없음)
  private sessionActive = false;     // 세션 중 여부 (portrait 세션 간 여백 삽입용)

  private history: number[] = [];    // 최근 N 샘플 (waveform amplitude -1~1)
  private time = 0;
  private idle = false;
  private idleT = 0;
  private session: SessionColorTracker;
  private volEnv = 0;                // 볼륨 엔벨로프 (0..1, attack/release 적용)
  private lastVoiceAt = -Infinity;   // 마지막 발화 시각 (ms)

  // ── 세션 타임라인 (체험 화면 누적) ──
  // 매 프레임 waveform을 DOWNSAMPLE_PER_FRAME개로 다운샘플해 raw amplitude 시계열로 누적.
  // 왼쪽 40% = 세션 시작~3s전 압축 (decimate), 오른쪽 60% = 최근 3초 라이브. 둘 다 동일 가우시안+bloom.
  // 10분 상한 도달 시 멈추고 안내 메시지 노출.
  private sessionAmps: number[] = [];
  // sessionAmps와 1:1 대응. 각 샘플 시점의 hue(-1=세션 기본, 0..360=트리거 색)
  // showcase 프린트에서 bucket 내 트리거 hue 발견 시 해당 stroke에 색 override
  private sessionHues: number[] = [];
  private sessionFrameTimes: number[] = [];
  private sessionStartMs = 0;
  private sessionCapped = false;

  // 레거시 API 유지용 — 튜닝 패널이 채우는 자리
  public params: OscParams = {};

  // 클라 브랜딩 footer — 로고와 태그라인 분리 에셋
  private logoImg: HTMLImageElement;
  private taglineImg: HTMLImageElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;

    this.trailCanvas = document.createElement('canvas');
    this.trailCanvas.width = canvas.width;
    this.trailCanvas.height = canvas.height;
    this.trailCtx = this.trailCanvas.getContext('2d', { alpha: false })!;
    this.trailCtx.fillStyle = '#000000';
    this.trailCtx.fillRect(0, 0, canvas.width, canvas.height);

    // 세로 월페이퍼: 처음엔 가로×세로 비율 기반, 실제 export는 getter에서 사이즈 조정
    this.portraitBuffer = document.createElement('canvas');
    this.portraitBuffer.width = 1080;
    this.portraitBuffer.height = 2340;
    this.portraitCtx = this.portraitBuffer.getContext('2d', { alpha: false })!;
    this.portraitCtx.fillStyle = '#000000';
    this.portraitCtx.fillRect(0, 0, this.portraitBuffer.width, this.portraitBuffer.height);
    this.portraitCursorY = 40;

    this.session = new SessionColorTracker(2000);
    this.history = new Array(1024).fill(0);

    this.logoImg = new Image();
    this.logoImg.src = '/bremen-logo.png';
    this.taglineImg = new Image();
    this.taglineImg.src = '/bremen-tagline.svg';
  }

  // ── 외부 API (SoundCanvas.tsx가 호출) ─────────────────────────
  setIdleMode(on: boolean) { this.idle = on; }
  setPalette(p: PalettePreset) { this.session.setPreset(p); }

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

    if (f.isSpeaking) this.lastVoiceAt = now;

    // 세션 갭 넘으면 portrait 커서 여백 + 타임라인 종료
    if (this.sessionActive && now - this.lastVoiceAt > gapMs) {
      this.portraitCursorY += 24; // gap separator
      this.sessionActive = false;
    }
    // 새 세션 시작 — 타임라인 리셋
    if (f.isSpeaking && !this.sessionActive) {
      this.sessionActive = true;
      this.sessionAmps = [];
      this.sessionHues = [];
      this.sessionFrameTimes = [];
      this.sessionStartMs = now;
      this.sessionCapped = false;
    }

    // 세션 중 매 프레임 타임라인 append (침묵 <2s 구간도 평탄 샘플로 기록)
    if (this.sessionActive && !this.sessionCapped) {
      if (now - this.sessionStartMs >= SESSION_CAP_MS) {
        this.sessionCapped = true;
      } else {
        const histLen = this.history.length;
        for (let i = 0; i < DOWNSAMPLE_PER_FRAME; i++) {
          const idx = Math.floor(((i + 0.5) * histLen) / DOWNSAMPLE_PER_FRAME);
          this.sessionAmps.push(this.history[idx] ?? 0);
          this.sessionHues.push(-1);
        }
        this.sessionFrameTimes.push(now);
      }
    }

    this.render(false);
  }

  // listening 시 WebGL(woscope) 렌더러 사용 경로 — 타임라인만 갱신, Canvas 2D 렌더 스킵
  // frameHue: 이번 프레임 새로 push되는 샘플의 hue 태그 (-1=세션 기본, 0..360=이스터에그 트리거 색)
  updateTimelineOnly(f: AudioFeatures, frameHue: number = -1) {
    this.time += 1 / 60;
    const p = this.params;
    const gapMs = p.sessionGapMs ?? 2000;
    this.session.setGapMs(gapMs);

    const now = performance.now();
    this.session.feed(f, now);

    const gain = p.waveformGain ?? 1.6;
    const targetVol = f.isSpeaking ? Math.min(1, f.volume * 3) : 0;
    const attack = 0.35, release = 0.08;
    const k = targetVol > this.volEnv ? attack : release;
    this.volEnv += (targetVol - this.volEnv) * k;

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

    if (f.isSpeaking) this.lastVoiceAt = now;

    // 9차 합의: 한 사이클 = 한 engine 인스턴스 구조라 silence gap 기반 session reset 불필요.
    // 체험 시작(첫 update)부터 cap까지 매 프레임 sessionAmps push — silence 구간도 연속 기록되어
    // showcase에서 30초 전체 waveform이 가로 전역에 균등 분포됨 (침묵은 y≈0)
    if (!this.sessionActive && !this.sessionCapped) {
      this.sessionActive = true;
      this.sessionAmps = [];
      this.sessionHues = [];
      this.sessionFrameTimes = [];
      this.sessionStartMs = now;
    }

    if (this.sessionActive && !this.sessionCapped) {
      if (now - this.sessionStartMs >= SESSION_CAP_MS) {
        this.sessionCapped = true;
      } else {
        const histLen = this.history.length;
        for (let i = 0; i < DOWNSAMPLE_PER_FRAME; i++) {
          const idx = Math.floor(((i + 0.5) * histLen) / DOWNSAMPLE_PER_FRAME);
          this.sessionAmps.push(this.history[idx] ?? 0);
          this.sessionHues.push(frameHue);
        }
        this.sessionFrameTimes.push(now);
      }
    }
  }

  // Woscope 렌더러가 샘플링하기 위한 getter
  getSessionAmps(): number[] { return this.sessionAmps; }
  getSessionHues(): number[] { return this.sessionHues; }
  getSessionFrameTimes(): number[] { return this.sessionFrameTimes; }
  getSessionStartMs(): number { return this.sessionStartMs; }
  getLivePortion(): number { return LIVE_PORTION; }
  getLiveWindowMs(): number { return LIVE_WINDOW_MS; }
  getDownsamplePerFrame(): number { return DOWNSAMPLE_PER_FRAME; }

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
    this.trailCtx.fillStyle = '#000000';
    this.trailCtx.fillRect(0, 0, this.trailCanvas.width, this.trailCanvas.height);
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    // portrait도 리셋
    this.portraitCtx.fillStyle = '#000000';
    this.portraitCtx.fillRect(0, 0, this.portraitBuffer.width, this.portraitBuffer.height);
    this.portraitCursorY = 40;
    this.sliceFrameCounter = 0;
    this.sessionActive = false;
    this.sessionAmps = [];
    this.sessionHues = [];
    this.sessionFrameTimes = [];
    this.sessionStartMs = 0;
    this.sessionCapped = false;
    this.volEnv = 0;
  }

  isSessionCapped(): boolean {
    return this.sessionCapped;
  }

  isSessionActive(): boolean {
    return this.sessionActive;
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

    if (isIdle) {
      this.renderIdleWave(ctx, W, H);
    } else {
      this.renderSessionTimeline(ctx, W, H);
    }

    // 체험 화면으로 복사
    this.ctx.drawImage(this.trailCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // idle: 기존 bloom 웨이브 (history 풀 스캔)
  private renderIdleWave(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const decay = this.params.trailDecay ?? 0.22;
    ctx.save();
    ctx.globalAlpha = decay;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const [h, s, l] = this.session.getHsl();
    const core = this.params.lineCore ?? 1.5;
    const bloomBase = this.params.bloomIntensity ?? 16;
    const passes = Math.max(1, Math.min(4, Math.floor(this.params.bloomPasses ?? 3)));
    const midY = H / 2;
    const len = this.history.length;
    const step = W / len;

    for (let pass = passes; pass >= 0; pass--) {
      ctx.save();
      if (pass === 0) {
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
        ctx.globalAlpha = 0.25;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      const smooth = (i: number) => {
        const hist = this.history;
        const g = (off: number) => hist[Math.max(0, Math.min(len - 1, i + off))];
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
  }

  // listening: 왼쪽 40%(과거) + 오른쪽 60%(최근 3초). 두 영역 모두 가우시안+bloom wiggle 렌더.
  private renderSessionTimeline(ctx: CanvasRenderingContext2D, W: number, H: number) {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);

    const amps = this.sessionAmps;
    if (amps.length === 0) return;

    const midY = H / 2;
    const ampScale = H * 0.38;
    const now = performance.now();
    const liveW = Math.max(1, Math.round(W * LIVE_PORTION));
    const pastW = Math.max(0, W - liveW);
    const liveCutoff = now - LIVE_WINDOW_MS;

    // liveCutoff 이후 첫 frame index → sample split
    const frameTimes = this.sessionFrameTimes;
    let splitFrame = frameTimes.length;
    for (let i = 0; i < frameTimes.length; i++) {
      if (frameTimes[i] >= liveCutoff) { splitFrame = i; break; }
    }
    const splitSample = Math.min(amps.length, splitFrame * DOWNSAMPLE_PER_FRAME);

    if (pastW > 0 && splitSample > 0) {
      this.paintWaveRegion(ctx, amps, 0, splitSample, 0, pastW, midY, ampScale);
    }
    if (splitSample < amps.length) {
      this.paintWaveRegion(ctx, amps, splitSample, amps.length, pastW, liveW, midY, ampScale);
    }
  }

  // bucket별 min-max pair → 가우시안 7탭 스무스 → bloom pass로 상하 envelope 두 path 그리기
  private paintWaveRegion(
    ctx: CanvasRenderingContext2D,
    amps: number[],
    sStart: number,
    sEnd: number,
    xOff: number,
    regionW: number,
    midY: number,
    ampScale: number,
  ) {
    const n = sEnd - sStart;
    if (n <= 0 || regionW <= 0) return;

    // pixel당 최대 2 pt. 샘플 수가 더 많으면 bucket별 min/max 추출
    const targetPts = Math.max(2, Math.min(n, regionW * 2));
    const ptsMax = new Array<number>(targetPts);
    const ptsMin = new Array<number>(targetPts);
    if (targetPts === n) {
      for (let i = 0; i < n; i++) {
        ptsMax[i] = amps[sStart + i];
        ptsMin[i] = amps[sStart + i];
      }
    } else {
      for (let i = 0; i < targetPts; i++) {
        const from = sStart + Math.floor((i * n) / targetPts);
        const to = sStart + Math.max(from + 1, Math.floor(((i + 1) * n) / targetPts));
        let vmax = amps[from], vmin = amps[from];
        for (let j = from + 1; j < to; j++) {
          const v = amps[j];
          if (v > vmax) vmax = v;
          if (v < vmin) vmin = v;
        }
        ptsMax[i] = vmax;
        ptsMin[i] = vmin;
      }
    }

    const [h, s, l] = this.session.getHsl();
    const core = this.params.lineCore ?? 1.5;
    const bloomBase = this.params.bloomIntensity ?? 16;
    const passes = Math.max(1, Math.min(4, Math.floor(this.params.bloomPasses ?? 3)));
    const step = regionW / targetPts;

    const smoothAt = (arr: number[], i: number) => {
      const g = (off: number) => arr[Math.max(0, Math.min(targetPts - 1, i + off))];
      return (g(-3) + g(3)) * (1 / 64)
           + (g(-2) + g(2)) * (6 / 64)
           + (g(-1) + g(1)) * (15 / 64)
           +  g(0)          * (20 / 64);
    };
    const strokeEnvelope = (arr: number[]) => {
      ctx.beginPath();
      const ptX = (i: number) => xOff + i * step;
      const ptY = (i: number) => midY - smoothAt(arr, i) * ampScale;
      let px = ptX(0), py = ptY(0);
      ctx.moveTo(px, py);
      for (let i = 1; i < targetPts - 1; i++) {
        const cx = ptX(i), cy = ptY(i);
        const mx = (px + cx) / 2, my = (py + cy) / 2;
        ctx.quadraticCurveTo(px, py, mx, my);
        px = cx; py = cy;
      }
      const lx = ptX(targetPts - 1), ly = ptY(targetPts - 1);
      ctx.quadraticCurveTo(px, py, lx, ly);
      ctx.stroke();
    };

    for (let pass = passes; pass >= 0; pass--) {
      ctx.save();
      // dood.al/woscope 룩: phosphor additive blend — 겹치면 밝아짐
      ctx.globalCompositeOperation = 'lighter';
      if (pass === 0) {
        // 코어: 매우 얇고 밝은 스트로크 (CRT 빔 중심)
        ctx.strokeStyle = `hsl(${h}, ${Math.min(100, s + 10)}%, ${Math.min(95, l + 35)}%)`;
        ctx.lineWidth = core;
        ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.shadowBlur = bloomBase * 0.5;
        ctx.globalAlpha = 1;
      } else {
        ctx.strokeStyle = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.lineWidth = core + pass * 1.4;
        ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
        ctx.shadowBlur = bloomBase * pass * 1.2;
        ctx.globalAlpha = 0.35 / pass;
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokeEnvelope(ptsMax);
      strokeEnvelope(ptsMin);
      ctx.restore();
    }
  }

  // ── QR 월페이퍼 세팅 (호출 시점에 1회) ──
  // 체험 화면의 glCanvas(가로 시간축 네온 envelope 라인이 그려진 상태)를 90° 시계 회전 +
  // cover fit으로 portraitBuffer에 그림. 정보 손실 없음, dood 라인 질감 그대로.
  setPortraitFromGL(gl: HTMLCanvasElement) {
    const buf = this.portraitBuffer;
    const bctx = this.portraitCtx;

    bctx.fillStyle = '#000000';
    bctx.fillRect(0, 0, buf.width, buf.height);

    const scale = Math.max(buf.width / gl.height, buf.height / gl.width);

    bctx.save();
    bctx.translate(buf.width / 2, buf.height / 2);
    bctx.rotate(Math.PI / 2);
    bctx.scale(scale, scale);
    bctx.drawImage(gl, -gl.width / 2, -gl.height / 2);
    bctx.restore();
  }

  // ── Export ──────────────────────────────────────────────────
  toDataURL(): string {
    // 가로(체험) 이미지 — 현재 trail 상태 그대로
    return this.trailCanvas.toDataURL('image/png');
  }

  async toPortraitDataURL(
    opts: { w?: number; h?: number; logoScale?: number; taglineScale?: number; tagOffsetY?: number } = {},
  ): Promise<string> {
    const { w = 1080, h = 2340, logoScale = 1, taglineScale = 1, tagOffsetY = 0 } = opts;
    // 로고/태그라인 비동기 로드 보장 — 호출 시점에 아직 안 떠 있으면 기다림
    try {
      await Promise.all([
        this.logoImg.decode().catch(() => {}),
        this.taglineImg.decode().catch(() => {}),
      ]);
    } catch { /* 실패해도 진행 — 아래에서 ready 체크 */ }

    // 발화가 없었으면 portraitBuffer가 비어 있을 수 있음 → 그대로 검정 배경 반환
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d')!;
    o.fillStyle = '#000000';
    o.fillRect(0, 0, w, h);
    // 하단 브랜딩 영역 먼저 계산 → 그 위까지만 파형이 차지하도록 contain-fit
    const logoReady = this.logoImg.complete && this.logoImg.naturalWidth > 0;
    const taglineReady = this.taglineImg.complete && this.taglineImg.naturalWidth > 0;

    // rina 4-30 spec (download 화면 로고위치 수정.svg, 1080×2340 viewBox 기준)
    //   - 로고 폭 55.27 / 1080 = 5.12% (PNG 자연 비율로 높이 자동)
    //   - 태그라인 폭 426.39 / 1080 = 39.5% (SVG 자연 비율로 높이 자동)
    //   - 로고 top y = 1686.93 / 2340 = 72.1%, 태그라인 bottom y = 1888.23 / 2340 = 80.7%
    // 4-30 후속 — logoScale/taglineScale로 base 폭에 배율, tagOffsetY(h 비율)로 태그라인 y 미세조정
    let waveAreaH = h;
    let blockTopY = h;
    let logoDstW = 0, logoDstH = 0, taglineDstW = 0, taglineDstH = 0;
    let logoDstY = 0, taglineDstY = 0;
    const padAboveLogo = Math.round(h * 0.03); // 로고 위 추가 여백

    if (logoReady && taglineReady) {
      taglineDstW = w * (426.39 / 1080) * taglineScale;
      taglineDstH = taglineDstW * (this.taglineImg.naturalHeight / this.taglineImg.naturalWidth);
      taglineDstY = h * (1888.23 / 2340) - taglineDstH + h * tagOffsetY;

      logoDstW = w * (55.27 / 1080) * logoScale;
      logoDstH = logoDstW * (this.logoImg.naturalHeight / this.logoImg.naturalWidth);
      logoDstY = h * (1686.93 / 2340);

      blockTopY = logoDstY;
      waveAreaH = blockTopY - padAboveLogo;
    }

    // portraitBuffer를 (w × waveAreaH) 영역에 contain-fit
    const srcRatio = this.portraitBuffer.width / this.portraitBuffer.height;
    const waveRatio = w / waveAreaH;
    let dw = w, dh = waveAreaH, dx = 0, dy = 0;
    if (srcRatio > waveRatio) {
      dh = w / srcRatio;
      dy = (waveAreaH - dh) / 2;
    } else {
      dw = waveAreaH * srcRatio;
      dx = (w - dw) / 2;
    }
    o.drawImage(this.portraitBuffer, dx, dy, dw, dh);

    if (logoReady && taglineReady) {
      const logoDstX = (w - logoDstW) / 2;
      const taglineDstX = (w - taglineDstW) / 2;
      o.drawImage(this.logoImg, logoDstX, logoDstY, logoDstW, logoDstH);
      o.drawImage(this.taglineImg, taglineDstX, taglineDstY, taglineDstW, taglineDstH);
    }

    return out.toDataURL('image/png');
  }
}
