/*
 * registry.js — 功能注册表（全项目声明式核心）。
 *
 * 每个功能 = 一个 op 对象：{ id, cat, name, desc, params, encode?, decode?, run? }。
 * UI 完全由本注册表驱动——左侧分类树、参数表单、双向按钮全自动渲染
 * 加新功能只在此注册一条 + 写算法，UI 零改动。这是声明式驱动相比硬编码 UI 的关键优势。
 *
 * 字段约定：
 * id 全局唯一短标识（英文，用于路由 / 收藏 / URL）
 * cat 分类 id（见 CATEGORIES）
 * name 显示名（中文）
 * desc 一句话说明（中文，可空）
 * params 参数声明数组（见下），无参留空数组
 * encode(text, p) / decode(text, p) 双向；只有一向的只填一个
 * run(text, p) 单向工具（如哈希），填了 run 就不显示双向切换
 * detect(text) 可选，一键解码用的识别指纹，返回 0..1 置信度
 *
 * 产物协议（T361，2026-09-02）：encode/decode/run 可返回对象
 * { text: string, files: [{ name, mime, bytes|dataUrl }] } —— text 进输出区，
 * files 渲染为「⬇ 下载」按钮（云端部署时下载前弹本地桥/敏感数据警告，见 main.js cloudWarnGate）。
 * 返回字符串的 op 行为不变；⚠ 参与 magic 一键解码的 op 勿返回对象（Worker 路径不认）。
 * bytes 支持 Uint8Array / number[]；dataUrl 自动解字节并推 MIME。
 *
 * 参数声明 params 每项：
 * { key, label, type: 'text'|'number'|'select'|'bool', default, options?, placeholder? }
 */

// ---- 分类定义（左侧菜单分组，顺序即显示顺序） ----
export const CATEGORIES = [
  { id: "home",    name: "首页 · 一把梭", icon: "bolt",           pinned: true },
  { id: "base",    name: "Base 系列",     icon: "tag" },
  { id: "text",    name: "文本 / 传输编码", icon: "translate" },
  { id: "fancy",   name: "花式 / CTF 编码", icon: "auto_awesome" },
  { id: "esolang", name: "深奥编程语言", icon: "terminal" },
  { id: "cn",      name: "中文 / 本土编码", icon: "language" },
  { id: "classic", name: "古典密码",       icon: "history_edu" },
  { id: "block",   name: "现代密码·分组",   icon: "grid_view" },
  { id: "stream",  name: "现代密码·流",     icon: "waves" },
  { id: "asym",    name: "现代密码·非对称", icon: "key" },
  { id: "modern",  name: "现代密码·其他",   icon: "lock" },
  { id: "hash",    name: "哈希 / 校验",    icon: "fingerprint" },
  { id: "radix",   name: "进制 / 字符集",  icon: "calculate" },
  { id: "analysis",name: "分析 / 爆破",    icon: "query_stats" },
  { id: "crypto",  name: "密码攻击",       icon: "vpn_key" },
  { id: "forensic",name: "取证 / 文件",    icon: "travel_explore" },
  { id: "data",    name: "数据结构 / 序列化", icon: "web" },
  { id: "stego",   name: "隐写 / 图像",    icon: "image" },
 // ---- 本地桥·外部 exe 专用分类（requiresBridge，仅 Windows + 起桥可用），按用途细分 ----
 // bridgeLang（语言执行）2026-09-13 恒烈裁删：成员已全部移植纯 JS/wasm，分类空转。
 // bridgeForensic（检测取证）2026-09-13 撤销：ntfsstreams GUI 被 adsTool（forensic 类）替代。
  { id: "bridgeStego",    name: "本地桥·隐写嵌入", icon: "visibility_off" },
];

// 注册表本体。各算法模块 import register 往里塞。
export const OPS = [];
const _byId = new Map();

// 合法分类 id 集合（cat 校验用）。CATEGORIES 是单一真相源。
const _catIds = new Set(CATEGORIES.map((c) => c.id));

/** 取第一个非 registry/registerAll 的调用方模块 URL（文件不带 :行:列）。失败返回 null。 */
function callerModuleUrl() {
  try {
    const stack = new Error().stack || "";
    for (const line of stack.split("\n").slice(1)) {
      const m = line.match(/(?:https?|file):\/\/[^)\s]+/);
      if (!m) continue;
      const url = m[0].replace(/:\d+(?::\d+)?$/, ""); // 去掉尾部 :行:列
      if (url.includes("/registry.js") || url.includes("/registerAll.js")) continue;
      return url;
    }
  } catch { /* 忽略 */ }
  return null;
}

/** 注册一个 op（重复 id 抛错，防覆盖）。 */
export function register(op) {
  if (!op || typeof op.id !== "string" || !op.id) {
    throw new Error(`op 必须有非空字符串 id`);
  }
  if (_byId.has(op.id)) throw new Error(`重复注册 op id: ${op.id}`);
 // cat 合法性校验：不在 CATEGORIES 里的 cat 会导致 op 静默不显示，直接抛错拦住。
  if (!_catIds.has(op.cat)) {
    throw new Error(
      `op ${op.id} 的 cat "${op.cat}" 不在 CATEGORIES 中（合法值：${[..._catIds].join("/")}）`
    );
  }
  if (!op.encode && !op.decode && !op.run) {
    throw new Error(`op ${op.id} 必须至少有 encode / decode / run 之一`);
  }
  op.params = op.params || [];
 // 记录 op 注册所在模块的源文件 URL（编辑器「权威实现」面板 fetch 用）。
 // 用调用栈定位调用方模块；找不到置 null（插件/异常环境不崩）。
  if (!("sourceFile" in op)) {
    op.sourceFile = callerModuleUrl();
  }
 // params 契约校验：漏写 key（例如误写成 id）会让界面输入永远传不进算法——静默失效，必须拦住。
  const _seenKeys = new Set();
  for (const d of op.params) {
    if (!d || typeof d.key !== "string" || !d.key) {
      throw new Error(
        `op ${op.id} 的参数声明缺少 key 字段（拿到 ${JSON.stringify(d)}）——` +
        `参数必须写成 { key, label, type, default }，写成 id 会导致用户输入无法传入算法`
      );
    }
    if (_seenKeys.has(d.key)) throw new Error(`op ${op.id} 的参数 key 重复: ${d.key}`);
    _seenKeys.add(d.key);
    if ("def" in d && !("default" in d)) {
      throw new Error(`op ${op.id} 的参数 ${d.key} 误写了 def，应为 default`);
    }
  }
  _byId.set(op.id, op);
  OPS.push(op);
  return op;
}

export function getOp(id) {
  return _byId.get(id);
}

export function opsByCat(catId) {
  return OPS.filter((o) => o.cat === catId);
}

// ============ 算法族（T380，恒烈 2026-09-03 拍板）============
// 非对称等分类同算法族 op 太多（如 PGP 8 档），侧栏不逐条展开：聚合为「族显示名 ×N」一条，
// 工作区内用族滑块换档。方案形态：每一档滑块 = 一个独立 op（族内 op 实现零改动），
// 不是「单 op 多 mode」。族字段由各算法 op 声明：family = 族 id，familyLabel = 档位短名 key
// （ASCII，文案查 i18n fam.lbl.<familyLabel>）。不带 family 的 op 不参与聚合，渲染路径不变。

// 族显示名（技术名 zh/en 相同，不做 i18n）
export const FAMILY_NAMES = {
  md: "MD",
  crc: "CRC",
  sha: "SHA",
  shake: "SHAKE",
  pgp: "PGP / OpenPGP",
  // T427 v2（恒烈 2026-09-08 拍板）：base64/base58 家族并入本尊，长尾仅保留 Unicode Base 4 项组
  base64: "Base64 家族",
  base58: "Base58 家族",
  // 恒烈 2026-09-08 特许 F1：base64steg/base32steg 自成一族「Base 隐写」，
  // 解决「Base32 隐写在 Base64 族、Base32 本尊却独立」的错位（手法同源：padding 冗余位藏 offset）
  basesteg: "Base 隐写",
  unicodebase: "Unicode Base",
  ecdsa: "ECDSA",
  mlkem: "ML-KEM",
  mldsa: "ML-DSA",
  slhdsa: "SLH-DSA",
  ed448: "Ed448",
  x448: "X448",
  gost: "GOST 签名",
  jws: "JWS",
  jwe: "JWE",
  paseto: "PASETO",
  sm2: "SM2 国密",
  paillier: "Paillier 同态",
  dsa: "DSA",
  schnorr: "Schnorr",
  ed25519: "Ed25519",
  x25519: "X25519",
  sm9: "SM9 国密标识",
  xwing: "X-Wing",
  hqc: "HQC",
  ntru: "NTRU",
  bls: "BLS 签名",
  rot: "ROT",
  qqxiuzi: "千千秀字",
  xiangyue: "想曰 XiangYue",
  rc: "RC",
  blake: "BLAKE",
  des: "DES",
  cast: "CAST",
  gostdigest: "GOST 摘要",
  jwt: "JWT",
  flask: "Flask Session",
  rsa: "RSA",
  xmss: "XMSS",
  lms: "LMS",
  merkle: "Merkle",
  lsag: "LSAG",
  elgamal: "ElGamal",
  rsaatk: "RSA 攻击",
  zip: "ZIP",
  pcap: "PCAP",
  mc: "Minecraft",
  usb: "USB 流量",
  tea: "TEA",
  a5: "A5",
  hc: "HC",
  grain: "Grain",
  aes: "AES",
  sm4: "SM4",
  brainloller: "Brainloller",
  braincopter: "Braincopter",
  qr: "QR 码",
  gif: "GIF",
  png: "PNG",
  arnold: "Arnold",
  jpeg: "JPEG",
  bmp: "BMP",
};

/**
 * T417：从 run 函数源码取首参名。兼容六种签名形态——匿名箭头 (a,p)=>、async 箭头、
 * 具名 function f(a,p){、async function、方法简写 run(a,p){、生成器 function* f(a,p)。
 * 参数表用括号平衡提取（默认值里可能含括号/花括号），再取顶层首个参数名并剥默认值。
 * 返回 null 表示签名无法解析 → 调用方保守按 text 处理，绝不因解析失败判 none。
 */
function runFirstParam(src) {
  const head = /^(?:async\s+)?(?:function\s*(?:\*\s*)?(?:[A-Za-z_$][\w$]*)?\s*)?/.exec(src);
  let i = head[0].length;
  if (src[i] !== "(") {
    const open = src.indexOf("(");
    if (open === -1) return null;
    i = open;
  }
  let depth = 0, end = -1;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { depth--; if (depth === 0) { end = j; break; } }
  }
  if (end === -1) return null;
  return src.slice(i + 1, end).split(",")[0].trim().split("=")[0].trim();
}

/**
 * 主输入框渲染模式推导（T399，恒烈 2026-09-04 拍板：无需主输入的 op 不再显示巨型输入框）。
 * 返回 "text"（显示主输入框）| "none"（隐藏，渲染层换细提示条）。
 * 优先级：显式 op.io 覆盖 > 静态推导 > 默认 text。
 * 静态推导：run-only（无 encode/decode）且 run 首参从未在函数体被引用 → none。
 *   推导按「取首参名 → 查函数体是否引用该名」做，与参数叫什么无关（混淆/压缩改名后依然成立）。
 *   T417：签名解析只认箭头形态曾把具名/async/简写形态全部误判 none（首参明明被引用），
 *   现改走 runFirstParam 六形态兼容；无法解析的未知签名保守按 text（宁可多显示）。
 * 结果缓存在 op._ioMode（op 对象生命周期=会话）。fields 机制（多输入框）不受本函数影响。
 */
export function inferIoMode(op) {
  if (!op) return "text";
  if (op.io === "none" || op.io === "text") return op.io;
  if (op._ioMode) return op._ioMode;
  let mode = "text";
  if (typeof op.encode !== "function" && typeof op.decode !== "function" && typeof op.run === "function") {
    try {
      const src = op.run.toString().trim();
      const first = runFirstParam(src);
      const body = src.slice(src.indexOf("{") + 1);
      if (first !== null && (!first || first === "p" || !new RegExp("\\b" + first + "\\b").test(body))) mode = "none";
    } catch { /* toString/解析异常按 text 处理，宁可多显示 */ }
  }
  op._ioMode = mode;
  return mode;
}

/**
 * 取某分类下的族分组（op 按声明序归组，组按首成员声明序）。
 * 返回 [{ family, name(族显示名), ops:[op…] }]；不带 family 的 op 不进结果；
 * family 字段缺失（并行添加期间/老数据）时返回空数组，调用方按无族渲染，天然容错。
 */
export function familyGroup(catId) {
  const groups = [];
  const byFam = new Map();
  for (const op of opsByCat(catId)) {
    const fam = op && op.family;
    if (typeof fam !== "string" || !fam) continue;
    let g = byFam.get(fam);
    if (!g) {
      g = { family: fam, name: FAMILY_NAMES[fam] || fam, ops: [] };
      byFam.set(fam, g);
      groups.push(g);
    }
    g.ops.push(op);
  }
  return groups;
}

/** 用参数默认值构造一份初始参数对象。 */
export function defaultParams(op) {
  const p = {};
  for (const d of op.params) p[d.key] = d.default;
  return p;
}

// ============ 插件扩展点（运行时增删，供 pluginHost 用；内置算法不走这些） ============

/**
 * 运行时新增一个分类（插件专用）。内置分类在 CATEGORIES 声明式定义，插件的分类在此动态挂。
 * 已存在同 id 直接返回旧的（幂等），不覆盖内置。
 */
export function addCategory(cat) {
  if (!cat || typeof cat.id !== "string" || !cat.id) {
    throw new Error(`分类必须有非空字符串 id`);
  }
  if (_catIds.has(cat.id)) return CATEGORIES.find((c) => c.id === cat.id);
  const rec = { id: cat.id, name: cat.name || cat.id, icon: cat.icon || "extension" };
  CATEGORIES.push(rec);
  _catIds.add(cat.id);
  return rec;
}

/**
 * 注销一个 op（插件卸载用）。从 OPS 与 _byId 移除。返回是否移除成功。
 * 内置 op 不应调用此函数（无 __plugin 标记的会抛错，防误删内置算法）。
 */
export function unregister(id) {
  const op = _byId.get(id);
  if (!op) return false;
  if (!op.__plugin) throw new Error(`拒绝注销内置 op: ${id}（仅插件 op 可注销）`);
  _byId.delete(id);
  const i = OPS.indexOf(op);
  if (i >= 0) OPS.splice(i, 1);
  return true;
}

/** 是否为插件动态注册的 op（带 __plugin 标记）。 */
export function isPluginOp(id) {
  const op = _byId.get(id);
  return !!(op && op.__plugin);
}

/**
 * 移除一个运行时新增的分类（插件卸载用）。内置分类（前 16 个声明式定义的）不可移除。
 * 返回是否移除成功。
 */
const _builtinCatIds = new Set(CATEGORIES.map((c) => c.id));
export function removeCategory(catId) {
  if (_builtinCatIds.has(catId)) throw new Error(`拒绝移除内置分类: ${catId}`);
  const i = CATEGORIES.findIndex((c) => c.id === catId);
  if (i < 0) return false;
  CATEGORIES.splice(i, 1);
  _catIds.delete(catId);
  return true;
}
