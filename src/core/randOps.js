/*
 * randOps.js — 「消耗随机性」的 op 白名单（零 DOM / 零副作用 / 可 Node 直测）。
 *
 * 用途：UI 只对这些 op 显示【增强随机性】开关。其余 op（Base64 / 摩斯 / 哈希 / 纯
 * 编码等）根本不取随机字节，开关挂上去是纯噪音，也会破坏「开关=随机源控制」的语义。
 *
 * 判据（本清单的唯一依据 = 实测，不靠命名/直觉）：
 *   ① 该 op 的算法路径最终调用 randSource.randomBytes（统一随机源），且
 *   ② 调用发生在「生成随机值」的语义下（密钥 / nonce / IV / salt / 随机填充等）。
 *   验证方法（可复跑）：工具/_rand_ops_audit.mjs —— 给 crypto.getRandomValues 打桩，
 *   真跑每个 op 看是否命中；对「需密钥而早退」的 sign/encrypt 类，用静态调用点补判
 *   （见该工具输出的 two-pass 证据）。
 *
 * ⚠ 维护：新增任何「会取随机字节」的 op（密钥生成 / 签名 / 加密 / 加盐 / 随机数），
 *   必须把它的 id 加进来，否则用户拿不到增强随机性开关。改动后跑
 *   `node 工具/_rand_ops_audit.mjs` 复核清单与实际调用点一致。
 *
 * ⚠ 已知未纳入：vendored 第三方库内部随机（openpgp.js / sjcl.js / abracadabra-cn）——
 *   见文末 `RAND_OPS_EXTERNAL`：不显示开关，改为**在参数区告知用户「为什么没有」**。
 *   恒烈 2026-10-11 裁定：**不管**（改库会破坏 vendored 1:1 互解性质）。
 */

/** 消耗随机性的 op id 集合（冻结，防运行期误改）。 */
export const RAND_OPS = Object.freeze(new Set([
  // —— 现代密码·非对称：密钥生成 / 参数生成 ——
  "blsKeyGen", "dsaParamGen", "ecdsaKeyGen", "ed25519KeyGen", "x448KeyGen",
  "elgamalKeyGen", "hqcKeyGen", "mldsaKeyGen", "mlkemKeyGen", "ntruKeyGen", "paillierKeyGen",
  "primeGen", "schnorrKeyGen", "slhdsaKeyGen", "sm2KeyGen", "x25519KeyGen",
  "xmssKeyGen", "xwingKeyGen",
  // —— 现代密码·非对称：签名 / 加密 / 封装 / 交换（含随机 nonce、salt、IV）——
  "dsaSign", "ecdsaSign", "ed448Sign", "gostSign", "mldsaSign", "rsaSign",
  "schnorrSign", "slhdsaSign", "sm2Sign", "sm2Encrypt", "sm2KeyExchange",
  "hqcEncrypt", "mlkemEncaps", "ntruEncrypt", "paillierEncrypt", "xwingEncaps",
  "x25519Shared", "lsagSign", "pedersenCommit", "feldmanVss", "jweEncrypt",
  // —— 分组 / 流密码与对称封装（随机 IV / salt）——
  "ascon", "fernet", "emojiAes", "yueChang", "dxBase64", "rabbit",
  // —— 口令 / 派生 / 隐写 / 共享（随机 salt / 系数）——
  "bcrypt", "shamir", "stegpy", "txtmoji", "fuyouyue", "tianshu",
  // —— 随机数工具本体 ——
  "randomSeed",
  // —— 自研 / 复古编码 / 分析工具中带随机成分（2026-10-11 已统一接入 randSource）——
  "elgamal", "knapsack", "xiangyueEnc", "foyu", "bigCalc", "bb84Qkd", "primeInspector",
]));

/**
 * 该 op 是否消耗随机性（据此决定是否显示增强随机性开关）。
 * @param {string} opId
 * @returns {boolean}
 */
export function opUsesRandom(opId) {
  return RAND_OPS.has(String(opId));
}

/**
 * 豁免集：确实消耗随机性、但**有意不显示**增强随机性开关的 op。
 *   - randomSecure：它就是「增强随机安全」本体，自带档位选择参数；再挂开关会重复且互相打架。
 */
export const RAND_OPS_EXEMPT = Object.freeze(new Set(["randomSecure"]));

/**
 * 「随机在**内置第三方库**内部生成、不受本工具控制」的 op → 库名。
 * 这些 op 不经过 randSource，开关挂上去也管不了，故不显示开关；改为在参数区显示一行说明，
 * **明确告诉用户为什么没有这个开关**（恒烈 2026-10-11 指令：「忽略这一块，然后告诉用户为什么没有」）。
 *
 * 实测口径（2026-10-11，给 crypto.getRandomValues 打桩真跑 op）：
 *   pgpGenKeyPair / pgpEncrypt / pgpEncryptAndSign → hits 2 / 3 / 3（确实取原生随机）；
 *   pgpSign → hits 0（EdDSA 确定性签名，**故不列入**）；
 *   pixelJihad → 走 SJCL 内置 PRNG（模块加载期从系统熵播种一次，之后每次加密不再取原生随机）；
 *   moyue → 输出两次不同但 hits 0（abracadabra-cn 库内自有随机）。
 * 处置：改库=破坏「vendored 1:1 互解」性质，恒烈裁定**不管**（仅需告知用户）。
 */
export const RAND_OPS_EXTERNAL = Object.freeze(new Map([
  ["pgpGenKeyPair", "OpenPGP.js"],
  ["pgpEncrypt", "OpenPGP.js"],
  ["pgpEncryptAndSign", "OpenPGP.js"],
  ["pixelJihad", "SJCL"],
  ["moyue", "Abracadabra"],
]));

/** 该 op 的随机是否来自内置第三方库（据此显示「为何没有开关」的说明）。 */
export function opExternalRand(opId) {
  return RAND_OPS_EXTERNAL.has(String(opId));
}

/** 取该 op 随机来源的库名（无则空串）。 */
export function externalRandLib(opId) {
  return RAND_OPS_EXTERNAL.get(String(opId)) || "";
}
