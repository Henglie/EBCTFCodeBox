/*
 * malbolgeExec.js — Malbolge 深奥语言解释器/执行器（run 型单向）。
 *
 * 算法口径：Ben Olmstead 1998 规范（esolangs.org/wiki/Malbolge）——三进制虚机：
 * 59049 字（10 trit）内存，寄存器 A/C/D；取指 = (mem[C]+C)%94 查 xlat1 得指令字母；
 * 执行后 mem[C] 用 xlat2 加密，C/D 各自 +1（59048 处回绕 0）；程序外内存按
 * crazy 运算（trit 真值表）由前两字生成。in 的 EOF 约定 59048。
 * 「v」halt 指令（值 81）为规范内指令，执行器/生成器均以它收尾。
 *
 * 对拍基准：权威规范 + zb3/malbolge-vm（malbolge-tools 参照页内嵌 VM，MIT）行为双源，
 * 七个官方样例（Hello World EU / wat / cat / cat.nmb / crackme / sep / encrypted）
 * 逐字节一致，见 资料/工程留存/T519/ 测试脚本。本文件为自研实现，未拷贝参照代码。
 *
 * 与既有 op 的关系：malbolge（识别，fancy3.js）只做装载形式校验不执行；本 op 提供执行
 * 与 normalize/assemble 双向转换，两者装载合法性判定等价（V 值集 {4,5,23,39,40,62,68,81}）。
 */
import { register } from "./registry.js";

/* ---- 规范常量：94 字符置换表（esolangs spec / 原版 malbolge.c 同源） ---- */
const XLAT1 = '+b(29e*j1VMEKLyC})8&m#~W>qxdRp0wkrUo[D7,XTcA"lI.v%{gJh4G\\-=O@5`_3i<?Z\';FNQuY]szf$!BS/|t:Pn6^Ha';
const XLAT2 = '5z]&gqtyfr$(we4{WP)H-Zn,[%\\3dL+Q;>U!pJS72FhOA1CB6v^=I_0/8|jsb9m<.TVac`uY*MK\'X~xDl}REokN:#?G"i@';
const LEGAL = "ji*p</vo";                    // 装载合法指令字母
const WS = " \t\r\n\v\f ";                   // 装载时跳过的空白
const MEM_SIZE = 59049;                      // 3^10
const EOF_WORD = 59048;                      // in 指令 EOF 约定
// 字母 → 规范指令值（(mem[C]+C)%94 口径）；'v' halt=81 为规范内收尾指令
const ASM = { i: 4, "<": 5, "/": 23, "*": 39, j: 40, p: 62, o: 68, v: 81 };

/* ---- crazy 运算：trit 真值表（行 A 列 D），规范定义 ---- */
const CRAZY_T = [
  [1, 0, 0],
  [1, 0, 2],
  [2, 2, 1],
];
function crazy(x, y) {
  let t = 0, p = 1;
  for (let j = 0; j < 10; j++) {
    t += CRAZY_T[x % 3][y % 3] * p;
    x = (x / 3) | 0;
    y = (y / 3) | 0;
    p *= 3;
  }
  return t;
}

/* rot：mem[D] 右旋 1 trit（最高 trit 落到最低位） */
function rotR(m) {
  return ((m / 3) | 0) + (m % 3) * 19683;
}

/* ---- 装载：空白跳过；仅可打印 ASCII 33-126；逐位置校验 xlat1 字母合法；程序外内存 crazy 补满 ---- */
function loadProgram(src) {
  const chars = [];
  for (let t = 0; t < src.length; t++) {
    const ch = src[t];
    if (WS.includes(ch)) continue;
    const tt = src.charCodeAt(t);
    if (tt < 33 || tt > 126)
      throw new Error(`Malbolge 装载错误：第 ${chars.length} 个指令位附近含非法字符（仅允许可打印 ASCII 33-126 与空白）。`);
    if (!LEGAL.includes(XLAT1[(tt - 33 + chars.length) % 94]))
      throw new Error(`Malbolge 装载错误：位置 ${chars.length} 的字符 "${ch}" 不是合法的装载指令（(字符码+位置)%94 解出的字母不在 ji*p</vo 内）。`);
    if (chars.length >= MEM_SIZE)
      throw new Error("Malbolge 装载错误：程序超过 59049 字内存上限。");
    chars.push(tt);
  }
  if (!chars.length) throw new Error("Malbolge 装载错误：程序为空（或全部为空白）。");
  const mem = new Uint32Array(MEM_SIZE);
  for (let i = 0; i < chars.length; i++) mem[i] = chars[i];
  // 补满方向经参照机反解对齐：crazy(次前字, 前字)（zb3 op(x,y)=crazy(y,x)，x=首参）
  for (let i = Math.max(chars.length, 2); i < MEM_SIZE; i++)
    mem[i] = crazy(mem[i - 2], mem[i - 1]);
  return { mem, a: 0, c: 0, d: 0 };
}

/* ---- 单步：返回 {out} 出一字节；halt 返回 {halt:true}；需输入抛 INPUT_FWD；其余错误抛 Error ---- */
const INPUT_NEEDED = Symbol("malbolge-input");
function step(vm, inputByte) {
  const cur = vm.mem[vm.c];
  if (cur < 33 || cur > 126)
    throw new Error(`Malbolge 运行错误：第 ${vm.steps + 1} 步取指越界（C 指向非指令字符 ${cur}），执行已停止。`);
  const opcode = XLAT1[(cur - 33 + vm.c) % 94];
  const va = vm.a, vc = vm.c, vd = vm.d, vmd = vm.mem[vd];
  let out = null;

  switch (opcode) {
    case "j": vm.d = vmd; break;                       // movd：D ← mem[D]
    case "i": vm.c = vmd; break;                       // jmp：C ← mem[D]
    case "*": vm.a = vm.mem[vd] = rotR(vmd); break;    // rot：mem[D] 右旋 1 trit，A ← mem[D]
    case "p": vm.a = vm.mem[vd] = crazy(vmd, va); break; // op：crazy(mem[D], A) 写回，A ← 结果（方向经参照机反解）
    case "<": out = va % 256; break;                   // out：输出 A 低字节
    case "/":                                          // in：A ← 输入（EOF=59048）
      if (inputByte === null || inputByte === undefined) throw INPUT_NEEDED;
      vm.a = inputByte;
      break;
    case "v": return { halt: true };                   // halt
    default: break;                                    // o 与其余非指令字母 = nop
  }

  // 非法跳转/写入防护：执行后 C 须指向 33-126 字符，否则回滚本步全部副作用
  if (vm.mem[vm.c] < 33 || vm.mem[vm.c] > 126) {
    vm.a = va; vm.c = vc; vm.d = vd; vm.mem[vd] = vmd;
    throw new Error(`Malbolge 运行错误：第 ${vm.steps + 1} 步非法${opcode === "i" ? "跳转（跳转目标不是有效指令字符）" : "写入（目标字符越界）"}，执行已停止。`);
  }
  vm.mem[vm.c] = XLAT2.charCodeAt(vm.mem[vm.c] - 33);  // 执行后加密
  vm.c = vm.c === MEM_SIZE - 1 ? 0 : vm.c + 1;
  vm.d = vm.d === MEM_SIZE - 1 ? 0 : vm.d + 1;
  return { out };
}

/* ---- 执行到 halt / 步数上限；stdin 逐字符供读，耗尽按 EOF(59048) ---- */
function execProgram(vm, stdin, maxSteps) {
  const bytes = [];
  let inPos = 0;
  for (let s = 0; s < maxSteps; s++) {
    vm.steps = s;
    const r = step(vm, inPos < stdin.length ? stdin.charCodeAt(inPos++) : EOF_WORD);
    if (r.halt) return { bytes, stopped: "halt", steps: s + 1 };
    if (r.out !== null) bytes.push(r.out);
  }
  throw new Error(`Malbolge 执行在第 ${maxSteps} 步达到步数上限，已强制截停（疑似死循环）。可调大 maxSteps 参数重试。`);
}

/* 输出字节 → 文本：优先按 UTF-8 严格解码（程序可输出多字节中文），失败回退 Latin-1 */
function bytesToText(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return Array.from(bytes, (b) => String.fromCharCode(b)).join("");
  }
}

/* ---- normalize：程序源码 → 位置无关规范字母形（空白/越界字符原样保留，不占位） ---- */
function normalize(src) {
  let out = "", pos = 0;
  for (const ch of src) {
    const cc = ch.codePointAt(0);
    if (cc > 32 && cc < 127) out += XLAT1[(cc - 33 + pos++) % 94];
    else out += ch;
  }
  return out;
}

/* ---- assemble：规范字母形 → 可执行源码（字母按位置加成回真实字符） ---- */
function assemble(normalized) {
  let out = "", pos = 0;
  for (const ch of normalized) {
    const cc = ch.codePointAt(0);
    if (cc > 32 && cc < 127) {
      const op = ASM[ch];
      if (op === undefined)
        throw new Error(`Malbolge assemble 错误：位置 ${pos} 的 "${ch}" 不是规范指令字母（仅限 o j i * p < / v 与空白/占位符）。`);
      let t = (op - (pos % 94) + 94) % 94;
      if (t < 33) t += 94;
      out += String.fromCharCode(t);
      pos++;
    } else out += ch;
  }
  return out;
}

/* ---- 注册（run 型单向） ---- */
register({
  id: "malbolgeExec", cat: "esolang", name: "Malbolge 执行",
  verbatimInput: true,
  desc: "Malbolge 解释器（Ben Olmstead 1998 三进制虚机）：执行程序输出结果，附 normalize/assemble 规范形转换；步数上限护栏防死循环，EOF 读 59048",
  params: [
    { key: "mode", label: "模式", type: "select", default: "run",
      options: [
        { value: "run", label: "执行（程序 → 输出）" },
        { value: "normalize", label: "normalize（程序 → 规范字母形 oji*p</v）" },
        { value: "assemble", label: "assemble（规范字母形 → 可执行源码）" },
      ] },
    { key: "stdin", label: "程序输入（stdin，可空；读尽按 EOF=59048）", type: "textarea", default: "",
      placeholder: "程序含 / (in) 指令时填写；逐字符喂入" },
    { key: "maxSteps", label: "步数上限（防死循环护栏）", type: "number", default: 1000000,
      placeholder: "默认 1000000" },
  ],
  run(text, p) {
    const src = String(text ?? "");
    const mode = (p && p.mode) || "run";
    if (mode === "normalize") return normalize(src);
    if (mode === "assemble") return assemble(src);
    const maxSteps = Math.min(Math.max(Number((p && p.maxSteps) || 1000000) || 1000000, 1), 100000000);
    const vm = loadProgram(src);
    const { bytes } = execProgram(vm, String((p && p.stdin) ?? ""), maxSteps);
    return bytesToText(bytes);
  },
});

// 测试/上层工具可复用（对拍 harness 用；注册副作用不受影响）
export { loadProgram, step, execProgram, normalize, assemble, crazy, rotR, bytesToText };
