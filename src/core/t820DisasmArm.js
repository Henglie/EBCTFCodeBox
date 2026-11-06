/*
 * t820DisasmArm.js — 反汇编 ARM（CyberChef #101）。
 *
 * 复用仓库已有反汇编核心 src/core/asmDisasm.js 与 public/wasm/vendor/disasm/ 的
 * Capstone wasm（不复制引擎、不新增 wasm）。支持 ARM / Thumb / ARM64（AArch64）。
 * 输入 hex/base64，可设起始地址；空输入、非法 hex、奇数长度、不支持架构均明确报错。
 */
import { register } from "./registry.js";
import { asmDisasmRun } from "./asmDisasm.js";

register({
  id: "disasmArm",
  cat: "forensic",
  name: "反汇编 ARM",
  desc: "把 ARM / Thumb / ARM64 机器码反汇编为汇编；输入 hex/base64，可设起始地址。复用内置 Capstone wasm，零外发",
  params: [
    { key: "arch", label: "架构", type: "select", default: "arm", options: [
      { value: "arm", label: "ARM (32-bit)" },
      { value: "arm-thumb", label: "ARM Thumb" },
      { value: "arm64", label: "ARM64 (AArch64)" },
    ] },
    { key: "enc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex" },
      { value: "base64", label: "Base64" },
    ] },
    { key: "base", label: "起始地址", type: "number", default: 0 },
  ],
  async run(text, p) {
    return asmDisasmRun({
      text,
      rawBytes: p.rawBytes,
      params: { arch: p.arch, enc: p.enc, base: p.base },
    });
  },
});
