/*
 * bfSwap.js — Brainfuck 字符交换变体（cat:'fancy'）。
 *
 * 定位：CTF 题中 Brainfuck 字符交换变体——首次执行异常时对称交换 7 字符后重跑。
 * 与现有 brainfuck op（fancy2.js，标准 BF + 宽容孤儿括号 + , 读 0）不同：
 * 本 op 的 , 为空操作（不读输入），且首次执行抛异常时做 7 字符对称交换后重跑。
 *
 * 适用场景：CTF 题目的 BF 程序以孤儿 ] 开头（标准/宽容解释器当 NOP 跳过 → 无输出），
 * 实际有效程序是交换后的版本（, 变 . 才有输出）。典型 payload 形如
 * `----------]<-----<...` ：前导 - 序列 + 孤儿 ] 触发交换，32 个 , 交换后变 32 个 .
 * 输出 flag。
 *
 * 算法：解析器标准 8 指令 BF，但逗号空操作 + 括号严格；外层 try 直跑 → 异常 7 字符交换重跑。
 * - brainfuck_interpreter：标准 8 指令 BF，但 , 空操作；括号严格（孤儿 ] 触发异常）
 * - 外层逻辑：try 第一次直接跑 → except 7 字符对称交换重跑 → 外层 except 返回空串
 * - 交换映射（对称置换）：- ↔ +, > ↔ <, ] ↔ [, , ↔ .
 *
 * 与 fancy2 brainfuckDecode 的关键差异：
 * - ,：fancy2 读 0（tape[ptr]=0）；本 op 空操作（不变 tape）
 * - 孤儿 ]：fancy2 当 NOP（预扫描不进 jump 表）；本 op 抛异常（运行时栈空）
 * - 异常处理：fancy2 不交换；本 op 交换 7 字符后重跑
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 不写 detect：BF 字符是 brainfuck/ook/blub/spoon 多 op 公共入口，fancy 类不参与
 * magic 自动预筛（对齐 fancy2 brainfuck 的 detect 由 runOneKey 显式调度）。
 *
 * 契约：register({ id, cat:'fancy', name, desc, encode, decode })。
 */
import { register } from "./registry.js";

const MAX_STEPS = 5_000_000;

// ============ Brainfuck 解释器（交换变体版）============
// 关键差异（vs fancy2 brainfuckDecode）：逗号空操作 + 括号严格（孤儿 ] 抛异常触发交换重跑）

function bfInterpreter(code) {
  const tape = new Uint8Array(30000);
  let ptr = 0, ip = 0;
  const out = [];
  const loopStack = [];
  let steps = 0;
  const N = code.length;
  while (ip < N) {
    if (++steps > MAX_STEPS) throw new Error("bfSwap: 超过步数上限，可能死循环");
    const cmd = code[ip];
    if (cmd === ">") ptr = (ptr + 1) % 30000;
    else if (cmd === "<") ptr = (ptr - 1 + 30000) % 30000;
    else if (cmd === "+") tape[ptr] = (tape[ptr] + 1) & 0xff;
    else if (cmd === "-") tape[ptr] = (tape[ptr] + 255) & 0xff;
    else if (cmd === ".") out.push(tape[ptr]);
    else if (cmd === ",") { /* 逗号空操作，不读输入 */ }
    else if (cmd === "[") {
      if (tape[ptr] === 0) {
        // 向后扫描匹配 ]（严格，无匹配抛异常——触发外层交换重跑）
        let depth = 1;
        while (depth > 0) {
          ip++;
          if (ip >= N) throw new Error("bfSwap: [ 无匹配 ]");
          if (code[ip] === "[") depth++;
          else if (code[ip] === "]") depth--;
        }
        // ip 指向匹配的 ]，主循环 ip++ 跳过
      } else {
        loopStack.push(ip);
      }
    } else if (cmd === "]") {
      if (tape[ptr] !== 0) {
        if (loopStack.length === 0) throw new Error("bfSwap: 孤儿 ] 无匹配 ["); // 触发交换重跑
        ip = loopStack[loopStack.length - 1]; // 跳回 [，主循环 ip++ 到 [ + 1（不重跑 [ 检查，等效优化）
      } else {
        loopStack.pop();
      }
    }
    ip++;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
}

// ============ 7 字符对称交换映射 ============
const SWAP_PAIRS = {
  "-": "+", "+": "-",
  ">": "<", "<": ">",
  "]": "[", "[": "]",
  ",": ".", ".": ",",
};

function swapCode(code) {
  let out = "";
  for (const c of code) out += (SWAP_PAIRS[c] || c);
  return out;
}

// ============ 外层：try 直跑 → except 交换重跑 → 外层 except 空串 ============
function bfSwapDecode(src) {
  const code = String(src == null ? "" : src).replace(/[^><+\-.,\[\]]/g, "");
  if (!code) return "";
  try {
    return bfInterpreter(code);
  } catch (e1) {
    try {
      return bfInterpreter(swapCode(code));
    } catch (e2) {
      return "";
    }
  }
}

// ============ encode：标准 BF 生成（与 fancy2 brainfuckEncode 一致，用 +-. 生成可往返程序）============
// 注：encode 产物只含 +-.，无 ,，bfSwapDecode 第一次直接跑即还原（不触发交换）
function bfSwapEncode(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  let out = "";
  let cur = 0;
  for (const b of bytes) {
    let diff = b - cur;
    if (diff > 128) diff -= 256;
    else if (diff < -128) diff += 256;
    out += (diff >= 0 ? "+" : "-").repeat(Math.abs(diff));
    out += ".";
    cur = b;
  }
  return out;
}

// ============ 注册 ============
register({
  id: "bfSwap",
  cat: "fancy",
  name: "Brainfuck·交换重跑",
  desc: "BF 字符交换变体：, 空操作 + 首次异常时 7 字符对称交换（-↔+ >↔< ]↔[ ,↔.）重跑。解孤儿 ] 开头/逗号当输出的 CTF 变体题",
  encode: bfSwapEncode,
  decode: bfSwapDecode,
});

export { bfSwapEncode, bfSwapDecode, bfInterpreter, swapCode, SWAP_PAIRS };
