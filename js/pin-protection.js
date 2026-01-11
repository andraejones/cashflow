class PinProtection {
  constructor() {
    this.currentPin = "";
    this.inactivityTimeout = null;
    this.INACTIVITY_DELAY = 120000; // 120 seconds in milliseconds
    this.isLocked = false;
    this.activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    this.boundResetTimer = this.resetInactivityTimer.bind(this);
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
    const pin = await Utils.showModalPrompt("Enter PIN to unlock:", "Unlock", {
      inputLabel: "PIN",
      inputType: "password",
      confirmText: "Unlock",
      cancelText: "Cancel",
    });
    if (pin === null) return false;
    if (this.verifyPin(pin)) {
      this.currentPin = pin;
      this.isLocked = false;
      this.hideLockOverlay();
      this.startInactivityMonitoring();
      return true;
    }
    await Utils.showModalAlert("Incorrect PIN", "Unlock Failed");
    return this.promptUnlock();
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
