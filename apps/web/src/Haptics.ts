export class Haptics {
  private enabled: boolean;
  private reducedMotion: boolean;

  constructor() {
    this.enabled = false;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loadSettings();
  }

  private loadSettings(): void {
    const stored = localStorage.getItem("drawrace.haptics");
    this.enabled = stored === "true";
  }

  saveSettings(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem("drawrace.haptics", enabled.toString());
  }

  tap(duration: number): void {
    if (!this.enabled || this.reducedMotion) return;
    if (navigator.vibrate) {
      navigator.vibrate(duration);
    }
  }

  pattern(pattern: number[]): void {
    if (!this.enabled || this.reducedMotion) return;
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  strokeClosure(): void {
    this.tap(10);
  }

  raceStart(): void {
    this.tap(20);
  }

  finishLine(): void {
    this.pattern([40, 20, 40]);
  }

  dnf(): void {
    this.tap(80);
  }

  uiTap(): void {
    this.tap(5);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }
}

let hapticsInstance: Haptics | null = null;

export function getHaptics(): Haptics {
  if (!hapticsInstance) {
    hapticsInstance = new Haptics();
  }
  return hapticsInstance;
}
