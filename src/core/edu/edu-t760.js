/*
 * bzip2Enc / extractAll 科普卡。
 * 纯数据，无 import、无副作用。
 */
export default {
  bzip2Enc: {
    what:
      "bzip2 压缩：把文本或字节压成标准 bzip2（BZh）数据，再用 bzip2Dec 或系统 bzip2/bunzip2 解回。它做的是无损压缩，不是加密。",
    principle:
      "bzip2 是 Julian Seward 的分块压缩格式：先做 BWT（Burrows–Wheeler 变换）把相同上下文聚到一起，再用 MTF、RLE 和 Huffman 编码压缩，块尾带 CRC 校验。文件头是 `BZh` + 块大小数字（1..9，对应 100KB×n）。\n\n" +
      "本工具用 libbzip2 1.0.8 编译的 WebAssembly 做压缩，不在 JS 里手写 BWT/Huffman，避免出现「看起来能压、解压却对不上」的假实现。压缩后的数据可以交给现有 bzip2Dec，也可以交给系统 `bzip2 -d`。",
    usage:
      "输入文本，选择输出编码（base64/hex）和块大小（1..9，默认 5）；输出是完整压缩结果，不截断。输入上限 4 MiB，输出预算 12 MiB；超过会给出实际值与上限并拒绝。\n" +
      "要解压时，把结果作为 bzip2Dec 的输入（输入编码选对应 base64/hex）即可。",
    examples: [
      { in: "hello bzip2", param: "outEnc=hex, blockSize=5", out: "425a6839314159265359..." },
    ],
    tips: [
      "块大小越大，压缩率通常越好，但内存占用也越大；默认 5 足够日常文本。",
      "bzip2 适合文本和可压缩二进制，不适合已压缩图片/视频；压缩后反而可能变大。",
      "bzip2 有 CRC，损坏数据会在解压时报错；不要用压缩结果做完整性签名。",
    ],
    aka: [
      "bzip2 压缩", "bzip2 compress", "bz2 压缩", "bzip2 打包", "bzip2 编码",
      "bzip2 压缩器", "bzip2 压缩工具", "bzip2 压缩格式", "bzip2 wasm", "bz2 compressor",
      "bzip2 文件", "bzip2 命令行",
    ],
  },
  gostKeyWrap: {
    what:
      "GOST 28147-89 密钥包装：用 KEK 把 32 字节 CEK 包装成 44 字节（UKM | 加密后的 CEK | 4 字节 MAC），用于俄系密钥传输/托管；CryptoPro 变体还会先用 UKM 派生 KEK。",
    principle:
      "RFC 4357 §6.1：`wrapped = UKM(8B) || CEK_ENC(32B) || CEK_MAC(4B)`。CEK_ENC 是 GOST 28147-89 ECB 加密；CEK_MAC 是同一 KEK、以 UKM 为 IV 的 4 字节 IMIT MAC。\n\n" +
      "CryptoPro 变体（§6.3-6.5）先用 64 位 UKM 对 KEK 做 8 轮 CFB 多样化，得到 KEK(UKM)，再执行上述包装；解包时 MAC 不一致必须拒绝。本工具默认使用 CryptoPro-A S-box。",
    usage:
      "wrap：填 KEK（32 字节 hex）、CEK（32 字节 hex）、可选 UKM（8 字节 hex；留空为全零）；输出 44 字节 hex。unwrap：填 KEK 和 wrapped（44 字节 hex），输出 CEK；CryptoPro 变体勾选 `cryptopro`。",
    examples: [
      { in: "KEK=000102...1f, CEK=2021...3f, UKM=0001020304050607", param: "mode=wrap, cryptopro=false", out: "00010203040506072e633beaa39322217e0439bcdfaaf138b7f390172d3418090fcb5c9f019fb7661993553f" },
    ],
    tips: [
      "UKM 必须唯一；生产环境不要用全零 UKM，工具留空时只是便于复现。",
      "MAC 校验失败时不要忽略错误；可能是 KEK、UKM、CryptoPro 开关或 S-box 不一致。",
      "这是密钥包装，不是通用文件加密；CEK 固定 32 字节。",
    ],
    aka: [
      "GOST Key Wrap", "GOST 28147-89 Key Wrap", "GOST 密钥包装", "GOST 密钥包裹",
      "CryptoPro Key Wrap", "CryptoPro 密钥包装", "RFC 4357 Key Wrap", "GOST KEK",
      "GOST wrapped key", "GOST 28147-89 密钥传输", "GOST key unwrap", "GOST 解包",
    ],
  },
  extractAll: {
    what:
      "专用文本提取器：从一大段文本里一次性捞出邮箱、URL、域名、IPv4/IPv6、MAC、日期、文件路径、哈希、flag 和 key=value，按出现顺序去重输出。",
    principle:
      "每个类型用一条有边界约束的正则：比如 IPv4 限制四段 0..255 且前后不能是数字/点，所以 `999.1.1.1`、`1.2.3.4.5` 不会命中；MAC 必须 6 组两位 hex，`aa:bb:cc` 不命中；key=value 只认敏感键或配置式键，普通短语 `monkey = banana`、`compass: north` 不命中。\n\n" +
      "所有匹配先按原文位置收集，再统一去重保序；文件路径落在 URL 内的片段会被跳过，避免把网址路径当成本地文件。",
    usage:
      "在 `types` 里填类型（逗号分隔），默认 `email,url,domain,ipv4,mac,date,filepath`；填 `all` 开全部。`sep` 控制分隔符（支持 `\\n`/`\\t`），`unique` 控制是否去重。\n" +
      "输入上限 200 万字符、原始匹配 8 万条、去重后 2 万条、输出 100 万字符；超限直接报错，不截断。",
    examples: [
      { in: "联系 a@b.co，访问 https://example.com/x，IP 1.2.3.4", param: "types=email,url,ipv4, sep=\\n, unique=true", out: "a@b.co\nhttps://example.com/x\n1.2.3.4" },
      { in: "mac aa:bb:cc，不是 MAC；password = secret123", param: "types=mac,keyValue", out: "password = secret123" },
    ],
    tips: [
      "提取结果是候选，不是真值；遇到嵌套 URL、带标点的句子，先看边界是否符合题目语境。",
      "IPv6 与 MAC 都用冒号分隔，工具按组数区分；不确定时同时开 ipv6 和 mac 对照。",
      "需要自定义边界或捕获组时，用「通用正则提取 / 替换」而不是本提取器。",
    ],
    aka: [
      "专用文本提取器", "文本提取", "批量提取", "邮箱提取", "URL 提取", "域名提取",
      "IP 提取", "MAC 提取", "日期提取", "文件路径提取", "hash 提取", "flag 提取",
      "text extractor", "extract emails", "extract urls", "IOC 提取",
    ],
  },
};
