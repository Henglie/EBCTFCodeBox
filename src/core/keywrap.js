/*
 * keywrap.js — AES Key Wrap / Key Wrap with Padding（RFC 3394 / RFC 5649）。
 *
 * RFC 3394 §2.2.1 包装：AIV = 0xA6A6A6A6A6A6A6A6，s = 6n 轮，
 *   第 t 轮 j = ceil(t/n)：A|R[j] ← AES(K, A|R[j])，A ← A ⊕ t。
 * RFC 3394 §2.2.2 解包：t 从 6n 降到 1 逆推，A ≠ AIV 即完整性失败。
 * RFC 5649 §3/§4.1：AIV = 0xA65959A6 ‖ MLI（明文字节长，32bit 大端），
 *   明文右补零到 8 倍数；pad 后恰 8 字节时走单块 AES-ECB
 *   （C0|C1 = ENC(K, A|P1)，§4.1 步骤 2 第一分支），否则走 3394 核心。
 * RFC 5649 §3/§4.2 解包三检：
 *   1) MSB32(A) = A65959A6；2) 8(n-1) < MLI ≤ 8n；3) 末 b = 8n-MLI 字节全零。
 * AES 单块加解密复用 modern.js 的 makeAes（FIPS 197 AES codebook）。
 *
 * 验证：RFC 3394 §4.1-§4.6 五组官方向量 + RFC 5649 §6 两组官方向量
 * + Node WebCrypto AES-KW（RFC 3394 独立权威源）对拍 + 篡改负例。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；无 emoji。
 * 契约：register({ id, cat, name, desc, params, run })，件内自注册。
 */
import { register } from "./registry.js";
import { makeAes } from "./modern.js"; // AES 单块加密（FIPS 197）

// ============ 基础工具 ============

function bytesToHex(b) {
  return Array.from(b, (c) => c.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(h) {
  const s = String(h || "").replace(/\s+/g, "");
  if (s === "") return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error(`hex 输入不合法：${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 8 字节（大端）→ 64 位 BigInt。 */
function word64(b, off) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[off + i]);
  return v;
}

/** 64 位 BigInt → 8 字节（大端）。 */
function word64Bytes(v) {
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function checkKek(kek) {
  if (![16, 24, 32].includes(kek.length)) {
    throw new Error(`KEK 须为 16/24/32 字节（AES-128/192/256，FIPS 197），当前 ${kek.length} 字节`);
  }
}

/** 两个 64 位字拼 16 字节 AES 块。 */
function blockBytes(hi, lo) {
  const out = new Uint8Array(16);
  out.set(word64Bytes(hi), 0);
  out.set(word64Bytes(lo), 8);
  return out;
}

// ============ RFC 3394 核心 ============

/** RFC 3394 §2.2.3.1：默认初始值。 */
const AIV_3394 = 0xa6a6a6a6a6a6a6a6n;
/** RFC 5649 §3：AIV 高 32 位常量。 */
const AIV_5649_HI = 0xa65959a6n;

/**
 * RFC 3394 §2.2.1 核心：以指定 AIV 包装 n 个 64 位块（n ≥ 2）。
 * blocks：64 位 BigInt 数组。返回 64 位 BigInt 数组 {A, R[0..n-1]}。
 */
function wrapCore(kek, blocks, aiv) {
  const { encBlock } = makeAes(kek);
  const n = blocks.length;
  let A = aiv;
  const R = blocks.slice();
  // §2.2.1 索引式：t = n*j+i（j=0..5 外层遍，i=1..n 内层寄存器），
  // 即 t 从 1 到 6n，寄存器下标 i = ((t-1) mod n)+1，A ← A ⊕ t。
  for (let t = 1; t <= 6 * n; t++) {
    const i = ((t - 1) % n) + 1;
    const B = encBlock(blockBytes(A, R[i - 1]));
    A = word64(B, 0) ^ BigInt(t);
    R[i - 1] = word64(B, 8);
  }
  return [A, ...R];
}

/**
 * RFC 3394 §2.2.2 核心（步骤 1-2，A 校验交调用方）：
 * 解包 n+1 个 64 位块，返回 { a, blocks }。
 */
function unwrapCore(kek, cblocks) {
  const { decBlock } = makeAes(kek);
  const n = cblocks.length - 1;
  let A = cblocks[0];
  const R = cblocks.slice(1);
  // §2.2.2 索引式逆推：t 从 6n 降到 1，寄存器下标 i = ((t-1) mod n)+1
  for (let t = 6 * n; t >= 1; t--) {
    const i = ((t - 1) % n) + 1;
    const B = decBlock(blockBytes(A ^ BigInt(t), R[i - 1]));
    A = word64(B, 0);
    R[i - 1] = word64(B, 8);
  }
  return { a: A, blocks: R };
}

function wordsToBytes(words) {
  const out = new Uint8Array(words.length * 8);
  words.forEach((w, i) => out.set(word64Bytes(w), i * 8));
  return out;
}

function bytesToWords(b) {
  const words = [];
  for (let i = 0; i < b.length; i += 8) words.push(word64(b, i));
  return words;
}

/** RFC 3394 §2.2.1 包装（公开导出）。明文须 ≥16 字节且为 8 的倍数。 */
export function aesKeyWrap3394(kek, plaintext) {
  checkKek(kek);
  if (plaintext.length < 16) {
    throw new Error(`RFC 3394 明文须 ≥ 16 字节（n ≥ 2 个 64 位块），当前 ${plaintext.length} 字节`);
  }
  if (plaintext.length % 8 !== 0) {
    throw new Error(`RFC 3394 明文须为 8 字节整数倍（§2），当前 ${plaintext.length} 字节；非整倍数请用 RFC 5649 模式`);
  }
  return wordsToBytes(wrapCore(kek, bytesToWords(plaintext), AIV_3394));
}

/** RFC 3394 §2.2.2 解包（公开导出）。AIV 校验失败明示报错。 */
export function aesKeyUnwrap3394(kek, ciphertext) {
  checkKek(kek);
  if (ciphertext.length < 24 || ciphertext.length % 8 !== 0) {
    throw new Error(`RFC 3394 密文须为 ≥ 24 字节的 8 字节倍数（n+1 个 64 位块），当前 ${ciphertext.length} 字节`);
  }
  const { a, blocks } = unwrapCore(kek, bytesToWords(ciphertext));
  if (a !== AIV_3394) {
    throw new Error("RFC 3394 解包完整性校验失败：A ≠ A6A6A6A6A6A6A6A6（密文被篡改或 KEK 错误）");
  }
  return wordsToBytes(blocks);
}

// ============ RFC 5649（带填充） ============

/** RFC 5649 §4.1 扩展包装（公开导出）。明文 1..2^32 字节任意长度。 */
export function aesKeyWrap5649(kek, plaintext) {
  checkKek(kek);
  if (plaintext.length < 1) throw new Error("RFC 5649 明文至少 1 字节");
  if (plaintext.length > 2 ** 32) throw new Error("RFC 5649 明文上限 2^32 字节");
  const { encBlock } = makeAes(kek);
  // §4.1 步骤 1：右补零到 8 倍数，n = r/8 = ceil(m/8)
  const r = (plaintext.length + 7) & ~7;
  const padded = new Uint8Array(r);
  padded.set(plaintext);
  // §3：AIV = A65959A6 ‖ MLI（明文原始字节长，32bit 大端）
  const aiv = (AIV_5649_HI << 32n) | BigInt(plaintext.length);
  // §4.1 步骤 2：n=1 时单块 AES-ECB，否则 3394 核心
  if (r === 8) return encBlock(blockBytes(aiv, word64(padded, 0)));
  return wordsToBytes(wrapCore(kek, bytesToWords(padded), aiv));
}

/** RFC 5649 §4.2 扩展解包（公开导出）。AIV 三检任一失败明示报错。 */
export function aesKeyUnwrap5649(kek, ciphertext) {
  checkKek(kek);
  if (ciphertext.length < 16 || ciphertext.length % 8 !== 0) {
    throw new Error(`RFC 5649 密文须为 ≥ 16 字节的 8 字节倍数，当前 ${ciphertext.length} 字节`);
  }
  const { decBlock } = makeAes(kek);
  let a, padded;
  if (ciphertext.length === 16) {
    // §4.2 步骤 1：n=1 单块解密
    const B = decBlock(ciphertext);
    a = word64(B, 0);
    padded = B.subarray(8);
  } else {
    ({ a, blocks: padded } = unwrapCore(kek, bytesToWords(ciphertext)));
    padded = wordsToBytes(padded);
  }
  // §3 AIV 三检（§4.2 步骤 2）
  if ((a >> 32n) !== AIV_5649_HI) {
    throw new Error("RFC 5649 解包失败：MSB32(A) ≠ A65959A6（密文被篡改、KEK 错误或该数据不是 RFC 5649 格式）");
  }
  const mli = a & 0xffffffffn;
  const n = padded.length / 8;
  if (!(BigInt(8 * (n - 1)) < mli && mli <= BigInt(8 * n))) {
    throw new Error(`RFC 5649 解包失败：MLI 越界（须 8(n-1) < MLI ≤ 8n，得 ${mli}）`);
  }
  const b = Number(BigInt(8 * n) - mli);
  for (let i = padded.length - b; i < padded.length; i++) {
    if (padded[i] !== 0) {
      throw new Error("RFC 5649 解包失败：填充字节非零（密文被篡改或 KEK 错误）");
    }
  }
  return padded.subarray(0, Number(mli));
}

// ============ run 层（UI 驱动） ============

function keyWrapRun(text, p) {
  const mode = (p && p.mode) || "wrap";
  const std = (p && p.std) || "3394";
  const kek = hexToBytes((p && p.kek) || "");
  checkKek(kek);
  const lines = [];
  lines.push(`=== AES Key Wrap（RFC ${std}）===`);
  lines.push(`模式: ${mode === "wrap" ? "包装 wrap" : "解包 unwrap"} · KEK ${kek.length * 8} 位`);

  if (mode === "wrap") {
    const pt = hexToBytes(text);
    const ct = std === "5649" ? aesKeyWrap5649(kek, pt) : aesKeyWrap3394(kek, pt);
    lines.push(`key data: ${pt.length} 字节`);
    lines.push("");
    lines.push(`包装结果(hex): ${bytesToHex(ct)}`);
    return lines.join("\n");
  }

  const ct = hexToBytes(text);
  const pt = std === "5649" ? aesKeyUnwrap5649(kek, ct) : aesKeyUnwrap3394(kek, ct);
  lines.push(`密文: ${ct.length} 字节`);
  lines.push("");
  lines.push(`key data(hex): ${bytesToHex(pt)}`);
  lines.push(`key data(text): ` + new TextDecoder("utf-8", { fatal: false }).decode(pt));
  return lines.join("\n");
}

// ============ 注册（件内自注册，不碰主入口） ============

register({
  id: "aesKeyWrap", family: "aes", familyLabel: "keywrap",
  cat: "block",
  name: "AES Key Wrap",
  desc: "AES 密钥包装（RFC 3394，AIV=A6×8，明文须 8 字节倍数）/ 带填充包装（RFC 5649，AIV=A65959A6+长度，任意长度 1..2^32 字节）。KEK 支持 AES-128/192/256；解包完整性校验失败明示报错。RFC 3394 §4.1-4.6 五组 + RFC 5649 §6 两组官方向量验证。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "wrap",
      options: [
        { value: "wrap", label: "包装 wrap" },
        { value: "unwrap", label: "解包 unwrap" },
      ],
    },
    {
      key: "std", label: "标准", type: "select", default: "3394",
      options: [
        { value: "3394", label: "RFC 3394（经典，8 字节倍数）" },
        { value: "5649", label: "RFC 5649（带填充，任意长度）" },
      ],
    },
    { key: "kek", label: "KEK（16/24/32B hex）", type: "text", default: "", placeholder: "000102030405060708090a0b0c0d0e0f" },
  ],
  run: keyWrapRun,
});

export { hexToBytes, bytesToHex };
