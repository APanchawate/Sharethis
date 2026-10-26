# Security

## Reporting a problem

Please **don't open a public issue** for security problems. Use GitHub's private reporting instead: **Security > Report a vulnerability** on this repository. You'll get an answer within a week.

## What protects your documents

| Layer | How |
|---|---|
| Storage | Documents live in a separate **private** repo. The public repo only holds code. |
| Access key | A fine-grained GitHub token limited to that one repo, permission *Contents* only. |
| Key at rest | Stored in the public `config.js` encrypted with your password: PBKDF2-SHA256 (600,000 iterations, random salt) + AES-256-GCM, using the browser's Web Crypto API. |
| In the browser | Strict Content Security Policy: scripts and styles only from this site, network only to `api.github.com`, no inline code, no third-party scripts. File names are always rendered as text. |
| On a device | The lock button deletes the key, the cached file list and all cached files. |
| Setup | `setup.html` refuses a vault repo that is public and refuses weak passwords. |

## Things you control

- **Use a strong password.** The encrypted key is public, so a short or common password could be guessed offline. A sentence of 4+ words is good.
- **If a device is lost**, delete the token on GitHub (Settings > Developer settings > Fine-grained tokens), create a new one and run `setup.html` again.
- **Tokens expire.** Pick an expiry you're comfortable with; renewing takes 2 minutes.
- Anyone using an *unlocked* device that remembers you can open your documents, like any "remember me" login. Use the lock button on shared computers.
