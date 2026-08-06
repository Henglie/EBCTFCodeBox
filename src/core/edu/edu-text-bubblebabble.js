/*
 * edu-text-bubblebabble.js — BubbleBabble 编码科普卡（text 类）。
 *
 * 覆盖 op：bubblebabble
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  bubblebabble: {
    what: "BubbleBabble——Antti Huima 2000 年设计的防误读编码。把二进制数据（哈希指纹、校验和）编码成由元音辅音组成的可读字符串，5 字符一组用连字符分隔、x 首尾包裹，如 `ping` → `xisak-nerek-loxix`。设计初衷是让人能口头朗读、手写抄录而不出错，也用于 SSH 主机密钥指纹展示。",
    principle:
      "字符表：元音 vowels = `aeiouy`（6 个），辅音 consonants = `bcdfghklmnprstvzx`（17 个，末位是 padding 'x'）。\n\n" +
      "编码流程（校验种子 c 初始 1）：\n" +
      "① 每 2 字节 (byte1, byte2) 为一组输出 6 字符：\n" +
      "   `元音[((byte1>>6 & 3) + c) % 6]` `辅音[(byte1>>2) & 15]` `元音[((byte1 & 3) + c//6) % 6]` `辅音[(byte2>>4) & 15]` `-` `辅音[byte2 & 15]`；\n" +
      "② 每组结束后更新种子 `c = (c*5 + byte1*7 + byte2) % 36`；\n" +
      "③ 奇数尾字节：输出 `元音[c%6]` + `辅音[16]` + `元音[c//6]` 的校验元组；\n" +
      "④ 首尾各加 padding 'x'；空输入固定输出 `xexax`。\n\n" +
      "解码是逆过程：每 6 字符组还原 2 字节，校验元组验证种子一致性（防篡改/抄写错误）。\n\n" +
      "关键点：c 是随内容滚动的校验种子，保证任何单字符篡改都会被解码端检出——这正是它「防误读」的本质。",
    usage: "输入框填文本（或 BubbleBabble 密文），点运行。encode 生成泡泡串、decode 还原。输入按 UTF-8 字节处理，中文也可用。",
    examples: [
      { in: "ping", param: "", out: "xisak-nerek-loxix", desc: "官方规范示例" },
      { in: "hello", param: "", out: "xipak-herek-serix", desc: "经典英文" },
      { in: "123456789", param: "", out: "xesef-disof-gytuf-katof-movix", desc: "数字串" },
      { in: "xisak-nerek-loxix", param: "", out: "ping", desc: "decode 还原" },
    ],
    tips: [
      "看到 `x` 开头结尾、`-` 分隔的元音辅音串（如 xisak-nerek-loxix）→ BubbleBabble。",
      "与 base 编码区分：BubbleBabble 只含元音辅音（aeiouy + bcdfghklmnprstvzx）和连字符，不含数字和大部分符号。",
      "SSH 主机密钥指纹（如 xxxxx-xxxxx-...）常是 BubbleBabble 格式——CTF 里给指纹要你还原原数据时用本 op。",
      "有校验和机制：密文被篡改一个字符会报「校验和不符」，而不是解出错误结果——这是它的特性不是 bug。",
      "输入是字节流：中文按 UTF-8 编码后参与编码，decode 后还原 UTF-8。",
    ],
    aka: ["bubblebabble", "Bubble Babble", "泡泡编码", "防误读编码", "bubblepy", "Antti Huima", "指纹编码", "ssh指纹", "fingerprint encoding", "bubble babble encoding", "xi编码", "bubblebabble decode", "泡泡串", "bubble code", "xexax"],
  },
};
