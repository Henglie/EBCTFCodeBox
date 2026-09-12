/*
 * edu-t508.js — T508 批一·古典 A1-A7 科普卡（classicExt4.js）。
 * homophonic / doubleTrans / pollux / morbit / bookCipher / turningGrille / kenny
 * 示例输出全部来自实跑（test_batch1.mjs 同口径），无编造。
 */
export default {
  homophonic: {
    what: "同音替换（Homophonic Substitution）——替换密码的进阶形态：每个明文字母不只有一个密文符号，而是一组「同音符」，加密时轮转或随机选用，让高频字母摊薄到多个符号上，频率分析就此失灵。",
    principle:
      "先约定一个符号池（默认两位数字 `00`–`99` 共 100 个），再把池里的符号分配给 26 个字母：按英语词频分配（E 拿得最多）或均分。分配结果就是密表，每个符号只属于一个字母（单射），所以解密无歧义。\n\n" +
      "加密：明文字母 → 从它的同音符集合里按规则取一个（轮转=依次循环，随机=按种子）。解密：符号反查字母。非字母字符原样保留。\n\n" +
      "密表由「密钥 + 池 + 分配方式」经确定性洗牌（FNV-1a 哈希 + mulberry32）派生——同一组参数永远得到同一张表，收发双方只需共享这几个参数。",
    usage: "默认 00-99 数字池 + 按词频分配 + 轮转选择，填一个密钥即可；解密用同一组参数。要更多花样可换自定义字符池（每字符一个同音符，至少 26 个互异字符）或随机选择（seed 定随机序列）。",
    examples: [
      { in: "HELLO", param: "密钥 CTF，词频分配，轮转", out: "8002824511", desc: "同一个 L 两次取了不同同音符" },
      { in: "8002824511", param: "同参数解密", out: "HELLO", desc: "符号反查字母，往返无损" },
    ],
    tips: [
      "数字池模式下明文别带阿拉伯数字——会和密文符号混淆（工具会直接报错提醒）。",
      "同音替换的破解靠高分词/模式词匹配而非单字母频率；CTF 里给「一串两位数字且长度约为明文两倍」时优先怀疑它。",
      "词频分配下 E 的同音符约 12 个、Z 约 1 个——这正是它抗频率分析的原理。参考 https://www.dcode.fr/chiffre-homophonique 。",
    ],
    aka: ["同音替换", "同音密码", "同音符替换", "homophonic", "homophonic substitution", "homophonique", "同形替换", "多表替换音", "抗频率分析替换", "homophone cipher", "同音替代", "多符号替换"],
  },

  doubleTrans: {
    what: "双重列移位（Double Transposition）——把列移位做两遍：先用密钥 1 列移位加密，再用密钥 2 对结果又做一次。单次列移位会留下列长统计特征，两次叠加后密码分析难度陡增，一战德军、二战盟军都实际用过。",
    principle:
      "与本项目「列移位」完全同口径，连做两次：\n\n" +
      "1. 明文只保留 A-Z，按行填入宽度 = 密钥长度的网格；\n" +
      "2. 按密钥字母的排序（同字母按原位置）逐列读出 → 第一层密文；\n" +
      "3. 换密钥 2 对第一层密文重复一次 → 最终密文。\n\n" +
      "解密反序：先密钥 2 逆列移位，再密钥 1。列长由密文长度对密钥宽度做余数分配唯一确定，所以不需要额外信息即可逆。",
    usage: "两个密钥随意填单词（默认 BATTLE / FIELD）；解密时填同一对密钥即可。明文中的空格和标点会被剔除（古典惯例），解回的是纯字母流。",
    examples: [
      { in: "WEAREDISCOVEREDFLEEATONCE", param: "密钥1 BATTLE，密钥2 FIELD", out: "WDVDOEECAOEIELTSRENRAEECF", desc: "经典例句双重加密" },
      { in: "WDVDOEECAOEIELTSRENRAEECF", param: "同密钥解密", out: "WEAREDISCOVEREDFLEEATONCE", desc: "反序逆两层还原" },
    ],
    tips: [
      "两把密钥相同 = 退化成单次列移位（强度大减），实战别这么设。",
      "识别特征与单次列移位相同：字母频率不变但双字母统计被破坏。",
      "列移位族可以先用本项目的「列移位」单层练手再上双层。参考 https://www.dcode.fr/chiffre-double-transposition 。",
    ],
    aka: ["双重列移位", "双重置换", "双列移位", "double transposition", "double columnar", "double columnar transposition", "两次列移位", "双重换位", "双层栅栏", "double transposition cipher", "双重移位", "双密钥列移位"],
  },

  pollux: {
    what: "Pollux 密码——摩斯电码的「符号池」包装：把点、划、分隔符各自映射到一组数字（或别的符号）上，密文里随机/轮转选用，肉眼再也看不出摩斯结构。名字来自双子座 β 星 Pollux。",
    principle:
      "先约定三组互不重叠的符号集（dCode 默认分区）：\n\n" +
      "- 点 `.` → `0,4,7`\n- 划 `-` → `1,5,8`\n- 分隔 → `2,3,6,9`\n\n" +
      "10 个数字恰好各归一类。加密：明文先转摩斯（字母间要分隔，词间用双分隔——本工具默认档，可往返；dCode 页面读法是单分隔，词距会丢，两种档都支持）。摩斯流里的每个点/划/分隔符换成对应集合里的一个符号（轮转或按 seed 随机）。\n\n" +
      "解密：符号 → 点/划/分隔 → 还原摩斯 → 还原文本。只认符号属于哪一组，不关心具体选了哪个。",
    usage: "默认分区 + 轮转 + 双分隔即可用；进阶可在「映射」里自定义三组符号集（支持字母，如 dCode 扩展例 `0378AEFMOPQXYZ,145BCGJNRTW,269DHIKLSUV`）。",
    examples: [
      { in: "SOS", param: "默认映射，轮转", out: "04721583047", desc: "摩斯 ...---... 加两个字母分隔共 11 符号" },
      { in: "04721583047", param: "默认映射解密", out: "SOS", desc: "逐符号归组还原摩斯" },
    ],
    tips: [
      "密文是纯数字且数字分布均匀（每个数字都出现）时优先怀疑 Pollux。",
      "三组符号集必须互不重叠，否则解密有二义性——工具会拒绝并指出冲突符号。",
      "单分隔档解密会把词距压掉（信息本就不在），字母内容仍完整。参考 https://www.dcode.fr/chiffre-pollux 。",
    ],
    aka: ["pollux", "pollux 密码", "北河三密码", "双子星座密码", "pollux cipher", "pollux code", "摩斯数字替换", "morse pollux", "波吕克斯密码", "pollux 摩斯", "数字摩斯密码", "chiffre pollux"],
  },

  morbit: {
    what: "Morbit 密码——摩斯电码的「二进制分组」包装：把含分隔符的摩斯流每两个符号一组，共 9 种组合，用 9 字符密钥把每种组合映射成数字 1-9。",
    principle:
      "9 种二符号组的标准序（`.` 点 `-` 划 `/` 分隔）：\n\n" +
      "`..`(1)　`.-`(2)　`./`(3)　`-.`(4)　`--`(5)　`-/`(6)　`/.`(7)　`/-`(8)　`//`(9)\n\n" +
      "密钥取 9 个字符，按字母序稳定排序得到每个位置的「秩」（任意 9 字符密钥的秩必是 1-9 的排列）。标准组 $i$ 的密文数字 = 密钥第 $i$ 位的秩。\n\n" +
      "加密：明文 → 摩斯流（字母间 `/`，词间 `//`）→ 两位一组 → 数字。流长为奇数时末尾补一个 `/`（dCode 示例同款）。解密全程反演，尾部补位分隔符自动丢弃。",
    usage: "密钥填恰好 9 个字符（默认 MORSECODE，dCode 官方示例键）。重复字母没关系——秩按位置算，永远不冲突。",
    examples: [
      { in: "MORE BITS", param: "密钥 MORSECODE", out: "32379749578158", desc: "dCode 官方例（秩表 568931724）" },
      { in: "32379749578158", param: "同密钥解密", out: "MORE BITS", desc: "官方例往返" },
    ],
    tips: [
      "密文全是 1-9 的数字、且没有 0——这是与 Pollux（用 0）最快的区分点。",
      "无密钥爆破空间只有 $9! = 362880$，可用摩斯合法性剪枝（如不允许连续三个 `/`）。",
      "密钥长度不是 9 会直接报错；空格标点等非摩斯字符同样报错。参考 https://www.dcode.fr/chiffre-morbit 。",
    ],
    aka: ["morbit", "morbit 密码", "摩斯比特密码", "morbit cipher", "morbit code", "摩斯二进制密码", "morse morbit", "摩斯配对密码", "chiffre morbit", "morbit 摩斯", "9 组摩斯密码", "数字摩斯组"],
  },

  bookCipher: {
    what: "书卷密码（Book Cipher）——Beale 密码一脉：加解密双方共享同一本书（或任何长文本），加密就是把每个词换成它在书里的位置编号，密文只剩一串数字。",
    principle:
      "两种编号制：\n\n" +
      "- `word`：全书按顺序编号，明文词 → 第 $N$ 个词（1 起）；\n- `line-word`：明文词 → 第 $l$ 行第 $w$ 个词。\n\n" +
      "取位策略：`first` 总取首次出现（同一词永远同编号）；`next` 像真实用法一样从上次位置向后推进（同一词可有不同编号，密文更难攻）。\n\n" +
      "匹配口径：宽松（忽略大小写与首尾标点，推荐）或严格（整词全等）。书里没有的词会报错列出——换一本「书」或改口径。",
    usage: "把共享文本粘进「共享文本」框（那就是你们的书），选编号制和取位策略。注意：解密方必须用完全相同的文本（差一个词全文错位）。",
    examples: [
      { in: "the dog", param: "共享文本 the quick brown fox… the end，word 制", out: "1.9", desc: "the=第1词，dog=第9词" },
      { in: "1.9", param: "同书解密", out: "the dog", desc: "编号取词还原" },
    ],
    tips: [
      "CTF 里给一段长文本 + 一串小数字（或 `行.词` 形式）就要想到书卷密码，题面的文本往往就是那本书。",
      "`next` 策略下重复词编号会递增，暴力按 `first` 解会出现大量相同编号——这是识别策略的旁证。",
      "密码本本身别用太著名的书（出题人最爱《独立宣言》和 Beale 梗）。参考 https://www.dcode.fr/chiffre-par-livre 。",
    ],
    aka: ["书卷密码", "书本密码", "书密码", "book cipher", "beale", "beale 密码", "book code", "字位密码", "词典密码", "共享文本密码", "livres", "chiffre par livre", "词位置编码"],
  },

  turningGrille: {
    what: "转动格栅（Turning Grille / Fleissner 格栅）——卡达诺格栅的转动版：一张 N×N 开孔模板，每填满一轮就把格栅旋转 90° 再填，转满 4 次恰好覆盖全格。",
    principle:
      "格栅合法性核心是旋转轨道约束：格 (r, c) 顺时针转 90° 到 $(c, N-1-r)$，连转 4 次回到原地——这 4 格构成一条「轨道」。**每条轨道恰好开 1 个孔**，4 次旋转才能不重不漏覆盖全盘。\n\n" +
      "可开孔数 = $\\frac{N^2 - (N \\bmod 2)}{4}$（奇数 N 的中心格自映射，禁用）。\n\n" +
      "加密：每一轮按行序把明文写进当前露出的孔，转 90° 再写，4 轮填满（不足补 X）；密文 = 整盘按行读出。解密把密文按行铺满全盘，再按同样 4 轮孔序读出。",
    usage: "尺寸 2-12。格栅参数三种给法：留空 = 规范形（每轨道取序号最小格）；`seed:任意串` = 按种子随机选每轨道的孔；或直接给 `#`/`.` 格栅串（如 6×6 给 36 字符）。顺/逆时针都支持，收发双方口径一致即可。",
    examples: [
      { in: "ABCDEFGHIJKLMNOP", param: "4×4 显式格栅 ##../##../..../....，顺时针", out: "ABEFCDGHMNIJOPKL", desc: "手推可复核的完整例" },
      { in: "ATTACKATDAWN", param: "6×6 规范形，补 X", out: "ATTACAXKATWNXXDXXXXXXXXXXXXXXXXXXXXX", desc: "短明文自动补位至满盘" },
    ],
    tips: [
      "解不出先核对四要素：尺寸、格栅、方向、补位字符——任何一个不一致全盘错乱。",
      "奇数尺寸中心格永远读不到（自映射格禁用），5×5 密文是 24 字符不是 25。",
      "无密钥攻击靠孔位约束穷举：轨道数不大时可行，所以 N 别太小。参考 https://www.dcode.fr/chiffre-grille-tournante 。",
    ],
    aka: ["转动格栅", "旋转格栅", "fleissner", "fleissner 格栅", "turning grille", "grille tournante", "转动格板", "旋转格板", "cardan 转动", "格栅密码", "fleissner cipher", "turning grilles"],
  },

  kenny: {
    what: "Kenny 语——《南方公园》里 Kenny 的说话方式：每个字母换成三个音节 m/p/f 的组合，3 个位置各 3 种选择，$3^3 = 27$ 个组合盖住 26 个字母。",
    principle:
      "就是三进制编码：M=0、P=1、F=2，字母序号写成 3 位三进制。\n\n" +
      "$$v = 9 d_1 + 3 d_2 + d_3, \\quad A{=}000(MMM),\\ B{=}001(MMP),\\ \\ldots,\\ Z{=}221(FFP)$$\n\n" +
      "组合 222（FFF）在 dCode 原表里未分配——本工具默认把它扩展为空格（更实用），也可切「严格」档保持原表（遇 FFF 报错）。其他非字母字符一律丢弃。",
    usage: "输入英文自动转三连音流；解密粘 m/p/f 串（大小写、混入的空白都容忍）。密文长度必是 3 的倍数，否则报错。",
    examples: [
      { in: "DCODE", out: "MPMMMFPPFMPMMPP", desc: "dCode 官方例：MPM,MMF,PPF,MPM,MPP" },
      { in: "HELLO", out: "MFPMPPPMFPMFPPF", desc: "H=MFP E=MPP L=PMF L=PMF O=PPF" },
    ],
    tips: [
      "看到只由 m/p/f 三个字母组成的长串就是它（长度是 3 的倍数）。",
      "和培根密码同构（培根是 5 位二进制，Kenny 是 3 位三进制），解培根的思路可以直接搬。",
      "FFF 默认当空格；出题人若严格按 dCode 表，切换「严格」档即可对齐。参考 https://www.dcode.fr/code-kenny-southpark 。",
    ],
    aka: ["kenny", "kenny 语", "kenny 密码", "kenny code", "kenny speak", "南方公园语", "kenny southpark", "mpf 密码", "mpf 编码", "肯尼语", "kenny language", "三进制字母"],
  },
};
