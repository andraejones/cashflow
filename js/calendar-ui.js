/**
 * CalendarUI - Manages calendar display and interaction
 */
class CalendarUI {
  /**
   * Create a new CalendarUI
   * @param {TransactionStore} store - The transaction store
   * @param {RecurringTransactionManager} recurringManager - Recurring transaction manager
   * @param {CalculationService} calculationService - Calculation service
   * @param {TransactionUI} transactionUI - Transaction UI manager
   */
  constructor(store, recurringManager, calculationService, transactionUI) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.calculationService = calculationService;
    this.transactionUI = transactionUI;
    this.currentDate = new Date();

    // Initialize event listeners
    this.initEventListeners();
  }

  /**
   * Initialize event listeners
   */
  initEventListeners() {
    // Previous month button
    document.getElementById("prevMonth").addEventListener("click", () => {
      this.changeMonth(-1);
    });

    // Next month button
    document.getElementById("nextMonth").addEventListener("click", () => {
      this.changeMonth(1);
    });

    // Initialize event listeners for cleaning up any HTML artifacts
    this.cleanUpHtmlArtifacts();
  }

  /**
   * Clean up any HTML artifacts that may be showing as text
   */
  cleanUpHtmlArtifacts() {
    // Look for text nodes with HTML content and remove them
    const bodyChildren = document.body.childNodes;
    for (let i = 0; i < bodyChildren.length; i++) {
      const node = bodyChildren[i];
      if (node.nodeType === Node.TEXT_NODE && 
          (node.textContent.includes("<div") || 
          node.textContent.includes("modal-content"))) {
        document.body.removeChild(node);
        i--; // Adjust for the removed node
      }
    }
  }

  /**
   * Generate calendar for current month
   */
  generateCalendar() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

    const currentMonthElement = document.getElementById("currentMonth");
    const today = new Date();

    // Set month display and behavior
    if (year === today.getFullYear() && month === today.getMonth()) {
      currentMonthElement.textContent = `${monthNames[month]} ${year}`;
      currentMonthElement.onclick = null;
      currentMonthElement.style.cursor = "default";
    } else {
      currentMonthElement.textContent = `${monthNames[month]} ${year} ⏎`;
      currentMonthElement.onclick = () => this.returnToCurrentMonth();
      currentMonthElement.style.cursor = "pointer";
    }

    // Apply recurring transactions for this month
    this.recurringManager.applyRecurringTransactions(year, month);

    // Calculate monthly balances - pass the current viewed date to ensure future months are calculated
    this.calculationService.updateMonthlyBalances(this.currentDate);

    // Get monthly summary
    const summary = this.calculationService.calculateMonthlySummary(
      year,
      month
    );

    // Get first day of month and number of days
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Clear calendar days
    const calendarDays = document.getElementById("calendarDays");
    calendarDays.innerHTML = "";

    // Add placeholder days for start of month
    for (let i = 0; i < firstDay; i++) {
      const day = document.createElement("div");
      day.classList.add("day", "other-month");
      calendarDays.appendChild(day);
    }

    // Initial balance is the starting balance for the month
    let runningBalance = summary.startingBalance;

    // Generate calendar days
    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.classList.add("day");
      day.innerHTML = `${i}<div class="day-content"></div>`;

      // Highlight current day
      if (
        year === today.getFullYear() &&
        month === today.getMonth() &&
        i === today.getDate()
      ) {
        day.classList.add("current");
      }

      // Format the date string
      const dateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${i
        .toString()
        .padStart(2, "0")}`;

      // Calculate daily totals
      const dailyTotals =
        this.calculationService.calculateDailyTotals(dateString);
      const transactions = this.store.getTransactions();
      const transactionCount = transactions[dateString]
        ? transactions[dateString].length
        : 0;

      // Update running balance if not explicitly set
      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance += dailyTotals.income - dailyTotals.expense;
      }

      // Populate day content
      day.querySelector(".day-content").innerHTML = `
        ${
          dailyTotals.income > 0
            ? `<div class="income">+${dailyTotals.income.toFixed(2)}</div>`
            : ""
        }
        ${
          dailyTotals.expense > 0
            ? `<div class="expense">-${dailyTotals.expense.toFixed(2)}</div>`
            : ""
        }
        <div class="balance">${runningBalance.toFixed(2)}</div>
        ${
          transactionCount > 0
            ? `<div class="transaction-count">(${transactionCount})</div>`
            : ""
        }
        ${
          dailyTotals.hasSkippedTransactions
            ? '<div class="skip-indicator">★</div>'
            : ""
        }
      `;

      // Add data attribute to help with debugging
      day.setAttribute('data-date', dateString);

      // Add click event with improved error handling for transaction details
      day.addEventListener("click", (event) => {
        event.stopPropagation(); // Prevent event bubbling
        console.log('Day clicked:', dateString);
        try {
          this.transactionUI.showTransactionDetails(dateString);
        } catch (error) {
          console.error("Error showing transaction details:", error);
          // Fallback method to open transaction modal manually
          this.openTransactionModalFallback(dateString);
        }
      });

      calendarDays.appendChild(day);
    }

    // Add placeholder days for end of month
    const remainingDays = 42 - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
      const day = document.createElement("div");
      day.classList.add("day", "other-month");
      day.innerHTML = `${i}<div class="day-content"></div>`;
      calendarDays.appendChild(day);
    }

    // Update monthly summary
    document.getElementById("monthSummary").innerHTML = `
      Monthly Summary: Starting Balance: $${summary.startingBalance.toFixed(
        2
      )} | 
      Income: $${summary.income.toFixed(2)} | 
      Expenses: $${summary.expense.toFixed(2)} | 
      Ending Balance: $${summary.endingBalance.toFixed(2)}
    `;

    // Update calendar options
    document.getElementById("calendarOptions").innerHTML = `
      <span class="calendar-option" onclick="app.searchUI.showSearchModal()">Search</span> | 
      <span class="calendar-option" onclick="app.exportData()">Save to Device</span> | 
      <span class="calendar-option" onclick="app.importData()">Load from Device</span> | 
      <span class="calendar-option" onclick="app.cloudSync.saveToCloud()">Save to Cloud</span> | 
      <span class="calendar-option" onclick="app.cloudSync.loadFromCloud()">Load from Cloud</span> | 
      <span class="calendar-option" onclick="app.resetData()">Reset</span>
    `;
  }

  /**
   * Fallback method to manually open the transaction modal
   * @param {string} date - Date string in YYYY-MM-DD format
   */
  openTransactionModalFallback(date) {
    const modal = document.getElementById("transactionModal");
    const dateInput = document.getElementById("transactionDate");
    const modalDate = document.getElementById("modalDate");
    
    if (!modal) {
      console.error('Transaction modal element not found');
      return;
    }
    
    // Set the date in the hidden input
    if (dateInput) {
      dateInput.value = date;
    }
    
    // Format the date for display
    if (modalDate) {
      modalDate.textContent = Utils.formatDisplayDate(date);
    }
    
    // Try to fetch transactions for the date
    const modalTransactions = document.getElementById("modalTransactions");
    if (modalTransactions) {
      const transactions = this.store.getTransactions();
      if (transactions[date] && transactions[date].length > 0) {
        let transactionsHtml = '';
        transactions[date].forEach((t) => {
          transactionsHtml += `
            <div>
              <span class="${t.type}">${t.type === "balance" ? "=" : t.type === "income" ? "+" : "-"}
              $${t.amount.toFixed(2)}</span>
              ${t.description ? ` - ${t.description}` : ""}
            </div>
          `;
        });
        modalTransactions.innerHTML = transactionsHtml;
      } else {
        modalTransactions.innerHTML = "<p>No transactions for this date.</p>";
      }
    }
    
    // Show the modal
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
  }

  /**
   * Change the current month
   * @param {number} delta - Number of months to change (positive or negative)
   */
  changeMonth(delta) {
    const newDate = new Date(
      this.currentDate.getFullYear(),
      this.currentDate.getMonth() + delta,
      1
    );

    // Allow navigation to any month (past or future)
    this.currentDate = newDate;
    this.generateCalendar();
  }

  /**
   * Return to the current month
   */
  returnToCurrentMonth() {
    this.currentDate = new Date();
    this.generateCalendar();
  }
}