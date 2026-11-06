/*
 * playground.js: "Try it in your browser". Algorithm 1 of the paper on case
 * study (A), simulated live by engine.js (window.CoopEngine).
 *
 * Builds everything inside <div id="playground" class="pg"></div> (namespace
 * .pg-*) and starts on DOMContentLoaded. A trial takes about a millisecond, so
 * it is recomputed whenever a setting changes. The dark viewport plays the
 * trial back step by step; the light panels show the identified eigenvalues,
 * the error to x*(t), and a Monte Carlo sweep (20 trials for each N).
 */
(function () {
  "use strict";

  const SCRIPT_SRC = (document.currentScript && document.currentScript.src) || "";
  const NS = "http://www.w3.org/2000/svg";

  // ------------------------------------------------------------------ constants
  const ST_COLORS = ["#e63333", "#338cf2", "#33bf4d", "#f2a61a", "#b34dd9", "#1abfcc"];
  // light panels: the colors of the paper's figures
  const C = { coop: "#0072b2", local: "#d55e00", pers: "#6e6e6e", oracle: "#363636" };
  // the dark viewport
  const D = {
    bg0: "#14243b", bg1: "#0a111d", grid: "rgba(160, 182, 214, 0.075)",
    link: "rgba(214, 226, 245, 0.32)", chord: "rgba(214, 226, 245, 0.17)",
    tele: "#f4d35e", gold: "#f2c14e", coop: "#4aa8e8", local: "#f0874a",
    ink: "#e8eef6", soft: "#b4c0d0", pulse: "#fff4cc",
  };
  const RATE = 20; // steps per second at 1x; one step is one second of the mission
  const SPEEDS = [0.5, 1, 2, 4];
  const NOISE = [0.25, 0.5, 1, 2, 4]; // multiples of the paper's noise variance
  const P0S = [1, 1.5, 2, 2.5, 3, 4, 5, 6]; // initial deviation P0 = s^2 I: the paper 4, Webots 2.5
  const MC_NS = [30, 50, 100, 150, 200];
  const MC_TRIALS = 20;
  const GRAPHS = [
    { id: "paper", label: "Ring + 3 chords" },
    { id: "ring", label: "Ring" },
    { id: "path", label: "Line" },
    { id: "complete", label: "Complete" },
  ];
  const BASE = { mission: "posts", N: 100, tau: 3, graph: "paper", k: 2, alpha: 0.2, noise: 2, p0: 4 };
  const WEBOTS = Object.assign({}, BASE, { mission: "search", graph: "ring", p0: 2.5 });
  const PRESETS = [
    { id: "paper", label: "Paper", set: BASE },
    { id: "webots", label: "Webots", set: WEBOTS },
    { id: "short", label: "Short record", set: Object.assign({}, BASE, { N: 30 }) },
    { id: "alone", label: "Alone", set: Object.assign({}, BASE, { tau: 0 }) },
  ];
  const KEYS = ["mission", "N", "tau", "graph", "k", "alpha", "noise", "p0"];

  // The paper's medians for N = 30, 50, 100, 150, 200 (50 trials), shown when the settings are the
  // paper's: paper_v4_package/code/data/rv_id_{coop3,local}.dat and rv_rmse_{coop3,local}.dat.
  // (No Webots markers: those 20 runs reuse seeds 2026-2045 for every N, and their identification
  // medians sit at the low end of what 20 random seeds give, so they would suggest a false offset.)
  const REF_PAPER = {
    label: "paper, 50 trials",
    id: { coop: [0.00817376, 0.00633628, 0.00610405, 0.00555516, 0.00497317], local: [0.0239581, 0.0178734, 0.0165002, 0.0153549, 0.0147592] },
    rmse: { coop: [0.323919, 0.296465, 0.275185, 0.255349, 0.246238], local: [0.551302, 0.388194, 0.285908, 0.309028, 0.262123] },
  };

  // ------------------------------------------------------------------ helpers
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]; });
  }
  /** Two significant digits (errors span decades). */
  function sig2(v) {
    if (v == null || !isFinite(v)) return "–";
    if (v === 0) return "0";
    const d = clamp(1 - Math.floor(Math.log10(Math.abs(v))), 0, 6);
    return v.toFixed(d);
  }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  /** KaTeX when the page has it (the rest of the page's math), plain HTML otherwise. */
  function tex(src, fallback) {
    if (window.katex && typeof window.katex.renderToString === "function") {
      try { return window.katex.renderToString(src, { throwOnError: false }); } catch (e) { /* fall through */ }
    }
    return fallback;
  }
  function niceStep(x) {
    const e = Math.pow(10, Math.floor(Math.log10(x)));
    const f = x / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e;
  }
  /** Log axis bounds snapped to 1, 2, 5 x 10^k. */
  function logBounds(lo, hi) {
    const down = function (v) { const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f >= 5 ? 5 : f >= 2 ? 2 : 1) * e; };
    const up = function (v) { const e = Math.pow(10, Math.floor(Math.log10(v))); const f = v / e; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * e; };
    return [down(lo), up(hi)];
  }
  function logTicks(lo, hi) {
    const span = Math.log10(hi / lo);
    const mult = span <= 1.05 ? [1, 2, 5] : span <= 2.2 ? [1, 3] : [1];
    const out = [];
    for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
      mult.forEach(function (f) {
        const v = f * Math.pow(10, e);
        if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
      });
    }
    return out;
  }
  function tickText(v) { return v >= 1 ? String(+v.toFixed(2)) : String(+v.toPrecision(2)); }

  const reduceMotion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  let uid = 0;

  // ================================================================ the component
  function Playground(root) {
    const E = window.CoopEngine;
    const P = "pg" + ++uid + "-";
    const id = function (s) { return P + s; };
    const state = Object.assign({}, BASE, { seed: 2026, speed: 1, t: 0, playing: false, metric: "id" });
    const S = {
      res: null, cw: 0, ch: 0, dpr: 1, view: null, overlay: null,
      anim: null, raf: 0, last: 0, acc: 0, visible: false, everVisible: false, interacted: false,
      zoom: 1.5, eig: null, err: null, eigP: -1, mc: null, mcRun: null, liveTimer: 0, phase: "", labelAt: 0,
      stations: E.stationPositions(6),
    };

    // ---------------------------------------------------------------- markup
    const M = {
      N: tex("N", '<i class="pg-m">N</i>'),
      tau: tex("\\tau", '<i class="pg-m">τ</i>'),
      k: tex("k", '<i class="pg-m">k</i>'),
      alpha: tex("\\alpha", '<i class="pg-m">α</i>'),
      Ahat: tex("\\hat A^{(i)}", '<i class="pg-m">Â</i><sup>(<i class="pg-m">i</i>)</sup>'),
      xstar: tex("x^\\star(t)", '<i class="pg-m">x</i><sup>⋆</sup>(<i class="pg-m">t</i>)'),
      xi: tex("x_i(t)", '<i class="pg-m">x<sub>i</sub></i>(<i class="pg-m">t</i>)'),
      idErr: tex("\\|\\hat A^{(i)}-A\\|_F", '‖<i class="pg-m">Â</i><sup>(<i class="pg-m">i</i>)</sup> − <i class="pg-m">A</i>‖<sub>F</sub>'),
      trueA: tex("A", '<i class="pg-m">A</i>'),
      sigma: tex("\\sigma", '<i class="pg-m">σ</i>'),
    };
    const icon = {
      play: '<svg class="pg-i-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.6 2.4v11.2L13.6 8z" fill="currentColor"/></svg>',
      pause: '<svg class="pg-i-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h2.9v11H4zM9.1 2.5H12v11H9.1z" fill="currentColor"/></svg>',
      reset: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.4 8.6A4.7 4.7 0 1 0 4.9 4.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M4.6 1.6v3.3H1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      run: '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.4v9.2L10.6 6z" fill="currentColor"/></svg>',
    };
    const glyph = {
      drone: '<svg viewBox="0 0 18 14" aria-hidden="true"><path d="M4 2l10 10M4 12L14 2" stroke="#8ea0b8" stroke-width="1.2"/><g fill="#26324a" stroke="#8ea0b8" stroke-width=".8"><circle cx="4" cy="2" r="1.9"/><circle cx="14" cy="2" r="1.9"/><circle cx="4" cy="12" r="1.9"/><circle cx="14" cy="12" r="1.9"/></g><circle cx="9" cy="7" r="3.1" fill="#338cf2" stroke="#0a111d" stroke-width="1"/></svg>',
      station: '<svg viewBox="0 0 18 14" aria-hidden="true"><rect x="2.5" y="3" width="13" height="9" rx="2" fill="#338cf2" stroke="#e8eef6" stroke-width="1"/><path d="M9 3V0.5" stroke="#e8eef6" stroke-width="1.2"/></svg>',
      plan: '<svg viewBox="0 0 18 14" aria-hidden="true"><circle cx="9" cy="7" r="4.6" fill="none" stroke="#338cf2" stroke-width="1.2" stroke-dasharray="2 2"/><circle cx="9" cy="7" r="1" fill="#338cf2"/></svg>',
      tele: '<svg viewBox="0 0 18 14" aria-hidden="true"><path d="M0.5 7h17" stroke="#f4d35e" stroke-width="1.6" stroke-dasharray="3 2.5"/></svg>',
      xstar: '<svg viewBox="0 0 18 14" aria-hidden="true"><circle cx="9" cy="7" r="6.5" fill="rgba(242,193,78,.25)"/><path d="M4 7h10M9 2v10" stroke="#f2c14e" stroke-width="1.8"/></svg>',
      coop: '<svg viewBox="0 0 18 14" aria-hidden="true"><circle cx="9" cy="7" r="3.6" fill="#4aa8e8" stroke="#0a111d" stroke-width="1"/></svg>',
      alone: '<svg viewBox="0 0 18 14" aria-hidden="true"><circle cx="9" cy="7" r="3.6" fill="#f0874a" stroke="#0a111d" stroke-width="1"/></svg>',
    };
    const key = function (k) { return '<svg viewBox="0 0 16 12" aria-hidden="true">' + k + "</svg>"; };
    const K = {
      dotCoop: key('<circle cx="8" cy="6" r="3.6" fill="' + C.coop + '" stroke="#fff" stroke-width="1"/>'),
      triLocal: key('<path d="M8 1.8l4.2 7.4H3.8z" fill="' + C.local + '" stroke="#fff" stroke-width=".8" stroke-linejoin="round"/>'),
      cross: key('<path d="M2 6h12M8 0v12" stroke="#363636" stroke-width="1.3"/>'),
      lineCoop: key('<path d="M0 6h16" stroke="' + C.coop + '" stroke-width="2.2"/><circle cx="8" cy="6" r="2.6" fill="' + C.coop + '"/>'),
      lineLocal: key('<path d="M0 6h16" stroke="' + C.local + '" stroke-width="2.2"/><path d="M8 3.2l2.9 5H5.1z" fill="' + C.local + '"/>'),
      coop: key('<path d="M0 6h16" stroke="' + C.coop + '" stroke-width="2.2"/>'),
      local: key('<path d="M0 6h16" stroke="' + C.local + '" stroke-width="2"/>'),
      pers: key('<path d="M1 6h15" stroke="' + C.pers + '" stroke-width="1.8" stroke-dasharray="1.6 2.4" stroke-linecap="round"/>'),
      oracle: key('<path d="M0 6h16" stroke="' + C.oracle + '" stroke-width="1.4" stroke-dasharray="5 2 1.4 2"/>'),
      ref: key('<path d="M8 2.2l3.8 3.8L8 9.8 4.2 6z" fill="#fff" stroke="#363636" stroke-width="1.2"/>'),
    };

    function slider(k, label, min, max, step) {
      return '<div class="pg-field">' +
        '<div class="pg-row"><label class="pg-label" for="' + id(k) + '">' + label + "</label>" +
        '<output class="pg-val" id="' + id(k + "-v") + '" for="' + id(k) + '"></output></div>' +
        '<input class="pg-range" type="range" id="' + id(k) + '" data-key="' + k + '" min="' + min + '" max="' + max + '" step="' + step + '">' +
        "</div>";
    }

    function select(k, label, opts, wide) {
      return '<div class="pg-field' + (wide ? " pg-wide" : "") + '">' +
        '<div class="pg-row"><label class="pg-label" for="' + id(k) + '">' + label + "</label>" +
        (wide ? '<output class="pg-val" id="' + id(k + "-v") + '" for="' + id(k) + '"></output>' : "") + "</div>" +
        '<select class="pg-select" id="' + id(k) + '" data-key="' + k + '">' +
        opts.map(function (o) { return '<option value="' + o[0] + '">' + esc(o[1]) + "</option>"; }).join("") +
        "</select></div>";
    }

    root.classList.add("pg");
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "Interactive simulation of Algorithm 1");
    root.innerHTML =
      '<div class="pg-view" id="' + id("view") + '">' +
        '<div class="pg-stage" id="' + id("stage") + '">' +
          '<canvas class="pg-canvas" id="' + id("canvas") + '" tabindex="0" role="img" aria-describedby="' + id("keys") + '" aria-label="Top view of the stations and drones"></canvas>' +
          '<div class="pg-hud" aria-hidden="true"><span class="pg-phase" id="' + id("phase") + '" data-phase="collect">Collecting data</span>' +
            '<span class="pg-clock"><i class="pg-m">t</i> = <span id="' + id("clock") + '">0</span> s</span></div>' +
          '<p class="pg-sr" id="' + id("keys") + '">Space plays or pauses. The arrow keys step through time.</p>' +
        "</div>" +
        '<ul class="pg-legend" id="' + id("legend") + '" aria-label="Legend">' +
          '<li>' + glyph.drone + "drone</li>" +
          '<li>' + glyph.station + "station</li>" +
          '<li>' + glyph.plan + "planned position</li>" +
          '<li data-k="tele">' + glyph.tele + "telemetry</li>" +
          '<li>' + glyph.xstar + M.xstar + "</li>" +
          '<li data-k="coop">' + glyph.coop + M.xi + " together</li>" +
          '<li data-k="local">' + glyph.alone + M.xi + " alone</li>" +
        "</ul>" +
        '<div class="pg-transport">' +
          '<button type="button" class="pg-tbtn pg-play" id="' + id("play") + '" aria-label="Play">' + icon.play + icon.pause + "</button>" +
          '<button type="button" class="pg-tbtn" id="' + id("reset") + '" aria-label="Back to the start">' + icon.reset + "</button>" +
          '<div class="pg-scrub"><div class="pg-track" id="' + id("track") + '" aria-hidden="true"><span class="pg-track-fill" id="' + id("fill") + '"></span>' +
            '<span class="pg-track-n" id="' + id("nmark") + '"><span>N</span></span></div>' +
            '<input class="pg-time" type="range" id="' + id("time") + '" min="0" max="299" step="1" value="0" aria-label="Time step"></div>' +
          '<select class="pg-speed" id="' + id("speed") + '" aria-label="Playback speed">' +
            SPEEDS.map(function (v) { return '<option value="' + v + '">' + v + "×</option>"; }).join("") +
          "</select>" +
        "</div>" +
      "</div>" +
      '<form class="pg-ctrl" id="' + id("form") + '" aria-label="Settings">' +
        '<div class="pg-field pg-presets-f" role="group" aria-labelledby="' + id("presets-l") + '">' +
          '<div class="pg-row"><span class="pg-label" id="' + id("presets-l") + '">Presets</span></div>' +
          '<div class="pg-presets">' +
            PRESETS.map(function (p) { return '<button type="button" class="pg-chip" data-preset="' + p.id + '" aria-pressed="false">' + esc(p.label) + "</button>"; }).join("") +
        "</div></div>" +
        '<div class="pg-field" role="radiogroup" aria-labelledby="' + id("mission-l") + '">' +
          '<div class="pg-row"><span class="pg-label" id="' + id("mission-l") + '">Mission</span></div>' +
          '<div class="pg-seg">' +
            '<label><input type="radio" name="' + id("mission") + '" value="posts"><span>Fixed posts</span></label>' +
            '<label><input type="radio" name="' + id("mission") + '" value="search"><span>Moving search line</span></label>' +
          "</div></div>" +
        slider("N", "Training horizon " + M.N, 20, 300, 10) +
        slider("tau", "Consensus rounds " + M.tau, 0, 10, 1) +
        '<div class="pg-field"><div class="pg-row"><label class="pg-label" for="' + id("seed") + '">Seed</label></div>' +
          '<div class="pg-seed"><input class="pg-input" type="number" id="' + id("seed") + '" min="0" max="999999" step="1" inputmode="numeric">' +
          '<button type="button" class="pg-btn" id="' + id("newseed") + '">New seed</button></div></div>' +
        '<details class="pg-more" id="' + id("more") + '"><summary>More settings</summary><div class="pg-more-body">' +
          select("graph", "Graph", GRAPHS.map(function (g) { return [g.id, g.label]; }), true) +
          select("k", "Window " + M.k, [1, 2, 3, 4, 5, 6].map(function (v) { return [v, String(v)]; })) +
          select("alpha", "Step size " + M.alpha, [0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map(function (v) { return [v, v.toFixed(2)]; })) +
          select("noise", "Noise", NOISE.map(function (v, i) { return [i, "×" + v]; })) +
          select("p0", "Initial deviation", P0S.map(function (v) { return [v, v + "² I"]; })) +
        "</div></details>" +
      "</form>" +
      '<p class="pg-readout" id="' + id("readout") + '"></p>' +
      '<div class="pg-panels">' +
        '<figure class="pg-panel">' +
          '<figcaption class="pg-ph"><span class="pg-pt">Eigenvalues of ' + M.Ahat + "</span></figcaption>" +
          '<ul class="pg-keys" id="' + id("eig-keys") + '"></ul>' +
          '<div class="pg-chart" id="' + id("eig") + '" role="img" aria-label="Eigenvalues"></div>' +
        "</figure>" +
        '<figure class="pg-panel">' +
          '<figcaption class="pg-ph"><span class="pg-pt">Error to ' + M.xstar + "</span></figcaption>" +
          '<ul class="pg-keys" id="' + id("err-keys") + '"></ul>' +
          '<div class="pg-chart is-scrub" id="' + id("err") + '" role="img" aria-label="Error over time"></div>' +
        "</figure>" +
        '<figure class="pg-panel pg-mc is-empty" id="' + id("mcp") + '">' +
          '<figcaption class="pg-ph"><span class="pg-pt">Monte Carlo</span>' +
            '<span class="pg-tabs" role="group" aria-label="Metric">' +
              '<button type="button" class="pg-tab" data-metric="id" aria-pressed="true" aria-label="Identification error">' + M.idErr + "</button>" +
              '<button type="button" class="pg-tab" data-metric="rmse" aria-pressed="false" aria-label="Tracking RMSE">RMSE</button>' +
            "</span></figcaption>" +
          '<ul class="pg-keys" id="' + id("mc-keys") + '"></ul>' +
          '<p class="pg-mc-note" id="' + id("mc-note") + '"></p>' +
          '<div class="pg-mc-body">' +
            '<div class="pg-chart" id="' + id("mc") + '" role="img" aria-label="Monte Carlo"></div>' +
            '<div class="pg-cta" id="' + id("cta") + '">' +
              '<button type="button" class="pg-run" id="' + id("run") + '" aria-label="Run ' + MC_TRIALS + ' trials for each N">' + icon.run + "<span>Run " + MC_TRIALS + " trials per " + M.N + "</span></button>" +
              '<div class="pg-progress" id="' + id("prog") + '" role="progressbar" aria-label="Monte Carlo progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><span></span></div>' +
            "</div>" +
          "</div>" +
        "</figure>" +
      "</div>" +
      '<p class="pg-sr" id="' + id("live") + '" aria-live="polite" aria-atomic="true"></p>';

    const $ = function (s) { return document.getElementById(id(s)); };
    const view = $("view"), stage = $("stage"), canvas = $("canvas"), ctx = canvas.getContext("2d");
    const form = $("form"), timeEl = $("time"), playBtn = $("play"), phaseEl = $("phase"), clockEl = $("clock");

    // ---------------------------------------------------------------- settings
    function tauKey() { return "coop" + state.tau; }
    function search() { return state.mission === "search"; }
    function engineCfg() {
      return {
        mission: state.mission, N: state.N, horizon: 200, k: state.k, alpha: state.alpha, taus: [state.tau],
        graph: state.graph, p0Std: state.p0, qStd: 0.05,
        noise: search() ? "position" : "gradient",
        noiseStd: (search() ? 0.75 : 1.5) * Math.sqrt(NOISE[state.noise]),
        exact: false, pooled: false, baselines: true, kalman: false, centralized: false, series: true, rounds: true,
      };
    }
    function matches(set) { return KEYS.every(function (k) { return k === "N" || state[k] === set[k]; }); }
    function presetOn(p) { return KEYS.every(function (k) { return state[k] === p.set[k]; }); }
    function signature() { return JSON.stringify(KEYS.filter(function (k) { return k !== "N"; }).map(function (k) { return state[k]; }).concat([state.seed])); }

    function fill(input) {
      const min = +input.min, max = +input.max;
      input.style.setProperty("--pg-fill", (100 * (+input.value - min) / (max - min)).toFixed(1) + "%");
    }
    function syncControls() {
      form.querySelectorAll('input[name="' + id("mission") + '"]').forEach(function (r) { r.checked = r.value === state.mission; });
      ["N", "tau"].forEach(function (k) { const inp = $(k); inp.value = state[k]; fill(inp); });
      ["graph", "k", "alpha", "noise", "p0"].forEach(function (k) { $(k).value = String(state[k]); });
      $("seed").value = state.seed;
      $("speed").value = String(state.speed);
      root.querySelectorAll(".pg-chip").forEach(function (b) {
        const p = PRESETS.filter(function (q) { return q.id === b.dataset.preset; })[0];
        b.setAttribute("aria-pressed", String(presetOn(p)));
      });
      updateOutputs();
    }
    function updateOutputs() {
      $("N-v").textContent = String(state.N);
      $("tau-v").textContent = state.tau === 0 ? "0, alone" : String(state.tau);
      if (S.res) $("graph-v").innerHTML = '<i class="pg-m">σ</i> = ' + S.res.sigma.toFixed(2);
    }

    // ---------------------------------------------------------------- simulate
    function recompute() {
      let res;
      try {
        res = E.simulate(engineCfg(), E.rng(state.seed));
      } catch (err) {
        $("readout").textContent = "These settings cannot run: " + (err && err.message);
        return;
      }
      S.res = res;
      S.anim = null;
      state.t = clamp(state.t, 0, res.T - 1);
      timeEl.max = String(res.T - 1);
      $("legend").querySelector('[data-k="coop"]').hidden = state.tau === 0;
      layoutTrack();
      syncControls();
      updateReadout();
      buildCharts();
      updateMcState();
      render(true);
    }

    // ---------------------------------------------------------------- readout
    function updateReadout() {
      const res = S.res;
      const c = res.estimates[tauKey()], l = res.estimates.local;
      const rc = res.rmse[tauKey()], rl = res.rmse.local;
      const num = function (v, cls) { return '<b class="pg-num ' + cls + '">' + (v < 1e3 ? sig2(v) : "diverges") + "</b>"; };
      const diverged = !(rc < 1e3) && !(rl < 1e3); // gradient tracking itself is unstable (step size too large)
      let a, b, live;
      if (state.tau === 0) {
        a = '<span class="pg-part">' + M.tau + " = 0, every station alone:</span> " +
          '<span class="pg-part">median ' + M.idErr + " " + num(l.median, "pg-c-local") + "</span>";
        b = '<span class="pg-part">tracking RMSE ' + num(rl, "pg-c-local") + "</span>";
        live = "Every station alone. Median identification error " + sig2(l.median) + ", tracking RMSE " + sig2(rl) + ".";
      } else {
        const ratio = l.median / c.median;
        a = '<span class="pg-part">median ' + M.idErr + " " + num(c.median, "pg-c-coop") + " together,</span> " +
          '<span class="pg-part">' + num(l.median, "pg-c-local") + " alone" + (isFinite(ratio) ? " (" + ratio.toFixed(1) + "×)" : "") + "</span>";
        b = '<span class="pg-part">tracking RMSE ' + num(rc, "pg-c-coop") + " vs " + num(rl, "pg-c-local") + "</span>";
        live = "Median identification error " + sig2(c.median) + " together, " + sig2(l.median) + " alone. Tracking RMSE " +
          sig2(rc) + " together, " + sig2(rl) + " alone.";
      }
      if (diverged) {
        b = '<span class="pg-part">tracking diverges: lower the step size ' + M.alpha + "</span>";
        live = live.replace(/Tracking RMSE.*$/, "Tracking diverges: lower the step size.");
      }
      $("readout").innerHTML = a + '<span class="pg-dot" aria-hidden="true">·</span>' + b;
      clearTimeout(S.liveTimer);
      S.liveTimer = setTimeout(function () { $("live").textContent = live; }, 700);
    }

    // ================================================================ playback
    function setPlaying(v) {
      state.playing = !!v;
      playBtn.classList.toggle("is-playing", state.playing);
      playBtn.setAttribute("aria-label", state.playing ? "Pause" : "Play");
      if (state.playing) {
        if (state.t >= S.res.T - 1) state.t = 0;
        S.last = 0;
        S.acc = 0;
        kick();
      } else if (S.anim) {
        S.anim = null;
        state.t = S.res.N;
        render(true);
      }
    }
    function kick() {
      if (!S.raf && S.visible && !document.hidden) S.raf = requestAnimationFrame(frame);
    }
    function frame(now) {
      S.raf = 0;
      if (!S.visible || document.hidden) return;
      const dt = S.last ? Math.min(0.1, (now - S.last) / 1000) : 0;
      S.last = now;
      if (S.anim) {
        S.anim.p += dt / S.anim.dur;
        if (S.anim.p >= 1) {
          S.anim = null;
          state.t = S.res.N;
        }
      } else if (state.playing) {
        S.acc += dt * RATE * state.speed;
        while (S.acc >= 1 && !S.anim) {
          S.acc -= 1;
          step();
          if (state.t >= S.res.T - 1) { setPlaying(false); break; }
        }
      }
      render(false);
      if (state.playing || S.anim) kick();
    }
    function step() {
      const res = S.res;
      if (state.t === res.N - 1 && !reduceMotion.matches) {
        // pause at t = N for the identification: tau consensus rounds on the moments
        S.anim = { p: 0, dur: (0.5 + 0.4 * Math.min(state.tau, 6)) / Math.sqrt(state.speed) };
        return;
      }
      state.t = Math.min(res.T - 1, state.t + 1);
    }
    function jump(t) {
      S.anim = null;
      state.t = clamp(Math.round(t), 0, S.res.T - 1);
      render(true);
    }

    function render(force) {
      if (!S.res || !S.cw) return;
      drawScene();
      updateHud(force);
      updateScrub();
      errAt(S.anim ? S.res.N - 1 : state.t);
      const p = S.anim ? S.anim.p : 1;
      if (force || p !== S.eigP) eigAt(p);
    }

    function phaseOf() {
      if (S.anim) return "consensus";
      return state.t < S.res.N ? "collect" : "track";
    }
    function updateHud(force) {
      const res = S.res, ph = phaseOf();
      let text = ph === "collect" ? "Collecting data" : ph === "track" ? "Tracking on forecasts" : "";
      if (ph === "consensus") {
        text = state.tau ? "Consensus " + Math.min(state.tau, 1 + Math.floor(S.anim.p * state.tau)) + " of " + state.tau : "Identification";
      }
      if (phaseEl.textContent !== text) phaseEl.textContent = text;
      phaseEl.dataset.phase = ph;
      phaseEl.classList.toggle("is-alone", state.tau === 0);
      clockEl.textContent = String(S.anim ? res.N : state.t);
      // the canvas description: on phase changes, and at most every 2 s while playing
      const now = performance.now();
      if (force || ph !== S.phase || (!state.playing && now - S.labelAt > 250) || now - S.labelAt > 2000) {
        S.phase = ph;
        S.labelAt = now;
        canvas.setAttribute("aria-label", canvasLabel(ph));
      }
    }
    function canvasLabel(ph) {
      const res = S.res, t = S.anim ? res.N : state.t;
      const e = res.errSeries[tauKey()][Math.min(t, res.T - 1)];
      const what = ph === "collect" ? "collecting data: each station receives the position of its own drone"
        : ph === "consensus" ? "identification by consensus"
        : "tracking on forecasts, without telemetry";
      return "Top view of the six stations and drones at t = " + t + " s, " + what + ". Network-average error to x*(t): " +
        (e < 1e3 ? (e * 10).toFixed(1) + " m" : "unbounded") + ".";
    }
    function layoutTrack() {
      const res = S.res, f = (100 * res.N / (res.T - 1)).toFixed(2) + "%";
      const tr = $("track");
      const after = state.tau === 0 ? "240, 135, 74" : "74, 168, 232";
      tr.style.setProperty("--pg-track", "linear-gradient(90deg, rgba(244, 211, 94, 0.26) 0 " + f + ", rgba(" + after + ", 0.26) " + f + " 100%)");
      tr.style.setProperty("--pg-track-on", "linear-gradient(90deg, #f4d35e 0 " + f + ", rgb(" + after + ") " + f + " 100%)");
      $("nmark").style.left = f;
    }
    function updateScrub() {
      const res = S.res, t = S.anim ? res.N : state.t;
      if (document.activeElement !== timeEl || +timeEl.value !== t) timeEl.value = String(t);
      $("fill").style.clipPath = "inset(0 " + (100 - 100 * t / (res.T - 1)).toFixed(2) + "% 0 0)";
      timeEl.setAttribute("aria-valuetext", "t = " + t + " s, " + (t < res.N ? "collecting data" : "tracking"));
    }

    // ================================================================ the scene
    function resize() {
      const w = Math.max(160, Math.round(stage.clientWidth)), h = Math.max(160, Math.round(stage.clientHeight));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      S.cw = w; S.ch = h; S.dpr = dpr;
      const overlay = (w - h) / 2 >= 150;
      if (overlay !== S.overlay) { S.overlay = overlay; view.classList.toggle("is-overlay", overlay); }
    }
    function viewFor(w, h, srch) {
      // paper units from the centre to the edge of the view; more room when the canvas is about
      // square, where the zoom shares a corner with the scene
      const R = (srch ? 16.4 : 15.0) * (w / h < 1.12 ? 1.1 : 1);
      const k = Math.min(w, h) / (2 * R);
      return { k: k, cx: w / 2, cy: h / 2, oy: srch ? 0.35 : 0, s: clamp(k / 17, 0.72, 1.15) };
    }

    function drawScene() {
      const res = S.res, c = ctx, w = S.cw, h = S.ch, m = res.m, N = res.N, T = res.T;
      const srch = res.cfg.mission === "search";
      const anim = S.anim, t = anim ? N - 1 : state.t;
      const v = (S.view = viewFor(w, h, srch)), s = v.s;
      const X = function (x) { return v.cx + x * v.k; }, Y = function (y) { return v.cy - (y - v.oy) * v.k; };
      const PR = res.routes, TH = res.theta, XS = res.xstar, st = S.stations;
      const alone = state.tau === 0, key = tauKey();
      const bx = function (tt, i) { const o = (tt * m + i) * 2; return [PR[o] + TH[o], PR[o + 1] + TH[o + 1]]; };
      c.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);

      // background and grid (2 units = 20 m)
      const bg = c.createRadialGradient(X(0), Y(v.oy), 0, X(0), Y(v.oy), Math.hypot(w, h) * 0.62);
      bg.addColorStop(0, D.bg0);
      bg.addColorStop(1, D.bg1);
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = D.grid;
      c.lineWidth = 1;
      c.beginPath();
      for (let gx = Math.floor(-v.cx / v.k / 2) * 2; gx <= (w - v.cx) / v.k; gx += 2) { const px = Math.round(X(gx)) + 0.5; c.moveTo(px, 0); c.lineTo(px, h); }
      for (let gy = Math.floor((v.cy - h) / v.k / 2) * 2; gy <= v.cy / v.k + 2; gy += 2) { const py = Math.round(Y(gy + v.oy)) + 0.5; c.moveTo(0, py); c.lineTo(w, py); }
      c.stroke();

      // the search mission: the circuit of the search line and the burning hall
      if (srch) {
        const R = E.WEBOTS_ROUTES;
        const hx = X(R.ringCenter[0]), hy = Y(R.ringCenter[1]);
        c.strokeStyle = "rgba(180, 198, 226, 0.2)";
        c.lineWidth = 1.2;
        c.setLineDash([3, 6]);
        c.beginPath(); c.arc(hx, hy, R.ringRadius * v.k, 0, 2 * Math.PI); c.stroke();
        c.setLineDash([]);
        const glow = c.createRadialGradient(hx, hy, 1, hx, hy, 3.4 * v.k);
        glow.addColorStop(0, "rgba(255, 150, 50, 0.45)");
        glow.addColorStop(1, "rgba(255, 120, 30, 0)");
        c.fillStyle = glow;
        c.beginPath(); c.arc(hx, hy, 3.4 * v.k, 0, 2 * Math.PI); c.fill();
        c.fillStyle = "rgba(58, 52, 46, 0.95)";
        c.fillRect(hx - 1.3 * v.k, hy - 1 * v.k, 2.6 * v.k, 2 * v.k);
        c.fillStyle = "rgba(255, 170, 70, 0.85)";
        c.fillRect(hx - 0.35 * v.k, hy - 0.3 * v.k, 0.7 * v.k, 0.6 * v.k);
        const lc = E.lineCenter(t), cr = Math.cos(lc[2]), sr = Math.sin(lc[2]);
        c.strokeStyle = "rgba(214, 226, 245, 0.26)";
        c.setLineDash([5, 5]);
        c.beginPath(); c.moveTo(X(lc[0] - 5.4 * cr), Y(lc[1] - 5.4 * sr)); c.lineTo(X(lc[0] + 5.4 * cr), Y(lc[1] + 5.4 * sr)); c.stroke();
        c.setLineDash([]);
      }

      // radio links
      res.edges.forEach(function (e) {
        const a = st[e[0]], b = st[e[1]];
        const d = Math.abs(e[0] - e[1]);
        c.strokeStyle = d === 1 || d === m - 1 ? D.link : D.chord;
        c.lineWidth = 1.3;
        c.beginPath(); c.moveTo(X(a[0]), Y(a[1])); c.lineTo(X(b[0]), Y(b[1])); c.stroke();
      });
      // consensus rounds at t = N: one exchange of moments per round
      if (anim && state.tau > 0) {
        const r = Math.min(state.tau - 1, Math.floor(anim.p * state.tau));
        const f = anim.p * state.tau - r, q = Math.min(1, f / 0.8);
        c.fillStyle = D.pulse;
        c.globalAlpha = f < 0.8 ? 0.95 : 0.95 * (1 - (f - 0.8) / 0.2);
        res.edges.forEach(function (e) {
          const a = st[e[0]], b = st[e[1]];
          [[a, b], [b, a]].forEach(function (ab) {
            const x = ab[0][0] + (ab[1][0] - ab[0][0]) * q, y = ab[0][1] + (ab[1][1] - ab[0][1]) * q;
            c.beginPath(); c.arc(X(x), Y(y), 2.8 * s, 0, 2 * Math.PI); c.fill();
          });
        });
        c.globalAlpha = 1;
      }

      // planned positions p_i(t) and the recent path of each drone
      for (let i = 0; i < m; i++) {
        const o = (t * m + i) * 2, px = X(PR[o]), py = Y(PR[o + 1]);
        c.strokeStyle = ST_COLORS[i];
        c.globalAlpha = 0.55;
        c.lineWidth = 1.1;
        c.setLineDash([2, 2.5]);
        c.beginPath(); c.arc(px, py, 5.5 * s, 0, 2 * Math.PI); c.stroke();
        c.setLineDash([]);
        c.fillStyle = ST_COLORS[i];
        c.beginPath(); c.arc(px, py, 1.1 * s, 0, 2 * Math.PI); c.fill();
        for (let tt = Math.max(0, t - 36); tt < t; tt++) {
          const b = bx(tt, i);
          c.globalAlpha = 0.05 + 0.5 * (1 - (t - tt) / 36);
          c.beginPath(); c.arc(X(b[0]), Y(b[1]), 1.35 * s, 0, 2 * Math.PI); c.fill();
        }
        c.globalAlpha = 1;
      }
      // recent path of x*(t)
      c.strokeStyle = D.gold;
      c.lineWidth = 1.6;
      for (let tt = Math.max(1, t - 60); tt <= t; tt++) {
        c.globalAlpha = 0.04 + 0.5 * (1 - (t - tt) / 60);
        c.beginPath(); c.moveTo(X(XS[(tt - 1) * 2]), Y(XS[(tt - 1) * 2 + 1])); c.lineTo(X(XS[tt * 2]), Y(XS[tt * 2 + 1])); c.stroke();
      }
      c.globalAlpha = 1;

      // telemetry, t < N: station i receives a noisy position of its own drone only
      if (t < N && !anim) {
        c.strokeStyle = D.tele;
        c.lineWidth = 1.2;
        for (let i = 0; i < m; i++) {
          const o = (t * m + i) * 2, sx = X(st[i][0]), sy = Y(st[i][1]) - 12 * s;
          const yx = X(res.ypos[o]), yy = Y(res.ypos[o + 1]);
          c.globalAlpha = 0.75;
          c.setLineDash([4, 4]);
          c.beginPath(); c.moveTo(sx, sy); c.lineTo(yx, yy); c.stroke();
          c.setLineDash([]);
          c.globalAlpha = 0.95;
          c.beginPath(); c.arc(yx, yy, 2.5 * s, 0, 2 * Math.PI); c.stroke();
        }
        c.globalAlpha = 1;
      }

      // drones (an arrow at the edge when one leaves the view)
      for (let i = 0; i < m; i++) {
        const b = bx(t, i), px = X(b[0]), py = Y(b[1]);
        if (px < -6 || px > w + 6 || py < -6 || py > h + 6) {
          const ex = clamp(px, 9, w - 9), ey = clamp(py, 9, h - 9);
          c.save(); c.translate(ex, ey); c.rotate(Math.atan2(py - ey, px - ex));
          c.fillStyle = ST_COLORS[i];
          c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, -5); c.lineTo(-4, 5); c.closePath(); c.fill();
          c.restore();
        } else drone(c, px, py, ST_COLORS[i], s);
      }

      // the best position x*(t)
      const xs = [XS[t * 2], XS[t * 2 + 1]], gx = X(xs[0]), gy = Y(xs[1]);
      const halo = c.createRadialGradient(gx, gy, 1, gx, gy, 17 * s);
      halo.addColorStop(0, "rgba(242, 193, 78, 0.5)");
      halo.addColorStop(1, "rgba(242, 193, 78, 0)");
      c.fillStyle = halo;
      c.beginPath(); c.arc(gx, gy, 17 * s, 0, 2 * Math.PI); c.fill();
      c.strokeStyle = D.gold;
      c.lineWidth = 2;
      c.beginPath(); c.moveTo(gx - 8 * s, gy); c.lineTo(gx + 8 * s, gy); c.moveTo(gx, gy - 8 * s); c.lineTo(gx, gy + 8 * s); c.stroke();

      // the iterates x_i(t): before N one trajectory; from N together and alone
      const tmp = [0, 0];
      if (t >= N && !alone) for (let i = 0; i < m; i++) { E.iterateAt(res, "local", t, i, tmp); dot(c, X(tmp[0]), Y(tmp[1]), D.local, 3.3 * s); }
      for (let i = 0; i < m; i++) { E.iterateAt(res, t >= N ? key : "local", t, i, tmp); dot(c, X(tmp[0]), Y(tmp[1]), alone ? D.local : D.coop, 3.3 * s); }

      // stations
      for (let i = 0; i < m; i++) stationGlyph(c, X(st[i][0]), Y(st[i][1]), ST_COLORS[i], i + 1, s, !!anim && state.tau > 0);

      // zoom on x*(t)
      drawInset(c, w, h, xs, t, v);

      // scale bar: 5 units = 50 m
      const L = 5 * v.k, sx0 = w - 14 - L, sy0 = 22;
      c.strokeStyle = "rgba(232, 238, 246, 0.75)";
      c.lineWidth = 1.4;
      c.beginPath(); c.moveTo(sx0, sy0 - 4); c.lineTo(sx0, sy0); c.lineTo(sx0 + L, sy0); c.lineTo(sx0 + L, sy0 - 4); c.stroke();
      c.fillStyle = "rgba(232, 238, 246, 0.8)";
      c.font = "11px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "top";
      c.fillText("50 m", sx0 + L / 2, sy0 + 4);
    }

    function drawInset(c, w, h, xs, t, v) {
      const res = S.res, m = res.m, N = res.N, key = tauKey(), alone = state.tau === 0;
      const square = w / h < 1.12;
      const size = square ? clamp(Math.round(w * 0.23), 72, 120) : clamp(Math.round(Math.min(w, h) * 0.27), 96, 150);
      const pad = square ? 10 : 12;
      const x0 = w - size - pad, y0 = h - size - pad, cx = x0 + size / 2, cy = y0 + size / 2;
      const tmp = [0, 0];
      let spread = 0;
      const pts = [];
      const take = function (k, col) {
        for (let i = 0; i < m; i++) {
          E.iterateAt(res, k, t, i, tmp);
          spread = Math.max(spread, Math.abs(tmp[0] - xs[0]), Math.abs(tmp[1] - xs[1]));
          pts.push([tmp[0], tmp[1], col]);
        }
      };
      if (t >= N && !alone) take("local", D.local);
      take(t >= N ? key : "local", alone ? D.local : D.coop);
      const target = clamp(spread * 1.4, 0.4, 6);
      S.zoom = state.playing || S.anim ? S.zoom + (target - S.zoom) * 0.12 : target;
      const half = S.zoom, kk = (size / 2 - 9) / half;
      // the zoomed square in the main view
      const hz = half * v.k;
      if (hz > 5) {
        c.strokeStyle = "rgba(232, 238, 246, 0.28)";
        c.lineWidth = 1;
        c.strokeRect(v.cx + xs[0] * v.k - hz, v.cy - (xs[1] - v.oy) * v.k - hz, 2 * hz, 2 * hz);
      }
      c.save();
      roundRect(c, x0, y0, size, size, 8);
      c.fillStyle = "rgba(7, 12, 22, 0.86)";
      c.fill();
      c.strokeStyle = "rgba(214, 226, 245, 0.24)";
      c.lineWidth = 1;
      c.stroke();
      roundRect(c, x0 + 1, y0 + 1, size - 2, size - 2, 7);
      c.clip();
      const ZX = function (x) { return cx + (x - xs[0]) * kk; }, ZY = function (y) { return cy - (y - xs[1]) * kk; };
      const XS = res.xstar;
      c.strokeStyle = D.gold;
      c.lineWidth = 1.3;
      for (let tt = Math.max(1, t - 40); tt <= t; tt++) {
        c.globalAlpha = 0.04 + 0.45 * (1 - (t - tt) / 40);
        c.beginPath(); c.moveTo(ZX(XS[(tt - 1) * 2]), ZY(XS[(tt - 1) * 2 + 1])); c.lineTo(ZX(XS[tt * 2]), ZY(XS[tt * 2 + 1])); c.stroke();
      }
      c.globalAlpha = 1;
      c.lineWidth = 1.7;
      c.beginPath(); c.moveTo(cx - 7, cy); c.lineTo(cx + 7, cy); c.moveTo(cx, cy - 7); c.lineTo(cx, cy + 7); c.stroke();
      pts.forEach(function (p) { dot(c, ZX(p[0]), ZY(p[1]), p[2], 3.4); });
      c.restore();
      // scale bar inside the zoom, a round number of metres
      const want = half * 0.75 * 10;
      const nice = [1, 2, 5, 10, 20, 50].filter(function (q) { return q <= want; }).pop() || 1;
      const len = (nice / 10) * kk;
      c.strokeStyle = "rgba(232, 238, 246, 0.75)";
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x0 + 9, y0 + size - 11); c.lineTo(x0 + 9 + len, y0 + size - 11); c.stroke();
      c.fillStyle = "rgba(232, 238, 246, 0.8)";
      c.font = "10.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      c.textAlign = "left";
      c.textBaseline = "middle";
      c.fillText(nice + " m", x0 + 14 + len, y0 + size - 11);
    }

    function roundRect(c, x, y, w, h, r) {
      c.beginPath();
      c.moveTo(x + r, y);
      c.arcTo(x + w, y, x + w, y + h, r);
      c.arcTo(x + w, y + h, x, y + h, r);
      c.arcTo(x, y + h, x, y, r);
      c.arcTo(x, y, x + w, y, r);
      c.closePath();
    }
    function dot(c, x, y, color, r) {
      c.fillStyle = color;
      c.strokeStyle = "rgba(6, 11, 20, 0.9)";
      c.lineWidth = 1.1;
      c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI); c.fill(); c.stroke();
    }
    function drone(c, x, y, color, s) {
      const a = 5.2 * s;
      c.strokeStyle = "rgba(160, 178, 204, 0.75)";
      c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(x - a, y - a); c.lineTo(x + a, y + a); c.moveTo(x - a, y + a); c.lineTo(x + a, y - a); c.stroke();
      c.fillStyle = "rgba(38, 50, 72, 0.95)";
      c.strokeStyle = "rgba(160, 178, 204, 0.6)";
      c.lineWidth = 0.8;
      [[-a, -a], [a, a], [-a, a], [a, -a]].forEach(function (p) { c.beginPath(); c.arc(x + p[0], y + p[1], 2.4 * s, 0, 2 * Math.PI); c.fill(); c.stroke(); });
      c.fillStyle = color;
      c.strokeStyle = "rgba(6, 11, 20, 0.9)";
      c.lineWidth = 1.2;
      c.beginPath(); c.arc(x, y, 3.7 * s, 0, 2 * Math.PI); c.fill(); c.stroke();
    }
    function stationGlyph(c, x, y, color, n, s, pulsing) {
      c.save();
      c.translate(x, y);
      c.scale(s, s);
      if (pulsing) {
        c.strokeStyle = "rgba(255, 244, 204, 0.55)";
        c.lineWidth = 1.2;
        c.beginPath(); c.arc(0, 0, 15, 0, 2 * Math.PI); c.stroke();
      }
      c.strokeStyle = "rgba(232, 238, 246, 0.85)";
      c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(0, -7); c.lineTo(0, -12); c.stroke();
      c.fillStyle = "rgba(232, 238, 246, 0.95)";
      c.beginPath(); c.arc(0, -12.5, 1.7, 0, 2 * Math.PI); c.fill();
      c.fillStyle = color;
      c.strokeStyle = "rgba(232, 238, 246, 0.8)";
      c.lineWidth = 1.1;
      roundRect(c, -10, -7, 20, 14, 3);
      c.fill(); c.stroke();
      c.fillStyle = "#08101c";
      c.font = "700 10.5px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(String(n), 0, 0.6);
      c.restore();
    }

    // ================================================================ charts (SVG)
    function svgBox(host, margin) {
      const w = Math.max(200, Math.round(host.clientWidth || 300));
      const h = clamp(Math.round(w * 0.62), 180, 240);
      host.textContent = "";
      const s = el("svg", { class: "pg-svg", viewBox: "0 0 " + w + " " + h, width: w, height: h, "aria-hidden": "true", focusable: "false" }, host);
      return { s: s, w: w, h: h, m: margin, pw: w - margin.l - margin.r, ph: h - margin.t - margin.b };
    }
    /** x ticks, skipping any that would run into the axis label at the right end. */
    function xTicks(box, g, values, X, fmt, labelParts) {
      const y = box.m.t + box.ph + 14;
      let stop = Infinity;
      if (labelParts) {
        const lab = axisLabel(box, box.m.l + box.pw, y, "end", labelParts);
        stop = box.m.l + box.pw - lab.getComputedTextLength() - 8;
      }
      values.forEach(function (q) {
        const x = X(q);
        el("line", { x1: x, x2: x, y1: box.m.t, y2: box.m.t + box.ph, class: "pg-grid" }, g);
        const tx = el("text", { x: x, y: y, "text-anchor": "middle", class: "pg-tick" }, g);
        tx.textContent = fmt(q);
        if (x + tx.getComputedTextLength() / 2 > stop) tx.remove();
      });
    }
    function axisLabel(box, x, y, anchor, parts) {
      const t = el("text", { x: x, y: y, "text-anchor": anchor, class: "pg-axl" }, box.s);
      parts.forEach(function (p) {
        const sp = el("tspan", p[1] ? { class: "pg-mi" } : null, t);
        sp.textContent = p[0];
      });
      return t;
    }
    function keys(ul, items) {
      ul.innerHTML = items.map(function (it) { return "<li>" + it[0] + "<span>" + it[1] + "</span></li>"; }).join("");
    }
    function buildCharts() {
      buildEig();
      buildErr();
      renderMc();
    }

    // ---- eigenvalues of the estimates in the complex plane (upper half-plane) ----
    function buildEig() {
      const res = S.res, host = $("eig");
      const box = svgBox(host, { l: 40, r: 10, t: 18, b: 22 });
      const coop = res.estimates[tauKey()], loc = res.estimates.local, showCoop = state.tau > 0;
      const tr = E.eig2(res.A);
      const pair = function (e) { return e.complex ? [[e.re1, Math.abs(e.im1)], [e.re1, Math.abs(e.im1)]] : [[e.re1, 0], [e.re2, 0]]; };
      const L = loc.eig.map(pair);
      const rounds = showCoop ? (coop.rounds || [{ eig: loc.eig }, { eig: coop.eig }]).map(function (r) { return r.eig.map(pair); }) : null;
      // a window with equal scales on both axes around the true eigenvalue and every estimate
      let re0 = tr.re1, re1 = tr.re1, im0 = tr.im1, im1 = tr.im1;
      const take = function (p) { re0 = Math.min(re0, p[0]); re1 = Math.max(re1, p[0]); im0 = Math.min(im0, p[1]); im1 = Math.max(im1, p[1]); };
      L.forEach(function (pp) { pp.forEach(take); });
      if (rounds) rounds.forEach(function (r) { r.forEach(function (pp) { pp.forEach(take); }); });
      const asp = box.pw / box.ph;
      const hx = clamp(Math.max((re1 - re0) / 2, ((im1 - im0) / 2) * asp) * 1.3, 0.02 * asp, 0.45);
      const hy = hx / asp, mx = (re0 + re1) / 2, my = (im0 + im1) / 2;
      const X = function (re) { return box.m.l + ((re - mx + hx) / (2 * hx)) * box.pw; };
      const Y = function (im) { return box.m.t + (1 - (im - my + hy) / (2 * hy)) * box.ph; };
      const g = el("g", null, box.s);
      const stp = niceStep((2 * hx) / 4.5), dec = Math.max(0, -Math.floor(Math.log10(stp) + 1e-9));
      const xv = [];
      for (let q = Math.ceil((mx - hx) / stp) * stp; q <= mx + hx + 1e-12; q += stp) xv.push(q);
      xTicks(box, g, xv, X, function (q) { return q.toFixed(dec); }, [["Re ", false], ["λ", true]]);
      axisLabel(box, 0, 11, "start", [["Im ", false], ["λ", true]]);
      for (let q = Math.ceil((my - hy) / stp) * stp; q <= my + hy + 1e-12; q += stp) {
        el("line", { x1: box.m.l, x2: box.m.l + box.pw, y1: Y(q), y2: Y(q), class: "pg-grid" }, g);
        el("text", { x: box.m.l - 5, y: Y(q) + 3.5, "text-anchor": "end", class: "pg-tick" }, g).textContent = q.toFixed(dec);
      }
      const clipId = id("eigclip");
      const cp = el("clipPath", { id: clipId }, el("defs", null, box.s));
      el("rect", { x: box.m.l, y: box.m.t, width: box.pw, height: box.ph }, cp);
      const plot = el("g", { "clip-path": "url(#" + clipId + ")" }, box.s);
      // the unit circle |lambda| = 1 (stability boundary)
      const arc = [];
      let lab = null;
      for (let j = 0; j <= 1440; j++) {
        const a = (Math.PI * j) / 1440, px = X(Math.cos(a)), py = Y(Math.sin(a));
        arc.push((j ? "L" : "M") + px.toFixed(1) + " " + py.toFixed(1));
        if (!lab && px > box.m.l + 44 && px < box.m.l + box.pw - 2 && py > box.m.t + 10 && py < box.m.t + box.ph - 22) lab = [px, py];
      }
      el("path", { d: arc.join(""), class: "pg-unit" }, plot);
      if (lab) el("text", { x: lab[0] - 6, y: lab[1] + 3, "text-anchor": "end", class: "pg-note" }, plot).textContent = "|λ| = 1";
      // the true eigenvalue: a thin cross under the estimates
      const ax = X(tr.re1), ay = Y(tr.im1);
      el("path", { d: "M" + (ax - 9) + " " + ay + "h18M" + ax + " " + (ay - 9) + "v18", stroke: "#363636", "stroke-width": 1.3 }, plot);
      // estimates: alone (triangles), together (circles); the true eigenvalue (cross)
      L.forEach(function (pp) {
        pp.forEach(function (p) {
          const x = X(p[0]), y = Y(p[1]);
          el("path", { d: "M" + x.toFixed(1) + " " + (y - 4.6).toFixed(1) + "l4.2 7.4h-8.4z", fill: C.local, stroke: "#fff", "stroke-width": 0.9, "stroke-linejoin": "round" }, plot);
        });
      });
      const dots = [];
      if (rounds) rounds[rounds.length - 1].forEach(function (pp) {
        dots.push(pp.map(function (p) { return el("circle", { cx: X(p[0]), cy: Y(p[1]), r: 4, fill: C.coop, stroke: "#fff", "stroke-width": 1 }, plot); }));
      });
      el("rect", { x: box.m.l, y: box.m.t, width: box.pw, height: box.ph, class: "pg-frame" }, box.s);
      S.eig = { X: X, Y: Y, dots: dots, rounds: rounds };
      S.eigP = -1;
      const items = [];
      if (showCoop) items.push([K.dotCoop, "together"]);
      items.push([K.triLocal, "alone"], [K.cross, "true " + M.trueA]);
      keys($("eig-keys"), items);
      host.setAttribute("aria-label", "Eigenvalues of the six estimates, upper half-plane. True eigenvalue " + tr.re1.toFixed(3) + " + " +
        tr.im1.toFixed(3) + "i. Median identification error " + (showCoop ? sig2(coop.median) + " together, " : "") + sig2(loc.median) + " alone.");
    }
    function eigAt(p) {
      S.eigP = p;
      const E2 = S.eig;
      if (!E2 || !E2.rounds) return;
      const n = E2.rounds.length - 1, r = clamp(p, 0, 1) * n, i0 = Math.min(n - 1, Math.floor(r)), f = r - i0;
      const ease = f < 0.5 ? 2 * f * f : 1 - 2 * (1 - f) * (1 - f);
      const A0 = E2.rounds[Math.max(0, i0)], A1 = E2.rounds[Math.min(n, i0 + 1)];
      E2.dots.forEach(function (pair, i) {
        pair.forEach(function (c, j) {
          const a = A0[i][j], b = n === 0 ? a : A1[i][j];
          const re = p >= 1 ? E2.rounds[n][i][j][0] : a[0] + (b[0] - a[0]) * ease;
          const im = p >= 1 ? E2.rounds[n][i][j][1] : a[1] + (b[1] - a[1]) * ease;
          c.setAttribute("cx", E2.X(re).toFixed(2));
          c.setAttribute("cy", E2.Y(im).toFixed(2));
        });
      });
    }

    // ---- error to x*(t) over time ----
    function buildErr() {
      const res = S.res, host = $("err"), N = res.N, T = res.T, alone = state.tau === 0, key = tauKey();
      const box = svgBox(host, { l: 36, r: 10, t: 18, b: 22 });
      const ser = res.errSeries;
      const list = [
        { k: "oracleA", color: C.oracle, w: 1.25, dash: "5 2.5 1.4 2.5" },
        { k: "persistence", color: C.pers, w: 1.6, dash: "1.5 3" },
      ];
      if (!alone) list.push({ k: "local", color: C.local, w: 1.6 });
      list.push({ k: alone ? "local" : key, color: alone ? C.local : C.coop, w: 1.9 });
      let lo = Infinity, hi = 0;
      list.forEach(function (sr) {
        const e = ser[sr.k];
        for (let t = 0; t < T; t++) { const q = e[t]; if (q > 0 && isFinite(q)) { lo = Math.min(lo, q); hi = Math.max(hi, q); } }
      });
      const b = logBounds(clamp(lo * 0.9, 1e-3, 1e2), clamp(hi * 1.1, 2e-3, 1e3));
      const ylo = b[0], yhi = b[1];
      const X = function (t) { return box.m.l + (t / (T - 1)) * box.pw; };
      const Y = function (q) { return box.m.t + box.ph * (1 - Math.log(clamp(q, ylo, yhi) / ylo) / Math.log(yhi / ylo)); };
      const g = el("g", null, box.s);
      logTicks(ylo, yhi).forEach(function (q) {
        el("line", { x1: box.m.l, x2: box.m.l + box.pw, y1: Y(q), y2: Y(q), class: "pg-grid" }, g);
        el("text", { x: box.m.l - 5, y: Y(q) + 3.5, "text-anchor": "end", class: "pg-tick" }, g).textContent = tickText(q);
      });
      const xv = [];
      for (let q = 0; q < T; q += T > 330 ? 100 : 50) xv.push(q);
      xTicks(box, g, xv, X, String, [["t", true], [" (s)", false]]);
      el("line", { x1: X(N), x2: X(N), y1: box.m.t - 4, y2: box.m.t + box.ph, class: "pg-nline" }, g);
      axisLabel(box, X(N), box.m.t - 7, "middle", [["N", true]]);
      const path = function (e, a, z) {
        const d = [];
        for (let t = a; t <= z; t++) d.push((t === a ? "M" : "L") + X(t).toFixed(1) + " " + Y(e[t]).toFixed(1));
        return d.join("");
      };
      const clipId = id("errclip");
      const cp = el("clipPath", { id: clipId }, el("defs", null, box.s));
      const past = el("rect", { x: box.m.l - 2, y: 0, width: 0, height: box.h }, cp);
      const fut = el("g", { class: "pg-future" }, box.s), now = el("g", { "clip-path": "url(#" + clipId + ")" }, box.s);
      const add = function (d, sr) {
        [fut, now].forEach(function (gg) {
          el("path", { d: d, class: "pg-line", stroke: sr.color, "stroke-width": sr.w, "stroke-dasharray": sr.dash || null }, gg);
        });
      };
      add(path(ser[alone ? "local" : key], 0, N - 1), { color: alone ? C.local : C.coop, w: 1.9 });
      list.forEach(function (sr) { add(path(ser[sr.k], N - 1, T - 1), sr); });
      el("rect", { x: box.m.l, y: box.m.t, width: box.pw, height: box.ph, class: "pg-frame" }, box.s);
      const head = el("line", { x1: X(0), x2: X(0), y1: box.m.t, y2: box.m.t + box.ph, class: "pg-head" }, box.s);
      S.err = { X: X, past: past, head: head, box: box, T: T };
      const items = [];
      if (!alone) items.push([K.coop, "together"]);
      items.push([K.local, "alone"], [K.pers, "persistence"], [K.oracle, "oracle " + M.trueA]);
      keys($("err-keys"), items);
      const rm = function (k) { return sig2(res.rmse[k]); };
      host.setAttribute("aria-label", "Network-average error to x*(t), log scale, t from 0 to " + (T - 1) + " s; telemetry stops at N = " + N +
        ". Tracking RMSE: " + (alone ? "" : "together " + rm(key) + ", ") + "alone " + rm("local") + ", persistence " + rm("persistence") + ", oracle A " + rm("oracleA") + ".");
    }
    function errAt(t) {
      const R = S.err;
      if (!R) return;
      const x = R.X(t);
      R.past.setAttribute("width", Math.max(0, x - R.box.m.l + 2).toFixed(1));
      R.head.setAttribute("x1", x.toFixed(1));
      R.head.setAttribute("x2", x.toFixed(1));
    }

    // ================================================================ Monte Carlo
    function refFor() { return matches(BASE) ? REF_PAPER : null; }
    function renderMc() {
      const host = $("mc"), panel = $("mcp"), mc = S.mc;
      const box = svgBox(host, { l: 42, r: 10, t: 18, b: 22 });
      const X = function (n) { return box.m.l + box.pw * Math.log(n / 25) / Math.log(275 / 25); };
      const g = el("g", null, box.s);
      xTicks(box, g, MC_NS, X, String, [["N", true]]);
      panel.classList.toggle("is-empty", !mc);
      if (!mc) {
        [0.25, 0.5, 0.75].forEach(function (f) { el("line", { x1: box.m.l, x2: box.m.l + box.pw, y1: box.m.t + f * box.ph, y2: box.m.t + f * box.ph, class: "pg-grid" }, g); });
        el("rect", { x: box.m.l, y: box.m.t, width: box.pw, height: box.ph, class: "pg-frame" }, box.s);
        $("mc-keys").innerHTML = "";
        host.setAttribute("aria-label", "Monte Carlo: not run yet.");
        return;
      }
      const metric = state.metric, rows = mc.result.byN;
      const series = [];
      if (mc.tau > 0) series.push({ k: "coop" + mc.tau, color: C.coop, ref: "coop", label: "together", mark: "dot" });
      series.push({ k: "local", color: C.local, ref: "local", label: "alone", mark: "tri" });
      const ref = mc.ref && mc.ref[metric];
      let lo = Infinity, hi = 0;
      series.forEach(function (sr) {
        rows.forEach(function (r) { const q = r[metric][sr.k]; if (q) { lo = Math.min(lo, q.lo); hi = Math.max(hi, q.hi); } });
        if (ref && ref[sr.ref] && (sr.ref === "local" || mc.tau === 3)) ref[sr.ref].forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); });
      });
      const bb = logBounds(clamp(lo * 0.92, 1e-4, 1e2), clamp(hi * 1.08, 2e-4, 1e3));
      const ylo = bb[0], yhi = bb[1];
      const Y = function (q) { return box.m.t + box.ph * (1 - Math.log(clamp(q, ylo, yhi) / ylo) / Math.log(yhi / ylo)); };
      logTicks(ylo, yhi).forEach(function (q) {
        el("line", { x1: box.m.l, x2: box.m.l + box.pw, y1: Y(q), y2: Y(q), class: "pg-grid" }, g);
        el("text", { x: box.m.l - 5, y: Y(q) + 3.5, "text-anchor": "end", class: "pg-tick" }, g).textContent = tickText(q);
      });
      series.forEach(function (sr) {
        const up = [], dn = [];
        rows.forEach(function (r) {
          const q = r[metric][sr.k];
          up.push(X(r.N).toFixed(1) + " " + Y(q.hi).toFixed(1));
          dn.unshift(X(r.N).toFixed(1) + " " + Y(q.lo).toFixed(1));
        });
        el("path", { d: "M" + up.join("L") + "L" + dn.join("L") + "Z", fill: sr.color, "fill-opacity": 0.14, class: "pg-band" }, box.s);
      });
      series.forEach(function (sr) {
        const d = rows.map(function (r, j) { return (j ? "L" : "M") + X(r.N).toFixed(1) + " " + Y(r[metric][sr.k].med).toFixed(1); }).join("");
        el("path", { d: d, class: "pg-line", stroke: sr.color, "stroke-width": 1.9 }, box.s);
        rows.forEach(function (r) {
          const x = X(r.N), y = Y(r[metric][sr.k].med);
          if (sr.mark === "dot") el("circle", { cx: x, cy: y, r: 3.3, fill: sr.color, stroke: "#fff", "stroke-width": 1 }, box.s);
          else el("path", { d: "M" + x.toFixed(1) + " " + (y - 4.2).toFixed(1) + "l3.8 6.7h-7.6z", fill: sr.color, stroke: "#fff", "stroke-width": 0.9, "stroke-linejoin": "round" }, box.s);
        });
      });
      let refShown = false;
      if (ref) series.forEach(function (sr) {
        if (!ref[sr.ref] || (sr.ref === "coop" && mc.tau !== 3)) return;
        refShown = true;
        ref[sr.ref].forEach(function (v, j) {
          const x = X(MC_NS[j]), y = Y(v);
          el("path", { d: "M" + x.toFixed(1) + " " + (y - 4.2).toFixed(1) + "l4.2 4.2-4.2 4.2-4.2-4.2z", fill: "#fff", stroke: sr.color, "stroke-width": 1.3 }, box.s);
        });
      });
      el("rect", { x: box.m.l, y: box.m.t, width: box.pw, height: box.ph, class: "pg-frame" }, box.s);
      const items = series.map(function (sr) { return [sr.mark === "dot" ? K.lineCoop : K.lineLocal, sr.label]; });
      if (refShown) items.push([K.ref, mc.ref.label]);
      keys($("mc-keys"), items);
      host.setAttribute("aria-label", (metric === "id" ? "Identification error" : "Tracking RMSE") + " versus N, medians over " + mc.result.trials + " trials: " +
        series.map(function (sr) { return sr.label + " " + rows.map(function (r) { return "N " + r.N + ": " + sig2(r[metric][sr.k].med); }).join(", "); }).join("; ") + ".");
    }
    function updateMcState() {
      const panel = $("mcp"), mc = S.mc, running = !!S.mcRun;
      const stale = !!mc && mc.sig !== signature();
      panel.classList.toggle("is-stale", stale);
      $("cta").hidden = !!mc && !stale && !running;
      $("run").disabled = running;
      $("prog").hidden = !running;
      let note = "";
      if (running) note = "Running…";
      else if (stale) note = "Settings changed since the last run.";
      else if (mc) note = "Medians and interquartile ranges, " + mc.result.trials + " trials per " + M.N;
      $("mc-note").innerHTML = note;   // static strings and the KaTeX N, as on the Run button
    }
    function mcProgress(done, total) {
      const p = Math.round((100 * done) / total);
      const bar = $("prog");
      bar.setAttribute("aria-valuenow", String(p));
      bar.firstChild.style.width = p + "%";
    }
    function workerUrl() {
      try { return new URL("mc-worker.js", SCRIPT_SRC || document.baseURI).href; } catch (e) { return null; }
    }
    function runMc() {
      if (S.mcRun) return S.mcRun.promise;
      const cfg = Object.assign(engineCfg(), { series: false, rounds: false, baselines: false });
      const opts = { Ns: MC_NS, trials: MC_TRIALS, seed: state.seed };
      const sig = signature(), tau = state.tau, ref = refFor(), t0 = performance.now();
      let resolve;
      const job = { promise: new Promise(function (r) { resolve = r; }), cancel: null };
      S.mcRun = job;
      updateMcState();
      mcProgress(0, 1);
      const finish = function (result, how) {
        S.mcRun = null;
        if (result) S.mc = { result: result, sig: sig, tau: tau, ref: ref, ms: performance.now() - t0, how: how };
        renderMc();
        updateMcState();
        if (result) {
          const c = result.byN.map(function (r) { return sig2(r.id[tau > 0 ? "coop" + tau : "local"].med); }).join(", ");
          $("live").textContent = "Monte Carlo done. Median identification error for N = 30 to 200: " + c + ".";
        }
        resolve(S.mc);
      };
      const url = workerUrl();
      let worker = null;
      if (window.Worker && url && location.protocol !== "file:") {
        try { worker = new Worker(url); } catch (e) { worker = null; }
      }
      if (worker) {
        let done = false;
        const fallback = function () { if (done) return; done = true; worker.terminate(); runChunked(cfg, opts, finish); };
        worker.onmessage = function (ev) {
          const d = ev.data || {};
          if (d.type === "progress") mcProgress(d.done, d.total);
          else if (d.type === "done") { done = true; worker.terminate(); finish(d.result, "worker"); }
          else if (d.type === "error") fallback();
        };
        worker.onerror = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); fallback(); };
        worker.postMessage({ cmd: "run", cfg: cfg, opts: opts });
      } else runChunked(cfg, opts, finish);
      return job.promise;
    }
    function runChunked(cfg, opts, finish) {
      const total = opts.Ns.length * opts.trials;
      const out = { Ns: opts.Ns, trials: opts.trials, seed: opts.seed, byN: [] };
      let a = 0, tr = 0, done = 0, bucket = [];
      function chunk() {
        const end = performance.now() + 12;
        while (performance.now() < end && a < opts.Ns.length) {
          bucket.push(E.monteCarloTrial(cfg, opts.Ns[a], tr, opts.seed));
          tr++; done++;
          if (tr === opts.trials) {
            out.byN.push(Object.assign({ N: opts.Ns[a] }, E.summarizeTrials(bucket)));
            bucket = []; tr = 0; a++;
          }
        }
        mcProgress(done, total);
        if (a < opts.Ns.length) setTimeout(chunk, 0);
        else finish(out, "main thread");
      }
      setTimeout(chunk, 0);
    }

    // ================================================================ events
    function setState(patch) {
      Object.assign(state, patch);
      recompute();
    }
    let pending = 0;
    function scheduleRecompute() {
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = 0; recompute(); });
    }
    form.addEventListener("submit", function (e) { e.preventDefault(); });
    form.addEventListener("input", function (e) {
      const t = e.target;
      S.interacted = true;
      if (t.name === id("mission")) {
        setState({ mission: t.value, graph: t.value === "search" ? "ring" : "paper", p0: t.value === "search" ? 2.5 : 4 });
        return;
      }
      const k = t.dataset && t.dataset.key;
      if (!k) return;
      state[k] = k === "graph" ? t.value : k === "alpha" ? Math.round(parseFloat(t.value) * 100) / 100 : parseFloat(t.value);
      if (t.type === "range") fill(t);
      updateOutputs();
      scheduleRecompute();
    });
    form.addEventListener("change", function (e) {
      const t = e.target;
      S.interacted = true;
      if (t === $("seed")) setState({ seed: clamp(Math.round(+t.value || 0), 0, 999999) });
    });
    $("newseed").addEventListener("click", function () {
      S.interacted = true;
      setState({ seed: 1 + Math.floor(Math.random() * 99999) });
    });
    root.querySelectorAll(".pg-chip").forEach(function (b) {
      b.addEventListener("click", function () {
        S.interacted = true;
        setState(Object.assign({}, PRESETS.filter(function (p) { return p.id === b.dataset.preset; })[0].set));
      });
    });
    playBtn.addEventListener("click", function () { S.interacted = true; setPlaying(!state.playing); });
    $("reset").addEventListener("click", function () { S.interacted = true; setPlaying(false); jump(0); });
    timeEl.addEventListener("input", function () { S.interacted = true; if (state.playing) setPlaying(false); jump(+timeEl.value); });
    $("speed").addEventListener("change", function (e) { state.speed = +e.target.value; });
    root.querySelectorAll(".pg-tab").forEach(function (b) {
      b.addEventListener("click", function () {
        state.metric = b.dataset.metric;
        root.querySelectorAll(".pg-tab").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
        renderMc();
      });
    });
    $("run").addEventListener("click", function () { S.interacted = true; runMc(); });

    // keyboard on the focused viewport
    canvas.addEventListener("keydown", function (e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      let used = true;
      if (e.key === " " || e.key === "k") setPlaying(!state.playing);
      else if (e.key === "ArrowRight") { setPlaying(false); jump(state.t + (e.shiftKey ? 10 : 1)); }
      else if (e.key === "ArrowLeft") { setPlaying(false); jump(state.t - (e.shiftKey ? 10 : 1)); }
      else if (e.key === "Home") { setPlaying(false); jump(0); }
      else if (e.key === "End") { setPlaying(false); jump(S.res.T - 1); }
      else used = false;
      if (used) { e.preventDefault(); S.interacted = true; }
    });
    // scrub by dragging on the error chart
    (function () {
      const host = $("err");
      let drag = false;
      const seek = function (e) {
        const R = S.err;
        if (!R) return;
        const r = host.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * R.box.w;
        jump(((x - R.box.m.l) / R.box.pw) * (R.T - 1));
      };
      host.addEventListener("pointerdown", function (e) {
        if (e.button !== 0) return;
        drag = true;
        S.interacted = true;
        if (state.playing) setPlaying(false);
        try { host.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
        seek(e);
      });
      host.addEventListener("pointermove", function (e) { if (drag) seek(e); });
      const end = function () { drag = false; };
      host.addEventListener("pointerup", end);
      host.addEventListener("pointercancel", end);
    })();

    // pause off-screen and in hidden tabs
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          S.visible = en.isIntersecting;
          if (!S.visible) return;
          if (!S.everVisible && en.intersectionRatio >= 0.3) {
            S.everVisible = true;
            if (!reduceMotion.matches && !S.interacted) setPlaying(true);
          }
          S.last = 0;
          kick();
        });
      }, { threshold: [0, 0.3] }).observe(view);
    } else {
      S.visible = true;
    }
    document.addEventListener("visibilitychange", function () { if (!document.hidden) { S.last = 0; kick(); } });
    let lastW = 0;
    const onResize = function () {
      resize();
      const w = root.clientWidth;
      if (w !== lastW) { lastW = w; buildCharts(); }
      render(true);
    };
    if ("ResizeObserver" in window) {
      let rq = 0;
      new ResizeObserver(function () {
        if (rq) return;
        rq = requestAnimationFrame(function () { rq = 0; onResize(); });
      }).observe(root);
    } else window.addEventListener("resize", onResize);

    // ---------------------------------------------------------------- start
    $("more").open = false;
    syncControls();
    resize();
    recompute();
    lastW = root.clientWidth;
    if (reduceMotion.matches) jump(S.res.T - 1);

    // handle for tests
    root.__pg = {
      state: state,
      get result() { return S.res; },
      get mc() { return S.mc; },
      set: function (patch) { setState(patch); },
      jump: function (t) { setPlaying(false); jump(t); },
      play: function (v) { setPlaying(v !== false); },
      runMonteCarlo: runMc,
    };
  }

  function boot() {
    const host = document.getElementById("playground");
    if (!host || host.__pg) return;
    if (!window.CoopEngine) {
      host.innerHTML = '<p class="pg-error">The simulation could not load.</p>';
      return;
    }
    try {
      Playground(host);
    } catch (err) {
      host.innerHTML = '<p class="pg-error">The simulation could not start.</p>';
      if (window.console) console.error(err);
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
