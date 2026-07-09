// TransactionStore — the allocations engine: bucket resolution (one-time and
// recurring, incl. the synthetic ralloc: ids), free-funds designation, draw
// apply/reverse, auto-adjust + floor suggestions, roll-forward, and
// auto-close-out sweeps. Draw apply/reverse are also called from the core
// transaction CRUD in transaction-store.js. Prototype companion of
// TransactionStore (class declared in transaction-store.js); no build step —
// loaded as a plain script after the class file and before app.js (see
// index.html).

Object.assign(TransactionStore.prototype, {

  // Allocations are `allocated:true` expenses that act as set-aside "buckets".
  // Each allocation's `amount` IS its remaining balance, so spending against it
  // simply shrinks that amount. Returns the buckets a regular expense can draw
  // from, soonest first. A bucket can't be drawn against before its own date, so
  // only allocations dated on/before `referenceDate` are offered. Two flavors:
  //   - One-time allocations: a plain `allocated:true` expense, listed as-is.
  //   - Recurring allocations: each period's instance is its own bucket; the
  //     latest instance per series dated on/before `referenceDate` is offered,
  //     so the dropdown shows the bucket active for the transaction being
  //     entered rather than every future month. `referenceDate` defaults to
  //     today; pass the transaction's own date to bill against that period.
  getAllocations(referenceDate) {
    const oneTime = [];
    const recurringBySeries = new Map();
    const refStr = referenceDate || this._todayString();
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.allocated !== true || t.type !== "expense" || t.hidden === true) {
          return;
        }
        const description =
          typeof t.description === "string" && t.description
            ? t.description
            : "(no description)";
        if (!t.recurringId) {
          if (!t.id) return;
          // Can't draw against a bucket before its own date.
          if (date > refStr) return;
          // An auto-close-out bucket is only drawable through its close-out
          // date (its own date for legacy entries) — don't offer it to an
          // expense dated after the bucket will have been forfeited.
          if (t.autoCloseout === true && (t.closeoutDate || date) < refStr) {
            return;
          }
          oneTime.push({
            id: t.id,
            date,
            description,
            remaining: this._roundCents(t.amount),
            recurring: false,
          });
          return;
        }
        // Recurring allocation instance — only the bucket active for the
        // reference date is drawable, and (like all allocations) it can't be
        // drawn before its own date. So for both flavors the active instance is
        // the latest one dated on/before refStr.
        if (date > refStr) return;
        // A skipped occurrence is a non-event in the balance walk, so its
        // bucket holds no reserve — never offer it for draws, or the draw
        // dropdown (and the free-funds figure, which resolves through here)
        // would show money that isn't actually set aside.
        const skippedIds = this.skippedTransactions[date];
        if (skippedIds && skippedIds.includes(t.recurringId)) return;
        const existing = recurringBySeries.get(t.recurringId);
        const candidate = {
          // Un-materialized instances have no id yet — use a synthetic key the
          // draw resolver can locate; the first draw assigns it a real id.
          id: t.id || `ralloc:${t.recurringId}:${date}`,
          date,
          description,
          remaining: this._roundCents(t.amount),
          recurring: true,
          recurringId: t.recurringId,
        };
        if (!existing || date > existing.date) {
          recurringBySeries.set(t.recurringId, candidate);
        }
      });
    });
    const result = oneTime.concat(Array.from(recurringBySeries.values()));
    result.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return result;
  },

  // One recurring allocation series can be designated as the family's "free
  // funds" bucket. While designated, the calendar hides every day's running
  // balance and shows only that bucket's remaining amount on the current day,
  // so the family sees what's spendable without exposing the whole budget.
  // The flag lives on the recurring definition (`freeFunds: true`) so it syncs
  // with the series and disappears with it on delete. If a cloud merge ever
  // leaves two series flagged, the most recently modified one wins.
  getFreeFundsRecurringId() {
    let winner = null;
    this.recurringTransactions.forEach((rt) => {
      if (rt.freeFunds !== true || rt.allocated !== true) return;
      if (!winner || (rt._lastModified || "") > (winner._lastModified || "")) {
        winner = rt;
      }
    });
    return winner ? winner.id : null;
  },

  // Designates `recurringId` as the free-funds series, clearing the flag from
  // any other series (only one may hold it). Pass null to clear entirely.
  setFreeFundsAllocation(recurringId) {
    let changed = false;
    this.recurringTransactions.forEach((rt) => {
      const shouldHold = recurringId != null && rt.id === recurringId;
      if (shouldHold && rt.freeFunds !== true) {
        rt.freeFunds = true;
        rt._lastModified = new Date().toISOString();
        changed = true;
      } else if (!shouldHold && rt.freeFunds === true) {
        delete rt.freeFunds;
        rt._lastModified = new Date().toISOString();
        changed = true;
      }
    });
    if (changed) {
      this.debouncedSave();
    }
    return changed;
  },

  // The live bucket for the designated free-funds series: its latest instance
  // dated on/before today — the same bucket getAllocations offers for draws,
  // so the displayed figure always matches what's actually drawable. Returns
  // { remaining, description, date, ... } or null when nothing is designated
  // or the series has no live bucket yet (e.g. its first period is upcoming).
  getFreeFundsAllocation() {
    const id = this.getFreeFundsRecurringId();
    if (!id) return null;
    return (
      this.getAllocations().find(
        (a) => a.recurring === true && a.recurringId === id
      ) || null
    );
  },

  // Resolves a transaction's `drawsFromAllocationId` to the allocation it draws
  // from, returning its `{ description, date }` for display. Handles both real
  // ids (one-time / materialized recurring) and the synthetic
  // "ralloc:<recurringId>:<date>" key. Returns null if the bucket is gone.
  getAllocationInfoById(id) {
    if (!id) return null;
    let recurringId = null;
    let targetDate = null;
    if (typeof id === "string" && id.startsWith("ralloc:")) {
      const rest = id.slice("ralloc:".length);
      const sep = rest.lastIndexOf(":");
      if (sep === -1) return null;
      recurringId = rest.slice(0, sep);
      targetDate = rest.slice(sep + 1);
    }
    const dates = targetDate ? [targetDate] : Object.keys(this.transactions);
    for (let d = 0; d < dates.length; d++) {
      const date = dates[d];
      const arr = this.transactions[date];
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (t.allocated !== true || t.type !== "expense") continue;
        const match = recurringId ? t.recurringId === recurringId : t.id === id;
        if (match) {
          return {
            description:
              typeof t.description === "string" && t.description
                ? t.description
                : "(no description)",
            date,
          };
        }
      }
    }
    return null;
  },

  _findAllocationById(id) {
    const entry = this._findAllocationEntryById(id);
    return entry ? entry.transaction : null;
  },

  // Like _findAllocationById but also returns the date the bucket lives on
  // (its period anchor), for callers that need to stamp period provenance.
  _findAllocationEntryById(id) {
    if (!id) return null;
    // Synthetic key for an un-materialized recurring allocation instance:
    // "ralloc:<recurringId>:<date>". The date never contains a colon, so the
    // last colon separates the recurringId from the date.
    if (typeof id === "string" && id.startsWith("ralloc:")) {
      const rest = id.slice("ralloc:".length);
      const sep = rest.lastIndexOf(":");
      if (sep === -1) return null;
      const recurringId = rest.slice(0, sep);
      const date = rest.slice(sep + 1);
      const arr = this.transactions[date];
      if (!arr) return null;
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        if (
          t.recurringId === recurringId &&
          t.allocated === true &&
          t.type === "expense"
        ) {
          return { transaction: t, date };
        }
      }
      return null;
    }
    const dates = Object.keys(this.transactions);
    for (let d = 0; d < dates.length; d++) {
      const arr = this.transactions[dates[d]];
      for (let i = 0; i < arr.length; i++) {
        const t = arr[i];
        // Matches one-time allocations and materialized recurring instances.
        if (t.id === id && t.allocated === true && t.type === "expense") {
          return { transaction: t, date: dates[d] };
        }
      }
    }
    return null;
  },

  // Toggle history-based floor suggestions for a recurring allocation series.
  // Enabling captures the definition's current amount as the floor — the value
  // suggestions can never go below. Re-enabling after a manual amount change is
  // how the user raises the floor itself; disabling clears both fields.
  setAllocationAutoAdjust(recurringId, enabled) {
    const def = this.recurringTransactions.find((rt) => rt.id === recurringId);
    if (!def || def.allocated !== true) return false;
    if (enabled) {
      return this.updateRecurringTransaction(recurringId, {
        autoAdjustFloor: true,
        floorAmount: this._roundCents(Number(def.amount) || 0),
      });
    }
    return this.updateRecurringTransaction(recurringId, {
      autoAdjustFloor: undefined,
      floorAmount: undefined,
    });
  },

  // Suggest-only floor right-sizing for a recurring allocation series. Builds
  // per-period true demand (the FULL amount of every expense stamped with this
  // series' drawsFromRecurringId — not drawAmount, which is capped at the
  // bucket and hides overflow), then:
  //   suggested = max(floor, round$5(min(median(last 6) * 1.10, current * 1.5)))
  // Median over a trailing window relaxes back toward the floor as a spike
  // ages out. Guardrails: needs 3+ complete periods with activity (zero-draw
  // periods leave no stamped expenses, so they're naturally excluded — "no
  // activity" isn't treated as $0 demand); the in-progress period (the live
  // bucket's, and anything after) is excluded; a 1.5x-of-current step cap keeps
  // one wild window from ballooning the number. The effective floor is
  // min(floorAmount, current amount) so a user who deliberately lowers the
  // series amount lowers the floor with it. Nothing here writes — returns
  // { suggested, current, floor, periods } or null when there's no suggestion.
  getAllocationFloorSuggestion(recurringId) {
    const def = this.recurringTransactions.find((rt) => rt.id === recurringId);
    if (!def || def.allocated !== true || def.autoAdjustFloor !== true) {
      return null;
    }
    const current = this._roundCents(Number(def.amount) || 0);
    const floorRaw =
      def.floorAmount === undefined ? current : Number(def.floorAmount) || 0;
    const floor = this._roundCents(Math.min(floorRaw, current));
    const todayStr = this._todayString();

    // Per-period demand from stamped expenses, and the live period's date
    // (latest instance of the series on/before today) in one pass.
    const demandByPeriod = new Map();
    let livePeriodDate = null;
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        if (t.hidden === true) return;
        if (
          t.allocated === true &&
          t.type === "expense" &&
          t.recurringId === recurringId &&
          date <= todayStr &&
          (!livePeriodDate || date > livePeriodDate)
        ) {
          livePeriodDate = date;
        }
        if (
          t.type === "expense" &&
          t.allocated !== true &&
          t.drawsFromRecurringId === recurringId &&
          t.drawsFromPeriodDate
        ) {
          const p = t.drawsFromPeriodDate;
          demandByPeriod.set(
            p,
            this._roundCents((demandByPeriod.get(p) || 0) + (Number(t.amount) || 0))
          );
        }
      });
    });

    // Complete periods only: everything before the live bucket's period (or
    // before today if the series has no live instance, e.g. it ended).
    const cutoff = livePeriodDate || todayStr;
    const complete = Array.from(demandByPeriod.entries())
      .filter(([p]) => p < cutoff)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .slice(-6);
    if (complete.length < 3) return null;

    const demands = complete.map(([, v]) => v).sort((a, b) => a - b);
    const mid = Math.floor(demands.length / 2);
    const median =
      demands.length % 2 === 1
        ? demands[mid]
        : (demands[mid - 1] + demands[mid]) / 2;
    const capped = Math.min(median * 1.1, current * 1.5);
    const suggested = this._roundCents(
      Math.max(floor, Math.round(capped / 5) * 5)
    );
    if (suggested === current) return null;
    return {
      suggested,
      current,
      floor,
      periods: complete.map(([date, demand]) => ({ date, demand })),
    };
  },

  // Debit the linked allocation by as much of the expense as it can cover.
  // Overflow (spend > remaining) drains the allocation to 0 and leaves the
  // excess as normal spending. Stores drawAmount for exact reversal later.
  _applyAllocationDraw(transaction) {
    if (
      !transaction ||
      transaction.type !== "expense" ||
      !transaction.drawsFromAllocationId
    ) {
      return;
    }
    const entry = this._findAllocationEntryById(
      transaction.drawsFromAllocationId
    );
    if (!entry) {
      // Allocation no longer exists — drop the dangling link. Keep any
      // drawsFromRecurringId/drawsFromPeriodDate provenance: the bucket is
      // gone (forfeited periods are deleted), but the spend still belongs to
      // that series' history for floor suggestions.
      delete transaction.drawsFromAllocationId;
      delete transaction.drawAmount;
      return;
    }
    const allocation = entry.transaction;
    // Drawing from a recurring allocation instance: freeze that one instance as
    // a persisted modified instance (with a stable id) so the debit survives
    // re-expansion, and rewrite the link from the synthetic key to the real id.
    // Stamp the series id + period date on the expense: forfeited bucket
    // instances are deleted outright (see closeOutExpiredAllocations), so this
    // provenance is the only durable record tying the spend to its period —
    // getAllocationFloorSuggestion's demand history is built from it.
    if (allocation.recurringId) {
      if (!allocation.id) {
        allocation.id = Utils.generateUniqueId();
      }
      allocation.modifiedInstance = true;
      transaction.drawsFromAllocationId = allocation.id;
      transaction.drawsFromRecurringId = allocation.recurringId;
      transaction.drawsFromPeriodDate = entry.date;
    } else {
      delete transaction.drawsFromRecurringId;
      delete transaction.drawsFromPeriodDate;
    }
    const remaining = Math.max(0, this._roundCents(allocation.amount));
    const draw = this._roundCents(
      Math.min(remaining, Math.max(0, Number(transaction.amount) || 0))
    );
    transaction.drawAmount = draw;
    allocation.amount = this._roundCents(allocation.amount - draw);
    allocation._lastModified = new Date().toISOString();
  },

  // Refund a previously-applied draw back to its allocation.
  _reverseAllocationDraw(transaction) {
    if (
      !transaction ||
      !transaction.drawsFromAllocationId ||
      !transaction.drawAmount
    ) {
      return;
    }
    const allocation = this._findAllocationById(
      transaction.drawsFromAllocationId
    );
    if (allocation) {
      allocation.amount = this._roundCents(
        allocation.amount + transaction.drawAmount
      );
      allocation._lastModified = new Date().toISOString();
    }
  },

  // Allocations are rolling reserved cushions: once an allocation's date falls
  // behind the current day and it still holds a balance, it moves up to today
  // so it tracks the current day (rather than sitting a day ahead). Future-dated
  // allocations wait until time catches up; allocations already dated today and
  // fully-drawn ($0) allocations stay put (the user clears $0 ones with Close
  // Out). The id is preserved so any expenses drawing from the allocation stay
  // linked.
  rollForwardAllocations() {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    const moves = [];
    Object.keys(this.transactions).forEach((date) => {
      if (date >= todayStr) return;
      this.transactions[date].forEach((t) => {
        if (
          t.allocated === true &&
          t.type === "expense" &&
          !t.recurringId &&
          t.autoCloseout !== true &&
          this._roundCents(t.amount) > 0
        ) {
          // Auto-close-out allocations are pinned to their date (use-it-or-
          // lose-it by that deadline), so they never roll forward.
          moves.push({ fromDate: date, id: t.id, transaction: t });
        }
      });
    });

    if (moves.length === 0) {
      return false;
    }

    moves.forEach(({ fromDate, id, transaction }) => {
      const arr = this.transactions[fromDate];
      if (!arr) return;
      const idx = id
        ? arr.findIndex((x) => x.id === id)
        : arr.indexOf(transaction);
      if (idx === -1) return;
      arr.splice(idx, 1);
      if (arr.length === 0) {
        delete this.transactions[fromDate];
      }
      transaction._lastModified = new Date().toISOString();
      if (!this.transactions[todayStr]) {
        this.transactions[todayStr] = [];
      }
      this.transactions[todayStr].push(transaction);
    });

    this.debouncedSave();
    return true;
  },

  // Forfeit allocations that have closed out. Two flavors:
  //   - Auto close-out: a pinned use-it-or-lose-it bucket closes once its own
  //     date has fully passed.
  //   - Rolling recurring (allocated, no auto close-out): each period's bucket
  //     stays live until the next same-series instance lands; once a newer
  //     instance is live (dated on/before today), the older one is forfeited.
  // Forfeiting deletes the bucket, releasing any unspent remainder back to the
  // running balance (draws already recorded against it stay as real expenses).
  // Covers one-time allocations and materialized recurring instances; the
  // expansion engine won't re-create a superseded period, so the two together
  // keep closed buckets from lingering or reappearing.
  closeOutExpiredAllocations() {
    const todayStr = this._todayString();
    let changed = false;

    // Per rolling series, the live bucket is the latest instance dated on/before
    // today. Earlier instances of that series are superseded.
    const liveRollingDate = new Map();
    Object.keys(this.transactions).forEach((date) => {
      if (date > todayStr) return;
      this.transactions[date].forEach((t) => {
        if (
          t.allocated === true &&
          t.autoCloseout !== true &&
          t.recurringId &&
          t.type === "expense"
        ) {
          const cur = liveRollingDate.get(t.recurringId);
          if (!cur || date > cur) {
            liveRollingDate.set(t.recurringId, date);
          }
        }
      });
    });

    Object.keys(this.transactions).forEach((date) => {
      const arr = this.transactions[date];
      for (let i = arr.length - 1; i >= 0; i--) {
        const t = arr[i];
        if (t.type !== "expense" || t.allocated !== true) continue;

        let forfeit = false;
        if (t.autoCloseout === true) {
          // The bucket lives through its close-out date — drawable on that
          // day, forfeited the day after. Legacy entries (and recurring
          // instances, which never carry closeoutDate) fall back to the
          // bucket's own date, preserving the original behavior.
          forfeit = (t.closeoutDate || date) < todayStr;
        } else if (t.recurringId) {
          const live = liveRollingDate.get(t.recurringId);
          forfeit = !!live && date < live;
        }
        if (!forfeit) continue;

        if (t.id) {
          this._deletedItems.transactions.push({
            id: t.id,
            deletedAt: Date.now(),
          });
        }
        arr.splice(i, 1);
        changed = true;
      }
      if (arr.length === 0) {
        delete this.transactions[date];
      }
    });
    if (changed) {
      this.debouncedSave();
    }
    return changed;
  },

});
