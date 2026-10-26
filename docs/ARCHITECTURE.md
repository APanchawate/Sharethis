# Architecture

## Goals

1. One link that works on every device with a browser.
2. Zero cost, zero servers, nothing to maintain.
3. Everything on GitHub.
4. Code simple enough that anyone (or any AI) can read it in 15 minutes.

## Components

| Part | File | Responsibility |
|---|---|---|
| App shell | `index.html` | Markup for lock screen, file list, preview and confirm modals |
| UI logic | `assets/app.js` | Event handlers, rendering, upload queue, preview |
| Storage API | `assets/github.js` | `Vault` class: `check`, `list`, `upload`, `download`, `remove` |
| Crypto | `assets/crypto.js` | `encryptToken`, `decryptToken` |
| Settings | `config.js` | Owner, repo, folder, size limit, encrypted token |
| Setup tool | `setup.html` | Tests a token and produces a ready `config.js` |

No framework, no bundler, no npm dependencies at runtime. Native ES modules (`<script type="module">`).

## Data model

Each document is one file at `files/<name>` in the private vault repo. There is no index or database. The file list is simply `GET /repos/{owner}/{repo}/contents/files`.

## GitHub API calls

All calls go to `https://api.github.com` with `Authorization: Bearer <token>`. GitHub allows browser (CORS) requests to its API.

| Action | Request |
|---|---|
| Check token | `GET /repos/{o}/{r}` |
| List | `GET /repos/{o}/{r}/contents/files` (404 = empty) |
| Download | `GET /repos/{o}/{r}/contents/files/{name}` with `Accept: application/vnd.github.raw+json` (raw bytes, up to 100 MB) |
| Upload | `PUT /repos/{o}/{r}/contents/files/{name}` body `{message, content: base64}`. 422 means the name exists, so the app retries with `name (2).ext` |
| Delete | `DELETE /repos/{o}/{r}/contents/files/{name}` body `{message, sha}` |

Uploads run one at a time. Parallel commits to the same branch cause 409 conflicts.

## Security model

- **Vault repo is private.** Nobody can read it without a token.
- **Token is fine-grained**, limited to one repo and to `Contents: read/write`. Worst case if leaked: someone can read/change your documents, nothing else in your GitHub account.
- **Token is encrypted** in the public `config.js` with AES-256-GCM. The key is derived from your password with PBKDF2-SHA256, 600,000 iterations, random 16-byte salt. This is the same scheme password managers use. The ciphertext is public, so the password must be strong enough to resist offline guessing (10+ characters, not a common phrase).
- **Raw token never touches GitHub in plaintext**, so GitHub secret scanning will not auto-revoke it.
- **On the device**, after unlock the decrypted token is kept in `localStorage` ("Remember this device") or `sessionStorage` (forgotten when the tab closes). The lock button clears it.
- **No third-party scripts.** Nothing is loaded from other domains. `noindex` keeps search engines away.
- File names are rendered with `textContent`, never `innerHTML`, so a malicious file name cannot inject script.

Known trade-off: anyone with access to an unlocked device's browser can use the app, same as any "remember me" login.

## Design decisions

| Decision | Why | Alternative considered |
|---|---|---|
| GitHub repo as storage | User wanted everything on GitHub, free, versioned | Supabase, Cloudflare R2 (bigger files, but another account) |
| Encrypted token in config.js | Lets user type a short password instead of a 90-char token on each phone | Paste raw token per device (still supported: set `encryptedToken: null`) |
| No framework | Easy for anyone/any AI to modify; no build step for GitHub Pages | React/Vite (needs build + Actions) |
| 25 MB limit | Base64 inflates by 33% and the Contents API gets unreliable above ~50 MB | Git Data API blobs (up to 100 MB, more calls) |
| PDF preview via iframe, except Android | Android Chrome cannot render PDFs inline; shows "Open PDF" instead | pdf.js (adds ~1 MB of code) |

## Limits

- GitHub recommends repos stay under 1 GB; hard warnings at 5 GB.
- 5,000 API requests per hour per token (far more than a person needs).
- Flat folder (no subfolders) in v1.
