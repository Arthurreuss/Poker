// Audio-Ausgabe (WP-031): ein AudioContext für die ganze Seite, erst nach einer Nutzer-Geste erzeugt bzw.
// fortgesetzt (iOS/Safari spielen sonst nichts; nach Hintergrund kann iOS ihn „unterbrechen“ – jede weitere
// Geste setzt ihn fort). Ohne Web Audio (alte Browser, Tests) bleibt alles stumm.
import { playSound, type SoundName } from './synth';

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const GESTURES = ['pointerdown', 'touchend', 'keydown', 'click'] as const;

export class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.7;
  private installed = false;

  /** Lauscht auf Nutzer-Gesten, um den Ton freizuschalten (einmal pro Seite). */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    for (const type of GESTURES) window.addEventListener(type, this.unlock, { capture: true, passive: true });
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (this.master !== null && this.ctx !== null) this.master.gain.setValueAtTime(volume, this.ctx.currentTime);
  }

  /** Bei einer Nutzer-Geste: Kontext anlegen bzw. fortsetzen und einen stillen Puffer abspielen (iOS). */
  readonly unlock = (): void => {
    try {
      if (this.ctx === null) {
        const Ctor = audioContextCtor();
        if (Ctor === null) return;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      const ctx = this.ctx;
      if (ctx.state !== 'running') {
        void ctx.resume().catch(() => undefined);
        const silent = ctx.createBufferSource();
        silent.buffer = ctx.createBuffer(1, 1, 22050);
        silent.connect(ctx.destination);
        silent.start(0);
      }
    } catch {
      // Kein Ton möglich – Spiel läuft ohne.
    }
  };

  /** Probehören (Einstellungen): direkt aus einer Nutzer-Geste, wartet ggf. auf das Fortsetzen. */
  preview(name: SoundName): void {
    this.unlock();
    const ctx = this.ctx;
    if (ctx === null) return;
    if (ctx.state === 'running') {
      this.play(name);
      return;
    }
    void ctx
      .resume()
      .then(() => {
        this.play(name);
      })
      .catch(() => undefined);
  }

  /** Spielt einen Klang, `delayMs` später; ohne freigeschalteten Kontext nichts. */
  play(name: SoundName, delayMs = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (ctx?.state !== 'running' || master === null || this.volume <= 0) return;
    try {
      playSound(name, ctx, master, ctx.currentTime + Math.max(0, delayMs) / 1000);
    } catch {
      // ignorieren
    }
  }
}

/** Eine Instanz für die App. */
export const soundEngine = new SoundEngine();
