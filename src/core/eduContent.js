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
// 跨分片重复已清零（T504 二批摘除 cast5/twofish/bwt 输家块，2026-09-13）。
import EDU_BATCH5_NEW from "./edu/edu-batch5-new.js";        // enigma/m209/bazeries/fenham/pizzini/kamasutra/lolcode/clockCipher/snow/qqxiuzi*/huoxingwen/jianfan/fuyouyue/tianshu 20
import EDU_BATCH5_MODERN from "./edu/edu-batch5-modern.js";  // ror13Hash/byteArith/bwt/lzstring/hotp/totp/zuc/sm2/sm9 9
import EDU_CLASSIC_REST from "./edu/edu-classic-rest.js";    // otp/keywordcipher/simplesub/runingkey 4
import EDU_ANA_TOOLS2 from "./edu/edu-ana-tools2.js";        // pngSizeRecover/trailerCarve 2（jpegSizeRead/gifSizeRead 已并入 imageStructUnified）
import EDU_ANA_MORE from "./edu/edu-ana-more.js";             // mimeMultipart/randu/truncLcgRecover/shaLengthExtend/birthdayCollision 5
import EDU_BATCH5_STEGO from "./edu/edu-batch5-stego.js";    // dtmfWav 1（exeBridge 卡随 CLI 桥退役删除）
import EDU_MODERN_REST from "./edu/edu-modern-rest.js";      // cast5/twofish 2
import EDU_FANCY_REST from "./edu/edu-fancy-rest.js";        // fracmorse 1
import EDU_RADIX_HAMMING from "./edu/edu-radix-hamming.js";  // hammingCode 1
// ---- 6 个真缺 edu 分片归并（20 op 科普，redundant 全空零冲突，其余 9 冗余分片仍不引见上）----
import EDU_ANA_NEW from "./edu/edu-ana-new.js";              // sstiKeyword/crc32Collision/pickleDisasm/zipBrute 4
import EDU_CLASSIC_NEW from "./edu/edu-classic-new.js";      // routeCipher/rotSpecial/fullwidth/chaocipher/straddleCheckerboard 5
import EDU_EXE from "./edu/edu-exe.js";                      // pycExeDecompile 1
import EDU_FANCY_NEW from "./edu/edu-fancy-new.js";          // jjencode 1
import EDU_MODERN_NEW from "./edu/edu-modern-new.js";        // rabbit/pbkdf2/hkdf/md2 4
import EDU_FOREMOST from "./edu/edu-foremost.js";            // foremostCarve 1（文件雕刻 Foremost JS 版）
import EDU_HASH_FRONTIER from "./edu/edu-hash-frontier.js";  // T398 批B：argon2/tiger/kupyna 3
import EDU_T396A from "./edu/edu-t396a-family.js";           // T396-A 拆族 20 卡（paillier/dsa/schnorr/ed25519/x25519 族 + geffe）
import EDU_SM2_FAMILY from "./edu/edu-sm2-family.js";        // SM2 六档族卡（T394：sm2KeyGen/Encrypt/Decrypt/Sign/Verify/KeyExchange）
import EDU_SM9_FAMILY from "./edu/edu-sm9-family.js";        // SM9 五档族卡（T397 批1：sm9KeyGen/Sign/Verify/Encrypt/Decrypt，双线性对内核）
import EDU_BFTOOLS_FAMILY from "./edu/edu-bftools-family.js";   // bftools 图像变体卡（T389：brainloller/braincopter 编解码）
import EDU_XWING_FAMILY from "./edu/edu-xwing-family.js";      // X-Wing 混合 KEM 卡（T398 批A）
import EDU_STEGDETECT from "./edu/edu-stegdetect.js";          // stegdetect 检测卡（T391）
import EDU_JSTEG from "./edu/edu-jsteg.js";                    // jsteg 隐写卡（T390）
import EDU_XMSS_LMS from "./edu/edu-xmss-lms.js";              // XMSS/LMS 卡（T398 批A）
import EDU_HQC_FAMILY from "./edu/edu-hqc-family.js";         // HQC 卡（T398 批A）
import EDU_NTRU_REAL from "./edu/edu-ntru-real.js";           // 真 NTRU 卡（T398 批A）
import EDU_BLS_FAMILY from "./edu/edu-bls-family.js";         // BLS 卡（T398 批C）
import EDU_PROTOCOL_C from "./edu/edu-protocol-c.js";         // 批C 协议原语卡（Merkle/Pedersen/Feldman/LSAG）
import EDU_CRYPTO_PG from "./edu/edu-crypto-pg.js";          // shamir/schnorr/ecdsaReuseK/rabin/x25519/ed25519/paillier/a51/magma 9
import EDU_UNIFIED_MISC from "./edu/edu-unified-misc.js";    // archiveUnified/cryptoAddrUnified/imageStructUnified/numToPinyin/hanziToPinyin 5
// ---- 发布前补全：91 个原无科普 op 的科普卡（按分类分片，各代理独占文件）----
import EDU_FORENSIC_NEW from "./edu/edu-forensic-new.js";        // john 系/pcap 系/mc 系/取证 19
import EDU_ANA_CRYPTO_NEW from "./edu/edu-ana-crypto-new.js";
import EDU_TEXT_BUBBLE from "./edu/edu-text-bubblebabble.js"; // bubblebabble 1
import EDU_TEXT_JSESCAPE from "./edu/edu-text-jsescape.js"; // jsEscape 1
import EDU_TEXT_PPENCODE from "./edu/edu-text-ppencode.js"; // ppencode 1
import EDU_ANA_CRC32REV from "./edu/edu-analysis-crc32rev.js"; // crc32Reverse 1    // analysis 工具 + crypto 攻击 17
import EDU_ANA_GEFTE from "./edu/edu-ana-geffe.js";  // geffe 1
import EDU_FANCY_MODERN_NEW from "./edu/edu-fancy-modern-new.js";
import EDU_FANCY_ROAR from "./edu/edu-fancy-roar.js"; // roar 1
import EDU_MISC2_NEW from "./edu/edu-misc2-new.js";              // cn/stego/hash/base/radix/classic 24
import EDU_BRIDGE_NEW from "./edu/edu-bridge-new.js";            // 本地桥 exe 15
import EDU_BATCH_NEW from "./edu/edu-batch-new.js";              // 本轮新增 9：txtmoji/webshell/二进制图像/取证/爆破
import EDU_CRYPTO_PG2 from "./edu/edu-crypto-pg2.js";       // present/siphash/scrypt/blake3/whirlpool/pearson/xorshiftRecover/yenc/binhex 9
import EDU_CRYPTO_B from "./edu/edu-crypto-b.js";           // a52/e0/hc128/hc256/sosemanuk/spritz/vmpc/balloon/lyra2/yescrypt 10
import EDU_HASH_XXHASH from "./edu/edu-hash-xxhash.js";    // xxhash 1
import EDU_HASH_CITYHASH from "./edu/edu-hash-cityhash.js";  // cityhash 1
import EDU_CTF_CIPHER_EXT from "./edu/edu-ctf-cipher-ext.js"; // twinHex/trollScript/asciiSum/caesarBox/curveCipher 5
import EDU_TOOLS_RADIX from "./edu/edu-tools-radix.js";   // radixAll/progCalc/unitConv 3（T337-T339 工具类）
import EDU_MT82 from "./edu/edu-mt82.js";                 // MT82 新增 15 op（gifTiming/jpgSizeRecover/zipRepair/zipPseudoEncrypt/stringsExtract/jwtCrack/zstegScan/pdfObjects/ooxmlMeta/apkManifest/elfInfo/peInfo/lsbEmbed/zipCreate/deepsoundExtract）
import EDU_T359 from "./edu/edu-t359.js";                 // T359 新增 34 op（v0.1.6beta：rsaGen/ecdsa/mlkem/pem-jwk/证书解析/cmac/kmac/ascon/keywrap/jwt/flaskSession）
import EDU_T356_HASH from "./edu/edu-t356-hash.js";       // T356 落盘 5 op（md6/snefru/sha0/has160/gostHash 历史哈希，aka 顺带批）
import EDU_T376 from "./edu/edu-t376.js";                 // T376 新增 32 op（v0.1.6beta 全量补齐波收口：noekeon/shacal2/cast6/cmacExt/ls47/Ed448/X448/GOST R 34.10-2012/PGP8/BB84/JWS/JWE/PASETO v4/ML-DSA/SLH-DSA）
import EDU_T508 from "./edu/edu-t508.js";                 // T508 批一古典 A1-A7（homophonic/doubleTrans/pollux/morbit/bookCipher/turningGrille/kenny）
import EDU_T508_B4 from "./edu/edu-t508-b4.js";           // T508 批四工程编码（hexdump/modhex/citrixCtx1/scriptDecoder/rison/unixPerms 6）
import EDU_T508_B2 from "./edu/edu-t508-b2.js";           // T508 批二编码映射（crockford32/alienAlphabet/futhark/countingRods/chuckUnary/wingdings/cardanGrille 7）
import EDU_T508_B3 from "./edu/edu-t508-b3.js";           // T508 批三压缩校验（rle/lzw/elias/verhoeff/lz4Dec/bzip2Dec 6）

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
  EDU_ANA_MORE,
  EDU_BATCH5_STEGO,
  EDU_MODERN_REST,
  EDU_FANCY_REST,
  EDU_RADIX_HAMMING,
  EDU_ANA_NEW,
  EDU_CLASSIC_NEW,
  EDU_EXE,
  EDU_FANCY_NEW,
  EDU_MODERN_NEW,
  EDU_FOREMOST,
  EDU_HASH_FRONTIER,
  EDU_T396A,
  EDU_SM2_FAMILY,
  EDU_SM9_FAMILY,
  EDU_BFTOOLS_FAMILY,
  EDU_XWING_FAMILY,
  EDU_STEGDETECT,
  EDU_JSTEG,
  EDU_XMSS_LMS,
  EDU_HQC_FAMILY,
  EDU_NTRU_REAL,
  EDU_BLS_FAMILY,
  EDU_PROTOCOL_C,
  EDU_CRYPTO_PG,
  EDU_UNIFIED_MISC,
  EDU_FORENSIC_NEW,
  EDU_ANA_CRYPTO_NEW,
  EDU_TEXT_BUBBLE,
  EDU_TEXT_JSESCAPE,
  EDU_TEXT_PPENCODE,
  EDU_ANA_CRC32REV,
  EDU_FANCY_MODERN_NEW,
  EDU_FANCY_ROAR,
  EDU_MISC2_NEW,
  EDU_BRIDGE_NEW,
  EDU_ANA_GEFTE,
  EDU_BATCH_NEW,
  EDU_CRYPTO_PG2,
  EDU_CRYPTO_B,
  EDU_HASH_XXHASH,
  EDU_HASH_CITYHASH,
  EDU_CTF_CIPHER_EXT,
  EDU_TOOLS_RADIX,
  EDU_MT82,
  EDU_T359,
  EDU_T356_HASH,
  EDU_T376,
  EDU_T508,
  EDU_T508_B4,
  EDU_T508_B2,
  EDU_T508_B3,
);

import { ZH as INTEGRATED, HASH_VECTORS, BASE_NOTES, EXTRA_ALIASES, CRC_PARAMS } from "./edu/edu-integrated.js";
for (const [id, [name, poly, init, reflect, xorout, out]] of Object.entries(CRC_PARAMS)) {
  EDU[id] = { ...EDU[id], what: `${name}：CRC族中的独立校验参数组，不是密码学哈希。`,
    principle: `poly=0x${poly}, init=0x${init}, refin=refout=${reflect}, xorout=0x${xorout}。多项式写正常形式，反射实现不改变该标称值。`,
    usage: "输入UTF-8文本，计算固定参数组的十六进制校验值。要换参数组请切换CRC档位；Adler-32不属于CRC族。",
    examples: [{ in: "123456789", out }], tips: ["CRC用于检错，不提供抗恶意篡改认证。CRC-64/ECMA-182不等同CRC-64/XZ。", "参考：https://reveng.sourceforge.io/crc-catalogue/all.htm"] };
}
for (const id of ["md2", "md4", "md5", "md6"]) if (EDU[id]) {
  EDU[id] = { ...EDU[id], usage: (EDU[id].usage || "") + "\nMD滑块只组织显示，算法id和原参数不变；MD6的bits及inputType仍可调。", tips: [...(EDU[id].tips || []), "MD2/MD4/MD5不用于新系统的抗碰撞安全用途。MD6是SHA-3候选提案，不是SHA-3标准，也不是MD5的兼容升级。"] };
}
for (const [id, [zh, , input, output, dir, aka]] of Object.entries(BASE_NOTES)) {
  EDU[id] = { ...EDU[id], what: zh, principle: zh, usage: "输入文本，选择对应方向；示例方向：" + dir + "，使用默认参数。",
    examples: [{ in: input, out: output, param: dir }], tips: ["编码不是加密。字表、方向和复合格式必须一致。"],
    aka: [...new Set([...(EDU[id]?.aka || []).filter(w => !/解密|加密|encrypt|decrypt/i.test(w)), ...aka])] };
}
for (const [id, aka] of Object.entries(EXTRA_ALIASES)) {
  if (EDU[id]) EDU[id] = { ...EDU[id], aka: [...new Set([...(id.startsWith("sm2") ? [] : EDU[id].aka || []), ...aka])].filter(w => id !== "whitespace" || !/隐写|steganograph/i.test(w)) };
}
for (const [id, patch] of Object.entries(INTEGRATED)) {
  const old = EDU[id] || {};
  EDU[id] = { ...old, ...patch, aka: [...new Set([...(old.aka || []), ...(patch.aka || [])])] };
}
for (const [id, out] of Object.entries(HASH_VECTORS)) {
  const xof = id.startsWith("shake");
  EDU[id] = { ...EDU[id],
    what: `${id.toUpperCase()}：${xof ? "可扩展输出函数，不是固定长度摘要" : `${out.length * 4}位消息摘要${id === "sha3" ? "（默认256位，另有224/384/512）" : ""}`}。滑块只组织显示，各op独立；不包含HMAC/KDF。`,
    principle: xof ? `FIPS 202海绵结构XOF。n位输出的通用碰撞强度至多min(${id === "shake128" ? 128 : 256}, n/2)，原像强度至多min(${id === "shake128" ? 128 : 256}, n)。输出变短会降低安全性；同输入的短输出是长输出前缀。` : id === "sha3" ? "FIPS 202，Keccak-f[1600]海绵结构与SHA-3域分离；不等同旧Keccak散列。" : id === "sha0" ? "1993 FIPS 180；与SHA-1的消息扩展旋转不同，已被替代。" : "FIPS 180系列分块迭代消息摘要；单向，不是可逆加密。SHA-384使用不同于SHA-512的初始值后截断，不是直接截取SHA-512摘要。",
    usage: xof ? "输入文本，选择输出字节数；以下例子固定32字节。" : "输入文本运行；SHA-0另支持inputType=hex；SHA-3位宽参数保持可见。",
    examples: [{ in: "abc", out, ...(xof ? {param: "输出32字节"} : id === "sha3" ? {param: "bits=256"} : {}) }],
    tips: ["SHA-0/SHA-1不用于新系统的抗碰撞安全用途；普通快速哈希不是口令存储KDF。", "资料：FIPS 180、FIPS 202；不要只凭摘要长度认定算法。"],
    aka: (EDU[id]?.aka || []).filter(word => !/加密|encrypt|keccak/i.test(word)),
  };
}

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
