// What-If Preview
//
// Lets the user try a hypothetical transaction ("can we afford this Friday?")
// without saving it. Drafts are flagged `whatIf: true` and ride in the store's
// in-memory transactions map, so every existing balance walk — calendar cells,
// the 30-day Minimum, the snowball projection — sees them with no second
// implementation (see [[balance-walk-paths]]). _filterPersistedTransactions
// keeps them out of localStorage, exports, and cloud sync; they exist only
// until applied (committed as real transactions) or discarded.

class WhatIfUI {

  constructor(store, calculationService, onChange) {
    this.store = store;
    this.calculationService = calculationService;
    this.onChange = typeof onChange === "function" ? onChange : () => {};

    // 30-day minimum captured just before the first draft of a session, so the
    // banner can show "minimum $X → $Y" against the un-drafted plan.
    this._baselineMinimum = null;
    this._formBound = false;
    this._escHandler = null;
  }

  // ---- Draft form ---------------------------------------------------------

  openForm() {
    const modal = document.getElementById("whatIfModal");
    if (!modal) return;

    const dateInput = document.getElementById("whatIfDate");
    if (dateInput && !dateInput.value) {
      dateInput.value = Utils.formatDateString(new Date());
    }

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);
    this._bindForm(modal);

    const amountInput = document.getElementById("whatIfAmount");
    if (amountInput) {
      setTimeout(() => amountInput.focus(), 50);
    }
  }

  hideForm() {
    const modal = document.getElementById("whatIfModal");
    if (!modal) return;
    const activeEl = document.activeElement;
    if (activeEl && modal.contains(activeEl)) {
      activeEl.blur();
    }
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler, true);
      this._escHandler = null;
    }
  }

  _bindForm(modal) {
    if (!this._formBound) {
      const closeBtn = document.getElementById("whatIfClose");
      if (closeBtn) {
        const close = () => this.hideForm();
        closeBtn.addEventListener("click", close);
        closeBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            close();
          }
        });
      }
      const addBtn = document.getElementById("whatIfAddButton");
      if (addBtn) {
        addBtn.addEventListener("click", () => this.addDraft());
      }
      modal.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target && e.target.tagName === "INPUT") {
          e.preventDefault();
          this.addDraft();
        }
      });
      this._formBound = true;
    }

    if (!this._escHandler) {
      this._escHandler = (e) => {
        if (e.key !== "Escape") return;
        // Only the topmost modal handles Escape (matches the other modals).
        if (ModalManager.topModal() !== modal) return;
        this.hideForm();
      };
      document.addEventListener("keydown", this._escHandler, true);
    }
  }

  addDraft() {
    const date = document.getElementById("whatIfDate").value;
    const amount = parseFloat(document.getElementById("whatIfAmount").value);
    const type = document.getElementById("whatIfType").value;
    const description = document.getElementById("whatIfDescription").value.trim();

    if (!date || isNaN(amount) || amount <= 0) {
      Utils.showNotification("Please enter a valid date and amount", "error");
      return;
    }
    if (type !== "expense" && type !== "income") {
      Utils.showNotification("Draft must be an expense or income", "error");
      return;
    }

    // Capture the baseline before the first draft lands so the banner can
    // report the swing. calculateMinimum() reads the live store, which at this
    // point contains no drafts.
    if (this.store.getWhatIfTransactions().length === 0) {
      this._baselineMinimum = this.calculationService.calculateMinimum();
    }

    const draft = { amount, type, description };
    if (type === "expense") {
      // Always settled: a draft must not join the carried-forward unsettled
      // flow (it isn't real spending awaiting clearance).
      draft.settled = true;
    }
    this.store.addWhatIfTransaction(date, draft);

    document.getElementById("whatIfAmount").value = "";
    document.getElementById("whatIfDescription").value = "";
    this.hideForm();
    this.onChange();
  }

  // ---- Banner -------------------------------------------------------------

  // Called after every calendar render (app.updateUI) so the banner tracks the
  // live draft set — including drafts wiped by a sync merge replacing the
  // in-memory transactions map.
  refreshBanner() {
    const banner = document.getElementById("whatIfBanner");
    if (!banner) return;

    const drafts = this.store.getWhatIfTransactions();
    if (drafts.length === 0) {
      banner.hidden = true;
      banner.innerHTML = "";
      this._baselineMinimum = null;
      return;
    }

    const currentMinimum = this.calculationService.calculateMinimum();
    const minClass = (v) => (v <= 0 ? "what-if-min-negative" : "");
    const minHtml =
      this._baselineMinimum !== null
        ? `30-day minimum <span class="${minClass(this._baselineMinimum)}">$${this._baselineMinimum.toFixed(2)}</span>
           → <span class="${minClass(currentMinimum)}">$${currentMinimum.toFixed(2)}</span>`
        : `30-day minimum <span class="${minClass(currentMinimum)}">$${currentMinimum.toFixed(2)}</span>`;

    const itemsHtml = drafts
      .map(({ date, transaction }) => {
        const sign = transaction.type === "income" ? "+" : "-";
        const desc = transaction.description
          ? Utils.escapeHtml(transaction.description)
          : transaction.type === "income" ? "Income" : "Expense";
        return `<span class="what-if-chip">${desc} ${sign}$${transaction.amount.toFixed(2)} · ${Utils.formatDisplayDate(date)}</span>`;
      })
      .join(" ");

    banner.innerHTML = `
      <span class="what-if-banner-label">🔮 What-if preview</span>
      <span class="what-if-banner-items">${itemsHtml}</span>
      <span class="what-if-banner-minimum">${minHtml}</span>
      <span class="what-if-banner-actions">
        <button type="button" class="what-if-btn" data-act="add">Add another</button>
        <button type="button" class="what-if-btn what-if-btn-apply" data-act="apply">Apply</button>
        <button type="button" class="what-if-btn" data-act="discard">Discard</button>
      </span>
    `;
    banner.hidden = false;

    banner.querySelectorAll(".what-if-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        if (act === "add") this.openForm();
        else if (act === "apply") this.applyAll();
        else if (act === "discard") this.discardAll();
      });
    });
  }

  applyAll() {
    const count = this.store.applyWhatIfTransactions();
    this._baselineMinimum = null;
    this.onChange();
    Utils.showNotification(
      `Applied ${count} draft transaction${count === 1 ? "" : "s"}`
    );
  }

  discardAll() {
    this.store.clearWhatIfTransactions();
    this._baselineMinimum = null;
    this.onChange();
    Utils.showNotification("What-if preview discarded");
  }
}
