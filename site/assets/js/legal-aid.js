/* ==========================================================================
   FUTO Bar Association — legal aid clinic
   Case submission, barrister choice and status lookup. Everything goes
   through database functions (submit_case, choose_barrister, case_status);
   students never read the cases table.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;

  // Public profiles of barristers taking new cases, loaded once.
  var available = FBA.db.rpc("public_barristers").then(function (result) {
    return (result.data || []).filter(function (b) { return b.active; });
  });

  function barristerOptions(list, selected) {
    return list.map(function (b) {
      return '<option value="' + FBA.esc(b.id) + '"' + (b.id === selected ? " selected" : "") + ">" +
        FBA.esc(b.full_name + (b.level ? " (" + b.level + ")" : "")) + "</option>";
    }).join("");
  }

  function showStatus(form, message, kind) {
    var box = form.querySelector(".form__status");
    box.textContent = message;
    box.className = "form__status form__status--" + (kind || "error");
    box.hidden = !message;
  }

  function setBusy(form, busy, label) {
    var button = form.querySelector('[type="submit"]');
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.disabled = busy;
    button.textContent = busy ? label : button.dataset.label;
    form.setAttribute("aria-busy", busy ? "true" : "false");
  }

  // Report the first invalid field with its own label, and focus it.
  function firstInvalid(form) {
    var fields = form.querySelectorAll("input, select, textarea");
    for (var i = 0; i < fields.length; i++) {
      var field = fields[i];
      if (field.name === "website") continue;
      if (!field.checkValidity()) {
        var label = form.querySelector('label[for="' + field.id + '"]');
        return { field: field, label: label ? label.textContent : field.name };
      }
    }
    return null;
  }

  function digits(value) {
    return value.replace(/\s+/g, "");
  }

  /* ------------------------------------------------------------ submission */
  function initCaseForm() {
    var form = document.getElementById("case-form");
    var receipt = document.getElementById("case-receipt");
    if (!form) return;

    var select = form.querySelector("[data-categories]");
    Object.keys(FBA.CATEGORIES).forEach(function (key) {
      var option = document.createElement("option");
      option.value = key;
      option.textContent = FBA.CATEGORIES[key];
      select.appendChild(option);
    });

    var chooser = form.querySelector("[data-barrister-select]");
    var preview = form.querySelector("[data-barrister-preview]");
    var barristers = [];

    function showPreview() {
      var chosen = barristers.find(function (b) { return b.id === chooser.value; });
      preview.innerHTML = chosen ? FBA.barristerCard(chosen) : "";
    }

    available.then(function (list) {
      barristers = list;
      var wanted = new URLSearchParams(window.location.search).get("barrister");
      chooser.insertAdjacentHTML("beforeend", barristerOptions(list, wanted));
      showPreview();
    });
    chooser.addEventListener("change", showPreview);

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      showStatus(form, "");

      var invalid = firstInvalid(form);
      if (invalid) {
        showStatus(form, "Please check “" + invalid.label.trim() + "”: " + invalid.field.validationMessage);
        invalid.field.focus();
        return;
      }

      var data = new FormData(form);
      if (data.get("website")) return; // Honeypot filled: almost certainly a bot.

      var matric = digits(String(data.get("matric_number")));
      if (!/^\d{11}$/.test(matric)) {
        showStatus(form, "Enter your 11-digit FUTO matric (registration) number.");
        form.elements.matric_number.focus();
        return;
      }

      setBusy(form, true, "Submitting…");
      var result = await FBA.db.rpc("submit_case", {
        p_full_name: data.get("full_name"),
        p_matric_number: matric,
        p_department: data.get("department"),
        p_level: data.get("level"),
        p_email: data.get("email"),
        p_phone: data.get("phone"),
        p_category: data.get("category"),
        p_title: data.get("title"),
        p_description: data.get("description"),
        p_barrister_id: data.get("barrister_id") || null,
        p_judiciary_suit: data.get("judiciary_suit") || null
      });
      setBusy(form, false);

      if (result.error) {
        showStatus(form, FBA.friendlyError(result.error));
        return;
      }

      receipt.querySelector("[data-receipt-ref]").textContent = result.data;
      var chosen = barristers.find(function (b) { return b.id === data.get("barrister_id"); });
      receipt.querySelector("[data-receipt-next]").textContent = chosen
        ? "We've asked " + chosen.full_name + " to take your case. Check below to see when they accept."
        : "An FBA administrator will choose a barrister for you as soon as possible.";
      form.reset();
      showPreview();
      form.hidden = true;
      receipt.hidden = false;
      receipt.focus();

      // Pre-fill the status form so the student can check right away.
      var track = document.getElementById("status-form");
      if (track) {
        track.elements.reference.value = result.data;
        track.elements.matric_number.value = matric;
      }
    });

    receipt.querySelector("[data-receipt-again]").addEventListener("click", function () {
      receipt.hidden = true;
      form.hidden = false;
      form.elements.full_name.focus();
    });
  }

  /* ---------------------------------------------------------------- status */
  function renderStatus(row) {
    var steps = ["new", "requested", "assigned", "in_progress", "resolved"];
    var reached = row.status === "closed" ? steps.length - 1 : steps.indexOf(row.status);

    var html = '<p class="eyebrow">Case ' + FBA.esc(row.reference) + "</p>" +
      "<h3>" + FBA.esc(row.title) + "</h3>" +
      '<p><span class="badge badge--' + FBA.esc(row.status) + '">' +
      FBA.esc(FBA.STATUSES[row.status] || row.status) + "</span></p>" +
      '<ol class="progress" aria-label="Case progress">' +
      steps.map(function (step, i) {
        var state = i < reached ? "done" : i === reached ? "current" : "todo";
        return '<li class="progress__step progress__step--' + state + '"' +
          (state === "current" ? ' aria-current="step"' : "") + ">" +
          FBA.esc(row.status === "closed" && i === reached ? FBA.STATUSES.closed : FBA.STATUSES[step]) +
          "</li>";
      }).join("") +
      "</ol>";

    if (row.status === "requested") {
      html += '<div class="case-status__barrister"><h4>Waiting for your barrister</h4><p>We have asked <strong>' +
        FBA.esc(row.barrister_name) + "</strong> to take your case. Their contact details will appear here once they accept.</p></div>";
    } else if (row.barrister_name) {
      html += '<div class="case-status__barrister"><h4>Your student barrister</h4><p><strong>' +
        FBA.esc(row.barrister_name) + "</strong></p>";
      if (row.barrister_email) {
        html += '<p><a href="mailto:' + FBA.esc(row.barrister_email) + '">' + FBA.esc(row.barrister_email) + "</a></p>";
      }
      if (row.barrister_phone) {
        html += '<p><a href="tel:' + FBA.esc(row.barrister_phone.replace(/[^\d+]/g, "")) + '">' +
          FBA.esc(row.barrister_phone) + "</a></p>";
      }
      html += "</div>";
    }

    if (row.update_note) {
      html += '<div class="case-status__note"><h4>Latest update</h4><p>' + FBA.esc(row.update_note) + "</p></div>";
    }

    if (row.status === "new") {
      html += '<form class="case-status__choose" data-choose-form novalidate>' +
        '<h4>Choose a barrister</h4>' +
        "<p>No barrister has this case yet. Pick one now, or wait and the FBA will choose for you. " +
        '<a href="/barristers.html" target="_blank" rel="noopener">See profiles</a>.</p>' +
        '<div class="form__status" role="alert" aria-live="assertive" hidden></div>' +
        '<div class="field"><label for="choose-barrister">Barrister</label>' +
        '<select id="choose-barrister" name="barrister_id" required data-choose-select>' +
        '<option value="">Loading…</option></select></div>' +
        '<button class="btn btn--solid" type="submit">Ask this barrister</button></form>';
    }

    html += '<p class="field__hint">Submitted ' + FBA.esc(FBA.formatDate(row.submitted_at)) +
      " · Last updated " + FBA.esc(FBA.formatDate(row.updated_at, true)) + "</p>";
    return html;
  }

  function initStatusForm() {
    var form = document.getElementById("status-form");
    var out = document.getElementById("case-status");
    if (!form) return;

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      showStatus(form, "");
      out.hidden = true;

      var reference = form.elements.reference.value.trim();
      var matric = digits(form.elements.matric_number.value);
      if (!reference || !matric) {
        showStatus(form, "Enter both your reference number and your matric number.");
        (reference ? form.elements.matric_number : form.elements.reference).focus();
        return;
      }

      setBusy(form, true, "Checking…");
      var result = await FBA.db.rpc("case_status", {
        p_reference: reference,
        p_matric_number: matric
      });
      setBusy(form, false);

      if (result.error) {
        showStatus(form, FBA.friendlyError(result.error));
        return;
      }
      if (!result.data || !result.data.length) {
        showStatus(form, "We couldn't find a case with that reference and matric number. Check both and try again.");
        return;
      }

      out.innerHTML = renderStatus(result.data[0]);
      out.hidden = false;
      initChooser(out, reference, matric, function () { form.requestSubmit(); });
    });
  }

  // Lets a student whose case has no barrister (declined, or never chosen)
  // pick one from the status panel.
  function initChooser(out, reference, matric, refresh) {
    var chooseForm = out.querySelector("[data-choose-form]");
    if (!chooseForm) return;
    var select = chooseForm.querySelector("[data-choose-select]");

    available.then(function (list) {
      select.innerHTML = list.length
        ? '<option value="">Choose a barrister</option>' + barristerOptions(list)
        : '<option value="">No barristers are taking new cases right now</option>';
    });

    chooseForm.addEventListener("submit", async function (event) {
      event.preventDefault();
      showStatus(chooseForm, "");
      if (!select.value) {
        showStatus(chooseForm, "Choose a barrister first.");
        select.focus();
        return;
      }
      setBusy(chooseForm, true, "Sending…");
      var result = await FBA.db.rpc("choose_barrister", {
        p_reference: reference,
        p_matric_number: matric,
        p_barrister_id: select.value
      });
      setBusy(chooseForm, false);
      if (result.error) {
        showStatus(chooseForm, FBA.friendlyError(result.error));
        return;
      }
      refresh();
    });
  }

  initCaseForm();
  initStatusForm();
})();
