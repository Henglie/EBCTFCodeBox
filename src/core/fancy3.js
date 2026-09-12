/*
 * fancy3.js — 花式 / CTF 编码 C 组（cat:'fancy'，esolang + 趣味）。
 * Malbolge 识别、Whitespace 语言、猪圈密码 Pigpen、键盘漂移 keyboardShift。
 *
 * 算法来源：
 * - Whitespace 规范照 Wikipedia "Whitespace (programming language)" 实现
 * （三字符 space/tab/newline，栈机 + I/O，支持 push/printchar/end 子集足够 CTF 文本还原）。
 * - 猪圈密码照经典 3 区栅格（方框/X/带点方框，26 字母映射）。
 * - 键盘漂移照 QWERTY 三行循环移位（CTF 常见"键盘平移"题型）。
 * - Malbolge 仅识别（完整解释器需 ~100 行 ternary 加密机，CTF 场景识别即足够）。
 *
 * 红线：与 fancy.js/fancy2.js/text.js 已有的 brainfuck/ook/bacon/rot13/5/18/47/jsfuck 不重复。
 * 每个 encode/decode 用往返测试验证。
 */
import { register } from "./registry.js";

const te = (s) => [...new TextEncoder().encode(s)];
const td = (b) => new TextDecoder("utf-8").decode(new Uint8Array(b));

// ============ Whitespace 语言（space/tab/newline 三字符栈机） ============

// 替换旧版自创映射（旧版把 NTT 当结束、STS 当 swap、算术错位、跳转只消费不跳）。
// IMP（指令类别前缀）：
//   S  = Stack Manipulation（栈操作）
//   TS = Arithmetic（算术）      TT = Heap access（堆）
//   TN = I/O（输入输出）         N  = Flow control（流控）
// 栈操作（IMP S 后）：SS<n> push / SNS dup / SNT swap / SNN drop
//   STS<n> copy nth（v0.3 扩展）/ STN<n> slide n（v0.3 扩展）
// 算术（IMP TS 后）：TSSS add / TSST sub / TSSN mul / TSTS div / TSTT mod
//   （div/mod 用 floor 语义，同原始 Haskell 参考实现 wspace 的 div/mod；
//    正数场景与 trunc 一致；a == b*floor(a/b) + mod(a,b) 恒成立）
// 堆（IMP TT 后）：TTS store（先 push 地址再 push 值）/ TTT retrieve（官方 [Space]=store / [Tab]=retrieve）
// 流控（IMP N 后）：NSS<l> 标记 / NST<l> call 子程序 / NSN<l> 无条件跳
//   NTS<l> jz（pop，为 0 跳）/ NTT<l> jn（pop，为负跳）/ NTN ret / NNN 结束
// I/O（IMP TN 后）：TNSS 输出字符 / TNST 输出数字
//   TNTS 读字符存堆 / TNTT 读数字存堆（输入源 = params.stdin；EOF 存 -1）
// number 编码：[符号 S=+/T=-][二进制 S=0/T=1][NL 结束]
// label 编码：纯二进制（S/T）+ NL 结束（无符号位，空 label 合法）
const WS_S = " ", WS_T = "\t", WS_N = "\n";

function wsEncodeNum(n) {
 // 符号位 + 绝对值二进制 + NL
  const sign = n < 0 ? WS_T : WS_S;
  const bin = Math.abs(n).toString(2).replace(/1/g, WS_T).replace(/0/g, WS_S);
  return sign + bin + WS_N;
}

function whitespaceEncode(text) {
 // 每字符：push codepoint + print char；末尾 end

  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    out += WS_S + WS_S + wsEncodeNum(cp); // SS<number> = push
    out += WS_T + WS_N + WS_S + WS_S;      // TNSS = print char
  }
  out += WS_N + WS_N + WS_N;               // NNN = end
  return out;
}

function whitespaceDecode(text, params) {
  const safeInteger = value => {
    if (!Number.isSafeInteger(value)) throw new Error("Whitespace: 整数超出安全范围（绝对值上限 9007199254740991）");
    return value;
  };

 // （栈/算术/堆/流控/IO），支持真实跳转、子程序调用返回、stdin 输入源。
 // 容错：跳过非 S/T/N 字符（CTF 场景常含可见填充）。
 // 严格语义：截断指令/非法指令/空栈/越界/重复标签/缺结束符均为错误，

  const toks = [...String(text)].filter((c) => c === WS_S || c === WS_T || c === WS_N);

 // 输入源：params.stdin（字符流）。未提供时遇读指令（TNTS/TNTT）明确报错，
 // 不静默造 0（旧版 push(0) 是错误来源）。EOF 统一存 -1 到堆。
  const stdinRaw = params && params.stdin != null ? String(params.stdin) : null;
  const stdinCps = stdinRaw == null ? null : [...stdinRaw].map((c) => c.codePointAt(0));
  let stdinPos = 0;
  function readStdinChar() {
    if (stdinCps == null) throw new Error("Whitespace: 读指令(TNTS)需要输入源——请在「程序输入」参数中提供 stdin，或移除程序中的读指令");
    return stdinPos < stdinCps.length ? stdinCps[stdinPos++] : -1; // EOF = -1
  }
  function readStdinNum() {
    if (stdinCps == null) throw new Error("Whitespace: 读指令(TNTT)需要输入源——请在「程序输入」参数中提供 stdin，或移除程序中的读指令");
    while (stdinPos < stdinCps.length && /[\s]/.test(String.fromCodePoint(stdinCps[stdinPos]))) stdinPos++;
    let sign = 1, digits = "", sawSign = false;
    if (stdinPos < stdinCps.length) {
      const c = String.fromCodePoint(stdinCps[stdinPos]);
      if (c === "-" || c === "+") { sign = c === "-" ? -1 : 1; sawSign = true; stdinPos++; }
    }
    while (stdinPos < stdinCps.length && /[0-9]/.test(String.fromCodePoint(stdinCps[stdinPos]))) {
      digits += String.fromCodePoint(stdinCps[stdinPos]); stdinPos++;
    }
    if (!digits) return -1; // 无数字可读 = EOF
    void sawSign;
    return safeInteger(sign * parseInt(digits, 10));
  }

  function readNumber(start) {
 // 返回 [value, nextIndex]，读 [符号][二进制][NL]
    if (start >= toks.length) throw new Error("Whitespace: 数字不完整");
    if (toks[start] !== WS_S && toks[start] !== WS_T) throw new Error("Whitespace: 数字缺少符号位");
    const sign = toks[start] === WS_T ? -1 : 1;
    let j = start + 1;
    let bin = "";
    while (j < toks.length && toks[j] !== WS_N) {
      if (toks[j] !== WS_S && toks[j] !== WS_T) throw new Error("Whitespace: 数字含非法字符");
      bin += toks[j] === WS_T ? "1" : "0";
      j++;
    }
    if (j >= toks.length) throw new Error("Whitespace: 数字未终止（缺 NL）");
 // 空 bin（符号后直接 NL）= 0
    const val = safeInteger(bin ? sign * parseInt(bin, 2) : 0);
    return [val, j + 1];
  }

  function readLabel(start) {
 // label = 纯二进制 + NL，返回 [binString, nextIndex]
    let j = start;
    let bin = "";
    while (j < toks.length && toks[j] !== WS_N) {
      bin += toks[j] === WS_T ? "1" : "0";
      j++;
    }
    if (j >= toks.length) throw new Error("Whitespace: label 未终止");
    return [bin, j + 1];
  }

 // ---- 标签预扫描：NSS<label> → 执行位置（标签后第一条指令）----
 // 指令边界判定与执行循环共用同一解析表，防预扫与执行不一致。
  function skipInstruction(pos) {
 // 返回下一条指令位置；pos 越界/截断抛错。只做边界跳过不执行。
    const need = (n) => { if (pos + n > toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）"); };
    const t0 = toks[pos];
    if (t0 === WS_S) { // Stack IMP
      need(2);
      const t1 = toks[pos + 1];
      if (t1 === WS_S) { const [, n] = readNumber(pos + 2); return n; }        // SS<n> push
      need(3);
      const t2 = toks[pos + 2];
      if (t1 === WS_N && (t2 === WS_S || t2 === WS_T || t2 === WS_N)) return pos + 3; // SNS/SNT/SNN
      if (t1 === WS_T && (t2 === WS_S || t2 === WS_N)) { const [, n] = readNumber(pos + 3); return n; } // STS<n>/STN<n>
      throw new Error("Whitespace: 非法栈指令");
    } else if (t0 === WS_T) { // TS / TT / TN
      need(3);
      const t1 = toks[pos + 1], t2 = toks[pos + 2];
      if (t1 === WS_S) {
        need(4);
        if (!(t2 === WS_S || (t2 === WS_T && toks[pos + 3] !== WS_N))) throw new Error("Whitespace: 非法算术指令");
        return pos + 4;
      }
      if (t1 === WS_T) {
        if (t2 === WS_N) throw new Error("Whitespace: 非法 Heap IMP（堆仅 TTS store / TTT retrieve）");
        return pos + 3;
      }
      if (t1 === WS_N) {
        need(4);
        if (t2 === WS_N || toks[pos + 3] === WS_N) throw new Error("Whitespace: 非法 I/O 指令");
        return pos + 4;
      }
      throw new Error("Whitespace: 非法 IMP");
    } else { // N Flow
      need(3);
      const t1 = toks[pos + 1], t2 = toks[pos + 2];
      if (t1 === WS_S) { // NSS/NST/NSN + label
        if (t2 === WS_S || t2 === WS_T || t2 === WS_N) { const [, n] = readLabel(pos + 3); return n; }
        throw new Error("Whitespace: 非法流控指令");
      }
      if (t1 === WS_T) { // NTS/NTT + label；NTN ret
        if (t2 === WS_S || t2 === WS_T) { const [, n] = readLabel(pos + 3); return n; }
        if (t2 === WS_N) return pos + 3;
        throw new Error("Whitespace: 非法流控指令");
      }
      if (t1 === WS_N) { // NNN end
        if (t2 === WS_N) return pos + 3;
        throw new Error("Whitespace: 非法流控指令");
      }
      throw new Error("Whitespace: 非法流控指令");
    }
  }

  const labels = new Map(); // label 二进制串 → 指令位置
  {
    let j = 0;
    while (j < toks.length) {
      const pos = j;
      if (toks[j] === WS_N && toks[j + 1] === WS_S && toks[j + 2] === WS_S) { // NSS<label>
        const [name, next] = readLabel(j + 3);
        if (labels.has(name)) throw new Error("Whitespace: 重复标签（" + (name || "空") + "）");
        labels.set(name, next);
        j = next;
      } else {
        j = skipInstruction(pos);
      }
    }
  }

  function jumpTo(name) {
    const target = labels.get(name);
    if (target === undefined) throw new Error("Whitespace: 跳转到未定义标签");
    return target;
  }

 // ---- 执行循环 ----
  let i = 0;
  const stack = [];
  const heap = new Map();
  const callStack = [];
  let out = "";
  let steps = 0;
  const MAX_STEPS = 1_000_000;
  let ended = false;

  while (i < toks.length) {
    if (++steps > MAX_STEPS) throw new Error("Whitespace: 超过步数上限（疑似死循环）");
    const imp1 = toks[i];
    if (imp1 === WS_S) {
 // ---- Stack IMP ----
      if (i + 1 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
      const cmd = toks[i + 1];
      if (cmd === WS_S) {
 // SS<number> push
        const [v, next] = readNumber(i + 2);
        stack.push(v);
        i = next;
      } else if (cmd === WS_N) {
 // SNS dup / SNT swap / SNN drop
        if (i + 2 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
        const c2 = toks[i + 2];
        if (c2 === WS_S) { // SNS dup
          if (!stack.length) throw new Error("Whitespace: dup 空栈");
          stack.push(stack[stack.length - 1]);
          i += 3;
        } else if (c2 === WS_T) {
          if (stack.length < 2) throw new Error("Whitespace: swap 栈不足");
          const a = stack.pop(), b = stack.pop();
          stack.push(a, b);
          i += 3;
        } else if (c2 === WS_N) { // SNN drop
          if (!stack.length) throw new Error("Whitespace: drop 空栈");
          stack.pop();
          i += 3;
        } else throw new Error("Whitespace: 非法 SN 指令");
      } else if (cmd === WS_T) {

        if (i + 2 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
        const c2 = toks[i + 2];
        if (c2 === WS_S) { // STS<n> copy nth（0=栈顶）
          const [n, next] = readNumber(i + 3);
          if (n < 0 || n >= stack.length) throw new Error("Whitespace: copy 越界（n=" + n + "，栈深 " + stack.length + "）");
          stack.push(stack[stack.length - 1 - n]);
          i = next;
        } else if (c2 === WS_N) { // STN<n> slide n（保留栈顶，移除其下 n 个）
          const [n, next] = readNumber(i + 3);
          if (n < 0 || n > stack.length - 1) throw new Error("Whitespace: slide 越界（n=" + n + "，栈深 " + stack.length + "）");
          const top = stack.pop();
          for (let k = 0; k < n; k++) stack.pop();
          stack.push(top);
          i = next;
        } else throw new Error("Whitespace: 非法 ST 指令");
      } else throw new Error("Whitespace: 非法 Stack IMP");
    } else if (imp1 === WS_T) {
 // ---- TS 算术 / TT 堆 / TN I/O ----
      if (i + 2 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
      const c1 = toks[i + 1], c2 = toks[i + 2];
      if (c1 === WS_S) {
 // 算术：TSSS add / TSST sub / TSSN mul / TSTS div / TSTT mod

        if (i + 3 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
        const c3 = toks[i + 3];
        if (c2 === WS_S) {
          if (stack.length < 2) throw new Error("Whitespace: 算术栈不足");
          const b = stack.pop(), a = stack.pop();
          if (c3 === WS_S) stack.push(safeInteger(a + b));
          else if (c3 === WS_T) stack.push(safeInteger(a - b));
          else if (c3 === WS_N) stack.push(safeInteger(a * b));
          else throw new Error("Whitespace: 非法算术指令");
          i += 4;
        } else if (c2 === WS_T) {
          if (stack.length < 2) throw new Error("Whitespace: 算术栈不足");
          const b = stack.pop(), a = stack.pop();
          if (b === 0) throw new Error("Whitespace: 除零");
          // Bounded BigInt intermediates avoid rounding the floor-division product.
          const aa = BigInt(a), bb = BigInt(b);
          let q = aa / bb, r = aa % bb;
          if (r !== 0n && (r < 0n) !== (bb < 0n)) { q--; r += bb; }
          if (c3 === WS_S) {
            stack.push(Number(q));
          } else if (c3 === WS_T) {
            stack.push(Number(r));
          } else throw new Error("Whitespace: 非法 div/mod 指令");
          i += 4;
        } else throw new Error("Whitespace: 非法算术 IMP");
      } else if (c1 === WS_T) {
 // 堆：TTS store（先地址后值入栈）/ TTT retrieve（官方 [Space]=store / [Tab]=retrieve）
        if (c2 === WS_S) { // TTS store
          if (stack.length < 2) throw new Error("Whitespace: store 栈不足");
          const val = stack.pop(), addr = stack.pop();
          heap.set(addr, val);
          i += 3;
        } else if (c2 === WS_T) {
          if (!stack.length) throw new Error("Whitespace: retrieve 空栈");
          const addr = stack.pop();
          if (!heap.has(addr)) throw new Error("Whitespace: 堆地址未存储（" + addr + "）");
          stack.push(heap.get(addr));
          i += 3;
        } else throw new Error("Whitespace: 非法 Heap IMP（堆仅 TTS store / TTT retrieve）");
      } else if (c1 === WS_N) {
 // I/O：TNSS 输出字符 / TNST 输出数字 / TNTS 读字符 / TNTT 读数字
        if (i + 3 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
        const c3 = toks[i + 3];
        if (c2 === WS_S) {
          if (c3 === WS_S) { // TNSS print char
            if (!stack.length) throw new Error("Whitespace: print char 空栈");
            const v = stack.pop();
            if (!Number.isInteger(v) || v < 0 || v > 0x10ffff) throw new Error("Whitespace: print char 值非有效码点（" + v + "）");
            out += String.fromCodePoint(v);
            i += 4;
          } else if (c3 === WS_T) { // TNST print num
            if (!stack.length) throw new Error("Whitespace: print num 空栈");
            out += String(stack.pop());
            i += 4;
          } else throw new Error("Whitespace: 非法 TN I/O");
        } else if (c2 === WS_T) {

          if (!stack.length) throw new Error("Whitespace: 读指令空栈（缺堆地址）");
          const addr = stack.pop();
          if (c3 === WS_S) heap.set(addr, readStdinChar());  // TNTS：EOF = -1
          else if (c3 === WS_T) heap.set(addr, readStdinNum()); // TNTT：无数字 = -1
          else throw new Error("Whitespace: 非法 TT I/O");
          i += 4;
        } else throw new Error("Whitespace: 非法 I/O IMP");
      } else throw new Error("Whitespace: 非法 TS/TT/TN");
    } else if (imp1 === WS_N) {
 // ---- Flow IMP：NSS 标记 / NST call / NSN 跳 / NTS jz / NTT jn / NTN ret / NNN 结束 ----

 // NTT 当结束（NNN 反而抛「非法」）——官方程序（含 wiki Hello World）全部跑不了。
      if (i + 2 >= toks.length) throw new Error("Whitespace: 指令不完整（程序被截断）");
      const c1 = toks[i + 1], c2 = toks[i + 2];
      if (c1 === WS_S) {
        const [name, next] = readLabel(i + 3);
        if (c2 === WS_S) { // NSS 标记：无操作（预扫描已建表）
          i = next;
        } else if (c2 === WS_T) { // NST call 子程序：压返回地址，跳
          callStack.push(next);
          i = jumpTo(name);
        } else if (c2 === WS_N) { // NSN 无条件跳
          i = jumpTo(name);
        } else throw new Error("Whitespace: 非法 Flow NS");
      } else if (c1 === WS_T) {
        if (c2 === WS_S) { // NTS jz：pop，为 0 跳
          if (!stack.length) throw new Error("Whitespace: jz 空栈");
          const v = stack.pop();
          i = v === 0 ? jumpTo(readLabel(i + 3)[0]) : readLabel(i + 3)[1];
        } else if (c2 === WS_T) { // NTT jn：pop，为负跳
          if (!stack.length) throw new Error("Whitespace: jn 空栈");
          const v = stack.pop();
          i = v < 0 ? jumpTo(readLabel(i + 3)[0]) : readLabel(i + 3)[1];
        } else if (c2 === WS_N) { // NTN ret
          if (!callStack.length) throw new Error("Whitespace: ret 无调用者（调用栈空）");
          i = callStack.pop();
        } else throw new Error("Whitespace: 非法 Flow NT");
      } else if (c1 === WS_N) {
        if (c2 === WS_N) { // NNN 结束
          ended = true;
          break;
        } else throw new Error("Whitespace: 非法 Flow NN");
      } else throw new Error("Whitespace: 非法 Flow IMP");
    } else {
      throw new Error("Whitespace: 不可达字符（解析器内部错误）");
    }
  }
  if (!ended) throw new Error("Whitespace: 指令流耗尽但未执行 NNN 结束（缺少结束符或跳转落空）");
  return out;
}

// ============ 猪圈密码 Pigpen（文字 token 描述版） ============
// 经典 3 区栅格 26 字母映射：
// 区1（无点方框，3×3 开口方框）：A-I（9 字母）
// 区2（无点 X 形，3×3）：J-R（9 字母）
// 区3（带点方框）：S-Z（8 字母）
// token 格式：区号(1 位) + 位置(A-I 或 A-H)
// A→"1A" B→"1B" ... I→"1I"
// J→"2A" K→"2B" ... R→"2I"
// S→"3A" T→"3B" ... Z→"3H"
const PIGPEN_MAP = {};
const PIGPEN_REV = {};
(function buildPigpen() {
  const groups = [
    { start: "A", end: "I", region: "1" },  // A-I (9)
    { start: "J", end: "R", region: "2" },  // J-R (9)
    { start: "S", end: "Z", region: "3" },  // S-Z (8)
  ];
  for (const g of groups) {
    const s = g.start.charCodeAt(0);
    const e = g.end.charCodeAt(0);
    let pos = 0;
    for (let c = s; c <= e; c++) {
      const letter = String.fromCharCode(c);
      const posLetter = String.fromCharCode("A".charCodeAt(0) + pos);
      const token = g.region + posLetter;
      PIGPEN_MAP[letter] = token;
      PIGPEN_REV[token] = letter;
      pos++;
    }
  }
})();

function pigpenEncode(text) {
  return [...text.toUpperCase()].map((ch) => {
    if (ch in PIGPEN_MAP) return PIGPEN_MAP[ch];
    return ch; // 非字母原样
  }).join(" ");
}
function pigpenDecode(text) {
  return text.trim().split(/[\s,;]+/).filter(Boolean).map((tok) => {
    const t = tok.toUpperCase();
    if (t in PIGPEN_REV) return PIGPEN_REV[t];
    return tok; // 未识别原样
  }).join("");
}

// ============ 键盘漂移 keyboardShift（QWERTY 三行循环移位） ============
const KBD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const KBD_ROW_IDX = new Map();
KBD_ROWS.forEach((row, r) => {
  for (let c = 0; c < row.length; c++) KBD_ROW_IDX.set(row[c], [r, c]);
});

function keyboardShiftEncode(text, p) {
  const shift = Math.max(1, Number((p && p.shift) || 1));
  const dir = (p && p.direction) || "right";
  const sign = dir === "left" ? -1 : 1;
  return [...text].map((ch) => {
    const up = ch.toUpperCase();
    const idx = KBD_ROW_IDX.get(up);
    if (!idx) return ch; // 非字母原样
    const [r, c] = idx;
    const row = KBD_ROWS[r];
    const len = row.length;
    const newC = ((c + sign * shift) % len + len) % len;
    const newCh = row[newC];
    return ch === up ? newCh : newCh.toLowerCase();
  }).join("");
}
function keyboardShiftDecode(text, p) {
  const shift = Math.max(1, Number((p && p.shift) || 1));
  const dir = (p && p.direction) || "right";
 // decode 反向
  const revDir = dir === "left" ? "right" : "left";
  return keyboardShiftEncode(text, { shift, direction: revDir });
}

// ============ Malbolge 识别（run 返回说明，不执行） ============
// Malbolge：1998 年 Ben Olmstead 设计的深奥语言，程序由 ASCII 33-126 组成。
// 完整解释器需 ternary 加密机（~100 行），CTF 场景识别即足够。
function malbolgeInspect(text) {
  const code = String(text).replace(/\s/g, "");
  if (!code.length || code.length > 59049) return { ok: false, reason: "有效指令长度需为 1-59049" };
  const valid = new Set([4, 5, 23, 39, 40, 62, 68, 81]);
  for (let i = 0; i < code.length; i++) {
    const c = code.charCodeAt(i);
    if (c < 33 || c > 126 || !valid.has((c + i) % 94)) return { ok: false, reason: `位置 ${i} 不符合装载指令规则` };
  }
  return { ok: true, length: code.length };
}
function malbolgeRun(text) {
  const result = malbolgeInspect(text);
  if (!result.ok) throw new Error("Malbolge: " + result.reason + "；仅检查装载形式，不执行程序。");
  return `Malbolge 装载形式校验通过：${result.length} 个有效指令字符，已跳过空白。\n仅验证 ASCII 33-126 和 (字符码+位置)%94 的合法指令集合；未执行程序，不能据此保证运行输出。`;
}

// ---- 注册 ----
register({
  id: "whitespace", cat: "esolang", name: "Whitespace",
  verbatimInput: true,
  desc: "space/tab/newline 栈机语言（栈/算术/堆/流控/IO，100 万步上限，整数绝对值不超过 2^53-1）",
  params: [
    { key: "stdin", label: "程序输入（读指令输入源，可选）", type: "textarea", default: "",
      placeholder: "程序含读指令(TNTS/TNTT)时必填；EOF 记为 -1" },
  ],
  encode: whitespaceEncode, decode: whitespaceDecode,
  detect: (t) => {
    const ws = t.replace(/[^\s]/g, "");
    const nonWs = t.replace(/\s/g, "");
 // 全为空白且含 tab + 换行（纯空格不算）
    return nonWs.length === 0 && ws.length >= 4 && /\t/.test(t) && /\n/.test(t) ? 0.6 : 0;
  },
});

register({
  id: "pigpen", cat: "fancy", name: "猪圈密码 Pigpen", desc: "3 区栅格 26 字母（token 文字描述版 1A-3H）",
  encode: pigpenEncode, decode: pigpenDecode,
  detect: (t) => {
    const toks = t.trim().split(/[\s,;]+/).filter(Boolean);
    if (!toks.length) return 0;
    const allMatch = toks.every((tok) => /^[123][A-I]$/i.test(tok));
    return allMatch ? 0.5 : 0;
  },
});

register({
  id: "keyboardShift", cat: "fancy", name: "键盘漂移", desc: "QWERTY 三行循环移位（参数：位移量 + 方向）",
  params: [
    { key: "shift", label: "位移量", type: "number", default: 1, placeholder: "1-9" },
    { key: "direction", label: "方向", type: "select", default: "right",
      options: [
        { value: "right", label: "右移（encode 方向）" },
        { value: "left", label: "左移（encode 方向）" },
      ],
    },
  ],
  encode: keyboardShiftEncode, decode: keyboardShiftDecode,
});

register({
  id: "malbolge", cat: "esolang", name: "Malbolge 识别", desc: "深奥语言装载形式检查（忽略空白，按位置校验指令；仅识别不执行）",
  run: malbolgeRun,
  detect: text => { const result = malbolgeInspect(text); return result.ok && result.length >= 20 ? 0.2 : 0; },
});

export {
  whitespaceEncode, whitespaceDecode,
  pigpenEncode, pigpenDecode, PIGPEN_MAP, PIGPEN_REV,
  keyboardShiftEncode, keyboardShiftDecode, KBD_ROWS,
  malbolgeRun,
};
