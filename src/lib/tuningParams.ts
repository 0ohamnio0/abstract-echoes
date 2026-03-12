// Tuning parameters for sound classification and per-type visualization
// Each param has: value, min, max, step, label

export interface ParamDef {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
}

export interface TuningParams {
  // === Classification ===
  yamnetScoreThreshold: ParamDef;
  yamnetMaxResults: ParamDef;

  // === Voice visualization ===
  voiceFlowCount: ParamDef;
  voiceLineSize: ParamDef;
  voiceCursorSpeed: ParamDef;
  voiceStippleProb: ParamDef;
  voiceStippleSize: ParamDef;
  voiceNebulaProb: ParamDef;
  voiceSpiralProb: ParamDef;
  voicePitchSensitivity: ParamDef;

  // === Snap visualization ===
  snapStarburstSize: ParamDef;
  snapRingCount: ParamDef;
  snapShardCount: ParamDef;
  snapStippleSize: ParamDef;

  // === Clap visualization ===
  clapRingCount: ParamDef;
  clapGlowRadius: ParamDef;
  clapSplatCount: ParamDef;

  // === Laugh visualization ===
  laughBubbleCount: ParamDef;
  laughBubbleSize: ParamDef;
  laughDotCount: ParamDef;
  laughSpiralProb: ParamDef;

  // === Trigger: 사랑해 ===
  loveRingCount: ParamDef;
  loveNebulaCount: ParamDef;
  loveSpiralCount: ParamDef;

  // === Trigger: 안녕 ===
  helloSparkleCount: ParamDef;
  helloRingCount: ParamDef;

  // === Trigger: 행복 ===
  happyClusterCount: ParamDef;
  happyTendrilCount: ParamDef;

  // === Trigger: 와/대박 ===
  wowBurstCount: ParamDef;
  wowSparkCount: ParamDef;

  // === Trigger: 고마워 ===
  thanksEmberCount: ParamDef;
  thanksGlowAlpha: ParamDef;

  // === Trigger: 미안해 ===
  sorryDropCount: ParamDef;
  sorryMistCount: ParamDef;

  // === Trigger: 보고싶어 ===
  missyouStarCount: ParamDef;
  missyouSpiralCount: ParamDef;
}

export function createDefaultParams(): TuningParams {
  return {
    // Classification
    yamnetScoreThreshold: { value: 0.04, min: 0.01, max: 0.5, step: 0.01, label: 'YAMNet 점수 임계값' },
    yamnetMaxResults:     { value: 6,    min: 1,    max: 20,  step: 1,    label: 'YAMNet 최대 결과 수' },

    // Voice
    voiceFlowCount:   { value: 3,    min: 1,    max: 8,    step: 1,    label: '흐름 라인 수' },
    voiceLineSize:    { value: 2.4,  min: 0.2,  max: 8,    step: 0.1,  label: '라인 굵기 배율' },
    voiceCursorSpeed: { value: 1.1,  min: 0.2,  max: 3,    step: 0.1,  label: '커서 이동 속도' },
    voiceStippleProb: { value: 0.21, min: 0,    max: 0.5,  step: 0.01, label: '점묘 확률' },
    voiceStippleSize: { value: 37,   min: 5,    max: 60,   step: 1,    label: '점묘 크기' },
    voiceNebulaProb:  { value: 0.025,min: 0,    max: 0.2,  step: 0.005,label: '성운 확률' },
    voiceSpiralProb:  { value: 0.009,min: 0,    max: 0.05, step: 0.001,label: '나선 확률' },
    voicePitchSensitivity: { value: 1.8, min: 0, max: 5, step: 0.1, label: '피치 방향 민감도' },

    // Snap
    snapStarburstSize: { value: 12, min: 5,  max: 120, step: 5, label: '폭발 크기' },
    snapRingCount:     { value: 1,  min: 1,  max: 5,   step: 1, label: '링 개수' },
    snapShardCount:    { value: 4,  min: 2,  max: 30,  step: 1, label: '파편 개수' },
    snapStippleSize:   { value: 8,  min: 5,  max: 120, step: 5, label: '점묘 크기' },

    // Clap
    clapRingCount:  { value: 1,  min: 1,  max: 6,   step: 1, label: '충격파 링 수' },
    clapGlowRadius: { value: 10, min: 5,  max: 150, step: 5, label: '글로우 반경' },
    clapSplatCount: { value: 3,  min: 1,  max: 40,  step: 1, label: '스플래터 수' },

    // Laugh
    laughBubbleCount: { value: 1,    min: 1,  max: 10,  step: 1,    label: '버블 기본 개수' },
    laughBubbleSize:  { value: 3,    min: 1,  max: 30,  step: 1,    label: '버블 기본 크기' },
    laughDotCount:    { value: 3,    min: 1,  max: 30,  step: 1,    label: '점 개수' },
    laughSpiralProb:  { value: 0.06, min: 0,  max: 0.5, step: 0.01, label: '나선 확률' },

    // Trigger: 사랑해
    loveRingCount:    { value: 8,  min: 1,  max: 8,  step: 1,    label: '❤️ 링 개수' },
    loveNebulaCount:  { value: 8,  min: 0,  max: 8,  step: 1,    label: '❤️ 성운 개수' },
    loveSpiralCount:  { value: 8,  min: 0,  max: 8,  step: 1,    label: '❤️ 나선 개수' },

    // Trigger: 안녕
    helloSparkleCount:{ value: 95, min: 10, max: 200, step: 5,   label: '👋 스파클 수' },
    helloRingCount:   { value: 6,  min: 1,  max: 10, step: 1,    label: '👋 링 개수' },

    // Trigger: 행복
    happyClusterCount:{ value: 6,  min: 2,  max: 12, step: 1,    label: '🌈 클러스터 수' },
    happyTendrilCount:{ value: 6,  min: 0,  max: 12, step: 1,    label: '🌈 덩굴 수' },

    // Trigger: 와/대박
    wowBurstCount:    { value: 3,  min: 1,  max: 10, step: 1,    label: '🎆 폭발 수' },
    wowSparkCount:    { value: 20, min: 5,  max: 60, step: 5,    label: '🎆 불꽃 수' },

    // Trigger: 고마워
    thanksEmberCount: { value: 28, min: 3,  max: 40, step: 1,    label: '🙏 불씨 수' },
    thanksGlowAlpha:  { value: 0.05, min: 0.02, max: 0.3, step: 0.01, label: '🙏 글로우 강도' },

    // Trigger: 미안해
    sorryDropCount:   { value: 7,  min: 2,  max: 20, step: 1,    label: '💧 물방울 수' },
    sorryMistCount:   { value: 8,  min: 0,  max: 10, step: 1,    label: '💧 안개 수' },

    // Trigger: 보고싶어
    missyouStarCount: { value: 75, min: 10, max: 100, step: 5,   label: '💜 별빛 수' },
    missyouSpiralCount:{ value: 5, min: 0,  max: 6,  step: 1,    label: '💜 나선 수' },
  };
}

// Extract just the numeric values for engine use
export type ParamValues = { [K in keyof TuningParams]: number };

export function extractValues(params: TuningParams): ParamValues {
  const result = {} as any;
  for (const key of Object.keys(params)) {
    result[key] = (params as any)[key].value;
  }
  return result;
}

// Export as JSON string for user to copy
export function paramsToJSON(params: TuningParams): string {
  const obj: Record<string, number> = {};
  for (const [key, def] of Object.entries(params)) {
    obj[key] = (def as ParamDef).value;
  }
  return JSON.stringify(obj, null, 2);
}
