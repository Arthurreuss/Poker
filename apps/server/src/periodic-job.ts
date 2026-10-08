// Wiederkehrender Hintergrundjob (z. B. Löschfristen nach D-025): sofort ein Lauf, danach alle `intervalMs`.

export interface PeriodicJob {
  /** Erster Lauf (sofort beim Start) – Tests warten darauf. */
  readonly firstRun: Promise<void>;
  stop(): void;
}

export interface PeriodicJobOptions {
  intervalMs: number;
  run: () => Promise<void>;
  /** Fehler eines Laufs (z. B. DB kurz weg); der nächste Lauf versucht es erneut. */
  onError: (err: unknown) => void;
}

/**
 * Startet den Job. Läuft ein Durchgang noch (sehr kurzes Intervall in Tests), wird kein zweiter gestartet.
 * Der Timer hält den Prozess nicht am Leben (`unref`).
 */
export function startPeriodicJob({ intervalMs, run, onError }: PeriodicJobOptions): PeriodicJob {
  let running: Promise<void> | null = null;
  const tick = (): Promise<void> => {
    running ??= run()
      .catch(onError)
      .finally(() => {
        running = null;
      });
    return running;
  };
  const firstRun = tick();
  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return {
    firstRun,
    stop: () => {
      clearInterval(timer);
    },
  };
}
