// Transaction UI

class TransactionUI {
  
  constructor(store, recurringManager, onUpdate, cloudSync = null) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onUpdate = onUpdate;
    this.cloudSync = cloudSync;
    this.daySpecificOptions = [
      { value: "1-0", label: "First Sunday" },
      { value: "1-1", label: "First Monday" },
      { value: "1-2", label: "First Tuesday" },
      { value: "1-3", label: "First Wednesday" },
      { value: "1-4", label: "First Thursday" },
      { value: "1-5", label: "First Friday" },
      { value: "1-6", label: "First Saturday" },
      { value: "2-0", label: "Second Sunday" },
      { value: "2-1", label: "Second Monday" },
      { value: "2-2", label: "Second Tuesday" },
      { value: "2-3", label: "Second Wednesday" },
      { value: "2-4", label: "Second Thursday" },
      { value: "2-5", label: "Second Friday" },
      { value: "2-6", label: "Second Saturday" },
      { value: "3-0", label: "Third Sunday" },
      { value: "3-1", label: "Third Monday" },
      { value: "3-2", label: "Third Tuesday" },
      { value: "3-3", label: "Third Wednesday" },
      { value: "3-4", label: "Third Thursday" },
      { value: "3-5", label: "Third Friday" },
      { value: "3-6", label: "Third Saturday" },
      { value: "4-0", label: "Fourth Sunday" },
      { value: "4-1", label: "Fourth Monday" },
      { value: "4-2", label: "Fourth Tuesday" },
      { value: "4-3", label: "Fourth Wednesday" },
      { value: "4-4", label: "Fourth Thursday" },
      { value: "4-5", label: "Fourth Friday" },
      { value: "4-6", label: "Fourth Saturday" },
      { value: "-1-0", label: "Last Sunday" },
      { value: "-1-1", label: "Last Monday" },
      { value: "-1-2", label: "Last Tuesday" },
      { value: "-1-3", label: "Last Wednesday" },
      { value: "-1-4", label: "Last Thursday" },
      { value: "-1-5", label: "Last Friday" },
      { value: "-1-6", label: "Last Saturday" }
    ];

    this.initEventListeners();
  }

  
  initEventListeners() {
    document.querySelectorAll(".close").forEach((closeBtn) => {
      closeBtn.onclick = () => {
        this.closeModals();
      };
    });
    window.onclick = (event) => {
      const transactionModal = document.getElementById("transactionModal");
      const searchModal = document.getElementById("searchModal");
      if (event.target == transactionModal || event.target == searchModal) {
        this.closeModals();
      }
    };
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        this.closeModals();
      }
    });
    const transactionType = document.getElementById("transactionType");
    const recurrenceSelect = document.getElementById("transactionRecurrence");
    const transactionDescription = document.getElementById("transactionDescription");

    transactionType.addEventListener("change", function () {
      if (this.value === "balance") {
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
    });
    document.getElementById("transactionRecurrence").addEventListener("change", () => {
      this.updateRecurrenceOptions();
    });
    this.setupFocusTrap("transactionModal");
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
      this.addSemiMonthlyOptions(advancedOptions);
    } else if (recurrenceType === "custom") {
      this.addCustomIntervalOptions(advancedOptions);
    }
    this.addBusinessDayOptions(advancedOptions);
    this.addVariableAmountOptions(advancedOptions);
    this.addEndConditionOptions(advancedOptions);
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
    this.daySpecificOptions.forEach(option => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      daySpecificSelect.appendChild(optionElement);
    });
    
    group.appendChild(label);
    group.appendChild(daySpecificSelect);
    container.appendChild(group);
  }
  
  
  addSemiMonthlyOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    
    const label = document.createElement("label");
    label.setAttribute("for", "semiMonthlyDays");
    label.textContent = "Days of month:";
    
    const helpText = document.createElement("span");
    helpText.className = "help-text";
    helpText.textContent = "Select two days of the month";
    const firstDaySelect = document.createElement("select");
    firstDaySelect.id = "semiMonthlyFirstDay";
    firstDaySelect.name = "semiMonthlyFirstDay";
    const secondDaySelect = document.createElement("select");
    secondDaySelect.id = "semiMonthlySecondDay";
    secondDaySelect.name = "semiMonthlySecondDay";
    for (let i = 1; i <= 28; i++) {
      const firstOption = document.createElement("option");
      firstOption.value = i;
      firstOption.textContent = i;
      firstDaySelect.appendChild(firstOption);
      
      const secondOption = document.createElement("option");
      secondOption.value = i;
      secondOption.textContent = i;
      secondDaySelect.appendChild(secondOption);
    }
    const lastDayOption = document.createElement("option");
    lastDayOption.value = "last";
    lastDayOption.textContent = "Last day";
    secondDaySelect.appendChild(lastDayOption);
    firstDaySelect.value = 1;
    secondDaySelect.value = 15;
    
    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(firstDaySelect);
    group.appendChild(document.createTextNode(" and "));
    group.appendChild(secondDaySelect);
    group.appendChild(document.createElement("br"));
    group.appendChild(helpText);
    
    container.appendChild(group);
  }
  
  
  addCustomIntervalOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    
    const label = document.createElement("label");
    label.setAttribute("for", "customIntervalValue");
    label.textContent = "Repeat every:";
    
    const intervalValue = document.createElement("input");
    intervalValue.type = "number";
    intervalValue.id = "customIntervalValue";
    intervalValue.name = "customIntervalValue";
    intervalValue.min = "1";
    intervalValue.value = "1";
    intervalValue.style.width = "60px";
    
    const intervalUnit = document.createElement("select");
    intervalUnit.id = "customIntervalUnit";
    intervalUnit.name = "customIntervalUnit";
    
    const unitOptions = [
      { value: "days", label: "Day(s)" },
      { value: "weeks", label: "Week(s)" },
      { value: "months", label: "Month(s)" }
    ];
    
    unitOptions.forEach(option => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      intervalUnit.appendChild(optionElement);
    });
    
    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(intervalValue);
    group.appendChild(document.createTextNode(" "));
    group.appendChild(intervalUnit);
    
    container.appendChild(group);
  }
  
  
  addBusinessDayOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    
    const label = document.createElement("label");
    label.setAttribute("for", "businessDayAdjustment");
    label.textContent = "When transaction falls on weekend:";
    
    const adjustmentSelect = document.createElement("select");
    adjustmentSelect.id = "businessDayAdjustment";
    adjustmentSelect.name = "businessDayAdjustment";
    
    const adjustmentOptions = [
      { value: "none", label: "No adjustment" },
      { value: "previous", label: "Move to previous business day" },
      { value: "next", label: "Move to next business day" },
      { value: "nearest", label: "Move to nearest business day" }
    ];
    
    adjustmentOptions.forEach(option => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      adjustmentSelect.appendChild(optionElement);
    });
    
    group.appendChild(label);
    group.appendChild(document.createElement("br"));
    group.appendChild(adjustmentSelect);
    
    container.appendChild(group);
  }
  
  
  addVariableAmountOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    const checkboxDiv = document.createElement("div");
    
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = "variableAmountCheck";
    checkbox.name = "variableAmountCheck";
    
    const checkboxLabel = document.createElement("label");
    checkboxLabel.setAttribute("for", "variableAmountCheck");
    checkboxLabel.textContent = "Amount changes over time";
    
    checkboxDiv.appendChild(checkbox);
    checkboxDiv.appendChild(checkboxLabel);
    const variableOptions = document.createElement("div");
    variableOptions.id = "variableAmountOptions";
    variableOptions.style.display = "none";
    variableOptions.style.marginTop = "10px";
    
    const percentLabel = document.createElement("label");
    percentLabel.setAttribute("for", "variablePercentage");
    percentLabel.textContent = "Percentage change per occurrence:";
    
    const percentInput = document.createElement("input");
    percentInput.type = "number";
    percentInput.id = "variablePercentage";
    percentInput.name = "variablePercentage";
    percentInput.step = "0.1";
    percentInput.value = "0";
    percentInput.style.width = "60px";
    
    const percentSign = document.createElement("span");
    percentSign.textContent = "%";
    
    variableOptions.appendChild(percentLabel);
    variableOptions.appendChild(document.createElement("br"));
    variableOptions.appendChild(percentInput);
    variableOptions.appendChild(percentSign);
    checkbox.addEventListener("change", function() {
      variableOptions.style.display = this.checked ? "block" : "none";
    });
    
    group.appendChild(checkboxDiv);
    group.appendChild(variableOptions);
    
    container.appendChild(group);
  }
  
  
  addEndConditionOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";
    
    const label = document.createElement("label");
    label.textContent = "End condition:";
    const radioGroup = document.createElement("div");
    radioGroup.className = "radio-group";
    const noEndRadioDiv = document.createElement("div");
    
    const noEndRadio = document.createElement("input");
    noEndRadio.type = "radio";
    noEndRadio.id = "endConditionNone";
    noEndRadio.name = "endCondition";
    noEndRadio.value = "none";
    noEndRadio.checked = true;
    
    const noEndLabel = document.createElement("label");
    noEndLabel.setAttribute("for", "endConditionNone");
    noEndLabel.textContent = "No end date";
    
    noEndRadioDiv.appendChild(noEndRadio);
    noEndRadioDiv.appendChild(noEndLabel);
    const endDateRadioDiv = document.createElement("div");
    
    const endDateRadio = document.createElement("input");
    endDateRadio.type = "radio";
    endDateRadio.id = "endConditionDate";
    endDateRadio.name = "endCondition";
    endDateRadio.value = "date";
    
    const endDateLabel = document.createElement("label");
    endDateLabel.setAttribute("for", "endConditionDate");
    endDateLabel.textContent = "End by date:";
    
    const endDateInput = document.createElement("input");
    endDateInput.type = "date";
    endDateInput.id = "endDate";
    endDateInput.name = "endDate";
    endDateInput.disabled = true;
    
    endDateRadioDiv.appendChild(endDateRadio);
    endDateRadioDiv.appendChild(endDateLabel);
    endDateRadioDiv.appendChild(document.createElement("br"));
    endDateRadioDiv.appendChild(endDateInput);
    const endOccurrenceRadioDiv = document.createElement("div");
    
    const endOccurrenceRadio = document.createElement("input");
    endOccurrenceRadio.type = "radio";
    endOccurrenceRadio.id = "endConditionOccurrence";
    endOccurrenceRadio.name = "endCondition";
    endOccurrenceRadio.value = "occurrence";
    
    const endOccurrenceLabel = document.createElement("label");
    endOccurrenceLabel.setAttribute("for", "endConditionOccurrence");
    endOccurrenceLabel.textContent = "End after:";
    
    const endOccurrenceInput = document.createElement("input");
    endOccurrenceInput.type = "number";
    endOccurrenceInput.id = "maxOccurrences";
    endOccurrenceInput.name = "maxOccurrences";
    endOccurrenceInput.min = "1";
    endOccurrenceInput.value = "12";
    endOccurrenceInput.style.width = "60px";
    endOccurrenceInput.disabled = true;
    
    const occurrencesText = document.createElement("span");
    occurrencesText.textContent = " occurrences";
    
    endOccurrenceRadioDiv.appendChild(endOccurrenceRadio);
    endOccurrenceRadioDiv.appendChild(endOccurrenceLabel);
    endOccurrenceRadioDiv.appendChild(endOccurrenceInput);
    endOccurrenceRadioDiv.appendChild(occurrencesText);
    noEndRadio.addEventListener("change", function() {
      if (this.checked) {
        endDateInput.disabled = true;
        endOccurrenceInput.disabled = true;
      }
    });
    
    endDateRadio.addEventListener("change", function() {
      if (this.checked) {
        endDateInput.disabled = false;
        endOccurrenceInput.disabled = true;
      }
    });
    
    endOccurrenceRadio.addEventListener("change", function() {
      if (this.checked) {
        endDateInput.disabled = true;
        endOccurrenceInput.disabled = false;
      }
    });
    
    radioGroup.appendChild(noEndRadioDiv);
    radioGroup.appendChild(endDateRadioDiv);
    radioGroup.appendChild(endOccurrenceRadioDiv);
    
    group.appendChild(label);
    group.appendChild(radioGroup);
    
    container.appendChild(group);
  }

  
  closeModals() {
    document.getElementById("transactionModal").style.display = "none";
    document.getElementById("searchModal").style.display = "none";
    document.getElementById("transactionAmount").value = "";
    document.getElementById("transactionDescription").value = "";
    document.getElementById("transactionRecurrence").value = "once";
    const advancedOptions = document.getElementById("advancedRecurrenceOptions");
    if (advancedOptions) {
      advancedOptions.remove();
    }
    document
      .getElementById("transactionModal")
      .setAttribute("aria-hidden", "true");
    document.getElementById("searchModal").setAttribute("aria-hidden", "true");
  }

  
  showTransactionDetails(date) {
    try {
      console.log('Opening transaction modal for date:', date);
      
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
      modalTransactions.innerHTML = "";
      transactionType.innerHTML = `
        <option value="expense">Expense</option>
        <option value="income">Income</option>
        <option value="balance">Balance</option>
      `;
      const transactions = this.store.getTransactions();
      const hasBalanceTransaction = transactions[date]?.some(
        (t) => t.type === "balance"
      );
      if (transactions[date]) {
        transactions[date].forEach((t, index) => {
          const transactionDiv = document.createElement("div");
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
                const dayOption = this.daySpecificOptions.find(
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
          transactionDiv.innerHTML = `
            <span class="${t.type} ${
            isSkipped ? "skipped" : ""
          }" style="opacity: ${isSkipped ? "0.5" : "1"}">
              ${t.type === "balance" ? "=" : t.type === "income" ? "+" : "-"}
              $${t.amount.toFixed(2)}
              ${isSkipped ? " (Skipped)" : ""}
            </span>
            ${t.description ? ` - ${t.description}` : ""}
            ${
              isRecurring
                ? ` (Recurring${recurrenceType ? " " + recurrenceType : ""}${additionalInfo})`
                : ""
            }
            <span class="edit-btn" role="button" tabindex="0" 
                  aria-label="Edit ${t.type} of $${t.amount.toFixed(2)} ${
            t.description ? t.description : ""
          }">Edit</span>
            <span class="delete-btn" role="button" tabindex="0"
                  aria-label="Delete ${t.type} of $${t.amount.toFixed(2)} ${
            t.description ? t.description : ""
          }">Delete</span>
            ${
              isRecurring
                ? `
              <span class="skip-btn" role="button" tabindex="0"
                    aria-label="${isSkipped ? "Unskip" : "Skip"} recurring ${
                    t.type
                  }">
                ${isSkipped ? "Unskip" : "Skip"}
              </span>
            `
                : ""
            }
            <div class="edit-form" id="edit-form-${date}-${index}" style="display: none;">
              <input type="number" id="edit-amount-${date}-${index}" 
                     value="${t.amount}" step="0.01" min="0" aria-label="Amount">
              <select id="edit-type-${date}-${index}" aria-label="Type">
                <option value="expense" ${
                  t.type === "expense" ? "selected" : ""
                }>Expense</option>
                <option value="income" ${
                  t.type === "income" ? "selected" : ""
                }>Income</option>
                <option value="balance" ${
                  t.type === "balance" ? "selected" : ""
                }>Balance</option>
              </select>
              <input type="text" id="edit-description-${date}-${index}" 
                     value="${
                       t.description || ""
                     }" placeholder="Description" aria-label="Description">
              ${
                isRecurring && t.type !== "balance"
                  ? `
                <select id="edit-recurrence-${date}-${index}" aria-label="Edit scope">
                  <option value="this">Edit this occurrence only</option>
                  <option value="future">Edit this and future occurrences</option>
                  <option value="all">Edit all occurrences</option>
                </select>
              `
                  : ""
              }
              <button aria-label="Save changes" 
                      onclick="app.transactionUI.saveEdit('${date}', ${index})">Save</button>
              <button aria-label="Cancel editing" 
                      onclick="document.getElementById('edit-form-${date}-${index}').style.display='none'">
                Cancel
              </button>
            </div>
          `;
          const editBtn = transactionDiv.querySelector(".edit-btn");
          const deleteBtn = transactionDiv.querySelector(".delete-btn");
          const skipBtn = transactionDiv.querySelector(".skip-btn");
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
              this.deleteTransaction(date, index)
            );
            deleteBtn.addEventListener("keydown", (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                this.deleteTransaction(date, index);
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

          modalTransactions.appendChild(transactionDiv);
        });
      } else {
        modalTransactions.innerHTML = "<p>No transactions for this date.</p>";
      }
      const recurrenceSelect = document.getElementById("transactionRecurrence");
      if (transactionType.value === "balance") {
        recurrenceSelect.value = "once";
        recurrenceSelect.style.display = "none";
      } else {
        recurrenceSelect.style.display = "";
      }
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
        alert("Transaction modal not found!");
        return;
      }
      const modalDate = document.getElementById("modalDate");
      if (modalDate) {
        modalDate.textContent = Utils.formatDisplayDate(date);
      }
      const transactionDate = document.getElementById("transactionDate");
      if (transactionDate) {
        transactionDate.value = date;
      }
      modal.style.display = "block";
      modal.setAttribute("aria-hidden", "false");
      const modalTransactions = document.getElementById("modalTransactions");
      if (modalTransactions) {
        const transactions = this.store.getTransactions();
        if (transactions[date] && transactions[date].length > 0) {
          let html = "";
          transactions[date].forEach(t => {
            html += `<div>
              ${t.type === "balance" ? "=" : t.type === "income" ? "+" : "-"}
              $${t.amount.toFixed(2)}
              ${t.description ? ` - ${t.description}` : ""}
            </div>`;
          });
          modalTransactions.innerHTML = html;
        } else {
          modalTransactions.innerHTML = "<p>No transactions for this date.</p>";
        }
      }
    } catch (error) {
      console.error("Fallback modal opening failed:", error);
      alert("Could not open transaction details. Please check the console for errors.");
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

    if (isNaN(amount) || amount <= 0) {
      Utils.showNotification("Please enter a valid amount", "error");
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

    let editScope = "this";
    if (isRecurring && transaction.type !== "balance") {
      const editRecurrenceElement = document.getElementById(`edit-recurrence-${date}-${index}`);
      if (editRecurrenceElement) {
        editScope = editRecurrenceElement.value;
      }
    }

    try {
      this.recurringManager.editTransaction(
        date,
        index,
        {
          amount,
          type,
          description,
        },
        editScope
      );

      this.showTransactionDetails(date);
      this.onUpdate();
      if (this.cloudSync) {
        this.cloudSync.scheduleCloudSave();
      }

      Utils.showNotification("Transaction updated successfully");
    } catch (error) {
      console.error("Error saving edit:", error);
      Utils.showNotification("Error updating transaction", "error");
    }
  }

  
  deleteTransaction(date, index) {
    const transactions = this.store.getTransactions();
    if (!transactions[date] || !transactions[date][index]) {
      console.error(`Transaction not found: date=${date}, index=${index}`);
      Utils.showNotification("Error: Transaction not found", "error");
      return;
    }
    
    const transaction = transactions[date][index];

    if (transaction.recurringId) {
      const confirmDelete = confirm(
        "Do you want to delete just this occurrence or all future occurrences?\n\n" +
          "OK = Delete all future occurrences\n" +
          "Cancel = Delete only this occurrence"
      );

      this.recurringManager.deleteTransaction(date, index, confirmDelete);
    } else {
      if (confirm("Are you sure you want to delete this transaction?")) {
        this.store.deleteTransaction(date, index);
      } else {
        return;
      }
    }

    this.showTransactionDetails(date);
    this.onUpdate();
    if (this.cloudSync) {
      this.cloudSync.scheduleCloudSave();
    }

    Utils.showNotification("Transaction deleted successfully");
  }

  
  toggleSkipTransaction(date, recurringId) {
    const isSkipped = this.recurringManager.isTransactionSkipped(
      date,
      recurringId
    );
    const newStatus = this.recurringManager.toggleSkipTransaction(
      date,
      recurringId
    );

    this.showTransactionDetails(date);
    this.onUpdate();
    if (this.cloudSync) {
      this.cloudSync.scheduleCloudSave();
    }

    Utils.showNotification(
      `Transaction ${newStatus ? "skipped" : "unskipped"} successfully`
    );
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
      if (!date || isNaN(amount) || amount < 0) {
        Utils.showNotification(
          "Please enter a valid date and amount (must be 0 or greater)",
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
        this.addAdvancedRecurringOptions(newRecurringTransaction);

        const recurringId = this.store.addRecurringTransaction(
          newRecurringTransaction
        );
        const firstInstance = {
          amount: amount,
          type: type,
          description: description,
          recurringId: recurringId,
        };

        this.store.addTransaction(date, firstInstance);
      }
      document.getElementById("transactionAmount").value = "";
      document.getElementById("transactionDescription").value = "";
      document.getElementById("transactionRecurrence").value = "once";
      const advancedOptions = document.getElementById("advancedRecurrenceOptions");
      if (advancedOptions) {
        advancedOptions.remove();
      }
      document.getElementById("transactionModal").style.display = "none";
      document
        .getElementById("transactionModal")
        .setAttribute("aria-hidden", "true");
      this.onUpdate();
      if (this.cloudSync) {
        this.cloudSync.scheduleCloudSave();
      }
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

  
  capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
