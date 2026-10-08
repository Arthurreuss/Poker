// Tisch-Sounds (WP-031), zur Laufzeit per Web Audio API erzeugt: keine Audiodateien, keine fremden Assets,
// keine Lizenzfragen (siehe apps/web/ASSETS.md). Jede Funktion plant einen kurzen Klang ab Zeitpunkt `t`
// auf `out` (Master-Gain mit der Lautstärke aus den Einstellungen).

export type SoundName = 'card' | 'flip' | 'chips' | 'check' | 'fold' | 'collect' | 'turn' | 'win';

export const SOUND_NAMES: readonly SoundName[] = ['card', 'flip', 'chips', 'check', 'fold', 'collect', 'turn', 'win'];

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** Eine Sekunde weißes Rauschen pro Kontext (deterministisch genug; Math.random ist hier unkritisch). */
function noise(ctx: BaseAudioContext): AudioBuffer {
  let buffer = noiseBuffers.get(ctx);
  if (buffer === undefined) {
    buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buffer);
  }
  return buffer;
}

/** Rauschstoß durch einen Filter mit schneller Hüllkurve. */
function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  opts: { duration: number; gain: number; type: BiquadFilterType; freq: number; q?: number; freqEnd?: number },
): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.type;
  filter.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.duration);
  filter.Q.value = opts.q ?? 1;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(opts.gain, t + 0.004);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
  src.connect(filter).connect(env).connect(out);
  src.start(t, Math.random() * 0.5);
  src.stop(t + opts.duration + 0.02);
}

/** Kurzer Ton mit Hüllkurve, optional mit Tonhöhen-Abfall. */
function tone(
  ctx: BaseAudioContext,
  out: AudioNode,
  t: number,
  opts: { freq: number; duration: number; gain: number; type?: OscillatorType; freqEnd?: number; attack?: number },
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type ?? 'sine';
  osc.frequency.setValueAtTime(opts.freq, t);
  if (opts.freqEnd !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.duration);
  const env = ctx.createGain();
  const attack = opts.attack ?? 0.005;
  env.gain.setValueAtTime(0.0001, t);
  env.gain.exponentialRampToValueAtTime(opts.gain, t + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, t + opts.duration);
  osc.connect(env).connect(out);
  osc.start(t);
  osc.stop(t + opts.duration + 0.02);
}

/** Chip-Klicken: zwei, drei kurze, helle Töne plus Klick. */
function chipClicks(ctx: BaseAudioContext, out: AudioNode, t: number, count: number, gain: number): void {
  for (let i = 0; i < count; i++) {
    const at = t + i * (0.035 + Math.random() * 0.02);
    tone(ctx, out, at, { freq: 3200 + Math.random() * 900, duration: 0.05, gain: gain * 0.5, type: 'triangle' });
    tone(ctx, out, at, { freq: 5200 + Math.random() * 700, duration: 0.03, gain: gain * 0.25 });
    burst(ctx, out, at, { duration: 0.025, gain: gain * 0.4, type: 'highpass', freq: 4000 });
  }
}

export function playSound(name: SoundName, ctx: BaseAudioContext, out: AudioNode, t: number): void {
  switch (name) {
    case 'card':
      // Karte gleitet über den Filz
      burst(ctx, out, t, { duration: 0.09, gain: 0.5, type: 'bandpass', freq: 2600, freqEnd: 1400, q: 0.8 });
      break;
    case 'flip':
      // Karte wird umgedreht: kurzer, heller Schnapp
      burst(ctx, out, t, { duration: 0.05, gain: 0.55, type: 'bandpass', freq: 3800, q: 1.2 });
      burst(ctx, out, t + 0.03, { duration: 0.06, gain: 0.3, type: 'lowpass', freq: 1800 });
      break;
    case 'chips':
      chipClicks(ctx, out, t, 3, 0.6);
      break;
    case 'collect':
      chipClicks(ctx, out, t, 5, 0.45);
      break;
    case 'check':
      // zweimal mit dem Knöchel auf den Holzrand klopfen. Tiefe Anteile (< 300 Hz) geben Handy-Lautsprecher
      // kaum wieder, deshalb trägt der Holzkörper (400–700 Hz) plus ein heller Anschlag den Klang.
      for (const [dt, gain] of [
        [0, 1],
        [0.14, 0.8],
      ] as const) {
        const at = t + dt;
        burst(ctx, out, at, { duration: 0.012, gain: 0.5 * gain, type: 'highpass', freq: 2500 });
        burst(ctx, out, at, { duration: 0.08, gain: 0.9 * gain, type: 'bandpass', freq: 620, freqEnd: 480, q: 5 });
        tone(ctx, out, at, {
          freq: 430,
          freqEnd: 330,
          duration: 0.07,
          gain: 0.55 * gain,
          type: 'triangle',
          attack: 0.002,
        });
        tone(ctx, out, at, { freq: 160, freqEnd: 90, duration: 0.06, gain: 0.4 * gain });
      }
      break;
    case 'fold':
      burst(ctx, out, t, { duration: 0.18, gain: 0.35, type: 'lowpass', freq: 2400, freqEnd: 500 });
      break;
    case 'turn':
      // „Du bist dran“: zweistimmiger Glockenton
      tone(ctx, out, t, { freq: 880, duration: 0.35, gain: 0.35, type: 'triangle' });
      tone(ctx, out, t + 0.14, { freq: 1318.5, duration: 0.45, gain: 0.3, type: 'triangle' });
      break;
    case 'win':
      // aufsteigender Dreiklang + Chips
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(ctx, out, t + i * 0.09, { freq, duration: 0.4, gain: 0.28, type: 'triangle' });
      });
      chipClicks(ctx, out, t + 0.3, 4, 0.4);
      break;
  }
}
