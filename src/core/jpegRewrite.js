/*
 * jpegRewrite.js — JPEG DCT 系数回写器（纯算法库，无 op 注册）。
 *
 * 做什么：拿到 f5stego.js parseJpeg() 的解析结果 + （可选的）修改后系数，
 * 重新做 Huffman 熵编码（DC 差分 + AC run/size + ZRL/EOB），重组完整 JPEG 字节。
 * 原文件 SOI/APPn/DQT/SOF/DHT/DRI/SOS 段字节级原样保留，只重写扫描熵数据。
 *
 * ---- 硬验收口径 ----
 * 系数未改动时回写，输出文件用 parseJpeg 再解出的各分量 blocks/blocksDC
 * 必须与原图逐位一致（往返闭环）。字节级允许与原文件不同（取决于原编码器
 * 是否用规范 Huffman 码字分配——主流编码器均如此，实测通常连字节都一致）。
 *
 * ---- 支持范围 ----
 * · 基线 Baseline（SOF0）与扩展顺序（SOF1）Huffman JPEG：支持。
 * · 渐进式 Progressive（SOF2）：优雅报错（顺序系数模型不成立）。
 * · 4:4:4 / 4:2:0 / 4:2:2 / 灰度：支持（块遍历顺序严格复刻 f5stego decodeScan）。
 * · 单 SOS 全谱扫描（Ss=0,Se=63,Ah=0,Al=0）：支持。多 SOS（非交错多扫描）：
 *   优雅报错。算术编码 / JPG 保留段：优雅报错。
 * · DRI 重启间隔：支持——按原 DRI 周期补发 RSTn 并复位 DC 预测值，与解码器
 *   （f5stego decodeScan 的 resetInterval 逻辑）逐位对齐。
 *
 * ---- 结构依据（勿改 f5stego.js，只读其产物） ----
 * parseJpeg(bytes) → { _raw, jfif, APPn, qts, frame, tail }
 * frame.components[i]: { componentId, h, v, quantizationTable,
 *   blocks (Int16Array，AC 系数按 zigzag 序存放，i%64==0 恒 0——DC 在 blocksDC),
 *   blocksDC (Int16Array，每块 1 个 DC 值), blocksPerLine/Column,
 *   blocksPerLineForMcu/ColumnForMcu }
 * frame: { progressive, extended, mcusPerLine, mcusPerColumn, componentIds }
 * 注意：parseJpeg 不记录各标记段字节边界，本文件自行在 _raw 上重扫段结构。
 *
 * ---- 复用面 ----
 * jsteg.js（T391）嵌入 / 未来 Fridrich 校准（需改写系数后重打包）均调
 * reencodeJpeg(parsed, newComponents)。本文件不注册 op、不碰 UI。
 *
 * 红线遵守：纯前端零外发，无 node 专属 API；报告无 emoji。
 */

// ============================================================
// 小工具
// ============================================================
function hex2(b) {
  return (b || 0).toString(16).padStart(2, "0");
}

function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** 数值 v 的 Huffman 类别（幅值位长，0 表示 v==0）。 */
function bitSize(v) {
  let n = 0;
  v = v < 0 ? -v : v;
  while (v) { n++; v >>>= 1; }
  return n;
}

// ============================================================
// 段扫描：在原始字节上定位各标记段边界（parseJpeg 不存边界，须重扫）
// ============================================================
/**
 * 从熵编码数据起点向后找其结束位置（下一个真实段标记处）。
 * 熵数据内 0xFF 只能以 FF00（字节填充）或 FFD0-D7（RSTn，DRI 存在时）出现，
 * 故「FF + 非 00/FF/D0-D7」即段边界——这是精确判定，不是启发式。
 */
function findEntropyEnd(raw, pos) {
  let p = pos;
  while (p + 1 < raw.length) {
    if (raw[p] !== 0xff) { p++; continue; }
    const b = raw[p + 1];
    if (b === 0x00 || b === 0xff) { p += 2; continue; } // 字节填充 / 填充字节
    if (b >= 0xd0 && b <= 0xd7) { p += 2; continue; }   // RSTn（重启标记）
    return p;                                            // 真实段标记起点
  }
  return raw.length;
}

/**
 * 扫描 JPEG 段结构。返回：
 * { comps: [{compIdx, td, ta}], sosCount, dri, dht: Map(class*16+id → {nrcodes, values}),
 *   entropyStart, entropyEndPos, eoiPos }
 * 遇到第二个 SOS 时也记录（调用方据此判多扫描并报错）。
 */
function scanSegments(raw, frame) {
  if (!raw || raw.length < 4 || raw[0] !== 0xff || raw[1] !== 0xd8) {
    throw new Error("回写器输入不是 JPEG 字节（缺 SOI FF D8）");
  }
  const dht = new Map();
  let dri = 0;
  let off = 2;
  let entropyStart = -1, entropyEndPos = -1, eoiPos = -1;
  let sosCount = 0;
  let comps = null, ss = 0, se = 0, ah = 0, al = 0;

  while (off < raw.length) {
    if (raw[off] !== 0xff) {
      throw new Error(`JPEG 段边界错位 @${off}（期望 FF，得 ${hex2(raw[off])}）`);
    }
    const m = raw[off + 1];
    if (m === 0xff) { off++; continue; }  // 段间填充字节（容错）
    if (m === 0x00) { off += 2; continue; } // 极少见：熵外 FF00（容错跳过）
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { off += 2; continue; } // TEM / RSTn
    if (m === 0xd8) { off += 2; continue; } // 异常复现的 SOI（容错跳过）
    if (m === 0xd9) {                        // EOI
      if (entropyStart < 0) throw new Error("JPEG 缺少 SOS 扫描段，无 DCT 系数可回写");
      eoiPos = off;
      break;
    }
    if (off + 4 > raw.length) throw new Error("JPEG 段头截断");
    const L = (raw[off + 2] << 8) | raw[off + 3];
    const segEnd = off + 2 + L;
    if (L < 2 || segEnd > raw.length) throw new Error(`JPEG 段长度越界 @${off}（marker FF${hex2(m)}）`);

    if (m === 0xda) { // SOS
      sosCount++;
      if (sosCount === 1) {
        const p0 = off + 4;
        const ns = raw[p0];
        if (L < 6 + 2 * ns) throw new Error("SOS 段长度异常");
        comps = [];
        for (let i = 0; i < ns; i++) {
          const cs = raw[p0 + 1 + 2 * i];
          const t = raw[p0 + 2 + 2 * i];
          const compIdx = frame.componentIds[cs];
          if (compIdx == null) throw new Error(`SOS 引用了 SOF 中不存在的分量 id ${cs}`);
          comps.push({ compIdx, td: t >> 4, ta: t & 15 });
        }
        ss = raw[p0 + 1 + 2 * ns];
        se = raw[p0 + 2 + 2 * ns];
        const aa = raw[p0 + 3 + 2 * ns];
        ah = aa >> 4; al = aa & 15;
        entropyStart = segEnd;
      }
      if (entropyEndPos < 0) {
        entropyEndPos = findEntropyEnd(raw, segEnd);
        off = entropyEndPos; // 跳过熵数据，从其后第一个标记继续
      } else {
        off = segEnd;
      }
      continue;
    }

    if (m === 0xc4) { // DHT：解析出 (nrcodes, values) 供重编码建码表
      let p = off + 4;
      while (p < segEnd) {
        const spec = raw[p++];
        const cls = spec >> 4, id = spec & 15;
        const nrcodes = new Uint8Array(16);
        let sum = 0;
        for (let i = 0; i < 16; i++) { nrcodes[i] = raw[p++]; sum += nrcodes[i]; }
        const values = new Uint8Array(sum);
        for (let i = 0; i < sum; i++) values[i] = raw[p++];
        dht.set(cls * 16 + id, { nrcodes, values });
      }
      if (p !== segEnd) throw new Error("DHT 段长度与表内容不符");
    } else if (m === 0xdd) { // DRI 重启间隔
      if (L >= 4) dri = (raw[off + 4] << 8) | raw[off + 5];
    } else if (m === 0xc8) {
      throw new Error("遇到 JPG 保留标记（FFC8），该 JPEG 使用了不支持的特性");
    } else if (m === 0xcc) {
      throw new Error("该 JPEG 使用算术编码（DAC），暂不支持回写——请换 Huffman 编码的基线图");
    }
    off = segEnd;
  }

  if (entropyStart < 0) throw new Error("JPEG 缺少 SOS 扫描段，无 DCT 系数可回写");
  return { comps, sosCount, dri, dht, ss, se, ah, al, entropyStart, entropyEndPos, eoiPos };
}

// ============================================================
// Huffman 重编码
// ============================================================
/**
 * 由 DHT 的 (nrcodes, values) 做规范码字分配（JPEG 规范 Annex C 口径，
 * 与 f5stego _buildHuffmanTable 的解码侧构造互为镜像）。
 * 返回 Map(value → {code, size})。
 */
function buildEncMap(nrcodes, values) {
  const map = new Map();
  let code = 0, k = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < nrcodes[len - 1]; i++) {
      map.set(values[k++], { code, size: len });
      code++;
    }
    code <<= 1;
  }
  return map;
}

/**
 * 位写入器：MSB 先行；每写满 0xFF 字节补一个 0x00（字节填充）；
 * restart()/finish() 以 1 填充对齐字节边界（JPEG 口径）。
 */
class BitWriter {
  constructor() { this.bytes = []; this.acc = 0; this.n = 0; }
  put(code, size) {
    for (let i = size - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((code >>> i) & 1);
      if (++this.n === 8) {
        const b = this.acc & 0xff;
        this.bytes.push(b);
        if (b === 0xff) this.bytes.push(0x00);
        this.acc = 0; this.n = 0;
      }
    }
  }
  /** 以 1 填充对齐到字节边界（重启间隔 / 收尾口径）。 */
  align() {
    if (this.n > 0) {
      const pad = 8 - this.n;
      this.acc = (this.acc << pad) | ((1 << pad) - 1);
      const b = this.acc & 0xff;
      this.bytes.push(b);
      if (b === 0xff) this.bytes.push(0x00);
      this.acc = 0; this.n = 0;
    }
  }
  pushMarker(m) { this.align(); this.bytes.push((m >> 8) & 0xff, m & 0xff); }
  finish() {
    this.align();
    return new Uint8Array(this.bytes);
  }
}

/** 发一个 DC 差分（类别码 + 类别位）。 */
function emitDiff(bw, encMap, v, what) {
  const sz = bitSize(v);
  const e = encMap.get(sz);
  if (!e) throw new Error(`${what} Huffman 表缺少类别 ${sz} 的码字（DHT 与数据不符）`);
  bw.put(e.code, e.size);
  if (sz > 0) bw.put(v < 0 ? v + (1 << sz) - 1 : v, sz); // 负数按规范取 v + 2^sz − 1
}

/**
 * 编码一个 8×8 块：DC 差分 + AC run/size（ZRL=0xF0、EOB=0x00）。
 * pos 为该块在 blocks 中的起始下标（= 块序号×64）。
 */
function encodeBlock(bw, s, pos) {
  const bi = pos >> 6;
  const dc = s.blocksDC[bi];
  emitDiff(bw, s.dcEnc, dc - s.pred, "DC");
  s.pred = dc;

  let run = 0;
  for (let k = 1; k < 64; k++) {
    const v = s.blocks[pos + k];
    if (v === 0) { run++; continue; }
    while (run > 15) { // ZRL：连 0 ≥16 时每 16 个发一个 0xF0
      const e = s.acEnc.get(0xf0);
      if (!e) throw new Error("AC Huffman 表缺少 ZRL(0xF0) 码字");
      bw.put(e.code, e.size);
      run -= 16;
    }
    const sz = bitSize(v);
    const e = s.acEnc.get((run << 4) | sz);
    if (!e) throw new Error(`AC Huffman 表缺少 (run=${run},size=${sz}) 的码字`);
    bw.put(e.code, e.size);
    bw.put(v < 0 ? v + (1 << sz) - 1 : v, sz);
    run = 0;
  }
  if (run > 0) { // 块尾非零系数后还有 0 → 发 EOB
    const e = s.acEnc.get(0x00);
    if (!e) throw new Error("AC Huffman 表缺少 EOB(0x00) 码字");
    bw.put(e.code, e.size);
  }
}

// ============================================================
// 主入口
// ============================================================
/**
 * 回写：按（可能修改过的）系数重新 Huffman 编码，重组完整 JPEG 字节。
 *
 * @param parsed    parseJpeg() 的返回值（必须含 frame 与 _raw）
 * @param newComponents 可选数组，与 frame.components 平行；每项可为
 *                      null/undefined（沿用原系数）或 { blocks?, blocksDC? }
 *                      部分覆盖（Int16Array，长度须与原解析一致）。
 * @returns Uint8Array 完整 JPEG 字节
 */
export function reencodeJpeg(parsed, newComponents) {
  const frame = parsed && parsed.frame;
  if (!frame || !parsed._raw) {
    throw new Error("reencodeJpeg 需要 parseJpeg() 的解析结果（含 frame 与 _raw）");
  }
  if (frame.progressive) {
    throw new Error("渐进式 JPEG（Progressive SOF2）暂不支持回写——请换基线 Baseline 图");
  }
  const raw = parsed._raw;
  const scan = scanSegments(raw, frame);
  if (scan.sosCount > 1) {
    throw new Error("多扫描 JPEG（多个 SOS 非交错扫描）暂不支持回写");
  }
  if (scan.ss !== 0 || scan.se !== 63 || scan.ah !== 0 || scan.al !== 0) {
    throw new Error("非常规全谱扫描（Ss/Se/Ah/Al ≠ 0/63/0/0），暂不支持回写");
  }

  // ---- 编码用码表（按扫描引用的 td/ta 惰性构建） ----
  const dcMaps = new Map(), acMaps = new Map();
  const getMap = (cls, id) => {
    const store = cls === 0 ? dcMaps : acMaps;
    if (store.has(id)) return store.get(id);
    const t = scan.dht.get(cls * 16 + id);
    if (!t) throw new Error(`缺少 ${cls === 0 ? "DC" : "AC"} Huffman 表 id=${id}（DHT 未定义）`);
    const m = buildEncMap(t.nrcodes, t.values);
    store.set(id, m);
    return m;
  };

  // ---- 系数源：原解析或 newComponents 覆盖 ----
  const sources = scan.comps.map((sc) => {
    const comp = frame.components[sc.compIdx];
    if (!comp) throw new Error(`扫描引用的分量下标 ${sc.compIdx} 不存在`);
    const nw = newComponents ? newComponents[sc.compIdx] : null;
    const blocks = nw && nw.blocks ? nw.blocks : comp.blocks;
    const blocksDC = nw && nw.blocksDC ? nw.blocksDC : comp.blocksDC;
    if (blocks.length !== comp.blocks.length) {
      throw new Error(`分量 ${sc.compIdx} 的新 AC 系数长度 ${blocks.length} ≠ 原解析 ${comp.blocks.length}`);
    }
    if (blocksDC.length !== comp.blocksDC.length) {
      throw new Error(`分量 ${sc.compIdx} 的新 DC 系数长度 ${blocksDC.length} ≠ 原解析 ${comp.blocksDC.length}`);
    }
    return { comp, blocks, blocksDC, dcEnc: getMap(0, sc.td), acEnc: getMap(1, sc.ta), pred: 0 };
  });

  // ---- 块遍历顺序严格复刻 f5stego decodeScan（多分量交错 / 单分量两路） ----
  const bw = new BitWriter();
  const multi = sources.length > 1;
  const c0 = sources[0].comp;
  const rows = multi ? frame.mcusPerColumn : c0.blocksPerColumn;
  const cols = multi ? frame.mcusPerLine : c0.blocksPerLine;
  const totalMcus = rows * cols;

  let mcu = 0, rstIdx = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (multi) {
        for (const s of sources) {
          const c = s.comp;
          for (let j = 0; j < c.v; j++) {
            for (let k = 0; k < c.h; k++) {
              const pos = ((y * c.v + j) * c.blocksPerLineForMcu + x * c.h + k) * 64;
              encodeBlock(bw, s, pos);
            }
          }
        }
      } else {
        // 单分量扫描：decodeScan 用 blocksPerLine/Column 做界、blocksPerLineForMcu 做步长
        encodeBlock(bw, sources[0], (y * c0.blocksPerLineForMcu + x) * 64);
      }
      mcu++;
      // DRI 重启间隔：补 1 对齐 → 发 RSTn → 复位 DC 预测（与解码器逐位对齐；
      // 最后一个 MCU 之后不发 RST，解码器循环结束时也不再期待标记）
      if (scan.dri > 0 && mcu % scan.dri === 0 && mcu < totalMcus) {
        bw.pushMarker(0xffd0 + (rstIdx++ % 8));
        for (const s of sources) s.pred = 0;
      }
    }
  }

  // ---- 重组：SOI..SOS 头（字节级原样）+ 新熵数据 + 扫描后残余段 + EOI 尾 ----
  const head = raw.subarray(0, scan.entropyStart);
  const entropy = bw.finish();
  const eoiFrom = scan.eoiPos >= 0 ? scan.eoiPos : raw.length;
  const post = raw.subarray(scan.entropyEndPos, eoiFrom); // 扫描与 EOI 之间的段（如 DNL），原样保留
  const tail = scan.eoiPos >= 0
    ? raw.subarray(scan.eoiPos)                          // EOI 起（含 EOI 及其后续附加数据）
    : new Uint8Array([0xff, 0xd9]);                      // 原文件缺 EOI 时补一个
  return concatBytes(head, entropy, post, tail);
}

/**
 * 轻量扫描信息查询（供 jsteg 等调用方确定「第一个扫描分量」等）。
 * 返回 { comps:[{compIdx,td,ta}], multiScan, dri, entropyStart, progressive }。
 */
export function analyzeScans(parsed) {
  const frame = parsed && parsed.frame;
  if (!frame || !parsed._raw) {
    throw new Error("analyzeScans 需要 parseJpeg() 的解析结果");
  }
  const scan = scanSegments(parsed._raw, frame);
  return {
    comps: scan.comps,
    multiScan: scan.sosCount > 1,
    dri: scan.dri,
    entropyStart: scan.entropyStart,
    progressive: !!frame.progressive,
  };
}
