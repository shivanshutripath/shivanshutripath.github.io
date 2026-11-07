/* recommendation.js: the explorer of the "Recommendation systems" section (#rec-explorer).
 *
 * Reads window.RESULTS.REC (data/recommendation.js, written by
 * recommendation_demo/make_website_data.py) and shows, for the typical or the contrast
 * user of a region on an example day:
 *   - the backbone of the eight regional servers (click or press Enter on a server to pick
 *     its region);
 *   - the user, the region's known average interests, and on how many days of the metric
 *     window the user's first screen was not the ideal one under each method;
 *   - the first screen (top 8 of 32 products) under the ideal boosts x*(t), the boosts of the
 *     region's server with cooperative and with local identification, frozen boosts and no
 *     boosts; products that are not on the ideal first screen are outlined;
 *   - one tick per day after the data stop on which the first screen differed from the
 *     ideal one (click the strip to jump to the nearest example day).
 * No libraries. The page's KaTeX pass skips this mount, so the text is plain HTML. */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;

  const NS = 'http://www.w3.org/2000/svg';
  const MINUS = '−';
  const GENRE_VAR = ['var(--rx-outdoor)', 'var(--rx-home)', 'var(--rx-tech)', 'var(--rx-essentials)'];
  const GENRE_SHORT = ['outdoor', 'home', 'tech'];
  const METHODS = [
    { key: 'ideal', label: 'Ideal', color: 'var(--rx-ideal)', math: true, sr: 'under the ideal boosts' },
    { key: 'coop3', label: 'Together', color: 'var(--rx-coop)', sr: 'with cooperative identification' },
    { key: 'local', label: 'Alone', color: 'var(--rx-local)', sr: 'with local identification' },
    { key: 'frozen', label: 'Frozen boosts', color: 'var(--rx-frozen)', sr: 'with the boosts of the last day with data' },
    { key: 'noboost', label: 'No boosts', color: 'var(--rx-pers)', sr: 'without boosts' },
  ];
  const STRIP = [
    { key: 'coop3', label: 'Together', color: 'var(--rx-coop)' },
    { key: 'local', label: 'Alone', color: 'var(--rx-local)' },
    { key: 'frozen', label: 'Frozen boosts', color: 'var(--rx-frozen)' },
  ];

  function el(tag, attrs, parent, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  const signed = (v) => (v < 0 ? MINUS : '+') + Math.abs(v).toFixed(2);
  const two = (v) => v.toFixed(2).replace('-', MINUS);
  // "x*(t)" as text with italics
  function xstar(parent) {
    const m = el('span', { class: 'rx-math' }, parent);
    if (window.katex && window.katex.render) {      // the page's typesetting, as everywhere else
      try { window.katex.render('x^\\star(t)', m, { throwOnError: true }); m.classList.add('is-katex'); return m; } catch (e) { m.replaceChildren(); }
    }
    el('i', null, m, 'x');
    el('sup', null, m, '⋆');
    m.appendChild(document.createTextNode('('));
    el('i', null, m, 't');
    m.appendChild(document.createTextNode(')'));
    return m;
  }

  function init() {
    const mount = document.getElementById('rec-explorer');
    if (!mount || mount.__rx) return;
    mount.__rx = true;
    const R = window.RESULTS && window.RESULTS.REC;
    if (!R || !R.users || !R.users.length) {
      el('p', { class: 'rx-error' }, mount, 'The data of this explorer did not load.');
      return;
    }
    const N = R.trial.N, W0 = R.trial.window[0], W1 = R.trial.window[1];
    const regionOf = (code) => R.regions.find((r) => r.code === code);
    const userOf = (code, kind) => R.users.find((u) => u.region === code && u.kind === kind);
    const defaultDay = (u) => (u.first >= 0 && u.feedDays.indexOf(u.first) >= 0 ? u.first
      : u.feedDays.indexOf(W0) >= 0 ? W0 : u.feedDays[u.feedDays.length - 1]);
    const start = userOf('EU', 'contrast') ? 'EU' : R.regions[0].code;
    const state = { region: start, kind: 'contrast', day: null };
    state.day = defaultDay(userOf(state.region, state.kind));

    // ------------------------------------------------------------ controls
    const ctr = el('div', { class: 'rx-controls', role: 'group', 'aria-label': 'Choose a region, a user and a day' }, mount);
    const fRegion = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-region' }, fRegion, 'Region');
    const regionChips = el('div', { class: 'rx-chips', role: 'group', 'aria-labelledby': 'rx-l-region' }, fRegion);
    for (const r of R.regions) {
      const b = el('button', { type: 'button', class: 'rx-chip', 'data-region': r.code, title: r.name + ' (' + r.hub + ')' }, regionChips, r.code);
      b.addEventListener('click', () => pickRegion(r.code));
    }
    const fUser = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-user' }, fUser, 'User');
    const userChips = el('div', { class: 'rx-chips', role: 'group', 'aria-labelledby': 'rx-l-user' }, fUser);
    for (const [kind, lab] of [['typical', 'Typical user'], ['contrast', 'Contrast user']]) {
      const b = el('button', { type: 'button', class: 'rx-chip', 'data-kind': kind }, userChips, lab);
      b.addEventListener('click', () => { state.kind = kind; state.day = defaultDay(userOf(state.region, kind)); render(); });
    }
    const fDay = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-day' }, fDay, 'Day');
    const dayChips = el('div', { class: 'rx-days', role: 'group', 'aria-labelledby': 'rx-l-day' }, fDay);
    el('p', { class: 'rx-hint' }, fDay, 'Data until day ' + (N - 1) + '; the metric window is days ' + W0 + '–' + W1 + '.');

    function pickRegion(code) {
      state.region = code;
      state.day = defaultDay(userOf(code, state.kind));
      render();
    }

    // ------------------------------------------------------------ the backbone and the user
    const top = el('div', { class: 'rx-top' }, mount);
    const map = el('figure', { class: 'rx-map' }, top);
    el('p', { class: 'rx-panel-title' }, map, 'Eight regional servers on a sparse backbone');
    const VW = 400, VH = 252, cx = 200, cy = 126, RR = 88;
    const msvg = sv('svg', { viewBox: '0 0 ' + VW + ' ' + VH, role: 'group', 'aria-label': 'The backbone: each server talks only to its neighbors. Pick a server to see its region.' }, map);
    const pos = {};
    for (const r of R.regions) {
      const a = (22.5 + 45 * (r.server - 1)) * Math.PI / 180;
      pos[r.code] = { x: cx + RR * Math.cos(a), y: cy - RR * Math.sin(a), a };
    }
    for (const [a, b, kind] of R.links) {
      if (!pos[a] || !pos[b]) continue;
      sv('line', { class: 'rx-link' + (kind === 'chord' ? ' is-chord' : ''), x1: pos[a].x.toFixed(1), y1: pos[a].y.toFixed(1), x2: pos[b].x.toFixed(1), y2: pos[b].y.toFixed(1) }, msvg);
    }
    const nodes = {};
    for (const r of R.regions) {
      const p = pos[r.code];
      const g = sv('g', { class: 'rx-node', role: 'button', tabindex: '0', 'aria-label': 'Server ' + r.server + ', ' + r.name + ' (' + r.hub + ')', transform: 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')' }, msvg);
      sv('circle', { r: 17 }, g);
      sv('text', { 'text-anchor': 'middle', dy: '0.36em' }, g, r.code);
      const c = Math.cos(p.a), s = Math.sin(p.a);
      sv('text', { class: 'rx-city', x: (28 * c).toFixed(1), y: (-28 * s + 3.5).toFixed(1), 'text-anchor': c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle' }, g, r.hub);
      g.addEventListener('click', () => pickRegion(r.code));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickRegion(r.code); } });
      nodes[r.code] = g;
    }
    const ml = el('ul', { class: 'rx-map-legend' }, map);
    el('i', null, el('li', null, ml)).after(document.createTextNode('ring link'));
    el('i', { class: 'is-chord' }, el('li', null, ml)).after(document.createTextNode('long-haul link'));

    const card = el('div', { class: 'rx-user', 'aria-live': 'polite' }, top);

    // ------------------------------------------------------------ first screens and strip
    const fp = el('div', { class: 'rx-feeds-panel' }, mount);
    const fTitle = el('p', { class: 'rx-panel-title' }, fp);
    const feeds = el('div', { class: 'rx-feeds' }, fp);
    const lg = el('ul', { class: 'rx-legend' }, fp);
    R.genres.forEach((g, k) => {
      const li = el('li', null, lg);
      el('span', { class: 'rx-gkey', style: 'background:' + GENRE_VAR[k] }, li);
      li.appendChild(document.createTextNode(g));
    });
    { const li = el('li', null, lg); el('span', { class: 'rx-out-key' }, li); li.appendChild(document.createTextNode('not on the ideal first screen')); }

    const sp = el('div', { class: 'rx-strip-panel' }, mount);
    el('p', { class: 'rx-panel-title' }, sp, 'Days after the data stop on which this user’s first screen was not the ideal one');
    const ssvg = sv('svg', { role: 'img' }, sp);
    let stripW = 0;
    const stripWidth = () => Math.max(260, Math.round(sp.clientWidth - 32));   // the panel's content box

    // ------------------------------------------------------------ render
    function render() {
      const reg = regionOf(state.region), u = userOf(state.region, state.kind);
      if (!u) return;
      if (u.feedDays.indexOf(state.day) < 0) state.day = defaultDay(u);
      regionChips.querySelectorAll('.rx-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.region === state.region)));
      userChips.querySelectorAll('.rx-chip').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === state.kind)));
      for (const code in nodes) nodes[code].setAttribute('aria-pressed', String(code === state.region));
      dayChips.replaceChildren();
      for (const [title, keep] of [['with data', (d) => d < N], ['after the data stop', (d) => d >= N]]) {
        const days = u.feedDays.filter(keep);
        if (!days.length) continue;
        const grp = el('div', { class: 'rx-day-group' }, dayChips);
        el('span', { class: 'rx-day-title' }, grp, title);
        const chips = el('div', { class: 'rx-chips' }, grp);
        for (const d of days) {
          const b = el('button', { type: 'button', class: 'rx-chip', 'aria-pressed': String(d === state.day),
            'aria-label': 'Day ' + d + (d < N ? ', data still flowing' : ', no data') }, chips, String(d));
          b.addEventListener('click', () => { state.day = d; render(); });
        }
      }

      // the user
      card.replaceChildren();
      const idp = el('p', { class: 'rx-user-id' }, card, u.id + ' ');
      el('span', null, idp, '· ' + reg.name + ' (' + reg.hub + '), server ' + reg.server);
      el('p', { class: 'rx-kind' }, card, u.kind === 'typical'
        ? 'The region’s typical user: the genre affinities closest to the region’s average.'
        : 'The region’s contrast user: the one whose first screen local learning got wrong, and cooperative learning right, on the most days. An extreme case; most users see the ideal products with either.');
      const dl = el('dl', { class: 'rx-facts' }, card);
      el('dt', null, dl, 'Genre affinity');
      el('dd', null, dl, GENRE_SHORT.map((g, k) => g + ' ' + signed(u.affinity[k])).join(' · '));
      el('dt', null, dl, 'Region’s average interest');
      el('dd', null, dl, GENRE_SHORT.map((g, k) => g + ' ' + two(reg.ubar[k])).join(' · '));
      el('dt', null, dl, 'Days ' + W0 + '–' + W1 + ' not ideal');
      const dd = el('dd', { class: 'rx-counts' }, dl);
      for (const s of STRIP) {
        const span = el('span', { class: 'rx-count' }, dd);
        el('span', { class: 'rx-key', style: 'background:' + s.color }, span);
        span.appendChild(document.createTextNode(s.label.toLowerCase() + ' ' + u.differs[s.key]));
      }
      el('span', { class: 'rx-count' }, dd, 'of ' + u.days);

      // the first screens
      const F = u.feeds[String(state.day)];
      fTitle.replaceChildren();
      fTitle.appendChild(document.createTextNode('First screen of ' + u.id + ' on day ' + state.day + ' '));
      el('span', { class: 'rx-hint' }, fTitle, state.day < N ? '(data still flowing: every method has the same boosts)' : '(' + (state.day - N + 1) + ' days after the data stop)');
      const ideal = new Set(F.ideal.p);
      feeds.replaceChildren();
      for (const m of METHODS) {
        const f = F[m.key];
        if (!f) continue;
        const col = el('div', { class: 'rx-col' }, feeds);
        const h = el('p', { class: 'rx-col-head' }, col);
        el('span', { class: 'rx-key', style: 'background:' + m.color }, h);
        const lab = el('span', null, h, m.label + (m.math ? ', ' : ''));
        if (m.math) xstar(lab);
        el('p', { class: 'rx-boost', title: 'boosts of outdoor, home and tech, logit units' }, col,
          'x = ' + f.x.map((v) => two(v)).join(', '));
        const ol = el('ol', { class: 'rx-list', 'aria-label': 'First screen ' + m.sr }, col);
        let out = 0;
        f.p.forEach((pi, k) => {
          const pr = R.products[pi];
          const isOut = m.key !== 'ideal' && !ideal.has(pi);
          out += isOut ? 1 : 0;
          const li = el('li', { class: 'rx-item' + (isOut ? ' is-out' : ''), title: R.genres[pr[2]] + ' · $' + pr[3] }, ol);
          el('span', { class: 'rx-rank' }, li, String(k + 1));
          el('span', { class: 'rx-bar', style: 'background:' + GENRE_VAR[pr[2]] }, li);
          const nm = el('span', { class: 'rx-name' }, li, pr[1]);
          if (isOut) el('span', { class: 'rx-sr' }, nm, ' (not on the ideal first screen)');
        });
        ol.setAttribute('data-out', String(out));
      }

      drawStrip(u);
    }

    // ------------------------------------------------------------ the strip
    // drawn at the panel's own width, so that its text keeps its size; narrow: labels above the bars
    function drawStrip(u) {
      const SW = stripW = stripWidth(), narrow = SW < 560;
      const sl = narrow ? 2 : 104, sr = narrow ? 2 : 168, rowH = narrow ? 40 : 26, y0 = narrow ? 2 : 6;
      const top = narrow ? 15 : 3, barH = narrow ? 16 : rowH - 8;
      ssvg.replaceChildren();
      const from = u.strip.from, nd = u.strip.coop3.length, to = from + nd - 1;
      const x0 = sl, x1 = SW - sr, step = (x1 - x0) / nd;
      const xs = (d) => x0 + (d - from) * step;
      const desc = [];
      STRIP.forEach((s, j) => {
        const y = y0 + j * rowH;
        sv('rect', { class: 'rx-strip-track', x: x0, y: y + top, width: (x1 - x0).toFixed(1), height: barH, rx: 3 }, ssvg);
        const bits = u.strip[s.key];
        let n = 0, nw = 0;
        for (let k = 0; k < bits.length; k++) {
          if (bits[k] !== '1') continue;
          n++;
          if (from + k >= W0) nw++;
          sv('rect', { x: xs(from + k).toFixed(2), y: y + top, width: Math.max(1, step - (step > 3 ? 0.8 : 0)).toFixed(2), height: barH, style: 'fill:' + s.color }, ssvg);
        }
        const count = n + ' days, ' + nw + ' from day ' + W0;
        if (narrow) {
          const t = sv('text', { class: 'rx-strip-row-label', x: x0, y: y + 11 }, ssvg, s.label);
          sv('tspan', { class: 'rx-strip-count', dx: 6 }, t, count);
        } else {
          sv('text', { class: 'rx-strip-row-label', x: x0 - 8, y: y + top + barH / 2 + 4, 'text-anchor': 'end' }, ssvg, s.label);
          sv('text', { class: 'rx-strip-count', x: x1 + 8, y: y + top + barH / 2 + 4 }, ssvg, count);
        }
        desc.push(s.label + ': ' + n + ' of ' + nd + ' days, ' + nw + ' of them from day ' + W0);
      });
      const ya = y0 + STRIP.length * rowH + (narrow ? 2 : 0);
      sv('line', { class: 'rx-strip-axis', x1: x0, x2: x1, y1: ya, y2: ya }, ssvg);
      const ticks = [from, from + 50, from + 100, from + 150, to].filter((d, k, a) => a.indexOf(d) === k && d <= to);
      ticks.forEach((d, k) => {
        const x = xs(d) + step / 2;
        sv('line', { class: 'rx-strip-axis', x1: x.toFixed(1), x2: x.toFixed(1), y1: ya, y2: ya + 4 }, ssvg);
        sv('text', { class: 'rx-strip-tick', x: x.toFixed(1), y: ya + 16,
          'text-anchor': k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle' }, ssvg, (k === 0 ? 'day ' : '') + d);
      });
      if (W0 > from && W0 <= to) {
        const xw = xs(W0);
        if (narrow) {   // only across the bars, not through the labels above them
          STRIP.forEach((s, j) => {
            const y = y0 + j * rowH + top;
            sv('line', { class: 'rx-strip-window', x1: xw.toFixed(1), x2: xw.toFixed(1), y1: y, y2: y + barH }, ssvg);
          });
          sv('line', { class: 'rx-strip-window', x1: xw.toFixed(1), x2: xw.toFixed(1), y1: ya - 2, y2: ya }, ssvg);
        } else {
          sv('line', { class: 'rx-strip-window', x1: xw.toFixed(1), x2: xw.toFixed(1), y1: y0, y2: ya }, ssvg);
        }
        sv('text', { class: 'rx-strip-tick', x: (xw + 4).toFixed(1), y: ya + 30 }, ssvg, 'metric window →');
      }
      if (state.day >= from && state.day <= to) {
        const xd = (xs(state.day) + step / 2).toFixed(1);
        if (narrow) {   // only across the bars, not through the labels above them
          STRIP.forEach((s, j) => {
            const y = y0 + j * rowH + top;
            sv('line', { class: 'rx-strip-day', x1: xd, x2: xd, y1: y - 2, y2: y + barH + 2 }, ssvg);
          });
        } else {
          sv('line', { class: 'rx-strip-day', x1: xd, x2: xd, y1: Math.max(0, y0 - 3), y2: ya }, ssvg);
        }
      }
      const SH = ya + 36;
      ssvg.setAttribute('viewBox', '0 0 ' + SW + ' ' + SH);
      ssvg.setAttribute('aria-label', 'Days ' + from + '–' + to + ' after the data stop on which the first screen of ' + u.id +
        ' was not the ideal one. ' + desc.join('; ') + '. The example day is ' + state.day + '.');
      const hit = sv('rect', { class: 'rx-strip-hit', x: x0, y: 0, width: (x1 - x0).toFixed(1), height: ya + 2 }, ssvg);
      hit.addEventListener('click', (ev) => {
        const box = ssvg.getBoundingClientRect();
        const xv = (ev.clientX - box.left) / box.width * SW;
        const day = from + Math.floor((xv - x0) / step);
        const avail = u.feedDays.filter((d) => d >= from);
        if (!avail.length) return;
        let best = avail[0];
        for (const d of avail) if (Math.abs(d - day) < Math.abs(best - day)) best = d;
        state.day = best;
        render();
      });
    }
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (stripWidth() === stripW) return;
        const u = userOf(state.region, state.kind);
        if (u) drawStrip(u);
      }).observe(sp);
    }
    render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
