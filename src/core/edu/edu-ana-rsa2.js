// 科普内容分片：analysis RSA 攻击后半（侧信道 / 泄露 / 格攻击）。纯数据，无 import 无副作用。
export default {
  rsaDpDqLeak: {
    what: "dp/dq 泄露攻击：CRT 加速用的私钥碎片 dp(=d mod p−1) 一旦泄露，不用分解 n 也能直接把 p 挖出来，进而求出完整私钥 d。",
    principle:
      "已知 e、n、dp，其中 $dp \\equiv d \\pmod{p-1}$，即 $e\\cdot dp \\equiv 1 \\pmod{p-1}$。取任意底数 g（如 2），由费马小定理 $g^{(p-1)} \\equiv 1 \\pmod p$，可推出 $\\gcd(g^{\\,e\\cdot dp}-g,\\ n)$ 大概率就是素因子 p。\n\n" +
      "拿到 p 后 $q=n/p$、$\\varphi=(p-1)(q-1)$、$d\\equiv e^{-1}\\pmod{\\varphi}$，整条私钥就还原了。给了 dq 可交叉验证。",
    usage: "填 e、n、dp（可选 dq），工具用底数试出 p、q，再算完整 d。",
    examples: [
      { in: "e, n, dp", out: "p, q, d", desc: "由 dp 反推素因子再求私钥" },
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
      { in: "n, e, c", out: "逐轮收窄的明文区间 → m", desc: "约需比特数次 Oracle 询问" },
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
      { in: "n, e, padding 响应特征", out: "可行性判定 + 攻击参数区间说明" },
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
      { in: "n, e, 已知明文高位", out: "根上界 X + SageMath small_roots 提示", desc: "实际求解在 Sage 跑" },
    ],
    formulas: [
      { tex: "|x_0| < n^{1/\\deg f}", caption: "小根可解的粗略上界，deg f 为多项式次数" },
    ],
    tips: ["特征：e 小 + 明文大部分已知只缺一小段，或 p 的高位被泄露。真正求解交给 SageMath。"],
    aka: ["coppersmith", "小根攻击", "格攻击", "stereotyped message", "Coppersmith", "科波史密斯攻击",
      "LLL格约化", "small roots", "已知高位攻击", "coppersmith method", "格基约化攻击", "低指数明文攻击"],
  },

  rsaBonehDurfee: {
    what: "Boneh-Durfee 攻击：Wiener 攻击的加强版，把「小私钥可破」的门槛从 d < N^0.25 推高到 d < N^0.292，更多小 d 的题都能拿下。",
    principle:
      "当私钥 $d < N^{0.292}$ 时，可把求 d 的问题化成一个二元模方程 $f(x,y)\\equiv 0$，用 Coppersmith 式的格约化（LLL）求小根解出 d，不必分解 n。\n\n" +
      "本工具检查 d 是否落在可攻击的门槛内，并说明格构造方法；实际求解需 SageMath 跑格约化脚本。",
    usage: "填 e、n（若已知 d 位数上界），工具判断是否满足 d < N^0.292 并给出方法说明。",
    examples: [
      { in: "e, n", out: "d < N^0.292 门槛判定 + 格攻击方法提示" },
    ],
    formulas: [
      { tex: "d < N^{0.292}", caption: "Boneh-Durfee 可攻击上界（优于 Wiener 的 0.25）" },
    ],
    tips: ["先试 Wiener（更快），Wiener 打不动但怀疑 d 仍偏小 → 上 Boneh-Durfee。特征仍是 e 巨大接近 n。"],
    aka: ["boneh durfee", "boneh-durfee", "小私钥攻击", "格攻击", "Boneh-Durfee", "博内-杜菲攻击",
      "小解密指数攻击", "Wiener加强版", "low private exponent", "d<N^0.292", "小d攻击", "格约化小私钥"],
  },
};
