/*
 * barcodeGen.js — 非 QR 条码生成（cat:'image'，run 通道）。
 *
 * 收录三符号：
 *   Code128      自动码表选择（B/C 切换与 bwip-js 默认一致）+ mod-103 校验字符
 *   EAN-13       12 位自动补校验位 / 13 位校验验证；护条下沿延伸
 *   DataMatrix   模块矩阵 + 静区
 *
 * 编码内核 = bwip-js 4.11.4（MIT，Mark Warren）内嵌 BWIPP 2026-05-28（MIT，Terry Burton）
 * 的 raw 接口：1D 取 sbs/bhs/bbs（模块宽序列/条高/条基线），2D 取 pixs/pixx/pixy
 * （模块矩阵）。内核经 src/vendor/ 裁剪包（仅上述三符号及其依赖闭包）动态 import
 * 惰性加载，首次调用后缓存 raw 接口，非首屏关键路径。
 * PNG 输出为手写极简编码器（IHDR + IDAT(zlib stored 未压缩块) + IEND，CRC32/adler32
 * 自写，RGBA 8bit，零 canvas）——与 mcMap.js/qrcode.js 同构。
 * 产物协议：{ text, files:[{name, mime, bytes}] }。
 *
 * 拒绝例显式抛错：EAN-13 非 12/13 位数字、校验位错、Code128 非 ASCII/控制字符、空输入。
 */
import { register } from "./registry.js";

/* ================= 内核惰性加载 ================= */

let _bwipRaw = null;
let _bwipP = null;
function loadBwipRaw() {
  if (_bwipRaw) return Promise.resolve(_bwipRaw);
  if (!_bwipP) {
    _bwipP = import("../vendor/bwip-js.js")
      .then((m) => {
        _bwipRaw = m.default.raw;
        return _bwipRaw;
      })
      .catch((e) => {
        _bwipP = null;
        throw new Error(`条码内核加载失败：${e && e.message ? e.message : e}`);
      });
  }
  return _bwipP;
}

/* ================= 参数与符号常量 ================= */

const SYMS = ["code128", "ean13", "datamatrix"];

// 每符号默认参数：modulePx 模块像素宽、heightModules 1D 条高（模块单位）、quietModules 静区（模块单位）
const DEFAULTS = {
  code128:     { modulePx: 4, heightModules: 40, quietModules: 10 },
  ean13:       { modulePx: 4, heightModules: 60, quietModules: 11 },
  datamatrix:  { modulePx: 6, heightModules: 0,  quietModules: 2  },
};

// ≤0（含留空/非法）一律回落符号默认——0 是 UI 的「按符号默认」哨兵值
function clampInt(v, lo, hi, dflt) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return dflt;
  return n < lo ? lo : n > hi ? hi : n;
}

/* ================= 极简 PNG 编码器（项目同款思路） ================= */

let CRC_TABLE = null;
function crcTable() {
  if (CRC_TABLE) return CRC_TABLE;
  CRC_TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    CRC_TABLE[n] = c >>> 0;
  }
  return CRC_TABLE;
}
function crc32(buf, start = 0, end = buf.length) {
  const t = crcTable();
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}
function u32be(v) { return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]); }
function concatBytes(list) {
  let n = 0;
  for (const b of list) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of list) { out.set(b, o); o += b.length; }
  return out;
}
// zlib 流：78 01 头 + stored(未压缩) deflate 块 + big-endian adler32。
// 存储块上限 65535 字节，超长自动分段。
function zlibStore(raw) {
  const blocks = [];
  if (raw.length === 0) {
    blocks.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
  }
  for (let o = 0; o < raw.length; ) {
    const len = Math.min(65535, raw.length - o);
    const last = o + len >= raw.length ? 1 : 0;
    const blk = new Uint8Array(5 + len);
    blk[0] = last;
    blk[1] = len & 255; blk[2] = (len >>> 8) & 255;
    blk[3] = ~len & 255; blk[4] = (~len >>> 8) & 255;
    blk.set(raw.subarray(o, o + len), 5);
    blocks.push(blk);
    o += len;
  }
  return concatBytes([new Uint8Array([0x78, 0x01]), ...blocks, u32be(adler32(raw))]);
}
function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  out.set(u32be(data.length), 0);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  out.set(u32be(crc32(out, 4, 8 + data.length)), 8 + data.length);
  return out;
}
/** RGBA8 像素 → PNG 字节（filter 0 扫描线 + zlib stored IDAT，单 IDAT） */
function encodePNG(rgba, width, height) {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const rowLen = width * 4;
  const raw = new Uint8Array(height * (1 + rowLen));
  for (let y = 0; y < height; y++) {
    const ro = y * (1 + rowLen);
    raw[ro] = 0;
    raw.set(rgba.subarray(y * rowLen, (y + 1) * rowLen), ro + 1);
  }
  return concatBytes([sig, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlibStore(raw)), pngChunk("IEND", new Uint8Array(0))]);
}

/* ================= 校验位（独立实现，供输出报告复核） ================= */

/** EAN-13/GTIN-13 校验位：右起（不含校验位）权重 3,1,3,1…，check = (10 - sum%10) % 10 */
export function ean13CheckDigit(digits12) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (sum % 10)) % 10);
}

/** Code128 校验字符：csum = (start + Σ codeword_i × i) mod 103（i 从 1 起，不含 stop） */
export function code128Checksum(codes) {
  let s = codes[0];
  for (let i = 1; i < codes.length; i++) s += codes[i] * i;
  return s % 103;
}

/* ================= Code128 码字表（raw 模式自举，仅展示 meta 用） ================= */

let C128_ENCS = null; // index: 码字 0..106 → "2,1,1,2,1,4" 形态键
function buildC128Table(rawFn) {
  const map = new Map(); // key → cw
  const addChunk = (cw, chunk) => {
    const key = chunk.join(",");
    if (!map.has(key)) map.set(key, cw);
  };
  for (let cw = 0; cw <= 106; cw++) {
    try {
      const r = rawFn("code128", "^104^" + String(cw).padStart(3, "0"), { raw: true });
      const sbs = r[0].sbs;
      addChunk(cw, sbs.slice(6, 12));      // 该码字本体
      addChunk(106, sbs.slice(18, 24));     // stop
    } catch (e) { /* 单个码字 raw 失败则跳过，其余仍可覆盖 */ }
  }
  return map;
}
/** sbs（6 宽度/码字）→ 码字序列；查不到返回 null */
export function sbsToCw128(sbs, rawFn) {
  if (!C128_ENCS) C128_ENCS = buildC128Table(rawFn);
  // BWIPP code128 的 sbs 末尾附 1 模块终止静区（长度 ≡ 1 mod 6），反转时剔除
  const sb = sbs.length % 6 === 1 ? sbs.slice(0, sbs.length - 1) : sbs;
  if (sb.length % 6 !== 0) return null;
  const out = [];
  for (let o = 0; o < sb.length; o += 6) {
    const cw = C128_ENCS.get(sb.slice(o, o + 6).join(","));
    if (cw === undefined) return null;
    out.push(cw);
  }
  return out;
}

/* ================= 输入校验（显式拒绝） ================= */

function validateInput(sym, text) {
  if (text === undefined || text === null || String(text) === "") {
    throw new Error(`（空输入）${sym} 生成需要非空内容。`);
  }
  const t = String(text);
  if (sym === "code128") {
    for (const ch of t) {
      const c = ch.codePointAt(0);
      if (c < 0x20 || c > 0x7e) {
        throw new Error(
          `Code128 仅接受可打印 ASCII（0x20-0x7E）。检测到 U+${c.toString(16).toUpperCase().padStart(4, "0")}「${ch}」。` +
          `（中文/非 ASCII 请改用 DataMatrix 或 QR）`
        );
      }
    }
    return t;
  }
  if (sym === "ean13") {
    if (!/^\d+$/.test(t)) {
      const bad = [...t].find((ch) => ch < "0" || ch > "9");
      throw new Error(`EAN-13 输入必须是纯数字。检测到非数字字符「${bad}」。`);
    }
    if (t.length !== 12 && t.length !== 13) {
      throw new Error(`EAN-13 输入必须是 12 位（自动补校验位）或 13 位数字，当前 ${t.length} 位。`);
    }
    if (t.length === 12) return t + ean13CheckDigit(t);
    const expect = ean13CheckDigit(t.slice(0, 12));
    if (t[12] !== expect) {
      throw new Error(`EAN-13 校验位错误：末位应为 ${expect}，实际 ${t[12]}。可去掉末位由本工具自动补全。`);
    }
    return t;
  }
  if (sym === "datamatrix") {
    if (t.length > 2000) throw new Error("DataMatrix 输入过长（>2000 字符）。");
    return t;
  }
  throw new Error(`未知符号类型「${sym}」，支持：${SYMS.join(" / ")}。`);
}

/* ================= 渲染：模块数据 → RGBA ================= */

// 1D：sbs（模块宽序列，偶数下标为条）/ bhs（相对条高）/ bbs（相对基线，≤0）
function render1DRgba(sbs, bhs, bbs, modulePx, heightModules, quietModules) {
  const maxBhs = Math.max(...bhs);
  const minBbs = Math.min(...bbs);
  const totalMods = sbs.reduce((a, b) => a + b, 0);
  const Hm = Math.max(1, Math.round((maxBhs - minBbs) * heightModules));
  const Wm = totalMods + quietModules * 2;
  const W = Wm * modulePx;
  const H = Hm * modulePx;
  const rgba = new Uint8Array(W * H * 4).fill(255); // 白底（RGBA 全 255）
  let xMod = quietModules;
  for (let j = 0; j < sbs.length; j += 2) {
    const wMod = sbs[j];
    if (wMod > 0) {
      // bhs/bbs 按条序号 k=j/2 索引（BWIPP 约定），非 sbs 下标
      const k = j / 2;
      const y0 = Math.round((maxBhs - bhs[k]) * heightModules) * modulePx;
      const y1 = Math.round((maxBhs - bbs[k]) * heightModules) * modulePx;
      const x0 = xMod * modulePx;
      const x1 = (xMod + wMod) * modulePx;
      for (let y = y0; y < y1; y++) {
        let p = (y * W + x0) * 4;
        for (let x = x0; x < x1; x++) { rgba[p] = rgba[p + 1] = rgba[p + 2] = 0; p += 4; }
      }
    }
    xMod += sbs[j] + (sbs[j + 1] || 0);
  }
  return { rgba, W, H };
}

// 2D：pixs 扁平模块矩阵
function render2DRgba(pixs, pixx, pixy, modulePx, quietModules) {
  const W = (pixx + quietModules * 2) * modulePx;
  const H = (pixy + quietModules * 2) * modulePx;
  const rgba = new Uint8Array(W * H * 4).fill(255);
  for (let r = 0; r < pixy; r++) {
    for (let c = 0; c < pixx; c++) {
      if (!pixs[r * pixx + c]) continue;
      const x0 = (c + quietModules) * modulePx;
      const y0 = (r + quietModules) * modulePx;
      for (let y = y0; y < y0 + modulePx; y++) {
        let p = (y * W + x0) * 4;
        for (let x = 0; x < modulePx; x++) { rgba[p] = rgba[p + 1] = rgba[p + 2] = 0; p += 4; }
      }
    }
  }
  return { rgba, W, H };
}

/* ================= 主入口（工厂注入 bwip-js raw） ================= */

/**
 * @param rawFn bwip-js default.raw：rawFn(bcid, text, opts) → [{sbs,bhs,bbs}|{pixs,pixx,pixy}]
 * @returns {{ encode, encodeModules }} encode(text, p) → { text, files, meta }
 */
export function createBarcodeGen(rawFn) {
  if (typeof rawFn !== "function") throw new Error("createBarcodeGen(rawFn)：需要注入 bwip-js raw 接口");

  /** 内核编码（校验后）：1D → {sbs,bhs,bbs}；2D → {pixs,pixx,pixy} */
  function encodeModules(sym, text, extraOpts = {}) {
    const normalized = validateInput(sym, text);
    let r;
    try {
      r = rawFn(sym, normalized, extraOpts);
    } catch (e) {
      throw new Error(`bwip-js/${sym} 编码失败：${e && e.message ? e.message : String(e)}`);
    }
    if (!r || !r[0]) throw new Error(`bwip-js/${sym} 未返回编码结果。`);
    return { input: normalized, ...r[0] };
  }

  function encode(text, p = {}) {
    let sym = String(p.sym || "auto").toLowerCase().replace(/-/g, "");
    if (sym === "dm" || sym === "datamatrix") sym = "datamatrix";
    const t0 = String(text === undefined || text === null ? "" : text);
    if (sym === "auto") {
      sym = /^\d{12}(\d)?$/.test(t0.trim()) ? "ean13" : "code128"; // 12/13 位纯数字 → EAN-13，否则 Code128
    }
    if (!SYMS.includes(sym)) {
      throw new Error(`未知符号类型「${p.sym}」。支持：code128 / ean13 / datamatrix。`);
    }
    const d = DEFAULTS[sym];
    const modulePx = clampInt(p.modulePx, 1, 20, d.modulePx);
    const quietModules = clampInt(p.quietModules, 0, 50, d.quietModules);
    const heightModules = sym === "datamatrix"
      ? 0
      : clampInt(p.heightModules, 5, 400, d.heightModules);

    // EAN-13 用 includetext 的 bhs/bbs 获得护条下沿延伸（几何与 BWIPP 一致，不渲染文字）
    const mods = encodeModules(sym, t0, sym === "ean13" ? { includetext: true } : {});

    const lines = [];
    const meta = { sym, input: mods.input, modulePx, quietModules };
    let rgba, W, H;
    if (sym === "datamatrix") {
      rgba = render2DRgba(mods.pixs, mods.pixx, mods.pixy, modulePx, quietModules).rgba;
      W = (mods.pixx + quietModules * 2) * modulePx;
      H = (mods.pixy + quietModules * 2) * modulePx;
      meta.size = `${mods.pixx}×${mods.pixy}`;
      lines.push(`DataMatrix 生成成功：${mods.pixx}×${mods.pixy} 模块，静区 ${quietModules} 模块`);
    } else {
      const r2 = render1DRgba(mods.sbs, mods.bhs, mods.bbs, modulePx, heightModules, quietModules);
      rgba = r2.rgba; W = r2.W; H = r2.H;
      meta.widthModules = mods.sbs.reduce((a, b) => a + b, 0);
      lines.push(`${sym === "ean13" ? "EAN-13" : "Code128"} 生成成功：${meta.widthModules} 模块宽`);
    }
    meta.image = `${W}×${H}px`;

    if (sym === "ean13") {
      meta.checkDigit = mods.input[12];
      meta.content = mods.input;
      lines.push(`内容：${mods.input}（12 位输入自动补校验位 ${meta.checkDigit}）`);
    }
    if (sym === "code128") {
      const cws = sbsToCw128(mods.sbs, rawFn);
      if (cws) {
        meta.codewords = cws;
        meta.checksum = cws[cws.length - 2];
        lines.push(`码字序列（${cws.length} 个，含校验 ${meta.checksum} 与 stop 106）：${cws.join(" ")}`);
      }
      lines.push(`内容：${mods.input}`);
    }
    if (sym === "datamatrix") lines.push(`内容：${mods.input}`);

    const png = encodePNG(rgba, W, H);
    lines.push(`产物：barcode_${sym}.png（${W}×${H}，${png.length} 字节）`);
    lines.push(`参数：模块 ${modulePx}px、静区 ${quietModules} 模块${sym !== "datamatrix" ? `、条高 ${heightModules} 模块` : ""}`);
    lines.push("内核：bwip-js 4.11.4 / BWIPP 2026-05-28（双 MIT）");

    return {
      text: lines.join("\n"),
      files: [{ name: `barcode_${sym}.png`, mime: "image/png", bytes: png }],
      meta,
    };
  }

  return { encode, encodeModules, rawFn };
}

/* ================= op 注册 ================= */

async function barcodeRun(input, p = {}) {
  const rawFn = await loadBwipRaw();
  return createBarcodeGen(rawFn).encode(String(input ?? ""), p);
}

register({
  id: "barcodeGen",
  cat: "image",
  name: "条码生成（Code128/EAN-13/DataMatrix）",
  desc: "非 QR 条码生成：Code128（自动 B/C 码表 + mod-103 校验字符）、EAN-13（12 位自动补校验位 + 护条延伸）、DataMatrix（任意文本含中文）。auto 档 12/13 位纯数字走 EAN-13，其余走 Code128。输出 PNG（含静区），参数 0/留空=按符号默认。内核 bwip-js 4.11.4 / BWIPP 2026-05-28（双 MIT），可配合扫码功能读回验证",
  params: [
    { key: "sym", label: "符号", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（12/13 位数字→EAN-13，否则 Code128）" },
        { value: "code128", label: "Code128（ASCII）" },
        { value: "ean13", label: "EAN-13（12/13 位数字）" },
        { value: "datamatrix", label: "DataMatrix（任意文本）" },
      ] },
    { key: "modulePx", label: "模块宽（像素）", type: "number", default: 0, placeholder: "0=按符号默认（1D 4 / DM 6），范围 1-20" },
    { key: "quietModules", label: "静区（模块）", type: "number", default: 0, placeholder: "0=按符号默认（1D 10-11 / DM 2）" },
    { key: "heightModules", label: "条高（模块，仅 1D）", type: "number", default: 0, placeholder: "0=按符号默认（C128 40 / EAN13 60）" },
  ],
  run: barcodeRun,
});
