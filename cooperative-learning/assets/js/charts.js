/* charts.js: the result figures of the project page (inline SVG, no libraries).
 *
 * Fills every element with a data-chart attribute from window.RESULTS (data/results.js,
 * written by make_results_js.py from the paper's data files):
 *   a-rmse a-id a-m      case study (A), Figure 2 of the paper and the baselines of its results table
 *   b-rmse b-id b-tau    case study (B), Figure 4
 *   w-rmse w-id w-seeds  the 100 Webots runs of Section 5.2
 *   r-agree r-forecast r-mix  recommendation systems: case study (B) with products and users
 *                        (window.RESULTS.REC, data/recommendation.js from recommendation_demo)
 * Each chart has a one-line legend of toggle buttons (aria-pressed; "+n" opens the other
 * baselines), the plot (an SVG with role="img" and a text description), a tooltip on hover,
 * touch and keyboard focus (arrow keys), and a "Data" button that shows a table of the values.
 * Every chart of the page has the same height at a given width, so a row of charts lines up.
 */
(() => {
  'use strict';
  if (typeof document === 'undefined') return;

  const NS = 'http://www.w3.org/2000/svg';
  const MINUS = '−';
  const REDUCED = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const FT = 11;     // tick labels (px)
  const FL = 12;     // axis titles (px)
  const FM = 14;     // one-letter math axis titles: N, m, tau (px)
  let UID = 0;

  // ------------------------------------------------------------------ helpers
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const r1 = (v) => Math.round(v * 10) / 10;
  const crisp = (v) => Math.round(v - 0.5) + 0.5;

  function el(tag, attrs, parent, text) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function sv(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  const path = (pts) => (pts.length ? 'M' + pts.map((p) => r1(p[0]) + ',' + r1(p[1])).join('L') : '');
  const poly = (pts) => path(pts) + 'Z';

  // Numbers: 4 significant digits (the precision of the paper's figure data, %.4g).
  function fmt(v) {
    if (v == null || !isFinite(v)) return '—';
    return String(Number(v.toPrecision(4))).replace('-', MINUS);
  }
  function fmtTick(v, step) {
    if (step == null) return String(Number(v.toPrecision(10))).replace('-', MINUS);
    const dec = (String(Number(step.toPrecision(6))).split('.')[1] || '').length;
    return (Math.abs(v) < step * 1e-6 ? 0 : v).toFixed(dec).replace('-', MINUS);
  }
  const meters = (v) => (10 * v).toFixed(2) + ' m';

  // Tiny markup for labels: *x* italic (math), _{..} subscript, ^{..} superscript.
  function rich(str) {
    const out = [];
    const stack = [0];
    let it = false, buf = '';
    const flush = () => { if (buf) out.push({ t: buf, i: it, v: stack[stack.length - 1] }); buf = ''; };
    for (let k = 0; k < str.length; k++) {
      const c = str[k];
      if (c === '*') { flush(); it = !it; }
      else if ((c === '_' || c === '^') && str[k + 1] === '{') { flush(); stack.push(c === '_' ? -1 : 1); k++; }
      else if (c === '}' && stack.length > 1) { flush(); stack.pop(); }
      else buf += c;
    }
    flush();
    return out;
  }
  const plain = (str) => rich(str).map((t) => t.t).join('');
  function richHTML(parent, str) {
    for (const t of rich(str)) {
      let node = document.createTextNode(t.t);
      if (t.i) { const i = document.createElement('i'); i.className = 'ch-mi'; i.appendChild(node); node = i; }
      if (t.v) { const w = document.createElement(t.v < 0 ? 'sub' : 'sup'); w.appendChild(node); node = w; }
      parent.appendChild(node);
    }
    return parent;
  }
  function richSVG(text, str, size) {
    let cur = 0;
    for (const t of rich(str)) {
      const ts = sv('tspan', null, text);
      ts.textContent = t.t;
      if (t.i) ts.setAttribute('class', 'ch-mi');
      const off = t.v < 0 ? 0.3 * size : t.v > 0 ? -0.4 * size : 0;
      if (off !== cur) { ts.setAttribute('dy', r1(off - cur)); cur = off; }
      if (t.v) ts.setAttribute('font-size', r1(size * 0.74));
    }
    return text;
  }

  const MCTX = document.createElement('canvas').getContext('2d');
  function textW(str, px, fam) {
    if (!MCTX) return str.length * px * 0.55;
    MCTX.font = px + 'px ' + fam;
    return MCTX.measureText(str).width;
  }

  // ------------------------------------------------------------------ scales and ticks
  function scale(type, d0, d1, a0, a1) {
    const log = type === 'log';
    const f = log ? Math.log : (v) => v;
    const a = f(d0), k = (a1 - a0) / (f(d1) - a);
    const s = (v) => a0 + (f(v) - a) * k;
    s.inv = (p) => { const t = a + (p - a0) / k; return log ? Math.exp(t) : t; };
    return s;
  }
  function linTicks(lo, hi, maxN) {
    const span = hi - lo;
    if (!(span > 0)) return { ticks: [lo], step: null };
    const base = Math.pow(10, Math.floor(Math.log10(span / Math.max(1, maxN))));
    let step = base * 10;
    for (const m of [1, 2, 2.5, 5, 10]) if (span / (m * base) <= maxN + 1e-9) { step = m * base; break; }
    const ticks = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return { ticks, step };
  }
  // log ticks: of the 1-2-5 style sets whose ticks are >= minGap px apart, the one whose
  // count is closest to one tick per ~56 px (ties: the sparser set)
  function logTicks(lo, hi, px, minGap) {
    const sets = [[1], [1, 2, 5], [1, 2, 3, 5], [1, 1.5, 2, 3, 4, 5, 6, 8]];
    const L = Math.log(hi / lo), target = Math.max(2.5, px / 56);
    let best = null, bs = Infinity;
    for (const set of sets) {
      const t = [];
      for (let e = Math.floor(Math.log10(lo)) - 1; e <= Math.ceil(Math.log10(hi)) + 1; e++) {
        for (const m of set) {
          const v = Number((m * Math.pow(10, e)).toPrecision(12));
          if (v >= lo * (1 - 1e-9) && v <= hi * (1 + 1e-9)) t.push(v);
        }
      }
      t.sort((a, b) => a - b);
      let gap = Infinity;
      for (let i = 1; i < t.length; i++) gap = Math.min(gap, (Math.log(t[i] / t[i - 1]) / L) * px);
      if (t.length < 2 || gap < minGap) continue;
      const score = Math.abs(t.length - target);
      if (score < bs - 1e-9) { bs = score; best = t; }
    }
    return best || linTicks(lo, hi, 4).ticks.filter((v) => v > 0);
  }
  function domainFrom(vals, y) {
    const log = y.type === 'log';
    const v = vals.filter((x) => isFinite(x) && (!log || x > 0));
    if (!v.length) return y.domain ? y.domain.slice() : log ? [0.01, 1] : [0, 1];
    const lo = Math.min(...v), hi = Math.max(...v);
    let plo, phi;
    if (log) {
      const pad = Math.exp(Math.max(Math.log(hi / lo), 0.3) * 0.07);
      plo = lo / pad; phi = hi * pad;
    } else {
      const sp = hi - lo || Math.abs(hi) * 0.2 || 1;
      plo = lo - sp * 0.07; phi = hi + sp * 0.07;
    }
    if (!y.domain) return [plo, phi];
    return [lo < y.domain[0] ? plo : y.domain[0], hi > y.domain[1] ? phi : y.domain[1]];
  }
  function lerpDom(a, b, e, log) {
    if (log) return [Math.exp(Math.log(a[0]) + (Math.log(b[0]) - Math.log(a[0])) * e), Math.exp(Math.log(a[1]) + (Math.log(b[1]) - Math.log(a[1])) * e)];
    return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
  }
  // x labels that do not overlap: the first, the last, then the others left to right
  function fitLabels(items) {
    const order = [0, items.length - 1].concat(items.map((_, i) => i).slice(1, -1));
    const kept = [];
    for (const k of order) {
      const it = items[k];
      if (it && !kept.includes(it) && kept.every((o) => Math.abs(o.x - it.x) >= (o.w + it.w) / 2 + 6)) kept.push(it);
    }
    return kept;
  }
  // The height of every chart's SVG at width W (the same for all charts, so rows line up).
  const chartH = (W) => clamp(Math.round(W * 0.74), 196, 320);

  // ------------------------------------------------------------------ series styles (the paper's encoding)
  const STY = {
    coop:   { c: 'coop',   w: 2,    marker: 'circle',   fill: true },
    local:  { c: 'local',  w: 2,    marker: 'triangle', fill: true },
    exact:  { c: 'exact',  w: 1.75, dash: '5 3',        marker: 'circle' },
    exactL: { c: 'exact',  w: 1.75, dash: '5 3' },
    pooled: { c: 'pooled', w: 1.75, dash: '5 3',        marker: 'x' },
    pers:   { c: 'pers',   w: 1.9,  dash: '0.1 3.6',    cap: 'round', marker: 'square', fill: true },
    oracle: { c: 'oracle', w: 1.5,  dash: '7 3 1.5 3' },
    cent:   { c: 'cent',   w: 1.6,  dash: '8 3',        marker: 'diamond', fill: true },
    kf:     { c: 'oracle', w: 1.3,  dash: '2.5 2.5',    marker: 'plus' },
    frozen: { c: 'frozen', w: 1.75, dash: '6 2.5 1.5 2.5', marker: 'hex', fill: true },
    coop1:  { c: 'coop',   w: 1.5,  dash: '2.5 2.5',    marker: 'tridown' },
    ref:    { c: 'ref',    w: 1.25, dash: '3 3' },
    dcoop:  { c: 'coop',   w: 0,    marker: 'circle',   fill: true },
    dlocal: { c: 'local',  w: 0,    marker: 'triangle', fill: true },
    median: { c: 'ink',    glyph: 'median' },
    panel:  { c: 'muted',  glyph: 'panel' },
  };
  const MK = { circle: 4, triangle: 5.2, tridown: 5, square: 3.3, diamond: 4.8, x: 3.3, plus: 4, hex: 4.2 };
  const cvar = (sty) => 'var(--ch-' + sty.c + ')';

  function lineAttrs(sty) {
    const a = { class: 'ch-line', 'stroke-width': sty.w };
    if (sty.dash) a['stroke-dasharray'] = sty.dash;
    if (sty.dash && sty.cap !== 'round') a['stroke-linecap'] = 'butt';
    return a;
  }
  function marker(g, sty, x, y, k) {
    const shape = sty.marker;
    const r = MK[shape] * (k || 1);
    let e;
    switch (shape) {
      case 'circle': e = sv('circle', { cx: r1(x), cy: r1(y), r: r1(r) }, g); break;
      case 'triangle': e = sv('path', { d: poly([[x, y - r], [x + 0.866 * r, y + 0.5 * r], [x - 0.866 * r, y + 0.5 * r]]) }, g); break;
      case 'tridown': e = sv('path', { d: poly([[x, y + r], [x + 0.866 * r, y - 0.5 * r], [x - 0.866 * r, y - 0.5 * r]]) }, g); break;
      case 'square': e = sv('rect', { x: r1(x - r), y: r1(y - r), width: r1(2 * r), height: r1(2 * r) }, g); break;
      case 'diamond': e = sv('path', { d: poly([[x, y - r], [x + 0.75 * r, y], [x, y + r], [x - 0.75 * r, y]]) }, g); break;
      case 'x': e = sv('path', { d: path([[x - r, y - r], [x + r, y + r]]) + path([[x - r, y + r], [x + r, y - r]]) }, g); break;
      case 'plus': e = sv('path', { d: path([[x, y - r], [x, y + r]]) + path([[x - r, y], [x + r, y]]) }, g); break;
      case 'hex': e = sv('path', { d: poly([0, 1, 2, 3, 4, 5].map((k) => [x + r * Math.cos(Math.PI / 3 * k), y + r * Math.sin(Math.PI / 3 * k)])) }, g); break;
      default: return null;
    }
    e.setAttribute('class', 'ch-mk' + (shape === 'x' || shape === 'plus' ? ' is-stroke' : sty.fill ? '' : ' is-open'));
    return e;
  }
  // the key of a series: a short stroke of its line with its marker (legend, tooltip, table)
  function glyph(parent, sty, w, h) {
    w = w || 22; h = h || 12;
    const g0 = sv('svg', { class: 'ch-glyph', width: w, height: h, viewBox: '0 0 ' + w + ' ' + h, 'aria-hidden': 'true', focusable: 'false' }, parent);
    const g = sv('g', { class: 'ch-s', style: '--ch-c:' + cvar(sty) }, g0);
    const m = h / 2;
    if (sty.glyph === 'median') {
      sv('path', { d: path([[w / 2 - 6, m], [w / 2 + 6, m]]), class: 'ch-med' }, g);
      return g0;
    }
    if (sty.glyph === 'panel') {
      sv('rect', { x: 4.5, y: 0.5, width: w - 9, height: 5.5, rx: 1, class: 'ch-glyph-box' }, g);
      sv('rect', { x: 4.5, y: 7.5, width: w - 9, height: 4, rx: 1, class: 'ch-glyph-box is-on' }, g);
      return g0;
    }
    if (sty.w) sv('path', Object.assign({ d: path([[1, m], [w - 1, m]]) }, lineAttrs(sty)), g);
    if (sty.marker) marker(g, sty, w / 2, m, sty.w ? 0.85 : 0.95);
    return g0;
  }
  function surfaceOf(node) {
    for (let e = node; e && e.nodeType === 1; e = e.parentElement) {
      const c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/^rgba\([^)]*,\s*0\)$/.test(c)) return c;
    }
    return '';
  }
  // horizontal offsets that keep the dots of one column from overlapping (a small beeswarm);
  // deterministic, so every render places every run at the same spot
  function swarm(ys, r, maxDx) {
    const D = 2 * r + 0.7, s = D * 0.55;
    const order = ys.map((_, i) => i).sort((a, b) => ys[a] - ys[b] || a - b);
    const placed = [], dx = new Array(ys.length).fill(0);
    order.forEach((i, n) => {
      const y = ys[i];
      const near = placed.filter((p) => Math.abs(p.y - y) < D);
      const cands = [0];
      for (let k = 1; k * s <= maxDx + 1e-9; k++) cands.push(n % 2 ? -k * s : k * s, n % 2 ? k * s : -k * s);
      let pick = null, bestC = 0, bestD = -1;
      for (const c of cands) {
        let dmin = Infinity;
        for (const p of near) dmin = Math.min(dmin, Math.hypot(c - p.x, y - p.y));
        if (dmin >= D) { pick = c; break; }
        if (dmin > bestD) { bestD = dmin; bestC = c; }
      }
      dx[i] = pick == null ? bestC : pick;
      placed.push({ x: dx[i], y });
    });
    return dx;
  }

  // ------------------------------------------------------------------ the chart
  class Chart {
    constructor(root, id, def, R) {
      this.root = root; this.id = id; this.def = def; this.R = R;
      this.uid = 'ch' + ++UID;
      this.on = {};
      for (const s of this.items()) this.on[s.key] = !!s.on;
      this.dom = null; this.hover = null; this.emph = null; this.w = 0;
      this.keyEls = {}; this.optEls = {};
      this.build();
    }
    // every toggle: the series of all panels (a linked series follows its master) and panel toggles
    items() {
      const d = this.def, out = [];
      for (const p of d.panels || []) for (const s of p.series) if (!s.link) out.push(s);
      for (const s of d.series || []) out.push(s);
      for (const t of d.toggles || []) out.push(t);
      return out;
    }
    isOn(s) { return !!this.on[s.link || s.key]; }
    panels() { return (this.def.panels || []).filter((p) => !p.toggle || this.on[p.toggle]); }

    build() {
      const r = this.root, d = this.def;
      r.classList.add('ch-root');
      // the mount is role="img" in the HTML; once it holds buttons and a table it is a group
      r.setAttribute('role', 'group');
      if (!r.getAttribute('aria-label')) r.setAttribute('aria-label', plain(d.alt));
      r.textContent = '';
      this.legendEl = el('div', { class: 'ch-legend' }, r);
      this.body = el('div', { class: 'ch-body' }, r);
      this.plot = el('div', { class: 'ch-plot', tabindex: '0', role: 'group',
        'aria-label': d.keysHint || 'Plot: the arrow keys step through the values' }, this.body);
      this.tip = el('div', { class: 'ch-tip', 'aria-hidden': 'true' }, this.plot);
      this.dataBtn = el('button', { type: 'button', class: 'ch-data-btn', 'aria-expanded': 'false',
        'aria-controls': this.uid + '-data', 'aria-label': 'Data table' }, this.body, 'Data');
      this.region = el('div', { class: 'ch-table-region', id: this.uid + '-data', hidden: true }, r);
      this.live = el('div', { class: 'ch-sr', 'aria-live': 'polite', 'aria-atomic': 'true' }, r);
      this.buildMore();
      this.buildLegend();
      this.dataBtn.addEventListener('click', () => {
        const open = this.region.hidden;
        if (open && !this.tableBuilt) { this.tableBuilt = true; this.buildTable(); }
        this.region.hidden = !open;
        this.dataBtn.setAttribute('aria-expanded', String(open));
      });
      const P = this.plot;
      P.addEventListener('pointermove', (e) => this.onPointer(e));
      P.addEventListener('pointerdown', (e) => this.onPointer(e));
      P.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && document.activeElement !== P) this.setHover(null); });
      P.addEventListener('keydown', (e) => this.onKey(e));
      P.addEventListener('focus', () => { if (!this.hover) this.setHover(this.firstHover(), true); });
      P.addEventListener('blur', () => this.setHover(null));
    }

    // ---------------- legend: the series shown, as toggle buttons; "+n" lists the others
    buildLegend() {
      const L = this.legendEl;
      const had = L.contains(document.activeElement) ? document.activeElement.getAttribute('data-key') : null;
      L.querySelectorAll('.ch-key').forEach((b) => b.remove());
      this.keyEls = {};
      for (const s of this.items()) {
        if (s.panel || (s.extra && !this.on[s.key])) continue;
        const b = this.keyButton(s);
        if (this.moreBtn) L.insertBefore(b, this.moreBtn); else L.appendChild(b);
      }
      if (had && this.keyEls[had]) this.keyEls[had].focus();
      else if (had && this.moreBtn) this.moreBtn.focus();
      this.fitLegend();
    }
    keyButton(s) {
      const b = el('button', { type: 'button', class: 'ch-key', 'aria-pressed': String(!!this.on[s.key]), 'data-key': s.key });
      glyph(b, STY[s.sty]);
      richHTML(el('span', { class: 'ch-key-t' }, b), s.short || s.label);
      if (s.short && plain(s.short) !== plain(s.label)) b.setAttribute('aria-label', plain(s.label));
      b.addEventListener('click', () => this.toggle(s.key));
      b.addEventListener('pointerenter', () => this.setEmph(s.key));
      b.addEventListener('pointerleave', () => this.setEmph(null));
      b.addEventListener('focus', () => this.setEmph(s.key));
      b.addEventListener('blur', () => this.setEmph(null));
      this.keyEls[s.key] = b;
      return b;
    }
    buildMore() {
      const ex = this.items().filter((s) => s.extra);
      if (!ex.length) return;
      const id = this.uid + '-more';
      const btn = el('button', { type: 'button', class: 'ch-more', 'aria-expanded': 'false', 'aria-controls': id,
        'aria-label': ex.length === 1 ? 'One more series' : ex.length + ' more series' }, this.legendEl, '+' + ex.length);
      const pop = el('div', { class: 'ch-pop', id, role: 'group', 'aria-label': 'More series', hidden: true }, this.root);
      for (const s of ex) {
        const o = el('button', { type: 'button', class: 'ch-opt', 'aria-pressed': String(!!this.on[s.key]), 'data-key': s.key }, pop);
        el('span', { class: 'ch-check', 'aria-hidden': 'true' }, o);
        glyph(o, STY[s.sty]);
        richHTML(el('span', { class: 'ch-opt-t' }, o), s.label);
        o.addEventListener('click', () => this.toggle(s.key));
        this.optEls[s.key] = o;
      }
      this.moreBtn = btn; this.pop = pop;
      btn.addEventListener('click', () => this.openPop(pop.hidden));
      const esc = (e) => { if (e.key === 'Escape' && !pop.hidden) { e.preventDefault(); this.openPop(false); btn.focus(); } };
      btn.addEventListener('keydown', esc);
      pop.addEventListener('keydown', esc);
      pop.addEventListener('focusout', (e) => {
        const to = e.relatedTarget;
        if (to && !pop.contains(to) && to !== btn) this.openPop(false);
      });
    }
    openPop(open) {
      if (!this.pop) return;
      this.pop.hidden = !open;
      this.moreBtn.setAttribute('aria-expanded', String(open));
      if (!open) return;
      const b = this.moreBtn, rw = this.root.clientWidth, pw = this.pop.offsetWidth;
      this.pop.style.top = Math.round(b.offsetTop + b.offsetHeight + 4) + 'px';
      this.pop.style.left = Math.round(clamp(b.offsetLeft, 0, Math.max(0, rw - pw))) + 'px';
      const first = this.pop.querySelector('.ch-opt');
      if (first) first.focus();
    }
    // one line of legend when only the default series are shown: tighten the spacing if it wraps
    fitLegend() {
      const L = this.legendEl;
      L.classList.remove('is-tight');
      const kids = Array.from(L.children);
      if (kids.length < 2) return;
      const wraps = () => kids[kids.length - 1].offsetTop > kids[0].offsetTop + 2;
      if (wraps()) L.classList.add('is-tight');
    }
    toggle(key) {
      const s = this.items().find((q) => q.key === key);
      this.on[key] = !this.on[key];
      const v = String(this.on[key]);
      if (this.keyEls[key]) this.keyEls[key].setAttribute('aria-pressed', v);
      if (this.optEls[key]) this.optEls[key].setAttribute('aria-pressed', v);
      if (s && s.extra && !s.panel) this.buildLegend();
      if (!this.on[key] && this.emph === key) this.emph = null;
      this.entering = this.on[key] ? key : null;
      this.render(true);
    }
    setEmph(key) {
      this.emph = key && this.on[key] ? key : null;
      this.applyEmph();
    }
    applyEmph() {
      if (!this.svg) return;
      const k = this.emph;
      this.svg.classList.toggle('has-emph', !!k);
      this.svg.querySelectorAll('[data-key]').forEach((g) => g.classList.toggle('is-emph', g.getAttribute('data-key') === k));
    }

    // ---------------- rendering
    render(animate) {
      const W = Math.floor(this.plot.getBoundingClientRect().width);
      if (!W) return;
      this.w = W;
      const surf = surfaceOf(this.root);
      if (surf) this.root.style.setProperty('--ch-surface', surf);
      this.fam = getComputedStyle(this.root).fontFamily || 'sans-serif';
      const target = this.targetDomains();
      cancelAnimationFrame(this.raf);
      const changed = this.dom && Object.keys(target).some((k) => !this.dom[k] ||
        Math.abs(target[k][0] - this.dom[k][0]) > 1e-12 || Math.abs(target[k][1] - this.dom[k][1]) > 1e-12);
      if (animate && changed && !REDUCED.matches) {
        const from = this.dom, t0 = performance.now(), D = 320;
        const step = (now) => {
          const p = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - p, 3);
          const cur = {};
          for (const k in target) cur[k] = from[k] ? lerpDom(from[k], target[k], e, this.logOf(k)) : target[k];
          this.dom = cur;
          this.draw(W, e);
          if (p < 1) this.raf = requestAnimationFrame(step);
          else { this.dom = target; this.entering = null; this.draw(W, 1); }
        };
        this.raf = requestAnimationFrame(step);
      } else {
        this.dom = target;
        this.draw(W, animate && !REDUCED.matches ? -1 : 1);
        this.entering = null;
      }
    }
    logOf(pid) {
      if (this.def.kind === 'strip') return true;
      const p = (this.def.panels || []).find((q) => q.id === pid);
      return p ? p.y.type === 'log' : false;
    }
    targetDomains() {
      const d = this.def, R = this.R, out = {};
      if (d.kind === 'strip') {
        const P = R.W.perSeed, vals = [];
        for (const k of ['coop', 'local']) if (this.on[k]) P[k].forEach((col) => vals.push(...col));
        out.main = domainFrom(vals.length ? vals : P.coop.flat(), { type: 'log' });
        return out;
      }
      for (const p of this.panels()) {
        const vals = [];
        for (const s of p.series) {
          if (!this.isOn(s) || !s.get) continue;
          const v = s.get(R);
          vals.push(...v.median);
          if (s.band && v.q25) vals.push(...v.q25, ...v.q75);
        }
        out[p.id] = domainFrom(vals, p.y);
      }
      return out;
    }
    draw(W, prog) {
      const svg = this.def.kind === 'strip' ? this.drawStrip(W, prog) : this.drawSweep(W, prog);
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', this.describe());
      if (this.svg && this.svg.parentNode === this.plot) this.plot.replaceChild(svg, this.svg);
      else this.plot.insertBefore(svg, this.tip);
      this.svg = svg;
      this.applyEmph();
      if (this.hover) this.drawHover(false);
    }
    newSvg(W, H) {
      const svg = sv('svg', { class: 'ch-svg', width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, focusable: 'false' });
      svg.style.width = W + 'px';
      svg.style.height = H + 'px';
      this.defs = sv('defs', null, svg);
      this.clipN = 0;
      return svg;
    }
    seriesGroup(parent, s, prog, extraCls) {
      const sty = STY[s.sty];
      const g = sv('g', { class: 'ch-s' + (extraCls ? ' ' + extraCls : ''), 'data-key': s.link || s.key, style: '--ch-c:' + cvar(sty) }, parent);
      if ((s.link || s.key) === this.entering) {
        if (prog < 0) g.classList.add('ch-enter');
        else if (prog < 1) g.style.opacity = prog;
      }
      return g;
    }
    axisTitle(svg, ax, attrs, size) {
      const e = sv('text', Object.assign({ class: 'ch-title' + (ax.math ? ' ch-math' : '') }, attrs), svg);
      if (ax.math) e.setAttribute('font-size', size);
      richSVG(e, ax.title, size);
      return e;
    }
    yAxis(svg, o, ys, left, right, y0, h) {
      const grid = sv('g', { class: 'ch-gridg' }, svg);
      o.ticks.forEach((t) => { const y = crisp(ys(t)); sv('line', { x1: left, x2: right, y1: y, y2: y, class: 'ch-grid' }, grid); });
      o.ticks.forEach((t, k) => {
        const e = sv('text', { class: 'ch-tick', x: left - 6, y: r1(ys(t)), dy: '0.34em', 'text-anchor': 'end' }, svg);
        e.textContent = o.labels[k];
      });
      const size = o.p.y.math ? FL + 1 : FL;
      this.axisTitle(svg, o.p.y, { transform: 'translate(' + r1(2 + size * 0.82) + ',' + r1(y0 + h / 2) + ') rotate(-90)', 'text-anchor': 'middle' }, size);
    }
    xAxisLabels(svg, items, y) {
      for (const it of fitLabels(items)) {
        const e = sv('text', { class: 'ch-tick', x: r1(it.x), y: r1(y), 'text-anchor': 'middle' }, svg);
        e.textContent = it.lab;
      }
    }
    clip(svg, x, y, w, h, pad) {
      const id = this.uid + '-c' + (++this.clipN);
      const cp = sv('clipPath', { id }, this.defs);
      sv('rect', { x: r1(x - pad), y: r1(y - pad), width: r1(w + 2 * pad), height: r1(h + 2 * pad) }, cp);
      return sv('g', { 'clip-path': 'url(#' + id + ')' }, svg);
    }
    yTicks(p, dom, h) {
      if (p.y.type === 'log') {
        const def = p.y.ticks && p.y.domain && dom[0] >= p.y.domain[0] * 0.999 && dom[1] <= p.y.domain[1] * 1.001;
        const ticks = def ? p.y.ticks.filter((t) => t >= dom[0] && t <= dom[1]) : logTicks(dom[0], dom[1], h, FT + 9);
        return { p, dom, ticks, labels: ticks.map((t) => fmtTick(t)) };
      }
      const lt = linTicks(dom[0], dom[1], Math.max(2, Math.round(h / 44)));
      return { p, dom, ticks: lt.ticks, labels: lt.ticks.map((t) => fmtTick(t, lt.step)) };
    }

    // ---- N sweeps, the m sweep and the tau sweep (one panel; b-tau can add a second below)
    drawSweep(W, prog) {
      const d = this.def, R = this.R, fam = this.fam;
      const panels = this.panels();
      const top = 8, sig = d.sigma ? 17 : 0, bottom = 6 + FT + 7 + FM + 3, gapP = 18;
      const ph = chartH(W) - top - sig - bottom;
      const hs = panels.map((p, i) => (i ? Math.round(ph * 0.6) : ph));
      const info = panels.map((p, i) => this.yTicks(p, this.dom[p.id], hs[i]));
      const tw = Math.max(14, ...info.flatMap((o) => o.labels.map((l) => textW(l, FT, fam))));
      const left = Math.ceil(2 + FL + 1 + 7 + tw + 6), right = 9;
      const pw = Math.max(60, W - left - right);
      const H = top + sig + hs.reduce((a, b) => a + b, 0) + gapP * (panels.length - 1) + bottom;
      const svg = this.newSvg(W, H);
      const xs = scale(d.x.type, d.x.domain[0], d.x.domain[1], left, left + pw);
      const G = { kind: 'sweep', left, right: left + pw, top: top + sig, xs, panels: [] };
      const xset = new Set();
      let y0 = top + sig;
      info.forEach((o, i) => {
        const h = hs[i], p = o.p;
        const ys = scale(p.y.type, o.dom[0], o.dom[1], y0 + h, y0);
        const vg = sv('g', { class: 'ch-gridg' }, svg);
        d.x.ticks.forEach((t) => { const x = crisp(xs(t)); sv('line', { x1: x, x2: x, y1: y0, y2: y0 + h, class: 'ch-grid is-v' }, vg); });
        this.yAxis(svg, o, ys, left, left + pw, y0, h);
        sv('line', { x1: left, x2: left + pw, y1: crisp(y0 + h), y2: crisp(y0 + h), class: 'ch-axis' }, svg);
        const bandG = this.clip(svg, left, y0, pw, h, 1);
        const lineG = this.clip(svg, left, y0, pw, h, 9);
        const vis = p.series.filter((s) => this.isOn(s));
        const PG = { p, ys, y0, h, series: vis.map((s) => ({ s, v: s.get(R), sty: STY[s.sty] })) };
        // drawn in reverse legend order, so that the main comparison (listed first) is on top
        const back = PG.series.slice().reverse();
        for (const q of back) {
          const v = q.v;
          if (!q.s.band || !v.q25) continue;
          const g = this.seriesGroup(bandG, q.s, prog, 'ch-bandg');
          const up = v.x.map((x, j) => [xs(x), ys(v.q75[j])]);
          const lo = v.x.map((x, j) => [xs(x), ys(v.q25[j])]).reverse();
          sv('path', { d: poly(up.concat(lo)), class: 'ch-band' }, g);
        }
        for (const q of back) {
          const v = q.v, sty = q.sty;
          const g = this.seriesGroup(lineG, q.s, prog);
          const pts = v.x.map((x, j) => [xs(x), ys(v.median[j])]);
          sv('path', Object.assign({ d: path(pts) }, lineAttrs(sty)), g);
          if (sty.marker && !q.s.hline) pts.forEach((pt) => marker(g, sty, pt[0], pt[1]));
          if (!q.s.hline) v.x.forEach((x) => xset.add(x));
        }
        G.panels.push(PG);
        y0 += h + gapP;
      });
      const yb = y0 - gapP;
      // the contraction factor of each graph, above the plot (m sweep)
      if (d.sigma) {
        const sg = d.sigma(R), yy = top + 10;
        const lab = sv('text', { class: 'ch-note ch-math', x: left - 6, y: yy, 'text-anchor': 'end' }, svg);
        richSVG(lab, '*σ*', FT + 1);
        const items = sg.x.map((x, j) => ({ x: xs(x), lab: sg.sigma[j] === 0 ? '0' : sg.sigma[j].toFixed(2), w: 0 }));
        items.forEach((it) => { it.w = textW(it.lab, FT - 0.5, fam); });
        for (const it of fitLabels(items)) {
          const e = sv('text', { class: 'ch-note', x: r1(it.x), y: yy, 'text-anchor': 'middle' }, svg);
          e.textContent = it.lab;
        }
      }
      const xl = d.x.ticks.map((t) => {
        const lab = d.x.fmt ? d.x.fmt(t) : String(t);
        return { x: xs(t), lab, w: textW(lab, FT, fam) };
      });
      this.xAxisLabels(svg, xl, yb + 6 + FT * 0.8);
      this.axisTitle(svg, d.x, { x: r1(left + pw / 2), y: H - 5, 'text-anchor': 'middle' }, FM);
      G.xvals = Array.from(xset).sort((a, b) => a - b);
      G.bottom = yb;
      this.geom = G;
      return svg;
    }

    // ---- Webots: every run, together and alone, grouped by N
    drawStrip(W, prog) {
      const d = this.def, R = this.R, P = R.W.perSeed, fam = this.fam;
      const top = 8, bottom = 6 + FT + 7 + FM + 3;
      const ph = chartH(W) - top - bottom;
      const dom = this.dom.main;
      const o = this.yTicks({ y: d.y }, dom, ph);
      const tw = Math.max(14, ...o.labels.map((l) => textW(l, FT, fam)));
      const left = Math.ceil(2 + FL + 1 + 7 + tw + 6), right = 6;
      const pw = Math.max(80, W - left - right);
      const H = top + ph + bottom;
      const svg = this.newSvg(W, H);
      const ys = scale('log', dom[0], dom[1], top + ph, top);
      const ng = P.x.length, bw = pw / ng;
      const vg = sv('g', { class: 'ch-gridg' }, svg);
      for (let g = 1; g < ng; g++) { const x = crisp(left + g * bw); sv('line', { x1: x, x2: x, y1: top, y2: top + ph, class: 'ch-grid is-v' }, vg); }
      this.yAxis(svg, o, ys, left, left + pw, top, ph);
      sv('line', { x1: left, x2: left + pw, y1: crisp(top + ph), y2: crisp(top + ph), class: 'ch-axis' }, svg);
      const off = { coop: -0.2, local: 0.2 };
      const rr = { coop: 2.7, local: 3.3 };
      const maxDx = Math.max(2, bw * 0.17);
      const pts = [];
      const mkG = sv('g', null, svg);
      const medG = sv('g', { class: 'ch-meds' }, svg);
      const dotSeries = d.series.filter((s) => s.key !== 'median');
      P.x.forEach((N, gi) => {
        const cx = left + (gi + 0.5) * bw;
        for (const s of dotSeries) {
          if (!this.on[s.key]) continue;
          const sty = STY[s.sty], k = s.key;
          const g = this.seriesGroup(mkG, s, prog, 'ch-dots');
          const col = P[k][gi];
          const yv = col.map((v) => ys(v));
          const dx = swarm(yv, rr[k], maxDx);
          col.forEach((v, j) => {
            const x = cx + off[k] * bw + dx[j], y = yv[j];
            marker(g, sty, x, y, rr[k] / MK[sty.marker]);
            pts.push({ x, y, v, gi, j, k, N, seed: P.seed[j] });
          });
          if (this.on.median) {
            const med = R.W.rmse[k].median[gi];
            const mg = sv('g', { class: 'ch-s', 'data-key': 'median' }, medG);
            const half = Math.min(bw * 0.17, 9);
            const seg = path([[cx + off[k] * bw - half, ys(med)], [cx + off[k] * bw + half, ys(med)]]);
            sv('path', { d: seg, class: 'ch-med-halo' }, mg);
            sv('path', { d: seg, class: 'ch-med' }, mg);
          }
        }
      });
      const items = P.x.map((N, gi) => ({ x: left + (gi + 0.5) * bw, lab: String(N), w: textW(String(N), FT, fam) }));
      this.xAxisLabels(svg, items, top + ph + 6 + FT * 0.8);
      this.axisTitle(svg, d.x, { x: r1(left + pw / 2), y: H - 5, 'text-anchor': 'middle' }, FM);
      this.geom = { kind: 'strip', left, right: left + pw, top, bottom: top + ph, ys, pts, bw };
      return svg;
    }

    // ---------------- description for screen readers (the SVG's aria-label)
    describe() {
      const d = this.def, R = this.R;
      if (d.kind === 'strip') {
        const P = R.W.perSeed;
        return plain(d.alt) + ' Medians, together: ' + R.W.rmse.coop.median.map(fmt).join(', ') +
          '; alone: ' + R.W.rmse.local.median.map(fmt).join(', ') + ', for N = ' + P.x.join(', ') + '.';
      }
      const parts = [plain(d.alt)];
      for (const p of this.panels()) {
        if (this.panels().length > 1) parts.push(plain(p.y.tip) + '.');
        for (const s of p.series) {
          if (!this.isOn(s)) continue;
          const v = s.get(R);
          parts.push(plain(s.label) + ': ' + (s.hline ? fmt(v.median[0]) : v.median.map(fmt).join(', ')) + '.');
        }
      }
      parts.push('Values for ' + plain(d.x.name) + ' = ' + d.x.ticks.join(', ') + '. The Data button shows a table of every value.');
      return parts.join(' ');
    }

    // ---------------- hover, touch and keyboard
    firstHover() {
      const G = this.geom;
      if (!G) return null;
      if (G.kind === 'sweep') return G.xvals.length ? Object.assign({ i: 0 }, this.stackAt(0)[0] || {}) : null;
      if (G.kind === 'strip') return G.pts.length ? { p: G.pts[0] } : null;
      return null;
    }
    valAt(o, x) {
      if (o.s.hline) return o.v.median[0];
      const j = o.v.x.indexOf(x);
      return j >= 0 ? o.v.median[j] : null;
    }
    // the series closest to the pointer at x index i, in the panel under the pointer
    nearestAt(i, py) {
      const G = this.geom, x = G.xvals[i];
      let pi = 0, pd = Infinity;
      G.panels.forEach((PG, k) => {
        const dd = py < PG.y0 ? PG.y0 - py : py > PG.y0 + PG.h ? py - PG.y0 - PG.h : 0;
        if (dd < pd) { pd = dd; pi = k; }
      });
      const PG = G.panels[pi];
      let key = null, bd = Infinity;
      for (const o of PG.series) {
        const val = this.valAt(o, x);
        if (val == null) continue;
        const dy = Math.abs(PG.ys(val) - py);
        if (dy < bd) { bd = dy; key = o.s.link || o.s.key; }
      }
      return { key, pi };
    }
    // every (panel, series) with a value at x index i, top to bottom on the screen
    stackAt(i) {
      const G = this.geom, x = G.xvals[i], out = [];
      G.panels.forEach((PG, pi) => {
        const col = [];
        for (const o of PG.series) {
          const val = this.valAt(o, x);
          if (val != null) col.push({ y: PG.ys(val), key: o.s.link || o.s.key, pi });
        }
        col.sort((a, b) => a.y - b.y).forEach((c) => out.push({ key: c.key, pi: c.pi }));
      });
      return out;
    }
    onPointer(e) {
      const G = this.geom;
      if (!G || !this.svg) return;
      const rect = this.svg.getBoundingClientRect();
      if (!rect.width) return;
      const k = this.w / rect.width;
      const px = (e.clientX - rect.left) * k, py = (e.clientY - rect.top) * k;
      if (px < G.left - 20 || px > G.right + 12 || py < G.top - 12 || py > G.bottom + 12) {
        if (e.pointerType === 'mouse') this.setHover(null);
        return;
      }
      if (G.kind === 'sweep') {
        if (!G.xvals.length) return;
        let i = 0, bd = Infinity;
        G.xvals.forEach((x, j) => { const dd = Math.abs(G.xs(x) - px); if (dd < bd) { bd = dd; i = j; } });
        this.setHover(Object.assign({ i, py }, this.nearestAt(i, py)));
      } else if (G.kind === 'strip') {
        let best = null, bd = Infinity;
        for (const q of G.pts) { const dd = Math.hypot(q.x - px, q.y - py); if (dd < bd) { bd = dd; best = q; } }
        if (best && bd <= 22) this.setHover({ p: best });
        else if (e.pointerType === 'mouse') this.setHover(null);
      }
    }
    onKey(e) {
      const G = this.geom;
      if (!G) return;
      const k = e.key;
      const h = this.hover || this.firstHover();
      if (!h) return;
      if (k === 'Escape') { if (this.hover) { e.preventDefault(); this.setHover(null); } return; }
      if (G.kind === 'sweep') {
        const n = G.xvals.length;
        let i = h.i, sel = { key: h.key, pi: h.pi || 0 };
        if (k === 'ArrowRight') i = Math.min(n - 1, i + 1);
        else if (k === 'ArrowLeft') i = Math.max(0, i - 1);
        else if (k === 'Home') i = 0;
        else if (k === 'End') i = n - 1;
        else if (k === 'ArrowUp' || k === 'ArrowDown') {
          const order = this.stackAt(i);
          if (order.length) {
            const at = Math.max(0, order.findIndex((o) => o.key === sel.key && o.pi === sel.pi));
            sel = order[clamp(at + (k === 'ArrowUp' ? -1 : 1), 0, order.length - 1)];
          }
        } else return;
        e.preventDefault();
        const st = this.stackAt(i);
        if (!st.some((o) => o.key === sel.key && o.pi === sel.pi)) sel = st[0] || sel;
        this.setHover({ i, key: sel.key, pi: sel.pi }, true);
      } else if (G.kind === 'strip') {
        const cols = [];
        this.R.W.perSeed.x.forEach((_, gi) => ['coop', 'local'].forEach((kk) => { if (this.on[kk]) cols.push([gi, kk]); }));
        if (!cols.length) return;
        let ci = Math.max(0, cols.findIndex((c) => c[0] === h.p.gi && c[1] === h.p.k));
        const col = (c) => G.pts.filter((q) => q.gi === cols[c][0] && q.k === cols[c][1]).sort((a, b) => a.y - b.y);
        let list = col(ci), at = Math.max(0, list.indexOf(h.p));
        if (k === 'ArrowRight' || k === 'ArrowLeft') {
          ci = clamp(ci + (k === 'ArrowRight' ? 1 : -1), 0, cols.length - 1);
          list = col(ci);
          const same = list.findIndex((q) => q.j === h.p.j);   // the same run in the next column
          at = same >= 0 ? same : Math.min(at, list.length - 1);
        } else if (k === 'ArrowUp') at = Math.max(0, at - 1);
        else if (k === 'ArrowDown') at = Math.min(list.length - 1, at + 1);
        else if (k === 'Home') { ci = 0; list = col(0); at = 0; }
        else if (k === 'End') { ci = cols.length - 1; list = col(ci); at = list.length - 1; }
        else return;
        e.preventDefault();
        if (list[at]) this.setHover({ p: list[at] }, true);
      }
    }
    setHover(h, fromKeys) {
      if (h && this.geom && this.geom.kind === 'strip' && h.p) {
        // find the point again after a re-render
        const q = this.geom.pts.find((o) => o.gi === h.p.gi && o.k === h.p.k && o.j === h.p.j);
        h = q ? { p: q } : null;
      }
      this.hover = h;
      this.drawHover(!!fromKeys);
    }
    drawHover(announce) {
      const old = this.svg && this.svg.querySelector('.ch-hov');
      if (old) old.remove();
      const h = this.hover, G = this.geom;
      if (!h || !G || !this.svg) { this.tip.classList.remove('is-on'); return; }
      const og = sv('g', { class: 'ch-hov' }, this.svg);
      const anchor = G.kind === 'sweep' ? this.hoverSweep(og, h) : this.hoverStrip(og, h);
      if (!anchor) { this.tip.classList.remove('is-on'); return; }
      this.placeTip(anchor[0], anchor[1]);
      if (announce) {
        clearTimeout(this.liveT);
        const txt = (this.tipLines || []).join('. ').replace(/\s+/g, ' ').trim() + '.';
        this.liveT = setTimeout(() => { this.live.textContent = txt; }, 120);
      }
    }
    placeTip(ax, ay) {
      const tip = this.tip;
      tip.classList.add('is-on');
      const k = this.svg.getBoundingClientRect().width / this.w || 1;
      ax *= k; ay *= k;
      const pw = this.plot.clientWidth, ph = this.plot.clientHeight;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = ax + 14;
      if (x + w > pw - 2) x = ax - 14 - w;
      if (x < 2) x = clamp(ax - w / 2, 2, Math.max(2, pw - w - 2));
      const y = clamp(ay - h / 2, 2, Math.max(2, ph - h - 2));
      tip.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)';
    }
    tipHead(str) {
      this.tip.textContent = '';
      this.tipLines = [plain(str)];
      return richHTML(el('div', { class: 'ch-tip-h' }, this.tip), str);
    }
    tipSub(text) {
      this.tipLines.push(text);
      return el('div', { class: 'ch-tip-sub' }, this.tip, text);
    }
    tipRow(sty, value, label, notes, near) {
      this.tipLines.push(plain(label) + ': ' + value + (notes && notes.length ? ', ' + notes.join(', ') : ''));
      const row = el('div', { class: 'ch-tip-r' + (near ? ' is-near' : '') }, this.tip);
      glyph(row, sty, 16, 10);
      el('b', { class: 'ch-tip-v' }, row, value);
      richHTML(el('span', { class: 'ch-tip-l' }, row), label);
      if (notes && notes.length) el('span', { class: 'ch-tip-q' }, row, notes.join(' · '));
      return row;
    }
    hoverSweep(og, h) {
      const G = this.geom, d = this.def, x = G.xvals[h.i];
      if (x == null) return null;
      const px = G.xs(x);
      sv('line', { x1: crisp(px), x2: crisp(px), y1: G.top, y2: G.bottom, class: 'ch-cross' }, og);
      let head = d.x.name + ' = ' + (d.x.fmt ? d.x.fmt(x) : x);
      if (d.sigma) {
        const sg = d.sigma(this.R), j = sg.x.indexOf(x);
        if (j >= 0) head += ' · *σ* = ' + (sg.sigma[j] === 0 ? '0' : sg.sigma[j].toFixed(2));
      }
      this.tipHead(head);
      let ay = null, firstY = null;
      G.panels.forEach((PG, pi) => {
        if (G.panels.length > 1) this.tipSub(plain(PG.p.y.tip));
        for (const o of PG.series) {
          const val = this.valAt(o, x);
          if (val == null) continue;
          const j = o.v.x.indexOf(x);
          const near = (o.s.link || o.s.key) === h.key && pi === (h.pi || 0);
          const py = PG.ys(val);
          if (firstY == null) firstY = py;
          const g = sv('g', { class: 'ch-s', style: '--ch-c:' + cvar(o.sty) }, og);
          if (!o.s.hline) {
            if (o.sty.marker) marker(g, o.sty, px, py, 1.3);
            else sv('circle', { cx: r1(px), cy: r1(py), r: 3.6, class: 'ch-mk' }, g);
          }
          if (near) { sv('circle', { cx: r1(px), cy: r1(py), r: o.s.hline ? 6 : 9, class: 'ch-ring' }, g); ay = py; }
          const notes = [];
          if (PG.p.y.meters) notes.push(meters(val));
          if (o.s.band && o.v.q25 && j >= 0) notes.push('IQR ' + fmt(o.v.q25[j]) + '–' + fmt(o.v.q75[j]));
          this.tipRow(o.sty, fmt(val), o.s.short || o.s.label, notes, near);
        }
      });
      return [px, h.py != null ? h.py : ay != null ? ay : firstY != null ? firstY : G.top];
    }
    hoverStrip(og, h) {
      const G = this.geom, P = this.R.W.perSeed, d = this.def, q = h.p;
      if (!q) return null;
      const partner = G.pts.find((o) => o.gi === q.gi && o.j === q.j && o.k !== q.k);
      if (partner) sv('path', { d: path([[q.x, q.y], [partner.x, partner.y]]), class: 'ch-pair' }, og);
      for (const o of [partner, q]) {
        if (!o) continue;
        const s = d.series.find((ss) => ss.key === o.k), sty = STY[s.sty];
        const g = sv('g', { class: 'ch-s', style: '--ch-c:' + cvar(sty) }, og);
        marker(g, sty, o.x, o.y, (o.k === 'coop' ? 3.6 : 4.3) / MK[sty.marker]);
        if (o === q) sv('circle', { cx: r1(o.x), cy: r1(o.y), r: 8.5, class: 'ch-ring' }, g);
      }
      this.tipHead('*N* = ' + q.N + ' · seed ' + q.seed);
      for (const s of d.series) {
        if (s.key === 'median') continue;
        const v = P[s.key][q.gi][q.j];
        this.tipRow(STY[s.sty], fmt(v), s.short || s.label, [meters(v)], s.key === q.k);
      }
      return [q.x, q.y];
    }

    // ---------------- data table (built when first opened)
    buildTable() {
      const d = this.def;
      const wrap = el('div', { class: 'ch-table-wrap' + (d.kind === 'strip' ? ' is-tall' : ''), tabindex: '0', role: 'region',
        'aria-label': plain(this.root.getAttribute('aria-label') || d.alt) + ': table' }, this.region);
      const tbl = el('table', { class: 'ch-table' }, wrap);
      richHTML(el('caption', null, tbl), d.tableCaption);
      const srcs = [];
      const addSrc = (p) => { if (p) for (const s of [].concat(p)) if (!srcs.includes(s)) srcs.push(s); };
      if (d.kind === 'strip') this.tableStrip(tbl, addSrc); else this.tableSweep(tbl, addSrc);
      const p = el('p', { class: 'ch-src' }, this.region);
      const dirs = {};
      srcs.forEach((s) => { const i = s.lastIndexOf('/'); const dir = s.slice(0, i); (dirs[dir] = dirs[dir] || []).push(s.slice(i + 1)); });
      p.appendChild(document.createTextNode('Source, in code.zip: '));
      Object.keys(dirs).forEach((dir, k) => {
        if (k) p.appendChild(document.createTextNode('; '));
        el('code', null, p, dir + '/');
        p.appendChild(document.createTextNode(' ' + dirs[dir].join(', ')));
      });
      p.appendChild(document.createTextNode('. 4 significant digits.'));
    }
    headCell(tr, s) {
      const th = el('th', { scope: 'col' }, tr);
      glyph(th, STY[s.sty], 16, 10);
      richHTML(el('span', null, th), s.short || s.label);
      return th;
    }
    tableSweep(tbl, addSrc) {
      const d = this.def, R = this.R;
      const panels = d.panels;
      const cols = [];
      for (const p of panels) for (const s of p.series) cols.push({ p, s, v: s.get(R) });
      cols.forEach((c) => { addSrc(c.v.src); if (c.s.band) addSrc(c.v.srcIQR); });
      const xv = [];
      cols.forEach((c) => { if (!c.s.hline) c.v.x.forEach((x) => { if (!xv.includes(x)) xv.push(x); }); });
      xv.sort((a, b) => a - b);
      const thead = el('thead', null, tbl);
      if (panels.length > 1) {
        const tr0 = el('tr', { class: 'is-group' }, thead);
        el('th', null, tr0);
        for (const p of panels) richHTML(el('th', { scope: 'colgroup', colspan: String(p.series.length) }, tr0), p.y.tip);
      }
      const tr = el('tr', null, thead);
      richHTML(el('th', { scope: 'col' }, tr), d.x.name);
      let sg = null;
      if (d.sigma) { sg = d.sigma(R); addSrc(sg.src); richHTML(el('th', { scope: 'col' }, tr), '*σ*'); }
      cols.forEach((c) => this.headCell(tr, c.s));
      const tb = el('tbody', null, tbl);
      xv.forEach((x) => {
        const row = el('tr', null, tb);
        el('th', { scope: 'row' }, row, d.x.fmt ? d.x.fmt(x) : String(x));
        if (sg) { const j = sg.x.indexOf(x); el('td', null, row, j >= 0 ? (sg.sigma[j] === 0 ? '0' : fmt(sg.sigma[j])) : ''); }
        for (const c of cols) {
          const td = el('td', null, row);
          const j = c.v.x.indexOf(x);
          const val = c.s.hline ? c.v.median[0] : j >= 0 ? c.v.median[j] : null;
          if (val == null) continue;
          el('span', { class: 'ch-v' }, td, fmt(val));
          if (c.s.band && c.v.q25 && j >= 0) el('span', { class: 'ch-q' }, td, fmt(c.v.q25[j]) + '–' + fmt(c.v.q75[j]));
        }
      });
    }
    tableStrip(tbl, addSrc) {
      const d = this.def, R = this.R, P = R.W.perSeed;
      addSrc(P.src); addSrc(R.W.rmse.coop.src);
      const series = d.series.filter((s) => s.key !== 'median');
      const thead = el('thead', null, tbl), tr = el('tr', null, thead);
      richHTML(el('th', { scope: 'col' }, tr), '*N*');
      el('th', { scope: 'col' }, tr, 'seed');
      series.forEach((s) => this.headCell(tr, s));
      P.x.forEach((N, gi) => {
        const tb = el('tbody', null, tbl);
        P.seed.forEach((seed, j) => {
          const row = el('tr', null, tb);
          el('th', { scope: 'row' }, row, j ? '' : String(N));
          el('td', { class: 'is-seed' }, row, String(seed));
          series.forEach((s) => el('td', null, row, fmt(P[s.key][gi][j])));
        });
        const mr = el('tr', { class: 'is-med' }, tb);
        el('th', { scope: 'row' }, mr);
        el('td', { class: 'is-seed' }, mr, 'median');
        series.forEach((s) => el('td', null, mr, fmt(R.W.rmse[s.key].median[gi])));
      });
    }
  }

  // ------------------------------------------------------------------ chart definitions
  const XN = { type: 'log', domain: [26, 230], ticks: [30, 50, 100, 150, 200], name: '*N*', title: '*N*', math: true };
  const Y_RMSE = { type: 'linear', title: 'tracking RMSE (10 m)', tip: 'tracking RMSE', meters: true };
  const Y_ID = { type: 'log', title: '‖*Â* − *A*‖_{F}', math: true, tip: 'identification error' };
  const T = {
    coop3: { label: 'together', sty: 'coop' },
    local: { label: 'alone', sty: 'local' },
    coop1: { label: 'together, *τ* = 1', short: 'together, *τ* = 1', sty: 'coop1' },
    exact: { label: 'exact averaging', sty: 'exact' },
    pooledLS: { label: 'pooled least squares', short: 'pooled LS', sty: 'pooled' },
    persistence: { label: 'persistence (*Â* = *I*)', short: 'persistence', sty: 'pers' },
    centralized: { label: 'centralized predictor', short: 'centralized', sty: 'cent' },
    oracleA: { label: 'oracle (*A* known)', short: 'oracle', sty: 'oracle' },
    oracleKF: { label: 'oracle Kalman filter', short: 'oracle KF', sty: 'kf' },
    frozen: { label: 'frozen boosts', short: 'frozen', sty: 'frozen' },
  };
  // a series of a data block: T[key] plus its accessor and options
  const S = (key, get, opt) => Object.assign({ key }, T[key], { get }, opt || {});

  const DEFS = {
    'a-rmse': {
      alt: 'Line chart: tracking RMSE in units of 10 m versus N (log scale), medians with interquartile bands over 50 trials.',
      x: XN,
      panels: [{ id: 'main', y: Object.assign({}, Y_RMSE, { domain: [0.15, 0.72] }), series: [
        S('coop3', (R) => R.A.rmse.coop3, { on: true, band: true }),
        S('local', (R) => R.A.rmse.local, { on: true, band: true }),
        S('exact', (R) => R.A.rmse.exact, { extra: true }),
        S('oracleA', (R) => R.A.rmse.oracleA, { extra: true }),
        S('centralized', (R) => R.A.rmse.centralized, { extra: true }),
        S('oracleKF', (R) => R.A.rmse.oracleKF, { extra: true }),
        S('persistence', (R) => R.A.rmse.persistence, { extra: true }),
        S('coop1', (R) => R.A.rmse.coop1, { extra: true }),
      ] }],
      tableCaption: 'Tracking RMSE (10 m): median over 50 trials, interquartile range below.',
    },
    'a-id': {
      alt: 'Line chart: identification error versus N, both axes log scale, medians with interquartile bands over 50 trials and 6 stations.',
      x: XN,
      panels: [{ id: 'main', y: Object.assign({}, Y_ID, { domain: [0.003, 0.05], ticks: [0.005, 0.01, 0.02, 0.05] }), series: [
        S('coop3', (R) => R.A.id.coop3, { on: true, band: true }),
        S('local', (R) => R.A.id.local, { on: true, band: true }),
        S('exact', (R) => R.A.id.exact, { extra: true }),
        S('pooledLS', (R) => R.A.id.pooledLS, { extra: true }),
        S('coop1', (R) => R.A.id.coop1, { extra: true }),
      ] }],
      tableCaption: '‖*Â*^{(*i*)} − *A*‖_{F}: median over 50 trials and 6 stations, interquartile range below.',
    },
    'a-m': {
      alt: 'Line chart: identification error versus the number m of identical agents at N = 100, both axes log scale, with a 1/√m reference line and the contraction factor σ of each graph above the plot.',
      x: { type: 'log', domain: [1.75, 36], ticks: [2, 4, 8, 16, 32], name: '*m*', title: '*m*', math: true },
      sigma: (R) => R.A.m_sweep.sigma,
      panels: [{ id: 'main', y: Object.assign({}, Y_ID, { domain: [0.0024, 0.05], ticks: [0.005, 0.01, 0.02, 0.05] }), series: [
        S('coop3', (R) => R.A.m_sweep.coop3, { on: true, band: true }),
        S('local', (R) => R.A.m_sweep.local, { on: true, band: true }),
        { key: 'ref', sty: 'ref', label: '1/√*m*', on: true, get: (R) => R.A.m_sweep.ref },
        S('exact', (R) => R.A.m_sweep.exact, { extra: true }),
      ] }],
      tableCaption: 'Identical agents, *N* = 100: ‖*Â*^{(*i*)} − *A*‖_{F}, median over 50 trials and the *m* agents, interquartile range below; *σ* is the contraction factor of the graph. The 1/√*m* line passes through exact averaging at *m* = 8.',
    },
    'b-rmse': {
      alt: 'Line chart: tracking RMSE versus N (log scale), medians with interquartile bands over 50 trials, with the oracle that knows A.',
      x: XN,
      panels: [{ id: 'main', y: { type: 'linear', title: 'tracking RMSE', tip: 'tracking RMSE', domain: [0.009, 0.037] }, series: [
        S('coop3', (R) => R.B.rmse.coop3, { on: true, band: true }),
        S('local', (R) => R.B.rmse.local, { on: true, band: true }),
        S('oracleA', (R) => R.B.rmse.oracleA, { on: true }),
        S('exact', (R) => R.B.rmse.exact, { extra: true }),
        S('centralized', (R) => R.B.rmse.centralized, { extra: true }),
        S('oracleKF', (R) => R.B.rmse.oracleKF, { extra: true }),
        S('persistence', (R) => R.B.rmse.persistence, { extra: true }),
        S('coop1', (R) => R.B.rmse.coop1, { extra: true }),
      ] }],
      tableCaption: 'Tracking RMSE: median over 50 trials, interquartile range below.',
    },
    'b-id': {
      alt: 'Line chart: identification error versus N, both axes log scale, medians with interquartile bands over 50 trials and 8 servers, with pooled least squares.',
      x: XN,
      panels: [{ id: 'main', y: Object.assign({}, Y_ID, { domain: [0.0105, 0.6], ticks: [0.02, 0.05, 0.1, 0.2, 0.5] }), series: [
        S('coop3', (R) => R.B.id.coop3, { on: true, band: true }),
        S('local', (R) => R.B.id.local, { on: true, band: true }),
        S('pooledLS', (R) => R.B.id.pooledLS, { on: true }),
        S('exact', (R) => R.B.id.exact, { extra: true }),
        S('coop1', (R) => R.B.id.coop1, { extra: true }),
      ] }],
      tableCaption: '‖*Â*^{(*i*)} − *A*‖_{F}: median over 50 trials and 8 servers, interquartile range below.',
    },
    'b-tau': {
      alt: 'Line chart: identification error versus the number tau of consensus rounds at N = 100 (log scale), with the value of exact averaging.',
      x: { type: 'linear', domain: [-0.5, 10.5], ticks: [0, 1, 2, 3, 5, 10], name: '*τ*', title: '*τ*', math: true },
      panels: [
        { id: 'main', y: Object.assign({}, Y_ID, { domain: [0.0105, 0.6], ticks: [0.02, 0.05, 0.1, 0.2, 0.5] }), series: [
          { key: 'coop', sty: 'coop', label: 'together', on: true, band: true, get: (R) => R.B.tau.id },
          { key: 'exact', sty: 'exactL', label: 'exact averaging', on: true, hline: true, get: (R) => R.B.tau.idExact },
        ] },
        { id: 'rmse', toggle: 'rmsePanel', y: { type: 'linear', title: 'tracking RMSE', tip: 'tracking RMSE' }, series: [
          { key: 'coopR', link: 'coop', sty: 'coop', label: 'together', get: (R) => R.B.tau.rmse },
          { key: 'exactR', link: 'exact', sty: 'exactL', label: 'exact averaging', hline: true,
            get: (R) => { const e = R.B.rmse.exact, j = e.x.indexOf(100); return { x: [0, 10], median: [e.median[j], e.median[j]], src: e.src }; } },
        ] },
      ],
      toggles: [{ key: 'rmsePanel', sty: 'panel', label: 'tracking RMSE', extra: true, panel: true }],
      tableCaption: '*N* = 100: ‖*Â*^{(*i*)} − *A*‖_{F} (median over 50 trials and 8 servers, interquartile range below) and tracking RMSE (median over 50 trials). Exact averaging is *τ* = ∞.',
    },
    'r-agree': {
      requires: 'REC',
      alt: 'Line chart: share of user-days on which the first screen holds the products of the ideal boosts, versus N (log scale), medians with interquartile bands over 50 trials, together, alone, persistence and frozen boosts.',
      x: XN,
      panels: [{ id: 'main', y: { type: 'linear', title: 'ideal first screens (%)', tip: 'ideal first screens (%)', domain: [40, 100] }, series: [
        S('coop3', (R) => R.REC.mc.agree.coop3, { on: true, band: true }),
        S('local', (R) => R.REC.mc.agree.local, { on: true, band: true }),
        S('persistence', (R) => R.REC.mc.agree.persistence, { on: true }),
        S('frozen', (R) => R.REC.mc.agree.frozen, { on: true }),
        S('oracleA', (R) => R.REC.mc.agree.oracleA, { extra: true }),
        S('exact', (R) => R.REC.mc.agree.exact, { extra: true }),
        S('centralized', (R) => R.REC.mc.agree.centralized, { extra: true }),
        S('pooledLS', (R) => R.REC.mc.agree.pooledLS, { extra: true }),
        S('coop1', (R) => R.REC.mc.agree.coop1, { extra: true }),
        S('oracleKF', (R) => R.REC.mc.agree.oracleKF, { extra: true }),
      ] }],
      tableCaption: 'Share of user-days (%) on which the first screen holds the same eight products as under the ideal boosts *x*^{⋆}(*t*), in any order, over *t* from *N* + 50 to *N* + 199: median over 50 trials, interquartile range below.',
    },
    'r-forecast': {
      requires: 'REC',
      alt: 'Line chart: RMSE of the forecasts of the interests versus N, both axes log scale, medians with interquartile bands over 50 trials, together, alone, persistence and the oracle that knows A.',
      x: XN,
      panels: [{ id: 'main', y: { type: 'log', title: 'forecast RMSE', tip: 'forecast RMSE', domain: [0.075, 1.0], ticks: [0.1, 0.2, 0.5, 1] }, series: [
        S('coop3', (R) => R.REC.mc.forecast.coop3, { on: true, band: true }),
        S('local', (R) => R.REC.mc.forecast.local, { on: true, band: true }),
        S('persistence', (R) => R.REC.mc.forecast.persistence, { on: true }),
        S('oracleA', (R) => R.REC.mc.forecast.oracleA, { on: true }),
        S('exact', (R) => R.REC.mc.forecast.exact, { extra: true }),
        S('pooledLS', (R) => R.REC.mc.forecast.pooledLS, { extra: true }),
        S('coop1', (R) => R.REC.mc.forecast.coop1, { extra: true }),
        S('oracleKF', (R) => R.REC.mc.forecast.oracleKF, { extra: true }),
      ] }],
      tableCaption: 'RMSE of the forecasts of the interests, per genre, over *t* from *N* + 50 to *N* + 199: median over 50 trials, interquartile range below.',
    },
    'r-mix': {
      requires: 'REC',
      alt: 'Line chart: error of the genre shares of the first-screen slots in percentage points versus N, both axes log scale, medians with interquartile bands over 50 trials, together, alone, persistence and frozen boosts.',
      x: XN,
      panels: [{ id: 'main', y: { type: 'log', title: 'genre-mix error (pp)', tip: 'genre-mix error (pp)', domain: [0.18, 4], ticks: [0.2, 0.5, 1, 2] }, series: [
        S('coop3', (R) => R.REC.mc.exposure.coop3, { on: true, band: true }),
        S('local', (R) => R.REC.mc.exposure.local, { on: true, band: true }),
        S('persistence', (R) => R.REC.mc.exposure.persistence, { on: true }),
        S('frozen', (R) => R.REC.mc.exposure.frozen, { on: true }),
        S('oracleA', (R) => R.REC.mc.exposure.oracleA, { extra: true }),
        S('exact', (R) => R.REC.mc.exposure.exact, { extra: true }),
        S('pooledLS', (R) => R.REC.mc.exposure.pooledLS, { extra: true }),
        S('coop1', (R) => R.REC.mc.exposure.coop1, { extra: true }),
      ] }],
      tableCaption: 'Mean absolute error of the genre shares of the first-screen slots (four genres, every region), in percentage points, over *t* from *N* + 50 to *N* + 199: median over 50 trials, interquartile range below.',
    },
    'w-rmse': {
      alt: 'Line chart: tracking RMSE in units of 10 m versus N, both axes log scale, medians with interquartile bands over the 20 runs of each N, with the oracle that knows A.',
      x: XN,
      panels: [{ id: 'main', y: Object.assign({}, Y_RMSE, { type: 'log' }), series: [
        S('coop3', (R) => R.W.rmse.coop, { key: 'coop', on: true, band: true }),
        S('local', (R) => R.W.rmse.local, { on: true, band: true }),
        S('oracleA', (R) => R.W.rmse.oracle, { key: 'oracle', on: true }),
        S('exact', (R) => R.W.rmse.exact, { extra: true }),
        S('persistence', (R) => R.W.rmse.persistence, { extra: true }),
      ] }],
      tableCaption: 'Tracking RMSE (10 m): median over the 20 runs of each *N*, interquartile range below. Alone, exact averaging, the oracle and persistence are replayed on the telemetry of each run.',
    },
    'w-id': {
      alt: 'Line chart: identification error versus N, both axes log scale, medians with interquartile bands over the 120 (run, station) pairs of each N.',
      x: XN,
      panels: [{ id: 'main', y: Object.assign({}, Y_ID), series: [
        S('coop3', (R) => R.W.id.coop, { key: 'coop', on: true, band: true }),
        S('local', (R) => R.W.id.local, { on: true, band: true }),
        S('exact', (R) => R.W.id.exact, { extra: true }),
      ] }],
      tableCaption: '‖*Â*^{(*i*)} − *A*‖_{F}: median over the 20 runs × 6 stations of each *N*, interquartile range below. Alone and exact averaging are replayed on the telemetry of each run.',
    },
    'w-seeds': {
      kind: 'strip',
      alt: 'Strip chart: tracking RMSE in units of 10 m of every Webots run, together and alone, 20 seeds for each N, log scale, with the medians marked.',
      keysHint: 'Plot: the arrow keys step through the runs',
      x: { title: '*N*', math: true },
      y: { type: 'log', title: 'tracking RMSE (10 m)' },
      series: [
        { key: 'coop', sty: 'dcoop', label: 'together', on: true },
        { key: 'local', sty: 'dlocal', label: 'alone', on: true },
        { key: 'median', sty: 'median', label: 'median', on: true },
      ],
      tableCaption: 'Tracking RMSE (10 m) of every run. Alone is replayed on the telemetry of the run.',
    },
  };

  // ------------------------------------------------------------------ boot
  const charts = [];
  function init() {
    const mounts = document.querySelectorAll('[data-chart]');
    if (!mounts.length) return;
    const R = window.RESULTS;
    mounts.forEach((m) => {
      if (m.__chart) return;
      const id = m.getAttribute('data-chart');
      const def = DEFS[id];
      if (!def) { if (window.console) console.warn('charts.js: unknown chart id', id); return; }
      if (!R || !R.A || !R.B || !R.W || (def.requires && !R[def.requires])) {
        m.classList.add('ch-root');
        el('p', { class: 'ch-error' }, m, 'The data of this figure did not load.');
        return;
      }
      try {
        const c = new Chart(m, id, def, R);
        m.__chart = c;
        charts.push(c);
        c.render(false);
      } catch (err) {
        if (window.console) console.error('charts.js: chart ' + id + ' failed', err);
      }
    });
    let pending = false;
    const rerender = (all) => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        charts.forEach((c) => {
          if (all === true || Math.floor(c.plot.getBoundingClientRect().width) !== c.w) { c.render(false); c.fitLegend(); }
        });
      });
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => rerender(false));
      charts.forEach((c) => ro.observe(c.body));
    } else window.addEventListener('resize', () => rerender(false));
    // web fonts change text widths (tick labels, legend): lay out again once they are in
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => rerender(true));
    window.addEventListener('beforeprint', () => charts.forEach((c) => c.render(false)));
    document.addEventListener('pointerdown', (e) => {
      charts.forEach((c) => {
        if (c.hover && !c.plot.contains(e.target)) c.setHover(null);
        if (c.pop && !c.pop.hidden && !c.pop.contains(e.target) && e.target !== c.moreBtn) c.openPop(false);
      });
    });
  }
  window.CoopCharts = { render: () => charts.forEach((c) => c.render(false)), charts, defs: DEFS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
