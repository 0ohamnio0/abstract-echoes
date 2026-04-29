import { useEffect, useState } from 'react';
import type { Oscilloscope } from '@/lib/oscilloscope';

export interface SignalGenSettings {
  enabled: boolean;
  xExpr: string;
  yExpr: string;
  aValue: number;
  aExp: number;
  bValue: number;
  bExp: number;
}

interface Props {
  oscilloscope: Oscilloscope | null;
  visible: boolean;
  onClose: () => void;
  preAmp: number;
  onPreAmpChange: (v: number) => void;
  swapXY: boolean;
  onSwapXYChange: (v: boolean) => void;
  freeze: boolean;
  onFreezeChange: (v: boolean) => void;
  sigGen: SignalGenSettings;
  onSigGenChange: (s: SignalGenSettings) => void;
  hue: number;
  onHueChange: (v: number) => void;
}

export default function OscilloscopePanel({
  oscilloscope,
  visible,
  onClose,
  preAmp,
  onPreAmpChange,
  swapXY,
  onSwapXYChange,
  freeze,
  onFreezeChange,
  sigGen,
  onSigGenChange,
  hue,
  onHueChange,
}: Props) {
  const [mainGain, setMainGain] = useState(0.3);
  const [exposure, setExposure] = useState(-0.5);
  const [persistence, setPersistence] = useState(-0.04);
  const [lineSize, setLineSize] = useState(0.018);
  const [intensity, setIntensity] = useState(0.067);
  const [invertXY, setInvertXY] = useState(false);

  useEffect(() => {
    if (!oscilloscope) return;
    oscilloscope.setParam('mainGain', mainGain);
    oscilloscope.setParam('exposureStops', exposure);
    oscilloscope.setParam('persistence', persistence);
    oscilloscope.setParam('hue', hue);
    oscilloscope.setParam('lineSize', lineSize);
    oscilloscope.setParam('intensity', intensity);
    oscilloscope.setParam('invertXY', invertXY);
  }, [oscilloscope, mainGain, exposure, persistence, hue, lineSize, intensity, invertXY]);

  if (!visible) return null;

  const aEffective = sigGen.aValue * Math.pow(10, sigGen.aExp);
  const bEffective = sigGen.bValue * Math.pow(10, sigGen.bExp);

  return (
    <div
      className="absolute top-4 right-4 w-[360px] max-h-[95vh] overflow-y-auto bg-[#d8d8d8] border border-black/30 p-3 z-50 text-black"
      style={{ fontFamily: '"Courier New", ui-monospace, monospace' }}
    >
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-black/30">
        <span className="font-bold tracking-wider text-sm">XXY OSCILLOSCOPE</span>
        <button type="button" onClick={onClose} className="text-black/60 hover:text-black text-lg leading-none">×</button>
      </div>

      <Slider label="Gain" value={mainGain} min={-1} max={4} step={0.05} onChange={setMainGain} />
      <Slider label="Intensity" value={exposure} min={-2} max={4} step={0.1} onChange={setExposure} />
      <Slider label="Audio volume (pre-amp)" value={preAmp} min={1} max={30} step={0.5} onChange={onPreAmpChange} suffix="×" />

      <div className="flex gap-3 mt-1 text-xs">
        <Checkbox label="Swap x / y" checked={swapXY} onChange={onSwapXYChange} />
        <Checkbox label="Invert x and y" checked={invertXY} onChange={setInvertXY} />
      </div>

      <div className="mt-3 pt-2 border-t border-black/30">
        <Checkbox label="SIGNAL GENERATOR" checked={sigGen.enabled} onChange={(v) => onSigGenChange({ ...sigGen, enabled: v })} bold />
        <div className="flex items-center gap-1 mt-1 text-xs">
          <span className="w-3">x =</span>
          <input
            type="text"
            value={sigGen.xExpr}
            onChange={(e) => onSigGenChange({ ...sigGen, xExpr: e.target.value })}
            className="flex-1 bg-white border border-black/30 px-1 py-0.5 text-xs"
          />
        </div>
        <div className="flex items-center gap-1 mt-1 text-xs">
          <span className="w-3">y =</span>
          <input
            type="text"
            value={sigGen.yExpr}
            onChange={(e) => onSigGenChange({ ...sigGen, yExpr: e.target.value })}
            className="flex-1 bg-white border border-black/30 px-1 py-0.5 text-xs"
          />
        </div>
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-black/70">
            <span>Parameter a</span>
            <span>×10<sup>{sigGen.aExp}</sup></span>
          </div>
          <input type="range" min={0} max={3} step={1} value={sigGen.aExp}
            onChange={(e) => onSigGenChange({ ...sigGen, aExp: parseInt(e.target.value, 10) })}
            className="w-full h-1 bg-black/20 accent-sky-600" />
          <div className="flex justify-between text-[10px] text-black/70 mt-1">
            <span>= {aEffective.toFixed(2)}</span>
            <span>{sigGen.aValue.toFixed(2)}</span>
          </div>
          <input type="range" min={0} max={10} step={0.01} value={sigGen.aValue}
            onChange={(e) => onSigGenChange({ ...sigGen, aValue: parseFloat(e.target.value) })}
            className="w-full h-1 bg-black/20 accent-sky-600" />
        </div>
        <div className="mt-2">
          <div className="flex justify-between text-[10px] text-black/70">
            <span>Parameter b</span>
            <span>×10<sup>{sigGen.bExp}</sup></span>
          </div>
          <input type="range" min={0} max={3} step={1} value={sigGen.bExp}
            onChange={(e) => onSigGenChange({ ...sigGen, bExp: parseInt(e.target.value, 10) })}
            className="w-full h-1 bg-black/20 accent-sky-600" />
          <div className="flex justify-between text-[10px] text-black/70 mt-1">
            <span>= {bEffective.toFixed(2)}</span>
            <span>{sigGen.bValue.toFixed(2)}</span>
          </div>
          <input type="range" min={0} max={10} step={0.01} value={sigGen.bValue}
            onChange={(e) => onSigGenChange({ ...sigGen, bValue: parseFloat(e.target.value) })}
            className="w-full h-1 bg-black/20 accent-sky-600" />
        </div>
      </div>

      <div className="mt-3 pt-2 border-t border-black/30">
        <Slider label="Hue" value={hue} min={0} max={360} step={1} onChange={onHueChange} digits={0} />
        <Slider label="Persistence" value={persistence} min={-1} max={1} step={0.01} onChange={setPersistence} />
        <Slider label="Line size" value={lineSize} min={0.002} max={0.05} step={0.001} onChange={setLineSize} digits={3} />
        <Slider label="Line intensity" value={intensity} min={0.001} max={0.1} step={0.001} onChange={setIntensity} digits={3} />
        <div className="mt-1">
          <Checkbox label="Freeze image" checked={freeze} onChange={onFreezeChange} />
        </div>
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
  const fixed = digits ?? (step < 0.1 ? 2 : step < 1 ? 1 : 0);
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

function Checkbox({ label, checked, onChange, bold }: {
  label: string; checked: boolean; onChange: (v: boolean) => void; bold?: boolean;
}) {
  return (
    <label className={`inline-flex items-center gap-1.5 cursor-pointer ${bold ? 'font-bold text-sm tracking-wider' : 'text-xs'}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-sky-600"
      />
      <span>{label}</span>
    </label>
  );
}
