export default {
  cobs: {
    what: "COBS（Consistent Overhead Byte Stuffing）是一种把数据中的 0x00 字节替换掉的帧编码，用非零长度字节标记每个零段，常用于串口、协议和嵌入式通信。",
    principle:
      "编码时每段最多 254 个非零字节前加一个长度码：长度码 = 段内字节数 + 1；遇到 0x00 就结束当前段并开新段。解码时读长度码，复制对应数量的非零字节，段间补回 0x00。\n\nCOBS 不是加密，也不压缩；它保证编码结果里没有 0x00，方便把 0x00 当帧分隔符。",
    usage:
      "`dir=encode` 把 hex/base64/UTF-8 字节编码为 COBS；`dir=decode` 还原。`inputEnc/outEnc` 控制输入输出表示。解码可接受末尾单个 0x00 帧分隔符。",
    examples: [
      { in: "00 11 00", param: "dir=encode, inputEnc=hex, outEnc=hex", out: "01 02 11 01", desc: "Wikipedia 标准例" },
      { in: "01 02 11 01", param: "dir=decode, inputEnc=hex, outEnc=hex", out: "00 11 00", desc: "反向还原" },
    ],
    tips: [
      "COBS 的 0x00 只是帧分隔符，不在编码数据内部出现；不要把分隔符误当数据。",
      "最大连续非零段是 254 字节；255 长度码表示整段 254 字节。",
      "协议里常见 COBS + CRC：先 COBS 再去掉 0x00 分隔符，接收端按帧解析。",
      "如果输入本身是文本，先确认它应按 UTF-8 还是 hex 解释。",
    ],
    aka: ["COBS", "Consistent Overhead Byte Stuffing", "一致性开销字节填充", "COBS编码", "COBS解码", "串口帧编码", "零字节替换", "packet framing", "帧定界编码", "COBS/R", "COBS 编码器", "COBS 解码器"],
  },
  lzma: {
    what: "LZMA 是一种高压缩率的字典压缩算法，常见于 .7z、.xz 和独立 .lzma 文件；本 op 支持 .lzma 容器和 raw LZMA1 流。",
    principle:
      "LZMA 用滑动字典做 LZ77 匹配，再对长度、距离和字面量做范围编码/自适应算术编码。.lzma 文件头包含 5 字节属性（lc/lp/pb + 字典大小）和 8 字节原始大小；raw 流没有这层头，必须另外提供 props 和 size。\n\n本实现复用 7z-wasm 的 LZMA1 内核：压缩时从 7z 容器中取出真实 LZMA1 流，再拼成 .lzma，避免伪造格式。",
    usage:
      "`dir=decode` 默认自动识别 .lzma；raw 解码要填 `props`（5 字节 hex）和 `size`。`dir=encode` 默认生成 .lzma；`format=raw` 输出 `props=...\\nsize=...\\n数据`，便于再解码。`inputEnc/outEnc` 控制 hex/base64/UTF-8。",
    examples: [
      { in: "hello", param: "dir=encode, format=lzma, outEnc=base64", out: "XQAAgIA...（.lzma base64）", desc: "生成可被 7z/Python lzma 解开的 .lzma" },
      { in: "5d00001000...", param: "dir=decode, format=raw, props=5d00001000, size=5", out: "hello", desc: "raw LZMA 必须带 props/size" },
    ],
    tips: [
      "raw LZMA 没有 EOS 标记时，必须给 size；否则可能只解出部分数据。",
      "`.lzma` 头和 raw 流不是一回事；把 raw 当 .lzma 解会报头错误。",
      "压缩级别 0-9 影响字典和匹配深度，越高越慢、通常越小。",
      "WASM 缺失时会明确报错，不会静默返回原文。",
    ],
    aka: ["LZMA", "LZMA1", "LZMA 压缩", "LZMA 解压", "lzma alone", ".lzma", "raw LZMA", "7z LZMA", "LZMA 编码", "LZMA 解码", "Lempel-Ziv-Markov", "LZMA SDK"],
  },
  tar: {
    what: "Tar 是 Unix 常见的归档格式，把多个文件和目录打包成一个字节流；本 op 可在内存里列表、提取和创建 Tar，不写磁盘。",
    principle:
      "Tar 由 512 字节头块和按 512 字节对齐的文件数据组成。头里记录文件名、大小、权限、mtime、类型和校验和；长文件名用 ustar prefix、PAX 扩展头或 GNU L/K 头。\n\n提取时必须校验头、大小、校验和和路径，拒绝 ../、绝对路径、盘符等路径穿越；创建时只返回字节，不落盘。",
    usage:
      "`dir=list` 列出条目；`dir=extract` 返回文件对象（可下载）；`dir=create` 从 `entries` JSON 创建，条目格式 `{name,data,dataEnc,type,mode,mtime}`。`inputEnc/outEnc` 控制 hex/base64/UTF-8。",
    examples: [
      { in: "（tar 字节 hex/base64）", param: "dir=list, inputEnc=base64", out: "- 5 a.txt", desc: "列出归档条目" },
      { in: "[{\"name\":\"a.txt\",\"data\":\"hello\"}]", param: "dir=create, outEnc=base64", out: "（tar base64）", desc: "创建一个单文件 Tar" },
    ],
    tips: [
      "路径穿越会被拒绝；不要把不可信 Tar 直接解到磁盘。",
      "PAX 头可能覆盖后续条目的 path/size，解析时要按规范合并。",
      "Tar 本身不压缩；需要压缩请再接 gzip/xz/bzip2。",
      "大归档受条目数/单条/总大小上限保护，超限显式报错。",
    ],
    aka: ["Tar", "TAR", "tar 归档", "tar 打包", "tar 解包", "tar 提取", "tar 列表", "ustar", "PAX tar", "GNU tar", "Unix 归档", "tarball"],
  },
};
