/**
 * 图像隐写真题结论库（纯数据 / 纯函数）。
 *
 * 边界约定：
 * - 不读取文件、不访问 DOM、不发网络请求、不使用随机数；
 * - 仅保存“已复现的结论”和“可复现的失败边界”，不做启发式猜测；
 * - evidence 中的路径均相对证据根目录，报告与验证脚本按同一基准解析。
 */

const RESEARCH = [
  {
    file: "图片XMP元数据21018_ctfshow_misc入门_misc18 - 副本.jpg",
    status: "solved",
    method:
      "EXIF XPTitle(40091)='ctfshow{32'、Model(272)='28ac17e5f0'、Artist(315)='5d60c208f7'、" +
      "XMP MicrosoftPhoto:LensModel='2d4cf5a839}'，按此顺序拼接；flag 主体 32 位十六进制，" +
      "总长 8+32+1=41。",
    plaintext: "ctfshow{3228ac17e5f05d60c208f72d4cf5a839}",
    flag: "ctfshow{3228ac17e5f05d60c208f72d4cf5a839}",
    evidence: [
      "evidence/xmp_exif.txt",
      "evidence/xmp_rebuild.txt",
      "evidence/exif_all.txt",
      "evidence/probe_struct.txt",
    ],
  },
  {
    file: "F5_f5alsogood.jpg",
    status: "solved",
    method:
      "原始 F5（JPEG DCT 系数 + 口令置换 + (1,2^k-1,k) 矩阵编码）；口令 f5alsogood，" +
      "提取头声明 32 字节、k=7，实取 32 字节。",
    plaintext: "zip-password-is-Every0neL0veBeF5",
    evidence: [
      "evidence/f5_java_run.txt",
      "evidence/f5_payload.bin",
      "evidence/f5_try.txt",
    ],
  },
  {
    file: "Image_Steganography.png",
    status: "solved",
    method:
      "1291x1042 RGBA；alpha 通道仅第 0 行 192 个像素非 255，取值 245..252；" +
      "减 245 得 0..7，每样本取 3 bit（LSB-first），按 8 bit/字节、字节内 LSB-first 打包，" +
      "再按 UTF-16LE 解码得到 36 字符 UUID；flag 为 flag{UUID}。",
    plaintext: "8f6711e6-7bb1-44e5-9ddf-5138127235ab",
    flag: "flag{8f6711e6-7bb1-44e5-9ddf-5138127235ab}",
    evidence: [
      "evidence/alpha_row_analysis.txt",
      "evidence/img_stats.txt",
      "evidence/probe_struct.txt",
      "evidence/Image_Steganography_preview.png",
      "../R19/Image_Steganography/报告.md",
    ],
  },
  {
    file: "steg.png",
    status: "unsolved",
    verifiedNegative: true,
    method:
      "200x189 RGB；IDAT 解压长度严格等于像素原始长度、IEND 后 tail=0；" +
      "按通道×位宽 1..8×行列×MSB/LSB×偏移 0..7 扫描，未见 flag、ZIP/PNG/JPEG/RAR/7z/PDF 头或 zlib/gzip 流；" +
      "QR/DataMatrix/Code128/EAN 解码、原图与位平面 OCR 均无文本。",
    boundary:
      "标准 PNG LSB/位平面路线未解出明文；唯一颜色 18239、无额外 chunk、无尾部数据；" +
      "第三方 LSB/口令工具按常见口令尝试均报错。可复现失败：固定上述 2560 组参数逐组提取，结果为空或噪声。",
    evidence: [
      "evidence/steg_boundary.txt",
      "evidence/scan_imgs.txt",
      "evidence/zsteg_fullwidth.txt",
      "evidence/steg_preview.png",
    ],
  },
  {
    file: "LSB_lovekfc.png",
    status: "partial",
    verifiedNegative: true,
    method:
      "按通道×位宽 1..8×行列×MSB/LSB×偏移 0..7 全扫描、" +
      "第三方 LSB/口令工具及关键字 XOR 均未检出隐藏载荷。",
    plaintext: "keyword: lovekfc",
    boundary:
      "只确认可见关键字，未找到隐藏 flag：360x245 RGBA、唯一颜色 432；纯白像素 74897 个，" +
      "其 RGB 全部 8 个位平面均为 1（背景未被 LSB 修改）；核心黄色 (255,201,15) 像素 4924 个；" +
      "单 IDAT、无额外 chunk、IEND 后 tail=0。2560 组 LSB 参数未命中 flag/容器头/zlib/gzip。",
    evidence: [
      "evidence/lsb_lovekfc_boundary.txt",
      "evidence/scan_imgs.txt",
      "evidence/zsteg_fullwidth.txt",
      "evidence/ocr_planes.txt",
      "evidence/LSB_lovekfc_preview.png",
    ],
  },
  {
    file: "zip多层嵌套解压.zip",
    status: "solved",
    method:
      "6 层嵌套 zip；最内层 9 个 AES-256 ZIP(AE-3) 分卷 flag.zip.001..009；" +
      "口令 xtr4m（^([a-z]){3}\\d[a-z]$，并行枚举到 index 4,175,456）；" +
      "PBKDF2-HMAC-SHA1 1000 轮派生 66B，先用 pv 过滤、再用 HMAC-SHA1 前 10B 认证；" +
      "AES-256-CTR 小端计数器解密后按 .001→.009 拼接；末 zip 无 EOCD，" +
      "按 local header raw-deflate 解出 flag.txt，CRC32 af1686a3 校验通过。",
    flag: "flag{U_R_th3_ma5ter_0f_dec0mpress}",
    evidence: [
      "evidence/brute_zip_aes_node.txt",
      "evidence/zip_password.txt",
      "evidence/decrypt_zip_aes.txt",
      "evidence/final_flag.txt",
      "out/zip_nested/flag_merged.zip",
    ],
  },
  {
    file: "zip rbkcrack明文攻击.rar",
    status: "solved",
    method:
      "RAR5 未加密，直接解出 writeup PDF、Triglavian.zip 与 16 字节 PNG 头；" +
      "用 16B PNG 头对 Triglavian.zip 做 ZIP 已知明文攻击，得到密钥 " +
      "be056038 0a143c0c 1ea08ca5，解密出 Triglavian.png；按 Triglavian 字体字形对照得 flag。",
    flag: "flag{TriG1aviAn_Techn0lo9y}",
    evidence: [
      "evidence/bkcrack_attack.txt",
      "evidence/bkcrack_attack.mjs",
      "evidence/probe_struct.txt",
      "out/rar/recovered.png",
      "out/rar/zip rbkcrack明文攻击/执行命令.txt",
    ],
  },
  {
    file: "bugku又一张图片，还单纯吗-foremost.jpg",
    status: "solved",
    method:
      "foremost 魔数分离出 4 段 JPEG（offset 0 / 7690 / 158792 / 162196）；" +
      "第 4 段 160×111 低对比度图内嵌 flag 文本；放大/增强后 OCR 得 " +
      "falg{NSCTF_e6532a34928a3d1dadd0b049d5a3cc57}（题目原文就是 falg，不是 flag）。",
    plaintext: "falg{NSCTF_e6532a34928a3d1dadd0b049d5a3cc57}",
    flag: "falg{NSCTF_e6532a34928a3d1dadd0b049d5a3cc57}",
    evidence: [
      "../R19/foremost/报告.md",
      "../R19/foremost/carved/4_off162196.png",
      "../R19/foremost/carved/2_off7690.png",
    ],
  },
  {
    file: "bugku细心的大象_exif+文件包含.jpg",
    status: "solved",
    method:
      "EXIF XPTitle(40092) UTF-16BE = TVNEUzQ1NkFTUDEyM3p6 → Base64 解出 MSDS456ASD123zz；" +
      "从 6.4MB JPEG 尾部切出 RAR（offset 6391983），用该口令解出 2.png；" +
      "IHDR CRC 错误，修正高度 0x01A4(420)→0x01F4(500) 并重算 CRC；alpha 通道 OCR 得 " +
      "BUGKU{a1e5aSA}。",
    plaintext: "BUGKU{a1e5aSA}",
    flag: "BUGKU{a1e5aSA}",
    evidence: [
      "../R19/elephant/报告.md",
      "../R19/elephant/ch_alpha.png",
      "../R19/elephant/2_500_view.png",
      "../R19/elephant_tail.rar",
    ],
  },
];

for (const item of RESEARCH) Object.freeze(item);

export const STEGO_RESEARCH = Object.freeze(RESEARCH);

/**
 * 按文件名查结论。优先精确匹配；其次按路径 basename 匹配。
 * @param {string} fileName
 * @returns {object|null}
 */
export function getStegoResearch(fileName) {
  const name = String(fileName || "").trim();
  if (!name) return null;
  const exact = STEGO_RESEARCH.find((x) => x.file === name);
  if (exact) return exact;
  const base = name.replace(/\\/g, "/").split("/").pop();
  return STEGO_RESEARCH.find((x) => x.file === base) || null;
}
