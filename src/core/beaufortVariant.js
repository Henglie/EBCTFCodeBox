/*
 * beaufortVariant.js — 变体 Beaufort（Variant Beaufort / Variante allemande de Beaufort，cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 同一「字母密钥逐位加减」家族里，按字母序数（A=0 … Z=25）模 26 有三条互不相同的式子：
 *      标准 Vigenère ： c = (p + k) mod 26      非自反
 *      标准 Beaufort ： c = (k − p) mod 26      自反（编、解码同形）
 *      变体 Beaufort ： c = (p − k) mod 26      非自反
 *  - 变体 Beaufort 最有用的等价刻画是「加密 = 标准 Vigenère 的解密、解密 = 标准 Vigenère 的加密」，
 *    因此它非自反；dCode 亦称之为「Beaufort 的德意志变体」（Beaufort allemand），并指出
 *    「德意志版把密钥从明文中减去」，与标准 Beaufort 的「自反」相对。
 *  - 逐位计算、密钥循环重复；结果落在 0..25 后映射回字母。
 *
 * 权威来源：
 *  - dCode「Chiffre Variante de Beaufort」（https://www.dcode.fr/chiffre-variante-beaufort），
 *    访问日期 2026-09-23：给出完整算例——明文 DCODE、密钥 CLE、字母表 ABCDEFGHIJKLMNOPQRSTUVWXYZ
 *    → 密文 BRKBT，并逐步列出 3−2=1(B)、2−11=−9+26=17(R)、14−4=10(K)、3−2=1(B)、4−11=−7+26=19(T)；
 *    同时给出解码口径「把密文与密钥相加」（即等价 Vigenère 加密），与「非对称（非自反）」结论。
 *  - Wikipedia「Vigenère cipher」§ Variants / Variant Beaufort
 *    （https://en.wikipedia.org/wiki/Vigen%C3%A8re_cipher），访问日期 2026-09-23：
 *    「A simple variant is to encrypt by using the Vigenère decryption method and to decrypt by using
 *     Vigenère encryption. That method is sometimes referred to as "Variant Beaufort".」
 *  - Wikipedia「Beaufort cipher」（https://en.wikipedia.org/wiki/Beaufort_cipher），访问日期 2026-09-23：
 *    标准 Beaufort 是 reciprocal（自反）；「variant Beaufort」与之并列、非自反。
 *
 * 与既有 op 的关系（互不重复）：
 *  - 既有 `beaufort`（classic.js）恒为 c = k − p（自反）；本 op 为 c = p − k（非自反），
 *    两者互为「同一 tableau 的镜像方向」，任意非空输入下输出不同（除非密钥使两式重合）。
 *  - 既有 `vigenere` 为 c = p + k；本 op 的 decode 与其 encode 同形、encode 与其 decode 同形。
 *
 * 约定：
 *  - 默认只处理 A-Z（大小写均收，统一大写输出）；非字母字符默认丢弃（与既有 beaufort 一致）。
 *  - chars="keep" 时保留非字母字符原位（对应 dCode 页面的「Conserver la ponctuation」档）。
 *  - 密钥中非字母字符被忽略；密钥为空或过滤后无字母时**显式报错**（不静默原样返回——
 *    静默返回会让用户把「未加密的明文」当成密文，属误导；本 op 为新候选，采用显式拒绝口径，
 *    与既有 beaufort 的静默返回不同，差异已注明）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function keyLetters(key) {
  return String(key == null ? "" : key).toUpperCase().replace(/[^A-Z]/g, "");
}

/**
 * 变体 Beaufort 核心：c = (p − k) mod 26；decode 时按 p = (c + k) mod 26。
 * 非字母字符在 keep 档原位保留，不消耗密钥位。
 */
function variantRun(text, key, chars, decode) {
  const k = keyLetters(key);
  if (!k)
    throw new Error(`变体 Beaufort：密钥须含至少一个字母（当前 "${key == null ? "" : key}"）。`);
  const keep = chars === "keep";
  const src = String(text == null ? "" : text).toUpperCase();
  let idx = 0;
  let out = "";
  for (const ch of src) {
    const ci = AZ.indexOf(ch);
    if (ci < 0) {
      if (keep) out += ch;
      continue;
    }
    const kv = AZ.indexOf(k[idx % k.length]);
    idx++;
    const v = decode ? (ci + kv) % 26 : ((ci - kv) % 26 + 26) % 26;
    out += AZ[v];
  }
  return out;
}

register({
  id: "beaufortVariant", cat: "classic", name: "变体 Beaufort",
  desc: "变体 Beaufort（Beaufort 德意志变体）：c = p − k（mod 26），加密=维吉尼亚解密、解密=维吉尼亚加密；非自反（与自反的标准 Beaufort 互为镜像方向）",
  params: [
    { key: "key", label: "密钥", type: "text", default: "CLE", placeholder: "字母密钥，如 CLE" },
    { key: "chars", label: "字符处理", type: "select", default: "letters",
      options: [
        { value: "letters", label: "只保留字母（丢弃空格标点）" },
        { value: "keep", label: "保留非字母字符原位" },
      ] },
  ],
  encode: (t, p) => variantRun(t, p && p.key, p && p.chars, false),
  decode: (t, p) => variantRun(t, p && p.key, p && p.chars, true),
});

export { variantRun, keyLetters };
