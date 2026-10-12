/*
 * magic/domain.js — 声明式字符定义域
 *
 * 每个 op 声明四类字符：
 *   participant 参与运算的字符（该 op 真正会变换的字符）
 *   separator   结构性分隔符（可被剥离，不算参与者也不算透传）
 *   passthrough 原样保留、不参与变换的字符（如凯撒里的数字/标点）
 *   reject      出现即判定输入非法（类外字符）
 *
 * 判定语义（domainAdmit）：
 *   ① 命中 reject        → 拒绝
 *   ② 出现既非 participant / separator / passthrough 的字符 → 拒绝（类外）
 *   ③ 一个 participant 都没有（整串只有分隔/透传）→ 拒绝（不生成无意义候选）
 *   ④ 其余 → 准入
 *
 * **未声明的 op 返回 null**，由调用方回退旧逻辑（coarseAdmitPlain / sweepApplies 原判据）。
 * 因此本模块是**增量**的：只覆盖参数扫描与高噪声 Base/Radix，未声明者行为不变。
 *
 * 纯函数、零依赖、可结构化克隆；不 import 任何模块（便于 Worker 直接引用）。
 */

// ---------- 字符类（非全局正则，避免 lastIndex 状态污染） ----------
const CLS = {
  ws: /[\s]/,
  letters: /[A-Za-z]/,
  printableAscii: /[\x20-\x7e]/,
  base16: /[0-9a-fA-F]/,
  base32: /[A-Z2-7=]/,
  base36: /[0-9a-z]/i,
  base58: /[1-9A-HJ-NP-Za-km-z]/,
  base62: /[0-9A-Za-z]/,
  base64: /[A-Za-z0-9+/=_-]/,
  base85: /[\x21-\x7e]/,
  base45: /[0-9A-Z $%*+\-./:]/,
  b91: /[A-Za-z0-9!#$%&()*+,./:;<=>?@\[\]^_`{|}~"-]/,
  b92: /[A-Za-z0-9!#$%&()*+,./:;<=>?@\[\]^_`{|}~"-]/,
};

/**
 * 声明表。只登记「参数扫描 + 高噪声 Base/Radix」两类；其余 op 不登记（回退旧逻辑）。
 * 每条注释给出该 op 的字符集依据。
 */
export const DOMAIN = {
  // Text auto-decode accepts standard Morse tokens only; direct decoder compatibility is unchanged.
  morse: { participant: /[.\-]/, separator: /[\s/|x]/ },
  // ---- 参数扫描：字母类换位/替换密码 ----
  // 参与者=字母；数字与标点原样透传（凯撒/维吉尼亚等不碰非字母）。
  caesar: { participant: CLS.letters, separator: CLS.ws, passthrough: /[^A-Za-z\s]/ },
  trithemius: { participant: CLS.letters, separator: CLS.ws, passthrough: /[^A-Za-z\s]/ },
  keyboardShift: { participant: CLS.letters, separator: CLS.ws, passthrough: /[^A-Za-z\s]/ },
  affine: { participant: CLS.letters, separator: CLS.ws, passthrough: /[^A-Za-z\s]/ },
  // rotSpecial 三档字母表（letters/alnum/ascii94）—— 取可打印 ASCII 为参与者上界，
  // 非 ASCII 透传。不做字母限缩，否则 alnum/ascii94 两档会被误排。
  rotSpecial: { participant: CLS.printableAscii, separator: CLS.ws, passthrough: /[^\x20-\x7e\s]/ },

  // ---- 高噪声 Base 系：参与者=该 base 的完整字母表；空白为分隔符 ----
  base16: { participant: CLS.base16, separator: CLS.ws, passthrough: /[xX]/ },
  base32: { participant: CLS.base32, separator: CLS.ws },
  base36: { participant: CLS.base36, separator: CLS.ws },
  // base45 关键：**空格是数据字符（码表索引 36）**，故只把 CR/LF 当分隔符，空格算参与者。
  // 这条修掉「compact 抹空白 → isBase64ish=false → 严格档误排」的缺陷。
  base45: { participant: CLS.base45, separator: /[\r\n]/ },
  base58: { participant: CLS.base58, separator: CLS.ws },
  base62: { participant: CLS.base62, separator: CLS.ws },
  base64: { participant: CLS.base64, separator: CLS.ws },
  // base85：Adobe Ascii85 可被 <~ ~> 包裹，包裹符当透传。
  base85: { participant: CLS.base85, separator: CLS.ws, passthrough: /[<>~]/ },
  base91: { participant: CLS.b91, separator: CLS.ws },
  base92: { participant: CLS.b92, separator: CLS.ws },
};

/**
 * 按当前文本重算该 op 的定义域画像（每层调用，不缓存）。
 * 未声明的 op 返回 null。
 */
export function domainProfile(text, opId) {
  const d = DOMAIN[opId];
  if (!d) return null;
  const t = String(text == null ? "" : text);
  const p = {
    opId,
    participants: 0,
    separators: 0,
    passthrough: 0,
    rejected: 0,
    rejectedChars: [],
    participantKinds: 0,
    _kinds: new Set(),
  };
  for (const ch of t) {
    if (d.separator && d.separator.test(ch)) { p.separators++; continue; }
    if (d.participant.test(ch)) { p.participants++; p._kinds.add(ch); continue; }
    if (d.passthrough && d.passthrough.test(ch)) { p.passthrough++; continue; }
    if (d.reject && d.reject.test(ch)) { p.rejected++; if (p.rejectedChars.length < 8) p.rejectedChars.push(ch); continue; }
    // 既非四类中任何一类 → 按「类外字符」计入拒绝
    p.rejected++;
    if (p.rejectedChars.length < 8) p.rejectedChars.push(ch);
  }
  p.participantKinds = p._kinds.size;
  delete p._kinds;
  return p;
}

/**
 * 声明式准入。返回 true / false / **null（未声明 → 调用方回退旧逻辑）**。
 */
export function domainAdmit(opId, text) {
  const d = DOMAIN[opId];
  if (!d) return null;
  const p = domainProfile(text, opId);
  if (p.rejected > 0) return false;        // 类外字符
  if (p.participants === 0) return false;  // 只有分隔/透传 → 不生成无意义候选
  return true;
}

// ---------- 显式 auto-candidate policy ----------
// 报告型 op：返回的是「人类可读报告文本」而非解码结果，进自动候选会污染排名
// （实测 jsteg 报告串 confidence 恒 0.858、5 用例 3 次置顶，见自动候选误报矩阵）。
export const REPORT_TYPE_OPS = new Set([
  "jsteg", "stegdetect", "zstegScan", "stegosaurus", "stegoQuickScan",
  "pcapParse", "pcapTcpReassemble", "pcapHttpExtract", "pcapDnsTunnel", "pcapIcmpPayload",
  "stringsExtract", "elfInfo", "peInfo", "apkManifest", "pdfObjects", "ooxmlMeta",
  "formatSniff", "ssti", "pickle", "fstego", "stegpy", "bmpPalette", "deepSoundExtract",
]);

/**
 * 该 op 是否**禁止进入文本自动候选**。
 * 依据：桥/exe（requiresBridge）、作者标注不自动跑（noAuto）、文件/字节通道（acceptsBytes）、
 * 报告型（REPORT_TYPE_OPS）。
 */
export function isAutoCandidateExcluded(op) {
  if (!op || typeof op.id !== "string" || !op.id) return true;
  if (op.requiresBridge) return true;
  if (op.noAuto) return true;
  if (REPORT_TYPE_OPS.has(op.id)) return true;
  if (op.acceptsBytes && !op.textTransit) return true; // textTransit=文本中转 op（契约），仍参与一键解码
  return false;
}

/** 供 UI/日志展示的排除原因（可选）。 */
export function autoExcludeReason(op) {
  if (!op) return "noOp";
  if (op.requiresBridge) return "requiresBridge";
  if (op.noAuto) return "noAuto";
  if (REPORT_TYPE_OPS.has(op.id)) return "reportType";   // 报告型更具体，先于 acceptsBytes 判
  if (op.acceptsBytes) return "acceptsBytes";
  return null;
}
