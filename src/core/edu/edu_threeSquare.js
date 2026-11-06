/*
 * edu_threeSquare.js — 科普卡候选（三方密码 Three-square）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu/ 下新分片）。
 * EduEntry 契约见 src/core/eduContent.js 头注释。
 * 来源：dCode「Three Squares Cipher」(2026-09-22 访问)。
 */
export default {
  threeSquare: {
    what: "三方密码（Three-square）——三个 5×5 方阵组成的多码替换：每两个明文字母（双字母组）被编成三个密文字母（三字母组），密文比明文长 50%，是四方密码的「三阵姊妹」。",
    principle:
      "三个 5×5 方阵（各由一个关键词生成）。加密一对明文 (L1, L2)：\n\n" +
      "1. L1 在方阵 1 定位 (r1, c1)，L2 在方阵 2 定位 (r2, c2)；\n" +
      "2. 中间公共方阵（方阵 3）取交点：mid = 方阵3[r1][c2]——行取 L1 的行、列取 L2 的列，跟四方密码的「拐角」读法同源；\n" +
      "3. 输出三字母组：[方阵 1 中与 L1 同列的某字母] + mid + [方阵 2 中与 L2 同行的某字母]（dCode 默认 1-3-2 次序）。\n\n" +
      "原算法里第 1/3 个字母是「随机取」的——解密只需要 A 的列号和 C 的行号，所以任取都可逆：明文1 = 方阵1[B 的行][A 的列]，明文2 = 方阵2[C 的行][B 的列]。这也是它抗频率分析的原因：同一个字母组每次密文都长得不一样。\n\n" +
      "本工具把随机位参数化成两档：rotate（按组序 i mod 5 轮转取行列内字母）与 top（固定取列首/行首），完全确定且双向可逆。dCode 官方例：键 ONE/TWO/THREE 时 UDBJDC → CODE。",
    usage:
      "五个参数：key1/key2/key3（三个方阵的关键词，默认 ONE/TWO/THREE 即官方例）；字母表约定（noz 省 Z=官方例默认 / ij 合并 I-J / noq 省 Q，与本项目双方/四方密码同款）；随机位取法（rotate 轮转 / top 取首）。\n\n" +
      "编码：明文大写化归一后按双字母组处理，奇数长度自动补 X，输出三字母组连写（长度必为 3 的倍数、比明文长 50%）。\n\n" +
      "解码：输入三字母组串；第 1 位须在方阵 1、第 2 位须在方阵 3、第 3 位须在方阵 2，放错阵会显式报错——不瞎猜。",
    examples: [
      { in: "UDBJDC", param: "默认参数（ONE/TWO/THREE，noz），方向=解码", out: "CODE", desc: "dCode 官方解密例" },
      { in: "TKDGNVSAFRAV", param: "默认参数，方向=解码", out: "MESSAGEY", desc: "dCode 官方编码例（MESSAGE + 尾补 Y）的反向导出" },
      { in: "MESSAGEX", param: "默认参数（rotate 档，本工具补 X）", out: "BKCGNULAEREX", desc: "编码侧：确定性 rotate 档（中间位 K/N/A/E 与官方例一致）" },
      { in: "ME", param: "pick=top（固定取首）", out: "BKC", desc: "ME → B K C：B=方阵1 第 0 行 M 列，K=交点，C=方阵2 E 行第 0 列" },
    ],
    formulas: [
      { tex: "\\text{mid} = S_3[r_1][c_2],\\quad p_1 = S_1[\\mathrm{row}_{S_3}(B)][\\mathrm{col}_{S_1}(A)],\\quad p_2 = S_2[\\mathrm{row}_{S_2}(C)][\\mathrm{col}_{S_3}(B)]", caption: "交点取自行列交叉；解密只用列号(A)/行列号(B)/行号(C)" },
    ],
    tips: [
      "识别：密文长度是 3 的倍数、比「字母数」多出 50%；最多 25 种不同字母；重合指数接近随机文本——像 Bifid/四方但又长出一截时想它。",
      "三个方阵的分工记法：1=首字母阵、2=次字母阵、3=中间公共阵（只出交点字母）。",
      "关键词直接决定方阵：keyword 去重后接余下字母（同双方/四方密码的 buildSquare）；换一个关键词整张表全变。",
      "字母表约定要对齐：官方例三个方阵都省 Z（noz 档）；如果题目网格里有 J 没 Z 就选 noz，I/J 合并选 ij。",
      "与四方密码对比：四方是双进双出（2→2）、三方是双进三出（2→3），密文变长是多码替换换来的抗频率能力。",
      "安全边界：三个 5×5 方阵的密钥空间有限且结构公开，密文够长时可用多码分析/爬山攻击破解；仅适用 CTF 与教学，不可用于真实保密。",
      "来源：dCode Three Squares Cipher https://www.dcode.fr/three-square-cipher （访问日期 2026-09-22）。",
    ],
    aka: ["三方密码", "三方", "三方阵密码", "Three Square", "Three Square Cipher", "3 Square",
      "Three Squares", "3-square cipher", "triple square", "三方替换", "三字母组密码",
      "双字母组密码", "digram cipher", "trigram cipher", "多码替换", "polygrammic"],
  },
};
