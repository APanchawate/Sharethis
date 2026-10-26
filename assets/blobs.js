// blobs.js
// Makes opening files feel instant:
//   - getBlob(vault, file)  returns the file's bytes from (1) memory, (2) the
//     browser's Cache Storage on this device, or (3) GitHub, in that order.
//     Keyed by the file's git sha, so a changed file is never served stale.
//   - prefetch(vault, file) starts that download early (on hover / touch), so
//     by the time the click lands the file is usually already here.
//   - gitBlobSha(file)      the sha GitHub would give these bytes, used to spot
//     duplicates before uploading.
// The lock button calls clearBlobs() so nothing stays on a locked device.

const CACHE_NAME = "docsync-files-v1";
const MAX_CACHED = 80;               // files kept on this device
const MAX_CACHE_BYTES = 30 * 1024 * 1024; // don't keep files bigger than this

const memory = new Map();            // sha -> Blob (this tab only)
const inflight = new Map();          // sha -> Promise<Blob>

const keyFor = (sha) => `https://cache.local/blob/${sha}`;

async function openCache() {
  try { return "caches" in window ? await caches.open(CACHE_NAME) : null; } catch { return null; }
}

export async function getBlob(vault, file) {
  if (memory.has(file.sha)) return memory.get(file.sha);
  if (inflight.has(file.sha)) return inflight.get(file.sha);

  const job = (async () => {
    const cache = await openCache();
    const hit = cache && (await cache.match(keyFor(file.sha)).catch(() => null));
    let blob = hit ? await hit.blob() : null;
    if (!blob) {
      blob = await vault.download(file.path);
      if (cache && blob.size <= MAX_CACHE_BYTES) {
        await cache.put(keyFor(file.sha), new Response(blob)).catch(() => {});
        trim(cache);
      }
    }
    memory.set(file.sha, blob);
    return blob;
  })();

  inflight.set(file.sha, job);
  try { return await job; } finally { inflight.delete(file.sha); }
}

/** Fire-and-forget early download. Errors are ignored (the click will retry). */
export function prefetch(vault, file) {
  if (!memory.has(file.sha) && !inflight.has(file.sha)) getBlob(vault, file).catch(() => {});
}

/** True if the bytes are ready right now (needed for copy/share, which must run inside the tap). */
export const isReady = (file) => memory.has(file.sha);
export const readyBlob = (file) => memory.get(file.sha);

/** Put freshly uploaded bytes straight into the caches. */
export async function rememberBlob(sha, blob) {
  if (!sha) return;
  memory.set(sha, blob);
  const cache = await openCache();
  if (cache && blob.size <= MAX_CACHE_BYTES) await cache.put(keyFor(sha), new Response(blob)).catch(() => {});
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_CACHED))) await cache.delete(k); // oldest first
}

export async function clearBlobs() {
  memory.clear();
  try { if ("caches" in window) await caches.delete(CACHE_NAME); } catch { /* ignore */ }
}

/** git blob sha1 = sha1("blob <size>\0" + bytes). Same value GitHub reports for the file. */
export async function gitBlobSha(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(header.length + bytes.length);
  all.set(header);
  all.set(bytes, header.length);
  const digest = await crypto.subtle.digest("SHA-1", all);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
