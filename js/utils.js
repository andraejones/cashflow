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
        modal.removeEventListener("click", handleBackdrop);
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

      const handleBackdrop = (event) => {
        if (event.target === modal) {
          handleClose();
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
        modal.addEventListener("click", handleBackdrop);
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
};
