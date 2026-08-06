/*
 * edu-ana-more.js — 分析类科普卡（C 组新 op：MIME/LCG/SHA 扩展/生日）。纯数据。
 */
export default {
  mimeMultipart: {
    what: "MIME multipart 解析：邮件/HTTP 的 multipart/mixed 正文用 boundary 分隔多个 part（文本、附件、内嵌图）。CTF 里 flag 常藏在某个 part 的 base64 附件里。",
    principle:
      "头 `Content-Type: multipart/mixed; boundary=\"xxx\"` 声明分隔串；正文用 `--xxx` 行分隔 part，每个 part 有自己的 Content-Type / Content-Transfer-Encoding（base64 / quoted-printable / 7bit）头，空行后是正文。解析器按 boundary 切分，识别每 part 编码并解码。",
    usage: "粘贴 multipart 文本，输出各 part 的类型/文件名/解码后内容。encode 方向用 | 分隔内容组合成 multipart。",
    examples: [
      { in: "multipart 邮件原文", out: "part1 文本 + part2 base64 附件解码", desc: "附件正文按声明编码解码" },
    ],
    tips: ["看到 Content-Transfer-Encoding: base64 的 part 直接解 base64；quoted-printable 的 =XX 转字节。boundary 后带 -- 是结束标记。"],
    aka: ["mime", "multipart", "邮件解析", "mime解析", "multipart/mixed", "邮件附件", "mime multipart", "邮件头解析", "boundary", "eml解析"],
  },

  randu: {
    what: "RANDU：IBM 经典弱随机数生成器 x = 65539·x mod 2^31。教学演示它的序列生成与周期，说明为何它是教科书级反面教材。",
    principle: "线性同余 x_{n+1} = (a·x_n + c) mod m，RANDU 取 a=65539、c=0、m=2^31。因其乘数与模数选择糟糕，三维输出全部落在 15 个平面上（超平面结构），统计性质极差。",
    usage: "填种子与项数，输出序列。教学演示：对比现代 PRNG 理解 LCG 弱点。",
    examples: [
      { in: "种子 1，10 项", out: "65539 393225 1769499 …", desc: "RANDU 序列" },
    ],
    tips: ["RANDU 序列三维点全落 15 平面——看到题目用 RANDU 就知能破。CTF 里弱 LCG 的恢复见 truncLcgRecover / prngAttack。"],
    aka: ["randu", "弱随机数", "randu生成器", "65539", "ibm随机数", "randu演示", "randu序列", "弱lcg", "randu攻击", "randu 15平面"],
  },

  truncLcgRecover: {
    what: "截断 LCG 种子恢复：mod 2^32 的 LCG（x=a·x+c）只给出输出高位（k 位）时，穷举低未知位恢复种子。CTF 常见（Python random 取高位/截断输出）。",
    principle:
      "第一个完整状态 = 首项高位 << (32-k) | low，low 有 2^(32-k) 种可能。对每个候选按 LCG 递推，用后续输出校验高位是否一致；命中后回退一步（x0 = (x1-c)·a⁻¹ mod 2^32）恢复种子。未知低位 ≤24 位可穷举。",
    usage: "输入：连续截断输出（空格分隔）。参数：a/c（默认 1664525/1013904223 即 ANSI C）、k（已知高位位数，默认 24）。输出候选种子。",
    examples: [
      { in: "1234567 8901234 …", param: "a=1664525 c=1013904223 k=24", out: "候选种子列表", desc: "复现序列的种子" },
    ],
    tips: ["乘数 a 必须是奇数才有模逆（回退需要）。输出不足时给更多项减少候选。与 prngAttack（恢复未知 a/c）配合使用。"],
    aka: ["截断lcg", "truncated lcg", "lcg高位", "lcg种子恢复", "lcg截断", "python random高位", "lcg恢复", "truncated lcg attack", "lcg种子", "lcg爆破"],
  },

  shaLengthExtend: {
    what: "SHA 长度扩展攻击：SHA-1/SHA-256 是 Merkle-Damgård 结构，已知 H(secret||msg) 和消息长度，不知道 secret 也能构造 H(secret||msg||padding||append)——MAC = 前缀哈希时整个验证体系失效。",
    principle:
      "哈希 = 状态压缩链：H = compress(compress(...compress(IV, 块1)...), 块n)。已知中间状态 H 就能继续压缩后续块。攻击构造 msg2 = msg || pad(orig_len) || append，从已知 H 状态继续压缩 append（含 victim 视角填充，长度字段 = 扩展后总位长）。受害者验证 H(secret||msg2) 时按标准填充，结果与攻击值一致。",
    usage: "输入：原始哈希 空格 原消息字节数 空格 追加内容。输出扩展后的哈希。用 SHA-256 或 SHA-1。",
    examples: [
      { in: "<orighash> 9 &admin=true", param: "algo=sha256", out: "扩展哈希", desc: "与原长拼接验证一致" },
    ],
    tips: ["长度扩展的前提：知道原消息长度（从格式推断）。MD5 版见 hashLengthExtension op。防御：HMAC 或哈希输出截断。"],
    aka: ["长度扩展", "length extension", "sha长度扩展", "sha256扩展", "sha1扩展", "哈希长度扩展", "长度扩展攻击", "merkle-damgard", "mac伪造", "sha extension"],
  },

  birthdayCollision: {
    what: "生日碰撞演示：哈希输出截断到 b 位时，随机输入找碰撞的期望尝试数 ≈ 2^(b/2)（生日悖论）。教学演示哈希碰撞的本质与安全余量。",
    principle:
      "生日悖论：n 个随机值中两两相同的概率在 n ≈ 1.18·2^(b/2) 时过半。演示用截断 SHA-256 的前 b 位做键，随机输入查 Map，命中即碰撞对。",
    usage: "设截断位数（默认 24），输出碰撞对与尝试次数。对比理论 2^(b/2) 理解安全参数。",
    examples: [
      { in: "bitLen=24", out: "碰撞对 + 尝试次数", desc: "尝试 ≈ 2^12" },
    ],
    tips: ["2^24 截断只需 ~4000 次尝试——这就是为什么哈希必须 128+ 位。真实 MD5/SHA-1 碰撞构造见 coll 类 op。"],
    aka: ["生日攻击", "birthday attack", "生日悖论", "碰撞演示", "哈希碰撞", "截断哈希", "生日碰撞", "birthday collision", "碰撞对", "2的b/2"],
  },

  babaiCvp: {
    what: "Babai 最近平面（CVP）：给定格基和目标向量，找格上离目标最近的格点（近似）。LLL 归约后 Babai 算法给出 2^{n/2} 近似因子内的最近点。CVP 是格密码/格攻击的基础原语。",
    principle:
      "先 LLL 归约格基使基向量近正交短；再用 GSO 正交化求目标在正交基下的坐标，逐坐标四舍五入（round），组合回原始基即最近格点 v ≈ Σ round(μ_i)·b_i。输入：每行一个格基向量，最后一行目标向量。",
    usage: "粘贴格基（每行空格分隔整数）+ 末行目标向量，输出最近格点与残差。",
    examples: [
      { in: "2 0\\n1 1\\n3 1", out: "最近格点 3,1", desc: "目标恰在格上时精确恢复" },
    ],
    tips: ["CVP 常搭配 LLL：先归约再 Babai。CTF 格题（背包/HNP）最后一步常是 CVP 或直接短向量。", "输入必须整数矩阵；结果带残差提示近似质量。"],
    aka: ["babai", "最近平面", "cvp", "最近格点", "closest vector", "babai算法", "格上最近点", "babai nearest plane", "cvp求解", "最近向量问题"],
  },

  hnpRecover: {
    what: "HNP 隐藏数问题：ECDSA 签名 nonce k = t + x（t 已知、x 是小未知量）时，从 m 个签名恢复私钥 d。CTF 弱 nonce 题（如 k 只取部分随机位）的标准解法。",
    principle:
      "ECDSA 签名方程 s·k ≡ h + r·d (mod n)。若 k_i = t_i + x（共享小 x），对第一个签名穷举 x（xBound 次），每个 x 解出候选 d，再用其余签名的方程验证（s·k ≡ h + r·d）。大 nonce 空间版本用格（Boneh-Venkatesan）——本 op 为小空间穷举教学版。",
    usage: "输入：每行 `h r s t`（≥3 行），参数 xBound = nonce 未知量范围、n = 曲线阶（留空用 secp256k1）。输出候选私钥 d。",
    examples: [
      { in: "h1 r1 s1 t1\\nh2 r2 s2 t2\\nh3 r3 s3 t3", param: "xBound=4096", out: "候选 d（hex）", desc: "用多签名交叉验证" },
    ],
    tips: ["x 是共享小量时 n 个签名把错误候选排除干净。真实 ECDSA 弱 k 题（k 短/截断）是 HNP 经典应用。", "与 dsa 的 reuse-k 攻击区分：本 op 处理 k 已知高位（t），reuse-k 处理完全相同的 k。"],
    aka: ["hnp", "隐藏数问题", "hidden number problem", "弱nonce", "ecdsa弱k", "nonce攻击", "hnp攻击", "格攻击", "ecdsa恢复私钥", "weak nonce"],
  },

  spnAnalysis: {
    what: "SPN 差分/线性分析教学：对 4-bit S 盒算差分分布表（DDT）与线性逼近表（LAT），找出最强差分特征与线性特征。CTF 密码题分析 S 盒的标准第一步。",
    principle:
      "差分分布表 DDT[a][b] = #{x : S(x)⊕S(x⊕a) = b}——输入差分 a 到输出差分 b 的转移计数，计数越大差分攻击越有效；线性逼近表 LAT[α][β] = #{x : α·x ⊕ β·S(x) = 0} - 8——输入/输出掩码相关性偏差，偏差越大线性攻击越有效。",
    usage: "输入 16 个 S 盒值（hex 或 dec，须为置换），输出 DDT/LAT 表 + 最强差分/线性特征。留空用 PRESENT S 盒。",
    examples: [
      { in: "留空（PRESENT）", out: "DDT/LAT + 最强特征", desc: "PRESENT 最强差分概率 4/16" },
    ],
    tips: ["PRESENT 的 S 盒最强差分 Δin=0x1→Δout=0x5 概率 4/16（经典教材数据）。S 盒越接近随机，DDT 最大项越小（理想 2/16）。"],
    aka: ["差分分析", "线性分析", "ddt", "lat", "差分分布表", "线性逼近表", "spn", "s盒分析", "differential cryptanalysis", "linear cryptanalysis"],
  },

  md5CollisionShow: {
    what: "MD5 截断碰撞演示：对 MD5 输出截断到 b 位，用生日法现场找碰撞对（不同输入同截断哈希），直观展示「碰撞存在性」与 2^(b/2) 尝试的本质。",
    principle:
      "生日悖论：n 个随机 b 位值中两两相同概率过半需 n ≈ 2^(b/2)。演示对输入 " + '"coll0"、coll1…' + " 逐个算 MD5，取前 b/4 个 hex 字符为键查 Map，重复即碰撞对。",
    usage: "设截断位数（默认 32），输出碰撞对 + 尝试次数。调大位数观察尝试次数按 2^(b/2) 增长。",
    examples: [
      { in: "bitLen=32", out: "碰撞对 + 尝试次数", desc: "≈2^16 次" },
    ],
    tips: ["完整 128 位 MD5 碰撞需 fastcoll 类专用构造（知名碰撞对 79054025255fb1a26e4bc422aef54eb4）。本演示展示存在性本质。"],
    aka: ["md5碰撞", "截断碰撞", "md5 collision", "生日碰撞md5", "md5演示", "md5碰撞演示", "哈希碰撞演示", "md5 trunc", "碰撞对", "md5生日"],
  },

  lweToy: {
    what: "LWE 玩具加解密：Regev 学习带错误（Learning With Errors）的最小可运行实现（q=257, n=8），比特级加解密演示——后量子格密码的核心机制。",
    principle:
      "私钥 s ∈ Z_q^n；公钥 (A, b = A·s + e mod q)，e 是小噪声（±1）。加密比特 m：选随机 r，输出 (u = Aᵀ·r, v = b·r + m·⌊q/2⌋ mod q)。解密：v - u·s = m·⌊q/2⌋ + e·r，小噪声不越阈值，取整还原。安全性来自「无噪声时解线性方程组易、带噪声时难」（LWE 困难假设）。",
    usage: "填比特串（0/1，最多 8 位），输出每位加密→解密结果与正确率。教学参数保证 100% 正确。",
    examples: [
      { in: "1010", out: "4 位全部 ✓", desc: "教学参数无错误" },
    ],
    tips: ["LWE 是 Kyber（ML-KEM）等 PQC 标准的基础——理解它就看懂 Kyber 骨架。本 op 教学参数无安全强度，勿用于真实加密。"],
    aka: ["lwe", "learning with errors", "regev", "格密码", "后量子", "lwe加密", "post-quantum", "格加密", "kyber基础", "lwe玩具"],
  },

  ntruToy: {
    what: "NTRU 玩具加解密：截断多项式环 Z_q[x]/(x^n-1) 的最小可运行实现（n=8, q=257, p=3）——最古老的格密码方案之一的机制演示。",
    principle:
      "私钥 f（本教学用常数 2，与 p 互素）；公钥 h = p·f⁻¹·g mod q。加密：c = p·h·r + m mod q。解密：f·c mod q 后 mod p——p·h·r 项被 p 整除消失，余 f·m mod p，乘 f⁻¹ mod p 还原 m。安全性来自「环上找 f 相当于格上最短向量问题」。",
    usage: "填消息多项式（8 项 mod 3），输出密文与解密结果。留空用默认 1 0 1 0 0 0 0 0。",
    examples: [
      { in: "1 0 1 0 0 0 0 0", out: "往返一致 ✓", desc: "教学参数" },
    ],
    tips: ["NTRU 与 LWE 都是格密码：一个环上一个向量问题。f 与 p 必须互素（f mod p ≠ 0），否则解密丢消息。"],
    aka: ["ntru", "格密码", "多项式环", "ntru加密", "post-quantum", "后量子", "环格", "ntru玩具", "ntru解密", "格加密"],
  },
};
