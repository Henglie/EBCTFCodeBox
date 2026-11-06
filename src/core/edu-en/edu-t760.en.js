/*
 * English edu cards for bzip2Enc / extractAll.
 * Source: the Chinese shard; examples are kept verbatim.
 */
export default {
  bzip2Enc: {
    what:
      "bzip2 compression: turns text or bytes into standard bzip2 (BZh) data that bzip2Dec or the system bzip2/bunzip2 can decompress. It is lossless compression, not encryption.",
    principle:
      "bzip2 is Julian Seward's block-sorting format: BWT (Burrows–Wheeler transform) groups similar contexts, then MTF, RLE and Huffman coding compress them; each block carries a CRC. The header is `BZh` plus a block-size digit (1..9, i.e. 100KB×n).\n\n" +
      "This tool uses libbzip2 1.0.8 compiled to WebAssembly, rather than hand-writing BWT/Huffman in JS, so it cannot produce a fake compressor that only round-trips inside itself. The output is accepted by the existing bzip2Dec and by the system `bzip2 -d`.",
    usage:
      "Enter text, choose the output encoding (base64/hex) and block size (1..9, default 5). The full compressed result is returned without truncation. Input is capped at 4 MiB and output at 12 MiB; overruns are rejected with the actual value and limit.\n" +
      "To decompress, pass the result to bzip2Dec with the matching base64/hex input encoding.",
    examples: [
      { in: "hello bzip2", param: "outEnc=hex, blockSize=5", out: "425a6839314159265359..." },
    ],
    tips: [
      "A larger block size usually improves compression but uses more memory; the default 5 is enough for ordinary text.",
      "bzip2 suits text and compressible binaries, not already-compressed images/video; the result can grow.",
      "bzip2 has a CRC, so corrupted data fails on decompression; do not use the compressed bytes as a signature.",
    ],
    aka: [
      "bzip2 compress", "bzip2 compression", "bz2 compress", "bzip2 encoder", "bzip2 packer",
      "bzip2 wasm", "bz2 compressor", "bzip2 file", "bzip2 command", "bzip2 压缩", "bz2 压缩", "bzip2 编码",
    ],
  },
  gostKeyWrap: {
    what:
      "GOST 28147-89 key wrapping: a KEK wraps a 32-byte CEK into 44 bytes (UKM | encrypted CEK | 4-byte MAC), used for Russian-style key transport/storage; the CryptoPro variant first diversifies the KEK with the UKM.",
    principle:
      "RFC 4357 §6.1: `wrapped = UKM(8B) || CEK_ENC(32B) || CEK_MAC(4B)`. CEK_ENC is GOST 28147-89 ECB encryption; CEK_MAC is the 4-byte IMIT MAC under the same KEK with UKM as IV.\n\n" +
      "The CryptoPro variant (§6.3-6.5) first diversifies the KEK with the 64-bit UKM over eight CFB rounds to obtain KEK(UKM), then wraps. Unwrap must reject a MAC mismatch. This tool defaults to the CryptoPro-A S-box.",
    usage:
      "wrap: enter KEK (32-byte hex), CEK (32-byte hex) and optional UKM (8-byte hex; empty means all-zero); output is 44-byte hex. unwrap: enter KEK and wrapped (44-byte hex) to get the CEK; tick `cryptopro` for the CryptoPro variant.",
    examples: [
      { in: "KEK=000102...1f, CEK=2021...3f, UKM=0001020304050607", param: "mode=wrap, cryptopro=false", out: "00010203040506072e633beaa39322217e0439bcdfaaf138b7f390172d3418090fcb5c9f019fb7661993553f" },
    ],
    tips: [
      "UKM must be unique; do not use all-zero in production. The empty default only aids reproduction.",
      "Never ignore a MAC failure: it can mean a wrong KEK, UKM, CryptoPro flag or S-box.",
      "This is key wrapping, not general file encryption; the CEK is fixed at 32 bytes.",
    ],
    aka: [
      "GOST Key Wrap", "GOST 28147-89 Key Wrap", "GOST key wrapping", "CryptoPro Key Wrap",
      "CryptoPro key wrapping", "RFC 4357 Key Wrap", "GOST KEK", "GOST wrapped key",
      "GOST key transport", "GOST key unwrap", "GOST 密钥包装", "GOST 密钥包裹",
    ],
  },
  extractAll: {
    what:
      "Dedicated text extractor: pulls emails, URLs, domains, IPv4/IPv6, MACs, dates, file paths, hashes, flags and key=value pairs out of a large text at once, deduplicated in first-occurrence order.",
    principle:
      "Each type uses a boundary-constrained regex. IPv4 requires four 0..255 octets and no adjacent digit/dot, so `999.1.1.1` and `1.2.3.4.5` are rejected; a MAC needs six two-hex groups, so `aa:bb:cc` is rejected; key=value only accepts sensitive or config-style keys, so `monkey = banana` and `compass: north` are rejected.\n\n" +
      "Matches are collected by source position, then deduplicated preserving first occurrence. File-path fragments inside a URL are skipped, so a URL path is not reported as a local file.",
    usage:
      "Put types in `types` (comma-separated); the default is `email,url,domain,ipv4,mac,date,filepath`, and `all` enables everything. `sep` controls the joiner (accepts `\\n`/`\\t`); `unique` controls deduplication.\n" +
      "Limits: 2,000,000 input characters, 80,000 raw matches, 20,000 after dedupe and 1,000,000 output characters; overruns raise instead of truncating.",
    examples: [
      { in: "联系 a@b.co，访问 https://example.com/x，IP 1.2.3.4", param: "types=email,url,ipv4, sep=\\n, unique=true", out: "a@b.co\nhttps://example.com/x\n1.2.3.4" },
      { in: "mac aa:bb:cc，不是 MAC；password = secret123", param: "types=mac,keyValue", out: "password = secret123" },
    ],
    tips: [
      "Extraction is a candidate list, not ground truth; check boundaries when URLs or punctuation are involved.",
      "IPv6 and MAC both use colons; the tool separates them by group count. Enable both and compare when unsure.",
      "For custom boundaries or capture groups, use Generic Regex Extract / Replace instead.",
    ],
    aka: [
      "text extractor", "extract text", "batch extract", "email extractor", "url extractor",
      "domain extractor", "ip extractor", "mac extractor", "date extractor", "file path extractor",
      "hash extractor", "flag extractor", "IOC extractor", "专用文本提取器", "文本提取", "批量提取",
    ],
  },
};
