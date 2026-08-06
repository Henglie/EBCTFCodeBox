/*
 * roar.js — 兽音译者（roar 4 字符 codec 变体，cat:'fancy'）。
 *
 * 与 yygq（兽音译者·就这¿/不会吧？比特流版）算法不同：
 * 本 op 是 roar.iiilab.com 的核心编码——每字符 Unicode 码点 → 4 位 hex，
 * 每 hex 位按位置偏移后拆成 4 字符 codec 的 2 字符映射，前后缀包裹。
 *
 * 算法：
 * - encode：content 每字符 ord → format(ord, "04x") 拼 hex_str；
 *   t = codec[3]+codec[1]+codec[0] 前缀；对 hex_str 第 s 位：
 *   n = int(hex_str[s],16) + s%16（超 16 回绕）；n//4 和 n%4 索引 codec 两字符；
 *   密文 = t + middle + codec[2]。
 * - decode：找前缀 t 和后缀 codec[2] 之间的中间段（长度须偶数）；
 *   每 2 字符索引 codec → n = 4*idx1+idx2 - pos%16（负回绕）→ hex 位；
 *   4 位一组 int(,16) → chr。
 *
 * 参数：codec 默认 "嗷呜啊~"，可自定义（必须 4 个不重复字符）。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * detect：兽音类 op 的字符集高度可变（codec 可任意），不写 detect（对齐 yygq 的
 * runOneKey 显式调度风格）。
 *
 * 契约：register({ id:"roar", cat:"fancy", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

const DEFAULT_CODEC = "嗷呜啊~";

function encodeRoar(content, codec) {
  if (codec.length !== 4 || new Set(codec).size !== 4) {
    throw new Error("编码字符必须是 4 个不重复的字符");
  }
  let hexStr = "";
  for (const ch of String(content)) {
    hexStr += ch.codePointAt(0).toString(16).padStart(4, "0");
  }
  const t = codec[3] + codec[1] + codec[0];
  let middle = "";
  for (let s = 0; s < hexStr.length; s++) {
    let n = parseInt(hexStr[s], 16) + (s % 16);
    if (n >= 16) n -= 16;
    middle += codec[Math.floor(n / 4)] + codec[n % 4];
  }
  return t + middle + codec[2];
}

function decodeRoar(content, codec) {
  if (codec.length !== 4 || new Set(codec).size !== 4) {
    throw new Error("编码字符必须是 4 个不重复的字符");
  }
  const t = codec[3] + codec[1] + codec[0];
  const endChar = codec[2];
  const startPos = content.indexOf(t);
  const endPos = content.lastIndexOf(endChar);
  if (startPos === -1 || endPos === -1 || endPos <= startPos) {
    throw new Error("密文格式错误，无法识别有效部分");
  }
  const middlePart = content.slice(startPos + t.length, endPos);
  if (middlePart.length % 2 !== 0) {
    throw new Error("密文格式错误，中间部分长度应为偶数");
  }
  let hexStr = "";
  for (let s = 0; s < middlePart.length; s += 2) {
    const idx1 = codec.indexOf(middlePart[s]);
    const idx2 = codec.indexOf(middlePart[s + 1]);
    if (idx1 === -1 || idx2 === -1) {
      throw new Error("密文包含无效字符，无法解码");
    }
    let n = 4 * idx1 + idx2 - ((s / 2) % 16);
    if (n < 0) n += 16;
    hexStr += n.toString(16);
  }
  if (hexStr.length % 4 !== 0) {
    throw new Error("密文格式错误，16 进制部分长度不正确");
  }
  let plain = "";
  for (let i = 0; i < hexStr.length; i += 4) {
    const code = parseInt(hexStr.slice(i, i + 4), 16);
    if (Number.isNaN(code)) throw new Error("密文包含无效的 16 进制数据");
    plain += String.fromCodePoint(code);
  }
  return plain;
}

function roarEncode(text, p) {
  const codec = (p && p.codec) || DEFAULT_CODEC;
  if (!codec) return encodeRoar(text, DEFAULT_CODEC);
  return encodeRoar(text, codec);
}
function roarDecode(text, p) {
  const codec = (p && p.codec) || DEFAULT_CODEC;
  return decodeRoar(text, codec || DEFAULT_CODEC);
}

register({
  id: "roar",
  cat: "fancy",
  name: "兽音译者（嗷呜啊~）",
  desc: "兽音译者 roar 4 字符 codec 变体：Unicode 码点 → 4 位 hex → 按位偏移 → codec 2 字符映射 + 前后缀包裹。codec 可自定义（4 个不重复字符）。与 yygq（就这¿/不会吧？）是不同算法",
  params: [
    { key: "codec", label: "编码字符（4 个不重复）", type: "text", default: DEFAULT_CODEC, placeholder: "如 嗷呜啊~ / 喵汪哞咩" },
  ],
  encode: roarEncode,
  decode: roarDecode,
});

export { encodeRoar, decodeRoar };
