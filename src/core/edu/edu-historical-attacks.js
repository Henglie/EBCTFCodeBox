/*
 * edu-historical-attacks.js — Bombe / MultipleBombe / Colossus 科普卡
 */
export default {
  bombe: {
    what: "Bombe 是二战英国用于攻击 Enigma 的机电计算机。给定一段已知明文 crib，它并行模拟大量 Enigma 转子起点，用接线板矛盾快速排除错误配置。",
    principle:
      "把 crib 与密文的对应关系画成 menu 图：字母是节点，每次 Enigma 变换是边。Bombe 对一组转子起点同时通电，借助 diagonal board 让接线板约束互相传播；没有矛盾的配置就是 stop。\n\nStop 只给出转子起点和部分接线板，通常还要用 checking machine 或人工补全剩余接线板。Bombe 不模拟转子步进，crib 跨过中轮步进时可能失效。",
    usage:
      "`rotors` 每行一个转子，左→右，支持 3 或 4 个；`reflector` 填 B/C/B Thin/C Thin 或 13 对字母；`crib` 填已知明文，`offset` 是它在密文中的偏移；`check` 开启 checking machine。输出为 rotor stops、部分接线板和解密预览。",
    examples: [
      { in: "BBYFLTHHYIJQAYBBYS", param: "rotors=I/II/III, reflector=B, crib=THISISATESTMESSAGE, offset=0, check=1", out: "LGA  SS AG BO CL EK FF HH II JJ TT YY  THISISATESTMESSAGE", desc: "标准 3 转子 checking machine 向量" },
    ],
    tips: [
      "Enigma 不会把字母加密成自身；crib 与密文同位置字母相同就可以直接排除该偏移。",
      "crib 越长越容易跨过中轮步进；Bombe 不计步进，出现部分正确后突然错位时优先怀疑这里。",
      "stop 不等于唯一解；检查机通过后仍需补全剩余接线板。",
    ],
    aka: ["Bombe", "图灵炸弹机", "炸弹机", "Enigma Bombe", "Bombe machine", "图灵炸弹", "Enigma 攻击", "已知明文攻击", "crib 攻击", "Bombe 密码分析", "英国炸弹机", "Turing Bombe"],
  },

  multipleBombe: {
    what: "Multiple Bombe 在不知道转子组合时，把多组转子/反射器配置批量送进 Bombe，按候选质量排序输出，适合从转子池里找正确配置。",
    principle:
      "对转子池做排列组合，每组配置运行一次 Bombe；再用解密预览与 crib 的匹配数、已恢复接线板对数给 stop 打分。分数越高越可能是正确配置。\n\n运行次数与转子池大小成阶乘关系，必须设置预算；`maxRuns=0` 表示不限制，真实使用时应保持有限值。",
    usage:
      "`rotors` 填主转子池（每行一个），`fourthRotors` 填第 4 转子池（可空），`reflectors` 填反射器池；`crib`/`offset`/`check` 与 Bombe 相同；`maxRuns` 控制最多运行次数。输出按 run 分组，并标出最佳候选。",
    examples: [
      { in: "BBYFLTHHYIJQAYBBYS", param: "rotors=I/II/III/IV/V, reflector=B, crib=THISISATESTMESSAGE, maxRuns=60", out: "LGA  SS  VFISUSGTKSTMPSUNAK", desc: "3 转子池中定位 LGA/SS" },
    ],
    tips: [
      "转子池越大，组合爆炸越快；先用小池和短 crib 验证方向，再扩池。",
      "评分只是候选排序，不是密码学证明；最终仍要看解密预览是否成句。",
      "4 转子池全排列可能超过单次安全预算，必要时拆池分批跑。",
    ],
    aka: ["Multiple Bombe", "MultipleBombe", "批量炸弹机", "多配置 Bombe", "转子池 Bombe", "Enigma 批量攻击", "Bombe 多跑", "多转子搜索", "Multiple Bombe machine", "Bombe 搜索", "Enigma 转子搜索", "批量 crib 攻击"],
  },

  colossus: {
    what: "Colossus 是世界上第一台电子计算机，二战时用于统计 Lorenz SZ40/42 密文的脉冲规律，帮助破译德国高层电报。",
    principle:
      "Colossus 读取纸带上的 ITA2 字符，按 QBus 选择把 Z（密文）、ΔZ、χ、Δχ、ψ、Δψ 组合成五路脉冲，再用条件开关和加法开关统计满足模式的次数。\n\n它不直接解出明文，而是通过大量计数找出 χ 轮或 ψ 轮的起始位置；操作员再结合限制条件与 crib 推导密钥。",
    usage:
      "`pattern` 选 KH/ZMUG/BREAM；`qbusZ/qbusChi/qbusPsi` 选择脉冲来源；`limitation` 设置 χ2/P5 等限制；`program` 可直接选 Letter Count、1+2 Break In、4=5=/1=2、/,5,U；`starts` 填 12 轮起始位置。输出 printer 文本和 C1-C5 计数器。",
    examples: [
      { in: "CTBKJUVXHZ-H3L4QV+YEZUK+SXOZ/N", param: "KH Pattern, QBus Z, Letter Count, starts 全 1", out: "00 00 : a30", desc: "统计 30 个字符" },
    ],
    tips: [
      "Colossus 是计数/破译机，不是 Lorenz 加解密机；要看加解密请用 `lorenz`。",
      "`/,5,U` 程序统计三个特征字符，用于定位 X3；1+2 与 4=5 程序的 Set Total 门槛会直接影响输出行数。",
      "QBus 组合与限制条件必须与纸带样本匹配；错一个开关就会得到大量无意义计数。",
    ],
    aka: ["Colossus", "巨人计算机", "Colossus 计算机", "Colossus 破译机", "Lorenz 破译", "Tunny 破译", "Bill Tutte", "Tommy Flowers", "Colossus computer", "Colossus machine", "布莱切利 Colossus", "计数破译机"],
  },
};
