/*
 * kuznyechik.js — GOST R 34.12-2015 「Kuznyechik / Кузнечик」分组密码（cat:'block'，双向）。
 *
 * 俄罗斯联邦标准（ГОСТ Р 34.12-2015）128 位分组密码，Magma 的姊妹算法，信创/国际赛题常见：
 *   - 分组 128 位（16 字节），密钥 256 位，10 轮 SPN（LSX 结构）。
 *   - S 盒：256 字节非线性代换 Pi'（GOST R 34.12-2015 §4.1 / RFC 7801 §4.1 全表）。
 *   - 线性变换：l(a15..a0) = GF(2^8) 上 16 字节系数线性组合（系数 148,32,133,16,194,192,
 *     1,251 自 a15 起降序，自 a7 起为 1,192,194,16,133,32,148,1），域多项式
 *     p(x) = x^8+x^7+x^6+x+1（0x1C3）。R = l 后循环右移 1 字节；L = R 迭代 16 次。
 *   - 密钥排程：K1||K2 = 主密钥；对 i=1..4 轮，依次用 C_1..C_8 做 Feistel：
 *     F[C](k1,k2) = (LSX[C](k1) XOR k2, k1)；C_j = L(Vec_128(j))。产出 K1..K10。
 *   - 加密 b = X[K10] LSX[K9]...LSX[K1](a)；解密逆推。
 *
 * 官方测试向量（GOST R 34.12-2015 §A.1，与 RFC 7801 §5 同源，2026-09-22 双源核对）：
 *   Key   = 8899aabbccddeeff0011223344556677fedcba98765432100123456789abcdef
 *   明文  1122334455667700ffeeddccbbaa9988 → 密文 7f679d90bebc24305a468d42b9d4edcd
 *   （§5 全部中间值：S 链 4 组、R 链 4 组、L 链 4 组、K1..K10、C1..C8、逐轮 LSX 输出，
 *     均在交付验证台逐字复现，见 ref/SOURCES.md。）
 *
 * 模式（GOST R 34.13-2015）：
 *   - ECB/CBC/CFB/OFB/CTR；CBC/CFB/OFB 支持多分组 IV 反馈寄存器。
 *   - CTR：8 字节 nonce + 64 位低半计数器。
 *   - padding：ECB/CBC 用统一填充（默认 none）；keyMeshing：NO/CP（RFC 4357 §2.3.2）。
 *
 * 约定：
 *   - encode: 明文 hex → 密文 hex（加密）；decode: 密文 hex → 明文 hex（解密）。
 *   - 默认 ECB + NoPadding 保持旧输出；CBC 默认不自动填充。
 *   - 密钥须 256 位（64 hex）。
 *
 * 红线：算法照 GOST R 34.12-2015 实现，不编造；建表后自校验 R/L/C1 与轮密钥（§5 锚点值）；
 *   交付前过官方向量。纯本地零外发；core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({ id:"kuznyechik", cat:"block", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";
import { PADDING_OPTIONS } from "./modern.js";
import { gostModeCrypt } from "./gostModes.js";

// ============================================================
// S 盒 Pi'（RFC 7801 §4.1 / GOST R 34.12-2015 §4.1，256 字节全表逐字转录）
// ============================================================
const SBOX = [
  252, 238, 221, 17, 207, 110, 49, 22, 251, 196, 250,
  218, 35, 197, 4, 77, 233, 119, 240, 219, 147, 46,
  153, 186, 23, 54, 241, 187, 20, 205, 95, 193, 249,
  24, 101, 90, 226, 92, 239, 33, 129, 28, 60, 66,
  139, 1, 142, 79, 5, 132, 2, 174, 227, 106, 143,
  160, 6, 11, 237, 152, 127, 212, 211, 31, 235, 52,
  44, 81, 234, 200, 72, 171, 242, 42, 104, 162, 253,
  58, 206, 204, 181, 112, 14, 86, 8, 12, 118, 18,
  191, 114, 19, 71, 156, 183, 93, 135, 21, 161, 150,
  41, 16, 123, 154, 199, 243, 145, 120, 111, 157, 158,
  178, 177, 50, 117, 25, 61, 255, 53, 138, 126, 109,
  84, 198, 128, 195, 189, 13, 87, 223, 245, 36, 169,
  62, 168, 67, 201, 215, 121, 214, 246, 124, 34, 185,
  3, 224, 15, 236, 222, 122, 148, 176, 188, 220, 232,
  40, 80, 78, 51, 10, 74, 167, 151, 96, 115, 30,
  0, 98, 68, 26, 184, 56, 130, 100, 159, 38, 65,
  173, 69, 70, 146, 39, 94, 85, 47, 140, 163, 165,
  125, 105, 213, 149, 59, 7, 88, 179, 64, 134, 172,
  29, 247, 48, 55, 107, 228, 136, 217, 231, 137, 225,
  27, 131, 73, 76, 63, 248, 254, 141, 83, 170, 144,
  202, 216, 133, 97, 32, 113, 103, 164, 45, 43, 9,
  91, 203, 155, 37, 208, 190, 229, 108, 82, 89, 166,
  116, 210, 230, 244, 180, 192, 209, 102, 175, 194, 57,
  75, 99, 182,
];

// 逆 S 盒由全表反推（双射确定性构造），并用 RFC 7801 逆表锚点自校验（见文件底部）
const SBOX_INV = new Array(256);
for (let i = 0; i < 256; i++) SBOX_INV[SBOX[i]] = i;

// l 系数：自 a15（首字节）降序到 a0（末字节）
const L_COEFF = [148, 32, 133, 16, 194, 192, 1, 251, 1, 192, 194, 16, 133, 32, 148, 1];
const GF_POLY = 0x1c3; // x^8+x^7+x^6+x+1

// GF(2^8) 乘法（移位消多项式）
function gmul(a, b) {
  let r = 0;
  let x = a >>> 0;
  let y = b >>> 0;
  while (y) {
    if (y & 1) r ^= x;
    y >>>= 1;
    x <<= 1;
    if (x & 0x100) x ^= GF_POLY;
  }
  return r >>> 0;
}

// l 变换：16 字节 → 1 字节（GF 系数线性组合）
function lTransform(bytes) {
  let acc = 0;
  for (let i = 0; i < 16; i++) acc ^= gmul(L_COEFF[i], bytes[i]);
  return acc >>> 0;
}

// R 变换：先 l 再整体右移 1 字节（末字节 a0 移出）
function rTransform(bytes) {
  const e = lTransform(bytes);
  const out = new Array(16);
  out[0] = e;
  for (let i = 1; i < 16; i++) out[i] = bytes[i - 1];
  return out;
}

// R 逆变换：arr = (e, a15..a1)，a0 = e XOR l(a15..a1, 0)（l 线性、a0 系数为 1）
function rTransformInv(bytes) {
  const e = bytes[0];
  let l0 = 0;
  for (let i = 0; i < 15; i++) l0 ^= gmul(L_COEFF[i], bytes[i + 1]);
  const a0 = (e ^ l0) >>> 0;
  const out = new Array(16);
  for (let i = 0; i < 15; i++) out[i] = bytes[i + 1];
  out[15] = a0;
  return out;
}

function lTransformBlock(bytes) {
  let cur = bytes;
  for (let i = 0; i < 16; i++) cur = rTransform(cur);
  return cur;
}

function lTransformBlockInv(bytes) {
  let cur = bytes;
  for (let i = 0; i < 16; i++) cur = rTransformInv(cur);
  return cur;
}

// 字节串 hex ↔ 数组
function hexToBytes(hex) {
  const clean = String(hex).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("非法 hex 字符（仅允许 0-9/A-F 与空白）");
  if (clean.length % 2 !== 0) throw new Error("hex 串长度须为偶数");
  const out = [];
  for (let i = 0; i < clean.length; i += 2) out.push(parseInt(clean.substr(i, 2), 16));
  return out;
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function xorInto(a, k) {
  const out = new Array(16);
  for (let i = 0; i < 16; i++) out[i] = (a[i] ^ k[i]) >>> 0;
  return out;
}

function sBytes(bytes) {
  return bytes.map((b) => SBOX[b]);
}
function sBytesInv(bytes) {
  return bytes.map((b) => SBOX_INV[b]);
}

// ============================================================
// 密钥排程：256 位 → K1..K10（Feistel，C_j = L(Vec_128(j))）
// ============================================================
function keyScheduleBytes(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) throw new Error("Kuznyechik 密钥须为 256 位（32 字节 / 64 hex 字符）");
  const all = Array.from(keyBytes);
  const K = [all.slice(0, 16), all.slice(16, 32)];
  let k1 = K[0], k2 = K[1];
  for (let i = 0; i < 4; i++) {
    for (let j = 1; j <= 8; j++) {
      const c = new Array(16).fill(0);
      c[15] = 8 * i + j; // C_{8(i-1)+j} = L(Vec_128(8(i-1)+j))，i、j 从 1 起；此处 i 从 0 起
      const ci = lTransformBlock(c);
      const t = xorInto(lTransformBlock(sBytes(xorInto(k1, ci))), k2);
      k2 = k1;
      k1 = t;
    }
    K.push(k1.slice());
    K.push(k2.slice());
  }
  return K;
}

function keySchedule(keyHex) {
  const clean = String(keyHex).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 64) throw new Error("Kuznyechik 密钥须为 256 位（64 hex 字符）");
  return keyScheduleBytes(hexToBytes(clean));
}

// ============================================================
// 单块加/解密（128 位）
// ============================================================
function encryptBlock(block, K) {
  let cur = block.slice();
  for (let i = 0; i <= 8; i++) {
    cur = lTransformBlock(sBytes(xorInto(cur, K[i]))); // LSX[K_{i+1}]
  }
  return xorInto(cur, K[9]); // X[K10]
}

function decryptBlock(block, K) {
  let cur = block.slice();
  for (let i = 9; i >= 1; i--) {
    cur = sBytesInv(lTransformBlockInv(xorInto(cur, K[i]))); // S^-1 L^-1 X[K_{i+1}]（K10..K2 共 9 轮）
  }
  return xorInto(cur, K[0]); // X[K1]
}

// ============================================================
// op 入口：ECB / CBC / CFB / OFB / CTR（块 128 位，可配置填充）
// ============================================================
const KUZ_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);

function kuznyechikCrypt(text, p, decrypt) {
  const keyHex = String((p && p.key) || "");
  const keyBytes = Uint8Array.from(hexToBytes(keyHex));
  if (keyBytes.length !== 32) throw new Error("Kuznyechik 密钥须为 256 位（32 字节 / 64 hex 字符）");
  const mode = String((p && p.mode) || "ECB").toUpperCase();
  if (!KUZ_MODES.has(mode)) throw new Error(`Kuznyechik 不支持模式: ${mode}`);
  const ivHex = String((p && p.iv) || "").replace(/[^0-9a-fA-F]/g, "");
  const iv = ivHex ? Uint8Array.from(hexToBytes(ivHex)) : undefined;
  const data = Uint8Array.from(hexToBytes(String(text || "")));
  const out = gostModeCrypt({
    mode, decrypt, data, blockSize: 16, iv,
    padding: (p && p.padding) || "none",
    keyMeshing: (p && p.keyMeshing) || "NO",
    keyBytes,
    makeSchedule: (kb) => keyScheduleBytes(kb),
    encryptBlock: (blk, sch) => Uint8Array.from(encryptBlock(blk, sch)),
    decryptBlock: (blk, sch) => Uint8Array.from(decryptBlock(blk, sch)),
  });
  return bytesToHex(out);
}

function kuznyechikEncode(text, p) { return kuznyechikCrypt(text, p, false); }
function kuznyechikDecode(text, p) { return kuznyechikCrypt(text, p, true); }

// ============================================================
// 建表自校验（规范锚点，RFC 7801 §5；任一失败即抛错，防错表静默运行）
// ============================================================
(function selfCheck() {
  const eq = (a, b) => bytesToHex(a) === b;
  // 逆表锚点：Pi^-1(0)=165, Pi^-1(1)=45, Pi^-1(2)=50, Pi^-1(255)=116（RFC 逆表首尾）
  if (SBOX_INV[0] !== 165 || SBOX_INV[1] !== 45 || SBOX_INV[2] !== 50 || SBOX_INV[255] !== 116)
    throw new Error("Kuznyechik 逆 S 盒锚点自检失败");
  // R 链锚点：R(00..0100) = 94000000000000000000000000000001
  if (!eq(rTransform(hexToBytes("00000000000000000000000000000100")), "94000000000000000000000000000001"))
    throw new Error("Kuznyechik R 变换自检失败");
  // L 锚点：L(64a59400000000000000000000000000) = d456584dd0e3e84cc3166e4b7fa2890d
  if (!eq(lTransformBlock(hexToBytes("64a59400000000000000000000000000")), "d456584dd0e3e84cc3166e4b7fa2890d"))
    throw new Error("Kuznyechik L 变换自检失败");
  // C_1 锚点：L(Vec_128(1)) = 6ea276726c487ab85d27bd10dd849401
  const c1 = new Array(16).fill(0);
  c1[15] = 1;
  if (!eq(lTransformBlock(c1), "6ea276726c487ab85d27bd10dd849401"))
    throw new Error("Kuznyechik C1 构造自检失败");
  // 轮密钥锚点：K3 = db31485315694343228d6aef8cc78c44
  const K = keySchedule("8899aabbccddeeff0011223344556677fedcba98765432100123456789abcdef");
  if (!eq(K[2], "db31485315694343228d6aef8cc78c44"))
    throw new Error("Kuznyechik 密钥排程自检失败（K3）");
})();

register({
  id: "kuznyechik",
  cat: "block",
  name: "Kuznyechik（GOST R 34.12-2015）",
  desc: "俄罗斯联邦标准 Kuznyechik（Grasshopper）分组密码：128 位分组 / 256 位密钥 / 10 轮 LSX-SPN，密钥排程 Feistel（C=L(Vec_128(i))）。模式按 GOST R 34.13-2015：CTR 半块 nonce + 低半 64 位计数器，CBC/CFB/OFB 支持多分组反馈寄存器。keyMeshing CP 按 RFC 4357 §2.3.2 每 1024 字节更新密钥。ECB/CBC 支持统一填充（默认 NoPadding，保持旧输出）。明文/密文/密钥均 hex。encode 加密 / decode 解密。过 GOST R 34.12-2015 §A.1（RFC 7801 §5 同源）向量与 §A 模式向量。",
  params: [
    { key: "key", label: "密钥 (hex, 256 位 / 64 字符)", type: "text", default: "8899aabbccddeeff0011223344556677fedcba98765432100123456789abcdef", placeholder: "64 hex 字符" },
    { key: "mode", label: "模式", type: "select", default: "ECB",
      options: ["ECB", "CBC", "CFB", "OFB", "CTR"].map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV (hex)", type: "text", default: "", placeholder: "CBC/CFB/OFB 为 16 字节整数倍；CTR 8 字节（或 16 字节取前 8）" },
    { key: "padding", label: "填充（ECB/CBC 用；流模式忽略）", type: "select", default: "none", options: PADDING_OPTIONS },
    { key: "keyMeshing", label: "密钥更新（key meshing）", type: "select", default: "NO",
      options: [
        { value: "NO", label: "NO（不更新，默认）" },
        { value: "CP", label: "CP（CryptoPro，每 1024 字节；ECB 忽略）" },
      ] },
  ],
  encode: kuznyechikEncode,
  decode: kuznyechikDecode,
});

export {
  kuznyechikEncode, kuznyechikDecode,
  keySchedule, keyScheduleBytes, encryptBlock, decryptBlock,
  lTransform, lTransformBlock, lTransformBlockInv, rTransform, rTransformInv,
  sBytes, sBytesInv, gmul, SBOX, SBOX_INV, L_COEFF,
  hexToBytes, bytesToHex,
};
