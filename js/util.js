// Shared helpers: seeded randomness, formatting, storage and a tiny DOM builder.
(function (root) {
  const PP = (root.PP = root.PP || {});
  const HOUR = 3600 * 1000;

  // Small, fast seeded PRNG so every player sees the same shop rotation.
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function money(n) {
    const sign = n < 0 ? '-' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function fmtDuration(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0 ? `${h}h ${pad(m)}m` : `${m}:${pad(s)}`;
  }

  // API dates look like "1999/01/09".
  function parseDate(d) {
    const [y, m, day] = String(d || '').split(/[/-]/).map(Number);
    return Date.UTC(y || 2000, (m || 1) - 1, day || 1);
  }

  function yearOf(d) {
    return new Date(parseDate(d)).getUTCFullYear();
  }

  // Card numbers mix digits and prefixes ("4", "TG01", "SV107", "12a").
  function cmpNum(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  function pickWeighted(rng, entries) {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = rng() * total;
    for (const [item, w] of entries) {
      r -= w;
      if (r < 0) return item;
    }
    return entries[entries.length - 1][0];
  }

  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // localStorage can throw (private mode, quota), so every access is guarded.
  const store = {
    get(key, fallback = null) {
      try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
    keys() {
      try {
        return Object.keys(localStorage);
      } catch {
        return [];
      }
    },
  };

  // h('div', {class: 'x', onclick: fn}, child, 'text', [more])
  function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) c.forEach(add);
      else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return el;
  }

  PP.HOUR = HOUR;
  PP.util = { mulberry32, hashStr, round2, clamp, money, fmtDuration, parseDate, yearOf, cmpNum, pickWeighted, shuffle, sleep, store, h };
})(typeof window !== 'undefined' ? window : globalThis);
