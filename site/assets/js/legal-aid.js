/* ==========================================================================
   FUTO Bar Association — legal aid clinic
   Case submission and status lookup. Both go through database functions
   (submit_case, case_status); students never read the cases table.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;

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
        p_description: data.get("description")
      });
      setBusy(form, false);

      if (result.error) {
        showStatus(form, FBA.friendlyError(result.error));
        return;
      }

      receipt.querySelector("[data-receipt-ref]").textContent = result.data;
      form.reset();
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
    var steps = ["new", "assigned", "in_progress", "resolved"];
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

    if (row.barrister_name) {
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
    } else {
      html += "<p>No barrister has been assigned yet. Check back soon.</p>";
    }

    if (row.update_note) {
      html += '<div class="case-status__note"><h4>Latest update</h4><p>' + FBA.esc(row.update_note) + "</p></div>";
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
    });
  }

  initCaseForm();
  initStatusForm();
})();
