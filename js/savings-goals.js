// Savings Goals
//
// Goal = { id, name, targetAmount, targetDate, saved, _lastModified }, stored
// in TransactionStore.savingsGoals (persisted, exported, and cloud-synced like
// cashInfusions). Progress is tracked manually ("Add saved"); the feasibility
// line reuses the calendar's own balance walk via
// CalculationService.getMinimumBalanceThrough: the projected spare through the
// target date is the lowest projected balance minus the snowball daily floor —
// i.e. how much could leave checking before then without dipping below the
// floor on any day.

class SavingsGoalsUI {

  constructor(store, calculationService, onChange) {
    this.store = store;
    this.calculationService = calculationService;
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    this._closeBound = false;
    this._escHandler = null;
    this._editingId = null;
  }

  // ---- Modal lifecycle ----------------------------------------------------

  show() {
    const modal = document.getElementById("savingsGoalsModal");
    if (!modal) return;
    this._editingId = null;
    this._renderList();
    this._hideForm();
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);

    if (!this._closeBound) {
      const closeBtn = document.getElementById("savingsGoalsClose");
      if (closeBtn) {
        const close = () => this.hide();
        closeBtn.addEventListener("click", close);
        closeBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            close();
          }
        });
      }
      const addBtn = document.getElementById("savingsGoalAddButton");
      if (addBtn) {
        addBtn.addEventListener("click", () => this._showForm(null));
      }
      const saveBtn = document.getElementById("savingsGoalSaveButton");
      if (saveBtn) {
        saveBtn.addEventListener("click", () => this._saveForm());
      }
      const cancelBtn = document.getElementById("savingsGoalCancelButton");
      if (cancelBtn) {
        cancelBtn.addEventListener("click", () => this._hideForm());
      }
      this._closeBound = true;
    }

    if (!this._escHandler) {
      this._escHandler = (e) => {
        if (e.key !== "Escape") return;
        // Only the topmost modal handles Escape (matches the other modals).
        if (ModalManager.topModal() !== modal) return;
        this.hide();
      };
      document.addEventListener("keydown", this._escHandler, true);
    }
  }

  hide() {
    const modal = document.getElementById("savingsGoalsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler, true);
      this._escHandler = null;
    }
  }

  // ---- Goal list ----------------------------------------------------------

  _renderList() {
    const list = document.getElementById("savingsGoalsList");
    if (!list) return;

    const goals = [...this.store.getSavingsGoals()].sort((a, b) =>
      (a.targetDate || "") < (b.targetDate || "") ? -1 : 1
    );

    list.innerHTML = "";
    if (goals.length === 0) {
      const empty = document.createElement("p");
      empty.className = "recent-transactions-empty";
      empty.textContent = "No savings goals yet.";
      list.appendChild(empty);
      return;
    }

    const todayStr = Utils.formatDateString(new Date());
    const floor = Number(this.store.getDebtSnowballSettings().dailyFloor) || 0;

    goals.forEach((goal) => {
      const remaining = Math.max(
        0,
        Math.round((goal.targetAmount - goal.saved) * 100) / 100
      );
      const pct = goal.targetAmount > 0
        ? Math.min(100, Math.round((goal.saved / goal.targetAmount) * 100))
        : 0;

      let statusHtml = "";
      if (remaining === 0) {
        statusHtml = `<span class="savings-goal-status funded">Fully funded 🎉</span>`;
      } else if (!goal.targetDate || goal.targetDate <= todayStr) {
        statusHtml = `<span class="savings-goal-status short">$${remaining.toFixed(2)} to go — target date ${goal.targetDate ? "passed" : "not set"}</span>`;
      } else {
        const monthsLeft = Math.max(
          1,
          Math.ceil(
            (Utils.parseDateString(goal.targetDate) - new Date()) /
              (30.44 * 86400000)
          )
        );
        const perMonth = remaining / monthsLeft;
        const minThrough = this.calculationService.getMinimumBalanceThrough(
          goal.targetDate
        );
        let feasibilityHtml = "";
        if (minThrough !== null) {
          const spare = Math.round((minThrough - floor) * 100) / 100;
          feasibilityHtml =
            spare >= remaining
              ? `<span class="savings-goal-status ontrack">On track — projected spare through ${Utils.formatDisplayDate(goal.targetDate)} is $${spare.toFixed(2)}${floor > 0 ? ` (above your $${floor.toFixed(2)} floor)` : ""}</span>`
              : `<span class="savings-goal-status short">Tight — projected spare through ${Utils.formatDisplayDate(goal.targetDate)} is $${Math.max(0, spare).toFixed(2)} of the $${remaining.toFixed(2)} still needed</span>`;
        }
        statusHtml = `
          <span class="savings-goal-need">$${remaining.toFixed(2)} to go · about $${perMonth.toFixed(2)}/month for ${monthsLeft} month${monthsLeft === 1 ? "" : "s"}</span>
          ${feasibilityHtml}`;
      }

      const row = document.createElement("div");
      row.className = "savings-goal-row";
      row.setAttribute("role", "listitem");
      row.innerHTML = `
        <div class="savings-goal-head">
          <span class="savings-goal-name">${Utils.escapeHtml(goal.name || "(unnamed goal)")}</span>
          <span class="savings-goal-figures">$${goal.saved.toFixed(2)} of $${goal.targetAmount.toFixed(2)}${goal.targetDate ? ` by ${Utils.formatDisplayDate(goal.targetDate)}` : ""}</span>
        </div>
        <div class="savings-goal-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <div class="savings-goal-bar-fill" style="width: ${pct}%"></div>
        </div>
        <div class="savings-goal-detail">${statusHtml}</div>
        <div class="savings-goal-actions">
          <button type="button" class="secondary-button" data-act="contribute">Add saved</button>
          <button type="button" class="secondary-button" data-act="edit">Edit</button>
          <button type="button" class="secondary-button" data-act="delete">Delete</button>
        </div>
      `;

      row.querySelector('[data-act="contribute"]').addEventListener("click", () =>
        this._contribute(goal.id)
      );
      row.querySelector('[data-act="edit"]').addEventListener("click", () =>
        this._showForm(goal)
      );
      row.querySelector('[data-act="delete"]').addEventListener("click", () =>
        this._delete(goal.id)
      );

      list.appendChild(row);
    });
  }

  // ---- Actions ------------------------------------------------------------

  async _contribute(goalId) {
    const goal = this.store.getSavingsGoals().find((g) => g.id === goalId);
    if (!goal) return;
    const raw = await Utils.showModalPrompt(
      "Amount you've set aside for this goal. Tip: log the matching transfer as an expense so the calendar stays accurate.",
      `Add to "${goal.name}"`,
      { inputLabel: "Amount", inputType: "text" }
    );
    if (raw === null) return;
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount === 0) {
      Utils.showNotification("Please enter a valid amount", "error");
      return;
    }
    const saved = Math.max(
      0,
      Math.round((goal.saved + amount) * 100) / 100
    );
    this.store.updateSavingsGoal(goalId, { saved });
    this._renderList();
  }

  async _delete(goalId) {
    const goal = this.store.getSavingsGoals().find((g) => g.id === goalId);
    if (!goal) return;
    const confirmed = await Utils.showModalConfirm(
      `Delete the goal "${goal.name}"?`,
      "Delete Savings Goal",
      { confirmText: "Delete", cancelText: "Cancel" }
    );
    if (!confirmed) return;
    const snapshot = { ...goal };
    this.store.deleteSavingsGoal(goalId);
    this._renderList();
    Utils.showUndoToast("Savings goal deleted", () => {
      // Re-add under a fresh id: the old id is tombstoned for sync and a
      // merge would delete it again.
      delete snapshot.id;
      delete snapshot._lastModified;
      this.store.addSavingsGoal(snapshot);
      this._renderList();
    });
  }

  // ---- Add/edit form ------------------------------------------------------

  _showForm(goal) {
    this._editingId = goal ? goal.id : null;
    const form = document.getElementById("savingsGoalForm");
    if (!form) return;
    document.getElementById("savingsGoalFormTitle").textContent = goal
      ? "Edit Goal"
      : "Add Goal";
    document.getElementById("savingsGoalName").value = goal ? goal.name : "";
    document.getElementById("savingsGoalTarget").value = goal
      ? goal.targetAmount
      : "";
    document.getElementById("savingsGoalDate").value = goal
      ? goal.targetDate
      : "";
    document.getElementById("savingsGoalSaved").value = goal ? goal.saved : "";
    form.style.display = "block";
    document.getElementById("savingsGoalName").focus();
  }

  _hideForm() {
    const form = document.getElementById("savingsGoalForm");
    if (form) form.style.display = "none";
    this._editingId = null;
  }

  _saveForm() {
    const name = document.getElementById("savingsGoalName").value.trim();
    const targetAmount = parseFloat(
      document.getElementById("savingsGoalTarget").value
    );
    const targetDate = document.getElementById("savingsGoalDate").value;
    const saved = parseFloat(document.getElementById("savingsGoalSaved").value);

    if (!name) {
      Utils.showNotification("Please give the goal a name", "error");
      return;
    }
    if (isNaN(targetAmount) || targetAmount <= 0) {
      Utils.showNotification("Target amount must be greater than 0", "error");
      return;
    }
    if (!targetDate) {
      Utils.showNotification("Please pick a target date", "error");
      return;
    }

    const payload = {
      name,
      targetAmount,
      targetDate,
      saved: isNaN(saved) ? 0 : Math.max(0, saved),
    };
    if (this._editingId) {
      this.store.updateSavingsGoal(this._editingId, payload);
    } else {
      this.store.addSavingsGoal(payload);
    }
    this._hideForm();
    this._renderList();
  }
}
