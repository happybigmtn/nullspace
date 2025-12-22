import { createCrowdNoise } from './proceduralSounds';

export type AmbienceProfile = 'speakeasy' | 'vegas' | 'vip' | 'off';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface AmbienceNodes {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

export default class AudioManager {
  private static instance: AudioManager | null = null;
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private volume = 0.8;
  private muted = false;
  private ambienceProfile: AmbienceProfile = 'off';
  private ambienceNodes: AmbienceNodes | null = null;

  static getInstance(): AudioManager {
    if (!AudioManager.instance) {
      AudioManager.instance = new AudioManager();
    }
    return AudioManager.instance;
  }

  getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return null;
    if (!this.ctx) {
      this.ctx = new Ctx();
    }
    return this.ctx;
  }

  getMasterGain(): GainNode | null {
    const ctx = this.getContext();
    if (!ctx) return null;
    if (this.masterGain) return this.masterGain;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : this.volume;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3.5;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.18;

    this.masterGain.connect(this.compressor);
    this.compressor.connect(ctx.destination);

    return this.masterGain;
  }

  setVolume(volume: number): void {
    this.volume = clamp(volume, 0, 1.5);
    if (this.masterGain && !this.muted) {
      this.masterGain.gain.value = this.volume;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = muted ? 0 : this.volume;
    }
  }

  async unlock(): Promise<boolean> {
    const ctx = this.getContext();
    if (!ctx) return false;
    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      return ctx.state === 'running';
    } catch {
      return false;
    }
  }

  setAmbienceProfile(profile: AmbienceProfile): void {
    if (this.ambienceProfile === profile) return;
    this.stopAmbience();
    this.ambienceProfile = profile;

    if (profile === 'off') return;

    const ctx = this.getContext();
    const master = this.getMasterGain();
    if (!ctx || !master) return;

    const density = profile === 'vegas' ? 0.8 : profile === 'vip' ? 0.18 : 0.3;
    const ambience = createCrowdNoise(ctx, density);
    ambience.gain.gain.value *= profile === 'vip' ? 0.7 : 1;

    ambience.gain.connect(master);
    ambience.source.start();

    this.ambienceNodes = ambience;
  }

  dispose(): void {
    this.stopAmbience();
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    if (this.compressor) {
      this.compressor.disconnect();
      this.compressor = null;
    }
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
  }

  private stopAmbience(): void {
    if (!this.ambienceNodes) return;
    try {
      this.ambienceNodes.source.stop();
    } catch {
      // no-op
    }
    this.ambienceNodes.source.disconnect();
    this.ambienceNodes.gain.disconnect();
    this.ambienceNodes = null;
  }
}
