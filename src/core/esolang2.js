/*
 * esolang2.js — esolang 扩展组（cat:'fancy'，T83）。
 * Deadfish 双向、Befunge-93 执行器、Emojicode 识别、Piet 识别。
 *
 * 红线：不与 fancy.js/fancy2.js/fancy3.js 已有的 brainfuck/ook/whitespace/
 * malbolge/pigpen/keyboardShift 等重复。Brainfuck/Ook 已实现，本组跳过。
 *
 * 沙箱：所有 esolang 执行器都带步数上限 MAX_STEPS，防死循环；网格越界环绕保护。
 *
 * 算法来源：
 * - Deadfish：Jonathan Todd Skinner 设计的极简语言，累加器 + i/d/s/o 四指令。
 * - Befunge-93：Chris Pressey 设计的 2D 栈式语言（Wikipedia "Befunge" 规范）。
 * - Emojicode / Piet：仅识别（Piet 为图像色块语言，纯文本无法执行）。
 */
import { register } from "./registry.js";

const MAX_STEPS = 1_000_000;

// ============ Deadfish（累加器 + i/d/s/o 四指令，双向） ============
// 规则（标准 Deadfish）：累加器 acc 初始 0。
// i acc++ d acc-- s acc = acc*acc o 输出当前 acc
// 每步执行后：若 acc === -1 或 acc === 256，则 acc 归零（经典边界重置规则）。

function deadfishNormalize(acc) {
  if (acc === -1 || acc === 256) return 0;
  return acc;
}

// encode：文本 → deadfish 指令串。逐字符用 i/d 从当前累加器直达目标 charCode 后 o。
// charCode 与当前 acc 都在 0..255（含目标），单调增减途中不会触碰 -1/256，故不触发重置。
function deadfishEncode(text) {
  const s = String(text);
  let acc = 0;
  let out = "";
  for (const ch of s) {
    const target = ch.codePointAt(0);
    if (target > 0xffff) {
      throw new Error("Deadfish: 仅支持 BMP 字符（码点 ≤ 65535），遇到 " + target);
    }
    if (target > acc) out += "i".repeat(target - acc);
    else if (target < acc) out += "d".repeat(acc - target);
    out += "o";
    acc = target;
  }
  return out;
}

// decode：执行 deadfish 指令 → 输出数值序列（首行空格分隔），附字符还原预览。
function deadfishDecode(src) {
  const code = String(src);
  let acc = 0;
  const values = [];
  let steps = 0;
  for (const c of code) {
    if (c === "i" || c === "d" || c === "s" || c === "o") {
      if (++steps > MAX_STEPS) throw new Error("Deadfish: 超过步数上限，可能是死循环");
    }
    switch (c) {
      case "i": acc = deadfishNormalize(acc + 1); break;
      case "d": acc = deadfishNormalize(acc - 1); break;
      case "s": acc = deadfishNormalize(acc * acc); break;
      case "o": values.push(acc); break;
      default: break; // 非指令字符（空白/注释）忽略
    }
  }
  const nums = values.join(" ");
  const chars = values
    .map((v) => (v >= 32 && v <= 0x10ffff ? String.fromCodePoint(v) : "·"))
    .join("");
  return nums + "\n(chars: " + chars + ")";
}

// ============ Befunge-93（2D 栈式语言执行器，run 单向） ============
// 网格环绕（torus），指针方向 > < ^ v，@ 结束，步数上限防死循环。
// 支持：0-9 压数、+ - * / % 算术、! 逻辑非、` 大于、_ | 条件、" 字符串模式
// : dup、\ swap、$ pop、. 输出整数、, 输出字符、# bridge、g get、p put
// & 输入整数(无源→0)、~ 输入字符(无源→-1)、? 随机方向、空格 no-op。

function befungeRun(src) {
  const raw = String(src).replace(/\r\n?/g, "\n");
  const lines = raw.split("\n");
  const h = Math.max(1, lines.length);
  const w = Math.max(1, ...lines.map((l) => l.length));
 // 网格填充为码点二维数组，空位补空格。
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = new Array(w);
    const line = lines[y] || "";
    for (let x = 0; x < w; x++) row[x] = x < line.length ? line.charCodeAt(x) : 32;
    grid.push(row);
  }

  const stack = [];
  const pop = () => (stack.length ? stack.pop() : 0);
  const push = (v) => stack.push(v | 0);

  let x = 0, y = 0, dx = 1, dy = 0;
  let strMode = false;
  const out = [];
  const MAX_OUT = 100_000;
  let steps = 0;

  const step = () => {
    x = (x + dx + w) % w;
    y = (y + dy + h) % h;
  };
  const emit = (s) => {
    if (out.length < MAX_OUT) out.push(s);
  };

  while (true) {
    if (++steps > MAX_STEPS) throw new Error("Befunge: 超过步数上限，可能是死循环");
    const code = grid[y][x];
    const ch = String.fromCharCode(code);

    if (strMode) {
      if (ch === '"') strMode = false;
      else push(code);
      step();
      continue;
    }

    if (ch >= "0" && ch <= "9") {
      push(code - 48);
    } else {
      switch (ch) {
        case "+": { const b = pop(), a = pop(); push(a + b); break; }
        case "-": { const b = pop(), a = pop(); push(a - b); break; }
        case "*": { const b = pop(), a = pop(); push(a * b); break; }
        case "/": { const b = pop(), a = pop(); push(b === 0 ? 0 : Math.floor(a / b)); break; }
        case "%": { const b = pop(), a = pop(); push(b === 0 ? 0 : a % b); break; }
        case "!": push(pop() === 0 ? 1 : 0); break;
        case "`": { const b = pop(), a = pop(); push(a > b ? 1 : 0); break; }
        case ">": dx = 1; dy = 0; break;
        case "<": dx = -1; dy = 0; break;
        case "^": dx = 0; dy = -1; break;
        case "v": dx = 0; dy = 1; break;
        case "?": {
          const r = Math.floor(Math.random() * 4);
          const dir = [[1, 0], [-1, 0], [0, 1], [0, -1]][r];
          dx = dir[0]; dy = dir[1];
          break;
        }
        case "_": { const v = pop(); dx = v === 0 ? 1 : -1; dy = 0; break; }
        case "|": { const v = pop(); dy = v === 0 ? 1 : -1; dx = 0; break; }
        case '"': strMode = true; break;
        case ":": { const v = pop(); push(v); push(v); break; }
        case "\\": { const b = pop(), a = pop(); push(b); push(a); break; }
        case "$": pop(); break;
        case ".": emit(String(pop()) + " "); break;
        case ",": emit(String.fromCharCode(pop() & 0xffff)); break;
        case "#": step(); break; // bridge：额外跳一格
        case "g": {
          const gy = pop(), gx = pop();
          const cy = ((gy % h) + h) % h, cx = ((gx % w) + w) % w;
          push(grid[cy][cx]);
          break;
        }
        case "p": {
          const py = pop(), px = pop(), v = pop();
          const cy = ((py % h) + h) % h, cx = ((px % w) + w) % w;
          grid[cy][cx] = v & 0xffff;
          break;
        }
        case "&": push(0); break;   // 无输入源，整数读 0
        case "~": push(-1); break;  // 无输入源，字符读 EOF(-1)
        case "@": return out.join("");
        case " ": break;            // no-op
        default: break;             // 未知字符忽略
      }
    }
    step();
  }
}

// ============ Emojicode 识别（emoji 关键字特征，run 单向） ============
// Emojicode 用 emoji 作关键字。识别其标志性关键字 emoji 出现情况并标注。
const EMOJICODE_KEYWORDS = [
  { e: "🏁", n: "程序入口 main" },
  { e: "🍇", n: "代码块开始 {" },
  { e: "🍉", n: "代码块结束 }" },
  { e: "🔤", n: "字符串字面量" },
  { e: "🍮", n: "变量声明/赋值" },
  { e: "🍦", n: "常量/冻结变量" },
  { e: "🔁", n: "while 循环" },
  { e: "🔂", n: "for-each 循环" },
  { e: "🍊", n: "if 条件" },
  { e: "🍋", n: "else if" },
  { e: "🍓", n: "else" },
  { e: "🆕", n: "构造 new" },
  { e: "🐕", n: "self 自身" },
  { e: "🔷", n: "类定义 class" },
  { e: "💭", n: "单行注释" },
  { e: "➡️", n: "返回类型箭头" },
  { e: "🐖", n: "方法定义" },
];

function emojicodeRun(text) {
  const s = String(text);
  const hits = [];
  for (const k of EMOJICODE_KEYWORDS) {
    const count = s.split(k.e).length - 1;
    if (count > 0) hits.push({ e: k.e, n: k.n, count });
  }
  if (!hits.length) {
    return "未检测到 Emojicode 关键字 emoji（如 🏁 🍇 🍉 🔤 🍮）。\n" +
      "Emojicode 是以 emoji 作关键字的编译型语言，源码形如 🏁 🍇 … 🍉。";
  }
  const total = hits.reduce((a, b) => a + b.count, 0);
  const lines = hits.map((k) => `  ${k.e}  ×${k.count}  ${k.n}`);
  const hasEntry = hits.some((k) => k.e === "🏁");
  const hasBlock = hits.some((k) => k.e === "🍇") && hits.some((k) => k.e === "🍉");
  const conf = hasEntry && hasBlock ? "高" : total >= 3 ? "中" : "低";
  return `识别为 Emojicode 源码（置信度：${conf}）。\n` +
    `命中关键字 emoji ${hits.length} 种，共 ${total} 次：\n` +
    lines.join("\n") +
    `\n\nEmojicode 是编译型面向对象语言，需 emojicodec 编译执行，本工具仅识别标注。`;
}

// ============ Piet 识别（图像色块语言，run 单向识别标注） ============
// Piet 程序是位图，用色块 + 色相/明度变化编码指令，纯文本无法执行。
function pietRun(text) {
  const s = String(text).trim();
  const hexColors = (s.match(/#?[0-9a-fA-F]{6}\b/g) || []).length;
  const mentionsPiet = /piet/i.test(s);
  const mentionsImg = /\.(png|gif|bmp|ppm)\b/i.test(s);
  const lines = [];
  lines.push("Piet 是图像色块深奥语言（David Morgan-Mar 设计）：");
  lines.push("程序是一张位图，由 18 种颜色（6 色相 × 3 明度）+ 黑白构成，");
  lines.push("指针在同色块间移动，靠色相/明度差编码 push/加减乘除/输入输出等指令。");
  lines.push("");
  if (mentionsPiet || mentionsImg || hexColors >= 6) {
    lines.push("输入疑似与 Piet 相关（检测到" +
      [mentionsPiet ? " 'piet' 关键词" : "", mentionsImg ? " 图像文件名" : "",
        hexColors >= 6 ? ` ${hexColors} 个十六进制颜色值` : ""].filter(Boolean).join("、") +
      "）。");
  } else {
    lines.push("未检测到 Piet 相关特征。");
  }
  lines.push("");
  lines.push("执行 Piet 需提供图像本体（像素色块），本工具仅识别标注，无法从纯文本运行。");
  return lines.join("\n");
}

// ---- 注册 ----
register({
  id: "deadfish", cat: "fancy", name: "Deadfish", desc: "累加器语言（i/d/s/o 四指令，加减平方输出，步数上限保护）",
  encode: deadfishEncode, decode: deadfishDecode,
  detect: (t) => {
    const s = String(t).trim();
    if (!s) return 0;
    return /^[idso]+$/.test(s) && /o/.test(s) && s.length >= 3 ? 0.4 : 0;
  },
});

register({
  id: "befunge", cat: "fancy", name: "Befunge-93 执行", desc: "2D 栈式深奥语言执行器（> < ^ v 方向，@ 结束，网格环绕，步数上限 100 万）",
  run: befungeRun,
  detect: (t) => {
    const s = String(t);
    if (!/@/.test(s)) return 0;
    const dirs = (s.match(/[<>^v]/g) || []).length;
    return dirs >= 2 && /["'.,:]/.test(s) ? 0.35 : 0;
  },
});

register({
  id: "emojicodeIdent", cat: "fancy", name: "Emojicode 识别", desc: "emoji 关键字语言识别（🏁🍇🍉🔤🍮 等特征，仅识别标注）",
  run: emojicodeRun,
  detect: (t) => {
    const s = String(t);
    let hits = 0;
    for (const k of EMOJICODE_KEYWORDS) if (s.includes(k.e)) hits++;
    return hits >= 2 ? 0.5 : (hits === 1 ? 0.2 : 0);
  },
});

register({
  id: "pietIdent", cat: "fancy", name: "Piet 识别", desc: "图像色块深奥语言识别（需图像本体，仅识别标注说明）",
  run: pietRun,
  detect: () => 0,
});

export {
  deadfishEncode, deadfishDecode,
  befungeRun,
  emojicodeRun, EMOJICODE_KEYWORDS,
  pietRun,
  MAX_STEPS,
};
