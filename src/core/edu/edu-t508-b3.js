/*
 * edu-t508-b3.js — T508 批三·压缩校验卡科普卡（compressExt2.js）。
 * rle / lzw / elias / verhoeff / lz4Dec / bzip2Dec
 * 示例输出全部来自实跑（test.mjs 同口径），无编造。
 */
export default {
  rle: {
    what: "RLE 行程编码（Run-Length Encoding）——最古老的压缩思想：把连续重复的字段换成「计数 + 字符」，AAAAA 存成 5A。对大面积重复的数据立竿见影，对无重复数据反而膨胀，它是 fax（G3/G4）、PCX、BMP 行压缩和 bzip2 前置 RLE 的共同祖先。",
    principle:
      "三个口径：\n\n" +
      "- 计前式：`4A3B` = AAAABB（dCode「Nombre puis Caractère」）\n" +
      "- 计后式：`A4B3` = AAAABB（dCode 默认，「Caractère puis Nombre」；计数 1 可省略）\n" +
      "- 打包式：字节对 (count, value) 的 hex，如 `02410342` = AABBB（count 1-255）\n\n" +
      "计数可变长（`12W` = 12 个 W）或定长 N 位（`04A`）。变长模式下重复字符本身是数字会产生二义性（`121` 读不出 12 个 1 还是 1 个 21），定长 / 打包式才能无损承载纯数字数据（dCode 页面示例：11111111111122 → 12-1,2-2）。压缩率 $\\frac{原长-编码长}{原长}$，无重复时为负。",
    usage: "默认计前式 + 变长计数。解密选同一格式即可；数字密文请切「定长计数」或「打包式」。超长行程（>10^N-1）在定长档会自动分段（300 个 A → 99A+99A+99A+3A）。",
    examples: [
      { in: "DDDDDCCCCOOODDE", param: "计后式（dCode 官方例）", out: "D5C4O3D2E1", desc: "15 字符压成 10 字符，压缩率 33%" },
      { in: "D5C4O3D2E1", param: "计后式解密", out: "DDDDDCCCCOOODDE", desc: "往返无损" },
      { in: "WWWWWWWWWWWWABC", param: "计前式", out: "12W1A1B1C", desc: "变长计数 12W" },
      { in: "AABBB", param: "打包式", out: "02410342", desc: "hex：02 41 | 03 42（计数+值字节对）" },
    ],
    tips: [
      "密文形如「数字与字母交替、数字多为一两位」优先怀疑 RLE；纯数字密文则需定长/打包口径。",
      "打包式是二进制友好的形态（PCX/BMP 风格 count+value 字节对），hex 呈现。",
      "RLE 不改变字符集合——明文的字母频率分布原样保留，只压缩长度。参考 https://www.dcode.fr/compression-rle 。",
    ],
    aka: ["rle", "行程编码", "游程编码", "run length encoding", "run-length", "游程压缩", "行程长度编码", "rle compression", "pcx 压缩", "游程计数", "run length", "repetition coding"],
  },

  lzw: {
    what: "LZW（Lempel–Ziv–Welch）——字典序压缩的经典：初始字典装全部单字节（0-255），每读入一个字符就尝试延长当前串，串不在字典里时输出它的编号并把「串+新字符」登记为新条目。GIF 图像数据、TIFF、UNIX compress、PDF 的 LZWDecode 流都用它或其变体。",
    principle:
      "GIF 档口径：初始码本 256 项（单字节），clear 码 = 256（重置码本）、EOD 码 = 257（结束），新串从 258 号开始；码宽从 9 位起步，码本涨到 $2^{w}$ 时加宽到 $w{+}1$ 位，上限 12 位——满了发 clear 重置（GIF 惯例）。位流 LSB-first 打包（GIF 特有：低位先入字节；TIFF 才是 MSB-first）。\n\n" +
      "解码端每收一个码就输出对应串，同时用「上一串 + 本串首字符」补登新条目——解码器永远比编码器慢一拍，恰好同步。遇到「码 = 下一空位」的 KwKwK 情形（如 AAAAAA），输出 = 上一串 + 上一串首字符。",
    usage: "编码输入文本 → 输出 hex 位流；解码粘贴 hex（base64 也认）。GIF 文件取证时用 minCodeSize 档（2-8，GIF 数据段前的那个字节）；定长档给固定位宽的变体流（无 clear/EOD）。与既有 LZString op 不是一回事：那是 pieroxy JS 库变体（字典编码与打包都不等价）。",
    examples: [
      { in: "TOBEORNOTTOBE", param: "GIF 档默认", out: "00a93c1152e48914274fa808241810", desc: "clear + 12 个码 + EOD 的 9 位 LSB 流" },
      { in: "00a93c1152e48914274fa808241810", param: "同档解密", out: "TOBEORNOTTOBE", desc: "往返无损" },
      { in: "mississippi", param: "定长 12 位档", out: "06d0690730731011030700700690", desc: "无 clear/EOD，每码恰 12 位" },
    ],
    tips: [
      "本 op 已用 PIL 生成的真实 GIF 文件数据段对拍验证（含位宽增长与码本满重置路径）。",
      "GIF 取证套路：文件头找 0x2C 图像描述符 → 读 minCodeSize 字节 → 收集子块 → 粘给本 op（minCodeSize 设成读到的值）。",
      "LZW 的码本随数据自动生长——解码方不需要传字典，这是它胜过 LZ78 工程化的关键。参考 Wikipedia “Lempel–Ziv–Welch”。",
    ],
    aka: ["lzw", "lzw 压缩", "lempel-ziv-welch", "gif lzw", "lzw 解压", "gif 压缩", "tiff lzw", "字典编码", "lzw 编码", "welch 压缩", "lz78 变体", "lzw codec"],
  },

  elias: {
    what: "Elias gamma / delta 编码——universal 前缀码两兄弟：给任意正整数一个自定界的二进制表示，不需要提前知道数值范围，也不需要分隔符。gamma 短数便宜、delta 长数便宜，是信息论教科书与搜索引擎索引压缩（P4Delta 等的前置件）的常客。",
    principle:
      "gamma(x)：设 $N = \\lfloor \\log_2 x \\rfloor$，输出 $N$ 个 0 接上 x 的完整二进制。如 5 = 101 → `00101`。码长 $2\\lfloor \\log_2 x \\rfloor + 1$ 位。\n\n" +
      "delta(x)：先对 $N{+}1$ 做 gamma 编码，再接 x 去掉最高位后的 $N$ 位尾段。如 5（N=2，gamma(3) = 011，尾段 01）→ `01101`。Wikipedia 权威例码：1→1、2→0100、4→01100、8→00100000。\n\n" +
      "解码即逆过程：数 0 到首个 1 得一元值，再读对应位数拼回整数。只支持 $x \\geq 1$（0 无法编码，可先 +1 偏移）。",
    usage: "输入一组正整数（空格/逗号分隔）→ 输出紧贴位串（或每码一空格易读档）；解码贴 0/1 串（容忍空白）输出数字序列。",
    examples: [
      { in: "1 2 3 4 5", param: "gamma", out: "10100110010000101", desc: "1|010|011|00100|00101" },
      { in: "10100110010000101", param: "gamma 解密", out: "1 2 3 4 5", desc: "位流自定界，无需分隔符" },
      { in: "1 2 3 4 5 6 7 8", param: "delta", out: "1010001010110001101011100111100100000", desc: "delta 对大数更省位" },
      { in: "001010011", param: "delta 解密（Wikipedia 例）", out: "19", desc: "两个 0 → gamma 读 101=5 → N=4 → 读 4 位 0011 → 2^4+3=19" },
    ],
    tips: [
      "gamma 码 1-8：1、010、011、00100、00101、00110、00111、0001000——见到「一串 0 开头 + 短二进制」的位流就想想它。",
      "CTF 里 Elias 常与 Golomb / Rice / Fibonacci 编码混出题，先用 1 的编码形态区分（gamma(1) = 1，Fibonacci(1) = 11）。",
      "位数统计：gamma 用 $2\\lfloor\\log_2 x\\rfloor+1$ 位，delta 用 $\\lfloor\\log_2 x\\rfloor + 2\\lfloor\\log_2(\\lfloor\\log_2 x\\rfloor+1)\\rfloor + 1$ 位——超大数时 delta 反超。参考 Wikipedia “Elias gamma coding / Elias delta coding”。",
    ],
    aka: ["elias gamma", "elias delta", "elias 编码", "gamma 编码", "delta 编码", "elias gamma coding", "universal code", "前缀码", "gamma 码", "elias delta coding", "一元扩展码", "elias"],
  },

  verhoeff: {
    what: "Verhoeff 校验算法——用二面体群 $D_5$（正五边形的 10 个对称操作）构造的十进制校验位方案：能 100% 捕获单个数字错写，且几乎全部相邻换位错（0↔9 除外），比模 11 加权和强得多。印度 Aadhaar 身份号、德国增值税号等都在用。",
    principle:
      "三张表撑起一切：$d$——$D_5$ 的 10×10 凯莱表（非交换！）；$p$——8 阶循环置换 $(1\\,5\\,8\\,9\\,4\\,2\\,7\\,0)(3\\,6)$，按位序 $i \\bmod 8$ 取用；$inv$——逆元表。\n\n" +
      "校验：数字右起逐位算 $c = d[c][\\;p[i \\bmod 8][n_i]\\;]$，全算完 $c = 0$ 即通过。生成：末尾补 0 占位跑同一循环（其余数位因此平移一位），校验位 = $inv[c]$（Wikipedia 例：236 → 2363）。",
    usage: "validate 校验整串（输出通过/失败 + 应有校验位）；generate 算出并追加校验位（纯数字输出，可链式使用）；strip 校验通过后剥掉末位。输入容忍空格/连字符。",
    examples: [
      { in: "236", param: "generate", out: "2363", desc: "Wikipedia 例：校验位 = inv(2) = 3" },
      { in: "2363", param: "validate", out: "2363 → Verhoeff 校验通过 ✓（3 位数据 + 校验位 3）", desc: "c 归零" },
      { in: "2364", param: "validate", out: "2364 → Verhoeff 校验失败 ✗（校验值 c=1 ≠ 0；若前 3 位正确，校验位应为 3）", desc: "末位错写立即暴露" },
    ],
    tips: [
      "长数字串（身份证式的 10-12 位）校验位不明时，把 Verhoeff / Luhn / Damm / mod 97 各试一遍是标准开局。",
      "与 Luhn（模 10 双倍和）区分：Luhn 漏检部分换位，Verhoeff 理论上只放 0↔9 互换。",
      "数字右起处理是关键坑——从左起算必错。参考 Wikipedia “Verhoeff algorithm”（含完整三表）。",
    ],
    aka: ["verhoeff", "verhoeff 算法", "verhoeff 校验", "verhoeff algorithm", "verhoeff check", "二面体群校验", "d5 校验", "verhoeff checksum", "verhoeff check digit", "dihedral group 校验", "aadhaar 校验"],
  },

  lz4Dec: {
    what: "LZ4 解压——把 LZ4 块格式 / 帧格式还原为原始数据。LZ4 是极致速度取向的 LZ77 族算法：压缩率换速度，解压吞吐可达数 GB/s，Linux 内核、Zstd 的快速档、数据库 WAL 都在用。",
    principle:
      "块格式（block format v1.0）：一串「序列」组成。每序列先来一个 token 字节——高 4 位 = 字面量长度（15 表示后跟 255 续位字节累加）、低 4 位 = 匹配长度减 4（同样 15 续位）；然后是字面量数据本体、2 字节小端偏移（1-65535，0 非法）、匹配长度续位。匹配从历史输出里按偏移逐字节拷贝（偏移小于匹配长即天然支持重叠复制）。末序列只有字面量。\n\n" +
      "帧格式：magic `04 22 4D 18`（0x184D2204）+ FLG/BD 描述字节 + 可选 8 字节内容长 + HC 头校验（xxh32 的第二字节）+ 数据块（4 字节小端尺寸，最高位置 1 = 未压缩存储块）+ `00000000` 结束标记 + 可选 xxh32 内容校验——本工具全链校验。",
    usage: "输入 hex / base64 自动识别（拖文件走原始字节通道）；格式选自动即按 magic 分流帧/块。二进制结果可勾选输出为文件下载。",
    examples: [
      { in: "6868656c6c6f2006005068656c6c6f", param: "块格式", out: "hello hello hello hello", desc: "python lz4.block 生成：6 字面量 + 偏移 6 匹配 + 5 字面量收尾" },
      { in: "04224d187c4029000000000000004716000000cf68656c6c6f20776f726c64200c00055068656c6c6f8f08a7e9000000006035edd7", param: "帧格式（自动档）", out: "hello world hello world hello world hello", desc: "帧头校验/块校验/内容 xxh32 校验全开、全过" },
    ],
    tips: [
      "hex 以 04224d18 开头是帧、直接喂裸序列是块——自动档看 magic 分流，无需手选。",
      "对拍源是 python lz4 库（块 + 帧含校验和全开的样本）；xxh32 实现经真帧校验和验证。",
      "LZ4 高压缩档常配 zstd 出场；取证时 trailer 里扒出的 .lz4 文件直接 hex 喂进来。参考 github.com/lz4/lz4 的 Block/Frame format 文档。",
    ],
    aka: ["lz4 解压", "lz4 decompress", "lz4", "lz4 块格式", "lz4 frame", "lz4 帧格式", "from lz4", "lz4 decode", "unlz4", "lz4 block format", "lz4decompress", "0x184d2204"],
  },

  bzip2Dec: {
    what: "bzip2 解压——完整还原 BZh 流：三层游程 + BWT + MTF + 多表 Huffman 的经典压缩链。bzip2 以「压得比 gzip 狠、比 XZ 快」著称，Linux 发行版的源码包与 tar.bz2 取证是它的主场。",
    principle:
      "五级流水线（解压逆序执行）：\n\n" +
      "1. RLE1：4 连同字节后跟一个计数字节（0-255 个续份）；\n" +
      "2. BWT：全矩阵排序变换，origPtr（24 位）标记原行位置，逆变换靠计数排序一次走链还原；\n" +
      "3. MTF：前移编码把局部性变成小数字；\n" +
      "4. RLE2：0 游程编成 RUNA/RUNB 双基数字（$1,2$ 交替进位累加）；\n" +
      "5. Huffman：2-6 棵规范树，每 50 个符号按选择子（MTF+一元码）换树；码长 5 位基值 ±1 delta 存储；EOB 收尾。\n\n" +
      "块头：48 位 magic `0x314159265359`（π）、CRC-32/BZIP2（多项式 0x04C11DB7、MSB-first）；流尾 magic `0x177245385090`（√2）+ 组合 CRC。块 CRC 与文件 CRC 双重校验，损坏立即报错。",
    usage: "hex / base64 输入自动识别；文本优先输出，二进制回退 hex（可勾选文件下载）。支持多块大文件与级联 bz2 流。",
    examples: [
      { in: "425a68393141592653592c41d3c00000059180400006449080200021b5467a810c08f4444ab9860c34d1385dc914e14240b1074f00", param: "bzip2 -9 压缩的样例", out: "hello world hello world hello world", desc: "BZh9 → π magic → 单块 → √2 收尾" },
      { in: "425a683131415926535981b02d8b00000004002000200021184682ee48a70a12103605b160", param: "bzip2 -1 单字符", out: "A", desc: "最微小的合法流" },
    ],
    tips: [
      "hex 以 425a68（BZh）开头、尾有 177245385090 前缀——闭眼选它；gzip（1f8b）/xz（fd377a585a）/lzma 各有各的 magic。",
      "多块大文件（>100KB×级别）与级联流都已对拍（python bz2 与 bzip2 CLI 双独立源验证，963KB 样本逐字节一致）。",
      "块 CRC 不符会明确报出期望/实算值——截断或篡改的取证样本一测便知。参考 Wikipedia “bzip2” 与 Go 标准库 compress/bzip2 的语义口径。",
    ],
    aka: ["bzip2 解压", "bzip2 decompress", "bunzip2", "bz2 解压", "bzip2", "bzunzip", "bzip2 decode", "bzh", "tar.bz2 解压", "bzip2 流", "bwt 解压", "0x314159265359"],
  },
};
