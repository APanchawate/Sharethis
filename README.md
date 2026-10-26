# a really helpful tool

A tiny, private document locker that lives entirely on GitHub.

Open one link on any device (Android, iPhone, Mac, Windows, Linux), type your password once, and your documents are there: upload, preview, favourite, rename, copy, send, download, delete. Everything syncs to every other device.

- **No server, no database, no monthly cost.** The website is hosted free on GitHub Pages. Your files live in a private GitHub repo.
- **No build step.** Plain HTML, CSS and JavaScript. Edit a file, push, done.
- **Private.** The link is public, but nothing is visible until you unlock it with your password.
- **Nothing is ever really lost.** Every change is a git commit, and deletes can be undone.

The look is clean white with small touches from Saurashtra / Kathiyawad: a bandhani (Jamnagar tie-dye) dot strip, kumkum red and haldi yellow accents.

## How it works

```
 Your phone / laptop                       GitHub
 ┌──────────────────────┐   HTTPS + token   ┌──────────────────────────────┐
 │  the web app         │ ────────────────▶ │  docsync-vault (PRIVATE)     │
 │  (served by GitHub   │   REST API        │   files/CV.pdf               │
 │   Pages from the     │ ◀──────────────── │   files/passport.jpg  ...    │
 │   docsync repo)      │                   │   .app/state.json (favs)     │
 └──────────────────────┘                   └──────────────────────────────┘
        ▲
        │ password unlocks an AES-256 encrypted token stored in config.js
```

Two repos (the names are only defaults, any names work):

| Repo | Visibility | What's in it |
|---|---|---|
| `docsync` | Public | This code. GitHub Pages serves it as the website. |
| `docsync-vault` | **Private** | Your documents in `files/`, favourites in `.app/state.json`. |

## Quick start

Full click-by-click guide: **[docs/SETUP.md](docs/SETUP.md)** (about 10 minutes).

1. Push this folder to a public repo and turn on GitHub Pages.
2. Create an empty **private** repo for the documents (e.g. `docsync-vault`).
3. Create a fine-grained token with access to only that repo, permission *Contents: Read and write*.
4. Open `https://<you>.github.io/<repo>/setup.html`, enter the token and pick a password, copy the generated config.
5. Paste it into `config.js`, commit. Open the site on any device.

## Features

**Getting files in**
- Big "Upload documents" button (file picker, photo library or Files app on phones)
- Drag and drop anywhere on the page, or paste (Ctrl+V / Cmd+V) a screenshot or copied files
- Exact duplicates are detected and skipped ("Already saved as Passport.png"); same name with different content is saved as `name (2).pdf`

**Finding them**
- Auto-organised into categories from the file name (English + German): ID & Visa, Work, Education, Money, Home, Photos, Other
- **Favourites** (heart): pinned to the top, own filter, synced across devices
- Smart search: any word order, forgives typos ("pasport"), understands types ("pdf", "photo"), devices ("iphone"), categories ("visa"), months and "today / week / month"
- Sort by newest, oldest, name or size
- Each file shows where it came from: device, date, size

**Using them**
- Tap a file: instant preview if the browser can show it (PDF, images, text). Other types open the actions menu instead.
- Previews are cached on the device and prefetched when your finger or mouse lands on a row, so opening is near-instant; favourites are warmed in the background
- Copy to clipboard (images and text; browsers don't allow PDFs/Word on the clipboard)
- Send to an app: the phone's own share sheet (WhatsApp, Mail, AirDrop...) with the real file
- Rename (one commit, keeps origin and favourite), download, delete with **Undo**
- Lock button: forgets the token and wipes every cached copy from that device

Limits: 25 MB per file (configurable up to ~50 MB), about 1 GB total recommended for a GitHub repo.

## Project structure

```
├── index.html            The app (lock screen, list, menu, modals)
├── setup.html            One-time setup tool: encrypts your token, outputs config.js
├── config.js             Your settings (the only file you edit)
├── manifest.webmanifest  "Add to Home Screen" / install as app
├── assets/
│   ├── app.js            UI logic, numbered sections 1-7
│   ├── github.js         The only code that talks to GitHub (Contents + Git Data API)
│   ├── organize.js       Categories, smart search, sorting, device names, preview support (pure functions)
│   ├── meta.js           Each file's upload date + device, from commit history
│   ├── state.js          Synced favourites (.app/state.json) with conflict retry
│   ├── blobs.js          File cache + prefetch (instant preview), duplicate hash
│   ├── crypto.js         Password encryption of the token (PBKDF2 + AES-GCM)
│   ├── style.css         All styles and colour tokens
│   └── icon*.svg/png     Logo and home-screen icons
├── tests/e2e.mjs         Browser test with a fake GitHub API (68 checks)
├── docs/
│   ├── SETUP.md          Step-by-step setup for a non-developer
│   ├── ARCHITECTURE.md   How it works, security model, design decisions
│   └── AI_HANDOFF.md     Brief for another AI (ChatGPT, Claude...) to continue the work
└── CHANGELOG.md
```

## Run locally

```bash
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

ES modules need a web server; opening `index.html` by double-click will not work.

## Test

```bash
npm install            # installs Playwright (dev only)
npx playwright install chromium
python3 -m http.server 8080 &
npm test
```

The test fakes the GitHub API, so no token is needed. Screenshots land in `tests/screenshots/`.

## Continuing development with another AI

Give it [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) first. It explains the constraints, conventions and the roadmap.

## License

MIT
