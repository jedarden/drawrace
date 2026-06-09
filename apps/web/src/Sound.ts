/**
 * SoundManager — Audio file-based playback (per plan §Graphics 14)
 *
 * Replaces Web Audio synthesis with authored audio files.
 * Format: Opus-in-.webm primary, AAC-in-.mp4 fallback.
 * Total audio budget: ≤ 120KB across all sounds.
 */

interface SoundAsset {
  name: string;
  paths: string[]; // [primary, fallback]
}

const SOUND_ASSETS: Record<string, SoundAsset> = {
  engineRumble: { name: 'Engine Rumble', paths: ['/assets/audio/engine_rumble.webm', '/assets/audio/engine_rumble.mp4'] },
  bounce: { name: 'Bounce', paths: ['/assets/audio/bounce.webm', '/assets/audio/bounce.mp4'] },
  whoosh: { name: 'Whoosh', paths: ['/assets/audio/whoosh.webm', '/assets/audio/whoosh.mp4'] },
  finishFanfare: { name: 'Finish Fanfare', paths: ['/assets/audio/finish_fanfare.webm', '/assets/audio/finish_fanfare.mp4'] },
  countdown: { name: 'Countdown', paths: ['/assets/audio/countdown.webm', '/assets/audio/countdown.mp4'] },
  go: { name: 'Go', paths: ['/assets/audio/go.webm', '/assets/audio/go.mp4'] },
  uiTap: { name: 'UI Tap', paths: ['/assets/audio/ui_tap.webm', '/assets/audio/ui_tap.mp4'] },
  clear: { name: 'Clear', paths: ['/assets/audio/clear.webm', '/assets/audio/clear.mp4'] },
  dnf: { name: 'DNF', paths: ['/assets/audio/dnf.webm', '/assets/audio/dnf.mp4'] },
  strokeClosure: { name: 'Stroke Closure', paths: ['/assets/audio/stroke_closure.webm', '/assets/audio/stroke_closure.mp4'] },
};

type SoundKey = keyof typeof SOUND_ASSETS;

export class SoundManager {
  private enabled: boolean;
  private context: AudioContext | null = null;
  private reducedMotion: boolean;

  // Audio buffers cache
  private buffers: Map<SoundKey, AudioBuffer> = new Map();

  // Engine rumble playback (looped, with playback rate modulation)
  private engineSource: AudioBufferSourceNode | null = null;
  private engineGain: GainNode | null = null;
  private engineBasePlaybackRate = 1.0;
  private engineRunning = false;

  // Track which sounds are loading to avoid duplicate fetches
  private loadingPromises: Map<SoundKey, Promise<AudioBuffer | null>> = new Map();

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

    // Lazy-load sounds on first enable (within user gesture context)
    if (enabled) {
      this.getContext(); // Initialize context
      this.preloadSounds();
    }
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

  /**
   * Load a sound asset with fallback support.
   * Tries .webm first, falls back to .mp4.
   */
  private async loadSound(key: SoundKey): Promise<AudioBuffer | null> {
    // Return cached buffer if available
    if (this.buffers.has(key)) {
      return this.buffers.get(key)!;
    }

    // Return existing loading promise if in flight
    if (this.loadingPromises.has(key)) {
      return this.loadingPromises.get(key)!;
    }

    const ctx = this.getContext();
    if (!ctx) return null;

    const asset = SOUND_ASSETS[key];
    const loadPromise = this.loadSoundWithFallback(ctx, asset.paths);

    this.loadingPromises.set(key, loadPromise);

    try {
      const buffer = await loadPromise;
      if (buffer) {
        this.buffers.set(key, buffer);
      }
      this.loadingPromises.delete(key);
      return buffer;
    } catch {
      this.loadingPromises.delete(key);
      return null;
    }
  }

  private async loadSoundWithFallback(ctx: AudioContext, paths: string[]): Promise<AudioBuffer | null> {
    for (const path of paths) {
      try {
        const response = await fetch(path);
        if (!response.ok) continue;

        const arrayBuffer = await response.arrayBuffer();
        return await ctx.decodeAudioData(arrayBuffer);
      } catch {
        // Try next fallback
        continue;
      }
    }
    return null;
  }

  /**
   * Preload all sounds when sound is enabled.
   * Runs asynchronously without blocking.
   */
  private preloadSounds(): void {
    const keys: SoundKey[] = Object.keys(SOUND_ASSETS) as SoundKey[];
    keys.forEach(key => {
      this.loadSound(key).catch(() => {
        // Silently fail — sound is optional
      });
    });
  }

  /**
   * Play a one-shot sound.
   */
  private async playOneShot(key: SoundKey, volume: number = 1.0): Promise<void> {
    const ctx = this.getContext();
    if (!ctx) return;

    const buffer = await this.loadSound(key);
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gainNode = ctx.createGain();
    gainNode.gain.value = volume;

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start();
  }

  playCountdown(): void {
    this.playOneShot('countdown', 0.3);
  }

  playGo(): void {
    // Play the go tone
    this.playOneShot('go', 0.3);
  }

  playFinishLine(): void {
    this.playOneShot('finishFanfare', 0.25);
  }

  playDnf(): void {
    this.playOneShot('dnf', 0.3);
  }

  playStrokeClosure(): void {
    this.playOneShot('strokeClosure', 0.15);
  }

  playBounce(): void {
    // Slight volume variation for natural feel
    const volume = 0.15 + Math.random() * 0.1;
    this.playOneShot('bounce', volume);
  }

  playWhoosh(): void {
    this.playOneShot('whoosh', 0.15);
  }

  playUiTap(): void {
    this.playOneShot('uiTap', 0.1);
  }

  playClear(): void {
    this.playOneShot('clear', 0.2);
  }

  /**
   * Start the engine rumble loop.
   * Playback rate is modulated by wheel speed.
   */
  async startMotorHum(): Promise<void> {
    if (this.engineRunning) return;
    const ctx = this.getContext();
    if (!ctx) return;

    const buffer = await this.loadSound('engineRumble');
    if (!buffer) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.08, ctx.currentTime + 0.3);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start();
    this.engineSource = source;
    this.engineGain = gainNode;
    this.engineBasePlaybackRate = 1.0;
    this.engineRunning = true;
  }

  /**
   * Update engine rumble playback rate based on motor speed.
   * speedRatio: 0.0 (idle) to 1.0 (max speed)
   */
  updateMotorSpeed(speedRatio: number): void {
    if (!this.engineRunning || !this.engineSource) return;
    const clamped = Math.max(0, Math.min(1, speedRatio));
    // Playback rate modulation: 0.7 at idle, 1.5 at max
    const rate = 0.7 + clamped * 0.8;
    this.engineSource.playbackRate.value = rate;
  }

  stopMotorHum(): void {
    if (!this.engineRunning) return;

    const ctx = this.getContext();
    if (ctx && this.engineGain) {
      this.engineGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
    }

    const source = this.engineSource;
    this.engineSource = null;
    this.engineGain = null;
    this.engineRunning = false;

    if (source) {
      setTimeout(() => {
        try {
          source.stop();
        } catch {
          // Already stopped
        }
      }, 350);
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
    this.buffers.clear();
    this.loadingPromises.clear();
  }
}

let soundInstance: SoundManager | null = null;

export function getSoundManager(): SoundManager {
  if (!soundInstance) {
    soundInstance = new SoundManager();
  }
  return soundInstance;
}
