/*
 * edu-fancy-new.js — 科普补缺分片（T309，花式编码）。
 *
 * 覆盖 1 个真实缺失 op 的科普卡：
 * fancy: jjencode
 *
 * 覆盖核查（撞已引分片的已剔除）：
 * - spon → registry 不存在该 opId，删
 * - whitespace/pigpen/keyboardShift/malbolge/aaencode/baudot/type7/decabit/scytale
 * → 全部已由 edu-fancy-rest.js 覆盖，删
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ fancy: JJEncode ============
  jjencode: {
    what: "JJEncode——把任意 JavaScript 源码编码成只含 [ ] ( ) ! + $ _ \" . = , ; 等符号的等价可执行代码，浏览器里跑起来和原文效果一样。",
    principle:
      "由 Yosuke Hasegawa（utf-8.jp）发明。核心手法：\n\n" +
      "1. 用 `~[]` 得到 -1，再用 `++` 递增造出数字 0..9；\n" +
      "2. 从几个恒等表达式里按下标取字符：`(![]+\"\")` 得 \"false\"、`(!\"\"+\"\")` 得 \"true\"、`({}+\"\")` 得 \"[object Object]\"，由此拼出 constructor / return / 各个字母；\n" +
      "3. 全局变量 gv（默认 $）的 `gv.$` 最终被赋成 Function 构造器；\n" +
      "4. 末尾 `gv.$(gv.$(\"return \\\"源码\\\"\")())()` 用 Function 构造器拼出源码字符串再执行。\n\n" +
      "解码时不执行最外层真正跑 payload 的那次调用，只在内层 `Function('return \"...\"')()` 求值出源码串，因此对任意输入（哪怕不是合法 JS）都能安全还原，且不会执行被编码的代码。算法逐字复刻 utf-8.jp 官方 demo（含原版对 ≥0x80 非 ASCII 字符的补零行为）。",
    usage: "输入框填 JavaScript 源码（如 alert(1)），参数 gv 填全局变量名（默认 $，须合法 JS 标识符）。编码得到一串符号代码；解码自动识别 JJEncode 首部（gv=~[];gv={___:++gv...}）还原源码。",
    examples: [
      { in: "alert(1)", param: "gv=$", out: "$=~[];$={___:++$, ... (一长串符号) ...;$($($$+\"\\\"\"+\"源码\"+\"\\\"\")())();", desc: "编码后只剩符号，粘贴到浏览器控制台即可执行 alert(1)" },
    ],
    tips: [
      "识别特征：密文以 `gv=~[];gv={___:++gv` 开头（gv 通常是 $），全篇几乎只有符号没有字母。",
      "和 AAEncode（颜文字）是同一作者的作品，AAEncode 输出是颜文字而 JJEncode 输出是纯符号。",
      "解码是安全的：只求值内层拼字符串的部分，不执行最外层 payload 调用，可放心解任意 JJEncode。",
      "CTF 里看到一坨 $=!+[] 之类的符号代码，先想 JJEncode。",
    ],
    aka: ["jjencode", "jj编码", "JS符号混淆", "Yosuke Hasegawa", "jjencode解码", "javascript符号编码", "js混淆", "符号代码", "js obfuscation", "utf-8.jp", "js encoder", "长谷川阳介", "非字母数字js"],
  },
};
