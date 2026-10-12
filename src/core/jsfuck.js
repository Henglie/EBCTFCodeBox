import { register } from "./registry.js";

// JSFuck only uses []()!+. Decoding executes the validated expression locally.
function jsFuckDecode(text) {
  const s = text.trim();
  if (!s) return "";
  if (!/^[\[\]()!+\s]+$/.test(s)) {
    throw new Error("JSFuck 只含 []()!+ 六字符");
  }
  try {
    const fn = new Function('"use strict"; return (' + s + ');');
    const r = fn();
    return typeof r === "string" ? r : String(r);
  } catch (e) {
    throw new Error("JSFuck 执行失败: " + e.message);
  }
}

// ---- 编码方向（与 JSFuck 0.5.0 官方算法同源：github.com/aemkei/jsfuck） ----
// 思路：全部表达式只用 []()!+ 六字符。基础串 false/true/undefined/NaN/Infinity
// 由 ![]/!![]/[][[]]/+[![]]/"1e1000" 构造，按下标取字符；constructor 系借
// Function 构造器；表外字符转 \ 八进制（>0xFF 用 \uXXXX）后经
// Function("return\"…\"") 包装，求值即还原原文。
const JSF_MIN = 32, JSF_MAX = 126;

const JSF_SIMPLE = {
  "false": "![]",
  "true": "!![]",
  "undefined": "[][[]]",
  "NaN": "+[![]]",
  "Infinity": "+(+!+[]+(!+[]+[])[!+[]+!+[]+!+[]]+[+!+[]]+[+[]]+[+[]]+[+[]])",
};

const JSF_CONSTRUCTORS = {
  "Array": "[]",
  "Number": "(+[])",
  "String": "([]+[])",
  "Boolean": "(![])",
  "Function": '[]["at"]',
  "RegExp": 'Function("return/"+false+"/")()',
};

const JSF_MAPPING = {
  "a": '(false+"")[1]',
  "b": '([]["entries"]()+"")[2]',
  "c": '([]["at"]+"")[3]',
  "d": '(undefined+"")[2]',
  "e": '(true+"")[3]',
  "f": '(false+"")[0]',
  "g": "(false+[0]+String)[20]",
  "h": '(+(101))["to"+String["name"]](21)[1]',
  "i": "([false]+undefined)[10]",
  "j": '([]["entries"]()+"")[3]',
  "k": '(+(20))["to"+String["name"]](21)',
  "l": '(false+"")[2]',
  "m": '(Number+"")[11]',
  "n": '(undefined+"")[1]',
  "o": '(true+[]["at"])[10]',
  "p": '(+(211))["to"+String["name"]](31)[1]',
  "q": '("")["fontcolor"]([0]+false+")[20]',
  "r": '(true+"")[1]',
  "s": '(false+"")[3]',
  "t": '(true+"")[0]',
  "u": '(undefined+"")[0]',
  "v": '(+(31))["to"+String["name"]](32)',
  "w": '(+(32))["to"+String["name"]](33)',
  "x": '(+(101))["to"+String["name"]](34)[1]',
  "y": "(NaN+[Infinity])[10]",
  "z": '(+(35))["to"+String["name"]](36)',

  "A": '(NaN+[]["entries"]())[11]',
  "B": "(+[]+Boolean)[10]",
  "C": 'Function("return escape")()(("")["italics"]())[2]',
  "D": 'Function("return escape")()([]["at"])["at"]("-1")',
  "E": '(RegExp+"")[12]',
  "F": "(+[]+Function)[10]",
  "G": '(false+Function("return Date")()())[30]',
  "H": null,
  "I": '(Infinity+"")[0]',
  "J": null,
  "K": null,
  "L": null,
  "M": '(true+Function("return Date")()())[30]',
  "N": '(NaN+"")[0]',
  "O": null,
  "P": null,
  "Q": null,
  "R": "(+[]+RegExp)[10]",
  "S": "(+[]+String)[10]",
  "T": '(NaN+Function("return Date")()())[30]',
  "U": null,
  "V": null,
  "W": null,
  "X": null,
  "Y": null,
  "Z": null,

  " ": '(NaN+[]["at"])[11]',
  "!": null,
  '"': '("")["fontcolor"]()[12]',
  "#": null,
  "$": null,
  "%": 'Function("return escape")()([]["at"])[22]',
  "&": '("")["fontcolor"](")[13]',
  "'": null,
  "(": '([]["at"]+"")[11]',
  ")": '(""+[]["at"])[12]',
  "*": null,
  "+": "(+(+!+[]+(!+[]+[])[!+[]+!+[]+!+[]]+[+!+[]]+[+[]]+[+[]])+[])[2]",
  ",": '[[]]["concat"]([[]])+""',
  "-": '(+(.+[0000001])+"")[2]',
  ".": '(+(+!+[]+[+!+[]]+(!![]+[])[!+[]+!+[]+!+[]]+[!+[]+!+[]]+[+[]])+[])[+!+[]]',
  "/": '(false+[0])["italics"]()[10]',
  ":": '(RegExp()+"")[3]',
  ";": '("")["fontcolor"](NaN+")[21]',
  "<": '("")["italics"]()[0]',
  "=": '("")["fontcolor"]()[11]',
  ">": '("")["italics"]()[2]',
  "?": '(RegExp()+"")[2]',
  "@": null,
  "[": '([]["entries"]()+"")[0]',
  "\\": '(RegExp("/")+"")[1]',
  "]": '([]["entries"]()+"")[22]',
  "^": null,
  "_": null,
  "`": null,
  "{": '([0]+false+[]["at"])[20]',
  "|": null,
  "}": '([]["at"]+"")["at"]("-1")',
  "~": null,
};

const JSF_GLOBAL = 'Function("return this")()';

function jsfFillMissingDigits() {
  for (let number = 0; number < 10; number++) {
    let output = "+[]";
    if (number > 0) { output = "+!" + output; }
    for (let i = 1; i < number; i++) { output = "+!+[]" + output; }
    if (number > 1) { output = output.substr(1); }
    JSF_MAPPING[number] = "[" + output + "]";
  }
}

function jsfReplaceMap() {
  let value = "";
  let i = 0; // 与 numberReplacer 共享（见下注）

  function replace(pattern, replacement) {
    value = value.replace(new RegExp(pattern, "gi"), replacement);
  }

  function digitReplacer(_, x) { return JSF_MAPPING[x]; }

 // 注意：numberReplacer 与外层循环共享变量 i（官方同款行为）——
 // 数字替换会改写外层 i，使字符被多轮重复处理直至不动点，
 // 后插入的 Function 等词才能被再次展开，官方产物即依赖此语义。
  function numberReplacer(_, y) {
    const values = y.split("");
    const head = +(values.shift());
    let output = "+[]";
    if (head > 0) { output = "+!" + output; }
    for (i = 1; i < head; i++) { output = "+!+[]" + output; }
    if (head > 1) { output = output.substr(1); }
    return [output].concat(values).join("+").replace(/(\d)/g, digitReplacer);
  }

  for (i = JSF_MIN; i <= JSF_MAX; i++) {
    const character = String.fromCharCode(i);
    value = JSF_MAPPING[character];
    if (!value) { continue; }

    for (const key in JSF_CONSTRUCTORS) {
      replace("\\b" + key, JSF_CONSTRUCTORS[key] + '["constructor"]');
    }
    for (const key in JSF_SIMPLE) {
      replace(key, JSF_SIMPLE[key]);
    }
    replace("(\\d\\d+)", numberReplacer);
    replace("\\((\\d)\\)", digitReplacer);
    replace("\\[(\\d)\\]", digitReplacer);
    replace("GLOBAL", JSF_GLOBAL);
    replace('\\+""', "+[]");
    replace('""', "[]+[]");

    JSF_MAPPING[character] = value;
  }
}

function jsfReplaceStrings() {
  const regEx = /[^\[\]\(\)\!\+]{1}/g;
  let missing = {};
  let count = JSF_MAX - JSF_MIN;

  function findMissing() {
    let all, value, done = false;
    missing = {};
    for (all in JSF_MAPPING) {
      value = JSF_MAPPING[all];
      if (value && value.match(regEx)) {
        missing[all] = value;
        done = true;
      }
    }
    return done;
  }

  function mappingReplacer(_, b) {
    return b.split("").join("+");
  }

  function valueReplacer(c) {
    return missing[c] ? c : JSF_MAPPING[c];
  }

  for (const all in JSF_MAPPING) {
    if (JSF_MAPPING[all]) {
      JSF_MAPPING[all] = JSF_MAPPING[all].replace(/\"([^\"]+)\"/gi, mappingReplacer);
    }
  }

  while (findMissing()) {
    for (const all in missing) {
      let value = JSF_MAPPING[all];
      value = value.replace(regEx, valueReplacer);
      JSF_MAPPING[all] = value;
      missing[all] = value;
    }
    if (count-- === 0) {
      throw new Error("JSFuck 编码表构建失败");
    }
  }
}

function jsfEscapeSequence(c) {
  const cc = c.charCodeAt(0);
  if (cc < 256) {
    return "\\" + cc.toString(8);
  }
  const cc16 = cc.toString(16);
  return "\\u" + ("0000" + cc16).substring(cc16.length);
}

function jsfEscapeSequenceForReplace(c) {
  return jsfEscapeSequence(c).replace("\\", "t");
}

function jsfEncode(input) {
  let output = [];

  if (!input) {
    return "";
  }

  let unmapped = "";
  for (const k in JSF_MAPPING) {
    if (JSF_MAPPING[k]) {
      unmapped += k;
    }
  }
  unmapped = unmapped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  unmapped = new RegExp("[^" + unmapped + "]", "g");
  const unmappedCharactersCount = (input.match(unmapped) || []).length;
  if (unmappedCharactersCount > 1) {
   // 多个表外字符：整体转义后再用 split/join 还原反斜杠（官方同款优化）
    input = input.replace(/[^0123456789.adefilnrsuN]/g, jsfEscapeSequenceForReplace);
  } else if (unmappedCharactersCount > 0) {
   // 单个表外字符（以及 " 和 \）：转成 \ 转义序列逐字符展开
    input = input.replace(/["\\]/g, jsfEscapeSequence);
    input = input.replace(unmapped, jsfEscapeSequence);
  }

  let r = "";
  for (const k in JSF_SIMPLE) {
    r += k + "|";
  }
  r += ".";

  input.replace(new RegExp(r, "g"), function (c) {
    const replacement = JSF_SIMPLE[c];
    if (replacement) {
      output.push("(" + replacement + "+[])");
    } else {
      const mapped = JSF_MAPPING[c];
      if (mapped) {
        output.push(mapped);
      } else {
        throw new Error("JSFuck 暂不支持该字符: " + c);
      }
    }
  });

  output = output.join("+");

  if (/^\d$/.test(input)) {
    output += "+[]";
  }

  if (unmappedCharactersCount > 1) {
    output = "(" + output + ")[" + jsfEncode("split") + "](" + jsfEncode("t") + ")[" + jsfEncode("join") + "](" + jsfEncode("\\") + ")";
  }

  if (unmappedCharactersCount > 0) {
    output = "[][" + jsfEncode("at") + "]" +
      "[" + jsfEncode("constructor") + "]" +
      "(" + jsfEncode("return\"") + "+" + output + "+" + jsfEncode("\"") + ")()";
  }

  return output;
}

jsfFillMissingDigits();
jsfReplaceMap();
jsfReplaceStrings();

function jsFuckEncode(text) {
  if (typeof text !== "string") {
    if (text == null) return "";
    text = String(text);
  }
  return jsfEncode(text);
}

register({
  id: "jsfuck", cat: "text", name: "JSFuck", desc: "六字符 []()!+ 构造的 JS（双向：编码出求值即原文的表达式，解码走 Function 沙箱）",
  encode: jsFuckEncode,
  decode: jsFuckDecode,
  detect: (t) => (/^[\[\]()!+]+$/.test(t.trim()) && t.length >= 10 ? 0.6 : 0),
});

export { jsFuckDecode, jsFuckEncode };
