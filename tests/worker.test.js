// The Cloudflare Worker relay for graded prices.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('worker relays /cards with the secret key, adds CORS, and refuses everything else', async (t) => {
  const { default: worker } = await import(pathToFileURL(path.join(__dirname, '..', 'worker', 'ppt-proxy.mjs')));
  const realFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.Authorization });
    return new Response(JSON.stringify({ data: [{ name: 'Charizard' }] }), { status: 200 });
  };
  t.after(() => (global.fetch = realFetch));
  const env = { PPT_API_KEY: 'secret' };

  const pre = await worker.fetch(new Request('https://w.dev/cards', { method: 'OPTIONS' }), env);
  assert.strictEqual(pre.status, 204);
  assert.strictEqual(pre.headers.get('access-control-allow-origin'), '*');

  const res = await worker.fetch(new Request('https://w.dev/cards?search=Charizard&includeEbay=true'), env);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('access-control-allow-origin'), '*');
  assert.strictEqual((await res.json()).data[0].name, 'Charizard');
  assert.deepStrictEqual(calls, [{ url: 'https://www.pokemonpricetracker.com/api/v2/cards?search=Charizard&includeEbay=true', auth: 'Bearer secret' }]);

  assert.strictEqual((await worker.fetch(new Request('https://w.dev/sets'), env)).status, 404);
  assert.strictEqual((await worker.fetch(new Request('https://w.dev/cards', { method: 'POST' }), env)).status, 405);
  assert.strictEqual((await worker.fetch(new Request('https://w.dev/cards'), {})).status, 503);
  assert.deepStrictEqual(await (await worker.fetch(new Request('https://w.dev/'), env)).json(), { ok: true, ppt: true });
});
