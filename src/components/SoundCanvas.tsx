import { useRef, useEffect, useLayoutEffect, useState, useCallback, type CSSProperties } from 'react';
import { createNoise3D } from 'simplex-noise';
import { QRCodeSVG } from 'qrcode.react';
import { AudioAnalyzer, SoundType } from '@/lib/audioAnalyzer';
import { GenerativeEngine, type PalettePreset } from '@/lib/generativeEngine';
import { createDefaultParams, extractValues, TuningParams, ParamDef } from '@/lib/tuningParams';
import { SpeechTrigger, TriggerWord } from '@/lib/speechTrigger';
import TuningPanel from './TuningPanel';

const IMGBB_API_KEY = '807140906d6d0c3c9a3b83ec99c22d74';
const QR_VIEWER_BASE = 'https://exquisite-twilight-5847a3.netlify.app';

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
    stackCy: 160,
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
    stackCy: 436,
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
    stackCy: 350,
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
    stackCy: 260,
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

type Phase = 'idle' | 'intro' | 'listening';

// 동물 SVG ↔ 사운드 매핑 (intro-stack-1~4 순서, INTRO_BEAST_CONFIG의 등장 순서와는 별개)
const BEAST_AUDIO: Record<string, string> = {
  '/intro-stack-1.svg': '/intro-audio/cat.wav',
  '/intro-stack-2.svg': '/intro-audio/rooster.wav',
  '/intro-stack-3.svg': '/intro-audio/dog.mp3',
  '/intro-stack-4.svg': '/intro-audio/footsteps.wav',
};

export default function SoundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const engineRef = useRef<GenerativeEngine | null>(null);
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
  const [isKioskMode, setIsKioskMode] = useState(false);
  const [modeIndicator, setModeIndicator] = useState(false);
  const [palette, setPalette] = useState<PalettePreset>('default');
  const [paletteIndicator, setPaletteIndicator] = useState<string | null>(null);
  const paletteIndicatorTimerRef = useRef<number>(0);
  const [tuningParams, setTuningParams] = useState<TuningParams>(loadParams);
  const [triggerDisplay, setTriggerDisplay] = useState<{ word: TriggerWord; text: string } | null>(null);
  const triggerTimerRef = useRef<number>(0);
  const debugFrameRef = useRef(0);
  const [stackStage, setStackStage] = useState<StackStage>(measureStackStage);
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  // QR share state
  const [qrData, setQrData] = useState<QrData | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const qrBusyRef = useRef(false);
  const qrTimerRef = useRef<number>(0);

  const [showDebugUI, setShowDebugUI] = useState(false);

  useLayoutEffect(() => {
    function update() {
      setStackStage(measureStackStage());
    }
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
    engineRef.current.update(features);

    debugFrameRef.current++;
    if (debugFrameRef.current % 5 === 0) {
      setDebugVolume(features.volume);
      setDebugSpeaking(features.isSpeaking);
      setDebugSoundType(features.soundType);
      setYamnetLabel(features.yamnetLabel || '');
      setYamnetConfidence(features.yamnetConfidence || 0);
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
      engine.setPalette(palette);
      engineRef.current = engine;

      const speech = new SpeechTrigger(event => {
        engineRef.current?.triggerSpecialEvent(event.word);
        clearTimeout(triggerTimerRef.current);
        const emojiMap: Record<string, string> = {
          love: '❤️',
          hello: '👋',
          happy: '🌈',
          wow: '🎆',
          thanks: '🙏',
          sorry: '💧',
          missyou: '💜',
        };
        const emoji = emojiMap[event.word] || '✨';
        setTriggerDisplay({ word: event.word, text: `${emoji} "${event.transcript}"` });
        triggerTimerRef.current = window.setTimeout(() => setTriggerDisplay(null), 2500);
      });
      speech.start();
      speechRef.current = speech;
      setIsActive(true);
      animFrameRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.error('Microphone error:', e);
      alert('마이크 접근 권한이 필요합니다.');
      setPhase('idle');
      setIntroStep(0);
      setIsActive(false);
    }
  }, [loop, sensitivity, threshold, tuningParams]);

  const stopMic = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    cancelAnimationFrame(idleAnimFrameRef.current);
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    setIsActive(false);
    setIntroStep(0);
    clearIntroTimers();
    engineRef.current?.clear();
    engineRef.current = null; // Will be recreated by idle effect
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
    setPhase('intro');
    setShowSettings(false);
    setShowTuning(false);
    introTimersRef.current = [];
    // 4단계 시퀀스 (3차 피드백 260407 기준)
    // step1: 거대 OH!BREMEN 크롭인 (1.6s)
    // step2: 로고 아래→위 + 흔들림 (2.5s)
    // step3: 동물 버스트 (3.4s, 기존 approach)
    // step4: 정착 (1.4s, 로고+동물 축소 잔존)
    // 새 시퀀스: giant(빠르게) → bounce-back → approach → stack
    // 1.0 + 2.2 + 3.5 + 3.2 = 9.9s
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(2), 1000));
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(3), 3200));
    // 동물 사운드 — approach 진입 타이밍과 동기
    INTRO_BEAST_CONFIG.forEach((a, i) => {
      const t = 3200 + 120 + i * 180;
      introTimersRef.current.push(window.setTimeout(() => playBeastAudio(a.src), t));
    });
    introTimersRef.current.push(window.setTimeout(() => setIntroStep(4), 6700)); // stack
    introTimersRef.current.push(
      window.setTimeout(() => {
        void startMic();
      }, 9900),
    );
  }, [phase, clearIntroTimers, startMic, playBeastAudio]);

  const clear = useCallback(() => {
    engineRef.current?.clear();
  }, []);

  /** Full reset: stop mic, clear QR, return to idle */
  const resetAll = useCallback(() => {
    clearInterval(qrTimerRef.current);
    setQrData(null);
    setIsUploading(false);
    setShowSaveMenu(false);
    qrBusyRef.current = false;
    stopMic();
    clear();
  }, [stopMic, clear]);

  /** Upload portrait image to imgbb and show QR code */
  const shareQr = useCallback(async () => {
    if (qrBusyRef.current || !engineRef.current) return;
    qrBusyRef.current = true;
    setIsUploading(true);
    clearInterval(qrTimerRef.current);
    setQrData(null);
    try {
      const dataUrl = engineRef.current.toPortraitDataURL();
      const imgUrl = await uploadToImgbb(dataUrl);
      const viewerUrl = `${QR_VIEWER_BASE}?img=${encodeURIComponent(imgUrl)}`;
      setQrData({ url: viewerUrl, countdown: 60 });
      qrTimerRef.current = window.setInterval(() => {
        setQrData(prev => {
          if (!prev) return null;
          if (prev.countdown <= 1) {
            clearInterval(qrTimerRef.current);
            resetAll();
            return null;
          }
          return { ...prev, countdown: prev.countdown - 1 };
        });
      }, 1000);
    } catch (e) {
      console.error('QR share failed:', e);
    } finally {
      qrBusyRef.current = false;
      setIsUploading(false);
    }
  }, [resetAll]);

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
      // B key: idle → start experience / listening → QR share / QR showing → reset
      if ((e.code === 'KeyB' && !e.ctrlKey && !e.shiftKey && !e.altKey)) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        if (isActive) {
          // listening mode
          if (isUploading || qrData) {
            resetAll();
          } else {
            shareQr();
          }
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
      // M key: toggle palette (default ⇄ adult)
      if (e.code === 'KeyM' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        setPalette(prev => {
          const next: PalettePreset = prev === 'default' ? 'adult' : 'default';
          engineRef.current?.setPalette(next);
          setPaletteIndicator(next === 'adult' ? 'ADULT (4-key)' : 'DEFAULT (5-band)');
          clearTimeout(paletteIndicatorTimerRef.current);
          paletteIndicatorTimerRef.current = window.setTimeout(() => setPaletteIndicator(null), 1800);
          return next;
        });
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
  }, [phase, isActive, isUploading, qrData, startExperience, stopMic, clear, clearIntroTimers, resetAll, shareQr]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      cancelAnimationFrame(idleAnimFrameRef.current);
      analyzerRef.current?.stop();
      speechRef.current?.stop();
      clearTimeout(triggerTimerRef.current);
      clearTimeout(modeIndicatorTimerRef.current);
      clearInterval(qrTimerRef.current);
    };
  }, []);

  // ── Idle: no generative preview, just static background ──
  useEffect(() => {
    if (phase !== 'idle') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#393939';
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
        svg.style.maxWidth = '80vw';
        svg.style.maxHeight = '80vh';

        const allGroups = svg.querySelectorAll('g');
        const groups: Array<{
          el: SVGGElement;
          cx: number;
          cy: number;
          seedX: number;
          seedY: number;
          seedR: number;
        }> = [];
        let idx = 0;
        allGroups.forEach(g => {
          const gg = g as SVGGElement;
          const hasPath = gg.querySelector(':scope > path, :scope > polygon');
          const hasChildG = gg.querySelector(':scope > g');
          if (!hasPath || hasChildG) return;
          let bbox: DOMRect | null = null;
          try {
            bbox = gg.getBBox();
          } catch {
            bbox = null;
          }
          if (!bbox || (bbox.width < 1 && bbox.height < 1)) return;
          const cx = bbox.x + bbox.width / 2;
          const cy = bbox.y + bbox.height / 2;
          groups.push({
            el: gg,
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
      className={`relative flex items-center justify-center w-screen h-screen bg-background overflow-hidden${isKioskMode ? ' cursor-none' : ''}`}
    >
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{
          width: '100vw',
          height: '100vh',
          display: 'block',
          imageRendering: 'auto',
          backgroundColor: '#393939',
          objectFit: 'cover',
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
              transform: 'translateY(-56px) scale(0.78)',
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
            className="h-[45px] w-auto max-w-[90vw] opacity-90"
            style={{ animation: 'bremenHintFlicker 2.4s infinite linear', transform: 'translateY(-40px)' }}
          />
          <img src="/oh_bremen_logo.svg" alt="" className="h-[55px] w-auto max-w-[90vw] opacity-90" />
        </div>
      )}

      {phase === 'intro' && (
        <div className="absolute inset-0 pointer-events-none z-20 overflow-hidden">
          {/* step 1: 거대 OH!BREMEN 크롭인 */}
          {introStep === 1 && (
            <>
              <div className="absolute inset-0 bg-[#222]" aria-hidden />
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

          {/* step 2: giant scale 10에서 바운스로 scale 1로 복귀 */}
          {introStep === 2 && (
            <>
              <div className="absolute inset-0 bg-[#222]" aria-hidden />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className="intro-bounce-back block h-auto max-h-[min(38vh,380px)] w-auto max-w-[min(62vw,640px)] object-contain"
                  aria-hidden
                />
              </div>
            </>
          )}

          {/* step 3: 밖 → 진입 (원본 introApproachBeast, 1.3× 키움) */}
          {introStep === 3 && (
            <>
              <div className="absolute inset-0 bg-[#222]" aria-hidden />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className="block h-auto max-h-[min(38vh,380px)] w-auto max-w-[min(62vw,640px)] object-contain"
                  aria-hidden
                />
              </div>
              {INTRO_BEAST_CONFIG.map((a, i) => (
                <img
                  key={`approach-${a.src}`}
                  src={a.src}
                  alt=""
                  className="intro-approach-beast absolute left-1/2 top-1/2 object-contain object-center opacity-100 w-auto max-w-[min(96vw,900px)]"
                  style={
                    {
                      height: `${stackStage.h * a.stackHFrac * 0.9}px`,
                      zIndex: 30,
                      // 로고와 겹침 회피: fx/fy 1.4× 푸시
                      '--fx': `${a.fx * 1.4}px`,
                      '--fy': `${a.fy * 1.4}px`,
                      '--fr': `${a.fr}deg`,
                      '--fs': String(a.fs * 0.9),
                      '--ox': `${a.ox}px`,
                      '--oy': `${a.oy}px`,
                      '--or': `${a.orDeg}deg`,
                      '--os': String(a.os * 0.9),
                      '--delay': `${120 + i * 110}ms`,
                    } as CSSProperties
                  }
                />
              ))}
            </>
          )}

          {/* step 4: 스톱모션 스택 (원본 introStackBeast) + 로고 정착 */}
          {introStep === 4 && (
            <>
              <div className="absolute inset-0 bg-[#222]" aria-hidden />
              <div className="intro-oh-center-wrap absolute inset-0 flex items-center justify-center pointer-events-none">
                <img
                  src="/oh_bremen_logo.svg"
                  alt=""
                  className="intro-logo-settle block h-auto max-h-[min(38vh,380px)] w-auto max-w-[min(62vw,640px)] object-contain"
                  aria-hidden
                />
              </div>
              {[...INTRO_BEAST_CONFIG]
                .sort((x, y) => y.stackCy - x.stackCy)
                .map(a => {
                  const { sx, sy } = stackOffsetPx(a.stackCx, a.stackCy, stackStage);
                  return (
                    <img
                      key={`stack-${a.src}`}
                      src={a.src}
                      alt=""
                      className="intro-stack-beast absolute left-1/2 top-1/2 object-contain object-center opacity-100 w-auto max-w-[min(96vw,900px)]"
                      style={
                        {
                          height: `${stackStage.h * a.stackHFrac * 0.9}px`,
                          zIndex: 30,
                          // step3 끝(0.9× scale, 1.4× 푸시 위치) → stack 진행하며 원본 1.0×로 축소
                          '--fx': `${a.fx * 1.4}px`,
                          '--fy': `${a.fy * 1.4}px`,
                          '--fr': `${a.fr}deg`,
                          '--fs': String(a.fs * 0.9),
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

      {triggerDisplay && (
        <div className="absolute top-6 left-6 pointer-events-none z-40 max-w-[min(90vw,520px)] animate-in fade-in slide-in-from-left-2 duration-300">
          <div className="text-left text-base sm:text-lg font-light tracking-wide text-foreground/95 text-glow px-4 py-3 bg-card/40 backdrop-blur-md rounded-lg border border-border/40 shadow-lg">
            {triggerDisplay.text}
          </div>
        </div>
      )}

      {showDebugUI && modeIndicator && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 bg-card/80 backdrop-blur border border-border rounded-full text-xs tracking-widest uppercase text-muted-foreground animate-in fade-in duration-200">
          {isKioskMode ? '🖥 전시 모드' : '⚙ 세팅 모드'}
        </div>
      )}

      {paletteIndicator && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2 bg-card/80 backdrop-blur border border-border rounded-full text-xs tracking-widest uppercase text-muted-foreground animate-in fade-in duration-200">
          🎨 {paletteIndicator}
        </div>
      )}

      {/* QR share overlay */}
      {(isUploading || qrData) && (
        <div className="absolute bottom-6 right-6 z-50">
          {isUploading ? (
            <div className="bg-card/90 backdrop-blur border border-border rounded-xl p-5 flex flex-col items-center gap-3">
              <div className="w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground tracking-widest">업로드 중...</span>
            </div>
          ) : qrData && (
            <div className="bg-card/90 backdrop-blur border border-border rounded-xl p-4 flex flex-col items-center gap-2">
              <p className="text-[10px] text-muted-foreground tracking-widest uppercase mb-1">폰으로 스캔하여 저장</p>
              <div className="bg-white p-2 rounded-lg">
                <QRCodeSVG value={qrData.url} size={160} />
              </div>
              <p className="text-xs text-muted-foreground font-mono">{qrData.countdown}초 후 사라짐</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
