/* ==========================================================================
   FUTO Bar Association — archive
   Published, anonymised case summaries plus every published post grouped by
   month.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;

  function shortCategory(key) {
    var label = FBA.CATEGORIES[key] || FBA.CATEGORIES.other;
    return label.replace(/\s*\(.*\)$/, "");
  }

  async function initCases() {
    var list = document.querySelector("[data-summary-list]");
    var filter = document.querySelector("[data-case-filter]");
    if (!list) return;

    Object.keys(FBA.CATEGORIES).forEach(function (key) {
      var option = document.createElement("option");
      option.value = key;
      option.textContent = shortCategory(key);
      filter.appendChild(option);
    });

    var result = await FBA.db
      .from("case_summaries")
      .select("id, title, category, summary, outcome, published_at")
      .eq("published", true)
      .order("published_at", { ascending: false });

    list.setAttribute("aria-busy", "false");
    if (result.error) {
      list.innerHTML = '<li class="post-list__empty">' + FBA.esc(FBA.friendlyError(result.error)) + "</li>";
      return;
    }

    function render() {
      var shown = result.data.filter(function (row) {
        return !filter.value || row.category === filter.value;
      });
      list.innerHTML = shown.length
        ? shown.map(function (row) {
            return '<li class="summary card">' +
              '<p class="post-card__meta"><span class="tag">' + FBA.esc(shortCategory(row.category)) + "</span> " +
              '<time datetime="' + FBA.esc(row.published_at) + '">' + FBA.esc(FBA.formatDate(row.published_at)) + "</time></p>" +
              "<h3>" + FBA.esc(row.title) + "</h3>" +
              '<div class="prose">' + FBA.markdown(row.summary) + "</div>" +
              (row.outcome ? '<p class="summary__outcome"><strong>Outcome:</strong> ' + FBA.esc(row.outcome) + "</p>" : "") +
              "</li>";
          }).join("")
        : '<li class="post-list__empty">No case summaries have been published' +
          (filter.value ? " in this category" : "") + " yet.</li>";
    }

    filter.addEventListener("change", render);
    render();
  }

  async function initArticles() {
    var box = document.querySelector("[data-article-archive]");
    if (!box) return;

    var result = await FBA.db
      .from("posts")
      .select("slug, kind, title, published_at")
      .eq("published", true)
      .order("published_at", { ascending: false });

    box.setAttribute("aria-busy", "false");
    if (result.error) {
      box.innerHTML = "<p>" + FBA.esc(FBA.friendlyError(result.error)) + "</p>";
      return;
    }
    if (!result.data.length) {
      box.innerHTML = "<p>Nothing has been published yet.</p>";
      return;
    }

    var groups = {};
    result.data.forEach(function (post) {
      var key = FBA.monthKey(post.published_at);
      (groups[key] = groups[key] || []).push(post);
    });

    box.innerHTML = Object.keys(groups).sort().reverse().map(function (key) {
      return '<div class="month card"><h3><a href="/blog.html?month=' + key + '">' +
        FBA.esc(FBA.monthLabel(key)) + "</a></h3><ul>" +
        groups[key].map(function (post) {
          return '<li><a href="/post.html?slug=' + encodeURIComponent(post.slug) + '">' + FBA.esc(post.title) + "</a>" +
            (post.kind === "article" ? ' <span class="tag">Article</span>' : "") + "</li>";
        }).join("") +
        "</ul></div>";
    }).join("");
  }

  initCases();
  initArticles();
})();
