/*
 * core/magic/magicWorker.js — 一键解码真多线程 Worker（产品裁决：真多线程看门狗）
 *
 * 模块 Worker（type:"module"）：不再 eager 导入完整算法注册表 registerAll（539 文件/10MB/
 * 约 1s/55MB），改为按 magic 候选清单动态 import 源文件——首次 run 只加载参与自动解码的
 * 153 个文件（325 个候选 op），候选集合/评分顺序与改动前 Worker eager 结果逐项一致。
 *
 * 加载序（必须与 registerAll 一致，否则 detect 补丁时序会改变候选集）：
 *   ① 候选 op 第一批 → import detectExt/detectExt2 → ② 第二批 →
 *   import detectExt3/detectSupplement → ③ 第三批。
 * file→op 映射与批次表由当前 registerAll eager 快照生成；新增/删除 op 后需同步刷新
 * MAGIC_OPS_P1/P2/P3，否则新 op 不会进 Worker 自动候选（旧 op 移除会走错误→主线程降级）。
 *
 * 协议（主线程 magicClient.js ↔ 本 Worker）：
 *   主 → Worker： { type:"run", runId, input, opts }
 *                 { type:"pause",  runId }            协作式暂停（yield 点生效）
 *                 { type:"resume", runId }            继续
 *   Worker → 主： { type:"partial",  runId, cands }   流式部分结果（节流增量）
 *                 { type:"progress", runId, phase, done, total, opId, label, percent }
 *                 { type:"final",    runId, cands }   跑完的最终结果
 *                 { type:"error",    runId, message } 解码异常
 *                 { type:"ready" }                    Worker 基础模块加载完成（候选 op 首次 run 惰载）
 *
 * 向后兼容：旧客户端只发 run、只认 partial/final/error/ready；新增 pause/resume/progress
 * 只增不改，旧消息语义不变。
 *
 * 中断/接管：主线程直接 worker.terminate() 硬杀本线程 + 重建（毫秒级），
 * 历史任务立即消失、不堆积、不占 CPU——比协作式 abort 更干净彻底。
 * runId 兜底：万一旧消息在 terminate 前漏网，主线程按 runId 丢弃过期结果。
 *
 * ⚠ Worker 内无 DOM：少数图像/音频 op（spectrogram/pixelJihad/canvasDecode…）被调到时
 * 会因缺 document/Image 抛错——magic.js 的 decodeWithTimeout+try/catch 已兜住并跳过，
 * 不影响其余 op（已核实无 op 在模块顶层访问 DOM，故按需加载不会崩）。
 */
import { OP_FILE_MAP } from "../lazyTables.generated.js";
import { getOp } from "../registry.js";
import { magicDecode } from "./magic.js";

// ============ magic 候选 op 清单（按 registerAll 注册序、detect 补丁时序分三批） ============
// 生成口径：eager registerAll 下 OPS 中满足 magic 两类候选过滤（detect+decode / 无 detect 的
// 纯 decode）以及 PARAM_SWEEP、KEYED_OP_IDS 的 op；批次边界=registerAll 中 detectExt/2 与
// detectExt3/detectSupplement 的导入位置。保持此顺序即可复现 eager 的 detect 集合与候选排序。
const MAGIC_OPS_P1 = ["base16", "base32", "base36", "base45", "base58", "base62", "base64", "base85", "base91", "base92", "base100", "radixN", "baseCustom", "base58check", "radix64", "base69", "z85", "base85ipv6", "base2048", "base65536", "ecoji", "base64steg", "base32steg", "base64dict", "multilineBase64", "base64decompress", "htmlEntity", "unicodeEscape", "quotedPrintable", "uuencode", "utf7", "punycode", "hexReverse", "natoAlphabet", "scoutStick", "morse", "bacon", "yunying", "railFence", "caesar", "rot13", "rot5", "rot18", "rot47", "atbash", "a1z26", "dna", "keyboard", "brainfuck", "ook", "cetacean", "yygq", "braille", "eightdiagram", "pawnshop", "aaencode", "baudot", "type7", "decabit", "scytale", "aes", "des", "des3", "rc4", "xor", "fernet", "txtmoji", "shiftKey", "vigenere", "gronsfeld", "beaufort", "autokey", "porta", "playfair", "nihilist", "columnar", "hill", "affine", "bifid", "trifid", "polybius", "adfgx", "adfgvx", "foursquare", "graycode", "trithemius", "jefferson", "amsco", "ragbaby", "trilitere", "skipCipher", "vic", "phillips", "bellaso", "slidefair", "collon", "dancingMen", "zodiac", "threeSquare", "monomeBinome", "kuznyechik", "iban", "mirrorLetters", "mayaNumerals", "babylonianNumerals", "egyptianNumerals", "hieroglyphs", "sga", "occult", "marineFlags", "radixConvert", "asciiRadix", "ieee754", "bcd", "binPad", "hybridCode", "asciiOffset", "completion", "negabase", "balancedTernary", "factorialBase", "zeckendorf", "roman", "chineseNum", "continuedFraction", "sternBrocot", "stemBranch", "baiJiaXing", "element", "foyu", "wubi", "cnTelegraph", "zhengma", "fourCorner", "cangjie", "sm4", "salsa20", "chacha20", "noekeon", "shacal2", "cast6", "blowfish", "zeroWidth", "zeroChar", "zwTags", "zwVarSel", "emojiSubst", "tadpole", "textBlindWatermark", "qrDecode"];

const MAGIC_OPS_P2 = ["shzyhxjzg", "makkaPakka", "yuanYin", "columnReplace", "rowsReplace", "jwt", "jwtNone", "b64urlJson", "camellia", "seed", "ipv4Int", "ipv6Format", "macFormat", "unixTime", "filetime", "hfsTime", "cocoaTime", "dosDateTime", "chineseDate", "americanMorse", "cnTelegraphMorse", "tapCode", "semaphore", "morseRhythm", "whitespace", "pigpen", "keyboardShift", "xianziCode", "hajimiCode", "zakoCode", "zakoMystery", "rabbit", "godzillaPhpXorBase64", "behinderAesEcb", "layoutMap", "t9Phone", "stenoLetter", "arrowKey", "rsaModinv", "gb2312QuWei", "mojibakeFix", "geoDms", "geoHash", "geoPlusCode", "geoMaidenhead", "geoUtm", "color", "musicNotation", "bitReverse", "bitRotate", "byteArith", "httpBasicAuth", "julianDate", "excelDate", "chromeTime", "deadfish", "otp", "keywordcipher", "simplesub", "runningkey", "homophonic", "doubleTrans", "pollux", "morbit", "bookCipher", "turningGrille", "kenny", "modhex", "citrixCtx1", "rison", "crockford32", "alienAlphabet", "futhark", "countingRods", "chuckUnary", "wingdings", "cardanGrille", "elias", "fracmorse", "hammingCode", "snow", "bazeries", "fenham", "pizzini", "kamasutra", "suiYanSuiYu", "fuyouyue", "tianshu", "xiongyue", "huoxingwen", "jianfan", "qqxiuzi_arrow", "qqxiuzi_flower", "qqxiuzi_ipa", "qqxiuzi_letter", "qqxiuzi_braille", "qqxiuzi_chinese", "qqxiuzi_music", "lolcode", "enigma", "m209", "typex", "sigaba", "lorenz", "bwt", "clockCipher", "varint", "lzstring", "rotSpecial", "rot8000", "spoon", "goldbug", "acrostic", "everyN", "caseBitStego", "nthChar", "wordSpacingBits", "fullwidth", "routeCipher", "carbonaro", "albam", "blub", "cow", "twinHex", "trollScript", "asciiSum", "caesarBox", "curveCipher", "chaocipher", "straddleCheckerboard", "nihilistCipher", "solitaire", "ls47", "alberti", "wabun", "gematria", "foursquarekw", "twosquare", "rc2", "steghide", "astroSymbols", "pipNumerals", "elgamal", "emojiAes", "moyue", "huffmanCodec", "simonSpeck", "shamir", "jsEscape", "ppencode", "mimeMultipart", "roar", "a51", "a52", "e0", "hc128", "hc256", "sosemanuk", "spritz", "vmpc", "mickey", "rabin", "magma", "present", "serpent", "aria", "threefish", "skipjack", "mars", "dxBase64", "yueChang", "beaufortVariant", "redefence", "xoodyakAead"];

const MAGIC_OPS_P3 = ["enigmaCC"];

// ============ 按需加载器（去重 + 失败可重试） ============
const _loadedFiles = new Set();          // 已成功求值的源文件
const _loadingFiles = new Map();         // file → Promise（并发/重复请求去重）

function loadFile(file) {
  if (_loadedFiles.has(file)) return Promise.resolve();
  if (_loadingFiles.has(file)) return _loadingFiles.get(file);
  const p = import(new URL("../" + file.slice(2), import.meta.url).href)
    .then(() => { _loadedFiles.add(file); })
    .catch((err) => { _loadingFiles.delete(file); throw err; });
  _loadingFiles.set(file, p);
  return p;
}

// magic.js 的可注入钩子：评估候选前确保该 op 的源文件已注册（已加载直接命中缓存）。
async function ensureMagicOpLoaded(opId) {
  const op = getOp(opId);
  if (op && !op.__stub) return true;
  const file = OP_FILE_MAP[opId];
  if (!file) return false;
  await loadFile(file);
  const live = getOp(opId);
  return !!(live && !live.__stub);
}

async function ensureMagicOps(ids) {
  for (const id of ids) await ensureMagicOpLoaded(id);
}

// 首次 run 惰载全部候选 op；缓存 Promise，后续 run 零成本。
let _magicReady = null;
function ensureMagicRegistry() {
  if (!_magicReady) {
    _magicReady = (async () => {
      await ensureMagicOps(MAGIC_OPS_P1);
      await import("../detectExt.js");
      await import("../detectExt2.js");
      await ensureMagicOps(MAGIC_OPS_P2);
      await import("../detectExt3.js");
      await import("../detectSupplement.js");
      await ensureMagicOps(MAGIC_OPS_P3);
    })().catch((err) => {
      _magicReady = null;               // 失败下次 run 重试（与 lazyCore 语义一致）
      throw err;
    });
  }
  return _magicReady;
}

// 当前在途运行的暂停控制对象。pause/resume 消息只改其 paused 布尔，magicDecode 在
// yield 点轮询（定时器让出，非忙等）；暂停期间 done/progress 不推进。
let active = null;   // { runId, control:{paused} }

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "pause" || msg.type === "resume") {
    if (active && (msg.runId == null || msg.runId === active.runId)) {
      active.control.paused = msg.type === "pause";
    }
    return;
  }
  if (msg.type !== "run") return;
  const { runId, input, opts } = msg;
  const control = { paused: false };
  active = { runId, control };
  try {
    await ensureMagicRegistry();       // 候选 op 全部注册后再评估 detect/decode
    const cands = await magicDecode(input, {
      ...opts,
  // 惰载钩子：若 OPS 中还有 stub（例如未来新增 op 未列入候选清单）可在评估前补齐。
      ensureMagicOpLoaded,
  // Worker 里不需要 signal（中断=主线程 terminate），但 onPartial 仍有用：
  // 流式 partial（按候选数节流，不依赖墙钟）与 progress 都 postMessage 回主线程渲染，
  // 用户不必干等全部跑完；后台标签页节流不会减少最终候选。
      signal: null,
      _control: control,
      onPartial: (parts) => {
        try { self.postMessage({ type: "partial", runId, cands: parts }); }
        catch { /* 结构化克隆失败不阻塞 */ }
      },
      onProgress: (p) => {
        try {
          self.postMessage({
            type: "progress", runId,
            phase: p.phase, done: p.done, total: p.total,
            opId: p.opId, label: p.label, percent: p.percent,
          });
        } catch { /* 结构化克隆失败不阻塞 */ }
      },
    });
    self.postMessage({ type: "final", runId, cands });
  } catch (err) {
    self.postMessage({ type: "error", runId, message: (err && err.message) || String(err) });
  } finally {
    if (active && active.runId === runId) active = null;
  }
};

// 握手：基础模块已加载，通知主线程 Worker 就绪（候选 op 在首次 run 时按需加载）。
self.postMessage({ type: "ready" });
