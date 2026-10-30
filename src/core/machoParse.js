/*
 * machoParse.js — Mach-O / universal（fat）二进制结构解析（只解析与字段展示，不反编译）。
 *
 * 依据：Apple 公开头文件规范（mach-o/loader.h / fat.h，XNU/开源 Darwin 源）——
 *   fat：magic cafebabe（BE）+ nfat_arch + {cputype, cpusubtype, offset, size, align}×n（BE）；
 *   slice 64 位：magic feedfacf（LE 存储；fat 内读为 cffaedfe 即 MH_CIGAM_64 视角），
 *     header = magic cputype cpusubtype filetype ncmds sizeofcmds flags reserved（32B）；
 *   load command：cmd(4) cmdsize(4)；LC_SEGMENT_64(0x19) 内 segname(16)/vmaddr/vmsize/
 *     fileoff/filesize/maxprot/initprot/nsects/flags + section_64（sectname/segname/
 *     addr/size/offset/…）。
 * cputype：7=i386、0x01000007=x86_64、12=ARM、0x0100000C=ARM64；filetype：2=EXECUTE、
 *   5=DYLIB、6=BUNDLE、12=DSYM 等。未知 load command 按 cmdsize 跳过并标注（合法扩展）。
 *
 * 只读结构解析：不做反编译、不执行（卡面口径）；零外发。
 */

import { register } from "./registry.js";

const FAT_MAGIC = 0xcafebabe;
const MH_MAGIC_64 = 0xfeedfacf, MH_CIGAM_64 = 0xcffaedfe;
const MH_MAGIC_32 = 0xfeedface, MH_CIGAM_32 = 0xcefaedfe;

const CPUTYPES = { 7: "i386", 0x01000007: "x86_64", 12: "arm", 0x0100000c: "arm64", 0x01000012: "arm64e" };
const FILETYPES = { 1: "MH_OBJECT", 2: "MH_EXECUTE", 3: "MH_FVMLIB", 4: "MH_CORE", 5: "MH_DYLIB", 6: "MH_DYLINKER", 7: "MH_BUNDLE", 8: "MH_DYLIB_STUB", 9: "MH_DSYM", 12: "MH_KEXT_BUNDLE" };
// load command 名（Apple mach-o/loader.h 权威值；带 0x80000000 = LC_REQ_DYC 位）
const LC = {
  0x1: "LC_SEGMENT", 0x2: "LC_SYMTAB", 0x3: "LC_SYMSEG", 0x4: "LC_THREAD",
  0x5: "LC_UNIXTHREAD", 0xb: "LC_DYSYMTAB", 0xc: "LC_LOAD_DYLIB", 0xd: "LC_ID_DYLIB",
  0xe: "LC_LOAD_DYLINKER", 0xf: "LC_ID_DYLINKER", 0x10: "LC_PREBOUND_DYLIB",
  0x11: "LC_ROUTINES", 0x12: "LC_SUB_FRAMEWORK", 0x13: "LC_SUB_UMBRELLA",
  0x14: "LC_SUB_CLIENT", 0x15: "LC_SUB_LIBRARY", 0x16: "LC_TWOLEVEL_HINTS",
  0x17: "LC_UUID", 0x18: "LC_SEGMENT?（未用）", 0x19: "LC_SEGMENT_64",
  0x1a: "LC_ROUTINES_64", 0x1b: "LC_CODE_SIGNATURE", 0x1c: "LC_SEGMENT_SPLIT_INFO",
  0x1d: "LC_ENCRYPTION_INFO", 0x1e: "LC_DYLD_INFO", 0x20: "LC_LAZY_LOAD_DYLIB",
  0x21: "LC_ENCRYPTION_INFO_64", 0x24: "LC_VERSION_MIN_MACOSX", 0x25: "LC_VERSION_MIN_IPHONEOS",
  0x26: "LC_FUNCTION_STARTS", 0x28: "LC_DATA_IN_CODE", 0x29: "LC_SOURCE_VERSION",
  0x2a: "LC_DYLIB_CODE_SIGN_DRS", 0x2c: "LC_LINKER_OPTION", 0x2d: "LC_LINKER_OPTIMIZATION_HINT",
  0x2e: "LC_VERSION_MIN_WATCHOS", 0x2f: "LC_VERSION_MIN_TVOS", 0x32: "LC_BUILD_VERSION",
  0x80000018: "LC_LOAD_WEAK_DYLIB", 0x8000001c: "LC_RPATH", 0x8000001f: "LC_REEXPORT_DYLIB",
  0x80000022: "LC_DYLD_INFO_ONLY", 0x80000028: "LC_MAIN", 0x80000030: "LC_DYLD_ENVIRONMENT",
  0x80000033: "LC_DYLD_EXPORTS_TRIE", 0x80000034: "LC_DYLD_CHAINED_FIXUPS",
  0x80000035: "LC_FILESET_ENTRY", 0x80000036: "LC_ATOM_INFO",
};

function fixedStr(b, off, len) {
  let s = b.toString("latin1", off, off + len).replace(/\0.*$/, "");
  return s;
}

/** 解析单个 Mach-O slice（LE）。 */
function parseSlice(b, base, lines, label) {
  const magic = b.readUInt32LE(base);
  if (magic !== MH_MAGIC_64 && magic !== MH_MAGIC_32) throw new Error(`Mach-O 解析失败：${label} magic 非法（${b.readUInt32BE(base).toString(16)}，应为 feedfacf/feedface）`);
  const is64 = magic === MH_MAGIC_64;
  const cputype = b.readUInt32LE(base + 4);
  const cpusubtype = b.readUInt32LE(base + 8);
  const filetype = b.readUInt32LE(base + 12);
  const ncmds = b.readUInt32LE(base + 16);
  const sizeofcmds = b.readUInt32LE(base + 20);
  const flags = b.readUInt32LE(base + 24);
  lines.push(
    `  ${label}：magic=0x${magic.toString(16)}（${is64 ? "64 位" : "32 位"}）`,
    `    cputype=${cputype}（${CPUTYPES[cputype] || "未知"}），cpusubtype=0x${cpusubtype.toString(16)}`,
    `    filetype=${filetype}（${FILETYPES[filetype] || "未知"}），ncmds=${ncmds}，sizeofcmds=${sizeofcmds}，flags=0x${flags.toString(16)}`
  );
  let off = base + (is64 ? 32 : 28);
  const end = off + sizeofcmds;
  if (end > b.length) throw new Error(`Mach-O 解析失败：${label} load commands 越界（sizeofcmds=${sizeofcmds} 超出文件）`);
  let nSeg = 0, nSec = 0;
  for (let i = 0; i < ncmds; i++) {
    if (off + 8 > end) throw new Error(`Mach-O 解析失败：${label} load command #${i} 头越界`);
    const cmd = b.readUInt32LE(off);
    const cmdsize = b.readUInt32LE(off + 4);
    if (cmdsize < 8) throw new Error(`Mach-O 解析失败：${label} load command #${i} cmdsize=${cmdsize} < 8（非法）`);
    if (off + cmdsize > end) throw new Error(`Mach-O 解析失败：${label} load command #${i} cmdsize 越界（超出 sizeofcmds 边界）`);
    const lcName = LC[cmd] || `未知(0x${cmd.toString(16)})`;
    let detail = "";
    if (cmd === 0x19 || cmd === 0x1) { // LC_SEGMENT(_64)
      const isSeg64 = cmd === 0x19;
      const segname = fixedStr(b, off + 8, 16);
      const vmaddr = isSeg64 ? b.readBigUInt64LE(off + 24) : BigInt(b.readUInt32LE(off + 24));
      const vmsize = isSeg64 ? b.readBigUInt64LE(off + 32) : BigInt(b.readUInt32LE(off + 28));
      const fileoff = isSeg64 ? b.readBigUInt64LE(off + 40) : BigInt(b.readUInt32LE(off + 32));
      const filesize = isSeg64 ? b.readBigUInt64LE(off + 48) : BigInt(b.readUInt32LE(off + 36));
      const nsects = isSeg64 ? b.readUInt32LE(off + 64) : b.readUInt32LE(off + 48);
      detail = `segname="${segname}" vmaddr=0x${vmaddr.toString(16)} vmsize=0x${vmsize.toString(16)} fileoff=0x${fileoff.toString(16)} filesize=0x${filesize.toString(16)} nsects=${nsects}`;
      nSeg++;
      let so = off + (isSeg64 ? 72 : 56);
      for (let s = 0; s < nsects; s++) {
        const sectname = fixedStr(b, so, 16);
        const sectseg = fixedStr(b, so + 16, 16);
        const addr = isSeg64 ? b.readBigUInt64LE(so + 32) : BigInt(b.readUInt32LE(so + 32));
        const size = isSeg64 ? b.readBigUInt64LE(so + 40) : BigInt(b.readUInt32LE(so + 36));
        const sOffset = isSeg64 ? b.readUInt32LE(so + 48) : b.readUInt32LE(so + 40);
        lines.push(`      section "${sectname}"（${sectseg}）addr=0x${addr.toString(16)} size=0x${size.toString(16)} offset=0x${sOffset.toString(16)}`);
        nSec++;
        so += isSeg64 ? 80 : 68;
      }
    } else if (cmd === 0x80000028) { // LC_MAIN
      detail = `entryoff=0x${b.readBigUInt64LE(off + 8).toString(16)}`;
    } else if (cmd === 0x17) { // LC_UUID
      detail = `uuid=${b.toString("hex", off + 8, off + 24)}`;
    } else if (cmd === 0xc || cmd === 0xd || cmd === 0x80000018 || cmd === 0x8000001f || cmd === 0x20) { // dylib 族（LOAD/ID/WEAK/REEXPORT/LAZY）
      detail = `name="${fixedStr(b, off + 24, cmdsize - 24)}"`;
    } else if (cmd === 0x32) { // LC_BUILD_VERSION
      detail = `platform=${b.readUInt32LE(off + 8)} minos=0x${b.readUInt32LE(off + 12).toString(16)} sdk=0x${b.readUInt32LE(off + 16).toString(16)}`;
    } else if (cmd === 0x29) { // LC_SOURCE_VERSION
      const v = b.readBigUInt64LE(off + 8);
      const A = (v >> 40n) & 0xffffffn, B = (v >> 30n) & 0x3ffn, C = (v >> 20n) & 0x3ffn, D = (v >> 10n) & 0x3ffn, E = v & 0x3ffn;
      detail = `version=${A}.${B}.${C}.${D}.${E}`;
    }
    lines.push(`    load command #${i}：${lcName}（cmdsize=${cmdsize}）${detail}`);
    off += cmdsize;
  }
  lines.push(`    小计：${nSeg} segment / ${nSec} section`);
}

function parseMacho(b) {
  if (b.length < 8) throw new Error(`Mach-O 解析失败：文件过短（${b.length} 字节）`);
  const be = b.readUInt32BE(0);
  const le = b.readUInt32LE(0); // 单架构 slice 的 magic 是小端存储
  const lines = [];
  if (be === FAT_MAGIC) {
    const n = b.readUInt32BE(4);
    if (8 + n * 20 > b.length) throw new Error(`Mach-O 解析失败：fat 头声称 ${n} 个架构，超出文件大小`);
    lines.push("=== Mach-O universal（fat）结构解析 ===", `magic=0xcafebabe ✓，nfat_arch=${n}`);
    for (let i = 0; i < n; i++) {
      const o = 8 + i * 20;
      const cputype = b.readUInt32BE(o);
      const cpusubtype = b.readUInt32BE(o + 4);
      const offset = b.readUInt32BE(o + 8);
      const size = b.readUInt32BE(o + 12);
      const align = b.readUInt32BE(o + 16);
      lines.push(`  arch #${i}：cputype=${cputype}（${CPUTYPES[cputype] || "未知"}）subtype=0x${cpusubtype.toString(16)} offset=${offset} size=${size} align=2^${align}`);
      if (offset + size > b.length) throw new Error(`Mach-O 解析失败：arch #${i} 越界（offset=${offset} size=${size} 文件=${b.length}）`);
    }
    for (let i = 0; i < n; i++) {
      const offset = b.readUInt32BE(8 + i * 20 + 8);
      const cputype = b.readUInt32BE(8 + i * 20);
      lines.push("", `  —— 架构 slice #${i}（${CPUTYPES[cputype] || cputype}，偏移 ${offset}）——`);
      parseSlice(b, offset, lines, `arch #${i}`);
    }
  } else if (le === MH_MAGIC_64 || le === MH_MAGIC_32 || le === MH_CIGAM_64 || le === MH_CIGAM_32) {
    lines.push("=== Mach-O 结构解析（单架构）===");
    parseSlice(b, 0, lines, "本文件");
  } else {
    throw new Error(`Mach-O 解析失败：magic 非法（BE=0x${be.toString(16)} LE=0x${le.toString(16)}，应为 cafebabe/feedfacf/feedface；也可用 hexDump op 先看头部）`);
  }
  lines.push("", "说明：仅结构解析与字段展示，不做反编译。");
  return lines.join("\n");
}

register({
  id: "machoParse",
  cat: "filefmt",
  name: "Mach-O 结构解析",
  desc: "Mach-O / universal（fat）结构解析（Apple mach-o/loader.h 口径，只解析展示不反编译）：fat 头（cafebabe + 架构表）/单架构 slice（cputype/filetype/flags）、逐 load command（LC_SEGMENT_64 的 segments/sections、LC_MAIN 入口、LC_UUID、dylib、BUILD_VERSION 等，未知 cmd 按 cmdsize 跳过标注）。截断/越界/非法 magic 显式报错。输入文件字节或 hex",
  acceptsBytes: true,
  params: [],
  run: (t, p) => {
    const raw = p && p.rawBytes;
    let b;
    if (raw) b = Buffer.from(raw);
    else {
      const s = String(t ?? "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
      if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error("输入非法：须为 Mach-O 文件字节或偶数位 hex");
      b = Buffer.from(s, "hex");
    }
    return parseMacho(b);
  },
});
