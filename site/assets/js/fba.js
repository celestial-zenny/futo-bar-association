/* ==========================================================================
   FUTO Bar Association — shared data helpers
   Loaded after the vendored supabase-js build on every page that reads or
   writes association data (legal aid, blog, archive, admin). Exposes a
   single global, window.FBA.
   ========================================================================== */
(function () {
  "use strict";

  /* The publishable key is meant to be public: every table is protected by
     row-level security in the database (see supabase/migrations). */
  var SUPABASE_URL = "https://poussdmnfffmaehxpazx.supabase.co";
  var SUPABASE_KEY = "sb_publishable_FKC65ntE8hjpUhCE9ySxvA_4w56ujfe";

  var db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  var CATEGORIES = {
    academic: "Academic (results, exams, registration)",
    disciplinary: "Disciplinary panel or suspension",
    hostel: "Hostel and accommodation",
    harassment: "Harassment or assault",
    tenancy: "Off-campus tenancy / landlord",
    police: "Police arrest or detention",
    employment: "Work, internship or SIWES",
    consumer: "Consumer, fraud or money dispute",
    other: "Something else"
  };

  /* "requested" is not stored: the database reports it for a 'new' case
     whose student has chosen a barrister who hasn't answered yet. */
  var STATUSES = {
    new: "Received",
    requested: "Waiting for barrister",
    assigned: "Barrister assigned",
    in_progress: "In progress",
    resolved: "Resolved",
    closed: "Closed"
  };

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(iso, withTime) {
    if (!iso) return "";
    var options = { day: "numeric", month: "long", year: "numeric" };
    if (withTime) {
      options.hour = "numeric";
      options.minute = "2-digit";
    }
    return new Date(iso).toLocaleString("en-NG", options);
  }

  function monthKey(iso) {
    return iso ? iso.slice(0, 7) : "";
  }

  function monthLabel(key) {
    var parts = key.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, 1)
      .toLocaleString("en-NG", { month: "long", year: "numeric" });
  }

  /* ----------------------------------------------------- markdown (subset)
     Admins write posts in a small Markdown subset. Everything is escaped
     first, so raw HTML in a post is shown as text, never executed.
     Supported: ## and ### headings, paragraphs, **bold**, *italic*,
     [links](https://…), - bullet and 1. numbered lists, > quotes, ---. */
  function inline(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:|\/)[^\s)]+)\)/g, function (_, label, href) {
        var external = /^https?:/.test(href);
        return '<a href="' + href + '"' +
          (external ? ' rel="noopener" target="_blank"' : "") + ">" + label + "</a>";
      });
  }

  function markdown(source) {
    var lines = esc(source || "").replace(/\r\n?/g, "\n").split("\n");
    var html = [];
    var para = [];
    var list = null;

    function flushPara() {
      if (para.length) html.push("<p>" + inline(para.join("<br>")) + "</p>");
      para = [];
    }
    function flushList() {
      if (list) html.push("<" + list.tag + ">" + list.items.join("") + "</" + list.tag + ">");
      list = null;
    }

    lines.forEach(function (raw) {
      var line = raw.trim();
      var m;
      if (!line) {
        flushPara();
        flushList();
      } else if ((m = line.match(/^(#{2,3})\s+(.*)$/))) {
        flushPara();
        flushList();
        var level = m[1].length;
        html.push("<h" + level + ">" + inline(m[2]) + "</h" + level + ">");
      } else if (/^-{3,}$/.test(line)) {
        flushPara();
        flushList();
        html.push("<hr>");
      } else if ((m = line.match(/^&gt;\s?(.*)$/))) {
        flushPara();
        flushList();
        html.push("<blockquote><p>" + inline(m[1]) + "</p></blockquote>");
      } else if ((m = line.match(/^(?:[-*]|(\d+)\.)\s+(.*)$/))) {
        flushPara();
        var tag = m[1] ? "ol" : "ul";
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag: tag, items: [] };
        }
        list.items.push("<li>" + inline(m[2]) + "</li>");
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara();
    flushList();
    // Merge consecutive quote lines into one blockquote.
    return html.join("\n").replace(/<\/blockquote>\n<blockquote>/g, "");
  }

  // Status as students and barristers see it.
  function caseStatus(row) {
    return row.status === "new" && row.barrister_id ? "requested" : row.status;
  }

  function shortCategory(key) {
    return (CATEGORIES[key] || CATEGORIES.other).replace(/\s*\(.*\)$/, "");
  }

  function initials(name) {
    return String(name || "").split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (part) { return part.charAt(0).toUpperCase(); }).join("");
  }

  /* Public profile card. `action` is optional extra HTML (e.g. a button). */
  function barristerCard(b, action) {
    var photo = b.photo_url && /^https:\/\//.test(b.photo_url)
      ? '<img class="barrister__photo" src="' + esc(b.photo_url) + '" width="96" height="96" alt="Photo of ' + esc(b.full_name) + '" loading="lazy">'
      : '<span class="barrister__photo barrister__photo--initials" aria-hidden="true">' + esc(initials(b.full_name)) + "</span>";
    var areas = (b.areas || []).filter(function (a) { return CATEGORIES[a]; });
    return '<article class="barrister card">' + photo +
      '<div class="barrister__body">' +
      "<h3>" + esc(b.full_name) + "</h3>" +
      (b.level ? '<p class="barrister__level">' + esc(b.level) + "</p>" : "") +
      '<p class="barrister__availability barrister__availability--' + (b.active ? "on" : "off") + '">' +
      (b.active ? "Taking new cases" : "Not taking new cases right now") +
      (typeof b.open_cases === "number" ? " · " + b.open_cases + " active case" + (b.open_cases === 1 ? "" : "s") : "") +
      "</p>" +
      (areas.length ? '<ul class="barrister__areas" aria-label="Areas">' + areas.map(function (a) {
        return '<li class="tag">' + esc(shortCategory(a)) + "</li>";
      }).join("") + "</ul>" : "") +
      (b.bio ? '<p class="barrister__bio">' + esc(b.bio) + "</p>" : "") +
      (action || "") +
      "</div></article>";
  }

  function friendlyError(error) {
    if (!error) return "Something went wrong. Please try again.";
    // Messages raised deliberately by the database are written for students.
    if (error.code === "P0001" && error.message) return error.message;
    if (/fetch|network/i.test(error.message || "")) {
      return "We couldn't reach the server. Check your connection and try again.";
    }
    return "Something went wrong. Please try again, or email futobarassociationofficial@gmail.com.";
  }

  window.FBA = {
    db: db,
    CATEGORIES: CATEGORIES,
    STATUSES: STATUSES,
    esc: esc,
    formatDate: formatDate,
    monthKey: monthKey,
    monthLabel: monthLabel,
    markdown: markdown,
    caseStatus: caseStatus,
    shortCategory: shortCategory,
    barristerCard: barristerCard,
    friendlyError: friendlyError
  };
})();
