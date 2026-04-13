// Tuning parameters — Oscilloscope engine (2026-04-13 재설계)

export interface ParamDef {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
}

export interface TuningParams {
  lineCore: ParamDef;
  bloomPasses: ParamDef;
  bloomIntensity: ParamDef;
  waveformGain: ParamDef;
  sessionGapMs: ParamDef;
  historyLen: ParamDef;
  idleAmplitude: ParamDef;
  trailDecay: ParamDef;
  portraitWidth: ParamDef;
  portraitHeight: ParamDef;
}

export function createDefaultParams(): TuningParams {
  return {
    lineCore:       { value: 1.5,  min: 0.5, max: 6,    step: 0.1,  label: '코어 라인 두께 (px)' },
    bloomPasses:    { value: 3,    min: 1,   max: 4,    step: 1,    label: '블룸 레이어 수' },
    bloomIntensity: { value: 16,   min: 2,   max: 48,   step: 1,    label: '블룸 강도 (shadowBlur)' },
    waveformGain:   { value: 1.6,  min: 0.2, max: 4,    step: 0.1,  label: '진폭 배율' },
    sessionGapMs:   { value: 2000, min: 500, max: 6000, step: 100,  label: '세션 경계 갭 (ms)' },
    historyLen:     { value: 1024, min: 256, max: 2048, step: 64,   label: '히스토리 샘플 수' },
    idleAmplitude:  { value: 0.08, min: 0,   max: 0.3,  step: 0.01, label: 'Idle 파형 강도' },
    trailDecay:     { value: 0.22, min: 0.05, max: 1,   step: 0.01, label: '잔상 페이드' },
    portraitWidth:  { value: 1080, min: 540, max: 1440, step: 60,   label: '폰 월페이퍼 가로 (px)' },
    portraitHeight: { value: 2340, min: 1170, max: 3120, step: 60,  label: '폰 월페이퍼 세로 (px)' },
  };
}

export type ParamValues = { [K in keyof TuningParams]: number };

export function extractValues(params: TuningParams): ParamValues {
  const result = {} as any;
  for (const key of Object.keys(params)) {
    result[key] = (params as any)[key].value;
  }
  return result;
}

export function paramsToJSON(params: TuningParams): string {
  const obj: Record<string, number> = {};
  for (const [key, def] of Object.entries(params)) {
    obj[key] = (def as ParamDef).value;
  }
  return JSON.stringify(obj, null, 2);
}
