/*
 * lyra2.js — Lyra2 内存硬 KDF（The Lyra PHC team 2014，cat:'crypto'，run 型）。
 *
 * 算法照官方参考实现（abrkn/node-lyra2 的 lib/Lyra2.c + lib/Sponge.c，The Lyra
 * PHC team 2014 公共领域）逐函数移植，不编造：
 *
 *   海绵状态：16×uint64（小端），bitrate=12 字（96 字节块），capacity=4 字。
 *   initState：前 8 字清零，后 8 字 = Blake2b IV。
 *   置换：blake2bLyra = 12 轮 ROUND_LYRA（纯 G 排列，无消息词）；
 *         reducedBlake2bLyra = 1 轮。
 *   输入：pad10*1 填充的 pwd || salt || basil，basil = kLen||pwdlen||saltlen||
 *         timeCost||nRows||nCols（6 个 32 位小端）。矩阵列数恒 N_COLS=64，
 *         nCols 参数只进 basil（照 node-lyra2 语义）。
 *   Setup：reducedSqueezeRow 初始化 M[0]/M[1]，reducedDuplexRowSetup 逐行填充。
 *   Wandering：tCost 轮，奇偶轮方向交替，rowa = (state[0] ^ prev) % nRows。
 *   Wrap-up：absorb 最后一行，squeeze 出 kLen 字节。
 *
 * 权威向量（node-lyra2 create-vectors 生成）：
 *   pwd="the password" salt="the salt" tCost=2 mCost=1000 nCols=256 kLen=32
 *   → c4bb06266131c809fa985602bb03c3fefa318284c91465ae243d0387cb909d52
 *
 * 红线：算法照官方参考，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node --input-type=module -e "import('./src/core/lyra2.js').then(m=>m.selfCheck())"
 *
 * 契约：register({ id:"lyra2", cat:"crypto", name, desc, params, run })。
 */
import { register } from "./registry.js";

const MASK64 = 0xffffffffffffffffn;
const IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const BLOCK_WORDS = 12;   // bitrate：12 字 = 96 字节
const N_COLS = 64;        // 矩阵列数（固定，照 N_COLS 宏）
const ROW_WORDS = BLOCK_WORDS * N_COLS;

const rotr64 = (w, c) => ((w >> BigInt(c)) | (w << BigInt(64 - c))) & MASK64;

// ---- Blake2b G 排列（照 Sponge.h ROUND_LYRA） ----
function roundLyra(v) {
  // G(r,0,v[0],v[4],v[8],v[12]) 等 8 组
  const G = (a, b, c, d) => {
    v[a] = (v[a] + v[b]) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 32);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 24);
    v[a] = (v[a] + v[b]) & MASK64;
    v[d] = rotr64(v[d] ^ v[a], 16);
    v[c] = (v[c] + v[d]) & MASK64;
    v[b] = rotr64(v[b] ^ v[c], 63);
  };
  G(0, 4, 8, 12); G(1, 5, 9, 13); G(2, 6, 10, 14); G(3, 7, 11, 15);
  G(0, 5, 10, 15); G(1, 6, 11, 12); G(2, 7, 8, 13); G(3, 4, 9, 14);
}
function blake2bLyra(state) { for (let r = 0; r < 12; r++) roundLyra(state); }
function reducedBlake2bLyra(state) { roundLyra(state); }

function initState() {
  const st = new Array(16).fill(0n);
  for (let i = 0; i < 8; i++) st[8 + i] = IV[i];
  return st;
}

// 96 字节块小端 → 12 字，XOR 进 state 前 12 字后跑 12 轮
function absorbBlock(state, blockBytes) {
  for (let i = 0; i < BLOCK_WORDS; i++) {
    let w = 0n;
    for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(blockBytes[i * 8 + b]);
    state[i] ^= w;
  }
  blake2bLyra(state);
}

// row：ROW_WORDS 字（小端字节数组形式），每列拷 state 前 12 字 → 1 轮
function reducedSqueezeRow(state, rowBytes) {
  for (let col = 0; col < N_COLS; col++) {
    for (let i = 0; i < BLOCK_WORDS; i++) {
      let w = state[i];
      for (let b = 0; b < 8; b++) { rowBytes[(col * BLOCK_WORDS + i) * 8 + b] = Number(w & 0xffn); w >>= 8n; }
    }
    reducedBlake2bLyra(state);
  }
}

function readWord64(bytes, off) {
  let w = 0n;
  for (let b = 7; b >= 0; b--) w = (w << 8n) | BigInt(bytes[off + b]);
  return w;
}
function writeWord64(bytes, off, w) {
  for (let b = 0; b < 8; b++) { bytes[off + b] = Number(w & 0xffn); w >>= 8n; }
}

// reducedDuplexRowSetup：rowIn(prev) rowInOut(row*) rowOut(row)
function reducedDuplexRowSetup(state, rowIn, rowInOut, rowOut) {
  for (let col = 0; col < N_COLS; col++) {
    const offIn = col * BLOCK_WORDS * 8;
    for (let i = 0; i < BLOCK_WORDS; i++) {
      state[i] ^= readWord64(rowInOut, offIn + i * 8) ^ readWord64(rowIn, offIn + i * 8);
    }
    reducedBlake2bLyra(state);
    // rowOut = rand
    for (let i = 0; i < BLOCK_WORDS; i++) writeWord64(rowOut, offIn + i * 8, state[i]);
    // rowInOut ^= rotl64(rand, 1)（= rotr64(rand, 63)：state 字循环右移一位字序）
    for (let i = 0; i < BLOCK_WORDS; i++) {
      writeWord64(rowInOut, offIn + i * 8, readWord64(rowInOut, offIn + i * 8) ^ state[(i + 11) % BLOCK_WORDS]);
    }
  }
}

// reducedDuplexRow：rowOut ^= rand；rowInOut ^= rotl(rand)
function reducedDuplexRow(state, rowIn, rowInOut, rowOut) {
  for (let col = 0; col < N_COLS; col++) {
    const offIn = col * BLOCK_WORDS * 8;
    for (let i = 0; i < BLOCK_WORDS; i++) {
      state[i] ^= readWord64(rowInOut, offIn + i * 8) ^ readWord64(rowIn, offIn + i * 8);
    }
    reducedBlake2bLyra(state);
    for (let i = 0; i < BLOCK_WORDS; i++) {
      writeWord64(rowOut, offIn + i * 8, readWord64(rowOut, offIn + i * 8) ^ state[i]);
    }
    for (let i = 0; i < BLOCK_WORDS; i++) {
      writeWord64(rowInOut, offIn + i * 8, readWord64(rowInOut, offIn + i * 8) ^ state[(i + 11) % BLOCK_WORDS]);
    }
  }
}

function squeeze(state, out, len) {
  const fullBlocks = Math.floor(len / 96);
  let off = 0;
  for (let i = 0; i < fullBlocks; i++) {
    for (let w = 0; w < BLOCK_WORDS; w++) writeWord64(out, off + w * 8, state[w]);
    off += 96;
    blake2bLyra(state);
  }
  for (let w = 0; w < len % 96; w += 8) {
    const n = Math.min(8, (len % 96) - w);
    let v = state[w >> 3];
    for (let b = 0; b < n; b++) { out[off + w + b] = Number(v & 0xffn); v >>= 8n; }
  }
}

// ---- Lyra2 主函数（照 LYRA2.c） ----
function lyra2(pwd, salt, timeCost, nRows, nCols, kLen) {
  if (nRows < 2) throw new Error("mCost（行数）须 ≥ 2");
  if (timeCost < 1) throw new Error("tCost 须 ≥ 1");

  // ---- pad10*1：pwd || salt || basil(6×int32 LE)，96 字节块 ----
  const basil = new Uint8Array(24);
  const dv = new DataView(basil.buffer);
  dv.setInt32(0, kLen, true); dv.setInt32(4, pwd.length, true); dv.setInt32(8, salt.length, true);
  dv.setInt32(12, timeCost, true); dv.setInt32(16, nRows, true); dv.setInt32(20, nCols, true);
  const nBlocksInput = Math.floor((salt.length + pwd.length + 24) / 96) + 1;
  const input = new Uint8Array(nBlocksInput * 96);
  input.set(pwd, 0);
  input.set(salt, pwd.length);
  input.set(basil, pwd.length + salt.length);
  input[pwd.length + salt.length + 24] = 0x80;         // 首个填充字节
  input[nBlocksInput * 96 - 1] ^= 0x01;                // 末字节
  // 注：0x80 位置在 basil 之后（数据区之外），照 C：*ptrByte=0x80 即数据末尾下一字节

  // ---- 内存矩阵：nRows × 64 列 × 12 字 × 8 字节 ----
  const rowBytes = ROW_WORDS * 8;
  const matrix = new Uint8Array(nRows * rowBytes);

  // ---- 初始化海绵并吸收输入 ----
  const state = initState();
  for (let i = 0; i < nBlocksInput; i++) absorbBlock(state, input.subarray(i * 96, (i + 1) * 96));

  // ---- Setup ----
  reducedSqueezeRow(state, matrix.subarray(0, rowBytes));
  reducedSqueezeRow(state, matrix.subarray(1 * rowBytes, 2 * rowBytes));
  let row = 2, prev = 1, rowa = 0;
  while (row < nRows) {
    reducedDuplexRowSetup(state,
      matrix.subarray(prev * rowBytes, (prev + 1) * rowBytes),
      matrix.subarray(rowa * rowBytes, (rowa + 1) * rowBytes),
      matrix.subarray(row * rowBytes, (row + 1) * rowBytes));
    rowa--;
    if (rowa < 0) rowa = prev;
    prev = row;
    row++;
  }

  // ---- Wandering ----
  const maxIndex = nRows - 1;
  for (let tau = 1; tau <= timeCost; tau++) {
    // 奇 tau：从末行倒序
    row = maxIndex; prev = 0;
    do {
      rowa = Number((state[0] ^ BigInt(prev)) & 0xffffffffn) % nRows;
      reducedDuplexRow(state,
        matrix.subarray(prev * rowBytes, (prev + 1) * rowBytes),
        matrix.subarray(rowa * rowBytes, (rowa + 1) * rowBytes),
        matrix.subarray(row * rowBytes, (row + 1) * rowBytes));
      prev = row; row--;
    } while (row >= 0);
    if (++tau > timeCost) break;
    // 偶 tau：从首行正序
    row = 0; prev = maxIndex;
    do {
      rowa = Number((state[0] ^ BigInt(prev)) & 0xffffffffn) % nRows;
      reducedDuplexRow(state,
        matrix.subarray(prev * rowBytes, (prev + 1) * rowBytes),
        matrix.subarray(rowa * rowBytes, (rowa + 1) * rowBytes),
        matrix.subarray(row * rowBytes, (row + 1) * rowBytes));
      prev = row; row++;
    } while (row <= maxIndex);
  }

  // ---- Wrap-up ----
  absorbBlock(state, matrix.subarray(rowa * rowBytes, (rowa + 1) * rowBytes));
  const K = new Uint8Array(kLen);
  squeeze(state, K, kLen);
  return K;
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

function lyra2Run(text, p = {}) {
  const lines = [];
  lines.push("=== Lyra2 内存硬 KDF（PHC 2014，Blake2b 海绵）===");
  lines.push("");
  const passEnc = p.passEnc || "utf8";
  const saltEnc = p.saltEnc || "utf8";
  const pass = decodeInput(text, passEnc);
  const salt = decodeInput(p.salt != null ? p.salt : "", saltEnc);
  const tCost = parseInt(p.tCost, 10) || 2;
  const mCost = parseInt(p.mCost, 10) || 4;
  const nCols = parseInt(p.nCols, 10) || 256;
  const kLen = parseInt(p.kLen, 10) || 32;
  lines.push(`口令: ${pass.length} 字节（${passEnc}）`);
  lines.push(`盐:   ${salt.length} 字节（${saltEnc}）`);
  lines.push(`参数: tCost=${tCost}, mCost=${mCost}, nCols=${nCols}, kLen=${kLen}`);
  lines.push(`预计内存: ~${((mCost * 64 * 96) / 1024 / 1024).toFixed(2)} MB（行×64列×96B）`);
  lines.push("");
  try {
    const dk = lyra2(pass, salt, tCost, mCost, nCols, kLen);
    lines.push("--- 派生密钥 (Derived Key) ---");
    lines.push("hex: " + bytesToHex(dk));
  } catch (e) {
    lines.push("✗ " + (e.message || String(e)));
  }
  return lines.join("\n");
}

register({
  id: "lyra2",
  cat: "crypto",
  name: "Lyra2 密钥派生",
  desc: "Lyra2 内存硬口令 KDF（PHC 2014，Blake2b 海绵位率 768bit）：reduced-round duplex 填充内存矩阵 + 奇偶轮 Wandering 随机访问。抗 GPU/ASIC 暴力。参数 tCost（轮数）/mCost（行数，≥2）/nCols（basil 参数）/kLen。",
  params: [
    { key: "passEnc", label: "口令编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "salt", label: "盐 (salt)", type: "text", default: "", placeholder: "盐值" },
    { key: "saltEnc", label: "盐编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "tCost", label: "tCost（轮数）", type: "number", default: 2, placeholder: "2" },
    { key: "mCost", label: "mCost（行数）", type: "number", default: 4, placeholder: "4（内存=行×64×96B）" },
    { key: "nCols", label: "nCols（列数参数）", type: "number", default: 256, placeholder: "256" },
    { key: "kLen", label: "输出字节数 kLen", type: "number", default: 32, placeholder: "32" },
  ],
  run: lyra2Run,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑） ----
function selfCheck() {
  let fail = 0;
  const te = new TextEncoder();
  // 权威向量（node-lyra2 create-vectors）：
  const got = bytesToHex(lyra2(te.encode("the password"), te.encode("the salt"), 2, 1000, 256, 32));
  const exp = "c4bb06266131c809fa985602bb03c3fefa318284c91465ae243d0387cb909d52";
  if (got === exp) console.log("PASS 权威向量 t=2 m=1000 n=256 k=32");
  else { console.log("FAIL 权威向量\n  got      " + got + "\n  expected " + exp); fail++; }
  // 小参数确定性 + 雪崩
  const a = bytesToHex(lyra2(te.encode("password"), te.encode("salt"), 2, 4, 256, 32));
  const b = bytesToHex(lyra2(te.encode("password"), te.encode("salt"), 2, 4, 256, 32));
  const c = bytesToHex(lyra2(te.encode("password"), te.encode("salt2"), 2, 4, 256, 32));
  if (a === b) console.log("PASS 确定性");
  else { console.log("FAIL 确定性"); fail++; }
  if (a !== c) console.log("PASS 盐改变结果");
  else { console.log("FAIL 盐改变结果"); fail++; }
  console.log(fail === 0 ? "Lyra2 selfCheck 全部 PASS" : `Lyra2 selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { lyra2, selfCheck };
