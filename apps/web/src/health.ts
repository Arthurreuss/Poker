export type HealthState = { kind: 'loading' } | { kind: 'ok' } | { kind: 'error'; detail: string };

interface HealthBody {
  status?: unknown;
  db?: unknown;
}

/** Fragt den Server über die relative URL ab (eine Origin, D-014). */
export async function fetchHealth(fetchFn: typeof fetch = fetch): Promise<HealthState> {
  try {
    const res = await fetchFn('/api/health');
    const body = (await res.json()) as HealthBody;
    if (res.ok && body.status === 'ok' && body.db === 'ok') {
      return { kind: 'ok' };
    }
    return { kind: 'error', detail: `HTTP ${String(res.status)}, db: ${String(body.db)}` };
  } catch (err) {
    return { kind: 'error', detail: err instanceof Error ? err.message : String(err) };
  }
}

export function healthLabel(state: HealthState): string {
  switch (state.kind) {
    case 'loading':
      return 'Server: wird geprüft …';
    case 'ok':
      return 'Server: ok, Datenbank: ok';
    case 'error':
      return `Server: Fehler (${state.detail})`;
  }
}

export function appTitle(mode: string): string {
  return mode === 'production' ? 'Poker' : `Poker – ${mode === 'development' ? 'dev' : mode}`;
}
