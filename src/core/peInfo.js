/*
 * peInfo.js — PE 可执行文件信息（P1 批，cat:'forensic'，单向 run）。
 *
 * 解决什么：Windows PE（.exe/.dll）头信息一眼概览——格式/架构/位数/类型
 * （EXE/DLL）/子系统/入口 RVA/镜像基址。CTF 里拿到 PE 先看架构/位数选引擎，
 * 再判断是 EXE 还是 DLL、GUI 还是控制台程序。
 *
 * 解析路径（手写 PE 结构，不用外部反编译栈）：
 * - 魔数 MZ（0x4d 0x5a）→ e_lfanew(u32@0x3c) → "PE\0\0"
 * - COFF 头(@lfanew+4)：machine / numberOfSections / sizeOfOptionalHeader /
 *   characteristics（IMAGE_FILE_DLL=0x2000 判 DLL）
 * - 可选头(@coff+20)：magic→PE32(0x10b)/PE32+(0x20b) 判位数与 imageBase 宽窄；
 *   AddressOfEntryPoint(RVA, u32@+16) / Subsystem(u16@+68) /
 *   ImageBase (PE32+ 时 u64@+24，PE32 时 u32@+28)
 * - 架构/子系统中文名照参考 bin_common（pe_machine/pe_subsystem）
 *
 * 输出：报告 = 格式/架构/位数/类型/子系统/入口(RVA)/镜像基址/节区数。
 * 参考实现 binary_info PE 分支把文本走 text、细节走 json 多端口——折进本卡
 * 点名 op 一份报告出齐（参考 p.name 在无导出目录时是 None，本卡不解析导出，
 * name 恒缺，不打印名称行）。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（inputEnc 可指定），或
 * p.rawBytes 直传（拖 PE 文件）。
 *
 * 零外发：纯字节解析。
 *
 * 回归断言：加载期自检 IIFE（含参考单测 make_minimal_pe → PE/x86/32/EXE/
 * 控制台/0x2000/0x400000；及 PE32+ 64 位/DLL/子系统分派/非 PE 报错）。
 * makePe 导出供回归脚本构造测试件（参照 make_minimal_pe 字节几何，可配
 * machine/magic/type/subsystem/entry/imageBase/numSec）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";

// ============ 基础工具 ============

const le16 = (b, o) => (b.length >= o + 2 ? b[o] | (b[o + 1] << 8) : null);
const le32 = (b, o) => {
  if (b.length < o + 4) return null;
  return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
};
const le64 = (b, o) => {
  if (b.length < o + 8) return null;
  let lo = le32(b, o), hi = le32(b, o + 4);
  return hi * 4294967296 + lo;
};

// IMAGE_FILE_MACHINE → 架构名（bin_common.pe_machine 语义）
function peMachine(m) {
  switch (m) {
    case 0x8664: return "x86-64";
    case 0x014c: return "x86";
    case 0xaa64: return "ARM64";
    case 0x01c0: return "ARM";
    case 0x01c4: return "ARM Thumb-2";
    case 0x0200: return "IA-64";
    default: return "其它(0x" + m.toString(16) + ")";
  }
}

// subsystem → 中文名（bin_common.pe_subsystem 语义）
function peSubsystem(s) {
  switch (s) {
    case 1: return "Native";
    case 2: return "Windows GUI";
    case 3: return "Windows 控制台";
    case 5: return "OS/2";
    case 7: return "POSIX";
    case 9: return "Windows CE";
    case 10: return "EFI 应用";
    case 11: return "EFI 引导驱动";
    case 12: return "EFI 运行时驱动";
    case 13: return "EFI ROM";
    case 16: return "Boot 应用";
    default: return "其它/未知";
  }
}

// ============ PE 结构 ============

function isMZ(data) {
  return data.length >= 2 && data[0] === 0x4d && data[1] === 0x5a; // MZ
}

/**
 * 解析 PE 头，返回信息对象；非 PE 返回 null。
 * 字段：arch/bits/type(EXE|DLL)/subsystem/entryRva/imageBase/isLib/numSections/magic。
 */
export function parsePeInfo(data) {
  if (!isMZ(data)) return null;
  const lf = le32(data, 0x3c); // e_lfanew
  if (lf === null || lf + 4 > data.length) return null;
  if (!(data[lf] === 0x50 && data[lf + 1] === 0x45 && data[lf + 2] === 0 && data[lf + 3] === 0)) return null; // "PE\0\0"
  const coff = lf + 4;
  if (coff + 20 > data.length) return null;
  const machine = le16(data, coff) || 0;
  const numSec = le16(data, coff + 2) || 0;
  const chars = le16(data, coff + 18) || 0;
  const opt = coff + 20;
  const magic = le16(data, opt) || 0;
  const is64 = magic === 0x20b || machine === 0x8664; // PE32+ 或 x86-64
  const entryRva = le32(data, opt + 16) || 0;
  const subsystem = le16(data, opt + 68) || 0;
  let imageBase = 0;
  if (magic === 0x20b) imageBase = le64(data, opt + 24) || 0;
  else imageBase = le32(data, opt + 28) || 0;
  const isLib = (chars & 0x2000) !== 0; // IMAGE_FILE_DLL
  return {
    arch: peMachine(machine), bits: is64 ? 64 : 32,
    type: isLib ? "DLL" : "EXE", subsystem: peSubsystem(subsystem),
    entryRva, imageBase, isLib, numSections: numSec, magic,
  };
}

// ============ op run ============

function peInfoRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入 PE 可执行文件（.exe/.dll）或粘贴 hex / base64 字节。";
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { return "输入解析失败：" + (e && e.message ? e.message : String(e)); }

  const info = parsePeInfo(data);
  if (!info) {
    return `不是 MZ/PE 可执行文件（缺 MZ 头或 PE\0\0 签名），输入 ${data.length} 字节。`;
  }
  const lines = [];
  lines.push("格式：PE");
  lines.push(`架构：${info.arch}`);
  lines.push(`位数：${info.bits}`);
  lines.push(`类型：${info.type}`);
  lines.push(`子系统：${info.subsystem}`);
  lines.push(`入口(RVA)：0x${info.entryRva.toString(16)}`);
  lines.push(`镜像基址：0x${info.imageBase.toString(16)}`);
  lines.push(`节区：${info.numSections} 个`);
  return lines.join("\n");
}

// ============ 测试构造器（供回归脚本） ============

/**
 * 构造最小 PE（字节几何照参考 make_minimal_pe：0x600 缓冲，e_lfanew=0x80，
 * COFF@0x84，可选头@0x98=coff+20，节区表@opt+0xe0）。
 * opts: { machine=0x14c, magic(自动按位数), type='EXE'|'DLL', subsystem=3,
 * entry=0x2000, imageBase=0x400000, numSec=2 }
 * machine 决定位数/PE 格式：0x8664→64 位 PE32+(0x20b)，其余 32 位 PE32(0x10b)。
 */
export function makePe(o = {}) {
  const oo = o || {};
  const machine = oo.machine ?? 0x14c;
  const is64 = machine === 0x8664;
  const magic = oo.magic ?? (is64 ? 0x20b : 0x10b);
  const isLib = (oo.type || "EXE") === "DLL";
  const subsystem = oo.subsystem ?? 3;
  const entry = oo.entry ?? 0x2000;
  const imageBase = oo.imageBase ?? 0x400000;
  const numSec = oo.numSec ?? 2;

  const pe = new Uint8Array(0x600);
  const w16 = (at, v) => { pe[at] = v & 0xff; pe[at + 1] = (v >>> 8) & 0xff; };
  const w32 = (at, v) => { let x = v >>> 0; for (let i = 0; i < 4; i++) { pe[at + i] = x & 0xff; x >>>= 8; } };
  const w64 = (at, v) => {
    let lo = (v % 4294967296) >>> 0, hi = (Math.floor(v / 4294967296) % 4294967296) >>> 0;
    w32(at, lo); w32(at + 4, hi);
  };

  pe[0] = 0x4d; pe[1] = 0x5a; // "MZ"
  w32(0x3c, 0x80); // e_lfanew
  pe[0x80] = 0x50; pe[0x81] = 0x45; pe[0x82] = 0; pe[0x83] = 0; // "PE\0\0"
  const coff = 0x84;
  w16(coff, machine);
  w16(coff + 2, numSec);
  w16(coff + 16, 0xe0); // SizeOfOptionalHeader
  w16(coff + 18, (isLib ? 0x2000 : 0) | 0x010f); // Characteristics (+DLL bit)

  const opt = coff + 20;
  w16(opt, magic);
  w32(opt + 16, entry);          // AddressOfEntryPoint
  w32(opt + 20, 0x1000);         // BaseOfCode
  if (magic === 0x20b) w64(opt + 24, imageBase); // PE32+ 镜像基址(u64)
  else { w32(opt + 8, 0); w32(opt + 12, 0); w32(opt + 20, 0x1000); w32(opt + 24, 0x1000); w32(opt + 28, imageBase); } // PE32 镜像基址(u32)
  w32(opt + 32, 0x1000);         // SectionAlignment
  w32(opt + 36, 0x200);          // FileAlignment
  w32(opt + 60, 0x200);          // SizeOfHeaders
  w16(opt + 68, subsystem);      // Subsystem
  w32(opt + 92, 16);             // NumberOfRvaAndSizes

  // 节区表（与参考同几何：.text / .data 各 40 字节）
  const sec = opt + 0xe0;
  const names = [".text\0\0\0", ".data\0\0\0"];
  const secMeta = [
    { size: [0x1000, 0x1000], off: [0x200, 0x200], ch: 0x60000020 },
    { size: [0x1000, 0x2000], off: [0x200, 0x400], ch: 0xe0000020 },
  ];
  for (let i = 0; i < numSec && i < 2; i++) {
    const s = sec + i * 40;
    for (let k = 0; k < 8; k++) pe[s + k] = names[i].charCodeAt(k);
    w32(s + 8, secMeta[i].size[0]);
    w32(s + 12, secMeta[i].size[1]);
    w32(s + 16, secMeta[i].off[0]);
    w32(s + 20, secMeta[i].off[1]);
    w32(s + 36, secMeta[i].ch);
  }
  for (let i = 0; i < 0x200; i++) pe[0x400 + i] = (i * 37) & 0xff;
  return pe;
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出，CI 可抓） ============

(() => {
  // ① 参考单测 make_minimal_pe：x86 32 位 EXE 控制台，entry=0x2000 镜像 0x400000
  const p1 = makePe({});
  const out1 = peInfoRun("", { rawBytes: p1 });
  if (!out1.includes("格式：PE") || !out1.includes("x86") || !out1.includes("32") ||
      !out1.includes("EXE") || !out1.includes("Windows 控制台") ||
      !out1.includes("0x2000") || !out1.includes("0x400000") || !out1.includes("节区：2")) {
    throw new Error(`peInfo 自检①失败：\n${out1}`);
  }

  // ② 64 位 PE32+（x86-64，镜像基址超 32 位）
  const p2 = makePe({ machine: 0x8664, imageBase: 0x140000000, entry: 0x1000 });
  const out2 = peInfoRun("", { rawBytes: p2 });
  if (!out2.includes("x86-64") || !out2.includes("64") ||
      !out2.includes("0x140000000") || !out2.includes("0x1000")) {
    throw new Error(`peInfo 自检②失败：\n${out2}`);
  }

  // ③ DLL 类型
  const p3 = makePe({ type: "DLL" });
  const out3 = peInfoRun("", { rawBytes: p3 });
  if (!out3.includes("类型：DLL")) throw new Error(`peInfo 自检③失败：\n${out3}`);

  // ④ 子系统分派（GUI / Boot）
  const out4 = peInfoRun("", { rawBytes: makePe({ subsystem: 2 }) });
  if (!out4.includes("Windows GUI")) throw new Error(`peInfo 自检④-GUI失败：\n${out4}`);
  const out4b = peInfoRun("", { rawBytes: makePe({ subsystem: 16 }) });
  if (!out4b.includes("Boot 应用")) throw new Error(`peInfo 自检④-Boot失败：\n${out4b}`);

  // ⑤ 机器码分派（ARM64 / 未知回退）
  const out5 = peInfoRun("", { rawBytes: makePe({ machine: 0xaa64 }) });
  if (!out5.includes("ARM64") || !out5.includes("64")) throw new Error(`peInfo 自检⑤失败：\n${out5}`);
  const out5b = peInfoRun("", { rawBytes: makePe({ machine: 0x1234 }) });
  if (!out5b.includes("其它(0x1234)")) throw new Error(`peInfo 自检⑤-未知失败：\n${out5b}`);

  // ⑥ 非 PE（MZ 但无签名 / 完全非 MZ）
  const bad1 = new Uint8Array([0x4d, 0x5a, 0, 0, 0, 0]);
  if (!peInfoRun("", { rawBytes: bad1 }).includes("不是 MZ/PE")) throw new Error(`peInfo 自检⑥失败`);
  const bad2 = new Uint8Array([0x00, 0x11, 0x22, 0x33]);
  if (!peInfoRun("", { rawBytes: bad2 }).includes("不是 MZ/PE")) throw new Error(`peInfo 自检⑥b失败`);

  // ⑦ hex 输入路径
  const hex7 = Array.from(makePe({}), (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
  if (!peInfoRun(hex7, {}).includes("0x2000")) throw new Error(`peInfo 自检⑦失败`);

  // ⑧ 空输入提示
  if (!peInfoRun("", {}).includes("空输入")) throw new Error(`peInfo 自检⑧失败`);
})();

// ============ register ============

register({
  id: "peInfo", cat: "forensic", name: "PE 可执行信息",
  desc: "Windows PE（.exe/.dll）头信息一览（架构/位数/类型 EXE|DLL/子系统/入口 RVA/镜像基址）。拿到 PE 先看架构/位数选引擎，再判断 EXE 还是 DLL、GUI 还是控制台",
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
  run: peInfoRun,
  acceptsBytes: true,
});

export { peInfoRun };