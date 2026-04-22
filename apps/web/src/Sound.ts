export class SoundManager {
  private enabled: boolean;
  private context: AudioContext | null = null;
  private reducedMotion: boolean;

  // Motor hum state
  private motorOsc1: OscillatorNode | null = null;
  private motorOsc2: OscillatorNode | null = null;
  private motorGain: GainNode | null = null;
  private motorBaseFreq = 80;
  private motorRunning = false;

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
        const AudioContextClass = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (AudioContextClass) {
          this.context = new AudioContextClass();
        }
      } catch {
        return null;
      }
    }

    if (this.context && this.context.state === "suspended") {
      this.context.resume().catch(() => {});
    }

    return this.context;
  }

  private playTone(frequency: number, duration: number, volume: number = 0.3): void {
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

  playCountdown(): void {
    this.playTone(600, 0.15, 0.3);
  }

  playGo(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.2, 0.3), i * 50);
    });
  }

  playFinishLine(): void {
    const ctx = this.getContext();
    if (!ctx) return;

    [523.25, 659.25, 783.99].forEach((freq, i) => {
      setTimeout(() => this.playTone(freq, 0.4, 0.25), i * 30);
    });
  }

  playDnf(): void {
    const ctx = this.getContext();
    if (!ctx) return;

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

  startMotorHum(): void {
    if (this.motorRunning) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.3);
    gain.connect(ctx.destination);

    const osc1 = ctx.createOscillator();
    osc1.type = "sawtooth";
    osc1.frequency.value = this.motorBaseFreq;
    osc1.connect(gain);
    osc1.start();

    const osc2 = ctx.createOscillator();
    osc2.type = "triangle";
    osc2.frequency.value = this.motorBaseFreq * 1.5;
    osc2.connect(gain);
    osc2.start();

    this.motorOsc1 = osc1;
    this.motorOsc2 = osc2;
    this.motorGain = gain;
    this.motorRunning = true;
  }

  updateMotorSpeed(speedRatio: number): void {
    if (!this.motorRunning || !this.motorOsc1 || !this.motorOsc2) return;
    const clamped = Math.max(0, Math.min(1, speedRatio));
    // playbackRate-style modulation: 0.7 at idle, 1.5 at max
    const rate = 0.7 + clamped * 0.8;
    this.motorOsc1.frequency.value = this.motorBaseFreq * rate;
    this.motorOsc2.frequency.value = this.motorBaseFreq * 1.5 * rate;
  }

  stopMotorHum(): void {
    if (!this.motorRunning) return;

    const ctx = this.getContext();
    if (ctx && this.motorGain) {
      this.motorGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    }

    const osc1 = this.motorOsc1;
    const osc2 = this.motorOsc2;
    this.motorOsc1 = null;
    this.motorOsc2 = null;
    this.motorGain = null;
    this.motorRunning = false;

    if (osc1) {
      setTimeout(() => this.stopOscillatorSafely(osc1), 350);
    }
    if (osc2) {
      setTimeout(() => this.stopOscillatorSafely(osc2), 350);
    }
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.stopMotorHum();
    if (this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
  }

  private stopOscillatorSafely(osc: OscillatorNode | null): void {
    if (!osc) return;
    try {
      osc.stop();
    } catch {
      // Oscillator may already be stopped
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
