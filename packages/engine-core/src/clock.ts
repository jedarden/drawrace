export interface Clock {
  nowMs(): number;
}

export class InjectedClock implements Clock {
  private simTimeMs: number;

  constructor(startMs = 0) {
    this.simTimeMs = startMs;
  }

  nowMs(): number {
    return this.simTimeMs;
  }

  advance(dtMs: number): void {
    this.simTimeMs += dtMs;
  }
}
