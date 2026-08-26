/*
 * customPresetsExtra.js — T356：CTF 常用魔改预设扩充（EXTRA_PRESETS，≥20 个）。
 *
 * 形状与 src/core/customImpl.js 的内置 CUSTOM_PRESETS 一致：{ id, name, code }。
 * 主开发归并时在 customImpl.js 里 import 并进 presetsFor()（待并 import 行见回执）：
 *   import { EXTRA_PRESETS } from "./customPresetsExtra.js";
 *   presetsFor(opId) 里把 CUSTOM_PRESETS.concat(...) 改为
 *   CUSTOM_PRESETS.concat(EXTRA_PRESETS, _extraPresets.filter(...))
 *
 * 约定（与内置 8 个完全一致）：
 *  - 首行中文注释说明是什么魔改 + 参数含义；
 *  - 参数一律从 params 取并给默认值，op 参数栏填的值能直接生效；
 *  - 产生任意字节的算法走 hex 对称契约：encode 输出 hex、decode 读 hex；
 *  - code 里不出现反引号（本文件用模板字符串作外层分隔，内容不含反引号）。
 */

export const EXTRA_PRESETS = [
  {
    id: "b58CustomTable",
    name: "Base58 自定义码表",
    code: `// Base58 换表：整段字节做 58 进制大数编码（CTF 常换表或去 0OIl）。
// params.table 覆盖默认（比特币表，恰好 58 字符）。输出纯 ASCII 文本。
const TABLE = params.table || "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
if (TABLE.length !== 58) throw new Error("Base58 表必须恰好 58 字符");
const REV = {};
for (let i = 0; i < 58; i++) REV[TABLE[i]] = i;
if (dir === "decode") {
  let s = String(input).trim();
  let lead = 0;
  while (lead < s.length && s[lead] === TABLE[0]) lead++;
  let num = [0];
  for (const ch of s) {
    const v = REV[ch];
    if (v == null) continue;
    let carry = v;
    for (let i = 0; i < num.length; i++) {
      carry += num[i] * 58;
      num[i] = carry & 0xff;
      carry = Math.floor(carry / 256);
    }
    while (carry) { num.push(carry & 0xff); carry = Math.floor(carry / 256); }
  }
  while (num.length > 1 && num[num.length - 1] === 0) num.pop();
  const out = new Uint8Array(lead + num.length);
  for (let i = 0; i < num.length; i++) out[lead + i] = num[num.length - 1 - i];
  return out;
}
let bytes = rawBytes || H.utf8Encode(input);
let lead = 0;
while (lead < bytes.length && bytes[lead] === 0) lead++;
let num = Array.from(bytes.slice(lead));
let out = "";
while (num.length) {
  let rem = 0;
  for (let i = 0; i < num.length; i++) {
    const cur = rem * 256 + num[i];
    num[i] = Math.floor(cur / 58);
    rem = cur % 58;
  }
  out = TABLE[rem] + out;
  while (num.length && num[0] === 0) num.shift();
}
return TABLE[0].repeat(lead) + out;`,
  },
  {
    id: "b85CustomTable",
    name: "Base85 自定义码表（Z85 表）",
    code: `// Base85 换表：整段字节做 85 进制大数编码（Z85 风格，85 字符表可换）。
// params.table 覆盖默认 Z85 表。输出纯 ASCII 文本，往返对称。
const TABLE = params.table || "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?&<>()[]{}@%$#";
if (TABLE.length !== 85) throw new Error("Base85 表必须恰好 85 字符");
const REV = {};
for (let i = 0; i < 85; i++) REV[TABLE[i]] = i;
if (dir === "decode") {
  let s = String(input).trim();
  let lead = 0;
  while (lead < s.length && s[lead] === TABLE[0]) lead++;
  let num = [0];
  for (const ch of s) {
    const v = REV[ch];
    if (v == null) continue;
    let carry = v;
    for (let i = 0; i < num.length; i++) {
      carry += num[i] * 85;
      num[i] = carry & 0xff;
      carry = Math.floor(carry / 256);
    }
    while (carry) { num.push(carry & 0xff); carry = Math.floor(carry / 256); }
  }
  while (num.length > 1 && num[num.length - 1] === 0) num.pop();
  const out = new Uint8Array(lead + num.length);
  for (let i = 0; i < num.length; i++) out[lead + i] = num[num.length - 1 - i];
  return out;
}
let bytes = rawBytes || H.utf8Encode(input);
let lead = 0;
while (lead < bytes.length && bytes[lead] === 0) lead++;
let num = Array.from(bytes.slice(lead));
let out = "";
while (num.length) {
  let rem = 0;
  for (let i = 0; i < num.length; i++) {
    const cur = rem * 256 + num[i];
    num[i] = Math.floor(cur / 85);
    rem = cur % 85;
  }
  out = TABLE[rem] + out;
  while (num.length && num[0] === 0) num.shift();
}
return TABLE[0].repeat(lead) + out;`,
  },
  {
    id: "b32ReverseBits",
    name: "Base32 位序反转",
    code: `// Base32 位序反转：每个字节先做 bit 逆序再 Base32 编码（CTF 常配合 0-5 码表）。
// params.table 可选码表（默认 0-9A-V）。往返对称：decode 再逆序回来。
const TABLE = params.table || "0123456789ABCDEFGHIJKLMNOPQRSTUV";
let bytes = dir === "decode" ? H.b32Decode(input, TABLE) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(bytes.length);
for (let i = 0; i < bytes.length; i++) out[i] = H.reverseBits(bytes[i]);
if (dir === "decode") return out;
return H.b32Encode(out, TABLE);`,
  },
  {
    id: "baseWidthBits",
    name: "Base 位流位宽魔改（6→5 bit）",
    code: `// Base 位流位宽魔改：默认 8bit→5bit（W=5），可调 W=4/6/7；码表长度须 = 2^W。
// W≤5 用内置 62 表，W≥6 自动取 ASCII 32..(31+2^W) 作码表（2^7=128 需 128 字符）。
// 也可 params.table 自定义；常用在「Base64 改 5 位」「Base32 改 6 位」魔改题。往返对称。
const W = Number(params.w ?? params.width ?? 5);
let TAB = params.table || "";
if (!TAB) {
  const need = Math.pow(2, W);
  if (need <= 62) TAB = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, need);
  else { const cs = []; for (let i = 0; i < need; i++) cs.push(String.fromCharCode(32 + i)); TAB = cs.join(""); }
}
if (TAB.length !== Math.pow(2, W) || new Set(TAB).size !== TAB.length) throw new Error("码表须为 2^W 个不重复字符");
const REV = {};
for (let i = 0; i < TAB.length; i++) REV[TAB[i]] = i;
if (dir === "decode") {
  let bits = "";
  for (const ch of String(input)) {
    const v = REV[ch];
    if (v == null) continue;
    bits += v.toString(2).padStart(W, "0");
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return H.utf8Decode(new Uint8Array(out));
}
let bits = H.toBits(rawBytes || H.utf8Encode(input));
let out = "";
for (let i = 0; i < bits.length; i += W) {
  const seg = bits.slice(i, i + W).padEnd(W, "0");
  out += TAB[parseInt(seg, 2)];
}
return out;`,
  },
  {
    id: "vigenereCustomAlpha",
    name: "维吉尼亚 自定义字母表",
    code: `// 维吉尼亚：自定义字母表 + 自定义 key（CTF 常把字母表换成 62/95 可见字符）。
// params.alphabet 字母表（默认 A-Za-z0-9 62 字符），params.key 密钥（默认 KEY）。
// key 中不在字母表里的字符会被忽略；往返对称。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const size = ALPHA.length;
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
let keyIdx = [];
for (const ch of String(params.key ?? "KEY")) {
  const i = idx.get(ch);
  if (i != null) keyIdx.push(i);
}
if (!keyIdx.length) keyIdx = [0];
let out = "", ki = 0;
for (const ch of input) {
  const i = idx.get(ch);
  if (i == null) { out += ch; continue; }
  const k = keyIdx[ki++ % keyIdx.length];
  const j = dir === "decode" ? (i - k % size + size) % size : (i + k) % size;
  out += ALPHA[j];
}
return out;`,
  },
  {
    id: "affineCustomMod",
    name: "仿射密码 任意 (a,b) 模数",
    code: `// 仿射密码：C = (a*P + b) mod m；m = 字母表长度，可任意。
// params.a / params.b（默认 5 / 8），params.alphabet 自定义字母表。
// a 必须与模数互质才有逆元，否则 decode 抛错提示换 a。往返对称。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const m = ALPHA.length;
const a = ((Number(params.a ?? 5) % m) + m) % m;
const b = ((Number(params.b ?? 8) % m) + m) % m;
const inv = (x, mod) => {
  x = ((x % mod) + mod) % mod;
  for (let t = 1; t < mod; t++) if ((x * t) % mod === 1) return t;
  return -1;
};
const ai = inv(a, m);
if (ai < 0) throw new Error("a 与模数不互质，换一个 a");
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
let out = "";
for (const ch of input) {
  const i = idx.get(ch);
  if (i == null) { out += ch; continue; }
  const j = dir === "decode" ? (ai * ((i - b + m) % m)) % m : (a * i + b) % m;
  out += ALPHA[j];
}
return out;`,
  },
  {
    id: "railFenceVar",
    name: "栅栏变体（W 型 / 顺序型）",
    code: `// 栅栏密码变体：mode=w（W 型之字）或 seq（顺序分栏）。params.rails 栏数（默认 3）。
const rails = Math.max(2, Number(params.rails ?? params.n ?? 3));
const seq = String(params.mode ?? "w").toLowerCase() === "seq";
const per = seq ? rails : 2 * (rails - 1);
const rowOf = (i) => seq ? i % rails : Math.min(i % per, per - (i % per));
if (dir === "decode") {
  const sizes = new Array(rails).fill(0);
  for (let i = 0; i < input.length; i++) sizes[rowOf(i)]++;
  let pos = 0, rows = [];
  for (let r = 0; r < rails; r++) { rows.push(input.slice(pos, pos + sizes[r]).split("")); pos += sizes[r]; }
  let out = "";
  for (let i = 0; i < input.length; i++) out += rows[rowOf(i)].shift();
  return out;
}
let rows = Array.from({ length: rails }, () => []);
for (let i = 0; i < input.length; i++) rows[rowOf(i)].push(input[i]);
return rows.map((r) => r.join("")).join("");`,
  },
  {
    id: "bacon5bit",
    name: "培根 5 位变体（A/B 换符）",
    code: `// 培根 5 位变体：每字母→5 位 A/B 组（A=0,B=1），可换符（params.aA / params.bB）。
// 只处理 A-Z；其余字符忽略（decode 也只读 A/B 组）。往返按 A-Z 子集比对。
const A_CH = String(params.aA ?? "A");
const B_CH = String(params.bB ?? "B");
const BACON = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const enc5 = (n) => {
  let s = "";
  for (let i = 4; i >= 0; i--) s += (n >> i) & 1 ? B_CH : A_CH;
  return s;
};
if (dir === "decode") {
  const rev = {};
  for (let i = 0; i < 26; i++) rev[enc5(i)] = BACON[i];
  let out = "", run = "";
  for (const ch of String(input)) {
    if (ch === A_CH || ch === B_CH) run += ch;
    else if (run.length) { out += rev[run] ?? ""; run = ""; }
    if (run.length === 5) { out += rev[run] ?? ""; run = ""; }
  }
  if (run.length) out += rev[run] ?? "";
  return out;
}
let out = "";
for (const ch of input.toUpperCase()) {
  const i = BACON.indexOf(ch);
  if (i >= 0) out += enc5(i);
}
return out;`,
  },
  {
    id: "keyboardShift",
    name: "键盘相邻位移",
    code: `// 键盘位移：每键沿 QWERTY 行左右移一位（首尾回绕），CTF 常见「键盘错位」题。
// params.dir 编码方向（l/r，默认右移；解码自动反向）。只处理小写字母，其余原样透传。
const ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const POS = {};
for (const row of ROWS) for (let i = 0; i < row.length; i++) POS[row[i]] = [row, i];
const baseD = String(params.dir ?? "r").toLowerCase() === "l" ? -1 : 1;
const d = dir === "decode" ? -baseD : baseD;
let out = "";
for (const ch of input) {
  const c = ch.toLowerCase();
  const hit = POS[c];
  if (!hit || ch !== c) { out += ch; continue; }
  const row = hit[0], i = hit[1];
  out += row[(i + d + row.length) % row.length];
}
return out;`,
  },
  {
    id: "polySubstitution",
    name: "多表代换（循环位移表）",
    code: `// 多表代换：多张凯撒表按位置循环使用，第 i 个可映射字符用第 (i % n) 张表。
// params.offsets 逗号分隔位移（默认 "3,5,7"），params.alphabet 字母表。往返对称。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const size = ALPHA.length;
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
const offs = String(params.offsets ?? "3,5,7").split(",").map((s) => Number(s.trim()) || 0);
let out = "", pos = 0;
for (const ch of input) {
  const i = idx.get(ch);
  if (i == null) { out += ch; continue; }
  const sh = ((offs[pos % offs.length] % size) + size) % size;
  const k = dir === "decode" ? (i - sh + size) % size : (i + sh) % size;
  out += ALPHA[k];
  pos++;
}
return out;`,
  },
  {
    id: "hillCipher2",
    name: "希尔密码 自定义矩阵",
    code: `// 希尔密码：2x2 矩阵乘列向量（mod 52，A-Za-z 大小写表，保留大小写）。
// params.a~d 矩阵元素（默认 [3,3;2,5]，det=9 与 52 互质可逆）。
// 按连续字母段成对加密，段内奇数个时末字母原样透传；非字母原样透传。往返对称。
const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MOD = ALPHA.length;
const M = [Number(params.a ?? 3), Number(params.b ?? 3), Number(params.c ?? 2), Number(params.d ?? 5)];
let det = ((M[0] * M[3] - M[1] * M[2]) % MOD + MOD) % MOD;
let di = -1;
for (let t = 1; t < MOD; t++) if ((det * t) % MOD === 1) { di = t; break; }
if (di < 0) throw new Error("矩阵行列式与 52 不互质，无法求逆");
const IM = [((M[3] * di) % MOD + MOD) % MOD, (((-M[1]) % MOD) * di % MOD + MOD) % MOD, (((-M[2]) % MOD) * di % MOD + MOD) % MOD, ((M[0] * di) % MOD + MOD) % MOD];
const K = dir === "decode" ? IM : M;
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
let out = "", pair = [];
for (const ch of input) {
  const v = idx.get(ch);
  if (v == null) { if (pair.length) { out += ALPHA[pair[0]]; pair = []; } out += ch; continue; }
  pair.push(v);
  if (pair.length === 2) {
    const x = (K[0] * pair[0] + K[1] * pair[1]) % MOD;
    const y = (K[2] * pair[0] + K[3] * pair[1]) % MOD;
    out += ALPHA[x] + ALPHA[y];
    pair = [];
  }
}
if (pair.length) out += ALPHA[pair[0]];
return out;`,
  },
  {
    id: "rc4Drop",
    name: "RC4 丢弃前 N 字节",
    code: `// RC4 流密码 + drop：密钥流先丢弃前 N 字节再异或（CTF 的 RC4-drop 魔改）。
// params.key 密钥（默认 "key"），params.drop 丢弃数（默认 0）。encode 输出 hex、decode 读 hex。
const KEY = H.strToBytes(params.key || params.k || "key");
const drop = Number(params.drop ?? params.n ?? 0);
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
let S = [];
for (let i = 0; i < 256; i++) S.push(i);
let j = 0;
for (let i = 0; i < 256; i++) {
  j = (j + S[i] + KEY[i % KEY.length]) & 0xff;
  const t = S[i]; S[i] = S[j]; S[j] = t;
}
let i = 0; j = 0; let k = 0;
const out = new Uint8Array(data.length);
for (let n = 0; n < data.length; n++) {
  i = (i + 1) & 0xff;
  j = (j + S[i]) & 0xff;
  const t = S[i]; S[i] = S[j]; S[j] = t;
  const ks = S[(S[i] + S[j]) & 0xff];
  out[n] = k >= drop ? data[n] ^ ks : data[n];
  k++;
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "teaRounds",
    name: "TEA 分组密码 轮数可调",
    code: `// TEA 分组密码：轮数可调（默认 32），CTF 常改轮数/改 delta/改 key。
// params.key 密钥（默认 "CTF-TEA!"），params.rounds 轮数，params.delta 常数。
// 8 字节分组；明文前 4 字节记录原长，回读时据此截断。encode 输出 hex、decode 读 hex。
const KEY = H.strToBytes(params.key || params.k || "CTF-TEA!");
const k = [0, 0, 0, 0];
for (let i = 0; i < 4; i++) k[i] = ((KEY[4 * i] || 0) << 24 | (KEY[4 * i + 1] || 0) << 16 | (KEY[4 * i + 2] || 0) << 8 | (KEY[4 * i + 3] || 0)) >>> 0;
const rounds = Math.max(1, Number(params.rounds ?? params.n ?? 32));
const DELTA = (Number(params.delta) || 0x9e3779b9) >>> 0;
const raw = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const body = dir === "decode" ? raw : new Uint8Array(raw.length + 4);
if (dir === "encode") {
  body[0] = (raw.length >>> 24) & 0xff; body[1] = (raw.length >>> 16) & 0xff;
  body[2] = (raw.length >>> 8) & 0xff; body[3] = raw.length & 0xff;
  body.set(raw, 4);
}
const pad = body.length % 8 ? 8 - body.length % 8 : 0;
const buf = new Uint8Array(body.length + pad);
buf.set(body);
const out = new Uint8Array(buf.length);
for (let off = 0; off < buf.length; off += 8) {
  let v0 = (buf[off] << 24 | buf[off + 1] << 16 | buf[off + 2] << 8 | buf[off + 3]) >>> 0;
  let v1 = (buf[off + 4] << 24 | buf[off + 5] << 16 | buf[off + 6] << 8 | buf[off + 7]) >>> 0;
  if (dir === "decode") {
    let sum = (DELTA * rounds) >>> 0;
    for (let r = 0; r < rounds; r++) {
      v1 = (v1 - ((((v0 << 4) + k[2]) ^ (v0 + sum)) ^ (((v0 >>> 5) + k[3])))) >>> 0;
      v0 = (v0 - ((((v1 << 4) + k[0]) ^ (v1 + sum)) ^ (((v1 >>> 5) + k[1])))) >>> 0;
      sum = (sum - DELTA) >>> 0;
    }
  } else {
    let sum = 0;
    for (let r = 0; r < rounds; r++) {
      sum = (sum + DELTA) >>> 0;
      v0 = (v0 + ((((v1 << 4) + k[0]) ^ (v1 + sum)) ^ (((v1 >>> 5) + k[1])))) >>> 0;
      v1 = (v1 + ((((v0 << 4) + k[2]) ^ (v0 + sum)) ^ (((v0 >>> 5) + k[3])))) >>> 0;
    }
  }
  for (let b = 0; b < 4; b++) {
    out[off + b] = (v0 >>> (24 - 8 * b)) & 0xff;
    out[off + 4 + b] = (v1 >>> (24 - 8 * b)) & 0xff;
  }
}
if (dir === "decode") {
  const len = ((out[0] || 0) << 24 | (out[1] || 0) << 16 | (out[2] || 0) << 8 | (out[3] || 0)) >>> 0;
  return out.slice(4, 4 + len);
}
return H.hexEncode(out);`,
  },
  {
    id: "xxteaRounds",
    name: "XXTEA 分组密码 轮数可调",
    code: `// XXTEA 分组密码：块长 8 字节起、轮数可调（默认 6+52/n），CTF 常改轮数/改 key。
// params.key 密钥（默认 "CTFXXTEA"），params.rounds 覆盖默认轮数。
// 8 字节对齐补 0；明文前 4 字节记录原长，回读时据此截断。encode 输出 hex、decode 读 hex。
const KEY = H.strToBytes(params.key || params.k || "CTFXXTEA");
const k = [0, 0, 0, 0];
for (let i = 0; i < 4; i++) k[i] = ((KEY[4 * i] || 0) << 24 | (KEY[4 * i + 1] || 0) << 16 | (KEY[4 * i + 2] || 0) << 8 | (KEY[4 * i + 3] || 0)) >>> 0;
const raw = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const body = dir === "decode" ? raw : new Uint8Array(raw.length + 4);
if (dir === "encode") {
  body[0] = (raw.length >>> 24) & 0xff; body[1] = (raw.length >>> 16) & 0xff;
  body[2] = (raw.length >>> 8) & 0xff; body[3] = raw.length & 0xff;
  body.set(raw, 4);
}
const pad = body.length % 8 ? 8 - body.length % 8 : 0;
const v = [];
for (let i = 0; i < body.length + pad; i += 4) {
  v.push(((body[i] || 0) << 24 | (body[i + 1] || 0) << 16 | (body[i + 2] || 0) << 8 | (body[i + 3] || 0)) >>> 0);
}
const n = v.length;
const DELTA = 0x9e3779b9;
let q = Number(params.rounds);
if (!q || q <= 0) q = Math.floor(6 + 52 / n);
const mx = (sum, y, z, p, e) => ((z >>> 5 ^ y << 2) + (y >>> 3 ^ z << 4)) ^ ((sum ^ y) + (k[(p & 3) ^ e] ^ z));
if (dir === "decode") {
  let sum = q * DELTA, y = v[0], e, p;
  while (sum !== 0) {
    e = (sum >>> 2) & 3;
    for (p = n - 1; p > 0; p--) { const z = v[p - 1]; y = (v[p] -= mx(sum, y, z, p, e)); }
    const z = v[n - 1];
    y = (v[0] -= mx(sum, y, z, 0, e));
    sum -= DELTA;
  }
} else {
  let sum = 0, z = v[n - 1], e, p;
  for (let r = 0; r < q; r++) {
    sum += DELTA;
    e = (sum >>> 2) & 3;
    for (p = 0; p < n - 1; p++) { const y = v[p + 1]; z = (v[p] += mx(sum, y, z, p, e)); }
    const y = v[0];
    z = (v[n - 1] += mx(sum, y, z, n - 1, e));
  }
}
const out = new Uint8Array(v.length * 4);
for (let i = 0; i < v.length; i++) {
  out[4 * i] = (v[i] >>> 24) & 0xff;
  out[4 * i + 1] = (v[i] >>> 16) & 0xff;
  out[4 * i + 2] = (v[i] >>> 8) & 0xff;
  out[4 * i + 3] = v[i] & 0xff;
}
if (dir === "decode") {
  const len = ((out[0] || 0) << 24 | (out[1] || 0) << 16 | (out[2] || 0) << 8 | (out[3] || 0)) >>> 0;
  return out.slice(4, 4 + len);
}
return H.hexEncode(out);`,
  },
  {
    id: "lfsrCustom",
    name: "LFSR 自定义抽头密钥流",
    code: `// LFSR 密钥流：自定义抽头（位掩码）与种子产出伪随机字节流异或。
// params.taps 抽头掩码（默认 0x1d），params.seed 种子（默认 1），params.bits 位宽（默认 32）。
// 自同步往返；encode 输出 hex、decode 读 hex。
const BITS = Number(params.bits ?? 32);
const MASK = BITS >= 32 ? 0xffffffff : ((1 << BITS) - 1);
const taps = (Number(params.taps ?? 0x1d) & MASK) | 1;
let state = Number(params.seed ?? 1) & MASK;
if (!state) state = 1;
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const nextBit = () => {
  let fb = 0;
  for (let b = 0; b < BITS; b++) if ((taps >>> b) & 1) fb ^= (state >>> b) & 1;
  state = ((state << 1) | fb) & MASK;
  return fb;
};
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) {
  let ks = 0;
  for (let bit = 0; bit < 8; bit++) ks = (ks << 1) | nextBit();
  out[i] = data[i] ^ ks;
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "crcStream",
    name: "CRC32 密钥流（key+计数器）",
    code: `// CRC32 密钥流：以 (key || 计数器) 的 CRC32 作伪随机字节异或，CTF 常见「CRC 当 key 流」。
// params.key 任意文本（默认 "crc"）。自同步往返；encode 输出 hex、decode 读 hex。
const KEY = H.strToBytes(params.key || params.k || "crc");
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) {
  const ctr = new Uint8Array(KEY.length + 4);
  ctr.set(KEY);
  ctr[KEY.length] = (i >>> 24) & 0xff;
  ctr[KEY.length + 1] = (i >>> 16) & 0xff;
  ctr[KEY.length + 2] = (i >>> 8) & 0xff;
  ctr[KEY.length + 3] = i & 0xff;
  out[i] = data[i] ^ (H.crc32(ctr) & 0xff);
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "posAddShift",
    name: "位置相关加法（第 i 字节 +i）",
    code: `// 位置相关加法：第 i 字节加 i（可调步长），CTF 常见逐字节位移的自制加密。
// params.step 步长（默认 1）。往返对称；encode 输出 hex、decode 读 hex。
const step = Number(params.step ?? 1);
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) {
  const d = (i * step) & 0xff;
  out[i] = dir === "decode" ? (data[i] - d + 256) & 0xff : (data[i] + d) & 0xff;
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "byteReorder",
    name: "字节序翻转 + 分组重排",
    code: `// 字节序翻转 + 分组重排：先组内字节倒序，再把完整组的顺序反转（残余组不动）。
// params.grp 组大小（默认 4），params.rev 为假时跳过组序反转。往返对称；encode 输出 hex。
const grp = Math.max(1, Number(params.grp ?? 4));
const rev = params.rev !== false;
let bytes = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
let out = new Uint8Array(bytes.length);
for (let i = 0; i < bytes.length; i += grp) {
  const end = Math.min(i + grp, bytes.length);
  for (let k = 0; k < end - i; k++) out[i + k] = bytes[end - 1 - k];
}
if (rev && grp > 1) {
  const full = Math.floor(out.length / grp);
  const tail = out.slice(full * grp);
  const groups = [];
  for (let i = 0; i < full; i++) groups.push(out.slice(i * grp, (i + 1) * grp));
  groups.reverse();
  const tmp = new Uint8Array(out.length);
  let pos = 0;
  for (const g of groups) { tmp.set(g, pos); pos += g.length; }
  tmp.set(tail, pos);
  out = tmp;
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "hexDecMixed",
    name: "自定义分隔符 hex/dec 混合编码",
    code: `// hex/dec 混合编码：字节流交替输出 hex 与十进制，自定义分隔符连接。
// params.sep 分隔符（默认空格）。往返对称：decode 按位置奇偶判断基数。
const sep = params.sep ?? " ";
let bytes = rawBytes || H.utf8Encode(input);
if (dir === "decode") {
  const toks = String(input).split(sep).filter((t) => t !== "");
  const out = new Uint8Array(toks.length);
  for (let i = 0; i < toks.length; i++) out[i] = parseInt(toks[i], i % 2 === 0 ? 16 : 10);
  return out;
}
const parts = [];
for (let i = 0; i < bytes.length; i++) {
  parts.push(i % 2 === 0 ? bytes[i].toString(16).padStart(2, "0") : String(bytes[i]));
}
return parts.join(sep);`,
  },
  {
    id: "rot47All",
    name: "ROT47 全可见 ASCII",
    code: `// ROT47：ASCII 33~126 整段循环位移 47 位（CTF 高频，含数字标点）。
// params.shift 可调位移（默认 47）。往返对称。
const shift = ((Number(params.shift ?? 47) % 94) + 94) % 94;
let out = "";
for (const ch of input) {
  const c = ch.charCodeAt(0);
  if (c >= 33 && c <= 126) out += String.fromCharCode(33 + ((c - 33 + (dir === "decode" ? -shift : shift) + 94) % 94));
  else out += ch;
}
return out;`,
  },
  {
    id: "atbashCustom",
    name: "Atbash 自定义字母表",
    code: `// Atbash / 字母表倒序：把字母表整个反转后一一对应替换（CTF 常见字母反转题）。
// params.alphabet 自定义字母表（默认 A-Za-z0-9）。往返对称（反转两次复原）。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const REV = ALPHA.split("").reverse().join("");
const map = new Map([...ALPHA].map((c, i) => [c, REV[i]]));
let out = "";
for (const ch of input) out += map.get(ch) ?? ch;
return out;`,
  },
  {
    id: "blockPermute",
    name: "分组位置置换（自定义 perm）",
    code: `// 分组位置置换：每 blk 字节一组按 params.perm 重排（如 perm="2,0,1,3"）。
// 默认 blk=4；perm 非法时退化为逆序。decode 用逆置换；encode 输出 hex、decode 读 hex。
const blk = Math.max(2, Number(params.blk ?? 4));
let perm = String(params.perm ?? "").split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n));
if (perm.length !== blk || new Set(perm).size !== blk || perm.some((n) => n < 0 || n >= blk)) {
  perm = Array.from({ length: blk }, (_, i) => blk - 1 - i);
}
const inv = new Array(blk);
for (let i = 0; i < blk; i++) inv[perm[i]] = i;
const P = dir === "decode" ? inv : perm;
const bytes = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(bytes.length);
for (let i = 0; i < bytes.length; i += blk) {
  const end = Math.min(i + blk, bytes.length);
  if (end - i < blk) { for (let k = i; k < end; k++) out[k] = bytes[k]; continue; }
  for (let k = 0; k < end - i; k++) out[i + k] = bytes[i + P[k]];
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
  {
    id: "autokeyVigenere",
    name: "自动密钥维吉尼亚",
    code: `// 自动密钥维吉尼亚：明文参与 key 扩展（autokey），只需一个种子字母。
// params.key 种子（默认 "K"），params.alphabet 字母表（默认 A-Za-z0-9）。往返对称。
const ALPHA = params.alphabet || params.table || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const size = ALPHA.length;
const idx = new Map([...ALPHA].map((c, i) => [c, i]));
const seed = String(params.key ?? "K");
let keyStream = [];
for (const ch of seed) {
  const i = idx.get(ch);
  if (i != null) keyStream.push(i);
}
if (!keyStream.length) keyStream = [0];
let out = "";
for (let n = 0; n < input.length; n++) {
  const ch = input[n];
  const i = idx.get(ch);
  if (i == null) { out += ch; continue; }
  let k;
  if (n < keyStream.length) k = keyStream[n];
  else {
    const p = dir === "encode" ? input[n - keyStream.length] : out[n - keyStream.length];
    k = p != null ? (idx.get(p) ?? 0) : 0;
  }
  out += ALPHA[(dir === "encode" ? i + k : i - k + size) % size];
}
return out;`,
  },
  {
    id: "xorMultiKey",
    name: "XOR 多段 key 交替",
    code: `// XOR 多段 key 交替：多段密钥轮流异或（CTF 常见多 key 交替 XOR）。
// params.keys 逗号分隔（默认 "k1,k2"）。encode 输出 hex、decode 读 hex。
const keys = String(params.keys ?? "k1,k2").split(",").map((s) => H.strToBytes(s.trim()));
const data = dir === "decode" ? H.hexDecode(input) : (rawBytes || H.utf8Encode(input));
const out = new Uint8Array(data.length);
for (let i = 0; i < data.length; i++) {
  let v = data[i];
  for (const k of keys) v ^= k[i % k.length];
  out[i] = v & 0xff;
}
return dir === "decode" ? out : H.hexEncode(out);`,
  },
];

export default EXTRA_PRESETS;
