/* Replay of the audited Webots run (seed 2026, N = 100) and the paper charts. */
(function () {
  const RUN = window.RUN;
  if (!RUN) return;

  const COLORS = ["#e63333", "#338cf2", "#33bf4d", "#f2a61a", "#b34dd9", "#1abfcc"];
  const RHO_LOCAL = [1.049, 0.987, 1.103, 0.967, 1.010, 1.005];
  const T = RUN.T;
  const N = RUN.N;

  const state = { t: 0, playing: false, acc: 0, last: 0, heldLearn: false, selected: 0, userCam: false };
  const cam = { x: 0, y: -1, k: 22 };

  const $ = (id) => document.getElementById(id);
  const world = $("world");
  const spark = $("spark");
  const wctx = world.getContext("2d");
  const sctx = spark.getContext("2d");

  function phaseOf(t) {
    if (t < N) return "collect";
    if (t === N) return "learn";
    return "track";
  }

  function xy(arr, t, i) {
    const s = i == null ? t * 2 : t * 12 + i * 2;
    const x = arr[s];
    const y = arr[s + 1];
    if (x == null || y == null) return null;
    return [x, y];
  }

  function metrics(t) {
    const xs = xy(RUN.xs, t);
    const c = xy(RUN.c, t);
    let mx = 0;
    let my = 0;
    const X = [];
    for (let i = 0; i < 6; i++) {
      const p = xy(RUN.xi, t, i);
      X.push(p);
      mx += p[0];
      my += p[1];
    }
    mx /= 6;
    my /= 6;
    let tr = 0;
    let dis = 0;
    for (const p of X) {
      tr += (p[0] - xs[0]) ** 2 + (p[1] - xs[1]) ** 2;
      dis += (p[0] - mx) ** 2 + (p[1] - my) ** 2;
    }
    return {
      rms: Math.sqrt(tr / 6),
      dis: Math.sqrt(dis / 6),
      rob: Math.hypot(c[0] - xs[0], c[1] - xs[1]),
      xs,
      c,
      X,
    };
  }

  function windowRmse(t) {
    if (t < 150) return null;
    let acc = 0;
    let n = 0;
    const last = Math.min(t, 299);
    for (let k = 150; k <= last; k++) {
      const xs = xy(RUN.xs, k);
      for (let i = 0; i < 6; i++) {
        const p = xy(RUN.xi, k, i);
        acc += (p[0] - xs[0]) ** 2 + (p[1] - xs[1]) ** 2;
        n++;
      }
    }
    return Math.sqrt(acc / n);
  }

  function fmtM(units) {
    return (units * RUN.unitM).toFixed(1) + " m";
  }

  /* ---------------------------------------------------------------- camera */
  let bounds = null;
  function sceneBounds() {
    if (bounds) return bounds;
    let minx = -16, maxx = 16, miny = -16, maxy = 16;
    const eat = (p) => {
      if (!p) return;
      minx = Math.min(minx, p[0]);
      maxx = Math.max(maxx, p[0]);
      miny = Math.min(miny, p[1]);
      maxy = Math.max(maxy, p[1]);
    };
    RUN.stations.forEach((p) => eat(p));
    for (let t = 0; t < T; t += 3) {
      eat(xy(RUN.xs, t));
      eat(xy(RUN.c, t));
      for (let i = 0; i < 6; i++) eat(xy(RUN.b, t, i));
    }
    bounds = { minx: minx - 2.2, maxx: maxx + 2.2, miny: miny - 2.4, maxy: maxy + 2.2 };
    return bounds;
  }

  function fit() {
    const b = sceneBounds();
    const w = world.clientWidth;
    const h = world.clientHeight;
    const pad = 46;
    cam.k = Math.min((w - pad * 2) / (b.maxx - b.minx), (h - pad * 2) / (b.maxy - b.miny));
    cam.x = (b.minx + b.maxx) / 2;
    cam.y = (b.miny + b.maxy) / 2;
    state.userCam = false;
    draw();
  }

  function toScreen(x, y) {
    const w = world.clientWidth;
    const h = world.clientHeight;
    return [w / 2 + (x - cam.x) * cam.k, h / 2 - (y - cam.y) * cam.k];
  }

  function toWorld(sx, sy) {
    const w = world.clientWidth;
    const h = world.clientHeight;
    return [cam.x + (sx - w / 2) / cam.k, cam.y - (sy - h / 2) / cam.k];
  }

  function on(id) {
    const el = $(id);
    return el && el.checked;
  }

  /* ----------------------------------------------------------------- scene */
  const trees = [];
  (function seedTrees() {
    let s = 2026;
    const rnd = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
    for (let n = 0; n < 70; n++) {
      const x = -15 + rnd() * 30;
      const y = -15 + rnd() * 30;
      const wx = x - 0;
      const wy = y - 0.7;
      if (Math.hypot(wx, wy) < 4.2) continue;
      if (Math.abs(x) < 1.7 && y < -2 && y > -16) continue;
      if (RUN.stations.some((p) => Math.hypot(p[0] - x, p[1] - y) < 1.5)) continue;
      trees.push([x, y, 0.12 + rnd() * 0.18]);
    }
  })();

  function resizeWorld() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = world.clientWidth;
    const h = world.clientHeight;
    world.width = Math.round(w * dpr);
    world.height = Math.round(h * dpr);
    wctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!state.userCam) {
      const b = sceneBounds();
      const pad = 46;
      cam.k = Math.min((w - pad * 2) / (b.maxx - b.minx), (h - pad * 2) / (b.maxy - b.miny));
      cam.x = (b.minx + b.maxx) / 2;
      cam.y = (b.miny + b.maxy) / 2;
    }
  }

  function draw() {
    const ctx = wctx;
    const w = world.clientWidth;
    const h = world.clientHeight;
    const t = state.t;
    const m = metrics(t);

    ctx.clearRect(0, 0, w, h);
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, "#7ea36e");
    sky.addColorStop(1, "#5f8456");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* ground grid in world units */
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.lineWidth = 1;
    const tl = toWorld(0, 0);
    const br = toWorld(w, h);
    const x0 = Math.floor(Math.min(tl[0], br[0]));
    const x1 = Math.ceil(Math.max(tl[0], br[0]));
    const y0 = Math.floor(Math.min(tl[1], br[1]));
    const y1 = Math.ceil(Math.max(tl[1], br[1]));
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 2) {
      const a = toScreen(x, y0);
      const b = toScreen(x, y1);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    for (let y = y0; y <= y1; y += 2) {
      const a = toScreen(x0, y);
      const b = toScreen(x1, y);
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
    }
    ctx.stroke();
    ctx.restore();

    trees.forEach(([x, y, r]) => {
      const p = toScreen(x, y);
      ctx.fillStyle = "rgba(40, 90, 48, 0.45)";
      ctx.beginPath();
      ctx.arc(p[0], p[1], r * cam.k, 0, Math.PI * 2);
      ctx.fill();
    });

    /* access road, south of the warehouse */
    const roadA = toScreen(-1.15, -3.2);
    const roadB = toScreen(1.15, -16.2);
    ctx.fillStyle = "#8a6a45";
    ctx.fillRect(roadA[0], roadA[1], roadB[0] - roadA[0], roadB[1] - roadA[1]);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    const mid = toScreen(0, -3.2);
    const mid2 = toScreen(0, -16.2);
    ctx.fillRect(mid[0] - 1, mid[1], 2, mid2[1] - mid[1]);

    /* burning warehouse */
    const wh = toScreen(0, 0.7);
    const glow = ctx.createRadialGradient(wh[0], wh[1], 4, wh[0], wh[1], 3.6 * cam.k);
    glow.addColorStop(0, "rgba(255, 170, 40, 0.85)");
    glow.addColorStop(0.45, "rgba(220, 90, 20, 0.35)");
    glow.addColorStop(1, "rgba(220, 90, 20, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(wh[0], wh[1], 3.6 * cam.k, 0, Math.PI * 2);
    ctx.fill();
    const hall = toScreen(-1.3, 1.7);
    const hall2 = toScreen(1.5, -0.5);
    ctx.fillStyle = "#4a4038";
    ctx.fillRect(hall[0], hall[1], hall2[0] - hall[0], hall2[1] - hall[1]);
    ctx.fillStyle = "#f0a030";
    ctx.fillRect(wh[0] - 0.35 * cam.k, wh[1] - 0.28 * cam.k, 0.7 * cam.k, 0.5 * cam.k);

    if (on("tog-trails")) {
      for (let i = 0; i < 6; i++) {
        for (let k = Math.max(0, t - 46); k <= t; k += 2) {
          const p = xy(RUN.b, k, i);
          const s = toScreen(p[0], p[1]);
          ctx.globalAlpha = 0.15 + 0.75 * ((k - (t - 46)) / 46);
          ctx.fillStyle = COLORS[i];
          ctx.beginPath();
          ctx.arc(s[0], s[1], 2.1, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (let k = Math.max(0, t - 60); k <= t; k += 2) {
        const p = xy(RUN.c, k);
        const s = toScreen(p[0], p[1]);
        ctx.globalAlpha = 0.2 + 0.7 * ((k - (t - 60)) / 60);
        ctx.fillStyle = "#f4efe4";
        ctx.beginPath();
        ctx.arc(s[0], s[1], 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (on("tog-radio")) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.4;
      RUN.edges.forEach(([a, b]) => {
        const pa = toScreen(RUN.stations[a][0], RUN.stations[a][1]);
        const pb = toScreen(RUN.stations[b][0], RUN.stations[b][1]);
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      });
    }

    if (on("tog-telemetry") && t < N) {
      ctx.strokeStyle = "rgba(245, 214, 70, 0.95)";
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 6; i++) {
        const u = xy(RUN.b, t, i);
        const pa = toScreen(RUN.stations[i][0], RUN.stations[i][1]);
        const pb = toScreen(u[0], u[1]);
        ctx.beginPath();
        ctx.moveTo(pa[0], pa[1]);
        ctx.lineTo(pb[0], pb[1]);
        ctx.stroke();
      }
    }

    if (on("tog-xstar")) {
      const s = toScreen(m.xs[0], m.xs[1]);
      ctx.fillStyle = "rgba(240, 180, 40, 0.28)";
      ctx.beginPath();
      ctx.arc(s[0], s[1], 16, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f6c445";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(s[0] - 9, s[1]);
      ctx.lineTo(s[0] + 9, s[1]);
      ctx.moveTo(s[0], s[1] - 9);
      ctx.lineTo(s[0], s[1] + 9);
      ctx.stroke();
    }

    if (on("tog-iter")) {
      m.X.forEach((p, i) => {
        const s = toScreen(p[0], p[1]);
        ctx.strokeStyle = COLORS[i];
        ctx.fillStyle = COLORS[i];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s[0], s[1]);
        ctx.lineTo(s[0], s[1] - 11);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(s[0], s[1] - 13, 3.3, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (on("tog-forecast") && t >= N) {
      for (let i = 0; i < 6; i++) {
        const p = xy(RUN.fp, t, i);
        if (!p) continue;
        const s = toScreen(p[0], p[1]);
        ctx.strokeStyle = COLORS[i];
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(s[0], s[1], 6, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    /* drones */
    for (let i = 0; i < 6; i++) {
      const p = xy(RUN.b, t, i);
      const s = toScreen(p[0], p[1]);
      drawDrone(ctx, s[0], s[1], COLORS[i], i === state.selected);
    }

    /* charging robot, heading from its last step */
    const prev = xy(RUN.c, Math.max(0, t - 1));
    const heading = Math.atan2(m.c[1] - prev[1], m.c[0] - prev[0]);
    const rc = toScreen(m.c[0], m.c[1]);
    drawRobot(ctx, rc[0], rc[1], heading);

    /* stations */
    RUN.stations.forEach((p, i) => {
      const s = toScreen(p[0], p[1]);
      drawStation(ctx, s[0], s[1], COLORS[i], i + 1, i === state.selected, on("tog-labels"));
    });

    /* scale bar: 2 units = 20 m */
    const origin = toScreen(0, 0);
    const tip = toScreen(2, 0);
    const bar = Math.abs(tip[0] - origin[0]);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.lineWidth = 2;
    const bx = 14;
    const by = 22;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + bar, by);
    ctx.moveTo(bx, by - 4);
    ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + bar, by - 4);
    ctx.lineTo(bx + bar, by + 4);
    ctx.stroke();
    ctx.font = "12px sans-serif";
    ctx.fillText("20 m", bx + bar + 6, by + 4);

    updateChrome(m);
    drawSpark();
  }

  function drawDrone(ctx, x, y, color, hot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = "rgba(20,20,20,0.45)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, -6);
    ctx.lineTo(9, 6);
    ctx.moveTo(-9, 6);
    ctx.lineTo(9, -6);
    ctx.stroke();
    [[-9, -6], [9, 6], [-9, 6], [9, -6]].forEach(([px, py]) => {
      ctx.fillStyle = "#222";
      ctx.beginPath();
      ctx.arc(px, py, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = color;
    ctx.strokeStyle = hot ? "#fff" : "rgba(0,0,0,0.45)";
    ctx.lineWidth = hot ? 2 : 1;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawRobot(ctx, x, y, heading) {
    ctx.save();
    ctx.translate(x, y);
    /* world +y is north, screen +y is down; atan2(dy_world, dx) */
    ctx.rotate(-heading);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(1, 4, 11, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f7f4ee";
    ctx.strokeStyle = "#2a2a2a";
    ctx.lineWidth = 1.2;
    roundRect(ctx, -12, -7, 24, 14, 3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#d9d3c7";
    ctx.fillRect(-4, -5, 10, 10);
    ctx.strokeStyle = "#333";
    ctx.beginPath();
    ctx.moveTo(-8, -8);
    ctx.lineTo(6, -8);
    ctx.moveTo(-8, 8);
    ctx.lineTo(6, 8);
    ctx.stroke();
    ctx.restore();
  }

  function drawStation(ctx, x, y, color, n, hot, labels) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = hot ? "#fff" : "#222";
    roundRect(ctx, -8, -6, 16, 12, 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.fillRect(-5, -3, 10, 6);
    ctx.fillStyle = "#111";
    ctx.fillRect(-1, -10, 2, 5);
    ctx.beginPath();
    ctx.arc(0, -11, 2.2, 0, Math.PI * 2);
    ctx.fill();
    if (labels) {
      ctx.font = "700 12px sans-serif";
      ctx.fillStyle = "#102018";
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 3;
      ctx.strokeText(String(n), 10, -6);
      ctx.fillText(String(n), 10, -6);
    }
    ctx.restore();
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateChrome(m) {
    const t = state.t;
    const phase = phaseOf(t);
    const pill = $("phase-pill");
    pill.textContent = phase === "collect" ? "COLLECT" : phase === "learn" ? "LEARN A" : "TRACK";
    pill.className = "phase " + phase;
    $("step-read").textContent = "t = " + t + " / " + (T - 1);
    $("clock-read").textContent = (t * RUN.dt).toFixed(0) + " s";
    const blurbs = {
      collect: "Station i reads only UAV i (yellow) and radios its two neighbors (white). The robot drives toward the mean of the iterates.",
      learn: "Telemetry stops. Each station exchanges three rounds of 2×2 moment matrices and estimates A. Positions stay on the station that measured them.",
      track: "No station sees its UAV. Each forecasts with its own estimate of A, and the robot keeps driving after the mean of the iterates.",
    };
    $("blurb").textContent = blurbs[phase];
    const live = $("live");
    if (live.dataset.phase !== phase) {
      live.dataset.phase = phase;
      live.textContent = pill.textContent + ". " + blurbs[phase];
    }

    document.querySelectorAll("[data-when]").forEach((el) => {
      el.classList.toggle("is-now", el.dataset.when.split(" ").includes(phase));
    });

    const wr = windowRmse(t);
    const bits = [
      "instant RMS " + m.rms.toFixed(2) + " u (" + fmtM(m.rms) + ")",
      "robot " + m.rob.toFixed(2) + " u (" + fmtM(m.rob) + ")",
      "disagreement " + m.dis.toFixed(2) + " u",
    ];
    if (wr != null) bits.push("window RMSE " + wr.toFixed(3) + " u (" + fmtM(wr) + ")");
    if (t >= N) {
      bits.push("‖Â − A‖ " + RUN.summary.idCoop.toFixed(3) + " together, " + RUN.summary.idLocal.toFixed(3) + " alone");
    }
    $("readout").textContent = bits.join("  ·  ");
    $("slider").value = String(t);
    $("play").setAttribute("aria-pressed", state.playing ? "true" : "false");
    $("play").textContent = state.playing ? "Pause" : "Play";

    document.querySelectorAll(".st").forEach((btn) => {
      const i = Number(btn.dataset.i);
      btn.classList.toggle("is-on", i === state.selected);
      btn.classList.toggle("show-bars", t >= N);
      const dot = btn.querySelector(".link-dot");
      dot.classList.toggle("off", t >= N);
      if (t >= N) {
        btn.querySelector(".bar.coop").style.width = barWidth(RUN.idCoop[i]) + "%";
        btn.querySelector(".bar.local").style.width = barWidth(RUN.idLocal[i]) + "%";
      }
    });
    updateDetail(m);
  }

  function barWidth(err) {
    const lo = Math.log10(0.006);
    const hi = Math.log10(0.4);
    const u = (Math.log10(Math.max(err, 0.006)) - lo) / (hi - lo);
    return Math.max(4, Math.min(100, u * 100));
  }

  function updateDetail(m) {
    const i = state.selected;
    const p = m.X[i];
    const err = Math.hypot(p[0] - m.xs[0], p[1] - m.xs[1]);
    const neighbors = RUN.edges
      .filter((e) => e[0] === i || e[1] === i)
      .map((e) => (e[0] === i ? e[1] : e[0]) + 1)
      .join(" and ");
    let html =
      "<h3>" + (i + 1) + " · " + RUN.agencies[i] + "</h3>" +
      "<p>Watches the " + RUN.sites[i] + ". Service rate h = " + RUN.h[i] +
      ". Radios stations " + neighbors + ". Distance of its iterate to x*(t): " +
      fmtM(err) + " (" + err.toFixed(2) + " units).</p>";
    if (state.t >= N) {
      const unstable = RHO_LOCAL[i] > 0.999;
      html +=
        "<div class='mats'><div><b>Together, ‖Â − A‖ = " + RUN.idCoop[i].toFixed(3) + "</b>" +
        matHtml(RUN.Ahat[i]) + "</div><div><b>Alone, ‖Â − A‖ = " + RUN.idLocal[i].toFixed(3) +
        (unstable ? " · radius " + RHO_LOCAL[i].toFixed(2) + " before the safeguard" : "") +
        "</b>" + matHtml(RUN.Alocal[i]) + "</div></div>";
    } else {
      html += "<p>The dynamics matrix is still being filled in from this station’s own gradients.</p>";
    }
    $("detail").innerHTML = html;
  }

  function matHtml(M) {
    return "<div>" + M[0].map(fmt4).join("&nbsp;&nbsp;") + "<br>" + M[1].map(fmt4).join("&nbsp;&nbsp;") + "</div>";
  }
  function fmt4(v) {
    const s = v.toFixed(3);
    return (v >= 0 ? "+" : "") + s;
  }

  function drawSpark() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = spark.clientWidth || 250;
    const h = spark.clientHeight || 92;
    spark.width = Math.round(w * dpr);
    spark.height = Math.round(h * dpr);
    const ctx = sctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const l = 28;
    const r = 8;
    const tpad = 8;
    const b = 16;
    const pw = w - l - r;
    const ph = h - tpad - b;
    const yLog = (v) => {
      const lo = Math.log10(0.04);
      const hi = Math.log10(12);
      const u = (Math.log10(Math.max(v, 0.04)) - lo) / (hi - lo);
      return tpad + (1 - u) * ph;
    };
    const xOf = (k) => l + (k / (T - 1)) * pw;

    ctx.fillStyle = "rgba(80, 170, 190, 0.16)";
    ctx.fillRect(xOf(0), tpad, xOf(N) - xOf(0), ph);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(xOf(N), tpad);
    ctx.lineTo(xOf(N), tpad + ph);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.font = "10px sans-serif";
    ctx.fillStyle = "#b7c9c4";
    [0.1, 1, 10].forEach((v) => {
      const y = yLog(v);
      ctx.beginPath();
      ctx.moveTo(l, y);
      ctx.lineTo(l + pw, y);
      ctx.stroke();
      ctx.fillText(String(v), 2, y + 3);
    });

    const series = [
      { key: "rms", color: "#7ec8e3" },
      { key: "rob", color: "#f6c445" },
      { key: "dis", color: "#d0d6d4" },
    ];
    const cache = [];
    for (let k = 0; k <= state.t; k++) cache.push(metrics(k));
    series.forEach((s) => {
      ctx.beginPath();
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 1.6;
      cache.forEach((row, k) => {
        const x = xOf(k);
        const y = yLog(row[s.key]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
    ctx.fillStyle = "#f6c445";
    ctx.fillRect(xOf(state.t) - 1, tpad, 2, ph);
  }

  /* --------------------------------------------------------------- stations */
  const list = $("station-list");
  RUN.agencies.forEach((name, i) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "st";
    b.dataset.i = String(i);
    b.innerHTML =
      '<span class="swatch" style="background:' + COLORS[i] + '"></span>' +
      "<span>" + (i + 1) + " " + name + "</span>" +
      '<span class="link-dot" title="telemetry"></span>' +
      '<span class="bars"><i class="bar coop"></i><i class="bar local"></i></span>';
    b.addEventListener("click", () => {
      state.selected = i;
      draw();
    });
    list.appendChild(b);
  });

  /* ---------------------------------------------------------------- pointer */
  let drag = null;
  world.addEventListener("pointerdown", (ev) => {
    world.setPointerCapture(ev.pointerId);
    drag = { x: ev.offsetX, y: ev.offsetY, cx: cam.x, cy: cam.y, moved: false };
  });
  world.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const dx = ev.offsetX - drag.x;
    const dy = ev.offsetY - drag.y;
    if (dx * dx + dy * dy > 9) drag.moved = true;
    cam.x = drag.cx - dx / cam.k;
    cam.y = drag.cy + dy / cam.k;
    state.userCam = true;
    draw();
  });
  world.addEventListener("pointerup", (ev) => {
    if (drag && !drag.moved) {
      const [x, y] = toWorld(ev.offsetX, ev.offsetY);
      let best = -1;
      let bestD = 1.1;
      RUN.stations.forEach((p, i) => {
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      });
      for (let i = 0; i < 6; i++) {
        const p = xy(RUN.b, state.t, i);
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bestD) {
          best = i;
          bestD = d;
        }
      }
      if (best >= 0) state.selected = best;
      draw();
    }
    drag = null;
  });
  world.addEventListener("dblclick", () => fit());
  world.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    const [wx, wy] = toWorld(ev.offsetX, ev.offsetY);
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    cam.k = Math.max(8, Math.min(90, cam.k * factor));
    const [sx, sy] = toScreen(wx, wy);
    cam.x += (sx - ev.offsetX) / cam.k;
    cam.y -= (sy - ev.offsetY) / cam.k;
    state.userCam = true;
    draw();
  }, { passive: false });

  $("zoom-in").addEventListener("click", () => { cam.k = Math.min(90, cam.k * 1.2); state.userCam = true; draw(); });
  $("zoom-out").addEventListener("click", () => { cam.k = Math.max(8, cam.k / 1.2); state.userCam = true; draw(); });
  $("fit").addEventListener("click", () => fit());

  function setPlaying(v) {
    state.playing = v;
    state.last = performance.now();
    $("play").setAttribute("aria-pressed", v ? "true" : "false");
    $("play").textContent = v ? "Pause" : "Play";
  }
  $("play").addEventListener("click", () => {
    if (!state.playing && state.t >= T - 1) {
      state.t = 0;
      state.heldLearn = false;
    }
    if (!state.playing && state.t === 0) state.heldLearn = false;
    setPlaying(!state.playing);
  });
  $("step-back").addEventListener("click", () => { setPlaying(false); state.t = Math.max(0, state.t - 1); draw(); });
  $("step-fwd").addEventListener("click", () => { setPlaying(false); state.t = Math.min(T - 1, state.t + 1); draw(); });
  $("slider").max = String(T - 1);
  $("slider").addEventListener("input", () => {
    setPlaying(false);
    state.t = Number($("slider").value);
    draw();
  });
  ["tog-telemetry", "tog-radio", "tog-iter", "tog-xstar", "tog-trails", "tog-forecast", "tog-labels", "tog-panels"].forEach((id) => {
    $(id).addEventListener("change", () => {
      if (id === "tog-panels") $("stage").classList.toggle("panels-off", !on("tog-panels"));
      draw();
    });
  });

  document.addEventListener("keydown", (ev) => {
    const tag = (ev.target && ev.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (ev.code === "Space") {
      ev.preventDefault();
      $("play").click();
    } else if (ev.code === "ArrowRight") {
      $("step-fwd").click();
    } else if (ev.code === "ArrowLeft") {
      $("step-back").click();
    }
  });

  function tick(now) {
    if (state.playing) {
      const dt = Math.min(0.05, (now - state.last) / 1000);
      state.last = now;
      const rate = Number($("speed").value);
      state.acc += dt * rate;
      while (state.acc >= 1 && state.t < T - 1) {
        state.acc -= 1;
        const prev = state.t;
        state.t += 1;
        if (state.t === N && prev === N - 1 && on("pause-learn") && !state.heldLearn) {
          state.heldLearn = true;
          state.playing = false;
          state.acc = 0;
          break;
        }
      }
      if (state.t >= T - 1) {
        state.t = T - 1;
        state.playing = false;
        state.acc = 0;
      }
      draw();
    }
    requestAnimationFrame(tick);
  }

  /* ------------------------------------------------------------------ charts */
  const dark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const charts = [];

  function drawChart(canvas, spec) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 270;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const night = dark();
    const bg = night ? "#1c2026" : "#fffdf8";
    const ink = night ? "#f3efe6" : "#1c1915";
    const grid = night ? "rgba(255,255,255,0.08)" : "rgba(60,40,20,0.1)";
    const mute = night ? "#c4bbae" : "#5e574c";
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const plot = { l: 52, r: 12, t: 16, b: 46 };
    plot.w = w - plot.l - plot.r;
    plot.h = h - plot.t - plot.b;

    const xMap = (v) => {
      if (spec.xlog) {
        return plot.l + ((Math.log(v) - Math.log(spec.xmin)) / (Math.log(spec.xmax) - Math.log(spec.xmin))) * plot.w;
      }
      return plot.l + ((v - spec.xmin) / (spec.xmax - spec.xmin)) * plot.w;
    };
    const yMap = (v) => {
      if (spec.ylog) {
        const u = (Math.log(v) - Math.log(spec.ymin)) / (Math.log(spec.ymax) - Math.log(spec.ymin));
        return plot.t + (1 - u) * plot.h;
      }
      return plot.t + (1 - (v - spec.ymin) / (spec.ymax - spec.ymin)) * plot.h;
    };

    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = mute;
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    spec.xticks.forEach((tk) => {
      const x = xMap(tk.v);
      ctx.beginPath();
      ctx.moveTo(x, plot.t);
      ctx.lineTo(x, plot.t + plot.h);
      ctx.stroke();
      ctx.fillText(tk.label, x, plot.t + plot.h + 16);
    });
    ctx.textAlign = "right";
    spec.yticks.forEach((tk) => {
      const y = yMap(tk.v);
      ctx.beginPath();
      ctx.moveTo(plot.l, y);
      ctx.lineTo(plot.l + plot.w, y);
      ctx.stroke();
      ctx.fillText(tk.label, plot.l - 6, y + 3);
    });
    ctx.strokeStyle = night ? "#8a8174" : "#8a8174";
    ctx.strokeRect(plot.l, plot.t, plot.w, plot.h);
    ctx.fillStyle = ink;
    ctx.textAlign = "center";
    ctx.font = "12px sans-serif";
    ctx.fillText(spec.xlabel, plot.l + plot.w / 2, h - 8);
    ctx.save();
    ctx.translate(14, plot.t + plot.h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(spec.ylabel, 0, 0);
    ctx.restore();

    const hits = [];
    spec.series.forEach((s) => {
      if (s.lo && s.hi) {
        ctx.beginPath();
        s.x.forEach((x, i) => {
          const px = xMap(x);
          const py = yMap(s.hi[i]);
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        for (let i = s.x.length - 1; i >= 0; i--) ctx.lineTo(xMap(s.x[i]), yMap(s.lo[i]));
        ctx.closePath();
        ctx.fillStyle = s.color;
        ctx.globalAlpha = 0.18;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.beginPath();
      const color = night && s.color === "#222222" ? "#e8e6e1" : s.color;
      ctx.strokeStyle = color;
      ctx.lineWidth = s.width || 1.8;
      ctx.setLineDash(s.dash || []);
      s.x.forEach((x, i) => {
        const px = xMap(x);
        const py = yMap(s.y[i]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        hits.push({ x: px, y: py, text: s.name + " at " + x + ": " + s.y[i] });
      });
      ctx.stroke();
      ctx.setLineDash([]);
      s.x.forEach((x, i) => marker(ctx, xMap(x), yMap(s.y[i]), s.marker, color));
    });
    canvas._hits = hits;
    canvas._spec = spec;
  }

  function marker(ctx, x, y, kind, color) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.4;
    if (kind === "circle") {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    } else if (kind === "triangle") {
      ctx.beginPath();
      ctx.moveTo(x, y - 4.2);
      ctx.lineTo(x + 4, y + 3.2);
      ctx.lineTo(x - 4, y + 3.2);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "diamond") {
      ctx.beginPath();
      ctx.moveTo(x, y - 4.5);
      ctx.lineTo(x + 4, y);
      ctx.lineTo(x, y + 4.5);
      ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "x") {
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y - 3.5);
      ctx.lineTo(x + 3.5, y + 3.5);
      ctx.moveTo(x + 3.5, y - 3.5);
      ctx.lineTo(x - 3.5, y + 3.5);
      ctx.stroke();
    } else if (kind === "open") {
      ctx.beginPath();
      ctx.arc(x, y, 3.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  const COOP = "#0072b2";
  const LOCAL = "#d55e00";
  const Ns = [30, 50, 100, 150, 200];
  const xtN = Ns.map((v) => ({ v, label: String(v) }));

  function mount(id, spec) {
    const canvas = $(id);
    if (!canvas) return;
    charts.push({ canvas, spec });
    canvas.addEventListener("mousemove", (ev) => {
      const hits = canvas._hits || [];
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best = null;
      let bestD = 14;
      hits.forEach((h) => {
        const d = Math.hypot(h.x - x, h.y - y);
        if (d < bestD) {
          best = h;
          bestD = d;
        }
      });
      const tip = $("tip");
      if (!best) {
        tip.style.display = "none";
        return;
      }
      tip.style.display = "block";
      tip.style.left = ev.clientX + "px";
      tip.style.top = ev.clientY + "px";
      tip.textContent = best.text;
    });
    canvas.addEventListener("mouseleave", () => { $("tip").style.display = "none"; });
  }

  mount("chart-a-rmse", {
    xlabel: "training horizon N",
    ylabel: "tracking RMSE",
    xlog: true, ylog: false,
    xmin: 26, xmax: 230, ymin: 0.15, ymax: 0.75,
    xticks: xtN,
    yticks: [0.2, 0.4, 0.6].map((v) => ({ v, label: v.toFixed(1) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.3239, 0.2965, 0.2752, 0.2553, 0.2462], lo: [0.2525, 0.236, 0.1798, 0.2127, 0.1949], hi: [0.3958, 0.3491, 0.3143, 0.3332, 0.3026] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.5513, 0.3882, 0.2859, 0.309, 0.2621], lo: [0.4314, 0.3215, 0.2373, 0.2456, 0.1979], hi: [0.682, 0.5311, 0.3749, 0.3575, 0.3158] },
    ],
  });
  mount("chart-a-id", {
    xlabel: "training horizon N",
    ylabel: "identification error",
    xlog: true, ylog: true,
    xmin: 26, xmax: 230, ymin: 0.003, ymax: 0.05,
    xticks: xtN,
    yticks: [0.005, 0.01, 0.02].map((v) => ({ v, label: String(v) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.008174, 0.006336, 0.006104, 0.005555, 0.004973], lo: [0.005809, 0.004485, 0.004362, 0.00411, 0.003287], hi: [0.01233, 0.008826, 0.007988, 0.00784, 0.006648] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.02396, 0.01787, 0.0165, 0.01535, 0.01476], lo: [0.01504, 0.01062, 0.009796, 0.009596, 0.008632], hi: [0.04379, 0.03372, 0.03109, 0.02824, 0.0297] },
    ],
  });
  const Ms = [2, 4, 8, 16, 32];
  mount("chart-a-m", {
    xlabel: "number of agents m",
    ylabel: "identification error",
    xlog: true, ylog: true,
    xmin: 1.7, xmax: 40, ymin: 0.003, ymax: 0.05,
    xticks: Ms.map((v) => ({ v, label: String(v) })),
    yticks: [0.005, 0.01, 0.02].map((v) => ({ v, label: String(v) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ms, y: [0.01523, 0.00842, 0.005308, 0.005543, 0.005232], lo: [0.00973, 0.006338, 0.003703, 0.003671, 0.003811], hi: [0.02679, 0.01187, 0.007752, 0.007481, 0.006974] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ms, y: [0.0252, 0.02022, 0.01978, 0.01941, 0.01889], lo: [0.01477, 0.01225, 0.01145, 0.01125, 0.01104], hi: [0.03987, 0.04108, 0.04054, 0.03949, 0.03643] },
    ],
  });
  mount("chart-b-rmse", {
    xlabel: "training horizon N",
    ylabel: "tracking RMSE",
    xlog: true, ylog: false,
    xmin: 26, xmax: 230, ymin: 0.009, ymax: 0.038,
    xticks: xtN,
    yticks: [0.01, 0.02, 0.03].map((v) => ({ v, label: v.toFixed(2) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.01896, 0.01732, 0.01426, 0.01412, 0.01411], lo: [0.01618, 0.01508, 0.01188, 0.01303, 0.0126], hi: [0.02312, 0.01898, 0.0171, 0.01651, 0.01703] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.03003, 0.02587, 0.01878, 0.02161, 0.02164], lo: [0.02705, 0.01868, 0.01555, 0.01745, 0.01682], hi: [0.03516, 0.03283, 0.02481, 0.03005, 0.02623] },
    ],
  });
  mount("chart-b-id", {
    xlabel: "training horizon N",
    ylabel: "identification error",
    xlog: true, ylog: true,
    xmin: 26, xmax: 230, ymin: 0.012, ymax: 0.55,
    xticks: xtN,
    yticks: [0.02, 0.05, 0.1, 0.2, 0.5].map((v) => ({ v, label: String(v) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.02479, 0.02244, 0.02389, 0.02589, 0.02497], lo: [0.01891, 0.01756, 0.0185, 0.01861, 0.01931], hi: [0.03241, 0.0283, 0.03046, 0.03418, 0.03457] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.116, 0.1147, 0.1413, 0.1341, 0.1405], lo: [0.06638, 0.06355, 0.06574, 0.06466, 0.06517], hi: [0.2491, 0.3746, 0.4263, 0.342, 0.3985] },
      { name: "pooled least squares", color: "#cc79a7", marker: "x", dash: [4, 3], x: Ns, y: [0.02765, 0.033, 0.05433, 0.07149, 0.09276] },
    ],
  });
  const tau = [0, 1, 2, 3, 5, 10];
  mount("chart-b-tau", {
    xlabel: "consensus rounds τ",
    ylabel: "identification error",
    xlog: false, ylog: true,
    xmin: -0.4, xmax: 10.6, ymin: 0.012, ymax: 0.55,
    xticks: tau.map((v) => ({ v, label: String(v) })),
    yticks: [0.02, 0.05, 0.1, 0.2, 0.5].map((v) => ({ v, label: String(v) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: tau, y: [0.1413, 0.03802, 0.0267, 0.02389, 0.02241, 0.02209], lo: [0.06574, 0.02743, 0.02062, 0.0185, 0.01669, 0.01662], hi: [0.4263, 0.05664, 0.03501, 0.03046, 0.02683, 0.02609] },
      { name: "exact averaging", color: "#56b4e9", marker: "open", dash: [5, 3], width: 1.4, x: [0, 10], y: [0.02219, 0.02219] },
    ],
  });
  mount("chart-w-rmse", {
    xlabel: "training horizon N",
    ylabel: "tracking RMSE",
    xlog: true, ylog: false,
    xmin: 26, xmax: 230, ymin: 0.2, ymax: 1.7,
    xticks: xtN,
    yticks: [0.4, 0.8, 1.2, 1.6].map((v) => ({ v, label: v.toFixed(1) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.385, 0.394, 0.376, 0.337, 0.316] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.631, 0.527, 0.446, 0.402, 0.374] },
      { name: "oracle A", color: "#222222", marker: "diamond", dash: [2, 2], x: Ns, y: [0.357, 0.339, 0.369, 0.336, 0.308] },
      { name: "persistence", color: "#6e6e6e", marker: "open", dash: [1, 3], x: Ns, y: [1.547, 1.115, 0.825, 0.631, 0.451] },
    ],
  });
  mount("chart-w-id", {
    xlabel: "training horizon N",
    ylabel: "identification error",
    xlog: true, ylog: true,
    xmin: 26, xmax: 230, ymin: 0.006, ymax: 0.06,
    xticks: xtN,
    yticks: [0.01, 0.02, 0.04].map((v) => ({ v, label: String(v) })),
    series: [
      { name: "cooperative", color: COOP, marker: "circle", x: Ns, y: [0.0143, 0.0106, 0.011, 0.0114, 0.0123] },
      { name: "local", color: LOCAL, marker: "triangle", x: Ns, y: [0.042, 0.0327, 0.0303, 0.0325, 0.0323] },
      { name: "exact averaging", color: "#56b4e9", marker: "open", dash: [5, 3], x: Ns, y: [0.0125, 0.01, 0.0097, 0.0108, 0.0108] },
    ],
  });

  function redrawCharts() {
    charts.forEach(({ canvas, spec }) => drawChart(canvas, spec));
  }

  /* ----------------------------------------------------------------- stills */
  document.querySelectorAll(".shots button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".shots button").forEach((b) => b.setAttribute("aria-pressed", "false"));
      btn.setAttribute("aria-pressed", "true");
      $("still").src = btn.dataset.src;
      $("still").alt = btn.dataset.alt;
      $("still-cap").textContent = btn.dataset.cap;
    });
  });

  const copy = $("copy-bib");
  if (copy) {
    copy.addEventListener("click", async () => {
      const text = $("bibtex").innerText;
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = "Copied";
      } catch (e) {
        copy.textContent = "Select the text";
      }
      setTimeout(() => { copy.textContent = "Copy BibTeX"; }, 1600);
    });
  }

  const ro = new ResizeObserver(() => {
    resizeWorld();
    draw();
    redrawCharts();
  });
  ro.observe(world);
  charts.forEach(({ canvas }) => ro.observe(canvas));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    redrawCharts();
  });

  resizeWorld();
  redrawCharts();
  draw();
  requestAnimationFrame(tick);
})();
