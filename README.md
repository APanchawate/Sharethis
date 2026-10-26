# DocSync

A tiny, private document locker that lives entirely on GitHub.

Open one link on any device (Android, iPhone, Mac, Windows, Linux), type your password once, and upload, preview, download or delete your documents. Everything you upload shows up on every other device.

- **No server, no database, no monthly cost.** The website is hosted free on GitHub Pages. Your files are stored in a private GitHub repo.
- **No build step.** Plain HTML, CSS and JavaScript. Edit a file, push, done.
- **Private.** The app link is public, but nothing is visible until you unlock it with your password.
- **Version history for free.** Every upload and delete is a git commit, so a deleted file can always be recovered from the vault repo history.

## How it works

```
 Your phone / laptop                       GitHub
 ┌──────────────────────┐   HTTPS + token   ┌──────────────────────────────┐
 │  DocSync web app     │ ────────────────▶ │  docsync-vault (PRIVATE)     │
 │  (served by GitHub   │   REST API        │   files/CV.pdf               │
 │   Pages from the     │ ◀──────────────── │   files/passport.jpg  ...    │
 │   docsync repo)      │                   └──────────────────────────────┘
 └──────────────────────┘
        ▲
        │ password unlocks an AES-256 encrypted token stored in config.js
```

Two repos:

| Repo | Visibility | What's in it |
|---|---|---|
| `docsync` | Public | This code. GitHub Pages serves it as the website. |
| `docsync-vault` | **Private** | Your documents, in a `files/` folder. |

The browser talks directly to the GitHub API using a fine-grained access token that can only touch the vault repo. That token is stored in `config.js`, encrypted with your password, so you only ever type the password.

## Quick start

Full click-by-click guide: **[docs/SETUP.md](docs/SETUP.md)** (about 10 minutes).

1. Push this folder to a public repo called `docsync` and turn on GitHub Pages.
2. Create an empty **private** repo called `docsync-vault`.
3. Create a fine-grained token with access to only `docsync-vault`, permission *Contents: Read and write*.
4. Open `https://<you>.github.io/docsync/setup.html`, enter the token and pick a password, copy the generated config.
5. Paste it into `config.js`, commit. Open `https://<you>.github.io/docsync/` on any device.

## Features (v1)

- Big "Upload documents" button (opens the file picker / camera roll / Files app on phones), plus drag and drop anywhere on the page
- **Share from other apps**: Android installs DocSync into the Share menu; iPhone/iPad use a one-time "Save to DocSync" Shortcut ([docs/IOS_SHORTCUT.md](docs/IOS_SHORTCUT.md))
- **Auto-organised** into categories from the file name (English + German keywords): ID & Visa, Work, Education, Money, Home, Photos, Other
- **Where it came from**: each file shows the device (iPhone, Android, Mac, Windows PC...), upload date and a "shared" tag
- **Smart search**: any order, forgives typos ("pasport"), understands types ("pdf", "photo"), devices ("iphone"), categories ("visa"), months and "today / week / month"
- **Sort** by newest, oldest, name or size
- Multi-file upload with progress; duplicate names are saved as `name (2).pdf` instead of overwriting
- Preview in browser: PDFs, images, and text files (txt, md, csv, json). Other types offer a download.
- Download and delete (with confirmation)
- Lock button to remove access from a device
- Works on phone and desktop screen sizes

Limits: 25 MB per file (configurable up to ~50 MB), about 1 GB total recommended for a GitHub repo.

## Project structure

```
docsync/
├── index.html          The app (lock screen, file list, modals)
├── setup.html          One-time setup tool: encrypts your token, outputs config.js
├── config.js           Your settings (the only file you edit)
├── manifest.webmanifest  Install-as-app + Android Share menu (share_target)
├── sw.js               Service worker: receives files shared on Android
├── assets/
│   ├── app.js          UI logic (lock, list, search, upload, preview, delete)
│   ├── organize.js     Categories, smart search, sorting, device names (pure functions)
│   ├── meta.js         Works out each file's upload date + device from commit history
│   ├── github.js       GitHub API wrapper (list/upload/download/delete/history)
│   ├── crypto.js       Password encryption of the token (Web Crypto, PBKDF2 + AES-GCM)
│   ├── style.css       All styles
│   └── icon*.svg/png   Logo, favicon, app icons
├── tests/e2e.mjs       Browser test with a fake GitHub API
├── docs/
│   ├── SETUP.md        Step-by-step setup for a non-developer
│   ├── IOS_SHORTCUT.md Build the iPhone/iPad "Save to DocSync" Shortcut
│   ├── ARCHITECTURE.md How it works, security model, design decisions
│   └── AI_HANDOFF.md   Brief for another AI (ChatGPT, Claude...) to continue the work
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
npm test        # sets the Playwright service-worker flag itself
```

The test fakes the GitHub API, so no token is needed. Screenshots land in `tests/screenshots/`.

## Continuing development with another AI

Give it [docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) first. It explains the constraints, conventions and the roadmap.

## License

MIT
