// Utility helpers

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

    document.body.appendChild(toast);
    toast.style.display = "block";

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
      alternateButton: document.getElementById("appModalAlternate"),
      cancelButton: document.getElementById("appModalCancel"),
      closeButton: document.getElementById("appModalClose"),
    };
  },

  showModalDialog: function ({
    title = "Notice",
    message = "",
    confirmText = "OK",
    alternateText = "",
    cancelText = "Cancel",
    showCancel = false,
    showAlternate = false,
    showInput = false,
    inputLabel = "",
    inputValue = "",
    inputType = "text",
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
      alternateButton,
      cancelButton,
      closeButton,
    } = elements;

    titleEl.textContent = title;
    messageEl.textContent = message;
    confirmButton.textContent = confirmText;
    alternateButton.textContent = alternateText;
    cancelButton.textContent = cancelText;
    cancelButton.style.display = showCancel ? "inline-flex" : "none";
    alternateButton.style.display =
      showAlternate && !showInput ? "inline-flex" : "none";

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

    const previousActiveElement = document.activeElement;

    return new Promise((resolve) => {
      const closeModal = (result) => {
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        confirmButton.removeEventListener("click", handleConfirm);
        alternateButton.removeEventListener("click", handleAlternate);
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

      const handleAlternate = () => {
        closeModal("alternate");
      };

      const handleCancel = () => {
        if (showInput) {
          closeModal(null);
        } else {
          closeModal(false);
        }
      };

      const handleBackdrop = (event) => {
        if (event.target === modal) {
          handleCancel();
        }
      };

      const handleKeydown = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          handleCancel();
        }
        if (event.key === "Enter" && showInput) {
          event.preventDefault();
          handleConfirm();
        }
      };

      confirmButton.addEventListener("click", handleConfirm);
      alternateButton.addEventListener("click", handleAlternate);
      cancelButton.addEventListener("click", handleCancel);
      closeButton.addEventListener("click", handleCancel);
      modal.addEventListener("click", handleBackdrop);
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
    });
  },
};
