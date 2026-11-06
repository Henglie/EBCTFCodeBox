/*
 * explicitRun.js — 重运算 op 的「显式触发」声明位（纯数据 + 判定，零 UI 依赖）。
 *
 * 解决什么：工具页参数框每敲一键都会自动跑一次 convert()（renderParam 的 input 监听）。
 * 轻运算无所谓；素数生成/分解、爆破、大空间穷举、密钥生成这类 op 每次执行都是秒级到
 * 分钟级的同步计算，逐键自动重跑 = 逐键冻结主线程。本模块把这些 op 列入显式触发白名单：
 * 自动路径（参数框逐键等）遇到它们不自动跑，输出区给「点击运行」占位提示；只有用户点
 * 「转换 / 解码」按钮（或 Ctrl+Enter）才真正执行。
 *
 * 口径（Node 22 同步实测初筛，浏览器同引擎同量级；档内最大参数为界）：
 *   默认参数即 ≥1s：dsaParamGen 2048/256（54.8s）、rsaGenKeyPair 2048（23.0s）、
 *     elgamalKeyGen 512（37.4s）/ 256 默认（2.4s）、hashDictCrack md5 numeric 10^6 默认（3.4s）、
 *     getAllCasings 20 字母（2.1s）、primeGen 1024（1.6s）、des2Mitm 16 位（1.5s）、
 *     playfairCrack 默认 9000 迭代（1.2s）
 *   默认快、调参即重：primeGen 1024×count=10（20.0s，上限 100 约 200s）、
 *     hashDictCrack md5 numeric 10^8（md5/ntlm 路径无中止上限，约 356s），
 *     crc32Collision alnum 1..5（3.8s）、primeFactor 平衡半素数 1e9（6.4s）、
 *     primeTest 大 n×多轮、paillierKeyGen 大位宽、pbkdf2 高迭代（10^6=124ms 线性放大）
 *   实现自述重活：bkcrackAttack（数秒~几十分钟）、zipBrute AES 条目（逐口令 PBKDF2，极慢）、
 *     pbeAesBrute / hmacKeyBrute（字典×派生）、qrFormatBrute（32 组 RS 爆破，已 noAuto）、
 *     xiangyue / xiangyueEnc（Argon2id 64MiB 派生，已 noAuto）、adsTool（已 noAuto）
 *   xorBrute / caesarBrute / zipCrc32Brute / crc32Collision 小参数档实测毫秒级，不拦逐键；
 *     但它们是爆破池成员，长任务统一走 opRunClient（Worker 通道），见接线文档。
 *
 * ⚠ 已标 noAuto 的 op 只豁免「一键解码自动池」，工具页参数框仍会逐键自动跑，同样要拦。
 *
 * 红线：core 层零 UI / i18n / main 依赖；本模块只做声明与判定，拦截动作在 main 侧接线。
 */

/**
 * 显式触发 op 白名单（id 清单）。判断用 isExplicitRunOp()，勿直接 indexOf（留扩展位）。
 */
export const EXPLICIT_RUN_OPS = [
  // radix 进制/字符集：素数与大数
  "primeGen", "primeTest", "primeFactor", "bigCalc", "primeInspector",
  // forensic：流量可读结论（大 pcap 轨迹图编码秒级起步，走 Worker 通道）
  "trafficReadable",
  // analysis：全排列 / 爬山破解
  "getAllCasings", "playfairCrack", "subCipherSolver",
  // crypto/hash：字典爆破与高迭代派生
  "hashDictCrack", "hmacKeyBrute", "pbeAesBrute", "pbkdf2",
  // block：2DES 中间相遇（keyBits 20 位实测 23s）
  "des2Mitm",
  // crack：归档/口令/碰撞
  "zipBrute", "zipCrc32Brute", "crc32Collision", "bkcrackAttack",
  // analysis：KNN 训练集可达百万行，避免改参数时自动重跑
  "knnClassify",
  // asym：纯 JS 素数搜索型密钥生成
  "rsaGenKeyPair", "elgamalKeyGen", "dsaParamGen", "paillierKeyGen", "falconKeyGen",
  // asym：KZG/EIP-4844（4096 点 MSM，blob 大输入逐键自动跑会冻结主线程）
  "kzgCommit", "kzgVerify",
  // 历史密码机重 op：Bombe/MultipleBombe/Colossus 走 Worker + 显式触发
  "bombe", "multipleBombe", "colossus",
  "lzma", "tar", "ocr",
  // PGP 全家：涉及私钥/口令且耗时，禁止边输边跑
  "pgpGenKeyPair", "pgpEncrypt", "pgpDecrypt", "pgpSign", "pgpVerify",
  "pgpEncryptAndSign", "pgpDecryptAndVerify", "pgpParseKey",
  // 作者已标注 noAuto 的重 op（工具页同样要显式触发）
  "qrFormatBrute", "xiangyue", "xiangyueEnc", "adsTool",
  // ---- v0.1.14 全 op 审计补录（判定依据与实测见审计记录）----
  // KDF（内存硬化，默认快、调参即重；与既有 pbkdf2 同口径）：argon2 默认档实测 2.7s，
  //   scrypt 0.49s / yescrypt 0.60s / balloon 0.16s / bcrypt 0.11s / lyra2 0.03s；
  //   N / 内存 / 轮数一调即秒级，禁止参数框逐键自动跑。
  "argon2", "scrypt", "yescrypt", "lyra2", "balloon", "bcrypt",
  // asym：大结构密钥生成（XMSS 建树默认 >8s 超时；SLH-DSA 超树默认 ~1s）
  "xmssKeyGen", "slhdsaKeyGen",
  // crypto：格基 / 预言机 / 分解类重分析（参数给足后秒级到分钟级；LLL / Boneh-Durfee 尤重）
  "lllAttack", "rsaBonehDurfee", "rsaCoppersmith", "rsaLsbOracle",
  "rsaBleichenbacher", "rsaPollard", "rsaPollardPm1",
  // modern：离散对数 BSGS（表随参数膨胀）
  "dlp",
  // modern：JWT 字典爆破
  "jwtCrack",
  // 重型 WASM / 文件隐写引擎（改口令/密钥即整档重算；steghide/outguess 为 WASM 引擎）
  "steghide", "outguess", "f5stego", "sevenZipExtract",
  // CyberChef 引擎级：jq asm.js 1.75MB / YARA wasm 1.18MB / Capstone 1.78MB，首次加载与改参都重
  "jqQuery", "yaraScan", "disasmArm", "disasmX86",
  // 长耗时分析：LSB 全组合扫描 / 图像 FFT / 立体图解（整图重算）
  "zstegScan", "stereogramSolver", "spectrogram", "imgFft",
];

/** 某 op 是否显式触发（自动路径不跑，等用户点击）。 */
export function isExplicitRunOp(id) {
  return EXPLICIT_RUN_OPS.includes(id);
}

/**
 * 惰执行 op（图像 canvas 重算系）：拖入/参数改动等**自动路径一律不跑**，
 * 等用户点「转换」才执行（恒烈 2026-10-12：「拖进去不直接执行？点击按钮才执行」）。
 * 与 EXPLICIT_RUN_OPS 的差异：这批是 encode 型（无 run），不走 Worker 通道，
 * 拦截点在 main 的 triggerConvert 与 convert("param")——点按钮的显式路径照常执行。
 */
export const LAZY_RUN_OPS = [
  "imageCompress", "imageGray", "imagePixelate", "imageFrosted",
  "imageSketch", "imageToText", "spriteSheet",
];

/** 某 op 是否惰执行（拖入/参数改动不自动跑，点按钮才执行）。 */
export function isLazyRunOp(id) {
  return LAZY_RUN_OPS.includes(id);
}

/** 惰执行 op 自动路径被拦截时输出区显示的占位文案。 */
export function lazyRunHint(name) {
  return `【${name}】已就绪，未自动执行。\n点击下方「转换」按钮即开始处理。`;
}

/**
 * 自动路径被拦截时输出区显示的占位文案。
 * 默认中文兜底；开发方接线时可挪进 i18n（建议键 ui.crypto.explicitHint，带 opName 插值）。
 * @param {string} name op 显示名
 */
export function explicitRunHint(name) {
  return `【${name}】运算量大，已暂停自动运行。\n请点击下方「转换 / 解码」按钮（或 Ctrl+Enter）手动运行。\n点击前修改参数不会重复计算。`;
}

/** 插件声明 autoRun:false 时的提示：参数可先改完，再显式运行。 */
export function manualRunHint(name) {
  return `【${name}】已关闭边输边算。\n参数修改不会触发运算；点下方「转换 / 解码」按钮或 Ctrl+Enter 运行。`;
}
