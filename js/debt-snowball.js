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
  constructor(store, recurringManager, onUpdate) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onUpdate = onUpdate;
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
    this.snowballExtraInput = document.getElementById("snowballExtraAmount");
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
      variableAmount: recurringTransaction.variableAmount || false,
      variablePercentage: recurringTransaction.variablePercentage || 0,
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
    this.renderCashInfusions();
    this.renderPlan(projection);
    this.loadSnowballSettings();
  }

  loadSnowballSettings() {
    const settings = this.store.getDebtSnowballSettings();
    if (this.snowballExtraInput) {
      this.snowballExtraInput.value = settings.extraPayment || 0;
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
    Utils.buildVariableAmountOptions(this.debtAdvancedOptions, 'debt');
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

    const variableAmountCheck = document.getElementById(
      "debtVariableAmountCheck"
    );
    const variableAmountOptions = document.getElementById(
      "debtVariableAmountOptions"
    );
    if (variableAmountCheck) {
      variableAmountCheck.checked = debt?.variableAmount === true;
      if (variableAmountOptions) {
        variableAmountOptions.style.display = variableAmountCheck.checked
          ? "block"
          : "none";
      }
    }
    if (debt?.variableAmount) {
      const variablePercentage = document.getElementById("debtVariablePercentage");
      if (variablePercentage) {
        variablePercentage.value = Number(debt.variablePercentage) || 0;
      }
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
      variableAmount: false,
      variableType: "percentage",
      variablePercentage: 0,
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

    const variableAmountCheck = document.getElementById(
      "debtVariableAmountCheck"
    );
    if (variableAmountCheck && variableAmountCheck.checked) {
      const variablePercentage = document.getElementById("debtVariablePercentage");
      options.variableAmount = true;
      options.variableType = "percentage";
      options.variablePercentage = parseFloat(variablePercentage?.value || "0");
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

  ensureMinimumPaymentRecurring(debt) {
    if (!debt || !debt.id) return;
    const recurringUpdates = this.buildDebtRecurringTransaction(debt);
    if (debt.minRecurringId) {
      const updated = this.store.updateRecurringTransaction(
        debt.minRecurringId,
        recurringUpdates
      );
      if (updated) {
        this.recurringManager.invalidateCache();
        return;
      }
    }
    const recurringTransaction = {
      ...recurringUpdates,
      id: Utils.generateUniqueId(),
    };
    const recurringId = this.store.addRecurringTransaction(recurringTransaction);
    this.store.updateDebt(debt.id, { minRecurringId: recurringId });
    this.recurringManager.invalidateCache();
  }

  buildDebtRecurringTransaction(debt) {
    const recurrence = debt.recurrence || "monthly";
    const startDate = this.getDebtStartDateValue(debt);
    const dueDayPattern =
      recurrence === "monthly" && typeof debt.dueDayPattern === "string"
        ? debt.dueDayPattern
        : "";
    const recurringTransaction = {
      startDate,
      amount: debt.minPayment,
      type: "expense",
      description: `Debt Payment: ${debt.name}`,
      recurrence,
      daySpecific: Boolean(dueDayPattern),
      daySpecificData: dueDayPattern || null,
      semiMonthlyDays:
        recurrence === "semi-monthly" && Array.isArray(debt.semiMonthlyDays)
          ? [...debt.semiMonthlyDays]
          : null,
      semiMonthlyLastDay:
        recurrence === "semi-monthly" ? debt.semiMonthlyLastDay === true : null,
      customInterval:
        recurrence === "custom" && debt.customInterval
          ? { ...debt.customInterval }
          : null,
      businessDayAdjustment: debt.businessDayAdjustment || "none",
      variableAmount: debt.variableAmount === true,
      variableType:
        debt.variableAmount === true
          ? debt.variableType || "percentage"
          : null,
      variablePercentage:
        debt.variableAmount === true
          ? Number(debt.variablePercentage) || 0
          : null,
      endDate: debt.endDate || null,
      maxOccurrences:
        typeof debt.maxOccurrences === "number" && debt.maxOccurrences > 0
          ? debt.maxOccurrences
          : null,
      debtId: debt.id,
      debtRole: "minimum",
      debtName: debt.name,
    };
    return recurringTransaction;
  }

  getDaySpecificLabel(daySpecificData) {
    if (!daySpecificData) {
      return "";
    }
    const option = this.daySpecificOptions.find(
      (entry) => entry.value === daySpecificData
    );
    return option ? option.label : "";
  }

  getDateFromString(dateString) {
    if (!this.isValidDateString(dateString)) return null;
    const parts = dateString.split("-").map(Number);
    // Use noon to avoid DST shifts pushing the date across a midnight boundary.
    return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  }

  formatMonthDay(date) {
    if (!date) return "";
    const month = Utils.MONTH_LABELS[date.getMonth()] || "";
    return `${month} ${date.getDate()}`;
  }

  formatMonthYear(year, month) {
    const monthLabel = Utils.MONTH_LABELS[month] || "";
    if (!monthLabel || typeof year !== "number") {
      return "";
    }
    return `${monthLabel} ${year}`;
  }

  getMonthIndex(year, month) {
    return year * 12 + month;
  }

  // Convert a "YYYY-MM" extra-payment start month into a comparable month index.
  // Empty/invalid values return -Infinity so the extra payment applies from the
  // start of the projection (no restriction).
  parseExtraStartMonthIndex(startMonth) {
    if (typeof startMonth !== "string") {
      return -Infinity;
    }
    const match = startMonth.match(/^(\d{4})-(\d{2})$/);
    if (!match) {
      return -Infinity;
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!year || month < 1 || month > 12) {
      return -Infinity;
    }
    return this.getMonthIndex(year, month - 1);
  }

  getRecurringOccurrencesForMonth(recurringTransaction, year, month) {
    if (!recurringTransaction?.startDate || !recurringTransaction?.recurrence) {
      return [];
    }
    const transactions = {};
    const dummyStore = {
      getTransactions: () => transactions,
      getRecurringTransactions: () => [recurringTransaction],
      getSkippedTransactions: () => ({}),
      isTransactionSkipped: () => false,
      saveData: () => { },
    };
    const manager = new RecurringTransactionManager(dummyStore);
    manager.applyRecurringTransactions(year, month);
    const occurrences = [];
    Object.keys(transactions).forEach((dateString) => {
      transactions[dateString].forEach((t) => {
        if (t.recurringId === recurringTransaction.id) {
          occurrences.push({
            dateString,
            amount: Number(t.amount) || 0,
          });
        }
      });
    });
    occurrences.sort((a, b) => a.dateString.localeCompare(b.dateString));
    return occurrences;
  }

  getDebtScheduleLabel(debt) {
    const recurrence = debt?.recurrence || "monthly";
    const startDateString = this.getDebtStartDateValue(debt);
    const startDate = this.getDateFromString(startDateString);
    const dueDay = Math.min(Math.max(parseInt(debt?.dueDay || 1, 10), 1), 31);
    const patternLabel =
      recurrence === "monthly"
        ? this.getDaySpecificLabel(debt?.dueDayPattern)
        : "";

    switch (recurrence) {
      case "once":
        return startDateString
          ? `One-time (${Utils.formatDisplayDate(startDateString)})`
          : "One-time";
      case "daily":
        return "Daily";
      case "weekly":
        return startDate
          ? `Weekly (${WEEKDAY_LABELS[startDate.getDay()]})`
          : "Weekly";
      case "bi-weekly":
        return startDate
          ? `Bi-weekly (${WEEKDAY_LABELS[startDate.getDay()]})`
          : "Bi-weekly";
      case "semi-monthly": {
        const firstDay = Array.isArray(debt?.semiMonthlyDays)
          ? debt.semiMonthlyDays[0]
          : 1;
        const secondDay = Array.isArray(debt?.semiMonthlyDays)
          ? debt.semiMonthlyDays[1]
          : 15;
        const secondLabel =
          debt?.semiMonthlyLastDay === true || secondDay === 31
            ? "Last day"
            : secondDay;
        return `Twice a month (${firstDay} & ${secondLabel})`;
      }
      case "quarterly":
        return startDate
          ? `Quarterly (${this.formatMonthDay(startDate)})`
          : "Quarterly";
      case "semi-annual":
        return startDate
          ? `Semi-annual (${this.formatMonthDay(startDate)})`
          : "Semi-annual";
      case "yearly":
        return startDate
          ? `Yearly (${this.formatMonthDay(startDate)})`
          : "Yearly";
      case "custom": {
        const value = debt?.customInterval?.value || 1;
        const unit = debt?.customInterval?.unit || "days";
        const unitLabel =
          value === 1 ? unit.replace(/s$/, "") : unit;
        return `Every ${value} ${unitLabel}`;
      }
      case "monthly":
      default:
        if (patternLabel) {
          return `Monthly (${patternLabel})`;
        }
        return `Monthly (Day ${dueDay})`;
    }
  }

  getDebtDueDateForMonth(debt, year, month) {
    const recurringTemplate = this.buildDebtRecurringTransaction(debt);
    recurringTemplate.id =
      recurringTemplate.id || debt.minRecurringId || "debt-preview";
    const occurrences = this.getRecurringOccurrencesForMonth(
      recurringTemplate,
      year,
      month
    );
    if (!occurrences.length) {
      return null;
    }
    return this.getDateFromString(occurrences[0].dateString);
  }

  // Ensure every past debt-payment occurrence is materialized before the
  // snapshot reads "paid so far" from the transaction store. Debt minimum
  // payments are recurring and expanded lazily as months are viewed; without
  // this a debt whose schedule began before any rendered month reports too
  // little paid (and an inflated remaining balance) until the user happens to
  // navigate back. Expansion is cached, so repeat calls on a stable state are
  // cheap. Bounded by a guard for safety against far-past start dates.
  ensureDebtHistoryExpanded(cutoffDate = null) {
    if (!this.recurringManager) return;
    const recurrings = this.store
      .getRecurringTransactions()
      .filter((rt) => rt && rt.debtId && rt.startDate);
    if (!recurrings.length) return;
    let earliest = null;
    recurrings.forEach((rt) => {
      const start = Utils.parseDateString(rt.startDate);
      if (start && (!earliest || start < earliest)) {
        earliest = start;
      }
    });
    if (!earliest) return;
    const cutoff = cutoffDate instanceof Date ? cutoffDate : new Date();
    let year = earliest.getFullYear();
    let month = earliest.getMonth();
    const endYear = cutoff.getFullYear();
    const endMonth = cutoff.getMonth();
    let guard = 0;
    while (
      (year < endYear || (year === endYear && month <= endMonth)) &&
      guard < 1200
    ) {
      this.recurringManager.applyRecurringTransactions(year, month);
      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
      guard += 1;
    }
  }

  getHistoricalDebtSnapshot(cutoffDate = null) {
    const debts = this.store.getDebts();
    // Materialize past debt payments first so "paid"/"remaining" do not depend
    // on which months happen to have been rendered this session.
    this.ensureDebtHistoryExpanded(cutoffDate);
    const transactions = this.store.getTransactions();
    const cashInfusions = this.store.getCashInfusions();
    const cutoffDateString = cutoffDate
      ? Utils.formatDateString(cutoffDate)
      : null;
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const remainingByDebtId = {};
    const paidByDebtId = {};
    const debtNameById = {};
    const eventsByDate = new Map();

    const ensureDateBucket = (dateString) => {
      if (!eventsByDate.has(dateString)) {
        eventsByDate.set(dateString, {
          transactions: [],
          targetedInfusions: [],
          autoInfusions: [],
        });
      }
      return eventsByDate.get(dateString);
    };

    debts.forEach((debt) => {
      remainingByDebtId[debt.id] = roundToCents(Number(debt.balance) || 0);
      paidByDebtId[debt.id] = 0;
      debtNameById[debt.id] = debt.name || "";
    });

    Object.keys(transactions).forEach((dateKey) => {
      if (cutoffDateString && dateKey >= cutoffDateString) {
        return;
      }
      transactions[dateKey].forEach((t) => {
        if (!t.debtId || t.type !== "expense") {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(remainingByDebtId, t.debtId)) {
          return;
        }
        if (
          t.recurringId &&
          this.recurringManager &&
          this.recurringManager.isTransactionSkipped(dateKey, t.recurringId)
        ) {
          return;
        }
        ensureDateBucket(dateKey).transactions.push(t);
      });
    });

    cashInfusions.forEach((infusion) => {
      if (!infusion.date) return;
      if (cutoffDateString && infusion.date >= cutoffDateString) return;
      const amount = roundToCents(Number(infusion.amount) || 0);
      if (amount <= 0) return;

      const bucket = ensureDateBucket(infusion.date);
      if (
        infusion.targetDebtId &&
        Object.prototype.hasOwnProperty.call(
          remainingByDebtId,
          infusion.targetDebtId
        )
      ) {
        bucket.targetedInfusions.push({
          debtId: infusion.targetDebtId,
          amount,
        });
      } else {
        bucket.autoInfusions.push({ amount });
      }
    });

    const sortedDates = Array.from(eventsByDate.keys()).sort();
    sortedDates.forEach((dateKey) => {
      const bucket = eventsByDate.get(dateKey);
      bucket.transactions.forEach((transaction) => {
        const debtId = transaction.debtId;
        const amount = roundToCents(Number(transaction.amount) || 0);
        if (amount <= 0) {
          return;
        }
        paidByDebtId[debtId] = roundToCents(paidByDebtId[debtId] + amount);
        remainingByDebtId[debtId] = roundToCents(
          Math.max(0, remainingByDebtId[debtId] - amount)
        );
      });

      bucket.targetedInfusions.forEach((infusion) => {
        const currentBalance = Number(remainingByDebtId[infusion.debtId]) || 0;
        if (currentBalance <= 0) {
          return;
        }
        const applied = roundToCents(
          Math.min(currentBalance, Number(infusion.amount) || 0)
        );
        if (applied <= 0) {
          return;
        }
        paidByDebtId[infusion.debtId] = roundToCents(
          paidByDebtId[infusion.debtId] + applied
        );
        remainingByDebtId[infusion.debtId] = roundToCents(
          currentBalance - applied
        );
      });

      bucket.autoInfusions.forEach((infusion) => {
        let remainingInfusion = roundToCents(Number(infusion.amount) || 0);
        if (remainingInfusion <= 0) {
          return;
        }
        const debtOrder = Object.keys(remainingByDebtId)
          .filter((debtId) => remainingByDebtId[debtId] > 0)
          .sort((leftId, rightId) => {
            if (remainingByDebtId[leftId] !== remainingByDebtId[rightId]) {
              return remainingByDebtId[leftId] - remainingByDebtId[rightId];
            }
            return debtNameById[leftId].localeCompare(debtNameById[rightId]);
          });

        debtOrder.forEach((debtId) => {
          if (remainingInfusion <= 0) {
            return;
          }
          const currentBalance = Number(remainingByDebtId[debtId]) || 0;
          if (currentBalance <= 0) {
            return;
          }
          const applied = roundToCents(
            Math.min(currentBalance, remainingInfusion)
          );
          if (applied <= 0) {
            return;
          }
          paidByDebtId[debtId] = roundToCents(paidByDebtId[debtId] + applied);
          remainingByDebtId[debtId] = roundToCents(currentBalance - applied);
          remainingInfusion = roundToCents(remainingInfusion - applied);
        });
      });
    });

    return { paidByDebtId, remainingByDebtId };
  }

  getDebtSummaries(cutoffDate = null) {
    const debts = this.store.getDebts();
    const snapshot = this.getHistoricalDebtSnapshot(cutoffDate);
    return debts.map((debt) => {
      const paid = Number(snapshot.paidByDebtId[debt.id]) || 0;
      const remaining = Number(snapshot.remainingByDebtId[debt.id]) || 0;
      return {
        debt,
        paid,
        remaining,
      };
    });
  }

  calculateMonthlySnowballAllocation(
    balances,
    monthlyTotalsByDebtId,
    applySnowball,
    baseExtraPayment,
    rolloverAmount
  ) {
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const minPaidByDebtId = {};
    const balancesAfterMin = {};
    let inMonthRollover = 0;

    Object.keys(balances).forEach((debtId) => {
      const balance = Number(balances[debtId]) || 0;
      const scheduledMin = Number(monthlyTotalsByDebtId?.[debtId]) || 0;
      if (balance <= 0 || scheduledMin <= 0) {
        minPaidByDebtId[debtId] = 0;
        balancesAfterMin[debtId] = Math.max(0, balance);
        return;
      }
      const actualMin = Math.min(balance, scheduledMin);
      minPaidByDebtId[debtId] = roundToCents(actualMin);
      balancesAfterMin[debtId] = roundToCents(Math.max(0, balance - actualMin));
      if (scheduledMin > actualMin) {
        inMonthRollover = roundToCents(inMonthRollover + (scheduledMin - actualMin));
      }
    });

    const debtOrder = Object.keys(balancesAfterMin)
      .filter((debtId) => balancesAfterMin[debtId] > 0)
      .sort((leftId, rightId) => balancesAfterMin[leftId] - balancesAfterMin[rightId]);
    const targetDebtId = debtOrder.length ? debtOrder[0] : null;

    const snowballPaidByDebtId = {};
    let remainingSnowball = applySnowball
      ? roundToCents(
        (Number(baseExtraPayment) || 0) +
        (Number(rolloverAmount) || 0) +
        inMonthRollover
      )
      : 0;
    const balancesAfterPayments = { ...balancesAfterMin };

    debtOrder.forEach((debtId) => {
      if (remainingSnowball <= 0) return;
      const remainingBalance = Number(balancesAfterPayments[debtId]) || 0;
      if (remainingBalance <= 0) return;
      const applied = roundToCents(Math.min(remainingBalance, remainingSnowball));
      if (applied <= 0) return;
      snowballPaidByDebtId[debtId] = applied;
      balancesAfterPayments[debtId] = roundToCents(Math.max(0, remainingBalance - applied));
      remainingSnowball = roundToCents(remainingSnowball - applied);
    });

    const snowballAmount = roundToCents(
      Object.values(snowballPaidByDebtId).reduce(
        (sum, amount) => sum + (Number(amount) || 0),
        0
      )
    );

    return {
      minPaidByDebtId,
      snowballPaidByDebtId,
      balancesAfterPayments,
      targetDebtId,
      snowballAmount,
      inMonthRollover,
    };
  }

  calculateSnowballProjection(viewYear, viewMonth, includeExtra = true, options = {}) {
    const debts = this.store.getDebts();
    const settings = this.store.getDebtSnowballSettings();
    const baseExtraPayment = Number(settings.extraPayment) || 0;
    const extraStartIndex = this.parseExtraStartMonthIndex(
      settings.extraPaymentStartMonth
    );
    const applySnowball = includeExtra === true;
    // Per-debt allocation breakdowns are normally captured only for the viewed
    // month (that is all renderPlan needs). When materializing a forward window
    // the caller passes captureThroughIndex so the breakdowns needed to write
    // each future month's transactions are captured in a single projection run.
    const captureThroughIndex =
      typeof options.captureThroughIndex === "number"
        ? options.captureThroughIndex
        : null;
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const projectionStartDate = new Date(
      currentYear,
      currentMonth,
      today.getDate() + 1
    );
    const projectionStartDateString =
      Utils.formatDateString(projectionStartDate);
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    const currentIndex = this.getMonthIndex(currentYear, currentMonth);
    const baseYear = currentYear;
    const baseMonth = currentMonth;
    const baseDate = projectionStartDate;
    const baseSummaries = this.getDebtSummaries(baseDate);

    // For past month views, get historical balances for display
    let historicalViewBalances = null;
    if (viewIndex < currentIndex) {
      const viewDate = new Date(viewYear, viewMonth + 1, 1);
      const historicalSummaries = this.getDebtSummaries(viewDate);
      historicalViewBalances = {};
      historicalSummaries.forEach(({ debt, remaining }) => {
        historicalViewBalances[debt.id] = Number(remaining) || 0;
      });
    }
    let balances = {};
    const debtById = {};
    const recurringTemplates = {};
    baseSummaries.forEach(({ debt, remaining }) => {
      balances[debt.id] = Number(remaining) || 0;
      debtById[debt.id] = debt;
    });
    debts.forEach((debt) => {
      if (!debtById[debt.id]) {
        debtById[debt.id] = debt;
        balances[debt.id] = Number(debt.balance) || 0;
      }
      const template = this.buildDebtRecurringTransaction(debt);
      template.id =
        template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
      recurringTemplates[debt.id] = template;
    });

    // Group cash infusions by month
    const cashInfusions = this.store.getCashInfusions();
    const infusionsByMonthKey = {};
    cashInfusions.forEach((infusion) => {
      if (!infusion.date) return;
      const infusionDate = this.getDateFromString(infusion.date);
      if (!infusionDate) return;
      const infusionYear = infusionDate.getFullYear();
      const infusionMonth = infusionDate.getMonth();
      const key = `${infusionYear}-${String(infusionMonth + 1).padStart(2, "0")}`;
      if (!infusionsByMonthKey[key]) {
        infusionsByMonthKey[key] = [];
      }
      infusionsByMonthKey[key].push(infusion);
    });

    const payoffByDebtId = {};
    Object.keys(balances).forEach((debtId) => {
      if (balances[debtId] <= 0) {
        payoffByDebtId[debtId] = {
          year: baseYear,
          month: baseMonth,
          alreadyPaid: true,
        };
      }
    });

    const monthTargets = {};
    let viewBalances = null;
    const baseIndex = this.getMonthIndex(baseYear, baseMonth);
    const maxMonths = Math.max(
      600,
      viewIndex - baseIndex + 1,
      captureThroughIndex !== null ? captureThroughIndex - baseIndex + 1 : 0
    );
    let year = baseYear;
    let month = baseMonth;

    for (let i = 0; i < maxMonths; i++) {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      const monthIndex = this.getMonthIndex(year, month);
      const monthlyTotalsByDebtId = {};
      Object.keys(recurringTemplates).forEach((debtId) => {
        const template = recurringTemplates[debtId];
        if (!template) {
          monthlyTotalsByDebtId[debtId] = 0;
          return;
        }
        const occurrences = this.getRecurringOccurrencesForMonth(
          template,
          year,
          month
        );
        const filteredOccurrences =
          year === currentYear && month === currentMonth
            ? occurrences.filter(
              (occurrence) =>
                occurrence.dateString >= projectionStartDateString
            )
            : occurrences;
        const totalPayment = roundToCents(
          filteredOccurrences.reduce(
            (sum, occurrence) => sum + occurrence.amount,
            0
          )
        );
        monthlyTotalsByDebtId[debtId] = totalPayment;
      });

      Object.keys(balances).forEach((debtId) => {
        const debt = debtById[debtId];
        const balance = Number(balances[debtId]) || 0;
        const interestRate =
          debt && typeof debt.interestRate === "number"
            ? debt.interestRate
            : Number(debt?.interestRate) || 0;
        if (balance <= 0 || interestRate <= 0) {
          return;
        }
        const interest = roundToCents((balance * interestRate) / 1200);
        if (interest <= 0) {
          return;
        }
        balances[debtId] = roundToCents(balance + interest);
      });

      const activeDebtIds = Object.keys(balances).filter(
        (debtId) => balances[debtId] > 0
      );
      if (!activeDebtIds.length) {
        break;
      }
      const rolloverAmount = applySnowball
        ? Object.keys(monthlyTotalsByDebtId).reduce((sum, debtId) => {
          const payoff = payoffByDebtId[debtId];
          if (!payoff) {
            return sum;
          }
          const payoffIndex = this.getMonthIndex(payoff.year, payoff.month);
          const eligible =
            payoff.alreadyPaid === true
              ? payoffIndex <= monthIndex
              : payoffIndex < monthIndex;
          if (!eligible) {
            return sum;
          }
          const monthlyTotal = Number(monthlyTotalsByDebtId[debtId]) || 0;
          if (monthlyTotal <= 0) {
            return sum;
          }
          return sum + monthlyTotal;
        }, 0)
        : 0;

      // Calculate cash infusion amount for this month
      const monthInfusions = (infusionsByMonthKey[monthKey] || []).filter(
        (infusion) =>
          !(
            year === currentYear &&
            month === currentMonth &&
            infusion.date < projectionStartDateString
          )
      );
      let generalInfusionAmount = 0;
      const targetedInfusionsByDebtId = {};
      monthInfusions.forEach((infusion) => {
        const amount = Number(infusion.amount) || 0;
        if (amount <= 0) return;
        if (infusion.targetDebtId && balances[infusion.targetDebtId] > 0) {
          // Targeted infusion
          if (!targetedInfusionsByDebtId[infusion.targetDebtId]) {
            targetedInfusionsByDebtId[infusion.targetDebtId] = 0;
          }
          targetedInfusionsByDebtId[infusion.targetDebtId] += amount;
        } else {
          // Auto infusion (snowball priority)
          generalInfusionAmount += amount;
        }
      });

      // Cash infusions are external windfalls (e.g., a tax refund) applied
      // straight to debt. They reduce the debt balance / accelerate payoff here
      // but are intentionally NOT materialized as calendar expenses — they are
      // not drawn from the tracked checking balance. (Contrast snowball extra
      // payments, which are real outflows and DO appear on the calendar.)
      // Apply targeted infusions directly to specific debts
      Object.keys(targetedInfusionsByDebtId).forEach((debtId) => {
        const infusionAmount = targetedInfusionsByDebtId[debtId];
        const currentBalance = Number(balances[debtId]) || 0;
        if (currentBalance <= 0) return;
        const applied = Math.min(currentBalance, infusionAmount);
        balances[debtId] = roundToCents(currentBalance - applied);
        if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
          payoffByDebtId[debtId] = { year, month };
        }
      });

      // Apply auto-priority (general) infusions to smallest-balance debts.
      // This runs regardless of applySnowball — infusions are real money the
      // user is putting toward debt and shouldn't be discarded just because
      // the user has the snowball strategy disabled.
      if (generalInfusionAmount > 0) {
        const order = Object.keys(balances)
          .filter((id) => balances[id] > 0)
          .sort((a, b) => balances[a] - balances[b]);
        let remaining = roundToCents(generalInfusionAmount);
        for (const debtId of order) {
          if (remaining <= 0) break;
          const currentBalance = Number(balances[debtId]) || 0;
          if (currentBalance <= 0) continue;
          const applied = roundToCents(Math.min(currentBalance, remaining));
          if (applied <= 0) continue;
          balances[debtId] = roundToCents(currentBalance - applied);
          remaining = roundToCents(remaining - applied);
          if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
            payoffByDebtId[debtId] = { year, month };
          }
        }
      }

      // Only apply the base extra payment once the user-selected start month
      // is reached. Rollovers from paid-off debts still snowball regardless.
      const effectiveExtraPayment =
        monthIndex >= extraStartIndex ? baseExtraPayment : 0;

      const allocation = this.calculateMonthlySnowballAllocation(
        balances,
        monthlyTotalsByDebtId,
        applySnowball,
        effectiveExtraPayment,
        rolloverAmount
      );
      balances = { ...allocation.balancesAfterPayments };

      Object.keys(balances).forEach((debtId) => {
        if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
          payoffByDebtId[debtId] = { year, month };
        }
      });

      const monthInfo = {
        targetDebtId: allocation.targetDebtId,
        snowballAmount: allocation.snowballAmount,
        rolloverAmount,
        baseExtraPayment: effectiveExtraPayment,
        infusionAmount: generalInfusionAmount,
        targetedInfusions: targetedInfusionsByDebtId,
        inMonthRollover: allocation.inMonthRollover,
      };
      const isViewMonth = year === viewYear && month === viewMonth;
      const inCaptureWindow =
        captureThroughIndex !== null &&
        monthIndex >= currentIndex &&
        monthIndex <= captureThroughIndex;
      if (isViewMonth || inCaptureWindow) {
        monthInfo.minPaidByDebtId = allocation.minPaidByDebtId;
        monthInfo.snowballPaidByDebtId = allocation.snowballPaidByDebtId;
        monthInfo.monthlyTotalsByDebtId = monthlyTotalsByDebtId;
      }
      monthTargets[monthKey] = monthInfo;
      if (viewBalances === null && year === viewYear && month === viewMonth) {
        viewBalances = { ...balances };
      }

      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    if (viewBalances === null) {
      // For past months, use historical balances; otherwise use projected balances
      viewBalances = historicalViewBalances || { ...balances };
    }

    return {
      baseYear,
      baseMonth,
      viewYear,
      viewMonth,
      viewBalances,
      payoffByDebtId,
      monthTargets,
      extraPayment: baseExtraPayment,
      applySnowball,
    };
  }

  setCurrentViewMonth(year, month) {
    this.currentViewYear = year;
    this.currentViewMonth = month;
  }

  // Resolve the actual (business-day-adjusted) date of a debt's minimum payment
  // in a given month, honoring its recurrence type. Used to anchor the recurring
  // endDate to the real payment date so an adjusted payment (e.g. a due date
  // shifted onto the next business day) is still retained, and the next month's
  // payment is excluded. Returns the latest in-month occurrence; if the payment
  // was adjusted across the month boundary, returns the spilled occurrence in
  // the following month. Null if no occurrence can be resolved.
  getMinimumPaymentPayoffDate(debt, payoffYear, payoffMonth) {
    const template = this.buildDebtRecurringTransaction(debt);
    template.id = template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
    // Ignore any cap so the payoff-month occurrence is always resolvable.
    template.endDate = null;
    template.maxOccurrences = null;

    const inMonth = this.getRecurringOccurrencesForMonth(
      template,
      payoffYear,
      payoffMonth
    );
    if (inMonth.length) {
      return inMonth[inMonth.length - 1].dateString;
    }
    // No occurrence landed in the payoff month — a business-day adjustment may
    // have pushed it into the next month. The spilled payment is that month's
    // earliest occurrence.
    let nextYear = payoffYear;
    let nextMonth = payoffMonth + 1;
    if (nextMonth > 11) {
      nextMonth = 0;
      nextYear += 1;
    }
    const inNext = this.getRecurringOccurrencesForMonth(
      template,
      nextYear,
      nextMonth
    );
    if (inNext.length) {
      return inNext[0].dateString;
    }
    return null;
  }

  // Compute the date a debt's minimum-payment recurring should stop expanding.
  // The recurrence is ended at the debt's projected payoff so the minimum
  // payment never appears after the debt is paid off. Any user-set debt.endDate
  // still applies and wins if it is earlier.
  computeMinimumPaymentEndDate(debt, payoff) {
    const userEnd = debt && debt.endDate ? debt.endDate : null;
    let payoffEnd = null;
    if (payoff && typeof payoff.year === "number" && typeof payoff.month === "number") {
      if (payoff.alreadyPaid === true) {
        // Already at zero: end the month before "now" so no payment shows in the
        // current or future months.
        let endYear = payoff.year;
        let endMonth = payoff.month - 1;
        if (endMonth < 0) {
          endMonth = 11;
          endYear -= 1;
        }
        const lastDay = new Date(endYear, endMonth + 1, 0, 12, 0, 0);
        payoffEnd = Utils.formatDateString(lastDay);
      } else {
        // Pays off during the projection: keep the payment that clears it,
        // anchored to its real (possibly adjusted) date.
        payoffEnd = this.getMinimumPaymentPayoffDate(
          debt,
          payoff.year,
          payoff.month
        );
        if (!payoffEnd) {
          const lastDay = new Date(payoff.year, payoff.month + 1, 0, 12, 0, 0);
          payoffEnd = Utils.formatDateString(lastDay);
        }
      }
    }
    if (userEnd && payoffEnd) {
      return userEnd < payoffEnd ? userEnd : payoffEnd;
    }
    return userEnd || payoffEnd || null;
  }

  // Keep each debt's minimum-payment recurring transaction ended at its
  // projected payoff. Ending the recurrence (rather than deleting materialized
  // instances) is durable: every consumer that re-expands recurring
  // transactions — the calendar grid, the day-detail modal, balance
  // calculations, search and CSV export — naturally stops generating the
  // payment past payoff. Writes only when the value actually changes so this
  // does not churn cloud sync, and invalidates the expansion cache so the next
  // expansion reflects the new bound.
  syncMinimumPaymentEndDates(payoffByDebtId) {
    const recurrings = this.store.getRecurringTransactions();
    let changed = false;
    this.store.getDebts().forEach((debt) => {
      if (!debt || !debt.minRecurringId) {
        return;
      }
      const rt = recurrings.find((r) => r.id === debt.minRecurringId);
      if (!rt) {
        return;
      }
      const desired = this.computeMinimumPaymentEndDate(
        debt,
        payoffByDebtId ? payoffByDebtId[debt.id] : null
      );
      const current = rt.endDate ? rt.endDate : null;
      if (current !== desired) {
        rt.endDate = desired;
        rt._lastModified = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) {
      this.recurringManager.invalidateCache();
    }
    return changed;
  }

  prunePaidOffDebtMinimumPayments(year, month, payoffByDebtId) {
    const transactions = this.store.getTransactions();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const viewIndex = this.getMonthIndex(year, month);
    let changed = false;

    Object.keys(transactions).forEach((dateKey) => {
      if (!dateKey.startsWith(monthPrefix)) {
        return;
      }
      const list = transactions[dateKey];
      const filtered = list.filter((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return true;
        }
        const payoff = payoffByDebtId?.[t.debtId];
        if (!payoff) {
          return true;
        }
        const payoffIndex = this.getMonthIndex(payoff.year, payoff.month);
        const shouldPrune =
          payoff.alreadyPaid === true
            ? payoffIndex <= viewIndex
            : payoffIndex < viewIndex;
        if (shouldPrune) {
          changed = true;
          return false;
        }
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    return changed;
  }

  // Remove debt minimum-payment instances that the recurrence would no longer
  // generate: occurrences that fall outside the recurring's [startDate,endDate]
  // window, or duplicate occurrences on the same date. These strand when a
  // debt's recurrence window changes — Convert-to-Debt deriving a new start
  // date, a due-date edit, or the payoff-driven endDate sync. Because the
  // snowball engine flags every minimum it adjusts (zeroed/partial/hidden) with
  // modifiedInstance, the recurring manager treats them as hand-edits and never
  // deletes or regenerates them, so they persist with stale amounts before the
  // start date or past payoff, corrupting "paid so far" and the balance walk.
  // Scans all dates (strandings can sit far outside the materialized horizon)
  // and runs once per render via ensureSnowballPaymentsForHorizon, which then
  // re-expands and re-adjusts a clean set within the current window.
  cleanupOrphanedDebtMinimums() {
    const transactions = this.store.getTransactions();
    const recurringById = new Map(
      this.store.getRecurringTransactions().map((rt) => [rt.id, rt])
    );
    let changed = false;

    Object.keys(transactions).forEach((dateKey) => {
      const list = transactions[dateKey];
      if (!Array.isArray(list)) {
        return;
      }
      const seenOccurrences = new Set();
      const filtered = list.filter((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return true;
        }
        const rt = recurringById.get(t.recurringId);
        if (!rt) {
          // Recurrence definition is gone — orphaned instance.
          changed = true;
          return false;
        }
        // Compare on the scheduled occurrence (originalDate when a business-day
        // adjustment moved the placed date), so legitimately shifted payments
        // are judged by their real due date, not their landing date.
        const occurrence = t.originalDate || dateKey;
        if (
          (rt.startDate && occurrence < rt.startDate) ||
          (rt.endDate && occurrence > rt.endDate)
        ) {
          changed = true;
          return false;
        }
        const occurrenceKey = `${t.recurringId}|${occurrence}`;
        if (seenOccurrences.has(occurrenceKey)) {
          changed = true;
          return false;
        }
        seenOccurrences.add(occurrenceKey);
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    return changed;
  }

  adjustMinimumPaymentTransactions(year, month, minPaidByDebtId) {
    if (!minPaidByDebtId || typeof minPaidByDebtId !== "object") {
      return false;
    }
    const transactions = this.store.getTransactions();
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const minOccurrencesByDebtId = {};

    Object.keys(transactions).forEach((dateKey) => {
      if (!dateKey.startsWith(monthPrefix)) {
        return;
      }
      transactions[dateKey].forEach((t) => {
        if (t.debtRole !== "minimum" || !t.debtId || !t.recurringId) {
          return;
        }
        if (!Object.prototype.hasOwnProperty.call(minPaidByDebtId, t.debtId)) {
          return;
        }
        if (!minOccurrencesByDebtId[t.debtId]) {
          minOccurrencesByDebtId[t.debtId] = [];
        }
        minOccurrencesByDebtId[t.debtId].push({ dateKey, transaction: t });
      });
    });

    const epsilon = 0.01;
    let changed = false;

    Object.keys(minOccurrencesByDebtId).forEach((debtId) => {
      const targetTotal = Math.max(0, Number(minPaidByDebtId[debtId]) || 0);
      const occurrences = minOccurrencesByDebtId[debtId].sort((a, b) =>
        a.dateKey.localeCompare(b.dateKey)
      );
      const currentTotal = occurrences.reduce(
        (sum, occ) => sum + (Number(occ.transaction.amount) || 0),
        0
      );
      if (currentTotal <= targetTotal + epsilon) {
        return;
      }
      let remaining = targetTotal;
      for (let i = occurrences.length - 1; i >= 0; i--) {
        const { transaction } = occurrences[i];
        const amount = Number(transaction.amount) || 0;
        if (remaining <= epsilon) {
          if (amount !== 0 || transaction.hidden !== true) {
            transaction.amount = 0;
            transaction.hidden = true;
            transaction.modifiedInstance = true;
            changed = true;
          } else if (transaction.modifiedInstance !== true) {
            transaction.modifiedInstance = true;
            changed = true;
          }
          continue;
        }
        if (amount > remaining + epsilon) {
          if (Math.abs(amount - remaining) > epsilon || transaction.hidden === true) {
            transaction.amount = remaining;
            transaction.hidden = false;
            transaction.modifiedInstance = true;
            changed = true;
          } else if (transaction.modifiedInstance !== true) {
            transaction.modifiedInstance = true;
            changed = true;
          }
          remaining = 0;
        } else {
          if (transaction.hidden === true) {
            transaction.hidden = false;
            transaction.modifiedInstance = true;
            changed = true;
          }
          remaining -= amount;
        }
      }
    });

    return changed;
  }

  getRolloverAvailableDate(
    year,
    month,
    minPaidByDebtId,
    monthlyTotalsByDebtId,
    debtsById
  ) {
    if (!minPaidByDebtId || !monthlyTotalsByDebtId || !debtsById) {
      return null;
    }
    const epsilon = 0.01;
    let latestDate = null;
    Object.keys(monthlyTotalsByDebtId).forEach((debtId) => {
      const scheduled = Number(monthlyTotalsByDebtId[debtId]) || 0;
      const actual = Number(minPaidByDebtId[debtId]) || 0;
      if (scheduled <= actual + epsilon) {
        return;
      }
      const debt = debtsById.get(debtId);
      if (!debt) {
        return;
      }
      const recurringTemplate = this.buildDebtRecurringTransaction(debt);
      recurringTemplate.id =
        recurringTemplate.id || debt.minRecurringId || "debt-preview";
      const occurrences = this.getRecurringOccurrencesForMonth(
        recurringTemplate,
        year,
        month
      );
      if (!occurrences.length) {
        return;
      }
      const dueDate = this.getDateFromString(
        occurrences[occurrences.length - 1].dateString
      );
      if (!dueDate) {
        return;
      }
      if (!latestDate || dueDate > latestDate) {
        latestDate = dueDate;
      }
    });
    return latestDate;
  }

  syncSnowballTransactionsForMonth(
    year,
    month,
    monthKey,
    expectedPayments,
    includeExtra
  ) {
    const transactions = this.store.getTransactions();
    const expectedByDebtId = new Map();
    expectedPayments.forEach((payment) => {
      expectedByDebtId.set(payment.debtId, { ...payment, matched: false });
    });
    const epsilon = 0.01;
    let changed = false;
    let snowballAdded = false;

    // Scan every date (not just this month's) so a snowball row that drifted
    // into an adjacent month — e.g. a payoff payment pushed by a business-day
    // adjustment — is still reconciled against monthKey instead of being left
    // behind as a stray that double-counts.
    Object.keys(transactions).forEach((dateKey) => {
      const list = transactions[dateKey];
      const filtered = list.filter((t) => {
        const isSnowball =
          t.snowballGenerated === true && t.snowballMonth === monthKey;
        if (!isSnowball) {
          return true;
        }
        if (!includeExtra) {
          changed = true;
          return false;
        }
        const expected = expectedByDebtId.get(t.debtId);
        // Drop rows that are no longer expected, drifted to the wrong date, or
        // duplicate an expected payment we already matched. The last condition
        // self-heals previously materialized duplicate snowball rows, which
        // otherwise persist forever and double-count as real outflows.
        if (
          !expected ||
          expected.dateString !== dateKey ||
          expected.matched === true
        ) {
          changed = true;
          return false;
        }
        const expectedDescription = `Snowball Payment: ${expected.debtName}`;
        if (Math.abs(Number(t.amount) - expected.amount) > epsilon) {
          t.amount = expected.amount;
          changed = true;
        }
        if (t.description !== expectedDescription) {
          t.description = expectedDescription;
          changed = true;
        }
        expected.matched = true;
        return true;
      });
      if (filtered.length !== list.length) {
        if (filtered.length === 0) {
          delete transactions[dateKey];
        } else {
          transactions[dateKey] = filtered;
        }
      }
    });

    if (includeExtra) {
      expectedByDebtId.forEach((expected) => {
        if (expected.matched || expected.amount <= epsilon || !expected.dateString) {
          return;
        }
        const transaction = {
          amount: expected.amount,
          type: "expense",
          description: `Snowball Payment: ${expected.debtName}`,
          debtId: expected.debtId,
          debtRole: "snowball",
          debtName: expected.debtName,
          snowballMonth: monthKey,
          snowballGenerated: true,
        };
        this.store.addTransaction(expected.dateString, transaction);
        snowballAdded = true;
      });
    }

    if (changed && !snowballAdded) {
      // Use saveData(false) for automatic maintenance - saves locally but doesn't trigger cloud sync
      this.store.saveData(false);
    }

    return { changed, snowballAdded };
  }

  renderDebts() {
    if (!this.debtList) return;
    this.debtList.innerHTML = "";
    const debts = this.store.getDebts();
    if (debts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debt-empty";
      empty.textContent = "No debts added yet.";
      this.debtList.appendChild(empty);
      return;
    }
    const today = new Date();
    const viewYear =
      typeof this.currentViewYear === "number"
        ? this.currentViewYear
        : today.getFullYear();
    const viewMonth =
      typeof this.currentViewMonth === "number"
        ? this.currentViewMonth
        : today.getMonth();
    const cutoff = new Date(viewYear, viewMonth + 1, 1);
    const summaries = this.getDebtSummaries(cutoff);
    const summaryMap = {};
    summaries.forEach((s) => { summaryMap[s.debt.id] = s; });
    debts.forEach((debt) => {
      const balance = Number(debt.balance) || 0;
      const summary = summaryMap[debt.id];
      const paid = summary ? summary.paid : 0;
      const minPayment = Number(debt.minPayment) || 0;
      const scheduleLabel = this.getDebtScheduleLabel(debt);
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
      meta.textContent = `Balance $${balance.toFixed(
        2
      )} • Paid $${paid.toFixed(2)} • Min $${minPayment.toFixed(
        2
      )} • Due ${scheduleLabel}${interest}`;
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

  renderHero(projection) {
    if (!this.heroEl) return;
    this.heroEl.innerHTML = "";

    const debts = this.store.getDebts();
    const viewBalances = (projection && projection.viewBalances) || {};
    const summaries = debts
      .map((debt) => ({
        debt,
        remaining: Math.max(
          0,
          typeof viewBalances[debt.id] === "number"
            ? viewBalances[debt.id]
            : Number(debt.balance) || 0
        ),
      }))
      .filter((summary) => summary.remaining > 0);

    if (summaries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "snowball-hero-empty";
      empty.textContent =
        debts.length === 0
          ? "Add your first debt below to project your debt-free date."
          : "🎉 Every debt is projected paid off.";
      this.heroEl.appendChild(empty);
      return;
    }

    const totalDebt = summaries.reduce((sum, s) => sum + s.remaining, 0);

    // Projected debt-free date = the latest payoff among active debts. If any
    // active debt never clears within the projection horizon it has no payoff
    // entry, so the date is unknown (payments don't outrun interest).
    let debtFreeIndex = -Infinity;
    let debtFree = null;
    let allHavePayoff = true;
    summaries.forEach((s) => {
      const payoff = projection.payoffByDebtId
        ? projection.payoffByDebtId[s.debt.id]
        : null;
      if (!payoff) {
        allHavePayoff = false;
        return;
      }
      const idx = this.getMonthIndex(payoff.year, payoff.month);
      if (idx > debtFreeIndex) {
        debtFreeIndex = idx;
        debtFree = payoff;
      }
    });

    const baseIndex = this.getMonthIndex(
      projection.baseYear,
      projection.baseMonth
    );
    const monthsToGo =
      allHavePayoff && debtFree ? Math.max(0, debtFreeIndex - baseIndex) : null;

    const monthKey = `${projection.viewYear}-${String(
      projection.viewMonth + 1
    ).padStart(2, "0")}`;
    const monthInfo =
      (projection.monthTargets && projection.monthTargets[monthKey]) || {};
    const snowballAmount = Number(monthInfo.snowballAmount) || 0;

    const formatWhole = (value) =>
      `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

    const makeCard = ({ label, value, sub, primary }) => {
      const card = document.createElement("div");
      card.className = primary
        ? "snowball-hero-card snowball-hero-primary"
        : "snowball-hero-card";
      const labelEl = document.createElement("div");
      labelEl.className = "snowball-hero-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("div");
      valueEl.className = "snowball-hero-value";
      valueEl.textContent = value;
      card.appendChild(labelEl);
      card.appendChild(valueEl);
      if (sub) {
        const subEl = document.createElement("div");
        subEl.className = "snowball-hero-sub";
        subEl.textContent = sub;
        card.appendChild(subEl);
      }
      return card;
    };

    let primaryValue;
    let primarySub;
    if (allHavePayoff && debtFree) {
      primaryValue = this.formatMonthYear(debtFree.year, debtFree.month);
      primarySub =
        monthsToGo === 0
          ? "Paid off this month"
          : `${monthsToGo} month${monthsToGo === 1 ? "" : "s"} to go`;
    } else {
      primaryValue = "Not yet on track";
      primarySub = "Payments don't cover all interest";
    }
    this.heroEl.appendChild(
      makeCard({
        label: "Projected debt-free",
        value: primaryValue,
        sub: primarySub,
        primary: true,
      })
    );

    this.heroEl.appendChild(
      makeCard({
        label: "Total debt",
        value: formatWhole(totalDebt),
        sub: `${summaries.length} debt${
          summaries.length === 1 ? "" : "s"
        } remaining`,
      })
    );

    this.heroEl.appendChild(
      makeCard({
        label: "Snowball / month",
        value: formatWhole(snowballAmount),
        sub:
          snowballAmount > 0
            ? "Extra applied to your target"
            : "Add an extra payment to speed this up",
      })
    );
  }

  renderPlan(projection) {
    if (!this.planList || !this.planSummary) return;
    this.planList.innerHTML = "";
    this.planSummary.innerHTML = "";
    const settings = this.store.getDebtSnowballSettings();
    const viewYear = projection?.viewYear ?? new Date().getFullYear();
    const viewMonth = projection?.viewMonth ?? new Date().getMonth();
    if (!projection) {
      projection = this.calculateSnowballProjection(viewYear, viewMonth, true);
    }
    const viewBalances = projection.viewBalances || {};
    const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
    const monthInfo = projection.monthTargets?.[monthKey] || {};
    const targetDebtId = monthInfo.targetDebtId;
    const summaries = this.store
      .getDebts()
      .map((debt) => ({
        debt,
        remaining: Math.max(
          0,
          typeof viewBalances[debt.id] === "number"
            ? viewBalances[debt.id]
            : Number(debt.balance) || 0
        ),
      }))
      // Keep debts that still carry a balance at month end, plus the debt this
      // month's snowball actually targets even when the snowball clears it this
      // month (remaining 0). Otherwise the targeted debt drops out and the
      // "Current target" line falls back to the next surviving debt, wrongly
      // attributing this month's payment to a debt it isn't paying down yet.
      .filter(
        (summary) => summary.remaining > 0 || summary.debt.id === targetDebtId
      );

    if (summaries.length === 0) {
      this.planSummary.textContent = "No active debts to target.";
      return;
    }
    const target =
      (targetDebtId &&
        summaries.find((summary) => summary.debt.id === targetDebtId)) ||
      [...summaries].sort((a, b) => a.remaining - b.remaining)[0];
    const summaryText = document.createElement("div");
    summaryText.className = "debt-plan-summary";
    const viewLabel = this.formatMonthYear(viewYear, viewMonth);
    summaryText.textContent = `Current target${viewLabel ? ` (${viewLabel})` : ""}: ${target.debt.name
      } (Projected $${target.remaining.toFixed(2)})`;
    this.planSummary.appendChild(summaryText);

    const extraText = document.createElement("div");
    extraText.className = "debt-plan-extra";
    const baseExtraPayment = Number(monthInfo.baseExtraPayment) || 0;
    const snowballAmount = Number(monthInfo.snowballAmount) || 0;
    const rolloverAmount = Number(monthInfo.rolloverAmount) || 0;
    const inMonthRollover = Number(monthInfo.inMonthRollover) || 0;
    // The breakdown must reconcile with the "Snowball payment this month" total,
    // which is the materialized calendar outflow. Cash infusions are applied
    // straight to debt and are NOT part of that outflow, so they are shown
    // separately in the cash-infusion list, not folded in here.
    const breakdownParts = [`Base $${baseExtraPayment.toFixed(2)}`];
    if (rolloverAmount > 0) {
      breakdownParts.push(`Rollovers $${rolloverAmount.toFixed(2)}`);
    }
    if (inMonthRollover > 0) {
      breakdownParts.push(`Same-month $${inMonthRollover.toFixed(2)}`);
    }
    extraText.textContent = `Snowball payment this month: $${snowballAmount.toFixed(
      2
    )} (${breakdownParts.join(" + ")})`;
    this.planSummary.appendChild(extraText);

    const summariesByPayoff = [...summaries].sort((a, b) => {
      const payoffA = projection.payoffByDebtId?.[a.debt.id];
      const payoffB = projection.payoffByDebtId?.[b.debt.id];
      const indexA = payoffA
        ? this.getMonthIndex(payoffA.year, payoffA.month)
        : Number.POSITIVE_INFINITY;
      const indexB = payoffB
        ? this.getMonthIndex(payoffB.year, payoffB.month)
        : Number.POSITIVE_INFINITY;
      if (indexA !== indexB) {
        return indexA - indexB;
      }
      if (a.remaining !== b.remaining) {
        return a.remaining - b.remaining;
      }
      return a.debt.name.localeCompare(b.debt.name);
    });

    summariesByPayoff.forEach((summary, index) => {
      const isTarget = summary.debt.id === target.debt.id;
      const item = document.createElement("div");
      item.className = "debt-plan-item";
      if (isTarget) {
        item.classList.add("debt-plan-target");
      }
      const payoff = projection.payoffByDebtId?.[summary.debt.id];
      const payoffLabel = payoff
        ? this.formatMonthYear(payoff.year, payoff.month)
        : "No payoff scheduled";

      const head = document.createElement("div");
      head.className = "debt-plan-item-head";

      const rank = document.createElement("span");
      rank.className = "debt-plan-rank";
      rank.textContent = index + 1;

      const name = document.createElement("span");
      name.className = "debt-plan-name";
      name.textContent = summary.debt.name;
      if (isTarget) {
        const badge = document.createElement("span");
        badge.className = "debt-plan-badge";
        badge.textContent = "Target";
        name.appendChild(badge);
      }

      const payoffSpan = document.createElement("span");
      payoffSpan.className = "debt-plan-payoff";
      payoffSpan.textContent = payoffLabel;

      head.appendChild(rank);
      head.appendChild(name);
      head.appendChild(payoffSpan);
      item.appendChild(head);

      // Progress = how much of the original balance is projected paid off.
      const original = Number(summary.debt.balance) || 0;
      const paidFraction =
        original > 0
          ? Math.min(1, Math.max(0, (original - summary.remaining) / original))
          : 0;
      const progress = document.createElement("div");
      progress.className = "debt-plan-progress";
      const fill = document.createElement("div");
      fill.className = "debt-plan-progress-fill";
      fill.style.width = `${Math.round(paidFraction * 100)}%`;
      progress.appendChild(fill);
      item.appendChild(progress);

      const figures = document.createElement("div");
      figures.className = "debt-plan-figures";
      figures.textContent =
        original > 0
          ? `$${summary.remaining.toFixed(2)} left of $${original.toFixed(
              2
            )} (${Math.round(paidFraction * 100)}% paid)`
          : `$${summary.remaining.toFixed(2)} remaining`;
      item.appendChild(figures);

      this.planList.appendChild(item);
    });
  }

  // Cash Infusion Methods

  populateCashInfusionTargetOptions() {
    if (!this.cashInfusionTargetInput) return;
    // Clear existing options except the first "Auto" option
    while (this.cashInfusionTargetInput.options.length > 1) {
      this.cashInfusionTargetInput.remove(1);
    }
    // Add debt options
    const debts = this.store.getDebts();
    debts.forEach((debt) => {
      const option = document.createElement("option");
      option.value = debt.id;
      option.textContent = debt.name;
      this.cashInfusionTargetInput.appendChild(option);
    });
  }

  showCashInfusionForm(infusion = null) {
    if (!this.cashInfusionForm) return;
    this.populateCashInfusionTargetOptions();
    if (infusion) {
      this.editingCashInfusionId = infusion.id;
      if (this.cashInfusionFormTitle) {
        this.cashInfusionFormTitle.textContent = "Edit Cash Infusion";
      }
      if (this.cashInfusionNameInput) {
        this.cashInfusionNameInput.value = infusion.name || "";
      }
      if (this.cashInfusionAmountInput) {
        this.cashInfusionAmountInput.value = infusion.amount || "";
      }
      if (this.cashInfusionDateInput) {
        this.cashInfusionDateInput.value = infusion.date || "";
      }
      if (this.cashInfusionTargetInput) {
        this.cashInfusionTargetInput.value = infusion.targetDebtId || "";
      }
    } else {
      this.editingCashInfusionId = null;
      if (this.cashInfusionFormTitle) {
        this.cashInfusionFormTitle.textContent = "Add Cash Infusion";
      }
      if (this.cashInfusionNameInput) {
        this.cashInfusionNameInput.value = "";
      }
      if (this.cashInfusionAmountInput) {
        this.cashInfusionAmountInput.value = "";
      }
      if (this.cashInfusionDateInput) {
        // Default to today's date
        this.cashInfusionDateInput.value = Utils.formatDateString(new Date());
      }
      if (this.cashInfusionTargetInput) {
        this.cashInfusionTargetInput.value = "";
      }
    }
    this.cashInfusionForm.style.display = "block";
    if (this.cashInfusionNameInput) {
      this.cashInfusionNameInput.focus();
    }
  }

  hideCashInfusionForm() {
    if (!this.cashInfusionForm) return;
    this.cashInfusionForm.style.display = "none";
    this.editingCashInfusionId = null;
    if (this.cashInfusionNameInput) {
      this.cashInfusionNameInput.value = "";
    }
    if (this.cashInfusionAmountInput) {
      this.cashInfusionAmountInput.value = "";
    }
    if (this.cashInfusionDateInput) {
      this.cashInfusionDateInput.value = "";
    }
    if (this.cashInfusionTargetInput) {
      this.cashInfusionTargetInput.value = "";
    }
  }

  saveCashInfusion() {
    const name = this.cashInfusionNameInput?.value.trim() || "";
    const amount = parseFloat(this.cashInfusionAmountInput?.value || "0");
    const date = this.cashInfusionDateInput?.value || "";
    const targetDebtId = this.cashInfusionTargetInput?.value || null;

    if (!name) {
      Utils.showNotification("Please enter a description", "error");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      Utils.showNotification("Please enter a valid amount greater than 0", "error");
      return;
    }
    if (!date || !this.isValidDateString(date)) {
      Utils.showNotification("Please enter a valid date", "error");
      return;
    }

    const infusionData = {
      name,
      amount,
      date,
      targetDebtId: targetDebtId || null,
    };

    if (this.editingCashInfusionId) {
      this.store.updateCashInfusion(this.editingCashInfusionId, infusionData);
      Utils.showNotification("Cash infusion updated");
    } else {
      this.store.addCashInfusion(infusionData);
      Utils.showNotification("Cash infusion added");
    }

    this.hideCashInfusionForm();
    this.refresh();
    this.onUpdate();
  }

  editCashInfusion(infusionId) {
    const infusion = this.store.getCashInfusions().find((inf) => inf.id === infusionId);
    if (!infusion) {
      Utils.showNotification("Cash infusion not found", "error");
      return;
    }
    this.showCashInfusionForm(infusion);
  }

  async deleteCashInfusion(infusionId) {
    const infusion = this.store.getCashInfusions().find((inf) => inf.id === infusionId);
    if (!infusion) {
      Utils.showNotification("Cash infusion not found", "error");
      return;
    }
    const shouldDelete = await Utils.showModalConfirm(
      `Delete cash infusion "${infusion.name}"?`,
      "Delete Cash Infusion",
      { confirmText: "Delete", cancelText: "Cancel" }
    );
    if (!shouldDelete) {
      return;
    }
    this.store.deleteCashInfusion(infusionId);
    Utils.showNotification("Cash infusion deleted");
    this.refresh();
    this.onUpdate();
  }

  renderCashInfusions() {
    if (!this.cashInfusionList) return;
    this.cashInfusionList.innerHTML = "";
    const infusions = this.store.getCashInfusions();
    const debts = this.store.getDebts();

    if (infusions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cash-infusion-empty";
      empty.textContent = "No cash infusions scheduled.";
      this.cashInfusionList.appendChild(empty);
      return;
    }

    // Calculate allocation for each infusion
    const infusionAllocations = this.calculateInfusionAllocations();

    // Sort by date
    const sortedInfusions = [...infusions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    sortedInfusions.forEach((infusion) => {
      const amount = Number(infusion.amount) || 0;
      const targetDebt = infusion.targetDebtId
        ? debts.find((d) => d.id === infusion.targetDebtId)
        : null;
      const targetLabel = targetDebt
        ? targetDebt.name
        : "Auto (Snowball Priority)";

      const row = document.createElement("div");
      row.className = "cash-infusion-item";

      const details = document.createElement("div");
      details.className = "cash-infusion-details";

      const nameSpan = document.createElement("span");
      nameSpan.className = "cash-infusion-name";
      nameSpan.textContent = infusion.name;

      const meta = document.createElement("div");
      meta.className = "cash-infusion-meta";
      meta.textContent = `$${amount.toFixed(2)} on ${Utils.formatDisplayDate(
        infusion.date
      )} → ${targetLabel}`;

      details.appendChild(nameSpan);
      details.appendChild(meta);

      // Add allocation breakdown
      const allocation = infusionAllocations[infusion.id];
      if (allocation && Object.keys(allocation).length > 0) {
        const allocationDiv = document.createElement("div");
        allocationDiv.className = "cash-infusion-allocation";

        const allocationParts = [];
        Object.keys(allocation).forEach((debtId) => {
          const debt = debts.find((d) => d.id === debtId);
          const debtName = debt ? debt.name : "Unknown Debt";
          const allocatedAmount = Number(allocation[debtId]) || 0;
          if (allocatedAmount > 0) {
            allocationParts.push(`${debtName}: $${allocatedAmount.toFixed(2)}`);
          }
        });

        if (allocationParts.length > 0) {
          allocationDiv.textContent = `Applied: ${allocationParts.join(", ")}`;
        } else {
          allocationDiv.textContent = "No allocation (all debts may be paid off)";
        }
        details.appendChild(allocationDiv);
      }

      const actions = document.createElement("div");
      actions.className = "cash-infusion-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.textContent = "Edit";
      editBtn.dataset.infusionId = infusion.id;
      editBtn.dataset.action = "edit";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.dataset.infusionId = infusion.id;
      deleteBtn.dataset.action = "delete";

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(details);
      row.appendChild(actions);
      this.cashInfusionList.appendChild(row);
    });
  }

  calculateInfusionAllocations() {
    // This method calculates how each infusion is allocated to debts
    // by running a projection and tracking infusion-specific allocations
    const infusions = this.store.getCashInfusions();
    const debts = this.store.getDebts();
    const settings = this.store.getDebtSnowballSettings();
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;

    if (infusions.length === 0 || debts.length === 0) {
      return {};
    }

    // Group infusions by month
    const infusionsByMonthKey = {};
    infusions.forEach((infusion) => {
      if (!infusion.date) return;
      const infusionDate = this.getDateFromString(infusion.date);
      if (!infusionDate) return;
      const infusionYear = infusionDate.getFullYear();
      const infusionMonth = infusionDate.getMonth();
      const key = `${infusionYear}-${String(infusionMonth + 1).padStart(2, "0")}`;
      if (!infusionsByMonthKey[key]) {
        infusionsByMonthKey[key] = [];
      }
      infusionsByMonthKey[key].push(infusion);
    });

    // Find the earliest infusion date to start projection from
    const sortedInfusions = [...infusions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );
    const earliestDate = this.getDateFromString(sortedInfusions[0].date);
    const latestDate = this.getDateFromString(sortedInfusions[sortedInfusions.length - 1].date);

    if (!earliestDate) return {};

    const today = new Date();
    // Start the projection at the earlier of the first infusion's month and the
    // current month, compared as absolute year-month indices. Component-wise
    // min(year)/min(month) is wrong when the two dates fall in different years
    // (e.g. earliest 2025-11, today 2026-06 would yield 2025-06): it can start
    // the projection before the first infusion and over-compound simulated
    // interest, skewing each infusion's allocation breakdown.
    const startIndex = Math.min(
      this.getMonthIndex(earliestDate.getFullYear(), earliestDate.getMonth()),
      this.getMonthIndex(today.getFullYear(), today.getMonth())
    );
    const startYear = Math.floor(startIndex / 12);
    const startMonth = startIndex % 12;

    const endYear = latestDate ? latestDate.getFullYear() : today.getFullYear();
    const endMonth = latestDate ? latestDate.getMonth() : today.getMonth();

    // Build initial balances
    const baseDate = new Date(startYear, startMonth, 1);
    const baseSummaries = this.getDebtSummaries(baseDate);
    let balances = {};
    const debtById = {};
    const recurringTemplates = {};

    baseSummaries.forEach(({ debt, remaining }) => {
      balances[debt.id] = Number(remaining) || 0;
      debtById[debt.id] = debt;
    });

    debts.forEach((debt) => {
      if (!debtById[debt.id]) {
        debtById[debt.id] = debt;
        balances[debt.id] = Number(debt.balance) || 0;
      }
      const template = this.buildDebtRecurringTransaction(debt);
      template.id = template.id || debt.minRecurringId || debt.id || Utils.generateUniqueId();
      recurringTemplates[debt.id] = template;
    });

    const payoffByDebtId = {};
    Object.keys(balances).forEach((debtId) => {
      if (balances[debtId] <= 0) {
        payoffByDebtId[debtId] = { year: startYear, month: startMonth, alreadyPaid: true };
      }
    });

    // Track allocations per infusion
    const infusionAllocations = {};
    infusions.forEach((inf) => {
      infusionAllocations[inf.id] = {};
    });

    // Run projection month by month
    let year = startYear;
    let month = startMonth;
    const maxMonths = (endYear - startYear) * 12 + (endMonth - startMonth) + 12; // Add buffer

    for (let i = 0; i < maxMonths; i++) {
      const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
      const monthIndex = this.getMonthIndex(year, month);

      // Calculate monthly minimums
      const monthlyTotalsByDebtId = {};
      Object.keys(recurringTemplates).forEach((debtId) => {
        const template = recurringTemplates[debtId];
        if (!template) {
          monthlyTotalsByDebtId[debtId] = 0;
          return;
        }
        const occurrences = this.getRecurringOccurrencesForMonth(template, year, month);
        const totalPayment = roundToCents(
          occurrences.reduce((sum, occ) => sum + occ.amount, 0)
        );
        monthlyTotalsByDebtId[debtId] = totalPayment;
      });

      // Apply interest
      Object.keys(balances).forEach((debtId) => {
        const debt = debtById[debtId];
        const balance = Number(balances[debtId]) || 0;
        const interestRate = debt?.interestRate || 0;
        if (balance <= 0 || interestRate <= 0) return;
        const interest = roundToCents((balance * interestRate) / 1200);
        if (interest > 0) {
          balances[debtId] = roundToCents(balance + interest);
        }
      });

      // Apply minimum payments
      Object.keys(balances).forEach((debtId) => {
        const balance = Number(balances[debtId]) || 0;
        const scheduledMin = Number(monthlyTotalsByDebtId[debtId]) || 0;
        if (balance <= 0 || scheduledMin <= 0) return;
        const actualMin = roundToCents(Math.min(balance, scheduledMin));
        balances[debtId] = roundToCents(balance - actualMin);
      });

      // Get infusions for this month
      const monthInfusions = infusionsByMonthKey[monthKey] || [];

      // Process each infusion individually to track allocation
      monthInfusions.forEach((infusion) => {
        const infusionAmount = Number(infusion.amount) || 0;
        if (infusionAmount <= 0) return;

        if (infusion.targetDebtId && balances[infusion.targetDebtId] !== undefined) {
          // Targeted infusion
          const currentBalance = Number(balances[infusion.targetDebtId]) || 0;
          if (currentBalance > 0) {
            const applied = Math.min(currentBalance, infusionAmount);
            balances[infusion.targetDebtId] = roundToCents(currentBalance - applied);
            infusionAllocations[infusion.id][infusion.targetDebtId] = applied;
            if (balances[infusion.targetDebtId] === 0 && !payoffByDebtId[infusion.targetDebtId]) {
              payoffByDebtId[infusion.targetDebtId] = { year, month };
            }
          }
        } else {
          // Auto infusion - apply snowball priority
          const debtOrder = Object.keys(balances)
            .filter((debtId) => balances[debtId] > 0)
            .sort((a, b) => balances[a] - balances[b]);

          let remaining = infusionAmount;
          debtOrder.forEach((debtId) => {
            if (remaining <= 0) return;
            const currentBalance = Number(balances[debtId]) || 0;
            if (currentBalance <= 0) return;
            const applied = Math.min(currentBalance, remaining);
            balances[debtId] = roundToCents(currentBalance - applied);
            infusionAllocations[infusion.id][debtId] =
              (infusionAllocations[infusion.id][debtId] || 0) + applied;
            remaining -= applied;
            if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
              payoffByDebtId[debtId] = { year, month };
            }
          });
        }
      });

      // Check if all debts are paid
      const activeDebtIds = Object.keys(balances).filter((id) => balances[id] > 0);
      if (activeDebtIds.length === 0) break;

      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    return infusionAllocations;
  }

  saveSnowballSettings() {
    const extraPayment = parseFloat(this.snowballExtraInput?.value || "0");
    const autoGenerate = this.snowballAutoCheckbox?.checked === true;
    const extraPaymentStartMonth = (
      this.snowballExtraStartInput?.value || ""
    ).trim();
    if (isNaN(extraPayment) || extraPayment < 0) {
      Utils.showNotification("Extra payment must be 0 or greater", "error");
      return;
    }
    if (
      extraPaymentStartMonth &&
      !/^\d{4}-\d{2}$/.test(extraPaymentStartMonth)
    ) {
      Utils.showNotification("Invalid extra payment start month", "error");
      return;
    }
    this.store.setDebtSnowballSettings({
      extraPayment,
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
    const snowballPaidByDebtId = monthInfo.snowballPaidByDebtId || {};
    const monthlyTotalsByDebtId = monthInfo.monthlyTotalsByDebtId || {};
    const inMonthRollover = Number(monthInfo.inMonthRollover) || 0;

    if (allowMutation) {
      if (this.adjustMinimumPaymentTransactions(year, month, minPaidByDebtId)) {
        changed = true;
      }

      const expectedSnowballPayments = [];
      if (includeExtra) {
        const debtsById = new Map(
          this.store.getDebts().map((debt) => [debt.id, debt])
        );
        const rolloverAvailableDate =
          inMonthRollover > 0
            ? this.getRolloverAvailableDate(
              year,
              month,
              minPaidByDebtId,
              monthlyTotalsByDebtId,
              debtsById
            )
            : null;
        Object.keys(snowballPaidByDebtId).forEach((debtId) => {
          const amount = Number(snowballPaidByDebtId[debtId]) || 0;
          if (amount <= 0) {
            return;
          }
          const debt = debtsById.get(debtId);
          if (!debt) {
            return;
          }
          const dueDate = this.getDebtDueDateForMonth(debt, year, month);
          let paymentDate = dueDate;
          if (
            paymentDate &&
            rolloverAvailableDate &&
            paymentDate < rolloverAvailableDate
          ) {
            paymentDate = rolloverAvailableDate;
          }
          const dueDateString = paymentDate
            ? Utils.formatDateString(paymentDate)
            : null;
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
        includeExtra
      );
      if (syncResult.changed) {
        changed = true;
      }
      if (syncResult.snowballAdded) {
        snowballAdded = true;
      }
      if (changed && !snowballAdded && !syncResult.changed) {
        // Use saveData(false) for automatic maintenance - saves locally but doesn't trigger cloud sync
        this.store.saveData(false);
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
