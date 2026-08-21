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
