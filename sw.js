// sw.js
// Service worker with ONE job: receive files shared from other apps on
// Android (the "share_target" in manifest.webmanifest).
//
// Android sends the files as a POST to ./share-target. A static site can't
// accept a POST, so we catch it here, park the files in a cache called
// "docsync-share", and redirect to the app. app.js picks them up and uploads
// them (after unlock, if the device is locked).
//
// It deliberately caches nothing else, so the app is never served stale.

const SHARE_CACHE = "docsync-share";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "POST" || !url.pathname.endsWith("/share-target")) return; // normal network

  event.respondWith((async () => {
    const form = await event.request.formData();
    const files = form.getAll("files").filter((f) => typeof f === "object" && "name" in f);
    const cache = await caches.open(SHARE_CACHE);
    await Promise.all(files.map((f, i) =>
      cache.put(
        new URL(`shared/${Date.now()}-${i}`, self.registration.scope).href,
        new Response(f, { headers: { "content-type": f.type || "application/octet-stream", "x-name": encodeURIComponent(f.name) } })
      )
    ));
    return Response.redirect(new URL(`./?shared=${files.length}`, self.registration.scope).href, 303);
  })());
});
