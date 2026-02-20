import { AudioFeatures } from './audioAnalyzer';

const NEON_COLORS = [
  [330, 100, 65], [180, 100, 50], [120, 100, 55], [25, 100, 55],
  [220, 100, 60], [300, 100, 60], [55, 100, 55], [0, 100, 55],
  [270, 80, 60], [350, 100, 70], [160, 100, 45], [40, 100, 60],
];

const SNAP_COLORS = [
  [45, 100, 75], [195, 100, 70], [0, 0, 95], [280, 80, 75], [160, 100, 65],
];

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
  type: 'starburst' | 'ring' | 'shard' | 'stipple';
  vx: number; vy: number;
  data?: any;
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

  // Continuous flow state
  private currentFlow: FlowLine | null = null;
  private flows: FlowLine[] = [];
  private bursts: Burst[] = [];
  private framesSinceSpeaking = 0;
  private totalDrawn = 0;

  // Multiple concurrent flowing lines for richness
  private activeFlows: FlowLine[] = [];

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

      // Move cursor organically
      const speed = 1.5 + features.volume * 6;
      const wanderX = Math.sin(this.time * 0.43 + this.seedX) * speed
        + Math.sin(this.time * 1.1 + this.seedX * 2) * speed * 0.3
        + Math.cos(this.time * 0.17 + features.pitch * 0.001) * speed * 0.5;
      const wanderY = Math.cos(this.time * 0.37 + this.seedY) * speed
        + Math.cos(this.time * 0.9 + this.seedY * 2) * speed * 0.3
        + Math.sin(this.time * 0.21 + features.pitch * 0.001) * speed * 0.5;

      this.cursorX += wanderX;
      this.cursorY += wanderY;

      // Soft bounce off edges
      const margin = 60;
      if (this.cursorX < margin) this.cursorX += (margin - this.cursorX) * 0.1;
      if (this.cursorX > this.canvas.width - margin) this.cursorX -= (this.cursorX - (this.canvas.width - margin)) * 0.1;
      if (this.cursorY < margin) this.cursorY += (margin - this.cursorY) * 0.1;
      if (this.cursorY > this.canvas.height - margin) this.cursorY -= (this.cursorY - (this.canvas.height - margin)) * 0.1;

      if (features.isSnap) {
        this.spawnSnapBurst(features);
        // End current flows on snap
        this.endActiveFlows();
      } else {
        this.continueFlowing(features);
      }
    } else {
      this.framesSinceSpeaking++;
      if (this.framesSinceSpeaking > 10) {
        this.endActiveFlows();
      }
    }

    this.updateBursts();
    this.render();
  }

  private pickColor(f: AudioFeatures): [number, number, number] {
    const idx = Math.abs(Math.floor((f.pitch / 600 * NEON_COLORS.length + this.colorOffset / 25))) % NEON_COLORS.length;
    const [h, s, l] = NEON_COLORS[idx];
    return [(h + f.pitch * 0.04 + this.colorOffset + this.time * 2) % 360, s, l + f.volume * 10];
  }

  /** Continuous flowing lines that follow cursor */
  private continueFlowing(f: AudioFeatures) {
    const [h, s, l] = this.pickColor(f);

    // Ensure we have active flows (2-4 parallel lines for richness)
    while (this.activeFlows.length < 3) {
      const style: FlowLine['style'] =
        this.activeFlows.length === 0 ? 'smooth' :
        this.activeFlows.length === 1 ? 'dotted' : 'glow';
      this.activeFlows.push({ points: [], life: 1, style });
    }

    // Add point to each active flow with slight offsets
    for (let fi = 0; fi < this.activeFlows.length; fi++) {
      const flow = this.activeFlows[fi];
      const offsetAngle = (fi / this.activeFlows.length) * Math.PI * 2 + this.time * 0.3;
      const offsetDist = 10 + fi * 15 + f.volume * 30;

      const px = this.cursorX + Math.cos(offsetAngle) * offsetDist;
      const py = this.cursorY + Math.sin(offsetAngle) * offsetDist;

      const hShift = fi * 40;
      flow.points.push({
        x: px, y: py,
        hue: (h + hShift) % 360, sat: s, light: l,
        size: 1 + f.volume * 6 + f.bass * 4,
        volume: f.volume,
      });

      // Spawn stipple clusters along flow occasionally
      if (Math.random() < f.volume * 0.15 && fi === 0) {
        this.spawnStippleAt(px + (Math.random() - 0.5) * 40, py + (Math.random() - 0.5) * 40, h, s, l, 15 + f.volume * 50, 20 + Math.floor(f.volume * 60));
      }

      // Spawn spiral along flow rarely
      if (Math.random() < 0.008 && fi === 0) {
        this.spawnSpiralAt(px, py, h, s, l, 25 + f.volume * 50);
      }

      // Spawn nebula orb along flow
      if (Math.random() < f.volume * 0.03) {
        this.spawnNebulaAt(px + (Math.random() - 0.5) * 60, py + (Math.random() - 0.5) * 60, (h + hShift) % 360, s, l, 30 + f.volume * 60);
      }
    }

    this.totalDrawn++;
  }

  private endActiveFlows() {
    for (const flow of this.activeFlows) {
      if (flow.points.length > 1) {
        this.flows.push(flow);
      }
    }
    this.activeFlows = [];
    // Commit old completed flows to accumulation canvas and clear
    this.commitFlows();
  }

  /** Draw completed flows permanently onto accumulation canvas */
  private commitFlows() {
    const ctx = this.accCtx;
    for (const flow of this.flows) {
      this.drawFlow(ctx, flow);
    }
    this.flows = [];
  }

  private drawFlow(ctx: CanvasRenderingContext2D, flow: FlowLine) {
    if (flow.points.length < 2) return;

    ctx.save();

    if (flow.style === 'dotted') {
      // Stippled path
      for (let i = 0; i < flow.points.length; i++) {
        const pt = flow.points[i];
        ctx.globalAlpha = 0.7 + pt.volume * 0.3;
        ctx.fillStyle = `hsl(${pt.hue}, ${pt.sat}%, ${pt.light}%)`;
        ctx.shadowColor = `hsl(${pt.hue}, ${pt.sat}%, ${pt.light}%)`;
        ctx.shadowBlur = 8;
        // Main dot
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Scatter dots around
        const scatter = 3 + pt.volume * 5;
        for (let d = 0; d < scatter; d++) {
          const ox = (Math.random() - 0.5) * pt.size * 4;
          const oy = (Math.random() - 0.5) * pt.size * 4;
          const ds = 0.4 + Math.random() * 1.2;
          ctx.globalAlpha = 0.3 + Math.random() * 0.4;
          ctx.beginPath();
          ctx.arc(pt.x + ox, pt.y + oy, ds, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (flow.style === 'glow') {
      // Soft glowing trail
      for (let i = 1; i < flow.points.length; i++) {
        const p0 = flow.points[i - 1];
        const p1 = flow.points[i];
        ctx.globalAlpha = 0.15 + p1.volume * 0.2;
        const grad = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, p1.size * 5);
        grad.addColorStop(0, `hsla(${p1.hue}, ${p1.sat}%, ${Math.min(100, p1.light + 20)}%, 0.5)`);
        grad.addColorStop(0.5, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0.1)`);
        grad.addColorStop(1, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.size * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // Smooth continuous curve
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      for (let i = 1; i < flow.points.length; i++) {
        const p0 = flow.points[i - 1];
        const p1 = flow.points[i];
        ctx.globalAlpha = 0.6 + p1.volume * 0.4;
        ctx.strokeStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`;
        ctx.lineWidth = p1.size;
        ctx.shadowColor = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`;
        ctx.shadowBlur = p1.size * 3;

        ctx.beginPath();
        if (i >= 2) {
          const p_prev = flow.points[i - 2];
          const cpx = p0.x * 2 - (p_prev.x + p1.x) / 2;
          const cpy = p0.y * 2 - (p_prev.y + p1.y) / 2;
          ctx.moveTo(p0.x, p0.y);
          ctx.quadraticCurveTo(cpx, cpy, p1.x, p1.y);
        } else {
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private spawnStippleAt(x: number, y: number, h: number, s: number, l: number, size: number, count: number) {
    const ctx = this.accCtx;
    ctx.save();
    ctx.shadowBlur = 8;
    for (let i = 0; i < count; i++) {
      const r = size * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const dx = x + Math.cos(a) * r;
      const dy = y + Math.sin(a) * r;
      const dist = r / size;
      const dotHue = (h + dist * 40) % 360;
      const dotLight = Math.min(100, l + (1 - dist) * 25);
      const dotSize = (1 - dist * 0.5) * (0.8 + Math.random() * 2);
      ctx.globalAlpha = 0.5 + (1 - dist) * 0.5;
      ctx.fillStyle = `hsl(${dotHue}, ${s}%, ${dotLight}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(dx, dy, dotSize, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private spawnSpiralAt(x: number, y: number, h: number, s: number, l: number, size: number) {
    const ctx = this.accCtx;
    ctx.save();
    ctx.shadowBlur = 8;
    const turns = 2 + Math.random() * 3;
    const dir = Math.random() > 0.5 ? 1 : -1;
    const baseAngle = Math.random() * Math.PI * 2;
    const steps = Math.floor(turns * 35);

    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const angle = baseAngle + t * turns * Math.PI * 2 * dir;
      const r = t * size;
      const sx = x + Math.cos(angle) * r;
      const sy = y + Math.sin(angle) * r;
      const dotSize = (1 - t * 0.5) * 2;
      ctx.globalAlpha = 0.6 + (1 - t) * 0.4;
      ctx.fillStyle = `hsl(${(h + t * 50) % 360}, ${s}%, ${Math.min(100, l + (1 - t) * 20)}%)`;
      ctx.shadowColor = ctx.fillStyle;
      ctx.beginPath();
      ctx.arc(sx, sy, dotSize, 0, Math.PI * 2);
      ctx.fill();

      if (Math.random() > 0.5) {
        const ox = (Math.random() - 0.5) * 6;
        const oy = (Math.random() - 0.5) * 6;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(sx + ox, sy + oy, dotSize * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private spawnNebulaAt(x: number, y: number, h: number, s: number, l: number, size: number) {
    const ctx = this.accCtx;
    ctx.save();
    for (let layer = 0; layer < 2; layer++) {
      const ox = (Math.random() - 0.5) * size * 0.3;
      const oy = (Math.random() - 0.5) * size * 0.3;
      const r = size * (0.7 + layer * 0.3);
      const grad = ctx.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      const hShift = layer * 25;
      grad.addColorStop(0, `hsla(${(h + hShift) % 360}, ${s}%, ${Math.min(100, l + 25)}%, 0.25)`);
      grad.addColorStop(0.4, `hsla(${(h + hShift) % 360}, ${s}%, ${l}%, 0.08)`);
      grad.addColorStop(1, `hsla(${(h + hShift) % 360}, ${s}%, ${l}%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fine dots inside
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

  /** Snap → burst effect */
  private spawnSnapBurst(f: AudioFeatures) {
    const cx = this.cursorX + (Math.random() - 0.5) * 150;
    const cy = this.cursorY + (Math.random() - 0.5) * 150;
    const sc = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];

    // Starburst
    this.bursts.push({
      x: cx, y: cy, hue: sc[0], sat: sc[1], light: sc[2],
      size: 35 + f.volume * 50, life: 1, type: 'starburst', vx: 0, vy: 0,
    });
    // Ring
    this.bursts.push({
      x: cx, y: cy, hue: sc[0], sat: sc[1], light: sc[2],
      size: 5, life: 1, type: 'ring', vx: 0, vy: 0,
    });
    // Shards
    const count = 10 + Math.floor(Math.random() * 10);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const speed = 3 + Math.random() * 6;
      const sC = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];
      this.bursts.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        hue: sC[0], sat: sC[1], light: sC[2],
        size: 4 + Math.random() * 12, life: 1, type: 'shard',
      });
    }
    // Stipple burst
    this.spawnStippleAt(cx, cy, sc[0], sc[1], sc[2], 50 + f.volume * 40, 60);
  }

  private updateBursts() {
    for (const b of this.bursts) {
      if (b.type === 'ring') { b.size += 3; b.life -= 0.015; }
      else if (b.type === 'starburst') { b.life -= 0.012; }
      else if (b.type === 'shard') {
        b.x += b.vx; b.y += b.vy;
        b.vx *= 0.95; b.vy *= 0.95;
        b.life -= 0.008;
      }
    }

    // Commit dying bursts to accumulation
    const dying = this.bursts.filter(b => b.life <= 0.3 && b.life > 0.25);
    // Always draw active bursts
    const ctx = this.accCtx;
    for (const b of this.bursts) {
      if (b.life <= 0) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, b.life);
      const color = `hsl(${b.hue}, ${b.sat}%, ${b.light}%)`;

      if (b.type === 'starburst') {
        ctx.shadowColor = color;
        ctx.shadowBlur = 50;
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, b.size);
        grad.addColorStop(0, `hsla(${b.hue}, ${b.sat}%, 98%, ${b.life})`);
        grad.addColorStop(0.15, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, ${b.life * 0.7})`);
        grad.addColorStop(1, `hsla(${b.hue}, ${b.sat}%, ${b.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = `hsla(0, 0%, 100%, ${b.life * 0.4})`;
        ctx.lineWidth = 1;
        for (let a = 0; a < 6; a++) {
          const angle = (a / 6) * Math.PI * 2 + this.time;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.x + Math.cos(angle) * b.size * 1.8, b.y + Math.sin(angle) * b.size * 1.8);
          ctx.stroke();
        }
      } else if (b.type === 'ring') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.type === 'shard') {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        const angle = Math.atan2(b.vy, b.vx);
        const len = b.size * 2;
        const w = b.size * 0.3;
        ctx.beginPath();
        ctx.moveTo(b.x + Math.cos(angle) * len, b.y + Math.sin(angle) * len);
        ctx.lineTo(b.x + Math.cos(angle + Math.PI / 2) * w, b.y + Math.sin(angle + Math.PI / 2) * w);
        ctx.lineTo(b.x - Math.cos(angle) * len * 0.3, b.y - Math.sin(angle) * len * 0.3);
        ctx.lineTo(b.x + Math.cos(angle - Math.PI / 2) * w, b.y + Math.sin(angle - Math.PI / 2) * w);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    this.bursts = this.bursts.filter(b => b.life > 0);
  }

  private render() {
    const ctx = this.accCtx;

    // Draw active (in-progress) flows directly to accumulation
    for (const flow of this.activeFlows) {
      if (flow.points.length < 2) continue;
      // Only draw the latest segment to avoid redrawing everything
      const len = flow.points.length;
      if (len < 2) continue;

      const p0 = flow.points[len - 2];
      const p1 = flow.points[len - 1];

      ctx.save();

      if (flow.style === 'dotted') {
        ctx.globalAlpha = 0.7 + p1.volume * 0.3;
        ctx.fillStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`;
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, p1.size * 0.6, 0, Math.PI * 2);
        ctx.fill();
        const scatter = 2 + p1.volume * 4;
        for (let d = 0; d < scatter; d++) {
          const ox = (Math.random() - 0.5) * p1.size * 4;
          const oy = (Math.random() - 0.5) * p1.size * 4;
          ctx.globalAlpha = 0.25 + Math.random() * 0.3;
          ctx.beginPath();
          ctx.arc(p1.x + ox, p1.y + oy, 0.4 + Math.random(), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (flow.style === 'glow') {
        ctx.globalAlpha = 0.12 + p1.volume * 0.15;
        const r = p1.size * 5;
        const grad = ctx.createRadialGradient(p1.x, p1.y, 0, p1.x, p1.y, r);
        grad.addColorStop(0, `hsla(${p1.hue}, ${p1.sat}%, ${Math.min(100, p1.light + 20)}%, 0.4)`);
        grad.addColorStop(0.5, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0.08)`);
        grad.addColorStop(1, `hsla(${p1.hue}, ${p1.sat}%, ${p1.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p1.x, p1.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.globalAlpha = 0.6 + p1.volume * 0.4;
        ctx.strokeStyle = `hsl(${p1.hue}, ${p1.sat}%, ${p1.light}%)`;
        ctx.lineWidth = p1.size;
        ctx.lineCap = 'round';
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = p1.size * 3;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      ctx.restore();
    }

    // Composite to display
    const display = this.ctx;
    display.drawImage(this.accCanvas, 0, 0);

    // Bloom
    const gw = this.glowCanvas.width;
    const gh = this.glowCanvas.height;
    this.glowCtx.clearRect(0, 0, gw, gh);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, gw, gh);
    this.glowCtx.filter = 'blur(6px)';
    this.glowCtx.drawImage(this.glowCanvas, 0, 0);
    this.glowCtx.filter = 'none';

    display.save();
    display.globalCompositeOperation = 'lighter';
    display.globalAlpha = 0.3;
    display.drawImage(this.glowCanvas, 0, 0, this.canvas.width, this.canvas.height);
    display.restore();
  }

  toDataURL(): string {
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const oCtx = out.getContext('2d')!;
    oCtx.drawImage(this.accCanvas, 0, 0);

    this.glowCtx.clearRect(0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, this.glowCanvas.width, this.glowCanvas.height);
    this.glowCtx.filter = 'blur(6px)';
    this.glowCtx.drawImage(this.glowCanvas, 0, 0);
    this.glowCtx.filter = 'none';

    oCtx.globalCompositeOperation = 'lighter';
    oCtx.globalAlpha = 0.3;
    oCtx.drawImage(this.glowCanvas, 0, 0, out.width, out.height);

    return out.toDataURL('image/png');
  }

  clear() {
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.activeFlows = [];
    this.flows = [];
    this.bursts = [];
    this.cursorX = this.canvas.width / 2;
    this.cursorY = this.canvas.height / 2;
    this.totalDrawn = 0;
  }
}
