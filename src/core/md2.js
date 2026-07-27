/*
 * md2.js — MD2 消息摘要。
 *
 * RFC 1319。128 位输出，基于 256 字节 pi 置换表 S + 校验字节。
 * WebCrypto 无 MD2，纯 JS 实现。
 *
 * 契约：单向 run(text) → hex 串。
 * 权威向量：RFC 1319 附录 A.5（空串 → 8350e5a3e24c153df2275c9f80692773）。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// RFC 1319 附录：256 字节 S 置换表（基于 pi 小数，照抄标准，不许编造）
const MD2_S = [
  41, 46, 67, 201, 162, 216, 124, 1, 61, 54, 84, 161, 236, 240, 6, 19,
  98, 167, 5, 243, 192, 199, 115, 140, 152, 147, 43, 217, 188, 76, 130, 202,
  30, 155, 87, 60, 253, 212, 224, 22, 103, 66, 111, 24, 138, 23, 229, 18,
  190, 78, 196, 214, 218, 158, 222, 73, 160, 251, 245, 142, 187, 47, 238, 122,
  169, 104, 121, 145, 21, 178, 7, 63, 148, 194, 16, 137, 11, 34, 95, 33,
  128, 127, 93, 154, 90, 144, 50, 39, 53, 62, 204, 231, 191, 247, 151, 3,
  255, 25, 48, 179, 72, 165, 181, 209, 215, 94, 146, 42, 172, 86, 170, 198,
  79, 184, 56, 210, 150, 164, 125, 182, 118, 252, 107, 226, 156, 116, 4, 241,
  69, 157, 112, 89, 100, 113, 135, 32, 134, 91, 207, 101, 230, 45, 168, 2,
  27, 96, 37, 173, 174, 176, 185, 246, 28, 70, 97, 105, 52, 64, 126, 15,
  85, 71, 163, 35, 221, 81, 175, 58, 195, 92, 249, 206, 186, 197, 234, 38,
  44, 83, 13, 110, 133, 40, 132, 9, 211, 223, 205, 244, 65, 129, 77, 82,
  106, 220, 55, 200, 108, 193, 171, 250, 36, 225, 123, 8, 12, 189, 177, 74,
  120, 136, 149, 139, 227, 99, 232, 109, 233, 203, 213, 254, 59, 0, 29, 57,
  242, 239, 183, 14, 102, 88, 208, 228, 166, 119, 114, 248, 235, 117, 75, 10,
  49, 68, 80, 180, 143, 237, 31, 26, 219, 153, 141, 51, 159, 17, 131, 20,
];

function md2Bytes(bytes) {
 // 1. 填充到 16 字节整数倍：补 i 个值为 i 的字节（i = 16 - len%16，恒 1..16）
  const padLen = 16 - (bytes.length % 16);
  const msg = new Uint8Array(bytes.length + padLen);
  msg.set(bytes);
  for (let i = bytes.length; i < msg.length; i++) msg[i] = padLen;

 // 2. 校验和（16 字节）
  const checksum = new Uint8Array(16);
  let L = 0;
  for (let off = 0; off < msg.length; off += 16) {
    for (let j = 0; j < 16; j++) {
      const c = msg[off + j];
      checksum[j] ^= MD2_S[c ^ L];
      L = checksum[j];
    }
  }

 // 3. 主循环：48 字节状态 X，处理 每 16 字节块 + 尾接校验和块
  const full = new Uint8Array(msg.length + 16);
  full.set(msg);
  full.set(checksum, msg.length);

  const X = new Uint8Array(48);
  for (let off = 0; off < full.length; off += 16) {
    for (let j = 0; j < 16; j++) {
      X[16 + j] = full[off + j];
      X[32 + j] = X[16 + j] ^ X[j];
    }
    let t = 0;
    for (let round = 0; round < 18; round++) {
      for (let j = 0; j < 48; j++) {
        t = X[j] ^= MD2_S[t];
      }
      t = (t + round) & 0xff;
    }
  }
  return X.slice(0, 16);
}

function md2(text) {
  return toHex(md2Bytes(te(text)));
}

register({
  id: "md2", cat: "hash", name: "MD2",
  desc: "MD2 消息摘要（128 位，RFC 1319，256 字节置换表 + 校验字节，纯 JS）",
  run: (t) => md2(t),
});

export { md2, md2Bytes };
