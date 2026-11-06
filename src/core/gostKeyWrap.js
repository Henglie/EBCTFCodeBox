/*
 * gostKeyWrap.js — GOST 28147-89 Key Wrap / CryptoPro Key Wrap（RFC 4357 §6.1-§6.5）。
 *
 * 依据：
 * - RFC 4357 §6.1：wrapped = UKM(8B) || CEK_ENC(32B) || CEK_MAC(4B)。
 *   CEK_ENC = E_KEK(CEK)（GOST 28147-89 ECB，4 个 8 字节块）；
 *   CEK_MAC = IMIT(KEK, CEK, IV=UKM) 前 4 字节。
 * - RFC 4357 §6.3-§6.5：CryptoPro Key Wrap 先做 KEK 多样化，
 *   再用多样化后的 KEK 执行同一 wrap/unwrap。
 * - RFC 4357 §11.1：CryptoPro-A 参数集
 *   id-Gost28147-89-CryptoPro-A-ParamSet。
 * - RFC 5830 §5/§7/§8：GOST 28147-89 ECB、CFB、MAC 生成；
 *   32 轮 Feistel、小端 32 位字序；IMIT 为 16 轮（K0..K7 两遍），
 *   反馈寄存器按 N1/N2 交换字节序。
 *
 * S 盒按 RFC 4357 §11.1 录入，与本地 gostModes.js 的 E-A 表逐项一致。
 * 本文件不依赖 pygost，未复制第三方实现；pygost 仅用于外部对拍。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；无 emoji。
 * 契约：register({ id, cat, name, desc, params, run })，件内自注册。
 */
import { register } from "./registry.js";

// ============ RFC 4357 参数常量 ============

const BLOCK_BYTES = 8;
const KEY_BYTES = 32;
const UKM_BYTES = 8;
const CEK_BYTES = 32;
const WRAPPED_BYTES = 44;
const MAC_BYTES = 4;

// id-Gost28147-89-CryptoPro-A-ParamSet（RFC 4357 §11.1）
const CRYPTOPRO_A_SBOX_ROWS = [
  [9, 6, 3, 2, 8, 11, 1, 7, 10, 4, 14, 15, 12, 0, 13, 5],
  [3, 7, 14, 9, 8, 10, 15, 0, 5, 2, 6, 12, 11, 4, 13, 1],
  [14, 4, 6, 2, 11, 3, 13, 8, 12, 15, 5, 10, 0, 7, 1, 9],
  [14, 7, 10, 12, 13, 1, 3, 9, 0, 2, 11, 4, 15, 8, 5, 6],
  [11, 5, 1, 9, 8, 13, 15, 0, 14, 4, 2, 3, 12, 7, 10, 6],
  [3, 10, 13, 12, 1, 2, 0, 11, 7, 5, 9, 4, 8, 15, 14, 6],
  [1, 13, 2, 9, 7, 10, 6, 0, 8, 12, 4, 5, 15, 3, 11, 14],
  [11, 10, 15, 5, 0, 12, 14, 8, 6, 2, 3, 9, 1, 7, 13, 4],
];
const SBOX = Uint8Array.from(CRYPTOPRO_A_SBOX_ROWS.flat());

const SEQ_ENCRYPT = [
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 1, 2, 3, 4, 5, 6, 7,
  0, 1, 2, 3, 4, 5, 6, 7,
  7, 6, 5, 4, 3, 2, 1, 0,
];
const SEQ_DECRYPT = [
  0, 1, 2, 3, 4, 5, 6, 7,
  7, 6, 5, 4, 3, 2, 1, 0,
  7, 6, 5, 4, 3, 2, 1, 0,
  7, 6, 5, 4, 3, 2, 1, 0,
];

// ============ 基础工具 ============

function bytesToHex(b) {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(h) {
  const s = String(h == null ? "" : h).replace(/\s+/g, "");
  if (s === "") return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(s) || s.length % 2 !== 0) {
    throw new Error(`hex 输入不合法：${s.slice(0, 40)}${s.length > 40 ? "…" : ""}`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hexExact(value, bytes, label) {
  const s = String(value == null ? "" : value).replace(/\s+/g, "");
  if (s === "") throw new Error(`${label} 不能为空（须 ${bytes} 字节 hex）`);
  const b = hexToBytes(s);
  if (b.length !== bytes) {
    throw new Error(`${label} 须为 ${bytes} 字节（当前 ${b.length} 字节），不截断`);
  }
  return b;
}

function readU32LE(b, off) {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

function writeU32LE(b, off, v) {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
}

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function macEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

// ============ GOST 28147-89 分组内核 ============

function makeSchedule(keyBytes) {
  if (!keyBytes || keyBytes.length !== KEY_BYTES) {
    throw new Error(`GOST 28147-89 密钥须为 ${KEY_BYTES} 字节（当前 ${keyBytes ? keyBytes.length : 0}）`);
  }
  const k = [];
  for (let i = 0; i < 8; i++) k.push(readU32LE(keyBytes, i * 4));
  const rk = new Uint32Array(32);
  for (let r = 0; r < 24; r++) rk[r] = k[r % 8];
  for (let r = 0; r < 8; r++) rk[24 + r] = k[7 - r];
  return rk;
}

function feistelRound(n1, n2, k) {
  const s = (n1 + k) >>> 0;
  let sub = 0;
  for (let i = 0; i < 8; i++) {
    sub |= SBOX[i * 16 + ((s >>> (4 * i)) & 0xf)] << (4 * i);
  }
  const t = (rotl32(sub >>> 0, 11) ^ n2) >>> 0;
  return [t, n1];
}

function cryptBlock(block, schedule, seq) {
  let n1 = readU32LE(block, 0);
  let n2 = readU32LE(block, 4);
  for (let r = 0; r < 32; r++) {
    const t = feistelRound(n1, n2, schedule[seq[r]]);
    n1 = t[0];
    n2 = t[1];
  }
  const out = new Uint8Array(BLOCK_BYTES);
  writeU32LE(out, 0, n2);
  writeU32LE(out, 4, n1);
  return out;
}

function checkBlockData(data, label) {
  if (!data || data.length === 0) throw new Error(`${label}为空`);
  if (data.length % BLOCK_BYTES !== 0) {
    throw new Error(`${label}须为 ${BLOCK_BYTES} 字节整数倍（当前 ${data.length} 字节）`);
  }
}

/** GOST 28147-89 ECB 加密（RFC 5830 §5.1）。 */
export function gost28147EcbEncrypt(keyBytes, data) {
  const schedule = makeSchedule(keyBytes);
  checkBlockData(data, "明文");
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += BLOCK_BYTES) {
    out.set(cryptBlock(data.subarray(off, off + BLOCK_BYTES), schedule, SEQ_ENCRYPT), off);
  }
  return out;
}

/** GOST 28147-89 ECB 解密（RFC 5830 §5.2）。 */
export function gost28147EcbDecrypt(keyBytes, data) {
  const schedule = makeSchedule(keyBytes);
  checkBlockData(data, "密文");
  const out = new Uint8Array(data.length);
  for (let off = 0; off < data.length; off += BLOCK_BYTES) {
    out.set(cryptBlock(data.subarray(off, off + BLOCK_BYTES), schedule, SEQ_DECRYPT), off);
  }
  return out;
}

/**
 * 全块 CFB 加密（RFC 5830 §7.1）。
 * 用于 CryptoPro KEK 多样化，数据须为 8 字节整数倍。
 */
export function gost28147CfbEncrypt(keyBytes, data, iv) {
  const schedule = makeSchedule(keyBytes);
  const init = iv instanceof Uint8Array ? iv : Uint8Array.from(iv || []);
  if (init.length !== BLOCK_BYTES) {
    throw new Error(`CFB IV 须为 ${BLOCK_BYTES} 字节（当前 ${init.length} 字节）`);
  }
  checkBlockData(data, "CFB 数据");
  const out = new Uint8Array(data.length);
  let feedback = init.slice();
  for (let off = 0; off < data.length; off += BLOCK_BYTES) {
    const ks = cryptBlock(feedback, schedule, SEQ_ENCRYPT);
    const c = new Uint8Array(BLOCK_BYTES);
    for (let j = 0; j < BLOCK_BYTES; j++) c[j] = data[off + j] ^ ks[j];
    out.set(c, off);
    feedback = c;
  }
  return out;
}

/**
 * IMIT（GOST 28147-89 MAC，RFC 5830 §8）：16 轮 K0..K7 两遍，
 * 反馈寄存器按 N1/N2 交换字节序。
 * RFC 4357 §6.1 用 UKM 作 IV；全零 UKM 等价于 zero IV。
 * 数据尾部按零填充到 8 字节整数倍（与 pygost pad1 一致）。
 */
export function imitMac(keyBytes, data, iv) {
  const schedule = makeSchedule(keyBytes);
  const init = iv instanceof Uint8Array ? iv : Uint8Array.from(iv || []);
  if (init.length !== BLOCK_BYTES) {
    throw new Error(`IMIT IV 须为 ${BLOCK_BYTES} 字节（当前 ${init.length} 字节）`);
  }
  if (!data || data.length === 0) throw new Error("IMIT 数据为空");
  const padded = new Uint8Array(Math.ceil(data.length / BLOCK_BYTES) * BLOCK_BYTES);
  padded.set(data);
  let feedback = init.slice();
  for (let off = 0; off < padded.length; off += BLOCK_BYTES) {
    let n1 = 0;
    let n2 = 0;
    const x = new Uint8Array(BLOCK_BYTES);
    for (let j = 0; j < BLOCK_BYTES; j++) x[j] = padded[off + j] ^ feedback[j];
    n1 = readU32LE(x, 0);
    n2 = readU32LE(x, 4);
    for (let r = 0; r < 16; r++) {
      const t = feistelRound(n1, n2, schedule[r]);
      n1 = t[0];
      n2 = t[1];
    }
    feedback = new Uint8Array(BLOCK_BYTES);
    writeU32LE(feedback, 0, n1);
    writeU32LE(feedback, 4, n2);
  }
  return feedback;
}

/**
 * CryptoPro KEK 多样化（RFC 4357 §6.5）。
 * 对 UKM 的 64 个比特分组累加 KEK 的 8 个 32 位字，得到 IV，
 * 再用当前 KEK 对当前 KEK 做全块 CFB 加密，迭代 8 轮。
 */
export function diversifyKek(kek, ukm) {
  if (!kek || kek.length !== KEY_BYTES) {
    throw new Error(`KEK 须为 ${KEY_BYTES} 字节（当前 ${kek ? kek.length : 0}）`);
  }
  if (!ukm || ukm.length !== UKM_BYTES) {
    throw new Error(`UKM 须为 ${UKM_BYTES} 字节（当前 ${ukm ? ukm.length : 0}）`);
  }
  let out = kek.slice();
  for (let i = 0; i < UKM_BYTES; i++) {
    let s1 = 0;
    let s2 = 0;
    for (let j = 0; j < 8; j++) {
      const k = readU32LE(out, j * 4);
      if ((ukm[i] >>> j) & 1) s1 = (s1 + k) >>> 0;
      else s2 = (s2 + k) >>> 0;
    }
    const iv = new Uint8Array(BLOCK_BYTES);
    writeU32LE(iv, 0, s1);
    writeU32LE(iv, 4, s2);
    out = gost28147CfbEncrypt(out, out, iv);
  }
  return out;
}

// ============ RFC 4357 Key Wrap / Unwrap ============

/**
 * RFC 4357 §6.1 Key Wrap。
 * @returns {Uint8Array} 44 字节：UKM || CEK_ENC || CEK_MAC
 */
export function gostKeyWrap(kek, cek, ukm, opts = {}) {
  if (!kek || kek.length !== KEY_BYTES) {
    throw new Error(`KEK 须为 ${KEY_BYTES} 字节（当前 ${kek ? kek.length : 0}）`);
  }
  if (!cek || cek.length !== CEK_BYTES) {
    throw new Error(`CEK 须为 ${CEK_BYTES} 字节（当前 ${cek ? cek.length : 0}）`);
  }
  if (!ukm || ukm.length !== UKM_BYTES) {
    throw new Error(`UKM 须为 ${UKM_BYTES} 字节（当前 ${ukm ? ukm.length : 0}）`);
  }
  const cryptopro = !!(opts && opts.cryptopro);
  const actualKek = cryptopro ? diversifyKek(kek, ukm) : kek;
  const cekEnc = gost28147EcbEncrypt(actualKek, cek);
  const cekMac = imitMac(actualKek, cek, ukm).subarray(0, MAC_BYTES);
  const out = new Uint8Array(WRAPPED_BYTES);
  out.set(ukm, 0);
  out.set(cekEnc, UKM_BYTES);
  out.set(cekMac, UKM_BYTES + CEK_BYTES);
  return out;
}

/**
 * RFC 4357 §6.2 Key Unwrap。
 * 长度或 MAC 不合法时抛错；MAC 失败提示「MAC 校验失败」。
 * @returns {{ cek: Uint8Array, ukm: Uint8Array }}
 */
export function gostKeyUnwrap(kek, wrapped, opts = {}) {
  if (!kek || kek.length !== KEY_BYTES) {
    throw new Error(`KEK 须为 ${KEY_BYTES} 字节（当前 ${kek ? kek.length : 0}）`);
  }
  if (!wrapped || wrapped.length !== WRAPPED_BYTES) {
    throw new Error(`wrapped 须为 ${WRAPPED_BYTES} 字节（当前 ${wrapped ? wrapped.length : 0} 字节）`);
  }
  const cryptopro = !!(opts && opts.cryptopro);
  const ukm = wrapped.slice(0, UKM_BYTES);
  const cekEnc = wrapped.subarray(UKM_BYTES, UKM_BYTES + CEK_BYTES);
  const cekMac = wrapped.subarray(UKM_BYTES + CEK_BYTES, WRAPPED_BYTES);
  const actualKek = cryptopro ? diversifyKek(kek, ukm) : kek;
  const cek = gost28147EcbDecrypt(actualKek, cekEnc);
  const calcMac = imitMac(actualKek, cek, ukm).subarray(0, MAC_BYTES);
  if (!macEqual(calcMac, cekMac)) {
    throw new Error("MAC 校验失败：wrapped 被篡改、KEK 错误、S-box/模式不匹配，或 UKM 不一致");
  }
  return { cek, ukm };
}

// ============ run 层 ============

function normMode(v) {
  const s = String(v == null || v === "" ? "wrap" : v).toLowerCase();
  if (s === "wrap" || s === "unwrap") return s;
  throw new Error(`mode 仅支持 wrap/unwrap（当前 ${v}）`);
}

function parseBool(v, label) {
  if (v === true || v === false) return v;
  if (v == null || v === "") return false;
  const s = String(v).toLowerCase();
  if (s === "true" || s === "1" || s === "yes" || s === "on") return true;
  if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  throw new Error(`${label} 须为布尔值 true/false（当前 ${v}）`);
}

export function gostKeyWrapRun(text, p) {
  const params = p || {};
  const mode = normMode(params.mode);
  const cryptopro = parseBool(params.cryptopro, "cryptopro");
  const kek = hexExact(params.kek, KEY_BYTES, "KEK");

  const lines = [];
  lines.push("=== GOST 28147-89 Key Wrap（RFC 4357 §6.1-§6.5）===");
  lines.push("S-box: id-Gost28147-89-CryptoPro-A-ParamSet");
  lines.push(`模式: ${mode}${cryptopro ? " · CryptoPro KEK 多样化" : ""}`);

  if (mode === "wrap") {
    let ukm;
    const rawUkm = String(params.ukm == null ? "" : params.ukm).trim();
    if (rawUkm === "") {
      ukm = new Uint8Array(UKM_BYTES);
      lines.push("UKM: 0000000000000000（未提供，使用默认全零；生产环境建议随机 UKM）");
    } else {
      ukm = hexExact(rawUkm, UKM_BYTES, "UKM");
      lines.push(`UKM: ${bytesToHex(ukm)}`);
    }
    const cek = hexExact(params.cek, CEK_BYTES, "CEK");
    const wrapped = gostKeyWrap(kek, cek, ukm, { cryptopro });
    lines.push(`CEK_ENC(hex, ${CEK_BYTES}B): ${bytesToHex(wrapped.subarray(UKM_BYTES, UKM_BYTES + CEK_BYTES))}`);
    lines.push(`CEK_MAC(hex, ${MAC_BYTES}B): ${bytesToHex(wrapped.subarray(UKM_BYTES + CEK_BYTES))}`);
    lines.push("");
    lines.push(`wrapped(hex, ${WRAPPED_BYTES}B): ${bytesToHex(wrapped)}`);
    return lines.join("\n");
  }

  const wrapped = hexExact(params.wrapped, WRAPPED_BYTES, "wrapped");
  const embeddedUkm = wrapped.subarray(0, UKM_BYTES);
  const rawUkm = String(params.ukm == null ? "" : params.ukm).trim();
  if (rawUkm !== "") {
    const ukm = hexExact(rawUkm, UKM_BYTES, "UKM");
    if (!macEqual(ukm, embeddedUkm)) {
      throw new Error(`UKM 参数与 wrapped 内 UKM 不一致（参数 ${bytesToHex(ukm)}，wrapped ${bytesToHex(embeddedUkm)}）`);
    }
    lines.push(`UKM: ${bytesToHex(embeddedUkm)}（与参数一致）`);
  } else {
    lines.push(`UKM(取自 wrapped): ${bytesToHex(embeddedUkm)}`);
  }
  if (String(params.cek == null ? "" : params.cek).trim() !== "") {
    lines.push("提示: unwrap 模式忽略 cek 参数（CEK 由解包得出）");
  }
  const result = gostKeyUnwrap(kek, wrapped, { cryptopro });
  lines.push("MAC 校验: 通过");
  lines.push("");
  lines.push(`CEK(hex, ${CEK_BYTES}B): ${bytesToHex(result.cek)}`);
  return lines.join("\n");
}

// ============ 注册 ============

register({
  id: "gostKeyWrap",
  cat: "block",
  name: "GOST 28147-89 Key Wrap",
  desc: "GOST 28147-89 密钥包装（RFC 4357 §6.1）：UKM(8B) || CEK_ENC(32B) || CEK_MAC(4B)，CryptoPro KEK 多样化可选（§6.3-6.5），S-box 为 CryptoPro-A。解包严格校验长度与 MAC，失败明示报错；固定向量 + pygost 现场对拍。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "wrap",
      options: [
        { value: "wrap", label: "包装 wrap" },
        { value: "unwrap", label: "解包 unwrap" },
      ],
    },
    { key: "cryptopro", label: "CryptoPro KEK 多样化", type: "bool", default: false },
    {
      key: "ukm", label: "UKM（8 字节 hex，wrap 用；留空=全零）", type: "text", default: "",
      placeholder: "0001020304050607",
    },
    {
      key: "kek", label: "KEK（32 字节 hex）", type: "text", default: "",
      placeholder: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    },
    {
      key: "cek", label: "CEK（32 字节 hex，wrap 用）", type: "text", default: "",
      placeholder: "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
    },
    {
      key: "wrapped", label: "wrapped（44 字节 hex，unwrap 用）", type: "text", default: "",
      placeholder: "0001020304050607…（共 88 个 hex 字符）",
    },
  ],
  run: gostKeyWrapRun,
});

export { hexToBytes, bytesToHex };
