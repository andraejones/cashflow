// Utility helpers

// Modal Manager for tracking open modals and z-index management
const ModalManager = {
  _baseZIndex: 1000,
  _openModals: [],

  // Register a modal as opened and assign z-index
  openModal: function (modalElement) {
    if (!modalElement) return;

    // Remove if already in stack (re-opening)
    this._openModals = this._openModals.filter(m => m !== modalElement);

    // Add to stack
    this._openModals.push(modalElement);

    // Assign z-index based on position in stack
    const zIndex = this._baseZIndex + (this._openModals.length * 10);
    modalElement.style.zIndex = zIndex;
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
  }
};

const Utils = {

  generateUniqueId: function () {
    return Date.now().toString(36) + Math.random().toString(36).substring(2);
  },


  formatDateString: function (date) {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const day = date.getDate().toString().padStart(2, "0");
    return `${year}-${month}-${day}`;
  },


  formatDisplayDate: function (dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    const dateObj = new Date(Date.UTC(year, month - 1, day));

    return dateObj.toLocaleString("default", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
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
};
