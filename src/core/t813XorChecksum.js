/*
 * t813XorChecksum.js — XOR 分块校验和（CyberChef #493）。
 *
 * 口径与 CyberChef src/core/operations/XORChecksum.mjs 一致：
 * 输入按 blockSize 分块，逐列异或，输出 blockSize 个字节的小写十六进制（连续、无分隔）。
 * 块不足时缺失字节按 0 处理。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf } from "./t813Common.js";

register({
  id: "xorChecksum",
  cat: "hash",
  name: "XOR 分块校验和",
  acceptsBytes: true,
  desc: "把输入按块大小分块，逐列异或后输出等长十六进制。口径同 CyberChef「XOR Checksum」",
  params: [
    { key: "blockSize", label: "块大小（字节）", type: "number", default: 4, placeholder: "正整数" },
  ],
  run(text, p) {
    const blockSize = Number((p && p.blockSize != null) ? p.blockSize : 4);
    if (!Number.isInteger(blockSize) || blockSize <= 0) {
      throw new Error("块大小须为正整数，得到 " + String(p && p.blockSize));
    }
    const bytes = bytesOf(text, p);
    const res = new Array(blockSize).fill(0);
    for (let start = 0; start < bytes.length; start += blockSize) {
      for (let i = 0; i < blockSize; i++) {
        res[i] ^= bytes[start + i] != null ? bytes[start + i] : 0;
      }
    }
    return res.map((b) => (b >>> 4).toString(16) + (b & 0x0f).toString(16)).join("");
  },
});
