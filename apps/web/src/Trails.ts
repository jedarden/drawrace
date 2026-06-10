/**
 * Wheel trail particle system
 * Renders cosmetic trails behind wheels based on unlocked progression
 */

import type { TrailConfig } from "./progression.js";

export interface TrailParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number; // frames
  maxLife: number;
  size: number;
  color: string;
  hue?: number; // For rainbow trails
}

export class TrailSystem {
  private particles: TrailParticle[] = [];
  private reducedMotion: boolean;
  private rng: () => number;

  // Trail particle pool limits
  private static readonly MAX_PARTICLES = 128;
  private static readonly EMIT_COOLDOWN_FRAMES = 3; // Emit every N frames

  private emitCooldown = 0;
  private rainbowHue = 0; // Rotating hue for rainbow trails

  constructor() {
    this.reducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    // Simple deterministic PRNG for particle jitter
    let seed = 12345;
    this.rng = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
  }

  /**
   * Emit trail particles from a wheel position
   * @param screenX Wheel position in screen coordinates
   * @param screenY Wheel position in screen coordinates
   * @param wheelSpeed Current wheel speed (m/s)
   * @param trailConfig The trail configuration to use
   */
  emitTrail(
    screenX: number,
    screenY: number,
    wheelSpeed: number,
    trailConfig: TrailConfig
  ): void {
    // Don't emit if trail is disabled or in reduced motion
    if (trailConfig.id === "none" || this.reducedMotion || wheelSpeed < 1.0) {
      return;
    }

    // Rate limit emission
    if (this.emitCooldown > 0) {
      this.emitCooldown--;
      return;
    }
    this.emitCooldown = TrailSystem.EMIT_COOLDOWN_FRAMES;

    // Check particle pool limit
    if (this.particles.length >= TrailSystem.MAX_PARTICLES) {
      return;
    }

    // Emit particles based on trail config
    const count = trailConfig.particleCount;
    for (let i = 0; i < count; i++) {
      // Jitter position
      const offsetX = (this.rng() - 0.5) * trailConfig.spread * 10;
      const offsetY = (this.rng() - 0.5) * trailConfig.spread * 6;

      // Velocity: backward relative to wheel motion, with some drift
      const baseSpeed = wheelSpeed * 2;
      const vx = -baseSpeed + (this.rng() - 0.5) * trailConfig.drift * 20;
      const vy = -(1 + this.rng() * 2) + (this.rng() - 0.5) * trailConfig.drift * 10;

      let color = trailConfig.color;
      let hue: number | undefined;

      // Special handling for rainbow trail
      if (trailConfig.id === "rainbow") {
        hue = this.rainbowHue;
        color = `hsla(${hue}, 80%, 60%, 0.6)`;
      }

      this.particles.push({
        x: screenX + offsetX,
        y: screenY + offsetY,
        vx,
        vy,
        life: trailConfig.particleLifetime,
        maxLife: trailConfig.particleLifetime,
        size: 3 + this.rng() * 4,
        color,
        hue,
      });
    }
  }

  /**
   * Update all trail particles
   */
  update(): void {
    // Rotate rainbow hue
    this.rainbowHue = (this.rainbowHue + 2) % 360;

    // Update particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life--;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Apply physics
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05; // Slight gravity

      // Update rainbow color if hue is set
      if (p.hue !== undefined) {
        p.color = `hsla(${p.hue}, 80%, 60%, ${0.6 * (p.life / p.maxLife)})`;
      }
    }
  }

  /**
   * Render all trail particles
   */
  render(ctx: CanvasRenderingContext2D): void {
    for (const p of this.particles) {
      const t = p.life / p.maxLife;
      const alpha = t * 0.6;

      ctx.save();
      ctx.globalAlpha = alpha;

      // Parse color and apply fade
      if (p.color.startsWith("hsla")) {
        // For hsla, the alpha is already in the color string
        ctx.fillStyle = p.color;
      } else if (p.color.startsWith("rgba")) {
        // Update rgba alpha
        const baseAlpha = parseFloat(p.color.match(/[\d.]+\)$/)?.[0] || "0.6");
        ctx.fillStyle = p.color.replace(/[\d.]+\)$$/, `${alpha * baseAlpha})`);
      } else {
        ctx.fillStyle = p.color;
      }

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /**
   * Clear all particles
   */
  clear(): void {
    this.particles = [];
  }

  /**
   * Get current particle count
   */
  get count(): number {
    return this.particles.length;
  }
}
