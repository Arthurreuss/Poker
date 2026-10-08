// WebSocket-URL aus der aktuellen Seite ableiten (D-014): gleiche Origin, ws: bzw. wss:.

/** Nur die Teile von `Location`, die gebraucht werden (testbar ohne Browser). */
export type LocationLike = Pick<Location, 'protocol' | 'host'>;

/** z. B. `wsUrl('/ws')` → `wss://poker.example/ws` auf einer https-Seite. */
export function wsUrl(path: string, loc: LocationLike = window.location): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new Error(`wsUrl braucht einen relativen Pfad (D-014): ${path}`);
  }
  const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${loc.host}${path}`;
}
