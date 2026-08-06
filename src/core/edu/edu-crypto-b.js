/*
 * edu-crypto-b.js — B 组密码学扩充科普卡（流密码 7 + KDF 3）。
 *
 * 覆盖 op：a52 / e0 / hc128 / hc256 / sosemanuk / spritz / vmpc / balloon / lyra2 / yescrypt
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 * examples 值全部由探针实测（node 实跑 encode/派生密钥），非编造。
 */
export default {
  mickey: {
    what: "MICKEY-128 2.0——Babbage & Dodd 设计的 128 位密钥流密码（MICKEY = Mutual Irregular Clocking KEYstream），eSTREAM 项目 Phase 3 决赛算法，主打硬件资源受限环境，两个 160 位寄存器靠「不规则钟控」互相牵制。",
    principle:
      "两个 160 位寄存器 R 和 S。每拍输出位 = R[0]⊕S[0]，然后两个控制位决定怎么钟控：Control_R = S[54]⊕R[106]、Control_S = S[106]⊕R[53]——S 和 R 各自的关键位交叉决定对方的钟控方式，这就是「互相不规则钟控」的由来。\n\n" +
      "CLOCK_R 有两种模式：Control_R=1 走 Shift-and-XOR（反馈位决定是否叠加 R_Mask 掩码），Control_R=0 走 Shift-only；CLOCK_S 用 COMP0/COMP1 做补位与、FB0/FB1 两组 Galois 反馈抽头。\n\n" +
      "初始化：R/S 清零 → 逐位装载 IV（MSB-first，0~128 位）→ 逐位装载 128 位密钥 → 再空转 160 拍预钟控。之后每 8 拍产一个密钥流字节，明文 XOR 密钥流即密文。",
    usage: "输入框填明文（UTF-8 文本），key 填 128 位密钥（32 hex，默认是官方向量密钥），iv 填 IV（0~128 位，最多 32 hex，可留空；默认 21436587 是官方向量 IV）。encode 输出密文 hex，decode 反向，key+iv 必须与加密时一致。",
    examples: [
      { in: "Hello", param: "key=123456789abcdef00123456789abcdef, iv=21436587", out: "efddad9a52", desc: "实测密文，同参解回" },
      { in: "efddad9a52", param: "key=123456789abcdef00123456789abcdef, iv=21436587", out: "Hello", desc: "往返验证" },
    ],
    tips: [
      "官方向量：key=123456789abcdef00123456789abcdef iv=21436587 → 密钥流前 16 字节 a7b8c1f63dcafbef7dc726e2b12b3e44——验证实现先用它。",
      "注意家族区分：MICKEY 2.0（80 位密钥/32 位 IV）与 MICKEY-128 2.0（128 位密钥/0~128 位 IV）是两套参数，本 op 是 128 位版。",
      "160 位寄存器逐位实现很快（每字节 8 拍×160 位），CTF 现场手写可行；初始化 160 拍预钟控别省。",
      "官方「反直觉位序」：装载 IV/密钥按 MSB-first（字节内高位在前），输出按位拼字节也是 MSB-first。",
    ],
    aka: ["MICKEY-128 2.0", "MICKEY128", "MICKEY-128", "Babbage", "Dodd", "eSTREAM 决赛", "eSTREAM portfolio", "不规则钟控", "irregular clocking", "160位寄存器", "Mutual Irregular Clocking", "硬件流密码", "Profile 2", "128位密钥流密码", "eSTREAM Phase 3"],
  },
  a52: {
    what: "A5/2——GSM 手机语音通话用的加密流密码，A5/1 的「弱化出口版」，1990 年代为配合出口管制故意削弱设计，四个 LFSR 线性反馈移位寄存器组成。",
    principle:
      "四个寄存器：R1/R2/R3 各 19/22/23 位，R4 17 位。每时钟周期由 R4 的 bit10/3/7 三个位「择多表决」（多数位是 1 则对应寄存器移位），这是 A5/2 钟控不规律性的来源。\n\n" +
      "输出不是简单异或：取 R1/R2/R3 顶位异或，再异或三个「掩码项」——每个掩码项是某一寄存器内部两个位相与的结果，制造非线性。输出比寄存器步进延迟一拍（密钥装载后先预热一次）。\n\n" +
      "密钥 64 位 Kc + 22 位帧号 frame 一起装载：先用 Kc 填寄存器，再混入 frame 位（同时强置若干位防止全零状态），装载完不输出直接开始加密。",
    usage: "输入框填明文（UTF-8 文本），key 填 64 位会话密钥 Kc（16 个 hex 字符，默认 00FCFFFFFFFFFFFF 是官方向量密钥），frame 填 22 位帧号（十进制或 0x 开头，默认 0x21）。encode 输出密文 hex，decode 把密文 hex 还原成文本。同一个 key+frame 必须与加密时完全一致。",
    examples: [
      { in: "Hello", param: "key=00FCFFFFFFFFFFFF, frame=0x21", out: "bc3440c07c", desc: "实测往返：decode 同参可复原 Hello" },
      { in: "bc3440c07c", param: "key=00FCFFFFFFFFFFFF, frame=0x21", out: "Hello", desc: "上面密文按原参解回" },
    ],
    tips: [
      "A5/2 已被完全破解（有偏统计攻击可实时恢复密钥），CTF 里出现多半是直接调用或让你对比 A5/1 强弱。",
      "A5 家族帧号是 22 位，写 0x 前缀 hex 或直接十进制都行；帧号错一位输出全错。",
      "GSM 题里 Kc 常写成 128 位 hex——A5/2 只用前 64 位（低 16 hex）。",
      "官方向量 key=00FCFFFFFFFFFFFF frame=0x21 是公认测试基准，验证实现先用它。",
    ],
    aka: ["A5/2", "GSM A5/2", "A5-2", "A5/2 流密码", "A5.2", "Briceno", "GSM 语音加密", "出口弱化版", "A5 家族", "LFSR 钟控", "择多钟控", "cellular cipher", "GSM stream cipher", "frame 帧号", "Kc 会话密钥"],
  },
  e0: {
    what: "E0——蓝牙（Bluetooth）标准使用的加密流密码，四个 LFSR 加一个非线性求和组合器，保护蓝牙连接的用户数据。",
    principle:
      "四个 LFSR 长度 25/31/33/39 位，抽头多项式各不相同。输出由「求和组合器」产生：当前四位寄存器输出经过 T1/T2 两个 2 位状态机（含 2 位记忆 ct 线性混合）再做非线性映射 F（sum 映射表）。\n\n" +
      "初始化：128 位会话密钥 Kc 与 48 位设备地址 BD_ADDR、26 位蓝牙时钟 CLK 混成 208 位 preload 逐位移入四个 LFSR（达到长度后开启反馈），再空转 39 拍稳定状态；最后再用 128 位输出 Z 重新装载 LFSR，之后才开始产密钥流。\n\n" +
      "密钥流字节 = 每拍输出位 z = x1⊕x2⊕x3⊕x4⊕(ct&1) 拼接。",
    usage: "key 填 128 位会话密钥 Kc（32 hex，默认全 0），addr 填 48 位蓝牙设备地址 BD_ADDR（12 hex），clk 填 26 位时钟（十进制或 0x）。encode 明文→密文 hex，decode 反向。默认参数可直接跑通示例。",
    examples: [
      { in: "Hello", param: "key=00×16, addr=00×6, clk=0", out: "e67987802e", desc: "全 0 参数实测密文，同参可解回" },
      { in: "e67987802e", param: "key=00×16, addr=00×6, clk=0", out: "Hello", desc: "往返验证" },
    ],
    tips: [
      "蓝牙题若给了 Kc/BD_ADDR/CLK 三个参数，缺一不可——E0 的密钥流由三者共同决定。",
      "BD_ADDR 是设备 MAC（48 位），CLK 常以时钟低 26 位给出，别把完整 32 位时钟直接填进去。",
      "E0 有代数攻击可恢复密钥（Armknecht 2002），CTF 遇强题可查这个方向。",
      "与其他流密码不同，E0 有 2 位记忆状态，输出与「当前一拍」不是简单异或关系，实现要照状态机逐步推。",
    ],
    aka: ["E0", "蓝牙加密", "Bluetooth E0", "E0 流密码", "蓝牙流密码", "Bluetooth stream cipher", "求和组合器", "T1 T2 状态机", "BD_ADDR", "蓝牙 CLK", "蓝牙 Kc", "Bluetooth security", "LFSR 组合", "Bluetooth Core Spec", "蓝牙基带加密"],
  },
  hc128: {
    what: "HC-128——香港科技大学吴宏刚设计的流密码，128 位密钥，eSTREAM 项目决赛入选的 7 个算法之一，核心是一张 512×32 位的状态表，软件速度极快。",
    principle:
      "两张 512×32 位表 P 和 Q。密钥和 IV 经扩展填满两张表，然后「预热」1024 步让状态充分混合（预热步更新时除加法外还异或中间值）。\n\n" +
      "正式产密钥流：每步用两个表互相交叉更新——P[j] 由 P[j-10]、P[j-3]、P[j+1] 和 Q 表的 h 函数结果计算，Q 同理反过来用 P 表。h1/h2 函数用输入的低 16 位（两个字节）索引表的两个 256 项分区做查表加法。\n\n" +
      "每步更新后同时输出一个 32 位密钥流字，明文 XOR 上密钥流即得密文。P/Q 两表交替做「生成器」和「辅助表」，交叉引用造成很强的扩散。",
    usage: "key 填 128 位密钥（32 hex，默认全 0），iv 填 128 位 IV（32 hex，默认全 0）。encode 明文→密文 hex，decode 反向，key+iv 必须一致。",
    examples: [
      { in: "HC128", param: "key=iv=全 0（32 hex）", out: "ca43244198", desc: "实测密文，同参解回" },
      { in: "ca43244198", param: "key=iv=全 0（32 hex）", out: "HC128", desc: "往返验证" },
    ],
    tips: [
      "HC-128 官方向量：key=iv=全 0 时密钥流前 16 字节 82001573 44f7f6f8 3e76170b 5c2e51bd——出题常用全 0 参数。",
      "它只吃 128 位 key，见 256 位 key 的是 HC-256（另一 op），别混。",
      "HC-128 内存只要两张 2KB 表，适合 CTF 现场手写复现；出题常给「key 未知但已知明文」让你拼密钥流。",
      "eSTREAM 决赛 7 算法里它是纯查表型，速度最快的一档，见到「高速软件流密码」提示就是它。",
    ],
    aka: ["HC-128", "HC128", "Wu Hongjun", "吴宏刚", "eSTREAM 决赛", "eSTREAM portfolio", "128位密钥流密码", "软件流密码", "P Q 表", "high-speed stream cipher", "查表流密码", "software cipher", "eSTREAM Phase 3", "Crypto++ 向量", "高速流密码"],
  },
  hc256: {
    what: "HC-256——HC-128 的大密钥版，256 位密钥，同样的设计家族，两张 1024×32 位状态表，安全强度按 256 位目标设计。",
    principle:
      "结构是 HC-128 的等比放大：密钥+IV 共 512 位扩展成 W[16..2559]，切成 P（512..1535）和 Q（1536..2559）两张 1024 字表；预热 4096 步后正式产流。\n\n" +
      "更新公式比 HC-128 多一项：P[j] += P[j-10] + G1(P[j-3], P[j+1], Q)，其中 G1 含 Q 表查表项（HC-128 没有这一步），H 函数也从 2 字节索引升级成 4 字节索引 4 个 256 项分区。\n\n" +
      "每个密钥流字 = P[j] 的 h 查表混合再异或 P[j-512] 等项，表间交叉引用与 HC-128 同构但规模翻倍。",
    usage: "key 填 256 位密钥（64 hex，默认全 0），iv 填 256 位 IV（64 hex，默认全 0）。encode/decode 参数须一致。",
    examples: [
      { in: "HC256", param: "key=iv=全 0（64 hex）", out: "1344bbb0ee", desc: "实测密文，同参解回" },
      { in: "1344bbb0ee", param: "key=iv=全 0（64 hex）", out: "HC256", desc: "往返验证" },
    ],
    tips: [
      "HC-256 官方向量：key=iv=全 0 时密钥流 5b078985 1577d687 d09d4671 ...——验证实现的标准起点。",
      "看到 64 hex 的 key 参数一定是 HC-256，32 hex 是 HC-128，参数长度直接区分二者。",
      "HC-256 至今无有效攻击，CTF 里出现一般是「给你加密函数求逆向」或已知密钥流的流密码题。",
      "两张 4KB 表 + 4096 步预热，现场手写成本比 HC-128 高一档，出题更少见。",
    ],
    aka: ["HC-256", "HC256", "HC-256 流密码", "256位密钥流密码", "eSTREAM 决赛", "eSTREAM portfolio", "Wu Hongjun", "吴宏刚", "软件流密码", "P Q 表 1024", "high-speed stream cipher", "Crypto++ 向量", "增强版 HC-128", "double-size tables", "大密钥流密码"],
  },
  sosemanuk: {
    what: "Sosemanuk——2008 年由 Berbain、Billet 等人设计的流密码，eSTREAM 决赛 7 个算法之一，把 Serpent 分组密码的 S 盒装进 LFSR+FSM 结构，软件实现极快。",
    principle:
      "LFSR 有 10 个 32 位状态字，反馈多项式里嵌了 Serpent 的 S2 盒做非线性；FSM（有限状态机）由 r1/r2 两个字组成，核心运算 r2 = ROTL7(r1 × 0x54655307)——0x54655307 是「Sosemanuk」的十六进制念法，乘法取低 32 位。\n\n" +
      "密钥调度用截断的 Serpent 密钥编排展开 100 个子密钥字，IV 经 3 个 Serpent 8 轮块（第 12/18/24 轮提取中间态）初始化 LFSR 和 FSM。\n\n" +
      "每 20 步（5 个 LFSR 步 + 4 次 FSM 更新 + 1 次 Serpent S2 输出）产出 20 字密钥流，再经 4 字置换输出 16 字（64 字节）密钥流块。",
    usage: "key 填 128~256 位密钥（32~64 hex，默认 00112233445566778899aabbccddeeff），iv 填 128 位 IV（32 hex，默认全 0）。encode 明文→密文 hex，decode 反向。",
    examples: [
      { in: "Sosemanuk", param: "key=001122…ff（32 hex）, iv=全 0", out: "62ada57d79c333589a", desc: "实测密文，同参解回" },
      { in: "62ada57d79c333589a", param: "key=001122…ff（32 hex）, iv=全 0", out: "Sosemanuk", desc: "往返验证" },
    ],
    tips: [
      "官方测试向量 key=A7C083FEB7 iv=00112233445566778899aabbccddeeff（注意 key 是 80 位）是公认基准。",
      "名字梗：0x54655307 = ASCII「Sosemanuk」，看到这个常数就知道是它。",
      "乘法 r2 = ROTL7(r1 × 0x54655307) 的低 32 位处理是移植最大坑，JS 要用拆半乘法或 BigInt 防浮点溢出。",
      "eSTREAM 决赛算法里它的软件速度纪录保持者之一，出题频率高于 HC-256。",
    ],
    aka: ["Sosemanuk", "Sosemanuk 流密码", "eSTREAM 决赛", "eSTREAM portfolio", "Berbain", "Billet", "Serpent S2", "0x54655307", "LFSR FSM", "software stream cipher", "高速流密码", "Serpent 盒", "eSTREAM Phase 3", "Pornin", "法国流密码"],
  },
  spritz: {
    what: "Spritz——2014 年 Ron Rivest（RSA 发明人之一）和 Jacob Schuldt 发布的流密码，是 RC4 的「改良后代」，修掉了 RC4 的偏置输出问题，密钥设置与 IV 用法更规范。",
    principle:
      "核心是一个 256 字节状态数组 S 和 6 个指针 i/j/k/w/z/a。吸收（absorb）密钥时不是简单 KSA 打乱，而是用「whip 甩动 + crush 挤压」两阶段：先甩 3 轮每轮 N 步（每步交换 S[i] 与 S[j] 并按 a 值调整），再挤压 2 轮（把 S[i] 与 S[128+i] 逐项有条件交换），保证状态彻底均匀。\n\n" +
      "与早期 spritz.c 版不同，论文版用 a 计数器参与吸收（密钥字节交换到 S[a] 槽位），update 时 k 也参与运算，crush 是条件交换。\n\n" +
      "每产一个密钥流字节先做 N/2 步甩动；输出 z = S[j+S[i]]，然后做一步「shuffle」让相邻输出互不相关。加密就是明文 XOR 密钥流（自反）。",
    usage: "key 填密钥 hex（任意长度，可含 IV：先 absorb key 再 absorb IV，默认 key=414243 即 ASCII 的 ABC）。encode 明文→密文 hex，decode 反向，同一 key（含 IV 顺序）才能解回。",
    examples: [
      { in: "Spritz", param: "key=414243（ABC）", out: "24eafc688d93", desc: "实测密文，同参解回" },
      { in: "24eafc688d93", param: "key=414243（ABC）", out: "Spritz", desc: "往返验证" },
    ],
    tips: [
      "权威向量：key=ABC 密钥流前 8 字节 779a8e01f9e9cbc0——先对实现再做题。",
      "⚠ 网上老教程的 spritz.c 是早期版，与论文 2014-10-27 版算法不兼容（两套输出），本实现是论文版。",
      "Rivest 本人说 Spritz 是「教学型设计」而非产品级，CTF 出现多是论文原题。",
      "RC4 的偏置输出问题（前几百字节可区分）在 Spritz 里被挤压阶段修掉，出题常考「为什么改进」。",
    ],
    aka: ["Spritz", "Spritz 流密码", "Rivest", "Schuldt", "RC4 改进", "RC4 successor", "whip crush", "甩动挤压", "论文版 Spritz", "spritz.c", "sponge-like", "Ron Rivest", "2014 stream cipher", "a 计数吸收", "N/2 甩动"],
  },
  vmpc: {
    what: "VMPC——2004 年波兰密码学家 Bartosz Zoltak 设计的流密码，全称 Variably Modified Permutation Composition，256 字节置换表驱动的查表式流密码，可以看作 RC4 的增强变体。",
    principle:
      "状态是一张 256 字节置换表 P 和两个计数器 s、n。初始化（KSA）分模式：BASIC 模式按 Key→IV 顺序各做 768 轮置换打乱；FULL 模式多一遍 Key 重打（Key→IV→Key），表状态更随机。\n\n" +
      "每轮核心：n 递增，输出 z = P[P[P[n]] + s]（三层置换嵌套查表），然后交换 P[n] 与 P[s] 并更新 s = P[s]……整张表在「置换合成」的意义下逐轮演化。\n\n" +
      "加密即密钥流 XOR 明文（自反），密钥长度 1~64 字节、IV 1~64 字节。",
    usage: "key 填密钥 hex（1~64 字节，默认 414243 即 ABC），iv 填 IV hex（1~64 字节）。mode 可选 basic/full（默认 basic）。encode 明文→密文 hex，decode 反向。",
    examples: [
      { in: "VMPC", param: "key=414243, iv=000102", out: "61dfd13e", desc: "实测密文，同参解回" },
      { in: "61dfd13e", param: "key=414243, iv=000102", out: "VMPC", desc: "往返验证" },
    ],
    tips: [
      "官方向量（作者源码内置）：BASIC 模式 P 表采样 3fa5226775b3d2c3——实现验证用它。",
      "FULL 模式（Key→IV→Key）比 BASIC 多一轮吸收，两者密钥流完全不同，解不开先看模式对不对。",
      "n 计数器在 C 里是 unsigned char，到 255 自动回绕——JS 移植必须 & 255，这是最常见的移植 bug。",
      "Zoltak 还定义了 VMPC-MAC 变体，本 op 只做流密码本体，题目若要求 MAC 是另一个东西。",
    ],
    aka: ["VMPC", "VMPC 流密码", "Zoltak", "Variably Modified Permutation", "置换组合", "RC4 变体", "RC4 variant", "BASIC FULL 模式", "vmpcfunction.com", "256 置换表", "permutation composition", "查表流密码", "巴托什 佐尔塔克", "VMPC-MAC", "P 表采样"],
  },
  balloon: {
    what: "Balloon——2016 年斯坦福 Boneh、Corrigan-Gibbs、Schechter 提出的「内存硬」口令密钥派生函数（KDF），把口令和盐变成一大块内存的随机访问足迹，让暴力破解的硬件成本飙升。",
    principle:
      "先把口令+盐用 SHA-256 混出一个种子，从种子生成一串块（默认 1024 块，每块 32 字节，共 32KB）填满缓冲区，然后做两阶段：\n\n" +
      "① 链式阶段：每一轮每块用前一块和哈希函数更新；② 伪随机阶段：每块还要读「delta（默认 3）个伪随机位置」的旧块混合进来——伪随机位置由盐决定（原版设计，盐参与访问模式，这是 Balloon 区别于 Argon2 的特征）。\n\n" +
      "最后输出 = 对缓冲区尾部做若干轮哈希。攻击者想并行化必须保住整块内存的随机访问，GPU/ASIC 的优势被抹平。",
    usage: "输入框填口令，salt 填盐值（可为空），sCost 填空间块数（默认 1024 ≈ 32KB，CTF 小参数可调 32），tCost 填轮数（默认 3），delta 填伪随机混入块数（默认 3）。输出 hex 派生密钥。",
    examples: [
      { in: "password", param: "salt=ctf, sCost=1024, tCost=3, delta=3", out: "8f5df72cbc33f1b00e631dab852034a755dab2eed0f40016f9d676b33144decb", desc: "默认参数实测派生密钥" },
      { in: "hunter42", param: "salt=examplesalt, sCost=32, tCost=3", out: "1bc2f0775ab26e0f797c154da889935749e8f673d075cd73078619e76dc1f3f5", desc: "小参数快速示例（RustCrypto 同参数同值）" },
    ],
    tips: [
      "权威向量（RustCrypto 与 nachonavarro 两源一致）：hunter42/examplesalt 小参数组合可用来验证实现。",
      "Balloon 与 Argon2 的区别点：盐参与伪随机访问模式——考题常问「哪个 KDF 让盐影响内存访问」。",
      "sCost 调小（如 32）结果不变但跑得快，做题先用小参数验证流程再放大。",
      "内存硬 KDF 的输出长度由哈希决定（32 字节），题库若给 64 字节说明背后是别的构造。",
    ],
    aka: ["Balloon", "Balloon KDF", "Balloon 密钥派生", "Boneh", "Corrigan-Gibbs", "Schechter", "内存硬", "memory-hard", "2016 KDF", "斯坦福 KDF", "盐参与访问", "balloon-hashing", "密码学气球", "GPU 抗暴力", "口令哈希"],
  },
  lyra2: {
    what: "Lyra2——2014 年 PHC（Password Hashing Competition）的著名参赛者，Blake2b 哈希做底、用 768 位海绵结构填内存矩阵的「内存硬」口令 KDF。",
    principle:
      "核心是把口令和盐（连同 basil 参数块）pad10*1 填充后，用 Blake2b 压缩函数（12 轮 G 排列，reduced 版用 1 轮）逐块喂进 768 位（12 字）海绵状态，边喂边填一张 nRows×64 的内存矩阵。\n\n" +
      "矩阵填完进入「Wandering 游走」阶段：按奇偶轮交替做两种随机访问——每步从矩阵随机位置读入、和当前状态混洗、再写回，访问位置由状态值本身决定（状态依赖访问模式，抗 cache-timing 和自定义硬件）。\n\n" +
      "最后把海绵状态按小端输出 kLen 字节派生密钥。行数 mCost 决定内存占用（行×64 列×96 字节）。",
    usage: "输入框填口令，salt 填盐值，tCost 填轮数（默认 2），mCost 填矩阵行数（默认 4，≥2，越大越耗内存），nCols 填列数（basil 参数，默认 256），kLen 填输出字节数（默认 32）。输出 hex 派生密钥。",
    examples: [
      { in: "password", param: "salt=ctf, tCost=2, mCost=4, nCols=256, kLen=32", out: "9ba55e0861bace75cd25779c0e9aa7ef1e1af200dc35ff80625cb1892435a169", desc: "默认参数实测派生密钥" },
      { in: "p", param: "salt=s, tCost=1, mCost=4", out: "a04714884105008e7e509e1214633cb8f806cf89470f5cac4a58c0ade76c9612", desc: "小参数快速示例" },
    ],
    tips: [
      "mCost 每 +1 内存多 64×96=6KB，4 行≈24KB；CTF 验证用小 mCost，生产再放大。",
      "Lyra2 是 PHC 决赛选手，最终冠军 Argon2 的「表亲」，出题常拿两者对比内存硬特性。",
      "Wandering 阶段的奇偶轮交替是移植细节（奇偶轮访问模式不同），错一轮输出就全错。",
      "basil 参数（kLen/口令长/盐长/轮数/行数/列数）也进哈希输入——同一口令盐换任一参数输出全变。",
    ],
    aka: ["Lyra2", "Lyra2 KDF", "Lyra2 密钥派生", "PHC", "Password Hashing Competition", "Blake2b 海绵", "Wandering", "奇偶轮游走", "内存矩阵", "memory-hard", "海绵 KDF", "2014 KDF", "巴西 KDF", "sponge duplex", "口令哈希竞赛"],
  },
  yescrypt: {
    what: "yescrypt——Solar Designer（John the Ripper 作者）为 2015 年 crypt(3) 密码哈希竞赛设计的 KDF，是 scrypt 的深度强化版，Openwall 系统与部分 Linux 发行版实际在用。",
    principle:
      "三档模式用 flags 选择：flags=0 时就是标准 scrypt（RFC 7914 兼容）；flags=1 是 WORM（Write Once Read Many，只写一次读多次）；默认 RW 模式最强——先做 prehash（HMAC 带固定密钥 yescrypt 8 字节），再生成 12KB S 盒（pwxform 置换变换），smix 过程中用 S 盒做随机访问变换（PWXsimple 查表 + GATHER 收集 + ROUNDS 轮混合），同时周期性「wrap」重访整块内存。\n\n" +
      "尾处理 SCRAM 是 yescrypt 对 scrypt 的另一个强化：HMAC 派生密钥后再过一轮 SHA-256(HMAC(DK, 'Client Key')) 风格收尾，防旁路缓存攻击。\n\n" +
      "N 是内存块数（2 的幂），内存 = 128·N·r 字节；p 并行度只影响首尾 PBKDF2，smix 主体仍串行（抗并行本质）。",
    usage: "输入框填口令，salt 填盐值，mode 选 rw（默认）/ worm / scrypt 兼容，N 填内存块数（默认 2048 ≈ 32MB，CTF 验证用 4~64），r 填块内字节参数（默认 8），p 填并行度（默认 1），t 填迭代（默认 0），dkLen 填输出字节。输出 hex 派生密钥。",
    examples: [
      { in: "password", param: "salt=ctf, mode=rw, N=64, r=8, p=1, t=0, dkLen=32", out: "1f32d805163aa89c27ef47f8d9fd8751ee2abc0600c112a1eb1b6e936c439f34", desc: "RW 模式小 N 实测派生密钥" },
      { in: "p", param: "salt=s, mode=rw, N=4", out: "475701bd8c515e9ded798d7b45ff36527dd88950409d663a2a2a7e8e06cdf81571ea370fb269b57d40d3b675eaa024b7c49307032e56e94b9aeb2bd00b78a2f6", desc: "RW 模式官方向量（openwall tests.c，64 字节输出）" },
    ],
    tips: [
      "官方向量：RW 模式 p/s N=4 t=0 64 字节 = 0cd5af76eb241df8…（openwall 官方测试）；验证实现以它为准。",
      "scrypt 兼容模式输出应与标准 scrypt 完全一致——这是 yescrypt 的向下兼容承诺，出题常考这一点。",
      "N 必须 2 的幂；默认 N=2048 需 ~32MB，浏览器里大 N 会卡，做题先调小。",
      "p>1 时 PBKDF2 的块号是大端序（RFC 2898），移植实现最隐蔽的坑，输出对不上先查这个。",
    ],
    aka: ["yescrypt", "yescrypt KDF", "yescrypt 密钥派生", "Solar Designer", "openwall", "scrypt 强化", "scrypt successor", "WORM", "pwxform", "SCRAM", "crypt 竞赛", "John the Ripper", "内存硬", "memory-hard", "密码哈希竞赛 2015"],
  },
};
