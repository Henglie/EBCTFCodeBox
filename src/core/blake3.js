/*
 * blake3.js — BLAKE3 加密哈希（cat:'hash'，run 型）。
 *
 * BLAKE3（O'Connor/Aumasson/Neves/Wilcox-O'Hearn 2020）：基于 BLAKE2 的 G 函数
 * 与 Merkle 树结构，支持无限输出（XOF）。本实现照官方规范：
 *   - 压缩函数：7 轮，每轮 8 次 G 混合（列 4 次 + 对角 4 次）+ 消息置换。
 *   - 分块：chunk = 1024 字节（16 个 64 字节块），跨块链接。
 *   - 树：叶为 chunk，父节点两两合并 CV；根节点带 ROOT 标志，可扩展输出。
 *   - IV = SHA-256 IV（8 个 32 位字）。
 *
 * 标志位：CHUNK_START=1 / CHUNK_END=2 / PARENT=4 / ROOT=8。
 * （KEYED_HASH / DERIVE_KEY 未实现，本 op 仅纯哈希。）
 *
 * 落地照官方 test_vectors.json（input = 字节 i mod 251 重复），
 * 交付前跑官方向量（含 1024/1025 多 chunk 边界）验证。
 *
 * 红线：算法照官方规范；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 契约：register({ id:"blake3", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

// SHA-256 IV
const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;

// 复用 scratch：消息块、压缩输出、chunk CV、父块
const MBUF = new Uint32Array(16);
const OUT16 = new Uint32Array(16);
const CVBUF = new Uint32Array(8);
const PARENT_BUF = new Uint32Array(16);
const CV_POOL = [];

// 压缩写入 out[0..15]（out 不可与 cv 别名）。7 轮全展开 + 局部变量，
// 避免每次压缩的数组分配和 TypedArray 下标访问。cv=8 字，block=16 字。
function compressInto(cv, block, counter, blockLen, flags, out) {
  let s0 = cv[0] >>> 0;
  let s1 = cv[1] >>> 0;
  let s2 = cv[2] >>> 0;
  let s3 = cv[3] >>> 0;
  let s4 = cv[4] >>> 0;
  let s5 = cv[5] >>> 0;
  let s6 = cv[6] >>> 0;
  let s7 = cv[7] >>> 0;
  let s8 = 1779033703;
  let s9 = 3144134277;
  let s10 = 1013904242;
  let s11 = 2773480762;
  let s12 = counter >>> 0;
  let s13 = Math.floor(counter / 4294967296) >>> 0;
  let s14 = blockLen >>> 0;
  let s15 = flags >>> 0;
  let m0 = 0, m1 = 0, m2 = 0, m3 = 0, m4 = 0, m5 = 0, m6 = 0, m7 = 0, m8 = 0, m9 = 0, m10 = 0, m11 = 0, m12 = 0, m13 = 0, m14 = 0, m15 = 0;
  // round 0
  m0 = block[0];
  m1 = block[1];
  m2 = block[2];
  m3 = block[3];
  m4 = block[4];
  m5 = block[5];
  m6 = block[6];
  m7 = block[7];
  m8 = block[8];
  m9 = block[9];
  m10 = block[10];
  m11 = block[11];
  m12 = block[12];
  m13 = block[13];
  m14 = block[14];
  m15 = block[15];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 1
  m0 = block[2];
  m1 = block[6];
  m2 = block[3];
  m3 = block[10];
  m4 = block[7];
  m5 = block[0];
  m6 = block[4];
  m7 = block[13];
  m8 = block[1];
  m9 = block[11];
  m10 = block[12];
  m11 = block[5];
  m12 = block[9];
  m13 = block[14];
  m14 = block[15];
  m15 = block[8];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 2
  m0 = block[3];
  m1 = block[4];
  m2 = block[10];
  m3 = block[12];
  m4 = block[13];
  m5 = block[2];
  m6 = block[7];
  m7 = block[14];
  m8 = block[6];
  m9 = block[5];
  m10 = block[9];
  m11 = block[0];
  m12 = block[11];
  m13 = block[15];
  m14 = block[8];
  m15 = block[1];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 3
  m0 = block[10];
  m1 = block[7];
  m2 = block[12];
  m3 = block[9];
  m4 = block[14];
  m5 = block[3];
  m6 = block[13];
  m7 = block[15];
  m8 = block[4];
  m9 = block[0];
  m10 = block[11];
  m11 = block[2];
  m12 = block[5];
  m13 = block[8];
  m14 = block[1];
  m15 = block[6];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 4
  m0 = block[12];
  m1 = block[13];
  m2 = block[9];
  m3 = block[11];
  m4 = block[15];
  m5 = block[10];
  m6 = block[14];
  m7 = block[8];
  m8 = block[7];
  m9 = block[2];
  m10 = block[5];
  m11 = block[3];
  m12 = block[0];
  m13 = block[1];
  m14 = block[6];
  m15 = block[4];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 5
  m0 = block[9];
  m1 = block[14];
  m2 = block[11];
  m3 = block[5];
  m4 = block[8];
  m5 = block[12];
  m6 = block[15];
  m7 = block[1];
  m8 = block[13];
  m9 = block[3];
  m10 = block[0];
  m11 = block[10];
  m12 = block[2];
  m13 = block[6];
  m14 = block[4];
  m15 = block[7];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  // round 6
  m0 = block[11];
  m1 = block[15];
  m2 = block[5];
  m3 = block[0];
  m4 = block[1];
  m5 = block[9];
  m6 = block[8];
  m7 = block[6];
  m8 = block[14];
  m9 = block[10];
  m10 = block[2];
  m11 = block[12];
  m12 = block[3];
  m13 = block[4];
  m14 = block[7];
  m15 = block[13];
  {
    let t;
    s0 = (s0 + s4 + m0) >>> 0; t = s12 ^ s0; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s4 + m1) >>> 0; t = s12 ^ s0; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s12) >>> 0; t = s4 ^ s8; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s5 + m2) >>> 0; t = s13 ^ s1; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s5 + m3) >>> 0; t = s13 ^ s1; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s13) >>> 0; t = s5 ^ s9; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s6 + m4) >>> 0; t = s14 ^ s2; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s6 + m5) >>> 0; t = s14 ^ s2; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s14) >>> 0; t = s6 ^ s10; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s7 + m6) >>> 0; t = s15 ^ s3; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s7 + m7) >>> 0; t = s15 ^ s3; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s15) >>> 0; t = s7 ^ s11; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s0 = (s0 + s5 + m8) >>> 0; t = s15 ^ s0; s15 = ((t >>> 16) | (t << 16)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 12) | (t << 20)) >>> 0;
    s0 = (s0 + s5 + m9) >>> 0; t = s15 ^ s0; s15 = ((t >>> 8) | (t << 24)) >>> 0;
    s10 = (s10 + s15) >>> 0; t = s5 ^ s10; s5 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s1 = (s1 + s6 + m10) >>> 0; t = s12 ^ s1; s12 = ((t >>> 16) | (t << 16)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 12) | (t << 20)) >>> 0;
    s1 = (s1 + s6 + m11) >>> 0; t = s12 ^ s1; s12 = ((t >>> 8) | (t << 24)) >>> 0;
    s11 = (s11 + s12) >>> 0; t = s6 ^ s11; s6 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s2 = (s2 + s7 + m12) >>> 0; t = s13 ^ s2; s13 = ((t >>> 16) | (t << 16)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 12) | (t << 20)) >>> 0;
    s2 = (s2 + s7 + m13) >>> 0; t = s13 ^ s2; s13 = ((t >>> 8) | (t << 24)) >>> 0;
    s8 = (s8 + s13) >>> 0; t = s7 ^ s8; s7 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  {
    let t;
    s3 = (s3 + s4 + m14) >>> 0; t = s14 ^ s3; s14 = ((t >>> 16) | (t << 16)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 12) | (t << 20)) >>> 0;
    s3 = (s3 + s4 + m15) >>> 0; t = s14 ^ s3; s14 = ((t >>> 8) | (t << 24)) >>> 0;
    s9 = (s9 + s14) >>> 0; t = s4 ^ s9; s4 = ((t >>> 7) | (t << 25)) >>> 0;
  }
  out[0] = (s0 ^ s8) >>> 0;
  out[1] = (s1 ^ s9) >>> 0;
  out[2] = (s2 ^ s10) >>> 0;
  out[3] = (s3 ^ s11) >>> 0;
  out[4] = (s4 ^ s12) >>> 0;
  out[5] = (s5 ^ s13) >>> 0;
  out[6] = (s6 ^ s14) >>> 0;
  out[7] = (s7 ^ s15) >>> 0;
  out[8] = (s8 ^ cv[0]) >>> 0;
  out[9] = (s9 ^ cv[1]) >>> 0;
  out[10] = (s10 ^ cv[2]) >>> 0;
  out[11] = (s11 ^ cv[3]) >>> 0;
  out[12] = (s12 ^ cv[4]) >>> 0;
  out[13] = (s13 ^ cv[5]) >>> 0;
  out[14] = (s14 ^ cv[6]) >>> 0;
  out[15] = (s15 ^ cv[7]) >>> 0;
}

/** 兼容导出的压缩函数：返回长度 16 的普通数组（前 8 为链接值）。 */
function compress(cv, block, counter, blockLen, flags) {
  const bb = block instanceof Uint32Array ? block : Uint32Array.from(block);
  const out = new Uint32Array(16);
  compressInto(cv, bb, counter, blockLen, flags, out);
  return Array.from(out);
}

// 按小端读入 len 字节到 16 字缓冲（不足补零）
function wordsInto(buf, bytes, start, len) {
  buf.fill(0);
  const nw = len >> 2;
  let i = 0;
  for (; i < nw; i++) {
    const p = start + i * 4;
    buf[i] = (bytes[p] | (bytes[p + 1] << 8) | (bytes[p + 2] << 16) | (bytes[p + 3] << 24)) >>> 0;
  }
  const rem = len & 3;
  if (rem) {
    const p = start + i * 4;
    let v = 0;
    for (let j = 0; j < rem; j++) v |= bytes[p + j] << (8 * j);
    buf[i] = v >>> 0;
  }
}

// 最大的严格小于 n 的 2 的幂（n>1）
function largestPow2Below(n) {
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

function getCV(row, idx) {
  const k = row * 2 + idx;
  let b = CV_POOL[k];
  if (!b) { b = new Uint32Array(8); CV_POOL[k] = b; }
  return b;
}

// chunk 的最终 CV（子树用）
function chunkCVInto(input, start, len, chunkIndex, flags, initCV, out8) {
  CVBUF.set(initCV);
  const nBlocks = Math.max(1, Math.ceil(len / 64));
  for (let i = 0; i < nBlocks; i++) {
    const blockLen = Math.min(64, len - i * 64);
    wordsInto(MBUF, input, start + i * 64, blockLen);
    let bf = flags;
    if (i === 0) bf |= CHUNK_START;
    if (i === nBlocks - 1) bf |= CHUNK_END;
    compressInto(CVBUF, MBUF, chunkIndex, blockLen, bf, OUT16);
    CVBUF.set(OUT16.subarray(0, 8));
  }
  out8.set(CVBUF.subarray(0, 8));
}

// chunk 的可 root 化输出描述（根为单 chunk 时用）
function chunkOutputInto(input, start, len, chunkIndex, flags, initCV, o) {
  CVBUF.set(initCV);
  const nBlocks = Math.max(1, Math.ceil(len / 64));
  for (let i = 0; i < nBlocks - 1; i++) {
    wordsInto(MBUF, input, start + i * 64, 64);
    let bf = flags;
    if (i === 0) bf |= CHUNK_START;
    compressInto(CVBUF, MBUF, chunkIndex, 64, bf, OUT16);
    CVBUF.set(OUT16.subarray(0, 8));
  }
  const lastLen = Math.min(64, len - (nBlocks - 1) * 64);
  wordsInto(MBUF, input, start + (nBlocks - 1) * 64, lastLen);
  o.cv.set(CVBUF.subarray(0, 8));
  o.block.set(MBUF);
  o.counter = chunkIndex;
  o.blockLen = lastLen;
  o.flags = flags | CHUNK_END | (nBlocks === 1 ? CHUNK_START : 0);
}

// 子树根 CV（全部压缩为 CV）
function subtreeCV(input, start, len, chunkIndexStart, flags, initCV, out8, row) {
  if (len <= 1024) {
    chunkCVInto(input, start, len, chunkIndexStart, flags, initCV, out8);
    return;
  }
  const nChunks = Math.ceil(len / 1024);
  const leftChunks = largestPow2Below(nChunks);
  const leftLen = leftChunks * 1024;
  const l = getCV(row + 1, 0), r = getCV(row + 1, 1);
  subtreeCV(input, start, leftLen, chunkIndexStart, flags, initCV, l, row + 1);
  subtreeCV(input, start + leftLen, len - leftLen, chunkIndexStart + leftChunks, flags, initCV, r, row + 1);
  PARENT_BUF.set(l, 0);
  PARENT_BUF.set(r, 8);
  compressInto(initCV, PARENT_BUF, 0, 64, flags | PARENT, OUT16);
  out8.set(OUT16.subarray(0, 8));
}

// 递归树：根 output 描述写入 o
function hashTreeRoot(input, start, len, chunkIndexStart, flags, initCV, o) {
  if (len <= 1024) {
    chunkOutputInto(input, start, len, chunkIndexStart, flags, initCV, o);
    return;
  }
  const nChunks = Math.ceil(len / 1024);
  const leftChunks = largestPow2Below(nChunks);
  const leftLen = leftChunks * 1024;
  const l = getCV(0, 0), r = getCV(0, 1);
  subtreeCV(input, start, leftLen, chunkIndexStart, flags, initCV, l, 0);
  subtreeCV(input, start + leftLen, len - leftLen, chunkIndexStart + leftChunks, flags, initCV, r, 0);
  o.cv.set(initCV);
  o.block.set(l, 0);
  o.block.set(r, 8);
  o.counter = 0;
  o.blockLen = 64;
  o.flags = flags | PARENT;
}

const ROOT_DESC = {
  cv: new Uint32Array(8),
  block: new Uint32Array(16),
  counter: 0,
  blockLen: 0,
  flags: 0,
};

// 根输出扩展到 outLen 字节（XOF）
function rootBytes(o, outLen) {
  const out = new Uint8Array(outLen);
  let pos = 0;
  let ctr = 0;
  while (pos < outLen) {
    compressInto(o.cv, o.block, ctr, o.blockLen, o.flags | ROOT, OUT16);
    for (let w = 0; w < 16 && pos < outLen; w++) {
      const word = OUT16[w];
      for (let b = 0; b < 4 && pos < outLen; b++) out[pos++] = (word >>> (8 * b)) & 0xff;
    }
    ctr++;
  }
  return out;
}

const KEYED_HASH = 16;

/** 32 字节密钥 → 8 个 32 位初始链接值（BLAKE3 keyed 模式以密钥字替代 IV）。 */
function keyWords(keyBytes) {
  const w = new Uint32Array(8);
  for (let i = 0; i < 8; i++) {
    w[i] = (keyBytes[i * 4] | (keyBytes[i * 4 + 1] << 8) | (keyBytes[i * 4 + 2] << 16) | (keyBytes[i * 4 + 3] << 24)) >>> 0;
  }
  return w;
}

function blake3(inputBytes, outLen = 32, keyBytes = null) {
  if (keyBytes != null && keyBytes.length !== 32) throw new Error("BLAKE3 keyed 模式密钥须为 32 字节");
  const flags = keyBytes ? KEYED_HASH : 0;
  const initCV = keyBytes ? keyWords(keyBytes) : IV;
  hashTreeRoot(inputBytes, 0, inputBytes.length, 0, flags, initCV, ROOT_DESC);
  return rootBytes(ROOT_DESC, outLen);
}

// ============ 编解码工具 ============
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
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
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function blake3Run(text, p = {}) {
  if (p && p.inputMode != null && String(p.inputMode).toLowerCase() !== "text") {
    throw new Error("inputMode 该参数已废弃，请改用输入视图");
  }
  const inputMode = "text";
  let input;
  if (p && p.rawBytes != null) input = (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes)); // rawBytes 契约（字节直通）
  else input = new TextEncoder().encode(String(text || ""));

  let outLen = parseInt((p && p.outLen) || "32", 10);
  if (!Number.isFinite(outLen) || outLen < 1) outLen = 32;
  if (outLen > 4096) outLen = 4096; // 防滥用

  const keyText = String((p && p.keyText) || "");
  let keyBytes = null;
  if (keyText !== "") {
    keyBytes = new TextEncoder().encode(keyText);
    if (keyBytes.length !== 32) throw new Error(`BLAKE3 keyed 密钥须恰为 32 字节（UTF-8），当前 ${keyBytes.length} 字节`);
  }

  const digest = blake3(input, outLen, keyBytes);
  const lines = [];
  lines.push("=== BLAKE3 加密哈希 ===");
  lines.push(`输入: ${input.length} 字节（${inputMode}）`);
  lines.push(`输出长度: ${outLen} 字节（XOF 可扩展）`);
  if (keyBytes) lines.push("模式: keyed（KEYED_HASH，32 字节密钥）");
  lines.push("");
  lines.push(`hex:    ${bytesToHex(digest)}`);
  lines.push(`base64: ${bytesToB64(digest)}`);
  return lines.join("\n");
}

register({
  id: "blake3", family: "blake", familyLabel: "blake3",
  cat: "hash",
  name: "BLAKE3",
  desc: "BLAKE3 加密哈希（O'Connor/Aumasson/Neves/Wilcox-O'Hearn 2020）：BLAKE2 G 函数 + Merkle 树 + 无限输出（XOF）。7 轮压缩，chunk=1024 字节。默认 32 字节输出，可扩展。官方 test_vectors 验证。",
  params: [
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "默认 32（XOF 可扩展，最大 4096）" },
    { key: "keyText", label: "密钥（UTF-8，恰 32 字节；留空=普通哈希）", type: "text", default: "", placeholder: "CyberChef Key；非空时启用 keyed 模式" },
  ],
  run: blake3Run,
  acceptsBytes: true,
});

export { blake3, compress, bytesToHex, hexToBytes };
