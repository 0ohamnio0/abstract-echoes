import { AudioFeatures, SoundType } from './audioAnalyzer';
import { ParamValues } from './tuningParams';

const NEON_COLORS = [
  [330, 100, 65], [180, 100, 50], [120, 100, 55], [25, 100, 55],
  [220, 100, 60], [300, 100, 60], [55, 100, 55], [0, 100, 55],
  [270, 80, 60], [350, 100, 70], [160, 100, 45], [40, 100, 60],
];

// Snap: icy crystalline
const SNAP_PALETTE = [[195, 100, 75], [0, 0, 95], [280, 80, 80], [45, 100, 80]];
// Clap: warm explosive
const CLAP_PALETTE = [[25, 100, 60], [0, 100, 60], [55, 100, 65], [40, 100, 55]];
// Laugh: bubbly playful
const LAUGH_PALETTE = [[300, 80, 70], [330, 100, 70], [55, 100, 65], [160, 100, 60], [270, 90, 70]];

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
      this.cursorX += Math.sin(this.time * 0.43 + this.seedX) * speed + Math.sin(this.time * 1.1 + this.seedX * 2) * speed * 0.3 + Math.cos(this.time * 0.17 + features.pitch * 0.001) * speed * 0.5;
      this.cursorY += Math.cos(this.time * 0.37 + this.seedY) * speed + Math.cos(this.time * 0.9 + this.seedY * 2) * speed * 0.3 + Math.sin(this.time * 0.21 + features.pitch * 0.001) * speed * 0.5;
      const m = 60;
      if (this.cursorX < m) this.cursorX += (m - this.cursorX) * 0.1;
      if (this.cursorX > this.canvas.width - m) this.cursorX -= (this.cursorX - (this.canvas.width - m)) * 0.1;
      if (this.cursorY < m) this.cursorY += (m - this.cursorY) * 0.1;
      if (this.cursorY > this.canvas.height - m) this.cursorY -= (this.cursorY - (this.canvas.height - m)) * 0.1;

      this.lastSoundType = features.soundType;

      switch (features.soundType) {
        case 'snap': this.onSnap(features); this.endActiveFlows(); break;
        case 'clap': this.onClap(features); this.endActiveFlows(); break;
        case 'laugh': this.onLaugh(features); break;
        case 'voice': this.onVoice(features); break;
      }
    } else {
      this.framesSinceSpeaking++;
      if (this.framesSinceSpeaking > 10) this.endActiveFlows();
    }

    this.updateBursts();
    this.render();
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
    const lineSizeMul = p?.voiceLineSize ?? 1;
    const stippleProb = p?.voiceStippleProb ?? 0.12;
    const stippleSize = p?.voiceStippleSize ?? 15;
    const nebulaProb = p?.voiceNebulaProb ?? 0.03;
    const spiralProb = p?.voiceSpiralProb ?? 0.008;

    while (this.activeFlows.length < flowCount) {
      const style: FlowLine['style'] = this.activeFlows.length === 0 ? 'smooth' : this.activeFlows.length === 1 ? 'dotted' : 'glow';
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
  //  SNAP → crystalline starburst + ice shards + expanding ring
  // ═══════════════════════════════════════════
  private onSnap(f: AudioFeatures) {
    const cx = this.cursorX + (Math.random() - 0.5) * 120;
    const cy = this.cursorY + (Math.random() - 0.5) * 120;
    const [h, s, l] = this.pick(SNAP_PALETTE);
    const p = this.params;
    const starSize = p?.snapStarburstSize ?? 40;
    const ringCount = p?.snapRingCount ?? 2;
    const shardCount = p?.snapShardCount ?? 12;
    const stpSize = p?.snapStippleSize ?? 55;

    // Central flash
    this.bursts.push({ x: cx, y: cy, hue: h, sat: s, light: l, size: starSize + f.volume * 60, life: 1, type: 'starburst', vx: 0, vy: 0 });
    // Expanding rings
    for (let ri = 0; ri < ringCount; ri++) {
      this.bursts.push({ x: cx, y: cy, hue: (h + ri * 40) % 360, sat: s, light: l, size: 5 - ri * 2, life: 1 + ri * 0.2, type: 'ring', vx: 0, vy: 0 });
    }
    // Ice shards radiating outward
    const n = shardCount + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 4 + Math.random() * 7;
      const [sh, ss, sl] = this.pick(SNAP_PALETTE);
      this.bursts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, hue: sh, sat: ss, light: sl, size: 5 + Math.random() * 15, life: 1, type: 'shard' });
    }
    // Fine crystalline stipple
    this.drawStipple(cx, cy, h, s, 90, stpSize, 80);
  }

  // ═══════════════════════════════════════════
  //  CLAP → warm shockwave + scattered splatter + concentric rings
  // ═══════════════════════════════════════════
  private onClap(f: AudioFeatures) {
    const cx = this.cursorX + (Math.random() - 0.5) * 150;
    const cy = this.cursorY + (Math.random() - 0.5) * 150;
    const [h, s, l] = this.pick(CLAP_PALETTE);
    const p = this.params;
    const ringCount = p?.clapRingCount ?? 3;
    const glowRadius = p?.clapGlowRadius ?? 60;
    const baseSplatCount = p?.clapSplatCount ?? 15;

    // Multiple concentric shockwave rings
    for (let i = 0; i < ringCount; i++) {
      this.bursts.push({ x: cx, y: cy, hue: (h + i * 20) % 360, sat: s, light: l, size: 3 + i * 2, life: 1 + i * 0.15, type: 'ring', vx: 0, vy: 0 });
    }

    // Warm central glow
    const ctx = this.accCtx;
    ctx.save();
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius + f.volume * 80);
    grad.addColorStop(0, `hsla(${h}, ${s}%, 95%, 0.6)`);
    grad.addColorStop(0.3, `hsla(${h}, ${s}%, ${l}%, 0.3)`);
    grad.addColorStop(1, `hsla(${h}, ${s}%, ${l}%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, glowRadius + f.volume * 80, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Paint splatter — irregular blobs radiating out
    const splatCount = baseSplatCount + Math.floor(f.volume * 20);
    ctx.save();
    for (let i = 0; i < splatCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = 10 + Math.random() * (40 + f.volume * 80);
      const sx = cx + Math.cos(a) * dist;
      const sy = cy + Math.sin(a) * dist;
      const [bh, bs, bl] = this.pick(CLAP_PALETTE);
      const blobSize = 2 + Math.random() * 8;
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
  private onLaugh(f: AudioFeatures) {
    const ctx = this.accCtx;
    const cx = this.cursorX + (Math.random() - 0.5) * 100;
    const cy = this.cursorY + (Math.random() - 0.5) * 100;
    const p = this.params;
    const baseBubbleCount = p?.laughBubbleCount ?? 3;
    const baseBubbleSize = p?.laughBubbleSize ?? 8;
    const dotCount = p?.laughDotCount ?? 10;
    const spiralProb = p?.laughSpiralProb ?? 0.15;

    // Bouncing bubbles
    const bubbleCount = baseBubbleCount + Math.floor(f.volume * 6);
    ctx.save();
    for (let i = 0; i < bubbleCount; i++) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      const bx = cx + (Math.random() - 0.5) * 120;
      const by = cy + (Math.random() - 0.5) * 120;
      const r = baseBubbleSize + Math.random() * 25 + f.volume * 15;

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

    // Tiny bouncing dots that scatter upward
    ctx.save();
    for (let i = 0; i < dotCount; i++) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      const dx = cx + (Math.random() - 0.5) * 160;
      const dy = cy + (Math.random() - 0.5) * 160 - f.volume * 40;
      ctx.globalAlpha = 0.6 + Math.random() * 0.4;
      ctx.fillStyle = `hsl(${h}, ${s}%, ${l}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(dx, dy, 1 + Math.random() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Occasional playful mini-spiral
    if (Math.random() < spiralProb) {
      const [h, s, l] = this.pick(LAUGH_PALETTE);
      this.drawSpiral(cx + (Math.random() - 0.5) * 80, cy + (Math.random() - 0.5) * 80, h, s, l, 15 + f.volume * 25);
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
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = p1.size * 3;
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
        ctx.shadowColor = color; ctx.shadowBlur = 50;
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size);
        grad.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, 98%, ${b.life})`);
        grad.addColorStop(0.15, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, ${b.life * 0.7})`);
        grad.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `hsla(0, 0%, 100%, ${b.life * 0.4})`; ctx.lineWidth = 1;
        for (let a = 0; a < 8; a++) {
          const angle = (a / 8) * Math.PI * 2 + this.time;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x + Math.cos(angle) * b.size * 1.8, b.y + Math.sin(angle) * b.size * 1.8); ctx.stroke();
        }
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

  toDataURL(): string {
    const out = document.createElement('canvas');
    out.width = this.canvas.width; out.height = this.canvas.height;
    const o = out.getContext('2d')!;
    o.drawImage(this.accCanvas, 0, 0);
    this.glowCtx.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.filter = 'blur(6px)'; this.glowCtx.drawImage(this.glowCanvas, 0, 0); this.glowCtx.filter = 'none';
    o.globalCompositeOperation = 'lighter'; o.globalAlpha = 0.3;
    o.drawImage(this.glowCanvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
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
