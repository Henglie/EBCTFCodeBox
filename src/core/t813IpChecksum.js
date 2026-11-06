/*
 * t813IpChecksum.js — TCP/IP 校验和（CyberChef #421 / RFC 1071）。
 *
 * 口径与 CyberChef src/core/operations/TCPIPChecksum.mjs 一致：
 * 输入按原始字节流、16 位大端分组求和，进位回卷一次，取反码，输出小写十六进制（最少 2 位）。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf } from "./t813Common.js";

register({
  id: "ipChecksum",
  cat: "hash",
  name: "TCP/IP 校验和",
  acceptsBytes: true,
  desc: "RFC 1071 反码和校验：16 位大端分组、进位回卷、取反码，输出小写十六进制。口径同 CyberChef「TCP/IP Checksum」",
  params: [],
  run(text, p) {
    const bytes = bytesOf(text, p);
    let csum = 0;
    for (let i = 0; i < bytes.length; i++) {
      if (i % 2 === 0) csum += (bytes[i] << 8);
      else csum += bytes[i];
    }
    csum = (csum >> 16) + (csum & 0xffff);
    return (0xffff - csum).toString(16).padStart(2, "0");
  },
});
