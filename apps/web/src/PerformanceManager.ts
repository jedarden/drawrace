export class PerformanceManager {
  private frameTimes: number[] = [];
  private maxSamples = 60;
  private particleState: "full" | "reduced" | "none" = "full";
  private reducedGhosts = false;
  private simHz = 60;

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

    if (this.frameTimes.length < 30) return;

    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;

    if (avg > 33 && !this.reducedGhosts) {
      this.reducedGhosts = true;
    }
    if (avg > 25 && this.particleState === "full") {
      this.particleState = "reduced";
    }
    if (avg > 30 && this.particleState === "reduced") {
      this.particleState = "none";
    }
    if (avg > 30 && this.simHz === 60) {
      this.simHz = 30;
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
    return this.simHz;
  }

  get simDt(): number {
    return 1 / this.simHz;
  }

  reset(): void {
    this.frameTimes = [];
    this.particleState = "full";
    this.reducedGhosts = false;
    this.simHz = 60;
  }
}

let perfInstance: PerformanceManager | null = null;

export function getPerformanceManager(): PerformanceManager {
  if (!perfInstance) {
    perfInstance = new PerformanceManager();
  }
  return perfInstance;
}
