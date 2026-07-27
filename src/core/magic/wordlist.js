/*
 * core/magic/wordlist.js — 有意义文本识别词表
 *
 * 用于一键解码打分：解码结果若含真实单词/中文常用词，判为「有意义明文」并加权，
 * 而非仅靠 flag/ctf/key/pass 关键词。CTF 正解常是英文句子、单词串、中文词语，
 * 不一定带 flag 字样——本词表补足这一档。
 *
 * 纯数据 + 纯函数，零依赖，可 node 直跑单测。打分方向与 compositeScore 一致
 * （分越低越优）：命中越多返回越负（越优）。
 */

// 高频英文词（约 200 个，覆盖日常英文文本的极高比例）。全小写，按词边界匹配。
// 来源：通用英语高频词表（the/be/to/of… 量级），CTF 明文里出现即强信号。
const EN_WORDS = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "it", "for", "not",
  "on", "with", "he", "as", "you", "do", "at", "this", "but", "his", "by", "from",
  "they", "we", "say", "her", "she", "or", "an", "will", "my", "one", "all", "would",
  "there", "their", "what", "so", "up", "out", "if", "about", "who", "get", "which",
  "go", "me", "when", "make", "can", "like", "time", "no", "just", "him", "know",
  "take", "people", "into", "year", "your", "good", "some", "could", "them", "see",
  "other", "than", "then", "now", "look", "only", "come", "its", "over", "think",
  "also", "back", "after", "use", "two", "how", "our", "work", "first", "well",
  "way", "even", "new", "want", "because", "any", "these", "give", "day", "most",
  "us", "is", "are", "was", "were", "been", "has", "had", "did", "said", "may",
  "should", "here", "very", "much", "many", "such", "where", "why", "man", "world",
  "life", "hand", "part", "child", "eye", "woman", "place", "week", "case", "point",
  "government", "company", "number", "group", "problem", "fact", "hello", "world",
  "welcome", "message", "secret", "password", "please", "thank", "thanks", "yes",
  "code", "data", "file", "text", "name", "test", "example", "hidden", "found",
  "congratulations", "great", "done", "here", "your", "this", "that", "with",
  "have", "more", "will", "home", "user", "true", "false", "open", "read", "write",
  // 补充常见内容词（提升 pangram / 常见句子覆盖）
  "quick", "brown", "fox", "jumps", "over", "lazy", "dog", "flag", "key", "find",
  "system", "server", "client", "network", "access", "login", "admin", "root",
  "encode", "decode", "cipher", "encrypt", "decrypt", "hash", "value", "input",
  "output", "string", "bytes", "number", "letter", "word", "line", "next", "last",
  "start", "end", "begin", "finish", "correct", "wrong", "answer", "question",
  "challenge", "solve", "solved", "hint", "level", "score", "win", "lose", "game",
  "well", "good", "nice", "cool", "awesome", "perfect", "success", "fail", "error",
  // 补充：代词/连词/介词/助动词（连写明文分词命中率）+ CTF 高频内容词
  "i", "am", "love", "you", "your", "we", "us", "he", "she", "it", "him", "her",
  "happy", "enjoy", "hack", "hacker", "master", "winner", "champion", "genius",
  "smart", "clever", "easy", "hard", "simple", "complex", "random", "binary",
  "victory", "captured", "capture", "hello", "secret", "flag", "here", "there",
  "welcome", "goodbye", "please", "sorry", "again", "never", "always", "every",
  "little", "big", "small", "long", "short", "high", "low", "fast", "slow",
  "hidden", "reveal", "found", "lost", "search", "escape", "unlock", "locked",
  "safe", "danger", "warning", "alert", "check", "verify", "valid", "invalid",
  "welldone", "iloveyou", "letmein", "changeme", "iamgroot",
]);

// 常用中文汉字集（约 300 个最高频汉字，覆盖中文文本极高比例）。命中即强信号。
// 来源：现代汉语高频字表（的一是在不了有和人这中大…）。
const ZH_CHARS = new Set(
  ("的一是在不了有和人这中大为上个国我以要他时来用们生到作地于出就分对成会可主发年动"
    + "同工也能下过子说产种面而方后多定行学法所民得经十三之进着等部度家电力里如水化高自二"
    + "理起小物现实加量都两体制机当使点从业本去把性好应开它合还因由其些然前外天政四日那社义"
    + "事平形相全表间样与关各重新线内数正心反你明看原又么利比或但质气第向道命此变条只没结解问"
    + "意建月公无系军很情者最立代想已通并提直题党程展五果料象员革位入常文总次品式活设及管特件长"
    + "求老头基资边流路级少图山统接知较将组见计别她手角期根论运农指几九区强放决西被干做必战先回"
    + "则任取据处队南给色光门即保治北造百规热领七海口东导器压志世金增争济阶油思术极交受联什认六"
    + "共权收证改清美再采转更单风切打白教速花带安场身车例真务具万每目至达走积示议声报斗完类八离华"
    + "名确才科张信马节话米整空元况今集温传土许步群广石记需段研界拉林律叫且究观越织装影算低持音众"
    + "书布复容儿须际商非验连断深难近矿千周委素技备半办青省列习响约支般史感劳便团往酸历市克何除消"
    + "构府称太准精值号率族维划选标写存候毛亲快效斯院查江型眼王按格养易置派层片始却专状育厂京识适"
    + "属圆包火住调满县局照参红细引听该铁价严龙飞").split("")
);

// 词边界切分：抓字母序列（英文词）。
const WORD_RE = /[a-z]{2,}/gi;

// 连写词贪心最大匹配分词：CTF 明文常连写无空格（helloworld / iloveyou / flag{helloworld}），
// WORD_RE 只切出整串一个「词」不在词表 → meaningfulTextBonus 失效。这里对一个连写串
// 从左贪心找词表里最长的前缀词，切出后继续。返回 {covered, total}：covered=被词表词覆盖的
// 字符数，total=串长。真连写英文覆盖率≈1，乱码（xqzwkj）覆盖率≈0，用覆盖率干净区分。
// 只切 ≥3 字母的词入 covered（2 字母短词 is/to/or 在乱码里凑巧命中，不算覆盖，防误判）。
const _SEG_MIN = 3;   // 计入覆盖的最短词长
const _SEG_MAX = 15;  // 最长尝试前缀（超高频词表最长词约 15）
function segmentCoverage(lower) {
  const n = lower.length;
  let i = 0, covered = 0;
  while (i < n) {
    let matched = 0;
    // 贪心：从最长可能前缀往下试，找到第一个在词表里的 ≥_SEG_MIN 词
    const maxLen = Math.min(_SEG_MAX, n - i);
    for (let len = maxLen; len >= _SEG_MIN; len--) {
      const seg = lower.slice(i, i + len);
      if (EN_WORDS.has(seg)) { matched = len; break; }
    }
    if (matched) { covered += matched; i += matched; }
    else { i++; } // 当前位起无词，跳 1 字符继续（乱码字符不计入 covered）
  }
  return { covered, total: n };
}

/**
 * 轻量「含真实 token」判断（flag 格式 / 括号奖励的门槛，非打分）。
 * 目的：区分「真 flag（前缀或内容含真实词/汉字）」与「乱码恰好包了对花括号」
 * （atbash/rot 变换后的 xguhsld{xzrtlf_xfk} 这类：括号配对、可打印，但全无真实词）。
 * 命中任一即 true：① ≥3 字母词典实词；② ≥6 字母长词贪心分词覆盖率≥0.6（连写明文）；
 * ③ ≥1 常用汉字（flag 内容含中文基本是真解）。比 meaningfulTextBonus 宽松（只需 1 个信号）。
 * @param {string} str
 * @returns {boolean}
 */
export function hasMeaningfulToken(str) {
  if (!str) return false;
  const words = str.match(WORD_RE) || [];
  for (const w of words) {
    const lw = w.toLowerCase();
    if (lw.length >= 3 && EN_WORDS.has(lw)) return true;
    if (lw.length >= 6) {
      const { covered, total } = segmentCoverage(lw);
      if (covered / total >= 0.6) return true;
    }
  }
  for (const ch of str) {
    if (ZH_CHARS.has(ch)) return true;
  }
  return false;
}

/**
 * 有意义文本加权分（负=更优，与 compositeScore 同向）。
 *
 * 综合英文单词命中率 + 中文常用字命中率，取更强的一路给奖励。命中越充分越负。
 * 设计要点：
 * - 英文：切出所有 [a-z]{2,} 词，统计落在高频词表里的比例。比例高 = 是真英文句子。
 * - 中文：统计常用汉字在全部 CJK 字符里的占比。占比高 = 是真中文文本。
 * - 短样本（<2 词 / <2 汉字）不给奖励（噪声太大，避免乱码里恰好几个词冒头误判）。
 * - 量级：最高 -120，与 compositeScore 里 flag 强命中(-160)/弱(-40) 同档，
 *   足以让「解出的英文句子」压过「可打印乱码」（乱码卡方 100~130），但不越过 crib(-10000)。
 *
 * @param {string} str 解码结果
 * @returns {number} 0（无意义/太短）~ -120（充分命中）
 */
export function meaningfulTextBonus(str) {
  if (!str || str.length < 3) return 0;

  // —— 英文单词命中率 ——
  const words = str.match(WORD_RE) || [];
  let enBonus = 0;
  // (a) 多词分词命中：切出 ≥2 个词时统计落在高频词表里的比例。
  if (words.length >= 2) {
    let hit = 0, longHit = 0;
    for (const w of words) {
      if (EN_WORDS.has(w.toLowerCase())) {
        hit++;
        if (w.length >= 3) longHit++;   // 实词（≥3 字母）命中单独计
      }
    }
    const ratio = hit / words.length;
    // 收紧（修 affine 误报）：2 字母短词（us/to/is/or/an…）在字母数字乱码里极易凑巧命中，
    // 单靠短词不能算「有意义文本」。affine 垃圾串 "Us1TO1JGOLdTUi==" 就是靠 us+to 凑够
    // hit≥2 骗到 -60~-80 奖励压过真解。要求：命中≥2、其中至少 1 个 ≥3 字母实词、命中率≥0.5。
    if (hit >= 2 && longHit >= 1 && ratio >= 0.5) {
      enBonus = -Math.min(120, Math.round(ratio * 120));
    }
  }
  // (b) 连写词补捞（修 base64 明文常连写无空格的短板）——**独立于 (a)，单词也跑**。
  // helloworld / iloveyou / flag{helloworld} 这类连写明文：整串是「一个词」进不了词表
  // （所以 words.length 可能只有 1，(a) 不触发），但能贪心切成 hello+world / i+love+you。
  // 对每个 ≥6 字母、不在词表的长「词」试分词，覆盖率≥0.8 视为真连写英文，按覆盖率给奖励
  // （乱码 xqzwkj 覆盖率≈0，切不出，天然排除）。与 (a) 取更强（更负）的一路。
  if (enBonus > -60) {
    for (const w of words) {
      const lw = w.toLowerCase();
      if (lw.length < 6 || EN_WORDS.has(lw)) continue;
      const { covered, total } = segmentCoverage(lw);
      const cov = covered / total;
      if (cov >= 0.8) {
        const segBonus = -Math.min(120, Math.round(cov * 110));
        if (segBonus < enBonus) enBonus = segBonus;
      }
    }
  }

  // —— 中文常用字命中率 ——
  let zhBonus = 0;
  let cjkTotal = 0, cjkHit = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c >= 0x4e00 && c <= 0x9fff) {          // CJK 统一表意区
      cjkTotal++;
      if (ZH_CHARS.has(ch)) cjkHit++;
    }
  }
  if (cjkTotal >= 2) {
    const ratio = cjkHit / cjkTotal;
    if (cjkHit >= 2 && ratio >= 0.4) {
      zhBonus = -Math.min(120, Math.round(ratio * 120));
    }
  }

  // 取更强（更负）的一路——一段文本要么英文要么中文，不叠加。
  return Math.min(enBonus, zhBonus);
}

export default { meaningfulTextBonus };
