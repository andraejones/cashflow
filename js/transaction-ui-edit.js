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

    if (!Number.isFinite(amount)) {
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

    // Read and validate the allocation split BEFORE anything is mutated: the
    // date-change branches delete the row before re-adding it, and bailing out
    // on a bad split halfway through that would leave the expense gone. null
    // means the form had no editor at all (nothing to change about the split);
    // an empty array means the user cleared it.
    let editedDraws = null;
    const drawEditor = document.getElementById(
      `edit-draw-allocations-${date}-${index}`
    );
    if (drawEditor) {
      if (type !== "expense") {
        editedDraws = [];
      } else {
        const drawResult = this.collectAllocationDraws(drawEditor, amount);
        if (drawResult.error) {
          Utils.showNotification(drawResult.error, "error");
          return;
        }
        editedDraws = drawResult.rows;
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
        // Apply any allocation-split change from the edit form. Only present
        // for one-time, non-allocated expenses; updateTransaction reconciles
        // the buckets (refunds every old draw, re-debits the chosen ones). An
        // empty list is authoritative — clearing the selection or switching
        // away from expense drops the links.
        if (editedDraws !== null) {
          updatedFields.allocationDraws = editedDraws;
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
          if (!this.recurringManager.isTransactionSkipped(date, transaction.recurringId)) {
            this.recurringManager.toggleSkipTransaction(date, transaction.recurringId);
          }
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
          const movedId = this.store.addTransaction(newDate, movedTransaction);
          this._repointMovedAllocation(transaction, movedTransaction, movedId);
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
            // Carry the allocation split across the re-move, honoring any
            // change made in the edit form. Without this, deleting the old row
            // refunds the buckets via _reverseAllocationDraws and the re-add
            // never re-debits them — the spend stands while the buckets are
            // silently credited back (mirrors the regular one-time branch
            // below).
            if (type === "expense") {
              if (editedDraws !== null) {
                this._carryEditedDraws(
                  transaction,
                  reMovedTransaction,
                  editedDraws
                );
              } else {
                this.store.carryAllocationDraws(transaction, reMovedTransaction);
              }
            }
            const reMovedId = this.store.addTransaction(newDate, reMovedTransaction);
            this._repointMovedAllocation(transaction, reMovedTransaction, reMovedId);
          }
        } else {
          // Regular one-time transaction
          this.store.deleteTransaction(date, liveIndex);
          const newTransaction = { amount, type, description };
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
          // Carry the allocation split across the move, honoring any change
          // made in the edit form (the delete refunded the old buckets; the add
          // re-debits the chosen ones at the new date/amount).
          if (type === "expense") {
            if (editedDraws !== null) {
              this._carryEditedDraws(transaction, newTransaction, editedDraws);
            } else {
              this.store.carryAllocationDraws(transaction, newTransaction);
            }
          }
          const newId = this.store.addTransaction(newDate, newTransaction);
          this._repointMovedAllocation(transaction, newTransaction, newId);
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

  // A date change relocates a transaction by delete + re-add, so it lands under
  // a fresh id. When the thing being moved is an allocation bucket, every
  // expense drawing from it still names the old id — re-point them, or the
  // links dangle and the bucket silently stops absorbing later edits to those
  // expenses (see TransactionStore.repointAllocationDraws). Skipped when the
  // moved copy is no longer a bucket (a type change off expense drops the
  // flag); those drawers degrade exactly as they do after a Close Out.
  _repointMovedAllocation(original, movedCopy, newId) {
    if (!original || !original.id || !newId) return;
    if (movedCopy.allocated !== true) return;
    this.store.repointAllocationDraws(original.id, newId);
  },

  // Attach a split just confirmed in the edit form to a copy that is about to
  // be re-added at a new date. A row naming a bucket the expense ALREADY drew
  // from keeps that row's series/period provenance, so its demand history
  // survives the move even if the bucket has since been forfeited; a row the
  // user just added has nothing to carry and gets stamped fresh by the re-add.
  _carryEditedDraws(original, target, rows) {
    if (!rows || rows.length === 0) return target;
    const existing = this.store.getAllocationDraws(original);
    target.allocationDraws = rows.map((row) => {
      const prior = existing.find((r) => r.allocationId === row.allocationId);
      const copy = { allocationId: row.allocationId, amount: row.amount };
      if (prior && prior.recurringId) {
        copy.recurringId = prior.recurringId;
        if (prior.periodDate) copy.periodDate = prior.periodDate;
      }
      return copy;
    });
    return target;
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
    const recurringTransaction = this.recurringManager.getRecurringTransactionById(recurringId);
    if (!recurringTransaction) {
      Utils.showNotification("Recurring transaction not found", "error");
      return;
    }

    if (recurringTransaction.type !== "expense") {
      Utils.showNotification("Only expense transactions can be converted to debts", "error");
      return;
    }

    this.closeModals();

    // Open the debt snowball panel with pre-populated form
    if (this.debtSnowballUI) {
      this.debtSnowballUI.showDebtFormFromRecurring(recurringTransaction);
    } else {
      Utils.showNotification("Debt snowball not available", "error");
    }
  },

});
