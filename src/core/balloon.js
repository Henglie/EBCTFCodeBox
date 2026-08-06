/*
 * balloon.js — Balloon 内存硬 KDF（Boneh/Corrigan-Gibbs/Schechter 2016，cat:'crypto'，run 型）。
 *
 * 算法照权威参考实现（samuel-lucas6/Balloon.NET，其测试向量源自 RustCrypto
 * balloon-hash 与 nachonavarro/balloon-hashing，两独立来源一致）移植，不编造：
 *
 *   Hash(buf, counter, a, b)：SHA-256(counter(8B LE) || a || b)，counter 逐字节进位。
 *   Expand：buffer[0] = Hash(∅, counter, password, salt)；
 *           buffer[m] = Hash(buffer[m-1], counter, ...) 链式填充（空间 sCost 块 × 32B）。
 *   Mix（tCost 轮）：每块 current 先混 previous（首块用末块），再生成 delta 个
 *     伪随机索引（SHA-256(t||m||i) 后再 Hash(salt, idxHash) 取模 sCost，盐参与
 *     访问模式——原版 Balloon 特性），逐块混入。
 *   Extract：取 buffer 末块。
 *
 * 权威向量（password, salt, sCost, tCost → 32B）：
 *   hunter42/examplesalt/1024/3 → 716043df...40dfb
 *   ""/salt/3/3 → 5f02f820...577378
 *   password/""/3/3 → 20aa99d7...6a6cc
 *   "\0"/"\0"/3/3 → 4fc7e302...b73a4
 *   password/salt/1/1 → eefda4a8...174545
 *
 * 红线：算法照权威参考，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node --input-type=module -e "import('./src/core/balloon.js').then(m=>m.selfCheck())"
 *
 * 契约：register({ id:"balloon", cat:"crypto", name, desc, params, run })。
 */
import { register } from "./registry.js";

// ============================================================
// 同步 SHA-256（FIPS 180-4 标准实现）
// ============================================================
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256Sync(bytes) {
  // 填充：0x80 + 0x00... + 64 位大端位长
  const bitLen = BigInt(bytes.length * 8);
  const padLen = ((bytes.length + 8) >> 6 << 6) + 64;
  const msg = new Uint8Array(padLen);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  for (let i = 0; i < 8; i++) msg[padLen - 1 - i] = Number((bitLen >> BigInt(i * 8)) & 0xffn);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  const dv = new DataView(msg.buffer, msg.byteOffset, msg.length);
  const ROR = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = ROR(w[i - 15], 7) ^ ROR(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = ROR(w[i - 2], 17) ^ ROR(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i++) {
      const S1 = ROR(e, 6) ^ ROR(e, 11) ^ ROR(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + w[i]) >>> 0;
      const S0 = ROR(a, 2) ^ ROR(a, 13) ^ ROR(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const od = new DataView(out.buffer);
  od.setUint32(0, h0, false); od.setUint32(4, h1, false); od.setUint32(8, h2, false); od.setUint32(12, h3, false);
  od.setUint32(16, h4, false); od.setUint32(20, h5, false); od.setUint32(24, h6, false); od.setUint32(28, h7, false);
  return out;
}

// ============================================================
// Balloon 主算法（照 Balloon.NET 语义）
// ============================================================
const HASH_LEN = 32;
const MIN_DELTA = 3;

// counter（8 字节小端，逐字节进位）；返回 (out32, counter)
function balloonHash(counter, a, b) {
  // SHA-256(counter(8B LE) || a || b)
  const data = new Uint8Array(8 + a.length + b.length);
  data.set(counter);
  data.set(a, 8);
  data.set(b, 8 + a.length);
  const out = sha256Sync(data);
  // counter 递增（8 字节小端逐字节进位，照 C# counter[i]++ 进位逻辑）
  for (let i = 0; i < 8; i++) {
    counter[i]++;
    if (counter[i] !== 0) break;
  }
  return out;
}

// 主函数：balloon(password, salt, sCost, tCost, delta) → Uint8Array(32)
function balloon(password, salt, sCost, tCost, delta = MIN_DELTA) {
  if (sCost < 1) throw new Error("sCost 须 ≥ 1");
  if (tCost < 1) throw new Error("tCost 须 ≥ 1");
  if (delta < MIN_DELTA) throw new Error(`delta 须 ≥ ${MIN_DELTA}`);
  const buffer = new Uint8Array(sCost * HASH_LEN);
  const counter = new Uint8Array(8);
  const idxBlock = new Uint8Array(16 + HASH_LEN); // t||m||i(各 8B) + 32B hash 区
  // ---- Expand ----
  buffer.set(balloonHash(counter, password, salt), 0);
  const EMPTY = new Uint8Array(0);
  for (let m = 1; m < sCost; m++) {
    buffer.set(balloonHash(counter, buffer.subarray((m - 1) * HASH_LEN, m * HASH_LEN), EMPTY), m * HASH_LEN);
  }
  // ---- Mix ----
  for (let t = 0; t < tCost; t++) {
    new DataView(idxBlock.buffer).setUint32(0, t, true);
    for (let m = 0; m < sCost; m++) {
      const prevOff = m === 0 ? (sCost - 1) * HASH_LEN : (m - 1) * HASH_LEN;
      const curOff = m * HASH_LEN;
      const current = buffer.subarray(curOff, curOff + HASH_LEN);
      // 先混 previous || current
      const mixed = balloonHash(counter, buffer.subarray(prevOff, prevOff + HASH_LEN), current);
      current.set(mixed);
      // delta 个伪随机索引（盐参与——原版 Balloon）
      new DataView(idxBlock.buffer).setUint32(8, m, true);
      for (let i = 0; i < delta; i++) {
        new DataView(idxBlock.buffer).setUint32(16, i, true);
        const idxHash = sha256Sync(idxBlock.subarray(0, 24));
        const otherHash = balloonHash(counter, salt, idxHash);
        // other = 小端大整数 % sCost
        let other = 0n;
        for (let b = 31; b >= 0; b--) other = (other << 8n) | BigInt(otherHash[b]);
        const otherOff = Number(other % BigInt(sCost)) * HASH_LEN;
        const m2 = balloonHash(counter, current, buffer.subarray(otherOff, otherOff + HASH_LEN));
        current.set(m2);
      }
    }
  }
  return buffer.subarray(buffer.length - HASH_LEN).slice();
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

function balloonRun(text, p = {}) {
  const lines = [];
  lines.push("=== Balloon 内存硬 KDF（Boneh 2016，SHA-256 实例）===");
  lines.push("");
  const passEnc = p.passEnc || "utf8";
  const saltEnc = p.saltEnc || "utf8";
  const pass = decodeInput(text, passEnc);
  const salt = decodeInput(p.salt != null ? p.salt : "", saltEnc);
  const sCost = parseInt(p.sCost, 10) || 1024;
  const tCost = parseInt(p.tCost, 10) || 3;
  const delta = parseInt(p.delta, 10) || MIN_DELTA;
  lines.push(`口令: ${pass.length} 字节（${passEnc}）`);
  lines.push(`盐:   ${salt.length} 字节（${saltEnc}）`);
  lines.push(`参数: sCost=${sCost}, tCost=${tCost}, delta=${delta}`);
  lines.push(`预计内存: ~${((sCost * 32) / 1024 / 1024).toFixed(2)} MB（sCost×32B）`);
  lines.push("");
  try {
    const dk = balloon(pass, salt, sCost, tCost, delta);
    lines.push("--- 派生密钥 (Derived Key) ---");
    lines.push("hex: " + bytesToHex(dk));
  } catch (e) {
    lines.push("✗ " + (e.message || String(e)));
  }
  return lines.join("\n");
}

register({
  id: "balloon",
  cat: "crypto",
  name: "Balloon 密钥派生",
  desc: "Balloon 内存硬口令 KDF（Boneh/Corrigan-Gibbs/Schechter 2016，SHA-256 实例）：盐参与伪随机访问模式（原版设计），delta=3 伪随机块混入。抗 GPU/ASIC 暴力。参数 sCost（空间块数）/tCost（轮数）/delta。",
  params: [
    { key: "passEnc", label: "口令编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "salt", label: "盐 (salt)", type: "text", default: "", placeholder: "盐值" },
    { key: "saltEnc", label: "盐编码", type: "select", default: "utf8", options: [
      { value: "utf8", label: "UTF-8 文本" }, { value: "hex", label: "Hex" }, { value: "base64", label: "Base64" },
    ] },
    { key: "sCost", label: "sCost（空间块数）", type: "number", default: 1024, placeholder: "1024（≈32KB）" },
    { key: "tCost", label: "tCost（轮数）", type: "number", default: 3, placeholder: "3" },
    { key: "delta", label: "delta（随机块数）", type: "number", default: 3, placeholder: "3" },
  ],
  run: balloonRun,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑） ----
function selfCheck() {
  let fail = 0;
  const te = new TextEncoder();
  const cases = [
    { p: "hunter42", s: "examplesalt", sCost: 1024, tCost: 3, exp: "716043dff777b44aa7b88dcbab12c078abecfac9d289c5b5195967aa63440dfb" },
    { p: "", s: "salt", sCost: 3, tCost: 3, exp: "5f02f8206f9cd212485c6bdf85527b698956701ad0852106f94b94ee94577378" },
    { p: "password", s: "", sCost: 3, tCost: 3, exp: "20aa99d7fe3f4df4bd98c655c5480ec98b143107a331fd491deda885c4d6a6cc" },
    { p: "\0", s: "\0", sCost: 3, tCost: 3, exp: "4fc7e302ffa29ae0eac31166cee7a552d1d71135f4e0da66486fb68a749b73a4" },
    { p: "password", s: "salt", sCost: 1, tCost: 1, exp: "eefda4a8a75b461fa389c1dcfaf3e9dfacbc26f81f22e6f280d15cc18c417545" },
  ];
  // SHA-256 自身向量（FIPS 180-4 "abc"）
  if (bytesToHex(sha256Sync(te.encode("abc"))) === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") {
    console.log("PASS SHA-256 向量 abc");
  } else { console.log("FAIL SHA-256 向量 abc"); fail++; }
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const got = bytesToHex(balloon(te.encode(c.p), te.encode(c.s), c.sCost, c.tCost));
    if (got === c.exp) console.log(`PASS 权威向量 ${i + 1}（p="${c.p}" s="${c.s}" sCost=${c.sCost} tCost=${c.tCost}）`);
    else { console.log(`FAIL 权威向量 ${i + 1}\n  got      ${got}\n  expected ${c.exp}`); fail++; }
  }
  console.log(fail === 0 ? "Balloon selfCheck 全部 PASS" : `Balloon selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { balloon, sha256Sync, selfCheck };
