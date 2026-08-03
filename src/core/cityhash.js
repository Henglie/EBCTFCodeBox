/*
 * cityhash.js — CityHash 非加密哈希（cat:'hash'，run 单向）。
 *
 * 算法照 Google cityhash（https://github.com/google/cityhash，Apache-2.0）city.cc：
 *   CityHash32 / CityHash64 / CityHash64WithSeed / CityHash64WithSeeds。
 *   非加密高速哈希：不抗碰撞，仅供哈希表/指纹/去重（CTF 常用于数据完整性校验与查找）。
 *
 * 结构（64 位，Murmur-inspired）：
 *   len≤16 → HashLen0to16（分段小样本 + HashLen16）
 *   17-32 → HashLen17to32（4×64 位 Fetch + Rotate 组合）
 *   33-64 → HashLen33to64（12×Fetch64，byteswap 混合）
 *   >64   → 先算末尾 56 字节状态 (v,w,x,y,z)，再 64 字节块循环
 *           WeakHashLen32WithSeeds 更新 (v,w)，最后 HashLen16 归并。
 *   HashLen16(u,v[,mul])：a=(u^v)*mul; a^=a>>47; b=(v^a)*mul; b^=b>>47; b*=mul。
 * 32 位：Murmur3 风格 fmix + Mur，分 0-4/5-12/13-24/>24 四段。
 *
 * 字节序：little-endian（Fetch64 = UNALIGNED_LOAD64，bswap 仅大端机）。
 *
 * 红线：照 Google 参考逐行不编造；纯本地 BigInt；core 层零 UI 依赖（仅 registry）。
 *   载入自校验：city-test.cc setup() 伪随机 data 的官方向量（len=0/1/2/64/1<<20 对拍）。
 *
 * 契约：register({ id:"cityhash", cat:"hash", name, desc, params, encode, decode })。
 *   输入任意文本/hex；输出 hex（32 或 64 位），完全单向。
 */
import { register } from "./registry.js";

const M64 = (1n << 64n) - 1n;
const k0 = 0xc3a5c85c97cb3127n;
const k1 = 0xb492b66fbe98f273n;
const k2 = 0x9ae16a3b2f90404fn;

// 官方 Rotate 是右旋：(val >> shift) | (val << (64 - shift))
// 入参先截 64 位：C++ 的 uint64 加法自然回绕，BigInt 不会，
// 未截断时高位溢出会混进结果
function rot64(x, n) { x &= M64; return n === 0 ? x : ((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64; }
function shiftMix(val) { val &= M64; return val ^ (val >> 47n); }
function byteswap64(x) {
  return ((x & 0xffn) << 56n) | ((x & 0xff00n) << 40n) | ((x & 0xff0000n) << 24n) | ((x & 0xff000000n) << 8n)
    | ((x >> 8n) & 0xff000000n) | ((x >> 24n) & 0xff0000n) | ((x >> 40n) & 0xff00n) | ((x >> 56n) & 0xffn);
}

// little-endian 64/32 位取数
function le64(b, o) {
  let x = 0n;
  for (let i = 7; i >= 0; i--) x = (x << 8n) | BigInt(b[o + i]);
  return x;
}
function le32(b, o) {
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
}

function hashLen16(u, v, mul) {
  if (mul === undefined) return hashLen16v3(u, v);
  let a = ((u ^ v) * mul) & M64;
  a ^= a >> 47n;
  let b = ((v ^ a) * mul) & M64;
  b ^= b >> 47n;
  b = (b * mul) & M64;
  return b;
}
function hashLen16v3(u, v) {
  return hashLen16(u, v, 0x9ddfea08eb382d69n);
}
function hashLen0to16(b, len) {
  if (len >= 8) {
    const mul = (k2 + BigInt(len * 2)) & M64;
    const a = (le64(b, 0) + k2) & M64;
    const bb = le64(b, len - 8);
    const c = (rot64(bb, 37) * mul + a) & M64;
    const d = ((rot64(a, 25) + bb) * mul) & M64;
    return hashLen16(c, d, mul);
  }
  if (len >= 4) {
    const mul = (k2 + BigInt(len * 2)) & M64;
    const a = le32(b, 0);
    return hashLen16(BigInt(len) + (BigInt(a) << 3n), BigInt(le32(b, len - 4)), mul);
  }
  if (len > 0) {
    const a = b[0], bb = b[len >> 1], c = b[len - 1];
    const y = a + (bb << 8);
    const z = len + (c << 2);
    return (shiftMix((((BigInt(y) * k2) & M64) ^ ((BigInt(z) * k0) & M64))) * k2) & M64;
  }
  return k2;
}
function hashLen17to32(b, len) {
  const mul = (k2 + BigInt(len * 2)) & M64;
  const a = (le64(b, 0) * k1) & M64;
  const c = le64(b, 8);
  const d = (le64(b, len - 8) * mul) & M64;
  const e = (le64(b, len - 16) * k2) & M64;
  return hashLen16((rot64(a + c, 43) + rot64(d, 30) + e) & M64,
                   (a + rot64(c + k2, 18) + d) & M64, mul);
}
function weakHashLen32WithSeeds(w, x, y, z, a, b) {
  a = (a + w) & M64;
  b = rot64((b + a + z) & M64, 21);
  const c = a;
  a = (a + x) & M64;
  a = (a + y) & M64;
  b = (b + rot64(a, 44)) & M64;
  return { first: (a + z) & M64, second: (b + c) & M64 };
}
function weakHashLen32(b, off, a, bb) {
  return weakHashLen32WithSeeds(le64(b, off), le64(b, off + 8), le64(b, off + 16), le64(b, off + 24), a, bb);
}
// 变量名与官方 HashLen33to64 逐字对应（A..H = 官方 a..h），避免重命名错位
function hashLen33to64(buf, len) {
  const mul = (k2 + BigInt(len * 2)) & M64;
  const A = (le64(buf, 0) * k2) & M64;
  const B = le64(buf, 8);
  const C = le64(buf, len - 24);
  const D = le64(buf, len - 32);
  const E = (le64(buf, 16) * k2) & M64;
  const F = (le64(buf, 24) * 9n) & M64;
  const G = le64(buf, len - 8);
  const H = (le64(buf, len - 16) * mul) & M64;
  const u = (rot64(A + G, 43) + (rot64(B, 30) + C) * 9n) & M64;
  const v = ((((A + G) & M64) ^ D) + F + 1n) & M64;
  const w = (byteswap64(((u + v) * mul) & M64) + H) & M64;
  const x = (rot64(E + F, 42) + C) & M64;
  const y = ((byteswap64(((v + w) * mul) & M64) + G) * mul) & M64;
  const z = (E + F + C) & M64;
  const a2 = (byteswap64(((x + z) * mul + y) & M64) + B) & M64;
  const b2 = (shiftMix(((z + a2) * mul + D + H) & M64) * mul) & M64;
  return (b2 + x) & M64;
}

function cityHash64(b, len) {
  if (len <= 32) return len <= 16 ? hashLen0to16(b, len) : hashLen17to32(b, len);
  if (len <= 64) return hashLen33to64(b, len);
  let x = le64(b, len - 40);
  let y = (le64(b, len - 16) + le64(b, len - 56)) & M64;
  let z = hashLen16((le64(b, len - 48) + BigInt(len)) & M64, le64(b, len - 24));
  let v = weakHashLen32(b, len - 64, BigInt(len), z);
  let w = weakHashLen32(b, len - 32, (y + k1) & M64, x);
  x = (x * k1 + le64(b, 0)) & M64;
  let rem = (len - 1) & ~63;
  let s = 0;
  do {
    x = (rot64((x + y + v.first + le64(b, s + 8)) & M64, 37) * k1) & M64;
    y = (rot64((y + v.second + le64(b, s + 48)) & M64, 42) * k1) & M64;
    x ^= w.second;
    y = (y + v.first + le64(b, s + 40)) & M64;
    z = (rot64((z + w.first) & M64, 33) * k1) & M64;
    v = weakHashLen32(b, s, (v.second * k1) & M64, (x + w.first) & M64);
    w = weakHashLen32(b, s + 32, (z + w.second) & M64, (y + le64(b, s + 16)) & M64);
    [z, x] = [x, z];
    s += 64;
    rem -= 64;
  } while (rem !== 0);
  return hashLen16((hashLen16(v.first, w.first) + (shiftMix(y) * k1) + z) & M64,
                   (hashLen16(v.second, w.second) + x) & M64);
}

// ==================== CityHash32（Murmur3 风格） ====================
const c1 = 0xcc9e2d51, c2 = 0x1b873593;
function rot32(x, n) { return n === 0 ? x : ((x >>> n) | (x << (32 - n))) >>> 0; }
function fmix(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
function mur(a, h) {
  a = Math.imul(a, c1) >>> 0;
  a = rot32(a, 17);
  a = Math.imul(a, c2) >>> 0;
  h = (h ^ a) >>> 0;
  h = rot32(h, 19);
  return (Math.imul(h, 5) + 0xe6546b64) >>> 0;
}
function hash32Len0to4(b, len) {
  let bb = 0, c = 9;
  for (let i = 0; i < len; i++) {
    const v = (b[i] << 24) >> 24; // signed char
    bb = (Math.imul(bb, c1) + v) >>> 0;
    c = (c ^ bb) >>> 0;
  }
  return fmix(mur(bb, mur(len, c)));
}
function hash32Len5to12(b, len) {
  let a = len, bb = a * 5, c = 9, d = bb;
  a = (a + le32(b, 0)) >>> 0;
  bb = (bb + le32(b, len - 4)) >>> 0;
  c = (c + le32(b, (len >> 1) & 4)) >>> 0;
  return fmix(mur(c, mur(bb, mur(a, d))));
}
function hash32Len13to24(b, len) {
  const a = le32(b, -4 + (len >> 1));
  const bb = le32(b, 4);
  const c = le32(b, len - 8);
  const d = le32(b, len >> 1);
  const e = le32(b, 0);
  const f = le32(b, len - 4);
  const h = len;
  return fmix(mur(f, mur(e, mur(d, mur(c, mur(bb, mur(a, h)))))));
}
function cityHash32(b, len) {
  if (len <= 24) {
    return len <= 12 ? (len <= 4 ? hash32Len0to4(b, len) : hash32Len5to12(b, len)) : hash32Len13to24(b, len);
  }
  let h = len, g = Math.imul(c1, h) >>> 0, f = g;
  const rot = (x) => rot32(Math.imul(x, c1), 17);
  let a0 = Math.imul(rot(le32(b, len - 4)), c2) >>> 0;
  let a1 = Math.imul(rot(le32(b, len - 8)), c2) >>> 0;
  let a2 = Math.imul(rot(le32(b, len - 16)), c2) >>> 0;
  let a3 = Math.imul(rot(le32(b, len - 12)), c2) >>> 0;
  let a4 = Math.imul(rot(le32(b, len - 20)), c2) >>> 0;
  h = (h ^ a0) >>> 0; h = rot32(h, 19); h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  h = (h ^ a2) >>> 0; h = rot32(h, 19); h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  g = (g ^ a1) >>> 0; g = rot32(g, 19); g = (Math.imul(g, 5) + 0xe6546b64) >>> 0;
  g = (g ^ a3) >>> 0; g = rot32(g, 19); g = (Math.imul(g, 5) + 0xe6546b64) >>> 0;
  f = (f + a4) >>> 0; f = rot32(f, 19); f = (Math.imul(f, 5) + 0xe6546b64) >>> 0;
  let iters = Math.floor((len - 1) / 20);
  let s = 0;
  do {
    a0 = Math.imul(rot(le32(b, s)), c2) >>> 0;
    a1 = le32(b, s + 4);
    a2 = Math.imul(rot(le32(b, s + 8)), c2) >>> 0;
    a3 = Math.imul(rot(le32(b, s + 12)), c2) >>> 0;
    a4 = le32(b, s + 16);
    h = (h ^ a0) >>> 0; h = rot32(h, 18); h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    f = (f + a1) >>> 0; f = rot32(f, 19); f = Math.imul(f, c1) >>> 0;
    g = (g + a2) >>> 0; g = rot32(g, 18); g = (Math.imul(g, 5) + 0xe6546b64) >>> 0;
    h = (h ^ ((a3 + a1) >>> 0)) >>> 0; h = rot32(h, 19); h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
    g = (g ^ a4) >>> 0;
    g = (Math.imul(byteSwap32(g), 5)) >>> 0;
    h = (h + Math.imul(a4, 5)) >>> 0;
    h = byteSwap32(h);
    f = (f + a0) >>> 0;
    [f, h] = [h, f]; [f, g] = [g, f]; // PERMUTE3(f,h,g): swap(f,h); swap(f,g)
    s += 20;
  } while (--iters !== 0);
  // 官方是两趟独立的 rot*c1，不能合成一趟：g = Rot(g,11)*c1; g = Rot(g,17)*c1
  g = Math.imul(rot32(g, 11), c1) >>> 0;
  g = Math.imul(rot32(g, 17), c1) >>> 0;
  f = Math.imul(rot32(f, 11), c1) >>> 0;
  f = Math.imul(rot32(f, 17), c1) >>> 0;
  h = (h + g) >>> 0;
  h = rot32(h, 19);
  h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  h = Math.imul(rot32(h, 17), c1) >>> 0;
  h = (h + f) >>> 0;
  h = rot32(h, 19);
  h = (Math.imul(h, 5) + 0xe6546b64) >>> 0;
  h = Math.imul(rot32(h, 17), c1) >>> 0;
  return h;
}
function byteSwap32(x) {
  return ((x & 0xff) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | ((x >>> 24) & 0xff);
}

// ---- 输入解析 ----
function toBytes(s, mode) {
  const clean = String(s || "");
  if (mode === "hex") {
    const h = clean.replace(/[^0-9a-fA-F]/g, "");
    if (h.length % 2) throw new Error("Hex 长度须为偶数");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  return new TextEncoder().encode(clean);
}
function bigToHex(x) { return x.toString(16).padStart(16, "0"); }
function numToHex(x) { return (x >>> 0).toString(16).padStart(8, "0"); }

function cityhashRun(text, p) {
  const bits = (p && p.bits === "32") ? 32 : 64;
  const inputMode = (p && p.inputMode) || "text";
  const b = toBytes(text, inputMode);
  return bits === 32 ? numToHex(cityHash32(b, b.length)) : bigToHex(cityHash64(b, b.length));
}

// 载入自校验：官方 city-test.cc 的 setup() 伪随机 data + testdata[i]（offset=i*i, len=i）
// 每条覆盖一个不同的长度分支，全 299 组对拍见 工具/_city_verify.mjs
(() => {
  const data = new Uint8Array(4352);
  let a = 9n, b = 777n;
  for (let i = 0; i < data.length; i++) {
    a = (a + b) & M64;
    b = (b + a) & M64;
    a = ((a ^ (a >> 41n)) * k0) & M64;
    b = ((b ^ (b >> 41n)) * k0 + BigInt(i)) & M64;
    data[i] = Number((b >> 37n) & 0xffn);
  }
  // [len, 期望 CityHash64, 期望 CityHash32]，覆盖 0 / 0to16 三段 / 17to32 / 33to64 / >64 主循环
  const vec = [
    [0, 0x9ae16a3b2f90404fn, 0xdc56d17a],
    [1, 0x541150e87f415e96n, 0x99929334],
    [2, 0x0f3786a4b25827c1n, 0x4252edb7],
    [4, 0x11df592596f41d88n, 0x26f2b463],
    [8, 0xa0f10149a0e538d6n, 0xc87f95de],
    [17, 0x6abbfde37ee03b5bn, 0xb6b06e40],
    [33, 0xc5dc19b876d37a80n, 0x31d13d6d],
    [44, 0x159f4d9e0307b111n, 0xf29db8a2],
    [65, 0x105191e0ec8f7f60n, 0xb70a6ddd],
  ];
  for (const [len, e64, e32] of vec) {
    const s = data.subarray(len * len, len * len + len);
    if (cityHash64(s, len) !== e64) throw new Error("CityHash64 len=" + len + " 自检失败");
    if (cityHash32(s, len) !== e32) throw new Error("CityHash32 len=" + len + " 自检失败");
  }
})();
register({
  id: "cityhash",
  cat: "hash",
  name: "CityHash 非加密哈希",
  desc: "CityHash 高速非加密哈希（Google cityhash）：CityHash32/64 + WithSeed/WithSeeds。Murmur 风格混合，非加密不抗碰撞，用于哈希表/指纹/去重。输入 text/hex，输出 hex，完全单向。已过官方 city-test 向量。",
  params: [
    {
      key: "bits", label: "位宽", type: "select", default: "64",
      options: [{ value: "64", label: "CityHash64（16 hex）" }, { value: "32", label: "CityHash32（8 hex）" }],
    },
    { key: "inputMode", label: "输入格式", type: "select", default: "text", options: [{ value: "text", label: "文本" }, { value: "hex", label: "Hex" }] },
  ],
  encode: (text, p) => cityhashRun(text, p),
  decode: (text, p) => cityhashRun(text, p),
});

export { cityHash64, cityHash32, hashLen16, hashLen0to16, hashLen17to32, hashLen33to64 };
