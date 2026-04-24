export class PerformanceManager {
  private frameTimes: number[] = [];
  private maxSamples = 60;
  private particleState: "full" | "reduced" | "none" = "full";
  private reducedGhosts = false;
  constructor() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.particleState = "none";
    }
  }

  recordFrame(dtMs: number): void {
    this.frameTimes.push(dtMs);
    if (this.frameTimes.length > this.maxSamples) {
      this.frameTimes.shift();
    }

    if (this.frameTimes.length < 20) return;

    // Use recent average (last 20 frames) for faster reaction
    const recent = this.frameTimes.slice(-20);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;

    // Thresholds calibrated for 30fps floor on Snapdragon 665 / Redmi 9:
    // 30fps = 33ms/frame. We degrade well before hitting that.
    if (avg > 28 && !this.reducedGhosts) {
      this.reducedGhosts = true;
    }
    if (avg > 22 && this.particleState === "full") {
      this.particleState = "reduced";
    }
    if (avg > 30 && this.particleState === "reduced") {
      this.particleState = "none";
    }
  }

  get particleLevel(): "full" | "reduced" | "none" {
    return this.particleState;
  }

  get maxGhosts(): number {
    if (this.reducedGhosts) return 1;
    return 3;
  }

  get simFrequency(): number {
    return 60;
  }

  get simDt(): number {
    return 1 / 60;
  }

  reset(): void {
    this.frameTimes = [];
    this.reducedGhosts = false;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.particleState = "none";
    } else {
      this.particleState = "full";
    }
  }
}

let perfInstance: PerformanceManager | null = null;

export function getPerformanceManager(): PerformanceManager {
  if (!perfInstance) {
    perfInstance = new PerformanceManager();
  }
  return perfInstance;
}
