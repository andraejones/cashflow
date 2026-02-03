class PinProtection {
  constructor() {
    this.currentPin = "";
    this.inactivityTimeout = null;
    this.INACTIVITY_DELAY = 120000; // 120 seconds in milliseconds
    this.isLocked = false;
    this.activityEvents = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click'];
    this.boundResetTimer = this.resetInactivityTimer.bind(this);
    this.onUnlockCallback = null;
    this.onLockCallback = null;

    // WebAuthn state
    this.webAuthnAvailable = false;
    this.webAuthnEnabled = false;
    this.credentialId = null;
    this.webAuthnInitPromise = null;

    // Encryption constants
    this.SALT_LENGTH = 16;
    this.IV_LENGTH = 12;
    this.PBKDF2_ITERATIONS = 100000;

    // Initialize WebAuthn support check
    this.webAuthnInitPromise = this.initWebAuthn();
  }

  async initWebAuthn() {
    this.webAuthnAvailable = await this.checkWebAuthnSupport();
    this.credentialId = localStorage.getItem("webauthn_credential_id");
    this.webAuthnEnabled = this.webAuthnAvailable && this.credentialId !== null;
  }

  // Wait for WebAuthn initialization to complete
  async ensureWebAuthnInit() {
    if (this.webAuthnInitPromise) {
      await this.webAuthnInitPromise;
    }
  }

  async checkWebAuthnSupport() {
    if (!window.PublicKeyCredential) return false;
    try {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      return false;
    }
  }

  isWebAuthnEnabled() {
    return this.webAuthnEnabled && this.credentialId !== null;
  }

  isWebAuthnAvailable() {
    return this.webAuthnAvailable;
  }

  encodeBase64(value) {
    return btoa(unescape(encodeURIComponent(value)));
  }

  decodeBase64(value) {
    return decodeURIComponent(escape(atob(value)));
  }

  // Secure PIN hashing using SHA-256 with salt
  async hashPinSecure(pin, salt = null) {
    const encoder = new TextEncoder();
    // Generate or use provided salt
    if (!salt) {
      salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    } else if (typeof salt === 'string') {
      salt = this.base64ToArrayBuffer(salt);
      salt = new Uint8Array(salt);
    }

    // Combine salt + pin
    const saltedPin = new Uint8Array(salt.length + encoder.encode(pin).length);
    saltedPin.set(salt);
    saltedPin.set(encoder.encode(pin), salt.length);

    // Hash with SHA-256
    const hashBuffer = await crypto.subtle.digest('SHA-256', saltedPin);
    const hashArray = new Uint8Array(hashBuffer);

    // Return salt:hash as base64
    const saltBase64 = this.arrayBufferToBase64(salt.buffer);
    const hashBase64 = this.arrayBufferToBase64(hashBuffer);
    return `${saltBase64}:${hashBase64}`;
  }

  // Legacy hash for migration detection
  hashPinLegacy(pin) {
    return this.encodeBase64(pin).split("").reverse().join("");
  }

  isPinSet() {
    return localStorage.getItem("pin_hash") !== null;
  }

  // Check if stored hash is legacy format (no colon separator)
  _isLegacyHash() {
    const stored = localStorage.getItem("pin_hash");
    return stored && !stored.includes(':');
  }

  async verifyPin(pin) {
    const stored = localStorage.getItem("pin_hash");
    if (!stored) return false;

    // Check for legacy format and migrate if needed
    if (this._isLegacyHash()) {
      // Verify against legacy hash
      const legacyHash = this.hashPinLegacy(pin);
      if (legacyHash === stored) {
        // Migrate to secure hash
        const secureHash = await this.hashPinSecure(pin);
        localStorage.setItem("pin_hash", secureHash);
        console.log("Migrated PIN to secure hash format");
        return true;
      }
      return false;
    }

    // Verify against secure hash
    const [saltBase64] = stored.split(':');
    const computedHash = await this.hashPinSecure(pin, saltBase64);
    return computedHash === stored;
  }

  async setPin(pin) {
    const secureHash = await this.hashPinSecure(pin);
    localStorage.setItem("pin_hash", secureHash);
    this.currentPin = pin;
    // Start inactivity monitoring when PIN is set
    this.startInactivityMonitoring();
  }

  clearPin() {
    localStorage.removeItem("pin_hash");
    // Also clear WebAuthn credential and stored PIN when PIN is cleared
    localStorage.removeItem("webauthn_credential_id");
    this.clearBiometricPin();
    this.credentialId = null;
    this.webAuthnEnabled = false;
    this.currentPin = "";
    this.stopInactivityMonitoring();
  }

  getCurrentPin() {
    return this.currentPin;
  }

  // Derive AES key from PIN using PBKDF2
  async _deriveKey(pin, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(pin),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // AES-GCM encryption
  async encryptAES(value, pin) {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

    const key = await this._deriveKey(pin, salt);
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(value)
    );

    // Combine: salt (16) + iv (12) + ciphertext
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return this.arrayBufferToBase64(combined.buffer);
  }

  // AES-GCM decryption
  async decryptAES(encryptedValue, pin) {
    try {
      const combined = new Uint8Array(this.base64ToArrayBuffer(encryptedValue));

      const salt = combined.slice(0, this.SALT_LENGTH);
      const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
      const ciphertext = combined.slice(this.SALT_LENGTH + this.IV_LENGTH);

      const key = await this._deriveKey(pin, salt);
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("AES decryption error", e);
      return null;
    }
  }

  // Check if a value is encrypted with AES (has proper length for salt+iv+data)
  _isAESEncrypted(value) {
    try {
      const decoded = this.base64ToArrayBuffer(value);
      // Minimum length: salt (16) + iv (12) + at least 1 byte of ciphertext + tag (16)
      return decoded.byteLength >= this.SALT_LENGTH + this.IV_LENGTH + 17;
    } catch {
      return false;
    }
  }

  // Legacy XOR decrypt for migration
  _decryptLegacyXOR(value, pin) {
    try {
      const decoded = this.decodeBase64(value);
      const xor = Array.from(decoded).map((ch, i) =>
        String.fromCharCode(ch.charCodeAt(0) ^ pin.charCodeAt(i % pin.length))
      ).join("");
      return xor;
    } catch (e) {
      return null;
    }
  }

  // Synchronous encrypt for compatibility - stores as marker for async encryption
  encrypt(value) {
    if (!this.currentPin) return value;
    // For synchronous calls, we need to handle this differently
    // Store the value with a marker and encrypt asynchronously on next save
    // For now, use the legacy method but mark for migration
    const xor = Array.from(value).map((ch, i) =>
      String.fromCharCode(ch.charCodeAt(0) ^ this.currentPin.charCodeAt(i % this.currentPin.length))
    ).join("");
    return "xor:" + this.encodeBase64(xor);
  }

  // Synchronous decrypt for compatibility
  decrypt(value) {
    if (!this.currentPin) return value;
    try {
      // Check for legacy XOR format (no prefix or "xor:" prefix)
      if (value.startsWith("xor:")) {
        return this._decryptLegacyXOR(value.slice(4), this.currentPin);
      }
      // Try legacy XOR without prefix (for old data)
      const decoded = this.decodeBase64(value);
      const xor = Array.from(decoded).map((ch, i) =>
        String.fromCharCode(ch.charCodeAt(0) ^ this.currentPin.charCodeAt(i % this.currentPin.length))
      ).join("");
      return xor;
    } catch (e) {
      console.error("PIN decryption error", e);
      return "";
    }
  }

  // WebAuthn helper: convert ArrayBuffer to base64 string
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // WebAuthn helper: convert base64 string to ArrayBuffer
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Register a new WebAuthn credential (FaceID/TouchID)
  async registerWebAuthn() {
    if (!this.webAuthnAvailable) {
      throw new Error("WebAuthn not available on this device");
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = crypto.getRandomValues(new Uint8Array(16));

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge: challenge,
          rp: {
            name: "CashFlow Calendar"
          },
          user: {
            id: userId,
            name: "cashflow-user",
            displayName: "CashFlow User"
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" },   // ES256
            { alg: -257, type: "public-key" }  // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "discouraged"
          },
          timeout: 60000
        }
      });

      // Store credential ID for future authentication
      const credentialId = this.arrayBufferToBase64(credential.rawId);
      localStorage.setItem("webauthn_credential_id", credentialId);
      this.credentialId = credentialId;
      this.webAuthnEnabled = true;

      return true;
    } catch (error) {
      console.error("WebAuthn registration failed:", error);
      throw error;
    }
  }

  // Authenticate using WebAuthn (FaceID/TouchID)
  async authenticateWebAuthn() {
    if (!this.webAuthnEnabled || !this.credentialId) {
      throw new Error("WebAuthn not enabled");
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credentialIdBuffer = this.base64ToArrayBuffer(this.credentialId);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challenge,
          allowCredentials: [{
            id: credentialIdBuffer,
            type: "public-key"
          }],
          userVerification: "required",
          timeout: 60000
        }
      });

      // If we get here, authentication succeeded
      return true;
    } catch (error) {
      console.error("WebAuthn authentication failed:", error);
      throw error;
    }
  }

  // Store PIN for biometric unlock using device-bound key
  async storePinForBiometrics(pin) {
    // Use a device-specific key derived from credential ID for encryption
    const credentialId = this.credentialId || localStorage.getItem("webauthn_credential_id");
    if (!credentialId) {
      console.error("No credential ID available for biometric PIN storage");
      return;
    }

    // Derive encryption key from credential ID (device-bound secret)
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(credentialId),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const salt = crypto.getRandomValues(new Uint8Array(this.SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(this.IV_LENGTH));

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this.PBKDF2_ITERATIONS,
        hash: 'SHA-256'
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    );

    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      encoder.encode(pin)
    );

    // Combine: salt (16) + iv (12) + ciphertext
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    localStorage.setItem("biometric_pin", this.arrayBufferToBase64(combined.buffer));
  }

  // Retrieve PIN after biometric authentication
  async retrievePinForBiometrics() {
    const stored = localStorage.getItem("biometric_pin");
    if (!stored) return null;

    const credentialId = this.credentialId || localStorage.getItem("webauthn_credential_id");
    if (!credentialId) return null;

    try {
      // Check for legacy obfuscated format (shorter, no salt/iv structure)
      const decoded = this.base64ToArrayBuffer(stored);
      if (decoded.byteLength < this.SALT_LENGTH + this.IV_LENGTH + 17) {
        // Legacy format - decode and migrate
        const legacyPin = this.decodeBase64(stored).split('').reverse().join('');
        // Re-store with proper encryption
        await this.storePinForBiometrics(legacyPin);
        console.log("Migrated biometric PIN to secure format");
        return legacyPin;
      }

      // Modern AES-GCM encrypted format
      const combined = new Uint8Array(decoded);
      const salt = combined.slice(0, this.SALT_LENGTH);
      const iv = combined.slice(this.SALT_LENGTH, this.SALT_LENGTH + this.IV_LENGTH);
      const ciphertext = combined.slice(this.SALT_LENGTH + this.IV_LENGTH);

      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(credentialId),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.PBKDF2_ITERATIONS,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );

      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decrypted);
    } catch (e) {
      console.error("Error retrieving biometric PIN:", e);
      return null;
    }
  }

  // Clear stored biometric PIN
  clearBiometricPin() {
    localStorage.removeItem("biometric_pin");
  }

  // Enable biometric authentication
  async enableBiometrics() {
    if (!this.isPinSet()) {
      await Utils.showModalAlert("Please set a PIN first before enabling biometrics.", "PIN Required");
      return false;
    }

    if (!this.webAuthnAvailable) {
      await Utils.showModalAlert("Biometric authentication is not available on this device or browser.", "Not Available");
      return false;
    }

    // Need current PIN to store for biometric unlock
    if (!this.currentPin) {
      const pin = await Utils.showModalPrompt("Enter your PIN to enable biometrics:", "Enable Biometrics", {
        inputLabel: "PIN",
        inputType: "password",
        confirmText: "Continue",
      });
      if (!pin || !await this.verifyPin(pin)) {
        await Utils.showModalAlert("Incorrect PIN.", "Error");
        return false;
      }
      this.currentPin = pin;
    }

    try {
      await this.registerWebAuthn();
      // Store PIN for future biometric unlocks
      await this.storePinForBiometrics(this.currentPin);
      await Utils.showModalAlert("FaceID/TouchID enabled successfully!", "Success");
      return true;
    } catch (error) {
      if (error.name === "NotAllowedError") {
        await Utils.showModalAlert("Biometric setup was cancelled.", "Cancelled");
      } else {
        await Utils.showModalAlert("Failed to enable biometric authentication. Please try again.", "Error");
      }
      return false;
    }
  }

  // Disable biometric authentication
  async disableBiometrics() {
    localStorage.removeItem("webauthn_credential_id");
    this.clearBiometricPin();
    this.credentialId = null;
    this.webAuthnEnabled = false;
    await Utils.showModalAlert("FaceID/TouchID disabled.", "Disabled");
  }

  async promptUnlock() {
    if (!this.isPinSet()) {
      return true;
    }

    // Ensure WebAuthn initialization is complete before checking
    await this.ensureWebAuthnInit();

    // Try biometric authentication first if enabled
    if (this.isWebAuthnEnabled()) {
      try {
        const biometricResult = await this.authenticateWebAuthn();
        if (biometricResult) {
          // Biometric success - retrieve stored PIN
          const storedPin = await this.retrievePinForBiometrics();
          if (storedPin && await this.verifyPin(storedPin)) {
            this.currentPin = storedPin;
            this.isLocked = false;
            this.hideLockOverlay();
            this.startInactivityMonitoring();
            if (this.onUnlockCallback) {
              this.onUnlockCallback();
            }
            return true;
          }
          // Stored PIN invalid/missing, fall through to PIN dialog
          console.log("Stored PIN invalid, falling back to PIN entry");
        }
      } catch (error) {
        // Biometric failed or was cancelled, fall through to PIN dialog
        console.log("Biometric auth failed, falling back to PIN:", error.name);
      }
    }

    const result = await this.showUnlockDialog(false);

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

    if (await this.verifyPin(result)) {
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
      // Ensure unlock dialog is above the lock overlay
      modal.style.zIndex = "10000";

      const cleanup = () => {
        confirmButton.removeEventListener("click", handleConfirm);
        resetButton.removeEventListener("click", handleReset);
        modal.removeEventListener("keydown", handleKeydown);
        resetButton.style.display = "none";
        modal.style.display = "none";
        modal.setAttribute("aria-hidden", "true");
        // Reset z-index to allow ModalManager to manage it normally
        modal.style.zIndex = "";
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
      if (!await this.verifyPin(oldPin)) {
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
    await this.setPin(newPin);
    // Update stored biometric PIN if biometrics is enabled
    if (this.isWebAuthnEnabled()) {
      await this.storePinForBiometrics(newPin);
    }
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

    // Call lock callback if set (for stopping heartbeat, etc.)
    if (this.onLockCallback) {
      this.onLockCallback();
    }

    // Close any existing open modals before showing lock screen
    this.closeAllModals();

    this.showLockOverlay();
    this.promptUnlock();
  }

  closeAllModals() {
    // Close appModal if it's open
    const appModal = document.getElementById("appModal");
    if (appModal && appModal.style.display === "block") {
      appModal.style.display = "none";
      appModal.setAttribute("aria-hidden", "true");
      if (window.ModalManager) {
        window.ModalManager.closeModal(appModal);
      }
    }

    // Close debtSnowballModal if it's open
    const debtModal = document.getElementById("debtSnowballModal");
    if (debtModal && debtModal.style.display === "block") {
      debtModal.style.display = "none";
      debtModal.setAttribute("aria-hidden", "true");
      if (window.ModalManager) {
        window.ModalManager.closeModal(debtModal);
      }
    }

    // Close any other common modals
    const otherModals = document.querySelectorAll('.modal[style*="display: block"], .modal[style*="display:block"]');
    otherModals.forEach(modal => {
      modal.style.display = "none";
      modal.setAttribute("aria-hidden", "true");
      if (window.ModalManager) {
        window.ModalManager.closeModal(modal);
      }
    });
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
    // Ensure lock overlay is above all other modals
    overlay.style.zIndex = '9999';
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
