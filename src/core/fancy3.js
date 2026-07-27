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
// 规范（Wikipedia）：IMP + 指令前缀 + 参数。
// SS<number> push number 到栈顶
// SNS dup 复制栈顶
// STS swap 交换栈顶两元素
// SNN drop 丢弃栈顶
// TSSS / TSNS / TSTS add / sub / mul（栈顶两元素算术，结果压栈）
// TSTT / TSTN div / mod
// TTS store 堆[次顶] = 栈顶
// TTT retrieve 压栈 堆[栈顶]
// NSS<label> label 标记
// NSN<label> jump 无条件跳转
// NST<label> jz 栈顶为 0 跳转
// NTSN ret 返回
// NTT end 结束程序
// TNSS print char 输出 chr(栈顶 pop)
// TNST print num 输出数字
// number 编码：[符号 S=+/T=-][二进制 S=0/T=1][NL 结束]
// label 编码：同 number 但无符号位（纯二进制 + NL）
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
  out += WS_N + WS_T + WS_T;               // NTT = end
  return out;
}

function whitespaceDecode(text) {
 // 解析执行：扫描 token，遇 push 压栈，遇 print char 输出，遇 end 停
 // 容错：跳过非 S/T/N 字符（CTF 场景常含可见填充）
  const toks = [...text].filter((c) => c === WS_S || c === WS_T || c === WS_N);
  let i = 0;
  const stack = [];
  const heap = new Map();
  let out = "";
  let steps = 0;
  const MAX_STEPS = 1_000_000;

  function readNumber(start) {
 // 返回 [value, nextIndex]，读 [符号][二进制][NL]
    if (start >= toks.length) throw new Error("Whitespace: 数字不完整");
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
    const val = bin ? sign * parseInt(bin, 2) : 0;
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

  while (i < toks.length) {
    if (++steps > MAX_STEPS) throw new Error("Whitespace: 超过步数上限（可能死循环）");
    const imp1 = toks[i];
    if (imp1 === WS_S) {
 // Stack IMP
      if (i + 1 >= toks.length) break;
      const cmd = toks[i + 1];
      if (cmd === WS_S) {
 // SS<number> push
        const [v, next] = readNumber(i + 2);
        stack.push(v);
        i = next;
      } else if (cmd === WS_N) {
 // SN_
        if (i + 2 >= toks.length) break;
        const c2 = toks[i + 2];
        if (c2 === WS_S) { // SNS dup
          if (!stack.length) throw new Error("Whitespace: dup 空栈");
          stack.push(stack[stack.length - 1]);
          i += 3;
        } else if (c2 === WS_N) { // SNN drop
          if (!stack.length) throw new Error("Whitespace: drop 空栈");
          stack.pop();
          i += 3;
        } else throw new Error("Whitespace: 非法 SN 指令");
      } else if (cmd === WS_T) {
 // ST_
        if (i + 2 >= toks.length) break;
        const c2 = toks[i + 2];
        if (c2 === WS_S) { // STS swap
          if (stack.length < 2) throw new Error("Whitespace: swap 栈不足");
          const a = stack.pop(), b = stack.pop();
          stack.push(a, b);
          i += 3;
        } else if (c2 === WS_N) { // STN<number> slide n
          const [n, next] = readNumber(i + 3);
          const top = stack.pop();
          for (let k = 0; k < n && stack.length; k++) stack.pop();
          stack.push(top);
          i = next;
        } else throw new Error("Whitespace: 非法 ST 指令");
      } else throw new Error("Whitespace: 非法 Stack IMP");
    } else if (imp1 === WS_T) {
 // TS/TT/TN
      if (i + 2 >= toks.length) break;
      const c1 = toks[i + 1], c2 = toks[i + 2];
      if (c1 === WS_S) {
 // Arithmetic TSS/TSN/TST
        if (i + 3 >= toks.length) break;
        const c3 = toks[i + 3];
        if (c2 === WS_S) {
 // TSS_
          if (stack.length < 2) throw new Error("Whitespace: 算术栈不足");
          const b = stack.pop(), a = stack.pop();
          if (c3 === WS_S) stack.push(a + b);       // TSSS add
          else if (c3 === WS_N) stack.push(a - b);  // TSNS sub
          else if (c3 === WS_T) stack.push(a * b);  // TSTS mul
          else throw new Error("Whitespace: 非法算术指令");
          i += 4;
        } else if (c2 === WS_T) {
 // TST_ div/mod
          if (stack.length < 2) throw new Error("Whitespace: 算术栈不足");
          const b = stack.pop(), a = stack.pop();
          if (b === 0) throw new Error("Whitespace: 除零");
          if (c3 === WS_T) stack.push(Math.trunc(a / b)); // TSTT div
          else if (c3 === WS_N) stack.push(a - Math.trunc(a / b) * b); // TSTN mod
          else throw new Error("Whitespace: 非法 div/mod 指令");
          i += 4;
        } else throw new Error("Whitespace: 非法算术 IMP");
      } else if (c1 === WS_T) {
 // Heap TTS store / TTT retrieve
        if (c2 === WS_S) { // TTS store: 堆[次顶]=栈顶
          if (stack.length < 2) throw new Error("Whitespace: store 栈不足");
          const val = stack.pop(), addr = stack.pop();
          heap.set(addr, val);
          i += 3;
        } else if (c2 === WS_T) { // TTT retrieve
          if (!stack.length) throw new Error("Whitespace: retrieve 空栈");
          const addr = stack.pop();
          stack.push(heap.get(addr) || 0);
          i += 3;
        } else throw new Error("Whitespace: 非法 Heap IMP");
      } else if (c1 === WS_N) {
 // I/O TNSS print char / TNST print num / TTS read char / TTT read num
        if (i + 3 >= toks.length) break;
        const c3 = toks[i + 3];
        if (c2 === WS_S) {
 // TN_
          if (c3 === WS_S) { // TNSS print char
            if (!stack.length) throw new Error("Whitespace: print char 空栈");
            const v = stack.pop();
            out += String.fromCodePoint(v & 0xffffff);
            i += 4;
          } else if (c3 === WS_T) { // TNST print num
            if (!stack.length) throw new Error("Whitespace: print num 空栈");
            out += String(stack.pop());
            i += 4;
          } else throw new Error("Whitespace: 非法 TN I/O");
        } else if (c2 === WS_T) {
 // TT_ read（本工具无输入源，读 0）
          if (c3 === WS_S) { stack.push(0); i += 4; }
          else if (c3 === WS_T) { stack.push(0); i += 4; }
          else throw new Error("Whitespace: 非法 TT I/O");
        } else throw new Error("Whitespace: 非法 I/O IMP");
      } else throw new Error("Whitespace: 非法 TS/TT/TN");
    } else if (imp1 === WS_N) {
 // Flow: NSS label / NSN jump / NST jz / NS? jn / NTSN ret / NTT end
      if (i + 2 >= toks.length) break;
      const c1 = toks[i + 1], c2 = toks[i + 2];
      if (c1 === WS_S) {
 // NS_ label/jump/jz/jn
        if (c2 === WS_S) { // NSS<label>
          const [, next] = readLabel(i + 3);
          i = next;
        } else if (c2 === WS_N) { // NSN<label> jump
          const [, next] = readLabel(i + 3);
          i = next; // 简化：不实现真实跳转（CTF 文本还原程序无循环）
        } else if (c2 === WS_T) { // NST<label> jz
          const [, next] = readLabel(i + 3);
 // 简化：栈顶 0 则跳（这里只消费，不真跳）
          if (stack.length && stack[stack.length - 1] === 0) stack.pop();
          i = next;
        } else throw new Error("Whitespace: 非法 Flow NS");
      } else if (c1 === WS_T) {
 // NT_ ret/end
        if (c2 === WS_S) { // NTSN ret
          i += 3;
        } else if (c2 === WS_T) { // NTT end
          break;
        } else throw new Error("Whitespace: 非法 Flow NT");
      } else throw new Error("Whitespace: 非法 Flow IMP");
    } else {
 // 不应到达（已过滤）
      i++;
    }
  }
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
function malbolgeRun(text) {
  const s = String(text);
  const chars = [...s].filter((c) => c !== "\n" && c !== "\r");
  const allPrintable = chars.every((c) => {
    const code = c.charCodeAt(0);
    return code >= 33 && code <= 126;
  });
  if (!allPrintable) {
    throw new Error("Malbolge: 程序含非 ASCII 33-126 字符（Malbolge 程序须为可打印字符）");
  }
  const len = chars.length;
 // 经典 Hello World 程序特征（首字符常为 '<' 或 '&' 等）
  const helloWorldHint = /('&%#9]|<)/.test(s) ? "（疑似 Hello World 类程序）" : "";
  return `Malbolge 程序识别：长度 ${len} 字符，全部为 ASCII 33-126 可打印字符${helloWorldHint}。\nMalbolge 为 1998 年 Ben Olmstead 设计的深奥语言（ternary 加密机 + 三寄存器），本工具仅识别不执行，需专用解释器运行。`;
}

// ---- 注册 ----
register({
  id: "whitespace", cat: "fancy", name: "Whitespace", desc: "space/tab/newline 三字符栈机语言（push+printchar 子集，CTF 文本还原）",
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
  id: "malbolge", cat: "fancy", name: "Malbolge 识别", desc: "深奥语言识别（ASCII 33-126，仅识别不执行）",
  run: malbolgeRun,
  detect: (t) => {
    const s = String(t);
    const chars = [...s].filter((c) => c !== "\n" && c !== "\r");
    if (!chars.length || chars.length < 10) return 0;
    const allPrintable = chars.every((c) => {
      const code = c.charCodeAt(0);
      return code >= 33 && code <= 126;
    });
    return allPrintable && chars.length >= 20 ? 0.2 : 0;
  },
});

export {
  whitespaceEncode, whitespaceDecode,
  pigpenEncode, pigpenDecode, PIGPEN_MAP, PIGPEN_REV,
  keyboardShiftEncode, keyboardShiftDecode, KBD_ROWS,
  malbolgeRun,
};
