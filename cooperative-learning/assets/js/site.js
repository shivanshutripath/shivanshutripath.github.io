/* Project page behaviour: math, copy buttons, teaser video, the 3D Webots view. */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function renderMath() {
    if (typeof window.renderMathInElement !== "function") return;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
      throwOnError: false
    });
  }

  function initCopy() {
    document.querySelectorAll("[data-copy-target]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var el = document.getElementById(btn.getAttribute("data-copy-target"));
        if (!el) return;
        var text = el.innerText;
        var done = function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1500);
        };
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(text).then(done, function () { selectText(el); });
        } else {
          selectText(el);
        }
      });
    });
  }

  function selectText(el) {
    var range = document.createRange();
    range.selectNodeContents(el);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* The teaser video plays muted while at least half of it is visible. */
  function initVideo() {
    var video = document.querySelector("video[data-autoplay-when-visible]");
    if (!video || reduceMotion || !("IntersectionObserver" in window)) return;
    var userPaused = false;
    video.addEventListener("pause", function () { if (video.dataset.autoPausing !== "1") userPaused = true; });
    video.addEventListener("play", function () { userPaused = false; });
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.intersectionRatio >= 0.5) {
          if (!userPaused && video.paused) {
            video.muted = true;
            var p = video.play();
            if (p && p.catch) p.catch(function () {});
          }
        } else if (!video.paused) {
          video.dataset.autoPausing = "1";
          video.pause();
          video.dataset.autoPausing = "";
        }
      });
    }, { threshold: [0, 0.5] }).observe(video);
  }

  /* The Webots web player loads only when asked (about 8 MB). */
  function initWebots() {
    var frame = document.querySelector("[data-webots]");
    if (!frame) return;
    var button = frame.querySelector(".webots-load");
    var started = false;

    function fail(msg) {
      frame.classList.remove("is-loading");
      var p = document.createElement("p");
      p.className = "webots-error";
      p.textContent = msg;
      frame.appendChild(p);
    }

    function load() {
      if (started) return;
      started = true;
      var gl = document.createElement("canvas").getContext("webgl2");
      if (!gl) { fail("This browser has no WebGL 2, which the 3D view needs. The video above shows the same simulation."); return; }
      frame.classList.add("is-loading");
      var player = new URL(frame.getAttribute("data-player"), document.baseURI).href;
      import(player).then(function () {
        var view = document.createElement("webots-view");
        view.setAttribute("data-scene", frame.getAttribute("data-scene"));
        view.setAttribute("data-animation", frame.getAttribute("data-animation"));
        view.setAttribute("data-autoplay", reduceMotion ? "false" : "true");
        view.onready = function () {
          frame.classList.remove("is-loading");
          frame.classList.add("is-ready");
          if (button) button.remove();
        };
        frame.appendChild(view);
        setTimeout(function () {
          if (!frame.classList.contains("is-ready")) {
            if (button) button.remove();
            frame.classList.remove("is-loading");
          }
        }, 20000);
      }).catch(function () {
        fail("The 3D view could not be loaded. The video above shows the same simulation.");
      });
    }

    if (button) button.addEventListener("click", load);
  }

  function init() {
    renderMath();
    initCopy();
    initVideo();
    initWebots();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
