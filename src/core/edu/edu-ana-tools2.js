export default {
  xorBrute: {
    what: "把输入逐字节异或 0~255 全部 256 个密钥，一次性列出所有可能的结果——XOR 单字节密码最常用的爆破手法。",
    principle: "XOR 加密用同一个字节 `k` 与每个明文字节异或：`c = m XOR k`。因为 XOR 自反（`m = c XOR k`），爆破时只需遍历 `k=0..255`，把密文逐字节异或 `k` 看哪个解出可读文本。开启「仅可打印」过滤后，只保留 80% 以上字符可打印的结果，大幅减少人工筛选量。",
    usage: "把密文（或 hex 转成原始字节后的文本）粘进输入框，勾选「仅显示可打印结果」可过滤掉乱码。输出每行一个密钥：`0xNN (N): 解密文本`。",
    examples: [
      { in: "\\x01\\x02\\x03（3 个不可打印字节）", out: "256 行结果；key 0x01 得 \\x00\\x03\\x02（仍不可打印），key 0x42 得 C@A（可打印）", desc: "0x01^0x42=0x43('C'), 0x02^0x42=0x40('@'), 0x03^0x42=0x41('A')" },
    ],
    tips: [
      "CTF 里 XOR 密钥通常是单个可见字符（如 0x20~0x7e），先开过滤再肉眼扫一遍最快。",
      "如果密文是 hex 字符串，先用 hex decode 转成原始字节再喂进来，否则逐字符异或的是 hex 字符本身而非数据字节。",
      "key=0x00 的结果就是原文本身——如果它排第一看起来像明文，说明密文可能根本没加密。",
    ],
    aka: ["XOR爆破", "异或爆破", "single-byte XOR brute force", "XOR single key", "单字节异或爆破", "xor brute", "异或密钥爆破", "256密钥爆破", "xor crack", "单字节xor", "xor暴力破解", "异或穷举"],
  },

  caesarBrute: {
    what: "自动破解凯撒密码的位移量：对 0~25 所有位移逐一解密并打分，四元组得分最高的就是答案。",
    principle: "凯撒密码把每个字母位移固定值 `k`。爆破时遍历 `k=0..25`，对每个位移还原明文，再用<b>四元组评分（quadgram）</b>衡量「像不像英语」——英语中 THE/AND/ING 等四字母组合出现频率高，得分越高越像明文。同时输出<b>卡方值</b>（越低越接近英语字母频率分布）做交叉验证。还附赠 ROT47（ASCII 33~126 位移 47，自反，覆盖符号数字）。",
    formulas: [
      { tex: "D_i(c) = (c - i) \\bmod 26", caption: "位移 i 的解密：密文字母 c 减 i 模 26" },
    ],
    usage: "输入凯撒密文（纯字母或含标点均可），无需填参数。输出最佳位移 + 26 位移排名表 + 完整解密 + ROT47 结果。",
    examples: [
      { in: "KHOOR ZRUOG", out: "最佳位移: 3 → HELLO WORLD", desc: "位移3即经典凯撒，K→H, H→E, O→L...；四元组得分最高" },
    ],
    tips: [
      "位移 13 = ROT13（自反，再解一次还原）。",
      "如果最佳位移是 0，可能输入已经是明文，或者不是凯撒加密。",
      "ROT47 同时处理字母+数字+符号，适合混合内容。",
    ],
    aka: ["凯撒爆破", "ROT自动求位移", "Caesar cipher brute force", "shift cipher solver", "凯撒自动破解", "caesar brute", "rot爆破", "移位密码爆破", "凯撒位移求解", "自动凯撒", "rot13爆破", "位移穷举", "凯撒解密器"],
  },

  freqAnalysis: {
    what: "统计密文的单字母/双字母/三字母频率分布，附带 ASCII 条形图——破解替换密码的入门工具。",
    principle: "英语有稳定的字母频率特征：E 最高（~12.7%），T/A/O/I/N 次之，Z/Q/X 最低。单表替换密码只换字母不换频率，所以密文中频率最高的字母大概率对应明文 E。双字母（TH/HE/IN）和三字母（THE/AND/ING）频率更有辨识度。工具按 n-gram 滑窗统计，降序排列并画条形图，还输出 JSON 格式数据供前端绘图。",
    usage: "输入密文文本，选模式（全部/单字母/双字母/三字母），设每类显示前 N 条。输出含 n-gram、次数、占比、条形图。",
    examples: [
      { in: "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG", param: "mode=mono, top=5", out: "O:4次(11.43%) / E:3次(8.57%) / T:2次(5.71%) / H:2次(5.71%) / U:2次(5.71%)", desc: "全字母句的频率分布，O 出现最多因为出现了 4 次" },
    ],
    tips: [
      "密文越长频率越准，少于 100 字母的样本误差大。",
      "高频字母不一定是 E——先看双字母（TH 通常最高）交叉验证。",
      "如果频率分布很平坦（接近 1/26），可能是多表替换（如维吉尼亚），不是单表。",
    ],
    aka: ["频率分析", "n-gram统计", "frequency analysis", "letter frequency", "字母频率", "词频分析", "字频统计", "频率统计", "单表替换分析", "ngram", "字母频率分析", "频度分析", "双字母统计"],
  },

  hashTypeIdentify: {
    what: "根据哈希值的长度、字符集和前缀，识别它是什么算法算出来的——拿到一串哈希不知道用什么工具破时的第一步。",
    principle: "不同哈希算法输出长度固定：MD5=32 hex（128位）、SHA-1=40 hex（160位）、SHA-256=64 hex（256位）、SHA-512=128 hex。带前缀的格式也能识别：`$2b$`=bcrypt、`*`=MySQL5（SHA1(SHA1(pass))）、`$1$`=MD5 crypt、`$6$`=SHA-512 crypt、`{SSHA}`=LDAP。还能识别 Base64 编码的哈希（解码后按字节长度判断）。",
    usage: "把哈希字符串粘进输入框，无需参数。输出长度、可能的算法列表和区分建议。",
    examples: [
      { in: "d41d8cd98f00b204e9800998ecf8427e", out: "32 hex = 128 位 → MD5 / NTLM / MD4 / LM 等（★32位无法仅凭长度区分 MD5 与 NTLM，需看上下文）", desc: "这是空字符串的 MD5" },
      { in: "*A1B2C3D4E5F6A1B2C3D4E5F6A1B2C3D4E5F6A1B2", out: "MySQL5 / MySQL 4.1 密码哈希（* + 40 hex = SHA1(SHA1(pass))）", desc: "41 字符总长，首字符 *，后 40 位为双重 SHA-1" },
    ],
    tips: [
      "32 位 hex 在 Windows 取证场景优先怀疑 NTLM（MD4 of UTF-16LE），Web 场景优先 MD5。",
      "64 位 hex 别忘了 SM3（国密），国内 CTF 常见。",
      "bcrypt（$2b$）和 Argon2 是慢哈希，字典爆破不适用，需 hashcat 专用模式。",
    ],
    aka: ["哈希识别", "hash type detect", "hash identifier", "哈希算法识别", "哈希类型猜测", "hash identify", "analyse hash", "hashid", "哈希类型识别", "hash类型判断", "识别哈希算法", "哈希指纹"],
  },

  hashDictCrack: {
    what: "用字典爆破 MD5/SHA-1/SHA-256/NTLM 哈希——拿弱口令字典、纯数字、日期组合逐一算哈希比对，命中即得明文。",
    principle: "字典爆破的核心：预生成候选明文列表（弱口令 top 300 / 0~10^N 数字 / 1970-2030 日期），对每个候选算指定算法的哈希，与目标比对。MD5/NTLM 走纯 JS 同步快速路径；SHA-1/SHA-256 走 WebCrypto 异步。auto 模式按长度自动猜算法（32位→MD5，40位→SHA-1，64位→SHA-256）。SHA 系超 200 万次自动中断防爆。",
    usage: "输入目标哈希，选算法（auto 自动按长度猜）、字典来源（top弱口令/纯数字/日期/全部）、数字最大位数。输出命中状态+明文+尝试次数。",
    examples: [
      { in: "e10adc3949ba59abbe56e057f20f883e", param: "algo=auto, dict=numeric, maxDigits=6", out: "命中 ✓ 算法: md5 明文: 123456 尝试: 123457 次", desc: "这是 123456 的 MD5，纯数字字典第 123457 个命中（含 0）" },
    ],
    tips: [
      "auto 模式下 32 位优先试 MD5——如果实际是 NTLM 需手动指定。",
      "numeric 位数越大越慢：6 位 = 100 万次秒级，8 位 = 1 亿次需走 workerPool 并行。",
      "top 弱口令字典约 300 条，覆盖 password/123456/admin 等常见弱口令，CTF 够用。",
    ],
    aka: ["哈希爆破", "hash crack", "dictionary attack", "hash dictionary", "字典爆破", "哈希字典爆破", "md5解密", "哈希破解", "hash dict crack", "弱口令爆破", "hash brute", "撞库解哈希"],
  },

  pngSizeRecover: {
    what: "检测 PNG 图片宽高是否被篡改，并爆破恢复真实尺寸——CTF 改 PNG 高度藏 flag 的经典题型。",
    principle: "PNG 的 IHDR chunk 里存宽高（各 4 字节大端），后面跟着 CRC32 校验。篡改宽高但不改 CRC 时，存储 CRC ≠ 计算 CRC，工具据此检测篡改。恢复策略：保持 5 字节属性不变，爆破宽高组合（1~8192），找到 CRC 匹配的即真实尺寸。先只爆高度（CTF 90% 场景，O(N) 秒出），再爆宽度，最后双爆兜底。CRC32 用 IEEE 802.3 多项式 `0xEDB88320`。",
    formulas: [
      { tex: "\\text{CRC32} = \\text{CRC}(\\texttt{IHDR\\text{-}type} \\| \\text{width} \\| \\text{height} \\| \\text{5B\\ attrs})", caption: "IHDR 的 CRC 覆盖 chunk type + 13 字节数据" },
    ],
    usage: "把 PNG 文件的 base64 粘进输入框。输出当前宽高、CRC 校验结果、爆破恢复的真实宽高、修复后的 base64。",
    examples: [
      { in: "1×1 正常 PNG 的 base64", out: "当前宽高: 1 × 1 / IHDR CRC32: 存=907753de 算=907753de（校验通过，未被篡改）", desc: "正常图片 CRC 匹配，无需爆破" },
      { in: "高度被篡改为 2 的同款 PNG（CRC 未改）", out: "存=907753de 算=16e32170（不符）→ 爆破恢复 [height-only]：真实宽高 = 1 × 1", desc: "高度被改 1→2 但 CRC 仍是原来的，爆破还原出真实高度 1" },
    ],
    tips: [
      "输入需是 base64——可先用文件读取或 hex→base64 转换。",
      "爆破上限 8192，超宽图片可能超出范围。",
      "如果 CRC 也被同步篡改（高手题），CRC 检测无效，需靠肉眼观察图片内容异常。",
    ],
    aka: ["PNG宽高修复", "PNG CRC爆破", "PNG height recover", "IHDR CRC brute force", "png高度恢复", "png尺寸恢复", "ihdr修复", "png宽高爆破", "png crc修复", "png height fix", "图片高度还原", "png真实尺寸"],
  },

  trailerCarve: {
    what: "识别文件正体结束位置（PNG IEND/JPEG FFD9/GIF 3B/ZIP EOCD 等），剥离出尾部附加的隐藏数据——CTF 在图片后拼接 flag 的经典题型。",
    principle: "每种文件格式有固定的结束标记：PNG 的 IEND chunk（`00 00 00 00 49 45 4E 44 AE 42 60 82`）、JPEG 的 EOI（`FF D9`）、GIF 的 trailer（`3B`）、ZIP 的 EOCD、BMP/RIFF/PDF 等。工具先识别载体类型，定位正体结束偏移，然后把后面的字节切出来，再尝试识别附加数据的魔数。还支持 binwalk 模式：全文扫描内嵌文件魔数。",
    usage: "把文件的 base64 粘进输入框。选模式（尾部剥离/全文魔数扫描）和附加数据输出格式（预览/hex/ascii/base64）。输出主体类型、结束偏移、附加数据内容和魔数识别。",
    examples: [
      { in: "PNG + IEND + \"APPEND_HIDDEN_DATA\" 的 base64", param: "mode=trailer, format=ascii", out: "文件大小: 63 字节 / 主体: PNG / 正体结束偏移: 45(0x2d) / 附加数据: 18 字节 / ascii: APPEND_HIDDEN_DATA", desc: "IEND 后 18 字节附加数据被完整剥出" },
    ],
    tips: [
      "附加数据开头未匹配已知魔数时，可能是纯文本 flag 或加密数据——切出来看 hex/ascii。",
      "binwalk 模式适合一个文件里嵌套多个文件（如 PNG 里嵌 ZIP）。",
      "有些题把 flag 藏在文件正体内部（如 PNG 的 zTXt chunk），不是尾部附加——需结合其他工具。",
    ],
    aka: ["文件附加数据剥离", "trailer carve", "文件分离", "binwalk scan", "文件雕刻", "文件尾部数据", "附加数据提取", "file carving", "内嵌文件提取", "foremost", "尾部数据剥离", "文件魔数扫描"],
  },
};
