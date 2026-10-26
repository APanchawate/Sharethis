# AI handoff brief

Paste this file (and whichever source files are relevant) into ChatGPT, Claude or any coding AI to continue the project.

## What this is

DocSync: a static web app on GitHub Pages that stores documents in a private GitHub repo through the GitHub REST Contents API. Owner unlocks with a password that decrypts a fine-grained GitHub token kept in `config.js`. Read `README.md` and `docs/ARCHITECTURE.md` for the full picture.

## Hard constraints (do not break)

1. **Static only.** Must run on GitHub Pages: no server code, no build step, no npm runtime dependencies. Plain HTML/CSS/JS with native ES modules.
2. **No external scripts or CDNs.** Everything is local in `assets/`.
3. **Never put a raw token in the repo.** Only the encrypted blob from `setup.html`.
4. **Render user data with `textContent`**, never `innerHTML` (file names are untrusted).
5. **Uploads stay sequential** (parallel commits cause 409 conflicts).
6. **Clean white UI.** Reuse the CSS variables and classes in `assets/style.css` (`.btn`, `.btn-primary`, `.btn-ghost`, `.icon-btn`, `.input`, `.modal`, `.modal-box`). Mobile first, tap targets at least 40px.
7. `config.js` is the only file a user should need to edit.

## Code map

- `assets/github.js` - `Vault` class. Add new GitHub API calls here, nowhere else.
- `assets/organize.js` - pure functions (no DOM, no network): categories + keywords, smart search, sorting, device detection, commit-message parsing. Add categories/keywords here.
- `assets/meta.js` - file origins from commit history, cached in localStorage.
- `assets/app.js` - UI. Sections are numbered 1 to 7 in comments; keep that order.
- `sw.js` + `manifest.webmanifest` - Android share target only. Do not add offline caching without versioning (stale app risk).
- Commit message contract: `Upload <name> [<device>, <via>]`. The iOS Shortcut (docs/IOS_SHORTCUT.md) writes it too; keep it backwards compatible.
- `assets/crypto.js` - do not change the format without bumping `v` and keeping `v: 1` decryptable.
- `tests/e2e.mjs` - Playwright test with a mocked GitHub API. Extend the mock when you add API calls, and add assertions for new features.

## How to verify a change

```bash
python3 -m http.server 8080 &
PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 npm test
```

All checks must print `ok`. Look at `tests/screenshots/` for desktop and iPhone layouts.

## Roadmap (ideas, in rough priority order)

Done in 1.1: search, sort, auto categories, upload dates/devices, Android share target, iOS Shortcut.

1. **Manual category override** - e.g. a `categories.json` in the vault mapping file name -> category id, edited from a "Move to..." menu.
2. **Folders** - allow `files/<folder>/<name>`; list with the Git Trees API (`GET /repos/{o}/{r}/git/trees/HEAD?recursive=1`) to get everything in one call.
3. **Signed iOS Shortcut** - build it once on a Mac, share an iCloud link so setup is one tap (token still pasted by the user).
4. **Content search** - search inside PDFs (pdf.js text extraction, cached per sha). Heavier; only if needed.
5. **Rename** - Contents API has no rename: upload under the new name then delete the old one.
6. **Bigger files** - switch upload to the Git Data API (create blob, create tree, create commit, update ref) for up to 100 MB.
7. **Camera scan** - `<input type="file" accept="image/*" capture="environment">` button on phones.

## Conventions

- Small functions, comments explaining *why*.
- User-facing errors go through `friendlyError()` in `app.js`.
- Update `CHANGELOG.md` and the feature list in `README.md` with every feature.
