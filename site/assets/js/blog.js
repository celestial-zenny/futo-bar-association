/* ==========================================================================
   FUTO Bar Association — blog
   Renders the post list on /blog.html (filtered by ?kind= and ?month=) and a
   single post on /post.html?slug=…. Only published posts are visible to the
   public; row-level security enforces that in the database.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;
  var KIND_LABELS = { blog: "Blog", article: "Legal article" };
  var params = new URLSearchParams(window.location.search);

  function postUrl(slug) {
    return "/post.html?slug=" + encodeURIComponent(slug);
  }

  function postItem(post) {
    return '<li class="post-card">' +
      '<p class="post-card__meta"><span class="tag">' + FBA.esc(KIND_LABELS[post.kind] || post.kind) + "</span> " +
      '<time datetime="' + FBA.esc(post.published_at) + '">' + FBA.esc(FBA.formatDate(post.published_at)) + "</time></p>" +
      '<h3><a href="' + postUrl(post.slug) + '">' + FBA.esc(post.title) + "</a></h3>" +
      (post.excerpt ? "<p>" + FBA.esc(post.excerpt) + "</p>" : "") +
      '<p class="post-card__author">By ' + FBA.esc(post.author_name) + "</p>" +
      "</li>";
  }

  /* --------------------------------------------------------------- listing */
  async function initList(list) {
    // Both values are written into links, so accept only known shapes.
    var kind = KIND_LABELS[params.get("kind")] ? params.get("kind") : "";
    var month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.get("month") || "") ? params.get("month") : "";
    var heading = document.querySelector("[data-list-heading]");
    var months = document.querySelector("[data-month-list]");

    Array.prototype.forEach.call(document.querySelectorAll("[data-kind]"), function (chip) {
      var active = chip.getAttribute("data-kind") === kind;
      if (active) chip.setAttribute("aria-current", "page");
      if (month) chip.href += (chip.href.indexOf("?") > -1 ? "&" : "?") + "month=" + encodeURIComponent(month);
    });

    var result = await FBA.db
      .from("posts")
      .select("slug, kind, title, excerpt, author_name, published_at")
      .eq("published", true)
      .order("published_at", { ascending: false });

    list.setAttribute("aria-busy", "false");
    if (result.error) {
      list.innerHTML = '<li class="post-list__empty">' + FBA.esc(FBA.friendlyError(result.error)) + "</li>";
      months.innerHTML = "";
      return;
    }

    var posts = result.data;

    // Month archive in the sidebar counts every published post.
    var counts = {};
    posts.forEach(function (post) {
      var key = FBA.monthKey(post.published_at);
      counts[key] = (counts[key] || 0) + 1;
    });
    var keys = Object.keys(counts).sort().reverse();
    months.innerHTML = keys.length
      ? keys.map(function (key) {
          var href = "/blog.html?month=" + key + (kind ? "&kind=" + kind : "");
          return '<li><a href="' + href + '"' + (key === month ? ' aria-current="page"' : "") + ">" +
            FBA.esc(FBA.monthLabel(key)) + "</a> <span>(" + counts[key] + ")</span></li>";
        }).join("")
      : "<li>Nothing published yet.</li>";

    var shown = posts.filter(function (post) {
      return (!kind || post.kind === kind) && (!month || FBA.monthKey(post.published_at) === month);
    });

    if (month) {
      heading.hidden = false;
      heading.innerHTML = "Showing " + FBA.esc(FBA.monthLabel(month)) +
        ' · <a href="/blog.html' + (kind ? "?kind=" + kind : "") + '">Show all months</a>';
    }

    list.innerHTML = shown.length
      ? shown.map(postItem).join("")
      : '<li class="post-list__empty">No posts here yet. Check back soon.</li>';
  }

  /* ----------------------------------------------------------- single post */
  async function initPost(article) {
    var slug = params.get("slug");
    var title = article.querySelector("[data-post-title]");
    var body = article.querySelector("[data-post-body]");

    function notFound() {
      document.title = "Post not found | FUTO Bar Association";
      title.textContent = "Post not found";
      body.innerHTML = "<p>This post doesn't exist or is no longer published. " +
        '<a href="/blog.html">See all posts</a>.</p>';
      article.setAttribute("aria-busy", "false");
    }

    if (!slug) return notFound();

    var result = await FBA.db
      .from("posts")
      .select("slug, kind, title, excerpt, body, author_name, published_at, updated_at")
      .eq("slug", slug)
      .eq("published", true)
      .maybeSingle();

    if (result.error || !result.data) return notFound();
    var post = result.data;

    document.title = post.title + " | FUTO Bar Association";
    var description = document.querySelector('meta[name="description"]');
    if (description && post.excerpt) description.setAttribute("content", post.excerpt);
    var canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute("href", canonical.href.split("?")[0] + "?slug=" + encodeURIComponent(post.slug));

    article.querySelector("[data-post-crumb]").textContent = post.title;
    article.querySelector("[data-post-kind]").textContent = KIND_LABELS[post.kind] || post.kind;
    title.textContent = post.title;
    article.querySelector("[data-post-meta]").innerHTML =
      "By " + FBA.esc(post.author_name) + " · " +
      '<time datetime="' + FBA.esc(post.published_at) + '">' + FBA.esc(FBA.formatDate(post.published_at)) + "</time>";
    body.innerHTML = FBA.markdown(post.body);
    article.setAttribute("aria-busy", "false");
  }

  var list = document.querySelector("[data-post-list]");
  if (list) initList(list);
  var article = document.querySelector("[data-post]");
  if (article) initPost(article);
})();
