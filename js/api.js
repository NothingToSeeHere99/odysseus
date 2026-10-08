// Pokémon TCG API client (https://pokemontcg.io) with a localStorage cache.
(function (root) {
  const PP = root.PP;
  const U = PP.util;

  const DEFAULT_BASE = 'https://api.pokemontcg.io/v2';
  const DAY = 24 * PP.HOUR;
  const CACHE_PREFIX = 'packrush.cache.';
  const SETTINGS_KEY = 'packrush.settings';
  const SELECT = 'id,name,number,rarity,supertype,images,tcgplayer,cardmarket';

  function settings() {
    return U.store.get(SETTINGS_KEY, {}) || {};
  }

  function saveSettings(next) {
    U.store.set(SETTINGS_KEY, { ...settings(), ...next });
  }

  function base() {
    return (settings().apiBase || DEFAULT_BASE).replace(/\/+$/, '');
  }

  async function request(path, params) {
    const url = new URL(base() + path);
    for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
    const headers = {};
    const key = settings().apiKey;
    if (key) headers['X-Api-Key'] = key;

    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        const res = await fetch(url, { headers, signal: ctrl.signal });
        if (res.ok) return await res.json();
        lastErr = new Error(`Card API returned ${res.status}`);
        if (res.status !== 429 && res.status < 500) break;
      } catch (e) {
        lastErr = e.name === 'AbortError' ? new Error('Card API timed out') : e;
      } finally {
        clearTimeout(timer);
      }
      await U.sleep(1000 * 2 ** attempt);
    }
    throw lastErr;
  }

  // ---- cache -------------------------------------------------------------

  function cacheEntry(key) {
    return U.store.get(CACHE_PREFIX + key, null);
  }

  function cacheGet(key, ttl) {
    const e = cacheEntry(key);
    return e && Date.now() - e.t < ttl ? e.d : null;
  }

  function evictOldest(except) {
    let oldest = null;
    for (const k of U.store.keys()) {
      if (!k.startsWith(CACHE_PREFIX) || k === CACHE_PREFIX + except || k === CACHE_PREFIX + 'sets') continue;
      const e = U.store.get(k, null);
      if (!oldest || !e || e.t < oldest.t) oldest = { k, t: e ? e.t : 0 };
    }
    if (!oldest) return false;
    U.store.remove(oldest.k);
    return true;
  }

  function cachePut(key, data) {
    const entry = { t: Date.now(), d: data };
    for (let i = 0; i < 40; i++) {
      if (U.store.set(CACHE_PREFIX + key, entry)) return;
      if (!evictOldest(key)) return;
    }
  }

  function clearCache() {
    for (const k of U.store.keys()) if (k.startsWith(CACHE_PREFIX)) U.store.remove(k);
  }

  // ---- compaction: keep only what the game needs -------------------------

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

  // ---- public calls ------------------------------------------------------

  const inflight = new Map();
  function once(key, fn) {
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  async function withStaleFallback(key, ttl, force, load) {
    const fresh = !force && cacheGet(key, ttl);
    if (fresh) return fresh;
    return once(key, async () => {
      try {
        const data = await load();
        cachePut(key, data);
        return data;
      } catch (e) {
        const stale = cacheEntry(key);
        if (stale) return stale.d;
        throw e;
      }
    });
  }

  function getSets(force) {
    return withStaleFallback('sets', DAY, force, async () => {
      const json = await request('/sets', { orderBy: 'releaseDate', pageSize: 250 });
      return json.data.map(compactSet);
    });
  }

  function getSetCards(setId, force) {
    return withStaleFallback('cards.' + setId, DAY, force, async () => {
      const all = [];
      for (let page = 1; page < 10; page++) {
        const json = await request('/cards', { q: `set.id:${setId}`, pageSize: 250, page, select: SELECT });
        all.push(...json.data.map(compactCard));
        if (!json.data.length || all.length >= (json.totalCount || 0)) break;
      }
      return all;
    });
  }

  function peekSetCards(setId) {
    const e = cacheEntry('cards.' + setId);
    return e ? e.d : null;
  }

  async function getCardsByIds(ids) {
    const out = [];
    for (let i = 0; i < ids.length; i += 25) {
      const chunk = ids.slice(i, i + 25);
      const q = '(' + chunk.map((id) => `id:"${id}"`).join(' OR ') + ')';
      const json = await request('/cards', { q, pageSize: 250, select: SELECT });
      out.push(...json.data.map(compactCard));
    }
    return out;
  }

  PP.api = { DEFAULT_BASE, settings, saveSettings, getSets, getSetCards, peekSetCards, getCardsByIds, clearCache, compactCard, compactSet };
})(typeof window !== 'undefined' ? window : globalThis);
