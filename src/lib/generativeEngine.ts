import { AudioFeatures } from './audioAnalyzer';

// Neon color palette inspired by bioluminescent art
const NEON_COLORS = [
  [330, 100, 65],  // pink
  [180, 100, 50],  // cyan
  [120, 100, 55],  // green
  [25, 100, 55],   // orange
  [220, 100, 60],  // blue
  [300, 100, 60],  // magenta
  [55, 100, 55],   // yellow
  [0, 100, 55],    // red
];

// Snap-specific bright crystalline colors
const SNAP_COLORS = [
  [45, 100, 75],   // bright gold
  [195, 100, 70],  // ice blue
  [0, 0, 95],      // white
  [280, 80, 75],   // lavender
  [160, 100, 65],  // aquamarine
];

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  hue: number; sat: number; light: number;
  size: number; life: number; maxLife: number;
  type: 'orb' | 'tendril' | 'dot' | 'spore' | 'shard' | 'ring' | 'starburst';
}

interface Tendril {
  points: { x: number; y: number }[];
  hue: number; sat: number; light: number;
  width: number; life: number;
}

export class GenerativeEngine {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private tendrils: Tendril[] = [];
  private time = 0;
  private seedX: number;
  private seedY: number;
  private colorOffset: number;
  private accumulationCanvas: HTMLCanvasElement;
  private accCtx: CanvasRenderingContext2D;
  private cursorX: number;
  private cursorY: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.seedX = Math.random() * 1000;
    this.seedY = Math.random() * 1000;
    this.colorOffset = Math.random() * 360;
    this.cursorX = canvas.width / 2;
    this.cursorY = canvas.height / 2;

    this.accumulationCanvas = document.createElement('canvas');
    this.accumulationCanvas.width = canvas.width;
    this.accumulationCanvas.height = canvas.height;
    this.accCtx = this.accumulationCanvas.getContext('2d')!;
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, canvas.width, canvas.height);
  }

  update(features: AudioFeatures) {
    this.time += 0.016;

    if (features.isSpeaking) {
      // Slowly drift the drawing cursor
      this.cursorX += Math.sin(this.time * 0.7 + this.seedX) * 2 + (Math.random() - 0.5) * features.volume * 10;
      this.cursorY += Math.cos(this.time * 0.5 + this.seedY) * 2 + (Math.random() - 0.5) * features.volume * 10;
      // Keep within canvas bounds with margin
      this.cursorX = Math.max(100, Math.min(this.canvas.width - 100, this.cursorX));
      this.cursorY = Math.max(100, Math.min(this.canvas.height - 100, this.cursorY));

      if (features.isSnap) {
        this.spawnSnapEffect(features);
      } else {
        this.spawnVoiceParticles(features);
        this.growTendrils(features);
      }
    }

    this.updateParticles();
    this.updateTendrils();
    this.render(features);
  }

  /** Voice → organic flowing shapes: orbs, spores, dots, tendrils */
  private spawnVoiceParticles(f: AudioFeatures) {
    const count = Math.floor(f.volume * 20) + 2;

    for (let i = 0; i < count; i++) {
      const angle = this.time * 0.5 + (f.pitch / 500) * Math.PI * 2 + Math.random() * Math.PI * 2;
      const dist = f.bass * 150 + Math.random() * 100;
      const colorIdx = Math.floor((f.pitch / 1000 * NEON_COLORS.length + this.colorOffset / 60)) % NEON_COLORS.length;
      const [h, s, l] = NEON_COLORS[Math.abs(colorIdx)];

      const type: Particle['type'] = f.bass > 0.5 ? 'orb' : f.treble > 0.3 ? 'dot' : f.mid > 0.3 ? 'spore' : 'dot';

      this.particles.push({
        x: this.cursorX + Math.cos(angle) * dist * (0.3 + Math.random() * 0.7),
        y: this.cursorY + Math.sin(angle) * dist * (0.3 + Math.random() * 0.7),
        vx: Math.cos(angle) * f.volume * 2 + (Math.random() - 0.5),
        vy: Math.sin(angle) * f.volume * 2 + (Math.random() - 0.5),
        hue: (h + f.pitch * 0.1 + this.colorOffset) % 360,
        sat: s,
        light: l + f.volume * 20,
        size: type === 'orb' ? (f.bass * 50 + 10) : type === 'spore' ? (f.mid * 20 + 5) : (f.treble * 8 + 2),
        life: 1,
        maxLife: 1,
        type,
      });
    }

    if (this.particles.length > 600) {
      this.particles = this.particles.slice(-600);
    }
  }

  /** Snap → crystalline shards, rings, starbursts */
  private spawnSnapEffect(f: AudioFeatures) {
    const cx = this.cursorX + (Math.random() - 0.5) * 200;
    const cy = this.cursorY + (Math.random() - 0.5) * 200;
    const snapColor = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];

    // Starburst center
    this.particles.push({
      x: cx, y: cy,
      vx: 0, vy: 0,
      hue: snapColor[0], sat: snapColor[1], light: snapColor[2],
      size: 30 + f.volume * 40,
      life: 1, maxLife: 1,
      type: 'starburst',
    });

    // Expanding ring
    this.particles.push({
      x: cx, y: cy,
      vx: 0, vy: 0,
      hue: snapColor[0], sat: snapColor[1], light: snapColor[2],
      size: 5,
      life: 1, maxLife: 1,
      type: 'ring',
    });

    // Radiating shards
    const shardCount = 8 + Math.floor(Math.random() * 8);
    for (let i = 0; i < shardCount; i++) {
      const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 3 + Math.random() * 5;
      const sColor = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: sColor[0], sat: sColor[1], light: sColor[2],
        size: 3 + Math.random() * 10,
        life: 1, maxLife: 1,
        type: 'shard',
      });
    }

    // Scatter fine dots
    for (let i = 0; i < 20; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1 + Math.random() * 3;
      this.particles.push({
        x: cx + (Math.random() - 0.5) * 20,
        y: cy + (Math.random() - 0.5) * 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        hue: 0, sat: 0, light: 90 + Math.random() * 10,
        size: 1 + Math.random() * 2,
        life: 1, maxLife: 1,
        type: 'dot',
      });
    }
  }

  private growTendrils(f: AudioFeatures) {
    if (Math.random() > 0.08 || !f.isSpeaking) return;

    const colorIdx = Math.floor(Math.random() * NEON_COLORS.length);
    const [h, s, l] = NEON_COLORS[colorIdx];

    const points = [{ x: this.cursorX, y: this.cursorY }];
    let x = this.cursorX, y = this.cursorY;
    const segments = Math.floor(f.volume * 30) + 10;

    for (let i = 0; i < segments; i++) {
      const angle = -Math.PI / 2 + Math.sin(this.time + i * 0.3 + this.seedX) * 1.2 + Math.cos(this.time * 0.7 + i * 0.2 + this.seedY) * 0.5;
      const step = 4 + f.bass * 8;
      x += Math.cos(angle) * step + (Math.random() - 0.5) * f.treble * 15;
      y += Math.sin(angle) * step + (Math.random() - 0.5) * f.mid * 10;
      points.push({ x, y });
    }

    this.tendrils.push({
      points,
      hue: (h + this.colorOffset) % 360,
      sat: s,
      light: l,
      width: f.bass * 6 + 1,
      life: 1,
    });

    if (this.tendrils.length > 40) {
      this.tendrils = this.tendrils.slice(-40);
    }
  }

  private updateParticles() {
    for (const p of this.particles) {
      if (p.type === 'ring') {
        p.size += 3; // expand ring
        p.life -= 0.015;
      } else if (p.type === 'starburst') {
        p.life -= 0.012;
      } else if (p.type === 'shard') {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.96;
        p.vy *= 0.96;
        p.life -= 0.008;
      } else {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.01;
        p.vx *= 0.995;
        p.vy *= 0.995;
        p.life -= 0.004;
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private updateTendrils() {
    for (const t of this.tendrils) {
      t.life -= 0.003;
    }
    this.tendrils = this.tendrils.filter(t => t.life > 0);
  }

  private render(f: AudioFeatures) {
    const ctx = this.accCtx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // NO fade — everything accumulates permanently

    // Draw tendrils
    for (const t of this.tendrils) {
      if (t.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life * 0.9);
      ctx.strokeStyle = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
      ctx.lineWidth = t.width * Math.min(1, t.life + 0.3);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
      ctx.shadowBlur = 15;

      ctx.beginPath();
      ctx.moveTo(t.points[0].x, t.points[0].y);
      for (let i = 1; i < t.points.length - 1; i++) {
        const xc = (t.points[i].x + t.points[i + 1].x) / 2;
        const yc = (t.points[i].y + t.points[i + 1].y) / 2;
        ctx.quadraticCurveTo(t.points[i].x, t.points[i].y, xc, yc);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Draw particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 0.85);
      const color = `hsl(${p.hue}, ${p.sat}%, ${p.light}%)`;

      if (p.type === 'starburst') {
        // Bright flash with radiating lines
        ctx.shadowColor = color;
        ctx.shadowBlur = 40;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, 98%, ${p.life})`);
        grad.addColorStop(0.2, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${p.life * 0.7})`);
        grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
        // Cross spikes
        ctx.strokeStyle = `hsla(0, 0%, 100%, ${p.life * 0.6})`;
        ctx.lineWidth = 1.5;
        const spikeLen = p.size * 1.5;
        for (let a = 0; a < 4; a++) {
          const angle = (a / 4) * Math.PI * 2 + Math.PI / 8;
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(angle) * spikeLen, p.y + Math.sin(angle) * spikeLen);
          ctx.stroke();
        }
      } else if (p.type === 'ring') {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.shadowColor = color;
        ctx.shadowBlur = 15;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      } else if (p.type === 'shard') {
        // Angular crystalline shard
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        const angle = Math.atan2(p.vy, p.vx);
        const len = p.size * 2;
        const w2 = p.size * 0.3;
        ctx.beginPath();
        ctx.moveTo(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len);
        ctx.lineTo(p.x + Math.cos(angle + Math.PI / 2) * w2, p.y + Math.sin(angle + Math.PI / 2) * w2);
        ctx.lineTo(p.x - Math.cos(angle) * len * 0.3, p.y - Math.sin(angle) * len * 0.3);
        ctx.lineTo(p.x + Math.cos(angle - Math.PI / 2) * w2, p.y + Math.sin(angle - Math.PI / 2) * w2);
        ctx.closePath();
        ctx.fill();
      } else if (p.type === 'orb') {
        ctx.shadowColor = color;
        ctx.shadowBlur = p.size * 2;
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, ${Math.min(100, p.light + 30)}%, 0.9)`);
        grad.addColorStop(0.4, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0.5)`);
        grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spore') {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 6;
        const dots = 6;
        for (let i = 0; i < dots; i++) {
          const a = (i / dots) * Math.PI * 2 + this.time;
          const r = p.size * 0.7;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.size * 0.15, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 0.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Copy accumulation to display canvas
    this.ctx.drawImage(this.accumulationCanvas, 0, 0);
  }

  /** Export the accumulated canvas as data URL */
  toDataURL(): string {
    return this.accumulationCanvas.toDataURL('image/png');
  }

  clear() {
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles = [];
    this.tendrils = [];
    this.cursorX = this.canvas.width / 2;
    this.cursorY = this.canvas.height / 2;
  }
}
