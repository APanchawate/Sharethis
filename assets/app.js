// app.js
// All the UI logic. Read top to bottom:
//   1. setup + storage helpers
//   2. lock screen (password / token)
//   3. file list: decorate -> search -> category -> sort -> render
//   4. upload: button, drop anywhere, files shared from other apps
//   5. preview, download, delete
//   6. "save from other apps" help (iOS Shortcut / Android install)
//   7. small helpers (toast, modal, formatting)

import config from "../config.js";
import { Vault } from "./github.js";
import { decryptToken } from "./crypto.js";
import { ALL_CATEGORIES, categorize, kindOf, searchFiles, sortFiles, thisDevice, formatDate } from "./organize.js";
import { cachedMeta, rememberMeta, resolveMeta } from "./meta.js";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "docsync.token";
const SORT_KEY = "docsync.sort";
const MAX_BYTES = (config.maxFileMB || 25) * 1024 * 1024;
const DEVICE = thisDevice();

let vault = null;      // Vault instance once unlocked
let token = null;      // decrypted token (needed for the iOS Shortcut help)
let files = [];        // raw list from GitHub: [{name, path, sha, size}]
let meta = {};         // path -> {date, device, via}
const view = { query: "", category: "all", sort: "newest" };

// ---------------------------------------------------------------------------
// 1. Token storage: localStorage if "remember this device", else session only
// ---------------------------------------------------------------------------
const store = {
  get: () => safe(() => localStorage.getItem(TOKEN_KEY)) || safe(() => sessionStorage.getItem(TOKEN_KEY)),
  set: (t, remember) => {
    safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t));
  },
  clear: () => {
    safe(() => localStorage.removeItem(TOKEN_KEY));
    safe(() => sessionStorage.removeItem(TOKEN_KEY));
  },
};
function safe(fn) { try { return fn(); } catch { return null; } }

function makeVault(t) {
  return new Vault({ owner: config.owner, repo: config.repo, folder: config.folder || "files", token: t });
}

// ---------------------------------------------------------------------------
// 2. Lock screen
// ---------------------------------------------------------------------------
function showLock(message = "") {
  vault = null;
  token = null;
  $("app").hidden = true;
  $("lock").hidden = false;
  const usePassword = !!config.encryptedToken;
  $("lock-input").placeholder = usePassword ? "Password" : "GitHub access token";
  $("lock-input").autocomplete = usePassword ? "current-password" : "off";
  $("lock-hint").textContent = usePassword
    ? "Enter your password to open your documents."
    : "Paste your GitHub access token to open your documents.";
  $("lock-error").textContent = message;
  $("lock-input").value = "";
  if (!config.owner) {
    $("lock-hint").textContent = "This site is not set up yet. Open setup.html to configure it (see docs/SETUP.md).";
    $("lock-form").hidden = true;
  }
  setTimeout(() => $("lock-input").focus(), 50);
}

$("lock-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const value = $("lock-input").value.trim();
  if (!value) return;
  const btn = $("lock-btn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Unlocking';
  $("lock-error").textContent = "";
  try {
    const t = config.encryptedToken ? await decryptToken(config.encryptedToken, value) : value;
    const v = makeVault(t);
    await v.check();
    store.set(t, $("remember").checked);
    openApp(v, t);
  } catch (err) {
    $("lock-error").textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock";
  }
});

$("logout-btn").addEventListener("click", () => {
  store.clear();
  showLock("Locked. This device no longer has access until you unlock again.");
});

function openApp(v, t) {
  vault = v;
  token = t;
  $("lock").hidden = true;
  $("app").hidden = false;
  loadFiles().then(uploadSharedFiles);
}

// ---------------------------------------------------------------------------
// 3. File list
// ---------------------------------------------------------------------------
async function loadFiles({ quiet = false } = {}) {
  if (!quiet && !files.length) $("loading").hidden = false;
  try {
    files = await vault.list();
    meta = cachedMeta();
    renderFiles();            // show right away with what we know
    meta = await resolveMeta(vault, files);
    renderFiles();            // then fill in dates and devices
  } catch (err) {
    handleError(err);
  } finally {
    $("loading").hidden = true;
  }
}

// Add category, date and device to each raw file
function decorate(f) {
  const m = meta[f.path] || {};
  return { ...f, date: m.date || null, device: m.device || null, via: m.via || null, category: categorize(f.name) };
}

function renderFiles() {
  const all = files.map(decorate);
  const found = searchFiles(all, view.query);
  renderChips(all, found);
  const shown = view.category === "all" ? found : found.filter((f) => f.category.id === view.category);
  const sorted = sortFiles(shown, view.sort);

  $("file-list").replaceChildren(...sorted.map(fileRow));
  $("empty").hidden = files.length > 0;
  $("no-results").hidden = !(files.length && !sorted.length);
  if (files.length && !sorted.length) {
    const cat = ALL_CATEGORIES.find((c) => c.id === view.category);
    $("no-results-text").textContent = view.query
      ? `Nothing matches "${view.query}"${cat ? ` in ${cat.label}` : ""}.`
      : `Nothing in ${cat?.label || "this category"}.`;
  }
}

// Category chips: only categories that have files; counts follow the search
function renderChips(all, found) {
  const present = ALL_CATEGORIES.filter((c) => all.some((f) => f.category.id === c.id));
  if (view.category !== "all" && !present.some((c) => c.id === view.category)) view.category = "all";
  const chip = (id, label, n) => {
    const b = el("button", "chip");
    b.type = "button";
    b.classList.toggle("on", view.category === id);
    b.classList.toggle("zero", n === 0 && view.category !== id);
    b.append(label, el("span", "n", String(n)));
    b.addEventListener("click", () => { view.category = id; renderFiles(); });
    return b;
  };
  const chips = [chip("all", "All", found.length)];
  if (present.length > 1) present.forEach((c) => chips.push(chip(c.id, c.label, found.filter((f) => f.category.id === c.id).length)));
  $("chips").replaceChildren(...chips);
  $("chips").hidden = !all.length;
}

function fileRow(f) {
  const kind = kindOf(f.name);
  const li = el("li", "file");

  const main = el("button", "file-main");
  main.type = "button";
  main.title = `Preview ${f.name}`;
  const icon = el("span", `file-icon ${kind.cls}`, kind.label);
  const text = el("span", "file-text");
  const metaLine = el("span", "file-meta truncate", [formatSize(f.size), f.device, formatDate(f.date)].filter(Boolean).join(" · "));
  if (f.via === "share") metaLine.append(" ", el("span", "tag", "shared"));
  text.append(el("span", "file-name truncate", f.name), metaLine);
  main.append(icon, text);
  main.addEventListener("click", () => preview(f));

  const actions = el("div", "file-actions");
  actions.append(
    iconButton("Download", '<path d="M12 4v12M6 10l6 6 6-6M4 20h16"/>', () => download(f)),
    iconButton("Delete", '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', () => askDelete(f))
  );

  li.append(main, actions);
  return li;
}

$("refresh-btn").addEventListener("click", () => loadFiles());

let searchTimer;
$("search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { view.query = e.target.value.trim(); renderFiles(); }, 120);
});
$("clear-search").addEventListener("click", () => {
  $("search").value = "";
  view.query = "";
  view.category = "all";
  renderFiles();
});

view.sort = safe(() => localStorage.getItem(SORT_KEY)) || "newest";
$("sort").value = view.sort;
$("sort").addEventListener("change", (e) => {
  view.sort = e.target.value;
  safe(() => localStorage.setItem(SORT_KEY, view.sort));
  renderFiles();
});

// ---------------------------------------------------------------------------
// 4. Upload. Three ways in: the button, dropping files anywhere on the page,
//    and files shared from other apps (Android share menu, see sw.js).
//    Files go one by one to avoid GitHub "409 conflict" errors.
// ---------------------------------------------------------------------------
$("file-input").addEventListener("change", (e) => {
  uploadAll([...e.target.files], "upload");
  e.target.value = ""; // allow picking the same file again
});

// Drop anywhere: show an overlay while files are dragged over the window
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e) || !vault) return;
  e.preventDefault();
  dragDepth++;
  $("drop-overlay").hidden = false;
});
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $("drop-overlay").hidden = true;
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("drop-overlay").hidden = true;
  if (vault) uploadAll([...(e.dataTransfer?.files || [])], "drop");
});

let uploading = Promise.resolve();
function uploadAll(list, via = "upload") {
  if (!vault || !list.length) return uploading;
  const rows = list.map((file) => {
    const li = el("li", "");
    li.append(el("span", "spinner"), el("span", "name truncate", file.name), el("span", "state muted", "Waiting"));
    $("queue").append(li);
    return { file, li };
  });
  // chain onto any upload already running
  uploading = uploading.then(async () => {
    let ok = 0;
    for (const { file, li } of rows) {
      const state = li.querySelector(".state");
      try {
        if (file.size > MAX_BYTES) throw new Error(`Too large (max ${config.maxFileMB || 25} MB)`);
        state.textContent = "Uploading";
        const name = cleanName(file.name);
        const base64 = await readBase64(file);
        const saved = await vault.upload(name, base64, `${DEVICE}, ${via}`);
        rememberMeta(saved.path, saved.sha, { date: new Date().toISOString(), device: DEVICE, via });
        li.className = "ok";
        li.querySelector(".spinner").remove();
        state.textContent = saved.name === name ? "Done" : `Saved as ${saved.name}`;
        ok++;
        setTimeout(() => li.remove(), 4000);
      } catch (err) {
        li.className = "fail";
        li.querySelector(".spinner")?.remove();
        state.textContent = friendlyError(err);
        if (err.status === 401) return handleError(err);
        setTimeout(() => li.remove(), 10000);
      }
    }
    if (ok) {
      toast(`${ok} file${ok > 1 ? "s" : ""} uploaded`);
      await loadFiles({ quiet: true });
    }
  });
  return uploading;
}

function readBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] || "");
    r.onerror = () => reject(new Error("Could not read file"));
    r.readAsDataURL(file);
  });
}

// Remove characters that break paths or look odd in a repo
function cleanName(name) {
  const n = name.replace(/[\/\\\u0000-\u001f]/g, "_").replace(/^\.+/, "").trim();
  return n || `file-${Date.now()}`;
}

// Files shared from another Android app are parked by sw.js in a cache
// called "docsync-share". Pick them up and upload them.
const SHARE_CACHE = "docsync-share";

async function takeSharedFiles() {
  if (!("caches" in window)) return [];
  try {
    const cache = await caches.open(SHARE_CACHE);
    const out = [];
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      const blob = await res.blob();
      out.push(new File([blob], decodeURIComponent(res.headers.get("x-name") || "shared-file"), { type: blob.type }));
      await cache.delete(req);
    }
    return out;
  } catch {
    return [];
  }
}

async function countSharedFiles() {
  try { return "caches" in window ? (await (await caches.open(SHARE_CACHE)).keys()).length : 0; } catch { return 0; }
}

async function uploadSharedFiles() {
  const shared = await takeSharedFiles();
  if (location.search.includes("shared")) history.replaceState(null, "", location.pathname);
  if (shared.length) await uploadAll(shared, "share");
}

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => { /* not critical */ });
}

// ---------------------------------------------------------------------------
// 5. Preview, download, delete
// ---------------------------------------------------------------------------
let previewUrl = null;

async function preview(f) {
  const kind = kindOf(f.name);
  $("preview-title").textContent = f.name;
  const body = $("preview-body");
  body.replaceChildren(loadingEl());
  $("preview-open").hidden = true;
  $("preview-download").hidden = true;
  openModal("preview");

  try {
    const blob = await vault.download(f.path);
    if ($("preview").hidden) return; // closed while loading
    const typed = new Blob([blob], { type: kind.mime });
    previewUrl = URL.createObjectURL(typed);

    const open = $("preview-open");
    open.href = previewUrl;
    open.hidden = false;
    const dl = $("preview-download");
    dl.href = previewUrl;
    dl.download = f.name;
    dl.hidden = false;

    if (kind.view === "image") {
      const img = new Image();
      img.alt = f.name;
      img.src = previewUrl;
      body.replaceChildren(img);
    } else if (kind.view === "pdf" && navigator.pdfViewerEnabled !== false && !isAndroid()) {
      const frame = document.createElement("iframe");
      frame.title = f.name;
      frame.src = previewUrl;
      body.replaceChildren(frame);
    } else if (kind.view === "text") {
      body.replaceChildren(el("pre", "", await typed.text()));
    } else {
      // Word, Excel, zip, PDFs on Android, etc.: browser cannot show inline
      const msg = el("div", "preview-msg");
      msg.append(el("p", "", "This file type can't be previewed here."));
      const a = el("a", "btn btn-primary", kind.view === "pdf" ? "Open PDF" : "Download");
      a.href = previewUrl;
      if (kind.view === "pdf") a.target = "_blank";
      else a.download = f.name;
      msg.append(a);
      body.replaceChildren(msg);
    }
  } catch (err) {
    body.replaceChildren(el("div", "preview-msg", friendlyError(err)));
    if (err.status === 401) handleError(err);
  }
}

function closePreview() {
  $("preview-body").replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

async function download(f) {
  try {
    toast(`Downloading ${f.name}…`);
    const blob = await vault.download(f.path);
    const url = URL.createObjectURL(new Blob([blob], { type: kindOf(f.name).mime }));
    const a = el("a", "");
    a.href = url;
    a.download = f.name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    handleError(err);
  }
}

function askDelete(f) {
  $("confirm-text").textContent = `Delete "${f.name}" from all devices?`;
  openModal("confirm");
  $("confirm-ok").onclick = async () => {
    closeModal("confirm");
    try {
      await vault.remove(f.path, f.sha, DEVICE);
      files = files.filter((x) => x.path !== f.path);
      renderFiles();
      toast("Deleted");
    } catch (err) {
      handleError(err);
      loadFiles({ quiet: true });
    }
  };
}

// ---------------------------------------------------------------------------
// 6. "Save from other apps" help
// ---------------------------------------------------------------------------
function openShareHelp() {
  const isApple = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
  showTab(/Android/.test(navigator.userAgent) ? "android" : isApple ? "ios" : "ios");
  $("sc-url").value = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${config.folder || "files"}/`;
  $("sc-auth").value = "Bearer ••••••••••••";
  openModal("share-help");
}
function showTab(id) {
  document.querySelectorAll("#share-help .tab").forEach((t) => t.classList.toggle("on", t.dataset.tab === id));
  document.querySelectorAll("#share-help .tab-panel").forEach((p) => (p.hidden = p.dataset.panel !== id));
}
document.querySelectorAll("#share-help .tab").forEach((t) => t.addEventListener("click", () => showTab(t.dataset.tab)));
$("share-help-btn").addEventListener("click", openShareHelp);
$("share-help-link").addEventListener("click", openShareHelp);
$("sc-auth-copy").addEventListener("click", () => copyText(`Bearer ${token}`, $("sc-auth-copy")));
document.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", () => copyText($(b.dataset.copy).value, b)));

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = el("textarea", "");
    t.value = text;
    document.body.append(t);
    t.select();
    safe(() => document.execCommand("copy"));
    t.remove();
  }
  button.textContent = "Copied";
  setTimeout(() => (button.textContent = "Copy"), 2000);
}

// ---------------------------------------------------------------------------
// 7. Helpers
// ---------------------------------------------------------------------------
function openModal(id) { $(id).hidden = false; }
function closeModal(id) {
  $(id).hidden = true;
  if (id === "preview") closePreview();
}
document.querySelectorAll(".modal").forEach((m) => {
  m.addEventListener("click", (e) => {
    if (e.target === m || e.target.closest("[data-close]")) closeModal(m.id);
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") document.querySelectorAll(".modal:not([hidden])").forEach((m) => closeModal(m.id));
  // "/" jumps to search, like on GitHub
  if (e.key === "/" && vault && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); $("search").focus(); }
});

let toastTimer;
function toast(text, isError = false) {
  const t = $("toast");
  t.textContent = text;
  t.className = isError ? "toast err" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), isError ? 6000 : 3000);
}

function handleError(err) {
  if (err.status === 401) {
    store.clear();
    showLock("Your access token expired or was revoked. Unlock again (or create a new token, see docs/SETUP.md).");
  } else {
    toast(friendlyError(err), true);
  }
}

function friendlyError(err) {
  if (err.message === "Wrong password") return "Wrong password.";
  switch (err.status) {
    case 401: return "Token not valid (expired or revoked).";
    case 403: return "Access denied. Check the token has Contents read/write on the vault repo.";
    case 404: return `Vault repo "${config.owner}/${config.repo}" not found, or the token can't see it.`;
    case 409: return "GitHub was busy, please retry.";
    case 413: return "File too large for GitHub.";
    case 422: return err.message || "GitHub rejected the request.";
  }
  if (err instanceof TypeError) return "Network error. Check your connection.";
  return err.message || "Something went wrong.";
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function iconButton(label, path, onClick) {
  const b = el("button", "icon-btn");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = `<svg viewBox="0 0 24 24">${path}</svg>`;
  b.addEventListener("click", onClick);
  return b;
}

function loadingEl() {
  const d = el("div", "loading");
  d.append(el("span", "spinner"), document.createTextNode(" Loading…"));
  return d;
}

function formatSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 ** 2) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 ** 2).toFixed(1)} MB`;
}

const isAndroid = () => /android/i.test(navigator.userAgent);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const saved = store.get();
if (saved && config.owner) {
  openApp(makeVault(saved), saved);
} else {
  showLock();
  // Files shared while locked wait in the cache until unlock
  countSharedFiles().then((n) => {
    if (!n) return;
    $("lock-pending").textContent = `${n} shared file${n > 1 ? "s" : ""} waiting. Unlock to save ${n > 1 ? "them" : "it"}.`;
    $("lock-pending").hidden = false;
  });
}
