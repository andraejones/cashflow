// Transaction UI

class TransactionUI {

  constructor(store, recurringManager, onUpdate, cloudSync = null, calculationService = null) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onUpdate = onUpdate;
    this.cloudSync = cloudSync;
    this.calculationService = calculationService;
    this.debtSnowballUI = null; // Set via setDebtSnowballUI after construction

    // Track event listeners for cleanup
    this._boundEscapeHandler = null;

    this.initEventListeners();
  }

  setDebtSnowballUI(debtSnowballUI) {
    this.debtSnowballUI = debtSnowballUI;
  }


  initEventListeners() {
    document.querySelectorAll(".close").forEach((closeBtn) => {
      closeBtn.onclick = () => {
        this.closeModals();
      };
    });

    this._boundEscapeHandler = (event) => {
      if (event.key === "Escape") {
        this.closeModals();
      }
    };
    document.addEventListener("keydown", this._boundEscapeHandler);
    const transactionType = document.getElementById("transactionType");
    const recurrenceSelect = document.getElementById("transactionRecurrence");
    const transactionDescription = document.getElementById("transactionDescription");

    const descriptionField = document.getElementById("descriptionField");
    transactionType.addEventListener("change", () => {
      if (transactionType.value === "balance") {
        recurrenceSelect.value = "once";
        recurrenceSelect.style.display = "none";
        transactionDescription.value = "Ending Balance";
        if (descriptionField) descriptionField.style.display = "none";
        this.closeDescriptionSuggestions();
      } else {
        recurrenceSelect.style.display = "";
        if (descriptionField) descriptionField.style.display = "";
        // Only clear the auto-filled balance label — an expense↔income toggle
        // must not wipe a description the user already typed.
        if (transactionDescription.value === "Ending Balance") {
          transactionDescription.value = "";
        }
        transactionDescription.placeholder = "Description";
      }
      this.updateSettledToggleVisibility();
    });
    transactionDescription.addEventListener("input", () => {
      this.renderDescriptionSuggestions(transactionDescription.value);
    });
    transactionDescription.addEventListener("focus", () => {
      this.renderDescriptionSuggestions(transactionDescription.value);
    });
    transactionDescription.addEventListener("keydown", (event) => {
      this.handleDescriptionKeydown(event);
    });
    transactionDescription.addEventListener("blur", () => {
      // Delay so a click on a suggestion registers before the list closes.
      setTimeout(() => this.closeDescriptionSuggestions(), 120);
    });
    document.getElementById("transactionRecurrence").addEventListener("change", () => {
      this.updateRecurrenceOptions();
      this.updateSettledToggleVisibility();
      this.updateAutoAdjustVisibility();
      this.updateFreeFundsVisibility();
    });
    document.getElementById("transactionAutoCloseout").addEventListener("change", () => {
      this.syncAllocateState();
    });
    // The drawable recurring bucket depends on the transaction's date (the
    // soonest instance on/after it), so re-evaluate the dropdown when it
    // changes; the close-out date's floor/default track it too.
    document.getElementById("transactionDate").addEventListener("change", () => {
      this.updateDrawAllocationVisibility();
      this.updateCloseoutDateVisibility();
    });
    // Cents-first entry on the add form: with the numeric-keypad inputmode there
    // is no "." key, so the user types raw digits and each keystroke fills in from
    // the cents place ("1424" → "14.24"). Only the add form uses this; edit-form
    // amount fields stay standard number inputs.
    const transactionAmount = document.getElementById("transactionAmount");
    if (transactionAmount) {
      transactionAmount.addEventListener("input", () => {
        this.formatAmountAsCents(transactionAmount);
      });
    }
    this.setupFocusTrap("transactionModal");
    this.setupFocusTrap("searchModal");
  }

  // Reformat the add-form amount field as the user types, treating the raw
  // digits as a cents value ("1424" → "14.24"). The displayed value stays a
  // plain parseable number (no thousands separators) so addTransaction's
  // parseFloat keeps working. Clears to empty when no digits remain.
  formatAmountAsCents(el) {
    const digits = el.value.replace(/\D/g, "");
    if (!digits) {
      el.value = "";
      return;
    }
    el.value = (parseInt(digits, 10) / 100).toFixed(2);
    // Keep the caret at the end so each new digit keeps shifting into cents.
    const end = el.value.length;
    try {
      el.setSelectionRange(end, end);
    } catch (_) {
      // setSelectionRange can throw on some input types/browsers; ignore.
    }
  }

  setupFocusTrap(modalId) {
    const modal = document.getElementById(modalId);

    modal.addEventListener("keydown", (event) => {
      if (event.key === "Tab") {
        const focusableElements = modal.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

        const firstElement = focusableElements[0];
        const lastElement = focusableElements[focusableElements.length - 1];
        if (event.shiftKey && document.activeElement === firstElement) {
          event.preventDefault();
          lastElement.focus();
        }
        else if (!event.shiftKey && document.activeElement === lastElement) {
          event.preventDefault();
          firstElement.focus();
        }
      }
    });
  }


  closeModals() {
    const transactionModal = document.getElementById("transactionModal");
    const searchModal = document.getElementById("searchModal");

    const activeEl = document.activeElement;
    if (
      activeEl &&
      (transactionModal?.contains(activeEl) || searchModal?.contains(activeEl))
    ) {
      activeEl.blur();
    }

    if (transactionModal) {
      transactionModal.style.display = "none";
      ModalManager.closeModal(transactionModal);
      transactionModal.setAttribute("aria-hidden", "true");
    }
    if (searchModal) {
      searchModal.style.display = "none";
      ModalManager.closeModal(searchModal);
      searchModal.setAttribute("aria-hidden", "true");
    }

    const transactionAmount = document.getElementById("transactionAmount");
    if (transactionAmount) transactionAmount.value = "";
    const transactionDescription = document.getElementById("transactionDescription");
    if (transactionDescription) transactionDescription.value = "";
    const transactionRecurrence = document.getElementById("transactionRecurrence");
    if (transactionRecurrence) {
      transactionRecurrence.value = "once";
      // Allocate may have hidden the recurrence select — restore it for next open.
      transactionRecurrence.style.display = "";
    }

    // Reset the Settled toggle to its checked default so an unchecked state
    // from an abandoned entry doesn't leak into the next add (addTransaction
    // only resets it after a successful save).
    const transactionSettled = document.getElementById("transactionSettled");
    if (transactionSettled) {
      transactionSettled.checked = true;
      transactionSettled.disabled = false;
    }

    // Reset an abandoned Allocation entry back to a plain expense so its
    // autocomplete-off / auto-close-out state doesn't linger into the next
    // time the add form opens.
    const transactionTypeEl = document.getElementById("transactionType");
    if (transactionTypeEl && transactionTypeEl.value === "allocation") {
      transactionTypeEl.value = "expense";
    }
    const transactionAutoCloseout = document.getElementById("transactionAutoCloseout");
    if (transactionAutoCloseout) transactionAutoCloseout.checked = false;
    const transactionCloseoutDate = document.getElementById("transactionCloseoutDate");
    if (transactionCloseoutDate) transactionCloseoutDate.value = "";
    this.syncAllocateState();

    const advancedOptions = document.getElementById("advancedRecurrenceOptions");
    if (advancedOptions) {
      advancedOptions.remove();
    }
  }


  _notifyChange() {
    this.onUpdate();
    if (this.cloudSync) {
      this.cloudSync.scheduleCloudSave();
    }
  }


  async deleteTransaction(date, index, txnId) {
    // The captured positional index can go stale if a background updateUI()
    // shifts transactions[date] between render and click (and again across the
    // confirm-dialog await). Re-resolve the live index by id, falling back to
    // the captured index, both before reading and right before the mutation.
    const liveIndexOf = () => {
      const arr = this.store.getTransactions()[date] || [];
      const byId = txnId ? arr.findIndex((x) => x.id === txnId) : -1;
      if (byId !== -1) return byId;
      return arr[index] ? index : -1;
    };

    const transactions = this.store.getTransactions();
    let liveIndex = liveIndexOf();
    if (liveIndex === -1 || !transactions[date] || !transactions[date][liveIndex]) {
      console.error(`Transaction not found: date=${date}, index=${index}`);
      Utils.showNotification("Error: Transaction not found", "error");
      return;
    }

    const transaction = transactions[date][liveIndex];

    if (transaction.recurringId) {
      const confirmDelete = await Utils.showModalConfirm(
        "Do you want to delete just this occurrence or all future occurrences?",
        "Delete Recurring Transaction",
        {
          confirmText: "Delete All Future",
          cancelText: "Delete Only This",
          closeReturnsNull: true,
        }
      );

      if (confirmDelete === null) {
        return;
      }

      liveIndex = liveIndexOf();
      if (liveIndex === -1) {
        Utils.showNotification("Error: Transaction not found", "error");
        return;
      }
      this.recurringManager.deleteTransaction(date, liveIndex, confirmDelete);
    } else {
      const sign = transaction.type === "balance" ? "=" : transaction.type === "income" ? "+" : "-";
      const descPart = transaction.description ? `${transaction.description} – ` : "";
      const shouldDelete = await Utils.showModalConfirm(
        `Are you sure you want to delete this transaction?\n\n${descPart}${sign}$${Utils.formatAmount(transaction.amount)}`,
        "Delete Transaction",
        { confirmText: "Delete", cancelText: "Cancel" }
      );
      if (!shouldDelete) {
        return;
      }
      liveIndex = liveIndexOf();
      if (liveIndex === -1) {
        Utils.showNotification("Error: Transaction not found", "error");
        return;
      }
      // Snapshot for undo: restored under a fresh id (the deleted id is
      // tombstoned for sync — reusing it would let the next cloud merge
      // delete the restored copy again). Dropping drawAmount lets
      // addTransaction re-apply the allocation draw cleanly.
      const restoreClone = { ...this.store.getTransactions()[date][liveIndex] };
      delete restoreClone.id;
      delete restoreClone._lastModified;
      delete restoreClone.drawAmount;
      this.store.deleteTransaction(date, liveIndex);
      this.showTransactionDetails(date);
      this._notifyChange();
      Utils.showUndoToast("Transaction deleted", () =>
        this._restoreDeletedTransaction(date, restoreClone)
      );
      return;
    }

    this.showTransactionDetails(date);
    this._notifyChange();

    Utils.showNotification("Transaction deleted successfully");
  }


  normalizeTransactionType(type) {
    if (type === "income" || type === "expense" || type === "balance") {
      return type;
    }
    return "expense";
  }


  capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
