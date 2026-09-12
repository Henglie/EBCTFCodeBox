// 科普内容分片：hash 前沿补全三件（argon2/tiger/kupyna，T398 批B）。纯数据，无 import 无副作用。
export default {
  argon2: {
    what: "目前最强的口令哈希 / 密钥派生函数（KDF），2015 年密码哈希竞赛（PHC）冠军，RFC 9106 标准。GPU 和专用矿机挖它非常不划算，所以存密码首选它。",
    principle:
      "在 scrypt 思路上更进一步：内存困难 + 多遍迭代 + 可选多线程，三层抗ASIC设计。\n\n" +
      "三个变体：Argon2d 按数据内容寻址（最快但抗侧信道弱）；Argon2i 全程数据无关寻址（抗侧信道， trade memory-time 7 次）；Argon2id 前半数据无关后半数据相关（混合，推荐默认）。\n\n" +
      "核心参数三件套：内存 m（KiB）、迭代 t、并行度 p，另可附加 secret 和关联数据。安全性随三个参数同时提升，缺一不可。",
    usage: "输入口令和盐，输出指定长度的派生密钥（单向 run）。注意：口令和盐支持文本或 hex 格式切换，secret 和关联数据只接受 hex 且可留空。m 上限 64 MiB、t 上限 1024（页面防卡死护栏）。",
    examples: [
      { in: "password", param: "type=argon2id, t=2, m=256, p=1, tagLen=32, salt=somesalt12345678", out: "8110e1165eb0e1114ee37d5ff017573ba0084b8366b4108db44749954b8d9871", desc: "argon2-cffi 25.1.0 对拍验证向量" },
    ],
    tips: [
      "题面给 \$argon2id\$v=19\$m=65536,t=2,p=1\$…\$…\$ 的 PHC 字符串：第一段是参数，第二段是 salt（base64 无填充），第三段是 tag——对照本工具复现即可。",
      "v=19 就是 v=0x13（十进制 19），目前几乎所有实现都是这个版本。",
      "盐至少 8 字节，迭代×内存太小（如 m=8,t=1）安全性形同虚设；CTF 里若给的是弱参数可直接爆破。",
      "Argon2d/i/id 三型对同一输入输出完全不同，识别类型只能靠题面或 PHC 串。",
    ],
    aka: ["argon2", "argon2d", "argon2i", "argon2id", "argon2 kdf", "argon2 kdf 函数", "argon 哈希", "argon2哈希", "argon2id哈希", "argon2i哈希", "argon2d哈希", "phc冠军", "密码哈希竞赛", "password hashing competition", "口令哈希argon2", "内存困难kdf", "rfc 9106", "rfc9106", "argon2密码哈希", "argon2 密码派生", "memory hard kdf"],
  },

  tiger: {
    what: "Ross Anderson 和 Eli Biham 1996 年设计的 192 位哈希（就是设计 Serpent 分组密码的两位大佬），专为 64 位机器优化，在 eMule/ED2K 等 P2P 网络里用来做文件块校验（TTH 树）。",
    principle:
      "512 位分块，状态 3×64 位。每块做 3 大轮（乘数因子 5/7/9），每大轮 8 小轮轮转 a/b/c 三寄存器，小轮核心是 4 张 256 项 64-bit S-box 查表异或 + 乘法扩散，大轮之间做一次消息扩展（key schedule）。\n\n" +
      "有个特别细节：消息按小端装载进 64 位字，但填充用 0x01（不是 SHA 系的 0x80），长度按 64 位小端追加——这也是 Tiger 和 Tiger2 唯一的区别（Tiger2 改用 0x80，和 MD5/SHA 一致）。",
    usage: "输入任意文本或 hex，输出 48 个十六进制字符（192 位，单向 run）。参数里选 Tiger（原版 0x01 填充）或 Tiger2（0x80 填充）。",
    examples: [
      { in: "", out: "3293ac630c13f0245f92bbb1766e16167a4e58492dde73f3", desc: "Tiger(\"\")，NESSIE 官方向量" },
      { in: "", param: "variant=tiger2", out: "4441be75f6018773c206c22745374b924aa8313fef919f41", desc: "Tiger2(\"\")，作者官网向量" },
      { in: "abc", out: "2aab1484e8c158f2bfb8c5ff41b57a525129131c957b5f93", desc: "NESSIE 官方向量" },
    ],
    tips: [
      "48 位十六进制既可能是 Tiger 也可能是 3×SHA-1 拼接或 SHA-384 截断，靠题面 P2P/ED2K/Magnet 关键词判断。",
      "Tiger 和 Tiger2 对同一消息输出完全不同，且 64 字节整块边界附近（55~64 字节）填充行为最容易被实现搞错。",
      "CTF 出 Tiger 多出现在老 P2P 取证题、TTH 树哈希、或要求你手写填充的题。",
      "注意：有些老实现（libgcrypt 旧版、Linux 内核）把摘要按「每 8 字节反转」打印，遇到对不上的 hex 先试试逐字反转。",
    ],
    aka: ["tiger", "tiger hash", "tiger/192", "tiger192", "tiger-192", "tiger192bit", "tiger2", "tiger 2", "tiger tree hash", "tth", "tth哈希", "anderson biham", "anderson-biham", "ed2k哈希", "p2p哈希", "p2p校验", "magnet链接哈希", "tiger哈希", "tiger摘要", "192位哈希", "emule校验"],
  },

  kupyna: {
    what: "乌克兰国家标准哈希 DSTU 7564:2014，2015 年发布，和乌克兰国密分组密码 Kalyna 是同一批人设计的。名字来自一种植物（玉竹）。本质上是个 Grøstl（SHA-3 决赛候选）的近亲。",
    principle:
      "AES 风格的置换-截断结构：512/1024 位大状态，10 轮（256 档）或 14 轮（384/512 档）。每两轮一组：奇数轮做「加轮常量 + SubBytes+MixColumns 复合 + 平移」，偶数轮做「加常量 + 模 $2^{64}$ 加法混合」——两套轮函数 P/Q 并行吃同一消息，最后异或压缩，输出前再做一次 P 置换。\n\n" +
      "S-box 和 MDS 矩阵与 Kalyna 复用同一套 $GF(2^{8})$ 运算（多项式 $x^8+x^4+x^3+x^2+1$）。",
    usage: "输入任意文本或 hex，输出 64/96/128 个十六进制字符（对应 256/384/512 位，单向 run）。填充是 0x80 + 12 字节小端位长，和常见的 MD/SHA 系不同。",
    examples: [
      { in: "", out: "cd5101d1ccdf0d1d1f4ada56e888cd724ca1a0838a3521e7131d4fb78d0f5eb6", desc: "Kupyna-256(\"\")，DSTU 标准公开向量" },
      { in: "The quick brown fox jumps over the lazy dog", out: "996899f2d7422ceaf552475036b2dc120607eff538abf2b8dff471a98a4740c6", desc: "Kupyna-256 快狐狸向量" },
    ],
    tips: [
      "题面出现乌克兰 / DSTU / ДСТУ / Купина / Kopyna 关键词时优先考虑。",
      "256 档输出 64 hex，和 SM3/SHA-256 一样长，只能靠题面区分。",
      "Kupyna-384/512 是同一状态（1024 位块）算完取不同尾部，所以 384 的输出一定是 512 输出的后 96 位——工具里两者可以互验。",
      "它不是 Merkle–Damgård 结构，没有长度扩展攻击，别拿 hashclash 那套硬套。",
    ],
    aka: ["kupyna", "kupyna-256", "kupyna256", "kupyna-384", "kupyna384", "kupyna-512", "kupyna512", "kupyna hash", "dstu 7564", "dstu7564", "dstu 7564:2014", "dstu7564:2014", "dstu ukrainian hash", "ukrainian hash", "ukraine hash", "乌克兰国标哈希", "乌克兰哈希", "dstu哈希", "grøstl近亲", "grostl变体", "玉竹哈希"],
  },
};
