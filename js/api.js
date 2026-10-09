// Card data client with a localStorage cache.
//
// Three sources produce the same compact card/set format, keyed by Pokémon TCG API ids:
//   - the free Pokémon TCG API (pokemontcg.io), which goes offline on March 1, 2027
//   - TCGdex (tcgdex.net), free and open source; its ids are translated to ours
//   - Scrydex (scrydex.com), the paid successor, reached through the bundled proxy
//     (server/proxy.js keeps the key off the browser) or directly with a key.
// In "auto" mode the free sources are tried first and Scrydex last (first once the
// Pokémon TCG API has shut down, if it's set up).
(function (root) {
  const PP = root.PP;
  const U = PP.util;

  const DEFAULT_BASE = 'https://api.pokemontcg.io/v2';
  const SCRYDEX_BASE = 'https://api.scrydex.com/pokemon/v1';
  const TCGDEX_BASE = 'https://api.tcgdex.net/v2';
  const LEGACY_SUNSET = Date.UTC(2027, 2, 1);
  const DAY = 24 * PP.HOUR;
  const CACHE_PREFIX = 'packrush.cache.';
  const SETTINGS_KEY = 'packrush.settings';
  const SELECT = 'id,name,number,rarity,supertype,images,tcgplayer,cardmarket';
  const SOURCE_LABEL = { legacy: 'Pokémon TCG API', tcgdex: 'TCGdex', scrydex: 'Scrydex' };

  function settings() {
    return U.store.get(SETTINGS_KEY, {}) || {};
  }

  function saveSettings(next) {
    U.store.set(SETTINGS_KEY, { ...settings(), ...next });
    down.clear();
  }

  async function fetchJson(url, headers, { retries = 3, timeout = 45000 } = {}, init = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await fetch(url, { ...init, headers, signal: ctrl.signal });
        if (res.ok) return await res.json();
        lastErr = new Error(`Card API returned ${res.status}`);
        lastErr.status = res.status;
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Card API timed out') : e;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < retries) await U.sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
  }

  function withParams(base, params) {
    const url = new URL(base);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    return url.toString();
  }

  // ---- cache -------------------------------------------------------------
  //
  // Card details (names, numbers, rarities, images) rarely change, so they're kept for a
  // week. Prices change daily, so they're stored separately, per card, and refreshed in
  // the background while the game keeps showing the last known prices. Stored in
  // IndexedDB (no 5 MB limit), falling back to memory if the browser blocks it.

  const CATALOG_TTL = 7 * DAY;
  const PRICE_TTL = DAY;
  const SLOW_PRICE_TTL = 7 * DAY; // commons/uncommons on per-card price sources (TCGdex)

  const store = (() => {
    const mem = new Map();
    let dbp = null;
    function open() {
      if (!dbp) {
        dbp = new Promise((resolve) => {
          try {
            if (!root.indexedDB) return resolve(null);
            const req = root.indexedDB.open('packrush', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('kv');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
            req.onblocked = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
      }
      return dbp;
    }
    function run(db, mode, fn) {
      return new Promise((resolve) => {
        try {
          const tx = db.transaction('kv', mode);
          const req = fn(tx.objectStore('kv'));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = tx.onabort = () => resolve(undefined); // e.g. quota: just don't cache
        } catch {
          resolve(undefined);
        }
      });
    }
    return {
      async get(k) {
        const db = await open();
        const v = db ? await run(db, 'readonly', (s) => s.get(k)) : mem.get(k);
        return v == null ? null : v;
      },
      async set(k, v) {
        const db = await open();
        if (db) await run(db, 'readwrite', (s) => s.put(v, k));
        else mem.set(k, v);
      },
      async keys() {
        const db = await open();
        return db ? (await run(db, 'readonly', (s) => s.getAllKeys())) || [] : [...mem.keys()];
      },
      async clear() {
        const db = await open();
        if (db) await run(db, 'readwrite', (s) => s.clear());
        mem.clear();
      },
    };
  })();

  const priceOnly = (c) => {
    const out = { id: c.id, p: c.p || {} };
    if (c.cm) out.cm = c.cm;
    if (c.cmr) out.cmr = c.cmr;
    if (c.g) out.g = c.g;
    if (c.tpid) out.tpid = c.tpid;
    return out;
  };

  function splitCards(cards, t) {
    const catalog = cards.map(({ p, cm, cmr, g, ...rest }) => rest);
    const prices = {};
    for (const c of cards) prices[c.id] = { ...priceOnly(c), t };
    return { catalog, prices };
  }

  function mergeCards(catalog, prices) {
    return catalog.map((c) => {
      const e = prices[c.id];
      if (!e) return { ...c, p: {} };
      const out = { ...c, p: e.p || {} };
      if (e.cm) out.cm = e.cm;
      if (e.cmr) out.cmr = e.cmr;
      if (e.g) out.g = e.g;
      return out;
    });
  }

  async function saveSet(setId, cards, t = Date.now()) {
    const { catalog, prices } = splitCards(cards, t);
    await store.set('catalog:' + setId, { t, d: catalog });
    await store.set('prices:' + setId, { t, d: prices });
  }

  let memSets = [];
  let ready = null;

  // One-time move of the old localStorage cache into the new store.
  function init() {
    if (!ready) {
      ready = (async () => {
        for (const k of U.store.keys()) {
          if (!k.startsWith(CACHE_PREFIX)) continue;
          const e = U.store.get(k, null);
          const name = k.slice(CACHE_PREFIX.length);
          if (e && e.d && name === 'sets') await store.set('sets', e);
          else if (e && e.d && name.startsWith('cards.')) await saveSet(name.slice(6), e.d, e.t);
          U.store.remove(k);
        }
        const sets = await store.get('sets');
        if (sets) memSets = sets.d;
      })().catch(() => {});
    }
    return ready;
  }

  async function clearCache() {
    await store.clear();
    for (const k of U.store.keys()) if (k.startsWith(CACHE_PREFIX)) U.store.remove(k);
    memSets = [];
  }

  // ---- source 1: Pokémon TCG API (pokemontcg.io) ---------------------------

  function legacyBase() {
    return (settings().apiBase || DEFAULT_BASE).replace(/\/+$/, '');
  }

  function legacyRequest(path, params, opts) {
    const headers = {};
    const key = settings().apiKey;
    if (key) headers['X-Api-Key'] = key;
    return fetchJson(withParams(legacyBase() + path, params), headers, opts);
  }

  function compactSet(s) {
    return {
      id: s.id,
      name: s.name,
      series: s.series,
      total: s.total,
      printed: s.printedTotal,
      date: s.releaseDate,
      logo: s.images && s.images.logo,
      symbol: s.images && s.images.symbol,
    };
  }

  function compactCard(c) {
    const p = {};
    const tp = c.tcgplayer && c.tcgplayer.prices;
    if (tp) {
      for (const [variant, v] of Object.entries(tp)) {
        const price = v && (v.market ?? v.mid ?? v.low);
        if (price != null && price > 0) p[variant] = U.round2(price);
      }
    }
    const cm = c.cardmarket && c.cardmarket.prices;
    const out = {
      id: c.id,
      s: c.id.slice(0, c.id.lastIndexOf('-')),
      n: c.name,
      no: c.number,
      r: c.rarity || '',
      st: c.supertype,
      img: c.images && c.images.small,
      big: c.images && c.images.large,
      p,
    };
    if (cm) {
      const trend = cm.trendPrice || cm.averageSellPrice;
      if (trend) out.cm = U.round2(trend);
      if (cm.reverseHoloTrend) out.cmr = U.round2(cm.reverseHoloTrend);
    }
    return out;
  }

  const legacy = {
    // Read every page: the set list will eventually outgrow a single page.
    async getSets(opts) {
      const all = [];
      const size = 250;
      for (let page = 1; page < 20; page++) {
        const json = await legacyRequest('/sets', { orderBy: 'releaseDate', pageSize: size, page }, opts);
        const data = json.data || [];
        all.push(...data.map(compactSet));
        if (data.length < size || (json.totalCount && all.length >= json.totalCount)) break;
      }
      return all;
    },
    async getSetCards(setId, opts) {
      const all = [];
      for (let page = 1; page < 20; page++) {
        const json = await legacyRequest('/cards', { q: `set.id:${setId}`, pageSize: 250, page, select: SELECT }, opts);
        all.push(...json.data.map(compactCard));
        if (!json.data.length || all.length >= (json.totalCount || 0)) break;
      }
      return all;
    },
    // Prices only: same pages, much smaller responses.
    async getSetPrices(setId, ids, opts) {
      const all = [];
      for (let page = 1; page < 20; page++) {
        const json = await legacyRequest('/cards', { q: `set.id:${setId}`, pageSize: 250, page, select: 'id,tcgplayer,cardmarket' }, opts);
        all.push(...json.data.map((c) => priceOnly(compactCard(c))));
        if (!json.data.length || all.length >= (json.totalCount || 0)) break;
      }
      return all;
    },
    async getCardsByIds(ids, opts) {
      const out = [];
      for (let i = 0; i < ids.length; i += 25) {
        const chunk = ids.slice(i, i + 25);
        const q = '(' + chunk.map((id) => `id:"${id}"`).join(' OR ') + ')';
        const json = await legacyRequest('/cards', { q, pageSize: 250, select: SELECT }, opts);
        out.push(...json.data.map(compactCard));
      }
      return out;
    },
    async ping() {
      await legacyRequest('/sets', { pageSize: 1 }, { retries: 0, timeout: 20000 });
    },
  };

  // ---- source 2: Scrydex --------------------------------------------------

  let proxyProbe = null;

  // Is this page being served by server/proxy.js? Resolves to its health info or null.
  function detectProxy() {
    if (!proxyProbe) {
      proxyProbe = (async () => {
        if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
        try {
          const res = await fetch(new URL('scrydex/health', location.href), { cache: 'no-store' });
          if (!res.ok) return null;
          const json = await res.json();
          return json && json.ok ? json : null;
        } catch {
          return null;
        }
      })();
    }
    return proxyProbe;
  }

  async function scrydexTarget() {
    const s = settings();
    if (s.scrydexProxy) return { base: s.scrydexProxy.replace(/\/+$/, ''), headers: {}, via: 'proxy' };
    const proxy = await detectProxy();
    if (proxy && proxy.configured) return { base: new URL('scrydex', location.href).href, headers: {}, via: 'proxy' };
    if (s.scrydexKey && s.scrydexTeam) return { base: SCRYDEX_BASE, headers: { 'X-Api-Key': s.scrydexKey, 'X-Team-ID': s.scrydexTeam }, via: 'direct' };
    return null;
  }

  async function scrydexRequest(path, params, opts) {
    const t = await scrydexTarget();
    if (!t) throw new Error('Scrydex isn’t set up. Add your key on the Profile tab or run the bundled proxy server.');
    return fetchJson(withParams(t.base + path, params), t.headers, opts);
  }

  // Scrydex variant names → the printing keys the game uses for prices.
  function variantKey(name) {
    const raw = String(name || '');
    const k = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (k === 'normal' || k === 'nonholo' || k === 'regular') return 'normal';
    if (k === 'holofoil' || k === 'holo') return 'holofoil';
    if (k === 'reverseholofoil' || k === 'reverseholo' || k === 'reverse') return 'reverseHolofoil';
    if (k === 'unlimitedholofoil' || k === 'unlimitedholo') return 'unlimitedHolofoil';
    if (k === 'unlimited' || k === 'unlimitednormal') return 'unlimited';
    if (/^(1st|first)edition(holofoil|holo)$/.test(k)) return '1stEditionHolofoil';
    if (/^(1st|first)edition(normal)?$/.test(k)) return '1stEditionNormal';
    return raw.replace(/[_\s-]+(\w)/g, (_, c) => c.toUpperCase());
  }

  function pickImages(images) {
    if (!images) return null;
    if (Array.isArray(images)) return images.find((i) => !i.type || i.type === 'front') || images[0] || null;
    return images;
  }

  // Near-mint, ungraded, USD market price for one variant.
  function variantPrice(v) {
    const list = (v.prices || []).filter((x) => (!x.type || x.type === 'raw') && (!x.currency || x.currency === 'USD'));
    const nm = list.find((x) => !x.condition || /^(nm|near mint)$/i.test(x.condition)) || list[0];
    const price = nm && (nm.market ?? nm.mid ?? nm.low);
    return price > 0 ? U.round2(price) : null;
  }

  function scrydexCard(c) {
    const variants = c.variants || [];
    const img = pickImages(c.images) || variants.map((v) => pickImages(v.images)).find(Boolean) || {};
    const p = {};
    const g = {};
    for (const v of variants) {
      const price = variantPrice(v);
      if (price != null) p[variantKey(v.name)] = price;
      // Real PSA sale prices by grade (Scrydex's higher plans), used for slab values.
      for (const x of v.prices || []) {
        const grade = Number(x.grade);
        const value = x.market ?? x.mid ?? x.low;
        if (x.type === 'graded' && /psa/i.test(x.company || '') && grade >= 1 && grade <= 10 && value > 0 && (!x.currency || x.currency === 'USD') && !g[grade]) g[grade] = U.round2(value);
      }
    }
    const graded = Object.keys(g).length ? { g } : {};
    return {
      ...graded,
      id: c.id,
      s: (c.expansion && c.expansion.id) || c.id.slice(0, c.id.lastIndexOf('-')),
      n: c.name,
      no: c.number,
      r: c.rarity || '',
      st: c.supertype,
      img: img.small || img.medium || img.large,
      big: img.large || img.medium || img.small,
      p,
    };
  }

  function scrydexSet(e) {
    return {
      id: e.id,
      name: e.name,
      series: e.series,
      total: e.total,
      printed: e.printed_total,
      date: e.release_date,
      logo: e.logo || (e.images && e.images.logo),
      symbol: e.symbol || (e.images && e.images.symbol),
    };
  }

  async function scrydexPages(path, params, map, opts) {
    const all = [];
    const size = 100;
    for (let page = 1; page < 40; page++) {
      const json = await scrydexRequest(path, { ...params, page, page_size: size }, opts);
      const data = json.data || [];
      all.push(...data.map(map));
      const total = json.total_count ?? json.totalCount;
      if (data.length < size || (total && page * size >= total)) break;
    }
    return all;
  }

  const scrydex = {
    async getSets(opts) {
      const all = [];
      const size = 100;
      for (let page = 1; page < 40; page++) {
        const json = await scrydexRequest('/en/expansions', { page, page_size: size }, opts);
        const data = json.data || [];
        all.push(...data.filter((e) => !e.is_online_only).map(scrydexSet));
        const total = json.total_count ?? json.totalCount;
        if (data.length < size || (total && page * size >= total)) break;
      }
      return all.sort((a, b) => U.parseDate(a.date) - U.parseDate(b.date));
    },
    getSetCards(setId, opts) {
      return scrydexPages(`/expansions/${encodeURIComponent(setId)}/cards`, { include: 'prices' }, scrydexCard, opts);
    },
    // Prices come with the cards, so this costs the same credits as a full load.
    async getSetPrices(setId, ids, opts) {
      return (await scrydex.getSetCards(setId, opts)).map(priceOnly);
    },
    async getCardsByIds(ids, opts) {
      const out = [];
      try {
        for (let i = 0; i < ids.length; i += 25) {
          const q = ids.slice(i, i + 25).map((id) => `id:"${id}"`).join(' OR ');
          out.push(...(await scrydexPages('/cards', { q, include: 'prices' }, scrydexCard, opts)));
        }
        return out;
      } catch (e) {
        // Fall back to whole sets if multi-id search isn't supported.
        const bySet = {};
        for (const id of ids) (bySet[id.slice(0, id.lastIndexOf('-'))] = bySet[id.slice(0, id.lastIndexOf('-'))] || new Set()).add(id);
        const found = [];
        for (const [setId, want] of Object.entries(bySet)) found.push(...(await scrydex.getSetCards(setId, opts)).filter((c) => want.has(c.id)));
        return found;
      }
    },
    async ping() {
      await scrydexRequest('/en/expansions', { page: 1, page_size: 1 }, { retries: 0, timeout: 20000 });
    },
  };

  // ---- source 3: TCGdex (tcgdex.net) --------------------------------------
  //
  // GraphQL returns a whole set's cards in one request but has no prices, so prices
  // come from the REST card endpoint, one request per card (run in parallel).

  // TCGdex set ids that don't follow the "sv03.5" → "sv3pt5" pattern.
  const TCGDEX_IDS = {
    base6: 'lc', bp: 'bog', cel25c: 'cel25cc', fut20: 'fut2020', hsp: 'hgssp', mcd11: '2011bw', mcd12: '2012bw', mcd14: '2014xy', mcd15: '2015xy',
    mcd16: '2016xy', mcd17: '2017sm', mcd18: '2018sm', mcd19: '2019sm', mcd21: '2021swsh', mcd22: '2022swsh', me55: '30th', me55c: '30th-c',
    pgo: 'swsh10.5', rsv10pt5: 'sv10.5w', sm35: 'sm3.5', sm75: 'sm7.5', swsh35: 'swsh3.5', swsh45: 'swsh4.5', swsh45sv: 'swsh4.5sv',
    tk1a: 'tk-ex-latia', tk1b: 'tk-ex-latio', tk2a: 'tk-ex-p', tk2b: 'tk-ex-m', zsv10pt5: 'sv10.5b',
  };
  const FROM_TCGDEX = Object.fromEntries(Object.entries(TCGDEX_IDS).map(([ours, theirs]) => [theirs, ours]));
  // Digital-only (TCG Pocket), oversized, sample or duplicate listings.
  const TCGDEX_SKIP_SERIES = new Set(['tcgp']);
  const TCGDEX_SKIP_SETS = new Set(['jumbo', 'miscp', 'sp', 'ex5.5', 'xya', 'wp', 'mfb', 'mee', 'rc']);

  // "sv03.5" → "sv3pt5", "me01" → "me1", "swsh12.5gg" → "swsh12pt5gg"
  function fromTcgdexSet(id) {
    return FROM_TCGDEX[id] || id.replace(/([a-z])0+(?=\d)/g, '$1').replace(/\./g, 'pt');
  }

  // "001" → "1"; "TG01", "SV001", "SWSH050" stay as printed.
  function fromTcgdexNumber(localId) {
    return /^\d+$/.test(localId) ? String(parseInt(localId, 10)) : localId;
  }

  async function tcgdexBase() {
    const proxy = await detectProxy();
    if (proxy && proxy.tcgdex) return new URL('tcgdex', location.href).href;
    return TCGDEX_BASE;
  }

  async function tcgdexGraphql(query, opts) {
    const base = await tcgdexBase();
    const json = await fetchJson(base + '/graphql', { 'Content-Type': 'application/json' }, opts, { method: 'POST', body: JSON.stringify({ query }) });
    if (json.errors && json.errors.length && !json.data) throw new Error('TCGdex: ' + json.errors[0].message);
    return json.data || {};
  }

  // Shared limit so a few sets loading at once don't flood TCGdex.
  let tcgdexActive = 0;
  const tcgdexQueue = [];
  function tcgdexSlot() {
    if (tcgdexActive < 10) {
      tcgdexActive++;
      return Promise.resolve();
    }
    return new Promise((r) => tcgdexQueue.push(r));
  }
  function tcgdexDone() {
    const next = tcgdexQueue.shift();
    if (next) next();
    else tcgdexActive--;
  }

  async function tcgdexPricing(cardId, opts) {
    const base = await tcgdexBase();
    await tcgdexSlot();
    try {
      const card = await fetchJson(`${base}/en/cards/${encodeURIComponent(cardId)}`, {}, { retries: 1, timeout: 30000, ...opts });
      return card.pricing || null;
    } catch {
      return undefined; // failed: keep whatever price we already had
    } finally {
      tcgdexDone();
    }
  }

  function tcgdexCard(c, setId, pricing) {
    const no = fromTcgdexNumber(String(c.localId));
    const p = {};
    const out = {
      id: `${setId}-${no}`,
      s: setId,
      n: c.name,
      no,
      r: c.rarity && c.rarity !== 'None' ? c.rarity : '',
      st: c.category === 'Pokemon' ? 'Pokémon' : c.category,
      img: c.image ? c.image + '/low.webp' : undefined,
      big: c.image ? c.image + '/high.webp' : undefined,
      p,
    };
    const tp = pricing && pricing.tcgplayer;
    if (tp) {
      for (const [k, v] of Object.entries(tp)) {
        if (!v || typeof v !== 'object') continue;
        const price = v.marketPrice ?? v.midPrice ?? v.lowPrice;
        if (price > 0) p[variantKey(k)] = U.round2(price);
        if (v.productId && !out.tpid) out.tpid = v.productId; // TCGplayer's id, for graded price lookups
      }
    }
    const cm = pricing && pricing.cardmarket;
    if (cm) {
      const trend = cm.trend || cm.avg;
      if (trend) out.cm = U.round2(trend);
      if (cm['trend-holo']) out.cmr = U.round2(cm['trend-holo']);
    }
    return out;
  }

  function tcgdexSet(t) {
    const ext = (u) => (u ? u + '.png' : undefined);
    return {
      id: fromTcgdexSet(t.id),
      name: t.name,
      series: t.serie && t.serie.name,
      total: t.cardCount && t.cardCount.total,
      printed: t.cardCount && t.cardCount.official,
      date: t.releaseDate,
      logo: ext(t.logo),
      symbol: ext(t.symbol),
    };
  }

  let tcgdexIdCache = null;
  // Our set id → TCGdex set id, using the explicit table, then TCGdex's own list.
  async function toTcgdexSet(id, opts) {
    if (TCGDEX_IDS[id]) return TCGDEX_IDS[id];
    if (!tcgdexIdCache) {
      tcgdexIdCache = tcgdexGraphql('{ sets { id } }', opts)
        .then((d) => Object.fromEntries((d.sets || []).filter(Boolean).map((x) => [fromTcgdexSet(x.id), x.id])))
        .catch((e) => {
          tcgdexIdCache = null;
          throw e;
        });
    }
    return (await tcgdexIdCache)[id] || id;
  }

  // TCGdex's card list for a set (gives the exact ids its price endpoint needs).
  const tcgdexLists = new Map();
  function tcgdexSetCardListCached(setId, opts) {
    if (!tcgdexLists.has(setId)) {
      const p = tcgdexSetCardList(setId, opts);
      p.catch(() => tcgdexLists.delete(setId));
      tcgdexLists.set(setId, p);
    }
    return tcgdexLists.get(setId);
  }

  async function tcgdexSetCardList(setId, opts) {
    const tid = await toTcgdexSet(setId, opts);
    const data = await tcgdexGraphql(`{ set(filters: { id: ${JSON.stringify('eq:' + tid)} }) { id cards { id localId name rarity category image } } }`, opts);
    if (!data.set || data.set.id !== tid) throw new Error(`TCGdex has no set ${tid}`);
    return (data.set.cards || []).filter(Boolean);
  }

  const tcgdex = {
    async getSets(opts) {
      const data = await tcgdexGraphql('{ sets { id name logo symbol releaseDate serie { id name } cardCount { total official } } }', opts);
      if (!data.sets || !data.sets.length) throw new Error('TCGdex returned no sets');
      return data.sets
        .filter((t) => t && t.releaseDate && !TCGDEX_SKIP_SETS.has(t.id) && !(t.serie && TCGDEX_SKIP_SERIES.has(t.serie.id)))
        .map(tcgdexSet)
        .sort((a, b) => U.parseDate(a.date) - U.parseDate(b.date));
    },
    async getSetCards(setId, opts) {
      const list = await tcgdexSetCardList(setId, opts);
      if (!list.length) throw new Error(`TCGdex has no cards for ${setId}`);
      tcgdexLists.set(setId, Promise.resolve(list));
      const prices = await Promise.all(list.map((c) => tcgdexPricing(c.id, opts)));
      return list.map((c, i) => tcgdexCard(c, setId, prices[i]));
    },
    // One request per card, so only the cards that are due get refreshed.
    async getSetPrices(setId, ids, opts) {
      const want = new Set(ids);
      const list = (await tcgdexSetCardListCached(setId, opts)).filter((c) => want.has(`${setId}-${fromTcgdexNumber(String(c.localId))}`));
      const prices = await Promise.all(list.map((c) => tcgdexPricing(c.id, opts)));
      return list.map((c, i) => (prices[i] === undefined ? null : priceOnly(tcgdexCard(c, setId, prices[i])))).filter(Boolean);
    },
    async getCardsByIds(ids, opts) {
      const bySet = {};
      for (const id of ids) {
        const setId = id.slice(0, id.lastIndexOf('-'));
        (bySet[setId] = bySet[setId] || new Set()).add(id);
      }
      const out = [];
      for (const [setId, want] of Object.entries(bySet)) {
        const list = (await tcgdexSetCardListCached(setId, opts)).filter((c) => want.has(`${setId}-${fromTcgdexNumber(String(c.localId))}`));
        const prices = await Promise.all(list.map((c) => tcgdexPricing(c.id, opts)));
        out.push(...list.map((c, i) => (prices[i] === undefined ? null : tcgdexCard(c, setId, prices[i]))).filter(Boolean));
      }
      return out;
    },
    async ping() {
      await tcgdexGraphql('{ sets(pagination: { page: 1, itemsPerPage: 1 }) { id } }', { retries: 0, timeout: 20000 });
    },
  };

  // ---- source selection --------------------------------------------------

  const SOURCES = { legacy, tcgdex, scrydex };
  const MODE_SOURCE = { pokemontcg: 'legacy', tcgdex: 'tcgdex', scrydex: 'scrydex' };
  const down = new Set(); // sources that failed this session while a later one worked
  let lastSource = null;

  // Auto: free sources before Scrydex (paid). Once the Pokémon TCG API has shut down,
  // a configured Scrydex takes over with TCGdex as the free backup.
  async function sourceOrder() {
    const mode = settings().source || 'auto';
    if (MODE_SOURCE[mode]) return [MODE_SOURCE[mode]];
    const sx = (await scrydexTarget()) ? ['scrydex'] : [];
    const order = Date.now() >= LEGACY_SUNSET ? [...sx, 'tcgdex'] : ['legacy', 'tcgdex', ...sx];
    // Sources that already failed this session go last instead of being retried first.
    return [...order.filter((n) => !down.has(n)), ...order.filter((n) => down.has(n))];
  }

  async function call(method, ...args) {
    const order = await sourceOrder();
    let err;
    for (let i = 0; i < order.length; i++) {
      const name = order[i];
      // Give up on the first source quickly when there's another to try.
      const opts = i < order.length - 1 ? { retries: 1, timeout: 25000 } : undefined;
      try {
        const result = await SOURCES[name][method](...args, opts);
        order.slice(0, i).forEach((n) => down.add(n));
        down.delete(name);
        lastSource = name;
        return result;
      } catch (e) {
        err = e;
      }
    }
    throw err;
  }

  // ---- public calls ------------------------------------------------------

  const inflight = new Map();
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // Refresh without making anyone wait; failures just keep the cached data.
  function background(key, fn) {
    if (inflight.has(key)) return;
    once(key, fn).catch(() => {});
  }

  const priceListeners = new Set();
  function onPrices(fn) {
    priceListeners.add(fn);
  }
  function notify(setId, cards) {
    priceListeners.forEach((fn) => {
      try {
        fn(setId, cards);
      } catch {}
    });
  }

  async function loadSets() {
    const d = await call('getSets');
    await store.set('sets', { t: Date.now(), d });
    memSets = d;
    return d;
  }

  async function getSets(force) {
    await init();
    const e = await store.get('sets');
    if (e && !force) {
      memSets = e.d;
      if (Date.now() - e.t > DAY) background('sets', loadSets); // pick up newly released sets
      return e.d;
    }
    try {
      return await once('sets', loadSets);
    } catch (err) {
      if (e) return e.d;
      throw err;
    }
  }

  async function loadSet(setId) {
    const cards = await call('getSetCards', setId);
    await saveSet(setId, cards);
    notify(setId, cards);
    return cards;
  }

  function isSlowCard(card) {
    const E = PP.economy;
    return !!E && E.tierRank(E.tierOf(card)) < E.tierRank('R');
  }

  // Refresh the prices that are due. Rares and up are due daily; commons and uncommons
  // weekly (only matters for TCGdex, where each price is a separate request).
  async function loadPrices(setId, catalog, prev) {
    const now = Date.now();
    const due = catalog
      .filter((c) => {
        const e = prev[c.id];
        if (!e) return true;
        return now - (e.t || 0) > (isSlowCard({ ...c, ...e }) ? SLOW_PRICE_TTL : PRICE_TTL);
      })
      .map((c) => c.id);
    const next = { ...prev };
    if (due.length) {
      const fresh = await call('getSetPrices', setId, due);
      for (const x of fresh) {
        const old = next[x.id];
        // Never replace a known price with "no price" (gaps differ between sources).
        const keep = old && Object.keys(old.p || {}).length && !Object.keys(x.p || {}).length;
        next[x.id] = keep ? { ...old, t: now } : { ...x, t: now };
      }
    }
    await store.set('prices:' + setId, { t: now, d: next });
    const cards = mergeCards(catalog, next);
    notify(setId, cards);
    return cards;
  }

  // Cached card details and prices come back immediately; anything stale refreshes in the
  // background (onPrices listeners hear about it). Only a set never seen before waits.
  async function getSetCards(setId, force) {
    await init();
    const [cat, pr] = await Promise.all([store.get('catalog:' + setId), store.get('prices:' + setId)]);
    // An empty set (e.g. just released, cards not added yet) is retried after an hour.
    const emptyAndOld = cat && !cat.d.length && Date.now() - cat.t > PP.HOUR;
    if (!cat || force || emptyAndOld) {
      try {
        return await once('set:' + setId, () => loadSet(setId));
      } catch (e) {
        if (cat) return mergeCards(cat.d, pr ? pr.d : {});
        throw e;
      }
    }
    const now = Date.now();
    if (!pr) return once('prices:' + setId, () => loadPrices(setId, cat.d, {}));
    if (now - cat.t > CATALOG_TTL) background('set:' + setId, () => loadSet(setId));
    else if (now - pr.t > PRICE_TTL) background('prices:' + setId, () => loadPrices(setId, cat.d, pr.d));
    return mergeCards(cat.d, pr.d);
  }

  // Fresh prices for specific (owned) cards; also updates the set price caches.
  async function getCardsByIds(ids) {
    await init();
    const cards = await call('getCardsByIds', ids);
    const now = Date.now();
    const bySet = {};
    for (const c of cards) (bySet[c.s] = bySet[c.s] || []).push(c);
    for (const [setId, list] of Object.entries(bySet)) {
      const pr = (await store.get('prices:' + setId)) || { t: 0, d: {} };
      for (const c of list) pr.d[c.id] = { ...priceOnly(c), t: now };
      await store.set('prices:' + setId, pr);
    }
    return cards;
  }

  // TCGdex's scan of a card, for when the main source only has a placeholder picture.
  async function altImage(card) {
    if (!card || !card.id || /tcgdex\.net/.test(card.img || '')) return null;
    try {
      const setId = card.s || card.id.slice(0, card.id.lastIndexOf('-'));
      const list = await tcgdexSetCardListCached(setId);
      const hit = list.find((c) => `${setId}-${fromTcgdexNumber(String(c.localId))}` === card.id);
      return hit && hit.image ? { img: hit.image + '/low.webp', big: hit.image + '/high.webp' } : null;
    } catch {
      return null;
    }
  }

  // ---- graded prices: PokemonPriceTracker ----------------------------------
  //
  // Real PSA sale prices (from eBay) by grade. Only looked up for cards being graded or
  // already in a slab, and kept for a week, because the free plan allows 100 credits a
  // day (about 2 per lookup). Reached through the bundled server (key kept there) or
  // straight from the browser with a key saved on the Profile tab.

  const PPT_BASE = 'https://www.pokemonpricetracker.com/api/v2';
  const GRADED_TTL = 7 * DAY;
  const GRADED_MISS_TTL = DAY;
  const gradedPending = new Map();
  let pptBlockedUntil = 0;

  async function pptTarget() {
    const s = settings();
    const proxy = await detectProxy();
    if (proxy && proxy.ppt) return { base: new URL('ppt', location.href).href, headers: {}, via: 'proxy' };
    if (s.pptKey) return { base: PPT_BASE, headers: { Authorization: 'Bearer ' + s.pptKey }, via: 'direct' };
    return null;
  }

  async function pptRequest(params, opts) {
    const t = await pptTarget();
    if (!t) throw new Error('Not set up');
    return fetchJson(withParams(t.base + '/cards', params), t.headers, { retries: 1, timeout: 20000, ...opts });
  }

  const num = (x) => (typeof x === 'number' ? x : x && typeof x === 'object' ? x.price ?? x.value ?? null : Number(x) || null);

  // { 10: price, 9: price, ... } from one result's eBay sales by grade (PSA only).
  function pptGrades(card) {
    const by = card && card.ebay && (card.ebay.salesByGrade || card.ebay.grades);
    const out = {};
    if (!by) return out;
    for (const [key, v] of Object.entries(by)) {
      const m = /^psa[\s_-]?(\d+)$/i.exec(key);
      if (!m || !v) continue;
      const grade = Number(m[1]);
      if (grade < 1 || grade > 10 || (v.count != null && v.count < 1)) continue;
      const price = num(v.smartMarketPrice) ?? num(v.medianPrice) ?? num(v.averagePrice) ?? num(v.price);
      if (price > 0) out[grade] = U.round2(price);
    }
    return out;
  }

  const digits = (x) => String(x || '').split('/')[0].replace(/^0+/, '').toLowerCase();
  const loose = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  // The result that is this exact card: same number, and the same set when the result names one.
  function pptMatch(results, card, setName) {
    const list = Array.isArray(results) ? results : results ? [results] : [];
    const sameNo = list.filter((r) => digits(r.cardNumber ?? r.number) === digits(card.no));
    const sameSet = sameNo.filter((r) => {
      const name = loose(r.setName || (r.set && r.set.name) || '');
      return !name || !setName || name.includes(loose(setName)) || loose(setName).includes(name);
    });
    return sameSet[0] || (list.length === 1 && card.tpid ? list[0] : null);
  }

  async function lookupGraded(card) {
    if (card.tpid) {
      const json = await pptRequest({ tcgPlayerId: card.tpid, includeEbay: 'true', limit: 1 });
      const hit = pptMatch(json.data, card, null) || (Array.isArray(json.data) ? json.data[0] : json.data);
      if (hit) return pptGrades(hit);
    }
    const set = (memSets || []).find((x) => x.id === (card.s || card.id.slice(0, card.id.lastIndexOf('-'))));
    const params = { search: card.n, includeEbay: 'true', limit: 5 };
    if (set) params.setName = set.name;
    const json = await pptRequest(params);
    const hit = pptMatch(json.data, card, set && set.name);
    return hit ? pptGrades(hit) : {};
  }

  // Resolves { grade: price } (possibly empty), or null when no lookup could be made.
  async function gradedPrices(card, { force = false } = {}) {
    if (!card || !card.id) return null;
    await init();
    const key = 'graded:' + card.id;
    const hit = await store.get(key);
    const now = Date.now();
    if (hit && !force && now - hit.t < (Object.keys(hit.g).length ? GRADED_TTL : GRADED_MISS_TTL)) return hit.g;
    if (now < pptBlockedUntil || !(await pptTarget())) return hit ? hit.g : null;
    if (!gradedPending.has(card.id)) {
      const p = lookupGraded(card)
        .then(async (g) => {
          await store.set(key, { g, t: Date.now() });
          return g;
        })
        .catch((e) => {
          // Out of credits, bad key or blocked: stop asking for a while.
          if (e.status === 401 || e.status === 403 || e.status === 429 || e instanceof TypeError) pptBlockedUntil = Date.now() + (e.status === 429 ? 6 : 1) * PP.HOUR;
          return hit ? hit.g : null;
        })
        .finally(() => gradedPending.delete(card.id));
      gradedPending.set(card.id, p);
    }
    return gradedPending.get(card.id);
  }

  async function testGraded() {
    if (!(await pptTarget())) return { ok: false, error: 'Not set up' };
    try {
      const json = await pptRequest({ search: 'Charizard', setName: 'Base Set', includeEbay: 'true', limit: 1 }, { retries: 0 });
      const g = pptGrades(Array.isArray(json.data) ? json.data[0] : json.data);
      return { ok: true, note: g[10] ? `PSA 10 Base Set Charizard: $${g[10].toLocaleString()}` : 'Connected' };
    } catch (e) {
      return { ok: false, error: e instanceof TypeError ? 'Blocked by the browser. Use the bundled server instead.' : e.message || String(e) };
    }
  }

  function peekSets() {
    return memSets;
  }

  async function cacheStats() {
    await init();
    const keys = (await store.keys()).filter((k) => String(k).startsWith('catalog:'));
    let cards = 0;
    let oldestPrice = null;
    for (const k of keys) {
      const cat = await store.get(k);
      const pr = await store.get('prices:' + String(k).slice(8));
      if (cat) cards += cat.d.length;
      if (pr && (oldestPrice == null || pr.t < oldestPrice)) oldestPrice = pr.t;
    }
    let bytes = null;
    try {
      if (root.navigator && navigator.storage && navigator.storage.estimate) bytes = (await navigator.storage.estimate()).usage;
    } catch {}
    return { sets: keys.length, cards, oldestPrice, bytes };
  }

  // Check each source once (Scrydex costs one credit).
  async function testSources() {
    const out = {};
    for (const name of ['legacy', 'tcgdex', 'scrydex']) {
      if (name === 'scrydex' && !(await scrydexTarget())) {
        out[name] = { ok: false, error: 'Not set up' };
        continue;
      }
      try {
        await SOURCES[name].ping();
        out[name] = { ok: true };
      } catch (e) {
        out[name] = { ok: false, error: e.message || String(e) };
      }
    }
    return out;
  }

  async function status() {
    const t = await scrydexTarget();
    const proxy = await detectProxy();
    const g = await pptTarget();
    return { mode: settings().source || 'auto', graded: g ? g.via : null, scrydex: t ? t.via : null, tcgdexViaProxy: !!(proxy && proxy.tcgdex), lastSource, down: [...down], sunset: LEGACY_SUNSET };
  }

  PP.api = {
    DEFAULT_BASE,
    SCRYDEX_BASE,
    LEGACY_SUNSET,
    SOURCE_LABEL,
    settings,
    saveSettings,
    getSets,
    getSetCards,
    peekSets,
    getCardsByIds,
    onPrices,
    cacheStats,
    altImage,
    gradedPrices,
    testGraded,
    pptGrades,
    pptMatch,
    clearCache,
    testSources,
    status,
    detectProxy,
    compactCard,
    compactSet,
    scrydexCard,
    scrydexSet,
    tcgdexCard,
    tcgdexSet,
    fromTcgdexSet,
    variantKey,
  };
})(typeof window !== 'undefined' ? window : globalThis);
