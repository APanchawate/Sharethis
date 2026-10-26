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
- `assets/app.js` - UI. Sections are numbered 1 to 6 in comments; keep that order.
- `assets/crypto.js` - do not change the format without bumping `v` and keeping `v: 1` decryptable.
- `tests/e2e.mjs` - Playwright test with a mocked GitHub API. Extend the mock when you add API calls, and add assertions for new features.

## How to verify a change

```bash
python3 -m http.server 8080 &
npm test
```

All checks must print `ok`. Look at `tests/screenshots/` for desktop and iPhone layouts.

## Roadmap (ideas, in rough priority order)

1. **Search and sort** - filter box above the list; sort by name/size. Pure client side on the `files` array.
2. **Folders** - allow `files/<folder>/<name>`; list with the Git Trees API (`GET /repos/{o}/{r}/git/trees/HEAD?recursive=1`) to get everything in one call.
3. **Upload dates** - one call to `GET /repos/{o}/{r}/commits?path=files` and map commit dates to file names, or keep a small `index.json` manifest.
4. **PWA** - `manifest.webmanifest` + service worker for "install as app"; Android share target (`share_target` in the manifest) so files can be shared into DocSync from other apps.
5. **Rename** - Contents API has no rename: upload under the new name then delete the old one.
6. **Bigger files** - switch upload to the Git Data API (create blob, create tree, create commit, update ref) for up to 100 MB.
7. **Camera scan** - `<input type="file" accept="image/*" capture="environment">` button on phones.

## Conventions

- Small functions, comments explaining *why*.
- User-facing errors go through `friendlyError()` in `app.js`.
- Update `CHANGELOG.md` and the feature list in `README.md` with every feature.
