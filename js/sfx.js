// Synthesised sound effects (Web Audio). No audio files to download.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const MUTE_KEY = 'packrush.muted';

  let ctx = null;
  let out = null;
  let noiseBuf = null;
  let muted = !!U.store.get(MUTE_KEY, false);

  function ac() {
    if (muted) return null;
    if (!ctx) {
      const Ctor = root.AudioContext || root.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
      const comp = ctx.createDynamicsCompressor();
      out = ctx.createGain();
      out.gain.value = 0.7;
      out.connect(comp).connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noise(c) {
    if (!noiseBuf) {
      noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return noiseBuf;
  }

  function envelope(g, t, attack, dur, peak) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
  }

  function tone(freq, { type = 'sine', at = 0, dur = 0.15, vol = 0.1, attack = 0.008, slide } = {}) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + attack + dur);
    envelope(g, t, attack, dur, vol);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + attack + dur + 0.05);
  }

  function hiss({ at = 0, dur = 0.3, vol = 0.2, from = 800, to = 3000, type = 'bandpass', q = 1, attack = 0.01 } = {}) {
    const c = ac();
    if (!c) return;
    const t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = noise(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + attack + dur);
    const g = c.createGain();
    envelope(g, t, attack, dur, vol);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + attack + dur + 0.05);
  }

  const NOTES = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568, 2093];

  const sfx = {
    tap() {
      tone(880, { type: 'triangle', dur: 0.05, vol: 0.04 });
    },
    buy() {
      tone(523.25, { type: 'triangle', dur: 0.08, vol: 0.08 });
      tone(783.99, { type: 'triangle', at: 0.07, dur: 0.14, vol: 0.08 });
    },
    coin() {
      tone(987.8, { type: 'square', dur: 0.06, vol: 0.035 });
      tone(1318.5, { type: 'square', at: 0.065, dur: 0.22, vol: 0.035 });
    },
    sell() {
      tone(1318.5, { type: 'triangle', dur: 0.06, vol: 0.05 });
      tone(1760, { type: 'triangle', at: 0.05, dur: 0.12, vol: 0.05 });
    },
    error() {
      tone(196, { type: 'sawtooth', dur: 0.16, vol: 0.04, slide: 150 });
    },
    drop() {
      hiss({ dur: 0.35, vol: 0.12, from: 300, to: 1400, type: 'lowpass', q: 0.7, attack: 0.15 });
      tone(110, { type: 'sine', at: 0.3, dur: 0.18, vol: 0.12, slide: 70 });
    },
    tick() {
      hiss({ dur: 0.03, vol: 0.05, from: 4000, to: 6000, type: 'highpass' });
    },
    tear() {
      hiss({ dur: 0.42, vol: 0.32, from: 700, to: 4200, q: 0.9 });
      hiss({ at: 0.04, dur: 0.3, vol: 0.12, from: 2500, to: 7000, type: 'highpass' });
    },
    deal(i = 0) {
      hiss({ at: i * 0.06, dur: 0.06, vol: 0.06, from: 2600, to: 1800, q: 0.6 });
    },
    swoosh() {
      hiss({ dur: 0.2, vol: 0.12, from: 2200, to: 500, q: 0.7 });
    },
    // Rarer cards get longer, brighter fanfares.
    reveal(tier) {
      const rank = Math.max(0, PP.economy.tierRank(tier) - 3);
      hiss({ dur: 0.18, vol: 0.12, from: 900, to: 3000 });
      const n = 3 + rank;
      for (let i = 0; i < n; i++) {
        tone(NOTES[i % NOTES.length] * (i >= NOTES.length ? 2 : 1), { type: 'triangle', at: 0.08 + i * 0.07, dur: 0.22, vol: 0.07 });
        tone(NOTES[i % NOTES.length] * 2, { type: 'sine', at: 0.1 + i * 0.07, dur: 0.3, vol: 0.025 });
      }
      if (rank >= 3) {
        [523.25, 659.25, 783.99, 1046.5].forEach((f) => tone(f, { type: 'sine', at: 0.1 + n * 0.07, dur: 1.2, vol: 0.04, attack: 0.15 }));
        hiss({ at: 0.1 + n * 0.07, dur: 1.2, vol: 0.05, from: 6000, to: 9000, type: 'highpass', attack: 0.2 });
      }
    },
    get muted() {
      return muted;
    },
    toggle() {
      muted = !muted;
      U.store.set(MUTE_KEY, muted);
      if (!muted) sfx.tap();
      return muted;
    },
  };

  PP.sfx = sfx;
})(typeof window !== 'undefined' ? window : globalThis);
