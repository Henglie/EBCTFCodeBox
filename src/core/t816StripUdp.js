/*
 * t816StripUdp.js — 剥离 UDP 头（CyberChef #412）。
 *
 * 口径与 CyberChef src/core/operations/StripUDPHeader.mjs 一致：
 * UDP 头固定 8 字节，不足即报错，否则输出其后载荷。输出按 ArrayBuffer 语义以 Latin-1 文本还原字节。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf, bytesToLatin1 } from "./t813Common.js";

register({
  id: "stripUdp",
  cat: "forensic",
  name: "剥离 UDP 头",
  acceptsBytes: true,
  desc: "跳过固定 8 字节 UDP 头，输出载荷字节；不足 8 字节报错。口径同 CyberChef「Strip UDP header」",
  params: [],
  run(text, p) {
    const HEADER_LEN = 8;
    const bytes = bytesOf(text, p);
    if (bytes.length < HEADER_LEN) {
      throw new Error("UDP 头需要 8 字节");
    }
    return bytesToLatin1(bytes.subarray(HEADER_LEN));
  },
});
