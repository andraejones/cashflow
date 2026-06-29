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

  constructor(store, recurringManager, onChange, onOpenDay) {
    this.store = store;
    this.recurringManager = recurringManager;
    this.onChange = typeof onChange === "function" ? onChange : () => {};
    // Opens the calendar's day modal for a given ISO date. Lets the user click a
    // reconcile row to jump straight to that day's transactions for context or
    // a manual edit; the reconcile modal stays open underneath (stacked).
    this.onOpenDay = typeof onOpenDay === "function" ? onOpenDay : () => {};

    // Match a bank line to an app entry when the signed amount is equal and the
    // dates are within this many days (Transaction Date vs the day it was
    // logged routinely differ by 1, sometimes 2).
    this.toleranceDays = 2;
    // Unsettled expenses are explicitly waiting to clear and can sit for days
    // before posting, so give them a wider match window than settled entries.
    this.unsettledToleranceDays = 7;
    // A second pass pairs near-but-not-equal amounts (tip/auth drift, e.g. a
    // $41.61 pending hold that settles at $46.61) as "needs review".
    this.amountReviewThreshold = 6; // dollars

    // Pass 3 (name-assisted) lets a shared distinctive word bridge a wider
    // amount gap than pass 2 allows. Guards keep it reliable:
    //  - nameMatchMinRatio: the smaller amount must be at least this fraction of
    //    the larger, so a name hit can't pair $20 with $200.
    //  - distinctiveMaxDocFreq: a shared word only counts if it appears on at
    //    most this many descriptions per side — common merchants that recur all
    //    over the statement (Amazon, Walmart) are excluded; rare names qualify.
    //  - nameMinTokenLen: shared word must be at least this long (prefix-tolerant
    //    for bank truncation like YAIMARAS -> "YAIMARAS BEA").
    this.nameMatchMinRatio = 0.5;
    this.distinctiveMaxDocFreq = 2;
    this.nameMinTokenLen = 4;
    // Dropped from name tokens: transaction-type noise and generic business
    // words that aren't distinguishing on their own.
    this._nameStopwords = new Set([
      "THE", "AND", "FOR", "INC", "LLC", "CORP", "COM", "BILL", "ONLINE",
      "STORE", "SUPERCENTER", "MKTPL", "RETA", "PURCHASE", "PAYMENT",
      "WITHDRAWAL", "DEPOSIT", "RECURRING", "DEBIT", "CARD", "POS", "ACH",
      "ATM", "WWW", "SUB", "USA",
    ]);

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
        if (e.key !== "Escape") return;
        // A day modal opened from a reconcile row stacks on top of this one.
        // Run in the capture phase (before TransactionUI's bubble-phase Escape
        // handler closes that day modal) and only act when we're actually the
        // topmost modal, so Escape dismisses the stacked day modal first and
        // leaves the reconcile report in place.
        if (ModalManager.topModal() !== modal) return;
        this.hide();
      };
      document.addEventListener("keydown", this._escHandler, true);
    }
  }

  hide() {
    const modal = document.getElementById("bankReconcileModal");
    if (!modal) return;
    modal.style.display = "none";
    modal.setAttribute("aria-hidden", "true");
    ModalManager.closeModal(modal);
    if (this._escHandler) {
      document.removeEventListener("keydown", this._escHandler, true);
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

      // Posted Date is when the bank settled the line; used as the settle date
      // when clearing an unsettled app entry. Fall back to Transaction Date.
      const postedDate =
        idx.posted !== -1 ? this._toIsoDate((cells[idx.posted] || "").trim()) : null;

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
        postedDate: postedDate || date,
        signed: Math.round(signed * 100) / 100,
        description,
        pending,
        matched: false,
      });
    }

    // Statement period is the posted-date range (what the bank export filters
    // on); see _statementWindow for why transaction date isn't used here.
    const dates = rows.map((r) => r.postedDate || r.date).sort();
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
    // The reporting window is the posted-date range; the candidate (matching)
    // window also spans the transaction-date range. See _statementWindow.
    const { reportStart, reportEnd, candLo, candHi } = this._statementWindow(bankRows);
    const bankStart = reportStart;
    const bankEnd = reportEnd;

    // Widen the candidate window by the largest tolerance (unsettled entries
    // match up to a week out) so edge-of-statement lines can still match an
    // entry logged earlier/later. Reporting is still clamped to the statement
    // window; margin entries are candidates only.
    const maxTol = Math.max(this.toleranceDays, this.unsettledToleranceDays);
    const appStart = this._shiftIso(candLo, -maxTol);
    const appEnd = this._shiftIso(candHi, maxTol);
    const appItems = this._buildAppItems(appStart, appEnd);

    // Reset match flags. Also clear _match: a re-run after Add/Settle/Fix
    // rebuilds appItems, so a stale _match left from a prior run would point
    // into the discarded array and the clearedUnsettled builder could emit a
    // spurious "still unsettled" row off that ghost reference.
    bankRows.forEach((b) => {
      b.matched = false;
      b._match = null;
    });

    const sortedBank = [...bankRows].sort((a, b) => a.date.localeCompare(b.date));

    // Normalized-merchant name tokens for Pass 2's overlap guard (below). Built
    // from the normalized merchant so a split bank token ("WAL-MART" -> WAL +
    // MART) still lines up with the app's clean name ("Walmart"); raw tokens
    // wouldn't. Pass 3 keeps its own raw-description tokens.
    sortedBank.forEach(
      (b) => (b._normTokens = this._nameTokens(this._normalizeMerchant(b.description)))
    );
    appItems.forEach(
      (a) => (a._normTokens = this._nameTokens(this._normalizeMerchant(a.description)))
    );

    // Raw (un-normalized) tokens. Pass 2's conflict guard (below) needs the
    // product word that normalization discards — "AMAZON MKTPLACE" and "Amazon
    // Prime" both normalize to "Amazon", so only the raw tokens still carry
    // MKTPLACE vs PRIME. Pass 3 also reads these for its rarity scoring.
    sortedBank.forEach((b) => (b._tokens = this._nameTokens(b.description)));
    appItems.forEach((a) => (a._tokens = this._nameTokens(a.description)));

    // Hard rule (see _blockMatch): a bank "Transfer To ... Share" line is a
    // person-to-person share transfer with no merchant. Its round amount
    // collides with unrelated bills (a $40 transfer silently matched a $40
    // recurring bill a day away), so it may pair ONLY with an app entry the user
    // explicitly labeled a transfer.
    sortedBank.forEach((b) => (b._shareTransfer = this._isShareTransfer(b.description)));
    appItems.forEach((a) => (a._isTransferEntry = /transfer/i.test(a.description || "")));

    // Pass 1: exact amount, same sign, nearest date within tolerance.
    sortedBank.forEach((b) => {
      const a = this._bestMatch(b, appItems, (cand) =>
        Math.abs(cand.signed - b.signed) < 0.005
      );
      if (a) {
        b.matched = true;
        a.matched = true;
        b._match = a;
        a._matchedBank = b;
      }
    });

    // Pass 2: near amount (same sign) — "probably the same purchase with a tip
    // or auth-hold difference." Kept deliberately conservative to avoid pairing
    // unrelated lines: same sign, within 1 day, the gap must be both a small
    // absolute amount AND a small fraction of the total (a tip is a few percent;
    // a $5.72 gap on a $9.44 item is a different purchase), AND the two must
    // share a name token — a coincidental near amount alone shouldn't pair
    // unrelated merchants (a $21.42 Walmart debit vs a $25 Mastercard payment).
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

    // Pass 3: name-assisted review match. Amount passes can't bridge a large but
    // legitimate gap (a 25% nail-salon tip, a hold that posts far off). This pass
    // pairs a bank line to an app entry when their descriptions share a
    // *distinctive* word — one rare across this statement, so "AMAZON"/"WALMART"
    // (which recur on many lines) can't carry a match, but "YAIMARAS" can. Still
    // gated by same sign, date tolerance, and a sane amount ratio, and surfaced
    // as a review pair the user confirms — never auto-applied.
    this._nameMatchPass(sortedBank, appItems, reviewPairs);

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
    // Unsettled app expenses split by how far the bank has acknowledged them:
    //   - appPendingAtBank: matched to a pending hold — bank sees it, clearing
    //     soon (a pending hold isn't a clearance, so it stays here rather than
    //     in clearedUnsettled, which requires a posted line).
    //   - appOnlyExpected: no bank line at all — logged here, bank shows nothing
    //     yet, not even pending. Worth a look.
    const appPendingAtBank = [];
    const appOnlyExpected = [];
    const appOnlyUnmatched = [];
    appItems.forEach((a) => {
      if (a.date < bankStart || a.date > bankEnd) return;
      const isUnsettledExpense = a.type === "expense" && a.settled === false;
      const matchedToPending =
        a.matched && a._matchedBank && a._matchedBank.pending;
      if (a.matched && !(isUnsettledExpense && matchedToPending)) return;
      if (isUnsettledExpense) {
        if (matchedToPending) appPendingAtBank.push(a);
        else appOnlyExpected.push(a);
      } else {
        appOnlyUnmatched.push(a);
      }
    });

    // Matched pairs where the app entry is still unsettled but the bank has
    // cleared it -> offer to mark it settled.
    const clearedUnsettled = [];
    bankRows.forEach((b) => {
      if (b.matched && b._match && !b.pending && b._match.type === "expense" && b._match.settled === false) {
        clearedUnsettled.push({ bank: b, app: b._match });
      }
    });

    // Pending holds that exact-matched an entry already in the calendar. These
    // reconcile, so they'd otherwise vanish from the report — but surfacing them
    // (with the matched entry and its date) lets the user spot a scheduled item
    // whose date drifted from the bank's (e.g. a recurring bill due on a day the
    // hold lands earlier), so they can adjust the schedule. Only Pass 1 sets
    // `_match`; review-pair pending lines are already shown in their own section.
    // Skip matches whose entry is an in-window unsettled expense: those already
    // appear under "In app — pending at bank" (appPendingAtBank), so listing them
    // here too would just double up.
    const pendingMatched = [];
    bankRows.forEach((b) => {
      if (!(b.matched && b.pending && b._match)) return;
      const a = b._match;
      const inWindow = a.date >= bankStart && a.date <= bankEnd;
      const isUnsettledExpense = a.type === "expense" && a.settled === false;
      if (inWindow && isUnsettledExpense) return; // shown in appPendingAtBank
      pendingMatched.push({ bank: b, app: a });
    });

    const matchedCount = bankRows.filter((b) => b.matched).length;

    this.result = {
      window: { start: bankStart, end: bankEnd },
      bankCount: bankRows.length,
      matchedCount,
      missingFromApp,
      missingPending,
      reviewPairs,
      appPendingAtBank,
      appOnlyExpected,
      appOnlyUnmatched,
      clearedUnsettled,
      pendingMatched,
    };
    this._renderReport();
  }

  // The statement's date window, computed from two different date columns:
  //
  //  - reportStart/reportEnd come from POSTED Date. A bank export is filtered by
  //    posted date, so the posted-date range is the true statement period. This
  //    is what we display and what clamps the "in app, not on statement" report.
  //  - candLo/candHi span the TRANSACTION-date range as well, because each line
  //    is matched by its transaction date (when the purchase happened — which is
  //    how app entries are dated). The candidate window must cover that so an
  //    edge line still finds its app entry.
  //
  // The split matters at the boundary: a line transacted on day N but posted on
  // N+1 lands in an "N+1 to present" download even though most of day N posted
  // earlier and was excluded. Keying the report off transaction date would
  // stretch the window back onto day N and flag that day's (legitimately logged)
  // entries as missing. Posted date keeps the window where the download drew it.
  _statementWindow(bankRows) {
    const posted = bankRows.map((r) => r.postedDate || r.date).sort();
    const txn = bankRows.map((r) => r.date).sort();
    const reportStart = posted[0];
    const reportEnd = posted[posted.length - 1];
    const txnLo = txn[0];
    const txnHi = txn[txn.length - 1];
    return {
      reportStart,
      reportEnd,
      candLo: txnLo < reportStart ? txnLo : reportStart,
      candHi: txnHi > reportEnd ? txnHi : reportEnd,
    };
  }

  // A bank "Transfer To ... Share" line: a person-to-person credit-union share
  // transfer. Both tokens must be present so a regular merchant line that merely
  // contains the word "transfer" isn't swept in.
  _isShareTransfer(desc) {
    if (!desc) return false;
    const s = String(desc).toLowerCase();
    return s.includes("transfer to") && s.includes("share");
  }

  // Hard match guard, applied in every pass. A share transfer (flagged on the
  // bank row) may match ONLY an app entry whose description contains "transfer";
  // its round amount must never absorb into an unrelated bill. Returns true to
  // block the pairing.
  _blockMatch(bankRow, appItem) {
    if (bankRow._shareTransfer && !appItem._isTransferEntry) return true;
    return false;
  }

  // Among unmatched candidates passing `predicate`, pick the one closest in date
  // (within tolerance), tie-broken by smallest date gap then earliest.
  _bestMatch(bankRow, appItems, predicate) {
    let best = null;
    let bestGap = Infinity;
    for (const cand of appItems) {
      if (cand.matched) continue;
      if (this._blockMatch(bankRow, cand)) continue;
      const gap = this._dayGap(bankRow.date, cand.date);
      if (gap > this._toleranceFor(cand)) continue;
      if (!predicate(cand)) continue;
      if (gap < bestGap) {
        best = cand;
        bestGap = gap;
      }
    }
    return best;
  }

  // Unsettled expenses get the wider window; everything else the default.
  _toleranceFor(cand) {
    return cand.type === "expense" && cand.settled === false
      ? this.unsettledToleranceDays
      : this.toleranceDays;
  }

  // Conservative near-amount pairing for the review pass. Among unmatched
  // candidates within 1 day and the same sign, accept only those whose amount
  // gap is both small in dollars and a small fraction of the total AND that
  // share a name token (prefix-tolerant, on the normalized merchant; no rarity
  // guard since the tight amount gap already constrains the pairing), and return
  // the closest-amount one.
  _bestNearMatch(bankRow, appItems) {
    const bankAbs = Math.abs(bankRow.signed);
    let best = null;
    let bestDiff = Infinity;
    for (const cand of appItems) {
      if (cand.matched) continue;
      if (this._blockMatch(bankRow, cand)) continue;
      if ((cand.signed < 0) !== (bankRow.signed < 0)) continue;
      if (this._dayGap(bankRow.date, cand.date) > 1) continue;
      const candAbs = Math.abs(cand.signed);
      const diff = Math.abs(candAbs - bankAbs);
      if (diff < 0.005) continue; // exact matches were handled in pass 1
      const bigger = Math.max(candAbs, bankAbs);
      if (diff > this.amountReviewThreshold) continue;
      if (diff > 0.25 * bigger) continue;
      if (
        this._distinctiveSharedScore(cand._normTokens, bankRow._normTokens, () => true) <
        this.nameMinTokenLen
      )
        continue;
      // Same merchant, different product: normalization collapses "AMAZON
      // MKTPLACE" and "Amazon Prime" both to "Amazon", so the shared-token
      // check above passes on a coincidental near amount ($14.97 hold vs $15.16
      // renewal). Reject when the raw descriptions each carry a distinctive word
      // the other lacks — positive evidence they're different charges. A bare
      // "Amazon" entry (no product word) still drift-matches.
      if (this._hasConflictingProductToken(cand._tokens, bankRow._tokens)) continue;
      if (diff < bestDiff) {
        best = cand;
        bestDiff = diff;
      }
    }
    return best;
  }

  // Name-assisted pass: pair still-unmatched bank lines to app entries that
  // share a distinctive word. Distinctiveness is measured against this run's
  // own corpus (statement + app), so the threshold adapts — a word is only a
  // basis for matching if it's rare here, regardless of any hardcoded list.
  _nameMatchPass(sortedBank, appItems, reviewPairs) {
    // _tokens (raw) are built once up front in reconcile(); reused here.
    const bankFreq = this._docFreq(sortedBank.map((b) => b._tokens));
    const appFreq = this._docFreq(appItems.map((a) => a._tokens));
    const rare = (tok) =>
      (bankFreq.get(tok) || 0) <= this.distinctiveMaxDocFreq &&
      (appFreq.get(tok) || 0) <= this.distinctiveMaxDocFreq;

    sortedBank.forEach((b) => {
      if (b.matched) return;
      const bankAbs = Math.abs(b.signed);
      if (bankAbs < 0.005) return;
      let best = null;
      let bestScore = 0;
      let bestRatio = 0;
      for (const a of appItems) {
        if (a.matched) continue;
        if (this._blockMatch(b, a)) continue;
        if ((a.signed < 0) !== (b.signed < 0)) continue;
        if (this._dayGap(b.date, a.date) > this._toleranceFor(a)) continue;
        const appAbs = Math.abs(a.signed);
        if (appAbs < 0.005) continue;
        if (Math.abs(appAbs - bankAbs) < 0.005) continue; // exact: earlier pass
        const ratio = Math.min(appAbs, bankAbs) / Math.max(appAbs, bankAbs);
        if (ratio < this.nameMatchMinRatio) continue;
        const score = this._distinctiveSharedScore(a._tokens, b._tokens, rare);
        if (score < this.nameMinTokenLen) continue;
        // Strongest shared word wins, then the closest amount.
        if (score > bestScore || (score === bestScore && ratio > bestRatio)) {
          best = a;
          bestScore = score;
          bestRatio = ratio;
        }
      }
      if (best) {
        b.matched = true;
        best.matched = true;
        reviewPairs.push({
          bank: b,
          app: best,
          diff: Math.abs(Math.abs(best.signed) - Math.abs(b.signed)),
          viaName: true,
        });
      }
    });
  }

  // Distinctive alphabetic words from a description, for name matching. Strips
  // processor stars (SQ *, TST*, DD *), ref/card/store numbers, and generic
  // stopwords; uppercases so comparison is case-insensitive.
  _nameTokens(desc) {
    if (!desc) return new Set();
    let s = String(desc).toUpperCase();
    s = s.replace(/\b[A-Z]{2,4}\s*\*/g, " "); // SQ *, TST*, DD *
    s = s.replace(/[*#]/g, " ");
    s = s.replace(/\b\d[\d.\-]*\b/g, " ");     // amounts, ref/card numbers
    s = s.replace(/[^A-Z ]+/g, " ");
    const out = new Set();
    s.split(/\s+/).forEach((tok) => {
      if (tok.length < 3) return; // also drops 2-letter state codes
      if (this._nameStopwords.has(tok)) return;
      out.add(tok);
    });
    return out;
  }

  // How many descriptions each token appears on (document frequency).
  _docFreq(tokenSets) {
    const freq = new Map();
    tokenSets.forEach((set) => {
      set.forEach((tok) => freq.set(tok, (freq.get(tok) || 0) + 1));
    });
    return freq;
  }

  // Longest distinctive shared word between two token sets, prefix-tolerant so
  // a truncated bank token (YAIMARAS -> "YAIMARA") still matches. Only tokens
  // passing `rare` on both sides count, and only matches of nameMinTokenLen+.
  // Returns the matched length (0 = no distinctive shared word).
  _distinctiveSharedScore(aTokens, bTokens, rare) {
    let best = 0;
    for (const a of aTokens) {
      if (!rare(a)) continue;
      for (const b of bTokens) {
        if (!rare(b)) continue;
        const shorter = a.length <= b.length ? a : b;
        const longer = a.length <= b.length ? b : a;
        if (!longer.startsWith(shorter)) continue;
        if (shorter.length >= this.nameMinTokenLen && shorter.length > best) {
          best = shorter.length;
        }
      }
    }
    return best;
  }

  // True when each token set has a distinctive word (>= nameMinTokenLen) that
  // the other set lacks entirely — i.e. both sides name a product/sub-brand and
  // the names disagree (Amazon MKTPLACE vs Amazon PRIME). Prefix-tolerant so a
  // truncated bank token still counts as shared. One-sided extras (a bank line's
  // location/ref noise against a plain app name) are not a conflict, so genuine
  // auth-hold drift on the same merchant still pairs.
  _hasConflictingProductToken(aTokens, bTokens) {
    const hasUnshared = (from, other) =>
      [...from].some((t) => {
        if (t.length < this.nameMinTokenLen) return false;
        for (const o of other) {
          const shorter = o.length <= t.length ? o : t;
          const longer = o.length <= t.length ? t : o;
          if (longer.startsWith(shorter)) return false; // shared (prefix-tolerant)
        }
        return true;
      });
    return hasUnshared(aTokens, bTokens) && hasUnshared(bTokens, aTokens);
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

    if (needsAttention === 0 && r.missingPending.length === 0) {
      html += `<div class="bank-reconcile-allclear">Everything reconciles for this statement. 🎉</div>`;
    }

    html += this._sectionMissing(r.missingFromApp);
    html += this._sectionReview(r.reviewPairs);
    html += this._sectionClearedUnsettled(r.clearedUnsettled);
    html += this._sectionPending(r.missingPending);
    html += this._sectionPendingMatched(r.pendingMatched);
    html += this._sectionAppOnlyUnmatched(r.appOnlyUnmatched);
    html += this._sectionAppNoBankRecord(r.appOnlyExpected);
    html += this._sectionAppPendingAtBank(r.appPendingAtBank);

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
        <div class="bank-reconcile-row" data-open-date="${b.date}">
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
        // Flag pairs the name pass proposed (often a wider gap, e.g. a tip), so
        // the larger Δ reads as intentional rather than a mismatch.
        const nameTag = p.viaName ? `<span class="br-note">name match</span> ` : "";
        // A pending hold's amount isn't final (the app entry may be the correct
        // settled figure), so don't offer to overwrite it with the hold amount.
        const action = p.bank.pending
          ? `<span class="br-note">${p.viaName ? "name match · " : ""}bank pending</span>`
          : `${nameTag}<button type="button" class="br-action" data-act="fix-amount" data-i="${i}">Use bank amount</button>`;
        return `
        <div class="bank-reconcile-row review" data-open-date="${p.app.date}">
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
        const settleDate = p.bank.postedDate || p.bank.date;
        // Entries (one-time and recurring) settle on the bank's posted date.
        // Only when that already equals the entry's own date is there no move.
        const moves = settleDate !== p.app.date;
        const moveNote = moves
          ? ` <em class="br-move">→ settles ${this._shortDate(settleDate)}</em>`
          : "";
        return `
        <div class="bank-reconcile-row" data-open-date="${p.app.date}">
          <span class="br-date">${this._shortDate(p.app.date)}</span>
          <span class="br-amount expense">${this._money(p.app.signed)}</span>
          <span class="br-desc">${this._esc(p.app.description || "(no description)")}${moveNote}</span>
          <button type="button" class="br-action" data-act="settle" data-i="${i}">Mark settled</button>
        </div>`;
      })
      .join("");
    return this._section(
      "cleared",
      `Cleared at bank — still unsettled (${pairs.length})`,
      "Matched a posted bank line but flagged unsettled. Settling moves the entry to the bank's settle date.",
      items
    );
  }

  _sectionPending(rows) {
    if (rows.length === 0) return "";
    const items = rows
      .map((b, i) => {
        const name = this._normalizeMerchant(b.description);
        return `
        <div class="bank-reconcile-row pending" data-open-date="${b.date}">
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

  // Pending holds that already line up with a logged entry. They reconcile, but
  // we keep them visible alongside the matched entry and its date so a drifted
  // schedule (a recurring bill dated apart from the hold) is easy to spot.
  _sectionPendingMatched(pairs) {
    if (pairs.length === 0) return "";
    const items = pairs
      .map((p) => {
        const name = this._normalizeMerchant(p.bank.description);
        const moves = p.app.date !== p.bank.date;
        const dateNote = moves
          ? ` <em class="br-move">→ scheduled ${this._shortDate(p.app.date)}</em>`
          : "";
        const recurTag = p.app.recurringId ? " (Recurring)" : "";
        return `
        <div class="bank-reconcile-row pending muted" data-open-date="${p.app.date}">
          <span class="br-date">${this._shortDate(p.bank.date)}</span>
          <span class="br-amount ${p.bank.signed < 0 ? "expense" : "income"}">${this._money(p.bank.signed)}</span>
          <span class="br-desc" title="${this._attr(p.bank.description)}">${this._esc(name)} ↔ ${this._esc(p.app.description || "(no description)")}${recurTag}${dateNote}</span>
        </div>`;
      })
      .join("");
    return this._section(
      "pendingmatched",
      `Pending — already in your calendar (${pairs.length})`,
      "A hold that matches an entry you've already logged. If the dates differ, the schedule may need adjusting.",
      items
    );
  }

  _sectionAppOnlyUnmatched(items) {
    if (items.length === 0) return "";
    const rows = items
      .map((a) => {
        return `
        <div class="bank-reconcile-row" data-open-date="${a.date}">
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

  // Unsettled, with no bank line at all — logged here but the bank shows
  // nothing yet, not even a pending hold. Usually just timing (an ACH that
  // hasn't initiated), but worth a glance for a wrong date or duplicate.
  _sectionAppNoBankRecord(items) {
    if (items.length === 0) return "";
    const rows = items
      .map((a) => {
        return `
        <div class="bank-reconcile-row" data-open-date="${a.date}">
          <span class="br-date">${this._shortDate(a.date)}</span>
          <span class="br-amount expense">${this._money(a.signed)}</span>
          <span class="br-desc">${this._esc(a.description || "(no description)")}</span>
        </div>`;
      })
      .join("");
    return this._section(
      "nobank",
      `Unsettled in app, no bank record yet (${items.length})`,
      "Logged here, but the bank shows nothing — not even pending. Worth a look.",
      rows
    );
  }

  // Unsettled, but the bank has placed a pending hold for it — in-flight and
  // clearing soon. Reassuring, no action needed.
  _sectionAppPendingAtBank(items) {
    if (items.length === 0) return "";
    const rows = items
      .map((a) => {
        return `
        <div class="bank-reconcile-row muted" data-open-date="${a.date}">
          <span class="br-date">${this._shortDate(a.date)}</span>
          <span class="br-amount expense">${this._money(a.signed)}</span>
          <span class="br-desc">${this._esc(a.description || "(no description)")}</span>
        </div>`;
      })
      .join("");
    return this._section(
      "pendingbank",
      `In app — pending at bank (${items.length})`,
      "Bank placed a hold; clearing soon — expected, no action needed.",
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
        else if (act === "settle") this._settle(this.result.clearedUnsettled[i]);
        else if (act === "fix-amount") this._fixAmount(this.result.reviewPairs[i]);
      });
    });

    // Clicking a row (anywhere but its action button) opens that day's modal —
    // the bank line's date for bank-only rows, the app entry's date otherwise.
    container.querySelectorAll(".bank-reconcile-row[data-open-date]").forEach((row) => {
      row.addEventListener("click", (e) => {
        if (e.target.closest("button")) return; // let action buttons do their thing
        const date = row.getAttribute("data-open-date");
        if (date) this.onOpenDay(date);
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

  // Settle a cleared-but-unsettled entry, dated to the day it actually settled
  // (the bank's Posted Date) so it counts on that day. When the settle date is
  // the entry's own date, just mark it settled in place. Otherwise move it:
  // one-time entries move directly; recurring instances can't be moved as
  // expansions, so we skip the original occurrence and re-add it as a settled
  // one-time entry on the settle date (same pattern as the carried-forward
  // Settle button).
  _settle(pair) {
    if (!pair || !pair.app) return;
    const appItem = pair.app;
    const index = this._currentIndex(appItem);
    if (index === -1) {
      Utils.showNotification("Could not locate that entry to settle.", "error");
      return;
    }
    const settleDate = (pair.bank && pair.bank.postedDate) || appItem.date;

    if (settleDate === appItem.date) {
      this.store.setTransactionSettled(appItem.date, index, true);
      Utils.showNotification("Marked settled.");
      this._afterMutation();
      return;
    }

    // Snapshot the entry before removing it, preserving allocation fields, and
    // re-add it on the settle date as a fresh object (new id; the delete is
    // tombstoned for merge).
    const tx = this.store.getTransactions()[appItem.date][index];
    const moved = {
      amount: tx.amount,
      type: tx.type,
      description: tx.description,
      settled: true,
    };
    if (tx.allocated === true) {
      moved.allocated = true;
      if (tx.autoCloseout === true) moved.autoCloseout = true;
    }
    if (tx.drawsFromAllocationId) {
      moved.drawsFromAllocationId = tx.drawsFromAllocationId;
    }

    if (appItem.recurringId) {
      const recId = appItem.recurringId;
      this.store.deleteTransaction(appItem.date, index);
      // Skip the original occurrence so re-expansion won't recreate it, and
      // record the move so the calendar/recurrence track the relocation.
      if (!this.recurringManager.isTransactionSkipped(appItem.date, recId)) {
        this.recurringManager.toggleSkipTransaction(appItem.date, recId);
      }
      this.store.moveTransaction(recId, appItem.date, settleDate);
      moved.movedFrom = appItem.date;
      moved.originalRecurringId = recId;
      this.store.addTransaction(settleDate, moved);
    } else {
      this.store.deleteTransaction(appItem.date, index);
      this.store.addTransaction(settleDate, moved);
    }

    Utils.showNotification(`Settled and moved to ${this._shortDate(settleDate)}.`);
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
    const newAmount = Math.abs(pair.bank.signed);
    if (target.recurringId) {
      // A recurring expansion must be edited through editTransaction so it's
      // flagged a modifiedInstance (and given a stable id). A bare
      // store.updateTransaction leaves it recurringId-only, which
      // _filterPersistedTransactions drops on save — the amount fix would
      // silently revert on the next reload/sync.
      this.recurringManager.editTransaction(
        appItem.date,
        index,
        { amount: newAmount },
        "this"
      );
    } else {
      this.store.updateTransaction(appItem.date, index, {
        ...target,
        amount: newAmount,
      });
    }
    Utils.showNotification(`Updated amount to $${newAmount.toFixed(2)}.`);
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
