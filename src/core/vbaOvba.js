/*
 * vbaOvba.js — MS-OVBA（VBA 工程二进制格式）只读解析：dir 流记录 + 压缩容器解压。
 *
 * 适用对象：OLE/CFB 容器里的 VBA 存储（Office 97-2003 的 .doc/.xls/.ppt，
 * 以及 2007+ 的 vbaProject.bin）。**静态只读**：只解析数据结构、解压源码文本，
 * 绝不执行宏、不运行文档内任何代码（红线维持）。
 *
 * ── 权威依据 ──────────────────────────────────────────────
 *   [MS-OVBA] Office VBA File Format Structure
 *     · 2.4.1 CompressedContainer（SignatureByte 0x01 / CompressedChunk / RawChunk
 *       / TokenSequence / CopyToken）
 *     · 2.4.1.3.19.1 CopyToken Help
 *     · 2.3.4.2 dir 流记录（PROJECT* / REFERENCE* / PROJECTMODULES / MODULE 记录）
 *     · 2.4.1.3.12 CompressedChunkSize 上限 4098（含 2 字节头）
 *   官方示例：[MS-OVBA] §3.2 Compression/Decompression Examples（见 verify 脚本）
 *
 * ── 边界（如实） ──────────────────────────────────────────
 *   · 只处理 CFB 内的 VBA 存储；PowerPoint 把 VBA 放在 "PowerPoint Document" 流的
 *     PPT 记录里（需先解 PPT 记录/内嵌 OLE），不在本模块范围。
 *   · 不解析 vbaProject 的 PerformanceCache（与源码还原无关）。
 *   · 未知代码页 → 不猜、不静默按其它码页解码，只导出原始字节并显式说明。
 */
import { lossyDecoder } from "./bytesIo.js";

/* ================= 解压（[MS-OVBA] 2.4.1） ================= */

const SIGNATURE_BYTE = 0x01;
const CHUNK_SIGNATURE = 0b011;
const MAX_CHUNK_SIZE = 4098;          // 含 2 字节头
const MAX_DECOMPRESSED_CHUNK = 4096;
const COPY_TOKEN_MIN_LENGTH = 3;

/** 最小 k 使 2^k >= n（n>=1）；n<=1 时为 0。 */
function ceilLog2(n) {
  if (n <= 1) return 0;
  let k = 0;
  let v = 1;
  while (v < n) { v <<= 1; k++; }
  return k;
}

/** [MS-OVBA] 2.4.1.3.19.1 CopyToken Help → { bitCount, lengthMask, offsetMask, maxLength } */
export function copyTokenHelp(difference) {
  if (!Number.isInteger(difference) || difference < 0) {
    throw new Error("CopyToken Help：difference 必须为非负整数（收到 " + difference + "）");
  }
  const bitCount = Math.max(ceilLog2(difference), 4);
  const lengthMask = 0xFFFF >>> bitCount;
  const offsetMask = (~lengthMask) & 0xFFFF;
  return { bitCount, lengthMask, offsetMask, maxLength: (0xFFFF >>> bitCount) + COPY_TOKEN_MIN_LENGTH };
}

/**
 * 解压一个 MS-OVBA CompressedContainer。
 * 契约：任何结构性违约都**抛错并带底层原因**，绝不静默截断或回落。
 * @param {Uint8Array} container
 * @returns {Uint8Array}
 */
export function decompressContainer(container) {
  const src = container instanceof Uint8Array ? container : new Uint8Array(container || []);
  if (src.length === 0) throw new Error("CompressedContainer 为空");
  if (src[0] !== SIGNATURE_BYTE) {
    throw new Error("CompressedContainer SignatureByte 非法：0x"
      + src[0].toString(16).padStart(2, "0") + "（规范 MUST 0x01）");
  }
  const out = [];
  let cur = 1;
  let chunkIndex = 0;
  while (cur < src.length) {
    chunkIndex++;
    const chunkStart = cur;
    if (cur + 2 > src.length) {
      throw new Error("第 " + chunkIndex + " 个 CompressedChunk 头部被截断");
    }
    const header = src[cur] | (src[cur + 1] << 8);
    const size = (header & 0x0FFF) + 3;
    const signature = (header >> 12) & 0x07;
    const flag = (header >> 15) & 0x01;
    if (signature !== CHUNK_SIGNATURE) {
      throw new Error("第 " + chunkIndex + " 个 CompressedChunk 签名位 = " + signature + "（MUST 0b011）");
    }
    if (flag === 1 && size > MAX_CHUNK_SIZE) {
      throw new Error("第 " + chunkIndex + " 个 CompressedChunk Size=" + size + " > 4098 但 Flag=1");
    }
    if (flag === 0 && size !== MAX_CHUNK_SIZE) {
      throw new Error("第 " + chunkIndex + " 个 RawChunk Size=" + size + " ≠ 4098");
    }
    if (chunkStart + size > src.length) {
      throw new Error("第 " + chunkIndex + " 个 CompressedChunk 声明 Size=" + size
        + "，但容器只剩 " + (src.length - chunkStart) + " 字节");
    }
    const chunkEnd = chunkStart + size;
    cur = chunkStart + 2;

    if (flag === 0) {                                    // 2.4.1.3.3 RawChunk
      if (cur + MAX_DECOMPRESSED_CHUNK > src.length) {
        throw new Error("第 " + chunkIndex + " 个 RawChunk 载荷不足 4096 字节");
      }
      for (let i = 0; i < MAX_DECOMPRESSED_CHUNK; i++) out.push(src[cur + i]);
      cur += MAX_DECOMPRESSED_CHUNK;
      continue;
    }

    const chunkOutStart = out.length;                     // 2.4.1.3.2 CompressedChunk
    while (cur < chunkEnd) {
      const flagByte = src[cur];
      cur++;
      for (let bit = 0; bit < 8; bit++) {
        if (cur >= chunkEnd) break;
        if (!((flagByte >> bit) & 1)) {                   // 2.4.1.3.5 LiteralToken
          out.push(src[cur]);
          cur++;
          continue;
        }
        if (cur + 2 > chunkEnd) {
          throw new Error("第 " + chunkIndex + " 个 CompressedChunk 的 CopyToken 被截断");
        }
        const token = src[cur] | (src[cur + 1] << 8);
        cur += 2;
        const { bitCount, lengthMask, offsetMask } = copyTokenHelp(out.length - chunkOutStart);
        const length = (token & lengthMask) + COPY_TOKEN_MIN_LENGTH;
        const offset = ((token & offsetMask) >> (16 - bitCount)) + 1;
        const source = out.length - offset;
        if (source < chunkOutStart) {
          throw new Error("第 " + chunkIndex + " 个 CompressedChunk 的 CopyToken 越出本块起点"
            + "（offset=" + offset + "）");
        }
        for (let i = 0; i < length; i++) out.push(out[source + i]);
      }
    }
  }
  return Uint8Array.from(out);
}

/* ================= 代码页 ================= */

/** Windows 代码页 → WHATWG/TextDecoder 标签。不支持的一律返回 null（不猜）。 */
const CODEPAGE_LABEL = {
  874: "windows-874", 932: "shift_jis", 936: "gbk", 949: "euc-kr", 950: "big5",
  1250: "windows-1250", 1251: "windows-1251", 1252: "windows-1252", 1253: "windows-1253",
  1254: "windows-1254", 1255: "windows-1255", 1256: "windows-1256", 1257: "windows-1257",
  1258: "windows-1258", 1200: "utf-16le", 1201: "utf-16be", 65001: "utf-8",
};

export function codepageLabel(cp) {
  const label = CODEPAGE_LABEL[cp];
  return label || null;
}

/** 按代码页解码文本；返回 { text, replaced }（replaced = U+FFFD 个数，用于显式报告有损）。 */
export function decodeByCodepage(bytes, codepage) {
  const label = codepageLabel(codepage);
  if (!label) {
    throw new Error("代码页 " + codepage + " 无对应标准解码器，拒绝按其它码页静默解码");
  }
  const text = lossyDecoder(label).decode(bytes);
  let replaced = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xFFFD) replaced++;
  return { text, replaced };
}

/**
 * 解码 dir 记录里的文本字段。
 * 无标准解码器时**不退化为猜码页**：仅当该字段全为 ASCII（各单字节码页在 0x00-0x7F 一致，
 * 故可精确还原）才返回；含非 ASCII 字节则显式报错，交由调用方说明。
 */
function decodeTextField(bytes, codepage, field) {
  if (codepageLabel(codepage)) return decodeByCodepage(bytes, codepage).text;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] > 0x7F) {
      throw new Error("代码页 " + codepage + " 无对应标准解码器，且 " + field
        + " 含非 ASCII 字节 0x" + bytes[i].toString(16) + "，拒绝按其它码页猜解");
    }
  }
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

/* ================= dir 流解析（[MS-OVBA] 2.3.4.2） ================= */

class Reader {
  constructor(data) {
    this.d = data;
    this.p = 0;
  }
  need(n, what) {
    if (this.p + n > this.d.length) {
      throw new Error("dir 流读取 " + what + " 需要 " + n + " 字节，实际只剩 "
        + (this.d.length - this.p));
    }
  }
  u16(what) { this.need(2, what || "u16"); const v = this.d[this.p] | (this.d[this.p + 1] << 8); this.p += 2; return v; }
  u32(what) {
    this.need(4, what || "u32");
    const v = (this.d[this.p] | (this.d[this.p + 1] << 8) | (this.d[this.p + 2] << 16)
      | (this.d[this.p + 3] << 24)) >>> 0;
    this.p += 4;
    return v;
  }
  raw(n, what) {
    this.need(n, what || "bytes");
    const v = this.d.subarray(this.p, this.p + n);
    this.p += n;
    return v;
  }
}

/** 解析已解压的 dir 流。违约抛错（带原因）。 */
export function parseDirStream(dirBytes) {
  const r = new Reader(dirBytes);
  const records = [];
  const project = {};
  const references = [];
  const modules = [];

  const expect = (actual, want, name) => {
    if (actual !== want) {
      throw new Error(name + " 非法：读到 0x" + actual.toString(16) + "，MUST 0x" + want.toString(16));
    }
    records.push(name);
  };
  const text = (bytes, field) => decodeTextField(bytes, project.codepage, field);

  expect(r.u16("PROJECTSYSKIND.Id"), 0x0001, "PROJECTSYSKIND.Id");
  expect(r.u32(), 4, "PROJECTSYSKIND.Size");
  project.syskind = r.u32("SysKind");

  // 可选 PROJECTCOMPATVERSION（0x004A）：新版 Office 会插入，漏读会导致后续记录整体错位
  let nxtId = r.u16("PROJECTLCID/PROJECTCOMPATVERSION.Id");
  if (nxtId === 0x004A) {
    expect(r.u32(), 4, "PROJECTCOMPATVERSION.Size");
    project.compatVersion = r.u32("CompatVersion");
    nxtId = r.u16("PROJECTLCID.Id");
  }
  expect(nxtId, 0x0002, "PROJECTLCID.Id");
  expect(r.u32(), 4, "PROJECTLCID.Size");
  project.lcid = r.u32("Lcid");
  expect(r.u16(), 0x0014, "PROJECTLCIDINVOKE.Id");
  expect(r.u32(), 4, "PROJECTLCIDINVOKE.Size");
  project.lcidInvoke = r.u32("LcidInvoke");
  expect(r.u16(), 0x0003, "PROJECTCODEPAGE.Id");
  expect(r.u32(), 2, "PROJECTCODEPAGE.Size");
  project.codepage = r.u16("CodePage");

  expect(r.u16(), 0x0004, "PROJECTNAME.Id");
  project.name = text(r.raw(r.u32("PROJECTNAME.Size"), "ProjectName"), "PROJECTNAME");
  expect(r.u16(), 0x0005, "PROJECTDOCSTRING.Id");
  project.docString = text(r.raw(r.u32("PROJECTDOCSTRING.Size"), "DocString"), "PROJECTDOCSTRING");
  expect(r.u16(), 0x0040, "PROJECTDOCSTRING.Reserved");
  r.raw(r.u32(), "DocStringUnicode");
  expect(r.u16(), 0x0006, "PROJECTHELPFILEPATH.Id");
  r.raw(r.u32(), "HelpFile1");
  expect(r.u16(), 0x003D, "PROJECTHELPFILEPATH.Reserved");
  r.raw(r.u32(), "HelpFile2");
  expect(r.u16(), 0x0007, "PROJECTHELPCONTEXT.Id");
  expect(r.u32(), 4, "PROJECTHELPCONTEXT.Size");
  project.helpContext = r.u32("HelpContext");
  expect(r.u16(), 0x0008, "PROJECTLIBFLAGS.Id");
  expect(r.u32(), 4, "PROJECTLIBFLAGS.Size");
  project.libFlags = r.u32("ProjectLibFlags");
  expect(r.u16(), 0x0009, "PROJECTVERSION.Id");
  expect(r.u32(), 4, "PROJECTVERSION.Reserved");
  project.versionMajor = r.u32("VersionMajor");
  project.versionMinor = r.u16("VersionMinor");
  expect(r.u16(), 0x000C, "PROJECTCONSTANTS.Id");
  r.raw(r.u32(), "Constants");
  expect(r.u16(), 0x003C, "PROJECTCONSTANTS.Reserved");
  r.raw(r.u32(), "ConstantsUnicode");

  // REFERENCE* 序列，直至 PROJECTMODULES(0x000F)
  for (;;) {
    const rid = r.u16("REFERENCE.Id");
    if (rid === 0x000F) break;
    if (rid === 0x0016) {
      references.push(text(r.raw(r.u32(), "Name"), "REFERENCENAME"));
      const reserved = r.u16("REFERENCENAME.Reserved");
      if (reserved === 0x003E) r.raw(r.u32(), "NameUnicode");
      else r.p -= 2;                                    // 规范外：交回下轮判 Id
    } else if (rid === 0x0033) {
      r.raw(r.u32(), "LibidOriginal");
    } else if (rid === 0x002F) {
      r.u32("SizeTwiddled");
      r.raw(r.u32(), "LibidTwiddled");
      expect(r.u32(), 0, "REFERENCECONTROL.Reserved1");
      expect(r.u16(), 0, "REFERENCECONTROL.Reserved2");
      let reserved3 = r.u16("REFERENCECONTROL.optional");
      if (reserved3 === 0x0016) {
        r.raw(r.u32(), "NameExtended");
        reserved3 = r.u16("REFERENCECONTROL.Reserved3");
        if (reserved3 === 0x003E) {
          r.raw(r.u32(), "NameExtendedUnicode");
          reserved3 = r.u16("REFERENCECONTROL.Reserved3b");
        }
      }
      expect(reserved3, 0x0030, "REFERENCECONTROL.Reserved3");
      r.u32("SizeExtended");
      r.raw(r.u32(), "LibidExtended");
      r.u32("Reserved4");
      r.u16("Reserved5");
      r.raw(16, "OriginalTypeLib");
      r.u32("Cookie");
    } else if (rid === 0x000D) {
      r.u32("Size");
      r.raw(r.u32(), "Libid");
      r.u32("Reserved1");
      r.u16("Reserved2");
    } else if (rid === 0x000E) {
      r.u32("Size");
      r.raw(r.u32(), "LibidAbsolute");
      r.raw(r.u32(), "LibidRelative");
      r.u32("MajorVersion");
      r.u16("MinorVersion");
    } else {
      throw new Error("dir 流出现未知 REFERENCE 记录 Id=0x" + rid.toString(16)
        + "（偏移 " + (r.p - 2) + "），拒绝静默跳过");
    }
  }

  expect(r.u32(), 2, "PROJECTMODULES.Size");
  const modulesCount = r.u16("ModulesCount");
  expect(r.u16(), 0x0013, "PROJECTMODULES.ProjectCookieRecord.Id");
  expect(r.u32(), 2, "PROJECTMODULES.ProjectCookieRecord.Size");
  r.u16("ProjectCookie");

  for (let idx = 0; idx < modulesCount; idx++) {
    const mod = { index: idx };
    expect(r.u16(), 0x0019, "MODULENAME.Id");
    mod.name = text(r.raw(r.u32("MODULENAME.Size"), "ModuleName"), "MODULENAME");
    let sid = r.u16("MODULE.next");
    if (sid === 0x0047) {
      mod.nameUnicode = utf16le(r.raw(r.u32("MODULENAMEUNICODE.Size"), "NameUnicode"));
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x001A) {
      mod.streamName = text(r.raw(r.u32("MODULESTREAMNAME.Size"), "StreamName"), "MODULESTREAMNAME");
      expect(r.u16(), 0x0032, "MODULESTREAMNAME.Reserved");
      r.raw(r.u32(), "StreamNameUnicode");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x001C) {
      mod.docString = text(r.raw(r.u32("MODULEDOCSTRING.Size"), "DocString"), "MODULEDOCSTRING");
      expect(r.u16(), 0x0048, "MODULEDOCSTRING.Reserved");
      r.raw(r.u32(), "DocStringUnicode");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x0031) {
      expect(r.u32(), 4, "MODULEOFFSET.Size");
      mod.textOffset = r.u32("TextOffset");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x001E) {
      expect(r.u32(), 4, "MODULEHELPCONTEXT.Size");
      mod.helpContext = r.u32("HelpContext");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x002C) {
      expect(r.u32(), 2, "MODULECOOKIE.Size");
      r.u16("ModuleCookie");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x0021 || sid === 0x0022) {
      mod.type = sid === 0x0021 ? "procedural" : "document";
      expect(r.u32(), 0, "MODULETYPE.Reserved");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x0025) {
      mod.readOnly = true;
      expect(r.u32(), 0, "MODULEREADONLY.Reserved");
      sid = r.u16("MODULE.next");
    }
    if (sid === 0x0028) {
      mod.private = true;
      expect(r.u32(), 0, "MODULEPRIVATE.Reserved");
      sid = r.u16("MODULE.next");
    }
    if (sid !== 0x002B) {
      throw new Error("第 " + idx + " 个 MODULE 记录未以 0x002B 终止符收尾（读到 0x"
        + sid.toString(16) + "）");
    }
    expect(r.u32(), 0, "MODULE.Reserved");
    if (mod.textOffset === undefined) mod.textOffset = 0;
    if (mod.streamName === undefined) mod.streamName = mod.name;
    if (mod.type === undefined) mod.type = "procedural";
    if (mod.readOnly === undefined) mod.readOnly = false;
    if (mod.private === undefined) mod.private = false;
    modules.push(mod);
  }

  return { project, modules, references, trailing: dirBytes.length - r.p };
}

function utf16le(bytes) {
  let s = "";
  for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return s;
}

/* ================= CFB 侧装配 ================= */

/** 从目录项路径表里定位 VBA 工程：<任意存储>/VBA/dir。返回 {dirPath, vbaStorage} 或 null。 */
export function findVbaProject(paths) {
  const list = paths || [];
  for (const p of list) {
    const parts = String(p).split("/");
    if (parts.length >= 2 && parts[parts.length - 1].toLowerCase() === "dir"
      && parts[parts.length - 2].toLowerCase() === "vba") {
      // vbaStorage = 承载 dir 与各模块流的 VBA 存储（即 dirPath 的父级）
      return { dirPath: p, vbaStorage: parts.slice(0, -1).join("/") };
    }
  }
  return null;
}

/**
 * 从「路径 → 字节」的映射里抽取整个 VBA 工程（静态只读）。
 * @param {Map<string,Uint8Array>} streams 已按 CFB 解析出的流
 * @param {string[]} paths 全部对象路径（含 storage）
 * @returns {{ok:boolean, reason?:string, dirPath?:string, project?:object, modules?:Array, notes?:string[]}}
 */
export function extractVbaProject(streams, paths) {
  const found = findVbaProject(paths);
  if (!found) return { ok: false, reason: "none" };
  const dirCompressed = streams.get(found.dirPath);
  if (!dirCompressed) return { ok: false, reason: "dir 流缺失：" + found.dirPath };
  let dirBytes;
  try {
    dirBytes = decompressContainer(dirCompressed);
  } catch (err) {
    return { ok: false, reason: "dir 流解压失败（" + found.dirPath + "）：" + msgOf(err) };
  }
  let parsed;
  try {
    parsed = parseDirStream(dirBytes);
  } catch (err) {
    return { ok: false, reason: "dir 流记录解析失败：" + msgOf(err) };
  }
  const notes = [];
  if (parsed.trailing > 0) {
    notes.push("dir 流尾部有 " + parsed.trailing + " 字节未纳入记录（规范外尾随数据，已忽略）");
  }
  const label = codepageLabel(parsed.project.codepage);
  if (!label) {
    notes.push("代码页 " + parsed.project.codepage + " 无对应标准解码器：仅导出模块原始字节，不做文本解码");
  }
  const modules = [];
  for (const mod of parsed.modules) {
    const entry = {
      name: mod.name, streamName: mod.streamName, type: mod.type,
      readOnly: mod.readOnly, private: mod.private, docString: mod.docString || null,
      textOffset: mod.textOffset, extension: mod.type === "document" ? "cls" : "bas",
    };
    const key = found.vbaStorage + "/" + mod.streamName;
    const blob = streams.get(key);
    if (!blob) {
      entry.error = "模块流缺失：" + key;
      modules.push(entry);
      continue;
    }
    if (mod.textOffset > blob.length) {
      entry.error = "MODULEOFFSET=" + mod.textOffset + " 超出模块流长度 " + blob.length;
      modules.push(entry);
      continue;
    }
    let code;
    try {
      code = decompressContainer(blob.subarray(mod.textOffset));
    } catch (err) {
      entry.error = "模块源码解压失败：" + msgOf(err);
      modules.push(entry);
      continue;
    }
    entry.codeBytes = code;
    entry.codeLength = code.length;
    if (label) {
      try {
        const dec = decodeByCodepage(code, parsed.project.codepage);
        entry.text = dec.text;
        entry.replaced = dec.replaced;
        if (dec.replaced > 0) {
          entry.warning = "解码出现 " + dec.replaced + " 个替换字符（U+FFFD），源码非完整无损";
        }
      } catch (err) {
        entry.error = msgOf(err);
      }
    }
    modules.push(entry);
  }
  return {
    ok: true, dirPath: found.dirPath, vbaStorage: found.vbaStorage,
    project: parsed.project, references: parsed.references,
    dirCompressedLength: dirCompressed.length, dirLength: dirBytes.length,
    codepageLabel: label, modules, notes,
  };
}

function msgOf(err) {
  return err && err.message ? err.message : String(err);
}
