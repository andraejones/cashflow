// DebtSnowballUI — rendering (debt list, hero, plan timeline) and the
// cash-infusion CRUD UI. Prototype companion of DebtSnowballUI (class
// declared in debt-snowball.js); no build step — loaded as a plain script
// after the class file and before app.js (see index.html).

Object.assign(DebtSnowballUI.prototype, {

  renderDebts() {
    if (!this.debtList) return;
    this.debtList.innerHTML = "";
    const debts = this.store.getDebts();
    if (debts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "debt-empty";
      empty.textContent = "No debts added yet.";
      this.debtList.appendChild(empty);
      return;
    }
    const today = new Date();
    const viewYear =
      typeof this.currentViewYear === "number"
        ? this.currentViewYear
        : today.getFullYear();
    const viewMonth =
      typeof this.currentViewMonth === "number"
        ? this.currentViewMonth
        : today.getMonth();
    const cutoff = new Date(viewYear, viewMonth + 1, 1);
    const summaries = this.getDebtSummaries(cutoff);
    const summaryMap = {};
    summaries.forEach((s) => { summaryMap[s.debt.id] = s; });
    debts.forEach((debt) => {
      const balance = Number(debt.balance) || 0;
      const summary = summaryMap[debt.id];
      const paid = summary ? summary.paid : 0;
      const minPayment = Number(debt.minPayment) || 0;
      const scheduleLabel = this.getDebtScheduleLabel(debt);
      const row = document.createElement("div");
      row.className = "debt-item";

      const details = document.createElement("div");
      details.className = "debt-details";

      const name = document.createElement("div");
      name.className = "debt-name";
      name.textContent = debt.name;
      details.appendChild(name);

      const meta = document.createElement("div");
      meta.className = "debt-meta";
      const interest =
        typeof debt.interestRate === "number" && debt.interestRate > 0
          ? ` • ${debt.interestRate.toFixed(2)}%`
          : "";
      meta.textContent = `Balance $${balance.toFixed(
        2
      )} • Paid $${paid.toFixed(2)} • Min $${minPayment.toFixed(
        2
      )} • Due ${scheduleLabel}${interest}`;
      details.appendChild(meta);

      row.appendChild(details);

      const actions = document.createElement("div");
      actions.className = "debt-actions";
      const editBtn = document.createElement("button");
      editBtn.className = "secondary-button";
      editBtn.textContent = "Edit";
      editBtn.dataset.action = "edit";
      editBtn.dataset.debtId = debt.id;
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "secondary-button";
      deleteBtn.textContent = "Delete";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.debtId = debt.id;
      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);
      row.appendChild(actions);

      this.debtList.appendChild(row);
    });
  },

  renderHero(projection) {
    if (!this.heroEl) return;
    this.heroEl.innerHTML = "";

    const debts = this.store.getDebts();
    const viewBalances = (projection && projection.viewBalances) || {};
    const summaries = debts
      .map((debt) => ({
        debt,
        remaining: Math.max(
          0,
          typeof viewBalances[debt.id] === "number"
            ? viewBalances[debt.id]
            : Number(debt.balance) || 0
        ),
      }))
      .filter((summary) => summary.remaining > 0);

    if (summaries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "snowball-hero-empty";
      empty.textContent =
        debts.length === 0
          ? "Add your first debt below to project your debt-free date."
          : "🎉 Every debt is projected paid off.";
      this.heroEl.appendChild(empty);
      return;
    }

    const totalDebt = summaries.reduce((sum, s) => sum + s.remaining, 0);

    // Projected debt-free date = the latest payoff among active debts. If any
    // active debt never clears within the projection horizon it has no payoff
    // entry, so the date is unknown (payments don't outrun interest).
    let debtFreeIndex = -Infinity;
    let debtFree = null;
    let allHavePayoff = true;
    summaries.forEach((s) => {
      const payoff = projection.payoffByDebtId
        ? projection.payoffByDebtId[s.debt.id]
        : null;
      if (!payoff) {
        allHavePayoff = false;
        return;
      }
      const idx = this.getMonthIndex(payoff.year, payoff.month);
      if (idx > debtFreeIndex) {
        debtFreeIndex = idx;
        debtFree = payoff;
      }
    });

    const baseIndex = this.getMonthIndex(
      projection.baseYear,
      projection.baseMonth
    );
    const monthsToGo =
      allHavePayoff && debtFree ? Math.max(0, debtFreeIndex - baseIndex) : null;

    const dailyFloor = Number(projection.dailyFloor) || 0;

    const formatWhole = (value) =>
      `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

    const makeCard = ({ label, value, sub, primary }) => {
      const card = document.createElement("div");
      card.className = primary
        ? "snowball-hero-card snowball-hero-primary"
        : "snowball-hero-card";
      const labelEl = document.createElement("div");
      labelEl.className = "snowball-hero-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("div");
      valueEl.className = "snowball-hero-value";
      valueEl.textContent = value;
      card.appendChild(labelEl);
      card.appendChild(valueEl);
      if (sub) {
        const subEl = document.createElement("div");
        subEl.className = "snowball-hero-sub";
        subEl.textContent = sub;
        card.appendChild(subEl);
      }
      return card;
    };

    let primaryValue;
    let primarySub;
    if (allHavePayoff && debtFree) {
      primaryValue = this.formatMonthYear(debtFree.year, debtFree.month);
      primarySub =
        monthsToGo === 0
          ? "Paid off this month"
          : `${monthsToGo} month${monthsToGo === 1 ? "" : "s"} to go`;
    } else {
      primaryValue = "Not yet on track";
      primarySub = "Payments don't cover all interest";
    }
    this.heroEl.appendChild(
      makeCard({
        label: "Projected debt-free",
        value: primaryValue,
        sub: primarySub,
        primary: true,
      })
    );

    this.heroEl.appendChild(
      makeCard({
        label: "Total debt",
        value: formatWhole(totalDebt),
        sub: `${summaries.length} debt${
          summaries.length === 1 ? "" : "s"
        } remaining`,
      })
    );

    this.heroEl.appendChild(
      makeCard({
        label: "Daily floor",
        value: formatWhole(dailyFloor),
        sub: "Surplus above this funds the next payoff",
      })
    );
  },

  renderPlan(projection) {
    if (!this.planList || !this.planSummary) return;
    this.planList.innerHTML = "";
    this.planSummary.innerHTML = "";
    const settings = this.store.getDebtSnowballSettings();
    const viewYear = projection?.viewYear ?? new Date().getFullYear();
    const viewMonth = projection?.viewMonth ?? new Date().getMonth();
    if (!projection) {
      projection = this.calculateSnowballProjection(viewYear, viewMonth, true);
    }
    const viewBalances = projection.viewBalances || {};
    const monthKey = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}`;
    const monthInfo = projection.monthTargets?.[monthKey] || {};
    const viewIndex = this.getMonthIndex(viewYear, viewMonth);
    // Order debts by the sequence in which the projection actually clears them.
    // The daily-floor engine pays off the smallest *running* balance first, and
    // minimum payments reshuffle that order between now and the payoff month, so
    // the snowball's true next target is the debt that clears soonest — not the
    // one with the smallest balance today. Debts that never clear within the
    // horizon (interest outruns payments) have no payoff and sort last.
    const payoffRank = (debtId) => {
      const p = projection.payoffByDebtId?.[debtId];
      return p && typeof p.seq === "number" ? p.seq : Number.POSITIVE_INFINITY;
    };
    const byClearanceOrder = (a, b) => {
      const ra = payoffRank(a.debt.id);
      const rb = payoffRank(b.debt.id);
      if (ra !== rb) return ra - rb;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return a.debt.name.localeCompare(b.debt.name);
    };
    const summaries = this.store
      .getDebts()
      .map((debt) => ({
        debt,
        remaining: Math.max(
          0,
          typeof viewBalances[debt.id] === "number"
            ? viewBalances[debt.id]
            : Number(debt.balance) || 0
        ),
      }))
      // Keep debts that still carry a balance at view-month end, plus any debt
      // the snowball clears within the view month itself (remaining 0 but a
      // real, dated payoff this month) so the debt being paid doesn't vanish
      // from the plan the very month it pays off.
      .filter((summary) => {
        if (summary.remaining > 0) return true;
        const p = projection.payoffByDebtId?.[summary.debt.id];
        return (
          !!p &&
          p.alreadyPaid !== true &&
          this.getMonthIndex(p.year, p.month) === viewIndex
        );
      });

    if (summaries.length === 0) {
      this.planSummary.textContent = "No active debts to target.";
      return;
    }
    // Current target = the active debt that actually clears next.
    const target = [...summaries].sort(byClearanceOrder)[0];
    const summaryText = document.createElement("div");
    summaryText.className = "debt-plan-summary";
    const viewLabel = this.formatMonthYear(viewYear, viewMonth);
    summaryText.textContent = `Current target${viewLabel ? ` (${viewLabel})` : ""}: ${target.debt.name
      } (Projected $${target.remaining.toFixed(2)})`;
    this.planSummary.appendChild(summaryText);

    const extraText = document.createElement("div");
    extraText.className = "debt-plan-extra";
    const dailyFloor = Number(projection.dailyFloor) || 0;
    const lumpSums = monthInfo.lumpSumPaidByDebtId || {};
    const sweptThisMonth = Object.keys(lumpSums).reduce(
      (sum, id) => sum + (Number(lumpSums[id]) || 0),
      0
    );
    // No monthly set-aside fund: a debt is paid off in full on the day the
    // projected checking surplus above the floor can cover it. Cash infusions are
    // applied straight to debt and shown separately in the cash-infusion list.
    extraText.textContent =
      sweptThisMonth > 0
        ? `Daily floor $${dailyFloor.toFixed(
          2
        )} — $${sweptThisMonth.toFixed(2)} paid off this month from surplus above it`
        : `Daily floor $${dailyFloor.toFixed(
          2
        )} — surplus above it funds the next payoff`;
    this.planSummary.appendChild(extraText);

    const summariesByPayoff = [...summaries].sort(byClearanceOrder);

    summariesByPayoff.forEach((summary, index) => {
      const isTarget = summary.debt.id === target.debt.id;
      const item = document.createElement("div");
      item.className = "debt-plan-item";
      if (isTarget) {
        item.classList.add("debt-plan-target");
      }
      const payoff = projection.payoffByDebtId?.[summary.debt.id];
      const payoffLabel = payoff
        ? this.formatPayoffDate(payoff)
        : "No payoff scheduled";

      const head = document.createElement("div");
      head.className = "debt-plan-item-head";

      const rank = document.createElement("span");
      rank.className = "debt-plan-rank";
      rank.textContent = index + 1;

      const name = document.createElement("span");
      name.className = "debt-plan-name";
      name.textContent = summary.debt.name;
      if (isTarget) {
        const badge = document.createElement("span");
        badge.className = "debt-plan-badge";
        badge.textContent = "Target";
        name.appendChild(badge);
      }

      const payoffSpan = document.createElement("span");
      payoffSpan.className = "debt-plan-payoff";
      payoffSpan.textContent = payoffLabel;

      head.appendChild(rank);
      head.appendChild(name);
      head.appendChild(payoffSpan);
      item.appendChild(head);

      // Progress = how much of the original balance is projected paid off.
      const original = Number(summary.debt.balance) || 0;
      const paidFraction =
        original > 0
          ? Math.min(1, Math.max(0, (original - summary.remaining) / original))
          : 0;
      const progress = document.createElement("div");
      progress.className = "debt-plan-progress";
      const fill = document.createElement("div");
      fill.className = "debt-plan-progress-fill";
      fill.style.width = `${Math.round(paidFraction * 100)}%`;
      progress.appendChild(fill);
      item.appendChild(progress);

      const figures = document.createElement("div");
      figures.className = "debt-plan-figures";
      figures.textContent =
        original > 0
          ? `$${summary.remaining.toFixed(2)} left of $${original.toFixed(
              2
            )} (${Math.round(paidFraction * 100)}% paid)`
          : `$${summary.remaining.toFixed(2)} remaining`;
      item.appendChild(figures);

      this.planList.appendChild(item);
    });
  },

  populateCashInfusionTargetOptions() {
    if (!this.cashInfusionTargetInput) return;
    // Clear existing options except the first "Auto" option
    while (this.cashInfusionTargetInput.options.length > 1) {
      this.cashInfusionTargetInput.remove(1);
    }
    // Add debt options
    const debts = this.store.getDebts();
    debts.forEach((debt) => {
      const option = document.createElement("option");
      option.value = debt.id;
      option.textContent = debt.name;
      this.cashInfusionTargetInput.appendChild(option);
    });
  },

  showCashInfusionForm(infusion = null) {
    if (!this.cashInfusionForm) return;
    this.populateCashInfusionTargetOptions();
    if (infusion) {
      this.editingCashInfusionId = infusion.id;
      if (this.cashInfusionFormTitle) {
        this.cashInfusionFormTitle.textContent = "Edit Cash Infusion";
      }
      if (this.cashInfusionNameInput) {
        this.cashInfusionNameInput.value = infusion.name || "";
      }
      if (this.cashInfusionAmountInput) {
        this.cashInfusionAmountInput.value = infusion.amount || "";
      }
      if (this.cashInfusionDateInput) {
        this.cashInfusionDateInput.value = infusion.date || "";
      }
      if (this.cashInfusionTargetInput) {
        this.cashInfusionTargetInput.value = infusion.targetDebtId || "";
      }
    } else {
      this.editingCashInfusionId = null;
      if (this.cashInfusionFormTitle) {
        this.cashInfusionFormTitle.textContent = "Add Cash Infusion";
      }
      if (this.cashInfusionNameInput) {
        this.cashInfusionNameInput.value = "";
      }
      if (this.cashInfusionAmountInput) {
        this.cashInfusionAmountInput.value = "";
      }
      if (this.cashInfusionDateInput) {
        // Default to today's date
        this.cashInfusionDateInput.value = Utils.formatDateString(new Date());
      }
      if (this.cashInfusionTargetInput) {
        this.cashInfusionTargetInput.value = "";
      }
    }
    this.cashInfusionForm.style.display = "block";
    if (this.cashInfusionNameInput) {
      this.cashInfusionNameInput.focus();
    }
  },

  hideCashInfusionForm() {
    if (!this.cashInfusionForm) return;
    this.cashInfusionForm.style.display = "none";
    this.editingCashInfusionId = null;
    if (this.cashInfusionNameInput) {
      this.cashInfusionNameInput.value = "";
    }
    if (this.cashInfusionAmountInput) {
      this.cashInfusionAmountInput.value = "";
    }
    if (this.cashInfusionDateInput) {
      this.cashInfusionDateInput.value = "";
    }
    if (this.cashInfusionTargetInput) {
      this.cashInfusionTargetInput.value = "";
    }
  },

  saveCashInfusion() {
    const name = this.cashInfusionNameInput?.value.trim() || "";
    const amount = parseFloat(this.cashInfusionAmountInput?.value || "0");
    const date = this.cashInfusionDateInput?.value || "";
    const targetDebtId = this.cashInfusionTargetInput?.value || null;

    if (!name) {
      Utils.showNotification("Please enter a description", "error");
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      Utils.showNotification("Please enter a valid amount greater than 0", "error");
      return;
    }
    if (!date || !this.isValidDateString(date)) {
      Utils.showNotification("Please enter a valid date", "error");
      return;
    }

    const infusionData = {
      name,
      amount,
      date,
      targetDebtId: targetDebtId || null,
    };

    if (this.editingCashInfusionId) {
      this.store.updateCashInfusion(this.editingCashInfusionId, infusionData);
      Utils.showNotification("Cash infusion updated");
    } else {
      this.store.addCashInfusion(infusionData);
      Utils.showNotification("Cash infusion added");
    }

    this.hideCashInfusionForm();
    this.refresh();
    this.onUpdate();
  },

  editCashInfusion(infusionId) {
    const infusion = this.store.getCashInfusions().find((inf) => inf.id === infusionId);
    if (!infusion) {
      Utils.showNotification("Cash infusion not found", "error");
      return;
    }
    this.showCashInfusionForm(infusion);
  },

  async deleteCashInfusion(infusionId) {
    const infusion = this.store.getCashInfusions().find((inf) => inf.id === infusionId);
    if (!infusion) {
      Utils.showNotification("Cash infusion not found", "error");
      return;
    }
    const shouldDelete = await Utils.showModalConfirm(
      `Delete cash infusion "${infusion.name}"?`,
      "Delete Cash Infusion",
      { confirmText: "Delete", cancelText: "Cancel" }
    );
    if (!shouldDelete) {
      return;
    }
    this.store.deleteCashInfusion(infusionId);
    Utils.showNotification("Cash infusion deleted");
    this.refresh();
    this.onUpdate();
  },

  renderCashInfusions(projection = null) {
    if (!this.cashInfusionList) return;
    this.cashInfusionList.innerHTML = "";
    const infusions = this.store.getCashInfusions();
    const debts = this.store.getDebts();

    if (infusions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "cash-infusion-empty";
      empty.textContent = "No cash infusions scheduled.";
      this.cashInfusionList.appendChild(empty);
      return;
    }

    // Calculate allocation for each infusion. The plan projection (already run
    // by the caller) supplies the lump-sum payoff schedule so the breakdown's
    // surviving-debt set matches the actual plan.
    const infusionAllocations = this.calculateInfusionAllocations(projection);

    // Sort by date
    const sortedInfusions = [...infusions].sort((a, b) =>
      a.date.localeCompare(b.date)
    );

    sortedInfusions.forEach((infusion) => {
      const amount = Number(infusion.amount) || 0;
      const targetDebt = infusion.targetDebtId
        ? debts.find((d) => d.id === infusion.targetDebtId)
        : null;
      const targetLabel = targetDebt
        ? targetDebt.name
        : "Auto (Snowball Priority)";

      const row = document.createElement("div");
      row.className = "cash-infusion-item";

      const details = document.createElement("div");
      details.className = "cash-infusion-details";

      const nameSpan = document.createElement("span");
      nameSpan.className = "cash-infusion-name";
      nameSpan.textContent = infusion.name;

      const meta = document.createElement("div");
      meta.className = "cash-infusion-meta";
      meta.textContent = `$${amount.toFixed(2)} on ${Utils.formatDisplayDate(
        infusion.date
      )} → ${targetLabel}`;

      details.appendChild(nameSpan);
      details.appendChild(meta);

      // Add allocation breakdown
      const allocation = infusionAllocations[infusion.id];
      if (allocation && Object.keys(allocation).length > 0) {
        const allocationDiv = document.createElement("div");
        allocationDiv.className = "cash-infusion-allocation";

        const allocationParts = [];
        Object.keys(allocation).forEach((debtId) => {
          const debt = debts.find((d) => d.id === debtId);
          const debtName = debt ? debt.name : "Unknown Debt";
          const allocatedAmount = Number(allocation[debtId]) || 0;
          if (allocatedAmount > 0) {
            allocationParts.push(`${debtName}: $${allocatedAmount.toFixed(2)}`);
          }
        });

        if (allocationParts.length > 0) {
          allocationDiv.textContent = `Applied: ${allocationParts.join(", ")}`;
        } else {
          allocationDiv.textContent = "No allocation (all debts may be paid off)";
        }
        details.appendChild(allocationDiv);
      }

      const actions = document.createElement("div");
      actions.className = "cash-infusion-actions";

      const editBtn = document.createElement("button");
      editBtn.className = "edit-btn";
      editBtn.textContent = "Edit";
      editBtn.dataset.infusionId = infusion.id;
      editBtn.dataset.action = "edit";

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "delete-btn";
      deleteBtn.textContent = "Delete";
      deleteBtn.dataset.infusionId = infusion.id;
      deleteBtn.dataset.action = "delete";

      actions.appendChild(editBtn);
      actions.appendChild(deleteBtn);

      row.appendChild(details);
      row.appendChild(actions);
      this.cashInfusionList.appendChild(row);
    });
  },

});
