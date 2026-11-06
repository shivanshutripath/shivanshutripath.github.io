/*
 * mc-worker.js -- runs the Monte Carlo panel of the playground off the main
 * thread.  Message {cmd: "run", cfg, opts} -> {type: "progress", done, total}
 * ... {type: "done", result}.  The page cancels a run by terminating the worker.
 */
/* global importScripts */
try {
  importScripts("engine.js");
} catch (e) {
  self.postMessage({ type: "error", message: "engine.js did not load: " + e.message });
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  if (msg.cmd !== "run") return;
  if (!self.CoopEngine) {
    self.postMessage({ type: "error", message: "engine.js is not available" });
    return;
  }
  try {
    let last = 0;
    const result = self.CoopEngine.monteCarlo(msg.cfg, msg.opts, function (done, total) {
      const now = Date.now();
      if (now - last > 40 || done === total) {
        last = now;
        self.postMessage({ type: "progress", done: done, total: total });
      }
      return true;
    });
    self.postMessage({ type: "done", result: result });
  } catch (e) {
    self.postMessage({ type: "error", message: String(e && e.message) });
  }
};
