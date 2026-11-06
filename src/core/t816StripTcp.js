/*
 * t816StripTcp.js — 剥离 TCP 头（CyberChef #411）。
 *
 * 口径与 CyberChef src/core/operations/StripTCPHeader.mjs 一致：
 * 最小 20 字节；Data Offset = 第 12 字节高 4 位，头部长度 = 该值*4；不足即报错，否则输出载荷。
 * 输出按 ArrayBuffer 语义以 Latin-1 文本还原字节。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf, bytesToLatin1 } from "./t813Common.js";

register({
  id: "stripTcp",
  cat: "forensic",
  name: "剥离 TCP 头",
  acceptsBytes: true,
  desc: "按 Data Offset（第 12 字节高 4 位 × 4）跳过 TCP 头，输出载荷字节；不足 20 字节或不足数据偏移时报错。口径同 CyberChef「Strip TCP header」",
  params: [],
  run(text, p) {
    const MIN_HEADER_LEN = 20;
    const DATA_OFFSET_OFFSET = 12;
    const bytes = bytesOf(text, p);
    if (bytes.length < MIN_HEADER_LEN) {
      throw new Error("TCP 头至少需要 20 字节");
    }
    const dataOffsetWords = (bytes[DATA_OFFSET_OFFSET] >> 4) & 0x0f;
    const dataOffsetBytes = dataOffsetWords * 4;
    if (bytes.length < dataOffsetBytes) {
      throw new Error("输入长度小于 Data Offset 指定的头部长度（" + dataOffsetBytes + " 字节）");
    }
    return bytesToLatin1(bytes.subarray(dataOffsetBytes));
  },
});
