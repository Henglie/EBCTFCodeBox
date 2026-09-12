/*
 * qrFormatBrute.js — QR 格式信息爆破（T518，cat:'stego'，family:'qr'）。
 *
 * 用途：格式信息区（15 位 BCH 码，两份副本）被涂改/遮挡/损坏的 QR——
 * qrDecode 依赖 readFormatInfo 识别 ECL/掩码，格式区坏则整码报废；
 * 本 op 枚举全部 32 组合法 (ECL, mask) 组合，逐组走「取数→去掩码→
 * 去交织→RS 纠错→分段解码」，列出全部可解组合与解出原文。
 *
 * 能力面同 QRazyBox（merricx/qrazybox，MIT）的 format info 暴力枚举；
 * 规范依据 ISO/IEC 18004：格式信息 = 2 位纠错指示 + 3 位掩码指示，
 * 经 BCH(15,5)（生成多项式 0x537）加 0x5412 掩码得 15 位。
 *
 * 零新算法：全部复用 qrdecode.js 已验证部件（RS 解码 GF(256) fcr=0、
 * 功能图案图、之字形取数、去交织、分段解码）与 qrcode.js 的
 * FORMAT_INFO_CODES（32 组标准格式串，BCH 解释直接查表）。
 *
 * 成功判据（每组）：全块 RS 解码无异常 + 首段为可识别模式 + 文本非空。
 * 结果按 RS 纠错数升序全列（错组合偶发凑出合法分段时人工可辨），
 * 「RS 0 错 + 恰好命中格式区 BCH 距离最小」为最可信解。
 *
 * 接线（M 串行）：src/main.js 加
 *   import "./core/qrFormatBrute.js"; // QR 格式信息爆破
 * src/core/registerAll.js 加
 *   import "./qrFormatBrute.js"; // QR 格式信息爆破
 */
import { register } from "./registry.js";
import {
  parseInputToMatrix, qrDecodeMatrix,
  buildFunctionMap, readCodewords, deinterleave, rsDecodeBlock, decodeDataSegments,
} from "./qrdecode.js";
import { countFinders, getNumRawDataModules, ECL_NAME, FORMAT_INFO_CODES } from "./qrcode.js";

// ECL 索引（0=L,1=M,2=Q,3=H）→ 格式信息 2 位指示符（L=01, M=00, Q=11, H=10）
const ECL_FORMAT_BITS = [1, 0, 3, 2];

// 校验 QR 尺寸 → 版本号（ISO：size = 21 + 4k）
function bruteValidateSize(w, h) {
  if (w !== h) throw new Error("矩阵非正方形（" + w + "×" + h + "），QR 须正方形");
  if (w < 21 || w > 177 || (w - 17) % 4 !== 0) {
    throw new Error("尺寸 " + w + " 不符 QR（须 21+4k，k=0..40）");
  }
  return (w - 17) / 4;
}

// 把格式信息 15 位串翻译成 (ECL, mask)（供解释输入格式区原值）
function explainFormatBits(bits15) {
  const unmasked = bits15 ^ 0x5412;
  const data5 = unmasked >> 10;
  for (let ecl = 0; ecl < 4; ecl++) {
    for (let mask = 0; mask < 8; mask++) {
      if (((ECL_FORMAT_BITS[ecl] << 3) | mask) === data5) return { ecl, mask };
    }
  }
  return null;
}

// 单组 (ecl, mask) 试解：成功返回结果对象，失败抛错
function tryDecodeWith(matrix, size, version, ecl, mask) {
  const isFn = buildFunctionMap(size, version);
  const allCW = readCodewords(matrix, size, isFn, mask);
  const { blocks, blockEccLen } = deinterleave(allCW, version, ecl);
  let totalErrors = 0;
  for (const blk of blocks) {
    const r = rsDecodeBlock(blk.full, blockEccLen);
    blk.corrected = r.corrected; /* 镜像 qrDecodeMatrix：纠错后码字存回块 */
    totalErrors += r.errorCount;
  }
  const dataBytes = [];
  for (const blk of blocks) {
    for (let i = 0; i < blk.data.length; i++) dataBytes.push(blk.corrected[i]);
  }
  const segs = decodeDataSegments(dataBytes, version);
  if (segs.length === 0) throw new Error("无有效数据段");
  if (String(segs[0].mode).startsWith("unsupported")) throw new Error("首段模式不可识别");
  const text = segs.map((s) => s.text).join("");
  if (text.length === 0) throw new Error("解出空文本");
  const data5 = (ECL_FORMAT_BITS[ecl] << 3) | mask;
  return {
    ecl,
    eclName: ECL_NAME[ecl],
    mask,
    formatBits: FORMAT_INFO_CODES[data5],
    formatBitsBin: FORMAT_INFO_CODES[data5].toString(2).padStart(15, "0"),
    errorCount: totalErrors,
    numBlocks: blocks.length,
    segments: segs,
    text,
  };
}

// 主爆破：返回 { version, size, finders, results, rawFormat }
function bruteFormatInfo(matrix, w, h) {
  const version = bruteValidateSize(w, h);
  const size = w;
  const finders = countFinders(matrix, size, size);
  // 读原始格式区（BCH 硬判距 0..3），仅供报告解释原格式区状态
  let rawFormat = null;
  try {
    const r0 = qrDecodeMatrix(matrix, w, h);
    rawFormat = { ecl: r0.ecl, mask: r0.mask, note: "格式区实际完好（dist=" + r0.formatDist + "），无需爆破" };
  } catch {
    rawFormat = { note: "常规解码失败（格式区疑似损坏），进入枚举" };
  }
  const results = [];
  for (let ecl = 0; ecl < 4; ecl++) {
    for (let mask = 0; mask < 8; mask++) {
      try {
        results.push(tryDecodeWith(matrix, size, version, ecl, mask));
      } catch {
        // 该组合 RS/分段不成立，跳过
      }
    }
  }
  results.sort((a, b) => a.errorCount - b.errorCount);
  return { version, size, finders, results, rawFormat };
}

// ============================================================
// op: QR 格式信息爆破（run → 报告）
// ============================================================
function qrFormatBruteOp(text) {
  const { matrix, width, height } = parseInputToMatrix(text);
  const r = bruteFormatInfo(matrix, width, height);
  const lines = [];
  lines.push("QR 格式信息爆破");
  lines.push("矩阵尺寸: " + r.size + " × " + r.size + "（版本 v" + r.version + "）");
  lines.push("finder 图案: " + r.finders + " 个");
  lines.push("格式区状态: " + r.rawFormat.note);
  if (r.results.length === 0) {
    lines.push("结果: 32 组 (ECL×掩码) 组合全部无法解码——数据区损坏超 RS 纠错能力，或矩阵非本工具支持的 QR");
    return lines.join("\n");
  }
  lines.push("可解组合: " + r.results.length + " 组（按 RS 纠错数升序）");
  for (let i = 0; i < r.results.length; i++) {
    const g = r.results[i];
    lines.push("—— 组合 " + (i + 1) + ": ECL=" + g.eclName + " 掩码=" + g.mask +
      "（格式串 " + g.formatBitsBin + "）RS 纠错 " + g.errorCount + " 错" +
      (g.errorCount === 0 && i === 0 ? " ★最可信" : ""));
    lines.push("   数据段: " + g.segments.map((s) => s.mode + "[" + (s.count || 0) + "]").join(" › "));
    lines.push("   原文: " + (g.text.length > 200 ? g.text.slice(0, 200) + "…(" + g.text.length + " 字符)" : g.text));
  }
  const best = r.results[0];
  lines.push("推荐解: ECL=" + best.eclName + " 掩码=" + best.mask + "（RS " + best.errorCount + " 错）");
  return lines.join("\n");
}

register({
  id: "qrFormatBrute",
  family: "qr",
  familyLabel: "formatBrute",
  cat: "stego",
  name: "QR 格式信息爆破",
  desc: "格式信息区损坏的 QR 抢救：枚举全部 32 组 (纠错级×掩码) 组合逐组取数去交织 RS 纠错解码，列出全部可解组合与原文（ISO/IEC 18004；能力对齐 QRazyBox）",
  noAuto: true, // 爆破 32 组全码字 RS 解码，偏重；仅在用户主动选择时运行
  params: [],
  run: (t) => qrFormatBruteOp(t),
});

export { qrFormatBruteOp, bruteFormatInfo, tryDecodeWith, explainFormatBits };
