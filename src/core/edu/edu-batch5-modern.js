// 科普内容分片：modern 段补全 11（ror13Hash/byteArith/bwt/lzstring/cast5/twofish/hotp/totp/zuc/sm2/sm9）。
// 纯数据，无 import 无副作用无 register。examples 均为实跑取值（对齐 RFC/GM/T 权威向量）。
export default {
  ror13Hash: {
    what: "PE 恶意软件里最常见的 API 名哈希——把字符串逐字节喂进一个「32 位循环右移 13 + 累加」的状态机，输出一个 32 位指纹。",
    principle:
      "维护一个 32 位累加器 h（初值 0）。每来一个字节：先把 h 循环右移 13 位（ROR13），再加上该字节，全程 mod $2^{32}$。\n\n" +
      "这是 Windows shellcode / PE 导入表混淆的招牌手法——恶意代码不直接存 `LoadLibraryA` 字符串，而是存它的 ROR13 哈希，运行时遍历导出表算哈希比对，躲静态特征扫描。单向不可逆，靠预置 API 名表反查。",
    usage: "输入框填 API 名（或任意字符串），参数选大小写（原样/转小写/转大写），点 run 输出 8 位十六进制哈希。单向，无 decode。",
    formulas: [
      { tex: "h \\leftarrow \\mathrm{ROR}_{13}(h) + b_i \\pmod{2^{32}}", caption: "每字节：先循环右移 13 再加字节" },
    ],
    examples: [
      { in: "LoadLibraryA", param: "大小写=原样", out: "0xEC0E4E8E", desc: "PE 标准 API 哈希向量，逆向题常给此值让你反查 API 名" },
      { in: "GetProcAddress", param: "大小写=原样", out: "0x7C0DFCAA", desc: "另一个高频 API 的 ROR13 哈希" },
    ],
    tips: [
      "逆向看到 `ror edx, 13` / `rol` 配合累加的循环，基本就是这套哈希——记下 0xEC0E4E8E 这类常量反查即可。",
      "大小写敏感：题面常约定全小写或原样，算不出来先换大小写再试。",
      "单向不可逆，爆破靠维护一张「API 名 → 哈希」对照表反查，本工具 run 即正向计算。",
    ],
    aka: ["ror13", "pe api hash", "api 哈希", "shellcode 哈希", "ror13 hash", "循环右移哈希", "api name hash", "ror13哈希", "windows api 哈希", "导出表哈希", "rotate right 13", "pe导入哈希"],
  },

  byteArith: {
    what: "逐字节做加减乘模 256——最朴素的字节级算术变换，常作逆向题里的「最后一层混淆」。",
    principle:
      "对每个字节 $b$ 按运算 op 和密钥 k 计算：加 $b'=(b+k)\\bmod 256$、减 $b'=(b-k)\\bmod 256$、乘 $b'=(b\\cdot k)\\bmod 256$。加/减互为逆运算；乘法的逆是乘以 k 模 256 的逆元——但只有奇数 k 有逆元（因为只有奇数与 256 互素），偶数 k 加密后不可逆。",
    usage: "encode：输入文本→逐字节运算→Hex 串。decode：输入 Hex→逆运算→还原文本。参数选运算（add/sub/mul）和 key（0-255）。mul 解密仅奇数 key 可逆。",
    formulas: [
      { tex: "b' = (b \\mathbin{\\text{op}} k) \\bmod 256", caption: "逐字节算术模 256" },
    ],
    examples: [
      { in: "Hello", param: "op=add, key=1", out: "49666D6D70 (hex)", desc: "每字节 +1：H(0x48)→0x49 … 加的逆是减，decode 还原" },
      { in: "Hello", param: "op=mul, key=3", out: "D82F44444D (hex)", desc: "每字节 ×3 模 256；3 是奇数有逆元(171)，decode 可还原" },
    ],
    tips: [
      "mul 模式偶数 key 加密后丢信息解不回——题里见到乘法混淆先判断 key 奇偶。",
      "和 XOR 一样逐字节独立，无块结构——密文长度等于明文长度。",
      "CTF 逆向里常和 XOR 嵌套：先 byteArith 再 XOR，剥洋葱时注意顺序。",
    ],
    aka: ["字节算术", "byte arithmetic", "模 256 加减乘", "byte arith", "字节加减乘", "mod 256", "逐字节运算", "字节算术运算", "模256加密", "byte math", "字节级混淆", "加减乘模256"],
  },

  bwt: {
    what: "Burrows-Wheeler 变换——bzip2 压缩的核心前置步骤。可逆但不加密，把数据重排成「相同字符扎堆」的形态方便压缩。",
    principle:
      "构造输入串的所有循环移位，按字典序排序，取最后一列作为 BWT 输出，并记下原串在排序矩阵中的行号（primary）。\n\n" +
      "重排后相同上下文的字符会聚到一起（如 `banana` → `nnbaaa`），便于后续 RLE/MTF 压缩。逆变换用 LF-mapping：从 primary 出发，按「最后一列→第一列」的对应关系迭代还原。另可选 `$` 哨兵模式——末尾加一个小于所有字符的 `$`，primary 隐含为 `$` 在 BWT 串中的位置，输出无需带索引。",
    usage: "encode：输入文本→输出 `BWT串|primary`（分隔符可配）；哨兵模式输出含 `$` 的 BWT 串。decode：输入同格式→还原。注意哨兵模式要求原文不含 `$`。",
    examples: [
      { in: "banana", param: "无哨兵（分隔符 |）", out: "nnbaaa|3", desc: "BWT 串=nnbaaa，primary=3；decode 还原 banana" },
      { in: "banana", param: "哨兵模式（加 $）", out: "annb$aa", desc: "$ 位置即隐含 primary，decode 去掉末尾 $" },
    ],
    tips: [
      "可逆不加密——CTF 里常作为压缩或隐写的前置层，看到 `nnbaaa|数字` 这种「乱序串+索引」长相就是它。",
      "哨兵模式输入不能含 `$`（它被征用为 EOF 标记）。",
      "和 MTF（Move-to-Front）、RLE 经常串联：BWT → MTF → RLE → 熵编码是 bzip2 的标准流水线。",
    ],
    aka: ["burrows-wheeler", "bwt 变换", "块排序变换", "bzip2 前置", "bwt", "burrows wheeler transform", "块排序压缩变换", "循环移位排序", "bzip2变换", "b-w变换", "bwt编码", "字符重排变换"],
  },

  lzstring: {
    what: "LZW 字典压缩的一个轻量实现（参考 pieroxy/lz-string 思路）——边读边建字典，把重复子串压成字典索引。",
    principle:
      "初始字典预填 256 个 ASCII 单字符（索引 0-255）。扫描输入：维护当前匹配串 w，若 w+下一字符在字典里就继续扩展，否则输出 w 的索引并把 w+下一字符作为新词加入字典。\n\n" +
      "解压对称：读入索引数组，按同样规则重建字典还原文本。本实现用 JSON 数字数组承载索引（如 `[97,98,256]`），不做位打包——优先保证往返严格正确。仅支持 Latin-1（0-255），中文等多字节字符请先 UTF-8 编码再压。",
    usage: "encode：输入文本→输出 JSON 数字数组字符串（如 `[97,98,256,258,98]`）。decode：输入该数组→还原文本。无参数。",
    examples: [
      { in: "abababab", param: "（无参数）", out: "[97,98,256,258,98]", desc: "ab 先进字典(256)，aba(257)，abab(258)…重复子串被压成索引" },
      { in: "HelloHello", param: "（无参数）", out: "[72,101,108,108,111,256,258,111]", desc: "第二个 Hello 命中字典项 256=Hello 等被压缩" },
    ],
    tips: [
      "输出是 `[数字,数字,…]` 形态的 JSON 数组——一眼认出，别和 base64 混淆。",
      "重复模式越多压缩率越高；完全无重复的随机串压完反而可能变长。",
      "仅 Latin-1：直接压中文会报错，需先转 UTF-8 字节序列再压。",
    ],
    aka: ["lz-string", "lzw 压缩", "lzstring", "字典压缩", "lzw", "lempel-ziv-welch", "lz string", "字典编码压缩", "lzw字典", "lz-string压缩", "滑动字典压缩", "词典压缩"],
  },

  cast5: {
    what: "CAST-128（CAST5）——RFC 2144 的分组密码，早期 PGP 的默认对称算法。64 位块、密钥 5-16 字节、12 或 16 轮 Feistel。",
    principle:
      "Feistel 网络：64 位明文分左右两半，密钥 ≤80 位（≤10 字节）跑 12 轮，>80 位跑 16 轮。每轮用三种轮函数之一（按轮号循环切换 Type 1/2/3），每种用不同的 S-box 组合做字节替换 + 密钥加/异/减 + 循环移位。共 8 个 S-box（S1-S4 轮函数、S5-S8 密钥扩展），各 256×32 位，数据照抄 RFC 2144 附录 A。子密钥由密钥扩展从主密钥派生，解密用同一套结构逆序轮密钥。",
    usage: "填密钥（5-16 字节）、选模式（ECB/CBC，CBC 要 IV）、密钥编码与密文编码。encode 加密、decode 解密。块 8 字节，PKCS7 填充。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='12345678'(8字节), outEnc=base64", out: "0nHCcDfF0Ys=", desc: "8 字节密钥=64 位→12 轮；decode 同参还原" },
    ],
    tips: [
      "块 8 字节（同 DES），密文长度是 8 的倍数——和 AES 的 16 字节块区分开。",
      "密钥长度决定轮数：≤10 字节 12 轮，>10 字节 16 轮。",
      "PGP 早期默认就是它；题面提 PGP 又不像 AES/DES 的块大小，往 CAST5 想。",
    ],
    aka: ["cast-128", "cast5", "rfc 2144", "pgp 默认密码"],
  },

  twofish: {
    what: "Twofish——Schneier 1998 年设计的 AES 五强候选之一，128 位块、16 轮 Feistel，招牌是「密钥相关 S-box」。",
    principle:
      "128 位明文拆成四个 32 位字，16 轮。每轮用两个密钥相关的 S-box 做字节替换——S-box 由密钥经固定 q0/q1 置换 + MDS 矩阵（GF(2⁸)，多项式 0x169）派生，每次加密 S-box 都不同。结果经 PHT 混合与另一半异或，再叠加 RS 矩阵（GF(2⁸)，多项式 0x14D）派生的轮子密钥。密钥 128/192/256 位，输入/输出还做白化异或。解密逆序轮密钥复用同一结构。\n\n" +
      "密钥相关 S-box 是它和 AES 最大区别——攻击者无法预计算固定 S-box，安全性高但速度略逊 Rijndael，最终 AES 评选败北。",
    usage: "填密钥（16/24/32 字节）、选模式（ECB/CBC，CBC 要 IV）、密钥编码与密文编码。encode 加密、decode 解密。块 16 字节，PKCS7 填充。",
    examples: [
      { in: "Hello", param: "mode=ECB, key='1234567890123456'(16字节), outEnc=base64", out: "kZd8pH5FNfZ4CuHQVqR52w==", desc: "Twofish-128 ECB；decode 同参还原" },
    ],
    tips: [
      "块 16 字节（同 AES）→ 密文是 16 的倍数。",
      "AES 五强之一（与 Rijndael/MARS/RC6/Serpent 同列），逆向见到密钥派生 S-box + MDS 矩阵的多半是它。",
      "密钥必须 16/24/32 字节之一，其他长度直接报错。",
    ],
    aka: ["twofish", "schneier aes 候选", "密钥相关 s-box"],
  },

  hotp: {
    what: "HOTP——RFC 4226 的计数器式一次性密码（HMAC-Based OTP），你手上的硬件令牌按键出码的那种。",
    principle:
      "用密钥 K 和计数器 C 算 HMAC-SHA1（也可 SHA-256/512），取 20 字节结果。动态截断：取最后一字节的低 4 位作偏移 offset，从 offset 起取 4 字节、清掉最高位得到 31 位整数，再模 $10^{digits}$ 取指定位数（通常 6 位），左侧补零。\n\n" +
      "计数器每用一次递增，客户端和服务端同步。单向（哈希），不可逆。密钥在 OTP 生态里默认按 Base32 编码。",
    usage: "输入框填密钥 secret（默认 Base32，可选 hex/utf8），参数填计数器 counter、位数 digits（6-8）、HMAC 算法。点 run 输出 OTP 数字串。单向，无 decode。",
    formulas: [
      { tex: "\\text{OTP} = \\mathrm{Truncate}(\\mathrm{HMAC}(K, C)) \\bmod 10^{d}", caption: "HMAC + 动态截断 + 取模" },
    ],
    examples: [
      { in: "12345678901234567890", param: "format=utf8, counter=0, digits=6, SHA-1", out: "755224", desc: "RFC 4226 附录 D 权威向量" },
      { in: "12345678901234567890", param: "format=utf8, counter=1, digits=6, SHA-1", out: "287082", desc: "计数器 +1 后的下一个 OTP" },
    ],
    tips: [
      "密钥默认 Base32——题给一串 `JBSWY3DPEHPK3PXP` 这种的就是 Base32 密钥。",
      "计数器必须客户端/服务端同步，错位就验证失败；TOTP 用时间代替计数器解决同步问题。",
      "RFC 4226 附录 D 的 `12345678901234567890`（20 字节 ASCII）是标准测试密钥，对拍用它。",
    ],
    aka: ["hotp", "计数器 otp", "rfc 4226", "hmac 一次性密码", "hmac-based otp", "hmac otp", "计数器一次性密码", "一次性口令hotp", "hmac based one-time password", "硬件令牌otp", "计数式动态口令", "hotp令牌"],
  },

  totp: {
    what: "TOTP——RFC 6238 的时间式一次性密码（Time-Based OTP），Google Authenticator 每 30 秒跳一个码的就是它。",
    principle:
      "HOTP 的「时间版」：把当前 Unix 时间除以步长 period（通常 30 秒）得到计数器 $C=\\lfloor T/P \\rfloor$，再喂给 HOTP 的 HMAC + 动态截断流程。\n\n" +
      "因为计数器来自时间，客户端和服务端各自看时钟就能同步，无需计数器递增协议。time 参数填 0 用当前时间，填具体值可复现历史码（测试用）。支持 SHA-1/256/512。",
    usage: "输入框填密钥 secret（默认 Base32，可选 hex/utf8），参数填时间步长 period（默认 30 秒）、Unix 时间 time（0=当前）、位数 digits、HMAC 算法。点 run 输出 OTP。单向，无 decode。",
    formulas: [
      { tex: "C = \\left\\lfloor \\frac{T_{\\text{unix}}}{P} \\right\\rfloor,\\quad \\text{OTP}=\\mathrm{HOTP}(K, C)", caption: "时间换计数器再走 HOTP" },
    ],
    examples: [
      { in: "12345678901234567890", param: "format=utf8, time=59, period=30, digits=8, SHA-1", out: "94287082", desc: "RFC 6238 附录 B 权威向量（T=59 即 1970-01-01 00:00:59）" },
    ],
    tips: [
      "time=0 用当前时间——结果每次跑都会变；要复现就填具体 Unix 时间戳。",
      "默认 30 秒步长、6 位码——和手机验证码 App 完全一致，题给二维码/otpauth 链接多半就是它。",
      "RFC 6238 测试向量用 8 位码（digits=8），别和常见的 6 位混淆。",
    ],
    aka: ["totp", "时间 otp", "rfc 6238", "google authenticator", "time-based otp", "时间一次性密码", "动态验证码", "谷歌验证器", "时间同步otp", "authenticator验证码", "基于时间的一次性口令", "totp动态码"],
  },

  zuc: {
    what: "祖冲之序列密码——国密流密码标准（GM/T 0001-2012），3GPP LTE 通信加密的国产方案，和 Snow、AES-CTR 并列。",
    principle:
      "128 位密钥 + 128 位 IV 初始化一个 16 级 LFSR（有限域 $\\mathrm{GF}(2^{31}-1)$ 上的线性反馈）。每拍先做「比特重组」从 LFSR 状态抽 4 个 32 位字 W0-W3，再经非线性函数 F（含两个 S-box S0/S1 和两个线性变换 L1/L2）输出一个 32 位密钥字。\n\n" +
      "流密码自反：密钥流和明文逐字节异或得密文，同密钥流再异或还原明文。本工具 encode/decode 共用同一加密函数，区别只在输入/输出编码。",
    usage: "填密钥（16 字节 hex）和 IV（16 字节 hex），选数据编码与输出编码。encode：明文异或成密文（默认 hex 输出）；decode：密文异或还原明文（默认 utf8 输出）。自反，编解码同参。",
    examples: [
      { in: "00000000", param: "key=00*16, iv=00*16, dataEnc=hex, outEnc=hex", out: "27BEDE74", desc: "GM/T 0001-2012 标准向量：全 0 key/iv 的前 4 字节密钥流" },
      { in: "Hello", param: "key=0123456789abcdef0123456789abcdef, iv=同 key", out: "7149B6DBD1 (hex)", desc: "encode 后 decode 同参还原 Hello" },
    ],
    tips: [
      "流密码——密文和明文等长（无填充无块结构），这点和 SM4/AES 分组密码不同。",
      "认国密场景：3GPP/移动通信加密、GM/T 0001 标准引用，多半是 ZUC。",
      "key 和 IV 都必须正好 16 字节 hex（32 字符），少一位都报错。",
    ],
    aka: ["zuc", "祖冲之", "gm/t 0001", "3gpp 流密码", "祖冲之密码", "祖冲之序列密码", "zuc算法", "国密流密码", "128-eea3", "128-eia3", "商密流密码", "zuc stream cipher"],
  },

  sm2: {
    what: "SM2——国密椭圆曲线公钥密码（GM/T 0003-2012），RSA/ECC 的国产对位物。本工具仅做密文结构识别，不含加解密运算。",
    principle:
      "基于 256 位素域椭圆曲线（推荐曲线 sm2p256v1）上的点运算。加密密文采用 `C1||C3||C2` 拼装：C1 是 65 字节椭圆曲线点（以 `0x04` 开头的未压缩格式），C3 是 32 字节 SM3 哈希（验证用），C2 是密文。\n\n" +
      "本工具的识别逻辑很朴素：输入按 hex/base64 解码后，若长度 ≥97 字节且首字节为 `0x04` 就判为疑似 SM2（置信度 0.7/0.6）。真正的加解密需要完整 ECC 点乘实现，暂不支持——CTF 里见到它先认结构，运算用专用库。",
    usage: "输入框填疑似 SM2 密文（hex 或 base64），点 run 输出识别结果与置信度。无参数、无加解密、无 decode。",
    examples: [
      { in: "04 + 00 重复 96 次（194 hex 字符）", param: "（无参数）", out: "识别为 SM2 密文（置信度 0.7）：格式 C1||C3||C2…", desc: "首字节 04 且长度≥97 字节触发识别" },
      { in: "hello world", param: "（无参数）", out: "未识别为 SM2 密文", desc: "普通文本不匹配" },
    ],
    tips: [
      "认特征：hex 串以 `04` 开头且长度 ≥194 字符（97 字节），或 base64 解码后同条件——结构上像 SM2。",
      "C1||C3||C2 是旧标准顺序；新标准（GM/T 0009）有时用 C1||C2||C3，认题面注明。",
      "真要解密得用带完整 ECC 的库（如 Python gmssl / GmSSL），本工具只认外壳。",
    ],
    aka: ["sm2", "国密椭圆曲线", "gm/t 0003", "国密公钥密码", "sm2算法", "国密ecc", "商密椭圆曲线", "sm2p256v1", "国密非对称加密", "sm2椭圆曲线密码", "商用密码sm2", "国密公钥算法"],
  },

  sm9: {
    what: "SM9——国密标识密码（GM/T 0044-2016），招牌是「用邮箱/手机号当公钥」的双线性对密码。本工具仅做关键字识别，不含运算。",
    principle:
      "基于双线性对（pairing）的标识密码体系：用户的公钥直接由标识（如 `alice@example.com`）经哈希映射到椭圆曲线上的点生成，私钥由密钥生成中心（KGC）用主密钥签发。签名/密钥封装都用双线性对的性质。\n\n" +
      "因为双线性对运算复杂、无固定短前缀，本工具的识别很粗略：仅当输入文本含 `sm9` 关键字时判为疑似（低置信度 0.5）。真正的运算需要完整 pairing 实现，暂不支持。",
    usage: "输入框填任意文本，点 run 输出识别结果。无参数、无加解密、无 decode。",
    examples: [
      { in: "sm9 标识密码", param: "（无参数）", out: "识别为 SM9 相关输入（置信度 0.5）。SM9 基于双线性对，运算暂不支持。", desc: "含 sm9 关键字触发识别" },
      { in: "普通文本", param: "（无参数）", out: "未识别为 SM9 输入", desc: "无 sm9 字样不匹配" },
    ],
    tips: [
      "SM9 密文/签名无像 SM2 那样的固定前缀——靠结构特征识别困难，本工具仅凭关键字。",
      "认场景：题面提「标识密码 / IBC / 双线性对 / KGC / 用邮箱当公钥」基本就是 SM9。",
      "运算需专用库（如 GmSSL、PBC 库），本工具只标记不计算。",
    ],
    aka: ["sm9", "标识密码", "gm/t 0044", "双线性对密码", "ibc", "sm9算法", "基于标识的密码", "identity-based cryptography", "国密标识密码", "商密sm9", "标识加密", "身份基密码"],
  },
};
