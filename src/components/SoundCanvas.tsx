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

  const loop = useCallback(() => {
    if (!analyzerRef.current || !engineRef.current) return;
    const features = analyzerRef.current.getFeatures();
    engineRef.current.update(features);
    animFrameRef.current = requestAnimationFrame(loop);
  }, []);

  const start = useCallback(async () => {
    if (!canvasRef.current) return;
    
    const analyzer = new AudioAnalyzer();
    await analyzer.start();
    analyzerRef.current = analyzer;

    engineRef.current = new GenerativeEngine(canvasRef.current);
    setIsActive(true);
    animFrameRef.current = requestAnimationFrame(loop);
  }, [loop]);

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

      {/* Controls overlay */}
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
            <button
              onClick={stop}
              className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light"
            >
              정지
            </button>
            <button
              onClick={clear}
              className="px-6 py-3 rounded-full bg-muted border border-border text-muted-foreground hover:text-foreground transition-all duration-300 text-sm tracking-widest uppercase font-light"
            >
              초기화
            </button>
            <button
              onClick={save}
              className="px-6 py-3 rounded-full bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-all duration-300 glow-pink text-sm tracking-widest uppercase font-light"
            >
              저장
            </button>
          </>
        )}
      </div>

      {/* Title overlay - fades when active */}
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

      {/* Speaking indicator */}
      {isActive && (
        <div className="absolute top-6 right-6 flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-xs text-muted-foreground tracking-wider uppercase">녹음 중</span>
        </div>
      )}
    </div>
  );
}
