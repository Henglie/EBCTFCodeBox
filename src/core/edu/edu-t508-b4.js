/*
 * edu-t508-b4.js — T508 批四·工程编码组 E1/E3/E4/E5/E6/E9 科普卡（engEncoding.js）。
 * hexdump / modhex / citrixCtx1 / scriptDecoder / rison / unixPerms
 * 示例输出全部来自实跑（资料/工程留存/T508/批4_工程编码/test.mjs 同口径），无编造。
 */
export default {
  hexdump: {
    what: "Hexdump（十六进制转储）——把字节流按行展开成「偏移: 十六进制 + ASCII」三栏的经典视图，逆向工程与取证的标准语言。本工具的编码方向按 xxd 默认格式逐字节输出（与 Git Bash xxd 实测 diff 为空），解码方向能把 xxd / hexdump -C / CyberChef 等常见格式的转储文本还原成原始数据。",
    principle:
      "每行三栏：\n\n" +
      "1. 偏移栏：本行第一个字节在文件中的位置，8 位十六进制（第 $k$ 行 = $k \\times$ 行宽）；\n" +
      "2. 十六进制栏：每字节两位 hex，**两字节一组**（xxd 特色，4 个 hex 字符一组，组间单空格）；\n" +
      "3. ASCII 栏：可打印字节（0x20-0x7E）原样显示，其余一律显示 `.`。\n\n" +
      "短行的十六进制栏会补空格，让 ASCII 列始终对齐在同一列。解码方向反过来：剥掉偏移、按 token 收集十六进制对——遇到**连续两个空格**就停（那是 ASCII 列的边界，防止把 ASCII 里的 `abcdef` 误当数据）；`*` 行表示上一行重复出现（xxd -a / hexdump 的压缩写法），按下一行偏移差补齐重复次数。",
    usage: "编码：粘贴任意文本（按 UTF-8 转字节），默认 16 字节/行、小写，可调行宽（1-512）与大写。解码：粘贴任意常见格式的转储文本即可，格式自动识别。对拍利器：Git Bash 自带 xxd——`echo -n 文本 | xxd` 的输出应与工具编码结果完全一致；`xxd -r` 可反向验证解码。",
    examples: [
      { in: "CTF{hex_dump!}", param: "默认 16 字节/行", out: "00000000: 4354 467b 6865 785f 6475 6d70 217d       CTF{hex_dump!}", desc: "与 xxd 输出逐字节一致（短行自动补齐 ASCII 列）" },
      { in: "00000000: 5468 6520 7175 6963 6b20 6272 6f77 6e  The quick brown", param: "解码方向", out: "The quick brown", desc: "从 xxd 转储还原文本" },
    ],
    tips: [
      "ASCII 列是给人看的冗余信息，真正的数据在十六进制栏——手抄 hexdump 时抄 hex 区就够。",
      "常见坑：ls -l 看到 `-rw-r--r--`，xxd 短行 ASCII 列前有一大串空格——工具按「双空格」识别列边界，别手动删。",
      "纯 hex 字符串（无偏移无 ASCII）请用 Hex 编码类 op，别用本 op 解码（会按数据行误判）。参考 https://wikipedia.org/wiki/Hex_dump 。",
    ],
    aka: ["hexdump", "十六进制转储", "hex dump", "xxd", "xxd 格式", "hex view", "十六进制视图", "hex 转储", "十六进制 dump", "hexdump -C", "od 风格转储", "十六进制列表"],
  },

  modhex: {
    what: "Modhex——YubiKey 专用的「键盘布局无关十六进制」：把 0-f 十六个数字换成 cbdefghijklnrtuv 十六个字母。YubiKeyOTP 的 Token ID、公钥模数等都是 modhex 字符串，CTF 里见到 `cccccc…` 开头的奇怪小写串就要想到它。",
    principle:
      "YubiKey 模拟键盘发码，而各国键盘布局对同一按键发出的字符不同。挑出的这 16 个字母（c b d e f g h i j k l n r t u v）在 QWERTY / AZERTY / QWERTZ / Dvorak 等主流布局下都落在同样的物理按键上，所以无论插在哪国键盘上都读出同一串字符。\n\n" +
      "编码就是逐位替换：字节 → 两位 hex → 查表换成两位 modhex。对照表（hex → modhex）：\n\n" +
      "`0→c 1→b 2→d 3→e 4→f 5→g 6→h 7→i 8→j 9→k a→l b→n c→r d→t e→u f→v`\n\n" +
      "例：字节 0xE6 → `e6` → `uh`。中文等多字节文本按 UTF-8 展开成字节流再逐字节替换。",
    usage: "双向即贴即用：加密方向吃任意文本（UTF-8），解密方向大小写不敏感、自动容忍空格/冒号/逗号等常见分隔符。YubiKey 官方 OTP 解码示例（ modhex → hex → 字节）即本表。",
    examples: [
      { in: "hello", param: "默认无分隔", out: "hjhghrhrhv", desc: "h→hg、e→hg… 逐字节两位替换" },
      { in: "uhkgkbuhkgkbugltlkugltkc", param: "解密方向", out: "救救孩子", desc: "CyberChef 测试向量：modhex → UTF-8 中文" },
      { in: "aberystwyth", param: "默认", out: "hbhdhgidikieifiiikifhj", desc: "CyberChef 测试向量" },
    ],
    tips: [
      "识别特征：整串只由 cbdefghijklnrtuv 这 16 个小写字母组成——特别注意没有 a、m、o、p、q、s 这些常见字母。",
      "YubiKey OTP 固定 32 字节 modhex：前 12 字符是 Token ID，后跟计数器+随机数+CRC。",
      "大小写混写（如 `uhKGkb`）照样能解；长度为奇数会报错提醒漏抄。参考 https://en.wikipedia.org/wiki/YubiKey#ModHex 。",
    ],
    aka: ["modhex", "modhex 编码", "yubikey 编码", "yubikey modhex", "modified hexadecimal", "mod hex", "键盘布局无关十六进制", "yubico modhex", "modhex 解码", "modhex 转换", "yubikey 十六进制", "cbdefghijklnrtuv"],
  },

  citrixCtx1: {
    what: "Citrix CTX1——Citrix（思杰）在客户端保存密码用的轻混淆编码：结果是一串 A-P 的字母（每 4 个字母对应 1 个明文字符）。在 .ica 文件、Citrix Web Interface 配置、注册表 Autologon 里常见，安全审计经常要还原它。",
    principle:
      "两步：\n\n" +
      "1. 明文按 UTF-16LE 展开成字节流（每字符 2 字节，中文占 2 对）；\n" +
      "2. 链式异或：$temp_i = b_i \\oplus \\mathrm{0xA5} \\oplus temp_{i-1}$（$temp$ 初值 0）——每一步都掺进上一步的结果，所以同一位明文字节在不同位置密文不同；\n" +
      "3. 每个 $temp$ 拆高/低半字节，各加 0x41 映射成 `A`-`P` 两个字母（高半字节在前）。\n\n" +
      "解码全程反演：两位一组还原 $val$，$b_i = val_i \\oplus \\mathrm{0xA5} \\oplus val_{i-1}$，再按 UTF-16LE 拼回字符串。密文长度必为 4 的倍数。",
    usage: "无参数双向。密文只认 A-P（大小写均可）。想手推校验：明文 `P`（0x50）→ 第一步 temp=0x50⊕0xA5=0xF5 → 输出 `PF`；第二字节 0x00 → temp=0xA5⊕0xF5=0x50 → 输出 `FA`，合起来 `PFFA`。",
    examples: [
      { in: "Password1", param: "编码", out: "PFFAJEDBOHECJEDBODEGIMCJPOFLJKDPKLAO", desc: "CyberChef 官方测试向量（9 字符 → 36 字母）" },
      { in: "PFFAJEDBOHECJEDBODEGIMCJPOFLJKDPKLAO", param: "解码", out: "Password1", desc: "官方向量反向还原" },
    ],
    tips: [
      "识别特征：密文全部落在 A-P 区间、长度是 4 的倍数——比 base64 字符集窄得多。",
      "这不是加密只是编码（无密钥），拿到就能还原，审计报告里直接标「明文等价存储」。",
      "链式异或让重复字符的密文不重复，所以不能按单字母频率硬猜。参考 CyberChef Citrix CTX1 Encode/Decode（ reddit r/AskNetsec 帖原始算法说明）。",
    ],
    aka: ["citrix ctx1", "ctx1", "citrix 密码编码", "citrix password encoding", "思杰密码", "ctx1 encode", "ctx1 decode", "citrix ctx1 解码", "citrix 凭据解码", "ica 密码", "citrix autologon", "citrix 哈希"],
  },

  scriptDecoder: {
    what: "Microsoft Script Decoder（scrdec）——还原微软「编码脚本」：VBScript/JScript 用 screnc.exe 加密后改扩展名为 .vbe / .jse，文件内容是一坨 `#@~^…^#~@` 包着的乱码。恶意邮件附件、钓鱼落盘文件里常见，取证必备。",
    principle:
      "格式：`#@~^` + 6 字符长度标记 + `==` + 编码体 + 6 字符 + `==` + `^#~@`（解码时长度标记不校验）。\n\n" +
      "解码体两步：\n\n" +
      "1. 逃逸替换：`@&`→换行 `@#`→回车 `@*`→`>` `@!`→`<` `@$`→`@`；\n" +
      "2. 查表替换：每个「可解码字符」（TAB 与 32-127 中除 `<` `>` `@` 外的字符）查 128 行 × 3 列的替换表，取哪一列由一个 64 步循环的组合序列按位置决定——同一个密文字符在不同位置解出不同明文，这就是它抗肉眼看穿的核心。\n\n" +
      "位置计数只数 ASCII 字符（非 ASCII 透传且不计数），逃逸替换后的 CR/LF 各记 1 位。",
    usage: "单向解码：把 .vbe/.jse 文件全文粘进来即可，工具自动定位 `#@~^…==…==^#~@` 编码块。解出的就是明文 VBS/JS 源码。",
    examples: [
      { in: "#@~^RQAAAA==-mD~sX|:/TP{~J:+dYbxL~@!F@*@!+@*@!&@*eEI@#@&@#@&\u007fjm.raY 214Wv:zms/obI0xEAAA==^#~@", param: "无参", out: "var my_msg = \"Testing <1><2><3>!\";\r\n\r\nWScript.Echo(my_msg);", desc: "CyberChef 官方测试向量（MS.mjs）" },
    ],
    tips: [
      "识别特征：文件开头就是 `#@~^`——这是 JScript.Encode/VBScript.Encode 的标志头。",
      "样本若来自 real world，可能有多个编码块（include 场景）；本工具按 CyberChef 同款正则取第一个可匹配块。",
      "拿到解码后的 VBS 别急着跑——典型下一步是找 DownloadString/ShellExecute 之类的 IOC。参考 https://wikipedia.org/wiki/JScript.Encode 与 Didier Stevens 的 scrdec 原始实现。",
    ],
    aka: ["microsoft script decoder", "scrdec", "vbe 解码", "jse 解码", "vbe 解密", "jse 解密", "screnc 逆", "脚本解码", "jscript encode 解码", "vbscript encode 解码", "微软编码脚本还原", "encoded script decoder"],
  },

  rison: {
    what: "Rison——「URL 友好的紧凑 JSON」：表达完全相同的数据结构，但比 URL 编码后的 JSON 短 35-45%（Freebase 实测），且几乎不用 %-转义。REST 查询参数里见到 `(q:'*',start:10)` 这种带括号冒号的串就是它。",
    principle:
      "token 对照 JSON：`(`=`{` 对象、`!(`=`[` 数组、`!t`/`!f`=true/false、`!n`=null、`'`=`\"` 引号、`!`=反斜杠转义。\n\n" +
      "- 标识符免引号：不含 `' ! : ( ) , * @ $` 和空格、且不以 `-` 或数字开头的字符串直接裸写；\n" +
      "- 引号串里只需转义 `'` 和 `!`（写成 `!'` 与 `!!`）；\n" +
      "- 数字是 JSON 子集：指数用 `e`/`E`，禁 `+`（URI 里不安全），`-` 保留；\n" +
      "- 无任何空白；对象编码时键按字典序输出（URL 缓存友好）；\n" +
      "- 变体：O-Rison 省掉对象括号（`a:1,b:2`）、A-Rison 省掉数组 `!()`（`a,b,c`）、URI 模式再做一层宽松 URL 引用（空格→`+`）。\n\n" +
      "注意：任务里流传的「~ 查找表压缩」「!1 数组短写」并不存在于权威规范（Nanonid/rison），本工具按真规范实现。",
    usage: "编码方向吃 JSON 文本（值/O/A/URI 四档）；解码方向输出缩进 JSON。嵌套、空串 `''`、负数、小数、指数都支持；坏转义/未闭合/尾随多余字符会带位置报错。",
    examples: [
      { in: "{\"any\":\"json\",\"yes\":true}", param: "值模式", out: "(any:json,yes:!t)", desc: "规范首页示例" },
      { in: "{\"supportsObjects\":true,\"ints\":435}", param: "O-Rison", out: "ints:435,supportsObjects:!t", desc: "键自动按字典序排（规范示例）" },
      { in: "[\"A\",\"B\",{\"supportsObjects\":true}]", param: "A-Rison", out: "A,B,(supportsObjects:!t)", desc: "数组裸列 + 嵌套对象（规范示例）" },
      { in: "(name:'Tom',tags:!(a,b),ok:!t)", param: "解码", out: "{\n  \"name\": \"Tom\",\n  \"tags\": [\n    \"a\",\n    \"b\"\n  ],\n  \"ok\": true\n}", desc: "嵌套结构还原为缩进 JSON（实跑输出）" },
    ],
    tips: [
      "快速识别：URL 参数里出现裸括号/感叹号/冒号组合（`!(`、`:!t`）——%-编码过的就先 URL 解码再看。",
      "和 JSON5/PSON 的区别：rison 是「JSON 严格子集语义」只改写法，无注释无尾逗号。",
      "编码会重排键序——往返 JSON 时对象键顺序会变（内容不变）。参考 https://github.com/Nanonid/rison 。",
    ],
    aka: ["rison", "rison 编码", "rison decode", "rison encode", "紧凑 json", "url json", "rison json", "o-rison", "a-rison", "orison", "arison", "url 序列化 json", "rison 解码"],
  },

  unixPerms: {
    what: "UNIX 文件权限——`ls -l` 每行开头那 10 个字符（`-rwsr-xr-t`）与 chmod 数字（`4755`）的互转报告：属主/属组/其他各 3 位读写执行 + 3 个特殊位 setuid/setgid/sticky。取证看 webshell 权限、运维写部署脚本都用得上。",
    principle:
      "9 个基本位分三组（u 属主 / g 属组 / o 其他），每组 rwx 按位对应 $4+2+1$：`rwxr-xr-x` = $(4{+}2{+}1)(4{+}1)(4{+}1) = 755$。\n\n" +
      "第四位特殊位同样是加法：setuid=4（执行时换成文件属主身份）、setgid=2（换属组；用在目录上则新文件继承属组）、sticky=1（只有属主能删目录内文件，`/tmp` 就是 1777）。所以 `4755` = setuid + 755。\n\n" +
      "符号形的特殊位挤在执行位上：有执行显示 `s`/`t`，无执行显示大写 `S`/`T`——如 4644 → `rwSr--r--`（有 setuid 无执行）。开头类型位：`-` 普通文件 `d` 目录 `l` 链接 `c`/`b` 设备 `p` 管道 `s` 套接字。",
    usage: "run 型报告：输入任意一种形态（755 / 0755 / 4755 / rwxr-xr-x / drwxr-xr-t / -rwSr--r--），输出全部形态互转：符号形、带类型位、3/4 位八进制、二进制位、chmod 数字命令与符号命令、特殊位说明、各身份明细。",
    examples: [
      { in: "755", param: "无参", out: "符号形（9 位）：rwxr-xr-x\n带类型位（10 位）：-rwxr-xr-x\n八进制（4 位，含特殊位）：0755\n二进制位：111 101 101\nchmod 命令：chmod 0755 文件\n符号 chmod：chmod u=rwx,g=rx,o=rx 文件\n特殊位：无（setuid / setgid / sticky 均未设置）", desc: "实跑报告节选（完整报告还含各身份明细）" },
      { in: "4755", param: "无参", out: "符号形（9 位）：rwsr-xr-x\nchmod 命令：chmod 4755 文件\n特殊位（八进制首位 4）：setuid——以文件属主身份执行", desc: "setuid 挤进属主执行位变 s（实跑节选）" },
      { in: "drwxrwxrwt", param: "无参", out: "八进制（4 位，含特殊位）：1777\n文件类型：目录（d）\n特殊位：sticky——仅属主可删改目录内文件，典型如 /tmp", desc: "/tmp 的真实权限（实跑节选）" },
    ],
    tips: [
      "见到 `s` 先想提权：setuid 的可执行文件（如旧版 `4755` 的 nmap）是经典提权扫描目标。",
      "大写 `S`/`T` = 有特殊位但没有执行位——多半是配置失误，真实场景里 chmod 后忘加 x 就长这样。",
      "数字读法：三位就补前导 0（755=0755），四位首位是特殊位不是属主！参考 https://en.wikipedia.org/wiki/File_system_permissions 。",
    ],
    aka: ["unix 文件权限", "linux 文件权限", "file permissions", "chmod 计算", "权限转换", "rwx 转换", "八进制权限", "chmod 数字", "setuid", "setgid", "sticky bit", "权限位", "ls -l 权限", "4755 权限"],
  },
};
