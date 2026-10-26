# Setup guide

About 10 minutes, all in the browser. You need a free GitHub account.

Throughout this guide, replace `YOUR-USERNAME` with your GitHub username.

---

## Step 1. Put the app on GitHub

**Option A: command line** (from the `docsync` folder)

```bash
# create the public repo on github.com first: New repository -> name "docsync" -> Public -> no README
git remote add origin https://github.com/YOUR-USERNAME/docsync.git
git branch -M main
git push -u origin main
```

**Option B: GitHub CLI**

```bash
gh repo create docsync --public --source=. --push
```

**Option C: no git at all.** On github.com create the `docsync` repo, click *Add file > Upload files* and drag in everything from this folder (keep the `assets` and `docs` folders).

## Step 2. Turn on GitHub Pages

1. Open `https://github.com/YOUR-USERNAME/docsync` > **Settings** > **Pages**.
2. *Source*: **Deploy from a branch**. *Branch*: **main**, folder **/ (root)**. Save.
3. Wait about a minute. Your app is at `https://YOUR-USERNAME.github.io/docsync/`.

It will say "This site is not set up yet". That's expected.

## Step 3. Create the private vault repo

1. Go to https://github.com/new
2. Name: `docsync-vault`
3. Visibility: **Private** (important)
4. Tick **Add a README file** (the repo must not be completely empty).
5. Create repository.

## Step 4. Create an access token

This token lets the app read and write files in the vault, and nothing else.

1. Go to https://github.com/settings/personal-access-tokens/new (Settings > Developer settings > Personal access tokens > **Fine-grained tokens** > Generate new token).
2. **Token name**: `docsync`
3. **Expiration**: pick the longest you're comfortable with (up to 1 year, or "No expiration"). When it expires you redo steps 4 and 5.
4. **Repository access**: **Only select repositories** > choose `docsync-vault`.
5. **Permissions** > Repository permissions > **Contents**: **Read and write**. (Metadata: Read-only gets added automatically.) Leave everything else as "No access".
6. Generate token and copy it (starts with `github_pat_`). You will not see it again.

## Step 5. Generate your config

1. Open `https://YOUR-USERNAME.github.io/docsync/setup.html`
2. Fill in your username, `docsync-vault`, the token, and choose a password.
   - Use at least 10 characters. A short sentence is easy to type on a phone and hard to guess.
3. Click **Test token and generate config**, then **Copy**.

## Step 6. Save the config

1. Open `https://github.com/YOUR-USERNAME/docsync/blob/main/config.js`
2. Click the pencil icon (Edit).
3. Select everything, paste the copied config, **Commit changes**.
4. Wait about a minute for Pages to redeploy.

## Step 7. Use it

Open `https://YOUR-USERNAME.github.io/docsync/` on any device, enter your password, done.

Tip for phones: use the browser's **Add to Home Screen** for one-tap access.
- iPhone (Safari): Share button > Add to Home Screen
- Android (Chrome): menu ⋮ > Add to Home screen

---

## Everyday questions

**I lost/changed phone.** Nothing to do. On the new device open the link and type the password. To cut off the old device, change the password (redo step 5 and 6 with a new token, then delete the old token on GitHub).

**Change password.** Redo step 5 with the same token and a new password, then step 6.

**Token expired.** The app will ask you to unlock again and fail. Create a new token (step 4), then steps 5 and 6.

**I deleted a file by mistake.** Go to `github.com/YOUR-USERNAME/docsync-vault/commits`, open the "Delete ..." commit, and view the file in the parent commit to download it.

**Where are my files really?** `github.com/YOUR-USERNAME/docsync-vault/tree/main/files`. You can also upload there directly; the app will show them.

**Upload fails with "too large".** The limit is 25 MB per file. Compress the PDF or split it. You can raise `maxFileMB` in `config.js` up to about 50.

**Does someone with the link see my files?** No. They see a password box. Your documents are in a private repo, and the token to reach it is encrypted with your password.
