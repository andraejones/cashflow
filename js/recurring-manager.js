// Recurring transaction manager

class RecurringTransactionManager {

  constructor(store) {
    this.store = store;
    // Cache for expanded recurring transactions per month
    // Key format: "YYYY-MM" + hash of recurring transaction data
    this.expansionCache = new Map();
    this.lastRecurringHash = null;
    // Cache for US banking holidays per year
    this._holidayCache = new Map();
  }

  // Generate a simple hash of recurring transactions to detect changes
  _generateRecurringHash() {
    const recurringData = this.store.getRecurringTransactions();
    const skippedData = this.store.getSkippedTransactions();
    // Create a string representation of the data for hashing
    const dataStr = JSON.stringify({
      recurring: recurringData,
      skipped: skippedData
    });
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < dataStr.length; i++) {
      const char = dataStr.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Invalidate cache when recurring templates change
  invalidateCache() {
    this.expansionCache.clear();
    this.lastRecurringHash = null;
  }

  // Check if cache is valid for current recurring transaction state
  _isCacheValid() {
    const currentHash = this._generateRecurringHash();
    if (this.lastRecurringHash !== currentHash) {
      this.expansionCache.clear();
      this.lastRecurringHash = currentHash;
      return false;
    }
    return true;
  }

  // Get cache key for a specific month
  _getCacheKey(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    return monthStr;
  }

  // Public method to get cached data for a month
  getCached(year, month) {
    const cacheKey = this._getCacheKey(year, month);
    return this.expansionCache.get(cacheKey);
  }


  getRecurringTransactions() {
    return this.store.getRecurringTransactions();
  }


  addRecurringTransaction(recurringTransaction) {
    this.invalidateCache();
    return this.store.addRecurringTransaction(recurringTransaction);
  }


  getRecurringTransactionById(id) {
    const rt = this.store.getRecurringTransactions().find((rt) => rt.id === id);
    return rt || null;
  }


  isTransactionSkipped(date, recurringId) {
    return this.store.isTransactionSkipped(date, recurringId) === true;
  }


  toggleSkipTransaction(date, recurringId) {
    const isCurrentlySkipped = this.isTransactionSkipped(date, recurringId);
    const newStatus = !isCurrentlySkipped;
    this.store.setTransactionSkipped(date, recurringId, newStatus);
    this.invalidateCache();
    return newStatus;
  }


  // Calculate days between two dates using local timezone with noon to avoid DST issues
  daysBetween(startDate, endDate) {
    const startLocal = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate(),
      12, 0, 0
    );
    const endLocal = new Date(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate(),
      12, 0, 0
    );
    return Math.round((endLocal.getTime() - startLocal.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Adjust day for months with fewer days (handles Feb 29 in non-leap years, etc.)
  adjustDayForMonth(year, month, preferredDay) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.min(preferredDay, daysInMonth);
  }

  // Get observed date for a fixed holiday (handles weekend shifts)
  _getObservedHoliday(year, month, day) {
    const holiday = new Date(year, month, day, 12, 0, 0);
    const dayOfWeek = holiday.getDay();
    if (dayOfWeek === 6) {
      // Saturday -> observed Friday
      return new Date(year, month, day - 1, 12, 0, 0);
    } else if (dayOfWeek === 0) {
      // Sunday -> observed Monday
      return new Date(year, month, day + 1, 12, 0, 0);
    }
    return holiday;
  }

  // Get all US federal banking holidays for a given year
  getUSBankingHolidays(year) {
    if (this._holidayCache.has(year)) {
      return this._holidayCache.get(year);
    }

    const holidays = [];

    // New Year's Day (Jan 1, observed)
    holidays.push(this._getObservedHoliday(year, 0, 1));

    // MLK Day (3rd Monday of January)
    holidays.push(this.getNthDayOfMonth(year, 0, 1, 3));

    // Presidents' Day (3rd Monday of February)
    holidays.push(this.getNthDayOfMonth(year, 1, 1, 3));

    // Memorial Day (Last Monday of May)
    holidays.push(this.getNthDayOfMonth(year, 4, 1, -1));

    // Juneteenth (June 19, observed)
    holidays.push(this._getObservedHoliday(year, 5, 19));

    // Independence Day (July 4, observed)
    holidays.push(this._getObservedHoliday(year, 6, 4));

    // Labor Day (1st Monday of September)
    holidays.push(this.getNthDayOfMonth(year, 8, 1, 1));

    // Columbus Day (2nd Monday of October)
    holidays.push(this.getNthDayOfMonth(year, 9, 1, 2));

    // Veterans Day (Nov 11, observed)
    holidays.push(this._getObservedHoliday(year, 10, 11));

    // Thanksgiving (4th Thursday of November)
    holidays.push(this.getNthDayOfMonth(year, 10, 4, 4));

    // Christmas Day (Dec 25, observed)
    holidays.push(this._getObservedHoliday(year, 11, 25));

    // Filter out any nulls and store in cache
    const validHolidays = holidays.filter(h => h !== null);
    this._holidayCache.set(year, validHolidays);
    return validHolidays;
  }

  // Check if a date is a US banking holiday
  isUSBankingHoliday(date) {
    const year = date.getFullYear();
    const holidays = this.getUSBankingHolidays(year);

    return holidays.some(holiday =>
      holiday.getFullYear() === date.getFullYear() &&
      holiday.getMonth() === date.getMonth() &&
      holiday.getDate() === date.getDate()
    );
  }


  isBusinessDay(date) {
    const day = date.getDay();
    if (day === 0 || day === 6) return false;
    return !this.isUSBankingHoliday(date);
  }


  adjustForBusinessDay(date, adjustment) {
    if (!adjustment || adjustment === "none" || this.isBusinessDay(date)) {
      return { adjustedDate: date, originalDateString: null };
    }

    const newDate = new Date(date);
    const originalDateString = Utils.formatDateString(date);

    if (adjustment === "previous") {
      let maxIterations = 10; // Prevent infinite loop in edge cases
      while (!this.isBusinessDay(newDate) && maxIterations-- > 0) {
        newDate.setDate(newDate.getDate() - 1);
      }
    } else if (adjustment === "next") {
      let maxIterations = 10; // Prevent infinite loop in edge cases
      while (!this.isBusinessDay(newDate) && maxIterations-- > 0) {
        newDate.setDate(newDate.getDate() + 1);
      }
    } else if (adjustment === "nearest") {
      const prevDate = new Date(date);
      const nextDate = new Date(date);
      let prevDays = 0;
      let nextDays = 0;

      while (!this.isBusinessDay(prevDate) && prevDays <= 3) {
        prevDate.setDate(prevDate.getDate() - 1);
        prevDays++;
      }

      while (!this.isBusinessDay(nextDate) && nextDays <= 3) {
        nextDate.setDate(nextDate.getDate() + 1);
        nextDays++;
      }
      if (prevDays <= nextDays) {
        return { adjustedDate: prevDate, originalDateString };
      } else {
        return { adjustedDate: nextDate, originalDateString };
      }
    }

    return { adjustedDate: newDate, originalDateString };
  }


  getNthDayOfMonth(year, month, dayOfWeek, occurrence) {
    if (occurrence > 0) {
      let date = new Date(year, month, 1);
      while (date.getDay() !== dayOfWeek) {
        date.setDate(date.getDate() + 1);
      }
      date.setDate(date.getDate() + (occurrence - 1) * 7);
      if (date.getMonth() !== month) {
        return null;
      }

      return date;
    } else if (occurrence < 0) {
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();
      let date = new Date(year, month, daysInMonth);
      while (date.getDay() !== dayOfWeek) {
        date.setDate(date.getDate() - 1);
      }
      if (occurrence < -1) {
        date.setDate(date.getDate() + (occurrence + 1) * 7);
        if (date.getMonth() !== month) {
          return null;
        }
      }

      return date;
    }

    return null;
  }


  parseDaySpecificData(daySpecificData) {
    if (!daySpecificData || typeof daySpecificData !== "string") {
      return null;
    }
    const parts = daySpecificData.split("-");
    let occurrence;
    let dayOfWeek;

    if (parts.length === 2) {
      occurrence = parseInt(parts[0], 10);
      dayOfWeek = parseInt(parts[1], 10);
    } else if (parts.length === 3 && parts[0] === "") {
      occurrence = -parseInt(parts[1], 10);
      dayOfWeek = parseInt(parts[2], 10);
    } else {
      return null;
    }

    if (isNaN(occurrence) || isNaN(dayOfWeek)) {
      return null;
    }

    return { occurrence, dayOfWeek };
  }


  matchesDaySpecificRecurrence(rt, targetDate) {
    if (!rt.daySpecific) return false;

    try {
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();
      const parsed = this.parseDaySpecificData(rt.daySpecificData);
      if (!parsed) {
        return false;
      }
      const matchDate = this.getNthDayOfMonth(
        year,
        month,
        parsed.dayOfWeek,
        parsed.occurrence
      );
      if (!matchDate) return false;
      return (
        matchDate.getFullYear() === targetDate.getFullYear() &&
        matchDate.getMonth() === targetDate.getMonth() &&
        matchDate.getDate() === targetDate.getDate()
      );
    } catch (error) {
      console.error(`Error in matchesDaySpecificRecurrence: ${error.message}`);
      return false;
    }
  }


  applyRecurringTransactions(year, month) {
    // Check cache validity and use cached result if available
    const cacheKey = this._getCacheKey(year, month);
    const cacheValid = this._isCacheValid();

    if (cacheValid && this.expansionCache.has(cacheKey)) {
      // Cache hit - apply cached expanded transactions
      const cachedData = this.expansionCache.get(cacheKey);
      this._applyCachedTransactions(year, month, cachedData);
      return;
    }

    // Cache miss - perform full expansion
    const endOfMonth = new Date(year, month + 1, 0);
    const transactions = this.store.getTransactions();
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);

      if (transactions[dateString]) {
        transactions[dateString] = transactions[dateString].filter(t =>
          !t.recurringId || t.modifiedInstance
        );

        if (transactions[dateString].length === 0) {
          delete transactions[dateString];
        }
      }
    }

    this.store.getRecurringTransactions().forEach((rt) => {
      const startDate = Utils.parseDateString(rt.startDate);
      const endDate = rt.endDate ? Utils.parseDateString(rt.endDate) : null;
      const maxOccurrences = rt.maxOccurrences || null;
      // Always check adjacent months when business day adjustment is enabled
      // because adjustment can push transaction across month boundaries
      const needsCrossMonth =
        rt.businessDayAdjustment && rt.businessDayAdjustment !== "none";
      // Check previous and next month to handle cross-month adjustments
      const monthOffsets = needsCrossMonth ? [-1, 0, 1] : [0];

      monthOffsets.forEach((offset) => {
        const targetDate = new Date(year, month + offset, 1);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth();
        const targetStartOfMonth = new Date(targetYear, targetMonth, 1, 12, 0, 0);
        const targetEndOfMonth = new Date(targetYear, targetMonth + 1, 0, 12, 0, 0);

        if (
          startDate <= targetEndOfMonth &&
          (!endDate || endDate >= targetStartOfMonth)
        ) {
          switch (rt.recurrence) {
            case "once":
              this.applyOnceRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "daily":
              this.applyDailyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "weekly":
              this.applyWeeklyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "bi-weekly":
              this.applyBiWeeklyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "monthly":
              this.applyMonthlyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "semi-monthly":
              this.applySemiMonthlyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "quarterly":
              this.applyQuarterlyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "semi-annual":
              this.applySemiAnnualRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "yearly":
              this.applyYearlyRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            case "custom":
              this.applyCustomRecurrence(
                rt,
                startDate,
                endDate,
                maxOccurrences,
                targetYear,
                targetMonth,
                year,
                month
              );
              break;

            default:
              console.warn(`Unsupported recurrence type: ${rt.recurrence}`);
              break;
          }
        }
      });
    });

    // Collapse superseded rolling-allocation expansions before capturing the
    // cache, so the cached month and every re-render reflect the live bucket
    // only (see method comment for why the per-occurrence supersede guard alone
    // is insufficient here).
    this._collapseSupersededRollingAllocations();

    // Store in cache for future use - capture ALL recurring transactions for this month
    // not just newly added ones, to ensure cache restore works correctly
    const allRecurringForMonth = [];
    const endOfMonthForCache = new Date(year, month + 1, 0);
    for (let day = 1; day <= endOfMonthForCache.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);
      if (transactions[dateString]) {
        transactions[dateString].forEach(t => {
          if (t.recurringId && !t.modifiedInstance) {
            allRecurringForMonth.push({
              dateString,
              transaction: { ...t }
            });
          }
        });
      }
    }
    this.expansionCache.set(cacheKey, allRecurringForMonth);

    // Derived data (expanded transactions) is updated in memory
    // No need to persist to disk as it's re-generated on load/view
  }

  // Apply cached transactions to the store (used on cache hit)
  _applyCachedTransactions(year, month, cachedData) {
    const endOfMonth = new Date(year, month + 1, 0);
    const transactions = this.store.getTransactions();

    // First, collect existing modified instances to preserve them
    const modifiedInstances = new Map();
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);

      if (transactions[dateString]) {
        transactions[dateString].forEach(t => {
          if (t.recurringId && t.modifiedInstance) {
            const key = `${t.recurringId}-${t.originalDate || dateString}`;
            modifiedInstances.set(key, { dateString, transaction: t });
          }
        });
      }
    }

    // Clear existing recurring transactions for this month (same as full expansion)
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);

      if (transactions[dateString]) {
        transactions[dateString] = transactions[dateString].filter(t =>
          !t.recurringId || t.modifiedInstance
        );

        if (transactions[dateString].length === 0) {
          delete transactions[dateString];
        }
      }
    }

    // Apply cached transactions (but skip if modified instance exists)
    for (const item of cachedData) {
      const { dateString, transaction } = item;

      // Check if there's a modified instance that should override this
      const key = `${transaction.recurringId}-${transaction.originalDate || dateString}`;
      if (modifiedInstances.has(key)) {
        // Modified instance exists - don't overwrite it
        continue;
      }

      if (!transactions[dateString]) {
        transactions[dateString] = [];
      }
      // Check if this transaction already exists
      const existsAlready = transactions[dateString].some(t =>
        t.recurringId === transaction.recurringId &&
        (t.originalDate || dateString) === (transaction.originalDate || dateString)
      );
      if (!existsAlready) {
        transactions[dateString].push({ ...transaction });
      }
    }
  }


  // A rolling recurring allocation (allocated, no autoCloseout) keeps only its
  // latest occurrence on/before today live; earlier periods are forfeited so
  // their unspent reserve releases when the next period's bucket arrives. The
  // per-occurrence supersede guard in addRecurringTransactionToDate can't enforce
  // this on its own: applyRecurringTransactions clears the month's recurring
  // instances and re-expands chronologically, so when an early period is being
  // re-added its later siblings haven't been re-materialized yet and the guard
  // finds no supersedor. closeOutExpiredAllocations also runs *before* expansion,
  // so on a fresh render every past period of the same series piles up. This pass
  // runs right after expansion to drop the superseded ephemeral expansions,
  // mirroring closeOutExpiredAllocations' rolling branch. It only removes pure
  // expansions (no id, not a modified instance); persisted/drawn buckets are left
  // to the sweep, which records the deletion in _deletedItems for sync safety.
  _collapseSupersededRollingAllocations() {
    const transactions = this.store.getTransactions();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // Live bucket per rolling series = latest occurrence dated on/before today.
    // Consider every materialized instance (including drawn, id-bearing ones) so
    // the live date is correct even when the latest period was drawn from.
    const liveDate = new Map();
    Object.keys(transactions).forEach((date) => {
      if (date > todayStr) return;
      transactions[date].forEach((t) => {
        if (
          t.allocated === true &&
          t.autoCloseout !== true &&
          t.recurringId &&
          t.type === "expense"
        ) {
          const cur = liveDate.get(t.recurringId);
          if (!cur || date > cur) liveDate.set(t.recurringId, date);
        }
      });
    });

    if (liveDate.size === 0) return;

    Object.keys(transactions).forEach((date) => {
      const arr = transactions[date];
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i];
        if (
          t.type !== "expense" ||
          t.allocated !== true ||
          t.autoCloseout === true ||
          !t.recurringId ||
          t.id ||
          t.modifiedInstance
        ) {
          continue;
        }
        const live = liveDate.get(t.recurringId);
        if (live && date < live) arr.splice(i, 1);
      }
      if (arr.length === 0) delete transactions[date];
    });
  }


  applyOnceRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    let targetDate = new Date(startDate);
    let originalDateString = null;
    if (rt.businessDayAdjustment) {
      const { adjustedDate, originalDateString: origDate } =
        this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
      targetDate = adjustedDate;
      originalDateString = origDate;
    }
    if (endDate && targetDate > endDate) {
      return;
    }
    if (
      targetDate.getFullYear() === filterYear &&
      targetDate.getMonth() === filterMonth
    ) {
      const dateString = Utils.formatDateString(targetDate);
      this.addRecurringTransactionToDate(
        rt,
        dateString,
        targetDate,
        startDate,
        originalDateString
      );
    }
  }


  applyDailyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);

    let currentDate = new Date(
      Math.max(startDate.getTime(), startOfMonth.getTime())
    );
    let occurrenceCount = 0;

    if (startDate < startOfMonth && maxOccurrences) {
      occurrenceCount = this.daysBetween(startDate, startOfMonth);
    }

    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } =
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }
      if (!endDate || targetDate <= endDate) {
        if (
          targetDate.getFullYear() === filterYear &&
          targetDate.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(targetDate);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            targetDate,
            startDate,
            originalDateString
          );
        }
      }
      currentDate.setDate(currentDate.getDate() + 1);
      occurrenceCount++;
    }
  }


  applyWeeklyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    let currentDate = new Date(startDate);
    let occurrenceCount = 0;
    while (currentDate < startOfMonth) {
      currentDate.setDate(currentDate.getDate() + 7);
      occurrenceCount++;
    }
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } =
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }
      if (!endDate || targetDate <= endDate) {
        if (
          targetDate.getFullYear() === filterYear &&
          targetDate.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(targetDate);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            targetDate,
            startDate,
            originalDateString
          );
        }
      }
      currentDate.setDate(currentDate.getDate() + 7);
      occurrenceCount++;
    }
  }


  applyBiWeeklyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    let currentDate = new Date(startDate);
    let occurrenceCount = 0;
    while (currentDate < startOfMonth) {
      currentDate.setDate(currentDate.getDate() + 14);
      occurrenceCount++;
    }
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } =
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }
      if (!endDate || targetDate <= endDate) {
        if (
          targetDate.getFullYear() === filterYear &&
          targetDate.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(targetDate);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            targetDate,
            startDate,
            originalDateString
          );
        }
      }
      currentDate.setDate(currentDate.getDate() + 14);
      occurrenceCount++;
    }
  }


  applyMonthlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    if (rt.daySpecific) {
      this.applyDaySpecificMonthlyRecurrence(
        rt,
        startDate,
        endDate,
        maxOccurrences,
        year,
        month,
        filterYear,
        filterMonth
      );
      return;
    }
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);

    if ((endDate && endDate < startOfMonth) || startDate > endOfMonth) {
      return;
    }
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());
    if (maxOccurrences && monthsSinceStart >= maxOccurrences) {
      return;
    }
    const startDay = startDate.getDate();
    // "Last day of every month" is an explicit opt-in flag now, not inferred
    // from the start date. Inferring it caused a bill started on the 30th (or a
    // Feb-28 start) to silently jump to the 31st in longer months; the flag lets
    // the user choose. Legacy recurrences that relied on the old inference are
    // migrated to carry the flag on load (see TransactionStore.loadData).
    const isLastDayOfMonth = rt.lastDayOfMonth === true;
    let targetDay;

    if (isLastDayOfMonth) {
      targetDay = endOfMonth.getDate();
    } else {
      // Use adjustDayForMonth to handle leap years and short months
      targetDay = this.adjustDayForMonth(year, month, startDay);
    }
    let targetDate = new Date(year, month, targetDay, 12, 0, 0);
    let originalDateString = null;
    if (rt.businessDayAdjustment) {
      const { adjustedDate, originalDateString: origDate } =
        this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
      targetDate = adjustedDate;
      originalDateString = origDate;
    }
    if (!endDate || targetDate <= endDate) {
      if (
        targetDate.getFullYear() === filterYear &&
        targetDate.getMonth() === filterMonth
      ) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }
    }
  }


  applyDaySpecificMonthlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);

    if ((endDate && endDate < startOfMonth) || startDate > endOfMonth) {
      return;
    }
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());
    if (maxOccurrences && monthsSinceStart >= maxOccurrences) {
      return;
    }
    const parsed = this.parseDaySpecificData(rt.daySpecificData);
    if (!parsed) {
      return;
    }
    const targetDate = this.getNthDayOfMonth(
      year,
      month,
      parsed.dayOfWeek,
      parsed.occurrence
    );

    if (!targetDate || (endDate && targetDate > endDate)) {
      return;
    }
    // Lower-bound guard: an "Nth weekday" can fall earlier in the month than
    // the recurrence start (start Jan 20, rule "1st Monday" → Jan 5), which
    // would materialize a phantom occurrence dated before the rule began.
    // Compare by calendar date because getNthDayOfMonth returns local midnight
    // while parseDateString (startDate) returns noon. The sibling
    // countOccurrencesBefore gates the same way.
    if (Utils.formatDateString(targetDate) < Utils.formatDateString(startDate)) {
      return;
    }
    let adjustedDate = targetDate;
    let originalDateString = null;

    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
      adjustedDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }
    if (!endDate || adjustedDate <= endDate) {
      if (
        adjustedDate.getFullYear() === filterYear &&
        adjustedDate.getMonth() === filterMonth
      ) {
        const dateString = Utils.formatDateString(adjustedDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          adjustedDate,
          startDate,
          originalDateString
        );
      }
    }
  }


  applySemiMonthlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    const lastDayOfMonth = endOfMonth.getDate();
    let firstDate = rt.semiMonthlyDays ? rt.semiMonthlyDays[0] : 1;
    let secondDate = rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15;
    const isLastDayOfMonthSpecial = rt.semiMonthlyLastDay || secondDate === 31;
    if (isLastDayOfMonthSpecial) {
      secondDate = lastDayOfMonth;
    }
    let occurrenceCount = 0;
    if (maxOccurrences && startDate < startOfMonth) {
      const monthsDifference =
        (startOfMonth.getFullYear() - startDate.getFullYear()) * 12 +
        (startOfMonth.getMonth() - startDate.getMonth());
      // Compare against the start month's effective second day, not the
      // viewing month's. When isLastDayOfMonthSpecial, the start month's
      // second occurrence falls on its own last day.
      const startMonthSecondDate = isLastDayOfMonthSpecial
        ? new Date(
            startDate.getFullYear(),
            startDate.getMonth() + 1,
            0
          ).getDate()
        : (rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15);
      if (startDate.getDate() <= firstDate) {
        occurrenceCount = monthsDifference * 2;
      } else if (startDate.getDate() <= startMonthSecondDate) {
        occurrenceCount = monthsDifference * 2 - 1;
      } else {
        occurrenceCount = monthsDifference * 2 - 2;
      }
    }
    if (
      (!maxOccurrences || occurrenceCount < maxOccurrences) &&
      (!endDate || new Date(year, month, firstDate, 12, 0, 0) <= endDate) &&
      startDate <= new Date(year, month, firstDate, 12, 0, 0)
    ) {
      let firstDateObj = new Date(year, month, firstDate, 12, 0, 0);
      let originalDateString = null;
      if (rt.businessDayAdjustment) {
        const result = this.adjustForBusinessDay(
          firstDateObj,
          rt.businessDayAdjustment
        );
        firstDateObj = result.adjustedDate;
        originalDateString = result.originalDateString;
      }
      if (!endDate || firstDateObj <= endDate) {
        if (
          firstDateObj.getFullYear() === filterYear &&
          firstDateObj.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(firstDateObj);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            firstDateObj,
            startDate,
            originalDateString
          );
        }
      }

      occurrenceCount++;
    }
    if (
      (!maxOccurrences || occurrenceCount < maxOccurrences) &&
      (!endDate || new Date(year, month, secondDate, 12, 0, 0) <= endDate) &&
      startDate <= new Date(year, month, secondDate, 12, 0, 0)
    ) {
      let secondDateObj = new Date(year, month, secondDate, 12, 0, 0);
      let originalDateString = null;
      if (rt.businessDayAdjustment) {
        const result = this.adjustForBusinessDay(
          secondDateObj,
          rt.businessDayAdjustment
        );
        secondDateObj = result.adjustedDate;
        originalDateString = result.originalDateString;
      }
      if (!endDate || secondDateObj <= endDate) {
        if (
          secondDateObj.getFullYear() === filterYear &&
          secondDateObj.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(secondDateObj);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            secondDateObj,
            startDate,
            originalDateString
          );
        }
      }
    }
  }


  applyQuarterlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startMonth = startDate.getMonth();
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startMonth);
    if (monthsSinceStart % 3 !== 0) {
      return;
    }
    const occurrenceNumber = monthsSinceStart / 3;
    if (maxOccurrences && occurrenceNumber >= maxOccurrences) {
      return;
    }
    const startDay = startDate.getDate();
    // Use adjustDayForMonth to handle leap years and short months
    const targetDay = this.adjustDayForMonth(year, month, startDay);
    let targetDate = new Date(year, month, targetDay, 12, 0, 0);
    let originalDateString = null;
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }
    if (!endDate || targetDate <= endDate) {
      if (
        targetDate.getFullYear() === filterYear &&
        targetDate.getMonth() === filterMonth
      ) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }
    }
  }


  applySemiAnnualRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    const startMonth = startDate.getMonth();
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startMonth);
    if (monthsSinceStart % 6 !== 0) {
      return;
    }
    const occurrenceNumber = monthsSinceStart / 6;
    if (maxOccurrences && occurrenceNumber >= maxOccurrences) {
      return;
    }
    const startDay = startDate.getDate();
    // Use adjustDayForMonth to handle leap years and short months
    const targetDay = this.adjustDayForMonth(year, month, startDay);
    let targetDate = new Date(year, month, targetDay, 12, 0, 0);
    let originalDateString = null;
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }
    if (!endDate || targetDate <= endDate) {
      if (
        targetDate.getFullYear() === filterYear &&
        targetDate.getMonth() === filterMonth
      ) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }
    }
  }


  applyYearlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    if (month !== startDate.getMonth()) {
      return;
    }
    const yearsSinceStart = year - startDate.getFullYear();
    if (maxOccurrences && yearsSinceStart >= maxOccurrences) {
      return;
    }
    // Use adjustDayForMonth to handle leap years and short months consistently
    const targetDay = this.adjustDayForMonth(year, month, startDate.getDate());
    let targetDate = new Date(year, month, targetDay, 12, 0, 0);
    let originalDateString = null;
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }
    if (!endDate || targetDate <= endDate) {
      if (
        targetDate.getFullYear() === filterYear &&
        targetDate.getMonth() === filterMonth
      ) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }
    }
  }


  applyCustomRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month,
    filterYear = year,
    filterMonth = month
  ) {
    if (!rt.customInterval) {
      console.warn("Custom recurrence missing interval data");
      return;
    }

    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    let occurrenceCount = 0;
    let currentDate = new Date(startDate);
    while (currentDate < startOfMonth) {
      currentDate = this.getCustomIntervalDate(
        startDate,
        rt.customInterval,
        occurrenceCount + 1
      );
      occurrenceCount++;
    }
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;

      if (rt.businessDayAdjustment) {
        const result = this.adjustForBusinessDay(
          targetDate,
          rt.businessDayAdjustment
        );
        targetDate = result.adjustedDate;
        originalDateString = result.originalDateString;
      }
      if (!endDate || targetDate <= endDate) {
        if (
          targetDate.getFullYear() === filterYear &&
          targetDate.getMonth() === filterMonth
        ) {
          const dateString = Utils.formatDateString(targetDate);
          this.addRecurringTransactionToDate(
            rt,
            dateString,
            targetDate,
            startDate,
            originalDateString
          );
        }
      }
      occurrenceCount++;
      currentDate = this.getCustomIntervalDate(
        startDate,
        rt.customInterval,
        occurrenceCount
      );
    }
  }


  getCustomIntervalDate(startDate, customInterval, occurrenceCount) {
    const result = new Date(startDate);

    if (customInterval.unit === "days") {
      result.setDate(result.getDate() + customInterval.value * occurrenceCount);
    } else if (customInterval.unit === "weeks") {
      result.setDate(
        result.getDate() + customInterval.value * 7 * occurrenceCount
      );
    } else if (customInterval.unit === "months") {
      result.setMonth(
        result.getMonth() + customInterval.value * occurrenceCount
      );
    }

    return result;
  }


  addRecurringTransactionToDate(rt, dateString, currentDate, startDate, originalDateString = null) {
    const transactions = this.store.getTransactions();

    if (!transactions[dateString]) {
      transactions[dateString] = [];
    }
    const occurrenceKey = originalDateString || dateString;
    const existingInstance = transactions[dateString].some((t) => {
      if (t.recurringId !== rt.id) {
        return false;
      }
      const existingKey = t.originalDate || dateString;
      return existingKey === occurrenceKey;
    });
    if (!existingInstance) {
      if (rt.allocated === true) {
        const now = new Date();
        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        if (dateString < todayStr) {
          if (rt.autoCloseout === true) {
            // Auto-close-out allocations close out once their own date passes,
            // so never materialize an instance for a date already in the past.
            return;
          }
          // Rolling allocation (no auto close-out): the live bucket is the
          // latest occurrence on/before today and must persist even though its
          // date is in the past. Earlier, superseded periods are forfeited by
          // closeOutExpiredAllocations and must not be re-materialized (else
          // re-expansion would resurrect them). A period is superseded when a
          // sibling instance already exists in (dateString, today].
          const superseded = Object.keys(transactions).some(
            (d) =>
              d > dateString &&
              d <= todayStr &&
              transactions[d].some(
                (t) => t.recurringId === rt.id && t.allocated === true
              )
          );
          if (superseded) {
            return;
          }
        }
      }
      const scheduledDate = originalDateString
        ? Utils.parseDateString(originalDateString)
        : currentDate;
      const amount = rt.variableAmount
        ? this.calculateVariableAmount(rt, scheduledDate, startDate)
        : rt.amount;

      const newTransaction = {
        amount: amount,
        type: rt.type,
        description: rt.description,
        recurringId: rt.id,
      };
      if (rt.debtId) {
        newTransaction.debtId = rt.debtId;
      }
      if (rt.debtRole) {
        newTransaction.debtRole = rt.debtRole;
      }
      if (rt.debtName) {
        newTransaction.debtName = rt.debtName;
      }
      if (originalDateString) {
        newTransaction.originalDate = originalDateString;
      }
      if (rt.type === "expense") {
        newTransaction.settled = rt.settled !== false;
        newTransaction.allocated = rt.allocated === true;
        if (rt.allocated === true && rt.autoCloseout === true) {
          newTransaction.autoCloseout = true;
        }
      }

      transactions[dateString].push(newTransaction);
    }
  }


  calculateVariableAmount(rt, currentDate, startDate) {
    if (!rt.variableAmount) {
      return rt.amount;
    }

    let amount = rt.amount;

    if (rt.variableType === "percentage") {
      let occurrences = 0;

      switch (rt.recurrence) {
        case "once":
          occurrences = 0;
          break;
        case "daily":
          occurrences = this.daysBetween(startDate, currentDate);
          break;
        case "weekly":
          occurrences = Math.floor(this.daysBetween(startDate, currentDate) / 7);
          break;
        case "bi-weekly":
          occurrences = Math.floor(this.daysBetween(startDate, currentDate) / 14);
          break;
        case "monthly":
          occurrences =
            (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
            currentDate.getMonth() -
            startDate.getMonth();
          break;
        case "semi-monthly":
          occurrences = this.countOccurrencesBefore(rt, currentDate);
          break;
        case "quarterly":
          occurrences = Math.floor(
            ((currentDate.getFullYear() - startDate.getFullYear()) * 12 +
              currentDate.getMonth() -
              startDate.getMonth()) /
            3
          );
          break;
        case "semi-annual":
          occurrences = Math.floor(
            ((currentDate.getFullYear() - startDate.getFullYear()) * 12 +
              currentDate.getMonth() -
              startDate.getMonth()) /
            6
          );
          break;
        case "yearly":
          occurrences = currentDate.getFullYear() - startDate.getFullYear();
          break;
        case "custom":
          if (rt.customInterval) {
            const custom = rt.customInterval;
            const intervalValue = custom.value || 1;
            if (custom.unit === "days") {
              occurrences = Math.floor(
                this.daysBetween(startDate, currentDate) / intervalValue
              );
            } else if (custom.unit === "weeks") {
              occurrences = Math.floor(
                this.daysBetween(startDate, currentDate) / (intervalValue * 7)
              );
            } else if (custom.unit === "months") {
              const monthsDiff =
                (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
                currentDate.getMonth() -
                startDate.getMonth();
              occurrences = Math.floor(monthsDiff / intervalValue);
            }
          }
          break;
      }
      // Use linear calculation (not compound) for variable amounts
      // Linear: base + (base * percentage * occurrences)
      const baseAmount = rt.amount;
      amount = baseAmount + (baseAmount * (rt.variablePercentage / 100) * occurrences);
    }

    return amount;
  }


  countOccurrencesBefore(rt, beforeDate) {
    const startDate = Utils.parseDateString(rt.startDate);
    let count = 0;

    // Count of occurrences strictly before `beforeDate`, with index 0 = startDate.
    // For day-stepped intervals, ceil(days/step) gives the right answer for both
    // boundary days and non-boundary days. For month-stepped intervals, the count
    // is the number of completed step-periods plus 1 if the anniversary in the
    // current period has already passed (beforeDate.day > startDate.day).
    const daysStep = (step) => {
      const d = this.daysBetween(startDate, beforeDate);
      if (d <= 0) return 0;
      return Math.ceil(d / step);
    };
    const monthsStep = (step) => {
      const monthsDiff =
        (beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
        (beforeDate.getMonth() - startDate.getMonth());
      if (monthsDiff < 0) return 0;
      const k = Math.floor(monthsDiff / step);
      const remainder = monthsDiff % step;
      if (remainder !== 0) {
        // Most recent anniversary is in a prior period — definitely passed
        return k + 1;
      }
      // Anniversary is in the current period; counted only if it has passed
      return k + (beforeDate.getDate() > startDate.getDate() ? 1 : 0);
    };

    switch (rt.recurrence) {
      case "once":
        count = beforeDate > startDate ? 1 : 0;
        break;
      case "daily":
        count = Math.max(0, this.daysBetween(startDate, beforeDate));
        break;

      case "weekly":
        count = daysStep(7);
        break;

      case "bi-weekly":
        count = daysStep(14);
        break;

      case "monthly":
        if (rt.daySpecific) {
          const parsed = this.parseDaySpecificData(rt.daySpecificData);
          if (parsed) {
            let y = startDate.getFullYear();
            let m = startDate.getMonth();
            const endY = beforeDate.getFullYear();
            const endM = beforeDate.getMonth();
            while (y < endY || (y === endY && m <= endM)) {
              const occDate = this.getNthDayOfMonth(
                y, m, parsed.dayOfWeek, parsed.occurrence
              );
              if (occDate && occDate >= startDate && occDate < beforeDate) {
                count++;
              }
              m++;
              if (m > 11) { m = 0; y++; }
            }
            break;
          }
        }
        count = monthsStep(1);
        break;

      case "semi-monthly": {
        const firstDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[0] : 1;
        const secondDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15;
        const isLastDay = rt.semiMonthlyLastDay || secondDay === 31;
        const startMs = new Date(
          startDate.getFullYear(),
          startDate.getMonth(),
          startDate.getDate(),
          12, 0, 0
        ).getTime();
        const beforeMs = new Date(
          beforeDate.getFullYear(),
          beforeDate.getMonth(),
          beforeDate.getDate(),
          12, 0, 0
        ).getTime();
        let y = startDate.getFullYear();
        let m = startDate.getMonth();
        const endY = beforeDate.getFullYear();
        const endM = beforeDate.getMonth();
        while (y < endY || (y === endY && m <= endM)) {
          const lastDayThisMonth = new Date(y, m + 1, 0).getDate();
          const day1 = Math.min(firstDay, lastDayThisMonth);
          const day2 = isLastDay
            ? lastDayThisMonth
            : Math.min(secondDay, lastDayThisMonth);
          [day1, day2].forEach((d) => {
            const occMs = new Date(y, m, d, 12, 0, 0).getTime();
            if (occMs >= startMs && occMs < beforeMs) count++;
          });
          m++;
          if (m > 11) { m = 0; y++; }
        }
        break;
      }

      case "quarterly":
        count = monthsStep(3);
        break;

      case "semi-annual":
        count = monthsStep(6);
        break;

      case "yearly":
        count = beforeDate.getFullYear() - startDate.getFullYear();
        // The next anniversary in beforeDate's year is at (startDate.month, startDate.day);
        // if (beforeDate.month, beforeDate.day) is past it, that anniversary has happened.
        if (
          beforeDate.getMonth() > startDate.getMonth() ||
          (beforeDate.getMonth() === startDate.getMonth() &&
            beforeDate.getDate() > startDate.getDate())
        ) {
          count++;
        }
        break;

      case "custom": {
        if (rt.customInterval) {
          const intervalValue = rt.customInterval.value || 1;
          if (rt.customInterval.unit === "days") {
            count = daysStep(intervalValue);
          } else if (rt.customInterval.unit === "weeks") {
            count = daysStep(intervalValue * 7);
          } else if (rt.customInterval.unit === "months") {
            count = monthsStep(intervalValue);
          }
        }
        break;
      }
    }

    return Math.max(0, count);
  }


  editTransaction(date, index, updatedTransaction, editScope) {
    const transactions = this.store.getTransactions();
    if (!transactions[date] || !transactions[date][index]) {
      return false;
    }
    const transaction = transactions[date][index];

    const isRecurring = transaction.recurringId !== undefined;

    // Invalidate cache when editing recurring transactions
    if (isRecurring) {
      this.invalidateCache();
    }

    if (!isRecurring || editScope === "this") {
      this.store.updateTransaction(date, index, {
        ...updatedTransaction,
        modifiedInstance: isRecurring ? true : undefined,
      });
      return true;
    }

    const recurringId = transaction.recurringId;
    const recurringTransaction = this.getRecurringTransactionById(recurringId);

    if (editScope === "future") {
      const startDate = Utils.parseDateString(date);
      const newRecurringId = Utils.generateUniqueId();

      const newRecurringTransaction = {
        id: newRecurringId,
        startDate: Utils.formatDateString(startDate),
        amount: updatedTransaction.amount,
        type: updatedTransaction.type,
        description: updatedTransaction.description,
        recurrence: recurringTransaction.recurrence,
      };
      if (recurringTransaction.daySpecific) {
        newRecurringTransaction.daySpecific = recurringTransaction.daySpecific;
        newRecurringTransaction.daySpecificData =
          recurringTransaction.daySpecificData;
      }

      if (recurringTransaction.businessDayAdjustment) {
        newRecurringTransaction.businessDayAdjustment =
          recurringTransaction.businessDayAdjustment;
      }

      if (recurringTransaction.semiMonthlyDays) {
        newRecurringTransaction.semiMonthlyDays = [
          ...recurringTransaction.semiMonthlyDays,
        ];
      }
      if (recurringTransaction.semiMonthlyLastDay) {
        newRecurringTransaction.semiMonthlyLastDay = true;
      }
      if (recurringTransaction.lastDayOfMonth) {
        newRecurringTransaction.lastDayOfMonth = true;
      }

      if (recurringTransaction.customInterval) {
        newRecurringTransaction.customInterval = {
          ...recurringTransaction.customInterval,
        };
      }

      if (recurringTransaction.variableAmount) {
        newRecurringTransaction.variableAmount =
          recurringTransaction.variableAmount;
        newRecurringTransaction.variableType =
          recurringTransaction.variableType;
        newRecurringTransaction.variablePercentage =
          recurringTransaction.variablePercentage;
      }

      if (recurringTransaction.settled !== undefined) {
        newRecurringTransaction.settled = recurringTransaction.settled;
      }
      if (recurringTransaction.allocated !== undefined) {
        newRecurringTransaction.allocated = recurringTransaction.allocated;
      }
      if (recurringTransaction.autoCloseout !== undefined) {
        newRecurringTransaction.autoCloseout = recurringTransaction.autoCloseout;
      }
      if (recurringTransaction.debtId) {
        newRecurringTransaction.debtId = recurringTransaction.debtId;
      }
      if (recurringTransaction.debtRole) {
        newRecurringTransaction.debtRole = recurringTransaction.debtRole;
      }
      if (recurringTransaction.debtName) {
        newRecurringTransaction.debtName = recurringTransaction.debtName;
      }

      if (recurringTransaction.endDate) {
        const originalEndDate = Utils.parseDateString(
          recurringTransaction.endDate
        );
        if (originalEndDate >= startDate) {
          newRecurringTransaction.endDate = recurringTransaction.endDate;
        }
      }

      if (recurringTransaction.maxOccurrences) {
        const occurrencesBefore = this.countOccurrencesBefore(
          recurringTransaction,
          startDate
        );

        if (recurringTransaction.maxOccurrences > occurrencesBefore) {
          newRecurringTransaction.maxOccurrences =
            recurringTransaction.maxOccurrences - occurrencesBefore;
        }
      }
      if (recurringTransaction) {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() - 1);
        this.store.updateRecurringTransaction(recurringId, {
          endDate: Utils.formatDateString(endDate),
        });
      }
      this.store.addRecurringTransaction(newRecurringTransaction);
      this.store.updateTransaction(date, index, {
        amount: updatedTransaction.amount,
        type: updatedTransaction.type,
        description: updatedTransaction.description,
        recurringId: newRecurringId,
      });
      const skippedTransactions = this.store.getSkippedTransactions();
      Object.keys(skippedTransactions).forEach((skipDate) => {
        if (Utils.parseDateString(skipDate) >= startDate) {
          const skipIndex = skippedTransactions[skipDate].indexOf(recurringId);
          if (skipIndex > -1) {
            skippedTransactions[skipDate].splice(skipIndex, 1);
            if (skippedTransactions[skipDate].length === 0) {
              delete skippedTransactions[skipDate];
            }
          }
        }
      });

      this.store.saveData();
      return true;
    }

    if (editScope === "all") {
      if (recurringTransaction) {
        this.store.updateRecurringTransaction(recurringId, {
          amount: updatedTransaction.amount,
          type: updatedTransaction.type,
          description: updatedTransaction.description,
        });
        Object.keys(transactions).forEach((dateKey) => {
          transactions[dateKey].forEach((t, i) => {
            if (t.recurringId === recurringId && !t.modifiedInstance) {
              this.store.updateTransaction(dateKey, i, {
                amount: updatedTransaction.amount,
                type: updatedTransaction.type,
                description: updatedTransaction.description,
              });
            }
          });
        });

        return true;
      }
    }

    return false;
  }


  deleteTransaction(date, index, deleteFuture) {
    const transactions = this.store.getTransactions();
    if (!transactions[date] || !transactions[date][index]) {
      return false;
    }
    const transaction = transactions[date][index];

    if (transaction.recurringId) {
      // Invalidate cache when deleting recurring transactions
      this.invalidateCache();
      if (deleteFuture) {
        const recurringId = transaction.recurringId;
        const currentDate = Utils.parseDateString(date);
        const recurringTransaction =
          this.getRecurringTransactionById(recurringId);
        if (recurringTransaction) {
          const endDate = new Date(currentDate);
          endDate.setDate(endDate.getDate() - 1);
          this.store.updateRecurringTransaction(recurringId, {
            endDate: Utils.formatDateString(endDate),
          });
        }
        Object.keys(transactions).forEach((dateKey) => {
          if (Utils.parseDateString(dateKey) >= currentDate) {
            const newTransactions = transactions[dateKey].filter(
              (t) => t.recurringId !== recurringId
            );

            if (newTransactions.length === 0) {
              delete transactions[dateKey];
            } else {
              transactions[dateKey] = newTransactions;
            }
          }
        });
        const skippedTransactions = this.store.getSkippedTransactions();
        Object.keys(skippedTransactions).forEach((skipDate) => {
          if (Utils.parseDateString(skipDate) >= currentDate) {
            const index = skippedTransactions[skipDate].indexOf(recurringId);
            if (index > -1) {
              skippedTransactions[skipDate].splice(index, 1);
              if (skippedTransactions[skipDate].length === 0) {
                delete skippedTransactions[skipDate];
              }
            }
          }
        });

        this.store.debouncedSave();
      } else {
        this.store.setTransactionSkipped(date, transaction.recurringId, true);
      }

      return true;
    } else {
      this.store.deleteTransaction(date, index);
      return true;
    }
  }
}
