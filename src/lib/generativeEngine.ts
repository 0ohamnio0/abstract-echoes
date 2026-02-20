import { AudioFeatures } from './audioAnalyzer';

const NEON_COLORS = [
  [330, 100, 65],  // hot pink
  [180, 100, 50],  // cyan
  [120, 100, 55],  // green
  [25, 100, 55],   // orange
  [220, 100, 60],  // blue
  [300, 100, 60],  // magenta
  [55, 100, 55],   // yellow
  [0, 100, 55],    // red
  [270, 80, 60],   // violet
  [350, 100, 70],  // coral pink
  [160, 100, 45],  // teal
  [40, 100, 60],   // amber
];

const SNAP_COLORS = [
  [45, 100, 75],
  [195, 100, 70],
  [0, 0, 95],
  [280, 80, 75],
  [160, 100, 65],
];

type PType = 'orb' | 'dot' | 'spore' | 'shard' | 'ring' | 'starburst' | 'stipple_cluster' | 'spiral' | 'nebula' | 'filament';

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  hue: number; sat: number; light: number;
  size: number; life: number; maxLife: number;
  type: PType;
  angle?: number;
  data?: any;
}

interface Tendril {
  points: { x: number; y: number }[];
  hue: number; sat: number; light: number;
  width: number; life: number;
  dotted: boolean;
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
  private accCanvas: HTMLCanvasElement;
  private accCtx: CanvasRenderingContext2D;
  private glowCanvas: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;
  private cursorX: number;
  private cursorY: number;
  private prevCursorX: number;
  private prevCursorY: number;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.seedX = Math.random() * 1000;
    this.seedY = Math.random() * 1000;
    this.colorOffset = Math.random() * 360;
    this.cursorX = canvas.width / 2;
    this.cursorY = canvas.height / 2;
    this.prevCursorX = this.cursorX;
    this.prevCursorY = this.cursorY;

    // Main accumulation layer
    this.accCanvas = document.createElement('canvas');
    this.accCanvas.width = canvas.width;
    this.accCanvas.height = canvas.height;
    this.accCtx = this.accCanvas.getContext('2d')!;
    this.accCtx.fillStyle = '#000';
    this.accCtx.fillRect(0, 0, canvas.width, canvas.height);

    // Glow/bloom layer (half resolution for performance)
    this.glowCanvas = document.createElement('canvas');
    this.glowCanvas.width = Math.floor(canvas.width / 4);
    this.glowCanvas.height = Math.floor(canvas.height / 4);
    this.glowCtx = this.glowCanvas.getContext('2d')!;
  }

  update(features: AudioFeatures) {
    this.time += 0.016;

    if (features.isSpeaking) {
      this.prevCursorX = this.cursorX;
      this.prevCursorY = this.cursorY;
      const drift = features.volume * 8 + 1;
      this.cursorX += Math.sin(this.time * 0.7 + this.seedX) * drift + (Math.random() - 0.5) * drift * 2;
      this.cursorY += Math.cos(this.time * 0.5 + this.seedY) * drift + (Math.random() - 0.5) * drift * 2;
      this.cursorX = Math.max(80, Math.min(this.canvas.width - 80, this.cursorX));
      this.cursorY = Math.max(80, Math.min(this.canvas.height - 80, this.cursorY));

      if (features.isSnap) {
        this.spawnSnapEffect(features);
      } else {
        this.spawnVoiceParticles(features);
        this.spawnStippleClusters(features);
        this.spawnSpirals(features);
        this.growTendrils(features);
        this.spawnNebula(features);
      }
    }

    this.updateParticles();
    this.updateTendrils();
    this.render();
  }

  private pickColor(f: AudioFeatures): [number, number, number] {
    const idx = Math.floor((f.pitch / 800 * NEON_COLORS.length + this.colorOffset / 30)) % NEON_COLORS.length;
    const [h, s, l] = NEON_COLORS[Math.abs(idx)];
    return [(h + f.pitch * 0.05 + this.colorOffset) % 360, s, l + f.volume * 15];
  }

  /** Voice → organic flowing orbs and spores */
  private spawnVoiceParticles(f: AudioFeatures) {
    const count = Math.floor(f.volume * 12) + 1;
    for (let i = 0; i < count; i++) {
      const angle = this.time * 0.3 + (f.pitch / 400) * Math.PI * 2 + Math.random() * Math.PI * 2;
      const dist = f.bass * 120 + Math.random() * 80;
      const [h, s, l] = this.pickColor(f);
      const type: PType = f.bass > 0.4 ? 'orb' : f.mid > 0.3 ? 'spore' : 'dot';

      this.particles.push({
        x: this.cursorX + Math.cos(angle) * dist,
        y: this.cursorY + Math.sin(angle) * dist,
        vx: Math.cos(angle) * f.volume * 1.5,
        vy: Math.sin(angle) * f.volume * 1.5,
        hue: h, sat: s, light: l,
        size: type === 'orb' ? (f.bass * 45 + 12) : type === 'spore' ? (f.mid * 18 + 6) : (f.treble * 5 + 1.5),
        life: 1, maxLife: 1, type,
      });
    }
    if (this.particles.length > 800) this.particles = this.particles.slice(-800);
  }

  /** 점묘 패턴 — dense clusters of tiny dots forming larger shapes */
  private spawnStippleClusters(f: AudioFeatures) {
    if (Math.random() > 0.15) return;
    const [h, s, l] = this.pickColor(f);
    const cx = this.cursorX + (Math.random() - 0.5) * 200;
    const cy = this.cursorY + (Math.random() - 0.5) * 200;
    const clusterSize = 30 + f.volume * 80;
    const dotCount = 40 + Math.floor(f.volume * 100);

    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      hue: h, sat: s, light: l,
      size: clusterSize, life: 1, maxLife: 1,
      type: 'stipple_cluster',
      data: { dotCount, innerHue: (h + 30) % 360 },
    });
  }

  /** 유기적 나선 */
  private spawnSpirals(f: AudioFeatures) {
    if (Math.random() > 0.06) return;
    const [h, s, l] = this.pickColor(f);
    const cx = this.cursorX + (Math.random() - 0.5) * 150;
    const cy = this.cursorY + (Math.random() - 0.5) * 150;

    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      hue: h, sat: s, light: l,
      size: 40 + f.volume * 60,
      life: 1, maxLife: 1,
      type: 'spiral',
      angle: Math.random() * Math.PI * 2,
      data: { turns: 2 + Math.random() * 3, direction: Math.random() > 0.5 ? 1 : -1 },
    });
  }

  /** Nebula — soft glowing cloud */
  private spawnNebula(f: AudioFeatures) {
    if (Math.random() > 0.04) return;
    const [h, s, l] = this.pickColor(f);
    this.particles.push({
      x: this.cursorX + (Math.random() - 0.5) * 250,
      y: this.cursorY + (Math.random() - 0.5) * 250,
      vx: 0, vy: 0,
      hue: h, sat: s, light: l,
      size: 60 + f.volume * 100,
      life: 1, maxLife: 1,
      type: 'nebula',
    });
  }

  /** Snap → crystalline shards, rings, starbursts */
  private spawnSnapEffect(f: AudioFeatures) {
    const cx = this.cursorX + (Math.random() - 0.5) * 200;
    const cy = this.cursorY + (Math.random() - 0.5) * 200;
    const sc = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];

    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      hue: sc[0], sat: sc[1], light: sc[2],
      size: 35 + f.volume * 50, life: 1, maxLife: 1, type: 'starburst',
    });
    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      hue: sc[0], sat: sc[1], light: sc[2],
      size: 5, life: 1, maxLife: 1, type: 'ring',
    });

    const shardCount = 10 + Math.floor(Math.random() * 10);
    for (let i = 0; i < shardCount; i++) {
      const angle = (i / shardCount) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 3 + Math.random() * 6;
      const sC = SNAP_COLORS[Math.floor(Math.random() * SNAP_COLORS.length)];
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        hue: sC[0], sat: sC[1], light: sC[2],
        size: 4 + Math.random() * 12, life: 1, maxLife: 1, type: 'shard',
      });
    }

    // Snap stipple burst
    this.particles.push({
      x: cx, y: cy, vx: 0, vy: 0,
      hue: 0, sat: 0, light: 90,
      size: 50 + f.volume * 40, life: 1, maxLife: 1,
      type: 'stipple_cluster',
      data: { dotCount: 80, innerHue: sc[0] },
    });
  }

  /** Organic tendrils with optional dotted style */
  private growTendrils(f: AudioFeatures) {
    if (Math.random() > 0.07) return;
    const colorIdx = Math.floor(Math.random() * NEON_COLORS.length);
    const [h, s, l] = NEON_COLORS[colorIdx];
    const dotted = Math.random() > 0.5;

    const points = [{ x: this.cursorX, y: this.cursorY }];
    let x = this.cursorX, y = this.cursorY;
    const segments = Math.floor(f.volume * 40) + 15;

    for (let i = 0; i < segments; i++) {
      const angle = -Math.PI / 2
        + Math.sin(this.time * 0.8 + i * 0.25 + this.seedX) * 1.0
        + Math.cos(this.time * 0.3 + i * 0.15 + this.seedY) * 0.6;
      const step = 3 + f.bass * 7;
      x += Math.cos(angle) * step + (Math.random() - 0.5) * f.treble * 12;
      y += Math.sin(angle) * step + (Math.random() - 0.5) * f.mid * 8;
      points.push({ x, y });
    }

    this.tendrils.push({
      points,
      hue: (h + this.colorOffset) % 360,
      sat: s, light: l,
      width: f.bass * 5 + 1,
      life: 1,
      dotted,
    });

    if (this.tendrils.length > 50) this.tendrils = this.tendrils.slice(-50);
  }

  private updateParticles() {
    for (const p of this.particles) {
      if (p.type === 'ring') {
        p.size += 2.5;
        p.life -= 0.012;
      } else if (p.type === 'starburst') {
        p.life -= 0.01;
      } else if (p.type === 'shard') {
        p.x += p.vx; p.y += p.vy;
        p.vx *= 0.95; p.vy *= 0.95;
        p.life -= 0.007;
      } else if (p.type === 'stipple_cluster' || p.type === 'spiral' || p.type === 'nebula') {
        p.life -= 0.008;
      } else {
        p.x += p.vx; p.y += p.vy;
        p.vy += 0.005;
        p.vx *= 0.997; p.vy *= 0.997;
        p.life -= 0.005;
      }
    }
    this.particles = this.particles.filter(p => p.life > 0);
  }

  private updateTendrils() {
    for (const t of this.tendrils) t.life -= 0.004;
    this.tendrils = this.tendrils.filter(t => t.life > 0);
  }

  private render() {
    const ctx = this.accCtx;

    // Draw tendrils
    for (const t of this.tendrils) {
      if (t.points.length < 2) continue;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t.life * 0.85);
      const color = `hsl(${t.hue}, ${t.sat}%, ${t.light}%)`;
      ctx.shadowColor = color;
      ctx.shadowBlur = 20;

      if (t.dotted) {
        // Dotted tendril — stipple along path
        ctx.fillStyle = color;
        for (let i = 0; i < t.points.length; i++) {
          const pt = t.points[i];
          const dotSize = (t.width * 0.4 + Math.random() * t.width * 0.3) * Math.min(1, t.life + 0.3);
          ctx.beginPath();
          ctx.arc(pt.x + (Math.random() - 0.5) * 3, pt.y + (Math.random() - 0.5) * 3, dotSize, 0, Math.PI * 2);
          ctx.fill();
          // Scatter extra tiny dots around
          if (Math.random() > 0.5) {
            const ox = (Math.random() - 0.5) * 10;
            const oy = (Math.random() - 0.5) * 10;
            ctx.beginPath();
            ctx.arc(pt.x + ox, pt.y + oy, dotSize * 0.3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        ctx.strokeStyle = color;
        ctx.lineWidth = t.width * Math.min(1, t.life + 0.3);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(t.points[0].x, t.points[0].y);
        for (let i = 1; i < t.points.length - 1; i++) {
          const xc = (t.points[i].x + t.points[i + 1].x) / 2;
          const yc = (t.points[i].y + t.points[i + 1].y) / 2;
          ctx.quadraticCurveTo(t.points[i].x, t.points[i].y, xc, yc);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw particles
    for (const p of this.particles) {
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life * 0.9);
      const color = `hsl(${p.hue}, ${p.sat}%, ${p.light}%)`;

      switch (p.type) {
        case 'stipple_cluster':
          this.drawStippleCluster(ctx, p, color);
          break;
        case 'spiral':
          this.drawSpiral(ctx, p, color);
          break;
        case 'nebula':
          this.drawNebula(ctx, p, color);
          break;
        case 'starburst':
          this.drawStarburst(ctx, p, color);
          break;
        case 'ring':
          this.drawRing(ctx, p, color);
          break;
        case 'shard':
          this.drawShard(ctx, p, color);
          break;
        case 'orb':
          this.drawOrb(ctx, p, color);
          break;
        case 'spore':
          this.drawSpore(ctx, p, color);
          break;
        default:
          this.drawDot(ctx, p, color);
      }
      ctx.restore();
    }

    // Composite: accumulation + bloom glow
    const display = this.ctx;
    display.drawImage(this.accCanvas, 0, 0);

    // Bloom pass: downsample, blur, overlay with additive blending
    const gw = this.glowCanvas.width;
    const gh = this.glowCanvas.height;
    this.glowCtx.clearRect(0, 0, gw, gh);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, gw, gh);
    this.glowCtx.filter = 'blur(8px)';
    this.glowCtx.drawImage(this.glowCanvas, 0, 0);
    this.glowCtx.filter = 'none';

    display.save();
    display.globalCompositeOperation = 'lighter';
    display.globalAlpha = 0.35;
    display.drawImage(this.glowCanvas, 0, 0, this.canvas.width, this.canvas.height);
    display.restore();
  }

  // ─── Drawing helpers ────────────────────────────

  private drawStippleCluster(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    const { dotCount, innerHue } = p.data;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;

    for (let i = 0; i < dotCount; i++) {
      // Gaussian-ish distribution using Box-Muller-lite
      const r = p.size * Math.sqrt(-2 * Math.log(Math.max(0.001, Math.random()))) * 0.4;
      const a = Math.random() * Math.PI * 2;
      const dx = p.x + Math.cos(a) * r;
      const dy = p.y + Math.sin(a) * r;
      const dist = Math.sqrt((dx - p.x) ** 2 + (dy - p.y) ** 2) / p.size;

      // Color shifts from center to edge
      const dotHue = dist < 0.3 ? innerHue : p.hue;
      const dotLight = p.light + (1 - dist) * 20;
      const dotSize = (1 - dist * 0.7) * (1.5 + Math.random() * 2);

      ctx.fillStyle = `hsl(${dotHue}, ${p.sat}%, ${Math.min(100, dotLight)}%)`;
      ctx.beginPath();
      ctx.arc(dx, dy, dotSize * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSpiral(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    const { turns, direction } = p.data;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;

    const totalSteps = Math.floor(turns * 40);
    const baseAngle = p.angle || 0;

    for (let i = 0; i < totalSteps; i++) {
      const t = i / totalSteps;
      const angle = baseAngle + t * turns * Math.PI * 2 * direction;
      const r = t * p.size;
      const sx = p.x + Math.cos(angle) * r;
      const sy = p.y + Math.sin(angle) * r;

      const dotSize = (1 - t * 0.6) * 2.5;
      const hShift = t * 40;
      ctx.fillStyle = `hsl(${(p.hue + hShift) % 360}, ${p.sat}%, ${p.light + (1 - t) * 15}%)`;
      ctx.beginPath();
      ctx.arc(sx, sy, dotSize * p.life, 0, Math.PI * 2);
      ctx.fill();

      // Scatter satellite dots
      if (Math.random() > 0.6) {
        const ox = (Math.random() - 0.5) * 8;
        const oy = (Math.random() - 0.5) * 8;
        ctx.beginPath();
        ctx.arc(sx + ox, sy + oy, dotSize * 0.3 * p.life, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawNebula(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 30;

    // Multiple overlapping soft circles
    for (let layer = 0; layer < 3; layer++) {
      const ox = (Math.random() - 0.5) * p.size * 0.3;
      const oy = (Math.random() - 0.5) * p.size * 0.3;
      const r = p.size * (0.6 + layer * 0.2);
      const grad = ctx.createRadialGradient(p.x + ox, p.y + oy, 0, p.x + ox, p.y + oy, r);
      const hShift = layer * 20;
      grad.addColorStop(0, `hsla(${(p.hue + hShift) % 360}, ${p.sat}%, ${Math.min(100, p.light + 20)}%, ${0.3 * p.life})`);
      grad.addColorStop(0.5, `hsla(${(p.hue + hShift) % 360}, ${p.sat}%, ${p.light}%, ${0.12 * p.life})`);
      grad.addColorStop(1, `hsla(${(p.hue + hShift) % 360}, ${p.sat}%, ${p.light}%, 0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x + ox, p.y + oy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Fine stipple inside nebula
    const stippleCount = 30;
    for (let i = 0; i < stippleCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const r2 = Math.random() * p.size * 0.8;
      ctx.fillStyle = `hsla(${(p.hue + Math.random() * 30) % 360}, ${p.sat}%, ${Math.min(100, p.light + 25)}%, ${0.6 * p.life})`;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r2, p.y + Math.sin(a) * r2, 0.8 + Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStarburst(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 50;
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
    grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, 98%, ${p.life})`);
    grad.addColorStop(0.15, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, ${p.life * 0.8})`);
    grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `hsla(0, 0%, 100%, ${p.life * 0.5})`;
    ctx.lineWidth = 1.2;
    const spikeLen = p.size * 1.8;
    for (let a = 0; a < 6; a++) {
      const angle = (a / 6) * Math.PI * 2 + this.time * 0.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + Math.cos(angle) * spikeLen, p.y + Math.sin(angle) * spikeLen);
      ctx.stroke();
    }
  }

  private drawRing(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawShard(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    const angle = Math.atan2(p.vy, p.vx);
    const len = p.size * 2;
    const w = p.size * 0.3;
    ctx.beginPath();
    ctx.moveTo(p.x + Math.cos(angle) * len, p.y + Math.sin(angle) * len);
    ctx.lineTo(p.x + Math.cos(angle + Math.PI / 2) * w, p.y + Math.sin(angle + Math.PI / 2) * w);
    ctx.lineTo(p.x - Math.cos(angle) * len * 0.3, p.y - Math.sin(angle) * len * 0.3);
    ctx.lineTo(p.x + Math.cos(angle - Math.PI / 2) * w, p.y + Math.sin(angle - Math.PI / 2) * w);
    ctx.closePath();
    ctx.fill();
  }

  private drawOrb(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.shadowColor = color;
    ctx.shadowBlur = p.size * 2.5;
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
    grad.addColorStop(0, `hsla(${p.hue}, ${p.sat}%, ${Math.min(100, p.light + 30)}%, 0.95)`);
    grad.addColorStop(0.3, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0.6)`);
    grad.addColorStop(0.7, `hsla(${(p.hue + 15) % 360}, ${p.sat}%, ${p.light - 10}%, 0.2)`);
    grad.addColorStop(1, `hsla(${p.hue}, ${p.sat}%, ${p.light}%, 0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();

    // Inner stipple ring for texture
    ctx.fillStyle = `hsla(${(p.hue + 20) % 360}, ${p.sat}%, ${Math.min(100, p.light + 20)}%, ${p.life * 0.5})`;
    const ringDots = 10;
    for (let i = 0; i < ringDots; i++) {
      const a = (i / ringDots) * Math.PI * 2;
      const r = p.size * 0.55;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSpore(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    // Outer ring of dots
    const outerDots = 8;
    for (let i = 0; i < outerDots; i++) {
      const a = (i / outerDots) * Math.PI * 2 + this.time * 0.3;
      const r = p.size * 0.7;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.size * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }
    // Inner ring
    const innerDots = 5;
    for (let i = 0; i < innerDots; i++) {
      const a = (i / innerDots) * Math.PI * 2 - this.time * 0.2;
      const r = p.size * 0.35;
      ctx.beginPath();
      ctx.arc(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r, p.size * 0.08, 0, Math.PI * 2);
      ctx.fill();
    }
    // Center
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawDot(ctx: CanvasRenderingContext2D, p: Particle, color: string) {
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }

  toDataURL(): string {
    // Render bloom on a final composite
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const oCtx = out.getContext('2d')!;
    oCtx.drawImage(this.accCanvas, 0, 0);

    const gw = this.glowCanvas.width;
    const gh = this.glowCanvas.height;
    this.glowCtx.clearRect(0, 0, gw, gh);
    this.glowCtx.drawImage(this.accCanvas, 0, 0, gw, gh);
    this.glowCtx.filter = 'blur(8px)';
    this.glowCtx.drawImage(this.glowCanvas, 0, 0);
    this.glowCtx.filter = 'none';

    oCtx.globalCompositeOperation = 'lighter';
    oCtx.globalAlpha = 0.35;
    oCtx.drawImage(this.glowCanvas, 0, 0, out.width, out.height);

    return out.toDataURL('image/png');
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
