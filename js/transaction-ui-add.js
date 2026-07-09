// TransactionUI — the add-transaction flow (form parsing, recurrence
// assembly, allocation/draw wiring, what-if handoff). Prototype companion of
// TransactionUI (class declared in transaction-ui.js); no build step — loaded
// as a plain script after the class file and before app.js (see index.html).

Object.assign(TransactionUI.prototype, {

  addTransaction() {
    try {
      const dateElement = document.getElementById("transactionDate");
      const amountElement = document.getElementById("transactionAmount");
      const typeElement = document.getElementById("transactionType");
      const descriptionElement = document.getElementById("transactionDescription");
      const recurrenceElement = document.getElementById("transactionRecurrence");

      if (!dateElement || !amountElement || !typeElement || !descriptionElement || !recurrenceElement) {
        console.error("One or more form elements not found");
        Utils.showNotification("Error: Form elements not found", "error");
        return false;
      }

      const date = dateElement.value;
      const amount = parseFloat(amountElement.value);
      // "Allocation" is a form-level type only: it persists as an expense with
      // the allocated flag, so the stored data model (and every balance-walk
      // path reading it) is unchanged.
      const rawType = typeElement.value;
      const type = rawType === "allocation" ? "expense" : rawType;
      const allocated = rawType === "allocation";
      const description = descriptionElement.value;
      const recurrence = recurrenceElement.value;
      if (!date || isNaN(amount)) {
        Utils.showNotification(
          "Please enter a valid date and amount",
          "error"
        );
        return false;
      }
      // Balance transactions may be zero (e.g. account drained); income and
      // expense must be greater than zero.
      if (type !== "balance" && amount <= 0) {
        Utils.showNotification(
          "Income and expense amounts must be greater than 0",
          "error"
        );
        return false;
      }
      if (type === "balance") {
        const transactions = this.store.getTransactions();
        if (transactions[date]?.some((t) => t.type === "balance")) {
          Utils.showNotification(
            "Only one balance transaction is allowed per day. Please edit the existing balance transaction instead.",
            "error"
          );
          return false;
        }
        if (recurrence !== "once") {
          document.getElementById("transactionRecurrence").value = "once";
          Utils.showNotification(
            'Balance transactions cannot be recurring. Please select "One-time" for balance transactions.',
            "error"
          );
          return false;
        }
      }
      // The advanced-recurrence number fields are free-form inputs; reject
      // values the expansion engine can't honor before persisting them. An
      // interval below 1 makes applyCustomRecurrence skip the series entirely,
      // so the entry vanishes from the calendar on the next render while its
      // definition lingers invisibly; a non-numeric variable percentage
      // expands every occurrence — and the running balances — to NaN.
      if (recurrence === "custom") {
        const intervalEl = document.getElementById("customIntervalValue");
        if (intervalEl) {
          const intervalVal = parseInt(intervalEl.value, 10);
          if (!Number.isFinite(intervalVal) || intervalVal < 1) {
            Utils.showNotification(
              "Custom repeat interval must be a whole number of 1 or more",
              "error"
            );
            return false;
          }
        }
      }
      if (recurrence === "once") {
        const newTransaction = {
          amount: amount,
          type: type,
          description: description,
        };
        if (type === "expense") {
          newTransaction.allocated = allocated;
          // Allocated expenses always count as cleared (never carried unsettled).
          newTransaction.settled = allocated
            ? true
            : document.getElementById("transactionSettled").checked;
          if (allocated) {
            // A pinned, use-it-or-lose-it bucket. It stays drawable through
            // its close-out date (defaulting to its own date) and is
            // forfeited the day after.
            if (document.getElementById("transactionAutoCloseout").checked) {
              newTransaction.autoCloseout = true;
              const closeoutValue =
                document.getElementById("transactionCloseoutDate").value;
              if (closeoutValue && closeoutValue < date) {
                Utils.showNotification(
                  "Close-out date must be on or after the transaction date.",
                  "error"
                );
                return false;
              }
              newTransaction.closeoutDate = closeoutValue || date;
            }
          } else {
            // A non-allocated one-time expense may draw from an allocation; the
            // store debits the bucket and records drawAmount.
            const drawId = document.getElementById("transactionDrawAllocation").value;
            if (drawId) {
              newTransaction.drawsFromAllocationId = drawId;
            }
          }
        }
        // Note: the guard above rejects a second balance transaction for this
        // date, so there is never an existing one to replace here. Prior
        // unsettled expenses are intentionally NOT auto-settled when a balance
        // is entered — settled state is owned by the user; use the
        // carried-forward "Mark Settled" button to clear individual entries.
        this.store.addTransaction(date, newTransaction);
      }
      else if (type !== "balance") {
        const newRecurringTransaction = {
          id: Utils.generateUniqueId(),
          startDate: date,
          amount: amount,
          type: type,
          description: description,
          recurrence: recurrence,
        };
        if (type === "expense") {
          newRecurringTransaction.allocated = allocated;
          newRecurringTransaction.settled = allocated
            ? true
            : document.getElementById("transactionSettled").checked;
          // Two recurring-allocation flavors: with auto close-out, each period
          // drops a fresh pinned bucket that closes after its own date; without
          // it, each period's bucket rolls across its period and is forfeited
          // when the next instance arrives (see closeOutExpiredAllocations).
          if (allocated && document.getElementById("transactionAutoCloseout").checked) {
            newRecurringTransaction.autoCloseout = true;
          }
          // Opt in to history-based floor suggestions from day one: the
          // entered amount is the floor (see getAllocationFloorSuggestion).
          if (allocated && document.getElementById("transactionAutoAdjust").checked) {
            newRecurringTransaction.autoAdjustFloor = true;
            newRecurringTransaction.floorAmount = amount;
          }
          if (allocated && document.getElementById("transactionFreeFunds").checked) {
            newRecurringTransaction.freeFunds = true;
          }
        }
        this.addAdvancedRecurringOptions(newRecurringTransaction);

        const recurringId = this.store.addRecurringTransaction(
          newRecurringTransaction
        );
        // Only one series may hold the free-funds designation — clear it from
        // any previous holder now that this one carries the flag.
        if (newRecurringTransaction.freeFunds === true) {
          this.store.setFreeFundsAllocation(recurringId);
        }
        this.recurringManager.invalidateCache();
        const firstInstance = {
          amount: amount,
          type: type,
          description: description,
          recurringId: recurringId,
        };
        if (type === "expense") {
          firstInstance.settled = newRecurringTransaction.settled !== false;
          firstInstance.allocated = newRecurringTransaction.allocated === true;
          if (newRecurringTransaction.autoCloseout === true) {
            firstInstance.autoCloseout = true;
          }
        }

        this.store.addTransaction(date, firstInstance);
      }
      document.getElementById("transactionAmount").value = "";
      document.getElementById("transactionDescription").value = "";
      document.getElementById("transactionRecurrence").value = "once";
      document.getElementById("transactionSettled").checked = true;
      document.getElementById("transactionSettled").disabled = false;
      // After saving an allocation, drop the form back to a plain expense so
      // the next add doesn't silently create another allocation.
      if (rawType === "allocation") {
        typeElement.value = "expense";
      }
      document.getElementById("transactionAutoCloseout").checked = false;
      document.getElementById("autoCloseoutToggleLabel").style.display = "none";
      document.getElementById("transactionAutoAdjust").checked = false;
      document.getElementById("autoAdjustToggleLabel").style.display = "none";
      document.getElementById("transactionFreeFunds").checked = false;
      document.getElementById("freeFundsToggleLabel").style.display = "none";
      document.getElementById("transactionCloseoutDate").value = "";
      document.getElementById("closeoutDateField").style.display = "none";
      document.getElementById("settledToggleLabel").style.display = "";
      const drawSelect = document.getElementById("transactionDrawAllocation");
      drawSelect.value = "";
      drawSelect.style.display = "none";
      document.getElementById("toggleGroup").style.display = "none";
      const advancedOptions = document.getElementById("advancedRecurrenceOptions");
      if (advancedOptions) {
        advancedOptions.remove();
      }
      const transactionModal = document.getElementById("transactionModal");
      // Blur any focused element inside the modal before hiding to avoid aria-hidden warning
      const activeEl = document.activeElement;
      if (activeEl && transactionModal.contains(activeEl)) {
        activeEl.blur();
      }
      transactionModal.style.display = "none";
      transactionModal.setAttribute("aria-hidden", "true");
      ModalManager.closeModal(transactionModal);
      this._notifyChange();
      const typeText =
        type === "balance"
          ? "balance set"
          : type === "income"
            ? "income"
            : allocated
              ? "allocation"
              : "expense";
      Utils.showNotification(
        `Successfully added ${typeText} of $${amount.toFixed(2)}`
      );

      return true;
    } catch (error) {
      console.error("Error adding transaction:", error);
      Utils.showNotification("Error adding transaction: " + error.message, "error");
      return false;
    }
  },

});
