// Showdown vor dem Rundenende-Dialog (WP-031, WP-040): Endet die Runde live (Status `running` → `finished`),
// bleibt erst der Tisch mit Board, aufgedeckten Karten, Gewinner und Feier der letzten Hand sichtbar
// (`ROUND_END_HAND_MS` nach dem Ergebnis, bei einem Runout erst nach dem Aufdecken), dann kommt der Sieger des
// Tisches (`ROUND_END_WINNER_MS`), dann der Dialog. Ein Tipp springt zum nächsten Schritt.
// Wer einen schon beendeten Tisch öffnet (Reload, Reconnect), sieht den Dialog sofort.
import { useCallback, useEffect, useState } from 'react';
import type { TableStatus } from '@poker/engine/protocol';

export const ROUND_END_HAND_MS = 3500;
export const ROUND_END_WINNER_MS = 6000;
export const ROUND_END_HOLD_MS = ROUND_END_HAND_MS + ROUND_END_WINNER_MS;

/** `hand`: letzte Hand am Tisch; `winner`: Sieger des Tisches; `null`: keine Pause (Dialog). */
export type RoundEndStage = 'hand' | 'winner' | null;

export function useRoundEndHold(
  status: TableStatus | null,
  resultShown: boolean,
): { holding: boolean; stage: RoundEndStage; skip: () => void } {
  const [prevStatus, setPrevStatus] = useState(status);
  const [stage, setStage] = useState<RoundEndStage>(null);
  if (status !== prevStatus) {
    setPrevStatus(status);
    if (prevStatus === 'running' && status === 'finished') setStage('hand');
    else if (status !== 'finished') setStage(null);
  }
  useEffect(() => {
    if (stage === null || !resultShown) return undefined;
    const id = setTimeout(
      () => {
        setStage((s) => (s === 'hand' ? 'winner' : null));
      },
      stage === 'hand' ? ROUND_END_HAND_MS : ROUND_END_WINNER_MS,
    );
    return () => {
      clearTimeout(id);
    };
  }, [stage, resultShown]);
  const skip = useCallback(() => {
    setStage((s) => (s === 'hand' ? 'winner' : null));
  }, []);
  return { holding: stage !== null, stage, skip };
}
