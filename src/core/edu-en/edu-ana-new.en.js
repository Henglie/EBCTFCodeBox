/*
 * edu-ana-new.en.js — English edu shard: analysis-class new ops (T307).
 *
 * Covers 4 genuinely missing analysis-class edu cards:
 * sstiKeyword — SSTI keyword detection (static feature scan for server-side template injection)
 * crc32Collision — CRC32 collision brute force (reverse-lookup short plaintext from a known CRC32)
 * pickleDisasm — Pickle disassembly (Python pickle bytecode disassembly)
 * zipBrute — ZIP weak-password brute force (ZipCrypto legacy encryption)
 *
 * Contains 4 ops.
 */
export default {
 // ============ analysis: SSTI keyword detection ============
  sstiKeyword: {
    what: "SSTI keyword detection — a static feature scan for Server-Side Template Injection. It flags template delimiters of engines like Jinja2/Twig/FreeMarker/Velocity/Smarty, classic RCE exploit-chain keywords, and 7×7 probe payloads in the text, and infers which engine is in use. It detects only, never executes.",
    principle:
      "SSTI triggers when a template engine renders user input as template source. Each engine uses different delimiters: Jinja2 uses `{{ ... }}`, Twig uses `{{ }}`, FreeMarker uses `${...}`, Velocity uses `$...` or `#...`, Smarty uses `{...}`.\n\n" +
      "The classic probe payload is `{{7*7}}` — if the rendered result is 49, the template was executed. Once further exploit chains appear, such as `{{''.__class__.__mro__[1].__subclasses__()}}` (Jinja2 Python sandbox escape) or `${\"freemarker.template.utility.Execute\"?new()(\"id\")}` (FreeMarker RCE), RCE is nearly confirmed.\n\n" +
      "This tool scans for these feature strings following OWASP SSTI detection logic, giving an engine inference and risk level. It sends no requests and executes no templates.",
    usage: "Paste suspicious request parameters, URLs, or response bodies and run it; outputs the detected delimiters, keywords, probe payloads, and the inferred template engine. The one-shot detect also invokes it automatically.",
    examples: [
      { in: "{{7*7}}", out: "Jinja2/Twig probe payload", desc: "7×7 probe; rendering to 49 confirms SSTI" },
      { in: "${7*7}", out: "FreeMarker/JSP EL probe", desc: "${} is the FreeMarker/JSP EL delimiter" },
      { in: "{{''.__class__}}", out: "Jinja2 Python sandbox escape chain", desc: "accessing __class__ is a typical Python template exploitation technique" },
    ],
    tips: [
      "Common CTF Web format: given a search box / URL parameter, entering {{7*7}} that returns 49 is SSTI",
      "Distinguishing engines: {{7*'7'}} returns '7777777' in Jinja2 and '49' in Twig — a classic fingerprint",
      "Dangerous keywords: __class__/__mro__/__subclasses__/os.system/popen/Execute/eval are almost always an RCE exploit chain",
      "This tool only detects statically and sends no requests; actual exploitation requires manually crafting a payload to run on the target",
    ],
    aka: ["SSTI", "template injection", "模板注入", "jinja2 injection", "twig injection", "server-side template injection", "服务端模板注入", "SSTI识别", "模板引擎注入", "freemarker注入", "velocity注入", "smarty注入", "7*7探测"],
  },

 // ============ analysis: CRC32 collision brute force ============
  crc32Collision: {
    what: "CRC32 collision brute force — given the CRC32 (standard IEEE/zip CRC-32) of a short piece of data, exhaustively enumerate all possible contents to reverse-lookup the original. Used in CTF misc when a ZIP stores a small Stored file and only gives the CRC32 but the content is unavailable.",
    principle:
      "CRC-32/ISO-HDLC (IEEE 802.3, same as zip/gzip) is a 32-bit checksum: reflected polynomial 0xEDB88320, init=0xFFFFFFFF, refIn/refOut=true, xorOut=0xFFFFFFFF.\n\n" +
      "With only about 4.2 billion possible values, brute-forcing all possible contents for short plaintext (≤5 bytes) and comparing CRC32 is entirely feasible:\n" +
      "- 4 printable ASCII bytes: 95⁴ ≈ 81 million, seconds\n" +
      "- 5 printable ASCII bytes: 95⁵ ≈ 7.7 billion, a browser doing this synchronously will stall; hard cap set to 5\n" +
      "- 6 bytes reaches 730 billion, infeasible in a browser; needs offline hashcat / a custom script\n\n" +
      "This tool uses table-driven + DFS incremental computation (reusing the CRC register along the search path), about 8× faster than recomputing each candidate from scratch.",
    usage: "Fill in the target CRC32 (e.g. 0x414fa339 or 414fa339), choose the charset (printable ASCII / alphanumeric / digits only) and the plaintext length cap (default 4, hard cap 5), then click Run to enumerate matching candidates.",
    examples: [
      { in: "CRC32=0x352441c2, charset=printable, maxLen=4", out: '"abc"', desc: 'standard CRC32("abc") = 0x352441c2' },
      { in: "CRC32=0xd1f4eb9a, charset=lower, maxLen=4", out: '"flag"', desc: 'CRC32("flag") = 0xd1f4eb9a' },
    ],
    formulas: [
      { tex: "\\text{CRC32} = \\bigoplus_{i}\\ \\text{table}[(c \\oplus \\text{byte}_i) \\& 0xFF] \\oplus (c \\gg 8)", caption: "table-driven CRC32 incremental computation (c is the register, reused along the DFS path)" },
    ],
    tips: [
      "Classic CTF misc format: a ZIP contains a small Stored (method=0) file whose CRC32 is known but whose content is encrypted/truncated",
      "The 5-byte hard cap is the limit of synchronous browser brute force; for longer plaintext use hashcat --hash-type 3000 or a custom C script",
      "CRC32 is only 32 bits, so long plaintext produces many collisions; combine the ZIP entry's file size and context to judge authenticity",
      "This tool and zipCrc32Brute are two ops for the same algorithm (this one uses the generic name, the other emphasizes the ZIP scenario); pick either",
    ],
    aka: ["CRC32 brute", "CRC32 反查", "zip crc crack", "CRC 碰撞", "CRC32碰撞", "CRC32爆破", "crc32 collision", "crc32 reverse", "zip crc32 crack", "CRC32穷举", "CRC32反查明文", "crc brute force"],
  },

 // ============ analysis: Pickle disassembly ============
  pickleDisasm: {
    what: "Pickle disassembly — disassemble Python pickle bytecode into readable pickletools.dis-style text, highlighting dangerous opcodes like GLOBAL/REDUCE/BUILD and RCE symbols like os.system/popen/subprocess. It disassembles only, never executes.",
    principle:
      "pickle is Python's object serialization protocol (protocol 0-5), essentially a stream of opcode instructions. Core opcodes:\n" +
      "- PROTO: declares the protocol version\n" +
      "- GLOBAL (c): loads a symbol from a module, e.g. `cos\\nsystem\\n` → loads os.system\n" +
      "- REDUCE (R): calls the callable on the stack top, the RCE execution point\n" +
      "- BUILD (b): calls the object's __setstate__, often used to trigger __reduce__\n" +
      "- STOP (.): ends\n\n" +
      "The dangerous combination GLOBAL+REDUCE is equivalent to `os.system(cmd)`. Python's official docs explicitly warn 'never unpickle untrusted data' — deserialization means RCE. This tool only disassembles statically, never executes REDUCE, and is safe.",
    usage: "Paste pickle bytes (hex/base64/raw bytes auto-detected); after running it outputs a per-opcode disassembly listing, with dangerous opcodes flagged in red and an RCE risk warning.",
    examples: [
      { in: "636f730a73797374656d0a2853276563686f206869270a74522e", out: "GLOBAL os system / STRING 'echo hi' / REDUCE / STOP", desc: "protocol 0 plaintext pickle, os.system('echo hi') RCE payload (hex)" },
      { in: "Y29zCnN5c3RlbQooUydlY2hvIGhpJwp0Ui4=", out: "GLOBAL os system + STRING 'echo hi' + REDUCE", desc: "base64 encoding of the same payload, identical disassembly" },
    ],
    formulas: [
      { tex: "\\text{pickle} = \\text{PROTO} \\cdot (\\text{GLOBAL} + \\text{REDUCE})^* \\cdot \\text{STOP}", caption: "opcode sequence structure, GLOBAL+REDUCE is the RCE execution point" },
    ],
    tips: [
      "Classic CTF Web/Misc: given a .pkl file or base64 pickle data, deserialize for RCE to get the flag",
      "Protocol 0 is plaintext ASCII and directly readable; protocol 2+ is binary and needs disassembly",
      "Dangerous opcodes: GLOBAL(c)/REDUCE(R)/BUILD(b)/INST(i)/OBJ(o)/NEWOBJ(\\x81)/STACK_GLOBAL(\\x93)",
      "This tool never executes REDUCE; pure static disassembly lets you safely analyze malicious pickles",
      "Python's built-in pickletools.dis can also disassemble; this tool is its browser version + RCE highlighting",
    ],
    aka: ["pickle disassemble", "pickle 反汇编", "python pickle", "pickle RCE", "反序列化", "pickletools", "pickletools.dis", "pickle字节码", "pickle opcode", "python反序列化", "pickle disasm", "pkl反汇编"],
  },

 // ============ analysis: ZIP weak-password brute force ============
  zipBrute: {
    what: "ZIP weak-password brute force — for ZipCrypto (legacy PKWARE encryption) ZIP files, exhaust weak passwords to verify whether a password is correct. It only verifies the password, it does not recover the plaintext. Three modes: built-in dictionary + custom dictionary + numeric-only mask.",
    principle:
      "ZipCrypto is the ZIP legacy encryption algorithm (PKWARE, designed by Phil Katz), which uses a 12-byte encryption header to verify the password:\n" +
      "1. Initialize 3 32-bit keys (key0/key1/key2) from the password\n" +
      "2. Encrypt the first 12 bytes of the header, where the last 1 byte (or 2 bytes, depending on version) is the check value\n" +
      "3. Decrypt and compare the check value to judge whether the password is right, **without decrypting the whole file**\n\n" +
      "This property makes password verification extremely fast (microseconds); brute-forcing 4-digit numbers (10000 tries) finishes within a second. But 6+ digits or a large dictionary will stall the browser, so the hard cap is set to 6 digits.\n\n" +
      "Limitations: WinZip AES is not supported (AES-256 verification requires decrypting the whole file, left for a WASM version); the bkcrack plaintext attack (recovering the key from known plaintext) is not done (there is a dedicated tool for it).",
    usage: "Drop in a ZIP file or paste its hex/base64, pick a mode: numeric mask (fill in the digit cap, default 4, hard cap 6) / built-in dictionary / custom dictionary (one password per line). Click Run to auto-enumerate; on a hit it outputs the password.",
    examples: [
      { in: "ZIP + 4 digits", out: "password: 1234", desc: "enumerates 0000-9999, 10000 tries, seconds" },
      { in: "ZIP + custom dictionary flag\\nctf2024\\nadmin", out: "password: ctf2024", desc: "dictionary mode verifies one by one" },
    ],
    formulas: [
      { tex: "\\text{key}_{i+1} = \\text{CRC32}(\\text{key}_i,\\ \\text{byte})", caption: "ZipCrypto key update (table-driven CRC32)" },
    ],
    tips: [
      "Frequent CTF misc format: given an encrypted ZIP whose password is a weak one (digits, common words), just enumerate",
      "Only ZipCrypto (legacy encryption) is supported; a WinZip AES-encrypted ZIP needs other tools",
      "6 digits = 1 million tries, about 10-30 seconds synchronously in a browser; for more than 6 digits use hashcat --hash-type 17200/17210/17220/17225/17230",
      "The bkcrack plaintext attack (knowing the content of some file inside the ZIP) can recover the key and bypass the password; this tool doesn't do it",
      "Password verification only checks the 12-byte encryption header, giving a theoretical 1/256 false-positive rate; after a hit it's advisable to extract and verify again",
    ],
    aka: ["zip password crack", "zipcrypto brute", "zip 弱口令", "zip 密码爆破", "zip爆破", "zip密码破解", "ZipCrypto crack", "zip字典爆破", "压缩包密码爆破", "zip brute force", "PKWARE加密破解", "zip口令爆破"],
  },
};
