/*
 * whirlpool.js — Whirlpool 哈希（cat:'hash'，run 型）。
 *
 * Barreto & Rijmen 设计，ISO/IEC 10118-3:2004 标准哈希，输出 512 位。
 * 结构 = Miyaguchi-Preneel 模式 + 一个 AES 风格的 512 位分组密码 W：
 *   H_i = W_{H_{i-1}}(m_i) XOR m_i XOR H_{i-1}
 *
 * 内部状态 = 8x8 字节矩阵（行主序 Uint8Array(64)，下标 i*8+j）。10 轮，每轮
 *   ρ[k] = σ[k] ∘ θ ∘ π ∘ γ：
 *   γ  SubBytes   逐字节过 S 盒
 *   π  ShiftColumns  第 j 列向下循环移 j 行
 *   θ  MixRows    每行右乘循环矩阵 cir(1,1,4,1,8,5,2,9)，GF(2^8) 模 0x11D
 *   σ  AddRoundKey  与轮密钥异或
 * 密钥编排：K^0 = H，K^r = ρ[c^r](K^{r-1})；轮常量 c^r 仅第 0 行非零，
 *   c^r[0][j] = S[8(r-1)+j]，其余为 0。
 *
 * S 盒不硬抄表，按规范用三个 4 位 mini-box 递归生成（可自证）：
 *   E = {1,B,9,C,D,6,F,3,E,8,7,4,A,2,5,0}（及其逆 E^-1）
 *   R = {7,C,B,D,E,4,9,F,6,3,8,A,2,5,1,0}
 *   高低半字节各过 E / E^-1 → 取 R 混淆量 r → 再各过 E / E^-1。
 *
 * 填充：追加 0x80，补 0 至长度 ≡ 32 (mod 64)，再接 256 位大端比特长度。
 *
 * 载入自检：① S 盒必须是 0..255 的合法置换 ② 空串与 "abc" 的摘要必须等于
 *   ISO 官方向量（与本机 python hashlib.whirlpool / openssl -provider legacy
 *   逐条比对过 8 条向量：空串/a/abc/message digest/a..z/A..Za..z0..9/
 *   quick brown fox/一百万个 a）。不过则 throw，绝不上线错误的密码学。
 *
 * 红线：算法照 ISO/IEC 10118-3 规范；纯本地零外发；core 层零 UI 依赖。
 *
 * 契约：register({ id:"whirlpool", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

/* ---------- S 盒：由 4 位 mini-box 生成 ---------- */

const MINI_E = [0x1, 0xb, 0x9, 0xc, 0xd, 0x6, 0xf, 0x3, 0xe, 0x8, 0x7, 0x4, 0xa, 0x2, 0x5, 0x0];
const MINI_R = [0x7, 0xc, 0xb, 0xd, 0xe, 0x4, 0x9, 0xf, 0x6, 0x3, 0x8, 0xa, 0x2, 0x5, 0x1, 0x0];
const MINI_EINV = new Array(16);
for (let i = 0; i < 16; i++) MINI_EINV[MINI_E[i]] = i;

const SBOX = new Uint8Array(256);
for (let x = 0; x < 256; x++) {
  const uh = MINI_E[x >>> 4];
  const ul = MINI_EINV[x & 0x0f];
  const r = MINI_R[uh ^ ul];
  SBOX[x] = (MINI_E[uh ^ r] << 4) | MINI_EINV[ul ^ r];
}

/* ---------- GF(2^8) 乘法表（模 x^8+x^4+x^3+x^2+1 = 0x11D） ---------- */

function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    b >>>= 1;
    a <<= 1;
    if (a & 0x100) a ^= 0x11d;
  }
  return p & 0xff;
}

// 循环矩阵首行 c，C[k][j] = c[(j-k) mod 8]
const CIRC = [1, 1, 4, 1, 8, 5, 2, 9];
// MUL[k][x] = x ⊗ CIRC[k]，避免每字节做位运算循环
const MUL = CIRC.map((c) => {
  const t = new Uint8Array(256);
  for (let x = 0; x < 256; x++) t[x] = gmul(x, c);
  return t;
});

/* ---------- 轮函数 ρ[key] = σ[key] ∘ θ ∘ π ∘ γ ---------- */

// γ 是逐字节的、π 是纯置换，两者可合并成一次寻址
function roundFn(st, key, out, tmp) {
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      // π: 第 j 列下移 j 行 → 取源行 (i-j) mod 8；同时套 γ
      tmp[i * 8 + j] = SBOX[st[((((i - j) % 8) + 8) % 8) * 8 + j]];
    }
  }
  for (let i = 0; i < 8; i++) {
    const row = i * 8;
    for (let j = 0; j < 8; j++) {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        // θ: b[i][j] = XOR_k a[i][k] ⊗ c[(j-k) mod 8]
        v ^= MUL[((((j - k) % 8) + 8) % 8)][tmp[row + k]];
      }
      out[row + j] = v ^ key[row + j]; // σ
    }
  }
}

/* ---------- 压缩函数（Miyaguchi-Preneel） ---------- */

const ROUNDS = 10;

function compress(H, block) {
  const K = H.slice();
  const Knext = new Uint8Array(64);
  const st = new Uint8Array(64);
  const stNext = new Uint8Array(64);
  const rc = new Uint8Array(64);
  const tmp = new Uint8Array(64);

  for (let i = 0; i < 64; i++) st[i] = block[i] ^ K[i]; // σ[K^0]

  for (let r = 1; r <= ROUNDS; r++) {
    // 轮常量：仅第 0 行取 S[8(r-1)+j]，其余行恒 0
    for (let j = 0; j < 8; j++) rc[j] = SBOX[8 * (r - 1) + j];

    roundFn(K, rc, Knext, tmp);
    K.set(Knext);

    roundFn(st, K, stNext, tmp);
    st.set(stNext);
  }

  // H_i = W(m) XOR m XOR H_{i-1}
  for (let i = 0; i < 64; i++) H[i] ^= st[i] ^ block[i];
}

/* ---------- 对外：字节数组 → 64 字节摘要 ---------- */

/**
 * Whirlpool 摘要。
 * @param {Uint8Array} data 消息字节
 * @returns {Uint8Array} 64 字节摘要
 */
export function whirlpool(data) {
  const H = new Uint8Array(64);
  const n = data.length;

  // 完整块
  let off = 0;
  const block = new Uint8Array(64);
  for (; off + 64 <= n; off += 64) {
    block.set(data.subarray(off, off + 64));
    compress(H, block);
  }

  // 填充：0x80 + 0 至 ≡32(mod 64) + 256 位大端比特长度
  const rest = n - off;
  const padLen = rest < 32 ? 32 - rest : 96 - rest; // 追加区（含 0x80 与 0）长度
  const tail = new Uint8Array(rest + padLen + 32);
  tail.set(data.subarray(off), 0);
  tail[rest] = 0x80;

  let bits = BigInt(n) * 8n;
  for (let i = tail.length - 1; i >= tail.length - 32; i--) {
    tail[i] = Number(bits & 0xffn);
    bits >>= 8n;
  }

  for (let i = 0; i < tail.length; i += 64) {
    block.set(tail.subarray(i, i + 64));
    compress(H, block);
  }
  return H;
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(s) {
  const clean = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Whirlpool 十六进制摘要（小写）。 */
export function whirlpoolHex(data) {
  return bytesToHex(whirlpool(data));
}

/* ---------- 载入自检：S 盒置换 + ISO 官方向量 ---------- */

(() => {
  const seen = new Uint8Array(256);
  for (const v of SBOX) seen[v]++;
  for (let i = 0; i < 256; i++) {
    if (seen[i] !== 1) throw new Error(`Whirlpool S 盒非合法置换（值 ${i} 出现 ${seen[i]} 次）`);
  }
  const enc = new TextEncoder();
  const VECTORS = [
    ["", "19fa61d75522a4669b44e39c1d2e1726c530232130d407f89afee0964997f7a73e83be698b288febcf88e3e03c4f0757ea8964e59b63d93708b138cc42a66eb3"],
    ["abc", "4e2448a4c6f486bb16b6562c73b4020bf3043e3a731bce721ae1b303d97e6d4c7181eebdb6c57e277d0e34957114cbd6c797fc9d95d8b582d225292076d4eef5"],
  ];
  for (const [msg, want] of VECTORS) {
    const got = whirlpoolHex(enc.encode(msg));
    if (got !== want) throw new Error(`Whirlpool 向量自检失败（输入 "${msg}"）：得到 ${got}`);
  }
})();

/* ---------- 注册 ---------- */

function whirlpoolRun(text, p = {}) {
  const inputMode = (p && p.inputMode) || "text";
  const input = inputMode === "hex"
    ? hexToBytes(text)
    : new TextEncoder().encode(String(text || ""));

  const digest = whirlpoolHex(input);
  const lines = [];
  lines.push("=== Whirlpool (512 位) ===");
  lines.push(`输入: ${input.length} 字节（${inputMode === "hex" ? "Hex" : "文本 UTF-8"}）`);
  lines.push("");
  lines.push("摘要 (hex):");
  lines.push(digest);
  lines.push("");
  lines.push(`大写: ${digest.toUpperCase()}`);
  return lines.join("\n");
}

register({
  id: "whirlpool",
  cat: "hash",
  name: "Whirlpool",
  desc: "Whirlpool 哈希（Barreto & Rijmen，ISO/IEC 10118-3:2004）：512 位输出，Miyaguchi-Preneel 模式套 AES 风格 512 位分组密码，8x8 字节状态 10 轮。S 盒按规范用 4 位 mini-box 生成，载入时跑官方向量自检。",
  params: [
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本 (UTF-8)" },
        { value: "hex", label: "Hex" },
      ],
    },
  ],
  run: whirlpoolRun,
});
