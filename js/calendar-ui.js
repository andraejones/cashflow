// Calendar UI logic

class CalendarUI {

  constructor(
    store,
    recurringManager,
    calculationService,
    transactionUI,
    debtSnowball = null
  ) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.calculationService = calculationService;
    this.transactionUI = transactionUI;
    this.debtSnowball = debtSnowball;
    this.currentDate = new Date();

    // Track bound event handlers for cleanup
    this._boundDayClickHandler = null;

    this.initEventListeners();
  }


  initEventListeners() {
    document.getElementById("prevMonth").addEventListener("click", () => {
      this.changeMonth(-1);
    });
    document.getElementById("nextMonth").addEventListener("click", () => {
      this.changeMonth(1);
    });

    // Notes modal close button
    const notesModal = document.getElementById("notesModal");
    const notesCloseBtn = notesModal?.querySelector(".close");
    if (notesCloseBtn) {
      notesCloseBtn.addEventListener("click", () => this.hideNotesModal());
    }
    // Close notes modal when clicking outside
    if (notesModal) {
      notesModal.addEventListener("click", (e) => {
        if (e.target === notesModal) {
          this.hideNotesModal();
        }
      });
    }

    // Use event delegation for day clicks to avoid memory leaks
    const calendarDays = document.getElementById("calendarDays");
    if (calendarDays) {
      this._boundDayClickHandler = (event) => {
        const dayElement = event.target.closest('.day[data-date]');
        if (dayElement && !dayElement.classList.contains('other-month')) {
          const dateString = dayElement.getAttribute('data-date');
          if (dateString) {
            event.stopPropagation();
            try {
              this.transactionUI.showTransactionDetails(dateString);
            } catch (error) {
              console.error("Error showing transaction details:", error);
              this.openTransactionModalFallback(dateString);
            }
          }
        }
      };
      calendarDays.addEventListener("click", this._boundDayClickHandler);
    }

    this.cleanUpHtmlArtifacts();
  }


  // Cleanup method to remove event listeners
  destroy() {
    const calendarDays = document.getElementById("calendarDays");
    if (calendarDays && this._boundDayClickHandler) {
      calendarDays.removeEventListener("click", this._boundDayClickHandler);
      this._boundDayClickHandler = null;
    }
  }


  cleanUpHtmlArtifacts() {
    const bodyChildren = document.body.childNodes;
    for (let i = 0; i < bodyChildren.length; i++) {
      const node = bodyChildren[i];
      if (node.nodeType === Node.TEXT_NODE &&
        (node.textContent.includes("<div") ||
          node.textContent.includes("modal-content"))) {
        document.body.removeChild(node);
        i--;
      }
    }
  }


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
    const pendingMessage = currentMonthElement?.querySelector("#pendingMessage");
    if (pendingMessage) {
      pendingMessage.remove();
    }
    const today = new Date();
    if (year === today.getFullYear() && month === today.getMonth()) {
      currentMonthElement.textContent = `${monthNames[month]} ${year}`;
      currentMonthElement.onclick = null;
      currentMonthElement.style.cursor = "default";
    } else {
      currentMonthElement.textContent = `${monthNames[month]} ${year} ⏎`;
      currentMonthElement.onclick = () => this.returnToCurrentMonth();
      currentMonthElement.style.cursor = "pointer";
    }

    // Announce month change to screen readers
    Utils.announceToScreenReader(`Viewing ${monthNames[month]} ${year}`);
    if (pendingMessage) {
      currentMonthElement.appendChild(pendingMessage);
    }
    this.recurringManager.applyRecurringTransactions(year, month);
    if (this.debtSnowball) {
      this.debtSnowball.ensureSnowballPaymentForMonth(year, month);
    }
    this.calculationService.updateMonthlyBalances(this.currentDate);
    const summary = this.calculationService.calculateMonthlySummary(
      year,
      month
    );
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calendarDays = document.getElementById("calendarDays");
    calendarDays.innerHTML = "";
    for (let i = 0; i < firstDay; i++) {
      const day = document.createElement("div");
      day.classList.add("day", "other-month");
      calendarDays.appendChild(day);
    }
    let runningBalance = summary.startingBalance;

    // Calculate the end date of the 30-day unallocated range
    const unallocatedEndDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
    const unallocatedEndYear = unallocatedEndDate.getFullYear();
    const unallocatedEndMonth = unallocatedEndDate.getMonth();
    const unallocatedEndDay = unallocatedEndDate.getDate();

    // Find the day(s) with the lowest balance in the 30-day unallocated range
    // Calculate across the entire 30-day range (not just the displayed month)
    let lowestBalanceDates = [];
    let lowestBalance = Infinity;
    // Track first crisis (first day with balance ≤0) and all negative days
    let firstCrisisDate = null;
    let negativeBalanceDates = [];

    // We need to track running balance starting from today
    // First, calculate balance at end of today
    const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${today.getDate().toString().padStart(2, "0")}`;
    const todayMonthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;
    const monthlyBalances = this.store.getMonthlyBalances();
    let currentBalance = monthlyBalances[todayMonthKey]?.startingBalance || 0;

    // Calculate balance up through today
    for (let d = 1; d <= today.getDate(); d++) {
      const dateStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
      const dailyTotals = this.calculationService.calculateDailyTotals(dateStr);
      if (dailyTotals.balance !== null) {
        currentBalance = dailyTotals.balance;
      } else {
        currentBalance += dailyTotals.income - dailyTotals.expense;
      }
    }

    // Now iterate through the next 30 days to find the lowest
    for (let d = 1; d <= 30; d++) {
      const checkDate = new Date(today.getTime() + d * 24 * 60 * 60 * 1000);
      const dateStr = `${checkDate.getFullYear()}-${(checkDate.getMonth() + 1).toString().padStart(2, "0")}-${checkDate.getDate().toString().padStart(2, "0")}`;
      const dailyTotals = this.calculationService.calculateDailyTotals(dateStr);

      if (dailyTotals.balance !== null) {
        currentBalance = dailyTotals.balance;
      } else {
        currentBalance += dailyTotals.income - dailyTotals.expense;
      }

      // Track first crisis date (first day with balance ≤0)
      if (firstCrisisDate === null && currentBalance <= 0) {
        firstCrisisDate = dateStr;
      }

      // Track all negative/zero balance dates
      if (currentBalance <= 0) {
        negativeBalanceDates.push(dateStr);
      }

      if (currentBalance < lowestBalance) {
        lowestBalance = currentBalance;
        lowestBalanceDates = [dateStr];
      } else if (currentBalance === lowestBalance) {
        lowestBalanceDates.push(dateStr);
      }
    }

    for (let i = 1; i <= daysInMonth; i++) {
      const day = document.createElement("div");
      day.classList.add("day");
      day.innerHTML = `${i}<div class="day-content"></div>`;
      if (
        year === today.getFullYear() &&
        month === today.getMonth() &&
        i === today.getDate()
      ) {
        day.classList.add("current");
      }
      // Highlight the last day of the 30-day unallocated range
      if (
        year === unallocatedEndYear &&
        month === unallocatedEndMonth &&
        i === unallocatedEndDay
      ) {
        day.classList.add("unallocated-end");
      }
      // Highlight the day(s) with the lowest balance in the 30-day range
      const currentDateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${i.toString().padStart(2, "0")}`;
      if (lowestBalanceDates.includes(currentDateString)) {
        day.classList.add("lowest-balance");
      }
      // Highlight first crisis day (first day with balance ≤0)
      if (currentDateString === firstCrisisDate) {
        day.classList.add("first-crisis");
      }
      // Highlight all negative/zero balance days
      if (negativeBalanceDates.includes(currentDateString)) {
        day.classList.add("negative-balance");
      }
      const dateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${i
        .toString()
        .padStart(2, "0")}`;
      const dailyTotals =
        this.calculationService.calculateDailyTotals(dateString);
      const transactions = this.store.getTransactions();
      const transactionCount = transactions[dateString]
        ? transactions[dateString].filter((t) => t.hidden !== true).length
        : 0;
      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance += dailyTotals.income - dailyTotals.expense;
      }
      // Check if this date has any moved transactions (from or to)
      const hasMoveAnomaly = this.store.hasMoveAnomaly(dateString);

      day.querySelector(".day-content").innerHTML = `
        ${dailyTotals.income > 0
          ? `<div class="income">+${dailyTotals.income.toFixed(2)}</div>`
          : ""
        }
        ${dailyTotals.expense > 0
          ? `<div class="expense">-${dailyTotals.expense.toFixed(2)}</div>`
          : ""
        }
        <div class="balance">${runningBalance.toFixed(2)}</div>
        ${transactionCount > 0
          ? `<div class="transaction-count">(${transactionCount})</div>`
          : ""
        }
        ${dailyTotals.balance !== null
          ? '<div class="ending-balance-indicator">★</div>'
          : (hasMoveAnomaly
            ? '<div class="move-indicator">★</div>'
            : (dailyTotals.hasSkippedTransactions
              ? '<div class="skip-indicator">★</div>'
              : ""))
        }
      `;
      day.setAttribute('data-date', dateString);
      // Event listener is handled via delegation in initEventListeners()

      calendarDays.appendChild(day);
    }
    const remainingDays = 42 - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
      const day = document.createElement("div");
      day.classList.add("day", "other-month");
      day.innerHTML = `${i}<div class="day-content"></div>`;
      calendarDays.appendChild(day);
    }
    // Determine if we should show Unallocated
    // Show only if the viewed month overlaps with the 30-day window from today
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Check if viewed month is in the past (before current month)
    const viewedMonthStart = new Date(year, month, 1);
    const currentMonthStart = new Date(todayYear, todayMonth, 1);
    const viewedMonthEnd = new Date(year, month + 1, 0); // Last day of viewed month

    // Show Unallocated if:
    // 1. Viewed month is not entirely in the past
    // 2. Viewed month start is within 30 days from today
    const isPastMonth = viewedMonthEnd < currentMonthStart;
    const isWithin30Days = viewedMonthStart <= thirtyDaysFromNow;
    const showUnallocated = !isPastMonth && isWithin30Days;

    let summaryHtml = `Monthly Summary: Income: $${summary.income.toFixed(2)} | Expenses: $${summary.expense.toFixed(2)}`;

    if (showUnallocated) {
      const unallocated = this.calculationService.calculateUnallocated();
      const unallocatedClass = unallocated <= 0 ? 'unallocated-negative' : '';
      summaryHtml += ` | Unallocated: <span class="${unallocatedClass}">$${unallocated.toFixed(2)}</span>`;
    }

    // Add Notes link with star indicator if notes exist
    const monthKey = `${year}-${month + 1}`;
    const hasNotes = this.store.hasMonthlyNotes(monthKey);
    const notesIndicator = hasNotes ? ' ★' : '';
    summaryHtml += ` | <span class="notes-link" onclick="app.calendarUI.showNotesModal()">Notes${notesIndicator}</span>`;

    document.getElementById("monthSummary").innerHTML = summaryHtml;
    const pinLabel = window.pinProtection && pinProtection.isPinSet() ? "Change PIN" : "Set PIN";
    document.getElementById("calendarOptions").innerHTML = `
      <button
        type="button"
        class="calendar-option"
        onclick="app.searchUI.showSearchModal()"
        aria-haspopup="dialog"
        aria-controls="searchModal"
      >
        Search
      </button>
      <button
        type="button"
        class="calendar-option"
        onclick="app.debtSnowball.showModal()"
        aria-haspopup="dialog"
        aria-controls="debtSnowballModal"
      >
        Debt Snowball
      </button>
      <button type="button" class="calendar-option" onclick="app.exportData()">
        Save to Device
      </button>
      <button type="button" class="calendar-option" onclick="app.importData()">
        Load from Device
      </button>
      <button
        type="button"
        class="calendar-option"
        onclick="app.cloudSync.saveToCloud()"
      >
        Save to Cloud
      </button>
      <button
        type="button"
        class="calendar-option"
        onclick="app.cloudSync.loadFromCloud()"
      >
        Load from Cloud
      </button>
      <button
        type="button"
        class="calendar-option"
        onclick="pinProtection.promptChangePin(app.store)"
      >
        ${pinLabel}
      </button>
      <button type="button" class="calendar-option" onclick="app.resetData()">
        Reset
      </button>
    `;
  }


  openTransactionModalFallback(date) {
    const modal = document.getElementById("transactionModal");
    const dateInput = document.getElementById("transactionDate");
    const modalDate = document.getElementById("modalDate");

    if (!modal) {
      console.error('Transaction modal element not found');
      return;
    }
    if (dateInput) {
      dateInput.value = date;
    }
    if (modalDate) {
      modalDate.textContent = Utils.formatDisplayDate(date);
    }
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
          const amountSpan = document.createElement("span");
          amountSpan.className = t.type;
          const sign = t.type === "balance" ? "=" : t.type === "income" ? "+" : "-";
          amountSpan.textContent = `${sign}$${t.amount.toFixed(2)}`;
          row.appendChild(amountSpan);
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
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
  }


  changeMonth(delta) {
    const newDate = new Date(
      this.currentDate.getFullYear(),
      this.currentDate.getMonth() + delta,
      1
    );
    this.currentDate = newDate;
    this.generateCalendar();
  }


  returnToCurrentMonth() {
    this.currentDate = new Date();
    this.generateCalendar();
  }

  showNotesModal() {
    const modal = document.getElementById("notesModal");
    const textarea = document.getElementById("notesTextarea");
    const monthLabel = document.getElementById("notesMonthLabel");

    if (!modal || !textarea || !monthLabel) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthKey = `${year}-${month + 1}`;

    const monthNames = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"
    ];

    monthLabel.textContent = `${monthNames[month]} ${year}`;
    textarea.value = this.store.getMonthlyNotes(monthKey);

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    textarea.focus();
  }

  hideNotesModal() {
    const modal = document.getElementById("notesModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
  }

  saveNotes() {
    const textarea = document.getElementById("notesTextarea");
    if (!textarea) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthKey = `${year}-${month + 1}`;

    this.store.setMonthlyNotes(monthKey, textarea.value);
    this.hideNotesModal();
    this.generateCalendar(); // Refresh to update star indicator
    Utils.showNotification("Notes saved");
  }
}
