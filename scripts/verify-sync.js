// Two-device cloud-sync harness (browser, real fetch, fake Gist).
//
// Cloud sync is the highest-consequence subsystem in the app: it is the only
// code that can destroy data the user has already entered. The vm harnesses
// cover _mergeData's algebra, but not the whole round trip — real fetch, real
// ETags, two independent localStorage containers, and the ordering between a
// push, a concurrent edit, and the import that follows the merge.
//
// This runs two isolated browser contexts (= two devices) against a fake Gist
// endpoint served by this script's own server, and drives the real
// saveToCloud/loadFromCloud. Like verify-ui.js it is NOT part of `npm test`
// (puppeteer is not a committed dependency) and exits 0 with a "skipped" note
// when puppeteer is absent. Run it with:
//   npm run test:sync
//
// What it pins:
//   - a push reaches the remote copy, and a pull applies it
//   - a second device's independent edit MERGES rather than clobbering
//   - a deletion tombstone survives the round trip (the other device must not
//     resurrect the row, locally or in the cloud copy)
//   - both devices converge on the same set
//   - a transaction entered WHILE a push is in flight survives it — the
//     snapshot has to be taken after the network round trip, not before

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
    "verify-sync: puppeteer is not installed — skipping the sync harness.\n" +
      "             (npm i -D puppeteer to enable it; npm test is unaffected.)"
  );
  process.exit(0);
}

// ---- Fake Gist -------------------------------------------------------------
// Behaves like the endpoint CloudSync expects: GET returns the stored file with
// an ETag (304 when If-None-Match matches), PATCH replaces it and bumps the ETag.
const gistState = { content: null, etag: '"e0"', revision: 0, patches: 0 };
// When set, the fake gist stalls this many ms before answering a GET — the
// window in which a concurrent edit lands.
let getDelayMs = 0;

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = req.url.split("?")[0];

    if (urlPath.startsWith("/gists/")) {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", async () => {
        const headers = {
          "Content-Type": "application/json",
          ETag: gistState.etag,
          "Access-Control-Allow-Origin": "*",
        };
        if (req.method === "PATCH") {
          gistState.content = JSON.parse(body).files["cashflow_data.json"].content;
          gistState.etag = `"e${++gistState.revision}"`;
          gistState.patches++;
          headers.ETag = gistState.etag;
          res.writeHead(200, headers);
          return res.end(JSON.stringify({ id: "gid" }));
        }
        if (getDelayMs) await new Promise((r) => setTimeout(r, getDelayMs));
        if (req.headers["if-none-match"] === gistState.etag) {
          res.writeHead(304, headers);
          return res.end();
        }
        res.writeHead(200, headers);
        res.end(
          JSON.stringify({
            id: "gid",
            files: {
              "cashflow_data.json": {
                content: gistState.content ?? "{}",
                truncated: false,
              },
            },
          })
        );
      });
      return;
    }

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

const failures = [];
function check(name, passed, detail = "") {
  console.log(`${passed ? "✅" : "❌"} ${name}${detail ? `  (${detail})` : ""}`);
  if (!passed) failures.push(name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// An isolated browser context per device, so the two have separate localStorage
// exactly as two real installs would.
async function openDevice(browser, port, label) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`${label}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${label}: ${msg.text().slice(0, 160)}`);
  });
  // Point the GitHub API at the fake gist before any app script runs.
  await page.evaluateOnNewDocument((p) => {
    const realFetch = window.fetch;
    window.fetch = (url, opts) => {
      if (typeof url === "string" && url.startsWith("https://api.github.com/gists/")) {
        return realFetch(`http://localhost:${p}/gists/${url.split("/gists/")[1]}`, opts);
      }
      return realFetch(url, opts);
    };
  }, port);
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "networkidle0" });
  await sleep(600);
  await page.evaluate(() => {
    localStorage.setItem("gist_id", "gid");
    // Stub credential retrieval: the token is device-encrypted and the dialog
    // is not what this harness is testing.
    window.app.cloudSync.getCloudCredentialsAsync = async () => ({
      token: "tok",
      gistId: "gid",
    });
  });
  return { context, page, errors, label };
}

const descriptionsOf = (page) =>
  page.evaluate(() =>
    Object.values(window.app.store.getTransactions())
      .flat()
      .filter((t) => t.description)
      .map((t) => t.description)
      .sort()
      .join(",")
  );

(async () => {
  const { server, port } = await startServer();
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  let deviceA;
  let deviceB;

  try {
    deviceA = await openDevice(browser, port, "A");
    deviceB = await openDevice(browser, port, "B");

    // ---- A creates data and pushes --------------------------------------
    await deviceA.page.evaluate(() => {
      const today = Utils.formatDateString(new Date());
      window.app.store.addTransaction(today, {
        amount: 100, type: "income", description: "A-Income",
      });
      window.app.store.addDebt({ name: "A-Debt", balance: 500, minPayment: 25 });
      window.app.store.flushPendingSave();
    });
    await deviceA.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1000);
    check("A's push reaches the remote copy",
      !!gistState.content && gistState.content.includes("A-Income"));

    // ---- B pulls ---------------------------------------------------------
    await deviceB.page.evaluate(() => window.app.cloudSync.loadFromCloud(true));
    await sleep(1200);
    check("B's pull applies A's transaction", await deviceB.page.evaluate(() =>
      Object.values(window.app.store.getTransactions()).flat()
        .some((t) => t.description === "A-Income")));
    check("B's pull applies A's debt", await deviceB.page.evaluate(() =>
      window.app.store.getDebts().some((d) => d.name === "A-Debt")));

    // ---- B edits and pushes ---------------------------------------------
    await deviceB.page.evaluate(() => {
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 42, type: "expense", description: "B-Expense", settled: true,
      });
      window.app.store.flushPendingSave();
    });
    await deviceB.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1200);
    check("B's push keeps A's data",
      gistState.content.includes("B-Expense") && gistState.content.includes("A-Income"));

    // ---- A edits independently, then pushes: must merge, not clobber -----
    await deviceA.page.evaluate(() => {
      const tomorrow = Utils.formatDateString(new Date(Date.now() + 86400000));
      window.app.store.addTransaction(tomorrow, {
        amount: 7, type: "expense", description: "A-Second", settled: true,
      });
      window.app.store.flushPendingSave();
    });
    await deviceA.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1400);
    check("A's stale-ETag push merges instead of overwriting B",
      gistState.content.includes("A-Income") &&
      gistState.content.includes("B-Expense") &&
      gistState.content.includes("A-Second"));
    check("the merge lands in A's own store too", await deviceA.page.evaluate(() =>
      Object.values(window.app.store.getTransactions()).flat()
        .some((t) => t.description === "B-Expense")));

    // ---- Deletion tombstones must not be undone by the other device ------
    await deviceB.page.evaluate(() => window.app.cloudSync.loadFromCloud(true));
    await sleep(1200);
    await deviceB.page.evaluate(() => {
      const transactions = window.app.store.getTransactions();
      for (const date of Object.keys(transactions)) {
        const index = transactions[date].findIndex((t) => t.description === "A-Income");
        if (index !== -1) {
          window.app.store.deleteTransaction(date, index);
          break;
        }
      }
      window.app.store.flushPendingSave();
    });
    await deviceB.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1400);
    check("B's delete reaches the remote copy", !gistState.content.includes("A-Income"));
    await deviceA.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1400);
    check("A's next push does not resurrect the deleted row",
      !gistState.content.includes("A-Income"));
    check("A drops the deleted row locally", await deviceA.page.evaluate(() =>
      !Object.values(window.app.store.getTransactions()).flat()
        .some((t) => t.description === "A-Income")));

    // ---- Convergence -----------------------------------------------------
    await deviceA.page.evaluate(() => window.app.cloudSync.loadFromCloud(true));
    await deviceB.page.evaluate(() => window.app.cloudSync.loadFromCloud(true));
    await sleep(1600);
    const setA = await descriptionsOf(deviceA.page);
    const setB = await descriptionsOf(deviceB.page);
    check("both devices converge on the same set", setA === setB, `${setA} || ${setB}`);

    // ---- An edit made DURING a push must survive it ----------------------
    // saveToCloud used to snapshot local data before its GET, merge that stale
    // snapshot, then import the result over the live map — destroying anything
    // typed during the round trip, in memory and on disk, silently.
    //
    // The merge path is the one that loses data, so the remote copy has to have
    // MOVED since A last synced — otherwise the GET answers 304, no merge runs,
    // no import replaces the live map, and this scenario passes for the wrong
    // reason. B pushes first to advance the ETag out from under A.
    await deviceB.page.evaluate(() => {
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 3.5, type: "expense", description: "B-Before-Race", settled: true,
      });
      window.app.store.flushPendingSave();
    });
    await deviceB.page.evaluate(() => window.app.cloudSync.saveToCloud(true));
    await sleep(1400);
    const etagBeforeRace = gistState.etag;
    const patchesBeforeRace = gistState.patches;

    getDelayMs = 600;
    const pushDuringEdit = deviceA.page.evaluate(() =>
      window.app.cloudSync.saveToCloud(true)
    );
    await sleep(200); // land inside the stalled GET
    await deviceA.page.evaluate(() => {
      window.app.store.addTransaction(Utils.formatDateString(new Date()), {
        amount: 77.77, type: "expense", description: "TYPED-DURING-PUSH", settled: true,
      });
      window.app.store.flushPendingSave();
    });
    await pushDuringEdit;
    await sleep(800);
    getDelayMs = 0;
    check("an edit made during a push survives in memory",
      await deviceA.page.evaluate(() =>
        Object.values(window.app.store.getTransactions()).flat()
          .some((t) => t.description === "TYPED-DURING-PUSH")));
    check("an edit made during a push survives on disk",
      await deviceA.page.evaluate(() =>
        JSON.stringify(JSON.parse(localStorage.getItem("transactions")))
          .includes("TYPED-DURING-PUSH")));
    check("an edit made during a push reaches the remote copy",
      gistState.content.includes("TYPED-DURING-PUSH"));
    // Prove the scenario actually took the merge path: A's ETag was stale, so
    // the GET answered 200 and the import ran. Without this the checks above
    // would still pass on the buggy ordering.
    check("the race scenario really exercised the merge path",
      gistState.patches > patchesBeforeRace &&
      gistState.content.includes("B-Before-Race"),
      `etag ${etagBeforeRace} -> ${gistState.etag}`);

    const errors = [...deviceA.errors, ...deviceB.errors];
    check("no page errors on either device", errors.length === 0,
      errors.slice(0, 3).join(" | "));
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\nSYNC HARNESS FAILURES (${failures.length}):`);
    failures.forEach((f) => console.error(`  - ${f}`));
    process.exit(1);
  }
  console.log("\nALL SYNC CHECKS PASSED");
  process.exit(0);
})().catch((err) => {
  console.error("verify-sync crashed:", err);
  process.exit(1);
});
