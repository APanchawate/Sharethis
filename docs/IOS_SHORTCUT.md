# Save to DocSync from the iPhone / iPad Share button

Apple does not let websites appear in the iOS Share menu. (Android does, see below.) The workaround is a small **Shortcut** called "Save to DocSync". It appears in the Share menu of every app and uploads straight to your vault through the GitHub API, the same way the web app does.

You build it once, in about 5 minutes. The values to paste are in the app: tap the share icon (arrow out of a box) at the top of DocSync and open the **iPhone / iPad** tab. It has copy buttons for the URL and the Authorization header.

## Build the Shortcut

In the **Shortcuts** app:

1. Tap **+** to make a new shortcut. Rename it **Save to DocSync**.
2. Open the shortcut settings (the **ⓘ** button, or tap the name at the top, then **Details**). Turn on **Show in Share Sheet**.
3. At the top, the first block says *Receive [Any] input from [Share Sheet]*. Tap **Any** and keep **Files**, **Images** and **PDFs** (more is fine). Set *If there's no input* to **Stop and Respond**.
4. Add **Repeat with Each** and set it to **Shortcut Input**. Steps 5 to 10 go *inside* the loop.
5. Add **Get Details of Files**, choose **Name**, input **Repeat Item**.
6. Add **Get Details of Files** again, choose **File Extension**, input **Repeat Item**.
7. Add **Text**. Insert the variable **Name**, type a dot `.`, insert **File Extension**. Result looks like `Name.File Extension`.
8. Add **URL Encode**, input **Text**.
9. Add **Base64 Encode**, input **Repeat Item**. Tap *Show More* and set **Line Breaks** to **None**.
10. Add **Get Contents of URL**:
    - **URL**: paste value 1 from the app, it looks like `https://api.github.com/repos/YOUR-USERNAME/docsync-vault/contents/files/` (ending with `/`). Right after the last `/` insert the variable **URL Encoded Text**.
    - Tap *Show More*. **Method**: `PUT`.
    - **Headers**: add one. Key `Authorization`, value: paste value 2 from the app (`Bearer github_pat_...`).
    - **Request Body**: `JSON`. Add two fields, both type **Text**:
      - `message` = `Upload ` + variable **Text** + ` [iPhone, share]`  (on an iPad write `iPad`)
      - `content` = variable **Base64 Encoded**
11. *After* the loop (below **End Repeat**), add **Show Notification**: `Saved to DocSync`.

Done. Test it: open the Files app, long-press a PDF, **Share**, scroll the list of actions, tap **Save to DocSync**. Refresh DocSync in the browser and the file is there, marked "iPhone · shared".

Tip: in the Share menu tap **Edit Actions** and add Save to DocSync to Favorites so it is always at the top.

## Notes

- **Same name twice.** GitHub refuses to overwrite, so a file with a name that already exists is not saved. Rename it, or upload it in the web app (which adds " (2)" automatically).
- **Photos** arrive as `IMG_1234.heic` or `.jpg`. HEIC previews in Safari but not in Chrome. To always get JPG, add **Convert Image** (format JPEG) on the Repeat Item before step 5 and use its result in steps 5, 6 and 9.
- **The token lives inside the Shortcut** on your phone. If the phone is lost, delete the token on GitHub (Settings > Developer settings > Fine-grained tokens), create a new one and update `config.js` with setup.html.
- **Token expired?** The Shortcut will run but nothing appears. Make a new token and paste the new `Bearer ...` value into step 10.

## Why the commit message matters

DocSync shows where each file came from by reading the commit message: `Upload <name> [<device>, <via>]`. Keep that pattern and the file shows "iPhone · shared" in the list. Anything else still uploads fine; it just shows as "Unknown" or "GitHub".

## Android

No Shortcut needed. Open DocSync in Chrome, menu **⋮** > **Install app** (or *Add to Home screen* > *Install*). DocSync then appears in the Android Share menu. Shared files upload as soon as the app opens (after unlocking, if the device was locked). This uses the Web Share Target API: see `manifest.webmanifest` and `sw.js`.
