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
    this.initEventListeners();
  }

  
  initEventListeners() {
    document.getElementById("prevMonth").addEventListener("click", () => {
      this.changeMonth(-1);
    });
    document.getElementById("nextMonth").addEventListener("click", () => {
      this.changeMonth(1);
    });
    this.cleanUpHtmlArtifacts();
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
      const dateString = `${year}-${(month + 1).toString().padStart(2, "0")}-${i
        .toString()
        .padStart(2, "0")}`;
      const dailyTotals =
        this.calculationService.calculateDailyTotals(dateString);
      const transactions = this.store.getTransactions();
      const transactionCount = transactions[dateString]
        ? transactions[dateString].length
        : 0;
      if (dailyTotals.balance !== null) {
        runningBalance = dailyTotals.balance;
      } else {
        runningBalance += dailyTotals.income - dailyTotals.expense;
      }
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
      day.setAttribute('data-date', dateString);
      day.addEventListener("click", (event) => {
        event.stopPropagation();
        console.log('Day clicked:', dateString);
        try {
          this.transactionUI.showTransactionDetails(dateString);
        } catch (error) {
          console.error("Error showing transaction details:", error);
          this.openTransactionModalFallback(dateString);
        }
      });

      calendarDays.appendChild(day);
    }
    const remainingDays = 42 - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingDays; i++) {
      const day = document.createElement("div");
      day.classList.add("day", "other-month");
      day.innerHTML = `${i}<div class="day-content"></div>`;
      calendarDays.appendChild(day);
    }
    document.getElementById("monthSummary").innerHTML = `
      Monthly Summary: Starting Balance: $${summary.startingBalance.toFixed(
        2
      )} | 
      Income: $${summary.income.toFixed(2)} | 
      Expenses: $${summary.expense.toFixed(2)} | 
      Ending Balance: $${summary.endingBalance.toFixed(2)}
    `;
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
        transactions[date].forEach((t) => {
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
}
