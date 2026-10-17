import { useEffect, useRef, useState } from 'react';
import type { ClipLoader } from './clips';
import { loadLottie, type LottiePlayer } from './lottie';

export interface LottieClipProps {
  readonly clip: ClipLoader;
  readonly className: string;
  /** Verzögerung vor dem Start (gestaffelte Münzen). */
  readonly delayMs?: number;
}

/**
 * Spielt eine Lottie-Animation einmal ab und verschwindet danach (WP-040). Rein dekorativ, nimmt keine Eingaben an.
 * Schlägt das Laden fehl (offline, alter Browser), bleibt es still – die Feier funktioniert auch ohne.
 */
export function LottieClip({ clip, className, delayMs = 0 }: LottieClipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    let player: LottiePlayer | null = null;
    let cancelled = false;
    const finish = () => {
      player?.destroy();
      player = null;
      setDone(true);
    };
    const timer = setTimeout(() => {
      Promise.all([loadLottie(), clip()])
        .then(([create, data]) => {
          const container = ref.current;
          if (cancelled || container === null) return;
          // lottie-web verändert die Daten beim Aufbereiten; jede Wiedergabe bekommt eine eigene Kopie.
          player = create({ container, animationData: structuredClone(data.default) });
          player.addEventListener('complete', finish);
        })
        .catch(finish);
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      player?.destroy();
    };
  }, [clip, delayMs]);
  if (done) return null;
  return <div ref={ref} className={className} aria-hidden="true" data-testid="celebration-clip" />;
}
