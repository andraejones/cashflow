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
    this.viewMode = this._loadViewMode();

    // Track bound event handlers for cleanup
    this._boundDayClickHandler = null;

    this.initEventListeners();
  }


  // Agenda view is the default (mobile-friendly); users can switch back to
  // the grid from the menu, and the choice persists across visits.
  _loadViewMode() {
    try {
      return localStorage.getItem("calendar_view_mode") === "grid" ? "grid" : "agenda";
    } catch (e) {
      return "agenda";
    }
  }


  _saveViewMode(mode) {
    try {
      localStorage.setItem("calendar_view_mode", mode);
    } catch (e) {
      // Storage unavailable (e.g. private browsing) - view choice just won't persist.
    }
  }


  toggleViewMode() {
    this.viewMode = this.viewMode === "agenda" ? "grid" : "agenda";
    this._saveViewMode(this.viewMode);
    this.generateCalendar();
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
    // Use event delegation for day clicks to avoid memory leaks. Shared
    // between the grid and agenda views - only real days carry data-date.
    const calendarDays = document.getElementById("calendarDays");
    const calendarAgenda = document.getElementById("calendarAgenda");
    this._boundDayClickHandler = (event) => {
      const dayElement = event.target.closest('[data-date]');
      if (dayElement) {
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
    if (calendarDays) {
      calendarDays.addEventListener("click", this._boundDayClickHandler);
    }
    if (calendarAgenda) {
      calendarAgenda.addEventListener("click", this._boundDayClickHandler);
      calendarAgenda.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const row = event.target.closest('.agenda-row[data-date]');
        if (!row) return;
        event.preventDefault();
        this._boundDayClickHandler(event);
      });
    }

    this._initAppMenu();
    this._initTopSearch();

    Utils.cleanUpHtmlArtifacts();
  }


  _initAppMenu() {
    const button = document.getElementById("menuButton");
    const menu = document.getElementById("calendarOptions");
    if (!button || !menu) return;

    button.addEventListener("click", (e) => {
      e.stopPropagation();
      this.toggleAppMenu();
    });

    document.addEventListener("click", (e) => {
      if (!menu.classList.contains("is-open")) return;
      if (menu.contains(e.target) || button.contains(e.target)) return;
      this.closeAppMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && menu.classList.contains("is-open")) {
        this.closeAppMenu();
        button.focus();
      }
    });
  }


  toggleAppMenu() {
    const menu = document.getElementById("calendarOptions");
    if (!menu) return;
    if (menu.classList.contains("is-open")) {
      this.closeAppMenu();
    } else {
      this.openAppMenu();
    }
  }


  openAppMenu() {
    const button = document.getElementById("menuButton");
    const menu = document.getElementById("calendarOptions");
    if (!menu || !button) return;
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    button.setAttribute("aria-expanded", "true");
  }


  closeAppMenu() {
    const button = document.getElementById("menuButton");
    const menu = document.getElementById("calendarOptions");
    if (!menu || !button) return;
    menu.classList.remove("is-open");
    menu.setAttribute("aria-hidden", "true");
    button.setAttribute("aria-expanded", "false");
  }


  _initTopSearch() {
    const form = document.getElementById("topSearchForm");
    const input = document.getElementById("topSearchInput");
    if (!form || !input) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const term = input.value.trim();
      if (!window.app || !window.app.searchUI) return;
      window.app.searchUI.showSearchModal(term);
    });
  }


  generateCalendar() {
    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();

    const currentMonthElement = document.getElementById("currentMonth");
    if (!currentMonthElement) {
      console.error("currentMonth element not found");
      return;
    }

    const pendingMessage = currentMonthElement.querySelector("#pendingMessage");
    if (pendingMessage) {
      pendingMessage.remove();
    }
    const today = new Date();
    if (year === today.getFullYear() && month === today.getMonth()) {
      currentMonthElement.textContent = `${Utils.MONTH_LABELS[month]} ${year}`;
      currentMonthElement.onclick = null;
      currentMonthElement.style.cursor = "default";
    } else {
      currentMonthElement.textContent = `${Utils.MONTH_LABELS[month]} ${year} ⏎`;
      currentMonthElement.onclick = () => this.returnToCurrentMonth();
      currentMonthElement.style.cursor = "pointer";
    }

    // Announce month change to screen readers
    Utils.announceToScreenReader(`Viewing ${Utils.MONTH_LABELS[month]} ${year}`);
    if (pendingMessage) {
      currentMonthElement.appendChild(pendingMessage);
    }
    this.recurringManager.applyRecurringTransactions(year, month);
    if (this.debtSnowball) {
      // Materialize the snowball for the viewed month AND the forward window the
      // balance walk spans, so forward day balances and the today-anchored
      // 30-day Minimum reflect planned snowball spend without the user having to
      // open each future month.
      this.debtSnowball.ensureSnowballPaymentsForHorizon(year, month);
    }
    this.calculationService.updateMonthlyBalances(this.currentDate);
    const summary = this.calculationService.calculateMonthlySummary(
      year,
      month
    );
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const calendarDays = document.getElementById("calendarDays");
    const calendarAgenda = document.getElementById("calendarAgenda");
    if (!calendarDays || !calendarAgenda) {
      console.error("calendar view element not found");
      return;
    }
    const isAgendaView = this.viewMode === "agenda";
    calendarDays.innerHTML = "";
    calendarAgenda.innerHTML = "";
    calendarDays.hidden = isAgendaView;
    calendarAgenda.hidden = !isAgendaView;
    if (!isAgendaView) {
      for (let i = 0; i < firstDay; i++) {
        const day = document.createElement("div");
        day.classList.add("day", "other-month");
        calendarDays.appendChild(day);
      }
    }
    let runningBalance = summary.startingBalance;
    // Pre-compute unsettled expense carryover from prior months. An Ending
    // Balance reconciles everything dated on/before it, so only unsettled items
    // after the most recent anchor before this month still carry in.
    const monthStartStr = Utils.formatDateString(new Date(year, month, 1));
    const allUnsettled = this.store.getUnsettledTransactions();
    const carryAnchor = this.calculationService.getReconciliationAnchor(monthStartStr, { inclusive: false });
    let runningUnsettledExpense = 0;
    for (const u of allUnsettled) {
      if (u.date < monthStartStr && (carryAnchor === null || u.date > carryAnchor)) {
        runningUnsettledExpense = this.calculationService.roundToCents(
          runningUnsettledExpense + u.transaction.amount
        );
      }
    }

    // Pre-compute allocated-bucket carryover from prior months for the
    // "balance excluding allocations" figure. Unlike unsettled, allocations are
    // standing reserves that PERSIST across Ending Balances — an anchor does not
    // reconcile them away — so include every live bucket before this month
    // regardless of anchors. Skipped recurring instances aren't subtracted
    // (calculateDailyTotals excludes them), so skip them here too.
    let runningAllocatedExpense = 0;
    const allTransactions = this.store.getTransactions();
    Object.keys(allTransactions).forEach((d) => {
      if (d >= monthStartStr) return;
      allTransactions[d].forEach((t) => {
        if (t.type !== "expense" || t.allocated !== true) return;
        if (
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(d, t.recurringId)
        ) {
          return;
        }
        runningAllocatedExpense = this.calculationService.roundToCents(
          runningAllocatedExpense + t.amount
        );
      });
    });

    // Calculate the end date of the 30-day minimum range (DST-safe)
    const minimumEndDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);
    const minimumEndYear = minimumEndDate.getFullYear();
    const minimumEndMonth = minimumEndDate.getMonth();
    const minimumEndDay = minimumEndDate.getDate();

    // Find the day(s) with the lowest balance in the 30-day minimum range
    // Calculate across the entire 30-day range (not just the displayed month)
    let lowestBalanceDates = [];
    let lowestBalance = Infinity;
    // Track first crisis (first day with balance ≤0) and all negative days
    let firstCrisisDate = null;
    let negativeBalanceDates = [];

    // We need to track running balance starting from today
    // First, calculate balance at end of today
    const todayStr = Utils.formatDateString(today);
    const todayMonthKey = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, "0")}`;
    const monthlyBalances = this.store.getMonthlyBalances();
    let currentBalance = monthlyBalances[todayMonthKey]?.startingBalance || 0;

    // Calculate balance up through today. An Ending Balance is shown as entered
    // (reconciliation anchor); unsettled expenses reduce the balance only via
    // normal expense subtraction, matching CalculationService.calculateMinimum.
    for (let d = 1; d <= today.getDate(); d++) {
      const dateStr = Utils.formatDateString(new Date(today.getFullYear(), today.getMonth(), d));
      const dailyTotals = this.calculationService.calculateDailyTotals(dateStr);
      if (dailyTotals.balance !== null) {
        // Ending Balance = gross bank total; keep allocation reserves reserved
        // by subtracting still-live reserves dated on/before this anchor.
        currentBalance = this.calculationService.roundToCents(
          dailyTotals.balance - this.calculationService.getReservedTotalOnOrBefore(dateStr)
        );
      } else {
        currentBalance = this.calculationService.roundToCents(currentBalance + dailyTotals.income - dailyTotals.expense);
      }
    }

    // Seed the minimum/crisis tracking with today itself. calculateMinimum()
    // (the "Minimum" figure in the summary) measures from today through the
    // next 30 days, so today must be a candidate here too — otherwise an
    // already-negative today goes un-highlighted and the highlighted
    // lowest-balance day can disagree with the displayed Minimum value.
    if (currentBalance <= 0) {
      firstCrisisDate = todayStr;
      negativeBalanceDates.push(todayStr);
    }
    lowestBalance = currentBalance;
    lowestBalanceDates = [todayStr];

    // Now iterate through the next 30 days to find the lowest
    for (let d = 1; d <= 30; d++) {
      const checkDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() + d);
      const dateStr = Utils.formatDateString(checkDate);
      const dailyTotals = this.calculationService.calculateDailyTotals(dateStr);

      if (dailyTotals.balance !== null) {
        // Ending Balance = gross bank total; keep allocation reserves reserved
        // by subtracting still-live reserves dated on/before this anchor.
        currentBalance = this.calculationService.roundToCents(
          dailyTotals.balance - this.calculationService.getReservedTotalOnOrBefore(dateStr)
        );
      } else {
        currentBalance = this.calculationService.roundToCents(currentBalance + dailyTotals.income - dailyTotals.expense);
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

    // Days on which a debt is fully paid off by the snowball plan, so they can
    // be flagged at a glance.
    const payoffDates = this.debtSnowball ? this.debtSnowball.getPayoffDates() : null;

    for (let i = 1; i <= daysInMonth; i++) {
      const isCurrentDay = year === today.getFullYear() && month === today.getMonth() && i === today.getDate();
      // Highlight the last day of the 30-day minimum range
      const isMinimumEnd =
        year === minimumEndYear &&
        month === minimumEndMonth &&
        i === minimumEndDay;
      // Highlight the day(s) with the lowest balance in the 30-day range
      const currentDateString = Utils.formatDateString(new Date(year, month, i));
      const isLowestBalance = lowestBalanceDates.includes(currentDateString);
      // Highlight first crisis day (first day with balance ≤0)
      const isFirstCrisis = currentDateString === firstCrisisDate;
      // Highlight all negative/zero balance days
      const isNegativeBalance = negativeBalanceDates.includes(currentDateString);
      // Flag days where a debt gets fully paid off by the snowball plan.
      const isPayoffDay = payoffDates ? payoffDates.has(currentDateString) : false;
      const dateString = currentDateString;
      const dailyTotals =
        this.calculationService.calculateDailyTotals(dateString);
      // Light-purple highlight for days containing an allocated expense.
      const hasAllocated = dailyTotals.hasAllocated;
      const transactions = this.store.getTransactions();
      const transactionCount = transactions[dateString]
        ? transactions[dateString].filter((t) => t.hidden !== true).length
        : 0;
      if (dailyTotals.balance !== null) {
        // Ending Balance = gross bank total. Unsettled items dated on/before are
        // reconciled (accumulator resets to 0). Allocation reserves, though,
        // stay reserved across the anchor: subtract every still-live reserve
        // dated on/before it so .balance is available-after-reserves, and set
        // the allocation accumulator to that same reserved total so the
        // "excluding allocations" figure equals the entered gross exactly.
        const reservedOnOrBefore =
          this.calculationService.getReservedTotalOnOrBefore(dateString);
        runningBalance = this.calculationService.roundToCents(
          dailyTotals.balance - reservedOnOrBefore
        );
        runningUnsettledExpense = 0;
        runningAllocatedExpense = reservedOnOrBefore;
      } else {
        runningBalance = this.calculationService.roundToCents(runningBalance + dailyTotals.income - dailyTotals.expense);
        runningUnsettledExpense = this.calculationService.roundToCents(runningUnsettledExpense + dailyTotals.unsettledExpense);
        runningAllocatedExpense = this.calculationService.roundToCents(runningAllocatedExpense + dailyTotals.allocatedExpense);
      }

      // Balance with both unsettled expenses AND allocated reserves added back
      // (neither applied). Tied to having unsettled items so it doesn't just
      // duplicate the "excluding allocations" line when only allocations exist.
      const balanceWithoutUnsettled = runningUnsettledExpense > 0
        ? this.calculationService.roundToCents(
            runningBalance + runningUnsettledExpense + runningAllocatedExpense
          )
        : null;

      // Balance with every allocated bucket added back (what's available if the
      // reserved set-asides were freed). Shown on the current day only.
      const balanceExcludingAllocations = runningAllocatedExpense > 0
        ? this.calculationService.roundToCents(runningBalance + runningAllocatedExpense)
        : null;

      // Check if this date has any moved transactions (from or to)
      const hasMoveAnomaly = this.store.hasMoveAnomaly(dateString);

      // The cell's expense figure. The current day is "live": it shows its own
      // activity (settled + pending) PLUS every unsettled item carried forward
      // from earlier days, which sit on today until settled. Every other day
      // counts settled spend only — settling an item moves it to the day it
      // settled, so it then counts on that day's cell, never stranded on its
      // original date. Running balances above/below are intentionally left
      // counting all expenses.
      // (runningUnsettledExpense already includes today's own unsettled, so
      // subtract it to isolate the carried-forward portion; clamp guards the
      // reconciliation-anchor reset case.)
      const carriedForwardUnsettled = Math.max(
        0,
        this.calculationService.roundToCents(
          runningUnsettledExpense - dailyTotals.unsettledExpense
        )
      );
      const cellExpense = isCurrentDay
        ? this.calculationService.roundToCents(
            dailyTotals.expense + carriedForwardUnsettled
          )
        : this.calculationService.roundToCents(
            dailyTotals.expense - dailyTotals.unsettledExpense
          );

      // Event listener is handled via delegation in initEventListeners()
      if (isAgendaView) {
        const dayTransactions = transactions[dateString]
          ? transactions[dateString].filter((t) => t.hidden !== true)
          : [];
        calendarAgenda.appendChild(this._buildAgendaRow({
          dayNumber: i, dateString, year, month,
          isCurrentDay, isMinimumEnd, isLowestBalance, isFirstCrisis, isNegativeBalance,
          hasAllocated, isPayoffDay, hasMoveAnomaly,
          dailyTotals, cellExpense, runningBalance, balanceWithoutUnsettled, balanceExcludingAllocations,
          transactionCount, dayTransactions,
        }));
      } else {
        const day = document.createElement("div");
        day.classList.add("day");
        if (isCurrentDay) day.classList.add("current");
        if (isMinimumEnd) day.classList.add("minimum-end");
        if (isLowestBalance) day.classList.add("lowest-balance");
        if (isFirstCrisis) day.classList.add("first-crisis");
        if (isNegativeBalance) day.classList.add("negative-balance");
        if (hasAllocated) day.classList.add("allocated-day");
        day.innerHTML = `${i}<div class="day-content">
        ${dailyTotals.income > 0
          ? `<div class="income">+${dailyTotals.income.toFixed(2)}</div>`
          : ""
        }
        ${cellExpense > 0
          ? `<div class="expense">-${cellExpense.toFixed(2)}</div>`
          : ""
        }
        ${balanceWithoutUnsettled !== null && isCurrentDay
          ? `<div class="balance-without-unsettled">${balanceWithoutUnsettled.toFixed(2)}</div>`
          : ""
        }
        ${balanceExcludingAllocations !== null && isCurrentDay
          ? `<div class="balance-excluding-allocations" title="Balance excluding allocations">${balanceExcludingAllocations.toFixed(2)}</div>`
          : ""
        }
        <div class="balance">${runningBalance.toFixed(2)}</div>
        ${transactionCount > 0
          ? `<div class="transaction-count">(${transactionCount})</div>`
          : ""
        }
        ${this._getDayIndicatorHtml(dailyTotals, hasMoveAnomaly)}
        ${isPayoffDay ? '<div class="payoff-indicator" title="Debt paid off">🎯</div>' : ""}
      </div>`;
        day.setAttribute('data-date', dateString);
        calendarDays.appendChild(day);
      }
    }
    if (!isAgendaView) {
      const remainingDays = 42 - (firstDay + daysInMonth);
      for (let i = 1; i <= remainingDays; i++) {
        const day = document.createElement("div");
        day.classList.add("day", "other-month");
        day.innerHTML = `${i}<div class="day-content"></div>`;
        calendarDays.appendChild(day);
      }
    }
    // Determine if we should show Minimum
    // Show only if the viewed month overlaps with the 30-day window from today
    const todayYear = today.getFullYear();
    const todayMonth = today.getMonth();
    const thirtyDaysFromNow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 30);

    // Check if viewed month is in the past (before current month)
    const viewedMonthStart = new Date(year, month, 1);
    const currentMonthStart = new Date(todayYear, todayMonth, 1);
    const viewedMonthEnd = new Date(year, month + 1, 0); // Last day of viewed month

    // Show Minimum if:
    // 1. Viewed month is not entirely in the past
    // 2. Viewed month start is within 30 days from today
    const isPastMonth = viewedMonthEnd < currentMonthStart;
    const isWithin30Days = viewedMonthStart <= thirtyDaysFromNow;
    const showMinimum = !isPastMonth && isWithin30Days;

    let summaryHtml = `<span class="summary-segment">Monthly Summary:</span> <span class="summary-segment">Income: $${summary.income.toFixed(2)}</span> <span class="summary-segment">| Expenses: $${summary.expense.toFixed(2)}</span>`;

    if (showMinimum) {
      const minimum = this.calculationService.calculateMinimum();
      const minimumClass = minimum <= 0 ? 'minimum-negative' : '';
      summaryHtml += ` <span class="summary-segment">| Minimum: <span class="${minimumClass}">$${minimum.toFixed(2)}</span></span>`;
    }

    // Add Notes link with star indicator if notes exist
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const hasNotes = this.store.hasMonthlyNotes(monthKey);
    const notesIndicator = hasNotes ? ' ★' : '';
    summaryHtml += ` <span class="summary-segment">| <span class="notes-link" onclick="app.calendarUI.showNotesModal()">Notes${notesIndicator}</span></span>`;

    document.getElementById("monthSummary").innerHTML = summaryHtml;
    const pinLabel = window.pinProtection && pinProtection.isPinSet() ? "Change PIN" : "Set PIN";

    // Biometrics button - only show if available and PIN is set
    let biometricsButton = '';
    if (window.pinProtection && pinProtection.isPinSet() && pinProtection.isWebAuthnAvailable()) {
      const biometricsLabel = pinProtection.isWebAuthnEnabled() ? "Disable FaceID/TouchID" : "Enable FaceID/TouchID";
      biometricsButton = `
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.calendarUI.toggleBiometrics(); app.calendarUI.closeAppMenu();"
      >
        ${biometricsLabel}
      </button>`;
    }

    const viewModeLabel = this.viewMode === "agenda" ? "Switch to Calendar View" : "Switch to Agenda View";

    document.getElementById("calendarOptions").innerHTML = `
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked="${this.viewMode === "agenda"}"
        class="calendar-option"
        onclick="app.calendarUI.toggleViewMode(); app.calendarUI.closeAppMenu();"
      >
        ${viewModeLabel}
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.showRecentTransactions(); app.calendarUI.closeAppMenu();"
        aria-haspopup="dialog"
        aria-controls="recentTransactionsModal"
      >
        Recent Transactions
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.showAllocatedTransactions(); app.calendarUI.closeAppMenu();"
        aria-haspopup="dialog"
        aria-controls="allocatedTransactionsModal"
      >
        Allocated
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.debtSnowball.showView(); app.calendarUI.closeAppMenu();"
        aria-controls="debtSnowballView"
      >
        Debt Snowball
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.bankReconcile.show(); app.calendarUI.closeAppMenu();"
        aria-haspopup="dialog"
        aria-controls="bankReconcileModal"
      >
        Reconcile Bank Statement
      </button>
      <button type="button" role="menuitem" class="calendar-option" onclick="app.exportData(); app.calendarUI.closeAppMenu();">
        Save to Device
      </button>
      <button type="button" role="menuitem" class="calendar-option" onclick="app.importData(); app.calendarUI.closeAppMenu();">
        Load from Device
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.cloudSync.saveToCloud(); app.calendarUI.closeAppMenu();"
      >
        Save to Cloud
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="app.cloudSync.loadFromCloud(); app.calendarUI.closeAppMenu();"
      >
        Load from Cloud
      </button>
      <button
        type="button"
        role="menuitem"
        class="calendar-option"
        onclick="pinProtection.promptChangePin(app.store); app.calendarUI.closeAppMenu();"
      >
        ${pinLabel}
      </button>
      ${biometricsButton}
      <button type="button" role="menuitem" class="calendar-option" onclick="app.resetData(); app.calendarUI.closeAppMenu();">
        Reset
      </button>
      <div class="app-menu-build" role="presentation" aria-label="Build timestamp">
        Build ${window.APP_BUILD || "unknown"}
      </div>
    `;
  }


  // Builds one row for the agenda (list) view, using the same per-day figures
  // computed inline in generateCalendar()'s walk - no second balance walk.
  _buildAgendaRow(d) {
    const row = document.createElement("div");
    row.classList.add("agenda-row");
    if (d.isCurrentDay) row.classList.add("current");
    if (d.isMinimumEnd) row.classList.add("minimum-end");
    if (d.isLowestBalance) row.classList.add("lowest-balance");
    if (d.isFirstCrisis) row.classList.add("first-crisis");
    if (d.isNegativeBalance) row.classList.add("negative-balance");
    if (d.hasAllocated) row.classList.add("allocated-day");

    const items = d.dayTransactions || [];
    // Days with no activity, no Ending Balance anchor, and no special flag are
    // just balance carry-forward — render them compact so the eye lands on the
    // days that actually change the plan. The current day stays full-size.
    const hasContent =
      items.length > 0 ||
      d.dailyTotals.balance !== null ||
      d.dailyTotals.hasSkippedTransactions ||
      d.hasMoveAnomaly ||
      d.isPayoffDay;
    const isEmpty = !hasContent && !d.isCurrentDay;
    if (isEmpty) row.classList.add("is-empty");

    row.setAttribute("role", "listitem");
    row.setAttribute("tabindex", "0");
    row.setAttribute("data-date", d.dateString);

    const weekday = Utils.WEEKDAY_LABELS[new Date(d.year, d.month, d.dayNumber).getDay()];

    // Per-day line items — the list layout has the room the grid cell doesn't,
    // so show what's actually happening rather than a bare "(N)" count. Skipped
    // recurring instances are struck through (they don't count toward figures).
    const itemsHtml = items.length > 0
      ? `<ul class="agenda-items">${items
          .map((t) => {
            const isSkipped =
              t.recurringId &&
              this.recurringManager.isTransactionSkipped(d.dateString, t.recurringId);
            const sign = t.type === "balance" ? "=" : t.type === "income" ? "+" : "-";
            const amountClass = t.type === "balance" ? "ending-balance" : t.type;
            const fallback =
              t.type === "balance" ? "Ending Balance" : t.type === "income" ? "Income" : "Expense";
            const desc = (typeof t.description === "string" && t.description.trim())
              ? Utils.escapeHtml(t.description.trim())
              : fallback;
            const flags = [];
            if (t.allocated === true) flags.push('<span class="agenda-item-flag" title="Reserved bucket">🔒</span>');
            if (t.type === "expense" && t.settled === false) flags.push('<span class="agenda-item-flag" title="Unsettled">⏳</span>');
            return `<li class="agenda-item${isSkipped ? " skipped" : ""}">
              <span class="agenda-item-desc">${desc}</span>
              ${flags.length ? `<span class="agenda-item-flags">${flags.join("")}</span>` : ""}
              <span class="agenda-item-amount ${amountClass}">${sign}${t.amount.toFixed(2)}</span>
            </li>`;
          })
          .join("")}</ul>`
      : "";

    row.innerHTML = `
      <div class="agenda-date-col">
        <span class="agenda-weekday">${weekday}</span>
        <span class="agenda-daynum">${d.dayNumber}</span>
      </div>
      <div class="agenda-main">
        <div class="agenda-figures">
          ${d.dailyTotals.income > 0
            ? `<span class="income">+${d.dailyTotals.income.toFixed(2)}</span>`
            : ""
          }
          ${d.cellExpense > 0
            ? `<span class="expense">-${d.cellExpense.toFixed(2)}</span>`
            : ""
          }
          <span class="balance">${d.runningBalance.toFixed(2)}</span>
        </div>
        ${itemsHtml}
        <div class="agenda-meta">
          ${d.balanceWithoutUnsettled !== null && d.isCurrentDay
            ? `<span class="balance-without-unsettled">${d.balanceWithoutUnsettled.toFixed(2)}</span>`
            : ""
          }
          ${d.balanceExcludingAllocations !== null && d.isCurrentDay
            ? `<span class="balance-excluding-allocations" title="Balance excluding allocations">${d.balanceExcludingAllocations.toFixed(2)}</span>`
            : ""
          }
          ${this._getDayIndicatorHtml(d.dailyTotals, d.hasMoveAnomaly)}
          ${d.isPayoffDay ? '<span class="payoff-indicator" title="Debt paid off">🎯</span>' : ""}
        </div>
      </div>
    `;
    return row;
  }


  _getDayIndicatorHtml(dailyTotals, hasMoveAnomaly) {
    if (dailyTotals.balance !== null) {
      return '<div class="ending-balance-indicator">★</div>';
    }
    if (hasMoveAnomaly) {
      return '<div class="move-indicator">★</div>';
    }
    if (dailyTotals.hasSkippedTransactions) {
      return '<div class="skip-indicator">★</div>';
    }
    return "";
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
          const isHidden = t.hidden === true;
          const row = document.createElement("div");
          if (isHidden) {
            row.classList.add("hidden-transaction");
          }
          const amountSpan = document.createElement("span");
          amountSpan.className = t.type;
          const sign = t.type === "balance" ? "=" : t.type === "income" ? "+" : "-";
          const hiddenLabel = isHidden ? " (Hidden - Debt Snowball)" : "";
          amountSpan.textContent = `${sign}$${t.amount.toFixed(2)}${hiddenLabel}`;
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
    ModalManager.openModal(modal);
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
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    monthLabel.textContent = `${Utils.MONTH_LABELS[month]} ${year}`;
    textarea.value = this.store.getMonthlyNotes(monthKey);

    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);
    textarea.focus();
  }

  hideNotesModal() {
    const modal = document.getElementById("notesModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
  }

  saveNotes() {
    const textarea = document.getElementById("notesTextarea");
    if (!textarea) return;

    const year = this.currentDate.getFullYear();
    const month = this.currentDate.getMonth();
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;

    this.store.setMonthlyNotes(monthKey, textarea.value);
    this.hideNotesModal();
    this.generateCalendar(); // Refresh to update star indicator
    Utils.showNotification("Notes saved");
  }

  async toggleBiometrics() {
    if (!window.pinProtection) return;

    try {
      // Ensure WebAuthn initialization is complete
      await pinProtection.ensureWebAuthnInit();

      if (pinProtection.isWebAuthnEnabled()) {
        // Disable biometrics
        await pinProtection.disableBiometrics();
      } else {
        // Enable biometrics
        await pinProtection.enableBiometrics();
      }

      // Refresh calendar to update button label
      this.generateCalendar();
    } catch (error) {
      console.error("Error toggling biometrics:", error);
      Utils.showNotification("Failed to update biometric settings. Please try again.", "error");
    }
  }
}
