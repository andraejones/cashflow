// Browser smoke + interaction harness.
//
// verify-logic.js and verify-walk-parity.js load the sources into a `vm` with
// hand-written DOM stubs, which is fast and dependency-free but structurally
// blind to anything that depends on real DOM semantics. Two fixes for
// Escape-key handling looked correct in review and in the stubbed harnesses,
// and were still wrong in a browser: the handlers were registered in the BUBBLE
// phase, so the dialog on top had already popped itself off ModalManager's
// stack by the time the guard checked who owned Escape — and the guard waved
// the teardown through. Only a real event dispatch catches that.
//
// This harness boots index.html in headless Chromium over a throwaway static
// server and drives the app the way a person does. It is deliberately NOT part
// of `npm test`: it needs puppeteer, which is not a committed dependency (the
// project is buildless and node_modules is gitignored). Run it with
//   npm run test:ui
// It exits 0 with a "skipped" note when puppeteer isn't installed, so it is
// safe to wire into any pipeline.

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CONTENT_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

let puppeteer;
try {
  puppeteer = require("puppeteer");
} catch (err) {
  console.log(
    "verify-ui: puppeteer is not installed — skipping the browser harness.\n" +
      "           (npm i -D puppeteer to enable it; npm test is unaffected.)"
  );
  process.exit(0);
}

// Serve the repo root read-only on an ephemeral port. file:// would do for the
// markup but not for localStorage, which every path here depends on.
function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split("?")[0];
    const filePath = path.join(
      ROOT,
      urlPath === "/" ? "index.html" : decodeURIComponent(urlPath)
    );
    if (
      !filePath.startsWith(ROOT) ||
      !fs.existsSync(filePath) ||
      fs.statSync(filePath).isDirectory()
    ) {
      res.writeHead(404);
      return res.end("not found");
    }
    requestsWhileOffline++;
    res.writeHead(200, {
      "Content-Type":
        CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

// Bumped for every file the server actually serves; the offline phase resets it
// to zero and then asserts nothing more arrives.
let requestsWhileOffline = 0;
const failures = [];
function check(name, passed, detail = "") {
  const line = `${passed ? "✅" : "❌"} ${name}${detail ? `  (${detail})` : ""}`;
  console.log(line);
  if (!passed) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The PIN flow talks to the user through Utils.showModalPrompt/showModalAlert,
// which drive the shared #appModal. Answer it the way a person would.
async function answerPrompt(page, value) {
  await sleep(250);
  await page.evaluate((v) => {
    document.getElementById("appModalInput").value = v;
    document.getElementById("appModalConfirm").click();
  }, value);
  await sleep(250);
}
async function dismissAlert(page) {
  await sleep(250);
  await page.evaluate(() => {
    const btn = document.getElementById("appModalConfirm");
    if (btn) btn.click();
  });
  await sleep(250);
}

(async () => {
  const { server, port } = await startServer();
  let serverClosed = false;
  const closeServer = () =>
    new Promise((resolve) => {
      if (serverClosed) return resolve();
      serverClosed = true;
      server.close(() => resolve());
    });
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`);
  });
  page.on("requestfailed", (req) => {
    // Google Fonts are optional and unreachable offline; everything else must load.
    if (!/fonts\.(googleapis|gstatic)\.com/.test(req.url())) {
      consoleErrors.push(`request failed: ${req.url()}`);
    }
  });

  const isOpen = (selector) =>
    page.evaluate((sel) => {
      const el = document.querySelector(sel);
      return !!el && el.style.display === "block";
    }, selector);

  try {
    await page.goto(`http://localhost:${port}/index.html`, {
      waitUntil: "networkidle0",
    });
    await sleep(700);

    // ---- Boot ------------------------------------------------------------
    const boot = await page.evaluate(() => ({
      appReady: !!window.app && window.app._initialized === true,
      rendered:
        document.getElementById("calendarAgenda").children.length > 0 ||
        document.getElementById("calendarDays").children.length > 0,
      month: document.getElementById("currentMonth").textContent.trim(),
      menuItems: document.getElementById("calendarOptions").children.length,
      build: window.APP_BUILD,
    }));
    check("app boots and initializes", boot.appReady);

    // The two view containers are switched with the `hidden` ATTRIBUTE, and an
    // author `display` declaration outranks the UA's [hidden] { display: none }.
    // Without an explicit .days[hidden] / .agenda-list[hidden] rule both stayed
    // laid out whichever view was active, leaving an empty padded strip above
    // the real one. Only a real layout can catch this.
    const viewSwitch = async () =>
      page.evaluate(() => {
        const grid = document.getElementById("calendarDays");
        const agenda = document.getElementById("calendarAgenda");
        const box = (el) => ({
          hidden: el.hidden,
          display: getComputedStyle(el).display,
          height: Math.round(el.getBoundingClientRect().height),
        });
        return { mode: window.app.calendarUI.viewMode, grid: box(grid), agenda: box(agenda) };
      });
    const startMode = await viewSwitch();
    const inactiveIsGone = (v) =>
      (v.grid.hidden ? v.grid.display === "none" && v.grid.height === 0 : true) &&
      (v.agenda.hidden ? v.agenda.display === "none" && v.agenda.height === 0 : true);
    check("the inactive view container takes no space", inactiveIsGone(startMode),
      `${startMode.mode}: grid ${startMode.grid.height}px / agenda ${startMode.agenda.height}px`);
    await page.evaluate(() => window.app.calendarUI.toggleViewMode());
    await sleep(400);
    const toggled = await viewSwitch();
    check("still true after toggling the view", inactiveIsGone(toggled),
      `${toggled.mode}: grid ${toggled.grid.height}px / agenda ${toggled.agenda.height}px`);
    await page.evaluate(() => window.app.calendarUI.toggleViewMode());
    await sleep(400);
    check("calendar renders", boot.rendered, boot.month);
    check("menu is populated", boot.menuItems > 5, `${boot.menuItems} items`);
    check("build stamp is exposed", typeof boot.build === "string" && !!boot.build, boot.build);

    // ---- No horizontal overflow at any supported width -------------------
    // A bare `1fr` grid track is minmax(auto, 1fr): the `auto` minimum will not
    // shrink below the widest cell's min-content width, so a four-figure day
    // balance pushed the seven columns past a 320px viewport and the whole page
    // scrolled sideways. Nothing but a real layout measures this.
    await page.evaluate(() => {
      const day = (offset) =>
        Utils.formatDateString(new Date(Date.now() + offset * 86400000));
      const store = window.app.store;
      // Deliberately NOT on today: a later phase asserts on the day-detail
      // modal's own figures, and extra rows on today would be folded into them.
      // A four-figure anchor propagates forward through every later cell, which
      // is what actually stresses the grid tracks.
      store.addTransaction(day(-5), { amount: 5230.11, type: "balance", description: "Ending Balance" });
      store.addTransaction(day(-4), { amount: 2145.99, type: "income", description: "Paycheck" });
      store.addTransaction(day(-3), { amount: 1234.56, type: "expense", description: "Rent", settled: true });
      window.app.updateUI();
    });
    const originalViewport = page.viewport();
    for (const [width, height, label] of [
      [320, 568, "320px"],
      [375, 812, "375px"],
      [768, 1024, "768px"],
    ]) {
      await page.setViewport({ width, height });
      for (const mode of ["agenda", "grid"]) {
        await page.evaluate((m) => {
          if (window.app.calendarUI.viewMode !== m) window.app.calendarUI.toggleViewMode();
        }, mode);
        await sleep(350);
        const layout = await page.evaluate(() => ({
          docWidth: document.documentElement.scrollWidth,
          winWidth: window.innerWidth,
          // Content escaping its own day cell would be clipping, not scrolling.
          spilling: [...document.querySelectorAll(".day")].filter((cell) => {
            const box = cell.getBoundingClientRect();
            return [...cell.querySelectorAll("*")].some((child) => {
              const c = child.getBoundingClientRect();
              return c.width > 0 && (c.right > box.right + 1 || c.left < box.left - 1);
            });
          }).length,
        }));
        check(
          `no sideways scroll at ${label} in ${mode} view`,
          layout.docWidth <= layout.winWidth + 1 && layout.spilling === 0,
          `doc ${layout.docWidth} / win ${layout.winWidth}, ${layout.spilling} cells spilling`
        );
      }
    }
    await page.evaluate(() => {
      if (window.app.calendarUI.viewMode !== "agenda") window.app.calendarUI.toggleViewMode();
    });
    if (originalViewport) await page.setViewport(originalViewport);
    await sleep(300);

    // ---- Add a transaction through the real form -------------------------
    const todayStr = await page.evaluate(() =>
      Utils.formatDateString(new Date())
    );
    await page.evaluate((d) => {
      const cell = document.querySelector(`[data-date="${d}"]`);
      if (cell) cell.click();
    }, todayStr);
    await sleep(250);
    check("day modal opens from a day click", await isOpen("#transactionModal"));

    await page.click("#transactionAmount");
    await page.type("#transactionAmount", "2500"); // cents-first entry -> 25.00
    await page.click("#transactionDescription");
    await page.type("#transactionDescription", "UI Harness Coffee");
    await page.evaluate(() =>
      document.querySelector("#transactionForm button").click()
    );
    await sleep(400);
    check(
      "cents-first amount entry stores 25.00",
      await page.evaluate(() =>
        Object.values(window.app.store.getTransactions())
          .flat()
          .some((t) => t.description === "UI Harness Coffee" && t.amount === 25)
      )
    );

    // ---- The recurrence end-condition number must be validated -----------
    // "End after N occurrences" reads a free-form number input. A blank field
    // gives parseInt("") === NaN, JSON.stringify persists that as null, and the
    // expansion engine reads `rt.maxOccurrences || null` as "no end" — so the
    // user's bounded series became one that repeats forever, silently, and
    // every projected balance carried it. The custom-interval field next to it
    // has always been rejected; this one was not. Driven through the real form
    // because the advanced-recurrence fields only exist once the recurrence
    // select fires its change handler.
    const openDayForm = async () => {
      await page.evaluate((d) => {
        const cell = document.querySelector(`[data-date="${d}"]`);
        if (cell) cell.click();
      }, todayStr);
      await sleep(250);
    };

    const submitRecurring = async (occurrenceValue) => {
      await openDayForm();
      await page.evaluate(() => {
        const rec = document.getElementById("transactionRecurrence");
        rec.value = "monthly";
        rec.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await sleep(150);
      const built = await page.evaluate(() => !!document.getElementById("maxOccurrences"));
      if (!built) return { built: false };
      await page.evaluate((value) => {
        document.getElementById("transactionAmount").value = "12.00";
        document.getElementById("transactionDescription").value = "UI Harness Capped";
        const radio = document.getElementById("endConditionOccurrence");
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        const max = document.getElementById("maxOccurrences");
        max.disabled = false;
        max.value = value;
      }, occurrenceValue);
      await page.evaluate(() =>
        document.querySelector("#transactionForm button").click()
      );
      await sleep(400);
      return {
        built: true,
        series: await page.evaluate(() =>
          window.app.store
            .getRecurringTransactions()
            .filter((rt) => rt.description === "UI Harness Capped")
            .map((rt) => rt.maxOccurrences)
        ),
      };
    };

    const blank = await submitRecurring("");
    check("advanced recurrence options are built on demand", blank.built !== false);
    if (blank.built !== false) {
      check(
        "a blank occurrence count is rejected, not stored as 'never ends'",
        blank.series.length === 0,
        `stored ${JSON.stringify(blank.series)}`
      );
      // The dialog stays open on a rejected submit; close it before reusing it.
      await page.evaluate(() => window.app.transactionUI.closeModals());
      await sleep(150);

      const zero = await submitRecurring("0");
      check(
        "a zero occurrence count is rejected too",
        zero.series.length === 0,
        `stored ${JSON.stringify(zero.series)}`
      );
      await page.evaluate(() => window.app.transactionUI.closeModals());
      await sleep(150);

      const good = await submitRecurring("3");
      check(
        "a valid occurrence count is still stored",
        good.series.length === 1 && good.series[0] === 3,
        `stored ${JSON.stringify(good.series)}`
      );
      // Leave no capped series behind for the later phases to trip over.
      await page.evaluate(() => {
        window.app.store
          .getRecurringTransactions()
          .filter((rt) => rt.description === "UI Harness Capped")
          .forEach((rt) => window.app.store.deleteRecurringTransaction(rt.id));
        window.app.recurringManager.invalidateCache();
        window.app.updateUI();
      });
      await sleep(200);
    }

    // ---- Escape belongs to the autocomplete while its list is open -------
    // The suggestion list is dismissed by the DOCUMENT-level capture handler in
    // TransactionUI, not by the input's own keydown listener: the input is a
    // descendant of document, so its stopPropagation() runs after the capture
    // handler has already called closeModals(). Before the fix, one Escape
    // aimed at the dropdown tore the whole day modal down and wiped the
    // half-typed entry — invisible to both vm harnesses, which never dispatch
    // a real event through a real tree.
    await page.evaluate((d) => {
      const cell = document.querySelector(`[data-date="${d}"]`);
      if (cell) cell.click();
    }, todayStr);
    await sleep(300);
    await page.click("#transactionDescription");
    await page.type("#transactionDescription", "UI Harn");
    await sleep(200);
    const suggestionsOpen = await page.evaluate(() => {
      const list = document.getElementById("descriptionSuggestions");
      return { visible: !list.hidden, count: list.children.length };
    });
    // Guard against a vacuous pass: with no suggestions showing there is
    // nothing for Escape to own and the check would prove nothing.
    check("description suggestions open while typing", suggestionsOpen.visible && suggestionsOpen.count > 0,
      `${suggestionsOpen.count} suggestions`);
    await page.keyboard.press("Escape");
    await sleep(250);
    const afterEsc = await page.evaluate(() => ({
      listOpen: !document.getElementById("descriptionSuggestions").hidden,
      modalOpen: document.getElementById("transactionModal").style.display === "block",
      typed: document.getElementById("transactionDescription").value,
    }));
    check("Escape dismisses the suggestion list", !afterEsc.listOpen);
    check("Escape leaves the day modal (and the typed text) intact",
      afterEsc.modalOpen && afterEsc.typed === "UI Harn", `typed="${afterEsc.typed}"`);
    // A second Escape, with the list closed, must now close the modal.
    await page.keyboard.press("Escape");
    await sleep(250);
    check("a second Escape then closes the day modal", !(await isOpen("#transactionModal")));

    // ---- What is DISPLAYED must equal what the model computed ------------
    // The vm harnesses verify CalculationService; the layout checks above
    // verify geometry. Neither one reads the numbers actually printed in the
    // cells, so a formatting or wiring slip between the walk and the DOM — a
    // dropped sign, the wrong field, a stale render — is invisible to both.
    // Re-derive the month with the same walk generateCalendar uses and compare
    // it against the rendered text, in both views.
    const renderTruth = await page.evaluate(() => {
      const parseMoney = (txt) => {
        if (!txt) return null;
        const m = String(txt).replace(/[^0-9.\-]/g, "");
        return m === "" || m === "-" ? null : Number(m);
      };
      const readMode = (mode) => {
        if (window.app.calendarUI.viewMode !== mode) window.app.calendarUI.toggleViewMode();
        const rows = [];
        const sel = mode === "agenda" ? ".agenda-row[data-date]" : ".day[data-date]";
        document.querySelectorAll(sel).forEach((el) => {
          const bal = el.querySelector(".balance");
          const inc = el.querySelector(".income");
          const exp = el.querySelector(".expense");
          rows.push({
            date: el.getAttribute("data-date"),
            balance: bal ? parseMoney(bal.textContent) : null,
            income: inc ? parseMoney(inc.textContent) : null,
            expense: exp ? parseMoney(exp.textContent) : null,
          });
        });
        return rows;
      };
      const startMode = window.app.calendarUI.viewMode;
      const agenda = readMode("agenda");
      const grid = readMode("grid");
      if (window.app.calendarUI.viewMode !== startMode) window.app.calendarUI.toggleViewMode();

      const cs = window.app.calculationService;
      const cur = window.app.calendarUI.currentDate;
      const year = cur.getFullYear();
      const month = cur.getMonth();
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const seed = cs.getMonthSeed(year, month, { trackUnsettled: true });
      const todayStr = Utils.formatDateString(new Date());
      const truth = {};
      cs.walkDays(
        Utils.formatDateString(new Date(year, month, 1)),
        Utils.formatDateString(new Date(year, month, daysInMonth)),
        {
          seedBalance: seed.balance,
          seedUnsettled: seed.unsettledCarry,
          trackUnsettled: true,
          onDay: (r) => {
            const { cellExpense } = cs.getCellExpense(
              r.dailyTotals, r.unsettledCarry, r.dateString === todayStr
            );
            truth[r.dateString] = {
              balance: cs.roundToCents(r.balance),
              income: cs.roundToCents(r.dailyTotals.income),
              expense: cs.roundToCents(cellExpense),
            };
          },
        }
      );

      const compare = (rows, mode) => {
        const bad = [];
        rows.forEach((row) => {
          const t = truth[row.date];
          if (!t) { bad.push(`${mode} ${row.date}: rendered a day the walk never produced`); return; }
          if (row.balance !== null && Math.abs(row.balance - t.balance) > 0.005) {
            bad.push(`${mode} ${row.date}: balance ${row.balance} vs walk ${t.balance}`);
          }
          // Amounts print with a +/- prefix, so compare magnitude and sign apart.
          if (t.income > 0 && (row.income === null || Math.abs(Math.abs(row.income) - t.income) > 0.005)) {
            bad.push(`${mode} ${row.date}: income ${row.income} vs walk ${t.income}`);
          }
          if (t.expense > 0 && (row.expense === null || Math.abs(Math.abs(row.expense) - t.expense) > 0.005)) {
            bad.push(`${mode} ${row.date}: expense ${row.expense} vs walk ${t.expense}`);
          }
          if (t.expense > 0 && row.expense !== null && row.expense > 0) {
            bad.push(`${mode} ${row.date}: expense lost its minus sign (${row.expense})`);
          }
          if (t.income > 0 && row.income !== null && row.income < 0) {
            bad.push(`${mode} ${row.date}: income rendered negative (${row.income})`);
          }
        });
        return bad;
      };

      const withFigures = agenda.filter((r) => r.balance !== null).length;
      return {
        agendaBad: compare(agenda, "agenda"),
        gridBad: compare(grid, "grid"),
        agendaCount: agenda.length,
        gridCount: grid.length,
        truthCount: Object.keys(truth).length,
        withFigures,
      };
    });
    // Vacuity guard: a month that rendered no balances would pass trivially.
    check("the month rendered figures to compare", renderTruth.withFigures > 0,
      `${renderTruth.withFigures} days carry a balance`);
    check("agenda renders every day the walk produced",
      renderTruth.agendaCount === renderTruth.truthCount,
      `${renderTruth.agendaCount} rows / ${renderTruth.truthCount} days`);
    check("grid renders every day the walk produced",
      renderTruth.gridCount === renderTruth.truthCount,
      `${renderTruth.gridCount} cells / ${renderTruth.truthCount} days`);
    check("agenda figures equal the balance walk", renderTruth.agendaBad.length === 0,
      renderTruth.agendaBad.slice(0, 2).join(" | "));
    check("grid figures equal the balance walk", renderTruth.gridBad.length === 0,
      renderTruth.gridBad.slice(0, 2).join(" | "));

    // ---- Toggle checkboxes must look like checkboxes ---------------------
    // `#transactionForm input` is an ID-specificity rule, so it outranks
    // `.settled-toggle-label input[type="checkbox"]` on every property they
    // share — the Settled / Auto close-out / Suggest-amount / Free-funds
    // toggles rendered as >=140px-wide padded fields with their labels
    // stranded to the right. Measure the real layout.
    // The add form only has a layout while the day modal is open — addTransaction
    // closed it above, and measuring a hidden form would pass vacuously.
    await page.evaluate((d) => window.app.transactionUI.showTransactionDetails(d), todayStr);
    await sleep(300);
    await page.evaluate(() => {
      const type = document.getElementById("transactionType");
      type.value = "allocation";
      type.dispatchEvent(new Event("change"));
      const recurrence = document.getElementById("transactionRecurrence");
      recurrence.value = "monthly";
      recurrence.dispatchEvent(new Event("change"));
    });
    await sleep(450);
    const toggleSizes = await page.evaluate(() =>
      [
        "transactionSettled",
        "transactionAutoCloseout",
        "transactionAutoAdjust",
        "transactionFreeFunds",
        "lastDayOfMonthOption",
      ]
        .map((id) => {
          const el = document.getElementById(id);
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return { id, width: Math.round(rect.width) };
        })
        .filter((t) => t && t.width > 0)
    );
    const oversized = toggleSizes.filter((t) => t.width > 40);
    // Guard against a vacuous pass: if nothing was visible there was nothing to
    // measure, and the check proved nothing.
    check("toggle checkboxes render checkbox-sized",
      toggleSizes.length >= 4 && oversized.length === 0,
      oversized.length
        ? oversized.map((t) => `${t.id}=${t.width}px`).join(", ")
        : `${toggleSizes.length} measured`);
    // Put the form back before the flows below use it.
    await page.evaluate(() => {
      const recurrence = document.getElementById("transactionRecurrence");
      recurrence.value = "once";
      recurrence.dispatchEvent(new Event("change"));
      const type = document.getElementById("transactionType");
      type.value = "expense";
      type.dispatchEvent(new Event("change"));
    });
    await sleep(300);

    // ---- Stacked-dialog Escape / close ownership -------------------------
    // A confirmation opened from the day modal owns Escape and its own X. Both
    // used to tear the day modal down too (and reset the half-filled add form).
    await page.evaluate((d) => window.app.transactionUI.showTransactionDetails(d), todayStr);
    await sleep(300);
    const balanceWithExpense = await page.evaluate(
      () => document.getElementById("modalBalance").textContent
    );
    check("modal balance reflects the new expense", /25\.00/.test(balanceWithExpense));

    await page.evaluate(() =>
      document.querySelector("#modalTransactions .delete-btn").click()
    );
    await sleep(250);
    check("delete confirmation opens", await isOpen("#appModal"));
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Escape dismisses the confirmation", !(await isOpen("#appModal")));
    check(
      "Escape leaves the day modal open (stacked-Escape ownership)",
      await isOpen("#transactionModal")
    );

    await page.evaluate(() =>
      document.querySelector("#modalTransactions .delete-btn").click()
    );
    await sleep(250);
    await page.evaluate(() => document.getElementById("appModalClose").click());
    await sleep(250);
    check(
      "the dialog's X leaves the day modal open (.close scoping)",
      await isOpen("#transactionModal")
    );

    // ---- The app menu must not compete for Escape -------------------------
    // Its handler was the one document-level Escape listener left in the BUBBLE
    // phase, with no ownership guard — so a dialog opened over the menu and the
    // menu itself were both dismissed by a single Escape. Only a real dispatch
    // through a real tree shows this.
    await page.evaluate(() => {
      window.app.calendarUI.openAppMenu();
      Utils.showModalConfirm("Really?", "Confirm");
    });
    await sleep(300);
    const menuBefore = await page.evaluate(() => ({
      menu: document.getElementById("calendarOptions").classList.contains("is-open"),
      dialog: document.getElementById("appModal").style.display === "block",
    }));
    check("menu and a dialog can be open together", menuBefore.menu && menuBefore.dialog);
    await page.keyboard.press("Escape");
    await sleep(300);
    const menuAfter = await page.evaluate(() => ({
      menu: document.getElementById("calendarOptions").classList.contains("is-open"),
      dialog: document.getElementById("appModal").style.display === "block",
    }));
    check("Escape closes the dialog, not the menu underneath it",
      !menuAfter.dialog && menuAfter.menu,
      `menu=${menuAfter.menu} dialog=${menuAfter.dialog}`);
    await page.evaluate(() => window.app.calendarUI.closeAppMenu());
    await sleep(150);

    // ---- Day-modal figures refresh immediately after a mutation ----------
    // The modal re-renders BEFORE the calendar does, so it has to refresh the
    // derived balance data itself or it shows pre-mutation figures.
    await page.evaluate(() =>
      document.querySelector("#modalTransactions .delete-btn").click()
    );
    await sleep(250);
    await page.evaluate(() => document.getElementById("appModalConfirm").click());
    await sleep(500);
    const balanceAfterDelete = await page.evaluate(
      () => document.getElementById("modalBalance").textContent
    );
    check(
      "day-modal figures refresh right after a delete",
      !/25\.00/.test(balanceAfterDelete),
      balanceAfterDelete.replace(/\s+/g, " ").slice(0, 60)
    );

    await page.keyboard.press("Escape");
    await sleep(250);
    check(
      "Escape closes the day modal when it IS topmost",
      !(await isOpen("#transactionModal"))
    );

    // ---- The Notes modal's own close button ------------------------------
    // Its inline onclick used to be overwritten by a document-wide .close sweep.
    await page.evaluate(() => window.app.calendarUI.showNotesModal());
    await sleep(250);
    check("notes modal opens", await isOpen("#notesModal"));
    await page.evaluate(() =>
      document.querySelector("#notesModal .close").click()
    );
    await sleep(250);
    check("notes modal X closes it", !(await isOpen("#notesModal")));

    // ---- Debt panel: a confirmation must not close the whole panel --------
    await page.evaluate(() => window.app.debtSnowball.showView());
    await sleep(350);
    const panelIsOpen = () =>
      page.evaluate(
        () => document.getElementById("debtSnowballView").style.display === "block"
      );
    check("debt snowball panel opens", await panelIsOpen());

    // A full-screen .app-view is opaque and owns the screen, but the mobile
    // FABs are position:fixed with their own stacking context. At a lower
    // z-index the panel let them float on top of its controls and swallow the
    // taps meant for them. Hit-test rather than trust the numbers — at a MOBILE
    // width, because the FABs are display:none above 767px, and with any
    // transient toast cleared first: an undo toast (z-index 10001) parks over
    // the same corner and would answer the hit test instead of the FAB.
    const desktopViewport = page.viewport();
    await page.setViewport({ width: 375, height: 812 });
    await page.evaluate(() =>
      document
        .querySelectorAll(".undo-toast, .success-toast, .error-toast")
        .forEach((t) => t.remove())
    );
    await sleep(400);
    const fabHitTest = await page.evaluate(() => {
      const panel = document.getElementById("debtSnowballView");
      return ["mobileAddBtn", "todayJumpBtn"].map((id) => {
        const el = document.getElementById(id);
        const box = el.getBoundingClientRect();
        if (box.width === 0) return { id, shown: false };
        const top = document.elementFromPoint(
          box.left + box.width / 2,
          box.top + box.height / 2
        );
        return {
          id,
          shown: true,
          // The panel must own that point — not the FAB, and not something else
          // that happens to be floating there.
          panelOnTop: !!top && panel.contains(top),
          topElement: top ? top.id || String(top.className) || top.tagName : "none",
        };
      });
    });
    const shownFabs = fabHitTest.filter((f) => f.shown);
    const notCovered = shownFabs.filter((f) => !f.panelOnTop);
    check("the open panel owns the screen where the FABs sit",
      shownFabs.length > 0 && notCovered.length === 0,
      shownFabs.length === 0
        ? "no FAB was visible — nothing was actually measured"
        : notCovered.length
          ? notCovered.map((f) => `${f.id} -> ${f.topElement}`).join(", ")
          : `${shownFabs.length} hit-tested`);
    if (desktopViewport) await page.setViewport(desktopViewport);
    await sleep(300);

    await page.evaluate(() => {
      window.app.store.addDebt({
        name: "UI Harness Debt",
        balance: 100,
        minPayment: 10,
        recurrence: "monthly",
        dueStartDate: Utils.formatDateString(new Date()),
      });
      window.app.debtSnowball.refresh();
    });
    await sleep(350);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll("#debtList button")].find(
        (b) => b.dataset.action === "delete"
      );
      if (btn) btn.click();
    });
    await sleep(300);
    check("delete-debt confirmation opens", await isOpen("#appModal"));
    await page.keyboard.press("Escape");
    await sleep(300);
    check("Escape leaves the debt panel open", await panelIsOpen());

    // ---- Search round trip ------------------------------------------------
    await page.evaluate(() => {
      window.app.debtSnowball.hideView();
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 12.34,
        type: "expense",
        description: "Findable Row",
      });
      window.app.updateUI();
      window.app.searchUI.showSearchModal("Findable");
    });
    await sleep(400);
    check(
      "search finds a transaction it should",
      await page.evaluate(
        () =>
          document.getElementById("searchResults").textContent.includes("Findable Row")
      )
    );
    await page.evaluate(() => window.app.searchUI.hideSearchModal());

    // ---- Settling a carried-forward payment keeps its debt link ----------
    // A debt minimum can sit in the carried-forward list because the user marked
    // it unsettled while waiting for it to clear. The Settle button rebuilds the
    // row on the day it actually cleared — and it rebuilt it WITHOUT
    // debtId/debtRole/debtName. The money still left the balance walk, but the
    // debt stopped being credited for it: its remaining read a whole payment too
    // high and the snowball planned around a debt further behind than it really
    // was. BankReconcile._relocateEntry preserves those fields for exactly this
    // reason; this path did not. Driven through the real button because the
    // carried-forward section only exists in the rendered day modal.
    const debtSettle = await page.evaluate(async () => {
      const store = window.app.store;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, "0");
      const ds = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      const today = ds(now);
      const past = ds(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 3));
      const stamp = new Date().toISOString();

      const debtId = store.addDebt({
        name: "UI Harness Card", balance: 1000, minPayment: 60, dueDay: 5,
        recurrence: "monthly",
        dueStartDate: ds(new Date(now.getFullYear(), now.getMonth() - 1, 5)),
        interestRate: 0,
      });
      const recurringId = window.app.recurringManager.addRecurringTransaction({
        amount: 60, type: "expense", description: "Debt Payment: UI Harness Card",
        recurrence: "monthly",
        startDate: ds(new Date(now.getFullYear(), now.getMonth() - 1, 5)),
        debtId, debtRole: "minimum", debtName: "UI Harness Card",
      });
      store.updateDebt(debtId, { minRecurringId: recurringId });
      // A past, UNSETTLED minimum payment: exactly what lands in the carried list.
      const map = store.getTransactions();
      (map[past] = map[past] || []).push({
        id: "ui-min", amount: 60, type: "expense",
        description: "Debt Payment: UI Harness Card",
        debtId, debtRole: "minimum", recurringId, modifiedInstance: true,
        settled: false, _lastModified: stamp,
      });
      window.app.updateUI();
      await new Promise((r) => setTimeout(r, 300));

      const paidThrough = () =>
        window.app.debtSnowball.getHistoricalDebtSnapshot(
          new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
        ).paidByDebtId[debtId] || 0;
      const before = paidThrough();

      window.app.transactionUI.showTransactionDetails(today);
      await new Promise((r) => setTimeout(r, 300));
      const carried = [...document.querySelectorAll(".carried-forward-transaction")]
        .find((row) => row.textContent.includes("UI Harness Card"));
      const button = carried && carried.querySelector(".settle-btn");
      if (button) button.click();
      await new Promise((r) => setTimeout(r, 500));

      const settledRow = (store.getTransactions()[today] || []).find(
        (t) => t.description === "Debt Payment: UI Harness Card" && t.settled === true
      );
      const after = paidThrough();
      return {
        debtId, recurringId, today, past,
        foundCarriedRow: !!carried,
        clicked: !!button,
        settledRowHasDebtId: !!(settledRow && settledRow.debtId === debtId),
        before, after,
      };
    });
    check("the unsettled debt payment appears in the carried-forward list",
      debtSettle.foundCarriedRow && debtSettle.clicked);
    // Vacuity guard: if it was never counted, "unchanged" would prove nothing.
    check("the debt was credited for it before settling",
      debtSettle.before > 0, `paid ${debtSettle.before}`);
    check("the settled copy keeps its debt link", debtSettle.settledRowHasDebtId);
    check("settling it does not un-credit the debt",
      Math.abs(debtSettle.after - debtSettle.before) < 0.005,
      `paid ${debtSettle.before} -> ${debtSettle.after}`);
    await page.evaluate((info) => {
      window.app.transactionUI.closeModals();
      const store = window.app.store;
      store.deleteRecurringTransaction(info.recurringId);
      store.deleteDebt(info.debtId);
      [info.today, info.past].forEach((date) => {
        const map = store.getTransactions();
        if (!map[date]) return;
        map[date] = map[date].filter((t) => t.debtId !== info.debtId);
        if (map[date].length === 0) delete map[date];
      });
      window.app.recurringManager.invalidateCache();
      store.flushPendingSave();
      window.app.updateUI();
    }, debtSettle);
    await sleep(300);

    // ---- Corrupt field shapes must not disable the UI ---------------------
    // Nothing coerces `description` (or a monthly note's `text`) on the way in
    // from an import or a cloud merge, which is why every read surface in the
    // app guards with `typeof === "string"`. Two did not:
    //   - populateDescriptionSuggestions did `(t.description || "").trim()`. It
    //     scans the WHOLE map and runs at the top of showTransactionDetails, so
    //     one numeric description anywhere dropped EVERY day modal into the
    //     read-only fallback — no Edit/Delete/Settle/Skip, on any day.
    //   - hasMonthlyNotes did `(note.text || "").trim()`, and generateCalendar
    //     calls it on every render for the ★ indicator, so a numeric note text
    //     threw the render itself.
    // Both are invisible to the vm harnesses (neither class is loaded there),
    // and both fail as "the app just stopped working", not as an error message.
    const corrupt = await page.evaluate(async () => {
      const store = window.app.store;
      const today = Utils.formatDateString(new Date());
      const monthKey = today.slice(0, 7);
      // Bypass the setters on purpose: this is the shape a merge leaves behind.
      const map = store.getTransactions();
      (map[today] = map[today] || []).push({
        id: "corrupt-desc", amount: 9.99, type: "expense",
        description: 42, settled: true,
        _lastModified: new Date().toISOString(),
      });
      store.monthlyNotes[monthKey] = { text: 7, _lastModified: new Date().toISOString() };

      let renderError = null;
      try { window.app.updateUI(); } catch (e) { renderError = e.message; }
      await new Promise((r) => setTimeout(r, 250));

      const rendered =
        document.getElementById("calendarAgenda").children.length > 0 ||
        document.getElementById("calendarDays").children.length > 0;

      const cell = document.querySelector(`[data-date="${today}"]`);
      if (cell) cell.click();
      await new Promise((r) => setTimeout(r, 300));

      const modal = document.getElementById("transactionModal");
      const rows = document.getElementById("modalTransactions");
      return {
        renderError,
        rendered,
        summaryText: document.getElementById("monthSummary").textContent,
        modalOpen: modal.style.display === "block",
        // The fallback modal renders plain rows with no action controls; the
        // real one always has them for an editable one-time transaction.
        hasEditControls: rows.querySelectorAll(".edit-btn").length > 0,
        hasDeleteControls: rows.querySelectorAll(".delete-btn").length > 0,
        monthKey,
        today,
      };
    });
    check("a corrupt description doesn't throw the calendar render",
      corrupt.renderError === null, String(corrupt.renderError));
    check("the calendar still renders with corrupt field shapes", corrupt.rendered);
    check("the monthly summary still renders (hasMonthlyNotes survives)",
      corrupt.summaryText.includes("Monthly Summary"), corrupt.summaryText.slice(0, 60));
    check("the day modal still opens", corrupt.modalOpen);
    check("the day modal is the real one, not the read-only fallback",
      corrupt.hasEditControls && corrupt.hasDeleteControls,
      `edit=${corrupt.hasEditControls} delete=${corrupt.hasDeleteControls}`);

    // Recent Transactions sorts on `_lastModified`. An unreadable one parses to
    // an Invalid Date, whose getTime() is NaN — and a comparator that returns
    // NaN is not a valid comparator: the list comes back in an arbitrary order,
    // so the "recent" 25 are not the recent ones.
    const recent = await page.evaluate(async () => {
      const store = window.app.store;
      const today = Utils.formatDateString(new Date());
      const map = store.getTransactions();
      const list = (map[today] = map[today] || []);
      list.push(
        { id: "stamp-bad-a", amount: 1.11, type: "expense", description: "Corrupt Stamp A",
          settled: true, _lastModified: "not-a-timestamp" },
        { id: "stamp-bad-b", amount: 2.22, type: "expense", description: "Corrupt Stamp B",
          settled: true, _lastModified: 42 },
        { id: "stamp-old", amount: 3.33, type: "expense", description: "Older Real Stamp",
          settled: true, _lastModified: "2020-01-01T00:00:00.000Z" },
        { id: "stamp-new", amount: 4.44, type: "expense", description: "Newer Real Stamp",
          settled: true, _lastModified: new Date().toISOString() }
      );
      window.app.showRecentTransactions();
      await new Promise((r) => setTimeout(r, 300));
      const rows = [...document.querySelectorAll("#recentTransactionsList .recent-transaction-row")]
        .map((row) => row.textContent);
      const indexOf = (name) => rows.findIndex((t) => t.includes(name));
      return {
        rendered: rows.length > 0,
        newer: indexOf("Newer Real Stamp"),
        older: indexOf("Older Real Stamp"),
        corruptA: indexOf("Corrupt Stamp A"),
        corruptB: indexOf("Corrupt Stamp B"),
        today,
      };
    });
    check("Recent Transactions renders with corrupt timestamps", recent.rendered);
    check("all four seeded rows are listed",
      recent.newer >= 0 && recent.older >= 0 && recent.corruptA >= 0 && recent.corruptB >= 0,
      `newer=${recent.newer} older=${recent.older} A=${recent.corruptA} B=${recent.corruptB}`);
    check("the newest real stamp still sorts above the older one",
      recent.newer < recent.older, `newer at ${recent.newer}, older at ${recent.older}`);
    check("unreadable stamps sort below every real one",
      recent.corruptA > recent.older && recent.corruptB > recent.older,
      `older=${recent.older} A=${recent.corruptA} B=${recent.corruptB}`);
    await page.evaluate((info) => {
      window.app.hideRecentTransactions();
      const map = window.app.store.getTransactions();
      if (map[info.today]) {
        map[info.today] = map[info.today].filter((t) => !String(t.id).startsWith("stamp-"));
        if (map[info.today].length === 0) delete map[info.today];
      }
      window.app.store.flushPendingSave();
      window.app.updateUI();
    }, recent);
    await sleep(250);
    await page.evaluate((info) => {
      window.app.transactionUI.closeModals();
      const map = window.app.store.getTransactions();
      if (map[info.today]) {
        map[info.today] = map[info.today].filter((t) => t.id !== "corrupt-desc");
        if (map[info.today].length === 0) delete map[info.today];
      }
      delete window.app.store.monthlyNotes[info.monthKey];
      window.app.store.flushPendingSave();
      window.app.updateUI();
    }, corrupt);
    await sleep(300);

    // ---- Allocations, free funds, what-if, savings goals -------------------
    // Four feature surfaces the vm harnesses can drive only as data. Here they
    // go through the real DOM: the modals that build their own markup, the
    // draw dropdown that is populated from live buckets, and the calendar
    // substitution free-funds mode performs. Each is asserted on what the page
    // actually shows, not on what the store holds.
    const allocSetup = await page.evaluate(() => {
      const store = window.app.store;
      const today = Utils.formatDateString(new Date());
      const id = store.addTransaction(today, {
        amount: 200, type: "expense", description: "UI Grocery Bucket",
        allocated: true, settled: true,
      });
      store.addTransaction(today, {
        amount: 60, type: "expense", description: "UI Groceries",
        settled: true, drawsFromAllocationId: id,
      });
      window.app.updateUI();
      const bucket = store.getAllocations().find((a) => a.id === id);
      return { id, remaining: bucket ? bucket.remaining : null };
    });
    check("a draw debits its bucket by exactly the spend",
      allocSetup.remaining === 140, `bucket at ${allocSetup.remaining}`);

    // Splitting one expense across two buckets, driven through the real form.
    // The vm harness can assert what the store does with a split but not what
    // the editor does: the rows are built and rebuilt in the DOM, the second
    // row's options are filtered against the first row's choice, and the
    // defaults are read live off the amount field. All three are only true in a
    // browser.
    const split = await page.evaluate(async (groceryId) => {
      const store = window.app.store;
      const ui = window.app.transactionUI;
      const today = Utils.formatDateString(new Date());
      const householdId = store.addTransaction(today, {
        amount: 100, type: "expense", description: "UI Household Bucket",
        allocated: true, settled: true,
      });
      window.app.updateUI();
      ui.showTransactionDetails(today);
      await new Promise((r) => setTimeout(r, 300));

      const editor = document.getElementById("transactionDrawAllocations");
      const rows = () => [...editor.querySelectorAll("[data-draw-row]")];
      const bucketSelect = (i) => rows()[i].querySelector("[data-draw-bucket]");
      const amountInput = (i) => rows()[i].querySelector("[data-draw-amount]");
      const pick = (select, label) => {
        const option = [...select.options].find((o) => o.textContent.includes(label));
        if (!option) return false;
        select.value = option.value;
        select.dispatchEvent(new Event("change"));
        return true;
      };

      document.getElementById("transactionDate").value = today;
      document.getElementById("transactionAmount").value = "90";
      document.getElementById("transactionDescription").value = "UI Split Spend";
      const typeEl = document.getElementById("transactionType");
      typeEl.value = "expense";
      typeEl.dispatchEvent(new Event("change"));
      await new Promise((r) => setTimeout(r, 150));
      const shown = editor.style.display !== "none" && rows().length === 1;

      pick(bucketSelect(0), "UI Grocery Bucket");
      await new Promise((r) => setTimeout(r, 100));
      // A lone bucket defaults to the whole expense.
      const firstDefault = amountInput(0).value;

      const first = amountInput(0);
      first.value = "50";
      first.dispatchEvent(new Event("input"));
      editor.querySelector(".draw-allocation-add").click();
      await new Promise((r) => setTimeout(r, 100));
      const secondRowAppeared = rows().length === 2;
      const duplicateOffered = [...bucketSelect(1).options].some(
        (o) => o.value && o.value === bucketSelect(0).value
      );
      pick(bucketSelect(1), "UI Household Bucket");
      await new Promise((r) => setTimeout(r, 100));
      // The second row defaults to what the first one left uncovered, and the
      // first row's typed figure survives the re-render.
      const secondDefault = amountInput(1).value;
      const firstKept = amountInput(0).value;

      // An over-committed split must be refused outright.
      const over = amountInput(1);
      over.value = "80";
      over.dispatchEvent(new Event("input"));
      const refused = ui.addTransaction() === false;
      const savedAnyway = (store.getTransactions()[today] || []).some(
        (t) => t.description === "UI Split Spend"
      );

      over.value = "40";
      over.dispatchEvent(new Event("input"));
      ui.addTransaction();
      await new Promise((r) => setTimeout(r, 400));

      const spend = (store.getTransactions()[today] || []).find(
        (t) => t.description === "UI Split Spend"
      );
      const draws = spend ? store.getAllocationDraws(spend) : [];
      const remainingOf = (id) => {
        const found = store.findTransactionById(id);
        return found ? found.transaction.amount : null;
      };
      ui.showTransactionDetails(today);
      await new Promise((r) => setTimeout(r, 300));
      const label = [...document.querySelectorAll(".draw-from-allocation")]
        .map((el) => el.textContent)
        .find((text) => text.includes("UI Household Bucket")) || "";
      return {
        householdId, shown, firstDefault, secondRowAppeared, duplicateOffered,
        secondDefault, firstKept, refused, savedAnyway,
        drawn: draws.map((d) => d.drawn),
        grocery: remainingOf(groceryId),
        household: remainingOf(householdId),
        label,
      };
    }, allocSetup.id);
    check("the draw editor renders one row for a one-time expense", split.shown);
    check("a lone bucket defaults to the whole expense",
      Number(split.firstDefault) === 90, `defaulted to ${split.firstDefault}`);
    check("a second draw row can be added", split.secondRowAppeared);
    check("a bucket already claimed is not offered on the next row",
      !split.duplicateOffered);
    check("the next row defaults to what is still uncovered",
      Number(split.secondDefault) === 40, `defaulted to ${split.secondDefault}`);
    check("a typed row survives the re-render",
      Number(split.firstKept) === 50, `row 1 shows ${split.firstKept}`);
    check("a split over the expense total is refused, and saves nothing",
      split.refused && !split.savedAnyway);
    check("the saved split debits each bucket by its own row",
      split.drawn.join(",") === "50,40" && split.grocery === 90 && split.household === 60,
      `drawn ${split.drawn.join("/")}, buckets ${split.grocery}/${split.household}`);
    check("the day modal names every bucket the expense drew from",
      split.label.includes("UI Grocery Bucket") && split.label.includes("UI Household Bucket"),
      split.label);
    await page.evaluate(() => window.app.transactionUI.closeModals());
    await sleep(200);

    await page.evaluate(() => window.app.showAllocatedTransactions());
    await sleep(350);
    const allocModal = await page.evaluate(() => {
      const modal = document.getElementById("allocatedTransactionsModal");
      const list = document.getElementById("allocatedTransactionsList");
      return {
        open: modal.style.display === "block",
        text: list.textContent,
        // The purple, unsigned reserve styling is the documented convention.
        unsigned: [...list.querySelectorAll(".recent-transaction-amount")]
          .every((el) => !el.textContent.trim().startsWith("-")),
        overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    check("the Allocated modal lists the live bucket",
      allocModal.open && allocModal.text.includes("UI Grocery Bucket"));
    check("allocation amounts render unsigned", allocModal.unsigned);
    check("the Allocated modal doesn't scroll the page sideways", allocModal.overflow);
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Escape closes the Allocated modal",
      await page.evaluate(() =>
        document.getElementById("allocatedTransactionsModal").style.display !== "block"));

    // Free funds: the calendar replaces the current day's running balance with
    // the designated bucket's remaining amount, and hides past-day balances.
    const freeFunds = await page.evaluate(async () => {
      const store = window.app.store;
      const today = Utils.formatDateString(new Date());
      const id = window.app.recurringManager.addRecurringTransaction({
        amount: 300, type: "expense", description: "UI Free Funds",
        recurrence: "weekly",
        startDate: Utils.formatDateString(new Date(Date.now() - 3 * 86400000)),
        allocated: true, settled: true,
      });
      store.setFreeFundsAllocation(id);
      window.app.updateUI();
      await new Promise((r) => setTimeout(r, 200));
      const row = document.querySelector(`[data-date="${today}"]`);
      return {
        id,
        holder: store.getFreeFundsRecurringId(),
        shown: row ? !!row.querySelector(".balance.free-funds") : false,
        text: row ? row.textContent : "",
      };
    });
    check("designating a free-funds bucket takes effect",
      freeFunds.holder === freeFunds.id);
    check("the current day shows the free-funds figure instead of a balance",
      freeFunds.shown, freeFunds.text.slice(0, 80));
    await page.evaluate((id) => {
      window.app.store.setFreeFundsAllocation(null);
      window.app.store.deleteRecurringTransaction(id);
      window.app.recurringManager.invalidateCache();
      window.app.updateUI();
    }, freeFunds.id);
    await sleep(250);

    // What-if: a draft must move the banner's minimum and must never reach
    // localStorage, and Discard must put everything back.
    await page.evaluate(() => window.app.whatIf.openForm());
    await sleep(250);
    await page.evaluate(() => {
      document.getElementById("whatIfDate").value =
        Utils.formatDateString(new Date(Date.now() + 3 * 86400000));
      document.getElementById("whatIfAmount").value = "5000";
      document.getElementById("whatIfType").value = "expense";
      document.getElementById("whatIfDescription").value = "UI Draft";
      document.getElementById("whatIfAddButton").click();
    });
    await sleep(450);
    const draft = await page.evaluate(() => {
      const banner = document.getElementById("whatIfBanner");
      return {
        bannerShown: !banner.hidden,
        bannerText: banner.textContent.replace(/\s+/g, " ").trim().slice(0, 120),
        inStore: window.app.store.getWhatIfTransactions().length,
        persisted: String(localStorage.getItem("transactions")).includes("UI Draft"),
        inExport: JSON.stringify(window.app.store.exportData()).includes("UI Draft"),
      };
    });
    check("a what-if draft raises the banner", draft.bannerShown && draft.inStore === 1,
      draft.bannerText);
    check("a what-if draft never reaches localStorage", !draft.persisted);
    check("a what-if draft never reaches an export", !draft.inExport);
    await page.evaluate(() => window.app.whatIf.discardAll());
    await sleep(350);
    check("discarding removes the draft and the banner",
      await page.evaluate(() =>
        window.app.store.getWhatIfTransactions().length === 0 &&
        document.getElementById("whatIfBanner").hidden === true));

    // Savings goals: the modal builds its rows at runtime, including the
    // feasibility line that reuses the balance walk.
    await page.evaluate(() => {
      window.app.store.addSavingsGoal({
        name: "UI Trip Fund", targetAmount: 500, saved: 100,
        targetDate: Utils.formatDateString(new Date(Date.now() + 90 * 86400000)),
      });
      window.app.savingsGoals.show();
    });
    await sleep(400);
    const goals = await page.evaluate(() => {
      const list = document.getElementById("savingsGoalsList");
      return {
        open: document.getElementById("savingsGoalsModal").style.display === "block",
        text: list.textContent.replace(/\s+/g, " ").trim(),
        rows: list.querySelectorAll(".savings-goal-row").length,
        bars: list.querySelectorAll(".savings-goal-bar-fill").length,
        overflow: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    check("the Savings Goals modal renders the goal",
      goals.open && goals.rows === 1 && goals.text.includes("UI Trip Fund"));
    check("the goal shows a progress bar and a status line",
      goals.bars === 1 && /to go|On track|Tight|funded/.test(goals.text),
      goals.text.slice(0, 120));
    check("the Savings Goals modal doesn't scroll the page sideways", goals.overflow);
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Escape closes the Savings Goals modal",
      await page.evaluate(() =>
        document.getElementById("savingsGoalsModal").style.display !== "block"));

    // Clean up everything this phase added so the PIN phase below sees a
    // dataset it recognises.
    await page.evaluate(() => {
      const store = window.app.store;
      store.getSavingsGoals().slice().forEach((g) => store.deleteSavingsGoal(g.id));
      const transactions = store.getTransactions();
      Object.keys(transactions).forEach((date) => {
        for (let i = transactions[date].length - 1; i >= 0; i--) {
          if (/^UI (Grocery Bucket|Groceries)$/.test(transactions[date][i].description || "")) {
            store.deleteTransaction(date, i);
          }
        }
      });
      store.flushPendingSave();
      window.app.updateUI();
    });
    await sleep(300);

    // ---- PIN lifecycle ----------------------------------------------------
    // Set -> reload -> unlock -> change -> reload -> unlock -> disable, checking
    // at every step that the stored blob is encrypted when it should be, that
    // nothing is rendered before unlock, and that the data survives each
    // re-key. The re-key is the dangerous one: it rewrites every stored value
    // under a new key, and committing the new hash before that write lands
    // leaves data nothing can decrypt.
    await page.evaluate(() => {
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 123.45, type: "expense", description: "Secret Coffee",
      });
      window.app.store.flushPendingSave();
      window.app.updateUI();
    });
    check(
      "stored data is plaintext before a PIN is set",
      await page.evaluate(() => !String(localStorage.getItem("transactions")).startsWith("xor2:"))
    );

    const setPin = page.evaluate(() => window.pinProtection.promptChangePin(window.app.store));
    await answerPrompt(page, "4321");
    await answerPrompt(page, "4321");
    await dismissAlert(page);
    await setPin;
    await sleep(350);
    check(
      "setting a PIN encrypts the stored data",
      await page.evaluate(() => String(localStorage.getItem("transactions")).startsWith("xor2:"))
    );

    // ---- A dialog raised BY the lock must sit ABOVE the lock overlay -----
    // showLockOverlay pins the overlay at z-index 9999 so nothing left over
    // from the session is reachable behind it. But the lock flow itself talks
    // to the user through Utils.showModalDialog, which stacks from ModalManager's
    // ordinary 1000 base — so "Incorrect PIN" landed at 1010, UNDER the overlay:
    // invisible, unclickable, with promptUnlock awaiting an answer that could
    // never come. One wrong PIN after an idle lock wedged the app until a
    // reload. Hit-testing is the assertion that matters; comparing z-index
    // numbers alone would not prove the dialog is actually reachable.
    // The app menu is not a .modal, so closeAllModals' sweep never reached it:
    // it stayed open behind the lock overlay and its Escape handler pulled
    // focus off the PIN field onto the menu button underneath, sending the
    // user's next keystrokes nowhere.
    await page.evaluate(() => window.app.calendarUI.openAppMenu());
    await sleep(150);
    check("menu is open going into the lock",
      await page.evaluate(() => document.getElementById("calendarOptions").classList.contains("is-open")));
    await page.evaluate(() => window.pinProtection.lockApp());
    await sleep(400);
    check("the inactivity lock shows the unlock dialog", await isOpen("#appModal"));
    check("locking closes the app menu",
      await page.evaluate(() => !document.getElementById("calendarOptions").classList.contains("is-open")));
    await page.evaluate(() => document.getElementById("appModalInput").focus());
    await page.keyboard.press("Escape");
    await sleep(250);
    check("Escape at the lock screen leaves focus in the PIN field",
      await page.evaluate(() => document.activeElement && document.activeElement.id === "appModalInput"),
      await page.evaluate(() => (document.activeElement && document.activeElement.id) || "(none)"));
    await page.evaluate(() => {
      document.getElementById("appModalInput").value = "0000";
      document.getElementById("appModalConfirm").click();
    });
    await sleep(500);
    const buried = await page.evaluate(() => {
      const modal = document.getElementById("appModal");
      const overlay = document.getElementById("lockOverlay");
      const content = modal.querySelector(".modal-content");
      const box = content.getBoundingClientRect();
      // Sample a few points across the dialog body rather than one, so a single
      // unlucky coordinate can't decide the result.
      const points = [0.25, 0.5, 0.75].map((f) => ({
        x: Math.round(box.left + box.width * 0.5),
        y: Math.round(box.top + box.height * f),
      }));
      const hits = points.map((p) => {
        const el = document.elementFromPoint(p.x, p.y);
        return el ? (modal.contains(el) ? "dialog" : el.id || el.className) : "none";
      });
      return {
        title: document.getElementById("appModalTitle").textContent,
        overlayShown: overlay && overlay.style.display === "block",
        boxHeight: Math.round(box.height),
        hits,
        reachable: hits.every((h) => h === "dialog"),
      };
    });
    check("a wrong PIN raises the 'Incorrect PIN' dialog", buried.title === "Unlock Failed",
      buried.title);
    check("the lock overlay is still up", buried.overlayShown);
    // Vacuity guard: a zero-height dialog would hit-test to nothing meaningful.
    check("the dialog was actually measured", buried.boxHeight > 0, `${buried.boxHeight}px tall`);
    check("the dialog is reachable above the lock overlay", buried.reachable,
      buried.hits.join(", "));
    await dismissAlert(page);

    // ---- A dialog raised while the unlock prompt is up must not answer it ---
    // showUnlockDialog drives the SHARED #appModal directly rather than through
    // Utils.showModalDialog. Anything that raises an ordinary dialog while the
    // lock is up — a cloud push still in flight when the inactivity lock fired,
    // coming back 404 — reconfigures the same element and stacks its own
    // listeners on the same buttons, while the unlock dialog's stayed attached.
    // One click on THAT dialog then also fired the unlock's confirm handler and
    // resolved the unlock with the (now empty) shared input, so the user got a
    // spurious "Incorrect PIN" on top of the dialog they were actually
    // answering. Only a real click through the shared DOM shows this.
    const preempt = await page.evaluate(async () => {
      const seen = [];
      const answered = Utils.showModalConfirm(
        "Gist not found. Would you like to create a new one?",
        "Gist Not Found",
        { confirmText: "Create New", cancelText: "Cancel" }
      );
      await new Promise((r) => setTimeout(r, 250));
      seen.push(document.getElementById("appModalTitle").textContent);
      document.getElementById("appModalCancel").click();
      const result = await answered;
      await new Promise((r) => setTimeout(r, 900));
      return {
        titleWhileOpen: seen[0],
        confirmResult: result,
        titleAfter: document.getElementById("appModalTitle").textContent,
        modalOpen: document.getElementById("appModal").style.display === "block",
        stillLocked: window.pinProtection.isLocked === true,
      };
    });
    check("a dialog raised over the lock takes the shared modal",
      preempt.titleWhileOpen === "Gist Not Found", preempt.titleWhileOpen);
    check("answering it returns its own answer, not the unlock's",
      preempt.confirmResult === false, String(preempt.confirmResult));
    check("the unlock prompt comes back once that dialog is done",
      preempt.titleAfter === "Unlock" && preempt.modalOpen,
      `${preempt.titleAfter} / open=${preempt.modalOpen}`);
    check("the app is still locked after the interruption", preempt.stillLocked);
    // No stray "Incorrect PIN" was raised by the interruption: the dialog on
    // screen is the unlock prompt itself, which the assertions above pin.

    await page.evaluate(() => {
      document.getElementById("appModalInput").value = "4321";
      document.getElementById("appModalConfirm").click();
    });
    await sleep(700);
    check("the correct PIN then clears the lock",
      await page.evaluate(() => {
        const overlay = document.getElementById("lockOverlay");
        return (
          window.pinProtection.isLocked === false &&
          (!overlay || overlay.style.display === "none")
        );
      })
    );

    await page.reload({ waitUntil: "networkidle0" });
    await sleep(700);
    check("unlock dialog is shown on a locked reload", await isOpen("#appModal"));
    check(
      "nothing is rendered and no store is built before unlock",
      await page.evaluate(
        () =>
          typeof window.app === "undefined" &&
          !/123\.45|Secret Coffee/.test(document.body.innerText) &&
          document.getElementById("calendarAgenda").children.length === 0 &&
          document.getElementById("calendarDays").children.length === 0
      )
    );
    await page.evaluate(() => {
      document.getElementById("appModalInput").value = "4321";
      document.getElementById("appModalConfirm").click();
    });
    await sleep(1000);
    check(
      "the correct PIN unlocks and decrypts the data",
      await page.evaluate(
        () =>
          !!window.app &&
          Object.values(window.app.store.getTransactions())
            .flat()
            .some((t) => t.description === "Secret Coffee")
      )
    );

    const changePin = page.evaluate(() => window.pinProtection.promptChangePin(window.app.store));
    await answerPrompt(page, "4321");
    await answerPrompt(page, "9876");
    await answerPrompt(page, "9876");
    await dismissAlert(page);
    await changePin;
    await sleep(350);
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(700);
    await page.evaluate(() => {
      document.getElementById("appModalInput").value = "4321";
      document.getElementById("appModalConfirm").click();
    });
    await sleep(600);
    check(
      "the old PIN no longer unlocks",
      await page.evaluate(() => typeof window.app === "undefined")
    );
    await dismissAlert(page);
    await page.evaluate(() => {
      document.getElementById("appModalInput").value = "9876";
      document.getElementById("appModalConfirm").click();
    });
    await sleep(1000);
    check(
      "the new PIN unlocks and the data survived the re-key",
      await page.evaluate(
        () =>
          !!window.app &&
          Object.values(window.app.store.getTransactions())
            .flat()
            .some((t) => t.description === "Secret Coffee")
      )
    );

    const disablePin = page.evaluate(() => window.pinProtection.promptChangePin(window.app.store));
    await answerPrompt(page, "9876");
    await answerPrompt(page, "");
    await dismissAlert(page);
    await disablePin;
    await sleep(450);
    check(
      "disabling the PIN rewrites the data in the clear and drops the hash",
      await page.evaluate(
        () =>
          !String(localStorage.getItem("transactions")).startsWith("xor2:") &&
          localStorage.getItem("pin_hash") === null
      )
    );
    await page.reload({ waitUntil: "networkidle0" });
    await sleep(800);
    check(
      "no lock screen, and the data survived being decrypted",
      await page.evaluate(
        () =>
          !!window.app &&
          Object.values(window.app.store.getTransactions())
            .flat()
            .some((t) => t.description === "Secret Coffee")
      )
    );

    // ---- Offline-first (must be last: it shuts the server down) ----------
    // The whole design rests on this, and it is the one property that fails
    // silently — a script added to index.html but missing from sw.js's
    // CORE_ASSETS breaks the app only when there is no network, which is
    // exactly when nobody is watching. Note that puppeteer's setOfflineMode
    // gates the PAGE's requests but not the service worker's own fetches, so it
    // would not actually exercise the cache; closing the server does.
    const swState = await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      const names = await caches.keys();
      if (!names.length) return { cacheName: null, scripts: 0, entries: 0 };
      const cache = await caches.open(names[0]);
      const keys = await cache.keys();
      const paths = keys.map((k) => new URL(k.url).pathname);
      return {
        cacheName: names[0],
        entries: paths.length,
        scripts: paths.filter((p) => p.endsWith(".js")).length,
      };
    });
    check("service worker precaches the app", swState.entries > 0,
      `${swState.entries} entries in ${swState.cacheName}`);
    check("every app script is precached", swState.scripts >= 25,
      `${swState.scripts} scripts`);

    await page.evaluate(() => {
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 11.11, type: "expense", description: "Offline Survivor",
      });
      window.app.store.flushPendingSave();
    });

    await closeServer();
    await sleep(300);
    requestsWhileOffline = 0;
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(2000);
    const offline = await page.evaluate(() => ({
      booted: !!window.app && window.app._initialized === true,
      rendered:
        document.getElementById("calendarAgenda").children.length > 0 ||
        document.getElementById("calendarDays").children.length > 0,
      hasData:
        !!window.app &&
        Object.values(window.app.store.getTransactions())
          .flat()
          .some((t) => t.description === "Offline Survivor"),
    }));
    check("app boots with the server down", offline.booted);
    check("calendar renders offline", offline.rendered);
    check("data is intact offline", offline.hasData);
    check("nothing reached the (dead) server", requestsWhileOffline === 0,
      `${requestsWhileOffline} requests`);

    check("no page errors during the whole run", consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    await closeServer();
  }

  if (failures.length > 0) {
    console.error(`\nUI HARNESS FAILURES (${failures.length}):`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("\nALL UI CHECKS PASSED");
  process.exit(0);
})().catch((err) => {
  console.error("verify-ui crashed:", err);
  process.exit(1);
});
