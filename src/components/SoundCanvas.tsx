import { useRef, useEffect, useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AudioAnalyzer, SoundType } from '@/lib/audioAnalyzer';
import { GenerativeEngine } from '@/lib/generativeEngine';
import { createDefaultParams, extractValues, TuningParams, ParamDef } from '@/lib/tuningParams';
import { SpeechTrigger, TriggerWord } from '@/lib/speechTrigger';
import { uploadToImgbb } from '@/lib/shareImage';
import TuningPanel from './TuningPanel';
import logoImage from '../../logo.png';

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
const CANVAS_HEIGHT = 1032;

const IDLE_FEATURES = {
  volume: 0,
  bass: 0,
  mid: 0,
  treble: 0,
  frequencies: new Uint8Array(0),
  waveform: new Uint8Array(0),
  pitch: 0,
  isSpeaking: false,
  soundType: 'silence' as SoundType,
  spectralCentroid: 0,
  spectralFlatness: 0,
  yamnetLabel: '',
  yamnetConfidence: 0,
};

export default function SoundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const engineRef = useRef<GenerativeEngine | null>(null);
  const speechRef = useRef<SpeechTrigger | null>(null);
  const animFrameRef = useRef<number>(0);
  const modeIndicatorTimerRef = useRef<number>(0);
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const isStartingRef = useRef(false);
  const startAttemptRef = useRef(0);
  const [debugVolume, setDebugVolume] = useState(0);
  const [debugSpeaking, setDebugSpeaking] = useState(false);
  const [debugSoundType, setDebugSoundType] = useState<SoundType>('silence');
  const [yamnetLabel, setYamnetLabel] = useState('');
  const [yamnetConfidence, setYamnetConfidence] = useState(0);
  const [sensitivity, setSensitivity] = useState(0.4);
  const [threshold, setThreshold] = useState(0.04);
  const [showSettings, setShowSettings] = useState(false);
  const [showTuning, setShowTuning] = useState(false);
  const [isKioskMode, setIsKioskMode] = useState(true);
  const [modeIndicator, setModeIndicator] = useState(false);
  const [experienceStarted, setExperienceStarted] = useState(false);
  const [tuningParams, setTuningParams] = useState<TuningParams>(loadParams);
  const [triggerDisplay, setTriggerDisplay] = useState<{ word: TriggerWord; text: string } | null>(null);
  const triggerTimerRef = useRef<number>(0);
  const debugFrameRef = useRef(0);
  const showLogo = !isStarting && !experienceStarted;

  const handleTuningChange = useCallback((key: string, value: number) => {
    setTuningParams(prev => {
      const next = { ...prev, [key]: { ...(prev as any)[key], value } };
      if (engineRef.current) {
        engineRef.current.params = extractValues(next);
      }
      if (key === 'yamnetScoreThreshold' && analyzerRef.current) {
        analyzerRef.current.setYamnetScoreThreshold(value);
      }
      if (key === 'yamnetMaxResults' && analyzerRef.current) {
        analyzerRef.current.setYamnetMaxResults(value);
      }
      saveParams(next);
      return next;
    });
  }, []);

  const loop = useCallback(() => {
    if (!engineRef.current) return;

    const features = analyzerRef.current?.getFeatures() ?? IDLE_FEATURES;
    engineRef.current.setIdleMode(!analyzerRef.current);
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

  const start = useCallback(async (manual = false) => {
    if (!canvasRef.current || analyzerRef.current) return;
    if (isStartingRef.current && !manual) return;

    const attempt = ++startAttemptRef.current;
    isStartingRef.current = true;
    setIsStarting(true);

    try {
      const analyzer = new AudioAnalyzer();
      analyzer.sensitivity = sensitivity;
      analyzer.threshold = threshold;
      analyzer.setYamnetScoreThreshold(tuningParams.yamnetScoreThreshold.value);
      analyzer.setYamnetMaxResults(tuningParams.yamnetMaxResults.value);
      await analyzer.start();

      // Ignore stale auto-start attempts if a newer manual start happened
      if (attempt !== startAttemptRef.current) {
        analyzer.stop();
        return;
      }

      analyzerRef.current = analyzer;

      if (!engineRef.current) {
        const engine = new GenerativeEngine(canvasRef.current);
        engine.params = extractValues(tuningParams);
        engineRef.current = engine;
      } else {
        engineRef.current.params = extractValues(tuningParams);
      }

      const speech = new SpeechTrigger((event) => {
        engineRef.current?.triggerSpecialEvent(event.word);
        clearTimeout(triggerTimerRef.current);
        const emojiMap: Record<string, string> = { love: 'LOVE', hello: 'HELLO', happy: 'HAPPY', wow: 'WOW', thanks: 'THANKS', sorry: 'SORRY', missyou: 'MISSYOU' };
        const emoji = emojiMap[event.word] || 'TRIGGER';
        setTriggerDisplay({ word: event.word, text: emoji + ' "' + event.transcript + '"' });
        triggerTimerRef.current = window.setTimeout(() => setTriggerDisplay(null), 2500);
      });
      speech.start();
      speechRef.current = speech;

      setIsActive(true);
      setExperienceStarted(true);
    } catch (e) {
      console.error('Microphone error:', e);
      if (manual) {
        alert('Microphone access is required.');
      }
    } finally {
      if (attempt === startAttemptRef.current) {
        isStartingRef.current = false;
        setIsStarting(false);
      }
    }
  }, [sensitivity, threshold, tuningParams]);

  const stop = useCallback(() => {
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    speechRef.current?.stop();
    speechRef.current = null;
    isStartingRef.current = false;
    setIsStarting(false);
    setTriggerDisplay(null);
    setIsActive(false);
  }, []);

  const clear = useCallback(() => {
    engineRef.current?.clear();
  }, []);

  const resetToIdle = useCallback(() => {
    clearInterval(qrCountdownRef.current);
    setQrData(null);
    setIsUploading(false);
    setShowSaveMenu(false);
    setShowSettings(false);
    setShowTuning(false);
    setExperienceStarted(false);
    stop();
    clear();
  }, [clear, stop]);

  const handleShareQR = useCallback(async () => {
    if (isUploadingRef.current || !engineRef.current) return;
    isUploadingRef.current = true;
    setIsUploading(true);
    clearInterval(qrCountdownRef.current);
    setQrData(null);
    try {
      const dataUrl = engineRef.current.toPortraitDataURL();
      const imgUrl = await uploadToImgbb(dataUrl);
      const shareUrl = String(import.meta.env.VITE_SHARE_PAGE_URL) + '?img=' + encodeURIComponent(imgUrl);
      setQrData({ url: shareUrl, countdown: 60 });
      qrCountdownRef.current = window.setInterval(() => {
        setQrData(prev => {
          if (!prev) return null;
          if (prev.countdown <= 1) {
            clearInterval(qrCountdownRef.current);
            resetToIdle();
            return null;
          }
          return { ...prev, countdown: prev.countdown - 1 };
        });
      }, 1000);
    } catch (err) {
      console.error('QR share failed:', err);
    } finally {
      isUploadingRef.current = false;
      setIsUploading(false);
    }
  }, [resetToIdle]);

  const [qrData, setQrData] = useState<{ url: string; countdown: number } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const isUploadingRef = useRef(false);
  const qrCountdownRef = useRef<number>(0);

  const [showSaveMenu, setShowSaveMenu] = useState(false);

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
    if (!canvasRef.current || engineRef.current) return;
    const engine = new GenerativeEngine(canvasRef.current);
    engine.params = extractValues(tuningParams);
    engineRef.current = engine;
    animFrameRef.current = requestAnimationFrame(loop);
  }, [loop, tuningParams]);

  // AudioContext watchdog — suspended 상태 자동 복구 (상시 전시용)
  useEffect(() => {
    if (!isActive) return;
    const watchdog = setInterval(() => {
      analyzerRef.current?.resumeIfSuspended();
    }, 5000);
    return () => clearInterval(watchdog);
  }, [isActive]);

  // 키보드 단축키
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+K : 전시/세팅 모드 전환
      if (e.ctrlKey && e.shiftKey && e.key === 'K') {
        e.preventDefault();
        setIsKioskMode(prev => !prev);
        setModeIndicator(true);
        clearTimeout(modeIndicatorTimerRef.current);
        modeIndicatorTimerRef.current = window.setTimeout(() => setModeIndicator(false), 2000);
        return;
      }
      // Space : 마이크 시작/정지
      if (e.code === 'Space' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        if ((e.target as HTMLElement).tagName === 'INPUT') return;
        e.preventDefault();
        if (isActive) stop(); else start(true);
        return;
      }
      // Delete : 캔버스 초기화
      if (e.code === 'Delete' && !e.ctrlKey && !e.shiftKey) {
        e.preventDefault();
        clear();
        return;
      }
      // Q : 이미지 공유 QR 코드
      if (e.code === 'KeyQ' && !e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!isActive) {
          start(true);
        } else if (isUploading || qrData) {
          resetToIdle();
        } else {
          handleShareQR();
        }
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive, isUploading, qrData, start, stop, clear, handleShareQR, resetToIdle]);

  // 전시 모드 진입 시 마이크 자동 시작

  // 24시간 자동 재시작 — 장기 메모리 누수 방지 (상시 전시용)
  useEffect(() => {
    const timer = setTimeout(() => window.location.reload(), 24 * 60 * 60 * 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    return () => {
      analyzerRef.current?.stop();
      speechRef.current?.stop();
      clearTimeout(triggerTimerRef.current);
      clearTimeout(modeIndicatorTimerRef.current);
      clearInterval(qrCountdownRef.current);
      cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  return (
    <div className={`relative flex items-center justify-center w-screen h-screen bg-background overflow-hidden${isKioskMode ? ' cursor-none' : ''}`}>
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        style={{
          width: `min(100vw, ${(CANVAS_WIDTH / CANVAS_HEIGHT * 100).toFixed(4)}vh)`,
          height: 'auto',
          aspectRatio: `${CANVAS_WIDTH} / ${CANVAS_HEIGHT}`,
          imageRendering: 'auto',
        }}
      />

      {/* Controls — 세팅 모드에서만 표시 */}
      {!isKioskMode && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 items-center z-10">
          {!isActive ? (
            <button
              onClick={() => start(true)}
              className="px-8 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light"
            >
              마이크 시작
            </button>
          ) : (
            <>
              <button onClick={stop} className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light">
                정지
              </button>
              <button onClick={clear} className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light">
                초기화
              </button>
              <div className="relative">
                <button onClick={() => setShowSaveMenu(!showSaveMenu)} className="px-6 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light">
                  저장
                </button>
                {showSaveMenu && (
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-card/90 backdrop-blur border border-border rounded-lg p-2 flex flex-col gap-1 w-48 z-30">
                    <button onClick={saveLandscape} className="text-xs text-left px-3 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      🖥️ 원본 (1720×1032)
                    </button>
                    <button onClick={savePortrait} className="text-xs text-left px-3 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                      📱 폰 배경화면 (1080×2340)
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-10 h-10 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center justify-center text-lg"
            title="감도 설정"
          >
            ⚙
          </button>
          <button
            onClick={() => setShowTuning(!showTuning)}
            className="w-10 h-10 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center justify-center text-lg"
            title="튜닝 패널"
          >
            🎛️
          </button>
        </div>
      )}

      {/* Settings panel — 세팅 모드에서만 표시 */}
      {showSettings && !isKioskMode && (
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
              onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/50">
              <span>낮음</span>
              <span>높음</span>
            </div>
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
              onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
            />
            <div className="flex justify-between text-[10px] text-muted-foreground/50">
              <span>민감 (배경소음도 반응)</span>
              <span>둔감 (큰 소리만)</span>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/40 leading-relaxed">
            감도를 낮추고 임계값을 높이면 목소리에만 반응합니다. 감도를 높이고 임계값을 낮추면 작은 소리에도 반응합니다.
          </p>
        </div>
      )}

      {/* Tuning panel — 세팅 모드에서만 표시 */}
      {showTuning && !isKioskMode && (
        <TuningPanel params={tuningParams} onChange={handleTuningChange} />
      )}

      {/* Title / Logo */}
      {showLogo && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <img
            src={logoImage}
            alt="Bremen Backyard"
            className="w-[min(52vw,680px)] h-auto opacity-95 drop-shadow-[0_14px_34px_rgba(0,0,0,0.55)]"
          />
          <p className="mt-5 text-sm tracking-[0.28em] uppercase text-foreground/75 drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)]">
            PRESS BUTTON TO START
          </p>
        </div>
      )}

      {/* Audio level indicator — 세팅 모드에서만 표시 */}
      {isActive && !isKioskMode && (
        <div className="absolute top-6 left-6 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors ${debugSpeaking ? 'bg-neon-green' : 'bg-muted-foreground/30'}`} />
            <span className="text-xs text-muted-foreground tracking-wider uppercase">
              {debugSpeaking ? '인식 중' : '대기 중'}
            </span>
          </div>
          {debugSpeaking && debugSoundType !== 'silence' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-full border" style={{
                color: debugSoundType === 'voice' ? 'hsl(180, 100%, 50%)' :
                       debugSoundType === 'snap' ? 'hsl(195, 100%, 75%)' :
                       debugSoundType === 'clap' ? 'hsl(25, 100%, 60%)' :
                       'hsl(300, 80%, 70%)',
                borderColor: debugSoundType === 'voice' ? 'hsl(180, 100%, 50%)' :
                       debugSoundType === 'snap' ? 'hsl(195, 100%, 75%)' :
                       debugSoundType === 'clap' ? 'hsl(25, 100%, 60%)' :
                       'hsl(300, 80%, 70%)',
              }}>
                {debugSoundType === 'voice' ? '🎤 목소리' :
                 debugSoundType === 'snap' ? '✨ 스냅' :
                 debugSoundType === 'clap' ? '👏 박수' :
                 '😄 웃음'}
              </span>
            </div>
          )}
          <div className="w-32 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-75"
              style={{
                width: `${Math.min(100, debugVolume * 100)}%`,
                background: debugVolume > threshold ? 'hsl(120, 100%, 55%)' : 'hsl(0, 0%, 30%)',
              }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/50 font-mono">
            {debugVolume.toFixed(3)} / {threshold.toFixed(3)}
          </span>
          {yamnetLabel && (
            <span className="text-[10px] text-muted-foreground/60 font-mono">
              YAMNet: {yamnetLabel} ({(yamnetConfidence * 100).toFixed(0)}%)
            </span>
          )}
          {triggerDisplay && (
            <span className="text-xs text-muted-foreground tracking-wider uppercase">
              {triggerDisplay.text}
            </span>
          )}
        </div>
      )}

      {/* Recording indicator — 세팅 모드에서만 표시 */}
      {isActive && !isKioskMode && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground tracking-wider uppercase">녹음 중</span>
        </div>
      )}


      {/* QR 공유 — 하단 우측 */}
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

      {/* 모드 전환 인디케이터 */}
      {modeIndicator && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 px-5 py-2 bg-card/80 backdrop-blur border border-border rounded-full text-xs tracking-widest uppercase text-muted-foreground animate-in fade-in duration-200">
          {isKioskMode ? '🖥 전시 모드' : '⚙ 세팅 모드'}
        </div>
      )}
    </div>
  );
}
