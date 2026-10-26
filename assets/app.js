// app.js
// All the UI logic. Read top to bottom:
//   1. setup + storage helpers
//   2. lock screen (password / token)
//   3. file list
//   4. upload
//   5. preview, download, delete
//   6. small helpers (toast, modal, formatting)

import config from "../config.js";
import { Vault } from "./github.js";
import { decryptToken } from "./crypto.js";

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = "docsync.token";
const MAX_BYTES = (config.maxFileMB || 25) * 1024 * 1024;

let vault = null;   // Vault instance once unlocked
let files = [];     // current file list

// ---------------------------------------------------------------------------
// 1. Token storage: localStorage if "remember this device", else session only
// ---------------------------------------------------------------------------
const store = {
  get: () => safe(() => localStorage.getItem(TOKEN_KEY)) || safe(() => sessionStorage.getItem(TOKEN_KEY)),
  set: (token, remember) => {
    safe(() => (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token));
  },
  clear: () => {
    safe(() => localStorage.removeItem(TOKEN_KEY));
    safe(() => sessionStorage.removeItem(TOKEN_KEY));
  },
};
function safe(fn) { try { return fn(); } catch { return null; } }

function makeVault(token) {
  return new Vault({ owner: config.owner, repo: config.repo, folder: config.folder || "files", token });
}

// ---------------------------------------------------------------------------
// 2. Lock screen
// ---------------------------------------------------------------------------
function showLock(message = "") {
  vault = null;
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
    const token = config.encryptedToken ? await decryptToken(config.encryptedToken, value) : value;
    const v = makeVault(token);
    await v.check();
    store.set(token, $("remember").checked);
    openApp(v);
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

function openApp(v) {
  vault = v;
  $("lock").hidden = true;
  $("app").hidden = false;
  loadFiles();
}

// ---------------------------------------------------------------------------
// 3. File list
// ---------------------------------------------------------------------------
async function loadFiles({ quiet = false } = {}) {
  if (!quiet) $("loading").hidden = false;
  try {
    files = await vault.list();
    renderFiles();
  } catch (err) {
    handleError(err);
  } finally {
    $("loading").hidden = true;
  }
}

function renderFiles() {
  const list = $("file-list");
  list.replaceChildren(...files.map(fileRow));
  $("empty").hidden = files.length > 0;
  $("count").textContent = files.length ? `(${files.length})` : "";
}

function fileRow(f) {
  const kind = kindOf(f.name);
  const li = el("li", "file");

  const main = el("button", "file-main");
  main.type = "button";
  main.title = `Preview ${f.name}`;
  const icon = el("span", `file-icon ${kind.cls}`, kind.label);
  const text = el("span", "file-text");
  text.append(el("span", "file-name truncate", f.name), el("span", "file-meta", formatSize(f.size)));
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

// ---------------------------------------------------------------------------
// 4. Upload (button, drag and drop). Files go one by one to avoid
//    GitHub "409 conflict" errors from parallel commits.
// ---------------------------------------------------------------------------
$("file-input").addEventListener("change", (e) => {
  uploadAll([...e.target.files]);
  e.target.value = ""; // allow picking the same file again
});

const dz = $("dropzone");
["dragenter", "dragover"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((t) => dz.addEventListener(t, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => uploadAll([...(e.dataTransfer?.files || [])]));
// Stop the browser from opening a file dropped outside the zone
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

let uploading = Promise.resolve();
function uploadAll(list) {
  if (!vault || !list.length) return;
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
        const finalName = await vault.upload(name, base64);
        li.className = "ok";
        li.querySelector(".spinner").remove();
        state.textContent = finalName === name ? "Done" : `Saved as ${finalName}`;
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
      await vault.remove(f.path, f.sha);
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
// 6. Helpers
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

// File type table: icon label, colour class, MIME type, how to preview
const TYPES = {
  pdf:  ["PDF", "pdf", "application/pdf", "pdf"],
  png:  ["PNG", "img", "image/png", "image"],
  jpg:  ["JPG", "img", "image/jpeg", "image"],
  jpeg: ["JPG", "img", "image/jpeg", "image"],
  gif:  ["GIF", "img", "image/gif", "image"],
  webp: ["WEBP", "img", "image/webp", "image"],
  svg:  ["SVG", "img", "image/svg+xml", "image"],
  heic: ["HEIC", "img", "image/heic", "image"],
  txt:  ["TXT", "", "text/plain", "text"],
  md:   ["MD", "", "text/plain", "text"],
  csv:  ["CSV", "sheet", "text/plain", "text"],
  json: ["JSON", "", "text/plain", "text"],
  xml:  ["XML", "", "text/plain", "text"],
  log:  ["LOG", "", "text/plain", "text"],
  doc:  ["DOC", "doc", "application/msword", "none"],
  docx: ["DOCX", "doc", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "none"],
  xls:  ["XLS", "sheet", "application/vnd.ms-excel", "none"],
  xlsx: ["XLSX", "sheet", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "none"],
  ppt:  ["PPT", "", "application/vnd.ms-powerpoint", "none"],
  pptx: ["PPTX", "", "application/vnd.openxmlformats-officedocument.presentationml.presentation", "none"],
  zip:  ["ZIP", "", "application/zip", "none"],
};
function kindOf(name) {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const t = TYPES[ext];
  if (!t) return { label: (ext || "FILE").slice(0, 4).toUpperCase(), cls: "", mime: "application/octet-stream", view: "none" };
  return { label: t[0], cls: t[1], mime: t[2], view: t[3] };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const saved = store.get();
if (saved && config.owner) openApp(makeVault(saved));
else showLock();
