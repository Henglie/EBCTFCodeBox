// BUILD-STAMP: 4d6fd83388746bda
importScripts("./sw-assets.js");

// The asset generator synchronizes BUILD-STAMP with the resource revision.

const APP_VERSION = "0.1.9";
const CACHE_PREFIX = "ebctf-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-${self.__EBCTF_ASSET_REV}`;
const ASSETS = self.__EBCTF_ASSETS;
const BATCH_SIZE = 32;
const ASSET_SET = new Set(ASSETS);

// ---------------------------------------------------------------------------
// 按需资产（M4，2026-08-26）：下列前缀/路径的内容不变资产已从预缓存清单剔除
// （tools/gen_sw_assets.mjs 的 EXCLUDE_RULES，两处保持同步），首次访问走
// 「网络 → 回填本缓存」，此后 cache-first：命中直接返回、不网络验证（省 RTT）。
// 在线用过一次即离线可用（rt_browser_ids.mjs ⑤ 断网段依赖此回填）。
// ---------------------------------------------------------------------------
const RUNTIME_CACHE_FIRST = [
  "/public/fonts/",          // 天珩全量平面（subset 同时在预缓存，命中即回等价）
  "/public/wasm/",           // 7zz/bkcrack/asm/disasm 引擎
  "/public/data/",           // ids.dat
  "/public/codeimages/",     // 对照图（manifest 保留预缓存）
  "/public/vendor/katex/",   // KaTeX dist
  "/public/models/",         // byteStat CNN 权重
  "/public/contributors/",   // 贡献者头像
  "/src/i18n/locales/",      // 非 zh/en 语言包（动态 import）
  "/src/core/eduContent.en.js", // 英文 EDU 科普层入口（动态 import）
  "/src/core/edu-en/",       // 英文 EDU 科普层分片
  "/public/logo.webp",
  "/public/icons/logo.png",
  "/public/favicon.ico",
];
const isRuntimeCacheFirst = (pathname) =>
  RUNTIME_CACHE_FIRST.some((p) => pathname === p || pathname.startsWith(p));

// 增量预缓存（2026-09-25）：预缓存清单随构建批次重生，BUILD-STAMP 变化即触发整轮更新。
// 若每次都对全部条目 cache:"reload" 强制重下（约 694 项 / 13.6MB），用户在每次构建批次后
// 的首次刷新都要等整轮传输完成。故改为条件请求协商：同名条目在**上一版缓存**里已存在时，
// 带 If-None-Match / If-Modified-Since 复验；304 则直接复用旧响应（服务端逐字节确认未变），
// 只有真变更的文件才传新内容。旧缓存不存在（首次安装）仍走全量。缓存名含 REV，新旧
// 缓存并存期恰为本函数运行期，activate 末尾统一清理旧缓存。
async function precacheAll() {
  const cache = await caches.open(CACHE_NAME);
  const previous = new Map();
  try {
    const keys = await caches.keys();
    for (const key of keys) {
      if (!key.startsWith(CACHE_PREFIX) || key === CACHE_NAME) continue;
      const oldCache = await caches.open(key);
      for (const request of await oldCache.keys()) {
        if (!previous.has(request.url)) previous.set(request.url, oldCache);
      }
    }
  } catch { /* 旧缓存不可读则退化为全量下载 */ }
  for (let i = 0; i < ASSETS.length; i += BATCH_SIZE) {
    const batch = ASSETS.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (url) => {
      const request = new Request(url, { cache: "reload" });
      let response = null;
      const oldCache = previous.get(new URL(url, self.registration.scope).href);
      if (oldCache) {
        const old = await oldCache.match(url);
        if (old && (old.headers.has("ETag") || old.headers.has("Last-Modified"))) {
          const validators = new Headers();
          if (old.headers.has("ETag")) validators.set("If-None-Match", old.headers.get("ETag"));
          if (old.headers.has("Last-Modified")) validators.set("If-Modified-Since", old.headers.get("Last-Modified"));
          try {
            const revalidated = await fetch(new Request(url, { cache: "reload", headers: validators }));
            if (revalidated.status === 304) response = old;
            else if (revalidated.ok) response = revalidated;
          } catch { /* 网络层异常落到下面的全量路径 */ }
        }
      }
      if (!response) response = await fetch(request);
      if (!response.ok) throw new Error(`PWA 预缓存失败: ${url} (${response.status})`);
      await cache.put(request, response);
    }));
  }
}

// install 不等预缓存完成（H1 瘦身后配套时序修正，2026-08-26）：立即进入 activating，
// 尽早 clients.claim() 接管页面——否则 9.6MB/506 项预缓存下载期间页面发出的按需
// fetch（如首次切拼字 tab 取 ids.dat）不被本 SW 拦截、无法回填，在线用过≠离线可用。
// 预缓存挪到 activate 里做；其间未命中的请求走「网络 → 回填」，与预缓存结果最终一致。
self.addEventListener("install", () => {});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();               // 先接管（毫秒级），再后台预缓存
    try {
      await precacheAll();
    } catch (e) {
      // 预缓存失败不挂掉 activate（挂了 SW 线程会被终止，fetch 全裸奔）；
      // 静态站 404 才会走到这里，DevTools console 可见，下次 SW 更新重试。
      console.error("PWA 预缓存失败:", e && e.message);
    }
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
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

  // cache-first：预缓存资产与按需资产运行时回填条目统一「命中缓存直接返回、
  // 不网络验证」（按需资产见 RUNTIME_CACHE_FIRST，内容不变，省每次访问的再验证 RTT）；
  // 未命中走「网络 → 回填缓存」，回填后即进入命中分支。
  // 门槛比较用「站点相对路径」：本地/RAR 根路径部署 scope='/'，GitHub Pages 挂在
  // 子路径 scope='/EBCTFCodeBox/'——拿绝对 pathname 直接比对会全体失配，按需回填
  // 整链断（在线用过≠离线可用，含语言包/字库/WASM）。剥掉 scope 目录前缀后两种部署同判。
  const SCOPE_DIR = new URL(self.registration.scope).pathname.replace(/\/+$/, "");
  const siteRel = url.pathname.startsWith(SCOPE_DIR + "/") ? url.pathname.slice(SCOPE_DIR.length) : url.pathname;
  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fillable = ASSET_SET.has(`.${siteRel}`) || isRuntimeCacheFirst(siteRel);
    try {
      const response = await fetch(request);
      if (response.ok && fillable) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      return new Response("", { status: 504 });
    }
  })());
});
