/*
 * mickey.js — MICKEY-128 2.0 流密码（eSTREAM Phase 3 决赛）
 *
 * Babbage & Dodd 官方实现（mickey128_2_bitbybit.c，eSTREAM 提交包）逐行移植。
 * 结构：R/S 各 160 位寄存器；CLOCK_R 双模式（Shift-and-XOR / Shift-only，feedback bit 控制是否加 R_Mask）；
 * CLOCK_S Galois 反馈（COMP0/COMP1 补位 + FB0/FB1 两组 tap）；CLOCK_KG 输出 (R[0]^S[0])，
 * 控制位 Control_R=S[54]^R[106]、Control_S=S[106]^R[53]；初始化 IV 位(MSB-first) → key 128 位 → 预钟控 160 拍。
 * key 128 位（16 字节），IV 0~128 位（官方向量含 32 位与 128 位 IV）。
 * 官方向量：Key=123456789abcdef00123456789abcdef IV=21436587 → a7b8c1f63dcafbef7dc726e2b12b3e44（加载自检）。
 *
 * 契约：register({ id:"mickey", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- 官方表（照 mickey128_2_bitbybit.c 逐值，勿改） ----
const R_MASK = [1,0,0,0,1,1,0,0,1,0,1,1,0,0,1,0,1,0,0,0,1,0,0,0,0,1,0,0,0,0,1,0,
  1,0,0,1,1,0,1,0,0,0,1,1,0,0,1,0,0,0,1,1,0,1,1,1,1,1,0,0,1,1,1,1,
  0,1,1,0,0,1,0,0,0,1,1,0,1,0,0,1,1,1,1,0,0,1,1,0,0,0,1,1,1,0,0,1,
  0,1,0,0,1,1,0,0,0,1,1,1,1,1,0,1,1,1,0,1,1,1,0,0,0,0,0,0,0,0,0,1,
  1,1,1,1,0,1,0,1,1,1,0,0,1,0,1,0,0,1,0,0,1,0,1,0,1,1,1,0,1,1,0,0];
const COMP0 = [0,1,1,1,1,0,1,0,0,1,0,0,1,1,1,1,0,1,1,0,1,0,1,1,1,0,1,1,1,0,1,0,
  1,0,1,0,1,0,1,0,1,0,0,1,0,0,0,0,0,1,1,0,0,1,0,0,1,0,0,1,1,1,1,0,
  0,1,0,0,0,1,1,0,0,0,0,0,1,1,1,0,0,0,0,0,0,0,0,0,1,0,0,1,1,1,1,0,
  1,0,0,0,1,1,0,0,1,0,0,1,1,0,1,1,1,1,1,1,0,1,0,1,1,1,1,0,1,1,0,0,
  0,1,1,1,1,1,0,1,0,1,1,0,0,0,0,0,0,1,1,1,1,1,0,1,1,1,1,1,0,0,0];
const COMP1 = [0,0,0,0,1,1,0,0,1,1,1,1,1,0,0,0,1,0,0,1,1,0,0,0,1,0,1,1,1,1,1,0,
  0,0,0,1,1,0,0,1,0,0,1,1,1,1,0,0,0,1,1,0,1,1,0,1,0,1,1,1,1,1,1,1,
  0,0,0,0,0,1,1,1,1,1,0,0,0,0,1,1,0,0,0,0,0,0,0,0,0,0,1,1,1,1,1,0,
  1,0,1,0,0,0,1,0,1,1,0,0,0,1,1,1,0,0,0,0,0,1,1,0,0,1,1,0,0,1,1,0,
  1,0,1,0,1,1,0,1,1,1,0,1,1,0,1,0,0,0,1,0,1,1,1,1,1,1,1,1,1,1,1];
const FB0 = [1,1,1,1,0,1,0,1,1,1,1,1,1,0,0,0,0,0,1,1,1,1,0,0,0,0,1,0,0,0,1,1,
  0,1,0,0,0,1,0,0,1,1,0,0,0,1,0,1,1,1,1,1,0,1,0,0,0,1,1,1,0,0,0,0,
  1,0,0,0,0,0,0,1,1,0,1,1,0,0,1,0,1,0,1,0,0,1,1,1,0,1,1,0,0,1,1,0,
  1,0,0,0,1,0,0,1,1,1,0,1,0,0,1,0,0,0,1,0,1,0,1,0,0,0,1,0,1,0,1,1,
  1,0,0,0,0,0,1,1,1,1,0,1,0,0,0,0,1,1,0,0,0,1,1,0,1,1,0,0,0,0,0,1];
const FB1 = [1,1,0,1,0,1,0,1,1,1,1,0,1,1,1,0,0,0,1,0,1,1,1,1,1,1,0,1,1,0,0,1,
  0,0,0,0,1,0,0,1,0,0,1,1,0,0,0,1,1,0,0,1,1,1,1,0,0,0,0,0,1,1,1,0,
  0,1,1,0,1,1,0,1,0,0,0,1,1,0,0,0,0,1,0,1,1,0,0,1,1,1,1,1,0,1,1,0,
  1,1,1,0,0,1,1,1,0,1,1,1,1,1,1,0,1,1,0,1,0,0,1,0,0,0,1,1,0,1,1,0,
  1,1,1,1,0,1,1,1,0,0,0,0,0,0,0,1,1,1,1,0,0,1,0,1,1,0,0,0,1,0,0,0];

// ---- 工具 ----
const te = (s) => new TextEncoder().encode(s);
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
function hexToBytes(h) {
  const s = h.replace(/[^0-9a-fA-F]/g, "");
  if (s.length % 2) throw new Error("十六进制长度必须为偶数");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ---- 状态机（照官方 bit-by-bit 逐行） ----
function makeCtx(keyBytes, ivBytes, ivBits) {
  const R = new Uint8Array(160);
  const S = new Uint8Array(160);
  const N = 160;

  function clockR(inputBit, controlBit) {
    const fb = R[159] ^ inputBit;
    if (controlBit) {
      // Shift-and-XOR
      if (fb) {
        for (let i = N - 1; i > 0; i--) R[i] = R[i - 1] ^ R[i] ^ R_MASK[i];
        R[0] = R_MASK[0] ^ R[0];
      } else {
        for (let i = N - 1; i > 0; i--) R[i] = R[i - 1] ^ R[i];
      }
    } else {
      // Shift only
      if (fb) {
        for (let i = N - 1; i > 0; i--) R[i] = R[i - 1] ^ R_MASK[i];
        R[0] = R_MASK[0];
      } else {
        for (let i = N - 1; i > 0; i--) R[i] = R[i - 1];
        R[0] = 0;
      }
    }
  }

  function clockS(inputBit, controlBit) {
    const fb = S[159] ^ inputBit;
    const sHat = new Uint8Array(N);
    for (let i = N - 2; i > 0; i--) sHat[i] = S[i - 1] ^ ((S[i] ^ COMP0[i]) & (S[i + 1] ^ COMP1[i]));
    sHat[0] = 0;
    sHat[N - 1] = S[N - 2];
    for (let i = 0; i < N; i++) S[i] = sHat[i];
    if (fb) {
      const mask = controlBit ? FB1 : FB0;
      for (let i = 0; i < N; i++) S[i] = sHat[i] ^ mask[i];
    }
  }

  function clockKg(mixing, inputBit) {
    const ksBit = (R[0] ^ S[0]) & 1;
    const cR = S[54] ^ R[106];
    const cS = S[106] ^ R[53];
    clockR(mixing ? inputBit ^ S[80] : inputBit, cR);
    clockS(inputBit, cS);
    return ksBit;
  }

  // ivsetup：清零 → 载 IV（MSB-first）→ 载 key 128 位 → 预钟控 160 拍
  R.fill(0); S.fill(0);
  for (let i = 0; i < ivBits; i++) {
    clockKg(1, (ivBytes[i >> 3] >> (7 - (i & 7))) & 1);
  }
  for (let i = 0; i < 128; i++) {
    clockKg(1, (keyBytes[i >> 3] >> (7 - (i & 7))) & 1);
  }
  for (let i = 0; i < N; i++) clockKg(1, 0);

  return { clockKg };
}

// 密钥流字节
function genKeystreamBytes(keyBytes, ivBytes, ivBits, len) {
  const ctx = makeCtx(keyBytes, ivBytes, ivBits);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | ctx.clockKg(0, 0);
    out[i] = b;
  }
  return out;
}

// ---- op 封装（自反 XOR：encode=decode 同变换） ----
function parseParams(p) {
  const keyHex = (p && p.key) || "123456789abcdef00123456789abcdef";
  let ivHex = (p && p.iv) || "";
  let keyBytes, ivBytes, ivBits;
  try {
    keyBytes = hexToBytes(keyHex);
    if (keyBytes.length !== 16) throw new Error();
  } catch {
    throw new Error("密钥必须为 128 位（32 个 hex 字符 / 16 字节）");
  }
  try {
    ivBytes = hexToBytes(ivHex);
    ivBits = ivBytes.length * 8;
    if (ivBytes.length > 16) throw new Error();
  } catch (e) {
    if (e && e.message) throw e;
    throw new Error("IV 最多 128 位（32 个 hex 字符 / 16 字节）");
  }
  return { keyBytes, ivBytes, ivBits };
}

function mickeyEncode(text, p = {}) {
  const { keyBytes, ivBytes, ivBits } = parseParams(p);
  const ks = genKeystreamBytes(keyBytes, ivBytes, ivBits, te(text).length);
  const data = te(text);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}
function mickeyDecode(text, p = {}) {
  const { keyBytes, ivBytes, ivBits } = parseParams(p);
  const data = hexToBytes(text);
  const ks = genKeystreamBytes(keyBytes, ivBytes, ivBits, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return new TextDecoder().decode(out);
}

register({
  id: "mickey",
  cat: "modern",
  name: "MICKEY-128 2.0",
  desc: "MICKEY-128 2.0 流密码（Babbage & Dodd，eSTREAM Phase 3 决赛）：R/S 各 160 位双寄存器，不规则钟控（Control_R=S[54]^R[106]、Control_S=S[106]^R[53]）+ Galois 双反馈。128 位密钥 + 0~128 位 IV（MSB-first 装载）。官方 C 实现逐行移植，官方向量自检。自反 XOR：encode 文本→密文 hex，decode 反向。",
  params: [
    { key: "key", type: "text", label: "密钥 key（hex）", default: "123456789abcdef00123456789abcdef", placeholder: "128 位，32 个十六进制字符" },
    { key: "iv", type: "text", label: "IV（hex，可空）", default: "21436587", placeholder: "0~128 位，最多 32 个十六进制字符" },
  ],
  encode: mickeyEncode,
  decode: mickeyDecode,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑，零噪音） ----
function selfCheck() {
  let fail = 0;
  const cases = [
    { key: "123456789abcdef00123456789abcdef", iv: "21436587", exp: "a7b8c1f63dcafbef7dc726e2b12b3e44" },
    { key: "f11a5627ce43b61f8912299486094486", iv: "9c532f8ac3ea4b2ea0f59640308377cc", exp: "77de5b94186367b2127aa8395e194677" },
    { key: "3b80fc8c475fc270fa26b47064b32d33", iv: "", exp: "a989f6f2391b68e42b6eb1d534cdc8c3" },
  ];
  for (const c of cases) {
    const got = bytesToHex(genKeystreamBytes(hexToBytes(c.key), hexToBytes(c.iv), hexToBytes(c.iv).length * 8, 16));
    if (got === c.exp) console.log("PASS 官方向量 key=" + c.key.slice(0, 8) + "… iv=" + (c.iv || "(空)"));
    else { console.log("FAIL key=" + c.key.slice(0, 8) + "…\n  got      " + got + "\n  expected " + c.exp); fail++; }
  }
  // 往返
  const enc = mickeyEncode("Hello MICKEY-128", { key: "123456789abcdef00123456789abcdef", iv: "21436587" });
  const dec = mickeyDecode(enc, { key: "123456789abcdef00123456789abcdef", iv: "21436587" });
  if (dec === "Hello MICKEY-128") console.log("PASS 往返");
  else { console.log("FAIL 往返: " + dec); fail++; }
  return fail === 0;
}

export { genKeystreamBytes, mickeyEncode, mickeyDecode, selfCheck };
