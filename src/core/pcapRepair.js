/*
 * pcapRepair.js — pcap 文件修复（cat:'analysis'，run 型单向诊断+修复）。
 *
 * 定位：CTF 流量题里 pcap 常被出题人故意损坏——改坏 magic、抹掉全局头
 * record 头 incl_len 写错致后续包全错位、字节序标记与实际不符。本 op 做
 * 静态诊断 + 尽力修复，输出修复后 pcap 的 hex（可再喂给 pcapParse 解析）。
 *
 * 覆盖的损坏类型：
 * 1. **magic 损坏/缺失**：24 字节全局头 magic 不是四种合法值之一 →
 * 按后续 record 头合理性反推正确 magic + 字节序，重写。
 * 2. **全局头整体缺失**：数据直接从 record 头开始（无 24 字节头）→
 * 探测首个 record 头合理性，补一个标准全局头（magic a1b2c3d4 / snaplen 65535 / DLT 1）。
 * 3. **record incl_len 异常**：incl_len 超出剩余字节 / incl_len > orig_len 太多 /
 * = 0 → 标记并尝试用后续可识别帧边界重新分包（保守：仅诊断，给出异常包位置）。
 * 4. **字节序标记与内容不符**：magic 说 BE 但 record 头数值明显是 LE（或反之）→
 * 按 record 头数值合理性判断真字节序，改 magic。
 * 5. **snaplen 为 0 或异常**：修为 65535。
 * 6. **version 异常**：修为 2.4（major=2 minor=4）。
 *
 * 修复策略（保守）：
 * - 只改全局头（magic/version/snaplen/DLT）与明显越界的 incl_len，不删/不重排包体。
 * - incl_len 越界时截断到剩余字节；incl_len=0 时用 orig_len（若合理）或跳过标记。
 * - 无法确定时只诊断不猜，避免越修越坏。
 *
 * 契约：件内自注册，只 import { register } from "./registry.js"。
 * run(text, p) 单向，输入 hex/base64/auto，输出诊断报告 + 修复后 hex。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 *
 * 格式参考（照 libpcap 规范，不编造）：
 * - 全局头 24 字节：magic(4) version_major(2) version_minor(2) thiszone(4)
 * sigfigs(4) snaplen(4) network/DLT(4)
 * - record 头 16 字节：ts_sec(4) ts_usec(4) incl_len(4) orig_len(4)
 * - magic: a1b2c3d4(LE μs) / d4c3b2a1(BE μs) / a1b2cd34(LE ns) / 34cd b2a1(BE ns)
 */
import { register } from "./registry.js";

// ---- 输入 → 字节（hex / base64 / auto） ----
function isHexStr(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function parseInput(text, enc) {
  const s = String(text == null ? "" : text).trim();
  if (!s) return new Uint8Array(0);
  const stripped = s.replace(/\s/g, "");
  if (enc === "hex") return hexToBytes(stripped);
  if (enc === "base64") return b64ToBytes(s);
 // auto
  if (isHexStr(stripped)) return hexToBytes(stripped);
  return b64ToBytes(s);
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

// ---- 整数读写（按字节序） ----
function u32(b, i, le) {
  return le
    ? ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0
    : (((b[i] * 0x1000000) >>> 0) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
function u16(b, i, le) {
  return le ? (b[i] | (b[i + 1] << 8)) >>> 0 : ((b[i] << 8) | b[i + 1]) >>> 0;
}
function w32(b, i, v, le) {
  if (le) { b[i] = v & 0xff; b[i + 1] = (v >>> 8) & 0xff; b[i + 2] = (v >>> 16) & 0xff; b[i + 3] = (v >>> 24) & 0xff; }
  else { b[i] = (v >>> 24) & 0xff; b[i + 1] = (v >>> 16) & 0xff; b[i + 2] = (v >>> 8) & 0xff; b[i + 3] = v & 0xff; }
}
function w16(b, i, v, le) {
  if (le) { b[i] = v & 0xff; b[i + 1] = (v >>> 8) & 0xff; }
  else { b[i] = (v >>> 8) & 0xff; b[i + 1] = v & 0xff; }
}

// magic 四种合法值（首字节序列）→ {le, nano}
// 键 = 文件首 4 字节的磁盘十六进制（toHex(b.subarray(0, 4))）。
// libpcap savefile(5)：magic 值 0xa1b2c3d4 按本机字节序写盘 —— LE 文件磁盘字节为 d4 c3 b2 a1
//（与 pcapParse 的 u32le 判定、tcpdump/Wireshark 实盘一致），BE 文件为 a1 b2 c3 d4。
const MAGICS = {
  "a1b2c3d4": { le: false, nano: false, name: "BE 微秒" },
  "d4c3b2a1": { le: true, nano: false, name: "LE 微秒 (标准 tcpdump)" },
  "a1b2cd34": { le: false, nano: true, name: "BE 纳秒" },
  "34cdb2a1": { le: true, nano: true, name: "LE 纳秒" },
};

const GLOBAL_HDR_LEN = 24;
const REC_HDR_LEN = 16;

// ============================================================
// pcapng 块级保守修复（规范：draft-tuexen-opsawg-pcapng）
// 块布局：Block Type(4) + Block Total Length(4) + Body + Block Total Length(4)
// 长度含全部四个字段、4 字节对齐、最小 12。SHB 的 BOM(偏移 8)=0x1A2B3C4D 定字节序。
// 修复只做有证据的六类；歧义只诊断不补造：
// R1 SHB BOM 损毁（magic 完好）：按块链在两种字节序下的可解性重写 BOM（两种都通=歧义→只诊断）
// R2 SHB magic 损毁（BOM/长度字段完好）：重写 0A0D0D0A
// R3 SHB 整体缺失（数据从 IDB/EPB 等块开始）：前插 28 字节标准 SHB（v1.0 / section_len 未指定；
//    原头部选项无从恢复 → 只保证修后可解析，不承诺逐字节还原）
// R4 尾部长度与首部长度不符：链按首部长度走得通 → 重写尾部
// R5 首部长度损毁/链断裂：扫描自洽尾长度（值==块跨度 且 下一块类型已知/EOF）唯一 → 重写首部
// R6 长度非 4 字节对齐：同 R5 重同步；不唯一 → 只诊断
// ============================================================
const PCAPNG_SHB = 0x0a0d0d0a;
const PCAPNG_BLOCK_NAMES = {
  0x0a0d0d0a: "SHB(节头)", 0x00000001: "IDB(接口)", 0x00000003: "SPB(简单包)",
  0x00000004: "NRB(名字)", 0x00000005: "ISB(统计)", 0x00000006: "EPB(增强包)",
  0x00000007: "CFB(过滤)", 0x0000000a: "DSB(解密)",
};
const isKnownBlockType = (t) => Object.prototype.hasOwnProperty.call(PCAPNG_BLOCK_NAMES, t);

/** pcapng 块链遍历：返回 {blocks, issues, endOff, trailing}。不修改输入。 */
function walkPcapngBlocks(b, le, start) {
  const blocks = [], issues = [];
  let off = start;
  while (off + 12 <= b.length) {
    const type = u32(b, off, le);
    const len1 = u32(b, off + 4, le);
    if (len1 < 12 || len1 % 4 !== 0 || off + len1 > b.length) {
      issues.push({ off, kind: "chain-break", type, len1 });
      break;
    }
    const len2 = u32(b, off + len1 - 4, le);
    if (len2 !== len1) issues.push({ off, kind: "trail-mismatch", len1, len2 });
    if (!isKnownBlockType(type)) issues.push({ off, kind: "unknown-type", type });
    blocks.push({ off, type, len: len1 });
    off += len1;
  }
  return { blocks, issues, endOff: off, trailing: b.length - off };
}

/** 链评分：块数为主，类型全已知/无 issue 加权（用于字节序推断）。 */
function scorePcapngWalk(w) {
  let s = w.blocks.length * 10;
  if (w.issues.length === 0 && w.trailing === 0) s += 5;
  for (const blk of w.blocks) if (isKnownBlockType(blk.type)) s += 2;
  return s;
}

/** 前插标准 SHB（28 字节，LE/BE 按参数）。 */
function makeStandardShb(le) {
  const h = new Uint8Array(28);
  w32(h, 0, PCAPNG_SHB, le);
  w32(h, 4, 28, le);
  w32(h, 8, 0x1a2b3c4d, le); // BOM
  w16(h, 12, 1, le);         // major
  w16(h, 14, 0, le);         // minor
  // 16..23 section_length = -1（未指定）→ 全 0xFF
  for (let i = 16; i < 24; i++) h[i] = 0xff;
  w32(h, 24, 28, le);
  return h;
}

function isPcapngShbMagic(b) {
  return b.length >= 12 && b[0] === 0x0a && b[1] === 0x0d && b[2] === 0x0d && b[3] === 0x0a;
}
function bomEndian(b) {
  // BOM=0x1A2B3C4D：LE 存 4D 3C 2B 1A；BE 存 1A 2B 3C 4D
  if (b[8] === 0x4d && b[9] === 0x3c && b[10] === 0x2b && b[11] === 0x1a) return true;  // LE
  if (b[8] === 0x1a && b[9] === 0x2b && b[10] === 0x3c && b[11] === 0x4d) return false; // BE
  return null;
}
/** 无 SHB 的 pcapng 疑似：首块类型已知（非 SHB）且某字节序下整链干净走完（无 issue/无残留）。
 *  整链干净的证据强于经典 record 链的碰巧可解 ⇒ 命中即按 pcapng 处理（两种字节序都干净=歧义→不认）。 */
function pcapngNoShbCandidate(b) {
  let clean = 0;
  for (const le of [true, false]) {
    const t = u32(b, 0, le);
    if (t === PCAPNG_SHB || !isKnownBlockType(t)) continue;
    const w = walkPcapngBlocks(b, le, 0);
    if (w.blocks.length >= 1 && w.issues.length === 0 && w.trailing === 0) clean++;
  }
  return clean === 1;
}

function pcapngRepairRun(b) {
  const L = [];
  L.push("=== pcapng 块级修复 ===");
  L.push("");
  const fixes = [];
  let out = Uint8Array.from(b);
  let le = null;

  // ---- 入口判定 ----
  const shbMagic = isPcapngShbMagic(out);
  if (shbMagic) {
    const bom = bomEndian(out);
    if (bom !== null) {
      le = bom;
      L.push("● SHB magic + BOM 完好（" + (le ? "LE" : "BE") + "）");
    } else {
      L.push("⚠ SHB BOM 非法（偏移 8 非两种合法 BOM 之一）→ 按块链推断字节序");
      const wLE = walkPcapngBlocks(out, true, 28);
      const wBE = walkPcapngBlocks(out, false, 28);
      const sLE = scorePcapngWalk(wLE), sBE = scorePcapngWalk(wBE);
      if (sLE === sBE) {
        L.push("  ✗ 两种字节序可解性相同（评分 " + sLE + " vs " + sBE + "）→ 无法确定，只诊断不补造。");
        return { text: L.join("\n"), hex: null };
      }
      le = sLE > sBE;
      w32(out, 8, 0x1a2b3c4d, le);
      fixes.push("SHB BOM 重写为 " + (le ? "LE" : "BE") + "（块链评分 " + sLE + " vs " + sBE + "）");
    }
  } else {
    // SHB magic 不符：区分「magic 损毁但 28B SHB 仍在」与「SHB 整体缺失」
    const len28le = out.length >= 28 && u32(out, 4, true) === 28 && bomEndian(out) !== null;
    const len28be = out.length >= 28 && u32(out, 4, false) === 28 && bomEndian(out) !== null;
    if (len28le || len28be) {
      le = bomEndian(out);
      const bad = Array.from(out.subarray(0, 4)).map((x) => x.toString(16).padStart(2, "0")).join("");
      for (let i = 0; i < 4; i++) out[i] = [0x0a, 0x0d, 0x0d, 0x0a][i];
      fixes.push("SHB magic 损坏（原 " + bad + "）→ 重写 0A0D0D0A（BOM/长度字段完好为证）");
      L.push("● 检出 28 字节 SHB（BOM 完好，" + (le ? "LE" : "BE") + "），magic 损坏");
    } else if (pcapngNoShbCandidate(out)) {
      const wLE = walkPcapngBlocks(out, true, 0);
      const wBE = walkPcapngBlocks(out, false, 0);
      const sLE = scorePcapngWalk(wLE), sBE = scorePcapngWalk(wBE);
      le = sLE >= sBE ? true : false;
      if (sLE === sBE) {
        L.push("⚠ 无 SHB 且两种字节序可解性相同 → 按常见 LE 前插（字节序存疑，仅恢复可解析性）");
      }
      const shb = makeStandardShb(le);
      const merged = new Uint8Array(shb.length + out.length);
      merged.set(shb, 0);
      merged.set(out, shb.length);
      out = merged;
      fixes.push("SHB 整体缺失 → 前插 28 字节标准 SHB（v1.0 / section_len 未指定；原头选项无从恢复）");
      L.push("● 无 SHB：数据从已知块类型开始 → 前插标准 SHB（" + (le ? "LE" : "BE") + "）");
    } else {
      L.push("✗ 既非经典 pcap 也非可辨认 pcapng（首块类型未知）。");
      L.push("  可能损坏过重或非抓包文件。");
      return { text: L.join("\n"), hex: null };
    }
  }

  // ---- 块级修复循环：trail-mismatch / chain-break 重同步 ----
  for (let round = 0; round < 64; round++) {
    const w = walkPcapngBlocks(out, le, 0);
    const bad = w.issues.find((i) => i.kind === "chain-break" || i.kind === "trail-mismatch");
    if (!bad) break;
    const off = bad.off;
   // 自洽候选：e 满足 值@e-4 == e-off 且 e=EOF 或 e 处是合法块开头（类型已知+长度合理）
    const cands = [];
    for (let e = off + 12; e <= out.length; e += 4) {
      const t = u32(out, e - 4, le);
      if (t !== e - off) continue;
      if (e === out.length || (e + 12 <= out.length && isKnownBlockType(u32(out, e, le)) && u32(out, e + 4, le) >= 12 && u32(out, e + 4, le) % 4 === 0)) {
        cands.push(e - off);
      }
    }
   // 首部落点是否为合法块界（链证据）
    const len1 = u32(out, off + 4, le);
    const leadingConsistent = off + len1 <= out.length && (off + len1 === out.length ||
      (off + len1 + 12 <= out.length && isKnownBlockType(u32(out, off + len1, le)) && u32(out, off + len1 + 4, le) >= 12 && u32(out, off + len1 + 4, le) % 4 === 0));
    if (cands.length === 1 && cands[0] !== len1) {
     // R5/R6：尾部长度完好自洽且唯一 → 首部是撒谎者（含非对齐/越界）
      w32(out, off + 4, cands[0], le);
      fixes.push("块 @" + off + " 首部长度 " + len1 + " 损毁（自洽尾长度唯一）→ 重写为 " + cands[0]);
    } else if (bad.kind === "trail-mismatch" && leadingConsistent && cands.length === 0) {
     // R4：首部落点合法且无自洽替代 → 尾部是撒谎者
      w32(out, off + len1 - 4, len1, le);
      fixes.push("块 @" + off + " 尾部长度 " + bad.len2 + " 与首部 " + len1 + " 不符 → 重写为 " + len1);
    } else {
      L.push("⚠ 块 @" + off + " 长度证据冲突（现值 " + len1 + "，自洽候选 " + JSON.stringify(cands) + "，首部落点" + (leadingConsistent ? "合法" : "非法") + "）→ 无法唯一确定，只诊断。");
      break;
    }
  }

  // ---- 终检 + 统计 ----
  const w = walkPcapngBlocks(out, le, 0);
  const cnt = {};
  let ifaces = 0, packets = 0, epbUnknownIfaces = 0;
  const ifaceSet = new Set();
  for (const blk of w.blocks) {
    const name = PCAPNG_BLOCK_NAMES[blk.type] || ("未知(0x" + blk.type.toString(16) + ")");
    cnt[name] = (cnt[name] || 0) + 1;
    if (blk.type === 0x00000001) { ifaces++; ifaceSet.add(blk.off); }
    if (blk.type === 0x00000006) {
      packets++;
      if (blk.len >= 28) {
        const ifid = u32(out, blk.off + 8, le);
        if (ifid >= ifaces) epbUnknownIfaces++;
      }
    }
    if (blk.type === 0x00000003) packets++;
  }
  L.push("");
  L.push("● 字节序: " + (le ? "LE" : "BE") + "，块数 " + w.blocks.length + "（接口 " + ifaces + " / 包块 " + packets + "）");
  for (const [k, v] of Object.entries(cnt)) L.push("  " + k + " × " + v);
  if (epbUnknownIfaces) L.push("⚠ " + epbUnknownIfaces + " 个 EPB 引用不存在的接口号（多节/损坏，仅提示）");
  if (w.trailing > 0) L.push("⚠ 末尾残留 " + w.trailing + " 字节非完整块（截断残留；保守不动，解析器会忽略）");
  if (w.issues.length === 0 && w.trailing === 0) L.push("✓ 块链完整自洽");
  L.push("");
  if (fixes.length) {
    L.push("--- 已修复 " + fixes.length + " 处 ---");
    fixes.forEach((f, i) => L.push("  " + (i + 1) + ". " + f));
  } else {
    L.push("✓ 无需修复。");
  }
  return { text: L.join("\n"), hex: toHex(out), repaired: out, ok: w.issues.length === 0 };
}

// 判断从 off 起的 16 字节 record 头在给定字节序下是否"合理"
// 合理 = incl_len 在 (0, 剩余字节] 且 incl_len <= orig_len 且 orig_len < 262144(256KB)
function recordPlausible(b, off, le) {
  if (off + REC_HDR_LEN > b.length) return false;
  const incl = u32(b, off + 8, le);
  const orig = u32(b, off + 12, le);
  const remain = b.length - off - REC_HDR_LEN;
  if (incl === 0) return false;
  if (incl > remain) return false;
  if (orig < incl) return false;            // orig_len 不能小于 incl_len
  if (orig > 262144) return false;          // 单包 256KB 上限（经验）
  return true;
}

// 沿 record 链走一遍，统计能连续解析的包数（用于字节序/头判定打分）
function walkRecords(b, start, le) {
  let off = start, count = 0, anomalies = [];
  while (off + REC_HDR_LEN <= b.length) {
    const incl = u32(b, off + 8, le);
    const orig = u32(b, off + 12, le);
    const remain = b.length - off - REC_HDR_LEN;
    if (incl === 0) { anomalies.push({ off, type: "incl_len=0", incl, orig }); break; }
    if (incl > remain) {
      anomalies.push({ off, type: "incl_len 越界", incl, orig, remain });
      count++; // 末包截断，仍算一个
      break;
    }
    if (orig < incl) anomalies.push({ off, type: "orig_len<incl_len", incl, orig });
    count++;
    off += REC_HDR_LEN + incl;
  }
  return { count, anomalies, endOff: off };
}

function pcapRepairRun(text, p) {
  const enc = (p && p.inputEnc) || "auto";
  const L = [];
  L.push("=== pcap 文件修复 ===");
  L.push("");

  let b;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    b = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : parseInput(text, enc);
  }
  catch (e) { return "✗ 输入解析失败: " + (e.message || String(e)); }

  if (b.length < REC_HDR_LEN) {
    L.push("✗ 数据太短（" + b.length + " 字节），不足以判断 pcap 结构。");
    return L.join("\n");
  }

 // ---- pcapng 分派 ----
 // 优先级：①SHB magic 完好（0A0D0D0A 回文，两字节序同形）→ pcapng
 //       ②SHB magic 损毁但证据在（块长=28 且 BOM 合法）→ pcapng
 //       ③无 SHB 但已知块整链干净走完 → pcapng（证据强于经典链碰巧可解）
  const damagedShb = !isPcapngShbMagic(b) && b.length >= 28 && (u32(b, 4, true) === 28 || u32(b, 4, false) === 28) && bomEndian(b) !== null;
  if (isPcapngShbMagic(b) || damagedShb || pcapngNoShbCandidate(b)) {
    const r = pcapngRepairRun(b);
    L.length = 0;
    L.push(r.text);
    if (r.hex !== null) {
      L.push("");
      L.push("--- 修复后 pcapng（hex，可复制喂给 pcapParse/pcapng 解析器）---");
      L.push(r.hex.length > 200000 ? r.hex.slice(0, 200000) + "\n…(hex 过长已截断，实际 " + (r.hex.length / 2) + " 字节)" : r.hex);
    }
    return L.join("\n");
  }

  const fixes = [];
  let out = Uint8Array.from(b); // 工作副本
  let dataStart;                // record 区起点

 // ---- 1. 检查全局头 magic ----
  const magicHex = toHex(b.subarray(0, 4));
  let known = MAGICS[magicHex];

  if (known) {
    L.push("● 全局头 magic: " + magicHex + "（" + known.name + "）");
 // 校验 magic 声明的字节序下 record 链是否合理；不合理则可能字节序标记造假
    const le = known.le;
    const walkAsIs = walkRecords(b, GLOBAL_HDR_LEN, le);
    const walkFlip = walkRecords(b, GLOBAL_HDR_LEN, !le);
    if (walkFlip.count > walkAsIs.count && walkAsIs.count <= 1) {
 // 字节序标记与内容不符 → 翻转 magic
      const flipHex = Object.keys(MAGICS).find((k) => MAGICS[k].le === !le && MAGICS[k].nano === known.nano);
      const fb = hexToBytes(flipHex);
      for (let i = 0; i < 4; i++) out[i] = fb[i];
      fixes.push("magic 字节序与内容不符：record 链在 " + (le ? "BE" : "LE") + " 下能解 " + walkFlip.count + " 包、" + (le ? "LE" : "BE") + " 下仅 " + walkAsIs.count + " 包 → magic 改为 " + flipHex);
      known = MAGICS[flipHex];
    }
    dataStart = GLOBAL_HDR_LEN;
  } else {
 // magic 不合法 → 两种可能：magic 被改坏（仍有 24 字节头）/ 全局头整体缺失
    L.push("⚠ 全局头 magic 非法: " + magicHex + "（不是四种合法 pcap magic）");
 // 情形 A：假设有 24 字节头但 magic 坏，探测 GLOBAL_HDR_LEN 起 record 合理性
    const aLE = recordPlausible(b, GLOBAL_HDR_LEN, true);
    const aBE = recordPlausible(b, GLOBAL_HDR_LEN, false);
 // 情形 B：假设无全局头，数据从 0 直接是 record 头
    const bLE = recordPlausible(b, 0, true);
    const bBE = recordPlausible(b, 0, false);

    const walkA_LE = aLE ? walkRecords(b, GLOBAL_HDR_LEN, true).count : 0;
    const walkA_BE = aBE ? walkRecords(b, GLOBAL_HDR_LEN, false).count : 0;
    const walkB_LE = bLE ? walkRecords(b, 0, true).count : 0;
    const walkB_BE = bBE ? walkRecords(b, 0, false).count : 0;

    const cands = [
      { key: "A_LE", score: walkA_LE, hasHdr: true, le: true },
      { key: "A_BE", score: walkA_BE, hasHdr: true, le: false },
      { key: "B_LE", score: walkB_LE, hasHdr: false, le: true },
      { key: "B_BE", score: walkB_BE, hasHdr: false, le: false },
    ].sort((x, y) => y.score - x.score);
    const best = cands[0];

    if (best.score === 0) {
      L.push("✗ 无法识别 record 结构（四种假设下均解不出合理包头）。");
      L.push("  可能：非 pcap 格式 / 损坏过重 / 实为 pcapng（块结构，用 pcapParse 试）。");
      L.push("");
      L.push("四假设 record 头合理性：");
      L.push("  有24字节头+LE=" + aLE + " / +BE=" + aBE + " / 无头+LE=" + bLE + " / 无头+BE=" + bBE);
      return L.join("\n");
    }

    const goodMagic = Object.keys(MAGICS).find((k) => MAGICS[k].le === best.le && !MAGICS[k].nano);
    if (best.hasHdr) {
 // 有 24 字节头，magic 坏 → 只重写 magic
      const gm = hexToBytes(goodMagic);
      for (let i = 0; i < 4; i++) out[i] = gm[i];
      fixes.push("magic 损坏 → 按 record 链最优（" + (best.le ? "LE" : "BE") + "，解出 " + best.score + " 包）重写为 " + goodMagic);
      dataStart = GLOBAL_HDR_LEN;
    } else {
 // 全局头整体缺失 → 前插 24 字节标准全局头
      const hdr = new Uint8Array(GLOBAL_HDR_LEN);
      const gm = hexToBytes(goodMagic);
      hdr.set(gm, 0);
      w16(hdr, 4, 2, best.le); // major
      w16(hdr, 6, 4, best.le); // minor
 // thiszone=0 sigfigs=0（保持 0）
      w32(hdr, 16, 65535, best.le); // snaplen
      w32(hdr, 20, 1, best.le);     // DLT=1 (Ethernet)
      const merged = new Uint8Array(GLOBAL_HDR_LEN + b.length);
      merged.set(hdr, 0);
      merged.set(b, GLOBAL_HDR_LEN);
      out = merged;
      fixes.push("全局头整体缺失 → 前插 24 字节标准头（magic " + goodMagic + " / ver 2.4 / snaplen 65535 / DLT 1 Ethernet；解出 " + best.score + " 包）");
      dataStart = GLOBAL_HDR_LEN;
      known = MAGICS[goodMagic];
    }
  }

 // ---- 2. 全局头字段体检（在确定字节序后）----
  const le = known ? known.le : true;
  if (out.length >= GLOBAL_HDR_LEN) {
    const major = u16(out, 4, le);
    const minor = u16(out, 6, le);
    if (major !== 2 || minor !== 4) {
      L.push("⚠ version = " + major + "." + minor + "（标准应为 2.4）");
      w16(out, 4, 2, le); w16(out, 6, 4, le);
      fixes.push("version " + major + "." + minor + " → 2.4");
    }
    const snaplen = u32(out, 16, le);
    if (snaplen === 0 || snaplen > 0x400000) {
      L.push("⚠ snaplen = " + snaplen + "（异常，0 或 >4MB）");
      w32(out, 16, 65535, le);
      fixes.push("snaplen " + snaplen + " → 65535");
    } else {
      L.push("● snaplen = " + snaplen);
    }
    const dlt = u32(out, 20, le);
    L.push("● 链路类型 DLT = " + dlt + (dlt === 1 ? " (Ethernet)" : dlt === 101 ? " (Raw IP)" : dlt === 113 ? " (Linux SLL)" : dlt === 147 ? " (USB)" : ""));
  }

 // ---- 3. record 链体检 ----
  const walk = walkRecords(out, dataStart, le);
  L.push("");
  L.push("● record 链: 从偏移 " + dataStart + " 起可连续解析 " + walk.count + " 个包，终止于偏移 " + walk.endOff + "（总长 " + out.length + "）");

  if (walk.anomalies.length) {
    L.push("");
    L.push("--- 异常包（诊断，保守不猜改） ---");
    for (const a of walk.anomalies) {
      if (a.type === "incl_len 越界") {
        L.push("  偏移 " + a.off + ": incl_len=" + a.incl + " 超出剩余 " + a.remain + " 字节 → 截断修复到 " + a.remain);
        w32(out, a.off + 8, a.remain, le);
        fixes.push("偏移 " + a.off + " incl_len " + a.incl + " 越界 → 截断为 " + a.remain);
      } else if (a.type === "incl_len=0") {
        L.push("  偏移 " + a.off + ": incl_len=0（0 长包，链在此断裂）。orig_len=" + a.orig + "。未自动改（无从确定真长度）。");
      } else if (a.type === "orig_len<incl_len") {
        L.push("  偏移 " + a.off + ": orig_len=" + a.orig + " < incl_len=" + a.incl + "（可疑，未改，orig_len 仅信息不影响读取）。");
      }
    }
  }

  const trailing = out.length - walk.endOff;
  if (walk.endOff < out.length && trailing > 0 && trailing < REC_HDR_LEN) {
    L.push("");
    L.push("⚠ 末尾 " + trailing + " 字节不足一个 record 头（可能截断残留），pcapParse 会忽略。");
  }

 // ---- 4. 输出 ----
  L.push("");
  if (fixes.length) {
    L.push("--- 已修复 " + fixes.length + " 处 ---");
    fixes.forEach((f, i) => L.push("  " + (i + 1) + ". " + f));
  } else {
    L.push("✓ 全局头与 record 链均正常，无需修复。");
  }
  L.push("");
  L.push("--- 修复后 pcap（hex，可复制喂给 pcapParse 解析）---");
  const outHex = toHex(out);
  L.push(outHex.length > 200000 ? outHex.slice(0, 200000) + "\n…(hex 过长已截断，实际 " + out.length + " 字节)" : outHex);

  return L.join("\n");
}

register({
  id: "pcapRepair",
  cat: "analysis",
  name: "pcap 文件修复",
  desc: "诊断+修复损坏 pcap/pcapng：经典 pcap（非法/缺失 magic 按 record 链反推重写、全局头缺失前插标准头、字节序翻转、snaplen/version 修正、incl_len 越界截断）；pcapng 块级保守修复（SHB magic/BOM 重写、SHB 缺失前插、块长首尾失配重写、链断裂自洽重同步，歧义只诊断不补造）。输出修复后 hex",
  params: [
    {
      key: "inputEnc", label: "输入编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
  ],
  run: pcapRepairRun,
  acceptsBytes: true,
});

export { pcapRepairRun, parseInput, walkRecords, recordPlausible, MAGICS, pcapngRepairRun, walkPcapngBlocks, makeStandardShb };
