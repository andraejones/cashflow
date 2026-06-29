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
    // Guards against overlapping resume syncs when several foreground events
    // (visibilitychange, pageshow, online) fire for a single wake.
    this._resumeSyncing = false;
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

    this.bankReconcile = new BankReconcileUI(
      this.store,
      this.recurringManager,
      () => this.updateUI(),
      (date) => this.openDayFromReconcile(date)
    );

    this.debtSnowball = new DebtSnowballUI(
      this.store,
      this.recurringManager,
      () => this.updateUI(),
      this.calculationService
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
      // On startup, push first if this device has local changes that never
      // reached the cloud (e.g. it was backgrounded/discarded before the
      // debounced save fired); otherwise pull. A fresh reload fires no resume
      // event, so the push has to happen here.
      await this._syncPendingOrLoad();
    } catch (error) {
      console.error("Error loading from cloud:", error);
    }
    this._initialized = true;
    this.updateUI();
    window.addTransaction = () => this.transactionUI.addTransaction();

    // Start heartbeat polling for remote changes (1 minute interval)
    this.cloudSync.startHeartbeat(60000);

    // Set up callback to refresh from cloud after PIN unlock (session resume).
    // Unlock is an explicit user action, so it keeps the normal (non-quiet) UI.
    this.pinProtection.onUnlockCallback = async () => {
      try {
        await this._syncPendingOrLoad();
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


  // Push local changes that never reached the cloud, otherwise pull. Shared by
  // startup, PIN-unlock, and foreground-resume so they can't drift apart.
  // `quiet` suppresses the routine sync UI for background-triggered syncs.
  async _syncPendingOrLoad(quiet = false) {
    this.cloudSync.store.flushPendingSave();
    const { token, gistId } = await this.cloudSync.getCloudCredentialsAsync();
    if (token && gistId && this.cloudSync.hasPendingCloudSave()) {
      // saveToCloud() merges remote changes in before pushing, so this is safe
      // even if the other device also edited while we were away.
      await this.cloudSync.saveToCloud(quiet);
      this.recurringManager.invalidateCache();
      this.calculationService.invalidateCache();
      return true;
    }
    return this.safeCloudLoad(quiet);
  }

  // Re-sync when the app returns to the foreground (tab visible again, bfcache
  // restore, or connectivity returns). Runs quietly so routine resumes don't
  // flash a spinner — only merges/errors surface UI.
  async syncOnResume() {
    if (this._resumeSyncing) return;
    // While locked the store may be empty/encrypted; the unlock flow owns sync.
    if (this.pinProtection && this.pinProtection.isLocked) return;
    if (!this.cloudSync.autoSyncEnabled) return;
    // Definitely offline — the "online" event will re-run this once we reconnect.
    if (navigator.onLine === false) return;
    this._resumeSyncing = true;
    try {
      await this._syncPendingOrLoad(true);
      this.updateUI();
    } catch (error) {
      console.error("Resume sync failed:", error);
    } finally {
      this._resumeSyncing = false;
    }
  }

  // Safe cloud load with operation locking to prevent race conditions
  // Uses heartbeat check to avoid unnecessary full loads when data hasn't changed
  async safeCloudLoad(quiet = false) {
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
        if (!quiet) Utils.showNotification("Cloud data up to date");
        return true;
      }

      // hasChanges is true or null (can't determine) - do full load
      await this.cloudSync.loadFromCloud(quiet);
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
    // Forfeiting a closed-out allocation removes a materialized recurring
    // instance; the expansion cache (keyed only on recurring definitions) would
    // otherwise replay the now-stale month and resurrect the bucket, so drop it.
    const closedOut = this.store.closeOutExpiredAllocations();
    this.store.rollForwardAllocations();
    if (closedOut) {
      this.recurringManager.invalidateCache();
    }
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
        if (e.key !== "Escape") return;
        // Recent and Allocated modals can be open at once. Only the topmost
        // modal handles Escape, so an unconditional close wouldn't dismiss a
        // modal stacked beneath it. Capture phase + topModal() guard mirrors
        // BankReconcile's handler.
        if (ModalManager.topModal() !== modal) return;
        this.hideRecentTransactions();
      };
      document.addEventListener("keydown", this._recentEscHandler, true);
    }
  }


  _removeRecentEscHandler() {
    if (this._recentEscHandler) {
      document.removeEventListener("keydown", this._recentEscHandler, true);
      this._recentEscHandler = null;
    }
  }


  hideRecentTransactions() {
    const modal = document.getElementById("recentTransactionsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    this._removeRecentEscHandler();
  }


  showAllocatedTransactions() {
    const modal = document.getElementById("allocatedTransactionsModal");
    const list = document.getElementById("allocatedTransactionsList");
    if (!modal || !list) return;

    // Materialize a forward horizon so each recurring allocation's next upcoming
    // instance exists to be listed, even for series whose next period falls in a
    // month the calendar hasn't rendered yet (e.g. annual buckets months out).
    const now = new Date();
    const HORIZON_MONTHS = 12;
    for (let i = 0; i <= HORIZON_MONTHS; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      this.recurringManager.applyRecurringTransactions(d.getFullYear(), d.getMonth());
    }
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    // Last day of the 30-day window that drives the calendar's "Minimum" figure
    // (today + 30 days, matching CalculationService.calculateMinimum).
    const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 30);
    const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;

    const transactions = this.store.getTransactions();
    const items = [];
    // Recurring series already represented by an upcoming entered/modified
    // instance — don't also append a derived "next" row for them.
    const upcomingRecurringIds = new Set();
    // Soonest upcoming derived (un-modified) instance per recurring series.
    const nextRecurring = new Map();

    // Rolling (non-auto-close recurring) allocations stay live across their
    // whole period, so their active bucket is the latest instance dated
    // on/before today — usually a past date the "next upcoming" logic below
    // would miss. Surface exactly that live bucket per series.
    const liveRollingDate = new Map();
    Object.keys(transactions).forEach((date) => {
      if (date > todayStr) return;
      transactions[date].forEach((t) => {
        if (t.hidden === true || t.allocated !== true) return;
        if (t.autoCloseout === true || !t.recurringId) return;
        const cur = liveRollingDate.get(t.recurringId);
        if (!cur || date > cur) liveRollingDate.set(t.recurringId, date);
      });
    });
    const shownRolling = new Set();

    Object.keys(transactions).forEach((date) => {
      transactions[date].forEach((t) => {
        if (t.hidden === true) return;
        if (t.allocated !== true) return;

        // Rolling allocation with a live bucket: show only that bucket (the
        // latest instance on/before today), whether or not it's been drawn.
        const liveDate =
          t.recurringId && t.autoCloseout !== true
            ? liveRollingDate.get(t.recurringId)
            : undefined;
        if (liveDate) {
          if (date === liveDate && !shownRolling.has(t.recurringId)) {
            items.push({ date, transaction: t });
            shownRolling.add(t.recurringId);
          }
          return;
        }

        if (t._lastModified) {
          // Entries the user actually entered or modified.
          items.push({ date, transaction: t });
          if (t.recurringId && date >= todayStr) {
            upcomingRecurringIds.add(t.recurringId);
          }
          return;
        }
        // Derived recurring expansion (no stored timestamp): hold only the very
        // next upcoming instance of each series as a candidate.
        if (!t.recurringId || date < todayStr) return;
        const existing = nextRecurring.get(t.recurringId);
        if (!existing || date < existing.date) {
          nextRecurring.set(t.recurringId, { date, transaction: t });
        }
      });
    });

    // Append each recurring series' next upcoming bucket unless an upcoming
    // entered/modified instance of that series is already shown.
    nextRecurring.forEach((entry, recurringId) => {
      if (upcomingRecurringIds.has(recurringId)) return;
      items.push(entry);
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
      let dividerPlaced = false;
      let inWindowCount = 0;
      items.forEach(({ date, transaction }) => {
        // Drop a separator between items inside the 30-day window and those
        // beyond it. Only once, and only when both sides are non-empty.
        if (!dividerPlaced && date > cutoffStr && inWindowCount > 0) {
          const divider = document.createElement("div");
          divider.className = "allocated-window-divider";
          divider.setAttribute("role", "separator");
          list.appendChild(divider);
          dividerPlaced = true;
        }
        if (date <= cutoffStr) inWindowCount++;

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
        if (e.key !== "Escape") return;
        // Only the topmost modal handles Escape (see hideRecentTransactions).
        if (ModalManager.topModal() !== modal) return;
        this.hideAllocatedTransactions();
      };
      document.addEventListener("keydown", this._allocatedEscHandler, true);
    }
  }


  _removeAllocatedEscHandler() {
    if (this._allocatedEscHandler) {
      document.removeEventListener("keydown", this._allocatedEscHandler, true);
      this._allocatedEscHandler = null;
    }
  }


  hideAllocatedTransactions() {
    const modal = document.getElementById("allocatedTransactionsModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    this._removeAllocatedEscHandler();
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

  // Open a day's transaction modal from the Bank Reconcile report. Unlike
  // openDayFromRecent, the reconcile modal stays open underneath (the day modal
  // stacks on top) so the user can edit a day and return to the report.
  openDayFromReconcile(dateString) {
    if (!dateString) return;
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
      // Export is read-only — it must not cancel a queued cloud push, or a
      // pending change is needlessly delayed until the next sync trigger.
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
              // The generic sweep hid modals directly, bypassing
              // hideRecentTransactions / hideAllocatedTransactions, which would
              // leak their document-level Escape handlers. Detach them.
              this._removeRecentEscHandler();
              this._removeAllocatedEscHandler();
              this.recurringManager.invalidateCache();
              this.calculationService.invalidateCache();
              this.updateUI();

              // An import is a restore, not an incremental edit. Push it
              // authoritatively so it replaces the cloud copy instead of being
              // merged into it (a merge lets newer remote items win and leaves
              // the restore partial, or resurrects items deleted after the
              // backup). Dropping the known ETag makes saveToCloud skip its
              // GET-merge and PATCH local data straight up.
              if (this.cloudSync && this.cloudSync.autoSyncEnabled) {
                this.cloudSync.cancelPendingCloudSave();
                this.cloudSync._lastKnownETag = null;
                this.cloudSync
                  .saveToCloud()
                  .catch((err) => console.error("Post-import cloud push failed:", err));
                Utils.showNotification(
                  "Data imported — replacing your cloud copy with the import."
                );
              } else {
                Utils.showNotification("Data imported successfully!");
              }
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

// --- Background / foreground sync lifecycle -------------------------------
// Mobile browsers freeze or discard backgrounded tabs, so the 10s debounced
// cloud save can be lost if the device sleeps before it fires. These handlers
// push the moment the page is backgrounded (the last reliable callback on
// mobile) and re-sync on resume as a safety net for anything that didn't land.

function flushAppOnHide() {
  if (!window.app || !window.app._initialized || !window.app.store) return;
  // Always persist to localStorage first so nothing is lost locally.
  window.app.store.flushPendingSave();
  if (navigator.onLine === false) return; // Can't push offline; resume/online will retry.
  const cloudSync = window.app.cloudSync;
  if (cloudSync && cloudSync.autoSyncEnabled && cloudSync.hasPendingCloudSave()) {
    // Best-effort immediate push. It may be cut short on a hard unload, but the
    // resume handler (and next startup) guarantees the change lands eventually.
    cloudSync.saveToCloud(true).catch((err) =>
      console.error("Hide-time cloud save failed:", err)
    );
  }
}

function resumeAppSync() {
  if (window.app && window.app._initialized && typeof window.app.syncOnResume === "function") {
    window.app.syncOnResume();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    flushAppOnHide();
  } else {
    resumeAppSync();
  }
});

// pagehide fires on real unload/discard; pageshow with persisted is a bfcache
// restore (a resume), not a fresh load.
window.addEventListener("pagehide", flushAppOnHide);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) resumeAppSync();
});

// Woke with no connectivity, then it returned — flush anything still pending.
window.addEventListener("online", resumeAppSync);

// Ensure any pending data is saved before closing/refreshing
window.addEventListener("beforeunload", () => {
  if (window.app && window.app.store) {
    window.app.store.flushPendingSave();
  }
});
