// 科普内容分片：hash 段 23-32（murmur3_32/crcGeneric/crc16Modbus/crc16CcittTrue/crc16Arc/crc16Xmodem/fletcher16/fletcher32/bsdSum/sysvSum）。纯数据，无 import 无副作用。
export default {
  murmur3_32: {
    what: "MurmurHash3 是一族快速非加密哈希，散列质量高、速度快，广泛用于哈希表 / 布隆过滤器 / 一致性哈希。这是 x86 32 位档，seed 默认 0。",
    principle:
      "把数据按 4 字节一块处理：每块乘一个常量、循环移位、再乘另一个常量后混进哈希；尾部不足 4 字节单独处理；最后做一段「雪崩」收尾（多次异或右移 + 乘法）让每一位输入都充分扩散。非加密，不抗恶意碰撞。",
    usage: "输入数据，输出 MurmurHash3 x86 32 位哈希（十六进制，单向 run）。",
    examples: [
      { in: "(空字符串)", param: "seed=0", out: "0x00000000", desc: "空输入 + seed 0 恰好是 0" },
    ],
    tips: [
      "CTF 里常作为程序内部散列出现；换 seed 结果就变，注意题目给的 seed。",
      "非加密哈希，能被针对性构造碰撞，别当安全摘要。",
    ],
    aka: ["murmurhash3", "murmur3", "murmur 32", "mmh3", "murmurhash", "murmur hash", "murmurhash3 x86 32", "非加密哈希", "murmur3_32", "murmur散列", "austin appleby"],
  },

  crcGeneric: {
    what: "一个「什么参数都能填」的通用 CRC 计算器。CRC 变体成百上千，与其一个个做成按钮，不如把六个参数开放给你自己配。",
    principle:
      "任何 CRC 变体都由六个参数唯一确定：`width`（位宽）、`poly`（生成多项式）、`init`（寄存器初值）、`refIn`（输入位是否反射）、`refOut`（输出位是否反射）、`xorOut`（末尾异或值）。把这六个填对，就能复现任意 CRC。工具还内置 CRC-16 / CRC-32 常用预设。",
    usage: "填 width/poly/init/refIn/refOut/xorOut（或选预设），输入数据，输出十六进制校验值（单向 run）。",
    examples: [
      { in: "123456789", param: "CRC-32 预设", out: "0xCBF43926", desc: "参数对上就能复现标准值" },
    ],
    tips: [
      "碰到不认识的 CRC，去 CRC 参数目录（catalogue）查那六个参数，填进来即可复现。",
      "用标准串 `123456789` 校验参数是否配对：算出的值和目录里的 `check` 值一致就说明填对了。",
    ],
    aka: ["通用crc", "crc参数化", "crc custom", "crc rocksoft", "自定义crc", "crc计算器", "parametric crc", "crc generic", "循环冗余校验", "cyclic redundancy check", "crc catalogue", "可配置crc"],
  },

  crc16Modbus: {
    what: "CRC-16 的 MODBUS 变体，工业 Modbus RTU 协议每帧尾部的校验就是它。参数固定：poly=`0x8005`, init=`0xFFFF`, 位反射。",
    principle: "16 位 CRC，poly=0x8005、init=0xFFFF、refIn/refOut=true（位反射）、xorOut=0。反射版实现里多项式常写成 `0xA001`。",
    usage: "输入数据，输出 CRC-16/MODBUS 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0x4B37", desc: "CRC-16/MODBUS 标准校验值" },
    ],
    tips: [
      "题面出现 Modbus / RTU / 工控协议 → 就是这一档。",
      "Modbus 帧里 CRC 常按小端摆放（低字节在前），解析时注意字节序。",
    ],
    aka: ["crc-16/modbus", "modbus crc", "crc16 modbus", "modbus rtu校验", "crc16/modbus", "工控crc", "0x8005 0xffff", "modbus checksum", "crc-16 modbus", "rtu crc", "工业协议校验"],
  },

  crc16CcittTrue: {
    what: "CRC-16 的 CCITT-FALSE 变体（poly=`0x1021`, init=`0xFFFF`, 不反射）。名字里带 FALSE 是历史误称，却是实际最常用的一档 CCITT 风格 CRC-16。",
    principle: "16 位 CRC，poly=0x1021、init=0xFFFF、refIn/refOut=false（不反射）、xorOut=0。多项式 0x1021 是 CCITT 系共用的，区别全在 init / 反射 / xorOut 的组合。",
    usage: "输入数据，输出 CRC-16/CCITT-FALSE 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0x29B1", desc: "CRC-16/CCITT-FALSE 标准校验值" },
    ],
    tips: [
      "CCITT 家族（CCITT-FALSE / XMODEM / KERMIT 等）都用 poly=0x1021，光看多项式分不出，得核对 init 和反射。",
    ],
    aka: ["crc-16/ccitt-false", "crc16 ccitt", "crc-16/ibm-3740", "ccitt false", "crc16/ccitt-false", "crc-16/autosar", "0x1021 0xffff", "ccitt crc", "crc16 ccitt false", "crc-ccitt", "ccitt风格crc"],
  },

  crc16Arc: {
    what: "CRC-16 的 ARC 变体（poly=`0x8005`, init=0, 位反射），老牌 LHA / ARC 压缩工具用它。也叫「CRC-16」裸称时通常指这一档。",
    principle: "16 位 CRC，poly=0x8005、init=0x0000、refIn/refOut=true（位反射）、xorOut=0。和 MODBUS 那档只差 init（这里是 0，MODBUS 是 0xFFFF）。",
    usage: "输入数据，输出 CRC-16/ARC 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0xBB3D", desc: "CRC-16/ARC 标准校验值" },
    ],
    tips: [
      "别人只说「CRC16」不给参数时，很多场合默认就是 ARC 这档，可先试它。",
    ],
    aka: ["crc-16/arc", "crc16 arc", "crc-ibm", "lha crc", "crc-16", "crc16", "arc crc", "crc-16/lha", "0x8005 init0", "crc16/arc", "裸crc16", "crc-16 ibm"],
  },

  crc16Xmodem: {
    what: "CRC-16 的 XMODEM 变体（poly=`0x1021`, init=0, 不反射），XMODEM 文件传输协议用它。",
    principle: "16 位 CRC，poly=0x1021、init=0x0000、refIn/refOut=false、xorOut=0。和 CCITT-FALSE 同多项式、同不反射，只差 init（这里 0，那档 0xFFFF）。",
    usage: "输入数据，输出 CRC-16/XMODEM 校验值（十六进制，单向 run）。",
    examples: [
      { in: "123456789", out: "0x31C3", desc: "CRC-16/XMODEM 标准校验值" },
    ],
    tips: [
      "poly 都是 0x1021，XMODEM 与 CCITT-FALSE 的差别只在 init（0 vs 0xFFFF），对不上先换 init 试。",
    ],
    aka: ["crc-16/xmodem", "crc16 xmodem", "crc-16/zmodem", "crc-ccitt xmodem", "xmodem crc", "crc16/xmodem", "0x1021 init0", "crc-16/acorn", "zmodem crc", "xmodem文件校验", "crc16 zmodem"],
  },

  fletcher: {
    what: "Fletcher 校验和，靠两个累加器实现，算得比 CRC 快、检错能力接近。它是校验和不是哈希。位宽可选 16/32（默认 16），32 位检错强于 16 位。",
    principle:
      "双累加器 sum1、sum2：每读一个单元，sum1 加该单元、sum2 再加 sum1，位置敏感（换顺序结果就变）。16 位：按字节流、两个 8 位累加器对 `255` 取模，输出 `sum2<<8 | sum1`。32 位：按 16 位字（小端），两个 16 位累加器对 `65535` 取模，奇数尾字节补 0，输出 `sum2<<16 | sum1`。分组粒度和模数两档都不同。",
    usage: "输入数据，选位宽，输出 Fletcher 校验值（十六进制，单向 run）。",
    examples: [
      { in: "abcde (16)", out: "0xC8F0", desc: "维基 Fletcher-16 经典示例" },
      { in: "abcde (32)", out: "0xF04FC729", desc: "维基 Fletcher-32 经典示例" },
    ],
    formulas: [
      { tex: "\\text{sum1} \\mathrel{+}= d_i,\\quad \\text{sum2} \\mathrel{+}= \\text{sum1}\\ (\\bmod\\ M)", caption: "Fletcher 双累加器（16 位 M=255，32 位 M=65535）" },
    ],
    tips: [
      "和 Adler-32 思路像（都双累加器），区别在模数：Fletcher-16 模 255，Adler 模 65521。",
      "32 位按 16 位字处理，奇数长度数据的补齐方式会影响结果，注意实现约定。",
    ],
    aka: ["fletcher-16", "fletcher16", "fletcher-32", "fletcher32", "弗莱彻校验和", "弗莱彻校验和32", "fletcher checksum", "弗莱彻校验", "双累加器校验和", "fletcher algorithm", "弗莱切校验和", "fletcher8"],
  },

  bsdSum: {
    what: "老 BSD 系统 `sum` 命令的校验和算法，输出 16 位。核心是「先循环右移再加」，比纯累加更能捕捉字节顺序变化。",
    principle:
      "维护一个 16 位值，每读一字节：先把当前值循环右移 1 位（最低位转到最高位），再加上该字节，对 $2^{16}$ 取模。那个循环旋转让它对字节位置敏感，比单纯求和强。",
    usage: "输入数据，输出 BSD checksum（十六进制 / 十进制，单向 run）。",
    examples: [
      { in: "任意数据", out: "16 位校验值", desc: "对应 BSD `sum` / `sum -r` 的输出" },
    ],
    tips: [
      "BSD `sum` 和 SysV `sum` 是两套不同算法，同一文件结果不同，别混。",
    ],
    aka: ["bsd checksum", "bsd sum", "sum -r", "bsd校验和", "bsd sum算法", "循环右移校验和", "unix sum", "bsd sum checksum", "16位bsd校验", "sum命令", "bsd风格校验和"],
  },

  sysvSum: {
    what: "System V 系统 `sum` 命令的校验和算法，输出 16 位。做法是「全字节相加再折叠」，比 BSD 那套更简单。",
    principle:
      "先把所有字节直接累加成一个大整数 s；再把它折叠进 16 位：取 `s = (s & 0xFFFF) + (s >> 16)`，可能再折叠一次，最终得到 16 位结果。没有旋转，所以对字节顺序不敏感（换序结果不变）。",
    usage: "输入数据，输出 SysV checksum（十六进制 / 十进制，单向 run）。",
    examples: [
      { in: "任意数据", out: "16 位校验值", desc: "对应 SysV `sum -s` 的输出" },
    ],
    tips: [
      "纯加法折叠 → 对字节顺序不敏感，这是它和 BSD sum（旋转，敏感）的本质区别。",
    ],
    aka: ["sysv checksum", "system v sum", "sum -s", "sysv校验和", "system v校验和", "sysv sum算法", "折叠校验和", "unix sysv sum", "16位sysv校验", "sysv sum checksum", "系统v求和"],
  },
};
