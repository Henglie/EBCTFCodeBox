/*
 * edu_lznt1.js — 科普卡候选（LZNT1 解压）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：wine dlls/ntdll/rtl.c 与 ReactOS sdk/lib/rtl/compress.c（逐行一致），
 * 本机 Windows 10 26100 RtlCompressBuffer 真样本（均 2026-09-22，见 ref/SOURCES_A.md）。
 */
export default {
  lznt1: {
    what: "LZNT1——Windows 自家的 LZ77 压缩格式（ntdll!RtlCompressBuffer 的传统档），NTFS 文件压缩、注册表压缩值、部分调试转储都用它。流由若干 4096 字节明文单元的 chunk 组成：压缩块用位标志字节 + 反向引用（offset/length 压成 16 位），存不小时整块原样存（存储块）。CTF 取证里常见形态：注册表 hive 里的压缩值、题目直接给一段 0xB000 头的 blob。",
    principle:
      "1. chunk 头 2 字节小端：低 12 位 = 块数据长度-1；bit15 = 1 压缩块 / 0 存储块；bit12-14 = 签名 0b011（实测压缩块头 0xBxxx、存储块 0x3xxx）；头=0x0000 是流结束标记。\n" +
      "2. 压缩块内：标志字节逐位（低位在前）管 8 个 token——位 0 字面字节，位 1 反向引用（16 位小端 word）。\n" +
      "3. word 的位移/长度位分割随块内已解出位置 pos 动态变化：位移位宽 db = max(4, 最高满足 2^(t-1) < pos 的 t)（上限 12）；length = (word & (2^(16-db)-1)) + 3；displacement = (word >> (16-db)) + 1。\n" +
      "4. 反向引用只在当前 4096 块内回引，逐字节拷贝（位移小于长度即重叠自复制，可造长游程）；每块解出上限 4096 字节。\n" +
      "5. 块间若未对齐 4096 边界补零（正常流只有末块不满）。",
    usage:
      "单向解压（不做压缩）：输入 hex / base64 / 拖文件，输出可打印 UTF-8 直接出文本，否则出 hex。\n\n" +
      "识别特征：开头两字节 & 0xF000 ∈ {0xB000（压缩块）, 0x3000（存储块）}；存储块长度恒见 0x3FFF（4096 原样字节）。畸形流（块长越界 / 反向引用越界 / token 截断）显式报错而不是静默吐垃圾。",
    examples: [
      { in: "03b002416000", param: "inputEnc=hex",
        out: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", desc: "Windows 真样本：'A'×100 → 6 字节。头 0xB003=压缩块 4 字节数据；标志 0x02 → 字面 'A' + 反向引用 word 0x0060（长 99/位移 1）" },
      { in: "01b00041", param: "inputEnc=hex",
        out: "A", desc: "Windows 真样本：单字节 'A' → 头 0xB001（4 字节数据：标志 0x00 + 'A'）" },
      { in: "023058595a", param: "inputEnc=hex",
        out: "XYZ", desc: "手造存储块：头 0x3002（存储、3 字节）+ 'XYZ' 原样（按算法构造，经 Python 参考对拍）" },
    ],
    formulas: [
      { tex: "d_b = \\min(12,\\ \\max(4,\\ \\max\\{t : 2^{t-1} < \\mathrm{pos}\\}))", caption: "位移位宽随块内位置 pos 变化" },
      { tex: "\\mathrm{len} = (w \\bmod 2^{16-d_b}) + 3,\\quad \\mathrm{disp} = \\lfloor w / 2^{16-d_b} \\rfloor + 1", caption: "16 位 token word 的位移/长度解码" },
    ],
    tips: [
      "识别：首 2 字节（小端）& 0xF000 是 0xB000/0x3000 基本就是 LZNT1；0x3FFF 存储块头是高熵数据混不压缩时的标志。",
      "与 XPRESS 区分：Win8+ 的 RtlCompressBuffer 默认 XPRESS（4 字节变长 token、无 chunk 头）；LZNT1 有 2 字节块头 + 0x3000/0xB000 签名位。",
      "压缩方向没有规范强制编码器（Windows 的贪心匹配是实现在线行为），本工具只做解压；要压缩请走系统 API。",
      "空块头 0x0000 = 流结束；末块数据不足 4096 是正常形态，不是截断。",
      "安全边界：解压器对畸形流显式报错（块长越界/位移越界/token 截断）；块满即止遵循 Windows「部分解压非错误」口径——解出长度可作完整性旁证但不是校验和。",
      "来源：wine https://github.com/wine-mirror/wine/blob/master/dlls/ntdll/rtl.c （lznt1_decompress）；ReactOS https://github.com/reactos/reactos/blob/master/sdk/lib/rtl/compress.c （注明 Based on Wine Staging）；ntfs-3g compress.c（NTFS 属性流变体口径）；真样本：本机 Windows 10.0.26100 ntdll 10.0.26100.3915 RtlCompressBuffer(LZNT1) 生成（访问/生成日期 2026-09-22）。",
    ],
    aka: ["LZNT1", "LZNT1 解压", "LZNT1 decompress", "Windows LZ77", "RtlCompressBuffer", "RtlDecompressBuffer",
      "NTFS 压缩", "NTFS compression", "压缩块解压", "LZ77 反向引用", "注册表压缩值", "COMPRESSION_FORMAT_LZNT1"],
  },
};
