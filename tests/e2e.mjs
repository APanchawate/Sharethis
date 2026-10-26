// End-to-end test with a fake GitHub API (no real token needed).
//   1. start a static server:   python3 -m http.server 8080
//   2. run:                      npm test
// Uses Playwright (npm i -D playwright, then npx playwright install chromium).
// Screenshots are written to tests/screenshots/.

import { chromium, devices } from "playwright";
import { mkdirSync } from "fs";
import * as org from "../assets/organize.js";

const BASE = process.env.BASE || "http://localhost:8080";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

// ---------------------------------------------------------------- unit checks
assert(org.categorize("Arbeitszeugnis_attocube.pdf").id === "work", "categorize: longest keyword wins (Arbeitszeugnis -> Work)");
assert(org.categorize("Mietvertrag Karlsfeld.pdf").id === "home", "categorize: German compound (Mietvertrag -> Home)");
assert(org.categorize("idea.txt").id === "other", "categorize: short keyword 'id' does not match 'idea'");
assert(org.categorize("IMG_1234.HEIC").id === "photos", "categorize: unknown images -> Photos");
assert(org.parseCommit("Upload a [1].pdf [Mac, drop]").name === "a [1].pdf", "parseCommit: brackets inside the name");
assert(org.thisDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5) === "iPad", "thisDevice: iPadOS desktop UA -> iPad");

// ---------------------------------------------------------------- fake GitHub
const OWNER = "tester", REPO = "docsync-vault", TOKEN = "github_pat_TEST";
const vault = new Map();   // path -> {buf, sha}
const commits = [];        // newest first: {path, message, date}
let shaN = 0;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
function seed(name, buf, message, date) {
  const path = "files/" + name;
  vault.set(path, { buf, sha: "s" + ++shaN });
  commits.unshift({ path, message, date });
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
seed("Lebenslauf.docx", Buffer.alloc(48000), "Add files via upload", daysAgo(40));          // added on github.com
seed("notes.txt", Buffer.from("Hello from DocSync\nLine 2"), "Upload notes.txt [Mac, drop]", daysAgo(10));
seed("passport-scan.png", PNG, "Upload passport-scan.png [iPhone, share]", daysAgo(2));

async function mockGitHub(context) {
  await context.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`) return json(401, { message: "Bad credentials" });
    const url = new URL(req.url());
    const base = `/repos/${OWNER}/${REPO}`;
    if (url.pathname === base) return json(200, { name: REPO, private: true });

    if (url.pathname === base + "/commits") {
      const p = url.searchParams.get("path");
      const per = +url.searchParams.get("per_page") || 30, page = +url.searchParams.get("page") || 1;
      const list = commits.filter((c) => c.path === p || c.path.startsWith(p + "/")).slice((page - 1) * per, page * per);
      return json(200, list.map((c, i) => ({ sha: "c" + i, commit: { message: c.message, committer: { date: c.date } } })));
    }

    if (!url.pathname.startsWith(base + "/contents/")) return json(404, { message: "Not Found" });
    const path = decodeURIComponent(url.pathname.slice((base + "/contents/").length));

    if (req.method() === "GET" && path === "files") {
      const items = [...vault].map(([p, f]) => ({ type: "file", name: p.split("/").pop(), path: p, sha: f.sha, size: f.buf.length }));
      return items.length ? json(200, items) : json(404, { message: "Not Found" });
    }
    if (req.method() === "GET") {
      const f = vault.get(path);
      if (!f) return json(404, { message: "Not Found" });
      return route.fulfill({ status: 200, headers: cors, body: f.buf });
    }
    if (req.method() === "PUT") {
      if (vault.has(path)) return json(422, { message: '"sha" wasn\'t supplied.' });
      const { content, message } = req.postDataJSON();
      const sha = "s" + ++shaN;
      vault.set(path, { buf: Buffer.from(content, "base64"), sha });
      commits.unshift({ path, message, date: new Date().toISOString() });
      return json(201, { content: { path, sha } });
    }
    if (req.method() === "DELETE") {
      const { sha, message } = req.postDataJSON();
      if (vault.get(path)?.sha !== sha) return json(409, { message: "sha mismatch" });
      vault.delete(path);
      commits.unshift({ path, message, date: new Date().toISOString() });
      return json(200, {});
    }
    return json(405, { message: "nope" });
  });
}
const lastMessage = (name) => commits.find((c) => c.path === "files/" + name)?.message || "";

const browser = await chromium.launch();

// ---------------------------------------------------------------- setup page
const ctx = await browser.newContext({ serviceWorkers: "block" });
await mockGitHub(ctx);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.error("PAGE ERROR", e));
await page.goto(`${BASE}/setup.html`);
await page.fill("#owner", OWNER);
await page.fill("#token", "wrong");
await page.fill("#pw", "blue tram to Karlsfeld 42");
await page.fill("#pw2", "blue tram to Karlsfeld 42");
await page.click("#go");
await page.waitForFunction(() => document.getElementById("err").textContent.length > 0);
assert(/not valid/.test(await page.textContent("#err")), "setup rejects a bad token");
await page.fill("#token", TOKEN);
await page.click("#go");
await page.waitForSelector("#result:not([hidden])", { timeout: 30000 });
const configText = await page.inputValue("#out");
assert(configText.includes("encryptedToken") && !configText.includes(TOKEN), "config is generated and does not contain the raw token");
await page.screenshot({ path: SHOTS + "setup.png", fullPage: true });
await ctx.close();

const PASSWORD = "blue tram to Karlsfeld 42";
async function unlock(p) {
  await p.goto(BASE + "/");
  await p.waitForSelector("#lock:not([hidden])");
  await p.fill("#lock-input", PASSWORD);
  await p.click("#lock-btn");
  await p.waitForSelector("#app:not([hidden]) .file", { timeout: 30000 });
}
const names = (p) => p.$$eval(".file-name", (els) => els.map((e) => e.textContent));
const search = async (p, q) => { await p.fill("#search", q); await p.waitForTimeout(250); return names(p); };

// ---------------------------------------------------------------- app: desktop + iPhone
for (const [label, opts, device] of [
  ["desktop", { viewport: { width: 1280, height: 860 } }, "Linux PC"],
  ["iphone", devices["iPhone 13"], "iPhone"],
]) {
  const c = await browser.newContext({ ...opts, acceptDownloads: true, serviceWorkers: "block" });
  await mockGitHub(c);
  await c.route(`${BASE}/config.js`, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: configText }));
  const p = await c.newPage();
  p.on("pageerror", (e) => console.error("PAGE ERROR", e));
  await p.goto(BASE + "/");
  await p.waitForSelector("#lock:not([hidden])");
  await p.screenshot({ path: SHOTS + `${label}-1-lock.png` });

  await p.fill("#lock-input", "wrong password");
  await p.click("#lock-btn");
  await p.waitForFunction(() => document.getElementById("lock-error").textContent.length > 0, null, { timeout: 30000 });
  assert((await p.textContent("#lock-error")).includes("Wrong password"), `${label}: wrong password rejected`);

  await unlock(p);
  assert((await p.locator(".file").count()) === 3, `${label}: lists 3 files`);

  // origins resolved from commit history (+ per-file fallback)
  await p.waitForFunction(() => document.body.innerText.includes("GitHub"), null, { timeout: 10000 });
  const rowText = (n) => p.locator(".file", { hasText: n }).first().innerText();
  assert((await rowText("passport")).includes("iPhone") && (await rowText("passport")).includes("shared"), `${label}: passport shows "iPhone" and "shared"`);
  assert((await rowText("notes.txt")).includes("Mac"), `${label}: notes shows "Mac"`);
  assert((await rowText("Lebenslauf")).includes("GitHub"), `${label}: file added on github.com shows "GitHub"`);

  // default sort = newest first
  assert((await names(p))[0] === "passport-scan.png", `${label}: newest first by default`);

  // upload via button (and a duplicate name)
  await p.setInputFiles("#file-input", [
    { name: "Offer Letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("second notes") },
  ]);
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 5, null, { timeout: 15000 });
  assert(vault.has("files/notes (2).txt"), `${label}: duplicate name saved as "notes (2).txt"`);
  assert(lastMessage("Offer Letter.pdf") === `Upload Offer Letter.pdf [${device}, upload]`, `${label}: commit message records device "${device}"`);

  // drop anywhere on the page
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["rent"], "Mietvertrag.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 6, null, { timeout: 15000 });
  assert(lastMessage("Mietvertrag.pdf").endsWith("drop]"), `${label}: drop anywhere uploads (via "drop")`);
  await p.screenshot({ path: SHOTS + `${label}-2-list.png`, fullPage: true });

  // categories
  const chips = await p.$$eval(".chip", (els) => els.map((e) => e.textContent));
  assert(chips.some((t) => t.startsWith("ID & Visa")) && chips.some((t) => t.startsWith("Work")) && chips.some((t) => t.startsWith("Home")), `${label}: auto category chips (${chips.join(", ")})`);
  await p.locator(".chip", { hasText: "Work" }).click();
  assert(JSON.stringify((await names(p)).sort()) === JSON.stringify(["Lebenslauf.docx", "Offer Letter.pdf"]), `${label}: Work chip filters to CV + offer`);
  await p.locator(".chip", { hasText: "All" }).click();

  // smart search
  assert(JSON.stringify(await search(p, "pasport")) === '["passport-scan.png"]', `${label}: search forgives typos ("pasport")`);
  assert(JSON.stringify(await search(p, "shared from iphone")) === '["passport-scan.png"]', `${label}: search by device + shared ("shared from iphone")`);
  assert((await search(p, "pdf today")).length === 2, `${label}: search by type + date ("pdf today")`);
  assert(JSON.stringify(await search(p, "visa")) === '["passport-scan.png"]', `${label}: search by category word ("visa")`);
  await search(p, "zzzz");
  assert(!(await p.isHidden("#no-results")), `${label}: no-results message`);
  await p.click("#clear-search");
  assert((await p.locator(".file").count()) === 6, `${label}: clear search shows all`);

  // sort
  await p.selectOption("#sort", "size");
  assert((await names(p))[0] === "Lebenslauf.docx", `${label}: sort by size`);
  await p.selectOption("#sort", "name");
  assert((await names(p))[0] === "Lebenslauf.docx" && (await names(p))[1] === "Mietvertrag.pdf", `${label}: sort by name`);
  await p.selectOption("#sort", "newest");

  // preview text + image + docx fallback
  await p.locator(".file-main", { hasText: "notes.txt" }).first().click();
  await p.waitForSelector("#preview-body pre");
  assert((await p.textContent("#preview-body pre")).includes("Hello from DocSync"), `${label}: text preview works`);
  await p.keyboard.press("Escape");
  await p.locator(".file-main", { hasText: "passport-scan.png" }).click();
  await p.waitForSelector("#preview-body img");
  await p.click("#preview [data-close]");
  await p.locator(".file-main", { hasText: "Lebenslauf" }).click();
  await p.waitForSelector("#preview-body .preview-msg");
  await p.click("#preview [data-close]");
  assert(true, `${label}: image preview and docx fallback`);

  // share help modal
  await p.click("#share-help-btn");
  await p.waitForSelector("#share-help:not([hidden])");
  assert((await p.inputValue("#sc-url")).endsWith(`/repos/${OWNER}/${REPO}/contents/files/`), `${label}: share help shows Shortcut URL`);
  await p.screenshot({ path: SHOTS + `${label}-3-share-help.png` });
  await p.click("#share-help [data-close]");

  // download
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".file", { hasText: "notes (2).txt" }).getByLabel("Download").click()]);
  assert(dl.suggestedFilename() === "notes (2).txt", `${label}: download has right name`);

  // delete
  await p.locator(".file", { hasText: "notes (2).txt" }).getByLabel("Delete").click();
  await p.click("#confirm-ok");
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 5);
  assert(!vault.has("files/notes (2).txt"), `${label}: delete works`);

  // reload: remembered device opens without password; meta comes from cache
  await p.reload();
  await p.waitForSelector("#app:not([hidden]) .file");
  assert((await rowText("passport")).includes("iPhone"), `${label}: remembered device skips lock, origins cached`);

  await p.click("#logout-btn");
  await p.waitForSelector("#lock:not([hidden])");
  assert(true, `${label}: lock button works`);

  // reset for next round
  for (const n of ["Offer Letter.pdf", "Mietvertrag.pdf"]) vault.delete("files/" + n);
  await c.close();
}

// ---------------------------------------------------------------- Android share target (service worker)
{
  const c = await browser.newContext({ ...devices["Pixel 7"] });
  await mockGitHub(c);
  await c.route(`${BASE}/config.js`, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: configText }));
  const p = await c.newPage();
  p.on("pageerror", (e) => console.error("PAGE ERROR", e));
  await unlock(p);
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload(); // page is now controlled by the service worker
  await p.waitForSelector("#app:not([hidden]) .file");
  await p.evaluate(() => navigator.serviceWorker.controller ? null : new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", r)));

  // Simulate Android posting a shared file to ./share-target
  await p.evaluate(() => {
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "share-target";
    form.enctype = "multipart/form-data";
    const input = document.createElement("input");
    input.type = "file";
    input.name = "files";
    const dt = new DataTransfer();
    dt.items.add(new File(["%PDF shared"], "Payslip_October.pdf", { type: "application/pdf" }));
    input.files = dt.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  });
  await p.waitForFunction(() => [...document.querySelectorAll(".file-name")].some((e) => e.textContent === "Payslip_October.pdf"), null, { timeout: 20000 });
  assert(lastMessage("Payslip_October.pdf") === "Upload Payslip_October.pdf [Android, share]", "android: shared file uploaded via service worker");
  assert(!p.url().includes("shared"), "android: ?shared removed from address bar");
  assert((await p.locator(".file", { hasText: "Payslip" }).innerText()).includes("shared"), "android: shows 'shared' tag");
  await p.screenshot({ path: SHOTS + "android-shared.png" });
  await c.close();
}

await browser.close();
console.log("\nAll tests passed.");
