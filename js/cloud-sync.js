/**
 * CloudSync - Manages cloud synchronization
 */
class CloudSync {
  /**
   * Create a new CloudSync
   * @param {TransactionStore} store - The transaction store
   * @param {Function} onUpdate - Callback function when data is synchronized
   */
  constructor(store, onUpdate) {
    this.store = store;
    this.onUpdate = onUpdate;
    this.saveTimeout = null;
    this.autoSyncEnabled = true;
    
    // Register callback with store to be notified when data changes
    if (typeof this.store.registerSaveCallback === 'function') {
      this.store.registerSaveCallback((isDataModified) => {
        // Only schedule cloud save when data is actually modified
        // and not just during UI refresh or month navigation
        if (this.autoSyncEnabled && isDataModified) {
          this.scheduleCloudSave();
        }
      });
    }
    
    // Try to load auto-sync setting from localStorage
    try {
      const savedSetting = localStorage.getItem('auto_sync_enabled');
      if (savedSetting !== null) {
        this.autoSyncEnabled = savedSetting === 'true';
      }
    } catch (e) {
      console.warn('Could not load auto-sync setting', e);
    }
  }

  /**
   * Toggle auto-sync setting
   * @returns {boolean} New auto-sync state
   */
  toggleAutoSync() {
    this.autoSyncEnabled = !this.autoSyncEnabled;
    
    // Save setting to localStorage
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

  /**
   * Check if auto-sync is enabled
   * @returns {boolean} Auto-sync enabled state
   */
  isAutoSyncEnabled() {
    return this.autoSyncEnabled;
  }

  /**
   * Encrypt a value for secure storage
   * @param {string} value - Value to encrypt
   * @returns {string} Encrypted value
   */
  encryptValue(value) {
    // Simple encryption for demonstration - in production, use a proper encryption library
    // This reverses the string and encodes it with base64
    return btoa(value.split("").reverse().join(""));
  }

  /**
   * Decrypt a stored value
   * @param {string} encryptedValue - Encrypted value to decrypt
   * @returns {string} Decrypted value
   */
  decryptValue(encryptedValue) {
    try {
      // Simple decryption for demonstration
      return atob(encryptedValue).split("").reverse().join("");
    } catch (error) {
      console.error("Decryption error:", error);
      return null;
    }
  }

  /**
   * Get cloud credentials
   * @returns {Object} Token and Gist ID
   */
  getCloudCredentials() {
    const encryptedToken = localStorage.getItem("github_token_encrypted");
    const token = encryptedToken ? this.decryptValue(encryptedToken) : null;
    const gistId = localStorage.getItem("gist_id");
    return { token, gistId };
  }

  /**
   * Set cloud credentials
   * @param {string} token - GitHub token
   * @param {string} gistId - Gist ID
   */
  setCloudCredentials(token, gistId) {
    if (token) {
      const encryptedToken = this.encryptValue(token);
      localStorage.setItem("github_token_encrypted", encryptedToken);
    }
    localStorage.setItem("gist_id", gistId);
  }

  /**
   * Clear cloud credentials
   */
  clearCloudCredentials() {
    localStorage.removeItem("github_token_encrypted");
    localStorage.removeItem("github_token"); // Remove legacy unencrypted token
    localStorage.removeItem("gist_id");
  }

  /**
   * Prompt for cloud credentials
   * @returns {Promise<Object>} Promise resolving to token and gistId
   */
  async promptForCredentials() {
    // Check if credentials already exist
    const credentials = this.getCloudCredentials();
    if (credentials.token && credentials.gistId) {
      return credentials;
    }

    // Create modal element properly
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.style.display = "block";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-labelledby", "cloud-sync-title");
    modal.setAttribute("aria-modal", "true");

    // Create modal content as DOM elements rather than HTML string
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

    // Token Input
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

    // Gist ID Input
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

    // Auto-sync checkbox
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

    // Save button
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

    // Note text
    const noteText = document.createElement("p");
    noteText.style.fontSize = "12px";
    noteText.style.color = "#666";
    noteText.style.marginTop = "10px";
    noteText.textContent =
      "Note: Credentials are stored locally in your browser and can be cleared using the Reset option.";
    modalContent.appendChild(noteText);

    // Append the modal to the body
    document.body.appendChild(modal);

    return new Promise((resolve, reject) => {
      closeBtn.onclick = () => {
        document.body.removeChild(modal);
        reject(new Error("Credentials entry cancelled"));
      };

      saveBtn.onclick = () => {
        const token = tokenInput.value.trim();
        const gistId = gistInput.value.trim();
        this.autoSyncEnabled = autoSyncCheck.checked;
        
        // Save auto-sync setting
        try {
          localStorage.setItem('auto_sync_enabled', this.autoSyncEnabled.toString());
        } catch (e) {
          console.warn('Could not save auto-sync setting', e);
        }

        if (!token) {
          alert("Please enter a GitHub token");
          return;
        }

        document.body.removeChild(modal);
        resolve({ token, gistId });
      };

      // Focus on the first input field
      setTimeout(() => {
        tokenInput.focus();
      }, 100);
    });
  }

  /**
   * Schedule a cloud save with debounce
   */
  scheduleCloudSave() {
    // Check if auto-sync is enabled
    if (!this.autoSyncEnabled) {
      return;
    }
    
    // Check if we have cloud credentials
    const { token, gistId } = this.getCloudCredentials();
    if (!token || !gistId) {
      // No credentials, don't schedule a save
      return;
    }
    
    clearTimeout(this.saveTimeout);
    this.showPendingMessage();

    this.saveTimeout = setTimeout(() => {
      this.saveToCloud().finally(() => {
        this.clearPendingMessage();
      });
    }, 10000); // 10 second debounce
  }

  /**
   * Cancel pending cloud save
   */
  cancelPendingCloudSave() {
    clearTimeout(this.saveTimeout);
    this.clearPendingMessage();
  }

  /**
   * Show pending save message
   */
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

  /**
   * Clear pending save message
   */
  clearPendingMessage() {
    const pendingSpan = document.getElementById("pendingMessage");
    if (pendingSpan) {
      pendingSpan.remove();
    }
  }

  /**
   * Create a new Gist
   * @param {string} token - GitHub token
   * @param {Object} data - Data to save
   * @returns {Promise<string>} The new Gist ID
   */
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

  /**
   * Save data to the cloud (GitHub Gist)
   * @returns {Promise<void>}
   */
  async saveToCloud() {
    const syncIndicator = document.querySelector(".cloud-sync-indicator");
    if (syncIndicator) syncIndicator.className = "cloud-sync-indicator syncing";

    try {
      let { token, gistId } = this.getCloudCredentials();

      if (!token || !gistId) {
        try {
          const credentials = await this.promptForCredentials();
          token = credentials.token;
          gistId = credentials.gistId;
          
          // If no gistId provided, create a new Gist
          if (!gistId) {
            const data = {
              ...this.store.exportData(),
              lastUpdated: new Date().toISOString(),
            };
            
            Utils.showNotification("Creating new Gist...");
            gistId = await this.createNewGist(token, data);
            Utils.showNotification(`New Gist created with ID: ${gistId}`);
            
            // Save the credentials with the new Gist ID
            this.setCloudCredentials(token, gistId);
            
            if (syncIndicator)
              syncIndicator.className = "cloud-sync-indicator synced";
            return;
          }
          
          this.setCloudCredentials(token, gistId);
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

      const data = {
        ...this.store.exportData(),
        lastUpdated: new Date().toISOString(),
        autoSyncEnabled: this.autoSyncEnabled,
      };

      // Try to update the existing Gist
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
              content: JSON.stringify(data, null, 2),
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
          // Gist not found, prompt to create a new one
          const createNew = confirm("Gist not found. Would you like to create a new one?");
          if (createNew) {
            Utils.showNotification("Creating new Gist...");
            const newGistId = await this.createNewGist(token, data);
            Utils.showNotification(`New Gist created with ID: ${newGistId}`);
            this.setCloudCredentials(token, newGistId);
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
    }
  }

  /**
   * Load data from the cloud (GitHub Gist)
   * @returns {Promise<void>}
   */
  async loadFromCloud() {
    const syncIndicator = document.querySelector(".cloud-sync-indicator");
    if (syncIndicator) syncIndicator.className = "cloud-sync-indicator syncing";

    try {
      let { token, gistId } = this.getCloudCredentials();

      if (!token || !gistId) {
        try {
          const credentials = await this.promptForCredentials();
          token = credentials.token;
          gistId = credentials.gistId;
          
          if (!gistId) {
            throw new Error("A Gist ID is required to load data from the cloud");
          }
          
          this.setCloudCredentials(token, gistId);
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

      const response = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github.v3+json",
        },
      });

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
        const data = JSON.parse(content);
        const success = this.store.importData(data);

        if (!success) {
          throw new Error("Invalid data format in cloud storage");
        }
        
        // Load auto-sync setting if available
        if (data.autoSyncEnabled !== undefined) {
          this.autoSyncEnabled = data.autoSyncEnabled;
          localStorage.setItem('auto_sync_enabled', this.autoSyncEnabled.toString());
        }

        if (syncIndicator)
          syncIndicator.className = "cloud-sync-indicator synced";
        Utils.showNotification("Data loaded from cloud successfully!");

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
    }
  }
}
