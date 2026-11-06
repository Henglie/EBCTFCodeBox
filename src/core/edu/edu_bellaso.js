/*
 * edu_bellaso.js — 科普卡候选（Bellaso 密码）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：dCode「Bellaso Cipher」+ Wikipedia「Giovan Battista Bellaso」（均 2026-09-22 访问）。
 */
export default {
  bellaso: {
    what: "Bellaso 密码——1553 年 Giovan Battista Bellaso 发表于《La cifra del Sig. Giovan Battista Bellaso》的互反多表代换，历史上首次引入可更换密钥的双钥体系。本工具按 dCode 复原的口径实现：生成密钥构造互反字母表族，按词取密钥字母选表。",
    principle:
      "1. 生成密钥取去重字母，切成前后两组 g1、g2；用字母表剩余字母按序补满两半（各占字母表一半长），得字母表 1 = g1+补1 | g2+补2。\n" +
      "2. 第 i 张表（i=1..N）：前半不动，后半循环左移 n×(i-1) 位（默认 N=5、n=1）。\n" +
      "3. 字母选表：字母表 1 的第 k 个字母对应第 ((k-1) mod N)+1 张表。\n" +
      "4. 按词加密：第 j 个词用密钥第 ((j-1) mod 密钥长) 个字母所属的表；词内字母 x 在前半位置 p → 密文取同表后半同位字母，" +
      "在后半 → 取前半同位字母（两半互换，自反）。\n" +
      "5. 因为互换是双向的，加密函数 = 解密函数（互反表，Bellaso 的核心发明）。",
    usage:
      "五个参数：genkey 生成密钥（构造字母表）；keyword 词密钥（逐词循环）；alphabet 字母表（26 拉丁 / 20 意大利原始表）；" +
      "count 表数 N（默认 5）；step 表间位移 n（默认 1）。\n\n" +
      "编码与解码是同一个函数：方向切换不改变行为。词 = 连续字母串；空格、标点等非字母字符原样保留。" +
      "20 字母档没有 J K U W Y Z，消息含这些字母会显式报错；26 字母档覆盖全部大写字母。",
    examples: [
      { in: "DCODE BELLASO", param: "alphabet=20, genkey=CHIAVEALFABETICA, keyword=GIOVAN, N=5, n=1",
        out: "QLEQO HNOOPGL", desc: "dCode 官方算例：词 1 用 G（表 2），词 2 用 I（表 3）" },
      { in: "QLEQO HNOOPGL", param: "同上，方向=解码", out: "DCODE BELLASO", desc: "互反表：解码=编码，直接复原" },
      { in: "HELLO WORLD", param: "alphabet=26, genkey=KEYWORD, keyword=SECRET", out: "URZZK NLKOE", desc: "26 字母档（本工具自算）" },
    ],
    formulas: [
      { tex: "\\text{half}_2^{(i)} = \\mathrm{rot}_{n\\cdot(i-1)}(\\text{half}_2)", caption: "第 i 张表 = 前半不动、后半循环左移 n(i-1) 位" },
      { tex: "T[p] \\leftrightarrow T[p + |A|/2]", caption: "互反代换：前半第 p 位与后半第 p 位互换" },
    ],
    tips: [
      "识别：重合指数低于明文语言；按词分析——每个词都是单表代换，可对词型做模式匹配（同型词如 ABCBA 一眼可猜）。",
      "历史口径注意：Wikipedia 记载 Bellaso 1553 年原表为 11 张索引表、密钥逐字母推进，但原表完整映射未公开，" +
        "无法精确复刻；本工具采用 dCode 公开且带完整算例的复原版（按词推进），两口径差异已如实登记。",
      "词密钥的推进单位是「词」不是「字母」——这是本口径与维吉尼亚最大的区别。",
      "字母表长度必须为偶数（两半互反），20/26 两档均满足。",
      "安全边界：N 张表轮换 + 词级推进，频率分析按 N 分类后即可逐词破解——仅用于 CTF 与密码史教学。",
      "来源：dCode「Bellaso Cipher」https://www.dcode.fr/bellaso-cipher ；" +
        "Wikipedia「Giovan Battista Bellaso」https://en.wikipedia.org/wiki/Giovan_Battista_Bellaso （访问日期 2026-09-22）。",
    ],
    aka: ["Bellaso", "Bellaso 密码", "Bellaso cipher", "贝拉索密码", "1553 密码", "Bellaso 1553",
      "互反表密码", "reciprocal table cipher", "Bellaso 加密", "bellaso decoder", "意大利古典密码",
      "贝拉索互反密码", "chiffre de Bellaso"],
  },
};
