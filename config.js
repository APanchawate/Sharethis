// DocSync configuration
// ---------------------------------------------------------------------------
// This is the ONLY file you need to edit after forking/cloning.
// Generate the values with setup.html (open it from your live site), then
// paste the result over this whole file. See docs/SETUP.md.
//
// Is it safe for this file to be public? Yes, as long as:
//   - encryptedToken was made with a strong password (it is AES-256 encrypted)
//   - the token only has access to the private vault repo (fine-grained token)
// ---------------------------------------------------------------------------

export default {
  // GitHub username that owns the vault repo, e.g. "jaygohil"
  owner: "",

  // Private repo where documents are stored
  repo: "docsync-vault",

  // Folder inside the vault repo that holds the documents
  folder: "files",

  // Max upload size per file in MB (GitHub API practical limit, keep <= 50)
  maxFileMB: 25,

  // Encrypted GitHub token produced by setup.html. Leave null to be asked
  // for a raw token instead of a password on each new device.
  encryptedToken: null,
};
