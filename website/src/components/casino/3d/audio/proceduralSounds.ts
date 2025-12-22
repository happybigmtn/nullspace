export type ImpactMaterial = 'plastic' | 'metal' | 'felt' | 'rubber' | 'wood';

type LoopNode = { source: AudioBufferSourceNode; gain: GainNode };

const noiseCache = new Map<string, AudioBuffer>();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function getNoiseBuffer(ctx: AudioContext, duration = 0.35): AudioBuffer {
  const key = `${ctx.sampleRate}:${duration}`;
  const cached = noiseCache.get(key);
  if (cached) return cached;

  const frameCount = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, frameCount, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frameCount; i += 1) {
    const fade = 1 - i / frameCount;
    data[i] = (Math.random() * 2 - 1) * fade;
  }

  noiseCache.set(key, buffer);
  return buffer;
}

function createNoiseSource(ctx: AudioContext, duration: number, loop = false): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx, duration);
  source.loop = loop;
  return source;
}

function materialFilterSettings(material: ImpactMaterial) {
  switch (material) {
    case 'metal':
      return { bandpass: 3200, lowpass: 7200, decay: 0.08 };
    case 'rubber':
      return { bandpass: 900, lowpass: 3200, decay: 0.14 };
    case 'wood':
      return { bandpass: 1400, lowpass: 4800, decay: 0.12 };
    case 'felt':
      return { bandpass: 700, lowpass: 2200, decay: 0.1 };
    case 'plastic':
    default:
      return { bandpass: 1800, lowpass: 5200, decay: 0.1 };
  }
}

export function createDiceImpact(
  ctx: AudioContext,
  params: { velocity: number; material?: ImpactMaterial; volume?: number }
): AudioNode {
  const output = ctx.createGain();
  const now = ctx.currentTime;
  const intensity = clamp(params.velocity / 9, 0.15, 1);
  const volume = clamp(params.volume ?? 1, 0, 1);
  const material = params.material ?? 'plastic';
  const filterSettings = materialFilterSettings(material);

  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(0.35 * intensity * volume, now + 0.01);
  output.gain.exponentialRampToValueAtTime(0.0001, now + filterSettings.decay);

  const noise = createNoiseSource(ctx, 0.25);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(filterSettings.bandpass, now);
  bandpass.Q.setValueAtTime(1.1, now);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(filterSettings.lowpass, now);

  const thump = ctx.createOscillator();
  const thumpGain = ctx.createGain();
  thump.type = 'triangle';
  thump.frequency.setValueAtTime(180 + intensity * 40, now);
  thumpGain.gain.setValueAtTime(0.0001, now);
  thumpGain.gain.exponentialRampToValueAtTime(0.08 * intensity * volume, now + 0.008);
  thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

  noise.connect(bandpass);
  bandpass.connect(lowpass);
  lowpass.connect(output);

  thump.connect(thumpGain);
  thumpGain.connect(output);

  noise.start(now);
  noise.stop(now + 0.2);
  thump.start(now);
  thump.stop(now + 0.16);

  return output;
}

export function createBallBounce(
  ctx: AudioContext,
  velocity: number,
  surface: 'metal' | 'felt'
): AudioNode {
  const output = ctx.createGain();
  const now = ctx.currentTime;
  const intensity = clamp(velocity / 8, 0.1, 1);

  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(0.2 * intensity, now + 0.01);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);

  const noise = createNoiseSource(ctx, 0.2);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.setValueAtTime(surface === 'metal' ? 2600 : 1400, now);
  bandpass.Q.setValueAtTime(1.6, now);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.setValueAtTime(surface === 'metal' ? 6400 : 3200, now);

  noise.connect(bandpass);
  bandpass.connect(lowpass);
  lowpass.connect(output);

  noise.start(now);
  noise.stop(now + 0.18);

  return output;
}

export function createCardSnap(ctx: AudioContext): AudioNode {
  const output = ctx.createGain();
  const now = ctx.currentTime;

  output.gain.setValueAtTime(0.0001, now);
  output.gain.exponentialRampToValueAtTime(0.18, now + 0.006);
  output.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

  const noise = createNoiseSource(ctx, 0.15);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.setValueAtTime(1400, now);

  noise.connect(highpass);
  highpass.connect(output);

  noise.start(now);
  noise.stop(now + 0.12);

  return output;
}

export function createRollingLoop(ctx: AudioContext, baseFreq: number): LoopNode {
  const noise = createNoiseSource(ctx, 1.2, true);
  const bandpass = ctx.createBiquadFilter();
  bandpass.type = 'bandpass';
  bandpass.frequency.value = baseFreq;
  bandpass.Q.value = 0.8;

  const gain = ctx.createGain();
  gain.gain.value = 0.06;

  noise.connect(bandpass);
  bandpass.connect(gain);

  return { source: noise, gain };
}

export function createSpinningLoop(ctx: AudioContext): LoopNode {
  const noise = createNoiseSource(ctx, 1.0, true);
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 800;

  const gain = ctx.createGain();
  gain.gain.value = 0.04;

  noise.connect(highpass);
  highpass.connect(gain);

  return { source: noise, gain };
}

export function createCrowdNoise(ctx: AudioContext, density: number): LoopNode {
  const noise = createNoiseSource(ctx, 2.5, true);
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 1000 + density * 1200;

  const gain = ctx.createGain();
  gain.gain.value = 0.02 + density * 0.08;

  noise.connect(lowpass);
  lowpass.connect(gain);

  return { source: noise, gain };
}
