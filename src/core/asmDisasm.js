/*
 * asmDisasm.js — 机器码反汇编核心（MT73④，供「快速换算 · 机器码&汇编 互转」面板调用，非独立 op）。
 *
 * 引擎：WASM 反汇编引擎（本地懒加载、零外发、失败明确报错；引擎与许可信息仅存工程文档 PROGRESS.md）。
 * 资产：public/wasm/vendor/ 下 glue + wasm（emscripten MODULARIZE 产物）。
 * 加载：懒加载（单例 promise，不进首屏），零外发（仅本地相对路径 import，绝不 CDN）。
 * 降级：WASM 缺失/加载失败 → 给明确错误消息，不假装成功。
 * ⚠ 鸿蒙原生版不支持 WebAssembly → 本 op 在鸿蒙版不可用（已在 MT79 能力矩阵登记）。
  */

const GLUE_URL = "../../public/wasm/vendor/disasm/disasm-glue.js";
let _engPromise = null;   // 单例：并发只加载一次
let _available = null;         // null=未试 / true=就绪 / false=缺失降级

/** 懒加载反汇编引擎工厂（MODULARIZE：loadCapstone(args) → Promise<void>，之后 import 的类可用）。 */
async function loadEngineModule() {
  if (_engPromise) return _engPromise;
  _engPromise = (async () => {
    const glue = await import(/* @vite-ignore */ GLUE_URL);
    if (!glue.loadCapstone) { _available = false; throw new Error("glue 缺少引擎加载导出"); }
    await glue.loadCapstone({});
    _available = true;
    return glue;
  })();
  return _engPromise;
}

function engineAvailable() { return _available; }

// ---- 架构映射：UI 值 → {arch, mode}（引擎 Const；mode 组合见下） ----
const ARCH_MAP = {
  "x86":      { arch: "CS_ARCH_X86",     mode: "CS_MODE_32" },
  "x86-64":   { arch: "CS_ARCH_X86",     mode: "CS_MODE_64" },
  "arm":      { arch: "CS_ARCH_ARM",     mode: "CS_MODE_ARM" },
  "arm-thumb":{ arch: "CS_ARCH_ARM",     mode: "CS_MODE_THUMB" },
  "arm64":    { arch: "CS_ARCH_ARM64",   mode: "CS_MODE_ARM" },
  "mips":     { arch: "CS_ARCH_MIPS",    mode: "CS_MODE_MIPS32" },
  "mips64":   { arch: "CS_ARCH_MIPS",    mode: "CS_MODE_MIPS64" },
  "riscv":    { arch: "CS_ARCH_RISCV",   mode: "CS_MODE_RISCV64" },
  "ppc":      { arch: "CS_ARCH_PPC",     mode: "CS_MODE_32" },
  "ppc64":    { arch: "CS_ARCH_PPC",     mode: "CS_MODE_64" },
  "sparc":    { arch: "CS_ARCH_SPARC",   mode: "CS_MODE_32" },
  "systemz":  { arch: "CS_ARCH_SYSTEMZ", mode: "CS_MODE_32" },
  "m68k":     { arch: "CS_ARCH_M68K",    mode: "CS_MODE_32" },
  "tms320c64x":{ arch: "CS_ARCH_TMS320C64X", mode: "CS_MODE_32" },
  "xcore":    { arch: "CS_ARCH_XCORE",   mode: "CS_MODE_32" },
  "evm":      { arch: "CS_ARCH_EVM",     mode: "CS_MODE_32" },
};

const ARCH_OPTIONS = [
  { value: "x86", label: "x86 (32-bit)" },
  { value: "x86-64", label: "x86-64 (64-bit)" },
  { value: "arm", label: "ARM" },
  { value: "arm-thumb", label: "ARM Thumb" },
  { value: "arm64", label: "ARM64 (AArch64)" },
  { value: "mips", label: "MIPS (32)" },
  { value: "mips64", label: "MIPS (64)" },
  { value: "riscv", label: "RISC-V (64)" },
  { value: "ppc", label: "PowerPC (32)" },
  { value: "ppc64", label: "PowerPC (64)" },
  { value: "sparc", label: "SPARC" },
  { value: "systemz", label: "SystemZ" },
  { value: "m68k", label: "M68K" },
  { value: "tms320c64x", label: "TMS320C64x" },
  { value: "xcore", label: "XCore" },
  { value: "evm", label: "EVM" },
];

// ---- 输入编码 ----
function decodeInput(text, enc, rawBytes) {
  if (rawBytes && rawBytes.length) return rawBytes;
  const s = String(text).trim();
  if (!s) throw new Error("输入为空");
  if (enc === "base64") {
    if (typeof atob !== "function") throw new Error("当前环境无 atob，无法解码 base64 输入");
    const bin = atob(s.replace(/\s+/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // hex（默认）：容忍空白与 0x 前缀、冒号分隔
  const h = s.replace(/0x/gi, "").replace(/[\s:]/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error("hex 输入含非法字符（可用 0x 前缀/空格/冒号分隔）");
  if (h.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function fmtBytes(u8, max = 16) {
  let s = "";
  for (let i = 0; i < Math.min(u8.length, max); i++) s += u8[i].toString(16).padStart(2, "0") + " ";
  if (u8.length > max) s += "…";
  return s.trim();
}

/** 反汇编执行（懒加载 wasm；失败抛明确错误）。 */
export async function asmDisasmRun({ text, params, rawBytes }) {
  const glue = await loadEngineModule();          // 失败向上抛（调用方渲染为错误）
  const C = glue.Const;
  const key = String(params.arch || "x86");
  const spec = ARCH_MAP[key];
  if (!spec) throw new Error("未知架构: " + key);
  const arch = C[spec.arch];
  const mode = C[spec.mode];
  const bytes = decodeInput(text, params.enc || "hex", rawBytes);
  const base = Number(params.base) || 0;

  const cs = new glue.Capstone(arch, mode);
  try {
    if (key.startsWith("x86")) {
      const syntax = params.syntax === "att" ? C.CS_OPT_SYNTAX_ATT : C.CS_OPT_SYNTAX_INTEL;
      cs.setOption(C.CS_OPT_SYNTAX, syntax);
    }
    const insns = cs.disasm(bytes, { address: base });
    if (!insns || !insns.length) {
      return "(无有效指令；请检查输入字节与架构是否匹配)";
    }
    const lines = [];
    for (const ins of insns) {
      const addr = "0x" + ins.address.toString(16);
      const hex = ins.bytes && ins.bytes.length ? fmtBytes(new Uint8Array(ins.bytes)) : "";
      const ops = ins.opStr ? " " + ins.opStr : "";
      lines.push(`${addr.padEnd(10)} ${hex.padEnd(20)} ${ins.mnemonic}${ops}`);
    }
    return lines.join("\n");
  } finally {
    try { cs.close(); } catch { /* ignore */ }
  }
}

