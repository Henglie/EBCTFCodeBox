/*
 * pietExec.js — Piet 图形语言解释器（cat:'fancy'）。
 *
 * 对标 npiet.exe。pietIdent（esolang2.js）只识别不执行，本 op 真执行：
 * 读色块网格 → DP/CC 状态机 → 栈操作 → 输出。opId 独立（pietExec）。
 *
 * 输入格式（纯文本网格，避免依赖图像解码器）：
 * 每行若干色块 token，空白分隔；行数 = 高，列数 = 宽（须矩形）。
 * token 用色码：色相首字母 + 明度后缀，或黑白。
 * 色相：R(红) Y(黄) G(绿) C(青) B(蓝) M(品红)
 * 明度：l=light 亮 / 空=normal 正常 / d=dark 暗 例：Rl Y Gd Cl B Md
 * 黑：K（阻挡） 白：W（自由滑行，不执行指令）
 * 也接受 6 位 hex（如 #FF0000 或 FFC0C0），自动量化到最近的 Piet 18 色/黑/白。
 *
 * 指令由「色相变化步数(0-5)」×「明度变化步数(0-2)」决定（Piet 官方表）。
 * 单向 run（图灵完备语言无逆运算，只执行）。步数 + 输出上限防死循环。
 *
 * 算法来源：David Morgan-Mar Piet 规范（dangermouse.net/esoteric/piet.html）。
 */
import { register } from "./registry.js";

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
  const { grid, h, w } = parseGrid(text);

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

 // 找起始 codel：左上角第一个非黑（Piet 从 (0,0) 起，(0,0) 通常有色）
 // 规范：程序从最左上 codel 开始，DP=右，CC=左。
  let startX = 0, startY = 0;
  if (grid[0][0].kind === "black") throw new Error("Piet: 起始 codel (0,0) 为黑，无法启动");

  const stack = [];
  let out = "";
  let dp = 0, cc = 0;
  let cx = startX, cy = startY;
  let steps = 0;

 // 指令实现
  function doCmd(name, blockSize) {
    const pop = () => stack.pop();
    switch (name) {
      case "push": stack.push(blockSize); break;
      case "pop": stack.pop(); break;
      case "add": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a+b); break; }
      case "sub": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a-b); break; }
      case "mul": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a*b); break; }
      case "div": { const b=pop(),a=pop(); if(a==null||b==null||b===0){push2(a,b);break;} stack.push(Math.floor(a/b)); break; }
      case "mod": { const b=pop(),a=pop(); if(a==null||b==null||b===0){push2(a,b);break;} stack.push(((a%b)+b)%b); break; }
      case "not": { const a=pop(); if(a==null)break; stack.push(a===0?1:0); break; }
      case "gt": { const b=pop(),a=pop(); if(a==null||b==null){push2(a,b);break;} stack.push(a>b?1:0); break; }
      case "ptr": { const a=pop(); if(a==null)break; dp=((dp + (a%4)) % 4 + 4)%4; break; }
      case "sw": { const a=pop(); if(a==null)break; if((((a%2)+2)%2)===1) cc = cc^1; break; }
      case "dup": { const a=pop(); if(a==null)break; stack.push(a); stack.push(a); break; }
      case "roll": {
        const b=pop(),a=pop();
        if(a==null||b==null){push2(a,b);break;}
        const depth=a, rolls=b;
        if(depth<0||depth>stack.length){ stack.push(a); stack.push(b); break; }
        if(depth>0){
          let r=((rolls%depth)+depth)%depth;
          const part=stack.splice(stack.length-depth, depth);
          for(let i=0;i<r;i++) part.unshift(part.pop());
          stack.push(...part);
        }
        break;
      }
      case "innum": break;  // 无 stdin
      case "inchar": break; // 无 stdin
      case "outnum": { const a=pop(); if(a==null)break; if(out.length<MAX_OUT) out += String(a); break; }
      case "outchar": { const a=pop(); if(a==null)break; if(out.length<MAX_OUT) out += String.fromCodePoint(((a%0x110000)+0x110000)%0x110000); break; }
    }
  }
  function push2(a,b){ if(a!=null)stack.push(a); if(b!=null)stack.push(b); }

 // 主循环
 // 状态循环检测：无 stdin 的 Piet 是确定性的，(cx,cy,dp,cc) 重复即进入无限循环 → 判定终止。
 // 这是无输入 Piet 的合法停机判据（真实带黑块陷阱的程序同样落到某状态无法脱出）。
  const seen = new Set();
  let attempts = 0; // 连续找不到出路的尝试次数
  while (steps < MAX_STEPS) {
    steps++;
    const stateKey = cx + "," + cy + "," + dp + "," + cc;
    if (seen.has(stateKey)) break; // 状态循环 → 停机
    seen.add(stateKey);
    const curCell = grid[cy][cx];
    if (curCell.kind === "black") break; // 不应发生
    const block = blockOf(cx, cy);
    const blockSize = block.length;

 // 选出口 codel，向 DP 前进一格
    const [ex, ey] = chooseExit(block, dp, cc);
    const nx = ex + DXY[dp][0], ny = ey + DXY[dp][1];

    if (isBlocked(nx, ny)) {
 // 受阻：先转 CC，再转 DP，最多 8 次
      attempts++;
      if (attempts >= 8) break; // 程序终止
      if (attempts % 2 === 1) cc = cc ^ 1;
      else dp = (dp + 1) % 4;
      continue;
    }
    attempts = 0;

    const nextCell = grid[ny][nx];
    if (nextCell.kind === "white") {
 // 白色：自由滑行，不执行指令，直行到非白（遇黑或边界则受阻处理）
      let sx = nx, sy = ny;
      let slideSteps = 0;
      while (true) {
        if (++slideSteps > w * h * 4) { break; }
        const fx = sx + DXY[dp][0], fy = sy + DXY[dp][1];
        if (isBlocked(fx, fy)) {
 // 白中受阻：转 DP+CC（Piet 白滑行受阻规则），标记
          cc = cc ^ 1; dp = (dp + 1) % 4;
 // 继续从当前白 codel 尝试
          const gx = sx + DXY[dp][0], gy = sy + DXY[dp][1];
          if (isBlocked(gx, gy)) { attempts = 1; break; }
          sx = gx; sy = gy;
          if (grid[sy][sx].kind !== "white") break;
          continue;
        }
        sx = fx; sy = fy;
        if (grid[sy][sx].kind !== "white") break;
      }
      if (attempts === 1) { continue; }
 // 落到非白 codel：白滑行不执行指令
      if (grid[sy][sx].kind === "black") { continue; }
      cx = sx; cy = sy;
      continue;
    }

 // 进入有色块：按色相/明度差执行指令
    const hueDiff = (nextCell.hue - curCell.hue + 6) % 6;
    const lightDiff = (nextCell.light - curCell.light + 3) % 3;
    const cmd = CMD_TABLE[hueDiff][lightDiff];
    if (cmd) doCmd(cmd, blockSize);
    cx = nx; cy = ny;
  }

  return { out, stack, steps };
}

function pietRun(text) {
  const { out, stack, steps } = pietRunGrid(text);
  const lines = [];
  lines.push(out === "" ? "(无输出)" : out);
  lines.push("");
  lines.push("--- 执行摘要 ---");
  lines.push("步数: " + steps + (steps >= MAX_STEPS ? " (达上限)" : ""));
  lines.push("终栈: [" + stack.join(", ") + "]");
  return lines.join("\n");
}

// ---- 注册 ----
register({
  id: "pietExec", cat: "fancy", name: "Piet 执行",
  desc: "Piet 图形语言解释器（色块网格文本→DP/CC 状态机执行→输出）。token 用色码 Rl/Y/Gd/C/B/M + K黑 W白，或 6 位 hex 自动量化。对标 npiet，仅执行。",
  params: [],
  run: pietRun,
  detect: () => 0,
});

export { pietRun, pietRunGrid, parseGrid, parseToken, PIET_RGB, CMD_TABLE };


