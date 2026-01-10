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
      saveData: () => {},
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

  calculateSnowballProjection(viewYear, viewMonth, includeExtra = true) {
    const debts = this.store.getDebts();
    const settings = this.store.getDebtSnowballSettings();
    const baseExtraPayment = Number(settings.extraPayment) || 0;
    const applySnowball = includeExtra === true;
    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth();
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    const currentIndex = this.getMonthIndex(currentYear, currentMonth);
    const baseYear = viewIndex <= currentIndex ? viewYear : currentYear;
    const baseMonth = viewIndex <= currentIndex ? viewMonth : currentMonth;
    const baseDate = new Date(baseYear, baseMonth, 1);
    const baseSummaries = this.getDebtSummaries(baseDate);
    const balances = {};
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

      const activeDebtIds = Object.keys(balances).filter(
        (debtId) => balances[debtId] > 0
      );
      if (!activeDebtIds.length) {
        break;
      }
      activeDebtIds.forEach((debtId) => {
        const totalPayment = monthlyTotalsByDebtId[debtId] || 0;
        if (totalPayment <= 0) return;
        balances[debtId] = Math.max(0, balances[debtId] - totalPayment);
        if (balances[debtId] === 0 && !payoffByDebtId[debtId]) {
          payoffByDebtId[debtId] = { year, month };
        }
      });

      const remainingDebtIds = Object.keys(balances).filter(
        (debtId) => balances[debtId] > 0
      );
      let targetDebtId = null;
      if (remainingDebtIds.length) {
        remainingDebtIds.sort(
          (leftId, rightId) => balances[leftId] - balances[rightId]
        );
        targetDebtId = remainingDebtIds[0];
      }

      let rolloverAmount = 0;
      let snowballAmount = 0;
      if (applySnowball && targetDebtId) {
        rolloverAmount = Object.keys(monthlyTotalsByDebtId).reduce(
          (sum, debtId) => {
            const payoff = payoffByDebtId[debtId];
            if (!payoff) {
              return sum;
            }
            const payoffIndex = this.getMonthIndex(
              payoff.year,
              payoff.month
            );
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
          },
          0
        );
        snowballAmount = baseExtraPayment + rolloverAmount;
        if (snowballAmount > 0) {
          balances[targetDebtId] = Math.max(
            0,
            balances[targetDebtId] - snowballAmount
          );
          if (
            balances[targetDebtId] === 0 &&
            !payoffByDebtId[targetDebtId]
          ) {
            payoffByDebtId[targetDebtId] = { year, month };
          }
        }
      }
      monthTargets[monthKey] = {
        targetDebtId,
        snowballAmount,
        rolloverAmount,
        baseExtraPayment,
      };

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
    summaryText.textContent = `Current target${viewLabel ? ` (${viewLabel})` : ""}: ${
      target.debt.name
    } (Remaining $${target.remaining.toFixed(2)})`;
    this.planSummary.appendChild(summaryText);

    const extraText = document.createElement("div");
    extraText.className = "debt-plan-extra";
    const baseExtraPayment = Number(settings.extraPayment) || 0;
    const snowballAmount = Number(monthInfo.snowballAmount) || 0;
    const rolloverAmount = Number(monthInfo.rolloverAmount) || 0;
    const breakdownParts = [`Base $${baseExtraPayment.toFixed(2)}`];
    if (rolloverAmount > 0) {
      breakdownParts.push(`Rollovers $${rolloverAmount.toFixed(2)}`);
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
    const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
    const transactions = this.store.getTransactions();
    let changed = false;
    let snowballAdded = false;

    if (
      allowMutation &&
      this.prunePaidOffDebtMinimumPayments(year, month, projection.payoffByDebtId)
    ) {
      changed = true;
    }

    const monthInfo = projection.monthTargets?.[monthKey] || {};
    const targetDebtId = monthInfo.targetDebtId;
    const snowballAmount = Number(monthInfo.snowballAmount) || 0;
    const targetDebt = targetDebtId
      ? this.store.getDebts().find((debt) => debt.id === targetDebtId)
      : null;
    const dueDate = targetDebt
      ? this.getDebtDueDateForMonth(targetDebt, year, month)
      : null;
    const dueDateString = dueDate ? Utils.formatDateString(dueDate) : null;

    if (allowMutation) {
      let hasMatchingSnowball = false;
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
          const shouldKeep =
            !force &&
            includeExtra &&
            snowballAmount > 0 &&
            targetDebtId &&
            dueDateString &&
            t.debtId === targetDebtId &&
            Math.abs(Number(t.amount) - snowballAmount) < 0.01 &&
            dateKey === dueDateString;
          if (shouldKeep) {
            hasMatchingSnowball = true;
            return true;
          }
          changed = true;
          return false;
        });
        if (filtered.length !== list.length) {
          if (filtered.length === 0) {
            delete transactions[dateKey];
          } else {
            transactions[dateKey] = filtered;
          }
        }
      });

      if (
        includeExtra &&
        snowballAmount > 0 &&
        targetDebtId &&
        dueDateString &&
        !hasMatchingSnowball
      ) {
        const transaction = {
          amount: snowballAmount,
          type: "expense",
          description: `Snowball Payment: ${targetDebt.name}`,
          debtId: targetDebt.id,
          debtRole: "snowball",
          debtName: targetDebt.name,
          snowballMonth: monthKey,
          snowballGenerated: true,
        };
        this.store.addTransaction(dueDateString, transaction);
        changed = true;
        snowballAdded = true;
      } else if (changed) {
        this.store.saveData();
      }
    }

    this.renderPlan();
    return snowballAdded;
  }
}

window.DebtSnowballUI = DebtSnowballUI;
