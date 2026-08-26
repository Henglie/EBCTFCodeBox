// 科普内容分片：MT82 批新增 15 op（gifTiming/jpgSizeRecover/zipRepair/zipPseudoEncrypt/stringsExtract/jwtCrack/
// zstegScan/pdfObjects/ooxmlMeta/apkManifest/elfInfo/peInfo/lsbEmbed/zipCreate/deepsoundExtract）。纯数据，无 import 无副作用。
export default {
  gifTiming: {
    what: "GIF 每一帧显示多长时间，藏在图形控制扩展的 Delay Time（厘秒）里——flag 能编进这串数字。",
    principle:
      "GCE 块 = `21 F9 04` + packed(1) + delay(2 LE) + 透明索引(1) + `00`，delay 单位 1/100 秒。逐帧读出 delay 即得数字序列，可当 ASCII 码，也可按阈值二值化取 bit。\n\n" +
      "无 GCE 的帧按 0 计，纯文本扩展（如注释）消费 pending delay 但不计帧——与主流解码器的帧序列一致。",
    usage: "上传 GIF，选映射模式（字节/ASCII · 原始数字 · 二进制阈值），运行输出每帧时长与映射结果。阈值参数仅在 binary 模式生效。",
    examples: [
      { in: "构造 delay=[72,105] 的 GIF", param: "mode=ascii", out: "帧时长(厘秒): 72 105 → 映射文本: Hi", desc: "72=H 105=i，标准 ASCII 映射" },
      { in: "构造 delay=[3,9,9,9,9] 的 GIF", param: "mode=binary, threshold=5", out: "01010101 → 'U'", desc: "阈值二值化取 bit" },
    ],
    tips: [
      "delay 值异常整齐（如全 72/105）或忽大忽小成两组即有料，先看原始数字模式找规律再选映射。",
      "与 gifFrames（拆帧）/ gifComment（注释）配合看——三种 GIF 隐写思路互相补位。",
      "binary 模式位串超长时报告截断展示，字节转换仍用全量位串。",
    ],
    aka: ["gif 帧时序", "gif 帧延时", "gif 延迟隐写", "帧时序隐写", "gif timing", "gif delay stego", "帧延迟解码", "gif 帧时长", "gif 动画隐写", "帧间延时", "graphic control extension delay", "gif 帧间隔", "delay time 隐写", "gif 帧率隐写", "时间轴隐写"],
  },

  jpgSizeRecover: {
    what: "JPEG SOF 段声明的宽高被改小后查看器会裁掉下方藏的内容；基线图没 CRC 但 MCU 个数数得出来，能反推真实高度。",
    principle:
      "SOF0 段记录宽高与分量采样，熵编码扫描按 MCU 组织（8×hmax × 8×vmax 像素一块）。按 ITU-T T.81 Annex C 构建霍夫曼表（mincode/maxcode/valptr），对扫描数据做基线熵解码**只数 MCU 不重建像素**，真实高度 = ceil(MCU 总数 / 每行 MCU 数) × 8 × vmax。\n\n" +
      "熵段里 `FF00` 是去填充字节、`FFD0-FFD7` 是重启标记，解码时都要正确处理。",
    usage: "上传 JPEG，自动模式直接恢复高度；渐进式（SOF2）或多扫描图自动模式会提示转手动模式，手动可强制指定宽高（0=不改）。",
    examples: [
      { in: "8×32 图篡改高 32→8", out: "按扫描数据恢复：真实高度 32", desc: "篡改高度后文件体量不变，MCU 数反推原高" },
      { in: "手写宽 64 的 8×64 图", param: "mode=manual, width=64", out: "重解析得到 8×64", desc: "手动强制宽高路径" },
    ],
    tips: [
      "题目图「下半截消失 / 看着被压扁」先怀疑改高，丢这里自动恢复。",
      "修复后高度按 MCU 对齐向上取整，末尾几行纯色是正常现象。",
      "PNG 版看 pngSizeRecover（CRC 爆破），BMP 版看 bmpSizeRecover（数据量整除反推）。",
    ],
    aka: ["jpeg 宽高修复", "jpg 宽高修复", "jpeg 高度修复", "jpg 高度恢复", "sofhack", "jpeg sofc", "SOF 宽高爆破", "jpeg 改高", "jpg 隐藏高度", "jpeg mcu", "mcu 计数", "jpeg 熵解码", "baseline jpeg 修复", "jpg size recover", "jpeg height recover"],
  },

  zipRepair: {
    what: "ZIP 伪加密是把通用位标志 bit0 置 1 但数据其实没加密，解压器误报要密码——本工具把这些位清掉。",
    principle:
      "加密标志位存在两处：LFH+6 与 CDH+8。走 EOCD→中央目录→本地头的**精确路径**逐条清位，不扫描字节流（避免误伤压缩数据里碰巧出现的伪 PK 序列）。\n\n" +
      "拼接文件（图片+ZIP）场景下 EOCD 声明偏移是 ZIP 相对值，按「CD 紧贴 EOCD 前」的常见布局反推前缀修正后再定位。",
    usage: "上传 ZIP 点运行，报告列出每个条目的前后 flag 值，输出修复后 ZIP 的 base64 直接下载。勾选 clearStrong 可连带清除加密强度位 bit6。",
    examples: [
      { in: "flag.txt 伪加密 ZIP", out: "flag.txt CDH 0x0001→0x0000，LFH 0x0001→0x0000", desc: "通用位标志 bit0 被清除" },
      { in: "干净 ZIP", out: "未发现伪加密位，文件未改动", desc: "无伪加密时不输出产物" },
    ],
    tips: [
      "拼接文件自动做前缀修正，图片+ZIP 的题目直接丢进来。",
      "清位后仍要密码说明是真加密，转 ZIP 弱口令爆破（zipCrc32Brute / zipCrack）。",
      "与 zipPseudoEncrypt（置位）互为逆操作，闭环验证可逐字节还原。",
    ],
    aka: ["zip 伪加密", "zip 伪加密修复", "zip 加密位修复", "zip 伪加密解除", "伪加密", "假加密修复", "zip 密码去除", "zip flag bit", "general purpose bit", "加密标志位修复", "zip 解锁", "zip repair", "fake encryption", "zip bit0", "中央目录加密位"],
  },

  zipPseudoEncrypt: {
    what: "把 ZIP 的加密位 bit0 置 1 而不动数据，制造「有密码」假象——出伪加密题的收口手法。",
    principle:
      "LFH+6 与 CDH+8 同步置位通用位标志 bit0，解压器见到标志位即报加密。数据本身完全未加密，只是标志位被改写。",
    usage: "上传 ZIP 运行，得到置位后的 ZIP base64，可直接发给解题者。无参数。",
    examples: [
      { in: "flag.txt 普通 ZIP", out: "置位完成：1 个条目中置位 1（LFH 同步置 1 处）", desc: "置位后解压器报要密码" },
    ],
    tips: [
      "与「ZIP 伪加密修复」（zipRepair）互为逆操作，闭环验证可逐字节还原。",
      "出题用途：配合 zipCreate 打包数据 → 置位 → 发题。",
      "重复置位会报告未改动（已置位的条目不动）。",
    ],
    aka: ["zip 伪加密", "zip 加密位置位", "伪加密制造", "zip 出题", "加密位伪造", "zip fake encrypt", "伪加密置位", "zip 假加密", "zip 密码伪装", "general purpose flag set", "zip bit0 set", "出题工具", "zip 加密伪装", "伪加密生成", "zip pseudo encrypt"],
  },

  stringsExtract: {
    what: "从任意字节流里扫出连续可打印片段，逆向取证第一步。",
    principle:
      "ASCII 模式取 `0x20..0x7E` 的连续段，长度不足阈值丢弃；UTF-16LE 模式取「可打印字节 + 0x00」交替对（Windows 程序常见），命中步进 2、未命中步进 1，任意对齐可扫。both 模式双扫描合并后按偏移升序。",
    usage: "拖入文件（或粘 hex/base64），设最小长度（默认 4），Windows 来源优先试 UTF-16LE，勾「显示偏移」方便回文件定位。",
    examples: [
      { in: "AB\\0hello\\0\\1world!", param: "minLen=4", out: "0x00000005 hello / 0x0000000d world!", desc: "短片段 AB 被过滤" },
      { in: "f\\0l\\0a\\0g\\0\\xff\\xff", param: "encoding=utf16le", out: "flag", desc: "UTF-16LE 模式命中" },
    ],
    tips: [
      "命中 0 条先降最小长度。",
      "与 extractHashes（专扫哈希串）/ flagExtract（专扫 flag 格式）互补，本 op 是通用版。",
      "报告超 5000 条时截断展示，计数仍全量。",
    ],
    aka: ["strings", "strings 提取", "字符串提取", "可打印字符串", "printable strings", "strings 命令", "提取字符串", "strings 工具", "二进制字符串提取", "字符串搜索", "binwalk strings", "逆向 strings", "utf16 strings", "字符串分析", "strings extract"],
  },

  jwtCrack: {
    what: "JWT 用 HS256/384/512 对称签名且密钥是弱口令时，可离线爆破出密钥。",
    principle:
      "签名 = `HMAC(alg, key, \"header.payload\")`，无盐无迭代。拆三段 → 算法识别（auto 读 header 的 alg，解析失败默认 HS256）→ 逐候选重算签名与签名段比对，用常量时间比较避免时序侧信道。\n\n" +
      "HMAC 走 WebCrypto 原语，非 HMAC（RS/ES/none）算法明确拒绝。",
    usage: "粘贴完整 JWT，算法默认自动读 header，选字典（内置弱密钥 / 自定义逐行 / 纯数字）运行。字典模式与尝试上限对齐本库其它爆破工具。",
    examples: [
      { in: "eyJhbGciOiJIUzI1NiJ9...（secret 在 4 词字典第 3 个）", out: "命中 ✓ 密钥 = \"secret\"（第 3 个候选）", desc: "字典命中并给出尝试次数" },
      { in: "correct-horse-battery-staple 签的 JWT", out: "未命中（尝试 4 个候选）", desc: "强密钥字典爆不了" },
    ],
    tips: [
      "RS/ES 是非对称签名爆不了；header 里 alg=none 的 JWT 直接拒绝。",
      "命中后可配合 JWT 工具（token.js 的 jwt）改 payload 重签。",
      "高熵密钥需离线 hashcat，本工具只做在线弱密钥。",
    ],
    aka: ["jwt 爆破", "jwt 密钥爆破", "jwt 破解", "jwt secret 爆破", "jwt 弱密钥", "jwt crack", "jwt dictionary attack", "hs256 爆破", "hs256 crack", "hs384", "hs512", "hmac jwt 爆破", "jwt 字典攻击", "jwt 弱口令", "json web token 爆破"],
  },

  zstegScan: {
    what: "PNG/BMP 的 LSB 隐写组合空间大（位平面×通道×位序×行列），本工具一次全试并按可读性排序。",
    principle:
      "按有界组合逐一提取 2048 字节：位平面 bit 0..maxBit × 通道 {r,g,b,rgb,bgr} × 位序 {msb,lsb} × 遍历 {行/列优先}。\n\n" +
      "打分：字母/空格 +1.0、数字 +0.6、换行 +0.4、ASCII 标点 +0.3、控制字符 -3.0、其余 +0.1 取平均；含花括号再 +0.5，命中 flag 正则再 +5.0，降序取前 8。",
    usage: "上传 PNG/BMP，默认只试 bit0 十组合（快），可疑再开 maxBit 到 7 并勾列优先（最多 160 组合）。flagRegex 可自定义命中加成。",
    examples: [
      { in: "R-LSB 行优先 MSB 嵌入 flag{lsb} 的图", out: "#1 [5.869] bit0 r msb → flag{zsteg_demo_2026}", desc: "命中组合自动排第一" },
    ],
    tips: [
      "报告里分数断崖式领先的组合即命中。",
      "全组合都没料时考虑 JPEG 载体（有损格式无稳定 LSB）或看 fileAnalysis 的 LSB 报告。",
      "与本库 lsbExtract（固定排列手工看）互补，本 op 是自动打分版。",
    ],
    aka: ["zsteg", "zsteg 扫描", "lsb 扫描", "lsb 全组合扫描", "位平面扫描", "lsb steganography scan", "最低有效位扫描", "位平面隐写", "lsb 组合爆破", "通道扫描", "bit plane scan", "lsb 提取扫描", "隐写自动扫描", "png lsb 扫描", "bmp lsb 扫描"],
  },

  pdfObjects: {
    what: "PDF 是对象容器（Catalog/Pages/Page/流），flag 常藏在被 FlateDecode 压缩的内容流里——本工具把对象表和流内容直接挖出来。",
    principle:
      "`%PDF-` 头前 1024 字节扫描（容忍前置垃圾/拼接件）→ 对象头「数字 空白 数字 空白 obj」词法匹配 → 对象体到最近 endobj → 提取 /Type /Subtype /Filter → 定位 stream…endstream 段。\n\n" +
      "FlateDecode 流用内联 zlib 解压即见原文；xref 损坏也能解（不依赖交叉引用表）。",
    usage: "拖入 PDF 运行，对象行看结构（编号/偏移/Type/Filter/流长），流内容段直接读解压预览。decodeFlate 可关掉只看原始流。",
    examples: [
      { in: "最小 PDF（Catalog + FlateDecode 流）", out: "obj 2 0 @ 0x0000002d len 80 filter=FlateDecode stream=23 → 解压 12 字节 hello stream", desc: "对象表 + 解压预览" },
    ],
    tips: [
      "找 flag 先看解压后的流预览；对象数 0 且有 ObjStm 提示说明对象在压缩对象流里。",
      "图片拼接件（%PDF 不在开头）照样解。",
      "与 fileAnalysis（magic 识别）/ stringsExtract（字符串）配合。",
    ],
    aka: ["pdf 对象解析", "pdf 对象提取", "pdf objects", "pdf 流提取", "pdf stream", "pdf 结构分析", "pdf 对象表", "flatedecode 解压", "pdf 解压", "pdf 取证", "pdf 隐藏内容", "pdf 内容流", "pdftk qpdf", "pdf 对象偏移", "pdf 挖掘"],
  },

  ooxmlMeta: {
    what: "Word/Excel/PPT（.docx/.xlsx/.pptx）是 ZIP 容器，作者/公司/编辑时间藏在 docProps 的三个 XML 里。",
    principle:
      "ZIP 中央目录每条含文件名/方法/CRC/偏移，按 EOCD→CD→LFH 精确切压缩数据，deflate 流解压后读 XML，把 `docProps/{core,app,custom}.xml` 的键值对全挖出。\n\n" +
      "custom 走 `<property name>` 特殊结构 + 通用标签对双段提取，命名空间剥前缀，五实体反转义。",
    usage: "拖入文档运行，`core:title:`、`app:Company:`、`custom:xx:` 直接读，作者名/公司名常是取证线索。",
    examples: [
      { in: "docx（含 core/app 元数据）", out: "命中 2/3 个部件 · 3 条属性 / core:creator: Alice / app:Company: CTF Corp", desc: "三部件命中情况 + 逐条键值" },
      { in: "自定义属性文档", out: "custom:分类: 机密", desc: "custom.xml 特殊结构" },
    ],
    tips: [
      "旧版 .doc/.xls 是 OLE 复合文档不支持，仅提示。",
      "属性带命名空间自动剥前缀；自定义属性在 custom.xml 里特殊结构（name= 属性）。",
      "其余格式后缀（.docm/.xlsm/.pptm 等）都解。",
    ],
    aka: ["docx 元数据提取", "xlsx 元数据", "pptx 元数据", "ooxml 元数据", "office 文档元数据", "doc props", "ooxml 属性", "文档作者提取", "文档创建时间", "office 隐藏信息", "docx 隐写", "ooxml 结构分析", "mc 文档取证", "office 移除元数据", "zip 目录解析"],
  },

  apkManifest: {
    what: "APK 是 ZIP，AndroidManifest.xml 常是二进制 AXML；工具把包名/权限/四大组件全解出。",
    principle:
      "ZIP 找 AndroidManifest.xml → 前 16 字节含 '<' 走明文正则，否则 AXML 解析：字符串池（UTF-8/UTF-16 双格式）→ START_ELEMENT 解元素名+属性，typed 值按类型还原为字符串/整数/布尔/资源引用。",
    usage: "拖入 APK 运行，看 package/permissions/components。支持拼接件前缀修正与 deflate 条目。",
    examples: [
      { in: "APK", out: "package: com.example.app / permissions: android.permission.INTERNET / components: activity:com.ctf.demo.MainActivity", desc: "头部统计 + 包名 + 权限 + 组件" },
    ],
    tips: [
      "明文 manifest 的 xmlns 会被当属性名剥前缀（别名 android），是参考实现同款行为。",
      "只读类，不改包。",
      "与 apk 解包 / 逆向流程配合，先看权限猜功能。",
    ],
    aka: ["AndroidManifest.xml 解析", "apk 清单解析", "axml 解析", "android 二进制 xml", "apk 包名", "apk 权限提取", "apk 组件提取", "android manifest", "apk 元数据", "apk 入口 activity", "manifest 解析", "apk 逆向", "android 清单", "apk 权限列表", "二进制 XML 反序列化"],
  },

  elfInfo: {
    what: "ELF 是 Linux 可执行/共享库格式，先看架构/位数/入口判断用哪个引擎、是否 PIE。",
    principle:
      "魔数 `\\x7fELF` 判格式，EI_CLASS/EI_DATA 定位 32/64 位与端序，读 e_type/e_machine/e_entry/e_phoff。程序头表 PT_INTERP 给解释器、PT_DYNAMIC 的 DT_NEEDED 给依赖库。\n\n" +
      "入口按 vaddr→file 映射解析（32/64 位头偏移不同，按类分派）。",
    usage: "拖入 ELF 运行，一行看格式/架构/位数/端序/类型/入口 + 解释器/依赖库。",
    examples: [
      { in: "minimal_elf64", out: "格式：ELF / 架构：x86-64 / 位数：64 / 类型：可执行 / 入口：0x401000 / 依赖库：libc.so.6", desc: "头信息 + 动态链接" },
    ],
    tips: [
      "ET_DYN 既有 PIE 可执行也有 .so，看有无解释器区分。",
      "32 位 ELF 的头偏移与 64 位不同（本工具按类分派）。",
      "只读类，不改文件。",
    ],
    aka: ["elf", "elf 信息", "elf 头解析", "elf 可执行文件", "可执行文件信息", "elf 架构", "elf 位数", "elf 字节序", "elf 入口点", "动态链接信息", "dt_needed", "elf 依赖库", "pie 检测", "elf 类型", "readelf 平替"],
  },

  peInfo: {
    what: "PE 是 Windows 可执行/动态库格式；拖入 PE 一眼即知架构/位数、EXE 还是 DLL、GUI 还是控制台。",
    principle:
      "MZ 魔数 + e_lfanew(0x3c) 定位 `PE\\0\\0` 签名，COFF 头判架构与 DLL 位（IMAGE_FILE_DLL=0x2000），可选头 magic 判 PE32(0x10b)/PE32+(0x20b) 与镜像基址宽窄，AddressOfEntryPoint 给入口 RVA。\n\n" +
      "PE32+ 镜像基址按 u64 读、PE32 按 u32 读，按 magic 分派。",
    usage: "拖入 .exe/.dll 运行，一行看格式/架构/位数/类型 + 入口 RVA + 镜像基址。",
    examples: [
      { in: "make_minimal_pe", out: "格式：PE / 架构：x86 / 位数：32 / 类型：EXE / 子系统：Windows 控制台 / 入口(RVA)：0x2000", desc: "头信息概览" },
    ],
    tips: [
      "PE32+(0x20b) 与 PE32(0x10b) 镜像基址宽窄不同（本工具按 magic 分派）。",
      "IMAGE_FILE_DLL(0x2000) 位判 DLL。",
      "只读类，不改文件。",
    ],
    aka: ["pe", "pe 文件信息", "pe 头解析", "exe 信息", "dll 信息", "pe 架构", "pe 位数", "pe 入口点", "pe32 解析", "pe32+ 解析", "pe 子系统", "windows 可执行文件", "image base", "pe 镜像基址", "可执行文件头"],
  },

  lsbEmbed: {
    what: "把一段文本藏进图片像素的最低有效位生成隐写图——出 misc 题的常见手法。",
    principle:
      "封面解码成 RGBA 像素（PNG 8bit 非隔行 / BMP 24·32bit 未压缩），选一个位平面（默认 0=最低位）与若干通道（R/G/B/A），按行主序把载荷每个 bit 依位序写进样例该位。\n\n" +
      "图色差肉眼不可辨，但可按同参数提取回；容量需 载荷字节×8 ≤ 像素数×通道数。",
    usage: "拖入封面图，填「载荷」文本，设通道/位平面/位序，输出 data URL 直接存做隐写图。",
    examples: [
      { in: "payload=flag{txt} + channels=RGB + bit=0", out: "隐写图（data:image/png;base64,...），zstegScan 以 bit0 rgb msb 解回", desc: "嵌入→可提取闭环" },
    ],
    tips: [
      "出题务必无损封面（PNG），JPEG 有损会污染最低位。",
      "用与读侧完全相同的 通道序/位平面/位序，否则提取错位。",
      "只读原图，不改源文件。",
    ],
    aka: ["lsb 嵌入", "lsb stego 出题", "最低有效位写入", "隐写图生成", "lsb 写入", "图片隐写嵌入", "payload 嵌入", "隐藏文本到图片", "位平面写入", "lsb 编码", "stego 生成", "出题隐写", "cover 隐写", "数据隐藏图片", "lsb 隐写"],
  },

  zipCreate: {
    what: "把一段数据打包成单文件 ZIP，指定内部文件名与压缩方式（Deflated/Stored）——出 misc 题的收口手法。",
    principle:
      "数据即 ZIP 的单个文件条目：写 LFH（本地面）+ CDH（中央目录）+ EOCD（尾目录），CRC32 按数据实算。Stored 直存，Deflated 用固定哈夫曼 raw deflate 压缩，任何解压器都能展回。\n\n" +
      "文件名缺省/空回退 `flag.txt`，非 ASCII 文件名自动置 UTF-8 标志位（0x0800）。",
    usage: "输入区贴要打包的内容（或拖文件），填内部文件名、选压缩方式，输出 ZIP base64 直接存 *.zip，或用 zipPseudoEncrypt 置伪加密。",
    examples: [
      { in: "flag{zip_it} + filename=secret.txt + Stored", out: "可解出原文的合法 ZIP", desc: "Stored 打包" },
      { in: "flag{deflate_zip} + Deflated", out: "method8 ZIP，独立 inflate 可解回", desc: "Deflated 打包" },
    ],
    tips: [
      "文件名非 ASCII 自动置 UTF-8 标志。",
      "Deflated 用固定哈夫曼字面量块（结构合法但几乎不压缩）。",
      "与 zipPseudoEncrypt（置位）/ zipRepair（修复）闭环。",
    ],
    aka: ["zip 创建", "zip 打包", "zip 压缩包生成", "出题打包", "打包成 zip", "zip 出题", "zip 文件生成", "制作 zip", "zip 压缩", "deflate 打包", "stored 打包", "压缩包创建", "zip 出题器", "flag 打包", "zip 生成器"],
  },

  deepsoundExtract: {
    what: "DeepSound 是 Windows 端音频隐写工具，把文件藏进 16-bit PCM WAV 采样的低位——题目 WAV「能正常播放但大小可疑」时先想它。",
    principle:
      "秘密数据藏进采样低 1/2/4 位（质量模式 2/4/8 决定），data 块头部有 104 载体字节的 DSC2/DSCF 头（版本+质量模式+AES 标志），其后是记录链（DSSF+文件名+大端长度）。\n\n" +
      "加密时 AES-256-ECB，密钥 = SHA-256(UTF-16LE(密码))。头不固定在 data 起点，按 352800 载体字节逐字节滑动扫描定位。",
    usage: "拖入 WAV，若是加密文件填密码，运行列出全部隐藏文件并给预览与 base64。",
    examples: [
      { in: "DSC2 mode4 加密 WAV", out: "DeepSound DSC2 · 质量模式 4 · AES-256 加密 / 共 1 个隐藏文件： - flag.txt (18 字节)", desc: "版本/模式/加密态 + 文件清单" },
    ],
    tips: [
      "报「未找到头」先确认是 PCM WAV（MP3/其他容器不行）。",
      "错密码与缺密码报错不同可区分。",
      "配合音频 LSB 分析（audiostego）先探低位是否有料。",
    ],
    aka: ["deepsound", "deepsound 提取", "deepsound 解密", "deepsound extract", "deepsound 音频隐写", "wav 隐写提取", "音频隐写提取", "wav lsb 提取", "音频低位提取", "deepsound 破解", "声音隐写", "dsc2", "dscf", "pcm 隐写", "deepsound 导出"],
  },
};
