// End-to-end test with a fake GitHub API (no real token needed).
//   1. start a static server:   python3 -m http.server 8080
//   2. run:                      node tests/e2e.mjs
// Uses Playwright (npm i -D playwright, or a global install).
// Screenshots are written to tests/screenshots/.

import { chromium, devices } from "playwright";
import { mkdirSync } from "fs";

const BASE = process.env.BASE || "http://localhost:8080";
const SHOTS = new URL("./screenshots/", import.meta.url).pathname;
mkdirSync(SHOTS, { recursive: true });

const OWNER = "tester", REPO = "docsync-vault", TOKEN = "github_pat_TEST";
const vault = new Map(); // path -> {buf, sha}
let shaN = 0;

// Fake PDF + PNG so preview can be checked
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
vault.set("files/passport-scan.png", { buf: PNG, sha: "s" + ++shaN });
vault.set("files/notes.txt", { buf: Buffer.from("Hello from DocSync\nLine 2"), sha: "s" + ++shaN });
vault.set("files/Lebenslauf.docx", { buf: Buffer.alloc(48000), sha: "s" + ++shaN });

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
      const { content } = req.postDataJSON();
      vault.set(path, { buf: Buffer.from(content, "base64"), sha: "s" + ++shaN });
      return json(201, { content: { path } });
    }
    if (req.method() === "DELETE") {
      const { sha } = req.postDataJSON();
      if (vault.get(path)?.sha !== sha) return json(409, { message: "sha mismatch" });
      vault.delete(path);
      return json(200, {});
    }
    return json(405, { message: "nope" });
  });
}

const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

const browser = await chromium.launch();

// ---------- Setup page generates an encrypted config ----------
const ctx = await browser.newContext();
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

// ---------- Main app on desktop and phone ----------
for (const [label, opts] of [["desktop", { viewport: { width: 1280, height: 860 } }], ["iphone", devices["iPhone 13"]]]) {
  const c = await browser.newContext({ ...opts, acceptDownloads: true });
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

  await p.fill("#lock-input", "blue tram to Karlsfeld 42");
  await p.click("#lock-btn");
  await p.waitForSelector("#app:not([hidden]) .file", { timeout: 30000 });
  assert((await p.locator(".file").count()) === 3, `${label}: lists 3 files`);
  await p.screenshot({ path: SHOTS + `${label}-2-list.png` });

  // upload a new file and a duplicate name
  await p.setInputFiles("#file-input", [
    { name: "Offer Letter.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 fake") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("second notes") },
  ]);
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 5, null, { timeout: 15000 });
  assert(vault.has("files/notes (2).txt"), `${label}: duplicate name saved as "notes (2).txt"`);
  await p.screenshot({ path: SHOTS + `${label}-3-uploaded.png` });

  // preview text
  await p.locator(".file-main", { hasText: "notes.txt" }).first().click();
  await p.waitForSelector("#preview-body pre");
  assert((await p.textContent("#preview-body pre")).includes("Hello from DocSync"), `${label}: text preview works`);
  await p.keyboard.press("Escape");

  // preview image
  await p.locator(".file-main", { hasText: "passport-scan.png" }).click();
  await p.waitForSelector("#preview-body img");
  await p.screenshot({ path: SHOTS + `${label}-4-preview.png` });
  await p.click("#preview [data-close]");

  // preview docx -> fallback message
  await p.locator(".file-main", { hasText: "Lebenslauf" }).click();
  await p.waitForSelector("#preview-body .preview-msg");
  assert(true, `${label}: docx shows download fallback`);
  await p.click("#preview [data-close]");

  // download
  const [dl] = await Promise.all([p.waitForEvent("download"), p.locator(".file", { hasText: "notes (2).txt" }).getByLabel("Download").click()]);
  assert(dl.suggestedFilename() === "notes (2).txt", `${label}: download has right name`);

  // delete
  await p.locator(".file", { hasText: "notes (2).txt" }).getByLabel("Delete").click();
  await p.click("#confirm-ok");
  await p.waitForFunction(() => document.querySelectorAll(".file").length === 4);
  assert(!vault.has("files/notes (2).txt"), `${label}: delete works`);

  // reload: remembered device opens without password
  await p.reload();
  await p.waitForSelector("#app:not([hidden]) .file");
  assert(true, `${label}: remembered device skips lock screen`);

  // lock
  await p.click("#logout-btn");
  await p.waitForSelector("#lock:not([hidden])");
  assert(true, `${label}: lock button works`);

  // reset state for next round
  vault.delete("files/Offer Letter.pdf");
  await c.close();
}

await browser.close();
console.log("\nAll tests passed.");
