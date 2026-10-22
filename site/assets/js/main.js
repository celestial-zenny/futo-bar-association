/* ==========================================================================
   FUTO Bar Association — site behaviour
   The mobile navigation toggle and tabs (study materials, admin dashboard).
   Both are progressive enhancements over markup that already works without
   JavaScript. Data-driven pages load fba.js and their own script on top.
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------------------------------- mobile navigation */
  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.getElementById("primary-nav");
    if (!toggle || !nav) return;

    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    }

    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });

    // Collapse after choosing a destination on small screens.
    nav.addEventListener("click", function (event) {
      if (event.target.closest("a")) setOpen(false);
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        setOpen(false);
        toggle.focus();
      }
    });

    // Reset state when the layout returns to the desktop breakpoint.
    window.addEventListener("resize", function () {
      if (window.innerWidth > 1080) setOpen(false);
    });
  }

  /* ------------------------------------------------------ study-material tabs */
  function initTabs(root) {
    var tabs = Array.prototype.slice.call(
      root.querySelectorAll('[role="tab"]')
    );
    if (!tabs.length) return;

    var panels = tabs.map(function (tab) {
      return document.getElementById(tab.getAttribute("aria-controls"));
    });

    function select(index, moveFocus) {
      tabs.forEach(function (tab, i) {
        var active = i === index;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.setAttribute("tabindex", active ? "0" : "-1");
        if (panels[i]) panels[i].hidden = !active;
      });
      if (moveFocus) tabs[index].focus();
    }

    tabs.forEach(function (tab, i) {
      tab.addEventListener("click", function () {
        select(i, false);
        // Record the open group so the view can be linked to and shared.
        if (window.history && window.history.replaceState) {
          window.history.replaceState(null, "", "#" + tab.id);
        }
      });

      tab.addEventListener("keydown", function (event) {
        var next = null;
        switch (event.key) {
          case "ArrowRight":
            next = (i + 1) % tabs.length;
            break;
          case "ArrowLeft":
            next = (i - 1 + tabs.length) % tabs.length;
            break;
          case "Home":
            next = 0;
            break;
          case "End":
            next = tabs.length - 1;
            break;
          default:
            return;
        }
        event.preventDefault();
        select(next, true);
      });
    });

    // Honour a tab or panel id in the address bar, e.g. #tab-week-03.
    var target = window.location.hash.replace("#", "");
    var initial = 0;
    if (target) {
      tabs.forEach(function (tab, i) {
        if (tab.id === target || tab.getAttribute("aria-controls") === target) {
          initial = i;
        }
      });
    }
    select(initial, false);
  }

  function ready() {
    initNav();
    Array.prototype.forEach.call(document.querySelectorAll("[data-tabs]"), initTabs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ready);
  } else {
    ready();
  }
})();
