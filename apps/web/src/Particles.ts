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
  private staticDustActive = false;
  private staticDustAlpha = 0.6;
  private staticDustX = 0;
  private staticDustY = 0;
  private staticConfettiAlpha = 0;

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
    const dctx = dc.getContext("2d");
    if (!dctx) return;
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
    if (this.particleLevel === "none") return;

    if (this.reducedMotion) {
      // Static puff that fades over 200ms
      this.staticDustActive = true;
      this.staticDustAlpha = 0.6;
      this.staticDustX = screenX;
      this.staticDustY = screenY;
      return;
    }

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
    if (this.particleLevel === "none") return;

    if (this.reducedMotion) {
      // Static burst image that fades
      this.staticConfettiAlpha = 0.8;
      this.staticDustX = screenX;
      this.staticDustY = screenY;
      return;
    }

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

    // Fade static alternatives in reduced-motion
    if (this.reducedMotion) {
      if (this.staticDustActive) {
        this.staticDustAlpha -= dtMs / 200;
        if (this.staticDustAlpha <= 0) {
          this.staticDustActive = false;
          this.staticDustAlpha = 0;
        }
      }
      if (this.staticConfettiAlpha > 0) {
        this.staticConfettiAlpha -= dtMs / 1500;
        if (this.staticConfettiAlpha < 0) this.staticConfettiAlpha = 0;
      }
      return;
    }

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
        p.vy += 800 * dtSec;
        p.rotation += p.rotationSpeed * dtSec;
      } else {
        p.x += p.vx * dtSec;
        p.y += p.vy * dtSec;
        p.vy += 20 * dtSec;
      }
    }
  }

  renderDust(ctx: CanvasRenderingContext2D): void {
    if (this.reducedMotion) {
      if (this.staticDustActive && this.dustSprite) {
        ctx.save();
        ctx.globalAlpha = this.staticDustAlpha;
        ctx.drawImage(this.dustSprite, this.staticDustX - 12, this.staticDustY - 12, 24, 24);
        ctx.restore();
      }
      return;
    }

    for (const p of this.particles) {
      if (p.type !== "dust") continue;
      const t = p.life / p.maxLife;
      ctx.save();
      const alpha = t * t * 0.6;
      ctx.globalAlpha = alpha;
      const drawSize = p.size * (1.5 - t * 0.5);
      if (this.dustSprite) {
        ctx.drawImage(this.dustSprite, p.x - drawSize / 2, p.y - drawSize / 2, drawSize, drawSize);
      }
      ctx.restore();
    }
  }

  renderConfetti(ctx: CanvasRenderingContext2D): void {
    if (this.reducedMotion) {
      if (this.staticConfettiAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = this.staticConfettiAlpha;
        // Static burst: simple colored circles
        const colors = CONFETTI_COLORS;
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const r = 30;
          ctx.fillStyle = colors[i % colors.length];
          ctx.beginPath();
          ctx.arc(
            this.staticDustX + Math.cos(angle) * r,
            this.staticDustY + Math.sin(angle) * r,
            5, 0, Math.PI * 2
          );
          ctx.fill();
        }
        ctx.restore();
      }
      return;
    }

    for (const p of this.particles) {
      if (p.type !== "confetti") continue;
      const t = p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = t;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
      ctx.restore();
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    this.renderDust(ctx);
    this.renderConfetti(ctx);
  }

  clear(): void {
    this.particles = [];
  }

  get count(): number {
    return this.particles.length;
  }
}
