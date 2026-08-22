class RecurringTransactionManager {

  constructor(store) {
    this.store = store;
    // Cache for expanded recurring transactions per month
    // Key format: "YYYY-MM" + hash of recurring transaction data
    this.expansionCache = new Map();
    this.lastRecurringHash = null;
    this._holidayCache = new Map();
  }

  // Generate a simple hash of recurring transactions to detect changes
  _generateRecurringHash() {
    const recurringData = this.store.getRecurringTransactions();
    const skippedData = this.store.getSkippedTransactions();
    const dataStr = JSON.stringify({
      recurring: recurringData,
      skipped: skippedData
    });
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

  _isCacheValid() {
    const currentHash = this._generateRecurringHash();
    if (this.lastRecurringHash !== currentHash) {
      this.expansionCache.clear();
      this.lastRecurringHash = currentHash;
      return false;
    }
    return true;
  }

  // Drop a date's pure recurring expansions (regenerated on every render) while
  // preserving hand-edited modified instances. A row that carries a recurringId
  // but is NOT a modifiedInstance yet still has a persisted `id` is an anomaly:
  // its hand-edit flag was cleared elsewhere (e.g. the snowball un-hide branch)
  // while the synced id lingered. Dropping it silently lets a cloud sync-merge
  // resurrect the remote copy (deletion-tombstones rule), so tombstone its id.
  // Pure expansions are id-less and never persisted, so they need no tombstone.
  _clearRecurringExpansions(transactions, dateString) {
    if (!transactions[dateString]) {
      return;
    }
    transactions[dateString] = transactions[dateString].filter((t) => {
      if (!t.recurringId || t.modifiedInstance) {
        return true;
      }
      if (t.id) {
        this.store.trackDeletedTransaction(t.id);
      }
      return false;
    });
    if (transactions[dateString].length === 0) {
      delete transactions[dateString];
    }
  }

  _getCacheKey(year, month) {
    const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
    return monthStr;
  }

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

  // How many whole `stepDays` intervals it takes to reach or pass `target` from
  // `startDate`. Replaces the step-a-period-at-a-time catch-up loops in the
  // day-stepped recurrences, which were O(distance) and therefore made a whole
  // render O(months x history). Both dates are normalised to noon by
  // daysBetween, so DST cannot shift the count.
  _catchUpSteps(startDate, target, stepDays) {
    const days = this.daysBetween(startDate, target);
    if (days <= 0) return 0;
    return Math.ceil(days / stepDays);
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

    const validHolidays = holidays.filter(h => h !== null);
    this._holidayCache.set(year, validHolidays);
    return validHolidays;
  }

  // Check if a date is a US banking holiday.
  //
  // A holiday's OBSERVED date can fall in the previous calendar year: when
  // Jan 1 lands on a Saturday, New Year's Day is observed on Dec 31 — which
  // getUSBankingHolidays files under the January year, not December's. Looking
  // only at the date's own year therefore missed it, and a business-day
  // adjustment happily scheduled a payment on a day the banks are closed
  // (Dec 31 2027, Dec 31 2032, …). December dates also consult the next year's
  // list; that list is cached, so the extra lookup happens once per year.
  isUSBankingHoliday(date) {
    const year = date.getFullYear();
    const sameDay = (holiday) =>
      holiday.getFullYear() === date.getFullYear() &&
      holiday.getMonth() === date.getMonth() &&
      holiday.getDate() === date.getDate();

    if (this.getUSBankingHolidays(year).some(sameDay)) {
      return true;
    }
    // December is the only month that can carry a next-year observance.
    return (
      date.getMonth() === 11 &&
      this.getUSBankingHolidays(year + 1).some(sameDay)
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


  applyRecurringTransactions(year, month) {
    const cacheKey = this._getCacheKey(year, month);
    const cacheValid = this._isCacheValid();

    if (cacheValid && this.expansionCache.has(cacheKey)) {
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

      this._clearRecurringExpansions(transactions, dateString);
    }

    this.store.getRecurringTransactions().forEach((rt) => {
      const startDate = Utils.parseDateString(rt.startDate);
      // A series with no usable start date has no schedule to expand. Skipping
      // it here is the ONLY place this can be caught cheaply: the guard below
      // is `startDate <= targetEndOfMonth`, and `null <= aDate` coerces null to
      // 0 and the date to its timestamp — so it is always true. Every one of
      // the ten apply*Recurrence branches then dereferenced the null
      // (getFullYear/getMonth/daysBetween) and threw, which takes
      // applyRecurringTransactions down, and with it updateMonthlyBalances and
      // the whole calendar render: a blank app with no way back. The form
      // always supplies a start date, but recurring definitions are not
      // normalized on the way in from an import or a cloud merge (debts are,
      // via _normalizeDebt), so one bad value in a restored backup was enough.
      if (!startDate) {
        console.warn(
          `Recurring transaction ${rt && rt.id} has no usable startDate ` +
            `(${rt && rt.startDate}); skipping its expansion.`
        );
        return;
      }
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

      this._clearRecurringExpansions(transactions, dateString);
    }

    // Apply cached transactions (but skip if modified instance exists)
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    let addedLiveRollingBucket = false;
    for (const item of cachedData) {
      const { dateString, transaction } = item;

      const key = `${transaction.recurringId}-${transaction.originalDate || dateString}`;
      if (modifiedInstances.has(key)) {
        // Modified instance exists - don't overwrite it
        continue;
      }

      if (!transactions[dateString]) {
        transactions[dateString] = [];
      }
      const existsAlready = transactions[dateString].some(t =>
        t.recurringId === transaction.recurringId &&
        (t.originalDate || dateString) === (transaction.originalDate || dateString)
      );
      if (!existsAlready) {
        transactions[dateString].push({ ...transaction });
        if (
          transaction.type === "expense" &&
          transaction.allocated === true &&
          transaction.autoCloseout !== true &&
          transaction.recurringId &&
          dateString <= todayStr
        ) {
          addedLiveRollingBucket = true;
        }
      }
    }

    // Replaying a cached month can put a rolling-allocation bucket back on the
    // board, and the supersede rule is cross-month: whichever occurrence is the
    // LATEST on/before today wins, so re-adding one can retire an occurrence in
    // some OTHER month. The collapse pass ran only on the full-expansion path,
    // so when the supersedor's month happened to be a cache HIT nothing ever
    // retired the earlier bucket — its reserve was subtracted from every
    // projected balance for good. That is not hypothetical: any path that
    // replaces the transactions map wholesale (a cloud merge importing the
    // merged copy) drops the ephemeral expansions while leaving these caches
    // populated, so the very next render replays them in this exact shape.
    //
    // Gated on actually having re-added a live-eligible bucket, which is an
    // O(cached rows) check: without that guard this would run a full-dataset
    // pass per expanded month on every render — the quadratic cost the
    // single-pass rewrite removed. Users with no rolling allocation never even
    // reach the guard's true branch.
    if (addedLiveRollingBucket) {
      this._collapseSupersededRollingAllocations();
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
    // Nothing can be collapsed unless some series IS a rolling allocation
    // (allocated, no auto close-out). This pass only ever removes pure
    // expansions — no id, not a modified instance — and a pure expansion's
    // flags always come from its definition, so checking the definitions is
    // exactly equivalent and costs O(series). The scan below is O(every
    // transaction ever stored) and runs once per expanded month, which made it
    // the single largest cost of a render on a multi-year dataset (quadratic in
    // history length) even for users with no allocations at all.
    const hasRollingAllocationSeries = this.store
      .getRecurringTransactions()
      .some((rt) => rt && rt.allocated === true && rt.autoCloseout !== true);
    if (!hasRollingAllocationSeries) {
      return;
    }

    const transactions = this.store.getTransactions();
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    // ONE pass over the dataset, collecting both things the collapse needs:
    //
    //  - liveDate: per rolling series, the latest UNSKIPPED occurrence dated
    //    on/before today. Drawn, id-bearing instances count, so the live date is
    //    right even when the latest period was drawn from; skipped ones do not,
    //    because a skipped period set nothing aside (see the note below, and
    //    closeOutExpiredAllocations, which applies the same rule).
    //  - collapsible: per series, the dates carrying a PURE expansion (no id,
    //    not a modified instance) — the only rows this pass may remove.
    //
    // This used to be two full sweeps of the transactions map, and the second
    // one walked every row of every date to find the handful that were
    // superseded. applyRecurringTransactions runs the collapse once per
    // expanded month and updateMonthlyBalances expands every month from the
    // earliest transaction forward, so that second sweep cost
    // (months) x (whole dataset) — quadratic in history length, and after the
    // reserved-total index it was the largest remaining cost of a render.
    // Removal now visits only the dates that actually hold a candidate.
    const liveDate = new Map();
    const collapsible = new Map();
    Object.keys(transactions).forEach((date) => {
      if (date > todayStr) return;
      const arr = transactions[date];
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (
          t.allocated !== true ||
          t.autoCloseout === true ||
          !t.recurringId ||
          t.type !== "expense"
        ) {
          continue;
        }
        // A skipped occurrence holds no reserve, so it cannot be the live
        // bucket and cannot supersede an earlier one. getAllocations and the
        // reserve index already exclude it; this rule must agree or the two
        // halves disagree about which bucket is live (see
        // closeOutExpiredAllocations for what that cost).
        if (this.isTransactionSkipped(date, t.recurringId)) continue;
        const cur = liveDate.get(t.recurringId);
        if (!cur || date > cur) liveDate.set(t.recurringId, date);
        if (!t.id && !t.modifiedInstance) {
          let dates = collapsible.get(t.recurringId);
          if (!dates) collapsible.set(t.recurringId, (dates = []));
          if (dates[dates.length - 1] !== date) dates.push(date);
        }
      }
    });

    if (liveDate.size === 0) return;

    // Dates above todayStr can never qualify: removal needs date < live, and
    // every live date is on/before today — so the old full sweep could not
    // have reached them either.
    const affected = new Set();
    collapsible.forEach((dates, recurringId) => {
      const live = liveDate.get(recurringId);
      if (!live) return;
      dates.forEach((date) => {
        if (date < live) affected.add(date);
      });
    });

    // Months this pass actually took rows out of. Their cached expansion was
    // captured BEFORE the supersedor existed, so it still lists the row — and
    // _applyCachedTransactions replays a cached month verbatim without running
    // this pass. Drop those cache entries so the next expansion of that month
    // is a miss that re-derives (and re-collapses) it. See the note below.
    const staleMonths = new Set();

    affected.forEach((date) => {
      const arr = transactions[date];
      if (!Array.isArray(arr)) return;
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
        if (live && date < live) {
          arr.splice(i, 1);
          staleMonths.add(date.slice(0, 7));
        }
      }
      if (arr.length === 0) delete transactions[date];
    });

    // A superseded bucket is collapsed only once its SUPERSEDOR has been
    // materialized, which happens when a LATER month is expanded — after the
    // earlier month's cache entry was already captured with the bucket still in
    // it. On the next render that month is a cache hit, _applyCachedTransactions
    // re-adds the row verbatim (it does not run this pass), and nothing removes
    // it again: the superseded period's reserve is subtracted from every
    // projected balance, so the whole forward plan and the 30-day Minimum drop
    // by the bucket amount from the second render on, permanently and with
    // nothing on screen to explain it. A monthly rolling allocation resurrects
    // one bucket per elapsed period.
    //
    // Invalidating just the affected months is what keeps this cheap: re-running
    // the collapse on every cache HIT would make it O(months x whole dataset)
    // per render again — the quadratic cost the single-pass rewrite removed.
    // Each month pays one extra expansion, once.
    staleMonths.forEach((monthKey) => {
      this.expansionCache.delete(monthKey);
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
    // Skip straight to the first occurrence on/after this month instead of
    // stepping a week at a time. The loop was O(weeks since startDate) and runs
    // once per rendered month, so a years-old series made expansion quadratic
    // in history length. ceil() lands on exactly the date the loop stopped at:
    // startDate + steps*7 >= startOfMonth while startDate + (steps-1)*7 < it.
    let occurrenceCount = this._catchUpSteps(startDate, startOfMonth, 7);
    if (occurrenceCount > 0) {
      currentDate.setDate(currentDate.getDate() + occurrenceCount * 7);
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
    // See applyWeeklyRecurrence: arithmetic catch-up instead of stepping.
    let occurrenceCount = this._catchUpSteps(startDate, startOfMonth, 14);
    if (occurrenceCount > 0) {
      currentDate.setDate(currentDate.getDate() + occurrenceCount * 14);
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
    // A zero/negative/NaN interval would leave the catch-up loop below stepping
    // in place forever (browser hang); the add form does not validate the value.
    const intervalStep = Number(rt.customInterval.value);
    if (!Number.isFinite(intervalStep) || intervalStep < 1) {
      console.warn("Custom recurrence has a non-positive interval; skipping");
      return;
    }
    // Same hang, other field. getCustomIntervalDate only knows days/weeks/months
    // and returns the START date unchanged for anything else — so the
    // month-stepped catch-up loop below ("while currentDate < startOfMonth")
    // never advances and the render never returns. The form's select can only
    // emit the three known units, but recurring definitions arrive unnormalized
    // from imports and cloud merges (unlike debts, which _normalizeDebt coerces),
    // so an edited backup carrying "years" is enough to freeze the app.
    const intervalUnit = rt.customInterval.unit;
    if (
      intervalUnit !== "days" &&
      intervalUnit !== "weeks" &&
      intervalUnit !== "months"
    ) {
      console.warn(
        `Custom recurrence has an unsupported interval unit (${intervalUnit}); skipping`
      );
      return;
    }

    const startOfMonth = new Date(year, month, 1, 12, 0, 0);
    const endOfMonth = new Date(year, month + 1, 0, 12, 0, 0);
    // Jump to the first occurrence on/after this month rather than walking
    // every interval from startDate (see applyWeeklyRecurrence). Only the
    // day-stepped units get the arithmetic shortcut: a month step is not a
    // fixed number of days, and a month-stepped catch-up is bounded by the
    // number of months anyway, so that one keeps the loop.
    let occurrenceCount = 0;
    let currentDate = new Date(startDate);
    const unit = rt.customInterval.unit;
    const stepDays =
      unit === "days" ? intervalStep : unit === "weeks" ? intervalStep * 7 : 0;
    if (stepDays > 0) {
      occurrenceCount = this._catchUpSteps(startDate, startOfMonth, stepDays);
      if (occurrenceCount > 0) {
        currentDate = this.getCustomIntervalDate(
          startDate,
          rt.customInterval,
          occurrenceCount
        );
      }
    } else {
      while (currentDate < startOfMonth) {
        currentDate = this.getCustomIntervalDate(
          startDate,
          rt.customInterval,
          occurrenceCount + 1
        );
        occurrenceCount++;
      }
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
      // Advance whole months from the start date, clamping the day to the target
      // month's last day. Using setMonth alone lets a month-end start overflow
      // into the following month — e.g. "every 2 months from Jan 31" turns the
      // September occurrence (Sep 31) into Oct 1, which skips September entirely
      // and doubles an occurrence into October. Clamping mirrors how the standard
      // monthly recurrence handles short months (adjustDayForMonth).
      const startDay = startDate.getDate();
      const totalMonths =
        startDate.getMonth() + customInterval.value * occurrenceCount;
      const targetYear = startDate.getFullYear() + Math.floor(totalMonths / 12);
      const targetMonth = ((totalMonths % 12) + 12) % 12;
      const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
      result.setFullYear(targetYear, targetMonth, Math.min(startDay, lastDay));
    }

    return result;
  }


  addRecurringTransactionToDate(rt, dateString, currentDate, startDate, originalDateString = null) {
    const transactions = this.store.getTransactions();

    // The day's array is created only when there is actually something to put
    // in it — see the push at the end. It used to be created up front, before
    // the allocation guards below, both of which `return` — so every skipped
    // past auto-close-out or superseded rolling bucket left an EMPTY array
    // under its date. Those empties widened updateMonthlyBalances' month range
    // (it derives earliest/latest from the map's keys), showed up in every
    // scan, and were only swept away incidentally, by an unrelated
    // full-map loop in _collapseSupersededRollingAllocations.
    const occurrenceKey = originalDateString || dateString;
    const existingList = transactions[dateString];
    const existingInstance =
      Array.isArray(existingList) &&
      existingList.some((t) => {
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
          // re-expansion would resurrect them). A period is superseded when an
          // UNSKIPPED sibling instance already exists in (dateString, today].
          // for...in rather than Object.keys().some(): this runs once per
          // materialized past occurrence of every allocated series, and
          // Object.keys allocates a fresh array of EVERY date in the dataset
          // each time. On a multi-year history that allocation, not the
          // comparison, was the cost. Same short-circuit, same semantics.
          let superseded = false;
          for (const d in transactions) {
            if (d <= dateString || d > todayStr) continue;
            const siblings = transactions[d];
            if (
              Array.isArray(siblings) &&
              // A skipped sibling set nothing aside, so it does not supersede
              // this period (same rule as getAllocations / the reserve index /
              // the collapse pass).
              !this.isTransactionSkipped(d, rt.id) &&
              siblings.some(
                (t) => t.recurringId === rt.id && t.allocated === true
              )
            ) {
              superseded = true;
              break;
            }
          }
          if (superseded) {
            return;
          }
        }
      }
      const newTransaction = {
        amount: rt.amount,
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

      if (!transactions[dateString]) {
        transactions[dateString] = [];
      }
      transactions[dateString].push(newTransaction);
    }
  }


  countOccurrencesBefore(rt, beforeDate) {
    const startDate = Utils.parseDateString(rt.startDate);
    // Same unusable-startDate case applyRecurringTransactions guards: with no
    // anchor there are no occurrences to count, and every branch below would
    // deref the null.
    if (!startDate || !beforeDate) {
      return 0;
    }
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

    // Both scoped edits rewrite the SERIES, so neither can run without its
    // definition. The "all" branch already returns false when it is missing;
    // "future" read recurringTransaction.recurrence while building the split
    // and threw instead, taking the whole edit down. An instance can outlive
    // its definition (a cloud merge that keeps a modified instance while the
    // other device's tombstone removes the series), so fall back to editing
    // just this occurrence rather than failing.
    if (!recurringTransaction) {
      console.warn(
        `Recurring definition ${recurringId} is missing; editing this occurrence only.`
      );
      this.store.updateTransaction(date, index, {
        ...updatedTransaction,
        modifiedInstance: true,
      });
      return true;
    }

    if (editScope === "future") {
      const startDate = Utils.parseDateString(date);
      // Anchor the new series on the SCHEDULED occurrence date, not the
      // business-day-adjusted landing date the instance rendered on. Splitting
      // at the landing date silently rewrites the recurrence pattern — e.g. a
      // monthly bill due the 1st, adjusted back to Fri Oct 30, would become
      // "monthly on the 30th" from the split forward.
      const scheduledStart = transaction.originalDate
        ? Utils.parseDateString(transaction.originalDate)
        : startDate;
      // Split boundary for ending the old series / clearing skips: the earlier
      // of the scheduled and landing dates, so the edited occurrence can't
      // re-expand from the old series whichever direction the adjustment moved.
      const splitCutoff = scheduledStart < startDate ? scheduledStart : startDate;
      const newRecurringId = Utils.generateUniqueId();

      const newRecurringTransaction = {
        id: newRecurringId,
        startDate: Utils.formatDateString(scheduledStart),
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

      if (recurringTransaction.settled !== undefined) {
        newRecurringTransaction.settled = recurringTransaction.settled;
      }
      // Allocation-bucket flags only carry over while the series remains an
      // expense — carrying them across a type change off expense would create
      // a phantom recurring allocation (e.g. income flagged as a reserve).
      if (updatedTransaction.type === "expense") {
        if (recurringTransaction.allocated !== undefined) {
          newRecurringTransaction.allocated = recurringTransaction.allocated;
        }
        if (recurringTransaction.autoCloseout !== undefined) {
          newRecurringTransaction.autoCloseout = recurringTransaction.autoCloseout;
        }
        // Carry floor-suggestion settings across the split. Demand history is
        // stamped with the OLD series id, so the new series starts its warm-up
        // over — but the user's opt-in and floor survive.
        if (recurringTransaction.autoAdjustFloor === true) {
          newRecurringTransaction.autoAdjustFloor = true;
          if (recurringTransaction.floorAmount !== undefined) {
            newRecurringTransaction.floorAmount = recurringTransaction.floorAmount;
          }
        }
      }
      // TRANSFER the free-funds designation — it must move, not be copied, and
      // it must not be left behind. The store enforces a single holder, so
      // leaving the flag on the old (now-ended) series while the new one also
      // carried it would put the most-recently-modified tie-break in charge of
      // which series the calendar reads. Left behind entirely (the original
      // bug), the calendar stayed in free-funds mode but resolved the ENDED
      // series: it showed that series' last bucket — a stale figure — and once
      // the ended series had no instance on/before today it showed nothing at
      // all, while the ⭐ toggle still reported the designation as active. The
      // free-funds number is what the family spends against, so it has to
      // follow the series they are actually still running. A split that moves
      // the type off expense leaves no allocation series to designate, so the
      // flag is dropped rather than transferred.
      if (recurringTransaction.freeFunds === true) {
        delete recurringTransaction.freeFunds;
        if (
          updatedTransaction.type === "expense" &&
          newRecurringTransaction.allocated === true
        ) {
          newRecurringTransaction.freeFunds = true;
        }
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
        if (originalEndDate >= scheduledStart) {
          newRecurringTransaction.endDate = recurringTransaction.endDate;
        }
      }

      if (recurringTransaction.maxOccurrences) {
        const occurrencesBefore = this.countOccurrencesBefore(
          recurringTransaction,
          scheduledStart
        );

        // Floor at 1, never "leave it off". The occurrence being edited IS an
        // occurrence of the new series, so the remainder can never legitimately
        // be zero — and omitting the field doesn't mean "none left", it means
        // NO CAP: the capped series the user set up would silently become one
        // that repeats forever. countOccurrencesBefore is an arithmetic
        // estimate (business-day adjustments and Nth-weekday rules can put it a
        // step out), so over-counting by one on the final occurrence is exactly
        // the case that reached this.
        newRecurringTransaction.maxOccurrences = Math.max(
          1,
          recurringTransaction.maxOccurrences - occurrencesBefore
        );
      }
      if (recurringTransaction) {
        const endDate = new Date(splitCutoff);
        endDate.setDate(endDate.getDate() - 1);
        this.store.updateRecurringTransaction(recurringId, {
          endDate: Utils.formatDateString(endDate),
        });
      }
      this.store.addRecurringTransaction(newRecurringTransaction);
      const instanceUpdates = {
        amount: updatedTransaction.amount,
        type: updatedTransaction.type,
        description: updatedTransaction.description,
        recurringId: newRecurringId,
      };
      // The clicked instance would otherwise keep stale expense-only flags
      // through the spread merge when the series' type moves off expense.
      if (updatedTransaction.type !== "expense") {
        instanceUpdates.settled = undefined;
        instanceUpdates.allocated = undefined;
        instanceUpdates.autoCloseout = undefined;
        instanceUpdates.closeoutDate = undefined;
      }
      this.store.updateTransaction(date, index, instanceUpdates);
      const skippedTransactions = this.store.getSkippedTransactions();
      Object.keys(skippedTransactions).forEach((skipDate) => {
        if (Utils.parseDateString(skipDate) >= splitCutoff) {
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
        // Clear expense-only allocation flags when the series' type moves off
        // expense (mirrors the future-scope guard above) so neither the
        // definition nor its expanded instances linger as phantom buckets.
        const clearAllocation =
          updatedTransaction.type !== "expense" &&
          recurringTransaction.allocated === true;
        const recurringUpdates = {
          amount: updatedTransaction.amount,
          type: updatedTransaction.type,
          description: updatedTransaction.description,
        };
        if (clearAllocation) {
          recurringUpdates.allocated = undefined;
          recurringUpdates.autoCloseout = undefined;
          // Floor-suggestion settings only make sense on an allocation series.
          recurringUpdates.autoAdjustFloor = undefined;
          recurringUpdates.floorAmount = undefined;
          // Same for the free-funds designation. getFreeFundsRecurringId also
          // requires `allocated`, so the holder already lapses — but a flag
          // left lying on the definition would re-designate this series the
          // moment anything set `allocated` on it again.
          recurringUpdates.freeFunds = undefined;
        }
        this.store.updateRecurringTransaction(recurringId, recurringUpdates);
        Object.keys(transactions).forEach((dateKey) => {
          transactions[dateKey].forEach((t, i) => {
            if (t.recurringId === recurringId && !t.modifiedInstance) {
              const instanceUpdates = {
                amount: updatedTransaction.amount,
                type: updatedTransaction.type,
                description: updatedTransaction.description,
              };
              if (clearAllocation) {
                instanceUpdates.allocated = undefined;
                instanceUpdates.autoCloseout = undefined;
                instanceUpdates.closeoutDate = undefined;
              }
              this.store.updateTransaction(dateKey, i, instanceUpdates);
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
            const newTransactions = transactions[dateKey].filter((t) => {
              if (t.recurringId !== recurringId) {
                return true;
              }
              // Tombstone persisted (id-bearing) instances so a sync-merge
              // can't resurrect them past the new endDate.
              this.store.trackDeletedTransaction(t.id);
              return false;
            });

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
