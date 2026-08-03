/*
 * eduContent.js — 科普卡数据汇总入口（各分类数据分片在 eduContent.part-*.js）。
 *
 * 每个 op 在其操作页「输出框下方」显示一张科普卡：这是什么 / 原理 / 怎么用 / 示例 /
 * （可选）公式与小贴士。面向大一大二学生，通俗但准确，实事求是。
 *
 * ============ 数据格式（扩展模块照此写，单一契约） ============
 * 每个分片文件 export default 一个对象：{ [opId]: EduEntry }。
 * EduEntry 字段（全部可选，但 what/principle/examples 尽量都给）：
 *
 * what: string 一句话「这是什么」。通俗、口语化，别堆术语。
 * principle: string 原理/怎么工作。可多段（用 "\n\n" 分段）。
 * 行内数学公式用 $...$ 包裹（KaTeX 语法），如 "满足 $a x + b \\pmod{26}$"。
 * 行内代码/字面量用 `...`（反引号，会渲染成等宽小块）。
 * usage: string 怎么用「本工具这个功能」。操作步骤/参数含义/方向说明。
 * examples: Array<{ in:string, param?:string, out:string, desc?:string }>
 * 至少给一个能跑通的例子。in=输入，out=输出，param=参数(可选)，desc=旁注(可选)。
 * formulas: Array<{ tex:string, caption?:string }> 可选。独立居中的 display 公式 + 说明。
 * tips: string[] 可选。CTF 实战小贴士/易错点/怎么一眼认出它。
 * aka: string[] 可选。别名/俗称/英文名（也会喂给搜索的别名索引）。
 *
 * ============ 约束（机制四低耦合红线） ============
 * - 分片文件是纯数据，无 import、无副作用、无 register。
 * - 只填 registry 里真实存在的 opId，宁缺毋滥。
 * - LaTeX 尽量简洁，能用行内 $...$ 说清就不用 display；全字库生僻字仅必要时用。
 * - 反斜杠在 JS 字符串里要转义：TeX 的 \bmod 写成 "\\bmod"。
 * - 语气通俗不严肃，但内容实事求是，不编造不存在的性质。
 */

import EDU_BASE_TEXT from "./eduContent.part-base.js";       // base + text + radix 家族
import EDU_CLASSIC from "./eduContent.part-classic.js";      // fancy + classic + cn 古典/花式/中文
import EDU_CRYPTO from "./eduContent.part-crypto.js";        // modern + hash + analysis(RSA/爆破)
import EDU_MISC from "./eduContent.part-misc.js";            // stego + analysis(信号/网络/时间/几何/颜色)
// ---- 扩展模块增量分片（gen-*，各自独占文件，缺失时用可选兜底避免整站崩） ----
import EDU_GEN_TEXT from "./eduContent.gen-text.js";         // text 补全 25 项
import EDU_GEN_FANCY from "./eduContent.gen-fancy.js";       // fancy 补全 36 项
// ---- 30 卡科普分片（src/core/edu/，各代理独占文件） ----
import EDU_BASE1 from "./edu/edu-base1.js";                  // base 补全 12
import EDU_BASE2 from "./edu/edu-base2.js";                  // base 补全 12
import EDU_CLASSIC1 from "./edu/edu-classic1.js";            // classic 补全 8
import EDU_CLASSIC2 from "./edu/edu-classic2.js";            // classic 补全 8
import EDU_FANCY_CN from "./edu/edu-fancy-cn.js";            // fancy+cn 补全 9
import EDU_HASH1 from "./edu/edu-hash1.js";                  // hash 补全 11
import EDU_HASH2 from "./edu/edu-hash2.js";                  // hash 补全 11
import EDU_HASH3 from "./edu/edu-hash3.js";                  // hash 补全 10
import EDU_MODERN1 from "./edu/edu-modern1.js";              // modern 补全 8
import EDU_MODERN2 from "./edu/edu-modern2.js";              // modern 补全 8
// ---- radix/analysis/stego 分片归并（换平台后补，此前 18+ 个孤儿从未 import） ----
// 注：edu-radix-numtheory / edu-radix-time2 opId 已被 num/math/time 完全覆盖，冗余不引；edu-stego-rest 为空对象不引。
// ---- 已知故意跳过的冗余 edu 分片（opId 已被现引分片 100% 覆盖，强行归并只会用未审校版盖掉手写样板，零收益纯降质，故不 import）----
// 注：edu-ana-rsa-attack.js — rsaSmallE/rsaCommonModulus/rsaWiener/rsaFermat/rsaCrt(5) opId 全被 part-crypto 覆盖，冗余不引。
// 注：edu-base-rest.js — base16/32/58/62/64/85/91/64url(8) opId 全被 part-base 覆盖，冗余不引。
// 注：edu-cn-rest.js — pawnshop/foyu/shzyhxjzg(3) opId 全被 part-classic 覆盖，冗余不引。
// 注：edu-hash-rest.js — md5/sha1/sha256/sha512/hmac/ntlm(6) opId 全被 part-crypto 覆盖，冗余不引。
// 注：edu-stego-rest2.js — zeroWidth/lsbImage/pngHeight/exifExtract/zwScan(5) opId 全被 part-misc 覆盖，冗余不引。
// 注：edu-text-rest.js — url/htmlEntity/unicodeEscape/quotedPrintable/…jsfuck/uuencode/magnetParse 等 31 项 opId 全被 part-base(5)+part-classic(1)+gen-text(25) 覆盖，冗余不引。
import EDU_ANA_FREQ from "./edu/edu-ana-freq.js";            // analysis 频率/统计 16
import EDU_ANA_REST from "./edu/edu-ana-rest.js";            // analysis 其余 11
import EDU_ANA_RSA1 from "./edu/edu-ana-rsa1.js";            // analysis RSA 组1 5
import EDU_ANA_RSA2 from "./edu/edu-ana-rsa2.js";            // analysis RSA 组2 5
import EDU_ANA_SERIAL from "./edu/edu-ana-serial.js";        // analysis 序列化 12
import EDU_ANA_TOOLS from "./edu/edu-ana-tools.js";          // analysis 工具 8
import EDU_RADIX_BITOPS from "./edu/edu-radix-bitops.js";    // radix 位运算 5
import EDU_RADIX_CHECK from "./edu/edu-radix-check.js";      // radix 校验位 6
import EDU_RADIX_COLOR from "./edu/edu-radix-color.js";      // radix 颜色 2
import EDU_RADIX_CONVERT from "./edu/edu-radix-convert.js";  // radix 进制转换 3
import EDU_RADIX_GEO from "./edu/edu-radix-geo.js";          // radix 地理 4
import EDU_RADIX_MATH from "./edu/edu-radix-math.js";        // radix 数学 2
import EDU_RADIX_NET from "./edu/edu-radix-net.js";          // radix 网络 4
import EDU_RADIX_NUM from "./edu/edu-radix-num.js";          // radix 数值/数论 16
import EDU_RADIX_NUMSYS from "./edu/edu-radix-numsys.js";    // radix 另类数字系统 8
import EDU_RADIX_TIME from "./edu/edu-radix-time.js";        // radix 时间/纪元 12
import EDU_STEGO_IMAGE from "./edu/edu-stego-image.js";      // stego 图像 12
import EDU_STEGO_QR_AUDIO from "./edu/edu-stego-qr-audio.js";// stego QR/音频 9
import EDU_STEGO_TEXT from "./edu/edu-stego-text.js";        // stego 文本 14
import EDU_BATCH6 from "./edu/edu-batch6.js";                // 补缺：9 新增 op 科普（usbKeyboard/usbMouse/sevenZipExtract/goldbug/acrostic/everyN/caseBitStego/nthChar/wordSpacingBits）
// ---- 扩展模块交付但从未 import 的孤儿科普分片归并（44 个已注册 op 缺科普）----
// 跨分片重复：cast5/twofish（batch5-modern×modern-rest）、bwt（batch5-new×batch5-modern），Object.assign 后者覆盖，内容同源无害。
import EDU_BATCH5_NEW from "./edu/edu-batch5-new.js";        // enigma/m209/bazeries/fenham/pizzini/kamasutra/lolcode/clockCipher/bwt/snow/qqxiuzi*/huoxingwen/jianfan/fuyouyue/tianshu 21
import EDU_BATCH5_MODERN from "./edu/edu-batch5-modern.js";  // ror13Hash/byteArith/bwt/lzstring/cast5/twofish/hotp/totp/zuc/sm2/sm9 11
import EDU_CLASSIC_REST from "./edu/edu-classic-rest.js";    // otp/keywordcipher/simplesub/runingkey 4
import EDU_ANA_TOOLS2 from "./edu/edu-ana-tools2.js";        // pngSizeRecover/trailerCarve 2（jpegSizeRead/gifSizeRead 已并入 imageStructUnified）
import EDU_BATCH5_STEGO from "./edu/edu-batch5-stego.js";    // dtmfWav/exeBridge 2
import EDU_MODERN_REST from "./edu/edu-modern-rest.js";      // cast5/twofish 2
import EDU_FANCY_REST from "./edu/edu-fancy-rest.js";        // fracmorse 1
import EDU_RADIX_HAMMING from "./edu/edu-radix-hamming.js";  // hammingCode 1
// ---- 6 个真缺 edu 分片归并（20 op 科普，redundant 全空零冲突，其余 9 冗余分片仍不引见上）----
import EDU_ANA_NEW from "./edu/edu-ana-new.js";              // sstiKeyword/crc32Collision/pickleDisasm/zipBrute 4
import EDU_CLASSIC_NEW from "./edu/edu-classic-new.js";      // routeCipher/rotSpecial/fullwidth/chaocipher/straddleCheckerboard 5
import EDU_EXE from "./edu/edu-exe.js";                      // pycExeDecompile 1
import EDU_FANCY_NEW from "./edu/edu-fancy-new.js";          // jjencode 1
import EDU_MODERN_NEW from "./edu/edu-modern-new.js";        // rabbit/pbkdf2/hkdf/md2 4
import EDU_CRYPTO_PG from "./edu/edu-crypto-pg.js";          // shamir/schnorr/ecdsaReuseK/rabin/x25519/ed25519/paillier/a51/magma 9
import EDU_UNIFIED_MISC from "./edu/edu-unified-misc.js";    // archiveUnified/cryptoAddrUnified/imageStructUnified/numToPinyin/hanziToPinyin 5
// ---- 发布前补全：91 个原无科普 op 的科普卡（按分类分片，各代理独占文件）----
import EDU_FORENSIC_NEW from "./edu/edu-forensic-new.js";        // john 系/pcap 系/mc 系/取证 19
import EDU_ANA_CRYPTO_NEW from "./edu/edu-ana-crypto-new.js";    // analysis 工具 + crypto 攻击 17
import EDU_ANA_GEFTE from "./edu/edu-ana-geffe.js";  // geffe 1
import EDU_FANCY_MODERN_NEW from "./edu/edu-fancy-modern-new.js";// fancy 深奥语言 + modern 轻量密码 16
import EDU_MISC2_NEW from "./edu/edu-misc2-new.js";              // cn/stego/hash/base/radix/classic 24
import EDU_BRIDGE_NEW from "./edu/edu-bridge-new.js";            // 本地桥 exe 15
import EDU_BATCH_NEW from "./edu/edu-batch-new.js";              // 本轮新增 9：txtmoji/webshell/二进制图像/取证/爆破
import EDU_CRYPTO_PG2 from "./edu/edu-crypto-pg2.js";       // present/siphash/scrypt/blake3/whirlpool/pearson/xorshiftRecover/yenc/binhex 9
import EDU_HASH_XXHASH from "./edu/edu-hash-xxhash.js";    // xxhash 1
import EDU_HASH_CITYHASH from "./edu/edu-hash-cityhash.js";  // cityhash 1

// 合并所有分片。后者不覆盖前者（分区不重叠）；重叠时以后者为准，构建期应避免。
const EDU = Object.assign(
  {},
  EDU_BASE_TEXT,
  EDU_CLASSIC,
  EDU_CRYPTO,
  EDU_MISC,
  EDU_GEN_TEXT,
  EDU_GEN_FANCY,
  EDU_BASE1,
  EDU_BASE2,
  EDU_CLASSIC1,
  EDU_CLASSIC2,
  EDU_FANCY_CN,
  EDU_HASH1,
  EDU_HASH2,
  EDU_HASH3,
  EDU_MODERN1,
  EDU_MODERN2,
  EDU_ANA_FREQ,
  EDU_ANA_REST,
  EDU_ANA_RSA1,
  EDU_ANA_RSA2,
  EDU_ANA_SERIAL,
  EDU_ANA_TOOLS,
  EDU_RADIX_BITOPS,
  EDU_RADIX_CHECK,
  EDU_RADIX_COLOR,
  EDU_RADIX_CONVERT,
  EDU_RADIX_GEO,
  EDU_RADIX_MATH,
  EDU_RADIX_NET,
  EDU_RADIX_NUM,
  EDU_RADIX_NUMSYS,
  EDU_RADIX_TIME,
  EDU_STEGO_IMAGE,
  EDU_STEGO_QR_AUDIO,
  EDU_STEGO_TEXT,
  EDU_BATCH6,
  EDU_BATCH5_NEW,
  EDU_BATCH5_MODERN,
  EDU_CLASSIC_REST,
  EDU_ANA_TOOLS2,
  EDU_BATCH5_STEGO,
  EDU_MODERN_REST,
  EDU_FANCY_REST,
  EDU_RADIX_HAMMING,
  EDU_ANA_NEW,
  EDU_CLASSIC_NEW,
  EDU_EXE,
  EDU_FANCY_NEW,
  EDU_MODERN_NEW,
  EDU_CRYPTO_PG,
  EDU_UNIFIED_MISC,
  EDU_FORENSIC_NEW,
  EDU_ANA_CRYPTO_NEW,
  EDU_FANCY_MODERN_NEW,
  EDU_MISC2_NEW,
  EDU_BRIDGE_NEW,
  EDU_ANA_GEFTE,
  EDU_BATCH_NEW,
  EDU_CRYPTO_PG2,
  EDU_HASH_XXHASH,
  EDU_HASH_CITYHASH,
);

/** 取某 op 的科普内容，无则返回 null。
 *  locale 可选；传 "en" 时优先返回英文条目（英文层缺该 opId 则回落中文）。
 *  英文分片在 EDU_EN 对象中，由 eduContent.en.js 懒注册。
 */
let EDU_EN = null; // 英文层，启动时由 loadEduEn() 注入，null=尚未加载/不可用

/** 注册英文科普层（由 eduContent.en.js 导入后调用）。 */
export function registerEduEn(enData) {
  EDU_EN = enData;
}

export function getEdu(opId, locale) {
  if (locale === "en" && EDU_EN) {
    const en = EDU_EN[opId];
    if (en) return en;
  }
  return EDU[opId] || null;
}

/** 是否有科普内容。 */
export function hasEdu(opId) {
  return !!EDU[opId];
}

/** 全部有科普的 opId 列表（覆盖率统计/测试用）。 */
export function eduOpIds() {
  return Object.keys(EDU);
}

/** 收集所有 op 的别名（aka 字段），返回 { opId: string[] }，供搜索别名索引用。 */
export function eduAliases() {
  const out = {};
  for (const [id, e] of Object.entries(EDU)) {
    if (e && Array.isArray(e.aka) && e.aka.length) out[id] = e.aka;
  }
  return out;
}

export default EDU;
