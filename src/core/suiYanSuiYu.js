/*
 * suiYanSuiYu.js — 随言随语密码（cat:'cn'）。
 *
 * 算法链路（SBZL_enc/SBZL_dec）:
 * 1. 4 字符字典 SBZLdic（代表 4 进制数字 0/1/2/3）
 * 2. 7 字符长度表 SBZLlen（代表 4 进制位数 1-7）
 * 3. encode: 每字符 ord → 4 进制字符串（base10_conv1）→ 每位映射 SBZLdic → 加长度前缀 SBZLlen[位数-1]
 * 输出 = "同类工具语录：" + 随机前缀（1-4 字符）+ 各字符编码段
 * 4. decode: 去前缀 → 跳随机前缀 → 逐段读长度前缀 → 读对应位数 → 4 进制转 int → chr
 *
 * 随机性: encode 的随机前缀（rnum + rstr）使输出不固定，但 decode 能还原任意合法编码。
 *
 * 约束:
 * - SBZLdic / SBZLlen / 前缀字符串为算法固定数据。
 * - 纯前端零外发。
 *
 * 契约：register({id, cat:"cn", name, desc, encode, decode})。
 * encode(text) → 随言随语编码串
 * decode(text) → 原文
 */
import { register } from "./registry.js";

// ============================================================
// 字典
// SBZLdic: 4 字符，代表 4 进制数字 0/1/2/3
// SBZLlen: 7 字符，代表 4 进制位数 1-7（索引 0-6 → 位数 1-7）
// ============================================================
const SBZLdic = "\u968f\u6ce2\u9010\u6d41"; // 4 字符字典
const SBZLlen = "\u6c5f\u6cb3\u6d2a\u6d6a\u6e56\u6cca\u6d77"; // 7 字符长度表
const SBZL_PREFIX = "\u968f\u6ce2\u9010\u6d41\u8bed\u5f55\uff1a"; // 前缀（6 字符 + 冒号）

// 反向表
const SBZLdic_INDEX = {};
for (let i = 0; i < SBZLdic.length; i++) SBZLdic_INDEX[SBZLdic[i]] = i;
const SBZLlen_INDEX = {};
for (let i = 0; i < SBZLlen.length; i++) SBZLlen_INDEX[SBZLlen[i]] = i;

// ============================================================
// base10_conv1: 10 进制 → x 进制字符串
// ============================================================
function base10Conv1(n, x) {
  const b = [];
  let num = n;
  while (true) {
    const s = Math.floor(num / x);
    const y = num % x;
    b.push(y);
    if (s === 0) break;
    num = s;
  }
  b.reverse();
  return b.join("");
}

// ============================================================
// 随机整数 [min, max]（照 Python random.randint）
// ============================================================
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// 随机采样不重复（照 Python random.sample，取 rnum 个不重复字符）
function randSample(str, rnum) {
  const arr = [...str];
 // Fisher-Yates 部分洗牌取前 rnum 个
  for (let i = 0; i < rnum; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, rnum).join("");
}

// ============================================================
// 随言随语编码（SBZL_enc）
// ============================================================
function suiYanSuiYuEncode(text) {
  let result = SBZL_PREFIX;
  const rnum = randInt(1, 4);
  const rstr = randSample(SBZLdic, rnum);
 // 前缀 = SBZLdic[rnum-1] + rstr（照 L15053）
  result += SBZLdic[rnum - 1] + rstr;
  for (const c of text) {
    const num4 = base10Conv1(c.codePointAt(0), 4);
    let num4str = "";
    for (const n of num4) {
      num4str += SBZLdic[parseInt(n, 10)];
    }
    const rlen = num4.length;
 // 守卫: SBZLlen 仅 7 字符（4^7=16384，max 16383），码位超出时原算法 IndexError
    if (rlen > 7) throw new Error(`随言随语编码: 字符 "${c}" 码位 ${c.codePointAt(0)} 超出 4 进制 7 位范围（max 16383），原算法不支持`);
    const enStr = SBZLlen[rlen - 1] + num4str;
    result += enStr;
  }
  return result;
}

// ============================================================
// 随言随语解码（SBZL_dec）
// ============================================================
function suiYanSuiYuDecode(text) {
  let txt = text.replace(SBZL_PREFIX, "");
  if (txt.length === 0) return "";
 // rnum = SBZLdic.index(txt[0])（照 L15071）
  const firstChar = txt[0];
  const rnum = SBZLdic_INDEX[firstChar];
  if (rnum === undefined) throw new Error(`随言随语解码: 首字符 "${firstChar}" 不在字典中`);
 // txt = txt[rnum+2:]（照 L15072，跳过前缀共 rnum+2 个字符）
 // 注: 编码时前缀 = SBZLdic[rnum-1] + rstr（rstr 长 rnum），共 1+rnum 字符
 // 解码 rnum = SBZLdic.index(txt[0]) 是 0-3（编码 rnum-1），跳 rnum+2 = 编码 rnum+1 字符
  txt = txt.slice(rnum + 2);
  let strat = 0;
  let result = "";
  while (strat < txt.length) {
 // rlen = SBZLlen.index(txt[strat]) + 1（照 L15076）
    const lenChar = txt[strat];
    const lenIdx = SBZLlen_INDEX[lenChar];
    if (lenIdx === undefined) throw new Error(`随言随语解码: 长度字符 "${lenChar}" 不在长度表中`);
    const rlen = lenIdx + 1;
 // num4str = txt[strat+1 : strat+rlen+1]（照 L15077）
    const num4str = txt.slice(strat + 1, strat + rlen + 1);
    if (num4str.length < rlen) break; // 末尾不足，截断
 // num4 = 每字符 → SBZLdic.index(n)（照 L15082-15084）
    let num4 = "";
    for (const n of num4str) {
      const idx = SBZLdic_INDEX[n];
      if (idx === undefined) throw new Error(`随言随语解码: 字符 "${n}" 不在字典中`);
      num4 += idx.toString();
    }
 // chr(int(num4, 4))（照 L15086）
    const codePoint = parseInt(num4, 4);
    result += String.fromCodePoint(codePoint);
    strat += rlen + 1;
  }
  return result;
}

// ============================================================
// detect: 一键解码识别指纹（宁松勿严，返回 >0 即会被 magic 尝试解码）
// 1) 命中前缀 "同类工具语录：" → 0.7（前缀高度特异，几乎不可能误报）
// 2) 无前缀但字符全落在 SBZLdic+SBZLlen 字符集内且够长 → 0.2（兜底，防漏判裸密文）
// ============================================================
const SBZL_CHARSET = new Set([...SBZLdic, ...SBZLlen]);

function detectSuiYanSuiYu(t) {
  if (!t || typeof t !== "string") return 0;
  const s = t.trim();
  if (s.startsWith(SBZL_PREFIX)) return 0.7;
 // 冒号变体（半角）：前缀主体 + 半角冒号
  const prefixBody = SBZL_PREFIX.slice(0, -1); // 去全角冒号
  if (s.startsWith(prefixBody + ":")) return 0.7;
 // 兜底：裸密文（全字典字符，够长）
  if (s.length < 4) return 0;
  for (const ch of s) {
    if (!SBZL_CHARSET.has(ch)) return 0;
  }
  return 0.2;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "suiYanSuiYu",
  cat: "cn",
  name: "随言随语",
  desc: "字符 ord 转 4 进制 → 字典映射 + 长度前缀（cn 花式编码）",
  encode: suiYanSuiYuEncode,
  decode: suiYanSuiYuDecode,
  detect: detectSuiYanSuiYu,
});

export { suiYanSuiYuEncode, suiYanSuiYuDecode, base10Conv1, SBZLdic, SBZLlen, SBZL_PREFIX };
