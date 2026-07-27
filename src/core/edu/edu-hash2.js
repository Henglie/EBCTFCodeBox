// 科普内容分片：hash 段 12-22（sm3/ripemd160/blake2b/blake2s/adler32/crc8/crc8_maxim/crc64/crc32c/fnv1a_32/fnv1a_64）。纯数据，无 import 无副作用。
export default {
  sm3: {
    what: "国密哈希算法（GM/T 0004），中国自研的密码学摘要，输出 256 位（64 个十六进制字符）。国内 CTF 里出现频率很高，是 SHA-256 的国产对位物。",
    principle:
      "结构上像 SHA-256 的近亲：把数据按 512 位分块，用 64 步压缩函数搅拌一个 256 位内部状态，最后输出 256 位摘要。用了两个布尔函数和一组常量做非线性扩散。单向不可逆。",
    usage: "输入任意文本，输出 SM3 摘要（单向 run）。想反查原文走字典爆破。",
    examples: [
      { in: "abc", out: "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0", desc: "GM/T 0004 标准测试向量" },
    ],
    tips: [
      "64 位十六进制里，SM3 和 SHA-256、SHA3-256、Keccak-256 肉眼分不出，靠题面「国密 / 商密 / GM」判断。",
      "题目提国密体系时，哈希多半是 SM3，分组加密多半是 SM4。",
    ],
    aka: ["sm3", "国密sm3", "商用密码哈希", "gm/t 0004", "国密哈希", "sm3哈希", "商密sm3", "中国哈希算法", "国产哈希", "sm-3", "gm sm3", "sm3摘要"],
  },

  ripemd160: {
    what: "欧洲设计的哈希算法，输出 160 位（40 个十六进制字符）。最出名的用途：比特币地址就是先 SHA-256 再 RIPEMD-160 算出来的。",
    principle:
      "分块迭代压缩，输出 160 位。特点是「双线并行」：同一块数据同时跑两条不同的 5 轮运算链，最后把两条结果合并，比单链设计更抗分析。单向不可逆。",
    usage: "输入文本，输出 RIPEMD-160 摘要（单向 run）。",
    examples: [
      { in: "abc", out: "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc", desc: "官方测试向量" },
    ],
    tips: [
      "40 位十六进制既可能是 SHA-1 也可能是 RIPEMD-160，长度一样，靠题面区分。",
      "题面出现比特币 / P2PKH 地址 / `HASH160` → 就是 SHA-256 套 RIPEMD-160。",
    ],
    aka: ["ripemd-160", "ripemd", "比特币hash160", "ripemd160", "hash160", "ripe md 160", "比特币地址哈希", "ripemd哈希", "race integrity primitives", "160位哈希", "ripe-md", "p2pkh哈希"],
  },

  blake2b: {
    what: "现代高速哈希 BLAKE2 的 64 位优化版（RFC 7693），又快又安全，默认输出 512 位，最多可取 64 字节。很多新软件用它替代 MD5/SHA。",
    principle:
      "脱胎于 SHA-3 决赛落选者 BLAKE，核心是 ChaCha 风格的 quarter-round 混合，用 64 位字运算，为 64 位平台优化。输出长度可自定义（1-64 字节），还支持带 key 当 MAC 用。单向不可逆。",
    usage: "输入文本，输出 BLAKE2b 摘要（默认 512 位 = 128 个 hex，单向 run）。",
    examples: [
      { in: "abc", out: "ba80a53f981c4d0d6a2797b69f12f6e94c212f14685ac4b74b12bb6fdbffa2d17d87c5392aab792dc252d5de4533cc9518d38aa8dbf1925ab92386edd4009923", desc: "RFC 7693 默认 512 位输出" },
    ],
    tips: [
      "比 SHA-256 快还更安全，是现代项目的常见选择。",
      "64 位字运算是 blake2b 的定位，32 位平台上更快的是 blake2s。",
    ],
    aka: ["blake2b", "blake2", "blake-2b", "blake 2b", "rfc 7693", "blake2哈希", "blake二代", "blake2b-512", "64位blake2", "blake2b hash", "现代快速哈希", "blake家族"],
  },

  blake2s: {
    what: "BLAKE2 的 32 位版本（RFC 7693），为 32 位平台和小设备优化，默认输出 256 位，最多 32 字节。功能和 blake2b 对等，只是字长更小。",
    principle: "同 BLAKE2 家族的 ChaCha 风格混合，改用 32 位字、10 轮，适合嵌入式和 32 位环境。输出长度可自定义（1-32 字节）。单向不可逆。",
    usage: "输入文本，输出 BLAKE2s 摘要（默认 256 位 = 64 个 hex，单向 run）。",
    examples: [
      { in: "abc", out: "508c5e8c327c14e2e1a72ba34eeb452f37458b209ed63a294d999b4c86675982", desc: "RFC 7693 默认 256 位输出" },
    ],
    tips: [
      "blake2s 对 blake2b：`s` = small（32 位字，输出上限 32 字节），`b` = big（64 位字，上限 64 字节）。",
    ],
    aka: ["blake2s", "blake-2s", "blake 2s", "blake2s-256", "32位blake2", "blake2s hash", "小端blake2", "blake二代32位", "blake2 small", "rfc 7693 blake2s", "嵌入式哈希", "blake家族32位"],
  },

  adler32: {
    what: "zlib 用的一种快速校验和（RFC 1950），输出 32 位。比 CRC32 算得更快，但对短数据的检错能力弱一些。它是校验和不是哈希。",
    principle:
      "维护两个累加值 A、B：A 是所有字节之和、B 是每步 A 的累加和，都对质数 `65521` 取模，最后拼成 `B<<16 | A`。加法运算比 CRC 的多项式除法轻，所以快。\n\n" +
      "A 初值 1（不是 0），这是它的一个小细节。",
    usage: "输入数据，输出 Adler-32 校验值（十六进制，单向 run）。",
    examples: [
      { in: "Wikipedia", out: "0x11E60398", desc: "维基条目里的经典示例" },
    ],
    formulas: [
      { tex: "A = 1 + \\textstyle\\sum d_i \\bmod 65521,\\quad B = \\textstyle\\sum A_i \\bmod 65521", caption: "Adler-32 双累加器" },
    ],
    tips: [
      "zlib 数据流尾部那 4 字节就是 Adler-32，可用来校验解压是否正确。",
      "短数据下 Adler-32 检错不如 CRC32，但速度占优。",
    ],
    aka: ["adler-32", "adler", "zlib校验和", "adler32", "adler校验和", "adler checksum", "rfc 1950", "zlib adler", "adler32校验", "adler32 checksum", "校验和adler", "双累加器校验"],
  },

  crc8: {
    what: "8 位的循环冗余校验，这一档用 SMBus 参数（多项式 `0x07`）。传感器、SMBus/PMBus 等短报文协议用它做单字节校验。",
    principle: "原理同 CRC32，只是寄存器 8 位、多项式 `0x07`，init=0、不反射、xorOut=0。输出就一个字节（两位十六进制）。查表法逐字节推进。",
    usage: "输入数据，输出 8 位 CRC 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0xF4", desc: "CRC-8/SMBUS 标准校验值" },
    ],
    tips: [
      "只有一字节校验，碰撞概率高，仅用于短数据检错。",
      "CRC-8 也有多种变体，对不上先怀疑参数选错。",
    ],
    aka: ["crc-8", "crc8/smbus", "循环冗余校验8", "crc8", "crc-8/smbus", "8位crc", "crc8校验", "smbus crc", "crc8 poly 0x07", "循环冗余校验码8", "crc8 checksum", "单字节crc"],
  },

  crc8_maxim: {
    what: "CRC-8 的 Dallas/Maxim 1-Wire 变体（多项式 `0x31` 反射实现）。DS18B20 温度传感器等 1-Wire 器件的 ROM 校验就用它。",
    principle: "8 位 CRC，参数为 poly=0x31、init=0、refIn/refOut=true（位反射）、xorOut=0。反射意味着按位从低位开始处理，和 SMBus 那档正好相反。",
    usage: "输入数据，输出 CRC-8/MAXIM 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0xA1", desc: "CRC-8/MAXIM 标准校验值" },
    ],
    tips: [
      "题面出现 1-Wire / DS18B20 / Dallas / Maxim → 用这一档而非 SMBus 那档。",
    ],
    aka: ["crc-8/maxim", "crc8 dallas", "1-wire crc", "crc8/maxim-dow", "crc8 maxim", "ds18b20 crc", "dallas 1-wire", "crc8/dow", "maxim crc8", "crc8 poly 0x31", "1线crc", "单总线crc"],
  },

  crc64: {
    what: "64 位的循环冗余校验，这一档用 ECMA-182 参数（多项式 `0x42F0E1EBA9EA3693`）。XZ 压缩格式用它校验大文件完整性。",
    principle: "原理同其他 CRC，寄存器宽到 64 位、多项式更长，因此碰撞概率极低，适合大数据完整性校验。ECMA-182 变体：init=0、不反射、xorOut=0。",
    usage: "输入数据，输出 64 位 CRC 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0x6C40DF5F0B497347", desc: "CRC-64/ECMA-182 标准校验值" },
    ],
    tips: [
      "16 位十六进制的校验和多半是 CRC-64。",
      "XZ / .xz 文件用 CRC-64 校验，题面提到就往这想。",
    ],
    aka: ["crc-64", "crc64/ecma-182", "crc64/xz", "crc64", "64位crc", "crc64 ecma", "ecma-182", "xz crc", "crc64校验", "循环冗余校验64", "crc64 checksum", "大文件crc"],
  },

  crc32c: {
    what: "CRC-32 的 Castagnoli 变体（多项式 `0x1EDC6F41`），检错能力比 IEEE 版更好。iSCSI、ext4、SSE4.2 硬件指令都用它，注意它和普通 CRC32 结果不同。",
    principle: "同 CRC32 的多项式除法，只是换了 Castagnoli 多项式 `0x1EDC6F41`（反射实现 `0x82F63B78`），init=0xFFFFFFFF、位反射、末异或 0xFFFFFFFF。这个多项式在检错性质上优于 IEEE 802.3 那个。",
    usage: "输入数据，输出 CRC-32C 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0xE3069283", desc: "CRC-32C/Castagnoli 标准校验值（与 IEEE CRC32 的 0xCBF43926 不同）" },
    ],
    tips: [
      "同是 8 位十六进制，CRC-32C 和普通 CRC32 结果完全不同，别混。x86 的 `crc32` 指令算的正是这个。",
      "题面出现 iSCSI / ext4 / SSE4.2 → CRC-32C。",
    ],
    aka: ["crc-32c", "crc32c", "castagnoli", "crc32/iscsi", "crc32 castagnoli", "iscsi crc", "sse4.2 crc", "crc32c校验", "ext4 crc", "crc32 poly 0x1edc6f41", "castagnoli crc", "硬件crc32"],
  },

  fnv1a: {
    what: "FNV-1a 是一族极简的非加密哈希，专为哈希表 / 快速散列设计，不做安全。位宽可选 32/64（默认 32）：32 位输出 8 个十六进制字符，64 位输出 16 个。",
    principle:
      "逐字节「先异或后乘」（`1a` 指这个顺序，FNV-1 是先乘后异或）。32 位：offset=`0x811C9DC5`、prime=`0x01000193`，模 $2^{32}$。64 位：offset=`0xCBF29CE484222325`、prime=`0x100000001B3`，模 $2^{64}$。两档只差偏移基和质数，循环结构一致。",
    usage: "输入数据，选位宽，输出 FNV-1a 哈希（十六进制，单向 run）。",
    examples: [
      { in: "(空字符串, 32)", out: "0x811C9DC5", desc: "空输入直接是 32 位 offset basis" },
      { in: "(空字符串, 64)", out: "0xCBF29CE484222325", desc: "空输入直接是 64 位 offset basis" },
    ],
    formulas: [
      { tex: "h \\leftarrow (h \\oplus b_i)\\times \\mathtt{prime} \\bmod 2^{n}", caption: "FNV-1a 每字节：先异或后乘（n=32 或 64）" },
    ],
    tips: [
      "认特征：常量 `0x811C9DC5`/`0x01000193` → 32 位；`0xCBF29CE484222325`/`0x100000001B3` → 64 位。",
      "非加密哈希，别当安全摘要，常见于程序内部散列 / 一致性哈希。",
    ],
    aka: ["fnv-1a", "fnv1a-32", "fnv1a-64", "fnv 32位", "fnv 64位", "fowler noll vo", "fnv1a", "fnv哈希", "fnv hash", "非加密哈希", "fowler-noll-vo", "fnv散列"],
  },
};
