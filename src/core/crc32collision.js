/*
 * crc32collision.js — CRC32 短明文爆破 / 碰撞（T270，cat:'analysis'，单向 run）。
 *
 * 场景：CTF misc 里 ZIP 存了极小文件（1-6 字节），无法/懒得解压但知道 CRC32
 * 直接对目标 CRC32 穷举短明文反查原文。
 *
 * 算法：标准 CRC-32/ISO-HDLC（IEEE 802.3，即 zip/gzip 用的那个）。
 * 反射式多项式 0xEDB88320（= 0x04C11DB7 的位反射），init=0xFFFFFFFF
 * refIn/refOut=true，xorOut=0xFFFFFFFF。表驱动 + 增量计算。
 *
 * 契约：run(s, p) 忽略 s，用 p.crc 爆破，返回报告文本（命中候选列表 / 未命中）。
 * 参数：
 * crc 目标 CRC32（hex，"0x414fa339" 或 "414fa339" 均可）
 * maxLen 明文长度上限，默认 4，硬上限 5
 * charset printable(可打印ASCII 0x20-0x7E,95) / alnum(字母数字,62) / digits(0-9,10)
 *
 * 防爆：maxLen 硬上限 5；printable 超 4 字节给警告并拒跑（95^5≈77 亿，浏览器扛不住）。
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 */
import { register } from "./registry.js";

// ---- CRC32 表（标准 poly 0xEDB88320，反射式） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/** 对字节数组算标准 CRC32，返回无符号 32 位。 */
function crc32Bytes(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** 增量：已有中间 CRC 寄存器值 reg（尚未 finalize），追加一字节。 */
function crc32Step(reg, byte) {
  return (CRC_TABLE[(reg ^ byte) & 0xFF] ^ (reg >>> 8)) >>> 0;
}
// finalize：把寄存器值转成最终 CRC32
const crc32Final = (reg) => (reg ^ 0xFFFFFFFF) >>> 0;

// ---- 字符集 ----
function buildCharset(name) {
  if (name === "digits") {
    return Array.from({ length: 10 }, (_, i) => 0x30 + i); // 0-9
  }
  if (name === "alnum") {
    const a = [];
    for (let i = 0x30; i <= 0x39; i++) a.push(i); // 0-9
    for (let i = 0x41; i <= 0x5A; i++) a.push(i); // A-Z
    for (let i = 0x61; i <= 0x7A; i++) a.push(i); // a-z
    return a;
  }
 // printable：可打印 ASCII 0x20-0x7E（含空格），95 个
  const a = [];
  for (let i = 0x20; i <= 0x7E; i++) a.push(i);
  return a;
}

/** 把命中的字节数组渲染成可读串 + hex。 */
function fmtHit(bytes) {
  const s = bytes.map((b) => (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : ".")).join("");
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `"${s}"  (hex: ${hex}, len=${bytes.length})`;
}

/** 解析目标 CRC hex → 无符号 32 位，非法返回 null。 */
function parseCrc(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  return parseInt(s, 16) >>> 0;
}

// ---- 爆破核心：DFS 按长度递增，用增量 CRC 沿路径复用 ----
function bruteforce(target, maxLen, charsetName, cap) {
  const cs = buildCharset(charsetName);
  const hits = [];
  let tried = 0;
  let aborted = false;

 // 长度 1..maxLen，逐层穷举。用栈保存 (寄存器值) 沿当前前缀，避免重算前缀。
 // regStack[k] = 前 k 字节（含）的中间寄存器值；regStack[0]=init。
  const bytes = new Uint8Array(maxLen);
  const regStack = new Uint32Array(maxLen + 1);

  function dfs(depth, targetLen) {
    if (aborted) return;
    for (let i = 0; i < cs.length; i++) {
      const b = cs[i];
      bytes[depth] = b;
      regStack[depth + 1] = crc32Step(regStack[depth], b);
      if (depth + 1 === targetLen) {
        tried++;
        if (crc32Final(regStack[depth + 1]) === target) {
          hits.push(Array.from(bytes.subarray(0, targetLen)));
          if (hits.length >= cap) { aborted = true; return; }
        }
      } else {
        dfs(depth + 1, targetLen);
        if (aborted) return;
      }
    }
  }

  for (let len = 1; len <= maxLen && !aborted; len++) {
    regStack[0] = 0xFFFFFFFF; // init
    dfs(0, len);
  }
  return { hits, tried, aborted };
}

register({
  id: "crc32Collision",
  cat: "forensic",
  name: "CRC32 碰撞爆破",
  desc: "对目标 CRC32（标准 IEEE/zip CRC）穷举短明文反查原文。CTF misc 里 ZIP 存小文件、只知 CRC 时用。表驱动增量计算",
  params: [
    { key: "crc", label: "目标 CRC32（hex，如 0x414fa339 或 414fa339）", type: "text", default: "", placeholder: "0x414fa339" },
    { key: "maxLen", label: "明文长度上限（默认 4，硬上限 5）", type: "number", default: 4 },
    {
      key: "charset", label: "字符集", type: "select", default: "printable",
      options: [
        { value: "printable", label: "可打印 ASCII（0x20-0x7E，95 字符）" },
        { value: "alnum", label: "字母数字（0-9A-Za-z，62 字符）" },
        { value: "digits", label: "纯数字（0-9，10 字符）" },
      ],
    },
  ],
  run: function (s, p) {
    const target = parseCrc(p && p.crc);
    if (target === null) {
      return "（无效的目标 CRC32）请填 8 位以内十六进制，如 0x414fa339 或 414fa339。";
    }

    let maxLen = parseInt(p && p.maxLen, 10);
    if (!Number.isFinite(maxLen) || maxLen < 1) maxLen = 4;
    let clamped = false;
    if (maxLen > 5) { maxLen = 5; clamped = true; }

    const charset = (p && p.charset) || "printable";

 // 防爆：printable 超 4 字节直接拒跑（95^5≈77 亿）。
    const csSize = buildCharset(charset).length;
    if (charset === "printable" && maxLen >= 5) {
      return [
        "（拒绝执行 · 搜索空间过大）",
        `printable 字符集 5 字节 = 95^5 ≈ 77 亿组合，浏览器同步爆破会卡死。`,
        "建议：把 maxLen 降到 4，或换更小的字符集（alnum / digits），",
        "或已知明文更长时改用离线 hashcat/自写脚本。",
      ].join("\n");
    }

    const cap = 20; // 最多列 20 个命中（CRC32 短串通常唯一，防碰撞刷屏）
    const t0 = Date.now();
    const { hits, tried, aborted } = bruteforce(target, maxLen, charset, cap);
    const ms = Date.now() - t0;

    const targetHex = "0x" + target.toString(16).padStart(8, "0");
    const head = [];
    head.push(`目标 CRC32: ${targetHex}`);
    head.push(`字符集: ${charset}（${csSize} 字符）  长度上限: ${maxLen}`);
    if (clamped) head.push("注意: maxLen 已被压到硬上限 5。");
    head.push(`尝试组合: ${tried.toLocaleString()} 次  耗时: ${ms} ms`);
    head.push("");

    if (hits.length === 0) {
      head.push("未命中 ✗");
      head.push("建议: 增大 maxLen / 换字符集（原文可能含非可打印字节），或明文超 5 字节需离线爆破。");
      return head.join("\n");
    }

    head.push(`命中 ✓  共 ${hits.length} 个候选${aborted ? "（已达上限 " + cap + "，可能还有更多）" : ""}:`);
    hits.forEach((h, i) => head.push(`  [${i + 1}] ${fmtHit(h)}`));
    if (hits.length > 1) {
      head.push("");
      head.push("提示: CRC32 只 32 位，短串一般唯一；多个候选时结合文件长度 / 上下文判断。");
    }
    return head.join("\n");
  },
});
