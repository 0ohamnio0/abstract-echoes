import { useRef, useEffect, useLayoutEffect, useState, useCallback, type CSSProperties } from 'react';
import { createNoise3D } from 'simplex-noise';
import { QRCodeSVG } from 'qrcode.react';
import { AudioAnalyzer, SoundType } from '@/lib/audioAnalyzer';
import { GenerativeEngine } from '@/lib/generativeEngine';
import { InstrumentEngine } from '@/lib/instrumentEngine';
import { Oscilloscope, waveformFloatToXY } from '@/lib/oscilloscope';
import { createDefaultParams, extractValues, TuningParams, ParamDef } from '@/lib/tuningParams';
import { SpeechTrigger, type TriggerWord } from '@/lib/speechTrigger';
import TuningPanel from './TuningPanel';
import OscilloscopePanel, { type SignalGenSettings } from './OscilloscopePanel';
import PrintTuningPanel from './PrintTuningPanel';

const IMGBB_API_KEY = '807140906d6d0c3c9a3b83ec99c22d74';
const QR_VIEWER_BASE = typeof window !== 'undefined' ? `${window.location.origin}/viewer.html` : '/viewer.html';

async function uploadToImgbb(dataUrl: string): Promise<string> {
  const base64 = dataUrl.split(',')[1];
  const form = new FormData();
  form.append('image', base64);
  const res = await fetch(`https://api.imgbb.com/1/upload?key=${IMGBB_API_KEY}`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`imgbb upload failed: ${res.status}`);
  const json = await res.json();
  return json.data.url;
}

interface QrData {
  url: string;
  countdown: number;
}

const STORAGE_KEY = 'soundcanvas-tuning-params';
const PRINT_STORAGE_KEY = 'soundcanvas-print-params';

function loadPrintParams(): PrintParams {
  try {
    const stored = localStorage.getItem(PRINT_STORAGE_KEY);
    if (!stored) return { ...DEFAULT_PRINT_PARAMS };
    const parsed = JSON.parse(stored) as Partial<PrintParams>;
    return { ...DEFAULT_PRINT_PARAMS, ...parsed };
  } catch {
    return { ...DEFAULT_PRINT_PARAMS };
  }
}

function savePrintParams(p: PrintParams) {
  try { localStorage.setItem(PRINT_STORAGE_KEY, JSON.stringify(p)); } catch {}
}

function loadParams(): TuningParams {
  const defaults = createDefaultParams();
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return defaults;
    const values = JSON.parse(stored) as Record<string, number>;
    for (const key of Object.keys(defaults)) {
      if (key in values) {
        (defaults as any)[key].value = values[key];
      }
    }
    return defaults;
  } catch {
    return defaults;
  }
}

function saveParams(params: TuningParams) {
  const obj: Record<string, number> = {};
  for (const [key, def] of Object.entries(params)) {
    obj[key] = (def as ParamDef).value;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
}

const CANVAS_WIDTH = 1720;
const CANVAS_HEIGHT = 1302;

// 설치 기준 해상도 — WebGL drawingBuffer 고정, CSS로 display stretch
const GL_RENDER_WIDTH = 1720;
const GL_RENDER_HEIGHT = 1032;

const ASSET6_VB = { w: 873.1, h: 601.8 } as const;

type StackStage = { w: number; h: number; scale: number };

const STACK_STAGE_VP_W_FRAC = 1.0;
const STACK_STAGE_VP_H_FRAC = 0.98;

function measureStackStage(): StackStage {
  if (typeof window === 'undefined') {
    const scale = 1;
    return { scale, w: ASSET6_VB.w * scale, h: ASSET6_VB.h * scale };
  }
  const maxW = window.innerWidth * STACK_STAGE_VP_W_FRAC;
  const maxH = window.innerHeight * STACK_STAGE_VP_H_FRAC;
  const scale = Math.min(maxW / ASSET6_VB.w, maxH / ASSET6_VB.h);
  return { scale, w: ASSET6_VB.w * scale, h: ASSET6_VB.h * scale };
}

function stackOffsetPx(cx: number, cy: number, stage: StackStage) {
  return {
    sx: (cx / ASSET6_VB.w - 0.5) * stage.w,
    sy: (cy / ASSET6_VB.h - 0.5) * stage.h,
  };
}

const ASSET6_CX = ASSET6_VB.w / 2;

const INTRO_BEAST_CONFIG = [
  {
    src: '/intro-stack-2.svg',
    stackHFrac: 89.2 / ASSET6_VB.h,
    stackCx: ASSET6_CX,
    stackCy: 164,
    fx: -480,
    fy: -150,
    fr: -10,
    fs: 1,
    ox: -2800,
    oy: -2400,
    orDeg: -16,
    os: 1.06,
    sr: 0,
    ss: 1,
    stackDelayMs: 280,
  },
  {
    src: '/intro-stack-4.svg',
    stackHFrac: 83.1 / ASSET6_VB.h,
    stackCx: ASSET6_CX,
    stackCy: 421,
    fx: 420,
    fy: -130,
    fr: 9,
    fs: 1,
    ox: 2800,
    oy: -2350,
    orDeg: 14,
    os: 1.04,
    sr: 0,
    ss: 1,
    stackDelayMs: 0,
  },
  {
    src: '/intro-stack-3.svg',
    stackHFrac: 83 / ASSET6_VB.h,
    stackCx: ASSET6_CX,
    stackCy: 335,
    fx: -400,
    fy: 200,
    fr: 7,
    fs: 1,
    ox: -2750,
    oy: 2550,
    orDeg: 10,
    os: 1.05,
    sr: 0,
    ss: 1,
    stackDelayMs: 190,
  },
  {
    src: '/intro-stack-1.svg',
    stackHFrac: 85.4 / ASSET6_VB.h,
    stackCx: ASSET6_CX,
    stackCy: 251,
    fx: 400,
    fy: 235,
    fr: -8,
    fs: 1,
    ox: 2750,
    oy: 2600,
    orDeg: -12,
    os: 1.08,
    sr: 0,
    ss: 1,
    stackDelayMs: 95,
  },
] as const;

type Phase = 'idle' | 'intro' | 'listening' | 'showcase';

// Showcase: 체험 종료 후 LED 전면에 프레임화된 결과를 노출하는 단계
// (a) 30초 cap 도달 자동 진입  (b) B 버튼 조기 종료
const SHOWCASE_DURATION_MS = 20_000;
// 체험(listening) 세션 cap — engine SESSION_CAP_MS와 동일 (30초)
const SESSION_CAP_SECONDS = 30;

// 9차 합의 — 단어별 컬러 이스터에그. 체험 중 트리거 단어 인식 시 history의 해당 구간
// 0.3초 정도만 고유 hue로 칠해지고 세션 기본 hue로 자연 복귀. 인스타 "숨은 색 찾아보세요" 훅.
const TRIGGER_HUE_MAP: Record<TriggerWord, number> = {
  love: 330,    // 핑크
  hello: 55,    // 옐로
  happy: 30,    // 오렌지
  wow: 0,       // 레드
  thanks: 130,  // 그린
  sorry: 210,   // 블루
  missyou: 270, // 퍼플
};

// 한 트리거의 컬러 페인트 지속 시간 (샘플 수 기준, 프레임당 24샘플 기준 15프레임 ≈ 0.25초)
const TRIGGER_PAINT_FRAMES = 18;

// showcase 오실로스코프 sweep 튜닝 파라미터 (4-29 후속 — 클라 피드백 "더 풍성하게").
//   - sweep 1회 렌더는 listening 누적 대비 얇아 보임 → passes(누적), 진폭/두께 배율로 보완
//   - lineSizeMul/intensityMul은 listening shader 값에 곱해서 적용 후 원복 → listening 톤 비영향
export interface PrintParams {
  ampScale: number;       // ySweep 진폭 (0.2..1.5)
  widthBase: number;      // 라인 두께 base (0.3..2.0)
  widthBoost: number;     // amp 비례 두께 부스트 (0.5..3.0)
  lineSizeMul: number;    // oscilloscope lineSize 배율 (0.5..3.0)
  intensityMul: number;   // intensity 배율 (0.5..3.0)
  passes: number;         // 멀티패스 누적 (1..6)
  // 5-06 rina (260506 download 화면 로고위치 수정.svg) — portrait(QR 다운로드 화면) 로고/태그라인 layout
  logoScale: number;      // 동물(하단) 로고 폭 배율 (base 8.32% × scale)
  taglineScale: number;   // "Sounds Bremen" 태그라인 폭 배율 (base 23.92% × scale)
  tagOffsetY: number;     // 태그라인 y 오프셋 (h 비율)
  banwonScale: number;    // 상단 OH!BREMEN(반원) 로고 폭 배율 (base 72% × scale)
  banwonOffsetY: number;  // 상단 로고 y 오프셋 (h 비율)
  banwonGap: number;      // 상단 로고와 음성 파형 사이 여백 (h 비율)
  logoOffsetY: number;    // 하단 로고 y 오프셋 (h 비율)
}

// 5-06 rina spec + 해민 패널 튜닝 최종값 (감독님 시연 확정, 최종 배포 디폴트).
export const DEFAULT_PRINT_PARAMS: PrintParams = {
  ampScale: 4.0,
  widthBase: 1.3,
  widthBoost: 1.9,
  lineSizeMul: 0.5,
  intensityMul: 2.65,
  passes: 4,
  logoScale: 1.10,
  taglineScale: 1.30,
  tagOffsetY: 0.125,
  banwonScale: 0.44,
  banwonOffsetY: 0.005,
  banwonGap: -0.010,
  logoOffsetY: 0.115,
};

/**
 * (legacy) 오실로스코프 WebGL 캔버스를 "파형만 알파 채널로 분리된 투명 PNG"로 변환.
 * showcase 리뉴얼(sound wave print) 이후 미사용 — 필요 시 롤백용으로 유지.
 */
// @ts-expect-error — 보관용, 빌드 시 미참조
async function toAlphaPng(gl: HTMLCanvasElement): Promise<string> {
  const rgbaDataUrl = gl.toDataURL('image/png');
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image load failed'));
    img.src = rgbaDataUrl;
  });
  const c = document.createElement('canvas');
  c.width = gl.width;
  c.height = gl.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2d context unavailable');
  ctx.drawImage(img, 0, 0);
  const imageData = ctx.getImageData(0, 0, c.width, c.height);
  const data = imageData.data;
  // 진한 색 정책:
  //  - 각 픽셀의 rgb를 max채널=255로 정규화 → shader에서 grain × brightness로 흐려진 tint를 원색 포화 상태로 복원
  //  - alpha는 luma 기반 gamma boost(0.38 — 약한 선도 충분히 불투명) × 360 scale
  //  - luma threshold 10 — phosphor grain 잔여물 완전 제거
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < 10) {
      data[i + 3] = 0;
      continue;
    }
    const m = Math.max(r, g, b);
    if (m > 0) {
      const scale = 255 / m;
      data[i] = Math.min(255, Math.round(r * scale));
      data[i + 1] = Math.min(255, Math.round(g * scale));
      data[i + 2] = Math.min(255, Math.round(b * scale));
    }
    const alphaNorm = Math.pow(luma / 255, 0.38);
    data[i + 3] = Math.min(255, Math.round(alphaNorm * 360));
  }
  ctx.putImageData(imageData, 0, 0);
  return c.toDataURL('image/png');
}

// 동물 SVG ↔ 사운드 매핑 (intro-stack-1~4 순서, INTRO_BEAST_CONFIG의 등장 순서와는 별개)
const BEAST_AUDIO: Record<string, string> = {
  '/intro-stack-1.svg': '/intro-audio/cat.wav',
  '/intro-stack-2.svg': '/intro-audio/rooster.wav',
  '/intro-stack-3.svg': '/intro-audio/dog.mp3',
  '/intro-stack-4.svg': '/intro-audio/footsteps.wav',
};

export default function SoundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasGLRef = useRef<HTMLCanvasElement>(null);
  const oscilloscopeRef = useRef<Oscilloscope | null>(null);
  // 세션 cap은 60초로 두되, 화면에는 최근 몇 초만 더 촘촘히 보여줘 즉시 반응을 만든다.
  const DISPLAY_HISTORY_SECONDS = 8;
  const HISTORY_SAMPLES_PER_FRAME = 24;
  const HISTORY_LEN = DISPLAY_HISTORY_SECONDS * 60 * HISTORY_SAMPLES_PER_FRAME;
  const historyXRef = useRef<Float32Array | null>(null);
  const historyYRef = useRef<Float32Array | null>(null);
  const historyHueRef = useRef<Float32Array | null>(null);  // per-sample hue (-1 = 세션 hue, 0..360 = 이스터에그 컬러)
  const historyIdxRef = useRef(0);
  // 현재 활성 트리거 컬러 페인트 상태 — 남은 프레임 수 동안 새 샘플에 트리거 hue 기록
  const activeTriggerRef = useRef<{ hue: number; framesRemaining: number } | null>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const engineRef = useRef<GenerativeEngine | null>(null);
  const instrumentRef = useRef<InstrumentEngine | null>(null);
  const speechRef = useRef<SpeechTrigger | null>(null);
  const animFrameRef = useRef<number>(0);
  const idleAnimFrameRef = useRef<number>(0);
  const modeIndicatorTimerRef = useRef<number>(0);
  const idleTitleHostRef = useRef<HTMLDivElement>(null);
  const idleTitleRafRef = useRef<number | null>(null);
  const introTimersRef = useRef<number[]>([]);
  const introAudioCacheRef = useRef<Record<string, HTMLAudioElement>>({});

  // 동물 사운드 프리로드
  useEffect(() => {
    const cache: Record<string, HTMLAudioElement> = {};
    for (const [svg, src] of Object.entries(BEAST_AUDIO)) {
      const a = new Audio(src);
      a.preload = 'auto';
      a.volume = 0.7;
      cache[svg] = a;
    }
    introAudioCacheRef.current = cache;
  }, []);

  /**
   * 트리거 단어 인식 시 재생하는 짧은 하모니움 톤 (D안 악기 결 맞춤).
   * InstrumentEngine의 당나귀=하모니움 PeriodicWave [1, 0.3, 0.1] 차용,
   * A 마이너 펜타토닉 (A4/C5/D5/E5/G5) 중 랜덤 한 음. 따뜻한 sine 중심 톤.
   */
  const playChime = useCallback(() => {
    try {
      let ctx = chimeCtxRef.current;
      if (!ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        chimeCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;

      // 하모니움 톤 — sine + 약한 옥타브 + 3rd harmonic
      const real = new Float32Array([0, 1, 0.3, 0.1]);
      const imag = new Float32Array([0, 0, 0, 0]);
      const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

      // A 마이너 펜타토닉 중 랜덤
      const pentatonic = [440, 523.25, 587.33, 659.25, 783.99];
      const freq = pentatonic[Math.floor(Math.random() * pentatonic.length)];

      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = freq;

      // 부드러운 low-pass로 상단 배음 다듬기
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 2600;
      filter.Q.value = 0.7;

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.13, now + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 1.0);
    } catch (e) {
      console.warn('tone playback failed', e);
    }
  }, []);

  /**
   * Showcase 진입 시 "따라란~" 3음 상행 아르페지오.
   * A 마이너 펜타토닉 E5→A5→C6, 하모니움 PeriodicWave [1,0.3,0.1] + feedback delay.
   * playChime(트리거 단어 1음)과 같은 톤 팔레트 — D안 사운드 결 일관성 유지.
   */
  const playShowcaseFlourish = useCallback(() => {
    try {
      let ctx = chimeCtxRef.current;
      if (!ctx) {
        const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AC) return;
        ctx = new AC();
        chimeCtxRef.current = ctx;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      const now = ctx.currentTime;

      // 하모니움 톤 (당나귀 악기 = playChime 레시피)
      const real = new Float32Array([0, 1, 0.3, 0.1]);
      const imag = new Float32Array([0, 0, 0, 0]);
      const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

      // InstrumentEngine과 동일 feedback delay 레시피 (0.22s · 0.42 · 4500Hz LP · 0.32 wet)
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.22;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.42;
      const delayTone = ctx.createBiquadFilter();
      delayTone.type = 'lowpass';
      delayTone.frequency.value = 4500;
      const wet = ctx.createGain();
      wet.gain.value = 0.32;
      delay.connect(delayTone);
      delayTone.connect(feedback);
      feedback.connect(delay);
      delay.connect(wet);
      wet.connect(ctx.destination);

      // 상행 아르페지오 E5 → A5 → C6 (A 마이너 펜타토닉 중 개운한 상행 3음)
      const notes = [659.25, 880.00, 1046.50];
      const interval = 0.12;

      notes.forEach((freq, i) => {
        const t = now + i * interval;
        const osc = ctx.createOscillator();
        osc.setPeriodicWave(wave);
        osc.frequency.value = freq;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 2600;
        filter.Q.value = 0.7;

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.15, t + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        gain.connect(delay);

        osc.start(t);
        osc.stop(t + 1.0);
      });
    } catch (e) {
      console.warn('showcase flourish failed', e);
    }
  }, []);

  const playBeastAudio = useCallback((svg: string) => {
    const a = introAudioCacheRef.current[svg];
    if (!a) return;
    try {
      // 매번 같은 elem을 처음부터 재생 (concurrent 재생이 필요하면 cloneNode)
      const inst = a.cloneNode(true) as HTMLAudioElement;
      inst.volume = a.volume;
      void inst.play().catch(() => {});
    } catch {}
  }, []);

  const [phase, setPhase] = useState<Phase>('idle');
  const [introStep, setIntroStep] = useState(0);
  const [introExiting, setIntroExiting] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [debugVolume, setDebugVolume] = useState(0);
  const [debugSpeaking, setDebugSpeaking] = useState(false);
  const [debugSoundType, setDebugSoundType] = useState<SoundType>('silence');
  const [yamnetLabel, setYamnetLabel] = useState('');
  const [yamnetConfidence, setYamnetConfidence] = useState(0);
  const [sensitivity, setSensitivity] = useState(0.4);
  const [threshold, setThreshold] = useState(0.06);
  const [showSettings, setShowSettings] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const [isKioskMode, setIsKioskMode] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !new URLSearchParams(window.location.search).has('settings');
  });
  const [modeIndicator, setModeIndicator] = useState(false);
  const [tuningParams, setTuningParams] = useState<TuningParams>(loadParams);
  // 청각 이스터에그 — 트리거 단어 인식 시 짧은 bell chime. 시각 텍스트는 숨김.
  const chimeCtxRef = useRef<AudioContext | null>(null);
  const debugFrameRef = useRef(0);
  const [stackStage, setStackStage] = useState<StackStage>(measureStackStage);
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  // QR share state
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const qrBusyRef = useRef(false);
  const qrTimerRef = useRef<number>(0);

  // Showcase state — 체험 종료 후 프레임화 전면 노출
  const [showcaseImage, setShowcaseImage] = useState<string | null>(null);
  const [showcaseTimestamp, setShowcaseTimestamp] = useState<Date | null>(null);
  const showcaseTimerRef = useRef<number>(0);
  // 5-06 클라 — 체험(listening) 화면 카운트다운 (30→0)
  const [secondsLeft, setSecondsLeft] = useState<number>(SESSION_CAP_SECONDS);
  const secondsTickRef = useRef<number>(0);
  // showcase 오실로스코프 sweep 튜닝 — 패널 슬라이더 상태 + localStorage 영구화
  const [printParams, setPrintParams] = useState<PrintParams>(loadPrintParams);
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  // portrait(QR 다운로드) 미리보기 — P 패널 썸네일에 표시
  const [portraitPreview, setPortraitPreview] = useState<string | null>(null);
  // loop()이 stale closure 안 타도록 enterShowcase를 ref로 경유 호출
  const enterShowcaseRef = useRef<() => void>(() => {});

  const [showDebugUI, setShowDebugUI] = useState(false);
  const [sessionCapped, setSessionCapped] = useState(false);
  const [showOscPanel, setShowOscPanel] = useState(false);
  const [oscPreAmp, setOscPreAmp] = useState(1.0);
  const [oscSwapXY, setOscSwapXY] = useState(false);
  const [oscFreeze, setOscFreeze] = useState(false);
  const [oscHue, setOscHue] = useState(125);
  const [oscSigGen, setOscSigGen] = useState<SignalGenSettings>({
    enabled: false,
    xExpr: 'sin(2*PI*a*t)*cos(2*PI*b*t)',
    yExpr: 'cos(2*PI*a*t)*cos(2*PI*b*t)',
    aValue: 0.7,
    aExp: 0,
    bValue: 1,
    bExp: 0,
  });
  const oscPreAmpRef = useRef(1.0);
  const oscSwapXYRef = useRef(false);
  const oscFreezeRef = useRef(false);
  const oscSigGenRef = useRef<SignalGenSettings>(oscSigGen);
  const sigGenFnRef = useRef<{ fx: Function; fy: Function } | null>(null);
  const sigGenTRef = useRef(0);

  useLayoutEffect(() => {
    function update() {
      setStackStage(measureStackStage());
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => { oscPreAmpRef.current = oscPreAmp; }, [oscPreAmp]);
  useEffect(() => { oscSwapXYRef.current = oscSwapXY; }, [oscSwapXY]);
  useEffect(() => { oscFreezeRef.current = oscFreeze; }, [oscFreeze]);
  useEffect(() => {
    oscSigGenRef.current = oscSigGen;
    try {
      // eslint-disable-next-line no-new-func
      const fx = new Function('PI', 'sin', 'cos', 'tan', 'abs', 'sqrt', 'a', 'b', 't', `return ${oscSigGen.xExpr};`);
      // eslint-disable-next-line no-new-func
      const fy = new Function('PI', 'sin', 'cos', 'tan', 'abs', 'sqrt', 'a', 'b', 't', `return ${oscSigGen.yExpr};`);
      sigGenFnRef.current = { fx, fy };
    } catch {
      sigGenFnRef.current = null;
    }
  }, [oscSigGen]);

  const clearIntroTimers = useCallback(() => {
    for (const t of introTimersRef.current) window.clearTimeout(t);
    introTimersRef.current = [];
  }, []);

  const handleTuningChange = useCallback((key: string, value: number) => {
    setTuningParams(prev => {
      const next = { ...prev, [key]: { ...(prev as any)[key], value } };
      if (engineRef.current) {
        engineRef.current.params = extractValues(next);
      }
      if (key === 'yamnetScoreThreshold' && analyzerRef.current) {
        (analyzerRef.current as any).yamnet.scoreThreshold = value;
      }
      if (key === 'yamnetMaxResults' && analyzerRef.current) {
        (analyzerRef.current as any).yamnet.maxResults = value;
      }
      saveParams(next);
      return next;
    });
  }, []);

  const loop = useCallback(() => {
    if (!analyzerRef.current || !engineRef.current) return;
    const features = analyzerRef.current.getFeatures();
    const engine = engineRef.current;

    // listening 시엔 Canvas 2D 렌더 스킵, 타임라인 누적만 (월페이퍼용) + dood.al 실시간 렌더
    if (oscilloscopeRef.current) {
      // 이번 프레임의 활성 트리거 hue (live history + engine sessionHues 양쪽에 동기 기록)
      // 감소는 이 시점에서 1회만 수행 — live render 경로에선 read-only로 변경
      let activeHue = -1;
      if (activeTriggerRef.current && activeTriggerRef.current.framesRemaining > 0) {
        activeHue = activeTriggerRef.current.hue;
        activeTriggerRef.current.framesRemaining -= 1;
        if (activeTriggerRef.current.framesRemaining <= 0) activeTriggerRef.current = null;
      }
      engine.updateTimelineOnly(features, activeHue);
      if (!oscFreezeRef.current) {
        const sig = oscSigGenRef.current;
        if (sig.enabled && sigGenFnRef.current) {
          // SIGNAL GENERATOR path — 수식 기반 리사주
          const nSamples = 1024;
          const x = new Float32Array(nSamples);
          const y = new Float32Array(nSamples);
          const a = sig.aValue * Math.pow(10, sig.aExp);
          const b = sig.bValue * Math.pow(10, sig.bExp);
          const { fx, fy } = sigGenFnRef.current;
          sigGenTRef.current += 1 / 60;
          const tBase = sigGenTRef.current;
          for (let i = 0; i < nSamples; i++) {
            const t = tBase + i / nSamples / 60;
            try {
              x[i] = fx(Math.PI, Math.sin, Math.cos, Math.tan, Math.abs, Math.sqrt, a, b, t);
              y[i] = fy(Math.PI, Math.sin, Math.cos, Math.tan, Math.abs, Math.sqrt, a, b, t);
            } catch {
              x[i] = 0; y[i] = 0;
            }
          }
          if (oscSwapXYRef.current) oscilloscopeRef.current.render(y, x);
          else oscilloscopeRef.current.render(x, y);
        } else if (features.waveformFloat && features.waveformFloat.length > 0) {
          const xBuf = historyXRef.current;
          const yBuf = historyYRef.current;
          const hueBuf = historyHueRef.current;
          if (xBuf && yBuf && hueBuf) {
            const insertCount = Math.min(HISTORY_SAMPLES_PER_FRAME, features.waveformFloat.length);
            // engine.updateTimelineOnly에 넘겨준 activeHue와 같은 값 — engine/live 동기 보장
            const frameHue = activeHue;
            if (historyIdxRef.current < HISTORY_LEN) {
              const remaining = HISTORY_LEN - historyIdxRef.current;
              const fillCount = Math.min(insertCount, remaining);
              const liveWindow = features.waveformFloat.length;
              const liveStart = 0;
              for (let i = 0; i < fillCount; i++) {
                const srcIdx = liveStart + Math.floor((i / Math.max(1, fillCount - 1)) * (liveWindow - 1));
                const amp = Math.max(-1, Math.min(1, features.waveformFloat[srcIdx] * oscPreAmpRef.current * 6));
                yBuf[historyIdxRef.current + i] = amp;
                hueBuf[historyIdxRef.current + i] = frameHue;
              }
              historyIdxRef.current += fillCount;
            } else {
              // full → 왼쪽으로 chunk shift, 오른쪽 끝에 현재 waveform의 여러 샘플 삽입
              yBuf.copyWithin(0, insertCount);
              hueBuf.copyWithin(0, insertCount);
              const liveWindow = features.waveformFloat.length;
              const liveStart = 0;
              for (let i = 0; i < insertCount; i++) {
                const srcIdx = liveStart + Math.floor((i / Math.max(1, insertCount - 1)) * (liveWindow - 1));
                const amp = Math.max(-1, Math.min(1, features.waveformFloat[srcIdx] * oscPreAmpRef.current * 6));
                yBuf[HISTORY_LEN - insertCount + i] = amp;
                hueBuf[HISTORY_LEN - insertCount + i] = frameHue;
              }
            }

            // 상하 대칭(β) — 중앙선 기준 양쪽 균등 위해 y 0.5배 스케일 후 mirror 옵션으로 y/-y 둘 다 렌더
            // C2 덩어리감: |amp|에 비례한 per-point width 스케일 (0.7 얇은 기본 → 2.0 진폭 peak 덩어리)
            const yScaled = new Float32Array(yBuf.length);
            const widthsBuf = new Float32Array(yBuf.length);
            for (let i = 0; i < yBuf.length; i++) {
              yScaled[i] = yBuf[i] * 0.5;
              const amp = Math.abs(yBuf[i]);
              widthsBuf[i] = 0.7 + Math.min(1, amp) * 1.3;
            }
            if (oscSwapXYRef.current) oscilloscopeRef.current.render(yScaled, xBuf, { mirror: true, hues: hueBuf, widths: widthsBuf });
            else oscilloscopeRef.current.render(xBuf, yScaled, { mirror: true, hues: hueBuf, widths: widthsBuf });
          }
        }
      }
    } else {
      engine.update(features);
    }

    instrumentRef.current?.feed(features, engine.isSessionActive());

    debugFrameRef.current++;
    if (debugFrameRef.current % 5 === 0) {
      setDebugVolume(features.volume);
      setDebugSpeaking(features.isSpeaking);
      setDebugSoundType(features.soundType);
      setYamnetLabel(features.yamnetLabel || '');
      setYamnetConfidence(features.yamnetConfidence || 0);
      setSessionCapped(engine.isSessionCapped());
    }

    // 30초 cap 자동 종료 — 9차 합의. enterShowcase가 cancelAnimationFrame까지 처리
    if (engine.isSessionCapped() && !qrBusyRef.current) {
      enterShowcaseRef.current();
      return;
    }

    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const startMic = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      setPhase('listening');
      cancelAnimationFrame(idleAnimFrameRef.current);
      const analyzer = new AudioAnalyzer();
      analyzer.sensitivity = sensitivity;
      analyzer.threshold = threshold;
      await analyzer.start();
      analyzerRef.current = analyzer;
      // Create fresh engine for listening (clear idle state)
      const engine = new GenerativeEngine(canvasRef.current);
      engine.params = extractValues(tuningParams);
      engine.setIdleMode(false);
      engineRef.current = engine;

      // dood.al Oscilloscope (WebGL) listening 렌더러 초기화
      // drawingBuffer는 설치 기준 해상도(1720×1032)로 고정 — CSS가 화면 크기로 stretch
      if (canvasGLRef.current) {
        try {
          const glCanvas = canvasGLRef.current;
          glCanvas.width = GL_RENDER_WIDTH;
          glCanvas.height = GL_RENDER_HEIGHT;
          const osc = new Oscilloscope(glCanvas);
          osc.resize(GL_RENDER_WIDTH, GL_RENDER_HEIGHT);
          oscilloscopeRef.current = osc;
        } catch (err) {
          console.error('Oscilloscope init failed:', err);
          oscilloscopeRef.current = null;
        }
      }

      // 사이클 시작 시 유저 색 랜덤 배정 (체험 한 사이클 = 한 유저)
      // kiosk 모드에선 OscilloscopePanel의 useEffect 동기화가 없으므로 params에도 직접 반영
      const randomHue = Math.floor(Math.random() * 360);
      setOscHue(randomHue);
      oscilloscopeRef.current?.setParam('hue', randomHue);

      // 체험 시간축 history 초기화
      const hx = new Float32Array(HISTORY_LEN);
      const hy = new Float32Array(HISTORY_LEN);
      const hhue = new Float32Array(HISTORY_LEN);
      for (let i = 0; i < HISTORY_LEN; i++) {
        hx[i] = -1 + (i / (HISTORY_LEN - 1)) * 2;
        hhue[i] = -1; // -1 = 세션 기본 hue 사용 (shader uSessionHue)
      }
      historyXRef.current = hx;
      historyYRef.current = hy;
      historyHueRef.current = hhue;
      activeTriggerRef.current = null;
      // 시작부터 shift 모드 — 새 샘플은 항상 오른쪽 끝에 들어오고 왼쪽으로 흐름.
      historyIdxRef.current = HISTORY_LEN;

      const speech = new SpeechTrigger(event => {
        engineRef.current?.triggerSpecialEvent(event.word);
        // 청각 이스터에그: 인식됨을 짧은 bell chime으로만 피드백 (시각 텍스트는 숨김)
        playChime();
        // 시각 이스터에그: 해당 단어 고유 hue를 0.3초 동안 새 샘플에 페인트 → 세션 색 흐름 속에 한 줄로 박힘
        const triggerHue = TRIGGER_HUE_MAP[event.word];
        if (typeof triggerHue === 'number') {
          activeTriggerRef.current = { hue: triggerHue, framesRemaining: TRIGGER_PAINT_FRAMES };
        }
      });
      speech.start();
      speechRef.current = speech;

      // Instrument layers — 첫 발화(engine.sessionActive edge)에 드론 페이드인.
      const instrument = new InstrumentEngine();
      try {
        await instrument.start();
        instrumentRef.current = instrument;
      } catch (err) {
        console.error('InstrumentEngine start failed:', err);
      }

      setIsActive(true);
      animFrameRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.error('Microphone error:', e);
      alert('마이크 접근 권한이 필요합니다.');
      setPhase('idle');
      setIntroStep(0);
      setIsActive(false);
    }
  }, [loop, sensitivity, threshold, tuningParams, playChime]);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(idleAnimFrameRef.current);
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setIsActive(false);
    setIntroStep(0);
    setIntroExiting(false);
    clearIntroTimers();
    engineRef.current?.clear();
    engineRef.current = null; // Will be recreated by idle effect
    instrumentRef.current?.stop();
    instrumentRef.current = null;
    oscilloscopeRef.current?.dispose();
    oscilloscopeRef.current = null;
    setSessionCapped(false);
    setPhase('idle');
  }, [clearIntroTimers]);

  const startExperience = useCallback(() => {
    if (phase !== 'idle') return;
    cancelAnimationFrame(idleAnimFrameRef.current);
    clearIntroTimers();
    engineRef.current?.clear();
    engineRef.current = null;
    setIsActive(false);
    setIntroStep(1);
    setIntroExiting(false);
    setPhase('intro');
    setShowSettings(false);
    setShowTuning(false);
    introTimersRef.current = [];
    // 4단계 시퀀스 (3차 피드백 260407 기준)
    // step1: 거대 OH!BREMEN 크롭인 (1.6s)
    // step2: 로고 아래→위 + 흔들림 (2.5s)
    // step3: 동물 버스트 (3.4s, 기존 approach)
    // step4: 정착 (1.4s, 로고+동물 축소 잔존)
    // 타이밍 (step2/3 통합 stage, beasts가 바운스 초반부터 진입)
    // stage mount 1000ms. 바운스 1.4s (1000-2400). beasts --delay 200ms + 180ms 스태거
    //   → 첫 beast approach 시작 1200ms abs, reveal 2112ms abs (바운스 중)
    //   → 마지막 beast approach 시작 1740ms abs
    // step4(stack) 6800ms, mic 11000ms
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(2), 1000));
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(3), 2400));
    INTRO_BEAST_CONFIG.forEach((a, i) => {
      // reveal at 19% of 4.8s ≈ 0.91s after beast's approach start (1200+i*180)
      const t = 1200 + i * 180 + 910;
      introTimersRef.current.push(window.setTimeout(() => playBeastAudio(a.src), t));
    });
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(4), 6800));
    // step4 stack 4.3s 끝난 직후(11100ms)부터 600ms 여지 → 800ms 페이드아웃 → mic
    introTimersRef.current.push(window.setTimeout(() => setIntroExiting(true), 11700));
    introTimersRef.current.push(
      window.setTimeout(() => {
        void startMic();
      }, 12500),
    );
  }, [phase, clearIntroTimers, startMic, playBeastAudio]);

  const clear = useCallback(() => {
    engineRef.current?.clear();
  }, []);

  /** Full reset: stop mic, clear showcase/QR, return to idle */
  const resetAll = useCallback(() => {
    clearTimeout(showcaseTimerRef.current);
    clearInterval(qrTimerRef.current);
    setQrData(null);
    setIsUploading(false);
    setShowSaveMenu(false);
    setShowcaseImage(null);
    setShowcaseTimestamp(null);
    qrBusyRef.current = false;
    // oscFreeze 해제 — 다음 체험이 빈 화면으로 시작하지 않도록 (4-29 회귀 픽스)
    oscFreezeRef.current = false;
    setOscFreeze(false);
    stopMic();
    clear();
  }, [stopMic, clear]);

  /**
   * showcase sweep 렌더 — sessionAmps 30s 전체를 oscilloscope에 그려 GL canvas dataURL 반환.
   *   - PrintParams 적용 (ampScale, widthBase/Boost, lineSizeMul, intensityMul, passes)
   *   - 호출 직전 oscilloscope.lineSize/intensity 백업 → 적용 → 렌더 → 복원
   *   - clear() 후 N회 누적 render → 멀티패스 = 풍성
   *   - 데이터 부족(<4) 시 null 반환
   */
  const renderShowcaseSweep = useCallback((params: PrintParams): string | null => {
    if (!engineRef.current || !oscilloscopeRef.current || !canvasGLRef.current) return null;
    const amps = engineRef.current.getSessionAmps();
    const hues = engineRef.current.getSessionHues();
    if (amps.length < 4) {
      console.warn('[showcase] sessionAmps too short — no sweep generated');
      return null;
    }
    const N = amps.length;
    const xSweep = new Float32Array(N);
    const ySweep = new Float32Array(N);
    const hueSweep = new Float32Array(N);
    const widthSweep = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      xSweep[i] = (i / (N - 1)) * 2 - 1;
      const a = amps[i] ?? 0;
      ySweep[i] = a * params.ampScale;
      hueSweep[i] = hues[i] ?? -1;
      widthSweep[i] = params.widthBase + Math.min(1, Math.abs(a)) * params.widthBoost;
    }
    const osc = oscilloscopeRef.current;
    const savedLineSize = osc.params.lineSize;
    const savedIntensity = osc.params.intensity;
    osc.setParam('lineSize', savedLineSize * params.lineSizeMul);
    osc.setParam('intensity', savedIntensity * params.intensityMul);
    try {
      osc.clear();
      const passes = Math.max(1, Math.min(6, Math.round(params.passes)));
      for (let p = 0; p < passes; p++) {
        if (oscSwapXYRef.current) {
          osc.render(ySweep, xSweep, { mirror: true, hues: hueSweep, widths: widthSweep });
        } else {
          osc.render(xSweep, ySweep, { mirror: true, hues: hueSweep, widths: widthSweep });
        }
      }
      return canvasGLRef.current.toDataURL('image/png');
    } catch (e) {
      console.error('[showcase] oscilloscope sweep render failed:', e);
      return null;
    } finally {
      osc.setParam('lineSize', savedLineSize);
      osc.setParam('intensity', savedIntensity);
    }
  }, []);

  /**
   * 체험 종료 → 10초 showcase phase 진입.
   * (a) 30초 cap 자동 도달, (b) B 버튼 조기 종료 — 두 분기 모두 이 함수로 수렴.
   *
   * 흐름: draw loop 정지 → oscilloscope freeze → 알파 투명 이미지 캡처
   *   → showcase phase 전환 → 백그라운드 업로드 → QR 표시
   *   → 10초 후 resetAll (idle 복귀)
   */
  const enterShowcase = useCallback(async () => {
    if (qrBusyRef.current || !engineRef.current) return;
    qrBusyRef.current = true;

    // 1. draw loop 정지 + oscilloscope freeze (canvas 내용 보존)
    cancelAnimationFrame(animFrameRef.current);
    oscFreezeRef.current = true;
    setOscFreeze(true);

    // 2. mic/analyzer/speech/instrument stop — canvas는 안 건드림
    analyzerRef.current?.stop();
    speechRef.current?.stop();
    instrumentRef.current?.stop();

    // 3. sessionAmps 30초 통합 sweep을 oscilloscope에 그려 GL canvas 캡처 (PrintParams 적용).
    const dataUrl = renderShowcaseSweep(printParams);
    if (dataUrl) setShowcaseImage(dataUrl);

    // 4. showcase phase 전환 (업로드 완료 전에 즉시 — UI는 spinner 먼저 노출)
    setShowcaseTimestamp(new Date());
    setPhase('showcase');
    setIsUploading(true);
    // 액자 등장 효과음 — 디졸브 fade-in(700ms)과 거의 동시 시작, 3음 아르페지오 360ms
    playShowcaseFlourish();

    // 5. idle 자동 복귀 타이머는 phase + showPrintPanel 기반 useEffect에서 관리
    //    (튜닝 패널 열려있으면 자동 정지)

    // 6. 백그라운드 업로드 — 완료 시 QR 교체
    //    같은 oscilloscope sweep을 90° 회전 cover로 portrait 1080×2340에 그림 (검은 배경, 4-29 후속 합의)
    try {
      if (!canvasGLRef.current || !engineRef.current) throw new Error('GL canvas or engine missing');
      engineRef.current.setPortraitFromGL(canvasGLRef.current);
      const dataUrl = await engineRef.current.toPortraitDataURL({
        logoScale: printParams.logoScale,
        taglineScale: printParams.taglineScale,
        tagOffsetY: printParams.tagOffsetY,
        banwonScale: printParams.banwonScale,
        banwonOffsetY: printParams.banwonOffsetY,
        banwonGap: printParams.banwonGap,
        logoOffsetY: printParams.logoOffsetY,
      });
      const imgUrl = await uploadToImgbb(dataUrl);
      const viewerUrl = `${QR_VIEWER_BASE}?img=${encodeURIComponent(imgUrl)}`;
      setQrData({ url: viewerUrl, countdown: Math.round(SHOWCASE_DURATION_MS / 1000) });
    } catch (e) {
      console.error('Showcase upload failed:', e);
    } finally {
      setIsUploading(false);
      qrBusyRef.current = false;
    }
  }, [printParams, renderShowcaseSweep]);

  // showcase phase 진입 후 PrintParams 변경 → live 재렌더 (P 패널 슬라이더 실시간 반영).
  //   세션 데이터(amps/hues)는 enterShowcase 시점에 engine에 이미 누적된 상태 → 그대로 재사용.
  //   GL canvas만 다시 그리고 dataURL 재캡처 → showcaseImage 갱신 → 액자 안 이미지 즉시 변경.
  useEffect(() => {
    if (phase !== 'showcase') return;
    const dataUrl = renderShowcaseSweep(printParams);
    if (dataUrl) setShowcaseImage(dataUrl);
  }, [phase, printParams, renderShowcaseSweep]);

  // P 패널 portrait 썸네일 — printParams 변경마다 portrait dataURL 재생성.
  //   위 effect에서 GL canvas가 최신 printParams로 갱신된 직후 portraitBuffer 재합성.
  useEffect(() => {
    if (phase !== 'showcase') return;
    if (!engineRef.current || !canvasGLRef.current) return;
    let cancelled = false;
    engineRef.current.setPortraitFromGL(canvasGLRef.current);
    engineRef.current
      .toPortraitDataURL({
        logoScale: printParams.logoScale,
        taglineScale: printParams.taglineScale,
        tagOffsetY: printParams.tagOffsetY,
        banwonScale: printParams.banwonScale,
        banwonOffsetY: printParams.banwonOffsetY,
        banwonGap: printParams.banwonGap,
        logoOffsetY: printParams.logoOffsetY,
      })
      .then((url) => {
        if (!cancelled) setPortraitPreview(url);
      })
      .catch((e) => console.warn('[portrait preview] failed', e));
    return () => { cancelled = true; };
  }, [phase, printParams]);

  const handlePrintParamsChange = useCallback((next: PrintParams) => {
    setPrintParams(next);
    savePrintParams(next);
  }, []);
  const handlePrintParamsReset = useCallback(() => {
    setPrintParams({ ...DEFAULT_PRINT_PARAMS });
    savePrintParams({ ...DEFAULT_PRINT_PARAMS });
  }, []);

  // 튜닝 패널 열려있으면 showcase 자동 idle 복귀 타이머 정지 (여유롭게 만지게)
  // 닫으면 그 시점부터 20초 타이머 재시작 — 해민이 의식적으로 닫아야 idle로
  useEffect(() => {
    if (phase !== 'showcase') return;
    if (showPrintPanel) {
      clearTimeout(showcaseTimerRef.current);
      return;
    }
    clearTimeout(showcaseTimerRef.current);
    showcaseTimerRef.current = window.setTimeout(() => {
      resetAll();
    }, SHOWCASE_DURATION_MS);
  }, [phase, showPrintPanel, resetAll]);

  // 5-06 클라 — 체험(listening) 페이즈 카운트다운: 첫 발화 시점(engine.getSessionStartMs)부터 30→0
  // 발화 전에는 30 그대로 유지 → 사람이 말 시작하면 카운트 시작
  useEffect(() => {
    if (phase !== 'listening') {
      clearInterval(secondsTickRef.current);
      setSecondsLeft(SESSION_CAP_SECONDS);
      return;
    }
    const tick = () => {
      const startMs = engineRef.current?.getSessionStartMs() ?? 0;
      if (!startMs) { setSecondsLeft(SESSION_CAP_SECONDS); return; }
      const elapsed = (performance.now() - startMs) / 1000;
      setSecondsLeft(Math.max(0, Math.ceil(SESSION_CAP_SECONDS - elapsed)));
    };
    tick();
    clearInterval(secondsTickRef.current);
    secondsTickRef.current = window.setInterval(tick, 250);
    return () => clearInterval(secondsTickRef.current);
  }, [phase]);

  // loop()이 최신 enterShowcase 참조하도록 ref 동기화
  useEffect(() => {
    enterShowcaseRef.current = () => { void enterShowcase(); };
  }, [enterShowcase]);

  const downloadDataUrl = useCallback((dataUrl: string, suffix: string) => {
    const link = document.createElement('a');
    link.download = `sound-painting-${suffix}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, []);

  const saveLandscape = useCallback(() => {
    if (!engineRef.current) return;
    downloadDataUrl(engineRef.current.toDataURL(), 'landscape');
    setShowSaveMenu(false);
  }, [downloadDataUrl]);

  const savePortrait = useCallback(async () => {
    if (!engineRef.current) return;
    if (canvasGLRef.current) engineRef.current.setPortraitFromGL(canvasGLRef.current);
    const url = await engineRef.current.toPortraitDataURL({
      logoScale: printParams.logoScale,
      taglineScale: printParams.taglineScale,
      tagOffsetY: printParams.tagOffsetY,
      banwonScale: printParams.banwonScale,
      banwonOffsetY: printParams.banwonOffsetY,
      banwonGap: printParams.banwonGap,
      logoOffsetY: printParams.logoOffsetY,
    });
    downloadDataUrl(url, 'wallpaper');
    setShowSaveMenu(false);
  }, [downloadDataUrl, printParams]);

  const handleSensitivityChange = useCallback((val: number) => {
    setSensitivity(val);
    analyzerRef.current?.setSensitivity(val);
  }, []);

  const handleThresholdChange = useCallback((val: number) => {
    setThreshold(val);
    analyzerRef.current?.setThreshold(val);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        setIsKioskMode(prev => !prev);
        setModeIndicator(true);
        clearTimeout(modeIndicatorTimerRef.current);
        modeIndicatorTimerRef.current = window.setTimeout(() => setModeIndicator(false), 2000);
        return;
      }
      // O key: 오실로스코프 튜닝 패널 토글 (listening 중에만)
      if (e.code === 'KeyO' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        console.log('[key O]', { phase, isKioskMode, willToggle: phase === 'listening' });
        if (phase === 'listening') {
          e.preventDefault();
          setShowOscPanel(prev => !prev);
        }
        return;
      }
      // P key: showcase sweep 튜닝 패널 토글 (showcase 중에만, 세팅 모드)
      if (e.code === 'KeyP' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        if (phase === 'showcase') {
          e.preventDefault();
          setShowPrintPanel(prev => !prev);
        }
        return;
      }
      // B key (페달): idle → 체험 시작 / listening → showcase 조기 진입 / showcase → idle 복귀
      if ((e.code === 'KeyB' && !e.ctrlKey && !e.shiftKey && !e.altKey)) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        if (phase === 'listening') {
          void enterShowcase();
        } else if (phase === 'showcase') {
          resetAll();
        } else if (phase === 'idle') {
          startExperience();
        }
        return;
      }
      if (e.code === 'Space' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        if (phase === 'listening') stopMic();
        return;
      }
// Q key: toggle debug UI
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        setShowDebugUI(prev => !prev);
        return;
      }
      if (e.code === 'Delete' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        if (phase === 'intro') {
          clearIntroTimers();
          setIntroStep(0);
          setPhase('idle');
        } else {
          resetAll();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, startExperience, stopMic, clearIntroTimers, resetAll, enterShowcase]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      cancelAnimationFrame(idleAnimFrameRef.current);
      analyzerRef.current?.stop();
      speechRef.current?.stop();
      clearTimeout(modeIndicatorTimerRef.current);
      clearInterval(qrTimerRef.current);
      clearTimeout(showcaseTimerRef.current);
      clearInterval(secondsTickRef.current);
      chimeCtxRef.current?.close().catch(() => {});
    };
  }, []);

  // ── Idle: no generative preview, just static background ──
  useEffect(() => {
    if (phase !== 'idle') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [phase]);

  useEffect(() => {
    const stopIdleTitleAnim = () => {
      if (idleTitleRafRef.current != null) {
        cancelAnimationFrame(idleTitleRafRef.current);
        idleTitleRafRef.current = null;
      }
      const h = idleTitleHostRef.current;
      if (h) h.innerHTML = '';
    };

    if (phase !== 'idle') {
      stopIdleTitleAnim();
      return;
    }

    const host = idleTitleHostRef.current;
    if (!host) return;

    let cancelled = false;
    const noise3D = createNoise3D();

    if (idleTitleRafRef.current != null) cancelAnimationFrame(idleTitleRafRef.current);
    idleTitleRafRef.current = null;
    host.innerHTML = '';

    const CONFIG = { translateAmp: 8, rotateAmp: 1.5, speed: 0.35 };

    const init = async () => {
      try {
        const resp = await fetch('/title.svg');
        const svgText = await resp.text();
        if (cancelled) return;
        host.innerHTML = svgText;
        const svg = host.querySelector('svg') as SVGSVGElement | null;
        if (!svg) return;
        svg.removeAttribute('width');
        svg.removeAttribute('height');
        svg.style.maxWidth = '72vw';
        svg.style.maxHeight = '75vh';

        // Animate every <path>/<polygon> directly — group structure in title.svg
        // is inconsistent (AI export quirk), so per-shape targeting ensures every
        // glyph moves including B/A of BACKYARD that were siblings-without-group.
        const allShapes = svg.querySelectorAll('path, polygon');
        const groups: Array<{
          el: SVGGraphicsElement;
          cx: number;
          cy: number;
          seedX: number;
          seedY: number;
          seedR: number;
        }> = [];
        let idx = 0;
        allShapes.forEach(s => {
          const el = s as SVGGraphicsElement;
          let bbox: DOMRect | null = null;
          try {
            bbox = el.getBBox();
          } catch {
            bbox = null;
          }
          if (!bbox || (bbox.width < 1 && bbox.height < 1)) return;
          const cx = bbox.x + bbox.width / 2;
          const cy = bbox.y + bbox.height / 2;
          groups.push({
            el,
            cx,
            cy,
            seedX: idx * 7.13,
            seedY: idx * 11.47,
            seedR: idx * 5.31,
          });
          idx++;
        });

        const startTime = performance.now();
        const animate = () => {
          if (cancelled) return;
          const t = (performance.now() - startTime) * 0.001 * CONFIG.speed;
          for (const { el, seedX, seedY, seedR, cx, cy } of groups) {
            const tx = noise3D(seedX, seedY * 0.5, t) * CONFIG.translateAmp;
            const ty = noise3D(seedY, seedX * 0.5, t + 100) * CONFIG.translateAmp;
            const rot = noise3D(seedR, seedR, t) * CONFIG.rotateAmp;
            el.setAttribute(
              'transform',
              `translate(${tx.toFixed(2)}, ${ty.toFixed(2)}) rotate(${rot.toFixed(2)}, ${cx.toFixed(1)}, ${cy.toFixed(1)})`,
            );
          }
          idleTitleRafRef.current = requestAnimationFrame(animate);
        };
        idleTitleRafRef.current = requestAnimationFrame(animate);
      } catch {
        /* ignore */
      }
    };
    void init();
    return () => {
      cancelled = true;
      stopIdleTitleAnim();
    };
  }, [phase]);

  return (
    <div
      className={`relative flex items-center justify-center w-screen h-screen bg-black overflow-hidden${isKioskMode ? ' cursor-none' : ''}`}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{
          width: '100vw',
          height: '100vh',
          display: phase === 'listening' ? 'none' : 'block',
          imageRendering: 'auto',
          backgroundColor: '#000000',
          objectFit: 'cover',
        }}
      />
      <canvas
        ref={canvasGLRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100vw',
          height: '100vh',
          // showcase 단계에도 block 유지 — spectrogram freeze 이미지가 배경에 깔려
          // showcase 흰 프레임 UI가 opacity 0→100으로 디졸브하는 동안 중간 공백 없이 자연스럽게 크로스페이드됨
          display: phase === 'listening' || phase === 'showcase' ? 'block' : 'none',
          backgroundColor: '#000000',
        }}
      />

      {showDebugUI && !isKioskMode && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 items-center z-10">
          {phase === 'idle' && (
            <button
              type="button"
              onClick={startExperience}
              className="px-8 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light"
            >
              오프닝 시작
            </button>
          )}
          {phase === 'intro' && (
            <button type="button" disabled className="px-8 py-3 rounded-full bg-muted/60 border border-border/40 text-muted-foreground/60 cursor-not-allowed text-sm tracking-widest uppercase font-light">
              오프닝 중...
            </button>
          )}
          {phase === 'listening' && (
            <>
              <button
                type="button"
                onClick={stopMic}
                className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light"
              >
                정지
              </button>
              <button
                type="button"
                onClick={clear}
                className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light"
              >
                초기화
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSaveMenu(!showSaveMenu)}
                  className="px-6 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light"
                >
                  저장
                </button>
                {showSaveMenu && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur border border-border rounded-lg p-2 flex flex-col gap-1 w-48 z-30">
                    <button
                      type="button"
                      onClick={saveLandscape}
                      className="text-xs text-left px-3 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      🖥️ 원본 ({CANVAS_WIDTH}×{CANVAS_HEIGHT})
                    </button>
                    <button
                      type="button"
                      onClick={savePortrait}
                      className="text-xs text-left px-3 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    >
                      📱 폰 배경화면 (1080×2340)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <button
            type="button"
            onClick={() => phase !== 'intro' && setShowSettings(!showSettings)}
            className="w-10 h-10 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center justify-center text-lg"
            title="감도 설정"
          >
            ⚙
          </button>
          <button
            type="button"
            onClick={() => phase !== 'intro' && setShowTuning(!showTuning)}
            className="w-10 h-10 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center justify-center text-lg"
            title="튜닝 패널"
          >
            🎛️
          </button>
        </div>
      )}

      {showDebugUI && showSettings && !isKioskMode && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur border border-border rounded-lg p-5 z-20 w-72 space-y-4">
          <h3 className="text-xs text-foreground tracking-widest uppercase font-medium mb-3">감도 설정</h3>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs text-muted-foreground">마이크 감도</label>
              <span className="text-xs text-muted-foreground font-mono w-10 text-right">{sensitivity.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              value={sensitivity}
              onChange={e => handleSensitivityChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
            />
          </div>
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-xs text-muted-foreground">반응 임계값</label>
              <span className="text-xs text-muted-foreground font-mono w-10 text-right">{threshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0.005"
              max="0.3"
              step="0.005"
              value={threshold}
              onChange={e => handleThresholdChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
            />
          </div>
        </div>
      )}

      {showDebugUI && showTuning && !isKioskMode && (
        <TuningPanel params={tuningParams} onChange={handleTuningChange} />
      )}


      {phase === 'idle' && (
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            ref={idleTitleHostRef}
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              filter: 'grayscale(1) contrast(1.15) brightness(1.08)',
              transform: 'translateY(-77px) scale(0.83)',
            }}
          />
        </div>
      )}

      {phase === 'idle' && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 pointer-events-none">
          <style>
            {`
              @keyframes bremenHintFlicker {
                0% { opacity: 0.65; }
                6% { opacity: 1; }
                12% { opacity: 0.35; }
                18% { opacity: 1; }
                28% { opacity: 0.55; }
                40% { opacity: 1; }
                55% { opacity: 0.25; }
                70% { opacity: 1; }
                82% { opacity: 0.6; }
                100% { opacity: 0.85; }
              }
            `}
          </style>
          <img
            src="/floor_pad_hint_text.svg"
            alt=""
            className="h-[25px] w-auto max-w-[90vw] opacity-90"
            style={{ animation: 'bremenHintFlicker 2.4s infinite linear', transform: 'translateY(-20px)' }}
          />
          <img src="/by_oh_bremen_logo.svg" alt="" className="h-[96px] w-auto max-w-[90vw] opacity-90" />
        </div>
      )}

      {phase === 'intro' && (
        <div
          className={`absolute inset-0 pointer-events-none z-20 overflow-hidden transition-opacity duration-700 ease-out ${introExiting ? 'opacity-0' : 'opacity-100'}`}
        >
          {/* step 1: 거대 OH!BREMEN 크롭인 */}
          {introStep === 1 && (
            <>
              <div className="absolute inset-0 bg-black" aria-hidden />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className="intro-giant-oh block h-auto w-auto max-h-[60vh] max-w-[80vw] object-contain"
                  style={{ filter: 'grayscale(1) contrast(1.2) brightness(1.15)' }}
                  aria-hidden
                />
              </div>
            </>
          )}

          {/* step 2+3 통합: 로고 바운스(step2) + 동물 approach(beasts, step2 말미부터 overlap 시작)
              beasts는 stage mount 시점에서 animation-delay로 약간 지연 — step2 바운스가 끝나기 전에 진입 시작 */}
          {(introStep === 2 || introStep === 3) && (
            <>
              <div className="absolute inset-0 bg-black" aria-hidden />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className={`${introStep === 2 ? 'intro-bounce-back ' : ''}block h-auto max-h-[min(52vh,520px)] w-auto max-w-[min(74vw,780px)] object-contain`}
                  aria-hidden
                />
              </div>
              {INTRO_BEAST_CONFIG.map((a, i) => {
                // 로고 감쌀 때 4마리 상/하 · 좌/우 대칭 배치 (원본 fy/fx는 비대칭)
                const isTop = a.fy < 0;
                const isLeft = a.fx < 0;
                const SYM_X = 460; // 좌우 거리
                const SYM_Y = 200; // 상하 거리
                const symFx = isLeft ? -SYM_X : SYM_X;
                const symFy = isTop ? -SYM_Y : SYM_Y;
                return (
                  <img
                    key={`approach-${a.src}`}
                    src={a.src}
                    alt=""
                    className="intro-approach-beast absolute left-1/2 top-1/2 object-contain object-center opacity-100 w-auto max-w-[min(96vw,900px)]"
                    style={
                      {
                        height: `${stackStage.h * a.stackHFrac * 1.15}px`,
                        zIndex: 30,
                        '--fx': `${symFx * 1.1}px`,
                        '--fy': `${symFy * 1.1}px`,
                        '--fr': `${a.fr}deg`,
                        '--fs': String(a.fs * 1.15),
                        '--ox': `${a.ox * 0.4}px`,
                        '--oy': `${a.oy * 0.4}px`,
                        '--or': `${a.orDeg}deg`,
                        '--os': String(a.os * 1.15),
                        '--delay': `${200 + i * 180}ms`,
                      } as CSSProperties
                    }
                  />
                );
              })}
            </>
          )}

          {/* step 4: 스톱모션 스택 (원본 introStackBeast) + 로고 정착 */}
          {introStep === 4 && (
            <>
              <div className="absolute inset-0 bg-black" aria-hidden />
              <div className="intro-oh-center-wrap absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className="intro-logo-settle block h-auto max-h-[min(52vh,520px)] w-auto max-w-[min(74vw,780px)] object-contain"
                  aria-hidden
                />
              </div>
              {[...INTRO_BEAST_CONFIG]
                .sort((x, y) => y.stackCy - x.stackCy)
                .map(a => {
                  const STACK_Y_SHIFT_VH = -8;
                  const STACK_SPREAD = 1.22;
                  const stackYShiftPx = (window.innerHeight * STACK_Y_SHIFT_VH) / 100;
                  const raw = stackOffsetPx(a.stackCx, a.stackCy, stackStage);
                  const sx = raw.sx * STACK_SPREAD;
                  const sy = raw.sy * STACK_SPREAD + stackYShiftPx;
                  // step3 대칭 좌표와 일치 (점프 방지)
                  const isTop = a.fy < 0;
                  const isLeft = a.fx < 0;
                  const SYM_X = 460, SYM_Y = 200;
                  const symFx = (isLeft ? -SYM_X : SYM_X) * 1.1;
                  const symFy = (isTop ? -SYM_Y : SYM_Y) * 1.1;
                  return (
                    <img
                      key={`stack-${a.src}`}
                      src={a.src}
                      alt=""
                      className="intro-stack-beast absolute left-1/2 top-1/2 object-contain object-center opacity-100 w-auto max-w-[min(96vw,900px)]"
                      style={
                        {
                          height: `${stackStage.h * a.stackHFrac * 1.15}px`,
                          zIndex: 30,
                          '--fx': `${symFx}px`,
                          '--fy': `${symFy}px`,
                          '--fr': `${a.fr}deg`,
                          '--fs': String(a.fs * 1.15),
                          '--sx': `${sx}px`,
                          '--sy': `${sy}px`,
                          '--sr': `${a.sr}deg`,
                          '--ss': String(a.ss),
                          '--delay': `${a.stackDelayMs}ms`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
            </>
          )}
        </div>
      )}

      {phase === 'listening' && (
        <OscilloscopePanel
          oscilloscope={oscilloscopeRef.current}
          visible={showOscPanel}
          onClose={() => setShowOscPanel(false)}
          preAmp={oscPreAmp}
          onPreAmpChange={setOscPreAmp}
          swapXY={oscSwapXY}
          onSwapXYChange={setOscSwapXY}
          freeze={oscFreeze}
          onFreezeChange={setOscFreeze}
          sigGen={oscSigGen}
          onSigGenChange={setOscSigGen}
          hue={oscHue}
          onHueChange={setOscHue}
        />
      )}

      {phase === 'showcase' && (
        <PrintTuningPanel
          visible={showPrintPanel}
          onClose={() => setShowPrintPanel(false)}
          params={printParams}
          onChange={handlePrintParamsChange}
          onReset={handlePrintParamsReset}
          portraitPreview={portraitPreview}
        />
      )}

      {phase === 'listening' && (
        <div className="absolute inset-0 pointer-events-none z-20">
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-center px-8">
            <div className="text-[18px] font-light tracking-[0.2em] text-foreground/90 text-glow">당신의 목소리를 남겨보세요</div>
            <div className="text-[12px] text-muted-foreground/70 tracking-[0.25em] mt-1">Your voice, your trace</div>
          </div>
          {/* 5-06 클라 — 체험 중 카운트다운 (첫 발화 후 30→0)
              Adobe Fonts Acumin Pro Thin, 상단 가운데 정렬, 화면 상단 ~13% */}
          <div
            className="absolute left-1/2 -translate-x-1/2 text-foreground/90 text-[88px] leading-none tabular-nums select-none"
            style={{
              top: '13%',
              fontFamily: '"acumin-pro", "Helvetica Neue", "Inter", system-ui, sans-serif',
              fontWeight: 100,
              letterSpacing: '0.04em',
            }}
          >
            {secondsLeft}
          </div>
        </div>
      )}

      {showDebugUI && isActive && !isKioskMode && (
        <div className="absolute top-6 left-6 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${debugSpeaking ? 'bg-neon-green' : 'bg-muted-foreground/30'}`} />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">
              {debugSpeaking ? '인식 중' : '대기 중'}
            </span>
          </div>
          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${Math.min(100, debugVolume * 100)}%`,
                background: debugVolume > threshold ? 'hsl(120, 100%, 55%)' : 'hsl(0, 0%, 30%)',
              }}
            />
          </div>
        </div>
      )}

      {showDebugUI && isActive && !isKioskMode && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground tracking-wider uppercase">녹음 중</span>
        </div>
      )}

      {showDebugUI && modeIndicator && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 bg-card/80 backdrop-blur border border-border rounded-full text-xs tracking-widest uppercase text-muted-foreground animate-in fade-in duration-200">
          {isKioskMode ? '🖥 전시 모드' : '⚙ 세팅 모드'}
        </div>
      )}

      {/* Showcase — 체험 종료 후 인화사진 프레임 전면 노출 (9차 합의)
          프레임 밖은 검정(LED 갤러리 벽), 액자 프레임은 검정 테두리, 내부 인쇄물은 흰색 */}
      {phase === 'showcase' && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center p-16 animate-in fade-in duration-700">
          <div className="relative flex-1 w-full flex items-center justify-center min-h-0">
            <div
              className="relative flex items-center justify-center max-w-[78vw] max-h-full"
              style={{
                background: '#ffffff',
                padding: '3vh 4vh 16vh 4vh',
                boxShadow: '0 30px 90px rgba(0,0,0,0.6)',
                border: '14px solid #000000',
              }}
            >
              {showcaseImage && (
                <img
                  src={showcaseImage}
                  alt="체험 결과"
                  className="object-contain"
                  style={{ maxWidth: '100%', maxHeight: '50vh' }}
                />
              )}
              {/* 흰 footer (16vh) 안 우하단 QR 11vh × 11vh, 비례 기반 (1720×1032 viewport 기준) */}
              <div
                className="absolute flex items-center"
                style={{
                  bottom: 0,
                  right: 0,
                  height: '16vh',
                  paddingRight: '4vh',
                  gap: '1.5vh',
                }}
              >
                <div className="text-right">
                  <p className="text-neutral-700 text-[10px] tracking-[0.25em] uppercase">Scan to save</p>
                  <p className="text-neutral-500 text-[9px] tracking-[0.2em] mt-0.5">BREMEN BACKYARD</p>
                </div>
                {!qrData || isUploading ? (
                  <div
                    className="bg-white border border-neutral-300 flex items-center justify-center"
                    style={{ width: '11vh', height: '11vh', padding: '0.5vh' }}
                  >
                    <div className="w-10 h-10 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div
                    className="bg-white border border-neutral-300"
                    style={{ width: '11vh', height: '11vh', padding: '0.5vh' }}
                  >
                    <QRCodeSVG value={qrData.url} size={256} style={{ width: '100%', height: '100%' }} />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-8 text-center">
            <p className="text-white/80 text-[14px] tracking-[0.25em]">핸드폰으로 QR을 스캔해 내 기록을 저장해 보세요</p>
            <p className="text-white/40 text-[10px] tracking-[0.25em] mt-1.5">잠시 후 초기 화면으로 돌아갑니다</p>
          </div>
        </div>
      )}
    </div>
  );
}
