// 科普内容分片：T356 批 5 个历史哈希 op（md6/snefru/sha0/has160/gostHash，源码 src/core/hashMore.js）。
// 纯数据，无 import 无副作用。examples 的 out 全部是 node 直跑真实输出（SHA-0 与 GOST-94 已对公认向量核对），未编造。
export default {
  md6: {
    what: "MD6：Ronald Rivest 2008 年为 NIST SHA-3 竞赛设计的哈希，Merkle 树结构，最后没进决选——CTF 里见到就是「历史算法」题。",
    principle:
      "MD6 的招牌是 Merkle 树并行结构：长消息切成块挂树叶上，一层层向上哈希出根摘要——2008 年就为多核并行设计，跟海绵结构走的是两条路。\n\n" +
      "压缩函数用 64 轮的 V 元素宽字运算（word size 64 位），摘要长度可选 128..512 位（默认 256）。默认模式下根节点需要密钥参数（全零即无密钥模式）。\n\n" +
      "竞赛期间被找出区分器攻击，Rivest 提交修订版后主动退赛，SHA-3 最终归 Keccak——所以 MD6 没有 RFC 终稿，只有提案文档与参考实现。",
    usage: "输入（text/hex），选摘要位数（128..512，默认 256）。",
    examples: [
      { in: "abc", param: "256 位", out: "230637d4e6845cf0d092b558e87625f03881dd53a7439da34cf3b94ed0d8b2c5", desc: "真实运行输出" },
      { in: "abc", param: "512 位", out: "00918245271e377a7ffb202b90f3bda5477d8feab12d8a3a8994ebc55fe6e74ca8341520032eeea3fdef892f2882378f636212af4b2683ccf80bf025b7d9b457", desc: "最长档摘要" },
      { in: "（空输入）", param: "256 位", out: "bca38b24a804aa37d821d31af00f5598230122c5bbfc4c4ad5ed40e4258f04ca", desc: "空串也有摘要" },
    ],
    tips: [
      "SHA-3 竞赛落选家族（MD6/Skein/Grøstl/JH）是本箱的「考古题专区」，认准位数与树结构即可，别跟现行标准混。",
      "MD6 与 MD5 只有名字像：MD6 不是 MD 家族修补版，是完全重新设计的树形结构。",
      "老系统迁移题里见到 MD6 摘要（64 hex 字符起），长度档位是第一条线索。",
    ],
    aka: ["md6", "md6哈希", "md6-256", "md6-512", "md6-128", "rivest", "ronald rivest", "sha-3竞赛", "nist sha-3 candidate", "merkle树哈希", "树形哈希", "md6 hash", "md6摘要", "parallel hash tree", "sha3提案"],
  },

  snefru: {
    what: "Snefru：Ralph Merkle 1990 年的哈希（Xerox 时期作品），名字取自埃及金字塔法老——考古级算法，碰撞攻击早已把它打穿。",
    principle:
      "结构是「加密式」的：消息按 512 字节大块处理，每块多轮（本实现 2.5a 版 8 轮，128 位档用 4 轮）反复过一个可逆的位运算网络，取输出一半当哈希、另一半回填下一轮。\n\n" +
      "Merkle 当年就是密码学哈希概念的奠基人之一（1979 年的论文定义了 Merkle–Damgård 结构），Snefru 是这一思想的早期工程实现。\n\n" +
      "1992 年起 Biham/Shamir 等的差分攻击把 2 轮版打穿、后续攻击削弱全部轮数版——历史上直接催生了它的替代者（RIPEMD 与 MD5 强化讨论同期）。仅存 CTF 历史题价值。",
    usage: "输入（text/hex），选摘要位数（256 默认 / 128）。",
    examples: [
      { in: "abc", param: "256 位（8 轮）", out: "1227501c6534c3080a7a66ac381ec2d529d6474f556aeedc4a8533b9733e76e1", desc: "真实运行输出" },
      { in: "abc", param: "128 位（4 轮）", out: "6ca2be382289a1a989038dd1db6be734", desc: "短摘要档" },
    ],
    tips: [
      "见到 Snefru 摘要先想「这是故意的老算法题」：碰撞攻击可查论文复现，别试图逆。",
      "256 位档 64 hex 字符与 SHA-256 同长，但输入 abc 结果完全不同——对拍一眼分辨。",
      "名字梗：法老 Snefru 造了弯曲金字塔，Merkle 拿它命名一个后来被「掰弯」的哈希。",
    ],
    aka: ["snefru", "snefru哈希", "snefru hash", "snefru 2.5a", "ralph merkle", "merkle哈希", "snefru 256", "snefru 128", "xerox哈希", "1990哈希", "snefru摘要", "snefru digest", "snefru collision"],
  },

  sha0: {
    what: "SHA-0：1993 年 FIPS 180 的初版 SHA，发布后因未公开的弱点两年内就被 SHA-1（FIPS 180-1）替换——只活在历史兼容与 CTF 题里。",
    principle:
      "与 SHA-1 几乎同一套框架（512 位块、80 轮、160 位摘要、Merkle–Damgård），唯一公开差异：消息扩展时 SHA-1 要对字做循环左移，SHA-0 不旋转。\n\n" +
      "就这一个字的差别，安全性天壤之别：2004 年起 SHA-0 的全碰撞被实际算出（Joux 等，随后碰撞成本一路降到 $2^{33}$ 量级），彻底没救。\n\n" +
      "CTF 用法：题目给一个 160 位摘要既不是 SHA-1 也不是 RIPEMD-160，试试 SHA-0（尤其题面提到 1993/FIPS 180/老系统）。",
    usage: "输入（text/hex），运行出 160 位摘要。",
    examples: [
      { in: "abc", out: "0164b8a914cd2a5e74c4f7ff082c4d97f1edf880", desc: "与 SHA-1 的 a9993e36… 对比：只差消息扩展那一下旋转" },
      { in: "（空输入）", out: "f96cea198ad1dd5617ac084a3d92c6107708c0ef", desc: "空串摘要（SHA-1 空串是 da39a3ee…）" },
    ],
    tips: [
      "160 位摘要排除法：先 SHA-1，再 RIPEMD-160，再 HAS-160，最后 SHA-0——本箱四个都有，逐个试。",
      "SHA-0/SHA-1 同源题常给两条相似摘要让你判断哪个是 0——abc 是最快的分界样本。",
      "别在任何真实场景用：全碰撞公开可造，数字签名语境下等于裸奔。",
    ],
    aka: ["sha-0", "sha0", "sha 1993", "fips 180", "原始sha", "sha-1前身", "sha-0哈希", "sha0 hash", "secure hash algorithm 1993", "pre-sha1", "sha-0摘要", "被弃用sha", "1993 sha", "sha零"],
  },

  has160: {
    what: "HAS-160：韩国 KISA 制定的 160 位哈希（TTAS.KO-12.0011/R2），配韩国数字签名标准 KCDSA 用——韩国版「SHA-1」。",
    principle:
      "结构对齐 SHA-1（512 位块、80 轮、160 位摘要），但消息扩展改为从输入 512 位里按固定置换表取 16 字，轮函数与常量也有自己的设定。\n\n" +
      "2000 年前后韩国 PKI 体系（KCDSA 签名）需要国产摘要算法，HAS-160 应运而生；后来逐步向 SHA-256/SHA-2 系迁移。\n\n" +
      "CTF 里出现在「认国别」题：韩系题目（韩国企业 CTF、老韩服系统取证）给 160 位摘要先想它。",
    usage: "输入（text/hex），运行出 160 位摘要。",
    examples: [
      { in: "abc", out: "975e810488cf2a3d49838478124afce4b1c78804", desc: "真实运行输出" },
      { in: "（空输入）", out: "307964ef34151d37c8047adec7ab50f4ff89762d", desc: "空串摘要" },
    ],
    tips: [
      "160 位家族四胞胎（SHA-1/RIPEMD-160/HAS-160/SHA-0）本箱齐活，逐个对拍最快。",
      "HAS-160 与 SHA-1 的 abc 摘要完全不同（SHA-1 是 a9993e36…），不存在兼容关系。",
      "韩系算法全家桶：SEED/ARIA（分组）、HAS-160（摘要）、KCDSA/EC-KCDSA（签名）——题面出现这几个词互相印证。",
    ],
    aka: ["has-160", "has160", "has 160", "has-160哈希", "韩国哈希", "kisa", "kcdsa", "kcdsa配套摘要", "ttas.ko-12.0011", "has160 hash", "has-160摘要", "korean hash", "韩国标准哈希", "has160摘要"],
  },

  gostHash: {
    what: "GOST R 34.11-94：俄罗斯 1994 年国家标准哈希（RFC 5831），拿分组密码 GOST 28147-89 当搅拌芯——与 2012 年的 Streebog 是两回事。",
    principle:
      "与主流哈希「专用压缩函数」不同，它是「分组密码型」哈希：256 位块过 GOST 28147-89 分组密码（就是本箱 GOST 分组算法那套 S 盒），迭代结构合并消息与状态，出 256 位摘要。\n\n" +
      "S 盒是参数化的：id-GostR3411-94-TestParamSet（RFC 示例用）与 CryptoPro 参数集（实际部署用）——同一输入换 S 盒结果完全不同，本工具两套都支持。\n\n" +
      "继任者 GOST R 34.11-2012（Streebog，本箱另有 op）是全新设计；94 版留在俄系老系统兼容里。",
    usage: "输入（text/hex），选 S 盒参数集（test 默认 / CryptoPro）。",
    examples: [
      { in: "（空输入）", param: "test 参数集", out: "042d9012f160c662c5e6653cc8dffe274cf4b64d50aa6b03f6b8f0e7d9a92d4b", desc: "RFC 5831 §7.1 官方向量，逐字一致" },
      { in: "abc", param: "test 参数集", out: "f91a56bb23e7df4efe9fed677bf389b64a36ad7a71c817eaaf72a5939c5b071d", desc: "真实运行输出" },
      { in: "abc", param: "CryptoPro 参数集", out: "9865c10d81eb3a9aa2259355936aee1c636b1b01bfe7677a2801c66404d7f6d5", desc: "同输入换 S 盒，结果全变" },
    ],
    tips: [
      "认俄系题三件套：GOST 28147-89（分组）、GOST R 34.11-94（本哈希）、GOST 签名——常一起出现在俄产设备固件取证。",
      "对不上向量先查 S 盒：test 与 CryptoPro 是两套，俄方实际系统多用 CryptoPro。",
      "别与 Streebog 混：94 版 256 位摘要基于分组密码，2012 版 256/512 位海绵式设计，两者无兼容。",
    ],
    aka: ["gost r 34.11-94", "gost94", "gost哈希", "gost hash", "老gost哈希", "rfc 5831", "gost 28147-89哈希", "俄罗斯哈希", "id-gostR3411-94", "gost testparamset", "cryptopro参数集", "gost 34.11-94", "俄罗斯标准哈希", "gost94 hash"],
  },
};
