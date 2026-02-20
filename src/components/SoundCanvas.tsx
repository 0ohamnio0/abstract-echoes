import { useRef, useEffect, useState, useCallback } from 'react';
import { AudioAnalyzer } from '@/lib/audioAnalyzer';
import { GenerativeEngine } from '@/lib/generativeEngine';

const CANVAS_WIDTH = 1900;
const CANVAS_HEIGHT = 1200;

export default function SoundCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyzerRef = useRef<AudioAnalyzer | null>(null);
  const engineRef = useRef<GenerativeEngine | null>(null);
  const animFrameRef = useRef<number>(0);
  const [isActive, setIsActive] = useState(false);
  const [debugVolume, setDebugVolume] = useState(0);
  const [debugSpeaking, setDebugSpeaking] = useState(false);
  const [sensitivity, setSensitivity] = useState(1.0);
  const [threshold, setThreshold] = useState(0.05);
  const [showSettings, setShowSettings] = useState(false);
  const debugFrameRef = useRef(0);

  const loop = useCallback(() => {
    if (!analyzerRef.current || !engineRef.current) return;
    const features = analyzerRef.current.getFeatures();
    engineRef.current.update(features);

    debugFrameRef.current++;
    if (debugFrameRef.current % 5 === 0) {
      setDebugVolume(features.volume);
      setDebugSpeaking(features.isSpeaking);
    }

    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(async () => {
    if (!canvasRef.current) return;
    try {
      const analyzer = new AudioAnalyzer();
      analyzer.sensitivity = sensitivity;
      analyzer.threshold = threshold;
      await analyzer.start();
      analyzerRef.current = analyzer;
      engineRef.current = new GenerativeEngine(canvasRef.current);
      setIsActive(true);
      animFrameRef.current = requestAnimationFrame(loop);
    } catch (e) {
      console.error('Microphone error:', e);
      alert('마이크 접근 권한이 필요합니다.');
    }
  }, [loop, sensitivity, threshold]);

  const stop = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    analyzerRef.current?.stop();
    analyzerRef.current = null;
    setIsActive(false);
  }, []);

  const clear = useCallback(() => {
    engineRef.current?.clear();
  }, []);

  const save = useCallback(() => {
    if (!engineRef.current) return;
    const dataUrl = engineRef.current.toDataURL();
    const link = document.createElement('a');
    link.download = `sound-painting-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, []);

  const handleSensitivityChange = useCallback((val: number) => {
    setSensitivity(val);
    analyzerRef.current?.setSensitivity(val);
  }, []);

  const handleThresholdChange = useCallback((val: number) => {
    setThreshold(val);
    analyzerRef.current?.setThreshold(val);
  }, []);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      analyzerRef.current?.stop();
    };
  }, []);

  return (
    <div className="relative flex items-center justify-center w-screen h-screen bg-background overflow-hidden">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="max-w-full max-h-full border border-border/20 rounded-sm"
        style={{ imageRendering: 'auto' }}
      />

      {/* Controls */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-4 items-center z-10">
        {!isActive ? (
          <button
            onClick={start}
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
            <button onClick={save} className="px-6 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light">
              저장
            </button>
          </>
        )}
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="w-10 h-10 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 flex items-center justify-center text-lg"
          title="감도 설정"
        >
          ⚙
        </button>
      </div>

      {/* Settings panel */}
      {showSettings && (
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

      {/* Title */}
      {!isActive && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
          <h1 className="text-5xl font-extralight tracking-[0.3em] text-foreground/80 text-glow mb-4">
            SOUND REACTIVE
          </h1>
          <p className="text-muted-foreground text-sm tracking-[0.2em] uppercase">
            목소리로 추상화를 그려보세요
          </p>
        </div>
      )}

      {/* Audio level indicator */}
      {isActive && (
        <div className="absolute top-6 left-6 flex flex-col gap-2 z-10">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full transition-colors ${debugSpeaking ? 'bg-neon-green' : 'bg-muted-foreground/30'}`} />
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
          {/* Threshold marker */}
          <div className="w-32 relative h-0">
            <div
              className="absolute top-[-10px] w-px h-1.5 bg-primary/60"
              style={{ left: `${Math.min(100, threshold * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground/50 font-mono">
            {debugVolume.toFixed(3)} / {threshold.toFixed(3)}
          </span>
        </div>
      )}

      {/* Recording indicator */}
      {isActive && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground tracking-wider uppercase">녹음 중</span>
        </div>
      )}
    </div>
  );
}
