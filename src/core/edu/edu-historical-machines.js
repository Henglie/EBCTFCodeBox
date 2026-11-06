/*
 * edu-historical-machines.js — Typex / SIGABA / Lorenz 科普卡
 */
export default {
  typex: {
    what: "Typex 是二战英国在 Enigma 基础上改进的五转轮密码机，右侧两个转子固定不步进，左侧三个转子按 Enigma 规则步进，并带输入插线板与反射器插线板。",
    principle:
      "每个字母先过输入插线板，再依次经过 5 个转子、反射器，然后原路返回。转子接线、反转方向、环设置和初始位置共同决定映射。\n\n与 Enigma 的区别：\n\n1. 5 个转子，右两个固定，仅左侧 3 个步进；\n2. 转子可整体反转安装；\n3. 输入插线板是任意 26 字母置换，不是两两交换；\n4. 键盘模拟用 `Z` 进入符号模式、`V` 退出符号模式，把数字和标点压进 A-Z 通道。",
    usage:
      "`rotors` 每行一个转子：`接线<步进点|反转|环|初始`；`reflector` 写 13 对字母；`plugboard` 写 26 字母接线。加密/解密使用同一组设置（自反）。`keyboard` 选 Encrypt/Decrypt 可模拟 Typex 键盘。",
    examples: [
      { in: "hello world, this is a test message.", param: "默认示例转子，keyboard=None，strict=true", out: "VIXQQ VHLPN UCVLA QDZNZ EAYAT HWC", desc: "标准示例向量" },
      { in: "hello world, this is a test message.", param: "keyboard=Encrypt，其余默认", out: "VIXQQ FDJXT WKLDQ DFQOD CNCSK NULBG JKQDD MVGQ", desc: "键盘符号模式" },
      { in: "VIXQQ FDJXT WKLDQ DFQOD CNCSK NULBG JKQDD MVGQ", param: "keyboard=Decrypt，其余默认", out: "HELLO WORLD, THIS IS A TEST MESSAGE.", desc: "自反解密" },
    ],
    tips: [
      "真实 Typex 转子接线未公开，本项目与公开实现一样使用示例接线，不能当作历史密钥恢复。",
      "右两个转子不步进是 Typex 与 Enigma 最直观的区别。",
      "同时设置环和初始位置时，步进点会随环偏移；对不上向量时先核这两项。",
    ],
    aka: ["Typex", "Typex 密码机", "Typex Mark 22", "英国 Typex", "英国转轮密码机", "Typex 转轮机", "英国二战密码机", "RAF Typex", "Typex cipher", "Typex machine", "Typex 加密", "Typex 解密"],
  },

  sigaba: {
    what: "SIGABA（ECM Mark II）是美国二战到 1950 年代使用的高安全转轮密码机，共 15 个转轮：5 个密码轮、5 个控制轮、5 个索引轮。",
    principle:
      "每个字母先经过 5 个密码轮加密，然后控制轮从右向左产生 4 个输出，索引轮把它们映射成 0-9 的步进信号，按固定逻辑决定哪些密码轮向前走一步。\n\n因为控制轮和索引轮持续变化，密码轮的步进序列极不规则；加密与解密方向相反，不是自反操作。\n\n控制轮只有 3 个会步进：快速轮每字符一步，中速轮在快速轮到达 O 时一步，慢速轮在中速轮也到达 O 时一步。",
    usage:
      "`cipherRotors`、`controlRotors` 各 5 行：`接线|反转|初始`；`indexRotors` 5 行：`0-9 接线|初始`。加密用 encode，解密用 decode；空格在加密前转成 `Z`，明文 `Z` 转成 `X`。",
    examples: [
      { in: "HELLO WORLD TESTING THE SIGABA MACHINE", param: "默认示例转子", out: "ULBECJCZJBJFVUDWAVRGRBMPSQHOTTNVQEESKN", desc: "示例加密向量" },
      { in: "ULBECJCZJBJFVUDWAVRGRBMPSQHOTTNVQEESKN", param: "默认示例转子，decode", out: "HELLO WORLD TESTING THE SIGABA MACHINE", desc: "反向解密" },
    ],
    tips: [
      "SIGABA 的 15 个转子接线同样使用公开示例值，不代表真实历史密钥。",
      "加密与解密不能点同一个按钮；decode 必须使用与加密相同的转子与初始位置。",
      "控制轮、索引轮不参与字母替换，只控制密码轮步进，排错时不要把它们当普通转子交换。",
    ],
    aka: ["SIGABA", "ECM Mark II", "ECM Mk II", "美国 SIGABA", "SIGABA 密码机", "美国二战密码机", "15 转轮密码机", "SIGABA 转轮机", "SIGABA cipher", "SIGABA machine", "ECM 密码机", "SIGABA 加密", "SIGABA 解密"],
  },

  lorenz: {
    what: "Lorenz SZ40/42 是二战德国用于高层电报的十二轮密码附件：5 个 χ 轮、5 个 ψ 轮、2 个 μ 马达轮，输出 ITA2 五单位密钥流与明文异或。",
    principle:
      "每个 ITA2 字符是 5 个比特，分别与当前 χ、ψ 轮凸轮位异或。χ 轮每字符都步进；ψ 轮只在马达条件满足时步进；μ61 每字符步进，μ37 由 μ61 凸轮控制。\n\nSZ42a/42b 增加限制条件（χ2、ψ1、P5），KT-Schalter 会改变限制判断。\n\n发送与接收使用同一密钥流，因此加密和解密是同一异或过程，但方向参数会影响限制逻辑。",
    usage:
      "`starts` 按 `Ψ1-5 Μ37 Μ61 Χ1-5` 顺序填 12 个 1-based 起始值。`pattern` 可选 KH/ZMUG/BREAM/No Pattern/Custom；Custom 时 `customLugs` 按 12 行填写凸轮（`.` 无效、`x` 有效）。发送选 encode，接收选 decode。",
    examples: [
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ40 / KH Pattern / 起始全 1", out: "VIC3TS/CUJA/3II9W9JWDI5DAFXT4SOIF3999IZD9T", desc: "KH 图案示例" },
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ40 / No Pattern / 起始全 1", out: "HELLO9WORLD55N889THIS9IS9A9TEST9MESSAGE55M", desc: "仅 ITA2 转换，不加密" },
      { in: "HELLO WORLD, THIS IS A TEST MESSAGE.", param: "SZ42a / KH Pattern / 起始全 1", out: "VIC3TS/ZOHUYXWLTUXPV9ZNOTW9IXJPFDLIBB5ZD9K", desc: "SZ42a 限制逻辑" },
    ],
    tips: [
      "Lorenz 与 Enigma 是两种不同机器；Lorenz 没有反射器，输出是二进制密钥流异或。",
      "ITA2 的 5/8/9 是字母/数字/空格转换符，不是普通数字；输入明文时 op 会自动插入转换。",
      "起始值是 1-based 轮位，不是 0-based；范围随轮径变化，错一位就会整段错位。",
    ],
    aka: ["Lorenz", "Lorenz SZ40", "Lorenz SZ42", "SZ40", "SZ42a", "SZ42b", "洛伦茨密码", "洛伦兹密码机", "Lorenz 密码附件", "Lorenz cipher", "Lorenz machine", "Tunny", "金枪鱼密码"],
  },
};
