// Daten einer Seite laden (WP-019): Abbruch beim Verlassen, optional neu laden, wenn die App wieder sichtbar wird.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client';

export type Resource<T> =
  | { status: 'loading' }
  | { status: 'error'; error: ApiError }
  /** Daten bleiben beim Neuladen stehen (kein Flackern). */
  | { status: 'ok'; data: T };

export interface ResourceOptions {
  /** Bei Fokus bzw. Sichtbarkeit der Seite neu laden (z. B. Rangliste nach Rundenende). */
  refetchOnFocus?: boolean;
}

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError(0, 'unknown', 'Unerwarteter Fehler');
}

/** `load` wird bei Änderung von `key` neu ausgeführt. */
export function useResource<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  { refetchOnFocus = false }: ResourceOptions = {},
): Resource<T> {
  const [state, setState] = useState<{ key: string; resource: Resource<T> }>({
    key,
    resource: { status: 'loading' },
  });
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(() => {
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    loadRef.current(c.signal).then(
      (data) => {
        if (!c.signal.aborted) setState({ key, resource: { status: 'ok', data } });
      },
      (err: unknown) => {
        if (c.signal.aborted) return;
        setState((prev) =>
          // Beim Neuladen im Hintergrund Daten behalten; Fehler nur zeigen, wenn es noch keine gibt.
          prev.key === key && prev.resource.status === 'ok'
            ? prev
            : { key, resource: { status: 'error', error: toApiError(err) } },
        );
      },
    );
  }, [key]);

  useEffect(() => {
    run();
    return () => controller.current?.abort();
  }, [run]);

  useEffect(() => {
    if (!refetchOnFocus) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };
    window.addEventListener('focus', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refetchOnFocus, run]);

  return state.key === key ? state.resource : { status: 'loading' };
}
