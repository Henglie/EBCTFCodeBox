/*
 * xorCribDrag.js — XOR crib-drag 已知明文拖动异或（T299，cat:'analysis'，单向 run）。
 *
 * 原理：XOR 流密码/重复密钥加密 C = P XOR K。若已知明文片段（crib）在明文 P
 * 的位置 i 处出现，则 C[i:i+L] XOR crib = K[i:i+L]（密钥片段）。
 * 逐位置拖动 crib 对密文异或，输出每个偏移的候选密钥/候选明文片段 + 可打印率
 * 帮助判断哪个偏移是正确对齐——当密钥为可打印文本时，正确位置的可打印率高。
 *
 * 输入：密文（hex 或 base64）、crib（UTF-8 已知明文片段）。
 * 输出：每个偏移 i (0..len(C)-len(crib)) 的 XOR 结果（hex + ASCII 尝试 + 可打印率）。
 *
 * 红线：算法层零 UI 依赖，件内自注册，单向 run 输出报告。
 * crib-drag 照 CTF 经典方法实现，不编造。
 *
 * 参考：crib dragging 是密码分析经典技术，见 cryptopals Set 1 / CTF wiki。
 */
import { register } from "./registry.js";

// ============================================================
// 工具：hex / base64 → bytes
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) {
    throw new Error("hex 长度必须为偶数（实为 " + clean.length + "）");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function base64ToBytes(s) {
  const clean = s.replace(/\s/g, "");
 // atob 在浏览器及 Node 16+ 全局可用
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

// ============================================================
// parseInput：解析密文输入为字节数组
// ============================================================
/**
 * @param {string} text 密文文本
 * @param {string} inputEnc "auto" | "hex" | "base64"
 * @returns {Uint8Array}
 */
export function parseInput(text, inputEnc = "auto") {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  if (inputEnc === "hex") return hexToBytes(s);
  if (inputEnc === "base64") return base64ToBytes(s);
 // auto：全 hex 字符且偶数长度 → hex，否则 base64
  const stripped = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
    return hexToBytes(s);
  }
  return base64ToBytes(s);
}

// ============================================================
// cribDrag：核心算法
// ============================================================
/**
 * 对每个偏移 i (0..len(C)-len(crib))，计算 C[i:i+L] XOR crib。
 * @param {Uint8Array} cipherBytes 密文字节
 * @param {Uint8Array} cribBytes 已知明文片段字节
 * @returns {Array<{offset:number, xorBytes:Uint8Array, printable:string, printableRatio:number}>}
 * 打印率 = 可打印字节数(0x20-0x7E) / crib 长度；非可打印字节在 printable 中以 '.' 占位。
 */
export function cribDrag(cipherBytes, cribBytes) {
  const results = [];
  const cLen = cipherBytes.length;
  const pLen = cribBytes.length;
  if (pLen === 0 || cLen === 0 || pLen > cLen) return results;
  for (let i = 0; i <= cLen - pLen; i++) {
    const xorBytes = new Uint8Array(pLen);
    let printableCount = 0;
    let printable = "";
    for (let j = 0; j < pLen; j++) {
      const b = cipherBytes[i + j] ^ cribBytes[j];
      xorBytes[j] = b;
      if (b >= 0x20 && b <= 0x7e) {
        printableCount++;
        printable += String.fromCharCode(b);
      } else {
        printable += ".";
      }
    }
    results.push({
      offset: i,
      xorBytes,
      printable,
      printableRatio: printableCount / pLen,
    });
  }
  return results;
}

// ============================================================
// run：解析输入 → cribDrag → 格式化报告
// ============================================================
function xorCribDragRun(text, p) {
  const crib = String((p && p.crib) || "");
  const inputEnc = String((p && p.inputEnc) || "auto");

  const lines = [];
  lines.push("=== XOR crib-drag 已知明文拖动异或 ===");

  let cipherBytes;
  try {
    cipherBytes = parseInput(text, inputEnc);
  } catch (err) {
    lines.push("✗ 密文解析失败：" + err.message);
    return lines.join("\n");
  }

  const cribBytes = new TextEncoder().encode(crib);

  lines.push(`密文长度: ${cipherBytes.length} 字节`);
  lines.push(`crib: "${crib}" (${cribBytes.length} 字节)`);
  lines.push("");

  if (cipherBytes.length === 0) {
    lines.push("✗ 密文为空");
    return lines.join("\n");
  }
  if (cribBytes.length === 0) {
    lines.push("✗ crib 为空，请输入已知明文片段");
    return lines.join("\n");
  }
  if (cribBytes.length > cipherBytes.length) {
    lines.push(
      `✗ crib 长度 (${cribBytes.length}) 大于密文长度 (${cipherBytes.length})，无法拖动`
    );
    return lines.join("\n");
  }

  const results = cribDrag(cipherBytes, cribBytes);
  lines.push(`拖动位置: 0 .. ${results.length - 1}（共 ${results.length} 个）`);
  lines.push("");

  lines.push("偏移\t可打印率\thex\t\t\tASCII");
  lines.push("-".repeat(64));
  for (const r of results) {
    const hex = bytesToHex(r.xorBytes);
    const pct = (r.printableRatio * 100).toFixed(0);
    const marker =
      r.printableRatio === 1 ? " ★" : r.printableRatio >= 0.8 ? " ○" : "";
    lines.push(`${r.offset}\t${pct}%\t\t${hex}\t\t${r.printable}${marker}`);
  }
  lines.push("");
  lines.push("说明: ★ = 全可打印（疑似正确对齐），○ = 高可打印率（≥80%）");
  lines.push(
    "原理: C[i:i+L] XOR crib = K[i:i+L]（密钥片段）；密钥为可打印文本时该位置可打印率高"
  );
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "xorCribDrag",
  cat: "analysis",
  name: "XOR crib-drag 已知明文拖动",
  desc: "已知明文片段拖动异或：逐位置 C XOR crib 输出候选密钥/明文 + 可打印率",
  params: [
    { key: "crib", label: "已知明文片段 (crib)", type: "text", default: "" },
    {
      key: "inputEnc",
      label: "密文编码",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: "自动" },
        { value: "hex", label: "hex" },
        { value: "base64", label: "base64" },
      ],
    },
  ],
  run: xorCribDragRun,
});

export { xorCribDragRun };
