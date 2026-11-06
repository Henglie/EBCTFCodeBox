/*
 * edu_beaufortVariant.js — 科普卡候选（变体 Beaufort）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：Wikipedia「Vigenère cipher」§ Variants 与「Beaufort cipher」、dCode「Chiffre Variante de Beaufort」
 * 官方算例（均 2026-09-23 访问，全文与出处见 权威来源.md）。
 */
export default {
  beaufortVariant: {
    what: "变体 Beaufort（Variant Beaufort，又称「Beaufort 的德意志变体」）：字母密钥逐位相减，但方向与标准 Beaufort 相反——用**明文减密钥**而不是密钥减明文。它和标准 Beaufort 长得很像，却**不是自反**密码：加密与解密是两套操作。",
    principle:
      "同一「字母密钥逐位加减」家族里，按字母序数（A=0…Z=25）模 26 有三条式子：\n" +
      "标准维吉尼亚 $c_i=(p_i+k_i)\\bmod 26$；标准 Beaufort $c_i=(k_i-p_i)\\bmod 26$（自反）；变体 Beaufort $c_i=(p_i-k_i)\\bmod 26$。\n\n" +
      "变体 Beaufort 最有用的等价刻画是：**加密 = 标准维吉尼亚的解密，解密 = 标准维吉尼亚的加密**。所以它非自反——把密文再「加密」一次不会回到明文，必须走解码方向。\n\n" +
      "密钥循环重复；结果为负数时加 26 取正（$3-2=1$；$2-11=-9\\to17$）。逐位独立，因此它和维吉尼亚一样保留单表统计特征，可用 Kasiski/重合指数分析密钥长度。",
    usage:
      "两个参数：字母密钥（非字母字符被忽略，但过滤后必须至少剩一个字母，否则显式报错）、字符处理档（只保留字母 / 保留非字母原位）。\n\n" +
      "编码：明文 → 密文；解码：密文 → 明文。**方向不能省**——它不是自反的，用错方向得到的是一串看似合理的乱码。非字母字符默认丢弃（与项目内标准 Beaufort 一致）；选「保留非字母原位」时标点空格原地不动且不消耗密钥位。\n\n" +
      "默认参数（密钥 CLE）配输入 DCODE 可直接复现官方算例 BRKBT，便于自检。",
    examples: [
      { in: "DCODE", param: "key=CLE", out: "BRKBT", desc: "官方算例：3−2=1(B)、2−11=−9+26=17(R)、14−4=10(K)、3−2=1(B)、4−11=−7+26=19(T)" },
      { in: "BRKBT", param: "key=CLE（解码方向）", out: "DCODE", desc: "解密 = 把密文与密钥相加再取模" },
      { in: "ATTACKATDAWN", param: "key=FORTIFICATION", out: "VFCHUFSRDHOZ", desc: "长密钥循环；注意非自反：对结果再编码一次不会回到明文" },
      { in: "MEET ME AT DAWN!", param: "key=key, chars=keep", out: "CAGJ IG QP FQSP!", desc: "保留非字母原位（空格与感叹号不动、不消耗密钥位）；解码即回 MEET ME AT DAWN!" },
    ],
    formulas: [
      { tex: "c_i = (p_i - k_{i \\bmod L}) \\bmod 26", caption: "加密：明文减密钥（L 为密钥长度）" },
      { tex: "p_i = (c_i + k_{i \\bmod L}) \\bmod 26", caption: "解密：密文加密钥（即标准维吉尼亚的加密式）" },
    ],
    tips: [
      "三者一眼分辨：维吉尼亚 $c=p+k$；标准 Beaufort $c=k-p$ 且自反；变体 Beaufort $c=p-k$ 且**不**自反。",
      "判别技巧：把密文当明文再跑一次「加密」——若得到可读文本，那是标准 Beaufort（自反）；变体 Beaufort 必须切到解码方向。",
      "等价用法：想用现成的维吉尼亚工具解变体 Beaufort，就**交换编解码按钮**——变体 Beaufort 的加密正是维吉尼亚的解密。",
      "别名很多：「德意志变体」「Beaufort 的德国变体」（法文 Variante allemande de Beaufort）都指本算法；注意与标准 Beaufort 不是同一个东西。",
      "密钥含非字母会被静默忽略：`C-L-E` 与 `CLE` 等价；但整串没有字母会直接报错，不会把明文当密文返回。",
      "安全边界：单表多字母替换，密钥短时用 Kasiski/重合指数即可定长；密钥长度接近报文长度时才接近一次一密。属教学与出题用古典密码，不可用于真实保密。",
      "来源：Wikipedia「Vigenère cipher」§ Variants（Variant Beaufort 的操作式定义）、Wikipedia「Beaufort cipher」（标准 Beaufort 自反）、dCode「Chiffre Variante de Beaufort」官方算例（均 2026-09-23 访问）。",
    ],
    aka: ["变体beaufort", "variant beaufort", "变体博福特", "beaufort变体", "德意志变体beaufort",
      "德国变体博福特", "beaufort variant cipher", "variant beaufort cipher", "博福特变体密码",
      "非自反beaufort", "beaufort第三式", "variante de beaufort", "variante allemande de beaufort",
      "变体波弗特", "明文减密钥密码"],
  },
};
