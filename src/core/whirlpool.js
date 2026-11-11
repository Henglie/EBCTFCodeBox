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

const SBOX0 = Uint8Array.from([
  0x68,0xd0,0xeb,0x2b,0x48,0x9d,0x6a,0xe4,0xe3,0xa3,0x56,0x81,0x7d,0xf1,0x85,0x9e,
  0x2c,0x8e,0x78,0xca,0x17,0xa9,0x61,0xd5,0x5d,0x0b,0x8c,0x3c,0x77,0x51,0x22,0x42,
  0x3f,0x54,0x41,0x80,0xcc,0x86,0xb3,0x18,0x2e,0x57,0x06,0x62,0xf4,0x36,0xd1,0x6b,
  0x1b,0x65,0x75,0x10,0xda,0x49,0x26,0xf9,0xcb,0x66,0xe7,0xba,0xae,0x50,0x52,0xab,
  0x05,0xf0,0x0d,0x73,0x3b,0x04,0x20,0xfe,0xdd,0xf5,0xb4,0x5f,0x0a,0xb5,0xc0,0xa0,
  0x71,0xa5,0x2d,0x60,0x72,0x93,0x39,0x08,0x83,0x21,0x5c,0x87,0xb1,0xe0,0x00,0xc3,
  0x12,0x91,0x8a,0x02,0x1c,0xe6,0x45,0xc2,0xc4,0xfd,0xbf,0x44,0xa1,0x4c,0x33,0xc5,
  0x84,0x23,0x7c,0xb0,0x25,0x15,0x35,0x69,0xff,0x94,0x4d,0x70,0xa2,0xaf,0xcd,0xd6,
  0x6c,0xb7,0xf8,0x09,0xf3,0x67,0xa4,0xea,0xec,0xb6,0xd4,0xd2,0x14,0x1e,0xe1,0x24,
  0x38,0xc6,0xdb,0x4b,0x7a,0x3a,0xde,0x5e,0xdf,0x95,0xfc,0xaa,0xd7,0xce,0x07,0x0f,
  0x3d,0x58,0x9a,0x98,0x9c,0xf2,0xa7,0x11,0x7e,0x8b,0x43,0x03,0xe2,0xdc,0xe5,0xb2,
  0x4e,0xc7,0x6d,0xe9,0x27,0x40,0xd8,0x37,0x92,0x8f,0x01,0x1d,0x53,0x3e,0x59,0xc1,
  0x4f,0x32,0x16,0xfa,0x74,0xfb,0x63,0x9f,0x34,0x1a,0x2a,0x5a,0x8d,0xc9,0xcf,0xf6,
  0x90,0x28,0x88,0x9b,0x31,0x0e,0xbd,0x4a,0xe8,0x96,0xa6,0x0c,0xc8,0x79,0xbc,0xbe,
  0xef,0x6e,0x46,0x97,0x5b,0xed,0x19,0xd9,0xac,0x99,0xa8,0x29,0x64,0x1f,0xad,0x55,
  0x13,0xbb,0xf7,0x6f,0xb9,0x47,0x2f,0xee,0xb8,0x7b,0x89,0x30,0xd3,0x7f,0x76,0x82
]);
const CIRC0 = [1, 1, 3, 1, 5, 8, 9, 5];
function buildMul(circ) {
  return circ.map((c) => {
    const t = new Uint8Array(256);
    for (let x = 0; x < 256; x++) t[x] = gmul(x, c);
    return t;
  });
}
const MUL0 = buildMul(CIRC0);


/* ---------- 轮函数 ρ[key] = σ[key] ∘ θ ∘ π ∘ γ ---------- */

// γ 是逐字节的、π 是纯置换，两者可合并成一次寻址
function roundFn(st, key, out, tmp, sbox = SBOX, mul = MUL) {
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      // π: 第 j 列下移 j 行 → 取源行 (i-j) mod 8；同时套 γ
      tmp[i * 8 + j] = sbox[st[((((i - j) % 8) + 8) % 8) * 8 + j]];
    }
  }
  for (let i = 0; i < 8; i++) {
    const row = i * 8;
    for (let j = 0; j < 8; j++) {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        // θ: b[i][j] = XOR_k a[i][k] ⊗ c[(j-k) mod 8]
        v ^= mul[((((j - k) % 8) + 8) % 8)][tmp[row + k]];
      }
      out[row + j] = v ^ key[row + j]; // σ
    }
  }
}

/* ---------- 压缩函数（Miyaguchi-Preneel） ---------- */

const ROUNDS = 10;

function compress(H, block, opts = {}) {
  const sbox = opts.sbox || SBOX;
  const mul = opts.mul || MUL;
  const rounds = Math.max(1, Math.min(10, opts.rounds == null ? ROUNDS : opts.rounds));
  const K = H.slice();
  const Knext = new Uint8Array(64);
  const st = new Uint8Array(64);
  const stNext = new Uint8Array(64);
  const rc = new Uint8Array(64);
  const tmp = new Uint8Array(64);

  for (let i = 0; i < 64; i++) st[i] = block[i] ^ K[i]; // σ[K^0]

  for (let r = 1; r <= rounds; r++) {
    // 轮常量：仅第 0 行取 S[8(r-1)+j]，其余行恒 0
    for (let j = 0; j < 8; j++) rc[j] = sbox[8 * (r - 1) + j];

    roundFn(K, rc, Knext, tmp, sbox, mul);
    K.set(Knext);

    roundFn(st, K, stNext, tmp, sbox, mul);
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
export function whirlpool(data) { return whirlpoolVariant(data, {}); }

export function whirlpoolVariant(data, opts = {}) {
  const H = new Uint8Array(64);
  const n = data.length;

  // 完整块
  let off = 0;
  const block = new Uint8Array(64);
  for (; off + 64 <= n; off += 64) {
    block.set(data.subarray(off, off + 64));
    compress(H, block, opts);
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
    compress(H, block, opts);
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
  if (p && p.inputMode != null && String(p.inputMode).toLowerCase() !== "text") {
    throw new Error("inputMode 该参数已废弃，请改用输入视图");
  }
  const inputMode = "text";
  const raw = p && p.rawBytes;
  const input = raw != null
    ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw))
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

export function whirlpoolVariantHex(data, variant = "Whirlpool", rounds = 10) {
  const v = String(variant || "Whirlpool");
  let sbox = SBOX, mul = MUL;
  if (v === "Whirlpool-T") { sbox = SBOX; mul = MUL0; }
  else if (v === "Whirlpool-0") { sbox = SBOX0; mul = MUL0; }
  else if (v !== "Whirlpool") throw new Error("Whirlpool 变体仅支持 Whirlpool / Whirlpool-T / Whirlpool-0");
  const r = Math.max(1, Math.min(10, Number(rounds) || 10));
  return bytesToHex(whirlpoolVariant(data, { sbox, mul, rounds: r }));
}

register({
  id: "whirlpoolHash",
  cat: "hash",
  name: "Whirlpool（CC 变体/轮数）",
  desc: "Whirlpool-0 / Whirlpool-T / Whirlpool 三变体 + Rounds 1-10，输出小写 hex；参数与 CyberChef Whirlpool 对齐。",
  acceptsBytes: true,
  params: [
    { key: "variant", label: "变体", labelKey: "op.whirlpoolHash.param.variant", type: "select", default: "Whirlpool", options: ["Whirlpool", "Whirlpool-T", "Whirlpool-0"] },
    { key: "rounds", label: "轮数", labelKey: "op.whirlpoolHash.param.rounds", type: "number", default: 10 },
  ],
  run: (t, p = {}) => {
    const raw = p.rawBytes;
    const data = raw != null ? (raw instanceof Uint8Array ? raw : new Uint8Array(raw)) : new TextEncoder().encode(String(t == null ? "" : t));
    return whirlpoolVariantHex(data, p.variant || "Whirlpool", p.rounds == null ? 10 : p.rounds);
  },
});

register({
  id: "whirlpool",
  cat: "hash",
  name: "Whirlpool",
  desc: "Whirlpool 哈希（Barreto & Rijmen，ISO/IEC 10118-3:2004）：512 位输出，Miyaguchi-Preneel 模式套 AES 风格 512 位分组密码，8x8 字节状态 10 轮。S 盒按规范用 4 位 mini-box 生成，载入时跑官方向量自检。",
  params: [
  ],
  run: whirlpoolRun,
  acceptsBytes: true,
});
