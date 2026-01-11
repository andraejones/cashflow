// Debt snowball UI

const DAY_SPECIFIC_OPTIONS = [
  { value: "1-0", label: "First Sunday" },
  { value: "1-1", label: "First Monday" },
  { value: "1-2", label: "First Tuesday" },
  { value: "1-3", label: "First Wednesday" },
  { value: "1-4", label: "First Thursday" },
  { value: "1-5", label: "First Friday" },
  { value: "1-6", label: "First Saturday" },
  { value: "2-0", label: "Second Sunday" },
  { value: "2-1", label: "Second Monday" },
  { value: "2-2", label: "Second Tuesday" },
  { value: "2-3", label: "Second Wednesday" },
  { value: "2-4", label: "Second Thursday" },
  { value: "2-5", label: "Second Friday" },
  { value: "2-6", label: "Second Saturday" },
  { value: "3-0", label: "Third Sunday" },
  { value: "3-1", label: "Third Monday" },
  { value: "3-2", label: "Third Tuesday" },
  { value: "3-3", label: "Third Wednesday" },
  { value: "3-4", label: "Third Thursday" },
  { value: "3-5", label: "Third Friday" },
  { value: "3-6", label: "Third Saturday" },
  { value: "4-0", label: "Fourth Sunday" },
  { value: "4-1", label: "Fourth Monday" },
  { value: "4-2", label: "Fourth Tuesday" },
  { value: "4-3", label: "Fourth Wednesday" },
  { value: "4-4", label: "Fourth Thursday" },
  { value: "4-5", label: "Fourth Friday" },
  { value: "4-6", label: "Fourth Saturday" },
  { value: "-1-0", label: "Last Sunday" },
  { value: "-1-1", label: "Last Monday" },
  { value: "-1-2", label: "Last Tuesday" },
  { value: "-1-3", label: "Last Wednesday" },
  { value: "-1-4", label: "Last Thursday" },
  { value: "-1-5", label: "Last Friday" },
  { value: "-1-6", label: "Last Saturday" },
];

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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
    this.debtRecurrenceInput = document.getElementById("debtRecurrence");
    this.debtStartDateInput = document.getElementById("debtStartDate");
    this.debtDueDayInput = document.getElementById("debtDueDay");
    this.debtDueDayPatternInput = document.getElementById("debtDueDayPattern");
    this.debtInterestInput = document.getElementById("debtInterestRate");
    this.debtAdvancedOptions = document.getElementById(
      "debtAdvancedRecurrenceOptions"
    );
    this.snowballExtraInput = document.getElementById("snowballExtraAmount");
    this.snowballAutoCheckbox = document.getElementById("snowballAutoGenerate");
    this.planSummary = document.getElementById("snowballPlanSummary");
    this.planList = document.getElementById("snowballPlanList");
    this.lastFocusedElement = null;
    this.daySpecificOptions = DAY_SPECIFIC_OPTIONS;
    this.isSyncingDueDate = false;
    this.currentViewYear = null;
    this.currentViewMonth = null;
    this.editingCashInfusionId = null;

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
    this.hideCashInfusionForm();
    if (this.lastFocusedElement && document.contains(this.lastFocusedElement)) {
      this.lastFocusedElement.focus();
    }
    this.lastFocusedElement = null;
  }

  refresh() {
    this.renderDebts();
    this.renderCashInfusions();
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

    if (recurrenceType === "monthly") {
      this.toggleMonthlyFields(true);
    } else {
      this.toggleMonthlyFields(false);
    }

    if (recurrenceType === "once") {
      this.debtAdvancedOptions.style.display = "none";
      return;
    }

    this.debtAdvancedOptions.style.display = "block";
    if (recurrenceType === "semi-monthly") {
      this.addDebtSemiMonthlyOptions(this.debtAdvancedOptions);
    } else if (recurrenceType === "custom") {
      this.addDebtCustomIntervalOptions(this.debtAdvancedOptions);
    }
    this.addDebtBusinessDayOptions(this.debtAdvancedOptions);
    this.addDebtVariableAmountOptions(this.debtAdvancedOptions);
    this.addDebtEndConditionOptions(this.debtAdvancedOptions);
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

  addDebtSemiMonthlyOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", "debtSemiMonthlyFirstDay");
    label.textContent = "Days of month:";

    const helpText = document.createElement("span");
    helpText.className = "help-text";
    helpText.textContent = "Select two days of the month";

    const firstDaySelect = document.createElement("select");
    firstDaySelect.id = "debtSemiMonthlyFirstDay";
    firstDaySelect.name = "debtSemiMonthlyFirstDay";
    const secondDaySelect = document.createElement("select");
    secondDaySelect.id = "debtSemiMonthlySecondDay";
    secondDaySelect.name = "debtSemiMonthlySecondDay";

    for (let i = 1; i <= 28; i++) {
      const firstOption = document.createElement("option");
      firstOption.value = i;
      firstOption.textContent = i;
      firstDaySelect.appendChild(firstOption);

      const secondOption = document.createElement("option");
      secondOption.value = i;
      secondOption.textContent = i;
      secondDaySelect.appendChild(secondOption);
    }

    const lastDayOption = document.createElement("option");
    lastDayOption.value = "last";
    lastDayOption.textContent = "Last day";
    secondDaySelect.appendChild(lastDayOption);

    firstDaySelect.value = 1;
    secondDaySelect.value = 15;

    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(firstDaySelect);
    group.appendChild(document.createTextNode(" and "));
    group.appendChild(secondDaySelect);
    group.appendChild(document.createElement("br"));
    group.appendChild(helpText);

    container.appendChild(group);
  }

  addDebtCustomIntervalOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", "debtCustomIntervalValue");
    label.textContent = "Repeat every:";

    const intervalValue = document.createElement("input");
    intervalValue.type = "number";
    intervalValue.id = "debtCustomIntervalValue";
    intervalValue.name = "debtCustomIntervalValue";
    intervalValue.min = "1";
    intervalValue.value = "1";
    intervalValue.style.width = "60px";

    const intervalUnit = document.createElement("select");
    intervalUnit.id = "debtCustomIntervalUnit";
    intervalUnit.name = "debtCustomIntervalUnit";

    const unitOptions = [
      { value: "days", label: "Day(s)" },
      { value: "weeks", label: "Week(s)" },
      { value: "months", label: "Month(s)" },
    ];

    unitOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      intervalUnit.appendChild(optionElement);
    });

    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(intervalValue);
    group.appendChild(document.createTextNode(" "));
    group.appendChild(intervalUnit);

    container.appendChild(group);
  }

  addDebtBusinessDayOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", "debtBusinessDayAdjustment");
    label.textContent = "When transaction falls on weekend:";

    const adjustmentSelect = document.createElement("select");
    adjustmentSelect.id = "debtBusinessDayAdjustment";
    adjustmentSelect.name = "debtBusinessDayAdjustment";

    const adjustmentOptions = [
      { value: "none", label: "No adjustment" },
      { value: "previous", label: "Move to previous business day" },
      { value: "next", label: "Move to next business day" },
      { value: "nearest", label: "Move to nearest business day" },
    ];

    adjustmentOptions.forEach((option) => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      adjustmentSelect.appendChild(optionElement);
    });

    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(adjustmentSelect);

    container.appendChild(group);
  }

  addDebtVariableAmountOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    const checkboxDiv = document.createElement("div");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "debtVariableAmountCheck";
    checkbox.name = "debtVariableAmountCheck";

    const checkboxLabel = document.createElement("label");
    checkboxLabel.setAttribute("for", "debtVariableAmountCheck");
    checkboxLabel.textContent = "Amount changes over time";

    checkboxDiv.appendChild(checkbox);
    checkboxDiv.appendChild(checkboxLabel);

    const variableOptions = document.createElement("div");
    variableOptions.id = "debtVariableAmountOptions";
    variableOptions.style.display = "none";
    variableOptions.style.marginTop = "10px";

    const percentLabel = document.createElement("label");
    percentLabel.setAttribute("for", "debtVariablePercentage");
    percentLabel.textContent = "Percentage change per occurrence:";

    const percentInput = document.createElement("input");
    percentInput.type = "number";
    percentInput.id = "debtVariablePercentage";
    percentInput.name = "debtVariablePercentage";
    percentInput.step = "0.1";
    percentInput.value = "0";
    percentInput.style.width = "60px";

    const percentSign = document.createElement("span");
    percentSign.textContent = "%";

    variableOptions.appendChild(percentLabel);
    variableOptions.appendChild(document.createElement("br"));
    variableOptions.appendChild(percentInput);
    variableOptions.appendChild(percentSign);

    checkbox.addEventListener("change", function () {
      variableOptions.style.display = this.checked ? "block" : "none";
    });

    group.appendChild(checkboxDiv);
    group.appendChild(variableOptions);

    container.appendChild(group);
  }

  addDebtEndConditionOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.textContent = "End condition:";
    const radioGroup = document.createElement("div");
    radioGroup.className = "radio-group";
    const noEndRadioDiv = document.createElement("div");

    const noEndRadio = document.createElement("input");
    noEndRadio.type = "radio";
    noEndRadio.id = "debtEndConditionNone";
    noEndRadio.name = "debtEndCondition";
    noEndRadio.value = "none";
    noEndRadio.checked = true;

    const noEndLabel = document.createElement("label");
    noEndLabel.setAttribute("for", "debtEndConditionNone");
    noEndLabel.textContent = "No end date";

    noEndRadioDiv.appendChild(noEndRadio);
    noEndRadioDiv.appendChild(noEndLabel);
    const endDateRadioDiv = document.createElement("div");

    const endDateRadio = document.createElement("input");
    endDateRadio.type = "radio";
    endDateRadio.id = "debtEndConditionDate";
    endDateRadio.name = "debtEndCondition";
    endDateRadio.value = "date";

    const endDateLabel = document.createElement("label");
    endDateLabel.setAttribute("for", "debtEndConditionDate");
    endDateLabel.textContent = "End by date:";

    const endDateInput = document.createElement("input");
    endDateInput.type = "date";
    endDateInput.id = "debtEndDate";
    endDateInput.name = "debtEndDate";
    endDateInput.disabled = true;

    endDateRadioDiv.appendChild(endDateRadio);
    endDateRadioDiv.appendChild(endDateLabel);
    endDateRadioDiv.appendChild(document.createElement("br"));
    endDateRadioDiv.appendChild(endDateInput);
    const endOccurrenceRadioDiv = document.createElement("div");

    const endOccurrenceRadio = document.createElement("input");
    endOccurrenceRadio.type = "radio";
    endOccurrenceRadio.id = "debtEndConditionOccurrence";
    endOccurrenceRadio.name = "debtEndCondition";
    endOccurrenceRadio.value = "occurrence";

    const endOccurrenceLabel = document.createElement("label");
    endOccurrenceLabel.setAttribute("for", "debtEndConditionOccurrence");
    endOccurrenceLabel.textContent = "End after:";

    const endOccurrenceInput = document.createElement("input");
    endOccurrenceInput.type = "number";
    endOccurrenceInput.id = "debtMaxOccurrences";
    endOccurrenceInput.name = "debtMaxOccurrences";
    endOccurrenceInput.min = "1";
    endOccurrenceInput.value = "12";
    endOccurrenceInput.style.width = "60px";
    endOccurrenceInput.disabled = true;

    const occurrencesText = document.createElement("span");
    occurrencesText.textContent = " occurrences";

    endOccurrenceRadioDiv.appendChild(endOccurrenceRadio);
    endOccurrenceRadioDiv.appendChild(endOccurrenceLabel);
    endOccurrenceRadioDiv.appendChild(endOccurrenceInput);
    endOccurrenceRadioDiv.appendChild(occurrencesText);

    noEndRadio.addEventListener("change", function () {
      if (this.checked) {
        endDateInput.disabled = true;
        endOccurrenceInput.disabled = true;
      }
    });

    endDateRadio.addEventListener("change", function () {
      if (this.checked) {
        endDateInput.disabled = false;
        endOccurrenceInput.disabled = true;
      }
    });

    endOccurrenceRadio.addEventListener("change", function () {
      if (this.checked) {
        endDateInput.disabled = true;
        endOccurrenceInput.disabled = false;
      }
    });

    radioGroup.appendChild(noEndRadioDiv);
    radioGroup.appendChild(endDateRadioDiv);
    radioGroup.appendChild(endOccurrenceRadioDiv);

    group.appendChild(label);
    group.appendChild(radioGroup);

    container.appendChild(group);
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
    const today = Utils.formatDateString(new Date());
    const january = Utils.formatDateString(
      new Date(new Date().getFullYear(), 0, 1)
    );
    if (!debt) return today;
    const recurrence = debt.recurrence || "monthly";
    if (recurrence === "monthly" && typeof debt.dueDay === "number") {
      return this.replaceDayInDateString(january, debt.dueDay);
    }
    if (
      recurrence === "semi-monthly" &&
      Array.isArray(debt.semiMonthlyDays) &&
      debt.semiMonthlyDays.length
    ) {
      return this.replaceDayInDateString(january, debt.semiMonthlyDays[0]);
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
    const recurringUpdates = this.buildDebtRecurringTransaction(debt);
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
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  formatMonthDay(date) {
    if (!date) return "";
    const month = MONTH_LABELS[date.getMonth()] || "";
    return `${month} ${date.getDate()}`;
  }

  formatMonthYear(year, month) {
    const monthLabel = MONTH_LABELS[month] || "";
    if (!monthLabel || typeof year !== "number") {
      return "";
    }
    return `${monthLabel} ${year}`;
  }

  getMonthIndex(year, month) {
    return year * 12 + month;
  }

  getRecurringOccurrencesForMonth(recurringTransaction, year, month) {
    if (!recurringTransaction?.startDate || !recurringTransaction?.recurrence) {
      return [];
    }
    const transactions = {};
    const dummyStore = {
      getTransactions: () => transactions,
      getRecurringTransactions: () => [recurringTransaction],
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

  getRecurringDatesForMonth(recurringTransaction, year, month) {
    return this.getRecurringOccurrencesForMonth(recurringTransaction, year, month)
      .map((occurrence) => occurrence.dateString);
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

  calculateMonthlySnowballAllocation(
    balances,
    monthlyTotalsByDebtId,
    applySnowball,
    baseExtraPayment,
    rolloverAmount
  ) {
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
      minPaidByDebtId[debtId] = actualMin;
      balancesAfterMin[debtId] = Math.max(0, balance - actualMin);
      if (scheduledMin > actualMin) {
        inMonthRollover += scheduledMin - actualMin;
      }
    });

    const debtOrder = Object.keys(balancesAfterMin)
      .filter((debtId) => balancesAfterMin[debtId] > 0)
      .sort((leftId, rightId) => balancesAfterMin[leftId] - balancesAfterMin[rightId]);
    const targetDebtId = debtOrder.length ? debtOrder[0] : null;

    const snowballPaidByDebtId = {};
    let remainingSnowball = applySnowball
      ? (Number(baseExtraPayment) || 0) +
      (Number(rolloverAmount) || 0) +
      inMonthRollover
      : 0;
    const balancesAfterPayments = { ...balancesAfterMin };

    debtOrder.forEach((debtId) => {
      if (remainingSnowball <= 0) return;
      const remainingBalance = Number(balancesAfterPayments[debtId]) || 0;
      if (remainingBalance <= 0) return;
      const applied = Math.min(remainingBalance, remainingSnowball);
      if (applied <= 0) return;
      snowballPaidByDebtId[debtId] = applied;
      balancesAfterPayments[debtId] = Math.max(0, remainingBalance - applied);
      remainingSnowball -= applied;
    });

    const snowballAmount = Object.values(snowballPaidByDebtId).reduce(
      (sum, amount) => sum + (Number(amount) || 0),
      0
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

  calculateSnowballProjection(viewYear, viewMonth, includeExtra = true) {
    const debts = this.store.getDebts();
    const settings = this.store.getDebtSnowballSettings();
    const baseExtraPayment = Number(settings.extraPayment) || 0;
    const applySnowball = includeExtra === true;
    const roundToCents = (value) =>
      Math.round((Number(value) || 0) * 100) / 100;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    const currentIndex = this.getMonthIndex(currentYear, currentMonth);
    const baseYear = viewIndex <= currentIndex ? viewYear : currentYear;
    const baseMonth = viewIndex <= currentIndex ? viewMonth : currentMonth;
    const baseDate = new Date(baseYear, baseMonth, 1);
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
      const key = `${infusionYear}-${infusionMonth + 1}`;
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
    const maxMonths = Math.max(600, viewIndex - baseIndex + 1);
    let year = baseYear;
    let month = baseMonth;

    for (let i = 0; i < maxMonths; i++) {
      if (viewBalances === null && year === viewYear && month === viewMonth) {
        viewBalances = { ...balances };
      }
      const monthKey = `${year}-${month + 1}`;
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
        const totalPayment = occurrences.reduce(
          (sum, occurrence) => sum + occurrence.amount,
          0
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
      const monthInfusions = infusionsByMonthKey[monthKey] || [];
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

      const allocation = this.calculateMonthlySnowballAllocation(
        balances,
        monthlyTotalsByDebtId,
        applySnowball,
        baseExtraPayment + generalInfusionAmount,
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
        baseExtraPayment,
        infusionAmount: generalInfusionAmount,
        targetedInfusions: targetedInfusionsByDebtId,
        inMonthRollover: allocation.inMonthRollover,
      };
      if (year === viewYear && month === viewMonth) {
        monthInfo.minPaidByDebtId = allocation.minPaidByDebtId;
        monthInfo.snowballPaidByDebtId = allocation.snowballPaidByDebtId;
        monthInfo.monthlyTotalsByDebtId = monthlyTotalsByDebtId;
      }
      monthTargets[monthKey] = monthInfo;

      month += 1;
      if (month > 11) {
        month = 0;
        year += 1;
      }
    }

    if (viewBalances === null) {
      viewBalances = { ...balances };
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
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const expectedByDebtId = new Map();
    expectedPayments.forEach((payment) => {
      expectedByDebtId.set(payment.debtId, { ...payment, matched: false });
    });
    const epsilon = 0.01;
    let changed = false;
    let snowballAdded = false;

    Object.keys(transactions).forEach((dateKey) => {
      if (!dateKey.startsWith(monthPrefix)) {
        return;
      }
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
        if (!expected || expected.dateString !== dateKey) {
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
      this.store.saveData();
    }

    return { changed, snowballAdded };
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
      meta.textContent = `Balance $${debt.balance.toFixed(
        2
      )} • Remaining $${remaining.toFixed(2)} • Min $${minPayment.toFixed(
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

  renderPlan() {
    if (!this.planList || !this.planSummary) return;
    this.planList.innerHTML = "";
    this.planSummary.innerHTML = "";
    const settings = this.store.getDebtSnowballSettings();
    const today = new Date();
    const viewYear =
      typeof this.currentViewYear === "number"
        ? this.currentViewYear
        : today.getFullYear();
    const viewMonth =
      typeof this.currentViewMonth === "number"
        ? this.currentViewMonth
        : today.getMonth();
    const projection = this.calculateSnowballProjection(
      viewYear,
      viewMonth,
      true
    );
    const viewBalances = projection.viewBalances || {};
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
      .filter((summary) => summary.remaining > 0);

    if (summaries.length === 0) {
      this.planSummary.textContent = "No active debts to target.";
      return;
    }
    const monthKey = `${viewYear}-${viewMonth + 1}`;
    const monthInfo = projection.monthTargets?.[monthKey] || {};
    const targetDebtId = monthInfo.targetDebtId;
    const fallbackTarget = [...summaries].sort(
      (a, b) => a.remaining - b.remaining
    )[0];
    const target =
      targetDebtId &&
        summaries.find((summary) => summary.debt.id === targetDebtId)
        ? summaries.find((summary) => summary.debt.id === targetDebtId)
        : fallbackTarget;
    const summaryText = document.createElement("div");
    summaryText.className = "debt-plan-summary";
    const viewLabel = this.formatMonthYear(viewYear, viewMonth);
    summaryText.textContent = `Current target${viewLabel ? ` (${viewLabel})` : ""}: ${target.debt.name
      } (Remaining $${target.remaining.toFixed(2)})`;
    this.planSummary.appendChild(summaryText);

    const extraText = document.createElement("div");
    extraText.className = "debt-plan-extra";
    const baseExtraPayment = Number(settings.extraPayment) || 0;
    const snowballAmount = Number(monthInfo.snowballAmount) || 0;
    const rolloverAmount = Number(monthInfo.rolloverAmount) || 0;
    const inMonthRollover = Number(monthInfo.inMonthRollover) || 0;
    const infusionAmount = Number(monthInfo.infusionAmount) || 0;
    const breakdownParts = [`Base $${baseExtraPayment.toFixed(2)}`];
    if (infusionAmount > 0) {
      breakdownParts.push(`Infusions $${infusionAmount.toFixed(2)}`);
    }
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
      const item = document.createElement("div");
      item.className = "debt-plan-item";
      if (summary.debt.id === target.debt.id) {
        item.classList.add("debt-plan-target");
      }
      const payoff = projection.payoffByDebtId?.[summary.debt.id];
      const payoffLabel = payoff
        ? this.formatMonthYear(payoff.year, payoff.month)
        : "No payoff scheduled";
      item.textContent = `${index + 1}. ${summary.debt.name} — Remaining $${summary.remaining.toFixed(
        2
      )} — Paid off by ${payoffLabel}`;
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
    this.renderCashInfusions();
    this.renderPlan();
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
    this.renderCashInfusions();
    this.renderPlan();
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
      const key = `${infusionYear}-${infusionMonth + 1}`;
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
    const startYear = Math.min(earliestDate.getFullYear(), today.getFullYear());
    const startMonth = startYear === earliestDate.getFullYear()
      ? Math.min(earliestDate.getMonth(), today.getMonth())
      : (startYear < earliestDate.getFullYear() ? today.getMonth() : earliestDate.getMonth());

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
      const monthKey = `${year}-${month + 1}`;
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
        const totalPayment = occurrences.reduce((sum, occ) => sum + occ.amount, 0);
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
        const actualMin = Math.min(balance, scheduledMin);
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
    const snowballAdded = this.ensureSnowballPaymentForMonth(
      today.getFullYear(),
      today.getMonth(),
      force
    );
    if (snowballAdded) {
      Utils.showNotification("Snowball payment generated");
      this.renderDebts();
      this.renderPlan();
      this.onUpdate();
    } else if (force) {
      Utils.showNotification("No snowball payment generated", "error");
    }
  }

  ensureSnowballPaymentForMonth(year, month, force = false) {
    const settings = this.store.getDebtSnowballSettings() || {};
    const autoGenerate = settings.autoGenerate === true;
    const includeExtra = autoGenerate || force;

    this.setCurrentViewMonth(year, month);
    const projection = this.calculateSnowballProjection(
      year,
      month,
      includeExtra
    );
    const today = new Date();
    const currentIndex = this.getMonthIndex(today.getFullYear(), today.getMonth());
    const viewIndex = this.getMonthIndex(year, month);
    const allowMutation = force || viewIndex >= currentIndex;
    const monthKey = `${year}-${month + 1}`;
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
        this.store.saveData();
      }
    }

    this.renderPlan();
    return snowballAdded;
  }
}

window.DebtSnowballUI = DebtSnowballUI;
