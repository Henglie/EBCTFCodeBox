/*
 * t813ParityBit.js — 奇偶校验位（CyberChef #299）。
 *
 * 口径与 CyberChef src/core/operations/ParityBit.mjs + src/core/lib/ParityBit.mjs 一致：
 * 输入是只含 0/1/空格（或指定分隔符）的二进制串；Encode 在块首/块尾插入 1 位，
 * Decode 按同样位置去掉 1 位；指定分隔符时逐块处理。纯文本运算，零依赖、零外发。
 */
import { register } from "./registry.js";

function calculateParityBit(input, mode, position, delimiter) {
  let count1s = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);
    if (ch === "1") count1s++;
    else if (ch !== delimiter && ch !== "0" && ch !== " ") {
      throw new Error("二进制串含非法字符：" + JSON.stringify(ch));
    }
  }
  const flipflop = mode === "even" ? 0 : 1;
  const parityBit = (count1s % 2 === flipflop) ? "0" : "1";
  return position === "end" ? input + parityBit : parityBit + input;
}

function decodeParityBit(input, position) {
  return position === "end" ? input.slice(0, -1) : input.slice(1);
}

register({
  id: "parityBit",
  cat: "hash",
  name: "奇偶校验位",
  desc: "对二进制串计算偶/奇校验位：可放块首或块尾，可编码或解码，可按分隔符逐块处理。口径同 CyberChef「Parity Bit」",
  params: [
    { key: "mode", label: "校验类型", type: "select", default: "even", options: [
      { value: "even", label: "偶校验（Even Parity）" },
      { value: "odd", label: "奇校验（Odd Parity）" },
    ] },
    { key: "position", label: "校验位位置", type: "select", default: "start", options: [
      { value: "start", label: "块首（Start）" },
      { value: "end", label: "块尾（End）" },
    ] },
    { key: "action", label: "编码 / 解码", type: "select", default: "encode", options: [
      { value: "encode", label: "编码（Encode）" },
      { value: "decode", label: "解码（Decode）" },
    ] },
    { key: "delimiter", label: "分块分隔符（空=单块）", type: "text", default: "", placeholder: "如空格" },
  ],
  run(text, p) {
    const input = String(text == null ? "" : text);
    if (input.length === 0) return input;
    const mode = (p && p.mode) === "odd" ? "odd" : "even";
    const position = (p && p.position) === "end" ? "end" : "start";
    const action = (p && p.action) === "decode" ? "decode" : "encode";
    const delimiter = (p && p.delimiter != null) ? String(p.delimiter) : "";
    const one = (s) => (action === "encode"
      ? calculateParityBit(s, mode, position, delimiter)
      : decodeParityBit(s, position));
    if (delimiter.length > 0) {
      return input.split(delimiter).map(one).join(delimiter);
    }
    return one(input);
  },
});
