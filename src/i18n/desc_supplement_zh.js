/*
 * i18n/desc_supplement_zh.js — 高频 op 描述中文补充表。
 *
 * 仅补充 op.{opId}.desc，不改 zh.js 主表。key 与 desc_supplement_en.js 完全同构。
 * 内容照 registry 里 op 的 name/desc 推导，准确描述功能。
 * 覆盖：base 全系列 + classic 核心 + modern 核心 + hash 核心 + stego 核心 + fancy 核心。
 */
export default {
 // ---- base 系列 ----
  "op.base16.desc": "十六进制编码，每字节用两个十六进制字符表示，支持自定义码表与大写/空格分隔。",
  "op.base32.desc": "RFC 4648 标准的 Base32 编码，5 位分组，支持自定义码表。",
  "op.base36.desc": "把整段字节视为大整数，按 0-9a-z 字符表转换为 36 进制字符串。",
  "op.base45.desc": "RFC 9285 Base45 编码，2 字节映射为 3 字符，QR 码常用。",
  "op.base58.desc": "Base58 编码（Bitcoin 字母表），去掉易混淆字符，支持自定义码表。",
  "op.base62.desc": "Base62 编码，使用 0-9A-Za-z 字符集，支持自定义码表。",
  "op.base64.desc": "标准 Base64 编码，支持 URL-safe 变体与自定义码表。",
  "op.base85.desc": "Adobe Ascii85 编码，用 <~ ~> 包裹，z 压缩零字节组。",
  "op.base91.desc": "basE91 编码，将字节流映射为 91 字符集，效率高于 Base64。",
  "op.base92.desc": "Base92 编码，13 位分块映射为字符对，支持自定义码表。",
  "op.base100.desc": "Base100 emoji 编码，每个字节映射为一个 emoji（U+1F3F7 起始）。",
  "op.radixN.desc": "文本与 N 进制大整数互转（N = 2..95），可自定义码表。",
  "op.baseCustom.desc": "自定义字母表的 Base 编码，进制由字母表长度决定。",

 // ---- classic 古典密码 ----
  "op.vigenere.desc": "维吉尼亚密码：按字母密钥循环移位加密，密钥仅保留字母。",
  "op.gronsfeld.desc": "Gronsfeld 密码：用数字串作密钥的维吉尼亚变体。",
  "op.beaufort.desc": "Beaufort 密码：自反式维吉尼亚变体，加密与解密用同一函数。",
  "op.autokey.desc": "AutoKey 自动密钥密码：密钥流由 keyword 接明文自身延伸。",
  "op.porta.desc": "Porta 密码：自反式替换密码，按密钥字母选择替换行。",
  "op.playfair.desc": "Playfair 密码：5×5 键控方阵，双字母一组做行列变换，J 合并到 I。",
  "op.nihilist.desc": "Nihilist 密码：键控 Polybius 方阵将字母映射为两位数。",
  "op.columnar.desc": "列移位密码：按密钥字母顺序重排列，再逐列读取。",
  "op.hill.desc": "Hill 希尔密码：用 n×n 矩阵 mod 26 加密，密钥长度须为完全平方数。",
  "op.affine.desc": "仿射密码：y = a*x + b mod 26，要求 a 与 26 互质。",
  "op.bifid.desc": "Bifid 双分密码：按 period 分组的 Polybius 坐标转置。",
  "op.trifid.desc": "Trifid 三分密码：3×3×3 方阵编码，密钥表须 27 字符。",
  "op.polybius.desc": "Polybius 方阵：5×5 方阵（J→I）将字母映射为行列坐标对。",
  "op.adfgx.desc": "ADFGX 密码：Polybius 替换（5×5）后接列移位，一战德军军用。",
  "op.adfgvx.desc": "ADFGVX 密码：ADFGX 的 6×6 扩展版，字母表含数字。",
  "op.foursquare.desc": "FourSquare 四方密码：用两个 25 字母密钥方阵做双字母替换。",
  "op.graycode.desc": "格雷码：文本与格雷码二进制串互转，相邻数仅差一位。",

 // ---- modern 现代加密 ----
  "op.aes.desc": "AES 高级加密标准，支持 ECB/CBC/CFB/OFB/CTR（纯 JS）与 GCM（WebCrypto），密钥 16/24/32 字节。",
  "op.des.desc": "DES 数据加密标准（FIPS-46-3），密钥 8 字节，块大小 8 字节。",
  "op.des3.desc": "3DES 三重 DES（EDE），密钥 16 或 24 字节，块大小 8 字节。",
  "op.rc4.desc": "RC4 流密码，加密解密同一变换，密钥任意长度。",
  "op.xor.desc": "XOR 重复密钥异或，自反可逆，CTF 最常用的对称变换之一。",
  "op.fernet.desc": "Fernet 对称令牌格式：AES-128-CBC 加密 + HMAC-SHA256 签名，密钥为 base64url 编码的 32 字节。",
  "op.rsa.desc": "RSA 教学级模幂运算：加密 c=mᵉ mod n，解密 m=cᵈ mod n，十进制大数直接输入。",

 // ---- hash 哈希 / 校验 ----
  "op.md5.desc": "MD5 消息摘要，输出 128 位哈希（RFC 1321，纯 JS 实现）。",
  "op.md4.desc": "MD4 消息摘要，输出 128 位哈希（RFC 1320），NTLM 哈希的基础。",
  "op.sha1.desc": "SHA-1 消息摘要，输出 160 位哈希（WebCrypto 实现）。",
  "op.sha256.desc": "SHA-256 消息摘要，输出 256 位哈希（WebCrypto 实现）。",
  "op.sha384.desc": "SHA-384 消息摘要，输出 384 位哈希（WebCrypto 实现）。",
  "op.sha512.desc": "SHA-512 消息摘要，输出 512 位哈希（WebCrypto 实现）。",
  "op.hmac.desc": "HMAC 消息认证码，需提供密钥并选择哈希算法（SHA-1/256/384/512，WebCrypto）。",
  "op.crc32.desc": "CRC32 校验，IEEE 802.3 标准多项式，查表法实现。",
  "op.crc16.desc": "CRC16 校验，CCITT-FALSE 标准，多项式 0x1021。",
  "op.ntlm.desc": "NTLM 哈希，对 UTF-16LE 编码的密码做 MD4，Windows 密码存储格式。",
  "op.sha3.desc": "SHA-3 哈希（FIPS 202 标准），位宽可选 224/256/384/512，纯 JS Keccak 实现。",
  "op.keccak256.desc": "Keccak-256 哈希，以太坊常用，padding 为 0x01（与 SHA3-256 的 0x06 不同）。",
  "op.shake128.desc": "SHAKE128 可扩展输出哈希（FIPS 202），输出长度可由参数指定。",
  "op.shake256.desc": "SHAKE256 可扩展输出哈希（FIPS 202），输出长度可由参数指定。",

 // ---- stego 隐写 ----
  "op.zeroWidth.desc": "零宽字符隐写：将隐藏文本编码为零宽字符（默认 U+200C/200D/202C/FEFF），夹带在载体文本中。",
  "op.zeroChar.desc": "零宽摩斯密码：明文先转摩斯电码，再用 U+200B/200C/200D 替换分隔符/点/划，CJK 走 \\uXXXX 转义。",
  "op.zwTags.desc": "Unicode Tag 走私：将字节编码到 U+E0000 平面 Tag 字符，LLM prompt 注入常用载体。",
  "op.zwVarSel.desc": "变体选择器隐写：利用 U+FE00-FE0F 与 U+E0100-E01EF 附加任意字节流到文本。",
  "op.emojiSubst.desc": "emoji 替换隐写：base64 字母表逐字符替换为 65 个 emoji，支持 rotation 旋转（不含 AES）。",
  "op.tadpole.desc": "蝌蚪文加解密：用 U+06D6-U+06EC 装饰符编码，含校验和，支持蝌蚪文与 Base64 双格式。",
  "op.lsbImage.desc": "LSB 像素隐写：将数据写入图像像素最低有效位，前 32 位存长度，支持 R/G/B/A 通道选择。",

 // ---- fancy 花式 / CTF 编码 ----
  "op.morse.desc": "摩斯电码（ITU-R M.1677）：字母/数字/标点映射为点和划，用 / 分词。",
  "op.bacon.desc": "培根密码：每字母编码为 5 位 a/b 串，支持 24 字母版（I=J, U=V）与 26 字母版。",
  "op.railFence.desc": "栅栏密码：W 型 zigzag 沿栏数写入后逐行读取，参数为栏数。",
  "op.caesar.desc": "凯撒密码：字母按指定位移量移位，加密 +shift、解密 -shift。",
  "op.rot13.desc": "ROT13：字母移位 13 位，自反（再执行一次即还原）。",
  "op.rot5.desc": "ROT5：数字移位 5 位，自反变换。",
  "op.rot18.desc": "ROT18：ROT13 与 ROT5 的组合，同时处理字母与数字，自反。",
  "op.rot47.desc": "ROT47：ASCII 33-126 区间移位 47 位，自反变换。",
  "op.atbash.desc": "Atbash 密码：字母表反转映射（A↔Z），自反变换。",
  "op.a1z26.desc": "A1Z26 编码：字母与数字 1-26 一一对应互转。",
  "op.dna.desc": "DNA 编码：3 字母密码子（A/C/G/T）与字符互转。",
  "op.keyboard.desc": "键盘坐标编码：QWERTY 键盘的行列坐标表示字母（如 Q=11）。",
  "op.brainfuck.desc": "BrainFuck 语言：8 指令极简编程语言，支持执行与代码生成，步数上限 500 万。",
};
