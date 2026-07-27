/*
 * core/magic/scorer.js — Magic 评分内核
 *
 * 移植自 CyberChef `src/core/lib/Magic.mjs` 的评分算法：不直抄源码，而是理解算法
 * 后用本项目风格重写。纯函数，零外部依赖，可 node 直跑单测、可在 worker 里调。
 *
 * 函数契约：
 * entropy(bytes) -> number // 香农熵，单位 bit，0..8
 * freqDist(bytes) -> number[] // 256 长度百分比数组（0-100）
 * chiSquareScore(freq, langTable) -> number // 卡方原始分（越小越像该语言）
 * isPrintableRatio(str) -> number // 可打印占比 0-1
 * shortLengthPenalty(str) -> number // 长度<3 正惩罚（越大越差）
 * replacementCharPenalty(str) -> number // 含 U+FFFD 正惩罚
 * pureAsciiBonus(str) -> number // 全 ASCII 负奖励（越小越优）
 * asciiPlaintextAdjustment(str) -> number // 三项之和（正=净惩罚/负=净奖励）
 *
 * bytes 接受 Uint8Array 或 number[]（0-255）；freq/langTable 是 freqDist 的输出或
 * langfreq.js 的语言表（长度必须 256，单位百分比 0-100）。
 *
 * 综合分公式（参考 Magic.mjs L328-360）：
 * score = chiSquareScore(freqDist(bytes), LANG_TABLE)
 * if (isUTF8) score -= 100 // UTF-8 文本奖励
 * if (识别到文件类型 && score > 500) score = 500 // 文件类型封顶
 * if (useful && score > 100) score = 100 // 有用文本封顶
 * score += recipeChainLength + entropy(bytes) // 链越长/熵越高越不可能是正解
 * 分越低越可能是正确解。
 * 本文件只交付打分原语，综合分公式由 magic.js 调用方组装。
 *
 * 纯 ASCII 明文优先打分项（一键解码穷举判据接成打分权重）：
 * 判据「解码结果须①长度≥3 ②不含 U+FFFD ③全 ASCII(ord≤127)」改为**打分权重**而非
 * 硬过滤——不达标候选保留但降权，让用户能看到所有候选。打分方向与 compositeScore
 * 一致（分越低越优）：penalty=正数（变差），bonus=负数（变优）。
 * 量级设计参考 compositeScore 现有项（printable -100 / chain +1..3 / entropy +0..8
 * / crib -10000），三项控制在 ±150 量级，既能影响排序又不压垮卡方/熵等核心判据：
 * - shortLengthPenalty = +60 （长度<3，显著降权）
 * - replacementCharPenalty = +150 （含 U+FFFD，刻意 >100 以抵消 isPrintableRatio
 * 把 U+FFFD 算作可打印导致的 -100 误奖励）
 * - pureAsciiBonus = -30 （全 ASCII，在 printable -100 基础上额外加成）
 * CJK 明文（全 ≥0x80 且无 U+FFFD）三项都不触发 → 调整为 0，不降权。
 */

const LOG2 = Math.log(2);

/**
 * 香农熵（Shannon entropy），单位 bit。
 * 算法等价 CyberChef Magic.mjs calcEntropy（L120-135）：
 * 对字节频率分布 p_i（0-1 概率），求 -Σ p_i * log2(p_i)。
 * 空输入返回 0（无信息）。最大值 8（完全均匀分布）。
 *
 * @param {Uint8Array|number[]} bytes
 * @returns {number}
 */
export function entropy(bytes) {
  const len = bytes.length;
  if (len === 0) return 0;

  const freq = freqDist(bytes); // 百分比 0-100
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const p = freq[i] / 100; // 转回 0-1 概率
    if (p > 0) {
      h += p * Math.log(p) / LOG2;
    }
  }
  return -h;
}

/**
 * 字节频率分布。返回长度 256 的数组，下标 = 字节值，值 = 该字节出现百分比（0-100）。
 * 算法等价 CyberChef Magic.mjs _freqDist（L400-422）。
 * 空输入返回全零数组（与 CyberChef 一致）。
 *
 * @param {Uint8Array|number[]} bytes
 * @returns {number[]} 长度 256，单位百分比
 */
export function freqDist(bytes) {
  const len = bytes.length;
  const counts = new Array(256).fill(0);

  if (len === 0) return counts;

  for (let i = 0; i < len; i++) {
    counts[bytes[i]]++;
  }

  const result = new Array(256);
  for (let i = 0; i < 256; i++) {
    result[i] = counts[i] / len * 100;
  }
  return result;
}

/**
 * Pearson 卡方统计量（原始分，无 cdf）。
 * 算法等价 CyberChef Magic.mjs _chiSqr（L465-472），但按 T31 卡要求**去掉
 * chi-squared npm 的 cdf 调用**，只返回 raw score。
 *
 * 公式：χ² = Σ (observed_i - expected_i)² / expected_i
 * 分越小 = 观测分布越接近期望分布 = 越像该语言。
 *
 * 注意：expected 为 0 的桶会跳过（避免除零；CyberChef 的语言表用 0.0001 做地板
 * 所以原版不触发除零，这里加一层防御以兼容自定义表）。
 *
 * @param {number[]} observed freqDist 的输出（百分比 0-100，长度 256）
 * @param {number[]} expected langfreq.js 的语言表（百分比 0-100，长度 256）
 * @returns {number}
 */
export function chiSquareScore(observed, expected) {
  if (observed.length !== 256 || expected.length !== 256) {
    throw new Error(`chiSquareScore 需要长度 256 的数组，收到 observed=${observed.length} expected=${expected.length}`);
  }
  let score = 0;
  for (let i = 0; i < 256; i++) {
    const e = expected[i];
    if (e <= 0) continue; // 防御除零
    const diff = observed[i] - e;
    score += diff * diff / e;
  }
  return score;
}

/**
 * 可打印字符占比（0-1）。
 * CyberChef Magic.mjs 没有完全对应的函数（它在 fileType 检测里隐式用可打印性）
 * 本卡按 CTF 场景自行设计：统计字符串中「可打印 ASCII + 常见空白」字符的比例。
 *
 * 可打印范围：0x20-0x7E（含空格、字母数字、标点）+ \t \n \r (0x09/0x0A/0x0D)。
 * 非 ASCII（>= 0x80）按 UTF-16 码点判断：U+0080-U+009F（C1 控制符）不算
 * 其余 Unicode 字符（含中文、emoji）算可打印（因为它们在源语言里是正常文本）。
 *
 * 空串返回 1（vacuously printable，避免空输入被误判为不可打印）。
 *
 * @param {string} str
 * @returns {number} 0-1
 */
export function isPrintableRatio(str) {
 // 按 Unicode 码点计数（而非 UTF-16 码元），避免补充平面字符（如 emoji）被
 // 拆成代理对导致分母翻倍。空串返回 1。
  let n = 0, printable = 0;
  for (const ch of str) {
    n++;
    const code = ch.codePointAt(0);
    if (
      (code >= 0x20 && code <= 0x7E) ||     // ASCII 可打印
      code === 0x09 || code === 0x0A || code === 0x0D || // 常见空白
      code >= 0xA0                          // 非 ASCII（含中文/emoji/扩展拉丁）
    ) {
      printable++;
    }
  }
  return n === 0 ? 1 : printable / n;
}

/**
 * ① 长度≥3 判据的打分项。
 * 解码结果长度 < 3 → 正惩罚（候选变差）。穷举判据①转打分权重。
 *
 * 按 Unicode 码点计数（与 isPrintableRatio 一致），避免代理对/补充平面字符
 * 把长度算翻倍。空串长度 0 < 3 → 触发惩罚。
 *
 * 量级 +60：显著降权但低于 printable bonus（-100）的绝对值，不至完全抹掉
 * 可打印奖励；也远低于 crib（-10000），不影响 crib 绝对优先。
 *
 * @param {string} str
 * @returns {number} 长度<3 返回 +60，否则 0
 */
export function shortLengthPenalty(str) {
  let len = 0;
  for (const _ of str) len++;
  return len < 3 ? 60 : 0;
}

/**
 * ② 不含 U+FFFD 判据的打分项。
 * 解码结果含 U+FFFD（Unicode 替换字符 REPLACEMENT CHARACTER）→ 正惩罚（候选变差）。
 * 穷举判据②转打分权重。
 *
 * U+FFFD 是 UTF-8 解码失败的标志（非法字节序列被替换为 U+FFFD），出现即强烈
 * 指示该候选是错误解码。注意 isPrintableRatio 把 U+FFFD（0xFFFD ≥ 0xA0）算作
 * 可打印，会吃到 -100 的 printable bonus，因此本惩罚量级刻意 >100 以纠偏：
 * 含 U+FFFD 的候选净效果 = -100 (printable) + 150 (本惩罚) = +50（净惩罚）。
 *
 * 量级 +150：大于 printable bonus 绝对值，确保含 U+FFFD 的候选被降权而非被
 * 误奖励；但仍低于 crib 的绝对优先级。
 *
 * @param {string} str
 * @returns {number} 含 U+FFFD 返回 +150，否则 0
 */
export function replacementCharPenalty(str) {
  return str.includes("\uFFFD") ? 150 : 0;
}

/**
 * ③ 全 ASCII 判据的打分项。
 * 解码结果全 ASCII（所有码点 ≤127）→ 负奖励（候选变优）。
 * 穷举判据③转打分权重——纯 ASCII 明文优先。
 *
 * 按 Unicode 码点判断（ch.codePointAt(0) > 127 即非 ASCII），正确处理补充平面
 * 字符（emoji 等会被视为非 ASCII，不触发本奖励，但也不降权）。
 *
 * 量级 -30：在 printable bonus（-100）基础上的额外加成，让纯 ASCII 明文
 * 略优于 CJK/emoji 明文。CJK 明文（全 ≥0x80 且无 U+FFFD）不触发本项 → 返回 0
 * 既不加分也不降权（CJK 明文也是合法解码）。
 *
 * 注：U+FFFD（0xFFFD）> 127，含 U+FFFD 的候选不会触发本项（已被
 * replacementCharPenalty 降权）。
 *
 * @param {string} str
 * @returns {number} 全 ASCII 返回 -30，否则 0
 */
export function pureAsciiBonus(str) {
  for (const ch of str) {
    if (ch.codePointAt(0) > 127) return 0;
  }
  return -30;
}

/**
 * 纯 ASCII 明文优先综合调整分（三项之和）。
 * 正值 = 净惩罚（候选变差），负值 = 净奖励（候选变优），0 = 中性（如 CJK 明文）。
 *
 * 调用方（magic.js compositeScore）用法：score += asciiPlaintextAdjustment(result);
 * 放在 compositeScore 现有项（chiSquare/printable/chain/entropy）之后累加即可
 * 不破坏现有打分体系——三项量级（±150）小于 crib（-10000）且与 printable（-100）
 * 同量级，作为微调权重协同工作。
 *
 * 典型场景：
 * - 纯 ASCII 明文（如 "flag{...}"） → +0 +0 -30 = -30（净奖励）
 * - 含 U+FFFD 的错误解码 → +0 +150 +0 = +150（净惩罚，纠偏 printable 误奖）
 * - 长度<3 的超短结果（如 "ab"） → +60 +0 -30 = +30（净惩罚）
 * - CJK 明文（如 "你好世界"） → +0 +0 +0 = 0（中性，不降权）
 * - 含 U+FFFD 且超短（如 "\uFFFD"） → +60 +150 +0 = +210（重惩罚）
 *
 * @param {string} str
 * @returns {number}
 */
export function asciiPlaintextAdjustment(str) {
  return shortLengthPenalty(str) + replacementCharPenalty(str) + pureAsciiBonus(str);
}

export default { entropy, freqDist, chiSquareScore, isPrintableRatio, shortLengthPenalty, replacementCharPenalty, pureAsciiBonus, asciiPlaintextAdjustment };
