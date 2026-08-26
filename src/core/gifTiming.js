/*
 * gifTiming.js — GIF 帧时序隐写解码（T344，cat:'stego'）。
 *
 * 原理：GIF89a 多帧动画里，每一帧的显示时长藏在「图形控制扩展」
 * （Graphic Control Extension，0x21 0xF9）的 Delay Time 字段，单位厘秒（1/100 秒）。
 * 题目可把 flag 编进这个每帧数字序列：直接当 ASCII、或按阈值二值化取 bit。
 *
 * 三种映射模式：
 * - num    原始数字：逐帧 delay（厘秒）空格连接，人工观察规律
 * - ascii  字节/ASCII：每帧 delay（0-255）当一个字节，拼出文本（delay > 255 时按低 8 位截断）
 * - binary 二进制：delay >= 阈值 → '1'，否则 '0'；位流每 8 位一组转字节（不足 8 位的尾组丢弃）
 *
 * 格式依据：GIF89a 规范（CompuServe, Inc., "Graphics Interchange Format", Version 89a, 1990-07-31）
 * § 附录 A「Graphic Control Extension」：块结构 = Block Size(=4) + Packed Field(1)
 * + Delay Time(2, little-endian, 1/100 s) + Transparent Color Index(1) + Block Terminator(0)。
 * Delay Time 直接就是厘秒整数值，从源字节直读，不经毫秒折算（无舍入误差）。
 * GCE 作用于紧随其后的下一个「待渲染对象」（图像描述符 0x2C / 纯文本扩展 0x21 0x01）；
 * 无 GCE 的图像帧 Delay 按 0 计（规范无缺省渲染时长字段）。
 *
 * 块遍历骨架与本项目 stegoImage2.js 的 gifComment/gifFrames 一致（纯字节解析，不经 canvas）。
 * 输入约定：text 参数是 base64 字符串（可为 dataURL 前缀），或 p.rawBytes 直传 Uint8Array。
 *
 * 回归断言来源：参考实现的 #[cfg(test)] 单测「"Hi" = [72, 105] 厘秒 → ASCII 模式输出 "Hi"」
 * 已转写为文件尾自检 IIFE（另补数字/二进制/无GCE/非GIF 边界）。
 */
import { register } from "./registry.js";

// ============ 通用工具（自包含，不依赖其他 core 文件内部函数） ============

/** base64（含 dataURL 前缀）→ Uint8Array。兼容 atob / Buffer。 */
function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function readU16le(bytes, off) {
  return ((bytes[off + 1] << 8) + bytes[off]) >>> 0;
}

function latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/** GIF 签名检查：GIF87a / GIF89a。 */
function gifCheckSig(bytes) {
  if (bytes.length < 6) return false;
  return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61; // 87a / 89a（'7'=0x37 '9'=0x39）
}

/** 读一串 sub-block（长度前缀链，0x00 结束）。返回 {data, nextPos}。 */
function gifReadSubBlocks(bytes, pos) {
  const parts = [];
  while (pos < bytes.length) {
    const len = bytes[pos];
    pos++;
    if (len === 0) break;
    parts.push(bytes.subarray(pos, pos + len));
    pos += len;
  }
  let total = 0;
  for (const p of parts) total += p.length;
  const data = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { data.set(p, off); off += p.length; }
  return { data, nextPos: pos };
}

// ============ 核心：逐帧 delay（厘秒）提取 ============

/**
 * 提取每个图像帧的 GCE Delay Time（厘秒）。
 * 只把图像描述符（0x2C）计为帧（与主流解码器的帧序列一致）；
 * GCE 的 pending delay 归属它后面第一个待渲染对象，被纯文本扩展消费时不产生帧。
 * @param {Uint8Array} bytes GIF 原始字节
 * @returns {number[]} 每帧 delay（厘秒），无 GCE 的帧为 0
 */
function gifDelaysCs(bytes) {
  if (!gifCheckSig(bytes)) throw new Error("非 GIF 文件（签名非 GIF87a/GIF89a）");
  let pos = 6;
  // 逻辑屏描述符（7 字节）+ 可选全局色彩表
  if (pos + 7 > bytes.length) throw new Error("GIF 文件过短（缺逻辑屏描述符）");
  const packed = bytes[pos + 4];
  if ((packed & 0x80) !== 0) pos += 3 * (1 << ((packed & 0x07) + 1));
  pos += 7;

  const delays = [];
  let pending = null; // 待归属的 GCE delay

  while (pos < bytes.length) {
    const introducer = bytes[pos];
    if (introducer === 0x3B) break; // Trailer
    if (introducer === 0x2C) { // 图像描述符：一帧
      delays.push(pending == null ? 0 : pending);
      pending = null;
      pos += 10; // 0x2C + left(2) + top(2) + w(2) + h(2) + packed(1)
      if (pos > bytes.length) break;
      const lctPacked = bytes[pos - 1];
      if ((lctPacked & 0x80) !== 0) pos += 3 * (1 << ((lctPacked & 0x07) + 1)); // 局部色彩表
      if (pos >= bytes.length) break;
      pos++; // LZW 最小码长
      pos = gifReadSubBlocks(bytes, pos).nextPos; // 图像数据子块
    } else if (introducer === 0x21) { // 扩展引入
      if (pos + 1 >= bytes.length) break;
      const label = bytes[pos + 1];
      pos += 2;
      if (label === 0xF9) { // 图形控制扩展：块大小固定 4
        if (pos < bytes.length && bytes[pos] === 4) {
          // 数据 4 字节 = packed(1) + delay LE(2) + transparent(1)
          if (pos + 4 < bytes.length) pending = readU16le(bytes, pos + 2);
          pos += 1 + 4;
          if (pos < bytes.length && bytes[pos] === 0) pos++; // 0 终止符
        } else {
          pos = gifReadSubBlocks(bytes, pos).nextPos; // 容错：异常结构按子块链跳
        }
      } else if (label === 0x01) { // 纯文本扩展：消费 pending 但不产生图像帧
        pending = null;
        if (pos < bytes.length && bytes[pos] === 12) { // 块大小固定 12
          pos += 1 + 12;
          if (pos < bytes.length && bytes[pos] === 0) pos++;
        } else {
          pos = gifReadSubBlocks(bytes, pos).nextPos;
        }
      } else { // 注释 0xFE / 应用 0xFF / 其他：子块链
        pos = gifReadSubBlocks(bytes, pos).nextPos;
      }
    } else {
      pos++; // 未知字节，跳过
    }
  }
  if (delays.length === 0) throw new Error("GIF 无图像帧");
  return delays;
}

/** 位流（'0'/'1' 字符串）→ 字节序列，不足 8 位的尾组丢弃。 */
function bitsToBytes(bits) {
  const n = bits.length - (bits.length % 8);
  const out = new Uint8Array(n / 8);
  for (let i = 0; i < n; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | (bits.charCodeAt(i + k) === 0x31 ? 1 : 0);
    out[i / 8] = b;
  }
  return out;
}

const MODE_LABEL = { num: "原始数字", ascii: "字节/ASCII", binary: "二进制" };

// ============ run ============

/**
 * gifTiming run：读每帧 GCE delay，按模式映射输出。
 * @param {string} text base64 GIF（或空，配 p.rawBytes）
 * @param {object} p { rawBytes?, mode?, threshold? }
 * @returns {string} 多行报告
 */
function gifTimingRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  const mode = (p && p.mode) || "ascii";
  const cs = gifDelaysCs(bytes);
  const delaysStr = cs.join(" ");

  const lines = [];
  let head = `GIF 帧时序隐写（${cs.length} 帧，模式：${MODE_LABEL[mode] || mode}`;
  if (mode === "binary") head += `，阈值 ${Math.round((p && p.threshold != null ? p.threshold : 5))} 厘秒`;
  head += `，文件 ${bytes.length} 字节）`;
  lines.push(head);
  lines.push(`帧时长(厘秒): ${delaysStr}`);
  lines.push("");

  if (mode === "num") {
    lines.push("数字序列即上述帧时长，人工观察规律（ASCII 码 / 二进制阈值 / 莫尔斯节奏等）。");
  } else if (mode === "binary") {
    const thr = Math.round(p && p.threshold != null ? p.threshold : 5);
    let bits = "";
    for (const v of cs) bits += v >= thr ? "1" : "0";
    const shownBits = bits.length > 512 ? bits.slice(0, 512) + `...(+${bits.length - 512} 位)` : bits;
    lines.push(`位序列: ${shownBits}`);
    const byteArr = bitsToBytes(bits);
    if (byteArr.length === 0) {
      lines.push("→ 字节: (不足 8 位，无法拼字节)");
    } else {
      const dropped = bits.length % 8;
      const note = dropped ? `（尾组 ${dropped} 位不足 8 位已丢弃）` : "";
      const txt = latin1(byteArr).replace(/[^\x20-\x7E]/g, "·"); // 不可打印字符以 · 占位
      lines.push(`→ 字节${note}: ${txt}`);
    }
  } else { // ascii（默认）
    const byteArr = new Uint8Array(cs.length);
    let clipped = 0;
    for (let i = 0; i < cs.length; i++) {
      byteArr[i] = cs[i] & 0xFF; // 厘秒 → 低 8 位
      if (cs[i] > 255) clipped++;
    }
    const note = clipped ? `（${clipped} 帧 delay > 255，按低 8 位截断）` : "";
    lines.push(`映射文本${note}:`);
    lines.push(latin1(byteArr).replace(/[^\x20-\x7E]/g, "·"));
  }
  return lines.join("\n");
}

// ============ 自检用最小 GIF 构造器 ============

/**
 * 造一个每帧 delay（厘秒）由 csArr 指定的 1×1 两色 GIF89a。
 * 每帧 = GCE(delay) + 图像描述符 + LZW 子块（单像素索引 0，码流 clear/lit0/eoi）。
 * 与自检断言配套（与参考实现测试里的 1×1 逐帧指定 delay GIF 同构）。
 */
function makeGif(csArr) {
  const parts = [];
  const push = (...bs) => { for (const b of bs) parts.push(b & 0xFF); };
  push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); // "GIF89a"
  push(1, 0, 1, 0, 0x80, 0, 0); // 逻辑屏 1×1，GCT 2 色
  push(0, 0, 0, 0xFF, 0xFF, 0xFF); // GCT：黑、白
  for (const cs of csArr) {
    // GCE：块大小 4，packed=0（无处置/无透明），delay LE，透明索引 0，终止 0
    push(0x21, 0xF9, 0x04, 0x00, cs & 0xFF, (cs >> 8) & 0xFF, 0x00, 0x00);
    push(0x2C, 0, 0, 0, 0, 1, 0, 1, 0, 0x00); // 图像描述符：left0 top0 1×1 无LCT
    push(0x02, 0x02, 0x44, 0x01, 0x00); // LZW minCodeSize=2 + 子块[0x44 0x01] + 终止
  }
  push(0x3B); // Trailer
  return new Uint8Array(parts);
}

// ============ 加载期自检（照 hc128.js 模式，import 即跑） ============

(() => {
  // ① 参考实现单测转写：[72, 105] 厘秒 → ASCII 模式输出 "Hi"
  let out = gifTimingRun("", { rawBytes: makeGif([72, 105]), mode: "ascii" });
  if (!out.includes("Hi")) throw new Error(`gifTiming 自检①失败：ASCII 模式应含 "Hi"，实际:\n${out}`);

  // ② 数字模式：序列逐帧对齐
  out = gifTimingRun("", { rawBytes: makeGif([72, 105, 72, 105]), mode: "num" });
  if (!out.includes("帧时长(厘秒): 72 105 72 105")) throw new Error(`gifTiming 自检②失败：\n${out}`);

  // ③ 二进制模式：[3,9,3,9,3,9,3,9] 阈值 5 → 01010101 → 0x55 'U'
  out = gifTimingRun("", { rawBytes: makeGif([3, 9, 3, 9, 3, 9, 3, 9]), mode: "binary", threshold: 5 });
  if (!out.includes("位序列: 01010101") || !out.includes("U")) throw new Error(`gifTiming 自检③失败：\n${out}`);

  // ④ 二进制模式尾组丢弃：9 位 → 只拼 1 字节（尾 1 位丢）
  out = gifTimingRun("", { rawBytes: makeGif([9, 9, 9, 9, 9, 9, 9, 9, 9]), mode: "binary", threshold: 5 });
  if (!out.includes("尾组 1 位不足 8 位已丢弃")) throw new Error(`gifTiming 自检④失败：\n${out}`);

  // ⑤ delay > 255 截断：300 = 0x012C → 低 8 位 0x2C = ','
  out = gifTimingRun("", { rawBytes: makeGif([300]), mode: "ascii" });
  if (!out.includes("1 帧 delay > 255") || !out.includes(",")) throw new Error(`gifTiming 自检⑤失败：\n${out}`);

  // ⑥ 非输入直接报错
  let threw = false;
  try { gifTimingRun("", { rawBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47]) }); }
  catch { threw = true; }
  if (!threw) throw new Error("gifTiming 自检⑥失败：非 GIF 未报错");

  // ⑦ 多帧大 delay（16 位全幅）：60000 厘秒 = 0xEA60
  const cs7 = gifDelaysCs(makeGif([60000, 1]));
  if (cs7[0] !== 60000 || cs7[1] !== 1) throw new Error(`gifTiming 自检⑦失败：${cs7}`);
})();

// ============ register ============

register({
  id: "gifTiming", cat: "stego", name: "GIF 帧时序隐写",
  desc: "读每帧图形控制扩展的 Delay Time（厘秒），映射为数字序列 / ASCII / 阈值二值化位流，解出藏在播放时长里的信息",
  params: [
    { key: "mode", label: "映射模式", type: "select", default: "ascii",
      options: [
        { value: "ascii", label: "字节/ASCII（默认）" },
        { value: "num", label: "原始数字" },
        { value: "binary", label: "二进制（阈值二值化）" },
      ] },
    { key: "threshold", label: "二进制阈值(厘秒)", type: "number", default: 5, placeholder: "delay ≥ 阈值记 1，仅二进制模式生效" },
  ],
  run: gifTimingRun,
  acceptsBytes: true,
});

export {
  gifTimingRun,
  gifDelaysCs,
  bitsToBytes,
  makeGif, // 供回归脚本复用（构造已知 delay 序列的测试 GIF）
};
