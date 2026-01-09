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

  promptUnlock(callback) {
    if (!this.isPinSet()) {
      callback();
      return;
    }
    let pin = prompt("Enter PIN to unlock:");
    if (pin === null) return;
    if (this.verifyPin(pin)) {
      this.currentPin = pin;
      callback();
    } else {
      alert("Incorrect PIN");
      this.promptUnlock(callback);
    }
  }

  promptChangePin(store) {
    let newPin;
    if (this.isPinSet()) {
      const oldPin = prompt("Enter current PIN:");
      if (oldPin === null) return;
      if (!this.verifyPin(oldPin)) {
        alert("Incorrect PIN");
        return;
      }
      newPin = prompt("Enter new PIN (leave blank to disable):");
      if (newPin === null) return;
      if (newPin === "") {
        this.clearPin();
        store.saveData(false);
        alert("PIN disabled");
        return;
      }
    } else {
      newPin = prompt("Set a new PIN:");
      if (newPin === null || newPin === "") return;
    }
    const confirmPin = prompt("Confirm PIN:");
    if (confirmPin === null || confirmPin !== newPin) {
      alert("PINs do not match");
      return;
    }
    this.setPin(newPin);
    store.saveData(false);
    alert("PIN updated");
  }
}

window.PinProtection = PinProtection;
