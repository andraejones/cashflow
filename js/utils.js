// Utility helpers

// Modal Manager for tracking open modals and z-index management
const ModalManager = {
  _baseZIndex: 1000,
  _openModals: [],
  _zIndexCounter: 0,

  // Register a modal as opened and assign z-index
  openModal: function (modalElement) {
    if (!modalElement) return undefined;

    // Remove if already in stack (re-opening)
    this._openModals = this._openModals.filter(m => m !== modalElement);

    // Add to stack
    this._openModals.push(modalElement);

    // Increment counter and assign z-index
    this._zIndexCounter++;
    const zIndex = this._baseZIndex + (this._zIndexCounter * 10);
    modalElement.style.zIndex = zIndex;
    return zIndex;
  },

  // Unregister a modal when closed
  closeModal: function (modalElement) {
    if (!modalElement) return;

    this._openModals = this._openModals.filter(m => m !== modalElement);

    // Reset z-index to default
    modalElement.style.zIndex = '';
  },

  // Get the topmost modal
  getTopModal: function () {
    return this._openModals.length > 0 ? this._openModals[this._openModals.length - 1] : null;
  },

  // Check if a modal is the topmost
  isTopModal: function (modalElement) {
    return this.getTopModal() === modalElement;
  },

  // Get count of open modals
  getOpenCount: function () {
    return this._openModals.length;
  },

  // Alias for openModal (for test compatibility)
  register: function (modalElement) {
    return this.openModal(modalElement);
  },

  // Alias for closeModal (for test compatibility)
  unregister: function (modalElement) {
    return this.closeModal(modalElement);
  },

  // Get the next z-index value for a new modal (always increasing)
  getNextZIndex: function () {
    this._zIndexCounter++;
    return this._baseZIndex + (this._zIndexCounter * 10);
  }
};

// Expose ModalManager globally for tests
window.ModalManager = ModalManager;

const Utils = {
  // Counter to ensure uniqueness for IDs generated in the same millisecond
  _idCounter: 0,
  _lastIdTimestamp: 0,

  generateUniqueId: function () {
    const now = Date.now();

    // Reset counter if timestamp changed, otherwise increment
    if (now !== this._lastIdTimestamp) {
      this._lastIdTimestamp = now;
      this._idCounter = 0;
    } else {
      this._idCounter++;
    }

    // Combine timestamp + counter + random for collision resistance
    // - timestamp (base 36): ~8 chars, provides temporal uniqueness
    // - counter (base 36): handles multiple IDs per millisecond
    // - random (base 36): adds entropy, ~11 chars from substring(2)
    return now.toString(36) + this._idCounter.toString(36) + Math.random().toString(36).substring(2);
  },


  formatDateString: function (date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },


  // Parse date string to Date object using noon to avoid DST/timezone issues
  parseDateString: function (dateString) {
    if (!dateString || typeof dateString !== 'string') {
      return null;
    }
    const [year, month, day] = dateString.split("-").map(Number);
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      return null;
    }
    return new Date(year, month - 1, day, 12, 0, 0);
  },


  formatDisplayDate: function (dateString) {
    const dateObj = this.parseDateString(dateString);
    if (!dateObj) {
      return "";
    }

    return dateObj.toLocaleString("default", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  },


  showNotification: function (message, type = "success") {
    const existingToasts = document.querySelectorAll(
      ".error-toast, .success-toast"
    );
    existingToasts.forEach((toast) => toast.remove());

    const toast = document.createElement("div");
    toast.className = type === "success" ? "success-toast" : "error-toast";
    toast.textContent = message;
    // Add ARIA attributes for accessibility
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");

    document.body.appendChild(toast);
    toast.style.display = "block";

    // Also announce to the dedicated ARIA live region for broader screen reader support
    this.announceToScreenReader(message);

    setTimeout(() => {
      toast.style.animation = "slideOut 0.3s ease-in forwards";
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  },

  getAppModalElements: function () {
    const modal = document.getElementById("appModal");
    if (!modal) {
      console.warn("App modal not found in the DOM.");
      return null;
    }

    return {
      modal,
      title: document.getElementById("appModalTitle"),
      message: document.getElementById("appModalMessage"),
      input: document.getElementById("appModalInput"),
      inputLabel: document.getElementById("appModalInputLabel"),
      inputWrapper: modal.querySelector(".app-modal-input-wrapper"),
      confirmButton: document.getElementById("appModalConfirm"),
      cancelButton: document.getElementById("appModalCancel"),
      closeButton: document.getElementById("appModalClose"),
    };
  },

  showModalDialog: function ({
    title = "Notice",
    message = "",
    confirmText = "OK",
    cancelText = "Cancel",
    showCancel = false,
    showInput = false,
    inputLabel = "",
    inputValue = "",
    inputType = "text",
    closeReturnsNull = false,
    mandatory = false,
  } = {}) {
    const elements = this.getAppModalElements();
    if (!elements) {
      if (showInput) {
        return Promise.resolve(null);
      }
      if (showCancel) {
        return Promise.resolve(false);
      }
      return Promise.resolve();
    }

    const {
      modal,
      title: titleEl,
      message: messageEl,
      input,
      inputLabel: inputLabelEl,
      inputWrapper,
      confirmButton,
      cancelButton,
      closeButton,
    } = elements;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmButton.textContent = confirmText;
    cancelButton.textContent = cancelText;
    cancelButton.style.display = (showCancel && !mandatory) ? "inline-flex" : "none";
    closeButton.style.display = mandatory ? "none" : "block";

    if (showInput) {
      inputWrapper.classList.add("is-visible");
      input.type = inputType;
      input.value = inputValue;
      inputLabelEl.textContent = inputLabel;
    } else {
      inputWrapper.classList.remove("is-visible");
      input.value = "";
      inputLabelEl.textContent = "";
    }

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);

    const previousActiveElement = document.activeElement;

    return new Promise((resolve) => {
      const closeModal = (result) => {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        ModalManager.closeModal(modal);
        confirmButton.removeEventListener("click", handleConfirm);
        cancelButton.removeEventListener("click", handleCancel);
        closeButton.removeEventListener("click", handleCancel);
        modal.removeEventListener("keydown", handleKeydown);
        if (previousActiveElement && previousActiveElement.focus) {
          previousActiveElement.focus();
        }
        resolve(result);
      };

      const handleConfirm = () => {
        if (showInput) {
          closeModal(input.value);
        } else {
          closeModal(true);
        }
      };

      const handleCancel = () => {
        if (showInput) {
          closeModal(null);
        } else {
          closeModal(false);
        }
      };

      const handleClose = () => {
        if (closeReturnsNull) {
          closeModal(null);
        } else {
          handleCancel();
        }
      };

      const handleKeydown = (event) => {
        if (event.key === "Escape" && !mandatory) {
          event.preventDefault();
          handleClose();
        }
        if (event.key === "Enter" && showInput) {
          event.preventDefault();
          handleConfirm();
        }
      };

      confirmButton.addEventListener("click", handleConfirm);
      if (!mandatory) {
        cancelButton.addEventListener("click", handleCancel);
        closeButton.addEventListener("click", handleClose);
      }
      modal.addEventListener("keydown", handleKeydown);

      setTimeout(() => {
        if (showInput) {
          input.focus();
        } else {
          confirmButton.focus();
        }
      }, 50);
    });
  },

  showModalAlert: function (message, title = "Notice") {
    return this.showModalDialog({ title, message, showCancel: false });
  },

  showModalConfirm: function (message, title = "Confirm", options = {}) {
    return this.showModalDialog({
      title,
      message,
      showCancel: true,
      confirmText: options.confirmText || "OK",
      cancelText: options.cancelText || "Cancel",
      closeReturnsNull: options.closeReturnsNull === true,
    });
  },

  showModalPrompt: function (message, title = "Prompt", options = {}) {
    return this.showModalDialog({
      title,
      message,
      showCancel: true,
      showInput: true,
      inputLabel: options.inputLabel || "",
      inputValue: options.inputValue || "",
      inputType: options.inputType || "text",
      confirmText: options.confirmText || "OK",
      cancelText: options.cancelText || "Cancel",
      mandatory: options.mandatory === true,
    });
  },

  // Show loading overlay with optional custom message
  showLoading: function (message = "Loading...") {
    const overlay = document.getElementById("loadingOverlay");
    const textEl = document.getElementById("loadingText");
    if (overlay) {
      if (textEl) {
        textEl.textContent = message;
      }
      overlay.classList.add("active");
      overlay.setAttribute("aria-hidden", "false");
    }
  },

  // Hide loading overlay
  hideLoading: function () {
    const overlay = document.getElementById("loadingOverlay");
    if (overlay) {
      overlay.classList.remove("active");
      overlay.setAttribute("aria-hidden", "true");
    }
  },

  // Announce message to screen readers via ARIA live region
  announceToScreenReader: function (message) {
    const liveRegion = document.getElementById("ariaLiveRegion");
    if (liveRegion) {
      // Clear and set message to trigger announcement
      liveRegion.textContent = "";
      // Use setTimeout to ensure the DOM update is processed
      setTimeout(() => {
        liveRegion.textContent = message;
      }, 50);
    }
  },

  // Alias for showLoading (for test compatibility)
  showLoadingOverlay: function (message) {
    return this.showLoading(message);
  },

  // Alias for hideLoading (for test compatibility)
  hideLoadingOverlay: function () {
    return this.hideLoading();
  },

  // Alias for announceToScreenReader (for test compatibility)
  announce: function (message) {
    return this.announceToScreenReader(message);
  },

  // Add negative balance indicator class to an element
  addNegativeIndicator: function (element) {
    if (element) {
      element.classList.add('negative-balance');
    }
  },

  DAY_SPECIFIC_OPTIONS: [
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
  ],

  MONTH_LABELS: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],

  cleanUpHtmlArtifacts: function () {
    const bodyChildren = Array.from(document.body.childNodes);
    for (let i = 0; i < bodyChildren.length; i++) {
      const node = bodyChildren[i];
      if (node.nodeType === Node.TEXT_NODE &&
        (node.textContent.includes("<div") ||
          node.textContent.includes("modal-content"))) {
        document.body.removeChild(node);
      }
    }
  },

  _buildId: function (prefix, baseName) {
    if (!prefix) return baseName;
    return prefix + baseName[0].toUpperCase() + baseName.slice(1);
  },

  buildSemiMonthlyOptions: function (container, idPrefix) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", this._buildId(idPrefix, "semiMonthlyFirstDay"));
    label.textContent = "Days of month:";

    const helpText = document.createElement("span");
    helpText.className = "help-text";
    helpText.textContent = "Select two days of the month";
    const firstDaySelect = document.createElement("select");
    firstDaySelect.id = this._buildId(idPrefix, "semiMonthlyFirstDay");
    firstDaySelect.name = this._buildId(idPrefix, "semiMonthlyFirstDay");
    const secondDaySelect = document.createElement("select");
    secondDaySelect.id = this._buildId(idPrefix, "semiMonthlySecondDay");
    secondDaySelect.name = this._buildId(idPrefix, "semiMonthlySecondDay");
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
  },

  buildCustomIntervalOptions: function (container, idPrefix) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", this._buildId(idPrefix, "customIntervalValue"));
    label.textContent = "Repeat every:";

    const intervalValue = document.createElement("input");
    intervalValue.type = "number";
    intervalValue.id = this._buildId(idPrefix, "customIntervalValue");
    intervalValue.name = this._buildId(idPrefix, "customIntervalValue");
    intervalValue.min = "1";
    intervalValue.value = "1";
    intervalValue.style.width = "60px";

    const intervalUnit = document.createElement("select");
    intervalUnit.id = this._buildId(idPrefix, "customIntervalUnit");
    intervalUnit.name = this._buildId(idPrefix, "customIntervalUnit");

    const unitOptions = [
      { value: "days", label: "Day(s)" },
      { value: "weeks", label: "Week(s)" },
      { value: "months", label: "Month(s)" },
    ];

    unitOptions.forEach(function (option) {
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
  },

  buildBusinessDayOptions: function (container, idPrefix) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", this._buildId(idPrefix, "businessDayAdjustment"));
    label.textContent = "When transaction falls on weekend:";

    const adjustmentSelect = document.createElement("select");
    adjustmentSelect.id = this._buildId(idPrefix, "businessDayAdjustment");
    adjustmentSelect.name = this._buildId(idPrefix, "businessDayAdjustment");

    const adjustmentOptions = [
      { value: "none", label: "No adjustment" },
      { value: "previous", label: "Move to previous business day" },
      { value: "next", label: "Move to next business day" },
      { value: "nearest", label: "Move to nearest business day" },
    ];

    adjustmentOptions.forEach(function (option) {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      adjustmentSelect.appendChild(optionElement);
    });

    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(adjustmentSelect);

    container.appendChild(group);
  },

  buildVariableAmountOptions: function (container, idPrefix) {
    const group = document.createElement("div");
    group.className = "option-group";
    const checkboxDiv = document.createElement("div");

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = this._buildId(idPrefix, "variableAmountCheck");
    checkbox.name = this._buildId(idPrefix, "variableAmountCheck");

    const checkboxLabel = document.createElement("label");
    checkboxLabel.setAttribute("for", this._buildId(idPrefix, "variableAmountCheck"));
    checkboxLabel.textContent = "Amount changes over time";

    checkboxDiv.appendChild(checkbox);
    checkboxDiv.appendChild(checkboxLabel);
    const variableOptions = document.createElement("div");
    variableOptions.id = this._buildId(idPrefix, "variableAmountOptions");
    variableOptions.style.display = "none";
    variableOptions.style.marginTop = "10px";

    const percentLabel = document.createElement("label");
    percentLabel.setAttribute("for", this._buildId(idPrefix, "variablePercentage"));
    percentLabel.textContent = "Percentage change per occurrence:";

    const percentInput = document.createElement("input");
    percentInput.type = "number";
    percentInput.id = this._buildId(idPrefix, "variablePercentage");
    percentInput.name = this._buildId(idPrefix, "variablePercentage");
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
  },

  buildEndConditionOptions: function (container, idPrefix) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.textContent = "End condition:";
    const radioGroup = document.createElement("div");
    radioGroup.className = "radio-group";
    const noEndRadioDiv = document.createElement("div");

    const radioName = this._buildId(idPrefix, "endCondition");

    const noEndRadio = document.createElement("input");
    noEndRadio.type = "radio";
    noEndRadio.id = this._buildId(idPrefix, "endConditionNone");
    noEndRadio.name = radioName;
    noEndRadio.value = "none";
    noEndRadio.checked = true;

    const noEndLabel = document.createElement("label");
    noEndLabel.setAttribute("for", this._buildId(idPrefix, "endConditionNone"));
    noEndLabel.textContent = "No end date";

    noEndRadioDiv.appendChild(noEndRadio);
    noEndRadioDiv.appendChild(noEndLabel);
    const endDateRadioDiv = document.createElement("div");

    const endDateRadio = document.createElement("input");
    endDateRadio.type = "radio";
    endDateRadio.id = this._buildId(idPrefix, "endConditionDate");
    endDateRadio.name = radioName;
    endDateRadio.value = "date";

    const endDateLabel = document.createElement("label");
    endDateLabel.setAttribute("for", this._buildId(idPrefix, "endConditionDate"));
    endDateLabel.textContent = "End by date:";

    const endDateInput = document.createElement("input");
    endDateInput.type = "date";
    endDateInput.id = this._buildId(idPrefix, "endDate");
    endDateInput.name = this._buildId(idPrefix, "endDate");
    endDateInput.disabled = true;

    endDateRadioDiv.appendChild(endDateRadio);
    endDateRadioDiv.appendChild(endDateLabel);
    endDateRadioDiv.appendChild(document.createElement("br"));
    endDateRadioDiv.appendChild(endDateInput);
    const endOccurrenceRadioDiv = document.createElement("div");

    const endOccurrenceRadio = document.createElement("input");
    endOccurrenceRadio.type = "radio";
    endOccurrenceRadio.id = this._buildId(idPrefix, "endConditionOccurrence");
    endOccurrenceRadio.name = radioName;
    endOccurrenceRadio.value = "occurrence";

    const endOccurrenceLabel = document.createElement("label");
    endOccurrenceLabel.setAttribute("for", this._buildId(idPrefix, "endConditionOccurrence"));
    endOccurrenceLabel.textContent = "End after:";

    const endOccurrenceInput = document.createElement("input");
    endOccurrenceInput.type = "number";
    endOccurrenceInput.id = this._buildId(idPrefix, "maxOccurrences");
    endOccurrenceInput.name = this._buildId(idPrefix, "maxOccurrences");
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
  },
};
