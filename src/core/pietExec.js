/*
 * pietExec.js — Piet 图形语言解释器（cat:'fancy'）。
 *
 * 对标 npiet.exe（npiet v1.3）。pietIdent（esolang2.js）只识别不执行，本 op 真执行：
 * 读色块网格 → DP/CC 状态机 → 栈操作 → 输出。opId 独立（pietExec）。
 *
 * 输入格式（两种）：
 * ① 真图像：PNG 字节（拖入文件走 rawBytes 通道，acceptsBytes；文本态贴 base64 亦可）。
 *    npiet 桥补齐路径（T387）：逐像素分类到 Piet 18 色 + 黑白（npiet 口径：未知色按白），
 *    解压复用 pcapDeep.inflateRaw（zlib = 2B 头 + raw deflate，同 compress.js 范式）。
 * ② 纯文本网格：每行若干色块 token，空白分隔；行数 = 高，列数 = 宽（须矩形）。
 *    token 用色码：色相首字母 + 明度后缀，或黑白。
 *    色相：R(红) Y(黄) G(绿) C(青) B(蓝) M(品红)
 *    明度：l=light 亮 / 空=normal 正常 / d=dark 暗 例：Rl Y Gd Cl B Md
 *    黑：K（阻挡） 白：W（自由滑行，不执行指令）
 *    也接受 6 位 hex（如 #FF0000 或 FFC0C0）。
 *
 * 执行语义（对齐 npiet / David Morgan-Mar Piet 规范）：
 * 指令由「色相变化步数(0-5)」×「明度变化步数(0-2)」决定（Piet 官方表）。
 * 受阻时先 toggle CC 再转 DP，交替最多 8 次，每次**重选出口 codel**；
 * 白块滑行不执行指令，受阻同样 CC/DP 交替重试；8 次全失败 → 程序终止。
 * 单向 run（图灵完备语言无逆运算，只执行）。步数上限防死循环。
 *
 * 算法来源：David Morgan-Mar Piet 规范（dangermouse.net/esoteric/piet.html），
 * 对拍基准 npiet v1.3（tools/exe/cli/npiet）。
 */
import { register } from "./registry.js";
import { inflateRaw } from "./pcapDeep.js";

const MAX_STEPS = 1_000_000;
const MAX_OUT = 100_000;

// 18 色：色相(hue) 0..5 × 明度(light) 0..2。light: 0=亮,1=正常,2=暗。
// 官方 RGB 表。
const HUES = ["R", "Y", "G", "C", "B", "M"];
const PIET_RGB = [
 // light(亮) normal(正常) dark(暗)
  [[0xFF,0xC0,0xC0],[0xFF,0x00,0x00],[0xC0,0x00,0x00]], // R 红
  [[0xFF,0xFF,0xC0],[0xFF,0xFF,0x00],[0xC0,0xC0,0x00]], // Y 黄
  [[0xC0,0xFF,0xC0],[0x00,0xFF,0x00],[0x00,0xC0,0x00]], // G 绿
  [[0xC0,0xFF,0xFF],[0x00,0xFF,0xFF],[0x00,0xC0,0xC0]], // C 青
  [[0xC0,0xC0,0xFF],[0x00,0x00,0xFF],[0x00,0x00,0xC0]], // B 蓝
  [[0xFF,0xC0,0xFF],[0xFF,0x00,0xFF],[0xC0,0x00,0xC0]], // M 品红
];
const WHITE = "W", BLACK = "K";

// 色码 token → 内部色 {kind:'color',hue,light} | {kind:'white'} | {kind:'black'}
function parseToken(tok) {
  const t = tok.trim();
  if (!t) return null;
 // hex 形式
  if (/^#?[0-9a-fA-F]{6}$/.test(t)) return quantizeHex(t.replace("#", ""));
  const up = t.toUpperCase();
  if (up === "K" || up === "BK" || up === "BLACK") return { kind: "black" };
  if (up === "W" || up === "WT" || up === "WHITE") return { kind: "white" };
 // 色相 + 明度后缀
  const hueCh = up[0];
  const hue = HUES.indexOf(hueCh);
  if (hue < 0) throw new Error("Piet: 无法识别色码 '" + tok + "'");
  let light = 1; // 默认 normal
  const suf = t.slice(1).toLowerCase();
  if (suf === "l") light = 0;
  else if (suf === "d") light = 2;
  else if (suf === "" || suf === "n") light = 1;
  else throw new Error("Piet: 明度后缀非法 '" + tok + "'（用 l/d/空）");
  return { kind: "color", hue, light };
}

function quantizeHex(hex) {
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
 // 白/黑判定
  if (r > 0xE0 && g > 0xE0 && b > 0xE0) return { kind: "white" };
  if (r < 0x30 && g < 0x30 && b < 0x30) return { kind: "black" };
 // 找最近 18 色
  let best = null, bestD = Infinity;
  for (let h = 0; h < 6; h++) for (let l = 0; l < 3; l++) {
    const [pr, pg, pb] = PIET_RGB[h][l];
    const d = (pr - r) ** 2 + (pg - g) ** 2 + (pb - b) ** 2;
    if (d < bestD) { bestD = d; best = { kind: "color", hue: h, light: l }; }
  }
  return best;
}

// 解析网格文本 → 二维 cell 数组
function parseGrid(text) {
  const rows = String(text).replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (!rows.length) throw new Error("Piet: 空程序");
  const grid = rows.map((line) => line.trim().split(/\s+/).map(parseToken).filter(Boolean));
  const w = grid[0].length;
  for (const r of grid) if (r.length !== w) throw new Error("Piet: 网格非矩形（各行 token 数须一致）");
  return { grid, h: grid.length, w };
}

// ============ PNG 解码（npiet 桥补齐：pietExec 吃真图像） ============

const PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

function isPngBytes(bytes) {
  if (!bytes || bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== PNG_SIG[i]) return false;
  return true;
}

function u32be(b, o) { return (b[o] << 24 | b[o + 1] << 16 | b[o + 2] << 8 | b[o + 3]) >>> 0; }

/**
 * PNG → RGBA 像素（8/16 位；colorType 0 灰 / 2 RGB / 3 调色板 / 4 灰+α / 6 RGBA；不支持隔行）。
 * @returns {{w:number, h:number, rgba:Uint8Array}} rgba = w*h*4
 */
function decodePng(bytes) {
  if (!isPngBytes(bytes)) throw new Error("Piet: 图像输入仅支持 PNG（缺 PNG 签名）");
  let off = 8, w = 0, h = 0, depth = 8, colorType = 6, interlace = 0;
  let plte = null, trns = null, idat = [];
  while (off + 8 <= bytes.length) {
    const len = u32be(bytes, off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const d = off + 8;
    if (type === "IHDR") {
      w = u32be(bytes, d); h = u32be(bytes, d + 4);
      depth = bytes[d + 8]; colorType = bytes[d + 9]; interlace = bytes[d + 12];
    } else if (type === "PLTE") {
      plte = bytes.slice(d, d + len);
    } else if (type === "tRNS") {
      trns = bytes.slice(d, d + len);
    } else if (type === "IDAT") {
      idat.push(bytes.slice(d, d + len));
    } else if (type === "IEND") {
      break;
    }
    off = d + len + 4; // 跳过 CRC
  }
  if (!w || !h) throw new Error("Piet: PNG 缺 IHDR");
  if (interlace) throw new Error("Piet: 不支持隔行 PNG（Adam7），请另存为常规扫描");
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CH) throw new Error("Piet: 不支持的 PNG 颜色类型 " + colorType);
  if (colorType === 3) {
    if (![1, 2, 4, 8].includes(depth)) throw new Error("Piet: 调色板 PNG 位深仅允许 1/2/4/8（当前 " + depth + " 位）");
  } else if (depth !== 8 && depth !== 16) {
    throw new Error("Piet: 仅支持 8/16 位 PNG（当前 " + depth + " 位）");
  }
  if (!idat.length) throw new Error("Piet: PNG 缺 IDAT 数据块");
  const zbuf = idat.length === 1 ? idat[0] : idat.reduce((a, b) => { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c; });
  if (zbuf.length < 3) throw new Error("Piet: PNG IDAT 过短");
  const raw = inflateRaw(zbuf.subarray(2)); // zlib = 2B 头 + raw deflate + adler（inflateRaw 忽略 adler）
  const stride = Math.ceil(w * CH * depth / 8);
  const bpp = Math.max(1, Math.floor(CH * depth / 8));
  if (raw.length < stride * h) throw new Error("Piet: PNG 解压后数据不足（图可能被截断）");
  // 反滤波（PNG filter 0-4）
  const img = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const rv = raw[src + x];
      const left = x >= bpp ? img[dst + x - bpp] : 0;
      const up = y > 0 ? img[dst + x - stride] : 0;
      const ul = (y > 0 && x >= bpp) ? img[dst + x - bpp - stride] : 0;
      let v;
      if (ft === 0) v = rv;
      else if (ft === 1) v = rv + left;
      else if (ft === 2) v = rv + up;
      else if (ft === 3) v = rv + ((left + up) >> 1);
      else { // 4 Paeth
        const p = left + up - ul, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - ul);
        v = rv + ((pa <= pb && pa <= pc) ? left : (pb <= pc) ? up : ul);
      }
      img[dst + x] = v & 0xFF;
    }
  }
  // → RGBA
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const rowOff = y * stride;
    const pd = depth / 8; // 每通道字节数（8→1，16→取高字节）
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 255;
      const base = rowOff + x * CH * pd;
      if (colorType === 2) { r = img[base]; g = img[base + pd]; b = img[base + pd * 2]; }
      else if (colorType === 6) { r = img[base]; g = img[base + pd]; b = img[base + pd * 2]; a = img[base + pd * 3]; }
      else if (colorType === 0) { r = g = b = img[base]; }
      else if (colorType === 4) { r = g = b = img[base]; a = img[base + pd]; }
      else if (colorType === 3) {
        const bitPos = x * depth;
        const idx = (img[rowOff + (bitPos >> 3)] >> (8 - depth - (bitPos & 7))) & ((1 << depth) - 1);
        if (!plte || (idx + 1) * 3 > plte.length) { r = g = b = 0; a = 0; }
        else {
          r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
          a = trns && idx < trns.length ? trns[idx] : 255;
        }
      }
      const o = (y * w + x) * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    }
  }
  return { w, h, rgba };
}

// npiet 口径：像素 → Piet 颜色（18 色 + 黑白精确匹配；未知色按白 = npiet 默认 -u 白）
function classifyPiet(r, g, b) {
  if (r === 0xFF && g === 0xFF && b === 0xFF) return { kind: "white" };
  if (r === 0 && g === 0 && b === 0) return { kind: "black" };
  for (let hu = 0; hu < 6; hu++) for (let li = 0; li < 3; li++) {
    const [pr, pg, pb] = PIET_RGB[hu][li];
    if (r === pr && g === pg && b === pb) return { kind: "color", hue: hu, light: li };
  }
  return { kind: "white" }; // npiet 默认：未知颜色按白处理（-uu/-ub 未启用）
}

/** PNG RGBA → cell 网格（codelSize 取样，默认 1） */
function imageToCells(rgba, w, h, codelSize) {
  const cs = Math.max(1, Math.floor(codelSize || 1));
  const cw = Math.floor(w / cs), chh = Math.floor(h / cs);
  if (!cw || !chh) throw new Error("Piet: 图像小于一个 codel");
  const grid = [];
  for (let cy = 0; cy < chh; cy++) {
    const row = [];
    for (let cx = 0; cx < cw; cx++) {
      const o = (cy * cs * w + cx * cs) * 4;
      if (rgba[o + 3] === 0) { row.push({ kind: "white" }); continue; } // 全透明按白
      row.push(classifyPiet(rgba[o], rgba[o + 1], rgba[o + 2]));
    }
    grid.push(row);
  }
  return { grid, h: chh, w: cw };
}

// ============ 指令表：色相变化(0-5) × 明度变化(0-2) ============
// 官方表（rows=色相差 0..5, cols=明度差 0..2）
const CMD_TABLE = [
  [null,      "push",    "pop"],      // hueDiff 0
  ["add",     "sub",     "mul"],      // 1
  ["div",     "mod",     "not"],      // 2
  ["gt",      "ptr",     "sw"],       // 3
  ["dup",     "roll",    "innum"],    // 4
  ["inchar",  "outnum",  "outchar"],  // 5
];

// ============ 主执行 ============
function pietRunGrid(text) {
  return pietRunCells(parseGrid(text));
}

/** 解释器核心：{grid, h, w} → {out, stack, steps}（文本网格与图像输入共用） */
function pietRunCells({ grid, h, w }) {
  const sameColor = (a, b) =>
    a.kind === b.kind &&
    (a.kind !== "color" || (a.hue === b.hue && a.light === b.light));
  const isBlocked = (x, y) =>
    x < 0 || y < 0 || x >= w || y >= h || grid[y][x].kind === "black";

 // flood fill 求 (x,y) 所在同色块的所有 codel
  function blockOf(x, y) {
    const target = grid[y][x];
    const seen = new Set();
    const cells = [];
    const st = [[x, y]];
    seen.add(y * w + x);
    while (st.length) {
      const [cx, cy] = st.pop();
      cells.push([cx, cy]);
      for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
        if (nx<0||ny<0||nx>=w||ny>=h) continue;
        const key = ny * w + nx;
        if (seen.has(key)) continue;
        if (sameColor(grid[ny][nx], target)) { seen.add(key); st.push([nx, ny]); }
      }
    }
    return cells;
  }

 // 在色块中按 DP/CC 选出口 codel
 // DP: 0=右,1=下,2=左,3=上 CC: 0=左,1=右
  function chooseExit(cells, dp, cc) {
 // 先按 DP 方向取极值边，再按 CC 取该边的极值角
    let best = null;
    for (const [cx, cy] of cells) {
      if (best === null) { best = [cx, cy]; continue; }
      if (betterCodel(cx, cy, best[0], best[1], dp, cc)) best = [cx, cy];
    }
    return best;
  }
  function betterCodel(x, y, bx, by, dp, cc) {
 // 主方向优先
    const primary = (v, axis, dir) => dir === 0 ? v : -v; // 占位
 // DP 主轴取极值
    switch (dp) {
      case 0: if (x !== bx) return x > bx; break; // 右：x 最大
      case 1: if (y !== by) return y > by; break; // 下：y 最大
      case 2: if (x !== bx) return x < bx; break; // 左：x 最小
      case 3: if (y !== by) return y < by; break; // 上：y 最小
    }
 // 同主轴，按 CC 取次轴。CC 相对 DP 左/右手。
 // 次轴方向 = DP 顺时针(右CC) 或逆时针(左CC) 转 90°
    const ccDir = (dp + (cc === 1 ? 1 : 3)) % 4;
    switch (ccDir) {
      case 0: return x > bx;
      case 1: return y > by;
      case 2: return x < bx;
      case 3: return y < by;
    }
    return false;
  }

  const DXY = [[1,0],[0,1],[-1,0],[0,-1]]; // dp 方向增量

 // 规范：程序从最左上 codel 开始，DP=右，CC=左（npiet 口径；起始黑块 → 无输出终止）。
  const stack = [];
  let out = "";
  let dp = 0, cc = 0;
  let cx = 0, cy = 0;
  let steps = 0;
  let terminated = grid[0][0].kind === "black";

 // 指令实现
  function doCmd(name, blockSize) {
    const pop = () => stack.pop();
    switch (name) {
      case "push": stack.push(blockSize); break;
      case "pop": pop(); break;
      case "add": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a+b); break; }
      case "sub": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a-b); break; }
      case "mul": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a*b); break; }
      case "div": { const b=pop(),a=pop(); if(a==null||b==null||b===0){push2(a,b);break;} stack.push(Math.trunc(a/b)); break; } // C '/' 截断语义（对齐 npiet）
      case "mod": { const b=pop(),a=pop(); if(a==null||b==null||b===0){push2(a,b);break;} stack.push(a%b); break; } // C '%' 语义（对齐 npiet，符号随被除数）
      case "not": { const a=pop(); if(a==null)break; stack.push(a===0?1:0); break; }
      case "gt": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a>b?1:0); break; }
      case "ptr": { const a=pop(); if(a==null)break; dp=((dp + (a%4)) % 4 + 4)%4; break; }
      case "sw": { const a=pop(); if(a==null)break; if((((a%2)+2)%2)===1) cc = cc^1; break; }
      case "dup": { const a=pop(); if(a==null)break; stack.push(a); stack.push(a); break; }
      case "roll": {
        const b=pop(),a=pop(); // 先 pop 滚动数，再 pop 深度（规范顺序）
        if(a==null||b==null){push2(a,b);break;}
        const depth=a, rolls=b;
        if (depth > 0 && rolls !== 0 && depth <= stack.length) {
          let r = rolls % depth; if (r < 0) r += depth;
          const top = stack.length, start = top - depth;
          for (let i = 0; i < r; i++) { // npiet 口径（实测对拍）：顶元素移向窗口深处
            const tmp = stack[top - 1];
            for (let j = top - 1; j > start; j--) stack[j] = stack[j - 1];
            stack[start] = tmp;
          }
        }
        break;
      }
      case "innum": break;  // 无 stdin
      case "inchar": break; // 无 stdin
      case "outnum": { const a=pop(); if(a==null)break; if(out.length<MAX_OUT) out += String(a); break; }
      case "outchar": { const a=pop(); if(a==null)break; if(out.length<MAX_OUT) out += String.fromCharCode(a & 0xFF); break; } // putchar 字节口径（对齐 npiet）
    }
  }
  function push2(a,b){ if(a!=null)stack.push(a); if(b!=null)stack.push(b); }

 // 受阻重试：toggle CC → 转 DP 交替（最多 8 次，每次按规范**重选出口 codel**）
  function retryMoveFromBlock(cells) {
    for (let t = 1; t <= 8; t++) {
      if (t % 2 === 1) cc ^= 1; else dp = (dp + 1) % 4;
      const [ex, ey] = chooseExit(cells, dp, cc);
      const nx = ex + DXY[dp][0], ny = ey + DXY[dp][1];
      if (!isBlocked(nx, ny)) return [nx, ny];
    }
    return null; // 8 次全失败 → 程序终止
  }

 // 白块滑行：不执行指令；出口沿 DP 前进，受阻同样 CC/DP 交替重试；返回落点（有色块坐标）
  function slideWhite(sx0, sy0) {
    let sx = sx0, sy = sy0;
    while (true) {
      const wBlock = blockOf(sx, sy);
      const [wex, wey] = chooseExit(wBlock, dp, cc);
      let nx = wex + DXY[dp][0], ny = wey + DXY[dp][1];
      if (isBlocked(nx, ny)) {
        const moved = retryMoveFromBlock(wBlock);
        if (!moved) return null;
        nx = moved[0]; ny = moved[1];
      }
      sx = nx; sy = ny;
      if (grid[sy][sx].kind !== "white") return [sx, sy]; // 滑出白块（黑已被 isBlocked 拦住，不会落到这）
    }
  }

 // 主循环（npiet 语义：无状态去重，靠受阻 8 次终止 + 步数护栏；合法循环程序可正常跑）
  while (!terminated && steps < MAX_STEPS) {
    const curCell = grid[cy][cx];
    if (curCell.kind === "black") break; // 不应发生
    if (curCell.kind === "white") {
      const land = slideWhite(cx, cy);
      if (!land) terminated = true;
      else { cx = land[0]; cy = land[1]; }
      continue;
    }
    const block = blockOf(cx, cy);
    const blockSize = block.length;
    const [ex, ey] = chooseExit(block, dp, cc);
    let nx = ex + DXY[dp][0], ny = ey + DXY[dp][1];

    if (isBlocked(nx, ny)) {
      const moved = retryMoveFromBlock(block);
      if (!moved) break; // 程序终止
      nx = moved[0]; ny = moved[1];
    }

    const nextCell = grid[ny][nx];
    if (nextCell.kind === "white") {
      const land = slideWhite(nx, ny);
      if (!land) break;
      cx = land[0]; cy = land[1];
      continue;
    }

 // 进入有色块：按色相/明度差执行指令（白滑行路径不执行，已 continue）
    steps++;
    const hueDiff = (nextCell.hue - curCell.hue + 6) % 6;
    const lightDiff = (nextCell.light - curCell.light + 3) % 3;
    const cmd = CMD_TABLE[hueDiff][lightDiff];
    if (cmd) doCmd(cmd, blockSize);
    cx = nx; cy = ny;
  }

  return { out, stack, steps };
}

function pietRun(text, p = {}) {
 // 图像输入（npiet 桥补齐）：rawBytes 通道或 base64 PNG 签名
  let cells = null;
  if (p && p.rawBytes && p.rawBytes.length) {
    cells = imageToCellsFromBytes(p.rawBytes, p.codelSize);
  }
  if (!cells && typeof text === "string") {
    const trimmed = text.trim();
    if (/^(data:image|iVBORw0KGgo)/.test(trimmed.slice(0, 20))) {
      // base64（可带 dataURL 前缀）→ PNG 字节（iVBORw0KGgo = PNG 签名的 base64 前缀）
      const b64 = text.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
      let bin;
      if (typeof atob === "function") bin = atob(b64);
      else bin = Buffer.from(b64, "base64").toString("binary");
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      cells = imageToCellsFromBytes(bytes, p.codelSize);
    }
  }
  if (!cells) cells = pietRunGrid(text);
  const { out, stack, steps } = cells;
  const lines = [];
  lines.push(out === "" ? "(无输出)" : out);
  lines.push("");
  lines.push("--- 执行摘要 ---");
  lines.push("步数: " + steps + (steps >= MAX_STEPS ? " (达上限)" : ""));
  lines.push("终栈: [" + stack.join(", ") + "]");
  return lines.join("\n");
}

// 图像字节 → 执行结果（PNG → cells → 解释器）
function imageToCellsFromBytes(bytes, codelSize) {
  const png = decodePng(bytes);
  const cells = imageToCells(png.rgba, png.w, png.h, codelSize);
  return pietRunCells(cells);
}

// ---- 注册 ----
register({
  id: "pietExec", cat: "esolang", name: "Piet 执行",
  desc: "Piet 图形语言解释器（DP/CC 状态机执行→输出）。支持真图像输入（PNG 拖入/粘贴 base64，npiet 补齐路径）与色块网格文本（色码 Rl/Y/Gd/C/B/M + K黑 W白 或 6 位 hex）。执行语义对齐 npiet v1.3，仅执行。",
  params: [
    { key: "codelSize", label: "codel 尺寸（图像输入）", type: "number", default: 1, placeholder: "图像里 1 个 codel 的边长像素，默认 1" },
  ],
  run: pietRun,
  acceptsBytes: true,
  detect: () => 0,
});

export { pietRun, pietRunGrid, pietRunCells, imageToCellsFromBytes, decodePng, parseGrid, parseToken, PIET_RGB, CMD_TABLE };
