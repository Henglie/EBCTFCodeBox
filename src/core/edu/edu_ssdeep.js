/*
 * edu_ssdeep.js — 科普卡候选（SSDEEP 模糊哈希）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：ssdeep 官方源码 fuzzy.c + Kornblum 2006 CACM 论文 + python-ssdeep 测试向量
 * + ppdeep README（均 2026-09-22 访问，全文见 ref/SOURCES_A.md）。
 */
export default {
  ssdeep: {
    what: "SSDEEP / CTPH（context triggered piecewise hashing，上下文触发分段哈希）——Jesse Kornblum 2006 年提出的模糊哈希：把数据按内容触发点切成变长分段，每段只留一个 base64 字符，输出 blocksize:hash1:hash2 签名。两份数据不必逐字节相等，只要大部分分段相同，签名就大部分相同——编辑距离打分 0-100。取证用它比对恶意样本变种、找同源文件；CTF 里用于「改了几个字节的 flag 文件」类题。",
    principle:
      "1. 滚动哈希（Adler 型，窗口 7 字节：h1=窗口和、h2=加权和、h3=移位异或）流过数据；当 (roll_sum+1) 能被 3·2^i 整除时触发第 i 档分段点。\n" +
      "2. 每段累计 FNV-1 块哈希（低 6 位，闭式 ((h·19)&63)^c），触发时输出一个 base64 字符并复位。\n" +
      "3. 块尺寸 blocksize 从 3 起 2 的幂自适应（同时维护 b 和 2b 两档），保证签名约 64 字符：文件越大块越大。\n" +
      "4. 签名 = blocksize:hash1(b 档):hash2(2b 档，截断 31 字符)。空尾段用当前半段哈希补一个尾字符。\n" +
      "5. 比对：块尺寸须相等或差 2 倍（否则 0 分）；读入时消除 4 个及以上连同字符；须存在长度 7 的公共子串才计分；编辑距离（插 1/删 1/换 2）换算成 0-100 相似度（100=相同）；小 blocksize 封顶防夸大。",
    usage:
      "两个模式：生成签名（输入=数据，hex/base64/UTF-8 自动识别或拖文件）与比对（两条签名各占一行，或签名 B 填参数 textB；返回 0-100 整数分）。\n\n" +
      "典型工作流：分别对两份数据生成签名 → 切到比对模式贴入两条签名 → 读分。改几个字节通常仍有高分（80+），无关数据接近 0。注意：块尺寸差 2 倍的签名可比（自动用 2b 档对 b 档），其余块尺寸组合直接 0 分；畸形签名显式报错。空输入签名为 \"3::\"（官方库行为）。",
    examples: [
      { in: "Also called fuzzy hashes, Ctph can match inputs that have homologies.", param: "mode=hash, inputEnc=utf8",
        out: "3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C", desc: "C 库官方向量（python-ssdeep 测试集）：70 字节以内小文件 blocksize=3" },
      { in: "3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C\n3:AXGBicFlIHBGcL6wCrFQEv:AXGH6xLsr2C", param: "mode=compare",
        out: "22", desc: "同源两句只差 Ctph/CTPH 一词 → 22 分（C 库官方向量）" },
      { in: "The equivalence of mass and energy translates into the well-known E = mc²", param: "mode=hash, inputEnc=utf8",
        out: "3:RC0qYX4LBFA0dxEq4z2LRK+oCKI9VnXn:RvqpLB60dx8ilK+owX", desc: "ppdeep（纯 Python 独立实现）README 向量，本工具逐字节复现" },
      { in: "03b002416000", param: "mode=hash, inputEnc=hex",
        out: "3:ikf:ik", desc: "LZNT1 的 A×100 压缩流（hex 档，6 字节）——小输入签名很短（本工具自算，经 Python 参考对拍）" },
    ],
    formulas: [
      { tex: "\\mathrm{trigger}_i \\iff (\\mathrm{roll\\_sum}+1) \\bmod (3\\cdot 2^i) = 0", caption: "第 i 档（blocksize 3·2^i）分段触发条件" },
      { tex: "\\mathrm{score} = 100 - \\left\\lfloor \\frac{100\\,(64\\,D/(L_1+L_2))}{64} \\right\\rfloor", caption: "D=编辑距离（插 1/删 1/换 2），L=两签名段长" },
    ],
    tips: [
      "识别：签名格式固定 ^\\d+:[A-Za-z0-9+/]{0,64}:[A-Za-z0-9+/]{0,64}$；blocksize 恒为 3·2^k。",
      "比对分数语义：100=签名相同；>50 通常视为同源；改少量字节仍高分是算法设计目标（自动重同步）。",
      "块尺寸相差 2 倍仍可比（b 档对 2b 档），其余块尺寸不兼容返回 0——不是报错，是官方语义。",
      "与 MD5/SHA 对比：加密哈希防碰撞，任何 1 字节变化雪崩；模糊哈希 deliberately 保留相似度信息，不能当完整性校验用。",
      "安全边界：分数是启发式证据不是证明——短输入（<7 分段字符）恒 0 分可被用来隐藏相似性；对抗样本可构造低分同源文件。仅用于取证线索与样本聚类，不作唯一判据。",
      "来源：ssdeep 官方源码 https://github.com/ssdeep-project/ssdeep （fuzzy.c，GPL）；Jesse Kornblum, \"Identifying Almost Identical Files Using Context Triggered Piecewise Hashing\", CACM 49(3), 2006；向量：python-ssdeep tests https://github.com/DinoTools/python-ssdeep/blob/master/tests/test_lib.py 与 ppdeep https://github.com/elceef/ppdeep （访问日期 2026-09-22）。",
    ],
    aka: ["SSDEEP", "ssdeep", "模糊哈希", "fuzzy hash", "fuzzy hashing", "CTPH", "context triggered piecewise hash",
      "spamsum", "垃圾和哈希", "相似度哈希", "_similarity hash", "ssdeep compare", "SSDEEP 签名", "edit distance hash"],
  },
};
