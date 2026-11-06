// BUILD-STAMP: 84a18ed5d448a7be
importScripts("./sw-assets.js", "./sw-packs.js");

// The asset generator synchronizes BUILD-STAMP with the resource revision.

const APP_VERSION = "0.1.14";
const CACHE_PREFIX = "ebctf-shell-";
const CACHE_NAME = `${CACHE_PREFIX}${APP_VERSION}-${self.__EBCTF_ASSET_REV}`;
const ASSETS = self.__EBCTF_ASSETS;
const BATCH_SIZE = 32;
const ASSET_SET = new Set(ASSETS);

// ---------------------------------------------------------------------------
// 离线增强包（T709）：包条目已全部被 EXCLUDE_RULES 剔除，默认首屏预缓存不受影响。
// 包只在用户点「安装」时下载，install / activate 都不预取（44.39 MiB 不能回到首屏）。
// 缓存独立前缀 + rev：条目一变 rev 变，旧包缓存由 activate 清理，不参与 shell 增量协商。
// ---------------------------------------------------------------------------
const PACK_CACHE_PREFIX = "ebctf-pack-";
const PACKS = self.__EBCTF_PACKS || [];
const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));
const PACK_ENTRY_OWNER = new Map();
for (const p of PACKS) for (const e of p.entries) PACK_ENTRY_OWNER.set(e, p.id);
const packCacheName = (p) => `${PACK_CACHE_PREFIX}${p.id}-${p.rev}`;
const PACK_CONCURRENCY = 4;
const PACK_JOBS = new Map();  // id -> { listeners, done, total, bytesDone, failed, result, promise }
const PACK_SCOPE = (self.registration && self.registration.scope)
  || (self.location && self.location.href)
  || "/";
const PACK_SCOPE_DIR = new URL(PACK_SCOPE).pathname.replace(/\/+$/, "");
const packEntryUrl = (entry) => new URL(entry.replace(/^\/+/, ""), PACK_SCOPE).href;
const siteRelPath = (pathname) =>
  pathname.startsWith(PACK_SCOPE_DIR + "/") ? pathname.slice(PACK_SCOPE_DIR.length) : pathname;

function packReply(port, source, message) {
  try {
    if (port && typeof port.postMessage === "function") port.postMessage(message);
    else if (source && typeof source.postMessage === "function") source.postMessage(message);
  } catch (e) {
    console.error("离线包消息回执失败:", e && e.message);
  }
}

function packBroadcast(job, message) {
  if (message.type === "cache-pack-done" || message.type === "cache-pack-error") job.result = message;
  for (const send of job.listeners) {
    try { send(message); } catch (e) { console.error("离线包进度回执失败:", e && e.message); }
  }
}

function packResponseBytes(res) {
  const n = Number(res.headers.get("content-length"));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function installPack(msg, port, source) {
  const id = msg && msg.id;
  const pack = PACK_BY_ID.get(id);
  const send = (m) => packReply(port, source, m);
  if (!pack) {
    send({ type: "cache-pack-error", id, reason: "未知离线包: " + String(id) });
    return;
  }
  if (msg.rev !== pack.rev) {
    send({
      type: "cache-pack-error",
      id,
      reason: "清单版本不一致（页面 " + String(msg.rev) + " / 缓存 " + pack.rev + "），请刷新页面后重试",
    });
    return;
  }

  let job = PACK_JOBS.get(id);
  if (job) {
    job.listeners.add(send);
    send(job.result || {
      type: "cache-pack-progress",
      id,
      done: job.done,
      total: job.total,
      bytesDone: job.bytesDone,
      reused: true,
    });
    try { await job.promise; } finally { job.listeners.delete(send); }
    return;
  }

  job = {
    listeners: new Set([send]),
    done: 0,
    total: pack.entries.length,
    bytesDone: 0,
    failed: [],
    result: null,
    promise: null,
  };
  PACK_JOBS.set(id, job);

  const run = async () => {
    const cache = await caches.open(packCacheName(pack));
    let cursor = 0;
    let fatal = null;
    const progress = () => packBroadcast(job, {
      type: "cache-pack-progress",
      id: pack.id,
      done: job.done,
      total: job.total,
      bytesDone: job.bytesDone,
      failed: job.failed.length,
    });
    const worker = async () => {
      while (!fatal) {
        const index = cursor++;
        if (index >= pack.entries.length) return;
        const entry = pack.entries[index];
        const url = packEntryUrl(entry);
        try {
          const hit = await cache.match(url);
          if (hit) {
            job.done++;
            job.bytesDone += packResponseBytes(hit);
            progress();
            continue;
          }
          let res;
          try {
            res = await fetch(new Request(url, { cache: "reload" }));
          } catch (e) {
            job.failed.push({ url: entry, status: 0, reason: (e && e.name) + ": " + (e && e.message) });
            job.done++;
            progress();
            continue;
          }
          if (!res.ok) {
            job.failed.push({ url: entry, status: res.status });
            try { if (res.body) await res.body.cancel(); } catch { /* 已消费或不可取消 */ }
            job.done++;
            progress();
            continue;
          }
          await cache.put(url, res);
          job.done++;
          job.bytesDone += packResponseBytes(res);
          progress();
        } catch (e) {
          fatal = e;
          return;
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(PACK_CONCURRENCY, pack.entries.length) },
      worker,
    ));
    if (fatal) {
      packBroadcast(job, {
        type: "cache-pack-error",
        id: pack.id,
        reason: (fatal && fatal.name ? fatal.name + ": " : "") + (fatal && fatal.message ? fatal.message : String(fatal)),
        done: job.done,
        total: job.total,
        failed: job.failed,
      });
      return;
    }
    packBroadcast(job, {
      type: "cache-pack-done",
      id: pack.id,
      ok: job.failed.length === 0,
      done: job.done,
      total: job.total,
      failed: job.failed,
    });
  };

  job.promise = run().catch((e) => {
    packBroadcast(job, {
      type: "cache-pack-error",
      id: pack.id,
      reason: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)),
      done: job.done,
      total: job.total,
      failed: job.failed,
    });
  }).finally(() => {
    PACK_JOBS.delete(id);
  });
  try { await job.promise; } finally { job.listeners.delete(send); }
}

async function removePack(msg, port, source) {
  const id = msg && msg.id;
  const send = (m) => packReply(port, source, m);
  if (!PACK_BY_ID.has(id)) {
    send({ type: "uncache-pack-done", id, ok: false, reason: "未知离线包" });
    return;
  }
  try {
    const prefix = `${PACK_CACHE_PREFIX}${id}-`;
    const keys = await caches.keys();
    const owned = keys.filter((key) => key.startsWith(prefix));
    await Promise.all(owned.map((key) => caches.delete(key)));
    send({ type: "uncache-pack-done", id, ok: true, removed: owned.length });
  } catch (e) {
    send({
      type: "uncache-pack-done",
      id,
      ok: false,
      reason: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)),
    });
  }
}

async function reportPackStatus(msg, port, source) {
  const id = msg && msg.id;
  const send = (m) => packReply(port, source, m);
  const pack = PACK_BY_ID.get(id);
  if (!pack) {
    send({ type: "pack-status", id, ok: false, reason: "未知离线包", cached: [], total: 0 });
    return;
  }
  try {
    const cacheName = packCacheName(pack);
    let cached = [];
    if (await caches.has(cacheName)) {
      const cache = await caches.open(cacheName);
      const keys = await cache.keys();
      const owned = new Set(pack.entries);
      cached = keys.map((request) => siteRelPath(new URL(request.url).pathname)).filter((p) => owned.has(p));
    }
    send({
      type: "pack-status",
      id: pack.id,
      rev: pack.rev,
      ok: true,
      cached,
      total: pack.entries.length,
    });
  } catch (e) {
    send({
      type: "pack-status",
      id,
      ok: false,
      reason: (e && e.name ? e.name + ": " : "") + (e && e.message ? e.message : String(e)),
      cached: [],
      total: pack.entries.length,
    });
  }
}

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
  "/src/vendor/",            // 编辑器/PGP/条码内核（与 gen_sw_assets 的 EXCLUDE_RULES 同步）
  "/addons/",                // 官方插件包（默认不启用，用户显式加载时才取；同上同步）
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

    // 旧 rev 的包缓存必须清掉：字体包一份就 31 MiB，不能永久占配额。
    // 升级后旧包会被判为未安装，由页面侧 pack-status 对账兜住（localStorage 不当作已装判据）。
    const keepPack = new Set(PACKS.map(packCacheName));
    const packKeys = await caches.keys();
    await Promise.all(packKeys
      .filter((key) => key.startsWith(PACK_CACHE_PREFIX) && !keepPack.has(key))
      .map((key) => caches.delete(key)));
  })());
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (data === "SKIP_WAITING") { self.skipWaiting(); return; }
  if (!data || typeof data !== "object") return;
  const port = event.ports && event.ports[0];
  if (data.type === "cache-pack") event.waitUntil(installPack(data, port, event.source));
  else if (data.type === "uncache-pack") event.waitUntil(removePack(data, port, event.source));
  else if (data.type === "pack-status") event.waitUntil(reportPackStatus(data, port, event.source));
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
    // 204/空响应是 Chromium 对 .bin + force-cache 的下载处理产物，不能当真值返回，
    // 否则一次毒化会让该按需资产在线/离线永久空缓存。
    if (cached && cached.status !== 204) return cached;
    const fillable = ASSET_SET.has(`.${siteRel}`) || isRuntimeCacheFirst(siteRel);
    try {
      const response = await fetch(request);
      if (response.ok && response.status !== 204 && fillable) {
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch {
      // 包条目未命中且断网：不能静默 504（页面只会看到 Failed to fetch）。
      // 503 + JSON + X-EBCTF-Offline-Pack + pack-miss 消息，三者齐备才算可解释。
      const packId = PACK_ENTRY_OWNER.get(siteRel);
      if (packId) {
        try {
          const clients = await self.clients.matchAll({ type: "window" });
          for (const client of clients) client.postMessage({ type: "pack-miss", packId, url: siteRel });
        } catch { /* 页面已关闭时忽略 */ }
        return new Response(
          JSON.stringify({ error: "offline-pack-missing", packId, url: siteRel }),
          {
            status: 503,
            headers: {
              "Content-Type": "application/json; charset=utf-8",
              "X-EBCTF-Offline-Pack": packId,
            },
          },
        );
      }
      return new Response("离线且未缓存：" + siteRel, {
        status: 504,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
