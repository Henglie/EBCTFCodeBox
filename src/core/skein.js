/*
 * skein.js — Skein 哈希（SHA-3 决赛候选，cat:'hash'，run 型）。
 *
 * 算法照 Doug Whiting 官方 C 参考（skein.c / skein_block.c，skein_iv.h 预计算 IV，
 * 均来自 Skein v1.3 / NIST SHA-3 提交），不编造。实现用 threefish.js 的 makeCtx 做
 * 压缩函数：Skein 块函数 = Threefish(key=链值 X, tweak=[T0,T1]) 加密后异或回明文
 * （Miyaguchi-Preneel 反馈）。C240 == SKEIN_KS_PARITY（0x1BD11BDAA9FC1A22），
 * 子密钥编排与 C 参考完全一致。
 *
 * 结构（照 C 参考）：
 *   1) Init：X = 预计算 IV（skein_iv.h）；tweak T = [0, FIRST|MSG]。
 *   2) 消息全块：T0 += 64；Threefish(X, [T0,T1]) 加密块 ⊕ 块 → 新 X；清 FIRST。
 *   3) 末块：T1 |= FINAL；不足块零填充；T0 += 实际字节数；同上处理。
 *   4) 输出 counter 模式：对 i=0,1,... 构造计数器块（首 8 字节 = i 小端），
 *      tweak = [0, FIRST|OUT|FINAL]，byteCntAdd=8，逐块加密输出小端字节。
 *
 * 红线：算法照官方参考不编造；纯本地 BigInt；core 层零 UI 依赖（仅 registry）。
 *   载入自校验 Skein3Fish skein_golden_kat.txt 官方向量（256/512/1024 空消息 +
 *   1024-bit zero 消息）。
 *
 * 契约：register({ id:"skein", cat:"hash", name, desc, params, run })。
 *   variant 选 Skein-256/512/1024 × 常见输出长度；输入文本/hex。
 */
import { register } from "./registry.js";
import { makeCtx } from "./threefish.js";

const MASK64 = (1n << 64n) - 1n;

/* ---- tweak 位域（照 skein.h）---- */
const T1_FIRST = 1n << 62n;      // bit 126
const T1_FINAL = 1n << 63n;      // bit 127
const TYPE_MSG = 48n;            // 消息处理
const TYPE_OUT = 63n;            // 输出阶段
const TYPE_CFG = 4n;             // 配置块（保留）

/* ---- 预计算 IV（照 skein_iv.h，MK_64(hi,lo)）---- */
const MK = (hi, lo) => (BigInt(hi) << 32n) | BigInt(lo);
const IV_256 = {
  128: [MK(0xE1111906, 0x964D7260), MK(0x883DAAA7, 0x7C8D811C), MK(0x10080DF4, 0x91960F7A), MK(0xCCF7DDE5, 0xB45BC1C2)],
  160: [MK(0x14202314, 0x72825E98), MK(0x2AC4E9A2, 0x5A77E590), MK(0xD47A5856, 0x8838D63E), MK(0x2DD2E496, 0x8586AB7D)],
  224: [MK(0xC6098A8C, 0x9AE5EA0B), MK(0x876D5686, 0x08C5191C), MK(0x99CB88D7, 0xD7F53884), MK(0x384BDDB1, 0xAEDDB5DE)],
  256: [MK(0xFC9DA860, 0xD048B449), MK(0x2FCA6647, 0x9FA7D833), MK(0xB33BC389, 0x6656840F), MK(0x6A54E920, 0xFDE8DA69)],
};
const IV_512 = {
  128: [MK(0xA8BC7BF3, 0x6FBF9F52), MK(0x1E9872CE, 0xBD1AF0AA), MK(0x309B1790, 0xB32190D3), MK(0xBCFBB854, 0x3F94805C), MK(0x0DA61BCD, 0x6E31B11B), MK(0x1A18EBEA, 0xD46A32E3), MK(0xA2CC5B18, 0xCE84AA82), MK(0x6982AB28, 0x9D46982D)],
  160: [MK(0x28B81A2A, 0xE013BD91), MK(0xC2F11668, 0xB5BDF78F), MK(0x1760D8F3, 0xF6A56F12), MK(0x4FB74758, 0x8239904F), MK(0x21EDE07F, 0x7EAF5056), MK(0xD908922E, 0x63ED70B8), MK(0xB8EC76FF, 0xECCB52FA), MK(0x01A47BB8, 0xA3F27A6E)],
  224: [MK(0xCCD06162, 0x48677224), MK(0xCBA65CF3, 0xA92339EF), MK(0x8CCD69D6, 0x52FF4B64), MK(0x398AED7B, 0x3AB890B4), MK(0x0F59D1B1, 0x457D2BD0), MK(0x6776FE65, 0x75D4EB3D), MK(0x99FBC70E, 0x997413E9), MK(0x9E2CFCCF, 0xE1C41EF7)],
  256: [MK(0xCCD044A1, 0x2FDB3E13), MK(0xE8359030, 0x1A79A9EB), MK(0x55AEA061, 0x4F816E6F), MK(0x2A2767A4, 0xAE9B94DB), MK(0xEC06025E, 0x74DD7683), MK(0xE7A436CD, 0xC4746251), MK(0xC36FBAF9, 0x393AD185), MK(0x3EEDBA18, 0x33EDFC13)],
  384: [MK(0xA3F6C6BF, 0x3A75EF5F), MK(0xB0FEF9CC, 0xFD84FAA4), MK(0x9D77DD66, 0x3D770CFE), MK(0xD798CBF3, 0xB468FDDA), MK(0x1BC4A666, 0x8A0E4465), MK(0x7ED7D434, 0xE5807407), MK(0x548FC1AC, 0xD4EC44D6), MK(0x266E1754, 0x6AA18FF8)],
  512: [MK(0x4903ADFF, 0x749C51CE), MK(0x0D95DE39, 0x9746DF03), MK(0x8FD19341, 0x27C79BCE), MK(0x9A255629, 0xFF352CB1), MK(0x5DB62599, 0xDF6CA7B0), MK(0xEABE394C, 0xA9D5C3F4), MK(0x991112C7, 0x1A75B523), MK(0xAE18A40B, 0x660FCC33)],
};
const IV_1024 = {
  384: [MK(0x5102B6B8, 0xC1894A35), MK(0xFEEBC9E3, 0xFE8AF11A), MK(0x0C807F06, 0xE32BED71), MK(0x60C13A52, 0xB41A91F6), MK(0x9716D35D, 0xD4917C38), MK(0xE780DF12, 0x6FD31D3A), MK(0x797846B6, 0xC898303A), MK(0xB172C2A8, 0xB3572A3B), MK(0xC9BC8203, 0xA6104A6C), MK(0x65909338, 0xD75624F4), MK(0x94BCC568, 0x4B3F81A0), MK(0x3EBBF51E, 0x10ECFD46), MK(0x2DF50F0B, 0xEEB08542), MK(0x3B5A6530, 0x0DBC6516), MK(0x484B9CD2, 0x167BBCE1), MK(0x2D136947, 0xD4CBAFEA)],
  512: [MK(0xCAEC0E5D, 0x7C1B1B18), MK(0xA01B0E04, 0x5F03E802), MK(0x33840451, 0xED912885), MK(0x374AFB04, 0xEAEC2E1C), MK(0xDF25A0E2, 0x813581F7), MK(0xE4004093, 0x8B12F9D2), MK(0xA662D539, 0xC2ED39B6), MK(0xFA8B85CF, 0x45D8C75A), MK(0x8316ED8E, 0x29EDE796), MK(0x053289C0, 0x2E9F91B8), MK(0xC3F8EF1D, 0x6D518B73), MK(0xBDCEC3C4, 0xD5EF332E), MK(0x549A7E52, 0x22974487), MK(0x67070872, 0x5B749816), MK(0xB9CD28FB, 0xF0581BD1), MK(0x0E2940B8, 0x15804974)],
  1024: [MK(0xD593DA07, 0x41E72355), MK(0x15B5E511, 0xAC73E00C), MK(0x5180E5AE, 0xBAF2C4F0), MK(0x03BD41D3, 0xFCBCAFAF), MK(0x1CAEC6FD, 0x1983A898), MK(0x6E510B8B, 0xCDD0589F), MK(0x77E2BDFD, 0xC6394ADA), MK(0xC11E1DB5, 0x24DCB0A3), MK(0xD6D14AF9, 0xC6329AB5), MK(0x6A9B0BFC, 0x6EB67E0D), MK(0x9243C60D, 0xCCFF1332), MK(0x1A1F1DDE, 0x743F02D4), MK(0x0996753C, 0x10ED0BB8), MK(0x6572DD22, 0xF2B4969A), MK(0x61FD3062, 0xD00A579A), MK(0x1DE0536E, 0x8682E539)],
};
const IVS = { 4: IV_256, 8: IV_512, 16: IV_1024 };

/* ---- 字节 ↔ 64 位字（小端）---- */
function bytesToWords(bytes, nw) {
  const out = new Array(nw);
  for (let i = 0; i < nw; i++) {
    let v = 0n;
    for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(bytes[i * 8 + j]);
    out[i] = v;
  }
  return out;
}
function wordsToBytes(words) {
  const out = new Uint8Array(words.length * 8);
  words.forEach((w, i) => {
    for (let j = 0; j < 8; j++) { out[i * 8 + j] = Number(w & 0xffn); w >>= 8n; }
  });
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(hex) {
  const h = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  if (h.length % 2) throw new Error("hex 串长度须为偶数");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---- 单块处理（照 Skein_xxx_Process_Block）：Threefish(X, [T0,T1]) ⊕ 块 ---- */
function processBlock(X, t0, t1, blockWords, byteCntAdd, nw) {
  t0 = (t0 + BigInt(byteCntAdd)) & MASK64;
  const ctx = makeCtx(nw, X, [t0, t1]);
  const out = ctx.encryptBlock(blockWords);
  const nx = new Array(nw);
  for (let i = 0; i < nw; i++) nx[i] = (out[i] ^ blockWords[i]) & MASK64;
  return { X: nx, t0, t1: t1 & ~T1_FIRST };
}

/* ---- 完整哈希 ---- */
function skeinHex(bytes, nw, hashBitLen) {
  const blockBytes = 8 * nw;
  const iv = IVS[nw];
  if (!iv || !iv[hashBitLen]) throw new Error(`无预计算 IV：Skein-${nw * 64} 输出 ${hashBitLen} 位`);
  let X = iv[hashBitLen].slice();
  let t0 = 0n, t1 = T1_FIRST | (TYPE_MSG << 56n);

  // 照 C 参考 Update/Final 语义分块：只有「缓冲 + 新数据 > 块大小」才处理完整块。
  // 消息恰好 N×块时，最后一块在 Final 里作为末块处理（FIRST 保留 + FINAL 标志 + byteCntAdd=整块）。
  const nblocks = bytes.length > 0 ? Math.floor((bytes.length - 1) / blockBytes) : 0;
  for (let i = 0; i < nblocks; i++) {
    const r = processBlock(X, t0, t1, bytesToWords(bytes.subarray(i * blockBytes, (i + 1) * blockBytes), nw), blockBytes, nw);
    X = r.X; t0 = r.t0; t1 = r.t1;
  }
  // 末块：T1 |= FINAL，零填充，byteCntAdd = 实际字节数
  t1 |= T1_FINAL;
  const rem = bytes.length - nblocks * blockBytes;
  const buf = new Uint8Array(blockBytes);
  buf.set(bytes.subarray(nblocks * blockBytes));
  let r = processBlock(X, t0, t1, bytesToWords(buf, nw), rem, nw);
  X = r.X;

  // 输出 counter 模式
  const byteCnt = (hashBitLen + 7) >> 3;
  const Xsave = X.slice();
  let outHex = "";
  for (let i = 0; i * blockBytes < byteCnt; i++) {
    const ctr = new Uint8Array(blockBytes);
    for (let b = 0; b < 8; b++) ctr[b] = Number((BigInt(i) >> BigInt(8 * b)) & 0xffn);
    const r2 = processBlock(Xsave.slice(), 0n, T1_FIRST | (TYPE_OUT << 56n) | T1_FINAL, bytesToWords(ctr, nw), 8, nw);
    const n = Math.min(blockBytes, byteCnt - i * blockBytes);
    outHex += bytesToHex(wordsToBytes(r2.X).subarray(0, n));
  }
  return outHex.toLowerCase();
}

/* ---- 载入自检：Skein3Fish skein_golden_kat.txt 官方向量 ---- */
(() => {
  const enc = new TextEncoder();
  const V = [
    [new Uint8Array(0), 4, 256, "c8877087da56e072870daa843f176e9453115929094c3a40c463a196c29bf7ba"],
    [new Uint8Array(0), 8, 512, "bc5b4c50925519c290cc634277ae3d6257212395cba733bbad37a4af0fa06af41fca7903d06564fea7a2d3730dbdb80c1f85562dfcc070334ea4d1d9e72cba7a"],
    [new Uint8Array(0), 16, 1024, "0fff9563bb3279289227ac77d319b6fff8d7e9f09da1247b72a0a265cd6d2a62645ad547ed8193db48cff847c06494a03f55666d3b47eb4c20456c9373c86297d630d5578ebd34cb40991578f9f52b18003efa35d3da6553ff35db91b81ab890bec1b189b7f52cb2a783ebb7d823d725b0b4a71f6824e88f68f982eefc6d19c6"],
    [new Uint8Array(128), 4, 224, "f4b52fced0c88e95a3ca67b2d2d8d8d4d2dd16cafc0db7aece570f53"],   // 1024-bit zero
    [new Uint8Array(128), 8, 256, "2d0e2e241972df39be822a8c682105c64747faf8a10ec032881de7dc67887cc2"],
    [new Uint8Array(128), 8, 384, "e63ea4698f314ad9f8f8cbd1f336e027955f8dce78c3210af9b1f46bd328367d8e88d431071c4385cd8b50d74862c248"],
    [new Uint8Array(128), 8, 512, "fbe65b75d681b2fe354780bddf82ccf164c5cb2827f8e4e7de96235907443428957881c76ce46555e2bb9ee34f42f7a9b2e090b55d73c7a02506e17bbdffa4f2"],
    [new Uint8Array(128), 4, 256, "35da44b91bfb020e6e85592e3310a6e6d8939a64c778913003a61bc13583edaf"],
  ];
  for (const [msg, nw, hbl, want] of V) {
    const got = skeinHex(msg, nw, hbl);
    if (got !== want) throw new Error(`Skein-${nw * 64}-${hbl} 向量自检失败（${msg.length}B）：得到 ${got}\n期望   ${want}`);
  }
})();

/* ---------- 注册 ---------- */

const VARIANTS = {
  "256-224": [4, 224], "256-256": [4, 256],
  "512-256": [8, 256], "512-384": [8, 384], "512-512": [8, 512],
  "1024-512": [16, 512], "1024-1024": [16, 1024],
};

function skeinRun(text, p = {}) {
  const variant = (p && p.variant) || "512-512";
  const [nw, hbl] = VARIANTS[variant] || [8, 512];
  const inputMode = (p && p.inputMode) || "text";
  const input = inputMode === "hex"
    ? hexToBytes(text)
    : new TextEncoder().encode(String(text || ""));

  const digest = skeinHex(input, nw, hbl);
  const lines = [];
  lines.push(`=== Skein-${nw * 64}-${hbl} ===`);
  lines.push(`输入: ${input.length} 字节（${inputMode === "hex" ? "Hex" : "文本 UTF-8"}）`);
  lines.push("");
  lines.push("摘要 (hex):");
  lines.push(digest);
  lines.push("");
  lines.push(`大写: ${digest.toUpperCase()}`);
  return lines.join("\n");
}

register({
  id: "skein",
  cat: "hash",
  name: "Skein",
  desc: "Skein 哈希（NIST SHA-3 决赛候选，Threefish 可调分组密码 Miyaguchi-Preneel 模式）：Skein-256/512/1024 状态，输出 224~1024 位。SHA-3 决赛圈里以速度著称，Skein-512-512 与 Threefish 同核。已过 Skein3Fish skein_golden_kat.txt 官方向量。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "512-512",
      options: [
        { value: "256-224", label: "Skein-256-224" },
        { value: "256-256", label: "Skein-256-256" },
        { value: "512-256", label: "Skein-512-256" },
        { value: "512-384", label: "Skein-512-384" },
        { value: "512-512", label: "Skein-512-512" },
        { value: "1024-512", label: "Skein-1024-512" },
        { value: "1024-1024", label: "Skein-1024-1024" },
      ],
    },
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本 (UTF-8)" },
        { value: "hex", label: "Hex" },
      ],
    },
  ],
  run: skeinRun,
});
