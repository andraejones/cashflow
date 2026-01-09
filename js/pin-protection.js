class PinProtection {
  constructor() {
    this.currentPin = "";
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
  }

  clearPin() {
    localStorage.removeItem("pin_hash");
    this.currentPin = "";
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
}

window.PinProtection = PinProtection;
