/*
 * crc32Reverse.js — CRC32 反向碰撞（表驱动，cat:'analysis'）。
 *
 * 给定目标 CRC32 值，直接反推 4 字节 patch（不穷举）：
 * 标准 CRC32（poly 0xEDB88320，初始 0xFFFFFFFF，最终异或）逐字节前向表 + 反查表，
 * 从目标值逆推 4 字节使 calc(patch) == target。可附加「可打印字符前缀」搜索
 * （在指定字符集内枚举 2 字符前缀，再反推 4 字节补丁，得到可读的碰撞串）。
 *
 * 用途：CTF 中伪造文件 CRC（ZIP 伪加密/文件修复）、构造指定校验和的数据。
 * 与 crc32Collision（穷举式）互补：本 op 是解析解，O(1) 查表，快几个数量级。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 契约：register({ id:"crc32Reverse", cat:"analysis", name, desc, params, run })。
 */
import { register } from "./registry.js";

const POLY = 0xedb88320 >>> 0;

// 标准前向表 + 反查表（MSB → 候选字节）
let TABLE = null;
let REV = null;
function ensureTables() {
  if (TABLE) return;
  TABLE = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? ((c >>> 1) ^ POLY) >>> 0 : (c >>> 1) >>> 0;
    TABLE[i] = c >>> 0;
  }
  REV = new Array(256);
  for (let i = 0; i < 256; i++) REV[i] = [];
  for (let j = 0; j < 256; j++) {
    const msb = TABLE[j] >>> 24;
    REV[msb].push(j);
  }
}

/** 前向 CRC32（累加器风格）：语义对齐参考 calc(bytes, accum)——内部从 ~init 开始 */
function crcStep(accum, b) {
  return (TABLE[(accum ^ b) & 0xff] ^ (accum >>> 8)) >>> 0;
}
function crcBytes(bytes, init) {
  let a = (~(init === undefined ? 0 : init)) >>> 0;
  for (const b of bytes) a = crcStep(a, b);
  return (~a) >>> 0;
}

/** 反向求解：给定目标 CRC（最终值）与当前累加器，反推 4 字节 patch。返回字节数组集合。 */
function findReverse(desiredFinal, accumInit) {
  ensureTables();
  const accum = (~accumInit) >>> 0;
  const target = (~desiredFinal) >>> 0;
  const solutions = [];
  // DFS 4 层：node = (寄存器高位, ...已选字节)
  const stack = [[target >>> 0]];
  while (stack.length) {
    const node = stack.pop();
    const msb = (node[0] >>> 24) & 0xff;
    for (const j of REV[msb]) {
      if (node.length === 4) {
        // 第 4 层：反推 4 字节
        let a = accum;
        const bytes = [];
        const full = node.slice(1).concat([j]);
        for (let i = 3; i >= 0; i--) {
          bytes.push((a ^ full[i]) & 0xff);
          a >>>= 8;
          a = (a ^ TABLE[full[i]]) >>> 0;
        }
        // 验证
        if (crcBytes(bytes, accumInit) === (desiredFinal >>> 0)) {
          solutions.push(bytes);
        }
      } else {
        stack.push([((node[0] ^ TABLE[j]) << 8) >>> 0].concat(node.slice(1), [j]));
      }
    }
  }
  // 去重
  const seen = new Set();
  const out = [];
  for (const sol of solutions) {
    const key = sol.join(",");
    if (!seen.has(key)) { seen.add(key); out.push(sol); }
  }
  return out;
}

function fmtHex(b) {
  return b.map((x) => x.toString(16).padStart(2, "0")).join(" ");
}

function crc32ReverseRun(text, p) {
  const raw = String(text || "").trim();
  const crc = parseCrc(raw);
  if (crc === null) throw new Error("请输入目标 CRC32（hex，1-8 位，可带 0x 前缀）");
  const charSet = (p && p.charset) || "printable";
  const usePrefix = (p && p.prefix !== "none") ? (p.prefix || "printable") : "none";

  const lines = [];
  // 1. 纯 4 字节 patch
  const patches = findReverse(crc, 0);
  lines.push("== 4 字节补丁（使 CRC32 命中目标）==");
  for (const patch of patches.slice(0, 8)) {
    lines.push(`  ${fmtHex(patch)}  验证: ${crcBytes(patch, 0) === crc ? "OK" : "ERROR"}`);
  }
  if (!patches.length) lines.push("  （无解）");

  // 2. 可打印字符前缀搜索（2 字符前缀 + 4 字节补丁 → 6 字节可读串）
  if (usePrefix !== "none") {
    const cs = buildCharset(usePrefix);
    lines.push("== 可打印前缀 + 补丁（可读碰撞串）==");
    let n = 0;
    outer:
    for (const i of cs) {
      for (const j of cs) {
        const pre = [i, j];
        const sub = findReverse(crc, crcBytes(pre, 0));
        for (const patch of sub) {
          if (patch.every((b) => cs.includes(b))) {
            const full = pre.concat(patch);
            const s = String.fromCharCode(...full);
            lines.push(`  "${s}"  验证: ${crcBytes(full, 0) === crc ? "OK" : "ERROR"}`);
            if (++n >= 8) break outer;
          }
        }
      }
    }
    if (!n) lines.push("  （前缀字符集内无解）");
  }
  return lines.join("\n");
}

function parseCrc(raw) {
  let s = String(raw).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  return parseInt(s, 16) >>> 0;
}

function buildCharset(name) {
  if (name === "alnum") return [..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
  if (name === "digits") return [..."0123456789"];
  if (name === "hex") return [..."0123456789abcdef"];
  // printable 默认：ASCII 可见字符
  return Array.from({ length: 95 }, (_, i) => i + 32);
}

register({
  id: "crc32Reverse",
  cat: "analysis",
  name: "CRC32 反向碰撞",
  desc: "表驱动 CRC32 反向求解：给定目标 CRC32 直接反推 4 字节补丁（O(1) 查表不穷举），可加可打印字符前缀搜索得到可读碰撞串。CTF 伪造文件 CRC / ZIP 伪加密用",
  params: [
    { key: "prefix", label: "前缀字符集", type: "select", default: "printable",
      options: [{ value: "printable", label: "可打印 ASCII" }, { value: "alnum", label: "字母数字" }, { value: "digits", label: "纯数字" }, { value: "hex", label: "hex 字符" }, { value: "none", label: "不搜前缀" }] },
  ],
  run: (text, p) => crc32ReverseRun(text, p),
});

export { crcBytes, findReverse, crc32ReverseRun };
