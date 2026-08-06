/*
 * yescrypt.js — yescrypt 内存硬 KDF（Solar Designer 2013-2018，cat:'crypto'，run 型）。
 *
 * 算法照官方参考实现（openwall/yescrypt 的 yescrypt-ref.c + yescrypt-common.c +
 * sha256.c）逐函数移植，不编造。flags 三模式：
 *   flags=0        ：classic scrypt（RFC 7914，输出与标准 scrypt 一致）
 *   flags=1(WORM)  ：最小偏差版（t 控制计算时间，Nloop 不同）
 *   flags=0x182    ：YESCRYPT_DEFAULTS（RW 全模式：prehash + S-box 生成 +
 *                    wrap 随机访问 + SCRAM 风格尾处理）
 *
 * 核心结构：
 *   salsa20(B, rounds)：ref 版带 SIMD unshuffle/shuffle 布局（数学等价标准
 *     Salsa20，输出一致）；scrypt 路径 8 轮、pwxform 块混合尾部 2 轮。
 *   blockmix_salsa8：scrypt 的 BlockMix（RFC 7914）。
 *   pwxform：PWXsimple=2/PWXgather=4/PWXrounds=6/Swidth=8，S 表 3×1024 字
 *     （12KB），64 位乘 + 加 + XOR 查表混合，轮间 S0←S2←S1←S0 旋转。
 *   blockmix_pwxform：128r 字节 → 64 字节块混合 + 尾部 salsa20/2 链。
 *   smix1/smix2/smix：Nloop 计算（RW 与 t 的关系）、wrap()、p2floor()。
 *   yescrypt_kdf_body：PBKDF2-SHA256 包装 + RW 时 SCRAM ClientKey/StoredKey
 *     尾处理（buf = SHA256(HMAC(DK, "Client Key"))）。
 *
 * 权威向量（官方 tests.c 编译输出，TESTS-OK 完全一致）：
 *   scrypt 模式 N=4 r=1 p=1（空口令空盐 64B）→ efad0c23314cb572...
 *   WORM  N=4 r=1 p=1 t=0 → 85dda48c9ec9de2f...；t=3 → acd9a4201cf4a476...
 *   RW    N=4 r=1 p=1 t=0 → 0cd5af76eb241df8...；t=1 → 23b6adf0b60c9a99...
 *   RW    p="p" s="s" N=16 r=8 p=1 t=10（40B）→ e1f981733a94052f...
 *
 * 红线：算法照官方参考，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node --input-type=module -e "import('./src/core/yescrypt.js').then(m=>m.selfCheck())"
 *
 * 契约：register({ id:"yescrypt", cat:"crypto", name, desc, params, run })。
 */
import { register } from "./registry.js";
import { sha256Sync } from "./balloon.js"; // 复用同步 SHA-256（FIPS 180-4，balloon.js 已验证）

// ============================================================
// HMAC-SHA256 / PBKDF2-SHA256（照 yescrypt-common.c）
// ============================================================
function hmacSha256(key, msg) {
  const BLOCK = 64;
  let k = key;
  if (k.length > BLOCK) k = sha256Sync(k);
  const pad = new Uint8Array(BLOCK);
  pad.set(k);
  const ipad = new Uint8Array(BLOCK), opad = new Uint8Array(BLOCK);
  for (let i = 0; i < BLOCK; i++) { ipad[i] = pad[i] ^ 0x36; opad[i] = pad[i] ^ 0x5c; }
  const inner = new Uint8Array(BLOCK + msg.length);
  inner.set(ipad); inner.set(msg, BLOCK);
  const outer = new Uint8Array(BLOCK + 32);
  outer.set(opad); outer.set(sha256Sync(inner), BLOCK);
  return sha256Sync(outer);
}

function pbkdf2Sha256(pass, salt, c, dkLen) {
  const out = new Uint8Array(dkLen);
  const u = new Uint8Array(32);
  let block = 1;
  for (let off = 0; off < dkLen; off += 32) {
    const m = new Uint8Array(salt.length + 4);
    m.set(salt);
    const dv = new DataView(m.buffer);
    dv.setUint32(salt.length, block, false); // RFC 2898：块号大端
    let t = hmacSha256(pass, m);
    u.set(t);
    for (let i = 1; i < c; i++) {
      t = hmacSha256(pass, t);
      for (let j = 0; j < 32; j++) u[j] ^= t[j];
    }
    const n = Math.min(32, dkLen - off);
    out.set(u.subarray(0, n), off);
    block++;
  }
  return out;
}

// ============================================================
// 常量（照 yescrypt-ref.c）
// ============================================================
const YESCRYPT_RW = 0x002;
const YESCRYPT_WORM = 1;
const YESCRYPT_PREHASH = 0x10000000;
const YESCRYPT_MODE_MASK = 0x003;
const YESCRYPT_RW_DEFAULTS = 0x002 | 0x004 | 0x010 | 0x020 | 0x080; // RW|ROUNDS_6|GATHER_4|SIMPLE_2|SBOX_12K = 0x0b6
const PWXsimple = 2, PWXgather = 4, PWXrounds = 6, Swidth = 8;
const PWXbytes = PWXgather * PWXsimple * 8;   // 64
const PWXwords = PWXbytes / 4;                // 16
const Sbytes = 3 * (1 << Swidth) * PWXsimple * 8; // 12288
const Swords = Sbytes / 4;                    // 3072
const Smask = ((1 << Swidth) - 1) * PWXsimple * 8; // 0xFF0（4080）
const rmin = Math.floor((PWXbytes + 127) / 128); // C 整数除法：191/128 = 1

const MASK32 = 0xffffffff >>> 0;
const R = (a, b) => ((a << b) | (a >>> (32 - b))) >>> 0;

// ============================================================
// salsa20（ref 版：SIMD unshuffle 布局）
// ============================================================
function salsa20(B, rounds) {
  const x = new Uint32Array(16);
  for (let i = 0; i < 16; i++) x[(i * 5) % 16] = B[i];
  for (let r = 0; r < rounds; r += 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9);
    x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9);
    x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9);
    x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9);
    x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9);
    x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9);
    x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9);
    x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9);
    x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[(i * 5) % 16]) >>> 0;
}

// ============================================================
// blockmix_salsa8（scrypt 的 BlockMix，ref 布局）
// ============================================================
function blockmixSalsa8(B, r) {
  const X = new Uint32Array(16);
  X.set(B.subarray((2 * r - 1) * 16, (2 * r - 1) * 16 + 16));
  const Y = new Uint32Array(32 * r);
  for (let i = 0; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) X[k] ^= B[i * 16 + k];
    salsa20(X, 8);
    Y.set(X, i * 16);
  }
  for (let i = 0; i < r; i++) B.set(Y.subarray(i * 32, i * 32 + 16), i * 16);
  for (let i = 0; i < r; i++) B.set(Y.subarray((i * 2 + 1) * 16, (i * 2 + 1) * 16 + 16), (i + r) * 16);
}

// ============================================================
// pwxform + blockmix_pwxform（RW 模式核心）
// ============================================================
// ctx: { S: Uint32Array(Swords), w, s0: 偏移, s1, s2 }（S0/S1/S2 用偏移模拟指针旋转）
function pwxform(B, ctx) {
  const S = ctx.S;
  let s0 = ctx.s0, s1 = ctx.s1, s2 = ctx.s2, w = ctx.w;
  for (let i = 0; i < PWXrounds; i++) {
    for (let j = 0; j < PWXgather; j++) {
      const xl = B[j * PWXsimple * 2];
      const xh = B[j * PWXsimple * 2 + 1];
      // p0 = (xl & Smask) / sizeof(*S0) = /8（C 指针算术，S0 单元为 uint32[2]）
      const p0 = (xl & Smask) >> 3;
      const p1 = (xh & Smask) >> 3;
      for (let k = 0; k < PWXsimple; k++) {
        // C：p0[k][0/1] = S0 + (p0+k) 单元 = S[base + p0*2 + k*2 + (0/1)]（每单元 2 字）
        const s0lo = S[s0 + p0 * 2 + k * 2];
        const s0hi = S[s0 + p0 * 2 + k * 2 + 1];
        const s1lo = S[s1 + p1 * 2 + k * 2];
        const s1hi = S[s1 + p1 * 2 + k * 2 + 1];
        const xl2 = B[j * PWXsimple * 2 + k * 2];
        const xh2 = B[j * PWXsimple * 2 + k * 2 + 1];
        // x = xh*xl + ((s0hi<<32)+s0lo) ^ ((s1hi<<32)+s1lo)（64 位）
        let x = (BigInt(xh2) * BigInt(xl2) + ((BigInt(s0hi) << 32n) | BigInt(s0lo))) ^ ((BigInt(s1hi) << 32n) | BigInt(s1lo));
        B[j * PWXsimple * 2 + k * 2] = Number(x & 0xffffffffn) >>> 0;
        B[j * PWXsimple * 2 + k * 2 + 1] = Number((x >> 32n) & 0xffffffffn) >>> 0;
        if (i !== 0 && i !== PWXrounds - 1) {
          S[s2 + w * 2] = B[j * PWXsimple * 2 + k * 2];
          S[s2 + w * 2 + 1] = B[j * PWXsimple * 2 + k * 2 + 1];
          w = (w + 1) & 0x3ff; // 1024 上限（2^Swidth * PWXsimple = 512 → w 只到 511，& 0x1ff 即可）
        }
      }
    }
  }
  // 旋转：S0←S2, S1←S0, S2←S1（C: ctx->S0=S2, ctx->S1=S0, ctx->S2=S1）
  const t0 = s1;
  ctx.s0 = s2; ctx.s1 = s0; ctx.s2 = t0;
  ctx.w = w & 0x1ff; // (1<<Swidth)*PWXsimple - 1 = 511
}

function blockmixPwxform(B, ctx, r) {
  const r1 = 128 * r / PWXbytes; // 2r
  const X = new Uint32Array(PWXwords);
  X.set(B.subarray((r1 - 1) * PWXwords, (r1 - 1) * PWXwords + PWXwords));
  for (let i = 0; i < r1; i++) {
    if (r1 > 1) for (let k = 0; k < PWXwords; k++) X[k] ^= B[i * PWXwords + k];
    pwxform(X, ctx);
    B.set(X, i * PWXwords);
  }
  let i = ((r1 - 1) * PWXbytes) / 64; // r1-1
  salsa20(B.subarray(i * 16, i * 16 + 16), 2);
  for (i++; i < 2 * r; i++) {
    for (let k = 0; k < 16; k++) B[i * 16 + k] ^= B[(i - 1) * 16 + k];
    salsa20(B.subarray(i * 16, i * 16 + 16), 2);
  }
}

// ============================================================
// 辅助：integerify / p2floor / wrap
// ============================================================
function integerify(X, r) {
  const off = (2 * r - 1) * 16;
  return ((BigInt(X[off + 13]) << 32n) | BigInt(X[off])) & 0xffffffffffffffffn;
}
function p2floor(x) {
  while (true) { const y = x & (x - 1n); if (y === 0n) return x; x = y; }
}
function wrap(x, i) {
  const n = p2floor(i);
  return (x & (n - 1n)) + (i - n);
}

// ============================================================
// smix1 / smix2 / smix
// ============================================================
function smix1(B, r, N, flags, V, XY, ctx) {
  const s = 32 * r;
  const X = XY.subarray(0, s);
  const Y = XY.subarray(s, 2 * s);
  // X ← B（SIMD unshuffle 读）
  for (let k = 0; k < 2 * r; k++) {
    for (let i = 0; i < 16; i++) X[k * 16 + i] = B[k * 16 + ((i * 5) % 16)];
  }
  for (let i = 0n; i < N; i++) {
    V.set(X.subarray(0, s), Number(i) * s);
    if ((flags & YESCRYPT_RW) && i > 1n) {
      const j = wrap(integerify(X, r), i);
      for (let k = 0; k < s; k++) X[k] ^= V[Number(j) * s + k];
    }
    if (ctx && i < 4n && r === 1 && N === 4n) {
    }
    if (ctx) blockmixPwxform(X, ctx, r);
    else blockmixSalsa8(X, r);
    if (ctx && i < 4n && r === 1 && N === 4n) {
    }
  }
  // B ← X（shuffle 写回）
  for (let k = 0; k < 2 * r; k++) {
    for (let i = 0; i < 16; i++) B[k * 16 + ((i * 5) % 16)] = X[k * 16 + i];
  }
}

function smix2(B, r, N, Nloop, flags, V, XY, ctx) {
  const s = 32 * r;
  const X = XY.subarray(0, s);
  const Y = XY.subarray(s, 2 * s);
  for (let k = 0; k < 2 * r; k++) {
    for (let i = 0; i < 16; i++) X[k * 16 + i] = B[k * 16 + ((i * 5) % 16)];
  }
  for (let i = 0n; i < Nloop; i++) {
    const j = integerify(X, r) & (N - 1n);
    const joff = Number(j) * s;
    for (let k = 0; k < s; k++) X[k] ^= V[joff + k];
    if (flags & YESCRYPT_RW) V.set(X.subarray(0, s), joff);
    if (ctx) blockmixPwxform(X, ctx, r);
    else blockmixSalsa8(X, r);
  }
  for (let k = 0; k < 2 * r; k++) {
    for (let i = 0; i < 16; i++) B[k * 16 + ((i * 5) % 16)] = X[k * 16 + i];
  }
}

function smix(B, r, N, p, t, flags, V, XY, ctxArr, passwd) {
  const s = 32 * r;
  const Nchunk = N / BigInt(p);
  let NloopAll = Nchunk;
  if (flags & YESCRYPT_RW) {
    if (t <= 1) {
      if (t) NloopAll = Nchunk * 2n;
      NloopAll = (NloopAll + 2n) / 3n;
    } else {
      NloopAll = Nchunk * BigInt(t - 1);
    }
  } else if (t) {
    if (t === 1) NloopAll += (Nchunk + 1n) / 2n;
    NloopAll *= BigInt(t);
  }
  let NloopRw = 0n;
  if (flags & YESCRYPT_RW) NloopRw = NloopAll / BigInt(p);
  const NchunkEven = Nchunk & ~1n;
  NloopAll = (NloopAll + 1n) & ~1n;
  NloopRw = (NloopRw + 1n) & ~1n;
  for (let i = 0, Vchunk = 0n; i < p; i++, Vchunk += Nchunk) {
    const Np = i < p - 1 ? NchunkEven : (N - Vchunk);
    const Bp = B.subarray(i * s, (i + 1) * s);
    const Vp = V.subarray(Number(Vchunk) * s, (Number(Vchunk) + Number(Np)) * s);
    let ctx = null;
    if (flags & YESCRYPT_RW) {
      ctx = ctxArr[i];
      // SMix1_1(B_i, Sbytes/128, S_i, no flags)：生成 S 表（96 块）
      const tmpXY = new Uint32Array(64); // s=32（r=1）
      smix1(Bp, 1, 96n, 0, ctx.S, tmpXY, null);
      ctx.s2 = 0;                                  // 字偏移：S2=S+0
      ctx.s1 = 2 * (1 << Swidth) * PWXsimple;      // 字偏移 1024（单元 512）
      ctx.s0 = 4 * (1 << Swidth) * PWXsimple;      // 字偏移 2048（单元 1024）
      ctx.w = 0;
      if (i === 0) {
        // passwd ← HMAC-SHA256(B_{0,2r-1}, passwd)（Bp 后 64 字节为 B_{0,2r-1}，pwd 32 字节）
        // 注意：Bp 是 Uint32Array，须先转字节数组再取字节偏移（字 s-16..s = 字节 (s-16)*4..s*4）
        const bpb = new Uint8Array(Bp.length * 4);
        const bpdv = new DataView(bpb.buffer);
        for (let j = 0; j < Bp.length; j++) bpdv.setUint32(j * 4, Bp[j], true);
        const bk = bpb.subarray((s - 16) * 4, s * 4); // 64 字节
        const newPwd = hmacSha256(bk, passwd);
        passwd.set(newPwd);
      }
    }
    smix1(Bp, r, Np, flags, Vp, XY, ctx);
    smix2(Bp, r, p2floor(Np), NloopRw, flags, Vp, XY, ctx);
  }
  for (let i = 0; i < p; i++) {
    const Bp = B.subarray(i * s, (i + 1) * s);
    smix2(Bp, r, N, NloopAll - NloopRw, flags & ~YESCRYPT_RW, V, XY, (flags & YESCRYPT_RW) ? ctxArr[i] : null);
  }
}

// ============================================================
// yescrypt 主函数（照 yescrypt_kdf_body）
// ============================================================
function yescrypt(passwd, salt, flags, N, r, p, t, buflen) {
  // 参数校验（照 ref out_EINVAL 分支）
  const mode = flags & YESCRYPT_MODE_MASK;
  if (mode === 0) {
    if (flags || t) throw new Error("scrypt 模式（flags=0）不支持 t");
  } else if (mode === YESCRYPT_WORM) {
    if (flags !== YESCRYPT_WORM) throw new Error("WORM 模式 flags 必须为 1");
  } else if (mode === YESCRYPT_RW) {
    if ((flags & ~(YESCRYPT_RW | 0x004 | 0x010 | 0x020 | 0x080 | YESCRYPT_PREHASH)) !== 0)
      throw new Error("RW 模式 flags 含未知位");
  } else throw new Error("flags 模式无效");
  if ((N & (N - 1n)) !== 0n || N <= 1n || r < 1 || p < 1) throw new Error("N 须为 >1 的 2 的幂，r/p ≥ 1");
  if (r * p >= (1 << 30)) throw new Error("r*p 过大");
  if (flags & YESCRYPT_RW) {
    if (N / BigInt(p) <= 1n || r < rmin) throw new Error("RW 模式需 N/p>1 且 r ≥ 1");
  }

  const B = new Uint32Array(32 * r * p);
  const V = new Uint32Array(32 * r * Number(N));
  const XY = new Uint32Array(64 * r);

  let pw = passwd;
  if (flags) {
    // prehash：HMAC-SHA256("yescrypt-prehash"[8B], passwd)
    const pre = new TextEncoder().encode("yescrypt-prehash").subarray(0, 8);
    pw = hmacSha256(pre, passwd);
  }

  // B ← PBKDF2(pw, salt, 1, 128rp)
  const Bbytes = pbkdf2Sha256(pw, salt, 1, 32 * r * p * 4);
  const B0 = Bbytes.slice(0, 32); // 保存 B 前 32 字节（最终 PBKDF2 的 passwd）
  const bdv = new DataView(Bbytes.buffer);
  for (let i = 0; i < B.length; i++) B[i] = bdv.getUint32(i * 4, true);

  let sha256 = null;
  if (flags) sha256 = Bbytes.slice(0, 32);

  let ctxArr = null;
  let finalKey = flags ? B0.slice(0, 32) : pw; // WORM/非 RW：官方 blkcpy(sha256,B,8) → B0
  if (flags & YESCRYPT_RW) {
    ctxArr = [];
    for (let i = 0; i < p; i++) ctxArr.push({ S: new Uint32Array(Swords), w: 0, s0: 2048, s1: 1024, s2: 0 });
    const pwdBytes = new Uint8Array(32);
    pwdBytes.set(B0.subarray(0, 32));
    smix(B, r, N, p, t, flags, V, XY, ctxArr, pwdBytes);
    finalKey = pwdBytes; // RW：i==0 时被更新为 HMAC(B_{0,2r-1}, B0)
  } else {
    for (let i = 0; i < p; i++) {
      smix(B.subarray(32 * r * i, 32 * r * (i + 1)), r, N, 1, t, flags, V, XY, null, null);
    }
  }

  // DK ← PBKDF2(finalKey, B, 1, buflen)
  // finalKey：scrypt=pw；WORM/非RW=官方 blkcpy(sha256,B,8)=B0；RW=smix 更新后的 passwd
  const Bbytes2 = new Uint8Array(B.length * 4);
  const bdv2 = new DataView(Bbytes2.buffer);
  for (let i = 0; i < B.length; i++) bdv2.setUint32(i * 4, B[i], true);
  let dk = pbkdf2Sha256(finalKey, Bbytes2, 1, buflen);

  if (flags && !(flags & YESCRYPT_PREHASH)) {
    // SCRAM 风格：buf 前 min(buflen,32) 字节 = SHA256(HMAC-SHA256(DK, "Client Key"))
    // （C：HMAC key 取 PBKDF2 输出前 32 字节；其余字节保留 PBKDF2 输出）
    const ck = hmacSha256(dk.subarray(0, 32), new TextEncoder().encode("Client Key"));
    const stored = sha256Sync(ck);
    dk.set(stored.subarray(0, Math.min(buflen, 32)));
  }
  return dk;
}

// ============================================================
// run 入口（照 scrypt.js 模式）
// ============================================================
function hexToBytes(s) {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function decodeInput(s, enc) {
  const t = String(s || "");
  if (enc === "hex") return hexToBytes(t.trim());
  if (enc === "base64") {
    const bin = atob(t.trim().replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(t);
}

function yescryptRun(text, p = {}) {
  const lines = [];
  lines.push("=== yescrypt 内存硬 KDF（openwall 官方 ref 实现）===");
  lines.push("");
  const passEnc = p.passEnc || "utf8";
  const saltEnc = p.saltEnc || "utf8";
  const pass = decodeInput(text, passEnc);
  const salt = decodeInput(p.salt != null ? p.salt : "", saltEnc);
  const mode = p.mode || "rw";
  const flags = mode === "scrypt" ? 0 : mode === "worm" ? YESCRYPT_WORM : YESCRYPT_RW_DEFAULTS;
  const N = BigInt(parseInt(p.N, 10) || 2048);
  const r = parseInt(p.r, 10) || 8;
  const pp = parseInt(p.p, 10) || 1;
  const t = parseInt(p.t, 10) || 0;
  const dkLen = parseInt(p.dkLen, 10) || 32;
  lines.push(`口令: ${pass.length} 字节（${passEnc}）`);
  lines.push(`盐:   ${salt.length} 字节（${saltEnc}）`);
  lines.push(`模式: ${mode}（flags=0x${flags.toString(16)}）, N=${N}, r=${r}, p=${pp}, t=${t}, dkLen=${dkLen}`);
  const memMB = (128 * Number(N) * r) / (1024 * 1024);
  lines.push(`预计内存: ~${memMB.toFixed(1)} MB（128·N·r）`);
  lines.push("");
  try {
    const dk = yescrypt(pass, salt, flags, N, r, pp, t, dkLen);
    lines.push("--- 派生密钥 (Derived Key) ---");
    lines.push("hex: " + bytesToHex(dk));
  } catch (e) {
    lines.push("✗ " + (e.message || String(e)));
  }
  return lines.join("\n");
}

register({
  id: "yescrypt",
  cat: "crypto",
  name: "yescrypt 密钥派生",
  desc: "yescrypt 内存硬口令 KDF（Solar Designer，openwall 官方参考实现）：flags=0 输出与经典 scrypt 完全一致；WORM=最小偏差；RW 默认=prehash + 12KB S-box pwxform + wrap 随机访问 + SCRAM 尾处理。抗 GPU/ASIC。参数 N（2 的幂）/r/p/t/dkLen。",
  params: [
    { key: "passEnc", label: "口令编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "salt", label: "盐 (salt)", type: "text", default: "", placeholder: "盐值" },
    { key: "saltEnc", label: "盐编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    {
      key: "mode", label: "模式（flags）", type: "select", default: "rw",
      options: [
        { value: "rw", label: "RW 默认（yescrypt）" },
        { value: "worm", label: "WORM（最小偏差）" },
        { value: "scrypt", label: "scrypt（RFC 7914 兼容）" },
      ],
    },
    { key: "N", label: "N（CPU/内存代价，2 的幂）", type: "number", default: 2048, placeholder: "2048" },
    { key: "r", label: "r（块大小）", type: "number", default: 8, placeholder: "8" },
    { key: "p", label: "p（并行度）", type: "number", default: 1, placeholder: "1" },
    { key: "t", label: "t（计算时间，scrypt 模式必须 0）", type: "number", default: 0, placeholder: "0" },
    { key: "dkLen", label: "输出字节数 dkLen", type: "number", default: 32, placeholder: "32" },
  ],
  run: yescryptRun,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑） ----
function selfCheck() {
  let fail = 0;
  const te = new TextEncoder();
  const empty = new Uint8Array(0);
  const check = (name, got, expected) => {
    if (got === expected) console.log("PASS " + name);
    else { console.log("FAIL " + name + "\n  got      " + got + "\n  expected " + expected); fail++; }
  };
  // 权威向量（openwall 官方 tests.c 编译输出，TESTS-OK 一致）
  check("scrypt 模式 N=4 r=1 p=1（64B）",
    bytesToHex(yescrypt(empty, empty, 0, 4n, 1, 1, 0, 64)),
    "efad0c23314cb572bc3cfb1543da42f8a8b073004c866b64ab5055a4f09fa5f571142ebfe7e05a3b92c432f31dea95ad5f9c854b6456462f4bd0f732b7cdc549");
  check("scrypt 模式与 RFC 7914 一致（N=16 r=1 p=1）",
    bytesToHex(yescrypt(empty, empty, 0, 16n, 1, 1, 0, 64)),
    "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906");
  check("WORM N=4 r=1 p=1 t=0（64B）",
    bytesToHex(yescrypt(empty, empty, YESCRYPT_WORM, 4n, 1, 1, 0, 64)),
    "85dda48c9ec9de2f7f1ae8b4dfeda51f8b6d56f3081be1a7c0833ba2719a36ab02885dae36557d342686b17ba75f2c217792de0970ab1d07a9c750936d31426f");
  check("WORM N=4 r=1 p=1 t=3（64B）",
    bytesToHex(yescrypt(empty, empty, YESCRYPT_WORM, 4n, 1, 1, 3, 64)),
    "acd9a4201cf4a476ecf7baa6113d86fb65cd07102b4004e4f9d99cd34255a108997d70ae0a64bf0a4d96c173abf88279c1a94ad9bdf168edfbbd90f66ed5c80d");
  check("RW N=4 r=1 p=1 t=0（64B）",
    bytesToHex(yescrypt(empty, empty, YESCRYPT_RW_DEFAULTS, 4n, 1, 1, 0, 64)),
    "0cd5af76eb241df8119a9a122ae36920bcc7f414b9c0d58f45008060dade46b0c80922bdcc16a3ab5d201d4c6140c671be1f75272ca904739d5ad1ff672b0c21");
  check("RW N=4 r=1 p=1 t=1（64B）",
    bytesToHex(yescrypt(empty, empty, YESCRYPT_RW_DEFAULTS, 4n, 1, 1, 1, 64)),
    "23b6adf0b60c9a997f58583d80cda48c638cdc2f289edf93a70807725a0d35c468ca362c5557cc04b6811e2e730841f526d8f4f7acfbfa9e06fe1f383a71155e");
  check("RW p=\"p\" s=\"s\" N=16 r=8 p=1 t=10（40B）",
    bytesToHex(yescrypt(te.encode("p"), te.encode("s"), YESCRYPT_RW_DEFAULTS, 16n, 8, 1, 10, 40)),
    "e1f981733a94052fcd7acb1405df0bbde8e499b6a1331b775909b48c2f516c40dcc8301635b7237b");
  console.log(fail === 0 ? "yescrypt selfCheck 全部 PASS" : `yescrypt selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { yescrypt, pbkdf2Sha256, hmacSha256, selfCheck, blockmixPwxform, pwxform, Swords, PWXwords, PWXbytes, PWXrounds, PWXgather, PWXsimple, Swidth };
