const MEDIA_CACHE = "gaes-display-media-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);

async function notify(clientId, payload) {
  const client = await self.clients.get(clientId);
  if (client) client.postMessage(payload);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "CACHE_MEDIA") return;
  event.waitUntil(
    (async () => {
      const urls = [...new Set(Array.isArray(data.urls) ? data.urls : [])];
      const cache = await caches.open(MEDIA_CACHE);
      const existing = await cache.keys();
      await Promise.all(
        existing
          .filter((request) => !urls.includes(request.url))
          .map((request) => cache.delete(request)),
      );
      if (!urls.length) {
        await notify(event.source.id, {
          type: "CACHE_STATUS",
          status: "Streaming Only",
          progress: 0,
          cachedContentCount: 0,
        });
        return;
      }
      let completed = 0;
      let failed = 0;
      for (const url of urls) {
        try {
          const response = await fetch(url, { cache: "no-store", mode: "cors" });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          await cache.put(url, response.clone());
          completed += 1;
        } catch {
          failed += 1;
        }
        await notify(event.source.id, {
          type: "CACHE_STATUS",
          status: "Downloading",
          progress: Math.round(((completed + failed) / urls.length) * 100),
          cachedContentCount: completed,
        });
      }
      await notify(event.source.id, {
        type: "CACHE_STATUS",
        status: failed ? "Download Failed" : "Ready Offline",
        progress: 100,
        cachedContentCount: completed,
      });
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.open(MEDIA_CACHE).then(async (cache) => {
      const cached = await cache.match(event.request, { ignoreVary: true });
      if (cached) return cached;
      return fetch(event.request);
    }),
  );
});
