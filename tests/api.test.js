// Card data sources: pagination, Scrydex conversion and automatic fallback.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load({ fetch, now } = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    key: (i) => [...mem.keys()][i],
    get length() {
      return mem.size;
    },
  };
  const RealDate = Date;
  const clock = typeof now === 'object' ? now : { t: now };
  const FakeDate = clock.t ? class extends RealDate { static now() { return clock.t; } } : RealDate;
  const ctx = vm.createContext({ console, Math, Date: FakeDate, URL, AbortController, setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, fetch, localStorage });
  Object.defineProperty(ctx, 'localStorage', { value: localStorage });
  for (const f of ['util.js', 'api.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx);
  // util.store reads the global localStorage; expose Object.keys over our map.
  ctx.PP.util.store.keys = () => [...mem.keys()];
  return ctx.PP;
}

const ok = (json) => ({ ok: true, status: 200, json: async () => json });
const fail = (status) => ({ ok: false, status, json: async () => ({}) });

test('legacy set list reads every page (no 250-set cap)', async () => {
  const sets = Array.from({ length: 280 }, (_, i) => ({ id: `s${i}`, name: `Set ${i}`, series: 'X', releaseDate: '2000/01/01', total: 100, printedTotal: 100, images: {} }));
  const calls = [];
  const PP = load({
    fetch: async (url) => {
      const u = new URL(url);
      calls.push(u.searchParams.get('page'));
      const page = Number(u.searchParams.get('page'));
      return ok({ data: sets.slice((page - 1) * 250, page * 250), totalCount: 280 });
    },
  });
  const got = await PP.api.getSets(true);
  assert.strictEqual(got.length, 280);
  assert.strictEqual(calls.join(), '1,2');
});

test('Scrydex cards convert to the same shape as legacy cards', () => {
  const PP = load({ fetch: async () => fail(500) });
  const c = PP.api.scrydexCard({
    id: 'sv3pt5-199',
    name: 'Charizard ex',
    supertype: 'Pokémon',
    number: '199',
    printed_number: '199/165',
    rarity: 'Special Illustration Rare',
    images: [{ type: 'front', small: 'https://img/s.png', medium: 'https://img/m.png', large: 'https://img/l.png' }],
    expansion: { id: 'sv3pt5', name: '151' },
    variants: [
      { name: 'holofoil', prices: [{ condition: 'LP', type: 'raw', market: 90, currency: 'USD' }, { condition: 'NM', type: 'raw', market: 120.456, currency: 'USD' }, { grade: '10', company: 'PSA', type: 'graded', market: 900, currency: 'USD' }] },
      { name: 'reverse_holofoil', prices: [{ condition: 'NM', type: 'raw', low: 5, currency: 'USD' }] },
      { name: 'firstEditionHolofoil', prices: [{ condition: 'NM', type: 'raw', market: 300, currency: 'USD' }] },
    ],
  });
  assert.strictEqual(JSON.stringify(c), JSON.stringify({ g: { 10: 900 }, id: 'sv3pt5-199', s: 'sv3pt5', n: 'Charizard ex', no: '199', r: 'Special Illustration Rare', st: 'Pokémon', img: 'https://img/s.png', big: 'https://img/l.png', p: { holofoil: 120.46, reverseHolofoil: 5, '1stEditionHolofoil': 300 } }));
  const set = PP.api.scrydexSet({ id: 'me2', name: 'Phantasmal Flames', series: 'Mega Evolution', total: 130, printed_total: 94, release_date: '2025/11/14', logo: 'L', symbol: 'S' });
  assert.strictEqual(JSON.stringify(set), JSON.stringify({ id: 'me2', name: 'Phantasmal Flames', series: 'Mega Evolution', total: 130, printed: 94, date: '2025/11/14', logo: 'L', symbol: 'S' }));
  assert.strictEqual(PP.api.variantKey('Normal'), 'normal');
  assert.strictEqual(PP.api.variantKey('reverseHolofoil'), 'reverseHolofoil');
});

test('auto mode: free API down → TCGdex (free) before Scrydex, and it sticks for the session', async () => {
  const seen = [];
  const PP = load({
    fetch: async (url, init) => {
      seen.push(url);
      if (url.startsWith('https://api.pokemontcg.io')) throw new TypeError('fetch failed');
      if (url.startsWith('https://api.tcgdex.net/v2/graphql')) {
        assert.strictEqual(init.method, 'POST');
        return ok({ data: { sets: [{ id: 'sv03.5', name: '151', releaseDate: '2023-09-22', serie: { id: 'sv', name: 'Scarlet & Violet' }, cardCount: { total: 207, official: 165 }, logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo' }, { id: 'A1', name: 'Genetic Apex', releaseDate: '2024-10-30', serie: { id: 'tcgp', name: 'Pokémon TCG Pocket' }, cardCount: { total: 286, official: 226 } }] } });
      }
      throw new Error('Scrydex should not be used while TCGdex works: ' + url);
    },
  });
  PP.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  const sets = await PP.api.getSets(true);
  assert.strictEqual(JSON.stringify(sets), JSON.stringify([{ id: 'sv3pt5', name: '151', series: 'Scarlet & Violet', total: 207, printed: 165, date: '2023-09-22', logo: 'https://assets.tcgdex.net/en/sv/sv03.5/logo.png' }]));
  seen.length = 0;
  await PP.api.getSets(true);
  assert.ok(seen[0].startsWith('https://api.tcgdex.net'), 'TCGdex first after the free API failed');
  assert.strictEqual((await PP.api.status()).lastSource, 'tcgdex');
});

test('auto mode falls back to Scrydex when both free sources fail, then stops retrying them first', async () => {
  const calls = [];
  const PP = load({
    fetch: async (url, init) => {
      calls.push(url);
      if (!url.startsWith('https://api.scrydex.com')) throw new TypeError('fetch failed');
      assert.strictEqual(init.headers['X-Api-Key'], 'k');
      assert.strictEqual(init.headers['X-Team-ID'], 't');
      return ok({ data: [{ id: 'me1', name: 'Mega Evolution', series: 'Mega Evolution', total: 188, printed_total: 132, release_date: '2025/09/26' }], total_count: 1 });
    },
  });
  PP.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  const sets = await PP.api.getSets(true);
  assert.strictEqual(sets[0].id, 'me1');
  const st = await PP.api.status();
  assert.strictEqual(st.lastSource, 'scrydex');
  assert.deepStrictEqual([...st.down].sort(), ['legacy', 'tcgdex']);
  calls.length = 0;
  await PP.api.getSets(true);
  assert.ok(calls[0].startsWith('https://api.scrydex.com'), 'failed sources are not retried first');
});

test('source order before and after the Pokémon TCG API shutdown', async () => {
  const first = [];
  const PP = load({ fetch: async (url) => (first.push(url), ok({ data: [{ id: 'base1', name: 'Base', series: 'Base', total: 102, printedTotal: 102, releaseDate: '1999/01/09', images: {} }], totalCount: 1 })) });
  await PP.api.getSets(true);
  assert.ok(first[0].startsWith('https://api.pokemontcg.io'));

  const after = [];
  const tcgdexSets = { data: { sets: [{ id: 'me01', name: 'Mega Evolution', releaseDate: '2025-09-26', serie: { id: 'me', name: 'Mega Evolution' }, cardCount: { total: 188, official: 132 } }] } };
  const PP2 = load({ now: Date.UTC(2027, 2, 2), fetch: async (url) => (after.push(url), ok(url.includes('tcgdex') ? tcgdexSets : { data: [{ id: 'me1' }], total_count: 1 })) });
  await PP2.api.getSets(true);
  assert.ok(after[0].startsWith('https://api.tcgdex.net'), 'no Scrydex: TCGdex replaces the shut-down API');
  assert.ok(!after.some((u) => u.includes('pokemontcg.io')));

  const paid = [];
  const PP3 = load({ now: Date.UTC(2027, 2, 2), fetch: async (url) => (paid.push(url), ok({ data: [{ id: 'me1', name: 'Mega Evolution', release_date: '2025/09/26' }], total_count: 1 })) });
  PP3.api.saveSettings({ scrydexKey: 'k', scrydexTeam: 't' });
  await PP3.api.getSets(true);
  assert.ok(paid[0].startsWith('https://api.scrydex.com'), 'Scrydex set up: it takes over after the shutdown');
});

test('TCGdex set ids translate to Pokémon TCG API ids for every set', () => {
  const PP = load({ fetch: async () => fail(500) });
  const pairs = require('./fixtures/tcgdex-set-ids.json');
  const wrong = Object.entries(pairs).filter(([theirs, ours]) => PP.api.fromTcgdexSet(theirs) !== ours);
  assert.strictEqual(Object.keys(pairs).length, 176);
  assert.deepStrictEqual(wrong, []);
  // Unknown future sets follow the same pattern.
  assert.strictEqual(PP.api.fromTcgdexSet('sv11'), 'sv11');
  assert.strictEqual(PP.api.fromTcgdexSet('me06.5'), 'me6pt5');
});

test('TCGdex cards convert to the same shape, with numbers and prices matching the other sources', () => {
  const PP = load({ fetch: async () => fail(500) });
  const c = PP.api.tcgdexCard(
    { id: 'sv03.5-006', localId: '006', name: 'Charizard ex', rarity: 'Double rare', category: 'Pokemon', image: 'https://assets.tcgdex.net/en/sv/sv03.5/006' },
    'sv3pt5',
    {
      tcgplayer: { unit: 'USD', updated: '2026-10-08', holofoil: { lowPrice: 4, midPrice: 6, marketPrice: 5.555 }, 'reverse-holofoil': { lowPrice: 9, midPrice: 11 }, normal: { lowPrice: 0 } },
      cardmarket: { unit: 'EUR', trend: 4.2, 'trend-holo': 8.9 },
    }
  );
  assert.strictEqual(
    JSON.stringify(c),
    JSON.stringify({ id: 'sv3pt5-6', s: 'sv3pt5', n: 'Charizard ex', no: '6', r: 'Double rare', st: 'Pokémon', img: 'https://assets.tcgdex.net/en/sv/sv03.5/006/low.webp', big: 'https://assets.tcgdex.net/en/sv/sv03.5/006/high.webp', p: { holofoil: 5.56, reverseHolofoil: 11 }, cm: 4.2, cmr: 8.9 })
  );
  const tg = PP.api.tcgdexCard({ id: 'swsh9tg-TG01', localId: 'TG01', name: 'Flareon', rarity: 'None', category: 'Pokemon' }, 'swsh9tg', null);
  assert.strictEqual(tg.id, 'swsh9tg-TG01');
  assert.strictEqual(tg.r, '');
  assert.strictEqual(tg.img, undefined);
});

test('TCGdex set cards: one GraphQL request with an exact id match, then one price request per card', async () => {
  const graph = [];
  const rest = [];
  const PP = load({
    fetch: async (url, init) => {
      if (url.startsWith('https://api.pokemontcg.io')) throw new TypeError('down');
      if (url.endsWith('/graphql')) {
        const q = JSON.parse(init.body).query;
        graph.push(q);
        if (q.includes('{ sets { id } }')) return ok({ data: { sets: [{ id: 'sv03' }, { id: 'sv03.5' }] } });
        return ok({ data: { set: { id: 'sv03.5', cards: [{ id: 'sv03.5-001', localId: '001', name: 'Bulbasaur', rarity: 'Common', category: 'Pokemon', image: 'https://a/1' }, { id: 'sv03.5-199', localId: '199', name: 'Charizard ex', rarity: 'Special illustration rare', category: 'Pokemon', image: 'https://a/199' }] } } });
      }
      rest.push(url);
      const id = url.split('/').pop();
      return ok({ id, pricing: { tcgplayer: id.endsWith('199') ? { holofoil: { marketPrice: 250 } } : { normal: { marketPrice: 0.12 }, 'reverse-holofoil': { marketPrice: 0.5 } } } });
    },
  });
  PP.api.saveSettings({ source: 'tcgdex' });
  const cards = await PP.api.getSetCards('sv3pt5', true);
  assert.strictEqual(cards.map((c) => `${c.id}:${JSON.stringify(c.p)}`).join(' '), 'sv3pt5-1:{"normal":0.12,"reverseHolofoil":0.5} sv3pt5-199:{"holofoil":250}');
  assert.ok(graph.some((q) => q.includes('"eq:sv03.5"')), 'exact match so sv03 doesn\'t match sv03.5');
  assert.deepStrictEqual(rest.sort(), ['https://api.tcgdex.net/v2/en/cards/sv03.5-001', 'https://api.tcgdex.net/v2/en/cards/sv03.5-199']);
  // Price refresh for owned cards maps our ids back to TCGdex's.
  rest.length = 0;
  const owned = await PP.api.getCardsByIds(['sv3pt5-199']);
  assert.strictEqual(owned.length, 1);
  assert.strictEqual(owned[0].p.holofoil, 250);
  assert.deepStrictEqual(rest, ['https://api.tcgdex.net/v2/en/cards/sv03.5-199']);
});

test('without Scrydex, auto mode never calls it', async () => {
  const seen = [];
  const PP = load({ fetch: async (url) => (seen.push(url), ok({ data: [], totalCount: 0 })) });
  await PP.api.getSets(true).catch(() => {});
  assert.ok(!seen.some((u) => u.includes('scrydex')));
});

// ---- two-layer cache: card details kept a week, prices refreshed daily in the background ----

const flush = () => new Promise((r) => setImmediate(r));
async function settle() {
  for (let i = 0; i < 20; i++) await flush();
}

function legacyFixture(priceFor) {
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u.searchParams.get('select') || u.pathname);
    const cards = [
      { id: 'sv1-1', name: 'Sprigatito', number: '1', rarity: 'Common', supertype: 'Pokémon', images: { small: 's1', large: 'l1' }, tcgplayer: { prices: { normal: { market: priceFor('sv1-1') } } } },
      { id: 'sv1-200', name: 'Miraidon ex', number: '200', rarity: 'Special Illustration Rare', supertype: 'Pokémon', images: { small: 's2', large: 'l2' }, tcgplayer: { prices: { holofoil: { market: priceFor('sv1-200') } } } },
    ];
    const sel = u.searchParams.get('select');
    const data = sel === 'id,tcgplayer,cardmarket' ? cards.map(({ id, tcgplayer }) => ({ id, tcgplayer })) : cards;
    return ok({ data, totalCount: data.length });
  };
  return { fetch, calls };
}

test('cache: second load uses saved data with no requests', async () => {
  const clock = { t: Date.UTC(2026, 9, 8) };
  const fx = legacyFixture(() => 1);
  const PP = load({ fetch: fx.fetch, now: clock });
  await PP.api.getSetCards('sv1');
  assert.strictEqual(fx.calls.length, 1);
  clock.t += 23 * 3600e3;
  const again = await PP.api.getSetCards('sv1');
  await settle();
  assert.strictEqual(fx.calls.length, 1, 'nothing fetched within a day');
  assert.strictEqual(again[1].p.holofoil, 1);
});

test('cache: stale prices return instantly and refresh in the background, prices only', async () => {
  const clock = { t: Date.UTC(2026, 9, 8) };
  let price = 100;
  const fx = legacyFixture((id) => (id === 'sv1-200' ? price : 0.1));
  const PP = load({ fetch: fx.fetch, now: clock });
  await PP.api.getSetCards('sv1');
  price = 140;
  clock.t += 25 * 3600e3;
  const heard = [];
  PP.api.onPrices((setId, cards) => heard.push([setId, cards[1].p.holofoil]));
  const instant = await PP.api.getSetCards('sv1');
  assert.strictEqual(instant[1].p.holofoil, 100, 'yesterday\'s price shown immediately');
  await settle();
  assert.deepStrictEqual(fx.calls, ['id,name,number,rarity,supertype,images,tcgplayer,cardmarket', 'id,tcgplayer,cardmarket'], 'second request asks for prices only');
  assert.deepStrictEqual(heard, [['sv1', 140]]);
  const next = await PP.api.getSetCards('sv1');
  assert.strictEqual(next[1].p.holofoil, 140);
  assert.strictEqual(next[1].n, 'Miraidon ex', 'card details kept from the catalog');
});

test('cache: card details refresh weekly; a known price is never replaced by "no price"', async () => {
  const clock = { t: Date.UTC(2026, 9, 8) };
  let gone = false;
  const fx = legacyFixture((id) => (gone && id === 'sv1-200' ? undefined : 50));
  const PP = load({ fetch: fx.fetch, now: clock });
  await PP.api.getSetCards('sv1');
  gone = true;
  clock.t += 2 * 86400e3;
  await PP.api.getSetCards('sv1');
  await settle();
  assert.strictEqual((await PP.api.getSetCards('sv1'))[1].p.holofoil, 50, 'kept the last known price');
  fx.calls.length = 0;
  clock.t += 8 * 86400e3;
  await PP.api.getSetCards('sv1');
  await settle();
  assert.deepStrictEqual(fx.calls, ['id,name,number,rarity,supertype,images,tcgplayer,cardmarket'], 'full reload after a week');
});

test('cache: TCGdex refreshes rares daily but commons only weekly (one request per card)', async () => {
  const clock = { t: Date.UTC(2026, 9, 8) };
  const rest = [];
  const PP = load({
    now: clock,
    fetch: async (url, init) => {
      if (url.endsWith('/graphql')) {
        const q = JSON.parse(init.body).query;
        if (q.includes('{ sets { id } }')) return ok({ data: { sets: [{ id: 'sv01' }] } });
        return ok({ data: { set: { id: 'sv01', cards: [
          { id: 'sv01-001', localId: '001', name: 'Sprigatito', rarity: 'Common', category: 'Pokemon' },
          { id: 'sv01-002', localId: '002', name: 'Floragato', rarity: 'Uncommon', category: 'Pokemon' },
          { id: 'sv01-244', localId: '244', name: 'Miraidon ex', rarity: 'Hyper rare', category: 'Pokemon' },
        ] } } });
      }
      rest.push(url.split('/').pop());
      return ok({ pricing: { tcgplayer: { holofoil: { marketPrice: 20 }, normal: { marketPrice: 0.1 } } } });
    },
  });
  PP.api.saveSettings({ source: 'tcgdex' });
  // economy.js decides which cards are "slow" (commons/uncommons)
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'economy.js'), 'utf8'), vm.createContext(Object.assign(Object.create(null), { PP })));
  await PP.api.getSetCards('sv1');
  assert.strictEqual(rest.length, 3);
  rest.length = 0;
  clock.t += 25 * 3600e3;
  await PP.api.getSetCards('sv1');
  await settle();
  assert.deepStrictEqual(rest, ['sv01-244'], 'only the rare refreshed after a day');
  rest.length = 0;
  clock.t += 7 * 86400e3; // also past the catalog's week: full reload
  await PP.api.getSetCards('sv1');
  await settle();
  assert.deepStrictEqual(rest.sort(), ['sv01-001', 'sv01-002', 'sv01-244']);
});

test('cache: the old localStorage cache is migrated, not re-downloaded', async () => {
  let calls = 0;
  const PP = load({ fetch: async () => (calls++, fail(500)) });
  const t = Date.now();
  PP.util.store.set('packrush.cache.sets', { t, d: [{ id: 'base1', name: 'Base' }] });
  PP.util.store.set('packrush.cache.cards.base1', { t, d: [{ id: 'base1-4', s: 'base1', n: 'Charizard', no: '4', r: 'Rare Holo', p: { holofoil: 400 } }] });
  const sets = await PP.api.getSets();
  const cards = await PP.api.getSetCards('base1');
  assert.strictEqual(sets[0].id, 'base1');
  assert.strictEqual(cards[0].p.holofoil, 400);
  assert.strictEqual(calls, 0);
  assert.strictEqual(PP.util.store.get('packrush.cache.cards.base1'), null, 'old entry removed');
  assert.strictEqual((await PP.api.cacheStats()).sets, 1);
});

test('cache: an empty set is retried after an hour, not kept for a week', async () => {
  const clock = { t: Date.UTC(2026, 9, 8) };
  let released = false;
  let calls = 0;
  const PP = load({
    now: clock,
    fetch: async () => {
      calls++;
      const data = released ? [{ id: 'me6-1', name: 'New', number: '1', rarity: 'Common', images: {}, tcgplayer: { prices: { normal: { market: 0.1 } } } }] : [];
      return ok({ data, totalCount: data.length });
    },
  });
  assert.strictEqual((await PP.api.getSetCards('me6')).length, 0);
  released = true;
  clock.t += 30 * 60e3;
  assert.strictEqual((await PP.api.getSetCards('me6')).length, 0, 'not hammered within the hour');
  clock.t += 31 * 60e3;
  assert.strictEqual((await PP.api.getSetCards('me6')).length, 1);
  assert.strictEqual(calls, 2);
});

test('graded prices: PSA sales by grade from PokemonPriceTracker, matched to the exact card and cached', async () => {
  const calls = [];
  const charizard = {
    name: 'Charizard', cardNumber: '4/102', setName: 'Base Set',
    ebay: { salesByGrade: { psa10: { count: 84, medianPrice: 30000, smartMarketPrice: { price: 29090.72, confidence: 'high' } }, psa9: { count: 12, medianPrice: 2675 }, psa8: { count: 0, medianPrice: 900 }, cgc9_5: { count: 3, medianPrice: 4000 } } },
  };
  const PP = load({
    fetch: async (url, init) => {
      const u = new URL(url);
      calls.push({ path: u.pathname, q: Object.fromEntries(u.searchParams), auth: init.headers.Authorization });
      return ok({ data: [{ ...charizard, cardNumber: '4/102', setName: 'Base Set 2' }, charizard] });
    },
  });
  const A = PP.api;
  const card = { id: 'base1-4', s: 'base1', n: 'Charizard', no: '4' };
  assert.strictEqual(await A.gradedPrices(card), null, 'nothing without a key');
  assert.strictEqual(calls.length, 0);

  A.saveSettings({ pptKey: 'k123' });
  const g = await A.gradedPrices(card);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(g)), { 10: 29090.72, 9: 2675 }, 'PSA only, sales required, smart price preferred');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].path, '/api/v2/cards');
  assert.strictEqual(calls[0].auth, 'Bearer k123');
  assert.strictEqual(calls[0].q.includeEbay, 'true');
  assert.strictEqual(calls[0].q.search, 'Charizard');

  await A.gradedPrices(card);
  assert.strictEqual(calls.length, 1, 'cached');

  // A TCGplayer id (from TCGdex) gives an exact lookup.
  await A.gradedPrices({ id: 'base1-2', s: 'base1', n: 'Blastoise', no: '2', tpid: 42382 });
  assert.strictEqual(calls[1].q.tcgPlayerId, '42382');

  // No matching number: an empty result, not someone else's prices.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await A.gradedPrices({ id: 'base1-9', s: 'base1', n: 'Charizard', no: '9' }))), {});
});

test('graded prices: out of credits stops further lookups for a while', async () => {
  let n = 0;
  const PP = load({ fetch: async () => (n++, fail(429)) });
  PP.api.saveSettings({ pptKey: 'k' });
  assert.strictEqual(await PP.api.gradedPrices({ id: 'a-1', s: 'a', n: 'A', no: '1' }), null);
  const after = n;
  assert.strictEqual(await PP.api.gradedPrices({ id: 'a-2', s: 'a', n: 'B', no: '2' }), null);
  assert.strictEqual(n, after, 'no more requests');
});

test('graded prices go through the relay URL when one is set, without the key', async () => {
  const calls = [];
  const PP = load({ fetch: async (url, init) => (calls.push({ url, auth: init.headers.Authorization }), ok({ data: [] })) });
  PP.api.saveSettings({ pptKey: 'k', pptProxy: 'https://relay.example.workers.dev/' });
  await PP.api.gradedPrices({ id: 'a-1', s: 'a', n: 'A', no: '1' });
  assert.ok(calls[0].url.startsWith('https://relay.example.workers.dev/cards?'));
  assert.strictEqual(calls[0].auth, undefined);
});
