/* site.js: the page's own behaviour.
   1. KaTeX auto-render of \( \) and \[ \] (no $ delimiters).
   2. Copy buttons ([data-copy-target]).
   3. The teaser video ([data-autoplay-when-visible]): muted play while at least half
      visible, pause once it leaves the viewport; never with sound, never with reduced motion.
   4. Smooth scrolling for in-page links (instant with reduced motion).
   The interactive components (webots-sim, playground, charts) initialize themselves. */
(function () {
  "use strict";

  var motionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  function reducedMotion() {
    return !!(motionQuery && motionQuery.matches);
  }

  /* ---------------------------------------------------------------- math */

  var mathDone = false;

  function renderMath() {
    if (mathDone) return true;
    if (typeof window.renderMathInElement !== "function") return false;
    mathDone = true;
    window.renderMathInElement(document.body, {
      delimiters: [
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false }
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code", "option", "svg"],
      // the component mounts build their own DOM; the diagram is SVG text
      ignoredClasses: ["ws", "pg", "chart", "diagram"]
    });
    var errors = document.querySelectorAll(".katex-error");
    if (errors.length) {
      console.warn("KaTeX: " + errors.length + " expression(s) failed to render:",
        Array.prototype.map.call(errors, function (e) { return e.getAttribute("title") || e.textContent; }));
    }
    return true;
  }

  if (!renderMath()) {
    // KaTeX is loaded with defer before this file; if it was late or missing, try once more.
    window.addEventListener("load", renderMath, { once: true });
  }

  /* -------------------------------------------------------- copy buttons */

  function legacyCopy(text) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.left = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function selectContents(el) {
    var sel = window.getSelection && window.getSelection();
    if (!sel) return;
    var range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  var isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || "");

  function initCopyButtons() {
    var buttons = document.querySelectorAll("[data-copy-target]");
    Array.prototype.forEach.call(buttons, function (btn) {
      var label = btn.textContent;
      var timer = null;
      btn.setAttribute("aria-live", "polite");
      btn.addEventListener("click", function () {
        var target = document.getElementById(btn.getAttribute("data-copy-target"));
        if (!target) return;
        copyText(target.textContent).then(function (ok) {
          if (!ok) selectContents(target);
          btn.textContent = ok ? "Copied" : (isMac ? "Press ⌘C" : "Press Ctrl+C");
          btn.classList.toggle("is-copied", ok);
          clearTimeout(timer);
          timer = setTimeout(function () {
            btn.textContent = label;
            btn.classList.remove("is-copied");
          }, 2000);
        });
      });
    });
  }

  /* -------------------------------------------------------- teaser video */

  function initTeaserVideo(video) {
    if (!("IntersectionObserver" in window)) return;
    var conn = navigator.connection;
    if (conn && conn.saveData) return;

    var visible = false;      // at least half in view (and not yet fully out of view)
    var userPaused = false;   // the viewer paused it: do not resume it for them
    var autoPausing = false;  // the next "pause" event is ours

    video.muted = true;

    video.addEventListener("pause", function () {
      if (autoPausing) {
        autoPausing = false;
        return;
      }
      if (!video.ended) userPaused = true;
    });
    video.addEventListener("play", function () {
      userPaused = false;
    });

    function tryPlay() {
      if (!visible || userPaused || !video.paused || video.ended) return;
      if (!video.muted || reducedMotion() || document.hidden) return;
      var p = video.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    }

    function autoPause() {
      if (video.paused) return;
      autoPausing = true;
      video.pause();
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          visible = true;
          tryPlay();
        } else if (!entry.isIntersecting) {
          visible = false;
          autoPause();
        }
      });
    }, { threshold: [0, 0.5] });
    io.observe(video);

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) autoPause();
      else tryPlay();
    });

    if (motionQuery) {
      var onMotionChange = function () {
        if (reducedMotion()) autoPause();
        else tryPlay();
      };
      if (motionQuery.addEventListener) motionQuery.addEventListener("change", onMotionChange);
      else if (motionQuery.addListener) motionQuery.addListener(onMotionChange);
    }
  }

  function initVideos() {
    var videos = document.querySelectorAll("video[data-autoplay-when-visible]");
    Array.prototype.forEach.call(videos, initTeaserVideo);
  }

  /* ---------------------------------------------------- in-page scrolling */

  function initInPageLinks() {
    document.addEventListener("click", function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      try {
        id = decodeURIComponent(id);
      } catch (err) {
        return;
      }
      var target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      if (window.history && history.pushState) {
        if (location.hash !== "#" + id) history.pushState(null, "", "#" + id);
      } else {
        location.hash = id;
      }
      // move keyboard focus to the section without scrolling a second time
      if (!target.hasAttribute("tabindex") && !/^(A|BUTTON|INPUT|SELECT|TEXTAREA|VIDEO)$/.test(target.tagName)) {
        target.setAttribute("tabindex", "-1");
      }
      try {
        target.focus({ preventScroll: true });
      } catch (err) {
        /* old browsers: focus without options would scroll; skip it */
      }
    });
  }

  initCopyButtons();
  initVideos();
  initInPageLinks();
})();
