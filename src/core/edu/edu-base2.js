// 科普内容分片：base 家族后 12（base65536/ecoji/base64steg/base64dict/multilineBase64/base64decompress/zbase32/base32Crockford/base32hex/base64urlNoPad/base58Flickr/base58Ripple）。纯数据，无 import 无副作用。
export default {
  base65536: {
    what: "qntm 的另一个紧凑编码：每 2 字节映射成 1 个（多为 CJK 的）Unicode 字符。字符数只有字节数的一半。",
    principle:
      "把每 2 字节 $(b_1, b_2)$ 编成一个码点：先按 $b_2$ 选一个 256 字宽的区块起点，再加上 $b_1$ 定位。\n\n" +
      "数据是奇数字节时，最后一个字节走一个特殊起点（表里的 `-1` 项），解码时据此知道只还原 1 字节。",
    usage: "粘 base65536 文本解码；编码方向把原文转 base65536。",
    examples: [
      { in: "鹈", out: "Hi", desc: "2 字节 → 1 个 CJK 字符" },
      { in: "襃ᕆ", out: "CTF", desc: "3 字节 → 2 字符（后者走奇数收尾起点）" },
    ],
    tips: ["满屏汉字/生僻字、但读不成句子，字符数约为原文字节数一半，考虑 base65536。"],
    aka: ["base 65536", "b65536", "qntm base65536", "Base65536", "base65536编码", "CJK编码", "汉字编码", "unicode编码", "双字节编码", "base65536 decode", "生僻字编码", "两字节一字符"],
  },

  ecoji: {
    what: "用 emoji 表达数据的编码：1024 个 emoji 组成码表，每 5 字节编成 4 个 emoji，末尾用专门的 padding emoji 补齐。",
    principle:
      "把 5 字节（40 位）切成 4 组、每组 10 位（$2^{10}=1024$），各查 emoji 表。不足 5 字节时用 padding emoji（☕ 等）补位，并靠最后一位的特殊 emoji 记录实际长度。",
    usage: "粘 emoji 串解码回原文；编码方向把文本转 ecoji。",
    examples: [
      { in: "👖📸🎈☕", out: "abc", desc: "3 字节 → 前 3 个数据 emoji + 1 个 padding ☕" },
    ],
    tips: ["和 base100 都是 emoji，但 ecoji 是 5→4 的多字节分组、还有 padding emoji；base100 是严格一字节一 emoji。", "结尾出现 ☕ 这类固定 padding emoji，是 ecoji 的标志。"],
    aka: ["ecoji", "emoji base1024", "表情编码", "Ecoji", "emoji编码", "表情符号编码", "emoji encoding", "ecoji解码", "1024emoji", "表情base", "emoji base", "emoji数据编码"],
  },

  base64steg: {
    what: "base64 补位隐写：利用 base64 结尾 `=` 前那个字符「有几位是被忽略的」来偷藏比特。表面是普通 base64，实则每行藏了几位秘密。",
    principle:
      "带 padding 的 base64，末字符有 2 或 4 个比特其实不影响解码结果。把这几位改写成秘密比特，就能在「看起来正常」的 base64 里夹带信息。\n\n" +
      "解码端：对每行重新做标准 base64，比较末字符与原文的偏移，偏移量就是藏的值；按每行 `=` 个数×2 位拼回明文。",
    usage: "解码：粘多行 base64，工具逐行取出隐藏比特并拼成明文。编码：把要藏的短文本转成多行带 padding 的 base64。",
    examples: [
      { in: "czB=\nc6==\nczI=\nc2==\nczS=\nc0==", out: "hi", desc: "每行 = 前的字符偏移藏比特" },
    ],
    tips: ["一堆很短、每行都带 `=` 的 base64 行，逐行解出来是乱码填充字符，八成是这种 padding 隐写。", "关注的不是解码内容，而是 `=` 前那个字符相对标准编码偏移了多少。"],
    aka: ["base64隐写", "base64 steg", "padding隐写", "补位隐写", "base64 steganography", "base64填充隐写", "base64 padding stego", "等号隐写", "base64藏比特", "b64隐写", "填充位隐写", "base64补位隐写"],
  },

  base64dict: {
    what: "换了字母表的 base64（凯撒自定义字典）：编码规则和标准 base64 一样，只是把 64 个字符换成你给的另一套。",
    principle: "先按标准 base64 编码，再把每个字符按「标准表 → 自定义字典」的位置一一替换。解码就反着替换回来再当标准 base64 解。`=` 保持不变。",
    usage: "在字典框填 64 字符的自定义表，粘密文解码；编码方向反向。字典必须正好 64 字符。",
    examples: [
      { in: "HTp=", param: "字典=打乱的64字符表", out: "Hi", desc: "同一输入换标准表解得 SGk=" },
    ],
    tips: ["解出来是乱码但长得像 base64（4 的倍数、带 =），很可能是换表 base64——找到对方的码表填进去即可。", "本质是「base64 + 单表替换」，跟凯撒/替换密码同思路。"],
    aka: ["自定义字典base64", "换表base64", "base64 dict", "凯撒base64", "custom alphabet base64", "自定义字母表base64", "base64换表", "变表base64", "base64 custom table", "非标准base64", "base64字典替换", "换字典base64"],
  },

  multilineBase64: {
    what: "多行 base64：把长 base64 按固定宽度断成多行（邮件/PEM 证书就这么干）。解码时逐行处理再拼接。",
    principle: "编码：标准 base64 后每 N 个字符换一行（默认 76，PEM 传统宽度）。解码：每行单独补齐 padding 解码，把所有字节拼起来再统一按 UTF-8 还原（避免行边界切断多字节字符）。",
    usage: "解码：粘多行 base64 直接解。编码：填每行长度，把原文编成分行 base64。",
    examples: [
      { in: "SGVsbG8gV29ybGQh\nIFRoaXMgaXMgYSBs\nb25nZXIgdGV4dCBm\nb3IgZGVtby4=", out: "Hello World! This is a longer text for demo." },
    ],
    tips: ["PEM 证书（`-----BEGIN...`）、邮件 MIME 里的 base64 都是分行的，去掉头尾用它解。", "换行只是排版，删掉换行拼成一行再当普通 base64 解也行。"],
    aka: ["多行base64", "multiline base64", "分行base64", "pem base64", "换行base64", "MIME base64", "邮件base64", "wrapped base64", "折行base64", "base64分行解码", "76字符换行", "多行base64解码"],
  },

  base64decompress: {
    what: "base64 套一层 zlib 压缩：先解 base64 得到压缩数据，再解压才是原文。省流量的常见组合。",
    principle: "解码：base64 → 得到 zlib（deflate）压缩字节 → 用浏览器 `DecompressionStream` 解压。编码反向：先压缩再 base64。zlib 流带 2 字节头和 adler32 尾。",
    usage: "粘「base64 后的压缩数据」解码得原文；编码方向把原文压缩后转 base64。",
    examples: [
      { in: "（base64 编码的 zlib 流）", out: "解压后的原文", desc: "两步：解 base64 + 解压" },
    ],
    tips: ["普通 base64 解出来是乱码、但开头字节像 `78 9c`（zlib 常见头），就该再解压一层。", "很多 Web 应用把 JSON 压缩后 base64 塞进 URL/cookie，就是这种。"],
    aka: ["base64压缩", "base64 zlib", "base64 deflate", "压缩base64", "base64+zlib", "zlib base64解码", "base64 decompress", "base64解压", "压缩后base64", "deflate base64", "base64 inflate", "base64套压缩"],
  },

 // C7 合并：zbase32/base32Crockford/base32hex 三条已并入 base32 op
 // base64urlNoPad 并入 base64 op，base58Flickr/base58Ripple 并入 base58 op。
 // 其科普主条目在 eduContent.part-base.js（需父级归并变体关键词
};
