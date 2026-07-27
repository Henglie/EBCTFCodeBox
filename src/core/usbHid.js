/*
 * usbHid.js — USB HID 流量解析组（cat:'analysis'，单向 run 输出报告文本）。
 *
 * 来源：USB HID Usage Table 照 USB HID 1.21 规范照抄不编造。
 * - usbKeyboard：解析 USB 键盘 leftover capture data（8 字节 HID 报告：
 * byte0=Modifier, byte1=Reserved, byte2-7=Keycodes 1-6），还原按键输入。
 * - usbMouse：解析 USB 鼠标 leftover capture data（boot 协议 4 字节报告：
 * byte0=按钮, byte1=X 位移, byte2=Y 位移, byte3=滚轮），还原鼠标轨迹。
 *
 * 契约：件内自注册，只 import { register } from "./registry.js"。
 * - run 单向，返回报告文本（非 hex）。
 * - decodeKeyboard/decodeMouse 也 export 供测试直接调用。
 */
import { register } from "./registry.js";

// ============ HID Keyboard Usage Table（USB HID 1.21 规范 Keyboard usage page 0x07 照抄） ============
// 每项 [无 Shift, 有 Shift]；0x04-0x1d 为 a-z，0x1e-0x27 为 1-0
// 0x28+ 为控制键/符号键，照规范抄，不编造。
const HID_KBD = {
  0x04: ["a", "A"], 0x05: ["b", "B"], 0x06: ["c", "C"], 0x07: ["d", "D"],
  0x08: ["e", "E"], 0x09: ["f", "F"], 0x0a: ["g", "G"], 0x0b: ["h", "H"],
  0x0c: ["i", "I"], 0x0d: ["j", "J"], 0x0e: ["k", "K"], 0x0f: ["l", "L"],
  0x10: ["m", "M"], 0x11: ["n", "N"], 0x12: ["o", "O"], 0x13: ["p", "P"],
  0x14: ["q", "Q"], 0x15: ["r", "R"], 0x16: ["s", "S"], 0x17: ["t", "T"],
  0x18: ["u", "U"], 0x19: ["v", "V"], 0x1a: ["w", "W"], 0x1b: ["x", "X"],
  0x1c: ["y", "Y"], 0x1d: ["z", "Z"],
  0x1e: ["1", "!"], 0x1f: ["2", "@"], 0x20: ["3", "#"], 0x21: ["4", "$"],
  0x22: ["5", "%"], 0x23: ["6", "^"], 0x24: ["7", "&"], 0x25: ["8", "*"],
  0x26: ["9", "("], 0x27: ["0", ")"],
  0x28: ["\n", "\n"],            // Keyboard Enter/Return
  0x29: ["[ESC]", "[ESC]"],      // Keyboard Escape
  0x2a: ["[BKSP]", "[BKSP]"],    // Keyboard Backspace
  0x2b: ["\t", "\t"],            // Keyboard Tab
  0x2c: [" ", " "],              // Keyboard Spacebar
  0x2d: ["-", "_"], 0x2e: ["=", "+"], 0x2f: ["[", "{"], 0x30: ["]", "}"],
  0x31: ["\\", "|"],             // Keyboard \ and |
  0x32: ["#", "~"],              // Keyboard Non-US # and ~
  0x33: [";", ":"], 0x34: ["'", "\""], 0x35: ["`", "~"],
  0x36: [",", "<"], 0x37: [".", ">"], 0x38: ["/", "?"],
  0x39: ["[CAPS]", "[CAPS]"],    // Keyboard Caps Lock
  0x3a: ["[F1]", "[F1]"], 0x3b: ["[F2]", "[F2]"], 0x3c: ["[F3]", "[F3]"],
  0x3d: ["[F4]", "[F4]"], 0x3e: ["[F5]", "[F5]"], 0x3f: ["[F6]", "[F6]"],
  0x40: ["[F7]", "[F7]"], 0x41: ["[F8]", "[F8]"], 0x42: ["[F9]", "[F9]"],
  0x43: ["[F10]", "[F10]"], 0x44: ["[F11]", "[F11]"], 0x45: ["[F12]", "[F12]"],
  0x46: ["[PRTSCR]", "[PRTSCR]"], 0x47: ["[SCRLK]", "[SCRLK]"], 0x48: ["[PAUSE]", "[PAUSE]"],
  0x49: ["[INS]", "[INS]"], 0x4a: ["[HOME]", "[HOME]"], 0x4b: ["[PGUP]", "[PGUP]"],
  0x4c: ["[DEL]", "[DEL]"], 0x4d: ["[END]", "[END]"], 0x4e: ["[PGDN]", "[PGDN]"],
  0x4f: ["[RIGHT]", "[RIGHT]"], 0x50: ["[LEFT]", "[LEFT]"],
  0x51: ["[DOWN]", "[DOWN]"], 0x52: ["[UP]", "[UP]"],
};

// Modifier byte 位掩码（USB HID 1.21 规范照抄）
const MOD_LSHIFT = 0x02;
const MOD_RSHIFT = 0x20;

// 把纯 hex 字符串按 recordBytes 切成报告数组
function splitReports(hex, recordBytes) {
  const len = recordBytes * 2;
  const out = [];
  for (let i = 0; i + len <= hex.length; i += len) {
    out.push(hex.slice(i, i + len));
  }
  return out;
}

// 8 位有符号数还原（USB 鼠标位移为 int8）
function s8(v) {
  return v & 0x80 ? v - 0x100 : v;
}

// ============ decodeKeyboard：USB 键盘 HID 报告 → 按键字符串 ============
function decodeKeyboard(text, p) {
  const opts = p || {};
  const backspace = opts.backspace !== false; // 默认开启退格删除
  const hex = String(text).replace(/[^0-9a-fA-F]/g, "");
  const reports = splitReports(hex, 8);
  if (reports.length === 0) return "（无有效 8 字节键盘报告）";

  let out = "";
  const pressed = new Set(); // 当前按住的键（去重用，按住时 HID 会重复发报告）
  for (const r of reports) {
    const mod = parseInt(r.slice(0, 2), 16);
 // byte1 为 Reserved（固件常填 0），byte2-7 为 Keycodes 1-6
    const codes = [];
    for (let j = 2; j < 8; j++) {
      const c = parseInt(r.slice(j * 2, j * 2 + 2), 16);
      if (c !== 0) codes.push(c);
    }
    if (codes.length === 0) {
 // 全 0 报告 = 按键释放，清空按住集
      pressed.clear();
      continue;
    }
    const shift = !!(mod & (MOD_LSHIFT | MOD_RSHIFT));
    for (const c of codes) {
      if (pressed.has(c)) continue; // 按住中，跳过重复
      pressed.add(c);
      const map = HID_KBD[c];
      if (!map) {
        out += `[0x${c.toString(16).padStart(2, "0")}]`;
        continue;
      }
      const ch = shift ? map[1] : map[0];
      if (c === 0x2a) {
 // Backspace：开启则删除上一字符，关闭则保留 [BKSP] 标记
        if (backspace) out = out.slice(0, -1);
        else out += ch;
      } else {
        out += ch;
      }
    }
  }
  return out;
}

// ============ decodeMouse：USB 鼠标 HID 报告 → 轨迹报告 ============
function decodeMouse(text, p) {
  const opts = p || {};
  const recordLen = Math.max(1, Math.floor(opts.recordLen || 4));
  const hex = String(text).replace(/[^0-9a-fA-F]/g, "");
  const reports = splitReports(hex, recordLen);
  if (reports.length === 0) return `（无有效 ${recordLen} 字节鼠标报告）`;

 // boot 协议：byte0=按钮, byte1=X 位移, byte2=Y 位移, byte3=滚轮
  const points = [{ x: 0, y: 0, btn: 0 }];
  let x = 0, y = 0, prevBtn = 0;
  let leftClick = 0, rightClick = 0;
  for (const r of reports) {
    const bytes = [];
    for (let j = 0; j < recordLen; j++) {
      bytes.push(parseInt(r.slice(j * 2, j * 2 + 2), 16));
    }
    const btn = bytes[0];
    const dx = recordLen > 1 ? s8(bytes[1]) : 0;
    const dy = recordLen > 2 ? s8(bytes[2]) : 0;
    x += dx;
    y += dy;
    points.push({ x, y, btn });
 // 上升沿计点击次数
    if ((btn & 1) && !(prevBtn & 1)) leftClick++;
    if ((btn & 2) && !(prevBtn & 2)) rightClick++;
    prevBtn = btn;
  }

 // 构造 ASCII 轨迹画布
  const xs = points.map((q) => q.x);
  const ys = points.map((q) => q.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;

  let canvas;
  if (W > 0 && H > 0 && W <= 200 && H <= 200) {
    const grid = new Array(H).fill(0).map(() => new Array(W).fill(" "));
    for (const q of points) {
      const gx = q.x - minX;
      const gy = q.y - minY;
      if (gx >= 0 && gx < W && gy >= 0 && gy < H) grid[gy][gx] = "#";
    }
    canvas = grid.map((row) => row.join("")).join("\n");
  } else {
    canvas = `（轨迹范围 ${W}×${H} 过大，跳过画布绘制）`;
  }

  return [
    `报文数：${reports.length}`,
    `左键点击：${leftClick} 次`,
    `右键点击：${rightClick} 次`,
    `X 范围：${minX}..${maxX}`,
    `Y 范围：${minY}..${maxY}`,
    `轨迹（# 为路径点）：`,
    canvas,
  ].join("\n");
}

// ============ 注册（只 2 个，绝不重复） ============
register({
  id: "usbKeyboard", cat: "forensic", name: "USB 键盘流量解析",
  desc: "解析 USB 键盘 leftover capture data（8 字节 HID 报告：Modifier+Reserved+Keycodes 1-6），还原按键输入",
  params: [
    { key: "backspace", label: "退格生效（删除上一字符，关闭则保留 [BKSP]）", type: "bool", default: true },
  ],
  run: decodeKeyboard,
});

register({
  id: "usbMouse", cat: "forensic", name: "USB 鼠标流量解析",
  desc: "解析 USB 鼠标 leftover capture data（按钮+X/Y 位移，boot 协议 4 字节报告），还原鼠标轨迹",
  params: [
    { key: "recordLen", label: "报告长度（字节，boot 协议默认 4）", type: "number", default: 4 },
  ],
  run: decodeMouse,
});

export { decodeKeyboard, decodeMouse };
