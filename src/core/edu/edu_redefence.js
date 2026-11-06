/*
 * edu_redefence.js — 科普卡候选（Redefence 栅栏）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：CrypTool Portal「Redefence」官方算例、dCode「Chiffre Redefence」官方算例、
 * Wikipedia「Rail fence cipher」算例（均 2026-09-23 访问，全文与出处见 权威来源.md）。
 */
export default {
  redefence: {
    what: "Redefence（重栅栏）：栅栏密码（rail fence）的**行序变体**。明文照样按 W 型 zig-zag 写进若干行，但读出行时不再固定自上而下，而是按**指定行序**（或由关键词推出的行序）读出。行序取自然序时，它就退化成普通栅栏。",
    principle:
      "两步。第一步与标准栅栏完全相同：明文逐字符沿 W 型轨迹在 $N$ 行间上下移动（到顶折返、到底折返），写满后每行得到一段连续子串。\n\n" +
      "第二步是 Redefence 的差别：按**行序**依次取出各行拼接成密文。行序有两种给法——\n" +
      "① 直接给排列，如 `2 3 1` 表示先读第 2 行、再第 3 行、最后第 1 行；\n" +
      "② 给关键词，关键词长度决定行数 $N$，把关键词字母按字母序排序，其原始位置序列就是行序（关键词 `ZIG` → 字母序 G<I<Z → 行序 3,2,1）。\n\n" +
      "解码：先按 W 型轨迹算出每行长度（行长由轨迹决定，与行序无关），再按同一行序把密文切段回填各行，最后沿轨迹读回明文。\n\n" +
      "为什么更安全一点：标准栅栏只要爆破行数即可，Redefence 还要再定行序（$N!$ 种），密钥空间放大约 $N!$ 倍——但仍是纯换位，频率与重合指数特征不变，靠统计照样能破。",
    usage:
      "三个参数：栏数 rails（2..64，默认 3）、读行序 order（如 `2 3 1` / `231` / `2,3,1`）、关键词 key。\n\n" +
      "**order 与 key 二选一**：同时给出会显式报错（避免静默忽略）。给了 key 时，行数由关键词字母数决定（rails 被覆盖）；给了 order 时行数用 rails。两者都不给则用自然序 1,2,…,N（等价标准栅栏）。\n\n" +
      "字符按原样处理（不丢空格标点、不改大小写）；栏数不小于文本长度时原样返回（无有效换位）。",
    examples: [
      { in: "CT-ONLINE", param: "rails=3, order=2 3 1", out: "TOLN-ICNE", desc: "官方算例：第 2 行 TOLN、第 3 行 -I、第 1 行 CNE" },
      { in: "DCODEZIGZAG", param: "key=ZIG", out: "OIGCDZGADEZ", desc: "官方算例：关键词 ZIG → 字母序 G<I<Z → 行序 3,2,1" },
      { in: "WEAREDISCOVEREDRUNATONCE", param: "rails=3（自然序）", out: "WECRUOERDSOEERNTNEAIVDAC", desc: "自然序即标准栅栏（Wikipedia 算例），可当退化性质自检" },
      { in: "CRYPTOGRAPHYISFUN", param: "key=BANANA", out: "RPYPRSOUCHYAITGFN", desc: "关键词含重复字母 A/N：并列次序取稳定升序（本工具约定）" },
    ],
    formulas: [
      { tex: "\\text{行号}_i = \\text{zigzag}(i, N),\\quad i = 0 \\dots n-1", caption: "W 型轨迹：到 0 或 N−1 折返，周期 2(N−1)" },
      { tex: "C = R_{\\pi(1)} \\,\\|\\, R_{\\pi(2)} \\,\\|\\, \\cdots \\,\\|\\, R_{\\pi(N)}", caption: "密文 = 按行序 π 依次拼接各行；π 为恒等序时即标准栅栏" },
    ],
    tips: [
      "先判断是不是栅栏族：密文字母频次与明文一致（纯换位不改字母），只是顺序被打乱。",
      "两步爆破：先枚举行数 2..N，再枚举行序排列。行数小的时候（3-5 行）人工穷举行序也不慢。",
      "自检技巧：把行序设成自然序（留空 order 与 key），输出应与普通栅栏完全一致；不一致就是参数理解错了。",
      "关键词法的行序来自「字母排序后的原始位置」，不是关键词本身；重复字母的并列次序权威来源未定义，本工具取稳定升序（同字母时行号小者先读）。",
      "别把它和栅栏的 offset 混为一谈：offset（起始栏偏移）是标准栅栏的另一个特性，Redefence 改的是「读行顺序」，两者不同。",
      "安全边界：仍是纯换位密码，密钥空间小（行数 × 行序），已知明文或统计攻击都能破；教学/出题用，不可用于真实保密。",
      "来源：CrypTool Portal「Redefence」（行序定义 + 3 栏 (2 3 1) 算例）、dCode「Chiffre Redefence」（关键词定行数 + 行序）、Wikipedia「Rail fence cipher」（自然序即标准栅栏的算例）（均 2026-09-23 访问）。",
    ],
    aka: ["redefence", "重栅栏", "栅栏行序变体", "redefence cipher", "行序栅栏密码", "关键词栅栏",
      "rail fence 变体", "重排栅栏", "redefence 密码", "栅栏换序", "读行序栅栏", "变序栅栏",
      "行序重排栅栏", "redefence 加密", "railfence 行序"],
  },
};
