# Changelog

## 1.2.0 (2026-10-26)

- Renamed to "a really helpful tool"; subtle Saurashtra / Kathiyawad design (bandhani strip, kumkum + haldi accents, new icon)
- Favourites (heart), synced across devices via `.app/state.json`, pinned on top, own chip
- ⋯ actions menu (bottom sheet on phones): Preview, Favourite, Copy, Send to an app, Download, Rename, Delete
- Rename in one commit via Git Data API, keeps origin and favourite
- Undo delete
- Copy to clipboard (images as PNG, text); Send to an app via the system share sheet
- Tap previews only types the browser can show; others open the menu
- Instant preview: per-device file cache by sha, prefetch on hover/touch, warm favourites, list drawn from cache on start
- Exact-duplicate detection before upload; paste (Ctrl+V) to upload
- Lock now wipes cached files from the device
- Removed: iOS Shortcut guide, Android share target, service worker

## 1.1.0 (2026-10-26)

- Auto categories from file names (ID & Visa, Work, Education, Money, Home, Photos, Other), English + German keywords
- File origin: device, upload date and "shared" tag, read from commit messages `Upload <name> [<device>, <via>]`
- Smart search (typo tolerant; types, devices, categories, months, today/week/month)
- Sort: newest, oldest, name, largest
- Drag and drop anywhere on the page
- Android Share menu via installable app (manifest share_target + service worker)
- iPhone/iPad "Save to DocSync" Shortcut guide, in-app help with copy buttons
- PNG app icons for home screens

## 1.0.0 (2026-10-26)

First release.

- Password lock screen (AES-256 encrypted GitHub token in config.js), "remember this device" and lock button
- Upload button for phones and desktop, drag and drop, multi-file queue, no overwrite on duplicate names
- File list with type icons and sizes
- Preview for PDF, images and text; download fallback for other types
- Download and delete with confirmation
- setup.html to test the token and generate config.js
- Playwright end-to-end test with a mocked GitHub API
