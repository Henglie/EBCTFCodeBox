/*
 * edu-hqc-family.js — HQC 三档算法族科普卡（T398 批A：HQC 后量子 KEM 按规范实现）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  hqcKeyGen: {
    what: "生成 HQC（Hamming Quasi-Cyclic，汉明准循环）后量子 KEM 的密钥对：公钥 ek（种子 + 环上向量 s）与私钥 dk（ek + 私钥种子 + σ + 主种子）。",
    principle:
      "HQC 是基于码的 KEM，安全性归约到准循环伴随式译码问题（QCSD）。私钥是两个固定重量（ω）的稀疏向量 (x,y)，公钥 h 是环 $GF(2)[X]/(X^n-1)$ 上的随机向量，$s = x + h \\cdot y$。\n\n" +
      "密钥生成完全由 32 字节主种子驱动：SHAKE256 派生出 (seed_dk, seed_ek, σ)，私钥向量 (x,y) 与公钥 h 全部从 XOF 流采样——所以 dk 里根本不存大向量，只存种子，需要时现场重采样。攻击者要从 $s = x + h \\cdot y$ 里解出稀疏的 (x,y)，就是 QCSD 难题；量子计算机也只用 Grover 提速常数级，所以是「后量子」的。\n\n" +
      "三档参数（HQC-128/192/256）对应 n=17669/35851/57637，ω=66/100/131，均取「大于 $n1 \\cdot n2$ 的最小素数」。2025-03 NIST 宣布 HQC 成为继 ML-KEM 后第二个标准化的 KEM（第四轮入选）。",
    usage:
      "参数选档 HQC-128/192/256，seed 留空即随机生成（可填 32 字节 hex 固定复现教学向量）。输出 ek / dk 的 hex（dk=ek‖seed_dk‖σ‖seed_kem，比 ek 长 96~128 字节），并给出下载文件。ek 粘到「HQC 加密」、dk 粘到「HQC 解密」即可完成链路。",
    examples: [
      { in: "（无需输入，直接运行）", param: "set=HQC-128，seed 留空随机", out: "公钥 ek（2241 B hex）\n私钥 dk（2321 B hex）\nseed_kem（32 B）", desc: "每次运行不同；填固定 seed 可逐字节复现（与官方 KAT 同口径：SHAKE256(seed‖0x00) 作 PRNG）" },
    ],
    tips: [
      "HQC 的 dk 不存 x,y 本身只存种子——「私钥 32 字节」才是它的真身，其余都是派生物，这是它和 RSA/ML-KEM 存储形态的最大区别。",
      "认档位看长度：HQC-128 ek=2241 B、HQC-192 ek=4514 B、HQC-256 ek=7237 B，CTF 里给一坨 hex 先量长度。",
      "HQC 与 ML-KEM 是 NIST 仅有的两个标准化 KEM：ML-KEM 基于格，HQC 基于码——两者抗量子原理完全不同，互为备份。",
      "seed_kem 是全链路唯一真随机源：泄露 seed_kem 等于泄露整副密钥（一切都能重采样出来）。",
    ],
    aka: ["HQC 密钥生成", "HQC keygen", "HQC 密钥对", "HQC 后量子密钥", "HQC KEM 密钥", "准循环密钥生成", "码基密码密钥", "post-quantum keygen", "HQC-128 密钥", "HQC-256 密钥", "QCSD 密钥", "NIST HQC 密钥", "汉明准循环密钥", "HQC 密钥封装密钥"],
  },
  hqcEncrypt: {
    what: "HQC KEM 封装（加密方向）：用公钥 ek 把明文 m（≤k 字节，右补零）封装成密文 $c = u \\| v \\| \\mathrm{salt}$，同时派生出 32 字节共享密钥 SS——接收方无需再传密钥就能算出同一个 SS。",
    principle:
      "加密三步走（HQC-PKE.Encrypt + FO 变换）：\n" +
      "① 从 θ 派生三个固定重量向量 (r2, e, r1)，算 u = r1 + h·r2；\n" +
      "② 把 m 用「$\\mathrm{RS}(n1,k)$ over $GF(2^{8})$ $\otimes$ 重复 $\\mathrm{RM}(1,7)$」的拼接码展开成 $n1 \\cdot n2$ 位，加上掩码 $\\mathrm{Truncate}(s \\cdot r2 + e)$ 得 $v = \\mathrm{C.Encode}(m) + \\mathrm{Truncate}(s \\cdot r2 + e)$；\n" +
      "③ KEM 层做加盐 Fujisaki-Okamoto 变换：(K,θ) = G(H(ek)‖m‖salt)，SS = K，密文 = u‖v‖salt。\n\n" +
      "解密端算 v − u·y = C.Encode(m) + (x·r2 − r1·y + e)：后一项是「可控噪声」，只要重量落在拼接码纠错半径内，纠错译码就能还原 m——这就是 HQC 把「加密」变成「往码字上泼沙子再筛出来」的思路。IND-CCA2 靠解密时重加密比对实现（隐式拒绝）。",
    usage:
      "输入框填明文（≤k 字节：HQC-128 为 16、HQC-192 为 24、HQC-256 为 32 字节，不足右补零；任意长数据请先用 SS 作对称密钥自行封装）。参数填公钥 ek hex（可留空随机生成一套演示密钥），salt 可固定复现。输出密文 c 与共享密钥 SS 的 hex。",
    examples: [
      { in: "flag{hqctest}", param: "set=HQC-128，ek=密钥生成的输出", out: "密文 c（4433 B hex）\n共享密钥 SS（32 B hex）", desc: "明文 12 字节右补零到 k=16 字节进入 RS 编码" },
    ],
    tips: [
      "HQC 是 KEM 不是「加密任意长度文件」的魔盒：明文硬上限 k 字节（16/24/32），长数据要 SS 套 AES-CTR/ChaCha20 自己包一层。",
      "密文结构 u‖v‖salt 三段：u 是 $\\lceil n/8 \\rceil$ 字节环上向量、v 是 $\\lceil n1 \\cdot n2/8 \\rceil$ 字节码字、salt 固定 16 字节——尾部 32 个 hex 字符就是 salt。",
      "明文每次加密理论上可复现（m/salt 固定时密文确定），但规范口径下 m 应随机——固定 m 加盐 FO 变换仍是 IND-CCA2 的。",
      "SS 和接收方解密算出的 SS 逐字节相同（32B hex），CTF 里直接拿它当对称密钥解后续数据。",
    ],
    aka: ["HQC 加密", "HQC encrypt", "HQC 封装", "HQC encapsulation", "HQC KEM 加密", "后量子 KEM 封装", "码基加密", "HQC 公钥加密", "HQC-128 加密", "准循环加密", "RMRS 编码加密", "NIST HQC 封装", "post-quantum encryption", "HQC 共享密钥派生"],
  },
  hqcDecrypt: {
    what: "HQC KEM 解封装（解密方向）：用私钥 dk 从密文 c 中恢复明文 m，并重算出与加密端一致的 32 字节共享密钥 SS；密文被篡改时输出伪随机 K̄（隐式拒绝）而非报错。",
    principle:
      "解密 = 纠错译码：m = $\\mathrm{C.Decode}(v - \\mathrm{Truncate}(u \\cdot y))$。减掉 $u \\cdot y$ 后剩下 $\\mathrm{C.Encode}(m) + e'$，其中 $e' = x \\cdot r2 - r1 \\cdot y + e$ 的重量以压倒性概率落在拼接码纠错半径内。\n\n" +
      "译码两级流水：内码 RM(1,7) 重复 3/5 倍，用快速 Hadamard 变换（Green machine）做最大似然译码，把每个 128 位块投票成一个字节；外码缩短 RS 码（RS-S1/2/3 = [46,16]、[56,24]、[90,32] over $GF(2^{8})$，纠 15/16/29 个符号）用 Berlekamp-Massey + Chien 搜索 + Forney 算法做代数译码。\n\n" +
      "拿到 m' 后重新加密一次与收到的密文比对：一致 → SS = G(H(ek)‖m'‖salt)；不一致或译码失败 → SS = J(H(ek)‖σ‖c)（伪随机拒绝钥）。攻击者无法区分两种情况，这就是隐式抵抗选择密文攻击的核心。",
    usage:
      "输入框填密文 c 的 hex（u‖v‖salt 全串），参数填私钥 dk hex 与参数集。输出共享密钥 SS（32 B）与明文（自动去除右补零）；若显示「隐式拒绝路径」说明密文不完整或被篡改，SS 是伪随机值。",
    examples: [
      { in: "加密输出的密文 c hex", param: "set=HQC-128，dk=对应私钥", out: "共享密钥 SS（32 B，与加密端一致）\n明文 m（k 字节 hex）\n明文（utf-8）", desc: "flag{hqctest} 加密的密文在此还原，SS 逐字节复现" },
    ],
    tips: [
      "「解密成功」的判据不是有没有报错——隐式拒绝会安静地给你一个假 SS；看到「隐式拒绝路径」字样就该怀疑密文被改或 dk 不配对。",
      "dk 是 2321/4602/7333 字节（按档位），粘少了会报长度错误；它的第 2241~2273 字节就是 32 字节的 seed_dk（HQC-128）。",
      "纠错译码是 HQC 的心脏：注入不超过纠错半径的随机比特，解密照样还原明文——想验真伪实现，给 v 加几十个随机比特再解。",
      "CTF 套路：题目给「加密的 flag + 私钥种子」，先把 dk 拼出来（ek‖seed_dk‖σ‖seed_kem），再走本档解密；SS 通常还要喂给后面的对称解密。",
    ],
    aka: ["HQC 解密", "HQC decrypt", "HQC 解封装", "HQC decapsulation", "HQC KEM 解密", "后量子解封装", "码基解密", "HQC 私钥解密", "HQC-128 解密", "准循环译码", "RMRS 译码", "Berlekamp-Massey 译码", "Hadamard 译码", "隐式拒绝解密"],
  },
};
