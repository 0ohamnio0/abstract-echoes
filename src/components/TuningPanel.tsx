import { useState, useCallback } from 'react';
import { TuningParams, ParamDef, paramsToJSON } from '@/lib/tuningParams';
import { toast } from 'sonner';

interface TuningPanelProps {
  params: TuningParams;
  onChange: (key: string, value: number) => void;
}

type SectionKey = 'classification' | 'voice' | 'snap' | 'clap' | 'laugh';

const SECTIONS: { key: SectionKey; label: string; icon: string; keys: string[] }[] = [
  {
    key: 'classification', label: '분류 감도', icon: '🧠',
    keys: ['yamnetScoreThreshold', 'yamnetMaxResults'],
  },
  {
    key: 'voice', label: '목소리 시각화', icon: '🎤',
    keys: ['voiceFlowCount', 'voiceLineSize', 'voiceCursorSpeed', 'voicePitchSensitivity', 'voiceStippleProb', 'voiceStippleSize', 'voiceNebulaProb', 'voiceSpiralProb'],
  },
  {
    key: 'snap', label: '스냅 시각화', icon: '✨',
    keys: ['snapStarburstSize', 'snapRingCount', 'snapShardCount', 'snapStippleSize'],
  },
  {
    key: 'clap', label: '박수 시각화', icon: '👏',
    keys: ['clapRingCount', 'clapGlowRadius', 'clapSplatCount'],
  },
  {
    key: 'laugh', label: '웃음 시각화', icon: '😄',
    keys: ['laughBubbleCount', 'laughBubbleSize', 'laughDotCount', 'laughSpiralProb'],
  },
];

export default function TuningPanel({ params, onChange }: TuningPanelProps) {
  const [openSections, setOpenSections] = useState<Set<SectionKey>>(new Set(['classification']));

  const toggleSection = useCallback((key: SectionKey) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const copyParams = useCallback(() => {
    const json = paramsToJSON(params);
    navigator.clipboard.writeText(json).then(() => {
      toast.success('파라미터가 클립보드에 복사되었습니다');
    });
  }, [params]);

  return (
    <div className="absolute top-6 right-6 z-20 w-72 max-h-[80vh] overflow-y-auto bg-card/95 backdrop-blur-md border border-border rounded-lg shadow-xl">
      <div className="sticky top-0 bg-card/95 backdrop-blur-md border-b border-border p-3 flex items-center justify-between">
        <h3 className="text-xs text-foreground tracking-widest uppercase font-medium">🎛️ 튜닝 패널</h3>
        <button
          onClick={copyParams}
          className="px-2 py-1 text-[10px] rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors tracking-wider uppercase"
          title="현재 파라미터를 JSON으로 복사"
        >
          📋 복사
        </button>
      </div>

      <div className="p-2 space-y-1">
        {SECTIONS.map(section => (
          <div key={section.key} className="border border-border/40 rounded-md overflow-hidden">
            <button
              onClick={() => toggleSection(section.key)}
              className="w-full px-3 py-2 flex items-center justify-between text-xs text-foreground/80 hover:bg-muted/50 transition-colors"
            >
              <span>{section.icon} {section.label}</span>
              <span className="text-muted-foreground">{openSections.has(section.key) ? '▾' : '▸'}</span>
            </button>
            {openSections.has(section.key) && (
              <div className="px-3 pb-3 space-y-3">
                {section.keys.map(key => {
                  const def = (params as any)[key] as ParamDef;
                  return (
                    <div key={key} className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] text-muted-foreground">{def.label}</label>
                        <span className="text-[10px] text-muted-foreground font-mono w-14 text-right">
                          {def.step < 0.01 ? def.value.toFixed(3) : def.step < 1 ? def.value.toFixed(2) : def.value.toFixed(0)}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        value={def.value}
                        onChange={(e) => onChange(key, parseFloat(e.target.value))}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer accent-primary bg-muted"
                      />
                      <div className="flex justify-between text-[9px] text-muted-foreground/40">
                        <span>{def.min}</span>
                        <span className="font-mono text-muted-foreground/30">{key}</span>
                        <span>{def.max}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
