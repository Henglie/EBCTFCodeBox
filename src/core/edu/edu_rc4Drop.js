/*
 * edu_rc4Drop.js — 科普卡候选（RC4-drop[n] / CipherSaber-2）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：RFC 6229 测试向量、CipherSaber 官方页（ciphersaber.gurus.org）、Bart Massey CipherSaber-2 实现
 * 与 cstest.cs2 向量、Adam Back「Ciphersaber Memorable Test Vectors」（均 2026-09-23 访问，见 权威来源.md）。
 */
export default {
  rc4Drop: {
    what: "RC4-drop[n] 与 CipherSaber-2：两种「给 RC4 打补丁」的实用形态。RC4-drop[n] 丢弃密钥流最前面 n 字节再加密，避开 RC4 起始段的强偏置；CipherSaber-2（CS2）在 RC4 之上加 10 字节 IV 前置并把密钥调度重复 r 轮。两个模式合成一个算子。",
    principle:
      "**RC4 本体**：KSA 用密钥把 256 字节状态盒 S 洗成伪随机排列；PRGA 每步自增 i、用 S 计算 j、交换 S[i]/S[j]，输出 S[S[i]+S[j]] 作为密钥流字节；密文 = 明文 XOR 密钥流（**自反**，同一变换即加即解）。\n\n" +
      "**RC4-drop[n]**：RC4 前若干字节密钥流有可被统计出来的偏置（Roos、Fluhrer-McGrew、Mantin、Mironov 等分析），实践上**丢掉前 n 字节**再用，记作 RC4-drop[n]。n=768 是 SANS 建议，n=1536 是 RFC 4345 建议。RFC 6229 正是以「流偏移」给出各偏移处的 16 字节密钥流向量，本工具 drop 参数就是该偏移。\n\n" +
      "**CipherSaber-2**：两条改造。① 每条报文的 RC4 密钥 = **用户密钥 ‖ 10 字节 IV**（IV 随机、随密文前置，解密时从密文头 10 字节读回）；② **KSA 重复 r 轮**（推荐 r ≥ 20），进一步打散密钥调度偏置。r=1 时即 CS1。\n\n" +
      "本工具不内置随机数：CS2 加密必须显式给出 IV，保证结果可复现（工具语义，非协议语义）。",
    usage:
      "模式二选一。**drop 模式**参数：密钥（UTF-8/Hex/Base64/Latin-1）、丢弃字节数 n（默认 768；标准取值点 0/256/768/1024/1536/3072/4096）、密文编码（Base64/Hex）。**CS2 模式**参数：密钥、IV（10 字节，加密方向需给；解密方向从密文前 10 字节读）、KSA 轮数 r（默认 20，r=1 即 CS1）、密文编码。\n\n" +
      "两方向都是 XOR 流，encode/decode 同核；CS2 的差别只在加密前置 IV / 解密剥离 IV。CS2 解码时密文不足 10 字节会显式报错。\n\n" +
      "自检：drop 模式密钥 `0102030405`、drop=768，前 16 字节密钥流应等于 `eb62638d4f0ba1fe9fca20e05bf8ff2b`（RFC 6229 偏移 768 向量）。",
    examples: [
      { in: "密钥 0102030405（40 位）", param: "mode=drop, drop=768", out: "密钥流前 16 字节 eb62638d4f0ba1fe9fca20e05bf8ff2b", desc: "RFC 6229 Key1、40 位密钥、流偏移 768 官方向量（SANS 建议档）" },
      { in: "密钥 0102030405", param: "mode=drop, drop=0", out: "密钥流前 16 字节 b2396305f03dc027ccc3524a0a1118a8", desc: "同一密钥不丢弃（drop=0）时的偏移 0 向量，可对比看出为何要丢弃" },
      { in: "This is a test of CipherSaber-2.", param: "mode=cipherSaber2, key=asdfg, iv=ba9ab4cffb7700e618e3, r=10", out: "ba9ab4cffb7700e618e382e8fcc5ab9813b1abc436ba7d5cdea1a31fb72fb5763c44cfc2ac77afee19ad", desc: "CipherSaber 原始测试向量 cstest.cs2（密文前 10 字节即 IV）" },
      { in: "held", param: "mode=cipherSaber2, key=Al, iv=\"Al Dakota \"(416c2044616b6f746120), r=20", out: "416c2044616b6f74612067757473（= “Al Dakota guts”）", desc: "Adam Back 人机可记向量：r=20，密文文本读作 \"Al Dakota guts\" ↔ 明文 \"held\"" },
    ],
    formulas: [
      { tex: "K = \\mathrm{PRGA}_{\\text{drop } n}(\\mathrm{KSA}^{(r)}(\\text{key} \\,\\|\\, \\text{IV}))", caption: "CS2：密钥=用户密钥‖10 字节 IV，KSA 重复 r 轮，再取（此处 n=0）密钥流" },
      { tex: "C_i = P_i \\oplus K_i", caption: "加解密同一式（XOR 自反）" },
    ],
    tips: [
      "**为什么要 drop**：RC4 头几个字节的密钥流统计上明显偏离均匀（第 2 字节偏向 0 等），直接拿前几字节加密会被区分攻击利用；丢 768 字节（SANS 档）是最常见的折中。",
      "**CS1 与 CS2 的分界**：CS2 只是把 KSA 多跑几轮（r≥20 推荐）+ 强制 10 字节 IV 前置。把 r 设成 1 就退回 CS1，可用来对拍老实现。",
      "**IV 的定位**：CS2 的 IV 不是「与密钥混合」，而是**直接拼在密钥后面**当 RC4 密钥的一部分（k' = k ‖ iv）；解密端从密文头 10 字节读回同一个 IV，所以 IV 无需保密但要唯一。",
      "**别把 drop 与 IV 混用**：CS2 模式里 n=0（不丢弃），防护靠「IV 前置 + 多轮 KSA」；drop 模式里没有 IV。两者是不同时期的补丁思路，不要叠概念。",
      "**复现性**：本工具不自动生成 IV，加密时必须手填 10 字节 IV，否则每次结果不同、无法对拍；这是刻意的工具语义。",
      "**安全边界**：RC4 及其变体早已不被推荐用于新协议（TLS 已弃用 RC4）。RC4-drop / CS2 只是「让老格式还能用」的加固，不能当现代加密；新设计请用 ChaCha20 / AES-GCM 等。",
      "**CTF 常见套路**：见到「10 字节随机头 + 密文」多半是 CipherSaber；先试 r=20（或 10）配明文关键词暴力确认，再整段解密。",
      "来源：RFC 6229（RC4 测试向量与偏移建议）、CipherSaber 官方页（CS1 规范 + 推荐 N=20）、Bart Massey CS2 实现与 cstest.cs2、Adam Back 可记向量（均 2026-09-23 访问）。",
    ],
    aka: ["rc4 drop", "rc4-drop", "rc4-drop768", "rc4 丢弃密钥流", "ciphersaber", "ciphersaber2",
      "ciphersaber-2", "cs2 加密", "rc4 偏置 丢弃", "rfc 6229 测试向量", "rc4 ksa 重复",
      "ciphersaber iv 前置", "rc4 前768字节", "sans rc4 建议", "rc4 密钥流 偏移"],
  },
};
