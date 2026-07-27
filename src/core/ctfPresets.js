/**
 * ctfPresets.js —— CTF 高频题型置顶/高亮数据（纯数据模块）
 *
 * 用途：
 * 给二级菜单里 CTF 竞赛最常考的 op 加星标 + 文字高亮，便于选手快速定位。
 * 本模块只提供「哪些 id 算高频」和「为什么」，不改菜单顺序、不做任何注册。
 * UI 层（main.js）渲染二级菜单项时，若 op.id 命中 CTF_HOT 就加星标/高亮
 * 可选地读 CTF_HOT_META[id].rank 分两档着色、读 .note 做 tooltip。
 *
 * 依据：
 * CTF misc / crypto / reverse 三类高频题型——Base 家族、古典密码（凯撒/移位/
 * 培根/栅栏/波利比奥斯/猪圈等）、esolang（brainfuck/jsfuck）、摩尔斯
 * 现代对称密码（AES/DES/RC4）、RSA 攻击套件、常见哈希与哈希识别/爆破
 * URL/HTML/QP 等文本转义、JWT、中文特色编码（当铺/佛曰/社会主义核心价值观）
 * 隐写（LSB/EXIF/零宽/PNG 宽高/盲文）、键盘密码、词频分析。
 *
 * 约束：
 * - 纯数据，无 import、无副作用。
 * - CTF_HOT / CTF_HOT_META 里的每个 id 都必须在 registry 里真实注册存在
 * 宁可少标也不标不存在的 id。当前清单已逐个对照过源码 register 的 id。
 * - 数量刻意控制在 40~70，标太多等于没标。
 */

// 超高频（rank 1）：几乎每场赛都可能出现，选手最先试的那一批。
// 常见（rank 2）：分方向的常客，出现频率次于 rank 1。

export const CTF_HOT_META = {
 // ---- Base 家族 ----
  base64:            { rank: 1, note: "最常见编码，flag 十有八九先试它" },
  base32:            { rank: 1, note: "全大写+等号补齐，一眼可认" },
  base16:            { rank: 1, note: "即 Hex，最基础的字节表示" },
  base58:            { rank: 2, note: "比特币/短链常用，无易混字符" },
  base85:            { rank: 2, note: "Ascii85/Z85，密度高于 base64" },
  base91:            { rank: 2, note: "更高密度变体，偶见于 misc" },
  base62:            { rank: 2, note: "去符号字母数字集，短码常用" },
 // base64url 已合并进 base64 op（urlsafe 参数），base64 已在上方 rank1 星标，删除重复行。

 // ---- 古典：替换与移位 ----
  caesar:            { rank: 1, note: "凯撒移位，古典密码入门款" },
  caesarBrute:       { rank: 1, note: "凯撒 26 位全爆破，不知位移就用它" },
  rot13:             { rank: 1, note: "固定移 13，出镜率最高的凯撒特例" },
  rot47:             { rank: 2, note: "覆盖可见 ASCII 的 ROT 变体" },
  rot8000:           { rank: 2, note: "Unicode 版 ROT，输出一堆怪字" },
  atbash:            { rank: 1, note: "字母表镜像替换，常与凯撒混考" },
  affine:            { rank: 2, note: "仿射密码 ax+b，需求逆元" },

 // ---- 古典：多表/矩阵/几何 ----
  railFence:         { rank: 1, note: "栅栏密码，misc 高频" },
  bacon:             { rank: 1, note: "培根密码，两态编码常藏在大小写/字体里" },
  polybius:          { rank: 2, note: "波利比奥斯方阵，坐标式替换" },
  bifid:             { rank: 2, note: "双分密码，polybius 的进阶" },
  adfgvx:            { rank: 2, note: "ADFGVX 战地密码，方阵+换位" },
  hill:              { rank: 2, note: "希尔密码，矩阵乘法加密" },
  a1z26:             { rank: 2, note: "A=1..Z=26 序号编码，极常见" },
  pigpen:            { rank: 2, note: "猪圈密码，图形替换" },

 // ---- Esolang ----
  brainfuck:         { rank: 1, note: "Brainfuck，reverse/misc 常客" },
  ook:               { rank: 2, note: "Ook! 是 Brainfuck 的等价方言" },
  jsfuck:            { rank: 1, note: "只用 6 个符号写 JS，web/misc 高频" },
  aaencode:          { rank: 2, note: "颜文字 JS 混淆" },

 // ---- 摩尔斯/信号/生物 ----
  morse:             { rank: 1, note: "摩尔斯电码，点划信号必备" },
  semaphore:         { rank: 2, note: "旗语，图片题偶见" },
  dna:               { rank: 2, note: "ACGT 碱基编码，misc 常见套路" },

 // ---- 现代对称/异或 ----
  aes:               { rank: 1, note: "AES，现代密码题主力" },
  des:               { rank: 2, note: "DES 分组密码" },
  des3:              { rank: 2, note: "3DES/TripleDES" },
  rc4:               { rank: 2, note: "RC4 流密码，reverse 常还原" },
  xor:               { rank: 1, note: "异或，crypto/reverse 万金油" },
  xorBrute:          { rank: 2, note: "单字节异或爆破，未知 key 就用它" },

 // ---- webshell 流量解密预设 ----
  godzillaPhpXorBase64: { rank: 2, note: "哥斯拉 PHP_XOR_BASE64，Web 流量取证高频" },
  behinderAesEcb:       { rank: 2, note: "冰蝎 v3 AES-ECB，Web 流量取证高频" },

 // ---- RSA 攻击套件 ----
  rsa:               { rank: 1, note: "RSA 通用加解密入口" },
  rsaWiener:         { rank: 2, note: "维纳攻击，d 过小时可解" },
  rsaCommonModulus:  { rank: 2, note: "共模攻击，同 n 不同 e" },
  rsaSmallE:         { rank: 2, note: "小 e（如 e=3）低指数攻击" },
  rsaFermat:         { rank: 2, note: "费马分解，p、q 相近时秒解" },
  rsaCrt:            { rank: 2, note: "CRT/Hastad 相关，dp/dq 已知" },

 // ---- 哈希 ----
  md5:               { rank: 1, note: "MD5，最常出现的哈希" },
  sha1:              { rank: 2, note: "SHA-1" },
  sha256:            { rank: 1, note: "SHA-256" },
  sha512:            { rank: 2, note: "SHA-512" },
  hmac:              { rank: 2, note: "HMAC 消息认证" },
  ntlm:              { rank: 2, note: "NTLM，Windows 口令哈希" },
  hashTypeIdentify:  { rank: 1, note: "拿到一串哈希先识别类型" },
  hashDictCrack:     { rank: 2, note: "字典爆破哈希还原明文" },

 // ---- 文本/网络转义与 Token ----
  url:               { rank: 1, note: "URL 百分号编码，web 题常见" },
  htmlEntity:        { rank: 2, note: "HTML 实体，&#..; 形式" },
  quotedPrintable:   { rank: 2, note: "QP 编码，邮件/=XX 形式" },
  unicodeEscape:     { rank: 2, note: "\\uXXXX 转义" },
  jwt:               { rank: 1, note: "JWT 解析，web 高频" },
  jwtNone:           { rank: 2, note: "JWT alg:none 伪造攻击" },

 // ---- 中文特色 ----
  pawnshop:          { rank: 2, note: "当铺密码，按汉字笔画出头数" },
  shzyhxjzg:         { rank: 2, note: "社会主义核心价值观编码" },
  foyu:              { rank: 2, note: "佛曰/新佛曰隐写" },

 // ---- 隐写 ----
  lsbImage:          { rank: 1, note: "LSB 图片隐写，misc 招牌" },
  exifExtract:       { rank: 2, note: "EXIF 元数据，flag 常藏其中" },
  zeroWidth:         { rank: 2, note: "零宽字符隐写" },
  pngHeight:         { rank: 2, note: "PNG 宽高改回，CRC 报错的图" },
  braille:           { rank: 2, note: "盲文点字编码" },
  bin2img:           { rank: 2, note: "0/1 位流转黑白点阵图，flag 常成像" },
  imgFft:            { rank: 2, note: "图像 2D FFT 频谱，频域藏 flag 现形" },

 // ---- 取证/文件修复 ----
  pngSizeRecover:    { rank: 2, note: "PNG 宽高 CRC 爆破恢复，改高度藏图经典" },
  bmpSizeRecover:    { rank: 2, note: "BMP 宽高反推修复，无 CRC 靠数据量" },

 // ---- 键盘密码 ----
  keyboardShift:     { rank: 2, note: "键盘位移，按键位偏移替换" },
  keyCode:           { rank: 2, note: "键码/扫描码" },
  keyword9:          { rank: 2, note: "九键手机键盘输入" },

 // ---- 进制/分析 ----
  radixConvert:      { rank: 2, note: "任意进制互转" },
  mixHexOctBin:      { rank: 2, note: "混合进制串拆解" },
  freqAnalysis:      { rank: 2, note: "词频分析，破单表替换的第一步" },
};

// 由 META 派生，避免两处清单不同步。UI 判定用它即可：CTF_HOT.has(op.id)
export const CTF_HOT = new Set(Object.keys(CTF_HOT_META));
