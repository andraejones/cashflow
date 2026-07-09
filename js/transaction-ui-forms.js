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
        // Allocations are set-aside buckets, not everyday expenses — keep them
        // out of the quick-input suggestion list.
        if (t.allocated === true) return;
        const description = (t.description || "").trim();
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
        // Keep the modal open; just dismiss the suggestion list.
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

  // Shows the "Draw from allocation" dropdown for one-time expenses and
  // (re)populates it with each allocation's remaining balance. Hidden when
  // there are no allocations to draw from. Allocations themselves can't draw
  // from another allocation, which the type select makes structural: the
  // dropdown only appears for the plain "Expense" type.
  updateDrawAllocationVisibility() {
    const select = document.getElementById("transactionDrawAllocation");
    if (!select) return;
    const type = document.getElementById("transactionType").value;
    const recurrence = document.getElementById("transactionRecurrence").value;

    const applicable = type === "expense" && recurrence === "once";
    if (!applicable) {
      select.style.display = "none";
      select.value = "";
      return;
    }

    const previous = select.value;
    // Offer the bucket active for the transaction's own date, not today's, so an
    // expense entered in a later period bills against that period's allocation.
    const dateField = document.getElementById("transactionDate");
    const refDate = dateField && dateField.value ? dateField.value : undefined;
    const allocations = this.store.getAllocations(refDate);
    select.innerHTML = '<option value="">No allocation draw</option>';
    allocations.forEach((a) => {
      const option = document.createElement("option");
      option.value = a.id;
      // Recurring buckets repeat, so tag them with their period date to tell
      // one month's bucket from the next.
      const period = a.recurring ? ` (${this.formatShortDisplayDate(a.date)})` : "";
      option.textContent = `${a.description} — $${a.remaining.toFixed(2)} left${period}`;
      select.appendChild(option);
    });
    select.value = previous && allocations.some((a) => a.id === previous) ? previous : "";
    select.style.display = allocations.length > 0 ? "" : "none";
  },

  // Populates an inline edit form's "Draw from allocation" dropdown with the
  // buckets active for the expense's own date, pre-selecting any current draw.
  // Returns the number of live allocations offered. A current draw that's no
  // longer in the active list (e.g. a superseded recurring period) is still
  // added as an option so saving doesn't silently drop the existing link.
  populateEditDrawAllocation(select, date, currentDrawId) {
    const allocations = this.store.getAllocations(date);
    select.innerHTML = '<option value="">No allocation draw</option>';
    allocations.forEach((a) => {
      const option = document.createElement("option");
      option.value = a.id;
      const period = a.recurring
        ? ` (${this.formatShortDisplayDate(a.date)})`
        : "";
      option.textContent = `${a.description} — $${a.remaining.toFixed(2)} left${period}`;
      select.appendChild(option);
    });
    if (currentDrawId && !allocations.some((a) => a.id === currentDrawId)) {
      const info = this.store.getAllocationInfoById(currentDrawId);
      const option = document.createElement("option");
      option.value = currentDrawId;
      option.textContent = info
        ? `${info.description}, ${this.formatShortDisplayDate(info.date)}`
        : "(current allocation)";
      select.appendChild(option);
    }
    select.value = currentDrawId || "";
    return allocations.length;
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
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-");
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
            recurringTransaction.maxOccurrences = parseInt(maxOccurrences.value, 10);
          }
        }
        break;
      }
    }
  },

});
