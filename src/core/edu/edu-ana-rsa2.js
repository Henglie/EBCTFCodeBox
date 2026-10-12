// 科普内容分片：analysis RSA 攻击后半（侧信道 / 泄露 / 格攻击）。纯数据，无 import 无副作用。
export default {
  rsaDpDqLeak: {
    what: "dp/dq 泄露攻击：CRT 加速用的私钥碎片 dp（$= d \\bmod (p-1)$）一旦泄露，不用分解 n 也能直接把 p 挖出来，进而求出完整私钥 d。",
    principle:
      "已知 e、n、dp，其中 $dp \\equiv d \\pmod{p-1}$，即 $e\\cdot dp \\equiv 1 \\pmod{p-1}$。取任意底数 g（如 2），由费马小定理 $g^{(p-1)} \\equiv 1 \\pmod p$，可推出 $\\gcd(g^{\\,e\\cdot dp}-g,\\ n)$ 大概率就是素因子 p。\n\n" +
      "拿到 p 后 $q=n/p$、$\\varphi=(p-1)(q-1)$、$d\\equiv e^{-1}\\pmod{\\varphi}$，整条私钥就还原了。给了 dq 可交叉验证。",
    usage: "填 e、n、dp（可选 dq），工具用底数试出 p、q，再算完整 d。",
    examples: [
      { in: "", param: "e=65537, n=100160063, dp=9353, dq=2177", out: "dp/dq 泄露攻击\n  e  = 65537\n  n  = 100160063\n  dp = 9353\n  dq = 2177\n\n=== 攻击成功 ===\n  p = 10007\n  q = 10009\n  d = 35910881\n  dq 验证: 通过 ✓\n\n原理: dp*e ≡ 1 (mod p-1) → dp*e-1 = k*(p-1), k ∈ [1,e)\n     遍历 k 求 p = (dp*e-1)/k + 1，检查 p | n", desc: "p=10007、q=10009、d=35910881；参数框实跑原文" },
    ],
    formulas: [
      { tex: "p = \\gcd\\big(g^{\\,e\\cdot dp} - g,\\ n\\big)", caption: "g 为任取底数，多数情况得非平凡因子 p" },
    ],
    tips: ["题面出现 dp、dmp1（PEM 里的 CRT 参数）单独给出 → 就是这题。dp 远小于 p，是它能被利用的关键。"],
    aka: ["dp leak", "dq leak", "dp泄露", "crt参数泄露", "dp dq leak", "RSA dp泄露",
      "CRT参数攻击", "dmp1 dmq1", "dp dq攻击", "dp leak attack", "私钥碎片泄露", "CRT指数泄露"],
  },

  rsaLsbOracle: {
    what: "RSA LSB Oracle 攻击：只要有个「服务」肯告诉你解密结果的最低位（奇偶），就能一位一位把整段明文全逼出来，不用私钥。",
    principle:
      "利用 RSA 同态性：给密文 c 乘上 $2^e$ 再送去解密，相当于让明文翻倍 $2m \\bmod n$。因为 n 是奇数，$2m$ 若超过 n 会减一次 n 变成奇数、没超过则是偶数——Oracle 返回的最低位就告诉你 m 落在区间的哪半边。\n\n" +
      "每问一次把 m 的可能区间对半砍，$\\log_2 n$ 次二分（约密文比特数次）后区间收敛到唯一的 m。",
    usage: "填 n、e、密文 c（提供 m 时可本地模拟验证），工具做二分逼近还原明文。",
    examples: [
      { in: "", param: "n=10403, e=5, c=6262, m=4242", out: "LSB Oracle 攻击（模拟模式，已知明文验证）\n  n = 10403\n  e = 5\n  c = 6262\n  对分轮数: 13（响应序列含第 0 轮共 14 位）\n\n步骤   1: oracle(c*(2^e)^1 mod n) → bit=0 | m ∈ [0, 5202)\n步骤   2: oracle(c*(2^e)^2 mod n) → bit=1 | m ∈ [2600, 5202)\n步骤   3: oracle(c*(2^e)^3 mod n) → bit=1 | m ∈ [3901, 5202)\n步骤   4: oracle(c*(2^e)^4 mod n) → bit=0 | m ∈ [3901, 4552)\n步骤   5: oracle(c*(2^e)^5 mod n) → bit=1 | m ∈ [4226, 4552)\n步骤   6: oracle(c*(2^e)^6 mod n) → bit=0 | m ∈ [4226, 4389)\n步骤   7: oracle(c*(2^e)^7 mod n) → bit=0 | m ∈ [4226, 4308)\n步骤   8: oracle(c*(2^e)^8 mod n) → bit=0 | m ∈ [4226, 4267)\n步骤   9: oracle(c*(2^e)^9 mod n) → bit=0 | m ∈ [4226, 4247)\n步骤  10: oracle(c*(2^e)^10 mod n) → bit=1 | m ∈ [4236, 4247)\n步骤  11: oracle(c*(2^e)^11 mod n) → bit=1 | m ∈ [4241, 4247)\n步骤  12: oracle(c*(2^e)^12 mod n) → bit=0 | m ∈ [4241, 4244)\n步骤  13: oracle(c*(2^e)^13 mod n) → bit=0 | m ∈ [4241, 4243)\n\n恢复明文 m = 4242\n实际明文 m = 4242\n匹配: ✓ 成功\n校验: m^e mod n ≡ c ✓\n\n原理: oracle(Dec(c')) 返回明文最低位。c' = c * 2^e mod n → Dec(c') = 2m mod n。\n     若 2m < n → LSB=0, m ∈ [0, n/2)；若 2m ≥ n → LSB=1, m ∈ [n/2, n)。\n     每次乘 2（密文乘 2^e），二分逼近明文区间，log2(n) 轮恢复全部位。", desc: "本地模拟模式，13 轮二分恢复 m=4242；实跑原文" },
    ],
    formulas: [
      { tex: "c' = c\\cdot 2^e \\bmod n \\;\\Rightarrow\\; \\text{dec}(c') = 2m \\bmod n", caption: "乘 2^e 让明文翻倍，末位泄露区间信息" },
    ],
    tips: ["特征：题目给一个能反复查询「解密结果奇偶 / 最低位」的接口 → 二分 Oracle。"],
    aka: ["lsb oracle", "最低位oracle", "rsa奇偶oracle", "parity oracle", "RSA LSB Oracle", "LSB预言机",
      "奇偶预言机", "least significant bit oracle", "RSA最低位攻击", "二分oracle", "位泄露攻击", "RSA parity oracle"],
  },

  rsaBleichenbacher: {
    what: "Bleichenbacher 攻击（PKCS#1 v1.5 padding oracle）：服务只要肯区分「填充格式对不对」，就能像剥洋葱一样一点点解出明文，人称「百万次消息攻击」。",
    principle:
      "PKCS#1 v1.5 加密后明文以 `00 02 …` 开头。若某接口对「填充合法」和「填充非法」反应不同（报错、耗时、状态码），它就成了 padding oracle。攻击者不断把密文乘上不同系数 s 送去，由「填充是否合法」逐步收紧明文所在的区间，最终锁定 m。\n\n" +
      "本工具做识别与参数计算，说明攻击可行的判定条件（是否存在可区分的填充响应）。",
    usage: "填 n、e 及相关响应信息，工具判断是否满足 Bleichenbacher 前提并给出参数提示。",
    examples: [
      { in: "", param: "n=79228162458009874658044684943, e=65537, c=77592157001850136626969509075", out: "Bleichenbacher PKCS#1 v1.5 Padding Oracle 攻击\n  n = 79228162458009874658044684943 (12 字节)\n  e = 65537\n  c = 77592157001850136626969509075\n\n本次未提供 serverKey，仅输出参数与攻击前提：\n  PKCS#1 v1.5 格式：0x00 02 <PS≥8字节非零> 0x00 <message>\n  B = 2^(8·(12-2)) = 2^80（padding 下界），初始明文区间 [2B, 3B-1]\n  明文最大长度: 1 字节\n\n完整攻击需在 serverKey 填入 oracle 侧私钥（hex）：\n  · 私钥 d（单个 hex 大数），或\n  · p,q（两个 hex 数，逗号分隔）——自动算 d\n\n填入后本工具即运行标准 Bleichenbacher 区间归约循环（Step 1/2a/2b/2c/3/4）解出 m：\n  s1 从 ceil(n/3B) 起线性扫描找 PKCS 合规 s；随后按论文公式收缩/合并区间；\n  区间收缩为单点即明文。maxS 护栏默认 100 万次查询防卡死，每 5000 次查询输出进度快照。", desc: "未填 serverKey 的实跑原文：前提判定与参数说明；填 p,q 即跑真攻击" },
    ],
    tips: ["现实里 ROBOT 漏洞就是它的复活。识别点：服务对格式错误的密文给出可分辨的反馈。"],
    aka: ["bleichenbacher", "padding oracle", "pkcs1 v1.5 攻击", "robot", "Bleichenbacher", "填充预言机攻击",
      "PKCS1填充攻击", "百万消息攻击", "million message attack", "ROBOT攻击", "PKCS#1 v1.5", "填充oracle"],
  },

  rsaCoppersmith: {
    what: "Coppersmith 小根攻击：当明文/私钥只有一小部分未知（如高位已知、只缺低位几十比特），能用格约化把这一小段未知量直接解出来。",
    principle:
      "核心定理：模 n 的多项式 $f(x)\\equiv 0 \\pmod n$，若存在的根 $x_0$ 足够小（约 $|x_0| < n^{1/\\deg f}$），可用 LLL 格约化在多项式时间内求出。\n\n" +
      "典型场景：明文高位已知补低位（Stereotyped message）、p 高位泄露分解 n、低指数广播带填充。本工具算参数（次数 d、上界 X）并给出 SageMath 的 `small_roots` 用法提示。",
    usage: "填 n、e、已知/未知量的结构，工具给出多项式次数、根的上界估计和 Sage 脚本模板。",
    examples: [
      { in: "", param: "n=1000036000099, e=3, c=571985985655, knownPrefix=AB, unknownBytes=1", out: "Coppersmith 小根攻击 · stereotyped message（Howgrave-Graham 构格 + BigInt LLL）\n  n = 1000036000099 (40 bits)\n  e = 3（多项式次数 δ = 3）\n  c = 571985985655\n  未知字节: 1 → 根上界 X = 2^8\n  beta = 1（根所在因子下界 b ≥ n^beta；beta=1 即模 n）\n  理论界: X < n^(beta²/δ) = 2^13\n  f(x) = (4276736 + x)^3 − c  (mod n)，m = 前缀·256^1 + x\n\n● 尝试格序列（Howgrave-Graham 条件过筛）: m=2,t=2,w=8\n\n=== 攻击成功 ===\n小根 x = 42 (0x2a)\n完整明文 m = 4276778\nhex = 0x000041422a\nUTF-8 尝试: \u0000\u0000AB*\n校验: m^e mod n ≡ c ✓\n格: 8×8，LLL 归约后第 1 行（含）内命中", desc: "前缀 AB + 1 未知字节，LLL 实跑恢复 x=42 → m=4276778" },
    ],
    formulas: [
      { tex: "|x_0| < n^{1/\\deg f}", caption: "小根可解的粗略上界，deg f 为多项式次数" },
    ],
    tips: ["特征：e 小 + 明文大部分已知只缺一小段，或 p 的高位被泄露。真正求解交给 SageMath。"],
    aka: ["coppersmith", "小根攻击", "格攻击", "stereotyped message", "Coppersmith", "科波史密斯攻击",
      "LLL格约化", "small roots", "已知高位攻击", "coppersmith method", "格基约化攻击", "低指数明文攻击"],
  },

  rsaBonehDurfee: {
    what: "Boneh-Durfee 攻击：Wiener 攻击的加强版，把「小私钥可破」的门槛从 $d < N^{0.25}$ 推高到 $d < N^{0.292}$，更多小 d 的题都能拿下。",
    principle:
      "当私钥 $d < N^{0.292}$ 时，可把求 d 的问题化成一个二元模方程 $f(x,y)\\equiv 0$，用 Coppersmith 式的格约化（LLL）求小根解出 d，不必分解 n。\n\n" +
      "本工具检查 d 是否落在可攻击的门槛内，并说明格构造方法；实际求解需 SageMath 跑格约化脚本。",
    usage: "填 e、n（若已知 d 位数上界），工具判断是否满足 $d < N^{0.292}$ 并给出方法说明。",
    examples: [
      { in: "", param: "n=100160063, e=60084029", out: "Boneh-Durfee 攻击提示\n  n = 100160063 (27 bits)\n  e = 60084029\n\n攻击条件：\n  Boneh-Durfee: d < N^0.292\n    阈值: d < 2^7（约 1 字节）\n    若 d 小于此阈值 → 可用格方法恢复 d\n\n  对比 Wiener 攻击（rsatool.js 已实现）：\n    Wiener 条件: d < N^0.25 = 2^6\n    Boneh-Durfee 比 Wiener 覆盖范围更大（0.292 > 0.25）\n\n方法概述：\n  1. ed ≡ 1 (mod φ(n)) → ed - 1 = kφ(n) → ed + k*(p+q-1) - kn = 1\n  2. 设 s = -(p+q), 则 e*d + k*(s-1) - k*n = 1（含 d, k, s 三变量）\n  3. 用 Coppersmith 多变量方法求小根 (d, k, s)\n  4. 从 s = -(p+q) 恢复 p+q，结合 n = p*q 分解 n\n\n注意：多变量 Coppersmith（Boneh-Durfee）本工具未实现，此 op 提供条件检查和方法说明。\n      单变量 Coppersmith 已在 rsaCoppersmith 落地（stereotyped message 场景）。\n      实际多变量攻击推荐使用 SageMath + defund/coppersmith 实现。\n      若 d < N^0.25，可直接用 rsatool.js 的 rsaWiener（连分数法）。", desc: "e 巨大接近 n（小 d 信号）的门槛判定实跑原文" },
    ],
    formulas: [
      { tex: "d < N^{0.292}", caption: "Boneh-Durfee 可攻击上界（优于 Wiener 的 0.25）" },
    ],
    tips: ["先试 Wiener（更快），Wiener 打不动但怀疑 d 仍偏小 → 上 Boneh-Durfee。特征仍是 e 巨大接近 n。"],
    aka: ["boneh durfee", "boneh-durfee", "小私钥攻击", "格攻击", "Boneh-Durfee", "博内-杜菲攻击",
      "小解密指数攻击", "Wiener加强版", "low private exponent", "d<N^0.292", "小d攻击", "格约化小私钥"],
  },
};
