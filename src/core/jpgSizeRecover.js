/*
 * jpgSizeRecover.js — JPEG 宽高修复（T345，cat:'forensic'）。
 *
 * 场景：CTF 经典「改高度藏图」的 JPEG 版 —— SOF 段声明的宽高被改小，
 * 查看器按声明值裁掉下方内容。JPEG 的 SOF 没有校验和（不像 PNG IHDR 有 CRC32），
 * 但基线（baseline，SOF0/SOF1）JPEG 的熵编码扫描数据里 MCU 个数是数得出来的：
 * 真实高度 = ceil(MCU 总数 / 每 MCU 行个数) × 8 × vmax（宽度通常未被篡改）。
 *
 * 两种模式：
 * - auto   自动：熵解码扫描数据只数不重建（DC 符号+幅度位 / AC run-size 到 EOB/ZRL），
 *          数出 MCU 总数反推真实高度并写回 SOF。渐进式（SOF2 等）多扫描不支持，提示切手动。
 * - manual 手动：直接把给定宽高写进 SOF（0 = 保持原值不改），用于渐进式或故意放大揭底。
 *
 * 格式依据：ITU-T T.81（ISO/IEC 10918-1）信息technology—连续色调静态图像数字压缩与编码
 * §B.2.2 帧头（SOF 分量采样因子 h/v）、§B.2.4.1 霍夫曼表规范（Annex C 的 maxcode/valptr
 * 解码法）、§B.2.3 扫描头、§F.1.2.3 MCU 内块序、§F.1.2.4 DC/AC 系数解码（S=0 无幅度位、
 * ZRL(0xF0) 跳 16 系数、EOB(0x00) 收束）、§B.1.1.5 字节填充（FF00 去填充）与
 * §B.2.1 重启间隔 DRI / RST0-7（FFD0-FFD7，重启边界丢 padding 位）。
 *
 * 输出形态对齐本项目 imagefix.js 的 pngSizeRecover/bmpSizeRecover（报告 + 修复后 base64）。
 * 输入约定：text 是 base64（可为 dataURL 前缀），或 p.rawBytes 直传 Uint8Array。
 *
 * 回归断言来源：参考实现 #[cfg(test)]「128×80 篡改 80→8 后数 MCU 恢复真高」思路，
 * 转写为本文件尾自检 IIFE（手构造的极小基线 JPEG，含灰度/采样因子/重启间隔/手动/非JPEG 边界）。
 */
import { register } from "./registry.js";

// ============ 通用工具（自包含） ============

function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

const u16be = (b, o) => ((b[o] << 8) + b[o + 1]) >>> 0;

// ============ 霍夫曼表（ITU-T T.81 Annex C 规范形态：mincode/maxcode/valptr） ============

class HuffTable {
  /** @param {number[]} counts 1..16 各长度码数（counts[0] 占位） @param {Uint8Array|number[]} symbols 符号表 */
  constructor(counts, symbols) {
    this.mincode = new Int32Array(17);
    this.maxcode = new Int32Array(17).fill(-1);
    this.valptr = new Int32Array(17);
    this.symbols = symbols;
    let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
      if (counts[l] > 0) {
        this.valptr[l] = k;
        this.mincode[l] = code;
        code += counts[l];
        this.maxcode[l] = code - 1;
        k += counts[l];
      }
      code <<= 1;
    }
  }

  /** 从位读取器解码一个符号。位流尽头/未定义码 → undefined。 */
  decode(br) {
    let code = 0;
    for (let l = 1; l <= 16; l++) {
      const bit = br.readBit();
      if (bit == null) return undefined;
      code = (code << 1) | bit;
      if (this.maxcode[l] >= 0 && code <= this.maxcode[l]) {
        return this.symbols[this.valptr[l] + (code - this.mincode[l])];
      }
    }
    return undefined;
  }
}

// ============ 位读取器（MSB-first，FF00 去填充，RST 重启） ============

class BitReader {
  constructor(data, start) {
    this.data = data;
    this.pos = start;
    this.cur = 0;
    this.bitsLeft = 0;
  }

  // 取下一个熵编码字节；遇真 marker（FF 且后随非 00）返回 null（pos 停在 FF）
  nextByte() {
    if (this.pos >= this.data.length) return null;
    const b = this.data[this.pos];
    if (b === 0xFF) {
      if (this.pos + 1 >= this.data.length) return null;
      const n = this.data[this.pos + 1];
      if (n === 0x00) { this.pos += 2; return 0xFF; } // 填充的 FF
      return null; // marker
    }
    this.pos++;
    return b;
  }

  readBit() {
    if (this.bitsLeft === 0) {
      const b = this.nextByte();
      if (b == null) return null;
      this.cur = b;
      this.bitsLeft = 8;
    }
    this.bitsLeft--;
    return (this.cur >> this.bitsLeft) & 1;
  }

  // 跳 n 个位（计数场景不关心值）
  skip(n) {
    for (let i = 0; i < n; i++) if (this.readBit() == null) return false;
    return true;
  }

  // 重启边界：丢 padding 位，跳过 FFD0-FFD7 标记
  restart() {
    this.bitsLeft = 0;
    while (this.pos + 1 < this.data.length
      && !(this.data[this.pos] === 0xFF && this.data[this.pos + 1] >= 0xD0 && this.data[this.pos + 1] <= 0xD7)) {
      this.pos++;
    }
    if (this.pos + 1 < this.data.length) { this.pos += 2; return true; }
    return false;
  }
}

// ============ JPEG 段解析（到 SOS 为止） ============

const SOF_MARKERS = [0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF];
const SOF_NAMES = {
  0xC0: "SOF0 基线", 0xC1: "SOF1 扩展顺序", 0xC2: "SOF2 渐进", 0xC3: "SOF3 无损",
  0xC5: "SOF5", 0xC6: "SOF6", 0xC7: "SOF7", 0xC9: "SOF9", 0xCA: "SOF10", 0xCB: "SOF11",
  0xCD: "SOF13", 0xCE: "SOF14", 0xCF: "SOF15",
};

/**
 * 解析 JPEG 头部：SOF（宽高/分量采样/是否基线）+ DHT（霍夫曼表）+ DRI + SOS（扫描分量）。
 * @returns {{sof:{off,height,width,comps:[{h,v}],baseline,name,precision,nc}, dht:Map, dri:number, scanComps:[{comp,td,ta}], scanStart:number}}
 */
function jpegParse(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xFF || jpeg[1] !== 0xD8) {
    throw new Error("非 JPEG 文件（无 SOI FFD8）");
  }
  let o = 2;
  let sof = null;
  const dht = new Map(); // key "tc,th" → HuffTable
  let dri = 0;
  while (o + 1 < jpeg.length) {
    if (jpeg[o] !== 0xFF) { o++; continue; }
    const m = jpeg[o + 1];
    if (m === 0xFF) { o++; continue; }
    if (m === 0xD8 || m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { o += 2; continue; }
    if (m === 0xD9) break; // EOI
    if (o + 4 > jpeg.length) break;
    const len = u16be(jpeg, o + 2);
    const segEnd = o + 2 + len;
    if (segEnd > jpeg.length) break;
    if (SOF_MARKERS.includes(m)) {
      const nc = jpeg[o + 9];
      const comps = [];
      for (let i = 0; i < nc; i++) {
        const c = o + 10 + i * 3;
        comps.push({ h: jpeg[c + 1] >> 4, v: jpeg[c + 1] & 0xF });
      }
      sof = {
        off: o,
        height: u16be(jpeg, o + 5),
        width: u16be(jpeg, o + 7),
        comps,
        baseline: m === 0xC0 || m === 0xC1,
        name: SOF_NAMES[m] || "SOF",
        precision: jpeg[o + 4],
        nc,
      };
    } else if (m === 0xC4) { // DHT（段内可含多张表）
      let p = o + 4;
      while (p < segEnd) {
        const tc = jpeg[p] >> 4, th = jpeg[p] & 0xF;
        const counts = [0];
        let tot = 0;
        for (let i = 1; i <= 16; i++) { counts.push(jpeg[p + i]); tot += jpeg[p + i]; }
        const syms = jpeg.slice(p + 17, p + 17 + tot);
        dht.set(tc + "," + th, new HuffTable(counts, syms));
        p += 17 + tot;
      }
    } else if (m === 0xDD) { // DRI
      dri = u16be(jpeg, o + 4);
    } else if (m === 0xDA) { // SOS
      if (!sof) throw new Error("SOS 出现在 SOF 之前，结构异常");
      const ns = jpeg[o + 4];
      const scanComps = [];
      for (let i = 0; i < ns; i++) {
        const c = o + 5 + i * 2;
        const id = jpeg[c];
        const comp = Math.min(Math.max(id - 1, 0), sof.comps.length - 1); // SOS 分量按 SOF 序映射
        scanComps.push({ comp, td: jpeg[c + 1] >> 4, ta: jpeg[c + 1] & 0xF });
      }
      return { sof, dht, dri, scanComps, scanStart: segEnd };
    }
    o = segEnd;
  }
  throw new Error("未找到扫描数据（SOS）");
}

// ============ 核心：数 MCU（基线扫描，只数不重建像素） ============

/**
 * 熵解码基线扫描，数出 MCU 总数 → 换算「满 MCU 行」对应的高度。
 * @returns {number|null} 真实高度（像素，向上取整到 MCU 高度）；数不出返回 null
 */
function countMcus(jpeg, p) {
  const table = (cls, id) => p.dht.get(cls + "," + id);
  const br = new BitReader(jpeg, p.scanStart);
  let mcu = 0;
  let sinceRst = 0;
  const hmax = Math.max(1, ...p.sof.comps.map((c) => c.h));
  const vmax = Math.max(1, ...p.sof.comps.map((c) => c.v));
  const mcuW = 8 * hmax;
  const mcusPerRow = Math.ceil(p.sof.width / Math.max(1, mcuW));
  if (mcusPerRow === 0) return null;
  const safety = mcusPerRow * 200000; // 防损坏数据死循环
  outer:
  for (;;) {
    for (const sc of p.scanComps) {
      const comp = p.sof.comps[sc.comp];
      const dc = table(0, sc.td);
      const ac = table(1, sc.ta);
      if (!dc || !ac) return null; // 缺表，数不下去
      for (let b = 0; b < comp.h * comp.v; b++) {
        // DC：一个符号 S → S 个幅度位（S=0 无幅度位）
        const s = dc.decode(br);
        if (s == null) break outer;
        if (s > 0 && !br.skip(s)) break outer;
        // AC：run/size 符号直到 EOB / ZRL / 63 系数满
        let k = 1;
        while (k < 64) {
          const rs = ac.decode(br);
          if (rs == null) break outer;
          const r = rs >> 4;
          const ss = rs & 0xF;
          if (ss === 0) {
            if (r === 15) { k += 16; continue; } // ZRL：跳 16 个全零系数
            break; // EOB
          }
          k += r;
          if (!br.skip(ss)) break outer;
          k++;
        }
      }
    }
    mcu++;
    sinceRst++;
    if (p.dri > 0 && sinceRst === p.dri) {
      sinceRst = 0;
      if (!br.restart()) break;
    }
    if (mcu > safety) break;
  }
  if (mcu === 0) return null;
  const mcuRows = Math.ceil(mcu / mcusPerRow);
  return mcuRows * 8 * vmax;
}

/** 把宽高写回 SOF 段（高 @off+5，宽 @off+7，均大端）。 */
function setJpegDims(buf, sofOff, w, h) {
  const out = new Uint8Array(buf);
  out[sofOff + 5] = (h >> 8) & 0xFF; out[sofOff + 6] = h & 0xFF;
  out[sofOff + 7] = (w >> 8) & 0xFF; out[sofOff + 8] = w & 0xFF;
  return out;
}

// ============ run（报告形态对齐 pngSizeRecover/bmpSizeRecover） ============

/**
 * jpgSizeRecover run：JPEG 宽高修复。
 * @param {string} text base64 JPEG（或空，配 p.rawBytes）
 * @param {object} p { rawBytes?, mode?("auto"|"manual"), width?, height? }
 * @returns {string} 多行报告（修复成功附修复后 base64）
 */
function jpgSizeRecoverRun(text, p) {
  const buf = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : b64ToBytes(text);
  const mode = (p && p.mode) || "auto";
  const parsed = jpegParse(buf);
  const { sof, dri } = parsed;
  const hmax = Math.max(1, ...sof.comps.map((c) => c.h));
  const vmax = Math.max(1, ...sof.comps.map((c) => c.v));

  const lines = [];
  lines.push(`JPEG 宽高修复（模式：${mode === "manual" ? "手动" : "自动"}，文件 ${buf.length} 字节）`);
  lines.push(`${sof.name} @ 偏移 ${sof.off}：当前宽高 ${sof.width} × ${sof.height}（精度 ${sof.precision}bit，分量 ${sof.nc} 个，最大采样 ${hmax}×${vmax}${dri ? `，重启间隔 ${dri} MCU` : ""}）`);

  if (mode === "manual") {
    let w = Math.max(0, Math.min(65535, Math.round((p && p.width) || 0)));
    let h = Math.max(0, Math.min(65535, Math.round((p && p.height) || 0)));
    if (w === 0) w = sof.width;
    if (h === 0) h = sof.height;
    const fixed = setJpegDims(buf, sof.off, w, h);
    lines.push(`手动设置宽高 = ${w} × ${h}（原 ${sof.width} × ${sof.height}）。`);
    lines.push("");
    lines.push("修复后 base64（已写回 SOF）：");
    lines.push(bytesToB64(fixed));
    return lines.join("\n");
  }

  // 自动：仅基线可数 MCU
  if (!sof.baseline) {
    lines.push(`当前是渐进式/非基线 JPEG（${sof.name}），自动数 MCU 不支持。`);
    lines.push("请切「手动」模式指定高度（把高度调大可显示被裁掉的隐藏内容）。");
    return lines.join("\n");
  }

  const trueH = countMcus(buf, parsed);
  if (trueH == null) {
    lines.push("无法从扫描数据恢复高度（可能重启标记异常或编码非标准）。");
    lines.push("请切「手动」模式指定高度。");
    return lines.join("\n");
  }
  if (trueH === sof.height) {
    lines.push(`高度 ${sof.height} 与扫描数据一致（${sof.width} × ${sof.height}），无需修复。`);
    return lines.join("\n");
  }
  const fixed = setJpegDims(buf, sof.off, sof.width, trueH);
  lines.push(`按扫描数据恢复：真实高度 ${trueH}（原记录 ${sof.height}，宽度 ${sof.width} 不变）。`);
  lines.push("（真实高度按 MCU 块对齐向上取整，末尾多余数行通常为纯色填充，属正常。）");
  lines.push("");
  lines.push("修复后 base64（已写回 SOF 高度）：");
  lines.push(bytesToB64(fixed));
  return lines.join("\n");
}

// ============ 自检用手造极小基线 JPEG（手写熵编码，不依赖外部编码器） ============

/**
 * 手造极小基线 JPEG：灰度，1×1 采样，DQT 全 1；DC 表单符号类别 0（1bit 码 '0'），
 * AC 表单符号 EOB（1bit 码 '0'）→ 每块恰好 2 bit。
 * @param {number} w 宽 @param {number} h 高 @param {number} mcuCount 需要编码的 MCU 总数
 *   （扫描数据按每 MCU 2bit 打包，调用方保证与 w×h 匹配且能整字节对齐）
 */
function makeBaselineJpeg(w, h, mcuCount) {
  const parts = [];
  const push = (...bs) => { for (const b of bs) parts.push(b & 0xFF); };
  const pushU16 = (v) => push((v >> 8) & 0xFF, v & 0xFF);
  const seg = (marker, bodyLen) => { push(0xFF, marker); pushU16(bodyLen + 2); };

  push(0xFF, 0xD8); // SOI
  seg(0xDB, 1 + 64); push(0x00); for (let i = 0; i < 64; i++) push(0x01); // DQT
  seg(0xC0, 6 + 3); // SOF0：body = P(1)+H(2)+W(2)+nc(1) + 3/分量 = 9（nc=1；段长=8+3×nc）
  push(0x08); pushU16(h); pushU16(w); push(0x01);
  push(0x01, 0x11, 0x00); // 分量 id=1 采样1×1 量化表0
  // DHT：DC0（counts[1]=1，符号0）+ AC0（counts[1]=1，符号0x00 EOB）
  seg(0xC4, (1 + 16 + 1) * 2);
  push(0x00); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00); // DC
  push(0x10); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00); // AC EOB
  seg(0xDA, 6); // SOS：body = ns(1) + 2×ns + 3 = 6（ns=1）
  push(0x01); push(0x01, 0x00); push(0x00, 0x3F, 0x00);
  // 扫描：mcuCount × 2bit 全 0（每块 DC类别0 + AC EOB），整字节对齐由调用方保证
  const totalBits = mcuCount * 2;
  if (totalBits % 8 !== 0) throw new Error("测试构造需 MCU 数 ×2bit 整字节对齐");
  for (let i = 0; i < totalBits / 8; i++) push(0x00);
  push(0xFF, 0xD9); // EOI
  return new Uint8Array(parts);
}

/** 篡改 SOF 高度（CTF 改高度手法：只改声明不动扫描）。 */
function tamperHeight(jpeg, fakeH) {
  const out = new Uint8Array(jpeg);
  const sofOff = jpegParse(jpeg).sof.off;
  out[sofOff + 5] = (fakeH >> 8) & 0xFF; out[sofOff + 6] = fakeH & 0xFF;
  return out;
}

// ============ 加载期自检（import 即跑） ============

(() => {
  // ① 主路径：8×32（4 MCU）篡改高 32→8，自动数 MCU 恢复 32
  let jpg = makeBaselineJpeg(8, 32, 4);
  let out = jpgSizeRecoverRun("", { rawBytes: tamperHeight(jpg, 8), mode: "auto" });
  if (!out.includes("真实高度 32") || !out.includes("原记录 8")) throw new Error(`jpgSizeRecover 自检①失败：\n${out}`);

  // ② 未篡改：高度与扫描数据一致
  out = jpgSizeRecoverRun("", { rawBytes: makeBaselineJpeg(8, 32, 4), mode: "auto" });
  if (!out.includes("无需修复")) throw new Error(`jpgSizeRecover 自检②失败：\n${out}`);

  // ③ 手动模式：写高 64（宽 0 不改）
  out = jpgSizeRecoverRun("", { rawBytes: makeBaselineJpeg(8, 32, 4), mode: "manual", width: 0, height: 64 });
  const b64 = out.split("\n").pop();
  const redone = b64ToBytes(b64);
  const reparsed = jpegParse(redone);
  if (reparsed.sof.height !== 64 || reparsed.sof.width !== 8) throw new Error(`jpgSizeRecover 自检③失败：${reparsed.sof.width}×${reparsed.sof.height}`);

  // ④ 非 JPEG 报错
  let threw = false;
  try { jpgSizeRecoverRun("", { rawBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47]) }); }
  catch { threw = true; }
  if (!threw) throw new Error("jpgSizeRecover 自检④失败：非 JPEG 未报错");

  // ⑤ 多 MCU 行：16×16 → mcusPerRow=2，4 MCU → 2 行 → 真高 16；篡改 16→8 应恢复 16
  jpg = makeBaselineJpeg(16, 16, 4); // 每 MCU 行 2 个，2 行共 4 MCU（每字节 4 MCU？——2bit/MCU，4MCU=1 字节）
  out = jpgSizeRecoverRun("", { rawBytes: tamperHeight(jpg, 8), mode: "auto" });
  if (!out.includes("真实高度 16")) throw new Error(`jpgSizeRecover 自检⑤失败：\n${out}`);

  // ⑥ 采样因子路径：2 分量（0x21 采样 + 0x11），每 MCU 3 块 6bit
  //    W=64 → mcusPerRow = ceil(64/16) = 4，H=8 → 1 行 4 MCU = 24bit = 3 字节
  const multi = (() => {
    const parts = [];
    const push = (...bs) => { for (const b of bs) parts.push(b & 0xFF); };
    const pushU16 = (v) => push((v >> 8) & 0xFF, v & 0xFF);
    const seg = (marker, bodyLen) => { push(0xFF, marker); pushU16(bodyLen + 2); };
    push(0xFF, 0xD8);
    seg(0xDB, 1 + 64); push(0x00); for (let i = 0; i < 64; i++) push(0x01);
    seg(0xC0, 6 + 3 * 2); // SOF0：body = 6 + 3×2 = 12（nc=2）
    push(0x08); pushU16(8); pushU16(64); push(0x02);
    push(0x01, 0x21, 0x00); // 分量1：h=2 v=1
    push(0x02, 0x11, 0x00); // 分量2：1×1
    seg(0xC4, (1 + 16 + 1) * 2);
    push(0x00); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00);
    push(0x10); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00);
    seg(0xDA, 8); // SOS：body = 1 + 2×2 + 3 = 8（ns=2）
    push(0x02); push(0x01, 0x00); push(0x02, 0x00); push(0x00, 0x3F, 0x00);
    // 每 MCU：分量1 两块 + 分量2 一块 = 3 块 ×2bit = 6bit；4 MCU = 24bit = 3 字节
    push(0x00, 0x00, 0x00);
    push(0xFF, 0xD9);
    return new Uint8Array(parts);
  })();
  out = jpgSizeRecoverRun("", { rawBytes: multi, mode: "auto" });
  if (!out.includes("无需修复") || !out.includes("64 × 8")) throw new Error(`jpgSizeRecover 自检⑥失败：\n${out}`);

  // ⑦ 渐进式（SOF2）：自动拒绝并提示手动
  const prog = (() => {
    const base = makeBaselineJpeg(8, 32, 4);
    const outB = new Uint8Array(base);
    const sofOff = jpegParse(base).sof.off;
    outB[sofOff + 1] = 0xC2; // SOF0 → SOF2
    return outB;
  })();
  out = jpgSizeRecoverRun("", { rawBytes: prog, mode: "auto" });
  if (!out.includes("渐进式") || !out.includes("手动")) throw new Error(`jpgSizeRecover 自检⑦失败：\n${out}`);

  // ⑧ FF00 去填充路径：扫描数据里塞一个字节 0xFF 需写成 FF00。
  //    构造：8×40（5 MCU，10bit 数据流手动混入 stuffed FF）——直接手工拼扫描段：
  //    bits: 00 00 00 00 00（5 MCU 各 '00'）= 10 bit + pad111111 → 字节 0x00 0x3F。
  //    把 0x3F 换成含 FF 的：改用「每 MCU 2bit」，第 9-16 bit 造 FF00 不可行（全 0 码流），
  //    此处改为验证 BitReader 层：读 stuffed FF00 应得 0xFF 且不停。
  const br = new BitReader(new Uint8Array([0xFF, 0x00, 0xFF, 0x00, 0xFF, 0xD9]), 0);
  const byte1 = br.nextByte();
  const byte2 = br.nextByte();
  const byte3 = br.nextByte();
  if (byte1 !== 0xFF || byte2 !== 0xFF || byte3 !== null) {
    throw new Error(`jpgSizeRecover 自检⑧失败：FF00 去填充 ${byte1},${byte2},${byte3}`);
  }

  // ⑨ 重启间隔路径：DRI=2，8×24（3 MCU），2 MCU 后 FFD0
  const rst = (() => {
    const parts = [];
    const push = (...bs) => { for (const b of bs) parts.push(b & 0xFF); };
    const pushU16 = (v) => push((v >> 8) & 0xFF, v & 0xFF);
    const seg = (marker, bodyLen) => { push(0xFF, marker); pushU16(bodyLen + 2); };
    push(0xFF, 0xD8);
    seg(0xDB, 1 + 64); push(0x00); for (let i = 0; i < 64; i++) push(0x01);
    seg(0xC0, 6 + 3); // SOF0：body = 9（nc=1）
    push(0x08); pushU16(24); pushU16(8); push(0x01); push(0x01, 0x11, 0x00);
    seg(0xC4, (1 + 16 + 1) * 2);
    push(0x00); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00);
    push(0x10); push(1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0); push(0x00);
    seg(0xDD, 2); pushU16(2); // DRI = 2 MCU
    seg(0xDA, 6); // SOS：body = 1 + 2×1 + 3 = 6（ns=1）
    push(0x01); push(0x01, 0x00); push(0x00, 0x3F, 0x00);
    push(0x00); // MCU1+MCU2（4bit + 4bit padding）
    push(0xFF, 0xD0); // RST0
    push(0x3F); // MCU3（2bit '00' + 6bit pad '1'，T.81 规定补 1 → 解码器不会把 padding 误读为新 MCU）
    push(0xFF, 0xD9);
    return new Uint8Array(parts);
  })();
  const parsedRst = jpegParse(rst);
  const hRst = countMcus(rst, parsedRst);
  if (hRst !== 24) throw new Error(`jpgSizeRecover 自检⑨失败：DRI 路径真高 ${hRst}（期望 24）`);
})();

// ============ register ============

register({
  id: "jpgSizeRecover", cat: "forensic", name: "JPEG 宽高修复",
  desc: "基线 JPEG 数 MCU 反推真实高度（SOF 无校验和，熵解码扫描数据数块即得；CTF 改高度藏图的 JPEG 版）+ 手动强制宽高，输出修复后 base64",
  params: [
    { key: "mode", label: "模式", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（数 MCU 恢复高度）" },
        { value: "manual", label: "手动（强制宽高）" },
      ] },
    { key: "width", label: "宽(手动,0=不改)", type: "number", default: 0, placeholder: "仅手动模式生效" },
    { key: "height", label: "高(手动,0=不改)", type: "number", default: 0, placeholder: "仅手动模式生效" },
  ],
  run: jpgSizeRecoverRun,
  acceptsBytes: true,
});

export {
  jpgSizeRecoverRun,
  jpegParse,
  countMcus,
  HuffTable,
  BitReader,
  makeBaselineJpeg, // 供回归脚本构造已知结构的测试 JPEG
};
