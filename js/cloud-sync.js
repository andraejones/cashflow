// Cloud sync

class CloudSync {

  constructor(store, onUpdate) {
    this.store = store;
    this.onUpdate = onUpdate;
    this.saveTimeout = null;
    this.autoSyncEnabled = true;
    this._lastKnownETag = null;
    this._lastSyncTime = null;
    this._heartbeatInterval = null;
    this._updateAvailable = false;
    this._lastSaveTime = null;
    this._isSyncing = false;

    if (typeof this.store.registerSaveCallback === 'function') {
      this.store.registerSaveCallback((isDataModified) => {
        if (this.autoSyncEnabled && isDataModified) {
          this.scheduleCloudSave();
        }
      });
    }
    try {
      const savedSetting = localStorage.getItem('auto_sync_enabled');
      if (savedSetting !== null) {
        this.autoSyncEnabled = savedSetting === 'true';
      }
      // Load stored ETag and sync time
      this._lastKnownETag = localStorage.getItem('gist_etag');
      const syncTime = localStorage.getItem('local_last_sync');
      this._lastSyncTime = syncTime ? new Date(syncTime) : null;
    } catch (e) {
      console.warn('Could not load auto-sync setting', e);
    }
  }

  // Store ETag after successful fetch/save
  _storeETag(etag) {
    this._lastKnownETag = etag;
    if (etag) {
      try {
        localStorage.setItem('gist_etag', etag);
      } catch (e) {
        console.warn('Could not save ETag', e);
      }
    }
  }

  // Store last sync time
  _storeSyncTime() {
    this._lastSyncTime = new Date();
    try {
      localStorage.setItem('local_last_sync', this._lastSyncTime.toISOString());
    } catch (e) {
      console.warn('Could not save sync time', e);
    }
  }

  // Clear sync metadata (used when credentials are cleared)
  _clearSyncMetadata() {
    this._lastKnownETag = null;
    this._lastSyncTime = null;
    try {
      localStorage.removeItem('gist_etag');
      localStorage.removeItem('local_last_sync');
    } catch (e) {
      console.warn('Could not clear sync metadata', e);
    }
  }


  toggleAutoSync() {
    this.autoSyncEnabled = !this.autoSyncEnabled;
    try {
      localStorage.setItem('auto_sync_enabled', this.autoSyncEnabled.toString());
    } catch (e) {
      console.warn('Could not save auto-sync setting', e);
    }

    if (!this.autoSyncEnabled) {
      this.cancelPendingCloudSave();
    }

    return this.autoSyncEnabled;
  }


  isAutoSyncEnabled() {
    return this.autoSyncEnabled;
  }

  isSyncInProgress() {
    return this._isSyncing;
  }


  // Encryption constants
  _SALT_LENGTH = 16;
  _IV_LENGTH = 12;
  _PBKDF2_ITERATIONS = 100000;

  // Generate a device-specific key for token encryption
  async _getDeviceKey() {
    // Use a stable device identifier from localStorage, or create one
    let deviceId = localStorage.getItem('_device_id');
    if (!deviceId) {
      deviceId = crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
      localStorage.setItem('_device_id', deviceId);
    }
    return deviceId;
  }

  // AES-GCM encryption for tokens
  async encryptValueAsync(value) {
    const deviceKey = await this._getDeviceKey();
    const encoder = new TextEncoder();

    const salt = crypto.getRandomValues(new Uint8Array(this._SALT_LENGTH));
    const iv = crypto.getRandomValues(new Uint8Array(this._IV_LENGTH));

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(deviceKey),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: this._PBKDF2_ITERATIONS,
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
      encoder.encode(value)
    );

    // Combine: "aes:" + base64(salt + iv + ciphertext)
    const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
    combined.set(salt, 0);
    combined.set(iv, salt.length);
    combined.set(new Uint8Array(encrypted), salt.length + iv.length);

    return "aes:" + btoa(String.fromCharCode(...combined));
  }

  // AES-GCM decryption for tokens
  async decryptValueAsync(encryptedValue) {
    // Check for legacy format (no "aes:" prefix)
    if (!encryptedValue.startsWith("aes:")) {
      // Legacy format - decode and migrate
      try {
        const legacyValue = atob(encryptedValue).split("").reverse().join("");
        return legacyValue;
      } catch {
        return null;
      }
    }

    try {
      const deviceKey = await this._getDeviceKey();
      const combined = Uint8Array.from(atob(encryptedValue.slice(4)), c => c.charCodeAt(0));

      const salt = combined.slice(0, this._SALT_LENGTH);
      const iv = combined.slice(this._SALT_LENGTH, this._SALT_LENGTH + this._IV_LENGTH);
      const ciphertext = combined.slice(this._SALT_LENGTH + this._IV_LENGTH);

      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(deviceKey),
        'PBKDF2',
        false,
        ['deriveKey']
      );

      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this._PBKDF2_ITERATIONS,
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
    } catch (error) {
      console.error("Token decryption error:", error);
      return null;
    }
  }

  // Synchronous legacy methods for backward compatibility
  encryptValue(value) {
    // For synchronous calls, use legacy method but will be migrated on next async save
    try {
      return btoa(value.split("").reverse().join(""));
    } catch (e) {
      // Handle non-ASCII characters
      const utf8Bytes = new TextEncoder().encode(value);
      const binary = String.fromCharCode(...utf8Bytes);
      return btoa(binary.split("").reverse().join(""));
    }
  }

  decryptValue(encryptedValue) {
    // Handle both legacy and new formats
    if (encryptedValue.startsWith("aes:")) {
      // Can't decrypt async format synchronously - caller should use async method
      console.warn("Attempting to decrypt AES format synchronously - use decryptValueAsync");
      return null;
    }
    try {
      return atob(encryptedValue).split("").reverse().join("");
    } catch (error) {
      console.error("Decryption error:", error);
      return null;
    }
  }


  getCloudCredentials() {
    const encryptedToken = localStorage.getItem("github_token_encrypted");
    // For synchronous access, handle both legacy and mark for async migration
    let token = null;
    if (encryptedToken) {
      if (encryptedToken.startsWith("aes:")) {
        // New format - need async decryption, return null for sync call
        // Callers needing the token should use getCloudCredentialsAsync
        token = null;
      } else {
        // Legacy format - decrypt synchronously
        token = this.decryptValue(encryptedToken);
      }
    }
    const gistId = localStorage.getItem("gist_id");
    return { token, gistId };
  }

  async getCloudCredentialsAsync() {
    const encryptedToken = localStorage.getItem("github_token_encrypted");
    let token = null;
    if (encryptedToken) {
      token = await this.decryptValueAsync(encryptedToken);
      // If we decrypted legacy format, re-encrypt with new format
      if (token && !encryptedToken.startsWith("aes:")) {
        const newEncrypted = await this.encryptValueAsync(token);
        localStorage.setItem("github_token_encrypted", newEncrypted);
        console.log("Migrated GitHub token to secure encryption");
      }
    }
    const gistId = localStorage.getItem("gist_id");
    return { token, gistId };
  }

  setCloudCredentials(token, gistId) {
    if (token) {
      // Use legacy sync method for compatibility, will be migrated on next async access
      const encryptedToken = this.encryptValue(token);
      localStorage.setItem("github_token_encrypted", encryptedToken);
    }
    localStorage.setItem("gist_id", gistId);
  }

  async setCloudCredentialsAsync(token, gistId) {
    if (token) {
      const encryptedToken = await this.encryptValueAsync(token);
      localStorage.setItem("github_token_encrypted", encryptedToken);
    }
    localStorage.setItem("gist_id", gistId);
  }


  clearCloudCredentials() {
    localStorage.removeItem("github_token_encrypted");
    localStorage.removeItem("github_token");
    localStorage.removeItem("gist_id");
    this._clearSyncMetadata();
  }


  async promptForCredentials() {
    const credentials = this.getCloudCredentials();
    if (credentials.token && credentials.gistId) {
      return credentials;
    }
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "block";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-labelledby", "cloud-sync-title");
    modal.setAttribute("aria-modal", "true");
    const modalContent = document.createElement("div");
    modalContent.className = "modal-content";
    modalContent.style.maxWidth = "400px";
    modal.appendChild(modalContent);

    const closeBtn = document.createElement("span");
    closeBtn.className = "close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    modalContent.appendChild(closeBtn);

    const title = document.createElement("h3");
    title.id = "cloud-sync-title";
    title.textContent = "Cloud Sync Setup";
    modalContent.appendChild(title);

    const introText = document.createElement("p");
    introText.textContent = "Please enter your GitHub credentials:";
    modalContent.appendChild(introText);
    const tokenDiv = document.createElement("div");
    tokenDiv.style.margin = "15px 0";

    const tokenLabel = document.createElement("label");
    tokenLabel.setAttribute("for", "github-token");
    tokenLabel.textContent = "GitHub Token:";
    tokenDiv.appendChild(tokenLabel);

    tokenDiv.appendChild(document.createElement("br"));

    const tokenInput = document.createElement("input");
    tokenInput.id = "github-token";
    tokenInput.type = "password";
    tokenInput.style.width = "100%";
    tokenInput.style.padding = "8px";
    tokenInput.style.margin = "5px 0";
    tokenInput.placeholder = "ghp_...";
    tokenDiv.appendChild(tokenInput);

    const tokenHelp = document.createElement("div");
    tokenHelp.style.fontSize = "12px";
    tokenHelp.style.color = "#666";
    tokenHelp.innerHTML = "Token needs <strong>gist</strong> scope permissions";
    tokenDiv.appendChild(tokenHelp);

    modalContent.appendChild(tokenDiv);
    const gistDiv = document.createElement("div");
    gistDiv.style.margin = "15px 0";

    const gistLabel = document.createElement("label");
    gistLabel.setAttribute("for", "gist-id");
    gistLabel.textContent = "Gist ID:";
    gistDiv.appendChild(gistLabel);

    gistDiv.appendChild(document.createElement("br"));

    const gistInput = document.createElement("input");
    gistInput.id = "gist-id";
    gistInput.type = "text";
    gistInput.style.width = "100%";
    gistInput.style.padding = "8px";
    gistInput.style.margin = "5px 0";
    gistInput.placeholder = "Enter Gist ID or leave empty to create new";
    gistDiv.appendChild(gistInput);

    const gistHelp = document.createElement("div");
    gistHelp.style.fontSize = "12px";
    gistHelp.style.color = "#666";
    gistHelp.innerHTML = "Leave empty to create a new Gist (first time setup)";
    gistDiv.appendChild(gistHelp);

    modalContent.appendChild(gistDiv);
    const autoSyncDiv = document.createElement("div");
    autoSyncDiv.style.margin = "15px 0";

    const autoSyncCheck = document.createElement("input");
    autoSyncCheck.type = "checkbox";
    autoSyncCheck.id = "auto-sync-check";
    autoSyncCheck.checked = this.autoSyncEnabled;

    const autoSyncLabel = document.createElement("label");
    autoSyncLabel.setAttribute("for", "auto-sync-check");
    autoSyncLabel.textContent = "Enable automatic cloud sync";
    autoSyncLabel.style.marginLeft = "8px";

    autoSyncDiv.appendChild(autoSyncCheck);
    autoSyncDiv.appendChild(autoSyncLabel);

    const autoSyncHelp = document.createElement("div");
    autoSyncHelp.style.fontSize = "12px";
    autoSyncHelp.style.color = "#666";
    autoSyncHelp.style.marginLeft = "24px";
    autoSyncHelp.textContent = "Automatically save changes to the cloud after 10 seconds of inactivity";
    autoSyncDiv.appendChild(autoSyncHelp);

    modalContent.appendChild(autoSyncDiv);
    const saveBtn = document.createElement("button");
    saveBtn.id = "save-credentials";
    saveBtn.style.padding = "8px 16px";
    saveBtn.style.backgroundColor = "#3498db";
    saveBtn.style.color = "white";
    saveBtn.style.border = "none";
    saveBtn.style.borderRadius = "4px";
    saveBtn.style.cursor = "pointer";
    saveBtn.textContent = "Save Credentials";
    modalContent.appendChild(saveBtn);
    const noteText = document.createElement("p");
    noteText.style.fontSize = "12px";
    noteText.style.color = "#666";
    noteText.style.marginTop = "10px";
    noteText.textContent =
      "Note: Credentials are stored locally in your browser and can be cleared using the Reset option.";
    modalContent.appendChild(noteText);
    document.body.appendChild(modal);

    return new Promise((resolve, reject) => {
      closeBtn.onclick = () => {
        document.body.removeChild(modal);
        reject(new Error("Credentials entry cancelled"));
      };

      saveBtn.onclick = async () => {
        const token = tokenInput.value.trim();
        const gistId = gistInput.value.trim();
        this.autoSyncEnabled = autoSyncCheck.checked;
        try {
          localStorage.setItem('auto_sync_enabled', this.autoSyncEnabled.toString());
        } catch (e) {
          console.warn('Could not save auto-sync setting', e);
        }

        if (!token) {
          await Utils.showModalAlert(
            "Please enter a GitHub token",
            "Missing Token"
          );
          return;
        }

        document.body.removeChild(modal);
        resolve({ token, gistId });
      };
      setTimeout(() => {
        tokenInput.focus();
      }, 100);
    });
  }


  async scheduleCloudSave() {
    if (!this.autoSyncEnabled) {
      return;
    }
    // Prevent scheduling new saves during an active sync
    if (this._isSyncing) {
      return;
    }
    const { token, gistId } = await this.getCloudCredentialsAsync();
    if (!token || !gistId) {
      return;
    }

    clearTimeout(this.saveTimeout);
    this.showPendingMessage();

    this.saveTimeout = setTimeout(() => {
      this.saveToCloud()
        .catch(err => console.error("Cloud save failed:", err))
        .finally(() => {
          this.clearPendingMessage();
        });
    }, 10000);
  }


  cancelPendingCloudSave() {
    clearTimeout(this.saveTimeout);
    this.clearPendingMessage();
  }


  showPendingMessage() {
    const currentMonth = document.getElementById("currentMonth");
    let pendingSpan = document.getElementById("pendingMessage");

    if (!pendingSpan) {
      pendingSpan = document.createElement("span");
      pendingSpan.id = "pendingMessage";
      pendingSpan.style.marginLeft = "10px";
      pendingSpan.style.fontSize = "0.8em";
      pendingSpan.style.color = "#666";
      currentMonth.appendChild(pendingSpan);
    }

    pendingSpan.textContent = "⌛";
    pendingSpan.title = "Cloud sync pending";
  }


  clearPendingMessage() {
    const pendingSpan = document.getElementById("pendingMessage");
    if (pendingSpan) {
      pendingSpan.remove();
    }
  }


  async createNewGist(token, data) {
    try {
      const response = await fetch("https://api.github.com/gists", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Cashflow App Data",
          public: false,
          files: {
            "cashflow_data.json": {
              content: JSON.stringify(data, null, 2),
            },
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error("Invalid GitHub token or missing gist permissions");
        }
        throw new Error(`Failed to create Gist: HTTP ${response.status}`);
      }

      const result = await response.json();
      return result.id;
    } catch (error) {
      console.error("Error creating new Gist:", error);
      throw error;
    }
  }

  // =============================================
  // MERGE FUNCTIONS FOR CONFLICT RESOLUTION
  // =============================================

  // Merge arrays of items by ID, keeping newer version on conflict
  _mergeById(localItems, remoteItems, deletedIds = []) {
    const merged = new Map();
    const deletedSet = new Set(deletedIds);

    // Add remote items first
    remoteItems.forEach(item => {
      if (item.id && !deletedSet.has(item.id)) {
        merged.set(item.id, item);
      }
    });

    // Add/update with local items (newer wins)
    localItems.forEach(item => {
      if (!item.id) return;
      if (deletedSet.has(item.id)) return;

      const existing = merged.get(item.id);
      if (!existing) {
        merged.set(item.id, item);
      } else {
        // Compare timestamps - keep newer
        const localTime = new Date(item._lastModified || 0).getTime();
        const remoteTime = new Date(existing._lastModified || 0).getTime();
        if (localTime >= remoteTime) {
          merged.set(item.id, item);
        }
      }
    });

    return Array.from(merged.values());
  }

  // Merge transactions (organized by date, each with arrays of transactions)
  _mergeTransactions(localTxns, remoteTxns, deletedIds = []) {
    const merged = {};
    const deletedSet = new Set(deletedIds);
    const allDates = new Set([
      ...Object.keys(localTxns || {}),
      ...Object.keys(remoteTxns || {})
    ]);

    allDates.forEach(date => {
      const localList = localTxns[date] || [];
      const remoteList = remoteTxns[date] || [];
      const mergedList = this._mergeById(localList, remoteList, deletedIds);

      if (mergedList.length > 0) {
        merged[date] = mergedList;
      }
    });

    return merged;
  }

  // Merge skipped transactions (date -> array of recurring IDs)
  _mergeSkippedTransactions(local, remote) {
    const merged = {};
    const allDates = new Set([
      ...Object.keys(local || {}),
      ...Object.keys(remote || {})
    ]);

    allDates.forEach(date => {
      const localSkips = local[date] || [];
      const remoteSkips = remote[date] || [];
      // Union of skipped IDs
      const mergedSkips = [...new Set([...localSkips, ...remoteSkips])];
      if (mergedSkips.length > 0) {
        merged[date] = mergedSkips;
      }
    });

    return merged;
  }

  // Merge moved transactions (key -> move info)
  _mergeMovedTransactions(local, remote) {
    const merged = { ...remote };

    Object.keys(local || {}).forEach(key => {
      const localMove = local[key];
      const remoteMove = remote[key];

      if (!remoteMove) {
        merged[key] = localMove;
      } else {
        // Keep the more recent move
        const localTime = new Date(localMove.movedAt || 0).getTime();
        const remoteTime = new Date(remoteMove.movedAt || 0).getTime();
        if (localTime >= remoteTime) {
          merged[key] = localMove;
        }
      }
    });

    return merged;
  }

  // Merge monthly notes with conflict markers when both edited
  _mergeMonthlyNotes(local, remote) {
    const merged = {};
    const allMonths = new Set([
      ...Object.keys(local || {}),
      ...Object.keys(remote || {})
    ]);

    allMonths.forEach(monthKey => {
      const localNote = local[monthKey];
      const remoteNote = remote[monthKey];

      // Extract text (handle both old string format and new object format)
      const getTextAndTime = (note) => {
        if (!note) return { text: '', time: 0 };
        if (typeof note === 'string') return { text: note, time: 0 };
        return {
          text: note.text || '',
          time: new Date(note._lastModified || 0).getTime()
        };
      };

      const localData = getTextAndTime(localNote);
      const remoteData = getTextAndTime(remoteNote);

      if (!localData.text && !remoteData.text) return;

      if (!remoteData.text) {
        merged[monthKey] = localNote;
      } else if (!localData.text) {
        merged[monthKey] = remoteNote;
      } else if (localData.text === remoteData.text) {
        // Same content, keep whichever has timestamp
        merged[monthKey] = localData.time >= remoteData.time ? localNote : remoteNote;
      } else {
        // Both have different content - concatenate with conflict marker
        const conflictText = `${remoteData.text}\n\n--- SYNC CONFLICT (${new Date().toLocaleString()}) ---\n\n${localData.text}`;
        merged[monthKey] = {
          text: conflictText,
          _lastModified: new Date().toISOString()
        };
      }
    });

    return merged;
  }

  // Merge debt snowball settings (keep more recently synced)
  _mergeDebtSnowballSettings(local, remote, localSyncTime, remoteSyncTime) {
    const localTime = localSyncTime ? new Date(localSyncTime).getTime() : 0;
    const remoteTime = remoteSyncTime ? new Date(remoteSyncTime).getTime() : 0;
    return localTime >= remoteTime ? local : remote;
  }

  // Main merge function - combines local and remote data
  _mergeData(localData, remoteData) {
    // Get deleted items lists
    const localDeleted = localData._deletedItems || {};
    const remoteDeleted = remoteData._deletedItems || {};

    // Extract plain IDs from deleted item objects ({ id, deletedAt } or plain strings)
    const extractIds = (items) => (items || []).map(d => typeof d === 'string' ? d : d.id).filter(Boolean);
    const deletedTransactionIds = [...new Set([...extractIds(localDeleted.transactions), ...extractIds(remoteDeleted.transactions)])];
    const deletedRecurringIds = [...new Set([...extractIds(localDeleted.recurringTransactions), ...extractIds(remoteDeleted.recurringTransactions)])];
    const deletedDebtIds = [...new Set([...extractIds(localDeleted.debts), ...extractIds(remoteDeleted.debts)])];
    const deletedCashInfusionIds = [...new Set([...extractIds(localDeleted.cashInfusions), ...extractIds(remoteDeleted.cashInfusions)])];

    // Deduplicate full deleted item objects (preserving deletedAt for pruning)
    const dedupeDeletedItems = (items) => {
      const seen = new Set();
      return (items || []).filter(d => {
        const id = typeof d === 'string' ? d : d.id;
        if (!id || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
    };
    const deletedItems = {
      transactions: dedupeDeletedItems([...(localDeleted.transactions || []), ...(remoteDeleted.transactions || [])]),
      recurringTransactions: dedupeDeletedItems([...(localDeleted.recurringTransactions || []), ...(remoteDeleted.recurringTransactions || [])]),
      debts: dedupeDeletedItems([...(localDeleted.debts || []), ...(remoteDeleted.debts || [])]),
      cashInfusions: dedupeDeletedItems([...(localDeleted.cashInfusions || []), ...(remoteDeleted.cashInfusions || [])])
    };

    const merged = {
      transactions: this._mergeTransactions(
        localData.transactions,
        remoteData.transactions,
        deletedTransactionIds
      ),
      recurringTransactions: this._mergeById(
        localData.recurringTransactions || [],
        remoteData.recurringTransactions || [],
        deletedRecurringIds
      ),
      skippedTransactions: this._mergeSkippedTransactions(
        localData.skippedTransactions,
        remoteData.skippedTransactions
      ),
      movedTransactions: this._mergeMovedTransactions(
        localData.movedTransactions,
        remoteData.movedTransactions
      ),
      debts: this._mergeById(
        localData.debts || [],
        remoteData.debts || [],
        deletedDebtIds
      ),
      cashInfusions: this._mergeById(
        localData.cashInfusions || [],
        remoteData.cashInfusions || [],
        deletedCashInfusionIds
      ),
      monthlyNotes: this._mergeMonthlyNotes(
        localData.monthlyNotes,
        remoteData.monthlyNotes
      ),
      debtSnowballSettings: this._mergeDebtSnowballSettings(
        localData.debtSnowballSettings || { extraPayment: 0, autoGenerate: false },
        remoteData.debtSnowballSettings || { extraPayment: 0, autoGenerate: false },
        localData.lastUpdated,
        remoteData.lastUpdated
      ),
      // monthlyBalances are derived data - will be recalculated
      monthlyBalances: {},
      // Track deletions for future merges (full objects for deletedAt pruning)
      _deletedItems: deletedItems,
      lastUpdated: new Date().toISOString(),
      appVersion: "2.0.0"
    };

    return merged;
  }

  // Fetch remote Gist with optional ETag check
  async _fetchGist(token, gistId, etag = null) {
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github.v3+json",
    };

    if (etag) {
      headers["If-None-Match"] = etag;
    }

    const response = await fetch(`https://api.github.com/gists/${gistId}`, {
      headers
    });

    return {
      response,
      etag: response.headers.get("ETag"),
      notModified: response.status === 304
    };
  }

  // Lightweight check if remote Gist has changed (returns true/false/null)
  async checkForRemoteChanges() {
    if (this._isSyncing) {
      return false;
    }
    // Skip heartbeat check if we just saved (grace period of 90 seconds)
    // This avoids false positives from GitHub ETag inconsistencies between PATCH and GET
    const SAVE_GRACE_PERIOD = 90000;
    if (this._lastSaveTime && (Date.now() - this._lastSaveTime) <= SAVE_GRACE_PERIOD) {
      return false; // Assume no changes since we just saved
    }

    const { token, gistId } = await this.getCloudCredentialsAsync();
    if (!token || !gistId) {
      return null; // Can't check - no credentials
    }

    try {
      // If no ETag yet (first check before any sync), fetch without If-None-Match
      // This will return 200 OK if the gist exists, allowing us to detect remote data
      const { response, etag, notModified } = await this._fetchGist(
        token, gistId, this._lastKnownETag
      );

      if (notModified) {
        return false; // 304 - unchanged (~200 bytes transferred)
      }
      if (response.ok) {
        // If we had no ETag before, store it now for future checks
        if (!this._lastKnownETag && etag) {
          this._storeETag(etag);
        }
        // Changed (or first check with existing remote data)
        return true;
      }
      if (response.status === 404) {
        // Gist was deleted
        console.warn('Gist not found during heartbeat check');
        return null;
      }
      return null; // Error state
    } catch (error) {
      console.warn('Heartbeat check failed:', error);
      return null;
    }
  }

  // Start periodic heartbeat to check for remote changes
  async startHeartbeat(intervalMs = 60000) {
    this.stopHeartbeat();
    const { token, gistId } = await this.getCloudCredentialsAsync();
    if (!token || !gistId) {
      return; // No credentials, don't start heartbeat
    }

    this._heartbeatInterval = setInterval(async () => {
      const hasChanges = await this.checkForRemoteChanges();
      if (hasChanges === true) {
        this._showUpdateAvailable();
      }
    }, intervalMs);
  }

  // Stop the heartbeat polling
  stopHeartbeat() {
    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval);
      this._heartbeatInterval = null;
    }
  }

  // Show visual indicator that remote updates are available
  _showUpdateAvailable() {
    if (this._updateAvailable) return; // Already showing
    this._updateAvailable = true;

    const syncIndicator = document.querySelector('.cloud-sync-indicator');
    if (syncIndicator) {
      syncIndicator.className = 'cloud-sync-indicator update-available';
      syncIndicator.title = 'Remote changes available - click Cloud Sync to update';
    }

    Utils.showNotification('Remote changes detected. Use Cloud Sync to update.', 'info');
  }

  // Clear the update available indicator
  _clearUpdateAvailable() {
    this._updateAvailable = false;
    const syncIndicator = document.querySelector('.cloud-sync-indicator');
    if (syncIndicator && syncIndicator.classList.contains('update-available')) {
      syncIndicator.className = 'cloud-sync-indicator synced';
      syncIndicator.title = '';
    }
  }

  async saveToCloud() {
    if (this._isSyncing) {
      console.log("Sync already in progress, skipping saveToCloud");
      Utils.showNotification("Sync already in progress...", "info");
      return;
    }
    this._isSyncing = true;

    const syncIndicator = document.querySelector(".cloud-sync-indicator");
    if (syncIndicator) syncIndicator.className = "cloud-sync-indicator syncing";
    Utils.showLoading("Saving to cloud...");

    try {
      let { token, gistId } = await this.getCloudCredentialsAsync();

      if (!token || !gistId) {
        try {
          // Hide loading while prompting for credentials
          Utils.hideLoading();
          const credentials = await this.promptForCredentials();
          Utils.showLoading("Saving to cloud...");
          token = credentials.token;
          gistId = credentials.gistId;
          if (!gistId) {
            const data = {
              ...this.store.exportData(),
              lastUpdated: new Date().toISOString(),
            };

            Utils.showNotification("Creating new Gist...");
            gistId = await this.createNewGist(token, data);
            Utils.showNotification(`New Gist created with ID: ${gistId}`);
            await this.setCloudCredentialsAsync(token, gistId);
            this._storeSyncTime();
            // Record save time for grace period (avoids false "remote changes" detection)
            this._lastSaveTime = Date.now();

            if (syncIndicator)
              syncIndicator.className = "cloud-sync-indicator synced";
            return;
          }

          await this.setCloudCredentialsAsync(token, gistId);
        } catch (error) {
          if (syncIndicator)
            syncIndicator.className = "cloud-sync-indicator error";
          Utils.showNotification(
            "Cloud sync cancelled. Data remains saved locally.",
            "error"
          );
          return;
        }
      }

      // Step 1: Check if remote has changed using ETag
      // Flush any pending debounced saves to ensure we export the latest data
      this.store.flushPendingSave();

      let dataToSave = {
        ...this.store.exportData(),
        lastUpdated: new Date().toISOString(),
        autoSyncEnabled: this.autoSyncEnabled,
      };

      if (this._lastKnownETag) {
        // Fetch with If-None-Match header to check for changes
        const { response: checkResponse, etag: newETag, notModified } =
          await this._fetchGist(token, gistId, this._lastKnownETag);

        if (!notModified && checkResponse.ok) {
          // Remote has changed - need to merge
          Utils.showLoading("Merging changes...");
          const gist = await checkResponse.json();

          if (gist.files && gist.files["cashflow_data.json"]) {
            try {
              const remoteData = JSON.parse(gist.files["cashflow_data.json"].content);
              const localData = dataToSave;

              // Create shadow copy of local data before merge for recovery
              try {
                localStorage.setItem('_backup_before_merge', JSON.stringify(localData));
              } catch (backupError) {
                console.warn("Could not create backup before merge:", backupError);
                // Abort merge if we can't create backup - data safety first
                throw new Error("Cannot create backup before merge. Aborting to prevent data loss.");
              }

              // Merge local and remote data
              const mergedData = this._mergeData(localData, remoteData);
              mergedData.autoSyncEnabled = this.autoSyncEnabled;

              // Cancel any pending debounced saves before import to prevent race condition
              this.store.cancelPendingSave();

              // Import merged data into local store (silently, without triggering another save)
              this.store.importData(mergedData);

              // Update dataToSave with merged result
              dataToSave = {
                ...mergedData,
                lastUpdated: new Date().toISOString(),
                autoSyncEnabled: this.autoSyncEnabled,
              };

              console.log("Merged local and remote data due to conflict");

              // Refresh UI with merged data
              if (this.onUpdate) {
                this.onUpdate();
              }
            } catch (parseError) {
              console.warn("Could not parse remote data for merge, proceeding with local data");
            }
          }
        } else if (!notModified && !checkResponse.ok) {
          // Handle non-304, non-2xx responses during ETag check
          if (checkResponse.status === 401) {
            this.clearCloudCredentials();
            throw new Error("Invalid GitHub token or missing gist permissions");
          }
          if (checkResponse.status === 404) {
            // Gist was deleted, will be handled below
            this._lastKnownETag = null;
          }
        }
        // If 304 (notModified), no merge needed, proceed with local data
      }

      // Step 2: Save the data (original or merged)
      Utils.showLoading("Saving to cloud...");
      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          description: "Cashflow App Data",
          files: {
            "cashflow_data.json": {
              content: JSON.stringify(dataToSave, null, 2),
            },
          },
        }),
      });

      if (!response.ok) {
        if (response.status === 401) {
          this.clearCloudCredentials();
          throw new Error("Invalid GitHub token or missing gist permissions");
        }
        if (response.status === 404) {
          const createNew = await Utils.showModalConfirm(
            "Gist not found. Would you like to create a new one?",
            "Gist Not Found",
            { confirmText: "Create New", cancelText: "Cancel" }
          );
          if (createNew) {
            Utils.showNotification("Creating new Gist...");
            const newGistId = await this.createNewGist(token, dataToSave);
            Utils.showNotification(`New Gist created with ID: ${newGistId}`);
            this.setCloudCredentials(token, newGistId);
            this._storeSyncTime();
            if (syncIndicator)
              syncIndicator.className = "cloud-sync-indicator synced";
            return;
          } else {
            this.clearCloudCredentials();
            throw new Error("Invalid Gist ID. Please provide a valid Gist ID or create a new one.");
          }
        }
        if (response.status === 403) {
          const responseText = await response.text();
          if (responseText.includes("rate limit")) {
            throw new Error(
              "GitHub API rate limit exceeded. Please try again later."
            );
          } else {
            throw new Error(
              "Access forbidden. Check that your token has 'gist' scope."
            );
          }
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Step 3: Store the new ETag and sync time
      const newETag = response.headers.get("ETag");
      this._storeETag(newETag);
      this._storeSyncTime();
      // Record save time for grace period (avoids false "remote changes" detection)
      this._lastSaveTime = Date.now();

      if (syncIndicator)
        syncIndicator.className = "cloud-sync-indicator synced";
      Utils.showNotification("Data saved to cloud successfully!");
    } catch (error) {
      console.error("Error saving to cloud:", error);
      if (syncIndicator) syncIndicator.className = "cloud-sync-indicator error";
      Utils.showNotification(
        error.message || "Failed to save to cloud. Data saved locally only.",
        "error"
      );
    } finally {
      this._isSyncing = false;
      Utils.hideLoading();
    }
  }


  async loadFromCloud() {
    if (this._isSyncing) {
      console.log("Sync already in progress, skipping loadFromCloud");
      Utils.showNotification("Sync already in progress...", "info");
      return;
    }
    this._isSyncing = true;

    const syncIndicator = document.querySelector(".cloud-sync-indicator");
    if (syncIndicator) syncIndicator.className = "cloud-sync-indicator syncing";
    Utils.showLoading("Loading from cloud...");

    try {
      let { token, gistId } = await this.getCloudCredentialsAsync();

      if (!token || !gistId) {
        try {
          // Hide loading while prompting for credentials
          Utils.hideLoading();
          const credentials = await this.promptForCredentials();
          Utils.showLoading("Loading from cloud...");
          token = credentials.token;
          gistId = credentials.gistId;

          if (!gistId) {
            throw new Error("A Gist ID is required to load data from the cloud");
          }

          await this.setCloudCredentialsAsync(token, gistId);
        } catch (error) {
          if (syncIndicator)
            syncIndicator.className = "cloud-sync-indicator error";
          Utils.showNotification(
            error.message || "Cloud sync cancelled. Using local data.",
            "error"
          );
          return;
        }
      }

      // Fetch the Gist
      const { response, etag } = await this._fetchGist(token, gistId);

      if (!response.ok) {
        if (response.status === 401) {
          this.clearCloudCredentials();
          throw new Error("Invalid GitHub token or missing gist permissions");
        }
        if (response.status === 404) {
          this.clearCloudCredentials();
          throw new Error("Gist not found. Please check your Gist ID.");
        }
        if (response.status === 403) {
          const responseText = await response.text();
          if (responseText.includes("rate limit")) {
            throw new Error(
              "GitHub API rate limit exceeded. Please try again later."
            );
          } else {
            throw new Error(
              "Access forbidden. Check that your token has 'gist' scope."
            );
          }
        }
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const gist = await response.json();

      if (!gist.files || !gist.files["cashflow_data.json"]) {
        throw new Error("Gist does not contain valid Cashflow data");
      }

      const content = gist.files["cashflow_data.json"].content;

      try {
        const remoteData = JSON.parse(content);

        // Flush any pending debounced saves to ensure we have the latest local data
        this.store.flushPendingSave();

        // Check if local has changes since last sync
        const localData = this.store.exportData();
        const hasLocalChanges = this._hasLocalChangesSinceSync(localData);

        let dataToImport = remoteData;
        let needsResync = false;

        if (hasLocalChanges) {
          // Create shadow copy of local data before merge for recovery
          try {
            localStorage.setItem('_backup_before_merge', JSON.stringify(localData));
          } catch (backupError) {
            console.warn("Could not create backup before merge:", backupError);
            // Abort merge if we can't create backup - data safety first
            throw new Error("Cannot create backup before merge. Aborting to prevent data loss.");
          }

          // Merge local and remote data
          Utils.showLoading("Merging changes...");
          const mergedData = this._mergeData(localData, remoteData);

          // Only resync if merge actually produced different data than remote
          const mergedJson = JSON.stringify(mergedData.transactions) +
            JSON.stringify(mergedData.recurringTransactions);
          const remoteJson = JSON.stringify(remoteData.transactions) +
            JSON.stringify(remoteData.recurringTransactions);

          if (mergedJson !== remoteJson) {
            dataToImport = mergedData;
            needsResync = true;
            console.log("Merged local changes with remote data during load");
          } else {
            console.log("Local changes already present in remote, no resync needed");
          }
        }

        const success = this.store.importData(dataToImport);

        if (!success) {
          throw new Error("Invalid data format in cloud storage");
        }

        // Cancel any pending debounced saves AFTER successful import
        // to prevent race condition where stale local data overwrites the imported/merged data
        this.store.cancelPendingSave();

        if (remoteData.autoSyncEnabled !== undefined) {
          this.autoSyncEnabled = remoteData.autoSyncEnabled;
          localStorage.setItem('auto_sync_enabled', this.autoSyncEnabled.toString());
        }

        // Store the ETag for future conflict detection
        this._storeETag(etag);
        this._storeSyncTime();
        // Record sync time for grace period (avoids false "remote changes" detection)
        this._lastSaveTime = Date.now();

        // If we merged local changes, save back to cloud
        if (needsResync && this.autoSyncEnabled) {
          // Schedule a save to push merged data back
          setTimeout(() => {
            this.saveToCloud();
          }, 500);
        }

        if (syncIndicator)
          syncIndicator.className = "cloud-sync-indicator synced";
        // Clear any update-available indicator since we just loaded
        this._clearUpdateAvailable();
        Utils.showNotification(
          hasLocalChanges
            ? "Data merged with cloud successfully!"
            : "Data loaded from cloud successfully!"
        );

        this.onUpdate();
      } catch (parseError) {
        throw new Error(
          "Failed to parse data from cloud: " + parseError.message
        );
      }
    } catch (error) {
      console.error("Error loading from cloud:", error);
      if (syncIndicator) syncIndicator.className = "cloud-sync-indicator error";
      Utils.showNotification(
        error.message || "Failed to load from cloud. Using local data.",
        "error"
      );
    } finally {
      this._isSyncing = false;
      Utils.hideLoading();
    }
  }

  // Check if local data has changes since last sync
  _hasLocalChangesSinceSync(localData) {
    if (!this._lastSyncTime) {
      // Never synced before, assume no local changes need merging
      return false;
    }

    const lastSyncTime = this._lastSyncTime.getTime();

    // Check transactions for modifications after last sync
    const checkTimestamp = (item) => {
      if (item._lastModified) {
        return new Date(item._lastModified).getTime() > lastSyncTime;
      }
      return false;
    };

    // Check regular transactions
    for (const date of Object.keys(localData.transactions || {})) {
      for (const txn of localData.transactions[date]) {
        if (checkTimestamp(txn)) return true;
      }
    }

    // Check recurring transactions
    for (const rt of localData.recurringTransactions || []) {
      if (checkTimestamp(rt)) return true;
    }

    // Check debts
    for (const debt of localData.debts || []) {
      if (checkTimestamp(debt)) return true;
    }

    // Check cash infusions
    for (const infusion of localData.cashInfusions || []) {
      if (checkTimestamp(infusion)) return true;
    }

    // Check monthly notes
    for (const monthKey of Object.keys(localData.monthlyNotes || {})) {
      const note = localData.monthlyNotes[monthKey];
      if (note && typeof note === 'object' && note._lastModified) {
        if (new Date(note._lastModified).getTime() > lastSyncTime) return true;
      }
    }

    return false;
  }
}
