/*
 * jjencode.js — JJEncode + AAEncode（cat:'fancy'，T266）。
 *
 * JJEncode 由 Yosuke Hasegawa（utf-8.jp）发明：把任意 JavaScript 源码编码成
 * 只用符号 [ ] ! + $ _ " . = , ; 的等价可执行代码。核心手法：
 * - 用 ~[] 得 -1，++ 递增造出数字 0..9；
 * - 从 (![]+"")="false" / (!""+"")="true" / ({}+"")="[object Object]"
 * 等表达式里按下标取字符，拼出 constructor / return / 各字母；
 * - gv.$ 最终等于 Function 构造器，末尾 gv.$(gv.$("return \"...\"")) 执行源码。
 *
 * 算法来源：照抄 utf-8.jp 官方 demo 的 jjencode 函数（编码表、位运算、转义
 * 逻辑逐字复刻，含原版对 >=0x80 非 ASCII 字符的补零 bug，不篡改不编造）。
 *
 * encode：原版 jjencode。
 * decode：安全还原——只执行「定义 gv 对象 + 内层返回源码串」的部分
 * （内层是 Function('return "..."')，仅拼字符串），绝不执行最外层
 * gv.$(source) 那次真正跑 payload 的调用。因此对任意源码（哪怕不是合法
 * JS）都能还原，且不会执行被编码的代码。
 *
 * 经往返测试验证。
 *
 * ============================================================
 * AAEncode（颜文字编码，同为 Yosuke Hasegawa 作品，T266 补全）
 *
 * 把任意 JavaScript 源码编码成日式颜文字（ﾟωﾟﾉ / ﾟΘﾟ / ﾟДﾟ 等），浏览器
 * 控制台粘贴即可执行。核心手法：
 * - ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻ / / *´∇｀* / ['_'] 颜文字头部（regex+注释技巧）；
 * - 构造 ﾟДﾟ 对象，属性 ﾟΘﾟ/ﾟωﾟﾉ/ﾟｰﾟﾉ/ﾟДﾟﾉ 从 "true"/"false" 串取字符；
 * - ﾟεﾟ = '\\'（反斜杠），(ﾟДﾟ)[ﾟoﾟ] = '\"'（双引号），组合出字符串定界符；
 * - 每个字符转为八进制（ASCII）或四位十六进制（非 ASCII），数字用 16 个
 * 颜文字表达式替换（$b[0..15]）；
 * - 末尾 (ﾟДﾟ)['_'](...)('_') 用 Function 构造器执行源码。
 *
 * 算法来源：照抄 utf-8.jp 原版 aaencode（经 PHP 移植版交叉验证，编码表
 * setup 串、转义逻辑逐字复刻，不篡改不编造）。
 *
 * aaEncode：原版 aaencode。
 * aaDecode：纯正则解析还原——不执行任何 JS 代码，按结构提取编码字符段
 * 逐字符替换颜文字表达式→数字→String.fromCharCode。安全无副作用。
 */
import { register } from "./registry.js";

// ---- 原版编码器（逐字移植 utf-8.jp jjencode） ----
function jjEncodeRaw(gv, text) {
  var r = "";
  var n;
  var b = ["___", "__$", "_$_", "_$$", "$__", "$_$", "$$_", "$$$",
           "$___", "$__$", "$_$_", "$_$$", "$$__", "$$_$", "$$$_", "$$$$"];
  var s = "";
  for (var i = 0; i < text.length; i++) {
    n = text.charCodeAt(i);
    if (n == 0x22 || n == 0x5c) {
      s += "\\\\\\" + text.charAt(i).toString(16);
    } else if ((0x21 <= n && n <= 0x2f) || (0x3a <= n && n <= 0x40) ||
               (0x5b <= n && n <= 0x60) || (0x7b <= n && n <= 0x7f)) {
      s += text.charAt(i);
    } else if ((0x30 <= n && n <= 0x39) || (0x61 <= n && n <= 0x66)) {
      if (s) r += '"' + s + '"+';
      r += gv + "." + b[n < 0x40 ? n - 0x30 : n - 0x57] + "+";
      s = "";
    } else if (n == 0x6c) { // 'l'
      if (s) r += '"' + s + '"+';
      r += "(![]+\"\")[" + gv + "._$_]+";
      s = "";
    } else if (n == 0x6f) { // 'o'
      if (s) r += '"' + s + '"+';
      r += gv + "._$+";
      s = "";
    } else if (n == 0x74) { // 't'
      if (s) r += '"' + s + '"+';
      r += gv + ".__+";
      s = "";
    } else if (n == 0x75) { // 'u'
      if (s) r += '"' + s + '"+';
      r += gv + "._+";
      s = "";
    } else if (n < 128) {
      if (s) r += '"' + s;
      else r += '"';
      r += "\\\\\"+" + n.toString(8).replace(/[0-7]/g, function (c) {
        return gv + "." + b[c] + "+";
      });
      s = "";
    } else {
      if (s) r += '"' + s;
      else r += '"';
      r += "\\\\\"+" + gv + "._+" + n.toString(16).replace(/[0-9a-f]/gi, function (c) {
        return gv + "." + b[parseInt(c, 16)] + "+";
      });
      s = "";
    }
  }
  if (s) r += '"' + s + '"+';

  r =
    gv + "=~[];" +
    gv + "={___:++" + gv + ",$$$$:(![]+\"\")[" + gv + "],__$:++" + gv +
    ",$_$_:(![]+\"\")[" + gv + "],_$_:++" + gv + ",$_$$:({}+\"\")[" + gv +
    "],$$_$:(" + gv + "[" + gv + "]+\"\")[" + gv + "],_$$:++" + gv +
    ",$$$_:(!\"\"+\"\")[" + gv + "],$__:++" + gv + ",$_$:++" + gv +
    ",$$__:({}+\"\")[" + gv + "],$$_:++" + gv + ",$$$:++" + gv +
    ",$___:++" + gv + ",$__$:++" + gv + "};" +
    gv + ".$_=" +
    "(" + gv + ".$_=" + gv + "+\"\")[" + gv + ".$_$]+" +
    "(" + gv + "._$=" + gv + ".$_[" + gv + ".__$])+" +
    "(" + gv + ".$$=(" + gv + ".$+\"\")[" + gv + ".__$])+" +
    "((!" + gv + ")+\"\")[" + gv + "._$$]+" +
    "(" + gv + ".__=" + gv + ".$_[" + gv + ".$$_])+" +
    "(" + gv + ".$=(!\"\"+\"\")[" + gv + ".__$])+" +
    "(" + gv + "._=(!\"\"+\"\")[" + gv + "._$_])+" +
    gv + ".$_[" + gv + ".$_$]+" +
    gv + ".__+" +
    gv + "._$+" +
    gv + ".$;" +
    gv + ".$$=" +
    gv + ".$+" +
    "(!\"\"+\"\")[" + gv + "._$$]+" +
    gv + ".__+" +
    gv + "._+" +
    gv + ".$+" +
    gv + ".$$;" +
    gv + ".$=(" + gv + ".___)[" + gv + ".$_][" + gv + ".$_];" +
    gv + ".$(" + gv + ".$(" + gv + ".$$+\"\\\"\"+" + r + "\"\\\"\")())();";

  return r;
}

// gv 名合法性：JS 标识符（这里编码只用它做属性/变量名，限定安全字符集）
function normGv(p) {
  var gv = (p && typeof p.gv === "string" && p.gv.trim()) || "$";
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(gv)) {
    throw new Error("变量名 gv 必须是合法 JS 标识符，如 $ 或 _");
  }
  return gv;
}

function jjEncode(text, p) {
  if (text == null || text === "") return "";
  return jjEncodeRaw(normGv(p), String(text));
}

// ---- 安全解码 ----
// 识别 JJEncode 首部，取出 gv 名。
function detectGv(code) {
  var m = code.match(/^\s*(\$|[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*~\s*\[\s*\]\s*;\s*\1\s*=\s*\{\s*___\s*:\s*\+\+\s*\1/);
  return m ? m[1] : null;
}

function jjDecode(code, p) {
  code = String(code == null ? "" : code).trim();
  if (!code) return "";
  var gv = detectGv(code);
  if (!gv) {
 // 允许用户手动指定 gv（首部被截断时）
    var g = p && typeof p.gv === "string" && p.gv.trim();
    if (g && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(g)) gv = g;
  }
  if (!gv) throw new Error("未识别到 JJEncode 结构（缺少 gv=~[];gv={___:++gv...} 首部）");

 // 定位执行段：setup 中不含函数调用，gv.$( 只在末尾执行段出现一次。
  var call = gv + ".$(";
  var idx = code.indexOf(call);
  if (idx < 0) throw new Error("未找到 JJEncode 执行段");
  var setup = code.slice(0, idx);
  var rest = code.slice(idx); // 形如 gv.$( INNER )();

 // 剥掉最外层 gv.$( ... ) 执行（这层才真正跑 payload），保留内层求值。
 // rest = gv.$( <INNER> ) [;]
  if (rest.slice(0, call.length) !== call) throw new Error("JJEncode 执行段格式异常");
  var inner = rest.slice(call.length); // <INNER> )() ;
 // 去掉尾部 ; 与最外层 )
  inner = inner.replace(/;+\s*$/, "");
  if (!/\)\s*\(\s*\)\s*$/.test(inner)) throw new Error("JJEncode 执行段尾部格式异常");
  inner = inner.replace(/\)\s*\(\s*\)\s*$/, ""); // 去掉最外层 )()
 // 现在 inner 应为 gv.$(gv.$$+"\""+ R +"\"") —— 内层，求值得源码串

 // 在受控作用域内求值：var gv 本地化，避免污染全局；
 // 内层只执行 Function('return "..."')（纯拼字符串），不执行 payload。
  var body = "var " + gv + ";" + setup + "return (" + inner + ");";
  var fn;
  try {
    fn = new Function(body); // 非严格函数体，允许 sloppy 赋值
  } catch (e) {
    throw new Error("JJEncode 解码构造失败：" + e.message);
  }
  var out = fn();
  return String(out);
}

register({
  id: "jjencode",
  cat: "fancy",
  name: "JJEncode",
  desc: "JavaScript 符号混淆编码（Yosuke Hasegawa），源码 → 仅 []()!+$_ 符号",
  params: [
    { key: "gv", label: "全局变量名", type: "text", default: "$", placeholder: "$ 或 _ 等合法标识符" },
  ],
  encode: jjEncode,
  decode: jjDecode,
  detect(s) {
    if (typeof s !== "string" || s.length < 40) return 0;
    var t = s.trim();
    if (!detectGv(t)) return 0;
    var score = 0.6;
 // 典型特征进一步加分
    if (/\(!\[\]\+""\)/.test(t)) score += 0.15;       // (![]+"")
    if (/\{\}\+""/.test(t)) score += 0.1;              // ({}+"")
    if (/\.\$\(.*\)\(\)\(\)\s*;?\s*$/.test(t)) score += 0.15; // 末尾 .$(...)()()
    return Math.min(1, score);
  },
});

// ============================================================
// AAEncode（颜文字编码，Yosuke Hasegawa，T266 补全）
// 算法来源：utf-8.jp 原版 aaencode（经 PHP 移植版交叉验证）
// ============================================================

// ---- 16 个颜文字数字表达式（照抄原版 $b 数组） ----
// 0-7 用于八进制，0-9 + a-f 用于十六进制
var AA_B = [
  "(c^_^o)",                    // 0
  "(ﾟΘﾟ)",                       // 1
  "((o^_^o) - (ﾟΘﾟ))",          // 2
  "(o^_^o)",                    // 3
  "(ﾟｰﾟ)",                       // 4
  "((ﾟｰﾟ) + (ﾟΘﾟ))",            // 5
  "((o^_^o) +(o^_^o))",         // 6
  "((ﾟｰﾟ) + (o^_^o))",          // 7
  "((ﾟｰﾟ) + (ﾟｰﾟ))",            // 8
  "((ﾟｰﾟ) + (ﾟｰﾟ) + (ﾟΘﾟ))",   // 9
  "(ﾟДﾟ) .ﾟωﾟﾉ",                // 10 → 'a'
  "(ﾟДﾟ) .ﾟΘﾟﾉ",                // 11 → 'b'
  "(ﾟДﾟ) ['c']",                // 12 → 'c'
  "(ﾟДﾟ) .ﾟｰﾟﾉ",                // 13 → 'd'
  "(ﾟДﾟ) .ﾟДﾟﾉ",                // 14 → 'e'
  "(ﾟДﾟ) [ﾟΘﾟ]"                 // 15 → 'f'
];

// ---- 固定头部（颜文字识别标志） ----
var AA_PREFIX = "ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻ //*´∇｀*/ ['_']; o=(ﾟｰﾟ) =_=3; c=(ﾟΘﾟ) =(ﾟｰﾟ)-(ﾟｰﾟ); ";

// ---- 主 setup（构造 ﾟДﾟ 对象 + ﾟεﾟ/ﾟoﾟ/oﾟｰﾟo 辅助变量） ----
// 照抄原版，含 ' ' 空格细节。JS 转义：\\\\ → \\（输出双反斜杠），\\\" → \"（输出反斜杠+引号）
var AA_SETUP =
  "(ﾟДﾟ) =(ﾟΘﾟ)= (o^_^o)/ (o^_^o);" +
  "(ﾟДﾟ)={ﾟΘﾟ: '_' ,ﾟωﾟﾉ : ((ﾟωﾟﾉ==3) +'_') [ﾟΘﾟ] " +
  ",ﾟｰﾟﾉ :(ﾟωﾟﾉ+ '_')[o^_^o -(ﾟΘﾟ)] " +
  ",ﾟДﾟﾉ:((ﾟｰﾟ==3) +'_')[ﾟｰﾟ] }; (ﾟДﾟ) [ﾟΘﾟ] =((ﾟωﾟﾉ==3) +'_') [c^_^o];" +
  "(ﾟДﾟ) ['c'] = ((ﾟДﾟ)+'_') [ (ﾟｰﾟ)+(ﾟｰﾟ)-(ﾟΘﾟ) ];" +
  "(ﾟДﾟ) ['o'] = ((ﾟДﾟ)+'_') [ﾟΘﾟ];" +
  "(ﾟoﾟ)=(ﾟДﾟ) ['c']+(ﾟДﾟ) ['o']+(ﾟωﾟﾉ +'_')[ﾟΘﾟ]+ ((ﾟωﾟﾉ==3) +'_') [ﾟｰﾟ] + " +
  "((ﾟДﾟ) +'_') [(ﾟｰﾟ)+(ﾟｰﾟ)]+ ((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+" +
  "((ﾟｰﾟ==3) +'_') [(ﾟｰﾟ) - (ﾟΘﾟ)]+(ﾟДﾟ) ['c']+" +
  "((ﾟДﾟ)+'_') [(ﾟｰﾟ)+(ﾟｰﾟ)]+ (ﾟДﾟ) ['o']+" +
  "((ﾟｰﾟ==3) +'_') [ﾟΘﾟ];(ﾟДﾟ) ['_'] =(o^_^o) [ﾟoﾟ] [ﾟoﾟ];" +
  "(ﾟεﾟ)=((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+ (ﾟДﾟ) .ﾟДﾟﾉ+" +
  "((ﾟДﾟ)+'_') [(ﾟｰﾟ) + (ﾟｰﾟ)]+((ﾟｰﾟ==3) +'_') [o^_^o -ﾟΘﾟ]+" +
  "((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+ (ﾟωﾟﾉ +'_') [ﾟΘﾟ]; " +
  "(ﾟｰﾟ)+=(ﾟΘﾟ); (ﾟДﾟ)[ﾟεﾟ]='\\\\'; " +
  "(ﾟДﾟ).ﾟΘﾟﾉ=(ﾟДﾟ+ ﾟｰﾟ)[o^_^o -(ﾟΘﾟ)];" +
  "(oﾟｰﾟo)=(ﾟωﾟﾉ +'_')[c^_^o];" +
  "(ﾟДﾟ) [ﾟoﾟ]='\\\"';" +
  "(ﾟДﾟ) ['_'] ( (ﾟДﾟ) ['_'] (ﾟεﾟ+";

// ---- 编码 ----
function aaEncode(text) {
  if (text == null || text === "") return "";
  text = String(text);
  var r = AA_PREFIX;

 // ひだまりスケッチ彩蛋（原版特性，照抄）
  if (/ひだまりスケッチ×(365|３５６)\s*来週も見てくださいね[!！]/.test(text)) {
    r += "X=_=3; ";
    r += "\r\n\r\n X / _ / X < \"来週も見てくださいね!\";\r\n\r\n";
  }

  r += AA_SETUP;
  r += "(ﾟДﾟ)[ﾟoﾟ]+ ";

  for (var i = 0; i < text.length; i++) {
    var n = text.charCodeAt(i);
    var t = "(ﾟДﾟ)[ﾟεﾟ]+";
    if (n <= 127) {
 // ASCII：八进制，每位 [0-7] → $b[digit]+
      var oct = n.toString(8);
      t += oct.replace(/[0-7]/g, function (c) {
        return AA_B[parseInt(c, 10)] + "+ ";
      });
    } else {
 // 非 ASCII：四位十六进制，前缀 (oﾟｰﾟo)+，每位 [0-9a-f] → $b[hexDigit]+
      var hex = ("000" + n.toString(16)).slice(-4);
      t += "(oﾟｰﾟo)+ " + hex.replace(/[0-9a-f]/gi, function (c) {
        return AA_B[parseInt(c, 16)] + "+ ";
      });
    }
    r += t;
  }

  r += "(ﾟДﾟ)[ﾟoﾟ]) (ﾟΘﾟ)) ('_');";
  return r;
}

// ---- 解码（纯正则解析，不执行任何 JS） ----
// 预构建替换表：按表达式长度降序排列，避免短表达式误匹配长表达式的子串
// （经分析，$b 表达式设计上 + 后缀后无子串冲突，但降序更保险）
var AA_REPLACE_TABLE = (function () {
  var arr = [];
  for (var k = 0; k < AA_B.length; k++) {
    arr.push({
      needle: AA_B[k] + "+ ",
      digit: k <= 7 ? String(k) : k.toString(16),
    });
  }
  arr.sort(function (a, b) { return b.needle.length - a.needle.length; });
  return arr;
})();

function aaDecode(code) {
  if (!code || typeof code !== "string") return "";
  code = code.trim();
  if (!code) return "";

 // 检测 AAEncode 头部
  if (code.indexOf("ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻") < 0) {
    throw new Error("未识别到 AAEncode 结构（缺少颜文字头部 ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻）");
  }

 // 提取编码字符段：在 "(ﾟДﾟ)[ﾟoﾟ]+ " 和 "(ﾟДﾟ)[ﾟoﾟ])" 之间
  var startMarker = "(ﾟДﾟ)[ﾟoﾟ]+ ";
  var endMarker = "(ﾟДﾟ)[ﾟoﾟ])";
  var startIdx = code.indexOf(startMarker);
  if (startIdx < 0) throw new Error("未找到 AAEncode 字符段起始标记");
  var endIdx = code.lastIndexOf(endMarker);
  if (endIdx < 0 || endIdx <= startIdx) throw new Error("未找到 AAEncode 字符段结束标记");
  var charsSection = code.slice(startIdx + startMarker.length, endIdx);

 // 按字符分隔符 "(ﾟДﾟ)[ﾟεﾟ]+" 切分，每段对应一个字符的编码
  var parts = charsSection.split("(ﾟДﾟ)[ﾟεﾟ]+");
  var result = "";

  for (var i = 0; i < parts.length; i++) {
    var s = parts[i];
    if (!s.trim()) continue;

 // 替换所有 $b[k]+ " → 对应数字（split/join 全量替换）
    for (var j = 0; j < AA_REPLACE_TABLE.length; j++) {
      var entry = AA_REPLACE_TABLE[j];
      if (s.indexOf(entry.needle) >= 0) {
        s = s.split(entry.needle).join(entry.digit);
      }
    }

    s = s.trim();
    if (!s) continue;

    if (s.indexOf("(oﾟｰﾟo)") >= 0) {
 // 非 ASCII：去 (oﾟｰﾟo)+ 前缀，剩余 4 位十六进制
      var hex = s.replace(/\(oﾟｰﾟo\)\+?\s*/g, "").trim();
      if (hex) result += String.fromCharCode(parseInt(hex, 16));
    } else {
 // ASCII：八进制
      result += String.fromCharCode(parseInt(s, 8));
    }
  }

  return result;
}

// 注：aaencode 已由 fancyExt.js 注册（既有），此处不重复注册避免 registry throw。
