import { AudioFeatures, SoundType } from './audioAnalyzer';
import { ParamValues } from './tuningParams';
import type { TriggerWord } from './speechTrigger';

// Simple 2D Perlin-like noise (value noise with smoothstep)
const _noiseP: number[] = [];
for (let i = 0; i < 512; i++) _noiseP[i] = Math.random();
function noise2D(x: number, y: number): number {
  const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = _noiseP[(xi + _noiseP[yi & 255]) & 255];
  const b = _noiseP[(xi + 1 + _noiseP[yi & 255]) & 255];
  const c = _noiseP[(xi + _noiseP[(yi + 1) & 255]) & 255];
  const d = _noiseP[(xi + 1 + _noiseP[(yi + 1) & 255]) & 255];
  return a + u * (b - a) + v * (c - a) + u * v * (a - b - c + d); // 0..1
}

const NEON_COLORS = [
  [330, 100, 65], [180, 100, 50], [120, 100, 55], [25, 100, 55],
  [220, 100, 60], [300, 100, 60], [55, 100, 55], [0, 100, 55],
  [270, 80, 60], [350, 100, 70], [160, 100, 45], [40, 100, 60],
];

// Snap: cool neon crystalline (matching main palette)
const SNAP_PALETTE = [[180, 100, 50], [220, 100, 60], [270, 80, 60], [160, 100, 45]];
// Clap: warm neon (matching main palette)
const CLAP_PALETTE = [[330, 100, 65], [25, 100, 55], [55, 100, 55], [0, 100, 55]];
// Laugh: vibrant neon playful (matching main palette)
const LAUGH_PALETTE = [[300, 100, 60], [120, 100, 55], [350, 100, 70], [270, 80, 60], [55, 100, 55]];

interface TrailPoint {
  x: number; y: number;
  hue: number; sat: number; light: number;
  size: number; volume: number;
}

interface FlowLine {
  points: TrailPoint[];
  life: number;
  style: 'smooth' | 'dotted' | 'glow';
}

interface Burst {
  x: number; y: number;
  hue: number; sat: number; light: number;
  size: number; life: number;
  type: string;
  vx: number; vy: number;
}

export class GenerativeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private accCanvas: HTMLCanvasElement;
  private accCtx: CanvasRenderingContext2D;
  private glowCanvas: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;

  private time = 0;
  private seedX: number;
  private seedY: number;
  private colorOffset: number;
  private cursorX: number;
  private cursorY: number;

  private flows: FlowLine[] = [];
  private bursts: Burst[] = [];
  private activeFlows: FlowLine[] = [];
  private framesSinceSpeaking = 0;
  private lastSoundType: SoundType = 'silence';
  private lastClapTime = 0;
  private lastSnapTime = 0;
  private lastLaughTime = 0;

  // Scheduled delayed effects queue
  private scheduledEffects: { time: number; fn: () => void }[] = [];

  // Tuning params (set externally)
  params: ParamValues | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.seedX = Math.random() * 1000;
    this.seedY = Math.random() * 1000;
    this.colorOffset = Math.random() * 360;
    this.cursorX = canvas.width * (0.3 + Math.random() * 0.4);
    this.cursorY = canvas.height * (0.3 + Math.random() * 0.4);

    this.accCanvas = document.createElement('canvas');
    this.accCanvas.width = canvas.width;
    this.accCanvas.height = canvas.height;
    this.accCtx = this.accCanvas.getContext('2d')!;
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, canvas.width, canvas.height);

    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.width = Math.floor(canvas.width / 4);
    this.glowCanvas.height = Math.floor(canvas.height / 4);
    this.glowCtx = this.glowCanvas.getContext('2d')!;
  }

  update(features: AudioFeatures) {
    this.time += 0.016;

    if (features.isSpeaking) {
      this.framesSinceSpeaking = 0;
      const speedMul = this.params?.voiceCursorSpeed ?? 1;
      const speed = (1.5 + features.volume * 6) * speedMul;
      // Pitch drives horizontal direction: high pitch → left, low pitch → right
      const pitchNorm = Math.max(0, Math.min(1, (features.pitch - 80) / 500));
      const pitchSens = this.params?.voicePitchSensitivity ?? 1.8;
      const pitchBias = (pitchNorm - 0.5) * -speed * pitchSens;
      this.cursorX += Math.sin(this.time * 0.43 + this.seedX) * speed * 0.4 + pitchBias;
      this.cursorY += Math.cos(this.time * 0.37 + this.seedY) * speed + Math.cos(this.time * 0.9 + this.seedY * 2) * speed * 0.3 + Math.sin(this.time * 0.21) * speed * 0.5;
      const m = 60;
      if (this.cursorX < m) this.cursorX += (m - this.cursorX) * 0.1;
      if (this.cursorX > this.canvas.width - m) this.cursorX -= (this.cursorX - (this.canvas.width - m)) * 0.1;
      if (this.cursorY < m) this.cursorY += (m - this.cursorY) * 0.1;
      if (this.cursorY > this.canvas.height - m) this.cursorY -= (this.cursorY - (this.canvas.height - m)) * 0.1;

      this.lastSoundType = features.soundType;

      switch (features.soundType) {
        case 'snap': this.onSnapOnce(features); this.endActiveFlows(); break;
        case 'clap': this.onClapOnce(features); this.endActiveFlows(); break;
        case 'laugh': this.onLaughOnce(features); break;
        case 'voice': this.onVoice(features); break;
      }
    } else {
      this.framesSinceSpeaking++;
      if (this.framesSinceSpeaking > 10) this.endActiveFlows();
      // No cursor movement when not speaking
    }

    // Process scheduled delayed effects
    this.processScheduledEffects();

    this.updateBursts();
    this.render();
  }

  private scheduleEffect(delaySec: number, fn: () => void) {
    this.scheduledEffects.push({ time: this.time + delaySec, fn });
  }

  private processScheduledEffects() {
    const ready = this.scheduledEffects.filter(e => this.time >= e.time);
    for (const e of ready) e.fn();
    this.scheduledEffects = this.scheduledEffects.filter(e => this.time < e.time);
  }

  private pick(palette: number[][]): [number, number, number] {
    const c = palette[Math.floor(Math.random() * palette.length)];
    return [c[0], c[1], c[2]];
  }

  private pickVoiceColor(f: AudioFeatures): [number, number, number] {
    const idx = Math.abs(Math.floor((f.pitch / 600 * NEON_COLORS.length + this.colorOffset / 25))) % NEON_COLORS.length;
    const [h, s, l] = NEON_COLORS[idx];
    return [(h + f.pitch * 0.04 + this.colorOffset + this.time * 2) % 360, s, l + f.volume * 10];
  }

  // ═══════════════════════════════════════════
  //  VOICE → flowing organic lines + stipple + spirals
  // ═══════════════════════════════════════════
  private onVoice(f: AudioFeatures) {
    const [h, s, l] = this.pickVoiceColor(f);
    const p = this.params;
    const flowCount = p?.voiceFlowCount ?? 3;
    const lineSizeMul = p?.voiceLineSize ?? 2;
    const stippleProb = p?.voiceStippleProb ?? 0.12;
    const stippleSize = p?.voiceStippleSize ?? 15;
    const nebulaProb = p?.voiceNebulaProb ?? 0.03;
    const spiralProb = p?.voiceSpiralProb ?? 0.008;

    while (this.activeFlows.length < flowCount) {
      const style: FlowLine['style'] = this.activeFlows.length === 0 ? 'smooth' : this.activeFlows.length === 1 ? 'dotted' : 'smooth';
      this.activeFlows.push({ points: [], life: 1, style });
    }
    for (let fi = 0; fi < this.activeFlows.length; fi++) {
      const flow = this.activeFlows[fi];
      const oa = (fi / this.activeFlows.length) * Math.PI * 2 + this.time * 0.3;
      const od = 10 + fi * 15 + f.volume * 30;
      const px = this.cursorX + Math.cos(oa) * od;
      const py = this.cursorY + Math.sin(oa) * od;
      flow.points.push({ x: px, y: py, hue: (h + fi * 40) % 360, sat: s, light: l, size: (1 + f.volume * 6 + f.bass * 4) * lineSizeMul, volume: f.volume });

      if (Math.random() < f.volume * stippleProb && fi === 0) this.drawStipple(px + (Math.random() - 0.5) * 40, py + (Math.random() - 0.5) * 40, h, s, l, stippleSize + f.volume * 50, 20 + Math.floor(f.volume * 60));
      if (Math.random() < spiralProb && fi === 0) this.drawSpiral(px, py, h, s, l, 25 + f.volume * 50);
      if (Math.random() < f.volume * nebulaProb) this.drawNebula(px + (Math.random() - 0.5) * 60, py + (Math.random() - 0.5) * 60, (h + fi * 40) % 360, s, l, 30 + f.volume * 60);
    }
  }

  // ═══════════════════════════════════════════
  //  PITCH STROKE → thin horizontal line stamped at pitch height
  // ═══════════════════════════════════════════
  private drawPitchSpore(f: AudioFeatures, h: number, s: number, l: number) {
    if (f.volume < 0.02) return;

    const ctx = this.accCtx;
    const pitchNorm = Math.max(0, Math.min(1, (f.pitch - 80) / 500));
    const margin = 80;
    const yTarget = this.canvas.height - margin - pitchNorm * (this.canvas.height - margin * 2);
    const xPos = margin + noise2D(this.time * 0.5, f.pitch * 0.01) * (this.canvas.width - margin * 2);

    const n = noise2D(xPos * 0.005, this.time * 0.3);
    const strokeHue = (h + pitchNorm * 60) % 360;
    const halfLen = (15 + n * 25 + f.volume * 30) * 0.5; // 1/2 scale
    const angle = noise2D(this.time * 0.15, f.pitch * 0.02) * 0.3; // slight tilt

    ctx.save();
    ctx.globalAlpha = 0.25 + f.volume * 0.35;
    ctx.strokeStyle = `hsl(${strokeHue}, ${s}%, ${Math.min(100, l + 10)}%)`;
    ctx.lineWidth = 0.5 + f.volume * 1;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 4;
    ctx.lineCap = 'round';

    const dx = Math.cos(angle) * halfLen;
    const dy = Math.sin(angle) * halfLen;
    ctx.beginPath();
    ctx.moveTo(xPos - dx, yTarget - dy);
    ctx.lineTo(xPos + dx, yTarget + dy);
    ctx.stroke();

    ctx.restore();
  }

  // ═══════════════════════════════════════════
  //  SNAP → crystalline starburst + ice shards + expanding ring
  // ═══════════════════════════════════════════
  private onSnapOnce(f: AudioFeatures) {
    const now = performance.now();
    if (now - this.lastSnapTime < 300) return;
    this.lastSnapTime = now;
    this.onSnap(f);
  }

  private onSnap(f: AudioFeatures) {
    const margin = 80;
    const cx = margin + Math.random() * (this.canvas.width - margin * 2);
    const cy = margin + Math.random() * (this.canvas.height - margin * 2);
    const n2 = noise2D(cx * 0.01, cy * 0.01);
    const sizeMul = 0.4 + n2 * 0.6;
    const [h, s, l] = this.pick(SNAP_PALETTE);
    const p = this.params;
    const starSize = (p?.snapStarburstSize ?? 12) * sizeMul;
    const ringCount = p?.snapRingCount ?? 1;
    const shardCount = p?.snapShardCount ?? 4;
    const stpSize = (p?.snapStippleSize ?? 8) * sizeMul;
    const ctx = this.accCtx;

    // Central flash
    this.bursts.push({ x: cx, y: cy, hue: h, sat: s, light: l, size: starSize + f.volume * 30 * sizeMul, life: 1, type: 'starburst', vx: 0, vy: 0 });
    // Expanding rings
    for (let ri = 0; ri < ringCount; ri++) {
      this.bursts.push({ x: cx, y: cy, hue: (h + ri * 40) % 360, sat: s, light: l, size: (3 + ri * 1.5) * sizeMul, life: 1 + ri * 0.2, type: 'ring', vx: 0, vy: 0 });
    }
    // Ice shards radiating outward
    const n = shardCount + Math.floor(noise2D(this.time, cx * 0.1) * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + noise2D(i, this.time) * 0.5;
      const sp = (3 + noise2D(cx * 0.05 + i, cy * 0.05) * 5) * sizeMul;
      const [sh, ss, sl] = this.pick(SNAP_PALETTE);
      this.bursts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, hue: sh, sat: ss, light: sl, size: (3 + noise2D(i * 0.3, this.time) * 8) * sizeMul, life: 1, type: 'shard' });
    }

    // Crystalline fracture lines — sharp geometric cracks radiating from center
    ctx.save();
    ctx.lineCap = 'round';
    const crackCount = 3 + Math.floor(f.volume * 5);
    for (let i = 0; i < crackCount; i++) {
      const [ch, cs, cl] = this.pick(SNAP_PALETTE);
      const angle = (i / crackCount) * Math.PI * 2 + noise2D(i * 2.1, this.time) * 0.8;
      const len = (20 + noise2D(i, this.time * 0.5) * 40 + f.volume * 30) * sizeMul;
      ctx.globalAlpha = 0.3 + f.volume * 0.4;
      ctx.strokeStyle = `hsl(${ch}, ${cs}%, ${Math.min(100, cl + 20)}%)`;
      ctx.lineWidth = (0.3 + noise2D(i * 0.7, this.time) * 1.2) * sizeMul;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 6;
      // Jagged crack with 2-3 segments
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      let px = cx, py = cy;
      const segs = 2 + Math.floor(Math.random() * 2);
      for (let seg = 0; seg < segs; seg++) {
        const frac = (seg + 1) / segs;
        const jitter = noise2D(i + seg * 3, this.time) * 12 * sizeMul;
        px = cx + Math.cos(angle) * len * frac + Math.cos(angle + Math.PI / 2) * jitter;
        py = cy + Math.sin(angle) * len * frac + Math.sin(angle + Math.PI / 2) * jitter;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();

    // Fine crystalline stipple
    this.drawStipple(cx, cy, h, s, 90, stpSize, Math.floor(40 * sizeMul));
  }

  // ═══════════════════════════════════════════
  //  CLAP → warm shockwave + scattered splatter + concentric rings
  // ═══════════════════════════════════════════
  private onClapOnce(f: AudioFeatures) {
    const now = performance.now();
    if (now - this.lastClapTime < 300) return;
    this.lastClapTime = now;
    this.onClap(f);
  }

  private onClap(f: AudioFeatures) {
    const margin = 100;
    const cx = margin + Math.random() * (this.canvas.width - margin * 2);
    const cy = margin + Math.random() * (this.canvas.height - margin * 2);
    const n2 = noise2D(cx * 0.01, cy * 0.01);
    const sizeMul = 0.4 + n2 * 0.6;
    const [h, s, l] = this.pick(CLAP_PALETTE);
    const p = this.params;
    const ringCount = p?.clapRingCount ?? 1;
    const glowRadius = ((p?.clapGlowRadius ?? 10) + f.volume * 40) * sizeMul;
    const baseSplatCount = p?.clapSplatCount ?? 3;
    const ctx = this.accCtx;

    // Shockwave rings
    for (let i = 0; i < ringCount; i++) {
      this.bursts.push({ x: cx, y: cy, hue: (h + i * 20) % 360, sat: s, light: l, size: (2 + i) * sizeMul, life: 1 + i * 0.15, type: 'ring', vx: 0, vy: 0 });
    }

    // Central glow
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
    grad.addColorStop(0, `hsla(${h}, ${s}%, 95%, 0.5)`);
    grad.addColorStop(0.3, `hsla(${h}, ${s}%, ${l}%, 0.25)`);
    grad.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Radial streak lines — pressure wave rays
    ctx.save();
    const streakCount = 6 + Math.floor(f.volume * 10);
    for (let i = 0; i < streakCount; i++) {
      const [rh, rs, rl] = this.pick(CLAP_PALETTE);
      const angle = (i / streakCount) * Math.PI * 2 + noise2D(i, this.time) * 0.4;
      const innerR = glowRadius * (0.3 + noise2D(i * 0.5, this.time) * 0.3);
      const outerR = glowRadius * (0.7 + noise2D(i * 1.1, this.time) * 0.5);
      ctx.globalAlpha = 0.15 + f.volume * 0.25;
      ctx.strokeStyle = `hsl(${rh}, ${rs}%, ${Math.min(100, rl + 15)}%)`;
      ctx.lineWidth = (0.5 + noise2D(i, this.time * 0.3) * 1.5) * sizeMul;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
      ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
      ctx.stroke();
    }
    ctx.restore();

    // Paint splatter with noise variation
    const splatCount = baseSplatCount + Math.floor(f.volume * 8);
    ctx.save();
    for (let i = 0; i < splatCount; i++) {
      const ni = noise2D(i * 0.5 + this.time, cx * 0.02);
      const a = ni * Math.PI * 2;
      const dist = (5 + ni * 25 + f.volume * 30) * sizeMul;
      const sx = cx + Math.cos(a) * dist;
      const sy = cy + Math.sin(a) * dist;
      const [bh, bs, bl] = this.pick(CLAP_PALETTE);
      const blobSize = (1 + noise2D(i, this.time) * 4) * sizeMul;
      ctx.globalAlpha = 0.4 + Math.random() * 0.5;
      ctx.fillStyle = `hsl(${bh}, ${bs}%, ${bl}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 10;

      // Irregular blob shape
      ctx.beginPath();
      const pts = 5 + Math.floor(Math.random() * 4);
      for (let p = 0; p <= pts; p++) {
        const pa = (p / pts) * Math.PI * 2;
        const pr = blobSize * (0.6 + Math.random() * 0.8);
        const bx = sx + Math.cos(pa) * pr;
        const by = sy + Math.sin(pa) * pr;
        if (p === 0) ctx.moveTo(bx, by);
        else ctx.lineTo(bx, by);
      }
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // ═══════════════════════════════════════════
  //  LAUGH → bubbly circles, bouncing dots, joyful spirals
  // ═══════════════════════════════════════════
  private onLaughOnce(f: AudioFeatures) {
    const now = performance.now();
    if (now - this.lastLaughTime < 250) return;
    this.lastLaughTime = now;
    this.onLaugh(f);
  }

  private onLaugh(f: AudioFeatures) {
    const ctx = this.accCtx;
    const margin = 80;
    const cx = margin + Math.random() * (this.canvas.width - margin * 2);
    const cy = margin + Math.random() * (this.canvas.height - margin * 2);
    const n2 = noise2D(cx * 0.01, cy * 0.01);
    const sizeMul = 0.4 + n2 * 0.6;
    const p = this.params;
    const baseBubbleCount = p?.laughBubbleCount ?? 1;
    const baseBubbleSize = (p?.laughBubbleSize ?? 3) * sizeMul;
    const dotCount = p?.laughDotCount ?? 3;
    const spiralProb = p?.laughSpiralProb ?? 0.06;

    // Bouncing bubbles
    const bubbleCount = baseBubbleCount + Math.floor(f.volume * 3);
    ctx.save();
    for (let i = 0; i < bubbleCount; i++) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      const ni = noise2D(i + this.time * 0.5, cx * 0.02);
      const bx = cx + (ni - 0.5) * 80;
      const by = cy + (noise2D(i * 1.7, cy * 0.02) - 0.5) * 80;
      const r = baseBubbleSize + ni * 15 + f.volume * 8;

      // Filled bubble with gradient
      ctx.globalAlpha = 0.5 + Math.random() * 0.3;
      const grad = ctx.createRadialGradient(bx - r * 0.2, by - r * 0.2, 0, bx, by, r);
      grad.addColorStop(0, `hsla(${h}, ${s}%, ${Math.min(100, l + 25)}%, 0.7)`);
      grad.addColorStop(0.6, `hsla(${h}, ${s}%, ${l}%, 0.3)`);
      grad.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0.05)`);
      ctx.fillStyle = grad;
      ctx.shadowColor = `hsl(${h}, ${s}%, ${l}%)`;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.arc(bx, by, r, 0, Math.PI * 2);
      ctx.fill();

      // Highlight arc
      ctx.globalAlpha = 0.4;
      ctx.strokeStyle = `hsla(${h}, ${s}%, ${Math.min(100, l + 30)}%, 0.5)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.75, -Math.PI * 0.6, -Math.PI * 0.1);
      ctx.stroke();
    }
    ctx.restore();

    // Floating confetti — small colored rectangles tumbling outward
    ctx.save();
    const confettiCount = 2 + Math.floor(f.volume * 6);
    for (let i = 0; i < confettiCount; i++) {
      const [ch, cs, cl] = this.pick(LAUGH_PALETTE);
      const ni = noise2D(i * 1.3 + this.time, cx * 0.03);
      const angle = ni * Math.PI * 2;
      const dist = (15 + ni * 35 + f.volume * 25) * sizeMul;
      const fx = cx + Math.cos(angle) * dist;
      const fy = cy + Math.sin(angle) * dist - f.volume * 15;
      const rot = noise2D(i * 2, this.time * 0.4) * Math.PI;
      const w = (2 + ni * 4) * sizeMul;
      const h2 = w * (0.4 + Math.random() * 0.4);
      ctx.globalAlpha = 0.5 + ni * 0.4;
      ctx.fillStyle = `hsl(${ch}, ${cs}%, ${cl}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 3;
      ctx.translate(fx, fy);
      ctx.rotate(rot);
      ctx.fillRect(-w / 2, -h2 / 2, w, h2);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    ctx.restore();

    // Tiny dots with noise-driven scatter
    ctx.save();
    for (let i = 0; i < dotCount; i++) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      const ni = noise2D(i * 0.7 + this.time, cy * 0.03);
      const dx = cx + (ni - 0.5) * 100 * sizeMul;
      const dy = cy + (noise2D(i * 1.3, cx * 0.03) - 0.5) * 100 * sizeMul - f.volume * 20;
      ctx.globalAlpha = 0.5 + ni * 0.4;
      ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.arc(dx, dy, (0.5 + ni * 2) * sizeMul, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Bouncing arc trails — curved lines that give a sense of bounce
    ctx.save();
    const arcCount = 1 + Math.floor(f.volume * 2);
    for (let i = 0; i < arcCount; i++) {
      const [ah, as, al] = this.pick(LAUGH_PALETTE);
      const ni = noise2D(i * 0.9 + this.time, cx * 0.01);
      const startX = cx + (ni - 0.5) * 60 * sizeMul;
      const startY = cy + (noise2D(i * 2, cy * 0.01) - 0.5) * 40 * sizeMul;
      const arcW = (30 + ni * 40) * sizeMul;
      const arcH = (10 + f.volume * 20) * sizeMul;
      ctx.globalAlpha = 0.25 + f.volume * 0.3;
      ctx.strokeStyle = `hsl(${ah}, ${as}%, ${Math.min(100, al + 10)}%)`;
      ctx.lineWidth = (0.5 + ni * 1) * sizeMul;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 4;
      ctx.beginPath();
      ctx.moveTo(startX - arcW / 2, startY);
      ctx.quadraticCurveTo(startX, startY - arcH, startX + arcW / 2, startY);
      ctx.stroke();
    }
    ctx.restore();

    // Occasional mini-spiral
    if (Math.random() < spiralProb) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      this.drawSpiral(cx + (noise2D(this.time, cx) - 0.5) * 50, cy + (noise2D(this.time, cy) - 0.5) * 50, h, s, l, (10 + f.volume * 15) * sizeMul);
    }
  }

  // ═══════════════════════════════════════════
  //  Drawing primitives
  // ═══════════════════════════════════════════
  private drawStipple(x: number, y: number, h: number, s: number, l: number, size: number, count: number) {
    const ctx = this.accCtx;
    ctx.save();
    ctx.shadowBlur = 8;
    for (let i = 0; i < count; i++) {
      const r = size * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const dx = x + Math.cos(a) * r;
      const dy = y + Math.sin(a) * r;
      const dist = r / size;
      const dotSize = (1 - dist * 0.5) * (0.8 + Math.random() * 2);
      ctx.globalAlpha = 0.5 + (1 - dist) * 0.5;
      ctx.fillStyle = `hsl(${(h + dist * 40) % 360}, ${s}%, ${Math.min(100, l + (1 - dist) * 25)}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(dx, dy, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawSpiral(x: number, y: number, h: number, s: number, l: number, size: number) {
    const ctx = this.accCtx;
    ctx.save();
    ctx.shadowBlur = 8;
    const turns = 2 + Math.random() * 3;
    const dir = Math.random() > 0.5 ? 1 : -1;
    const base = Math.random() * Math.PI * 2;
    const steps = Math.floor(turns * 35);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const angle = base + t * turns * Math.PI * 2 * dir;
      const r = t * size;
      const dotSize = (1 - t * 0.5) * 2;
      ctx.globalAlpha = 0.6 + (1 - t) * 0.4;
      ctx.fillStyle = `hsl(${(h + t * 50) % 360}, ${s}%, ${Math.min(100, l + (1 - t) * 20)}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * r, y + Math.sin(angle) * r, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawNebula(x: number, y: number, h: number, s: number, l: number, size: number) {
    const ctx = this.accCtx;
    ctx.save();
    for (let layer = 0; layer < 2; layer++) {
      const ox = (Math.random() - 0.5) * size * 0.3;
      const oy = (Math.random() - 0.5) * size * 0.3;
      const r = size * (0.7 + layer * 0.3);
      const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, `hsla(${(h + layer * 25) % 360}, ${s}%, ${Math.min(100, l + 25)}%, 0.25)`);
      grad.addColorStop(0.4, `hsla(${(h + layer * 25) % 360}, ${s}%, ${l}%, 0.08)`);
      grad.addColorStop(1, `hsla(${(h + layer * 25) % 360}, ${s}%, ${l}%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 15; i++) {
      const a = Math.random() * Math.PI * 2;
      const r2 = Math.random() * size * 0.6;
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = `hsl(${(h + Math.random() * 30) % 360}, ${s}%, ${Math.min(100, l + 20)}%)`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r2, y + Math.sin(a) * r2, 0.6 + Math.random() * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ═══════════════════════════════════════════
  //  Flow management
  // ═══════════════════════════════════════════
  private endActiveFlows() {
    for (const f of this.activeFlows) {
      if (f.points.length > 1) this.flows.push(f);
    }
    this.activeFlows = [];
    this.commitFlows();
  }

  private commitFlows() {
    for (const flow of this.flows) this.drawFlow(this.accCtx, flow);
    this.flows = [];
  }

  private drawFlow(ctx: CanvasRenderingContext2D, flow: FlowLine) {
    if (flow.points.length < 2) return;
    ctx.save();
    if (flow.style === 'dotted') {
      for (const pt of flow.points) {
        ctx.globalAlpha = 0.7 + pt.volume * 0.3;
        ctx.fillStyle = `hsl(${pt.hue}, ${pt.sat}%, ${pt.light}%)`;
        ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size * 0.6, 0, Math.PI * 2); ctx.fill();
        const sc = 2 + pt.volume * 4;
        for (let d = 0; d < sc; d++) {
          ctx.globalAlpha = 0.25 + Math.random() * 0.3;
          ctx.beginPath(); ctx.arc(pt.x + (Math.random() - 0.5) * pt.size * 4, pt.y + (Math.random() - 0.5) * pt.size * 4, 0.4 + Math.random(), 0, Math.PI * 2); ctx.fill();
        }
      }
    } else if (flow.style === 'glow') {
      for (const p1 of flow.points) {
        ctx.globalAlpha = 0.12 + p1.volume * 0.15;
        const r = p1.size * 5;
        const grad = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r);
        grad.addColorStop(0, `hsla(${p1.hue}, ${p1.sat}%, ${Math.min(100, p1.light + 20)}%, 0.4)`);
        grad.addColorStop(0.5, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0.08)`);
        grad.addColorStop(1, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(p1.x, p1.y, r, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < flow.points.length; i++) {
        const p0 = flow.points[i - 1], p1 = flow.points[i];
        ctx.globalAlpha = 0.6 + p1.volume * 0.4;
        ctx.strokeStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`;
        ctx.lineWidth = p1.size;
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = p1.size * 0.8;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // ═══════════════════════════════════════════
  //  Bursts (snap/clap animated elements)
  // ═══════════════════════════════════════════
  private updateBursts() {
    const ctx = this.accCtx;
    for (const b of this.bursts) {
      if (b.type === 'ring') { b.size += 3; b.life -= 0.015; }
      else if (b.type === 'starburst') { b.life -= 0.012; }
      else if (b.type === 'shard') { b.x += b.vx; b.y += b.vy; b.vx *= 0.95; b.vy *= 0.95; b.life -= 0.008; }

      if (b.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life);
      const color = `hsl(${b.hue}, ${b.sat}%, ${b.light}%)`;

      if (b.type === 'starburst') {
        // Soft glow only, no white ring or rays
        ctx.shadowColor = color; ctx.shadowBlur = 30;
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size);
        grad.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, ${Math.min(100, b.light + 15)}%, ${b.life * 0.6})`);
        grad.addColorStop(0.4, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, ${b.life * 0.3})`);
        grad.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
      } else if (b.type === 'ring') {
        ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.shadowColor = color; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.stroke();
      } else if (b.type === 'shard') {
        ctx.fillStyle = color; ctx.shadowColor = color; ctx.shadowBlur = 10;
        const angle = Math.atan2(b.vy, b.vx);
        const len = b.size * 2, w = b.size * 0.3;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(angle) * len, b.y + Math.sin(angle) * len);
        ctx.lineTo(b.x + Math.cos(angle + Math.PI / 2) * w, b.y + Math.sin(angle + Math.PI / 2) * w);
        ctx.lineTo(b.x - Math.cos(angle) * len * 0.3, b.y - Math.sin(angle) * len * 0.3);
        ctx.lineTo(b.x + Math.cos(angle - Math.PI / 2) * w, b.y + Math.sin(angle - Math.PI / 2) * w);
        ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    this.bursts = this.bursts.filter(b => b.life > 0);
  }

  // ═══════════════════════════════════════════
  //  Render
  // ═══════════════════════════════════════════
  private render() {
    const ctx = this.accCtx;
    // Draw active flows incrementally
    for (const flow of this.activeFlows) {
      const len = flow.points.length;
      if (len < 2) continue;
      const p0 = flow.points[len - 2], p1 = flow.points[len - 1];
      ctx.save();
      if (flow.style === 'dotted') {
        ctx.globalAlpha = 0.7 + p1.volume * 0.3;
        ctx.fillStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`; ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(p1.x, p1.y, p1.size * 0.6, 0, Math.PI * 2); ctx.fill();
        for (let d = 0; d < 2 + p1.volume * 4; d++) {
          ctx.globalAlpha = 0.25 + Math.random() * 0.3;
          ctx.beginPath(); ctx.arc(p1.x + (Math.random() - 0.5) * p1.size * 4, p1.y + (Math.random() - 0.5) * p1.size * 4, 0.4 + Math.random(), 0, Math.PI * 2); ctx.fill();
        }
      } else if (flow.style === 'glow') {
        ctx.globalAlpha = 0.12 + p1.volume * 0.15;
        const r = p1.size * 5;
        const grad = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r);
        grad.addColorStop(0, `hsla(${p1.hue}, ${p1.sat}%, ${Math.min(100, p1.light + 20)}%, 0.4)`);
        grad.addColorStop(0.5, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0.08)`);
        grad.addColorStop(1, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0)`);
        ctx.fillStyle = grad; ctx.beginPath(); ctx.arc(p1.x, p1.y, r, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.globalAlpha = 0.6 + p1.volume * 0.4;
        ctx.strokeStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`; ctx.lineWidth = p1.size; ctx.lineCap = 'round';
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = p1.size * 3;
        ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
      }
      ctx.restore();
    }

    // Composite to display
    this.ctx.drawImage(this.accCanvas, 0, 0);
    // Bloom
    const gw = this.glowCanvas.width, gh = this.glowCanvas.height;
    this.glowCtx.clearRect(0, 0, gw, gh);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, gw, gh);
    this.glowCtx.filter = 'blur(6px)';
    this.glowCtx.drawImage(this.glowCanvas, 0, 0);
    this.glowCtx.filter = 'none';
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'lighter';
    this.ctx.globalAlpha = 0.3;
    this.ctx.drawImage(this.glowCanvas, 0, 0, this.canvas.width, this.canvas.height);
    this.ctx.restore();

  }

  private composited(): HTMLCanvasElement {
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const o = out.getContext('2d')!;
    o.drawImage(this.accCanvas, 0, 0);
    this.glowCtx.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.filter = 'blur(6px)'; this.glowCtx.drawImage(this.glowCanvas, 0, 0); this.glowCtx.filter = 'none';
    o.globalCompositeOperation = 'lighter'; o.globalAlpha = 0.3;
    o.drawImage(this.glowCanvas, 0, 0, out.width, out.height);
    return out;
  }

  toDataURL(): string {
    return this.composited().toDataURL('image/png');
  }

  toPortraitDataURL(w = 1080, h = 2340): string {
    const src = this.composited();
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const o = out.getContext('2d')!;
    // center-crop from landscape source
    const srcRatio = w / h; // target aspect
    let sw = src.width, sh = src.width / srcRatio;
    if (sh > src.height) { sh = src.height; sw = src.height * srcRatio; }
    const sx = (src.width - sw) / 2, sy = (src.height - sh) / 2;
    o.fillStyle = '#000'; o.fillRect(0, 0, w, h);
    o.drawImage(src, sx, sy, sw, sh, 0, 0, w, h);
    return out.toDataURL('image/png');
  }

  // ═══════════════════════════════════════════
  //  SPECIAL TRIGGER WORD EVENTS (full-screen)
  // ═══════════════════════════════════════════
  triggerSpecialEvent(word: TriggerWord) {
    switch (word) {
      case 'love': this.eventLove(); break;
      case 'hello': this.eventHello(); break;
      case 'happy': this.eventHappy(); break;
      case 'wow': this.eventWow(); break;
    }
  }

  // ❤️ 사랑해 — hearts bursting from center + pink/red glow
  private eventLove() {
    const ctx = this.accCtx;
    const W = this.canvas.width, H = this.canvas.height;
    const cx = W / 2, cy = H / 2;

    // Phase 1 (immediate): Soft center glow + first ring
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.5);
    grad.addColorStop(0, 'hsla(340, 100%, 70%, 0.15)');
    grad.addColorStop(0.4, 'hsla(330, 100%, 60%, 0.05)');
    grad.addColorStop(1, 'hsla(330, 100%, 50%, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    this.bursts.push({ x: cx, y: cy, hue: 335, sat: 100, light: 65, size: 5, life: 1.5, type: 'ring', vx: 0, vy: 0 });

    // Phase 2 (0.3s): Second ring + first nebula fade-in
    this.scheduleEffect(0.3, () => {
      this.bursts.push({ x: cx, y: cy, hue: 340, sat: 100, light: 68, size: 8, life: 1.8, type: 'ring', vx: 0, vy: 0 });
      this.drawFadedNebula(W * (0.2 + Math.random() * 0.3), H * (0.2 + Math.random() * 0.6), 330 + Math.random() * 20, 0.4);
    });

    // Phase 3 (0.6s): Third ring + spiral
    this.scheduleEffect(0.6, () => {
      this.bursts.push({ x: cx, y: cy, hue: 345, sat: 100, light: 70, size: 12, life: 2.0, type: 'ring', vx: 0, vy: 0 });
      const sx = W * (0.6 + Math.random() * 0.3);
      const sy = H * (0.2 + Math.random() * 0.6);
      this.drawSpiral(sx, sy, 335, 100, 65, 30 + Math.random() * 30);
    });

    // Phase 4 (0.9s): Nebula bloom + stipple pop
    this.scheduleEffect(0.9, () => {
      this.drawFadedNebula(W * (0.5 + Math.random() * 0.4), H * (0.1 + Math.random() * 0.5), 340 + Math.random() * 20, 0.7);
      this.drawStipple(W * (0.3 + Math.random() * 0.4), H * (0.3 + Math.random() * 0.4), 340, 100, 70, 45, 30);
    });

    // Phase 5 (1.2s): Another spiral + nebula
    this.scheduleEffect(1.2, () => {
      this.drawSpiral(W * (0.15 + Math.random() * 0.3), H * (0.3 + Math.random() * 0.4), 330 + Math.random() * 15, 100, 60, 25 + Math.random() * 35);
      this.drawFadedNebula(W * (0.1 + Math.random() * 0.3), H * (0.3 + Math.random() * 0.4), 335, 0.6);
    });

    // Phase 6 (1.5s): Final glow wash + scattered stipples
    this.scheduleEffect(1.5, () => {
      const gctx = this.accCtx;
      gctx.save();
      const g2 = gctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.4);
      g2.addColorStop(0, 'hsla(335, 100%, 65%, 0.12)');
      g2.addColorStop(1, 'hsla(335, 100%, 55%, 0)');
      gctx.fillStyle = g2;
      gctx.fillRect(0, 0, W, H);
      gctx.restore();
      for (let i = 0; i < 2; i++) {
        this.drawStipple(W * (0.15 + Math.random() * 0.7), H * (0.15 + Math.random() * 0.7), 335 + Math.random() * 20, 100, 68, 30 + Math.random() * 20, 20);
      }
    });

    // Phase 7 (2.0s): Late bloom spiral
    this.scheduleEffect(2.0, () => {
      this.drawSpiral(W * (0.3 + Math.random() * 0.4), H * (0.2 + Math.random() * 0.5), 340, 100, 65, 20 + Math.random() * 25);
      this.drawFadedNebula(W * (0.4 + Math.random() * 0.3), H * (0.5 + Math.random() * 0.3), 330, 0.5);
    });
  }

  // Nebula with controlled opacity for fade-in effect
  private drawFadedNebula(x: number, y: number, hue: number, opacity: number) {
    const ctx = this.accCtx;
    const size = 50 + Math.random() * 80;
    ctx.save();
    ctx.globalAlpha = opacity;
    for (let layer = 0; layer < 2; layer++) {
      const ox = (Math.random() - 0.5) * size * 0.3;
      const oy = (Math.random() - 0.5) * size * 0.3;
      const r = size * (0.7 + layer * 0.3);
      const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      grad.addColorStop(0, `hsla(${(hue + layer * 25) % 360}, 90%, 65%, 0.3)`);
      grad.addColorStop(0.4, `hsla(${(hue + layer * 25) % 360}, 90%, 55%, 0.1)`);
      grad.addColorStop(1, `hsla(${(hue + layer * 25) % 360}, 90%, 50%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const r2 = Math.random() * size * 0.5;
      ctx.globalAlpha = opacity * 0.6;
      ctx.fillStyle = `hsl(${(hue + Math.random() * 20) % 360}, 100%, 70%)`;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r2, y + Math.sin(a) * r2, 0.5 + Math.random() * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 👋 안녕 — sparkling wave sweeping across the screen
  private eventHello() {
    const ctx = this.accCtx;
    const W = this.canvas.width, H = this.canvas.height;

    // Horizontal wave of sparkles
    const waveY = H * (0.3 + Math.random() * 0.4);
    ctx.save();
    for (let i = 0; i < 80; i++) {
      const wx = Math.random() * W;
      const wy = waveY + Math.sin(wx / W * Math.PI * 3) * 80 + (Math.random() - 0.5) * 120;
      const size = 1 + Math.random() * 4;
      const hue = 40 + Math.random() * 40; // golden sparkles
      ctx.globalAlpha = 0.5 + Math.random() * 0.5;
      ctx.fillStyle = `hsl(${hue}, 100%, ${70 + Math.random() * 25}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(wx, wy, size, 0, Math.PI * 2);
      ctx.fill();

      // Star sparkle cross
      if (Math.random() < 0.3) {
        const len = size * 3;
        ctx.strokeStyle = ctx.fillStyle;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(wx - len, wy); ctx.lineTo(wx + len, wy);
        ctx.moveTo(wx, wy - len); ctx.lineTo(wx, wy + len);
        ctx.stroke();
      }
    }
    ctx.restore();

    // Sweeping glow band
    ctx.save();
    const bandGrad = ctx.createLinearGradient(0, waveY - 100, 0, waveY + 100);
    bandGrad.addColorStop(0, 'hsla(50, 100%, 70%, 0)');
    bandGrad.addColorStop(0.5, 'hsla(50, 100%, 80%, 0.15)');
    bandGrad.addColorStop(1, 'hsla(50, 100%, 70%, 0)');
    ctx.fillStyle = bandGrad;
    ctx.fillRect(0, waveY - 100, W, 200);
    ctx.restore();

    // Expanding rings at random points along the wave
    for (let i = 0; i < 4; i++) {
      const rx = W * (0.1 + i * 0.25 + Math.random() * 0.1);
      this.bursts.push({ x: rx, y: waveY + Math.sin(rx / W * Math.PI * 3) * 50, hue: 45, sat: 100, light: 75, size: 3, life: 1, type: 'ring', vx: 0, vy: 0 });
    }
  }

  // 🌈 행복 — bioluminescent bloom: nebula clusters + spirals + stipple clouds
  private eventHappy() {
    const ctx = this.accCtx;
    const W = this.canvas.width, H = this.canvas.height;

    // Use the existing neon palette with shifting hues for organic warmth
    const bloomHues = [120, 180, 270, 330, 55, 300]; // greens, cyans, purples, pinks, golds

    // Scatter 5-7 large nebula blooms across the canvas
    const clusterCount = 5 + Math.floor(Math.random() * 3);
    for (let c = 0; c < clusterCount; c++) {
      const cx = W * (0.1 + Math.random() * 0.8);
      const cy = H * (0.1 + Math.random() * 0.8);
      const hue = bloomHues[c % bloomHues.length] + Math.random() * 30;
      const size = 60 + Math.random() * 100;

      // Layered nebula glow
      this.drawNebula(cx, cy, hue, 100, 55, size);

      // Dense stipple cloud around each nebula
      this.drawStipple(cx, cy, hue, 100, 65, size * 0.8, 30 + Math.floor(Math.random() * 30));

      // Spiral emanating from each cluster
      if (Math.random() < 0.6) {
        this.drawSpiral(
          cx + (Math.random() - 0.5) * 40,
          cy + (Math.random() - 0.5) * 40,
          (hue + 30) % 360, 100, 60,
          30 + Math.random() * 50
        );
      }
    }

    // Organic connecting tendrils between clusters using flowing curves
    ctx.save();
    ctx.lineCap = 'round';
    const tendrilCount = 4 + Math.floor(Math.random() * 4);
    for (let t = 0; t < tendrilCount; t++) {
      const x1 = W * (0.1 + Math.random() * 0.8);
      const y1 = H * (0.1 + Math.random() * 0.8);
      const x2 = W * (0.1 + Math.random() * 0.8);
      const y2 = H * (0.1 + Math.random() * 0.8);
      const cpx = (x1 + x2) / 2 + (Math.random() - 0.5) * 300;
      const cpy = (y1 + y2) / 2 + (Math.random() - 0.5) * 300;
      const hue = bloomHues[Math.floor(Math.random() * bloomHues.length)];

      ctx.globalAlpha = 0.15 + Math.random() * 0.2;
      ctx.strokeStyle = `hsl(${hue}, 100%, 60%)`;
      ctx.lineWidth = 0.5 + Math.random() * 2;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 15;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(cpx, cpy, x2, y2);
      ctx.stroke();
    }
    ctx.restore();

    // Soft full-screen multi-hue glow wash
    ctx.save();
    for (let g = 0; g < 3; g++) {
      const gx = W * (0.2 + Math.random() * 0.6);
      const gy = H * (0.2 + Math.random() * 0.6);
      const gr = W * (0.2 + Math.random() * 0.15);
      const hue = bloomHues[Math.floor(Math.random() * bloomHues.length)];
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      grad.addColorStop(0, `hsla(${hue}, 100%, 60%, 0.12)`);
      grad.addColorStop(0.5, `hsla(${hue}, 100%, 50%, 0.04)`);
      grad.addColorStop(1, `hsla(${hue}, 100%, 40%, 0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();

    // Animated expanding rings from cluster centers
    for (let i = 0; i < 3; i++) {
      const rx = W * (0.2 + Math.random() * 0.6);
      const ry = H * (0.2 + Math.random() * 0.6);
      const hue = bloomHues[Math.floor(Math.random() * bloomHues.length)];
      this.bursts.push({ x: rx, y: ry, hue, sat: 100, light: 60, size: 3, life: 1.2, type: 'ring', vx: 0, vy: 0 });
    }
  }

  // 🎆 와/대박 — fireworks explosion
  private eventWow() {
    const ctx = this.accCtx;
    const W = this.canvas.width, H = this.canvas.height;

    // Multiple firework bursts at random positions
    const burstCount = 3 + Math.floor(Math.random() * 3);
    for (let b = 0; b < burstCount; b++) {
      const bx = W * (0.15 + Math.random() * 0.7);
      const by = H * (0.15 + Math.random() * 0.5);
      const hue = Math.random() * 360;

      // Central flash
      ctx.save();
      const grad = ctx.createRadialGradient(bx, by, 0, bx, by, 80);
      grad.addColorStop(0, `hsla(${hue}, 100%, 95%, 0.6)`);
      grad.addColorStop(0.3, `hsla(${hue}, 100%, 70%, 0.2)`);
      grad.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(bx, by, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Expanding rings
      this.bursts.push({ x: bx, y: by, hue, sat: 100, light: 70, size: 5, life: 1.3, type: 'ring', vx: 0, vy: 0 });
      this.bursts.push({ x: bx, y: by, hue: (hue + 40) % 360, sat: 100, light: 65, size: 3, life: 1.5, type: 'ring', vx: 0, vy: 0 });

      // Sparks radiating outward
      const sparkCount = 20 + Math.floor(Math.random() * 15);
      for (let i = 0; i < sparkCount; i++) {
        const a = (i / sparkCount) * Math.PI * 2 + Math.random() * 0.3;
        const sp = 3 + Math.random() * 6;
        this.bursts.push({
          x: bx, y: by,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp + Math.random() * 1.5,
          hue: (hue + Math.random() * 60) % 360, sat: 100, light: 65 + Math.random() * 20,
          size: 2 + Math.random() * 5, life: 1 + Math.random() * 0.8,
          type: 'shard'
        });
      }

      // Stipple cloud at each burst center
      this.drawStipple(bx, by, hue, 100, 75, 50, 40);
    }
  }

  clear() {
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.activeFlows = []; this.flows = []; this.bursts = [];
    this.cursorX = this.canvas.width / 2; this.cursorY = this.canvas.height / 2;
  }
}
