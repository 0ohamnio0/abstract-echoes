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

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  hue: number; sat: number; light: number;
  size: number; life: number; maxLife: number;
  type: 'orb' | 'tendril' | 'dot' | 'spore';
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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    // Unique seed per session for person-specific art
    this.seedX = Math.random() * 1000;
    this.seedY = Math.random() * 1000;
    this.colorOffset = Math.random() * 360;

    // Accumulation layer
    this.accumulationCanvas = document.createElement('canvas');
    this.accumulationCanvas.width = canvas.width;
    this.accumulationCanvas.height = canvas.height;
    this.accCtx = this.accumulationCanvas.getContext('2d')!;
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, canvas.width, canvas.height);
  }

  update(features: AudioFeatures) {
    this.time += 0.016;
    const { volume, bass, mid, treble, pitch, isSpeaking } = features;

    if (isSpeaking) {
      this.spawnParticles(features);
      this.growTendrils(features);
    }

    this.updateParticles();
    this.updateTendrils();
    this.render(features);
  }

  private spawnParticles(f: AudioFeatures) {
    const count = Math.floor(f.volume * 15) + 1;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;

    for (let i = 0; i < count; i++) {
      const angle = this.time * 0.5 + (f.pitch / 500) * Math.PI * 2 + Math.random() * Math.PI * 2;
      const dist = f.bass * 300 + Math.random() * 200;
      const colorIdx = Math.floor((f.pitch / 1000 * NEON_COLORS.length + this.colorOffset / 60)) % NEON_COLORS.length;
      const [h, s, l] = NEON_COLORS[Math.abs(colorIdx)];

      const type = f.bass > 0.5 ? 'orb' : f.treble > 0.3 ? 'dot' : f.mid > 0.3 ? 'spore' : 'dot';

      this.particles.push({
        x: cx + Math.cos(angle) * dist * (0.5 + Math.random()),
        y: cy + Math.sin(angle) * dist * (0.5 + Math.random()),
        vx: Math.cos(angle) * f.volume * 3 + (Math.random() - 0.5) * 2,
        vy: Math.sin(angle) * f.volume * 3 + (Math.random() - 0.5) * 2 - f.treble * 2,
        hue: (h + f.pitch * 0.1 + this.colorOffset) % 360,
        sat: s,
        light: l + f.volume * 20,
        size: type === 'orb' ? (f.bass * 40 + 5) : type === 'spore' ? (f.mid * 15 + 2) : (f.treble * 6 + 1),
        life: 1,
        maxLife: 1,
        type,
      });
    }

    // Limit particles
    if (this.particles.length > 500) {
      this.particles = this.particles.slice(-500);
    }
  }

  private growTendrils(f: AudioFeatures) {
    if (Math.random() > 0.1 || !f.isSpeaking) return;

    const startX = Math.random() * this.canvas.width;
    const startY = this.canvas.height * (0.6 + Math.random() * 0.4);
    const colorIdx = Math.floor(Math.random() * NEON_COLORS.length);
    const [h, s, l] = NEON_COLORS[colorIdx];

    const points = [{ x: startX, y: startY }];
    let x = startX, y = startY;
    const segments = Math.floor(f.volume * 30) + 10;

    for (let i = 0; i < segments; i++) {
      const angle = -Math.PI / 2 + Math.sin(this.time + i * 0.3 + this.seedX) * 0.8;
      const step = 5 + f.bass * 10;
      x += Math.cos(angle) * step + (Math.random() - 0.5) * f.treble * 20;
      y += Math.sin(angle) * step;
      points.push({ x, y });
    }

    this.tendrils.push({
      points,
      hue: (h + this.colorOffset) % 360,
      sat: s,
      light: l,
      width: f.bass * 8 + 1,
      life: 1,
    });

    if (this.tendrils.length > 30) {
      this.tendrils = this.tendrils.slice(-30);
    }
  }

  private updateParticles() {
    for (const p of this.particles) {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.02; // slight gravity
      p.vx *= 0.99;
      p.vy *= 0.99;
      p.life -= 0.003;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private updateTendrils() {
    for (const t of this.tendrils) {
      t.life -= 0.002;
    }
    this.tendrils = this.tendrils.filter(t => t.life > 0);
  }

  private render(f: AudioFeatures) {
    const ctx = this.accCtx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Subtle fade for accumulation effect
    ctx.fillStyle = 'rgba(0, 0, 0, 0.008)';
    ctx.fillRect(0, 0, w, h);

    // Draw tendrils
    for (const t of this.tendrils) {
      if (t.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = t.life * 0.7;
      ctx.strokeStyle = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
      ctx.lineWidth = t.width * t.life;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.shadowColor = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
      ctx.shadowBlur = 20;

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
      ctx.globalAlpha = p.life * 0.8;

      const color = `hsl(${p.hue}, ${p.sat}%, ${p.light}%)`;
      ctx.shadowColor = color;
      ctx.shadowBlur = p.size * 2;

      if (p.type === 'orb') {
        // Glowing orb with gradient
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, ${Math.min(100, p.light + 30)}%, 0.9)`);
        grad.addColorStop(0.4, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0.5)`);
        grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.type === 'spore') {
        // Dotted spore pattern
        ctx.fillStyle = color;
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
        // Simple dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // Draw waveform overlay when speaking
    if (f.isSpeaking && f.waveform.length > 0) {
      ctx.save();
      ctx.globalAlpha = f.volume * 0.15;
      const waveColor = NEON_COLORS[Math.floor(this.time * 0.5) % NEON_COLORS.length];
      ctx.strokeStyle = `hsl(${(waveColor[0] + this.colorOffset) % 360}, ${waveColor[1]}%, ${waveColor[2]}%)`;
      ctx.lineWidth = 1;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      const sliceWidth = w / f.waveform.length;
      let wx = 0;
      for (let i = 0; i < f.waveform.length; i++) {
        const v = f.waveform[i] / 128.0;
        const wy = (h / 2) + (v - 1) * h * 0.3 * f.volume;
        if (i === 0) ctx.moveTo(wx, wy);
        else ctx.lineTo(wx, wy);
        wx += sliceWidth;
      }
      ctx.stroke();
      ctx.restore();
    }

    // Copy accumulation to display
    this.ctx.drawImage(this.accumulationCanvas, 0, 0);
  }

  clear() {
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.particles = [];
    this.tendrils = [];
  }
}
