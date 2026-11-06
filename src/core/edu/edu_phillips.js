/*
 * edu_phillips.js — 科普卡候选（Phillips 密码）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：ACA「PHILLIPS」PDF（2026-09-22 访问）+ dCode「Phillips Cipher」。
 */
export default {
  phillips: {
    what: "Phillips 密码——20 世纪上半叶的多表代换：一个 5x5 字母方阵按固定规则演变出 8 个方阵，明文每 5 个字母换一个方阵，每个字母取当前方阵中「右下方一格」的字母作密文。",
    principle:
      "1. 基础方阵：25 个互异字母排成 5x5（美国密码协会 ACA 例用关键词 DIAGONALS 的专用排布；本工具关键词模式按「去重字母 + 按序补全 A-Z 去 J」生成）。\n" +
      "2. 方阵演变：把第 1 行逐次下移一位得到方阵 2、3、4、5；再在方阵 5 上把原第 2 行逐次下移一位得到方阵 6、7、8。\n" +
      "3. 代换：明文按每块 T 个字母（经典 T=5）分块，第 n 块用方阵 ((n-1) mod 8)+1；找到明文字母所在格 (r,c)，" +
      "密文 = 同方阵 ((r+1) mod 5, (c+1) mod 5) 处的字母——第 5 列绕回第 1 列、第 5 行绕回第 1 行。\n" +
      "4. 解密：同一套方阵与分块，反向移格（左上方一格）。整体周期 8×T（经典 40 个字母）。",
    usage:
      "四个参数：grid 网格——给 25 个字母的串直接用（默认即 ACA 算例方阵 DIAGOCBSLNEFHKMUTRQPVWXYZ），" +
      "给短于 25 的关键词则按约定生成；period 块长（默认 5）；rowShift 行位移（默认 1）；colShift 列位移（默认 1）。\n\n" +
      "编码：填明文 → 密文；解码：填密文 + 相同参数 → 明文。明文/密文只取 A-Z（其余字符丢弃），输出大写；" +
      "输入字母必须存在于网格中，否则显式报错。",
    examples: [
      { in: "Squares one and five are actually the same as are squares two and eight. The overall period is forty.",
        param: "默认（ACA 例方阵，period=5）",
        out: "KZWLYTGEDTQETARBTYGTLFXWLPPOXLTYKUTKGKYTKZWLYTGXSEQETIRZQAAQTCITYKPPVBLHEFHGREYXO",
        desc: "ACA 官方算例（64 字母，整周期 40+24）" },
      { in: "KZWLYTGEDTQETARBTYGTLFXWLPPOXLTYKUTKGKYTKZWLYTGXSEQETIRZQAAQTCITYKPPVBLHEFHGREYXO",
        param: "默认，方向=解码",
        out: "SQUARESONEANDFIVEAREACTUALLYTHESAMEASARESQUARESTWOANDEIGHTTHEOVERALLPERIODISFORTY",
        desc: "反向复原，验证双向可逆" },
      { in: "THE QUICK BROWN FOX", param: "grid=DIAGONALS（关键词生成）", out: "ZTQXVHDUOYPSFAPB", desc: "关键词模式（本工具自算）" },
    ],
    formulas: [
      { tex: "C_i = G_{((i/T) \\bmod 8)+1}\\big[(r_i+1) \\bmod 5,\\ (c_i+1) \\bmod 5\\big]", caption: "第 i 个明文字母在所属方阵中右下移一格" },
    ],
    tips: [
      "识别：重合指数低（0.04-0.05）但字母集至多 25 种，且每隔 5 个字母替换表就变——周期攻击按 40 字母试。",
      "dCode 同名工具与本工具在方阵规则上一致，但 dCode 页面文字算例与其自身「第 3 块用方阵 3」的规则自相矛盾" +
        "（其 IPS→OVY 只与方阵 1 相符），本工具以自洽且完整的 ACA 算例为口径。",
      "还有 Phillips-RC 变体（行与列同时逐块移位），本工具未实现，遇到 RC 密文需另行处理。",
      "网格默认值不是关键词 DIAGONALS 的简单去重填充——ACA 原方阵为专用排布，故默认按原方阵字面提供。",
      "安全边界：多表代换强度有限，8 个方阵周期 40，重合指数法+已知明文即可攻破——仅用于 CTF 与教学。",
      "来源：ACA「PHILLIPS」https://www.cryptogram.org/downloads/aca.info/ciphers/Phillips.pdf ；" +
        "dCode「Phillips Cipher」https://www.dcode.fr/phillips-cipher （访问日期 2026-09-22）。",
    ],
    aka: ["Phillips", "Phillips 密码", "Phillips cipher", "Phillips C", "菲利普斯密码", "方阵移位密码",
      "八方阵密码", "phillips cipher decoder", "周期方阵代换", "ACA Phillips", "Phillips 加密",
      "右下移位方阵", "Phillips 解密"],
  },
};
