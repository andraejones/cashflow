// Bank Reconciliation UI
//
// Lets the user upload a Suncoast Credit Union transaction-history CSV and
// compares it against the app's data over the statement's date window to find:
//   - bank lines missing from the app (you forgot to log them)
//   - amount mismatches (same purchase, wrong amount entered)
//   - app entries the bank hasn't cleared yet (unsettled / expected)
//
// Everything is parsed and compared 100% in the browser (FileReader); nothing
// is uploaded anywhere, consistent with the app's offline-first model.
//
// CRITICAL: the comparison set must include recurring transactions expanded
// into concrete dates (via RecurringTransactionManager.applyRecurringTransactions),
// not just the materialized one-time `transactions` map — otherwise recurring
// debits (subscriptions, ACH) look "missing" when they are actually logged.

class BankReconcileUI {

  constructor(store, recurringManager, onChange) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onChange = typeof onChange === "function" ? onChange : () => {};

    // Match a bank line to an app entry when the signed amount is equal and the
    // dates are within this many days (Transaction Date vs the day it was
    // logged routinely differ by 1, sometimes 2).
    this.toleranceDays = 2;
    // A second pass pairs near-but-not-equal amounts (tip/auth drift, e.g. a
    // $41.61 pending hold that settles at $46.61) as "needs review".
    this.amountReviewThreshold = 6; // dollars

    this.result = null;
    this._escHandler = null;
    this._closeBound = false;
  }

  // ---- Modal lifecycle ---------------------------------------------------

  show() {
    const modal = document.getElementById("bankReconcileModal");
    if (!modal) return;
    this.result = null;
    this._renderUploadState();
    modal.style.display = "block";
    modal.setAttribute("aria-hidden", "false");
    ModalManager.openModal(modal);

    if (!this._closeBound) {
      const closeBtn = document.getElementById("bankReconcileClose");
      if (closeBtn) {
        const close = () => this.hide();
        closeBtn.addEventListener("click", close);
        closeBtn.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            close();
          }
        });
      }
      this._closeBound = true;
    }

    if (!this._escHandler) {
      this._escHandler = (e) => {
        if (e.key === "Escape") this.hide();
      };
      document.addEventListener("keydown", this._escHandler);
    }
  }

  hide() {
    const modal = document.getElementById("bankReconcileModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler);
      this._escHandler = null;
    }
  }

  _renderUploadState() {
    const body = document.getElementById("bankReconcileBody");
    if (!body) return;
    body.innerHTML = `
      <p class="bank-reconcile-hint">
        Upload a Suncoast transaction-history CSV. It's compared against your
        calendar entries for the statement's date range, entirely on this device.
      </p>
      <div class="bank-reconcile-upload">
        <input type="file" id="bankReconcileFile" accept=".csv,text/csv" />
      </div>
      <div id="bankReconcileReport"></div>
    `;
    const input = document.getElementById("bankReconcileFile");
    if (input) {
      input.addEventListener("change", (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) this._handleFile(file);
      });
    }
  }

  _handleFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = this._parseSuncoastCsv(String(reader.result || ""));
        if (parsed.error) {
          Utils.showNotification(parsed.error, "error");
          return;
        }
        if (parsed.rows.length === 0) {
          Utils.showNotification("No transactions found in that CSV.", "error");
          return;
        }
        this._run(parsed.rows);
      } catch (err) {
        console.error("Bank reconcile parse error:", err);
        Utils.showNotification("Could not read that CSV file.", "error");
      }
    };
    reader.onerror = () => {
      Utils.showNotification("Could not read that file.", "error");
    };
    reader.readAsText(file);
  }

  // ---- CSV parsing (Suncoast format) -------------------------------------
  // Columns: Posted Date, Transaction Date, Description, Deposit, Withdrawal, Balance
  // - Withdrawals are parenthesized negatives.
  // - Pending holds show Balance $0.00 and put the (purchase) amount in the
  //   Deposit column even though it is an outflow.

  _parseSuncoastCsv(text) {
    const lines = this._splitCsvRows(text).filter(
      (cells) => cells.some((c) => c.trim() !== "")
    );
    if (lines.length === 0) return { rows: [], error: "That file is empty." };

    const header = lines[0].map((h) => h.trim().toLowerCase());
    const idx = {
      posted: header.indexOf("posted date"),
      txn: header.indexOf("transaction date"),
      desc: header.indexOf("description"),
      deposit: header.indexOf("deposit"),
      withdrawal: header.indexOf("withdrawal"),
      balance: header.indexOf("balance"),
    };
    if (idx.txn === -1 || idx.desc === -1 || idx.deposit === -1 || idx.withdrawal === -1) {
      return {
        rows: [],
        error: "That doesn't look like a Suncoast CSV (expected Transaction Date / Deposit / Withdrawal columns).",
      };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = lines[i];
      const txnRaw = (cells[idx.txn] || "").trim();
      const date = this._toIsoDate(txnRaw);
      if (!date) continue; // skip non-data rows (totals, blanks)

      const deposit = this._parseMoney(cells[idx.deposit]);
      const withdrawal = this._parseMoney(cells[idx.withdrawal]);
      const balance = idx.balance !== -1 ? this._parseMoney(cells[idx.balance]) : null;
      const description = (cells[idx.desc] || "").trim();
      const pending = balance !== null && Math.abs(balance) < 0.005;

      let signed = null;
      if (withdrawal !== null) {
        signed = -Math.abs(withdrawal);
      } else if (deposit !== null) {
        // A pending "deposit" is the hold for a purchase -> treat as outflow.
        signed = pending ? -Math.abs(deposit) : Math.abs(deposit);
      } else {
        continue; // no amount on this row
      }

      rows.push({
        date,
        signed: Math.round(signed * 100) / 100,
        description,
        pending,
        matched: false,
      });
    }

    const dates = rows.map((r) => r.date).sort();
    return {
      rows,
      window: dates.length ? { start: dates[0], end: dates[dates.length - 1] } : null,
    };
  }

  // Minimal CSV row splitter that respects double-quoted fields.
  _splitCsvRows(text) {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    const pushField = () => {
      row.push(field);
      field = "";
    };
    const pushRow = () => {
      pushField();
      rows.push(row);
      row = [];
    };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        pushField();
      } else if (ch === "\n") {
        pushRow();
      } else if (ch === "\r") {
        // handled by the following \n, or ignore a lone CR
        if (text[i + 1] !== "\n") pushRow();
      } else {
        field += ch;
      }
    }
    // trailing field/row
    if (field !== "" || row.length > 0) pushRow();
    return rows;
  }

  _parseMoney(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim();
    if (s === "") return null;
    const negative = s.includes("(");
    s = s.replace(/[$,()\s]/g, "");
    if (s === "") return null;
    const num = parseFloat(s);
    if (isNaN(num)) return null;
    return negative ? -num : num;
  }

  // Accepts M/D/YYYY (Suncoast) -> YYYY-MM-DD.
  _toIsoDate(raw) {
    if (!raw) return null;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    const year = parseInt(m[3], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // ---- Build the app-side comparison set ---------------------------------

  _buildAppItems(startIso, endIso) {
    // Expand recurring definitions into concrete dated instances for every
    // month the window touches. This mutates the store's transactions map the
    // same way the calendar render does, so the recurring instances become
    // visible alongside one-time entries.
    const start = Utils.parseDateString(startIso);
    const end = Utils.parseDateString(endIso);
    const seenMonths = new Set();
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cursor <= end) {
      const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
      if (!seenMonths.has(key)) {
        this.recurringManager.applyRecurringTransactions(
          cursor.getFullYear(),
          cursor.getMonth()
        );
        seenMonths.add(key);
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }

    const transactions = this.store.getTransactions();
    const items = [];
    const day = new Date(start);
    while (day <= end) {
      const dateIso = Utils.formatDateString(day);
      const list = transactions[dateIso] || [];
      list.forEach((t, index) => {
        if (t.hidden === true) return;
        if (t.type === "balance") return; // anchor, not a cashflow line
        if (
          t.recurringId &&
          this.recurringManager.isTransactionSkipped(dateIso, t.recurringId)
        ) {
          return;
        }
        const amount = Math.abs(Number(t.amount) || 0);
        const signed = t.type === "income" ? amount : -amount;
        items.push({
          date: dateIso,
          index,
          id: t.id || null,
          recurringId: t.recurringId || null,
          amount: Math.round(amount * 100) / 100,
          signed: Math.round(signed * 100) / 100,
          type: t.type,
          description: typeof t.description === "string" ? t.description : "",
          settled: t.settled,
          matched: false,
        });
      });
      day.setDate(day.getDate() + 1);
    }
    return items;
  }

  // ---- Reconciliation ----------------------------------------------------

  _run(bankRows) {
    // Stash the full statement so a re-run after Add/Settle/Fix compares
    // against the same set of bank lines.
    this._allBankRows = bankRows;
    const dates = bankRows.map((r) => r.date).sort();
    const bankStart = dates[0];
    const bankEnd = dates[dates.length - 1];

    // Widen the app window by the tolerance so edge-of-statement lines can
    // still match an entry logged a day earlier/later.
    const appStart = this._shiftIso(bankStart, -this.toleranceDays);
    const appEnd = this._shiftIso(bankEnd, this.toleranceDays);
    const appItems = this._buildAppItems(appStart, appEnd);

    // Reset match flags (a re-run after Add/Settle reuses fresh arrays anyway).
    bankRows.forEach((b) => (b.matched = false));

    const sortedBank = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));

    // Pass 1: exact amount, same sign, nearest date within tolerance.
    sortedBank.forEach((b) => {
      const a = this._bestMatch(b, appItems, (cand) =>
        Math.abs(cand.signed - b.signed) < 0.005
      );
      if (a) {
        b.matched = true;
        a.matched = true;
        b._match = a;
      }
    });

    // Pass 2: near amount (same sign) — "probably the same purchase with a tip
    // or auth-hold difference." Kept deliberately conservative to avoid pairing
    // unrelated lines: same sign, within 1 day, and the gap must be both a small
    // absolute amount AND a small fraction of the total (a tip is a few percent;
    // a $5.72 gap on a $9.44 item is a different purchase).
    const reviewPairs = [];
    sortedBank.forEach((b) => {
      if (b.matched) return;
      const a = this._bestNearMatch(b, appItems);
      if (a) {
        b.matched = true;
        a.matched = true;
        reviewPairs.push({ bank: b, app: a, diff: Math.abs(Math.abs(a.signed) - Math.abs(b.signed)) });
      }
    });

    const missingFromApp = [];
    const missingPending = [];
    bankRows.forEach((b) => {
      if (b.matched) return;
      if (b.pending) missingPending.push(b);
      else missingFromApp.push(b);
    });

    // Only report app entries that fall inside the statement window. Entries in
    // the ±tolerance margin were pulled in as match candidates (so an edge bank
    // line can match an entry logged a day earlier/later) but are not
    // discrepancies — they belong to a different statement period.
    const appOnlyExpected = [];
    const appOnlyUnmatched = [];
    appItems.forEach((a) => {
      if (a.matched) return;
      if (a.date < bankStart || a.date > bankEnd) return;
      if (a.type === "expense" && a.settled === false) appOnlyExpected.push(a);
      else appOnlyUnmatched.push(a);
    });

    // Matched pairs where the app entry is still unsettled but the bank has
    // cleared it -> offer to mark it settled.
    const clearedUnsettled = [];
    bankRows.forEach((b) => {
      if (b.matched && b._match && !b.pending && b._match.type === "expense" && b._match.settled === false) {
        clearedUnsettled.push({ bank: b, app: b._match });
      }
    });

    const matchedCount = bankRows.filter((b) => b.matched).length;

    this.result = {
      window: { start: bankStart, end: bankEnd },
      bankCount: bankRows.length,
      matchedCount,
      missingFromApp,
      missingPending,
      reviewPairs,
      appOnlyExpected,
      appOnlyUnmatched,
      clearedUnsettled,
    };
    this._renderReport();
  }

  // Among unmatched candidates passing `predicate`, pick the one closest in date
  // (within tolerance), tie-broken by smallest date gap then earliest.
  _bestMatch(bankRow, appItems, predicate) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of appItems) {
      if (cand.matched) continue;
      const gap = this._dayGap(bankRow.date, cand.date);
      if (gap > this.toleranceDays) continue;
      if (!predicate(cand)) continue;
      if (gap < bestGap) {
        best = cand;
        bestGap = gap;
      }
    }
    return best;
  }

  // Conservative near-amount pairing for the review pass. Among unmatched
  // candidates within 1 day and the same sign, accept only those whose amount
  // gap is both small in dollars and a small fraction of the total, and return
  // the closest-amount one.
  _bestNearMatch(bankRow, appItems) {
    const bankAbs = Math.abs(bankRow.signed);
    let best = null;
    let bestDiff = Infinity;
    for (const cand of appItems) {
      if (cand.matched) continue;
      if ((cand.signed < 0) !== (bankRow.signed < 0)) continue;
      if (this._dayGap(bankRow.date, cand.date) > 1) continue;
      const candAbs = Math.abs(cand.signed);
      const diff = Math.abs(candAbs - bankAbs);
      if (diff < 0.005) continue; // exact matches were handled in pass 1
      const bigger = Math.max(candAbs, bankAbs);
      if (diff > this.amountReviewThreshold) continue;
      if (diff > 0.25 * bigger) continue;
      if (diff < bestDiff) {
        best = cand;
        bestDiff = diff;
      }
    }
    return best;
  }

  _dayGap(isoA, isoB) {
    const a = Utils.parseDateString(isoA);
    const b = Utils.parseDateString(isoB);
    return Math.round(Math.abs(a - b) / 86400000);
  }

  _shiftIso(iso, days) {
    const d = Utils.parseDateString(iso);
    d.setDate(d.getDate() + days);
    return Utils.formatDateString(d);
  }

  // ---- Report rendering --------------------------------------------------

  _renderReport() {
    const container = document.getElementById("bankReconcileReport");
    if (!container || !this.result) return;
    const r = this.result;
    const needsAttention =
      r.missingFromApp.length + r.reviewPairs.length + r.appOnlyUnmatched.length;

    let html = `
      <div class="bank-reconcile-summary">
        <strong>${Utils.formatDisplayDate(r.window.start)} – ${Utils.formatDisplayDate(r.window.end)}</strong>
        · ${r.bankCount} bank line${r.bankCount === 1 ? "" : "s"}
        · ${r.matchedCount} matched
        · ${needsAttention} need${needsAttention === 1 ? "s" : ""} attention
      </div>
    `;

    html += this._sectionMissing(r.missingFromApp);
    html += this._sectionReview(r.reviewPairs);
    html += this._sectionClearedUnsettled(r.clearedUnsettled);
    html += this._sectionPending(r.missingPending);
    html += this._sectionAppOnlyUnmatched(r.appOnlyUnmatched);
    html += this._sectionAppOnlyExpected(r.appOnlyExpected);

    if (needsAttention === 0 && r.missingPending.length === 0) {
      html += `<div class="bank-reconcile-allclear">Everything reconciles for this statement. 🎉</div>`;
    }

    container.innerHTML = html;
    this._bindReportActions(container);
  }

  _money(signed) {
    const sign = signed < 0 ? "-" : "+";
    return `${sign}$${Math.abs(signed).toFixed(2)}`;
  }

  _sectionMissing(rows) {
    if (rows.length === 0) return "";
    const items = rows
      .map((b, i) => {
        const name = this._normalizeMerchant(b.description);
        return `
        <div class="bank-reconcile-row">
          <span class="br-date">${this._shortDate(b.date)}</span>
          <span class="br-amount ${b.signed < 0 ? "expense" : "income"}">${this._money(b.signed)}</span>
          <span class="br-desc" title="${this._attr(b.description)}">${this._esc(name)}</span>
          <button type="button" class="br-action" data-act="add-missing" data-i="${i}">Add</button>
        </div>`;
      })
      .join("");
    return this._section(
      "missing",
      `Missing from app (${rows.length})`,
      "Posted at the bank, not in your calendar. Add logs them as cleared.",
      items
    );
  }

  _sectionReview(pairs) {
    if (pairs.length === 0) return "";
    const items = pairs
      .map((p, i) => {
        const name = this._normalizeMerchant(p.bank.description);
        // A pending hold's amount isn't final (the app entry may be the correct
        // settled figure), so don't offer to overwrite it with the hold amount.
        const action = p.bank.pending
          ? `<span class="br-note">bank pending</span>`
          : `<button type="button" class="br-action" data-act="fix-amount" data-i="${i}">Use bank amount</button>`;
        return `
        <div class="bank-reconcile-row review">
          <span class="br-date">${this._shortDate(p.bank.date)}</span>
          <span class="br-amount">
            bank ${this._money(p.bank.signed)} · app ${this._money(p.app.signed)}
            <em>(Δ$${p.diff.toFixed(2)})</em>
          </span>
          <span class="br-desc" title="${this._attr(p.bank.description)}">${this._esc(name)} ↔ ${this._esc(p.app.description || "(no description)")}</span>
          ${action}
        </div>`;
      })
      .join("");
    return this._section(
      "review",
      `Needs review — amount differs (${pairs.length})`,
      "Likely the same purchase with a tip or hold difference. Check before fixing.",
      items
    );
  }

  _sectionClearedUnsettled(pairs) {
    if (pairs.length === 0) return "";
    const items = pairs
      .map((p, i) => {
        return `
        <div class="bank-reconcile-row">
          <span class="br-date">${this._shortDate(p.app.date)}</span>
          <span class="br-amount expense">${this._money(p.app.signed)}</span>
          <span class="br-desc">${this._esc(p.app.description || "(no description)")}</span>
          <button type="button" class="br-action" data-act="settle" data-i="${i}">Mark settled</button>
        </div>`;
      })
      .join("");
    return this._section(
      "cleared",
      `Cleared at bank — still unsettled (${pairs.length})`,
      "These matched a posted bank line but are flagged unsettled in the app.",
      items
    );
  }

  _sectionPending(rows) {
    if (rows.length === 0) return "";
    const items = rows
      .map((b, i) => {
        const name = this._normalizeMerchant(b.description);
        return `
        <div class="bank-reconcile-row pending">
          <span class="br-date">${this._shortDate(b.date)}</span>
          <span class="br-amount ${b.signed < 0 ? "expense" : "income"}">${this._money(b.signed)}</span>
          <span class="br-desc" title="${this._attr(b.description)}">${this._esc(name)}</span>
          <button type="button" class="br-action" data-act="add-pending" data-i="${i}">Add (unsettled)</button>
        </div>`;
      })
      .join("");
    return this._section(
      "pending",
      `Pending at bank (${rows.length})`,
      "Holds that haven't fully posted. They may still change — adding is optional.",
      items
    );
  }

  _sectionAppOnlyUnmatched(items) {
    if (items.length === 0) return "";
    const rows = items
      .map((a) => {
        return `
        <div class="bank-reconcile-row">
          <span class="br-date">${this._shortDate(a.date)}</span>
          <span class="br-amount ${a.signed < 0 ? "expense" : "income"}">${this._money(a.signed)}</span>
          <span class="br-desc">${this._esc(a.description || "(no description)")}${a.recurringId ? " (Recurring)" : ""}</span>
        </div>`;
      })
      .join("");
    return this._section(
      "apponly",
      `In app, not on statement (${items.length})`,
      "No matching bank line — planned/future spending, a duplicate, or a typo. Worth a look.",
      rows
    );
  }

  _sectionAppOnlyExpected(items) {
    if (items.length === 0) return "";
    const rows = items
      .map((a) => {
        return `
        <div class="bank-reconcile-row muted">
          <span class="br-date">${this._shortDate(a.date)}</span>
          <span class="br-amount expense">${this._money(a.signed)}</span>
          <span class="br-desc">${this._esc(a.description || "(no description)")}</span>
        </div>`;
      })
      .join("");
    return this._section(
      "expected",
      `In app, not yet cleared (${items.length})`,
      "Unsettled entries the bank hasn't posted yet — expected, no action needed.",
      rows
    );
  }

  _section(kind, title, hint, innerHtml) {
    return `
      <div class="bank-reconcile-section br-${kind}">
        <h4>${this._esc(title)}</h4>
        <p class="bank-reconcile-section-hint">${this._esc(hint)}</p>
        ${innerHtml}
      </div>`;
  }

  _bindReportActions(container) {
    container.querySelectorAll(".br-action").forEach((btn) => {
      btn.addEventListener("click", () => {
        const act = btn.getAttribute("data-act");
        const i = parseInt(btn.getAttribute("data-i"), 10);
        if (act === "add-missing") this._addBankRow(this.result.missingFromApp[i], true);
        else if (act === "add-pending") this._addBankRow(this.result.missingPending[i], false);
        else if (act === "settle") this._settle(this.result.clearedUnsettled[i].app);
        else if (act === "fix-amount") this._fixAmount(this.result.reviewPairs[i]);
      });
    });
  }

  // ---- Actions -----------------------------------------------------------

  _addBankRow(bankRow, settled) {
    if (!bankRow) return;
    const amount = Math.abs(bankRow.signed);
    const transaction = {
      amount: Math.round(amount * 100) / 100,
      type: bankRow.signed < 0 ? "expense" : "income",
      description: this._normalizeMerchant(bankRow.description),
    };
    if (transaction.type === "expense") {
      transaction.settled = settled !== false;
    }
    this.store.addTransaction(bankRow.date, transaction);
    Utils.showNotification(`Added ${transaction.description} on ${this._shortDate(bankRow.date)}`);
    this._afterMutation();
  }

  _settle(appItem) {
    if (!appItem) return;
    const index = this._currentIndex(appItem);
    if (index === -1) {
      Utils.showNotification("Could not locate that entry to settle.", "error");
      return;
    }
    this.store.setTransactionSettled(appItem.date, index, true);
    Utils.showNotification("Marked settled.");
    this._afterMutation();
  }

  _fixAmount(pair) {
    if (!pair) return;
    const appItem = pair.app;
    const index = this._currentIndex(appItem);
    if (index === -1) {
      Utils.showNotification("Could not locate that entry to update.", "error");
      return;
    }
    const list = this.store.getTransactions()[appItem.date];
    const target = list[index];
    const updated = { ...target, amount: Math.abs(pair.bank.signed) };
    this.store.updateTransaction(appItem.date, index, updated);
    Utils.showNotification(`Updated amount to $${Math.abs(pair.bank.signed).toFixed(2)}.`);
    this._afterMutation();
  }

  // Re-locate an app entry in the live store (indices shift as data changes).
  _currentIndex(appItem) {
    const list = this.store.getTransactions()[appItem.date];
    if (!Array.isArray(list)) return -1;
    if (appItem.id) {
      const byId = list.findIndex((t) => t.id === appItem.id);
      if (byId !== -1) return byId;
    }
    return list.findIndex(
      (t) =>
        t.type === appItem.type &&
        Math.abs((Number(t.amount) || 0) - appItem.amount) < 0.005 &&
        (typeof t.description === "string" ? t.description : "") === appItem.description &&
        (t.recurringId || null) === appItem.recurringId
    );
  }

  // Re-run the comparison against the (now changed) app data and refresh both
  // this report and the calendar. _allBankRows is the full statement stashed by
  // _run, so the re-run compares against the same bank lines.
  _afterMutation() {
    this.onChange();
    this.recurringManager.invalidateCache();
    if (this._allBankRows) this._run(this._allBankRows);
  }

  // ---- Merchant normalization (display / prefill only) -------------------

  _normalizeMerchant(desc) {
    if (!desc) return "";
    const map = [
      [/CHICK-?FIL-?A/i, "Chick-fil-A"],
      [/WM SUPERCENTER|WAL-?MART|WAL WAL-MART|MURPHY\d*ATWALMRT/i, "Walmart"],
      [/CIRCLE K/i, "Circle K"],
      [/MCDONALD'?S|MCDONALDS/i, "McDonald's"],
      [/WENDY'?S/i, "Wendy's"],
      [/PUBLIX/i, "Publix"],
      [/AMAZON|AMZN/i, "Amazon"],
      [/DUNKIN/i, "Dunkin"],
      [/NETFLIX/i, "Netflix"],
      [/APPLE\.COM\/BILL/i, "Apple"],
      [/ANTHROPIC|CLAUDE/i, "Claude"],
      [/AVANT/i, "Avant"],
      [/VISIBLE/i, "Visible"],
      [/AFFIRM/i, "Affirm"],
      [/DOORDASH|DD \*DOORDASH/i, "DoorDash"],
      [/DOLLARTREE|DOLLAR TREE/i, "Dollar Tree"],
      [/FIVE BELOW/i, "Five Below"],
      [/RACETRAC/i, "RaceTrac"],
      [/CULVERS/i, "Culvers"],
      [/IHOP/i, "IHOP"],
      [/ARBYS|ARBY'?S/i, "Arby's"],
      [/POLLO TROPICAL/i, "Pollo Tropical"],
      [/CHEESECAKE/i, "Cheesecake Factory"],
      [/WAWA/i, "Wawa"],
      [/7-ELEVEN|7-11/i, "7-Eleven"],
      [/PMUSA/i, "PMUSA"],
      [/FILM SOCIETY/i, "Film Society"],
      [/SUNCOAST CREDIT UNION/i, "Suncoast ATM"],
      [/EMPATH HEALTH|TIDEWELL/i, "Empath Health"],
    ];
    for (const [re, name] of map) {
      if (re.test(desc)) return name;
    }
    // Generic cleanup: strip transaction-type prefixes, ref/card/store numbers.
    let s = desc;
    s = s.replace(/^(Recurring\s+)?(Withdrawal|Deposit)\s+/i, "");
    s = s.replace(/^(POS|Debit Card|ACH|at ATM)\s+/i, "");
    s = s.replace(/#\S+/g, "");
    s = s.replace(/Card\s+\d+\s*$/i, "");
    s = s.replace(/\s{2,}/g, " ").trim();
    return s || desc;
  }

  // ---- Small helpers -----------------------------------------------------

  _shortDate(iso) {
    const [y, m, d] = iso.split("-");
    return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
  }

  _esc(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  _attr(str) {
    return this._esc(str).replace(/"/g, "&quot;");
  }
}
