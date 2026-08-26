/*
 * asmAssemble.js — 机器码汇编核心（MT73④，供「快速换算 · 机器码&汇编 互转」面板调用，非独立 op）。
 *
 * 引擎：WASM 汇编引擎（本地懒加载、零外发、失败明确报错；引擎与许可信息仅存工程文档 PROGRESS.md）。
 *       架构：x86/x86-64/ARM/ARM64/MIPS/PPC/SPARC/SystemZ/Hexagon/EVM。
 * 资产：public/wasm/vendor/ 下 glue + wasm（emscripten MODULARIZE 产物）。
 * 加载：懒加载单例，零外发；失败抛明确错误不假装成功。
 * ⚠ 鸿蒙原生版不支持 WebAssembly → 本面板鸿蒙不可用（MT79 能力矩阵登记）。
 */

const GLUE_URL = "../../public/wasm/vendor/asm/asm-glue.js";
let _engPromise = null;
let _available = null;

async function loadEngineModule() {
  if (_engPromise) return _engPromise;
  _engPromise = (async () => {
    const glue = await import(/* @vite-ignore */ GLUE_URL);
    if (!glue.loadKeystone) { _available = false; throw new Error("glue 缺少引擎加载导出"); }
    await glue.loadKeystone({});
    _available = true;
    return glue;
  })();
  return _engPromise;
}

function engineAvailable() { return _available; }

// ---- 架构映射：UI 值 → {arch, mode}（引擎 Const） ----
const ARCH_MAP = {
  "x86":    { arch: "KS_ARCH_X86",     mode: "KS_MODE_32" },
  "x86-64": { arch: "KS_ARCH_X86",     mode: "KS_MODE_64" },
  "arm":    { arch: "KS_ARCH_ARM",     mode: "KS_MODE_ARM" },
  "arm-thumb": { arch: "KS_ARCH_ARM",  mode: "KS_MODE_THUMB" },
  "arm64":  { arch: "KS_ARCH_ARM64",   mode: "KS_MODE_LITTLE_ENDIAN" },
  "mips":   { arch: "KS_ARCH_MIPS",    mode: "KS_MODE_MIPS32" },
  "mips64": { arch: "KS_ARCH_MIPS",    mode: "KS_MODE_MIPS64" },
  "ppc":    { arch: "KS_ARCH_PPC",     mode: "KS_MODE_PPC32" },
  "ppc64":  { arch: "KS_ARCH_PPC",     mode: "KS_MODE_PPC64" },
  "sparc":  { arch: "KS_ARCH_SPARC",   mode: "KS_MODE_SPARC32" },
  "systemz":{ arch: "KS_ARCH_SYSTEMZ", mode: "KS_MODE_LITTLE_ENDIAN" },
  "hexagon":{ arch: "KS_ARCH_HEXAGON", mode: "KS_MODE_LITTLE_ENDIAN" },
  "evm":    { arch: "KS_ARCH_EVM",     mode: "KS_MODE_LITTLE_ENDIAN" },
};

const ARCH_OPTIONS = [
  { value: "x86", label: "x86 (32-bit)" },
  { value: "x86-64", label: "x86-64 (64-bit)" },
  { value: "arm", label: "ARM" },
  { value: "arm-thumb", label: "ARM Thumb" },
  { value: "arm64", label: "ARM64 (AArch64)" },
  { value: "mips", label: "MIPS (32)" },
  { value: "mips64", label: "MIPS (64)" },
  { value: "ppc", label: "PowerPC (32)" },
  { value: "ppc64", label: "PowerPC (64)" },
  { value: "sparc", label: "SPARC" },
  { value: "systemz", label: "SystemZ" },
  { value: "hexagon", label: "Hexagon" },
  { value: "evm", label: "EVM" },
];

function hexDump(u8, cols = 16, base = 0) {
  const lines = [];
  for (let off = 0; off < u8.length; off += cols) {
    const slice = u8.slice(off, off + cols);
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, "0")).join(" ");
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".")).join("");
    lines.push(`0x${(base + off).toString(16).padStart(8, "0")}  ${hex.padEnd(cols * 3 - 1)}  |${ascii}|`);
  }
  return lines.join("\n");
}

/** 汇编执行（懒加载 wasm；失败抛明确错误）。 */
export async function asmAssembleRun({ text, params }) {
  const glue = await loadEngineModule();
  const C = glue.Const;
  const key = String(params.arch || "x86");
  const spec = ARCH_MAP[key];
  if (!spec) throw new Error("未知架构: " + key);
  const arch = C[spec.arch];
  const mode = C[spec.mode];
  const src = String(text);

  const ks = new glue.Keystone(arch, mode);
  try {
    if (key.startsWith("x86")) {
      const syntax = params.syntax === "att" ? C.KS_OPT_SYNTAX_ATT : C.KS_OPT_SYNTAX_INTEL;
      ks.setOption(C.KS_OPT_SYNTAX, syntax);
    }
    // 引擎 asm() 直接返回 Uint8Array（失败抛 Error，含引擎 strerror）
    let mc;
    try {
      mc = ks.asm(src, { address: Number(params.base) || 0 });
    } catch (e) {
      throw new Error("汇编失败: " + (e.message || String(e)) + "——检查语法/架构，如 AT&T 与 Intel 语法勿混用");
    }
    if (!mc || !mc.length) return "(汇编结果为空)";
    const hex = Array.from(mc, (b) => b.toString(16).padStart(2, "0")).join("");
    return `字节数: ${mc.length}\nhex:\n${hex}\n\nhex 分行（基地址 ${params.base || 0}）:\n${hexDump(mc, 16, Number(params.base) || 0)}`;
  } finally {
    try { ks.close(); } catch { /* ignore */ }
  }
}

