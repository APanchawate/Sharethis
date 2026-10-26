// state.js
// Small shared state that must sync across devices: currently the list of
// favourite files. Stored as JSON in the vault repo at STATE_PATH (outside
// the documents folder, so it never shows up as a document):
//
//   { "version": 1, "favorites": ["files/CV.pdf", "files/Passport.png"] }
//
// Every change is an "operation" (a function that edits the state). It is
// applied locally at once (so the heart fills instantly), then saved. If
// another device saved in between (GitHub answers 409/422), we re-read the
// file, apply the same operation again and retry. That way two devices can
// favourite different files at the same time without losing either.

const STATE_PATH = ".app/state.json";
const STATE_CACHE = "docsync.state.v1";

const empty = () => ({ version: 1, favorites: [] });

export class SharedState {
  constructor(vault) {
    this.vault = vault;
    this.sha = null;
    this.data = readLocal() || empty();
    this.queue = Promise.resolve();
  }

  /** Fetch the latest from GitHub. */
  async load() {
    const { data, sha } = await this.vault.readJSON(STATE_PATH);
    this.data = { ...empty(), ...(data || {}) };
    this.sha = sha;
    writeLocal(this.data);
    return this.data;
  }

  isFavorite(path) {
    return this.data.favorites.includes(path);
  }

  toggleFavorite(path) {
    const on = !this.isFavorite(path);
    return this.change((s) => {
      s.favorites = s.favorites.filter((p) => p !== path);
      if (on) s.favorites.unshift(path);
    }, `${on ? "Favourite" : "Unfavourite"} ${path.split("/").pop()}`);
  }

  /** Keep favourites pointing at the right file after a rename / delete. */
  renamePath(oldPath, newPath) {
    if (!this.isFavorite(oldPath)) return Promise.resolve();
    return this.change((s) => { s.favorites = s.favorites.map((p) => (p === oldPath ? newPath : p)); }, "Update favourites");
  }
  forgetPath(path) {
    if (!this.isFavorite(path)) return Promise.resolve();
    return this.change((s) => { s.favorites = s.favorites.filter((p) => p !== path); }, "Update favourites");
  }

  /** Apply `op` locally now, then save it (queued, with conflict retry). */
  change(op, message) {
    op(this.data);
    writeLocal(this.data);
    this.queue = this.queue.then(() => this.save(op, message)).catch(() => {});
    return this.queue;
  }

  async save(op, message) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        this.sha = await this.vault.writeJSON(STATE_PATH, this.data, this.sha, message);
        return;
      } catch (e) {
        if (e.status !== 409 && e.status !== 422) throw e;
        await this.load();   // someone else changed it: take theirs...
        op(this.data);       // ...and re-apply ours on top
      }
    }
  }
}

function readLocal() {
  try { return JSON.parse(localStorage.getItem(STATE_CACHE)); } catch { return null; }
}
function writeLocal(data) {
  try { localStorage.setItem(STATE_CACHE, JSON.stringify(data)); } catch { /* ignore */ }
}
export function clearLocalState() {
  try { localStorage.removeItem(STATE_CACHE); } catch { /* ignore */ }
}
