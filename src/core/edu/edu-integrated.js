// Verified integration notes; patches are merged by op key without replacing other entries.
export const ZH = {
  foyu: {
    what: "佛曰：keyfc 与佛论禅 V1 的文本变换，不再使用旧版自创的 Base64 换字方言。",
    principle: "明文按UTF-16LE编码、PKCS7补位、固定密钥AES-256-CBC加密；每字节映射到128字表，高位用12种等价标记之一表示。协议资料来自 TudouCode 及其同源移植，不把多个移植计作多个独立权威。",
    usage: "编码输入消息；解码输入以「佛曰：」开头的密文。V2如是我闻不支持。高位标记随机，所以同一消息的字面输出可以不同。",
    examples: [{ in: "佛曰：冥切他冥苦冥大怛冥滅冥輸冥尼亦冥吉遠冥上冥室冥遠冥遮究", out: "hello", param: "decode" }],
    tips: ["固定公开密钥不提供秘密保护，不能用于保密。", "空消息编码只有前缀；解码纯前缀明确报空密文。旧自创方言不保证兼容，无自动双读。", "参考：https://github.com/lersh/TudouCode"],
    aka: ["keyfc", "与佛论禅", "佛曰原版", "TudouCode", "tudou V1", "佛曰 AES", "佛曰解码", "佛曰编码", "佛曰 UTF-16LE", "keyfc tudou"],
  },
  snow: {
    what: "SNOW（Steganographic Nature Of Whitespace，Matthew Kwan）在文本行尾隐藏消息；不是Whitespace编程语言。",
    principle: "TAB标记载荷起点；三比特经位反转映射为空格段与TAB分隔，TAB按8列推进，不是「空格=0、TAB=1」。可选Huffman压缩及ICE的1-bit CFB加密。",
    usage: "主输入是秘密消息，text参数是容器文本。password默认空、compress默认关闭、lineLength默认80。解码保留原行尾空白，密码与压缩选项须一致。",
    examples: [{ in: "\t      \t  \t\t   \t \t \n", out: "hi", param: "decode; compress=false; password=空" }],
    tips: ["参考：https://www.darkside.com.au/snow/", "不要删行尾空白。Windows原版EXE对含CR/LF的二进制载荷存在文本模式I/O损伤边界，不承诺所有二进制载荷无损互通。"],
    aka: ["SNOW隐写", "snow stego", "行尾空白隐写", "whitespace steganography", "trailing whitespace", "Matthew Kwan", "ICE隐写", "snow.exe", "TAB隐写", "Steganographic Nature Of Whitespace"],
  },
  zeroWidth: {
    what: "Kei Misawa 的radix-N文本隐写；保留三档预设，并支持自定义字符集。",
    principle: "逐UTF-16码元转换为定长N进制数字，再映射到所选字符。默认U+200C/U+200D/U+202C/U+FEFF，共8字符承载一个码元。载体插入次序是确定性的，与原作者随机混排字面不同，但同字符集下恢复消息。",
    usage: "主输入是秘密消息，cover是可见载体；customChars非空优先于charset。接受2..36个不重复BMP字符，默认限制不可见字符；高级allowNonInvisible可允许可见字符。",
    examples: [{ in: "A", out: "0000000001000001", param: "encode; customChars=01; allowNonInvisible=true; cover=空" }],
    tips: ["自定义字符的顺序必须一致。载体不能包含编码字表中的字符。", "无载荷、残缺分组和溢出码元均报错。此入口不提供原作者Binary-in-Text模式。", "字符过滤会损伤载荷；不把所有Unicode规范化都说成必然删除零宽字符。参考：https://330k.github.io/misc_tools/unicode_steganography.html"],
    aka: ["Misawa文本隐写", "自定义零宽字符集", "custom zero width alphabet", "Kei Misawa", "radix N隐写"],
  },
  scytale: {
    what: "Scytale栅格转置：支持按栏数或每栏字数解释密钥；每档不是新的加密算法。",
    principle: "按行填入矩形、按列读出；保留现有竖线补位格式。解码返回完整格子，不再删除真实竖线。密文没有原长信息，末尾竖线与补位无法自动区分。",
    usage: "column是正安全整数，keyMode选择column或perCol。默认栏数2。补位密文长度须可被密钥整除；空输入直接返回，非空最多100万格。",
    examples: [{ in: "a|b|", out: "ab||", param: "encode; column=2; keyMode=column" }],
    tips: ["原版具体工具的补位默认与独立互通仍待来源核验；本次修正本地数据删除与资源边界，不冒称原站对拍完成。"],
  },
  gifFrames: {
    what: "GIF多帧提取：逐帧合成、生成压缩PNG，最终一次下载一个ZIP。",
    principle: "LZW解码、调色板、帧偏移、透明和处置合成；每帧立即编码，不再保留全帧RGBA快照数组。PNG的IDAT用zlib压缩，ZIP内包含frame_*.png和frames.txt。",
    usage: "拖入GIF，maxFrames=0默认全部；显式设置N只导出前N帧并标注部分。上限4096帧、输入32MiB、单画布/帧4194304像素、累计536870912像素、30秒、ZIP128MiB；超限或失败不交付不完整包。",
    examples: [{ in: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=", out: "gif_frames.zip", desc: "1×1单帧GIF；下载ZIP含frame_001.png及frames.txt，不是把这段文件名当作PNG内容。" }],
    tips: ["显式前N帧与完整动画不同；后续帧未扫描时不猜总帧数。", "同一JS实例只执行一个GIF提取任务：新请求取消旧请求，待旧任务释放后开始；取消不交付ZIP。这同样适用于配方和MCP调用。", "解码合成遵循当前透明背景策略，尚未声明所有处置方言与全部查看器等价。"],
  },
  mcMapRender: { usage: "载入map_#.dat，选择scale；完整分辨率PNG由下载按钮保存，文本内长边≤256px的图仅作缩略预览。", tips: ["提取二维码或像素数据请使用完整PNG，不要使用缩略图。"] },
  lsbEmbed: { usage: "载入PNG/BMP封面，设置payload、通道、位平面和位序；完整隐写PNG由下载按钮保存。缩略预览不能替代原图用于提取。", tips: ["用zstegScan按同参数导出或扫描载荷。"] },
  deepsoundExtract: { usage: "载入支持的WAV并在需要时填写密码；全部提取文件逐个下载。文本只给有界预览，不再输出截断Base64冒充完整文件。", tips: ["原字节在files中；二进制不作文本预览，预览截断不会截断下载件。"] },
  zstegScan: { usage: "exportCombo为空时扫描；复制报告中的组合如bit3 r msb，或填写bit=3&channel=r&order=msb&traversal=row，重新从像素导出原始字节。exportMaxBytes默认65536，允许1..1048576。", tips: ["下载包括该组合的填充字节，不自动猜载荷原长；超限明确标注截断。"] },
  stegoQuickScan: {
    what: "图片隐写快速分析：一次检查PNG/JPEG/GIF的结构、元数据和尾随数据。",
    principle: "复用图像字节工具，按格式有界遍历；JPEG熵编码区处理填充与重启标记，不把压缩数据当坏marker。未检出不等于无隐写。",
    usage: "拖入文件，或选择Base64/Hex输入。最多8MiB输入、4096结构步；元数据每段预览96字节、尾随最多256字节。",
    examples: [{ in: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=", out: "Trailing bytes: 0", desc: "报告中的尾随结论；不会执行LZW解码。" }],
    tips: ["LSB、位平面、密码、解释器、本机桥、像素及全部校验和未运行。压缩元数据不解压。异常与预算中止在报告中明确标识。"],
    aka: ["圆柱密码", "斯巴达密码棒", "斯巴达", "图片隐写快速分析", "图片隐写聚合", "stego quick scan", "image steganography scan", "PNG结构扫描", "JPEG结构扫描", "GIF结构扫描", "尾随数据检查", "图片元数据检查", "轻量隐写分析", "image trailing data", "stegoQuickScan"],
  },
  b64urlJson: { what: "Base64url与JSON互转及美化，属于数据转换，不是加密或JWT签名验证。", tips: ["能读出JWT载荷不代表签名有效；不要据此信任身份或权限声明。"] },
};

export const EN = {
  foyu: { what: "keyfc / TudouCode V1, replacing the old custom Base64 substitution.", principle: "UTF-16LE, PKCS7, fixed-key AES-256-CBC, a 128-character byte alphabet and alternative high-bit markers. Source ports share ancestry, not independent authorities.", usage: "Encode a message or decode ciphertext prefixed with 佛曰：. V2 is unsupported; randomized equivalent markers can change the literal encoding.", examples: ZH.foyu.examples, tips: ["The public fixed key provides no secrecy. Empty input encodes to the prefix alone, which decoding rejects. Old custom ciphertext is not automatically migrated.", "Source: https://github.com/lersh/TudouCode"] },
  snow: { what: "SNOW by Matthew Kwan hides messages in trailing whitespace; unrelated to the Whitespace programming language.", principle: "A TAB starts the payload. Reversed three-bit groups map to space runs separated by TABs on eight-column boundaries, not one space/TAB per bit. Optional Huffman compression and ICE 1-bit CFB encryption.", usage: "Main input is the message; text is the cover parameter. Password defaults empty, compression off, lineLength=80. Preserve trailing whitespace and match password/compression when decoding.", examples: [{ in: "\t      \t  \t\t   \t \t \n", out: "hi", param: "decode; compress=false; password empty" }], tips: ["Source: https://www.darkside.com.au/snow/", "The Windows reference EXE has text-mode CR/LF damage for some binary payloads; universal binary interoperability is not claimed."] },
  zeroWidth: { what: "Kei Misawa radix-N text steganography with three presets and a custom alphabet.", principle: "Encode UTF-16 code units as fixed-width radix-N digits. The default U+200C/U+200D/U+202C/U+FEFF alphabet uses eight symbols per code unit. Cover insertion is deterministic rather than randomly shuffled.", usage: "Main input is the secret, cover is the visible carrier. Nonempty customChars overrides charset. Accepts 2..36 unique BMP characters; allowNonInvisible explicitly permits visible symbols.", examples: [{ in: "A", out: "0000000001000001", param: "encode; customChars=01; allowNonInvisible=true; empty cover" }], tips: ["Keep alphabet order identical. Carrier text must not contain alphabet symbols. Missing/truncated payloads and overflowing code units are rejected. Presets zwsp3/zwspFull5 align with offdev zwsp-steg-js modes (interoperable both ways); binary mode hides raw bytes (drag-and-drop rawBytes; non-UTF-8 output becomes a .bin download).", "https://330k.github.io/misc_tools/unicode_steganography.html"] },
  scytale: { what: "Rectangular Scytale transposition with a column-count or characters-per-column key.", principle: "Write rows, read columns, keeping the existing vertical-bar padding. Decoding preserves every cell rather than deleting real bars. Original length cannot be inferred from padding.", usage: "column is a positive safe integer, keyMode is column or perCol. Default: two columns. Padded ciphertext length must divide by the key. Empty input returns immediately; nonempty grid limit is one million cells.", examples: [{ in: "a|b|", out: "ab||", param: "encode; column=2; keyMode=column" }], tips: ["This fixes local data deletion and resource bounds; specific original-tool padding defaults and independent interoperability remain unverified."] },
  gifFrames: { what: "Decode GIF frames into compressed PNGs and download one ZIP.", principle: "LZW, palette, offsets, transparency and disposal compositing. Each frame is encoded immediately instead of retaining all RGBA snapshots. ZIP contains frame_*.png and frames.txt.", usage: "maxFrames=0 requests all frames; N explicitly requests the first N. Limits: 4096 frames, 32MiB input, 4194304 pixels per canvas/frame, 536870912 cumulative pixels, 30 seconds, 128MiB ZIP. Failures and limits do not return an incomplete success archive.", examples: [{ in: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=", out: "gif_frames.zip", desc: "One-pixel GIF; the download contains frame_001.png and frames.txt." }], tips: ["An explicit prefix export is partial; the unscanned total frame count is not guessed. Current transparent-background compositing is not claimed equivalent to every viewer.", "One GIF extraction per JS realm: a new request cancels the old request and waits for it to release resources. Cancellation yields no ZIP. This also applies to recipe/MCP callers."] },
  mcMapRender: { usage: "Load map_#.dat and choose scale. Download the full-resolution PNG; the <=256px text-embedded image is a thumbnail only.", tips: ["Use the full PNG for QR decoding or pixel extraction."] },
  lsbEmbed: { usage: "Load PNG/BMP, set payload/channels/bit plane/bit order, then download the full stego PNG. Do not extract from the thumbnail.", tips: ["Use the same parameters in zstegScan."] },
  deepsoundExtract: { usage: "Load a supported WAV and supply a password if needed. Download all recovered files individually. Text is a bounded preview, not truncated Base64 pretending to be a full file.", tips: ["Binary files are not previewed as text; downloads retain the original bytes."] },
  zstegScan: { usage: "Leave exportCombo empty to scan. Enter a report combination such as bit3 r msb, or bit=3&channel=r&order=msb&traversal=row, to export directly from pixels. exportMaxBytes defaults to 65536; range 1..1048576.", tips: ["Padding is retained; original payload length is not guessed. Limited exports are explicitly marked truncated."] },
  stegoQuickScan: { what: "Quick PNG/JPEG/GIF structure, metadata and trailing-data analysis.", principle: "Bounded byte traversal; JPEG entropy bytes, stuffing and restart markers are distinguished from segment headers. No finding does not prove absence of steganography.", usage: "Drop a file or choose Base64/Hex. Limits: 8MiB, 4096 structural steps, 96 bytes per metadata preview and 256 trailing preview bytes.", examples: [{ in: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAkQBADs=", out: "Trailing bytes: 0", desc: "A report excerpt, without LZW decoding." }], tips: ["No LSB, bit planes, passwords, interpreters, bridges, pixel decoding, full checksum validation or metadata decompression."], aka: ZH.stegoQuickScan.aka },
  b64urlJson: { what: "Base64url/JSON conversion and formatting, not encryption or JWT signature verification.", tips: ["Readable claims do not prove a valid signature or authorization."] },
};

// FIPS 180 / 202 vectors for ASCII 'abc'; independently compared with Node/OpenSSL.
export const HASH_VECTORS = {
  sha0: "0164b8a914cd2a5e74c4f7ff082c4d97f1edf880",
  sha1: "a9993e364706816aba3e25717850c26c9cd0d89d",
  sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  sha384: "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
  sha512: "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
  sha3: "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532",
  shake128: "5881092dd818bf5cf8a3ddb793fbcba74097d5c526a6d35f97b83351940f2cc8",
  shake256: "483366601360a8771c6863080cc4114d8db44530f8f1e1ee4f94ea37e78b5739",
};

// [Chinese explanation, English explanation, input, output, direction, extra search terms]
export const BASE_NOTES = {
  base64: ["RFC 4648 Base64：每6bit查64字表，尾部用=补齐。默认UTF-8文本；不是加密。", "RFC 4648 Base64 maps six-bit groups to 64 symbols with = padding. Default text uses UTF-8; not encryption.", "hello", "aGVsbG8=", "encode", ["RFC 4648 Base64", "Base64文本编码", "standard base64", "Base64 padding"]],
  radix64: ["使用./A-Za-z0-9字表的6bit位打包，无=补位；不代表完整Unix crypt口令格式，也不是OpenPGP装甲。", "Six-bit packing with the ./A-Za-z0-9 alphabet and no = padding; not a full Unix crypt password format or OpenPGP armor.", "hello", "YETqZE6", "encode", ["Radix64 crypt字表", "crypt alphabet", "radix64 bit packing", "无补位Radix64"]],
  base64steg: ["利用Base64末尾冗余位藏消息：==行藏4bit，=行藏2bit。编码自动生成确定性载体行；解码读冗余位，而不是普通Base64明文。", "Hides data in Base64 pad bits: four bits for == and two for =. Encoding generates deterministic carrier lines; decoding reads spare bits, not ordinary Base64 plaintext.", "A", "czB=\ncw==\nczJ=", "encode", ["Base64 padding bits", "Base64冗余位隐写", "Base64 pad-bit steganography", "Base64 offset隐写"]],
  base32steg: ["利用Base32末字符冗余位隐藏消息；本编码器每行生成2字节载体，四个=的行可藏4bit。它在独立Base隐写族，不混入Base64编码族。", "Hides data in Base32 pad bits. This encoder generates two-byte carriers whose four-= lines hold four hidden bits. It belongs to Base steganography, not the Base64 encoding family.", "A", "ON2E====\nOR2R====", "encode", ["Base32 padding bits", "Base32冗余位隐写", "Base32 pad-bit steganography", "Base32 offset隐写"]],
  base64dict: ["标准Base64结果按自定义64字符key字表替换；默认标准字表。解码须使用同一顺序的字表。不是凯撒位移算法本身。", "Substitutes the standard Base64 alphabet with a 64-character key alphabet; default is standard Base64. Decode with the identical alphabet order, not a Caesar shift.", "hello", "aGVsbG8=", "encode", ["自定义Base64字典", "custom base64 alphabet", "Base64字表替换", "Base64 substitution alphabet"]],
  multilineBase64: ["Base64编码折行，lineLen默认76；解码处理多行输入。不添加压缩层，不等于隐写冗余位提取。", "Wrapped Base64 encoding, lineLen=76 by default, with multiline decoding. No compression layer or pad-bit steganography extraction.", "hello", "aGVsbG8=", "encode", ["Base64折行", "wrapped base64", "多行Base64解码", "76列Base64"]],
  base64decompress: ["编码是UTF-8→zlib→Base64；解码按反序。压缩器可给出不同的合法压缩流，比较解压恢复结果；不是任意gzip/raw-deflate格式。", "Encode UTF-8 to zlib then Base64; decode in reverse. Different compressors can produce different valid streams: compare restored data. Not an arbitrary gzip/raw-deflate decoder.", "eJzLSM3JyQcABiwCFQ==", "hello", "decode", ["Base64 zlib解压", "zlib base64", "Base64压缩文本", "inflate base64"]],
  dxBase64: ["风之暇想DXBase64：raw deflate、随机salt循环XOR与CRC16封装。无用户密钥，不提供保密或抗篡改认证；随机salt使字面输出变化。", "DXBase64 combines raw deflate, random-salt repeating XOR and CRC16. There is no secret user key or authenticated encryption; random salt changes literal outputs.", "AcwqrOHk52Xjqyo=", "hello", "decode", ["风之暇想DXBase64", "DXBase64 decode", "DXBase64 CRC16", "DXBase64 random salt"]],
  base58: ["Bitcoin Base58字表去掉0/O/I/l；字节按大端整数转换，前导零对应1。纯Base58无校验；不要混称Base58Check。", "Bitcoin Base58 omits 0/O/I/l, treats bytes as a big-endian integer and preserves leading zero bytes as 1. Plain Base58 has no checksum, unlike Base58Check.", "hello", "Cn8eVZg", "encode", ["Bitcoin Base58", "Flickr Base58", "Ripple Base58", "五十八进制", "Base58大端编码"]],
  base58check: ["输入payload后附双SHA-256的前4字节，再Base58编码。本入口不自动加版本字节；需要地址版本时自行放进payload。校验和不是认证。", "Appends four bytes of double-SHA256 to the input payload, then Base58-encodes it. No version byte is automatically inserted; include it in the payload when required. A checksum is not authentication.", "hello", "2L5B5yqsVG8Vt", "encode", ["Base58Check checksum", "双SHA256校验", "Bitcoin地址校验", "WIF编码格式", "带校验Base58"]],
  base2048: ["qntm Base2048每11bit输出Unicode码点，用独立尾组表达不足11bit的数据；面向按字符计费的文本通道。与Base65536字表和分组不同。", "qntm Base2048 maps 11-bit groups to Unicode with a separate tail repertoire for shorter groups. Designed for character-budgeted channels; not Base65536.", "hello", "ڵϠɲඹ", "encode", ["qntm Base2048", "11bit Unicode", "推文二进制编码", "tweetable encoding", "Base2048轻码点"]],
  base65536: ["qntm Base65536每两字节映射一个安全Unicode码点，奇数尾字节使用专用块；本箱使用v2字表。含增补平面，不能按单个UTF-16码元拆开密文。", "qntm Base65536 maps two bytes to a safe Unicode code point with a separate odd-byte tail block. This implementation uses the v2 alphabet. Supplementary characters must not be split into UTF-16 code units.", "hello", "驨ꍬᕯ", "encode", ["qntm Base65536", "Base65536 v2", "两字节一码点", "安全码点编码", "HATETRIS回放编码"]],
  ecoji: ["Keith Turner Ecoji v1：每5字节按10bit分组映射为4个表情字符，尾组有专用填充规则；不是每字节一个表情。v2字表/尾组不保证兼容。", "Keith Turner's Ecoji v1 maps five bytes to four ten-bit emoji symbols, with special tail padding. It is not one emoji per byte and does not promise v2 compatibility.", "hello", "👲🔩🚗🌷", "encode", ["Ecoji v1", "Keith Turner Ecoji", "emoji base1024", "5字节4表情", "Ecoji咖啡填充"]],
  base100: ["Adam Niederer Base100/Base💯：字节b映射U+1F3F7+b，每字节一个码点。UTF-8占4字节，不是零字节开销或实际100进制；无校验、无压缩。", "Adam Niederer's Base100/Base💯 maps byte b to U+1F3F7+b: one code point per byte, four UTF-8 bytes. Not zero storage overhead, base-100 arithmetic, compression or checksumming.", "hello", "👟👜👣👣👦", "encode", ["Adam Niederer Base100", "Base💯", "每字节一个emoji", "emoji byte encoding", "Base100码点映射"]],
};

export const EXTRA_ALIASES = {
  shzyhxjzg: ["24字", "24个字", "价值观编码", "core values", "社会主义核心价值观编码", "价值观24字"],
  lsbImage: ["图片隐写", "图片lsb隐写", "图像LSB隐写", "lsb pixels"],
  natoAlphabet: ["字母解释法", "北约字母", "北约音标", "icao字母", "nato phonetic"],
  railFence: ["Rail Fence cipher", "zigzag transposition", "W型栅栏", "栅栏转置", "rail fence rails"],
  scytale: ["Scytale cipher", "Spartan scytale", "斯巴达密码棒", "每栏字数", "scytale column count"],
  whitespace: ["Whitespace language", "Whitespace interpreter", "空白编程语言", "Whitespace栈机", "Whitespace程序执行", "Edwin Brady Chris Morris"],
  malbolge: ["Malbolge language", "Ben Olmstead", "Malbolge装载检查", "Malbolge source validation"],
  deadfish: ["Deadfish language", "Deadfish accumulator", "Deadfish累加器", "i d s o语言"],
  befunge: ["Befunge-93", "Chris Pressey", "二维栈式语言", "Befunge interpreter", "Befunge torus"],
  sm2KeyGen: ["SM2 密钥对生成", "SM2 key pair generation", "SM2 keygen", "国密椭圆曲线密钥对", "sm2p256v1 key pair", "GB/T 32918.5", "SM2 公私钥对", "SM2 私钥生成", "SM2 公钥生成", "国密 SM2 密钥", "SM2 生成密钥", "SM2 密钥生成器", "商密 SM2 密钥对", "SM2 压缩公钥", "sm2p256v1 密钥对"],
  sm2Encrypt: ["SM2 公钥加密", "SM2 asymmetric encryption", "SM2 encrypt", "GB/T 32918.4 加密", "国密椭圆曲线加密", "sm2p256v1 encrypt", "SM2 加密", "SM2 密文", "C1C3C2", "C1C2C3", "国密 SM2 公钥加密", "商密 SM2 加密", "国密非对称加密", "SM2 加密算法", "SM2 混合加密 KDF"],
  sm2Decrypt: ["SM2 私钥解密", "SM2 ciphertext decrypt", "SM2 decrypt", "GB/T 32918.4 解密", "SM2 C3 校验", "国密密文还原", "SM2 解密", "SM2 密文解密", "sm2p256v1 解密", "国密椭圆曲线解密", "商密 SM2 解密", "SM2-4 解密", "国密解密工具", "SM2 密文还原", "SM2 解密算法"],
  sm2Sign: ["SM2 数字签名", "SM2 sign", "SM2 signature", "GB/T 32918.2 签名", "SM2 ZA", "SM3 预处理签名", "ID_A 签名", "SM2 签名", "国密 SM2 签名", "sm2p256v1 签名", "国密椭圆曲线签名", "商密 SM2 签名", "SM2-2 签名", "SM2 r s", "SM2 签名工具"],
  sm2Verify: ["SM2 签名验证", "SM2 verify signature", "SM2 verify", "GB/T 32918.2 验签", "SM2 签名校验", "国密验签", "SM2 验签", "国密 SM2 验签", "sm2p256v1 验签", "国密椭圆曲线验签", "商密 SM2 验签", "SM2-2 验签", "SM2 验签工具", "SM2 签名有效性", "SM2 verify r s"],
  sm2KeyExchange: ["SM2 密钥协商", "SM2 key agreement", "SM2 key exchange", "GB/T 32918.3", "SM2 S1 S2", "SM2 会话密钥", "SM2 临时点", "SM2 密钥交换", "国密密钥交换", "sm2p256v1 密钥交换", "SM2 DH", "国密 DH", "SM2 共享密钥", "商密 SM2 密钥交换", "SM2 KDF"],
};

// CRC RevEng catalogue check values for ASCII '123456789'; refin == refout here.
export const CRC_PARAMS = {
  crc8: ["CRC-8/SMBUS", "07", "00", false, "00", "f4"],
  crc8_maxim: ["CRC-8/MAXIM-DOW", "31", "00", true, "00", "a1"],
  crc16: ["CRC-16/IBM-3740 (CCITT-FALSE)", "1021", "ffff", false, "0000", "29b1"],
  crc32: ["CRC-32/ISO-HDLC", "04c11db7", "ffffffff", true, "ffffffff", "cbf43926"],
  crc32c: ["CRC-32/ISCSI (Castagnoli)", "1edc6f41", "ffffffff", true, "ffffffff", "e3069283"],
  crc64: ["CRC-64/ECMA-182", "42f0e1eba9ea3693", "0000000000000000", false, "0000000000000000", "6c40df5f0b497347"],
};
