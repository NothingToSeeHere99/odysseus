// The local server: serves the game, forwards /scrydex/* with credentials, caches responses.
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function listen(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

async function get(url) {
  const res = await fetch(url);
  return { status: res.status, headers: res.headers, text: await res.text() };
}

async function startProxy(env) {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'proxy.js')], { env: { ...process.env, PORT: String(port), ...env }, stdio: 'pipe' });
  for (let i = 0; i < 50; i++) {
    try {
      await get(`http://127.0.0.1:${port}/scrydex/health`);
      return { port, child };
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  child.kill();
  throw new Error('proxy did not start');
}

test('proxy forwards Scrydex requests with credentials and caches them', async (t) => {
  const hits = [];
  const upstream = http.createServer((req, res) => {
    hits.push({ url: req.url, key: req.headers['x-api-key'], team: req.headers['x-team-id'] });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ id: 'me1' }], total_count: 1 }));
  });
  const upPort = await listen(upstream);
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packrush-cache-'));
  const { port, child } = await startProxy({ SCRYDEX_API_KEY: 'secret', SCRYDEX_TEAM_ID: 'team', SCRYDEX_UPSTREAM: `http://127.0.0.1:${upPort}/pokemon/v1`, CACHE_DIR: cacheDir });
  t.after(() => {
    child.kill();
    upstream.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
  });

  const health = JSON.parse((await get(`http://127.0.0.1:${port}/scrydex/health`)).text);
  assert.strictEqual(health.configured, true);

  const a = await get(`http://127.0.0.1:${port}/scrydex/en/expansions?page=1&page_size=100`);
  assert.strictEqual(a.status, 200);
  assert.strictEqual(a.headers.get('x-cache'), 'miss');
  assert.strictEqual(a.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual(JSON.parse(a.text).data[0].id, 'me1');
  assert.deepStrictEqual(hits, [{ url: '/pokemon/v1/en/expansions?page=1&page_size=100', key: 'secret', team: 'team' }]);

  const b = await get(`http://127.0.0.1:${port}/scrydex/en/expansions?page=1&page_size=100`);
  assert.strictEqual(b.headers.get('x-cache'), 'hit');
  assert.strictEqual(hits.length, 1, 'second request served from cache');
  assert.ok(!b.text.includes('secret'));

  const page = await get(`http://127.0.0.1:${port}/`);
  assert.strictEqual(page.status, 200);
  assert.match(page.text, /<title>Pack Rush<\/title>/);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/server/proxy.js`)).status, 404);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/.git/config`)).status, 404);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/%2e%2e/%2e%2e/etc/passwd`)).status, 404);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/scrydex/../package.json`)).status, 404);
});

test('without credentials the proxy serves the game and reports Scrydex as not configured', async (t) => {
  const { port, child } = await startProxy({ SCRYDEX_API_KEY: '', SCRYDEX_TEAM_ID: '' });
  t.after(() => child.kill());
  assert.strictEqual(JSON.parse((await get(`http://127.0.0.1:${port}/scrydex/health`)).text).configured, false);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/scrydex/en/expansions`)).status, 503);
  assert.strictEqual((await get(`http://127.0.0.1:${port}/js/api.js`)).status, 200);
});
