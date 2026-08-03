/*
 * core/magic/magic.js — Magic 一键智能识别（T32 交付）
 *
 * 升级 detect.js 的 oneClickDecode（朴素 BFS + confidence 乘积）为 CyberChef Magic 级：
 * - crib 目标过滤（CTF 杀手锏）：opts.crib 传正则源串，硬过滤只留命中候选
 * - 综合评分排序：用 T31 scorer（熵+语言卡方+链长+crib）替换 confidence 乘积，分低=优
 * - 强化剪枝：自打转检测（同 op 且 output==input 放弃，lib:287）、可选 outputCheck
 * - intensive 暴力模式：对前 N 字节跑 1-byte XOR 全 255 key + 位旋转 1-7（lib:142-166）
 *
 * 算法参考 CyberChef `src/core/lib/Magic.mjs`，按红线「照算法重写非抄源」用本项目
 * 风格重写。本项目是字符串工具（非字节缓冲），isUTF8 映射到 isPrintableRatio>=0.9
 * fileType 检测不适用（无文件头），useful = 可打印 || matchesCrib。
 *
 * 综合分公式（lib:328-360）：
 * score = chiSquareScore(freq, EN)
 * if (isPrintableRatio>=0.9) score -= 100 // 可打印文本奖励
 * if (useful && score > 100) score = 100 // 有用文本封顶
 * if (matchesCrib) score = -10000 // crib 命中绝对优先（本项目增强）
 * score += chainLength + entropy(bytes) // 链长/熵越高越不可能是正解
 * 分越低越可能是正确解。
 *
 * 保留 confidence（detect 乘积）用于 UI 显示，score 用于排序。
 * 保留「允许同 op 连用」（M 裁决，base64(base64(x)) 场景）。
 */
import { OPS, defaultParams, getOp } from "../registry.js";
import { entropy, freqDist, chiSquareScore, isPrintableRatio, asciiPlaintextAdjustment } from "./scorer.js";
import { EN as EN_FREQ, ZH as ZH_FREQ } from "./langfreq.js";
import { meaningfulTextBonus, hasMeaningfulToken } from "./wordlist.js";
import {
  PARAM_SWEEP, PARAM_SCAN_OP_IDS, PARAM_SCAN_P0_IDS,
  PARAM_SCAN_DEFAULT_LIMIT, formatParamTag,
  inputFeatures, coarseAdmitPlain, sweepApplies,
} from "../exhaustiveDecode.js";

// flag{...} 完整格式（弱奖励）：任意 前缀{内容} 结构，含乱码花括号也命中。
const FLAG_FORMAT_RE = /[a-z0-9_]{2,}\{[^{}]{1,}\}/i;
// 强命中（重奖励）——**只认明文语义**：含 flag/ctf/key/pass 明文单词。
// 绝不含 base64 密文前缀（Zmxh/Y3Rm 等）——那是「尚未解开的密文信号」，若给排序奖励会让
// 残留密文冒头压住真明文 flag（实测 base64 未解串带 Zmxh 吃 -160 顶掉 flag{hello_world}）。
// 密文前缀特征归 exhaustiveDecode 的显示高亮（FLAG_KEYWORDS），不进 magic 排序。
// ⚠ 必须**词首 + 结构感知**，不能裸子串匹配：
// - 前边界 (^|[^a-z])：保证关键词是词的开头，排除 monkey 的 key / compass 的 pass / donkey 的 key。
// - 关键词后允许跟字母数字下划线 [a-z0-9_]*，覆盖 CTF 平台前缀 ctfshow/moectf/hgame/flagg 等
//   （旧正则要求关键词后紧跟非字母，把 "ctfshow{...}" 漏成弱档 -40，真 flag 被乱码压到 #62）。
// - 末尾必须紧跟结构符 [\{:=_]：保证是「flag 格式」而非普通英文句子——
//   "Welcome to CTFshow vegetable" 无结构符不误命中；且修复旧正则「乱码里 ctf5*19 因 ctf 后跟
//   数字误吃 -160 顶到 top1」（ctf5 后是 *，非 {:=_，不命中 → 乱码沉底，凯撒正解上位）。
const FLAG_STRONG_RE = /(^|[^a-z])(flag|ctf|key|pass|hgame|moectf)[a-z0-9_]*[\{:=_]/i;

const DEFAULTS = {
  maxDepth: 1,            // 最大解码层数（默认 1=单层；多层链式解码由 UI「多层」开关传 3）
  maxCandidates: 50,      // 最多返回候选数
  crib: null,             // crib 正则源串（如 "flag\\{"）或 RegExp 对象，null 不过滤
  intensive: false,       // 1-byte XOR + 位旋转暴力
  bruteBytes: 100,        // intensive 只对前 N 字节跑（防大输入爆炸）
  guard: 50000,           // 总迭代兜底（防组合爆炸）
  paramScan: true,        // MT3：带参 op 参数网格扫描（白名单绕过 detect 要求直接扫描）
  paramScanLimit: PARAM_SCAN_DEFAULT_LIMIT, // 总组合数上限，超限只扫 P0
  key: null,              // 用户在工具栏填的密钥（需求3）——带 key 时试各加解密 op
  allowOps: null,         // 参与解码的 op id 白名单（Set/数组）。null=不限制（旧行为）。
                          // 由 UI 的「解码强度」预设/自定义勾选传入，见 core/decodeProfile.js。
  timeBudget: 30000,      // 硬墙钟死线（毫秒）：兜底上限，超时无条件收尾（防病态输入无限跑）
  signal: null,           // AbortSignal（看门狗/新输入接管）——aborted 立即收尾返回已有候选
  softDeadlineMs: 5000,   // 软死线（毫秒）：到点回调 onPartial(已得结果) 让 UI 先渲染，之后继续跑
  onPartial: null,        // 软死线回调 (candidates)=>void——渲染部分结果，不中断后台继续
  yieldEvery: 40,         // 每跑 N 个 op 让出一次主线程（宏任务）：UI 可刷新/倒计时可走/abort 可收
};

// ============ 带密钥加解密尝试（需求3） ============
// 用户在工具栏填了 key → 把「输入单个 key/参数的加解密 op」也纳入一键解码。
// 对 AES 这类还需 IV/模式的常用 op，用行业通用 + CTF 常考「默认数据」补全其余参数
// （IV 全零、常见模式 ECB/CBC、密钥/密文编码组合），一起参与解密。
// 只在 depth 0 跑（带 key 的解密是单步语义，不参与多层 BFS）。

// 各分组密码的块大小（字节）→ 全零 IV 的 hex 长度。
const BLOCK_IV_HEX = { aes: "0".repeat(32), des: "0".repeat(16), des3: "0".repeat(16), sm4: "0".repeat(32), blowfish: "0".repeat(16) };

// 生成某 op 在给定 key 下的「CTF 默认参数」候选组。返回 [{params, tag}]。
// 密文(输入)编码试 base64/hex；密钥编码试 utf8/hex/base64；分组密码试 CBC(IV=0)/ECB。
function keyedAttackParams(opId, key) {
  const list = [];
  const keyEncs = ["utf8", "hex", "base64"];
  const outEncs = ["base64", "hex"];
 // 分组密码：AES/DES/3DES/SM4/Blowfish —— 补 mode + IV(全零) + 编码组合
  if (BLOCK_IV_HEX[opId]) {
    const ivHex = BLOCK_IV_HEX[opId];
    const modes = ["CBC", "ECB"];
    for (const keyEnc of keyEncs)
      for (const mode of modes)
        for (const outEnc of outEncs)
          list.push({
            params: { key, keyEnc, mode, iv: mode === "ECB" ? "" : ivHex, ivEnc: "hex", outEnc },
            tag: `${mode},key:${keyEnc},ct:${outEnc}`,
          });
    return list;
  }
 // 流密码 RC4/XOR：key + 编码组合（自反，decode 即解密）
  if (opId === "rc4" || opId === "xor") {
    for (const keyEnc of keyEncs)
      for (const outEnc of outEncs)
        list.push({ params: { key, keyEnc, outEnc }, tag: `key:${keyEnc},ct:${outEnc}` });
    return list;
  }
 // Fernet：key 为 base64url，单参
  if (opId === "fernet") {
    list.push({ params: { key, checkMac: false }, tag: "fernet" });
    return list;
  }
 // txtmoji：口令参数名是 password（非 key），CTF 常为标题十进制。单参。
  if (opId === "txtmoji") {
    list.push({ params: { password: key }, tag: "pw" });
    return list;
  }
 // 古典文本密钥密码（vigenere/beaufort/autokey/gronsfeld/porta/columnar/playfair…）：key 直接当密钥文本
  list.push({ params: { key }, tag: "key" });
  return list;
}

// 会用工具栏 key 尝试的 op id（带文本/字节密钥的加解密）。分组/流/Fernet 已在 keyedAttackParams 特化，
// 其余为古典文本密钥密码。全部只在 depth 0 用用户 key 跑一次，产出候选参与综合分排序。
const KEYED_OP_IDS = [
  // 现代（分组/流/令牌）
  "aes", "des", "des3", "sm4", "blowfish", "rc4", "xor", "fernet", "rc2", "rabbit",
  // emoji 加密（口令走 password 参数，keyedAttackParams 已特化）
  "txtmoji",
  // 古典文本密钥
  "vigenere", "beaufort", "autokey", "gronsfeld", "porta", "columnar",
  "playfair", "bifid", "trifid", "adfgx", "adfgvx", "foursquare", "hill",
];
// 快速判定某 op 是否走 keyed-crypto 注入（plainOps 过滤用，避免无 key 时重复/冲突）。
const KEYED_OPS = new Set(KEYED_OP_IDS);

// 报告型 decode op 黑名单——decode 吐「分析报告文本」而非解码字节的少数 op。
// 它们有 decode 但语义是分析工具（对任意输入都吐一段中文/英文说明），报告文本会被
// compositeScore 误判成有意义明文冒头污染结果。自动解码绝不纳入（手动用仍可）。
// 由 工具/_report_probe.mjs 自动扫出（decode 输出含 ===/识别:/长度: 等报告标记）。
// knapsack：decode 型「教学报告」op——demo 密钥对任意逗号分隔数字串恒「可解」，返回
// 带中文标题（=== 背包加密…解密 ===）+ 私钥 + 明文的多行报告，中文被词典命中抬分顶包。
// 它不是通用解码器（需用户私钥），自动解码里纯噪声，拉黑。
const NO_MAGIC_OPS = new Set(["luhn", "spiralMatrix", "ttlStego", "cnidCheck", "isbn", "ean13", "upc", "knapsack", "flashSwirl"]);

// 「明文样式变换」op：输入输出都是明文，只做字符美化/替换（leetSpeak 0↔o、rot 移位等）。
// 一旦当前文本已是完整 flag（FLAG_STRONG 命中），再跑这些只会把成型 flag 劣化成噪声
// （实测 type7 解出 ctfshow{...Kn0w...Ci$c0...} 后被 leetSpeak 把 0→o、$→s 变成劣化版
// 却仍带 ctfshow{ 拿强档，分数贴住真解顶到 #2）。故：cur.text 已 flag-strong 时跳过它们。
const PLAINTEXT_STYLE_OPS = new Set(["leetSpeak", "rot13", "rot47", "rot5", "rot18", "atbash", "rot8000"]);

// 字符串 → UTF-8 字节序列（scorer 需要 bytes）
function toBytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

// 单个 op.decode 的墙钟兜底：把（可能永不 resolve 的）decode 与一个超时竞速。
// 浏览器专属根因——无 detect 的图像/音频类 op（spectrogram/blindWatermark/mcMap…）
// 拿到文本输入（非合法图片字节）时 `img.onload` 永不触发、Promise 永不 settle，
// node 里这些 API 直接抛错被跳过（所以 node 测不出），浏览器里却把整个 magicDecode 挂死
// → await 永不返回 → 连原始输入卡都不出。这里给每个 op 单独套超时，超时即当作「此 op 无结果」
// 跳过，绝不阻塞其余 op。注意：**只能拦截 async 永不 resolve**；同步死循环 JS 主线程无法中断
// （那类 op 需从 plainOps 过滤或修 op 本体）。
const PER_OP_TIMEOUT_MS = 700;
function decodeWithTimeout(fn, text, params, ms = PER_OP_TIMEOUT_MS) {
  // 性能关键：绝大多数 op（古典/base/花式）是纯同步函数，永不永挂。
  // 先同步调用——返回非 thenable（普通字符串）直接返回，零 setTimeout / 零 Promise.race。
  // paramScan 网格在 depth1 多节点上跑，累计上万次 decode；旧版每次都建定时器 + 微任务，
  // 3 层链实测 12s 主要耗在这。只有真异步 op（图像 img.onload / 音频 decodeAudioData）
  // 返回 Promise，才套超时竞速防永挂。
  let out;
  try {
    out = fn(text, params);
  } catch (e) {
    return Promise.reject(e);
  }
  if (out == null || typeof out.then !== "function") return out;   // 同步结果：直接返回
  return Promise.race([
    out,
    new Promise((_, reject) => setTimeout(() => reject(new Error("op-timeout")), ms)),
  ]);
}

// 让出主线程（宏任务）：magic 是主线程 BFS，同步 op 密集时不让出会冻结 UI——
// 倒计时不动、AbortSignal 收不到、按钮点不动。周期性 await yieldToMain() 把控制权交回事件循环，
// 让浏览器有机会刷新倒计时、响应中断、渲染部分结果。node 里 setTimeout(0) 同样有效。
const yieldToMain = () => new Promise((r) => setTimeout(r, 0));

// 中断异常（用户输入新内容 → abort 旧任务 → 循环里检测 signal 抛此错 → 上层识别为「被接管」不报错）。
class MagicAbort extends Error {
  constructor() { super("magic-aborted"); this.name = "MagicAbort"; }
}

// 字节数组 → latin1 字符串（1 字节 = 1 码点，保 byte identity 供后续 detect）
// 注：latin1 范围 U+0000-U+00FF，与 byte 0-255 一一对应。XOR/ROT 产物常含非 ASCII
// 字节，用 latin1 解码保证后续 op 能按字符处理。最终结果展示时若含控制符 UI 自会显示。
function latin1Decode(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

// 字符串 → latin1 字节序列（intensive 暴力用，保持字符 0-255 ↔ 字节 0-255 一一对应）
// 不用 UTF-8：latin1 字符 U+0080-U+00FF 在 UTF-8 下是双字节，XOR/ROT 后字节身份丢失。
// intensive 针对「二进制数据的字符串呈现」（CTF 场景），latin1 合理。
function latin1Bytes(str) {
  const arr = new Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xFF;
  return arr;
}

// 括号/引号是否全部成对闭合（flag 格式加分用）。有任一对不闭合或嵌套错乱即 false；
// 完全没有括号也返回 false（无可加分依据，不奖励）。栈式匹配处理嵌套 {[(<>)]}。
const _BRACKET_OPEN = { "{": "}", "[": "]", "(": ")", "<": ">" };
const _BRACKET_CLOSE = new Set(["}", "]", ")", ">"]);
function isBracketBalanced(str) {
  const stack = [];
  let sawBracket = false;
  for (const ch of str) {
    if (_BRACKET_OPEN[ch]) { sawBracket = true; stack.push(_BRACKET_OPEN[ch]); }
    else if (_BRACKET_CLOSE.has(ch)) {
      sawBracket = true;
      if (stack.pop() !== ch) return false;   // 闭合与栈顶不匹配 → 错乱
    }
  }
  if (!sawBracket || stack.length !== 0) return false; // 无括号 / 有未闭合
 // 成对引号也要求偶数（单/双引号），奇数说明残缺，不算「配对良好」。
  const dq = (str.match(/"/g) || []).length;
  const sq = (str.match(/'/g) || []).length;
  return dq % 2 === 0 && sq % 2 === 0;
}

// 是否像「密文的又一层密文」而非明文（修 affine/rotSpecial 把 base64 密文再变换的误报）。
// 特征：① 以 base64 padding 尾结束（=/== 结尾，正常明文极少）；或 ② 长度≥8 且几乎全为
// 大小写字母数字混排（含大小写各有、且数字穿插）、无空格、无 ≥3 字母真实词——典型 base64/
// 密文外观。这类串被古典密码变换后仍是密文外观，不该当明文冒头。
function looksLikeCiphertext(str) {
  if (!str) return false;
 // ① base64 pad 尾
  if (/=$/.test(str)) return true;
 // ② 无空白的字母数字长串，且大小写与数字混排（base64/hex-ish 外观）
  if (str.length >= 8 && !/\s/.test(str)) {
    const alnum = str.replace(/[^A-Za-z0-9]/g, "");
    if (alnum.length / str.length >= 0.85) {
      const hasUpper = /[A-Z]/.test(alnum);
      const hasLower = /[a-z]/.test(alnum);
      const hasDigit = /[0-9]/.test(alnum);
      if (hasUpper && hasLower && hasDigit) return true; // 三者混排 = 强密文外观
    }
  }
 // ③ 残留 QP/URL 转义（=XX / %XX，X 为十六进制）：≥2 处说明这一层没被真正解开
 // （pizzini/leetSpeak/railFence 只变换部分字符，QP 的 =C3=A9 原样残留）。阈值 ≥2 避免
 // 误伤真明文里偶发的单个 =XX（如正解 "flag=café測" 的 "=ca" 恰好 1 处，放行）。
  const qpResidual = (str.match(/=[0-9A-Fa-f]{2}/g) || []).length;
  const urlResidual = (str.match(/%[0-9A-Fa-f]{2}/g) || []).length;
  if (qpResidual + urlResidual >= 2) return true;
  return false;
}

/**
 * 综合分（参考 CyberChef Magic.mjs L328-360）。分越低越可能是正确解。
 * @private
 */
function compositeScore(result, chainLength, matchesCrib, chain) {
  const bytes = toBytes(result);
  const freq = freqDist(bytes);
 // 语言卡方：取英文表与中文表的较小值。中文正解在 EN 表下卡方极大（高频字节
 // 0x80-0xBF/0xE4-0xE9 在英文里期望≈0），在 ZH 表下卡方小 → min 后能排到前列
 // 解决「中文正解被英文卡方顶到候选末尾/被 maxCandidates 截断」的问题。
  const scoreEN = chiSquareScore(freq, EN_FREQ);
  const scoreZH = chiSquareScore(freq, ZH_FREQ);
  const rawChi = Math.min(scoreEN, scoreZH);   // 越小越像（英文或中文）

 // 4②「置信度虚高 / 正解与乱码分不开」修复：
 // 原逻辑 `if (isUtf8) score-=100; if (useful && score>100) score=100` 把所有可打印
 // 候选的卡方**硬封顶到 100**，卡方区分度被彻底抹平——正解 Hello World(chi≈1335) 与
 // 乱码 jinns(chi≈5271) 最终同挤 72~74 分且乱码反排更前。改用 **log 压缩**：保序、有界
 // 大卡方（flag{} 等特殊字节分布）不淹没加性项，可打印候选间卡方差异得以保留。
  let score = Math.log2(1 + rawChi) * 10;      // chi 1e3→~100 / 5e3→~124 / 6e4→~160，单调保序

  const printable = isPrintableRatio(result);
  const isUtf8 = printable >= 0.9;

  if (!isUtf8) score += 80;                     // 不可打印惩罚（替代原可打印 -100 奖励，等价反向且不触发封顶）
 // op 在非法/短输入下的 bug 产物（bifid/trifid 等古典密码对越界位置 push undefined
 // String 后拼成 "…undefinedundefined"）。这类串字节重复度高 → 卡方偏低 → 会误冒头到
 // 候选顶部（实测 bifid>trifid 垃圾 conf 79% 挤掉正解）。重罚 +1000 令其沉底。
  if (/undefined|NaN|\[object /.test(result)) score += 1000;
 // flag 格式奖励：分强/弱两档，避免乱码里恰好出现的 "…{…}" 被误当 flag 顶上来
 // （实测 xor:6>rot47 产物 "…5d{F-}ej" 误命中吃满奖励，把真 flag{hello_world} 压下去）。
 // 强档 -160：含 flag/ctf/key/pass 等关键词包裹的 xxx{...}，几乎确定是正解。
 // 弱档 -40 ：泛化的 word{...} 格式但无关键词，轻微加权即可，不足以翻越乱码卡方。
  if (FLAG_STRONG_RE.test(result)) score -= 160;
 // 弱档 -40：泛化 word{...} 格式但无 flag/ctf 关键词。加词典门槛——括号内外必须含真实
 // token（词典实词/连写英文/中文常用字），否则纯乱码包个规矩花括号（如 "xguhsld{xzrtlf_xfk}"
 // 是 atbash>base64 只解开 base 层的产物）也白拿 -40 顶到 top1。要求 hasMeaningfulToken 才给。
  else if (FLAG_FORMAT_RE.test(result) && hasMeaningfulToken(result)) score -= 40;
 // 括号/引号配对奖励（恒烈需求）：flag 格式绝大多数是成对括号包裹（flag{...} / key(...)），
 // 真解的 {}[]()<> 与引号成对闭合。轻档 -25：不越过卡方主项、也不与 FLAG_FORMAT 叠太满，
 // 但足以在两条同量级候选间把「括号闭合的那条」抬前（affine 垃圾串括号常不配对）。
 // 只认「有括号且全部配对」；无括号或有奇数括号（残缺）不给奖励。
 // 同加词典门槛：括号配对但里外全是乱码（古典密码未解层）不给分，防「乱码包花括号」蹭 -25。
  if (isBracketBalanced(result) && hasMeaningfulToken(result)) score -= 25;
 // 密文残留惩罚（修 affine/rotSpecial 误报）：解码结果里若残留 base64 pad 尾（==/= 结尾）、
 // 或大段连续大小写字母数字混排且无空格/无真实词（典型「密文被古典密码再变换一次」的产物，
 // 如 affine 把 base64 密文变成 "Us1TO1JGOLdTUi=="），说明这不是明文，是「密文的又一层密文」。
 // 重罚 +90 令其沉底，把「先 base64 解开」的真链让出来。
  if (looksLikeCiphertext(result)) score += 90;
  // crib 命中：绝对优先，但用减法而非硬置——否则所有命中 crib 的候选被抹平成同分，
  // 组内只能靠插入顺序排序。实测 QP 输入 "flag=3Dcaf=C3..." 里 pizzini/leetSpeak/
  // keyboardShift/railFence 都保留了 "flag=" 前缀 → 全部假命中 crib → 真正解
  // "flag=café測" 被 11 个垃圾同分候选挤到 #12。改减法后 compositeScore 的 chi/
  // meaningfulText 差异得以保留，真明文在 crib 组内也能冒到 top1。
  if (matchesCrib) score -= 10000;
 // 最小路径原则（恒烈需求）：链越长越不可能是正解。原 +chainLength(每层+1)太弱——
 // 长乱码链的 chi 差异远盖过 1 分链长差，导致「type7(1层真解) vs leetSpeak>affine(2层乱码)」
 // 分数贴太近。改每层 ×12 阶梯惩罚：depth1=+0 / depth2=+12 / depth3=+24…，
 // 让「解开就到位」的短链真解显著优于「多层拼凑」的长链，且不淹没 flag/crib 强奖励(-160/-10000)。
  score += (chainLength - 1) * 12;
 // 明文样式变换 op（leetSpeak/rot 等冷门美化算法，恒烈需求3）惩罚：
 // 它们 detect 命中率高（含 0/1/@ 就中）却是冷门算法，开穷举/多层时总在前排刷存在感。
 // 链里含这类 op 即 +35，把它压到真正的解码链之后（真解含它极少，多为噪声二次变换）。
  if (chain && chain.some((op) => PLAINTEXT_STYLE_OPS.has(op))) score += 35;
 // xor/rot 单字节暴力候选（恒烈需求2）：整类降权。它们是「碰运气」猜测，绝大多数无意义，
 // 除非真解出 flag/命中 crib（那时 -160/-10000 强奖励会盖过本惩罚）。+45 把普通 xor/rot
 // 噪声压到正经解码链之后，不再前排刷屏。
  if (chain && chain.some((op) => /^(xor|rot):/.test(op))) score += 45;
  score += entropy(bytes);                       // 熵越高越不可能是正解
  score += asciiPlaintextAdjustment(result);     // MT6a 纯 ASCII 明文优先（长≥3/无U+FFFD/全ASCII）
 // 有意义文本奖励：解码结果是真英文句子/中文词语（非 flag 字样也算正解）。
 // CTF 正解常是普通单词串/句子，本项补足「只认 flag 关键词」的盲区（恒烈需求4）。
  score += meaningfulTextBonus(result);          // 命中真实词表：最高 -120（净奖励）
  return score;
}

/**
 * 可选 outputCheck（op 声明输出正则/熵门控，lib:210-227）。
 * op.outputCheck 形如 { pattern?: RegExp|string, entropyRange?: [min,max] }。
 * 当前项目无 op 声明此字段，留作未来扩展（defensive）。
 * @private
 */
function outputCheckPasses(text, check) {
  if (!check) return true;
  if (check.pattern) {
    const re = check.pattern instanceof RegExp ? check.pattern : new RegExp(check.pattern);
    if (!re.test(text)) return false;
  }
  if (check.entropyRange) {
    const [min, max] = check.entropyRange;
    const h = entropy(toBytes(text));
    if (h < min || h > max) return false;
  }
  return true;
}

/**
 * 一键 Magic 智能识别。
 *
 * @param {string} input 输入文本
 * @param {object} [opts]
 * - maxDepth 最大解码层数（默认 3）
 * - maxCandidates 最多返回候选数（默认 50，按综合分升序截断）
 * - crib 目标特征正则（字符串或 RegExp），如 "flag\\{"，命中候选绝对优先
 * 且有 crib 时**硬过滤**只留命中候选
 * - intensive 是否开 1-byte XOR + 位旋转暴力（默认 false）
 * - bruteBytes intensive 只对前 N 字节跑（默认 100）
 * - guard 总迭代兜底（默认 50000）
 * @returns {Promise<Array<{chain:string[], result:string, confidence:number, score:number, matchesCrib:boolean}>>}
 * 候选数组，按综合分升序（分低=优）。chain 含合成 id（xor:K / rot:R）或 op id。
 */
// 大输入安全线：超过则跳过 paramScan/intensive/plainOps（只跑有 detect 的解码）。
// 原因：这些网格/暴力对长输入是同步长任务，timeBudget 的让出检查点无法中断它们，
// 用户 force 一键解码跑 100KB+ 输入会卡死主线程。detect 解码（base64 等）无此问题。
const BIG_INPUT_LIMIT = 100000;

export async function magicDecode(input, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  if (!input || typeof input !== "string" || input.length === 0) return [];
  if (input.length > BIG_INPUT_LIMIT && !o._forceBig) {
    o.paramScan = false;
    o.intensive = false;
    o.maxDepth = 1;
  }

 // crib 正则编译
  let cribRe = null;
  if (o.crib) {
    try {
      cribRe = typeof o.crib === "string" ? new RegExp(o.crib, "i") : o.crib;
    } catch {
      cribRe = null; // 非法正则降级为不过滤（不阻塞解码）
    }
  }

  const f = inputFeatures(input);

 // ---- 解码强度白名单（UI「解码强度」预设/自定义）----
 // o.allowOps 为 null 时 allowed() 恒真 = 完全保持旧行为；给了集合则只让集合内 op 参与。
 // 作用于全部四个候选来源：decoders / plainOps / paramScan / keyed，避免「关了却仍在跑」。
  const _allowSet = o.allowOps == null
    ? null
    : (o.allowOps instanceof Set ? o.allowOps : new Set(o.allowOps));
  const allowed = (opId) => _allowSet === null || _allowSet.has(opId);

 // 候选 op 分两层（恒烈需求1：所有编解码 op 都安排上，花式算法不遗漏）：
 // ① detectOps：有 detect 的 op —— 强信号，允许参与多层 BFS 链（≤maxDepth）。
 // ② plainOps ：无 detect 的纯编解码/花式 op —— 按字符集定义域(coarseAdmitPlain)预筛
 //    只在 depth 0 单层跑（不进 BFS，避免花式算法组合爆炸）。命中定义域才纳入。
 // requiresBridge（exe 桥）与 noAuto（想曰等重 op）排除：自动跑无意义又慢。
  const decoders = OPS.filter(
    (op) => typeof op.detect === "function" && typeof op.decode === "function"
      && !op.requiresBridge && !op.noAuto && !NO_MAGIC_OPS.has(op.id)
      && allowed(op.id)
  );
 // 无 detect 的**纯解码** op（radix/base 变体/花式衍生…），按定义域预筛后单层跑。
 // **只收 op.decode**（真解码器）——run-only 的 op 是哈希/分析/取证报告工具（md5/crc32/
 // hexView/xorAnalyze/stegosaurus 等），对任意输入都吐一段「报告文本」，其中文/英文说明
 // 会被 compositeScore 当有意义明文误判 99% 冒头污染结果。它们不是解码器，绝不进自动解码。
 // 排除：有 detect 的（走 decoders）、PARAM_SWEEP 白名单（走参数扫描）、
 // requiresBridge/noAuto、keyed 加解密 op（走 keyed-crypto 注入，需 key）。
  const plainOps = OPS.filter(
    (op) => typeof op.detect !== "function"
      && typeof op.decode === "function"
      && !op.requiresBridge && !op.noAuto && !NO_MAGIC_OPS.has(op.id)
      && !PARAM_SWEEP[op.id]
      && !KEYED_OPS.has(op.id)
      && allowed(op.id)
      && coarseAdmitPlain(op, f, !!o.lenient)
  );

 // MT3：参数网格扫描预算。白名单 op（caesar/affine/railFence 等无 detect 的经典密码）
 // 绕过 detect 要求直接扫描。只在 depth 0 跑（cur.text === input），网格按 input 长度
 // 动态截断。总组合数超 paramScanLimit 只扫 P0（防爆）。
  let sweepGrids = null;
  let paramScanList = [];
  if (o.paramScan) {
    sweepGrids = new Map();
    let totalCombos = 0;
    for (const opId of PARAM_SCAN_OP_IDS) {
      const op = getOp(opId);
      if (!op || typeof op.decode !== "function") continue;
      const grid = PARAM_SWEEP[opId](input);
      sweepGrids.set(opId, grid);
      totalCombos += grid.length;
    }
    paramScanList = totalCombos > o.paramScanLimit ? PARAM_SCAN_P0_IDS : PARAM_SCAN_OP_IDS;
  }

 /** @type {{chain:string[], result:string, confidence:number, score:number, matchesCrib:boolean}[]} */
  const results = [];
  const seen = new Set(); // 去重 key = chain.join(">") + "|" + result

 // BFS 双队列（bug2 修复）：可信节点(trusted)优先于投机节点(speculative)出队。
 // 根因——单 FIFO 队列里，depth0 的 intensive 暴力先入队 255 xor + 7 rot 共 262 个投机节点，
 // base64 等可信解码结果排在其后；每个投机节点出队都跑全套 ~160 decoders 吃 guard 预算，
 // 等轮到 base64 节点时 guard(50000) 早爆 → 「base64 > vigenere(key)」这条真链永远跑不到。
 // 双队列让 base64 及其可信后代先全部跑完（先解外层编码 → 再 keyed/古典），投机链后跑，
 // guard 预算优先喂给可信链。node.speculative 由 _record 计算（暴力 op 或已污染链）。
  const _trustedQ = [{ text: input, chain: [], conf: 1, lastOpId: null, depth: 0, speculative: false }];
  const _specQ = [];
  const queue = {
    push(node) { (node.speculative ? _specQ : _trustedQ).push(node); },
    shift() { return _trustedQ.length ? _trustedQ.shift() : _specQ.shift(); },
    get length() { return _trustedQ.length + _specQ.length; },
  };

  let guard = 0;
 // 硬墙钟死线（兜底上限）：无论迭代计数如何，超 o.timeBudget 毫秒无条件收尾返回已有候选。
 // 防病态输入无限跑；正常在软死线(5s)已回调部分结果，用户多半已看到解。
  const start = Date.now();
  const hardDeadline = start + o.timeBudget;
 // 软死线（看门狗 5s）：到点回调 onPartial(当前已得候选) 让 UI 先渲染「已得结果」，
 // 之后**不中断**继续跑（协作式让出主线程 = 等价后台线程），后续新解出的候选下轮回调补充。
 // 只回调一次（partialFired 防抖）——避免频繁重排 UI。
  const softDeadline = start + o.softDeadlineMs;
  let partialFired = false;
 // abort（新输入接管 / 用户强制中断）：signal.aborted 立即收尾，历史任务不再往下跑，
 // 不堆积、不崩溃。返回已得候选（调用方靠 token 决定是否丢弃）。
  const aborted = () => o.signal && o.signal.aborted;
 // 协作式让出：每处理 yieldEvery 个 op 让出一次宏任务，使浏览器能刷新倒计时 / 响应 abort /
 // 不冻结页面。node 里 setTimeout(0) 极快，几乎无开销。
  let sinceYield = 0;
  const maybeYield = async () => {
    if (++sinceYield >= o.yieldEvery) {
      sinceYield = 0;
      await new Promise((r) => setTimeout(r, 0));
    }
  };
 // 到软死线且未回调过 → 回调当前部分结果（先 finalize 一份快照给 UI）。
  const maybeFirePartial = () => {
    if (!partialFired && o.onPartial && Date.now() >= softDeadline) {
      partialFired = true;
      try { o.onPartial(finalizeResults(results, o)); } catch { /* 回调异常不影响主流程 */ }
    }
  };
 // 内层 op 循环的每轮心跳：让出主线程 + 软死线到点回调部分结果 + 检查中断。
 // **关键**：默认单层解码(maxDepth=1)队列只有 depth0 一个节点，全部 op 扫描都在**一次**
 // while 迭代的内层 for 循环里跑完；若只在 while 顶层 yield/firePartial，软死线到点时代码正
 // 卡在内层 op 扫描（每个浏览器专属图像/音频 op 耗满 700ms 超时），onPartial 直到整轮扫完才
 // 触发 → 用户看到「后台继续」却画面全空（恒烈实测「你好？」5s 后空白的根因）。故内层循环每
 // 轮都调此心跳：软死线一到立刻回调已得候选让 UI 先渲染，并周期让出使倒计时/中断生效。
 // 返回 true 表示已中断（新输入接管），调用方 break 收尾。
  // innerTick 额外检查硬死线：maxDepth=1 时全部 op 扫描都在内层 for 一次跑完，
  // 若只在 while 顶层查 deadline，timeBudget 形同虚设（实测 10KB base64 跑 52s）。
  const innerTick = async () => {
    await maybeYield();
    maybeFirePartial();
    if (Date.now() > hardDeadline) return true;  // 硬死线到 → 中断内层 op 扫描
    return aborted();
  };
  while (queue.length > 0) {
    if (guard++ > o.guard) break; // 兜底防爆（迭代计数）
    if (Date.now() > hardDeadline) break; // 兜底防爆（硬墙钟死线）
    if (aborted()) break;                 // 新输入接管 / 用户中断 → 立即收尾
    maybeFirePartial();                   // 软死线到 → 回调部分结果（继续跑）
    await maybeYield();                   // 周期让出主线程（倒计时能走 / abort 能收）
    const cur = queue.shift();
    if (cur.depth >= o.maxDepth) continue;

 // ---- intensive 暴力：只在 depth 0 跑（防组合爆炸，CTF 常见单层 XOR）----
    if (o.intensive && cur.depth === 0 && cur.text.length > 0) {
      const head = cur.text.slice(0, o.bruteBytes);
      const bytes = latin1Bytes(head); // latin1 取字节，保 byte identity
 // 暴力候选「有意义门」（恒烈需求：精简无意义 xor/rot 噪声）：
 // 255 个 xor key + 7 个 rot 里绝大多数产乱码，全 record 会污染候选列表、淹没真解。
 // 只保留「像明文 / 命中 crib / 含 flag 特征」的暴力结果，其余乱码直接丢弃（不 record）。
 // 判据宽松取并集，宁可多留几条也不漏真解：可打印率≥0.85 或 命中 crib 或 命中 flag 格式。
      const bruteWorth = (text) => {
        if (cribRe && cribRe.test(text)) return true;         // 命中目标特征，必留
        if (FLAG_FORMAT_RE.test(text)) return true;           // 含 xxx{...} flag 结构，必留
        return isPrintableRatio(text) >= 0.85;                // 高可打印率 = 像明文
      };
 // 1-byte XOR 全 255 key（lib:142-155）
      for (let key = 1; key <= 255; key++) {
        const xored = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) xored[i] = bytes[i] ^ key;
        const text = latin1Decode(xored);
        if (text === cur.text || text.length === 0) continue; // 自打转/空剪枝
        if (!bruteWorth(text)) continue;                      // 乱码门：不像明文即丢弃
        _record(text, cur, `xor:${key}`, 0.5, results, seen, cribRe, queue);
      }
 // 位旋转 1-7（lib:157-166）
      for (let rot = 1; rot <= 7; rot++) {
        const rotated = new Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          const b = bytes[i];
          rotated[i] = ((b << rot) | (b >> (8 - rot))) & 0xFF;
        }
        const text = latin1Decode(rotated);
        if (text === cur.text || text.length === 0) continue;
        if (!bruteWorth(text)) continue;                      // 乱码门：不像明文即丢弃
        _record(text, cur, `rot:${rot}`, 0.5, results, seen, cribRe, queue);
      }
    }

 // ---- MT3 参数网格扫描（白名单 op 绕过 detect）——depth≤1 的可信链上跑 ----
 // caesar/affine/railFence 等核心 CTF 密码无 detect，常规流程不碰；这里按 PARAM_SWEEP
 // 全参数网格跑 decode，用 compositeScore 筛选。chain id 形如 caesar(shift=3) 对齐
 // 同类工具 [解码N次] 明文 格式。候选只记录不入队（不再自产深层节点，防 BFS 组合爆炸）。
 // ⚠ 边界 `cur.depth<=1 && !cur.speculative`（不是只 depth0）：
 // - depth≤1 允许 2-op 链「base64(depth0→节点depth1) > caesar 网格」成立——base64 解出的
 //   密文再古典密码爆破是最常见 CTF 套路，caesar.detect 对乱序明文返回 0 进不了 decoders，
 //   只有 paramScan 全网格能解，故必须放到 depth1。
 // - 挡住 3-op 链：`base64>railFence>affine` 里 affine 网格是在 depth2 节点（railFence 的
 //   queued 输出）上跑的，depth≤1 直接排除 → 根除此前「三层组合凑 KEY/{} 乱码假阳性顶 99%」
 //   的 bug1 regression。
 // - !speculative 挡住 xor/rot 暴力产物再喂古典密码（投机链凑任意子串）。
    if (o.paramScan && sweepGrids && cur.depth <= 1 && !cur.speculative) {
      let scanOver = false;
      for (const opId of paramScanList) {
        if (scanOver) break;
        const op = getOp(opId);
        if (!op || typeof op.decode !== "function") continue;
        if (!allowed(opId)) continue;   // 强度档白名单外的不扫参数网格
        const grid = sweepGrids.get(opId);
        if (!grid || grid.length === 0) continue;
        for (const params of grid) {
          if (guard++ > o.guard) { scanOver = true; break; }
          if (await innerTick()) { scanOver = true; break; }  // 软死线回调 + 让出 + 中断
          let decoded;
          try {
            decoded = await decodeWithTimeout(op.decode, cur.text, params);
          } catch {
            continue;
          }
          if (decoded == null) continue;
          decoded = String(decoded);
          if (decoded.length === 0 || decoded === cur.text) continue;
          const tag = formatParamTag(opId, params);
 // queue 传 null：参数扫描候选不参与后续 BFS（防爆炸），靠 compositeScore 排序。
          _record(decoded, cur, tag, 0.5, results, seen, cribRe, null);
        }
      }
    }

 // ---- 无 detect 的纯编解码/花式 op 跑（需求1：花式算法也安排上）——只 depth 0 对原始输入跑 ----
 // 按定义域预筛后的 plainOps 各跑一次默认参数。候选不入队（自身不产深层节点，防组合爆炸）。
 // 花式/古典/文本 op 大多无 detect，此前完全不进 magic —— 现按字符集定义域纳入尝试。
 // ⚠ 只在 depth 0 跑：与 paramScan 同理，放开到中间层会与已入队的 detect-op 组合出三层
 // 乱码假阳性（bug1 regression）。中间层续接只保留 keyed（vigenere 需用户 key，是 bug2 真需求）。
    if (cur.depth === 0) {
      const admitPlain = plainOps;
      for (const op of admitPlain) {
        if (guard++ > o.guard) break;
        if (await innerTick()) break;  // 软死线回调 + 让出 + 中断
        const fn = op.decode || op.run;
        let decoded;
        try {
          decoded = await decodeWithTimeout(fn, cur.text, defaultParams(op));
        } catch {
          continue;   // 抛错 / 超时（永不 resolve 的图像/音频 op）→ 跳过，不阻塞其余
        }
        if (decoded == null) continue;
        decoded = String(decoded);
        if (decoded.length === 0 || decoded === cur.text) continue;
 // 花式 op 单层候选不入队（queue null），靠 compositeScore 排序。
        _record(decoded, cur, op.id, 0.5, results, seen, cribRe, null);
      }
    }

 // ---- 带密钥加解密尝试（需求3）：工具栏填了 key 才跑 ----
 // 对每个 keyed op 用 CTF 默认参数组（IV=0、常见模式/编码组合）跑 decode，产出候选。
 // 常用 op（AES 等）单个 key 不够 → keyedAttackParams 补全行业通用/CTF 常考默认参数一起试。
 // bug2 修复：不再限 depth 0——BFS 中间层节点也跑 keyed，使「base64 > vigenere(key)」这类
 // 「先解外层编码、再用密钥解古典/现代密码」的链成立（恒烈实测 base64+维吉尼亚只解出 base64
 // 就是因为 keyed 只对原始输入跑，接不到 base64 解出的中间结果上）。候选不入队（queue null）。
 // !cur.speculative：只在「可信解码链」（base64/base32 等有 detect 的 decoder 产物）上续接 keyed，
 // 不在暴力猜测链（xor:K/rot:R 产物）上跑——否则 xor 暴力串再喂 vigenere 会凑出海量假 flag 顶包。
    if (o.key && !cur.speculative) {
      for (const opId of KEYED_OP_IDS) {
        const op = getOp(opId);
        if (!op || typeof op.decode !== "function" || op.noAuto) continue;
        if (!allowed(opId)) continue;   // 强度档白名单外的不试带密钥解密
        const attempts = keyedAttackParams(opId, o.key);
        for (const { params, tag } of attempts) {
          if (guard++ > o.guard) break;
          if (await innerTick()) break;   // 软死线回调 + 让出 + 中断
          let decoded;
          try {
            decoded = await decodeWithTimeout(op.decode, cur.text, params);
          } catch {
            continue;
          }
          if (decoded == null) continue;
          decoded = String(decoded);
          if (decoded.length === 0 || decoded === cur.text) continue;
 // chain id 形如 aes(CBC,key:utf8,ct:base64)，与参数扫描候选同风格。
          _record(decoded, cur, `${opId}(${tag})`, 0.5, results, seen, cribRe, null);
        }
      }
    }

 // ---- 常规 op 尝试 ----
 // cur.text 已是完整 flag 结构时，跳过「明文样式变换 op」（leetSpeak/rot 等）——
 // 它们对成型 flag 只会劣化（如 Kn0w→Know、Ci$c0→Cisco），产出带 ctfshow{ 的假高分候选
 // 紧咬真解（type7 实测 #2 劣化版仅差真解 1.1 分）。已达 flag-strong 的解无需再变换。
    const curIsFlag = FLAG_STRONG_RE.test(cur.text);
    for (const op of decoders) {
      if (guard++ > o.guard) break;
      if (await innerTick()) break;   // 软死线回调 + 让出 + 中断
      if (curIsFlag && PLAINTEXT_STYLE_OPS.has(op.id)) continue;
      let score;
      try {
        score = op.detect(cur.text);
      } catch {
        continue;
      }
      // lenient（增强+/自定义档，恒烈 2026-08-03）：detect 未命中但输入字符种类数与
      // 该分类字符集大小匹配（如「喵呜」2 种字符 ≈ 二进制 2 字符表）→ 给低分兜底参与。
      // 只认「种类数」，不认具体字符——变体题（喵呜/emoji/自定义表）也能被尝试解码。
      if (o.lenient && (!score || score <= 0)) {
        const lim = { base: 64, radix: 16, classic: 26, modern: 128, text: 256 }[op.cat];
        if (lim !== undefined && f && f.nCharKinds <= lim) score = 0.15;  // f = inputFeatures(input)，381 行
      }
      if (!score || score <= 0) continue;

      let decoded;
      try {
        decoded = await decodeWithTimeout(op.decode, cur.text, defaultParams(op));
      } catch {
        continue;
      }
      if (decoded == null) continue;
      decoded = String(decoded);

 // 剪枝：空 / 无变化 / 自打转（同 op 且 output==input，lib:287）
      if (decoded.length === 0 || decoded === cur.text) continue;
 // 注：CyberChef 的 prevOp 同 op 检查被上方的 decoded===cur.text 覆盖（更强）
 // 这里不重复。保留 lastOpId 供未来扩展（如禁连用模式）。

 // 可选 outputCheck（op 声明输出正则/熵门控，lib:210-227）
      if (op.outputCheck && !outputCheckPasses(decoded, op.outputCheck)) continue;

      _record(decoded, cur, op.id, score, results, seen, cribRe, queue);
    }
  }

  return finalizeResults(results, o);
}

// 把累积的候选整理成最终返回数组：Occam 去重 + 排序 + 全列。
// 抽成独立函数供两处调用：① 软死线到点回调 onPartial（部分结果快照）② 主循环跑完最终返回。
// **纯函数、无副作用**：每次基于当前 results 快照重算，多次调用互不干扰（软死线调一次、结尾调一次）。
function finalizeResults(results, o) {
 // crib 软加权（原硬过滤改）：命中候选已由 compositeScore 的 score=-10000 绝对置顶
 // 这里不再删非命中候选，保证纯文本 / 无 flag 场景仍出正常候选——对齐同类实现
 // 「全部列出 + flag 高亮」而非「只留 flag」。UI 靠 matchesCrib 标记高亮。
  let filtered = results;

 // ---- 最小路径原则（需求5，奥卡姆剃刀）：同一解码结果若能由更短的链得到，
 // 只保留最短链，丢弃更长的等价链（如无必要不增实体，省空间且答案更简洁）。
 // 按 result 归组，每组保留 chain 最短的一条（同长度按综合分优先）；其余丢弃。
 // 参数扫描/keyed 候选 chain 长度均为 1，天然是最短链，不会被误删。
  const bestByResult = new Map();
  for (const c of filtered) {
    const prev = bestByResult.get(c.result);
    if (!prev
      || c.chain.length < prev.chain.length
      || (c.chain.length === prev.chain.length && c.score < prev.score)) {
      bestByResult.set(c.result, c);
    }
  }
  filtered = [...bestByResult.values()];

 // 综合分升序（分低=优）
  filtered.sort((a, b) => a.score - b.score);

 // 全列（恒烈需求）：有限可枚举的**单层候选**——参数扫描分支（caesar 25 位移 /
 // affine / rotSpecial…）、base 家族、单 op 解码——只要命中字符集定义域产出结果就**全部保留**，
 // UI 靠 groupSweepCands 折叠成分组卡展示（「命中字符类型家族即全列」，
 // 而非 CyberChef Magic 只给 top-N）。此前 slice(0,30) 把 caesar 25 位移和全部 op 挤在
 // 30 名额里 → 低分位移被切光只剩最优 1 条，正是「凯撒只显示概率最高那个」的根因。
 // maxCandidates 只裁剪**多层链式候选**（chain>1，组合爆炸源，需限量防刷屏）。
 // 安全上限 SINGLE_CAP 兜底防病态输入（affine 312 + base + 单 op 仍远低于此）。
  const SINGLE_CAP = 800;
  const singleLayer = filtered.filter((c) => c.chain.length <= 1).slice(0, SINGLE_CAP);
  const multiLayer = filtered.filter((c) => c.chain.length > 1).slice(0, o.maxCandidates);
  return [...singleLayer, ...multiLayer].sort((a, b) => a.score - b.score);
}

/**
 * 综合分 → 置信度（0.01~0.99）。compositeScore 越低越像正解 → confidence 越高。
 * sigmoid 平滑映射：score≈0→0.5，负分（可打印/低卡方/crib 命中）趋近 1
 * 正分（乱码/高熵）趋近 0。
 *
 * 修「爆破结果置信度虚高」（4②）：原 confidence = cur.conf * detectScore
 * sweep/intensive 分支 detectScore 硬编码 0.5 → 几十条 caesar/rotSpecial 爆破分支
 * confidence 齐刷刷 50% 与解质量无关，正解与乱码分不开。改由 compositeScore 归一化后
 * 乱码分支（高卡方/高熵）自然落低区，正解（低分）冒头，置信度真实反映解质量。
 * @private
 */
function scoreToConfidence(score) {
 // 新量纲（log 压缩后）：正解约 60~95、可打印乱码 100~130、不可打印/高熵 >140。
 // sigmoid 以 105 为中心、30 为斜率 → 正解落 70~90%，乱码落 10~40%，拉开区分度。
  const conf = 1 / (1 + Math.exp((score - 105) / 30));
  return Math.max(0.01, Math.min(0.99, conf));
}

/**
 * 记录候选 + 入队（内部 helper）。
 * detectScore 保留于签名（调用方语义：detect 分/爆破占位 0.5），confidence 已改由
 * compositeScore 归一化，不再用它做乘积。
 * @private
 */
function _record(text, cur, opId, detectScore, results, seen, cribRe, queue) {
  const newChain = [...cur.chain, opId];
  const matchesCrib = cribRe ? cribRe.test(text) : false;

  const key = newChain.join(">") + "|" + text;
  if (seen.has(key)) return;
  seen.add(key);

  const score = compositeScore(text, newChain.length, matchesCrib, newChain);
  const confidence = scoreToConfidence(score);
  results.push({ chain: newChain, result: text, confidence, score, matchesCrib });

 // queue 可为 null：参数扫描候选只记录不入队（防 BFS 二层组合爆炸）。
 // queue.conf 保留但已非 confidence 来源（confidence 由 score 归一化），供未来扩展。
 // speculative 传播（bug2 regression 修复）：暴力猜测 op（xor:K / rot:R，intensive 产物）
 // 入队的节点标 speculative——它是「猜的」不是「解开的」。speculative 节点后续不再跑
 // keyed/paramScan/plainOps（否则 xor 暴力产物再喂古典密码能凑出任意含 "key{"/"CTF" 的假
 // 阳性顶到 99%）。可信解码链（base64 等 detect decoder）非 speculative，可续接 vigenere。
  if (queue) {
    const speculative = cur.speculative || /^(xor:|rot:)/.test(opId);
    queue.push({ text, chain: newChain, conf: confidence, lastOpId: opId, depth: cur.depth + 1, speculative });
  }
}

export default { magicDecode };
