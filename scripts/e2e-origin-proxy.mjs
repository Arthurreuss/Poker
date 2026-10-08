#!/usr/bin/env node
// Lokaler Origin-Proxy für den E2E-Test gegen prod (WP-020, D-028). Ohne Abhängigkeiten.
// Der Game-Server nimmt WebSockets nur mit einer Origin aus PUBLIC_ORIGIN an (D-014) – ein Browser auf
// http://localhost:4320 schickt aber `Origin: http://localhost:4320`. Der Proxy reicht alles unverändert an das
// Ziel durch (HTTP und WebSocket-Upgrade als rohe TCP-Verbindung) und ersetzt nur einen vorhandenen
// `Origin`-Header durch E2E_PROXY_ORIGIN. So läuft der Browser gegen die echten prod-Container (nginx, Server,
// DB), ohne dass prod eine zusätzliche Origin erlauben muss.
//   E2E_PROXY_TARGET=http://localhost:4320 E2E_PROXY_ORIGIN=https://poker.arthur-reuss.de \
//   E2E_PROXY_PORT=4318 node scripts/e2e-origin-proxy.mjs
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { fileURLToPath } from 'node:url';

/** Kopiert rohe Header-Paare und ersetzt den Wert von `Origin` (nur wenn vorhanden). */
export function rewriteOrigin(rawHeaders, origin) {
  const out = [];
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i];
    out.push(name, name.toLowerCase() === 'origin' ? origin : rawHeaders[i + 1]);
  }
  return out;
}

/**
 * Startet den Proxy; löst mit `{ port, close() }` auf.
 * @param {{ target: string, origin: string, port?: number, host?: string }} options
 */
export function startOriginProxy({ target, origin, port = 0, host = '127.0.0.1' }) {
  const url = new URL(target);
  if (url.protocol !== 'http:') throw new Error(`Origin-Proxy kann nur http-Ziele: ${target}`);
  const targetHost = url.hostname;
  const targetPort = Number(url.port || 80);

  const server = createServer((req, res) => {
    const upstream = httpRequest(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: rewriteOrigin(req.rawHeaders, origin),
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.rawHeaders);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('Origin-Proxy: Ziel nicht erreichbar');
    });
    req.pipe(upstream);
  });

  // WebSocket: Anfrage mit ersetzter Origin roh weiterschicken, danach beide Richtungen durchreichen –
  // die Antwort (101, 401, 403 …) kommt unverändert beim Browser an.
  server.on('upgrade', (req, socket, head) => {
    const upstream = connect(targetPort, targetHost, () => {
      const headers = rewriteOrigin(req.rawHeaders, origin);
      let raw = `${req.method ?? 'GET'} ${req.url ?? '/'} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < headers.length; i += 2) raw += `${headers[i]}: ${headers[i + 1]}\r\n`;
      upstream.write(`${raw}\r\n`);
      if (head.length > 0) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    const close = () => {
      upstream.destroy();
      socket.destroy();
    };
    // Server-Sockets sind halb offen erlaubt (allowHalfOpen) – deshalb beim ersten Ende beide schließen.
    for (const side of [upstream, socket]) for (const event of ['error', 'end', 'close']) side.on(event, close);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      resolve({
        port: typeof address === 'object' && address !== null ? address.port : port,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => {
              done(undefined);
            });
          }),
      });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.env.E2E_PROXY_TARGET;
  const origin = process.env.E2E_PROXY_ORIGIN;
  const port = Number(process.env.E2E_PROXY_PORT ?? 4318);
  if (!target || !origin) {
    console.error('✗ E2E_PROXY_TARGET und E2E_PROXY_ORIGIN setzen.');
    process.exit(2);
  }
  const proxy = await startOriginProxy({ target, origin, port });
  console.log(`Origin-Proxy: http://localhost:${String(proxy.port)} → ${target} (Origin: ${origin})`);
}
