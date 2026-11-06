/*
 * stegoDetect.js — 统一隐写检测 op（cat:'data'，run 型单向分析）。
 *
 * 定位：把原先散落的「只扫不嵌」纯检测 op 归一到一个入口，用 mode 参数细分。
 * 隐写按原理拆开后，编码/解码类隐写归入「文本隐写」（载体=文本字符特性）与
 * 「文件隐写」（载体=图像/音频/二进制/网络包字节结构）；而只做检测/分析、不改写
 * 载体的这一类统一收敛为本 op。
 *
 * 合并来源（旧 op id 与本 op 的 mode 一一对应，输出形态保持不变）：
 *   文本侧  zwScan / confusablesScan / unicodeNormalize / whitespaceScan /
 *           bidiScan / charInspect / invisibleViz / confusablesSkeleton
 *   文件侧  stegoQuickScan（PNG/JPEG/GIF 结构 · 元数据 · 尾随）
 *           stegdetect（JPEG DCT 系数统计 · 卡方攻击）
 *           zstegScan（LSB 位平面×通道×位序×行列全组合扫描）
 *
 * 实现说明：不做二次实现，直接 import 各原模块的导出函数按 mode 分派，
 * 保证与合并前逐字节同输出（各原实现文件保留为库，不再自我注册）。
 *
 * 参数说明：params 为各 mode 的并集。仅本 mode 用到的参数生效，其余忽略：
 *   - 文本类 mode 只读输入文本；文件类 mode 读拖入文件（rawBytes 通道）或粘贴的 hex/base64。
 *   - inputEnc 统一默认 auto（自动嗅探 hex/base64/UTF-8），较原先图片快速扫描的
 *     强制 base64 更宽松（纯文本通道的粘贴解析口径随之放宽，不改变拖文件通道行为）。
 *
 * 红线：算法层零 UI 依赖（仅 import registry + 各算法模块）；零外发；件内自注册；报告无 emoji。
 */
import { register } from "./registry.js";
import { zwScan, confusablesScan, unicodeNormalize, whitespaceScan, bidiScan, charInspect } from "./stegoText.js";
import { invisibleViz } from "./invisibles.js";
import { skeletonReport } from "./confusables.js";
import { stegoQuickScan } from "./stegoQuickScan.js";
import { stegdetectRun } from "./stegdetect.js";
import { zstegRun } from "./zstegScan.js";

// mode → 下拉显示名（文本 / 文件两类混排，靠后缀标注载体）
const MODE_OPTIONS = [
  { value: "zwScan", label: "零宽 / 不可见字符扫描（文本）" },
  { value: "confusablesScan", label: "同形异义字检测（文本）" },
  { value: "unicodeNormalize", label: "Unicode 规范化对比（文本）" },
  { value: "normaliseUnicode", label: "Normalise Unicode（输出规范化文本，同 CyberChef）" },
  { value: "whitespaceScan", label: "空白字符隐写检测（文本）" },
  { value: "bidiScan", label: "双向控制符检测 / Trojan Source（文本）" },
  { value: "charInspect", label: "字符属性透视（文本）" },
  { value: "invisibleViz", label: "不可见字符可视化 + 剥离（文本）" },
  { value: "confusablesSkeleton", label: "同形字骨架归一化（文本）" },
  { value: "stegoQuickScan", label: "图片隐写快速结构分析（PNG/JPEG/GIF）" },
  { value: "stegdetect", label: "JPEG DCT 隐写统计检测" },
  { value: "zstegScan", label: "LSB 全组合扫描（PNG/BMP）" },
];

// ============================================================
// run 主入口：按 mode 分派到原实现（逐字节同输出）
// ============================================================
function stegoDetectRun(text, p = {}) {
  const mode = p.mode || "zwScan";
  switch (mode) {
    case "zwScan": return zwScan(text, {});
    case "confusablesScan": return confusablesScan(text, {});
    case "unicodeNormalize": return unicodeNormalize(text, { form: p.form });
    case "normaliseUnicode": {
      const form = String(p.form || "NFC").toUpperCase();
      if (!["NFC", "NFD", "NFKC", "NFKD"].includes(form)) throw new Error("Unknown Normalisation Form");
      return String(text == null ? "" : text).normalize(form);
    }
    case "whitespaceScan": return whitespaceScan(text, {});
    case "bidiScan": return bidiScan(text, {});
    case "charInspect": return charInspect(text, {});
    case "invisibleViz": return invisibleViz(text, {});
    case "confusablesSkeleton": return skeletonReport(text);
    case "stegoQuickScan":
      return stegoQuickScan(text, { inputEnc: p.inputEnc, rawBytes: p.rawBytes });
    case "stegdetect":
      return stegdetectRun(text, { comp: p.comp, sens: p.sens, rawBytes: p.rawBytes });
    case "zstegScan":
      return zstegRun(text, {
        inputEnc: p.inputEnc, maxBit: p.maxBit, columnMajor: p.columnMajor,
        flagRegex: p.flagRegex, exportCombo: p.exportCombo,
        exportMaxBytes: p.exportMaxBytes, rawBytes: p.rawBytes,
      });
    default:
      return "未知检测模式：" + mode + "（可选：" + MODE_OPTIONS.map((o) => o.value).join(" / ") + "）";
  }
}

// ============================================================
// 注册
// ============================================================
register({
  id: "stegoDetect",
  cat: "data",
  name: "隐写检测（文本 / 文件）",
  desc: "统一隐写检测入口，mode 细分 11 种分析：文本侧零宽/不可见字符扫描、同形异义字、Unicode 规范化、空白隐写、双向控制符（Trojan Source）、字符属性透视、不可见字符可视化；文件侧 PNG/JPEG/GIF 结构快速分析、JPEG DCT 卡方检测、PNG/BMP LSB 全组合扫描。只分析不改写载体，纯前端零外发。",
  acceptsBytes: true,
  params: [
    { key: "mode", label: "检测模式", type: "select", default: "zwScan", options: MODE_OPTIONS },
    { key: "form", label: "规范化形式（unicodeNormalize）", type: "select", default: "NFC",
      options: [
        { value: "NFC", label: "NFC（规范分解 + 合成）" },
        { value: "NFD", label: "NFD（规范分解）" },
        { value: "NFKC", label: "NFKC（兼容分解 + 合成）" },
        { value: "NFKD", label: "NFKD（兼容分解）" },
      ],
    },
    { key: "comp", label: "分析分量（stegdetect）", type: "select", default: "y",
      options: [
        { value: "y", label: "仅 Y 亮度分量（快，jsteg/F5 主战场）" },
        { value: "all", label: "全部分量（Y+Cb+Cr，更全但更慢）" },
      ],
    },
    { key: "sens", label: "阈值灵敏度（stegdetect）", type: "select", default: "std",
      options: [
        { value: "loose", label: "宽松（p≥0.2 即判出，易误报）" },
        { value: "std", label: "标准（p≥0.5）" },
        { value: "strict", label: "严格（p≥0.8，更少误报）" },
      ],
    },
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "maxBit", label: "最大 bit 位（zstegScan，0..7）", type: "number", default: 0 },
    { key: "columnMajor", label: "含列优先遍历（zstegScan）", type: "bool", default: false },
    { key: "flagRegex", label: "flag 正则（zstegScan，空=不加成）", type: "text", default: "flag\\{" },
    { key: "exportCombo", label: "导出组合（zstegScan，如 bit0 rgb msb；空=扫描）", type: "text", default: "" },
    { key: "exportMaxBytes", label: "导出上限字节（zstegScan，最大1048576）", type: "number", default: 65536 },
  ],
  run: stegoDetectRun,
});

export { stegoDetectRun, MODE_OPTIONS };