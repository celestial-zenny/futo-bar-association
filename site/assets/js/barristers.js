/* ==========================================================================
   FUTO Bar Association — barrister directory
   Public profiles from public_barristers(), which never includes contact
   details. "Choose" opens the case form with that barrister selected.
   ========================================================================== */
(function () {
  "use strict";

  var FBA = window.FBA;

  async function init() {
    var list = document.querySelector("[data-barrister-list]");
    var filter = document.querySelector("[data-area-filter]");
    if (!list) return;

    Object.keys(FBA.CATEGORIES).forEach(function (key) {
      var option = document.createElement("option");
      option.value = key;
      option.textContent = FBA.shortCategory(key);
      filter.appendChild(option);
    });

    var result = await FBA.db.rpc("public_barristers");
    list.setAttribute("aria-busy", "false");
    if (result.error) {
      list.innerHTML = "<p>" + FBA.esc(FBA.friendlyError(result.error)) + "</p>";
      return;
    }

    function render() {
      var area = filter.value;
      var shown = result.data.filter(function (b) {
        return !area || (b.areas || []).indexOf(area) > -1;
      });
      list.innerHTML = shown.length
        ? shown.map(function (b) {
            var first = FBA.esc(b.full_name.split(/\s+/)[0]);
            var action = b.active
              ? '<a class="btn btn--solid btn--small" href="/legal-aid.html?barrister=' +
                encodeURIComponent(b.id) + '#report">Choose ' + first + "</a>"
              : "";
            return FBA.barristerCard(b, action);
          }).join("")
        : "<p>No barristers are listed" + (area ? " for this area" : "") + " yet.</p>";
    }

    filter.addEventListener("change", render);
    render();
  }

  init();
})();
