// crypto.js
// Password-based encryption of the GitHub token, using only the browser's
// built-in Web Crypto API (no libraries).
//
//   key  = PBKDF2-SHA256(password, salt, 600000 iterations) -> AES-256 key
//   data = AES-GCM(key, iv, token)
//
// The output is a small JSON object of base64 strings that can live in the
// public config.js. Without the password it cannot be decrypted.

const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Encrypt a token with a password. Returns {v, iter, salt, iv, ct}. */
export async function encryptToken(token, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(token));
  return { v: 1, iter: ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct) };
}

/** Decrypt. Throws an Error("Wrong password") if the password is wrong. */
export async function decryptToken(blob, password) {
  try {
    const key = await deriveKey(password, fromB64(blob.salt), blob.iter || ITERATIONS);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, key, fromB64(blob.ct));
    return dec.decode(pt);
  } catch {
    throw new Error("Wrong password");
  }
}
