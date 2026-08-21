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

    // Tracks how the user successfully unlocked this session ('biometric' | 'pin' | null).
    // After an inactivity lock, re-unlock must use the same method.
    this.lastUnlockMethod = null;

    // Encryption constants
    this.SALT_LENGTH = 16;
    this.IV_LENGTH = 12;
    this.PBKDF2_ITERATIONS = 100000;

    // Initialize WebAuthn support check
    this.webAuthnInitPromise = this.initWebAuthn();
  }

  async initWebAuthn() {
    // Nothing in here may reject. promptUnlock() awaits this promise before it
    // will show the unlock dialog at all, and lockApp() calls promptUnlock()
    // without a catch — so a throw here (a browser that denies localStorage,
    // an authenticator query that blows up) would leave the lock overlay up
    // with no way past it. Failing to detect biometrics just means PIN entry.
    try {
      this.webAuthnAvailable = await this.checkWebAuthnSupport();
    } catch (error) {
      console.warn("WebAuthn support check failed:", error);
      this.webAuthnAvailable = false;
    }
    try {
      this.credentialId = localStorage.getItem("webauthn_credential_id");
    } catch (error) {
      console.warn("Could not read the stored WebAuthn credential:", error);
      this.credentialId = null;
    }
    this.webAuthnEnabled = this.webAuthnAvailable && this.credentialId !== null;
  }

  // Wait for WebAuthn initialization to complete
  async ensureWebAuthnInit() {
    if (this.webAuthnInitPromise) {
      // Belt to initWebAuthn's braces: an unlock must never be blocked by a
      // failed capability probe. Callers only read the flags it sets, which
      // default to "no biometrics available".
      try {
        await this.webAuthnInitPromise;
      } catch (error) {
        console.warn("WebAuthn initialization failed:", error);
      }
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

  isPinSet() {
    return localStorage.getItem("pin_hash") !== null;
  }

  async verifyPin(pin) {
    const stored = localStorage.getItem("pin_hash");
    // Only the salted salt:hash format is supported (legacy hashes were
    // migrated on unlock long ago); anything else fails closed.
    if (!stored || !stored.includes(':')) return false;

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
    this.lastUnlockMethod = null;
    this.stopInactivityMonitoring();
  }

  getCurrentPin() {
    return this.currentPin;
  }

  // Synchronous encrypt for compatibility - stores as marker for async encryption
  encrypt(value) {
    if (!this.currentPin) return value;
    const bytes = new TextEncoder().encode(value);
    const pinBytes = new TextEncoder().encode(this.currentPin);
    const xored = bytes.map((b, i) => b ^ pinBytes[i % pinBytes.length]);
    // Use Array.from to build the string correctly and avoid maximum call stack bug
    const binaryString = Array.from(xored, byte => String.fromCharCode(byte)).join('');
    return "xor2:" + btoa(binaryString);
  }

  // Synchronous decrypt for compatibility
  decrypt(value) {
    if (!this.currentPin) return value;
    try {
      // Byte-level XOR (emoji-safe). Anything without the prefix is
      // unrecoverable (legacy formats were re-encrypted on save long ago);
      // return "" so loadData's loadFailed guard protects the on-disk copy.
      if (!value.startsWith("xor2:")) {
        console.error("PIN decryption error: unrecognized ciphertext format");
        return "";
      }
      const raw = atob(value.slice(5));
      const bytes = Uint8Array.from(raw, ch => ch.charCodeAt(0));
      const pinBytes = new TextEncoder().encode(this.currentPin);
      const xored = bytes.map((b, i) => b ^ pinBytes[i % pinBytes.length]);
      return new TextDecoder().decode(xored);
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

  // Reuse an existing passkey for this domain instead of registering a new
  // one. An assertion with no allowCredentials list lets the platform offer
  // any discoverable credential it (or a third-party provider like a
  // password manager) already holds for this origin; the response's rawId is
  // the credential ID we need to store. This matters on iOS standalone PWAs:
  // their localStorage starts empty, so the credential ID saved under Safari
  // is gone even though the passkey itself still exists — and re-registering
  // can crash inside third-party passkey providers (Bitwarden 2026.6
  // MakeCredential bug) whose assertion path works fine.
  async discoverExistingCredential() {
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge: challenge,
          userVerification: "required",
          timeout: 60000
        }
      });
      if (!assertion || !assertion.rawId) return null;
      return this.arrayBufferToBase64(assertion.rawId);
    } catch (e) {
      // No discoverable credential, provider error, or user dismissal —
      // caller falls back to registering a brand-new credential.
      console.log("No existing credential discovered:", e && e.name);
      return null;
    }
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

  // Store PIN for biometric unlock using device-bound key.
  //
  // SECURITY NOTE: this is obfuscation, not real encryption. The AES-GCM key is
  // derived (PBKDF2) from the WebAuthn credential ID, which is itself stored in
  // plaintext in localStorage (`webauthn_credential_id`). Anyone with
  // localStorage read access can re-derive the key and recover the master PIN.
  // It only raises the bar above storing the PIN in the clear; it does not
  // protect against an attacker who already has localStorage access. (Same
  // structural shape as cloud-sync's token "encryption" keyed off the plaintext
  // _device_id.)
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
      // AES-GCM encrypted format: salt + iv + ciphertext
      const combined = new Uint8Array(this.base64ToArrayBuffer(stored));
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
      // Prefer reusing a passkey that already exists for this domain (e.g.
      // one registered under Safari before the standalone PWA got its own
      // localStorage, possibly living in a third-party provider). Only
      // register a brand-new credential when none is offered.
      const existingId = await this.discoverExistingCredential();
      if (existingId) {
        localStorage.setItem("webauthn_credential_id", existingId);
        this.credentialId = existingId;
        this.webAuthnEnabled = true;
      } else {
        await this.registerWebAuthn();
      }
      // Store PIN for future biometric unlocks
      await this.storePinForBiometrics(this.currentPin);
      await Utils.showModalAlert("FaceID/TouchID enabled successfully!", "Success");
      return true;
    } catch (error) {
      if (error.name === "NotAllowedError") {
        await Utils.showModalAlert("Biometric setup was cancelled.", "Cancelled");
      } else {
        await Utils.showModalAlert(
          "Failed to enable biometric authentication. If a password manager (e.g. Bitwarden) intercepted the prompt, try again and choose “Save on this iPhone” / iCloud Keychain instead.",
          "Error"
        );
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

    // After an inactivity lock, require the same method used at the original sign-in.
    // First-time unlock (lastUnlockMethod === null) keeps the legacy
    // "biometric first, fall through to PIN" behavior.
    const requireBiometric = this.lastUnlockMethod === "biometric" && this.isWebAuthnEnabled();
    const tryBiometric = requireBiometric ||
      (this.lastUnlockMethod === null && this.isWebAuthnEnabled());

    if (tryBiometric) {
      try {
        const biometricResult = await this.authenticateWebAuthn();
        if (biometricResult) {
          // Biometric success - retrieve stored PIN
          const storedPin = await this.retrievePinForBiometrics();
          if (storedPin && await this.verifyPin(storedPin)) {
            this.currentPin = storedPin;
            this.lastUnlockMethod = "biometric";
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
        // Biometric failed or was cancelled
        console.log("Biometric auth failed:", error.name);
      }

      // If the user originally signed in with biometrics, do not fall through
      // to PIN entry — keep prompting biometrics.
      if (requireBiometric) {
        return this.promptUnlock();
      }
    }

    // PIN-based unlock path (also reached when biometric is unavailable on first
    // unlock or when biometric stored PIN was invalid).
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

    if (await this.verifyPin(result)) {
      this.currentPin = result;
      this.lastUnlockMethod = "pin";
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
        // Re-write every value in the clear BEFORE dropping the PIN hash. The
        // other order is a one-way data loss: clearPin() removes the hash, and
        // if the rewrite then fails (storage over quota) the disk still holds
        // ciphertext that nothing can decrypt — no hash left to unlock it, and
        // no PIN in memory to decrypt with. Clearing currentPin first makes
        // saveData's encrypt() a pass-through, so this write IS the plaintext
        // copy; only once it lands do we drop the hash.
        const encryptedWith = this.currentPin;
        this.currentPin = "";
        if (store.saveData(false) === false) {
          this.currentPin = encryptedWith;
          await Utils.showModalAlert(
            "Couldn't rewrite your data without encryption, so the PIN was left in place. Free up space on this device and try again.",
            "Change PIN"
          );
          return;
        }
        this.clearPin();
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
    // Re-key the stored data with the new PIN BEFORE committing the new hash,
    // for the same reason as the disable path above: if the rewrite fails, the
    // disk still holds data encrypted with the old key AND the old hash that
    // unlocks it. Committing the hash first and then failing to rewrite leaves
    // a hash and a ciphertext that don't match — the correct PIN no longer
    // opens the data.
    const previousPin = this.currentPin;
    this.currentPin = newPin;
    if (store.saveData(false) === false) {
      this.currentPin = previousPin;
      await Utils.showModalAlert(
        "Couldn't re-save your data with the new PIN, so the PIN was not changed. Free up space on this device and try again.",
        "Change PIN"
      );
      return;
    }
    // Committing the hash is itself a storage write, and it can fail for the
    // same reason the re-key can. Failing here is the worse half of the pair:
    // the data is already encrypted with the NEW pin while the stored hash
    // still names the old one, so neither PIN opens it on the next load. Put
    // the data back under the old key before giving up.
    try {
      await this.setPin(newPin);
    } catch (error) {
      console.error("Could not store the new PIN:", error);
      this.currentPin = previousPin;
      store.saveData(false);
      await Utils.showModalAlert(
        "Couldn't store the new PIN, so it was not changed and your data was left encrypted with the old one.",
        "Change PIN"
      );
      return;
    }
    // Update stored biometric PIN if biometrics is enabled
    if (this.isWebAuthnEnabled()) {
      await this.storePinForBiometrics(newPin);
    }
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
    // Resolve any dialog pending on the shared #appModal via its cancel path
    // BEFORE hiding it. Hiding alone leaves the in-flight showModalDialog promise
    // unresolved and its button listeners attached; when promptUnlock reuses the
    // modal, a click would fire the stale handler too and resolve the abandoned
    // prompt (e.g. a change-PIN flow) with the PIN just typed to unlock.
    if (typeof Utils !== "undefined" && typeof Utils.cancelActiveModalDialog === "function") {
      Utils.cancelActiveModalDialog();
    }

    // The Recent/Allocated modals attach document-level Escape handlers that
    // their hide*() methods remove. We hide them directly below, so detach those
    // handlers here to avoid leaking them across a lock.
    if (window.app) {
      if (typeof window.app._removeRecentEscHandler === "function") {
        window.app._removeRecentEscHandler();
      }
      if (typeof window.app._removeAllocatedEscHandler === "function") {
        window.app._removeAllocatedEscHandler();
      }
      // The cloud-sync credentials dialog is built at runtime, so the sweep
      // below only HIDES it — leaving the promise a sync is awaiting pending
      // forever, with _isSyncing stuck true. Settle it explicitly.
      if (
        window.app.cloudSync &&
        typeof window.app.cloudSync.cancelCredentialsPrompt === "function"
      ) {
        window.app.cloudSync.cancelCredentialsPrompt();
      }
    }

    // The app menu is not a .modal, so the sweep below never reached it — it
    // stayed open (blurred) behind the lock overlay for the whole lock, and its
    // Escape handler then competed with the unlock dialog for the key.
    if (window.app && window.app.calendarUI &&
        typeof window.app.calendarUI.closeAppMenu === "function") {
      window.app.calendarUI.closeAppMenu();
    }

    // Close appModal if it's open
    const appModal = document.getElementById("appModal");
    if (appModal && appModal.style.display === "block") {
      appModal.style.display = "none";
      appModal.setAttribute("aria-hidden", "true");
      if (window.ModalManager) {
        window.ModalManager.closeModal(appModal);
      }
    }

    // Close the debt snowball view if it's open. Route through its own teardown
    // when we can: hiding the element directly leaves _viewHistoryActive set
    // and its pushed history entry orphaned, so every lock-while-open leaked
    // another entry and cost the user a wasted Back press. _hideViewDom is the
    // no-history half of hideView, which is what we want here — the panel is
    // being torn down, not navigated away from.
    const debtView = document.getElementById("debtSnowballView");
    if (debtView && debtView.style.display === "block") {
      const snowball = window.app && window.app.debtSnowball;
      if (snowball && typeof snowball._hideViewDom === "function") {
        snowball._hideViewDom();
      } else {
        debtView.style.display = "none";
        debtView.setAttribute("aria-hidden", "true");
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
