// Nur für Tests: WebSocket-Client, der alle Server-Nachrichten mitschreibt und auf bestimmte warten kann,
// plus eine einfache Bot-Strategie. Wird von den Integrationstests (mit und ohne DB) genutzt.
import { createSeededRng, type Action, type HandState, type Rng } from '@poker/engine';
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type TableStateMessage,
} from '@poker/engine/protocol';
import { WebSocket, type RawData } from 'ws';
import type { AuthUser } from '../auth/session';

const WAIT_TIMEOUT_MS = 10_000;

export function rawToText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

/**
 * Fake-Session für Tests ohne DB: Cookie `poker_session=user-<id>` → User <id> (`user<id>`);
 * `poker_session=admin-<id>` → derselbe User mit Admin-Flag (WP-033).
 */
export function fakeAuthenticate(cookie: string | undefined): Promise<AuthUser | null> {
  const match = /poker_session=(user|admin)-(\d+)/.exec(cookie ?? '');
  if (match?.[2] === undefined) return Promise.resolve(null);
  const id = Number(match[2]);
  return Promise.resolve({ id, username: `user${String(id)}`, isAdmin: match[1] === 'admin', avatar: null });
}

type Outgoing = ClientMessage | Record<string, unknown>;

export class TestClient {
  /** Alle empfangenen Nachrichten in Reihenfolge, roh und geparst. */
  readonly raw: string[] = [];
  readonly messages: ServerMessage[] = [];
  private cursor = 0;
  private waiters: (() => void)[] = [];
  closeCode: number | null = null;

  private constructor(
    readonly ws: WebSocket,
    readonly userId: number,
  ) {
    ws.on('message', (data) => {
      const text = rawToText(data);
      this.raw.push(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
      for (const w of this.waiters) w();
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      for (const w of this.waiters) w();
    });
  }

  /** Verbindet und sendet `hello` (außer `hello: false`); wartet auf `welcome`. */
  static async connect(
    url: string,
    origin: string,
    cookie: string,
    userId: number,
    { hello = true }: { hello?: boolean } = {},
  ): Promise<TestClient> {
    const ws = new WebSocket(url, { origin, headers: { cookie } });
    const client = new TestClient(ws, userId);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => {
        resolve();
      });
      ws.once('error', reject);
    });
    if (hello) {
      client.send({ type: 'hello', protocolVersion: PROTOCOL_VERSION });
      await client.next((m) => m.type === 'welcome');
    }
    return client;
  }

  send(message: Outgoing): void {
    this.ws.send(JSON.stringify(message));
  }

  sendRaw(text: string): void {
    this.ws.send(text);
  }

  /** Nächste Nachricht ab dem Lesezeiger, die `predicate` erfüllt; der Zeiger rückt dahinter. */
  next<T extends ServerMessage = ServerMessage>(
    predicate: (m: ServerMessage) => boolean,
    timeoutMs = WAIT_TIMEOUT_MS,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const check = (): boolean => {
        for (let i = this.cursor; i < this.messages.length; i++) {
          const m = this.messages[i] as ServerMessage;
          if (predicate(m)) {
            this.cursor = i + 1;
            resolve(m as T);
            return true;
          }
        }
        return false;
      };
      if (check()) return;
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== waiter);
        reject(new Error(`Timeout: erwartete Nachricht nicht erhalten (User ${String(this.userId)})`));
      }, timeoutMs);
      const waiter = (): void => {
        if (check()) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== waiter);
        }
      };
      this.waiters.push(waiter);
    });
  }

  /** Nächster Fehler (ab Lesezeiger). */
  nextError(): Promise<Extract<ServerMessage, { type: 'error' }>> {
    return this.next((m) => m.type === 'error');
  }

  /** Nächster Tischzustand, der `predicate` erfüllt. */
  nextState(predicate: (s: TableStateMessage['table']) => boolean = () => true): Promise<TableStateMessage> {
    return this.next((m) => m.type === 'table.state' && predicate(m.table));
  }

  /** Lesezeiger ans Ende setzen (alles Bisherige gilt als gelesen). */
  skip(): void {
    this.cursor = this.messages.length;
  }

  /** Neuester empfangener Tischzustand. */
  latestState(): TableStateMessage['table'] | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i] as ServerMessage;
      if (m.type === 'table.state') return m.table;
    }
    return undefined;
  }

  errors(): Extract<ServerMessage, { type: 'error' }>[] {
    return this.messages.filter((m) => m.type === 'error');
  }

  close(): void {
    this.ws.close();
  }
}

/**
 * Einfacher Bot: reagiert auf jeden Tischzustand, in dem er am Zug ist (`legalActions`), mit einer
 * zufälligen, aber erlaubten Aktion. Viele All-ins, damit eine Runde schnell endet.
 */
export function attachBot(client: TestClient, tableId: number, seed: number): void {
  const rng: Rng = createSeededRng(seed);
  const acted = new Set<string>();
  client.ws.on('message', (data) => {
    const text = rawToText(data);
    const msg = JSON.parse(text) as ServerMessage;
    if (msg.type !== 'table.state' || msg.table.id !== tableId) return;
    const hand = msg.table.round?.hand;
    const legal = hand?.legalActions;
    if (hand === undefined || hand === null || legal === null || legal === undefined) return;
    const key = `${String(hand.handNumber)}/${String(hand.actionSeq)}`;
    if (acted.has(key)) return;
    acted.add(key);
    client.send({
      type: 'table.action',
      tableId,
      handNumber: hand.handNumber,
      seq: hand.actionSeq,
      action: chooseAction(legal.actions, rng),
    });
  });
}

function chooseAction(actions: { type: string }[], rng: Rng): Action {
  const has = (t: string): boolean => actions.some((a) => a.type === t);
  const roll = rng.int(100);
  if (roll < 35 && has('allIn')) return { type: 'allIn' };
  if (roll < 45 && has('fold') && !has('check')) return { type: 'fold' };
  if (has('check')) return { type: 'check' };
  if (has('call')) return { type: 'call' };
  return { type: 'fold' };
}

/**
 * Prüft für einen Client, dass er nie fremde Hole Cards gesehen hat, die nicht im Showdown gezeigt wurden:
 * strukturell (Felder `holeCards`/`shownCards`/Bewertungen) und zusätzlich per Textsuche über alle
 * empfangenen Nachrichten gegen die echten Karten aus dem Serverzustand (`hands`, z. B. aus `onHandStarted`).
 * Liefert eine Liste von Verstößen (leer = in Ordnung).
 */
export function findHoleCardLeaks(client: TestClient, hands: ReadonlyMap<number, HandState>): string[] {
  const me = String(client.userId);
  const leaks: string[] = [];
  client.messages.forEach((m, index) => {
    const raw = client.raw[index] as string;
    if (/"(deck|burned)"/.test(raw)) leaks.push(`Nachricht ${String(index)} enthält deck/burned`);
    if (m.type !== 'table.state') return;
    const hand = m.table.round?.hand;
    if (hand === undefined || hand === null) return;
    const shown = new Set(
      (hand.phase === 'complete' ? (hand.showdown?.reveals ?? []) : [])
        .filter((r) => r.shownCards !== null)
        .map((r) => r.playerId),
    );
    for (const p of hand.players) {
      if (p.playerId !== me && p.holeCards !== null && !shown.has(p.playerId)) {
        leaks.push(`Hand ${String(hand.handNumber)}: Karten von ${p.playerId} sichtbar`);
      }
    }
    for (const r of hand.showdown?.reveals ?? []) {
      if (r.playerId !== me && r.shownCards === null && r.hand !== null) {
        leaks.push(`Hand ${String(hand.handNumber)}: Bewertung des Muckers ${r.playerId} sichtbar`);
      }
    }
    const real = hands.get(hand.handNumber);
    if (real === undefined) return;
    for (const p of real.players) {
      if (p.id === me || shown.has(p.id)) continue;
      for (const card of p.holeCards) {
        if (raw.includes(`"${card}"`)) leaks.push(`Hand ${String(hand.handNumber)}: Karte ${card} von ${p.id}`);
      }
    }
  });
  return leaks;
}
