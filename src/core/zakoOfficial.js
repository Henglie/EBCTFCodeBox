/*
 * zakoOfficial.js — 「杂鱼密语」官网闭源版算法完整复刻（encode / decode）。
 *
 * 逆向对象：https://zako.yhgf.top/ 的前端 bundle（page-CE0HK1NF.js，2026-10-22 拉取）。
 *
 * 当前 V6（载荷 magic=ZK5）：
 *   header = "ZK5" + [强度(0..3), 压缩(0/1), 雌小鬼强度(0..3), 方言(0..1), 属性(0..11), 场景(0..20)]
 *   salt   = 16 字节随机；iv = 12 字节随机
 *   key    = PBKDF2-SHA256(用户密钥, salt, 迭代) → AES-256-GCM
 *   cipher = AES-GCM(key, iv, AAD=header, plaintext 或 gzip(plaintext))
 *   payload= header ‖ salt ‖ iv ‖ ciphertext（含 16B GCM tag）
 *   承载  = 每个 payload 字节 → 一个不可见变体选择器（byte<16→U+FE00+b，否则 U+E0100+b-16），
 *            穿插在可见“杂鱼”对话的每个码点之后。可见文本不载数据，解码只收集变体选择器。
 *
 * 兼容 ZK2 / ZK3 / ZK4 旧头部（5 / 7 / 8 字节）；旧版 V5 无不可见字符，
 * 使用 16 槽可见模板 + base64url + rotor 混淆，本文件同样支持解码。
 *
 * 可见 V6 载体按官网算法（payload SHA-256 选场景/句序/起句/填充/收尾）生成，
 * 词表/模板数据在 zakoOfficialData.js（逆向自公开前端 bundle，版权归原站作者，
 * 仅用于算法互操作 / CTF 研究）。
 *
 * 纯逻辑，零 DOM；依赖 WebCrypto（浏览器 / Node 18+）与 compress.js 的 gzip 流。
 */
import { register } from "./registry.js";
import { streamCompress, streamDecompress } from "./compress.js";
import { decodeUtf8Lossless, finishBytesDecode, b64ToBytes } from "./bytesIo.js";
import { ZI, QI, SCENES, EA, HI, UI, WI, JI } from "./zakoOfficialData.js";

const DEFAULT_KEY = "zako-whisper-default-key";
const ITERATIONS = [60000, 180000, 420000, 800000];
const STRENGTH_NAMES = ["轻巧", "标准", "加强", "极强"];
const INTENSITY_NAMES = ["轻口", "经典", "嘴欠", "拉满"];
const DIALECT_NAMES = ["普通话", "河南话"];
const TRAIT_NAMES = ["经典雌小鬼", "萝莉妈妈", "萝莉女友", "傲娇大小姐", "黏人青梅", "元气妹妹", "三无少女", "天然呆", "腹黑军师", "中二魔王", "软萌女仆", "治愈天使"];
const SCENE_NAMES = ["自动换景", "日常拌嘴", "学习作业", "游戏开黑", "上班摸鱼", "早安叫醒", "晚安催睡", "吃饭投喂", "出门迟到", "聊天已读", "旅行迷路", "厨房翻车", "追剧吐槽", "考试复习", "编程报错", "运动健身", "下雨带伞", "约会等人", "网购拆箱", "拍照修图", "唱歌跑调"];
const B64U = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAGICS = [
  { name: "ZK2", bytes: [90, 75, 50], headLen: 5 },
  { name: "ZK3", bytes: [90, 75, 51], headLen: 7 },
  { name: "ZK4", bytes: [90, 75, 52], headLen: 8 },
  { name: "ZK5", bytes: [90, 75, 53], headLen: 9 },
];

function clampIndex(v, max, dflt = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : dflt;
}

function invisibleChar(byte) {
  const b = byte & 0xff;
  return b < 16 ? String.fromCodePoint(0xfe00 + b) : String.fromCodePoint(0xe0100 + b - 16);
}

function invisibleByte(ch) {
  const cp = ch.codePointAt(0);
  if (cp >= 0xfe00 && cp <= 0xfe0f) return cp - 0xfe00;
  if (cp >= 0xe0100 && cp <= 0xe01ef) return cp - 0xe0100 + 16;
  return -1;
}

/** 从任意文本提取不可见变体选择器承载的字节（官网 _a 同口径）。 */
export function extractInvisibleBytes(text) {
  const out = [];
  for (const ch of String(text == null ? "" : text)) {
    const b = invisibleByte(ch);
    if (b >= 0) out.push(b);
  }
  return new Uint8Array(out);
}

function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function randBytes(n) {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function") {
    throw new Error("当前环境缺少 crypto.getRandomValues，无法生成盐/IV");
  }
  const out = new Uint8Array(n);
  c.getRandomValues(out);
  return out;
}

async function sha256Bytes(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("当前环境不支持 WebCrypto（SHA-256）");
  return new Uint8Array(await subtle.digest("SHA-256", bytes));
}

async function deriveAesKey(key, salt, iterations) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw new Error("当前环境不支持 WebCrypto（PBKDF2 / AES-GCM）");
  const base = await subtle.importKey("raw", new TextEncoder().encode(String(key)), "PBKDF2", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* ---------------- V6 官方载体生成（逐句组合 + payload 哈希选句） ---------------- */

async function buildOfficialCarrier(payload, opt) {
  const h = await sha256Bytes(payload);
  const sceneRaw = clampIndex(opt.scene, 20, 0);
  const scene = sceneRaw === 0 ? 1 + h[1] % 20 : sceneRaw;
  const start = h[0] % 8;
  const step = [1, 3, 5, 7][h[5] % 4];
  const intensity = clampIndex(opt.intensity, 3, 1);
  const dialect = clampIndex(opt.dialect, 1, 0);
  const trait = clampIndex(opt.trait, 11, 0);
  let visible = "";
  let visibleLen = 0; // 码点数：避免每轮 Array.from(visible) 重扫全串（O(n²)）
  let d = 0;
  while (visibleLen < payload.length) {
    const page = Math.floor(d / 8);
    const sentence = SCENES[scene][(start + d * step) % 8];
    const f = (h[3] + Math.floor(d / 2) + page) % 4;
    const p = (h[11] + d + page * 2) % 8;
    const lead = (d % 2 === 0) ? ZI[trait][f] : QI[dialect][p];
    const tail = EA[intensity][dialect][(d + h[2]) % 4];
    const s = (lead + sentence).replace(/[。？！]$/u, "") + tail;
    visible += s;
    visibleLen += Array.from(s).length;
    d++;
  }
  return Array.from(visible, (ch, i) => i < payload.length ? ch + invisibleChar(payload[i]) : ch).join("");
}

/* ---------------- 旧版 V5 可见模板解码 ---------------- */

function templateToRegex(tpl) {
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let out = "";
  for (const part of String(tpl).split(/(\{\d+\})/)) {
    if (/^\{\d+\}$/.test(part)) out += "(.)";
    else out += esc(part);
  }
  return new RegExp("^" + out + "$", "u");
}

const V5_PATTERNS = [];
WI.forEach((list, intensity) => {
  for (const tpl of list) V5_PATTERNS.push({ re: templateToRegex(tpl), intensity });
});
for (const tpl of JI) V5_PATTERNS.push({ re: templateToRegex(tpl), intensity: 1 });

async function rotor(text, key, dir) {
  const h = await sha256Bytes(new TextEncoder().encode(String(key) + "|zako-rotor-v2|"));
  return Array.from(String(text), (ch, i) => {
    const idx = B64U.indexOf(ch);
    if (idx < 0) throw new Error("密文载荷格式不正确");
    const shift = (h[i % 32] + h[(i * 7 + 11) % 32] + i * 13) % 64;
    return B64U[(idx + dir * shift + 64) % 64];
  }).join("");
}

async function decodeVisibleV5(text, key) {
  const t = String(text == null ? "" : text).trim()
    .replace(/^杂鱼曰[♡♥]?\s*/u, "")
    .replace(/\s+/gu, "");
  if (!t) throw new Error("请输入杂语密文");
  const sentences = t.match(/[^？！。]+[？！。]/gu);
  if (!sentences || sentences.join("") !== t) throw new Error("发现无法识别的对话结构");
  let chars = "";
  let intensity = null;
  for (const sentence of sentences) {
    let matched = false;
    for (const { re, intensity: pi } of V5_PATTERNS) {
      const m = re.exec(sentence);
      if (!m) continue;
      for (let i = 0; i < 16; i++) {
        const ch = m[i + 1];
        const idx = HI[UI[i]].indexOf(ch);
        if (idx < 0) throw new Error("发现无法识别的载荷字：" + ch);
        chars += B64U[idx];
      }
      intensity = intensity === null ? pi : Math.max(intensity, pi);
      matched = true;
      break;
    }
    if (!matched) throw new Error("发现无法识别的对话：" + sentence.slice(0, 18));
  }
  const pad = B64U.indexOf(chars[0]);
  if (pad < 0 || pad > 15 || chars.length % 16 !== 0) throw new Error("密文长度标记不正确");
  const bodyChars = chars.slice(1, pad ? -pad : undefined);
  const unrotated = await rotor(bodyChars, key, -1);
  return { bytes: b64ToBytes(unrotated), intensity: intensity ?? 1 };
}

/* ---------------- 编解码 ---------------- */

async function zakoOfficialEncode(text, p = {}) {
  const str = String(text == null ? "" : text);
  if (!str.trim()) throw new Error("请先输入要加密的文字");
  const key = String(p.key || DEFAULT_KEY);
  const strength = clampIndex(p.strength, 3, 1);
  const intensity = clampIndex(p.intensity, 3, 1);
  const dialect = clampIndex(p.dialect, 1, 0);
  const trait = clampIndex(p.trait, 11, 0);
  const scene = clampIndex(p.scene, 20, 0);
  const compressMode = String(p.compress || "auto");
  if (!["auto", "gzip", "none"].includes(compressMode)) {
    throw new Error("压缩方式需为 auto/gzip/none");
  }
  const plain = new TextEncoder().encode(str);
  let body = plain;
  let compressed = false;
  if (compressMode !== "none") {
    let gz = null;
    try { gz = await streamCompress("gzip", plain); } catch { gz = null; }
    if (gz && (compressMode === "gzip" || gz.length + 4 < plain.length)) {
      body = gz;
      compressed = true;
    }
  }
  const header = Uint8Array.from([0x5a, 0x4b, 0x35, strength, compressed ? 1 : 0, intensity, dialect, trait, scene]);
  const salt = p.salt ? Uint8Array.from(p.salt) : randBytes(16);
  const iv = p.iv ? Uint8Array.from(p.iv) : randBytes(12);
  if (salt.length !== 16 || iv.length !== 12) throw new Error("测试用 salt 需 16 字节、iv 需 12 字节");
  const aes = await deriveAesKey(key, salt, ITERATIONS[strength]);
  const cipher = new Uint8Array(await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: header },
    aes,
    body
  ));
  const payload = concatBytes(header, salt, iv, cipher);
  return buildOfficialCarrier(payload, { intensity, dialect, trait, scene });
}

function parseHeader(bytes) {
  for (const m of MAGICS) {
    if (m.bytes.every((b, i) => bytes[i] === b)) return m;
  }
  return null;
}

function bytesToText(bytes) {
  const loss = decodeUtf8Lossless(bytes);
  if (loss.ok) return loss.text;
  return finishBytesDecode(bytes, { textMode: "escape", name: "zako-official" });
}

async function zakoOfficialDecode(text, p = {}) {
  const key = String(p.key || DEFAULT_KEY);
  let bytes = extractInvisibleBytes(text);
  let fallbackIntensity = 1;
  let source = "不可见变体选择器";
  if (!bytes.length) {
    // 旧版 V5：没有不可见字符，改用可见模板 + base64url + rotor。
    const v5 = await decodeVisibleV5(text, key);
    bytes = v5.bytes;
    fallbackIntensity = v5.intensity;
    source = "旧版 V5 可见模板";
  }
  const headerInfo = parseHeader(bytes);
  if (!headerInfo) throw new Error("载荷缺少 ZK2/ZK3/ZK4/ZK5 魔数（不是官方杂鱼密语或已损坏）");
  const headLen = headerInfo.headLen;
  const strength = bytes[3];
  const compressed = bytes[4] === 1;
  if (!(strength >= 0 && strength < ITERATIONS.length)) throw new Error("载荷中的强度档位非法");
  if (bytes.length < headLen + 16 + 12 + 16) throw new Error("载荷长度不足（密文被截断）");
  const isZK5 = headerInfo.name === "ZK5";
  const isZK4 = headerInfo.name === "ZK4";
  const isZK3 = headerInfo.name === "ZK3";
  const intensity = (isZK5 || isZK4 || isZK3) ? bytes[5] : fallbackIntensity;
  const dialect = (isZK5 || isZK4) ? bytes[6] : 0;
  const trait = isZK5 ? bytes[7] : 0;
  const scene = isZK5 ? bytes[8] : 0;
  if (intensity > 3) throw new Error("载荷中的雌小鬼强度非法");
  if (dialect > 1) throw new Error("载荷中的方言索引非法");
  if (trait > 11) throw new Error("载荷中的人物属性索引非法");
  if (scene > 20) throw new Error("载荷中的场景索引非法");
  const header = bytes.subarray(0, headLen);
  const salt = bytes.subarray(headLen, headLen + 16);
  const iv = bytes.subarray(headLen + 16, headLen + 28);
  const cipher = bytes.subarray(headLen + 28);
  let plain;
  try {
    const aes = await deriveAesKey(key, salt, ITERATIONS[strength]);
    plain = new Uint8Array(await globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: header },
      aes,
      cipher
    ));
  } catch {
    throw new Error("密钥不正确，或者密文已被改动（含不可见字符被平台过滤）");
  }
  if (compressed) {
    try { plain = await streamDecompress("gzip", plain); }
    catch { throw new Error("载荷标记为 gzip，但解压失败（密文损坏）"); }
  }
  const out = bytesToText(plain);
  if (p.report) {
    let actualScene = scene;
    if (scene === 0 && SCENES.length > 1) {
      const h = await sha256Bytes(bytes);
      actualScene = 1 + h[1] % (SCENES.length - 1);
    }
    return [
      "=== 杂鱼密语（官方版）===",
      `头部版本: ${headerInfo.name}（${source}）`,
      `强度: ${STRENGTH_NAMES[strength]}（PBKDF2 ${ITERATIONS[strength]} 次）`,
      `压缩: ${compressed ? "gzip" : "无"}`,
      `雌小鬼强度: ${INTENSITY_NAMES[intensity]}（${intensity}）`,
      `方言: ${DIALECT_NAMES[dialect]}（${dialect}）`,
      `人物属性: ${TRAIT_NAMES[trait]}（${trait}）`,
      `场景: ${SCENE_NAMES[actualScene]}（header=${scene}，实际=${actualScene}）`,
      `载荷字节: ${bytes.length}`,
      "--- 明文 ---",
      typeof out === "string" ? out : out.text,
    ].join("\n");
  }
  return out;
}

register({
  id: "zakoMystery",
  cat: "cn",
  name: "杂鱼密语（官方版）",
  desc: "完整复刻 zako.yhgf.top 闭源算法：PBKDF2-SHA256（6万/18万/42万/80万次）+ AES-256-GCM，16B 盐 + 12B IV，密文逐字节藏进不可见变体选择器（U+FE00–FE0F / U+E0100–E01EF），可见杂鱼对话按 payload 哈希从官网场景/人设/方言词表生成。支持 ZK2/ZK3/ZK4/ZK5 头部、gzip 与旧版 V5 可见模板解码；默认密钥为官网公开值，仅体验/CTF 用",
  params: [
    { key: "key", label: "密钥", type: "text", default: DEFAULT_KEY, placeholder: "官网默认 zako-whisper-default-key；CTF 请填题目密钥" },
    { key: "strength", label: "强度（PBKDF2 迭代）", type: "select", default: "1", options: [
      { value: "0", label: "轻巧（6 万次）" },
      { value: "1", label: "标准（18 万次）" },
      { value: "2", label: "加强（42 万次）" },
      { value: "3", label: "极强（80 万次）" },
    ] },
    { key: "intensity", label: "雌小鬼强度", type: "select", default: "1", options: INTENSITY_NAMES.map((n, i) => ({ value: String(i), label: n })) },
    { key: "dialect", label: "方言", type: "select", default: "0", options: DIALECT_NAMES.map((n, i) => ({ value: String(i), label: n })) },
    { key: "trait", label: "人物属性", type: "select", default: "0", options: TRAIT_NAMES.map((n, i) => ({ value: String(i), label: n })) },
    { key: "scene", label: "场景（encode 用）", type: "select", default: "0", options: SCENE_NAMES.map((n, i) => ({ value: String(i), label: n })) },
    { key: "compress", label: "压缩（encode 用）", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（gzip 更小才压）" },
      { value: "gzip", label: "强制 gzip" },
      { value: "none", label: "不压缩" },
    ] },
    { key: "report", label: "解码时输出诊断报告", type: "bool", default: false },
  ],
  encode: zakoOfficialEncode,
  decode: zakoOfficialDecode,
  detect: (t) => {
    // 只认「变体选择器字节的前 3 位是 ZK2..ZK5 魔数」——普通 emoji 的 VS16 也会
    // 落在 U+FE00..FE0F，不能只看有没有不可见字符，否则 magic 会对所有 emoji 误跑 PBKDF2。
    const b = extractInvisibleBytes(t);
    if (b.length < 4) return 0;
    return MAGICS.some((m) => m.bytes.every((v, i) => b[i] === v)) ? 0.95 : 0;
  },
});

export {
  DEFAULT_KEY as ZAKO_DEFAULT_KEY,
  ITERATIONS as ZAKO_ITERATIONS,
  STRENGTH_NAMES as ZAKO_STRENGTH_NAMES,
  INTENSITY_NAMES as ZAKO_INTENSITY_NAMES,
  DIALECT_NAMES as ZAKO_DIALECT_NAMES,
  TRAIT_NAMES as ZAKO_TRAIT_NAMES,
  SCENE_NAMES as ZAKO_SCENE_NAMES,
  invisibleChar, invisibleByte,
  zakoOfficialEncode, zakoOfficialDecode,
  buildOfficialCarrier as _zakoBuildCarrier,
  decodeVisibleV5 as _zakoDecodeVisibleV5,
  deriveAesKey as _zakoDeriveAesKey,
};
