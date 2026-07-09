// TransactionUI — the edit flow: edit form, saveEdit (single/future/all
// scopes, allocation draw bookkeeping, debt-link preservation), undo-delete
// restore, skip toggling, and recurring→debt conversion. Prototype companion
// of TransactionUI (class declared in transaction-ui.js); no build step —
// loaded as a plain script after the class file and before app.js (see
// index.html).

Object.assign(TransactionUI.prototype, {

  showEditForm(date, index) {
    const editForm = document.getElementById(`edit-form-${date}-${index}`);
    if (!editForm) {
      console.error(`Edit form not found for date ${date}, index ${index}`);
      return;
    }

    editForm.style.display = "block";
    const firstInput = editForm.querySelector("input, select");
    if (firstInput) {
      firstInput.focus();
    }
  },

  saveEdit(date, index, txnId) {
    // The edit-form DOM fields are keyed by the render-time `index`, so reads
    // below keep `index`. Store mutations use `liveIndex` (re-resolved by id),
    // because a background updateUI() (close-out, roll-forward, re-expansion)
    // can shift transactions[date] after the form rendered — mutating the
    // captured positional index would hit the wrong row.
    const amountElement = document.getElementById(`edit-amount-${date}-${index}`);
    const typeElement = document.getElementById(`edit-type-${date}-${index}`);
    const descriptionElement = document.getElementById(`edit-description-${date}-${index}`);

    if (!amountElement || !typeElement || !descriptionElement) {
      console.error("Edit form elements not found");
      Utils.showNotification("Error: Edit form elements not found", "error");
      return;
    }

    const amount = parseFloat(amountElement.value);
    const type = typeElement.value;
    const description = descriptionElement.value;
    const newDate = document.getElementById(`edit-date-${date}-${index}`)?.value || date;

    if (isNaN(amount)) {
      Utils.showNotification("Please enter a valid amount", "error");
      return;
    }
    // Balance transactions may be zero; income/expense must be > 0.
    if (type !== "balance" && amount <= 0) {
      Utils.showNotification("Income and expense amounts must be greater than 0", "error");
      return;
    }

    // Close-out date field (one-time auto-close-out allocations only). An
    // empty value falls back to the transaction's (possibly new) date; either
    // way it must be on/after that date.
    const closeoutEl = document.getElementById(`edit-closeout-${date}-${index}`);
    let editedCloseout;
    if (closeoutEl) {
      editedCloseout = closeoutEl.value || newDate;
      if (editedCloseout < newDate) {
        Utils.showNotification(
          "Close-out date must be on or after the transaction date.",
          "error"
        );
        return;
      }
    }

    const transactions = this.store.getTransactions();
    let liveIndex =
      txnId && transactions[date]
        ? transactions[date].findIndex((x) => x.id === txnId)
        : -1;
    if (liveIndex === -1) {
      liveIndex = index;
    }
    if (!transactions[date] || !transactions[date][liveIndex]) {
      console.error(`Transaction not found: date=${date}, index=${index}`);
      Utils.showNotification("Error: Transaction not found", "error");
      return;
    }

    const transaction = transactions[date][liveIndex];
    const isRecurring = transaction.recurringId !== undefined;
    const hasBalanceConflict = (targetDate) => {
      const targetTransactions = transactions[targetDate] || [];
      return targetTransactions.some((t, targetIndex) => {
        if (t.type !== "balance") {
          return false;
        }
        return !(targetDate === date && targetIndex === liveIndex);
      });
    };

    if (type === "balance") {
      if (isRecurring) {
        Utils.showNotification(
          "Recurring transactions cannot be changed to balance transactions.",
          "error"
        );
        return;
      }
      if (hasBalanceConflict(newDate)) {
        Utils.showNotification(
          "Only one balance transaction is allowed per day.",
          "error"
        );
        return;
      }
    }

    try {
      if (newDate === date) {
        // No date change — existing edit-in-place behavior
        let editScope = "this";
        if (isRecurring && transaction.type !== "balance") {
          const editRecurrenceElement = document.getElementById(`edit-recurrence-${date}-${index}`);
          if (editRecurrenceElement) {
            editScope = editRecurrenceElement.value;
          }
        }

        const updatedFields = { amount, type, description };
        if (type !== "expense") {
          updatedFields.settled = undefined;
        }
        // Allocation-bucket semantics only apply to expenses: a type change
        // off expense clears the bucket flags too, so an income row can't
        // linger as a phantom allocation. Outstanding draws degrade the same
        // way they do after a Close Out deletes their bucket.
        if (type !== "expense" && transaction.allocated === true) {
          updatedFields.allocated = undefined;
          updatedFields.autoCloseout = undefined;
          updatedFields.closeoutDate = undefined;
        }
        // Apply any allocation-draw change from the edit form. Only present for
        // one-time, non-allocated expenses; updateTransaction reconciles the
        // bucket (refunds the old draw, re-debits the chosen one). Clearing the
        // selection or switching away from expense drops the link.
        const drawEl = document.getElementById(`edit-draw-allocation-${date}-${index}`);
        if (drawEl) {
          updatedFields.drawsFromAllocationId =
            type === "expense" && drawEl.value ? drawEl.value : undefined;
        }
        // Apply the edited close-out date; drop it when the type moves away
        // from expense (the bucket semantics no longer apply).
        if (closeoutEl) {
          updatedFields.closeoutDate =
            type === "expense" ? editedCloseout : undefined;
        }
        this.recurringManager.editTransaction(
          date,
          liveIndex,
          updatedFields,
          editScope
        );

        this.showTransactionDetails(date);
        this._notifyChange();
        Utils.showNotification("Transaction updated successfully");
      } else {
        // Date changed — move the transaction
        if (isRecurring) {
          // Skip the original recurring occurrence
          if (!this.recurringManager.isTransactionSkipped(date, transaction.recurringId)) {
            this.recurringManager.toggleSkipTransaction(date, transaction.recurringId);
          }
          // Store move info
          this.store.moveTransaction(transaction.recurringId, date, newDate);
          // Create one-time at new date with edited fields
          const movedTransaction = {
            amount,
            type,
            description,
            movedFrom: date,
            originalRecurringId: transaction.recurringId
          };
          if (type === "expense" && transaction.settled !== undefined) {
            movedTransaction.settled = transaction.settled;
          }
          // Preserve allocation-bucket status so a moved recurring allocation
          // instance stays a reserve at the new date instead of degrading into
          // a plain expense (allocations always count as settled).
          if (type === "expense" && transaction.allocated === true) {
            movedTransaction.allocated = true;
            movedTransaction.settled = true;
            if (transaction.autoCloseout === true) {
              movedTransaction.autoCloseout = true;
            }
          }
          this.store.addTransaction(newDate, movedTransaction);
        } else if (transaction.movedFrom && transaction.originalRecurringId) {
          // One-time that was previously moved from a recurring
          if (newDate === transaction.movedFrom) {
            // Moving back to original date — restore recurring occurrence
            this.store.cancelMoveTransaction(transaction.originalRecurringId, transaction.movedFrom);
            if (this.recurringManager.isTransactionSkipped(transaction.movedFrom, transaction.originalRecurringId)) {
              this.recurringManager.toggleSkipTransaction(transaction.movedFrom, transaction.originalRecurringId);
            }
            this.store.deleteTransaction(date, liveIndex);
          } else {
            // Moving to a different date — update move info
            this.store.moveTransaction(
              transaction.originalRecurringId,
              transaction.movedFrom,
              newDate
            );
            this.store.deleteTransaction(date, liveIndex);
            const reMovedTransaction = {
              amount,
              type,
              description,
              movedFrom: transaction.movedFrom,
              originalRecurringId: transaction.originalRecurringId
            };
            if (type === "expense" && transaction.settled !== undefined) {
              reMovedTransaction.settled = transaction.settled;
            }
            // Preserve allocation-bucket status across the re-move (mirrors
            // the regular one-time branch below).
            if (type === "expense" && transaction.allocated === true) {
              reMovedTransaction.allocated = true;
              if (transaction.autoCloseout === true) {
                reMovedTransaction.autoCloseout = true;
                const carried =
                  editedCloseout || transaction.closeoutDate || newDate;
                reMovedTransaction.closeoutDate =
                  carried < newDate ? newDate : carried;
              }
            }
            // Carry the allocation draw across the re-move, honoring any change
            // made in the edit form. Without this, deleting the old row refunds
            // the bucket via _reverseAllocationDraw and the re-add never
            // re-debits it — the spend stands while the bucket is silently
            // credited back (mirrors the regular one-time branch below).
            if (type === "expense") {
              const reDrawEl = document.getElementById(`edit-draw-allocation-${date}-${index}`);
              const reDrawId = reDrawEl ? reDrawEl.value : transaction.drawsFromAllocationId;
              if (reDrawId) {
                reMovedTransaction.drawsFromAllocationId = reDrawId;
                // Same target: carry the series/period provenance so demand
                // history survives even if the bucket has been forfeited (a
                // changed target gets freshly stamped by the re-add).
                if (
                  reDrawId === transaction.drawsFromAllocationId &&
                  transaction.drawsFromRecurringId
                ) {
                  reMovedTransaction.drawsFromRecurringId = transaction.drawsFromRecurringId;
                  reMovedTransaction.drawsFromPeriodDate = transaction.drawsFromPeriodDate;
                }
              }
            }
            this.store.addTransaction(newDate, reMovedTransaction);
          }
        } else {
          // Regular one-time transaction
          this.store.deleteTransaction(date, liveIndex);
          const newTransaction = { amount, type, description };
          // Preserve settled status only when the new type is still expense
          if (type === "expense" && transaction.settled !== undefined) {
            newTransaction.settled = transaction.settled;
          }
          // Preserve allocation-bucket status across the move so an allocated
          // item doesn't degrade into a plain expense at the new date.
          if (type === "expense" && transaction.allocated === true) {
            newTransaction.allocated = true;
            if (transaction.autoCloseout === true) {
              newTransaction.autoCloseout = true;
              // Carry the close-out deadline, floored at the new date so the
              // moved bucket keeps the closeout ≥ date invariant.
              const carried =
                editedCloseout || transaction.closeoutDate || newDate;
              newTransaction.closeoutDate =
                carried < newDate ? newDate : carried;
            }
          }
          // Carry the allocation draw across the move, honoring any change made
          // in the edit form (delete refunded the old bucket; add re-debits the
          // chosen one at the new date/amount).
          if (type === "expense") {
            const drawEl = document.getElementById(`edit-draw-allocation-${date}-${index}`);
            const drawId = drawEl ? drawEl.value : transaction.drawsFromAllocationId;
            if (drawId) {
              newTransaction.drawsFromAllocationId = drawId;
              // Same target: carry the series/period provenance (see above).
              if (
                drawId === transaction.drawsFromAllocationId &&
                transaction.drawsFromRecurringId
              ) {
                newTransaction.drawsFromRecurringId = transaction.drawsFromRecurringId;
                newTransaction.drawsFromPeriodDate = transaction.drawsFromPeriodDate;
              }
            }
          }
          this.store.addTransaction(newDate, newTransaction);
        }

        this.showTransactionDetails(newDate);
        this._notifyChange();
        Utils.showNotification(`Transaction moved to ${Utils.formatDisplayDate(newDate)}`);
      }
    } catch (error) {
      console.error("Error saving edit:", error);
      Utils.showNotification("Error updating transaction", "error");
    }
  },

  // Re-add a just-deleted one-time transaction (undo toast callback). Runs
  // through addTransaction so it gets a fresh id/timestamp, re-applies any
  // allocation draw, persists, and syncs. Refreshes the day modal only if the
  // user still has it open.
  _restoreDeletedTransaction(date, transaction) {
    this.store.addTransaction(date, transaction);
    const modal = document.getElementById("transactionModal");
    if (modal && modal.style.display === "block") {
      this.showTransactionDetails(date);
    }
    this._notifyChange();
    Utils.showNotification("Transaction restored");
  },

  toggleSkipTransaction(date, recurringId) {
    const newStatus = this.recurringManager.toggleSkipTransaction(
      date,
      recurringId
    );

    this.showTransactionDetails(date);
    this._notifyChange();

    Utils.showNotification(
      `Transaction ${newStatus ? "skipped" : "unskipped"} successfully`
    );
  },

  convertRecurringToDebt(recurringId) {
    // Get the recurring transaction
    const recurringTransaction = this.recurringManager.getRecurringTransactionById(recurringId);
    if (!recurringTransaction) {
      Utils.showNotification("Recurring transaction not found", "error");
      return;
    }

    // Check if it's an expense
    if (recurringTransaction.type !== "expense") {
      Utils.showNotification("Only expense transactions can be converted to debts", "error");
      return;
    }

    // Close the transaction modal
    this.closeModals();

    // Open the debt snowball panel with pre-populated form
    if (this.debtSnowballUI) {
      this.debtSnowballUI.showDebtFormFromRecurring(recurringTransaction);
    } else {
      Utils.showNotification("Debt snowball not available", "error");
    }
  },

});
