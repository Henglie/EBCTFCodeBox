/*
 * bfDialects.js — Brainfuck 衍生方言（cat:'fancy'）。
 *
 * 对标 bftools.exe 的 BF 方言转换。BrainFuck/Ook 已在 fancy2.js 注册
 * 本文件只做 Ook 之外的衍生方言，opId 独立：
 * blub —— Blub!（Ook 同族，token 换成 Blub. Blub? Blub!，8 指令映射）
 * cow —— COW / MOO（12 指令自解释系统，Sean Heber 2003）
 *
 * 均自带 BF 解释器（步数上限防死循环），不 import 他人文件。
 * 往返测试：encode(文本)→decode 复原；BF 等价向量交叉验证。
 *
 * 算法来源：
 * - Blub：Ook 家族方言，与 Brainfuck 一一映射（公开规范）。
 * - COW：esolangs.org "COW" 规范，12 指令（moo/mOo/moO/mvo…/MOO/OOO/MMM/Moo 等）。
 */
import { register } from "./registry.js";

const MAX_STEPS = 5_000_000;

// ============ 通用 BrainFuck 解释器（自包含） ============
// 8 指令 > < + - . , [ ]；无输入源时 , 读 0；步数上限保护。
function bfRun(bf) {
  const code = String(bf).replace(/[^><+\-.,\[\]]/g, "");
 // 括号配对表。宽容孤儿括号：无匹配的 ] 与多余 [ 当 NOP（同 fancy2 brainfuckDecode 口径）
  const jump = new Map();
  const stack = [];
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "[") stack.push(i);
    else if (code[i] === "]") {
      if (stack.length) {
        const j = stack.pop();
        jump.set(i, j); jump.set(j, i);
      }
      // 孤儿 ]：不进 jump 表，执行时当 NOP
    }
  }
  // 多余的 [：同样不进 jump 表（等效匹配到程序尾）

  const tape = new Uint8Array(30000);
  let ptr = 0, ip = 0, steps = 0;
  let out = "";
  while (ip < code.length) {
    if (++steps > MAX_STEPS) throw new Error("BF: 超过步数上限，可能死循环");
    switch (code[ip]) {
      case ">": ptr = (ptr + 1) % tape.length; break;
      case "<": ptr = (ptr - 1 + tape.length) % tape.length; break;
      case "+": tape[ptr] = (tape[ptr] + 1) & 0xff; break;
      case "-": tape[ptr] = (tape[ptr] - 1 + 256) & 0xff; break;
      case ".": out += String.fromCharCode(tape[ptr]); break;
      case ",": tape[ptr] = 0; break; // 无输入源
      case "[": if (tape[ptr] === 0 && jump.has(ip)) ip = jump.get(ip); break;
      case "]": if (tape[ptr] !== 0 && jump.has(ip)) ip = jump.get(ip); break;
    }
    ip++;
  }
 // 输出为 latin1 字节流，按 UTF-8 还原
  return utf8FromLatin1(out);
}

function utf8FromLatin1(s) {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  try { return new TextDecoder("utf-8", { fatal: false }).decode(bytes); }
  catch { return s; }
}

// 文本 → BF（逐字节相对增减 + 输出，字节间用当前值差量，简洁可逆）
function textToBf(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let cur = 0, out = "";
  for (const b of bytes) {
    let d = b - cur;
    if (d > 0) out += "+".repeat(d);
    else if (d < 0) out += "-".repeat(-d);
    out += ".";
    cur = b;
  }
  return out;
}

// ============ Blub!（Ook 同族，8 指令一一映射 BF） ============
// 规范（esolangs Blub）：两 token 一组。
const BLUB_MAP = {
  "Blub. Blub?": ">", "Blub? Blub.": "<",
  "Blub. Blub.": "+", "Blub! Blub!": "-",
  "Blub! Blub.": ".", "Blub. Blub!": ",",
  "Blub! Blub?": "[", "Blub? Blub!": "]",
};
const BF_TO_BLUB = {};
for (const [k, v] of Object.entries(BLUB_MAP)) BF_TO_BLUB[v] = k;

function blubEncode(text) {
  const bf = textToBf(text);
  return [...bf].map((c) => BF_TO_BLUB[c]).filter(Boolean).join(" ");
}
function blubDecode(src) {
  const toks = String(src).match(/Blub[.?!]/g) || [];
  if (toks.length % 2 !== 0) throw new Error("Blub: token 数须为偶数");
  let bf = "";
  for (let i = 0; i < toks.length; i += 2) {
    const pair = toks[i] + " " + toks[i + 1];
    const cmd = BLUB_MAP[pair];
    if (!cmd) throw new Error("Blub: 非法组合 " + pair);
    bf += cmd;
  }
  return bfRun(bf);
}

// ============ COW / MOO（12 指令自解释系统） ============
// 规范（esolangs COW，大小写敏感）：
// moo 循环尾：跳回最近匹配 MOO 之后（配 MOO 构成 while）
// mOo ptr-- moO ptr++
// moO 已占（ptr++），下面按官方 12 指令列全：
// 实际 12 指令：
// 0 moo 与 MOO 配对的循环结束回跳
// 1 mOo ptr--
// 2 moO ptr++
// 3 mOO 把当前格的值当作指令码执行（禁止值 3，防自指死循环）
// 4 Moo 当前格==0 则从 stdin 读一字节写入；否则输出当前格 ASCII
// 5 MOo 当前格-- 6 MoO 当前格++
// 7 MOO 循环头：当前格==0 则跳到匹配 moo 之后，否则继续
// 8 OOO 当前格清零
// 9 MMM 无寄存器值→存当前格入寄存器；有→取出加到当前格并清寄存器
// 10 oom 读整数到当前格
// 11 OOM 输出当前格整数值
const COW_TOKENS = ["moo","mOo","moO","mOO","Moo","MOo","MoO","MOO","OOO","MMM","oom","OOM"];

function cowTokenize(src) {
  const toks = [];
  const re = /(moo|mOo|moO|mOO|Moo|MOo|MoO|MOO|OOO|MMM|oom|OOM)/g;
  let m;
  while ((m = re.exec(String(src))) !== null) toks.push(m[1]);
  return toks;
}

function cowRun(src) {
  const prog = cowTokenize(src);
 // MOO/moo 括号配对
  const jump = new Map();
  const stack = [];
  for (let i = 0; i < prog.length; i++) {
    if (prog[i] === "MOO") stack.push(i);
    else if (prog[i] === "moo") {
      if (!stack.length) throw new Error("COW: moo 无匹配 MOO");
      const j = stack.pop();
      jump.set(i, j); jump.set(j, i);
    }
  }
  if (stack.length) throw new Error("COW: MOO 无匹配 moo");

  const tape = new Int32Array(30000);
  let ptr = 0, ip = 0, steps = 0;
  let reg = null; // MMM 寄存器
  let out = "";

  const exec = (tok, fromMOO) => {
    switch (tok) {
      case "mOo": ptr = (ptr - 1 + tape.length) % tape.length; break;
      case "moO": ptr = (ptr + 1) % tape.length; break;
      case "MOo": tape[ptr] = (tape[ptr] - 1) | 0; break;
      case "MoO": tape[ptr] = (tape[ptr] + 1) | 0; break;
      case "OOO": tape[ptr] = 0; break;
      case "Moo":
        if (tape[ptr] === 0) tape[ptr] = 0; // 无 stdin，读作 0
        else out += String.fromCharCode(((tape[ptr] % 256) + 256) % 256);
        break;
      case "OOM": out += String(tape[ptr]); break;
      case "oom": tape[ptr] = 0; break; // 无 stdin
      case "MMM":
        if (reg === null) { reg = tape[ptr]; }
        else { tape[ptr] = (tape[ptr] + reg) | 0; reg = null; }
        break;
      case "mOO": {
 // 执行当前格值对应的指令（禁 3 防自指）
        const code = tape[ptr];
        if (code === 3) throw new Error("COW: mOO 指向 mOO（禁止自指）");
        if (code < 0 || code >= COW_TOKENS.length) throw new Error("COW: mOO 指令码越界 " + code);
        exec(COW_TOKENS[code], true);
        break;
      }
 // MOO / moo 循环由主循环处理，这里不该收到（除非经 mOO）
      case "MOO": if (tape[ptr] === 0) throw new Error("COW: mOO 触发 MOO 无法定位配对"); break;
      case "moo": break;
      default: break;
    }
  };

  while (ip < prog.length) {
    if (++steps > MAX_STEPS) throw new Error("COW: 超过步数上限，可能死循环");
    const tok = prog[ip];
    if (tok === "MOO") {
      if (tape[ptr] === 0) { ip = jump.get(ip); ip++; continue; }
    } else if (tok === "moo") {
      ip = jump.get(ip); continue; // 回到 MOO 重判
    } else {
      exec(tok, false);
    }
    ip++;
  }
  return utf8FromLatin1(out);
}

// 文本 → COW（线性：调值到目标后 Moo 输出，无循环，简洁可逆）
function cowEncode(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let cur = 0, out = [];
  for (const b of bytes) {
    if (b === 0) throw new Error("COW: 无法编码 NUL 字节（Moo 遇 0 读输入而非输出）");
    let d = b - cur;
    if (d > 0) for (let i = 0; i < d; i++) out.push("MoO");
    else if (d < 0) for (let i = 0; i < -d; i++) out.push("MOo");
    out.push("Moo");
    cur = b;
  }
  return out.join(" ");
}
function cowDecode(src) { return cowRun(src); }

// ---- 注册 ----
register({
  id: "blub", cat: "fancy", name: "Blub!",
  desc: "BrainFuck 的 Ook 同族方言（Blub. Blub? Blub! 三 token，两两组合映射 8 指令）。encode 生成 / decode 执行。",
  encode: blubEncode, decode: blubDecode,
  detect: (t) => (/Blub[.?!]/.test(t) ? 0.6 : 0),
});

register({
  id: "cow", cat: "fancy", name: "COW / MOO",
  desc: "COW 深奥语言（Sean Heber，12 指令 moo/mOo/moO/mOO/Moo/MOo/MoO/MOO/OOO/MMM/oom/OOM，含循环+寄存器+自解释 mOO，步数上限 500 万）。encode 生成 / decode 执行。",
  encode: cowEncode, decode: cowDecode,
  detect: (t) => {
    const toks = cowTokenize(t);
    return toks.length >= 4 && /MOO|Moo|MoO/.test(t) ? 0.5 : 0;
  },
});

export { blubEncode, blubDecode, cowEncode, cowDecode, cowRun, bfRun, BLUB_MAP, COW_TOKENS };

