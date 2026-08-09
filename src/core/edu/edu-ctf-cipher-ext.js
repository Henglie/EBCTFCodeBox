/*
 * edu-ctf-cipher-ext.js — ctfCipherExt.js 的 5 个 op 科普卡。
 * fancy: twinHex / trollScript / asciiSum
 * classic: caesarBox / curveCipher
 */
export default {
  twinHex: {
    what: "Twin-Hex（双字符查表编码）——把明文每两个字符当成一个整体去查一张 96×96 的组合表，得到的索引写成三位 base36。密文看着像一串杂乱的字母数字。",
    principle:
      "码表构造：取 ASCII 32~127 共 96 个可见字符，列出全部有序两字符组合，共 $96 \\times 96 = 9216$ 项，第 $i$ 项的索引就是它的编码值。\n\n" +
      "字符对 $(x, y)$ 的索引 = $(x - 32) \\times 96 + (y - 32)$。\n\n" +
      "索引最大 9215，转 base36 恰好三位（9215 = `73z`），所以每两个明文字符固定产出三个密文字符；不足三位的右填空格补齐定长。\n\n" +
      "明文长度为奇数时，末组用一个空格补成两字符，解码后把这个尾随空格去掉。",
    usage: "输入框填明文（仅支持 ASCII 32~127 可见字符），编码得 base36 串；解码填密文还原。密文长度恒为 3 的倍数。",
    examples: [
      { in: "a", out: "4tc", desc: "单字符：补成 `a `(a+空格) → 索引 6240 → base36 `4tc`" },
      { in: "Hello", out: "30l5os5uo", desc: "5 字符 → 3 组 → 9 个密文字符" },
      { in: "flag{twin}", out: "58s4vb6t06i15ul", desc: "10 字符 → 5 组 → 15 个密文字符" },
    ],
    formulas: [
      { tex: "idx(x,y) = (x - 32) \\times 96 + (y - 32)", caption: "字符对 → 码表索引（x、y 为 ASCII 码）" },
    ],
    tips: [
      "密文长度必为 3 的倍数，且只含 0-9a-z 和空格——这是识别特征。",
      "只吃 ASCII 可见字符，中文和控制字符会报错。",
      "别和十六进制混淆：它虽叫 Twin-Hex，实际用的是 base36 而非 base16。",
    ],
    aka: ["twin hex", "twinhex", "twin-hex", "双字符编码", "双十六进制", "twin hex cipher", "双字符查表", "96x96码表", "base36编码对", "孪生十六进制", "twinhex cipher", "双字编码"],
  },

  trollScript: {
    what: "TrollScript——BrainFuck 的一种「三字符 token」方言，整段程序由 tro 开头、ll. 结尾，中间全是 o 和 l 的三字符组合。看起来像一长串 ooo/oll/loo。",
    principle:
      "和 BrainFuck 完全同构，只是把 8 个单字符指令换成 3 字符 token：\n\n" +
      "`ooo`→`>`（指针右移）　`ool`→`<`（左移）　`olo`→`+`（当前格 +1）　`oll`→`-`（-1）\n" +
      "`loo`→`.`（输出当前格）　`lol`→`,`（读入）　`llo`→`[`（循环开始）　`lll`→`]`（循环结束）\n\n" +
      "外加 `tro` 表示程序开始、`ll.` 表示结束。解释器按定长 3 切分，遇到不认识的片段就前移一个字符继续找（所以夹杂说明文字也能跑）。\n\n" +
      "编码侧用「乘法循环」压缩体积：要输出码值 $n$ 的字符时，不写 $n$ 个 `olo`，而是把 $n$ 拆成 $a \\times b + c$（$a$、$b$ 取靠近 $\\sqrt{n}$ 的一对因子），用一个循环乘出来再补差值 $c$。后续字符则只写与前一个字符的差量。",
    usage: "输入框填明文，编码生成 TrollScript 程序；解码则执行程序并返回它打印的内容。含步数上限 500 万，防死循环。",
    examples: [
      { in: "Hi", out: "troolooloolooloolooloololloooooloolool…ll.", desc: "编码结果以 tro 起、ll. 止（完整串约 180 字符）" },
      { in: "tro…ll. 程序", out: "程序打印的文本", desc: "解码 = 执行该 BF 程序并取其输出" },
    ],
    tips: [
      "识别特征：整段只有 o、l、. 三种字符，且以 tro 开头 ll. 结尾。",
      "和 Ook!、Blub! 同属 BF 方言家族，思路一样只是 token 不同——认不出来时可先转成 BF 再看。",
      "解码是「执行程序」，不是查表还原，所以死循环程序会触发步数上限报错。",
    ],
    aka: ["troll script", "trollscript", "troll", "brainfuck方言", "bf方言", "troll语言", "深奥语言troll", "tro ll", "brainfuck derivative", "troll脚本", "巨魔脚本", "esolang troll"],
  },

  asciiSum: {
    what: "ASCII 前缀累加和——把明文逐字符的 ASCII 码累加起来，输出一串递增的数字。第一项固定是 0，之后每项都比前一项大「当前字符的码值」。",
    principle:
      "设明文字符码为 $c_1, c_2, \\dots, c_n$，输出数列为：\n\n" +
      "$S_0 = 0,\\quad S_k = S_{k-1} + c_k$\n\n" +
      "即输出 $0, c_1, c_1+c_2, c_1+c_2+c_3, \\dots$，空格分隔。\n\n" +
      "解码就是求相邻差：$c_k = S_k - S_{k-1}$，再把差值当码位还原字符。因为首项固定为 0，所以第一个字符也能算出来。",
    usage: "输入框填明文，编码得空格分隔的递增数列；解码填数列还原。非数字字符都当分隔符，所以逗号、换行分隔也能读。",
    examples: [
      { in: "Hello", out: "0 72 173 281 389 500", desc: "H=72，+e(101)=173，+l(108)=281，+l=389，+o(111)=500" },
      { in: "flag{sum}", out: "0 102 210 307 410 533 648 765 874 999", desc: "末项 999 即全部字符码之和" },
    ],
    formulas: [
      { tex: "S_0 = 0,\\quad S_k = S_{k-1} + c_k,\\quad c_k = S_k - S_{k-1}", caption: "前缀和正反变换" },
    ],
    tips: [
      "识别特征：一串严格递增的整数，首项是 0，相邻差都落在可打印字符码位区间（32~126）。",
      "末项 = 所有字符码之和，可以用来快速校验数列有没有抄漏。",
      "数列必须严格递增；出现相等或下降说明抄错了（或者根本不是这个编码）。",
    ],
    aka: ["ascii sum", "asciisum", "ascii累加和", "前缀和编码", "累加和编码", "ascii求和", "prefix sum cipher", "递增数列编码", "ascii累积和", "码值累加", "sum编码", "ascii前缀和"],
  },

  caesarBox: {
    what: "凯撒箱（Caesar Box）换位密码——传说凯撒用过的方形换位法。把明文按固定列宽填进一个方格，然后竖着按列读出来。只换位置不换字符。",
    principle:
      "设列宽为 $h$，明文去掉空格后长度为 $L$，则行数 $r = \\lceil L / h \\rceil$。\n\n" +
      "明文按行优先填入 $r \\times h$ 的网格，再按列优先读出，即得密文。\n\n" +
      "解密时用转置后的列宽 $\\lceil L / h \\rceil$ 再做一次同样的操作——因为转置两次回到原状。\n\n" +
      "但这个「转置两次还原」只在网格被填满（$L$ 是 $h$ 的整数倍）时成立。有残格时读取会跳过空位，两次转置的跳过位置不对称，就还原不回来了——这是算法固有性质，不是实现缺陷。",
    usage: "输入框填文本，参数 height 填列宽（默认 3）。编码按列读出；解码填同样的 height 还原。注意空格会被去除且无法还原。",
    examples: [
      { in: "abcdefghijkl", param: "height=3", out: "adgjbehkcfil", desc: "长度 12 是 3 的整数倍，网格填满，可完整还原" },
      { in: "Hello World!", param: "height=3", out: "Hlodeor!lWl", desc: "空格被去除，还原得 HelloWorld!（空格不可逆）" },
    ],
    formulas: [
      { tex: "r = \\lceil L / h \\rceil", caption: "行数由长度与列宽决定" },
    ],
    tips: [
      "换位密码的共同特征：密文字符与明文完全相同，只是顺序变了——做词频统计会和明文一致。",
      "长度不是列宽整数倍时无法完整还原，这是算法本身的限制，遇到这种题先想想列宽是不是猜错了。",
      "列宽未知时就枚举：长度的所有因子都值得试一遍。",
    ],
    aka: ["caesar box", "caesarbox", "凯撒箱", "箱型密码", "方箱密码", "caesar box cipher", "列换位", "箱式换位", "凯撒方箱", "方阵换位", "caesar box transposition", "箱型换位"],
  },

  curveCipher: {
    what: "曲路密码（Curve Cipher）——蛇形换位。把明文填进 row×col 的网格，然后按「一列往下、下一列往上」的蛇形路线读出来，最后整体反转。",
    principle:
      "先把明文按每 col 个字符切成若干段（即网格的行）。\n\n" +
      "读取时沿列方向走，每走满 row 个字符就翻转一次方向：某列自上而下取，下一列自下而上取，形如一条蛇在网格里绕行。\n\n" +
      "第 $i$ 步取的行号为：方向正向时 $i \\bmod row$，反向时 $row - (i \\bmod row) - 1$；列号恒为 $\\lfloor i / row \\rfloor$。\n\n" +
      "全部取完后把结果整体反转，即得密文。解密沿同样路线把密文逐字符填回网格再反转。\n\n" +
      "文本长度必须恰为 $row \\times col$——网格必须刚好填满，否则蛇形路线会错位，产出不可还原。",
    usage: "输入框填文本，参数 row / col 填网格行列数，两者相乘须等于文本长度。编码按蛇形读出；解码填同样的 row/col 还原。",
    examples: [
      { in: "HelloWorldab", param: "row=3, col=4", out: "lrbaoleWdloH", desc: "12 = 3×4，网格填满" },
      { in: "Thequickbrownfoxjumpsoverthelazydog", param: "row=5, col=7", out: "gesfcinphodtmwuqouryzejrehbxvalookT", desc: "35 = 5×7" },
    ],
    formulas: [
      { tex: "\\text{row}_i = \\begin{cases} i \\bmod r & \\text{正向} \\\\ r - (i \\bmod r) - 1 & \\text{反向}\\end{cases}", caption: "蛇形取行号（每 r 步翻转方向）" },
    ],
    tips: [
      "同属换位密码：密文字符集与明文完全相同，只是顺序被打乱。",
      "长度必须正好等于 row×col，凑不上就是参数猜错了——先把长度分解因数，逐对试。",
      "和栅栏、列换位是一家人，区别在读取路线是蛇形折返而非直线。",
    ],
    aka: ["curve cipher", "curvecipher", "曲路密码", "蛇形换位", "曲路", "snake cipher", "蛇形密码", "曲线密码", "曲路换位", "boustrophedon", "蛇行换位", "s形换位"],
  },
};
