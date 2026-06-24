// Application entry point

class CashflowApp {

  constructor(pinProtection) {
    this.pinProtection = pinProtection;
    this.store = new TransactionStore(undefined, this.pinProtection);
    this.recurringManager = new RecurringTransactionManager(this.store);
    this.calculationService = new CalculationService(
      this.store,
      this.recurringManager
    );
    // Operation lock to prevent race conditions during cloud load/save
    this._operationLock = false;
    this._pendingUpdateUI = false;
    this._initialized = false;
    this.cloudSync = new CloudSync(this.store, () => this.updateUI());
    this.transactionUI = new TransactionUI(
      this.store,
      this.recurringManager,
      () => {
        this.updateUI();
      },
      this.cloudSync,
      this.calculationService
    );

    this.searchUI = new SearchUI(
      this.store,
      this.recurringManager,
      this.transactionUI
    );

    this.debtSnowball = new DebtSnowballUI(
      this.store,
      this.recurringManager,
      () => this.updateUI()
    );

    // Wire up transactionUI to debtSnowball for "Convert to Debt" feature
    this.transactionUI.setDebtSnowballUI(this.debtSnowball);

    this.calendarUI = new CalendarUI(
      this.store,
      this.recurringManager,
      this.calculationService,
      this.transactionUI,
      this.debtSnowball
    );

    // Store init promise for external awaiting
    this._initPromise = this.init();
  }

  // Static factory method for creating an initialized app
  static async create(pinProtection) {
    const app = new CashflowApp(pinProtection);
    await app._initPromise;
    return app;
  }


  async init() {
    try {
      Utils.cleanUpHtmlArtifacts();
      await this.safeCloudLoad();
    } catch (error) {
      console.error("Error loading from cloud:", error);
    }
    this._initialized = true;
    this.updateUI();
    window.addTransaction = () => this.transactionUI.addTransaction();

    // Start heartbeat polling for remote changes (1 minute interval)
    this.cloudSync.startHeartbeat(60000);

    // Set up callback to refresh from cloud after PIN unlock (session resume)
    this.pinProtection.onUnlockCallback = async () => {
      try {
        // safeCloudLoad() already handles cache invalidation internally
        await this.safeCloudLoad();
        this.updateUI();
        // Restart heartbeat after unlock
        this.cloudSync.startHeartbeat(60000);
      } catch (error) {
        console.error("Error refreshing from cloud after unlock:", error);
      }
    };

    // Set up callback to stop heartbeat when app locks
    this.pinProtection.onLockCallback = () => {
      this.cloudSync.stopHeartbeat();
    };
  }


  // Safe cloud load with operation locking to prevent race conditions
  // Uses heartbeat check to avoid unnecessary full loads when data hasn't changed
  async safeCloudLoad() {
    if (this._operationLock) {
      console.log("Operation in progress, skipping cloud load");
      return false;
    }
    this._operationLock = true;
    try {
      const { token, gistId } = await this.cloudSync.getCloudCredentialsAsync();
      if (!token || !gistId) {
        return true;
      }

      // Check if remote has changed before doing full load
      const hasChanges = await this.cloudSync.checkForRemoteChanges();

      if (hasChanges === false) {
        // No changes detected (304 response) - skip full load
        console.log("No remote changes detected, skipping full load");
        Utils.showNotification("Cloud data up to date");
        return true;
      }

      // hasChanges is true or null (can't determine) - do full load
      await this.cloudSync.loadFromCloud();
      this.recurringManager.invalidateCache();
      this.calculationService.invalidateCache();
      return true;
    } finally {
      this._operationLock = false;
      // If UI update was requested during lock, do it now
      if (this._pendingUpdateUI) {
        this._pendingUpdateUI = false;
        this.updateUI();
      }
    }
  }


  updateUI() {
    // If operation is locked (e.g., cloud loading), defer UI update
    if (this._operationLock) {
      this._pendingUpdateUI = true;
      return;
    }
    this.store.autoSettleExpiredRecurring();
    this.store.rollForwardAllocations();
    this.calendarUI.generateCalendar();
  }


  showRecentTransactions() {
    const modal = document.getElementById("recentTransactionsModal");
    const list = document.getElementById("recentTransactionsList");
    if (!modal || !list) return;

    const transactions = this.store.getTransactions();
    const items = [];
    Object.keys(transactions).forEach((date) => {
      transactions[date].forEach((t) => {
        if (t.hidden === true) return;
        // Only entries the user actually entered or modified — recurring
        // expansions without a stored timestamp are derived data.
        if (!t._lastModified) return;
        items.push({ date, transaction: t });
      });
    });

    items.sort((a, b) => {
      const ta = new Date(a.transaction._lastModified || 0).getTime();
      const tb = new Date(b.transaction._lastModified || 0).getTime();
      return tb - ta;
    });

    const recent = items.slice(0, 25);

    list.innerHTML = "";
    if (recent.length === 0) {
      const empty = document.createElement("p");
      empty.className = "recent-transactions-empty";
      empty.textContent = "No recent transactions.";
      list.appendChild(empty);
    } else {
      recent.forEach(({ date, transaction }) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "recent-transaction-row";
        row.setAttribute("role", "listitem");

        const sign = transaction.type === "balance" ? "=" :
          transaction.type === "income" ? "+" : "-";
        const amountText = `${sign}$${Number(transaction.amount).toFixed(2)}`;

        const meta = document.createElement("span");
        meta.className = "recent-transaction-meta";
        meta.textContent = Utils.formatDisplayDate(date);

        const amount = document.createElement("span");
        amount.className = `recent-transaction-amount ${transaction.type}`;
        amount.textContent = amountText;

        const desc = document.createElement("span");
        desc.className = "recent-transaction-desc";
        const descText = typeof transaction.description === "string" ? transaction.description : "";
        const recurringTag = transaction.recurringId ? " (Recurring)" : "";
        const unsettledTag = transaction.type === "expense" && transaction.settled === false ? " (Unsettled)" : "";
        desc.textContent = `${descText || "(no description)"}${recurringTag}${unsettledTag}`;

        row.appendChild(meta);
        row.appendChild(amount);
        row.appendChild(desc);

        row.addEventListener("click", () => {
          this.openDayFromRecent(date);
        });

        list.appendChild(row);
      });
    }

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);

    if (!this._recentCloseBound) {
      const closeBtn = document.getElementById("recentTransactionsClose");
      if (closeBtn) {
        const close = () => this.hideRecentTransactions();
        closeBtn.addEventListener("click", close);
        closeBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            close();
          }
        });
      }
      this._recentCloseBound = true;
    }

    if (!this._recentEscHandler) {
      this._recentEscHandler = (e) => {
        if (e.key === "Escape") {
          this.hideRecentTransactions();
        }
      };
      document.addEventListener("keydown", this._recentEscHandler);
    }
  }


  hideRecentTransactions() {
    const modal = document.getElementById("recentTransactionsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);

    if (this._recentEscHandler) {
      document.removeEventListener("keydown", this._recentEscHandler);
      this._recentEscHandler = null;
    }
  }


  showAllocatedTransactions() {
    const modal = document.getElementById("allocatedTransactionsModal");
    const list = document.getElementById("allocatedTransactionsList");
    if (!modal || !list) return;

    const transactions = this.store.getTransactions();
    const items = [];
    Object.keys(transactions).forEach((date) => {
      transactions[date].forEach((t) => {
        if (t.hidden === true) return;
        if (t.allocated !== true) return;
        // Only entries the user actually entered or modified — recurring
        // expansions without a stored timestamp are derived data.
        if (!t._lastModified) return;
        items.push({ date, transaction: t });
      });
    });

    // Soonest to farthest by the transaction's own date.
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    list.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "recent-transactions-empty";
      empty.textContent = "No allocated transactions.";
      list.appendChild(empty);
    } else {
      items.forEach(({ date, transaction }) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "recent-transaction-row";
        row.setAttribute("role", "listitem");

        const amountText = `-$${Number(transaction.amount).toFixed(2)}`;

        const meta = document.createElement("span");
        meta.className = "recent-transaction-meta";
        meta.textContent = Utils.formatDisplayDate(date);

        const amount = document.createElement("span");
        amount.className = `recent-transaction-amount ${transaction.type}`;
        amount.textContent = amountText;

        const desc = document.createElement("span");
        desc.className = "recent-transaction-desc";
        const descText = typeof transaction.description === "string" ? transaction.description : "";
        const recurringTag = transaction.recurringId ? " (Recurring)" : "";
        desc.textContent = `${descText || "(no description)"}${recurringTag}`;

        row.appendChild(meta);
        row.appendChild(amount);
        row.appendChild(desc);

        row.addEventListener("click", () => {
          this.hideAllocatedTransactions();
          this.openDayFromRecent(date);
        });

        list.appendChild(row);
      });
    }

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);

    if (!this._allocatedCloseBound) {
      const closeBtn = document.getElementById("allocatedTransactionsClose");
      if (closeBtn) {
        const close = () => this.hideAllocatedTransactions();
        closeBtn.addEventListener("click", close);
        closeBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            close();
          }
        });
      }
      this._allocatedCloseBound = true;
    }

    if (!this._allocatedEscHandler) {
      this._allocatedEscHandler = (e) => {
        if (e.key === "Escape") {
          this.hideAllocatedTransactions();
        }
      };
      document.addEventListener("keydown", this._allocatedEscHandler);
    }
  }


  hideAllocatedTransactions() {
    const modal = document.getElementById("allocatedTransactionsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);

    if (this._allocatedEscHandler) {
      document.removeEventListener("keydown", this._allocatedEscHandler);
      this._allocatedEscHandler = null;
    }
  }


  openDayFromRecent(dateString) {
    this.hideRecentTransactions();
    const [year, month] = dateString.split("-").map(Number);
    const targetMonth = new Date(year, month - 1, 1);
    const current = this.calendarUI.currentDate;
    if (
      targetMonth.getFullYear() !== current.getFullYear() ||
      targetMonth.getMonth() !== current.getMonth()
    ) {
      this.calendarUI.currentDate = targetMonth;
      this.calendarUI.generateCalendar();
    }
    this.transactionUI.showTransactionDetails(dateString);
  }


  exportData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      const data = this.store.exportData();

      const now = new Date();
      const day = String(now.getDate()).padStart(2, "0");
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const year = String(now.getFullYear());
      const hours = String(now.getHours()).padStart(2, "0");
      const minutes = String(now.getMinutes()).padStart(2, "0");

      const filename = `cashflow_data_${day}-${month}-${year}_${hours}${minutes}.json`;

      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      Utils.showNotification("Data exported successfully!");
    } catch (error) {
      console.error("Error exporting data:", error);
      Utils.showNotification("Failed to export data: " + error.message, "error");
    }
  }


  importData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";

      input.onchange = (e) => {
        if (!e.target.files || e.target.files.length === 0) {
          Utils.showNotification("No file selected", "error");
          return;
        }

        const file = e.target.files[0];
        const reader = new FileReader();

        reader.onload = (readerEvent) => {
          try {
            if (!readerEvent.target.result) {
              throw new Error("Could not read file");
            }

            const content = JSON.parse(readerEvent.target.result);

            const success = this.store.importData(content);

            if (success) {
              // Close any open modals to prevent stale DOM state
              document.querySelectorAll('.modal[style*="display: block"], .modal[style*="display:block"]').forEach(m => {
                if (document.activeElement && m.contains(document.activeElement)) {
                  document.activeElement.blur();
                }
                m.style.display = 'none';
                m.setAttribute('aria-hidden', 'true');
                if (window.ModalManager) {
                  window.ModalManager.closeModal(m);
                }
              });
              this.recurringManager.invalidateCache();
              this.calculationService.invalidateCache();
              this.updateUI();

              Utils.showNotification("Data imported successfully!");
            } else {
              throw new Error("Invalid file format");
            }
          } catch (error) {
            console.error("Error parsing imported data:", error);
            Utils.showNotification(
              "Error importing data: " + error.message,
              "error"
            );
          }
        };

        reader.onerror = () => {
          Utils.showNotification("Failed to read file", "error");
        };

        reader.readAsText(file);
      };

      input.click();
    } catch (error) {
      console.error("Error in import process:", error);
      Utils.showNotification("Error importing data: " + error.message, "error");
    }
  }


  async resetData() {
    try {
      this.cloudSync.cancelPendingCloudSave();

      const shouldReset = await Utils.showModalConfirm(
        "Are you sure you want to reset all data? This will also clear your cloud sync credentials.",
        "Reset Data",
        { confirmText: "Reset", cancelText: "Cancel" }
      );

      if (!shouldReset) {
        return;
      }

      this.store.resetData();
      this.cloudSync.clearCloudCredentials();
      this.recurringManager.invalidateCache();
      this.calculationService.invalidateCache();
      this.updateUI();

      Utils.showNotification("All data has been reset.");
    } catch (error) {
      console.error("Error resetting data:", error);
      Utils.showNotification("Failed to reset data: " + error.message, "error");
    }
  }
}
document.addEventListener("DOMContentLoaded", async () => {
  window.pinProtection = new PinProtection();
  const unlocked = await window.pinProtection.promptUnlock();
  if (unlocked) {
    window.app = await CashflowApp.create(pinProtection);
  }
});

// Ensure any pending data is saved before closing/refreshing
window.addEventListener("beforeunload", () => {
  if (window.app && window.app.store) {
    window.app.store.flushPendingSave();
  }
});
