/*
 * hashFrontier.js — 哈希边界补全三件（T398 · 批B）。
 *
 * 覆盖：Argon2 KDF（RFC 9106，Argon2d/i/id）/ Tiger & Tiger2（192-bit，Anderson-Biham）/
 * Kupyna（乌克兰 DSTU 7564:2014，256/384/512）。全部单向 run，输入 text/hex 可选，输出小写 hex。
 *
 * 红线与出处：
 * - Argon2：RFC 9106（v=0x13）。Blake2b 直接 import 自 argon2id.js（该实现的 BLAKE2b 已被
 *   argon2-cffi 25.1.0 向量对拍验证，见 工具/rt_argon2_test.mjs 与 argon2id.js 头注）。
 *   H' 变长哈希与压缩函数 G 在本文件内置（argon2id.js 未导出这两块，按任务约定内置并注明）。
 *   内存矩阵用 Uint32Array（每块 1024B = 256×uint32，64-bit 字拆 lo/hi 对），
 *   64MiB 上限实测 ~67MB 内存，杜绝 BigInt 矩阵（同规模要 300MB+）把页面打爆。
 *   护栏：m ≤ 65536 KiB（64MiB）、t ≤ 1024、p ≤ 254、tagLen ≤ 1024。
 *   并行口径：p>1 时按 RFC 9106 的 lane 划分与 slice 同步语义「串行」逐 lane 计算——
 *   规范只定义 lane 间的数据依赖（每 slice 结束后引用其它 lane 已完成块），
 *   串行遍历与并行实现的输出比特一致，仅无并行加速。
 *   KAT：RFC 9106 §5 官方三向量（Argon2d/i/id，p=4,t=3,m=32）+ 项目内 argon2-cffi
 *   对拍向量（argon2id.js 头注两组，t=2 m=256 p=1/2）。
 * - Tiger：Anderson-Biham 1996（FSE'3），参考实现 technion tiger-src；S-box 1024×64bit
 *   逐字提取自 RHash librhash/tiger_sbox.c（权威移植，与作者参考表一致）。
 *   结构：3 passes × 8 rounds（mul 5/7/9）+ 2 次 key_schedule；消息词小端装载、
 *   填充 0x01（Tiger）/0x80（Tiger2）、64-bit 位长大端追加；输出 = 状态三字大端序列化
 *   （NESSIE 口径）。KAT：NESSIE/作者官方向量（""/"abc"/"Tiger"/64B×2/125B 等）+
 *   Tiger2（作者官网 NESSIE 格式向量）。
 * - Kupyna：DSTU 7564:2014（Oliynykov 等设计，Grøstl 近亲）。tP 置换 10/14 轮，
 *   奇偶轮 P/Q 交错（AddRoundConstant + SubBytes+MixColumns 复合 T 表 + 轮常量加/进位）。
 *   T0..T7 八张 256×64bit 复合表逐字提取自 li0ard/kupyna（MIT，noble-hashes 风格，
 *   官方向量全通过），状态小端、长度 12 字节小端追加、输出取状态尾部 bits/8 字节。
 *   KAT：DSTU 标准公开向量（""=cd5101d1…/656b2f4c…，快狐狸 996899f2…）+ oracle 对拍
 *   （li0ard/kupyna 0.1.4 实测，含 0..200 字节全长度扫界）。
 * - 契约：算法层零 UI 依赖；全部纯函数本地计算（零外发）。
 */

import { register } from "./registry.js";
import { blake2b } from "./argon2id.js";

const te = new TextEncoder();
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** text/hex 双编码输入。hex 非法直接抛错（项目惯例）。 */
function inputBytes(text, p) {
  const mode = (p && p.inputType) || "text";
  if (mode === "hex") {
    const s = (text || "").replace(/\s+/g, "");
    if (s.length === 0) return new Uint8Array(0);
    if (s.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(s)) {
      throw new Error("hex 输入非法：要求偶数长度的十六进制字符串");
    }
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }
  return te.encode(text || "");
}

/** 独立 hex 字节输入（盐/secret/ad 用）。空串返回空数组。 */
function hexBytes(s) {
  const t = (s || "").replace(/\s+/g, "");
  if (!t) return new Uint8Array(0);
  if (t.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(t)) {
    throw new Error("hex 字段非法：要求偶数长度的十六进制字符串");
  }
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

// ============================================================
// Argon2（RFC 9106，Argon2d/i/id）
// 内存矩阵 Uint32Array；每个 1024B 块 = 128 个 64-bit 字 = 256×uint32（lo/hi 对）。
// BLAKE2b 复用 argon2id.js 的已验证实现；H'/G 本文件内置（argon2id.js 未导出）。
// ============================================================
const A2_VERSION = 0x13;
const A2_TYPES = { argon2d: 0, argon2i: 1, argon2id: 2 };
const U32 = 0x100000000; // 2^32

function le32(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
function u8concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// H'^T(A)：RFC 9106 §3.2 变长哈希（输出 T 字节；≤64 一发，>64 按 32 字节链）
function hprime(outLen, A) {
  const input = u8concat(le32(outLen), A);
  if (outLen <= 64) return blake2b(input, outLen);
  const r = Math.ceil(outLen / 32) - 2;
  const out = new Uint8Array(outLen);
  let V = blake2b(input, 64);
  out.set(V.subarray(0, 32), 0);
  for (let i = 1; i < r; i++) {
    V = blake2b(V, 64);
    out.set(V.subarray(0, 32), i * 32);
  }
  const lastLen = outLen - 32 * r;
  V = blake2b(V, lastLen);
  out.set(V.subarray(0, lastLen), 32 * r);
  return out;
}

// ---- 64-bit 字运算（lo/hi uint32 对），全程 Number 精确（无 53 位溢出路径）----
let _rlo = 0, _rhi = 0; // 乘/旋结果的模块级出口（避免热点路径建数组）

// (x*y*2) mod 2^64 → _rlo/_rhi。x,y 为 uint32；16 位拆分乘法，全 Number 精确。
function mulDbl(x, y) {
  const xh = x >>> 16, xl = x & 0xffff, yh = y >>> 16, yl = y & 0xffff;
  const p0 = xl * yl;               // < 2^32
  const p1 = xh * yl + xl * yh;     // < 2^33
  const p2 = xh * yh;               // < 2^32
  const t0 = p0 + p1 * 0x10000;     // < 2^33 + 2^32（double 精确）
  const lo = t0 % U32;
  // 高位 = p2 + t0 的进位（floor(t0/2^32) 已涵盖 floor(p1/2^16)，勿重复计入）
  const hi = (p2 + Math.floor(t0 / U32)) % U32;
  _rlo = (lo * 2) % U32;
  _rhi = (hi * 2 + (lo >= 0x80000000 ? 1 : 0)) % U32;
}

// 64-bit 循环右移 n 位 → _rlo/_rhi
function rotr64(lo, hi, n) {
  if (n === 32) { _rlo = hi; _rhi = lo; return; }
  if (n < 32) {
    _rlo = ((lo >>> n) | (hi << (32 - n))) >>> 0;
    _rhi = ((hi >>> n) | (lo << (32 - n))) >>> 0;
    return;
  }
  const m = n - 32;
  _rlo = ((hi >>> m) | (lo << (32 - m))) >>> 0;
  _rhi = ((lo >>> m) | (hi << (32 - m))) >>> 0;
}

// Argon2 GB（RFC 9106 §3.5，含 2*lo*lo 乘法项）。v: Uint32Array，a..d 为字下标。
function gb(v, a, b, c, d) {
  const ai = 2 * a, bi = 2 * b, ci = 2 * c, di = 2 * d;
  let alo = v[ai], ahi = v[ai + 1];
  let blo = v[bi], bhi = v[bi + 1];
  let clo = v[ci], chi = v[ci + 1];
  let dlo = v[di], dhi = v[di + 1];
  let s;
  // a += b + 2*lo(a)*lo(b)
  mulDbl(alo, blo);
  s = alo + blo + _rlo;
  alo = s % U32; ahi = (ahi + bhi + _rhi + Math.floor(s / U32)) % U32;
  // d = rotr(d ^ a, 32)
  rotr64((dlo ^ alo) >>> 0, (dhi ^ ahi) >>> 0, 32);
  dlo = _rlo; dhi = _rhi;
  // c += d + 2*lo(c)*lo(d)
  mulDbl(clo, dlo);
  s = clo + dlo + _rlo;
  clo = s % U32; chi = (chi + dhi + _rhi + Math.floor(s / U32)) % U32;
  // b = rotr(b ^ c, 24)
  rotr64((blo ^ clo) >>> 0, (bhi ^ chi) >>> 0, 24);
  blo = _rlo; bhi = _rhi;
  // a += b + 2*lo(a)*lo(b)
  mulDbl(alo, blo);
  s = alo + blo + _rlo;
  alo = s % U32; ahi = (ahi + bhi + _rhi + Math.floor(s / U32)) % U32;
  // d = rotr(d ^ a, 16)
  rotr64((dlo ^ alo) >>> 0, (dhi ^ ahi) >>> 0, 16);
  dlo = _rlo; dhi = _rhi;
  // c += d + 2*lo(c)*lo(d)
  mulDbl(clo, dlo);
  s = clo + dlo + _rlo;
  clo = s % U32; chi = (chi + dhi + _rhi + Math.floor(s / U32)) % U32;
  // b = rotr(b ^ c, 63)
  rotr64((blo ^ clo) >>> 0, (bhi ^ chi) >>> 0, 63);
  blo = _rlo; bhi = _rhi;
  v[ai] = alo; v[ai + 1] = ahi;
  v[bi] = blo; v[bi + 1] = bhi;
  v[ci] = clo; v[ci + 1] = chi;
  v[di] = dlo; v[di + 1] = dhi;
}

// BLAKE2 轮排列 P（对 16 个 64-bit 字 = 32×uint32）
function p16(t) {
  gb(t, 0, 4, 8, 12); gb(t, 1, 5, 9, 13); gb(t, 2, 6, 10, 14); gb(t, 3, 7, 11, 15);
  gb(t, 0, 5, 10, 15); gb(t, 1, 6, 11, 12); gb(t, 2, 7, 8, 13); gb(t, 3, 4, 9, 14);
}

// Argon2 压缩函数 G(X,Y)（RFC 9106 §3.6）：行 8 次 P + 列 8 次 P，Z = Q ^ R。
// x/y/out 为 Uint32Array + uint32 偏移（块粒度 256）。out 可与 x/y 同域（先读后写，无别名风险）。
const _R = new Uint32Array(256), _Q = new Uint32Array(256), _T = new Uint32Array(32);
function blockG(x, xo, y, yo, out, oo) {
  for (let i = 0; i < 256; i++) {
    const r = (x[xo + i] ^ y[yo + i]) >>> 0;
    _R[i] = r; _Q[i] = r;
  }
  for (let row = 0; row < 8; row++) {
    const base = row * 16;
    for (let i = 0; i < 16; i++) { _T[2 * i] = _Q[2 * (base + i)]; _T[2 * i + 1] = _Q[2 * (base + i) + 1]; }
    p16(_T);
    for (let i = 0; i < 16; i++) { _Q[2 * (base + i)] = _T[2 * i]; _Q[2 * (base + i) + 1] = _T[2 * i + 1]; }
  }
  for (let c = 0; c < 8; c++) {
    // 列 c 取每行「寄存器对」：字 (k*16+2c) 与 (k*16+2c+1) 两个相邻 64-bit 字
    for (let k = 0; k < 8; k++) {
      const w = (k * 16 + 2 * c) * 2; // uint32 偏移（字 w 的 lo/hi + 字 w+1 的 lo/hi）
      _T[4 * k] = _Q[w]; _T[4 * k + 1] = _Q[w + 1];
      _T[4 * k + 2] = _Q[w + 2]; _T[4 * k + 3] = _Q[w + 3];
    }
    p16(_T);
    for (let k = 0; k < 8; k++) {
      const w = (k * 16 + 2 * c) * 2;
      _Q[w] = _T[4 * k]; _Q[w + 1] = _T[4 * k + 1];
      _Q[w + 2] = _T[4 * k + 2]; _Q[w + 3] = _T[4 * k + 3];
    }
  }
  for (let i = 0; i < 256; i++) out[oo + i] = (_Q[i] ^ _R[i]) >>> 0;
}

// 1024 字节 → 内存块（128 字小端装载）
function bytesToBlock(b, mem, off) {
  for (let j = 0; j < 128; j++) {
    const o = j * 8;
    const lo = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const hi = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
    mem[off + 2 * j] = lo; mem[off + 2 * j + 1] = hi;
  }
}
// 内存块 → 1024 字节（小端）
function blockToBytes(mem, off) {
  const out = new Uint8Array(1024);
  for (let j = 0; j < 128; j++) {
    let lo = mem[off + 2 * j], hi = mem[off + 2 * j + 1];
    const o = j * 8;
    out[o] = lo & 0xff; out[o + 1] = (lo >>> 8) & 0xff;
    out[o + 2] = (lo >>> 16) & 0xff; out[o + 3] = (lo >>> 24) & 0xff;
    out[o + 4] = hi & 0xff; out[o + 5] = (hi >>> 8) & 0xff;
    out[o + 6] = (hi >>> 16) & 0xff; out[o + 7] = (hi >>> 24) & 0xff;
  }
  return out;
}

/**
 * Argon2 派生（RFC 9106，v=0x13）。
 * @param {Uint8Array} pwd 口令
 * @param {Uint8Array} salt 盐
 * @param {Uint8Array} secret 可空
 * @param {Uint8Array} ad 可空
 * @param {object} o { type:0|1|2, t, m(KiB), p, tagLen }
 * @returns {Uint8Array}
 */
function argon2Hash(pwd, salt, secret, ad, o) {
  const type = o.type, t = o.t, m = o.m, p = o.p, tagLen = o.tagLen;
  const mPrime = 4 * p * Math.floor(m / (4 * p)); // RFC：4p 向下取整
  const laneLength = mPrime / p;                  // q：每 lane 列数
  const segmentLength = laneLength / 4;           // 每 slice 列数

  const H0 = blake2b(u8concat(
    le32(p), le32(tagLen), le32(m), le32(t), le32(A2_VERSION), le32(type),
    le32(pwd.length), pwd,
    le32(salt.length), salt,
    le32(secret.length), secret,
    le32(ad.length), ad
  ), 64);

  // 内存矩阵：mPrime 块 × 256 uint32
  const mem = new Uint32Array(mPrime * 256);
  for (let lane = 0; lane < p; lane++) {
    bytesToBlock(hprime(1024, u8concat(H0, le32(0), le32(lane))), mem, lane * laneLength * 256);
    bytesToBlock(hprime(1024, u8concat(H0, le32(1), le32(lane))), mem, (lane * laneLength + 1) * 256);
  }

  // 寻址/中间暂存块
  const ZERO = new Uint32Array(256);
  const INPUT = new Uint32Array(256), TMP = new Uint32Array(256), ADDR = new Uint32Array(256);

  for (let pass = 0; pass < t; pass++) {
    for (let slice = 0; slice < 4; slice++) {
      // Argon2i：全程数据无关寻址；Argon2id：仅 pass0 的前两个 slice；Argon2d：全程数据相关
      const dataIndep = (type === 1) || (type === 2 && pass === 0 && slice < 2);
      for (let lane = 0; lane < p; lane++) {
        let counter = 0;
      const genAddr = () => {
        counter++;
        INPUT.fill(0);
        // 地址块输入字段是 64-bit 字（RFC 9106 §3.3）：v[0..6] = pass/lane/slice/m'/t/type/counter，
        // uint32 视图下每字占 lo/hi 两槽，故下标为 2*w
        INPUT[0] = pass; INPUT[2] = lane; INPUT[4] = slice;
        INPUT[6] = mPrime; INPUT[8] = t; INPUT[10] = type; INPUT[12] = counter;
        blockG(ZERO, 0, INPUT, 0, TMP, 0);
        blockG(ZERO, 0, TMP, 0, ADDR, 0);
      };
        if (dataIndep && pass === 0 && slice === 0) genAddr();

        const startCol = (pass === 0 && slice === 0) ? 2 : slice * segmentLength;
        const endCol = (slice + 1) * segmentLength;
        const laneBase = lane * laneLength;

        for (let col = startCol; col < endCol; col++) {
          const idx = col - slice * segmentLength; // 段内 0 基

          let J1, J2;
          if (dataIndep) {
            if (idx % 128 === 0) genAddr();
            const w = idx % 128;
            J1 = ADDR[2 * w]; J2 = ADDR[2 * w + 1];
          } else {
            const prevOff = (laneBase + ((col - 1 + laneLength) % laneLength)) * 256;
            J1 = mem[prevOff]; J2 = mem[prevOff + 1];
          }

          let refLane;
          if (pass === 0 && slice === 0) refLane = lane;
          else refLane = J2 % p;

          let refAreaSize;
          if (pass === 0) {
            if (slice === 0) refAreaSize = idx - 1;
            else if (refLane === lane) refAreaSize = slice * segmentLength + idx - 1;
            else refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
          } else {
            if (refLane === lane) refAreaSize = laneLength - segmentLength + idx - 1;
            else refAreaSize = laneLength - segmentLength - (idx === 0 ? 1 : 0);
          }
          if (refAreaSize < 1) refAreaSize = 1; // 防御（合法路径不会触到 0）

          // 平方映射（RFC §3.4.2）：J1*J1 与 refAreaSize*x 超 53 位，此两步用 BigInt 保精确
          const x = (BigInt(J1) * BigInt(J1)) >> 32n;
          const relPos = BigInt(refAreaSize) - 1n - ((BigInt(refAreaSize) * x) >> 32n);
          const startPos = (pass === 0) ? 0n : ((slice === 3) ? 0n : BigInt((slice + 1) * segmentLength));
          const absPos = Number((startPos + relPos) % BigInt(laneLength));

          const prevOff = (laneBase + ((col - 1 + laneLength) % laneLength)) * 256;
          const refOff = (refLane * laneLength + absPos) * 256;
          const outOff = (laneBase + col) * 256;

          blockG(mem, prevOff, mem, refOff, TMP, 0);
          if (pass === 0) {
            mem.set(TMP, outOff);
          } else {
            // version 0x13：与旧块异或
            for (let i = 0; i < 256; i++) mem[outOff + i] = (mem[outOff + i] ^ TMP[i]) >>> 0;
          }
        }
      }
    }
  }

  // C = 所有 lane 最后一列的异或；tag = H'^tagLen(C)
  const C = new Uint32Array(256);
  for (let lane = 0; lane < p; lane++) {
    const off = (lane * laneLength + laneLength - 1) * 256;
    for (let i = 0; i < 256; i++) C[i] = (C[i] ^ mem[off + i]) >>> 0;
  }
  return hprime(tagLen, blockToBytes(C, 0));
}

// ============================================================
// Tiger / Tiger2（Anderson-Biham 1996，192-bit）
// S-box 逐字提取自 RHash librhash/tiger_sbox.c（与作者参考表一致）。
// ============================================================
const TIGER_SBOX_SRC = [
    "02aab17cf7e90c5eac424b03e243a8ec72cd5be30dd5fcd36d019b93f6f97f3a" +
    "cd9978ffd21f91937573a1c9708029e2b164326b922a83c346883eee04915870" +
    "eaace3057103ece6c54169b808a3535c4ce754918ddec47c0aa2f4dfdc0df40c" +
    "10b76f18a74dbefac6ccb6235ad1ab6a13726121572fe2ff1a488c6f199d921e" +
    "4bc9f9f4da0007ca26f5e6f6e85241c7859079dbea5947b64f1885c5c99e8c92" +
    "d78e761ea96f864b8e36428c52b5c17d69cf6827373063c1b607c93d9bb4c56e" +
    "7d820e760e76b5ea645c9cc6f07fdc42bf38a078243342e05f6b343c9d2e7d04" +
    "f2c28aeb600b0ec66c0ed85f7254bcac71592281a4db4fe51967fa69ce0fed9f" +
    "fd5293f8b96545dbc879e9d7f2a7600b860248920193194ea4f9533b2d9cc0b3" +
    "9053836c15957613db6dcf8afc357bf118beea7a7a370f57037117ca50b99066" +
    "6ab30a9774424a35f4e92f02e325249b7739db07061ccae1d8f3b49ceca42a05" +
    "bd56be3f51382f7345faed5843b0bb281c813d5c11bf1f838af0e4b6d75fa169" +
    "33ee18a487ad99993c26e8eab1c94410b510102bc0a822f9141eef310ce6123b" +
    "fc65b90059ddb154e0158640c5e0e607884e079826c3a3cf930d0d9523c535fd" +
    "35638d754e9a2b004085fccf40469dd5c4b17ad28be23a4ccab2f0fc6a3e6a2e" +
    "2860971a6b943fcd3dde6ee212e304466222f32ae01765ae5d550bb5478308fe" +
    "a9efa98da0eda22ac351a71686c40da71105586d9c867c84dcffee85fda22853" +
    "ccfbd0262c5eef76baf294cb8990d201e69464f52afad97594b013afdf133e14" +
    "06a7d1a32823c9586f95fe5130f61119d92ab34e462c06c0ed7bde33887c71d2" +
    "79746d6e6518393e5ba419385d7133297c1ba6b948a9756431987c197bfdac67" +
    "de6c23c44b053d02581c49fed002d64ddd474d6338261571aa4546c3e473d062" +
    "928fce349455f86048161bbacaab94d963912430770e6f686ec8a5e602c6641c" +
    "87282515337ddd2b2cda6b42034b701bb03d37c181cb096de108438266c71c6f" +
    "2b3180c7eb51b255df92b82f96c08bbc5c68c8c0a632f3ba5504cc861c3d0556" +
    "abbfa4e55fb26b8f41848b0ab3baceb4b334a273aa445d32bca696f0a85ad881" +
    "24f6ec65b528d56c0ce1512e90f4524a4e9dd79d5506d35a258905fac6ce9779" +
    "2019295b3e109b33f8a9478b73a054cc2924f2f934417eb03993357d536d1bc4" +
    "38a81ac21db6ff8b47c4fbf17d6016bf1e0faadd7667e3f57abcff62938beb96" +
    "a78dad948fc179c98f1f98b72911e50d61e48eae27121a914d62f7ad31859808" +
    "eceba345ef5ceaebf5ceb25ebc9684cef633e20cb7f76221a32cdf06ab8293e4" +
    "985a202ca5ee2ca4cf0b8447cc8a8fb19f765244979859a3a8d516b1a1240017" +
    "0bd7ba3ebb5dc726e54bca55b86adb391d7a3afd6c478063519ec608e7669edd" +
    "0e5715a2d149aa23177d4571848ff194eeb55f3241014c220f5e5ca13a6e2ec2" +
    "8029927b75f5c361ad139fabc3d6e4360d5df1a94ccf402f3e8bd948bea5dfc8" +
    "a5a0d357bd3ff77ea2d12e251f74f64566fd9e525e81a0822e0c90ce7f687a49" +
    "c2e8bcbeba973bc5000001bce509745f423777bbe6dab3d6d1661c7eaef06eb5" +
    "a1781f354daacfd82d11284a2b16affcf1fc4f67fa891d1f73ecc25dcb920ada" +
    "ae610c22c2a1265196e0a810d356b78a5a9a381f2fe7870fd5ad62ede94e5530" +
    "d225e5e8368d142765977b70c7af463199f889b2de39d74f233f30bf54e1d143" +
    "9a9675d3d9a63c975470554ff334f9a8166acb744a4f568870c74caab2e4aead" +
    "f0d091646f294d1257b82a89684031d1efd95a5a61be0b6b2fbd12e969f2f29a" +
    "9bd37013feff9fe83f9b0404d6085a064940c1f3166cfe1509542c4dcdf3defb" +
    "b4c5218385cd5ce3c935b7dc4462a6413417f8a68ed3b63fb80959295b215b40" +
    "f99cdaef3b8c8572018c0614f8fcb95d1b14accd1a3acdf384d471f200bb732d" +
    "c1a3110e95e8da16430a7220bf1a82b8b77e090d39df210e5ef4bd9f3cd05e9d" +
    "9d4ff6da7e57a444da1d60e183d4a5f8b287c38417998e47fe3edc121bb31886" +
    "c7fe3ccc980ccbefe46fb590189bfd033732fd469a4c57dc7ef700a07cf1ad65" +
    "59c64468a31d8859762fb0b4d45b61f6155baed09904771868755e4c3d50baa6" +
    "e9214e7f22d8b4df2addbf532eac95f432ae3909b4bd0109834df537b08e3450" +
    "fa209da84220728d9e691d9b9efe23f70446d288c4ae8d7f7b4cc524e169785b" +
    "21d87f0135ca1385cebb400f137b8aa5272e2b66580796be3612264125c2b0de" +
    "057702bdad1efbb2d4babb8eacf84be991583139641bc67b8bdc2de08036e024" +
    "603c8156f49f68edf7d236f7dbef51119727c4598ad21e80a08a0896670a5fd7" +
    "cb4a8f4309eba9cb81af564b0f7036a1c0b99aa778199abd959f1ec83fc8e952" +
    "8c505077794a81b93acaaf8f056338f007b43f50627a67784a44ab49f5eccc77" +
    "3bc3d6e4b679ee989cc0d4d1cf14108c4406c00b206bc8a082a18854c8d72d89" +
    "67e366b35c3c432cb923dd61102b37f256ab2779d884271dbe83e1b0ff1525af" +
    "fb7c65d4217e49a96bdbe0e76d48e7d408df828745d9179e22ea6a9add53bd34" +
    "e36e141c5622200a7f805d1b8cb750eeafe5c7a59f58e837e27f996a4fb1c23c" +
    "d3867dfb0775f0d0d0e673de6e88891a123aeb9eafb86c2530f1d5d5c145b895" +
    "bb434a2dee7269e778cb67ecf931fa38f33b0372323bbf9c52d66336fb279c74" +
    "505f33ac0afb4eaae8a5cd99a2cce187534974801e2d30bb8d2d5711d5876d90" +
    "1f1a412891bc038ed6e2e71d82e5664874036c3a497732b789b67ed96361f5ab" +
    "ffed95d8f1ea02a2e72b3bd61464d43da6300f170bdc4820ebc18760ed78a77a",

    "e6a6be5a05a12138b5a122a5b4f87c98563c6089140b69904c46cb2e391f5dd5" +
    "d932addbc9b7943408ea70e42015aff5d765a6673e478cf1c4fb757eab278d99" +
    "df11c6862d6e0692ddeb84f10d7f3b166f2ef604a665ea044a8e0f0ff0e0dfb3" +
    "a5edeef83dbcba51fc4f0a2a0ea4371ee83e1da85cb38429dc8ff882ba1b1ce2" +
    "cd45505e8353e80d18d19a00d4db071734a0cfeda5f381010be77e518887caf2" +
    "1e341438b3c45136e05797f49089ccf9ffd23f9df2591d14543dda228595c5cd" +
    "661f81fd99052a338736e641db0f7b7615227725418e5307e25f7f46162eb2fa" +
    "48a8b2126c13d9feafdc541792e76eea03d912bfc6d1898f31b1aafa1b83f51b" +
    "f1ac2796e42ab7d940a3a7d7fcd2ebac1056136d0afbbcc57889e1dd9a6d0c85" +
    "d33525782a7974aaa7e25d09078ac09bbd4138b3eac6edd0920abfbe71eb9e70" +
    "a2a5d0f54fc2625cc054e36b0b1290a3f6dd59ff62fe932b3537354511a8ac7d" +
    "ca845e9172fadcd484f82b60329d20dc79c62ce1cd672f188b09a2add124642c" +
    "d0c1e96a19d9e7265a786a9b4ba9500c0e020336634c43f3c17b474aeb66d822" +
    "6a731ae3ec9baac28226667ae084025867d4567691caeca51d94155c4875adb5" +
    "6d00fd985b813fdf51286efcb774cd065e8834471fa744aff72ca0aee761ae2e" +
    "be40e4cdaee8e09ae9970bbb5118f665726e4beb33df1964703b000729199762" +
    "4631d816f5ef30a7b880b5b51504a6be641793c37ed84b6c7b21ed77f6e97d96" +
    "776306312ef96b73ae528948e86ff3f453dbd7f286a3f8f816cadce74cfc1063" +
    "005c19bdfa52c6dd68868f5d64d46ad33a9d512ccf1e186a367e62c2385660ae" +
    "e359e7ea77dcb1d7526c0773749abe6e735ae5f9d09f734b493fc7cc8a558ba8" +
    "b0b9c1533041ab45321958ba470a59bd852db00b5f46c39391209b2bd336b0e5" +
    "6e604f7d659ef19fb99a8ae2782ccb24ccf52ab6c814c4c74727d9afbe11727b" +
    "7e950d0c0121b34d756f435670ad471ff5add442615a68494e87e09980b9957a" +
    "2acfa1df50aee355d898263afd2fd556c8f4924dd80c8fd6cf99ca3d754a173a" +
    "fe477bacaf91bf3ced5371f6d690c12d831a5c285e687094c5d3c90a3708a0a4" +
    "0f7f903717d0658019f9bb13b8fdf27fb1bd6f1b4d5028431c761ba38fff4012" +
    "0d1530c4e2e21f3b8943ce69a7372c8ae5184e11feb5ce66618bdb80bd736621" +
    "7d29bad68b574d0b81bb613e25e6fe5b071c9c10bc07913fc7beeb7909ac2d97" +
    "c3e58d353bc5d757eb017892f38f61e8d4effb9c9b1cc21a99727d26f494f7ab" +
    "a3e063a2956b3e039d4a8b9a4aa09c303f6ab7d500090fb49cc0f2a057268ac0" +
    "3dee9d2dedbf42d1330f49c87960a972c6b2720287421b410ac59ec07c00369c" +
    "ef4eac49cb353425f450244eef0129d88acc46e5caf4deb62ffeab63989263f7" +
    "8f7cb9fe5d7a45785bd8f7644e634635427a7315bf2dc90017d0c4aa2125261c" +
    "3992486c93518e50b4cbfee0a2d7d4c37c75d6202c5ddd8ddbc295d8e35b6c61" +
    "60b369d302032b19ce42685fdce4413206f3ddb9ddf656108ea4d21db5e148f0" +
    "20b0fce62fcd496f2c1b912358b0ee31b28317b818f5a308a89c1e189ca6d2cf" +
    "0c6b18576aaadbc8b65deaa91299fae3fb2b794b7f1027e704e4317f443b5beb" +
    "4b852d325939d0a6d5ae6beefb207ffc309682b281c7d374bae309a194c3b475" +
    "8cc3f97b13b49f0598a9422ff8293967244b16b01076ff7cf8bf571c663d67ee" +
    "1f0d6758eee30da1c9b611d97adeb9b7b7afd5887b6c57a26290ae846b984fe1" +
    "94df4cdeacc1a5fd058a5bd1c5483aff63166cc142ba3c378db8526eb2f76f40" +
    "e10880036f0d6d4e9e0523c9971d311d45ec2824cc7cd691575b8359e62382c9" +
    "fa9e400dc4889995d1823ecb45721568dafd983b8206082faa7d29082386a8cb" +
    "269fcd4403b875881b91f5f728bdd1e0e4669f39040201f67a1d7c218cf04ade" +
    "65623c29d79ce5ce2368449096c00bb1ab9bf1879da503babc23ecb1a458058e" +
    "9a58df01bb401ecca070e868a85f143d4ff188307df2239e14d565b41a641183" +
    "ee13337452701602950e3dcf3f285e0959930254b9c809533bf299408930da6d" +
    "a955943f53691387a15edecaa9cb878429142127352be9a076f0371fff4e7afb" +
    "0239f450274f2228bb073af01d5e868bbfc80571c10e96c1d267088568222e23" +
    "9671a3d48e80b5b055b5d38ae193bb81693ae2d0a18b04b85c48b4ecadd5335f" +
    "fd743b194916a1ca2577018134be98c4e77987e83c54a4ad28e11014da33e1b9" +
    "270cc59e226aa21371495f756d1a5f609be853fb60afef77adc786a7f7443dbf" +
    "0904456173b29a8258bc7a66c232bd5ef306558c673ac8b241f639c6b6c9772a" +
    "216defe99fda35da11640cc71c7be61593c43694565c5527ea038e6246777839" +
    "f9abf3ce5a3e2469741e768d0fd312d20144b883ced652c6c20b5a5ba33f8552" +
    "1ae69633c3435a9d97a28ca4088cfdec8824a43c1e96f42037612fa66eeea746" +
    "6b4cb165f9cf0e5a43aa1c06a0abfb4a7f4dc26ff162796b6cbacc8e54ed9b0f" +
    "a6b7ffefd2bb253e2e25bc95b0a29d4f86d6a58bdef1388cded74ac576b6f054" +
    "8030bdbc2b45805d3c81af70e94d92893eff6dda9e3100dbb38dc39fdfcc8847" +
    "123885528d17b87ef2da0ed240b1b64244cefadcd54bf9a91312200e433c7ee6" +
    "9ffcc84f3a78c748f0cd1f72248576bbec6974053638cfe42ba7b67c0cec4e4c" +
    "ac2f4df3e5ce32edcb33d14326ea4c11a4e9044cc77e58bc5f513293d934fcef" +
    "5dc9645506e5544450de418f317de40a388cb31a69dde2592db4a83455820a86" +
    "9010a91e84711ae94df7f0b7b1498371d62a2eabc097717922fac097aa8d5c0e",

    "f49fcc2ff1daf39b487fd5c66ff29281e8a30667fcdca83f2c9b4be3d2fcce63" +
    "da3ff74b93fbbbc22fa165d2fe70ba66a103e279970e93d4becdec77b0e45e71" +
    "cfb41e723985e497b70aaa025ef75017d42309f03840b8e08efc1ad035898579" +
    "96c6920be2b2abc566af4163375a91722174abdcca7127fbb33ccea64a72ff41" +
    "f04a4933083066a58d970acdd7289af58f96e8e031c8c25ef3fec02276875d47" +
    "ec7bf310056190ddf5adb0aebb0f14919b50f8850fd588924975488358b74de8" +
    "a3354ff691531c610702bbe481d2c6ee89fb24057deded98ac3075138596e902" +
    "1d2d3580172772edeb738fc28e6bc30d5854ef8f630443269e5c52325add3bbe" +
    "90aa53cf325c4623c1d24d51349dd0672051cfeea69ea62413220f0a862e7e4f" +
    "ce39399404e04864d9c42ca47086fcb7685ad2238a03e7cc066484b2ab2ff1db" +
    "fe9d5d70efbf79ec5b13b9dd9c48185415f0d475ed1509ad0bebcd060ec79851" +
    "d58c6791183ab7f8d1187c5052f3eee4c95d1192e54e82ff86eea14cb9ac6ca2" +
    "3485beb153677d5ddd191d781f8c492af60866baa784ebf9518f643ba2d08c74" +
    "8852e956e1087c22a768cb8dc410ae8d38047726bfec8e1aa67738b4cd3b45aa" +
    "ad16691cec0dde19c6d4319380462e07c5a5876d0ba6193816b9fa1fa58fd840" +
    "188ab1173ca74f18abda2f98c99c021f3e0580ab134ae8165f3b05b773645abb" +
    "2501a2be5575f2f61b2f74004e7e8ba91cd7580371e8d9537f6ed89562764e30" +
    "b15926ff596f003d9f65293da8c5d6b96ecef04dd690f84c4782275fff33af88" +
    "e41433083f820801fd0dfe409a1af9b54325a3342cdb396b8ae77e62b301b252" +
    "c36f9e9f6655615a85455a2d92d32c09f2c7dea94947748563cfb4c133a39eba" +
    "83b040cc6ebc54623b9454c8fdb326b056f56a9e87ffd78c2dc2940d99f42bc6" +
    "98f7df096b096e2d19a6e01e3ad852bf42a99ccbdbd4b40ba59998af45e9c559" +
    "366295e807d931866b48181bfaa1f7731fec57e2157a0a1d4667446af6201ad5" +
    "e615ebcacfb0f075b8f31f4f6829077822713ed6ce22d11e3057c1a72ec3c93b" +
    "cb46acc37c3f1f2fdbb893fd02aaf50e331fd92e600b9fcfa498f96148ea3ad6" +
    "a8d8426e8b6a83eaa089b274b7735cdc87f6b3731e524a11118808e5cbc96749" +
    "9906e4c7b19bd394afed7f7e9b24a20c6509eadeeb3644a76c1ef1d3e8ef0ede" +
    "b9c97d43e9798fb4a2f2d784740c28a37b8496476197566f7a5be3e6b65f069d" +
    "f96330ed78be6f10eee60de77a076a152b4bee4aa08b9bd06a56a63ec7b8894e" +
    "02121359ba34fef44cbf99f8283703fc398071350caf30c8d0a77a89f017687a" +
    "f1c1a9eb9e4235698c7976282dee81995d1737a5dd1f7abd4f53433c09a9fa80" +
    "fa8b0c53df7ca1d93fd9dcbc886ccb77c040917ca91b47207dd00142f9d1dcdf" +
    "8476fc1d4f387b5823f8e7c5f3316503032a2244e7e373395c87a5d750f5a74b" +
    "082b4cc43698992edf917becb858f63c3270b8fc5bf86dda10ae72bb29b5dd76" +
    "576ac94e7700362b1ad112dac61efb8f691bc30ec5faa427ff246311cc327143" +
    "3142368e30e5320671380e31e02ca396958d5c960aad76f1f8d6f430c16da536" +
    "c8ffd13f1be7e1d27578ae66004ddbe105833f01067be646bb34b5ad3bfe586d" +
    "095f34c9a12b97f0247ab64525d60ca8dcdbc6f3017477d14a2e14d4decad24d" +
    "bdb5e6d9be0a1eeb2a7e70f7794301abdef42d8a270540fd01078ec0a34c22c1" +
    "e5de511af4c163877ebb3a52bd9a330a77697857aa7d6435004e831603ae4c32" +
    "e7a21020ad78e3129d41a70c6ab420f228e06c18ea1141e6d2b28cbd984f6b28" +
    "26b75f6c446e9d83ba47568c4d418d7fd80badbfe6183d8e0e206d7f5f166044" +
    "e258a43911cbca3e723a1746b21dc0bcc7caa854f5d7cdd37cac32883d261d9c" +
    "7690c26423ba942c17e55524478042b8e0be477656a2389f4d289b5e67ab2da0" +
    "44862b9c8fbbfd31b47cc8049d141365822c1b362b91c7934eb14655fb13dfd8" +
    "1ecbba0714e2a97b6143459d5cde5f1453a8fbf1d5f0ac8997ea04d81c5e5b00" +
    "622181a8d4fdb3f3e9bcd341572a12081411258643cce58a9144c5fea4c6e0a4" +
    "0d33d06565cf620f54a48d489f219ca1c43e5eac6d63c821a9728b3a72770daf" +
    "d7934e7b20df87efe35503b61a3e86e5cae321fbc819d504129a50b3ac60bfa6" +
    "cd5e68ea7e9fb6c3b01c90199483b1c73de93cd5c295376caed52edf2ab9ad13" +
    "2e60f512c0a07884bc3d86a3e36210c935269d9b163951ce0c7d6e2ad0cdb5fa" +
    "59e86297d87f5733298ef221898db0e755000029d1a5aa7e8bc08ae1b5061b45" +
    "c2c31c2b6c92703a94cc596baf25ef420a1d73db2254045604b6a0f9d9c4179a" +
    "effdafa2ae3d3c60f7c8075bb49496c49cc5c7141d1cd4e378bd1638218e5534" +
    "b2f11568f850246aedfabcfa9502bc29796ce5f2da23051baae128b0dc93537c" +
    "3a493da0ee4b29aeb5df6b2c416895d7fcabbd25122d7f3770810b58105dc4b1" +
    "e10fdd37f7882a90524dcab5518a3f5c3c9e85878451255b4029828119bd34e2" +
    "74a05b6f5d3ceccbb610021542e13eca0ff979d12f59e2ac6037da27e4f9cc50" +
    "5e92975a0df1847dd66de190d3e623fe5032d6b87b5680489a36b7ce8235216e" +
    "80272a7a24f64b4a93efed8b8c6916f737ddbff44cce15554b95db5d4b99bd25" +
    "92d3fda169812fc0fb1a4a9a90660bb6730c196946a4b9b281e289aa7f49da68" +
    "64669a0f83b1a05f27b3ff7d9644f48bcc6b615c8db675b3674f20b9bcebbe95" +
    "6f312382756559825ae488713e45cf05bf619f9954c21157eabac46040a8eae9" +
    "454c6fe9f2c0c1cd419cf6496412691cd3dc3bef265b0f706d0e60f5c3578a9e",

    "5b0e608526323c551a46c1a9fa1b59f5a9e245a17c4c8ffa65ca5159db2955d7" +
    "05db0a76ce35afc281eac77ea9113d45528ef88ab6ac0a0da09ea253597be3ff" +
    "430ddfb3ac48cd56c4b3a67af45ce46f4ececfd8fbe2d05e3ef56f10b39935f0" +
    "0b22d6829cd619c617fd460a74df20696cf8cc8e8510ed40d6c824bf3a6ecaa7" +
    "61243d581a817049048bacb6bbc163a2d9a38ac27d44cc327fddff5baaf410ab" +
    "ad6d495aa804824be1a6a74f2d8c9f94d4f7851235dee8e3fd4b7f886540d893" +
    "247c20042aa4bfda096ea1c517d1327cd56966b4361a6685277da5c31221057d" +
    "94d59893a43acff764f0c51ccdc022813d33bcc4ff6189dbe005cb184ce66af1" +
    "ff5ccd1d1db99beab0b854a7fe42980f7bd46a6a718d4b9fd10fa8cc22a5fd8c" +
    "d31484952be4bd31c7fa975fcb2438474886ed1e5846c40728cddb791eb70b04" +
    "c2b00be2f573417f5c9590452180f8777a6bddfff370eb00ce509e38d6d9d6a4" +
    "ebeb0f00647fa7021dcc06cf76606f06e4d9f28ba286ff0ad85a305dc918c262" +
    "475b1d8732225f542d4fb51668ccb5fea679b9d9d72bba2053841c0d912d43a5" +
    "3b7eaa48bf12a4e8781e0e47f22f1ddfeff20ce60ab5097320d261d19dffb742" +
    "16a12b03062a2e391960eb2239650495251c16fed50eb8b89ac0c330f826016e" +
    "ed152665953e767102d63194a63695705074f08394b1c98770ba598c90b25ce1" +
    "794a15810b9742f60d5925e9fcaf8c6c3067716cd868744e910ab077e8d7731b" +
    "6a61bbdb5ac42f6193513efbf0851567f494724b9e83e9d5e887e1985c09648d" +
    "34b1d3c675370cfddc35e433bc0d255dd0aab84234131be008042a50b48b7eaf" +
    "9997c4ee44a3ab35829a7b49201799d0263b8307b7c54441752f95f4fd6a6ca6" +
    "927217402c08c6e52a8ab754a795d9eea442f7552f72943d2c31334e19781208" +
    "4fa98d7ceaee629155c3862f665db309bd0610175d53b1f346fe6cb840413f27" +
    "3fe03792df0cfa59cfe700372eb85e8fa7be29e7adbce118e544ee5cde8431dd" +
    "8a781b1b41f1873ea5c94c78a0d2f0e739412e2877b60728a1265ef3afc9a62c" +
    "bcc2770c6a2506c53ab66dd5dce1ce12e65499d04a675b377d8f523481bfd216" +
    "0f6f64fcec15f38974efbe618b5b13c8acdc82b714273e1ddd40bfe003199d17" +
    "37e99257e7e061f8fa52626904775aaa8bbbf63a463d56f9f0013f1543a26e64" +
    "a8307e9f879ec898cc4c27a4150177cc1b432f2cca1d3348de1d1f8f9f6fa013" +
    "606602a047a7ddd6d237ab64cc1cb2c79b938e7225fcd1d3ec4e03708e0ff476" +
    "feb2fbda3d03c12dae0bced2ee43889a22cb8923ebfb4f4369360d013cf7396d" +
    "855e3602d2d4e022073805bad01f784c33e17a133852f546df4874058ac7b638" +
    "ba92b29c678aa14a0ce89fc76cfaadcd5f9d4e0908339e34f1afe9291f5923b9" +
    "6e3480f60f4a265feebf3a2ab29b841ce21938a88f91b4ad57dfeff845c6d3c3" +
    "2f006b0bf62caaf262f479ef6f75ee7811a55ad41c8916a9f229d29084fed453" +
    "42f1c27b16b000e62b1f76749823c0744b76eca3c27453608c98f463b91691bd" +
    "14bcc93cf1ade66a8885213e6d4583978e177df0274d4711b49b73b5503f2951" +
    "10168168c3f96b6b0e3d963b63cab0ae8dfc4b5655a1db14f789f1356e14de5c" +
    "683e68af4e51dac1c9a84f9d8d4b0fd93691e03f52a0f9d15ed86e46e1878e80" +
    "3c711a0e99d071505a0865b20c4e931056fbfc1fe4f0682eea8d5de3105edf9b" +
    "71abfdb12379187a2eb99de1bee77b9c21ecc0ea33cf452359a4d7521805c7a1" +
    "3896f5eb56ae7c72aa638f3db18f75dc9f39358dabe9808eb7defa91c00b72ac" +
    "6b5541fd62492d926dc6dee8f92e4d5b353f57abc4beea7e735769d6da5690ce" +
    "0a234aa642391484f6f9508028f80d9db8e319a27ab3f21531ad9c1151341a4d" +
    "773c22a57bef580545c7561a07968633f913da9e249dbe36da652d9b78a64c68" +
    "4c27a97f3bc334ef76621220e66b17f4967743899acd7d0bf3ee5bcae0ed6782" +
    "409f753600c879fc06d09a39b5926db66f83aeb0317ac58801e6ca4a86381f21" +
    "66ff3462d19f302572207c24ddfd3bfb4af6b6d3e2ece2eb9c994dbec7ea08de" +
    "49ace597b09a8bc4b38c4766cf0797ba131b9373c57c2a75b1822cce61931e58" +
    "9d7555b909ba1c0c127fafdd937d11d229da3badc66d92e4a2c1d57154c2ecbc" +
    "58c5134d82f6fe241c3ae3515b62274fe907c82e01cb8126f8ed091913e37fcb" +
    "3249d8f9c80046c980cf9bede388fb631881539a116cf19e5103f3f76bd52457" +
    "15b7e6f5ae47f7a8dbd7c6ded47e9ccf44e55c410228bb1ab647d4255edb4e99" +
    "5d11882bb8aafc30f5098bbb29d3212a8fb5ea14e90296b3677b942157dd025a" +
    "fb58e7c0a390acb589d3674c83bd4a019e2da4df4bf3b93bfcc41e328cab4829" +
    "03f38c96ba582c52cad1bdbd7fd85db2bbb442c16082ae83b95fe86ba5da9ab0" +
    "b22e04673771a93f845358c9493152d8be2a488697b4541e95a2dc2dd38e6966" +
    "c02c11ac923c852b2388b1990df2a87b7c8008fa1b4f37be1f70d0c84d54e503" +
    "5490adec7ece57d4002b3c27d9063a3a7eaea3848030a2bfc602326ded2003c0" +
    "83a7287d69a94086c57a5fcb30f57a8ab56844e479ebe779a373b40f05dcbce9" +
    "d71a786e88570ee2879cbacdbde8f6a0976ad1bcc164a32fab21e25e9666d78b" +
    "901063aae5e5c33c9818b34448698d90e36487ae3e1e8abbafbdf931893bdcb4" +
    "6345a0dc5fbbd5198628fe269b9465ca1e5d01603f9c51ec4de44006a15049b7" +
    "bf6c70e5f776cbb1411218f2ef552bedcb0c0708705a36a3e74d14754f986044" +
    "cd56d9430ea8280ec12591d7535f5065c83223f1720aef96c3a0396f7363a51f"
  ];

function parseHexWords(src) {
  const n = src.length / 16;
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = BigInt("0x" + src.slice(i * 16, i * 16 + 16));
  return out;
}
const TIGER_T = TIGER_SBOX_SRC.map(parseHexWords); // [t1,t2,t3,t4] 各 256×BigInt

const TG_M64 = (1n << 64n) - 1n;
const TG_IV = [0x0123456789ABCDEFn, 0xFEDCBA9876543210n, 0xF096A5B4C3B2E187n];
// Tiger2 与 Tiger 同 IV，仅填充字节不同（0x80 vs 0x01）——作者官网明确「differs only by the padding method」

function tgRound(st, iA, iB, iC, x, mul, t1, t2, t3, t4) {
  const c = (st[iC] ^ x) & TG_M64;
  st[iC] = c;
  st[iA] = (st[iA] -
    (t1[Number(c & 0xffn)] ^
     t2[Number((c >> 16n) & 0xffn)] ^
     t3[Number((c >> 32n) & 0xffn)] ^
     t4[Number((c >> 48n) & 0xffn)])) & TG_M64;
  st[iB] = (((st[iB] +
    (t4[Number((c >> 8n) & 0xffn)] ^
     t3[Number((c >> 24n) & 0xffn)] ^
     t2[Number((c >> 40n) & 0xffn)] ^
     t1[Number((c >> 56n) & 0xffn)])) & TG_M64) * mul) & TG_M64;
}

function tgKeySchedule(x) {
  x[0] = (x[0] - (x[7] ^ 0xA5A5A5A5A5A5A5A5n)) & TG_M64;
  x[1] = (x[1] ^ x[0]) & TG_M64;
  x[2] = (x[2] + x[1]) & TG_M64;
  x[3] = (x[3] - (x[2] ^ (((~x[1]) & TG_M64) << 19n))) & TG_M64;
  x[4] = (x[4] ^ x[3]) & TG_M64;
  x[5] = (x[5] + x[4]) & TG_M64;
  x[6] = (x[6] - (x[5] ^ (((~x[4]) & TG_M64) >> 23n))) & TG_M64;
  x[7] = (x[7] ^ x[6]) & TG_M64;
  x[0] = (x[0] + x[7]) & TG_M64;
  x[1] = (x[1] - (x[0] ^ (((~x[7]) & TG_M64) << 19n))) & TG_M64;
  x[2] = (x[2] ^ x[1]) & TG_M64;
  x[3] = (x[3] + x[2]) & TG_M64;
  x[4] = (x[4] - (x[3] ^ (((~x[2]) & TG_M64) >> 23n))) & TG_M64;
  x[5] = (x[5] ^ x[4]) & TG_M64;
  x[6] = (x[6] + x[5]) & TG_M64;
  x[7] = (x[7] - (x[6] ^ 0x0123456789ABCDEFn)) & TG_M64;
}

function tgCompress(state, block8) {
  const t1 = TIGER_T[0], t2 = TIGER_T[1], t3 = TIGER_T[2], t4 = TIGER_T[3];
  const st = [state[0], state[1], state[2]];
  const aa = st[0], bb = st[1], cc = st[2];
  const x = block8.slice();
  // pass 角色序列（照 libgcrypt/RHash 参考结构逐字核对）：
  // 宏内每轮 (a,b,c)→(b,c,a)→(c,a,b) 轮转，pass2/pass3 以 (c,a,b)/(b,c,a) 起头代入后，
  // 三个 pass 的实际序列并非简单旋转对称，需逐 pass 写死（第 2 轮恒为 (a,b,c)）。
  const PASS_SEQ = [
    [[0, 1, 2], [1, 2, 0], [2, 0, 1]],
    [[2, 0, 1], [0, 1, 2], [1, 2, 0]],
    [[1, 2, 0], [2, 0, 1], [0, 1, 2]],
  ];
  for (let k = 0; k < 3; k++) {
    const mul = [5n, 7n, 9n][k];
    for (let i = 0; i < 8; i++) {
      const [iA, iB, iC] = PASS_SEQ[k][i % 3];
      tgRound(st, iA, iB, iC, x[i], mul, t1, t2, t3, t4);
    }
    if (k < 2) tgKeySchedule(x);
  }
  // feedforward
  st[0] = (st[0] ^ aa) & TG_M64;
  st[1] = (st[1] - bb) & TG_M64;
  st[2] = (st[2] + cc) & TG_M64;
  state[0] = st[0]; state[1] = st[1]; state[2] = st[2];
}

/** Tiger/Tiger2 哈希。tiger2=true 时填充 0x80（MD5/SHA 式），否则 0x01（Tiger 原版）。 */
function tigerHash(bytes, tiger2) {
  const state = TG_IV.slice();
  const bitLen = BigInt(bytes.length) * 8n;
  let off = 0;
  const block = new Uint8Array(64);
  const loadWords = () => {
    const w = new Array(8);
    for (let i = 0; i < 8; i++) {
      let v = 0n;
      for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(block[i * 8 + j]);
      w[i] = v;
    }
    return w;
  };
  while (bytes.length - off >= 64) {
    block.set(bytes.subarray(off, off + 64));
    tgCompress(state, loadWords());
    off += 64;
  }
  // 填充：0x01（Tiger）/0x80（Tiger2）+ 0 + 64-bit 大端位长
  const rem = bytes.length - off;
  block.fill(0);
  block.set(bytes.subarray(off, off + rem));
  const padByte = tiger2 ? 0x80 : 0x01;
  if (rem >= 56) { block[rem] = padByte; tgCompress(state, loadWords()); block.fill(0); }
  else { block[rem] = padByte; }
  // 位长：64-bit 小端（Tiger 系特殊性：消息词小端装载 + 长度小端追加，libgcrypt buf_put_le32 同款）
  for (let i = 0; i < 8; i++) block[56 + i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  tgCompress(state, loadWords());
  // 输出：三字「小端字节序」序列化（NESSIE/参考实现口径：状态按内存 LE 字节直出），48 hex
  let hex = "";
  for (let i = 0; i < 3; i++) {
    const w16 = state[i].toString(16).padStart(16, "0");
    for (let j = 7; j >= 0; j--) hex += w16.slice(j * 2, j * 2 + 2);
  }
  return hex;
}

// ============================================================
// Kupyna（乌克兰 DSTU 7564:2014，256/384/512）
// T0..T7 复合表（SubBytes+MixColumns+位移）逐字提取自 li0ard/kupyna（MIT，
// DSTU 官方向量全通过）；状态 BigUint64Array 小端，直接移植其轮结构。
// ============================================================
const KUPYNA_T_SRC = [
    "a832a829d77f9aa84352432297d411435f3e5fc2df80615f061e063014121806" +
    "6bda6b7f670cb16b75bc758f2356c9756cc16c477519ad6c592059f2cb927959" +
    "71a871af3b4ad971df84dfb6f8275bdf87a1874c35b2268795fb95dc59cc6e95" +
    "174b17b872655c17f017f0d31aeae7f0d89fd88eea3247d8092d0948363f2409" +
    "6dc46d4f731ea96df318f3cb10e3ebf31d691de84e53741dcbc0cb16804b0bcb" +
    "c9cac9068c4503c94d644d52b3fe294d2c9c2c7de8c4b02caf29af11c56a86af" +
    "798079ef0b72f979e047e0537a9aa7e097f197cc55c26697fd2efdbb34c9d3fd" +
    "6fce6f5f7f10a16f4b7a4b62a7ec314b454c451283c6094539dd39d596afe439" +
    "3ec63eed84baf83edd8edda6f42953dda315a371ed4eb6a34f6e4f42bff0214f" +
    "b45eb4c99f2beab4b654b6d99325e2b69ac89aa47be1529a0e360e70242a380e" +
    "1f631ff8425d7c1fbf79bf91a51ac6bf154115a87e6b5415e142e15b7c9da3e1" +
    "49704972abe23949d2bdd2ded6046fd293e593ec4dde7693c6f9c67eae683fc6" +
    "92e092e44bd9729272a772b73143d5729edc9e8463fd429e61f8612f5b3a9961" +
    "d1b2d1c6dc0d63d163f2633f57349163fa35fa8326dccffaee71ee235eb09fee" +
    "f403f4f302f6f7f4197d19c8564f6419d5a6d5e6c41173d5ad23ad01c9648ead" +
    "582558facd957d58a40ea449ff5baaa4bb6dbbb1bd06d6bba11fa161e140bea1" +
    "dc8bdcaef22e57dcf21df2c316e4eff283b5836c2dae368337eb37a5b285dc37" +
    "4257422a91d31542e453e4736286b7e47a8f7af7017bf57a32fa328dac9ec832" +
    "9cd69c946ff34a9cccdbcc2e925e17ccab3dab31dd7696ab4a7f4a6aa1eb354a" +
    "8f898f0c058a068f6ecb6e577917a56e04140420181c100427bb2725d2f59c27" +
    "2e962e6de4cab82ee75ce76b688fbbe7e24de2437694afe25a2f5aeac19b755a" +
    "96f496c453c56296164e16b07462581623af2305cae98c232b872b45fad1ac2b" +
    "c2edc25eb6742fc265ec650f4326896566e36617492f85660f330f78222d3c0f" +
    "bc76bc89af13cabca937a921d1789ea9474647028fc80147415841329bda1941" +
    "34e434bdb88cd0344875487aade53d48fc2bfcb332ced7fcb751b7d19522e6b7" +
    "6adf6a77610bb56a88928834179f1a88a50ba541f95caea5530253a2f7a45153" +
    "86a4864433b52286f93af99b2cd5c3f95b2a5be2c79c715bdb90db96e03b4bdb" +
    "38d838dd90a8e0387b8a7bff077cf17bc3e8c356b0732bc31e661ef0445a781e" +
    "22aa220dccee882233ff3385aa99cc3324b4243dd8fc90242888285df0d8a028" +
    "36ee36adb482d836c7fcc776a86f3bc7b240b2f98b39f2b23bd73bc59aa1ec3b" +
    "8e8c8e04038d028e77b6779f2f58c177ba68bab9bb01d2baf506f5fb04f1f3f5" +
    "144414a0786c50149fd99f8c65fa469f0828084030382008551c5592e3b64955" +
    "9bcd9bac7de6569b4c614c5ab5f92d4cfe21fea33ec0dffe60fd60275d3d9d60" +
    "5c315cdad5896d5cda95da9ee63c4fda187818c0504860184643460a89cf0546" +
    "cddecd26945913cd7d947dcf136ee97d21a52115c6e78421b04ab0e98737fab0" +
    "3fc33fe582bdfc3f1b771bd85a416c1b8997893c11981e89ff24ffab38c7dbff" +
    "eb60eb0b40ab8beb84ae84543fbb2a8469d0696f6b02b9693ad23acd9ca6e83a" +
    "9dd39d9c69f44e9dd7acd7f6c81f7bd7d3b8d3d6d0036bd370ad70a73d4ddd70" +
    "67e6671f4f288167405d403a9ddd1d40b55bb5c1992ceeb5de81debefe205fde" +
    "5d345dd2d38e695d30f0309da090c03091ef91fc41d07e91b14fb1e18130feb1" +
    "788578e70d75fd7811551188667744110105010806070401e556e57b6481b3e5" +
    "000000000000000068d568676d05bd6898c298b477ef5a98a01aa069e747baa0" +
    "c5f6c566a46133c5020a02100c0e0802a604a659f355a2a674b974872551cd74" +
    "2d992d75eec3b42d0b270b583a312c0ba210a279eb49b2a276b37697295fc576" +
    "b345b3f18d3ef6b3be7cbe99a31dc2beced1ce3e9e501fcebd73bd81a914cebd" +
    "ae2cae19c36d82aee96ae91b4ca583e98a988a241b91128a31f53195a697c431" +
    "1c6c1ce04854701cec7bec3352be97ecf112f1db1cede3f199c799bc71e85e99" +
    "94fe94d45fcb6a94aa38aa39db7192aaf609f6e30ef8fff626be262dd4f29826" +
    "2f932f65e2cdbc2fef74ef2b58b79befe86fe8134aa287e88c868c140f830a8c" +
    "35e135b5be8bd435030f03180a090c03d4a3d4eec21677d47f9e7fdf1f60e17f" +
    "fb30fb8b20dbcbfb051105281e1b1405c1e2c146bc7d23c15e3b5ecad987655e" +
    "90ea90f447d77a9020a0201dc0e080203dc93df58eb3f43d82b082642ba93282" +
    "f70cf7eb08fffbf7ea65ea0346ac8fea0a220a503c36280a0d390d682e23340d" +
    "7e9b7ed71967e57ef83ff8932ad2c7f8500d50bafdad5d501a721ad05c46681a" +
    "c4f3c46ea26637c4071b073812151c0757165782efb84157b862b8a9b70fdab8" +
    "3ccc3cfd88b4f03c62f7623751339562e348e34b7093abe3c8cfc80e8a4207c8" +
    "ac26ac09cf638aac520752aaf1a3555264e9640745218d641050108060704010" +
    "d0b7d0ceda0a67d0d99ad986ec3543d9135f13986a794c130c3c0c602824300c" +
    "125a12906c7e4812298d2955f6dfa429510851b2fbaa5951b967b9a1b108deb9" +
    "cfd4cf3698571bcfd6a9d6fece187fd673a273bf3744d1738d838d1c09840e8d" +
    "81bf817c21a03e815419549ae5b14d54c0e7c04eba7a27c0ed7eed3b54b993ed" +
    "4e6b4e4ab9f7254e4449441a85c10d44a701a751f552a6a72a822a4dfcd6a82a" +
    "85ab855c39bc2e8525b12535defb9425e659e6636e88bfe6cac5ca1e864c0fca" +
    "7c917cc71569ed7c8b9d8b2c1d96168b5613568ae9bf455680ba807427a73a80",

    "d1ce3e9e501fcece6dbbb1bd06d6bbbb60eb0b40ab8bebebe092e44bd9729292" +
    "65ea0346ac8feaeac0cb16804b0bcbcb5f13986a794c1313e2c146bc7d23c1c1" +
    "6ae91b4ca583e9e9d23acd9ca6e83a3aa9d6fece187fd6d640b2f98b39f2b2b2" +
    "bdd2ded6046fd2d2ea90f447d77a90904b17b872655c17173ff8932ad2c7f8f8" +
    "57422a91d31542424115a87e6b54151513568ae9bf4556565eb4c99f2beab4b4" +
    "ec650f43268965656c1ce04854701c1c928834179f1a888852432297d4114343" +
    "f6c566a46133c5c5315cdad5896d5c5cee36adb482d8363668bab9bb01d2baba" +
    "06f5fb04f1f3f5f5165782efb8415757e6671f4f28816767838d1c09840e8d8d" +
    "f53195a697c4313109f6e30ef8fff6f6e9640745218d64642558facd957d5858" +
    "dc9e8463fd429e9e03f4f302f6f7f4f4aa220dccee88222238aa39db7192aaaa" +
    "bc758f2356c97575330f78222d3c0f0f0a02100c0e0802024fb1e18130feb1b1" +
    "84dfb6f8275bdfdfc46d4f731ea96d6da273bf3744d17373644d52b3fe294d4d" +
    "917cc71569ed7c7cbe262dd4f2982626962e6de4cab82e2e0cf7eb08fffbf7f7" +
    "2808403038200808345dd2d38e695d5d49441a85c10d4444c63eed84baf83e3e" +
    "d99f8c65fa469f9f4414a0786c501414cfc80e8a4207c8c82cae19c36d82aeae" +
    "19549ae5b14d545450108060704010109fd88eea3247d8d876bc89af13cabcbc" +
    "721ad05c46681a1ada6b7f670cb16b6bd0696f6b02b9696918f3cb10e3ebf3f3" +
    "73bd81a914cebdbdff3385aa99cc33333dab31dd7696abab35fa8326dccffafa" +
    "b2d1c6dc0d63d1d1cd9bac7de6569b9bd568676d05bd68686b4e4ab9f7254e4e" +
    "4e16b07462581616fb95dc59cc6e9595ef91fc41d07e919171ee235eb09feeee" +
    "614c5ab5f92d4c4cf2633f57349163638c8e04038d028e8e2a5be2c79c715b5b" +
    "dbcc2e925e17cccccc3cfd88b4f03c3c7d19c8564f6419191fa161e140bea1a1" +
    "bf817c21a03e8181704972abe23949498a7bff077cf17b7b9ad986ec3543d9d9" +
    "ce6f5f7f10a16f6feb37a5b285dc3737fd60275d3d9d6060c5ca1e864c0fcaca" +
    "5ce76b688fbbe7e7872b45fad1ac2b2b75487aade53d48482efdbb34c9d3fdfd" +
    "f496c453c56296964c451283c60945452bfcb332ced7fcfc5841329bda194141" +
    "5a12906c7e481212390d682e23340d0d8079ef0b72f9797956e57b6481b3e5e5" +
    "97893c11981e8989868c140f830a8c8c48e34b7093abe3e3a0201dc0e0802020" +
    "f0309da090c030308bdcaef22e57dcdc51b7d19522e6b7b7c16c477519ad6c6c" +
    "7f4a6aa1eb354a4a5bb5c1992ceeb5b5c33fe582bdfc3f3ff197cc55c2669797" +
    "a3d4eec21677d4d4f762375133956262992d75eec3b42d2d1e06301412180606" +
    "0ea449ff5baaa4a40ba541f95caea5a5b5836c2dae3683833e5fc2df80615f5f" +
    "822a4dfcd6a82a2a95da9ee63c4fdadacac9068c4503c9c90000000000000000" +
    "9b7ed71967e57e7e10a279eb49b2a2a21c5592e3b649555579bf91a51ac6bfbf" +
    "5511886677441111a6d5e6c41173d5d5d69c946ff34a9c9cd4cf3698571bcfcf" +
    "360e70242a380e0e220a503c36280a0ac93df58eb3f43d3d0851b2fbaa595151" +
    "947dcf136ee97d7de593ec4dde769393771bd85a416c1b1b21fea33ec0dffefe" +
    "f3c46ea26637c4c44647028fc80147472d0948363f240909a4864433b5228686" +
    "270b583a312c0b0b898f0c058a068f8fd39d9c69f44e9d9ddf6a77610bb56a6a" +
    "1b073812151c070767b9a1b108deb9b94ab0e98737fab0b0c298b477ef5a9898" +
    "7818c05048601818fa328dac9ec83232a871af3b4ad971717a4b62a7ec314b4b" +
    "74ef2b58b79befefd73bc59aa1ec3b3bad70a73d4ddd70701aa069e747baa0a0" +
    "53e4736286b7e4e45d403a9ddd1d404024ffab38c7dbffffe8c356b0732bc3c3" +
    "37a921d1789ea9a959e6636e88bfe6e68578e70d75fd78783af99b2cd5c3f9f9" +
    "9d8b2c1d96168b8b43460a89cf054646ba807427a73a8080661ef0445a781e1e" +
    "d838dd90a8e0383842e15b7c9da3e1e162b8a9b70fdab8b832a829d77f9aa8a8" +
    "47e0537a9aa7e0e03c0c602824300c0caf2305cae98c2323b37697295fc57676" +
    "691de84e53741d1db12535defb942525b4243dd8fc9024241105281e1b140505" +
    "12f1db1cede3f1f1cb6e577917a56e6efe94d45fcb6a949488285df0d8a02828" +
    "c89aa47be1529a9aae84543fbb2a84846fe8134aa287e8e815a371ed4eb6a3a3" +
    "6e4f42bff0214f4fb6779f2f58c17777b8d3d6d0036bd3d3ab855c39bc2e8585" +
    "4de2437694afe2e20752aaf1a35552521df2c316e4eff2f2b082642ba9328282" +
    "0d50bafdad5d50508f7af7017bf57a7a932f65e2cdbc2f2fb974872551cd7474" +
    "0253a2f7a451535345b3f18d3ef6b3b3f8612f5b3a99616129af11c56a86afaf" +
    "dd39d596afe43939e135b5be8bd4353581debefe205fdededecd26945913cdcd" +
    "631ff8425d7c1f1fc799bc71e85e999926ac09cf638aacac23ad01c9648eadad" +
    "a772b73143d572729c2c7de8c4b02c2c8edda6f42953ddddb7d0ceda0a67d0d0" +
    "a1874c35b22687877cbe99a31dc2bebe3b5ecad987655e5e04a659f355a2a6a6" +
    "7bec3352be97ecec140420181c100404f9c67eae683fc6c60f03180a090c0303" +
    "e434bdb88cd0343430fb8b20dbcbfbfb90db96e03b4bdbdb2059f2cb92795959" +
    "54b6d99325e2b6b6edc25eb6742fc2c2050108060704010117f0d31aeae7f0f0" +
    "2f5aeac19b755a5a7eed3b54b993eded01a751f552a6a7a7e36617492f856666" +
    "a52115c6e78421219e7fdf1f60e17f7f988a241b91128a8abb2725d2f59c2727" +
    "fcc776a86f3bc7c7e7c04eba7a27c0c08d2955f6dfa42929acd7f6c81f7bd7d7",

    "93ec4dde769393e5d986ec3543d9d99a9aa47be1529a9ac8b5c1992ceeb5b55b" +
    "98b477ef5a9898c2220dccee882222aa451283c60945454cfcb332ced7fcfc2b" +
    "bab9bb01d2baba686a77610bb56a6adfdfb6f8275bdfdf8402100c0e0802020a" +
    "9f8c65fa469f9fd9dcaef22e57dcdc8b51b2fbaa5951510859f2cb9279595920" +
    "4a6aa1eb354a4a7f17b872655c17174b2b45fad1ac2b2b87c25eb6742fc2c2ed" +
    "94d45fcb6a9494fef4f302f6f7f4f403bbb1bd06d6bbbb6da371ed4eb6a3a315" +
    "62375133956262f7e4736286b7e4e45371af3b4ad97171a8d4eec21677d4d4a3" +
    "cd26945913cdcdde70a73d4ddd7070ad16b074625816164ee15b7c9da3e1e142" +
    "4972abe2394949703cfd88b4f03c3cccc04eba7a27c0c0e7d88eea3247d8d89f" +
    "5cdad5896d5c5c319bac7de6569b9bcdad01c9648eadad23855c39bc2e8585ab" +
    "53a2f7a451535302a161e140bea1a11f7af7017bf57a7a8fc80e8a4207c8c8cf" +
    "2d75eec3b42d2d99e0537a9aa7e0e047d1c6dc0d63d1d1b272b73143d57272a7" +
    "a659f355a2a6a6042c7de8c4b02c2c9cc46ea26637c4c4f3e34b7093abe3e348" +
    "7697295fc57676b378e70d75fd787885b7d19522e6b7b751b4c99f2beab4b45e" +
    "0948363f2409092d3bc59aa1ec3b3bd70e70242a380e0e3641329bda19414158" +
    "4c5ab5f92d4c4c61debefe205fdede81b2f98b39f2b2b24090f447d77a9090ea" +
    "2535defb942525b1a541f95caea5a50bd7f6c81f7bd7d7ac03180a090c03030f" +
    "11886677441111550000000000000000c356b0732bc3c3e82e6de4cab82e2e96" +
    "92e44bd9729292e0ef2b58b79befef744e4ab9f7254e4e6b12906c7e4812125a" +
    "9d9c69f44e9d9dd37dcf136ee97d7d94cb16804b0bcbcbc035b5be8bd43535e1" +
    "1080607040101050d5e6c41173d5d5a64f42bff0214f4f6e9e8463fd429e9edc" +
    "4d52b3fe294d4d64a921d1789ea9a9375592e3b64955551cc67eae683fc6c6f9" +
    "d0ceda0a67d0d0b77bff077cf17b7b8a18c050486018187897cc55c2669797f1" +
    "d3d6d0036bd3d3b836adb482d83636eee6636e88bfe6e659487aade53d484875" +
    "568ae9bf45565613817c21a03e8181bf8f0c058a068f8f89779f2f58c17777b6" +
    "cc2e925e17ccccdb9c946ff34a9c9cd6b9a1b108deb9b967e2437694afe2e24d" +
    "ac09cf638aacac26b8a9b70fdab8b8622f65e2cdbc2f2f9315a87e6b54151541" +
    "a449ff5baaa4a40e7cc71569ed7c7c91da9ee63c4fdada9538dd90a8e03838d8" +
    "1ef0445a781e1e660b583a312c0b0b2705281e1b14050511d6fece187fd6d6a9" +
    "14a0786c501414446e577917a56e6ecb6c477519ad6c6cc17ed71967e57e7e9b" +
    "6617492f856666e3fdbb34c9d3fdfd2eb1e18130feb1b14fe57b6481b3e5e556" +
    "60275d3d9d6060fdaf11c56a86afaf295ecad987655e5e3b3385aa99cc3333ff" +
    "874c35b2268787a1c9068c4503c9c9caf0d31aeae7f0f0175dd2d38e695d5d34" +
    "6d4f731ea96d6dc43fe582bdfc3f3fc38834179f1a8888928d1c09840e8d8d83" +
    "c776a86f3bc7c7fcf7eb08fffbf7f70c1de84e53741d1d69e91b4ca583e9e96a" +
    "ec3352be97ecec7bed3b54b993eded7e807427a73a8080ba2955f6dfa429298d" +
    "2725d2f59c2727bbcf3698571bcfcfd499bc71e85e9999c7a829d77f9aa8a832" +
    "50bafdad5d50500d0f78222d3c0f0f3337a5b285dc3737eb243dd8fc902424b4" +
    "285df0d8a0282888309da090c03030f095dc59cc6e9595fbd2ded6046fd2d2bd" +
    "3eed84baf83e3ec65be2c79c715b5b2a403a9ddd1d40405d836c2dae368383b5" +
    "b3f18d3ef6b3b345696f6b02b96969d05782efb8415757161ff8425d7c1f1f63" +
    "073812151c07071b1ce04854701c1c6c8a241b91128a8a98bc89af13cabcbc76" +
    "201dc0e0802020a0eb0b40ab8bebeb60ce3e9e501fceced18e04038d028e8e8c" +
    "ab31dd7696abab3dee235eb09feeee713195a697c43131f5a279eb49b2a2a210" +
    "73bf3744d17373a2f99b2cd5c3f9f93aca1e864c0fcacac53acd9ca6e83a3ad2" +
    "1ad05c46681a1a72fb8b20dbcbfbfb300d682e23340d0d39c146bc7d23c1c1e2" +
    "fea33ec0dffefe21fa8326dccffafa35f2c316e4eff2f21d6f5f7f10a16f6fce" +
    "bd81a914cebdbd7396c453c5629696f4dda6f42953dddd8e432297d411434352" +
    "52aaf1a355525207b6d99325e2b6b6540840303820080828f3cb10e3ebf3f318" +
    "ae19c36d82aeae2cbe99a31dc2bebe7c19c8564f6419197d893c11981e898997" +
    "328dac9ec83232fa262dd4f2982626beb0e98737fab0b04aea0346ac8feaea65" +
    "4b62a7ec314b4b7a640745218d6464e984543fbb2a8484ae82642ba9328282b0" +
    "6b7f670cb16b6bdaf5fb04f1f3f5f50679ef0b72f9797980bf91a51ac6bfbf79" +
    "01080607040101055fc2df80615f5f3e758f2356c97575bc633f5734916363f2" +
    "1bd85a416c1b1b772305cae98c2323af3df58eb3f43d3dc968676d05bd6868d5" +
    "2a4dfcd6a82a2a82650f4326896565ece8134aa287e8e86f91fc41d07e9191ef" +
    "f6e30ef8fff6f609ffab38c7dbffff2413986a794c13135f58facd957d585825" +
    "f1db1cede3f1f11247028fc8014747460a503c36280a0a227fdf1f60e17f7f9e" +
    "c566a46133c5c5f6a751f552a6a7a701e76b688fbbe7e75c612f5b3a996161f8" +
    "5aeac19b755a5a2f063014121806061e460a89cf05464643441a85c10d444449" +
    "422a91d3154242570420181c10040414a069e747baa0a01adb96e03b4bdbdb90" +
    "39d596afe43939dd864433b5228686a4549ae5b14d545419aa39db7192aaaa38" +
    "8c140f830a8c8c8634bdb88cd03434e42115c6e7842121a58b2c1d96168b8b9d" +
    "f8932ad2c7f8f83f0c602824300c0c3c74872551cd7474b9671f4f28816767e6",

    "676d05bd6868d5681c09840e8d8d838d1e864c0fcacac5ca52b3fe294d4d644d" +
    "bf3744d17373a27362a7ec314b4b7a4b4ab9f7254e4e6b4e4dfcd6a82a2a822a" +
    "eec21677d4d4a3d4aaf1a355525207522dd4f2982626be26f18d3ef6b3b345b3" +
    "9ae5b14d54541954f0445a781e1e661ec8564f6419197d19f8425d7c1f1f631f" +
    "0dccee882222aa22180a090c03030f030a89cf0546464346f58eb3f43d3dc93d" +
    "75eec3b42d2d992d6aa1eb354a4a7f4aa2f7a451535302536c2dae368383b583" +
    "986a794c13135f13241b91128a8a988ad19522e6b7b751b7e6c41173d5d5a6d5" +
    "35defb942525b125ef0b72f979798079fb04f1f3f5f506f581a914cebdbd73bd" +
    "facd957d5858255865e2cdbc2f2f932f682e23340d0d390d100c0e0802020a02" +
    "3b54b993eded7eedb2fbaa59515108518463fd429e9edc9e8866774411115511" +
    "c316e4eff2f21df2ed84baf83e3ec63e92e3b64955551c55cad987655e5e3b5e" +
    "c6dc0d63d1d1b2d1b074625816164e16fd88b4f03c3ccc3c17492f856666e366" +
    "a73d4ddd7070ad70d2d38e695d5d345dcb10e3ebf3f318f31283c60945454c45" +
    "3a9ddd1d40405d402e925e17ccccdbcc134aa287e8e86fe8d45fcb6a9494fe94" +
    "8ae9bf455656135640303820080828083e9e501fceced1ced05c46681a1a721a" +
    "cd9ca6e83a3ad23aded6046fd2d2bdd25b7c9da3e1e142e1b6f8275bdfdf84df" +
    "c1992ceeb5b55bb5dd90a8e03838d838577917a56e6ecb6e70242a380e0e360e" +
    "7b6481b3e5e556e5f302f6f7f4f403f49b2cd5c3f9f93af94433b5228686a486" +
    "1b4ca583e9e96ae942bff0214f4f6e4ffece187fd6d6a9d65c39bc2e8585ab85" +
    "05cae98c2323af233698571bcfcfd4cf8dac9ec83232fa32bc71e85e9999c799" +
    "95a697c43131f531a0786c501414441419c36d82aeae2cae235eb09feeee71ee" +
    "0e8a4207c8c8cfc87aade53d48487548d6d0036bd3d3b8d39da090c03030f030" +
    "61e140bea1a11fa1e44bd9729292e092329bda1941415841e18130feb1b14fb1" +
    "c0504860181878186ea26637c4c4f3c47de8c4b02c2c9c2caf3b4ad97171a871" +
    "b73143d57272a7721a85c10d44444944a87e6b5415154115bb34c9d3fdfd2efd" +
    "a5b285dc3737eb3799a31dc2bebe7cbec2df80615f5f3e5f39db7192aaaa38aa" +
    "ac7de6569b9bcd9b34179f1a888892888eea3247d8d89fd831dd7696abab3dab" +
    "3c11981e89899789946ff34a9c9cd69c8326dccffafa35fa275d3d9d6060fd60" +
    "0346ac8feaea65ea89af13cabcbc76bc375133956262f762602824300c0c3c0c" +
    "3dd8fc902424b42459f355a2a6a604a629d77f9aa8a832a83352be97ecec7bec" +
    "1f4f28816767e6671dc0e0802020a02096e03b4bdbdb90dbc71569ed7c7c917c" +
    "5df0d8a028288828a6f42953dddd8edd09cf638aacac26ace2c79c715b5b2a5b" +
    "bdb88cd03434e434d71967e57e7e9b7e8060704010105010db1cede3f1f112f1" +
    "ff077cf17b7b8a7b0c058a068f8f898f3f5734916363f26369e747baa0a01aa0" +
    "281e1b1405051105a47be1529a9ac89a2297d411434352439f2f58c17777b677" +
    "15c6e7842121a52191a51ac6bfbf79bf25d2f59c2727bb2748363f2409092d09" +
    "56b0732bc3c3e8c38c65fa469f9fd99fd99325e2b6b654b6f6c81f7bd7d7acd7" +
    "55f6dfa429298d295eb6742fc2c2edc20b40ab8bebeb60eb4eba7a27c0c0e7c0" +
    "49ff5baaa4a40ea42c1d96168b8b9d8b140f830a8c8c868ce84e53741d1d691d" +
    "8b20dbcbfbfb30fbab38c7dbffff24ff46bc7d23c1c1e2c1f98b39f2b2b240b2" +
    "cc55c2669797f1976de4cab82e2e962e932ad2c7f8f83ff80f4326896565ec65" +
    "e30ef8fff6f609f68f2356c97575bc753812151c07071b0720181c1004041404" +
    "72abe2394949704985aa99cc3333ff33736286b7e4e453e486ec3543d9d99ad9" +
    "a1b108deb9b967b9ceda0a67d0d0b7d02a91d3154242574276a86f3bc7c7fcc7" +
    "477519ad6c6cc16cf447d77a9090ea90000000000000000004038d028e8e8c8e" +
    "5f7f10a16f6fce6fbafdad5d50500d50080607040101050166a46133c5c5f6c5" +
    "9ee63c4fdada95da028fc80147474647e582bdfc3f3fc33f26945913cdcddecd" +
    "6f6b02b96969d06979eb49b2a2a210a2437694afe2e24de2f7017bf57a7a8f7a" +
    "51f552a6a7a701a77eae683fc6c6f9c6ec4dde769393e59378222d3c0f0f330f" +
    "503c36280a0a220a3014121806061e06636e88bfe6e659e645fad1ac2b2b872b" +
    "c453c5629696f49671ed4eb6a3a315a3e04854701c1c6c1c11c56a86afaf29af" +
    "77610bb56a6adf6a906c7e4812125a12543fbb2a8484ae84d596afe43939dd39" +
    "6b688fbbe7e75ce7e98737fab0b04ab0642ba9328282b082eb08fffbf7f70cf7" +
    "a33ec0dffefe21fe9c69f44e9d9dd39d4c35b2268787a187dad5896d5c5c315c" +
    "7c21a03e8181bf81b5be8bd43535e135befe205fdede81dec99f2beab4b45eb4" +
    "41f95caea5a50ba5b332ced7fcfc2bfc7427a73a8080ba802b58b79befef74ef" +
    "16804b0bcbcbc0cbb1bd06d6bbbb6dbb7f670cb16b6bda6b97295fc57676b376" +
    "b9bb01d2baba68baeac19b755a5a2f5acf136ee97d7d947de70d75fd78788578" +
    "583a312c0b0b270bdc59cc6e9595fb954b7093abe3e348e301c9648eadad23ad" +
    "872551cd7474b974b477ef5a9898c298c59aa1ec3b3bd73badb482d83636ee36" +
    "0745218d6464e9644f731ea96d6dc46daef22e57dcdc8bdcd31aeae7f0f017f0" +
    "f2cb92795959205921d1789ea9a937a95ab5f92d4c4c614cb872655c17174b17" +
    "df1f60e17f7f9e7ffc41d07e9191ef91a9b70fdab8b862b8068c4503c9c9cac9" +
    "82efb84157571657d85a416c1b1b771b537a9aa7e0e047e02f5b3a996161f861",

    "d77f9aa8a832a82997d4114343524322df80615f5f3e5fc214121806061e0630" +
    "670cb16b6bda6b7f2356c97575bc758f7519ad6c6cc16c47cb927959592059f2" +
    "3b4ad97171a871aff8275bdfdf84dfb635b2268787a1874c59cc6e9595fb95dc" +
    "72655c17174b17b81aeae7f0f017f0d3ea3247d8d89fd88e363f2409092d0948" +
    "731ea96d6dc46d4f10e3ebf3f318f3cb4e53741d1d691de8804b0bcbcbc0cb16" +
    "8c4503c9c9cac906b3fe294d4d644d52e8c4b02c2c9c2c7dc56a86afaf29af11" +
    "0b72f979798079ef7a9aa7e0e047e05355c2669797f197cc34c9d3fdfd2efdbb" +
    "7f10a16f6fce6f5fa7ec314b4b7a4b6283c60945454c451296afe43939dd39d5" +
    "84baf83e3ec63eedf42953dddd8edda6ed4eb6a3a315a371bff0214f4f6e4f42" +
    "9f2beab4b45eb4c99325e2b6b654b6d97be1529a9ac89aa4242a380e0e360e70" +
    "425d7c1f1f631ff8a51ac6bfbf79bf917e6b5415154115a87c9da3e1e142e15b" +
    "abe2394949704972d6046fd2d2bdd2de4dde769393e593ecae683fc6c6f9c67e" +
    "4bd9729292e092e43143d57272a772b763fd429e9edc9e845b3a996161f8612f" +
    "dc0d63d1d1b2d1c65734916363f2633f26dccffafa35fa835eb09feeee71ee23" +
    "02f6f7f4f403f4f3564f6419197d19c8c41173d5d5a6d5e6c9648eadad23ad01" +
    "cd957d58582558faff5baaa4a40ea449bd06d6bbbb6dbbb1e140bea1a11fa161" +
    "f22e57dcdc8bdcae16e4eff2f21df2c32dae368383b5836cb285dc3737eb37a5" +
    "91d315424257422a6286b7e4e453e473017bf57a7a8f7af7ac9ec83232fa328d" +
    "6ff34a9c9cd69c94925e17ccccdbcc2edd7696abab3dab31a1eb354a4a7f4a6a" +
    "058a068f8f898f0c7917a56e6ecb6e57181c100404140420d2f59c2727bb2725" +
    "e4cab82e2e962e6d688fbbe7e75ce76b7694afe2e24de243c19b755a5a2f5aea" +
    "53c5629696f496c474625816164e16b0cae98c2323af2305fad1ac2b2b872b45" +
    "b6742fc2c2edc25e4326896565ec650f492f856666e36617222d3c0f0f330f78" +
    "af13cabcbc76bc89d1789ea9a937a9218fc80147474647029bda194141584132" +
    "b88cd03434e434bdade53d484875487a32ced7fcfc2bfcb39522e6b7b751b7d1" +
    "610bb56a6adf6a77179f1a8888928834f95caea5a50ba541f7a45153530253a2" +
    "33b5228686a486442cd5c3f9f93af99bc79c715b5b2a5be2e03b4bdbdb90db96" +
    "90a8e03838d838dd077cf17b7b8a7bffb0732bc3c3e8c356445a781e1e661ef0" +
    "ccee882222aa220daa99cc3333ff3385d8fc902424b4243df0d8a0282888285d" +
    "b482d83636ee36ada86f3bc7c7fcc7768b39f2b2b240b2f99aa1ec3b3bd73bc5" +
    "038d028e8e8c8e042f58c17777b6779fbb01d2baba68bab904f1f3f5f506f5fb" +
    "786c5014144414a065fa469f9fd99f8c3038200808280840e3b64955551c5592" +
    "7de6569b9bcd9bacb5f92d4c4c614c5a3ec0dffefe21fea35d3d9d6060fd6027" +
    "d5896d5c5c315cdae63c4fdada95da9e50486018187818c089cf05464643460a" +
    "945913cdcddecd26136ee97d7d947dcfc6e7842121a521158737fab0b04ab0e9" +
    "82bdfc3f3fc33fe55a416c1b1b771bd811981e898997893c38c7dbffff24ffab" +
    "40ab8bebeb60eb0b3fbb2a8484ae84546b02b96969d0696f9ca6e83a3ad23acd" +
    "69f44e9d9dd39d9cc81f7bd7d7acd7f6d0036bd3d3b8d3d63d4ddd7070ad70a7" +
    "4f28816767e6671f9ddd1d40405d403a992ceeb5b55bb5c1fe205fdede81debe" +
    "d38e695d5d345dd2a090c03030f0309d41d07e9191ef91fc8130feb1b14fb1e1" +
    "0d75fd78788578e7667744111155118806070401010501086481b3e5e556e57b" +
    "00000000000000006d05bd6868d5686777ef5a9898c298b4e747baa0a01aa069" +
    "a46133c5c5f6c5660c0e0802020a0210f355a2a6a604a6592551cd7474b97487" +
    "eec3b42d2d992d753a312c0b0b270b58eb49b2a2a210a279295fc57676b37697" +
    "8d3ef6b3b345b3f1a31dc2bebe7cbe999e501fceced1ce3ea914cebdbd73bd81" +
    "c36d82aeae2cae194ca583e9e96ae91b1b91128a8a988a24a697c43131f53195" +
    "4854701c1c6c1ce052be97ecec7bec331cede3f1f112f1db71e85e9999c799bc" +
    "5fcb6a9494fe94d4db7192aaaa38aa390ef8fff6f609f6e3d4f2982626be262d" +
    "e2cdbc2f2f932f6558b79befef74ef2b4aa287e8e86fe8130f830a8c8c868c14" +
    "be8bd43535e135b50a090c03030f0318c21677d4d4a3d4ee1f60e17f7f9e7fdf" +
    "20dbcbfbfb30fb8b1e1b140505110528bc7d23c1c1e2c146d987655e5e3b5eca" +
    "47d77a9090ea90f4c0e0802020a0201d8eb3f43d3dc93df52ba9328282b08264" +
    "08fffbf7f70cf7eb46ac8feaea65ea033c36280a0a220a502e23340d0d390d68" +
    "1967e57e7e9b7ed72ad2c7f8f83ff893fdad5d50500d50ba5c46681a1a721ad0" +
    "a26637c4c4f3c46e12151c07071b0738efb8415757165782b70fdab8b862b8a9" +
    "88b4f03c3ccc3cfd5133956262f762377093abe3e348e34b8a4207c8c8cfc80e" +
    "cf638aacac26ac09f1a35552520752aa45218d6464e964076070401010501080" +
    "da0a67d0d0b7d0ceec3543d9d99ad9866a794c13135f13982824300c0c3c0c60" +
    "6c7e4812125a1290f6dfa429298d2955fbaa5951510851b2b108deb9b967b9a1" +
    "98571bcfcfd4cf36ce187fd6d6a9d6fe3744d17373a273bf09840e8d8d838d1c" +
    "21a03e8181bf817ce5b14d545419549aba7a27c0c0e7c04e54b993eded7eed3b" +
    "b9f7254e4e6b4e4a85c10d444449441af552a6a7a701a751fcd6a82a2a822a4d" +
    "39bc2e8585ab855cdefb942525b125356e88bfe6e659e663864c0fcacac5ca1e" +
    "1569ed7c7c917cc71d96168b8b9d8b2ce9bf45565613568a27a73a8080ba8074",

    "501fceced1ce3e9e06d6bbbb6dbbb1bdab8bebeb60eb0b40d9729292e092e44b" +
    "ac8feaea65ea03464b0bcbcbc0cb1680794c13135f13986a7d23c1c1e2c146bc" +
    "a583e9e96ae91b4ca6e83a3ad23acd9c187fd6d6a9d6fece39f2b2b240b2f98b" +
    "046fd2d2bdd2ded6d77a9090ea90f447655c17174b17b872d2c7f8f83ff8932a" +
    "d315424257422a916b5415154115a87ebf45565613568ae92beab4b45eb4c99f" +
    "26896565ec650f4354701c1c6c1ce0489f1a888892883417d411434352432297" +
    "6133c5c5f6c566a4896d5c5c315cdad582d83636ee36adb401d2baba68bab9bb" +
    "f1f3f5f506f5fb04b8415757165782ef28816767e6671f4f840e8d8d838d1c09" +
    "97c43131f53195a6f8fff6f609f6e30e218d6464e9640745957d58582558facd" +
    "fd429e9edc9e8463f6f7f4f403f4f302ee882222aa220dcc7192aaaa38aa39db" +
    "56c97575bc758f232d3c0f0f330f78220e0802020a02100c30feb1b14fb1e181" +
    "275bdfdf84dfb6f81ea96d6dc46d4f7344d17373a273bf37fe294d4d644d52b3" +
    "69ed7c7c917cc715f2982626be262dd4cab82e2e962e6de4fffbf7f70cf7eb08" +
    "38200808280840308e695d5d345dd2d3c10d444449441a85baf83e3ec63eed84" +
    "fa469f9fd99f8c656c5014144414a0784207c8c8cfc80e8a6d82aeae2cae19c3" +
    "b14d545419549ae570401010501080603247d8d89fd88eea13cabcbc76bc89af" +
    "46681a1a721ad05c0cb16b6bda6b7f6702b96969d0696f6be3ebf3f318f3cb10" +
    "14cebdbd73bd81a999cc3333ff3385aa7696abab3dab31dddccffafa35fa8326" +
    "0d63d1d1b2d1c6dce6569b9bcd9bac7d05bd6868d568676df7254e4e6b4e4ab9" +
    "625816164e16b074cc6e9595fb95dc59d07e9191ef91fc41b09feeee71ee235e" +
    "f92d4c4c614c5ab534916363f2633f578d028e8e8c8e04039c715b5b2a5be2c7" +
    "5e17ccccdbcc2e92b4f03c3ccc3cfd884f6419197d19c85640bea1a11fa161e1" +
    "a03e8181bf817c21e2394949704972ab7cf17b7b8a7bff073543d9d99ad986ec" +
    "10a16f6fce6f5f7f85dc3737eb37a5b23d9d6060fd60275d4c0fcacac5ca1e86" +
    "8fbbe7e75ce76b68d1ac2b2b872b45fae53d484875487aadc9d3fdfd2efdbb34" +
    "c5629696f496c453c60945454c451283ced7fcfc2bfcb332da1941415841329b" +
    "7e4812125a12906c23340d0d390d682e72f979798079ef0b81b3e5e556e57b64" +
    "981e898997893c11830a8c8c868c140f93abe3e348e34b70e0802020a0201dc0" +
    "90c03030f0309da02e57dcdc8bdcaef222e6b7b751b7d19519ad6c6cc16c4775" +
    "eb354a4a7f4a6aa12ceeb5b55bb5c199bdfc3f3fc33fe582c2669797f197cc55" +
    "1677d4d4a3d4eec233956262f7623751c3b42d2d992d75ee121806061e063014" +
    "5baaa4a40ea449ff5caea5a50ba541f9ae368383b5836c2d80615f5f3e5fc2df" +
    "d6a82a2a822a4dfc3c4fdada95da9ee64503c9c9cac9068c0000000000000000" +
    "67e57e7e9b7ed71949b2a2a210a279ebb64955551c5592e31ac6bfbf79bf91a5" +
    "77441111551188661173d5d5a6d5e6c4f34a9c9cd69c946f571bcfcfd4cf3698" +
    "2a380e0e360e702436280a0a220a503cb3f43d3dc93df58eaa5951510851b2fb" +
    "6ee97d7d947dcf13de769393e593ec4d416c1b1b771bd85ac0dffefe21fea33e" +
    "6637c4c4f3c46ea2c80147474647028f3f2409092d094836b5228686a4864433" +
    "312c0b0b270b583a8a068f8f898f0c05f44e9d9dd39d9c690bb56a6adf6a7761" +
    "151c07071b07381208deb9b967b9a1b137fab0b04ab0e987ef5a9898c298b477" +
    "486018187818c0509ec83232fa328dac4ad97171a871af3bec314b4b7a4b62a7" +
    "b79befef74ef2b58a1ec3b3bd73bc59a4ddd7070ad70a73d47baa0a01aa069e7" +
    "86b7e4e453e47362dd1d40405d403a9dc7dbffff24ffab38732bc3c3e8c356b0" +
    "789ea9a937a921d188bfe6e659e6636e75fd78788578e70dd5c3f9f93af99b2c" +
    "96168b8b9d8b2c1dcf05464643460a89a73a8080ba8074275a781e1e661ef044" +
    "a8e03838d838dd909da3e1e142e15b7c0fdab8b862b8a9b77f9aa8a832a829d7" +
    "9aa7e0e047e0537a24300c0c3c0c6028e98c2323af2305ca5fc57676b3769729" +
    "53741d1d691de84efb942525b12535defc902424b4243dd81b1405051105281e" +
    "ede3f1f112f1db1c17a56e6ecb6e5779cb6a9494fe94d45fd8a0282888285df0" +
    "e1529a9ac89aa47bbb2a8484ae84543fa287e8e86fe8134a4eb6a3a315a371ed" +
    "f0214f4f6e4f42bf58c17777b6779f2f036bd3d3b8d3d6d0bc2e8585ab855c39" +
    "94afe2e24de24376a35552520752aaf1e4eff2f21df2c316a9328282b082642b" +
    "ad5d50500d50bafd7bf57a7a8f7af701cdbc2f2f932f65e251cd7474b9748725" +
    "a45153530253a2f73ef6b3b345b3f18d3a996161f8612f5b6a86afaf29af11c5" +
    "afe43939dd39d5968bd43535e135b5be205fdede81debefe5913cdcddecd2694" +
    "5d7c1f1f631ff842e85e9999c799bc71638aacac26ac09cf648eadad23ad01c9" +
    "43d57272a772b731c4b02c2c9c2c7de82953dddd8edda6f40a67d0d0b7d0ceda" +
    "b2268787a1874c351dc2bebe7cbe99a387655e5e3b5ecad955a2a6a604a659f3" +
    "be97ecec7bec33521c10040414042018683fc6c6f9c67eae090c03030f03180a" +
    "8cd03434e434bdb8dbcbfbfb30fb8b203b4bdbdb90db96e0927959592059f2cb" +
    "25e2b6b654b6d993742fc2c2edc25eb60704010105010806eae7f0f017f0d31a" +
    "9b755a5a2f5aeac1b993eded7eed3b5452a6a7a701a751f52f856666e3661749" +
    "e7842121a52115c660e17f7f9e7fdf1f91128a8a988a241bf59c2727bb2725d2" +
    "6f3bc7c7fcc776a87a27c0c0e7c04ebadfa429298d2955f61f7bd7d7acd7f6c8",

    "769393e593ec4dde43d9d99ad986ec35529a9ac89aa47be1eeb5b55bb5c1992c" +
    "5a9898c298b477ef882222aa220dccee0945454c451283c6d7fcfc2bfcb332ce" +
    "d2baba68bab9bb01b56a6adf6a77610b5bdfdf84dfb6f8270802020a02100c0e" +
    "469f9fd99f8c65fa57dcdc8bdcaef22e5951510851b2fbaa7959592059f2cb92" +
    "354a4a7f4a6aa1eb5c17174b17b87265ac2b2b872b45fad12fc2c2edc25eb674" +
    "6a9494fe94d45fcbf7f4f403f4f302f6d6bbbb6dbbb1bd06b6a3a315a371ed4e" +
    "956262f762375133b7e4e453e4736286d97171a871af3b4a77d4d4a3d4eec216" +
    "13cdcddecd269459dd7070ad70a73d4d5816164e16b07462a3e1e142e15b7c9d" +
    "394949704972abe2f03c3ccc3cfd88b427c0c0e7c04eba7a47d8d89fd88eea32" +
    "6d5c5c315cdad589569b9bcd9bac7de68eadad23ad01c9642e8585ab855c39bc" +
    "5153530253a2f7a4bea1a11fa161e140f57a7a8f7af7017b07c8c8cfc80e8a42" +
    "b42d2d992d75eec3a7e0e047e0537a9a63d1d1b2d1c6dc0dd57272a772b73143" +
    "a2a6a604a659f355b02c2c9c2c7de8c437c4c4f3c46ea266abe3e348e34b7093" +
    "c57676b37697295ffd78788578e70d75e6b7b751b7d19522eab4b45eb4c99f2b" +
    "2409092d0948363fec3b3bd73bc59aa1380e0e360e70242a1941415841329bda" +
    "2d4c4c614c5ab5f95fdede81debefe20f2b2b240b2f98b397a9090ea90f447d7" +
    "942525b12535defbaea5a50ba541f95c7bd7d7acd7f6c81f0c03030f03180a09" +
    "441111551188667700000000000000002bc3c3e8c356b073b82e2e962e6de4ca" +
    "729292e092e44bd99befef74ef2b58b7254e4e6b4e4ab9f74812125a12906c7e" +
    "4e9d9dd39d9c69f4e97d7d947dcf136e0bcbcbc0cb16804bd43535e135b5be8b" +
    "401010501080607073d5d5a6d5e6c411214f4f6e4f42bff0429e9edc9e8463fd" +
    "294d4d644d52b3fe9ea9a937a921d1784955551c5592e3b63fc6c6f9c67eae68" +
    "67d0d0b7d0ceda0af17b7b8a7bff077c6018187818c05048669797f197cc55c2" +
    "6bd3d3b8d3d6d003d83636ee36adb482bfe6e659e6636e883d484875487aade5" +
    "45565613568ae9bf3e8181bf817c21a0068f8f898f0c058ac17777b6779f2f58" +
    "17ccccdbcc2e925e4a9c9cd69c946ff3deb9b967b9a1b108afe2e24de2437694" +
    "8aacac26ac09cf63dab8b862b8a9b70fbc2f2f932f65e2cd5415154115a87e6b" +
    "aaa4a40ea449ff5bed7c7c917cc715694fdada95da9ee63ce03838d838dd90a8" +
    "781e1e661ef0445a2c0b0b270b583a311405051105281e1b7fd6d6a9d6fece18" +
    "5014144414a0786ca56e6ecb6e577917ad6c6cc16c477519e57e7e9b7ed71967" +
    "856666e36617492fd3fdfd2efdbb34c9feb1b14fb1e18130b3e5e556e57b6481" +
    "9d6060fd60275d3d86afaf29af11c56a655e5e3b5ecad987cc3333ff3385aa99" +
    "268787a1874c35b203c9c9cac9068c45e7f0f017f0d31aea695d5d345dd2d38e" +
    "a96d6dc46d4f731efc3f3fc33fe582bd1a8888928834179f0e8d8d838d1c0984" +
    "3bc7c7fcc776a86ffbf7f70cf7eb08ff741d1d691de84e5383e9e96ae91b4ca5" +
    "97ecec7bec3352be93eded7eed3b54b93a8080ba807427a7a429298d2955f6df" +
    "9c2727bb2725d2f51bcfcfd4cf3698575e9999c799bc71e89aa8a832a829d77f" +
    "5d50500d50bafdad3c0f0f330f78222ddc3737eb37a5b285902424b4243dd8fc" +
    "a0282888285df0d8c03030f0309da0906e9595fb95dc59cc6fd2d2bdd2ded604" +
    "f83e3ec63eed84ba715b5b2a5be2c79c1d40405d403a9ddd368383b5836c2dae" +
    "f6b3b345b3f18d3eb96969d0696f6b02415757165782efb87c1f1f631ff8425d" +
    "1c07071b07381215701c1c6c1ce04854128a8a988a241b91cabcbc76bc89af13" +
    "802020a0201dc0e08bebeb60eb0b40ab1fceced1ce3e9e50028e8e8c8e04038d" +
    "96abab3dab31dd769feeee71ee235eb0c43131f53195a697b2a2a210a279eb49" +
    "d17373a273bf3744c3f9f93af99b2cd50fcacac5ca1e864ce83a3ad23acd9ca6" +
    "681a1a721ad05c46cbfbfb30fb8b20db340d0d390d682e2323c1c1e2c146bc7d" +
    "dffefe21fea33ec0cffafa35fa8326dceff2f21df2c316e4a16f6fce6f5f7f10" +
    "cebdbd73bd81a914629696f496c453c553dddd8edda6f42911434352432297d4" +
    "5552520752aaf1a3e2b6b654b6d993252008082808403038ebf3f318f3cb10e3" +
    "82aeae2cae19c36dc2bebe7cbe99a31d6419197d19c8564f1e898997893c1198" +
    "c83232fa328dac9e982626be262dd4f2fab0b04ab0e987378feaea65ea0346ac" +
    "314b4b7a4b62a7ec8d6464e9640745212a8484ae84543fbb328282b082642ba9" +
    "b16b6bda6b7f670cf3f5f506f5fb04f1f979798079ef0b72c6bfbf79bf91a51a" +
    "0401010501080607615f5f3e5fc2df80c97575bc758f2356916363f2633f5734" +
    "6c1b1b771bd85a418c2323af2305cae9f43d3dc93df58eb3bd6868d568676d05" +
    "a82a2a822a4dfcd6896565ec650f432687e8e86fe8134aa27e9191ef91fc41d0" +
    "fff6f609f6e30ef8dbffff24ffab38c74c13135f13986a797d58582558facd95" +
    "e3f1f112f1db1ced0147474647028fc8280a0a220a503c36e17f7f9e7fdf1f60" +
    "33c5c5f6c566a461a6a7a701a751f552bbe7e75ce76b688f996161f8612f5b3a" +
    "755a5a2f5aeac19b1806061e0630141205464643460a89cf0d444449441a85c1" +
    "15424257422a91d3100404140420181cbaa0a01aa069e7474bdbdb90db96e03b" +
    "e43939dd39d596af228686a4864433b54d545419549ae5b192aaaa38aa39db71" +
    "0a8c8c868c140f83d03434e434bdb88c842121a52115c6e7168b8b9d8b2c1d96" +
    "c7f8f83ff8932ad2300c0c3c0c602824cd7474b974872551816767e6671f4f28",

    "6868d568676d05bd8d8d838d1c09840ecacac5ca1e864c0f4d4d644d52b3fe29" +
    "7373a273bf3744d14b4b7a4b62a7ec314e4e6b4e4ab9f7252a2a822a4dfcd6a8" +
    "d4d4a3d4eec2167752520752aaf1a3552626be262dd4f298b3b345b3f18d3ef6" +
    "545419549ae5b14d1e1e661ef0445a7819197d19c8564f641f1f631ff8425d7c" +
    "2222aa220dccee8803030f03180a090c464643460a89cf053d3dc93df58eb3f4" +
    "2d2d992d75eec3b44a4a7f4a6aa1eb3553530253a2f7a4518383b5836c2dae36" +
    "13135f13986a794c8a8a988a241b9112b7b751b7d19522e6d5d5a6d5e6c41173" +
    "2525b12535defb9479798079ef0b72f9f5f506f5fb04f1f3bdbd73bd81a914ce" +
    "58582558facd957d2f2f932f65e2cdbc0d0d390d682e233402020a02100c0e08" +
    "eded7eed3b54b99351510851b2fbaa599e9edc9e8463fd421111551188667744" +
    "f2f21df2c316e4ef3e3ec63eed84baf855551c5592e3b6495e5e3b5ecad98765" +
    "d1d1b2d1c6dc0d6316164e16b07462583c3ccc3cfd88b4f06666e36617492f85" +
    "7070ad70a73d4ddd5d5d345dd2d38e69f3f318f3cb10e3eb45454c451283c609" +
    "40405d403a9ddd1dccccdbcc2e925e17e8e86fe8134aa2879494fe94d45fcb6a" +
    "565613568ae9bf450808280840303820ceced1ce3e9e501f1a1a721ad05c4668" +
    "3a3ad23acd9ca6e8d2d2bdd2ded6046fe1e142e15b7c9da3dfdf84dfb6f8275b" +
    "b5b55bb5c1992cee3838d838dd90a8e06e6ecb6e577917a50e0e360e70242a38" +
    "e5e556e57b6481b3f4f403f4f302f6f7f9f93af99b2cd5c38686a4864433b522" +
    "e9e96ae91b4ca5834f4f6e4f42bff021d6d6a9d6fece187f8585ab855c39bc2e" +
    "2323af2305cae98ccfcfd4cf3698571b3232fa328dac9ec89999c799bc71e85e" +
    "3131f53195a697c414144414a0786c50aeae2cae19c36d82eeee71ee235eb09f" +
    "c8c8cfc80e8a4207484875487aade53dd3d3b8d3d6d0036b3030f0309da090c0" +
    "a1a11fa161e140be9292e092e44bd97241415841329bda19b1b14fb1e18130fe" +
    "18187818c0504860c4c4f3c46ea266372c2c9c2c7de8c4b07171a871af3b4ad9" +
    "7272a772b73143d5444449441a85c10d15154115a87e6b54fdfd2efdbb34c9d3" +
    "3737eb37a5b285dcbebe7cbe99a31dc25f5f3e5fc2df8061aaaa38aa39db7192" +
    "9b9bcd9bac7de6568888928834179f1ad8d89fd88eea3247abab3dab31dd7696" +
    "898997893c11981e9c9cd69c946ff34afafa35fa8326dccf6060fd60275d3d9d" +
    "eaea65ea0346ac8fbcbc76bc89af13ca6262f762375133950c0c3c0c60282430" +
    "2424b4243dd8fc90a6a604a659f355a2a8a832a829d77f9aecec7bec3352be97" +
    "6767e6671f4f28812020a0201dc0e080dbdb90db96e03b4b7c7c917cc71569ed" +
    "282888285df0d8a0dddd8edda6f42953acac26ac09cf638a5b5b2a5be2c79c71" +
    "3434e434bdb88cd07e7e9b7ed71967e51010501080607040f1f112f1db1cede3" +
    "7b7b8a7bff077cf18f8f898f0c058a066363f2633f573491a0a01aa069e747ba" +
    "05051105281e1b149a9ac89aa47be152434352432297d4117777b6779f2f58c1" +
    "2121a52115c6e784bfbf79bf91a51ac62727bb2725d2f59c09092d0948363f24" +
    "c3c3e8c356b0732b9f9fd99f8c65fa46b6b654b6d99325e2d7d7acd7f6c81f7b" +
    "29298d2955f6dfa4c2c2edc25eb6742febeb60eb0b40ab8bc0c0e7c04eba7a27" +
    "a4a40ea449ff5baa8b8b9d8b2c1d96168c8c868c140f830a1d1d691de84e5374" +
    "fbfb30fb8b20dbcbffff24ffab38c7dbc1c1e2c146bc7d23b2b240b2f98b39f2" +
    "9797f197cc55c2662e2e962e6de4cab8f8f83ff8932ad2c76565ec650f432689" +
    "f6f609f6e30ef8ff7575bc758f2356c907071b073812151c0404140420181c10" +
    "4949704972abe2393333ff3385aa99cce4e453e4736286b7d9d99ad986ec3543" +
    "b9b967b9a1b108ded0d0b7d0ceda0a67424257422a91d315c7c7fcc776a86f3b" +
    "6c6cc16c477519ad9090ea90f447d77a00000000000000008e8e8c8e04038d02" +
    "6f6fce6f5f7f10a150500d50bafdad5d0101050108060704c5c5f6c566a46133" +
    "dada95da9ee63c4f47474647028fc8013f3fc33fe582bdfccdcddecd26945913" +
    "6969d0696f6b02b9a2a210a279eb49b2e2e24de2437694af7a7a8f7af7017bf5" +
    "a7a701a751f552a6c6c6f9c67eae683f9393e593ec4dde760f0f330f78222d3c" +
    "0a0a220a503c362806061e0630141218e6e659e6636e88bf2b2b872b45fad1ac" +
    "9696f496c453c562a3a315a371ed4eb61c1c6c1ce0485470afaf29af11c56a86" +
    "6a6adf6a77610bb512125a12906c7e488484ae84543fbb2a3939dd39d596afe4" +
    "e7e75ce76b688fbbb0b04ab0e98737fa8282b082642ba932f7f70cf7eb08fffb" +
    "fefe21fea33ec0df9d9dd39d9c69f44e8787a1874c35b2265c5c315cdad5896d" +
    "8181bf817c21a03e3535e135b5be8bd4dede81debefe205fb4b45eb4c99f2bea" +
    "a5a50ba541f95caefcfc2bfcb332ced78080ba807427a73aefef74ef2b58b79b" +
    "cbcbc0cb16804b0bbbbb6dbbb1bd06d66b6bda6b7f670cb17676b37697295fc5" +
    "baba68bab9bb01d25a5a2f5aeac19b757d7d947dcf136ee978788578e70d75fd" +
    "0b0b270b583a312c9595fb95dc59cc6ee3e348e34b7093abadad23ad01c9648e" +
    "7474b974872551cd9898c298b477ef5a3b3bd73bc59aa1ec3636ee36adb482d8" +
    "6464e9640745218d6d6dc46d4f731ea9dcdc8bdcaef22e57f0f017f0d31aeae7" +
    "59592059f2cb9279a9a937a921d1789e4c4c614c5ab5f92d17174b17b872655c" +
    "7f7f9e7fdf1f60e19191ef91fc41d07eb8b862b8a9b70fdac9c9cac9068c4503" +
    "5757165782efb8411b1b771bd85a416ce0e047e0537a9aa76161f8612f5b3a99"
  ];
const KUPYNA_T = KUPYNA_T_SRC.map(parseHexWords); // [T0..T7] 各 256×BigInt
const KUPYNA_R = 0x00F0F0F0F0F0F0F3n;

function kupynaHash(bytes, bits) {
  const blockLen = bits === 256 ? 64 : 128;
  const stSize = blockLen / 8;
  const rounds = bits === 256 ? 10 : 14;
  const offsets = bits === 256 ? [0, 1, 2, 3, 4, 5, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 11];
  const threshold = blockLen - 12;

  const s = new BigUint64Array(stSize);
  s[0] = BigInt(blockLen); // RFC/标准：IV 首字 = blockLen（小端一字节），余 0

  const byteOf = (a) => Number(a & 0xffn);
  const G = (x, y) => {
    for (let i = 0; i < stSize; i++) {
      let acc = 0n;
      for (let j = 0; j < 8; j++) {
        acc ^= KUPYNA_T[j][byteOf(x[(i - offsets[j] + stSize) % stSize] >> BigInt(8 * j))];
      }
      y[i] = acc;
    }
  };
  const G1 = (x, y, round) => {
    for (let i = 0; i < stSize; i++) {
      let acc = 0n;
      for (let j = 0; j < 8; j++) {
        acc ^= KUPYNA_T[j][byteOf(x[(i - offsets[j] + stSize) % stSize] >> BigInt(8 * j))];
      }
      y[i] = acc ^ BigInt(i << 4) ^ round;
    }
  };
  const G2 = (x, y, round) => {
    for (let i = 0; i < stSize; i++) {
      let acc = 0n;
      for (let j = 0; j < 8; j++) {
        acc ^= KUPYNA_T[j][byteOf(x[(i - offsets[j] + stSize) % stSize] >> BigInt(8 * j))];
      }
      y[i] = acc + (KUPYNA_R ^ ((BigInt((stSize - 1 - i) * 16) ^ round) << 56n));
    }
  };
  const P = (x, y, round) => {
    for (let i = 0; i < stSize; i++) x[i] ^= (BigInt(i) << 4n) ^ round;
    G1(x, y, round + 1n);
    G(y, x);
  };
  const Q = (x, y, round) => {
    for (let j = 0; j < stSize; j++) {
      x[j] += KUPYNA_R ^ ((BigInt((stSize - 1 - j) * 16) ^ round) << 56n);
    }
    G2(x, y, round + 1n);
    G(y, x);
  };
  const transform = (b) => {
    const AP1 = new BigUint64Array(stSize);
    const AQ1 = new BigUint64Array(stSize);
    const tmp = new BigUint64Array(stSize);
    for (let c = 0; c < stSize; c++) { AP1[c] = s[c] ^ b[c]; AQ1[c] = b[c]; }
    for (let r = 0n; r < BigInt(rounds); r += 2n) {
      P(AP1, tmp, r);
      Q(AQ1, tmp, r);
    }
    for (let c = 0; c < stSize; c++) s[c] ^= AP1[c] ^ AQ1[c];
  };
  const block = (b8) => {
    const w = new BigUint64Array(stSize);
    for (let i = 0; i < stSize; i++) {
      let v = 0n;
      for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(b8[i * 8 + j]);
      w[i] = v;
    }
    transform(w);
  };
  const outputTransform = () => {
    const t1 = new BigUint64Array(s);
    const t2 = new BigUint64Array(stSize);
    for (let r = 0n; r < BigInt(rounds); r += 2n) P(t1, t2, r);
    for (let c = 0; c < stSize; c++) s[c] ^= t1[c];
  };

  // 流式消化
  let len = BigInt(bytes.length);
  let off = 0;
  const buf = new Uint8Array(blockLen);
  while (bytes.length - off >= blockLen) {
    buf.set(bytes.subarray(off, off + blockLen));
    block(buf);
    off += blockLen;
  }
  const rem = bytes.length - off;
  buf.fill(0);
  buf.set(bytes.subarray(off, off + rem));
  buf[rem] = 0x80;
  if (rem + 1 > threshold) {
    block(buf);
    buf.fill(0);
  }
  // 12 字节小端位长
  const bitLen = len * 8n;
  for (let i = 0; i < 12; i++) buf[threshold + i] = Number((bitLen >> BigInt(8 * i)) & 0xffn);
  block(buf);
  outputTransform();

  // 输出 = 状态字节序（小端逐字）尾部 bits/8 字节
  const full = new Uint8Array(blockLen);
  for (let i = 0; i < stSize; i++) {
    let v = s[i];
    for (let j = 0; j < 8; j++) { full[i * 8 + j] = Number(v & 0xffn); v >>= 8n; }
  }
  return full.slice(blockLen - bits / 8);
}

// ============================================================
// 注册（三个 op，cat 均 "hash"）
// ============================================================

const OPT_TEXT_HEX = [
  { value: "text", label: "文本" },
  { value: "hex", label: "hex" },
];

register({
  id: "argon2",
  cat: "hash",
  name: "Argon2 KDF（Argon2d/i/id）",
  desc: "RFC 9106 口令密钥派生（PHC 冠军），内存困难型，Argon2d/i/id 三型可选",
  params: [
    { key: "type", label: "类型", type: "select", default: "argon2id", options: [
      { value: "argon2d", label: "Argon2d（数据相关）" },
      { value: "argon2i", label: "Argon2i（数据无关，抗侧信道）" },
      { value: "argon2id", label: "Argon2id（混合，推荐）" },
    ] },
    { key: "inputType", label: "口令格式", type: "select", default: "text", options: OPT_TEXT_HEX },
    { key: "salt", label: "盐 salt", type: "text", default: "", placeholder: "盐（按下方格式解析）" },
    { key: "saltType", label: "盐格式", type: "select", default: "text", options: OPT_TEXT_HEX },
    { key: "t", label: "迭代次数 t", type: "number", default: 2 },
    { key: "m", label: "内存 m（KiB，≤65536）", type: "number", default: 16384 },
    { key: "p", label: "并行度 p", type: "number", default: 1 },
    { key: "tagLen", label: "输出字节数", type: "number", default: 32 },
    { key: "secret", label: "secret（hex，可空）", type: "text", default: "" },
    { key: "ad", label: "associated data（hex，可空）", type: "text", default: "" },
  ],
  run(text, p) {
    const type = A2_TYPES[p.type || "argon2id"];
    if (type === undefined) throw new Error("未知 Argon2 类型");
    const t = Math.floor(Number(p.t) || 2);
    const m = Math.floor(Number(p.m) || 16384);
    const pp = Math.floor(Number(p.p) || 1);
    const tagLen = Math.floor(Number(p.tagLen) || 32);
    if (t < 1 || t > 1024) throw new Error("t 需在 1..1024（护栏防页面卡死）");
    if (m < 8 || m > 65536) throw new Error("m 需在 8..65536 KiB（护栏 ≤64MiB 防页面崩）");
    if (pp < 1 || pp > 254) throw new Error("p 需在 1..254");
    if (tagLen < 4 || tagLen > 1024) throw new Error("tagLen 需在 4..1024");
    const pwd = inputBytes(text, p);
    const salt = p.saltType === "hex" ? hexBytes(p.salt) : te.encode(p.salt || "");
    return toHex(argon2Hash(pwd, salt, hexBytes(p.secret), hexBytes(p.ad), { type, t, m, p: pp, tagLen }));
  },
});

register({
  id: "tiger",
  cat: "hash",
  name: "Tiger / Tiger2 哈希（192-bit）",
  desc: "Anderson-Biham Tiger/192（ED2K/TTH 等 P2P 场景常见）；Tiger2 为 0x80 填充变体",
  params: [
    { key: "variant", label: "变体", type: "select", default: "tiger", options: [
      { value: "tiger", label: "Tiger（0x01 填充）" },
      { value: "tiger2", label: "Tiger2（0x80 填充）" },
    ] },
    { key: "inputType", label: "输入格式", type: "select", default: "text", options: OPT_TEXT_HEX },
  ],
  run(text, p) {
    return tigerHash(inputBytes(text, p), p.variant === "tiger2");
  },
});

register({
  id: "kupyna",
  cat: "hash",
  name: "Kupyna 哈希（DSTU 7564:2014）",
  desc: "乌克兰国家标准哈希（Grøstl 近亲），256/384/512 位输出可选",
  params: [
    { key: "bits", label: "输出位数", type: "select", default: "256", options: [
      { value: "256", label: "Kupyna-256" },
      { value: "384", label: "Kupyna-384" },
      { value: "512", label: "Kupyna-512" },
    ] },
    { key: "inputType", label: "输入格式", type: "select", default: "text", options: OPT_TEXT_HEX },
  ],
  run(text, p) {
    const bits = parseInt(p.bits, 10) || 256;
    if (![256, 384, 512].includes(bits)) throw new Error("输出位数仅支持 256/384/512");
    return toHex(kupynaHash(inputBytes(text, p), bits));
  },
});
