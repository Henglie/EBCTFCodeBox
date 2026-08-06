/*
 * stegpy.js — stegpy (stegv3) 无损载体隐写（cat:'stego'）。
 *
 * 与 stegpy 工具格式逐字节兼容（参考其参考实现核对的算法）：
 * - 消息帧：MAGIC "stegv3"(6B) + 消息长度(4B 大端) + 文件名长度(1B) + [文件名] + 消息
 * - 像素承载：图像 RGB 字节流扁平排列（行序），按 divisor=8/bits 步长把消息字节
 *   的 bit 平面交错写入（bits=1/2/4 由像素首字节 bit4-5 标记：0/16/32）。
 * - 可选密码：PBKDF2-HMAC-SHA256(10 万次, salt16) → base64url 32B key → Fernet
 *   （AES-128-CBC + HMAC-SHA256），salt 前置 16 字节。
 *
 * 字节序注意：宿主是 RGB 3 通道（PNG 解码 RGBA 后去掉 alpha），与 PIL convert("RGB")
 * 的行序一致——4 通道会把位平面交错错位。encode 输出经零依赖 PNG 编码器（RGBA）。
 *
 * 红线：算法层零 UI 依赖；零外发；件内自注册。
 * 契约：register({ id:"stegpy", cat:"stego", name, desc, encode, decode, acceptsBytes })。
 */
import { register } from "./registry.js";
import { decodePNG, rgbaToDataURL, dataURLToBytes } from "./stegoPixels.js";
import { fernetEncrypt, fernetDecrypt } from "./modern.js";

const MAGIC = new TextEncoder().encode("stegv3");

// ---- base64url（保留 padding，对齐 Python urlsafe_b64encode 的 44 字符 Fernet key）----
function bytesToB64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  }
  const b64 = typeof Buffer !== "undefined" ? Buffer.from(s, "binary").toString("base64") : globalThis.btoa(s);
  return b64.replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlToBytes(s) {
  s = String(s).trim().replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = typeof Buffer !== "undefined" ? Buffer.from(s, "base64").toString("binary") : globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- PBKDF2-HMAC-SHA256（对齐参考实现：iterations=100000, dkLen=32）----
async function pbkdf2Sha256(passwordBytes, salt, iterations = 100000) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（密码模式需要）");
  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

// ---- 位平面交错编解码（host = RGB 字节流）----
/**
 * bits=1/2/4。消息字节数 ≤ floor(host.length/divisor)。
 * 只清前 divisor*len(message) 字节的低位，其余宿主字节原样保留。
 */
function stegpyEncodeBits(host, msg, bits) {
  const divisor = 8 / bits;
  const mask = (1 << bits) - 1;
  const maxMsg = Math.floor(host.length / divisor);
  if (msg.length > maxMsg) throw new Error("载体空间不足：消息 " + msg.length + "B 超过上限 " + maxMsg + "B（bits=" + bits + "）");
  const out = new Uint8Array(host.length);
  out.set(host);
  const clearMask = 256 - (1 << bits);
  for (let i = 0; i < divisor * msg.length; i++) out[i] &= clearMask;
  for (let i = 0; i < divisor; i++) {
    for (let j = 0; j < msg.length; j++) {
      out[i + j * divisor] |= (msg[j] >> (bits * i)) & mask;
    }
  }
  const operand = bits === 1 ? 0 : bits === 2 ? 16 : 32;
  out[0] = (out[0] & 0xcf) | operand;
  return out;
}

/** 从宿主首字节 bit4-5 探测 bits（0=1bit, 16=2bit, 32=4bit），返回消息字节流。 */
function stegpyDecodeBits(host) {
  const bits = 2 ** ((host[0] & 48) >> 4);
  if (bits !== 1 && bits !== 2 && bits !== 4) throw new Error("宿主首字节标记非法（bits=" + bits + "）");
  const divisor = 8 / bits;
  const mask = (1 << bits) - 1;
  const msgLen = Math.floor(host.length / divisor);
  const msg = new Uint8Array(msgLen);
  for (let i = 0; i < divisor; i++) {
    for (let k = 0; k < msgLen; k++) {
      msg[k] |= (host[i + k * divisor] & mask) << (bits * i);
    }
  }
  return msg;
}

// ---- 消息帧打包/解析 ----
function formatMessage(message, filename) {
  const msgLen = message.length;
  const head = new Uint8Array(11);
  head.set(MAGIC, 0);
  head[6] = (msgLen >>> 24) & 0xff;
  head[7] = (msgLen >>> 16) & 0xff;
  head[8] = (msgLen >>> 8) & 0xff;
  head[9] = msgLen & 0xff;
  if (filename) {
    const fname = new TextEncoder().encode(filename);
    head[10] = fname.length;
    const out = new Uint8Array(11 + fname.length + msgLen);
    out.set(head, 0);
    out.set(fname, 11);
    out.set(message, 11 + fname.length);
    return out;
  }
  const out = new Uint8Array(11 + msgLen);
  out.set(head, 0);
  out.set(message, 11);
  return out;
}

/** 解析消息帧 → { text } 或 { filename, text }；MAGIC 不符/长度越界抛错（对齐参考行为）。 */
function parseMessage(msg) {
  if (msg.length < 11) throw new Error("数据过短，未找到编码信息");
  for (let i = 0; i < 6; i++) if (msg[i] !== MAGIC[i]) throw new Error("错误！未找到编码信息（缺 stegv3 魔数）");
  const msgLen = (msg[6] << 24) | (msg[7] << 16) | (msg[8] << 8) | msg[9];
  const nameLen = msg[10];
  const start = 11 + nameLen;
  if (start + msgLen > msg.length) throw new Error("消息长度越界（头声明 " + msgLen + "B，剩余 " + (msg.length - start) + "B）");
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const content = decoder.decode(msg.subarray(start, start + msgLen));
  if (nameLen > 0) {
    const filename = decoder.decode(msg.subarray(11, start));
    return { filename, text: content };
  }
  return { text: content };
}

// ---- RGBA ↔ RGB（去/加 alpha 通道，对齐 PIL convert("RGB") 的 3 通道布局）----
function rgbaToRgb(rgba) {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    out[j] = rgba[i]; out[j + 1] = rgba[i + 1]; out[j + 2] = rgba[i + 2];
  }
  return out;
}
function rgbToRgba(rgb) {
  const n = rgb.length / 3;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    out[i] = rgb[j]; out[i + 1] = rgb[j + 1]; out[i + 2] = rgb[j + 2]; out[i + 3] = 255;
  }
  return out;
}

// ---- op ----
async function stegpyEncodeOp(text, p = {}) {
  const img = decodePNG(dataURLToBytes(text));
  const message = new TextEncoder().encode(String(p.message || ""));
  const bits = [1, 2, 4].includes(Number(p.bits)) ? Number(p.bits) : 2;
  let payload = formatMessage(message, null);
  if (p.password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const keyB64 = bytesToB64url(await pbkdf2Sha256(new TextEncoder().encode(String(p.password)), salt));
    const token = await fernetEncrypt(payload, keyB64);
    // 与参考实现一致：salt ‖ utf8(token 文本)（token 的 base64url 字符字节，非二进制）
    const tokenBytes = new TextEncoder().encode(token);
    const wrapped = new Uint8Array(16 + tokenBytes.length);
    wrapped.set(salt, 0);
    wrapped.set(tokenBytes, 16);
    payload = wrapped;
  }
  const host = stegpyEncodeBits(rgbaToRgb(img.data), payload, bits);
  return rgbaToDataURL(rgbToRgba(host), img.width, img.height);
}

async function stegpyDecodeOp(text, p = {}) {
  const img = decodePNG(dataURLToBytes(text));
  let payload = stegpyDecodeBits(rgbaToRgb(img.data));
  if (p.password) {
    if (payload.length < 16) throw new Error("数据过短，无法解密");
    const salt = payload.subarray(0, 16);
    // 宿主容量 > 消息时尾部是补零/原像素垃圾区。Python 端 b64decode 遇 '=' padding
    // 后忽略后续字节；JS atob 严格模式会拒绝 → 按第一个 '=' 截断 + 剥非 base64url 字符
    // （对齐参考行为，token 的 padding 必在垃圾区之前）
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(payload.subarray(16));
    const eq = raw.indexOf("=");
    const tokenText = (eq >= 0 ? raw.slice(0, eq + 1) : raw).replace(/[^A-Za-z0-9\-_=]/g, "");
    const keyB64 = bytesToB64url(await pbkdf2Sha256(new TextEncoder().encode(String(p.password)), salt));
    try {
      payload = await fernetDecrypt(tokenText, keyB64);
    } catch (e) {
      throw new Error("密码错误或数据未加密（" + e.message + "）");
    }
  }
  const parsed = parseMessage(payload);
  if (parsed.filename) return "提取文件: " + parsed.filename + "\n\n" + parsed.text;
  return parsed.text;
}

register({
  id: "stegpy", cat: "stego", name: "stegpy 隐写（stegv3）",
  desc: "stegpy 工具兼容隐写：bit 平面交错 1/2/4 位 + 可选 PBKDF2-Fernet 密码加密，无损图像载体（stegv3 魔数帧）",
  params: [
    { key: "message", label: "待隐藏文本", type: "text", default: "", placeholder: "编码方向要藏进图片的文本" },
    { key: "bits", label: "每像素位数", type: "select", default: 2,
      options: [
        { value: 1, label: "1 位（最隐蔽，容量最小）" },
        { value: 2, label: "2 位（默认）" },
        { value: 4, label: "4 位（容量最大）" },
      ] },
    { key: "password", label: "密码", type: "text", default: "", placeholder: "可选（PBKDF2-SHA256 10 万次 + Fernet）" },
  ],
  encode: stegpyEncodeOp, decode: stegpyDecodeOp,
  acceptsBytes: true,
});

export { stegpyEncodeBits, stegpyDecodeBits, formatMessage, parseMessage, stegpyEncodeOp, stegpyDecodeOp };
