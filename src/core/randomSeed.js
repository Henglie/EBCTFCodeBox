/*
 * randomSeed.js — 随机字节/种子生成（T277 P3，cat:'radix'）。
 *
 * 用 crypto.getRandomValues（浏览器 CSPRNG）生成随机字节，输出 hex/base64/utf8。
 *
 * 红线：
 * - 随机源用 crypto.getRandomValues，不用 Math.random。
 * - 零外发：纯本地计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"radix", name, desc, params, run})。
 * run 单向，参数 length/format，输出随机字符串。
 */
import { register } from "./registry.js";

function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}

register({
  id: "randomSeed", cat: "radix", name: "随机种子生成",
  desc: "crypto CSPRNG 生成随机字节（hex/base64）",
  params: [
    { key: "length", label: "字节数", type: "number", default: 16, placeholder: "1..4096 字节" },
    { key: "format", label: "输出格式", type: "select", default: "hex",
      options: [
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ] },
  ],
  run: (_text, p) => {
    const len = Math.max(1, Math.min(4096, Number(p?.length) || 16));
    const fmt = p?.format || "hex";
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    return fmt === "base64" ? bytesToB64(buf) : bytesToHex(buf);
  },
});

export { bytesToHex, bytesToB64 };
