importScripts("./sw-assets.js");

const APP_VERSION = "0.1.4";
const CACHE_PREFIX = "ebctf-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-${self.__EBCTF_ASSET_REV}`;
const ASSETS = self.__EBCTF_ASSETS;
const BATCH_SIZE = 32;

async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  for (let i = 0; i < ASSETS.length; i += BATCH_SIZE) {
    const batch = ASSETS.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (url) => {
      const request = new Request(url, { cache: "reload" });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`PWA 预缓存失败: ${url} (${response.status})`);
      await cache.put(request, response);
    }));
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAll());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put("./index.html", response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (await caches.match("./index.html")) ||
          new Response("离线缓存尚未安装完成。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return new Response("", { status: 504 });
    }
  })());
});
