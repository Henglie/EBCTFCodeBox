/*
 * edu-ana-new.js — 科普补缺分片：analysis 类新 op（T307）。
 *
 * 覆盖 4 个真实缺失的 analysis 类 op 科普卡：
 * sstiKeyword — SSTI 关键字识别（服务端模板注入静态特征扫描）
 * crc32Collision — CRC32 碰撞爆破（已知 CRC32 反查短明文）
 * pickleDisasm — Pickle 反汇编（Python pickle 字节码反汇编）
 * zipBrute — ZIP 弱口令爆破（ZipCrypto 传统加密）
 *
 * 核查结论：serial 族 6 个（protobufParse/msgpackParse/cborParse/bsonParse/
 * phpSerializeParse/javaSerializeIdent）已由 edu-ana-serial.js 完整覆盖
 * 按铁律「撞已引分片的直接删该条，宁缺毋滥」不补。
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
 // ============ analysis: SSTI 关键字识别 ============
  sstiKeyword: {
    what: "SSTI 关键字识别——服务端模板注入（Server-Side Template Injection）静态特征扫描，把文本里 Jinja2/Twig/FreeMarker/Velocity/Smarty 等引擎的模板定界符、经典 RCE 利用链关键字、7×7 探测 payload 标出来，并推断用的是哪个引擎。只识别不执行。",
    principle:
      "模板引擎把用户输入当模板源码渲染时就会触发 SSTI。各引擎定界符不同：Jinja2 用 `{{ ... }}`、Twig 用 `{{ }}`、FreeMarker 用 `${...}`、Velocity 用 `$...` 或 `#...`、Smarty 用 `{...}`。\n\n" +
      "经典探测 payload 是 `{{7*7}}`——若渲染结果是 49，说明模板被执行了。进一步利用链如 `{{''.__class__.__mro__[1].__subclasses__()}}`（Jinja2 Python 沙箱逃逸）、`${\"freemarker.template.utility.Execute\"?new()(\"id\")}`（FreeMarker RCE）等一旦出现，几乎可以确认 RCE。\n\n" +
      "本工具照 OWASP SSTI 检测思路扫描这些特征字符串，给出引擎推断和风险等级，不发送任何请求、不执行任何模板。",
    usage: "把可疑的请求参数、URL、响应体粘进来运行，输出识别到的定界符、关键字、探测 payload 及推断的模板引擎。一把梭的 detect 也会自动调用它。",
    examples: [
      { in: "{{7*7}}", out: "Jinja2/Twig 探测 payload", desc: "7×7 探测，渲染成 49 即确认 SSTI" },
      { in: "${7*7}", out: "FreeMarker/JSP EL 探测", desc: "${} 是 FreeMarker/JSP EL 定界符" },
      { in: "{{''.__class__}}", out: "Jinja2 Python 沙箱逃逸链", desc: "访问 __class__ 是 Python 模板利用的典型手法" },
    ],
    tips: [
      "CTF Web 常见题型：给一个搜索框/URL 参数，输入 {{7*7}} 返回 49 就是 SSTI",
      "区分引擎：{{7*'7'}} 在 Jinja2 返回 '7777777'，在 Twig 返回 '49'，是经典指纹",
      "危险关键字：__class__/__mro__/__subclasses__/os.system/popen/Execute/eval 几乎必是 RCE 利用链",
      "本工具只静态识别，不发送请求；实际利用需手动构造 payload 在目标上执行",
    ],
    aka: ["SSTI", "template injection", "模板注入", "jinja2 injection", "twig injection", "server-side template injection", "服务端模板注入", "SSTI识别", "模板引擎注入", "freemarker注入", "velocity注入", "smarty注入", "7*7探测"],
  },

 // ============ analysis: CRC32 碰撞爆破 ============
  crc32Collision: {
    what: "CRC32 碰撞爆破——已知一段短数据的 CRC32（标准 IEEE/zip CRC-32），穷举所有可能内容反查原文。CTF misc 里 ZIP 存了 Stored 小文件、只给了 CRC32 但拿不到内容时用。",
    principle:
      "CRC-32/ISO-HDLC（IEEE 802.3，与 zip/gzip 一致）是 32 位校验和：反射式多项式 0xEDB88320，init=0xFFFFFFFF，refIn/refOut=true，xorOut=0xFFFFFFFF。\n\n" +
      "32 位只有约 42 亿种取值，对短明文（≤5 字节）穷举所有可能内容算 CRC32 比对命中完全可行：\n" +
      "- 4 字节可打印 ASCII：95⁴ ≈ 8150 万，秒级\n" +
      "- 5 字节可打印 ASCII：95⁵ ≈ 77 亿，浏览器同步会卡，硬上限设 5\n" +
      "- 6 字节已达 7300 亿，浏览器不可行，需离线 hashcat/自写脚本\n\n" +
      "本工具用表驱动 + DFS 增量计算（沿搜索路径复用 CRC 寄存器），比每条从头算快 8 倍。",
    usage: "填目标 CRC32（如 0x414fa339 或 414fa339），选字符集（可打印 ASCII/字母数字/纯数字）和明文长度上限（默认 4，硬上限 5），点运行穷举命中候选。",
    examples: [
      { in: "CRC32=0x352441c2, charset=printable, maxLen=4", out: '"abc"', desc: '标准 CRC32("abc") = 0x352441c2' },
      { in: "CRC32=0xd1f4eb9a, charset=lower, maxLen=4", out: '"flag"', desc: 'CRC32("flag") = 0xd1f4eb9a' },
    ],
    formulas: [
      { tex: "\\text{CRC32} = \\bigoplus_{i}\\ \\text{table}[(c \\oplus \\text{byte}_i) \\& 0xFF] \\oplus (c \\gg 8)", caption: "表驱动 CRC32 增量计算（c 为寄存器，沿 DFS 路径复用）" },
    ],
    tips: [
      "CTF misc 经典题型：ZIP 里有个 Stored（method=0）的小文件，CRC32 已知但文件内容被加密/截断",
      "硬上限 5 字节是浏览器同步爆破的极限；更长明文请用 hashcat 的 --hash-type 3000 或自写 C 脚本",
      "CRC32 只有 32 位，长明文会有大量碰撞，需结合 ZIP 条目的文件大小和上下文判断真伪",
      "本工具与 zipCrc32Brute 是同一算法的两个 op（前者通用名、后者强调 ZIP 场景），任选其一",
    ],
    aka: ["CRC32 brute", "CRC32 反查", "zip crc crack", "CRC 碰撞", "CRC32碰撞", "CRC32爆破", "crc32 collision", "crc32 reverse", "zip crc32 crack", "CRC32穷举", "CRC32反查明文", "crc brute force"],
  },

 // ============ analysis: Pickle 反汇编 ============
  pickleDisasm: {
    what: "Pickle 反汇编——把 Python pickle 字节码反汇编成 pickletools.dis 风格的可读文本，高亮 GLOBAL/REDUCE/BUILD 等危险 opcode 和 os.system/popen/subprocess 等 RCE 符号。只反汇编不执行。",
    principle:
      "pickle 是 Python 对象序列化协议（protocol 0-5），本质是一串 opcode 指令流。核心 opcode：\n" +
      "- PROTO：声明协议版本\n" +
      "- GLOBAL（c）：加载模块的某个符号，如 `cos\\nsystem\\n` → 加载 os.system\n" +
      "- REDUCE（R）：调用栈顶的可调用对象，是 RCE 的执行点\n" +
      "- BUILD（b）：调用对象的 __setstate__，常用于触发 __reduce__\n" +
      "- STOP（.）：结束\n\n" +
      "危险组合 GLOBAL+REDUCE 等价于 `os.system(cmd)`。Python 官方文档明确警告「不要 unpickle 不受信任的数据」——反序列化即 RCE。本工具只做静态反汇编，绝不执行 REDUCE，安全。",
    usage: "粘贴 pickle 字节（hex/base64/原始字节自动识别），运行后输出逐条 opcode 的反汇编列表，危险 opcode 标红并给出 RCE 风险提示。",
    examples: [
      { in: "636f730a73797374656d0a2853276563686f206869270a74522e", out: "GLOBAL os system / STRING 'echo hi' / REDUCE / STOP", desc: "协议 0 明文 pickle，os.system('echo hi') RCE payload（hex）" },
      { in: "Y29zCnN5c3RlbQooUydlY2hvIGhpJwp0Ui4=", out: "GLOBAL os system + STRING 'echo hi' + REDUCE", desc: "同上 payload 的 base64 编码，反汇编结果一致" },
    ],
    formulas: [
      { tex: "\\text{pickle} = \\text{PROTO} \\cdot (\\text{GLOBAL} + \\text{REDUCE})^* \\cdot \\text{STOP}", caption: "opcode 序列结构，GLOBAL+REDUCE 是 RCE 执行点" },
    ],
    tips: [
      "CTF Web/Misc 经典题：给一个 .pkl 文件或 base64 的 pickle 数据，要求反序列化 RCE 拿 flag",
      "协议 0 是明文 ASCII 可直接读；协议 2+ 是二进制需反汇编",
      "危险 opcode：GLOBAL(c)/REDUCE(R)/BUILD(b)/INST(i)/OBJ(o)/NEWOBJ(\\x81)/STACK_GLOBAL(\\x93)",
      "本工具绝不执行 REDUCE，纯静态反汇编，可安全分析恶意 pickle",
      "Python 自带 pickletools.dis 也能反汇编，本工具是它的浏览器版 + RCE 高亮",
    ],
    aka: ["pickle disassemble", "pickle 反汇编", "python pickle", "pickle RCE", "反序列化", "pickletools", "pickletools.dis", "pickle字节码", "pickle opcode", "python反序列化", "pickle disasm", "pkl反汇编"],
  },

 // ============ analysis: ZIP 弱口令爆破 ============
  zipBrute: {
    what: "ZIP 弱口令爆破——对 ZipCrypto（传统 PKWARE 加密）的 ZIP 文件穷举弱口令验证密码是否正确。仅验证密码不还原明文。内置字典 + 自定义字典 + 纯数字掩码三种模式。",
    principle:
      "ZipCrypto 是 ZIP 的传统加密算法（PKWARE 由 Phil Katz 设计），用 12 字节加密头校验密码：\n" +
      "1. 用密码初始化 3 个 32 位密钥（key0/key1/key2）\n" +
      "2. 加密头前 12 字节，其中最后 1 字节（或 2 字节，取决于版本）是校验值\n" +
      "3. 解密后比对校验值即可判断密码对错，**不需要解密整个文件**\n\n" +
      "这个特性让密码验证极快（微秒级），穷举 4 位数字（10000 次）秒内完成。但 6 位以上数字或大字典会卡浏览器，硬上限设 6 位。\n\n" +
      "局限：不支持 WinZip AES（AES-256 验证需解密整个文件，留给 WASM 版）；不做 bkcrack 明文攻击（已知明文还原密钥，另有专门工具）。",
    usage: "拖入 ZIP 文件或粘贴其 hex/base64，选模式：纯数字掩码（填位数上限，默认 4，硬上限 6）/ 内置字典 / 自定义字典（每行一个密码）。点运行自动穷举，命中即输出密码。",
    examples: [
      { in: "ZIP + 数字 4 位", out: "密码: 1234", desc: "穷举 0000-9999 共 10000 次，秒级" },
      { in: "ZIP + 自定义字典 flag\\nctf2024\\nadmin", out: "密码: ctf2024", desc: "字典模式逐个验证" },
    ],
    formulas: [
      { tex: "\\text{key}_{i+1} = \\text{CRC32}(\\text{key}_i,\\ \\text{byte})", caption: "ZipCrypto 密钥更新（CRC32 表驱动）" },
    ],
    tips: [
      "CTF misc 高频题：给一个加密 ZIP，密码是弱口令（数字、常见词），穷举即可",
      "仅支持 ZipCrypto（传统加密），WinZip AES 加密的 ZIP 需其他工具",
      "数字 6 位 = 100 万次，浏览器同步约 10-30 秒；6 位以上请用 hashcat 的 --hash-type 17200/17210/17220/17225/17230",
      "bkcrack 明文攻击（已知 ZIP 内某个文件的内容）可还原密钥绕过密码，本工具不做",
      "密码验证只看 12 字节加密头，理论上有 1/256 误判率，命中后建议再解压验证",
    ],
    aka: ["zip password crack", "zipcrypto brute", "zip 弱口令", "zip 密码爆破", "zip爆破", "zip密码破解", "ZipCrypto crack", "zip字典爆破", "压缩包密码爆破", "zip brute force", "PKWARE加密破解", "zip口令爆破"],
  },
};
