class PinProtection {
  constructor() {
    this.currentPin = "";
    this.inactivityTimeout = null;
    this.INACTIVITY_DELAY = 120000; // 120 seconds in milliseconds
    this.isLocked = false;
    this.activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    this.boundResetTimer = this.resetInactivityTimer.bind(this);
    this.onUnlockCallback = null;
  }

  encodeBase64(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  decodeBase64(value) {
    return decodeURIComponent(escape(atob(value)));
  }

  hashPin(pin) {
    return this.encodeBase64(pin).split("").reverse().join("");
  }

  isPinSet() {
    return localStorage.getItem("pin_hash") !== null;
  }

  verifyPin(pin) {
    return this.hashPin(pin) === localStorage.getItem("pin_hash");
  }

  setPin(pin) {
    localStorage.setItem("pin_hash", this.hashPin(pin));
    this.currentPin = pin;
    // Start inactivity monitoring when PIN is set
    this.startInactivityMonitoring();
  }

  clearPin() {
    localStorage.removeItem("pin_hash");
    this.currentPin = "";
    this.stopInactivityMonitoring();
  }

  getCurrentPin() {
    return this.currentPin;
  }

  encrypt(value) {
    if (!this.currentPin) return value;
    const xor = Array.from(value).map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ this.currentPin.charCodeAt(i % this.currentPin.length))).join("");
    return this.encodeBase64(xor);
  }

  decrypt(value) {
    if (!this.currentPin) return value;
    try {
      const decoded = this.decodeBase64(value);
      const xor = Array.from(decoded).map((ch, i) => String.fromCharCode(ch.charCodeAt(0) ^ this.currentPin.charCodeAt(i % this.currentPin.length))).join("");
      return xor;
    } catch (e) {
      console.error("PIN decryption error", e);
      return "";
    }
  }

  async promptUnlock() {
    if (!this.isPinSet()) {
      return true;
    }

    const result = await this.showUnlockDialog();

    if (result === "reset") {
      // User chose to reset - confirm with DELETE
      const confirmation = await Utils.showModalPrompt(
        "Type DELETE to confirm resetting all data. This cannot be undone.",
        "Reset Application",
        {
          inputLabel: "Type DELETE to confirm",
          inputType: "text",
          confirmText: "Reset",
          cancelText: "Cancel",
        }
      );

      if (confirmation === "DELETE") {
        this.clearPin();
        localStorage.clear();
        await Utils.showModalAlert("Application has been reset. The page will now reload.", "Reset Complete");
        window.location.reload();
        return false;
      } else if (confirmation !== null) {
        await Utils.showModalAlert("Reset cancelled. You must type DELETE exactly.", "Reset Cancelled");
      }
      // Return to unlock prompt
      return this.promptUnlock();
    }

    if (result === null) return false;

    if (this.verifyPin(result)) {
      this.currentPin = result;
      this.isLocked = false;
      this.hideLockOverlay();
      this.startInactivityMonitoring();
      // Call unlock callback if set (for cloud refresh, etc.)
      if (this.onUnlockCallback) {
        this.onUnlockCallback();
      }
      return true;
    }
    await Utils.showModalAlert("Incorrect PIN", "Unlock Failed");
    return this.promptUnlock();
  }

  showUnlockDialog() {
    return new Promise((resolve) => {
      const modal = document.getElementById("appModal");
      if (!modal) {
        resolve(null);
        return;
      }

      const titleEl = document.getElementById("appModalTitle");
      const messageEl = document.getElementById("appModalMessage");
      const inputWrapper = modal.querySelector(".app-modal-input-wrapper");
      const input = document.getElementById("appModalInput");
      const inputLabel = document.getElementById("appModalInputLabel");
      const confirmButton = document.getElementById("appModalConfirm");
      const cancelButton = document.getElementById("appModalCancel");
      const closeButton = document.getElementById("appModalClose");

      // Set up the dialog
      titleEl.textContent = "Unlock";
      messageEl.textContent = "Enter PIN to unlock:";
      inputWrapper.classList.add("is-visible");
      input.type = "password";
      input.value = "";
      inputLabel.textContent = "PIN";
      confirmButton.textContent = "Unlock";
      cancelButton.style.display = "none";
      closeButton.style.display = "none";

      // Create reset button if it doesn't exist
      let resetButton = modal.querySelector("#appModalReset");
      if (!resetButton) {
        resetButton = document.createElement("button");
        resetButton.id = "appModalReset";
        resetButton.className = "secondary-button app-modal-reset-btn";
        resetButton.textContent = "Reset Application";
        resetButton.type = "button";
        const buttonContainer = confirmButton.parentElement;
        buttonContainer.appendChild(resetButton);
      }
      resetButton.style.display = "inline-flex";

      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");

      const cleanup = () => {
        confirmButton.removeEventListener("click", handleConfirm);
        resetButton.removeEventListener("click", handleReset);
        modal.removeEventListener("keydown", handleKeydown);
        resetButton.style.display = "none";
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
      };

      const handleConfirm = () => {
        const value = input.value;
        cleanup();
        resolve(value);
      };

      const handleReset = () => {
        cleanup();
        resolve("reset");
      };

      const handleKeydown = (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          handleConfirm();
        }
      };

      confirmButton.addEventListener("click", handleConfirm);
      resetButton.addEventListener("click", handleReset);
      modal.addEventListener("keydown", handleKeydown);

      setTimeout(() => input.focus(), 50);
    });
  }

  async promptChangePin(store) {
    let newPin;
    if (this.isPinSet()) {
      const oldPin = await Utils.showModalPrompt(
        "Enter current PIN:",
        "Change PIN",
        {
          inputLabel: "Current PIN",
          inputType: "password",
          confirmText: "Continue",
        }
      );
      if (oldPin === null) return;
      if (!this.verifyPin(oldPin)) {
        await Utils.showModalAlert("Incorrect PIN", "Change PIN");
        return;
      }
      newPin = await Utils.showModalPrompt(
        "Enter new PIN (leave blank to disable):",
        "Change PIN",
        {
          inputLabel: "New PIN",
          inputType: "password",
          confirmText: "Continue",
        }
      );
      if (newPin === null) return;
      if (newPin === "") {
        this.clearPin();
        store.saveData(false);
        await Utils.showModalAlert("PIN disabled", "Change PIN");
        return;
      }
    } else {
      newPin = await Utils.showModalPrompt("Set a new PIN:", "Set PIN", {
        inputLabel: "New PIN",
        inputType: "password",
        confirmText: "Set PIN",
      });
      if (newPin === null || newPin === "") return;
    }
    const confirmPin = await Utils.showModalPrompt(
      "Confirm PIN:",
      "Confirm PIN",
      {
        inputLabel: "Confirm PIN",
        inputType: "password",
        confirmText: "Save PIN",
      }
    );
    if (confirmPin === null || confirmPin !== newPin) {
      await Utils.showModalAlert("PINs do not match", "Confirm PIN");
      return;
    }
    this.setPin(newPin);
    store.saveData(false);
    await Utils.showModalAlert("PIN updated", "Change PIN");
  }

  // Inactivity timeout methods
  startInactivityMonitoring() {
    if (!this.isPinSet()) return;

    // Add event listeners for user activity
    this.activityEvents.forEach(event => {
      document.addEventListener(event, this.boundResetTimer, { passive: true });
    });

    // Start the timer
    this.resetInactivityTimer();
  }

  stopInactivityMonitoring() {
    // Remove all event listeners
    this.activityEvents.forEach(event => {
      document.removeEventListener(event, this.boundResetTimer);
    });

    // Clear the timeout
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }
  }

  resetInactivityTimer() {
    // Don't reset if already locked or no PIN set
    if (this.isLocked || !this.isPinSet()) return;

    // Clear existing timeout
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
    }

    // Set new timeout
    this.inactivityTimeout = setTimeout(() => {
      this.lockApp();
    }, this.INACTIVITY_DELAY);
  }

  lockApp() {
    if (!this.isPinSet() || this.isLocked) return;

    this.isLocked = true;
    this.stopInactivityMonitoring();
    this.showLockOverlay();
    this.promptUnlock();
  }

  showLockOverlay() {
    // Create overlay if it doesn't exist
    let overlay = document.getElementById('lockOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'lockOverlay';
      overlay.className = 'lock-overlay';
      document.body.appendChild(overlay);
    }
    overlay.style.display = 'block';
    document.body.classList.add('app-locked');
  }

  hideLockOverlay() {
    const overlay = document.getElementById('lockOverlay');
    if (overlay) {
      overlay.style.display = 'none';
    }
    document.body.classList.remove('app-locked');
  }
}

window.PinProtection = PinProtection;
