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

// Showcase: 체험 종료 후 LED 전면에 프레임화된 결과를 10초 노출하는 단계
// (a) 30초 cap 도달 자동 진입  (b) B 버튼 조기 종료
const SHOWCASE_DURATION_MS = 20_000;

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

/**
 * 오실로스코프 WebGL 캔버스를 "파형만 알파 채널로 분리된 투명 PNG"로 변환.
 * 검은 배경(+ phosphor grain)은 alpha 0, 밝은 파형은 불투명. 프레임 배경이 흰/검 무관.
 */
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
  // "찐한 색" — gamma 0.45로 약한 값 boost, threshold 이상은 빠르게 불투명에 수렴
  // 동시에 rgb도 저조도 구간 boost해서 투명 이미지에서도 솔리드 컬러 유지
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    if (luma < 6) {
      data[i + 3] = 0;
      continue;
    }
    // gamma boost alpha
    const alphaNorm = Math.pow(luma / 255, 0.45);
    data[i + 3] = Math.min(255, Math.round(alphaNorm * 280));
    // rgb도 같은 gamma로 끌어올려 약한 라인도 진한 컬러로
    const rgbGain = Math.pow(Math.max(r, g, b) / 255, 0.45);
    const rgbScale = rgbGain === 0 ? 1 : rgbGain / (Math.max(r, g, b) / 255);
    data[i] = Math.min(255, Math.round(r * rgbScale));
    data[i + 1] = Math.min(255, Math.round(g * rgbScale));
    data[i + 2] = Math.min(255, Math.round(b * rgbScale));
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
      engine.updateTimelineOnly(features);
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
            // 이번 프레임에 새로 들어오는 샘플의 기본 hue 결정 — 활성 트리거가 있으면 그 색, 아니면 -1(세션 hue)
            let frameHue = -1;
            if (activeTriggerRef.current && activeTriggerRef.current.framesRemaining > 0) {
              frameHue = activeTriggerRef.current.hue;
              activeTriggerRef.current.framesRemaining -= 1;
              if (activeTriggerRef.current.framesRemaining <= 0) activeTriggerRef.current = null;
            }
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
    stopMic();
    clear();
  }, [stopMic, clear]);

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

    // 3. γ — sessionAmps 기반 "체험 전체" 정적 waveform 재렌더
    //   spectrogram-like: 각 bucket의 peak를 수직 stroke pair(x,-peak)→(x,+peak)로 그려
    //   라인 한 줄 한 줄이 구분되는 룩 (이미지 #10 레퍼런스). 인접 stroke 간 대각선은
    //   polyline 특성상 envelope으로 나타남 — 자연스러운 보조 효과.
    if (oscilloscopeRef.current && engineRef.current) {
      const ampsRaw = engineRef.current.getSessionAmps();
      if (ampsRaw.length >= 4) {
        // 수직 stroke 개수. 1720 LED에서 간격 ~4px 정도가 시각 분리에 적당.
        const STROKE_COUNT = Math.min(420, Math.floor(ampsRaw.length / 6));
        const xStart = -0.98;
        const xEnd = 0.98;
        const AMP_BOOST = 2.4;
        const PEAK_CLAMP = 0.92;

        const N = STROKE_COUNT * 2;
        const xFull = new Float32Array(N);
        const yFull = new Float32Array(N);
        const widthsFull = new Float32Array(N);
        const bucketSize = ampsRaw.length / STROKE_COUNT;
        for (let b = 0; b < STROKE_COUNT; b++) {
          const start = Math.floor(b * bucketSize);
          const end = Math.min(ampsRaw.length, Math.floor((b + 1) * bucketSize));
          let maxAbs = 0;
          for (let j = start; j < end; j++) {
            const a = Math.abs(ampsRaw[j] ?? 0);
            if (a > maxAbs) maxAbs = a;
          }
          const peak = Math.min(PEAK_CLAMP, maxAbs * AMP_BOOST);
          const x = xStart + (b / Math.max(1, STROKE_COUNT - 1)) * (xEnd - xStart);
          const base = 2 * b;
          xFull[base] = x;
          yFull[base] = -peak;
          xFull[base + 1] = x;
          yFull[base + 1] = peak;
          // C2 덩어리감: peak 큰 stroke는 두껍게 (showcase 최종 이미지에서도 원칙 반영)
          const w = 0.7 + peak * 1.3;
          widthsFull[base] = widthsFull[base + 1] = w;
        }
        console.log('[showcase] strokes:', STROKE_COUNT, 'from', ampsRaw.length, 'samples');
        oscilloscopeRef.current.clear();
        oscilloscopeRef.current.render(xFull, yFull, { mirror: false, widths: widthsFull });
      } else {
        console.warn('[showcase] sessionAmps too short — using live canvas as-is');
      }
    }

    // 4. 알파 투명 이미지 캡처 (실패 시 원본 이미지로 fallback)
    if (canvasGLRef.current) {
      try {
        const alphaDataUrl = await toAlphaPng(canvasGLRef.current);
        setShowcaseImage(alphaDataUrl);
      } catch (e) {
        console.error('Alpha conversion failed, using opaque fallback:', e);
        try {
          setShowcaseImage(canvasGLRef.current.toDataURL('image/png'));
        } catch {}
      }
    }

    // 4. showcase phase 전환 (업로드 완료 전에 즉시 — UI는 spinner 먼저 노출)
    setShowcaseTimestamp(new Date());
    setPhase('showcase');
    setIsUploading(true);

    // 5. 10초 후 idle 자동 복귀 (업로드 완료 여부와 독립)
    showcaseTimerRef.current = window.setTimeout(() => {
      resetAll();
    }, SHOWCASE_DURATION_MS);

    // 6. 백그라운드 업로드 — 완료 시 QR 교체
    try {
      if (canvasGLRef.current) engineRef.current.setPortraitFromGL(canvasGLRef.current);
      const dataUrl = engineRef.current.toPortraitDataURL();
      const imgUrl = await uploadToImgbb(dataUrl);
      const viewerUrl = `${QR_VIEWER_BASE}?img=${encodeURIComponent(imgUrl)}`;
      setQrData({ url: viewerUrl, countdown: Math.round(SHOWCASE_DURATION_MS / 1000) });
    } catch (e) {
      console.error('Showcase upload failed:', e);
    } finally {
      setIsUploading(false);
      qrBusyRef.current = false;
    }
  }, [resetAll]);

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

  const savePortrait = useCallback(() => {
    if (!engineRef.current) return;
    if (canvasGLRef.current) engineRef.current.setPortraitFromGL(canvasGLRef.current);
    downloadDataUrl(engineRef.current.toPortraitDataURL(), 'wallpaper');
    setShowSaveMenu(false);
  }, [downloadDataUrl]);

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
        if (phase === 'listening') {
          e.preventDefault();
          setShowOscPanel(prev => !prev);
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
          display: phase === 'listening' ? 'block' : 'none',
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

      {phase === 'listening' && !isKioskMode && (
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

      {phase === 'listening' && (
        <div className="absolute inset-0 pointer-events-none z-20">
          <div className="absolute bottom-14 left-1/2 -translate-x-1/2 text-center px-8">
            <div className="text-[18px] font-light tracking-[0.2em] text-foreground/90 text-glow">너의 목소리를 들려줘</div>
            <div className="text-[12px] text-muted-foreground/70 tracking-[0.25em] mt-1">Let me hear your voice</div>
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

      {/* Showcase — 체험 종료 후 인화사진 프레임 전면 노출 (9차 합의 ⭐ "흰 배경 목표 약속")
          LED 전체 흰 배경 10초 → 매트 보드(크림) + 얇은 검정 외곽선 + 인쇄물 = 3겹 전시 프레임 */}
      {phase === 'showcase' && (
        <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-16">
          <div className="relative flex-1 w-full flex items-center justify-center min-h-0">
            <div
              className="relative flex items-center justify-center max-w-[84vw] max-h-full"
              style={{
                background: '#ffffff',
                // 3겹 레이어: 얇은 검정 키라인 → 크림 매트 → 흰 인쇄물
                padding: '56px 56px 140px 56px',
                boxShadow: '0 30px 90px rgba(0,0,0,0.18), 0 8px 24px rgba(0,0,0,0.08)',
                border: '14px solid #f5f1e8',
                outline: '1px solid rgba(20,20,20,0.22)',
                outlineOffset: '-14px',
              }}
            >
              {showcaseImage && (
                <img
                  src={showcaseImage}
                  alt="체험 결과"
                  className="object-contain"
                  style={{ maxWidth: '100%', maxHeight: '62vh' }}
                />
              )}
              {/* 프레임 내부 우하단 QR 서명 */}
              <div className="absolute bottom-6 right-6 flex items-center gap-3">
                <div className="text-right">
                  <p className="text-neutral-700 text-[10px] tracking-[0.25em] uppercase">Scan to save</p>
                  <p className="text-neutral-500 text-[9px] tracking-[0.2em] mt-0.5">BREMEN BACKYARD</p>
                </div>
                {!qrData || isUploading ? (
                  <div className="bg-white border border-neutral-300 p-2 flex items-center justify-center w-[96px] h-[96px]">
                    <div className="w-6 h-6 border-2 border-neutral-400 border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="bg-white border border-neutral-300 p-2">
                    <QRCodeSVG value={qrData.url} size={80} />
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-8 text-center">
            <p className="text-neutral-700 text-[14px] tracking-[0.25em]">핸드폰으로 QR을 스캔해 내 기록을 저장해 보세요</p>
            <p className="text-neutral-400 text-[10px] tracking-[0.25em] mt-1.5">잠시 후 초기 화면으로 돌아갑니다</p>
          </div>
        </div>
      )}
    </div>
  );
}
