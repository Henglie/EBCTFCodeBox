/*
 * t820Yara.js — YARA 规则扫描（CyberChef #503）。
 *
 * 口径与 CyberChef src/core/operations/YARARules.mjs 一致：规则、匹配串、串长、
 * 元数据、次数、编译告警、console 模块消息七个开关与报告文本格式逐项对齐。
 * 引擎：src/vendor/libyara-wasm/libyara-wasm.mjs（libyara-wasm 1.2.1，ISC；
 * 单文件 emscripten，wasm 以 data:application/octet-stream;base64 内嵌，无外部 .wasm，
 * UMD 尾部 ESM 化）。懒加载，零外发；加载失败给明确错误。
 *
 * 输入走字节通道（acceptsBytes）：有 rawBytes 用真字节，否则按 UTF-8 文本编码。
 */
import { register } from "./registry.js";

let _yaraPromise = null;

function getYara() {
  if (!_yaraPromise) {
    _yaraPromise = import("../vendor/libyara-wasm/libyara-wasm.mjs")
      .then((m) => {
        if (typeof m.default !== "function") throw new Error("vendor 缺少默认导出");
        return m.default();
      })
      .catch((err) => {
        _yaraPromise = null;
        throw new Error("YARA 引擎加载失败：" + (err && err.message ? err.message : String(err)));
      });
  }
  return _yaraPromise;
}

function bytesOf(text, p) {
  const raw = p && p.rawBytes;
  if (raw != null) return raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  return new TextEncoder().encode(String(text == null ? "" : text));
}

register({
  id: "yaraScan",
  cat: "forensic",
  name: "YARA 规则扫描",
  acceptsBytes: true,
  desc: "用 YARA 规则匹配字节：支持文本/十六进制/正则模式、meta 与 console 模块；报告格式与 CyberChef「YARA Rules」一致",
  params: [
    { key: "rules", label: "规则", labelKey: "op.yaraScan.param.rules", type: "textarea", default: "", rows: 5, placeholder: "rule demo { strings: $a = \"flag\" condition: $a }" },
    { key: "showStrings", label: "显示匹配串", labelKey: "op.yaraScan.param.showStrings", type: "bool", default: false },
    { key: "showLengths", label: "显示匹配串长度", labelKey: "op.yaraScan.param.showLengths", type: "bool", default: false },
    { key: "showMeta", label: "显示元数据", labelKey: "op.yaraScan.param.showMeta", type: "bool", default: false },
    { key: "showCounts", label: "显示匹配次数", labelKey: "op.yaraScan.param.showCounts", type: "bool", default: true },
    { key: "showRuleWarns", label: "显示规则告警", labelKey: "op.yaraScan.param.showRuleWarns", type: "bool", default: true },
    { key: "showConsole", label: "显示 console 模块消息", labelKey: "op.yaraScan.param.showConsole", type: "bool", default: true },
  ],
  async run(text, p) {
    const rules = String(p.rules == null ? "" : p.rules);
    const showStrings = !!p.showStrings;
    const showLengths = !!p.showLengths;
    const showMeta = !!p.showMeta;
    const showCounts = p.showCounts !== false;
    const showRuleWarns = p.showRuleWarns !== false;
    const showConsole = p.showConsole !== false;

    const yara = await getYara();
    const resp = yara.run(bytesOf(text, p), rules);
    let matchString = "";

    if (resp.compileErrors.size() > 0) {
      for (let i = 0; i < resp.compileErrors.size(); i++) {
        const compileError = resp.compileErrors.get(i);
        if (!compileError.warning) {
          throw new Error(`YARA 规则错误（第 ${compileError.lineNumber} 行）：${compileError.message}`);
        } else if (showRuleWarns) {
          matchString += `Warning on line ${compileError.lineNumber}: ${compileError.message}\n`;
        }
      }
    }

    if (showConsole) {
      const consoleLogs = resp.consoleLogs;
      for (let i = 0; i < consoleLogs.size(); i++) {
        matchString += consoleLogs.get(i) + "\n";
      }
    }

    const matchedRules = resp.matchedRules;
    for (let i = 0; i < matchedRules.size(); i++) {
      const rule = matchedRules.get(i);
      const matches = rule.resolvedMatches;
      let meta = "";
      if (showMeta && rule.metadata.size() > 0) {
        meta += " [";
        for (let j = 0; j < rule.metadata.size(); j++) {
          meta += `${rule.metadata.get(j).identifier}: ${rule.metadata.get(j).data}, `;
        }
        meta = meta.slice(0, -2) + "]";
      }
      const countString = matches.size() === 0 ? "" : (showCounts ? ` (${matches.size()} time${matches.size() > 1 ? "s" : ""})` : "");
      if (matches.size() === 0 || !(showStrings || showLengths)) {
        matchString += `Input matches rule "${rule.ruleName}"${meta}${countString.length > 0 ? ` ${countString}` : ""}.\n`;
      } else {
        matchString += `Rule "${rule.ruleName}"${meta} matches${countString}:\n`;
        for (let j = 0; j < matches.size(); j++) {
          const match = matches.get(j);
          matchString += `Pos ${match.location}, ${showLengths ? `length ${match.matchLength}, ` : ""}identifier ${match.stringIdentifier}${showStrings ? `, data: "${match.data}"` : ""}\n`;
        }
      }
    }
    return matchString;
  },
});
