/*
 * edu_collon.js — 科普卡候选（Collon 密码）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：dCode「Chiffre de Collon」（2026-09-22 访问）。
 */
export default {
  collon: {
    what: "Collon 密码——用一个 5x5 网格把每个字母换成两个字母（行首 + 列末），再按 N 个字母一组做「首末换位」的多元组代换，类似波利比奥斯方阵，但坐标本身也是网格里的字母。",
    principle:
      "1. 网格：25 个互异字母排成 5x5（dCode 例用 A-Z 去 J；关键词模式按「去重字母 + 按序补全」生成）。\n" +
      "2. 单字母编码：字母 x 在网格 (r,c) → 记行首字母 = 网格[r][0]（该行最左格）、列末字母 = 网格[4][c]（该列最下格）。\n" +
      "3. 系列换位：明文按每 N 个字母一组；每组的密文 = 先连写 N 个行首字母，再连写 N 个列末字母——" +
      "组内做了一次「坐标首末分离」的小换位。\n" +
      "4. 解密：密文按 2N 切组、组内对半分成行首串与列末串；第 i 个明文 = 网格[行首_i 所在行][列末_i 所在列]。" +
      "对角线上的字母会出现行首=列末=自身的双字母（如 UU 解回 U），是正常现象。",
    usage:
      "两个参数：grid 网格（25 字母串直接用，默认 A-Z 去 J 即 dCode 例；短于 25 视为关键词自动生成）；series 系列长 N（默认 2）。\n\n" +
      "编码：填明文 → 密文（长度恒为明文两倍）；解码：填密文 + 相同网格与 N → 明文。明文/密文只取 A-Z（其余字符丢弃），" +
      "输出大写；密文长度必须为偶数、每组两半等长，否则显式报错。",
    examples: [
      { in: "DCODE", param: "默认网格（去 J），N=2", out: "AAYXLAYYAZ", desc: "dCode 官方算例：DC/OD/E → AAYX+LAYY+AZ" },
      { in: "AKKXZVKKKVZY", param: "grid=ABCDEFGHIJKLMNOPQRSTUVXYZ（去 W），N=3，方向=解码", out: "COLLON",
        desc: "dCode 官方解密例：AKK|XZV → (A,X)(K,Z)(K,V) …" },
      { in: "COLLONCIPHER", param: "grid=COLLON（关键词生成），N=3", out: "CCCVWXCCCXWYCHHVWZHBQVXW", desc: "关键词模式（本工具自算）" },
    ],
    formulas: [
      { tex: "x = \\mathrm{grid}[r][c] \\mapsto \\big(\\mathrm{grid}[r][0],\\ \\mathrm{grid}[4][c]\\big)", caption: "字母 → （行首，列末）双字母" },
    ],
    tips: [
      "识别：密文长度为明文两倍、偶数长；整段密文至多 10 种不同字母（5 个行首 + 5 个列末）；每组 2N 个字母里" +
        "前半与后半各自至多 5 种——这是 N 与网格边的直接线索。",
      "dCode 的「坐标方向」参数（行首/行末 × 列首/列末 共 8 种组合）本工具实现默认组合（行首 + 列末，" +
        "先首后末输出），其余组合可按出题方说明手工换算。",
      "不知网格时的破译思路（dCode）：枚举 N，利用「前半 5 种、后半 5 种、共享 1 种」的约束反推第一列与最后一行，" +
        "再按单表代换攻击。",
      "末系列不足 N 个字母按实际长度输出，因此密文总长恰为明文两倍；解码按组内等长对半切分。",
      "安全边界：本质是单表代换的坐标化 + 固定小换位，字母频率结构未被隐藏，样本足够即可攻破——仅用于 CTF 与教学。",
      "来源：dCode「Chiffre de Collon」https://www.dcode.fr/chiffre-collon （访问日期 2026-09-22）。",
    ],
    aka: ["Collon", "Collon 密码", "Collon cipher", "chiffre de Collon", "科隆密码", "Collon 网格密码",
      "行首列末密码", "collon decoder", "双字母坐标密码", "Collon 加密", "Collon 解密", "瑞士棋盘 Collon",
      "Polybius 变体 Collon"],
  },
};
