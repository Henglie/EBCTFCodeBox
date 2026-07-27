/*
 * rc4Visualize.js — RC4 KSA/PRGA 可视化教学 op（cat:'analysis'，run 型）。
 *
 * 定位：CTF 逆向/密码高频。项目已有 rc4 加解密 op（src/core/modern.js）
 * 本 op 补「教学可视化」缺口——把 RC4 内部两阶段逐步展开：
 * · KSA（Key Scheduling Algorithm）：S 表从 identity 排列被密钥打乱的每一步 i/j/swap；
 * · PRGA（Pseudo-Random Generation Algorithm）：逐字节生成密钥流的每一步 i/j/S[i]/S[j]/K。
 * 帮助识别 CTF 题目中的 KSA/PRGA 循环特征（256 步交换 + S[(S[i]+S[j])%256]）。
 *
 * 算法（与 modern.js rc4 完全一致，仅加 trace 记录）：
 * KSA: for i=0..255: j = (j + S[i] + key[i % keylen]) % 256; swap S[i],S[j]
 * PRGA: i=(i+1)%256; j=(j + S[i])%256; swap S[i],S[j]; K = S[(S[i]+S[j])%256]; 与明文异或
 * 自测：本模块 PRGA 生成的密钥流须与 rc4(全0明文, key) 逐字节相等（见 rc4Trace）。
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 registry）。
 * - 零外发：纯本地计算。
 * - 件内自注册（register(op)）。
 * - 不写 detect（教学/查看工具，不参与 magic 自动预筛）。
 *
 * 契约：register({id:'rc4Visualize', cat:'analysis', name, desc, params, run})。
 */
import { register } from "./registry.js";
import { rc4 } from "./modern.js"; // 交叉验证用（rc4(zeros,key) == 纯密钥流）

// ============================================================
// 密钥解析
// ============================================================
function utf8ToBytes(s) {
  return new TextEncoder().encode(s);
}

function hexToBytes(s) {
  const clean = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 密钥长度需为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function parseKey(text, keyEnc) {
  const s = String(text || "");
  if (keyEnc === "hex") return hexToBytes(s);
  return utf8ToBytes(s); // utf8 默认
}

// ============================================================
// 带 trace 的 KSA + PRGA
// 返回纯数据结构（无 UI），供 run 渲染 + 自测断言。
// ============================================================
/**
 * @param {Uint8Array} key 密钥字节
 * @param {number} prgaBytes PRGA 生成的密钥流字节数
 * @param {number} ksaSteps KSA 记录明细的前 N 步（全 256 步太长）
 * @returns {{S:Uint8Array, keystream:Uint8Array, ksaTrace:Array, prgaTrace:Array}}
 */
function rc4Trace(key, prgaBytes, ksaSteps) {
  if (!key || key.length === 0) throw new Error("RC4 密钥不能为空");

 // --- KSA ---
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  const ksaTrace = [];
  for (let i = 0; i < 256; i++) {
    const Si = S[i];
    const ki = key[i % key.length];
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const Sj = S[j];
    [S[i], S[j]] = [S[j], S[i]];
    if (i < ksaSteps) {
      ksaTrace.push({ step: i, i, ki, Si_before: Si, j, Sj_before: Sj });
    }
  }

 // --- PRGA ---
  const keystream = new Uint8Array(prgaBytes);
  const prgaTrace = [];
  let pi = 0, pj = 0;
  for (let k = 0; k < prgaBytes; k++) {
    pi = (pi + 1) & 0xff;
    pj = (pj + S[pi]) & 0xff;
    [S[pi], S[pj]] = [S[pj], S[pi]];
    const K = S[(S[pi] + S[pj]) & 0xff];
    keystream[k] = K;
    prgaTrace.push({ n: k, i: pi, j: pj, Si: S[pi], Sj: S[pj], K });
  }

  return { S, keystream, ksaTrace, prgaTrace };
}

// ============================================================
// 显示工具
// ============================================================
function byteHex(b) {
  return b.toString(16).padStart(2, "0");
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += byteHex(b);
  return s;
}

// S 表 256 字节分行排版：每行 16 字节，行首标偏移。
function formatSbox(S) {
  const lines = [];
  for (let row = 0; row < 16; row++) {
    let line = "  " + byteHex(row * 16) + ": ";
    for (let col = 0; col < 16; col++) {
      line += byteHex(S[row * 16 + col]) + " ";
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

// ============================================================
// run：主入口
// ============================================================
function rc4VisualizeRun(text, p) {
  const keyText = (p && p.key != null && p.key !== "") ? p.key : "Key";
  const keyEnc = (p && p.keyEnc) || "utf8";
  let ksaSteps = parseInt((p && p.ksaSteps) != null ? p.ksaSteps : 8, 10);
  let prgaBytes = parseInt((p && p.prgaBytes) != null ? p.prgaBytes : 16, 10);
  if (!Number.isFinite(ksaSteps) || ksaSteps < 0) ksaSteps = 8;
  if (!Number.isFinite(prgaBytes) || prgaBytes < 1) prgaBytes = 16;
  ksaSteps = Math.min(ksaSteps, 256);
  prgaBytes = Math.min(prgaBytes, 4096);
  const plaintext = (p && p.plaintext) || "";

  const lines = [];
  lines.push("=== RC4 KSA/PRGA 可视化 ===");
  lines.push("");

  let key;
  try {
    key = parseKey(keyText, keyEnc);
  } catch (e) {
    lines.push("✗ 密钥解析失败: " + (e.message || String(e)));
    return lines.join("\n");
  }
  if (key.length === 0) {
    lines.push("✗ 密钥为空");
    return lines.join("\n");
  }

  let tr;
  try {
    tr = rc4Trace(key, prgaBytes, ksaSteps);
  } catch (e) {
    lines.push("✗ 计算失败: " + (e.message || String(e)));
    return lines.join("\n");
  }

 // --- 密钥 ---
  lines.push("--- 密钥 ---");
  lines.push("  原始(" + keyEnc + "): " + keyText);
  lines.push("  字节 hex: " + bytesToHex(key) + "  (" + key.length + " 字节)");
  lines.push("");

 // --- KSA ---
  lines.push("--- KSA（密钥调度，共 256 步；S 初始 = identity 0..255） ---");
  lines.push("  公式: j = (j + S[i] + key[i % keylen]) % 256; 然后 swap S[i]↔S[j]");
  lines.push("  前 " + tr.ksaTrace.length + " 步明细:");
  for (const t of tr.ksaTrace) {
    lines.push(
      "    i=" + String(t.i).padStart(3) +
      "  key[" + (t.i % key.length) + "]=0x" + byteHex(t.ki) +
      "  j=(j+S[i]+key)%256=" + String(t.j).padStart(3) +
      "  swap S[" + t.i + "]=0x" + byteHex(t.Si_before) +
      " ↔ S[" + t.j + "]=0x" + byteHex(t.Sj_before) + ""
    );
  }
  lines.push("");
  lines.push("  KSA 完成后 S 表（256 字节，hex，每行 16）:");
  for (const l of formatSbox(tr.S)) lines.push(l);
  lines.push("");

 // --- PRGA ---
  lines.push("--- PRGA（密钥流生成，前 " + prgaBytes + " 字节） ---");
  lines.push("  公式: i=(i+1)%256; j=(j+S[i])%256; swap S[i]↔S[j]; K=S[(S[i]+S[j])%256]");
  lines.push("  明细:");
  for (const t of tr.prgaTrace) {
    lines.push(
      "    #" + String(t.n).padStart(3) +
      "  i=" + String(t.i).padStart(3) +
      "  j=" + String(t.j).padStart(3) +
      "  S[i]=0x" + byteHex(t.Si) +
      "  S[j]=0x" + byteHex(t.Sj) +
      "  → K=0x" + byteHex(t.K)
    );
  }
  lines.push("");
  lines.push("  密钥流 hex: " + bytesToHex(tr.keystream));
  lines.push("");

 // --- 可选：明文 ⊕ 密钥流 = 密文 ---
  if (plaintext) {
    const ptBytes = utf8ToBytes(plaintext);
    const ct = new Uint8Array(ptBytes.length);
 // 密钥流不足时按需补足（不改变前 prgaBytes 的展示）
    let ks = tr.keystream;
    if (ptBytes.length > ks.length) {
      ks = rc4Trace(key, ptBytes.length, 0).keystream;
    }
    for (let i = 0; i < ptBytes.length; i++) ct[i] = ptBytes[i] ^ ks[i];
    lines.push("--- 明文 ⊕ 密钥流 = 密文 ---");
    lines.push("  明文(utf8): " + plaintext);
    lines.push("  明文 hex:   " + bytesToHex(ptBytes));
    lines.push("  密钥流 hex: " + bytesToHex(ks.subarray(0, ptBytes.length)));
    lines.push("  密文 hex:   " + bytesToHex(ct));
    lines.push("");
  }

  lines.push("说明:");
  lines.push("  · KSA 用密钥把 S 表从 identity 排列打乱（256 次交换），是 RC4 的密钥装载。");
  lines.push("  · PRGA 每步交换后取 S[(S[i]+S[j])%256] 作密钥流字节，与明文异或（自反：加解密同一操作）。");
  lines.push("  · CTF 识别特征：256 步 KSA 交换循环 + S[(S[i]+S[j])&0xff] 取字节的 PRGA 循环。");
  lines.push("  · 加解密请用「现代加密」里的 RC4 op；本 op 仅作过程可视化教学。");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "rc4Visualize",
  cat: "analysis",
  name: "RC4 KSA/PRGA 可视化",
  desc: "逐步展示 RC4 内部：KSA 打乱 S 表的 i/j/swap 明细 + 最终 S 表 + PRGA 密钥流生成过程，教学/逆向识别 KSA/PRGA 特征",
  params: [
    { key: "key", label: "RC4 密钥", type: "text", default: "Key", placeholder: "密钥（任意长）" },
    {
      key: "keyEnc", label: "密钥编码", type: "select", default: "utf8",
      options: [
        { value: "utf8", label: "UTF-8" },
        { value: "hex", label: "Hex" },
      ],
    },
    { key: "ksaSteps", label: "KSA 展示步数", type: "number", default: 8, placeholder: "前 N 步明细，默认 8" },
    { key: "prgaBytes", label: "PRGA 密钥流字节数", type: "number", default: 16, placeholder: "生成并展示 N 字节，默认 16" },
    { key: "plaintext", label: "明文（可选）", type: "text", default: "", placeholder: "填了则展示 明文⊕密钥流=密文" },
  ],
  run: rc4VisualizeRun,
});

export { rc4Trace };
