/*
 * t819Common.js —— CyberChef Code 类 op 的公共工具。
 *
 * 仅 t819*.js 使用；不接 registerAll。parseEscapedChars 与 CyberChef 11.2.0
 * src/core/Utils.mjs 的 Utils.parseEscapedChars 逐行一致，用于把 binaryShortString
 * 参数（缩进、分隔符）中的 \n、\t、\xNN、\uNNNN 等转义还原成真实字符。
 */

export function parseEscapedChars(str) {
  return String(str == null ? "" : str).replace(
    /\\([abfnrtv'"]|[0-3][0-7]{2}|[0-7]{1,2}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{[\da-fA-F]{1,6}\}|\\)/g,
    function (m, a) {
      switch (a[0]) {
        case "\\":
          return "\\";
        case "0":
        case "1":
        case "2":
        case "3":
        case "4":
        case "5":
        case "6":
        case "7":
          return String.fromCharCode(parseInt(a, 8));
        case "a":
          return String.fromCharCode(7);
        case "b":
          return "\b";
        case "t":
          return "\t";
        case "n":
          return "\n";
        case "v":
          return "\v";
        case "f":
          return "\f";
        case "r":
          return "\r";
        case '"':
          return '"';
        case "'":
          return "'";
        case "x":
          return String.fromCharCode(parseInt(a.substr(1), 16));
        case "u":
          if (a[1] === "{")
            return String.fromCodePoint(parseInt(a.slice(2, -1), 16));
          else
            return String.fromCharCode(parseInt(a.substr(1), 16));
      }
    }
  );
}
