/*
 * t813OidToHex.js — 对象标识符 → 十六进制（CyberChef #282 / ITU-T X.690 §8.19）。
 *
 * 首选两条弧合成为 40*X+Y 后按 base-128 varint 编码，其余弧逐一 varint 编码；
 * 输出小写连续十六进制。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { encodeBase128, bytesToHexLower } from "./t813Common.js";

register({
  id: "oidToHex",
  cat: "asym",
  name: "对象标识符 → 十六进制",
  desc: "把点分十进制 OID 编码为 ASN.1 内容字节的十六进制（首段 40*X+Y + base-128 varint）。依据 ITU-T X.690 §8.19",
  params: [],
  run(text) {
    const raw = String(text == null ? "" : text).trim();
    if (!raw) throw new Error("OID 输入为空");
    const arcs = raw.split(".").map((s) => s.trim());
    if (arcs.length < 2) throw new Error("OID 至少需要两段：X.Y");
    const nums = arcs.map((s) => {
      if (!/^\d+$/.test(s)) throw new Error("OID 段必须是非负十进制整数：" + JSON.stringify(s));
      return Number(s);
    });
    const first = nums[0], second = nums[1];
    if (first > 2) throw new Error("OID 首段必须为 0/1/2，得到 " + first);
    if (first < 2 && second > 39) throw new Error("首段为 " + first + " 时第二段必须 ≤ 39，得到 " + second);
    const out = encodeBase128(40 * first + second);
    for (let i = 2; i < nums.length; i++) {
      const enc = encodeBase128(nums[i]);
      for (const b of enc) out.push(b);
    }
    return bytesToHexLower(Uint8Array.from(out));
  },
});
