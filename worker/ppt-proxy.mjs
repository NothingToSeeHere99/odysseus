// Pack Rush graded-price relay for Cloudflare Workers (free plan is plenty).
// PokemonPriceTracker doesn't accept requests straight from a web page, so the game asks
// this worker, which adds your key (kept as a secret, never sent to the browser), allows
// the game's requests, and caches answers for 12 hours to save credits.
//
// Setup: Cloudflare dashboard → Workers & Pages → Create → Worker → paste this file →
// Deploy → Settings → Variables and Secrets → add secret PPT_API_KEY → copy the worker's
// URL into Pack Rush (Profile → Card data → Graded prices → Server URL).

const UPSTREAM = 'https://www.pokemonpricetracker.com/api/v2/cards';
const CACHE_SECONDS = 12 * 3600;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
    const url = new URL(request.url);
    if (url.pathname.replace(/\/+$/, '') === '' || url.pathname === '/health') return json(200, { ok: true, ppt: !!env.PPT_API_KEY });
    if (!/\/cards\/?$/.test(url.pathname)) return json(404, { error: 'Only /cards is available' });
    if (!env.PPT_API_KEY) return json(503, { error: 'Add the PPT_API_KEY secret to this worker.' });

    const target = UPSTREAM + url.search;
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(target);
    if (cache) {
      const hit = await cache.match(cacheKey);
      if (hit) return new Response(hit.body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'hit' } });
    }
    const up = await fetch(target, { headers: { Authorization: 'Bearer ' + env.PPT_API_KEY, Accept: 'application/json' } });
    const body = await up.text();
    const res = new Response(body, { status: up.status, headers: { ...CORS, 'Content-Type': 'application/json', 'X-Cache': 'miss' } });
    if (cache && up.status === 200) {
      const stored = new Response(body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_SECONDS}` } });
      if (ctx && ctx.waitUntil) ctx.waitUntil(cache.put(cacheKey, stored));
      else await cache.put(cacheKey, stored);
    }
    return res;
  },
};
