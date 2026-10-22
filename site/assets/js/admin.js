/* ==========================================================================
   FUTO Bar Association — portal for admins and barristers
   Admins: cases, barristers (with login invites), posts and the case archive.
   Barristers: accept or decline requests, update their cases and profile.
   Every write is checked again by row-level security in the database, so
   this page only decides what to show; it is not the security boundary.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;
  var db = FBA.db;
  var esc = FBA.esc;

  var state = { cases: [], barristers: [], posts: [], summaries: [], mine: [], me: null };
  var PHOTO_BUCKET = "barrister-photos";

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

  // Area checkboxes are built here and read back by areasFrom(), because the
  // generic form helpers only handle one value per field name.
  function renderAreas(box, selected) {
    box.innerHTML = Object.keys(FBA.CATEGORIES).map(function (key) {
      var id = (box.closest("[data-dialog]") ? "bd" : "mp") + "-area-" + key;
      return '<div class="field--check"><input type="checkbox" id="' + id + '" data-area="' + key + '"' +
        ((selected || []).indexOf(key) > -1 ? " checked" : "") + '><label for="' + id + '">' +
        esc(FBA.shortCategory(key)) + "</label></div>";
    }).join("");
  }

  function areasFrom(box) {
    return Array.prototype.filter.call(box.querySelectorAll("[data-area]"), function (c) { return c.checked; })
      .map(function (c) { return c.getAttribute("data-area"); });
  }

  function photoPreview(box, url, name) {
    box.innerHTML = url
      ? '<img class="barrister__photo" src="' + esc(url) + '" width="96" height="96" alt="Current photo of ' + esc(name || "barrister") + '">'
      : '<span class="barrister__photo barrister__photo--initials" aria-hidden="true">?</span>';
  }

  // Uploads a chosen photo and returns its public URL, or null if none chosen.
  async function uploadPhoto(input, folder) {
    var file = input.files && input.files[0];
    if (!file) return { url: null };
    if (file.size > 2 * 1024 * 1024) return { error: { message: "That photo is larger than 2 MB." } };
    var ext = (file.type.split("/")[1] || "jpg").replace("jpeg", "jpg");
    var path = folder + "/" + Date.now() + "." + ext;
    var up = await db.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type });
    if (up.error) return { error: up.error };
    return { url: db.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl };
  }

  async function functionError(error) {
    try {
      var body = await error.context.json();
      return { message: body.error || error.message };
    } catch (e) {
      return error;
    }
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
    if (filter && filter !== "open" && FBA.caseStatus(row) !== filter) return false;
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

    var waiting = state.cases.filter(function (row) { return FBA.caseStatus(row) === "new"; }).length;
    $('[data-count="cases"]').textContent = waiting ? waiting + " new" : "";

    $("[data-cases-body]").innerHTML = rows.length
      ? rows.map(function (row) {
          return "<tr>" +
            '<td class="nowrap"><strong>' + esc(row.reference) + "</strong></td>" +
            '<td class="nowrap">' + esc(FBA.formatDate(row.created_at)) + "</td>" +
            "<td>" + esc(row.full_name) + '<br><span class="muted">' + esc(row.department) + ", " + esc(row.level) + "</span></td>" +
            "<td>" + esc(row.title) + '<br><span class="muted">' + esc(FBA.CATEGORIES[row.category] || row.category) + "</span></td>" +
            "<td>" + badge(FBA.caseStatus(row)) + "</td>" +
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
      ["SUG Judiciary suit no.", row.judiciary_suit_number || "Not filed / not given"],
      ["Title", row.title],
      ["What happened", row.description]
    ];
    if (row.barrister_note) facts.push(["Barrister's notes", row.barrister_note]);
    $("[data-case-facts]", d.el).innerHTML = facts.map(function (f) {
      return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
    }).join("");

    var choices = [["", "Not assigned"]].concat(state.barristers
      .filter(function (b) { return b.active || b.id === row.barrister_id; })
      .map(function (b) { return [b.id, b.full_name + (b.active ? "" : " (inactive)")]; }));
    options($("[data-barrister-options]", d.el), choices, row.barrister_id);
    options($("[data-status-options]", d.el), Object.keys(FBA.STATUSES).filter(function (k) {
      return k !== "requested";
    }).map(function (k) {
      return [k, FBA.STATUSES[k]];
    }), row.status);

    var requested = $("[data-case-requested]", d.el);
    requested.hidden = FBA.caseStatus(row) !== "requested";
    requested.textContent = "The student chose " + barristerName(row.barrister_id) +
      ", who hasn't accepted yet. Choosing a different barrister here assigns the case to them directly.";

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
          var level = b.level ? '<br><span class="muted">' + esc(b.level) + "</span>" : "";
          return "<tr>" +
            "<td><strong>" + esc(b.full_name) + "</strong>" + level + "</td>" +
            "<td>" + esc(b.email || "") + (b.email && b.phone ? "<br>" : "") + esc(b.phone || "") + "</td>" +
            "<td>" + (b.user_id ? '<span class="badge badge--resolved">Linked</span>'
              : b.email ? '<span class="muted">Not signed in yet</span>' : '<span class="muted">No email</span>') + "</td>" +
            "<td>" + open + "</td>" +
            "<td>" + (b.active ? '<span class="badge badge--resolved">Available</span>' : '<span class="badge badge--closed">Inactive</span>') + "</td>" +
            '<td><button class="btn btn--outline btn--small" type="button" data-open-barrister="' + esc(b.id) + '">Edit</button></td>' +
            "</tr>";
        }).join("")
      : emptyRow(6, "No barristers yet. Add the first one to start assigning cases.");
  }

  function openBarrister(b) {
    var isNew = !b.id;
    var d = dialogs.barrister;
    var photoInput = $("[data-photo-input]", d.el);
    var areas = $("[data-areas]", d.el);

    d.open(b, async function (v) {
      var photo = await uploadPhoto(photoInput, "admin");
      if (photo.error) return photo.error;
      v.areas = areasFrom(areas);
      v.bio = v.bio || "";
      if (photo.url) v.photo_url = photo.url;
      if (v.email) v.email = v.email.toLowerCase();
      var res = isNew
        ? await db.from("barristers").insert(v).select().single()
        : await db.from("barristers").update(v).eq("id", b.id).select().single();
      if (res.error) return res.error;
      if (isNew) state.barristers.push(res.data);
      else Object.assign(b, res.data);
      state.barristers.sort(function (x, y) { return x.full_name.localeCompare(y.full_name); });
      renderBarristers();
      renderCases();
      toast(isNew && res.data.email ? "Barrister saved. Open them again to send a login invite." : "Barrister saved.");
    }, isNew ? null : async function () {
      var res = await db.from("barristers").delete().eq("id", b.id);
      if (res.error) return res.error;
      state.barristers = state.barristers.filter(function (x) { return x.id !== b.id; });
      state.cases.forEach(function (c) { if (c.barrister_id === b.id) c.barrister_id = null; });
      renderBarristers();
      renderCases();
      toast("Barrister deleted. Their cases are now unassigned.");
    });

    // After open(): it resets the form, which would clear these.
    renderAreas(areas, b.areas);
    photoPreview($("[data-photo-preview]", d.el), b.photo_url, b.full_name);

    var login = $("[data-login-box]", d.el);
    if (b.user_id) {
      login.innerHTML = "<p><strong>Login linked.</strong> " + esc(b.full_name) +
        " signs in at <a href=\"/admin/\">/admin/</a> to accept cases and edit their profile.</p>";
    } else if (!isNew && b.email) {
      login.innerHTML = "<p>No login yet. Send an invite to <strong>" + esc(b.email) +
        '</strong>; they set a password from the email and can then accept cases.</p>' +
        '<button class="btn btn--outline btn--small" type="button" data-send-invite>Send login invite</button>';
      $("[data-send-invite]", login).onclick = async function () {
        this.disabled = true;
        var res = await db.functions.invoke("invite-user", {
          body: { email: b.email, role: "barrister", redirect_to: window.location.origin + "/admin/" }
        });
        this.disabled = false;
        if (res.error) {
          formStatus(d.form, errorText(await functionError(res.error)));
          return;
        }
        formStatus(d.form, res.data.message, "ok");
      };
    } else {
      login.innerHTML = '<p class="field__hint">Add an email address and save to be able to send a login invite.</p>';
    }
  }

  function openInviteAdmin() {
    dialogs.invite.open({ full_name: "", email: "" }, async function (v) {
      var res = await db.functions.invoke("invite-user", {
        body: { email: v.email, full_name: v.full_name, role: "admin", redirect_to: window.location.origin + "/admin/" }
      });
      if (res.error) return functionError(res.error);
      toast(res.data.message);
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
    ["case", "barrister", "post", "summary", "invite"].forEach(function (name) {
      dialogs[name] = dialog(name);
    });
    $("[data-invite-admin]").addEventListener("click", openInviteAdmin);

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
      if (t.dataset["new"] === "barrister") openBarrister({ full_name: "", email: "", phone: "", level: "", bio: "", areas: [], active: true });
      if (t.dataset["new"] === "post") openPost({ title: "", slug: "", kind: "blog", author_name: "FUTO Bar Association", excerpt: "", body: "", published: false });
      if (t.dataset["new"] === "summary") openSummary({ title: "", category: "other", summary: "", outcome: "", published: false });
    });
  }

  /* --------------------------------------------------------- barrister view */
  var barristerReady = false;

  function caseFacts(row) {
    var facts = [
      ["Category", FBA.CATEGORIES[row.category] || row.category],
      ["Submitted", FBA.formatDate(row.created_at, true)],
      ["Student", row.full_name + " · " + row.department + ", " + row.level],
      ["Matric number", row.matric_number]
    ];
    if (row.email) facts.push(["Email", row.email], ["Phone", row.phone]);
    if (row.judiciary_suit_number) facts.push(["SUG Judiciary suit no.", row.judiciary_suit_number]);
    facts.push(["Title", row.title], ["What happened", row.description]);
    return facts.map(function (f) {
      return "<div><dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd></div>";
    }).join("");
  }

  function renderMine() {
    var requests = state.mine.filter(function (c) { return c.status === "requested"; });
    var mine = state.mine.filter(function (c) { return c.status !== "requested"; });
    $('[data-count="requests"]').textContent = requests.length ? String(requests.length) : "";

    $("[data-requests]").innerHTML = requests.length
      ? requests.map(function (c) {
          return '<article class="card request">' +
            '<p class="post-card__meta"><span class="tag">' + esc(FBA.shortCategory(c.category)) + "</span> " +
            esc(c.reference) + " · " + esc(FBA.formatDate(c.created_at)) + "</p>" +
            '<dl class="case-facts">' + caseFacts(c) + "</dl>" +
            '<div class="form__actions">' +
            '<button class="btn btn--solid" type="button" data-accept="' + esc(c.id) + '">Accept case</button>' +
            '<button class="btn btn--outline" type="button" data-decline="' + esc(c.id) + '">Decline</button>' +
            "</div></article>";
        }).join("")
      : '<p class="post-list__empty">No requests right now. Students who choose you will appear here.</p>';

    $("[data-mycases]").innerHTML = mine.length
      ? mine.map(function (c) {
          return '<article class="card request">' +
            '<p class="post-card__meta">' + badge(c.status) + " " + esc(c.reference) + "</p>" +
            "<h3>" + esc(c.title) + "</h3>" +
            "<p>" + esc(c.full_name) + " · " + esc(c.phone || "") + "</p>" +
            '<button class="btn btn--outline btn--small" type="button" data-open-mine="' + esc(c.id) + '">Open</button>' +
            "</article>";
        }).join("")
      : '<p class="post-list__empty">You have no accepted cases yet.</p>';
  }

  function fillProfile() {
    var form = $("[data-profile-form]");
    var me = state.me;
    ["full_name", "level", "bio", "email", "phone"].forEach(function (k) {
      form.elements[k].value = me[k] || "";
    });
    form.elements.active.checked = !!me.active;
    renderAreas($("[data-areas]", form), me.areas);
    photoPreview($("[data-photo-preview]", form), me.photo_url, me.full_name);
  }

  async function loadMine() {
    var results = await Promise.all([
      db.rpc("barrister_cases"),
      db.from("barristers").select("*").eq("id", state.myId).single()
    ]);
    if (results[0].error || results[1].error) {
      toast("Couldn't load everything: " + errorText(results[0].error || results[1].error));
    }
    state.mine = results[0].data || [];
    if (results[1].data) state.me = results[1].data;
    renderMine();
    if (state.me) fillProfile();
  }

  function openMine(id) {
    var row = state.mine.find(function (c) { return c.id === id; });
    if (!row) return;
    var d = dialogs.mycase;
    $('[data-field-text="reference"]', d.el).textContent = row.reference;
    $("[data-case-facts]", d.el).innerHTML = caseFacts(row);
    d.open(row, async function (v) {
      var res = await db.rpc("barrister_update_case", {
        p_case_id: row.id, p_status: v.status, p_update_note: v.update_note, p_barrister_note: v.barrister_note
      });
      if (res.error) return res.error;
      Object.assign(row, { status: v.status, update_note: v.update_note, barrister_note: v.barrister_note });
      renderMine();
      toast("Case " + row.reference + " updated.");
    });
  }

  async function respond(id, accept) {
    var message = null;
    if (accept) {
      if (!window.confirm("Accept this case? The student will see your email and phone number.")) return;
    } else {
      message = window.prompt("Decline this case? Optionally tell the student why (they'll be asked to choose someone else):", "");
      if (message === null) return;
    }
    var res = await db.rpc("barrister_respond", { p_case_id: id, p_accept: accept, p_message: message });
    if (res.error) {
      toast(errorText(res.error));
      return;
    }
    toast(accept ? "Case accepted. It's now under My cases." : "Case declined.");
    loadMine();
  }

  function initBarristerView() {
    dialogs.mycase = dialog("mycase");
    document.addEventListener("click", function (event) {
      var t = event.target.closest("[data-accept], [data-decline], [data-open-mine]");
      if (!t) return;
      if (t.dataset.accept) respond(t.dataset.accept, true);
      if (t.dataset.decline) respond(t.dataset.decline, false);
      if (t.dataset.openMine) openMine(t.dataset.openMine);
    });

    var form = $("[data-profile-form]");
    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      formStatus(form, "");
      var email = form.elements.email;
      if (!email.checkValidity()) {
        formStatus(form, "Email: " + email.validationMessage);
        email.focus();
        return;
      }
      var button = $('[type="submit"]', form);
      button.disabled = true;
      var session = (await db.auth.getSession()).data.session;
      var photo = await uploadPhoto($("[data-photo-input]", form), session.user.id);
      if (photo.error) {
        button.disabled = false;
        formStatus(form, errorText(photo.error));
        return;
      }
      var res = await db.rpc("barrister_update_profile", {
        p_level: form.elements.level.value,
        p_bio: form.elements.bio.value,
        p_areas: areasFrom($("[data-areas]", form)),
        p_email: form.elements.email.value,
        p_phone: form.elements.phone.value,
        p_photo_url: photo.url || state.me.photo_url || null,
        p_active: form.elements.active.checked
      });
      button.disabled = false;
      if (res.error) {
        formStatus(form, errorText(res.error));
        return;
      }
      $("[data-photo-input]", form).value = "";
      toast("Profile saved.");
      loadMine();
    });
  }

  /* ------------------------------------------------------------------ auth */
  var dashboardReady = false;

  function showBarrister() {
    showView("barrister");
    if (!barristerReady) {
      barristerReady = true;
      initBarristerView();
    }
    loadMine();
  }

  function showAdmin() {
    showView("dashboard");
    if (!dashboardReady) {
      dashboardReady = true;
      initDashboard();
    }
    loadAll();
  }

  async function route(session) {
    var user = $("[data-user]");
    var switcher = $("[data-switch-view]");
    if (!session) {
      user.hidden = true;
      showView("signin");
      return;
    }
    user.hidden = false;
    $("[data-user-email]").textContent = session.user.email;

    // Links a newly invited barrister to their profile on first sign-in.
    var results = await Promise.all([db.rpc("claim_barrister_profile"), db.rpc("is_admin")]);
    state.myId = results[0].data || null;
    var isAdmin = !results[1].error && results[1].data === true;

    switcher.hidden = !(isAdmin && state.myId);
    switcher.onclick = function () {
      var toBarrister = !$('[data-view="barrister"]').hidden ? false : true;
      switcher.textContent = toBarrister ? "Admin view" : "Barrister view";
      if (toBarrister) showBarrister();
      else showAdmin();
    };

    if (isAdmin) showAdmin();
    else if (state.myId) showBarrister();
    else showView("denied");
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
