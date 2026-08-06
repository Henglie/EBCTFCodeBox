// 科普内容分片：analysis(10) + crypto(7) 新增攻击/分析 op。纯数据，无 import 无副作用。
export default {
 // ============================================================
 // analysis 类（10）
 // ============================================================
  dictGen: {
    what: "字典生成器：按字符集+长度做笛卡尔积，或按掩码模板（@小写 !大写 #数字 $符号）批量生成候选词表。爆破/字典攻击的弹药库。",
    principle:
      "两种模式：\n\n" +
      "① 字符集+长度：给定字符集 C 和长度 L，输出所有 $|C|^L$ 种组合（如 26 小写字母 × 长度 4 = $26^4=456976$ 条）。\n\n" +
      "② 掩码：每个位置独立指定候选集——`@`=小写、`!`=大写、`#`=数字、`$`=常见符号，其他字符按字面量固定。如 `@@@#` 表示「3 个小写字母 + 1 个数字」。\n\n" +
      "内部用逐位扩展的笛卡尔积生成，输出条数硬上限 100 万防内存爆炸。",
    usage: "选模式：charset 填字符集与长度（1-6），mask 填掩码模板。输出每行一个词条。组合数超 100 万会报错，缩短长度或减字符集。",
    examples: [
      { in: "（charset 模式）", param: "charset=ab, length=3", out: "aaa aab aba abb baa bab bba bbb", desc: "2 字符 × 长度 3 = 8 条" },
      { in: "（mask 模式）", param: "mask=@#", out: "a0 a1 … z9（260 条）", desc: "1 小写字母 + 1 数字" },
    ],
    tips: [
      "掩码里字面量直接写，如 `flag#` 生成 flag0..flag9。",
      "长度上限 6、总数上限 100 万——真要大字典用 crunch/hashcat 掩码。",
      "已知密码格式（如「3 字母 4 数字」）时用掩码远比全字符集省时间。",
    ],
    aka: ["字典生成", "dict gen", "dictionary generator", "掩码生成", "mask attack", "笛卡尔积字典", "词表生成", "密码字典", "wordlist", "crunch", "字典爆破", "生成字典", "候选词表"],
  },

  flagExtract: {
    what: "flag 自动提取器：把输入喂进一批常用解码器递归解码，每层用 `flag{}` 正则匹配，命中就输出 flag 和完整解码链路。多层套娃编码的 flag 一键杀器。",
    principle:
      "本质是 magic 一键解码的「只找 flag」收窄版：\n\n" +
      "① 当前文本先跑 `[a-z0-9_]{2,}\\{[^{}]+\\}` 这类 flag 格式正则；\n" +
      "② 用白名单里 26 个轻量 decode op（base 家族、url、rot 家族、morse、bacon 等）各解一遍；\n" +
      "③ 对每个解出且变化的结果递归下一层（默认 maxDepth=3）；\n" +
      "④ BFS beam search 剪枝：每层按「含 flag/ctf/key 关键字优先 + 可打印率高优先」打分，只保留 top 32 个候选，防组合爆炸。\n\n" +
      "只跑无参解码器，vigenere 这类要密钥的不跑。",
    usage: "把疑似多层编码的密文粘进输入框，设 maxDepth（1-5，默认 3）。输出命中的 flag + 解码链路（如 `base64 > rot13`）。",
    examples: [
      { in: "ZmxhZ3toZWxsb30=", out: "flag{hello}\n解码链路: base64", desc: "单层 base64" },
    ],
    tips: [
      "只找 `flag{}` 格式；直接明文可见的 flag 无需本 op。",
      "需要密钥的编码（维吉尼亚等）跑不出，改用 magic 一把梭。",
      "深度不够就调大 maxDepth（最大 5），但层数越深越慢。",
    ],
    aka: ["flag提取", "flag extract", "自动提取flag", "递归解码", "flag finder", "找flag", "多层解码", "flag自动化", "auto decode", "ctf一键解", "提取flag", "flag搜索", "嵌套编码解码"],
  },

  lfsrRecover: {
    what: "LFSR 序列恢复：给一段线性反馈移位寄存器输出的 0/1 比特流，用 Berlekamp-Massey 算法反推出反馈多项式、级数和初始状态，还能外推预测后续比特。",
    principle:
      "LFSR 由连接多项式 $c(x)=1+c_1x+\\dots+c_Lx^L$ 决定，递推关系 $s_n=\\bigoplus_{i=1}^{L}c_i\\,s_{n-i}$（GF(2) 上加减都是 XOR）。\n\n" +
      "Berlekamp-Massey 是 GF(2) 上求「能生成给定序列的最短 LFSR」的经典算法：逐位计算差异值 discrepancy $d=s_n\\oplus\\bigoplus_{i}c_i s_{n-i}$，$d=1$ 时用上一次备份多项式修正当前多项式，必要时更新线性复杂度 $L$。\n\n" +
      "输出的 $L$ 即 LFSR 级数，$c(x)$ 中次数 ≥1 的非零项即抽头位置。若 $L$ 接近 $N/2$ 通常说明不是简单 LFSR。",
    usage: "输入一串 0/1（容忍空格/换行/逗号分隔）。analyze 模式输出 L / 反馈多项式 / 抽头 / 初始状态 + 重现校验；predict 模式额外外推 predictN 个比特。",
    examples: [
      { in: "0011101", out: "L=3, 反馈多项式 x^3 + x^2 + 1", desc: "3 级 LFSR" },
    ],
    formulas: [
      { tex: "s_n = \\bigoplus_{i=1}^{L} c_i\\, s_{n-i} \\pmod 2", caption: "Fibonacci LFSR 反馈递推（GF(2)）" },
    ],
    tips: [
      "需要约 2L 个连续比特才能唯一确定 L 级 LFSR。",
      "重现校验通过 = 该 LFSR 可完整生成输入；不通过多半不是纯 LFSR 输出。",
      "求出反馈多项式后可预测任意长度后续密钥流。",
    ],
    aka: ["lfsr恢复", "berlekamp massey", "BM算法", "线性反馈移位寄存器", "反馈多项式", "线性复杂度", "lfsr破解", "lfsr攻击", "序列恢复", "linear feedback shift register", "抽头恢复", "lfsr预测", "b-m算法", "最短lfsr综合"],
  },

  nonogram: {
    what: "数织 / Nonogram 求解器：给定每行每列的「连续块长度」约束，解出 0/1 点阵。CTF misc 里解出的图案常是二维码、字符或 flag 形状。",
    principle:
      "用线求解器（line solver）迭代收敛：\n\n" +
      "① 对每行/每列，枚举所有满足该线约束的合法排布（受已确定格剪枝）；\n" +
      "② 取所有合法排布的交集——某格在全部排布中都是实/都是空，就能确定该格；\n" +
      "③ 反复扫行、扫列直到没有新确定格。\n\n" +
      "不做整盘 DFS 回溯，所以多解或需要猜测的盘面只给部分解。尺寸上限 40×40，单线组合数超 20 万则跳过。",
    usage: "输入两段，用一行 `---` 分隔：上段每行一组行约束（连续块长度，空格分隔），下段每行一组列约束。可自定义实心/空格字符。",
    examples: [
      { in: "2\n1 1\n3\n---\n1\n1 1 1\n2", out: "3×3 点阵解", desc: "行约束 / 列约束各一段" },
    ],
    tips: [
      "空行（或 0）表示该行/列全空。",
      "只用线求解器，需猜测的盘面会剩 `?` 未确定格。",
      "图案能辨认（二维码/字符）即可读出，不必全解。",
    ],
    aka: ["数织", "nonogram", "数independent", "描点方块", "picross", "日本谜题", "格子画", "行列约束求解", "hanjie", "griddler", "数织求解", "点阵谜题", "connect块约束"],
  },

  pcapRepair: {
    what: "pcap 文件修复：CTF 流量题里 pcap 常被故意改坏——magic 损坏、全局头缺失、字节序造假、incl_len 越界。本 op 静态诊断并尽力修复，输出修复后的 hex，可再喂给 pcapParse 解析。",
    principle:
      "照 libpcap 格式（24 字节全局头 + 每包 16 字节 record 头）逐项体检：\n\n" +
      "① **magic 损坏/缺失**：合法值只有 `a1b2c3d4`(LE μs)、`d4c3b2a1`(BE μs)、`a1b2cd34`(LE ns)、`34cdb2a1`(BE ns) 四种，非法时按后续 record 链合理性反推正确 magic + 字节序。\n" +
      "② **全局头整体缺失**：探测首个 record 头，补一个标准 24 字节头（snaplen 65535 / DLT 1 Ethernet）。\n" +
      "③ **字节序标记与内容不符**：record 链在翻转字节序下能解更多包时，翻转 magic。\n" +
      "④ **incl_len 越界**截断、snaplen 异常修 65535、version 异常修 2.4。\n\n" +
      "策略保守：只改全局头和明显越界的 incl_len，不删不重排包体。",
    usage: "把 pcap 以 hex/base64 粘进输入框（或拖入文件走原始字节），选输入编码。输出诊断报告 + 修复后 pcap 的 hex。",
    examples: [
      { in: "d4c3b2a1...(坏 magic 的 pcap hex)", out: "诊断报告 + 修复后 hex", desc: "识别字节序 + 重写 magic" },
    ],
    tips: [
      "record 头合理性判据：incl_len 在 (0, 剩余字节] 且 ≤ orig_len。",
      "pcapng（块结构）不是本 op 修复范围，直接用 pcapParse 试。",
      "修复后 hex 复制给 pcapParse 继续解析包内容。",
    ],
    aka: ["pcap修复", "pcap repair", "流量包修复", "pcap损坏", "修复pcap", "libpcap", "抓包文件修复", "magic修复", "pcap头修复", "wireshark文件修复", "pcap fix", "网络流量修复", "破损pcap"],
  },

  rc4Visualize: {
    what: "RC4 KSA/PRGA 可视化：把 RC4 内部两阶段逐步展开——KSA 用密钥打乱 S 表的每一步 i/j/swap，PRGA 逐字节生成密钥流的过程。教学 + 逆向识别 RC4 特征用。",
    principle:
      "RC4 分两阶段（本 op 与真实 RC4 完全一致，只加 trace 记录）：\n\n" +
      "**KSA（密钥调度）**：S 表初始为 identity 排列 0..255，跑 256 步 $j=(j+S[i]+key[i\\bmod keylen])\\bmod 256$，每步交换 $S[i]\\leftrightarrow S[j]$，把密钥「装载」进 S 表。\n\n" +
      "**PRGA（密钥流生成）**：每字节 $i=(i+1)\\bmod 256$、$j=(j+S[i])\\bmod 256$，交换 $S[i]\\leftrightarrow S[j]$，输出 $K=S[(S[i]+S[j])\\bmod 256]$，与明文异或。RC4 自反：加解密同一操作。",
    usage: "填 RC4 密钥（UTF-8 或 hex）、KSA 展示步数、PRGA 生成字节数。可选填明文查看「明文⊕密钥流=密文」。输出 KSA 明细 + S 表 + PRGA 明细 + 密钥流 hex。",
    examples: [
      { in: "（可选明文）", param: "key=Key, prgaBytes=16", out: "S 表 + 密钥流 hex + 每步 i/j/swap", desc: "经典 RC4 密钥 Key" },
    ],
    tips: [
      "CTF 识别特征：256 步 KSA 交换循环 + `S[(S[i]+S[j])&0xff]` 的 PRGA 循环。",
      "实际加解密请用「现代加密」里的 RC4 op；本 op 只做过程可视化。",
      "密钥流与明文异或即密文，同一密钥流再异或即还原。",
    ],
    aka: ["rc4可视化", "rc4 visualize", "ksa", "prga", "rc4教学", "rc4过程", "key scheduling algorithm", "pseudo-random generation", "rc4 s盒", "rc4流密码", "rc4密钥流", "rc4分析", "rc4 sbox", "arcfour"],
  },

  spiralMatrix: {
    what: "螺旋矩阵读取：flag 被打散填进 N×M 方阵后，按顺时针/逆时针螺旋顺序读取还原。CTF misc 高频。也支持反向把明文按螺旋填进矩阵。",
    principle:
      "生成 rows×cols 的螺旋访问坐标序列——顺时针从左上角起「右→下→左→上」逐圈内收（LeetCode 54/59 标准算法），逆时针则「下→右→上→左」。\n\n" +
      "decode（读）：把输入解析成二维网格，按螺旋序取字符拼成明文。\n" +
      "encode（写）：把明文字符按螺旋序填进矩阵输出。",
    usage: "decode 输入矩阵（多行文本，或单行 + 指定列数 cols 切块）；选方向（顺/逆时针）。encode 填明文，cols 为 0 时自动取近似方阵。",
    examples: [
      { in: "abc\nhid\ngfe", param: "dir=cw", out: "abcdefghi", desc: "3×3 顺时针螺旋读出" },
    ],
    tips: [
      "起点固定左上角（CTF 最常见）。",
      "单行输入要指定列数 cols 才能切成矩阵。",
      "顺/逆时针读错就切换方向重试。",
    ],
    aka: ["螺旋矩阵", "spiral matrix", "螺旋读取", "回形读取", "spiral order", "蛇形矩阵", "螺旋填充", "顺时针螺旋", "逆时针螺旋", "矩阵螺旋", "螺旋展开", "螺旋排列", "回旋矩阵"],
  },

  ttlStego: {
    what: "TTL 隐写：发包方把每个 IP 包的 TTL 设成 4 个锚点值之一（0/64/128/255），每个锚点代表 2 bit，4 个包拼 1 字节藏 ASCII。网络流量取证高频。",
    principle:
      "编码映射：TTL 0→`00`、64→`01`、128→`10`、255→`11`。比特 MSB 优先，每 4 个 TTL 值拼成 1 字节。\n\n" +
      "decode 时按「最近锚点」归一化——实测抓包的 TTL 会有抖动（63/65/127 等），距离哪个锚点近就归到哪个，再按 2 bit 一组重组字节。",
    usage: "decode 输入空格/逗号/换行分隔的 TTL 整数序列 → 文本。encode 输入文本 → 空格分隔的 TTL 序列。",
    examples: [
      { in: "64 128 64 255 ...", out: "还原的 ASCII 文本", desc: "每 4 个 TTL 拼 1 字节" },
    ],
    tips: [
      "TTL 个数应为 4 的倍数，不足 1 字节的尾部比特被忽略。",
      "抓包 TTL 有抖动没关系，按最近锚点归一容错。",
      "从 pcap 里提取所有包的 TTL 序列即可解码。",
    ],
    aka: ["ttl隐写", "ttl stego", "ttl steganography", "ip ttl隐写", "生存时间隐写", "ttl编码", "流量隐写", "网络隐写", "ttl藏数据", "time to live", "ttl信道", "ttl隐藏", "ip包隐写"],
  },

  xorAnalyze: {
    what: "xortool 一体化：给一段重复密钥 XOR（维吉尼亚式）密文，自动猜密钥长度、逐字节恢复密钥、输出解密结果。纯前端版 xortool。",
    principle:
      "经典三步（cryptopals Set 1 Challenge 6）：\n\n" +
      "① **猜 key 长度**：对每个候选 keylen，把密文分块算块间归一化汉明距离。正确 keylen 下相同位置密钥相同，异或后分布集中 → 汉明距离最低。\n" +
      "② **逐字节恢复 key**：把同一密钥位的所有字节收集，对 256 个候选做单字节 XOR，用英文字母频率卡方打分选最优。\n" +
      "③ **组合择优**：每位取 top 5 候选，重建整段明文后用 bigram（th/he/in 等常见双字母）打分选最优，救回小样本卡方噪声。\n\n" +
      "还会检测密钥周期性（`KEYKEY`→`KEY`）并缩减报告。",
    usage: "把密文以 hex/base64 粘进输入框，设最大 key 长度（2-64）。输出 keylen 候选 + 最优 key（hex/ascii）+ 解密结果 + 置信度。",
    examples: [
      { in: "(hex 密文，重复密钥 XOR)", param: "maxKeyLen=32", out: "key + 明文 + 置信度", desc: "汉明距离 + 卡方破解" },
    ],
    formulas: [
      { tex: "\\text{keylen} = \\arg\\min_{k}\\ \\frac{1}{k}\\,\\text{Hamming}(\\text{block}_i, \\text{block}_{i+1})", caption: "归一化汉明距离最小的 keylen 最可能" },
    ],
    tips: [
      "密文越长越准，建议 ≥ 10 × keylen 字节。",
      "只对英文明文有效（卡方/bigram 是英文频率）。",
      "置信度低时调大 maxKeyLen，或确认输入真是重复密钥 XOR。",
    ],
    aka: ["xor分析", "xortool", "重复密钥xor", "多字节异或破解", "repeating key xor", "维吉尼亚xor", "xor破解", "vigenere xor", "异或分析", "汉明距离破解", "xor crack", "破解异或密钥", "single byte xor", "卡方xor"],
  },

  xorCribDrag: {
    what: "XOR crib-drag 已知明文拖动：已知明文片段（crib）在流密码/重复密钥密文里逐位置拖动异或，靠可打印率找出正确对齐，恢复密钥片段。",
    principle:
      "XOR 加密 $C=P\\oplus K$。若已知明文片段 crib 出现在明文位置 $i$，则 $C[i:i+L]\\oplus\\text{crib}=K[i:i+L]$（密钥片段）。\n\n" +
      "逐个偏移把 crib 对密文异或，输出每个位置的候选密钥/明文片段 + 可打印率。当密钥是可打印文本时，正确对齐位置的可打印率显著高（全可打印标 ★，≥80% 标 ○）。",
    usage: "把密文以 hex/base64 粘进输入框，crib 参数填已知明文片段（UTF-8）。输出每个偏移的 XOR 结果（hex + ASCII + 可打印率）。",
    examples: [
      { in: "(hex 密文)", param: "crib=the", out: "各偏移 XOR + 可打印率 + ★标记", desc: "拖动 the 找对齐位置" },
    ],
    formulas: [
      { tex: "C[i:i{+}L]\\oplus \\text{crib} = K[i:i{+}L]", caption: "已知明文位置处异或即得密钥片段" },
    ],
    tips: [
      "常用 crib：`the `、`flag{`、` the `、常见词首尾带空格。",
      "★（全可打印）位置最可能是正确对齐，读出的就是密钥片段。",
      "两条用同一密钥流的密文互相异或（多次一密复用）也可 crib drag。",
    ],
    aka: ["crib drag", "crib拖动", "已知明文攻击", "拖动异或", "known plaintext", "crib dragging", "xor拖拽", "密钥片段恢复", "many time pad", "一次一密复用", "crib攻击", "已知明文拖动", "xor known plaintext"],
  },

 // ============================================================
 // crypto 类（7）
 // ============================================================
  dsa: {
    what: "DSA 数字签名（FIPS 186）：签名、验签，以及 CTF 高频的「重用 k(nonce) 攻击」——两条签名用了同一随机数 k 就能恢复私钥 x。纯 BigInt 本地计算。",
    principle:
      "DSA 参数：素数 $p$、$q$（$q\\mid p-1$）、阶为 $q$ 的生成元 $g$，私钥 $x$、公钥 $y=g^x\\bmod p$。\n\n" +
      "**签名**（消息 hash 记 $z$）：选每消息唯一随机 $k$，$r=(g^k\\bmod p)\\bmod q$，$s=k^{-1}(z+xr)\\bmod q$，签名 $(r,s)$。\n\n" +
      "**验签**：$w=s^{-1}$，$u_1=zw$，$u_2=rw$，$v=((g^{u_1}y^{u_2})\\bmod p)\\bmod q$，通过 $\\Leftrightarrow v=r$。\n\n" +
      "**重用 k 攻击**：两条消息用同一 $k$（表现为 $r_1=r_2$），由 $s_1-s_2=k^{-1}(z_1-z_2)$ 解出 $k=(z_1-z_2)(s_1-s_2)^{-1}\\bmod q$，再 $x=(s_1k-z_1)r^{-1}\\bmod q$。",
    usage: "选模式：sign（私钥 x → r,s）/ verify（公钥 y + r,s）/ attack_reuse_k（同 r 的两签名恢复 x）。hash 支持直接填整数 H(m) 或对文本做 SHA-1。攻击模式填 r/s1/s2/z1/z2/q。",
    examples: [
      { in: "z1,s1,z2,s2,r,q（同 k 两签名）", param: "mode=attack_reuse_k", out: "恢复 k 和私钥 x", desc: "nonce reuse 恢复私钥" },
    ],
    formulas: [
      { tex: "k=(z_1-z_2)(s_1-s_2)^{-1}\\bmod q,\\quad x=(s_1 k - z_1)\\,r^{-1}\\bmod q", caption: "重用 k 攻击恢复 nonce 与私钥" },
    ],
    tips: [
      "签名里 k 必须每次唯一且保密——复用或泄露 k 直接暴露私钥。",
      "两条签名 r 相同就是 k 重用的信号，立刻上攻击模式。",
      "ECDSA（如比特币）的 nonce 复用同理可恢复私钥（原理一致）。",
    ],
    aka: ["dsa", "数字签名算法", "digital signature algorithm", "fips 186", "dsa签名", "dsa验签", "nonce重用", "k重用攻击", "nonce reuse", "dsa攻击", "签名验签", "dsa私钥恢复", "重用随机数攻击", "dsa破解"],
  },

  hashLengthExtension: {
    what: "哈希长度扩展攻击：给定 H(secret) 和 secret 的字节长度，不需要知道 secret 就能算出 H(secret‖padding‖append)。MD5/SHA1/SHA256 等 Merkle-Damgård 结构哈希的固有弱点，CTF web/crypto 高频。",
    principle:
      "Merkle-Damgård 哈希把消息按 64 字节块迭代压缩，最终内部 state 就是 hash 输出。\n\n" +
      "攻击者把 hash 反推回内部 state（MD5 是 4 个 32 位小端字），把它当作压缩函数的「初始 state」继续压缩 append 数据，就得到 $H(\\text{secret}\\Vert\\text{padding}\\Vert\\text{append})$——全程不需要知道 secret。\n\n" +
      "关键是 glue padding：原消息的填充 = `0x80` + 若干 `0x00` + 64 位消息长度，长度域里的比特数按 $\\text{len(secret)}$ 算。本 op 的 MD5 用纯 JS 落地；SHA1/SHA256 因走 WebCrypto 不暴露内部 state，给 hashpump 降级提示。",
    usage: "填原哈希 H(secret) 的 hex、secret 字节长度、要追加的数据（输入框，按 appendEnc 解码）。输出新哈希 new_hash + 新消息后缀（padding‖append）的 hex/base64。",
    examples: [
      { in: "append=admin", param: "originalHash=<md5>, originalLength=14", out: "new_hash + padding‖append", desc: "MD5 长度扩展" },
    ],
    formulas: [
      { tex: "H(\\text{secret}\\Vert\\text{pad}\\Vert\\text{append}) \\;\\text{可由}\\; H(\\text{secret}),\\ |\\text{secret}| \\;\\text{算出}", caption: "无需 secret 即可扩展" },
    ],
    tips: [
      "防御：别用 H(secret‖msg) 做 MAC，改用 HMAC。",
      "secret 长度未知时可爆破（试 8/16/24… 字节）。",
      "SHA1/SHA256 用命令行 hashpump 或 python hashpumpy 库。",
    ],
    aka: ["长度扩展攻击", "hash length extension", "length extension attack", "哈希扩展", "md5长度扩展", "merkle damgard攻击", "hashpump", "hash扩展攻击", "sha1长度扩展", "hlea", "填充扩展", "md5扩展攻击", "hash伪造"],
  },

  lllAttack: {
    what: "格基归约 LLL（Lenstra-Lenstra-Lovász）攻击：两个应用——背包（Merkle-Hellman）低密度攻击由公钥+密文恢复 0/1 明文，以及通用整数矩阵归约求短向量。精确 BigInt 有理数计算，无浮点误差。",
    principle:
      "LLL 是求「格的近似最短基」的多项式时间算法（Cohen 算法 2.6.3）：反复做 size-reduction（把 μ 系数压到 $|\\mu_{i,j}|\\le 1/2$）和满足 Lovász 条件的相邻基向量交换，输出基的首向量是近似最短向量（近似因子 $\\le 2^{(n-1)/2}$）。本实现 Gram-Schmidt 与 μ 全程用 BigInt 精确有理数。\n\n" +
      "**背包低密度攻击（CJLOSS 构造）**：子集和问题构造 $(n+1)\\times(n+1)$ 格，明文 0/1 位对应一个范数约 $\\sqrt n$ 的极短向量。当背包密度 $d=n/\\log_2(\\max\\beta)<0.9408$ 时，LLL 归约后的短向量能读出 ±1 还原明文位。",
    usage: "knapsack 模式填公钥 β（逗号分隔）+ 密文 c（可多块），恢复 0/1 明文（配 Merkle-Hellman）。general 模式填整数矩阵（行用换行/分号，元素用逗号/空格）求归约基与最短向量。δ 可选 3/4 或 0.99。",
    examples: [
      { in: "β=公钥, c=子集和", param: "mode=knapsack", out: "0/1 明文位向量 + 还原字节", desc: "低密度背包攻击" },
    ],
    formulas: [
      { tex: "d = \\frac{n}{\\log_2(\\max_i \\beta_i)} < 0.9408", caption: "CJLOSS 可攻密度上界" },
    ],
    tips: [
      "背包攻击要密度 < 0.9408（CJLOSS）；旧 Lagarias-Odlyzko 上界仅 0.6463。",
      "攻击失败可试 δ=0.99（更强归约）。",
      "通用模式还能解 HNP、隐藏数问题、coppersmith 相关小根格。",
    ],
    aka: ["lll", "格基归约", "lattice reduction", "lenstra lenstra lovasz", "格攻击", "背包攻击", "knapsack attack", "merkle hellman", "低密度攻击", "cjloss", "格约减", "lll算法", "lattice attack", "短向量"],
  },

  prngAttack: {
    what: "PRNG 破解：LCG（线性同余）参数恢复 + MT19937（Python random 引擎）状态恢复。给一串连续随机数输出，反推内部参数/状态并预测后续值。CTF crypto 高频。",
    principle:
      "**LCG** $x_{n+1}=(ax_n+c)\\bmod m$：给 ≥3 个连续输出，用差分法——$t_n=x_{n+1}-x_n$，模数 $m=\\gcd(t_i,t_j,\\dots)$（≥5 输出才稳，否则需给 m），$a=t_1 t_0^{-1}\\bmod m$，$c=x_1-ax_0\\bmod m$。\n\n" +
      "**MT19937**：Python random 用的引擎，输出经 temper 变换（4 步移位异或 11/7/15/18）。给 624 个连续 32 位输出，对每个做 untemper（逆向 4 步）恢复 624 字内部 state，再跑一轮 twist 即可预测第 625 个及后续所有输出。",
    usage: "选模式：lcg（每行一个输出数字，可选填已知模数 m）或 mt19937（624 个连续 32 位输出）。输出恢复的参数/state + 下一个预测值 + 一致性校验。",
    examples: [
      { in: "624 个 getrandbits(32) 输出", param: "mode=mt19937", out: "恢复 state + 预测第 625 个", desc: "Python random 预测" },
    ],
    formulas: [
      { tex: "a = t_1\\,t_0^{-1}\\bmod m,\\quad c = x_1 - a x_0 \\bmod m", caption: "LCG 差分法恢复乘数与增量" },
    ],
    tips: [
      "LCG 常见模数：$2^{31}$(glibc rand)、$2^{32}$、$2^{48}$、$2^{64}$。",
      "MT19937 需正好 624 个连续 32 位输出且中间无跳过。",
      "差值 GCD 推出的 m 可能是真模数的因子，异常就手填 m。",
    ],
    aka: ["prng破解", "prng attack", "随机数预测", "lcg破解", "linear congruential", "线性同余", "mt19937", "mersenne twister", "梅森旋转", "untemper", "random预测", "python random破解", "伪随机数攻击", "随机数恢复"],
  },

  rsaBatchGcd: {
    what: "RSA 公共因子分解（批量 GCD）：多个 RSA 模数 N 两两求最大公约数，若某两个共享素因子就同时分解。糟糕的随机数生成器导致不同密钥复用素数时的经典攻击。",
    principle:
      "两个模数 $N_i=p\\cdot q_1$、$N_j=p\\cdot q_2$ 若共享素因子 $p$，则 $\\gcd(N_i,N_j)=p>1$，一次 GCD 就同时分解两个模数：$q_1=N_i/p$、$q_2=N_j/p$。\n\n" +
      "本 op 对输入的所有模数做 $O(k^2)$ 两两 GCD（CTF 规模足够；真实海量密钥用 Bernstein 的乘积树批量 GCD $O(k\\log^2 k)$）。找到公因子即输出 p、q1、q2 并校验。",
    usage: "输入多个 RSA 模数 N（每行一个或逗号分隔，至少 2 个）。输出所有共享素因子的模数对及其分解。",
    examples: [
      { in: "N1=91\nN2=143", out: "gcd=13, N1=13×7, N2=13×11", desc: "两模数共享素因子 13" },
    ],
    formulas: [
      { tex: "\\gcd(N_i, N_j) = p > 1 \\;\\Rightarrow\\; N_i = p\\cdot\\frac{N_i}{p},\\ N_j = p\\cdot\\frac{N_j}{p}", caption: "共享素因子一次 GCD 双分解" },
    ],
    tips: [
      "根源是 RNG 熵不足导致不同密钥撞素数（2012 年 Lenstra 等真实扫出大量弱 RSA 公钥）。",
      "两模数互质则 gcd=1，本攻击不适用。",
      "分解出 p、q 后用 rsaParams 求 d 即可解密。",
    ],
    aka: ["批量gcd", "batch gcd", "公共因子分解", "common factor attack", "rsa共因子", "共享素数攻击", "shared prime", "两两gcd", "rsa批量分解", "gcd攻击", "共模数因子", "rsa公因子", "弱rsa密钥", "batch gcd attack"],
  },

  rsaHastad: {
    what: "RSA Håstad 广播攻击：同一明文 m 用相同的小公钥指数 e 加密并广播给 e 个不同的人（各自模数 n_i），攻击者收集 e 组密文就能恢复明文，不需要任何私钥。",
    principle:
      "同一明文 $m$ 用相同 $e$ 和 $e$ 个两两互质的 $n_i$ 加密得 $c_i=m^e\\bmod n_i$。\n\n" +
      "用中国剩余定理（CRT）合并这 $e$ 个同余式得 $M\\equiv c_i\\pmod{n_i}$，$M<\\prod n_i$。因为 $m<\\min(n_i)$，所以 $m^e<\\prod n_i$，于是 $M=m^e$ 是精确整数值（没有被任何模数绕回）。\n\n" +
      "最后对 $M$ 开 $e$ 次整数根就得到明文 $m$。",
    usage: "输入每行一组 `n,c`（逗号分隔），至少 e 组。设公钥指数 e（默认 3）。输出 CRT 合并的 M、开 e 次根得到的 m 及 ASCII。",
    examples: [
      { in: "n1,c1\nn2,c2\nn3,c3", param: "e=3", out: "m + ASCII", desc: "e=3 需 3 组密文" },
    ],
    formulas: [
      { tex: "M \\equiv c_i \\pmod{n_i} \\;\\Rightarrow\\; M = m^e,\\quad m = \\sqrt[e]{M}", caption: "CRT 合并后开 e 次整数根" },
    ],
    tips: [
      "需要至少 e 组不同模数的密文；e=3 是最常见。",
      "明文必须满足 $m<\\min(n_i)$（未加随机填充）攻击才成立。",
      "开根失败多半是密文组数不足或明文太长（超过某个 n_i）。",
    ],
    aka: ["hastad", "håstad广播攻击", "hastad broadcast", "广播攻击", "低指数广播", "rsa广播", "crt广播攻击", "低加密指数攻击", "small exponent attack", "hastad attack", "多密文攻击", "rsa低指数", "同明文广播"],
  },

  rsaPollardPm1: {
    what: "RSA Pollard p-1 分解：当 RSA 模数 N 的某素因子 p 满足「p-1 是 B-光滑」（p-1 的素因子都不大）时，能高效分解出 p。与 Pollard rho 互补。",
    principle:
      "若素因子 $p$ 满足 $p-1$ 是 B-光滑（所有素数幂因子 $\\le B$），令 $M=\\prod_{q\\le B}q^{\\lfloor\\log_q B\\rfloor}$，则 $p-1\\mid M$。\n\n" +
      "由费马小定理 $a^{p-1}\\equiv 1\\pmod p$，故 $a^M\\equiv 1\\pmod p$，于是 $p\\mid\\gcd(a^M-1,N)$。计算 $\\gcd(a^M-1,N)$，若结果落在 $(1,N)$ 之间就是非平凡因子。\n\n" +
      "两个失败情形：$\\gcd=1$（B 太小，两因子都不 B-光滑）；$\\gcd=N$（B 太大，两因子都 B-光滑，需减小 B）。",
    usage: "输入待分解模数 N（每行一个或逗号分隔）。设基数 a（通常 2）、光滑上界 B（如 1000/10000）。输出分解出的 p、q 及校验。",
    examples: [
      { in: "N=(p-1 光滑的合数)", param: "base=2, bound=1000", out: "p, q（p·q=N）", desc: "p-1 光滑时秒解" },
    ],
    formulas: [
      { tex: "a^M \\equiv 1 \\pmod p,\\quad p \\mid \\gcd(a^M - 1,\\ N)", caption: "M = ∏ q^⌊log_q B⌋，费马小定理导出因子" },
    ],
    tips: [
      "分解不出就调大 B（p-1 光滑度不够）；gcd=N 则调小 B。",
      "p-1 或 q-1 有大素因子时本算法无效，改用 rho 或 Fermat。",
      "选强素数（p-1、p+1 都有大因子）就能防 p-1 和 p+1 分解。",
    ],
    aka: ["pollard p-1", "p减1分解", "pollard p minus 1", "p-1算法", "光滑数分解", "b-smooth", "pollard p-1 factorization", "费马小定理分解", "p-1光滑", "smooth factoring", "波拉德p-1", "rsa p-1攻击", "p-1 method"],
  },

  des2Mitm: {
    what: "2DES 中间相遇攻击（MITM）：C = DES_k2(DES_k1(P)) 双重加密看起来是 112 位密钥，但用「中间相遇」可把复杂度降到 2^56×2 级别（每半密钥空间 b 位时 2^b×2）。CTF 里 2DES 题密钥常被限制在小空间，本 op 穷举恢复 (k1, k2)。",
    principle:
      "中间相遇：先穷举 k1 建 forward 表 { DES_k1(P) → k1 }（2^b 条），再对每个 k2 计算 DES_k2⁻¹(C)，若命中表内值则 (k1, k2) 是候选。命中后用完整链路 C'=DES_k2(DES_k1(P)) 验证防表冲突。密钥空间 2^(2b) 降到 2^b × 2。\n\n" +
      "密钥编码：k1/k2 各占 keyBits 位（默认 16），大端拼 8 字节喂 DES。注意 DES 每字节最低位是校验位（被忽略），恢复出的可能是等价密钥（如 0x619F 与 0x609E 等价）。",
    usage: "输入格式：明文hex 空格 密文hex（各 8 字节）。keyBits 控制每半密钥空间（默认 16，≤20）。输出命中密钥对列表 + 耗时。",
    examples: [
      { in: "0123456789abcdef 密文hex", param: "keyBits=16", out: "命中：k1=... k2=...", desc: "恢复双密钥（校验位等价容差）" },
    ],
    tips: ["2DES 永远别用——MITM 使其强度只比单 DES 高一点点；CTF 出题常把密钥空间压缩到可穷举。用 keyBits 从小到大试，找到能解的范围。", "多重命中是正常现象（DES 校验位 + 表冲突），全链路验证已过滤假命中。"],
    aka: ["2des攻击", "中间相遇", "meet in the middle", "2des破解", "双重des", "2des mitm", "中间相遇攻击", "双des攻击", "2des破解工具", "des2攻击", "meet-in-the-middle", "2des密码分析", "2des密钥恢复", "双重加密攻击", "2des爆破"],
  },
};
