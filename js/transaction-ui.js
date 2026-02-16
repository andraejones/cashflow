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
    this._boundWindowClickHandler = null;

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

    // Store bound handlers for cleanup
    this._boundWindowClickHandler = (event) => {
      const transactionModal = document.getElementById("transactionModal");
      const searchModal = document.getElementById("searchModal");
      if (event.target === transactionModal || event.target === searchModal) {
        this.closeModals();
      }
    };
    window.addEventListener("click", this._boundWindowClickHandler);

    this._boundEscapeHandler = (event) => {
      if (event.key === "Escape") {
        this.closeModals();
      }
    };
    document.addEventListener("keydown", this._boundEscapeHandler);
    const transactionType = document.getElementById("transactionType");
    const recurrenceSelect = document.getElementById("transactionRecurrence");
    const transactionDescription = document.getElementById("transactionDescription");

    transactionType.addEventListener("change", () => {
      if (transactionType.value === "balance") {
        recurrenceSelect.value = "once";
        recurrenceSelect.style.display = "none";
        transactionDescription.value = "Ending Balance";
        transactionDescription.style.display = "none";
      } else {
        recurrenceSelect.style.display = "";
        transactionDescription.style.display = "";
        transactionDescription.value = "";
        transactionDescription.placeholder = "Description";
      }
      this.updateSettledToggleVisibility();
    });
    document.getElementById("transactionRecurrence").addEventListener("change", () => {
      this.updateRecurrenceOptions();
      this.updateSettledToggleVisibility();
    });
    this.setupFocusTrap("transactionModal");
    this.setupFocusTrap("searchModal");
  }


  // Cleanup method to remove event listeners (call when destroying UI)
  destroy() {
    if (this._boundWindowClickHandler) {
      window.removeEventListener("click", this._boundWindowClickHandler);
      this._boundWindowClickHandler = null;
    }
    if (this._boundEscapeHandler) {
      document.removeEventListener("keydown", this._boundEscapeHandler);
      this._boundEscapeHandler = null;
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


  updateSettledToggleVisibility() {
    const type = document.getElementById("transactionType").value;
    const label = document.getElementById("settledToggleLabel");
    if (label) {
      label.style.display = (type === "expense") ? "" : "none";
    }
  }


  formatShortDisplayDate(dateString) {
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-");
    return `${month}-${day}-${year.slice(2)}`;
  }


  updateRecurrenceOptions() {
    const recurrenceType = document.getElementById("transactionRecurrence").value;
    const existingOptions = document.getElementById("advancedRecurrenceOptions");
    if (existingOptions) {
      existingOptions.remove();
    }

    if (recurrenceType === "once") {
      return;
    }
    const advancedOptions = document.createElement("div");
    advancedOptions.id = "advancedRecurrenceOptions";
    advancedOptions.className = "advanced-recurrence-options";
    if (recurrenceType === "monthly") {
      this.addDaySpecificOptions(advancedOptions);
    } else if (recurrenceType === "semi-monthly") {
      Utils.buildSemiMonthlyOptions(advancedOptions, '');
    } else if (recurrenceType === "custom") {
      Utils.buildCustomIntervalOptions(advancedOptions, '');
    }
    Utils.buildBusinessDayOptions(advancedOptions, '');
    Utils.buildVariableAmountOptions(advancedOptions, '');
    Utils.buildEndConditionOptions(advancedOptions, '');
    const transactionForm = document.getElementById("transactionForm");
    transactionForm.appendChild(advancedOptions);
  }


  addDaySpecificOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", "daySpecificOption");
    label.textContent = "Day pattern:";

    const daySpecificSelect = document.createElement("select");
    daySpecificSelect.id = "daySpecificOption";
    daySpecificSelect.name = "daySpecificOption";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Same day each month";
    daySpecificSelect.appendChild(defaultOption);
    Utils.DAY_SPECIFIC_OPTIONS.forEach(option => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      daySpecificSelect.appendChild(optionElement);
    });

    group.appendChild(label);
    group.appendChild(daySpecificSelect);
    container.appendChild(group);
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
    if (transactionRecurrence) transactionRecurrence.value = "once";

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

      transactionDescriptionInput.style.display = "";
      transactionDate.value = date;
      const formattedDate = Utils.formatDisplayDate(date);

      modalDate.textContent = formattedDate;

      const modalBalance = document.getElementById("modalBalance");
      if (modalBalance && this.calculationService) {
        const balance = this.calculationService.getRunningBalanceForDate(date);
        modalBalance.textContent = `Balance: $${balance.toFixed(2)}`;
        modalBalance.className = balance < 0 ? "modal-balance negative" : "modal-balance";
      }

      modalTransactions.innerHTML = "";
      transactionType.innerHTML = `
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="balance">Balance</option>
      `;
      const transactions = this.store.getTransactions();
      const hasBalanceTransaction = transactions[date]?.some(
        (t) => t.type === "balance" && t.hidden !== true
      );
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
              if (recurringTransaction.variableAmount) {
                additionalInfo += ` (Variable: ${recurringTransaction.variablePercentage}% change)`;
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
          if (isSkipped) {
            amountSpan.classList.add("skipped");
          }
          amountSpan.style.opacity = isSkipped ? "0.5" : "1";
          const isUnsettled = normalizedType === "expense" && t.settled === false;
          if (isUnsettled) {
            transactionDiv.classList.add("unsettled-transaction");
          }
          let statusLabel = "";
          if (isSkipped) {
            statusLabel = " (Skipped)";
          } else if (isHidden) {
            statusLabel = " (Hidden - Debt Snowball)";
          } else if (isUnsettled) {
            statusLabel = " (Unsettled)";
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

          const editBtn = document.createElement("span");
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

          const deleteBtn = document.createElement("span");
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

          // Add Settle/Unsettle button for expenses
          let settleBtn = null;
          if (normalizedType === "expense" && !isSkipped && (!isRecurring || t.settled !== undefined)) {
            settleBtn = document.createElement("span");
            settleBtn.className = "settle-btn";
            settleBtn.setAttribute("role", "button");
            settleBtn.setAttribute("tabindex", "0");
            settleBtn.setAttribute("aria-label", t.settled === false ? "Settle expense" : "Unsettle expense");
            settleBtn.textContent = t.settled === false ? "Settle" : "Unsettle";
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

          const saveButton = document.createElement("button");
          saveButton.setAttribute("aria-label", "Save changes");
          saveButton.textContent = "Save";
          saveButton.addEventListener("click", () => {
            this.saveEdit(date, index);
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

          editBtn.addEventListener("click", () =>
            this.showEditForm(date, index)
          );
          editBtn.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              this.showEditForm(date, index);
            }
          });
          deleteBtn.addEventListener("click", () =>
            this.deleteTransaction(date, index)
          );
          deleteBtn.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              this.deleteTransaction(date, index);
            }
          });
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

          if (settleBtn) {
            const toggleSettled = () => {
              const newSettled = t.settled === false ? true : false;
              this.store.setTransactionSettled(date, index, newSettled);
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

      // Show carried-forward unsettled transactions on past/present dates
      const today = new Date();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
      if (date <= todayString) {
        const unsettled = this.store.getUnsettledTransactions().filter(
          (u) => u.date < date
        );
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
                // Recurring: settle in-place, mark as modified instance
                const transactions = this.store.getTransactions()[u.date] || [];
                const currentIndex = transactions.findIndex(t =>
                  t.recurringId === u.transaction.recurringId && t.settled === false
                );
                if (currentIndex === -1) {
                  Utils.showNotification("Error: Original transaction not found", "error");
                  this.showTransactionDetails(date);
                  return;
                }
                this.store.setTransactionSettled(u.date, currentIndex, true);
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
                this.store.addTransaction(date, {
                  amount: u.transaction.amount,
                  type: u.transaction.type,
                  description: u.transaction.description,
                  settled: true,
                });
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
                this.store.deleteTransaction(u.date, currentIndex);
                this.showTransactionDetails(date);
                this._notifyChange();
                Utils.showNotification("Transaction deleted");
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
  }


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
  }


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
      const modalBalance = document.getElementById("modalBalance");
      if (modalBalance && this.calculationService) {
        const balance = this.calculationService.getRunningBalanceForDate(date);
        modalBalance.textContent = `Balance: $${balance.toFixed(2)}`;
        modalBalance.className = balance < 0 ? "modal-balance negative" : "modal-balance";
      }
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
  }


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
  }


  saveEdit(date, index) {
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

    if (isNaN(amount) || amount <= 0) {
      Utils.showNotification("Please enter a valid amount (must be greater than 0)", "error");
      return;
    }

    const transactions = this.store.getTransactions();
    if (!transactions[date] || !transactions[date][index]) {
      console.error(`Transaction not found: date=${date}, index=${index}`);
      Utils.showNotification("Error: Transaction not found", "error");
      return;
    }

    const transaction = transactions[date][index];
    const isRecurring = transaction.recurringId !== undefined;

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

        this.recurringManager.editTransaction(
          date,
          index,
          { amount, type, description },
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
          if (transaction.settled !== undefined) {
            movedTransaction.settled = transaction.settled;
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
            this.store.deleteTransaction(date, index);
          } else {
            // Moving to a different date — update move info
            this.store.moveTransaction(
              transaction.originalRecurringId,
              transaction.movedFrom,
              newDate
            );
            this.store.deleteTransaction(date, index);
            const reMovedTransaction = {
              amount,
              type,
              description,
              movedFrom: transaction.movedFrom,
              originalRecurringId: transaction.originalRecurringId
            };
            if (transaction.settled !== undefined) {
              reMovedTransaction.settled = transaction.settled;
            }
            this.store.addTransaction(newDate, reMovedTransaction);
          }
        } else {
          // Regular one-time transaction
          this.store.deleteTransaction(date, index);
          const newTransaction = { amount, type, description };
          // Preserve settled status for expenses
          if (transaction.settled !== undefined) {
            newTransaction.settled = transaction.settled;
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
  }


  async deleteTransaction(date, index) {
    const transactions = this.store.getTransactions();
    if (!transactions[date] || !transactions[date][index]) {
      console.error(`Transaction not found: date=${date}, index=${index}`);
      Utils.showNotification("Error: Transaction not found", "error");
      return;
    }

    const transaction = transactions[date][index];

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

      this.recurringManager.deleteTransaction(date, index, confirmDelete);
    } else {
      const sign = transaction.type === "balance" ? "=" : transaction.type === "income" ? "+" : "-";
      const descPart = transaction.description ? `${transaction.description} – ` : "";
      const shouldDelete = await Utils.showModalConfirm(
        `Are you sure you want to delete this transaction?\n\n${descPart}${sign}$${transaction.amount.toFixed(2)}`,
        "Delete Transaction",
        { confirmText: "Delete", cancelText: "Cancel" }
      );
      if (!shouldDelete) {
        return;
      }
      this.store.deleteTransaction(date, index);
    }

    this.showTransactionDetails(date);
    this._notifyChange();

    Utils.showNotification("Transaction deleted successfully");
  }


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
  }


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
  }


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
      const type = typeElement.value;
      const description = descriptionElement.value;
      const recurrence = recurrenceElement.value;
      if (!date || isNaN(amount) || amount <= 0) {
        Utils.showNotification(
          "Please enter a valid date and amount (must be greater than 0)",
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
      if (recurrence === "once") {
        const newTransaction = {
          amount: amount,
          type: type,
          description: description,
        };
        if (type === "expense") {
          newTransaction.settled = document.getElementById("transactionSettled").checked;
        }
        if (type === "balance") {
          const transactions = this.store.getTransactions();
          if (transactions[date]) {
            transactions[date] = transactions[date].filter(
              (t) => t.type !== "balance"
            );
            if (transactions[date].length === 0) {
              delete transactions[date];
            }
            this.store.saveData();
          }

          // Auto-settle any unsettled transactions carried forward to this date
          const unsettled = this.store.getUnsettledTransactions();
          unsettled.forEach(({ date: uDate, index }) => {
            if (uDate <= date) {
              this.store.setTransactionSettled(uDate, index, true);
            }
          });
        }

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
          newRecurringTransaction.settled = document.getElementById("transactionSettled").checked;
        }
        this.addAdvancedRecurringOptions(newRecurringTransaction);

        const recurringId = this.store.addRecurringTransaction(
          newRecurringTransaction
        );
        this.recurringManager.invalidateCache();
        const firstInstance = {
          amount: amount,
          type: type,
          description: description,
          recurringId: recurringId,
        };
        if (type === "expense") {
          firstInstance.settled = newRecurringTransaction.settled !== false;
        }

        this.store.addTransaction(date, firstInstance);
      }
      document.getElementById("transactionAmount").value = "";
      document.getElementById("transactionDescription").value = "";
      document.getElementById("transactionRecurrence").value = "once";
      document.getElementById("transactionSettled").checked = true;
      document.getElementById("settledToggleLabel").style.display = "none";
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
  }


  addAdvancedRecurringOptions(recurringTransaction) {
    const advancedOptions = document.getElementById("advancedRecurrenceOptions");
    if (!advancedOptions) {
      return;
    }
    if (recurringTransaction.recurrence === "monthly") {
      const daySpecificOption = document.getElementById("daySpecificOption");
      if (daySpecificOption && daySpecificOption.value) {
        recurringTransaction.daySpecific = true;
        recurringTransaction.daySpecificData = daySpecificOption.value;
      }
    }
    if (recurringTransaction.recurrence === "semi-monthly") {
      const firstDay = document.getElementById("semiMonthlyFirstDay");
      const secondDay = document.getElementById("semiMonthlySecondDay");

      if (firstDay && secondDay) {
        const days = [];
        days.push(parseInt(firstDay.value, 10));

        if (secondDay.value === "last") {
          recurringTransaction.semiMonthlyLastDay = true;
          days.push(31);
        } else {
          days.push(parseInt(secondDay.value, 10));
        }

        recurringTransaction.semiMonthlyDays = days;
      }
    }
    if (recurringTransaction.recurrence === "custom") {
      const intervalValue = document.getElementById("customIntervalValue");
      const intervalUnit = document.getElementById("customIntervalUnit");

      if (intervalValue && intervalUnit) {
        recurringTransaction.customInterval = {
          value: parseInt(intervalValue.value, 10),
          unit: intervalUnit.value
        };
      }
    }
    const businessDayAdjustment = document.getElementById("businessDayAdjustment");
    if (businessDayAdjustment) {
      recurringTransaction.businessDayAdjustment = businessDayAdjustment.value;
    }
    const variableAmountCheck = document.getElementById("variableAmountCheck");
    if (variableAmountCheck && variableAmountCheck.checked) {
      const variablePercentage = document.getElementById("variablePercentage");
      if (variablePercentage) {
        recurringTransaction.variableAmount = true;
        recurringTransaction.variableType = "percentage";
        recurringTransaction.variablePercentage = parseFloat(variablePercentage.value);
      }
    }
    const endConditionRadios = document.querySelectorAll('input[name="endCondition"]');
    for (const radio of endConditionRadios) {
      if (radio.checked) {
        if (radio.value === "date") {
          const endDate = document.getElementById("endDate");
          if (endDate && endDate.value) {
            recurringTransaction.endDate = endDate.value;
          }
        } else if (radio.value === "occurrence") {
          const maxOccurrences = document.getElementById("maxOccurrences");
          if (maxOccurrences) {
            recurringTransaction.maxOccurrences = parseInt(maxOccurrences.value, 10);
          }
        }
        break;
      }
    }
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
