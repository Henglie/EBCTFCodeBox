/*
 * t816StripIpv4.js — 剥离 IPv4 头（CyberChef #410）。
 *
 * 口径与 CyberChef src/core/operations/StripIPv4Header.mjs 一致：
 * 最小 20 字节；IHL = 首字节低 4 位，头部长度 = IHL*4；长度不足即报错，否则输出头部之后的载荷。
 * 输出按 ArrayBuffer 语义以 Latin-1 文本还原字节。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf, bytesToLatin1 } from "./t813Common.js";

register({
  id: "stripIpv4",
  cat: "forensic",
  name: "剥离 IPv4 头",
  acceptsBytes: true,
  desc: "按 IHL（首字节低 4 位 × 4）跳过 IPv4 头，输出载荷字节；不足最小 20 字节或不足 IHL 长度时报错。口径同 CyberChef「Strip IPv4 header」",
  params: [],
  run(text, p) {
    const MIN_HEADER_LEN = 20;
    const bytes = bytesOf(text, p);
    if (bytes.length < MIN_HEADER_LEN) {
      throw new Error("输入长度小于 IPv4 头部最小长度 20 字节");
    }
    const ihl = bytes[0] & 0x0f;
    const dataOffsetBytes = ihl * 4;
    if (bytes.length < dataOffsetBytes) {
      throw new Error("输入长度小于 IHL 指定的头部长度（" + dataOffsetBytes + " 字节）");
    }
    return bytesToLatin1(bytes.subarray(dataOffsetBytes));
  },
});
