/*
 * batchRun.js — 批处理内核：多条目预检 / 串行执行 / STORE 方式 ZIP 打包。
 *
 * 纯模块：不碰 DOM、不碰 window、不碰任何浏览器存储、不发网络请求、不取随机数。
 * 浏览器与 Node 直接 import 即可（证据脚本就在 Node 里跑本文件）。
 *
 * 三段职责：
 *   1) planBatch(items, opts)  只做预检，不读字节、不执行。产出可解释的
 *      { items, stats, rejected }，每个被拒项都带 reason 文本 —— 跳过必须写明原因，
 *      不允许静默丢条目。
 *   2) runBatch(plan, runner, opts)  按计划执行。单项失败不中断整批；取消后停止
 *      派发新项，已完成的保留；每项记 ms。
 *   3) buildZip(entries)  自己拼 ZIP（STORE，不压缩），不依赖 CompressionStream
 *      也不引第三方包 —— 产物必须能在任何解压器里打开，所以结构按规范逐字段写。
 *
 * ZIP 结构依据 PKWARE APPNOTE.TXT 6.3.10：
 *   4.3.7  本地文件头（Local file header）      签名 0x04034B50，定长 30 字节 + 名字
 *   4.3.12 中央目录项（Central directory header）签名 0x02014B50，定长 46 字节 + 名字
 *   4.3.16 中央目录结束记录（EOCD）              签名 0x06054B50，定长 22 字节
 *   4.4.4  通用位 11（bit 11，EFS）为 1 表示文件名与注释按 UTF-8 编码
 *   4.4.5  压缩方法 0 = STORE（已存储，不压缩）
 *   4.5.3  所有多字节字段一律小端（little-endian）
 *   CRC-32 按 ISO 3309 / ITU-T V.42 定义，反射多项式 0xEDB88320，初值与末异或
 *   均为 0xFFFFFFFF（RFC 1952 §8 的参考实现即此写法）。
 *
 * 为什么默认不压缩：批处理的输入多半是 CTF 附件，本身就是压缩包/图片，再压一次
 * 收益接近零；而 STORE 不引入任何压缩实现，产物字节与输入字节一一对应，出问题
 * 时能直接按偏移定位。代价是 ZIP 体积等于原始总字节。
 *
 * 可复现性：条目未给 mtime 时统一写 1980-01-01 00:00:00（DOS 时间戳能表达的最小
 * 值），不写当前时间 —— 同一批输入任何时候打包都必须得到逐字节相同的 ZIP，否则
 * 证据脚本无法用哈希对拍。给了 mtime 时按 UTC 字段填 DOS 时间（APPNOTE 4.4.6 本身
 * 说 DOS 时间不带时区，这里统一按 UTC 取值，避免同一份输入换台机器就变字节）。
 */

// 预检上限。取值理由见证据目录报告：单文件 8 MiB 覆盖常见 CTF 附件（图片、
// 小型压缩包、pyc），总 32 MiB 让内存里的 ZIP 峰值（原始 + 头部 + 拼接副本）
// 留在 100 MiB 以内，条目数 200 保证结果表还能一屏一屏翻完而不是卡死渲染。
export const BATCH_LIMITS = Object.freeze({
  maxFiles: 200,
  maxFileBytes: 8 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
});

const ENC = new TextEncoder();
const EMPTY = new Uint8Array(0);

// ZIP 定长字段宽度（APPNOTE 4.3.7 / 4.3.12 / 4.3.16）
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;        // 通用位 11：名字是 UTF-8
const VERSION_NEEDED = 20;       // 2.0：STORE + 目录条目所需的最低版本
const VERSION_MADE_BY = 0x0314;  // 高字节 3 = UNIX 宿主，低字节 0x14 = 版本 2.0
const NAME_MAX_BYTES = 255;      // 16 位名字长度字段，但解压器普遍按 255 截断
const FILE_ATTR = 0o100644 * 0x10000; // 普通文件 rw-r--r--
const DIR_ATTR = (0o40755 * 0x10000) + 0x10; // 目录 drwxr-xr-x + MS-DOS 目录位
const MAX32 = 0xffffffff;
const MAX16 = 0xffff;

/* ------------------------------------------------------------------ *
 * 字节归一化
 * ------------------------------------------------------------------ */

/**
 * 把 Uint8Array / ArrayBuffer / 任意 ArrayBufferView / number[] 统一成 Uint8Array。
 * 不是这几种就返回 null（由调用方决定是抛错还是走别的分支），不做隐式字符串转换。
 */
function asBytes(v, what) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) {
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const n = v[i];
      if (!Number.isInteger(n) || n < 0 || n > 255) {
        throw new TypeError(what + " 第 " + i + " 项不是 0..255 的整数（实际 " + String(n) + "）");
      }
      out[i] = n;
    }
    return out;
  }
  return null;
}

function nowMs() {
  if (typeof performance !== "undefined" && performance && typeof performance.now === "function") return performance.now();
  return Date.now();
}

function round3(n) {
  return Math.round(n * 1000) / 1000;
}

/** 把任意抛出物转成可读原文；Error.cause 链一起带出，避免只剩一句 "failed"。 */
function errText(e, depth) {
  const d = depth || 0;
  if (e === null || e === undefined) return "抛出了 " + String(e) + "（没有错误对象）";
  if (typeof e === "string") return e;
  if (e instanceof Error) {
    const msg = e.message ? String(e.message) : (e.name || "Error");
    if (d >= 4 || !e.cause) return msg;
    return msg + "（底层原因：" + errText(e.cause, d + 1) + "）";
  }
  try {
    return String(e);
  } catch (inner) {
    return "抛出物无法转成字符串（" + (inner && inner.message ? inner.message : "String() 失败") + "）";
  }
}

/* ------------------------------------------------------------------ *
 * CRC-32（IEEE 802.3 多项式，反射写法 0xEDB88320）
 * ------------------------------------------------------------------ */

let CRC_TABLE = null;

// 多项式 0x04C11DB7 的反射形式 0xEDB88320，初值 0xFFFFFFFF，末尾异或 0xFFFFFFFF。
// 与 zlib / Python zlib.crc32 / ZIP 条目 CRC 字段完全一致。
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

/**
 * 标准 CRC-32，返回无符号 32 位整数（0..4294967295）。
 * 入参接受 Uint8Array / ArrayBuffer / 任意视图 / number[]；其它类型抛 TypeError。
 */
export function crc32(bytes) {
  const b = asBytes(bytes, "crc32 入参");
  if (!b) throw new TypeError("crc32 需要 Uint8Array / ArrayBuffer / number[]，收到 " + Object.prototype.toString.call(bytes));
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* ------------------------------------------------------------------ *
 * 预检
 * ------------------------------------------------------------------ */

/** 条目名合法性检查。返回空串表示通过，否则返回给人看的原因。 */
function nameProblem(name) {
  if (typeof name !== "string") {
    return "条目名不是字符串（收到 " + (name === null ? "null" : typeof name) + "）";
  }
  if (name.length === 0) return "条目名为空";
  if (/[\u0000-\u001f\u007f]/.test(name)) return "条目名含控制字符，ZIP 里必须是可打印字节";
  if (name.indexOf("\\") >= 0) return "条目名含反斜杠：ZIP 规范以 / 分隔路径（APPNOTE 4.4.17.1）";
  if (name.charAt(0) === "/") return "条目名是绝对路径，ZIP 内条目必须是相对路径";
  if (/^[A-Za-z]:/.test(name)) return "条目名带盘符，不是 ZIP 内的相对路径";
  const isDir = name.charAt(name.length - 1) === "/";
  const body = isDir ? name.slice(0, -1) : name;
  if (body.length === 0) return "条目名只有 /，没有实际文件名";
  const segs = body.split("/");
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "") return "条目名含空路径段（连续 /）";
    if (segs[i] === "." || segs[i] === "..") return "条目名含 . 或 .. 路径段，解压时会逃出目标目录";
  }
  const n = ENC.encode(name).length;
  if (n > NAME_MAX_BYTES) return "条目名 UTF-8 后 " + n + " 字节，超过 255 字节上限";
  return "";
}

/**
 * 预检一批条目，不做任何 IO。
 *
 * @param {Array<{id?:string,name:string,size?:number,type?:string,bytes?:any,text?:string}>} items
 * @param {{limits?:{maxFiles?:number,maxFileBytes?:number,maxTotalBytes?:number}}} [opts]
 * @returns {{items:Array, stats:object, rejected:Array}}
 *
 * 返回的 items 每项：{ id, name, size, type, ok, reason, code, duplicate }
 *   ok=false 时 reason 必为可读文本，code 是稳定的机读分类（name/size/empty/count/total）。
 *   duplicate=true 表示与前面某个已接受条目同名：保留全部、不改名，只做标记。
 *   原条目对象挂在不可枚举的 payload 上（JSON 序列化时不会带出，执行阶段用它取字节）。
 */
export function planBatch(items, opts) {
  if (!Array.isArray(items)) {
    throw new TypeError("planBatch 需要条目数组，收到 " + Object.prototype.toString.call(items));
  }
  const o = (opts && typeof opts === "object") ? opts : {};
  const limits = {
    maxFiles: BATCH_LIMITS.maxFiles,
    maxFileBytes: BATCH_LIMITS.maxFileBytes,
    maxTotalBytes: BATCH_LIMITS.maxTotalBytes,
  };
  if (o.limits !== undefined && o.limits !== null) {
    if (typeof o.limits !== "object") throw new TypeError("opts.limits 必须是对象，收到 " + typeof o.limits);
    const keys = Object.keys(limits);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = o.limits[k];
      if (v === undefined) continue;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        throw new RangeError("opts.limits." + k + " 必须是非负有限数，收到 " + String(v));
      }
      limits[k] = Math.floor(v);
    }
  }

  const out = [];
  const rejected = [];
  const acceptedNames = new Set();
  const reasons = { name: 0, size: 0, empty: 0, count: 0, total: 0 };
  let accepted = 0;
  let acceptedBytes = 0;
  let bytesTotal = 0;
  let duplicates = 0;
  let emptyCount = 0;

  for (let i = 0; i < items.length; i++) {
    const src = (items[i] && typeof items[i] === "object") ? items[i] : {};
    const id = (typeof src.id === "string" && src.id) ? src.id : ("i" + i);
    const name = src.name;
    const type = (typeof src.type === "string") ? src.type : "";
    const isDir = (typeof name === "string") && name.charAt(name.length - 1) === "/";

    let code = "";
    let reason = nameProblem(name);
    if (reason) code = "name";

    // 字节载荷：优先 bytes，其次 text，最后才信调用方给的 size（只用于显示与限额）。
    let payload = null;
    let hasText = false;
    let size = 0;
    if (!code) {
      if (src.bytes !== undefined && src.bytes !== null) {
        try {
          payload = asBytes(src.bytes, "条目 " + id + " 的 bytes");
        } catch (e) {
          payload = null;
          code = "name";
          reason = "bytes 不是合法字节序列：" + errText(e);
        }
        if (!code && payload === null) {
          code = "name";
          reason = "bytes 类型不支持（需要 Uint8Array / ArrayBuffer / number[]，收到 " + Object.prototype.toString.call(src.bytes) + "）";
        }
      }
      if (!code && payload === null && typeof src.text === "string") {
        hasText = true;
        payload = ENC.encode(src.text);
      }
      if (!code) {
        if (payload !== null) size = payload.length;
        else if (typeof src.size === "number" && Number.isFinite(src.size) && src.size >= 0) size = Math.floor(src.size);
        else if (src.size !== undefined) {
          code = "size";
          reason = "size 不是非负有限数（收到 " + String(src.size) + "），且条目没有 bytes / text 可用来实测";
        } else size = 0;
      }
    }
    if (!code) bytesTotal += size;

    // 目录条目带内容属于自相矛盾的输入，直接拒绝而不是悄悄丢掉内容。
    if (!code && isDir && payload !== null && payload.length > 0) {
      code = "name";
      reason = "目录条目（名字以 / 结尾）不得携带内容，实际 " + payload.length + " 字节";
    }

    // 空目录 / 空条目：既没有 bytes 也没有 text，且大小为 0。
    // 显式给了一个长度 0 的 bytes 不算空 —— 那是用户明确要打包一个空文件。
    if (!code && size === 0 && payload === null && !hasText) {
      code = "empty";
      reason = "0 字节且无内容：空目录或空条目，打包后无法还原，先剔除";
    }

    if (!code && size > limits.maxFileBytes) {
      code = "size";
      reason = "单文件 " + size + " 字节超过上限 " + limits.maxFileBytes + " 字节";
    }

    if (!code && accepted >= limits.maxFiles) {
      code = "count";
      reason = "文件数已达上限 " + limits.maxFiles + " 条，本条不再接收";
    }

    if (!code && acceptedBytes + size > limits.maxTotalBytes) {
      code = "total";
      reason = "累计 " + (acceptedBytes + size) + " 字节超过总上限 " + limits.maxTotalBytes + " 字节";
    }

    const duplicate = !code && acceptedNames.has(name);
    if (!code) {
      accepted++;
      acceptedBytes += size;
      acceptedNames.add(name);
      if (duplicate) duplicates++;
    } else {
      reasons[code] = (reasons[code] || 0) + 1;
      if (code === "empty") emptyCount++;
    }

    const rec = {
      id,
      name: (typeof name === "string") ? name : String(name),
      size,
      type,
      ok: !code,
      reason: code ? reason : "",
      code: code || "ok",
      duplicate,
    };
    Object.defineProperty(rec, "payload", { value: src, enumerable: false, configurable: true });
    out.push(rec);
    if (code) rejected.push(rec);
  }

  return {
    items: out,
    stats: {
      total: items.length,
      accepted,
      rejected: rejected.length,
      duplicates,
      empty: emptyCount,
      bytesTotal,
      bytesAccepted: acceptedBytes,
      reasons,
      limits: { maxFiles: limits.maxFiles, maxFileBytes: limits.maxFileBytes, maxTotalBytes: limits.maxTotalBytes },
    },
    rejected,
  };
}

/* ------------------------------------------------------------------ *
 * 取消令牌
 * ------------------------------------------------------------------ */

/**
 * 取消令牌：cancel() 幂等，第一次给的原因生效。
 * 没有 Promise / 事件，只读一个布尔字段，runBatch 每个派发点检查一次。
 */
export function makeCancelToken() {
  const token = {
    cancelled: false,
    reason: "",
    cancel(reason) {
      if (token.cancelled) return token.reason;
      token.cancelled = true;
      const r = (typeof reason === "string") ? reason.trim() : "";
      token.reason = r || "已取消";
      return token.reason;
    },
  };
  return token;
}

/* ------------------------------------------------------------------ *
 * 执行
 * ------------------------------------------------------------------ */

/**
 * 按计划执行。默认串行（concurrency=1），可并发但要保持结果按计划顺序返回。
 *
 * @param {{items:Array}} plan            planBatch 的返回值
 * @param {(item:object, ctx:object)=>any} runner  单项执行器；item.payload 是原始条目
 * @param {{concurrency?:number,cancelToken?:object,onProgress?:Function}} [opts]
 * @returns {Promise<{results:Array,cancelled:boolean,reason:string,stats:object}>}
 *
 * results 只覆盖**预检通过**的条目（被拒项在 plan.rejected 里已带原因，不重复列）。
 * 取消时未派发的条目仍会出现在 results 里，带 skipped=true 与原因，不静默丢。
 */
export async function runBatch(plan, runner, opts) {
  if (!plan || !Array.isArray(plan.items)) {
    throw new TypeError("runBatch 需要 planBatch 的返回值（含 items 数组）");
  }
  if (typeof runner !== "function") {
    throw new TypeError("runBatch 需要 runner 函数，收到 " + typeof runner);
  }
  const o = (opts && typeof opts === "object") ? opts : {};
  const token = (o.cancelToken && typeof o.cancelToken === "object" && typeof o.cancelToken.cancelled === "boolean")
    ? o.cancelToken : null;
  let concurrency = (o.concurrency === undefined) ? 1 : o.concurrency;
  if (typeof concurrency !== "number" || !Number.isFinite(concurrency) || concurrency < 1) {
    throw new RangeError("opts.concurrency 必须是 >= 1 的有限数，收到 " + String(o.concurrency));
  }
  concurrency = Math.floor(concurrency);
  const onProgress = (typeof o.onProgress === "function") ? o.onProgress : null;

  const queue = [];
  for (let i = 0; i < plan.items.length; i++) {
    const it = plan.items[i];
    if (it && it.ok) queue.push(it);
  }

  const results = new Array(queue.length).fill(null);
  const warnings = [];
  const t0 = nowMs();
  let next = 0;
  let okCount = 0;
  let failCount = 0;

  function report(rec, item) {
    if (!onProgress) return;
    try {
      onProgress(item, rec);
    } catch (e) {
      // 进度回调自己坏了不该打断批处理，但也绝不静默：记进 warnings 一起返回。
      warnings.push("onProgress 抛错：" + errText(e));
    }
  }

  async function worker() {
    for (;;) {
      if (token && token.cancelled) return;
      const i = next;
      if (i >= queue.length) return;
      next = i + 1;
      const item = queue[i];
      const s = nowMs();
      let rec;
      try {
        const out = await runner(item, { index: i, total: queue.length, cancelToken: token, concurrency });
        rec = { id: item.id, ok: true, out, error: "", ms: round3(nowMs() - s) };
        okCount++;
      } catch (e) {
        rec = { id: item.id, ok: false, out: null, error: errText(e), ms: round3(nowMs() - s) };
        failCount++;
      }
      results[i] = rec;
      report(rec, item);
    }
  }

  const lanes = Math.min(concurrency, Math.max(1, queue.length));
  const running = [];
  for (let i = 0; i < lanes; i++) running.push(worker());
  await Promise.all(running);

  // 取消后剩下的条目：显式记为 skipped，带原因，不留空位。
  let skipped = 0;
  const cancelReason = (token && token.cancelled) ? token.reason : "";
  for (let i = next; i < queue.length; i++) {
    const item = queue[i];
    const rec = {
      id: item.id,
      ok: false,
      out: null,
      error: "未执行：" + (cancelReason || "已取消"),
      skipped: true,
      ms: 0,
    };
    results[i] = rec;
    skipped++;
    report(rec, item);
  }

  const cancelled = !!(token && token.cancelled);
  return {
    results,
    cancelled,
    reason: cancelled ? (cancelReason || "已取消") : "",
    stats: {
      total: plan.items.length,
      planned: queue.length,
      done: okCount + failCount,
      ok: okCount,
      failed: failCount,
      skipped,
      cancelled,
      ms: round3(nowMs() - t0),
      warnings,
    },
  };
}

/* ------------------------------------------------------------------ *
 * ZIP 打包（STORE）
 * ------------------------------------------------------------------ */

const DOS_DEFAULT_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01
const DOS_DEFAULT_TIME = 0;

/**
 * 把 Date / 毫秒数换成 DOS 时间戳（APPNOTE 4.4.6）。
 * 一律按 UTC 取值：本地时区参与会让同一份输入在不同机器上打出不同字节。
 * 1980 之前的日期无法表达，钳到 1980-01-01；2107 之后钳到 2107-12-31 23:59:58。
 */
function dosStamp(mtime, idx, label) {
  if (mtime === undefined || mtime === null) {
    return { time: DOS_DEFAULT_TIME, date: DOS_DEFAULT_DATE };
  }
  let d;
  if (mtime instanceof Date) d = mtime;
  else if (typeof mtime === "number" && Number.isFinite(mtime)) d = new Date(mtime);
  else throw new TypeError("第 " + idx + " 个条目 " + label + " 的 mtime 必须是 Date 或毫秒数，收到 " + typeof mtime);
  const ms = d.getTime();
  if (!Number.isFinite(ms)) throw new RangeError("第 " + idx + " 个条目 " + label + " 的 mtime 是无效时间");
  const year = d.getUTCFullYear();
  if (year < 1980) return { time: DOS_DEFAULT_TIME, date: DOS_DEFAULT_DATE };
  if (year > 2107) return { time: (23 << 11) | (59 << 5) | 29, date: (127 << 9) | (12 << 5) | 31 };
  const date = ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { time, date };
}

/**
 * 生成 ZIP 字节（STORE，不压缩）。
 *
 * @param {Array<{name:string, bytes?:any, text?:string, mtime?:Date|number}>} entries
 *        名字以 / 结尾的条目按目录项写（数据必须为空）。
 * @returns {Uint8Array}
 *
 * 空数组返回 22 字节的合法空 ZIP（只有 EOCD）。
 * 超过 32 位偏移或 16 位计数时抛 RangeError —— 本实现不写 ZIP64，宁可报错也不
 * 写出一个结构被截断的坏包。
 */
export function buildZip(entries) {
  if (!Array.isArray(entries)) {
    throw new TypeError("buildZip 需要条目数组，收到 " + Object.prototype.toString.call(entries));
  }
  if (entries.length > MAX16) {
    throw new RangeError("条目数 " + entries.length + " 超过 EOCD 的 16 位计数上限 " + MAX16 + "；本实现不写 ZIP64");
  }

  const chunks = [];       // 按写入顺序排：本地头 + 数据
  const centrals = [];
  let offset = 0;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e || typeof e !== "object") {
      throw new TypeError("第 " + i + " 个条目不是对象（收到 " + Object.prototype.toString.call(e) + "）");
    }
    const bad = nameProblem(e.name);
    if (bad) throw new TypeError("第 " + i + " 个条目名不合法：" + bad);
    const name = e.name;
    const isDir = name.charAt(name.length - 1) === "/";

    let data;
    if (e.bytes !== undefined && e.bytes !== null) {
      const b = asBytes(e.bytes, "第 " + i + " 个条目的 bytes");
      if (!b) {
        throw new TypeError("第 " + i + " 个条目 bytes 类型不支持（需要 Uint8Array / ArrayBuffer / number[]，收到 " + Object.prototype.toString.call(e.bytes) + "）");
      }
      data = b;
    } else if (typeof e.text === "string") {
      data = ENC.encode(e.text);
    } else if (isDir) {
      data = EMPTY;
    } else {
      throw new TypeError("第 " + i + " 个条目 " + name + " 既没有 bytes 也没有 text（目录条目请让名字以 / 结尾）");
    }
    if (isDir && data.length > 0) {
      throw new TypeError("第 " + i + " 个条目 " + name + " 是目录，但带了 " + data.length + " 字节内容");
    }
    if (data.length > MAX32) {
      throw new RangeError("第 " + i + " 个条目 " + name + " 有 " + data.length + " 字节，超过 32 位长度字段上限；本实现不写 ZIP64");
    }
    if (offset > MAX32) {
      throw new RangeError("第 " + i + " 个条目 " + name + " 的本地头偏移 " + offset + " 超过 32 位上限；本实现不写 ZIP64");
    }

    const nameBytes = ENC.encode(name);
    const crc = crc32(data);
    const flags = /[^\x00-\x7f]/.test(name) ? FLAG_UTF8 : 0;
    const stamp = dosStamp(e.mtime, i, name);

    // ---- 本地文件头 4.3.7：30 字节定长 + 名字 ----
    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, SIG_LOCAL, true);
    lv.setUint16(4, VERSION_NEEDED, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, 0, true);                 // 方法 0 = STORE
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);      // 压缩后大小 = 原始大小（STORE）
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);                // extra 长度 0
    lh.set(nameBytes, 30);

    // ---- 中央目录项 4.3.12：46 字节定长 + 名字 ----
    const cd = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, SIG_CENTRAL, true);
    cv.setUint16(4, VERSION_MADE_BY, true);
    cv.setUint16(6, VERSION_NEEDED, true);
    cv.setUint16(8, flags, true);
    cv.setUint16(10, 0, true);                // 方法 0 = STORE
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);                // extra
    cv.setUint16(32, 0, true);                // 注释
    cv.setUint16(34, 0, true);                // 起始磁盘号
    cv.setUint16(36, 0, true);                // 内部属性
    cv.setUint32(38, (isDir ? DIR_ATTR : FILE_ATTR) >>> 0, true);
    cv.setUint32(42, offset, true);           // 本地头偏移，必须回填真实值
    cd.set(nameBytes, 46);

    chunks.push(lh, data);
    centrals.push(cd);
    offset += lh.length + data.length;
  }

  let cdSize = 0;
  for (let i = 0; i < centrals.length; i++) cdSize += centrals[i].length;
  const cdOffset = offset;
  if (cdOffset > MAX32 || cdSize > MAX32) {
    throw new RangeError("中央目录偏移 " + cdOffset + " 或大小 " + cdSize + " 超过 32 位上限；本实现不写 ZIP64");
  }

  // ---- 中央目录结束记录 4.3.16：22 字节 ----
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(4, 0, true);                   // 本磁盘号
  ev.setUint16(6, 0, true);                   // 中央目录起始磁盘号
  ev.setUint16(8, centrals.length, true);     // 本磁盘条目数
  ev.setUint16(10, centrals.length, true);    // 总条目数
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, cdOffset, true);
  ev.setUint16(20, 0, true);                  // 注释长度

  const total = cdOffset + cdSize + 22;
  const out = new Uint8Array(total);
  let p = 0;
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], p);
    p += chunks[i].length;
  }
  for (let i = 0; i < centrals.length; i++) {
    out.set(centrals[i], p);
    p += centrals[i].length;
  }
  out.set(eocd, p);
  p += 22;
  if (p !== total) throw new Error("ZIP 拼装长度不一致：" + p + " != " + total);
  return out;
}
