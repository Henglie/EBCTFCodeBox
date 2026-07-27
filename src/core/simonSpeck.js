/*
 * simonSpeck.js — NSA Simon & Speck 轻量级分组密码（cat:'modern'）。
 *
 * 覆盖：合并为 1 个 op `simonSpeck`，用 param 选算法（Simon / Speck）+ 分组/密钥尺寸。
 * Simon —— AND-rotate（Feistel）结构，硬件友好。
 * Speck —— ARX（加/旋/异或）结构，软件友好。
 *
 * 红线：
 * - 只新建 simonSpeck.js，不碰任何现有 core/*.js；算法层零 UI/DOM/i18n 依赖。
 * - 算法照 NSA 官方论文《The SIMON and SPECK Families of Lightweight Block Ciphers》
 * （Beaulieu 等，2013/2015，附录 C 测试向量），不编造。交付前用官方向量验证。
 * - 零外发：纯本地 BigInt 计算。
 * - >32 位字（n=48/64）JS 原生 32 位位运算会溢出，全程用 BigInt 处理。
 *
 * 编码约定（CTF 友好，直接对齐论文写法去空格）：
 * - 明文/密文/密钥均为 hex；字按“高位字在前”（论文自左向右）排列，字内 big-endian。
 * - 明文块 = (x, y) 两个 n 位字，x 为高位字（先出现）。
 * - 密钥 = m 个 n 位字，自左向右为 论文的 l_{m-2}..l_0,k_0（Speck）/ k_{m-1}..k_0（Simon）。
 * - encode: 明文 hex → 密文 hex（加密）；decode: 密文 hex → 明文 hex（解密）。ECB，可多块。
 *
 * 契约：register({id:"simonSpeck", cat:"modern", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

// ============================================================
// 变体表（block/keybits → 字长 n、密钥字数 m、轮数、Simon 的 z 序列下标）
// block = 2n，keybits = m*n。Simon/Speck 共享同一组尺寸，轮数各不相同。
// ============================================================
const VARIANTS = {
 // n(字长) m(密钥字) simonT speckT z(仅 Simon 用)
  "32/64":  { n: 16, m: 4, simonT: 32, speckT: 22, z: 0 },
  "48/72":  { n: 24, m: 3, simonT: 36, speckT: 22, z: 0 },
  "48/96":  { n: 24, m: 4, simonT: 36, speckT: 23, z: 1 },
  "64/96":  { n: 32, m: 3, simonT: 42, speckT: 26, z: 2 },
  "64/128": { n: 32, m: 4, simonT: 44, speckT: 27, z: 3 },
  "96/96":  { n: 48, m: 2, simonT: 52, speckT: 28, z: 2 },
  "96/144": { n: 48, m: 3, simonT: 54, speckT: 29, z: 3 },
  "128/128":{ n: 64, m: 2, simonT: 68, speckT: 32, z: 2 },
  "128/192":{ n: 64, m: 3, simonT: 69, speckT: 33, z: 3 },
  "128/256":{ n: 64, m: 4, simonT: 72, speckT: 34, z: 4 },
};

// Simon 密钥调度用的 5 条 62 位常数序列（照论文 §4.3，(z_j)_0 为最左字符）。
const Z = [
  "11111010001001010110000111001101111101000100101011000011100110",
  "10001110111110010011000010110101000111011111001001100001011010",
  "10101111011100000011010010011000101000010001111110010110110011",
  "11011011101011000110010111100000010010001010011100110100001111",
  "11010001111001101011011000100000010111000011001010010011101111",
];

// ============================================================
// BigInt 位运算工具（全程 n 位模运算）
// ============================================================
function maskOf(n) { return (1n << BigInt(n)) - 1n; }

// 循环左移 r 位（n 位字内）
function rol(x, r, n) {
  const R = BigInt(r), N = BigInt(n), M = maskOf(n);
  return ((x << R) | (x >> (N - R))) & M;
}
// 循环右移 r 位（n 位字内）
function ror(x, r, n) {
  const R = BigInt(r), N = BigInt(n), M = maskOf(n);
  return ((x >> R) | (x << (N - R))) & M;
}

// ============================================================
// Speck（ARX）
// 加密轮（轮密钥 k）：
// x = (ROR(x, α) + y) mod 2^n XOR k
// y = ROL(y, β) XOR x
// 旋转常数：n==16 时 α=7,β=2；否则 α=8,β=3。
// ============================================================
function speckEncRound(x, y, k, n, a, b) {
  const M = maskOf(n);
  x = ((ror(x, a, n) + y) & M) ^ k;
  y = rol(y, b, n) ^ x;
  return [x, y];
}
// 解密轮（加密轮的逆）：
// y = ROR(y XOR x, β)
// x = ROL(((x XOR k) - y) mod 2^n, α)
function speckDecRound(x, y, k, n, a, b) {
  const M = maskOf(n);
  y = ror(y ^ x, b, n);
  x = rol(((x ^ k) - y) & M, a, n); // BigInt 减法配 & M 即为 mod 2^n（两补正确）
  return [x, y];
}
// Speck 密钥调度：keyWords 自左向右 = l_{m-2}..l_0,k_0
// l_{i+m-1} = (k_i + ROR(l_i, α)) XOR i
// k_{i+1} = ROL(k_i, β) XOR l_{i+m-1} （i=0..T-2）
function speckKeySchedule(keyWords, n, m, T, a, b) {
  const M = maskOf(n);
  const k = new Array(T);
  const l = [];
  for (let j = 0; j < m - 1; j++) l[j] = keyWords[m - 2 - j]; // l[0]=最右侧 l 字
  k[0] = keyWords[m - 1];
  for (let i = 0; i < T - 1; i++) {
    l[i + m - 1] = ((k[i] + ror(l[i], a, n)) & M) ^ BigInt(i);
    k[i + 1] = rol(k[i], b, n) ^ l[i + m - 1];
  }
  return k;
}

// ============================================================
// Simon（AND-rotate Feistel）
// f(x) = (ROL(x,1) AND ROL(x,8)) XOR ROL(x,2)
// 加密轮（轮密钥 k）：x' = y XOR f(x) XOR k ; y' = x
// ============================================================
function simonF(x, n) {
  return (rol(x, 1, n) & rol(x, 8, n)) ^ rol(x, 2, n);
}
function simonEncRound(x, y, k, n) {
  const nx = y ^ simonF(x, n) ^ k;
  return [nx, x];
}
// 解密轮（逆）：给定 (x',y') → x = y' ; y = x' XOR f(y') XOR k
function simonDecRound(x, y, k, n) {
  const ny = x ^ simonF(y, n) ^ k;
  return [y, ny];
}
// Simon 密钥调度：keyWords 自左向右 = k_{m-1}..k_0（故 k[j]=keyWords[m-1-j]）
// tmp = ROR(k[i-1],3) ; if m==4: tmp ^= k[i-3]
// tmp ^= ROR(tmp,1)
// k[i] = k[i-m] XOR tmp XOR (z_j)_{i-m} XOR c , c = 2^n-4
// 注意：c = 2^n-4 = ~3（n 位），故本式等价于 (~k[i-m]) XOR tmp XOR z XOR 3。
// 两种写法二选一，不可混用（否则复原两次补码 → 错）。
function simonKeySchedule(keyWords, n, m, T, zIdx) {
  const c = maskOf(n) ^ 3n; // 2^n - 4
  const z = Z[zIdx];
  const k = new Array(T);
  for (let j = 0; j < m; j++) k[j] = keyWords[m - 1 - j];
  for (let i = m; i < T; i++) {
    let tmp = ror(k[i - 1], 3, n);
    if (m === 4) tmp = tmp ^ k[i - 3];
    tmp = tmp ^ ror(tmp, 1, n);
    const zbit = BigInt(z.charCodeAt((i - m) % 62) - 48); // '0'->0 / '1'->1
    k[i] = k[i - m] ^ tmp ^ zbit ^ c;
  }
  return k;
}

// ============================================================
// hex 解析 / 拼装
// ============================================================
function cleanHex(s, what) {
  const t = String(s).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (t.length && !/^[0-9a-fA-F]+$/.test(t)) throw new Error(`${what} 含非法 hex 字符`);
  return t;
}
function wordToHex(x, len) {
  return x.toString(16).padStart(len, "0");
}

// ============================================================
// 核心：单向处理（decrypt=false 加密 / true 解密），hex 进 hex 出
// ============================================================
function crypt(text, p, decrypt) {
  const algo = (p && p.algo) === "simon" ? "simon" : "speck";
  const vname = (p && p.variant) || "64/128";
  const v = VARIANTS[vname];
  if (!v) throw new Error("未知 variant: " + vname);
  const { n, m } = v;
  const T = algo === "simon" ? v.simonT : v.speckT;
  const [a, b] = n === 16 ? [7, 2] : [8, 3]; // Speck 旋转常数

  const wordHex = n / 4;        // 每字 hex 字符数
  const blockHex = wordHex * 2; // 每块（2 字）hex 字符数
  const keyHexLen = wordHex * m;

 // 密钥
  const keyHex = cleanHex((p && p.key) || "", "密钥");
  if (keyHex.length !== keyHexLen) {
    throw new Error(`${algo} ${vname} 密钥须 ${keyHexLen} 个 hex 字符（${m}×${n} 位），实为 ${keyHex.length}`);
  }
  const keyWords = [];
  for (let i = 0; i < m; i++) keyWords.push(BigInt("0x" + keyHex.substr(i * wordHex, wordHex)));

  const rk = algo === "simon"
    ? simonKeySchedule(keyWords, n, m, T, v.z)
    : speckKeySchedule(keyWords, n, m, T, a, b);

 // 数据
  const dataHex = cleanHex(text || "", "数据");
  if (dataHex.length === 0) return "";
  if (dataHex.length % blockHex !== 0) {
    throw new Error(`数据须为块大小整数倍（每块 ${blockHex} 个 hex 字符 / ${n / 4} 字节），实为 ${dataHex.length}`);
  }

  let out = "";
  for (let off = 0; off < dataHex.length; off += blockHex) {
    let x = BigInt("0x" + dataHex.substr(off, wordHex));
    let y = BigInt("0x" + dataHex.substr(off + wordHex, wordHex));
    if (!decrypt) {
      for (let r = 0; r < T; r++) {
        [x, y] = algo === "simon"
          ? simonEncRound(x, y, rk[r], n)
          : speckEncRound(x, y, rk[r], n, a, b);
      }
    } else {
      for (let r = T - 1; r >= 0; r--) {
        [x, y] = algo === "simon"
          ? simonDecRound(x, y, rk[r], n)
          : speckDecRound(x, y, rk[r], n, a, b);
      }
    }
    out += wordToHex(x, wordHex) + wordToHex(y, wordHex);
  }
  return out;
}

// ============================================================
// 注册 op（合并 Simon/Speck 为一个，用 param 选算法 + 尺寸）
// ============================================================
register({
  id: "simonSpeck",
  cat: "modern",
  name: "Simon / Speck 轻量密码",
  desc: "NSA Simon（AND-rotate）与 Speck（ARX）轻量级分组密码，ECB 单/多块。明文密文密钥均 hex。encode 加密 / decode 解密。已过论文附录 C 官方测试向量。",
  params: [
    {
      key: "algo", label: "算法", type: "select", default: "speck",
      options: [
        { value: "speck", label: "Speck（ARX，软件友好）" },
        { value: "simon", label: "Simon（AND-rotate，硬件友好）" },
      ],
    },
    {
      key: "variant", label: "分组/密钥位", type: "select", default: "64/128",
      options: [
        { value: "32/64", label: "32/64" },
        { value: "48/72", label: "48/72" },
        { value: "48/96", label: "48/96" },
        { value: "64/96", label: "64/96" },
        { value: "64/128", label: "64/128" },
        { value: "96/96", label: "96/96" },
        { value: "96/144", label: "96/144" },
        { value: "128/128", label: "128/128" },
        { value: "128/192", label: "128/192" },
        { value: "128/256", label: "128/256" },
      ],
    },
    {
      key: "key", label: "密钥 (hex, 高位字在前)", type: "text",
      default: "1b1a1918131211100b0a090803020100",
      placeholder: "如 Speck64/128: 1b1a1918131211100b0a090803020100",
    },
  ],
  encode: (text, p) => crypt(text, p, false), // 加密
  decode: (text, p) => crypt(text, p, true),  // 解密
});

// ============================================================
// 导出（供测试 / M 归并引用）
// ============================================================
export {
  VARIANTS, rol, ror,
  speckEncRound, speckDecRound, speckKeySchedule,
  simonF, simonEncRound, simonDecRound, simonKeySchedule,
  crypt,
};
