const CONFETTI_COLORS = ["#D94F3A", "#E8B64C", "#6FA8C9", "#7CA05C"];
const CONFETTI_COUNT = 40;
const DUST_POOL_MAX = 64;
const DUST_LIFE_MS = 400;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  type: "dust" | "confetti";
  rotation: number;
  rotationSpeed: number;
}

export class ParticleSystem {
  private particles: Particle[] = [];
  private reducedMotion: boolean;
  private particleLevel: "full" | "reduced" | "none" = "full";
  private dustSprite: HTMLCanvasElement | null = null;

  constructor() {
    this.reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.buildDustSprite();
  }

  private buildDustSprite(): void {
    const dc = document.createElement("canvas");
    dc.width = 16;
    dc.height = 16;
    const dctx = dc.getContext("2d")!;
    const grad = dctx.createRadialGradient(8, 8, 0, 8, 8, 8);
    grad.addColorStop(0, "rgba(214, 192, 154, 0.7)");
    grad.addColorStop(1, "rgba(214, 192, 154, 0)");
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, 16, 16);
    this.dustSprite = dc;
  }

  setParticleLevel(level: "full" | "reduced" | "none"): void {
    this.particleLevel = level;
  }

  emitDust(screenX: number, screenY: number, speed: number): void {
    if (this.reducedMotion || this.particleLevel === "none") return;
    const dustCount = this.particles.filter((p) => p.type === "dust").length;
    if (dustCount >= DUST_POOL_MAX) return;
    if (speed < 2.0) return;

    const intensity = Math.min(1, (speed - 2) / 6);
    const count = this.particleLevel === "reduced" ? 1 : Math.ceil(intensity * 2);
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: screenX + (Math.random() - 0.5) * 8 - 4,
        y: screenY + Math.random() * 4,
        vx: -speed * 3 * (0.5 + Math.random() * 0.5),
        vy: -(1 + Math.random() * 2),
        life: DUST_LIFE_MS,
        maxLife: DUST_LIFE_MS,
        size: 6 + Math.random() * 8,
        color: "#D6C09A",
        type: "dust",
        rotation: 0,
        rotationSpeed: 0,
      });
    }
  }

  emitConfetti(screenX: number, screenY: number): void {
    if (this.reducedMotion || this.particleLevel === "none") return;
    const count = this.particleLevel === "reduced" ? 20 : CONFETTI_COUNT;
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 80 + Math.random() * 200;
      this.particles.push({
        x: screenX,
        y: screenY - 20,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 150,
        life: 1200,
        maxLife: 1200,
        size: 4 + Math.random() * 4,
        color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
        type: "confetti",
        rotation: Math.random() * Math.PI * 2,
        rotationSpeed: (Math.random() - 0.5) * 10,
      });
    }
  }

  update(dtSec: number): void {
    const dtMs = dtSec * 1000;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dtMs;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      if (p.type === "confetti") {
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.vy += 800 * dtSec; // 800 px/s² gravity
        p.rotation += p.rotationSpeed * dtSec;
      } else {
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.vy += 20 * dtSec; // slight gravity on dust
      }
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;

      ctx.save();
      if (p.type === "confetti") {
        ctx.globalAlpha = t;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      } else {
        // Dust: pre-rendered sprite with easeOutQuad fade
        const alpha = t * t * 0.6;
        ctx.globalAlpha = alpha;
        const drawSize = p.size * (1.5 - t * 0.5);
        if (this.dustSprite) {
          ctx.drawImage(this.dustSprite, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
        }
      }
      ctx.restore();
    }
  }

  clear(): void {
    this.particles = [];
  }

  get count(): number {
    return this.particles.length;
  }
}
