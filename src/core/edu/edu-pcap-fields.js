// pcapFieldExtract — pcap 逐包字段提取/过滤科普
export const PCAP_FIELDS_EDU_ZH = {
  pcapFieldExtract: {
    what: "pcap 字段提取/过滤：逐包抽取 ip.id / TTL / TCP urgent pointer / DNS qry-answer 等字段，可按协议与方向过滤，输出表格、TSV 或纯值。常用于把藏在 ip.id、TTL、URG 指针、DNS 应答里的 covert channel 还原成字节流。",
    principle:
      "pcap 每个包先按以太网/IP/TCP/UDP/ICMP/DNS 逐层切头，再从各层头部取指定字段：\n\n" +
      "**ip.id**：IP 头第 5-6 字节的 16 位标识符，有些外泄题把数据按两字节一段写进连续包的 ip.id。\n" +
      "**ip.ttl**：IP 头第 9 字节，正常取值集中在少数几个数（64/128/255 附近），TTL 隐写把数据位写在异常值里。\n" +
      "**tcp.urgptr**：TCP 头第 19-20 字节（RFC 9293 §3.1），URG=1 时是紧急数据末字节偏移；不相关标志位的 urgptr 也是常见藏字节点。\n" +
      "**dns.qry.name / dns.txt**：查询子域名与应答记录（TXT 多串按 RFC 1035 §3.3.14 顺序拼接）是 DNS 隧道外泄的主通道。\n\n" +
      "方向过滤支持 src:/dst:/port= 与裸 IP（AND 组合）；values 输出逐行一个值，可直接接 TTL 隐写或二进制解码。",
    usage: "拖入 pcap（或粘贴 hex/base64），选字段（逗号分隔）与协议/方向过滤，选输出格式。table 给人读，tsv 给机器对拍，values 逐行纯值直接喂下游隐写解码。",
    examples: [
      { in: "pcap + fields=ip.ttl, out=values", param: "全部协议", out: "逐行 TTL 值 → 接 TTL 隐写解码", desc: "TTL covert channel 还原" },
      { in: "pcap + fields=ip.id", param: "tcp 过滤", out: "逐包 ip.id 表", desc: "ip.id 两字节一段拼字节流" },
      { in: "pcap + fields=dns.qry.name,dns.txt, dirFilter=port=53", param: "dns 过滤", out: "查询/应答对照表", desc: "DNS 隧道定位子域名外泄" },
      { in: "pcap + fields=tcp.urgptr", param: "tcp 过滤", out: "URG 指针列", desc: "紧急指针藏字节" },
    ],
    tips: [
      "fields 是**逗号分隔**的字段目录：ip.id / ip.ttl / tcp.urgptr / tcp.seq / dns.id / dns.qry.name / dns.txt / icmp.seq / icmp.id 等都在目录里，写错字段名会得到空列。",
      "方向过滤是 **AND** 组合：src:10.0.0.1 与 dst:53 同时给表示「从 10.0.0.1 发往 53 端口」。",
      "values 输出不含表头，逐行一个值，适合直接贴进 ttlStego 之类的位流解码 op。",
      "乱序/重传不影响字段表（字段是逐包的），但 TCP 流重组类 op 会受影响——两者用途不同。",
      "重组诊断里缺段字节以 0x00 占位并显式报告，不会静默补齐或静默截断。",
    ],
    aka: [
      "pcap字段提取", "pcap field extract", "ip.id隐写", "ttl隐写", "TTL covert channel",
      "urgptr隐写", "紧急指针隐写", "dns qry name", "pcap字段过滤", "包字段提取",
      "ipid ttl stego", "流量字段隐写",
    ],
  },
  ftpExtract: {
    what: "FTP 对象提取：从 pcap 里认出 FTP 控制连接（默认 21 端口）的明文命令/应答，把 PORT/PASV/EPSV 公告配对出的数据连接里传的文件原字节导出来。主动/被动/扩展被动、多会话、ASCII/二进制传输都标清楚。",
    principle:
      "FTP 是双通道协议：**控制连接**走 USER/PASS/TYPE/RETR/STOR 等明文命令，真正的文件内容走另一条**数据连接**。\n\n" +
      "三种数据连接建立方式：主动模式客户端用 PORT 告诉服务器「来连我这个端口」（服务器从 20 连回）；被动模式服务器用 227 应答给地址端口，客户端主动连；EPSV 用 229 应答只给端口号。\n\n" +
      "本工具把控制连接两个方向各自重组，从命令流里抽出「传输公告」与「传输命令」，按出现顺序配对（命令/应答精确交错在重组后不可恢复，所以用位置配对并把口径显式给你），再按五元组找到对应数据流，把载荷原字节落成产物文件，附 SHA-256 对拍。缺段字节以 0x00 占位并显式报告缺在哪。",
    usage: "拖入 pcap（或贴 hex/base64），留空「导出传输号」先看列表（每条传输的方向/类型/大小/预览），填传输号导出该文件原字节产物。",
    examples: [
      { in: "pcap（PASV + RETR 二进制）", param: "dumpIndex 留空", out: "列表列出 1 条下载传输（1537B）", desc: "先列表确认再导出" },
      { in: "同一 pcap", param: "dumpIndex=0", out: "文件原字节产物，SHA-256 与原文件一致", desc: "导出后可继续接文件分析" },
      { in: "纯 HTTP 的 pcap", param: "默认", out: "「未发现 FTP 控制连接」显式报错", desc: "不硬凑结果" },
    ],
    tips: [
      "USER/PASS 凭据会显示在列表里——FTP 是明文协议，抓包即泄露。",
      "FTPS（FTP over TLS）控制流是密文，本工具显式不支持并会提示。",
      "ASCII 模式（TYPE A）按线上捕获字节为准并标注，不模拟换行转换。",
      "数据流缺段（丢包/截断）以 0x00 占位并在报告里写明缺失区间，导出的 SHA 自然与原文件不同。",
      "端口复用的数据流每条只消费一次，多会话各配各的。",
    ],
    aka: [
      "ftp提取", "ftp文件提取", "pcap ftp", "ftp pasv", "ftp port模式", "ftp提取文件",
      "ftp数据流重组", "ftp epsv", "ftp流量分析", "FTP traffic extraction",
      "ftp file carving", "ftp取回文件",
    ],
  },
  tlsDecrypt: {
    what: "TLS1.2 已知密钥还原（预研档）：配合 NSS keylog（浏览器/openssl 的 SSLKEYLOGFILE 里那行 CLIENT_RANDOM），离线解密抓包里的 TLS1.2 AES-128-GCM 流量，导出双向明文。",
    principle:
      "TLS 流量本身不可解——除非你有密钥。本工具走「已知密钥」路线：\n\n" +
      "① 从握手报文里提取 Client Random；② 在你提供的 keylog 里按 CLIENT_RANDOM 命中同一会话，拿到 master secret；③ 用 PRF-SHA256 跑 \"key expansion\" 展开 key_block，切出客户端/服务器两方向的写密钥与 IV；④ 逐条记录做 AES-128-GCM **认证解密**：nonce = salt || 显式 nonce，AAD = 序号 || 类型 || 版本 || 明文长度。\n\n" +
      "最隐蔽的坑：ChangeCipherSpec 之后那条加密 Finished（type 22）**也消耗序号**——序号差 1 就是全盘认证失败。支持套件仅 TLS1.2 + AES-128-GCM（0xc02b / 0xc02f / 0x009c）。",
    usage: "拖入 pcap（或贴 hex/base64），keylog 参数贴 SSLKEYLOGFILE 内容（每行一条 CLIENT_RANDOM <64hex> <64hex>），跑完得双向明文与 SHA-256。",
    examples: [
      { in: "TLS1.2 抓包 + 本会话 keylog", param: "默认", out: "c2s/s2c 双向明文，GCM tag 全验通过", desc: "明文里可直接看到 HTTP 内容" },
      { in: "TLS1.2 抓包 + 另一会话的 keylog", param: "默认", out: "「client_random 不匹配」显式报错，零产物", desc: "不伪造明文" },
      { in: "TLS1.3 抓包", param: "默认", out: "显式拒绝并说明单档范围", desc: "TLS1.3 走 HKDF 多密钥期，另立卡" },
    ],
    tips: [
      "浏览器抓包解密：设置 SSLKEYLOGFILE 环境变量再开浏览器，keylog 文件内容直接贴进来。",
      "无 keylog = 无密钥 = 明确不可解，这是设计而不是缺陷。",
      "keylog 是会话级的：错会话的 CLIENT_RANDOM 会在握手匹配阶段被拒绝，不会解出乱码。",
      "CBC 套件 / SHA384 PRF / ChaCha20-Poly1305 都不在本档，显式拒绝。",
    ],
    aka: [
      "tls解密", "tls1.2解密", "sslkeylog", "keylog解密", "tls gcm解密", "tls流量解密",
      "decrypt tls pcap", "tls keylog decrypt", "tls抓包解密", "ssl解密",
      "tls1.2 aes-gcm", "已知密钥解密",
    ],
  },
  wpaDecrypt: {
    what: "WPA2 握手校验/CCMP 解密（预研档）：从 radiotap/802.11 抓包里判 EAPOL 四步握手，用已知 SSID+口令派生 PTK 验 MIC，口令对了才把 CCMP 数据帧认证解密，并重建经典以太网 pcap 直接接回现有流量分析链。",
    principle:
      "① PMK = PBKDF2-HMAC-SHA1(口令, SSID, 4096)；② PTK = PRF-SHA1(PMK, min/max(ANonce,SNonce) || min/max(AP Mac,STA Mac))，802.11i 口径直接拼接 76 字节、无对齐填充；③ 握手 M2/M4（或 M2/M3）的 MIC 用 KCK 做 HMAC-SHA1 截 16 字节校验——**口令对错就由这一步判定**；④ 数据帧是 CCMP（AES-CCM，M=8/L=2），PN 做 nonce、AAD 覆盖帧头，解密后把 802.11 帧转成以太网帧重建 linktype 1 的 pcap。\n\n" +
      "细节坑：MIC 只算在明文上（解密侧 CBC-MAC 也是）；802.11 头里只有 Key Information 是小端；LLC/SNAP 头是 9 字节。",
    usage: "拖入无线 pcap（或贴 hex/base64），填 SSID 与已知口令；「CCMP 解密」选口令正确即解密 / 强制 / 仅握手分析。口令不对时只给握手分析，不解密不输出。",
    examples: [
      { in: "WPA2 抓包 + 正确 SSID/口令", param: "decrypt=auto", out: "MIC 校验通过 → 数据帧解密 → Ethernet pcap 产物", desc: "产物可接 pcapParse/pcapDeep 继续分析" },
      { in: "同 pcap + 错口令", param: "decrypt=auto", out: "「MIC 校验失败」显式结论，零解密产物", desc: "对错判定是确定性的" },
      { in: "同 pcap", param: "decrypt=off", out: "仅握手分析（M1-M4/重放计数器）", desc: "没有口令也能看握手" },
    ],
    tips: [
      "抓不到四步握手就只能做握手分析——没有 nonce 就派生不出可校验的 PTK。",
      "WPA3/SAE 与 TKIP 都显式拒绝；本工具不调网卡、不注入、不联网。",
      "口令逐个验证，不做无界爆破——大字典请走 aircrack-ng/hashcat。",
      "重建的以太网 pcap 是 linktype 1，可直接拖回本箱流量类工具继续跑。",
    ],
    aka: [
      "wpa2解密", "wifi抓包解密", "eapol握手", "四步握手", "ccmp解密", "wpa psk解密",
      "wpa2 ccmp", "wifi password decrypt", "802.11解密", "握手包分析",
      "wpa握手校验", "无线流量解密",
    ],
  },
  oleExtract: {
    what: "OLE/CFB 容器静态提取：解析 OLE2（Compound File Binary）复合文档的目录树，列出全部 storage/stream 并把流内容提取为文件，给出大小与 SHA-256。适用 .doc/.xls/.ppt（Office 97-2003）、.msi、vbaProject.bin 等。",
    principle:
      "CFB 把文件切成固定扇区（v3=512B，v4=4096B）：头部 512 字节给出 FAT/DIFAT 位置、目录起始扇区与 mini 流 cutoff（默认 4096B）。FAT 是扇区链表，把流的内容串起来；小于 cutoff 的「小流」不直接占扇区，而是打包进 Root Entry 的一段连续空间（mini 流），按 64 字节小扇区切分、由 MiniFAT 链接。目录是 128 字节定长项：名称 UTF-16LE、类型（storage/stream/root）、红黑树 sibling/child 指针、起始扇区、大小。解析时按兄弟树走完整目录，对每个流按大小选 FAT 或 MiniFAT 通道取字节。",
    usage: "把 OLE 文件拖进输入框 → 输出容器版本、Root CLSID、完整目录树与每个流的大小/SHA-256，流内容附「⬇ 下载」产物（总量受上限参数保护）。容器内含 VBA 宏工程（VBA/dir）时自动解析 dir 记录、按代码页解压导出各模块宏源码文本。静态只读，绝不执行宏或文档内代码。",
    examples: [
      { in: "嵌套 OLE：Documents/A/B/nested.txt + 大流 Workbook.bin + 中文流名", out: "目录树 7 对象全列出；Workbook.bin(5000B) 走 FAT、小流走 MiniFAT，逐字节 SHA-256 对上生成期内容", desc: "双通道取流 + 深层嵌套 + UTF-16LE 流名" },
      { in: "magic 被破坏的文件", out: "显式报「不是 OLE/CFB 容器」，并提示 .docx/.xlsx 是 ZIP 容器应走解压类工具", desc: "如实拒绝，不猜测" },
    ],
    tips: [
      "Office 2007+ 的 .docx/.xlsx/.pptx 是 ZIP 不是 OLE——用解压/zipCreate 类工具。",
      "vbaProject.bin 本身是 OLE 容器：本工具直接识别其中 VBA 宏工程，列出模块清单并导出宏源码（MS-OVBA 压缩解压，按工程代码页解码）。",
      "红线：只静态读取，不执行宏、不运行文档内任何代码。",
      "流超过产物上限时只列出并标注，不附下载。",
    ],
    aka: ["OLE", "OLE2", "CFB", "复合文档", "compound file", "ole extract", "OLE 提取", "vbaProject", "msi 提取", "doc xls ppt 容器", "compound file binary", "olecf", "文档取证"],
  },
};
export default PCAP_FIELDS_EDU_ZH;

export const PCAP_FIELDS_EDU_EN = {
  pcapFieldExtract: {
    what: "pcap field extraction/filtering: pull ip.id / TTL / TCP urgent pointer / DNS qry-answer style fields per packet, filter by protocol and direction, and output as a table, TSV or bare values. Commonly used to recover covert channels hidden in ip.id, TTL, the URG pointer or DNS answers as byte streams.",
    principle:
      "Each packet is dissected layer by layer (Ethernet/IP/TCP/UDP/ICMP/DNS) and the requested field is read from the corresponding header:\n\n" +
      "**ip.id**: the 16-bit identifier at IP header bytes 5-6; some exfiltration tasks write data two bytes at a time into consecutive packets' ip.id.\n" +
      "**ip.ttl**: byte 9 of the IP header; normal values cluster around 64/128/255, and TTL steganography writes data bits into the outliers.\n" +
      "**tcp.urgptr**: bytes 19-20 of the TCP header (RFC 9293 section 3.1); when URG=1 it is the offset of the last urgent byte, and unrelated flags' urgptr values are a classic hiding spot.\n" +
      "**dns.qry.name / dns.txt**: query subdomains and answer records (TXT character-strings concatenated per RFC 1035 section 3.3.14) are the main DNS tunnel channels.\n\n" +
      "Direction filters accept src:/dst:/port= and bare IPs (AND-combined); the values output prints one value per line, ready for TTL stego or binary decoders.",
    usage: "Drop a pcap (or paste hex/base64), choose the fields (comma separated) plus protocol/direction filters, and an output format. table is human-readable, tsv is for machine diffing, values prints bare values line by line for downstream stego decoders.",
    examples: [
      { in: "pcap + fields=ip.ttl, out=values", param: "all protocols", out: "one TTL per line -> feed into TTL stego decode", desc: "Recovering a TTL covert channel" },
      { in: "pcap + fields=ip.id", param: "tcp filter", out: "per-packet ip.id table", desc: "Splicing ip.id pairs into a byte stream" },
      { in: "pcap + fields=dns.qry.name,dns.txt, dirFilter=port=53", param: "dns filter", out: "query/answer table", desc: "Locating subdomain exfiltration in a DNS tunnel" },
      { in: "pcap + fields=tcp.urgptr", param: "tcp filter", out: "URG pointer column", desc: "Bytes hidden in the urgent pointer" },
    ],
    tips: [
      "fields is a **comma separated** directory: ip.id / ip.ttl / tcp.urgptr / tcp.seq / dns.id / dns.qry.name / dns.txt / icmp.seq / icmp.id and more; a mistyped field name yields an empty column.",
      "Direction filters are **AND** combined: src:10.0.0.1 together with dst:53 means from 10.0.0.1 to port 53.",
      "The values output has no header row - one value per line, ready to paste into a TTL bitstream decoder.",
      "Reordering/retransmissions do not affect the per-packet field table, but they do affect TCP stream reassembly ops - different purposes.",
      "Reassembly diagnostics mark missing bytes as 0x00 placeholders and report them explicitly - never silently patched or truncated.",
    ],
    aka: [
      "pcap field extract", "packet field table", "ip.id stego", "ttl stego",
      "TTL covert channel", "urgptr stego", "urgent pointer stego",
      "dns query name extract", "pcap field filter", "per-packet fields",
      "ipid ttl stego", "traffic field stego",
    ],
  },
  ftpExtract: {
    what: "FTP object extraction: spot the FTP control connection (default port 21) in a pcap, read its plaintext commands/replies, and export the raw bytes transferred over the paired data connections announced via PORT/PASV/EPSV. Active/passive/extended-passive, multiple sessions and ASCII/binary types are all labelled.",
    principle:
      "FTP is a dual-channel protocol: the **control connection** carries plaintext commands (USER/PASS/TYPE/RETR/STOR...), while file contents travel over a separate **data connection**.\n\n" +
      "Three ways to set one up: active mode - the client tells the server which port to call back with PORT (server connects from port 20); passive mode - the server replies 227 with an address:port and the client connects; EPSV - the server replies 229 with just a port number.\n\n" +
      "This tool reassembles both directions of the control connection, extracts transfer announcements and transfer commands from the command stream, pairs them **positionally** (exact command/reply interleaving is not recoverable after reassembly, so the pairing rule is stated explicitly), then locates each data stream by its 5-tuple and dumps the payload bytes as product files with SHA-256 for verification. Missing bytes are 0x00 placeholders with the gap ranges reported.",
    usage: "Drop a pcap (or paste hex/base64); leave \"export transfer no.\" empty to list transfers (direction/type/size/preview per entry), then enter a number to export that file's raw bytes.",
    examples: [
      { in: "pcap (PASV + RETR binary)", param: "dumpIndex empty", out: "list shows 1 download transfer (1537B)", desc: "List first, then export" },
      { in: "same pcap", param: "dumpIndex=0", out: "raw-bytes product file, SHA-256 matches the original", desc: "Export feeds straight into file analysis" },
      { in: "plain HTTP pcap", param: "default", out: "explicit \"no FTP control connection found\" error", desc: "No fabricated results" },
    ],
    tips: [
      "USER/PASS credentials appear in the list - FTP is plaintext, a capture leaks everything.",
      "FTPS (FTP over TLS) has an encrypted control channel and is explicitly unsupported (with a hint).",
      "ASCII mode (TYPE A) keeps the bytes as captured, without simulating newline conversion.",
      "Gaps in a data stream (loss/truncation) become 0x00 placeholders with the missing ranges reported; the SHA naturally differs from the original.",
      "Reused data ports are consumed once per stream; concurrent sessions pair independently.",
    ],
    aka: [
      "ftp extract", "ftp file extraction", "pcap ftp", "ftp pasv", "ftp active mode", "ftp file carving",
      "ftp data stream reassembly", "ftp epsv", "ftp traffic analysis", "ftp object export",
      "ftp取回文件", "ftp流量提取",
    ],
  },
  tlsDecrypt: {
    what: "TLS1.2 known-key decryption (preview tier): together with an NSS keylog (the CLIENT_RANDOM line from a browser's or openssl's SSLKEYLOGFILE), decrypt TLS1.2 AES-128-GCM traffic in a capture offline and export both directions' plaintext.",
    principle:
      "TLS traffic is undecryptable on its own - unless you have the key. This tool follows the known-key route:\n\n" +
      "(1) extract the Client Random from the handshake; (2) match it against CLIENT_RANDOM lines in your keylog to get the master secret; (3) run PRF-SHA256 \"key expansion\" to derive the key_block and cut out client/server write keys and IVs; (4) authenticate-and-decrypt each record with AES-128-GCM: nonce = salt || explicit nonce, AAD = seq || type || version || plaintext length.\n\n" +
      "The subtlest trap: the encrypted Finished (type 22) right after ChangeCipherSpec **also consumes a sequence number** - being off by one fails authentication wholesale. Supported suites: TLS1.2 + AES-128-GCM only (0xc02b / 0xc02f / 0x009c).",
    usage: "Drop a pcap (or paste hex/base64), paste your SSLKEYLOGFILE contents into the keylog parameter (one CLIENT_RANDOM <64hex> <64hex> per line), and get both directions' plaintext with SHA-256.",
    examples: [
      { in: "TLS1.2 capture + matching keylog", param: "default", out: "c2s/s2c plaintext, all GCM tags verified", desc: "HTTP content readable directly" },
      { in: "TLS1.2 capture + another session's keylog", param: "default", out: "explicit \"client_random mismatch\" error, zero output", desc: "No fabricated plaintext" },
      { in: "TLS1.3 capture", param: "default", out: "explicit rejection explaining the single-suite scope", desc: "TLS1.3 uses HKDF multi-key eras - separate card" },
    ],
    tips: [
      "Browser capture decryption: set the SSLKEYLOGFILE environment variable before launching the browser, then paste the file contents in.",
      "No keylog = no key = explicitly undecryptable - by design, not a defect.",
      "The keylog is session-scoped: a mismatched CLIENT_RANDOM is rejected at handshake matching, so you never get garbage output.",
      "CBC suites / SHA384 PRF / ChaCha20-Poly1305 are out of scope and explicitly rejected.",
    ],
    aka: [
      "tls decrypt", "tls1.2 decrypt", "sslkeylog", "keylog decryption", "tls gcm decrypt", "tls traffic decryption",
      "decrypt tls pcap", "tls keylog decrypt", "ssl decrypt", "known key decryption",
      "tls解密", "tls1.2 aes-gcm",
    ],
  },
  wpaDecrypt: {
    what: "WPA2 handshake verification / CCMP decryption (preview tier): parse radiotap/802.11 captures, identify the EAPOL 4-way handshake, derive the PTK from a known SSID+passphrase to verify the MIC, and only on success decrypt CCMP data frames - rebuilding a classic Ethernet pcap that plugs into the existing traffic-analysis chain.",
    principle:
      "(1) PMK = PBKDF2-HMAC-SHA1(passphrase, SSID, 4096); (2) PTK = PRF-SHA1(PMK, min/max(ANonce,SNonce) || min/max(AP Mac,STA Mac)) per 802.11i - a plain 76-byte concatenation, no alignment padding; (3) the MIC of handshake messages M2/M4 (or M2/M3) is HMAC-SHA1 truncated to 16 bytes keyed by the KCK - **the passphrase verdict comes from this step alone**; (4) data frames are CCMP (AES-CCM, M=8/L=2) with the PN as nonce and the AAD covering the frame header; after decryption the 802.11 frames are converted to Ethernet and rebuilt as a linktype-1 pcap.\n\n" +
      "Detail traps: the MIC is computed over plaintext (the decrypt-side CBC-MAC too); in the 802.11 key frame only Key Information is little-endian; the LLC/SNAP header is 9 bytes.",
    usage: "Drop a wireless pcap (or paste hex/base64), enter the SSID and known passphrase; set \"CCMP decryption\" to auto (decrypt on correct passphrase) / forced / handshake-only. A wrong passphrase yields handshake analysis only - no decryption, no output.",
    examples: [
      { in: "WPA2 capture + correct SSID/passphrase", param: "decrypt=auto", out: "MIC verified -> frames decrypted -> Ethernet pcap product", desc: "Product feeds into pcapParse/pcapDeep" },
      { in: "same capture + wrong passphrase", param: "decrypt=auto", out: "explicit \"MIC verification failed\" verdict, zero decrypted output", desc: "The pass/fail verdict is deterministic" },
      { in: "same capture", param: "decrypt=off", out: "handshake analysis only (M1-M4 / replay counters)", desc: "Handshake inspection needs no passphrase" },
    ],
    tips: [
      "Without a captured 4-way handshake only handshake analysis is possible - no nonces means no verifiable PTK.",
      "WPA3/SAE and TKIP are explicitly rejected; this tool never touches the network card, injects frames, or goes online.",
      "Passphrases are verified one by one - no unbounded brute force; use aircrack-ng/hashcat for large dictionaries.",
      "The rebuilt Ethernet pcap is linktype 1 - drop it straight back into this toolbox's traffic tools.",
    ],
    aka: [
      "wpa2 decrypt", "wifi capture decryption", "eapol handshake", "4-way handshake", "ccmp decrypt", "wpa psk decrypt",
      "wpa2 ccmp", "wifi password decrypt", "802.11 decryption", "handshake analysis",
      "wpa2解密", "无线流量解密",
    ],
  },
  oleExtract: {
    what: "Static OLE/CFB container extraction: parses the directory tree of an OLE2 (Compound File Binary) document, lists every storage/stream, and extracts stream bytes as files with size and SHA-256. Applies to .doc/.xls/.ppt (Office 97-2003), .msi, vbaProject.bin, etc.",
    principle:
      "CFB slices files into fixed sectors (v3=512B, v4=4096B). The 512-byte header locates FAT/DIFAT, the first directory sector and the mini-stream cutoff (default 4096B). The FAT is a sector linked-list chaining a stream's content; streams smaller than the cutoff are packed into a contiguous region owned by the Root Entry (the mini stream), split into 64-byte mini sectors and linked by the MiniFAT. Directory entries are fixed 128 bytes: UTF-16LE name, type (storage/stream/root), red-black tree sibling/child pointers, start sector and size. The parser walks the sibling tree and reads each stream through the FAT or MiniFAT path by size.",
    usage: "Drop an OLE file → container version, Root CLSID, full directory tree, per-stream size/SHA-256, with downloadable artifacts (total capped by a parameter). If the container embeds a VBA project (VBA/dir), dir records are parsed and each module's macro source is decompressed per the project code page. Strictly static and read-only — macros are never executed.",
    examples: [
      { in: "Nested OLE: Documents/A/B/nested.txt + a large Workbook.bin + a Chinese-named stream", out: "7 objects listed; Workbook.bin (5000B) via FAT, small streams via MiniFAT, byte-exact SHA-256 against generator truth", desc: "Dual-channel stream reads + deep nesting + UTF-16LE names" },
      { in: "File with corrupted magic", out: "Explicit 'not an OLE/CFB container' error plus a hint that .docx/.xlsx are ZIP containers", desc: "Honest refusal, no guessing" },
    ],
    tips: [
      "Office 2007+ .docx/.xlsx/.pptx are ZIP, not OLE — use the unzip tools.",
      "vbaProject.bin is itself an OLE container: this tool detects the embedded VBA project directly, lists modules, and exports macro source (MS-OVBA decompression, decoded per the project code page).",
      "Red line: static reads only — no macro execution, no document code is ever run.",
      "Streams beyond the artifact cap are listed and flagged, not attached.",
    ],
    aka: ["OLE", "OLE2", "CFB", "compound file binary", "ole extract", "OLE extraction", "vbaProject", "msi extraction", "office 97 container", "olecf", "compound document", "document forensics"],
  },
};
