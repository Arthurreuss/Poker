// Showdown vor dem Rundenende-Dialog (WP-031): Endet die Runde live (Status `running` → `finished`),
// bleibt erst der Tisch mit Board, aufgedeckten Karten und Gewinner sichtbar; der Dialog erscheint
// `ROUND_END_HOLD_MS` nach dem Ergebnis (bei einem Runout erst nach dem Aufdecken) oder sofort per Tipp.
// Wer einen schon beendeten Tisch öffnet (Reload, Reconnect), sieht den Dialog sofort.
import { useCallback, useEffect, useState } from 'react';
import type { TableStatus } from '@poker/engine/protocol';

export const ROUND_END_HOLD_MS = 5000;

export function useRoundEndHold(
  status: TableStatus | null,
  resultShown: boolean,
): { holding: boolean; skip: () => void } {
  const [prevStatus, setPrevStatus] = useState(status);
  const [holding, setHolding] = useState(false);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (prevStatus === 'running' && status === 'finished') setHolding(true);
    else if (status !== 'finished') setHolding(false);
  }
  useEffect(() => {
    if (!holding || !resultShown) return undefined;
    const id = setTimeout(() => {
      setHolding(false);
    }, ROUND_END_HOLD_MS);
    return () => {
      clearTimeout(id);
    };
  }, [holding, resultShown]);
  const skip = useCallback(() => {
    setHolding(false);
  }, []);
  return { holding, skip };
}
