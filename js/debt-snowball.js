// Debt snowball UI

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// How many months past the viewed/current month to materialize snowball
// payments and minimum-payment adjustments. Forward balances and the
// today-anchored 30-day Minimum are computed from materialized transactions,
// so the snowball must be materialized across at least the same span (see
// CalculationService.updateMonthlyBalances, which projects +6 months).
const SNOWBALL_FORWARD_HORIZON = 6;

class DebtSnowballUI {
  constructor(store, recurringManager, onUpdate, calculationService = null) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onUpdate = onUpdate;
    this.calculationService = calculationService;
    this.editingDebtId = null;
    this.view = document.getElementById("debtSnowballView");
    this.debtList = document.getElementById("debtList");
    this.debtForm = document.getElementById("debtForm");
    this.debtFormTitle = document.getElementById("debtFormTitle");
    this.debtNameInput = document.getElementById("debtName");
    this.debtBalanceInput = document.getElementById("debtBalance");
    this.debtMinPaymentInput = document.getElementById("debtMinPayment");
    this.debtRecurrenceInput = document.getElementById("debtRecurrence");
    this.debtStartDateInput = document.getElementById("debtStartDate");
    this.debtDueDayInput = document.getElementById("debtDueDay");
    this.debtDueDayPatternInput = document.getElementById("debtDueDayPattern");
    this.debtInterestInput = document.getElementById("debtInterestRate");
    this.debtAdvancedOptions = document.getElementById(
      "debtAdvancedRecurrenceOptions"
    );
    this.debtEndConditionOptions = document.getElementById(
      "debtEndConditionOptions"
    );
    this.snowballFloorInput = document.getElementById("snowballDailyFloor");
    this.snowballExtraStartInput = document.getElementById(
      "snowballExtraStartMonth"
    );
    this.snowballAutoCheckbox = document.getElementById("snowballAutoGenerate");
    this.heroEl = document.getElementById("snowballHero");
    this.planSummary = document.getElementById("snowballPlanSummary");
    this.planList = document.getElementById("snowballPlanList");
    this.lastFocusedElement = null;
    this.daySpecificOptions = Utils.DAY_SPECIFIC_OPTIONS;
    this.isSyncingDueDate = false;
    this.currentViewYear = null;
    this.currentViewMonth = null;
    this.editingCashInfusionId = null;
    this.convertingFromRecurringId = null; // Track recurring transaction being converted to debt

    // Cash infusion DOM references
    this.cashInfusionList = document.getElementById("cashInfusionList");
    this.cashInfusionForm = document.getElementById("cashInfusionForm");
    this.cashInfusionFormTitle = document.getElementById("cashInfusionFormTitle");
    this.cashInfusionNameInput = document.getElementById("cashInfusionName");
    this.cashInfusionAmountInput = document.getElementById("cashInfusionAmount");
    this.cashInfusionDateInput = document.getElementById("cashInfusionDate");
    this.cashInfusionTargetInput = document.getElementById("cashInfusionTarget");

    this.populateDueDayPatternOptions();
    this.initEventListeners();
    this.setupFocusTrap();
  }

  initEventListeners() {
    const closeBtn = document.getElementById("debtSnowballClose");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => this.hideView());
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
    if (this.debtRecurrenceInput) {
      this.debtRecurrenceInput.addEventListener("change", () =>
        this.updateDebtRecurrenceOptions()
      );
    }
    if (this.debtStartDateInput) {
      this.debtStartDateInput.addEventListener("change", () =>
        this.syncDueDayFromStartDate()
      );
    }
    if (this.debtDueDayInput) {
      this.debtDueDayInput.addEventListener("change", () =>
        this.syncStartDateFromDueDay()
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
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.view?.style.display === "block") {
        this.hideView();
      }
    });
    // Browser/hardware Back closes the view (our pushed history entry is popped).
    window.addEventListener("popstate", () => {
      if (this.view && this.view.style.display === "block") {
        this._hideViewDom();
      }
    });

    // Cash infusion event listeners
    const addCashInfusionButton = document.getElementById("addCashInfusionButton");
    if (addCashInfusionButton) {
      addCashInfusionButton.addEventListener("click", () => this.showCashInfusionForm());
    }
    const saveCashInfusionButton = document.getElementById("saveCashInfusionButton");
    if (saveCashInfusionButton) {
      saveCashInfusionButton.addEventListener("click", () => this.saveCashInfusion());
    }
    const cancelCashInfusionButton = document.getElementById("cancelCashInfusionButton");
    if (cancelCashInfusionButton) {
      cancelCashInfusionButton.addEventListener("click", () => this.hideCashInfusionForm());
    }
    if (this.cashInfusionList) {
      this.cashInfusionList.addEventListener("click", (event) => {
        const target = event.target;
        if (!target || !target.dataset) return;
        const infusionId = target.dataset.infusionId;
        if (!infusionId) return;
        if (target.dataset.action === "edit") {
          this.editCashInfusion(infusionId);
        } else if (target.dataset.action === "delete") {
          this.deleteCashInfusion(infusionId);
        }
      });
    }
  }

  setupFocusTrap() {
    if (!this.view) return;
    this.view.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusableElements = this.view.querySelectorAll(
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

  showView() {
    if (!this.view) return;
    const alreadyOpen = this.view.style.display === "block";
    if (!alreadyOpen) {
      this.lastFocusedElement = document.activeElement;
    }
    this.view.style.display = "block";
    this.view.setAttribute("aria-hidden", "false");
    this.view.scrollTop = 0;
    this.refresh();
    // Push a history entry the first time we open so the browser/hardware Back
    // button returns to the calendar instead of leaving the app entirely.
    if (!alreadyOpen) {
      this._viewHistoryActive = true;
      try {
        history.pushState({ cashflowView: "debtSnowball" }, "");
      } catch (e) {
        this._viewHistoryActive = false;
      }
    }
    const closeBtn = document.getElementById("debtSnowballClose");
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  hideView() {
    if (!this.view) return;
    if (this.view.style.display !== "block") return;
    // If our pushed entry is the current history state, pop it so the back
    // stack stays clean; the popstate handler then tears down the DOM.
    // Otherwise (no live entry) hide directly.
    if (
      this._viewHistoryActive &&
      history.state &&
      history.state.cashflowView === "debtSnowball"
    ) {
      history.back();
    } else {
      this._hideViewDom();
    }
  }

  _hideViewDom() {
    if (!this.view) return;
    this._viewHistoryActive = false;
    this.view.style.display = "none";
    this.view.setAttribute("aria-hidden", "true");
    this.hideDebtForm();
    this.hideCashInfusionForm();
    this.convertingFromRecurringId = null;
    if (this.lastFocusedElement && document.contains(this.lastFocusedElement)) {
      this.lastFocusedElement.focus();
    }
    this.lastFocusedElement = null;
  }

  // Convert a recurring transaction to a debt - opens modal with pre-populated form
  showDebtFormFromRecurring(recurringTransaction) {
    if (!recurringTransaction) return;

    // Track which recurring transaction we're converting
    this.convertingFromRecurringId = recurringTransaction.id;

    // Open the snowball view
    this.showView();

    // Build a debt-like object from the recurring transaction
    const debtFromRecurring = {
      name: recurringTransaction.description || "",
      balance: "", // User must fill this in
      minPayment: recurringTransaction.amount || 0,
      recurrence: recurringTransaction.recurrence || "monthly",
      dueDay: this.extractDayFromDate(recurringTransaction.startDate) || 1,
      dueStartDate: recurringTransaction.startDate || "",
      dueDayPattern: recurringTransaction.daySpecific ? recurringTransaction.daySpecificData : "",
      interestRate: "", // User must fill this in
      businessDayAdjustment: recurringTransaction.businessDayAdjustment || "none",
      semiMonthlyDays: recurringTransaction.semiMonthlyDays || null,
      semiMonthlyLastDay: recurringTransaction.semiMonthlyLastDay || false,
      customInterval: recurringTransaction.customInterval || null,
      endDate: recurringTransaction.endDate || "",
      maxOccurrences: recurringTransaction.maxOccurrences || null,
    };

    // Show the form with pre-populated data
    this.showDebtForm(debtFromRecurring);

    // Update form title to indicate conversion
    if (this.debtFormTitle) {
      this.debtFormTitle.textContent = "Convert to Debt";
    }

    // Focus on balance input since that's what user needs to fill in
    if (this.debtBalanceInput) {
      this.debtBalanceInput.focus();
    }
  }

  extractDayFromDate(dateString) {
    if (!dateString) return 1;
    const parts = dateString.split("-");
    if (parts.length === 3) {
      return parseInt(parts[2], 10) || 1;
    }
    return 1;
  }

  refresh() {
    const today = new Date();
    const viewYear =
      typeof this.currentViewYear === "number"
        ? this.currentViewYear
        : today.getFullYear();
    const viewMonth =
      typeof this.currentViewMonth === "number"
        ? this.currentViewMonth
        : today.getMonth();
    // The plan preview always projects WITH the extra payment (includeExtra =
    // true) so it shows the full snowball outcome, even when auto-generate is
    // off and no snowball transactions are materialized on the calendar. This
    // is intentional: the plan is advisory; the calendar reflects only what is
    // actually scheduled (auto-generate on, or the Generate button used).
    const projection = this.calculateSnowballProjection(viewYear, viewMonth, true);
    this.renderHero(projection);
    this.renderDebts();
    this.renderCashInfusions(projection);
    this.renderPlan(projection);
    this.loadSnowballSettings();
  }

  loadSnowballSettings() {
    const settings = this.store.getDebtSnowballSettings();
    if (this.snowballFloorInput) {
      this.snowballFloorInput.value = settings.dailyFloor || 0;
    }
    if (this.snowballExtraStartInput) {
      this.snowballExtraStartInput.value = settings.extraPaymentStartMonth || "";
    }
    if (this.snowballAutoCheckbox) {
      this.snowballAutoCheckbox.checked = settings.autoGenerate === true;
    }
  }

  populateDueDayPatternOptions() {
    if (!this.debtDueDayPatternInput) return;
    if (this.debtDueDayPatternInput.options.length > 0) return;
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Same day each month";
    this.debtDueDayPatternInput.appendChild(defaultOption);
    this.daySpecificOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      this.debtDueDayPatternInput.appendChild(optionElement);
    });
  }

  updateDebtRecurrenceOptions() {
    if (!this.debtRecurrenceInput || !this.debtAdvancedOptions) return;
    const recurrenceType = this.debtRecurrenceInput.value || "monthly";
    this.debtAdvancedOptions.innerHTML = "";
    if (this.debtEndConditionOptions) {
      this.debtEndConditionOptions.innerHTML = "";
    }

    if (recurrenceType === "monthly") {
      this.toggleMonthlyFields(true);
    } else {
      this.toggleMonthlyFields(false);
    }

    if (recurrenceType === "once") {
      this.debtAdvancedOptions.style.display = "none";
      if (this.debtEndConditionOptions) {
        this.debtEndConditionOptions.style.display = "none";
      }
      return;
    }

    this.debtAdvancedOptions.style.display = "block";
    if (recurrenceType === "semi-monthly") {
      Utils.buildSemiMonthlyOptions(this.debtAdvancedOptions, 'debt');
    } else if (recurrenceType === "custom") {
      Utils.buildCustomIntervalOptions(this.debtAdvancedOptions, 'debt');
    }
    Utils.buildBusinessDayOptions(this.debtAdvancedOptions, 'debt');
    if (this.debtEndConditionOptions) {
      this.debtEndConditionOptions.style.display = "block";
      Utils.buildEndConditionOptions(this.debtEndConditionOptions, 'debt');
    } else {
      Utils.buildEndConditionOptions(this.debtAdvancedOptions, 'debt');
    }
  }

  toggleMonthlyFields(show) {
    const display = show ? "" : "none";
    const dueDayLabel = document.querySelector('label[for="debtDueDay"]');
    const dueDayPatternLabel = document.querySelector(
      'label[for="debtDueDayPattern"]'
    );
    if (dueDayLabel) dueDayLabel.style.display = display;
    if (this.debtDueDayInput) this.debtDueDayInput.style.display = display;
    if (dueDayPatternLabel) dueDayPatternLabel.style.display = display;
    if (this.debtDueDayPatternInput) {
      this.debtDueDayPatternInput.style.display = display;
    }
  }

  syncDueDayFromStartDate() {
    if (this.isSyncingDueDate) return;
    if (!this.debtStartDateInput || !this.debtDueDayInput) return;
    const dateValue = this.debtStartDateInput.value;
    if (!dateValue) return;
    const parts = dateValue.split("-");
    if (parts.length !== 3) return;
    const day = parseInt(parts[2], 10);
    if (isNaN(day)) return;
    this.isSyncingDueDate = true;
    this.debtDueDayInput.value = day;
    this.isSyncingDueDate = false;
  }

  syncStartDateFromDueDay() {
    if (this.isSyncingDueDate) return;
    if (!this.debtStartDateInput || !this.debtDueDayInput) return;
    const dueDay = parseInt(this.debtDueDayInput.value, 10);
    if (isNaN(dueDay) || dueDay < 1 || dueDay > 31) return;
    const baseDate =
      this.debtStartDateInput.value || Utils.formatDateString(new Date());
    const parts = baseDate.split("-");
    if (parts.length !== 3) return;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    if (!year || !month) return;
    const lastDay = new Date(year, month, 0).getDate();
    const clampedDay = Math.min(Math.max(dueDay, 1), lastDay);
    const newDate = `${parts[0]}-${parts[1]}-${String(clampedDay).padStart(
      2,
      "0"
    )}`;
    this.isSyncingDueDate = true;
    this.debtStartDateInput.value = newDate;
    this.isSyncingDueDate = false;
  }

  isValidDateString(dateString) {
    if (!dateString || typeof dateString !== "string") return false;
    const parts = dateString.split("-");
    if (parts.length !== 3) return false;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!year || !month || !day) return false;
    const date = new Date(year, month - 1, day);
    return (
      date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
    );
  }

  getDayFromDateString(dateString) {
    if (!this.isValidDateString(dateString)) return null;
    const parts = dateString.split("-");
    return Number(parts[2]);
  }

  replaceDayInDateString(dateString, day) {
    if (!this.isValidDateString(dateString)) {
      return dateString;
    }
    const parts = dateString.split("-");
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const lastDay = new Date(year, month, 0).getDate();
    const clampedDay = Math.min(Math.max(Number(day) || 1, 1), lastDay);
    return `${parts[0]}-${parts[1]}-${String(clampedDay).padStart(2, "0")}`;
  }

  getDebtStartDateValue(debt) {
    const candidate = debt?.dueStartDate;
    if (this.isValidDateString(candidate)) {
      return candidate;
    }
    const now = new Date();
    const today = Utils.formatDateString(now);
    // Anchor the day-of-month to the CURRENT month (not January) when a debt
    // has no explicit start date. A January anchor back-dates the minimum-
    // payment recurrence and fabricates months of "paid" history for legacy or
    // imported debts; the current month gives the same day-of-month without
    // back-dating before today.
    const monthStart = Utils.formatDateString(
      new Date(now.getFullYear(), now.getMonth(), 1)
    );
    if (!debt) return today;
    const recurrence = debt.recurrence || "monthly";
    if (recurrence === "monthly" && typeof debt.dueDay === "number") {
      return this.replaceDayInDateString(monthStart, debt.dueDay);
    }
    if (
      recurrence === "semi-monthly" &&
      Array.isArray(debt.semiMonthlyDays) &&
      debt.semiMonthlyDays.length
    ) {
      return this.replaceDayInDateString(monthStart, debt.semiMonthlyDays[0]);
    }
    return today;
  }

  getDefaultStartDate(debt) {
    return this.getDebtStartDateValue(debt);
  }

  populateDebtAdvancedOptions(debt) {
    if (!this.debtRecurrenceInput || !this.debtAdvancedOptions) return;
    const recurrence = this.debtRecurrenceInput.value || "monthly";
    if (recurrence === "once") return;

    if (recurrence === "semi-monthly") {
      const firstDay = document.getElementById("debtSemiMonthlyFirstDay");
      const secondDay = document.getElementById("debtSemiMonthlySecondDay");
      if (firstDay && secondDay && Array.isArray(debt?.semiMonthlyDays)) {
        firstDay.value = debt.semiMonthlyDays[0] || 1;
        if (debt.semiMonthlyLastDay === true) {
          secondDay.value = "last";
        } else {
          secondDay.value = debt.semiMonthlyDays[1] || 15;
        }
      }
    }

    if (recurrence === "custom") {
      const intervalValue = document.getElementById("debtCustomIntervalValue");
      const intervalUnit = document.getElementById("debtCustomIntervalUnit");
      if (intervalValue && intervalUnit && debt?.customInterval) {
        intervalValue.value = debt.customInterval.value || 1;
        intervalUnit.value = debt.customInterval.unit || "days";
      }
    }

    const businessDayAdjustment = document.getElementById(
      "debtBusinessDayAdjustment"
    );
    if (businessDayAdjustment) {
      businessDayAdjustment.value = debt?.businessDayAdjustment || "none";
    }

    const endConditionNone = document.getElementById("debtEndConditionNone");
    const endConditionDate = document.getElementById("debtEndConditionDate");
    const endConditionOccurrence = document.getElementById(
      "debtEndConditionOccurrence"
    );
    const endDateInput = document.getElementById("debtEndDate");
    const maxOccurrencesInput = document.getElementById("debtMaxOccurrences");

    if (debt?.endDate && endConditionDate && endDateInput) {
      endConditionDate.checked = true;
      endDateInput.disabled = false;
      endDateInput.value = debt.endDate;
      if (maxOccurrencesInput) maxOccurrencesInput.disabled = true;
    } else if (debt?.maxOccurrences && endConditionOccurrence && maxOccurrencesInput) {
      endConditionOccurrence.checked = true;
      maxOccurrencesInput.disabled = false;
      maxOccurrencesInput.value = debt.maxOccurrences;
      if (endDateInput) endDateInput.disabled = true;
    } else if (endConditionNone) {
      endConditionNone.checked = true;
      if (endDateInput) endDateInput.disabled = true;
      if (maxOccurrencesInput) maxOccurrencesInput.disabled = true;
    }
  }

  collectDebtAdvancedOptions(recurrence) {
    const options = {
      businessDayAdjustment: "none",
      endDate: "",
      maxOccurrences: null,
      semiMonthlyDays: null,
      semiMonthlyLastDay: false,
      customInterval: null,
    };

    if (recurrence === "semi-monthly") {
      const firstDay = document.getElementById("debtSemiMonthlyFirstDay");
      const secondDay = document.getElementById("debtSemiMonthlySecondDay");
      if (firstDay && secondDay) {
        const days = [];
        days.push(parseInt(firstDay.value, 10));
        if (secondDay.value === "last") {
          options.semiMonthlyLastDay = true;
          days.push(31);
        } else {
          days.push(parseInt(secondDay.value, 10));
        }
        options.semiMonthlyDays = days;
      }
    }

    if (recurrence === "custom") {
      const intervalValue = document.getElementById("debtCustomIntervalValue");
      const intervalUnit = document.getElementById("debtCustomIntervalUnit");
      if (intervalValue && intervalUnit) {
        options.customInterval = {
          value: parseInt(intervalValue.value, 10),
          unit: intervalUnit.value,
        };
      }
    }

    const businessDayAdjustment = document.getElementById(
      "debtBusinessDayAdjustment"
    );
    if (businessDayAdjustment) {
      options.businessDayAdjustment = businessDayAdjustment.value;
    }

    const endConditionRadios = document.querySelectorAll(
      'input[name="debtEndCondition"]'
    );
    for (const radio of endConditionRadios) {
      if (!radio.checked) continue;
      if (radio.value === "date") {
        const endDate = document.getElementById("debtEndDate");
        if (endDate && endDate.value) {
          options.endDate = endDate.value;
        }
      } else if (radio.value === "occurrence") {
        const maxOccurrences = document.getElementById("debtMaxOccurrences");
        if (maxOccurrences) {
          const parsed = parseInt(maxOccurrences.value, 10);
          if (!isNaN(parsed) && parsed > 0) {
            options.maxOccurrences = parsed;
          }
        }
      }
      break;
    }

    return options;
  }

  showDebtForm(debt = null) {
    if (!this.debtForm) return;
    this.populateDueDayPatternOptions();
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
    if (this.debtRecurrenceInput) {
      this.debtRecurrenceInput.value = debt?.recurrence || "monthly";
    }
    if (this.debtStartDateInput) {
      this.debtStartDateInput.value = this.getDefaultStartDate(debt);
    }
    if (this.debtDueDayInput) {
      this.debtDueDayInput.value =
        debt && typeof debt.dueDay === "number" ? debt.dueDay : 1;
    }
    if (this.debtDueDayPatternInput) {
      this.debtDueDayPatternInput.value =
        debt && typeof debt.dueDayPattern === "string" ? debt.dueDayPattern : "";
    }
    if (this.debtInterestInput) {
      this.debtInterestInput.value =
        debt && typeof debt.interestRate === "number"
          ? debt.interestRate
          : "";
    }
    if (!debt || debt.dueStartDate) {
      this.syncDueDayFromStartDate();
    }
    this.updateDebtRecurrenceOptions();
    this.populateDebtAdvancedOptions(debt);
  }

  hideDebtForm() {
    if (!this.debtForm) return;
    this.debtForm.style.display = "none";
    this.editingDebtId = null;
    this.convertingFromRecurringId = null; // Clear conversion tracking
    if (this.debtNameInput) this.debtNameInput.value = "";
    if (this.debtBalanceInput) this.debtBalanceInput.value = "";
    if (this.debtMinPaymentInput) this.debtMinPaymentInput.value = "";
    if (this.debtRecurrenceInput) this.debtRecurrenceInput.value = "monthly";
    if (this.debtStartDateInput) this.debtStartDateInput.value = "";
    if (this.debtDueDayInput) this.debtDueDayInput.value = 1;
    if (this.debtDueDayPatternInput) this.debtDueDayPatternInput.value = "";
    if (this.debtInterestInput) this.debtInterestInput.value = "";
    if (this.debtAdvancedOptions) {
      this.debtAdvancedOptions.innerHTML = "";
      this.debtAdvancedOptions.style.display = "none";
    }
    if (this.debtEndConditionOptions) {
      this.debtEndConditionOptions.innerHTML = "";
      this.debtEndConditionOptions.style.display = "none";
    }
  }

  saveDebt() {
    const name = this.debtNameInput?.value.trim();
    const balance = parseFloat(this.debtBalanceInput?.value || "0");
    const minPayment = parseFloat(this.debtMinPaymentInput?.value || "0");
    const recurrence = this.debtRecurrenceInput?.value || "monthly";
    const startDateInput = this.debtStartDateInput?.value || "";
    const dueDayInput = parseInt(this.debtDueDayInput?.value || "1", 10);
    const dueDayPatternInput = this.debtDueDayPatternInput?.value || "";
    const interestRate = parseFloat(this.debtInterestInput?.value || "0");
    const advancedOptions = this.collectDebtAdvancedOptions(recurrence);
    const dueDayPattern =
      recurrence === "monthly" ? dueDayPatternInput : "";
    if (!this.isValidDateString(startDateInput)) {
      Utils.showNotification("Please enter a valid start date", "error");
      return;
    }
    let normalizedStartDate = startDateInput;
    if (recurrence === "monthly" && !dueDayPattern) {
      if (isNaN(dueDayInput) || dueDayInput < 1 || dueDayInput > 31) {
        Utils.showNotification("Due day must be between 1 and 31", "error");
        return;
      }
      normalizedStartDate = this.replaceDayInDateString(
        startDateInput,
        dueDayInput
      );
    }
    if (
      recurrence === "semi-monthly" &&
      Array.isArray(advancedOptions.semiMonthlyDays)
    ) {
      normalizedStartDate = this.replaceDayInDateString(
        startDateInput,
        advancedOptions.semiMonthlyDays[0]
      );
    }
    const startDay = this.getDayFromDateString(normalizedStartDate);
    const dueDay = !isNaN(startDay) ? startDay : 1;

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
        dueDayPattern,
        recurrence,
        dueStartDate: normalizedStartDate,
        ...advancedOptions,
        interestRate: isNaN(interestRate) ? 0 : interestRate,
      });
      const updatedDebt = {
        ...debt,
        name,
        balance,
        minPayment,
        dueDay,
        dueDayPattern,
        recurrence,
        dueStartDate: normalizedStartDate,
        ...advancedOptions,
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
        dueDayPattern,
        recurrence,
        dueStartDate: normalizedStartDate,
        ...advancedOptions,
        interestRate: isNaN(interestRate) ? 0 : interestRate,
      };
      const debtId = this.store.addDebt(debt);
      const createdDebt = this.store.getDebts().find((d) => d.id === debtId);
      if (createdDebt) {
        this.ensureMinimumPaymentRecurring(createdDebt);
      }

      // If converting from a recurring transaction, delete it
      if (this.convertingFromRecurringId) {
        this.store.deleteRecurringTransaction(this.convertingFromRecurringId);
        this.recurringManager.invalidateCache();
        this.convertingFromRecurringId = null;
        Utils.showNotification("Recurring transaction converted to debt");
      } else {
        Utils.showNotification("Debt added");
      }
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
      this.recurringManager.invalidateCache();
    }
    this.store.deleteDebt(debtId);
    Utils.showNotification("Debt deleted");
    this.refresh();
    this.onUpdate();
  }

  setCurrentViewMonth(year, month) {
    this.currentViewYear = year;
    this.currentViewMonth = month;
  }

  // Cash Infusion Methods

  saveSnowballSettings() {
    const dailyFloor = parseFloat(this.snowballFloorInput?.value || "0");
    const autoGenerate = this.snowballAutoCheckbox?.checked === true;
    const extraPaymentStartMonth = (
      this.snowballExtraStartInput?.value || ""
    ).trim();
    if (isNaN(dailyFloor) || dailyFloor < 0) {
      Utils.showNotification("Minimum daily cashflow must be 0 or greater", "error");
      return;
    }
    if (
      extraPaymentStartMonth &&
      !/^\d{4}-\d{2}$/.test(extraPaymentStartMonth)
    ) {
      Utils.showNotification("Invalid floor start month", "error");
      return;
    }
    this.store.setDebtSnowballSettings({
      dailyFloor,
      extraPaymentStartMonth,
      autoGenerate,
    });
    Utils.showNotification("Snowball settings saved");
    if (autoGenerate) {
      this.generateSnowballForCurrentMonth(false);
    }
    this.refresh();
    this.onUpdate();
  }

  generateSnowballForCurrentMonth(force) {
    const today = new Date();
    const snowballAdded = this.ensureSnowballPaymentForMonth(
      today.getFullYear(),
      today.getMonth(),
      force
    );
    if (snowballAdded) {
      Utils.showNotification("Snowball payment generated");
      this.refresh();
      this.onUpdate();
    } else if (force) {
      Utils.showNotification("No snowball payment generated", "error");
    }
  }

  ensureSnowballPaymentForMonth(year, month, force = false, opts = {}) {
    const settings = this.store.getDebtSnowballSettings() || {};
    const autoGenerate = settings.autoGenerate === true;
    const includeExtra = autoGenerate || force;

    // When materializing a forward window (ensureSnowballPaymentsForHorizon),
    // the caller supplies one shared projection and handles the view-month and
    // plan-render side effects once, so this per-month call runs silently.
    const sharedProjection = opts.projection || null;
    const silent = opts.silent === true;

    if (!silent) {
      this.setCurrentViewMonth(year, month);
    }
    const projection =
      sharedProjection ||
      this.calculateSnowballProjection(year, month, includeExtra);
    // End each debt's minimum-payment recurrence at its projected payoff so the
    // payment never expands past payoff on any surface (calendar, day modal,
    // balances, search, CSV). Persisted locally; rides the next real sync. With
    // a shared projection the caller has already synced end dates once for the
    // whole window, so skip the redundant per-month sync.
    if (!sharedProjection) {
      if (this.syncMinimumPaymentEndDates(projection.payoffByDebtId)) {
        this.store.saveData(false);
      }
    }
    const today = new Date();
    const currentIndex = this.getMonthIndex(today.getFullYear(), today.getMonth());
    const viewIndex = this.getMonthIndex(year, month);
    const allowMutation = force || viewIndex >= currentIndex;
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    let changed = false;
    let snowballAdded = false;

    if (
      allowMutation &&
      this.prunePaidOffDebtMinimumPayments(year, month, projection.payoffByDebtId)
    ) {
      changed = true;
    }

    const monthInfo = projection.monthTargets?.[monthKey] || {};
    const minPaidByDebtId = monthInfo.minPaidByDebtId || {};
    // Floor model: a debt is paid off in full on the exact day the projected
    // checking surplus above the floor can cover it (lumpSumDateByDebtId), which
    // is independent of the debt's due date. Most months have no payoff; a payoff
    // month has one entry per cleared debt.
    const lumpSumPaidByDebtId = monthInfo.lumpSumPaidByDebtId || {};
    const lumpSumDateByDebtId = monthInfo.lumpSumDateByDebtId || {};

    if (allowMutation) {
      if (this.adjustMinimumPaymentTransactions(year, month, minPaidByDebtId)) {
        changed = true;
      }

      const expectedSnowballPayments = [];
      if (includeExtra) {
        const debtsById = new Map(
          this.store.getDebts().map((debt) => [debt.id, debt])
        );
        Object.keys(lumpSumPaidByDebtId).forEach((debtId) => {
          const amount = Number(lumpSumPaidByDebtId[debtId]) || 0;
          if (amount <= 0) {
            return;
          }
          const debt = debtsById.get(debtId);
          if (!debt) {
            return;
          }
          // Place the payoff on the availability date the projection computed,
          // not the debt's due date.
          const dueDateString = lumpSumDateByDebtId[debtId] || null;
          if (!dueDateString) {
            return;
          }
          expectedSnowballPayments.push({
            debtId,
            amount,
            dateString: dueDateString,
            debtName: debt.name,
          });
        });
      }

      const syncResult = this.syncSnowballTransactionsForMonth(
        year,
        month,
        monthKey,
        expectedSnowballPayments,
        includeExtra,
        force === true
      );
      if (syncResult.changed) {
        changed = true;
      }
      if (syncResult.snowballAdded) {
        snowballAdded = true;
      }
      if (changed || snowballAdded) {
        // Single save point for everything this pass touched (adjusted
        // minimums, pruned/added snowball rows). force = the explicit
        // Generate button → user-grade save that schedules a cloud push;
        // routine render-time maintenance saves quiet and rides the next
        // real sync instead of pushing on mere navigation.
        this.store.saveData(force === true);
      }
    }

    if (!silent) {
      this.renderPlan();
    }
    return snowballAdded;
  }

  // Materialize snowball payments and minimum-payment adjustments for the viewed
  // month AND the forward window that the balance walk spans, anchored at the
  // current real month. Forward day balances (CalculationService projects +6
  // months) and the today-anchored 30-day Minimum read materialized
  // transactions, so without this the planned snowball spend stayed invisible
  // until the user opened each month — the displayed Minimum could change just
  // by navigating. One projection drives every month in the window.
  ensureSnowballPaymentsForHorizon(viewYear, viewMonth, monthsAhead = SNOWBALL_FORWARD_HORIZON) {
    const settings = this.store.getDebtSnowballSettings() || {};
    const includeExtra = settings.autoGenerate === true;

    const today = new Date();
    const currentIndex = this.getMonthIndex(today.getFullYear(), today.getMonth());
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    // Always start at the current real month so the today-anchored Minimum is
    // stable; extend through the forward span of whichever month is later
    // (viewed or current). Past months are never mutated (allowMutation guards
    // inside ensureSnowballPaymentForMonth), so a past view collapses to the
    // current-month-forward window.
    const startIndex = currentIndex;
    const endIndex = Math.max(viewIndex, currentIndex) + monthsAhead;

    this.setCurrentViewMonth(viewYear, viewMonth);
    // Self-heal stranded/duplicate minimum-payment instances before the
    // projection reads "paid so far" or materializes anything, so balances and
    // payoff dates are computed from a clean set.
    if (this.cleanupOrphanedDebtMinimums()) {
      this.recurringManager.invalidateCache();
      this.store.saveData(false);
    }
    const projection = this.calculateSnowballProjection(
      viewYear,
      viewMonth,
      includeExtra,
      { captureThroughIndex: endIndex }
    );
    // Capture the exact payoff days from this projection so the calendar can
    // flag them at a glance.
    this._payoffDates = this.buildPayoffDateSet(projection.payoffByDebtId);
    // Sync minimum-payment end dates once for the whole window before
    // materializing individual months (each month then skips the redundant sync).
    if (this.syncMinimumPaymentEndDates(projection.payoffByDebtId)) {
      this.store.saveData(false);
    }

    let snowballAdded = false;
    for (let idx = startIndex; idx <= endIndex; idx++) {
      const y = Math.floor(idx / 12);
      const m = idx % 12;
      if (
        this.ensureSnowballPaymentForMonth(y, m, false, {
          projection,
          silent: true,
        })
      ) {
        snowballAdded = true;
      }
    }

    // Render the plan once, for the viewed month, from the shared projection.
    this.renderPlan(projection);
    return snowballAdded;
  }
}

window.DebtSnowballUI = DebtSnowballUI;
