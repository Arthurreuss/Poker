// Konfiguration ausschließlich über Umgebungsvariablen – keine Hostnamen/Ports im Code (D-014).

export interface ServerConfig {
  /** Adresse, an die der HTTP-Server bindet (im Container `0.0.0.0`). */
  host: string;
  port: number;
  databaseUrl: string;
  /**
   * Öffentliche Origins der App (D-014, D-023), z. B. für den Origin-Check beim WebSocket-Upgrade.
   * `PUBLIC_ORIGIN` darf mehrere, durch Komma getrennte Origins enthalten; die erste ist die Hauptadresse.
   */
  publicOrigins: readonly string[];
  nodeEnv: string;
  /** Proxy-Header (`X-Forwarded-For`/`-Proto`) nur in prod vertrauen (D-014). */
  trustProxy: boolean;
  /**
   * `LOG_FILE`: Logs in diese Datei statt nach stdout (prod: `/var/log/poker/server.log`, rotiert vom Dienst
   * `logrotate`, D-025). `null` = stdout.
   */
  logFile: string | null;
}

export type Env = Record<string, string | undefined>;

function required(env: Env, name: string): string {
  const value = env[name];
  if (value === undefined || value.trim() === '') {
    throw new Error(`Umgebungsvariable ${name} fehlt`);
  }
  return value;
}

function optional(env: Env, name: string): string | null {
  const value = env[name]?.trim();
  return value === undefined || value === '' ? null : value;
}

/** Zerlegt `PUBLIC_ORIGIN` (kommagetrennt) und prüft, dass jeder Eintrag eine reine Origin ist (`https://host[:port]`). */
export function parsePublicOrigins(raw: string): string[] {
  const origins = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error(`PUBLIC_ORIGIN enthält keine gültige Origin: ${origin}`);
    }
    if (parsed.origin !== origin) {
      throw new Error(`PUBLIC_ORIGIN muss Origins ohne Pfad und ohne Schrägstrich am Ende enthalten: ${origin}`);
    }
  }
  if (origins.length === 0) throw new Error('Umgebungsvariable PUBLIC_ORIGIN fehlt');
  return origins;
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
    publicOrigins: parsePublicOrigins(required(env, 'PUBLIC_ORIGIN')),
    nodeEnv,
    trustProxy: nodeEnv === 'production',
    logFile: optional(env, 'LOG_FILE'),
  };
}
