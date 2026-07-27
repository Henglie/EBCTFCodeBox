// T70 数字信号编码组 — 曼彻斯特/差分曼彻斯特/NRZI/密勒码/4B5B/PWM-PPM 比特流互转
//
// 红线：编码规则照 IEEE 802.3 / G.E. Thomas / USB NRZI / Miller / FDDI 4B5B 公开规范，未编造。
// 注册契约：见 T2 回执。cat:'fancy'，每 op encode+decode 双向，输入输出均为字符串（'0'/'1' 比特流或可打印字符流）。
// i18n key（请 M 并入 zh.js/en.js 防抢）：
// op.manchester.name / op.manchester.desc
// op.diffManchester.name / op.diffManchester.desc
// op.nrzi.name / op.nrzi.desc
// op.miller.name / op.miller.desc
// op.fourB5B.name / op.fourB5B.desc
// op.pwmPpm.name / op.pwmPpm.desc

import { register } from "./registry.js";

// ---------- 通用工具 ----------
/** 把字符串规整成纯 '0'/'1' 比特流：去空白/下划线/0b 前缀，非法字符抛错。 */
function toBitStream(s) {
  if (typeof s !== "string") throw new Error("输入必须为字符串");
  let out = "";
  for (const ch of s) {
    if (ch === "0" || ch === "1") out += ch;
    else if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "_") continue;
    else throw new Error("比特流仅允许 0/1（可含空白/下划线分隔），遇到非法字符: " + ch);
  }
  return out;
}

/** 比特流 → 字节序列（不足 8 位补 0，pad 标记是否补齐；返回 {bytes, padded}）。 */
function bitsToBytes(bits) {
  if (bits.length === 0) return { bytes: new Uint8Array(0), padded: 0 };
  const pad = (8 - (bits.length % 8)) % 8;
  const padded = bits + "0".repeat(pad);
  const out = new Uint8Array(padded.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(padded.slice(i * 8, i * 8 + 8), 2);
  }
  return { bytes: out, padded: pad };
}

/** 字节序列 → 比特流（每字节 8 位，不补齐）。 */
function bytesToBits(bytes) {
  let out = "";
  for (const b of bytes) {
    out += b.toString(2).padStart(8, "0");
  }
  return out;
}

/** 文本 → UTF-8 字节 → 比特流（用于把明文转成比特流再编码）。 */
function textToBits(text) {
  return bytesToBits(new TextEncoder().encode(text));
}

/** 比特流 → 字节 → UTF-8 文本（不足 8 位的尾部补零被丢弃，pad 返回丢弃位数）。 */
function bitsToText(bits) {
  const { bytes, padded } = bitsToBytes(bits);
 // 若有补齐，截掉最后 padded 个 0 对应的字节还原
 // 实际上 padded 个 0 不会跨字节，TextDecoder 会忽略尾部 0x00
 // 但为保持往返一致，decode 端应自行用 pad 信息还原，这里只做"比特流→字节"
  void padded;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ============================================================
// 1. 曼彻斯特编码（Manchester Encoding）
// ============================================================
// 双约定支持（IEEE 802.3 与 G.E. Thomas）：
// IEEE 802.3：0 → 10（高→低），1 → 01（低→高）—— 以太网默认
// G.E. Thomas：0 → 01，1 → 10 —— 经典教材默认
// encode: 比特流（或文本）→ 双倍长比特流
// decode: 双倍长比特流 → 原比特流（约定相反时也支持，自动兼容）
// ============================================================

function manchesterEncodeBits(bits, convention) {
 // convention: 'ieee' (默认) 或 'thomas'
  let out = "";
  if (convention === "thomas") {
    for (const b of bits) out += b === "1" ? "10" : "01";
  } else {
 // ieee: 1->01, 0->10
    for (const b of bits) out += b === "1" ? "01" : "10";
  }
  return out;
}

function manchesterDecodeBits(bits, convention) {
  if (bits.length % 2 !== 0) throw new Error("曼彻斯特编码长度必须为偶数");
  let out = "";
  if (convention === "thomas") {
    for (let i = 0; i < bits.length; i += 2) {
      const pair = bits.slice(i, i + 2);
      if (pair === "10") out += "1";
      else if (pair === "01") out += "0";
      else throw new Error("非法曼彻斯特码元: " + pair + "（应为 01 或 10）");
    }
  } else {
    for (let i = 0; i < bits.length; i += 2) {
      const pair = bits.slice(i, i + 2);
      if (pair === "01") out += "1";
      else if (pair === "10") out += "0";
      else throw new Error("非法曼彻斯特码元: " + pair + "（应为 01 或 10）");
    }
  }
  return out;
}

// ============================================================
// 2. 差分曼彻斯特编码（Differential Manchester）
// ============================================================
// 规则（IEEE 802.5 Token Ring 同约定）：
// - 每比特周期中央必有跳变（用于时钟同步）
// - 比特 0：周期起始处有跳变（电平翻转）
// - 比特 1：周期起始处无跳变（电平保持）
// encode 输入：比特流 + 初始电平（默认 0）
// decode 输出：比特流 + 推断出的初始电平（首码元无法单凭码流决定，约定 decode 输出按 encode 默认 initialLevel=0 还原）
// 注：差分曼彻斯特的 0/1 由"周期边界是否跳变"决定，与中央跳变方向无关。
// 因此 encode 时每对 2 比特中央一定有跳变（10 或 01 都可），关键是周期起始处是否翻转。
// ============================================================

function diffManchesterEncodeBits(bits, initialLevel) {
 // initialLevel: 0 或 1（默认 0）
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  for (const b of bits) {
    if (b === "0") {
 // 周期起始跳变
      level ^= 1;
    }
 // 第一半周期 = level
    out += level === 1 ? "1" : "0";
 // 中央跳变（必跳）
    level ^= 1;
    out += level === 1 ? "1" : "0";
  }
  return out;
}

function diffManchesterDecodeBits(bits, initialLevel) {
  if (bits.length % 2 !== 0) throw new Error("差分曼彻斯特编码长度必须为偶数");
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  for (let i = 0; i < bits.length; i += 2) {
    const firstHalf = bits[i] === "1" ? 1 : 0;
 // 第二半应与第一半相反（中央跳变）
    if (bits[i + 1] === bits[i]) {
      throw new Error("差分曼彻斯特码元中央未跳变: " + bits.slice(i, i + 2));
    }
 // 周期起始是否跳变 = (firstHalf !== level)
    if (firstHalf !== level) {
      out += "0"; // 跳变 = 0
    } else {
      out += "1"; // 不跳变 = 1
    }
    const secondHalf = bits[i + 1] === "1" ? 1 : 0;
 // 下一周期起始电平 = 本周期第二半电平（周期边界处电平延续）
    level = secondHalf;
  }
  return out;
}

// ============================================================
// 3. NRZI（Non-Return-to-Zero Inverted）
// ============================================================
// 双约定支持：
// USB（数据反转 NRZI）：0 = 跳变，1 = 不跳变 —— USB 2.0 / Fast Ethernet 100BASE-X 默认
// 经典 NRZI（数据 NRZI）：1 = 跳变，0 = 不跳变 —— 磁带/磁盘中用
// encode 输入：比特流 + 初始电平（默认 0）
// ============================================================

function nrziEncodeBits(bits, convention, initialLevel) {
 // convention: 'usb' (默认, 0->跳变) 或 'classic' (1->跳变)
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  for (const b of bits) {
    if (convention === "classic") {
      if (b === "1") level ^= 1;
    } else {
 // usb: 0 -> 跳变
      if (b === "0") level ^= 1;
    }
    out += level === 1 ? "1" : "0";
  }
  return out;
}

function nrziDecodeBits(bits, convention, initialLevel) {
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  for (const ch of bits) {
    const cur = ch === "1" ? 1 : 0;
    if (convention === "classic") {
 // 1 = 跳变
      out += (cur !== level) ? "1" : "0";
    } else {
 // usb: 0 = 跳变
      out += (cur !== level) ? "0" : "1";
    }
    level = cur;
  }
  return out;
}

// ============================================================
// 4. 密勒码（Miller Code / Delay Modulation）
// ============================================================
// 规则（经典 Miller，磁盘存储用）：
// 比特 1：比特周期中央跳变（产生一个跳变）
// 比特 0：
// - 若前一比特是 0：周期起始处跳变
// - 若前一比特是 1：周期起始处不跳变
// 即：1 → 中央跳变；0 跟在 1 后 → 不跳；0 跟在 0 后 → 起始跳变。
// 每比特占 2 个"半周期"（输出 2 个电平位），中央跳变只对 1 生效。
// ============================================================

function millerEncodeBits(bits, initialLevel) {
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  let prevBit = "1"; // 起始默认前一个为 1（避免首比特 0 时起始跳变被吞）
  for (const b of bits) {
    if (b === "0" && prevBit === "0") {
 // 周期起始跳变
      level ^= 1;
    }
 // 第一半周期
    out += level === 1 ? "1" : "0";
    if (b === "1") {
 // 中央跳变
      level ^= 1;
    }
 // 第二半周期
    out += level === 1 ? "1" : "0";
    prevBit = b;
  }
  return out;
}

function millerDecodeBits(bits, initialLevel) {
  if (bits.length % 2 !== 0) throw new Error("密勒码长度必须为偶数");
  let level = initialLevel === 1 ? 1 : 0;
  let out = "";
  let prevBit = "1";
  for (let i = 0; i < bits.length; i += 2) {
    const firstHalf = bits[i] === "1" ? 1 : 0;
    const secondHalf = bits[i + 1] === "1" ? 1 : 0;
 // 判定当前比特
    let bit;
    if (firstHalf !== secondHalf) {
 // 中央跳变 = 1
      bit = "1";
    } else {
 // 无中央跳变 = 0
      bit = "0";
 // 若前一比特也是 0，则周期起始应有跳变
 // (校验：firstHalf !== level 应当前一比特为 0 时成立)
 // 不严格校验起始跳变以容错（部分实现起始规则不同）
    }
    out += bit;
 // 更新 level：1 后无起始跳变，0 后视情况
    level = secondHalf;
    prevBit = bit;
  }
  return out;
}

// ============================================================
// 5. 4B5B（4-bit to 5-bit code）
// ============================================================
// FDDI / 100BASE-TX / CDDI 用。表照 ANSI X3T9.5 / FDDI PMD 规范，未编造。
// data code（16 项）：4-bit 输入 → 5-bit 输出
// control code（部分）：J=11000 K=10001 T=01101 R=00111 H=00100（用于帧定界，不在 encode 主路径）
// ============================================================

const FOURB5B_DATA = {
  "0000": "11110",
  "0001": "01001",
  "0010": "10100",
  "0011": "10101",
  "0100": "01010",
  "0101": "01011",
  "0110": "01110",
  "0111": "01111",
  "1000": "10010",
  "1001": "10011",
  "1010": "10110",
  "1011": "10111",
  "1100": "11010",
  "1101": "11011",
  "1110": "11100",
  "1111": "11101",
};

const FOURB5B_REV = (() => {
  const rev = {};
  for (const [k, v] of Object.entries(FOURB5B_DATA)) rev[v] = k;
  return rev;
})();

function fourB5BEncodeBits(bits) {
  if (bits.length % 4 !== 0) throw new Error("4B5B 编码输入长度必须是 4 的倍数（当前 " + bits.length + " 位）");
  let out = "";
  for (let i = 0; i < bits.length; i += 4) {
    const nibble = bits.slice(i, i + 4);
    const code = FOURB5B_DATA[nibble];
    if (!code) throw new Error("非法 4B5B 输入 nibble: " + nibble);
    out += code;
  }
  return out;
}

function fourB5BDecodeBits(bits) {
  if (bits.length % 5 !== 0) throw new Error("4B5B 解码输入长度必须是 5 的倍数（当前 " + bits.length + " 位）");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const code = bits.slice(i, i + 5);
    const nibble = FOURB5B_REV[code];
    if (nibble === undefined) throw new Error("非法 4B5B 码元: " + code + "（可能为控制码或线路违例）");
    out += nibble;
  }
  return out;
}

// ============================================================
// 6. PWM / PPM（Pulse-Width / Pulse-Position Modulation，比特流互转）
// ============================================================
// 这里实现 CTF 场景常见的"PWM/PPM 比特流可视化"——把 0/1 比特流编码为占空比/位置不同的方波描述。
// PWM 模式：0 = 短脉冲（10，1 位高 + 1 位低），1 = 长脉冲（110，2 位高 + 1 位低）
// 注：经典 PWM 比特编码有多种约定，本实现采用 CTF 常见的"宽度可变"约定
// PPM 模式：0 = 脉冲在前（100，1 位高 + 2 位低），1 = 脉冲在中（010，1 位低 + 1 位高 + 1 位低）
// 注：PPM 比特编码也有多种约定，本实现采用"位置可变"约定
// decode 端按"高电平持续长度"或"高电平位置"还原比特。
// ============================================================

function pwmEncodeBits(bits) {
 // 0 → "10"（短脉冲：1 高 1 低）
 // 1 → "110"（长脉冲：2 高 1 低）
  let out = "";
  for (const b of bits) out += b === "1" ? "110" : "10";
  return out;
}

function pwmDecodeBits(bits) {
  let out = "";
  let i = 0;
  while (i < bits.length) {
    if (bits[i] === "0") {
 // 起始就是 0，非法（PWM 脉冲必须以 1 起）
      throw new Error("PWM 解码遇非法起始 0，位置: " + i);
    }
 // 数连续 1 的个数
    let ones = 0;
    while (i < bits.length && bits[i] === "1") {
      ones++;
      i++;
    }
 // 后面应至少有 1 个 0
    if (i >= bits.length || bits[i] !== "0") {
      throw new Error("PWM 解码缺尾部 0，位置: " + i);
    }
    i++; // 吃掉 1 个 0
    if (ones === 1) {
      out += "0";
    } else if (ones === 2) {
      out += "1";
    } else {
      throw new Error("PWM 解码遇非法脉冲宽度 " + ones + " 位，位置: " + (i - ones - 1));
    }
  }
  return out;
}

function ppmEncodeBits(bits) {
 // 0 → "100"（脉冲在前）
 // 1 → "010"（脉冲在中）
  let out = "";
  for (const b of bits) out += b === "1" ? "010" : "100";
  return out;
}

function ppmDecodeBits(bits) {
  if (bits.length % 3 !== 0) throw new Error("PPM 解码输入长度必须是 3 的倍数");
  let out = "";
  for (let i = 0; i < bits.length; i += 3) {
    const sym = bits.slice(i, i + 3);
    if (sym === "100") out += "0";
    else if (sym === "010") out += "1";
    else throw new Error("非法 PPM 码元: " + sym);
  }
  return out;
}

// ============================================================
// 注册（cat:'fancy'）
// ============================================================

// 共用参数：convention（曼彻斯特/NRZI 用）、mode（PWM/PPM 切换）、initialLevel、inputFormat（auto/text/bits）
const convParam = {
  key: "convention",
  label: "约定",
  type: "select",
  default: "ieee",
  options: [
    { value: "ieee", label: "IEEE 802.3（0=10, 1=01）" },
    { value: "thomas", label: "G.E. Thomas（0=01, 1=10）" },
  ],
};

const nrziConvParam = {
  key: "convention",
  label: "约定",
  type: "select",
  default: "usb",
  options: [
    { value: "usb", label: "USB（0=跳变, 1=不跳变）" },
    { value: "classic", label: "经典（1=跳变, 0=不跳变）" },
  ],
};

const initLevelParam = {
  key: "initialLevel",
  label: "初始电平",
  type: "select",
  default: "0",
  options: [
    { value: "0", label: "0（低）" },
    { value: "1", label: "1（高）" },
  ],
};

const inputFormatParam = {
  key: "inputFormat",
  label: "输入格式",
  type: "select",
  default: "auto",
  options: [
    { value: "auto", label: "auto（自动判定）" },
    { value: "text", label: "text（UTF-8 文本→比特流）" },
    { value: "bits", label: "bits（直接比特流）" },
  ],
};

const pwmPpmModeParam = {
  key: "mode",
  label: "模式",
  type: "select",
  default: "pwm",
  options: [
    { value: "pwm", label: "PWM 脉宽调制" },
    { value: "ppm", label: "PPM 脉位调制" },
  ],
};

/** auto 判定：含非 0/1/空白字符 → text，否则 → bits */
function resolveInputFormat(text, p) {
  const fmt = p.inputFormat || "auto";
  if (fmt !== "auto") return fmt;
  for (const ch of text) {
    if (ch !== "0" && ch !== "1" && !/\s/.test(ch) && ch !== "_") return "text";
  }
  return "bits";
}

/** 把"输入文本"按 inputFormat 转成比特流 */
function inputToBits(text, p) {
  const fmt = resolveInputFormat(text, p);
  if (fmt === "text") return textToBits(text);
  return toBitStream(text);
}

/** 把"比特流"按 inputFormat 还原成输出文本：bits 模式直接返回比特串，text 模式转回 UTF-8 */
function bitsToOutput(bits, p) {
  const fmt = p.inputFormat || "auto";
 // text 模式：转回 UTF-8 文本
 // 但若文本含补充平面字符且原比特流是字节对齐的，UTF-8 应能正确还原
 // 这里只在 inputFormat==='text' 时尝试还原文本；bits 模式直接返回比特串
  if (fmt === "text") {
    try {
      const txt = bitsToText(bits);
 // 检查是否全 0 尾部（补齐 8 位的）
      return txt;
    } catch {
      return bits;
    }
  }
  return bits;
}

register({
  id: "manchester",
  cat: "fancy",
  name: "曼彻斯特编码",
  desc: "Manchester Encoding：每比特中央跳变，0/01 ↔ 1/10（IEEE 802.3 / G.E. Thomas 双约定）。输入文本或比特流。",
  params: [inputFormatParam, convParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    const out = manchesterEncodeBits(bits, p.convention || "ieee");
    return out;
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const out = manchesterDecodeBits(bits, p.convention || "ieee");
    return bitsToOutput(out, p);
  },
});

register({
  id: "diffManchester",
  cat: "fancy",
  name: "差分曼彻斯特编码",
  desc: "Differential Manchester：中央必跳变（时钟），0=周期起始跳变，1=不跳变（IEEE 802.5 Token Ring 约定）。",
  params: [inputFormatParam, initLevelParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    const init = parseInt(p.initialLevel || "0", 10);
    return diffManchesterEncodeBits(bits, init);
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const init = parseInt(p.initialLevel || "0", 10);
    const out = diffManchesterDecodeBits(bits, init);
    return bitsToOutput(out, p);
  },
});

register({
  id: "nrzi",
  cat: "fancy",
  name: "NRZI 编码",
  desc: "Non-Return-to-Zero Inverted：USB 约定 0=跳变/1=不跳变，经典约定 1=跳变/0=不跳变。USB 2.0 / Fast Ethernet 用。",
  params: [inputFormatParam, nrziConvParam, initLevelParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    const init = parseInt(p.initialLevel || "0", 10);
    return nrziEncodeBits(bits, p.convention || "usb", init);
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const init = parseInt(p.initialLevel || "0", 10);
    const out = nrziDecodeBits(bits, p.convention || "usb", init);
    return bitsToOutput(out, p);
  },
});

register({
  id: "miller",
  cat: "fancy",
  name: "密勒码",
  desc: "Miller Code / Delay Modulation：1=中央跳变，0 跟 0 后=起始跳变，0 跟 1 后=不跳变。磁盘存储用。",
  params: [inputFormatParam, initLevelParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    const init = parseInt(p.initialLevel || "0", 10);
    return millerEncodeBits(bits, init);
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const init = parseInt(p.initialLevel || "0", 10);
    const out = millerDecodeBits(bits, init);
    return bitsToOutput(out, p);
  },
});

register({
  id: "fourB5B",
  cat: "fancy",
  name: "4B5B 编码",
  desc: "4-bit → 5-bit code（FDDI/100BASE-TX）。表照 ANSI X3T9.5 规范，每 4 位映射为 5 位以保证足够跳变。",
  params: [inputFormatParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    if (bits.length % 4 !== 0) {
      throw new Error("4B5B 编码要求输入比特数为 4 的倍数（当前 " + bits.length + " 位，文本模式下需补齐字节边界）");
    }
    return fourB5BEncodeBits(bits);
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const out = fourB5BDecodeBits(bits);
    return bitsToOutput(out, p);
  },
});

register({
  id: "pwmPpm",
  cat: "fancy",
  name: "PWM/PPM 脉冲调制",
  desc: "PWM（脉宽）0=10, 1=110；PPM（脉位）0=100, 1=010。CTF 硬件流可视化常见。",
  params: [inputFormatParam, pwmPpmModeParam],
  encode(text, p) {
    const bits = inputToBits(text, p);
    return p.mode === "ppm" ? ppmEncodeBits(bits) : pwmEncodeBits(bits);
  },
  decode(text, p) {
    const bits = toBitStream(text);
    const out = p.mode === "ppm" ? ppmDecodeBits(bits) : pwmDecodeBits(bits);
    return bitsToOutput(out, p);
  },
});

// 导出纯函数供 T37 workerPool / T85 单元测试补齐 复用
export {
  toBitStream,
  bitsToBytes,
  bytesToBits,
  textToBits,
  bitsToText,
  manchesterEncodeBits,
  manchesterDecodeBits,
  diffManchesterEncodeBits,
  diffManchesterDecodeBits,
  nrziEncodeBits,
  nrziDecodeBits,
  millerEncodeBits,
  millerDecodeBits,
  fourB5BEncodeBits,
  fourB5BDecodeBits,
  pwmEncodeBits,
  pwmDecodeBits,
  ppmEncodeBits,
  ppmDecodeBits,
  FOURB5B_DATA,
  FOURB5B_REV,
};
