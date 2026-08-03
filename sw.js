/*
 * sw.js — 离线壳 Service Worker（T223 · PWA，署名：F3 2026-07-11）。
 *
 * 目标：可安装 + 离线可用。纯前端零外发——只缓存同源 GET，跨源请求一律放行不拦截。
 *
 * 策略：
 *   1. install：预缓存核心壳（index.html + 关键 CSS/JS 入口），失败不阻断安装（部分资源可选）。
 *   2. activate：清理旧版本 cache，立即接管。
 *   3. fetch：仅处理同源 GET。
 *      - 导航请求（HTML）：网络优先，失败回退缓存的 index.html（离线壳）。
 *      - 其余同源静态资源：cache-first + 后台回填（stale-while-revalidate 简化版）。
 *      - 跨源 / 非 GET：不拦截，交浏览器默认处理（保证零外发语义不被 SW 破坏）。
 *
 * 归并说明（交 M）：
 *   - 本文件置于项目根，scope 为 "/"，覆盖整站。
 *   - 需在 index.html 或 main.js 中注册：见文件末尾注释的注册片段。
 *   - 与 manifest.json 配套：manifest 提供可安装元数据，sw 提供离线能力，二者独立。
 *
 * 红线：
 *   - 只新建根级 sw.js，不碰 index.html / main.js（注册片段以注释交 M 归并）。
 *   - 绝不缓存或转发跨源请求，恪守「零外发」。
 *   - 缓存版本号 CACHE_VER 变更即触发全量刷新，避免旧壳卡死。
 */

const CACHE_VER = "ebctf-shell-0.1.2";

const CORE_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/main.js",
  "./src/ui/fonts.css",
  "./src/ui/theme.css",
  "./src/ui/app.css",
  "./src/ui/topbar-responsive.css",
  "./src/ui/recipeView.css",
  "./src/ui/exhaustiveView.css",
  "./src/ui/envPanel.css",
  "./src/ui/universalViewer.css",
  "./src/ui/codeImageViewer.css",
  "./src/ui/pluginPanel.css",
  "./src/ui/decodeStrength.css",
  "./public/icons/app-icon.svg",
  "./public/icons/app-icon-maskable.svg",
  "./public/icons/app-icon-192.png",
  "./public/icons/app-icon-512.png",
  "./public/logo.webp",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VER);
      await Promise.allSettled(
        CORE_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch(() => null)
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VER).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE_VER);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const shell = await caches.match("./index.html");
          if (shell) return shell;
          return new Response("离线：暂无可用缓存壳。", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) {
        fetch(req)
          .then((fresh) => {
            if (fresh && fresh.ok) {
              caches.open(CACHE_VER).then((c) => c.put(req, fresh.clone()));
            }
          })
          .catch(() => {});
        return cached;
      }
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(CACHE_VER);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        return new Response("", { status: 504 });
      }
    })()
  );
});

/*
 * ===== 交 M 归并的注册片段（加到 index.html 的 main.js 之后，或 main.js 顶部）=====
 *
 * <link rel="manifest" href="manifest.json" />
 * <meta name="theme-color" content="#8f3d33" />
 *
 * <script>
 *   if ("serviceWorker" in navigator) {
 *     window.addEventListener("load", () => {
 *       navigator.serviceWorker.register("sw.js").catch(() => {});
 *     });
 *   }
 * </script>
 */
