/*
 * xoodyak.js — Xoodyak：Xoodoo[12] 置换 + Cyclist 模式（NIST 轻量级密码竞赛决赛规范）。
 *
 * 规范依据（只引用公开标准与作者官方实现）：
 * - NIST LWC 决赛规范 "Xoodyak, a lightweight cryptographic scheme"
 *   （Daemen, Hoffert, Mella, Peeters, Van Assche, Van Keer；
 *     csrc.nist.gov 决赛轮 updated-spec-doc / keccak.team/xoodyak.html 链接的同一份 PDF）。
 *     算法逐词对照：Algorithm 1（Xoodoo 五步 θ/ρwest/ι/χ/ρeast）、Table 2（轮常数
 *     c-11..c0）、Algorithm 2/3（Cyclist 的 Down/Up/AbsorbAny/AbsorbKey/Crypt/
 *     SqueezeAny，帧位 '01' 紧跟数据块、色字节在状态最后一字节）、Definition 2
 *     （Xoodyak = Cyclist[Xoodoo[12] 48B, Rhash=16, Rkin=44, Rkout=24, lRatchet=16]）。
 * - 官方 C 参考实现（NIST 决赛提交包 Implementations/.../ref/，Xoodoo-reference.c、
 *     Cyclist.inc、Xoodyak.c、encrypt.c、hash.c，作者 Ronny Van Keer，CC0）。
 * - 正确性以 NIST 官方 KAT 终裁（LWC_AEAD_KAT_128_128.txt / LWC_HASH_KAT_256.txt，
 *   genKAT 生成；提交包命名 keybits_tagbits，与 XKCP 仓库 XOODYAK_LWC_AEAD_KAT_128_256
 *   同源同内容）。
 *
 * 状态布局：Xoodoo 状态 384 位 = 12 条 32 位 lane，lane 与字节按小端映射
 *   （i = z + 32(x + 4y)）。Cyclist 只用前 48 字节：数据块从偏移 0 起 XOR，
 *   帧位 0x01 XOR 在块尾（偏移 |Xi|），色字节 XOR 在状态最后一字节（偏移 47）。
 *
 * 双色域：hash 模式为单色（Down 色取 Cd & 0x01，Up 不加色）；
 *   keyed 模式双色（Down 色：键块 '02'、首个 Absorb 块 '03'、其余 '00'；
 *   Up 色：首个 Crypt 块 '80'、首个 Squeeze '40'、其余 '00'）。
 *
 * 本文件两个 op：
 *   - xoodyakHash：Xoodyak-Hash（任意字节 → 32 字节摘要）。
 *   - xoodyakAead：Xoodyak-AE（key 16B / nonce 16B，ad 可空；tag 16 字节）。
 *     key/nonce 均为必填参数，不生成任何随机数（nonce 必须一次性使用，由调用方保证）。
 *
 * 红线：core 层零 UI/DOM 依赖；纯本地计算零外发；不取随机字节。
 */
import { register } from "./registry.js";
import { finishBytesDecode } from "./bytesIo.js";

// ============================================================
// Xoodoo[12] 置换（Algorithm 1，Table 2 轮常数）
// ============================================================

// Table 2：轮常数 c-11..c0（首轮用 c-11，末轮用 c0；lane x=0，最低位在 z=0）
const XOODBOO_RC = [
  0x00000058, 0x00000038, 0x000003c0, 0x000000d0,
  0x00000120, 0x00000014, 0x00000060, 0x0000002c,
  0x00000380, 0x000000f0, 0x000001a0, 0x00000012,
];

const ROT_MASK = 0xffffffff;

function rotl32(v, n) {
  return (((v << n) | (v >>> (32 - n))) & ROT_MASK) >>> 0;
}

/**
 * Xoodoo[12]：state 为 48 字节 Uint8Array，就地置换（lane 小端）。
 * 每轮五步：θ（列奇偶混合）→ ρwest（平面移位）→ ι（轮常数）→ χ（非线性层）→ ρeast。
 * lane 索引 index(x,y) = 4y + x（x 为列 0..3，y 为平面 0..2）。
 */
export function xoodooPermute12(state) {
  const a = new Uint32Array(12);
  for (let i = 0; i < 12; i++) {
    a[i] = (state[4 * i] | (state[4 * i + 1] << 8) | (state[4 * i + 2] << 16) | (state[4 * i + 3] << 24)) >>> 0;
  }
  const b = new Uint32Array(12);

  for (let round = 0; round < 12; round++) {
    // θ：P = A0+A1+A2（每列三个 plane 的异或）；E = P≪(1,5) + P≪(1,14)
    const p0 = a[0] ^ a[4] ^ a[8];
    const p1 = a[1] ^ a[5] ^ a[9];
    const p2 = a[2] ^ a[6] ^ a[10];
    const p3 = a[3] ^ a[7] ^ a[11];
    const e0 = (rotl32(p3, 5) ^ rotl32(p3, 14)) >>> 0;
    const e1 = (rotl32(p0, 5) ^ rotl32(p0, 14)) >>> 0;
    const e2 = (rotl32(p1, 5) ^ rotl32(p1, 14)) >>> 0;
    const e3 = (rotl32(p2, 5) ^ rotl32(p2, 14)) >>> 0;
    for (let x = 0; x < 4; x++) {
      const e = [e0, e1, e2, e3][x];
      a[x] = (a[x] ^ e) >>> 0;
      a[4 + x] = (a[4 + x] ^ e) >>> 0;
      a[8 + x] = (a[8 + x] ^ e) >>> 0;
    }

    // ρwest：A1 ≪(1,0)（列移 -1 读入），A2 ≪(0,11)（lane 循环左移 11）
    for (let x = 0; x < 4; x++) {
      b[x] = a[x];
      b[4 + x] = a[4 + ((x + 3) % 4)];
      b[8 + x] = rotl32(a[8 + x], 11);
    }
    a.set(b);

    // ι：A0 += Ci（plane y=0 的 lane x=0）
    a[0] = (a[0] ^ XOODBOO_RC[round]) >>> 0;

    // χ：Ay = Ay + (¬Ay+1 · Ay+2)
    for (let x = 0; x < 4; x++) {
      b[x] = (a[x] ^ (~a[4 + x] & a[8 + x])) >>> 0;
      b[4 + x] = (a[4 + x] ^ (~a[8 + x] & a[x])) >>> 0;
      b[8 + x] = (a[8 + x] ^ (~a[x] & a[4 + x])) >>> 0;
    }
    a.set(b);

    // ρeast：A1 ≪(0,1)，A2 ≪(2,8)（列移 +2 读入，lane 循环左移 8）
    for (let x = 0; x < 4; x++) {
      b[x] = a[x];
      b[4 + x] = rotl32(a[4 + x], 1);
      b[8 + x] = rotl32(a[8 + ((x + 2) % 4)], 8);
    }
    a.set(b);
  }

  for (let i = 0; i < 12; i++) {
    const v = a[i];
    state[4 * i] = v & 0xff;
    state[4 * i + 1] = (v >>> 8) & 0xff;
    state[4 * i + 2] = (v >>> 16) & 0xff;
    state[4 * i + 3] = (v >>> 24) & 0xff;
  }
}

// ============================================================
// Cyclist 模式（Algorithm 2/3；b' = 48 字节，帧位与色字节见下）
// ============================================================

export const CYCLIST_BPRIME = 48; // b'：置换宽度 48 字节（帧位/色字节可及范围）
export const XOODYAK_RHASH = 16;  // Rhash（hash 模式吸收/挤出块长）
export const XOODYAK_RKIN = 44;   // Rkin（keyed 模式吸收块长）
export const XOODYAK_RKOUT = 24;  // Rkout（keyed 模式挤出/加密块长）

// 帧色（Down：键块 '02'、首个 Absorb 块 hash '01'/keyed '03'、其余 '00'；
//        Up：首个 Crypt 块 '80'、首个 Squeeze '40'、首个 SqueezeKey '20'、ratchet '10'）

function cyclistCreate() {
  return {
    state: new Uint8Array(CYCLIST_BPRIME),
    phaseUp: true,
    keyed: false,
    Rabsorb: XOODYAK_RHASH,
    Rsqueeze: XOODYAK_RHASH,
  };
}

/** Down(Xi, cD)：s ⊕ (Xi || '01' || 0* || cD)，帧位紧跟块尾，色字节在偏移 b'-1。 */
function cyclistDown(c, block, cD) {
  const st = c.state;
  for (let i = 0; i < block.length; i++) st[i] ^= block[i];
  st[block.length] ^= 0x01;
  // 单色域（hash）：色只取最低位；双色域（keyed）：色原样
  st[CYCLIST_BPRIME - 1] ^= c.keyed ? cD : (cD & 0x01);
  c.phaseUp = false;
}

/** Up(|Yi|, cU)：keyed 时先在偏移 b'-1 异或 cU，再置换，返回状态前 |Yi| 字节。 */
function cyclistUp(c, outLen, cU) {
  if (c.keyed) c.state[CYCLIST_BPRIME - 1] ^= cU;
  xoodooPermute12(c.state);
  c.phaseUp = true;
  return c.state.slice(0, outLen);
}

/** AbsorbAny(X, r, cD)：Split 语义——空输入也是单个空块。 */
function cyclistAbsorbAny(c, X, r, cD) {
  let off = 0;
  let first = true;
  do {
    if (!c.phaseUp) cyclistUp(c, 0, 0x00);
    const splitLen = Math.min(X.length - off, r);
    cyclistDown(c, X.subarray(off, off + splitLen), first ? cD : 0x00);
    first = false;
    off += splitLen;
  } while (off < X.length);
}

/** AbsorbKey(K, id, counter)：要求 |K|+|id| ≤ Rkin−1；counter 按块长 1 逐字节滴入。 */
function cyclistAbsorbKey(c, key, id) {
  if (c.keyed) throw new Error("Cyclist: 已处于 keyed 模式，不能重复 AbsorbKey");
  if (key.length + id.length > XOODYAK_RKIN - 1) {
    throw new Error(`Cyclist: |K|+|id| = ${key.length + id.length} 超过 Rkin-1 = ${XOODYAK_RKIN - 1}`);
  }
  c.keyed = true;
  c.Rabsorb = XOODYAK_RKIN;
  c.Rsqueeze = XOODYAK_RKOUT;
  const kid = new Uint8Array(key.length + id.length + 1);
  kid.set(key, 0);
  kid.set(id, key.length);
  kid[key.length + id.length] = id.length; // enc8(|id|)：单字节长度域
  cyclistAbsorbAny(c, kid, c.Rabsorb, 0x02);
}

/** Crypt(I, decrypt)：Up 产生密钥流，O = I ⊕ Y，Down 吸收明文块（双向同规则）。 */
function cyclistCrypt(c, input, decrypt) {
  const out = new Uint8Array(input.length);
  let off = 0;
  let first = true;
  do {
    const splitLen = Math.min(input.length - off, XOODYAK_RKOUT);
    const keystream = cyclistUp(c, splitLen, first ? 0x80 : 0x00);
    for (let i = 0; i < splitLen; i++) out[off + i] = input[off + i] ^ keystream[i];
    // Down 吸收明文：加密方向是输入本身，解密方向是刚恢复的明文（输出块）
    cyclistDown(c, decrypt ? out.subarray(off, off + splitLen) : input.subarray(off, off + splitLen), 0x00);
    first = false;
    off += splitLen;
  } while (off < input.length);
  return out;
}

/** SqueezeAny(ℓ, cU)：先 Up 取 min(ℓ, Rsqueeze)，不足则 Down(空) 续 Up。 */
function cyclistSqueezeAny(c, len, cU) {
  let out = cyclistUp(c, Math.min(len, c.Rsqueeze), cU);
  while (out.length < len) {
    cyclistDown(c, new Uint8Array(0), 0x00);
    const more = cyclistUp(c, Math.min(len - out.length, c.Rsqueeze), 0x00);
    const merged = new Uint8Array(out.length + more.length);
    merged.set(out);
    merged.set(more, out.length);
    out = merged;
  }
  return out;
}

// ============================================================
// Xoodyak 实例（Definition 2）
// ============================================================

/**
 * Xoodyak-Hash：hash 模式（单色域）。
 * 初始化即 hash 模式 → Absorb(msg) → Squeeze(32)。
 */
export function xoodyakHashBytes(msg) {
  const c = cyclistCreate();
  cyclistAbsorbAny(c, msg, XOODYAK_RHASH, 0x03);
  return cyclistSqueezeAny(c, 32, 0x40);
}

/**
 * Xoodyak-AEAD 加密（NIST 决赛提交包 encrypt.c 同构）：
 * 初始化(keyed, K=16B, id=nonce 16B) → Absorb(ad) → Encrypt(pt) → Squeeze(16B tag)。
 * 返回 { ciphertext, tag }。key/nonce 由调用方给定，本函数不生成随机数。
 */
export function xoodyakAeadEncrypt(key, nonce, plaintext, aad) {
  if (key.length !== 16) throw new Error(`key 必须为 16 字节（当前 ${key.length}）`);
  if (nonce.length !== 16) throw new Error(`nonce 必须为 16 字节（当前 ${nonce.length}）`);
  const c = cyclistCreate();
  cyclistAbsorbKey(c, key, nonce);
  cyclistAbsorbAny(c, aad, c.Rabsorb, 0x03);
  const ciphertext = cyclistCrypt(c, plaintext, false);
  const tag = cyclistSqueezeAny(c, 16, 0x40);
  return { ciphertext, tag };
}

/**
 * Xoodyak-AEAD 解密（NIST 决赛提交包 decrypt.c 同构）：
 * 密文不足 16 字节直接失败；tag 不匹配返回 { ok:false } 并不泄露明文语义。
 */
export function xoodyakAeadDecrypt(key, nonce, ciphertext, tag, aad) {
  if (key.length !== 16) throw new Error(`key 必须为 16 字节（当前 ${key.length}）`);
  if (nonce.length !== 16) throw new Error(`nonce 必须为 16 字节（当前 ${nonce.length}）`);
  if (ciphertext.length + tag.length < 16) {
    throw new Error(`密文+tag 共 ${ciphertext.length + tag.length} 字节，少于 16 字节 tag 长度`);
  }
  const c = cyclistCreate();
  cyclistAbsorbKey(c, key, nonce);
  cyclistAbsorbAny(c, aad, c.Rabsorb, 0x03);
  const plaintext = cyclistCrypt(c, ciphertext, true);
  const expected = cyclistSqueezeAny(c, 16, 0x40);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= expected[i] ^ tag[i];
  if (diff !== 0) return { ok: false };
  return { ok: true, plaintext };
}

// ============================================================
// hex / 字节工具（与 aeadModes 同款严格解析）
// ============================================================

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytesStrict(value, name, expectedLen, allowEmpty = true) {
  let s = String(value == null ? "" : value).trim();
  s = s.replace(/^0x/i, "").replace(/[\s:_-]+/g, "");
  if (s === "") {
    if (allowEmpty) return new Uint8Array(0);
    throw new Error(`${name} 不能为空（需要 hex）`);
  }
  if (!/^[0-9a-fA-F]+$/.test(s)) {
    throw new Error(`${name} 含非 hex 字符：${String(value).slice(0, 48)}`);
  }
  if (s.length % 2 !== 0) {
    throw new Error(`${name} 的 hex 长度为奇数（${s.length}），无法按字节解析`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  if (expectedLen != null && out.length !== expectedLen) {
    throw new Error(`${name} 必须为 ${expectedLen} 字节（${expectedLen * 2} hex），当前 ${out.length} 字节`);
  }
  return out;
}

function textToBytes(text) {
  return new TextEncoder().encode(String(text == null ? "" : text));
}

// ============================================================
// op：Xoodyak-Hash
// ============================================================

function xoodyakHashRun(text, p = {}) {
  const msg = p.inputMode === "hex"
    ? hexToBytesStrict(text, "消息 hex", null, true)
    : textToBytes(text);
  return bytesToHex(xoodyakHashBytes(msg));
}

register({
  id: "xoodyakHash",
  cat: "hash",
  name: "Xoodyak-Hash",
  desc: "NIST 轻量级密码竞赛决赛方案 Xoodyak 的哈希模式：Xoodoo[12] 置换（384 位状态，θ/ρwest/ι/χ/ρeast 五步）+ Cyclist 单色域海绵，吸收块 16 字节，输出 32 字节摘要。输入任意文本或 hex 字节。NIST 官方 KAT 全量对拍通过",
  acceptsBytes: true, textTransit: true,
  params: [
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
  ],
  run: xoodyakHashRun,
});

// ============================================================
// op：Xoodyak-AEAD
// ============================================================

function aeadParams(p = {}) {
  const key = hexToBytesStrict(p.key, "key", 16, false);
  const nonce = hexToBytesStrict(p.nonce, "nonce", 16, false);
  const aad = p.aadMode === "hex"
    ? hexToBytesStrict(p.aad, "aad hex", null, true)
    : textToBytes(p.aad);
  return { key, nonce, aad };
}

function aeadEncode(text, p = {}) {
  const { key, nonce, aad } = aeadParams(p);
  const plaintext = p.inputMode === "hex"
    ? hexToBytesStrict(text, "明文 hex", null, true)
    : textToBytes(text);
  const { ciphertext, tag } = xoodyakAeadEncrypt(key, nonce, plaintext, aad);
  return bytesToHex(new Uint8Array([...ciphertext, ...tag]));
}

function aeadDecode(text, p = {}) {
  const { key, nonce, aad } = aeadParams(p);
  const raw = hexToBytesStrict(text, "密文 hex", null, false);
  if (raw.length < 16) {
    throw new Error(`密文只有 ${raw.length} 字节，至少需要 16 字节 tag`);
  }
  const ciphertext = raw.slice(0, raw.length - 16);
  const tag = raw.slice(raw.length - 16);
  const r = xoodyakAeadDecrypt(key, nonce, ciphertext, tag, aad);
  if (!r.ok) {
    throw new Error("认证失败：tag 不匹配（key/nonce/aad/密文至少有一项错误或被篡改）");
  }
  return finishBytesDecode(r.plaintext, { textMode: "hex", name: "xoodyak_plain.bin" });
}

register({
  id: "xoodyakAead",
  cat: "modern",
  name: "Xoodyak-AEAD",
  desc: "NIST 轻量级密码竞赛决赛方案 Xoodyak 的认证加密（Cyclist 双色域）：key 16 字节 / nonce 16 字节 / 关联数据可空，tag 固定 16 字节。加密方向：明文（UTF-8 或 hex）→ hex（密文‖tag）；解密方向：吃同格式 hex，tag 不符即报错。nonce 必填且须一次性使用（不自动生成随机数）。NIST 官方 KAT 全量对拍通过",
  acceptsBytes: true, textTransit: true,
  params: [
    { key: "key", label: "key（16B hex）", type: "text", default: "", placeholder: "000102030405060708090a0b0c0d0e0f" },
    { key: "nonce", label: "nonce（16B hex，必填）", type: "text", default: "", placeholder: "一次性随机数，由使用者提供，本工具不代生成" },
    {
      key: "aadMode", label: "aad 形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "aad", label: "关联数据 aad（可空）", type: "text", default: "", placeholder: "可空" },
    {
      key: "inputMode", label: "明文形式（仅加密方向）", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
  ],
  encode: aeadEncode,
  decode: aeadDecode,
});
