// Mobile navigation
(function () {
  const nav = document.querySelector("[data-nav]");
  if (!nav) return;

  const toggle = nav.querySelector(".nav__toggle");

  toggle.addEventListener("click", function () {
    const open = nav.dataset.open === "true";
    nav.dataset.open = String(!open);
    toggle.setAttribute("aria-expanded", String(!open));
  });

  document.addEventListener("click", function (event) {
    if (!nav.contains(event.target)) {
      nav.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
    }
  });
})();

// Publication type filters
(function () {
  const filters = document.querySelector("[data-pub-filters]");
  if (!filters) return;

  const entries = Array.from(document.querySelectorAll("[data-pub-type]"));
  const groups = Array.from(document.querySelectorAll("[data-pub-group]"));

  function apply(type) {
    entries.forEach(function (entry) {
      const match = type === "all" || entry.dataset.pubType === type;
      entry.classList.toggle("is-hidden", !match);
    });

    // Hide a year heading and its list when nothing inside it is visible.
    groups.forEach(function (group) {
      const visible = group.querySelectorAll(
        "[data-pub-type]:not(.is-hidden)"
      ).length;
      group.classList.toggle("is-hidden", visible === 0);
      const heading = document.querySelector(
        '[data-pub-year="' + group.dataset.pubGroup + '"]'
      );
      if (heading) heading.classList.toggle("is-hidden", visible === 0);
    });
  }

  filters.addEventListener("click", function (event) {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;

    filters.querySelectorAll("button[data-filter]").forEach(function (other) {
      other.setAttribute("aria-pressed", String(other === button));
    });

    apply(button.dataset.filter);
  });
})();
