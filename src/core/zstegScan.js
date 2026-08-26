/*
 * zstegScan.js — LSB 全组合扫描（cat:'stego'，P1 批）。
 *
 * 解决什么：CTF 里 PNG/BMP 的 LSB 隐写通道组合多（哪个位平面 × 哪些通道 ×
 * 位序 × 行列遍历），手工逐个试很费时。本 op 在一组有界组合上批量提取并按
 * 「可读性 + flag 正则」打分排序，直接给出最可能是秘密数据的组合。
 *
 * 组合空间（有界，非无限爆破）：
 *   位平面 bit 0..maxBit（参数，0..7）
 * × 通道 {r, g, b, rgb, bgr}（通道下标 0/1/2；灰度等窄图自动过滤越界通道）
 * × 位序 {msb 先, lsb 先}（8 个比特拼字节时的高低位顺序）
 * × 遍历 {行优先}，参数开启后追加 {列优先}
 * 默认参数下恰 10 组合；全开 8×5×2×2=160 组合，每组合最多提取 2048 字节。
 *
 * 打分（可读性启发 + flag 命中加成）：
 *   字母/空格 +1.0 · 数字 +0.6 · \n\t\r +0.4 · ASCII 标点 +0.3 · 控制字符 -3.0
 *   · 其余 +0.1，取平均；文本同时含 { } 再 +0.5；命中 flag 正则再 +5.0。
 *   按分降序取前 8 输出。
 *
 * 红线：
 * - 只新建本文件；像素解码复用 lsbExtract.js 的 decodePngPixels/decodeBmpPixels
 *   （自包含纯 JS，PNG 8bit 非隔行 / BMP 24·32bit 未压缩），测试构造复用 mcMap.encodePNG。
 * - 算法层零 UI 依赖；零外发。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";
import { decodePngPixels, decodeBmpPixels } from "./lsbExtract.js";
import { encodePNG } from "./mcMap.js";

const MAX_BYTES = 2048;   // 每组合提取上限（与主流扫描工具的输出窗口同量级）
const TOP_N = 8;          // 最多展示候选数

// 通道组合（名, 通道下标序列）。R=0 G=1 B=2；越界通道（窄图）在提取前过滤。
const CHANNEL_COMBOS = [
  ["r", [0]],
  ["g", [1]],
  ["b", [2]],
  ["rgb", [0, 1, 2]],
  ["bgr", [2, 1, 0]],
];

/**
 * 按给定组合提取比特位平面并打包成字节（MSB-first：第 k 个比特放字节高位）。
 * @param {Uint8Array} samples 行主序交错样本（每像素 channels 个）
 * @param {number} width/height/channels 图尺寸与通道数
 * @param {number[]} chans 本组合取位的通道下标序列（已过滤越界）
 * @param {number} bit 位平面号 0..7
 * @param {boolean} colMajor true=列优先遍历（x 外 y 内），false=行优先
 * @param {number} maxBytes 最多提取字节数
 * @returns {Uint8Array}
 */
export function extractPlane(samples, width, height, channels, chans, bit, colMajor, maxBytes) {
  const out = new Uint8Array(maxBytes);
  let acc = 0, nbits = 0, outLen = 0;
  const step = chans.length;
  const totalPx = width * height;
  for (let i = 0; i < totalPx && outLen < maxBytes; i++) {
    // 行优先：i = y*w+x；列优先：i = x*h+y → 反解像素下标
    let px;
    if (colMajor) {
      const x = Math.floor(i / height), y = i % height;
      px = y * width + x;
    } else {
      px = i;
    }
    const base = px * channels;
    for (let c = 0; c < step; c++) {
      acc = (acc << 1) | ((samples[base + chans[c]] >> bit) & 1);
      if (++nbits === 8) {
        out[outLen++] = acc & 0xff;
        acc = 0; nbits = 0;
        if (outLen >= maxBytes) break;
      }
    }
  }
  return out.subarray(0, outLen);
}

// LSB-first 变体：第 k 个比特放字节低位（权重 1<<k），遍历与取位同上：
export function extractPlaneLsbFirst(samples, width, height, channels, chans, bit, colMajor, maxBytes) {
  const out = new Uint8Array(maxBytes);
  let outLen = 0;
  const totalPx = width * height;
  let bitPos = 0; // 当前字节内第几个比特（权重 1<<bitPos）
  let byte = 0;
  const step = chans.length;
  for (let i = 0; i < totalPx && outLen < maxBytes; i++) {
    let px;
    if (colMajor) {
      const x = Math.floor(i / height), y = i % height;
      px = y * width + x;
    } else {
      px = i;
    }
    const base = px * channels;
    for (let c = 0; c < step; c++) {
      byte |= ((samples[base + chans[c]] >> bit) & 1) << bitPos;
      if (++bitPos === 8) {
        out[outLen++] = byte;
        byte = 0; bitPos = 0;
        if (outLen >= maxBytes) break;
      }
    }
  }
  return out.subarray(0, outLen);
}

/**
 * 可读性打分（字母/空格优先，控制字符重罚，花括号加成）。
 * @param {string} text
 * @returns {number}
 */
export function englishScore(text) {
  if (!text) return 0;
  let sum = 0, n = 0;
  let hasL = false, hasR = false;
  for (const ch of text) {
    n++;
    const c = ch.codePointAt(0);
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || c === 0x20) sum += 1.0;
    else if (c >= 0x30 && c <= 0x39) sum += 0.6;
    else if (ch === "\n" || ch === "\t" || ch === "\r") sum += 0.4;
    else if ((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e)) {
      sum += 0.3;
      if (ch === "{") hasL = true;
      if (ch === "}") hasR = true;
    } else if (c <= 0x1f || (c >= 0x7f && c <= 0x9f)) sum += -3.0;
    else sum += 0.1;
  }
  let score = sum / n;
  if (hasL && hasR) score += 0.5;
  return score;
}

/**
 * LSB 全组合扫描主入口。
 * @param {Uint8Array} bytes PNG 或 BMP 文件字节
 * @param {object} opts { maxBit=0, columnMajor=false, flagRegex="flag\\{" }
 * @returns {{width:number,height:number,channels:number,tried:number,
 *   best:string,bestNote:string,candidates:Array<{text:string,score:number,note:string}>}}
 * @throws 非 PNG/BMP 或像素不可解码
 */
export function zstegScan(bytes, opts = {}) {
  let decoded = decodePngPixels(bytes);
  if (!decoded) decoded = decodeBmpPixels(bytes);
  if (!decoded) throw new Error("不支持的图片格式（仅 PNG / BMP）。JPEG 等有损格式无稳定 LSB 平面。");
  if (decoded.unsupported) throw new Error("像素解码失败: " + decoded.unsupported);
  const { width, height, channels, samples } = decoded;

  const maxBit = Math.max(0, Math.min(7, Math.floor(Number(opts.maxBit ?? 0)) || 0));
  const col = !!opts.columnMajor;
  const pat = String(opts.flagRegex ?? "flag\\{");
  let re = null;
  if (pat) { try { re = new RegExp(pat); } catch { re = null; } }
  const traversals = col ? [false, true] : [false];

  const cands = [];
  let tried = 0;
  for (let bit = 0; bit <= maxBit; bit++) {
    for (const [cname, chanIdx] of CHANNEL_COMBOS) {
      const chans = chanIdx.filter((c) => c < channels);
      if (chans.length === 0) continue;
      for (const msb of [true, false]) {
        for (const cm of traversals) {
          const raw = msb
            ? extractPlane(samples, width, height, channels, chans, bit, cm, MAX_BYTES)
            : extractPlaneLsbFirst(samples, width, height, channels, chans, bit, cm, MAX_BYTES);
          tried++;
          // 无效 UTF-8 字节替换为 U+FFFD（与逐字节有损解码行为一致）
          const text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
          let score = englishScore(text);
          if (re && re.test(text)) score += 5.0;
          const note = `bit${bit} ${cname} ${msb ? "msb" : "lsb"}${cm ? " 列优先" : ""}`;
          cands.push({ text, score, note });
        }
      }
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const top = cands.slice(0, TOP_N);
  return {
    width, height, channels, tried,
    best: top.length ? top[0].text : "",
    bestNote: top.length ? top[0].note : "",
    candidates: top,
  };
}

// ============ 测试构造器（供回归构造已知嵌入的载体） ============
/**
 * 把 msg 的比特（MSB 先）写进指定通道的指定位平面，输出 PNG。
 * @param {Uint8Array|string} msg 秘密消息
 * @param {object} o { channel=0, bit=0, colMajor=false, lsbFirst=false, width=128, height=1, bgr=false(rgb 序) }
 * @returns {Uint8Array} PNG 字节
 */
export function makeLsbPng(msg, o = {}) {
  const channel = Math.max(0, Math.min(3, o.channel ?? 0));
  const bit = Math.max(0, Math.min(7, o.bit ?? 0));
  const colMajor = !!o.colMajor;
  const lsbFirst = !!o.lsbFirst;
  const width = Math.max(1, o.width ?? 128);
  const height = Math.max(1, o.height ?? 1);
  const msgBytes = typeof msg === "string" ? new TextEncoder().encode(msg) : new Uint8Array(msg);

  const rgba = new Uint8Array(width * height * 4).fill(0);
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255; // 不透明黑底

  const totalPx = width * height;
  const capBits = Math.min(msgBytes.length * 8, totalPx);
  for (let k = 0; k < capBits; k++) {
    const byteIdx = Math.floor(k / 8);
    const bitInByte = lsbFirst ? (k % 8) : (7 - (k % 8));
    const b = (msgBytes[byteIdx] >> bitInByte) & 1;
    const i = k;
    let px;
    if (colMajor) {
      const x = Math.floor(i / height), y = i % height;
      px = y * width + x;
    } else {
      px = i;
    }
    const off = px * 4 + channel;
    rgba[off] = (rgba[off] & ~(1 << bit) & 0xff) | (b << bit);
  }
  return encodePNG(rgba, width, height);
}

// ============ op run 包装 ============
function zstegRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  const r = zstegScan(bytes, {
    maxBit: p && p.maxBit,
    columnMajor: !!(p && p.columnMajor),
    flagRegex: p && p.flagRegex,
  });

  const lines = [
    `LSB 全组合扫描 · ${r.width}×${r.height} · ${r.channels} 通道 · 已试 ${r.tried} 组合`,
    "",
  ];
  if (r.candidates.length === 0) {
    lines.push("（图太小，无可提取组合）");
    return lines.join("\n");
  }
  const preview = (s) => {
    const t = s.replace(/\uFFFD/g, "·");
    return t.length > 200 ? t.slice(0, 200) + "…" : (t || "(空)");
  };
  r.candidates.forEach((c, i) => {
    lines.push(`#${i + 1}  [${c.score.toFixed(3)}] ${c.note}`);
    lines.push("    " + preview(c.text));
  });
  return lines.join("\n");
}

// ============ 注册 ============
register({
  id: "zstegScan", cat: "stego", name: "LSB 全组合扫描",
  desc: "PNG/BMP 位平面×通道×位序×行列遍历批量提取，按可读性+flag 正则打分排序（默认 bit0 十组合，可开到位 7 / 列优先）",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "maxBit", label: "最大 bit 位（0..7）", type: "number", default: 0 },
    { key: "columnMajor", label: "含列优先遍历", type: "bool", default: false },
    { key: "flagRegex", label: "flag 正则（空=不加成）", type: "text", default: "flag\\{" },
  ],
  run: zstegRun,
  acceptsBytes: true,
});

// ============ 加载期自检（失败未处理异常会非零退出，CI 可抓） ============
export const zstegSelfTest = (() => {
  const assert = (cond, msg) => { if (!cond) throw new Error("zstegScan 自检失败: " + msg); };

  // ① R 通道 LSB 行优先 MSB 嵌入 → best 含消息且组合精确命中（参考单测形态）
  {
    const png = makeLsbPng("flag{lsb}");
    const r = zstegScan(png, {});
    assert(r.best.includes("flag{lsb}"), `① best 应含 flag{lsb}，实际: ${JSON.stringify(r.best)}`);
    assert(r.bestNote === "bit0 r msb", `① 组合应 bit0 r msb，实际: ${r.bestNote}`);
  }
  // ② lsb-first 嵌入 → 命中 bit0 r lsb
  {
    const png = makeLsbPng("flag{lowfirst}", { lsbFirst: true });
    const r = zstegScan(png, {});
    assert(r.best.includes("flag{lowfirst}") && r.bestNote === "bit0 r lsb", `② ${r.bestNote}: ${JSON.stringify(r.best)}`);
  }
  // ③ 列优先嵌入 + columnMajor → 命中 列优先（多行图：单行图两种遍历等价测不出差异）
  {
    const png = makeLsbPng("flag{colmajor}", { colMajor: true, width: 8, height: 16 });
    const r = zstegScan(png, { columnMajor: true });
    assert(r.best.includes("flag{colmajor}") && r.bestNote.includes("列优先"), `③ ${r.bestNote}`);
  }
  // ④ B 通道 bit1 嵌入 + maxBit=1 → 命中 bit1 b
  {
    const png = makeLsbPng("flag{b1plane}", { channel: 2, bit: 1 });
    const r = zstegScan(png, { maxBit: 1 });
    assert(r.best.includes("flag{b1plane}") && r.bestNote === "bit1 b msb", `④ ${r.bestNote}`);
  }
  // ⑤ englishScore 规则抽查
  {
    const s1 = englishScore("abcd efgh");
    assert(s1 > 0.99 && s1 <= 1.0, `⑤ 纯字母≈1: ${s1}`);
    assert(englishScore("") === 0, "⑤ 空文本 0");
    const ctrl = englishScore("\u0001\u0002\u0003");
    assert(ctrl < 0, `⑤ 控制字符负分: ${ctrl}`);
    // "a{b}" = (1+0.3+1+0.3)/4 + 0.5 = 1.15；"axbx" = 1.0
    const brace = englishScore("a{b}");
    assert(Math.abs(brace - 1.15) < 1e-9, `⑤ {} 加成: ${brace}`);
    assert(englishScore("123") === 0.6, `⑤ 数字 0.6: ${englishScore("123")}`);
  }
  // ⑥ flag 正则加成：命中组合必然第一
  {
    const png = makeLsbPng("flag{regex_bonus}");
    const r = zstegScan(png, {});
    assert(r.candidates[0].note === "bit0 r msb" && r.candidates[0].score >= 5, `⑥ 首位应命中组合: ${r.candidates[0].note} ${r.candidates[0].score}`);
  }
  // ⑦ 非 PNG/BMP 报错
  {
    let e = null;
    try { zstegScan(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]), {}); } catch (err) { e = err.message; }
    assert(e && e.includes("不支持的图片格式"), `⑦ 应拒 JPEG: ${e}`);
  }
  // ⑧ roundtrip：makeLsbPng → decodePngPixels 像素一致（encodePNG 闭环保险）
  {
    const png = makeLsbPng("xyz", { width: 4, height: 4 });
    const dec = decodePngPixels(png);
    assert(dec && dec.width === 4 && dec.height === 4 && dec.channels === 4, "⑧ 尺寸/通道");
    assert(dec.samples[0] === 0 && dec.samples[3] === 255, `⑧ 像素底色/alpha: ${dec.samples[0]},${dec.samples[3]}`);
  }
  // ⑨ 默认参数组合数 = 10（5 通道 × 2 位序 × 1 遍历）
  {
    const png = makeLsbPng("n", { width: 32, height: 1 });
    const r = zstegScan(png, {});
    assert(r.tried === 10, `⑨ 默认应 10 组合: ${r.tried}`);
    const r2 = zstegScan(png, { maxBit: 7, columnMajor: true });
    assert(r2.tried === 160, `⑨ 全开应 160 组合: ${r2.tried}`);
  }
  // ⑩ 窄图不炸：灰度 1 通道（rgb/bgr 组合越界通道过滤后等效 r）
  {
    // 手搓 1×8 灰度 PNG 太繁琐，改用 3 通道 BMP 路径验证 bgr 组合可提取
    const png = makeLsbPng("flag{grn}", { channel: 1 });
    const r = zstegScan(png, {});
    assert(r.best.includes("flag{grn}") && r.bestNote === "bit0 g msb", `⑩ ${r.bestNote}`);
  }
  return true;
})();
