// Injizierbare Uhr für den Game-Server (WP-011): Zeit für Blind-Level und Pausen nach einer Hand,
// später Zug-Timer und Zeitbank (WP-012). Tests nutzen `ManualClock` oder `systemClock` mit Pause 0.

/** Hebt einen geplanten Aufruf auf (mehrfacher Aufruf ist harmlos). */
export type Cancel = () => void;

export interface Clock {
  /** Millisekunden seit Epoche. */
  now(): number;
  /** Ruft `fn` nach `ms` Millisekunden auf. */
  schedule(ms: number, fn: () => void): Cancel;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  schedule(ms, fn) {
    const timer = setTimeout(fn, ms);
    // Geplante Spielschritte halten den Prozess nicht am Leben (der HTTP-Server tut das).
    timer.unref();
    return () => {
      clearTimeout(timer);
    };
  },
};

/** Von Hand gesteuerte Uhr für Tests (und Zug-Timer-Tests in WP-012). */
export class ManualClock implements Clock {
  private pending: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 0;

  constructor(private current = 0) {}

  now(): number {
    return this.current;
  }

  schedule(ms: number, fn: () => void): Cancel {
    const id = this.nextId++;
    this.pending.push({ at: this.current + Math.max(0, ms), fn, id });
    return () => {
      this.pending = this.pending.filter((p) => p.id !== id);
    };
  }

  /** Stellt die Uhr vor und führt alle fälligen Aufrufe in zeitlicher Reihenfolge aus. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.pending.filter((p) => p.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.pending = this.pending.filter((p) => p.id !== due.id);
      this.current = due.at;
      due.fn();
    }
    this.current = target;
  }

  /** Anzahl geplanter, noch nicht ausgeführter Aufrufe. */
  get pendingCount(): number {
    return this.pending.length;
  }
}
