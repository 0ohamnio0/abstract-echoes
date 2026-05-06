import type { PrintParams } from './SoundCanvas';

interface Props {
  visible: boolean;
  onClose: () => void;
  params: PrintParams;
  onChange: (next: PrintParams) => void;
  onReset: () => void;
  portraitPreview?: string | null;
}

export default function PrintTuningPanel({ visible, onClose, params, onChange, onReset, portraitPreview }: Props) {
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
        <span className="font-bold tracking-wider text-sm">SHOWCASE SWEEP</span>
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

      <Slider label="Amp scale" value={params.ampScale} min={0.2} max={4.0} step={0.05} onChange={v => set('ampScale', v)} digits={2} />
      <Slider label="Width base" value={params.widthBase} min={0.3} max={4.0} step={0.05} onChange={v => set('widthBase', v)} digits={2} />
      <Slider label="Width boost" value={params.widthBoost} min={0.5} max={6.0} step={0.05} onChange={v => set('widthBoost', v)} digits={2} />

      <div className="mt-3 pt-2 border-t border-black/30">
        <Slider label="Line size ×" value={params.lineSizeMul} min={0.5} max={6.0} step={0.05} onChange={v => set('lineSizeMul', v)} digits={2} />
        <Slider label="Intensity ×" value={params.intensityMul} min={0.5} max={6.0} step={0.05} onChange={v => set('intensityMul', v)} digits={2} />
        <Slider label="Passes" value={params.passes} min={1} max={6} step={1} onChange={v => set('passes', Math.round(v))} digits={0} />
      </div>

      <div className="mt-3 pt-2 border-t border-black/30">
        <div className="font-bold tracking-wider text-xs mb-1">PORTRAIT LAYOUT</div>
        <div className="text-[10px] text-black/55 mb-1">상단 OH!BREMEN</div>
        <Slider label="Top logo size ×" value={params.banwonScale} min={0.3} max={1.5} step={0.02} onChange={v => set('banwonScale', v)} digits={2} />
        <Slider label="Top logo Y" value={params.banwonOffsetY} min={-0.05} max={0.20} step={0.005} onChange={v => set('banwonOffsetY', v)} digits={3} />
        <Slider label="Wave gap" value={params.banwonGap} min={-0.05} max={0.20} step={0.005} onChange={v => set('banwonGap', v)} digits={3} />
        <div className="text-[10px] text-black/55 mt-2 mb-1">하단 동물 로고</div>
        <Slider label="Logo size ×" value={params.logoScale} min={0.5} max={3.0} step={0.05} onChange={v => set('logoScale', v)} digits={2} />
        <Slider label="Logo Y" value={params.logoOffsetY} min={-0.20} max={0.30} step={0.005} onChange={v => set('logoOffsetY', v)} digits={3} />
        <div className="text-[10px] text-black/55 mt-2 mb-1">태그라인</div>
        <Slider label="Tagline size ×" value={params.taglineScale} min={0.5} max={2.0} step={0.05} onChange={v => set('taglineScale', v)} digits={2} />
        <Slider label="Tag Y" value={params.tagOffsetY} min={-0.20} max={0.30} step={0.005} onChange={v => set('tagOffsetY', v)} digits={3} />
        {portraitPreview && (
          <div className="mt-2 flex flex-col items-center gap-1.5">
            <img
              src={portraitPreview}
              alt="portrait preview"
              className="w-[160px] h-auto border border-black/40"
              style={{ imageRendering: 'auto' }}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const w = window.open();
                  if (w) {
                    w.document.title = 'QR 다운로드 미리보기 (1080×2340)';
                    w.document.body.style.cssText = 'margin:0;background:#000;display:flex;align-items:center;justify-content:center;min-height:100vh';
                    const img = w.document.createElement('img');
                    img.src = portraitPreview;
                    img.style.cssText = 'max-width:100%;max-height:100vh;height:auto';
                    w.document.body.appendChild(img);
                  }
                }}
                className="text-[10px] px-2 py-0.5 border border-black/40 hover:bg-black/10"
                title="새 탭에서 풀해상도로 열기"
              >새 탭</button>
              <a
                href={portraitPreview}
                download={`bremen-qr-preview-${Date.now()}.png`}
                className="text-[10px] px-2 py-0.5 border border-black/40 hover:bg-black/10"
                title="PNG 파일로 다운로드"
              >PNG 저장</a>
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 pt-2 border-t border-black/30 text-[10px] text-black/60 leading-snug">
        showcase 진입 후 P 키로 토글. 슬라이더 → 액자 안 이미지 실시간 반영.<br />
        값은 자동 저장. RESET으로 기본값 복귀.
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
