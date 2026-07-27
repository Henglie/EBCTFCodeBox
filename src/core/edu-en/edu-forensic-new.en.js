// English edu shard: forensics — 19 ops (archive cracking / john hash extraction / traffic analysis / Minecraft saves / pyc stego / CRC brute). Pure data, no imports, no side effects.
export default {
  bkcrackAttack: {
    what: "ZipCrypto known-plaintext attack (Biham-Kocher): for a ZIP encrypted with legacy ZipCrypto, ≥12 bytes of contiguous known plaintext from any one entry is enough to recover the internal key state directly and decrypt the whole archive, regardless of password length.",
    principle:
      "Legacy ZipCrypto (not AES) draws its strength from three 32-bit internal registers key0/key1/key2. The Biham-Kocher attack doesn't guess the password; it back-derives these three registers from 「known plaintext XOR ciphertext」. Once ≥12 bytes of contiguous known plaintext match the ciphertext, the key state can be solved, after which every ZipCrypto entry in the ZIP can be decrypted.\n\nKey point: ZipCrypto encrypts the **compressed** bytes. If an entry is `method=0` (stored), the known plaintext is the raw content; if `method=8` (deflate), the known plaintext must be the raw content run through deflate with the same parameters. AES-encrypted ZIPs cannot use this attack.\n\nThe engine is kimci86/bkcrack compiled to wasm via emscripten, lazy-loaded locally; when missing it degrades to a parameter echo. The attack is CPU-intensive, typically taking minutes to tens of minutes.",
    usage: "Provide the encrypted ZIP (hex/base64 or drop a file), the target entry name (e.g. flag.txt), and ≥12 bytes of known plaintext with its encoding/offset. Choose mode 「recover key state」 to output only key0/key1/key2, or 「recover and decrypt」 to export the target entry directly.",
    examples: [
      { in: "encrypted ZIP + entry flag.txt + 12+ bytes known plaintext", param: "mode=recover", out: "key0 key1 key2, three 8-char hex internal key states", desc: "The internal state decrypts the whole archive" },
    ],
    tips: ["Plaintext sources: known-content files inside the ZIP, file-header magic (PNG 89504E47, PDF %PDF, embedded ZIP 504B0304). After recovering the key state you can also `bkcrack -k` to back out the original password string. AES-encrypted ZIPs can't use this attack; switch to zip2john brute-forcing."],
    aka: ["bkcrack", "zipcrypto", "已知明文攻击", "known plaintext attack", "biham kocher", "比哈姆科赫", "zip明文攻击", "pkzip stream cipher", "传统zip加密破解", "plaintext attack", "zip密码破解", "known-plaintext", "kimci86", "zip已知明文"],
  },

  formatSniff: {
    what: "Format sniff: paste in a chunk of text and quickly identify what it is — JWT, PEM, URL, IP, UUID, hash, encoding (base64/32/58/hex), Bitcoin/Ethereum address, mnemonic, timestamp, credit card, coordinates, code snippet, etc. Gives CTF players surprise hints.",
    principle:
      "Runs a set of feature detectors on the input, each using a regex or structural test to match a format class: JWT looks for three dot-separated base64url segments with an alg in the header; PEM looks for `-----BEGIN`; hashes are guessed by length + charset (32 hex→MD5/NTLM, 40→SHA-1, 64→SHA-256…); credit cards run Luhn; encodings are judged hex/base32/base64/base58 by charset. Strong features come first, and a hit reports the class + evidence, doing detection only, no conversion.",
    usage: "Paste a suspicious string directly, no parameters needed; outputs all matched format classes and their evidence.",
    examples: [
      { in: "eyJhbGciOiJub25lIn0.eyJ1c2VyIjoiYWRtaW4ifQ.", out: "JWT: header alg=none, try the empty-signature bypass", desc: "Detects JWT and flags the alg=none risk" },
      { in: "5d41402abc4b2a76b9719d911017c592", out: "Hash: 32 hex chars = 128 bit, possibly MD5 / MD4 / NTLM / LM" },
    ],
    tips: ["When you get a lump of unknown characters, drop it here first and it will point you in a direction. An alg=none JWT, a private-key PEM, and a Bitcoin mnemonic all get highlighted as sensitive."],
    aka: ["格式识别", "format sniff", "特征识别", "指纹识别", "format detection", "格式嗅探", "identify format", "magic sniff", "格式检测", "数据类型识别", "format fingerprint", "what is this string", "识别输入", "格式判别"],
  },

  sevenZip2john: {
    what: "7z hash extraction (7z2john): extracts a John/hashcat-usable hash string from an encrypted 7z archive (extract only, no cracking), outputting `$7z$` format, corresponding to hashcat mode 11600.",
    principle:
      "7z uses AES-256 + SHA-256 KDF encryption. The tool parses the 7z SignatureHeader (magic 37 7A BC AF 27 1C) and NextHeader, finds the AES coder (codecId 06F10701) in the Folder's Coder chain, extracts its Properties (NumCyclesPower = KDF iterations = 2^n), salt, IV, then reads the encrypted data, CRC, and pack/dec lengths, assembling the hash string `$7z$type$NumCyclesPower$saltLen$salt$ivLen$iv$crc$encLen$decLen$encData`. When the header is encrypted (-mhe=on), it extracts from the ENCODED_HEADER.",
    usage: "Input a 7z file (hex/base64/drop a file), pick the input encoding; maxDataLen caps inlined encrypted data. Outputs a `$7z$` hash string for `hashcat -m 11600` or john.",
    examples: [
      { in: "encrypted 7z file bytes", out: "$7z$0$19$0$$8$<iv>$<crc>$<encLen>$<decLen>$<encData>", desc: "type=0 stored, NumCyclesPower=19 i.e. 2^19 iterations" },
    ],
    tips: ["7z2john extracts a hash for offline cracking; this tool doesn't crack. If the NextHeader is compressed (not encrypted), you must decompress the header first to extract file encryption info. hashcat mode is fixed at 11600."],
    aka: ["7z2john", "7z哈希提取", "7zip hash", "$7z$", "7z crack", "hashcat 11600", "7z密码提取", "seven zip hash", "7z john", "7z爆破哈希", "7z hash extract", "p7zip hash", "7z密码破解", "7zip john"],
  },

  office2john: {
    what: "Office hash extraction (office2john): extracts a John/hashcat-format hash string from an encrypted Office document (.doc/.docx/.xls/.xlsx/.ppt/.pptx) — extract only, no cracking.",
    principle:
      "An encrypted Office file is a CFB/OLE2 container (magic D0CF11E0A1B11AE1), with encryption parameters in the EncryptionInfo stream. The tool parses the CFB header, FAT/MiniFAT/directory, reads EncryptionInfo, and splits by version: Office 2007 is binary format (`$office$*2007*`, hashcat 9400, SHA-1+AES-128); 2010/2013 are Agile XML (`$office$*2010*` hashcat 9500 / `$office$*2013*` hashcat 9600), taking spinCount, keyBits, salt, encryptedVerifier, etc. from the XML's encryptedKey element. Legacy 97-2003 (oldoffice, RC4) is only reported, not fully extracted.",
    usage: "Input an encrypted Office file (hex/base64/drop a file), output the `$office$` hash string and parameters for the matching hashcat mode or john.",
    examples: [
      { in: "encrypted .docx (Office 2013) bytes", out: "$office$*2013*100000*256*16*<salt>*<encVerifier>*<encVerifierHash>", desc: "spinCount=100000, keyBits=256, hashcat 9600" },
    ],
    tips: ["office2john extracts only, doesn't crack. Read the EncryptionInfo version to set the hashcat mode: 2007→9400, 2010→9500, 2013→9600. Legacy 97-2003 has a scattered structure — use Python office2john.py instead."],
    aka: ["office2john", "office哈希提取", "office hash", "$office$", "docx crack", "office密码提取", "hashcat 9400", "hashcat 9500", "hashcat 9600", "ole2 encryption", "encryptioninfo", "office密码破解", "office john", "cfb encryption"],
  },

  pdf2john: {
    what: "PDF hash extraction (pdf2john): extracts a John/hashcat-format `$pdf$` hash string from an encrypted PDF's /Encrypt dictionary (extract only, no cracking), following openwall john's official pdf2john format.",
    principle:
      "The PDF standard security handler stores encryption parameters in the `/Encrypt` dictionary (`/Filter /Standard`). The tool locates the encryption dictionary in the PDF text, extracts /V (algorithm version), /R (revision), /Length (key bits), /P (permission bits), /EncryptMetadata, the first element of the document /ID, and the /U /O /OE /UE password-verification strings (truncated by revision: R2-4=32 bytes, R5/R6=48 bytes), assembling `$pdf$V*R*Length*P*EncMeta*len(ID)*ID_hex*passwords`. R2/3=RC4, R4=RC4 or AES-128, R5/R6=AES-256.",
    usage: "Input an encrypted PDF (raw PDF bytes/hex/base64/drop a file), output the `$pdf$` hash string. R2/3→hashcat 10400/10500, R5→10600, R6→10700.",
    examples: [
      { in: "encrypted PDF (%PDF... with /Encrypt)", out: "$pdf$4*4*128*-3904*1*16*<ID_hex>*32*<U_hex>*...", desc: "V=4 R=4 Length=128, permission bits -3904" },
    ],
    tips: ["pdf2john extracts only, doesn't crack. The revision /R determines the encryption algorithm and hashcat mode. Without a document /ID, john may not accept it — heed the notice."],
    aka: ["pdf2john", "pdf哈希提取", "pdf hash", "$pdf$", "pdf crack", "pdf密码提取", "hashcat 10500", "hashcat 10700", "pdf encrypt", "/Encrypt", "pdf密码破解", "pdf john", "encrypted pdf hash", "pdf口令提取"],
  },

  rar2john: {
    what: "RAR hash extraction (rar2john): extracts a hash string (`$RAR3$` / `$rar5$`) from a RAR3/RAR5 encrypted file, ready to feed john/hashcat — extract only, no cracking.",
    principle:
      "The tool splits by magic into RAR3 (526172211A0700) and RAR5 (526172211A070100). RAR3 has two modes: -hp (header encryption) takes the last 24 bytes of the file (first 8 salt + last 16 encrypted END_HEAD) → `$RAR3$*0*` (hashcat 12500); -p (file encryption) takes SALT/CRC/pack/unp/encrypted data from the FILE_HEAD → `$RAR3$*1*` (hashcat 23700/23800). RAR5 parses blocks with vint variable-length integers, taking kdfCount, 16-byte salt, IV, pswcheck from the extra area or the archive encryption header → `$rar5$16$salt$iter$iv$8$pswcheck` (hashcat 13000).",
    usage: "Input an encrypted RAR (hex/base64/drop a file); maxDataLen caps RAR3-p data extraction length. Outputs the hash string and matching hashcat mode.",
    examples: [
      { in: "RAR5 encrypted file bytes", out: "$rar5$16$<salt>$15$<iv>$8$<pswcheck>", desc: "iter_log2=15 i.e. PBKDF2 2^15=32768 iterations" },
    ],
    tips: ["rar2john extracts only, doesn't crack. RAR3-hp uses hashcat 12500, RAR3-p uses 23700/23800, RAR5 uses 13000. RAR5's iter is a logarithm (15→2^15)."],
    aka: ["rar2john", "rar哈希提取", "rar hash", "$RAR3$", "$rar5$", "rar crack", "rar密码提取", "hashcat 12500", "hashcat 13000", "rar密码破解", "winrar hash", "rar john", "rar5 hash", "rar3 hash"],
  },

  sshkey2john: {
    what: "SSH private-key hash extraction (sshkey2john): extracts a John `$sshng$`-format hash string from an encrypted SSH private key (OpenSSH new format / PEM legacy RSA/DSA/EC) — extract only, no cracking.",
    principle:
      "Two private-key formats. The OpenSSH new format (BEGIN OPENSSH PRIVATE KEY), after base64 decoding, has the `openssh-key-v1\\0` magic; it reads ciphername (aes256-cbc/ctr), kdfname (bcrypt), salt, rounds, and assembles `$sshng$cipher_id$salt_len$salt$data_len$data$rounds$ct_offset`; aes256-cbc→cipher_id=2 (hashcat 22421), aes256-ctr→6 (22422). Legacy PEM (RSA/DSA/EC) has a `Proc-Type: 4,ENCRYPTED` + `DEK-Info: cipher,iv` header; it infers cipher_id from the cipher's keysize and assembles `$sshng$cipher_id$iv_len$iv$data_len$data`. An unencrypted key (cipher=none / no Proc-Type) is reported as needing no cracking.",
    usage: "Paste the SSH private key text (or drop an id_rsa file), output the `$sshng$` hash string plus the encryption algorithm/KDF/salt/rounds info. Feed to john or hashcat 22421/22422.",
    examples: [
      { in: "-----BEGIN OPENSSH PRIVATE KEY----- ... (bcrypt+aes256-cbc)", out: "sshkey:$sshng$2$16$<salt>$<len>$<data>$16$<offset>", desc: "cipher_id=2 (AES-256-CBC), rounds=16" },
    ],
    tips: ["ssh2john extracts only, doesn't crack. The OpenSSH new format uses the bcrypt KDF, hashcat 22421 (cbc)/22422 (ctr). A key with no Proc-Type / cipher=none is unencrypted and usable directly without cracking."],
    aka: ["ssh2john", "sshkey2john", "ssh私钥哈希", "sshng", "$sshng$", "ssh key crack", "id_rsa crack", "ssh密码提取", "hashcat 22921", "openssh key hash", "ssh私钥爆破", "encrypted ssh key", "ssh passphrase", "ssh私钥破解"],
  },

  zip2john: {
    what: "ZIP hash extraction (zip2john): extracts a John/hashcat-format hash string from an encrypted ZIP (extract only, no cracking). ZipCrypto→`$pkzip2$` (hashcat 17200-17230), WinZip AES→`$zip2$` (hashcat 13600).",
    principle:
      "Scans the ZIP's local file headers (LFH, signature 504B0304) and reads GPBF bit0 to tell whether it's encrypted. Legacy ZipCrypto (method≠99) assembles the `$pkzip2$` format, containing data type, compression type, the CRC high word, the timestamp check word, and encrypted data. WinZip AES (method=99, extra field 0x9901) reads the encryption strength from the extra (1/2/3 = AES-128/192/256), computes salt length by strength (8/12/16), takes salt + verify bytes + encrypted data + 10-byte authentication code, and assembles `$zip2$*0*strength*0*salt*verify*len*df*auth*$/zip2$`.",
    usage: "Input an encrypted ZIP (hex/base64/drop a file); maxDataLen caps inlined data. Outputs the hash string — ZipCrypto→hashcat 17210, AES→13600.",
    examples: [
      { in: "WinZip AES-256 encrypted ZIP", out: "flag.txt:$zip2$*0*3*0*<salt>*<verify>*<len>*<df>*<auth>*$/zip2$", desc: "strength=3 i.e. AES-256, hashcat 13600" },
    ],
    tips: ["zip2john extracts only, doesn't crack. Pseudo-encryption (only the GPBF bit set, no real encryption) won't produce a valid hash. For legacy ZipCrypto with known plaintext, switch to the bkcrack known-plaintext attack — it's faster and ignores password length."],
    aka: ["zip2john", "zip哈希提取", "zip hash", "$pkzip2$", "$zip2$", "zip crack", "zip密码提取", "hashcat 13600", "hashcat 17200", "pkzip hash", "winzip aes hash", "zip密码破解", "zip john", "zipcrypto hash"],
  },

  pcapParse: {
    what: "pcap/pcapng structure parse: peels a capture file layer by layer — container header + per-frame Ethernet/IPv4/IPv6/TCP/UDP/ICMP/HTTP/DNS dissection, outputting a packet summary table, protocol details, and payload preview. The foundation for CTF traffic challenges.",
    principle:
      "First identify the container by magic: libpcap (0xa1b2c3d4 etc., which sets byte order) or pcapng (block structure SHB/IDB/EPB). After extracting each packet's raw bytes, peel layer by layer: link layer (Ethernet/Linux SLL/Loopback) → by ethertype into IPv4 (RFC 791)/IPv6 (RFC 8200) → by protocol number into TCP (RFC 793)/UDP (RFC 768)/ICMP (RFC 792) → application layer tries DNS (port 53)/HTTP (text features). Network protocol headers are always big-endian; only the container header is affected by file byte order. Pure front-end, zero dependencies.",
    usage: "Input pcap/pcapng (hex/base64/drop a file); maxPackets limits displayed count; detail chooses 「summary only」 or 「with protocol details + payload」. Outputs a layered report + HTTP/DNS summary.",
    examples: [
      { in: "pcap file bytes", param: "detail=full", out: "packet summary + IPv4/TCP/HTTP per-layer fields + payload hex/ASCII preview" },
    ],
    tips: ["For a traffic challenge, drop it here first to see the overall structure and find HTTP/DNS. For TCP stream reassembly / HTTP file extraction use pcapTcpReassemble/pcapHttpExtract, for DNS tunneling use pcapDnsTunnel."],
    aka: ["pcap解析", "pcap parse", "pcapng", "抓包解析", "流量分析", "packet analysis", "wireshark", "tcpdump", "包分析", "网络取证", "pcap dissect", "流量包解析", "packet capture", "协议分帧"],
  },

  mcLevelDat: {
    what: "Minecraft level.dat parse: opens the level.dat (gzip-compressed NBT) of a Minecraft Java Edition save, outputting a structured summary — seed, spawn point, GameRules, version, DataVersion — and highlighting suspicious fields like unusual GameRules and abnormal coordinates.",
    principle:
      "level.dat is a gzip (magic 1f 8b) compressed NBT binary tree. The tool decompresses with the native DecompressionStream, then reads the tree with a hand-written big-endian NBT parser (tag types 0-12, Long/LongArray use BigInt, String uses UTF-8). From the root Compound's Data subtree it takes LevelName, Version, DataVersion, the seed (WorldGenSettings.seed or legacy RandomSeed), spawn point SpawnX/Y/Z, GameRules, etc. CTF often hides a flag in abnormal coordinates (falling in the printable ASCII range), custom GameRules, or non-standard fields — the tool highlights these.",
    usage: "Input level.dat (hex/base64/drop a file); tick 「dump the full NBT tree」 to see every field. Outputs a structured summary + suspicious-field highlights.",
    examples: [
      { in: "level.dat (gzip NBT) bytes", out: "seed: 12345 / Spawn: X=102 Y=64 Z=97 / ⚠ unusual GameRule ...", desc: "Coordinates in the ASCII range get highlighted as suspected encoded characters" },
    ],
    tips: ["Seed, spawn coordinates, and custom GameRules are the three hotspots for hidden flags. To see the whole NBT tree use mcNbtView; to bulk-extract text intel use mcTextExtract."],
    aka: ["level.dat", "minecraft存档", "mc存档解析", "leveldat parse", "nbt", "我的世界存档", "minecraft save", "gzip nbt", "世界种子", "minecraft nbt", "mc level dat", "麦块存档", "minecraft取证", "world seed"],
  },

  mcMapRender: {
    what: "Minecraft map render: renders a Minecraft Java Edition map item map_#.dat (gzip NBT, where data.colors under the root is a 128×128 palette index) into a PNG. CTF often draws QR codes/pixel art/hidden text with map items.",
    principle:
      "map_#.dat is gzip-compressed NBT; data.colors is 16384 bytes (128×128), one color per byte: baseColorId = byte>>2, shade = byte&3. MC has 62 base colors (id 0-61, 0=transparent), each with 4 brightness levels (multipliers 180/220/255/135). The tool looks up the built-in MapColor table to compute each pixel's RGBA, drawing magenta for out-of-range indices to flag anomalies, then outputs a data URL via a hand-written minimal PNG encoder (IHDR+IDAT+IEND, zlib stored blocks, zero canvas dependency).",
    usage: "Input map_#.dat (hex/base64/drop a file), pick a scale factor (1×/2×/4×, nearest-neighbor). Outputs a PNG data URL (paste into the browser address bar to view) + a color-distribution stat.",
    examples: [
      { in: "map_0.dat (gzip NBT) bytes", param: "scale=2", out: "data:image/png;base64,... + non-transparent pixel count / suspected all-black (QR code) hint", desc: "128×128 scaled to 256×256" },
    ],
    tips: ["Map items are a classic carrier for QR codes/hidden text. A suspected-all-black hint often means a black-background QR code — mind the contrast or invert colors. map_#.dat lives in the save's data/ directory — don't confuse it with level.dat."],
    aka: ["minecraft地图", "mc地图渲染", "map.dat", "map dat render", "minecraft map", "地图物品", "我的世界地图", "map item png", "minecraft mapcolor", "mc地图物品", "地图二维码", "minecraft map render", "map_0.dat", "麦块地图"],
  },

  mcNbtView: {
    what: "Minecraft NBT tree viewer: a browser NBTExplorer that decompresses any Minecraft Java Edition NBT (level.dat/*.dat/playerdata/structure .nbt etc.) and fully dumps it as an indented, foldable readable text tree. Supports path filtering to locate a subtree.",
    principle:
      "Reuses the big-endian NBT parser, auto-detecting gzip/zlib/raw NBT storage. After parsing it recursively dumps each node: showing the tag type name (TAG_Compound/TAG_List/TAG_String/TAG_Long…), key, value; List marks its element type and length; Long/LongArray print as-is with BigInt without precision loss; large arrays are truncated to the first N items. Path filtering supports `Data.Player.Inventory` or `a[0].b` syntax, dumping only the matched subtree.",
    usage: "Input an NBT file (hex/base64/drop a file); optionally set path to locate a subtree (e.g. Data.Player.Inventory), tune maxArray/maxDepth to control truncation and depth. Outputs the full or subtree text tree.",
    examples: [
      { in: "level.dat bytes", param: "path=Data.GameRules", out: "TAG_Compound 'GameRules': ... a tree of each rule's key-value", desc: "Path filtering shows only the GameRules subtree" },
    ],
    tips: ["Use this to view the whole NBT structure or locate a specific field. For a quick level.dat summary use mcLevelDat; for bulk sign/book text extraction use mcTextExtract. Long values use BigInt with no precision loss."],
    aka: ["nbt查看器", "nbt viewer", "nbtexplorer", "nbt tree", "minecraft nbt", "nbt解析", "nbt浏览", "nbt编辑器", "我的世界nbt", "nbt dump", "mc nbt view", "nbt结构", "named binary tag", "nbt树"],
  },

  mcTextExtract: {
    what: "Minecraft text-intel extraction: traverses a Minecraft Java Edition save's region/*.mca (Anvil) or a single .dat/.nbt, and in one shot pulls out signs, written books, command blocks, entity/block CustomName, and item name + Lore, aggregated by type + coordinate, highlighting flag{...} and common variants. The go-to flag-finding tool.",
    principle:
      "Supports two inputs: Anvil MCA (4KiB location table + 4KiB timestamp table header, each chunk = length + compression type + zlib NBT) and a single gzip/zlib/raw NBT. After decompressing and parsing, it traverses the NBT tree, pulling text intel by field name — sign Text1-4 or 1.20+ front_text/back_text.messages, book pages/title/author, command-block Command, CustomName, item display.Name/Lore, and 1.20.5+ components named keys. It runs a flag regex (flag{}/generic xxx{}) on each text, and decodes suspected base64 to scan again. Optionally falls back to extracting all TAG_String.",
    usage: "Input MCA or .dat/.nbt (hex/base64/drop a file), pick the file type; optionally tick 「fallback scan of all strings」 and fill in a custom flag regex. Outputs text aggregated by type + a flag-hit summary.",
    examples: [
      { in: "region r.0.0.mca bytes", param: "scanAll=true", out: "⚑ flag{...} ← sign chunk(3,5) + various text entries", desc: "Traverses chunks to extract signs/books and highlight flags" },
    ],
    tips: ["To find a flag in an MC save, run this first: signs, books, and command blocks are all hidden-flag hotspots. If hits are unsatisfactory, tick the fallback all-string scan or use a custom regex. It automatically base64-decodes and scans again."],
    aka: ["minecraft文本提取", "mc文本情报", "mca解析", "anvil region", "minecraft flag", "存档找flag", "sign book extract", "命令方块提取", "minecraft取证", "mc region", "anvil格式", "minecraft text intel", "告示牌提取", "我的世界找flag"],
  },

  pcapTcpReassemble: {
    what: "TCP stream reassembly: aggregates scattered TCP segments in a pcap by 5-tuple, sorts by seq and dedups, and restores each direction's complete byte stream. The basis for HTTP object extraction, also used to restore a flag split across packets.",
    principle:
      "Traverses all TCP segments, identifying connections by an undirected 5-tuple and grouping by direction (a→b / b→a). Using the SYN's seq+1 or the first segment by ascending seq as the baseline ISN, it handles 32-bit seq wraparound to compute relative offsets, places each segment's data at the correct position, and dedups retransmitted data 「first write wins」. Outputs the reassembled contiguous byte stream (text or hex). RFC 793.",
    usage: "Input pcap/pcapng (hex/base64/drop a file), leave flowIndex blank to see the flow list, fill it to see that flow's full bidirectional content. previewBytes/maxFlows control the preview.",
    examples: [
      { in: "a pcap with TCP traffic", param: "flowIndex=0", out: "flow #0 bidirectional reassembled byte stream (full text or hex dump)", desc: "Restore the full content of one TCP connection" },
    ],
    tips: ["When a flag is split across multiple TCP packets, reassembly restores it. If the reassembly is HTTP, use pcapHttpExtract to pull objects. Out-of-order/retransmitted data is handled by seq sorting and deduping."],
    aka: ["tcp流重组", "tcp reassemble", "tcp stream", "流重组", "tcp重组", "follow tcp stream", "tcp流还原", "stream reassembly", "追踪tcp流", "tcp payload重组", "tcp segment reassembly", "字节流重组", "tcp流跟踪", "seq重组"],
  },

  pcapHttpExtract: {
    what: "HTTP object extraction: builds on TCP reassembly to parse HTTP requests/responses, handling chunked transfer and gzip/deflate decompression (pure-JS inflate), exporting the files and text carried in the traffic.",
    principle:
      "First does TCP stream reassembly, then splits HTTP messages in the byte stream: find the `\\r\\n\\r\\n` header/body separator, parse the start line to tell request/response, parse headers. The body is assembled by chunks per Transfer-Encoding: chunked, or truncated per Content-Length, or read to stream end when a response has no length. Then per Content-Encoding it decompresses gzip/deflate with a hand-written inflate (RFC 1951 DEFLATE / 1950 zlib / 1952 gzip, not relying on DecompressionStream). RFC 9112/2616.",
    usage: "Input pcap/pcapng (hex/base64/drop a file), leave dumpIndex blank to see the object list, fill an index to export that object's full body. previewBytes controls the list preview.",
    examples: [
      { in: "a pcap with HTTP traffic", param: "dumpIndex=2", out: "HTTP object #2 full body (auto de-gzip/chunked) text or hex", desc: "Export the transferred image/text file" },
    ],
    tips: ["Files carried over HTTP and gzip-compressed responses can be restored automatically. Encrypted HTTPS can't be extracted (you only get ciphertext). Chunked and gzip/deflate are decoded internally — no manual handling needed."],
    aka: ["http对象提取", "http extract", "http文件提取", "export objects", "http导出", "http还原", "http object", "提取http文件", "http流量提取", "chunked解码", "gzip解压", "http response body", "文件提取", "http carve"],
  },

  pcapDnsTunnel: {
    what: "DNS tunnel detection: extracts the data labels from the subdomains of DNS queries, concatenates them, and tries base32/base64/hex decoding to detect data exfiltrated through a DNS tunnel.",
    principle:
      "A DNS tunnel encodes data into the leading subdomain labels of queries (e.g. `<base32 data>.evil.com`), carrying a small piece per query. The tool collects all DNS queries (dedup by request), strips the base domain or the last N labels to leave the data part, concatenates in order, then tries base32/base64/hex decoding, ranking by printable rate to give the most likely plaintext. It also gives a tunnel heuristic (number of unique domains, high average query-name length = suspected tunnel). RFC 1035 + RFC 4648.",
    usage: "Input pcap/pcapng (hex/base64/drop a file), fill in the base domain (e.g. evil.com) or use the default count of trailing labels to strip, choose the decoding (auto = try all / base32 / base64 / hex / extract only). Outputs the concatenated data stream + decode result.",
    examples: [
      { in: "a pcap with a DNS tunnel", param: "decodeAs=auto", out: "concatenated data stream + [base32] decoded readable plaintext (printable rate 95% ★readable)", desc: "Restore data exfiltrated via DNS tunnel" },
    ],
    tips: ["Extra-long query names and an unusually high number of unique subdomains are DNS-tunnel signals. DNS tunnels most commonly use base32 (domains are case-insensitive, and the base32 charset is compliant). Getting the base domain right strips it more cleanly."],
    aka: ["dns隧道", "dns tunnel", "dns隧道检测", "dns tunneling", "dns外泄", "dns数据外泄", "dns exfiltration", "子域名解码", "dns隐蔽通道", "dns covert channel", "iodine", "dnscat", "dns隐写", "dns tunnel detect"],
  },

  pcapIcmpPayload: {
    what: "ICMP payload extraction: extracts the payload of ICMP echo packets, sorts and concatenates by id/seq, and restores data exfiltrated via ICMP stego/tunnel.",
    principle:
      "The payload of an ICMP echo request/reply is nominally padding, but is often used to smuggle hidden information (ping tunnel). The tool collects all ICMP packets, reads type/code/id/seq and the payload after the 8-byte header from the bytes, sorts and concatenates by (id, seq) into complete data, and outputs text or hex+ASCII. It can filter by packet type (all / Echo Request type=8 only / Echo Reply type=0 only). RFC 792.",
    usage: "Input pcap/pcapng (hex/base64/drop a file), choose the packet-type filter; previewBytes controls the ASCII preview. Outputs a per-packet list + the full payload concatenated by seq.",
    examples: [
      { in: "a pcap with ICMP stego", param: "filter=request", out: "per-packet EchoReq id/seq/payload + full payload concatenated by seq (text or hex)", desc: "Restore data exfiltrated via ping tunnel" },
    ],
    tips: ["Ping tunnels/ICMP stego hide data in the echo payload. Viewing only requests or only replies avoids duplicate data. If the concatenation is hex/base64, apply the matching decoder afterward."],
    aka: ["icmp载荷提取", "icmp payload", "icmp隧道", "ping隧道", "icmp tunnel", "icmp隐写", "ping tunnel", "icmp exfiltration", "echo payload", "icmp数据提取", "icmp covert channel", "ping隐写", "icmp外泄", "icmp payload extract"],
  },

  stegosaurus: {
    what: "Stegosaurus pyc stego detection: parses the .pyc header to determine the Python version, recursively unmarshals code objects, scans string constants for hidden flags, detects co_lnotab line-number-table anomalies, and extracts an LSB bit stream. Pure static analysis, never executes the pyc.",
    principle:
      "Stegosaurus hides a payload in compiled Python bytecode: most classically in co_lnotab (the line-increment table, Python <3.10) — normally (byte-offset increment, line increment) pairs, into whose increment-pair low bits the tool embeds info while keeping program behavior unchanged; or it stuffs the flag directly into a constant-pool string. This op first determines the Python version by the magic table (2.0-3.13), recursively unmarshals per the version layout (TYPE_* type codes), and extracts the code object's string constants, co_lnotab/co_linetable. It detects three things: 1. scans printable string constants + a full-blob strings fallback with a flag regex; 2. detects abnormal lnotab increments (embedding traces); 3. extracts the LSB of each lnotab byte into a bit stream converted to ASCII (LSB/MSB byte orders). Python 3.10+ switched to co_linetable (PEP 626), where classic lnotab stego doesn't apply and is noted.",
    usage: "Input a .pyc file (hex/base64/drop a file), choose the bit-extraction byte order (LSB/MSB) and minimum string length. Outputs the Python version, code-object overview, string constants, flag hits, and lnotab anomaly + bit-extraction results.",
    examples: [
      { in: ".pyc file bytes", param: "bitOrder=lsb", out: "Python version + flag{...} in string constants + suspected flag from the lnotab LSB bit stream", desc: "Statically extract a flag hidden in the pyc" },
    ],
    tips: ["For pyc stego, check string constants first (most common flag hiding), then lnotab abnormal increments and the LSB bit stream. Python 3.10+'s linetable makes classic lnotab stego inapplicable. If no flag hits, lower minStrLen and switch the bit byte order."],
    aka: ["stegosaurus", "pyc隐写", "pyc steganography", "python字节码隐写", "co_lnotab隐写", "pyc stego", "字节码隐写", "python bytecode stego", "lnotab隐写", "pyc分析", "marshal解析", "pyc隐写检测", "python隐写", "pyc forensics"],
  },

  zipCrc32Brute: {
    what: "ZIP CRC32 content brute force: for a tiny Stored (uncompressed) file in a ZIP with a known CRC32, back-solve the file content. Exhausts CRC32 over all possible contents of length ≤6; on a hit, output it.",
    principle:
      "Every ZIP entry stores the CRC32 of its raw data. When a file is tiny (≤6 bytes), the CRC32 32-bit space is small enough to exhaustively back-solve within a reasonable charset — enumerate all candidate contents, compute CRC32, and a match is a hit. Uses standard CRC-32/ISO-HDLC (poly 0xEDB88320 reflected, matching zip/gzip), table-driven + DFS reusing intermediate registers along the path to avoid recomputing prefixes. Hard limit of 6 bytes; a search space >1 billion is refused (to keep the browser from freezing).",
    usage: "Fill in the target CRC32 (0x3610a686 or 3610a686), pick a charset (lowercase/uppercase/digits/alphanumeric/printable/custom), and min/max length (≤6). Outputs the matched candidate content + hex.",
    examples: [
      { in: "targetCrc=0xd1f4eb9a", param: "charset=lower, maxLen=4", out: 'hit ✓ "flag"  (hex: 66 6c 61 67, len=4)', desc: "Back-solve the plaintext content of a small file" },
    ],
    tips: ["A small method=0 stored file (a few bytes) in a ZIP needs no password cracking — just back-solve the content from CRC32. CRC32 is only 32 bits, so a short string is usually unique; with multiple candidates, judge by file size. Files >6 bytes need offline cracking."],
    aka: ["crc32爆破", "zip crc32", "crc32 brute", "crc爆破", "crc32碰撞", "crc32 bruteforce", "zip小文件爆破", "crc reverse", "crc32反查", "已知crc反推", "crc32 crack", "zip crc爆破", "crc逆向", "crc32内容爆破"],
  },
};
