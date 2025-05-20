/**
 * RecurringTransactionManager - Manages recurring transactions
 */
class RecurringTransactionManager {
  /**
   * Create a new RecurringTransactionManager
   * @param {TransactionStore} store - The transaction store
   */
  constructor(store) {
    this.store = store;
  }

  /**
   * Get all recurring transactions
   * @returns {Array} Array of recurring transactions
   */
  getRecurringTransactions() {
    return this.store.getRecurringTransactions();
  }

  /**
   * Add a new recurring transaction
   * @param {Object} recurringTransaction - Recurring transaction to add
   * @returns {string} ID of the added transaction
   */
  addRecurringTransaction(recurringTransaction) {
    return this.store.addRecurringTransaction(recurringTransaction);
  }

  /**
   * Get a recurring transaction by ID
   * @param {string} id - ID of the recurring transaction
   * @returns {Object|null} The recurring transaction or null if not found
   */
  getRecurringTransactionById(id) {
    const rt = this.store.getRecurringTransactions().find((rt) => rt.id === id);
    return rt || null;
  }

  /**
   * Check if transaction is skipped
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {string} recurringId - ID of recurring transaction
   * @returns {boolean} True if transaction is skipped
   */
  isTransactionSkipped(date, recurringId) {
    return this.store.isTransactionSkipped(date, recurringId) === true;
  }

  /**
   * Toggle skip status of a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {string} recurringId - ID of recurring transaction
   * @returns {boolean} New skip status
   */
  toggleSkipTransaction(date, recurringId) {
    const isCurrentlySkipped = this.isTransactionSkipped(date, recurringId);
    const newStatus = !isCurrentlySkipped;
    
    // Update the store with the new status
    this.store.setTransactionSkipped(date, recurringId, newStatus);
    
    // Return the expected new status value directly
    return newStatus;
  }

  /**
   * Parse a date string in YYYY-MM-DD format to a Date object with local time
   * @param {string} dateString - Date string in YYYY-MM-DD format
   * @returns {Date} Date object in local time
   */
  parseDateString(dateString) {
    // Split the date string into components
    const [year, month, day] = dateString.split("-").map(Number);

    // Create a date with local time (not UTC)
    return new Date(year, month - 1, day);
  }

  /**
   * Check if a date is a business day (not a weekend)
   * @param {Date} date - Date to check
   * @returns {boolean} True if date is a business day
   */
  isBusinessDay(date) {
    const day = date.getDay();
    return day !== 0 && day !== 6; // 0 is Sunday, 6 is Saturday
  }

  /**
   * Adjust date according to business day adjustment rule
   * @param {Date} date - Original date
   * @param {string} adjustment - Adjustment rule: "none", "previous", "next", "nearest"
   * @returns {Object} Object with adjusted date and original date string if adjusted
   */
  adjustForBusinessDay(date, adjustment) {
    if (!adjustment || adjustment === "none" || this.isBusinessDay(date)) {
      return { adjustedDate: date, originalDateString: null };
    }

    const newDate = new Date(date);
    // Format the original date to store it
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
      // Try going backward and forward to find the nearest business day
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

      // Choose the nearest business day
      if (prevDays <= nextDays) {
        return { adjustedDate: prevDate, originalDateString };
      } else {
        return { adjustedDate: nextDate, originalDateString };
      }
    }

    return { adjustedDate: newDate, originalDateString };
  }

  /**
   * Get the nth occurrence of a specified day in a month
   * @param {number} year - Year
   * @param {number} month - Month (0-11)
   * @param {number} dayOfWeek - Day of week (0-6, 0 is Sunday)
   * @param {number} occurrence - Which occurrence (1 for first, -1 for last)
   * @returns {Date} Date of the occurrence
   */
  getNthDayOfMonth(year, month, dayOfWeek, occurrence) {
    if (occurrence > 0) {
      // Find the first specified day of the month
      let date = new Date(year, month, 1);
      while (date.getDay() !== dayOfWeek) {
        date.setDate(date.getDate() + 1);
      }

      // Add weeks to get to the nth occurrence
      date.setDate(date.getDate() + (occurrence - 1) * 7);

      // If this pushes us into the next month, it doesn't exist
      if (date.getMonth() !== month) {
        return null;
      }

      return date;
    } else if (occurrence < 0) {
      // Find the last day of the month
      const lastDay = new Date(year, month + 1, 0);
      const daysInMonth = lastDay.getDate();

      // Start from the last day and go backwards
      let date = new Date(year, month, daysInMonth);
      while (date.getDay() !== dayOfWeek) {
        date.setDate(date.getDate() - 1);
      }

      // Go back additional weeks if needed (e.g., for second-to-last)
      if (occurrence < -1) {
        date.setDate(date.getDate() + (occurrence + 1) * 7);

        // If this pushes us into the previous month, it doesn't exist
        if (date.getMonth() !== month) {
          return null;
        }
      }

      return date;
    }

    return null;
  }

  /**
   * Check if a date matches a day-specific recurrence pattern
   * @param {Object} rt - Recurring transaction
   * @param {Date} targetDate - Date to check
   * @returns {boolean} True if the date matches the pattern
   */
  matchesDaySpecificRecurrence(rt, targetDate) {
    if (!rt.daySpecific) return false;

    try {
      const year = targetDate.getFullYear();
      const month = targetDate.getMonth();

      // Parse the day specific data with special handling for negative occurrences
      const parts = rt.daySpecificData.split('-');
      
      // Account for negative numbers having a hyphen
      let occurrence, dayOfWeek;
      
      if (parts.length === 2) {
        // Simple case: "1-0" for first Sunday
        occurrence = parseInt(parts[0], 10);
        dayOfWeek = parseInt(parts[1], 10);
      } else if (parts.length === 3 && parts[0] === "") {
        // Handle negative case: "-1-5" for last Friday
        occurrence = -parseInt(parts[1], 10);
        dayOfWeek = parseInt(parts[2], 10);
      } else {
        return false;
      }
      
      if (isNaN(occurrence) || isNaN(dayOfWeek)) {
        return false;
      }

      // Get the date for this pattern
      const matchDate = this.getNthDayOfMonth(year, month, dayOfWeek, occurrence);
      if (!matchDate) return false;

      // Compare dates by checking year, month, day
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
  
  /**
   * Apply recurring transactions to a month
   * @param {number} year - Year
   * @param {number} month - Month (0-11)
   */
  applyRecurringTransactions(year, month) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
    const transactions = this.store.getTransactions();
    
    // Track which recurring transactions we've processed for this month
    const processedRecurringIds = new Set();
    
    // First pass: identify recurring transactions that might have been adjusted
    // from the previous month into this month
    let adjustedFromPrevMonth = {};
    
    Object.keys(transactions).forEach(dateString => {
      const date = this.parseDateString(dateString);
      // Only look at dates in the current month
      if (date.getFullYear() === year && date.getMonth() === month) {
        const transactionsForDate = transactions[dateString];
        
        // Check if any transactions are recurring and need to be preserved
        transactionsForDate.forEach(t => {
          if (t.recurringId && !t.modifiedInstance) {
            const rt = this.getRecurringTransactionById(t.recurringId);
            if (rt) {
              // If this is a monthly transaction with business day adjustment
              if (rt.recurrence === 'monthly' && rt.businessDayAdjustment) {
                const originalDate = new Date(date);
                
                // Check if it might be from the last day of the previous month
                const prevMonth = month === 0 ? 11 : month - 1;
                const prevMonthYear = month === 0 ? year - 1 : year;
                const lastDayOfPrevMonth = new Date(prevMonthYear, prevMonth + 1, 0).getDate();
                
                // Create a date object for the last day of the previous month
                const lastDateOfPrevMonth = new Date(prevMonthYear, prevMonth, lastDayOfPrevMonth);
                
                // Apply business day adjustment to see if it matches this date
                const { adjustedDate } = this.adjustForBusinessDay(lastDateOfPrevMonth, rt.businessDayAdjustment);
                
                // If the adjusted date is in the current month, mark it as adjusted from previous month
                if (adjustedDate.getFullYear() === year && adjustedDate.getMonth() === month) {
                  if (!adjustedFromPrevMonth[dateString]) {
                    adjustedFromPrevMonth[dateString] = [];
                  }
                  adjustedFromPrevMonth[dateString].push(t.recurringId);
                }
              }
            }
          }
        });
      }
    });
    
    // Clear only recurring transactions that are not from previous month adjustments
    for (let day = 1; day <= endOfMonth.getDate(); day++) {
      const dateObj = new Date(year, month, day);
      const dateString = Utils.formatDateString(dateObj);
      
      if (transactions[dateString]) {
        // Keep adjusted transactions from previous month and modified instances
        transactions[dateString] = transactions[dateString].filter(t => {
          // If no recurringId or is a modified instance, keep it
          if (!t.recurringId || t.modifiedInstance) {
            return true;
          }
          
          // Check if this is an adjusted transaction from the previous month
          if (adjustedFromPrevMonth[dateString] && 
              adjustedFromPrevMonth[dateString].includes(t.recurringId)) {
            return true;
          }
          
          // Remove regular recurring transactions so they can be regenerated
          return false;
        });
        
        if (transactions[dateString].length === 0) {
          delete transactions[dateString];
        }
      }
    }

    // Apply recurring transactions
    this.store.getRecurringTransactions().forEach((rt) => {
      // Parse the startDate string to a Date object using local time
      const startDate = this.parseDateString(rt.startDate);
      const endDate = rt.endDate ? this.parseDateString(rt.endDate) : null;
      const maxOccurrences = rt.maxOccurrences || null;

      if (startDate <= endOfMonth && (!endDate || endDate >= startOfMonth)) {
        // Handle different recurrence types
        switch (rt.recurrence) {
          case "daily":
            this.applyDailyRecurrence(
              rt,
              startDate,
              endDate,
              maxOccurrences,
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
              year,
              month
            );
            break;

          default:
            // Handle unsupported recurrence types
            console.warn(`Unsupported recurrence type: ${rt.recurrence}`);
            break;
        }
      }
    });

    // Save data WITHOUT marking as a data modification
    // This is just applying recurring transactions during UI refresh
    this.store.saveData(false);
  }

  /**
   * Apply daily recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyDailyRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    let currentDate = new Date(
      Math.max(startDate.getTime(), startOfMonth.getTime())
    );
    let occurrenceCount = 0;

    if (startDate < startOfMonth && maxOccurrences) {
      // Calculate how many occurrences happened before this month
      const daysDifference = Math.floor(
        (startOfMonth - startDate) / (1000 * 60 * 60 * 24)
      );
      occurrenceCount = daysDifference;
    }

    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;

      // Apply business day adjustment if specified
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } = 
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }

      // Add the transaction regardless of which month it ends up in after adjustment
      // Only check if it's before the end date (if specified)
      if (!endDate || targetDate <= endDate) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }

      // Move to the next day
      currentDate.setDate(currentDate.getDate() + 1);
      occurrenceCount++;
    }
  }

  /**
   * Apply weekly recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyWeeklyRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    // Find the first occurrence on or after the start of the month
    let currentDate = new Date(startDate);
    let occurrenceCount = 0;

    // Advance to the start of the month if needed
    while (currentDate < startOfMonth) {
      currentDate.setDate(currentDate.getDate() + 7);
      occurrenceCount++;
    }

    // Apply to the month
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;

      // Apply business day adjustment if specified
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } = 
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }

      // Add the transaction regardless of which month it ends up in after adjustment
      // Only check if it's before the end date (if specified)
      if (!endDate || targetDate <= endDate) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }

      // Move to the next week
      currentDate.setDate(currentDate.getDate() + 7);
      occurrenceCount++;
    }
  }

  /**
   * Apply bi-weekly recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyBiWeeklyRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    // Find the first occurrence on or after the start of the month
    let currentDate = new Date(startDate);
    let occurrenceCount = 0;

    // Advance to the start of the month if needed
    while (currentDate < startOfMonth) {
      currentDate.setDate(currentDate.getDate() + 14);
      occurrenceCount++;
    }

    // Apply to the month
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      let targetDate = currentDate;
      let originalDateString = null;

      // Apply business day adjustment if specified
      if (rt.businessDayAdjustment) {
        const { adjustedDate, originalDateString: origDate } = 
          this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
        targetDate = adjustedDate;
        originalDateString = origDate;
      }

      // Add the transaction regardless of which month it ends up in after adjustment
      // Only check if it's before the end date (if specified)
      if (!endDate || targetDate <= endDate) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }

      // Move to the next bi-weekly period
      currentDate.setDate(currentDate.getDate() + 14);
      occurrenceCount++;
    }
  }

  /**
   * Apply monthly recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyMonthlyRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    // Check if this is a day-specific monthly recurrence (e.g., "first Monday")
    if (rt.daySpecific) {
      this.applyDaySpecificMonthlyRecurrence(
        rt,
        startDate,
        endDate,
        maxOccurrences,
        year,
        month
      );
      return;
    }

    // Skip if endDate is before the month or startDate is after the month end
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    if ((endDate && endDate < startOfMonth) || startDate > endOfMonth) {
      return;
    }

    // Calculate number of months since start
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());

    // Skip if we've already hit the max occurrences
    if (maxOccurrences && monthsSinceStart >= maxOccurrences) {
      return;
    }

    // Get the day of the month for the start date
    const startDay = startDate.getDate();

    // Check if the startDate is on the last day of its month
    const lastDayOfStartMonth = new Date(
      startDate.getFullYear(),
      startDate.getMonth() + 1,
      0
    ).getDate();

    const isLastDayOfMonth = startDay === lastDayOfStartMonth;

    // Determine target day for this month
    let targetDay;

    if (isLastDayOfMonth) {
      // If the start date was the last day of its month,
      // use the last day of the current month
      targetDay = endOfMonth.getDate();
    } else {
      // Otherwise, use the same day number if it exists in this month
      targetDay = Math.min(startDay, endOfMonth.getDate());
    }

    // Create the target date
    let targetDate = new Date(year, month, targetDay);
    let originalDateString = null;

    // Apply business day adjustment if specified
    if (rt.businessDayAdjustment) {
      const { adjustedDate, originalDateString: origDate } = 
        this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
      targetDate = adjustedDate;
      originalDateString = origDate;
    }

    // Add the transaction regardless of which month it ends up in after adjustment
    // Only check if it's before the end date (if specified)
    if (!endDate || targetDate <= endDate) {
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

  /**
   * Apply day-specific monthly recurrence (e.g., "first Monday")
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyDaySpecificMonthlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month
  ) {
    // Skip if endDate is before the month or startDate is after the month end
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    if ((endDate && endDate < startOfMonth) || startDate > endOfMonth) {
      return;
    }

    // Calculate number of months since start
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startDate.getMonth());

    // Skip if we've already hit the max occurrences
    if (maxOccurrences && monthsSinceStart >= maxOccurrences) {
      return;
    }

    // Parse the day specific data
    const [occurrence, dayOfWeek] = rt.daySpecificData.split("-").map(Number);

    // Calculate the target date
    const targetDate = this.getNthDayOfMonth(
      year,
      month,
      dayOfWeek,
      occurrence
    );

    if (!targetDate || (endDate && targetDate > endDate)) {
      return;
    }

    // Apply business day adjustment if needed (though usually not needed for day-specific)
    let adjustedDate = targetDate;
    let originalDateString = null;
    
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(targetDate, rt.businessDayAdjustment);
      adjustedDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }

    // Add the transaction regardless of which month it ends up in after adjustment
    // Only check if it's before the end date (if specified)
    if (!endDate || adjustedDate <= endDate) {
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

  /**
   * Apply semi-monthly recurrence (typically 1st/15th or 15th/last day)
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applySemiMonthlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month
  ) {
    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);
    const lastDayOfMonth = endOfMonth.getDate(); // Get actual last day (28/29/30/31)

    // Default to 1st and 15th if not specified
    let firstDate = rt.semiMonthlyDays ? rt.semiMonthlyDays[0] : 1;
    let secondDate = rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15;

    // Handle "last day of month" special case
    const isLastDayOfMonthSpecial = rt.semiMonthlyLastDay || secondDate === 31;
    if (isLastDayOfMonthSpecial) {
      // Replace the 31 marker with the actual last day of the current month
      secondDate = lastDayOfMonth;
    }

    // Calculate occurrences before this month
    let occurrenceCount = 0;
    if (maxOccurrences && startDate < startOfMonth) {
      // Each month has 2 occurrences
      const monthsDifference =
        (startOfMonth.getFullYear() - startDate.getFullYear()) * 12 +
        (startOfMonth.getMonth() - startDate.getMonth());

      // Calculate initial month occurrences
      if (startDate.getDate() <= firstDate) {
        // Both occurrences in first month
        occurrenceCount = monthsDifference * 2;
      } else if (startDate.getDate() <= secondDate) {
        // Only second occurrence in first month
        occurrenceCount = monthsDifference * 2 - 1;
      } else {
        // No occurrences in first month
        occurrenceCount = monthsDifference * 2 - 2;
      }
    }

    // Add first date of the month
    if (
      (!maxOccurrences || occurrenceCount < maxOccurrences) &&
      (!endDate || new Date(year, month, firstDate) <= endDate) &&
      startDate <= new Date(year, month, firstDate)
    ) {
      let firstDateObj = new Date(year, month, firstDate);
      let originalDateString = null;

      // Apply business day adjustment
      if (rt.businessDayAdjustment) {
        const result = this.adjustForBusinessDay(
          firstDateObj,
          rt.businessDayAdjustment
        );
        firstDateObj = result.adjustedDate;
        originalDateString = result.originalDateString;
      }

      // Add the transaction regardless of which month it ends up in after adjustment
      if (!endDate || firstDateObj <= endDate) {
        const dateString = Utils.formatDateString(firstDateObj);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          firstDateObj,
          startDate,
          originalDateString
        );
      }

      occurrenceCount++;
    }

    // Add second date of the month
    if (
      (!maxOccurrences || occurrenceCount < maxOccurrences) &&
      (!endDate || new Date(year, month, secondDate) <= endDate) &&
      startDate <= new Date(year, month, secondDate)
    ) {
      let secondDateObj = new Date(year, month, secondDate);
      let originalDateString = null;

      // Apply business day adjustment
      if (rt.businessDayAdjustment) {
        const result = this.adjustForBusinessDay(
          secondDateObj,
          rt.businessDayAdjustment
        );
        secondDateObj = result.adjustedDate;
        originalDateString = result.originalDateString;
      }

      // Add the transaction regardless of which month it ends up in after adjustment
      if (!endDate || secondDateObj <= endDate) {
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

  /**
   * Apply quarterly recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyQuarterlyRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month
  ) {
    // Calculate if this month is a match for the quarterly pattern
    const startMonth = startDate.getMonth();
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startMonth);

    // Check if this is a quarterly month (0, 3, 6, 9 months from start)
    if (monthsSinceStart % 3 !== 0) {
      return; // Not a quarterly month
    }

    // Calculate occurrence number
    const occurrenceNumber = monthsSinceStart / 3;

    // Check if we've exceeded max occurrences
    if (maxOccurrences && occurrenceNumber >= maxOccurrences) {
      return;
    }

    // Find the day to apply the transaction
    const startDay = startDate.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const targetDay = Math.min(startDay, daysInMonth);

    // Create target date
    let targetDate = new Date(year, month, targetDay);
    let originalDateString = null;

    // Apply business day adjustment
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }

    // Add the transaction regardless of which month it ends up in after adjustment
    // Only check if it's before the end date (if specified)
    if (!endDate || targetDate <= endDate) {
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
  
  /**
   * Apply semi-annual recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applySemiAnnualRecurrence(
    rt,
    startDate,
    endDate,
    maxOccurrences,
    year,
    month
  ) {
    // Calculate if this month is a match for the semi-annual pattern
    const startMonth = startDate.getMonth();
    const monthsSinceStart =
      (year - startDate.getFullYear()) * 12 + (month - startMonth);

    // Check if this is a semi-annual month (0, 6 months from start)
    if (monthsSinceStart % 6 !== 0) {
      return; // Not a semi-annual month
    }

    // Calculate occurrence number
    const occurrenceNumber = monthsSinceStart / 6;

    // Check if we've exceeded max occurrences
    if (maxOccurrences && occurrenceNumber >= maxOccurrences) {
      return;
    }

    // Find the day to apply the transaction
    const startDay = startDate.getDate();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const targetDay = Math.min(startDay, daysInMonth);

    // Create target date
    let targetDate = new Date(year, month, targetDay);
    let originalDateString = null;

    // Apply business day adjustment
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }

    // Add the transaction regardless of which month it ends up in after adjustment
    // Only check if it's before the end date (if specified)
    if (!endDate || targetDate <= endDate) {
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

  /**
   * Apply yearly recurrence
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyYearlyRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    // Only apply if the month matches the start month
    if (month !== startDate.getMonth()) {
      return;
    }

    // Calculate years since start
    const yearsSinceStart = year - startDate.getFullYear();

    // Skip if we've already hit the max occurrences
    if (maxOccurrences && yearsSinceStart >= maxOccurrences) {
      return;
    }

    // Handle February 29th in leap years
    let targetDay = startDate.getDate();
    if (month === 1 && targetDay === 29) {
      // February
      const isLeapYear = new Date(year, 1, 29).getMonth() === 1;
      if (!isLeapYear) {
        targetDay = 28; // Use Feb 28 in non-leap years
      }
    }

    // Create target date
    let targetDate = new Date(year, month, targetDay);
    let originalDateString = null;

    // Apply business day adjustment
    if (rt.businessDayAdjustment) {
      const result = this.adjustForBusinessDay(
        targetDate,
        rt.businessDayAdjustment
      );
      targetDate = result.adjustedDate;
      originalDateString = result.originalDateString;
    }

    // Add the transaction regardless of which month it ends up in after adjustment
    // Only check if it's before the end date (if specified)
    if (!endDate || targetDate <= endDate) {
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
  
  /**
   * Apply custom recurrence (every X days/weeks/months)
   * @param {Object} rt - Recurring transaction
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date (or null)
   * @param {number} maxOccurrences - Maximum occurrences (or null)
   * @param {number} year - Year to apply to
   * @param {number} month - Month to apply to (0-11)
   */
  applyCustomRecurrence(rt, startDate, endDate, maxOccurrences, year, month) {
    if (!rt.customInterval) {
      console.warn("Custom recurrence missing interval data");
      return;
    }

    const startOfMonth = new Date(year, month, 1);
    const endOfMonth = new Date(year, month + 1, 0);

    // Calculate how many occurrences before this month
    let occurrenceCount = 0;
    let currentDate = new Date(startDate);

    // Find the first occurrence that happens during or after this month
    while (currentDate < startOfMonth) {
      currentDate = this.getCustomIntervalDate(
        startDate,
        rt.customInterval,
        occurrenceCount + 1
      );
      occurrenceCount++;
    }

    // Apply transactions for this month
    while (
      currentDate <= endOfMonth &&
      (!endDate || currentDate <= endDate) &&
      (!maxOccurrences || occurrenceCount < maxOccurrences)
    ) {
      // Apply business day adjustment
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

      // Add the transaction regardless of which month it ends up in after adjustment
      // Only check if it's before the end date (if specified)
      if (!endDate || targetDate <= endDate) {
        const dateString = Utils.formatDateString(targetDate);
        this.addRecurringTransactionToDate(
          rt,
          dateString,
          targetDate,
          startDate,
          originalDateString
        );
      }

      // Calculate next occurrence
      occurrenceCount++;
      currentDate = this.getCustomIntervalDate(
        startDate,
        rt.customInterval,
        occurrenceCount
      );
    }
  }

  /**
   * Calculate the next occurrence based on a custom interval
   * @param {Date} startDate - Start date
   * @param {Object} customInterval - {value: number, unit: "days"|"weeks"|"months"}
   * @param {number} occurrenceCount - How many occurrences to calculate forward
   * @returns {Date} Date of the next occurrence
   */
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

  /**
   * Add a recurring transaction to a specific date
   * @param {Object} rt - Recurring transaction
   * @param {string} dateString - Date string in YYYY-MM-DD format
   * @param {Date} currentDate - Current date of occurrence
   * @param {Date} startDate - Start date of the recurring transaction
   * @param {string} originalDateString - Original date string before adjustment (if any)
   */
  addRecurringTransactionToDate(rt, dateString, currentDate, startDate, originalDateString = null) {
    const transactions = this.store.getTransactions();

    if (!transactions[dateString]) {
      transactions[dateString] = [];
    }

    // Check if a modified instance already exists
    const existingModifiedInstance = transactions[dateString].find(
      (t) => t.recurringId === rt.id && t.modifiedInstance
    );

    // Check if any instance of this recurring transaction already exists at this date
    const existingNormalInstance = transactions[dateString].find(
      (t) => t.recurringId === rt.id && !t.modifiedInstance
    );

    // Only add if neither a modified nor a normal instance exists
    if (!existingModifiedInstance && !existingNormalInstance) {
      // Calculate amount with variable amount logic if applicable
      const amount = rt.variableAmount
        ? this.calculateVariableAmount(rt, currentDate, startDate)
        : rt.amount;

      const newTransaction = {
        amount: amount,
        type: rt.type,
        description: rt.description,
        recurringId: rt.id,
      };

      // Add original date if provided (indicating business day adjustment)
      if (originalDateString) {
        newTransaction.originalDate = originalDateString;
      }

      transactions[dateString].push(newTransaction);
    }
  }

  /**
   * Calculate transaction amount with variable amount logic
   * @param {Object} rt - Recurring transaction
   * @param {Date} currentDate - Current date
   * @param {Date} startDate - Start date of recurring transaction
   * @returns {number} Adjusted amount
   */
  calculateVariableAmount(rt, currentDate, startDate) {
    if (!rt.variableAmount) {
      return rt.amount;
    }

    let amount = rt.amount;

    if (rt.variableType === "percentage") {
      // Calculate occurrences between start date and current date
      let occurrences = 0;

      switch (rt.recurrence) {
        case "daily":
          // Calculate days difference
          occurrences = Math.floor(
            (currentDate - startDate) / (1000 * 60 * 60 * 24)
          );
          break;
        case "weekly":
          occurrences = Math.floor(
            (currentDate - startDate) / (1000 * 60 * 60 * 24 * 7)
          );
          break;
        case "bi-weekly":
          occurrences = Math.floor(
            (currentDate - startDate) / (1000 * 60 * 60 * 24 * 14)
          );
          break;
        case "monthly":
          // Calculate months difference
          occurrences =
            (currentDate.getFullYear() - startDate.getFullYear()) * 12 +
            currentDate.getMonth() -
            startDate.getMonth();
          break;
        case "semi-monthly":
          // Approximate semi-monthly as half-months
          occurrences =
            (currentDate.getFullYear() - startDate.getFullYear()) * 24 +
            (currentDate.getMonth() - startDate.getMonth()) * 2;
          // Adjust for early/late month splitting
          if (startDate.getDate() < 15 && currentDate.getDate() >= 15)
            occurrences += 1;
          if (
            startDate.getDate() >= 15 &&
            currentDate.getDate() < 15 &&
            (currentDate.getMonth() > startDate.getMonth() ||
              currentDate.getFullYear() > startDate.getFullYear())
          )
            occurrences += 1;
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
            // For custom intervals, calculate occurrences based on the interval
            const custom = rt.customInterval;
            if (custom.unit === "days") {
              occurrences = Math.floor(
                (currentDate - startDate) / (1000 * 60 * 60 * 24) / custom.value
              );
            } else if (custom.unit === "weeks") {
              occurrences = Math.floor(
                (currentDate - startDate) /
                  (1000 * 60 * 60 * 24 * 7) /
                  custom.value
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

      // Apply percentage change for each occurrence
      for (let i = 0; i < occurrences; i++) {
        amount += amount * (rt.variablePercentage / 100);
      }
    }

    return amount;
  }
  
  /**
   * Count occurrences of a recurring transaction before a specific date
   * @param {Object} rt - Recurring transaction
   * @param {Date} beforeDate - Date to count before
   * @returns {number} Number of occurrences
   */
  countOccurrencesBefore(rt, beforeDate) {
    const startDate = this.parseDateString(rt.startDate);
    let count = 0;

    switch (rt.recurrence) {
      case "daily":
        count = Math.floor((beforeDate - startDate) / (1000 * 60 * 60 * 24));
        break;

      case "weekly":
        count = Math.floor(
          (beforeDate - startDate) / (1000 * 60 * 60 * 24 * 7)
        );
        break;

      case "bi-weekly":
        count = Math.floor(
          (beforeDate - startDate) / (1000 * 60 * 60 * 24 * 14)
        );
        break;

      case "monthly":
        count =
          (beforeDate.getFullYear() - startDate.getFullYear()) * 12 +
          (beforeDate.getMonth() - startDate.getMonth());
        // Adjust for day of month
        if (beforeDate.getDate() < startDate.getDate()) {
          count--;
        }
        break;

      case "semi-monthly":
        // Approximate calculation for semi-monthly
        count =
          (beforeDate.getFullYear() - startDate.getFullYear()) * 24 +
          (beforeDate.getMonth() - startDate.getMonth()) * 2;

        const firstDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[0] : 1;
        const secondDay = rt.semiMonthlyDays ? rt.semiMonthlyDays[1] : 15;

        if (startDate.getDate() <= firstDay) {
          // Started before or on first day
          if (beforeDate.getDate() < firstDay) {
            count -= 2; // Before first day of final month
          } else if (beforeDate.getDate() < secondDay) {
            count -= 1; // Before second day of final month
          }
        } else if (startDate.getDate() <= secondDay) {
          // Started before or on second day
          if (beforeDate.getDate() < secondDay) {
            count -= 1; // Before second day of final month
          }
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
              (beforeDate - startDate) /
                (1000 * 60 * 60 * 24) /
                rt.customInterval.value
            );
          } else if (rt.customInterval.unit === "weeks") {
            count = Math.floor(
              (beforeDate - startDate) /
                (1000 * 60 * 60 * 24 * 7) /
                rt.customInterval.value
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

  /**
   * Edit a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {number} index - Index of transaction in array
   * @param {Object} updatedTransaction - New transaction data
   * @param {string} editScope - 'this', 'future', or 'all'
   * @returns {boolean} True if edit was successful
   */
  editTransaction(date, index, updatedTransaction, editScope) {
    const transactions = this.store.getTransactions();
    const transaction = transactions[date][index];

    if (!transaction) {
      return false;
    }

    const isRecurring = transaction.recurringId !== undefined;

    if (!isRecurring || editScope === "this") {
      // Update only this instance
      this.store.updateTransaction(date, index, {
        ...updatedTransaction,
        modifiedInstance: isRecurring ? true : undefined,
      });
      return true;
    }

    const recurringId = transaction.recurringId;
    const recurringTransaction = this.getRecurringTransactionById(recurringId);

    if (editScope === "future") {
      // Create a new recurring transaction for future dates
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

      // Copy additional properties from original recurring transaction
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

      if (recurringTransaction.maxOccurrences) {
        // Adjust max occurrences for the new recurring transaction
        const occurrencesBefore = this.countOccurrencesBefore(
          recurringTransaction,
          startDate
        );

        if (recurringTransaction.maxOccurrences > occurrencesBefore) {
          newRecurringTransaction.maxOccurrences =
            recurringTransaction.maxOccurrences - occurrencesBefore;
        }
      }

      // End the old recurring transaction
      if (recurringTransaction) {
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() - 1);
        this.store.updateRecurringTransaction(recurringId, {
          endDate: Utils.formatDateString(endDate),
        });
      }

      // Add the new recurring transaction
      this.store.addRecurringTransaction(newRecurringTransaction);

      // Update this instance
      this.store.updateTransaction(date, index, {
        amount: updatedTransaction.amount,
        type: updatedTransaction.type,
        description: updatedTransaction.description,
        recurringId: newRecurringId,
      });

      // Clean up any skipped occurrences of the old transaction from this date forward
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
      // Update the recurring transaction definition
      if (recurringTransaction) {
        this.store.updateRecurringTransaction(recurringId, {
          amount: updatedTransaction.amount,
          type: updatedTransaction.type,
          description: updatedTransaction.description,
        });

        // Update all non-modified instances
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

  /**
   * Delete a transaction
   * @param {string} date - Date string in YYYY-MM-DD format
   * @param {number} index - Index of transaction to delete
   * @param {boolean} deleteFuture - Whether to delete future occurrences
   * @returns {boolean} True if deletion was successful
   */
  deleteTransaction(date, index, deleteFuture) {
    const transactions = this.store.getTransactions();
    const transaction = transactions[date][index];

    if (!transaction) {
      return false;
    }

    if (transaction.recurringId) {
      // It's a recurring transaction
      if (deleteFuture) {
        // Delete this and all future occurrences
        const recurringId = transaction.recurringId;
        const currentDate = this.parseDateString(date);

        // Update the end date of the recurring transaction
        const recurringTransaction =
          this.getRecurringTransactionById(recurringId);
        if (recurringTransaction) {
          const endDate = new Date(currentDate);
          endDate.setDate(endDate.getDate() - 1);
          this.store.updateRecurringTransaction(recurringId, {
            endDate: Utils.formatDateString(endDate),
          });
        }

        // Remove future occurrences from transactions
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

        // Clean up skipped transactions
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
        // Delete just this occurrence by adding it to skipped transactions
        this.store.setTransactionSkipped(date, transaction.recurringId, true);
      }

      return true;
    } else {
      // Simple deletion for non-recurring transaction
      this.store.deleteTransaction(date, index);
      return true;
    }
  }
}
