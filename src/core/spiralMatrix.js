/*
 * spiralMatrix.js — 螺旋矩阵读取（网格字符按螺旋顺序展开 ↔ 文本，cat:'analysis'，双向）。
 *
 * 定位：CTF misc 高频。flag 被打散填进 N×M 方阵，按顺时针/逆时针螺旋读取还原。
 * 对应 all-in-one tem_exp_add「螺旋矩阵读取」项。
 *
 * decode（读）：输入是矩阵（多行文本 / 一整串按行列填）。按螺旋顺序取字符 → 明文。
 * encode（写）：把明文按螺旋顺序填进 N×M 方阵 → 输出矩阵文本（供检验/出题）。
 *
 * 螺旋方向：默认「顺时针、从左上角起、向右」（右→下→左→上，逐圈内收）。
 * 支持逆时针（先向下）。起点固定左上角（CTF 最常见）。
 *
 * 输入解析（decode）：
 * - 多行 → 每行一行，按最长行右侧补空（矩阵可不规整，缺格记空）
 * - 单行 + 指定列数 cols → 按 cols 切成矩阵
 *
 * 契约：register({id, cat:'analysis', name, desc, params, encode, decode})。
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 *
 * 参考：LeetCode 54/59 螺旋矩阵标准算法 + all-in-one 决策案「tem_exp_add 真缺 3 个」。
 */
import { register } from "./registry.js";

// 生成 rows×cols 的螺旋访问坐标序列（顺时针从左上、向右起）
function spiralOrder(rows, cols) {
  const order = [];
  let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let c = left; c <= right; c++) order.push([top, c]);   // →
    top++;
    for (let r = top; r <= bottom; r++) order.push([r, right]); // ↓
    right--;
    if (top <= bottom) {
      for (let c = right; c >= left; c--) order.push([bottom, c]); // ←
      bottom--;
    }
    if (left <= right) {
      for (let r = bottom; r >= top; r--) order.push([r, left]); // ↑
      left++;
    }
  }
  return order;
}

// 逆时针从左上、向下起：等价于把顺时针序列的「行列角色」镜像。
// 直接单独生成（左→下→右→上... 实为 下→右→上→左 逐圈）。
function spiralOrderCCW(rows, cols) {
  const order = [];
  let top = 0, bottom = rows - 1, left = 0, right = cols - 1;
  while (top <= bottom && left <= right) {
    for (let r = top; r <= bottom; r++) order.push([r, left]);   // ↓
    left++;
    for (let c = left; c <= right; c++) order.push([bottom, c]); // →
    bottom--;
    if (left <= right) {
      for (let r = bottom; r >= top; r--) order.push([r, right]); // ↑
      right--;
    }
    if (top <= bottom) {
      for (let c = right; c >= left; c--) order.push([top, c]); // ←
      top++;
    }
  }
  return order;
}

// 把输入文本解析成二维网格
function parseGrid(text, forceCols) {
  const raw = String(text == null ? "" : text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (forceCols && forceCols > 0) {
 // 单串按 cols 切（去掉换行，视为连续字符流）
    const flat = raw.replace(/\n/g, "");
    const cols = forceCols;
    const grid = [];
    for (let i = 0; i < flat.length; i += cols) {
      grid.push(Array.from(flat.slice(i, i + cols)));
    }
 // 末行右补空
    if (grid.length && grid[grid.length - 1].length < cols) {
      const last = grid[grid.length - 1];
      while (last.length < cols) last.push(" ");
    }
    return grid;
  }
 // 多行模式：每行一行，右侧补空对齐最长行
  const rows = raw.split("\n");
 // 去掉尾部纯空行
  while (rows.length && rows[rows.length - 1] === "") rows.pop();
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return rows.map((r) => {
    const arr = Array.from(r);
    while (arr.length < width) arr.push(" ");
    return arr;
  });
}

function spiralDecode(text, p) {
  const dir = (p && p.dir) || "cw";
  const forceCols = parseInt((p && p.cols) || "0", 10) || 0;
  const grid = parseGrid(text, forceCols);
  const rows = grid.length;
  const cols = rows ? grid[0].length : 0;
  if (rows === 0 || cols === 0) return "（空矩阵。输入多行文本，或单行 + 指定列数）";

  const order = dir === "ccw" ? spiralOrderCCW(rows, cols) : spiralOrder(rows, cols);
  let out = "";
  for (const [r, c] of order) {
    out += grid[r] && grid[r][c] !== undefined ? grid[r][c] : "";
  }

  const lines = [];
  lines.push("=== 螺旋矩阵读取 ===");
  lines.push("矩阵: " + rows + " 行 × " + cols + " 列，方向: " + (dir === "ccw" ? "逆时针(先向下)" : "顺时针(先向右)") + "，起点左上");
  lines.push("");
  lines.push("--- 螺旋展开 ---");
  lines.push(out);
  return lines.join("\n");
}

function spiralEncode(text, p) {
  const dir = (p && p.dir) || "cw";
  const chars = Array.from(String(text == null ? "" : text));
  const n = chars.length;
  if (n === 0) return "（空输入）";

 // 指定列数则用之，否则取近似正方形
  let cols = parseInt((p && p.cols) || "0", 10) || 0;
  if (cols <= 0) cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);

  const grid = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  const order = dir === "ccw" ? spiralOrderCCW(rows, cols) : spiralOrder(rows, cols);
  for (let i = 0; i < order.length && i < n; i++) {
    const [r, c] = order[i];
    grid[r][c] = chars[i];
  }

  const lines = [];
  lines.push("=== 螺旋矩阵填充 ===");
  lines.push("矩阵: " + rows + " 行 × " + cols + " 列，方向: " + (dir === "ccw" ? "逆时针(先向下)" : "顺时针(先向右)"));
  lines.push("");
  for (const row of grid) lines.push(row.join(""));
  return lines.join("\n");
}

register({
  id: "spiralMatrix",
  cat: "analysis",
  name: "螺旋矩阵读取",
  desc: "网格字符按螺旋顺序 ↔ 文本：顺/逆时针、左上起、逐圈内收。解码=读矩阵，编码=按螺旋填矩阵。单行输入可指定列数切块",
  params: [
    {
      key: "dir", label: "螺旋方向", type: "select", default: "cw",
      options: [
        { value: "cw", label: "顺时针（先向右）" },
        { value: "ccw", label: "逆时针（先向下）" },
      ],
    },
    { key: "cols", label: "列数（单行输入/编码用，0=自动近似方阵）", type: "number", default: 0, placeholder: "0=自动" },
  ],
  encode: spiralEncode,
  decode: spiralDecode,
});

export { spiralOrder, spiralOrderCCW, spiralDecode, spiralEncode };
