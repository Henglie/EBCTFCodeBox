/*
 * edu_t693_en.js — English edu cards for the 2 T693 ops (candidates, not wired).
 * Source: edu_t693_zh.js, translated 1:1. Example vectors and TeX formulas copied
 * verbatim; only prose is translated. Aka lists keep every Chinese alias and add
 * English ones.
 */
export default {
  wasmParse: {
    what: "WebAssembly (WASM) binary structure parsing — reads the \"skeleton\" of a .wasm file for you: magic/version, per-section offsets and sizes, function type signatures, the import/export list, memory/table/start function. Structure display only — **no decompilation, no execution** (executing is a different matter entirely; this tool refuses to run untrusted code). CTF wasm challenges typically hand you a .wasm and ask you to reverse the logic; step one is reading the structure: which functions are exported, which environment symbols are imported, how big it is.",
    principle:
      "**Binary format (W3C spec §5 Binary Format)**:\n\n" +
      "① 8-byte header: magic `00 61 73 6D` (`\\0asm`) + version `01 00 00 00` (u32 little-endian, currently always 1).\n\n" +
      "② A chain of sections: each = id (1 byte) + size (uleb128 variable-length) + content. ids 0-12: custom (0, may contain a name subsection), type (1), import (2), function (3), table (4), memory (5), global (6), export (7), start (8), element (9), code (10), data (11), datacount (12).\n\n" +
      "③ **One ordering exception**: non-custom sections are ordered by ascending id, **except datacount(12) whose legal position is before code(10)/data(11)** (spec module grammar type→import→…→element→datacount→code→data) — this tool checks that logical order and raises on violations.\n\n" +
      "④ **LEB128**: variable-length integers, 7 payload bits per byte with a continuation flag in the high bit. Nearly every length/index/offset in wasm is one; this tool validates strictly (truncation, >5 bytes, out-of-range all raise).\n\n" +
      "⑤ import entry = module name + name + kind (func/table/mem/global) + type; export = name + kind + index. Each type entry = 0x60 + param type list + result type list (i32/i64/f32/f64/v128/funcref/externref; GC-extension struct/array types are labeled \"not expanded\").\n\n" +
      "⑥ The most common custom section (id=0) is the **name subsection** (debug info): a function-name table mapping indices back to source names — extremely useful for reversing; this tool parses and summarizes it.",
    usage:
      "Drop in a .wasm file (or paste hex) and get the structure report: every section's id/offset/size + the first few imports/exports.\n\n" +
      "Typical workflow: ① read the export list for entry points (_start, main, challenge-defined names) → ② read imports to identify the environment (wasi_snapshot_preview1 = WASI program, env.* = emscripten output) → ③ use wabt (wasm2wat) or browser DevTools to disassemble function bodies (this tool does not do that step).\n\n" +
      "Recognition: a file starting with `\\0asm` is wasm (ASCII 00 61 73 6D); when a challenge hides the flag in the data section, this tool tells you how big it is and where — pair with hexDump/strings-style ops to extract.",
    examples: [
      { in: "7zz.wasm (bundled, 1.6MB)", out: "36 imports, first 3: env.__cxa_throw (func), env.exit (func)…; 7 exports, first 3: memory (mem #0)…", desc: "real sample; import list cross-checked against browser WebAssembly.Module.imports()" },
      { in: "a hand-built minimal wasm", out: "6 sections; 1 import / 1 export / 1 type / 1 function", desc: "byte-by-byte KAT: type/import/function/memory/export/code all recognized" },
      { in: "00 61 73 6d 02 00 00 00", out: "error: version 2 not supported", desc: "strict version check" },
    ],
    formulas: [
      { tex: "\\text{section} = id \\;(1\\text{B}) \\;\\|\\; \\mathrm{uleb128}(size) \\;\\|\\; content", caption: "Three-part sections; custom (id=0) may appear anywhere" },
      { tex: "\\mathrm{uleb128}:\\; b_6 b_5 \\cdots b_0 + 2^7(b_6' \\cdots) + \\cdots", caption: "Low 7 bits of each byte concatenated little-endian; high bit 1 = continue" },
    ],
    tips: [
      "Recognition: a .wasm/.wat file in the challenge, or the words \"WebAssembly\", \"emscripten\", \"WASI\"; a .wasm in browser DevTools Sources also points here.",
      "The import module name reveals the origin: `wasi_*` = WASI command-line program (directly runnable), `env` = emscripten, `__cxa_throw` = C++ exceptions.",
      "The name subsection is a reversing goldmine: original function names survive (only with -g builds); stripped wasm shows only $func$N.",
      "Flags often hide in the data section: structure parsing gives its offset and size, then extract with file-extraction/strings ops.",
      "Not decompiling is deliberate: untrusted wasm code is never executed; use wabt (wasm2wat) or browser DevTools for disassembly.",
      "Standards: W3C WebAssembly Core Specification 2.0 §5 (Binary Format) / §5.2.2 (LEB128) / the name-section subspec; imports/exports cross-checked item-by-item against browser WebAssembly.Module.imports/exports.",
    ],
    aka: ["WASM 解析", "wasm 结构", "WebAssembly 解析", "wasm sections", "wasm 导入导出",
      "wasmParse", "wasm 文件分析", "WASM 骨架", "wasm binary format", "wasm magic",
      "wasm LEB128", "wasm name section", "wasm 函数签名", "wasm 段表", "webassembly 结构"],
  },

  machoParse: {
    what: "Mach-O structure parsing — Mach-O is the macOS/iOS executable format (the counterpart of Windows PE and Linux ELF). This tool reads out: the architecture table of a fat (universal) header, each slice's CPU type/file type/flags, and the full load-command list (code segment layout, entry point, UUID, linked dynamic libraries, minimum OS version). Structure display only — **no decompiling**. It is step one for macOS/iOS reversing challenges and native-library analysis inside APK/IPA packages.",
    principle:
      "**Two shapes**:\n\n" +
      "① **Single-arch Mach-O**: starts with magic `feedfacf` (64-bit, stored little-endian) or `feedface` (32-bit); header = magic + cputype + cpusubtype + filetype + ncmds + sizeofcmds + flags (+64-bit reserved).\n\n" +
      "② **Universal (fat)**: magic `cafebabe` (big-endian) + nfat_arch + an architecture table (20 bytes each: cputype/cpusubtype/offset/size/align) — several architecture slices inside one file (Apple Silicon-era universal2 = arm64 + x86_64). Fat slice offsets are aligned to 2^align.\n\n" +
      "**cputype**: 7=i386, 0x01000007=x86_64, 12=arm, 0x0100000C=arm64 (the 0x01000000 bit is the 64-bit flag).\n\n" +
      "**Load commands** (ncmds entries after the header, each starting cmd + cmdsize): LC_SEGMENT_64 (0x19) is the heavy one — segment name (__TEXT code / __DATA data / __LINKEDIT link info) + virtual address/size + the embedded section table (__text code, __cstring strings, __objc_* and so on); LC_MAIN (0x80000028) gives the entry offset; LC_UUID the unique id; the LC_LOAD_DYLIB family lists linked libraries. This tool walks by cmdsize and annotates unknown commands without failing (Apple adds new ones; forward compatibility).\n\n" +
      "**Endianness trap**: fat headers are big-endian while slice internals are little-endian; single-arch files store the magic little-endian — both in one format, so the parser must keep them straight.",
    usage:
      "Drop in a Mach-O file (no extension needed — magic decides), get the report: the fat architecture table + each slice's load-command list and segment/section layout.\n\n" +
      "Typical workflow: ① for fat files, see which architectures are inside → ② LC_BUILD_VERSION's platform/minos gives the target OS → ③ LC_LOAD_DYLIB lists frameworks (a reversing hint) → ④ __cstring/__objc_methname sections usually hold plaintext strings; extract precisely with hexDump/strings using the shown offsets.\n\n" +
      "Recognition: `cafebabe` = universal fat (note: Java class files share that magic — the following fields differ); `feedfacf`/byte-reversed `cffaedfe` = 64-bit Mach-O.",
    examples: [
      { in: "macOS启动器 (bundled universal2, 334KB)", out: "magic=0xcafebabe ✓，nfat_arch=2; arch #0: cputype=16777228 (arm64) offset=16384 size=175080; arch #1: cputype=16777223 (x86_64)…", desc: "real sample; fat table fields byte-exact against manual probing" },
      { in: "a hand-built minimal Mach-O (LC_SEGMENT_64 + LC_UUID + LC_MAIN)", out: "ncmds=3; segname=\"__TEXT\" vmsize=0x1000 nsects=1; section \"__text\"…; uuid=0011…; entryoff=0x90", desc: "byte-by-byte KAT: all three load-command kinds recognized" },
      { in: "cafebabe 00000063 (fat header claiming 99 arches)", out: "报错：fat 头声称 99 个架构，超出文件大小", desc: "strict architecture-table bounds check" },
    ],
    formulas: [
      { tex: "\\text{fat} = \\underbrace{\\text{cafebabe}\\|n}_{8\\text{B}} \\;\\|\\; (\\text{cputype}\\|\\text{subtype}\\|\\text{offset}\\|\\text{size}\\|\\text{align})^{n}_{20\\text{B/条}}", caption: "Fat header fully big-endian; offset points at each slice" },
      { tex: "\\text{lc} = cmd \\;(4\\text{B}) \\;\\|\\; cmdsize \\;(4\\text{B}) \\;\\|\\; \\text{payload}", caption: "Generic load-command shape; unknown cmds skipped by cmdsize" },
    ],
    tips: [
      "Recognition: macOS/iOS reversing, unpacked IPA (Payload/*.app binaries), macho-flavored CTF challenges; `file` reporting \"Mach-O 64-bit executable\" also points here.",
      "cafebabe ambiguity: Java class and Mach-O fat share the magic — a class file has 00 34 (version) in bytes 5-8 while fat has the arch count; this tool validates fat fields, so a Java class fails with \"arch count out of range\".",
      "__cstring/__objc_methname sections are string goldmines — strings-pass first; this tool gives each section's offset/size for precise extraction.",
      "arm64e (pointer authentication) shares cputype with arm64 but differs in subtype — the tool shows arm64e by cputype field.",
      "No decompiling here: function-body reversing belongs to Hopper/Ghidra/IDA; signature validation (LC_CODE_SIGNATURE) shows location only.",
      "Standards: Apple's open-source mach-o/loader.h and fat.h (Darwin XNU/ctools); structure byte-exact against this project's own universal2 launcher (the MT646 artifact).",
    ],
    aka: ["Mach-O 解析", "MachO", "mach-o 结构", "Mach-O 文件分析", "fat binary",
      "universal binary 解析", "machoParse", "Mach-O header", "mach-o load commands",
      "Mach-O segment", "macho 文件", "macOS 可执行文件", "iOS 二进制分析", "mach-o 格式", "MachO 结构"],
  },
};
