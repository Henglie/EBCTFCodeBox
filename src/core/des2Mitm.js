/*
 * des2Mitm.js — 2DES 中间相遇攻击（MITM，cat:'analysis'）。
 *
 * 原理：C = DES_k2(DES_k1(P))。中间相遇：穷举 k1 建表 { DES_k1(P) → k1 }，
 * 再穷举 k2 对 C 做 DES_k2⁻¹ 查表命中即恢复 (k1, k2)。复杂度 2^b × 2 表
 * （b = 每半密钥空间位数），比穷举 2^(2b) 大幅下降。
 *
 * 密钥编码：k1/k2 各占 keyBits 位（默认 24），大端拼成 8 字节（高位置 0）
 * 喂 DES（DES 密钥字节最低位为校验位，makeDes 忽略）。CTF 的 2DES 题常
 * 把密钥限制在小空间（如 6 字符可打印），本 op 用 keyBits 参数模拟。
 *
 * 验证：本地构造随机小空间密钥对拍（encrypt 后用本 op 恢复）往返。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 * 契约：register({ id:"des2Mitm", cat:"analysis", name, desc, run })。
 */
import { register } from "./registry.js";
import { makeDes } from "./modern.js";

function hexToBytes(hex) {
  const h = String(hex || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(h) || h.length % 2 !== 0) throw new Error("需偶数位 hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** 小空间密钥（keyBits 位）→ 8 字节 DES 密钥（大端填充，高位补零）。 */
function smallKeyToDesKey(idx, keyBits) {
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    const shift = (7 - i) * 8;
    out[i] = shift < keyBits ? (idx >> shift) & 0xff : 0;
  }
  return out;
}

/** 2DES MITM：恢复 (k1, k2) 小空间密钥索引。 */
export function des2Mitm(plainBytes, cipherBytes, keyBits) {
  if (plainBytes.length !== 8 || cipherBytes.length !== 8) throw new Error("明文/密文须各 8 字节");
  const n = 1 << keyBits;
  if (keyBits > 20) throw new Error("keyBits 过大（≤20，2^keyBits 次密钥调度）");
  // 阶段 1：forward 表 { DES_k1(P) → k1 }
  const fwd = new Map();
  for (let k1 = 0; k1 < n; k1++) {
    const mid = makeDes(smallKeyToDesKey(k1, keyBits)).encBlock(plainBytes);
    const key = bytesToHex(mid);
    if (!fwd.has(key)) fwd.set(key, k1);
  }
  // 阶段 2：对每个 k2 计算 DES_k2⁻¹(C) 查表 → 全链路验证
  const out = [];
  for (let k2 = 0; k2 < n; k2++) {
    const mid = makeDes(smallKeyToDesKey(k2, keyBits)).decBlock(cipherBytes);
    const k1 = fwd.get(bytesToHex(mid));
    if (k1 !== undefined) {
      // 全链路验证（防表冲突）
      const ct = makeDes(smallKeyToDesKey(k2, keyBits)).encBlock(
        makeDes(smallKeyToDesKey(k1, keyBits)).encBlock(plainBytes)
      );
      if (bytesToHex(ct) === bytesToHex(cipherBytes)) {
        out.push({ k1, k2 });
      }
    }
  }
  return out;
}

function des2MitmOp(text, p = {}) {
  const [plainHex, cipherHex] = String(text || "").trim().split(/\s+/);
  if (!plainHex || !cipherHex) throw new Error("输入格式：明文hex 空格 密文hex（各 8 字节）");
  const keyBits = Math.max(1, Math.min(20, Number(p.keyBits) || 16));
  const pt = hexToBytes(plainHex);
  const ct = hexToBytes(cipherHex);
  const t0 = Date.now();
  const results = des2Mitm(pt, ct, keyBits);
  const ms = Date.now() - t0;
  if (!results.length) return "未找到匹配密钥对（2^" + keyBits + " × 2 空间穷举完成，耗时 " + ms + "ms）";
  const kd = (idx) => bytesToHex(smallKeyToDesKey(idx, keyBits));
  return results.map((r, i) =>
    "命中 " + (i + 1) + "：k1=" + kd(r.k1) + " k2=" + kd(r.k2) + "（索引 " + r.k1 + " / " + r.k2 + "）"
  ).join("\n") + "\n\n耗时 " + ms + "ms（2^" + keyBits + " forward 表 + 2^" + keyBits + " 查表）";
}

register({
  id: "des2Mitm", cat: "analysis", name: "2DES 中间相遇",
  desc: "2DES 中间相遇攻击（MITM）：C=DES_k2(DES_k1(P))，forward 表 + 反向查表恢复双密钥（keyBits 控制每半密钥空间，默认 16 位）",
  params: [
    { key: "keyBits", label: "每半密钥位数", type: "number", default: 16, placeholder: "1-20" },
  ],
  run: des2MitmOp,
});

export { smallKeyToDesKey, des2MitmOp };
