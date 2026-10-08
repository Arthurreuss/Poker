// Origin-Proxy für den E2E-Test gegen prod (WP-020): reicht HTTP und WebSocket-Upgrade durch und ersetzt nur
// die Origin. Gegen einen lokalen Stub-Server, der wie der Game-Server fremde Origins mit 403 ablehnt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { rewriteOrigin, startOriginProxy } from '../e2e-origin-proxy.mjs';

const ALLOWED = 'https://poker.example';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve(server.address().port);
    });
  });
}

/** Stub: HTTP antwortet mit der empfangenen Origin; Upgrade nur mit erlaubter Origin (101, dann Echo). */
async function stubServer() {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'a=b; Path=/' });
      res.end(JSON.stringify({ origin: req.headers.origin ?? null, body, path: req.url }));
    });
  });
  server.on('upgrade', (req, socket) => {
    if (req.headers.origin !== ALLOWED) {
      socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (chunk) => socket.write(chunk));
    socket.on('end', () => socket.destroy()); // HTTP-Server erlauben halb offene Sockets
  });
  const port = await listen(server);
  return { port, close: () => new Promise((r) => server.close(r)) };
}

function httpCall(port, options) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, ...options }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

/** WS-Upgrade über den Proxy; löst mit Status und (bei 101) dem Echo einer Testnachricht auf. */
function upgradeCall(port, origin) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', Origin: origin },
    });
    req.on('upgrade', (res, socket) => {
      socket.once('data', (chunk) => {
        socket.destroy();
        resolve({ status: res.statusCode, echo: chunk.toString() });
      });
      socket.write('ping');
    });
    req.on('response', (res) => {
      res.resume();
      resolve({ status: res.statusCode });
    });
    req.on('error', reject);
    req.end();
  });
}

test('rewriteOrigin ersetzt nur Origin (unabhängig von Groß-/Kleinschreibung)', () => {
  assert.deepEqual(rewriteOrigin(['Host', 'x', 'origin', 'http://localhost:4320', 'Cookie', 'c=1'], ALLOWED), [
    'Host',
    'x',
    'origin',
    ALLOWED,
    'Cookie',
    'c=1',
  ]);
  assert.deepEqual(rewriteOrigin(['Host', 'x'], ALLOWED), ['Host', 'x']);
});

test('HTTP: Origin ersetzt, Body, Pfad und Set-Cookie unverändert', async () => {
  const stub = await stubServer();
  const proxy = await startOriginProxy({ target: `http://127.0.0.1:${String(stub.port)}`, origin: ALLOWED });
  try {
    const res = await httpCall(proxy.port, {
      method: 'POST',
      path: '/api/register?x=1',
      headers: { Origin: 'http://localhost:4326', 'content-type': 'application/json' },
      body: '{"a":1}',
    });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.data), { origin: ALLOWED, body: '{"a":1}', path: '/api/register?x=1' });
    assert.deepEqual(res.headers['set-cookie'], ['a=b; Path=/']);
    const plain = await httpCall(proxy.port, { method: 'GET', path: '/' });
    assert.equal(JSON.parse(plain.data).origin, null, 'ohne Origin bleibt sie weg');
  } finally {
    await proxy.close();
    await stub.close();
  }
});

test('WebSocket-Upgrade: mit ersetzter Origin 101 und Daten in beide Richtungen', async () => {
  const stub = await stubServer();
  const proxy = await startOriginProxy({ target: `http://127.0.0.1:${String(stub.port)}`, origin: ALLOWED });
  try {
    const res = await upgradeCall(proxy.port, 'http://localhost:4326');
    assert.equal(res.status, 101);
    assert.equal(res.echo, 'ping');
  } finally {
    await proxy.close();
    await stub.close();
  }
});

test('WebSocket-Upgrade: Ablehnung des Ziels kommt unverändert an', async () => {
  const stub = await stubServer();
  const proxy = await startOriginProxy({
    target: `http://127.0.0.1:${String(stub.port)}`,
    origin: 'https://evil.example',
  });
  try {
    const res = await upgradeCall(proxy.port, 'http://localhost:4326');
    assert.equal(res.status, 403);
  } finally {
    await proxy.close();
    await stub.close();
  }
});

test('nur http-Ziele', () => {
  assert.throws(() => startOriginProxy({ target: 'https://poker.example', origin: ALLOWED }), /nur http/);
});
