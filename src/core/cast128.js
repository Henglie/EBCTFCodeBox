/*
 * cast128.js — CAST-128 分组密码（cat:'modern'）。
 *
 * RFC 2144（Adams 1997），64 位分组，40~128 位密钥（本实现 128 位）。
 * 16 轮 Feistel：轮 1,4,7,10,13,16 用 Type1 f、2,5,8,11,14 用 Type2、3,6,9,12,15 用 Type3。
 * 密钥扩展：x 16 字节 + z 中间字节，S5-S8 参与，跑 32 轮生成 K1..K32；
 * Kmi = Ki（i=1..16），Kri = K(16+i) 低 5 位。
 * 轮函数 I = (Km ∘ D) <<< Kr（∘ = +/^/- 按 Type），Ia..Id 为 I 的 4 字节，
 * f = ((S1[Ia]∘' S2[Ib])∘'' S3[Ic])∘''' S4[Id]（∘' = ^/-/+ 按 Type）。
 *
 * 验证：RFC 2144 附录 A 向量（key 0123456712345678234567893456789a →
 * 0123456789abcdef → 238b4fe5847e44b2）+ pycryptodome 随机向量对拍。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 契约：register({ id:"cast128", cat:"modern", name, desc, encode, decode })。
 */
import { register } from "./registry.js";
import { CAST128_SBOX } from "./cast128Sbox.js";

const S = CAST128_SBOX.map((box) => box.map((h) => parseInt(h, 16) >>> 0));

function rotl32(v, r) {
  return ((v << r) | (v >>> (32 - r))) >>> 0;
}
function u32(a, b, c, d) {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}
function bytesToWords(b) {
  const w = new Array(b.length / 4);
  for (let i = 0; i < b.length; i += 4) w[i / 4] = u32(b[i], b[i + 1], b[i + 2], b[i + 3]);
  return w;
}

// 密钥扩展 → { km: [16], kr: [16] }（镜像已验证的宏展开结构：4 字数组 + b() 字节取位）
function cast128KeyExpand(keyBytes) {
  if (keyBytes.length < 5 || keyBytes.length > 16) throw new Error("CAST-128 密钥须 5-16 字节");
  const K = new Array(32);
  const b = (a, n) => ((a[n >> 2] >> (24 - ((n & 3) * 8))) & 0xff);
  // x/z 均 4 个 32 位字
  const x = new Array(4);
  for (let i = 0; i < 4; i++) {
    const o = i * 4;
    const b0 = o < keyBytes.length ? keyBytes[o] : 0;
    const b1 = o + 1 < keyBytes.length ? keyBytes[o + 1] : 0;
    const b2 = o + 2 < keyBytes.length ? keyBytes[o + 2] : 0;
    const b3 = o + 3 < keyBytes.length ? keyBytes[o + 3] : 0;
    x[i] = u32(b0, b1, b2, b3); // 不足 16 字节右补零（对齐参考实现 paddedkey）
  }
  const z = new Array(4);
  const xz = (T, F, ki1, ki2, ki3, ki4, s11, s12, s13, s14, s15, s25, s35, s45) => {
    T[0] = F[ki1] ^ S[4][s11] ^ S[5][s12] ^ S[6][s13] ^ S[7][s14] ^ S[6][s15];
    T[1] = F[ki2] ^ S[4][b(T, 0)] ^ S[5][b(T, 2)] ^ S[6][b(T, 1)] ^ S[7][b(T, 3)] ^ S[7][s25];
    T[2] = F[ki3] ^ S[4][b(T, 7)] ^ S[5][b(T, 6)] ^ S[6][b(T, 5)] ^ S[7][b(T, 4)] ^ S[4][s35];
    T[3] = F[ki4] ^ S[4][b(T, 10)] ^ S[5][b(T, 9)] ^ S[6][b(T, 11)] ^ S[7][b(T, 8)] ^ S[5][s45];
  };
  const kround = (base, F, rows) => {
    const tailS = [4, 5, 6, 7];
    for (let k = 0; k < 4; k++) {
      const r = rows[k];
      K[base + k] = S[4][b(F, r[0])] ^ S[5][b(F, r[1])] ^ S[6][b(F, r[2])] ^ S[7][b(F, r[3])] ^ S[tailS[k]][b(F, r[4])];
    }
  };
  const half = (base) => {
    // zxround + K1-4
    xz(z, x, 0, 2, 3, 1, b(x, 13), b(x, 15), b(x, 12), b(x, 14), b(x, 8), b(x, 10), b(x, 9), b(x, 11));
    kround(base + 0, z, [[8, 9, 7, 6, 2], [10, 11, 5, 4, 6], [12, 13, 3, 2, 9], [14, 15, 1, 0, 12]]);
    // xzround + K5-8
    xz(x, z, 2, 0, 1, 3, b(z, 5), b(z, 7), b(z, 4), b(z, 6), b(z, 0), b(z, 2), b(z, 1), b(z, 3));
    kround(base + 4, x, [[3, 2, 12, 13, 8], [1, 0, 14, 15, 13], [7, 6, 8, 9, 3], [5, 4, 10, 11, 7]]);
    // zxround + K9-12
    xz(z, x, 0, 2, 3, 1, b(x, 13), b(x, 15), b(x, 12), b(x, 14), b(x, 8), b(x, 10), b(x, 9), b(x, 11));
    kround(base + 8, z, [[3, 2, 12, 13, 9], [1, 0, 14, 15, 12], [7, 6, 8, 9, 2], [5, 4, 10, 11, 6]]);
    // xzround + K13-16
    xz(x, z, 2, 0, 1, 3, b(z, 5), b(z, 7), b(z, 4), b(z, 6), b(z, 0), b(z, 2), b(z, 1), b(z, 3));
    kround(base + 12, x, [[8, 9, 7, 6, 3], [10, 11, 5, 4, 7], [12, 13, 3, 2, 8], [14, 15, 1, 0, 13]]);
  };
  half(0);
  half(16);
  const km = new Array(16);
  const kr = new Array(16);
  for (let i = 0; i < 16; i++) {
    km[i] = K[i];
    kr[i] = K[16 + i] & 0x1f;
  }
  return { km, kr };
}

function castRoundF(D, km, kr, type) {
  let I;
  if (type === 1) I = rotl32((km + D) >>> 0, kr);
  else if (type === 2) I = rotl32((km ^ D) >>> 0, kr);
  else I = rotl32(((km - D) >>> 0), kr);
  const a = (I >>> 24) & 0xff, b = (I >>> 16) & 0xff, c = (I >>> 8) & 0xff, d = I & 0xff;
  if (type === 1) return (((S[0][a] ^ S[1][b]) - S[2][c] + S[3][d]) >>> 0);
  if (type === 2) return (((S[0][a] - S[1][b] + S[2][c]) ^ S[3][d]) >>> 0);
  return (((S[0][a] + S[1][b] ^ S[2][c]) - S[3][d]) >>> 0);
}

function cast128Block(input, keyBytes, isDecrypt) {
  const { km, kr } = cast128KeyExpand(keyBytes);
  const rounds = keyBytes.length <= 10 ? 12 : 16; // 80 位及以下 → 12 轮（RFC 2144）
  let L = bytesToWords(input.subarray(0, 8))[0];
  let R = bytesToWords(input.subarray(0, 8))[1];
  for (let n = 0; n < rounds; n++) {
    const i = isDecrypt ? rounds - 1 - n : n;
    const type = (i % 3) + 1;
    const Ln = R;
    const Rn = (L ^ castRoundF(R, km[i], kr[i], type)) >>> 0;
    L = Ln; R = Rn;
  }
  // 输出 (R16, L16)
  const out = new Uint8Array(8);
  out[0] = (R >>> 24) & 0xff; out[1] = (R >>> 16) & 0xff; out[2] = (R >>> 8) & 0xff; out[3] = R & 0xff;
  out[4] = (L >>> 24) & 0xff; out[5] = (L >>> 16) & 0xff; out[6] = (L >>> 8) & 0xff; out[7] = L & 0xff;
  return out;
}

// ---- op：hex 输入输出（对齐 cryptoGap 类 op 的 hex 惯例） ----
function cast128Encode(text, p = {}) {
  const keyHex = String(p.key || "").replace(/\s/g, "");
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) throw new Error("密钥须为 hex（8-32 hex 位）");
  const key = Uint8Array.from(Buffer.from(keyHex, "hex"));
  if (key.length < 5 || key.length > 16) throw new Error("CAST-128 密钥须 5-16 字节（hex 10-32 位）");
  const data = Buffer.from(String(text || "").trim(), "hex");
  if (data.length === 0 || data.length % 8 !== 0) throw new Error("密文须为 8 的倍数字节的 hex");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 8) out.set(cast128Block(data.subarray(i, i + 8), key, false), i);
  return out.toString("hex");
}
function cast128Decode(text, p = {}) {
  const keyHex = String(p.key || "").replace(/\s/g, "");
  if (!/^[0-9a-fA-F]+$/.test(keyHex)) throw new Error("密钥须为 hex（8-32 hex 位）");
  const key = Uint8Array.from(Buffer.from(keyHex, "hex"));
  if (key.length < 5 || key.length > 16) throw new Error("CAST-128 密钥须 5-16 字节（hex 10-32 位）");
  const data = Buffer.from(String(text || "").trim(), "hex");
  if (data.length === 0 || data.length % 8 !== 0) throw new Error("密文须为 8 的倍数字节的 hex");
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i += 8) out.set(cast128Block(data.subarray(i, i + 8), key, true), i);
  return out.toString("hex");
}

register({
  id: "cast128", cat: "modern", name: "CAST-128",
  desc: "RFC 2144 分组密码（64 位分组，5-16 字节密钥，16 轮 Feistel 三型轮函数），hex 输入输出",
  params: [
    { key: "key", label: "密钥（hex）", type: "text", default: "", placeholder: "8-32 位 hex（5-16 字节）" },
  ],
  encode: cast128Encode, decode: cast128Decode,
});

export { cast128KeyExpand, cast128Block, cast128Encode, cast128Decode };
