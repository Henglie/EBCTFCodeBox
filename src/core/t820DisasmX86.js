/*
 * t820DisasmX86.js — 反汇编 x86（CyberChef #102）。
 *
 * 复用仓库已有反汇编核心 src/core/asmDisasm.js 与 public/wasm/vendor/disasm/ 的
 * Capstone wasm（不复制引擎、不新增 wasm）。支持 x86 / x86-64，语法 intel/att。
 * 输入 hex/base64，可设起始地址；空输入、非法 hex、奇数长度、不支持架构均明确报错。
 */
import { register } from "./registry.js";
import { asmDisasmRun } from "./asmDisasm.js";

register({
  id: "disasmX86",
  cat: "forensic",
  name: "反汇编 x86",
  desc: "把 x86 / x86-64 机器码反汇编为汇编；输入 hex/base64，可选 Intel/AT&T 语法与起始地址。复用内置 Capstone wasm，零外发",
  params: [
    { key: "arch", label: "架构", type: "select", default: "x86", options: [
      { value: "x86", label: "x86 (32-bit)" },
      { value: "x86-64", label: "x86-64 (64-bit)" },
    ] },
    { key: "syntax", label: "语法", type: "select", default: "intel", options: [
      { value: "intel", label: "Intel" },
      { value: "att", label: "AT&T" },
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
      params: { arch: p.arch, syntax: p.syntax, enc: p.enc, base: p.base },
    });
  },
});
