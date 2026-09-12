/*
 * jsteg.js — jsteg JPEG 隐写 编/解（cat:'stego'，encode/decode 双向 op）。
 *
 * 做什么：encode 把消息按 jsteg 口径顺序覆盖 DCT 系数 LSB，经 jpegRewrite
 * 重写扫描数据后输出 jsteg.jpg；decode 从 JPEG 系数里顺序读 LSB 还原消息。
 *
 * ---- 算法口径（红线：查证后落笔，来源如下） ----
 * jsteg（Derek Upham）为最早 JPEG 频域 LSB 隐写：按扫描顺序遍历 DCT 系数，
 * 用消息位覆盖系数 LSB。跳过规则与翻转规则经以下三处交叉查证后统一：
 * 1. 学术口径（Suarez-Tangil et al. 2014；readkong 教材伪代码）：
 *    「skipping those coefficients with the values 0 or 1」——跳过 0/1，
 *    顺序遍历、不支持随机位选择。
 * 2. CTF 事实标准工具 lukechampine/jsteg（Go，Aperi'Solve 等平台内置）源码
 *    writer.go / scan.go：仅取幅值 |c|≥2 的 AC 系数做载体（ac < -1 || ac > 1），
 *    幅值 LSB、符号不变（2↔3、−2↔−3、−5↔−4），即 1 与 -1 之间禁止翻转、
 *    也禁止翻成 0（避免 0 值产生、破坏 run-length 结构）；仅亮度分量；
 *    字节内按位从低到高（LSB-first）装载。
 * 3. 本项目 stegdetect.js 头注释的检测口径：跳过 |c|≤1，值对 (2i,2i+1) 内
 *    保号翻转——与本实现完全一致，保证「嵌 → 检」闭环成立。
 * 与原版 C jsteg 的差异：原版学术描述为跳过 {0,1}（-1 理论上可作载体）；
 * 本实现按 lukechampine/jsteg 与 stegdetect 口径跳过 |c|≤1（±1 完全不用），
 * 这是 CTF 实用工具链的实际统一口径。
 *
 * ---- 消息封装（兼容 lukechampine/jsteg CLI） ----
 * "jsteg" 魔数（5 字节 ASCII）+ 4 字节 LittleEndian 长度 + 消息字节，
 * 与 `jsteg reveal`（cmd/jsteg）的封装逐字节一致——本 op 嵌出的图可用
 * 原 CLI 直接 reveal；CLI 嵌的图本 op 也能解。另兼容「无魔数、4 字节 LE
 * 长度前缀」的裸封装作为兜底。
 *
 * ---- 依赖与复用 ----
 * JPEG 解析 import f5stego.js 的 parseJpeg/parseInput/findFlags（勿重写）；
 * 回写 import jpegRewrite.js 的 reencodeJpeg/analyzeScans（T390 产物）。
 * 目标分量 = SOS 第一个扫描分量（Go 工具 reader 侧同口径，通常即亮度 Y）。
 *
 * 红线遵守：纯前端零外发；件内自注册；报告无 emoji（● ✓ ▸ × ✗ ⚠）；
 * 只支持基线/扩展顺序单扫描 JPEG，渐进式/多扫描/算术编码优雅报错。
 */
import { register } from "./registry.js";
import { parseJpeg, parseInput, findFlags } from "./f5stego.js";
import { reencodeJpeg, analyzeScans } from "./jpegRewrite.js";

// ============================================================
// 常量与小工具
// ============================================================
const MAGIC = [0x6a, 0x73, 0x74, 0x65, 0x67]; // "jsteg"

function toU8(b) {
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

function utf8Encode(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  const arr = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) arr.push(c);
    else if (c < 0x800) arr.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) arr.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else arr.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return new Uint8Array(arr);
}

function utf8Decode(b) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(b); }
  catch { let s = ""; for (const x of b) s += String.fromCharCode(x); return s; }
}

function bytesToHex(b, max) {
  const n = max == null ? b.length : Math.min(b.length, max);
  let s = "";
  for (let i = 0; i < n; i++) s += b[i].toString(16).padStart(2, "0");
  if (b.length > n) s += "…";
  return s;
}

function bytesToAsciiPreview(b, max) {
  const n = max == null ? b.length : Math.min(b.length, max);
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = b[i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : "·";
  }
  if (b.length > n) s += "…";
  return s;
}

/**
 * 统一校验：解析 JPEG 并确认可用（基线/扩展顺序、单 SOS 全谱扫描）。
 * 返回 parsed + 目标分量 idx + 是否交错扫描；不可用直接抛错（消息面向使用者）。
 */
function parseStegoCapable(bytes) {
  const parsed = parseJpeg(bytes);
  if (parsed.frame.progressive) {
    throw new Error("渐进式 JPEG（Progressive）不支持 jsteg——顺序系数模型不成立，请换基线 Baseline 图");
  }
  const scans = analyzeScans(parsed);
  if (scans.multiScan) {
    throw new Error("多扫描 JPEG（多个 SOS 非交错扫描）不支持 jsteg——请用常规编码器重新保存");
  }
  return { parsed, compIdx: scans.comps[0].compIdx, interleaved: scans.comps.length > 1 };
}

/**
 * 载体块遍历序 = 熵解码序（Go reader / T.81 MCU 顺序）。
 * ⚠ 关键：4:2:0/4:2:2 交错扫描的解码序是「逐 MCU 展开 j,i」，不是 comp.blocks
 * 的平铺行序——线性扫描会在首个 MCU 行之后位流整体错位（exe 对拍不兼容的根因）。
 * 单分量扫描（ns=1）解码序 = 平铺行序，两者一致。
 * 返回 comp.blocks 里的平铺块偏移数组（×64 = 系数起点）。
 */
function carrierOffsets(comp, frame, interleaved) {
  const n = comp.blocks.length >> 6;
  if (!interleaved) {
    const off = new Int32Array(n);
    for (let i = 0; i < n; i++) off[i] = i * 64;
    return off;
  }
  const mpl = frame.mcusPerLine, mpc = frame.mcusPerColumn;
  const off = new Int32Array(mpl * mpc * comp.h * comp.v);
  let p = 0;
  for (let y = 0; y < mpc; y++) {
    for (let x = 0; x < mpl; x++) {
      for (let j = 0; j < comp.v; j++) {
        for (let k = 0; k < comp.h; k++) {
          off[p++] = ((y * comp.v + j) * comp.blocksPerLineForMcu + x * comp.h + k) * 64;
        }
      }
    }
  }
  return off;
}

/**
 * 统计载体位容量：解码序下 |c|≥2 的 AC 系数个数（DC 位在 blocks 中恒 0，
 * 天然被 |c|≤1 过滤，仍显式跳过以免歧义）。
 */
function capacityBits(comp, frame, interleaved) {
  const off = carrierOffsets(comp, frame, interleaved);
  let n = 0;
  for (let b = 0; b < off.length; b++) {
    const base = off[b];
    for (let k = 1; k < 64; k++) {
      const c = comp.blocks[base + k];
      if (c < -1 || c > 1) n++;
    }
  }
  return n;
}

// ============================================================
// 核心：嵌入 / 提取（导出供冒烟与复用）
// ============================================================
/**
 * jsteg 嵌入。
 * @param jpegBytes    载体 JPEG 字节
 * @param payloadBytes 消息字节（自动加 "jsteg"+LE32 长度封装）
 * @returns { bytes, usedBits, capacityBits, compIdx, width, height }
 */
export function jstegEmbedBytes(jpegBytes, payloadBytes) {
  const { parsed, compIdx, interleaved } = parseStegoCapable(jpegBytes);
  const frame = parsed.frame;
  const comp = frame.components[compIdx];

  const payload = toU8(payloadBytes);
  const stream = new Uint8Array(9 + payload.length);
  stream.set(MAGIC, 0);
  const len = payload.length;
  stream[5] = len & 0xff; stream[6] = (len >>> 8) & 0xff;
  stream[7] = (len >>> 16) & 0xff; stream[8] = (len >>> 24) & 0xff;
  stream.set(payload, 9);

  const off = carrierOffsets(comp, frame, interleaved);
  const cap = capacityBits(comp, frame, interleaved);
  const need = stream.length * 8;
  if (need > cap) {
    throw new Error(
      `容量不足：封装后需 ${need} 位（消息 ${len} 字节 + 9 字节封装头），` +
      `目标分量载体仅 ${cap} 位。换大图/高质量图，或缩短消息。`
    );
  }

  // 顺序覆盖 LSB：跳过 DC 位与 |c|≤1；幅值清 LSB 后装入消息位，符号不变。
  // 遍历序 = 熵解码序（carrierOffsets），交错扫描必须逐 MCU 展开。
  const mod = new Int16Array(comp.blocks); // 拷贝，不动原解析
  let bit = 0;
  outer:
  for (let b = 0; b < off.length; b++) {
    const base = off[b];
    for (let k = 1; k < 64; k++) {
      const c = mod[base + k];
      if (c > -2 && c < 2) continue; // |c| ≤ 1：不作载体（0 跳过；±1 禁止翻转成 0/互翻）
      const msg = (stream[bit >> 3] >>> (bit & 7)) & 1; // 字节内 LSB-first（与 Go 工具一致）
      const mag = c < 0 ? -c : c;
      mod[base + k] = c < 0 ? -((mag & ~1) | msg) : (mag & ~1) | msg;
      if (++bit >= need) break outer;
    }
  }

  const newComponents = new Array(frame.components.length).fill(null);
  newComponents[compIdx] = { blocks: mod };
  const bytes = reencodeJpeg(parsed, newComponents);
  return {
    bytes,
    usedBits: need,
    capacityBits: cap,
    compIdx,
    width: frame.samplesPerLine,
    height: frame.scanLines,
  };
}

/**
 * jsteg 提取。按嵌入同序读 LSB → 解封装。
 * @returns { payload, declaredLen, truncated, wrapper, rawBits, compIdx, rawStream }
 *   wrapper: 'jsteg'（魔数+LE32 长度）| 'len32'（裸 LE32 长度）| 'raw'（无封装）
 */
export function jstegExtractBytes(jpegBytes) {
  const { parsed, compIdx, interleaved } = parseStegoCapable(jpegBytes);
  const comp = parsed.frame.components[compIdx];

  // 顺序读 LSB（与嵌入完全同口径：熵解码序 + LSB-first 装载）
  const off = carrierOffsets(comp, parsed.frame, interleaved);
  const raw = [];
  let byte = 0, nb = 0;
  for (let b = 0; b < off.length; b++) {
    const base = off[b];
    for (let k = 1; k < 64; k++) {
      const c = comp.blocks[base + k];
      if (c > -2 && c < 2) continue;
      byte |= (c & 1) << nb; // c&1 == |c|&1（补码性质），与嵌入侧幅值 LSB 一致
      if (++nb === 8) { raw.push(byte); byte = 0; nb = 0; }
    }
  }
  const stream = new Uint8Array(raw);

  let payload, declaredLen = 0, truncated = false, wrapper = "raw", head = 0;
  const magicHit =
    stream.length >= 9 &&
    stream[0] === MAGIC[0] && stream[1] === MAGIC[1] && stream[2] === MAGIC[2] &&
    stream[3] === MAGIC[3] && stream[4] === MAGIC[4];
  if (magicHit) {
    wrapper = "jsteg";
    head = 9;
    declaredLen = stream[5] | (stream[6] << 8) | (stream[7] << 16) | ((stream[8] << 24) >>> 0);
  } else if (stream.length >= 4) {
    const l4 = stream[0] | (stream[1] << 8) | (stream[2] << 16) | ((stream[3] << 24) >>> 0);
    const maxBytes = stream.length;
    if (l4 > 0 && l4 <= maxBytes) { // 合理长度才认裸前缀，避免把噪声当长度
      wrapper = "len32";
      head = 4;
      declaredLen = l4;
    }
  }
  if (head > 0) {
    if (declaredLen > stream.length - head) truncated = true;
    const take = Math.min(declaredLen, stream.length - head);
    payload = stream.slice(head, head + take);
  } else {
    payload = stream; // 无封装：整条原始 LSB 流交由人工判读
  }

  return {
    payload,
    declaredLen,
    truncated,
    wrapper,
    compIdx,
    rawStream: stream,
    capacityBits: capacityBits(comp, parsed.frame, interleaved),
  };
}

// ============================================================
// op 入口
// ============================================================
function getCarrier(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) return { bytes: toU8(p.rawBytes), from: "rawBytes" };
  const s = String(text || "").trim();
  if (!s) return null;
  try {
    const b = parseInput(s, "auto"); // auto 兼容 dataURL / base64 / hex
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return { bytes: b, from: "text" };
  } catch { /* 按非载体处理 */ }
  return null;
}

function jstegEncodeOp(text, p) {
  const L = [];
  L.push("=== jsteg JPEG 隐写嵌入 ===");
  L.push("");

  const carrier = getCarrier(text, p);
  if (!carrier) {
    L.push("✗ 未取得载体图。请拖入 JPEG 文件（基线 Baseline），或粘贴其 base64/dataURL。");
    L.push("  消息来源：参数 message，留空时用输入框文本（输入框被载体占用则必填参数）。");
    return L.join("\n");
  }

  let msg = p && p.message != null ? String(p.message) : "";
  if (!msg && carrier.from === "rawBytes") msg = String(text || "");
  if (!msg.trim() && !(p && p.allowEmpty)) {
    // 空消息允许显式触发（冒烟用 allowEmpty），正常使用给提示
    L.push("✗ 消息为空。输入框（或参数 message）填要隐藏的文本。");
    return L.join("\n");
  }

  let carrierBytes = carrier.bytes;
  L.push(`● 载体来源: ${carrier.from === "rawBytes" ? "拖入文件" : "输入框 base64/dataURL"}（${carrierBytes.length} 字节）`);

  let parsed;
  try { parsed = parseJpeg(carrierBytes); } catch (e) { parsed = null; }
  if (parsed) {
    const fr = parsed.frame;
    L.push(`● 载体图: ${fr.samplesPerLine}×${fr.scanLines}  ${fr.progressive ? "渐进式(不支持)" : fr.extended ? "扩展顺序" : "基线 Baseline"}  分量数 ${fr.components.length}`);
  }

  let res;
  try {
    res = jstegEmbedBytes(carrierBytes, utf8Encode(msg));
  } catch (e) {
    L.push(`✗ 嵌入失败: ${e.message || String(e)}`);
    return L.join("\n");
  }

  L.push(`● 目标分量: SOS 第 1 扫描分量（#0，通常为亮度 Y）`);
  L.push(`● 消息: ${msg.length} 字符 → UTF-8 ${utf8Encode(msg).length} 字节 + 9 字节封装头（"jsteg" 魔数 + LE32 长度，兼容 jsteg CLI）`);
  L.push(`● 容量: ${res.capacityBits} 位  已用 ${res.usedBits} 位（填充率 ${(100 * res.usedBits / Math.max(1, res.capacityBits)).toFixed(1)}%）`);
  L.push("");
  L.push("--- 产物 ---");
  L.push("  ✓ jsteg.jpg（系数回写重打包，标记段原样保留）");
  L.push("");
  L.push("提示:");
  L.push("  · 口径：跳过 |c|≤1，幅值 LSB 符号不变（2↔3、−2↔−3），顺序嵌入——与 lukechampine/jsteg 一致。");
  L.push("  · 产物可直接被原版 jsteg CLI `jsteg reveal` 解出；亦可用本工具 decode 或 stegdetect 检测。");
  L.push("  · 载图被重新压缩/缩放会破坏载荷——传输用原文件。");

  return { text: L.join("\n"), files: [{ name: "jsteg.jpg", mime: "image/jpeg", bytes: res.bytes }] };
}

function jstegDecodeOp(text, p) {
  const L = [];
  L.push("=== jsteg JPEG 隐写提取 ===");
  L.push("");

  let bytes;
  if (p && p.rawBytes && p.rawBytes.length) {
    bytes = toU8(p.rawBytes);
  } else {
    try { bytes = parseInput(text, "auto"); } catch (e) { bytes = null; }
  }
  if (!bytes || !bytes.length) {
    L.push("✗ 输入为空。请拖入 jsteg 隐写的 JPEG 文件，或粘贴其 hex / base64 / dataURL。");
    return L.join("\n");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    L.push("⚠ 未见 JPEG SOI(FF D8) 头——可能非 JPEG，仍尝试解析。");
  }

  let res;
  try {
    res = jstegExtractBytes(bytes);
  } catch (e) {
    L.push(`✗ 提取失败: ${e.message || String(e)}`);
    return L.join("\n");
  }

  const frameInfo = (() => {
    try {
      const fr = parseJpeg(bytes).frame;
      return `${fr.samplesPerLine}×${fr.scanLines}`;
    } catch { return "?"; }
  })();
  L.push(`● 图像: ${frameInfo}  目标分量: SOS 第 1 扫描分量 #${res.compIdx}`);
  L.push(`● 载体位容量: ${res.capacityBits} 位  原始 LSB 流: ${res.rawStream.length} 字节`);
  L.push(`● 封装: ${res.wrapper === "jsteg" ? "\"jsteg\" 魔数 + LE32 长度（CLI 兼容）" : res.wrapper === "len32" ? "裸 LE32 长度前缀" : "无封装（按原始流输出）"}`);
  if (res.wrapper !== "raw" && res.truncated) {
    L.push(`  ⚠ 声明长度 ${res.declaredLen} 字节 > 实取 ${res.payload.length} 字节——图像被二次压缩或封装不完整。`);
  }
  L.push("");

  const payload = res.payload;
  if (!payload.length) {
    L.push("× 提取到 0 字节（空消息或载体系数几乎全 0）。");
  }
  L.push("--- 提取结果 ---");
  L.push(`● Hex（前 256 字节）:`);
  L.push("  " + bytesToHex(payload, 256));
  L.push("");
  const utf8 = utf8Decode(payload);
  L.push("● ASCII 预览:");
  L.push("  " + bytesToAsciiPreview(payload, 512));
  L.push("");
  L.push("● UTF-8 解读:");
  L.push("  " + (utf8.length > 2048 ? utf8.slice(0, 2048) + " …" : utf8));
  L.push("");

  const flagHits = new Set();
  for (const f of findFlags(bytesToAsciiPreview(payload, 1024))) flagHits.add(f);
  for (const f of findFlags(utf8)) flagHits.add(f);
  L.push("--- flag 命中 ---");
  if (flagHits.size) {
    for (const f of flagHits) L.push("  ✓✓ " + f);
  } else {
    L.push("  × 未命中 flag{}/ctf{} 等格式。无封装时可看上方原始流 hex 自行判读。");
  }
  L.push("");
  L.push("说明:");
  L.push("  · 口径：顺序读 |c|≥2 的 AC 系数幅值 LSB（跳过 0/±1），字节内 LSB-first——与 lukechampine/jsteg 一致。");
  L.push("  · 兼容原版 jsteg CLI（hide 出的图可直接解）；F5/steghide/outguess 等其他算法不适用。");
  return L.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "jsteg",
  cat: "stego",
  name: "jsteg JPEG 隐写 编/解",
  desc: "jsteg 隐写双向工具：encode 把消息顺序写入 DCT 系数 LSB（跳过 0 与 ±1，幅值翻转符号不变，避免产生 0），重新 Huffman 编码回写 JPEG（标记段原样保留）；decode 顺序读 LSB 还原消息。封装 = \"jsteg\" 魔数 + LE32 长度，兼容原版 jsteg CLI 的 hide/reveal。仅基线单扫描 JPEG，渐进式报错。纯前端零外发",
  acceptsBytes: true,
  params: [
    {
      key: "message", label: "隐藏消息（encode）", type: "text", default: "",
      placeholder: "留空则用输入框文本；输入框被载体 base64 占用时必填此处",
    },
    {
      key: "allowEmpty", label: "允许空消息嵌入（仅封装头）", type: "bool", default: false,
    },
  ],
  encode: jstegEncodeOp,
  decode: jstegDecodeOp,
});

export { jstegEncodeOp, jstegDecodeOp };
