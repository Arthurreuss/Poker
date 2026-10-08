// Konfiguration ausschließlich über Umgebungsvariablen – keine Hostnamen/Ports im Code (D-014).

export interface ServerConfig {
  /** Adresse, an die der HTTP-Server bindet (im Container `0.0.0.0`). */
  host: string;
  port: number;
  databaseUrl: string;
  /** Öffentliche Origin der App, z. B. für den Origin-Check beim WebSocket-Upgrade (D-014). */
  publicOrigin: string;
  nodeEnv: string;
  /** Proxy-Header (`X-Forwarded-For`/`-Proto`) nur in prod vertrauen (D-014). */
  trustProxy: boolean;
}

export type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Umgebungsvariable ${name} fehlt`);
  }
  return value;
}

export function loadConfig(env: Env): ServerConfig {
  const rawPort = required(env, 'PORT');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Umgebungsvariable PORT ist ungültig: ${rawPort}`);
  }
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  return {
    // Ohne HOST nur lokal binden; der Container setzt HOST=0.0.0.0.
    host: env['HOST'] ?? '127.0.0.1',
    port,
    databaseUrl: required(env, 'DATABASE_URL'),
    publicOrigin: required(env, 'PUBLIC_ORIGIN'),
    nodeEnv,
    trustProxy: nodeEnv === 'production',
  };
}
