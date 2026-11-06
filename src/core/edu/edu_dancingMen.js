/*
 * edu_dancingMen.js — 科普卡候选（跳舞小人 Dancing Men）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu/ 下新分片）。
 * EduEntry 契约见 src/core/eduContent.js 头注释。
 * 来源：Wikipedia「The Adventure of the Dancing Men」(2026-09-22 访问) /
 *       dCode「Dancing Men Cipher」(2026-09-22 访问)。
 */
export default {
  dancingMen: {
    what: "跳舞小人（Dancing Men）——柯南·道尔 1903 年短篇《跳舞的小人》里福尔摩斯破解的密码：每个字母画成一个手脚姿态各异的小人简笔画，手持小旗的小人表示一个词到此结束。",
    principle:
      "这是单表替换密码：26 个字母各对应一个固定姿态的小人，同一个字母永远画同一个小人。\n\n" +
      "旗标是词分隔符：小人手里举一面小旗，表示这个词写完了（相当于空格）。Wikipedia 原文说明：第五条消息解得 ELSIE PREPARE TO MEET THY GOD，其中代表 e 的小人第 1、2 次出现时都举着旗——因为 Elsie 和 Prepare 都以 e 结尾。福尔摩斯靠频率分析（哪个小人出现最多，多半是 e）破译了整张表。\n\n" +
      "原作只出现 18 个不同字母：F/J/K/Q/U/W/X/Z 这 8 个字母在原作消息里从未出现，因此没有「原作符号」；流传的补全版（dCode 收录，来源不明）给它们补了 8 个新符号，并把原作中几乎同形的 P、V 略微区分。\n\n" +
      "文本工具的诚实边界：小人姿态是图形，没有任何权威来源给出可逐字复现的文字姿态码（dCode 网站内部就用字母本身命名小人图片 char(97..122).png）。所以本工具的密文 token = 「字母本身 + 可选旗标后缀 *」，即文本域里真正编码的信息是「词尾旗标 + 空格分词」结构——要得到真正的小人图案请配合图像工具使用。",
    usage:
      "两个参数：字母表档（story=原作 18 字母，出现 F/J/K/Q/U/W/X/Z 直接报错；complete=流传补全的 26 字母）；旗标策略（flag=词尾字母加 *，原作口径；noflag=不加旗标只用空格分词，对应 dCode「旗标缺失」档）。\n\n" +
      "编码：输入英文（只保留 A-Z 与空格，其余丢弃，输出大写），得到「词 + *」序列。解码：按空白切词、去掉词尾 * 还原；单独的 *、词中间的 *、story 档非法字母都会显式报错。\n\n" +
      "默认参数就是 Wikipedia 第五消息，点「编码」立刻能看到 ELSIE* PREPARE* TO* MEET* THY* GOD*。",
    examples: [
      { in: "ELSIE PREPARE TO MEET THY GOD", param: "默认参数（story + flag）", out: "ELSIE* PREPARE* TO* MEET* THY* GOD*", desc: "Wikipedia 第五消息的旗标结构（词尾举旗）" },
      { in: "ELSIE* PREPARE* TO* MEET* THY* GOD*", param: "默认参数，方向=解码", out: "ELSIE PREPARE TO MEET THY GOD", desc: "反向读回，验证双向可逆" },
      { in: "AM HERE ABE SLANEY", param: "默认参数", out: "AM* HERE* ABE* SLANEY*", desc: "故事第一条消息（凶手 Abe Slaney 留下的名场面）" },
      { in: "FIND", param: "variant=complete（补全 26 字母）", out: "FIND*", desc: "补全档可编原作没有的 F" },
    ],
    formulas: [
      { tex: "\\text{token}(w) = w_1 w_2 \\cdots w_n{*}\\;(\\text{flag 档，} w_n\\text{ 为词尾字母})", caption: "文本 token 形式：词尾字母缀旗标 *，词间以空格分隔" },
    ],
    tips: [
      "识别：题目给出手脚姿态各异的小人简笔画、提到福尔摩斯/ Sherlock/ Conan Doyle/ Cubitt/ Abe Slaney，或「跳舞的小人」。",
      "原图破解思路：数每个小人出现次数做频率分析（英文最高频是 E），先抓带旗小人是词尾；再赌短词（两字母词多为 AM/IT/IS/AT）。",
      "原作缺口：F/J/K/Q/U/W/X/Z 在原作无符号——CTF 出题多用流传补全版；本工具 story 档遇到这 8 个字母会明确报错，不瞎猜。",
      "P 与 V 的符号在原作几乎相同（dCode 注明），补全版才区分；读原作图时注意这一点。",
      "旗标语义就是空格：没有旗标的消息（noflag 档）只能按词长猜边界，这正是它比普通单表替换难一点的地方。",
      "安全边界：单表替换毫无现代安全性（频率分析分分钟破），只能用于 CTF、教学与文学梗，不可用于真实保密。",
      "来源：Wikipedia https://en.wikipedia.org/wiki/The_Adventure_of_the_Dancing_Men 、dCode https://www.dcode.fr/dancing-men-cipher （访问日期 2026-09-22）。",
    ],
    aka: ["跳舞小人", "跳舞的小人", "小人密码", "Dancing Men", "Dancing Men Cipher", "Dancing Men Code",
      "Sherlock Holmes cipher", "福尔摩斯密码", "柯南道尔密码", "Conan Doyle", "小人简笔密码",
      "The Adventure of the Dancing Men", "跳舞人密码", "stick figure cipher", "旗标小人"],
  },
};
