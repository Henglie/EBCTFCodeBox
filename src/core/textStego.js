/*
 * textStego.js — 文本隐写入口（T278，cat:'stego'）。
 *
 * 定位：通用「明文里藏明文」类文本隐写，区别于：
 * - zeroWidth/zwVarSel/zwTags（零宽字符隐写，用不可见字符承载）
 * - snow（行尾空白隐写，用空格/制表符比特）
 * - whitespaceScan（空白扫描检测）
 * 本文件只用可见明文字符承载隐藏消息，CTF 常考的藏字/等距/大小写位方案。
 *
 * 覆盖（5 op，均双向 encode/decode + detect）：
 * acrostic 藏头/藏尾/藏中（首尾中位字符拼隐藏消息）
 * everyN 等距取字（每 N 字取一拼隐藏消息）
 * caseBitStego 大小写位隐写（字母大小写承载比特）
 * nthChar 第 N 字符隐写（每行/每句第 N 字拼隐藏消息，藏头泛化）
 * wordSpacingBits 词距位隐写（词间空格数承载比特）
 *
 * 红线：
 * - 算法可逆：encode→decode 必须能还原（往返测试贴回执）
 * - 规则写清：每个 op 注释 + 科普写明编码规则
 * - 查证不编造：算法为经典文本隐写方案（藏头诗/等距取字为古籍传统
 * 大小写位隐写为经典 LSB 变体），非编造
 * - 只新建本文件，不碰 stego.js / stegoText.js / snow.js 等现有 stego op
 * - 注册契约：register({id, cat:"stego", name, desc, params, encode, decode, detect})
 *
 * 不冲突现有 op id：stego.js(zeroWidth/zeroChar/zwTags/zwVarSel/emojiSubst/hxw/tadpole)
 * stegoText.js(zwScan/confusablesScan/unicodeNormalize/whitespaceScan/bidiScan/charInspect)
 * snow.js(snow)
 */
import { register } from "./registry.js";

// ============================================================
// 工具：UTF-8 字节 ↔ 二进制串
// ============================================================
function strToBytes(s) {
  return Array.from(new TextEncoder().encode(s));
}
function bytesToStr(arr) {
  return new TextDecoder().decode(new Uint8Array(arr));
}
function bytesToBits(bytes) {
  let bits = "";
  for (const b of bytes) bits += b.toString(2).padStart(8, "0");
  return bits;
}
function bitsToBytes(bits) {
 // bits 长度可能非 8 倍数，末尾补 0（解码时按 UTF-8 边界自然截断）
  const padded = bits.length % 8 === 0 ? bits : bits + "0".repeat(8 - (bits.length % 8));
  const out = [];
  for (let i = 0; i < padded.length; i += 8) out.push(parseInt(padded.slice(i, i + 8), 2));
  return out;
}

// ============================================================
// op1: acrostic 藏头/藏尾/藏中
// ============================================================
// 规则：把隐藏消息的每个字符放在载体每行（或每句/每词）的指定位置（首/尾/中）。
// encode(msg, cover, mode, pos)：
// - mode="line": 按行拆分载体，每行首/尾/中位替换为 msg 字符
// - mode="sentence": 按句号/问号/叹号拆分
// - mode="word": 按空格拆分
// - pos="head"(首) / "tail"(尾) / "mid"(中)
// - 载体行数/句数/词数须 ≥ msg 长度，否则补占位行
// decode(text, mode, pos)：取每行/句/词的首/尾/中字拼接
// 注意：载体字符被替换，解码需知道 mode+pos。可逆性 = encode 后 decode 还原 msg。
const SENTENCE_SPLIT = /([。！？.!?])/;

function splitCarrier(cover, mode) {
  if (mode === "line") {
    return cover.split(/\r?\n/);
  }
  if (mode === "sentence") {
 // 按句号/问号/叹号拆分，保留分隔符在前一段
    const parts = cover.split(SENTENCE_SPLIT);
    const sentences = [];
    for (let i = 0; i < parts.length; i += 2) {
      const s = parts[i] + (parts[i + 1] || "");
      if (s.trim()) sentences.push(s);
    }
    return sentences;
  }
  if (mode === "word") {
    return cover.split(/\s+/).filter((w) => w.length > 0);
  }
  return cover.split(/\r?\n/);
}

function getPosChar(s, pos) {
  if (!s) return "";
  const chars = [...s]; // 正确处理代理对
  if (pos === "head") return chars[0];
  if (pos === "tail") return chars[chars.length - 1];
  if (pos === "mid") return chars[Math.floor(chars.length / 2)];
  return chars[0];
}

function setPosChar(s, pos, ch) {
  const chars = [...s];
  if (chars.length === 0) return ch;
  if (pos === "head") chars[0] = ch;
  else if (pos === "tail") chars[chars.length - 1] = ch;
  else if (pos === "mid") chars[Math.floor(chars.length / 2)] = ch;
  else chars[0] = ch;
  return chars.join("");
}

function acrosticEncode(text, p) {
  const msg = String(text ?? "");
  const cover = String(p?.cover ?? "");
  const mode = p?.mode || "line";
  const pos = p?.pos || "head";
  if (!msg) throw new Error("隐藏消息不能为空");
  if (!cover) throw new Error("载体文本不能为空");
  const units = splitCarrier(cover, mode);
 // 补占位单元到 msg 长度
  const placeholder = mode === "word" ? "字" : "占位行";
  while (units.length < msg.length) units.push(placeholder);
  const msgChars = [...msg];
  const out = [];
  for (let i = 0; i < units.length; i++) {
    if (i < msgChars.length) {
      out.push(setPosChar(units[i], pos, msgChars[i]));
    } else {
      out.push(units[i]);
    }
  }
  if (mode === "line") return out.join("\n");
  if (mode === "sentence") return out.join("");
  if (mode === "word") return out.join(" ");
  return out.join("\n");
}

function acrosticDecode(text, p) {
  const src = String(text ?? "");
  const mode = p?.mode || "line";
  const pos = p?.pos || "head";
  const units = splitCarrier(src, mode);
  const chars = [];
  for (const u of units) {
    const c = getPosChar(u, pos);
    if (c) chars.push(c);
  }
  return chars.join("");
}

register({
  id: "acrostic", cat: "stego", name: "藏头/藏尾/藏中",
  desc: "文本隐写：把隐藏消息字符放在载体每行/句/词的首/尾/中位。encode 需载体，decode 取对应位置字符拼接",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "encode 时必填的可见外壳文本" },
    { key: "mode", label: "拆分方式", type: "select", default: "line", options: [
      { value: "line", label: "按行拆分（每行首/尾/中）" },
      { value: "sentence", label: "按句拆分（。！？.!? 分句）" },
      { value: "word", label: "按词拆分（空格分词）" },
    ] },
    { key: "pos", label: "藏字位置", type: "select", default: "head", options: [
      { value: "head", label: "藏头（首字）" },
      { value: "tail", label: "藏尾（末字）" },
      { value: "mid", label: "藏中（中间字）" },
    ] },
  ],
  encode: acrosticEncode, decode: acrosticDecode,
  detect: () => 0, // 藏头诗无法自动判别（任何文本都可能是藏头），detect 留 0
});

// ============================================================
// op2: everyN 等距取字
// ============================================================
// 规则：在载体文本中，每隔 N-1 个字符插入一个隐藏消息字符。
// encode(msg, cover, n)：把 msg 字符按每 N 位置 1 个分散进载体
// - 载体按 [...cover] 拆字符，在第 N-1, 2N-1, 3N-1... 位置插入 msg 字符
// - 实际做法：result = []; ci=0, mi=0; 循环：每 N-1 个载体字符后插 1 个 msg 字符
// decode(text, n)：每 N 取第 N 个字符（即位置 N-1, 2N-1, ...）拼接
// 注意：N>=2，载体须够长（载体字符数 >= (N-1)*msgLen），否则报错
function everyNEncode(text, p) {
  const msg = String(text ?? "");
  const cover = String(p?.cover ?? "");
  const n = Math.max(2, parseInt(p?.n, 10) || 3);
  if (!msg) throw new Error("隐藏消息不能为空");
  if (!cover) throw new Error("载体文本不能为空");
  const coverChars = [...cover];
  const msgChars = [...msg];
 // 载体字符数须 >= (N-1) * msg.length，否则位置错乱无法还原
  if (coverChars.length < (n - 1) * msgChars.length) {
    throw new Error(`载体长度 ${coverChars.length} 不足，需 ${(n - 1) * msgChars.length} 字符承载 ${msgChars.length} 个隐藏字符`);
  }
  const out = [];
  let ci = 0, mi = 0;
  while (mi < msgChars.length) {
 // 放 N-1 个载体字符
    for (let k = 0; k < n - 1 && ci < coverChars.length; k++) {
      out.push(coverChars[ci++]);
    }
 // 插 1 个 msg 字符
    out.push(msgChars[mi++]);
  }
 // 追加剩余载体
  while (ci < coverChars.length) out.push(coverChars[ci++]);
  return out.join("");
}

function everyNDecode(text, p) {
  const src = String(text ?? "");
  const n = Math.max(2, parseInt(p?.n, 10) || 3);
  const chars = [...src];
  const out = [];
 // 每 N 取第 N 个（索引 N-1, 2N-1, ...）
  for (let i = n - 1; i < chars.length; i += n) {
    out.push(chars[i]);
  }
  return out.join("");
}

register({
  id: "everyN", cat: "stego", name: "等距取字隐写",
  desc: "文本隐写：每 N 字取一拼隐藏消息。encode 把 msg 字符按每 N 位置 1 个分散进载体，decode 每 N 取第 N 个",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "encode 时必填的可见外壳文本" },
    { key: "n", label: "间距 N", type: "number", default: 3, placeholder: "每 N 字取一，N>=2" },
  ],
  encode: everyNEncode, decode: everyNDecode,
  detect: () => 0,
});

// ============================================================
// op3: caseBitStego 大小写位隐写
// ============================================================
// 规则：用载体文本中字母的大小写承载比特（大写=1，小写=0）。
// encode(msg, cover)：msg→UTF-8 字节→比特串；遍历载体字母，按比特改大小写
// - 载体非字母字符原样保留
// - 载体字母数须 >= 比特数，否则报错
// - 末尾追加长度标记（4 字节 = 32 比特，记录 msg 字节数）便于 decode 截断
// decode(text)：读载体字母大小写→比特→字节；前 32 比特为长度，后 N*8 比特为 msg
// 优势：完全用可见明文大小写，无任何不可见字符
// 注意：长度前缀用 32 位让 decode 自洽，不需外部传长度
function caseBitEncode(text, p) {
  const msg = String(text ?? "");
  const cover = String(p?.cover ?? "");
  if (!cover) throw new Error("载体文本不能为空");
  const msgBytes = strToBytes(msg);
 // 长度前缀 32 比特（msg 字节数）
  const lenBits = (msgBytes.length >>> 0).toString(2).padStart(32, "0");
  const msgBits = bytesToBits(msgBytes);
  const allBits = lenBits + msgBits;
  const coverChars = [...cover];
 // 统计载体字母数
  let letterCount = 0;
  for (const c of coverChars) if (/[a-zA-Z]/.test(c)) letterCount++;
  if (letterCount < allBits.length) {
    throw new Error(`载体字母数 ${letterCount} 不足以承载 ${allBits.length} 比特（需 ${Math.ceil(allBits.length)} 个字母）`);
  }
  const out = [];
  let bi = 0;
  for (const c of coverChars) {
    if (/[a-zA-Z]/.test(c) && bi < allBits.length) {
      const bit = allBits[bi++];
      const lower = c.toLowerCase();
      out.push(bit === "1" ? lower.toUpperCase() : lower);
    } else {
      out.push(c);
    }
  }
  return out.join("");
}

function caseBitDecode(text, p) {
  const src = String(text ?? "");
  const chars = [...src];
  let bits = "";
  for (const c of chars) {
    if (/[a-z]/.test(c)) bits += "0";
    else if (/[A-Z]/.test(c)) bits += "1";
  }
  if (bits.length < 32) throw new Error("载体字母不足 32 个，无法读取长度前缀");
  const lenBits = bits.slice(0, 32);
  const msgLen = parseInt(lenBits, 2);
  if (msgLen <= 0 || msgLen > 1000000) throw new Error("长度前缀非法：" + msgLen);
  const needBits = 32 + msgLen * 8;
  if (bits.length < needBits) throw new Error(`载体字母不足：需 ${needBits} 比特，实得 ${bits.length}`);
  const msgBits = bits.slice(32, needBits);
  const bytes = bitsToBytes(msgBits);
  return bytesToStr(bytes);
}

register({
  id: "caseBitStego", cat: "stego", name: "大小写位隐写",
  desc: "文本隐写：用载体字母大小写承载比特（大写=1，小写=0）。msg→UTF-8→比特→改大小写。前 32 比特为长度前缀",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "encode 时必填，须含足够字母" },
  ],
  encode: caseBitEncode, decode: caseBitDecode,
  detect: () => 0,
});

// ============================================================
// op4: nthChar 第 N 字隐写（藏头泛化）
// ============================================================
// 规则：每行第 N 个字符拼成隐藏消息（藏头=第1字，藏第2字=N=2 ...）。
// encode(msg, cover, n, sep)：按 sep 拆分载体为单元，把第 N 字替换为 msg 字符
// decode(text, n, sep)：取每单元第 N 字拼接
// 与 acrostic 区别：acrostic 是首/尾/中三选一，nthChar 是任意第 N 字
function nthCharEncode(text, p) {
  const msg = String(text ?? "");
  const cover = String(p?.cover ?? "");
  const n = Math.max(1, parseInt(p?.n, 10) || 1);
  const sep = p?.sep || "line";
  if (!msg) throw new Error("隐藏消息不能为空");
  if (!cover) throw new Error("载体文本不能为空");
  let units;
  if (sep === "line") units = cover.split(/\r?\n/);
  else if (sep === "sentence") units = cover.split(SENTENCE_SPLIT).filter((s) => s.trim()).map((s, i, a) => i % 2 === 0 ? s + (a[i + 1] || "") : null).filter(Boolean);
  else if (sep === "word") units = cover.split(/\s+/).filter((w) => w);
  else units = cover.split(/\r?\n/);
  const placeholder = sep === "word" ? "字" : "占位行";
  while (units.length < msg.length) units.push(placeholder);
  const msgChars = [...msg];
  const out = [];
  for (let i = 0; i < units.length; i++) {
    const chars = [...units[i]];
    if (i < msgChars.length) {
 // 第 N 字（索引 N-1），不足则补到 N 字
      while (chars.length < n) chars.push("字");
      chars[n - 1] = msgChars[i];
    }
    out.push(chars.join(""));
  }
  if (sep === "line") return out.join("\n");
  if (sep === "sentence") return out.join("");
  if (sep === "word") return out.join(" ");
  return out.join("\n");
}

function nthCharDecode(text, p) {
  const src = String(text ?? "");
  const n = Math.max(1, parseInt(p?.n, 10) || 1);
  const sep = p?.sep || "line";
  let units;
  if (sep === "line") units = src.split(/\r?\n/);
  else if (sep === "sentence") units = src.split(SENTENCE_SPLIT).filter((s) => s.trim()).map((s, i, a) => i % 2 === 0 ? s + (a[i + 1] || "") : null).filter(Boolean);
  else if (sep === "word") units = src.split(/\s+/).filter((w) => w);
  else units = src.split(/\r?\n/);
  const out = [];
  for (const u of units) {
    const chars = [...u];
    if (chars.length >= n) out.push(chars[n - 1]);
  }
  return out.join("");
}

register({
  id: "nthChar", cat: "stego", name: "第 N 字隐写",
  desc: "文本隐写：每行/句/词第 N 字拼隐藏消息（藏头=N1，藏第2字=N2）。encode 替换第 N 字，decode 取第 N 字",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "encode 时必填的可见外壳文本" },
    { key: "n", label: "第 N 字", type: "number", default: 1, placeholder: "1=藏头，2=藏第2字…" },
    { key: "sep", label: "拆分方式", type: "select", default: "line", options: [
      { value: "line", label: "按行" },
      { value: "sentence", label: "按句" },
      { value: "word", label: "按词" },
    ] },
  ],
  encode: nthCharEncode, decode: nthCharDecode,
  detect: () => 0,
});

// ============================================================
// op5: wordSpacingBits 词距位隐写
// ============================================================
// 规则：用词之间空格数承载比特（1空格=0，2空格=1）。
// encode(msg, cover)：msg→UTF-8→比特；遍历载体词间空格，按比特改空格数
// decode(text)：读词间空格数→比特→字节
// 注意：载体须有足够词间空格（词数-1 >= 比特数）
function wordSpacingEncode(text, p) {
  const msg = String(text ?? "");
  const cover = String(p?.cover ?? "");
  if (!cover) throw new Error("载体文本不能为空");
  const msgBytes = strToBytes(msg);
  const lenBits = (msgBytes.length >>> 0).toString(2).padStart(32, "0");
  const msgBits = bytesToBits(msgBytes);
  const allBits = lenBits + msgBits;
 // 拆分载体为词 + 空格序列
  const words = cover.split(/ +/);
  const gapCount = words.length - 1;
  if (gapCount < allBits.length) {
    throw new Error(`载体词间距数 ${gapCount} 不足以承载 ${allBits.length} 比特`);
  }
  let bi = 0;
  const out = [];
  for (let i = 0; i < words.length; i++) {
    out.push(words[i]);
    if (i < words.length - 1 && bi < allBits.length) {
      const bit = allBits[bi++];
      out.push(bit === "1" ? "  " : " "); // 2 空格=1，1 空格=0
    } else if (i < words.length - 1) {
      out.push(" ");
    }
  }
  return out.join("");
}

function wordSpacingDecode(text, p) {
  const src = String(text ?? "");
 // 提取词间空格序列
  const gaps = src.match(/ +/g) || [];
  let bits = "";
  for (const g of gaps) {
    bits += g.length >= 2 ? "1" : "0";
  }
  if (bits.length < 32) throw new Error("载体词间距不足 32 个，无法读取长度前缀");
  const lenBits = bits.slice(0, 32);
  const msgLen = parseInt(lenBits, 2);
  if (msgLen <= 0 || msgLen > 1000000) throw new Error("长度前缀非法：" + msgLen);
  const needBits = 32 + msgLen * 8;
  if (bits.length < needBits) throw new Error(`载体词间距不足：需 ${needBits} 比特，实得 ${bits.length}`);
  const msgBits = bits.slice(32, needBits);
  const bytes = bitsToBytes(msgBits);
  return bytesToStr(bytes);
}

register({
  id: "wordSpacingBits", cat: "stego", name: "词距位隐写",
  desc: "文本隐写：用词间空格数承载比特（1空格=0，2空格=1）。msg→UTF-8→比特→改空格数。前 32 比特为长度前缀",
  params: [
    { key: "cover", label: "载体文本", type: "text", default: "", placeholder: "encode 时必填，须含足够词间距" },
  ],
  encode: wordSpacingEncode, decode: wordSpacingDecode,
  detect: (t) => (/ {2,}/.test(t) ? 0.15 : 0), // 多空格轻度可疑
});

export {
  acrosticEncode, acrosticDecode,
  everyNEncode, everyNDecode,
  caseBitEncode, caseBitDecode,
  nthCharEncode, nthCharDecode,
  wordSpacingEncode, wordSpacingDecode,
};
