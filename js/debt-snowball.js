// Debt snowball UI

class DebtSnowballUI {
  constructor(store, recurringManager, onUpdate) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onUpdate = onUpdate;
    this.editingDebtId = null;
    this.modal = document.getElementById("debtSnowballModal");
    this.debtList = document.getElementById("debtList");
    this.debtForm = document.getElementById("debtForm");
    this.debtFormTitle = document.getElementById("debtFormTitle");
    this.debtNameInput = document.getElementById("debtName");
    this.debtBalanceInput = document.getElementById("debtBalance");
    this.debtMinPaymentInput = document.getElementById("debtMinPayment");
    this.debtDueDayInput = document.getElementById("debtDueDay");
    this.debtInterestInput = document.getElementById("debtInterestRate");
    this.snowballExtraInput = document.getElementById("snowballExtraAmount");
    this.snowballAutoCheckbox = document.getElementById("snowballAutoGenerate");
    this.planSummary = document.getElementById("snowballPlanSummary");
    this.planList = document.getElementById("snowballPlanList");
    this.lastFocusedElement = null;

    this.initEventListeners();
    this.setupFocusTrap();
  }

  initEventListeners() {
    const closeBtn = document.getElementById("debtSnowballClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.hideModal());
    }
    const addDebtButton = document.getElementById("addDebtButton");
    if (addDebtButton) {
      addDebtButton.addEventListener("click", () => this.showDebtForm());
    }
    const saveDebtButton = document.getElementById("saveDebtButton");
    if (saveDebtButton) {
      saveDebtButton.addEventListener("click", () => this.saveDebt());
    }
    const cancelDebtButton = document.getElementById("cancelDebtButton");
    if (cancelDebtButton) {
      cancelDebtButton.addEventListener("click", () => this.hideDebtForm());
    }
    const saveSettingsButton = document.getElementById("saveSnowballSettings");
    if (saveSettingsButton) {
      saveSettingsButton.addEventListener("click", () =>
        this.saveSnowballSettings()
      );
    }
    const generateButton = document.getElementById("generateSnowballPayment");
    if (generateButton) {
      generateButton.addEventListener("click", () =>
        this.generateSnowballForCurrentMonth(true)
      );
    }
    if (this.debtList) {
      this.debtList.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || !target.dataset) return;
        const debtId = target.dataset.debtId;
        if (!debtId) return;
        if (target.dataset.action === "edit") {
          this.editDebt(debtId);
        } else if (target.dataset.action === "delete") {
          this.deleteDebt(debtId);
        }
      });
    }
    window.addEventListener("click", (event) => {
      if (event.target === this.modal) {
        this.hideModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.modal?.style.display === "block") {
        this.hideModal();
      }
    });
  }

  setupFocusTrap() {
    if (!this.modal) return;
    this.modal.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusableElements = this.modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements.length) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    });
  }

  showModal() {
    if (!this.modal) return;
    this.lastFocusedElement = document.activeElement;
    this.modal.style.display = "block";
    this.modal.setAttribute("aria-hidden", "false");
    this.refresh();
    const closeBtn = document.getElementById("debtSnowballClose");
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  hideModal() {
    if (!this.modal) return;
    this.modal.style.display = "none";
    this.modal.setAttribute("aria-hidden", "true");
    this.hideDebtForm();
    if (this.lastFocusedElement && document.contains(this.lastFocusedElement)) {
      this.lastFocusedElement.focus();
    }
    this.lastFocusedElement = null;
  }

  refresh() {
    this.renderDebts();
    this.renderPlan();
    this.loadSnowballSettings();
  }

  loadSnowballSettings() {
    const settings = this.store.getDebtSnowballSettings();
    if (this.snowballExtraInput) {
      this.snowballExtraInput.value = settings.extraPayment || 0;
    }
    if (this.snowballAutoCheckbox) {
      this.snowballAutoCheckbox.checked = settings.autoGenerate === true;
    }
  }

  showDebtForm(debt = null) {
    if (!this.debtForm) return;
    this.debtForm.style.display = "block";
    this.editingDebtId = debt ? debt.id : null;
    if (this.debtFormTitle) {
      this.debtFormTitle.textContent = debt ? "Edit Debt" : "Add Debt";
    }
    if (this.debtNameInput) {
      this.debtNameInput.value = debt?.name || "";
      this.debtNameInput.focus();
    }
    if (this.debtBalanceInput) {
      this.debtBalanceInput.value =
        debt && typeof debt.balance === "number" ? debt.balance : "";
    }
    if (this.debtMinPaymentInput) {
      this.debtMinPaymentInput.value =
        debt && typeof debt.minPayment === "number" ? debt.minPayment : "";
    }
    if (this.debtDueDayInput) {
      this.debtDueDayInput.value =
        debt && typeof debt.dueDay === "number" ? debt.dueDay : 1;
    }
    if (this.debtInterestInput) {
      this.debtInterestInput.value =
        debt && typeof debt.interestRate === "number"
          ? debt.interestRate
          : "";
    }
  }

  hideDebtForm() {
    if (!this.debtForm) return;
    this.debtForm.style.display = "none";
    this.editingDebtId = null;
    if (this.debtNameInput) this.debtNameInput.value = "";
    if (this.debtBalanceInput) this.debtBalanceInput.value = "";
    if (this.debtMinPaymentInput) this.debtMinPaymentInput.value = "";
    if (this.debtDueDayInput) this.debtDueDayInput.value = 1;
    if (this.debtInterestInput) this.debtInterestInput.value = "";
  }

  saveDebt() {
    const name = this.debtNameInput?.value.trim();
    const balance = parseFloat(this.debtBalanceInput?.value || "0");
    const minPayment = parseFloat(this.debtMinPaymentInput?.value || "0");
    const dueDay = parseInt(this.debtDueDayInput?.value || "1", 10);
    const interestRate = parseFloat(this.debtInterestInput?.value || "0");

    if (!name) {
      Utils.showNotification("Please enter a debt name", "error");
      return;
    }
    if (isNaN(balance) || balance < 0) {
      Utils.showNotification("Please enter a valid balance", "error");
      return;
    }
    if (isNaN(minPayment) || minPayment < 0) {
      Utils.showNotification("Please enter a valid minimum payment", "error");
      return;
    }
    if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) {
      Utils.showNotification("Due day must be between 1 and 31", "error");
      return;
    }

    if (this.editingDebtId) {
      const debt = this.store.getDebts().find((d) => d.id === this.editingDebtId);
      if (!debt) {
        Utils.showNotification("Debt not found", "error");
        return;
      }
      this.store.updateDebt(this.editingDebtId, {
        name,
        balance,
        minPayment,
        dueDay,
        interestRate: isNaN(interestRate) ? 0 : interestRate,
      });
      const updatedDebt = {
        ...debt,
        name,
        balance,
        minPayment,
        dueDay,
        interestRate: isNaN(interestRate) ? 0 : interestRate,
      };
      this.ensureMinimumPaymentRecurring(updatedDebt);
      Utils.showNotification("Debt updated");
    } else {
      const debt = {
        name,
        balance,
        minPayment,
        dueDay,
        interestRate: isNaN(interestRate) ? 0 : interestRate,
      };
      const debtId = this.store.addDebt(debt);
      const createdDebt = this.store.getDebts().find((d) => d.id === debtId);
      if (createdDebt) {
        this.ensureMinimumPaymentRecurring(createdDebt);
      }
      Utils.showNotification("Debt added");
    }
    this.hideDebtForm();
    this.refresh();
    this.onUpdate();
  }

  editDebt(debtId) {
    const debt = this.store.getDebts().find((d) => d.id === debtId);
    if (!debt) {
      Utils.showNotification("Debt not found", "error");
      return;
    }
    this.showDebtForm(debt);
  }

  async deleteDebt(debtId) {
    const debt = this.store.getDebts().find((d) => d.id === debtId);
    if (!debt) {
      Utils.showNotification("Debt not found", "error");
      return;
    }
    const shouldDelete = await Utils.showModalConfirm(
      `Delete debt "${debt.name}"?`,
      "Delete Debt",
      { confirmText: "Delete", cancelText: "Cancel" }
    );
    if (!shouldDelete) {
      return;
    }
    if (debt.minRecurringId) {
      this.store.deleteRecurringTransaction(debt.minRecurringId);
    }
    this.store.deleteDebt(debtId);
    Utils.showNotification("Debt deleted");
    this.refresh();
    this.onUpdate();
  }

  ensureMinimumPaymentRecurring(debt) {
    if (!debt || !debt.id) return;
    const startDate = this.getMonthlyStartDate(debt.dueDay);
    const description = `Debt Payment: ${debt.name}`;
    const recurringUpdates = {
      startDate,
      amount: debt.minPayment,
      type: "expense",
      description,
      recurrence: "monthly",
      debtId: debt.id,
      debtRole: "minimum",
      debtName: debt.name,
    };
    if (debt.minRecurringId) {
      const updated = this.store.updateRecurringTransaction(
        debt.minRecurringId,
        recurringUpdates
      );
      if (updated) {
        return;
      }
    }
    const recurringTransaction = {
      ...recurringUpdates,
      id: Utils.generateUniqueId(),
    };
    const recurringId = this.store.addRecurringTransaction(recurringTransaction);
    this.store.updateDebt(debt.id, { minRecurringId: recurringId });
  }

  getMonthlyStartDate(dueDay) {
    const day = Math.min(Math.max(parseInt(dueDay || 1, 10), 1), 31);
    return `2000-01-${String(day).padStart(2, "0")}`;
  }

  getDebtSummaries(cutoffDate = null) {
    const debts = this.store.getDebts();
    const transactions = this.store.getTransactions();
    const cutoffDateString = cutoffDate
      ? Utils.formatDateString(cutoffDate)
      : null;
    return debts.map((debt) => {
      let paid = 0;
      for (const dateKey in transactions) {
        if (cutoffDateString && dateKey >= cutoffDateString) {
          continue;
        }
        transactions[dateKey].forEach((t) => {
          if (t.debtId !== debt.id) {
            return;
          }
          if (t.recurringId && this.recurringManager) {
            if (this.recurringManager.isTransactionSkipped(dateKey, t.recurringId)) {
              return;
            }
          }
          if (t.type === "expense") {
            paid += t.amount;
          }
        });
      }
      const remaining = Math.max(0, debt.balance - paid);
      return {
        debt,
        paid,
        remaining,
      };
    });
  }

  renderDebts() {
    if (!this.debtList) return;
    this.debtList.innerHTML = "";
    const summaries = this.getDebtSummaries();
    if (summaries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debt-empty";
      empty.textContent = "No debts added yet.";
      this.debtList.appendChild(empty);
      return;
    }
    summaries.forEach(({ debt, remaining }) => {
      const balance = Number(debt.balance) || 0;
      const minPayment = Number(debt.minPayment) || 0;
      const dueDay = Number(debt.dueDay) || 1;
      const row = document.createElement("div");
      row.className = "debt-item";

      const details = document.createElement("div");
      details.className = "debt-details";

      const name = document.createElement("div");
      name.className = "debt-name";
      name.textContent = debt.name;
      details.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "debt-meta";
      const interest =
        typeof debt.interestRate === "number" && debt.interestRate > 0
          ? ` • ${debt.interestRate.toFixed(2)}%`
          : "";
      meta.textContent = `Balance $${debt.balance.toFixed(
        2
      )} • Remaining $${remaining.toFixed(2)} • Min $${minPayment.toFixed(
        2
      )} • Due day ${dueDay}${interest}`;
      details.appendChild(meta);

      row.appendChild(details);

      const actions = document.createElement("div");
      actions.className = "debt-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "secondary-button";
      editBtn.textContent = "Edit";
      editBtn.dataset.action = "edit";
      editBtn.dataset.debtId = debt.id;
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "secondary-button";
      deleteBtn.textContent = "Delete";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.debtId = debt.id;
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(actions);

      this.debtList.appendChild(row);
    });
  }

  renderPlan() {
    if (!this.planList || !this.planSummary) return;
    this.planList.innerHTML = "";
    this.planSummary.innerHTML = "";
    const settings = this.store.getDebtSnowballSettings();
    const summaries = this.getDebtSummaries().filter(
      (summary) => summary.remaining > 0
    );
    summaries.sort((a, b) => a.remaining - b.remaining);
    if (summaries.length === 0) {
      this.planSummary.textContent = "No active debts to target.";
      return;
    }
    const target = summaries[0];
    const summaryText = document.createElement("div");
    summaryText.className = "debt-plan-summary";
    summaryText.textContent = `Current target: ${target.debt.name} (Remaining $${target.remaining.toFixed(
      2
    )})`;
    this.planSummary.appendChild(summaryText);

    const extraText = document.createElement("div");
    extraText.className = "debt-plan-extra";
    extraText.textContent = `Snowball extra per month: $${(
      settings.extraPayment || 0
    ).toFixed(2)}`;
    this.planSummary.appendChild(extraText);

    summaries.forEach((summary, index) => {
      const item = document.createElement("div");
      item.className = "debt-plan-item";
      if (index === 0) {
        item.classList.add("debt-plan-target");
      }
      item.textContent = `${index + 1}. ${summary.debt.name} — Remaining $${summary.remaining.toFixed(
        2
      )}`;
      this.planList.appendChild(item);
    });
  }

  saveSnowballSettings() {
    const extraPayment = parseFloat(this.snowballExtraInput?.value || "0");
    const autoGenerate = this.snowballAutoCheckbox?.checked === true;
    if (isNaN(extraPayment) || extraPayment < 0) {
      Utils.showNotification("Extra payment must be 0 or greater", "error");
      return;
    }
    this.store.setDebtSnowballSettings({
      extraPayment,
      autoGenerate,
    });
    Utils.showNotification("Snowball settings saved");
    if (autoGenerate) {
      this.generateSnowballForCurrentMonth(false);
    }
    this.renderPlan();
    this.onUpdate();
  }

  generateSnowballForCurrentMonth(force) {
    const today = new Date();
    const changed = this.ensureSnowballPaymentForMonth(
      today.getFullYear(),
      today.getMonth(),
      force
    );
    if (changed) {
      Utils.showNotification("Snowball payment generated");
      this.renderDebts();
      this.renderPlan();
      this.onUpdate();
    } else if (force) {
      Utils.showNotification("No snowball payment generated", "error");
    }
  }

  ensureSnowballPaymentForMonth(year, month, force = false) {
    const settings = this.store.getDebtSnowballSettings();
    if (!settings || !settings.extraPayment || settings.extraPayment <= 0) {
      return false;
    }
    if (!settings.autoGenerate && !force) {
      return false;
    }
    const monthKey = `${year}-${month + 1}`;
    const transactions = this.store.getTransactions();
    let hasExisting = false;
    let removedAny = false;

    for (const dateKey in transactions) {
      const list = transactions[dateKey];
      const remaining = list.filter((t) => {
        const isSnowball =
          t.snowballGenerated === true && t.snowballMonth === monthKey;
        if (isSnowball) {
          hasExisting = true;
        }
        return !(isSnowball && force);
      });
      if (remaining.length !== list.length) {
        removedAny = true;
      }
      if (remaining.length === 0) {
        delete transactions[dateKey];
      } else {
        transactions[dateKey] = remaining;
      }
    }

    if (hasExisting && !force) {
      return false;
    }
    if (removedAny) {
      this.store.saveData();
    }

    const cutoffDate = new Date(year, month, 1);
    const summaries = this.getDebtSummaries(cutoffDate).filter(
      (summary) => summary.remaining > 0
    );
    if (summaries.length === 0) {
      return removedAny;
    }
    summaries.sort((a, b) => a.remaining - b.remaining);
    const target = summaries[0].debt;
    const dueDay = Math.min(
      Math.max(parseInt(target.dueDay || 1, 10), 1),
      new Date(year, month + 1, 0).getDate()
    );
    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(
      dueDay
    ).padStart(2, "0")}`;
    const transaction = {
      amount: settings.extraPayment,
      type: "expense",
      description: `Snowball Payment: ${target.name}`,
      debtId: target.id,
      debtRole: "snowball",
      debtName: target.name,
      snowballMonth: monthKey,
      snowballGenerated: true,
    };
    this.store.addTransaction(dateString, transaction);
    return true;
  }
}

window.DebtSnowballUI = DebtSnowballUI;
