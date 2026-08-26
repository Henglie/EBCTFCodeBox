/*
 * elfInfo.js — ELF 可执行文件信息（P1 批，cat:'bin'，单向 run）。
 *
 * 解决什么：ELF 头信息一眼概览——格式/架构/位数/字节序/类型/入口点，
 * 顺带挖出动态链接细节：PT_INTERP 解释器路径、PT_DYNAMIC 里 DT_NEEDED 依赖库、
 * 是否共享库（ET_DYN 且无解释器 ≈ .so）。CTF 里拿到一个 ELF 先看架构/位数/
 * 入口，再判断该用哪个引擎或是否 PIE。
 *
 * 解析路径（手写 ELF 结构，不用外部反编译栈）：
 * - 魔数 \x7fELF + EI_CLASS(EI_DATA byte4=1:ELF32,2:ELF64; byte5=1:LE,2:BE)
 * - 头字段按字节序读：e_type/e_machine/e_entry/e_phoff/e_phentsize/e_phnum/
 *   e_ehsize/e_shoff…
 * - 程序头表：PT_INTERP(3) 取解释器路径；PT_LOAD 建 vaddr→file-offset
 *   映射；PT_DYNAMIC 取动态节 → DT_STRTAB(5)/DT_STRSZ(10)/DT_NEEDED(1) →
 *   解依赖库名（c-string）
 * - ELF32 与 ELF64 的程序头/动态项尺寸不同（32/56 与 20/16 字节），按类分派
 *
 * 输出：报告 = 格式/架构/位数/字节序/类型/入口 + [解释器] + [依赖库] + 共享库说明。
 * 参考实现（binary_info ELF 分支）把文本走 text、细节走 json 多端口——折进本卡
 * 点名 op 一份报告出齐。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（inputEnc 可指定），或
 * p.rawBytes 直传（拖 ELF 文件）。
 *
 * 零外发：纯字节解析。
 *
 * 回归断言：加载期自检 IIFE（含参考单测 minimal_elf64 → ELF/64/0x401000；
 * 及带解释器+依赖库的合成 ELF → interp/两库出齐）。
 * makeElf 导出供回归脚本构造测试件（可配 class/endian/type/machine/entry/
 * interp/libs）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";

// ============ 基础工具 ============

const ELF_MAGIC = [0x7f, 0x45, 0x4c, 0x46];

function isElf(data) {
  return data.length >= 4 && data[0] === ELF_MAGIC[0] && data[1] === ELF_MAGIC[1] &&
    data[2] === ELF_MAGIC[2] && data[3] === ELF_MAGIC[3];
}

const u16 = (b, o, le) => {
  if (b.length < o + 2) return 0;
  return le ? (b[o] | (b[o + 1] << 8)) : ((b[o] << 8) | b[o + 1]);
};
const u32 = (b, o, le) => {
  if (b.length < o + 4) return 0;
  const v = le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24))
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
  return v >>> 0;
};
const u32h = (b, o, le) => {
  let lo = u32(b, o, le), hi = u32(b, o + 4, le);
  return (hi * 4294967296 + lo) >>> 0;
};
const u64 = (b, o, le) => {
  const lo = u32(b, o, le);
  const hi = u32(b, o + 4, le);
  return hi * 4294967296 + lo;
};

const ELF_TYPE = { 1: "可重定位(.o)", 2: "可执行", 3: "共享库/PIE", 4: "core dump" };

// e_machine（EM_*）常见值 → 名称
const ELF_MACHINE = {
  0x02: "SPARC", 0x03: "x86", 0x08: "MIPS", 0x14: "PowerPC",
  0x16: "PowerPC64", 0x28: "ARM", 0x2a: "SuperH", 0x32: "IA-64",
  0x3e: "x86-64", 0x8c: "RISC-V", 0xb7: "ARM64/AArch64", 0xf3: "RISC-V",
};
const elfTypeName = (t) => ELF_TYPE[t] || "其它(0x" + t.toString(16) + ")";
const machineName = (m) => ELF_MACHINE[m] || ("EM_0x" + m.toString(16));

// ============ ELF 结构 ============

/** 读 c-string（<len 内, 到 NUL 止），UTF-8 解码。 */
function readCStr(data, off) {
  if (off < 0 || off >= data.length) return null;
  let end = off;
  while (end < data.length && data[end] !== 0) end++;
  if (end === off) return "";
  return new TextDecoder("utf-8").decode(data.subarray(off, end));
}

/**
 * 解析 ELF 头 + 程序头/动态，返回信息对象；非 ELF 返回 null。
 * 字段：class/bits/endian/type/machine/entry/interpreter/libraries/isLib/phnum。
 */
export function parseElfInfo(data) {
  if (!isElf(data)) return null;
  const cls = data[4];           // 1=ELF32 2=ELF64
  const le = data[5] === 1;      // 1=little 2=big
  const bits = cls === 2 ? 64 : 32;
  const eType = u16(data, 16, le);
  const machine = u16(data, 18, le);
  const ehsize = u16(data, bits === 64 ? 52 : 40, le);
  const phoff = bits === 64 ? u64(data, 32, le) : u32(data, 28, le);
  const phentsize = u16(data, bits === 64 ? 54 : 42, le) || (bits === 64 ? 56 : 32);
  const phnum = u16(data, bits === 64 ? 56 : 44, le);
  const entry = bits === 64 ? u64(data, 24, le) : u32(data, 24, le);

  const isLib = eType === 3; // ET_DYN（可能 PIE 也可能 .so），参考 is_lib 近似
  let interpreter = null;
  const libraries = [];
  const dynTags = [];

  // 程序头表扫描：PT_INTERP(3) / PT_LOAD(1) / PT_DYNAMIC(2)
  let strtabAddr = null, strsz = 0, dynFilesz = 0, dynOff = -1, dynSize = -1;
  const loads = [];
  const interpAddr = { off: -1, size: 0 };
  if (phnum > 0 && phoff > 0 && phentsize > 0) {
    for (let i = 0; i < phnum; i++) {
      const p = phoff + i * phentsize;
      if (p + phentsize > data.length) break;
      const pType = u32(data, p, le);
      const off = bits === 64 ? u64(data, p + 8, le) : u32(data, p + 4, le);
      const vaddr = bits === 64 ? u64(data, p + 16, le) : u32(data, p + 8, le);
      const filesz = bits === 64 ? u64(data, p + 32, le) : u32(data, p + 16, le);
      switch (pType) {
        case 1: loads.push({ vaddr, off, filesz }); break; // PT_LOAD
        case 3: interpAddr.off = off; interpAddr.size = filesz; break; // PT_INTERP
        case 2: dynOff = off; dynSize = filesz; break;     // PT_DYNAMIC
        default: {}
      }
    }
  }
  // vaddr → file offset（PT_LOAD 内，范围内找；否则 null）
  const resolve = (addr) => {
    for (const s of loads) {
      if (addr >= s.vaddr && addr < s.vaddr + s.filesz) {
        return s.off + (addr - s.vaddr);
      }
    }
    return null;
  };

  if (interpAddr.off >= 0 && interpAddr.size > 0) {
    interpreter = readCStr(data, interpAddr.off) || null;
  }

  if (dynOff >= 0 && dynSize > 0) {
    // 读动态项，先收 DT_STRTAB/DT_STRSZ/DT_NEEDED
    const dynEntSize = bits === 64 ? 16 : 8;
    const dynCount = Math.floor(dynSize / dynEntSize);
    for (let i = 0; i < dynCount; i++) {
      const d = dynOff + i * dynEntSize;
      if (d + dynEntSize > data.length) break;
      const tag = bits === 64 ? u64(data, d, le) : u32(data, d, le);
      const val = bits === 64 ? u64(data, d + 8, le) : u32(data, d + 4, le);
      const tagLo = tag >>> 0;
      dynTags.push([tagLo, val]);
      if (tagLo === 5) strtabAddr = val;       // DT_STRTAB
      else if (tagLo === 10) strsz = val;      // DT_STRSZ
    }
    // DT_NEEDED 偏移相对 strtab
    if (strtabAddr !== null) {
      const strBase = resolve(strtabAddr) ?? (strtabAddr < data.length ? strtabAddr : null);
      if (strBase !== null) {
        for (const [tag, val] of dynTags) {
          if (tag === 1) { // DT_NEEDED
            const s = readCStr(data, strBase + val);
            if (s) libraries.push(s);
          }
        }
      }
    }
  }

  return {
    bits, endian: le ? "小端" : "大端",
    type: elfTypeName(eType), machine: machineName(machine),
    entry, interpreter, libraries, isLib,
    phnum, ehsize, hasSections: u32(data, bits === 64 ? 40 : 32, le) > 0,
  };
}

// ============ op run ============

function elfInfoRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入 ELF 可执行文件或粘贴 hex / base64 字节。";
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { return "输入解析失败：" + (e && e.message ? e.message : String(e)); }

  const info = parseElfInfo(data);
  if (!info) {
    return `不是 ELF 可执行文件（前 4 字节应 7f 45 4c 46），输入 ${data.length} 字节。`;
  }
  const lines = [];
  lines.push(`格式：ELF`);
  lines.push(`架构：${info.machine}`);
  lines.push(`位数：${info.bits}`);
  lines.push(`字节序：${info.endian}`);
  lines.push(`类型：${info.type}`);
  lines.push(`入口：0x${info.entry.toString(16)}`);
  if (info.interpreter !== null && info.interpreter !== undefined) {
    lines.push(`解释器：${info.interpreter}`);
  }
  if (info.libraries.length) {
    lines.push(`依赖库：${info.libraries.join(", ")}`);
  }
  if (info.isLib) {
    lines.push(`说明：ET_DYN（可能是 PIE 可执行或共享库）`);
  }
  lines.push(`程序头：${info.phnum} 个` + (info.hasSections ? "" : "，无节区表"));
  return lines.join("\n");
}

// ============ 测试构造器（供回归脚本） ============

/**
 * 构造合成 ELF。opts: { bits=64, le=true, type=2, machine=0x3e, entry=0x401000,
 * interp=null, libs=[] }
 * 带 interp 或 libs 时自动生成程序头（PT_INTERP / PT_LOAD / PT_DYNAMIC）+
 * 动态节（DT_STRTAB/DT_STRSZ/DT_NEEDED）+ strtab，并保证 vaddr==file offset
 * （LOAD 段基址即文件位移），供 parseElfInfo 直接解。
 */
export function makeElf(o = {}) {
  const oo = o || {};
  const bits = oo.bits === 32 ? 32 : 64;
  const le = oo.le !== false;
  const type = oo.type || 2;
  const machine = oo.machine || 0x3e;
  const entry = oo.entry ?? 0x401000;
  const interp = oo.interp || null;
  const libs = oo.libs || [];
  const needDyn = interp || libs.length;

  const out = [];
  const pushW = (v, width) => {
    for (let i = 0; i < width; i++) {
      const byte = le ? (v >>> (8 * i)) : (v >>> (8 * (width - 1 - i)));
      out.push(byte & 0xff);
    }
  };
  const pushU16 = (v) => pushW(v, 2);
  const pushU32 = (v) => pushW(v >>> 0, 4);
  // 64 位：拆成高低两个 32 位字；大端先写高字、小端先写低字
  const push64 = (v) => {
    const lo = (v % 4294967296) >>> 0, hi = (Math.floor(v / 4294967296) % 4294967296) >>> 0;
    if (le) pushW(lo, 4);
    pushW(hi, 4);
    if (!le) pushW(lo, 4);
  };
  const pushAddr = (v) => { if (bits === 64) push64(v); else pushW(v >>> 0, 4); };
  const pushU64 = push64;
  const align4 = () => { while (out.length % 4) out.push(0); };

  // ELF header 占位（先写固定段，后回填）
  const headerStart = out.length;
  out.push(0x7f, 0x45, 0x4c, 0x46);      // magic
  out.push(bits === 32 ? 1 : 2);          // EI_CLASS
  out.push(le ? 1 : 2);                    // EI_DATA
  out.push(1);                             // EI_VERSION
  for (let i = 0; i < 9; i++) out.push(0); // EI_PAD
  pushU16(type);
  pushU16(machine);
  pushU32(1);                              // e_version
  pushAddr(entry);                         // e_entry
  const phoffPos = out.length;
  pushAddr(needDyn ? (bits === 64 ? 64 : 52) : 0); // e_phoff
  pushAddr(0);                             // e_shoff
  pushU32(0);                              // e_flags
  pushU16(bits === 64 ? 64 : 52);          // e_ehsize
  pushU16(bits === 64 ? 56 : 32);          // e_phentsize
  const phnumPos = out.length;
  pushU16(needDyn ? (bits === 64 ? 3 : 3) : 0); // e_phnum
  pushU16(bits === 64 ? 64 : 40);          // e_shentsize
  pushU16(0);                              // e_shnum
  pushU16(0);                              // e_shstrndx
  if (out.length < (bits === 64 ? 64 : 52)) { while (out.length < (bits === 64 ? 64 : 52)) out.push(0); }

  if (!needDyn) {
    // 应用 e_shoff/e_shnum 回填（无节区）
    return new Uint8Array(out);
  }

  // —— 布局：header | phdrs | strtab | dyn ——
  const ehSize = bits === 64 ? 64 : 52;
  const phEnt = bits === 64 ? 56 : 32;
  const nPh = 3; // LOAD, INTERP, DYNAMIC
  const phdrBase = ehSize;
  const strtabOff = ehSize + nPh * phEnt;
  // strtab 内容：interp 串 + libs 串，收 offset 供 DT_NEEDED
  const strEntries = [];
  let strCursor = strtabOff;
  if (interp) { strEntries.push({ key: "interp", off: strCursor, len: interp.length + 1 }); strCursor += interp.length + 1; }
  const libEntryOffs = [];
  for (const l of libs) { strEntries.push({ key: "lib", off: strCursor }); libEntryOffs.push(strCursor); strCursor += l.length + 1; }
  const strtabLen = strCursor - strtabOff;
  const strBaseAddr = strtabOff; // vaddr == file offset
  const dynOff = strtabOff + strtabLen;
  const dynEnt = bits === 64 ? 16 : 8;
  const dynEntries = [];
  dynEntries.push([5, strBaseAddr]);                       // DT_STRTAB
  dynEntries.push([10, strtabLen]);                        // DT_STRSZ
  for (const off of libEntryOffs) dynEntries.push([1, off - strtabOff]); // DT_NEEDED
  dynEntries.push([0, 0]);                                 // DT_NULL
  const dynSize = dynEntries.length * dynEnt;
  const interpPh = { off: interp ? strEntries[0].off : 0, size: interp ? interp.length + 1 : 0 };

  // 构建程序头（先占位回填）
  const writePh = (idx, pType, offset, vaddr, filesz) => {
    const p = phdrBase + idx * phEnt;
    if (bits === 64) {
      // p_type, p_flags, p_offset, p_vaddr, p_paddr, p_filesz, p_memsz, p_align
      push64At(out, p, pType, le); push64At(out, p + 4, 0x4, le); // type + flags
      push64At(out, p + 8, offset, le); push64At(out, p + 16, vaddr, le);
      push64At(out, p + 24, vaddr, le); push64At(out, p + 32, filesz, le);
      push64At(out, p + 40, filesz, le); push64At(out, p + 48, 0x1000, le);
    } else {
      // p_type p_offset p_vaddr p_paddr p_filesz p_memsz p_flags p_align
      push32At(out, p, pType, le); push32At(out, p + 4, offset, le); push32At(out, p + 8, vaddr, le);
      push32At(out, p + 12, vaddr, le); push32At(out, p + 16, filesz, le); push32At(out, p + 20, filesz, le);
      push32At(out, p + 24, 0x4, le); push32At(out, p + 28, 0x1000, le);
    }
  };

  writePh(0, 1, 0, 0, ehSize + strtabLen + dynSize);       // PT_LOAD 覆盖全部（vaddr=off）
  writePh(1, 3, interpPh.off, interpPh.off, interpPh.size); // PT_INTERP
  writePh(2, 2, dynOff, dynOff, dynSize);                   // PT_DYNAMIC

  // strtab
  for (const e of strEntries) {
    if (e.key === "interp" && interp) out.push(...ascii(interp), 0);
    else if (e.key === "lib") out.push(...ascii(getLibAt(e)), 0);
  }
  // dyn
  for (const [tag, val] of dynEntries) {
    if (bits === 64) { pushU64(tag); pushU64(val); }
    else { pushU32(tag); pushU32(val); }
  }
  return new Uint8Array(out);

  function getLibAt(e) { return libs[libEntryOffs.indexOf(e.off)]; }
  function ascii(s) { const a = []; for (let i = 0; i < s.length; i++) a.push(s.charCodeAt(i) & 0xff); return a; }
}

/** 绝对偏移写 u64/u32（le 按序；64 位拆高低字，大端高字在前）。 */
function push64At(out, at, v, le) {
  const lo = (v % 4294967296) >>> 0, hi = (Math.floor(v / 4294967296) % 4294967296) >>> 0;
  for (let i = 0; i < 4; i++) {
    out[at + i] = le ? ((lo >>> (8 * i)) & 0xff) : ((hi >>> (8 * (3 - i))) & 0xff);
    out[at + 4 + i] = le ? ((hi >>> (8 * i)) & 0xff) : ((lo >>> (8 * (3 - i))) & 0xff);
  }
}
function push32At(out, at, v, le) {
  for (let i = 0; i < 4; i++) out[at + i] = le ? ((v >>> (8 * i)) & 0xff) : ((v >>> (8 * (3 - i))) & 0xff);
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出，CI 可抓） ============

(() => {
  // 参考单测 minimal_elf64：ELF64 x86-64 ET_EXEC entry=0x401000，无程序头
  const e1 = makeElf({});
  const out1 = elfInfoRun("", { rawBytes: e1 });
  if (!out1.includes("ELF") || !out1.includes("64") || !out1.includes("0x401000") ||
      !out1.includes("x86-64") || !out1.includes("小端") || !out1.includes("可执行")) {
    throw new Error(`elfInfo 自检①失败：\n${out1}`);
  }

  // ② 32 位大端 + 类型 core
  const e2 = makeElf({ bits: 32, le: false, type: 4, machine: 0x03, entry: 0x1000 });
  const out2 = elfInfoRun("", { rawBytes: e2 });
  if (!out2.includes("32") || !out2.includes("大端") || !out2.includes("core dump") || !out2.includes("x86")) {
    throw new Error(`elfInfo 自检②失败：\n${out2}`);
  }

  // ③ 可重定位(.o) + 依赖库
  const e3 = makeElf({ type: 1, libs: ["libc.so.6", "libm.so.6"] });
  const out3 = elfInfoRun("", { rawBytes: e3 });
  if (!out3.includes("可重定位(.o)") || !out3.includes("libc.so.6, libm.so.6")) {
    throw new Error(`elfInfo 自检③失败：\n${out3}`);
  }

  // ④ 解释器 + 共享库 isLib
  const e4 = makeElf({ type: 3, interp: "/lib64/ld-linux-x86-64.so.2", libs: ["libc.so.6"] });
  const out4 = elfInfoRun("", { rawBytes: e4 });
  if (!out4.includes("解释器：/lib64/ld-linux-x86-64.so.2") || !out4.includes("libc.so.6") ||
      !out4.includes("共享库/PIE") || !out4.includes("ET_DYN")) {
    throw new Error(`elfInfo 自检④失败：\n${out4}`);
  }

  // ⑤ 非 ELF 报错
  const out5 = elfInfoRun("", { rawBytes: new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44]) });
  if (!out5.includes("不是 ELF")) throw new Error(`elfInfo 自检⑤失败：\n${out5}`);

  // ⑥ hex 输入路径
  const hex6 = Array.from(makeElf({}), (b) => b.toString(16).padStart(2, "0")).join("");
  const out6 = elfInfoRun(hex6, {});
  if (!out6.includes("0x401000")) throw new Error(`elfInfo 自检⑥失败：\n${out6}`);

  // ⑦ 空输入提示
  const out7 = elfInfoRun("", {});
  if (!out7.includes("空输入")) throw new Error(`elfInfo 自检⑦失败：\n${out7}`);

  // ⑧ 未知机器码回退 EM_0x
  const e8 = makeElf({ machine: 0x1234 });
  const out8 = elfInfoRun("", { rawBytes: e8 });
  if (!out8.includes("EM_0x1234")) throw new Error(`elfInfo 自检⑧失败：\n${out8}`);
})();

// ============ register ============

register({
  id: "elfInfo", cat: "forensic", name: "ELF 可执行信息",
  desc: "ELF 头信息一览（格式/架构/位数/字节序/类型/入口点），并解出动态链接细节：PT_INTERP 解释器路径、DT_NEEDED 依赖库、是否共享库（ET_DYN≈.so/PIE）。拿到 ELF 先看架构/位数选引擎，再决定是否 PIE",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
  ],
  run: elfInfoRun,
  acceptsBytes: true,
});

export { elfInfoRun };