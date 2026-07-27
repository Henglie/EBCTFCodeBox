// 科普内容分片：hash 段前 11（md4/sha384/crc32/crc16/sha3_224/sha3_256/sha3_384/sha3_512/keccak256/shake128/shake256）。纯数据，无 import 无副作用。
export default {
  md4: {
    what: "很老的一个消息摘要算法，输出 128 位（32 个十六进制字符）。今天基本不用它做安全，但它是 Windows NTLM 口令哈希的底层，取证 / 域渗透题常见。",
    principle:
      "分块迭代压缩：把数据按 512 位分块，用 3 轮共 48 步的位运算搅拌一个 128 位内部状态，最后输出 128 位摘要。单向不可逆，只能「算」不能「反推」。\n\n" +
      "MD4 抗碰撞早就被攻破，但因为快、又是 NTLM 的组成部分，逆向和取证里仍会遇到。",
    usage: "输入任意文本，输出 MD4 摘要（单向 run）。想由摘要反查原文，走字典爆破。",
    examples: [
      { in: "(空字符串)", out: "31d6cfe0d16ae931b73c59d7e0c089c0", desc: "空输入的 MD4，也正好是空口令的 NTLM" },
      { in: "abc", out: "a448017aaf21d8525fc10ae87aa6729d", desc: "RFC 1320 测试向量" },
    ],
    tips: [
      "32 位十六进制既可能是 MD5 也可能是 MD4/NTLM，光看长度分不出，得结合题面背景判断。",
      "题面出现 Windows / SAM / 域账户 → NTLM（= MD4(UTF-16LE 口令)）优先于 MD5。",
    ],
    aka: ["message digest 4", "md-4", "md4摘要", "MD4", "消息摘要4", "NTLM", "NTLM哈希", "NT hash", "RFC 1320", "128位摘要", "md4 hash", "windows口令哈希"],
  },

  sha384: {
    what: "SHA-2 家族的一档，输出 384 位（96 个十六进制字符）。本质是「砍短了的 SHA-512」，用同样的 64 位字运算，只是初始值不同、末尾截断。",
    principle:
      "内部和 SHA-512 完全同构（64 位字、80 轮压缩），区别只在两点：用一组不同的初始哈希值，以及最终把 512 位结果截成前 384 位输出。截断能挡住长度扩展攻击。单向不可逆。",
    usage: "输入文本，输出 SHA-384 摘要（WebCrypto 计算，单向）。",
    examples: [
      { in: "(空字符串)", out: "(96 位十六进制摘要)", desc: "输出恒为 96 个 hex 字符" },
    ],
    tips: [
      "96 位十六进制 → SHA-384，是 hash 里唯一这个长度的常见算法。",
      "它对长度扩展攻击免疫（因为截断），这点比 SHA-256 稳。",
    ],
    aka: ["sha-384", "sha2-384", "SHA384", "SHA-384", "安全散列算法384", "secure hash algorithm 384", "sha2 384", "384位哈希", "96位十六进制哈希", "sha384摘要", "SHA-2 384", "截断SHA-512"],
  },

  crc32: {
    what: "最常用的循环冗余校验，输出 32 位。它不是密码学哈希，专门用来「查数据有没有传错 / 存坏」，zip、png、以太网帧里到处是它。",
    principle:
      "把数据看成一个大二进制多项式，除以固定的生成多项式（IEEE 802.3 用 `0x04C11DB7`，反射实现常写成 `0xEDB88320`），取余数就是校验值。工程上用查表法一字节一步加速。\n\n" +
      "它是线性的、可被针对性构造，绝不能当安全哈希用 —— 但用来认数据完整性又快又好。",
    usage: "输入数据，输出 CRC32 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0xCBF43926", desc: "CRC 领域公认的标准校验字符串与结果" },
    ],
    tips: [
      "看到 8 位十六进制的「校验和 / checksum」而不是 32 位摘要，多半是 CRC32 而非哈希。",
      "CRC 可逆构造：能反算出让 CRC 等于目标值的补丁字节，安全性为零。",
    ],
    aka: ["crc-32", "crc32/ieee", "循环冗余校验", "CRC32", "cyclic redundancy check", "循环冗余校验码", "crc32 checksum", "crc校验", "IEEE 802.3 CRC", "0xEDB88320", "crc32/iso-hdlc", "32位校验和"],
  },

  crc16: {
    what: "16 位的循环冗余校验，这一档用 CCITT-FALSE 参数（多项式 `0x1021`，初值 `0xFFFF`）。串口、调制解调器等老协议常用它防传输错误。",
    principle:
      "原理同 CRC32，只是多项式和寄存器宽度是 16 位。CRC-16 有一大堆参数变体（初值、是否位反射、末异或都能不同），CCITT-FALSE 是其中一种固定组合：poly=0x1021, init=0xFFFF, 不反射, xorOut=0。",
    usage: "输入数据，输出 16 位 CRC 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0x29B1", desc: "CRC-16/CCITT-FALSE 的标准校验值" },
    ],
    tips: [
      "CRC-16 变体极多，同一段数据不同参数结果完全不同 —— 对不上先怀疑参数（初值 / 反射）选错，用通用 CRC 逐个试。",
    ],
    aka: ["crc-16", "crc16/ccitt-false", "循环冗余校验16", "CRC16", "CRC-16/CCITT", "16位循环冗余校验", "crc16 checksum", "0x1021多项式", "CCITT校验", "16位CRC", "crc16校验和", "串口CRC"],
  },

  sha3: {
    what: "SHA-3 家族哈希，位宽可选 224/256/384/512（默认 256）。SHA-3 和 SHA-2 长得像但内核完全不同：它基于 Keccak 海绵结构，是为了「万一 SHA-2 出事」准备的备胎标准（FIPS 202）。256 档最常用（64 个十六进制字符）。",
    principle:
      "海绵结构（sponge）：把数据一块块「吸收」进一个 1600 位大状态，每块之间跑 24 轮 Keccak-f 置换搅拌，最后再「挤出」需要的位数。输出位数越大、吸收速率越小。padding 尾字节恒为 `0x06`（区别于 Keccak 原版的 `0x01`）。位宽只改挤出长度和吸收速率，算法主体一致。",
    usage: "输入文本，选位宽，输出 SHA3 摘要（纯 JS Keccak，单向）。",
    examples: [
      { in: "(空字符串, 256)", out: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a", desc: "空输入的 SHA3-256" },
      { in: "(空字符串, 224)", out: "(56 位十六进制摘要)", desc: "224 位 = 56 个 hex 字符" },
    ],
    tips: [
      "SHA-3 天生免疫长度扩展攻击（海绵结构决定的），这是它相对 SHA-2 的一大卖点。",
      "SHA3-* 与同名 Keccak-* 只差 padding 一个字节，结果完全不同，别混。",
      "同是 64 位十六进制，SHA3-256 和 SHA-256 靠肉眼分不出，得看题目声明。",
    ],
    aka: ["sha3", "sha3-224", "sha3-256", "sha3-384", "sha3-512", "keccak sha3", "SHA-3", "FIPS 202", "海绵结构哈希", "sponge hash", "安全散列算法3", "secure hash algorithm 3"],
  },

  keccak256: {
    what: "Keccak 的原始版本（padding 尾字节 `0x01`），输出 256 位。以太坊全线用它做地址、交易、合约哈希，区块链题必遇。",
    principle:
      "内核和 SHA3-256 一模一样的海绵结构 + 24 轮 Keccak-f 置换，唯一区别是 padding 用原始的 `0x01` 而不是 SHA-3 标准化时改的 `0x06`。就这一字节之差，导致两者对同一输入的结果完全不同。",
    usage: "输入文本，输出 Keccak-256 摘要（单向 run）。",
    examples: [
      { in: "(空字符串)", out: "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470", desc: "以太坊场景里最常被引用的空 Keccak-256" },
    ],
    tips: [
      "题面出现 Ethereum / Solidity / EVM / 0x 地址校验 → 用 Keccak-256，别错拿 SHA3-256。",
      "以太坊 EIP-55 地址混合大小写校验就是靠 Keccak-256 逐位算的。",
    ],
    aka: ["keccak-256", "keccak256", "以太坊哈希", "ethereum keccak", "Keccak-256", "Keccak", "以太坊keccak", "keccak原始版", "ethereum hash", "EVM哈希", "solidity keccak", "keccak256哈希"],
  },

  shake128: {
    what: "SHAKE 是 SHA-3 里的「可扩展输出函数」(XOF)：输出多长由你说了算。SHAKE128 提供约 128 位安全强度，想要几字节摘要就挤几字节。",
    principle:
      "还是 Keccak 海绵结构，但「挤出」阶段可以一直挤下去，要多少位给多少位。padding 尾字节是 `0x1F`（区别于 SHA3 的 `0x06`）。安全强度由数字标称（128），和输出长度无关。",
    usage: "输入文本 + 想要的输出字节数，输出对应长度的十六进制摘要（单向）。",
    examples: [
      { in: "(空字符串)", param: "32 字节", out: "7f9c2ba4e88f827d616045507605853ed73b8093f6efbc88eb1a6eacfa66ef26", desc: "空输入挤出 32 字节" },
    ],
    tips: [
      "同一输入，挤 16 字节的结果就是挤 32 字节结果的前 16 字节（前缀性质），这是 XOF 的特点。",
      "长度可变是招牌：题目给的摘要长度奇怪（不是 32/64 这种标准值）→ 想想 SHAKE。",
    ],
    aka: ["shake-128", "xof", "可扩展输出函数", "SHAKE128", "SHAKE-128", "extendable output function", "可变长哈希", "keccak XOF", "shake128摘要", "变长输出哈希", "FIPS 202 XOF", "sha3 xof"],
  },

  shake256: {
    what: "SHAKE 系列的高强度档，提供约 256 位安全强度，输出长度同样任意可选（XOF，FIPS 202）。",
    principle: "同 SHAKE128 的海绵 + 可扩展挤出，只是吸收速率更小、安全强度标称 256，padding 尾字节仍是 `0x1F`。",
    usage: "输入文本 + 想要的输出字节数，输出对应长度摘要（单向）。",
    examples: [
      { in: "(空字符串)", param: "32 字节", out: "46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f", desc: "空输入挤出 32 字节" },
    ],
    tips: [
      "同样有前缀性质：短输出是长输出的前缀。",
    ],
    aka: ["shake-256", "xof256", "可扩展输出函数256", "SHAKE256", "SHAKE-256", "extendable output function 256", "可变长哈希256", "keccak XOF256", "shake256摘要", "变长输出哈希256", "FIPS 202 XOF256", "高强度XOF"],
  },
};
