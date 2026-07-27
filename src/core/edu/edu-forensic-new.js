// 科普内容分片：forensic 取证类新增 19 项（压缩包破解 / john 哈希提取 / 流量分析 / Minecraft 存档 / pyc 隐写 / CRC 爆破）。纯数据，无 import 无副作用。
export default {
  bkcrackAttack: {
    what: "ZipCrypto 已知明文攻击（Biham-Kocher）：传统 ZipCrypto 加密的 ZIP，只要拿到某条目 ≥12 字节连续已知明文，就能直接恢复内部密钥态并解密整个压缩包，无视密码长度。",
    principle:
      "传统 ZipCrypto（非 AES）的加密强度来自三个 32 位内部寄存器 key0/key1/key2。Biham-Kocher 攻击不猜密码，而是从「已知明文 ⊕ 密文」反推这三个寄存器的值。只要 ≥12 字节连续已知明文对上密文，就能把密钥态解出来，之后可解密该 ZIP 全部 ZipCrypto 条目。\n\n关键点：ZipCrypto 加密的是**压缩后**字节。若条目 `method=0`(stored) 已知明文=原文；若 `method=8`(deflate) 已知明文需是原文做同参数 deflate 后的压缩流。AES 加密的 ZIP 无法用本攻击。\n\n引擎是 kimci86/bkcrack 经 emscripten 编成 wasm，本地懒加载，缺失时降级为参数回显。攻击 CPU 密集，典型耗时几分钟到几十分钟。",
    usage: "填加密 ZIP（hex/base64 或拖文件）、目标条目名（如 flag.txt）、≥12 字节已知明文及其编码/偏移。模式选「恢复密钥态」只出 key0/key1/key2，或「恢复并解密」直接导出目标条目。",
    examples: [
      { in: "加密 ZIP + 条目 flag.txt + 12+ 字节已知明文", param: "mode=recover", out: "key0 key1 key2 三个 8 位 hex 内部密钥态", desc: "拿到内部态即可解密全档" },
    ],
    tips: ["明文来源：ZIP 内已知内容文件、文件头魔数（PNG 89504E47、PDF %PDF、内嵌 ZIP 504B0304）。恢复出密钥态后还能 bkcrack -k 反推原始密码字符串。AES 加密的 ZIP 用不了本攻击，改走 zip2john 爆破。"],
    aka: ["bkcrack", "zipcrypto", "已知明文攻击", "known plaintext attack", "biham kocher", "比哈姆科赫", "zip明文攻击", "pkzip stream cipher", "传统zip加密破解", "plaintext attack", "zip密码破解", "known-plaintext", "kimci86", "zip已知明文"],
  },

  formatSniff: {
    what: "格式嗅探：粘一段文本进去，快速识别它是什么——JWT、PEM、URL、IP、UUID、哈希、编码（base64/32/58/hex）、比特币/以太坊地址、助记词、时间戳、信用卡、坐标、代码片段等，给 CTF 选手惊喜提示。",
    principle:
      "对输入跑一组特征识别器，每个用正则或结构判定命中一类格式：JWT 看三段 base64url 点分且头部含 alg；PEM 看 `-----BEGIN`；哈希按长度+字符集猜（32 hex→MD5/NTLM、40→SHA-1、64→SHA-256…）；信用卡跑 Luhn 校验；编码按字符集判 hex/base32/base64/base58。强特征在前，命中即报告类别+依据，不做转换只做识别。",
    usage: "把可疑字符串直接粘进去，无需参数，输出命中的所有格式类别及判定依据。",
    examples: [
      { in: "eyJhbGciOiJub25lIn0.eyJ1c2VyIjoiYWRtaW4ifQ.", out: "JWT: 头部 alg=none，可尝试空签名绕过", desc: "识别 JWT 并提示 alg=none 风险" },
      { in: "5d41402abc4b2a76b9719d911017c592", out: "哈希: 32 hex 字符 = 128 bit，可能 MD5 / MD4 / NTLM / LM" },
    ],
    tips: ["拿到一坨不明字符串先丢这里，它会告诉你可能的方向。alg=none 的 JWT、私钥 PEM、比特币助记词都会被高亮为敏感物。"],
    aka: ["格式识别", "format sniff", "特征识别", "指纹识别", "format detection", "格式嗅探", "identify format", "magic sniff", "格式检测", "数据类型识别", "format fingerprint", "what is this string", "识别输入", "格式判别"],
  },

  sevenZip2john: {
    what: "7z 哈希提取（7z2john）：从加密的 7z 压缩包里提取 John/hashcat 能用的 hash 串（只提取不爆破），输出 `$7z$` 格式，对应 hashcat mode 11600。",
    principle:
      "7z 用 AES-256 + SHA-256 KDF 加密。工具解析 7z 的 SignatureHeader（magic 37 7A BC AF 27 1C）和 NextHeader，从 Folder 的 Coder 链里找 AES 编码器（codecId 06F10701），取出它的 Properties：NumCyclesPower（KDF 迭代=2^n）、salt、IV，再读加密数据、CRC、pack/dec 长度，拼成 `$7z$type$NumCyclesPower$saltLen$salt$ivLen$iv$crc$encLen$decLen$encData` 的 hash 串。头部加密（-mhe=on）时从 ENCODED_HEADER 提取。",
    usage: "输入 7z 文件（hex/base64/拖文件），选输入编码，maxDataLen 控制内联加密数据上限。输出 `$7z$` hash 串，喂给 `hashcat -m 11600` 或 john。",
    examples: [
      { in: "加密 7z 文件字节", out: "$7z$0$19$0$$8$<iv>$<crc>$<encLen>$<decLen>$<encData>", desc: "type=0 stored, NumCyclesPower=19 即 2^19 次" },
    ],
    tips: ["7z2john 提取的是离线爆破用的 hash，本工具不爆破。若 NextHeader 被压缩（非加密），需先解压头部才能提取文件加密信息。hashcat mode 固定 11600。"],
    aka: ["7z2john", "7z哈希提取", "7zip hash", "$7z$", "7z crack", "hashcat 11600", "7z密码提取", "seven zip hash", "7z john", "7z爆破哈希", "7z hash extract", "p7zip hash", "7z密码破解", "7zip john"],
  },

  office2john: {
    what: "Office 哈希提取（office2john）：从加密的 Office 文档（.doc/.docx/.xls/.xlsx/.ppt/.pptx）提取 John/hashcat 格式 hash 串（只提取不爆破）。",
    principle:
      "加密 Office 是 CFB/OLE2 容器（magic D0CF11E0A1B11AE1），加密参数存在 EncryptionInfo 流里。工具解析 CFB 头、FAT/MiniFAT/目录，读出 EncryptionInfo，按版本拆分：Office 2007 是二进制格式（`$office$*2007*`, hashcat 9400，SHA-1+AES-128）；2010/2013 是 Agile XML（`$office$*2010*` hashcat 9500 / `$office$*2013*` hashcat 9600），从 XML 的 encryptedKey 元素取 spinCount、keyBits、salt、encryptedVerifier 等。旧版 97-2003（oldoffice, RC4）只报告不完整提取。",
    usage: "输入加密 Office 文件（hex/base64/拖文件），输出 `$office$` hash 串及参数，喂给对应 hashcat mode 或 john。",
    examples: [
      { in: "加密 .docx（Office 2013）字节", out: "$office$*2013*100000*256*16*<salt>*<encVerifier>*<encVerifierHash>", desc: "spinCount=100000, keyBits=256, hashcat 9600" },
    ],
    tips: ["office2john 只提取不爆破。看 EncryptionInfo 版本号定 hashcat mode：2007→9400，2010→9500，2013→9600。旧版 97-2003 结构分散，建议用 Python office2john.py。"],
    aka: ["office2john", "office哈希提取", "office hash", "$office$", "docx crack", "office密码提取", "hashcat 9400", "hashcat 9500", "hashcat 9600", "ole2 encryption", "encryptioninfo", "office密码破解", "office john", "cfb encryption"],
  },

  pdf2john: {
    what: "PDF 哈希提取（pdf2john）：从加密 PDF 的 /Encrypt 字典提取 John/hashcat 格式 `$pdf$` hash 串（只提取不爆破），照 openwall john 官方 pdf2john 格式。",
    principle:
      "PDF 标准安全处理器把加密参数存在 `/Encrypt` 字典里（`/Filter /Standard`）。工具在 PDF 文本中定位加密字典，取出 /V(算法版本)、/R(修订号)、/Length(密钥位数)、/P(权限位)、/EncryptMetadata、文档 /ID 第一段，以及 /U /O /OE /UE 口令验证串（按修订号截断：R2-4=32 字节，R5/R6=48 字节），拼成 `$pdf$V*R*Length*P*EncMeta*len(ID)*ID_hex*passwords`。R2/3=RC4，R4=RC4或AES-128，R5/R6=AES-256。",
    usage: "输入加密 PDF（PDF 原始字节/hex/base64/拖文件），输出 `$pdf$` hash 串。R2/3→hashcat 10400/10500，R5→10600，R6→10700。",
    examples: [
      { in: "加密 PDF（%PDF... 含 /Encrypt）", out: "$pdf$4*4*128*-3904*1*16*<ID_hex>*32*<U_hex>*...", desc: "V=4 R=4 Length=128 权限位 -3904" },
    ],
    tips: ["pdf2john 只提取不爆破。修订号 /R 决定加密算法与 hashcat mode。缺文档 /ID 时 john 可能不接受，注意提示。"],
    aka: ["pdf2john", "pdf哈希提取", "pdf hash", "$pdf$", "pdf crack", "pdf密码提取", "hashcat 10500", "hashcat 10700", "pdf encrypt", "/Encrypt", "pdf密码破解", "pdf john", "encrypted pdf hash", "pdf口令提取"],
  },

  rar2john: {
    what: "RAR 哈希提取（rar2john）：从 RAR3/RAR5 加密文件提取 hash 串（`$RAR3$` / `$rar5$`），输出可直接喂 john/hashcat，只提取不爆破。",
    principle:
      "工具按 magic 分 RAR3（526172211A0700）和 RAR5（526172211A070100）。RAR3 分两模式：-hp 块头加密取文件末尾 24 字节（前 8 salt + 后 16 加密 END_HEAD）→ `$RAR3$*0*`（hashcat 12500）；-p 文件加密从 FILE_HEAD 取 SALT/CRC/pack/unp/加密数据 → `$RAR3$*1*`（hashcat 23700/23800）。RAR5 用 vint 变长整数解析块，从 extra area 或归档加密头取 kdfCount、16 字节 salt、IV、pswcheck → `$rar5$16$salt$iter$iv$8$pswcheck`（hashcat 13000）。",
    usage: "输入加密 RAR（hex/base64/拖文件），maxDataLen 控制 RAR3-p 数据截取长度。输出 hash 串及对应 hashcat mode。",
    examples: [
      { in: "RAR5 加密文件字节", out: "$rar5$16$<salt>$15$<iv>$8$<pswcheck>", desc: "iter_log2=15 即 PBKDF2 2^15=32768 次" },
    ],
    tips: ["rar2john 只提取不爆破。RAR3-hp 用 hashcat 12500，RAR3-p 用 23700/23800，RAR5 用 13000。RAR5 的 iter 是对数（15→2^15）。"],
    aka: ["rar2john", "rar哈希提取", "rar hash", "$RAR3$", "$rar5$", "rar crack", "rar密码提取", "hashcat 12500", "hashcat 13000", "rar密码破解", "winrar hash", "rar john", "rar5 hash", "rar3 hash"],
  },

  sshkey2john: {
    what: "SSH 私钥哈希提取（sshkey2john）：从加密 SSH 私钥（OpenSSH 新格式 / PEM 传统 RSA/DSA/EC）提取 John `$sshng$` 格式 hash 串（只提取不爆破）。",
    principle:
      "两类私钥格式。OpenSSH 新格式（BEGIN OPENSSH PRIVATE KEY）base64 解码后有 `openssh-key-v1\\0` magic，读出 ciphername（aes256-cbc/ctr）、kdfname（bcrypt）、salt、rounds，拼 `$sshng$cipher_id$salt_len$salt$data_len$data$rounds$ct_offset`；aes256-cbc→cipher_id=2（hashcat 22421），aes256-ctr→6（22422）。传统 PEM（RSA/DSA/EC）有 `Proc-Type: 4,ENCRYPTED` + `DEK-Info: cipher,iv` 头，按 cipher 的 keysize 推 cipher_id，拼 `$sshng$cipher_id$iv_len$iv$data_len$data`。未加密私钥（cipher=none / 无 Proc-Type）报告无需爆破。",
    usage: "把 SSH 私钥文本粘进去（或拖 id_rsa 文件），输出 `$sshng$` hash 串及加密算法/KDF/salt/rounds 信息。喂给 john 或 hashcat 22421/22422。",
    examples: [
      { in: "-----BEGIN OPENSSH PRIVATE KEY----- ...（bcrypt+aes256-cbc）", out: "sshkey:$sshng$2$16$<salt>$<len>$<data>$16$<offset>", desc: "cipher_id=2 (AES-256-CBC), rounds=16" },
    ],
    tips: ["ssh2john 只提取不爆破。OpenSSH 新格式用 bcrypt KDF，hashcat 22421(cbc)/22422(ctr)。私钥没 Proc-Type / cipher=none 表示未加密，直接能用无需爆破。"],
    aka: ["ssh2john", "sshkey2john", "ssh私钥哈希", "sshng", "$sshng$", "ssh key crack", "id_rsa crack", "ssh密码提取", "hashcat 22921", "openssh key hash", "ssh私钥爆破", "encrypted ssh key", "ssh passphrase", "ssh私钥破解"],
  },

  zip2john: {
    what: "ZIP 哈希提取（zip2john）：从加密 ZIP 提取 John/hashcat 格式 hash 串（只提取不爆破）。ZipCrypto→`$pkzip2$`（hashcat 17200-17230），WinZip AES→`$zip2$`（hashcat 13600）。",
    principle:
      "扫 ZIP 的本地文件头（LFH，签名 504B0304），看 GPBF bit0 判是否加密。传统 ZipCrypto（method≠99）拼 `$pkzip2$` 格式，含数据类型、压缩类型、CRC 高位字、时间戳校验字、加密数据。WinZip AES（method=99，extra field 0x9901）从 extra 读加密强度（1/2/3=AES-128/192/256），按强度算 salt 长度（8/12/16），取 salt+验证字节+加密数据+10 字节认证码，拼 `$zip2$*0*strength*0*salt*verify*len*df*auth*$/zip2$`。",
    usage: "输入加密 ZIP（hex/base64/拖文件），maxDataLen 控制内联数据上限。输出 hash 串，ZipCrypto→hashcat 17210，AES→13600。",
    examples: [
      { in: "WinZip AES-256 加密 ZIP", out: "flag.txt:$zip2$*0*3*0*<salt>*<verify>*<len>*<df>*<auth>*$/zip2$", desc: "strength=3 即 AES-256, hashcat 13600" },
    ],
    tips: ["zip2john 只提取不爆破。伪加密（只设 GPBF 位无真加密）不会产生有效 hash。传统 ZipCrypto 若有已知明文，改用 bkcrack 已知明文攻击更快（无视密码长度）。"],
    aka: ["zip2john", "zip哈希提取", "zip hash", "$pkzip2$", "$zip2$", "zip crack", "zip密码提取", "hashcat 13600", "hashcat 17200", "pkzip hash", "winzip aes hash", "zip密码破解", "zip john", "zipcrypto hash"],
  },

  pcapParse: {
    what: "pcap/pcapng 结构解析：把抓包文件逐层拆开——容器头 + 逐帧 Ethernet/IPv4/IPv6/TCP/UDP/ICMP/HTTP/DNS 分帧，输出包摘要表、协议详情、载荷预览。CTF 流量题的地基。",
    principle:
      "先按 magic 认容器：libpcap（0xa1b2c3d4 等，决定字节序）或 pcapng（块结构 SHB/IDB/EPB）。取出每个包的原始字节后逐层剥：链路层（Ethernet/Linux SLL/Loopback）→ 按 ethertype 进 IPv4(RFC 791)/IPv6(RFC 8200) → 按协议号进 TCP(RFC 793)/UDP(RFC 768)/ICMP(RFC 792) → 应用层试 DNS(端口 53)/HTTP(文本特征)。网络协议头始终大端，容器头才受文件字节序影响。纯前端零依赖。",
    usage: "输入 pcap/pcapng（hex/base64/拖文件），maxPackets 限显示数，detail 选「仅摘要」或「含协议详情+载荷」。输出分层报告 + HTTP/DNS 汇总。",
    examples: [
      { in: "pcap 文件字节", param: "detail=full", out: "包摘要 + IPv4/TCP/HTTP 逐层字段 + 载荷 hex/ASCII 预览" },
    ],
    tips: ["流量题第一步先丢这里看整体结构、找 HTTP/DNS。要 TCP 流重组/HTTP 文件提取用 pcapTcpReassemble/pcapHttpExtract，DNS 隧道用 pcapDnsTunnel。"],
    aka: ["pcap解析", "pcap parse", "pcapng", "抓包解析", "流量分析", "packet analysis", "wireshark", "tcpdump", "包分析", "网络取证", "pcap dissect", "流量包解析", "packet capture", "协议分帧"],
  },

  mcLevelDat: {
    what: "Minecraft level.dat 解析：把 Minecraft Java 版世界存档的 level.dat（gzip 压缩的 NBT）解开，输出中文结构化摘要——种子、出生点、GameRules、版本、DataVersion，并高亮非常规 GameRule 和异常坐标等可疑字段。",
    principle:
      "level.dat 是 gzip（魔数 1f 8b）压缩的 NBT 二进制树。工具用原生 DecompressionStream 解压，再用自写大端序 NBT 解析器读树（tag type 0-12，Long/LongArray 用 BigInt，String 走 UTF-8）。从根 Compound 的 Data 子树取 LevelName、Version、DataVersion、种子（WorldGenSettings.seed 或旧版 RandomSeed）、出生点 SpawnX/Y/Z、GameRules 等。CTF 常把 flag 藏在异常坐标（落在可打印 ASCII 区间）、自定义 GameRule、非标准字段里，工具会高亮这些。",
    usage: "输入 level.dat（hex/base64/拖文件），可勾「转储完整 NBT 树」看全部字段。输出结构化摘要 + 可疑字段高亮。",
    examples: [
      { in: "level.dat（gzip NBT）字节", out: "种子 seed: 12345 / 出生点 Spawn: X=102 Y=64 Z=97 / ⚠ 非常规 GameRule ...", desc: "坐标落在 ASCII 区间会被高亮为疑似编码字符" },
    ],
    tips: ["种子、出生点坐标、自定义 GameRule 是藏 flag 三大热点。想看整个 NBT 树用 mcNbtView，想批量抽文本情报用 mcTextExtract。"],
    aka: ["level.dat", "minecraft存档", "mc存档解析", "leveldat parse", "nbt", "我的世界存档", "minecraft save", "gzip nbt", "世界种子", "minecraft nbt", "mc level dat", "麦块存档", "minecraft取证", "world seed"],
  },

  mcMapRender: {
    what: "Minecraft 地图渲染：把 Minecraft Java 版地图物品 map_#.dat（gzip NBT，根下 data.colors 是 128×128 调色板索引）渲染成 PNG。CTF 常用地图物品画二维码/像素画/隐藏文字。",
    principle:
      "map_#.dat 是 gzip 压缩的 NBT，data.colors 是 16384 字节（128×128），每字节一个颜色：baseColorId = byte>>2，shade = byte&3。MC 有 62 个基础色（id 0-61，0=透明），每色 4 档明暗（乘数 180/220/255/135）。工具查内置 MapColor 表算出每像素 RGBA，越界索引画洋红标记异常，再用手写最小 PNG 编码器（IHDR+IDAT+IEND，zlib stored 块封装，零 canvas 依赖）输出 data URL。",
    usage: "输入 map_#.dat（hex/base64/拖文件），选放大倍数（1×/2×/4×，最近邻）。输出 PNG data URL（可粘进浏览器地址栏看图）+ 色彩分布统计。",
    examples: [
      { in: "map_0.dat（gzip NBT）字节", param: "scale=2", out: "data:image/png;base64,... + 非透明像素数 / 疑似全黑（二维码）提示", desc: "128×128 放大到 256×256" },
    ],
    tips: ["地图物品是画二维码/隐藏文字的经典载体。疑似全黑提示常意味着黑底二维码，注意对比或反色。map_#.dat 在存档 data/ 目录，别和 level.dat 搞混。"],
    aka: ["minecraft地图", "mc地图渲染", "map.dat", "map dat render", "minecraft map", "地图物品", "我的世界地图", "map item png", "minecraft mapcolor", "mc地图物品", "地图二维码", "minecraft map render", "map_0.dat", "麦块地图"],
  },

  mcNbtView: {
    what: "Minecraft NBT 树查看器：浏览器版 NBTExplorer，把任意 Minecraft Java 版 NBT（level.dat/*.dat/playerdata/结构 .nbt 等）解压后完整转储为缩进折叠的可读文本树。支持路径过滤定位子树。",
    principle:
      "复用大端序 NBT 解析器，支持 gzip/zlib/裸 NBT 三种存储自动识别。解析后递归转储每个节点：显示 tag 类型名（TAG_Compound/TAG_List/TAG_String/TAG_Long…）、key、值；List 标元素类型和长度；Long/LongArray 用 BigInt 原样打印不丢精度；大数组截断显示前 N 项。路径过滤支持 `Data.Player.Inventory` 或 `a[0].b` 语法，只转储命中的子树。",
    usage: "输入 NBT 文件（hex/base64/拖文件），可填 path 定位子树（如 Data.Player.Inventory），调 maxArray/maxDepth 控制截断和深度。输出完整或子树的文本树。",
    examples: [
      { in: "level.dat 字节", param: "path=Data.GameRules", out: "TAG_Compound 'GameRules': ... 各规则键值树", desc: "路径过滤只看 GameRules 子树" },
    ],
    tips: ["想看整个 NBT 结构、定位某个具体字段用这个。level.dat 快速摘要用 mcLevelDat，批量抽告示牌/成书文本用 mcTextExtract。Long 值用 BigInt 不丢精度。"],
    aka: ["nbt查看器", "nbt viewer", "nbtexplorer", "nbt tree", "minecraft nbt", "nbt解析", "nbt浏览", "nbt编辑器", "我的世界nbt", "nbt dump", "mc nbt view", "nbt结构", "named binary tag", "nbt树"],
  },

  mcTextExtract: {
    what: "Minecraft 文本情报提取：遍历 Minecraft Java 版存档 region/*.mca（Anvil）或单个 .dat/.nbt，一键抽出告示牌、成书、命令方块、实体/方块 CustomName、物品名+Lore，按类型+坐标聚合，并高亮 flag{...} 及常见变体。找 flag 主力工具。",
    principle:
      "支持两种输入：Anvil MCA（头 4KiB location 表 + 4KiB timestamp 表，每 chunk = 长度+压缩类型+zlib NBT）和单个 gzip/zlib/裸 NBT。解压解析后遍历 NBT 树，按字段名抽文本情报——告示牌 Text1-4 或 1.20+ front_text/back_text.messages、成书 pages/title/author、命令方块 Command、CustomName、物品 display.Name/Lore 及 1.20.5+ components 命名键。对每条文本跑 flag 正则（flag{}/通用 xxx{}），并对疑似 base64 解码再扫。可选兜底抽全部 TAG_String。",
    usage: "输入 MCA 或 .dat/.nbt（hex/base64/拖文件），选文件类型，可勾「兜底扫描全部字符串」、填自定义 flag 正则。输出按类型聚合的文本 + flag 命中汇总。",
    examples: [
      { in: "region r.0.0.mca 字节", param: "scanAll=true", out: "⚑ flag{...} ← 告示牌 Sign chunk(3,5) + 各类文本条目", desc: "遍历 chunk 抽告示牌/成书并高亮 flag" },
    ],
    tips: ["MC 存档找 flag 先跑这个：告示牌、成书、命令方块都是藏 flag 热点。命中不理想就勾兜底扫描全字符串或换自定义正则。它会自动 base64 解码再扫一遍。"],
    aka: ["minecraft文本提取", "mc文本情报", "mca解析", "anvil region", "minecraft flag", "存档找flag", "sign book extract", "命令方块提取", "minecraft取证", "mc region", "anvil格式", "minecraft text intel", "告示牌提取", "我的世界找flag"],
  },

  pcapTcpReassemble: {
    what: "TCP 流重组：把 pcap 里散落的 TCP 段按 5 元组聚合，seq 排序去重，还原各方向的完整字节流。是 HTTP 对象提取的基础，也用来还原被拆包的 flag。",
    principle:
      "遍历所有 TCP 段，用无向 5 元组标识连接、按方向（a→b / b→a）分组。以 SYN 的 seq+1 或按 seq 升序的首段为基准 ISN，处理 seq 的 32 位回绕算相对偏移，把每段数据放到正确位置，重传数据「首次写入优先」去重。输出重组后的连续字节流（文本或 hex）。RFC 793。",
    usage: "输入 pcap/pcapng（hex/base64/拖文件），留空 flowIndex 看流列表，填流号看该流完整双向内容。previewBytes/maxFlows 控制预览。",
    examples: [
      { in: "含 TCP 流量的 pcap", param: "flowIndex=0", out: "流 #0 双向重组字节流（文本或 hex 完整转储）", desc: "还原一条 TCP 连接的完整内容" },
    ],
    tips: ["flag 被拆到多个 TCP 包时靠重组还原。重组后是 HTTP 就用 pcapHttpExtract 提对象。乱序/重传都会被 seq 排序去重处理。"],
    aka: ["tcp流重组", "tcp reassemble", "tcp stream", "流重组", "tcp重组", "follow tcp stream", "tcp流还原", "stream reassembly", "追踪tcp流", "tcp payload重组", "tcp segment reassembly", "字节流重组", "tcp流跟踪", "seq重组"],
  },

  pcapHttpExtract: {
    what: "HTTP 对象提取：在 TCP 重组基础上解析 HTTP 请求/响应，处理 chunked 传输和 gzip/deflate 解压（纯 JS inflate），导出流量里传输的文件和文本。",
    principle:
      "先做 TCP 流重组，再在字节流里按 HTTP 报文切：找 `\\r\\n\\r\\n` 头体分隔，解析起始行判请求/响应、解析头部。body 按 Transfer-Encoding: chunked 拼块，或按 Content-Length 截取，或响应无长度时读到流尾。再按 Content-Encoding 用自写 inflate（RFC 1951 DEFLATE / 1950 zlib / 1952 gzip，不依赖 DecompressionStream）解压 gzip/deflate。RFC 9112/2616。",
    usage: "输入 pcap/pcapng（hex/base64/拖文件），留空 dumpIndex 看对象列表，填号导出该对象完整 body。previewBytes 控制列表预览。",
    examples: [
      { in: "含 HTTP 流量的 pcap", param: "dumpIndex=2", out: "HTTP 对象 #2 完整 body（自动解 gzip/chunked）文本或 hex", desc: "导出传输的图片/文本文件" },
    ],
    tips: ["HTTP 传的文件、gzip 压缩的响应都能自动还原。加密 HTTPS 提不出（只能拿到密文）。chunked 和 gzip/deflate 都内置解码，不用手动处理。"],
    aka: ["http对象提取", "http extract", "http文件提取", "export objects", "http导出", "http还原", "http object", "提取http文件", "http流量提取", "chunked解码", "gzip解压", "http response body", "文件提取", "http carve"],
  },

  pcapDnsTunnel: {
    what: "DNS 隧道检测：提取 DNS 查询的子域名数据标签，拼接后尝试 base32/base64/hex 解码，检出 DNS 隧道外泄的隐藏数据。",
    principle:
      "DNS 隧道把数据编码进查询的前导子域名标签里（如 `<base32数据>.evil.com`），一次查询带一小段。工具收集所有 DNS query（优先请求去重），剥掉基准域或末尾 N 个标签留下数据部分，按顺序拼接，再用 base32/base64/hex 试解码，按可打印率排序给出最可能的明文。还给隧道启发式（唯一域名数、平均查询名长度偏高=疑似隧道）。RFC 1035 + RFC 4648。",
    usage: "输入 pcap/pcapng（hex/base64/拖文件），填基准域名（如 evil.com）或用默认剥离末尾标签数，选解码方式（auto 全试/base32/base64/hex/只提取）。输出拼接数据流 + 解码结果。",
    examples: [
      { in: "含 DNS 隧道的 pcap", param: "decodeAs=auto", out: "拼接数据流 + [base32] 解出可读明文（可打印率 95% ★可读）", desc: "还原 DNS 隧道外泄的数据" },
    ],
    tips: ["查询名特别长、唯一子域名特别多就是 DNS 隧道信号。DNS 隧道最常用 base32（域名不区分大小写，base32 字符集刚好合规）。填准基准域名剥离更干净。"],
    aka: ["dns隧道", "dns tunnel", "dns隧道检测", "dns tunneling", "dns外泄", "dns数据外泄", "dns exfiltration", "子域名解码", "dns隐蔽通道", "dns covert channel", "iodine", "dnscat", "dns隐写", "dns tunnel detect"],
  },

  pcapIcmpPayload: {
    what: "ICMP 载荷提取：提取 ICMP echo 包的 payload，按 id/seq 排序拼接，还原 ICMP 隐写/隧道外泄的数据。",
    principle:
      "ICMP echo request/reply 的 payload 本是填充数据，但常被用来夹带隐藏信息（ping 隧道）。工具收集所有 ICMP 包，从字节里读 type/code/id/seq 和 8 字节头后的 payload，按 (id, seq) 排序拼接成完整数据，输出文本或 hex+ASCII。可按包类型过滤（全部/仅 Echo Request type=8/仅 Echo Reply type=0）。RFC 792。",
    usage: "输入 pcap/pcapng（hex/base64/拖文件），选包类型过滤，previewBytes 控制 ASCII 预览。输出逐包列表 + 按 seq 拼接的完整载荷。",
    examples: [
      { in: "含 ICMP 隐写的 pcap", param: "filter=request", out: "逐包 EchoReq id/seq/payload + 按 seq 拼接的完整载荷（文本或 hex）", desc: "还原 ping 隧道外泄数据" },
    ],
    tips: ["ping 隧道/ICMP 隐写把数据藏在 echo payload。只看 request 或只看 reply 能避免数据重复。拼接后若是 hex/base64 再套对应解码。"],
    aka: ["icmp载荷提取", "icmp payload", "icmp隧道", "ping隧道", "icmp tunnel", "icmp隐写", "ping tunnel", "icmp exfiltration", "echo payload", "icmp数据提取", "icmp covert channel", "ping隐写", "icmp外泄", "icmp payload extract"],
  },

  stegosaurus: {
    what: "Stegosaurus pyc 隐写检测：解析 .pyc 头定 Python 版本，递归解 marshal code object，扫字符串常量藏的 flag、检测 co_lnotab 行号表异常并抽 LSB bit 流。纯静态分析，绝不执行 pyc。",
    principle:
      "Stegosaurus 把 payload 藏进已编译 Python 字节码：最典型是 co_lnotab（行号增量表，Python <3.10）——正常是 (字节偏移增量, 行号增量) 对，工具在保持程序行为不变前提下往增量对低位 bit 嵌信息，或直接把 flag 塞进常量池字符串。本 op 先按 magic 表定 Python 版本（2.0-3.13），按版本布局递归解 marshal（TYPE_* 类型码），解出 code object 的字符串常量、co_lnotab/co_linetable。检测三处：①扫描可打印字符串常量+全 blob strings 兜底跑 flag 正则；②检测 lnotab 异常增量（嵌入痕迹）；③抽 lnotab 每字节 LSB 拼 bit 流转 ASCII（LSB/MSB 两种字节序）。Python 3.10+ 改用 co_linetable（PEP 626），经典 lnotab 隐写不适用会标注。",
    usage: "输入 .pyc 文件（hex/base64/拖文件），选 bit 提取字节序（LSB/MSB）、最短字符串长度。输出 Python 版本、code object 概览、字符串常量、flag 命中、lnotab 异常+bit 提取结果。",
    examples: [
      { in: ".pyc 文件字节", param: "bitOrder=lsb", out: "Python 版本 + 字符串常量里的 flag{...} + lnotab LSB bit 流拼出的疑似 flag", desc: "静态提取藏在 pyc 里的 flag" },
    ],
    tips: ["pyc 隐写先看字符串常量（藏 flag 最常见），再看 lnotab 异常增量和 LSB bit 流。Python 3.10+ 的 linetable 经典 lnotab 隐写不适用。flag 没命中就调低 minStrLen、切 bit 字节序。"],
    aka: ["stegosaurus", "pyc隐写", "pyc steganography", "python字节码隐写", "co_lnotab隐写", "pyc stego", "字节码隐写", "python bytecode stego", "lnotab隐写", "pyc分析", "marshal解析", "pyc隐写检测", "python隐写", "pyc forensics"],
  },

  zipCrc32Brute: {
    what: "ZIP CRC32 内容爆破：ZIP 里 Stored（未压缩）的极小文件已知 CRC32，反查文件内容。对长度 ≤6 的所有可能内容穷举 CRC32，命中即输出。",
    principle:
      "ZIP 每个条目都存了原始数据的 CRC32。当文件极小（≤6 字节），CRC32 的 32 位空间足以在合理字符集内穷举反查——枚举所有候选内容算 CRC32，等于目标就是命中。用标准 CRC-32/ISO-HDLC（poly 0xEDB88320 反射式，与 zip/gzip 一致），表驱动 + DFS 沿路径复用中间寄存器避免重算前缀。硬上限 6 字节，搜索空间 >10 亿拒跑（防浏览器卡死）。",
    usage: "填目标 CRC32（0x3610a686 或 3610a686），选字符集（小写/大写/数字/字母数字/可打印/自定义）、最小最大长度（≤6）。输出命中的候选内容+hex。",
    examples: [
      { in: "targetCrc=0xd1f4eb9a", param: "charset=lower, maxLen=4", out: '命中 ✓ "flag"  (hex: 66 6c 61 67, len=4)', desc: "反查出小文件明文内容" },
    ],
    tips: ["ZIP 里 method=0 stored 的小文件（几字节）不用爆密码，直接 CRC32 反查内容。CRC32 只 32 位，短串一般唯一；多个候选时结合文件大小判断。>6 字节需离线爆破。"],
    aka: ["crc32爆破", "zip crc32", "crc32 brute", "crc爆破", "crc32碰撞", "crc32 bruteforce", "zip小文件爆破", "crc reverse", "crc32反查", "已知crc反推", "crc32 crack", "zip crc爆破", "crc逆向", "crc32内容爆破"],
  },
};
