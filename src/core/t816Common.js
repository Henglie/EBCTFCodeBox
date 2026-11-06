/*
 * t816Common.js — T816 批共用工具。
 *
 * 只被 t816*.js 引用，不进 registerAll；纯函数、零依赖、零外发。
 * parseEscapedChars 逐行移植 CyberChef src/core/Utils.mjs（Apache-2.0），
 * 用于 binaryString 型分隔符参数（如 "\n\n"）。
 */
export function parseEscapedChars(str) {
  return String(str == null ? "" : str).replace(
    /\\([abfnrtv'"]|[0-3][0-7]{2}|[0-7]{1,2}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{[\da-fA-F]{1,6}\}|\\)/g,
    (m, a) => {
      switch (a[0]) {
        case "\\": return "\\";
        case "0": case "1": case "2": case "3":
        case "4": case "5": case "6": case "7": return String.fromCharCode(parseInt(a, 8));
        case "a": return String.fromCharCode(7);
        case "b": return "\b";
        case "t": return "\t";
        case "n": return "\n";
        case "v": return "\v";
        case "f": return "\f";
        case "r": return "\r";
        case '"': return '"';
        case "'": return "'";
        case "x": return String.fromCharCode(parseInt(a.substr(1), 16));
        case "u": return a[1] === "{"
          ? String.fromCodePoint(parseInt(a.slice(2, -1), 16))
          : String.fromCharCode(parseInt(a.substr(1), 16));
        default: return m;
      }
    }
  );
}
