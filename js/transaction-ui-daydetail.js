// TransactionUI — the day-detail modal: per-day balance figures (via
// CalculationService.getDayBalanceBreakdown), the transaction list with
// settle/skip/move actions, and the carried-forward unsettled section.
// Prototype companion of TransactionUI (class declared in transaction-ui.js);
// no build step — loaded as a plain script after the class file and before
// app.js (see index.html).

Object.assign(TransactionUI.prototype, {

  // Render the day-detail modal's balance summary. Shows the running balance
  // plus the same supporting figures the calendar cell surfaces (day expense,
  // balance without unsettled, balance excluding allocations, transaction
  // count), each labeled. Figures come from CalculationService.getDayBalanceBreakdown
  // so the modal reuses the calendar's balance walk instead of re-deriving it.
  renderModalBalance(date) {
    const modalBalance = document.getElementById("modalBalance");
    if (!modalBalance || !this.calculationService) return;

    const b = this.calculationService.getDayBalanceBreakdown(date);
    const rows = [];
    if (b.income > 0) {
      rows.push(`<div class="modal-balance-row"><span class="modal-balance-label">Income</span><span class="modal-balance-value income">+$${b.income.toFixed(2)}</span></div>`);
    }
    if (b.expense > 0) {
      rows.push(`<div class="modal-balance-row"><span class="modal-balance-label">Expenses</span><span class="modal-balance-value expense">-$${b.expense.toFixed(2)}</span></div>`);
    }
    if (b.balanceWithoutUnsettled !== null) {
      rows.push(`<div class="modal-balance-row"><span class="modal-balance-label">Balance without unsettled</span><span class="modal-balance-value">$${b.balanceWithoutUnsettled.toFixed(2)}</span></div>`);
    }
    if (b.balanceExcludingAllocations !== null) {
      rows.push(`<div class="modal-balance-row"><span class="modal-balance-label">Balance excluding allocations</span><span class="modal-balance-value">$${b.balanceExcludingAllocations.toFixed(2)}</span></div>`);
    }
    rows.push(`<div class="modal-balance-row modal-balance-total"><span class="modal-balance-label">Balance</span><span class="modal-balance-value">$${b.balance.toFixed(2)}</span></div>`);
    if (b.transactionCount > 0) {
      rows.push(`<div class="modal-balance-row"><span class="modal-balance-label">Transactions</span><span class="modal-balance-value">${b.transactionCount}</span></div>`);
    }

    modalBalance.innerHTML = rows.join("");
    modalBalance.className = b.balance < 0 ? "modal-balance negative" : "modal-balance";
  },

  showTransactionDetails(date) {
    try {

      // Ensure recurring transactions are expanded for this date's month
      // (handles cases when modal opens via search for a different month)
      const [year, month] = date.split("-").map(Number);
      this.recurringManager.applyRecurringTransactions(year, month - 1);

      const modal = document.getElementById("transactionModal");
      const transactionDate = document.getElementById("transactionDate");
      const modalTransactions = document.getElementById("modalTransactions");
      const modalDate = document.getElementById("modalDate");
      const transactionType = document.getElementById("transactionType");
      const transactionDescriptionInput = document.getElementById(
        "transactionDescription"
      );

      if (!modal || !transactionDate || !modalTransactions || !modalDate || !transactionType || !transactionDescriptionInput) {
        console.error("One or more required elements not found");
        return;
      }

      const descriptionFieldEl = document.getElementById("descriptionField");
      if (descriptionFieldEl) descriptionFieldEl.style.display = "";
      transactionDescriptionInput.style.display = "";
      this.populateDescriptionSuggestions();
      this.closeDescriptionSuggestions();
      transactionDate.value = date;
      const formattedDate = Utils.formatDisplayDate(date);

      modalDate.textContent = formattedDate;

      this.renderModalBalance(date);

      modalTransactions.innerHTML = "";
      transactionType.innerHTML = `
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="allocation">Allocation</option>
        <option value="balance">Balance</option>
      `;
      const transactions = this.store.getTransactions();
      const hasBalanceTransaction = transactions[date]?.some(
        (t) => t.type === "balance" && t.hidden !== true
      );

      // For debt-payment transactions, compute each debt's remaining balance as
      // of this day (after this day's payments) so it can be shown inline.
      let debtRemainingByDebtId = null;
      if (
        transactions[date] &&
        this.debtSnowballUI &&
        typeof this.debtSnowballUI.getHistoricalDebtSnapshot === "function" &&
        transactions[date].some((t) => t.debtId)
      ) {
        const parsedDate = Utils.parseDateString(date);
        if (parsedDate) {
          // The snapshot cutoff is exclusive, so use the next day to include
          // payments made on the viewed day.
          const cutoff = new Date(parsedDate);
          cutoff.setDate(cutoff.getDate() + 1);
          debtRemainingByDebtId =
            this.debtSnowballUI.getHistoricalDebtSnapshot(cutoff)
              .remainingByDebtId;
        }
      }

      if (transactions[date]) {
        let hasVisible = false;
        transactions[date].forEach((t, index) => {
          const isHidden = t.hidden === true;
          if (!isHidden) {
            hasVisible = true;
          }
          const transactionDiv = document.createElement("div");
          if (isHidden) {
            transactionDiv.classList.add("hidden-transaction");
          }
          const isRecurring = t.recurringId !== undefined;
          const isSkipped =
            isRecurring &&
            this.recurringManager.isTransactionSkipped(date, t.recurringId);
          // A skipped occurrence that was relocated to a later date isn't truly
          // "skipped" — it was authorized on its scheduled date and cleared/
          // settled later (the settled copy lives on the move's toDate). Surface
          // it as "Authorized" so the scheduled-date row reads correctly.
          const moveRecord = isSkipped
            ? this.store.getMoveForRecurring(t.recurringId, date)
            : null;
          const isAuthorizedLater =
            !!moveRecord && moveRecord.toDate > date;

          let recurrenceType = "";
          let additionalInfo = "";
          if (isRecurring) {
            const recurringTransaction =
              this.recurringManager.getRecurringTransactionById(t.recurringId);
            if (recurringTransaction) {
              recurrenceType = this.capitalizeFirstLetter(
                recurringTransaction.recurrence
              );
              if (recurringTransaction.businessDayAdjustment &&
                recurringTransaction.businessDayAdjustment !== "none") {
                additionalInfo += ` (${this.formatBusinessDayAdjustment(recurringTransaction.businessDayAdjustment)}`;
                if (t.originalDate) {
                  additionalInfo += ` orig ${this.formatShortDisplayDate(t.originalDate)}`;
                }

                additionalInfo += `)`;
              }
              if (recurringTransaction.daySpecific && recurringTransaction.daySpecificData) {
                const dayOption = Utils.DAY_SPECIFIC_OPTIONS.find(
                  option => option.value === recurringTransaction.daySpecificData
                );
                if (dayOption) {
                  additionalInfo += ` (${dayOption.label})`;
                }
              }
            }
          }
          const normalizedType = this.normalizeTransactionType(t.type);
          const descriptionText =
            typeof t.description === "string" ? t.description : "";
          const sign =
            normalizedType === "balance"
              ? "="
              : normalizedType === "income"
                ? "+"
                : "-";
          const amountSpan = document.createElement("span");
          amountSpan.classList.add(normalizedType);
          // Authorized rows stay grayed (opacity) but are not struck through —
          // the payment happened, it just cleared on a later date.
          if (isSkipped && !isAuthorizedLater) {
            amountSpan.classList.add("skipped");
          }
          amountSpan.style.opacity = isSkipped ? "0.5" : "1";
          const isUnsettled = normalizedType === "expense" && t.settled === false;
          const isAllocated = normalizedType === "expense" && t.allocated === true;
          if (isUnsettled) {
            transactionDiv.classList.add("unsettled-transaction");
          }
          if (isAllocated) {
            transactionDiv.classList.add("allocated-transaction");
          }
          let statusLabel = "";
          if (t.whatIf === true) {
            statusLabel = " (What-if draft)";
          } else if (isSkipped) {
            statusLabel = isAuthorizedLater ? " (Authorized)" : " (Skipped)";
          } else if (isHidden) {
            statusLabel = " (Hidden - Debt Snowball)";
          } else if (isUnsettled) {
            statusLabel = " (Unsettled)";
          } else if (isAllocated) {
            // Surface an auto-close-out bucket's deadline when it outlives its
            // own date, so the user can see how long it stays drawable.
            statusLabel =
              t.autoCloseout === true && t.closeoutDate && t.closeoutDate !== date
                ? ` (Allocated, closes ${this.formatShortDisplayDate(t.closeoutDate)})`
                : " (Allocated)";
          }
          amountSpan.textContent = `${sign}$${t.amount.toFixed(2)}${statusLabel}`;
          transactionDiv.appendChild(amountSpan);

          if (descriptionText) {
            transactionDiv.appendChild(
              document.createTextNode(` - ${descriptionText}`)
            );
          }

          if (isRecurring) {
            const recurringText = ` (Recurring${recurrenceType ? " " + recurrenceType : ""
              }${additionalInfo})`;
            transactionDiv.appendChild(document.createTextNode(recurringText));
          }

          // A regular expense that draws from an allocation shows which bucket it
          // is billed against — the allocation's title and its date.
          if (normalizedType === "expense" && t.drawsFromAllocationId) {
            const drawInfo = this.store.getAllocationInfoById(
              t.drawsFromAllocationId
            );
            if (drawInfo) {
              const drawSpan = document.createElement("span");
              drawSpan.className = "draw-from-allocation";
              drawSpan.textContent = ` (Drawn from: ${drawInfo.description}, ${this.formatShortDisplayDate(drawInfo.date)})`;
              transactionDiv.appendChild(drawSpan);
            }
          }

          if (
            t.debtId &&
            debtRemainingByDebtId &&
            Object.prototype.hasOwnProperty.call(
              debtRemainingByDebtId,
              t.debtId
            )
          ) {
            const remaining = Number(debtRemainingByDebtId[t.debtId]) || 0;
            const remainingSpan = document.createElement("span");
            remainingSpan.className = "debt-remaining";
            remainingSpan.textContent = ` (Remaining: $${remaining.toFixed(2)})`;
            transactionDiv.appendChild(remainingSpan);
          }

          // Debt-linked transactions (minimum payments, snowball payments) are
          // managed from the Debt Snowball panel — editing/deleting them here
          // never sticks (the projection re-materializes them every render), so
          // don't surface the Edit/Delete buttons for them.
          const isDebtManaged = Boolean(t.debtId);

          let editBtn = null;
          let deleteBtn = null;
          if (!isDebtManaged) {
            editBtn = document.createElement("span");
            editBtn.className = "edit-btn";
            editBtn.setAttribute("role", "button");
            editBtn.setAttribute("tabindex", "0");
            editBtn.setAttribute(
              "aria-label",
              `Edit ${normalizedType} of $${t.amount.toFixed(2)}${descriptionText ? " " + descriptionText : ""
              }`
            );
            editBtn.textContent = "Edit";
            transactionDiv.appendChild(editBtn);

            deleteBtn = document.createElement("span");
            deleteBtn.className = "delete-btn";
            deleteBtn.setAttribute("role", "button");
            deleteBtn.setAttribute("tabindex", "0");
            deleteBtn.setAttribute(
              "aria-label",
              `Delete ${normalizedType} of $${t.amount.toFixed(2)}${descriptionText ? " " + descriptionText : ""
              }`
            );
            deleteBtn.textContent = "Delete";
            transactionDiv.appendChild(deleteBtn);
          }

          let skipBtn = null;
          if (isRecurring) {
            skipBtn = document.createElement("span");
            skipBtn.className = "skip-btn";
            skipBtn.setAttribute("role", "button");
            skipBtn.setAttribute("tabindex", "0");
            skipBtn.setAttribute(
              "aria-label",
              `${isSkipped ? "Unskip" : "Skip"} recurring ${normalizedType}`
            );
            skipBtn.textContent = isSkipped ? "Unskip" : "Skip";
            transactionDiv.appendChild(skipBtn);
          }

          // Add Settle/Unsettle button for expenses.
          // `settled === false` is the only "unsettled" state; missing or `true` means settled.
          // Allocated (one-time) expenses are always settled, so the settle
          // toggle is meaningless for them — repurpose it as "Close Out", which
          // deletes the allocation after confirmation. Regular expenses keep
          // the Mark Settled/Unsettled toggle.
          const isCloseOut = isAllocated && !isRecurring;
          let settleBtn = null;
          // A recurring allocation instance auto-closes on its date; settling
          // and manual close-out are both meaningless for it, so skip the button.
          if (normalizedType === "expense" && !isSkipped && !(isAllocated && isRecurring)) {
            const isCurrentlyUnsettled = t.settled === false;
            settleBtn = document.createElement("span");
            settleBtn.className = "settle-btn";
            settleBtn.setAttribute("role", "button");
            settleBtn.setAttribute("tabindex", "0");
            if (isCloseOut) {
              settleBtn.setAttribute("aria-label", "Close out allocation");
              settleBtn.textContent = "Close Out";
            } else {
              settleBtn.setAttribute(
                "aria-label",
                isCurrentlyUnsettled ? "Mark expense settled" : "Mark expense unsettled"
              );
              settleBtn.textContent = isCurrentlyUnsettled ? "Mark Settled" : "Mark Unsettled";
            }
            transactionDiv.appendChild(settleBtn);
          }

          const editForm = document.createElement("div");
          editForm.className = "edit-form";
          editForm.id = `edit-form-${date}-${index}`;
          editForm.style.display = "none";

          const amountInput = document.createElement("input");
          amountInput.type = "number";
          amountInput.id = `edit-amount-${date}-${index}`;
          amountInput.value = t.amount;
          amountInput.step = "0.01";
          amountInput.min = "0";
          amountInput.setAttribute("aria-label", "Amount");
          editForm.appendChild(amountInput);

          const typeSelect = document.createElement("select");
          typeSelect.id = `edit-type-${date}-${index}`;
          typeSelect.setAttribute("aria-label", "Type");
          const expenseOption = document.createElement("option");
          expenseOption.value = "expense";
          expenseOption.textContent = "Expense";
          if (normalizedType === "expense") {
            expenseOption.selected = true;
          }
          const incomeOption = document.createElement("option");
          incomeOption.value = "income";
          incomeOption.textContent = "Income";
          if (normalizedType === "income") {
            incomeOption.selected = true;
          }
          const balanceOption = document.createElement("option");
          balanceOption.value = "balance";
          balanceOption.textContent = "Balance";
          if (normalizedType === "balance") {
            balanceOption.selected = true;
          }
          typeSelect.appendChild(expenseOption);
          typeSelect.appendChild(incomeOption);
          typeSelect.appendChild(balanceOption);
          editForm.appendChild(typeSelect);

          const descriptionInput = document.createElement("input");
          descriptionInput.type = "text";
          descriptionInput.id = `edit-description-${date}-${index}`;
          descriptionInput.value = descriptionText;
          descriptionInput.placeholder = "Description";
          descriptionInput.setAttribute("aria-label", "Description");
          editForm.appendChild(descriptionInput);

          if (isRecurring && normalizedType !== "balance") {
            const editScopeSelect = document.createElement("select");
            editScopeSelect.id = `edit-recurrence-${date}-${index}`;
            editScopeSelect.setAttribute("aria-label", "Edit scope");

            const thisOption = document.createElement("option");
            thisOption.value = "this";
            thisOption.textContent = "Edit this occurrence only";
            const futureOption = document.createElement("option");
            futureOption.value = "future";
            futureOption.textContent = "Edit this and future occurrences";
            const allOption = document.createElement("option");
            allOption.value = "all";
            allOption.textContent = "Edit all occurrences";

            editScopeSelect.appendChild(thisOption);
            editScopeSelect.appendChild(futureOption);
            editScopeSelect.appendChild(allOption);
            editForm.appendChild(editScopeSelect);
          }

          const dateInput = document.createElement("input");
          dateInput.type = "date";
          dateInput.id = `edit-date-${date}-${index}`;
          dateInput.value = date;
          dateInput.setAttribute("aria-label", "Date");
          editForm.appendChild(dateInput);

          // One-time auto-close-out buckets carry their own close-out
          // deadline (drawable through it, forfeited the day after); expose
          // it for editing. Missing closeoutDate on legacy entries means "the
          // bucket's own date". The on/after-transaction-date constraint is
          // re-checked on save since either date can change.
          if (
            normalizedType === "expense" &&
            !isRecurring &&
            isAllocated &&
            t.autoCloseout === true
          ) {
            const closeoutLabel = document.createElement("label");
            closeoutLabel.className = "edit-closeout-label";
            closeoutLabel.appendChild(document.createTextNode("Close out on "));
            const closeoutInput = document.createElement("input");
            closeoutInput.type = "date";
            closeoutInput.id = `edit-closeout-${date}-${index}`;
            closeoutInput.value = t.closeoutDate || date;
            closeoutInput.min = date;
            closeoutInput.setAttribute("aria-label", "Close-out date");
            closeoutLabel.appendChild(closeoutInput);
            editForm.appendChild(closeoutLabel);
          }

          // Regular one-time expenses can be billed against an allocation
          // bucket. Mirror the add-modal "Draw from allocation" control so the
          // association can be set or changed when editing in place. Skipped for
          // recurring and allocation-bucket items (an allocation can't draw from
          // another).
          if (normalizedType === "expense" && !isRecurring && !isAllocated) {
            const drawSelect = document.createElement("select");
            drawSelect.id = `edit-draw-allocation-${date}-${index}`;
            drawSelect.setAttribute("aria-label", "Draw from allocation");
            const count = this.populateEditDrawAllocation(
              drawSelect,
              date,
              t.drawsFromAllocationId
            );
            // Only surface the control when there's something to choose (a live
            // bucket) or an existing link to preserve.
            if (count > 0 || t.drawsFromAllocationId) {
              editForm.appendChild(drawSelect);
            }
          }

          // Recurring allocation series: opt-in, suggest-only floor
          // right-sizing from spending history. The checkbox is series-level
          // and persists immediately (not part of the scoped save); the
          // suggestion line is computed fresh and never auto-writes — Apply
          // just fills the amount field (scope preset to "all", which updates
          // the definition in place; past buckets are already forfeited, so
          // it's future-facing) and the user still hits Save.
          if (normalizedType === "expense" && isRecurring && isAllocated) {
            const seriesDef = this.recurringManager.getRecurringTransactionById(
              t.recurringId
            );
            if (seriesDef && seriesDef.allocated === true) {
              const adjustLabel = document.createElement("label");
              adjustLabel.className = "floor-adjust-toggle-label";
              const adjustCb = document.createElement("input");
              adjustCb.type = "checkbox";
              adjustCb.checked = seriesDef.autoAdjustFloor === true;
              adjustCb.setAttribute(
                "aria-label",
                "Suggest amount adjustments from spending history"
              );
              adjustLabel.appendChild(adjustCb);
              adjustLabel.appendChild(
                document.createTextNode(" Suggest amount from spending history")
              );
              editForm.appendChild(adjustLabel);

              const suggestionRow = document.createElement("div");
              suggestionRow.className = "floor-suggestion-row";
              editForm.appendChild(suggestionRow);

              const renderSuggestion = () => {
                suggestionRow.innerHTML = "";
                const freshDef =
                  this.recurringManager.getRecurringTransactionById(
                    t.recurringId
                  );
                if (!freshDef || freshDef.autoAdjustFloor !== true) {
                  suggestionRow.style.display = "none";
                  return;
                }
                suggestionRow.style.display = "";
                const s = this.store.getAllocationFloorSuggestion(
                  t.recurringId
                );
                if (!s) {
                  suggestionRow.textContent =
                    "No suggestion yet — needs 3 completed periods with linked spending, or the current amount already fits.";
                  return;
                }
                const text = document.createElement("span");
                const recent = s.periods
                  .map((p) => `$${p.demand.toFixed(2)}`)
                  .join(", ");
                text.textContent = `Suggested: $${s.suggested.toFixed(2)} — floor $${s.floor.toFixed(2)}, last ${s.periods.length} periods: ${recent} `;
                suggestionRow.appendChild(text);
                const applyBtn = document.createElement("button");
                applyBtn.type = "button";
                applyBtn.textContent = "Apply";
                applyBtn.setAttribute("aria-label", "Apply suggested amount");
                applyBtn.addEventListener("click", () => {
                  amountInput.value = s.suggested;
                  const scopeSelect = document.getElementById(
                    `edit-recurrence-${date}-${index}`
                  );
                  if (scopeSelect) scopeSelect.value = "all";
                });
                suggestionRow.appendChild(applyBtn);
              };
              adjustCb.addEventListener("change", () => {
                this.store.setAllocationAutoAdjust(
                  t.recurringId,
                  adjustCb.checked
                );
                renderSuggestion();
              });
              renderSuggestion();
            }
          }

          const saveButton = document.createElement("button");
          saveButton.setAttribute("aria-label", "Save changes");
          saveButton.textContent = "Save";
          saveButton.addEventListener("click", () => {
            this.saveEdit(date, index, t.id);
          });
          editForm.appendChild(saveButton);

          const cancelButton = document.createElement("button");
          cancelButton.setAttribute("aria-label", "Cancel editing");
          cancelButton.textContent = "Cancel";
          cancelButton.addEventListener("click", () => {
            editForm.style.display = "none";
          });
          editForm.appendChild(cancelButton);

          // Add "Convert to Debt" button for recurring expense transactions
          if (isRecurring && normalizedType === "expense") {
            const convertToDebtButton = document.createElement("button");
            convertToDebtButton.className = "convert-debt-btn";
            convertToDebtButton.setAttribute("aria-label", "Convert to debt");
            convertToDebtButton.textContent = "Convert to Debt";
            convertToDebtButton.addEventListener("click", () => {
              this.convertRecurringToDebt(t.recurringId);
            });
            editForm.appendChild(convertToDebtButton);
          }

          transactionDiv.appendChild(editForm);

          if (editBtn) {
            editBtn.addEventListener("click", () =>
              this.showEditForm(date, index)
            );
            editBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.showEditForm(date, index);
              }
            });
          }
          if (deleteBtn) {
            deleteBtn.addEventListener("click", () =>
              this.deleteTransaction(date, index, t.id)
            );
            deleteBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.deleteTransaction(date, index, t.id);
              }
            });
          }
          if (skipBtn) {
            skipBtn.addEventListener("click", () =>
              this.toggleSkipTransaction(date, t.recurringId)
            );
            skipBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.toggleSkipTransaction(date, t.recurringId);
              }
            });
          }

          if (settleBtn && isCloseOut) {
            const txnId = t.id;
            const closeOutAmount = t.amount;
            const closeOutDesc = descriptionText;
            const closeOut = async () => {
              const descPart = closeOutDesc ? `${closeOutDesc} – ` : "";
              const shouldClose = await Utils.showModalConfirm(
                `Close out this allocation?\n\n${descPart}-$${Number(closeOutAmount).toFixed(2)}\n\nThis removes the allocation.`,
                "Close Out Allocation",
                { confirmText: "Close Out", cancelText: "Cancel" }
              );
              if (!shouldClose) {
                return;
              }
              // Allocations roll forward, so resolve the current location by id
              // rather than the closure-captured date/index.
              const loc = txnId ? this.store.findTransactionById(txnId) : null;
              if (loc) {
                this.store.deleteTransaction(loc.date, loc.index);
              } else if (this.store.getTransactions()[date]?.[index]) {
                this.store.deleteTransaction(date, index);
              } else {
                Utils.showNotification("Allocation no longer exists", "error");
                return;
              }
              this.showTransactionDetails(date);
              this._notifyChange();
              Utils.showNotification("Allocation closed out");
            };
            settleBtn.addEventListener("click", closeOut);
            settleBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                closeOut();
              }
            });
          } else if (settleBtn) {
            const txnId = t.id;
            const toggleSettled = () => {
              // Resolve the current index from the store. The closure-captured index
              // can become stale if applyRecurringTransactions reorders the array
              // between render and click (e.g. when recurring instances re-expand).
              const current = this.store.getTransactions()[date] || [];
              let resolvedIndex = txnId
                ? current.findIndex((x) => x.id === txnId)
                : -1;
              if (resolvedIndex === -1) {
                resolvedIndex = index;
              }
              const target = current[resolvedIndex];
              if (!target) {
                return;
              }
              const newSettled = target.settled === false ? true : false;
              this.store.setTransactionSettled(date, resolvedIndex, newSettled);
              this.showTransactionDetails(date);
              this._notifyChange();
              Utils.showNotification(newSettled ? "Transaction settled" : "Transaction unsettled");
            };
            settleBtn.addEventListener("click", toggleSettled);
            settleBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleSettled();
              }
            });
          }

          modalTransactions.appendChild(transactionDiv);
        });
        if (!hasVisible) {
          modalTransactions.innerHTML = "<p>No transactions for this date.</p>";
        }
      } else {
        modalTransactions.innerHTML = "<p>No transactions for this date.</p>";
      }

      // Show carried-forward unsettled transactions on past/present dates.
      // An Ending Balance on/before the viewed date reconciles everything dated
      // on/before it, so those items are no longer "carried forward".
      const today = new Date();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (date <= todayString) {
        const unsettled = this.calculationService
          ? this.calculationService.getCarriedUnsettledList(date)
          : [];
        if (unsettled.length > 0) {
          const header = document.createElement("div");
          header.className = "carried-forward-header";
          header.textContent = "UNSETTLED (CARRIED FORWARD)";
          modalTransactions.appendChild(header);

          unsettled.forEach((u) => {
            const div = document.createElement("div");
            div.className = "carried-forward-transaction";
            const isRecurringItem = !!u.transaction.recurringId;

            const shortDate = this.formatShortDisplayDate(u.date);

            const amountSpan = document.createElement("span");
            amountSpan.classList.add("expense");
            amountSpan.textContent = `-$${u.transaction.amount.toFixed(2)}`;
            div.appendChild(amountSpan);

            const desc = u.transaction.description || "";
            if (desc) {
              div.appendChild(document.createTextNode(` - ${desc}`));
            }

            const fromLabel = document.createElement("span");
            fromLabel.className = "carried-forward-label";
            fromLabel.textContent = ` (from ${shortDate})`;
            div.appendChild(fromLabel);

            const settleBtn = document.createElement("span");
            settleBtn.className = "settle-btn";
            settleBtn.setAttribute("role", "button");
            settleBtn.setAttribute("tabindex", "0");
            settleBtn.textContent = "Settle";
            const doSettle = () => {
              if (isRecurringItem) {
                // Recurring: move occurrence to the viewed date and settle there.
                // Settling a carried-forward expense reflects when the money
                // actually left the account, not the original scheduled date.
                const transactions = this.store.getTransactions()[u.date] || [];
                const currentIndex = transactions.findIndex(t =>
                  t.recurringId === u.transaction.recurringId && t.settled === false
                );
                if (currentIndex === -1) {
                  Utils.showNotification("Error: Original transaction not found", "error");
                  this.showTransactionDetails(date);
                  return;
                }
                const recId = u.transaction.recurringId;
                this.store.deleteTransaction(u.date, currentIndex);
                if (!this.recurringManager.isTransactionSkipped(u.date, recId)) {
                  this.recurringManager.toggleSkipTransaction(u.date, recId);
                }
                this.store.moveTransaction(recId, u.date, date);
                const movedCopy = {
                  amount: u.transaction.amount,
                  type: u.transaction.type,
                  description: u.transaction.description,
                  settled: true,
                  movedFrom: u.date,
                  originalRecurringId: recId,
                };
                // Carry the allocation link forward. Deleting the original
                // refunds the bucket via _reverseAllocationDraw, so the settled
                // copy must re-draw or the spend stands while the bucket is
                // credited back. Drop the stale drawAmount (addTransaction
                // recomputes it on draw).
                if (u.transaction.drawsFromAllocationId) {
                  movedCopy.drawsFromAllocationId = u.transaction.drawsFromAllocationId;
                }
                // Carry the series/period provenance too — if the bucket has
                // since been forfeited, the re-add's dangling-link cleanup
                // keeps these as the spend's demand-history record.
                if (u.transaction.drawsFromRecurringId) {
                  movedCopy.drawsFromRecurringId = u.transaction.drawsFromRecurringId;
                  movedCopy.drawsFromPeriodDate = u.transaction.drawsFromPeriodDate;
                }
                this.store.addTransaction(date, movedCopy);
              } else {
                // One-time: delete from original date, create settled copy on viewed date
                const transactions = this.store.getTransactions()[u.date] || [];
                const currentIndex = transactions.findIndex(t => t.id === u.transaction.id);
                if (currentIndex === -1) {
                  Utils.showNotification("Error: Original transaction not found", "error");
                  this.showTransactionDetails(date);
                  return;
                }
                this.store.deleteTransaction(u.date, currentIndex);
                const settledCopy = {
                  amount: u.transaction.amount,
                  type: u.transaction.type,
                  description: u.transaction.description,
                  settled: true,
                };
                // Carry the allocation link forward (see recurring branch).
                if (u.transaction.drawsFromAllocationId) {
                  settledCopy.drawsFromAllocationId = u.transaction.drawsFromAllocationId;
                }
                // Carry the series/period provenance (see recurring branch).
                if (u.transaction.drawsFromRecurringId) {
                  settledCopy.drawsFromRecurringId = u.transaction.drawsFromRecurringId;
                  settledCopy.drawsFromPeriodDate = u.transaction.drawsFromPeriodDate;
                }
                this.store.addTransaction(date, settledCopy);
              }
              this.showTransactionDetails(date);
              this._notifyChange();
              Utils.showNotification("Transaction settled");
            };
            settleBtn.addEventListener("click", doSettle);
            settleBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                doSettle();
              }
            });
            div.appendChild(settleBtn);

            if (isRecurringItem) {
              // Recurring: show Skip button instead of Delete
              const skipBtn = document.createElement("span");
              skipBtn.className = "skip-btn";
              skipBtn.setAttribute("role", "button");
              skipBtn.setAttribute("tabindex", "0");
              skipBtn.setAttribute("aria-label", `Skip recurring expense`);
              skipBtn.textContent = "Skip";
              const doSkip = () => {
                this.recurringManager.toggleSkipTransaction(u.date, u.transaction.recurringId);
                this.showTransactionDetails(date);
                this._notifyChange();
                Utils.showNotification("Transaction skipped");
              };
              skipBtn.addEventListener("click", doSkip);
              skipBtn.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  doSkip();
                }
              });
              div.appendChild(skipBtn);
            } else {
              // One-time: show Delete button
              const deleteBtn = document.createElement("span");
              deleteBtn.className = "delete-btn";
              deleteBtn.setAttribute("role", "button");
              deleteBtn.setAttribute("tabindex", "0");
              deleteBtn.setAttribute(
                "aria-label",
                `Delete expense of $${u.transaction.amount.toFixed(2)}${desc ? " " + desc : ""}`
              );
              deleteBtn.textContent = "Delete";
              const doDelete = async () => {
                const shouldDelete = await Utils.showModalConfirm(
                  `Are you sure you want to delete this unsettled transaction?\n\n${desc ? desc + " – " : ""}-$${u.transaction.amount.toFixed(2)}`,
                  "Delete Transaction",
                  { confirmText: "Delete", cancelText: "Cancel" }
                );
                if (!shouldDelete) return;
                const transactions = this.store.getTransactions()[u.date] || [];
                const currentIndex = transactions.findIndex(t => t.id === u.transaction.id);
                if (currentIndex === -1) {
                  Utils.showNotification("Error: Original transaction not found", "error");
                  this.showTransactionDetails(date);
                  return;
                }
                const restoreClone = { ...transactions[currentIndex] };
                delete restoreClone.id;
                delete restoreClone._lastModified;
                delete restoreClone.drawAmount;
                this.store.deleteTransaction(u.date, currentIndex);
                this.showTransactionDetails(date);
                this._notifyChange();
                Utils.showUndoToast("Transaction deleted", () =>
                  this._restoreDeletedTransaction(u.date, restoreClone)
                );
              };
              deleteBtn.addEventListener("click", doDelete);
              deleteBtn.addEventListener("keydown", (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  doDelete();
                }
              });
              div.appendChild(deleteBtn);
            }

            modalTransactions.appendChild(div);
          });
        }
      }

      const recurrenceSelect = document.getElementById("transactionRecurrence");
      if (transactionType.value === "balance") {
        recurrenceSelect.value = "once";
        recurrenceSelect.style.display = "none";
      } else {
        recurrenceSelect.style.display = "";
      }
      this.updateSettledToggleVisibility();
      if (hasBalanceTransaction) {
        const balanceOption = transactionType.querySelector(
          'option[value="balance"]'
        );
        if (balanceOption) {
          balanceOption.disabled = true;
          balanceOption.title = "Only one balance transaction allowed per day";
        }
      } else {
        const balanceOption = transactionType.querySelector(
          'option[value="balance"]'
        );
        if (balanceOption) {
          balanceOption.disabled = false;
          balanceOption.title = "";
        }
      }
      // Normalize the allocate / auto-close-out toggles and the recurrence
      // availability to match the current checkbox state for this open.
      this.syncAllocateState();
      // Populate the "Draw from allocation" dropdown with current bucket
      // balances for this open of the add form.
      this.updateDrawAllocationVisibility();

      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
      ModalManager.openModal(modal);
      setTimeout(() => {
        const firstInput = modal.querySelector(
          'input:not([type="date"]), select, button'
        );
        if (firstInput) {
          firstInput.focus();
        }
      }, 100);
    } catch (error) {
      console.error("Error showing transaction details:", error);
      this.showModalFallback(date);
    }
  },

  formatBusinessDayAdjustment(adjustment) {
    switch (adjustment) {
      case "previous":
        return "Adj. to prev. business day";
      case "next":
        return "Adj. to next business day";
      case "nearest":
        return "Adj. to nearest business day";
      default:
        return "";
    }
  },

  showModalFallback(date) {
    try {
      const modal = document.getElementById("transactionModal");
      if (!modal) {
        Utils.showModalAlert("Transaction modal not found!", "Missing Modal");
        return;
      }
      const modalDate = document.getElementById("modalDate");
      if (modalDate) {
        modalDate.textContent = Utils.formatDisplayDate(date);
      }
      this.renderModalBalance(date);
      const transactionDate = document.getElementById("transactionDate");
      if (transactionDate) {
        transactionDate.value = date;
      }
      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
      ModalManager.openModal(modal);
      const modalTransactions = document.getElementById("modalTransactions");
      if (modalTransactions) {
        const transactions = this.store.getTransactions();
        if (transactions[date] && transactions[date].length > 0) {
          modalTransactions.innerHTML = "";
          let hasVisible = false;
          transactions[date].forEach((t) => {
            if (t.hidden === true) {
              return;
            }
            hasVisible = true;
            const row = document.createElement("div");
            const sign = t.type === "balance" ? "=" : t.type === "income" ? "+" : "-";
            row.appendChild(
              document.createTextNode(`${sign}$${t.amount.toFixed(2)}`)
            );
            if (typeof t.description === "string" && t.description) {
              row.appendChild(document.createTextNode(` - ${t.description}`));
            }
            modalTransactions.appendChild(row);
          });
          if (!hasVisible) {
            const emptyMessage = document.createElement("p");
            emptyMessage.textContent = "No transactions for this date.";
            modalTransactions.innerHTML = "";
            modalTransactions.appendChild(emptyMessage);
          }
        } else {
          const emptyMessage = document.createElement("p");
          emptyMessage.textContent = "No transactions for this date.";
          modalTransactions.innerHTML = "";
          modalTransactions.appendChild(emptyMessage);
        }
      }
    } catch (error) {
      console.error("Fallback modal opening failed:", error);
      Utils.showModalAlert(
        "Could not open transaction details. Please check the console for errors.",
        "Transaction Details"
      );
    }
  },

});
