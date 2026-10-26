// app.js
// All the UI logic. Read top to bottom:
//   1. setup + storage helpers
//   2. lock screen (password / token)
//   3. file list: decorate -> search -> category -> sort -> render
//   4. upload: button, drop anywhere, paste; skips exact duplicates
//   5. file actions: preview, favourite, copy, send to app, download, rename, delete (+ undo)
//   6. actions menu (the ⋯ button)
//   7. small helpers (toast, modal, formatting)

import config from "../config.js";
import { Vault } from "./github.js";
import { decryptToken } from "./crypto.js";
import { ALL_CATEGORIES, categorize, kindOf, extOf, canPreview, searchFiles, sortFiles, thisDevice, formatDate } from "./organize.js";
import { cachedMeta, rememberMeta, resolveMeta } from "./meta.js";
import { SharedState, clearLocalState } from "./state.js";
import { getBlob, prefetch, isReady, readyBlob, rememberBlob, clearBlobs, gitBlobSha } from "./blobs.js";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "docsync.token";
const SORT_KEY = "docsync.sort";
const LIST_KEY = "docsync.list.v1";
const MAX_BYTES = (config.maxFileMB || 25) * 1024 * 1024;
const DEVICE = thisDevice();

let vault = null;      // Vault instance once unlocked
let state = null;      // SharedState (favourites), synced through the vault
let files = [];        // raw list from GitHub: [{name, path, sha, size}]
let meta = {};         // path -> {date, device, via}
const view = { query: "", category: "all", sort: "newest" };

// ---------------------------------------------------------------------------
// 1. Local storage helpers. Everything is wrapped: private mode can throw.
// ---------------------------------------------------------------------------
function safe(fn) { try { return fn(); } catch { return null; } }
const local = {
  get: (k) => safe(() => localStorage.getItem(k)),
  set: (k, v) => safe(() => localStorage.setItem(k, v)),
  del: (k) => safe(() => localStorage.removeItem(k)),
};
const tokenStore = {
  get: () => local.get(TOKEN_KEY) || safe(() => sessionStorage.getItem(TOKEN_KEY)),
  set: (t, remember) => safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, t)),
  clear: () => { local.del(TOKEN_KEY); safe(() => sessionStorage.removeItem(TOKEN_KEY)); },
};

function makeVault(t) {
  return new Vault({ owner: config.owner, repo: config.repo, folder: config.folder || "files", token: t });
}

// ---------------------------------------------------------------------------
// 2. Lock screen
// ---------------------------------------------------------------------------
function showLock(message = "") {
  vault = null;
  state = null;
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
    tokenStore.set(t, $("remember").checked);
    openApp(v);
  } catch (err) {
    $("lock-error").textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Unlock";
  }
});

// Lock: forget the token AND everything cached on this device
$("logout-btn").addEventListener("click", async () => {
  tokenStore.clear();
  local.del(LIST_KEY);
  clearLocalState();
  await clearBlobs();
  files = [];
  showLock("Locked. Nothing from your documents is left on this device.");
});

function openApp(v) {
  vault = v;
  state = new SharedState(v);
  $("lock").hidden = true;
  $("app").hidden = false;
  // Instant start: draw the last known list right away, then refresh
  const cached = safe(() => JSON.parse(local.get(LIST_KEY)));
  if (Array.isArray(cached) && cached.length) {
    files = cached;
    meta = cachedMeta();
    renderFiles();
  }
  loadFiles();
}

// ---------------------------------------------------------------------------
// 3. File list
// ---------------------------------------------------------------------------
async function loadFiles({ quiet = false } = {}) {
  if (!quiet && !files.length) $("loading").hidden = false;
  try {
    const [list] = await Promise.all([vault.list(), state.load().catch(() => null)]);
    files = list;
    local.set(LIST_KEY, JSON.stringify(files));
    meta = cachedMeta();
    renderFiles();            // show right away with what we know
    meta = await resolveMeta(vault, files);
    renderFiles();            // then fill in dates and devices
    warmFavourites();
  } catch (err) {
    handleError(err);
  } finally {
    $("loading").hidden = true;
  }
}

// Favourites are what you open most, so fetch small ones in the background
function warmFavourites() {
  files.filter((f) => state.isFavorite(f.path) && f.size < 5e6).slice(0, 10).forEach((f) => prefetch(vault, f));
}

// Add category, date, device and favourite flag to each raw file
function decorate(f) {
  const m = meta[f.path] || {};
  return { ...f, date: m.date || null, device: m.device || null, via: m.via || null, category: categorize(f.name), fav: !!state?.isFavorite(f.path) };
}

function renderFiles() {
  const all = files.map(decorate);
  const found = searchFiles(all, view.query);
  renderChips(all, found);
  let shown = found;
  if (view.category === "fav") shown = found.filter((f) => f.fav);
  else if (view.category !== "all") shown = found.filter((f) => f.category.id === view.category);
  const sorted = sortFiles(shown, view.sort);
  // favourites stay on top, in the chosen order
  const ordered = [...sorted.filter((f) => f.fav), ...sorted.filter((f) => !f.fav)];

  $("file-list").replaceChildren(...ordered.map(fileRow));
  $("empty").hidden = files.length > 0;
  const none = files.length && !ordered.length;
  $("no-results").hidden = !none;
  if (none) {
    const label = view.category === "fav" ? "Favourites" : ALL_CATEGORIES.find((c) => c.id === view.category)?.label;
    $("no-results-text").textContent = view.query
      ? `Nothing matches "${view.query}"${label ? ` in ${label}` : ""}.`
      : view.category === "fav" ? "No favourites yet. Tap the heart on a document." : `Nothing in ${label || "this category"}.`;
  }
}

// Chips: All, Favourites (if any), then categories that have files.
// Counts follow the current search.
function renderChips(all, found) {
  const present = ALL_CATEGORIES.filter((c) => all.some((f) => f.category.id === c.id));
  const hasFav = all.some((f) => f.fav);
  if (view.category === "fav" && !hasFav) view.category = "all";
  if (!["all", "fav"].includes(view.category) && !present.some((c) => c.id === view.category)) view.category = "all";
  const chip = (id, label, n, cls = "") => {
    const b = el("button", `chip ${cls}`);
    b.type = "button";
    b.classList.toggle("on", view.category === id);
    b.classList.toggle("zero", n === 0 && view.category !== id);
    b.append(label, el("span", "n", String(n)));
    b.addEventListener("click", () => { view.category = id; renderFiles(); });
    return b;
  };
  const chips = [chip("all", "All", found.length)];
  if (hasFav) chips.push(chip("fav", "♥ Favourites", found.filter((f) => f.fav).length, "chip-fav"));
  if (present.length > 1) present.forEach((c) => chips.push(chip(c.id, c.label, found.filter((f) => f.category.id === c.id).length)));
  $("chips").replaceChildren(...chips);
  $("chips").hidden = !all.length;
}

const HEART = '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>';
const DOTS = '<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>';

function fileRow(f) {
  const kind = kindOf(f.name);
  const li = el("li", "file");
  li.dataset.path = f.path;

  const main = el("button", "file-main");
  main.type = "button";
  const previewable = canPreview(f.name);
  main.title = previewable ? `Preview ${f.name}` : `Options for ${f.name}`;
  const icon = el("span", `file-icon ${kind.cls}`, kind.label);
  const text = el("span", "file-text");
  const metaLine = el("span", "file-meta truncate", [formatSize(f.size), f.device, formatDate(f.date)].filter(Boolean).join(" · "));
  if (f.via === "share") metaLine.append(" ", el("span", "tag", "shared"));
  text.append(el("span", "file-name truncate", f.name), metaLine);
  main.append(icon, text);
  // Supported files open the preview; everything else opens the actions menu
  main.addEventListener("click", () => (previewable ? preview(f) : openMenu(f, main)));

  // Start downloading as soon as the pointer/finger lands, so the click is instant
  if (previewable) {
    const warm = () => prefetch(vault, f);
    li.addEventListener("pointerenter", warm, { once: true });
    li.addEventListener("touchstart", warm, { once: true, passive: true });
  }

  const actions = el("div", "file-actions");
  const heart = iconButton(f.fav ? "Remove from favourites" : "Add to favourites", HEART, () => toggleFavorite(f));
  heart.classList.add("heart");
  heart.setAttribute("aria-pressed", String(f.fav));
  const more = iconButton("More options", DOTS, (e) => openMenu(f, e.currentTarget));
  more.classList.add("more");
  actions.append(heart, more);

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

view.sort = local.get(SORT_KEY) || "newest";
$("sort").value = view.sort;
$("sort").addEventListener("change", (e) => {
  view.sort = e.target.value;
  local.set(SORT_KEY, view.sort);
  renderFiles();
});

// ---------------------------------------------------------------------------
// 4. Upload. Three ways in: the button, dropping files anywhere, pasting.
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

// Paste: a screenshot or files copied in Finder / Explorer upload directly
document.addEventListener("paste", (e) => {
  if (!vault || /INPUT|TEXTAREA/.test(document.activeElement?.tagName)) return;
  const pasted = [...(e.clipboardData?.files || [])].map((f) =>
    // pasted screenshots are all called "image.png": give them a useful name
    f.name === "image.png" ? new File([f], `Screenshot ${new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", ".")}.png`, { type: f.type }) : f
  );
  if (pasted.length) { e.preventDefault(); uploadAll(pasted, "paste"); }
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
      const state_ = li.querySelector(".state");
      const finish = (cls, text, ms) => {
        li.className = cls;
        li.querySelector(".spinner")?.remove();
        state_.textContent = text;
        setTimeout(() => li.remove(), ms);
      };
      try {
        if (file.size > MAX_BYTES) throw new Error(`Too large (max ${config.maxFileMB || 25} MB)`);
        // Same bytes already in the vault? Don't store it twice.
        const sha = await gitBlobSha(file);
        const twin = files.find((f) => f.sha === sha);
        if (twin) { finish("ok", `Already saved as ${twin.name}`, 6000); continue; }

        state_.textContent = "Uploading";
        const name = cleanName(file.name);
        const base64 = await readBase64(file);
        const saved = await vault.upload(name, base64, `${DEVICE}, ${via}`);
        rememberMeta(saved.path, saved.sha, { date: new Date().toISOString(), device: DEVICE, via });
        rememberBlob(saved.sha || sha, file);
        finish("ok", saved.name === name ? "Done" : `Saved as ${saved.name}`, 4000);
        ok++;
      } catch (err) {
        finish("fail", friendlyError(err), 10000);
        if (err.status === 401) return handleError(err);
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

// ---------------------------------------------------------------------------
// 5. File actions
// ---------------------------------------------------------------------------
const current = (path) => files.map(decorate).find((f) => f.path === path);

// ----- Preview (only for types this browser can show) -----
let previewUrl = null;
let previewing = null;

async function preview(f) {
  previewing = f.path;
  const kind = kindOf(f.name);
  $("preview-title").textContent = f.name;
  syncPreviewHeart();
  $("preview-copy").hidden = !copyKind(f);
  $("preview-share").hidden = !canShareFiles();
  const body = $("preview-body");
  // cached bytes render with no spinner at all
  if (!isReady(f)) body.replaceChildren(loadingEl());
  openModal("preview");

  try {
    const blob = await getBlob(vault, f);
    if ($("preview").hidden || previewing !== f.path) return; // closed or switched while loading
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(new Blob([blob], { type: kind.mime }));

    if (kind.view === "image") {
      const img = new Image();
      img.alt = f.name;
      img.decoding = "async";
      img.src = previewUrl;
      body.replaceChildren(img);
    } else if (kind.view === "pdf") {
      const frame = document.createElement("iframe");
      frame.title = f.name;
      frame.src = previewUrl;
      body.replaceChildren(frame);
    } else {
      body.replaceChildren(el("pre", "", await blob.text()));
    }
  } catch (err) {
    body.replaceChildren(el("div", "preview-msg", friendlyError(err)));
    if (err.status === 401) handleError(err);
  }
}

function syncPreviewHeart() {
  const on = !!state?.isFavorite(previewing);
  $("preview-fav").setAttribute("aria-pressed", String(on));
  $("preview-fav").title = on ? "Remove from favourites" : "Add to favourites";
}

function closePreview() {
  previewing = null;
  $("preview-body").replaceChildren();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}

$("preview-fav").addEventListener("click", () => { const f = current(previewing); if (f) toggleFavorite(f); syncPreviewHeart(); });
$("preview-copy").addEventListener("click", () => { const f = current(previewing); if (f) copyFile(f); });
$("preview-share").addEventListener("click", () => { const f = current(previewing); if (f) shareFile(f); });
$("preview-download").addEventListener("click", () => { const f = current(previewing); if (f) download(f); });

// ----- Favourite (synced to every device through .app/state.json) -----
function toggleFavorite(f) {
  const on = !state.isFavorite(f.path);
  state.toggleFavorite(f.path).catch(handleError);
  renderFiles();
  toast(on ? "Added to favourites" : "Removed from favourites");
}

// ----- Copy to clipboard -----
// Browsers only allow images and text on the clipboard, not PDFs or Word
// files. For those, "Send to an app" is the way to hand the file over.
function copyKind(f) {
  if (!window.ClipboardItem || !navigator.clipboard?.write) return null;
  const { view } = kindOf(f.name);
  if (view === "text") return "text";
  if (view === "image" && !["svg", "heic"].includes(extOf(f.name))) return "image";
  return null;
}

async function copyFile(f) {
  const kind = copyKind(f);
  if (!kind) return toast("This file type can't go on the clipboard. Use Send to an app or Download.", true);
  // The ClipboardItem must be created inside the tap, with the data as a promise
  const data = getBlob(vault, f);
  const item = kind === "text"
    ? new ClipboardItem({ "text/plain": data.then((b) => new Blob([b], { type: "text/plain" })) })
    : new ClipboardItem({ "image/png": data.then(toPng) });
  try {
    await navigator.clipboard.write([item]);
    toast(kind === "text" ? "Text copied" : "Image copied. Paste it anywhere.");
  } catch {
    toast("Your browser blocked the copy. Try again, or use Download.", true);
  }
}

// Clipboards accept PNG only, so other image types are redrawn as PNG
async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return new Promise((res) => c.toBlob(res, "image/png"));
}

// ----- Send to an app (system share sheet: WhatsApp, Mail, AirDrop ...) -----
function canShareFiles() {
  return !!navigator.canShare && safe(() => navigator.canShare({ files: [new File(["x"], "x.pdf", { type: "application/pdf" })] }));
}

async function shareFile(f) {
  // The share sheet must open within the tap, so the bytes need to be ready.
  if (!isReady(f)) {
    toast("Getting the file ready…");
    await getBlob(vault, f).catch(handleError);
  }
  const blob = readyBlob(f);
  if (!blob) return;
  const file = new File([blob], f.name, { type: kindOf(f.name).mime });
  try {
    await navigator.share({ files: [file], title: f.name });
  } catch (err) {
    if (err.name === "NotAllowedError") toast("File is ready. Tap Send again.");
    else if (err.name !== "AbortError") toast("Couldn't open the share menu.", true);
  }
}

// ----- Download -----
async function download(f) {
  try {
    if (!isReady(f)) toast(`Downloading ${f.name}…`);
    const blob = await getBlob(vault, f);
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

// ----- Rename (one commit, no re-upload, keeps origin and favourite) -----
let renaming = null;
function askRename(f) {
  renaming = f;
  const input = $("rename-input");
  input.value = f.name;
  $("rename-error").textContent = "";
  openModal("rename");
  // select the name without the extension, like Finder / Explorer
  const dot = f.name.lastIndexOf(".");
  setTimeout(() => { input.focus(); input.setSelectionRange(0, dot > 0 ? dot : f.name.length); }, 30);
}

$("rename-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = renaming;
  let name = cleanName($("rename-input").value.trim());
  // keep the extension if it was removed by accident
  const oldExt = extOf(f.name);
  if (oldExt && !extOf(name)) name = `${name}.${oldExt}`;
  if (name === f.name) return closeModal("rename");
  if (files.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.path !== f.path)) {
    $("rename-error").textContent = `"${name}" already exists.`;
    return;
  }
  const btn = $("rename-ok");
  btn.disabled = true;
  try {
    const saved = await vault.rename(f.path, f.sha, name, DEVICE);
    if (meta[f.path]) rememberMeta(saved.path, saved.sha, { date: meta[f.path].date, device: meta[f.path].device, via: meta[f.path].via });
    state.renamePath(f.path, saved.path).catch(() => {});
    files = files.map((x) => (x.path === f.path ? { ...x, name: saved.name, path: saved.path } : x));
    meta = cachedMeta();
    renderFiles();
    closeModal("rename");
    toast(`Renamed to ${saved.name}`);
  } catch (err) {
    $("rename-error").textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

// ----- Delete, with Undo -----
function askDelete(f) {
  $("confirm-text").textContent = `Delete "${f.name}" from all devices?`;
  openModal("confirm");
  $("confirm-ok").onclick = async () => {
    closeModal("confirm");
    const wasFav = state.isFavorite(f.path);
    const m = meta[f.path];
    try {
      await vault.remove(f.path, f.sha, DEVICE);
      files = files.filter((x) => x.path !== f.path);
      state.forgetPath(f.path).catch(() => {});
      renderFiles();
      toast(`Deleted ${f.name}`, false, { label: "Undo", run: () => undoDelete(f, wasFav, m) });
    } catch (err) {
      handleError(err);
      loadFiles({ quiet: true });
    }
  };
}

// git still has the file's bytes, so undo just points the path back at them
async function undoDelete(f, wasFav, m) {
  try {
    await vault.restore(f.path, f.sha, m ? `${m.device || DEVICE}, ${m.via || "upload"}` : `${DEVICE}, restore`);
    if (m) rememberMeta(f.path, f.sha, m);
    if (wasFav) state.toggleFavorite(f.path).catch(() => {});
    toast(`Restored ${f.name}`);
    await loadFiles({ quiet: true });
  } catch (err) {
    handleError(err);
  }
}

// ---------------------------------------------------------------------------
// 6. Actions menu (⋯). Shows only what works for this file on this device.
// ---------------------------------------------------------------------------
let menuFile = null;
function openMenu(f, anchor) {
  menuFile = f;
  const menu = $("menu");
  $("menu-title").textContent = f.name;
  const show = {
    preview: canPreview(f.name),
    favorite: true,
    copy: !!copyKind(f),
    share: canShareFiles(),
    download: true,
    rename: true,
    delete: true,
  };
  menu.querySelectorAll("[data-act]").forEach((b) => (b.hidden = !show[b.dataset.act]));
  menu.querySelector('[data-act="favorite"] span').textContent = f.fav ? "Remove from favourites" : "Add to favourites";
  if (show.share || show.copy) prefetch(vault, f); // so Send/Copy work on the first tap

  menu.hidden = false;
  $("menu-backdrop").hidden = false;
  // Phones: bottom sheet (CSS). Larger screens: next to the button.
  if (matchMedia("(min-width: 601px)").matches) {
    const r = anchor.getBoundingClientRect();
    const h = menu.offsetHeight, w = menu.offsetWidth;
    const top = r.bottom + 4 + h > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4;
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8))}px`;
  } else {
    menu.style.top = menu.style.left = "";
  }
  menu.querySelector("button:not([hidden])")?.focus({ preventScroll: true });
}
function closeMenu() {
  $("menu").hidden = true;
  $("menu-backdrop").hidden = true;
}
$("menu-backdrop").addEventListener("click", closeMenu);
$("menu").addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !menuFile) return;
  const f = menuFile;
  closeMenu();
  ({
    preview: () => preview(f),
    favorite: () => toggleFavorite(f),
    copy: () => copyFile(f),
    share: () => shareFile(f),
    download: () => download(f),
    rename: () => askRename(f),
    delete: () => askDelete(f),
  })[b.dataset.act]();
});
window.addEventListener("resize", closeMenu);

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
  if (e.key === "Escape") {
    closeMenu();
    document.querySelectorAll(".modal:not([hidden])").forEach((m) => closeModal(m.id));
  }
  // "/" jumps to search, like on GitHub
  if (e.key === "/" && vault && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName)) { e.preventDefault(); $("search").focus(); }
});

let toastTimer;
/** toast("Saved") or toast("Deleted x", false, {label: "Undo", run}) */
function toast(text, isError = false, action = null) {
  const t = $("toast");
  $("toast-text").textContent = text;
  const btn = $("toast-action");
  btn.hidden = !action;
  if (action) {
    btn.textContent = action.label;
    btn.onclick = () => { t.hidden = true; action.run(); };
  }
  t.className = isError ? "toast err" : "toast";
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), action ? 8000 : isError ? 6000 : 3000);
}

function handleError(err) {
  if (err?.status === 401) {
    tokenStore.clear();
    showLock("Your access token expired or was revoked. Unlock again (or create a new token, see docs/SETUP.md).");
  } else {
    toast(friendlyError(err), true);
  }
}

function friendlyError(err) {
  if (err.message === "Wrong password") return "Wrong password.";
  if (err.rateLimited) {
    const mins = err.resetAt ? Math.max(1, Math.ceil((err.resetAt - Date.now()) / 60000)) : null;
    return `GitHub's hourly limit is reached. Try again${mins ? ` in ${mins} min` : " later"}.`;
  }
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

// Offline notice + a safety net so no error ever fails silently
const syncOnline = () => ($("offline").hidden = navigator.onLine);
window.addEventListener("online", () => { syncOnline(); if (vault) loadFiles({ quiet: true }); });
window.addEventListener("offline", syncOnline);
syncOnline();
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  if (vault) toast(friendlyError(e.reason || {}), true);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const savedToken = tokenStore.get();
if (savedToken && config.owner) openApp(makeVault(savedToken));
else showLock();
