#!/usr/bin/env node
// Smoke-Test der Prod-Umgebung über den Web-Container (WP-003), ohne Abhängigkeiten.
// Prüft: GET /api/health, WS-Handshake auf /ws mit gültiger Origin (inkl. Echo durch den Proxy)
// und dass eine fremde Origin abgelehnt wird.
//   npm run prod:smoke
//   SMOKE_URL=http://localhost:4320 SMOKE_ORIGIN=https://poker.arthur-reuss.de node scripts/smoke-prod.mjs
// Ohne SMOKE_ORIGIN wird PUBLIC_ORIGIN aus der Umgebung bzw. aus .env.prod genommen
// (PROD_ENV_FILE, von scripts/prod.sh auf die .env.prod im Prod-Worktree gesetzt; sonst ../.env.prod).
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { randomBytes } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const TIMEOUT_MS = 5000;

function envFileValue(name) {
  const file = process.env.PROD_ENV_FILE ?? new URL('../.env.prod', import.meta.url);
  if (!existsSync(file)) return undefined;
  const line = readFileSync(file, 'utf8')
    .split('\n')
    .findLast((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

const baseUrl = new URL(process.env.SMOKE_URL ?? `http://localhost:${envFileValue('WEB_PORT') ?? '4320'}`);
const origin = process.env.SMOKE_ORIGIN ?? process.env.PUBLIC_ORIGIN ?? envFileValue('PUBLIC_ORIGIN');
if (!origin) {
  console.error('✗ Keine Origin: SMOKE_ORIGIN oder PUBLIC_ORIGIN setzen (oder .env.prod anlegen).');
  process.exit(1);
}

/** Maskierter Text-Frame Client → Server (RFC 6455), nur für kurze Nachrichten. */
function encodeClientTextFrame(text) {
  const payload = Buffer.from(text);
  if (payload.length > 125) throw new Error('Nachricht zu lang für den Smoke-Test');
  const mask = randomBytes(4);
  const masked = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
  return Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]);
}

/** Liest unmaskierte Frames Server → Client; liefert Text-Frames, ignoriert Ping/Pong. */
function decodeServerFrames(buffer) {
  const texts = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    let length = buffer[offset + 1] & 0x7f;
    let header = 2;
    if (length === 126) {
      if (offset + 4 > buffer.length) break;
      length = buffer.readUInt16BE(offset + 2);
      header = 4;
    } else if (length === 127) {
      throw new Error('Frame zu groß für den Smoke-Test');
    }
    if (offset + header + length > buffer.length) break;
    if (opcode === 0x1) texts.push(buffer.subarray(offset + header, offset + header + length).toString());
    offset += header + length;
  }
  return { texts, rest: buffer.subarray(offset) };
}

function withTimeout(promise, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout: ${what}`)), TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function checkHealth() {
  const res = await fetch(new URL('/api/health', baseUrl), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json();
  if (res.status !== 200 || body.status !== 'ok' || body.db !== 'ok') {
    throw new Error(`/api/health: HTTP ${res.status} ${JSON.stringify(body)}`);
  }
  return JSON.stringify(body);
}

/** Startet ein WS-Upgrade; löst mit { status, socket?, head? } auf. */
function upgrade(wsOrigin) {
  return new Promise((resolve, reject) => {
    const request = baseUrl.protocol === 'https:' ? httpsRequest : httpRequest;
    const req = request(new URL('/ws', baseUrl), {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
        Origin: wsOrigin,
      },
    });
    req.on('upgrade', (res, socket, head) => resolve({ status: res.statusCode, socket, head }));
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', reject);
    req.end();
  });
}

async function checkWebSocket() {
  const { status, socket, head } = await withTimeout(upgrade(origin), 'WS-Handshake');
  if (status !== 101 || !socket) throw new Error(`WS mit Origin ${origin}: HTTP ${status} statt 101`);
  try {
    const texts = await withTimeout(
      new Promise((resolve, reject) => {
        let buffer = head ?? Buffer.alloc(0);
        let sent = false;
        const received = [];
        const onData = (chunk) => {
          buffer = Buffer.concat([buffer, chunk]);
          const decoded = decodeServerFrames(buffer);
          buffer = decoded.rest;
          received.push(...decoded.texts);
          if (!sent && received.length >= 1) {
            socket.write(encodeClientTextFrame('smoke-echo'));
            sent = true;
          }
          if (received.includes('smoke-echo')) resolve(received);
        };
        socket.on('data', onData);
        socket.on('error', reject);
        socket.on('close', () => reject(new Error('Verbindung vorzeitig geschlossen')));
        if (buffer.length > 0) onData(Buffer.alloc(0));
      }),
      'WS-Nachrichten',
    );
    return `101, empfangen: ${texts.join(' | ')}`;
  } finally {
    socket.destroy();
  }
}

async function checkForeignOrigin() {
  const foreign = 'https://evil.example';
  const { status, socket } = await withTimeout(upgrade(foreign), 'WS mit fremder Origin');
  socket?.destroy();
  if (status !== 403) throw new Error(`WS mit Origin ${foreign}: HTTP ${status} statt 403`);
  return `${status} für ${foreign}`;
}

const checks = [
  ['GET /api/health', checkHealth],
  [`WS /ws (Origin ${origin})`, checkWebSocket],
  ['WS /ws mit fremder Origin abgelehnt', checkForeignOrigin],
];

console.log(`Smoke-Test gegen ${baseUrl.origin}`);
let failed = 0;
for (const [name, check] of checks) {
  try {
    console.log(`✓ ${name}: ${await check()}`);
  } catch (err) {
    failed += 1;
    console.log(`✗ ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
process.exit(failed === 0 ? 0 : 1);
