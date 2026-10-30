/*
 * edu-t689t710.zh.js — 2026-10-26 接线批：Falcon / Poseidon / KZG / OpenSSH·PKCS#12·JWK / GCM·NTRU-CCA2 / Xoodyak / ECC 攻击共 17 op 科普卡（中文）。
 * aka 经 eduAliases() 注入搜索别名索引；示例值均来自各卡 verify harness 实跑。
 */
export default {
  "falconPkParse": {
    "what": "Falcon 公钥解析——把 Falcon/FN-DSA（NIST 后量子签名竞赛入选的格签名）的公钥 blob（规范 §3.11.4：1 字节头 0000 nnnn + 每系数 14 bit 大端位流）解成结构化字段：档位（Falcon-512/1024）、N、多项式 h 的系数（mod q=12289）、SHA256 指纹。验签前的第一步，也是题目给 .pub/公钥 hex 时的入口。",
    "principle": "**公钥 = 环元素 h ∈ Z_q[x]/(x^n+1)**（q=12289，n=512/1024）：编码极简——头字节 `0000 nnnn`（低 4 位 = log2(n)，0x09 → n=512，0x0A → n=1024），其后 n 个系数各 14 bit（12289 < 2^14）按大端位流无分隔拼接，总长 1 + ⌈14n/8⌉ = 897/1793 字节。\n\n**解析时做的合法性检查**（每条都显式报错）：长度恰好匹配；头字节档位在支持范围；每个 14bit 系数值 < q=12289（越界即数据损坏——14bit 能表 16384 而合法值只到 12288，余量是天然校验位）。\n\n**h 的角色**：验证时计算 $s_2 + s_1 \\cdot h \\bmod q$ 应等于哈希到点的 c——h 是签名能被验证的全部依据（私钥不参与验证）。",
    "usage": "输入：公钥 hex（897/1793 字节 = 1794/3586 hex 字符）或 base64。\n\n输出：档位/N/q/头字节、h 的全部系数（十进制列表）、系数个数与摘要指纹；异常（长度/头字节/系数越界/hex/base64）分类报错。\n\n适用：PQC 题目给 Falcon 公钥先解析确认档位；配合「Falcon 验签」完成完整验证链。",
    "examples": [
      {
        "in": "（Falcon-512 官方 KAT 公钥，897 字节 hex）",
        "out": "档位 = Falcon-512（logn=9，n=512，q=12289）；头字节 0x09；h 系数 512 个（逐项列出）；指纹 SHA256:…",
        "desc": "NIST Round-3 KAT 公钥解析成功"
      },
      {
        "in": "同一公钥删掉末 2 个 hex 字符（去 1 字节）",
        "out": "显式报错「公钥长度 896 字节 ≠ 头 1 字节 + ⌈14·512/8⌉ = 897 字节」",
        "desc": "长度校验逐字节精确"
      },
      {
        "in": "首系数改到 ≥12289（14bit 区间内越界）",
        "out": "显式报错「系数值 … ≥ q=12289」",
        "desc": "14bit 余量天然充当数据完整性校验"
      }
    ],
    "formulas": [
      {
        "tex": "pk = \\text{0x0} n_{\\mathrm{log}} \\;\\|\\; \\mathrm{bits}_{14}(h_0) \\| \\cdots \\| \\mathrm{bits}_{14}(h_{n-1})",
        "caption": "公钥编码（spec §3.11.4），长 1+⌈14n/8⌉ 字节"
      },
      {
        "tex": "0 \\le h_i < q = 12289 < 2^{14}",
        "caption": "14bit 编码余量 = 越界校验的依据"
      }
    ],
    "tips": [
      "认题：题目给 FN-DSA / Falcon / 后量子格签名的 .pub 或公钥 hex → 本 op 先解析；897 字节就是 Falcon-512、1793 是 Falcon-1024。",
      "头字节速查：0x09 = Falcon-512、0x0A = Falcon-1024；其他低 4 位（n=256/1024 以外档）本工具不支持并明确报错。",
      "系数越界（≥12289）几乎必然是数据损坏或题目的「故意陷阱」——合法公钥不可能出现。",
      "公钥是公开材料可放心处理；验签只用到它，不需要任何私钥。",
      "标准来源：Falcon Specification v1.2 §3.11.4（编码）与 §2.6 表 3.3（参数）；NIST Round-3 提交包 Reference_Implementation（nist.c/codec.c 口径）。"
    ],
    "aka": [
      "Falcon 公钥解析",
      "Falcon public key",
      "FN-DSA 公钥",
      "Falcon-512 公钥",
      "Falcon-1024 公钥",
      "格签名公钥",
      "lattice signature pubkey",
      "Falcon key parse",
      "PQC 公钥解析",
      "Falcon h polynomial",
      "falcon 公钥 hex",
      "NTRU 格公钥",
      "后量子签名公钥",
      "Falcon PK parse",
      "公钥 897 字节"
    ]
  },
  "falconVerify": {
    "what": "Falcon 验签（仅验签方向）——对 Falcon/FN-DSA 签名做完整规范验证（spec 算法 16）：自动识别三种封装（规范压缩 0x39/0x3A、CT 未压缩 0x59/0x5A、NIST API signed-message KAT 风格），做哈希到点、负循环卷积、范数界三步核验，格式错与签名错分列报出。纯 JS O(n²) 卷积（无 NTT 依赖），Falcon-1024 单次验签毫秒级。",
    "principle": "**验证三步（spec §3.10 算法 16）**：\n① **哈希到点**：$c = \\mathrm{HashToPoint}(r \\| m)$——SHAKE-256 每 16 bit 大端采样，$t < 61445$（$= \\lfloor 2^{16}/q \\rfloor \\cdot q$，拒绝采样）才接受，$c_i = t \\bmod q$（spec 算法 3）；\n② **解压与卷积**：签名给出 s2 的压缩流（每系数 = 符号位 ‖ 低 7 位 ‖ 高位一元编码，k 个 0 后接 1），解压时做三项唯一性检查（定长/禁「−0」/尾部位全零）；然后 $s_1 = c - s_2 \\cdot h \\bmod (x^n+1, q)$，系数逐个居中到 $[-6144, 6144]$；\n③ **范数界**：$\\| (s_1, s_2) \\|^2 \\le \\lfloor \\beta^2 \\rfloor$（Falcon-512 = 34 034 726，Falcon-1024 = 70 265 242，含等号）——这是格签名的安全核心：合法签名由高斯采样落界内，伪造者很难同时满足卷积等式与短范数。\n\n**封装自动识别**：头字节 `0 cc 1 nnnn`（cc=01 压缩 / 10 为 CT 12bit 定长未压缩）；NIST API 格式 = [2 字节大端 sig_len] + nonce(40) + msg + esig（esig 头 0x20+logn），消息取自 blob 内嵌。压缩流上限按官方 C 参考实现 COMPRESSED_MAXSIZE 口径，CT 恒为 1+40+12n/8。",
    "usage": "输入：消息（UTF-8 或 hex）+ 公钥 hex + 签名（hex/base64，三种封装自动识别）。\n\n输出：格式识别行、验证结论（有效/无效及原因：c 不匹配/范数超界）、s1/s2 范数值、性能数据；格式错（长度/头字节/「−0」/NIST 长度不符）与签名错（c 不匹配/范数超界）分开报。\n\n适用：PQC 题目验 Falcon 签名、KAT 向量自检、篡改样本分类（改消息/改系数流/改 nonce 各有不同失败表现）。验签为确定性计算，零随机、零外发。",
    "examples": [
      {
        "in": "（NIST Round-3 KAT 的 Falcon-512 消息/公钥/签名）",
        "out": "格式 = NIST API signed-message；验证 = ✓ 有效（范数 ‖(s1,s2)‖² = … ≤ ⌊β²⌋ = 34034726）；c/s1/s2 全字段",
        "desc": "官方 KAT 逐条通过（512 与 1024 两组全量）"
      },
      {
        "in": "同一签名，消息改一个字节",
        "out": "验证 = ✗ 无效：c 不匹配（哈希到点结果不同）——消息绑定失效",
        "desc": "改消息的失败模式"
      },
      {
        "in": "签名系数流中制造「−0」（系数 0 带符号位）",
        "out": "格式错：压缩解码的唯一性检查拒绝「−0」——与格式错误区分于签名错误",
        "desc": "spec 三项唯一性检查的实证"
      }
    ],
    "formulas": [
      {
        "tex": "c = \\mathrm{HashToPoint}_{n}(r \\| m),\\quad t < k \\cdot q,\\; k = \\lfloor 2^{16}/q \\rfloor = 5",
        "caption": "哈希到点（spec 算法 3）：SHAKE-256 16bit 拒绝采样"
      },
      {
        "tex": "s_1 = c - s_2 \\cdot h \\bmod (x^n+1,\\, q)",
        "caption": "卷积等式：负循环卷积，逐系数居中归一"
      },
      {
        "tex": "\\|(s_1, s_2)\\|^2 \\le \\lfloor \\beta^2 \\rfloor",
        "caption": "范数界：34034726 / 70265242（含等号），格签名的安全锚点"
      }
    ],
    "tips": [
      "认题：题目给 FN-DSA/Falcon 签名让验证、或给篡改签名找差异 → 本 op；只需验签（keygen/sign 需 FFT 与高斯采样，不在本工具范围，edu 如实说明）。",
      "三种封装先看首字节：0x39/0x3A=规范压缩、0x59/0x5A=CT 定长、0x20 开头的 NIST 结构（前 2 字节是 esig 长度）——KAT 文件里全是第三种。",
      "「格式错」与「签名错」分开报：前者是编码/长度/禁「−0」问题，后者是 c 不匹配或范数超界——排查时先看类别。",
      "改 nonce 等于换哈希输入 → c 全变 → 验证失败；改系数流高字位可能触发格式检查而非范数检查——两种篡改路径都试。",
      "性能口径：纯 JS 学校卷积 O(n²)，Falcon-1024 单次约 2~4ms（现代桌面，node 实测中位 2.76ms）；无需 WASM。",
      "标准来源：Falcon Specification v1.2（算法 3/16/17/18、表 3.3）；NIST Round-3 提交包（nist.c/vrfy.c/codec.c）与 Extra/c/falcon.c（封装口径）；KAT = NIST 官方 LWC/签名提交包 KAT 文件。"
    ],
    "aka": [
      "Falcon 验签",
      "Falcon verify",
      "FN-DSA 验签",
      "Falcon 签名验证",
      "Falcon-512 verify",
      "Falcon-1024 verify",
      "格签名验证",
      "lattice signature verify",
      "PQC 签名验证",
      "Falcon 签名校验",
      "Falcon 范数检查",
      "HashToPoint",
      "后量子验签",
      "Falcon KAT",
      "NIST Falcon"
    ]
  },
  "poseidon": {
    "what": "Poseidon 素域哈希——零知识证明（ZK）系统里最常用的「ZK 友好」代数哈希之一（Grassì、Khovratovich、Rechberger、Roy、Schofnegger，USENIX Security 2021）。它不是 SHA-3：运算不在比特串上，而在素域 Z/p 的域元素上——S-box 是 x^5 幂运算、线性层是域上 Cauchy MDS 矩阵乘法，电路里只需加法门与常数乘，生成证明的成本远低于比特层哈希（SHA-3/Keccak 是比特海绵结构，两者常量与结构毫无关系）。circomlib/snarkjs 生态的事实标准（BN254）。",
    "principle": "**HADES 结构（原论文 §2）**：状态是 t 个域元素组成的向量（t=输入数+1），总共 R_F 个全轮 + R_P 个部分轮，顺序为「前 R_F/2 全轮 → R_P 部分轮 → 后 R_F/2 全轮」，每轮三步：\n\n① **ARK**：状态逐元素加轮常量（轮常量由 Grain LFSR 自收缩生成器按实例参数派生，透明可复现）；\n② **S-box**：全轮对全部 t 个元素做 $x^5$，部分轮只对第 1 个元素做（省电路约束的关键）；\n③ **Mix**：乘 t×t Cauchy MDS 矩阵（$M_{i,j}=1/(x_i+y_j)$，保证扩散）。\n\n**S-box 判定**：$x^\\alpha$ 要求是域上置换须 $\\gcd(\\alpha, p-1)=1$；BN254 与 BLS12-381 标量域均满足 $\\gcd(3,p-1)=3$、$\\gcd(5,p-1)=1$，故取 $\\alpha=5$（论文同款口径）。\n\n**轮数（论文 Table 2，含安全边际）**：x5-POSEIDON-128 在 t=3 时 R_F=8、R_P=57；t=5 时 R_P=60。circomlib 按 128 位安全口径取 t=2→56、t=3→57、t=5→60、t=6→60。\n\n**本工具的两套常量口径**：① circomlib/IAIK 口径（BN254 t=2/3/5/6，常量由论文作者实验室 IAIK 的 Grain 官方脚本生成——本项目已用同款 Grain 生成式逐字复现全部常量佐证来源；circomlib 是 CTF/snarkjs 事实标准但非论文官方参数表）；② HorizenLabs 参考实现口径（BN254 t=3 R_P=56 与 BLS12-381 t=2/3，取自论文作者团队维护的官方仓库实例文件）。**同是「BN254 t=3」两套常量并不通用**（R_P 不同 → Grain 种子不同），对题时先确认题目用的是哪套。",
    "usage": "输入：1 到 t-1 个域元素（0 ≤ x < p，十进制或 hex，逗号/空白分隔），状态首格放「初始状态」（默认 0，circomlib 口径即此）；或选「尾补零」档从第 1 格起放元素（k=t 时即官方置换直通）。不足 t 的槽位补 0。\n\n输出：置换后的状态元素——默认取首个元素作为哈希值；可选「全状态」（Merkle 树多输出场景）。格式：十进制 / 32 字节大端 hex / 最短 hex。\n\n适用场景：CTF 里 circom/snarkjs 题目给出的 Poseidon 摘要（常见 77~78 位十进制或 64 位 hex）、ZK Merkle 树根/叶计算、nullifier 计算。**注意单向不可逆**，别找「解密」。",
    "examples": [
      {
        "in": "1,2（BN254 t=3，初始状态 0）",
        "out": "115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189a",
        "desc": "circomlibjs 官方向量（poseidonperm_x5_254_3），hex 32 字节大端档"
      },
      {
        "in": "1,2,3,4,5,6（BN254 t=6，初始状态 0）",
        "out": "20400040500897583745843009878988256314335038853985262692600694741116813247201",
        "desc": "circomlibjs 官方向量，十进制档——t=6 是 circom 电路最常用档"
      },
      {
        "in": "0,1,2（BLS12-381 t=3，尾补零直通置换）",
        "out": "200e6982ac00df8fa65cef1fde9f21373fdbbfd98f2df1eb5fa04f3302ab0397",
        "desc": "官方参考实现 KAT 首元素（HorizenLabs 口径）"
      }
    ],
    "formulas": [
      {
        "tex": "S(x) = x^{5},\\quad \\gcd(5, p-1) = 1",
        "caption": "S-box：BN254/BLS12-381 标量域上 x^3 不是置换（3 | p-1），取 x^5"
      },
      {
        "tex": "v^{(r+1)} = M_\\mathrm{MDS}\\,(S(v^{(r)} + c^{(r)}))",
        "caption": "每轮 ARK→S-box→Mix；部分轮仅对 v[0] 施加 S（HADES）"
      },
      {
        "tex": "(M_\\mathrm{MDS})_{i,j} = \\frac{1}{x_i + y_j}",
        "caption": "Cauchy MDS 矩阵（论文 §2.3 口径，IAIK 官方生成式同源）"
      }
    ],
    "tips": [
      "认题：题目出现 circom/snarkjs/gnark/ZK Merkle 树并提到 Poseidon；摘要长度 254 位内（十进制 77~78 位、hex 64 位）→ 大概率 BN254 Poseidon。",
      "⚠ 先分辨常量口径：circomlib 系（t=3 时 R_P=57）与 HorizenLabs 参考实现系（t=3 时 R_P=56）不通用——同输入不同输出不是算错了。",
      "与本工具 SHA-3 op 完全无关：SHA-3 输入字节串，Poseidon 输入域元素；把 flag 当字节塞进 Poseidon 会得到完全不同的值。若题目要求「对字符串做 Poseidon」，通常要先按题目口径把字符串转成域元素（常见：每 31 字节一块、按大端转整数）。",
      "Merkle 树场景：论文 §4.2 建议用容量元素做域分隔（如 arity 用 $2^{arity}-1$），树高/叶子数不同则哈希不同——复算树根时确认分隔规则。",
      "输入是「域元素」不是字节：负数、小数、超域（≥ p）都会被本 op 显式拒绝。",
      "circomlibjs 官方向量 t=7/t=17（16 输入）本工具未收录实例档（文件体积取舍），如需可按同法扩展；t=2/3/5/6 已含全部官方向量。",
      "标准来源：USENIX Security 2021 论文（ePrint 2021/458）Table 2 与 §2/§4；常量佐证链 = IAIK Grain 官方脚本（circomlibjs 注记参数 1 0 254 <t> 8 <RP>）+ circomlibjs 官方测试向量 + HorizenLabs 官方仓库 KAT。"
    ],
    "aka": [
      "Poseidon",
      "Poseidon 哈希",
      "Poseidon hash",
      "x5-Poseidon",
      "Poseidonπ",
      "Poseidon permutation",
      "HADES 结构哈希",
      "Hades permutation",
      "ZK 哈希",
      "零知识友好哈希",
      "zk-friendly hash",
      "arithmetic hash",
      "circomlib Poseidon",
      "snarkjs Poseidon",
      "BN254 Poseidon",
      "BLS12-381 Poseidon",
      "poseidonperm_x5_254_3",
      "Merkle 树 ZK 哈希",
      "素域代数哈希",
      "Grain LFSR 轮常量"
    ]
  },
  "poseidon2": {
    "what": "Poseidon2 素域哈希——Poseidon 的改进版（Grassì、Khovratovich、Rechberger、Roy、Schofnegger，CRYPTO 2023）：把线性层换成「外部矩阵 M_E + 稀疏内部矩阵 M_I」两级结构，在保持安全性的同时把电路约束数压得更低（部分轮只用一次域乘/加法就能完成扩散），已成为新一代 ZK 证明系统（Plonky3/RISC Zero/zkSync 等生态）的默认哈希。同样不是 SHA-3：运算在素域 Z/p 的域元素上，与 Keccak 比特海绵毫无关系。",
    "principle": "**与原版 Poseidon 的三点不同（论文 §3）**：\n\n① **外部全轮**用低成本循环矩阵 $M_E$（t=2 为 circ(2,1)，t=3 为 circ(2,1,1)，t=4 为廉价 M4 矩阵），置换开头先做一次 $M_E$；\n② **内部部分轮**用稀疏矩阵 $M_I$（对角矩阵 + 全 1 矩阵，如 t=3 为 [[2,1,1],[1,2,1],[1,1,3]]），只需对状态求和即可完成线性层；\n③ 部分轮只对 state[0] 加常量并做 S-box（原版对全状态加常量）。\n\n**轮结构**：$M_E$ →（全轮：ARK 全宽 → $x^5$ → $M_E$）× R_F/2 →（部分轮：state[0] ARK → $x^5$ → $M_I$）× R_P →（全轮）× R_F/2。\n\n**参数（论文实例表 / 官方仓库逐字）**：BN254 t=3：d=5、R_F=8、R_P=56；BLS12-381 t=2/3/4：R_P=56。S-box 判定同 Poseidon：$\\gcd(5,p-1)=1$ → $x^5$。",
    "usage": "参数：实例档（BN254 t=3 / BLS12-381 t=2/3/4，常量取自论文作者团队官方仓库参考实现）、输入补齐口径、输入格式（dec/hex）、输出（首元素/全状态）、输出格式（十进制/hex）。\n\n输入 0..t 个域元素：默认「尾补零（compress 式）」——元素从第 1 格起放、尾部补 0，放满 t 个即官方置换直通（Merkle 树两叶 compress = 置换([左,右,0]) 取首元素，官方仓库定义）；也可选「前导初始状态」口径。**单向不可逆**。",
    "examples": [
      {
        "in": "0,1,2（BN254 t=3，尾补零=直通置换）",
        "out": "0bb61d24daca55eebcb1929a82650f328134334da98ea4f847f760054f4a3033, 303b6f7c86d043bfcbcc80214f26a30277a15d3f74ca654992defe7ff8d03570, 1ed25194542b12eef8617361c3ba7c52e660b145994427cc86296242cf766ec8",
        "desc": "官方参考实现 KAT 全状态（逐字对照 Rust 测试）"
      },
      {
        "in": "0,1（BLS12-381 t=2，直通置换）",
        "out": "73c46dd530e248a87b61d19e67fa1b4ed30fc3d09f16531fe189fb945a15ce4e, 1f0e305ee21c9366d5793b80251405032a3fee32b9dd0b5f4578262891b043b4",
        "desc": "官方 KAT（BLS12-381 t=2）"
      },
      {
        "in": "0,1,2,3（BLS12-381 t=4，直通置换）",
        "out": "28ff6c4edf9768c08ae26290487e93449cc8bc155fc2fad92a344adceb3ada6d, 0e56f2b6fad25075aa93560185b70e2b180ed7e269159c507c288b6747a0db2d, 6d8196f28da6006bb89b3df94600acdc03d0ba7c2b0f3f4409a54c1db6bf30d0, 07cfb49540ee456cce38b8a7d1a930a57ffc6660737f6589ef184c5e15334e36",
        "desc": "官方 KAT（BLS12-381 t=4）"
      }
    ],
    "formulas": [
      {
        "tex": "M_E^{(t=3)} = \\mathrm{circ}(2,1,1),\\quad M_I^{(t=3)} = \\begin{pmatrix}2&1&1\\\\1&2&1\\\\1&1&3\\end{pmatrix}",
        "caption": "外部/内部线性层（官方实例文件 MAT_INTERNAL 常量逐字一致）"
      },
      {
        "tex": "\\mathrm{Poseidon2}^{\\pi}_{R_F,R_P} = M_E \\circ (\\text{full rounds}) \\circ (\\text{partial rounds with } M_I)",
        "caption": "开头一次 M_E；全轮 ARK→x^5→M_E，部分轮仅 state[0] 进 S-box"
      },
      {
        "tex": "\\mathrm{compress}(a,b) = \\big[\\mathrm{Poseidon2}^{\\pi}([a,b,0])\\big]_0",
        "caption": "Merkle 两叶压缩 = 官方 compress 口径（本工具尾补零档）"
      }
    ],
    "tips": [
      "认题：题目提到 Poseidon2 / Plonky3 / RISC Zero / zkSync Era 的哈希；或给出「外部轮+内部轮」字样。",
      "⚠ 与原版 Poseidon 常量完全不同体系：R_F=8、R_P=56（BN254 t=3）但轮常量/MDS 与 circomlib Poseidon 无一相同——先确认算法版本再对值。",
      "BLS12-381 t=8 官方实例（R_P=57）与 Goldilocks/BabyBear 等小域实例本工具未收录（体积取舍），如需可按同法扩展。",
      "poseidon2 的 KAT 是「置换」口径：官方测试输入是 [0,1,…,t-1] 直通置换；哈希口径（补零/compress）各生态自定义，本工具两种都给并把口径写在档位名里。",
      "输出仍是域元素（< p）：十进制与 hex 两档输出可互转，验题时注意别把 32B 大端 hex 与最短 hex 当两个值。",
      "与本工具 SHA-3/SHA-2 op 无关：Poseidon2 没有「消息填充」，长度语义由调用方（Merkle 树/compress）决定。",
      "标准来源：CRYPTO 2023 论文（ePrint 2023/323）+ 论文作者团队官方仓库 plain_implementations 实例与 KAT（BN254/BLS12-381 常量逐字提取，另用同款 Sage 生成脚本思路复核轮常量派生）。"
    ],
    "aka": [
      "Poseidon2",
      "Poseidon2 哈希",
      "Poseidon2 hash",
      "Poseidon2 permutation",
      "x5-Poseidon2",
      "Poseidon 2",
      "poseidon2 vs poseidon",
      "外部全轮 内部部分轮",
      "M_E M_I 矩阵",
      "HorizenLabs Poseidon2",
      "BN254 Poseidon2",
      "BLS12-381 Poseidon2",
      "zk-friendly hash",
      "ZK 哈希",
      "零知识哈希",
      "Merkle 树哈希 zk",
      "Poseidon 改进版",
      "Grassì Poseidon2",
      "素域代数哈希",
      "HADES Poseidon2"
    ]
  },
  "kzgVerify": {
    "what": "KZG 多项式承诺的打开验证（EIP-4844 口径）——给定承诺 C（48 字节压缩群元）、求值点 z、声明值 y 与证明 π，用一次双线性配对恒等式判定「承诺对应的多项式在 z 处的取值确实是 y」。BLS12-381 曲线，配对取仓内 noble 实现，可信设置 G2 点用以太坊主网公开常量。KZG 是 zk-Rollup 与以太坊 danksharding 的底层组件，CTF 里出现于 EIP-4844 blob 取证与 zk 题目。",
    "principle": "**承诺构造**：把多项式 f(X)（次数 < 4096）承诺为群元 C = f(s)·G1，其中 s 是「可信设置仪式」生成的秘密（仪式结束后销毁，公开的只有各群元点——没有任何人知道 s）。\n\n**证明构造**：要证明 p(z) = y，就给出商多项式在 s 处的承诺：q(X) = (f(X) − y)/(X − z)（整除，因为 f(z) = y），π = q(s)·G1。\n\n**验证恒等式**（配对的双线性把「多项式整除关系」变成群元等式）：\n\n$e(C - y\\cdot G_1,\\ [1]_2) = e(\\pi,\\ [s]_2 - z\\cdot [1]_2)$\n\n左边 = e((f(s) − y)·G1, G2) = e(G1,G2)^((s−z)q(s))；右边 = e(q(s)·G1, (s − z)·G2) = e(G1,G2)^(q(s)(s−z))。两边相等 ⇔ f(s) − y = (s − z)·q(s)，而 Schwartz–Zippel 引理保证 s 未知时这只能由真多项式关系成立。验证方**全程不需要多项式本身**，只有 4 个参数、一次配对。\n\n**无穷点语义**：f 为常数多项式（或零多项式）时商恒为零，π = 无穷点；此时 e(O, X) = 1，验证按 GT 单位元处理——官方向量（c-kzg-4844）专门收录了这类「正确证明 = 无穷点」的样例，实现必须特判而不是报错。\n\n**与 Pedersen/Feldman 承诺的区别**（这是本卡最重要的一节）：\n① **Pedersen 承诺** = Σmᵢ·Gᵢ（消息对群元的线性组合）：完美隐藏、同态（可加），但**只能承诺，不能证明性质**——没有配对，无法做「打开求值点」这类验证，只能整体公开消息原像。\n② **Feldman 承诺** = Σaⱼ·Gʲ（系数对固定生成元的幂）：能**公开单个系数**做验证（VSS 里用），但每次只能验系数本身，不能在任意点打开；且承诺大小随多项式次数线性增长。\n③ **KZG 承诺**：**恒定 48 字节**承诺（不管多项式多少次），配对给出**任意点打开**的能力（一次配对验证任意 z 处取值），还能做聚合证明、数据可用性采样。代价是**必须依赖可信设置**（仪式产出的 s），而 Pedersen/Feldman 无需任何仪式。\n一句话：Pedersen 是「藏」，Feldman 是「验系数」，KZG 是「任意点验值 + 恒定大小」，三者都不是加密。",
    "usage": "两种模式：\n① **手动四元组**：参数里填 commitment（0x+96 hex）、z（0x+64 hex）、y（0x+64 hex）、proof（0x+96 hex），输出 PASS/FAIL。z/y 必须是严格小于曲线阶 r 的 32 字节域元素；C/π 必须在曲线且属 r 阶子群（允许无穷点，编码 0xc000…00）。\n② **blob 侧车**：主输入粘贴完整 blob hex（131072 字节 = 262144 hex 字符），参数填 commitment 与 proof，z/y 由 Fiat-Shamir 自动派生（域分隔串 FSBLOBVERIFY_V1_，SHA-256 后大端整数模 r）——这就是 EIP-4844 verify_blob_kzg_proof 的语义。\n\n判据：PASS 表示配对恒等式成立（数据/承诺/证明三者自洽）；FAIL 表示至少一项被改过或不匹配；输入无效（长度/字符/越界/非群元）会显式报原因，不静默。验证一次约几十毫秒（两次配对）。",
    "examples": [
      {
        "in": "（手动模式）commitment=0xa421e229…bb94d9d06，z=0x000…000，y=0x50625ad8…6367c359，proof=0xb72d8039…c9d2f400b",
        "out": "结论：验证通过 PASS（配对恒等式成立）",
        "desc": "c-kzg-4844 官方向量 verify_kzg_proof_case_correct_proof_2_0"
      },
      {
        "in": "（blob 模式）主输入=完整 131072 字节 blob，commitment=0xc000…00，proof=0xc000…00",
        "out": "结论：验证通过 PASS；z 由 Fiat-Shamir 派生 = 0x04b7b22a…56096",
        "desc": "官方 blob 向量：零 blob + 无穷点承诺/证明（Fiat-Shamir z 恰为该值）"
      },
      {
        "in": "（手动模式）把 proof 中间一个 hex 字符 0→1",
        "out": "结论：验证失败 FAIL（配对恒等式不成立）",
        "desc": "篡改面：任何一字段被改即 FAIL"
      }
    ],
    "formulas": [
      {
        "tex": "C = f(s)\\cdot G_1,\\quad \\pi = \\left(\\frac{f(X)-y}{X-z}\\right)(s)\\cdot G_1",
        "caption": "承诺与商多项式证明；s 为仪式秘密（已销毁）"
      },
      {
        "tex": "e(C - y\\cdot G_1,\\ [1]_2) = e(\\pi,\\ [s]_2 - z\\cdot [1]_2)",
        "caption": "验证恒等式（双线性配对，一次检查）"
      },
      {
        "tex": "z = \\mathrm{int}_{be}(\\mathrm{SHA\\text{-}256}(\\text{“FSBLOBVERIFY\\_V1\\_”}\\|0^8\\|\\mathrm{uint64be}(4096)\\|\\mathrm{blob}\\|C))\\ \\mathrm{mod}\\ r",
        "caption": "blob 模式的 Fiat-Shamir 求值点（c-kzg compute_challenge）"
      }
    ],
    "tips": [
      "认题：题目给 48 字节「承诺/commitment」+ 48 字节「证明/proof」+ 32 字节 z/y，或提 EIP-4844、blob、danksharding、proto-danksharding、verifyKzgProof——就是 KZG。",
      "与 BLS 签名区分：同一条 BLS12-381 曲线，但 BLS 签名验证是 e(G1,σ) = e(pk,H(m))（签名对哈希），KZG 是 e(C−yG1,[1]₂) = e(π,[s]₂−z[1]₂)（承诺对商多项式）——参数形状完全不同，别混。",
      "48 字节是 G1 压缩点（0xa4/0xb7/0xc0… 开头），96 字节是 G2 压缩点——KZG 承诺/证明都是 48 字节，BLS 签名才是 96 字节。",
      "0xc000…00（48 字节全零除首字节）是无穷点，是合法输入；「无穷点证明 + 无穷点承诺」恒为 PASS 属官方语义，不是 bug。",
      "z/y 若 ≥ 曲线阶 r（如全 ff 开头）不是合法域元素——实现会显式拒绝，不会静默取模。",
      "版本哈希（32 字节，0x01 开头）只是承诺的 SHA-256 截断指纹；看到 0x01 开头 32 字节哈希链到 EIP-4844 交易就是 blob versioned hash。",
      "与 Pedersen/Feldman 的区别速记：Pedersen 藏消息、Feldman 验系数、KZG 任意点验值且承诺恒定 48 字节但需要可信设置；三者都不是加密。",
      "标准来源：EIP-4844（blob 交易与 versioned hash）、以太坊共识规范 polynomial-commitments（KZG 接口）、c-kzg-4844 v2.1.8（参考实现与全部测试向量，本工具逐案对拍 122+29 案）。"
    ],
    "aka": [
      "KZG",
      "KZG 验证",
      "KZG proof verify",
      "verifyKzgProof",
      "verify_kzg_proof",
      "verifyBlobKzgProof",
      "KZG commitment verify",
      "KZG 承诺验证",
      "KZG 多项式承诺",
      "polynomial commitment",
      "EIP-4844",
      "EIP-4844 blob",
      "proto-danksharding",
      "danksharding",
      "blob proof",
      "Kate-Zaverucha-Goldberg",
      "KZG opening",
      "KZG pairing check",
      "blob_kzg_proof",
      "KZG 打开验证"
    ]
  },
  "kzgCommit": {
    "what": "由 EIP-4844 blob 计算 KZG 承诺与版本哈希。blob = 131072 字节 = 4096 个 32 字节 BLS12-381 域元素（一个多项式的取值形式）；承诺 = 取值向量对主网可信设置 G1 Lagrange 点的线性组合，恒定 48 字节；版本哈希 = 0x01 ‖ SHA-256(承诺) 的后 31 字节，就是 type-3 交易里 blob_versioned_hashes 列表中的那 32 字节。可选同时生成打开证明并自验。",
    "principle": "**blob 的多项式语义**：blob 的第 i 个 32 字节块 = 多项式 f 在 4096 阶乘法子群第 i 个单位根处的取值。注意下标是 **12 位位反转序**（c-kzg 的 FFT 友好排序 brp）——同一个 blob 用自然序解释会得到完全不同的多项式与错误承诺（这是最容易踩的坑，官方向量可证）。\n\n**承诺 = Lagrange 域线性组合**：C = Σᵢ f(ωᵢ)·[Lᵢ(τ)]·G1，其中 [Lᵢ(τ)]·G1 是可信设置第 i 个 G1 点（Lagrange 形式）。不需要先把取值转成系数（IFFT），4096 次点标量乘一次完成；本工具用 Pippenger 桶法加速，单次约 0.3~0.5 秒。\n\n**版本哈希**：$\\mathrm{vh} = \\texttt{0x01} \\| \\mathrm{SHA\\text{-}256}(C)[1..31]$——版本字节 0x01 表示 KZG（当前 EIP-4844 唯一定义版本），剩下 31 字节是承诺哈希的截断。交易里只带版本哈希，执行层用它索引 blob，共识层才验承诺与证明。\n\n**打开证明（可选输出）**：z 由 Fiat-Shamir 从 (blob, C) 派生，y = f(z) 用重心公式在取值形式下直接算（不需要系数），商多项式 q(ωᵢ) = (f(ωᵢ) − y)/(ωᵢ − z) 再做一次线性组合即 π——全程 Lagrange 域，与 c-kzg compute_blob_kzg_proof 逐字节一致（含 z 落在求值域内的洛必达分支）。\n\n**不是加密**：承诺是多对一的群元绑定——从 C 或版本哈希都还原不出 blob；它只证明「某个多项式存在且被绑定」，隐藏性来自多项式本身的不确定性，不是密钥加密。",
    "usage": "主输入粘贴 blob hex（131072 字节，可带 0x，允许空白/换行分隔）。每个 32 字节块必须是严格小于曲线阶 r 的规范域元素，越界块显式报错（c-kzg blob_to_polynomial 同口径）。\n\n输出：承诺（0x + 96 hex）+ 版本哈希（0x + 64 hex）+ 耗时。勾选「同时生成打开证明并自验」会追加 proof/z/y 三行并自动做一次配对自验（约多一倍时间）。\n\n链上核对姿势：拿交易 blob_versioned_hashes 里的 32 字节，与本地 blob 算出的版本哈希逐字节比对——一致即 blob 未被篡改。",
    "examples": [
      {
        "in": "（blob_to_kzg_commitment_case_valid_blob_2 的完整 131072 字节 blob）",
        "out": "承诺 commitment: 0xa421e229…bb94d9d06；版本哈希: 0x014edfed…e2567f1",
        "desc": "c-kzg-4844 官方向量逐字节一致；版本哈希 = 0x01 + SHA-256(承诺)[1..31]"
      },
      {
        "in": "同上 blob，勾选「生成证明并自验」",
        "out": "proof: 0xa2aeea08…4470b65c8；z: 0x4f00eef9…3bfbb31a；自验 PASS",
        "desc": "compute_blob_kzg_proof 同款 Fiat-Shamir 链路"
      },
      {
        "in": "把某个 32 字节块改成全 ff（≥ r）",
        "out": "报错：第 N 个 32 字节块不是规范域元素（≥ r）",
        "desc": "官方 invalid_blob 向量同判：显式拒绝不静默"
      }
    ],
    "formulas": [
      {
        "tex": "C = \\sum_{i=0}^{4095} f(\\omega^{\\mathrm{rev}_{12}(i)})\\cdot [L_i(\\tau)]\\cdot G_1",
        "caption": "承诺 = 取值（位反转域序）与 Lagrange 可信设置点的线性组合"
      },
      {
        "tex": "\\mathrm{vh} = \\texttt{0x01}\\,\\|\\,\\mathrm{SHA\\text{-}256}(C)[1..31]",
        "caption": "版本哈希（VERSIONED_HASH_VERSION_KZG = 0x01）"
      },
      {
        "tex": "y = \\frac{z^{4096}-1}{4096}\\sum_i \\frac{\\omega^{\\mathrm{rev}_{12}(i)}\\cdot f(\\omega^{\\mathrm{rev}_{12}(i)})}{z-\\omega^{\\mathrm{rev}_{12}(i)}}",
        "caption": "取值形式下的重心求值（免 IFFT）"
      }
    ],
    "tips": [
      "认题：题目给 131072 字节（131072×2 = 262144 个 hex 字符）的大 hex、或说「blob sidecar / blob data」，要求算 commitment 或 versioned hash——用它。",
      "blob 长度恒为 131072 字节（4096×32B，FIELD_ELEMENTS_PER_BLOB），少一字节都不是 blob——先查长度再查域元素规范。",
      "域序坑：blob 下标是位反转序（brp），不是自然序——用错序算出的承诺与链上不一致且没有任何报错，务必用官方向量对拍过实现。",
      "版本哈希只哈希 48 字节承诺本身，不含 blob——先算承诺再哈希，顺序不能反。",
      "自验断言：生成的证明应能通过「KZG 证明验证」（blob 模式）；两者输出互为交叉验证。",
      "性能预期：单次承诺约 0.3~0.5 秒（4096 点 Pippenger MSM）；生成证明再加一次等价运算；验证只要几十毫秒。",
      "与 Pedersen/Feldman 的区别：KZG 承诺恒定 48 字节且能任意点打开（配对验证），Pedersen 无打开能力、Feldman 只能验系数且承诺随次数线性增长；KZG 需要可信设置，另两者不需要。",
      "标准来源：EIP-4844（blob 结构与 versioned hash）、c-kzg-4844 v2.1.8（blob_to_kzg_commitment/compute_blob_kzg_proof 参考实现，本工具 11+15 案逐字节对拍）、以太坊主网可信设置（KZG Ceremony 公开产出）。"
    ],
    "aka": [
      "KZG commitment",
      "blob_to_kzg_commitment",
      "KZG blob 承诺",
      "blob commitment",
      "versioned hash",
      "blob versioned hash",
      "blobVersionedHash",
      "VERSIONED_HASH_VERSION_KZG",
      "EIP-4844 blob",
      "KZG 承诺计算",
      "blob 承诺",
      "KZG commit",
      "4844 blob",
      "proto-danksharding blob",
      "blob sidecar",
      "KZG 线性组合",
      "Lagrange commitment",
      "danksharding blob",
      "blob 哈希",
      "type-3 交易"
    ]
  },
  "kzgBlobParse": {
    "what": "EIP-4844 相关字段的解析与结构展示：识别并拆解 blob（131072 字节 = 4096 个 32 字节域元素）、type-3 交易的 blob_versioned_hashes 列表（32 字节版本哈希，0x01 版本字节开头）、单个 48 字节 KZG 承诺。只读解析，不做任何计算（承诺/验证请配合另两个 op）。",
    "principle": "**EIP-4844 的三层数据形状**（本 op 逐一识别）：\n① **blob 本体**：恒定 131072 字节，按 32 字节切为 4096 个 BLS12-381 标量域元素；每个元素必须严格小于曲线阶 r（0x73eda753…00000001），越界即非法 sidecar。展示内容：域元素总数、规范校验、零元素计数、首末元素样例。\n② **versioned hash**：32 字节 = 版本字节 + 31 字节载荷。版本字节 0x01 = KZG（当前唯一定义版本），载荷 = SHA-256(承诺) 的第 1..31 字节；其他版本字节如实标注「未知」，不冒充已知结构。展示内容：版本判定、载荷、前 4 字节视图（版本字节 + 载荷前 3 字节）。\n③ **KZG 承诺**：48 字节压缩 G1 点（0xc0 开头 = 无穷点）。展示内容：曲线/子群校验结论。\n\n**它们的关系**：blob --(KZG 承诺)--> 48B 承诺 --(0x01+SHA-256 截断)--> 32B 版本哈希；一笔 type-3 交易的 blobs 数组与 blob_versioned_hashes 数组按序一一对应。版本哈希是承诺的单向指纹——**不可逆**，不能从版本哈希还原 blob 或承诺。",
    "usage": "主输入三选一（自动识别）：\n① 一个 blob（262144 个 hex 字符）→ 输出域元素结构与规范校验；\n② 一个或多个 32 字节哈希（64 hex/个，空白或换行分隔）→ 输出每个的版本判定与载荷；\n③ 一个 48 字节点（96 hex）→ 输出承诺形态校验。\n其他长度显式报错并提示三种合法形态。纯解析毫秒级完成，不加载可信设置。",
    "examples": [
      {
        "in": "014edfed8547661f6cb416eba53061a2f6dce872c0497e6dd485a876fe2567f1 02abab…ab（两个 32 字节）",
        "out": "#1 版本字节 0x01 → KZG，载荷=SHA-256(承诺)[1..31]；#2 版本字节 0x02 → 未知版本（如实标注）",
        "desc": "type-3 交易 blob_versioned_hashes 列表的逐项判定"
      },
      {
        "in": "（131072 字节 blob hex）",
        "out": "识别：blob；4096 个域元素；规范校验全部合法/越界首块下标；零元素计数；首末元素",
        "desc": "sidecar 数据结构视图"
      },
      {
        "in": "a421e229…bb94d9d06（48 字节）",
        "out": "识别：48 字节压缩 G1 点 = KZG 承诺形态（曲线上、r 阶子群内）",
        "desc": "承诺形态校验"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{vh} = \\texttt{0x01}\\,\\|\\,\\mathrm{SHA\\text{-}256}(C)[1..31]\\quad(\\text{版本字节} = 1\\ \\text{字节})",
        "caption": "versioned hash 的字节构成（前 4 字节视图 = 版本 + 载荷前 3 字节）"
      },
      {
        "tex": "\\mathrm{blob} = \\underbrace{b_0\\|b_1\\|\\cdots\\|b_{4095}}_{4096\\times 32\\mathrm{B}},\\quad b_i < r",
        "caption": "blob 的域元素切分与规范条件"
      }
    ],
    "tips": [
      "认题：拿到一笔 EIP-4844 交易（type 0x03）想看 blob 字段、或拿到一坨 131072 字节 hex 不知道是什么——先扔进来识别。",
      "长度速判：64 hex = versioned hash；96 hex = 承诺；262144 hex = blob；其他长度直接看报错提示。",
      "0x01 开头的 32 字节是 KZG 版本哈希；开头字节不是 0x01 时如实按未知版本标注，不要硬套 SHA-256 截断语义。",
      "版本哈希 ≠ 哈希原文：它只截断 31 字节（248 位），理论上可碰撞但工程上不可行；它是承诺的指纹而不是 blob 的哈希——blob 要先算出承诺才能得到版本哈希。",
      "越界域元素（≥ r）的 blob 会被 c-kzg 直接拒绝——解析器标出首个越界下标便于定位被改的字节。",
      "与「KZG blob 承诺」「KZG 证明验证」配合使用：本 op 只看结构，算承诺/验证明用那两个。",
      "标准来源：EIP-4844（blob 交易结构、versioned hash 定义）、c-kzg-4844 v2.1.8（blob 域元素规范校验口径）。"
    ],
    "aka": [
      "EIP-4844 blob 解析",
      "blob parse",
      "blob 字段解析",
      "blobVersionedHash 解析",
      "versioned hash parse",
      "blob_versioned_hashes",
      "type-3 交易",
      "blob 交易",
      "KZG 承诺解析",
      "blob 结构",
      "4844 blob 结构",
      "blob sidecar 解析",
      "版本哈希解析",
      "KZG blob 字段",
      "blob hex 识别",
      "BLS12-381 域元素",
      "blob domain",
      "blob 结构查看",
      "proto-danksharding 解析",
      "blob 取证"
    ]
  },
  "sshKeyParse": {
    "what": "OpenSSH 私钥解析——把 `-----BEGIN OPENSSH PRIVATE KEY-----`（openssh-key-v1 容器，ssh-keygen 默认私钥格式）解析成结构报告、SHA256 指纹、授权行（authorized_keys 那一行），并输出 PKCS#8/SPKI 标准 PEM。支持口令解密（bcrypt KDF + AES-256-CTR/CBC）与无口令档，支持 ssh-ed25519、ssh-rsa、ecdsa-sha2-nistp256/384/521 四类密钥。CTF 取证里拿到 id_ed25519/id_rsa 私钥文件（可能加密）时的第一站。",
    "principle": "**容器格式（OpenSSH PROTOCOL.key）**：`openssh-key-v1\\0` 魔数（15 字节）后接 SSH wire 字段：`string ciphername`、`string kdfname`、`string kdfoptions`、`uint32 N`、`string 公钥×N`、`string 加密且补齐的私钥列表`。私钥列表解密后为 `uint32 checkint ×2` + 每把私钥的 wire 字段 + `string 注释` + 1,2,3,… 补齐字节；两个 checkint 相等即口令正确（快速校验）。\n\n**KDF = bcrypt_pbkdf（OpenSSH openbsd-compat/bcrypt_pbkdf.c）**：口令与盐先做 SHA-512 预处理；每 32 字节输出块做 $r$ 轮 bcrypt_hash 并异或累加，再按 stride 交错散布输出（与 PBKDF2 的线性输出不同，防「只算一块就组子密钥」）；bcrypt_hash 的魔文是 `OxychromaticBlowfishSwatDynamite`（注意与 bcrypt 本体的 OrpheanBeholderScryDoubt 不同），EksBlowfish expand0 次序为先盐后口令。派生 48 字节 = AES-256 密钥 32B + IV 16B。\n\n**PEM 导出口径**：Ed25519 → PKCS#8（RFC 5958，曲线 OID 1.3.101.112）；RSA → PKCS#8 包 PKCS#1（RFC 8017 A.1.2，dP/dQ 由 d mod p−1/q−1 现算，qInv 用容器内 iqmp）；ECDSA → PKCS#8 与 SEC 1 v2 传统双格式；公钥 → SPKI。指纹 = `SHA256:` + base64(SHA-256(公钥 blob))（RFC 4716/FIDO 口径，与 `ssh-keygen -l` 一致）。",
    "usage": "输入：私钥文件全文（含 BEGIN/END 标记）或裸 base64。参数：口令（仅加密私钥需要，留空只支持未加密档）。\n\n输出：cipher/kdf/rounds/salt 结构、每把密钥的类型/SHA256 指纹/注释、Ed25519 的 seed 与公钥 hex、RSA 的 n/e/d/p/q/dP/dQ/qInv、ECDSA 的曲线/d/公钥点、授权行；下方按钮下载私钥 PKCS#8 PEM 与公钥 SPKI PEM（EC 另有 SEC1）。\n\n适用：CTF 取证私钥还原、把 OpenSSH 私钥转成 openssl/node 可用的 PEM、核对指纹与注释。**口令与密钥材料只在本地内存处理，不上传**。",
    "examples": [
      {
        "in": "-----BEGIN OPENSSH PRIVATE KEY-----（未加密 ed25519，注释 plain）",
        "out": "类型 = ssh-ed25519；指纹 = SHA256:R1CGvcz/GxYBpA90zfnu+1QcwyrneCPN6wgzofQcl9E；seed (32B hex) = 2deebd0c6da224edd4c5dbd37533960ad5abad96d0da5199204fb06ccc26ee27；公钥 = ae4947c08c13b654a9fb1b72dea39feec37ec8e6812cc4f4b0cdfc6ea5f95971（输出摘录）",
        "desc": "实跑输出：结构 + 指纹 + seed/公钥 hex，PEM 走下载按钮"
      },
      {
        "in": "aes256-ctr + bcrypt KDF（rounds=16）的加密 ed25519，口令 ctp4ss",
        "out": "解密成功，checkint 一致，seed/公钥/PEM 同上格式；错误口令则报「checkint 校验不一致（口令错误或密文损坏）」",
        "desc": "加密档：口令正确解出明文；口令错误显式报错不静默"
      },
      {
        "in": "加密 rsa 2048（口令 rsapass）",
        "out": "类型 = ssh-rsa；n/p/q/d/iqmp 全字段，p·q=n、e·d≡1 mod φ、iqmp=q⁻¹ mod p 自检通过，PKCS#8 PEM 被 openssl pkey 接受",
        "desc": "RSA 档：六 mpint 字段（n,e,d,iqmp,p,q）解析并做数学自检"
      }
    ],
    "formulas": [
      {
        "tex": "km = \\mathrm{bcrypt\\text{-}pbkdf}(\\mathrm{pass},\\mathrm{salt},48,r),\\quad key=km_{[0..32)},\\; iv=km_{[32..48)}",
        "caption": "bcrypt KDF 派生 AES-256-CTR/CBC 的密钥与 IV（PROTOCOL.key §4）"
      },
      {
        "tex": "out_i = \\bigoplus_{j=1}^{r} \\mathrm{bcrypt\\text{-}hash}(\\mathrm{SHA512}(\\mathrm{pass}),\\, \\mathrm{SHA512}(\\cdot))",
        "caption": "每 32B 块 r 轮 bcrypt_hash 异或累加，输出按 stride 交错散布"
      },
      {
        "tex": "d_P = d \\bmod (p-1),\\quad d_Q = d \\bmod (q-1),\\quad q_{inv} = q^{-1} \\bmod p",
        "caption": "RSA CRT 参数：容器只存 iqmp，dP/dQ 现场计算（RFC 8017 A.1.2）"
      }
    ],
    "tips": [
      "认题：取证题给 id_rsa/id_ed25519 附件且 `ssh-keygen -y -f key` 要口令 → 本 op 解密；题目给 `SHA256:xxx` 指纹让你对公钥 → 指纹行直接对。",
      "加密档只认 `kdfname=bcrypt`；cipher 支持 aes256-ctr / aes256-cbc / none。老式 PEM（`BEGIN RSA PRIVATE KEY` + Proc-Type 头）不是 openssh-key-v1 容器，走本工具的 PEM/JWK 系列 op。",
      "错误口令的表现是 checkint 不一致或补齐字节非法——本 op 明确报错，不会输出一堆乱码 PEM 让你自己猜。",
      "openssh-key-v1 的私钥段是内联 wire 字段（string 类型 + 各参数 + string 注释），不是「整体加长度前缀的 blob」——手工解析常见坑。",
      "bcrypt_pbkdf ≠ bcrypt 口令哈希：前者是 KDF（输出任意长度密钥流），魔文 OxychromaticBlowfishSwatDynamite；后者魔文 OrpheanBeholderScryDoubt 且输出固定 23 字节。两者不能互解。",
      "seed 与公钥可互推（Ed25519 公钥 = 基点标量乘），本 op 会用容器内公钥做一致性校验；X25519 类私钥不在 OpenSSH 用户密钥体系内。",
      "标准来源：OpenSSH PROTOCOL.key（v1.4 2024-03-30）、openbsd-compat/bcrypt_pbkdf.c（v1.17 2022-12-27）、RFC 4251/4253（wire 格式）、RFC 5958/8017/SEC1 v2（PEM 导出）、RFC 4716（指纹口径）。"
    ],
    "aka": [
      "OpenSSH 私钥解析",
      "openssh-key-v1",
      "OpenSSH private key",
      "ssh-keygen 私钥",
      "BEGIN OPENSSH PRIVATE KEY",
      "id_ed25519 解析",
      "id_rsa 解析",
      "SSH 私钥解密",
      "OpenSSH key decrypt",
      "bcrypt KDF",
      "bcrypt_pbkdf",
      "aes256-ctr 私钥",
      "SSH key to PEM",
      "OpenSSH 转 PKCS#8",
      "ssh key fingerprint",
      "SHA256 指纹",
      "authorized_keys 公钥行",
      "SSH 私钥转 PEM",
      "OpenSSH 容器解析"
    ]
  },
  "pkcs12Parse": {
    "what": "PKCS#12 / PFX 容器解析（RFC 7292）——.p12/.pfx 是「证书 + 私钥 + 属性」的口令保护打包格式（浏览器/Windows 证书导入导出、CTF misc 取证常见附件）。本 op 列出容器结构树、校验 macData 口令完整性 MAC、用口令解密 encryptedData 与加密私钥包，把证书与私钥导出为标准 PEM。不做证书链验证。",
    "principle": "**结构（RFC 7292 §4）**：`PFX ::= SEQ{ version=3, authSafe ContentInfo, macData 可选 }`。authSafe（data 类型）内嵌 DER 的 AuthenticatedSafe = 一串 ContentInfo，每项要么是明文 data（SafeContents），要么是 encryptedData（口令加密的 SafeContents）。SafeContents 是 SafeBag 列表：keyBag（明文 PKCS#8 私钥）、pkcs8ShroudedKeyBag（加密 PKCS#8）、certBag（内嵌 X.509 证书 DER），属性带 friendlyName（BMPString）与 localKeyID（配对证书与私钥的钥匙）。\n\n**口令 KDF（RFC 7292 附录 B）**：口令转 BMPString（UTF-16BE + 0x0000 终止；空口令 = 仅终止符，与 OpenSSL 互操作实测一致）；`D`=ID 字节重复（1=密钥/2=IV/3=MAC）、盐与口令各自循环填充到 64 字节倍数拼成 I；每块输出 $A = H^r(D\\|I)$，再用 $I_j = (I_j + B + 1) \\bmod 2^v$ 反馈搅动。SHA-1 取 u=20/v=64，SHA-256 取 u=32/v=64。\n\n**算法覆盖**：传统 pbeWithSHAAnd{3-Key,2-Key}TripleDES-CBC 与 pbeWithSHAAnd{128,40}BitRC2-CBC（RC2 按 RFC 2268 全实现，含 40 位有效密钥）；现代 PBES2 = PBKDF2（PRF HMAC-SHA1/224/256/384/512）+ AES-128/192/256-CBC 或 3DES——注意 **PKCS#12 内的 PBES2 口令用原始 UTF-8 字节而非 BMPString**（RFC 8018 语义，OpenSSL 实测对拍）。MAC 密钥由 ID=3 KDF 派生，HMAC 作用于 authSafe 内容字节。",
    "usage": "输入：.p12/.pfx 文件的 base64（或 hex）。参数：口令（留空按空口令尝试，很多 CTF 附件口令为空）。\n\n输出：版本/结构树、macData 的算法/迭代/校验结果、每个 bag 的类型与属性（名称、localKeyID）、证书的版本/序列号/主题/签发者/有效期、私钥算法；下方按钮下载证书 PEM（CERTIFICATE）与私钥 PEM（PRIVATE KEY）。\n\n适用：取证题给 .p12 附件让找私钥/证书、把 PFX 拆成 openssl 能吃的 PEM、验证口令是否正确（MAC 通过=口令对）。**口令只在本地处理，零外发**。",
    "examples": [
      {
        "in": "（openssl pkcs12 -export 默认参数生成的 .p12，口令 secret123）",
        "out": "macData：SHA256，迭代 2048 → MAC 校验：✓ 通过；安全内容 1（encryptedData，PBES2（PBKDF2-HMAC-SHA256 ×2048 + aes-256-cbc））口令解密成功：certBag X.509 v3 序列号…主题 CN=…；安全内容 2（data，明文）→ pkcs8ShroudedKeyBag 口令解密成功，rsaEncryption（输出摘录）",
        "desc": "OpenSSL 3 默认形态：PBES2+AES 外层 + 明文 SafeContents 内层"
      },
      {
        "in": "（-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-RC2-40 -macalg sha1 生成的老式 .p12）",
        "out": "macData：sha1，迭代 2048 → ✓ 通过；encryptedData pbeWithSHAAnd3-KeyTripleDES-CBC（×2048）解密成功；certBag pbeWithSHAAnd40BitRC2-CBC 解密成功",
        "desc": "传统 PBE 全覆盖（3DES/RC2-40 自实现，RC2 过 RFC 2268 全部 8 组官方向量）"
      },
      {
        "in": "（同一 .p12 换错误口令）",
        "out": "MAC 校验：✗ 不一致（口令可能错误或数据被改）＋各加密段「口令解密失败：填充字节非法」——两条线索都指向口令错误",
        "desc": "错误口令在报告内呈现，不崩、不静默"
      }
    ],
    "formulas": [
      {
        "tex": "I_j = (I_j + B + 1) \\bmod 2^{v},\\quad B = A \\text{ 重复到 } v \\text{ 字节}",
        "caption": "RFC 7292 B.2 的反馈搅动步（区别于 PBKDF2 的关键）"
      },
      {
        "tex": "pass \\to \\mathrm{BMPString}: \\sum 2\\text{-byte UTF-16BE} \\,\\|\\, 0x0000",
        "caption": "口令编码：传统 PBE/MAC 用 BMPString；PBES2 用原始 UTF-8 字节"
      },
      {
        "tex": "T8 = \\lceil T_1/8 \\rceil,\\quad TM = 255 \\bmod 2^{8 + T_1 - 8 T_8}",
        "caption": "RC2 有效密钥位 T1 的掩码口径（RFC 2268 §2，40 位档靠它收窄）"
      }
    ],
    "tips": [
      "认题：附件 .p12/.pfx + 「口令未知/弱口令」→ 先空口令试本 op；MAC ✓ 即口令正确；✗ 但结构完整 → 用本报告的算法/迭代信息喂爆破工具（如 p12crack 思路）。",
      "MAC 通过只代表口令对上了 macData；有些文件 MAC 与加密口令不同（罕见）——看每个 bag 各自的「解密成功/失败」行。",
      "friendlyName 是 BMPString（UTF-16BE）不是 UTF-8——直接按字节 grep 中文证书名会失败，本 op 已正确解码。",
      "PBES2 的 PBKDF2 常省略 keyLen 参数（OpenSSL 如此），此时密钥长度由加密方案定（AES-256→32B、3DES→24B）；手工解析别在这里卡住。",
      "PKCS#12 内的 PBES2 口令是原始 UTF-8 字节，而传统 PBE/MAC 是 BMPString——同一口令两套编码是规范行为，不是 bug。",
      "本 op 只解析展示，不验证证书链/签名；需要验链用 openssl verify。私钥输出为未加密 PKCS#8 PEM，注意保管。",
      "标准来源：RFC 7292（PKCS#12 v1.1）、RFC 8018（PBES2/PBKDF2）、RFC 2268（RC2，含 8 组官方测试向量）、RFC 5958（PKCS#8）。"
    ],
    "aka": [
      "PKCS#12",
      "PKCS12",
      "PFX",
      ".p12",
      ".pfx 解析",
      "PKCS#12 解密",
      "PKCS12 password",
      "PKCS#12 转 PEM",
      "pbeWithSHAAnd3-KeyTripleDES-CBC",
      "pbeWithSHAAnd40BitRC2-CBC",
      "PBES2",
      "PKCS#12 MAC",
      "certBag",
      "pkcs8ShroudedKeyBag",
      "keyBag",
      "PKCS#12 KDF",
      "RFC 7292",
      "证书包解析",
      "PFX 口令"
    ]
  },
  "jwkOkpImport": {
    "what": "JWK OKP 导入——把 RFC 8037 的 OKP（Octet Key Pair）JWK JSON（Ed25519/X25519）转成本工具常用的 hex 与标准 PEM：公钥 → SPKI（PUBLIC KEY），私钥 → PKCS#8（PRIVATE KEY）。Ed25519 会用私钥重算公钥做一致性校验。JWT（EdDSA）与现代协议题里拿到 {\"kty\":\"OKP\",...} 时的入口。",
    "principle": "**JWK 字段（RFC 7517/8037 §2）**：`kty:\"OKP\"`、`crv:\"Ed25519\"|\"X25519\"`、`x` = 公钥 32 字节的 base64url（无 padding，RFC 7515 §3.2）、`d` = 私钥 32 字节 base64url（Ed25519 的 d 即 32 字节 seed）。\n\n**PEM 映射（RFC 8410/5958）**：Ed25519 曲线 OID = 1.3.101.112，X25519 = 1.3.101.110；PKCS#8 = `SEQ{INTEGER 0, SEQ{OID}, OCTET STRING(OCTET STRING(seed))}`（私钥外多一层 OCTET STRING 包装是 RFC 5958 对 CurvePrivateKey 的规定，手写常漏）；SPKI = `SEQ{SEQ{OID}, BIT STRING(0x00‖pub)}`。\n\n**一致性校验**：Ed25519 公钥 = SHA-512(seed) clamp 后基点标量乘——本 op 现场重算并与 x 比对，不配套直接报错；X25519 没有独立的「由私钥验公钥」签名语义（公钥 = X25519(d, 9)，RFC 8037 §4 不强制校验），做结构校验并如实说明。",
    "usage": "输入：JWK JSON（kty OKP）。x 必填 32 字节，d 可选 32 字节。\n\n输出：x/d 的 hex、一致性校验结果；按钮下载公钥 SPKI PEM 与私钥 PKCS#8 PEM（有 d 时）。\n\n适用：JWT EdDSA 题目给 JWK 私钥要签名、现代协议题给 X25519 JWK 要 ECDH 前置转换、把网页/配置里的 OKP JSON 变成 openssl 可用格式。密钥材料只在本地处理零外发。",
    "examples": [
      {
        "in": "{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"d\":\"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A\",\"x\":\"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo\"}",
        "out": "d (私钥 32B hex) = 9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60；x (公钥 32B hex) = d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a；一致性校验：publicKey(d) ✓ 等于 x",
        "desc": "RFC 8037 §A.3 官方向量，逐字段一致"
      },
      {
        "in": "同上但 d 改一位",
        "out": "显式报错「Ed25519 一致性校验失败：publicKey(d) ≠ x（d 与 x 不配套或数据有误）」",
        "desc": "d/x 不配套是契约违反，硬报错不给 PEM"
      },
      {
        "in": "{\"kty\":\"OKP\",\"crv\":\"X25519\",…}",
        "out": "结构校验 + x/d hex + 两份 PEM；一致性校验行注明「X25519 无独立公钥重算路径（RFC 8037），已做结构校验」",
        "desc": "X25519 档：如实说明校验边界"
      }
    ],
    "formulas": [
      {
        "tex": "pk = \\mathrm{clamp}(\\mathrm{SHA512}(d)_{[0..32]})\\cdot B \\in \\mathbb{E}",
        "caption": "Ed25519 公钥重算（RFC 8037 §4 一致性校验的依据）"
      },
      {
        "tex": "\\mathrm{PrivateKeyInfo} = \\mathrm{SEQ}\\{0,\\,\\mathrm{SEQ}\\{OID\\},\\,\\mathrm{OCTET\\,STRING}(\\mathrm{OCTET\\,STRING}(d))\\}",
        "caption": "RFC 5958 的双层 OCTET STRING 包装——手写 PKCS#8 最常见的坑"
      }
    ],
    "tips": [
      "认题：JWT header 的 alg=EdDSA / 题目给 JWK JSON → 本 op；给的是 PEM 就走导出档反向。",
      "base64url 与 base64 不同：字符表 -_ 且无 =；带 padding 直接报错（RFC 7515 §3.2），别手抖补等号。",
      "Ed25519 的 d 是 seed 不是扩展私钥（64 字节形态）——JWK 里永远是 32 字节；拿到 64 字节的要截前 32。",
      "X25519 的 JWK 在 ECDH 题（Curve25519 协商）里当「私钥/公钥对」用，与 Ed25519 签名钥匙同形不同用，看协议语境。",
      "公私不配套的 JWK 在 JWT 验签时会得到「签名无效」而不是报错——先用本 op 的校验行排掉这种坑。",
      "标准来源：RFC 8037（OKP）、RFC 7517/7515（JWK/JWS 编码）、RFC 8410（Curve25519/Ed25519 OID 与 PKIX）、RFC 5958（PKCS#8）。"
    ],
    "aka": [
      "JWK OKP 导入",
      "OKP JWK",
      "Ed25519 JWK",
      "X25519 JWK",
      "JWK 导入",
      "kty OKP",
      "RFC 8037",
      "JWK to PEM",
      "Ed25519 公钥 JSON",
      "Octet Key Pair",
      "crv Ed25519",
      "JWK d x 字段",
      "base64url JWK",
      "OKP 私钥导入",
      "EdDSA JWK",
      "JSON Web Key OKP"
    ]
  },
  "jwkOkpExport": {
    "what": "JWK OKP 导出——反向：把 SPKI 公钥 PEM / PKCS#8 私钥 PEM / raw hex（公钥 32B、Ed25519 seed‖公钥 64B）转成标准 JWK JSON（kty OKP，base64url 无 padding）。PKCS#8 只有私钥时自动重算公钥补齐 x。做 JWT EdDSA 签名、构造 JWK Set 或写题解时的出口。",
    "principle": "**输入判别**：PEM 按 BEGIN/END 标签识别 SPKI（PUBLIC KEY→x）或 PKCS#8（PRIVATE KEY→d，公钥由私钥重算：Ed25519 用基点标量乘、X25519 用 X25519(d, 9)）；raw hex 按长度判别——32B 当公钥（X25519 的 32B 无法区分公私，按公钥处理并提示）、64B 按 Ed25519 seed‖公钥 拆分并做重算校验。\n\n**编码（RFC 7515 §3.2）**：base64url 无 padding——`+→-`、`/→_`、去 `=`。字段顺序 kty/crv/x/d 按惯例输出，解析端不依赖顺序。\n\n**校验**：Ed25519 64B 输入现场重算 publicKey(seed) 与附带公钥比对，不一致硬报错；PKCS#8 导入后同样可重算——保证输出的 JWK 自洽（防把损坏私钥写进题解）。",
    "usage": "输入：PEM 或 raw hex。参数：曲线下拉（raw hex 输入时用；PEM 自动识别）。\n\n输出：x/d hex + 格式化 JWK JSON（可下载 .jwk.json）。\n\n适用：把 openssl/node 生成的 Ed25519/X25519 密钥转成 JWT 库要的 JWK、给 JWK Set 补成员、题解里贴标准 JSON。密钥材料只在本地处理零外发。",
    "examples": [
      {
        "in": "（PEM）-----BEGIN PRIVATE KEY-----（Ed25519 PKCS#8，seed 9d61b19d…7f60）",
        "out": "JWK：{\"kty\":\"OKP\",\"crv\":\"Ed25519\",\"x\":\"11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo\",\"d\":\"nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A\"}——x 由 d 自动重算，与 RFC 8037 §A.3 一致",
        "desc": "PKCS#8 → 完整 JWK（x 现场重算）"
      },
      {
        "in": "（64B hex）9d61b19d…7f60d75a9801…511a（seed‖公钥）",
        "out": "重算校验通过 → 同上 JWK；若两段不配套则显式报错",
        "desc": "raw hex 档：64B 自动拆分并校验"
      },
      {
        "in": "（32B hex，X25519 下拉）",
        "out": "x = 该 32B，无 d；提示「X25519 的 32B 输入无法区分公钥/私钥，已按公钥处理」",
        "desc": "X25519 32B 档：如实标注歧义边界"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{b64url}(b) = \\mathrm{b64}(b) \\text{ with } +\\!\\to\\!-\\;,\\;/\\!\\to\\!\\_\\;,\\; =\\!\\to\\!\\epsilon",
        "caption": "JWK 的 base64url 无 padding 编码（RFC 7515 §3.2）"
      },
      {
        "tex": "pk_{X25519} = X25519(d, 9)",
        "caption": "X25519 公钥重算：基点 u=9 的 Montgomery 阶梯标量乘"
      }
    ],
    "tips": [
      "JWT 题流程：题目给 PKCS#8 私钥 PEM → 本 op 得 JWK → 喂 jwt 库（alg=EdDSA）签名；验证端只要 x。",
      "导出的 d 属私钥敏感材料：题目环境里贴出前确认是否需要；本工具不存储不上传。",
      "openssl 生成的 Ed25519 PEM 是 PKCS#8（BEGIN PRIVATE KEY）；若是 BEGIN PUBLIC KEY 则只能得到无 d 的公钥 JWK。",
      "JWK 数组（JWK Set）= {\"keys\":[…]}，把多个本 op 输出拼进去即可。",
      "与导入档构成往返闭环：JWK→PEM→JWK 逐字节稳定（已入验证脚本）。",
      "标准来源：RFC 8037/7517/7515/8410/5958。"
    ],
    "aka": [
      "JWK OKP 导出",
      "导出 JWK",
      "PEM to JWK",
      "Ed25519 PEM 转 JWK",
      "X25519 JWK 导出",
      "OKP JSON",
      "公钥 JWK",
      "私钥 JWK",
      "RFC 8037 导出",
      "JWK Set 成员",
      "EdDSA 密钥 JSON",
      "JSON Web Key 导出",
      "JWK base64url",
      "OKP 导出",
      "JWT EdDSA 密钥",
      "JWK x d 字段",
      "JWKS Ed25519"
    ]
  },
  "gcmForbidden": {
    "what": "GCM nonce 重用攻击（教学演示）——AES-GCM 在**同一 key 下重用 nonce** 时的两段式击穿：①同 nonce ⇒ CTR 计数器流相同，已知一侧明文即可恢复密钥流解另一侧（机密性击穿）；②≥2 条同 nonce 样本可用 Joux 的 forbidden attack 从 tag 差分方程在 GF(2^128) 上**求根恢复认证子 H**，进而恢复掩码 $E_K(J_0)$，对任意新 (aad, ct) **伪造可通过验证的 tag**（认证性击穿）。独立攻击 op，不改 AEAD 原语。",
    "principle": "**GCM 认证结构（SP 800-38D §7.1）**：$T = \\mathrm{GHASH}_H(A, C) \\oplus E_K(J_0)$，其中 $H = E_K(0^{128})$，$J_0$ 由 nonce 决定。GHASH 是 $H$ 的多项式：块序列 $B_1..B_n$（A 块‖C 块‖长度块）给出 $S(H) = \\sum_j B_j H^{n-j+1}$。\n\n**forbidden attack（Joux 2006）**：同 nonce 两条消息 ⇒ 掩码相同，$T_1 \\oplus T_2 = S_1(H) \\oplus S_2(H) = q(H)$——$q$ 是已知系数的多项式，$H$ 是它在 $\\mathrm{GF}(2^{128})$ 上的根。求根：与 $x^{2^{128}} \\oplus x$ 取 gcd 取出全部线性因子，再用痕迹映射 $\\mathrm{Tr}(\\alpha x) = \\sum_{i=0}^{127} (\\alpha x)^{2^i}$ 递归拆分（本实现的 $\\alpha$ 由样本指纹确定性派生，不消耗随机源）。每个候选 $H$ 用「全样本掩码一致性」过滤（$S_i(H) \\oplus T_i$ 必须全等，≥3 条样本几乎必唯一）。\n\n**伪造**：恢复 $H$ 后掩码 $= S_i(H) \\oplus T_i$（同 nonce ⇒ 同 $E_K(J_0)$），对任意 $(A', C')$ 计算 $T' = \\mathrm{GHASH}_H(A', C') \\oplus \\mathrm{mask}$——可通过任何标准 GCM 验证。换 nonce 或换 key 立即失效。",
    "usage": "输入（H 恢复档）：每行一条 `aadHex|ctHex|tagHex`（竖线分隔，aad 可空），至少 2 条、推荐 ≥3 条**同一 key+nonce** 的样本；参数里可给伪造目标 aad/ct。\n输入（密钥流档）：同样本 + 已知明文 hex（对应第 1 条的 ct）。\n\n输出：候选 H 与掩码（密钥流档则给密钥流与另一侧明文）；伪造 tag；失败边界全部显式报错（不同 nonce/单样本/方程退化）。\n\n适用：CTF 里题目复用 nonce 的 GCM 流量、nonce 计数器实现错误的协议流量还原。**防御 = 同一 key 下 nonce 永不重用**；这是协议误用演示，不是对 AES 的攻击。",
    "examples": [
      {
        "in": "（node:crypto AES-256-GCM 同 nonce 三条样本，密文 16/40/64 字节）",
        "out": "候选 H1 = 75e6f7e8…a3dd（== E_K(0^128) 真值）；掩码 E_K(J0) = …；通过全样本一致性 = 1",
        "desc": "恢复的 H 与 AES-ECB 加密全零块的真值逐字节一致"
      },
      {
        "in": "同上样本 + 伪造目标 ct（50 字节随机，空 aad）",
        "out": "伪造 tag（候选 H1）= …——把该 tag 塞回 node:crypto 的 AES-GCM 解密端（同 key/nonce/aad/ct），验证通过且明文完整还原",
        "desc": "伪造 tag 通过权威实现验证（认证击穿实证）"
      },
      {
        "in": "两条样本换了 nonce",
        "out": "显式报错「候选根无一通过全样本掩码一致性校验——样本疑似不同 nonce/key」",
        "desc": "nonce 重用前提不成立时拒绝，不硬凑"
      }
    ],
    "formulas": [
      {
        "tex": "T_i = \\sum_{j} B_{i,j} H^{n_i-j+1} \\oplus E_K(J_0)",
        "caption": "GCM tag 的多项式结构（SP 800-38D §7.1）"
      },
      {
        "tex": "q(H) = T_1 \\oplus T_2 = S_1(H) \\oplus S_2(H)",
        "caption": "同 nonce 差分方程：H 是 q 在 GF(2^128) 上的根（Joux 2006）"
      },
      {
        "tex": "\\mathrm{Tr}(z) = z \\oplus z^{2} \\oplus \\cdots \\oplus z^{2^{127}}",
        "caption": "痕迹映射拆分：gcd(Tr(αx), f) 以 1/2 概率切开等度因子"
      }
    ],
    "tips": [
      "认题：流量里同一 key 出现重复 nonce 的 GCM 记录 / 题目明说「nonce 复用」/ 需要伪造一条可通过验证的 GCM 记录 → 本 op。",
      "样本要求：同一 key+nonce 的 2 条起步，3 条以上能自动排除伪根；aad/ciphertext 长度影响多项式次数（块数+1），次数过大（>256 块）会被拒绝。",
      "与「AEAD nonce 重用」op 的分工：那个做 ChaCha20-Poly1305 的密钥流恢复（Poly1305 一次性密钥同 nonce 复用），本 op 做 GCM 的 H 恢复与伪造——两族 AEAD 两张卡。",
      "密钥流档只解「前缀」（已知明文多长就恢复多长）；要完整解另一侧需要足够长的已知明文。",
      "伪造只在同 nonce 下有效：掩码绑 $E_K(J_0)$，J0 由 nonce 决定——换 nonce 必须重新收集样本。",
      "GF(2^128) 的反射位序坑：乘法恒元是块 0x80…00 而非 0x01——本实现已按 SP 800-38D 口径处理并与 node:crypto 对拍。",
      "标准来源：NIST SP 800-38D §6.4/§7.1；A. Joux, \"Authentication Failures in NIST Version of GCM\"（2006）。"
    ],
    "aka": [
      "GCM nonce 重用",
      "GCM forbidden attack",
      "forbidden attack",
      "Joux attack",
      "GCM 认证击穿",
      "GHASH H 恢复",
      "GCM H recovery",
      "GCM tag 伪造",
      "GCM forgery",
      "nonce reuse attack",
      "AES-GCM nonce reuse",
      "GCM 密钥流复用",
      "GCM keystream reuse",
      "SP 800-38D 攻击",
      "认证加密误用",
      "GCM 伪造攻击",
      "GHASH 多项式求根",
      "禁止攻击 GCM"
    ]
  },
  "ntruCca2Encrypt": {
    "what": "NTRU CCA-2 变体加密（hash-based SVES，教学演示）——在 EESS1/NTRUEncrypt 的 SVES 字节映射之上加「哈希绑定」：随机 b 字段与盲化多项式 r 都由**明文的 MGF1-SHA256 派生**，加密全确定；解密端重算 MGF 与恢复的 b 比对，不一致即拒绝——这是重加密校验式 CCA-2 加固的思想。底层 PKE/SVES 与「NTRU 密钥生成/加密/解密」同源。",
    "principle": "**与普通 NTRU 加密的差异**：普通 SVES 里 b 是随机字节，解密端无法验证——密文被翻改后解密方拿到的是另一个「合法」明文（CCA-1 式）。本变体把 b 换成 $\\mathrm{MGF1\\text{-}SHA256}(\\text{参数集} \\| \\text{明文})$，r 由 $(b \\| \\text{明文})$ 哈希确定性采样，于是：\n① 加密全确定（同 (公钥, 明文) 必得同密文）——可复现、可校验；\n② 解密端恢复 M 后重算 $\\mathrm{MGF1}(\\text{明文})$ 与恢复的 b 比对——攻击者改密文 ⇒ 解出的明文变了 ⇒ b 校验失败 ⇒ 拒绝（选择密文安全的核心机制）。\n\n**底层不变（EESS1 v3.1 / P1363.1 §9.2.2/9.2.3）**：M = b‖octL‖msg‖0 → SVES 3bit→2 系数映射 → m ∈ {−1,0,1}^N；e = r∗h + m mod q（负循环卷积，q=2048）。解密 = f∗e 中心化 → mod 3 → SVES 逆映射（拒绝非法系数对）。",
    "usage": "输入：明文（UTF-8）+ 公钥 hex（来自「NTRU 密钥生成」的公钥）。参数集由公钥标签字节自动识别（ees401ep1/ees401ep2/ees439ep1/ees659ep1）。\n\n输出：密文 hex（含 1 字节参数集标签），可下载。明文长度上限由参数集决定（如 ees401ep1 为 51 字节）。\n\n适用：教学演示 CCA-2 加固思想、与普通 NTRU 加密对比实验。**诚实边界**：无官方 KAT 的教学实现，生产请用 ML-KEM 等标准 KEM；确定性加密会泄露「两次发送的明文是否相同」这一等价类信息（演示口径已明示）。",
    "examples": [
      {
        "in": "（ees401ep1 公钥 + 明文 \"NTRU CCA-2 roundtrip 测试!\"）",
        "out": "密文 553 字节（含 1 字节标签）= 01c8c9…；同明文再次加密密文逐字节相同（确定性）",
        "desc": "实跑：确定性 + 往返还原"
      },
      {
        "in": "同一密文翻转中部 1 bit 后解密",
        "out": "显式报错「CCA-2 校验失败：恢复的 b 与 MGF(明文) 不一致（密文被篡改或非本方案密文）」",
        "desc": "篡改被哈希绑定拒绝（普通 NTRU 加密做不到）"
      },
      {
        "in": "超长明文（超过参数集上限）",
        "out": "显式报错并给出该参数集的字节上限",
        "desc": "长度边界如实拒绝"
      }
    ],
    "formulas": [
      {
        "tex": "b = \\mathrm{MGF1\\text{-}SHA256}(\\text{name} \\| \\mathrm{msg})_{[0..d_b/8)}",
        "caption": "b 字段哈希派生（加密确定性的来源）"
      },
      {
        "tex": "e = r \\ast h + m \\bmod q,\\quad r = \\mathrm{sample}(H(b \\| \\mathrm{msg}))",
        "caption": "盲化多项式确定性采样（EESS1 口径的 T_N 采样）"
      },
      {
        "tex": "b \\stackrel{?}{=} \\mathrm{MGF1}(\\mathrm{msg})",
        "caption": "解密端校验：不一致即拒绝（CCA-2 重加密校验思想）"
      }
    ],
    "tips": [
      "认题：题目给 NTRU 公私钥并要求「防篡改的 NTRU 加密」/ 讲 CCA-2 加固对比 → 本变体；普通 NTRU 题走原 NTRU 加解密。",
      "确定性加密的副作用：同一明文两次加密密文相同——CTF 里可用来做「密文等价类」分析，也是它被标注教学口径的原因之一。",
      "密文第一个字节是参数集标签（01..04），解密端据此选 N/q——手改标签会被拒绝。",
      "明文上限 = mLen − db/8 − 2（如 ees401ep1 51 字节）；长数据先分片或对称压缩。",
      "与普通 NTRU 加密的密文互相兼容解密（底层 PKE 相同），但只有本变体的解密做 b 校验。",
      "标准来源：EESS1 v3.1（SVES 编码）、IEEE P1363.1 §9.2.2/9.2.3（系数映射）、PKCS#1 v2.2 附录 B.2.1（MGF1）；hash-based 变体为教学口径自实现。"
    ],
    "aka": [
      "NTRU CCA-2 加密",
      "NTRU CCA2",
      "hash-based SVES",
      "NTRU 认证加密",
      "NTRUEncrypt CCA-2",
      "NTRU 重加密校验",
      "SVES hash 变体",
      "NTRU NAEP",
      "EESS1 SVES",
      "NTRU 防篡改加密",
      "NTRU 确定性加密",
      "ees401ep1 加密",
      "ees439ep1",
      "NTRU 教学加密",
      "post-quantum CCA-2"
    ]
  },
  "ntruCca2Decrypt": {
    "what": "NTRU CCA-2 变体解密——与「NTRU CCA-2 加密」配对：EESS1 解密数学（f∗e 中心化 → mod 3 → SVES 逆映射）还原 M 后，**重算 MGF1-SHA256(明文) 与恢复的 b 比对**，不一致即拒绝并明说「密文被篡改」；另有 octL 长度校验与零填充校验双保险。教学演示口径（无官方 KAT）。",
    "principle": "**解密三道闸**（按顺序，任一失败即显式报错）：\n① SVES 逆映射：m ∈ {0,1,2}^N → M 字节流，出现非法系数对 (2,2) 直接拒绝（密文被改的强信号）；\n② octL 与零填充：长度字段 ≤ 上限、尾部全 0——普通 SVES 就有的结构校验；\n③ **b 绑定校验（本变体核心）**：恢复的明文重算 $\\mathrm{MGF1\\text{-}SHA256}$，与 M 首部 $d_b/8$ 字节的 b 比对——攻击者改密文 ⇒ 明文变 ⇒ b 对不上 ⇒ 拒绝。\n\n**为什么这构成 CCA-2 防护（思想层面）**：解密预言机对篡改密文只回答「拒绝」，不泄露任何明文差分信息；加密确定性 + 全等校验使「构造合法变换密文」等价于知道明文本身。",
    "usage": "输入：私钥 hex（「NTRU 密钥生成」产物）+ 密文 hex（「NTRU CCA-2 加密」产物，含参数集标签）。\n\n输出：CCA-2 校验结果行 + 明文 hex + UTF-8 解释。失败时明确区分：SVES 解码失败 / 长度非法 / 零填充失败 / CCA-2 校验失败四类文案。\n\n适用：与加密档构成往返闭环；做「篡改检测」演示（对比普通 NTRU 解密对篡改密文会静默给出错误明文）。**诚实边界**：教学口径，生产请用标准 KEM。",
    "examples": [
      {
        "in": "（ees401ep1 私钥 + 合法 CCA-2 密文）",
        "out": "CCA-2 校验：✓ 通过（b == MGF1-SHA256(明文)，密文未被篡改）；明文 28 字节 = 4e545255…9521；按 UTF-8 解释：NTRU CCA-2 roundtrip 测试!",
        "desc": "实跑：往返 + 校验通过"
      },
      {
        "in": "同一密文翻转中部 1 bit",
        "out": "显式报错（SVES 解码失败或 CCA-2 校验失败，按篡改位置而定）",
        "desc": "篡改在解密端被拦截，不输出错误明文"
      },
      {
        "in": "参数集标签不匹配的密文（私钥 ees401ep1、密文标签 03）",
        "out": "显式报错「密文参数集标签（03）与私钥（01）不匹配」",
        "desc": "标签即参数集指纹，防错配"
      }
    ],
    "formulas": [
      {
        "tex": "a = f \\ast e \\bmod q \\to \\mathrm{center}(a) \\to \\bmod 3 \\to M",
        "caption": "EESS1 解密链（与 ntruReal 同源，负循环卷积）"
      },
      {
        "tex": "\\mathrm{MGF1}(\\mathrm{msg}) \\stackrel{?}{=} b_{\\mathrm{rec}}",
        "caption": "第三道闸：b 绑定校验（本变体核心）"
      },
      {
        "tex": "(c_1, c_2) = (2, 2) \\Rightarrow \\mathrm{reject}",
        "caption": "SVES 逆映射的非法系数对拒绝（P1363.1 §9.2.3）"
      }
    ],
    "tips": [
      "四类失败文案对应四种损坏：SVES 解码失败（强篡改）、长度非法、零填充失败（弱篡改/裁剪）、CCA-2 校验失败（改明文区）——排查时先看报错类别。",
      "与普通 NTRU 解密的对照实验：同一翻改密文，普通解密给出错误明文不报错，本变体拒绝——这就是 CCA-2 校验的价值演示。",
      "私钥与密文的参数集标签必须一致（首字节），标签即 ees401ep1..ees659ep1 的序号。",
      "解密结果同时给 hex 与 UTF-8 两种形态（非 UTF-8 时如实标注），方便对着题目 flag。",
      "标准来源：EESS1 v3.1、IEEE P1363.1 §9.2.3、PKCS#1 v2.2 附录 B.2.1（MGF1）；变体为教学口径自实现。"
    ],
    "aka": [
      "NTRU CCA-2 解密",
      "NTRU CCA2 解密",
      "SVES 解密校验",
      "NTRU 篡改检测",
      "NTRUEncrypt CCA-2 decrypt",
      "NTRU 认证解密",
      "hash-based SVES 解密",
      "NTRU 重加密校验",
      "ees401ep1 解密",
      "NTRU 解密校验",
      "post-quantum 解密演示",
      "NTRU 教学解密",
      "NTRU 密文校验",
      "SVES 逆映射",
      "NTRU CCA2 检查"
    ]
  },
  "xoodyakHash": {
    "what": "Xoodyak-Hash——NIST 轻量级密码竞赛（LWC）决赛方案 Xoodyak 的哈希模式：底层是 384 位状态的 Xoodoo 置换（12 轮，θ/ρwest/ι/χ/ρeast 五步，与 Keccak-p 同设计思想的轻量化小姊妹），外层是 Cyclist 单色域海绵，吸收块 16 字节，输出固定 32 字节摘要。面向资源受限设备（IoT/嵌入式），也出现在轻量密码方向的 CTF 题里。",
    "principle": "**两层结构**：\n\n① **Xoodoo[12] 置换**：状态 3 个平面 × 4 列 × 32 位 lane = 384 位。每轮五步——\nθ（列奇偶混合：$P = A_0 + A_1 + A_2$，$E = P \\ll(1,5) + P \\ll(1,14)$）→ ρwest（平面移位）→ ι（轮常数，规范 Table 2 共 12 个，$c_{-11}$=0x058 … $c_0$=0x012）→ χ（非线性层 $A_y \\mathrel{+}= \\lnot A_{y+1}\\cdot A_{y+2}$）→ ρeast。lane 与字节按小端映射（$i = z + 32(x + 4y)$）。\n② **Cyclist 海绵模式**：hash 模式是单色域——Absorb 每块后打帧位 0x01、首块色字节（&0x01），Squeeze 时色被忽略；吸收块 Rhash=16 字节，挤出块同 16 字节，先 Up 取 16 字节再 Down(空) 续 Up 取满 32 字节。\n\n**与 SHA-3 的关系**：同为 Keccak 团队（Daemen/Van Assche 等）的海绵结构设计，但置换不同（Xoodoo 384 位 vs Keccak-f 1600 位）、帧规则不同（Cyclist 帧位+色 vs Keccak pad），结果互不通用；也不是 SHA-3 的轻量档。\n\n**安全定位**：128 位安全强度（NIST LWC 决赛口径）；规范同文给出 hash 模式的伪造/碰撞界。",
    "usage": "输入任意文本（或 hex 字节通道），输出 64 个 hex 字符（32 字节）摘要。\n\n适用场景：题目明说 Xoodyak/Xoodoo/LWC 或给出轻量密码上下文；拿到 64 hex 摘要且 SHA-256/SHA3-256 都对不上时试它。\n\n注意：单向哈希不可逆；输出只有固定 32 字节档（规范定义），没有可调长度。",
    "examples": [
      {
        "in": "（空输入）",
        "out": "ea152f2b47bce24efb66c479d4adf17bd324d806e85ff75ee369ee50dc8f8bd1",
        "desc": "NIST 官方 KAT 第 1 条逐字（官方提交包 LWC_HASH_KAT_256.txt）"
      },
      {
        "in": "hex 0001",
        "out": "dd3f12e89db41c61d3c05779705fa946a8c69c79eefdc1b4a966a5f1ab35073d",
        "desc": "NIST 官方 KAT 第 3 条逐字"
      },
      {
        "in": "abc",
        "out": "661f71b331a0c1214441c4b4a811697e9109bc0b3c4e1e647c4d1127b18e2a1e",
        "desc": "本工具实跑值（实现已过 1025 条官方 KAT 全量对拍）"
      }
    ],
    "formulas": [
      {
        "tex": "\\mathrm{Xoodyak\\text{-}Hash}(M) = \\mathrm{SqueezeAny}(32,\\,\\texttt{40}) \\circ \\mathrm{AbsorbAny}(M, 16, \\texttt{03})",
        "caption": "Cyclist hash 模式主式（规范 Algorithm 2；单色域，Up 不加色）"
      },
      {
        "tex": "P = A_0 + A_1 + A_2,\\quad E = P \\ll (1,5) + P \\ll (1,14),\\quad A_y \\mathrel{+}= E",
        "caption": "Xoodoo θ 步（列奇偶混合，规范 Algorithm 1）"
      }
    ],
    "tips": [
      "认题：题目出现「Xoodyak」「Xoodoo」「NIST LWC」「lightweight cryptography finalist」或 IoT/嵌入式轻量密码语境时想到它；与 Ascon 同为 NIST LWC 决赛方案但完全不同算法，别混用一个「LWC」入口。",
      "输出 64 hex（32 字节）与 SHA-256/SHA3-256 同长——三个都试，按题目语境选。",
      "轮常数极易抄错：规范 Table 2 的 12 个常数（0x058/0x038/0x3C0/0x0D0/0x120/0x014/0x060/0x02C/0x380/0x0F0/0x1A0/0x012）必须逐词对照原文，首个 0x058 抄成 0x059 类错误官方 KAT 当场就能抓出。",
      "θ 步的 $P \\ll (1,5)$ 是「列移 1 + lane 循环左移 5」复合移位，实现时按 lane 读入 $p_{x-1}$ 别只做 lane 旋转。",
      "自实现校验捷径：先对空输入（KAT 第 1 条 ea152f2b…）和 hex 000102 这类短输入对拍，能最快定位 Xoodoo 或 Cyclist 帧规则哪一层错了。",
      "标准来源：NIST LWC 决赛规范（csrc.nist.gov 决赛轮 updated-spec-doc，keccak.team/xoodyak.html 同链）Algorithm 1/Table 2/Algorithm 2 + 官方 C 参考（NIST 决赛提交包，CC0）；本工具实现与官方 genKAT 全量逐字节对拍。"
    ],
    "aka": [
      "Xoodyak-Hash",
      "xoodyakHash",
      "Xoodyak 哈希",
      "Xoodyak hash",
      "Xoodyak 摘要",
      "Xoodoo hash",
      "Xoodoo 海绵哈希",
      "NIST LWC 哈希",
      "轻量级密码哈希",
      "轻量密码竞赛 Xoodyak",
      "Cyclist hash",
      "Xoodyak digest",
      "Xoodyak sponge hash",
      "32 字节轻量哈希",
      "IoT 哈希算法",
      "Xoodyak 256 位哈希"
    ]
  },
  "xoodyakAead": {
    "what": "Xoodyak-AEAD——NIST 轻量级密码竞赛决赛方案 Xoodyak 的认证加密：Cyclist 双色域模式，key 16 字节、nonce 16 字节、关联数据可空、tag 固定 16 字节。加密时明文块被吸入状态（双向同规则），tag 同时认证 key/nonce/ad/密文；nonce 重复使用会泄露最多 24 字节明文等效信息（规范明文承认的界限）。",
    "principle": "**Cyclist keyed 模式（规范 Algorithm 2/3）**：\n\n① **初始化 AbsorbKey**：吸收 $K \\| \\mathrm{id} \\| \\mathrm{enc8}(\\|\\mathrm{id}\\|)$（AEAD 里 id 即 nonce，共 16+16+1=33 字节 < Rkin−1=43），首块色 '02'；此后吸收块长 Rkin=44 字节。\n② **Absorb(ad)**：关联数据按 44 字节分块吸收，首块色 '03'、其余 '00'。\n③ **Crypt**：明文按 Rkout=24 字节分块——每块先 Up（首块色 '80'）产生密钥流，$O_i = I_i \\oplus Y_i$，再 Down 吸收**明文块**（加密解密两方向同规则，这是它与传统「吸密文」流密码的关键差异）。\n④ **Squeeze tag**：Up(16, '40') 取 16 字节 tag。\n\n**双色域**：keyed 模式下 Up 前把色字节异或进状态最后一字节（偏移 47），Down 的帧位 0x01 紧跟数据块尾——帧位+色字节共同分隔「键/AAD/明文/挤出」四种语义，这是 Xoodyak 抵抗域混淆的结构来源。\n\n**安全定位**：128 位安全强度；认证不依赖 nonce（nonce 误用只泄露等效明文，不还原 key）。",
    "usage": "参数：key 16 字节 hex、nonce 16 字节 hex（必填，一次性使用，本工具不代生成随机数）、aad（文本或 hex，可空）。\n加密方向：明文（UTF-8 文本或 hex 字节）→ 输出 hex（密文‖16 字节 tag，未加分隔）。\n解密方向：粘贴同格式 hex，key/nonce/aad 必须与加密时一致，tag 不符立即报错（不输出未验证明文）。\n\n适用场景：题目给出 Xoodyak/LWC 上下文的密文流；四元组 (key, nonce, ad, tag) 校验；轻量密码教学演示。",
    "examples": [
      {
        "in": "key=000102030405060708090a0b0c0d0e0f，nonce=101112131415161718191a1b1c1d1e1f，明文 hex 空，aad hex 00",
        "out": "25966dd6af69a7aa336d13dd35e9dc64",
        "desc": "NIST 官方 KAT 第 2 条逐字（空明文 + 1 字节 aad，输出即 16 字节 tag）"
      },
      {
        "in": "明文 flag{x00dy4k_cycl1st}，aad 文本 ctf ad，key 000102…0f，nonce 101112…1f",
        "out": "726559678e99fcaa1f82b0148dea4a70ea6e3db96c62acbabb47d453d23542cc4e080ed47a",
        "desc": "本工具实跑值（密文 21 字节 + tag 16 字节；实现已过 1089 条官方 KAT 加解密双方向）"
      },
      {
        "in": "同上密文，篡改 tag 任意 1 位",
        "out": "报错：认证失败",
        "desc": "tag 覆盖 key/nonce/aad/密文，改任一处立即拒绝"
      }
    ],
    "formulas": [
      {
        "tex": "O_i = I_i \\oplus \\mathrm{Up}(|I_i|,\\, \\texttt{80}\\text{ if first else }\\texttt{00}),\\quad \\mathrm{Down}(P_i, \\texttt{00})",
        "caption": "Cyclist Crypt：密钥流异或后吸收明文块（双向同规则，规范 Algorithm 3）"
      },
      {
        "tex": "\\mathrm{AbsorbKey}\\colon \\mathrm{AbsorbAny}(K\\|\\mathrm{id}\\|\\mathrm{enc8}(\\|\\mathrm{id}\\|),\\ R_{kin},\\ \\texttt{02})",
        "caption": "键块：key‖nonce‖长度字节一次吸收，色 '02'（规范 Algorithm 3）"
      }
    ],
    "tips": [
      "认题：题目出现「Xoodyak」「Cyclist」「Xoodoo」「NIST LWC AEAD」或轻量密码/IoT 语境；与 Ascon-AEAD 同为决赛方案但算法、块长、tag 语义完全不同，别混。",
      "块长三兄弟（Rkin=44 吸收 / Rkout=24 加密 / tag 16）是 Xoodyak 的指纹：自实现对拍时先跑空明文+空 aad（输出就是 16 字节 tag，官方 KAT 第 1 条 4968dc9c…），再跑 45 字节 aad 跨块样例。",
      "nonce 16 字节（128 位）比 AES-GCM 的 12 字节长；题目如果给 12 字节 nonce 说明不是 Xoodyak。",
      "nonce 必须一次性使用：同 key+nonce 重复加密会复用密钥流（最长 24 字节块级泄露，规范 §1 明文承认）；本工具不自动生成随机 nonce，就是为了把一次性责任留给使用者。",
      "解密端先恢复明文再验 tag：拿到「解密结果」不等于认证通过——本工具在 tag 不符时报错不输出，符合 AEAD 语义；自己写脚本时注意别把未验证明文当真。",
      "标准来源：NIST LWC 决赛规范（csrc.nist.gov 决赛轮 updated-spec-doc）Definition 2/Algorithm 2/3 + 官方 C 参考 encrypt.c/hash.c（NIST 决赛提交包，CC0）；本工具实现与官方 genKAT（AEAD 1089 条 + Hash 1025 条）加解密全量逐字节对拍。"
    ],
    "aka": [
      "Xoodyak-AEAD",
      "xoodyakAead",
      "Xoodyak AE",
      "Xoodyak 加密",
      "Xoodyak 解密",
      "Xoodyak 认证加密",
      "Xoodyak authenticated encryption",
      "Cyclist AEAD",
      "Xoodoo AEAD",
      "NIST LWC AEAD",
      "轻量级认证加密",
      "轻量密码竞赛 AEAD",
      "Xoodyak-AE",
      "IoT 认证加密",
      "Xoodyak tag",
      "Xoodyak crypto",
      "Cyclist mode"
    ]
  },
  "eccSubgroupAttack": {
    "what": "ECDH 点校验缺失攻击演示（教学闭环）——两类经典「未校验对端点」击穿：①**X25519 小子群攻击**（RFC 7748 §6.8.1 场景）：把小阶点的 u 坐标喂给不做点校验的 X25519，共享密钥只落在少数几个值上，从预言机输出反推私钥的余因子信息（未 clamp 的裸实现最多泄 2 bit）；clamping + 全零检查即防御。②**无效曲线攻击**（Biehl–Durmus–Lucks 2000）：Weierstrass 点加公式只依赖 a 不依赖 b，受害者把攻击者给的「非本曲线上的点」当合法点做标量乘，攻击者选光滑阶的无效曲线 y²=x³+ax+b′ 收集 d mod ℓ，CRT 合成私钥。模拟预言机本地闭环，教学演示非远程攻击工具。",
    "principle": "**X25519 侧（真参数 p=2^255−19, A=486662）**：曲线 + 扭曲上共有 5 个低阶 u 值（阶 2 的 u=0、阶 4 的 u=1、两条阶 8 与一条扭曲阶 4）。本实现**不信任任何转抄常数**：候选池 11 个 u 逐个跑「倍点链定阶」（2P/4P 落 (0,0) 判阶 4/8）+ 二次特征判边（u³+Au²+u 是否二次剩余分曲线/扭曲），不通过的转抄值自动淘汰（11 选 5，6 个假候选被当场剔除）。x-only 泄露量的数学事实：阶 4 点的 2P=(0,0) 与 4P=∞ 在 x-only 下同输出 0、1P/3P 同 u——单点只给 d mod 2；阶 8 点给 3 类输出，恰定 d mod 4（偶标量）或 d ≡ ±r (mod 8)（奇标量）。约束用 mod 8 候选集相交合成，真值落在候选集内即实证。\n\n**无效曲线侧（玩具曲线 y²=x³+2x+2 mod 1000003 全流程）**：确定性枚举 b′=1,2,… 找非奇异且群阶光滑的无效曲线 → BSGS 求群阶 → 取小素数阶点查询预言机 → 恢复 d mod ℓ → CRT 合成。素数覆盖乘积 ≥ p 时私钥**完整恢复**（默认示例 5·47·227·7·19 = 7094885 ≥ 1000003，CRT 值与真值逐位一致）。\n\n**防御（两档同一结论）**：①接收任何对端点先做 on-curve/子群校验；②X25519 的 clamping（RFC 7748 §5 内建，低 3 位清零使标量恒为 8 的倍数）+ §6.8.1 共享密钥全零检查（检测到必须中止）。实测：clamp 后所有低阶点查询输出恒全零。",
    "usage": "参数选攻击档：①「X25519 小子群（真参数）」：私钥留空用内置示例（d mod 8 = 3，查询输出非零、判词可辨），或填 64 hex（32 字节）私钥；输出含低阶点清单（含被淘汰的假候选数）、逐点约束、mod 8 候选集、泄露 bit 数、真值校验、clamp 防御对照。②「无效曲线（玩具曲线全流程）」：私钥填十进制整数（< 1000003，留空用内置 123456）；输出含逐条曲线的群阶/余项、CRT 合成与完整恢复判定。\n\n适用：CTF 里「自定义 ECDH 没做点校验」「椭圆曲线标量乘可注入任意点」类题的原理理解与复现。**诚实边界**：X 档泄露上限 2 bit（x-only 抹去 ±y，d mod 8 不可分时如实呈现 ±r 约束）；无效曲线档为玩具曲线口径，真实曲线（P-256 级）的群阶分解超出演示范围。",
    "examples": [
      {
        "in": "（X 档默认私钥 a3b1c2…ff）",
        "out": "候选池 11 选 5：阶 2（曲线）u=0；阶 4（曲线）u=1；阶 8（曲线）u=3256062509…、3938235723…；阶 4（扭曲）u=5789604461…。预言机查询：d·(阶 8 曲线点 u=325606250916…) = 57119fd0… ⇒ d mod 8 ∈ {3,5}…… mod 8 候选取值 {3,5}（泄露 2.00 bit）；真值校验：d mod 8 = 3 ∈ 候选集 ⇒ ✓ 一致；clamp 后全部全零 ✓",
        "desc": "实跑：低阶点运行时定阶+判边、余因子泄露实证、clamping 防御对照"
      },
      {
        "in": "（无效曲线档默认私钥 123456）",
        "out": "b′=2：|E′| = 998280，取阶 5 点 ⇒ d mod 5 = 1；b′=2：取阶 47 点 ⇒ d mod 47 = 34；b′=3：取阶 227 点 ⇒ d mod 227 = 195；b′=10：取阶 7 点 ⇒ d mod 7 = 4；b′=14：取阶 19 点 ⇒ d mod 19 = 13。CRT 合成：d ≡ 123456 (mod 7094885)；mod ≥ p ⇒ 私钥**完整恢复**（CRT 值 = 123456，真值 = 123456：一致）",
        "desc": "实跑：光滑阶无效曲线搜索 + 小素数阶点查询 + CRT 完整恢复"
      },
      {
        "in": "（无效曲线档私钥填 0 或 -5）",
        "out": "显式报错「私钥为 0（无意义）」/「玩具曲线私钥须为十进制整数」",
        "desc": "异常面显式拒绝，不硬凑"
      }
    ],
    "formulas": [
      {
        "tex": "2P = \\left(\\frac{(u^2-1)^2}{4(u^3+Au^2+u)},\\,\\cdot\\right)",
        "caption": "x-only Montgomery 倍点：低阶点链式定阶的基石（2P 落 (0,0) ⇒ P 阶 4）"
      },
      {
        "tex": "\\chi(f(u)) = f(u)^{\\frac{p-1}{2}} \\bmod p \\;\\in\\{1,p-1\\}",
        "caption": "二次特征判边：f(u)=u³+Au²+u 为 QR ⇒ 主曲线，否则扭曲"
      },
      {
        "tex": "d \\bmod \\ell_j \\;\\xrightarrow{\\mathrm{CRT}}\\; d \\pmod{\\prod_j \\ell_j}",
        "caption": "小子群/无效曲线共用骨架：小阶点泄露余项，CRT 合成（Biehl 2000）"
      }
    ],
    "tips": [
      "认题：题目自定义 ECDH 且接受任意 32 字节/任意点做标量乘、或明说「未做点校验/子群校验」→ 本 op 两档对照用。",
      "X 档的 5 个低阶 u 是运行时定阶出来的，别背常数表——网上转抄值错漏多，本实现的候选池里 6 个假值被当场淘汰就是活例。",
      "x-only 的泄露上限要看清：偶标量判 d mod 4，奇标量只能判 d ≡ ±1 或 ±3 (mod 8)——x 坐标抹去 ±y 区分，任何实现都一样，别期待恢复完整 d mod 8。",
      "clamping 是 RFC 7748 的内建防御：低 3 位清零 + bit254 置位 + bit255 清零，标量恒为 8 的倍数，低阶点查询恒全零；全零检查（§6.8.1）是第二道闸。",
      "无效曲线档看机制不看规模：玩具曲线 p=1000003 上 CRT 覆盖 ≥ p 即完整恢复；真实曲线上同样的流程，只是「光滑阶曲线」的搜索与大数分解超出教学范围。",
      "失败边界都是显式报错：X 档私钥长度错、无效曲线档 d=0/非十进制，绝不静默给假结果。",
      "标准来源：RFC 7748 §5/§5.2/§6.1/§6.8.1（权威向量逐条对拍，输出按 LE 字节序比对）；Biehl, Durmus, Lucks, \"Distributing the Elliptic Curve Discrete Logarithm\"（ASIACRYPT 2000）；低阶点文献口径 eprint 2019/526。"
    ],
    "aka": [
      "ECDH 小子群攻击",
      "small subgroup attack",
      "invalid curve attack",
      "无效曲线攻击",
      "X25519 小子群",
      "小子群约束攻击",
      "ECDH 点校验缺失",
      "ECDH point validation",
      "small subgroup confinement",
      "cofactor leak",
      "余因子泄露",
      "clamping 防御",
      "twist attack",
      "扭曲曲线攻击",
      "CRT 恢复 ECDH 私钥",
      "Biehl invalid curve",
      "Montgomery ladder attack",
      "曲线点注入攻击",
      "ECDH oracle",
      "低阶点攻击"
    ]
  }
};
