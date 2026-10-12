// 科普内容分片：stego 文本类（零宽 / 变体选择器 / 火星文 / 同形字 / 规范化 / 透视）。纯数据，无 import 无副作用。
export default {
  zeroChar: {
    what: "零宽摩斯密码：先把明文转成摩斯电码，再用三种「看不见」的零宽字符分别代表点、划、分隔，藏进正常文本里。",
    principle:
      "明文 → 摩斯（`.`/`-`）→ 用零宽字符替身：U+200B(分隔)、U+200C(`.`)、U+200D(`-`)。屏幕上完全不显示，复制粘贴却带着走。CJK 等非摩斯字符退化成 `\\uXXXX` 形式再编。",
    usage: "编码把明文藏成零宽串；解码把混着零宽字符的文本还原成明文。",
    examples: [
      { in: "SOS", out: "一串看不见的零宽字符", desc: "S=... O=--- S=... 用零宽点划表示" },
    ],
    tips: ["肉眼字数和实际长度对不上、光标能在「空白」里多停几下 → 疑似零宽。先用 invisibleViz 可视化看清。"],
    aka: ["零宽摩斯", "zero width morse", "零宽字符隐写", "zerochar", "零宽度字符", "zero width characters", "zwsp隐写", "unicode零宽", "看不见的字符隐写", "invisible morse"],
  },

  zwTags: {
    what: "Unicode Tag 走私：用 U+E0000 那一整个「标签」平面藏 ASCII/UTF-8 字节。近年 LLM prompt 注入常拿它偷偷夹指令。",
    principle:
      "Unicode 有个 Tags 区块（U+E0000–U+E007F），历史上给语言标记用，现在废弃、屏幕不渲染。把每个 ASCII 字节加上 U+E0000 偏移映射成一个 tag 字符，就能把整段隐藏文本贴在可见文字后面，肉眼与多数编辑器都看不见。",
    usage: "编码把明文转成 tag 字符隐藏流；解码把 tag 字符还原成 ASCII/UTF-8。",
    examples: [
      { in: "hi", out: "U+E0068 U+E0069（不可见）", desc: "'h'=0x68 → E0000+0x68" },
    ],
    tips: ["AI 聊天里粘来的文本要警惕：可见内容之外可能藏了 tag 走私的隐藏指令。用 charInspect 逐字符看码位。"],
    aka: ["tag走私", "unicode tags", "tag smuggling", "e0000隐写", "prompt注入载体", "unicode标签隐写", "tags block", "标签平面", "u+e0000", "ascii smuggling", "隐藏指令注入", "unicode tag characters"],
  },

  zwVarSel: {
    what: "变体选择器隐写：Paul Butler 2024 的把戏——用 Unicode 变体选择器（本该给 emoji 选样式的字符）在任意一个字符后面挂载一整串隐藏字节。",
    principle:
      "变体选择器 U+FE00–FE0F（16 个）和 U+E0100–E01EF（240 个）共 256 个，正好对应一个字节的 256 种取值。把隐藏数据每字节映射成一个变体选择器，全都附在某个载体字符（如一个 emoji）后面，渲染时不显示，却随字符一起被复制。",
    usage: "编码把明文附加成变体选择器序列挂到载体后；解码把这些选择器还原成字节流。",
    examples: [
      { in: "载体😀 + 隐藏'A'", out: "😀︊…（选择器不可见）", desc: "每字节 → 一个变体选择器" },
    ],
    tips: ["一个 emoji「后面拖着」一长串看不见的东西 → 变体选择器隐写。单个字符能挂任意长度数据是它的特点。"],
    aka: ["变体选择器", "variation selector", "paul butler", "zwvarsel", "emoji变体隐写", "variation selector隐写", "vs隐写", "fe00隐写", "e0100隐写", "变体选择符", "emoji走私", "unicode变体选择器"],
  },

  emojiSubst: {
    what: "emoji 替换隐写：emoji-aes 的替换层，把 base64 的 64 个字符一一换成 emoji（外加几个），配一个 rotation 偏移。注意这里只做替换，不含 AES。",
    principle:
      "先把数据当 base64 看待，再拿一张 65 个 emoji 的码表替换 base64 字母表的每个字符，rotation 参数把码表整体旋转一定位数做简单混淆。解码就是反查码表 + 反旋转 → base64 → 原数据。",
    usage: "编码把文本转成 emoji 串；解码把 emoji 串还原（需对上 rotation）。",
    examples: [
      { in: "Hi", out: "🔬🌏🥋🗒", desc: "base64 字符逐个换成 emoji（65 符码表+rotation，实跑值）" },
    ],
    tips: ["看到「一串规律 emoji、数量像 base64」就试它。若真做了 AES 加密（emoji-aes 完整版），还需密钥，这里只解替换层。"],
    aka: ["emoji隐写", "emoji-aes", "emoji替换", "emojisubst", "表情符号隐写", "emoji encode", "emoji密码", "emoji cipher", "表情替换", "emoji base64", "颜文字隐写"],
  },

  tadpole: {
    what: "蝌蚪文：把明文包上一串阿拉伯文装饰符号（长得像小蝌蚪），带 checksum 校验，支持两种格式。",
    principle:
      "用 U+06D6–U+06EC 这段阿拉伯文装饰记号做载体，明文先编码再套上这些符号，附一个校验和防止抄错。另有 base64 双格式变体。解码剥掉装饰、验 checksum、还原明文。",
    usage: "编码把明文转成蝌蚪文；解码把蝌蚪文还原（会校验 checksum）。",
    examples: [
      { in: "A", out: " /ۤۧۢۡ۠ۤۤۤۚۤ " },
    ],
    tips: ["满屏阿拉伯文小记号、密密麻麻像蝌蚪 → 蝌蚪文。checksum 对不上说明串被改动过。"],
    aka: ["蝌蚪文", "tadpole", "阿拉伯装饰符隐写", "arabic diacritics隐写", "阿拉伯变音符号", "arabic marks", "小蝌蚪文字", "阿拉伯符号密码", "tadpole cipher", "arabic tadpole", "阿拉伯文隐写"],
  },

  textBlindWatermark: {
    what: "文本盲水印：guofei9987 的 text_blind_watermark（v1 JS 版格式）——把一段水印文字用零宽字符 U+200C 嵌进掩护文本，肉眼完全不可见，复制传播也不丢。防泄密溯源、CTF 零宽题常客。",
    principle:
      "水印逐字符转二进制（变长不补零，字符间以空格分隔、末尾再补一个空格），逐位映射：`1` = 1 个 U+200C、空格 = 2 个 U+200C（分隔符）、`0` = 不加；每一位消耗 1 个掩护字符（零宽串插在该字符后）。解码用状态机扫描：单 ZWNJ=1、双 ZWNJ=分隔、普通字符=0，再按空格切段还原。无密钥无加密，纯隐写。",
    usage: "encode: 水印 + 掩护文本 → 隐写文本（掩护文本长度需 ≥ 水印位数）；decode: 隐写文本 → 水印。",
    examples: [
      { in: "水印 flag + 任意掩护文本", out: "外观不变的掩护文本（内藏 U+200C）", desc: "flag → 1100110 1101100 1100001 1100111 加分隔共 32 位" },
    ],
    tips: ["与「零宽字符隐写」（Misawa radix-4 定长）格式互不兼容，互解不通。原版解码器对掩护残余段会多输出隐形 U+0000 尾巴，本实现已修；BMP 外字符按 UTF-16 码元拆编，成对码元可完整还原。"],
    aka: ["文本盲水印", "text blind watermark", "textBlindWatermark", "文本隐水印", "盲水印", "guofei9987", "零宽盲水印", "text watermark", "文字隐水印", "隐形水印", "文本隐形水印", "zwnj隐写", "郭飞盲水印"],
  },
};
