# Changelog

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
