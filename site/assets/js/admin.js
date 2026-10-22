/* ==========================================================================
   FUTO Bar Association — admin dashboard
   Sign-in, case assignment, barristers, blog posts and the case archive.
   Every write is checked again by row-level security in the database, so
   this page only decides what to show; it is not the security boundary.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;
  var db = FBA.db;
  var esc = FBA.esc;

  var state = { cases: [], barristers: [], posts: [], summaries: [] };

  /* --------------------------------------------------------------- helpers */
  function $(selector, root) {
    return (root || document).querySelector(selector);
  }

  function showView(name) {
    Array.prototype.forEach.call(document.querySelectorAll("[data-view]"), function (view) {
      view.hidden = view.getAttribute("data-view") !== name;
    });
  }

  function formStatus(form, message, kind) {
    var box = $(".form__status", form);
    box.textContent = message || "";
    box.className = "form__status form__status--" + (kind || "error");
    box.hidden = !message;
  }

  var toastTimer;
  function toast(message) {
    var el = $("[data-toast]");
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 3500);
  }

  function errorText(error) {
    if (error && error.code === "23505") return "That web address is already used by another post.";
    if (error && error.code === "23514") return "One of the fields is too short, too long or in the wrong format.";
    return (error && error.message) || "Something went wrong.";
  }

  function options(select, entries, selected) {
    select.innerHTML = entries.map(function (entry) {
      return '<option value="' + esc(entry[0]) + '"' + (entry[0] === (selected || "") ? " selected" : "") + ">" +
        esc(entry[1]) + "</option>";
    }).join("");
  }

  function slugify(text) {
    return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100).replace(/-+$/, "");
  }

  function emptyRow(cols, text) {
    return '<tr><td colspan="' + cols + '" class="admin-table__empty">' + esc(text) + "</td></tr>";
  }

  function badge(status) {
    return '<span class="badge badge--' + esc(status) + '">' + esc(FBA.STATUSES[status] || status) + "</span>";
  }

  function pubBadge(published) {
    return published ? '<span class="badge badge--resolved">Published</span>' : '<span class="badge badge--new">Draft</span>';
  }

  /* --------------------------------------------------------------- dialogs
     Each <dialog data-dialog="…"> holds one form. open() fills it from a
     record and resolves the save/delete through the handlers passed in. */
  function dialog(name) {
    var el = $('[data-dialog="' + name + '"]');
    var form = $("form", el);
    var handlers = {};

    $("[data-close]", el).addEventListener("click", function () { el.close(); });

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      formStatus(form, "");
      var invalid = Array.prototype.find.call(form.elements, function (f) {
        return f.willValidate && !f.checkValidity();
      });
      if (invalid) {
        var label = $('label[for="' + invalid.id + '"]', form);
        formStatus(form, (label ? label.textContent.trim() + ": " : "") + invalid.validationMessage);
        invalid.focus();
        return;
      }
      var button = $('[type="submit"]', form);
      button.disabled = true;
      var error = await handlers.save(values(form));
      button.disabled = false;
      if (error) {
        formStatus(form, errorText(error));
        return;
      }
      el.close();
    });

    var del = $("[data-delete]", el);
    if (del) {
      del.addEventListener("click", async function () {
        if (!window.confirm("Delete this permanently? This cannot be undone.")) return;
        var error = await handlers.remove();
        if (error) {
          formStatus(form, errorText(error));
          return;
        }
        el.close();
      });
    }

    return {
      el: el,
      form: form,
      open: function (record, onSave, onRemove) {
        handlers = { save: onSave, remove: onRemove };
        form.reset();
        formStatus(form, "");
        Array.prototype.forEach.call(form.elements, function (field) {
          if (!field.name || !(field.name in record)) return;
          if (field.type === "checkbox") field.checked = !!record[field.name];
          else field.value = record[field.name] == null ? "" : record[field.name];
        });
        if (del) del.hidden = !onRemove;
        el.showModal();
      }
    };
  }

  function values(form) {
    var out = {};
    Array.prototype.forEach.call(form.elements, function (field) {
      if (!field.name) return;
      if (field.type === "checkbox") out[field.name] = field.checked;
      else out[field.name] = field.value.trim() === "" ? null : field.value.trim();
    });
    return out;
  }

  var dialogs = {};

  /* ----------------------------------------------------------------- cases */
  function caseMatches(row, filter, query) {
    if (filter === "open" && (row.status === "resolved" || row.status === "closed")) return false;
    if (filter && filter !== "open" && row.status !== filter) return false;
    if (!query) return true;
    return [row.reference, row.full_name, row.matric_number, row.title, row.email]
      .join(" ").toLowerCase().indexOf(query) > -1;
  }

  function barristerName(id) {
    var b = state.barristers.find(function (x) { return x.id === id; });
    return b ? b.full_name : "";
  }

  function renderCases() {
    var filter = $("[data-case-filter]").value;
    var query = $("[data-case-search]").value.trim().toLowerCase();
    var rows = state.cases.filter(function (row) { return caseMatches(row, filter, query); });

    var waiting = state.cases.filter(function (row) { return row.status === "new"; }).length;
    $('[data-count="cases"]').textContent = waiting ? waiting + " new" : "";

    $("[data-cases-body]").innerHTML = rows.length
      ? rows.map(function (row) {
          return "<tr>" +
            '<td class="nowrap"><strong>' + esc(row.reference) + "</strong></td>" +
            '<td class="nowrap">' + esc(FBA.formatDate(row.created_at)) + "</td>" +
            "<td>" + esc(row.full_name) + '<br><span class="muted">' + esc(row.department) + ", " + esc(row.level) + "</span></td>" +
            "<td>" + esc(row.title) + '<br><span class="muted">' + esc(FBA.CATEGORIES[row.category] || row.category) + "</span></td>" +
            "<td>" + badge(row.status) + "</td>" +
            "<td>" + (row.barrister_id ? esc(barristerName(row.barrister_id)) : '<span class="muted">Unassigned</span>') + "</td>" +
            '<td><button class="btn btn--outline btn--small" type="button" data-open-case="' + esc(row.id) + '">Open</button></td>' +
            "</tr>";
        }).join("")
      : emptyRow(7, filter === "open" ? "No open cases." : "No cases match.");
  }

  function openCase(id) {
    var row = state.cases.find(function (x) { return x.id === id; });
    if (!row) return;
    var d = dialogs["case"];

    $('[data-field-text="reference"]', d.el).textContent = row.reference;
    var facts = [
      ["Student", row.full_name],
      ["Matric number", row.matric_number],
      ["Department / level", row.department + ", " + row.level],
      ["Email", row.email],
      ["Phone", row.phone],
      ["Category", FBA.CATEGORIES[row.category] || row.category],
      ["Submitted", FBA.formatDate(row.created_at, true)],
      ["Title", row.title],
      ["What happened", row.description]
    ];
    $("[data-case-facts]", d.el).innerHTML = facts.map(function (f) {
      return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
    }).join("");

    var choices = [["", "Not assigned"]].concat(state.barristers
      .filter(function (b) { return b.active || b.id === row.barrister_id; })
      .map(function (b) { return [b.id, b.full_name + (b.active ? "" : " (inactive)")]; }));
    options($("[data-barrister-options]", d.el), choices, row.barrister_id);
    options($("[data-status-options]", d.el), Object.keys(FBA.STATUSES).map(function (k) {
      return [k, FBA.STATUSES[k]];
    }), row.status);

    $("[data-case-summary]", d.el).onclick = function () {
      d.el.close();
      openSummary({ case_id: row.id, category: row.category, title: "", summary: "", outcome: "", published: false });
    };

    d.open(row, async function (v) {
      var patch = {
        barrister_id: v.barrister_id,
        status: v.status,
        update_note: v.update_note,
        admin_notes: v.admin_notes
      };
      var res = await db.from("cases").update(patch).eq("id", row.id).select().single();
      if (res.error) return res.error;
      Object.assign(row, res.data);
      renderCases();
      renderBarristers();
      toast("Case " + row.reference + " saved.");
    }, async function () {
      var res = await db.from("cases").delete().eq("id", row.id);
      if (res.error) return res.error;
      state.cases = state.cases.filter(function (x) { return x.id !== row.id; });
      renderCases();
      renderBarristers();
      toast("Case deleted.");
    });
  }

  /* ------------------------------------------------------------ barristers */
  function renderBarristers() {
    $("[data-barristers-body]").innerHTML = state.barristers.length
      ? state.barristers.map(function (b) {
          var open = state.cases.filter(function (c) {
            return c.barrister_id === b.id && c.status !== "resolved" && c.status !== "closed";
          }).length;
          return "<tr>" +
            "<td><strong>" + esc(b.full_name) + "</strong></td>" +
            "<td>" + esc(b.email || "") + (b.email && b.phone ? "<br>" : "") + esc(b.phone || "") + "</td>" +
            "<td>" + esc(b.level || "") + "</td>" +
            "<td>" + open + "</td>" +
            "<td>" + (b.active ? '<span class="badge badge--resolved">Available</span>' : '<span class="badge badge--closed">Inactive</span>') + "</td>" +
            '<td><button class="btn btn--outline btn--small" type="button" data-open-barrister="' + esc(b.id) + '">Edit</button></td>' +
            "</tr>";
        }).join("")
      : emptyRow(6, "No barristers yet. Add the first one to start assigning cases.");
  }

  function openBarrister(b) {
    var isNew = !b.id;
    dialogs.barrister.open(b, async function (v) {
      var res = isNew
        ? await db.from("barristers").insert(v).select().single()
        : await db.from("barristers").update(v).eq("id", b.id).select().single();
      if (res.error) return res.error;
      if (isNew) state.barristers.push(res.data);
      else Object.assign(b, res.data);
      state.barristers.sort(function (x, y) { return x.full_name.localeCompare(y.full_name); });
      renderBarristers();
      renderCases();
      toast("Barrister saved.");
    }, isNew ? null : async function () {
      var res = await db.from("barristers").delete().eq("id", b.id);
      if (res.error) return res.error;
      state.barristers = state.barristers.filter(function (x) { return x.id !== b.id; });
      state.cases.forEach(function (c) { if (c.barrister_id === b.id) c.barrister_id = null; });
      renderBarristers();
      renderCases();
      toast("Barrister deleted. Their cases are now unassigned.");
    });
  }

  /* ----------------------------------------------------------------- posts */
  function renderPosts() {
    $("[data-posts-body]").innerHTML = state.posts.length
      ? state.posts.map(function (p) {
          return "<tr>" +
            "<td><strong>" + esc(p.title) + '</strong><br><span class="muted">/post.html?slug=' + esc(p.slug) + "</span></td>" +
            "<td>" + (p.kind === "article" ? "Legal article" : "Blog") + "</td>" +
            "<td>" + pubBadge(p.published) + "</td>" +
            '<td class="nowrap">' + esc(FBA.formatDate(p.published_at || p.updated_at)) + "</td>" +
            '<td><button class="btn btn--outline btn--small" type="button" data-open-post="' + esc(p.id) + '">Edit</button></td>' +
            "</tr>";
        }).join("")
      : emptyRow(5, "No posts yet.");
  }

  function openPost(p) {
    var isNew = !p.id;
    var d = dialogs.post;
    var slugTouched = !isNew;
    var title = d.form.elements.title;
    var slug = d.form.elements.slug;

    title.oninput = function () { if (!slugTouched) slug.value = slugify(title.value); };
    slug.oninput = function () { slugTouched = true; };

    var preview = $("[data-preview]", d.el);
    var toggle = $("[data-preview-toggle]", d.el);
    var body = d.form.elements.body;
    preview.hidden = true;
    body.hidden = false;
    toggle.setAttribute("aria-pressed", "false");
    toggle.textContent = "Preview";
    toggle.onclick = function () {
      var on = toggle.getAttribute("aria-pressed") !== "true";
      toggle.setAttribute("aria-pressed", on ? "true" : "false");
      toggle.textContent = on ? "Edit" : "Preview";
      preview.innerHTML = FBA.markdown(body.value) || "<p><em>Nothing to preview yet.</em></p>";
      preview.hidden = !on;
      body.hidden = on;
    };

    var view = $("[data-view-link]", d.el);
    view.hidden = !(p.id && p.published);
    view.href = "/post.html?slug=" + encodeURIComponent(p.slug || "");

    d.open(p, async function (v) {
      v.author_name = v.author_name || "FUTO Bar Association";
      v.excerpt = v.excerpt || "";
      v.body = v.body || "";
      var res = isNew
        ? await db.from("posts").insert(v).select().single()
        : await db.from("posts").update(v).eq("id", p.id).select().single();
      if (res.error) return res.error;
      if (isNew) state.posts.unshift(res.data);
      else Object.assign(p, res.data);
      renderPosts();
      toast(res.data.published ? "Post saved and published." : "Draft saved.");
    }, isNew ? null : async function () {
      var res = await db.from("posts").delete().eq("id", p.id);
      if (res.error) return res.error;
      state.posts = state.posts.filter(function (x) { return x.id !== p.id; });
      renderPosts();
      toast("Post deleted.");
    });
  }

  /* ------------------------------------------------------------- summaries */
  function renderSummaries() {
    $("[data-summaries-body]").innerHTML = state.summaries.length
      ? state.summaries.map(function (s) {
          return "<tr>" +
            "<td><strong>" + esc(s.title) + "</strong></td>" +
            "<td>" + esc((FBA.CATEGORIES[s.category] || s.category).replace(/\s*\(.*\)$/, "")) + "</td>" +
            "<td>" + pubBadge(s.published) + "</td>" +
            '<td class="nowrap">' + esc(FBA.formatDate(s.published_at || s.updated_at)) + "</td>" +
            '<td><button class="btn btn--outline btn--small" type="button" data-open-summary="' + esc(s.id) + '">Edit</button></td>' +
            "</tr>";
        }).join("")
      : emptyRow(5, "No case summaries yet. Open a resolved case and choose “Write archive summary”.");
  }

  function openSummary(s) {
    var isNew = !s.id;
    options($("[data-category-options]", dialogs.summary.el), Object.keys(FBA.CATEGORIES).map(function (k) {
      return [k, FBA.CATEGORIES[k]];
    }), s.category || "other");

    dialogs.summary.open(s, async function (v) {
      v.outcome = v.outcome || "";
      if (isNew && s.case_id) v.case_id = s.case_id;
      var res = isNew
        ? await db.from("case_summaries").insert(v).select().single()
        : await db.from("case_summaries").update(v).eq("id", s.id).select().single();
      if (res.error) return res.error;
      if (isNew) state.summaries.unshift(res.data);
      else Object.assign(s, res.data);
      renderSummaries();
      toast(res.data.published ? "Summary saved and published." : "Summary saved as draft.");
    }, isNew ? null : async function () {
      var res = await db.from("case_summaries").delete().eq("id", s.id);
      if (res.error) return res.error;
      state.summaries = state.summaries.filter(function (x) { return x.id !== s.id; });
      renderSummaries();
      toast("Summary deleted.");
    });
  }

  /* ------------------------------------------------------------------ load */
  async function loadAll() {
    var results = await Promise.all([
      db.from("cases").select("*").order("created_at", { ascending: false }),
      db.from("barristers").select("*").order("full_name"),
      db.from("posts").select("*").order("created_at", { ascending: false }),
      db.from("case_summaries").select("*").order("created_at", { ascending: false })
    ]);
    var failed = results.find(function (r) { return r.error; });
    if (failed) {
      toast("Couldn't load everything: " + errorText(failed.error));
    }
    state.cases = results[0].data || [];
    state.barristers = results[1].data || [];
    state.posts = results[2].data || [];
    state.summaries = results[3].data || [];
    renderCases();
    renderBarristers();
    renderPosts();
    renderSummaries();
  }

  function initDashboard() {
    ["case", "barrister", "post", "summary"].forEach(function (name) {
      dialogs[name] = dialog(name);
    });

    var filter = $("[data-case-filter]");
    Object.keys(FBA.STATUSES).forEach(function (k) {
      var option = document.createElement("option");
      option.value = k;
      option.textContent = FBA.STATUSES[k];
      filter.appendChild(option);
    });
    filter.addEventListener("change", renderCases);
    $("[data-case-search]").addEventListener("input", renderCases);
    $("[data-refresh]").addEventListener("click", function () {
      loadAll().then(function () { toast("Refreshed."); });
    });

    document.addEventListener("click", function (event) {
      var t = event.target.closest("[data-open-case], [data-open-barrister], [data-open-post], [data-open-summary], [data-new]");
      if (!t) return;
      if (t.dataset.openCase) openCase(t.dataset.openCase);
      if (t.dataset.openBarrister) openBarrister(state.barristers.find(function (x) { return x.id === t.dataset.openBarrister; }));
      if (t.dataset.openPost) openPost(state.posts.find(function (x) { return x.id === t.dataset.openPost; }));
      if (t.dataset.openSummary) openSummary(state.summaries.find(function (x) { return x.id === t.dataset.openSummary; }));
      if (t.dataset["new"] === "barrister") openBarrister({ full_name: "", email: "", phone: "", level: "", active: true });
      if (t.dataset["new"] === "post") openPost({ title: "", slug: "", kind: "blog", author_name: "FUTO Bar Association", excerpt: "", body: "", published: false });
      if (t.dataset["new"] === "summary") openSummary({ title: "", category: "other", summary: "", outcome: "", published: false });
    });
  }

  /* ------------------------------------------------------------------ auth */
  var dashboardReady = false;

  async function route(session) {
    var user = $("[data-user]");
    if (!session) {
      user.hidden = true;
      showView("signin");
      return;
    }
    user.hidden = false;
    $("[data-user-email]").textContent = session.user.email;

    var check = await db.rpc("is_admin");
    if (check.error || !check.data) {
      showView("denied");
      return;
    }
    showView("dashboard");
    if (!dashboardReady) {
      dashboardReady = true;
      initDashboard();
    }
    loadAll();
  }

  function initAuth() {
    var signin = $("[data-signin-form]");
    signin.addEventListener("submit", async function (event) {
      event.preventDefault();
      formStatus(signin, "");
      var email = signin.elements.email.value.trim();
      var password = signin.elements.password.value;
      if (!email || !password) {
        formStatus(signin, "Enter your email and password.");
        return;
      }
      var res = await db.auth.signInWithPassword({ email: email, password: password });
      if (res.error) formStatus(signin, "Those details didn't work. Check your email and password.");
    });

    $("[data-forgot]").addEventListener("click", async function () {
      var email = signin.elements.email.value.trim();
      if (!email) {
        formStatus(signin, "Enter your email above first, then choose “Forgot password?”.");
        signin.elements.email.focus();
        return;
      }
      await db.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/admin/" });
      // Same message either way so the form can't be used to discover admin emails.
      formStatus(signin, "If that email belongs to an administrator, a reset link is on its way.", "ok");
    });

    var pw = $("[data-password-form]");
    pw.addEventListener("submit", async function (event) {
      event.preventDefault();
      var field = pw.elements.password;
      if (!field.checkValidity()) {
        formStatus(pw, "Use at least 10 characters.");
        return;
      }
      var res = await db.auth.updateUser({ password: field.value });
      if (res.error) {
        formStatus(pw, errorText(res.error));
        return;
      }
      toast("Password saved.");
      var s = await db.auth.getSession();
      route(s.data.session);
    });

    $("[data-sign-out]").addEventListener("click", function () {
      db.auth.signOut();
    });

    // Invite and recovery links land here with a token in the address bar.
    var needsPassword = /type=(invite|recovery)/.test(window.location.hash);

    db.auth.onAuthStateChange(function (event, session) {
      if (event === "PASSWORD_RECOVERY") needsPassword = true;
      // Defer: supabase-js warns against awaiting other calls inside this callback.
      setTimeout(function () {
        if (needsPassword && session) {
          needsPassword = false;
          showView("password");
          $("[data-user]").hidden = false;
          $("[data-user-email]").textContent = session.user.email;
          return;
        }
        if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "SIGNED_OUT") route(session);
      }, 0);
    });
  }

  initAuth();
})();
