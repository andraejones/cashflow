// Recurring transaction manager

class RecurringTransactionManager {

  constructor(store) {
    this.store = store;
    // Cache for expanded recurring transactions per month
    // Key format: "YYYY-MM" + hash of recurring transaction data
    this.expansionCache = new Map();
    this.lastRecurringHash = null;
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

  // Public wrapper for _getCacheKey
  getCacheKey(year, month) {
    return this._getCacheKey(year, month);
  }

  // Public method to check if a month is cached
  isCached(year, month) {
    if (!this._isCacheValid()) {
      return false;
    }
    const cacheKey = this._getCacheKey(year, month);
    return this.expansionCache.has(cacheKey);
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

  
  // Parse date string to Date object using noon to avoid DST issues
  parseDateString(dateString) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day, 12, 0, 0);
  }

  
  // Calculate days between two dates consistently using UTC
  daysBetween(startDate, endDate) {
    const startUtc = Date.UTC(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate()
    );
    const endUtc = Date.UTC(
      endDate.getFullYear(),
      endDate.getMonth(),
      endDate.getDate()
    );
    return Math.floor((endUtc - startUtc) / (1000 * 60 * 60 * 24));
  }

  // Check if a year is a leap year
  isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
  }

  // Adjust day for months with fewer days (handles Feb 29 in non-leap years, etc.)
  adjustDayForMonth(year, month, preferredDay) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    return Math.min(preferredDay, daysInMonth);
  }

  
  isBusinessDay(date) {
    const day = date.getDay();
    return day !== 0 && day !== 6;
  }

  
  adjustForBusinessDay(date, adjustment) {
    if (!adjustment || adjustment === "none" || this.isBusinessDay(date)) {
      return { adjustedDate: date, originalDateString: null };
    }

    const newDate = new Date(date);
    const originalDateString = Utils.formatDateString(date);

    if (adjustment === "previous") {
      while (!this.isBusinessDay(newDate)) {
        newDate.setDate(newDate.getDate() - 1);
      }
    } else if (adjustment === "next") {
      while (!this.isBusinessDay(newDate)) {
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
        transactions[dateString] = transactions[dateString].filter(t => {
          if (!t.recurringId || t.modifiedInstance) {
            return true;
          }
          return false;
        });

        if (transactions[dateString].length === 0) {
          delete transactions[dateString];
        }
      }
    }

    // Track which transactions we add for caching
    const addedTransactions = [];
    this._currentAddedTransactions = addedTransactions;

    this.store.getRecurringTransactions().forEach((rt) => {
      const startDate = this.parseDateString(rt.startDate);
      const endDate = rt.endDate ? this.parseDateString(rt.endDate) : null;
      const maxOccurrences = rt.maxOccurrences || null;
      const needsCrossMonth =
        rt.businessDayAdjustment && rt.businessDayAdjustment !== "none";
      const monthOffsets = needsCrossMonth ? [-1, 0, 1] : [0];

      monthOffsets.forEach((offset) => {
        const targetDate = new Date(year, month + offset, 1);
        const targetYear = targetDate.getFullYear();
        const targetMonth = targetDate.getMonth();
        const targetStartOfMonth = new Date(targetYear, targetMonth, 1);
        const targetEndOfMonth = new Date(targetYear, targetMonth + 1, 0);

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

    // Store in cache for future use
    this.expansionCache.set(cacheKey, addedTransactions);
    this._currentAddedTransactions = null;

    this.store.saveData(false);
  }

  // Apply cached transactions to the store (used on cache hit)
  _applyCachedTransactions(year, month, cachedData) {
    const endOfMonth = new Date(year, month + 1, 0);
    const transactions = this.store.getTransactions();

    // First, clear existing recurring transactions for this month (same as full expansion)
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);

      if (transactions[dateString]) {
        transactions[dateString] = transactions[dateString].filter(t => {
          if (!t.recurringId || t.modifiedInstance) {
            return true;
          }
          return false;
        });

        if (transactions[dateString].length === 0) {
          delete transactions[dateString];
        }
      }
    }

    // Apply cached transactions
    for (const item of cachedData) {
      const { dateString, transaction } = item;
      if (!transactions[dateString]) {
        transactions[dateString] = [];
      }
      // Check if this transaction already exists (e.g., modified instance)
      const existsAlready = transactions[dateString].some(t =>
        t.recurringId === transaction.recurringId &&
        (t.originalDate || dateString) === (transaction.originalDate || dateString)
      );
      if (!existsAlready) {
        transactions[dateString].push({ ...transaction });
      }
    }

    this.store.saveData(false);
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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    if ((endDate && endDate < startOfMonth) || startDate > endOfMonth) {
      return;
    }
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());
    if (maxOccurrences && monthsSinceStart >= maxOccurrences) {
      return;
    }
    const startDay = startDate.getDate();
    const lastDayOfStartMonth = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      0
    ).getDate();

    const isLastDayOfMonth = startDay === lastDayOfStartMonth;
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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

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
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
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
      if (startDate.getDate() <= firstDate) {
        occurrenceCount = monthsDifference * 2;
      } else if (startDate.getDate() <= secondDate) {
        occurrenceCount = monthsDifference * 2 - 1;
      } else {
        occurrenceCount = monthsDifference * 2 - 2;
      }
    }
    if (
      (!maxOccurrences || occurrenceCount < maxOccurrences) &&
      (!endDate || new Date(year, month, firstDate) <= endDate) &&
      startDate <= new Date(year, month, firstDate)
    ) {
      let firstDateObj = new Date(year, month, firstDate);
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
      (!endDate || new Date(year, month, secondDate) <= endDate) &&
      startDate <= new Date(year, month, secondDate)
    ) {
      let secondDateObj = new Date(year, month, secondDate);
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
    let targetDay = startDate.getDate();
    if (month === 1 && targetDay === 29) {
      const isLeapYear = new Date(year, 1, 29).getMonth() === 1;
      if (!isLeapYear) {
        targetDay = 28;
      }
    }
    let targetDate = new Date(year, month, targetDay);
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

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
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
      const scheduledDate = originalDateString
        ? this.parseDateString(originalDateString)
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

      transactions[dateString].push(newTransaction);

      // Track for caching if we're building the cache
      if (this._currentAddedTransactions) {
        this._currentAddedTransactions.push({
          dateString,
          transaction: { ...newTransaction }
        });
      }
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
            if (custom.unit === "days") {
              occurrences = Math.floor(
                this.daysBetween(startDate, currentDate) / custom.value
              );
            } else if (custom.unit === "weeks") {
              occurrences = Math.floor(
                this.daysBetween(startDate, currentDate) / (custom.value * 7)
              );
            } else if (custom.unit === "months") {
              const monthsDiff =
                (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
                currentDate.getMonth() -
                startDate.getMonth();
              occurrences = Math.floor(monthsDiff / custom.value);
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
    const startDate = this.parseDateString(rt.startDate);
    let count = 0;

    switch (rt.recurrence) {
      case "once":
        count = beforeDate > startDate ? 1 : 0;
        break;
      case "daily":
        count = this.daysBetween(startDate, beforeDate);
        break;

      case "weekly":
        count = Math.floor(this.daysBetween(startDate, beforeDate) / 7);
        break;

      case "bi-weekly":
        count = Math.floor(this.daysBetween(startDate, beforeDate) / 14);
        break;

      case "monthly":
        count =
          (beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
          (beforeDate.getMonth() - startDate.getMonth());
        if (beforeDate.getDate() < startDate.getDate()) {
          count--;
        }
        break;

      case "semi-monthly":
        // Calculate total months difference
        const monthsDiff =
          (beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
          (beforeDate.getMonth() - startDate.getMonth());

        const firstDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[0] : 1;
        const secondDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15;
        const effectiveSecondDay =
          rt.semiMonthlyLastDay || secondDay === 31
            ? new Date(beforeDate.getFullYear(), beforeDate.getMonth() + 1, 0).getDate()
            : secondDay;

        // Count occurrences in completed months (2 per month)
        count = monthsDiff * 2;

        // Adjust for start month partial - subtract occurrences that happened before startDate
        if (startDate.getDate() > firstDay) {
          count -= 1; // First occurrence was before start
        }
        if (startDate.getDate() > secondDay) {
          count -= 1; // Second occurrence was before start
        }

        // Adjust for current month partial - subtract occurrences that haven't happened yet
        if (beforeDate.getDate() < firstDay) {
          count -= 2; // Neither occurrence has happened this month
        } else if (beforeDate.getDate() < effectiveSecondDay) {
          count -= 1; // Second occurrence hasn't happened yet
        }
        break;

      case "quarterly":
        count = Math.floor(
          ((beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
            (beforeDate.getMonth() - startDate.getMonth())) /
            3
        );
        break;

      case "semi-annual":
        count = Math.floor(
          ((beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
            (beforeDate.getMonth() - startDate.getMonth())) /
            6
        );
        break;

      case "yearly":
        count = beforeDate.getFullYear() - startDate.getFullYear();
        if (
          beforeDate.getMonth() < startDate.getMonth() ||
          (beforeDate.getMonth() === startDate.getMonth() &&
            beforeDate.getDate() < startDate.getDate())
        ) {
          count--;
        }
        break;

      case "custom":
        if (rt.customInterval) {
          if (rt.customInterval.unit === "days") {
            count = Math.floor(
              this.daysBetween(startDate, beforeDate) / rt.customInterval.value
            );
          } else if (rt.customInterval.unit === "weeks") {
            count = Math.floor(
              this.daysBetween(startDate, beforeDate) /
                (rt.customInterval.value * 7)
            );
          } else if (rt.customInterval.unit === "months") {
            const monthsDiff =
              (beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
              (beforeDate.getMonth() - startDate.getMonth());
            count = Math.floor(monthsDiff / rt.customInterval.value);
          }
        }
        break;
    }

    return Math.max(0, count);
  }

  
  editTransaction(date, index, updatedTransaction, editScope) {
    const transactions = this.store.getTransactions();
    const transaction = transactions[date][index];

    if (!transaction) {
      return false;
    }

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
      const startDate = this.parseDateString(date);
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

      if (recurringTransaction.endDate) {
        const originalEndDate = this.parseDateString(
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
        if (new Date(skipDate) >= startDate) {
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
    const transaction = transactions[date][index];

    if (!transaction) {
      return false;
    }

    if (transaction.recurringId) {
      // Invalidate cache when deleting recurring transactions
      this.invalidateCache();
      if (deleteFuture) {
        const recurringId = transaction.recurringId;
        const currentDate = this.parseDateString(date);
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
          if (this.parseDateString(dateKey) >= currentDate) {
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
          if (this.parseDateString(skipDate) >= currentDate) {
            const index = skippedTransactions[skipDate].indexOf(recurringId);
            if (index > -1) {
              skippedTransactions[skipDate].splice(index, 1);
              if (skippedTransactions[skipDate].length === 0) {
                delete skippedTransactions[skipDate];
              }
            }
          }
        });

        this.store.saveData();
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
