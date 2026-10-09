// Card grading screens: slabs, the send-for-grading dialog, the queue and the reveal.
(function (root) {
  const PP = root.PP;
  const U = PP.util;
  const E = PP.economy;
  const G = PP.game;
  const h = U.h;
  const ui = () => PP.ui;
  const sfx = () => PP.sfx;

  function setOf(meta) {
    return (PP.api.peekSets() || []).find((s) => s.id === meta.s) || null;
  }

  function eraOf(meta) {
    const set = setOf(meta);
    return E.gradeEra(set && set.date);
  }

  const pct = (p) => (p >= 0.1 ? `${Math.round(p * 100)}%` : p >= 0.01 ? `${(p * 100).toFixed(1)}%` : `${(p * 100).toFixed(1)}%`);

  // A card sealed in a graded case with its label.
  function slabEl(meta, entry, opts = {}) {
    const grade = opts.sealed ? null : entry.g;
    const set = setOf(meta);
    const gradeNum = h('b', null, grade == null ? '?' : String(grade));
    const gradeName = h('span', null, grade == null ? 'Grading' : E.GRADE_NAMES[grade]);
    const el = h(
      'div',
      { class: 'slab' + (grade === 10 ? ' slab--gem' : '') + (opts.sealed ? ' is-sealed' : '') + (opts.small ? ' slab--small' : '') },
      h(
        'div',
        { class: 'slab__label' },
        h('div', { class: 'slab__brand' }, h('b', null, 'PRG'), h('span', null, opts.cert ? `#${opts.cert}` : 'Pack Rush Grading')),
        h('div', { class: 'slab__info' }, h('b', null, meta.n), h('span', null, `${set ? set.name : meta.s} · #${meta.no}`), h('span', null, E.variantLabel(entry.v))),
        h('div', { class: 'slab__grade' }, gradeNum, gradeName)
      ),
      h('div', { class: 'slab__window' }, PP.card.cardEl(meta, { variant: entry.v, interactive: opts.interactive, auto: opts.auto, big: opts.big, eager: opts.eager }))
    );
    el._setGrade = (g) => {
      gradeNum.textContent = String(g);
      gradeName.textContent = E.GRADE_NAMES[g];
      el.classList.remove('is-sealed');
      el.classList.toggle('slab--gem', g === 10);
    };
    return el;
  }

  // "Send for grading": odds, estimated value per grade, fee and turnaround.
  function gradeDialog(entry, onDone, looked) {
    const meta = G.state.meta[entry.id] || entry.meta;
    // Look up real PSA prices once, then redraw with them if anything changed.
    if (!looked && PP.api.gradedPrices) {
      PP.api.gradedPrices(meta).then((pg) => {
        if (pg && Object.keys(pg).length && G.setGraded(meta.id, pg) && document.querySelector('.grade-dialog')) gradeDialog({ ...entry, meta: G.state.meta[meta.id] }, onDone, true);
      });
    }
    const era = eraOf(meta);
    const odds = E.gradeOdds(meta, entry.v, era);
    const ev = E.gradedEV(meta, entry.v, era);
    const maxP = Math.max(...odds.map((o) => o.p));
    const send = (speed) => {
      try {
        const job = G.sendToGrade(entry.key, speed, era);
        sfx().buy();
        ui().closeModal();
        ui().toast(`${meta.n} sent for grading. Ready in ${U.fmtDuration(job.ready - Date.now())}.`, 'good');
        if (onDone) onDone();
      } catch (e) {
        sfx().error();
        ui().toast(e.message, 'bad');
      }
    };
    const speedBtn = (speed, cls) => {
      const fee = E.gradingFee(entry.price, speed);
      const conf = E.GRADING[speed];
      return h(
        'button',
        { class: `btn ${cls}`, 'data-afford': fee, disabled: G.state.money < fee, onclick: () => send(speed) },
        `${conf.label} · ${conf.ms >= PP.HOUR ? '1 hour' : '5 min'}`,
        h('span', { class: 'btn__price' }, U.money(fee))
      );
    };
    ui().openModal(
      h(
        'div',
        { class: 'grade-dialog' },
        h('div', { class: 'grade-dialog__card' }, PP.card.cardEl(meta, { variant: entry.v, interactive: true, big: true })),
        h(
          'div',
          { class: 'grade-dialog__main' },
          h('span', { class: 'eyebrow' }, 'Pack Rush Grading'),
          h('h2', null, `Grade ${meta.n}`),
          h('p', { class: 'muted' }, `${E.variantLabel(entry.v)} · ${E.ERA_LABEL[era]} · raw value ${U.money(entry.price)}`),
          h('h4', null, 'Likely grades'),
          h(
            'div',
            { class: 'godds' },
            odds.map((o) =>
              h(
                'div',
                { class: 'godds__row' + (o.grade === 10 ? ' is-gem' : '') },
                h('b', { class: 'godds__grade' }, String(o.grade)),
                h('span', { class: 'godds__name' }, E.GRADE_NAMES[o.grade]),
                h('span', { class: 'odds-row__bar' }, h('i', { style: `width:${Math.max(1.5, (o.p / maxP) * 100).toFixed(1)}%` })),
                h('span', { class: 'godds__pct' }, pct(o.p)),
                h('b', { class: 'godds__value' }, U.money(o.value))
              )
            )
          ),
          h('div', { class: 'kv' }, h('span', null, 'Average graded value'), h('b', null, U.money(ev))),
          h(
            'p',
            { class: 'muted small' },
            'The card leaves your collection until it comes back in a slab. ',
            meta.g || meta.pg ? `Values use real PSA sale prices${meta.pg && !meta.g ? ' from eBay (via PokemonPriceTracker)' : ''} where available.` : 'Values are estimates of how much more real graded cards sell for than raw ones.',
            ' Vintage cards rarely get a 10, but the ones that do are worth far more.'
          ),
          h('div', { class: 'row wrap grade-dialog__buy' }, speedBtn('standard', 'btn--buy'), speedBtn('express', 'btn--primary'))
        )
      ),
      { wide: true }
    );
  }

  // Cards at the grader, shown at the top of the collection.
  function gradingPanel(onReveal) {
    const jobs = G.gradingJobs();
    if (!jobs.length) return null;
    const now = Date.now();
    const ready = jobs.filter((j) => j.ready <= now);
    return h(
      'section',
      { class: 'panel grading-panel' },
      h(
        'div',
        { class: 'grading-panel__head' },
        h('div', null, h('h3', null, 'At the grader'), h('p', { class: 'muted small' }, `${jobs.length} card${jobs.length > 1 ? 's' : ''}${ready.length ? ` · ${ready.length} ready` : ''}`)),
        ready.length ? h('button', { class: 'btn btn--buy', onclick: () => revealGrades(ready.map((j) => j.uid), onReveal) }, `Reveal ${ready.length > 1 ? `all ${ready.length}` : 'grade'}`) : null
      ),
      h(
        'div',
        { class: 'grading-list' },
        jobs.map((j) => {
          const meta = G.state.meta[j.id] || { n: j.id };
          const done = j.ready <= now;
          return h(
            'div',
            { class: 'grading-item' + (done ? ' is-ready' : '') },
            meta.img ? h('img', { src: meta.img, alt: '', loading: 'lazy' }) : h('div', { class: 'grading-item__ph' }),
            h('div', null, h('b', null, meta.n), h('span', { class: 'muted small' }, `${E.GRADING[j.speed].label} · ${E.variantLabel(j.v)}`)),
            done ? h('span', { class: 'chip chip--new' }, 'Ready') : h('span', { class: 'grading-item__time', 'data-countdown': j.ready }, U.fmtDuration(j.ready - now))
          );
        })
      )
    );
  }

  const TIER_FOR_GRADE = (g) => (g === 10 ? 'SR' : g === 9 ? 'UR' : g === 8 ? 'DR' : 'RH');

  // Full-screen reveal: the slab arrives sealed; tap to show the grade.
  function revealGrades(uids, onClose) {
    const ov = document.getElementById('overlay');
    ov.innerHTML = '';
    ov.className = 'overlay';
    ov.style.setProperty('--h', 210);
    document.body.classList.add('no-scroll');
    const canvas = h('canvas', { class: 'ov-fx' });
    const sub = h('span', null, '');
    const close = () => {
      ov.className = 'overlay hidden';
      ov.innerHTML = '';
      document.body.classList.remove('no-scroll');
      PP.fx.detach();
      document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const stage = h('div', { class: 'ov-stage grade-stage' });
    ov.append(
      h('div', { class: 'ov-bg' }, h('div', { class: 'ov-rays' }), h('div', { class: 'ov-glow' })),
      canvas,
      h('div', { class: 'ov-top' }, h('div', { class: 'ov-title' }, h('b', null, 'Grading results'), sub), h('button', { class: 'btn btn--glass btn--sm', onclick: close }, 'Done')),
      stage
    );
    PP.fx.attach(canvas);
    let i = 0;
    let advance = null;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if ((e.key === ' ' || e.key === 'Enter') && advance) {
        e.preventDefault();
        advance();
      }
    };
    document.addEventListener('keydown', onKey);

    const show = () => {
      let res;
      try {
        res = G.revealGrade(uids[i]);
      } catch {
        return next();
      }
      const meta = G.state.meta[res.id];
      sub.textContent = uids.length > 1 ? `${i + 1} of ${uids.length}` : meta.n;
      ov.classList.remove('is-boost');
      const slab = slabEl(meta, { v: res.v, g: res.grade }, { sealed: true, interactive: true, auto: true, big: true, eager: true, cert: res.cert });
      const info = h('div', { class: 'reveal-info' }, h('div', { class: 'ri-tease' }, 'Your card is back from the grader'), h('div', { class: 'ri-sub' }, 'Tap the slab to reveal the grade'));
      const wrap = h('div', { class: 'grade-reveal' }, slab);
      stage.replaceChildren(wrap, info);
      sfx().drop();
      let revealed = false;
      advance = () => {
        if (revealed) return next();
        revealed = true;
        slab._setGrade(res.grade);
        const tier = TIER_FOR_GRADE(res.grade);
        sfx().reveal(tier);
        const r = slab.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height * 0.12;
        const colors = res.grade >= 9 ? ['#ffd36b', '#ffffff', '#fff2b8', '#ff9ee0', '#79c8ff'] : ['#cfe3ff', '#ffffff'];
        PP.fx.burst(cx, cy, { count: 20 + res.grade * 8, colors, speed: 6 + res.grade, life: 70, size: 3.5, shape: 'star', gravity: 0.04 });
        if (res.grade === 10) PP.fx.confetti(cx, cy, 220);
        if (res.grade >= 8) {
          ov.dataset.boost = tier;
          ov.classList.add('is-boost');
        }
        const raw = E.priceOf(meta, res.v);
        const diff = U.round2(res.price - raw - res.fee);
        info.replaceChildren(
          h('div', { class: 'ri-name' }, `${E.GRADE_NAMES[res.grade]} ${res.grade}`),
          h('div', { class: 'ri-row' }, PP.ui.chip(`Raw ${U.money(raw)}`), PP.ui.chip(`Fee ${U.money(res.fee)}`), PP.ui.chip(`${diff >= 0 ? '+' : '−'}${U.money(Math.abs(diff))}`, diff >= 0 ? 'chip--new' : '')),
          h('div', { class: 'ri-price' }, U.money(res.price)),
          h('div', { class: 'ri-sub' }, i < uids.length - 1 ? 'Tap for the next card' : 'Tap to finish')
        );
      };
      wrap.addEventListener('click', () => advance());
    };
    const next = () => {
      i++;
      if (i >= uids.length) close();
      else show();
    };
    show();
  }

  PP.grading = { slabEl, gradeDialog, gradingPanel, revealGrades, eraOf };
})(typeof window !== 'undefined' ? window : globalThis);
