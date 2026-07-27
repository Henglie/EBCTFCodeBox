// 科普内容分片：analysis 频率分析 / 古典密码自动求解类。纯数据，无 import 无副作用。
export default {
  freqDist: {
    what: "字符频率分布：数一数每个字符出现了几次、占比多少，按次数从高到低排。分析的第一步。",
    principle:
      "任何频率分析都从计数开始。英文明文里 e/t/a/o 高频、空格最高频；单表替换只是给字母换了长相、没改频率，所以最高频的密文字母很可能就是 e 或空格的替身。",
    usage: "粘文本，输出每个字符的次数与百分比（降序）。配合 subCipherSolver 或手工推替换。",
    examples: [{ in: "aabbbc", out: "b×3(50%) a×2(33%) c×1(17%)" }],
    tips: ["密文越长频率越可信；几十字符的短密文，频率分析基本不靠谱。"],
    aka: ["frequency distribution", "字符频率", "频率分布", "字频", "字符统计", "频率统计",
      "char frequency", "字母频率", "letter frequency", "频次统计", "字符计数", "character count"],
  },

  entropy: {
    what: "香农熵：一段数据「有多随机/多难压缩」的量化指标，单位 bit/字符。判断是明文、编码还是加密/压缩数据。",
    principle:
      "熵衡量不确定性。字节均匀随机时熵最高 = 8 bit/byte；英文文本约 4.0~4.5；只有少数字符的编码串更低。\n\n" +
      "实战判断：熵接近 8 → 加密或压缩数据（无规律）；熵 4~5 → 自然语言或 base64 之类；熵很低 → 重复性强的编码。",
    usage: "粘数据，输出香农熵（bit/char）。用来区分「这是密文/压缩包，还是普通文本」。",
    examples: [
      { in: "随机字节流", out: "≈ 8.0（高熵，像加密/压缩）" },
      { in: "英文段落", out: "≈ 4.2（中熵，自然语言）" },
    ],
    formulas: [{ tex: "H = -\\sum_{i} p_i \\log_2 p_i", caption: "pᵢ 为符号 i 的出现概率" }],
    tips: ["binwalk 出来一段高熵数据往往是加密块；熵突变的边界常是文件/字段分界。"],
    aka: ["shannon entropy", "香农熵", "信息熵", "entropy", "熵", "熵值", "熵计算",
      "information entropy", "bit熵", "随机性检测", "熵分析", "shannon"],
  },

  wordFreq: {
    what: "词频统计：按单词（而非单字符）分词计数，看哪些词反复出现。",
    principle:
      "按空白/标点切词后统计每个词出现次数，降序排列。高频功能词（the/of/and）能佐证语言判断；异常高频的怪词可能是 key、标记或藏在文本里的线索。",
    usage: "粘文本，输出词频排行（降序）。",
    examples: [{ in: "the cat the dog the", out: "the×3 cat×1 dog×1" }],
    aka: ["word frequency", "词频", "词频统计", "单词频率", "词语统计", "词汇统计",
      "word count", "词计数", "单词计数", "词频排行", "高频词", "token frequency"],
  },

  hammingDistance: {
    what: "汉明距离：两段等长数据有多少个 bit 不一样。破多字节 XOR 时用它估密钥长度。",
    principle:
      "两串逐比特异或，数结果里 1 的个数就是汉明距离。破重复密钥 XOR：正确的密钥长度 L 处，相邻两块（各 L 字节）的归一化汉明距离最小——因为它们被同一段密钥流异或，明文英语的规律性显露出来。",
    usage: "用换行分隔两段等长文本粘进来，输出字节级汉明距离。估 XOR key 长时对不同块长比较归一化距离。",
    examples: [
      { in: "this is a test\nwokka wokka!!!", out: "37", desc: "Cryptopals 经典样例" },
    ],
    formulas: [{ tex: "d_H(a,b) = \\text{popcount}(a \\oplus b)", caption: "异或后数 1 的个数" }],
    tips: ["密钥长 L 候选：对每个 L 取前几块两两算归一化距离(÷L)，最小的那个 L 最可能是真实密钥长。"],
    aka: ["hamming distance", "汉明距离", "海明距离", "hamming", "汉明", "比特距离",
      "bit distance", "异或距离", "xor距离", "汉明重量", "hamming weight", "popcount距离"],
  },

  levenshtein: {
    what: "编辑距离：把一个字符串改成另一个，最少要几次插入/删除/替换。衡量两串有多像。",
    principle:
      "动态规划填一张 (m+1)×(n+1) 表，dp[i][j] 表示前缀 a[..i] 变成 b[..j] 的最小操作数。字符相同则继承左上角，不同则取三个方向最小值 +1。",
    usage: "用换行分隔两段文本，输出最小编辑距离。用来做模糊比对、找相近串。",
    examples: [{ in: "kitten\nsitting", out: "3", desc: "k→s、e→i、末尾 +g" }],
    formulas: [
      { tex: "dp[i][j] = \\min(dp[i-1][j]+1,\\ dp[i][j-1]+1,\\ dp[i-1][j-1]+[a_i\\ne b_j])", caption: "编辑距离递推" },
    ],
    aka: ["levenshtein", "编辑距离", "edit distance", "莱文斯坦距离", "字符串相似度", "levenshtein distance",
      "最小编辑距离", "字符串距离", "模糊匹配", "相似度算法", "字符串比对", "序列相似度"],
  },

  strContrast: {
    what: "等长 ASCII 差值对比：两段等长文本逐字符相减，看每一位差了多少。",
    principle:
      "把两串对齐，逐位算 ASCII 码差 b−a。差值恒定 → 凯撒式整体偏移；差值有规律 → 可能是维吉尼亚/流密码的密钥流；差值为 0 的位是相同字符。",
    usage: "用换行分隔两段等长文本，输出逐字符 ASCII 差值序列。",
    examples: [{ in: "ABC\nBCD", out: "+1 +1 +1", desc: "整体偏移 1，像凯撒" }],
    tips: ["差值全相等 → 凯撒；差值周期性重复 → 维吉尼亚，周期就是密钥长。"],
    aka: ["string contrast", "ascii 差值", "等长对比", "字符差值", "ascii 对比", "逐字符相减",
      "码值差", "差值序列", "char diff", "ascii diff", "字符串对比", "偏移检测"],
  },

  icAnalysis: {
    what: "重合指数进阶版：不光算整体 IC，还按不同分组长度算分组 IC，一步估出维吉尼亚密钥长度。",
    principle:
      "对每个候选密钥长度 L，把密文每隔 L 个字符取一列，共 L 列，每列各算 IC 再平均。若 L 是真实密钥长（或其倍数），每列都是单凯撒 → 平均 IC 跳回英语值 0.066 附近，形成明显峰值。",
    usage: "粘密文，输出整体 IC + 各分组长度的平均 IC 表。看哪个 L 的 IC 最接近 0.066，就是密钥长候选。整体 IC 接近 0.066 像单表/明文，接近 0.038 像多表或随机。",
    examples: [
      { in: "维吉尼亚密文", out: "L=6 时平均 IC≈0.065（峰值）→ 密钥长很可能是 6" },
      { in: "英文密文", out: "整体 IC ≈ 0.065（偏单表）或 ≈ 0.041（偏多表）" },
    ],
    formulas: [{ tex: "IC = \\frac{\\sum_{i} n_i(n_i-1)}{N(N-1)}", caption: "nᵢ 为字母 i 出现次数，N 为总数" }],
    tips: [
      "峰值 L 及其约数都要考虑（L=6 出峰，真实可能是 3 或 6）。定长后交给 vigenereAuto 恢复密钥。",
      "参考值：英语≈0.0667，法语≈0.078，随机≈0.0385。整体 IC 明显低于 0.05 基本可判多表。",
    ],
    aka: ["ic analysis", "分组重合指数", "密钥长估计", "index of coincidence", "重合指数", "ic",
      "重合指数分析", "IC分析", "密钥长度估计", "coincidence index", "Kappa检验", "维吉尼亚密钥长"],
  },

  kasiskiTest: {
    what: "Kasiski 检验：找密文里重复出现的片段，量它们之间的间隔，间隔的公约数往往就是维吉尼亚密钥长度。",
    principle:
      "维吉尼亚里，若相同明文恰好被相同的密钥片段加密，就会产生相同密文片段。这种重复的出现间隔一定是密钥长度的整数倍。收集所有重复 n-gram 的间隔，求最大公约数（GCD），即密钥长候选。",
    usage: "粘密文，工具找重复 3~4 字母组、算间隔、取 GCD，给出密钥长度候选。",
    examples: [
      { in: "含重复 n-gram 的密文", out: "间隔 {9,6,15} → GCD=3 → 密钥长可能是 3" },
    ],
    tips: ["和 icAnalysis 交叉验证更稳。偶发的巧合重复会带来噪声，看多数间隔的公因子。"],
    aka: ["kasiski test", "kasiski 检验", "卡西斯基", "kasiski", "卡西斯基检验", "卡西斯基测试",
      "kasiski examination", "重复片段间隔", "密钥长度分析", "维吉尼亚破解", "n-gram间隔", "GCD密钥长"],
  },

  chiSquareAnalysis: {
    what: "卡方检验详细版：给出密文各字母的观测次数与英语期望次数对照表，不只出一个总分。",
    principle:
      "在 chiSquare 基础上把中间过程摊开：列出 26 个字母各自的观测/期望/贡献值。既能算总分，也能看清是哪些字母偏离最大——辅助人工推断替换关系。",
    usage: "粘密文，输出逐字母观测 vs 英语期望对照表 + 总卡方。凯撒 26 偏移里挑最小分（卡方值越小越像英语明文）。",
    examples: [
      { in: "英文密文", out: "字母级对照表 + χ² 总值" },
      { in: "解对偏移的文本", out: "卡方值最小 → 正确解", desc: "解错的偏移卡方会很大" },
    ],
    formulas: [{ tex: "\\chi^2 = \\sum_{i} \\frac{(O_i - E_i)^2}{E_i}", caption: "Oᵢ 观测次数，Eᵢ 期望次数" }],
    tips: ["卡方 + 26 偏移穷举 = 全自动破凯撒，比肉眼看频率快。"],
    aka: ["chi square analysis", "卡方详细", "卡方对照表", "chi square", "卡方检验", "卡方统计",
      "chi-squared", "卡方分析", "χ²检验", "chi2", "凯撒破解", "字母分布检验"],
  },

  subCipherSolver: {
    what: "单表替换自动破解：不给密钥，靠爬山算法自动找出 26 字母的替换映射，直接吐明文。",
    principle:
      "把「密文字母→明文字母」的映射当作待优化的排列。用英语四元组（quadgram）对数概率给候选明文打分，随机交换两个字母的映射，若分数变好就接受、变差以一定概率接受（爬山/退火），反复迭代收敛到最优映射。",
    usage: "粘足够长的单表替换密文（越长越准），工具自动爬山求解，输出恢复的映射和明文。",
    examples: [{ in: "较长的单表替换密文", out: "还原的明文 + 26 字母映射表" }],
    tips: ["密文太短（<100 字符）爬山容易卡局部最优，可多跑几次取最好结果。含数字/符号不影响，只对字母求解。"],
    aka: ["substitution solver", "单表替换求解", "爬山破解", "单表替换破解", "substitution cracker",
      "hill climbing", "爬山算法", "模拟退火破解", "quadgram", "四元组打分", "自动替换求解", "monoalphabetic solver"],
  },

  vigenereAuto: {
    what: "维吉尼亚全自动破解：从密文一路做到明文，不用你给密钥也不用给密钥长度。",
    principle:
      "三步流水线：① 用 IC/Kasiski 估密钥长度 L；② 把密文按 L 分成 L 列，每列是一个凯撒，逐列用卡方找最佳偏移 → 拼出密钥；③ 用恢复的密钥解密。全程基于英语统计。",
    usage: "粘维吉尼亚密文（英文、足够长），一键输出估计的密钥、密钥长度和解密明文。",
    examples: [{ in: "维吉尼亚英文密文", out: "key=LEMON + 明文", desc: "自动估长 + 逐列卡方" }],
    tips: ["密文越长越准。若结果像半通不通，可能密钥长估成了真实值的约数/倍数，手动微调 L 再解。"],
    aka: ["vigenere auto", "维吉尼亚自动破解", "vigenere 破解", "维吉尼亚全自动", "vigenere crack",
      "vigenere solver", "维吉尼亚爆破", "多表替换破解", "自动求密钥", "维吉尼亚攻击", "vigenere breaker", "无密钥破解"],
  },

  hillKnownPlain: {
    what: "Hill 密码已知明文攻击：有一段明文和对应密文，就能反解出加密用的密钥矩阵。",
    principle:
      "Hill 把明文按 n 个字母一组当向量，乘密钥矩阵 K（模 26）得密文：$C = KP \\bmod 26$。已知足够的明密文对，拼成矩阵 P 和 C，则 $K = C P^{-1} \\bmod 26$——需要 P 在模 26 下可逆（行列式与 26 互质）。",
    usage: "填明文和对应密文（长度需够拼出可逆的 P），选分组阶数 n，工具求密钥矩阵 K。",
    examples: [
      { in: "已知明文+密文", param: "n=2", out: "2×2 密钥矩阵 K", desc: "需 P 模 26 可逆" },
    ],
    formulas: [{ tex: "K = C\\,P^{-1} \\bmod 26", caption: "由明密文对反解密钥矩阵" }],
    tips: ["选出的明文分组拼成的 P 必须可逆（gcd(det P, 26)=1），不可逆就换几组明文重试。"],
    aka: ["hill known plaintext", "hill 已知明文", "希尔密码攻击", "希尔已知明文", "hill攻击",
      "known plaintext attack", "已知明文攻击", "hill密钥矩阵求解", "矩阵密码破解", "希尔密码破解", "求密钥矩阵", "hill cipher attack"],
  },

  playfairCrack: {
    what: "Playfair 爬山破解：用模拟退火自动搜索那张 5×5 密钥方阵，恢复明文。",
    principle:
      "Playfair 用一张 5×5 字母方阵按双字母（bigram）规则加密。破解把方阵当待优化对象，用英语四元组打分，随机做行列交换/整行整列对调/方阵转置等扰动，模拟退火接受更优解，逐步逼近真实方阵。",
    usage: "粘 Playfair 密文（越长越稳），工具退火爬山，输出恢复的方阵与明文。",
    examples: [{ in: "较长 Playfair 密文", out: "5×5 方阵 + 明文" }],
    tips: ["密文短时结果不稳，多跑几次。注意 Playfair 把 I/J 合并、明文插过填充字母，还原文会带这些痕迹。"],
    aka: ["playfair crack", "playfair 爬山", "playfair 破解", "playfair破解", "普莱费尔破解",
      "playfair solver", "playfair爬山", "模拟退火", "双字母密码破解", "5x5方阵破解", "playfair cracker", "普莱费尔爬山"],
  },
};
