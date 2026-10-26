// End-to-end test with a fake GitHub API (no real token needed).
//   1. start a static server:   python3 -m http.server 8080
//   2. run:                      npm test
// Uses Playwright (npm i -D playwright, then npx playwright install chromium).
// Screenshots are written to tests/screenshots/.

import { chromium, devices } from "playwright";
import { mkdirSync } from "fs";
import { createHash } from "crypto";
import * as org from "../assets/organize.js";

const BASE = process.env.BASE || "http://localhost:8080";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
// Any Content-Security-Policy violation or page error fails the run at the end
const problems = [];
const watch = (p) => {
  p.on("pageerror", (e) => problems.push("page error: " + e.message));
  p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) problems.push("CSP: " + m.text()); });
};

// ---------------------------------------------------------------- unit checks
assert(org.categorize("Arbeitszeugnis_attocube.pdf").id === "work", "categorize: longest keyword wins (Arbeitszeugnis -> Work)");
assert(org.categorize("Mietvertrag Karlsfeld.pdf").id === "home", "categorize: German compound (Mietvertrag -> Home)");
assert(org.categorize("idea.txt").id === "other", "categorize: short keyword 'id' does not match 'idea'");
assert(org.categorize("IMG_1234.HEIC").id === "photos", "categorize: unknown images -> Photos");
assert(org.parseCommit("Upload a [1].pdf [Mac, drop]").name === "a [1].pdf", "parseCommit: brackets inside the name");
assert(org.parseCommit("Rename a.pdf -> b.pdf [Mac]").from === "a.pdf", "parseCommit: rename");
assert(org.thisDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5) === "iPad", "thisDevice: iPadOS desktop UA -> iPad");
const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36";
assert(org.canPreview("a.heic", SAFARI) && !org.canPreview("a.heic", CHROME_ANDROID), "canPreview: HEIC only in Safari");
assert(!org.canPreview("a.pdf", CHROME_ANDROID) && !org.canPreview("a.docx", SAFARI), "canPreview: no PDF on Android, no Word anywhere");

// ---------------------------------------------------------------- fake GitHub
// Behaves like the real API for everything the app uses, including real git
// blob shas (so duplicate detection works) and the Git Data API (rename/undo).
const OWNER = "tester", REPO = "docsync-vault", TOKEN = "github_pat_TEST";
const gitSha = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");
const blobs = new Map();   // sha -> buf (git never forgets a blob)
const vault = new Map();   // path -> {buf, sha}  (the current tree)
const commits = [];        // newest first: {path, message, date}
const trees = new Map();   // pending tree sha -> Map(path -> sha|null)
const gitCommits = new Map(); // commit sha -> tree sha
let head = "c0", seq = 0;
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();
function setFile(path, buf) { const sha = gitSha(buf); blobs.set(sha, buf); vault.set(path, { buf, sha }); return sha; }
function seed(name, buf, message, date) { setFile("files/" + name, buf); commits.unshift({ path: "files/" + name, message, date }); }

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
seed("Lebenslauf.docx", Buffer.alloc(48000), "Add files via upload", daysAgo(40));          // added on github.com
seed("notes.txt", Buffer.from("Hello from the tool\nLine 2"), "Upload notes.txt [Mac, drop]", daysAgo(10));
seed("passport-scan.png", PNG, "Upload passport-scan.png [iPhone, share]", daysAgo(2));
const SEEDED = new Map([...vault].map(([p, f]) => [p, f.buf]));

let stateWrites = 0;
let publicVault = false;
async function mockGitHub(context) {
  await context.route("https://api.github.com/**", async (route) => {
    const req = route.request();
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" };
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const json = (status, body) => route.fulfill({ status, headers: { ...cors, "content-type": "application/json" }, body: JSON.stringify(body) });

    if (req.headers()["authorization"] !== `Bearer ${TOKEN}`) return json(401, { message: "Bad credentials" });
    const url = new URL(req.url());
    const base = `/repos/${OWNER}/${REPO}`;
    const m = req.method();
    const sub = url.pathname.slice(base.length);
    if (sub === "") return json(200, { name: REPO, private: !publicVault, default_branch: "main" });

    // ----- commits list
    if (sub === "/commits") {
      const p = url.searchParams.get("path");
      const per = +url.searchParams.get("per_page") || 30, page = +url.searchParams.get("page") || 1;
      const list = commits.filter((c) => c.path === p || c.path.startsWith(p + "/")).slice((page - 1) * per, page * per);
      return json(200, list.map((c, i) => ({ sha: "c" + i, commit: { message: c.message, committer: { date: c.date } } })));
    }

    // ----- Git Data API
    if (sub === "/git/ref/heads/main") return json(200, { object: { sha: head } });
    if (sub.startsWith("/git/commits/") && m === "GET") return json(200, { tree: { sha: "t-" + sub.split("/").pop() } });
    if (sub === "/git/trees" && m === "POST") {
      const { tree } = req.postDataJSON();
      const sha = "t" + ++seq;
      trees.set(sha, new Map(tree.map((e) => [e.path, e.sha])));
      return json(201, { sha });
    }
    if (sub === "/git/commits" && m === "POST") {
      const { tree, message, parents } = req.postDataJSON();
      if (parents[0] !== head) return json(422, { message: "stale parent" });
      const sha = "c" + ++seq;
      gitCommits.set(sha, { tree, message });
      return json(201, { sha });
    }
    if (sub === "/git/refs/heads/main" && m === "PATCH") {
      const { sha } = req.postDataJSON();
      const c = gitCommits.get(sha);
      for (const [path, blobSha] of trees.get(c.tree)) {
        if (blobSha === null) vault.delete(path);
        else vault.set(path, { buf: blobs.get(blobSha), sha: blobSha });
        commits.unshift({ path, message: c.message, date: new Date().toISOString() });
      }
      head = sha;
      return json(200, { object: { sha } });
    }

    // ----- Contents API
    if (!sub.startsWith("/contents/")) return json(404, { message: "Not Found" });
    const path = decodeURIComponent(sub.slice("/contents/".length));
    const raw = (req.headers()["accept"] || "").includes("raw");

    if (m === "GET" && path === "files") {
      const items = [...vault].filter(([p]) => p.startsWith("files/")).map(([p, f]) => ({ type: "file", name: p.split("/").pop(), path: p, sha: f.sha, size: f.buf.length }));
      return items.length ? json(200, items) : json(404, { message: "Not Found" });
    }
    if (m === "GET") {
      const f = vault.get(path);
      if (!f) return json(404, { message: "Not Found" });
      if (raw) return route.fulfill({ status: 200, headers: cors, body: f.buf });
      return json(200, { type: "file", path, sha: f.sha, content: f.buf.toString("base64") });
    }
    if (m === "PUT") {
      const { content, message, sha } = req.postDataJSON();
      const existing = vault.get(path);
      if (existing && !sha) return json(422, { message: '"sha" wasn\'t supplied.' });
      if (existing && sha !== existing.sha) return json(409, { message: "conflict" });
      if (path.startsWith(".app/")) stateWrites++;
      const newSha = setFile(path, Buffer.from(content, "base64"));
      if (path.startsWith("files/")) commits.unshift({ path, message, date: new Date().toISOString() });
      return json(201, { content: { path, sha: newSha } });
    }
    if (m === "DELETE") {
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
const favorites = () => JSON.parse(vault.get(".app/state.json")?.buf.toString() || '{"favorites":[]}').favorites;

const browser = await chromium.launch();

// ---------------------------------------------------------------- setup page
const ctx = await browser.newContext();
await mockGitHub(ctx);
const page = await ctx.newPage();
watch(page);
await page.goto(`${BASE}/setup.html`);
await page.fill("#owner", OWNER);
await page.fill("#token", "wrong");
await page.fill("#pw", "blue tram to Karlsfeld 42");
await page.fill("#pw2", "blue tram to Karlsfeld 42");
await page.click("#go");
await page.waitForFunction(() => document.getElementById("err").textContent.length > 0);
assert(/not valid/.test(await page.textContent("#err")), "setup rejects a bad token");
await page.fill("#token", TOKEN);
publicVault = true;
await page.click("#go");
await page.waitForFunction(() => /is public/.test(document.getElementById("err").textContent), null, { timeout: 15000 });
assert(true, "setup refuses a PUBLIC vault repo");
publicVault = false;
await page.fill("#pw", "password123");
await page.fill("#pw2", "password123");
await page.click("#go");
await page.waitForFunction(() => /stronger password/.test(document.getElementById("err").textContent));
assert(true, "setup refuses a weak password");
await page.fill("#pw", "blue tram to Karlsfeld 42");
await page.fill("#pw2", "blue tram to Karlsfeld 42");
await page.click("#go");
await page.waitForSelector("#result:not([hidden])", { timeout: 30000 });
const configText = await page.inputValue("#out");
assert(configText.includes("encryptedToken") && !configText.includes(TOKEN), "config is generated and does not contain the raw token");
await page.screenshot({ path: SHOTS + "setup.png", fullPage: true });
await ctx.close();

const PASSWORD = "blue tram to Karlsfeld 42";
const names = (p) => p.$$eval(".file-name", (els) => els.map((e) => e.textContent));
const search = async (p, q) => { await p.fill("#search", q); await p.waitForTimeout(250); return names(p); };
const row = (p, n) => p.locator(".file", { hasText: n }).first();
const menuAction = async (p, n, act) => { await row(p, n).getByLabel("More options").click(); await p.click(`#menu [data-act="${act}"]`); };

// ---------------------------------------------------------------- app: desktop + iPhone
for (const [label, opts, device] of [
  ["desktop", { viewport: { width: 1280, height: 860 } }, "Linux PC"],
  ["iphone", devices["iPhone 13"], "iPhone"],
]) {
  const c = await browser.newContext({ ...opts, acceptDownloads: true });
  await c.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await mockGitHub(c);
  await c.route(`${BASE}/config.js*`, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: configText }));
  const p = await c.newPage();
  watch(p);
  await p.goto(BASE + "/");
  await p.waitForSelector("#lock:not([hidden])");
  assert((await p.title()) === "a really helpful tool", `${label}: app is called "a really helpful tool"`);
  await p.screenshot({ path: SHOTS + `${label}-1-lock.png` });

  await p.fill("#lock-input", "wrong password");
  await p.click("#lock-btn");
  await p.waitForFunction(() => document.getElementById("lock-error").textContent.length > 0, null, { timeout: 30000 });
  assert((await p.textContent("#lock-error")).includes("Wrong password"), `${label}: wrong password rejected`);

  await p.fill("#lock-input", PASSWORD);
  await p.click("#lock-btn");
  await p.waitForSelector("#app:not([hidden]) .file", { timeout: 30000 });
  assert((await p.locator(".file").count()) === 3, `${label}: lists 3 files`);

  // origins
  await p.waitForFunction(() => document.body.innerText.includes("GitHub"), null, { timeout: 10000 });
  assert((await row(p, "passport").innerText()).includes("iPhone"), `${label}: passport shows "iPhone"`);
  assert((await row(p, "Lebenslauf").innerText()).includes("GitHub"), `${label}: file added on github.com shows "GitHub"`);

  // upload + duplicate name + duplicate content
  await p.setInputFiles("#file-input", [
    { name: "Offer Letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("second notes") },
    { name: "passport-copy.png", mimeType: "image/png", buffer: PNG },
  ]);
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 5, null, { timeout: 15000 });
  assert(vault.has("files/notes (2).txt"), `${label}: duplicate name saved as "notes (2).txt"`);
  assert(!vault.has("files/passport-copy.png"), `${label}: identical file is not uploaded twice`);
  assert((await p.textContent("#queue")).includes("Already saved as passport-scan.png"), `${label}: says where the identical file already is`);
  assert(lastMessage("Offer Letter.pdf") === `Upload Offer Letter.pdf [${device}, upload]`, `${label}: commit message records device "${device}"`);

  // drop anywhere + paste
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["rent"], "Mietvertrag.pdf", { type: "application/pdf" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 6, null, { timeout: 15000 });
  assert(lastMessage("Mietvertrag.pdf").endsWith("drop]"), `${label}: drop anywhere uploads`);
  await p.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["png-bytes-" + Math.random()], "image.png", { type: "image/png" }));
    document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 7, null, { timeout: 15000 });
  assert([...vault.keys()].some((k) => k.startsWith("files/Screenshot ")), `${label}: paste uploads a screenshot with a useful name`);

  // favourites: heart, synced to .app/state.json, pinned on top, chip
  await row(p, "Lebenslauf").getByLabel("Add to favourites").click({ force: true });
  await p.waitForFunction(() => document.querySelector(".file .heart[aria-pressed=true]"));
  await p.waitForTimeout(400);
  assert(favorites().includes("files/Lebenslauf.docx"), `${label}: favourite saved to the vault (syncs to other devices)`);
  assert((await names(p))[0] === "Lebenslauf.docx", `${label}: favourites pinned to the top`);
  await p.locator(".chip", { hasText: "Favourites" }).click();
  assert(JSON.stringify(await names(p)) === '["Lebenslauf.docx"]', `${label}: Favourites chip`);
  await p.locator(".chip", { hasText: "All" }).click();
  await p.screenshot({ path: SHOTS + `${label}-2-list.png`, fullPage: true });

  // search still smart
  assert(JSON.stringify(await search(p, "pasport")) === '["passport-scan.png"]', `${label}: search forgives typos`);
  await search(p, "");

  // tap a previewable file -> instant preview; tap a Word file -> actions menu
  await row(p, "notes.txt").locator(".file-main").click();
  await p.waitForSelector("#preview-body pre");
  assert((await p.textContent("#preview-body pre")).includes("Hello from the tool"), `${label}: text preview`);
  await p.keyboard.press("Escape");
  await row(p, "Lebenslauf").locator(".file-main").click();
  await p.waitForSelector("#menu:not([hidden])");
  assert(await p.isHidden('#menu [data-act="preview"]'), `${label}: Word file opens the menu, no preview option`);
  await p.screenshot({ path: SHOTS + `${label}-3-menu.png` });
  await p.keyboard.press("Escape");

  // second open of the image comes from cache: no spinner, no network
  await row(p, "passport-scan").locator(".file-main").click();
  await p.waitForSelector("#preview-body img");
  await p.click("#preview [data-close]");
  let downloads = 0;
  p.on("request", (r) => { if (r.url().includes("contents/files/passport")) downloads++; });
  await row(p, "passport-scan").locator(".file-main").click();
  await p.waitForSelector("#preview-body img");
  assert(downloads === 0 && !(await p.$("#preview-body .loading")), `${label}: reopening a file is instant (cached)`);
  await p.screenshot({ path: SHOTS + `${label}-4-preview.png` });

  // copy image to clipboard (desktop Chromium supports image clipboard)
  if (label === "desktop") {
    await p.click("#preview-copy");
    await p.waitForFunction(() => document.getElementById("toast-text").textContent.includes("copied"), null, { timeout: 5000 });
    const types = await p.evaluate(async () => (await navigator.clipboard.read())[0].types);
    assert(types.includes("image/png"), "desktop: image copied to clipboard as PNG");
  }
  await p.click("#preview [data-close]");

  // rename (one commit, keeps origin + favourite)
  await menuAction(p, "Lebenslauf", "rename");
  await p.waitForSelector("#rename:not([hidden])");
  await p.waitForTimeout(100);
  assert(await p.evaluate(() => document.getElementById("rename-input").selectionEnd === "Lebenslauf".length), `${label}: rename selects the name, not the extension`);
  await p.fill("#rename-input", "CV Jay Gohil");
  await p.click("#rename-ok");
  await p.waitForFunction(() => [...document.querySelectorAll(".file-name")].some((e) => e.textContent === "CV Jay Gohil.docx"));
  assert(vault.has("files/CV Jay Gohil.docx") && !vault.has("files/Lebenslauf.docx"), `${label}: rename keeps the extension and moves the file`);
  await p.waitForTimeout(400);
  assert(favorites().includes("files/CV Jay Gohil.docx"), `${label}: renamed file is still a favourite`);
  assert((await row(p, "CV Jay Gohil").innerText()).includes("GitHub"), `${label}: renamed file keeps its origin`);

  // rename to an existing name is refused
  await menuAction(p, "Mietvertrag", "rename");
  await p.fill("#rename-input", "notes.txt");
  await p.click("#rename-ok");
  await p.waitForFunction(() => document.getElementById("rename-error").textContent.includes("already exists"));
  assert(true, `${label}: rename refuses an existing name`);
  await p.click("#rename [data-close]");

  // download from the menu
  const [dl] = await Promise.all([p.waitForEvent("download"), menuAction(p, "notes (2).txt", "download")]);
  assert(dl.suggestedFilename() === "notes (2).txt", `${label}: download has right name`);

  // delete + undo
  await menuAction(p, "notes (2).txt", "delete");
  await p.click("#confirm-ok");
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 6);
  assert(!vault.has("files/notes (2).txt"), `${label}: delete works`);
  await p.click("#toast-action");
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 7, null, { timeout: 10000 });
  assert(vault.has("files/notes (2).txt"), `${label}: undo brings the deleted file back`);

  // reload: remembered device, list drawn instantly from cache
  await p.reload();
  await p.waitForSelector("#app:not([hidden]) .file");
  assert(true, `${label}: remembered device skips lock`);

  // lock wipes local copies
  await p.click("#logout-btn");
  await p.waitForSelector("#lock:not([hidden])");
  const leftovers = await p.evaluate(async () => (await caches.keys()).length + (localStorage.getItem("docsync.list.v1") ? 1 : 0));
  assert(leftovers === 0, `${label}: lock removes cached files and list from the device`);

  // reset the fake vault for the next round
  for (const k of [...vault.keys()]) if (k.startsWith("files/") || k.startsWith(".app/")) vault.delete(k);
  for (const [k, buf] of SEEDED) setFile(k, buf);
  commits.length = 0;
  seed("Lebenslauf.docx", Buffer.alloc(48000), "Add files via upload", daysAgo(40));
  seed("notes.txt", Buffer.from("Hello from the tool\nLine 2"), "Upload notes.txt [Mac, drop]", daysAgo(10));
  seed("passport-scan.png", PNG, "Upload passport-scan.png [iPhone, share]", daysAgo(2));
  await c.close();
}

await browser.close();
assert(problems.length === 0, `no CSP violations or page errors${problems.length ? ":\n  " + problems.join("\n  ") : ""}`);
console.log("\nAll tests passed.");
