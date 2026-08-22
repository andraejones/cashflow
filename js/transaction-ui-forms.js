// TransactionUI — form helpers: description autocomplete, field-visibility
// toggles (settled/closeout/draw/auto-adjust/free-funds), and the recurrence
// form UI. Prototype companion of TransactionUI (class declared in
// transaction-ui.js); no build step — loaded as a plain script after the class
// file and before app.js (see index.html).

Object.assign(TransactionUI.prototype, {

  populateDescriptionSuggestions() {
    // Build a usage-ranked list of past one-time transaction descriptions
    // (excludes recurring/snowball entries and "Ending Balance"). The dropdown
    // is filtered to the top 5 matches as the user types.
    const counts = new Map();
    const transactions = this.store.getTransactions();
    Object.values(transactions).forEach((dayTransactions) => {
      (dayTransactions || []).forEach((t) => {
        // Skip expanded recurring instances and debt/snowball payments —
        // only genuine one-time entries the user typed themselves.
        if (t.recurringId || t.debtId) return;
        // What-if drafts ride in the shared transactions map, so this read
        // surface has to opt out like the others: a hypothetical is not a
        // description the user has actually used before.
        if (t.whatIf === true) return;
        // Allocations are set-aside buckets, not everyday expenses — keep them
        // out of the quick-input suggestion list.
        if (t.allocated === true) return;
        // `typeof`, not `|| ""`: a non-string description (nothing coerces the
        // field on the way in from an import or a cloud merge) made this
        // `.trim()` throw. This scans the WHOLE transactions map and runs at
        // the top of showTransactionDetails, so one bad row anywhere dropped
        // EVERY day modal into the read-only fallback — no Edit, Delete,
        // Settle, Skip or working add form, on any day. Same guard the other
        // read surfaces use.
        const description =
          typeof t.description === "string" ? t.description.trim() : "";
        if (!description || description === "Ending Balance") return;
        const key = description.toLowerCase();
        const existing = counts.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          counts.set(key, { description, count: 1 });
        }
      });
    });

    this._descriptionSuggestions = Array.from(counts.values()).sort(
      (a, b) => b.count - a.count || a.description.localeCompare(b.description)
    );
    this._activeSuggestionIndex = -1;
  },

  renderDescriptionSuggestions(query) {
    const list = document.getElementById("descriptionSuggestions");
    const input = document.getElementById("transactionDescription");
    if (!list || !input) return;

    // Autocomplete is turned off for allocations — they aren't everyday
    // expenses and shouldn't be matched against the suggestion list.
    const typeEl = document.getElementById("transactionType");
    if (typeEl && typeEl.value === "allocation") {
      this.closeDescriptionSuggestions();
      return;
    }

    const term = (query || "").trim().toLowerCase();
    const all = this._descriptionSuggestions || [];
    // Hide an exact match — no point suggesting what's already fully typed.
    const matches = all
      .filter((entry) => {
        const value = entry.description.toLowerCase();
        return term ? value.includes(term) && value !== term : true;
      })
      .slice(0, 5);

    this._activeSuggestionIndex = -1;
    input.removeAttribute("aria-activedescendant");
    list.innerHTML = "";

    if (matches.length === 0) {
      this.closeDescriptionSuggestions();
      return;
    }

    matches.forEach((entry, index) => {
      const item = document.createElement("li");
      item.className = "description-suggestion";
      item.id = `descriptionSuggestion-${index}`;
      item.setAttribute("role", "option");
      item.dataset.value = entry.description;

      const label = document.createElement("span");
      label.className = "suggestion-label";
      this.appendHighlightedText(label, entry.description, term);
      item.appendChild(label);

      // mousedown (not click) so it fires before the input's blur handler.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.applyDescriptionSuggestion(entry.description);
      });

      list.appendChild(item);
    });

    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  },

  // Renders `text` into `parent`, wrapping the portion matching `term` in a
  // highlighted span so the user sees why each suggestion matched.
  appendHighlightedText(parent, text, term) {
    if (!term) {
      parent.textContent = text;
      return;
    }
    const matchStart = text.toLowerCase().indexOf(term);
    if (matchStart === -1) {
      parent.textContent = text;
      return;
    }
    const before = text.slice(0, matchStart);
    const match = text.slice(matchStart, matchStart + term.length);
    const after = text.slice(matchStart + term.length);
    if (before) parent.appendChild(document.createTextNode(before));
    const strong = document.createElement("span");
    strong.className = "suggestion-match";
    strong.textContent = match;
    parent.appendChild(strong);
    if (after) parent.appendChild(document.createTextNode(after));
  },

  applyDescriptionSuggestion(value) {
    const input = document.getElementById("transactionDescription");
    if (input) {
      input.value = value;
      input.focus();
    }
    this.closeDescriptionSuggestions();
  },

  closeDescriptionSuggestions() {
    const list = document.getElementById("descriptionSuggestions");
    const input = document.getElementById("transactionDescription");
    if (list) {
      list.hidden = true;
      list.innerHTML = "";
    }
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    this._activeSuggestionIndex = -1;
  },

  handleDescriptionKeydown(event) {
    const list = document.getElementById("descriptionSuggestions");
    if (!list || list.hidden) return;
    const items = Array.from(list.children);
    if (items.length === 0) return;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        this.moveActiveSuggestion(1, items);
        break;
      case "ArrowUp":
        event.preventDefault();
        this.moveActiveSuggestion(-1, items);
        break;
      case "Enter":
        if (this._activeSuggestionIndex >= 0) {
          event.preventDefault();
          this.applyDescriptionSuggestion(
            items[this._activeSuggestionIndex].dataset.value
          );
        }
        break;
      case "Escape":
        // Fallback only. The document-level capture handler in
        // TransactionUI.initEventListeners runs before this one (this listener
        // is on the input, a descendant of document) and already dismisses the
        // list while keeping the modal open — stopPropagation here can never
        // beat it. Kept so the list still closes if that guard is ever
        // bypassed; by then the list is normally hidden and we return above.
        event.stopPropagation();
        this.closeDescriptionSuggestions();
        break;
      default:
        break;
    }
  },

  moveActiveSuggestion(delta, items) {
    const input = document.getElementById("transactionDescription");
    const count = items.length;
    items.forEach((item) => item.classList.remove("is-active"));
    this._activeSuggestionIndex =
      (this._activeSuggestionIndex + delta + count) % count;
    const active = items[this._activeSuggestionIndex];
    active.classList.add("is-active");
    active.scrollIntoView({ block: "nearest" });
    if (input) input.setAttribute("aria-activedescendant", active.id);
  },

  updateSettledToggleVisibility() {
    const type = document.getElementById("transactionType").value;
    const toggleGroup = document.getElementById("toggleGroup");
    if (toggleGroup) {
      toggleGroup.style.display =
        type === "expense" || type === "allocation" ? "" : "none";
    }
    this.syncAllocateState();
    this.updateDrawAllocationVisibility();
  },

  // Shows the close-out date picker for one-time auto-close-out allocations.
  // The bucket stays drawable through this date and is forfeited the day
  // after. Defaults to the transaction's own date (which reproduces the
  // pre-picker "closes when its date passes" behavior) and can't be earlier
  // than it. Recurring allocations never get the picker — each period's
  // bucket keeps closing when its own date passes.
  updateCloseoutDateVisibility() {
    const field = document.getElementById("closeoutDateField");
    const input = document.getElementById("transactionCloseoutDate");
    if (!field || !input) return;
    const type = document.getElementById("transactionType").value;
    const recurrence = document.getElementById("transactionRecurrence").value;
    const autoCloseoutCb = document.getElementById("transactionAutoCloseout");
    const applicable =
      type === "allocation" &&
      recurrence === "once" &&
      autoCloseoutCb && autoCloseoutCb.checked;
    if (!applicable) {
      field.style.display = "none";
      return;
    }
    const dateValue = document.getElementById("transactionDate").value;
    if (dateValue) {
      input.min = dateValue;
      if (!input.value || input.value < dateValue) {
        input.value = dateValue;
      }
    }
    field.style.display = "";
  },

  // ---------------------------------------------------------------------
  // The allocation-draw editor
  //
  // One expense can be split across several buckets ("$130 of this $200 Costco
  // run from Groceries, $70 from Household"), so the control is a LIST of rows
  // — bucket + amount — not a single select. It is built once here and used by
  // both entry points, the add modal and the day-detail inline edit form,
  // because a split typed in one has to be editable in the other.
  //
  // Three rules are enforced here so the store never has to guess at intent:
  //   - a bucket chosen on one row is not offered on any other, which makes a
  //     duplicate row structurally impossible;
  //   - a row can't exceed what its bucket has AVAILABLE to this expense — its
  //     remaining plus whatever this same expense already draws from it, since
  //     saving refunds the old draw before re-applying;
  //   - the rows can't add up to more than the expense. Adding up to LESS is
  //     fine: the remainder is ordinary spending, exactly how an over-large
  //     single draw has always behaved.
  // ---------------------------------------------------------------------

  _drawCents(value) {
    const num = Number(value);
    return Math.round(((Number.isFinite(num) ? num : 0) + Number.EPSILON) * 100) / 100;
  },

  // Renders (or re-renders) a draw editor into `container`.
  //   date            — the expense's own date; buckets are the ones live for
  //                     that date, so an expense entered in a later period
  //                     bills against that period's allocation.
  //   amountElementId — the field holding the expense amount, read live so each
  //                     new row can default to whatever is still uncovered.
  //   existing        — the expense's current draw rows (edit only). Their
  //                     `drawn` is added back to each bucket's availability.
  //   rows            — rows to show; omit to keep whatever is on screen, which
  //                     is what makes a re-render (type/date change) preserve a
  //                     split the user is in the middle of typing.
  // Returns the number of buckets on offer, so callers can decide whether the
  // control is worth showing at all.
  renderAllocationDrawEditor(container, options) {
    if (!container) return 0;
    const opts = options || {};
    const prev = container._drawEditorConfig || {};
    const date = opts.date !== undefined ? opts.date : prev.date;
    const amountElementId =
      opts.amountElementId !== undefined
        ? opts.amountElementId
        : prev.amountElementId;
    const existing = opts.existing !== undefined ? opts.existing : prev.existing || [];
    const rows = opts.rows !== undefined ? opts.rows : this.readAllocationDrawRows(container);

    const buckets = this.store.getAllocations(date);
    const available = new Map();
    const labels = new Map();
    buckets.forEach((b) => {
      available.set(b.id, this._drawCents(b.remaining));
      labels.set(b.id, b.description);
    });
    // This expense's own draws are refunded before the save re-applies them, so
    // that money is available to it even though getAllocations counts it spent.
    existing.forEach((r) => {
      if (!r || !r.allocationId || !available.has(r.allocationId)) return;
      available.set(
        r.allocationId,
        this._drawCents(available.get(r.allocationId) + (Number(r.drawn) || 0))
      );
    });
    // A row pointing at a bucket that is no longer live (a superseded recurring
    // period) keeps an option of its own, so saving can't silently drop a link
    // the user never touched.
    const offered = buckets.slice();
    rows.forEach((r) => {
      if (!r.allocationId || offered.some((b) => b.id === r.allocationId)) return;
      const info = this.store.getAllocationInfoById(r.allocationId);
      offered.push({
        id: r.allocationId,
        description: info ? info.description : "(current allocation)",
        date: info ? info.date : "",
        recurring: false,
        remaining: null,
      });
      labels.set(r.allocationId, info ? info.description : "(current allocation)");
    });

    container._drawEditorConfig = {
      date,
      amountElementId,
      existing,
      available,
      labels,
    };
    // The row defaults are a function of the expense amount, and the amount can
    // be typed AFTER a bucket is chosen (or corrected later). Re-render on every
    // change to it, which re-defaults the rows the user has not typed into and
    // leaves the ones they have.
    const amountEl = amountElementId
      ? document.getElementById(amountElementId)
      : null;
    if (amountEl && !amountEl._drawEditorHooked && amountEl.addEventListener) {
      amountEl._drawEditorHooked = true;
      amountEl.addEventListener("input", () => {
        // The editor may be gone (modal closed, edit form cancelled); its config
        // is cleared when it is torn down, and that is the signal to stand down.
        if (!container._drawEditorConfig) return;
        this.renderAllocationDrawEditor(container, {});
      });
    }

    container.innerHTML = "";
    if (offered.length === 0) {
      container.style.display = "none";
      return 0;
    }
    container.style.display = "";

    // Row 0 always exists (its "No allocation draw" option is how a split is
    // cleared); later rows come and go with the ✕ button.
    const list = rows.length > 0 ? rows.slice() : [{ allocationId: "", amount: "" }];
    const used = list.map((r) => r.allocationId).filter(Boolean);
    list.forEach((row, index) => {
      container.appendChild(
        this._buildAllocationDrawRow(container, row, index, offered, available, used)
      );
    });

    if (used.length > 0 && used.length < offered.length) {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "draw-allocation-add";
      addBtn.textContent = "+ Split across another allocation";
      addBtn.addEventListener("click", () => {
        const current = this.readAllocationDrawRows(container);
        current.push({ allocationId: "", amount: "" });
        this.renderAllocationDrawEditor(container, { rows: current });
        const selects = container.querySelectorAll("[data-draw-bucket]");
        const last = selects[selects.length - 1];
        if (last && last.focus) last.focus();
      });
      container.appendChild(addBtn);
    }
    return offered.length;
  },

  _buildAllocationDrawRow(container, row, index, offered, available, used) {
    const config = container._drawEditorConfig || {};
    const wrapper = document.createElement("div");
    wrapper.className = "draw-allocation-row";
    wrapper.setAttribute("data-draw-row", String(index));

    const select = document.createElement("select");
    select.className = "draw-allocation-select";
    select.setAttribute("data-draw-bucket", "");
    select.setAttribute(
      "aria-label",
      index === 0 ? "Draw from allocation" : "Draw from another allocation"
    );
    const blank = document.createElement("option");
    blank.value = "";
    blank.textContent = index === 0 ? "No allocation draw" : "Choose an allocation";
    select.appendChild(blank);
    offered.forEach((a) => {
      // Every bucket claimed by another row is off the menu, so two rows can
      // never name the same bucket.
      if (a.id !== row.allocationId && used.indexOf(a.id) !== -1) return;
      const option = document.createElement("option");
      option.value = a.id;
      // Recurring buckets repeat, so tag them with their period date to tell
      // one month's bucket from the next.
      const period = a.recurring ? ` (${this.formatShortDisplayDate(a.date)})` : "";
      const left =
        a.remaining === null
          ? ""
          : ` — $${Utils.formatAmount(
              available.has(a.id) ? available.get(a.id) : a.remaining
            )} available`;
      option.textContent = `${a.description}${left}${period}`;
      select.appendChild(option);
    });
    select.value = row.allocationId || "";
    select.addEventListener("change", () => {
      const current = this.readAllocationDrawRows(container);
      if (current[index]) {
        // A changed bucket re-defaults its amount rather than carrying the
        // previous bucket's figure onto one that may not have that much.
        current[index].amount = "";
        current[index].touched = false;
        if (!current[index].allocationId && index > 0) {
          current.splice(index, 1);
        }
      }
      this.renderAllocationDrawEditor(container, { rows: current });
    });
    wrapper.appendChild(select);

    if (row.allocationId) {
      const amountInput = document.createElement("input");
      amountInput.type = "number";
      amountInput.step = "0.01";
      amountInput.min = "0";
      amountInput.className = "draw-allocation-amount";
      amountInput.setAttribute("data-draw-amount", "");
      amountInput.setAttribute(
        "aria-label",
        `Amount drawn from ${config.labels && config.labels.get(row.allocationId)
          ? config.labels.get(row.allocationId)
          : "this allocation"}`
      );
      const cap = available.has(row.allocationId) ? available.get(row.allocationId) : null;
      if (cap !== null) amountInput.max = String(cap);
      const typed = row.amount === undefined || row.amount === null ? "" : String(row.amount);
      // A figure the user typed is theirs to keep; anything else is a default
      // that follows the expense amount.
      if (row.touched && typed !== "") {
        amountInput.value = typed;
        amountInput.setAttribute("data-draw-touched", "1");
      } else {
        amountInput.value = String(
          this._defaultDrawAmount(container, row.allocationId, index, cap)
        );
      }
      amountInput.addEventListener("input", () => {
        amountInput.setAttribute("data-draw-touched", "1");
      });
      wrapper.appendChild(amountInput);
    }

    if (index > 0) {
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "draw-allocation-remove";
      removeBtn.textContent = "✕";
      removeBtn.setAttribute("aria-label", "Remove this allocation from the split");
      removeBtn.addEventListener("click", () => {
        const current = this.readAllocationDrawRows(container);
        current.splice(index, 1);
        this.renderAllocationDrawEditor(container, { rows: current });
      });
      wrapper.appendChild(removeBtn);
    }
    return wrapper;
  },

  // What a freshly-chosen bucket should cover: whatever the expense still has
  // uncovered, capped at what that bucket can actually pay. The cap is why a
  // single row against a too-small bucket still behaves like it always did —
  // it covers what it can and the rest is ordinary spending.
  _defaultDrawAmount(container, allocationId, index, cap) {
    const config = container._drawEditorConfig || {};
    const amountEl = config.amountElementId
      ? document.getElementById(config.amountElementId)
      : null;
    const expense = amountEl ? parseFloat(amountEl.value) : NaN;
    const total = Number.isFinite(expense) && expense > 0 ? this._drawCents(expense) : 0;
    let claimed = 0;
    this.readAllocationDrawRows(container).forEach((r, i) => {
      if (i === index || !r.allocationId) return;
      const value = parseFloat(r.amount);
      if (Number.isFinite(value) && value > 0) claimed = this._drawCents(claimed + value);
    });
    const uncovered = Math.max(0, this._drawCents(total - claimed));
    const capped = cap === null ? uncovered : Math.min(uncovered, cap);
    return this._drawCents(Math.max(0, capped));
  },

  // The editor's rows exactly as they sit on screen, empties included — this is
  // what a re-render replays, so a half-typed split survives one.
  readAllocationDrawRows(container) {
    const out = [];
    if (!container || !container.querySelectorAll) return out;
    const rowEls = container.querySelectorAll("[data-draw-row]");
    Array.prototype.forEach.call(rowEls, (el) => {
      const select = el.querySelector("[data-draw-bucket]");
      const amount = el.querySelector("[data-draw-amount]");
      out.push({
        allocationId: select ? select.value : "",
        amount: amount ? amount.value : "",
        touched: !!amount && amount.getAttribute("data-draw-touched") === "1",
      });
    });
    return out;
  },

  // Validate the editor and convert it to the store's draw rows. Returns
  // { rows, error }; a non-null error is a message to show the user, and
  // nothing should be saved until it clears.
  collectAllocationDraws(container, expenseAmount) {
    if (!container || container.style.display === "none") {
      return { rows: [], error: null };
    }
    const config = container._drawEditorConfig || {};
    const available = config.available || new Map();
    const labels = config.labels || new Map();
    const rows = [];
    let error = null;
    let total = 0;
    this.readAllocationDrawRows(container).forEach((raw) => {
      if (error || !raw.allocationId) return;
      const name = labels.get(raw.allocationId) || "That allocation";
      const value = parseFloat(raw.amount);
      if (!Number.isFinite(value) || value <= 0) {
        error = `Enter an amount greater than 0 to draw from ${name}.`;
        return;
      }
      const amount = this._drawCents(value);
      const cap = available.has(raw.allocationId) ? available.get(raw.allocationId) : null;
      // Half a cent of slack: the inputs are decimal strings and the cap is a
      // rounded figure, so an exact "spend the whole bucket" entry must not
      // fail on a float hair.
      if (cap !== null && amount > cap + 0.005) {
        error = `${name} only has $${Utils.formatAmount(cap)} available.`;
        return;
      }
      total = this._drawCents(total + amount);
      rows.push({ allocationId: raw.allocationId, amount });
    });
    const expense = this._drawCents(expenseAmount);
    if (!error && total > expense + 0.005) {
      error = `Allocation draws add up to $${Utils.formatAmount(total)}, more than the $${Utils.formatAmount(expense)} expense.`;
    }
    // A lone bucket covering the whole expense is stored WITHOUT a figure of
    // its own — the pre-split shape, where the draw simply is the expense. That
    // is what keeps a later amount edit (here, in bank reconciliation's "fix
    // amount", anywhere) flowing straight through to the bucket instead of
    // freezing at the figure that happened to be in this box.
    if (!error && rows.length === 1 && total >= expense - 0.005) {
      rows[0].amount = null;
    }
    return { rows: error ? [] : rows, error };
  },

  // Shows the draw editor for one-time, non-allocated expenses in the add
  // modal, rebuilt against the transaction's own date. Hidden when there are no
  // buckets to draw from. An allocation can't draw from another allocation,
  // which the type select makes structural: the editor only appears for the
  // plain "Expense" type. Pass `reset` to start from an empty split (a fresh
  // open of the modal) rather than keeping what is on screen.
  updateDrawAllocationVisibility(reset) {
    const container = document.getElementById("transactionDrawAllocations");
    if (!container) return;
    const type = document.getElementById("transactionType").value;
    const recurrence = document.getElementById("transactionRecurrence").value;

    const applicable = type === "expense" && recurrence === "once";
    if (!applicable) {
      container.innerHTML = "";
      container.style.display = "none";
      container._drawEditorConfig = null;
      return;
    }
    // Offer the buckets active for the transaction's own date, not today's, so
    // an expense entered in a later period bills against that period.
    const dateField = document.getElementById("transactionDate");
    const refDate = dateField && dateField.value ? dateField.value : undefined;
    this.renderAllocationDrawEditor(container, {
      date: refDate,
      amountElementId: "transactionAmount",
      existing: [],
      rows: reset ? [] : undefined,
    });
  },

  // Builds an inline edit form's draw editor for `date`, seeded with the
  // expense's current split. Returns the number of buckets offered so the
  // caller can skip the control when there is nothing to choose and nothing to
  // preserve.
  populateEditDrawAllocation(container, date, transaction, amountElementId) {
    const existing = this.store.getAllocationDraws(transaction);
    return this.renderAllocationDrawEditor(container, {
      date,
      amountElementId,
      existing,
      // Show each row's resolved share, so a full-cover row (no figure of its
      // own) arrives in the box as the number it actually stands for.
      rows: existing.map((r) => ({
        allocationId: r.allocationId || "",
        amount: r.share,
        // A row with a figure of its own was set deliberately and must not be
        // re-defaulted; a full-cover row has no figure to preserve and should
        // keep following the amount.
        touched: r.amount !== null,
      })),
    });
  },

  // When the "Allocation" type is selected, settlement no longer applies: the
  // Settled toggle is hidden (saving forces settled=true so the reserve
  // subtracts like a normal cleared expense rather than being carried as
  // unsettled), the "Auto close-out" toggle is revealed, and the description
  // autocomplete is suppressed.
  //
  // Recurrence is available for any allocation, with two distinct flavors:
  //   - Allocation + auto close-out → a fresh pinned, use-it-or-lose-it bucket
  //     each period that closes once its own date passes.
  //   - Allocation only (no auto close-out) → a rolling bucket that stays live
  //     across its period; each new instance closes the prior one (forfeiting
  //     any unspent remainder back to the balance).
  syncAllocateState() {
    const typeEl = document.getElementById("transactionType");
    const settledLabel = document.getElementById("settledToggleLabel");
    if (!typeEl || !settledLabel) return;
    const allocated = typeEl.value === "allocation";
    settledLabel.style.display = allocated ? "none" : "";

    // The auto close-out toggle only applies to allocations.
    const autoCloseoutCb = document.getElementById("transactionAutoCloseout");
    const autoCloseoutLabel = document.getElementById("autoCloseoutToggleLabel");
    if (autoCloseoutLabel) {
      autoCloseoutLabel.style.display = allocated ? "" : "none";
    }
    if (autoCloseoutCb && !allocated) {
      autoCloseoutCb.checked = false;
    }

    if (allocated) {
      this.closeDescriptionSuggestions();
    }
    this.updateCloseoutDateVisibility();
    this.updateAutoAdjustVisibility();
    this.updateFreeFundsVisibility();
  },

  // The "Suggest amount from spending history" opt-in only applies to
  // recurring allocations (floor suggestions are computed per series from
  // period demand history), so it's shown only when the Allocation type is
  // selected AND a recurrence is chosen. Hiding also unchecks, so a form left
  // in another state can't silently carry the flag onto a save.
  updateAutoAdjustVisibility() {
    const label = document.getElementById("autoAdjustToggleLabel");
    const cb = document.getElementById("transactionAutoAdjust");
    if (!label || !cb) return;
    const typeEl = document.getElementById("transactionType");
    const recurrence = document.getElementById("transactionRecurrence");
    const applies =
      typeEl && typeEl.value === "allocation" &&
      recurrence && recurrence.value !== "once";
    label.style.display = applies ? "" : "none";
    if (!applies) {
      cb.checked = false;
    }
  },

  // The "free funds" designation only applies to recurring allocations (the
  // series' live bucket stands in for calendar balances), so the toggle
  // follows the same visibility rule as auto-adjust: the Allocation type
  // selected AND a recurrence chosen. Hiding also unchecks so a stale state
  // can't carry the flag onto a save.
  updateFreeFundsVisibility() {
    const label = document.getElementById("freeFundsToggleLabel");
    const cb = document.getElementById("transactionFreeFunds");
    if (!label || !cb) return;
    const typeEl = document.getElementById("transactionType");
    const recurrence = document.getElementById("transactionRecurrence");
    const applies =
      typeEl && typeEl.value === "allocation" &&
      recurrence && recurrence.value !== "once";
    label.style.display = applies ? "" : "none";
    if (!applies) {
      cb.checked = false;
    }
  },

  formatShortDisplayDate(dateString) {
    // Callers pass map keys (always well-formed) but also stored FIELDS —
    // `originalDate`, `closeoutDate` — which nothing coerces on the way in from
    // an import or a cloud merge. A non-string threw on .split, and this runs
    // inside showTransactionDetails' loop, so that day's modal fell back to the
    // read-only version. Anything that isn't a Y-M-D string formats as empty
    // rather than as "undefined-undefined-…".
    if (typeof dateString !== "string" || !dateString) return "";
    const [year, month, day] = dateString.split("-");
    if (!year || !month || !day) return "";
    return `${month}-${day}-${year.slice(2)}`;
  },

  updateRecurrenceOptions() {
    const recurrenceType = document.getElementById("transactionRecurrence").value;
    const existingOptions = document.getElementById("advancedRecurrenceOptions");
    if (existingOptions) {
      existingOptions.remove();
    }

    if (recurrenceType === "once") {
      return;
    }
    const advancedOptions = document.createElement("div");
    advancedOptions.id = "advancedRecurrenceOptions";
    advancedOptions.className = "advanced-recurrence-options";
    if (recurrenceType === "monthly") {
      this.addDaySpecificOptions(advancedOptions);
    } else if (recurrenceType === "semi-monthly") {
      Utils.buildSemiMonthlyOptions(advancedOptions, '');
    } else if (recurrenceType === "custom") {
      Utils.buildCustomIntervalOptions(advancedOptions, '');
    }
    Utils.buildBusinessDayOptions(advancedOptions, '');
    Utils.buildEndConditionOptions(advancedOptions, '');
    const transactionForm = document.getElementById("transactionForm");
    transactionForm.appendChild(advancedOptions);
  },

  addDaySpecificOptions(container) {
    const group = document.createElement("div");
    group.className = "option-group";

    const label = document.createElement("label");
    label.setAttribute("for", "daySpecificOption");
    label.textContent = "Day pattern:";

    const daySpecificSelect = document.createElement("select");
    daySpecificSelect.id = "daySpecificOption";
    daySpecificSelect.name = "daySpecificOption";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "Same day each month";
    daySpecificSelect.appendChild(defaultOption);
    Utils.DAY_SPECIFIC_OPTIONS.forEach(option => {
      const optionElement = document.createElement("option");
      optionElement.value = option.value;
      optionElement.textContent = option.label;
      daySpecificSelect.appendChild(optionElement);
    });

    group.appendChild(label);
    group.appendChild(daySpecificSelect);
    container.appendChild(group);

    // Explicit "last day of every month" toggle. Mutually exclusive with the
    // Nth-weekday day pattern above (the expansion prioritizes the day pattern),
    // so the two disable each other to keep the choice unambiguous.
    const lastDayGroup = document.createElement("div");
    // `last-day-option-group` neutralizes the generic `.option-group label` /
    // `.option-group input` rules (bold block label, bordered/padded input) so
    // the reused `.settled-toggle-label` renders as its intended flex-row toggle.
    lastDayGroup.className = "option-group last-day-option-group";
    const lastDayLabel = document.createElement("label");
    lastDayLabel.className = "settled-toggle-label";
    const lastDayCheckbox = document.createElement("input");
    lastDayCheckbox.type = "checkbox";
    lastDayCheckbox.id = "lastDayOfMonthOption";
    lastDayCheckbox.name = "lastDayOfMonthOption";
    lastDayLabel.appendChild(lastDayCheckbox);
    lastDayLabel.appendChild(
      document.createTextNode(" Repeat on the last day of each month")
    );
    lastDayGroup.appendChild(lastDayLabel);
    container.appendChild(lastDayGroup);

    const syncMutualExclusion = () => {
      const patternChosen = !!daySpecificSelect.value;
      lastDayCheckbox.disabled = patternChosen;
      if (patternChosen) {
        lastDayCheckbox.checked = false;
      }
      daySpecificSelect.disabled = lastDayCheckbox.checked;
    };
    daySpecificSelect.addEventListener("change", syncMutualExclusion);
    lastDayCheckbox.addEventListener("change", syncMutualExclusion);
  },

  addAdvancedRecurringOptions(recurringTransaction) {
    const advancedOptions = document.getElementById("advancedRecurrenceOptions");
    if (!advancedOptions) {
      return;
    }
    if (recurringTransaction.recurrence === "monthly") {
      const daySpecificOption = document.getElementById("daySpecificOption");
      if (daySpecificOption && daySpecificOption.value) {
        recurringTransaction.daySpecific = true;
        recurringTransaction.daySpecificData = daySpecificOption.value;
      } else {
        // Day pattern wins over last-day (expansion checks daySpecific first),
        // so only honor the last-day toggle when no pattern is selected.
        const lastDayOption = document.getElementById("lastDayOfMonthOption");
        if (lastDayOption && lastDayOption.checked) {
          recurringTransaction.lastDayOfMonth = true;
        }
      }
    }
    if (recurringTransaction.recurrence === "semi-monthly") {
      const firstDay = document.getElementById("semiMonthlyFirstDay");
      const secondDay = document.getElementById("semiMonthlySecondDay");

      if (firstDay && secondDay) {
        const days = [];
        days.push(parseInt(firstDay.value, 10));

        if (secondDay.value === "last") {
          recurringTransaction.semiMonthlyLastDay = true;
          days.push(31);
        } else {
          days.push(parseInt(secondDay.value, 10));
        }

        recurringTransaction.semiMonthlyDays = days;
      }
    }
    if (recurringTransaction.recurrence === "custom") {
      const intervalValue = document.getElementById("customIntervalValue");
      const intervalUnit = document.getElementById("customIntervalUnit");

      if (intervalValue && intervalUnit) {
        recurringTransaction.customInterval = {
          value: parseInt(intervalValue.value, 10),
          unit: intervalUnit.value
        };
      }
    }
    const businessDayAdjustment = document.getElementById("businessDayAdjustment");
    if (businessDayAdjustment) {
      recurringTransaction.businessDayAdjustment = businessDayAdjustment.value;
    }
    const endConditionRadios = document.querySelectorAll('input[name="endCondition"]');
    for (const radio of endConditionRadios) {
      if (radio.checked) {
        if (radio.value === "date") {
          const endDate = document.getElementById("endDate");
          if (endDate && endDate.value) {
            recurringTransaction.endDate = endDate.value;
          }
        } else if (radio.value === "occurrence") {
          const maxOccurrences = document.getElementById("maxOccurrences");
          if (maxOccurrences) {
            // Only a usable cap is written. parseInt("") is NaN, which
            // JSON.stringify persists as null and the expansion engine reads
            // through `rt.maxOccurrences || null` as "no end" — so clearing the
            // field turned "end after N occurrences" into a series that never
            // ends, silently, and every projected balance carried it forever.
            // addTransaction rejects that input before we get here (as it does
            // for the custom interval); this is the belt to that brace, and it
            // matches collectDebtAdvancedOptions, which has always guarded.
            const parsed = parseInt(maxOccurrences.value, 10);
            if (Number.isFinite(parsed) && parsed > 0) {
              recurringTransaction.maxOccurrences = parsed;
            }
          }
        }
        break;
      }
    }
  },

});
