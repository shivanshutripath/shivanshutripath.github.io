/*
 * engine.js -- Algorithm 1 of "Cooperative Learning of Shared Latent Dynamics
 * for Distributed Online Optimization" (Tripathi and Raissi), case study (A),
 * in plain JavaScript.  No dependencies; works in a page (window.CoopEngine)
 * and in a Worker (self.CoopEngine).
 *
 * It is a line-by-line port of the reference implementation
 *   paper_v4_package/code/experiments.py   run_trial(), class Rendezvous,
 *       window_estimates, iv_moments, ls_moments, consensus, identify
 *       (spectral-radius safeguard rho_max = 0.999), Forecaster,
 *       gradient_tracking_phase, kalman_forecast_state, rmse_of
 * and of the Webots variant of case study (A)
 *   webots_demo/lib/rendezvous_common.py   tasking(i, t), nearest-neighbour ring
 *   webots_demo/tools/analyze_runs.py      reference_estimates(), replay()
 * The order of every random draw and of every floating-point operation follows
 * those files, so that a replay of the same draws gives the same numbers up to
 * the last bits of BLAS/LAPACK rounding (checked to ~1e-13).
 *
 * Two missions:
 *   "posts"   the paper's case study (A): UAV i holds its observation location,
 *             p_i(t) = bbar_i; the oracle returns a noisy gradient,
 *             y_i = 2 h_i (x - bbar_i) - 2 h_i theta_i + w, w ~ N(0, R), R = 1.5^2 I.
 *             Draw order of run_trial: theta(0), process noise for t = 1..T-1,
 *             then the oracle noise for t = 0..N-1 (agent by agent).
 *   "search"  the Webots simulation: the UAVs fly a search line abreast whose
 *             centre circles the site (tasking(i, t)); station i receives a
 *             noisy position y_i = p_i + theta_i + sigma_b z (sigma_b = 0.75)
 *             and uses the gradient 2 h_i (x - y_i).  Draw order of the
 *             Webots supervisor: theta(0), then per step the process noise and
 *             the telemetry noise of each station.
 *
 * Random numbers: CoopEngine.rng(seed) is xoshiro128** (Blackman and Vigna,
 * 2018) on a 128-bit state that SplitMix32 expands from the seed (a number or
 * a list of integers, first hashed with the MurmurHash3 finalizer); uniforms
 * are 53-bit doubles built from two outputs; normals come from the Box-Muller
 * transform (both values of each pair are used).  CoopEngine.replayRng({normals,
 * uniforms}) instead returns externally supplied draws in order (used to check
 * the port against numpy, draw for draw).
 */
(function (root) {
  "use strict";

  // ===================================================================== PRNG
  function fmix32(h) {
    h ^= h >>> 16;
    h = Math.imul(h, 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
    return h >>> 0;
  }

  function hashSeed(seed) {
    const list = Array.isArray(seed) ? seed : [seed];
    let h = 0x9e3779b9 ^ list.length;
    for (let j = 0; j < list.length; j++) {
      const v = Math.floor(Math.abs(Number(list[j]) || 0));
      const lo = v >>> 0;
      const hi = Math.floor(v / 4294967296) >>> 0;
      h = fmix32((h ^ lo) + Math.imul(j + 1, 0x7f4a7c15));
      h = fmix32((h ^ hi) + 0x6a09e667);
    }
    return h >>> 0;
  }

  function rotl(x, k) {
    return (x << k) | (x >>> (32 - k));
  }

  /** Seeded generator: xoshiro128** state from SplitMix32, Box-Muller normals. */
  function Rng(seed) {
    let a = hashSeed(seed);
    const sm = function () {
      a = (a + 0x9e3779b9) | 0;
      let t = a ^ (a >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t ^= t >>> 15;
      t = Math.imul(t, 0x735a2d97);
      t ^= t >>> 15;
      return t >>> 0;
    };
    this.s0 = sm() | 0;
    this.s1 = sm() | 0;
    this.s2 = sm() | 0;
    this.s3 = sm() | 0;
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
    this.spare = 0;
    this.hasSpare = false;
    this.count = 0;
  }
  Rng.prototype.next32 = function () {
    const s0 = this.s0, s1 = this.s1, s2 = this.s2, s3 = this.s3;
    const result = Math.imul(rotl(Math.imul(s1, 5), 7), 9) >>> 0;
    const t = s1 << 9;
    let n2 = s2 ^ s0;
    let n3 = s3 ^ s1;
    const n1 = s1 ^ n2;
    const n0 = s0 ^ n3;
    n2 ^= t;
    n3 = rotl(n3, 11);
    this.s0 = n0;
    this.s1 = n1;
    this.s2 = n2;
    this.s3 = n3;
    return result;
  };
  /** Uniform double in [0, 1) with 53 random bits. */
  Rng.prototype.random = function () {
    const x = this.next32() >>> 5;
    const y = this.next32() >>> 6;
    return (x * 67108864 + y) / 9007199254740992;
  };
  Rng.prototype.uniform = function (lo, hi) {
    return lo + (hi - lo) * this.random();
  };
  /** Standard normal by the Box-Muller transform. */
  Rng.prototype.normal = function () {
    this.count++;
    if (this.hasSpare) {
      this.hasSpare = false;
      return this.spare;
    }
    const u1 = 1 - this.random(); // (0, 1]
    const u2 = this.random();
    const r = Math.sqrt(-2 * Math.log(u1));
    const ang = 2 * Math.PI * u2;
    this.spare = r * Math.sin(ang);
    this.hasSpare = true;
    return r * Math.cos(ang);
  };

  /** Replays recorded draws: {normals: [...], uniforms: [...]} (values as drawn). */
  function ReplayRng(draws) {
    this.normals = draws.normals || [];
    this.uniforms = draws.uniforms || [];
    this.ni = 0;
    this.ui = 0;
    this.count = 0;
  }
  ReplayRng.prototype.normal = function () {
    if (this.ni >= this.normals.length) throw new Error("replay: ran out of normal draws at " + this.ni);
    this.count++;
    return this.normals[this.ni++];
  };
  ReplayRng.prototype.uniform = function (lo, hi) {
    if (this.ui >= this.uniforms.length) throw new Error("replay: ran out of uniform draws at " + this.ui);
    const v = this.uniforms[this.ui++];
    if (!(v >= lo && v <= hi)) throw new Error("replay: uniform draw " + v + " outside [" + lo + ", " + hi + "]");
    return v;
  };
  ReplayRng.prototype.remaining = function () {
    return { normals: this.normals.length - this.ni, uniforms: this.uniforms.length - this.ui };
  };

  // ============================================================ small linear algebra
  // 2x2 matrices are Float64Array/arrays [a11, a12, a21, a22] (row major).
  /** Solve G x = b (2x2) by LU with partial pivoting, as LAPACK dgesv. */
  function solve2(g00, g01, g10, g11, b0, b1, out, o) {
    if (Math.abs(g10) > Math.abs(g00)) {
      let t = g00; g00 = g10; g10 = t;
      t = g01; g01 = g11; g11 = t;
      t = b0; b0 = b1; b1 = t;
    }
    const l = g10 / g00;
    const u11 = g11 - l * g01;
    const y1 = b1 - l * b0;
    const x1 = y1 / u11;
    out[o] = (b0 - g01 * x1) / g00;
    out[o + 1] = x1;
  }

  /** Inverse of a 2x2 matrix by the same LU (columns of the identity). */
  function inv2(M, out) {
    const tmp = [0, 0];
    solve2(M[0], M[1], M[2], M[3], 1, 0, tmp, 0);
    const c00 = tmp[0], c10 = tmp[1];
    solve2(M[0], M[1], M[2], M[3], 0, 1, tmp, 0);
    out[0] = c00;
    out[1] = tmp[0];
    out[2] = c10;
    out[3] = tmp[1];
    return out;
  }

  function mul2(A, B, out) {
    const a = A[0] * B[0] + A[1] * B[2];
    const b = A[0] * B[1] + A[1] * B[3];
    const c = A[2] * B[0] + A[3] * B[2];
    const d = A[2] * B[1] + A[3] * B[3];
    out[0] = a; out[1] = b; out[2] = c; out[3] = d;
    return out;
  }

  /** Eigenvalues of a real 2x2 matrix: {re1, im1, re2, im2, rho} (im1 >= 0). */
  function eig2(M) {
    const a = M[0], b = M[1], c = M[2], d = M[3];
    const half = 0.5 * (a + d);
    const det = a * d - b * c;
    const q = 0.5 * (a - d);
    const disc = q * q + b * c; // = half^2 - det, written to avoid cancellation
    if (disc < 0) {
      const im = Math.sqrt(-disc);
      const r = Math.hypot(half, im);
      return { re1: half, im1: im, re2: half, im2: -im, rho: r, complex: true };
    }
    const s = Math.sqrt(disc);
    const l1 = half + (half >= 0 ? s : -s);
    const l2 = l1 !== 0 ? det / l1 : half - (half >= 0 ? s : -s);
    return { re1: l1, im1: 0, re2: l2, im2: 0, rho: Math.max(Math.abs(l1), Math.abs(l2)), complex: false };
  }

  function frob2(A, B) {
    const d0 = A[0] - B[0], d1 = A[1] - B[1], d2 = A[2] - B[2], d3 = A[3] - B[3];
    return Math.sqrt(d0 * d0 + d1 * d1 + d2 * d2 + d3 * d3);
  }

  /** Eigenvalues of a symmetric matrix (cyclic Jacobi), used for sigma. */
  function symEigenvalues(S, n) {
    const a = Float64Array.from(S);
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p * n + q] * a[p * n + q];
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) {
        for (let q = p + 1; q < n; q++) {
          const apq = a[p * n + q];
          if (Math.abs(apq) < 1e-300) continue;
          const app = a[p * n + p], aqq = a[q * n + q];
          const theta = (aqq - app) / (2 * apq);
          const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1), s = t * c;
          for (let r = 0; r < n; r++) {
            const arp = a[r * n + p], arq = a[r * n + q];
            a[r * n + p] = c * arp - s * arq;
            a[r * n + q] = s * arp + c * arq;
          }
          for (let r = 0; r < n; r++) {
            const apr = a[p * n + r], aqr = a[q * n + r];
            a[p * n + r] = c * apr - s * aqr;
            a[q * n + r] = s * apr + c * aqr;
          }
        }
      }
    }
    const ev = [];
    for (let p = 0; p < n; p++) ev.push(a[p * n + p]);
    return ev;
  }

  // ===================================================================== graphs
  /** Adjacency (Uint8Array m*m) of a ring with the given 1-based chords. */
  function ringGraph(m, chords) {
    const adj = new Uint8Array(m * m);
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      if (i !== j) adj[i * m + j] = adj[j * m + i] = 1;
    }
    (chords || []).forEach(function (c) {
      const a = c[0] - 1, b = c[1] - 1;
      adj[a * m + b] = adj[b * m + a] = 1;
    });
    return adj;
  }

  /** Ring with diametral chords (experiments.ring_with_diameters); for m = 6 these
   *  are the chords (1,4), (2,5), (3,6) of the paper. */
  function ringWithDiameters(m) {
    const adj = ringGraph(m);
    if (m >= 4) {
      const hm = Math.floor(m / 2);
      for (let i = 0; i < hm; i++) adj[i * m + i + hm] = adj[(i + hm) * m + i] = 1;
    }
    return adj;
  }

  /** Nearest-neighbour graph of planar positions (rendezvous_common.adjacency). */
  function nearestGraph(pos) {
    const m = pos.length;
    let nearest = Infinity;
    const d = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) {
        d[i * m + j] = i === j ? Infinity : Math.hypot(pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]);
        if (d[i * m + j] < nearest) nearest = d[i * m + j];
      }
    }
    const adj = new Uint8Array(m * m);
    for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j && d[i * m + j] <= nearest * 1.01) adj[i * m + j] = 1;
    return adj;
  }

  function stationPositions(m, radius) {
    const r = radius == null ? STATION_RADIUS_UNITS : radius;
    const out = [];
    for (let i = 0; i < m; i++) {
      const a = (2 * Math.PI * i) / m;
      out.push([r * Math.cos(a), r * Math.sin(a)]);
    }
    return out;
  }

  /** Adjacency for a graph name: "paper" (ring + 3 chords / diametral chords),
   *  "nn" (nearest neighbours of the stations, the Webots ring), "ring",
   *  "complete", "path" (the ring with the link (m,1) cut). */
  function makeGraph(kind, m, positions) {
    if (kind && typeof kind === "object") return Uint8Array.from(kind);
    switch (kind) {
      case "paper":
        return ringWithDiameters(m);
      case "nn":
        return nearestGraph(positions || stationPositions(m));
      case "ring":
        return ringGraph(m);
      case "complete": {
        const adj = new Uint8Array(m * m);
        for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) if (i !== j) adj[i * m + j] = 1;
        return adj;
      }
      case "path": {
        const adj = ringGraph(m);
        if (m > 2) adj[(m - 1) * m] = adj[m - 1] = 0;
        return adj;
      }
      default:
        throw new Error("unknown graph " + kind);
    }
  }

  /** Metropolis weights (experiments.metropolis): W_ij = 1/(1 + max(d_i, d_j)). */
  function metropolis(adj, m) {
    const deg = new Float64Array(m);
    for (let i = 0; i < m; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += adj[i * m + j] ? 1 : 0;
      deg[i] = s;
    }
    const W = new Float64Array(m * m);
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) if (i !== j && adj[i * m + j]) W[i * m + j] = 1.0 / (1.0 + Math.max(deg[i], deg[j]));
      let s = 0;
      for (let j = 0; j < m; j++) s += W[i * m + j];
      W[i * m + i] = 1.0 - s;
    }
    return W;
  }

  /** sigma = ||W - 1 1^T / m||_2 (W symmetric). */
  function contraction(W, m) {
    const S = new Float64Array(m * m);
    for (let i = 0; i < m * m; i++) S[i] = W[i] - 1 / m;
    const ev = symEigenvalues(S, m);
    let s = 0;
    ev.forEach(function (v) { s = Math.max(s, Math.abs(v)); });
    return s;
  }

  function edgesOf(adj, m) {
    const e = [];
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) if (adj[i * m + j]) e.push([i, j]);
    return e;
  }

  // ============================================================ the two missions
  // Paper instance of case study (A): h_i ~ U[0.5, 1.5], ||bbar_i|| ~ U[3, 8], drawn
  // once by experiments.py with numpy.random.default_rng([2026, 1]) (seed 2026,
  // CASE_ID 1), the instance of every figure of case study (A) and of Figure 1.
  const PAPER_H = [0.9902337823552491, 1.4025537751992463, 1.2285285378059565,
    1.2326191794544874, 1.3350607094532254, 0.9483517718003229];
  const PAPER_RADII = [4.795680066523492, 5.485842224857119, 5.25541662242539,
    5.900428110759082, 7.20149983075333, 6.105053435137416];

  // Webots instance (rendezvous_common.py): fixed service rates, search-line routes.
  const WEBOTS_H = [1.0, 1.4, 0.6, 1.2, 0.8, 1.0];
  const RING_CENTER = [0.0, 0.7]; // the burning warehouse (paper units)
  const RING_RADIUS = 9.0;
  const RING_PERIOD = 600;
  const RING_PHASE0 = -Math.PI / 2;
  const LANE_OFFSETS = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];
  const PATROL_RADIUS = [0.8, 0.9, 0.6, 0.85, 0.7, 0.95];
  const PATROL_PERIOD = [64, 84, 56, 76, 70, 96];
  const PATROL_SIGN = [1, -1, 1, -1, 1, -1];
  const STATION_RADIUS_UNITS = 13.1; // 6.55 m in the diorama at 0.5 m per unit

  /** Known route p_i(t) of UAV i in the Webots mission (rendezvous_common.tasking). */
  function tasking(i, t, out, o) {
    out = out || [0, 0];
    o = o || 0;
    const M = 6;
    const slot = (2 * Math.PI * i) / M;
    const phi = RING_PHASE0 + (2.0 * Math.PI * t) / RING_PERIOD;
    const cr = Math.cos(phi), sr = Math.sin(phi);
    const cx = RING_CENTER[0] + RING_RADIUS * cr;
    const cy = RING_CENTER[1] + RING_RADIUS * sr;
    const ang = slot + (PATROL_SIGN[i] * 2.0 * Math.PI * t) / PATROL_PERIOD[i];
    const r = PATROL_RADIUS[i];
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const L = LANE_OFFSETS[i];
    const k55 = 0.55 * sa;
    out[o] = cx + L * cr + r * (ca * -sr + k55 * cr);
    out[o + 1] = cy + L * sr + r * (ca * cr + k55 * sr);
    return out;
  }

  /** Centre of the search line at step t (rendezvous_common.line_center). */
  function lineCenter(t) {
    const phi = RING_PHASE0 + (2.0 * Math.PI * t) / RING_PERIOD;
    return [RING_CENTER[0] + RING_RADIUS * Math.cos(phi), RING_CENTER[1] + RING_RADIUS * Math.sin(phi), phi];
  }

  /** Draw an instance as Rendezvous.__init__: h ~ U[0.5,1.5]^m, then radii ~ U[3,8]^m. */
  function drawInstance(rng, m, identical) {
    const h = [];
    if (identical) for (let i = 0; i < m; i++) h.push(1.0);
    else for (let i = 0; i < m; i++) h.push(rng.uniform(0.5, 1.5));
    const radii = [];
    for (let i = 0; i < m; i++) radii.push(rng.uniform(3.0, 8.0));
    return { h: h, radii: radii };
  }

  function postsFromRadii(radii) {
    const m = radii.length;
    return radii.map(function (r, i) {
      const a = (2 * Math.PI * i) / m;
      return [r * Math.cos(a), r * Math.sin(a)];
    });
  }

  // ============================================================== configuration
  const DEFAULTS = {
    mission: "posts", // "posts" (paper) | "search" (Webots)
    m: 6,
    h: null, // service rates; default: the paper instance / the Webots values
    bbar: null, // observation locations (posts); default from radii
    radii: null,
    rho: 0.99, // A = rho Rot(omega)
    omega: 0.15,
    A: null, // or an explicit [a11, a12, a21, a22]
    qStd: 0.05, // Q = qStd^2 I
    p0Std: null, // P0 = p0Std^2 I; default 4 (posts) / 2.5 (search)
    noise: null, // "gradient" (R on the gradient, paper) | "position" (telemetry error, Webots)
    noiseStd: null, // 1.5 (gradient) / 0.75 (position)
    graph: null, // "paper" | "nn" | "ring" | "complete" | "path" | adjacency
    W: null, // explicit weights (overrides graph)
    stations: null, // station positions (for "nn" and for display)
    k: 2,
    alpha: 0.2,
    taus: [3], // cooperative estimators, key "coop<tau>"
    N: 100,
    horizon: 200, // T = N + horizon
    rhoMax: 0.999,
    pooled: true, // pooled least squares (identification and forecaster)
    exact: true, // exact averaging
    baselines: true, // persistence and oracle A forecasters
    kalman: false, // oracle Kalman filter forecaster
    centralized: false, // centralized predictor
    series: true, // keep the trajectories (for display)
    rounds: true, // keep the cooperative estimate after each consensus round
    recorded: null, // {theta: T*m*2, ypos: N*m*2[, routes: T*m*2]}: replay a Webots run
  };

  function normalize(c) {
    const cfg = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      cfg[k] = c && c[k] !== undefined && c[k] !== null ? c[k] : DEFAULTS[k];
    });
    const search = cfg.mission === "search";
    const m = cfg.m;
    if (search && m !== 6) throw new Error("the search-line mission has six UAVs");
    if (!cfg.h) cfg.h = search ? WEBOTS_H.slice() : m === 6 ? PAPER_H.slice() : new Array(m).fill(1);
    if (cfg.h.length !== m) throw new Error("h must have m entries");
    if (!search && !cfg.bbar) {
      const radii = cfg.radii || (m === 6 ? PAPER_RADII : new Array(m).fill(5.5));
      cfg.bbar = postsFromRadii(radii);
    }
    if (cfg.p0Std == null) cfg.p0Std = search ? 2.5 : 4.0;
    if (!cfg.noise) cfg.noise = search ? "position" : "gradient";
    if (cfg.noiseStd == null) cfg.noiseStd = cfg.noise === "position" ? 0.75 : 1.5;
    if (!cfg.graph) cfg.graph = search ? "nn" : "paper";
    if (!cfg.stations) cfg.stations = stationPositions(m);
    if (!cfg.A) {
      const cw = Math.cos(cfg.omega), sw = Math.sin(cfg.omega);
      cfg.A = [cfg.rho * cw, cfg.rho * -sw, cfg.rho * sw, cfg.rho * cw];
    }
    cfg.taus = (Array.isArray(cfg.taus) ? cfg.taus : [cfg.taus]).map(function (v) { return Math.max(0, Math.round(v)); });
    if (2 * cfg.k >= cfg.N - 1) throw new Error("N too small for window length k");
    return cfg;
  }

  // ================================================================ one trial
  /**
   * Simulates one trial of Algorithm 1 (experiments.run_trial for "posts").
   * Returns the trajectories (if cfg.series) and the metrics.
   */
  function simulate(cfgIn, rng) {
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
    const cfg = normalize(cfgIn);
    const m = cfg.m, N = cfg.N, k = cfg.k, T = N + cfg.horizon;
    const alpha = cfg.alpha;
    const search = cfg.mission === "search";
    const posNoise = cfg.noise === "position";
    const A = Float64Array.from(cfg.A);
    const h = Float64Array.from(cfg.h);
    const adj = cfg.W ? null : makeGraph(cfg.graph, m, cfg.stations);
    const W = cfg.W ? Float64Array.from(cfg.W) : metropolis(adj, m);
    const rec = cfg.recorded;
    if (!rec && !rng) rng = new Rng(2026);

    // ---- known routes p_i(t) ----
    const P = new Float64Array(T * m * 2);
    if (rec && rec.routes) P.set(rec.routes.subarray ? rec.routes.subarray(0, T * m * 2) : rec.routes.slice(0, T * m * 2));
    else if (search) for (let t = 0; t < T; t++) for (let i = 0; i < m; i++) tasking(i, t, P, (t * m + i) * 2);
    else for (let t = 0; t < T; t++) for (let i = 0; i < m; i++) {
      P[(t * m + i) * 2] = cfg.bbar[i][0];
      P[(t * m + i) * 2 + 1] = cfg.bbar[i][1];
    }

    // ---- latent parameters theta_i(t) and the measurement noise draws ----
    const TH = new Float64Array(T * m * 2);
    const Z = new Float64Array(N * m * 2); // standard normals of the measurements
    const YP = new Float64Array(N * m * 2); // received positions y_i(t) (Webots) / implied positions (paper)
    const a00 = A[0], a01 = A[1], a10 = A[2], a11 = A[3];
    if (rec) {
      TH.set(rec.theta.subarray ? rec.theta.subarray(0, T * m * 2) : rec.theta.slice(0, T * m * 2));
    } else if (!search) {
      // run_trial: Theta[0] = z @ Lp^T; Theta[t] = Theta[t-1] @ A^T + z @ Lq^T; Lp, Lq = chol(P0), chol(Q)
      const Lp = Math.sqrt(cfg.p0Std * cfg.p0Std), Lq = Math.sqrt(cfg.qStd * cfg.qStd);
      for (let i = 0; i < m; i++) {
        TH[i * 2] = rng.normal() * Lp;
        TH[i * 2 + 1] = rng.normal() * Lp;
      }
      for (let t = 1; t < T; t++) {
        for (let i = 0; i < m; i++) {
          const o = (t * m + i) * 2, q = ((t - 1) * m + i) * 2;
          const p0 = TH[q], p1 = TH[q + 1];
          const z0 = rng.normal(), z1 = rng.normal();
          TH[o] = p0 * a00 + p1 * a01 + z0 * Lq;
          TH[o + 1] = p0 * a10 + p1 * a11 + z1 * Lq;
        }
      }
      for (let j = 0; j < N * m * 2; j++) Z[j] = rng.normal();
    } else {
      // Webots supervisor: theta = z * P0_STD; per step: theta = theta @ A^T + z * Q_STD,
      // then the telemetry noise of each station while t < N
      for (let i = 0; i < m; i++) {
        TH[i * 2] = rng.normal() * cfg.p0Std;
        TH[i * 2 + 1] = rng.normal() * cfg.p0Std;
      }
      for (let t = 0; t < T; t++) {
        if (t > 0) {
          for (let i = 0; i < m; i++) {
            const o = (t * m + i) * 2, q = ((t - 1) * m + i) * 2;
            const p0 = TH[q], p1 = TH[q + 1];
            const z0 = rng.normal(), z1 = rng.normal();
            TH[o] = p0 * a00 + p1 * a01 + z0 * cfg.qStd;
            TH[o + 1] = p0 * a10 + p1 * a11 + z1 * cfg.qStd;
          }
        }
        if (t < N) for (let i = 0; i < m; i++) {
          Z[(t * m + i) * 2] = rng.normal();
          Z[(t * m + i) * 2 + 1] = rng.normal();
        }
      }
    }

    // ---- best position x*(t) = sum_i h_i (p_i + theta_i) / sum_i h_i ----
    let hsum = 0;
    for (let i = 0; i < m; i++) hsum += h[i];
    const XS = new Float64Array(T * 2);
    for (let t = 0; t < T; t++) {
      let s0 = 0, s1 = 0;
      for (let i = 0; i < m; i++) {
        const o = (t * m + i) * 2;
        s0 += h[i] * (P[o] + TH[o]);
        s1 += h[i] * (P[o + 1] + TH[o + 1]);
      }
      XS[t * 2] = s0 / hsum;
      XS[t * 2 + 1] = s1 / hsum;
    }

    // ---- measurements: gradient signal gamma_i(t) and identification data ytilde_i(t) ----
    const Lr = Math.sqrt(cfg.noiseStd * cfg.noiseStd);
    const YT = new Float64Array(N * m * 2); // ytilde_i(t) = C theta_i(t) + noise
    function measure(t, X, G) {
      for (let i = 0; i < m; i++) {
        const o = (t * m + i) * 2, x0 = X[i * 2], x1 = X[i * 2 + 1];
        const p0 = P[o], p1 = P[o + 1], th0 = TH[o], th1 = TH[o + 1];
        const h2 = 2 * h[i];
        let g0, g1, y0, y1;
        if (rec || posNoise) {
          // Webots: y = b + sigma_b z, gamma = 2 h (x - y), ytilde = -2 h (y - p)
          if (rec) {
            y0 = rec.ypos[o];
            y1 = rec.ypos[o + 1];
          } else {
            y0 = p0 + th0 + Z[o] * cfg.noiseStd;
            y1 = p1 + th1 + Z[o + 1] * cfg.noiseStd;
          }
          g0 = h2 * (x0 - y0);
          g1 = h2 * (x1 - y1);
          YT[o] = -2.0 * h[i] * (y0 - p0);
          YT[o + 1] = -2.0 * h[i] * (y1 - p1);
        } else {
          // paper: gamma = grad f_i(x, theta) + Lr z = 2 h (x - p) + (-2 h) theta + Lr z
          const c = -2 * h[i];
          if (search) {
            g0 = h2 * (x0 - p0 - th0) + Lr * Z[o];
            g1 = h2 * (x1 - p1 - th1) + Lr * Z[o + 1];
          } else {
            g0 = h2 * (x0 - p0) + c * th0 + Lr * Z[o];
            g1 = h2 * (x1 - p1) + c * th1 + Lr * Z[o + 1];
          }
          YT[o] = g0 - h2 * (x0 - p0);
          YT[o + 1] = g1 - h2 * (x1 - p1);
          y0 = x0 - g0 / h2;
          y1 = x1 - g1 / h2;
        }
        YP[o] = y0;
        YP[o + 1] = y1;
        G[i * 2] = g0;
        G[i * 2 + 1] = g1;
      }
    }

    function mix(Wm, V, out) {
      // out = W @ V for V of shape (m, 2)
      for (let i = 0; i < m; i++) {
        let s0 = 0, s1 = 0;
        for (let j = 0; j < m; j++) {
          const w = Wm[i * m + j];
          s0 += w * V[j * 2];
          s1 += w * V[j * 2 + 1];
        }
        out[i * 2] = s0;
        out[i * 2 + 1] = s1;
      }
      return out;
    }

    // ---- data collection: gradient tracking (11) on the oracle gradients, t < N ----
    const keep = cfg.series;
    const XD = keep ? new Float64Array(N * m * 2) : null; // x_i(t), t = 0..N-1
    let X = new Float64Array(m * 2);
    let G = new Float64Array(m * 2);
    let S = new Float64Array(m * 2);
    let Xn = new Float64Array(m * 2), Gn = new Float64Array(m * 2);
    const tmp = new Float64Array(m * 2);
    const errData = new Float64Array(N);
    function netErr(Xc, t) {
      let e = 0;
      const xs0 = XS[t * 2], xs1 = XS[t * 2 + 1];
      for (let i = 0; i < m; i++) {
        const d0 = Xc[i * 2] - xs0, d1 = Xc[i * 2 + 1] - xs1;
        e += d0 * d0 + d1 * d1;
      }
      return e / m; // mean over agents of the squared error
    }
    measure(0, X, G);
    S.set(G);
    if (keep) XD.set(X, 0);
    errData[0] = netErr(X, 0);
    for (let t = 0; t < N - 1; t++) {
      for (let j = 0; j < m * 2; j++) tmp[j] = X[j] - alpha * S[j];
      mix(W, tmp, Xn);
      measure(t + 1, Xn, Gn);
      for (let j = 0; j < m * 2; j++) tmp[j] = S[j] + Gn[j] - G[j];
      mix(W, tmp, S);
      let sw = X; X = Xn; Xn = sw;
      sw = G; G = Gn; Gn = sw;
      if (keep) XD.set(X, (t + 1) * m * 2);
      errData[t + 1] = netErr(X, t + 1);
    }
    const XN1 = Float64Array.from(X), SN1 = Float64Array.from(S), GN1 = Float64Array.from(G);

    // ---- Layer 1: window estimates (5), t = 0..N-k ----
    const nW = N - k + 1;
    const TT = new Float64Array(m * nW * 2); // theta_tilde_i(t) at (i*nW + t)*2
    let Rinv;
    if (rec || posNoise) Rinv = [1, 0, 0, 1]; // R = sigma^2 I cancels (analyze_runs: R = I)
    else Rinv = inv2([Lr * Lr, 0, 0, Lr * Lr], [0, 0, 0, 0]);
    for (let i = 0; i < m; i++) {
      const c = -2 * h[i]; // C_i = -2 h_i I
      const C = [c, 0, 0, c];
      // CtR = C^T R^-1
      const r00 = C[0] * Rinv[0] + C[2] * Rinv[2], r01 = C[0] * Rinv[1] + C[2] * Rinv[3];
      const r10 = C[1] * Rinv[0] + C[3] * Rinv[2], r11 = C[1] * Rinv[1] + C[3] * Rinv[3];
      // G = sum_j C^T R^-1 C over the window
      let g00 = 0, g01 = 0, g10 = 0, g11 = 0;
      for (let j = 0; j < k; j++) {
        g00 += r00 * C[0] + r01 * C[2];
        g01 += r00 * C[1] + r01 * C[3];
        g10 += r10 * C[0] + r11 * C[2];
        g11 += r10 * C[1] + r11 * C[3];
      }
      for (let t = 0; t < nW; t++) {
        let b0 = 0, b1 = 0;
        for (let j = 0; j < k; j++) {
          const o = ((t + j) * m + i) * 2;
          b0 += r00 * YT[o] + r01 * YT[o + 1];
          b1 += r10 * YT[o] + r11 * YT[o + 1];
        }
        solve2(g00, g01, g10, g11, b0, b1, TT, (i * nW + t) * 2);
      }
    }
    // reconstruction error over t = 0..N-k
    let rsum = 0;
    for (let i = 0; i < m; i++) for (let t = 0; t < nW; t++) {
      const o = (i * nW + t) * 2, q = (t * m + i) * 2;
      const d0 = TT[o] - TH[q], d1 = TT[o + 1] - TH[q + 1];
      rsum += d0 * d0 + d1 * d1;
    }
    const recon = Math.sqrt(rsum / (m * nW));

    // ---- Layer 2: moments (8) and identification (9) ----
    function moments(kind) {
      // kind "iv": M_j = 1/(N-2k) sum_{t=k}^{N-k-1} th(t+j) th(t-k)^T
      // kind "ls": M_j = 1/(N-k)  sum_{t=0}^{N-k-1}  th(t+j) th(t)^T
      const M0 = new Float64Array(m * 4), M1 = new Float64Array(m * 4);
      const lo = kind === "iv" ? k : 0, hi = N - k, lag = kind === "iv" ? k : 0;
      const L = hi - lo;
      for (let i = 0; i < m; i++) {
        let s00 = 0, s01 = 0, s10 = 0, s11 = 0, u00 = 0, u01 = 0, u10 = 0, u11 = 0;
        for (let t = lo; t < hi; t++) {
          const z = (i * nW + t - lag) * 2, a = (i * nW + t) * 2, b = a + 2;
          const z0 = TT[z], z1 = TT[z + 1];
          s00 += TT[a] * z0; s01 += TT[a] * z1; s10 += TT[a + 1] * z0; s11 += TT[a + 1] * z1;
          u00 += TT[b] * z0; u01 += TT[b] * z1; u10 += TT[b + 1] * z0; u11 += TT[b + 1] * z1;
        }
        M0[i * 4] = s00 / L; M0[i * 4 + 1] = s01 / L; M0[i * 4 + 2] = s10 / L; M0[i * 4 + 3] = s11 / L;
        M1[i * 4] = u00 / L; M1[i * 4 + 1] = u01 / L; M1[i * 4 + 2] = u10 / L; M1[i * 4 + 3] = u11 / L;
      }
      return [M0, M1];
    }

    function consensusRound(M) {
      const out = new Float64Array(m * 4);
      for (let i = 0; i < m; i++) {
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
        for (let l = 0; l < m; l++) {
          const w = W[i * m + l];
          s0 += w * M[l * 4]; s1 += w * M[l * 4 + 1]; s2 += w * M[l * 4 + 2]; s3 += w * M[l * 4 + 3];
        }
        out[i * 4] = s0; out[i * 4 + 1] = s1; out[i * 4 + 2] = s2; out[i * 4 + 3] = s3;
      }
      return out;
    }

    function averaged(M) {
      const out = new Float64Array(m * 4);
      const s = [0, 0, 0, 0];
      for (let l = 0; l < m; l++) for (let e = 0; e < 4; e++) s[e] += M[l * 4 + e];
      for (let i = 0; i < m; i++) for (let e = 0; e < 4; e++) out[i * 4 + e] = s[e] / m;
      return out;
    }

    function estimateFrom(M0c, M1c) {
      const Ah = new Float64Array(m * 4);
      const rhoRaw = new Float64Array(m);
      const rescaled = new Uint8Array(m);
      const eigRaw = [], eigs = [], err = new Float64Array(m);
      const Mi = [0, 0, 0, 0], Ai = [0, 0, 0, 0];
      for (let i = 0; i < m; i++) {
        inv2(M0c.subarray(i * 4, i * 4 + 4), Mi);
        mul2(M1c.subarray(i * 4, i * 4 + 4), Mi, Ai);
        const ev = eig2(Ai);
        rhoRaw[i] = ev.rho;
        eigRaw.push(ev);
        if (ev.rho > cfg.rhoMax) {
          const f = cfg.rhoMax / ev.rho;
          for (let e = 0; e < 4; e++) Ai[e] *= f;
          rescaled[i] = 1;
          eigs.push(eig2(Ai));
        } else eigs.push(ev);
        for (let e = 0; e < 4; e++) Ah[i * 4 + e] = Ai[e];
        err[i] = frob2(Ai, A);
      }
      return { A: Ah, rhoRaw: rhoRaw, rescaled: rescaled, eig: eigs, eigRaw: eigRaw, err: err };
    }

    const iv = moments("iv");
    const estimates = {};
    const order = [];
    function addEstimate(key, est, extra) {
      est.key = key;
      if (extra) Object.keys(extra).forEach(function (kk) { est[kk] = extra[kk]; });
      let un = 0, rs = 0;
      for (let i = 0; i < m; i++) {
        if (est.rhoRaw[i] >= 1.0) un++;
        if (est.rescaled[i]) rs++;
      }
      est.unstable = un / m; // fraction not Schur stable before the safeguard
      est.nRescaled = rs;
      est.median = median(Array.from(est.err));
      estimates[key] = est;
      order.push(key);
    }
    addEstimate("local", estimateFrom(iv[0], iv[1]), { tau: 0 });
    cfg.taus.forEach(function (tau) {
      let M0c = iv[0], M1c = iv[1];
      const rounds = [];
      if (cfg.rounds && cfg.series) rounds.push(estimateFrom(M0c, M1c));
      for (let r = 0; r < tau; r++) {
        M0c = consensusRound(M0c);
        M1c = consensusRound(M1c);
        if (cfg.rounds && cfg.series) rounds.push(estimateFrom(M0c, M1c));
      }
      const est = estimateFrom(M0c, M1c);
      if (rounds.length) est.rounds = rounds.map(function (e) { return { A: e.A, eig: e.eig, rhoRaw: e.rhoRaw, err: e.err }; });
      if (!estimates["coop" + tau]) addEstimate("coop" + tau, est, { tau: tau });
    });
    if (cfg.exact) addEstimate("exact", estimateFrom(averaged(iv[0]), averaged(iv[1])), { tau: Infinity });
    if (cfg.pooled) {
      const ls = moments("ls");
      addEstimate("pooledLS", estimateFrom(averaged(ls[0]), averaged(ls[1])), { tau: Infinity });
    }

    // ---- Layer 3: forecasts (10) and gradient tracking on the forecast gradients, t >= N ----
    const anchors = new Float64Array(m * 2);
    for (let i = 0; i < m; i++) {
      anchors[i * 2] = TT[(i * nW + N - k) * 2];
      anchors[i * 2 + 1] = TT[(i * nW + N - k) * 2 + 1];
    }
    const H = T - N;
    const errStart = N + 50, errEnd = T; // rmse_of: t in [N + 50, N + 200)

    function forecaster(Alist, anch, tStart) {
      // Forecaster: theta_hat_i(t) = A_i^(t - t0) anchor_i, powers advanced as P <- P A
      const pw = new Float64Array(m * 4);
      for (let i = 0; i < m; i++) { pw[i * 4] = 1; pw[i * 4 + 3] = 1; }
      let tc = tStart;
      const out = new Float64Array(m * 2);
      const tmp4 = [0, 0, 0, 0];
      return function at(t) {
        while (tc < t) {
          for (let i = 0; i < m; i++) {
            mul2(pw.subarray(i * 4, i * 4 + 4), Alist.subarray(i * 4, i * 4 + 4), tmp4);
            pw[i * 4] = tmp4[0]; pw[i * 4 + 1] = tmp4[1]; pw[i * 4 + 2] = tmp4[2]; pw[i * 4 + 3] = tmp4[3];
          }
          tc++;
        }
        for (let i = 0; i < m; i++) {
          const a0 = anch[i * 2], a1 = anch[i * 2 + 1];
          out[i * 2] = pw[i * 4] * a0 + pw[i * 4 + 1] * a1;
          out[i * 2 + 1] = pw[i * 4 + 2] * a0 + pw[i * 4 + 3] * a1;
        }
        return out;
      };
    }

    function forecastGrad(t, Xc, Th, Gout) {
      for (let i = 0; i < m; i++) {
        const o = (t * m + i) * 2;
        const h2 = 2 * h[i];
        if (search || rec) {
          // C.gradient: 2 h (x - p - theta_hat)
          Gout[i * 2] = h2 * (Xc[i * 2] - P[o] - Th[i * 2]);
          Gout[i * 2 + 1] = h2 * (Xc[i * 2 + 1] - P[o + 1] - Th[i * 2 + 1]);
        } else {
          // cs.grad: 2 h (x - bbar) + (-2 h) theta_hat
          const c = -2 * h[i];
          Gout[i * 2] = h2 * (Xc[i * 2] - P[o]) + c * Th[i * 2];
          Gout[i * 2 + 1] = h2 * (Xc[i * 2 + 1] - P[o + 1]) + c * Th[i * 2 + 1];
        }
      }
    }

    function track(at) {
      // the switch at t = N: x(N) = W (x(N-1) - alpha s(N-1)), gamma(N) = forecast gradient,
      // s(N) = W (s(N-1) + gamma(N) - gamma(N-1)); then (11) for t = N..T-2
      const XF = keep ? new Float64Array(H * m * 2) : null;
      const FF = keep ? new Float64Array(H * m * 2) : null;
      const err = new Float64Array(H);
      let Xc = new Float64Array(m * 2), Sc = new Float64Array(m * 2), Gc = new Float64Array(m * 2);
      let Xx = new Float64Array(m * 2), Gx = new Float64Array(m * 2);
      for (let j = 0; j < m * 2; j++) tmp[j] = XN1[j] - alpha * SN1[j];
      mix(W, tmp, Xc);
      let Th = at(N);
      if (keep) FF.set(Th, 0);
      forecastGrad(N, Xc, Th, Gc);
      for (let j = 0; j < m * 2; j++) tmp[j] = SN1[j] + Gc[j] - GN1[j];
      mix(W, tmp, Sc);
      if (keep) XF.set(Xc, 0);
      err[0] = netErr(Xc, N);
      for (let t = N; t < T - 1; t++) {
        for (let j = 0; j < m * 2; j++) tmp[j] = Xc[j] - alpha * Sc[j];
        mix(W, tmp, Xx);
        Th = at(t + 1);
        if (keep) FF.set(Th, (t + 1 - N) * m * 2);
        forecastGrad(t + 1, Xx, Th, Gx);
        for (let j = 0; j < m * 2; j++) tmp[j] = Sc[j] + Gx[j] - Gc[j];
        mix(W, tmp, Sc);
        let sw = Xc; Xc = Xx; Xx = sw;
        sw = Gc; Gc = Gx; Gx = sw;
        if (keep) XF.set(Xc, (t + 1 - N) * m * 2);
        err[t + 1 - N] = netErr(Xc, t + 1);
      }
      let s = 0;
      for (let t = errStart; t < errEnd; t++) s += err[t - N];
      const rmse = errEnd > errStart ? Math.sqrt(s / (errEnd - errStart)) : NaN;
      return { X: XF, theta: FF, err2: err, rmse: rmse };
    }

    const tracks = {};
    const rmse = {};
    order.forEach(function (key) {
      const tr = track(forecaster(estimates[key].A, anchors, N - k));
      tracks[key] = tr;
      rmse[key] = tr.rmse;
    });
    if (cfg.baselines) {
      const I4 = new Float64Array(m * 4), A4 = new Float64Array(m * 4);
      for (let i = 0; i < m; i++) {
        I4[i * 4] = 1; I4[i * 4 + 3] = 1;
        for (let e = 0; e < 4; e++) A4[i * 4 + e] = A[e];
      }
      tracks.persistence = track(forecaster(I4, anchors, N - k));
      rmse.persistence = tracks.persistence.rmse;
      tracks.oracleA = track(forecaster(A4, anchors, N - k));
      rmse.oracleA = tracks.oracleA.rmse;
      if (cfg.kalman) {
        const kf = kalmanState();
        tracks.oracleKF = track(forecaster(A4, kf, N - 1));
        rmse.oracleKF = tracks.oracleKF.rmse;
      }
    }
    if (cfg.centralized) {
      // exact minimizer of F_hat(., t) from the cooperative forecasts (all agents share it)
      const at = forecaster(estimates["coop" + cfg.taus[0]].A, anchors, N - k);
      let s = 0;
      for (let t = N; t < T; t++) {
        const Th = at(t);
        let s0 = 0, s1 = 0;
        for (let i = 0; i < m; i++) {
          const o = (t * m + i) * 2;
          s0 += h[i] * (P[o] + Th[i * 2]);
          s1 += h[i] * (P[o + 1] + Th[i * 2 + 1]);
        }
        const d0 = s0 / hsum - XS[t * 2], d1 = s1 / hsum - XS[t * 2 + 1];
        if (t >= errStart) s += d0 * d0 + d1 * d1;
      }
      rmse.centralized = Math.sqrt(s / (errEnd - errStart));
    }

    function kalmanState() {
      // experiments.kalman_forecast_state: knows A, Q, R, P0; filtered state at t = N-1
      const out = new Float64Array(m * 2);
      const q = cfg.qStd * cfg.qStd, p0 = cfg.p0Std * cfg.p0Std;
      for (let i = 0; i < m; i++) {
        const c = -2 * h[i];
        const r = rec || posNoise ? (2 * h[i] * cfg.noiseStd) * (2 * h[i] * cfg.noiseStd) : Lr * Lr;
        let x0 = 0, x1 = 0;
        let P00 = p0, P01 = 0, P10 = 0, P11 = p0;
        const AP = [0, 0, 0, 0];
        for (let t = 0; t < N; t++) {
          if (t > 0) {
            const n0 = a00 * x0 + a01 * x1, n1 = a10 * x0 + a11 * x1;
            x0 = n0; x1 = n1;
            mul2([a00, a01, a10, a11], [P00, P01, P10, P11], AP);
            const B = mul2(AP, [a00, a10, a01, a11], [0, 0, 0, 0]);
            P00 = B[0] + q; P01 = B[1]; P10 = B[2]; P11 = B[3] + q;
          }
          // S = C P C^T + R, K = P C^T S^-1, x += K (y - C x), P = (I - K C) P
          const S2 = [c * P00 * c + r, c * P01 * c, c * P10 * c, c * P11 * c + r];
          const Si = inv2(S2, [0, 0, 0, 0]);
          const PC = [P00 * c, P01 * c, P10 * c, P11 * c];
          const K = mul2(PC, Si, [0, 0, 0, 0]);
          const o = (t * m + i) * 2;
          const v0 = YT[o] - c * x0, v1 = YT[o + 1] - c * x1;
          x0 = x0 + (K[0] * v0 + K[1] * v1);
          x1 = x1 + (K[2] * v0 + K[3] * v1);
          const IKC = [1 - K[0] * c, -K[1] * c, -K[2] * c, 1 - K[3] * c];
          const Pn = mul2(IKC, [P00, P01, P10, P11], [0, 0, 0, 0]);
          P00 = Pn[0]; P01 = Pn[1]; P10 = Pn[2]; P11 = Pn[3];
        }
        out[i * 2] = x0;
        out[i * 2 + 1] = x1;
      }
      return out;
    }

    // ---- error series sqrt(1/m sum_i ||x_i(t) - x*(t)||^2) ----
    const series = {};
    Object.keys(tracks).forEach(function (key) {
      const e = new Float64Array(T);
      for (let t = 0; t < N; t++) e[t] = Math.sqrt(errData[t]);
      for (let t = N; t < T; t++) e[t] = Math.sqrt(tracks[key].err2[t - N]);
      series[key] = e;
    });

    const out = {
      cfg: cfg,
      m: m, N: N, k: k, T: T, horizon: cfg.horizon,
      A: A, W: W, adj: adj, edges: adj ? edgesOf(adj, m) : [], sigma: contraction(W, m),
      h: h, hsum: hsum,
      estimates: estimates, order: order,
      rmse: rmse, recon: recon,
      errSeries: series,
      anchors: anchors,
      draws: rng ? rng.count : 0,
      ms: 0,
    };
    if (keep) {
      out.routes = P; // p_i(t), (t*m + i)*2
      out.theta = TH; // theta_i(t)
      out.xstar = XS; // x*(t), t*2
      out.ypos = YP; // received / implied positions y_i(t), t < N
      out.ytilde = YT;
      out.window = TT; // theta_tilde_i(t), (i*(N-k+1) + t)*2
      out.Xdata = XD; // x_i(t), t < N
      out.tracks = tracks; // per forecaster: X (t - N), theta (t - N), err2
    }
    out.ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    return out;
  }

  /** Iterate x_i(t) of a forecaster (key) at time t, from a simulate() result. */
  function iterateAt(res, key, t, i, out) {
    out = out || [0, 0];
    const m = res.m, N = res.N;
    let src, o;
    if (t < N) { src = res.Xdata; o = (t * m + i) * 2; }
    else { src = res.tracks[key].X; o = ((t - N) * m + i) * 2; }
    out[0] = src[o];
    out[1] = src[o + 1];
    return out;
  }

  // ================================================================ statistics
  /** Quantile with numpy's default linear interpolation. */
  function quantile(values, q) {
    const v = Array.from(values).filter(function (x) { return x === x; }).sort(function (a, b) { return a - b; });
    if (!v.length) return NaN;
    const pos = q * (v.length - 1);
    const lo = Math.floor(pos), hi = Math.ceil(pos);
    return v[lo] + (v[hi] - v[lo]) * (pos - lo);
  }
  function median(values) {
    return quantile(values, 0.5);
  }
  function quartiles(values) {
    return { med: quantile(values, 0.5), lo: quantile(values, 0.25), hi: quantile(values, 0.75), n: values.length };
  }

  /**
   * Monte Carlo over the training horizon (the protocol of experiments.n_sweep):
   * the instance is fixed by cfg, trial tr of horizon N uses rng([seed, N, tr]).
   * Identification errors are pooled over trials and agents; RMSEs over trials.
   * onTrial(done, total) is called after every trial; return false to stop.
   */
  function monteCarloTrial(cfg, N, tr, seed) {
    const c = Object.assign({}, cfg, { N: N, series: false, rounds: false });
    return simulate(c, new Rng([seed, N, tr]));
  }

  function summarizeTrials(results) {
    const ids = {}, rmse = {};
    results.forEach(function (r) {
      Object.keys(r.estimates).forEach(function (key) {
        (ids[key] = ids[key] || []).push.apply(ids[key], Array.from(r.estimates[key].err));
      });
      Object.keys(r.rmse).forEach(function (key) {
        (rmse[key] = rmse[key] || []).push(r.rmse[key]);
      });
    });
    const out = { id: {}, rmse: {}, unstable: {}, n: results.length };
    Object.keys(ids).forEach(function (key) {
      out.id[key] = quartiles(ids[key]);
      let u = 0;
      results.forEach(function (r) { u += r.estimates[key].unstable; });
      out.unstable[key] = u / results.length;
    });
    Object.keys(rmse).forEach(function (key) { out.rmse[key] = quartiles(rmse[key]); });
    return out;
  }

  function monteCarlo(cfg, opts, onTrial) {
    const Ns = opts.Ns || [30, 50, 100, 150, 200];
    const trials = opts.trials || 20;
    const seed = opts.seed == null ? 2026 : opts.seed;
    const total = Ns.length * trials;
    const out = { Ns: Ns, trials: trials, seed: seed, byN: [] };
    let done = 0;
    for (let a = 0; a < Ns.length; a++) {
      const res = [];
      for (let tr = 0; tr < trials; tr++) {
        res.push(monteCarloTrial(cfg, Ns[a], tr, seed));
        done++;
        if (onTrial && onTrial(done, total) === false) return null;
      }
      out.byN.push(Object.assign({ N: Ns[a] }, summarizeTrials(res)));
    }
    return out;
  }

  // ===================================================================== export
  const api = {
    version: "1.0.0",
    Rng: Rng,
    rng: function (seed) { return new Rng(seed); },
    replayRng: function (draws) { return new ReplayRng(draws); },
    hashSeed: hashSeed,
    simulate: simulate,
    normalize: normalize,
    iterateAt: iterateAt,
    monteCarlo: monteCarlo,
    monteCarloTrial: monteCarloTrial,
    summarizeTrials: summarizeTrials,
    quantile: quantile,
    median: median,
    quartiles: quartiles,
    drawInstance: drawInstance,
    postsFromRadii: postsFromRadii,
    makeGraph: makeGraph,
    metropolis: metropolis,
    contraction: contraction,
    edgesOf: edgesOf,
    stationPositions: stationPositions,
    tasking: tasking,
    lineCenter: lineCenter,
    eig2: eig2,
    inv2: inv2,
    mul2: mul2,
    DEFAULTS: DEFAULTS,
    PAPER_H: PAPER_H,
    PAPER_RADII: PAPER_RADII,
    WEBOTS_H: WEBOTS_H,
    WEBOTS_ROUTES: {
      ringCenter: RING_CENTER, ringRadius: RING_RADIUS, ringPeriod: RING_PERIOD, ringPhase0: RING_PHASE0,
      laneOffsets: LANE_OFFSETS, patrolRadius: PATROL_RADIUS, patrolPeriod: PATROL_PERIOD, patrolSign: PATROL_SIGN,
    },
    STATION_RADIUS_UNITS: STATION_RADIUS_UNITS,
  };
  root.CoopEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
