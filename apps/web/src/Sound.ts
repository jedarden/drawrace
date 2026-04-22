export class SoundManager {
  private enabled: boolean;
  private context: AudioContext | null = null;
  private reducedMotion: boolean;

  constructor() {
    this.enabled = false;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.loadSettings();
  }

  private loadSettings(): void {
    const stored = localStorage.getItem("drawrace.sound");
    this.enabled = stored === "true";
  }

  saveSettings(enabled: boolean): void {
    this.enabled = enabled;
    localStorage.setItem("drawrace.sound", enabled.toString());
  }

  private getContext(): AudioContext | null {
    if (this.reducedMotion) return null;
    if (!this.enabled) return null;

    if (!this.context) {
      try {
        this.context = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch {
        return null;
      }
    }

    if (this.context.state === "suspended") {
      this.context.resume().catch(() => {});
    }

    return this.context;
  }

  playTone(frequency: number, duration: number, volume: number = 0.3): void {
    const ctx = this.getContext();
    if (!ctx) return;

    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = frequency;
    oscillator.type = "sine";

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + duration);
  }

  playTick(): void {
    this.playTone(800, 0.05, 0.2);
  }

  playCountdown(): void {
    this.playTone(600, 0.15, 0.3);
  }

  playGo(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    // Play a rising arpeggio
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.2, 0.3), i * 50);
    });
  }

  playFinishLine(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    // Victory chord
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.4, 0.25), i * 30);
    });
  }

  playDnf(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    // Descending tone
    this.playTone(400, 0.3, 0.3);
    setTimeout(() => this.playTone(300, 0.3, 0.3), 150);
  }

  playStrokeClosure(): void {
    this.playTone(1200, 0.08, 0.15);
  }

  playUiTap(): void {
    this.playTone(1000, 0.04, 0.1);
  }

  playClear(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    // Swishing sound using noise
    const bufferSize = ctx.sampleRate * 0.1;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 1000;

    const gainNode = ctx.createGain();
    gainNode.gain.value = 0.2;

    noise.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(ctx.destination);

    noise.start();
  }

  playMotorHum(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    // Low frequency drone for motor
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.frequency.value = 80;
    oscillator.type = "sawtooth";

    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.1, ctx.currentTime + 0.1);
    gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.2);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.2);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
  }
}

let soundInstance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!soundInstance) {
    soundInstance = new SoundManager();
  }
  return soundInstance;
}
