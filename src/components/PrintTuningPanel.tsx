import type { PrintParams } from './SoundCanvas';

interface Props {
  visible: boolean;
  onClose: () => void;
  params: PrintParams;
  onChange: (next: PrintParams) => void;
  onReset: () => void;
}

export default function PrintTuningPanel({ visible, onClose, params, onChange, onReset }: Props) {
  if (!visible) return null;

  const set = <K extends keyof PrintParams>(key: K, value: PrintParams[K]) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div
      className="absolute top-4 left-4 w-[340px] max-h-[95vh] overflow-y-auto bg-[#d8d8d8] border border-black/30 p-3 text-black"
      style={{ fontFamily: '"Courier New", ui-monospace, monospace', zIndex: 60 }}
    >
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-black/30">
        <span className="font-bold tracking-wider text-sm">SOUND WAVE PRINT</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onReset}
            className="text-[10px] px-2 py-0.5 border border-black/40 hover:bg-black/10"
            title="기본값으로 되돌리기"
          >RESET</button>
          <button type="button" onClick={onClose} className="text-black/60 hover:text-black text-lg leading-none">×</button>
        </div>
      </div>

      <Slider label="Stroke count" value={params.strokeCount} min={100} max={500} step={10} onChange={v => set('strokeCount', Math.round(v))} digits={0} />
      <Slider label="Stroke width" value={params.strokeWidth} min={1} max={8} step={1} onChange={v => set('strokeWidth', Math.round(v))} suffix="px" digits={0} />

      <div className="mt-3 pt-2 border-t border-black/30">
        <Slider label="Amp boost" value={params.ampBoost} min={0.5} max={5} step={0.05} onChange={v => set('ampBoost', v)} digits={2} />
        <Slider label="Peak clamp" value={params.peakClamp} min={0.3} max={1.0} step={0.01} onChange={v => set('peakClamp', v)} digits={2} />
        <Slider label="Min half-height" value={params.minHalfH} min={0} max={10} step={1} onChange={v => set('minHalfH', Math.round(v))} suffix="px" digits={0} />
      </div>

      <div className="mt-3 pt-2 border-t border-black/30">
        <Slider label="Padding X" value={params.padX} min={0} max={0.15} step={0.005} onChange={v => set('padX', v)} suffix="" digits={3} />
        <Slider label="Padding Y" value={params.padY} min={0} max={0.25} step={0.005} onChange={v => set('padY', v)} suffix="" digits={3} />
      </div>

      <div className="mt-3 pt-2 border-t border-black/30">
        <Slider label="Saturation" value={params.saturation} min={0.3} max={1.0} step={0.02} onChange={v => set('saturation', v)} digits={2} />
        <Slider label="Lightness" value={params.lightness} min={0.2} max={0.8} step={0.02} onChange={v => set('lightness', v)} digits={2} />
      </div>

      <div className="mt-3 pt-2 border-t border-black/30 text-[10px] text-black/60 leading-snug">
        체험 1회 완료 후 showcase 화면에서 실시간 튜닝 가능.
        값은 자동 저장.
      </div>
    </div>
  );
}

function Slider({
  label, value, min, max, step, onChange, suffix = '', digits,
}: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; suffix?: string; digits?: number;
}) {
  const fixed = digits ?? (step < 0.01 ? 3 : step < 0.1 ? 2 : step < 1 ? 1 : 0);
  return (
    <div className="mb-1.5">
      <div className="flex justify-between text-xs mb-0.5">
        <span>{label}</span>
        <span>{value.toFixed(fixed)}{suffix}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-black/20 rounded appearance-none cursor-pointer accent-sky-600"
      />
    </div>
  );
}
