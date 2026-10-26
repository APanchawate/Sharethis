// github.js
// Thin wrapper around the GitHub REST "Contents" API.
// Every document is one file at <folder>/<name> in the private vault repo.
// Docs: https://docs.github.com/en/rest/repos/contents

const API = "https://api.github.com";

export class GitHubError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Encode each path segment but keep the slashes.
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");

export class Vault {
  constructor({ owner, repo, folder, token }) {
    this.owner = owner;
    this.repo = repo;
    this.folder = folder.replace(/^\/+|\/+$/g, "");
    this.token = token;
  }

  url(path = "") {
    return `${API}/repos/${this.owner}/${this.repo}/contents/${encPath(path)}`;
  }

  async request(url, { method = "GET", body, accept = "application/vnd.github+json" } = {}) {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: accept,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).message || msg; } catch { /* not json */ }
      throw new GitHubError(res.status, msg);
    }
    return res;
  }

  /** Checks the token can see the repo. Throws GitHubError otherwise. */
  async check() {
    await this.request(`${API}/repos/${this.owner}/${this.repo}`);
  }

  /** List documents: [{name, path, sha, size}] sorted by name. */
  async list() {
    try {
      const res = await this.request(this.url(this.folder));
      const items = await res.json();
      return items
        .filter((i) => i.type === "file" && i.name !== ".gitkeep")
        .map(({ name, path, sha, size }) => ({ name, path, sha, size }))
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
    } catch (e) {
      if (e.status === 404) return []; // folder not created yet = no files
      throw e;
    }
  }

  /** Download a document as a Blob (works up to 100 MB). */
  async download(path) {
    const res = await this.request(this.url(path), { accept: "application/vnd.github.raw+json" });
    return res.blob();
  }

  /**
   * Upload a new document. If the name is taken, adds " (2)", " (3)" ...
   * `tag` goes into the commit message so other devices can show where the
   * file came from: "Upload CV.pdf [iPhone, share]". See organize.parseCommit.
   * Returns {name, path, sha} of the saved file.
   */
  async upload(name, base64, tag = "") {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
      const path = `${this.folder}/${candidate}`;
      try {
        const res = await this.request(this.url(path), {
          method: "PUT",
          body: { message: `Upload ${candidate}${tag ? ` [${tag}]` : ""}`, content: base64 },
        });
        const data = await res.json().catch(() => ({}));
        return { name: candidate, path, sha: data.content?.sha || null };
      } catch (e) {
        // 422 = file exists (no sha given). Try the next name.
        if (e.status !== 422) throw e;
      }
    }
    throw new Error("Too many files with the same name");
  }

  /** Delete a document. */
  async remove(path, sha, tag = "") {
    await this.request(this.url(path), {
      method: "DELETE",
      body: { message: `Delete ${path.split("/").pop()}${tag ? ` [${tag}]` : ""}`, sha },
    });
  }

  /** One page (100) of commits touching the documents folder, newest first: [{message, date}]. */
  async history(page = 1) {
    const q = `path=${encodeURIComponent(this.folder)}&per_page=100&page=${page}`;
    const res = await this.request(`${API}/repos/${this.owner}/${this.repo}/commits?${q}`);
    return (await res.json()).map(simplifyCommit);
  }

  /** Latest commit that touched one file: {message, date} or null. */
  async lastCommit(path) {
    const q = `path=${encodeURIComponent(path)}&per_page=1`;
    const res = await this.request(`${API}/repos/${this.owner}/${this.repo}/commits?${q}`);
    const [c] = await res.json();
    return c ? simplifyCommit(c) : null;
  }
}

const simplifyCommit = (c) => ({
  message: c.commit?.message || "",
  date: c.commit?.committer?.date || c.commit?.author?.date || null,
});
