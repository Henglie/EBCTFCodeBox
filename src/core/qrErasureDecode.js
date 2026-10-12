/*
 * qrErasureDecode.js — 二维码的「带擦除」解码层：置信度 → 擦除位置 → 多组合穷举
 *
 * 纯函数、零依赖。**复用现用 qrdecode.js 的全部构件**（功能图案图、之字形读取、
 * 去交织、数据段解析、ECC 参数表），只在其上多两层能力：
 *   ① 把「模块级置信度」翻译成「码字级擦除位置」，交给 rsErasure 解码；
 *   ② ECL 与掩码未知时穷举 ecl(0..3) × mask(0..7) = 32 组，
 *      用「RS 全块成功 → 数据段可解析」把关，多组都过且文本一致才接受，
 *      文本不一致时报「歧义」而不挑一个。
 *
 * 为什么需要多组合穷举：格式信息在污损/低分辨率图上常常读不出来，
 * 而掩码错会让码字整体错乱、ECL 错会让块划分错，两种错误都会让 RS 必然失败 ——
 * 所以穷举 + RS 校验是自洽的，只有正确组合能走到最后。
 *
 * 擦除阈值必须**保守**：簇状损伤仿真显示窗=1（标得准）可把
 * 10–21% 拉到 90–100%，窗=3 就掉到 31–90%、窗=5 基本失效 —— **精度远比覆盖率重要**。
 */


import {
  buildFunctionMap, readCodewords, deinterleave, decodeDataSegments,
  ECC_CODEWORDS_PER_BLOCK, NUM_ERROR_CORRECTION_BLOCKS,
} from "./qrdecode.js";
import { qrGenerate, pickMode, encodedBitLength, getNumDataCodewords } from "./qrcode.js";
import { rsDecodeWithErasures } from "./rsErasure.js";

/** 掩码条件（**与现用 qrdecode.js 逐字一致**，用于还原） */
function maskCond(m, x, y) {
  switch (m) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return false;
  }
}

/**
 * 之字形读取数据模块 + 去掩码，**同时带回每个码字的模块位置与置信度**。
 * 扫描顺序与现用 readCodewords 完全一致（已由测试逐值对拍）。
 *
 * @param {number[][]} matrix 0/1 模块矩阵（1=暗）
 * @param {number[][]|null} conf 模块级置信度（0..1，1=完全确定）；null 时视为全 1
 * @returns {Array<{value:number, conf:number, x:number, y:number}>} 每项一个码字
 */
export function readCodewordsWithConfidence(matrix, conf, size, isFn, mask) {
  const bits = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;                       // 跳过垂直 timing
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (isFn[y][x]) continue;
        let bit = matrix[y][x] ? 1 : 0;
        if (maskCond(mask, x, y)) bit ^= 1;            // 去掩码
        const c = conf && conf[y] ? (conf[y][x] == null ? 1 : conf[y][x]) : 1;
        bits.push({ bit, x, y, c });
      }
    }
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0, minC = 1;
    const mods = [];
    for (let k = 0; k < 8; k++) {
      b = (b << 1) | bits[i + k].bit;
      if (bits[i + k].c < minC) minC = bits[i + k].c;
      mods.push([bits[i + k].x, bits[i + k].y]);
    }
    out.push({ value: b, conf: minC, x: bits[i].x, y: bits[i].y, mods });
  }
  return out;
}

/**
 * 复现现用 deinterleave 的索引推进，给出「全码字索引 → (块号, 块内下标)」映射。
 * rawCodewords 直接取 allCWLen（readCodewords 的产出数即数据模块数 / 8）。
 * 由测试与现用 deinterleave 的输出逐值对拍。
 */
export function deinterleaveMap(allCWLen, version, ecl) {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ecl][version];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const rawCodewords = allCWLen;
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const blockLen = Math.floor(rawCodewords / numBlocks);
  const map = new Array(rawCodewords).fill(null);
  // ⚠ 块内下标必须用**每块自己的 push 计数**，不能用外层循环变量 i：
  //  现用 deinterleave 在 `i === blockLen - blockEccLen` 处对短块有一次跳过，
  //  跳过后压入短块的下标整体比 i 小 1。早期版本直接写 `k: i`，导致**短块校验区**
  //  的擦除位置全部偏移 1 位 → 擦除解码必然失败（实测 v2-M 每块 20 擦除只救回 3%）。
  const kPerBlock = new Array(numBlocks).fill(0);
  let idx = 0;
  for (let i = 0; i < blockLen + 1; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === blockLen - blockEccLen && j < numShortBlocks) continue;
      if (idx < rawCodewords) map[idx] = { j, k: kPerBlock[j] };
      kPerBlock[j]++;
      idx++;
    }
  }
  return { map, numBlocks, blockEccLen };
}

/** 自检：用现用 deinterleave 的输出反证 map 的正确性（blocks[j].full[k] === allCW[i]） */
export function verifyDeinterleaveMap(allCW, version, ecl) {
  const { blocks } = deinterleave(allCW, version, ecl);
  const { map } = deinterleaveMap(allCW.length, version, ecl);
  for (let i = 0; i < map.length; i++) {
    const m = map[i];
    if (!m) return { ok: false, reason: "map[" + i + "] 为空" };
    if (blocks[m.j].full[m.k] !== allCW[i]) {
      return { ok: false, reason: `map[${i}]={j:${m.j},k:${m.k}} 与现用去交织不符` };
    }
  }
  return { ok: true };
}

/** 现用 readCodewords 的产出，用作一致性对拍（本模块不依赖它做解码） */
export const _nowReadCodewords = readCodewords;

/**
 * 单组合（给定 ecl/mask）的擦除式解码。
 * @returns {{ok:boolean, text?:string, ...} | {ok:false, reason:string}}
 */
export function decodeWithErasures(matrix, conf, size, version, ecl, mask, opt = {}) {
  const thr = opt.confThreshold == null ? 0.25 : opt.confThreshold;
  // 擦除上限：理论边界是 nsym（e + 2v ≤ nsym，v=0 时 e 可达 nsym）。
  // ⚠ 早期版本这里写成 nsym/2，等于把擦除能力又砍回传统上限，实测导致
  //  「每块 20 擦除 / 校验 26」这种本可纠正的场景被直接弃用（全 0%）。
  // ⚠ 但 e 恰好等于 nsym 时另有一个**正确性**漏洞：rsErasure 的「未知错误」搜索输入
  //  长度为零（Forney 校正子取 x^e..x^{nsym-1}，e = nsym 时为空），于是无论实际还有
  //  多少**未标注**的损坏模块，解都只能是「只动这 nsym 个位置」的唯一解 —— 结果必然是
  //  一个合法码字（后验校正子全零、重编码判据也会通过），却可能不是原文（把未标注的
  //  损坏整体"搬"到已标注位置上）。实测踩到过：某遮挡样本在 e = nsym 时输出「合法但
  //  错误」的串。故默认留 1 个残余校正子做一致性检查：e ≤ nsym − 1。
  //  确有精确位置来源（如已知的确定性掩码）时可显式 opt.allowFullErasure = true 放开。
  const eccPerBlock = ECC_CODEWORDS_PER_BLOCK[ecl][version];
  const maxErasPerBlock = opt.maxErasPerBlock == null
    ? (opt.allowFullErasure ? eccPerBlock : Math.max(0, eccPerBlock - 1))
    : opt.maxErasPerBlock;

  const isFn = buildFunctionMap(size, version);
  const cw = readCodewordsWithConfidence(matrix, conf, size, isFn, mask);
  const allCW = cw.map((c) => c.value);

  // 与现用 readCodewords 对拍（同输入必须同输出；不一致直接判定本组合不可信）
  const ref = readCodewords(matrix, size, isFn, mask);
  if (ref.length !== allCW.length || ref.some((v, i) => v !== allCW[i])) {
    return { ok: false, reason: "码字读取与现用实现不一致（拒绝该组合）" };
  }

  let blocks, blockEccLen;
  try { ({ blocks, blockEccLen } = deinterleave(allCW, version, ecl)); }
  catch (e) { return { ok: false, reason: "去交织失败：" + e.message }; }

  const { map } = deinterleaveMap(allCW.length, version, ecl);

  // 擦除候选：码字置信度低于阈值
  const lowIdx = [];
  for (let i = 0; i < cw.length; i++) if (cw[i].conf < thr) lowIdx.push(i);

  const dataBytes = [];
  const blockCorrected = [];
  let totalErr = 0, totalEras = 0, blocksWithErasure = 0, erasureFallback = false;
  for (let j = 0; j < blocks.length; j++) {
    const full = blocks[j].full;
    let er = [];
    for (const i of lowIdx) if (map[i] && map[i].j === j) er.push(map[i].k);
    er = [...new Set(er)].sort((a, b) => a - b);
    if (er.length > maxErasPerBlock) {
      // 擦除集超容量 ⇒ **退回无擦除的普通 RS 解码**，而不是弃用该组合。
      // 为什么：擦除只是把「不可靠位置」告诉 RS 的**增益**手段，不是必要条件。
      // 置信度启发式在**抗锯齿/重采样**图上会把大量**取值其实正确**的模块标成不可靠
      // （实测某样本 22% 模块被判不可信 ⇒ 单块擦除数远超 ecc 上限），此时若直接弃用，
      // 等于把一张**硬判即可解**的图判死。退回普通解码仍受 RS 纠错与重编码判据双重
      // 把关：真损坏的块普通解码同样失败，故不会引入假成功。
      er = [];
      erasureFallback = true;
    }
    const r = rsDecodeWithErasures(full, blockEccLen, er);
    if (!r.ok) return { ok: false, reason: "块 " + j + " 擦除解码失败：" + r.reason };
    if (er.length) blocksWithErasure++;
    totalErr += r.errorCount;
    totalEras += er.length;
    blockCorrected.push(r.corrected);
    for (let i = 0; i < blocks[j].data.length; i++) dataBytes.push(r.corrected[i]);
  }

  // 重组纠正后的**全码字序列**（供重编码一致性判据使用）
  const correctedAll = new Array(allCW.length).fill(0);
  for (let i = 0; i < map.length; i++) {
    const mp = map[i];
    correctedAll[i] = mp && blockCorrected[mp.j] ? blockCorrected[mp.j][mp.k] : 0;
  }

  let segs;
  try { segs = decodeDataSegments(dataBytes, version); }
  catch (e) { return { ok: false, reason: "数据段解析失败：" + e.message }; }

  const text = segs.map((s) => s.text).join("");
  return {
    ok: true, text, version, size, ecl, eclIndex: ecl, mask,
    errorCount: totalErr, erasureCount: totalEras, blocksWithErasure,
    erasureFallback,
    numBlocks: blocks.length, segments: segs, dataBytes, correctedAll,
  };
}

/**
 * 重编码一致性判据（**消除穷举歧义的最强手段**）：
 * 用同一 (version, ecl, mask) 与解出的文本**重新编码**，取其码字流与我们的纠正结果逐值比对。
 * 若纠正错误（含"过纠正到另一个合法码字"这种典型假成功），重编码的码字流必然不同 ⇒ 拒绝。
 * 依据：ISO/IEC 18004 的编码是确定性的 —— 同一 (文本, 版本, ECL, 掩码) 只有唯一码字流。
 *
 * ⚠ 容量前置闸（必做，否则判据有洞）：`qrGenerate` 在**显式指定 version** 时不校验容量，
 *   超长文本会被截断成「前 dataCap 个码字」而照样画进矩阵；此时逐值比对只覆盖矩阵能装的
 *   那部分码字，于是「远超该版本容量的超长串 + 大量填充」也能通过判据 —— 这正是历史上踩到的
 *   「RS 过纠正 → 假的合法码字」假成功。故先按 ISO/IEC 18004 §6.4 的容量口径（数据码字数
 *   ×8 位）校验文本是否真装得下：装不下 ⇒ 直接判非原文，不做逐值比对。
 */
export function reencodeMatches(correctedAll, text, size, version, ecl, mask) {
  try {
    const mode = pickMode(text);
    const capBits = getNumDataCodewords(version, ecl) * 8;
    if (encodedBitLength(text, mode, version) + 4 > capBits) return false; // 装不下 ⇒ 非原文
    const g = qrGenerate(text, { ecl: ["L", "M", "Q", "H"][ecl], version, mask });
    if (g.size !== size) return false;
    const isFn = buildFunctionMap(size, version);
    const refCW = readCodewords(g.matrix, size, isFn, mask);
    if (refCW.length !== correctedAll.length) return false;
    for (let i = 0; i < refCW.length; i++) if (refCW[i] !== correctedAll[i]) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * 多组合穷举：ECL 与掩码未知时，遍历 ecl(0..3) × mask(0..7)。
 * **判据组合**：RS 全块成功 → 数据段可解析 → **重编码回去的码字流逐值一致**。
 * 只有通过全部三关的组合才算成功；多组通过且文本一致时接受（consistent=true），
 * 文本不一致则报「歧义」而不挑一个。
 */
export function decodeBruteWithErasures(matrix, conf, size, version, opt = {}) {
  const okList = [];
  const reasons = [];
  for (let ecl = 0; ecl < 4; ecl++) {
    for (let mask = 0; mask < 8; mask++) {
      const r = decodeWithErasures(matrix, conf, size, version, ecl, mask, opt);
      if (!r.ok) { if (reasons.length < 4) reasons.push(`ecl${ecl}/mask${mask}: ${r.reason}`); continue; }
      if (opt.requireReencode === false || reencodeMatches(r.correctedAll, r.text, size, version, ecl, mask)) {
        okList.push(r);
      } else if (reasons.length < 4) {
        reasons.push(`ecl${ecl}/mask${mask}: 重编码码字流不一致（判为假成功）`);
      }
    }
  }
  if (okList.length === 0) return { ok: false, reason: "32 组组合全部失败（含重编码判据）", samples: reasons };
  const texts = new Set(okList.map((r) => r.text));
  if (texts.size === 1) {
    return { ok: true, consistent: okList.length > 1, combinationsTried: 32,
             successfulCombinations: okList.length, ...okList[0] };
  }
  return { ok: false, ambiguous: true, count: okList.length, combinationsTried: 32,
           candidates: okList.map((r) => ({ ecl: r.ecl, mask: r.mask, text: r.text })),
           reason: "多组合成功且文本不一致（" + okList.length + " 组）：报歧义，不挑一个" };
}
