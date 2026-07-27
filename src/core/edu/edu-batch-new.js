/*
 * edu/edu-batch-new.js — 本轮新增 op 的科普卡分片（能力补齐 + emoji 逆向）。
 *
 * 覆盖 9 个 op：txtmoji / godzillaPhpXorBase64 / behinderAesEcb / byteReverse /
 *   base32steg / pbeAesBrute / bin2img / imgFft / bmpSizeRecover。
 * 格式契约见 eduContent.js 头注（纯数据，无 import/副作用，aka 兼作搜索别名）。
 */
export default {
  // ============ emoji 加密 ============
  txtmoji: {
    what: "txtmoji.com 那种「一串表情符号」的加密：本质是 AES 加密后把 base64 密文换成 emoji。CTF 里常配「标题即密码」出题。",
    principle:
      "底层是标准 CryptoJS.AES（OpenSSL `Salted__` 格式 + EVP_BytesToKey(MD5) 派生 + AES-256-CBC）。\n\n" +
      "加密后的 base64 密文恒以 `U2FsdGVkX1`(即 `Salted_` 的 base64) 开头，站点把这 10 个固定字符切掉，剩余每个字符按一张 65 项 emoji 表替换成表情；解密时先把 emoji 还原成字符、补回 `U2FsdGVkX1` 前缀，再走 AES 解密。\n\n" +
      "每次加密带随机 salt，所以同明文同密码每次密文都不同。",
    usage:
      "解码方向：填密码（CTF 里常是题目标题的十进制数，如 0x36d→877），粘表情串，一键还原明文。\n" +
      "编码方向：填密码 + 明文，生成 emoji 串。一键解码时在密码框填对密码也能自动解出。",
    examples: [
      { in: "😫🙄👰…（54 个表情）", param: "密码 877", out: "ctfshow{emoji_is_funny}", desc: "ctfshow 0x36d 真题，标题十进制当密码" },
    ],
    tips: [
      "看到「纯表情符号 + 提示标题是数字」几乎就是它，密码优先试标题的十进制。",
      "算法本身接受任意口令，txtmoji.com 的 UI 只是限制了输入十进制。",
      "和 emoji-aes（Aaron Horler）同属 AES+emoji 替换，但表和前缀处理不同，别混用。",
    ],
    aka: ["txtmoji", "emoji加密", "表情加密", "表情符号密码", "emoji aes", "颜文字加密", "emoji cipher", "表情符号编码", "emoji隐写", "emoji-aes", "表情密码", "文字转表情"],
  },

  // ============ webshell 流量解密预设 ============
  godzillaPhpXorBase64: {
    what: "哥斯拉(Godzilla) webshell 的 PHP_XOR_BASE64 流量解密预设。CTF Web/流量取证里认出哥斯拉流量后一键还原。",
    principle:
      "哥斯拉 PHP_XOR_BASE64：`payload = base64( 明文 XOR key )`，异或用逐字节偏移 `key[(i+1) & 15]`（哥斯拉特有，不是标准的 `i % len`）。\n\n" +
      "默认 key `3c6e0b8a9c15224a` = `md5(\"key\")[:16]`（连接密码「key」的派生值）。",
    usage: "解码方向粘 base64 流量 + 填 key（默认已填站点默认值），还原明文；编码方向做反向。key 可改成题目实际连接密码的 md5[:16]。",
    examples: [
      { in: "base64 密文", param: "key=3c6e0b8a9c15224a", out: "webshell 明文命令/回显" },
    ],
    tips: [
      "抓到哥斯拉流量先试默认 key；换了连接密码就填 md5(密码)[:16]。",
      "XOR 偏移是 (i+1)&15 不是 i%len，用通用 XOR 解不出别慌，用这个预设。",
    ],
    aka: ["godzilla", "哥斯拉", "webshell", "php_xor_base64", "冰蝎哥斯拉", "流量解密", "哥斯拉webshell", "godzilla shell", "PHP木马解密", "PHP_XOR_BASE64", "哥斯拉流量", "godzilla解密"],
  },

  behinderAesEcb: {
    what: "冰蝎(Behinder) v3 默认 AES 流量解密预设。CTF Web/流量取证里认出冰蝎流量后一键还原。",
    principle:
      "冰蝎 v3 默认走 `base64( AES-128-ECB(明文, key) )`。默认 key `e45e329feb5d925b` = `md5(\"rebeyond\")[:16]`（作者默认连接密码 rebeyond 的派生值）。",
    usage: "解码方向粘 base64 流量 + 填 16 字节 key（默认已填），AES-ECB 还原明文；编码方向做反向。",
    examples: [
      { in: "base64 密文", param: "key=e45e329feb5d925b", out: "webshell 明文" },
    ],
    tips: [
      "冰蝎 v3 默认密钥来自 md5('rebeyond')[:16]；换密码则填 md5(新密码)[:16]。",
      "冰蝎 v4 起密钥协商更复杂，本预设针对 v3 固定 key 场景。",
    ],
    aka: ["behinder", "冰蝎", "webshell", "aes-ecb", "rebeyond", "流量解密", "冰蝎马", "behinder shell", "冰蝎webshell", "AES ECB webshell", "冰蝎流量", "behinder解密"],
  },

  // ============ 二进制/字节变换 ============
  byteReverse: {
    what: "把整个字节流首尾颠倒（File-Reverse）。misc/取证里「文件被整体倒放」的经典还原。",
    principle:
      "区别于 byteSwap（按 2/4/8 字节定长分组做端序反转），本 op 是把整串字节整体首尾翻转：第 1 字节和最后 1 字节对调，依此类推。自逆——再倒一次还原。",
    usage:
      "文本模式：文本 → UTF-8 字节整串倒序 → Hex；Hex 模式：Hex ↔ Hex 整串倒序（自逆，最常用于二进制文件字节流反转）。",
    examples: [
      { in: "48656c6c6f", param: "Hex 模式", out: "6f6c6c6548", desc: "\"Hello\" 的字节整串倒序" },
    ],
    tips: [
      "文件头魔数出现在结尾（如结尾是 474e5089=反过来的 PNG 头 89504e47），多半整个文件被倒放了。",
      "和「按分组端序反转」不同：这是整串翻转，不分组。",
    ],
    aka: ["file reverse", "字节倒序", "整串倒序", "文件倒放", "reverse bytes", "byte reverse", "整串反转", "倒序字节", "byte flip", "字节反转", "数据倒序"],
  },

  // ============ Base32 隐写 ============
  base32steg: {
    what: "Base32 padding 位隐写：把秘密比特藏在 Base32 编码每行末字符的「冗余位」里。Base64 隐写的 Base32 版。",
    principle:
      "Base32 每 5 位一个字符，当编码数据不是 5 位整数倍时，末字符会有几个「不影响解码」的冗余低位（体现为 `=` padding 的个数）。把秘密比特写进这些冗余位，正常 Base32 解码看不出异常，专门比对「规范重编码」与实际末字符的差值才能取出。",
    usage: "解码方向：粘多行带 padding 的 Base32 文本，自动逐行取冗余位拼出隐藏信息；编码方向：把秘密写进构造出的 Base32 载体。",
    examples: [
      { in: "多行 Base32（末字符含隐藏位）", out: "flag{...}", desc: "逐行末字符冗余位拼接" },
    ],
    tips: [
      "看到一堆带不同 padding 的 Base32 行、正常解码却是无意义内容，怀疑 padding 位隐写。",
      "和 base64steg 同理，只是分组从 6 位换成 5 位。",
    ],
    aka: ["base32 隐写", "base32 steg", "padding隐写", "base32 stego", "Base32隐写", "零宽Base32", "Base32 steganography", "base32填充隐写", "Base32冗余位", "b32隐写"],
  },

  // ============ 口令爆破 ============
  pbeAesBrute: {
    what: "PBKDF2 + AES 的口令字典爆破。针对 `openssl enc -aes-256-cbc -pbkdf2` 这类「口令派生密钥」的密文。",
    principle:
      "PBE(Password-Based Encryption)：用口令经 PBKDF2 派生出 AES 密钥再加密。爆破时逐个试口令字典，每个口令走 PBKDF2 派生 key → AES 解密 → 用 crib（已知明文特征）或高可打印率判断是否命中。",
    usage:
      "输入密文(hex/base64)，填 salt、迭代次数、AES 位数/模式、crib（如 `flag\\{`），口令字典留空用内置弱口令表、或自己粘多行字典。命中即报口令 + 明文。",
    examples: [
      { in: "hex 密文", param: "salt + 迭代 + crib=flag\\{", out: "口令=letmein → flag{...}" },
    ],
    tips: [
      "openssl 默认 PBKDF2 迭代 10000，salt 在密文 `Salted__` 头后 8 字节。",
      "内置字典只有常见弱口令，真题可能要导入更大字典。",
    ],
    aka: ["pbe爆破", "pbkdf2 brute", "aes口令爆破", "openssl enc爆破", "password brute", "PBE爆破", "OpenSSL EVP", "PBEWithMD5AndDES", "salted__", "口令密钥爆破", "openssl盐值爆破"],
  },

  // ============ 图像生成/分析 ============
  bin2img: {
    what: "把一串 0/1 位流渲染成黑白点阵图。misc 里「一大串二进制」按宽度排开常常拼出 flag 文字或二维码。",
    principle: "把 0/1 按指定宽度换行排成矩阵，1=黑 0=白（可反色），每个 bit 放大成 N×N 像素块，输出 PNG。宽度留空时自动取近似正方形。",
    usage: "粘 0/1 位流，设宽度（留空自动）、放大倍数、是否反色，输出可下载的 PNG。看图形是否成字/成码。",
    examples: [
      { in: "010011010…（长 0/1 串）", param: "宽度=32", out: "黑白点阵 PNG", desc: "常拼出 flag 文字/二维码" },
    ],
    tips: [
      "位数最好是某个宽度的整数倍；试几个宽度（如 total 的因数）能让图形对齐。",
      "出来是噪声就试反色，或换宽度。",
    ],
    aka: ["二进制转图片", "bit转图", "01转图片", "bits to image", "binary image", "bin2img", "字节可视化", "binary to image", "数据图像化", "二进制可视化", "01串转图"],
  },

  imgFft: {
    what: "对图像做 2D 傅里叶变换看幅度谱。CTF 频域隐写经典：flag 直接画在频谱里，空间域看着正常，做 FFT 才现形。",
    principle:
      "把图灰度化后重采样到 2 的幂尺寸，做行列可分离的 2D FFT，取 `log(1+|F|)` 幅度谱，再 fftshift 把低频移到中心，归一化成灰度图。频域里嵌入的对称亮点/文字就会显现。",
    usage: "拖入 PNG/BMP，输出幅度谱 PNG。看频谱中心以外有没有文字/规则图案。",
    examples: [
      { in: "一张看似正常/噪声的图", out: "幅度谱 PNG（flag 文字现形）" },
    ],
    tips: [
      "空间域看不出、题目暗示「频域/傅里叶/FFT」就用它。",
      "幅度谱的文字通常中心对称出现两份（FFT 共轭对称性）。",
    ],
    aka: ["图像fft", "傅里叶频谱", "频域隐写", "2d fft", "fourier", "频谱图", "image fft", "傅里叶变换", "频域分析", "spectrum", "2D傅里叶", "图像频谱"],
  },

  bmpSizeRecover: {
    what: "BMP 宽高被改后的修复。BMP 没有 CRC 校验，靠「像素数据字节数」反推真实宽高。改高度藏图的 BMP 版。",
    principle:
      "BMP 每行按 4 字节对齐（rowSize = ⌈bpp×宽/32⌉×4）。可用像素字节数 = 文件尾 − 数据偏移。枚举宽度使 `像素字节数 % rowSize == 0`，即得高度。优先保声明宽度爆高度、保高度爆宽度，再枚举兜底。",
    usage: "拖入 BMP，自动检测宽高与像素数据量是否一致，不一致则反推真实宽高并输出修复后的 base64。",
    examples: [
      { in: "宽高被改的 24 位 BMP", out: "修复后 BMP（真实宽高）+ 反推报告" },
    ],
    tips: [
      "BMP 无 CRC，改宽高不会像 PNG 那样报错，要靠数据量反推。",
      "配合 PNG 宽高爆破恢复(pngSizeRecover)，覆盖两大改尺寸藏图套路。",
    ],
    aka: ["bmp修复", "bmp宽高", "fix bmp", "bmp尺寸修复", "改宽高藏图", "BMP尺寸修复", "bmp size fix", "宽高爆破", "BMP高度修复", "bmp header repair", "BMP宽高修复"],
  },
};
