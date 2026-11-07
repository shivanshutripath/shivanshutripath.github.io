/* recommendation.js: the "See it for one shopper" explorer of the "Recommendation systems"
 * section (#rec-explorer).
 *
 * Reads window.RESULTS.REC (data/recommendation.js, written by
 * recommendation_demo/make_website_data.py). Pick a region (a chip, or a server on the map),
 * a typical or a borderline shopper, and a day. The panel shows the 8 products that shopper
 * sees with the best promotion, with servers that learn together, and with servers that learn
 * alone; products that should not be on the list are outlined in red. A strip marks the days after the data stop on which the shopper's list was not the
 * best one; click it to jump to the nearest example day. Plain words, no math, no libraries. */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;

  const NS = 'http://www.w3.org/2000/svg';
  const GENRE_VAR = ['var(--rx-outdoor)', 'var(--rx-home)', 'var(--rx-tech)', 'var(--rx-essentials)'];
  const COLS = [
    { key: 'ideal', label: 'Best list', note: 'if the store knew every region’s interests', color: 'var(--rx-ideal)' },
    { key: 'coop3', label: 'Learning together', note: 'the servers share summaries', color: 'var(--rx-coop)' },
    { key: 'local', label: 'Each server alone', note: 'no sharing', color: 'var(--rx-local)' },
  ];
  const STRIP = [
    { key: 'coop3', label: 'Learning together', color: 'var(--rx-coop)' },
    { key: 'local', label: 'Each server alone', color: 'var(--rx-local)' },
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
  const count = (bits) => { let n = 0; for (let k = 0; k < bits.length; k++) if (bits[k] === '1') n++; return n; };
  const days = (n) => n + (n === 1 ? ' day' : ' days');

  function init() {
    const mount = document.getElementById('rec-explorer');
    if (!mount || mount.__rx) return;
    mount.__rx = true;
    const R = window.RESULTS && window.RESULTS.REC;
    if (!R || !R.users || !R.users.length) {
      el('p', { class: 'rx-error' }, mount, 'The data of this example did not load.');
      return;
    }
    const N = R.trial.N;
    const regionOf = (code) => R.regions.find((r) => r.code === code);
    const userOf = (code, kind) => R.users.find((u) => u.region === code && u.kind === kind);
    const defaultDay = (u) => (u.first >= 0 && u.feedDays.indexOf(u.first) >= 0 ? u.first
      : u.feedDays.indexOf(N + 50) >= 0 ? N + 50 : u.feedDays[u.feedDays.length - 1]);
    const state = { region: userOf('EU', 'contrast') ? 'EU' : R.regions[0].code, kind: 'contrast', day: null };
    state.day = defaultDay(userOf(state.region, state.kind));

    // ------------------------------------------------------------ controls
    const ctr = el('div', { class: 'rx-controls', role: 'group', 'aria-label': 'Choose a region, a shopper and a day' }, mount);
    const fRegion = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-region' }, fRegion, 'Region');
    const regionChips = el('div', { class: 'rx-chips', role: 'group', 'aria-labelledby': 'rx-l-region' }, fRegion);
    for (const r of R.regions) {
      const b = el('button', { type: 'button', class: 'rx-chip', 'data-region': r.code, title: r.name }, regionChips, r.name);
      b.addEventListener('click', () => pickRegion(r.code));
    }
    const fUser = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-user' }, fUser, 'Shopper');
    const userChips = el('div', { class: 'rx-chips', role: 'group', 'aria-labelledby': 'rx-l-user' }, fUser);
    for (const [kind, lab] of [['typical', 'Typical'], ['contrast', 'Borderline']]) {
      const b = el('button', { type: 'button', class: 'rx-chip', 'data-kind': kind }, userChips, lab);
      b.addEventListener('click', () => { state.kind = kind; state.day = defaultDay(userOf(state.region, kind)); render(); });
    }
    const fDay = el('div', { class: 'rx-field' }, ctr);
    el('span', { class: 'rx-label', id: 'rx-l-day' }, fDay, 'Day');
    const dayChips = el('div', { class: 'rx-days', role: 'group', 'aria-labelledby': 'rx-l-day' }, fDay);

    function pickRegion(code) {
      state.region = code;
      state.day = defaultDay(userOf(code, state.kind));
      render();
    }

    // ------------------------------------------------------------ the servers and the shopper
    const top = el('div', { class: 'rx-top' }, mount);
    const map = el('figure', { class: 'rx-map' }, top);
    el('p', { class: 'rx-panel-title' }, map, 'The eight regional servers');
    const VW = 400, VH = 252, cx = 200, cy = 126, RR = 88;
    const msvg = sv('svg', { viewBox: '0 0 ' + VW + ' ' + VH, role: 'group', 'aria-label': 'The eight regional servers. A line joins two servers that exchange messages. Pick a server to see its region.' }, map);
    const pos = {};
    for (const r of R.regions) {
      const a = (22.5 + 45 * (r.server - 1)) * Math.PI / 180;
      pos[r.code] = { x: cx + RR * Math.cos(a), y: cy - RR * Math.sin(a), a };
    }
    for (const [a, b] of R.links) {
      if (!pos[a] || !pos[b]) continue;
      sv('line', { class: 'rx-link', x1: pos[a].x.toFixed(1), y1: pos[a].y.toFixed(1), x2: pos[b].x.toFixed(1), y2: pos[b].y.toFixed(1) }, msvg);
    }
    const nodes = {};
    for (const r of R.regions) {
      const p = pos[r.code];
      const g = sv('g', { class: 'rx-node', role: 'button', tabindex: '0', 'aria-label': r.name + ' (server in ' + r.hub + ')', transform: 'translate(' + p.x.toFixed(1) + ' ' + p.y.toFixed(1) + ')' }, msvg);
      sv('circle', { r: 17 }, g);
      sv('text', { 'text-anchor': 'middle', dy: '0.36em' }, g, r.code);
      const c = Math.cos(p.a), s = Math.sin(p.a);
      sv('text', { class: 'rx-city', x: (28 * c).toFixed(1), y: (-28 * s + 3.5).toFixed(1), 'text-anchor': c > 0.3 ? 'start' : c < -0.3 ? 'end' : 'middle' }, g, r.name);
      g.addEventListener('click', () => pickRegion(r.code));
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pickRegion(r.code); } });
      nodes[r.code] = g;
    }
    el('p', { class: 'rx-map-note' }, map, 'A line joins two servers that exchange messages. No shopper data ever travel along a line.');

    const card = el('div', { class: 'rx-user', 'aria-live': 'polite' }, top);

    // ------------------------------------------------------------ the lists and the strip
    const fp = el('div', { class: 'rx-feeds-panel' }, mount);
    const fHead = el('div', { class: 'rx-feeds-head' }, fp);
    const fTitle = el('p', { class: 'rx-panel-title' }, fHead);
    const feeds = el('div', { class: 'rx-feeds' }, fp);
    const lg = el('ul', { class: 'rx-legend' }, fp);
    R.genres.forEach((g, k) => {
      const li = el('li', null, lg);
      el('span', { class: 'rx-gkey', style: 'background:' + GENRE_VAR[k] }, li);
      li.appendChild(document.createTextNode(g));
    });
    { const li = el('li', null, lg); el('span', { class: 'rx-out-key' }, li); li.appendChild(document.createTextNode('should not be on the list')); }

    const sp = el('div', { class: 'rx-strip-panel' }, mount);
    el('p', { class: 'rx-panel-title' }, sp, 'Days after the data stop on which this shopper’s list was not the best one');
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
      for (const [title, keep] of [['while data come in', (d) => d < N], ['after the data stop', (d) => d >= N]]) {
        const ds = u.feedDays.filter(keep);
        if (!ds.length) continue;
        const grp = el('div', { class: 'rx-day-group' }, dayChips);
        el('span', { class: 'rx-day-title' }, grp, title);
        const chips = el('div', { class: 'rx-chips' }, grp);
        for (const d of ds) {
          const b = el('button', { type: 'button', class: 'rx-chip', 'aria-pressed': String(d === state.day),
            'aria-label': 'Day ' + d + (d < N ? ', data still coming in' : ', after the data stop') }, chips, String(d));
          b.addEventListener('click', () => { state.day = d; render(); });
        }
      }

      // the shopper
      const nTog = count(u.strip.coop3), nAlone = count(u.strip.local), nAll = u.strip.coop3.length;
      card.replaceChildren();
      const idp = el('p', { class: 'rx-user-id' }, card, 'Shopper ' + u.id + ' ');
      el('span', null, idp, '· ' + reg.name + ' (server in ' + reg.hub + ')');
      el('p', { class: 'rx-kind' }, card, u.kind === 'typical'
        ? 'A typical shopper of the region: their tastes are close to the region’s average.'
        : 'A borderline shopper: two products are almost tied for 8th place on their list, so a small error in the promotion swaps them.');
      const stat = el('p', { class: 'rx-stat' }, card);
      stat.appendChild(document.createTextNode('In the ' + nAll + ' days after the data stop, their list was not the best one on '));
      el('b', { class: 'rx-b-coop' }, stat, days(nTog));
      stat.appendChild(document.createTextNode(' with learning together, and on '));
      el('b', { class: 'rx-b-local' }, stat, days(nAlone));
      stat.appendChild(document.createTextNode(' with each server alone.'));

      // the lists
      const F = u.feeds[String(state.day)];
      fTitle.replaceChildren();
      fTitle.appendChild(document.createTextNode('What shopper ' + u.id + ' sees on day ' + state.day + ' '));
      el('span', { class: 'rx-hint' }, fTitle, state.day < N
        ? '(data still coming in, so every method shows the same list)'
        : '(' + days(state.day - N + 1) + ' after the data stop)');
      const best = new Set(F.ideal.p);
      feeds.replaceChildren();
      for (const m of COLS) {
        const f = F[m.key];
        if (!f) continue;
        const col = el('div', { class: 'rx-col' }, feeds);
        const h = el('p', { class: 'rx-col-head' }, col);
        el('span', { class: 'rx-key', style: 'background:' + m.color }, h);
        el('span', null, h, m.label);
        el('p', { class: 'rx-col-note' }, col, m.note);
        const ol = el('ol', { class: 'rx-list', 'aria-label': m.label + ': the 8 products shopper ' + u.id + ' sees' }, col);
        let wrong = 0;
        f.p.forEach((pi, k) => {
          const pr = R.products[pi];
          const isOut = m.key !== 'ideal' && !best.has(pi);
          wrong += isOut ? 1 : 0;
          const li = el('li', { class: 'rx-item' + (isOut ? ' is-out' : ''), title: R.genres[pr[2]] }, ol);
          el('span', { class: 'rx-rank' }, li, String(k + 1));
          el('span', { class: 'rx-bar', style: 'background:' + GENRE_VAR[pr[2]] }, li);
          const nm = el('span', { class: 'rx-name' }, li, pr[1]);
          if (isOut) el('span', { class: 'rx-sr' }, nm, ' (should not be on the list)');
        });
        if (m.key !== 'ideal') {
          el('p', { class: 'rx-verdict' + (wrong ? ' is-bad' : ' is-good') }, col,
            wrong ? wrong + (wrong === 1 ? ' product differs from the best list' : ' products differ from the best list') : 'Same products as the best list');
        }
      }
      drawStrip(u);
    }

    // ------------------------------------------------------------ the strip
    // drawn at the panel's own width, so that its text keeps its size; narrow: labels above the bars
    function drawStrip(u) {
      const SW = stripW = stripWidth(), narrow = SW < 560;
      const sl = narrow ? 2 : 126, sr = narrow ? 2 : 112, rowH = narrow ? 40 : 28, y0 = narrow ? 2 : 6;
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
        let n = 0;
        for (let k = 0; k < bits.length; k++) {
          if (bits[k] !== '1') continue;
          n++;
          sv('rect', { x: xs(from + k).toFixed(2), y: y + top, width: Math.max(1, step - (step > 3 ? 0.8 : 0)).toFixed(2), height: barH, style: 'fill:' + s.color }, ssvg);
        }
        const cnt = n + ' of ' + nd + ' days';
        if (narrow) {
          const t = sv('text', { class: 'rx-strip-row-label', x: x0, y: y + 11 }, ssvg, s.label);
          sv('tspan', { class: 'rx-strip-count', dx: 6 }, t, cnt);
        } else {
          sv('text', { class: 'rx-strip-row-label', x: x0 - 8, y: y + top + barH / 2 + 4, 'text-anchor': 'end' }, ssvg, s.label);
          sv('text', { class: 'rx-strip-count', x: x1 + 8, y: y + top + barH / 2 + 4 }, ssvg, cnt);
        }
        desc.push(s.label + ': ' + cnt);
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
      const SH = ya + 24;
      ssvg.setAttribute('viewBox', '0 0 ' + SW + ' ' + SH);
      ssvg.setAttribute('aria-label', 'Days ' + from + '–' + to + ', after the data stop, on which the list of shopper ' + u.id +
        ' was not the best one. ' + desc.join('; ') + '. The day shown above is ' + state.day + '.');
      const hit = sv('rect', { class: 'rx-strip-hit', x: x0, y: 0, width: (x1 - x0).toFixed(1), height: ya + 2 }, ssvg);
      hit.addEventListener('click', (ev) => {
        const box = ssvg.getBoundingClientRect();
        const xv = (ev.clientX - box.left) / box.width * SW;
        const day = from + Math.floor((xv - x0) / step);
        const avail = u.feedDays.filter((d) => d >= from);
        if (!avail.length) return;
        let pick = avail[0];
        for (const d of avail) if (Math.abs(d - day) < Math.abs(pick - day)) pick = d;
        state.day = pick;
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
