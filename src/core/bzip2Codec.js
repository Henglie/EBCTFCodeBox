/*
 * bzip2Codec.js — bzip2 压缩（WASM 单向，cat:'archive'）。
 *
 * 只注册 bzip2Enc；解压仍由 compressExt2.js 的既有 bzip2Dec 承担（本文件不改它）。
 * 算法来自 src/vendor/bzip2-wasm（libbzip2 1.0.8 → WASM，license 为 bzip2-1.0.6），
 * 不在 JS 里重写 BWT/Huffman，避免“假压缩”。
 *
 * 参数：
 * - inputEnc  utf8（默认）/ hex / base64 / auto；p.rawBytes 或首参 Uint8Array 直接当字节。
 * - outEnc    base64（默认）/ hex；完整输出，不截断。
 * - blockSize 1..9，默认 5；对应 BZ2_bzBuffToBuffCompress 的块大小（100KB × n）。
 *
 * 上限（可读拒绝，不静默截断）：
 * - 输入 ≤ 4 MiB（4,194,304 字节）。超过直接报错，避免 WASM 内存与 UI 字符串双爆。
 * - 输出编码后 ≤ 12 MiB 字符。4 MiB 输入的 hex 上限约 8 MiB，留出压缩膨胀余量。
 *
 * 单例初始化：首次 run 时 init WASM；失败抛可读错误（Node 缺 wasm / 浏览器 file:// 限制）。
 * 零外发：全部本地计算。
 */
import { register } from "./registry.js";
import BZip2 from "../vendor/bzip2-wasm/index.js";

const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_CHARS = 12 * 1024 * 1024;
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

const te = (s) => new TextEncoder().encode(s);

// ============ 输入解码 ============
function hexToBytesStrict(s) {
  const h = s.replace(/\s+/g, "");
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) {
    throw new Error("bzip2 压缩：输入不是合法 hex（需偶数长度 0-9a-f）。");
  }
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < h.length; i += 2) out[i / 2] = parseInt(h.slice(i, i + 2), 16);
  return out;
}

function base64ToBytesStrict(s) {
  const str = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!str || !/^[A-Za-z0-9+/]*={0,2}$/.test(str)) {
    throw new Error("bzip2 压缩：输入不是合法 base64。");
  }
  const padded = str + "=".repeat((4 - (str.length % 4)) % 4);
  let bin;
  try {
    bin = atob(padded);
  } catch {
    throw new Error("bzip2 压缩：输入不是合法 base64。");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBytes(text, p) {
  const raw = p && p.rawBytes != null ? p.rawBytes : text;
  if (raw instanceof Uint8Array) return raw;
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  const s = String(raw ?? "");
  const enc = String((p && p.inputEnc) || "utf8").toLowerCase();
  if (enc === "hex") return hexToBytesStrict(s);
  if (enc === "base64") return base64ToBytesStrict(s);
  if (enc === "auto") {
    const compact = s.trim().replace(/\s+/g, "");
    if (compact.length >= 2 && compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact)) {
      return hexToBytesStrict(compact);
    }
    if (compact.length >= 4 && /^[A-Za-z0-9+/=_-]+$/.test(compact)) {
      try {
        return base64ToBytesStrict(compact);
      } catch { /* 落到 UTF-8 */ }
    }
    return te(s);
  }
  return te(s);
}

// ============ 输出编码（完整、不截断） ============
function bytesToHex(bytes) {
  const table = new Array(256);
  for (let i = 0; i < 256; i++) table[i] = i.toString(16).padStart(2, "0");
  let out = "";
  const CHUNK = 0x8000;
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = "";
    for (let i = start; i < end; i++) s += table[bytes[i]];
    out += s;
  }
  return out;
}

function bytesToBase64(bytes) {
  let out = "";
  const CHUNK = 0x7ffe; // 偶数且不超过常见字符串拼接阈值
  for (let start = 0; start < bytes.length; start += CHUNK) {
    const end = Math.min(start + CHUNK, bytes.length);
    let s = "";
    for (let i = start; i < end; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < end ? bytes[i + 1] : 0;
      const b2 = i + 2 < end ? bytes[i + 2] : 0;
      s += B64_ALPHABET[b0 >> 2];
      s += B64_ALPHABET[((b0 & 3) << 4) | (b1 >> 4)];
      s += i + 1 < end ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
      s += i + 2 < end ? B64_ALPHABET[b2 & 0x3f] : "=";
    }
    out += s;
  }
  return out;
}

// ============ WASM 单例 ============
let _bz2 = null;
let _initPromise = null;

function getBz2() {
  if (_bz2) return Promise.resolve(_bz2);
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    const bz = new BZip2();
    try {
      await bz.init();
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(
        "bzip2 WASM 初始化失败：" + msg +
        "。Node 下请确认 src/vendor/bzip2-wasm/bzip2-1.0.8/bzip2.wasm 存在且可读；" +
        "浏览器需通过 HTTP 提供 .wasm（file:// 直开通常被浏览器拦截）。"
      );
    }
    _bz2 = bz;
    return bz;
  })();
  _initPromise.catch(() => { _initPromise = null; });
  return _initPromise;
}

function parseBlockSize(v) {
  if (v === undefined || v === null || v === "") return 5;
  const s = String(v).trim();
  if (!/^[0-9]+$/.test(s)) {
    throw new Error("bzip2 压缩：blockSize 必须是 1..9 的整数，收到 " + JSON.stringify(v) + "。");
  }
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 9) {
    throw new Error("bzip2 压缩：blockSize 必须在 1..9 之间，收到 " + n + "。");
  }
  return n;
}

function parseOutEnc(v) {
  const enc = String(v || "base64").toLowerCase();
  if (enc !== "base64" && enc !== "hex") {
    throw new Error("bzip2 压缩：outEnc 只能是 base64 或 hex，收到 " + JSON.stringify(v) + "。");
  }
  return enc;
}

async function compressBytes(bytes, blockSize, workFactor = 30) {
  const bz = await getBz2();
  // bzip2 最坏膨胀远小于 1%，但短输入有固定头尾开销；预留 1% + 1KB。
  let destLen = Math.max(1024, bytes.length + Math.ceil(bytes.length / 100) + 1024);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return bz.compress(bytes, blockSize, destLen, workFactor);
    } catch (e) {
      lastErr = e;
      const msg = e && e.message ? e.message : String(e);
      if (/OUTBUFF_FULL|BZ_OUTBUFF_FULL|-8\b/.test(msg)) {
        destLen = Math.min(destLen * 2, MAX_OUTPUT_CHARS);
        continue;
      }
      throw new Error("bzip2 压缩失败：" + msg);
    }
  }
  throw new Error(
    "bzip2 压缩失败：输出缓冲区不足（最后错误：" +
    (lastErr && lastErr.message ? lastErr.message : String(lastErr)) + "）。"
  );
}

/**
 * bzip2Enc 的 run 实现。
 * @param {string|Uint8Array} text 文本，或 p.rawBytes / 直接 Uint8Array
 * @param {{inputEnc?:string,outEnc?:string,blockSize?:number|string,rawBytes?:Uint8Array}} p
 * @returns {Promise<string>} base64 / hex
 */
export async function bzip2EncRun(text, p) {
  if (p && p.inputEnc != null && String(p.inputEnc).toLowerCase() !== "utf8") {
    throw new Error("inputEnc 该参数已废弃，请改用输入视图");
  }
  const bytes = toBytes(text, p ? { ...p, inputEnc: undefined } : p);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error(
      "bzip2 压缩：输入 " + bytes.length + " 字节超过上限 " + MAX_INPUT_BYTES +
      " 字节（4 MiB），已拒绝（不截断）。请分块压缩或缩小输入。"
    );
  }

  const blockSize = parseBlockSize(p && p.blockSize);
  const outEnc = parseOutEnc(p && p.outEnc);
  let workFactor = parseInt((p && p.workFactor != null ? p.workFactor : 30), 10);
  if (!Number.isFinite(workFactor) || workFactor < 0 || workFactor > 250) workFactor = 30;

  const compressed = await compressBytes(bytes, blockSize, workFactor);
  const encoded = outEnc === "hex" ? bytesToHex(compressed) : bytesToBase64(compressed);

  if (encoded.length > MAX_OUTPUT_CHARS) {
    throw new Error(
      "bzip2 压缩：输出 " + encoded.length + " 字符超过预算 " + MAX_OUTPUT_CHARS +
      " 字符，已拒绝（不截断）。请缩小输入或改用 hex/base64 之外的处理方式。"
    );
  }
  return encoded;
}

register({
  id: "bzip2Enc", family: "bzip2", familyLabel: "compress",
  cat: "archive",
  name: "bzip2 压缩",
  desc:
    "bzip2（libbzip2 1.0.8）WASM 压缩：块大小 1..9（默认 5），输出 base64/hex；" +
    "完整输出不截断，输入上限 4 MiB、输出预算 12 MiB；与现有 bzip2Dec 可直接往返。",
  params: [
    {
      key: "outEnc",
      label: "输出编码",
      type: "select",
      default: "base64",
      options: [
        { value: "base64", label: "Base64" },
        { value: "hex", label: "Hex" },
      ],
    },
    {
      key: "workFactor",
      label: "Work factor（0-250，CC 默认 30）",
      type: "number",
      default: 30,
    },
    {
      key: "blockSize",
      label: "块大小 1..9（100KB × n）",
      type: "number",
      default: 5,
      placeholder: "1-9，默认 5",
    },
  ],
  run: bzip2EncRun,
  acceptsBytes: true,
});

export { MAX_INPUT_BYTES, MAX_OUTPUT_CHARS, parseBlockSize, bytesToBase64, bytesToHex };
