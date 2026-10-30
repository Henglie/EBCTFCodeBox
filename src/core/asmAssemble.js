/*
 * asmAssemble.js — 机器码汇编核心（供「快速换算 · 机器码&汇编互转」面板调用，非独立 op）。
 *
 * 引擎：WASM 汇编引擎（本地懒加载、零外发、失败明确报错；引擎与许可信息仅存工程文档 PROGRESS.md）。
 *       实际可用的只有 x86(x86-64)/ARM(Thumb)/ARM64——随包 keystone wasm 只编译了这三族；
 *       glue 里的 KS_ARCH_* 常量是头文件全集，不能当作「已支持」的证据（MIPS/PPC/SPARC/
 *       SystemZ/Hexagon 均 ks_open 报 KS_ERR_ARCH；EVM 虽能打开，但带操作数的 PUSH1 汇编失败，
 *       不作为可用架构暴露）。
 * 资产：public/wasm/vendor/ 下 glue + wasm（emscripten MODULARIZE 产物）。
 * 加载：懒加载单例，零外发；失败抛明确错误不假装成功。
 * ⚠ 鸿蒙原生版不支持 WebAssembly → 本面板鸿蒙不可用（能力矩阵登记）。
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
// 白名单只列经过实测 ks_open/ks_asm 成功的架构；不要凭 glue 里的常量增项。
export const ARCH_MAP = {
  "x86":    { arch: "KS_ARCH_X86",     mode: "KS_MODE_32" },
  "x86-64": { arch: "KS_ARCH_X86",     mode: "KS_MODE_64" },
  "arm":    { arch: "KS_ARCH_ARM",     mode: "KS_MODE_ARM" },
  "arm-thumb": { arch: "KS_ARCH_ARM",  mode: "KS_MODE_THUMB" },
  "arm64":  { arch: "KS_ARCH_ARM64",   mode: "KS_MODE_LITTLE_ENDIAN" },
};

export const ARCH_OPTIONS = [
  { value: "x86", label: "x86 (32-bit)" },
  { value: "x86-64", label: "x86-64 (64-bit)" },
  { value: "arm", label: "ARM" },
  { value: "arm-thumb", label: "ARM Thumb" },
  { value: "arm64", label: "ARM64 (AArch64)" },
];

export const SUPPORTED_ARCHS = Object.freeze(ARCH_OPTIONS.map((o) => o.value));

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
  if (!spec) throw new Error("不支持的架构: " + key + "（可用: " + SUPPORTED_ARCHS.join(", ") + "）");
  const arch = C[spec.arch];
  const mode = C[spec.mode];
  if (arch === undefined || mode === undefined) {
    throw new Error("引擎缺少架构常量 " + spec.arch + "/" + spec.mode + "，当前 wasm 构建不支持该架构");
  }
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

