/*
 * collisionShow.js — MD5 截断碰撞演示（cat:'analysis'）。
 *
 * 教学展示：对 MD5 输出截断到 bitLen 位（默认 40），用生日法找碰撞对
 * （不同输入 → 相同截断哈希）。完整 128 位 MD5 碰撞需要 fastcoll 类
 * 专用构造工具，本 op 演示「碰撞存在性」的本质（2^(b/2) 尝试）。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";
import { md5Bytes } from "./hash.js";

/** 字节 → 小写 hex（浏览器安全，不用 Node Buffer）。 */
function bytesToHexStr(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function md5HexOf(input) {
  return bytesToHexStr(md5Bytes(new TextEncoder().encode(input)));
}

/** 截断 MD5 生日碰撞（bit-exact）：返回 {a, b, hash, tries} 或 null。 */
export function md5TruncCollision(bitLen, maxTries = 300000) {
  const b = Math.floor(Number(bitLen));
  if (!Number.isInteger(b) || b < 16 || b > 48) {
    throw new Error("截断位数须为 16-48 的整数（当前 " + bitLen + "）");
  }
  const hexWidth = Math.ceil(b / 4);
  const seen = new Map();
  let nonce = 0;
  while (nonce < maxTries) {
    const input = "coll" + nonce;
    const md = md5HexOf(input);
    // 取 MD5 最左 b 位：128 位整型右移 (128-b) 位（不按 nibble 取整）
    const key = (BigInt("0x" + md) >> BigInt(128 - b)).toString(16).padStart(hexWidth, "0");
    const prev = seen.get(key);
    if (prev !== undefined && prev !== input) {
      return { a: prev, b: input, hash: key, tries: nonce };
    }
    seen.set(key, input);
    nonce++;
  }
  return null;
}

function md5CollisionOp(text, p = {}) {
  const raw = (p && p.bitLen != null && String(p.bitLen).trim() !== "") ? p.bitLen : 32;
  const bitLen = Number(raw);
  if (!Number.isInteger(bitLen) || bitLen < 16 || bitLen > 48) {
    throw new Error("截断位数须为 16-48 的整数（当前 " + raw + "）");
  }
  const res = md5TruncCollision(bitLen);
  if (!res) return "未找到碰撞（" + bitLen + " 位截断，尝试上限内）";
  return (
    "截断 MD5 生日碰撞（" + bitLen + " 位）：\n" +
    "输入 A：\"" + res.a + "\"  → " + res.hash + "\n" +
    "输入 B：\"" + res.b + "\"  → " + res.hash + "\n" +
    "尝试次数：" + res.tries + "（期望 ≈2^" + (bitLen / 2) + "）\n\n" +
    "说明：完整 128 位 MD5 碰撞需 fastcoll 类专用构造（如著名的\n" +
    "79054025255fb1a26e4bc422aef54eb4 碰撞对）；本演示展示碰撞存在性本质。"
  );
}

register({
  id: "md5CollisionShow", cat: "analysis", name: "MD5 截断碰撞演示",
  desc: "教学演示：截断 MD5（默认 32 位，16-48 整数）生日法找碰撞对（不同输入同截断哈希），按位精确截断（非整 nibble），展示哈希碰撞本质",
  params: [
    { key: "bitLen", label: "截断位数（16-48 整数）", type: "number", default: 32, placeholder: "16-48" },
  ],
  run: md5CollisionOp,
});

export { md5CollisionOp };
