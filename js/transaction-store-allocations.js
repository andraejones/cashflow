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
        if (t.type === "expense" && t.allocated !== true) {
          // Attribute the WHOLE expense across its split: each row contributes
          // what it was assigned, and whatever the split left uncovered lands
          // on the LAST row — the bucket the user was still filling when the
          // money ran out. With a single row (every expense predating splits)
          // that is exactly the old rule, the full amount as demand, which is
          // the point: a bucket too small to cover its own spending has to
          // still record the demand that would right-size it. `drawn` is capped
          // at the bucket and would hide it.
          const rows = this._normalizeAllocationDraws(t);
          if (rows.length > 0) {
            const shares = this._resolveAllocationDrawShares(t, rows);
            const total = Math.max(0, this._roundCents(Number(t.amount) || 0));
            let assigned = 0;
            shares.forEach((share) => {
              assigned = this._roundCents(assigned + share);
            });
            const uncovered = Math.max(0, this._roundCents(total - assigned));
            rows.forEach((r, i) => {
              if (r.recurringId !== recurringId || !r.periodDate) return;
              const extra = i === rows.length - 1 ? uncovered : 0;
              const p = r.periodDate;
              demandByPeriod.set(
                p,
                this._roundCents((demandByPeriod.get(p) || 0) + shares[i] + extra)
              );
            });
          }
        }
      });
    });

    // Complete periods only: everything before the live bucket's period (or
    // before today if the series has no live instance, e.g. it ended).
    const cutoff = livePeriodDate || todayStr;
    const complete = Array.from(demandByPeriod.entries())
      .filter(([p]) => p < cutoff)
      // Period dates are Map keys, so no two can be equal — but the 0 case
      // costs nothing and keeps every comparator in the app consistent.
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
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

  // ---------------------------------------------------------------------
  // Multi-bucket draws
  //
  // An expense can be split across SEVERAL allocation buckets — "$130 of this
  // $200 Costco run comes out of Groceries, $70 out of Household". The split
  // lives on the expense as `allocationDraws`, one row per bucket:
  //
  //   { allocationId, amount, drawn, recurringId?, periodDate? }
  //
  //   amount — what the user assigned to that bucket, or NULL for "whatever of
  //            the expense is still uncovered". A null row is the pre-split
  //            shape — one bucket covering the whole expense — and it is why
  //            editing the expense's amount still flows straight through to
  //            its bucket, the way it always has. The editor writes null when
  //            a single row covers the entire expense and an explicit figure
  //            for every row of a real split, where the shares are the point.
  //   drawn  — what was actually debited, kept for exact reversal. The editor
  //            caps a row at its bucket's remaining, so a row's share and its
  //            `drawn` normally match; they diverge only when the bucket shrank
  //            underneath a saved expense (a lowered series amount, a cloud
  //            merge), and keeping both is what lets the draw come back in full
  //            when the money does.
  //
  // A row whose bucket has since been forfeited keeps its `recurringId` /
  // `periodDate` and loses its `allocationId`: the spend still belongs to that
  // period's demand history even though there is nothing left to debit.
  //
  // The legacy single-draw fields (`drawsFromAllocationId`, `drawAmount`,
  // `drawsFromRecurringId`, `drawsFromPeriodDate`) are still written, mirroring
  // the primary row, so a device on an older build — or any reader that only
  // cares which bucket an expense is mainly billed against — degrades to the
  // primary bucket instead of seeing no draw at all. `allocationDraws` is the
  // source of truth whenever it is an ARRAY, including an empty one: an edit
  // that clears every row writes `[]`, and the mirrors are then ignored rather
  // than resurrecting the draw the user just removed.
  // ---------------------------------------------------------------------

  // Every draw row of an expense, in a shape readers can trust: usable ids,
  // cent-rounded finite amounts, one row per bucket. Returns fresh objects, so
  // callers can rewrite them without touching the transaction. Nothing coerces
  // `allocationDraws` on the way in from an import or a cloud merge, so this is
  // where the shape is guarded — every field is typeof-checked.
  _normalizeAllocationDraws(transaction) {
    if (!transaction || typeof transaction !== "object") return [];
    const rows = [];
    const seen = new Set();
    const push = (allocationId, amount, drawn, recurringId, periodDate) => {
      const id =
        typeof allocationId === "string" && allocationId ? allocationId : null;
      const rid =
        typeof recurringId === "string" && recurringId ? recurringId : null;
      // A row with neither a bucket to debit nor a series to remember says
      // nothing at all.
      if (!id && !rid) return;
      const key = id || `series:${rid}:${periodDate || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      // null, not 0: "no figure of its own" and "zero" are different rows, and
      // Number(null) is 0 — so the empty cases are checked before coercion.
      const fixed =
        amount === null || amount === undefined || amount === ""
          ? NaN
          : Number(amount);
      const row = {
        amount:
          Number.isFinite(fixed) && fixed >= 0 ? this._roundCents(fixed) : null,
        // Nothing is held by a bucket that no longer exists, so a history-only
        // row can never refund anything.
        drawn: id ? Math.max(0, this._roundCents(drawn)) : 0,
      };
      if (id) row.allocationId = id;
      if (rid) {
        row.recurringId = rid;
        if (typeof periodDate === "string" && periodDate) {
          row.periodDate = periodDate;
        }
      }
      rows.push(row);
    };
    if (Array.isArray(transaction.allocationDraws)) {
      transaction.allocationDraws.forEach((r) => {
        if (!r || typeof r !== "object") return;
        push(r.allocationId, r.amount, r.drawn, r.recurringId, r.periodDate);
      });
      return rows;
    }
    // Legacy single-draw shape — also what an older build, an older export and
    // the cloud merge hand us. It never carried a figure of its own: the draw
    // was always "this whole expense, capped at the bucket", which is exactly
    // what a null amount means here.
    push(
      transaction.drawsFromAllocationId,
      null,
      transaction.drawAmount,
      transaction.drawsFromRecurringId,
      transaction.drawsFromPeriodDate
    );
    return rows;
  },

  // Public read of the split for UI and reporting. Each row also carries the
  // `share` it resolves to against this expense's amount, so no caller has to
  // re-derive what a null amount means.
  getAllocationDraws(transaction) {
    const rows = this._normalizeAllocationDraws(transaction);
    const shares = this._resolveAllocationDrawShares(transaction, rows);
    rows.forEach((row, i) => {
      row.share = shares[i];
    });
    return rows;
  },

  // Each row's assigned share of the expense, in row order: an explicit amount
  // capped by what the expense has left to give, or — for a null row — whatever
  // is still uncovered at that point. Sharing one resolver is what keeps the
  // debit, the demand history and the UI from disagreeing about a split.
  _resolveAllocationDrawShares(transaction, rows) {
    const total = Math.max(
      0,
      this._roundCents(transaction ? transaction.amount : 0)
    );
    let assigned = 0;
    return rows.map((row) => {
      const room = Math.max(0, this._roundCents(total - assigned));
      const share =
        row.amount === null || row.amount === undefined
          ? room
          : this._roundCents(Math.min(row.amount, room));
      assigned = this._roundCents(assigned + share);
      return share;
    });
  },

  // What buckets are actually covering of this expense (sum of `drawn`).
  getAllocationDrawnTotal(transaction) {
    return this._roundCents(
      this._normalizeAllocationDraws(transaction).reduce(
        (sum, row) => sum + row.drawn,
        0
      )
    );
  },

  // Write normalized rows back onto the transaction, keeping the legacy
  // row mirrors in step. An empty list clears every draw field — that is how an
  // explicit unlink (or a type change off expense) erases the link.
  _writeAllocationDraws(transaction, rows) {
    delete transaction.drawsFromAllocationId;
    delete transaction.drawAmount;
    delete transaction.drawsFromRecurringId;
    delete transaction.drawsFromPeriodDate;
    if (!rows || rows.length === 0) {
      delete transaction.allocationDraws;
      return;
    }
    transaction.allocationDraws = rows;
    // Mirror the first row that still has a live bucket; a split whose only
    // rows are history-only mirrors just the provenance, like the legacy
    // dangling-link case did.
    const primary = rows.find((r) => r.allocationId);
    if (primary) {
      transaction.drawsFromAllocationId = primary.allocationId;
      transaction.drawAmount = primary.drawn;
    }
    const prov =
      primary && primary.recurringId
        ? primary
        : rows.find((r) => r.recurringId);
    if (prov) {
      transaction.drawsFromRecurringId = prov.recurringId;
      if (prov.periodDate) {
        transaction.drawsFromPeriodDate = prov.periodDate;
      }
    }
  },

  // Debit every bucket this expense draws from, as much as each can cover, and
  // record what was drawn for exact reversal later. Overflow (a row larger than
  // its bucket's remaining, which the form rejects but a shrinking bucket can
  // still produce) drains that bucket to 0 and leaves the excess as normal
  // spending, same as the single-draw model always did.
  _applyAllocationDraws(transaction) {
    if (!transaction || transaction.type !== "expense") return;
    // An allocation bucket cannot draw from another allocation; the type select
    // makes that structural in the form, and this keeps an imported or merged
    // row from doing it behind the form's back.
    if (transaction.allocated === true) {
      this._writeAllocationDraws(transaction, null);
      return;
    }
    const rows = this._normalizeAllocationDraws(transaction);
    const shares = this._resolveAllocationDrawShares(transaction, rows);
    const applied = [];
    rows.forEach((row, index) => {
      const entry = row.allocationId
        ? this._findAllocationEntryById(row.allocationId)
        : null;
      if (!entry) {
        // Bucket is gone (forfeited periods are deleted outright). Drop the
        // dangling link but keep the series/period provenance: the spend still
        // belongs to that period's history for floor suggestions.
        if (row.recurringId) {
          applied.push({
            amount: row.amount,
            drawn: 0,
            recurringId: row.recurringId,
            periodDate: row.periodDate,
          });
        }
        return;

      }
      const allocation = entry.transaction;
      // Drawing from a recurring allocation instance: freeze that one instance
      // as a persisted modified instance (with a stable id) so the debit
      // survives re-expansion, and rewrite the link from the synthetic key to
      // the real id. Stamp the series id + period date on the row: forfeited
      // bucket instances are deleted outright (see closeOutExpiredAllocations),
      // so this provenance is the only durable record tying the spend to its
      // period — getAllocationFloorSuggestion's demand history is built from it.
      let allocationId = row.allocationId;
      let recurringId;
      let periodDate;
      if (allocation.recurringId) {
        if (!allocation.id) {
          allocation.id = Utils.generateUniqueId();
        }
        allocation.modifiedInstance = true;
        allocationId = allocation.id;
        recurringId = allocation.recurringId;
        periodDate = entry.date;
      }
      // The resolver already capped every share at what the expense has left to
      // give, so a later amount edit can shrink the expense under a split that
      // was valid when it was saved without ever over-drawing.
      const want = shares[index];
      if (want <= 0) return;
      const remaining = Math.max(0, this._roundCents(allocation.amount));
      const draw = this._roundCents(Math.min(remaining, want));
      allocation.amount = this._roundCents(allocation.amount - draw);
      allocation._lastModified = new Date().toISOString();
      applied.push({
        allocationId,
        // The row keeps its OWN figure, not the resolved share: a null row has
        // to stay null or it would freeze at today's amount and stop following
        // the expense.
        amount: row.amount,
        drawn: draw,
        recurringId,
        periodDate,
      });
    });
    // Re-normalize so what lands on the transaction is canonical, whatever the
    // rows looked like coming in.
    this._writeAllocationDraws(
      transaction,
      this._normalizeAllocationDraws({ allocationDraws: applied })
    );
  },

  // Copy an expense's draw rows onto a fresh copy that is about to be re-added
  // elsewhere (a move, a settle, a bank-reconcile relocation). Deleting the
  // original refunds its buckets, so the copy has to carry the split or the
  // spend stands while the buckets are silently credited back. `drawn` is
  // deliberately left off — addTransaction re-debits and recomputes it.
  carryAllocationDraws(source, target) {
    if (!source || !target) return target;
    const rows = this._normalizeAllocationDraws(source).map((r) => {
      // `amount` is copied as-is, null included: a full-cover row must land on
      // the copy as a full-cover row.
      const copy = { amount: r.amount };
      if (r.allocationId) copy.allocationId = r.allocationId;
      if (r.recurringId) {
        copy.recurringId = r.recurringId;
        if (r.periodDate) copy.periodDate = r.periodDate;
      }
      return copy;
    });
    if (rows.length > 0) {
      target.allocationDraws = rows;
    }
    return target;
  },

  // Re-point every expense drawing from `oldId` at `newId`.
  //
  // Relocating a bucket to another date goes through delete + re-add (the
  // tombstone on the old id rules out reusing it), so the bucket comes back
  // under a fresh id while its drawers still name the old one. The links then
  // dangle: the "Drawn from" label disappears, and the next edit of a drawing
  // expense finds no bucket to refund — _applyAllocationDraws drops the row
  // instead, so the reserve stops absorbing the change and the projected
  // balance drifts by the difference. rollForwardAllocations avoids all this by
  // keeping the id when it moves a bucket; a user-initiated move can't, so it
  // repairs the references instead. Returns the number of drawers updated.
  repointAllocationDraws(oldId, newId) {
    if (!oldId || !newId || oldId === newId) return 0;
    let updated = 0;
    Object.keys(this.transactions).forEach((date) => {
      this.transactions[date].forEach((t) => {
        const rows = this._normalizeAllocationDraws(t);
        if (!rows.some((r) => r.allocationId === oldId)) return;
        // The drawer may already have a row on the target bucket (the two ids
        // now name the same bucket) — fold the two together rather than leaving
        // a duplicate that the normalizer would drop, money and all.
        const merged = [];
        rows.forEach((r) => {
          if (r.allocationId === oldId) r.allocationId = newId;
          const dup = r.allocationId
            ? merged.find((m) => m.allocationId === r.allocationId)
            : null;
          if (dup) {
            // Two rows on one bucket: a null (full-cover) row swallows the
            // other's figure, since it already claims everything left.
            dup.amount =
              dup.amount === null || r.amount === null
                ? null
                : this._roundCents(dup.amount + r.amount);
            dup.drawn = this._roundCents(dup.drawn + r.drawn);
            return;
          }
          merged.push(r);
        });
        this._writeAllocationDraws(t, merged);
        t._lastModified = new Date().toISOString();
        updated++;
      });
    });
    if (updated > 0) {
      this.debouncedSave();
    }
    return updated;
  },

  // Refund every previously-applied draw back to its bucket.
  _reverseAllocationDraws(transaction) {
    if (!transaction) return;
    this._normalizeAllocationDraws(transaction).forEach((row) => {
      if (!row.allocationId || !row.drawn) return;
      const allocation = this._findAllocationById(row.allocationId);
      if (!allocation) return;
      allocation.amount = this._roundCents(allocation.amount + row.drawn);
      allocation._lastModified = new Date().toISOString();
    });
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
          // A SKIPPED occurrence set no money aside, so it holds no reserve and
          // cannot supersede anything — getAllocations and the reserve index
          // already exclude it, and this rule has to agree with them or the two
          // halves fight. They did: skipping this week's bucket made this sweep
          // treat the skipped date as "live" and FORFEIT the previous bucket —
          // the one getAllocations was still offering for draws, with money
          // already drawn from it. It was deleted and tombstoned, its remaining
          // reserve was released into every projected balance, and the expenses
          // billed against it were left dangling. On every device.
          if (this.isTransactionSkipped(date, t.recurringId)) {
            return;
          }
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
