/* Interactive Webots simulation of the project page, mounted in <div id="webots-sim" class="ws">.
 *
 * ES module without dependencies.  It loads data/run.js (window.RUN, the logs of the recorded run)
 * and, when the section comes near the viewport, the self-hosted Webots web player
 * (vendor/webots/wwi/R2025a) with the recorded 3D animation (webots/disaster_response.*).
 * One clock drives the 3D view, the top view and the panels.
 *
 * Timing of the animation (checked against the logs by make_run.py): frame k is shown at
 * 32 (k - 1) ms; the gold beam shows x*(t) on frames 10t .. 10t + 9, so the step on screen is
 * t = floor(frame / 10); seeking to step t shows frame 10t + 1.  A UAV reaches b_i(t) on frame
 * 10t + 9, the pin of station i shows x_i(t) on frames 10t - 6 .. 10t + 3, and the charging
 * robot is at c(t) on frame 10t - 1. */

const HERE = import.meta.url;
const href = (p) => new URL(p, HERE).href;
const PATHS = {
  run: href('../../data/run.js'),
  player: href('../../vendor/webots/wwi/R2025a/WebotsView.js'),
  world: href('../../vendor/webots/wwi/R2025a/nodes/WbWorld.js'),
  mouse: href('../../vendor/webots/wwi/R2025a/MouseEvents.js'),
  w3d: href('../../webots/disaster_response.w3d'),
  anim: href('../../webots/disaster_response.json'),
  poster: href('../../media/webots-3d.jpg'),
};
const BYTES = { w3d: 450271, anim: 4730462 };     // uncompressed sizes, for the progress ring

const FPS = 10;                 // animation frames per algorithm step
const MS = 32;                  // milliseconds per animation frame
const FOV = 1.05;               // Viewpoint.fieldOfView of the scene (horizontal when wider than tall)
const SCENE_M = 0.5;            // metres per paper unit in the diorama
const BEAM_NODE = 'n3729';
const COLORS = ['#e63333', '#338cf2', '#33bf4d', '#f2a61a', '#b34dd9', '#1abfcc'];
const SPEEDS = [0.5, 1, 2, 4];
const DEFAULT_SPEED = 2;
const LEARN_HOLD = 16;          // steps during which the "t = N" line stays up
const LOAD_TIMEOUT = 20000;
const CHART_Y = [0.02, 12];     // distance chart, log scale (paper units)
const BAR_X = [0.005, 0.3];     // station error bars, log scale

/* Convex hulls (metres, world frame, z up) of what the default 3D camera keeps in view: every UAV
 * over the whole run (recharge flights included), the charging robot over the whole run, and the
 * six stations; r is the radius of the object around each point. */
const HULL = [
  { r: 0.36, p: [[-2.4, -2.8, 3.5], [-2.4, -2.0, 3.5], [-2.3, -3.2, 3.5], [-2.3, -1.6, 3.5], [-2.1, -3.6, 3.5], [-1.7, -4.2, 3.5], [-1.4, -4.6, 3.5], [-1.0, -4.9, 3.5], [-0.7, -5.1, 3.5], [-0.5, -5.6, 3.8], [-0.3, 6.3, 3.8], [-0.1, -5.9, 3.9], [0.2, -6.5, 3.9], [0.2, 6.8, 3.9], [0.3, -6.6, 3.9], [0.9, -7.0, 3.9], [1.0, 4.5, 0.5], [1.0, 4.6, 0.5], [1.3, 4.6, 0.5], [1.7, 7.2, 3.9], [1.8, -7.0, 3.9], [1.8, 7.2, 3.9], [2.3, -6.8, 3.9], [2.3, 7.1, 3.9], [2.7, 6.9, 3.9], [3.2, 3.3, 0.5], [3.2, 6.6, 3.9], [4.4, 5.7, 3.9], [4.6, 1.2, 0.5], [4.7, 0.7, 0.5], [4.7, 1.0, 0.5], [5.0, -5.1, 3.9], [5.2, -4.9, 3.9], [5.6, -4.2, 3.9], [6.4, -2.4, 3.9], [7.2, 2.0, 3.9], [7.4, 1.6, 3.9], [7.5, 0.3, 3.9], [7.6, 0.7, 3.9]] },
  { r: 0.62, p: [[-0.2, -5.4, 0.3], [-0.2, -6.2, 0.3], [0.0, -7.4, 0.3], [3.5, -3.2, 0.3], [4.2, -1.7, 0.3], [4.7, 0.2, 0.3], [4.7, 1.0, 0.3], [3.8, 2.7, 0.3], [2.9, 3.9, 0.3], [2.4, 4.4, 0.3], [2.0, 4.6, 0.3], [1.5, 4.7, 0.3], [0.2, 4.7, 0.3]] },
  { r: 0.45, p: [[-6.6, 0.0, 0.4], [-3.3, -5.7, 0.4], [-3.3, 5.7, 0.4], [3.3, -5.7, 0.4], [3.3, 5.7, 0.4], [6.6, 0.0, 0.4]] },
];

/* ------------------------------------------------------------------------------ small helpers */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, u) => a + (b - a) * u;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; };
const MINUS = '−';
const fmt = (v, d) => (v < 0 ? MINUS : '') + Math.abs(v).toFixed(d);

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

const ICON = {
  play: '<path d="M8.2 5.3v13.4L19 12z" fill="currentColor"/>',
  pause: '<path d="M7 5h3.6v14H7zM13.4 5H17v14h-3.6z" fill="currentColor"/>',
  replay: '<path d="M12 5a7 7 0 1 1-6.7 5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/><path d="M4.2 4.6v5.6h5.6" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  fit: '<path d="M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
  bolt: '<path d="M13.2 2.5 5 13.6h6.2l-1.1 7.9 8.4-11.3h-6.3z" fill="currentColor"/>',
  back: '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
};
const icon = (name, cls = 'ws-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
}

let runPromise = null;
function loadRun() {
  if (window.RUN) return Promise.resolve(window.RUN);
  if (!runPromise) runPromise = loadScript(PATHS.run).then(() => {
    if (!window.RUN) throw new Error('data/run.js did not define RUN');
    return window.RUN;
  });
  return runPromise;
}

async function fetchText(u, onBytes) {
  const res = await fetch(u);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + u);
  if (!res.body || !res.body.getReader) {
    const text = await res.text();
    onBytes(text.length);
    return text;
  }
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    onBytes(n);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return new TextDecoder().decode(all);
}

function hasWebGL2() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------------------------ camera */

function camBasis(yawDeg, pitchDeg) {
  const y = yawDeg * Math.PI / 180;
  const p = pitchDeg * Math.PI / 180;
  const f = [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), -Math.sin(p)];
  const r = unit(cross(f, [0, 0, 1]));
  const u = cross(r, f);
  return { f, r, u };
}

/* Closest camera with look direction (yaw, pitch) that keeps every hull point (with its radius)
 * inside the view with the given margins in pixels; centred between the binding constraints. */
function fitCamera(w, h, view) {
  const aspect = w / h;
  const { f, r, u } = camBasis(view.yaw, view.pitch);
  const th = Math.tan(FOV / 2);
  const tx = aspect >= 1 ? th : th * aspect;
  const ty = aspect >= 1 ? th / aspect : th;
  const kx = tx * (1 - 2 * view.side / w);
  const kt = ty * (1 - 2 * view.top / h);
  const kb = ty * (1 - 2 * view.bottom / h);
  let a0 = -Infinity, a1 = -Infinity, a2 = -Infinity, a3 = -Infinity;
  for (const g of HULL) {
    const cx = g.r * Math.sqrt(1 + kx * kx), ct = g.r * Math.sqrt(1 + kt * kt), cb = g.r * Math.sqrt(1 + kb * kb);
    for (const X of g.p) {
      const xr = dot(X, r), xu = dot(X, u), xf = dot(X, f);
      a0 = Math.max(a0, cx + xr - kx * xf);
      a1 = Math.max(a1, cx - xr - kx * xf);
      a2 = Math.max(a2, ct + xu - kt * xf);
      a3 = Math.max(a3, cb - xu - kb * xf);
    }
  }
  const gam = Math.min(-(a0 + a1) / (2 * kx), -(a2 + a3) / (kt + kb));
  const al = (a0 - a1) / 2;
  const be = (a2 - a3 + (kt - kb) * gam) / 2;
  return { P: [al * r[0] + be * u[0] + gam * f[0], al * r[1] + be * u[1] + gam * f[1], al * r[2] + be * u[2] + gam * f[2]], f };
}

/* Webots viewpoint orientation (axis-angle; camera x forward, z up) looking along f. */
function orientationAlong(f) {
  const x = unit(f);
  const y = unit(cross([0, 0, 1], x));
  const z = cross(x, y);
  const tr = x[0] + y[1] + z[2];
  const ang = Math.acos(clamp((tr - 1) / 2, -1, 1));
  const ax = unit([y[2] - z[1], z[0] - x[2], x[1] - y[0]]);
  return [ax[0], ax[1], ax[2], ang];
}

function rotateAxisAngle(o, v) {
  const k = unit([o[0], o[1], o[2]]);
  const c = Math.cos(o[3]), s = Math.sin(o[3]);
  const kv = dot(k, v);
  const kxv = cross(k, v);
  return [0, 1, 2].map((i) => v[i] * c + kxv[i] * s + k[i] * kv * (1 - c));
}

/* Look directions of the default 3D camera: three-quarter view from the south-east; steeper on
 * tall viewports so that the ring of stations fills them. */
function viewFor(w, h) {
  const aspect = w / h;
  if (aspect >= 1.35) return { yaw: -55, pitch: 42, side: 12, top: 50, bottom: 14 };
  if (aspect >= 1.05) return { yaw: -55, pitch: 48, side: 12, top: 50, bottom: 14 };
  return { yaw: -45, pitch: 60, side: 10, top: 64, bottom: 12 };
}

/* --------------------------------------------------------------------------------- component */

class WebotsSim {
  constructor(root) {
    this.root = root;
    this.reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.pos = 0;                  // animation frame (continuous while playing)
    this.t = -1;                   // step shown in the panels
    this.playing = false;
    this.ended = false;
    this.speed = DEFAULT_SPEED;
    this.view = '3d';
    this.selected = -1;
    this.visible = false;
    this.mostly = false;
    this.autoPaused = false;
    this.autoplayDone = false;
    this.userActed = false;
    this.wantPlay = false;
    this.armed = false;            // wheel zooms only after a click in the view (or with ctrl/cmd)
    this.state3d = 'idle';         // idle | loading | ready | failed
    this.userCam3d = false;
    this.userCamTop = false;
    this.top = { k: 20, ox: 0, oy: 0 };
    this.raf = 0;
    this.lastNow = 0;
    this.phaseKey = '';
    this.flightKey = '';
    this.build();
    this.observe();
    loadRun().then((run) => this.onRun(run)).catch((err) => this.onRunError(err));
  }

  /* -------------------------------------------------------------------------------- DOM */

  build() {
    const root = this.root;
    root.classList.add('ws', 'ws--loading-data');
    root.textContent = '';

    // viewport
    this.layer3d = h('div', { class: 'ws-layer ws-layer--3d' });
    this.topCanvas = h('canvas', { class: 'ws-layer ws-layer--top', role: 'img', 'aria-label': 'Top view of the Webots run' });
    this.posterImg = h('img', { class: 'ws-poster-img', src: PATHS.poster, alt: '', decoding: 'async', loading: 'lazy', width: '1200', height: '630' });
    this.posterImg.addEventListener('error', () => this.poster.classList.add('ws-poster--noimg'));
    this.poster = h('div', { class: 'ws-poster', 'aria-hidden': 'true' }, this.posterImg);
    this.phaseText = h('span', { class: 'ws-chip-text' });
    this.phaseChip = h('span', { class: 'ws-chip ws-chip--phase', 'data-phase': 'collect' }, h('i', { class: 'ws-chip-dot' }), this.phaseText);
    this.flightText = h('span', { class: 'ws-chip-text' });
    this.flightChip = h('span', { class: 'ws-chip ws-chip--flight', hidden: true }, h('span', { class: 'ws-chip-bolt', html: icon('bolt') }), this.flightText);
    this.live = h('span', { class: 'ws-sr', 'aria-live': 'polite' });
    this.hud = h('div', { class: 'ws-hud' }, this.phaseChip, this.flightChip);
    this.ring = h('span', { class: 'ws-ring', html: '<svg viewBox="0 0 80 80" aria-hidden="true"><circle class="ws-ring-bg" cx="40" cy="40" r="37"/><circle class="ws-ring-fg" cx="40" cy="40" r="37" pathLength="100"/></svg>' });
    this.bigPlay = h('button', { class: 'ws-bigplay', type: 'button', 'aria-label': 'Play the simulation' }, this.ring, h('span', { class: 'ws-bigplay-icon', html: icon('play') }));
    this.loadNote = h('span', { class: 'ws-loadnote', 'aria-live': 'polite' });
    this.center = h('div', { class: 'ws-center' }, this.bigPlay, this.loadNote);
    this.msg = h('p', { class: 'ws-msg', hidden: true, role: 'status' });
    this.toast = h('p', { class: 'ws-toast', 'aria-hidden': 'true' });
    this.stage = h('div', {
      class: 'ws-stage', tabindex: '0', role: 'group', 'aria-roledescription': 'simulation viewer',
      'aria-label': 'Webots simulation. Space plays or pauses, the arrow keys step.',
    }, this.layer3d, this.poster, this.hud, this.center, this.msg, this.toast, this.live, h('span', { class: 'ws-viewtag', text: '3D' }));
    this.topBox = h('div', { class: 'ws-topbox' }, this.topCanvas, h('span', { class: 'ws-viewtag', text: 'Top view' }));

    // control bar
    this.playBtn = h('button', { class: 'ws-btn ws-btn--play', type: 'button', 'aria-label': 'Play', html: icon('play') });
    this.rail = h('div', { class: 'ws-rail' });
    this.fill = h('div', { class: 'ws-fill' });
    this.thumb = h('div', { class: 'ws-thumb' });
    this.flightMarks = h('div', { class: 'ws-flights' });
    this.track = h('div', {
      class: 'ws-track', role: 'slider', tabindex: '0', 'aria-label': 'Simulation step t',
      'aria-valuemin': '0', 'aria-valuemax': '299', 'aria-valuenow': '0',
    }, this.rail, this.fill, h('div', { class: 'ws-nmark' }), this.flightMarks, this.thumb);
    this.tip = h('span', { class: 'ws-tip', 'aria-hidden': 'true' });
    this.tlLabels = h('div', { class: 'ws-tl-labels', 'aria-hidden': 'true' });
    this.timeline = h('div', { class: 'ws-timeline' }, this.track, this.tlLabels, this.tip);
    this.tNow = h('span', { class: 'ws-time-now', text: '0' });
    this.tMax = h('span', { class: 'ws-time-max', text: '299' });
    this.timeOut = h('span', { class: 'ws-time', 'aria-hidden': 'true' }, h('i', { text: 't' }), ' = ', this.tNow, h('span', { class: 'ws-time-sep', text: ' / ' }), this.tMax);
    this.speedSel = h('select', { class: 'ws-select', 'aria-label': 'Playback speed' },
      SPEEDS.map((s) => h('option', { value: String(s), selected: s === DEFAULT_SPEED, text: (s === 0.5 ? '0.5' : String(s)) + '×' })));
    this.btn3d = h('button', { class: 'ws-seg', type: 'button', 'aria-pressed': 'true', text: '3D' });
    this.btnTop = h('button', { class: 'ws-seg', type: 'button', 'aria-pressed': 'false', text: 'Top' });
    this.viewSwitch = h('div', { class: 'ws-switch', role: 'group', 'aria-label': 'View' }, this.btn3d, this.btnTop);
    this.resetBtn = h('button', { class: 'ws-btn ws-btn--icon', type: 'button', 'aria-label': 'Reset camera', title: 'Reset camera', html: icon('fit') });
    this.tools = h('div', { class: 'ws-tools' }, this.timeOut, this.speedSel, this.resetBtn);
    this.bar = h('div', { class: 'ws-bar' }, this.playBtn, this.timeline, this.tools);

    // panels
    this.panes = h('div', { class: 'ws-panes' }, this.buildStations(), this.buildChart(), this.buildLegend());
    this.console = h('div', { class: 'ws-console' }, this.bar, this.panes);
    this.views = h('div', { class: 'ws-views' }, this.stage, this.topBox);
    root.append(this.views, this.console);
    this.syncStage();
    this.bind();
  }

  buildStations() {
    this.stList = h('div', { class: 'ws-st-list' });
    this.stFoot = h('p', { class: 'ws-st-foot' });
    this.stTicks = h('span', { class: 'ws-st-ticks' });
    this.stAxis = h('div', { class: 'ws-st-axis', 'aria-hidden': 'true' }, h('span'), h('span'), h('span'), this.stTicks);
    this.stCols = h('div', { class: 'ws-st-cols', 'aria-hidden': 'true' },
      h('span'), h('span'), h('span', { text: 'telemetry' }), h('span', { html: '‖<i>Â</i> − <i>A</i>‖<sub>F</sub>, log' }));
    this.stMain = h('div', { class: 'ws-st-main' }, this.stCols, this.stList, this.stAxis, this.stFoot);
    this.stDetail = h('div', { class: 'ws-st-detail', hidden: true });
    this.stKey = h('span', { class: 'ws-key' },
      h('span', { class: 'ws-key-item' }, h('i', { class: 'ws-sw ws-sw--coop' }), 'together'),
      h('span', { class: 'ws-key-item' }, h('i', { class: 'ws-sw ws-sw--local' }), 'alone'),
      h('span', { class: 'ws-key-item ws-key-item--exact' }, h('i', { class: 'ws-sw ws-sw--exact' }), 'exact averaging'));
    return h('section', { class: 'ws-pane ws-pane--stations', 'aria-label': 'Stations' },
      h('header', { class: 'ws-pane-head' }, h('h3', { class: 'ws-pane-title', text: 'Stations' }), this.stKey),
      this.stMain, this.stDetail);
  }

  buildChart() {
    this.vTrack = h('b', { class: 'ws-val', text: '–' });
    this.vRobot = h('b', { class: 'ws-val', text: '–' });
    this.chart = h('canvas', { class: 'ws-chart', role: 'img', 'aria-label': 'Distance to the best position x*(t) over the run, log scale: RMS over the stations of their choices x_i(t), and the charging robot.' });
    return h('section', { class: 'ws-pane ws-pane--chart', 'aria-label': 'Distance to the best position' },
      h('header', { class: 'ws-pane-head' },
        h('h3', { class: 'ws-pane-title', html: 'Distance to <i>x</i><sup class="ws-star">⋆</sup>(<i>t</i>)' }),
        h('span', { class: 'ws-pane-note', text: 'units, log scale' })),
      h('div', { class: 'ws-chart-key' },
        h('span', { class: 'ws-key-item' }, h('i', { class: 'ws-ln ws-ln--st' }), 'stations, RMS ', this.vTrack),
        h('span', { class: 'ws-key-item' }, h('i', { class: 'ws-ln ws-ln--rb' }), 'robot ', this.vRobot)),
      h('div', { class: 'ws-chart-box' }, this.chart));
  }

  buildLegend() {
    // 3D and top-view drawings of the same thing; CSS shows the one of the active view
    const sw = (inner, top) => h('span', { class: 'ws-lg-sw' + (top ? ' ws-lg-sw--two' : ''),
      html: `<svg class="ws-lg-3d" viewBox="0 0 36 22" aria-hidden="true">${inner}</svg>` +
        (top ? `<svg class="ws-lg-top" viewBox="0 0 36 22" aria-hidden="true">${top}</svg>` : '') });
    const items = [
      [sw('<ellipse cx="18" cy="17.5" rx="6" ry="2.2" fill="#ffd34d"/><rect x="16.6" y="3" width="2.8" height="14.5" rx="1.2" fill="#ffd966" opacity=".9"/>',
        '<circle cx="18" cy="11" r="8" fill="#ffd64d" opacity=".35"/><circle cx="18" cy="11" r="5.2" fill="none" stroke="#ffcf3a" stroke-width="1.8"/><circle cx="18" cy="11" r="1.8" fill="#ffcf3a"/>'),
        h('span', { html: '<i>x</i><sup class="ws-star">⋆</sup>(<i>t</i>) best position' })],
      [sw('<line x1="18" y1="7" x2="18" y2="17.5" stroke="#f4f4f4" stroke-width="1.6"/><circle cx="18" cy="6.5" r="3.4" fill="#e63333" stroke="#fff" stroke-width="1"/><ellipse cx="18" cy="18" rx="3" ry="1.1" fill="#e63333"/>',
        '<circle cx="18" cy="11" r="3.6" fill="#e63333" stroke="#fff" stroke-width="1.2"/>'),
        h('span', { html: '<i>x<sub>i</sub></i>(<i>t</i>) station <i>i</i>’s choice' })],
      [sw('<line x1="4" y1="14" x2="32" y2="8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>'),
        h('span', { text: 'radio link' })],
      [sw('<line x1="4" y1="16" x2="32" y2="6" stroke="#ffe55c" stroke-width="1.8" stroke-linecap="round"/>'),
        h('span', { html: 'telemetry, <i>t</i> &lt; <i>N</i>' })],
      [sw('<rect x="9" y="6.5" width="18" height="10" rx="2.2" fill="#f2f3f5" stroke="#3a3a3a" stroke-width=".9"/><rect x="14" y="8.5" width="8" height="6" rx="1" fill="#c9ccd2"/><circle cx="12" cy="18" r="1.6" fill="#222"/><circle cx="24" cy="18" r="1.6" fill="#222"/>'),
        h('span', { text: 'charging robot' })],
      [sw('<circle cx="8" cy="15" r="1.7" fill="#ff7a1a"/><circle cx="14" cy="13" r="1.7" fill="#ff7a1a"/><circle cx="20" cy="12" r="1.7" fill="#ff7a1a"/><circle cx="27" cy="9" r="1.4" fill="#1abfcc"/><circle cx="31" cy="12" r="1.4" fill="#1abfcc"/>'),
        h('span', { text: 'recent tracks' })],
    ];
    return h('section', { class: 'ws-pane ws-pane--legend', 'aria-label': 'Legend' },
      h('header', { class: 'ws-pane-head' }, h('h3', { class: 'ws-pane-title', text: 'Legend' })),
      h('ul', { class: 'ws-legend' }, items.map(([s, l]) => h('li', null, s, l))));
  }

  /* ------------------------------------------------------------------------------ events */

  bind() {
    this.tick = this.tick.bind(this);
    this.playBtn.addEventListener('click', () => { this.userActed = true; this.togglePlay(); });
    this.bigPlay.addEventListener('click', () => { this.userActed = true; this.play(); });
    this.speedSel.addEventListener('change', () => { this.speed = Number(this.speedSel.value) || 1; });
    this.btn3d.addEventListener('click', () => { this.userActed = true; this.setView('3d'); });
    this.btnTop.addEventListener('click', () => { this.userActed = true; this.setView('top'); });
    this.resetBtn.addEventListener('click', () => this.resetCamera());
    this.root.addEventListener('keydown', (e) => this.onKey(e));

    // timeline: click, drag, keyboard
    const seekFromX = (clientX) => {
      const r = this.track.getBoundingClientRect();
      const u = clamp((clientX - r.left) / Math.max(1, r.width), 0, 1);
      return clamp(Math.floor(u * this.T), 0, this.T - 1);
    };
    this.track.addEventListener('pointerdown', (e) => {
      if (!this.run || e.button > 0) return;
      e.preventDefault();
      this.track.focus({ preventScroll: true });
      this.track.setPointerCapture(e.pointerId);
      this.dragging = { resume: this.playing };
      if (this.playing) this.pause(false);
      this.userActed = true;
      this.seekT(seekFromX(e.clientX));
      this.track.classList.add('is-dragging');
    });
    this.track.addEventListener('pointermove', (e) => {
      if (!this.run) return;
      if (this.dragging) this.seekT(seekFromX(e.clientX));
      if (e.pointerType === 'mouse') this.showTip(e.clientX, seekFromX(e.clientX));
    });
    const endDrag = () => {
      if (!this.dragging) return;
      const resume = this.dragging.resume;
      this.dragging = null;
      this.track.classList.remove('is-dragging');
      if (resume && this.pos < this.endPos) this.play();
    };
    this.track.addEventListener('pointerup', endDrag);
    this.track.addEventListener('pointercancel', endDrag);
    this.track.addEventListener('pointerleave', () => { this.tip.classList.remove('is-on'); });

    // stage: wheel policy, touch policy, arming
    this.stage.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.ws-center, .ws-hud')) return;
      this.armed = true;
      this.downAt = { x: e.clientX, y: e.clientY };
    });
    this.stage.addEventListener('pointermove', (e) => {
      // a drag in the 3D view moves the camera: keep it on resize from now on
      if (this.downAt && e.buttons && this.view === '3d' && this.state3d === 'ready' &&
        Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) > 4) this.userCam3d = true;
    });
    this.stage.addEventListener('pointerup', () => { this.downAt = null; });
    this.stage.addEventListener('pointerleave', () => { this.armed = false; });
    this.stage.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    this.topBox.addEventListener('pointerdown', () => { this.armed = true; });
    this.topBox.addEventListener('pointerleave', () => { this.armed = false; });
    this.topBox.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    this.stage.addEventListener('touchstart', (e) => {
      // one finger scrolls the page; two fingers orbit and zoom the scene
      if (e.touches.length < 2) e.stopPropagation();
      else this.userCam3d = true;
    }, { capture: true, passive: true });
    this.stage.addEventListener('touchmove', (e) => {
      if (e.touches.length >= 2) e.preventDefault();
    }, { passive: false });
    this.bindTopView();

    // station rows (delegated)
    this.stList.addEventListener('click', (e) => {
      const row = e.target.closest('.ws-st');
      if (row) this.select(Number(row.dataset.i), true);
    });
    this.stDetail.addEventListener('click', (e) => {
      if (e.target.closest('.ws-back')) this.select(-1, true);
    });

    window.addEventListener('scroll', () => { this.lastScroll = performance.now(); }, { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.autoPause();
      else if (this.visible) this.autoResume();
    });
  }

  observe() {
    const io = (cb, opts) => (typeof IntersectionObserver === 'function' ? new IntersectionObserver(cb, opts) : null);
    this.nearObs = io((entries) => {
      if (entries.some((en) => en.isIntersecting)) {
        this.nearObs.disconnect();
        this.load3d();
      }
    }, { rootMargin: '900px 0px 900px 0px' });
    if (this.nearObs) this.nearObs.observe(this.root);
    else setTimeout(() => this.load3d(), 0);

    this.visObs = io((entries) => {
      const en = entries[entries.length - 1];
      this.visible = en.isIntersecting;
      this.mostly = en.intersectionRatio >= 0.45;
      if (!this.visible) { this.armed = false; this.autoPause(); }
      else this.autoResume();
      this.maybeAutoplay();
    }, { threshold: [0, 0.45, 0.8] });
    if (this.visObs) this.visObs.observe(this.stage);
    else { this.visible = true; this.mostly = true; }

    if (typeof ResizeObserver === 'function') {
      this.ro = new ResizeObserver(() => {
        if (this.roPending) return;
        this.roPending = requestAnimationFrame(() => { this.roPending = 0; this.onResize(); });
      });
      this.ro.observe(this.stage);
      this.ro.observe(this.topBox);
      this.ro.observe(this.chart);
    } else {
      window.addEventListener('resize', () => this.onResize());
    }
  }

  onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || !this.run) return;
    const tgt = e.target;
    const onStage = tgt === this.stage;
    const onTrack = tgt === this.track;
    if (!onStage && !onTrack) return;          // buttons and the select keep their own keys
    const big = e.shiftKey ? 10 : 1;
    let handled = true;
    switch (e.key) {
      case ' ':
      case 'Spacebar':
      case 'k':
      case 'K':
        this.userActed = true;
        this.togglePlay();
        break;
      case 'ArrowLeft':
        this.stepBy(-big);
        break;
      case 'ArrowRight':
        this.stepBy(big);
        break;
      case 'ArrowDown':
        if (onTrack) this.stepBy(-big); else handled = false;
        break;
      case 'ArrowUp':
        if (onTrack) this.stepBy(big); else handled = false;
        break;
      case 'PageDown':
        if (onTrack) this.stepBy(-10); else handled = false;
        break;
      case 'PageUp':
        if (onTrack) this.stepBy(10); else handled = false;
        break;
      case 'Home':
        this.userActed = true;
        this.pause();
        this.seekT(0);
        break;
      case 'End':
        this.userActed = true;
        this.pause();
        this.seekT(this.T - 1);
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  stepBy(d) {
    this.userActed = true;
    this.pause();
    this.seekT(clamp(this.tOf(this.pos) + d, 0, this.T - 1));
  }

  onWheel(e) {
    // Webots never sees the wheel: the page scrolls unless the view was clicked first (or ctrl/cmd,
    // which is also what a trackpad pinch sends)
    e.stopPropagation();
    const zoomIt = this.armed || e.ctrlKey || e.metaKey;
    if (!zoomIt) {
      // a wheel gesture that starts over the view (not one that scrolls the page onto it)
      if (!this.lastScroll || performance.now() - this.lastScroll > 400) this.hint('Click the view, then scroll to zoom');
      return;
    }
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 400;
    const factor = Math.exp(clamp(dy, -240, 240) * (e.ctrlKey && !this.armed ? 0.01 : 0.0022));
    if (this.topBox.contains(e.target)) this.zoomTop(factor, e.clientX, e.clientY);
    else this.zoom3d(factor);
  }

  hint(text) {
    const now = performance.now();
    if (this.hintUntil && now < this.hintUntil + 6000) return;
    const r = this.stage.getBoundingClientRect();
    const vis = (Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0)) / Math.max(1, r.height);
    if (vis < 0.7) return;
    this.hintUntil = now + 1600;
    this.toast.textContent = text;
    this.toast.classList.add('is-on');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove('is-on'), 1600);
  }

  /* -------------------------------------------------------------------------------- data */

  onRun(run) {
    this.run = run;
    this.T = run.T;
    this.N = run.N;
    this.endPos = FPS * (run.T - 1) + FPS - 1;
    this.root.classList.remove('ws--loading-data');
    this.tMax.textContent = String(run.T - 1);
    this.track.setAttribute('aria-valuemax', String(run.T - 1));
    this.prepare();
    this.fillTimeline();
    this.fillStations();
    this.onResize();
    this.render(true);
    this.maybeAutoplay();
  }

  onRunError(err) {
    console.error('[webots-sim]', err);
    this.root.classList.add('ws--error');
    this.msg.textContent = 'The simulation data did not load.';
    this.msg.hidden = false;
  }

  prepare() {
    const R = this.run;
    const T = R.T;
    const n = R.agencies.length;
    this.n = n;
    const pick = (arr, t, i) => (i == null ? [arr[2 * t], arr[2 * t + 1]] : [arr[12 * t + 2 * i], arr[12 * t + 2 * i + 1]]);
    this.pick = pick;
    this.flights = (R.flights || []).map((f) => ({
      ...f,
      short: f.agency === 'Search & rescue' ? 'S&R' : f.agency.toLowerCase(),
      name: f.agency === 'Search & rescue' ? 'Search & rescue' : f.agency,
    }));
    // everything the top view keeps in frame (paper units)
    const pts = R.stations.map((p) => [p[0], p[1]]);
    for (let t = 0; t < T; t++) {
      pts.push(pick(R.c, t), pick(R.xs, t));
      for (let i = 0; i < n; i++) pts.push(pick(R.b, t, i));
    }
    for (const f of this.flights) for (const p of f.path) pts.push([p[0], p[1]]);
    this.topPts = pts;
    this.setTopYaw(viewFor(16, 9).yaw);
    // log-scaled error series for the chart
    this.series = {
      track: R.err.track.map(Number),
      robot: R.err.robot.map(Number),
    };
    // window RMSE on [150, 300)
    const w = R.summary.window || [150, 300];
    let acc = 0;
    for (let t = w[0]; t < w[1]; t++) acc += this.series.track[t] ** 2;
    this.windowRmse = Math.sqrt(acc / (w[1] - w[0]));
    this.window = w;
  }

  /* The top view is drawn in the ground frame of the default 3D camera (screen up = camera
   * forward), so both views put the stations in the same places. */
  setTopYaw(yaw) {
    this.topYaw = yaw;
    const y = yaw * Math.PI / 180;
    this.fx = [Math.sin(y), Math.cos(y)];
    this.rx = [Math.cos(y), -Math.sin(y)];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of this.topPts) {
      const sx = p[0] * this.rx[0] + p[1] * this.rx[1];
      const sy = p[0] * this.fx[0] + p[1] * this.fx[1];
      x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
    }
    this.bounds = { x0: x0 - 1.4, x1: x1 + 1.4, y0: y0 - 1.6, y1: y1 + 1.4 };
  }

  fillTimeline() {
    const T = this.T, N = this.N;
    const pct = (t) => (100 * t / T).toFixed(3) + '%';
    this.track.style.setProperty('--n', pct(N));
    const labels = [
      h('span', { class: 'ws-tl-lab ws-tl-lab--collect', style: 'left:0', text: 'collect' }),
      h('span', { class: 'ws-tl-lab ws-tl-lab--n', style: `left:${pct(N)}`, html: '<i>N</i>' }),
      h('span', { class: 'ws-tl-lab ws-tl-lab--track', style: `left:${pct(N)}`, text: 'track' }),
    ];
    this.flightMarks.textContent = '';
    for (const f of this.flights) {
      const c = COLORS[f.i];
      const title = `${f.name} drone recharges, t = ${Math.round(f.t0)}–${Math.round(f.t1)}`;
      this.flightMarks.append(h('span', { class: 'ws-fl', style: `left:${pct(f.t0)};width:${(100 * (f.t1 - f.t0) / T).toFixed(3)}%;--c:${c}`, title }));
      labels.push(h('span', { class: 'ws-tl-lab ws-tl-lab--fl', style: `left:${pct(f.t0)};--c:${c}` },
        h('span', { class: 'ws-tl-bolt', html: icon('bolt') }), f.short));
    }
    this.tlLabels.textContent = '';
    this.tlLabels.append(...labels);
  }

  fillStations() {
    const R = this.run;
    const span = Math.log(BAR_X[1] / BAR_X[0]);
    const bx = (v) => clamp(Math.log(Math.max(v, BAR_X[0]) / BAR_X[0]) / span, 0.02, 1);
    const ex = Number(R.summary.idExact) || 0;
    this.stRows = [];
    this.stList.textContent = '';
    R.agencies.forEach((name, i) => {
      const coop = Number(R.idCoop[i]);
      const local = Number(R.idLocal[i]);
      const row = h('button', {
        class: 'ws-st', type: 'button', 'data-i': String(i), style: `--c:${COLORS[i]}`,
        'aria-label': `${name}: show its estimate of A`,
      },
      h('i', { class: 'ws-st-dot' }),
      h('span', { class: 'ws-st-name', text: name }),
      h('span', { class: 'ws-st-tele' }, h('i', { class: 'ws-tele', title: 'telemetry' })),
      h('span', { class: 'ws-bars', title: `together ${coop.toFixed(4)}, alone ${local.toFixed(4)}` + (ex ? `, exact averaging ${ex.toFixed(4)} (every station)` : '') },
        h('i', { class: 'ws-ebar ws-ebar--coop', style: `--w:${(100 * bx(coop)).toFixed(2)}%` }),
        h('i', { class: 'ws-ebar ws-ebar--local', style: `--w:${(100 * bx(local)).toFixed(2)}%` }),
        ex ? h('i', { class: 'ws-exmark', style: `left:${(100 * bx(ex)).toFixed(2)}%` }) : null));
      this.stRows.push(row);
      this.stList.append(row);
    });
    this.stTicks.textContent = '';
    for (const v of [0.01, 0.1]) {
      this.stTicks.append(h('span', { style: `left:${(100 * bx(v)).toFixed(2)}%`, text: String(v) }));
    }
    const s = R.summary;
    this.footLearned = `mean <b class="ws-c-coop">${Number(s.idCoop).toFixed(4)}</b> together, <b class="ws-c-local">${Number(s.idLocal).toFixed(4)}</b> alone (${Number(s.ratio).toFixed(1)}×)` +
      (s.idExact ? `<br>exact averaging <b class="ws-c-coop">${Number(s.idExact).toFixed(4)}</b>, the same for every station` : '');
    this.footBefore = `<i>Â</i> is learned at <i>t</i> = <i>N</i> = ${this.N}`;
  }

  /* ---------------------------------------------------------------------- 3D (Webots) */

  async load3d() {
    if (this.state3d !== 'idle') return;
    if (this.webgl === undefined) this.webgl = hasWebGL2();
    if (!this.webgl) {
      this.fail3d('3D view unavailable here (WebGL 2 is off).');
      return;
    }
    this.state3d = 'loading';
    this.root.classList.add('ws--3d-loading');
    this.syncStage();
    this.bytes = { w3d: 0, anim: 0 };
    this.playerDone = false;
    this.setProgress();
    this.loadTimer = setTimeout(() => {
      if (this.state3d === 'loading') {
        this.slow = true;
        this.showMsg('The 3D view is still loading.');
        if (this.wantPlay) {
          this.wantPlay = false;
          this.root.classList.remove('ws--want-play');
          this.play();
        }
      }
    }, LOAD_TIMEOUT);
    this.errorListener = (ev) => {
      const src = (ev && ev.filename) || '';
      if (this.state3d === 'loading' && src.indexOf('/vendor/webots/') >= 0) this.fail3d('The 3D view failed to load.');
    };
    window.addEventListener('error', this.errorListener);
    try {
      const player = import(PATHS.player)
        .then(() => Promise.all([import(PATHS.world), import(PATHS.mouse).catch(() => null)]))
        .then(([world, mouse]) => {
          this.WbWorld = world.default;
          this.mouseEvents = mouse ? mouse.default : null;
          this.playerDone = true;
          this.setProgress();
        });
      const w3d = fetchText(PATHS.w3d, (n) => { this.bytes.w3d = n; this.setProgress(); });
      const anim = fetchText(PATHS.anim, (n) => { this.bytes.anim = n; this.setProgress(); });
      const [, w3dText, animText] = await Promise.all([player, w3d, anim]);
      if (this.state3d !== 'loading') return;
      const json = JSON.parse(animText);
      this.frames = json.frames.length;
      await this.mount3d(w3dText, json);
    } catch (err) {
      console.error('[webots-sim]', err);
      this.fail3d('The 3D view failed to load.');
    }
  }

  setProgress() {
    const b = this.bytes || { w3d: 0, anim: 0 };
    const frac = (Math.min(b.w3d, BYTES.w3d) + Math.min(b.anim, BYTES.anim)) / (BYTES.w3d + BYTES.anim);
    const p = this.state3d === 'ready' ? 1 : Math.min(0.97, 0.82 * frac + (this.playerDone ? 0.1 : 0) + (this.mounting ? 0.05 : 0));
    if (!this.ringFg) this.ringFg = this.ring.querySelector('.ws-ring-fg');
    if (this.ringFg) this.ringFg.style.strokeDasharray = (100 * p).toFixed(1) + ' 100';
    if (this.state3d === 'loading') this.loadNote.textContent = 'Loading 3D scene · ' + Math.round(100 * p) + '%';
    else this.loadNote.textContent = '';
  }

  mount3d(w3dText, json) {
    return new Promise((resolve, reject) => {
      this.mounting = true;
      this.setProgress();
      const el = document.createElement('webots-view');
      el.setAttribute('aria-hidden', 'true');
      this.el = el;
      this.layer3d.append(el);
      el.onready = () => {
        try {
          this.on3dReady();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      el.loadAnimation(w3dText, json, false, undefined, PATHS.poster, true);
    });
  }

  /* The Webots renderer sizes its canvas in CSS pixels; render at the device pixel ratio instead
   * (at most 2, and at most about 3.4 million pixels), and map mouse positions to canvas pixels
   * for picking. */
  hiDPI() {
    const ren = this.w3d && this.w3d.renderer;
    const cv = this.canvas3d;
    if (!ren || !cv || this.mouseEvents === undefined) return;
    const scaleFor = (w, h) => {
      const d = Math.min(window.devicePixelRatio || 1, 2);
      return Math.max(1, Math.min(d, Math.sqrt(3.4e6 / Math.max(1, w * h))));
    };
    ren.setSize = (w, h) => {
      const d = scaleFor(w, h);
      cv.width = Math.max(1, Math.round(w * d));
      cv.height = Math.max(1, Math.round(h * d));
      cv.style.width = w + 'px';
      cv.style.height = h + 'px';
    };
    const ME = this.mouseEvents;
    if (ME && !ME.wsScaled && typeof ME.convertMouseEventPositionToRelativePosition === 'function') {
      const orig = ME.convertMouseEventPositionToRelativePosition;
      ME.convertMouseEventPositionToRelativePosition = (el, x, y) => {
        const p = orig(el, x, y);
        const r = el.getBoundingClientRect();
        if (r.width > 0 && el.width) {
          const s = el.width / r.width;
          p.x = Math.round(p.x * s);
          p.y = Math.round(p.y * s);
        }
        return p;
      };
      ME.wsScaled = true;
    }
    this.el.resize();
  }

  on3dReady() {
    const el = this.el;
    const tb = el.toolbar;
    if (tb) {
      // the Webots toolbar listens to K and F on the whole document; this page has its own controls
      if (tb.keydownRefK) document.removeEventListener('keydown', tb.keydownRefK);
      if (tb.keydownRefF) document.removeEventListener('keydown', tb.keydownRefF);
    }
    this.anim = el._view.animation;
    this.w3d = el._view.w3dScene;
    this.anim.gui = 'pause';
    this.frames = this.anim.data.frames.length;
    this.canvas3d = el.querySelector('canvas');
    if (this.canvas3d) {
      this.canvas3d.setAttribute('aria-hidden', 'true');
      this.canvas3d.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        this.fail3d('The 3D view stopped (graphics context lost).');
      });
    }
    this.hiDPI();
    this.anim.updateAnimationState(2);
    this.anim.updateAnimationState(0);
    this.frame3d = 0;
    clearTimeout(this.loadTimer);
    window.removeEventListener('error', this.errorListener);
    this.state3d = 'ready';
    this.mounting = false;
    this.root.classList.remove('ws--3d-loading');
    this.root.classList.add('ws--3d-ready');
    this.syncStage();
    this.btn3d.disabled = false;
    this.setProgress();
    this.fit3d();
    if (this.slow) {
      this.slow = false;
      this.hideMsg();
    }
    this.render(true);
    if (this.wantPlay) {
      this.wantPlay = false;
      this.play();
    } else {
      this.maybeAutoplay();
    }
  }

  fail3d(message) {
    if (this.state3d === 'failed') return;
    const wasReady = this.state3d === 'ready';
    this.state3d = 'failed';
    clearTimeout(this.loadTimer);
    if (this.errorListener) window.removeEventListener('error', this.errorListener);
    this.root.classList.remove('ws--3d-loading', 'ws--3d-ready');
    this.root.classList.add('ws--3d-failed');
    this.btn3d.disabled = true;
    this.btn3d.title = '3D view unavailable';
    this.showMsg(message);
    this.setView('top', true);
    if (wasReady && this.layer3d) this.layer3d.style.visibility = 'hidden';
    if (this.wantPlay) {
      this.wantPlay = false;
      this.play();
    } else {
      this.maybeAutoplay();
    }
  }

  showMsg(text) {
    this.msg.textContent = text;
    this.msg.hidden = false;
  }

  hideMsg() {
    this.msg.hidden = true;
  }

  w3dRender() {
    if (this.w3d) this.w3d.render();
  }

  fit3d() {
    if (this.state3d !== 'ready') return;
    const r = this.stage.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    const view = viewFor(r.width, r.height);
    const { P, f } = fitCamera(r.width, r.height, view);
    this.setCam3d(P, orientationAlong(f));
    this.userCam3d = false;
  }

  setCam3d(P, o) {
    const vp = this.WbWorld && this.WbWorld.instance && this.WbWorld.instance.viewpoint;
    if (!vp) return;
    vp.position = new vp.position.constructor(P[0], P[1], P[2]);
    vp.orientation = new vp.orientation.constructor(o[0], o[1], o[2], o[3]);
    vp.updatePosition();
    vp.updateOrientation();
    this.w3dRender();
  }

  zoom3d(factor) {
    const vp = this.WbWorld && this.WbWorld.instance && this.WbWorld.instance.viewpoint;
    if (!vp || this.state3d !== 'ready') return;
    const P = [vp.position.x, vp.position.y, vp.position.z];
    const o = [vp.orientation.x, vp.orientation.y, vp.orientation.z, vp.orientation.w];
    const f = rotateAxisAngle(o, [1, 0, 0]);
    let pivot = [0, 0, 0];
    if (f[2] < -0.05) {
      const s = -P[2] / f[2];
      pivot = [P[0] + s * f[0], P[1] + s * f[1], 0];
    }
    const d = Math.hypot(P[0] - pivot[0], P[1] - pivot[1], P[2] - pivot[2]);
    const k = clamp(d * factor, 1.5, 70) / Math.max(d, 1e-6);
    const Q = [pivot[0] + (P[0] - pivot[0]) * k, pivot[1] + (P[1] - pivot[1]) * k, pivot[2] + (P[2] - pivot[2]) * k];
    vp.position = new vp.position.constructor(Q[0], Q[1], Q[2]);
    vp.updatePosition();
    this.userCam3d = true;
    this.w3dRender();
  }

  /* ------------------------------------------------------------------------- the clock */

  tOf(pos) {
    return clamp(Math.floor(pos / FPS), 0, (this.T || 300) - 1);
  }

  seekT(t) {
    this.seekPos(FPS * t + 1);
  }

  seekPos(p) {
    if (!this.run) return;
    this.pos = clamp(p, 0, this.endPos);
    this.ended = false;
    this.dropPoster();
    this.render();
  }

  play() {
    if (!this.run) {
      this.wantPlay = true;
      return;
    }
    if (this.state3d !== 'ready' && this.state3d !== 'failed' && !this.slow) {
      // wait for the scene
      this.wantPlay = true;
      this.root.classList.add('ws--want-play');
      this.load3d();
      return;
    }
    if (this.playing) return;
    if (this.ended || this.pos >= this.endPos) {
      this.pos = 0;
      this.ended = false;
    }
    this.playing = true;
    this.autoPaused = false;
    this.wantPlay = false;
    this.root.classList.remove('ws--want-play');
    this.root.classList.add('ws--playing');
    this.dropPoster();
    this.syncPlay();
    this.lastNow = performance.now();
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause(clearAuto = true) {
    if (clearAuto) this.autoPaused = false;
    this.wantPlay = false;
    this.root.classList.remove('ws--want-play');
    if (!this.playing) return;
    this.playing = false;
    this.root.classList.remove('ws--playing');
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.syncPlay();
  }

  togglePlay() {
    if (this.playing || this.wantPlay) this.pause();
    else this.play();
  }

  autoPause() {
    if (this.playing) {
      this.pause(false);
      this.autoPaused = true;
    }
  }

  autoResume() {
    if (this.autoPaused && !document.hidden && this.visible) {
      this.autoPaused = false;
      this.play();
    }
  }

  maybeAutoplay() {
    if (this.autoplayDone || this.userActed || this.reduced || !this.run) return;
    if ((this.state3d !== 'ready' && this.state3d !== 'failed') || !this.mostly || document.hidden) return;
    this.autoplayDone = true;
    this.play();
  }

  syncPlay() {
    const ended = !this.playing && this.ended;
    this.playBtn.innerHTML = icon(this.playing ? 'pause' : ended ? 'replay' : 'play');
    this.playBtn.setAttribute('aria-label', this.playing ? 'Pause' : ended ? 'Replay' : 'Play');
  }

  tick(now) {
    if (!this.playing) return;
    const dt = Math.min(100, Math.max(0, now - this.lastNow));
    this.lastNow = now;
    this.pos += dt * this.speed / MS;
    if (this.pos >= this.endPos) {
      this.pos = this.endPos;
      this.playing = false;
      this.ended = true;
      this.root.classList.remove('ws--playing');
      this.syncPlay();
      this.render();
      return;
    }
    this.render();
    this.raf = requestAnimationFrame(this.tick);
  }

  dropPoster() {
    if (!this.posterGone && !(this.view === '3d' && this.state3d !== 'ready')) this.posterGone = true;
    this.syncStage();
  }

  /* What covers the viewport: the poster until the live 3D view has started (and whenever the 3D
   * view is shown before its scene is ready), and the play button, with the loading ring, before
   * the start or while the scene loads in the 3D view. */
  syncStage() {
    const in3d = this.view === '3d';
    const loading = in3d && (this.state3d === 'loading' || this.state3d === 'idle');
    this.root.classList.toggle('ws--show-poster', in3d && (this.state3d !== 'ready' || !this.posterGone));
    this.root.classList.toggle('ws--show-center', loading || !this.posterGone);
  }

  /* ---------------------------------------------------------------------------- render */

  render(force) {
    if (!this.run) return;
    const pos = this.pos;
    if (this.view === '3d' && this.state3d === 'ready' && this.posterGone) {
      const frame = clamp(Math.floor(pos), 0, this.frames - 1);
      if (frame !== this.frame3d || force) {
        this.anim.updateAnimationState(frame);
        this.frame3d = frame;
        if (force) this.w3dRender();
      }
    }
    this.drawTop();
    // timeline (continuous)
    const p = clamp(pos / FPS / this.T, 0, 1);
    const ps = (100 * p).toFixed(3) + '%';
    this.fill.style.setProperty('--p', ps);
    this.thumb.style.left = ps;
    const t = this.tOf(pos);
    if (t !== this.t || force) {
      this.t = t;
      this.updatePanels(t);
    }
    this.updateChips(t, pos);
  }

  updateChips(t, pos) {
    const N = this.N;
    const key = t < N ? 'collect' : t < N + LEARN_HOLD ? 'learn' : 'track';
    if (key !== this.phaseKey) {
      this.phaseKey = key;
      this.phaseChip.dataset.phase = key;
      const html = key === 'collect' ? 'Collecting: each station reads only its own drone'
        : key === 'learn' ? '<i>t</i> = <i>N</i>: telemetry stops, stations average their moments'
          : 'Tracking with the learned model';
      this.phaseText.innerHTML = html;
      this.live.textContent = this.phaseText.textContent;
    }
    let fl = null;
    for (const f of this.flights) if (pos >= f.frame0 && pos <= f.frame1) fl = f;
    const fkey = fl ? fl.agency : '';
    if (fkey !== this.flightKey) {
      this.flightKey = fkey;
      this.flightChip.hidden = !fl;
      if (fl) {
        this.flightChip.style.setProperty('--c', COLORS[fl.i]);
        this.flightText.textContent = `${fl.name} drone recharging`;
      }
    }
  }

  updatePanels(t) {
    const N = this.N;
    this.tNow.textContent = String(t);
    this.track.setAttribute('aria-valuenow', String(t));
    const phase = t < N ? 'collecting' : 'tracking';
    this.track.setAttribute('aria-valuetext', `t = ${t}, ${phase}`);
    const learned = t >= N;
    if (learned !== this.learned) {
      this.learned = learned;
      this.root.classList.toggle('ws--learned', learned);
      this.stFoot.innerHTML = learned ? this.footLearned : this.footBefore;
      if (this.selected >= 0) {
        const hadFocus = this.stDetail.contains(document.activeElement);
        this.renderDetail();
        const back = this.stDetail.querySelector('.ws-back');
        if (hadFocus && back) back.focus({ preventScroll: true });
      }
    }
    this.vTrack.textContent = this.series.track[t].toFixed(2);
    this.vRobot.textContent = this.series.robot[t].toFixed(2);
    this.drawChart();
  }

  /* --------------------------------------------------------------------------- stations */

  /* Show station i's estimates in the stations panel (i < 0: the list).  moveFocus is set when
   * the change comes from the panel itself, so that keyboard focus follows it. */
  select(i, moveFocus) {
    this.selected = i;
    this.stRows.forEach((r, k) => r.setAttribute('aria-pressed', k === i ? 'true' : 'false'));
    if (i < 0) {
      this.stDetail.hidden = true;
      this.stMain.hidden = false;
      if (moveFocus && this.lastSelected >= 0) this.stRows[this.lastSelected].focus({ preventScroll: true });
    } else {
      this.lastSelected = i;
      this.renderDetail();
      this.stMain.hidden = true;
      this.stDetail.hidden = false;
      const back = this.stDetail.querySelector('.ws-back');
      if (moveFocus && back) back.focus({ preventScroll: true });
    }
    this.drawTop();
  }

  renderDetail() {
    const R = this.run;
    const i = this.selected;
    if (i < 0) return;
    const mat = (M, cls) => h('span', { class: 'ws-mat ' + (cls || '') },
      h('span', { text: fmt(M[0][0], 3) }), h('span', { text: fmt(M[0][1], 3) }),
      h('span', { text: fmt(M[1][0], 3) }), h('span', { text: fmt(M[1][1], 3) }));
    const head = h('div', { class: 'ws-dt-head' },
      h('button', { class: 'ws-back', type: 'button', 'aria-label': 'Back to all stations', html: icon('back') }),
      h('i', { class: 'ws-st-dot', style: `--c:${COLORS[i]}` }),
      h('b', { class: 'ws-dt-name', text: R.agencies[i] }));
    const err = (v) => `‖<i>Â</i> − <i>A</i>‖<sub>F</sub> <b>${Number(v).toFixed(4)}</b>`;
    let body;
    if (this.t >= this.N) {
      body = h('div', { class: 'ws-mats' },
        h('div', { class: 'ws-m ws-m--coop' }, h('span', { class: 'ws-m-cap', html: '<i>Â</i> together' }), mat(R.Ahat[i]),
          h('span', { class: 'ws-m-err', html: err(R.idCoop[i]) })),
        h('div', { class: 'ws-m ws-m--local' }, h('span', { class: 'ws-m-cap', html: '<i>Â</i> alone' }), mat(R.Alocal[i]),
          h('span', { class: 'ws-m-err', html: err(R.idLocal[i]) })),
        h('div', { class: 'ws-m ws-m--true' }, h('span', { class: 'ws-m-cap', html: 'true <i>A</i>' }), mat(R.A)));
    } else {
      body = h('p', { class: 'ws-dt-wait', html: this.footBefore + '.' });
    }
    this.stDetail.textContent = '';
    this.stDetail.append(head, body);
  }

  /* ------------------------------------------------------------------------------ chart */

  drawChart() {
    const cv = this.chart;
    if (!cv || !this.series) return;
    const w = cv.clientWidth, hgt = cv.clientHeight;
    if (w < 20 || hgt < 20) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(hgt * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const T = this.T, N = this.N, t = Math.max(0, this.t);
    const L = 30, Rm = 8, Tp = 8, B = 19;
    const pw = w - L - Rm, ph = hgt - Tp - B;
    const lo = Math.log(CHART_Y[0]), hi = Math.log(CHART_Y[1]);
    const X = (k) => L + pw * k / T;
    const Y = (v) => Tp + ph * (1 - (Math.log(clamp(v, CHART_Y[0], CHART_Y[1])) - lo) / (hi - lo));
    ctx.font = '500 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    ctx.textBaseline = 'middle';
    // collect phase band
    ctx.fillStyle = 'rgba(224, 161, 0, 0.09)';
    ctx.fillRect(X(0), Tp, X(N) - X(0), ph);
    // grid + y labels
    ctx.strokeStyle = '#ececec';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#7a7a7a';
    ctx.textAlign = 'right';
    for (const v of [0.1, 1, 10]) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L + pw, y);
      ctx.stroke();
      ctx.fillText(String(v), L - 6, y);
    }
    // x labels
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (const k of [0, 100, 200, 300]) {
      const lab = k === N ? 'N' : String(k);
      ctx.font = k === N ? 'italic 500 11px Georgia, "Times New Roman", serif' : '500 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
      ctx.fillText(lab, clamp(X(k), L + 4, L + pw - 8), hgt - 5);
    }
    // N line
    ctx.strokeStyle = '#bdbdbd';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(Math.round(X(N)) + 0.5, Tp);
    ctx.lineTo(Math.round(X(N)) + 0.5, Tp + ph);
    ctx.stroke();
    ctx.setLineDash([]);
    // window RMSE
    const yR = Y(this.windowRmse);
    ctx.strokeStyle = 'rgba(0, 114, 178, 0.55)';
    ctx.setLineDash([1.5, 2.5]);
    ctx.beginPath();
    ctx.moveTo(X(this.window[0]), yR);
    ctx.lineTo(X(this.window[1]), yR);
    ctx.stroke();
    ctx.setLineDash([]);
    // series
    const line = (arr, color, width, from, to, alpha) => {
      if (to < from) return;
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let k = from; k <= to; k++) {
        const x = X(k + 0.5), y = Y(arr[k]);
        if (k === from) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    const S = this.series;
    line(S.robot, '#8a8a8a', 1.2, t, T - 1, 0.28);
    line(S.track, '#0072b2', 1.5, t, T - 1, 0.25);
    line(S.robot, '#6e6e6e', 1.3, 0, t, 1);
    line(S.track, '#0072b2', 1.8, 0, t, 1);
    // playhead
    const xp = X(t + 0.5);
    ctx.strokeStyle = 'rgba(54, 54, 54, 0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(xp) + 0.5, Tp);
    ctx.lineTo(Math.round(xp) + 0.5, Tp + ph);
    ctx.stroke();
    const dotAt = (v, color) => {
      ctx.beginPath();
      ctx.arc(xp, Y(v), 3.2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    };
    dotAt(S.robot[t], '#6e6e6e');
    dotAt(S.track[t], '#0072b2');
    // the window RMSE label last, on its white halo, so that no line crosses it
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '600 10px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
    const rmseLabel = 'RMSE ' + this.windowRmse.toFixed(3);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.strokeText(rmseLabel, X(this.window[1]) - 1, yR - 5);
    ctx.fillStyle = '#0a5a8c';
    ctx.fillText(rmseLabel, X(this.window[1]) - 1, yR - 5);
  }

  /* --------------------------------------------------------------------------- top view */

  bindTopView() {
    const cv = this.topCanvas;
    const pts = new Map();
    let pan = null;
    let pinch = null;
    let down = null;
    cv.addEventListener('pointerdown', (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      down = { x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      if (e.pointerType === 'mouse') {
        cv.setPointerCapture(e.pointerId);
        pan = { x: e.clientX, y: e.clientY, ox: this.top.ox, oy: this.top.oy };
        cv.classList.add('is-panning');
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: this.top.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, ox: this.top.ox, oy: this.top.oy };
        down = null;
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (pts.has(e.pointerId)) pts.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.moved = true;
      if (pan) {
        const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
        this.top.ox = pan.ox - (dx * this.rx[0] - dy * this.fx[0]) / this.top.k;
        this.top.oy = pan.oy - (dx * this.rx[1] - dy * this.fx[1]) / this.top.k;
        this.userCamTop = true;
        this.drawTop();
      } else if (pinch && pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = clamp(pinch.k * d / Math.max(pinch.d, 1), this.topFitK * 0.6, this.topFitK * 6);
        this.top.k = k;
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        // keep the world point under the start midpoint under the current midpoint
        const r = cv.getBoundingClientRect();
        const wx0 = this.screenToWorldAt(pinch.cx - r.left, pinch.cy - r.top, pinch.ox, pinch.oy, pinch.k);
        const s = this.worldToScreenAt(wx0[0], wx0[1], pinch.ox, pinch.oy, k);
        const dx = (cx - r.left) - s[0], dy = (cy - r.top) - s[1];
        this.top.ox = pinch.ox - (dx * this.rx[0] - dy * this.fx[0]) / k;
        this.top.oy = pinch.oy - (dx * this.rx[1] - dy * this.fx[1]) / k;
        this.userCamTop = true;
        this.drawTop();
      }
    });
    const up = (e) => {
      if (down && down.id === e.pointerId && !down.moved) this.pickTop(e.clientX, e.clientY);
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pan && e.pointerType === 'mouse') {
        pan = null;
        cv.classList.remove('is-panning');
      }
      down = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', (e) => {
      pts.delete(e.pointerId);
      pinch = null;
      pan = null;
      down = null;
      cv.classList.remove('is-panning');
    });
    cv.addEventListener('dblclick', () => this.fitTop(true));
  }

  worldToScreenAt(x, y, ox, oy, k) {
    const w = this.topW, hh = this.topH;
    const dx = x - ox, dy = y - oy;
    return [w / 2 + k * (dx * this.rx[0] + dy * this.rx[1]), hh / 2 - k * (dx * this.fx[0] + dy * this.fx[1])];
  }

  screenToWorldAt(sx, sy, ox, oy, k) {
    const a = (sx - this.topW / 2) / k;          // along rx
    const b = -(sy - this.topH / 2) / k;         // along fx
    return [ox + a * this.rx[0] + b * this.fx[0], oy + a * this.rx[1] + b * this.fx[1]];
  }

  fitTop(user) {
    if (!this.bounds || !this.topW) return;
    const b = this.bounds;
    const padX = 14, padTop = viewFor(this.topW, this.topH).top + 4, padBottom = 14;
    const k = Math.min((this.topW - 2 * padX) / (b.x1 - b.x0), (this.topH - padTop - padBottom) / (b.y1 - b.y0));
    this.topFitK = k;
    this.top.k = k;
    // centre of the bounds in the rotated frame, shifted down a little for the chips
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2 + (padTop - padBottom) / 2 / k;
    this.top.ox = cx * this.rx[0] + cy * this.fx[0];
    this.top.oy = cx * this.rx[1] + cy * this.fx[1];
    if (user) this.userCamTop = false;
    this.drawTop();
  }

  zoomTop(factor, clientX, clientY) {
    const r = this.topCanvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    const wpt = this.screenToWorldAt(sx, sy, this.top.ox, this.top.oy, this.top.k);
    const k = clamp(this.top.k / factor, (this.topFitK || 10) * 0.6, (this.topFitK || 10) * 6);
    this.top.k = k;
    const s = this.worldToScreenAt(wpt[0], wpt[1], this.top.ox, this.top.oy, k);
    this.top.ox -= ((sx - s[0]) * this.rx[0] - (sy - s[1]) * this.fx[0]) / k;
    this.top.oy -= ((sx - s[0]) * this.rx[1] - (sy - s[1]) * this.fx[1]) / k;
    this.userCamTop = true;
    this.drawTop();
  }

  pickTop(clientX, clientY) {
    if (!this.run) return;
    const r = this.topCanvas.getBoundingClientRect();
    const sx = clientX - r.left, sy = clientY - r.top;
    let best = -1, bestD = 18;
    const st = this.run.stations;
    for (let i = 0; i < this.n; i++) {
      const s = this.S(st[i][0], st[i][1]);
      const d = Math.hypot(s[0] - sx, s[1] - sy);
      if (d < bestD) { best = i; bestD = d; }
      const u = this.uavAt(i, this.pos);
      const q = this.S(u[0], u[1]);
      const d2 = Math.hypot(q[0] - sx, q[1] - sy);
      if (d2 < bestD) { best = i; bestD = d2; }
    }
    if (best >= 0) this.select(best === this.selected ? -1 : best);
  }

  S(x, y) {
    return this.worldToScreenAt(x, y, this.top.ox, this.top.oy, this.top.k);
  }

  /* positions at the animation frame pos (continuous), with the timing of the 3D animation */
  uavAt(i, pos) {
    const R = this.run;
    for (const f of this.flights) {
      if (f.i === i && pos >= f.frame0 && pos <= f.frame1) {
        const u = (pos - f.frame0) / f.every;
        const k = Math.min(Math.floor(u), f.path.length - 1);
        const a = f.path[k], b = f.path[Math.min(k + 1, f.path.length - 1)];
        const fr = clamp(u - k, 0, 1);
        return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr), lerp(a[2], b[2], fr)];
      }
    }
    const s = clamp((pos + 1) / FPS - 1, 0, this.T - 1);
    const k = Math.floor(s), fr = s - k;
    const a = this.pick(R.b, k, i), b = this.pick(R.b, Math.min(k + 1, this.T - 1), i);
    return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr), 3.5];
  }

  stepTween(arr, pos, offset, i) {
    // value shown from frame 10t + offset on, eased in over the first frame
    const q = (pos - offset) / FPS;
    const t = clamp(Math.floor(q), 0, this.T - 1);
    const prev = Math.max(0, t - 1);
    const u = clamp((q - Math.floor(q)) * FPS, 0, 1);
    const a = this.pick(arr, prev, i), b = this.pick(arr, t, i);
    if (q < 0) return this.pick(arr, 0, i);
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  }

  robotAt(pos) {
    const s = clamp((pos + 1) / FPS, 0, this.T - 1);
    const k = Math.floor(s), fr = s - k;
    const a = this.pick(this.run.c, k), b = this.pick(this.run.c, Math.min(k + 1, this.T - 1));
    return [lerp(a[0], b[0], fr), lerp(a[1], b[1], fr)];
  }

  drawTop() {
    const R = this.run;
    const cv = this.topCanvas;
    if (!R || !this.topW) return;
    const w = this.topW, hh = this.topH;
    const dpr = this.topDpr;
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pos = this.pos;
    const t = this.tOf(pos);
    const k = this.top.k;
    const S = (x, y) => this.S(x, y);
    const sc = R.scene || {};
    const z = clamp(k / 17, 0.8, 1.7);           // icon scale with zoom

    // ground
    ctx.fillStyle = '#5c8150';
    ctx.fillRect(0, 0, w, hh);
    const c0 = S(0, 0);
    const field = ctx.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], 21 * k);
    field.addColorStop(0, '#86965a');
    field.addColorStop(0.55, '#76905a');
    field.addColorStop(0.9, '#68895a');
    field.addColorStop(1, 'rgba(92, 129, 80, 0)');
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, w, hh);
    // tufts
    if (sc.tufts) {
      ctx.fillStyle = 'rgba(38, 74, 32, 0.55)';
      for (const p of sc.tufts) {
        const s = S(p[0], p[1]);
        ctx.fillRect(s[0] - 1.3 * z, s[1] - 1.3 * z, 2.6 * z, 2.6 * z);
      }
    }
    const rect = (r, color) => {
      // [cx, cy, w, h] axis-aligned in world units, drawn as a rotated polygon
      const hx = r[2] / 2, hy = r[3] / 2;
      const q = [[r[0] - hx, r[1] - hy], [r[0] + hx, r[1] - hy], [r[0] + hx, r[1] + hy], [r[0] - hx, r[1] + hy]].map((p) => S(p[0], p[1]));
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(q[0][0], q[0][1]);
      for (let j = 1; j < 4; j++) ctx.lineTo(q[j][0], q[j][1]);
      ctx.closePath();
      ctx.fill();
    };
    const disk = (d, color) => {
      const s = S(d[0], d[1]);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(s[0], s[1], d[2] * k, 0, Math.PI * 2);
      ctx.fill();
    };
    if (sc.road) rect(sc.road, '#9b7350');
    if (sc.pad) rect(sc.pad, '#a48c5f');
    if (sc.scorch) {
      const s = S(sc.scorch[0], sc.scorch[1]);
      const g = ctx.createRadialGradient(s[0], s[1], 0, s[0], s[1], sc.scorch[2] * k * 1.25);
      g.addColorStop(0, 'rgba(255, 196, 92, 0.55)');
      g.addColorStop(0.75, 'rgba(255, 170, 70, 0.18)');
      g.addColorStop(1, 'rgba(255, 170, 70, 0)');
      disk(sc.scorch, '#b36a32');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(s[0], s[1], sc.scorch[2] * k * 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
    if (sc.char) disk(sc.char, '#91531f');
    if (sc.ruins) for (const r of sc.ruins) rect(r, r[4] > 0.5 ? '#4b3b34' : '#5e4a3f');
    if (sc.pad) {
      // helipad mark
      const s = S(sc.pad[0], sc.pad[1]);
      ctx.strokeStyle = 'rgba(255, 236, 170, 0.75)';
      ctx.lineWidth = 1.4 * z;
      ctx.beginPath();
      ctx.arc(s[0], s[1], 0.9 * k, 0, Math.PI * 2);
      ctx.stroke();
    }

    const st = R.stations;
    // radio links
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    for (const [a, b] of R.edges) {
      const p = S(st[a][0], st[a][1]), q = S(st[b][0], st[b][1]);
      ctx.beginPath();
      ctx.moveTo(p[0], p[1]);
      ctx.lineTo(q[0], q[1]);
      ctx.stroke();
    }
    // tracks: robot (orange) and drones (their colour)
    const n = this.n;
    const sNow = clamp((pos + 1) / FPS - 1, 0, this.T - 1);
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = COLORS[i];
      for (let q = Math.max(0, Math.floor(sNow) - 34); q <= Math.floor(sNow); q += 2) {
        const p = this.pick(R.b, q, i);
        const s = S(p[0], p[1]);
        ctx.globalAlpha = 0.18 + 0.6 * (1 - (sNow - q) / 34);
        ctx.beginPath();
        ctx.arc(s[0], s[1], 1.5 * z, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const rNow = clamp((pos + 1) / FPS, 0, this.T - 1);
    ctx.fillStyle = '#ff7a1a';
    for (let q = Math.max(0, Math.floor(rNow) - 70); q <= Math.floor(rNow); q += 2) {
      const p = this.pick(R.c, q);
      const s = S(p[0], p[1]);
      ctx.globalAlpha = 0.25 + 0.65 * (1 - (rNow - q) / 70);
      ctx.beginPath();
      ctx.arc(s[0], s[1], 1.8 * z, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // telemetry (t < N): station -> its drone
    const U = [];
    for (let i = 0; i < n; i++) U.push(this.uavAt(i, pos));
    if (t < this.N) {
      ctx.strokeStyle = 'rgba(255, 229, 92, 0.95)';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < n; i++) {
        const p = S(st[i][0], st[i][1]), q = S(U[i][0], U[i][1]);
        ctx.beginPath();
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
        ctx.stroke();
      }
    }

    // x*(t): gold beam seen from above
    const xs = this.stepTween(R.xs, pos, 0);
    const sx = S(xs[0], xs[1]);
    const halo = ctx.createRadialGradient(sx[0], sx[1], 0, sx[0], sx[1], 15 * z);
    halo.addColorStop(0, 'rgba(255, 214, 77, 0.75)');
    halo.addColorStop(1, 'rgba(255, 214, 77, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx[0], sx[1], 15 * z, 0, Math.PI * 2);
    ctx.fill();

    // charging robot, heading from its motion
    const rc = this.robotAt(pos);
    const rp = this.robotAt(Math.max(0, pos - 6));
    let hd = Math.atan2(rc[1] - rp[1], rc[0] - rp[0]);
    if (Math.hypot(rc[0] - rp[0], rc[1] - rp[1]) < 1e-3) hd = this.lastHeading || Math.PI / 2;
    this.lastHeading = hd;
    this.drawRobot(ctx, S(rc[0], rc[1]), hd, z);

    // pins x_i(t), above the robot
    for (let i = 0; i < n; i++) {
      const p = this.stepTween(R.xi, pos, -6, i);
      const s = S(p[0], p[1]);
      ctx.beginPath();
      ctx.arc(s[0], s[1], 3.1 * z, 0, Math.PI * 2);
      ctx.fillStyle = COLORS[i];
      ctx.fill();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    // x*(t): a gold ring with a dot, on top
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffcf3a';
    ctx.beginPath();
    ctx.arc(sx[0], sx[1], 7.5 * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(80, 52, 0, 0.55)';
    ctx.beginPath();
    ctx.arc(sx[0], sx[1], 8.8 * z, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffcf3a';
    ctx.beginPath();
    ctx.arc(sx[0], sx[1], 2.4 * z, 0, Math.PI * 2);
    ctx.fill();

    // stations
    for (let i = 0; i < n; i++) {
      const s = S(st[i][0], st[i][1]);
      this.drawStation(ctx, s, COLORS[i], i === this.selected, z);
    }
    // drones (on top), scaled by altitude
    for (let i = 0; i < n; i++) {
      const s = S(U[i][0], U[i][1]);
      const alt = clamp(U[i][2] / 3.5, 0.15, 1.15);
      this.drawDrone(ctx, s, COLORS[i], i === this.selected, z * (0.7 + 0.3 * alt), alt);
    }
    // station names, outward from the ring and kept inside the canvas
    const fs = Math.round(11.5 * clamp(z, 0.92, 1.15));
    ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const c = S(0, 0);
    for (let i = 0; i < n; i++) {
      const s = S(st[i][0], st[i][1]);
      let dx = s[0] - c[0], dy = s[1] - c[1];
      const dn = Math.hypot(dx, dy) || 1;
      dx /= dn;
      dy /= dn;
      const name = R.agencies[i];
      const tw = ctx.measureText(name).width;
      const gap = 13 * z;
      let lx;
      let ly = s[1] + dy * gap;
      if (dx > 0.35) {
        lx = s[0] + gap;
        if (lx + tw > w - 6) lx = s[0] - gap - tw;          // no room outside: put it inside
      } else if (dx < -0.35) {
        lx = s[0] - gap - tw;
        if (lx < 6) lx = s[0] + gap;
      } else {
        lx = s[0] - tw / 2;
        ly = s[1] + dy * (gap + 4);
      }
      lx = clamp(lx, 6, w - 6 - tw);
      ly = clamp(ly, fs, hh - fs);
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(28, 42, 24, 0.6)';
      ctx.strokeText(name, lx, ly);
      ctx.fillStyle = '#fff';
      ctx.fillText(name, lx, ly);
    }
  }

  drawStation(ctx, s, color, hot, z) {
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.scale(z, z);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.beginPath();
    ctx.ellipse(1.2, 1.8, 7.5, 6.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = '#26282c';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 4.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-1.3, -1.4, 1.5, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fill();
    if (hot) {
      ctx.beginPath();
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
    ctx.restore();
  }

  drawDrone(ctx, s, color, hot, z, alt) {
    ctx.save();
    ctx.translate(s[0], s[1]);
    // shadow, offset with altitude
    ctx.fillStyle = `rgba(0, 0, 0, ${0.16 + 0.1 * (1 - alt)})`;
    ctx.beginPath();
    ctx.ellipse(3 * alt * z + 1, 4 * alt * z + 1, 7 * z, 5.5 * z, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.scale(z, z);
    ctx.rotate(Math.PI / 4);
    ctx.strokeStyle = '#2b2d31';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-7, 0); ctx.lineTo(7, 0);
    ctx.moveTo(0, -7); ctx.lineTo(0, 7);
    ctx.stroke();
    for (const [px, py] of [[-7, 0], [7, 0], [0, -7], [0, 7]]) {
      ctx.beginPath();
      ctx.arc(px, py, 3.1, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 42, 46, 0.55)';
      ctx.fill();
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = 'rgba(235, 238, 242, 0.85)';
      ctx.stroke();
    }
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = color;
    ctx.strokeStyle = hot ? '#fff' : '#1f2023';
    ctx.lineWidth = hot ? 2 : 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-3.6, -3.6, 7.2, 7.2, 1.6) : ctx.rect(-3.6, -3.6, 7.2, 7.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  drawRobot(ctx, s, heading, z) {
    // heading in world coordinates -> screen angle in the rotated frame
    const vx = Math.cos(heading), vy = Math.sin(heading);
    const ang = Math.atan2(-(vx * this.fx[0] + vy * this.fx[1]), vx * this.rx[0] + vy * this.rx[1]);
    ctx.save();
    ctx.translate(s[0], s[1]);
    ctx.scale(z, z);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.beginPath();
    ctx.ellipse(1.5, 2.5, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#17181a';
    for (const [x, y] of [[-6, -7.4], [4, -7.4], [-6, 5.6], [4, 5.6]]) ctx.fillRect(x, y, 5, 1.8);
    ctx.fillStyle = '#f2f3f5';
    ctx.strokeStyle = '#2f3237';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(-10, -6, 20, 12, 2.5) : ctx.rect(-10, -6, 20, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c3c8cf';
    ctx.fillRect(-4, -4, 8, 8);
    ctx.fillStyle = '#ffd34d';
    ctx.fillRect(7, -3.5, 2, 7);
    ctx.restore();
  }

  /* ------------------------------------------------------------------------------ views */

  setView(v, auto) {
    v = v === 'top' ? 'top' : '3d';
    if (v === '3d' && this.state3d === 'failed') return;
    if (v === this.view && !auto) return;
    this.view = v;
    this.root.classList.toggle('ws--top', v === 'top');
    this.btn3d.setAttribute('aria-pressed', v === '3d' ? 'true' : 'false');
    this.btnTop.setAttribute('aria-pressed', v === 'top' ? 'true' : 'false');
    this.stage.setAttribute('aria-label', v === '3d'
      ? 'Webots simulation, 3D view. Space plays or pauses, the arrow keys step.'
      : 'Webots simulation, top view. Space plays or pauses, the arrow keys step.');
    if (v === 'top') {
      this.dropPoster();
      this.onResize();
    } else {
      if (this.state3d === 'idle') this.load3d();
      if (this.state3d === 'ready') {
        this.dropPoster();
        this.frame3d = -1;
      }
      if (this.slow) this.hideMsg();
    }
    this.syncStage();
    this.render(true);
  }

  resetCamera() {
    this.fit3d();
    this.fitTop(true);
  }

  onResize() {
    const r = this.stage.getBoundingClientRect();
    const rt = this.topBox.getBoundingClientRect();
    if (r.width < 10 && rt.width < 10) return;
    // top view canvas
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(rt.width), hh = Math.round(rt.height);
    const changed = this.topW !== w || this.topH !== hh || this.topDpr !== dpr;
    if (changed) {
      this.topW = w;
      this.topH = hh;
      this.topDpr = dpr;
      this.topCanvas.width = Math.round(w * dpr);
      this.topCanvas.height = Math.round(hh * dpr);
    }
    // same orientation as the default 3D camera for this shape of viewport
    let turned = false;
    if (this.topPts) {
      const yaw = viewFor(w, hh).yaw;
      if (yaw !== this.topYaw) {
        this.setTopYaw(yaw);
        turned = true;
      }
    }
    // fit when the size changed (unless the user moved the map) and whenever no fit was possible yet
    if ((changed && !this.userCamTop) || turned || !this.topFitK) this.fitTop(turned);
    this.drawTop();
    // 3D
    if (this.state3d === 'ready' && this.el) {
      const w3 = Math.round(r.width), h3 = Math.round(r.height);
      if (this.w3dW !== w3 || this.w3dH !== h3) {
        this.w3dW = w3;
        this.w3dH = h3;
        this.el.resize();
        if (!this.userCam3d) this.fit3d();
      }
    }
    this.drawChart();
  }

  showTip(clientX, t) {
    const r = this.timeline.getBoundingClientRect();
    const x = clamp(clientX - r.left, 0, r.width);
    this.tip.textContent = 't = ' + t;
    this.tip.style.left = x + 'px';
    this.tip.classList.add('is-on');
  }
}

/* ----------------------------------------------------------------------------------- init */

function init() {
  const root = document.getElementById('webots-sim');
  if (!root || root.dataset.wsReady) return;
  root.dataset.wsReady = '1';
  try {
    const sim = new WebotsSim(root);
    // a small handle for tests: read-only state and the same actions as the controls
    root.wsApi = {
      get t() { return sim.t; },
      get pos() { return sim.pos; },
      get view() { return sim.view; },
      get playing() { return sim.playing; },
      get state3d() { return sim.state3d; },
      get frame() { return sim.anim ? sim.anim.step : null; },
      seekT: (t) => { sim.pause(); sim.seekT(t); return sim.t; },
      play: () => sim.play(),
      pause: () => sim.pause(),
      setView: (v) => sim.setView(v),
      select: (i) => sim.select(i),
      beam: () => {
        const n = sim.WbWorld && sim.WbWorld.instance && sim.WbWorld.instance.nodes.get(BEAM_NODE);
        return n ? [n.translation.x, n.translation.y] : null;
      },
      expectedBeam: () => (sim.run ? [sim.run.xs[2 * sim.t] * SCENE_M, sim.run.xs[2 * sim.t + 1] * SCENE_M] : null),
      render3d: () => sim.w3dRender(),
      cam: () => {
        const vp = sim.WbWorld && sim.WbWorld.instance && sim.WbWorld.instance.viewpoint;
        return vp ? [vp.position.x, vp.position.y, vp.position.z].map((v) => +v.toFixed(4)) : null;
      },
      topView: () => ({ k: sim.top.k, fitK: sim.topFitK, w: sim.topW, h: sim.topH, dpr: sim.topDpr, user: sim.userCamTop, bounds: sim.bounds }),
      stationOnTop: (i) => (sim.run ? sim.S(sim.run.stations[i][0], sim.run.stations[i][1]) : null),
      get selected() { return sim.selected; },
    };
  } catch (err) {
    console.error('[webots-sim]', err);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
