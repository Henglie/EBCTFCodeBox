/*
 * randSource.js — 全局随机源抽象（零 DOM / 零 i18n / 原生 ESM / 可 Node 直测）。
 *
 * 定位（随机源方案 §1）：只抽象「取原始随机字节」这一件事。各调用点自有的无偏
 * 采样（拒绝采样 / randomBelow）保留不动，因此本抽象是「薄抽象」——只换字节来源，
 * 能逐字节证明默认档零回归。
 *
 * 档位（RAND_MODES）：
 *   system（默认）：crypto.getRandomValues 的直通包装，与现状逐字节等价；
 *   mixed（混合）  ：只增不减——每次真取 32B 系统熵作 ikm，userSeed 经 SHA-256 作 salt，
 *                    HKDF-SHA-256 派生（纯 JS 同步实现，不依赖 async subtle）；
 *   custom（自定义）：输出完全由 userSeed 决定（可复现；用户自担）；
 *   server（服务器）：从预取池同步供给；未就绪一律抛错，绝不静默回落（真实联网取数在 B3）。
 *
 * 鼠标熵 = **辅助项**（非档位）：用户在弹窗里晃动鼠标采集本地熵；开启后叠加到 mixed/custom/server
 * 三档输出上（HKDF 再混合，只增不减，结果不弱于原档）。用途之一：在**不受信任的系统**上，
 * 不让系统 RNG 成为单点——自带熵源，用着不烧心。未采集却开启 → 显式抛错。
 *
 * 红线（随机源规划 §1）：
 *   1. 默认档永不变——不开增强时行为与现状逐字节相同；
 *   2. 只增不减——mixed 档系统熵始终参与，用户输入只是「加料」；
 *   3. 禁止静默降级——任何档取不到随机性 → 显式报错（带底层原因）；
 *   4. core 不读 localStorage——当前配置由 UI/main 层经 setRandConfig 注入进程内单例。
 *
 * 零外发：system / mixed / custom 三档纯本地；server 档联网由用户在 UI 显式配置（真实联网取数在 core/randServer.js，仅经用户在页面内确认条确认后由 UI 调用）。
 */

import { fetchServerRandom } from "./randServer.js";

/** 档位模式常量（鼠标熵不是档位，而是可叠加的辅助项，见 _mouseAux）。 */
export const RAND_MODES = Object.freeze({
  SYSTEM: "system", // 默认档：crypto.getRandomValues（与现状逐字节等价）
  MIXED: "mixed",   // 混合档：用户输入经 HKDF 与系统熵混合（只增不减）
  CUSTOM: "custom", // 完全自定义档：用户自担（可复现 / 教学）
  SERVER: "server", // 自配置随机数服务器档：默认关闭，用户主动联网（真实取数由联网 server 档提供）
});

const _VALID_MODES = new Set([RAND_MODES.SYSTEM, RAND_MODES.MIXED, RAND_MODES.CUSTOM, RAND_MODES.SERVER]);

// 进程内配置单例（core 不读 localStorage；由 UI/main 层注入）。
// mouse/mouseOn = 鼠标熵辅助项：用户在弹窗里采集的本地熵；开启后叠加到 mixed/custom/server 三档（只增不减）。
const _CONFIG = { mode: RAND_MODES.SYSTEM, seed: "", endpoint: "", auth: "", mouse: "", mouseOn: false };
// 配置变更订阅：UI 层注册以「持久化 + 刷新档位标识」；core 只回调、不碰存储。
// 纯回调集合，零 DOM / 零 i18n；订阅函数返回退订句柄。
const _onChange = new Set();
// server 档预取池（此处只做接口与状态；真实预热由联网 server 档提供）。
let _serverPool = null;
let _serverReady = false;

const _te = new TextEncoder();

// ============================================================
// 纯 JS 同步 SHA-256 / HMAC-SHA-256 / HKDF-SHA-256（RFC 6234 / RFC 5869）
// 自包含实现：不依赖 crypto.subtle（async）、不依赖任何 core 模块（避免惰载副作用）。
// 权威对拍见 zero_regression.mjs（node:crypto）与工具对拍脚本（Python hashlib/hmac）。
// ============================================================
const _SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function _rotr32(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

/** 纯 JS SHA-256：输入字节 → 32 字节摘要。 */
function _sha256Bytes(msg) {
  const ml = msg.length;
  const total = Math.ceil((ml + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg, 0);
  buf[ml] = 0x80;
  const bits = BigInt(ml) * 8n;
  for (let i = 0; i < 8; i++) buf[total - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (_rotr32(w[i - 15], 7) ^ _rotr32(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (_rotr32(w[i - 2], 17) ^ _rotr32(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (_rotr32(e, 6) ^ _rotr32(e, 11) ^ _rotr32(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + _SHA256_K[i] + w[i]) >>> 0;
      const S0 = (_rotr32(a, 2) ^ _rotr32(a, 13) ^ _rotr32(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff; out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

/** 纯 JS HMAC-SHA-256：key/msg 字节 → 32 字节。 */
function _hmacSha256(key, msg) {
  const k = key.length > 64 ? _sha256Bytes(key) : key;
  const kp = new Uint8Array(64); kp.set(k);
  const ip = new Uint8Array(64 + msg.length);
  const op = new Uint8Array(64 + 32);
  for (let i = 0; i < 64; i++) { ip[i] = kp[i] ^ 0x36; op[i] = kp[i] ^ 0x5c; }
  ip.set(msg, 64);
  const inner = _sha256Bytes(ip);
  op.set(inner, 64);
  return _sha256Bytes(op);
}

/** RFC 5869 HKDF-Expand（纯 JS 同步）。 */
function _hkdfExpand(prk, info, len) {
  const out = new Uint8Array(len);
  let t = new Uint8Array(0);
  let pos = 0, ctr = 1;
  while (pos < len) {
    const inp = new Uint8Array(t.length + info.length + 1);
    inp.set(t, 0); inp.set(info, t.length); inp[t.length + info.length] = ctr & 0xff;
    t = _hmacSha256(prk, inp);
    const take = Math.min(t.length, len - pos);
    out.set(t.subarray(0, take), pos);
    pos += take; ctr++;
  }
  return out;
}

// ============================================================
// 底层系统熵（任何配置都不得绕过）
// ============================================================

/**
 * 底层系统熵：永远走 crypto.getRandomValues，任何档位配置都不得绕过。
 * 无 CSPRNG → 显式抛错（带底层原因），绝不回落 Math.random。
 * @param {number} n 字节数
 * @returns {Uint8Array} 长度恰为 n
 */
export function systemBytes(n) {
  const len = _checkLen(n);
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error(
      "无可用密码学安全随机源（crypto.getRandomValues 不可用）；" +
      "拒绝以非安全随机生成随机数（禁静默回落）"
    );
  }
  const b = new Uint8Array(len);
  c.getRandomValues(b);
  return b;
}

function _checkLen(n) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`随机字节数必须为非负整数，收到 ${n}`);
  return n;
}

// ============================================================
// 配置单例（由 UI/main 层注入；core 不读 localStorage）
// ============================================================

/**
 * 注入当前配置（UI/main 层在启动与设置变更时调用）。
 * @param {{mode?:string, seed?:string, endpoint?:string, auth?:string}} cfg
 */
export function setRandConfig(cfg) {
  const c = cfg || {};
  const mode = c.mode == null || String(c.mode) === "" ? RAND_MODES.SYSTEM : String(c.mode);
  if (!_VALID_MODES.has(mode)) {
    throw new Error(`未知随机源档位：${mode}（合法：system/mixed/custom/server）`);
  }
  _CONFIG.mode = mode;
  _CONFIG.seed = c.seed == null ? "" : String(c.seed);
  _CONFIG.endpoint = c.endpoint == null ? "" : String(c.endpoint);
  _CONFIG.auth = c.auth == null ? "" : String(c.auth);
  // mouse / mouseOn 例外：未显式给出时**保留现值**（鼠标熵是用户采集的辅助项，不是普通配置项；
  // 其它调用点如 randomSecure.run 只传 mode/seed/endpoint/auth，不应把已采集的鼠标熵清掉）。
  if (c.mouse != null) _CONFIG.mouse = String(c.mouse);
  if (c.mouseOn != null) _CONFIG.mouseOn = c.mouseOn === true;
  // server 配置变更 → 预取池失效（避免用旧池冒充新配置）。
  _serverPool = null;
  _serverReady = false;
  // 通知订阅者（UI 持久化 + 刷新档位标识）。回调异常不得影响配置生效。
  for (const cb of _onChange) { try { cb(getRandConfig()); } catch { /* 订阅方异常忽略 */ } }
}

/**
 * 订阅随机源配置变更。返回退订函数。回调收到当前配置深拷贝。
 * 供 UI 层在 op 内切换档位（randomSecure.run 调 setRandConfig）后持久化 + 刷新标识；
 * core 自身不持久化、不读 localStorage。
 * @param {(cfg:{mode:string,seed:string,endpoint:string,auth:string})=>void} cb
 * @returns {()=>void} 退订句柄
 */
export function onRandConfigChange(cb) {
  if (typeof cb !== "function") return () => {};
  _onChange.add(cb);
  return () => { _onChange.delete(cb); };
}

/** 读取当前生效配置（深拷贝，防外部改内存单例）。 */
export function getRandConfig() {
  return { mode: _CONFIG.mode, seed: _CONFIG.seed, endpoint: _CONFIG.endpoint, auth: _CONFIG.auth, mouse: _CONFIG.mouse, mouseOn: _CONFIG.mouseOn };
}

/** 当前模式字符串。 */
export function getMode() { return _CONFIG.mode; }

/** server 档是否就绪（endpoint 非空且预取池已预热）。 */
export function isServerReady() {
  return !!_CONFIG.endpoint && _serverReady && !!_serverPool && _serverPool.length > 0;
}

/** 鼠标熵辅助项是否已采集（mouse 非空）。 */
export function isMouseReady() {
  return String(_CONFIG.mouse || "").length > 0;
}

/** 鼠标熵辅助项是否启用（开启且已采集）。 */
export function isMouseAuxOn() {
  return _CONFIG.mouseOn === true && isMouseReady();
}

/** SHA-256(utf8 字符串) → 小写 hex（供 UI 把采集到的鼠标样本压成定长种子；纯本地）。 */
export function sha256HexOfUtf8(s) {
  return Array.from(_sha256Bytes(_te.encode(s == null ? "" : String(s)))).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ============================================================
// 四档取字节
// ============================================================

function _resolveMode(override) {
  if (override && override.mode != null) {
    const m = String(override.mode);
    if (m !== "" && m !== "inherit") {
      if (!_VALID_MODES.has(m)) throw new Error(`未知随机源档位：${m}（合法：system/mixed/custom/server）`);
      return m;
    }
  }
  return _CONFIG.mode;
}

function _resolveSeed(override) {
  if (override && override.seed != null) return String(override.seed);
  return _CONFIG.seed;
}

/** mixed 档：ikm = 每次真取的 32B 系统熵；salt = SHA256("ebctf-rand-mixed" || userSeed)；HKDF 派生。 */
function _mixedBytes(n, seed) {
  const ikm = systemBytes(32); // 关键：每次调用都真取系统熵（只增不减）
  const salt = _sha256Bytes(_te.encode("ebctf-rand-mixed" + (seed == null ? "" : String(seed))));
  const prk = _hmacSha256(salt, ikm);
  return _hkdfExpand(prk, _te.encode("ebctf-rand-mixed"), n);
}

/** custom 档：输出完全由 userSeed 决定（可复现；用户自担）。 */
function _customBytes(n, seed) {
  const s = seed == null ? "" : String(seed);
  const ikm = _te.encode(s);
  const salt = _te.encode("ebctf-rand-custom" + s);
  const prk = _hmacSha256(salt, ikm);
  return _hkdfExpand(prk, _te.encode("ebctf-rand-custom"), n);
}

/** 鼠标熵辅助：把已取到的字节再经 HKDF 用鼠标采集熵作 salt 混合（只增不减，结果不弱于原字节）。 */
function _mouseAux(bytes, mouse) {
  const salt = _sha256Bytes(_te.encode("ebctf-rand-mouse-aux" + mouse));
  const prk = _hmacSha256(salt, bytes);
  return _hkdfExpand(prk, _te.encode("ebctf-rand-mouse-aux"), bytes.length);
}

/** server 档：同步消费预取池；未就绪 / 缓冲不足一律抛错（禁静默回落）。 */
function _serverBytes(n) {
  if (!_serverReady || !_serverPool) {
    throw new Error("随机数服务器缓冲未就绪：请先在 UI 连接并预热（server 档禁静默回落）");
  }
  if (_serverPool.length < n) {
    throw new Error(`随机数服务器缓冲不足：需 ${n} 字节，余 ${_serverPool.length} 字节（禁静默回落）`);
  }
  const out = _serverPool.slice(0, n);
  _serverPool = _serverPool.slice(n);
  return out;
}

/**
 * 取 n 个随机字节（同步）。
 * 鼠标熵为**辅助项**：开启（mouseOn）且已采集时，叠加到 mixed/custom/server 三档输出上
 * （system 档不叠加——system 即「不增强」）。未采集却开启 → 显式抛错（禁静默回落）。
 * @param {number} n
 * @param {{mode?:string, seed?:string}} [override] 每 op 覆盖（省略则用全局配置）
 * @returns {Uint8Array} 长度恰为 n
 */
export function randomBytes(n, override) {
  const len = _checkLen(n);
  const mode = _resolveMode(override);
  let out;
  if (mode === RAND_MODES.SYSTEM) out = systemBytes(len);
  else if (mode === RAND_MODES.MIXED) out = _mixedBytes(len, _resolveSeed(override));
  else if (mode === RAND_MODES.CUSTOM) out = _customBytes(len, _resolveSeed(override));
  else if (mode === RAND_MODES.SERVER) out = _serverBytes(len);
  else throw new Error(`未知随机源档位：${mode}`);
  // 鼠标熵辅助（仅增强档；system 档不叠加）
  if (mode !== RAND_MODES.SYSTEM && _CONFIG.mouseOn) {
    if (!isMouseReady()) {
      throw new Error("已启用「附加鼠标熵」但尚未采集：请先点击「采集鼠标随机性」完成采集（禁静默回落）");
    }
    out = _mouseAux(out, _CONFIG.mouse);
  }
  return out;
}

/**
 * server 档预取池快照（拷贝；未就绪返回 null）。
 * 用途：自定义实现跑在 Worker 里时，主线程把已预热的池快照一并送过去，
 * Worker 端的 randSource 据此复现同源取数（Worker 内无 fetch，不能自己联网）。
 */
export function snapshotServerPool() {
  return _serverReady && _serverPool ? _serverPool.slice() : null;
}

/**
 * 直接注入 server 档预取池（**仅供 Worker 端桥接用**，主线程不调用；主线程走 warmupServer）。
 * bytes 为空 → 置为未就绪（取数将显式抛错，不静默回落）。
 */
export function installServerPool(bytes) {
  if (!bytes) { _serverPool = null; _serverReady = false; return; }
  _serverPool = bytes instanceof Uint8Array ? bytes.slice() : new Uint8Array(bytes);
  _serverReady = _serverPool.length > 0;
}

/**
 * server 档预取（联网 server 档）：UI 在用户于页面内确认条显式确认启用后、
 * 以及每次运行 op 前调用。真实联网取数在 core/randServer.js（唯一网络出口）；
 * 取回的字节填入预取池，core 侧 randomBytes 同步消费（_serverBytes 语义不变）。
 * 失败 → 抛错（带底层原因），绝不回落；池耗尽语义与既有契约一致（不足即抛错）。
 * @param {{endpoint?:string, auth?:string, count?:number, customField?:string, signal?:AbortSignal}} [opts]
 *   省略 endpoint/auth 时用当前注入配置；count 缺省 32（上限 1024）；customField 为用户自定义响应字段名。
 * @returns {Promise<number>} 实际入池字节数
 */
export async function warmupServer(opts) {
  const o = opts || {};
  const endpoint = o.endpoint != null && String(o.endpoint) !== "" ? String(o.endpoint) : _CONFIG.endpoint;
  if (!endpoint) throw new Error("随机数服务器未配置 endpoint（server 档默认关闭）");
  const bytes = await fetchServerRandom({
    endpoint,
    auth: o.auth != null ? String(o.auth) : _CONFIG.auth,
    count: o.count,
    customField: o.customField,
    signal: o.signal,
  });
  _serverPool = bytes;
  _serverReady = true;
  return bytes.length;
}
