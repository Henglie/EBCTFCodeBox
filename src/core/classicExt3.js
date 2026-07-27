/*
 * classicExt3.js — 古典密码补全组3（cat:'classic'）。
 *
 * 4 个古典密码，均双向（encode+decode）可逆：
 * - otp 一次一密 OTP（模 26 密钥流，非字节异或）
 * - keywordcipher 关键字密码（关键字构造替换表）
 * - simplesub 简单替换（自定义 26 字母映射）
 * - runningkey 滚动密钥（长文本作 key 的维吉尼亚）
 *
 * 算法来源：
 * simplesub — pycipher 0.5.2 SimpleSubstitution（James Lyons，MIT）。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 扩展欧几里得求模逆；不存在返回 -1。 */
function modInv(a, m) {
  a = ((a % m) + m) % m;
  for (let x = 1; x < m; x++) if ((a * x) % m === 1) return x;
  return -1;
}

// 大小写还原：把结果字母 r 套回源字符 src 的大小写。
const keepCase = (r, src) => (src >= "a" && src <= "z" ? r.toLowerCase() : r.toUpperCase());

// ============ OTP 一次一密（模 26 密钥流） ============
// 与「XOR」op 不同：这是字母表模 26 加减，非字节异或。密钥须为字母，长度须 ≥ 明文字母数。
function otpEncode(text, key = "", decrypt = false) {
  const kf = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!kf) throw new Error("OTP: 密钥须含字母");
  let ki = 0;
  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    const pi = AZ.indexOf(up);
    if (pi === -1) { out += ch; continue; } // 非字母原样，不占密钥流
    if (ki >= kf.length) throw new Error("OTP: 密钥长度须 ≥ 明文字母数（一次一密不复用密钥）");
    const k = AZ.indexOf(kf[ki]);
    ki++;
    const ci = decrypt ? (pi - k + 26) % 26 : (pi + k) % 26;
    out += keepCase(AZ[ci], ch);
  }
  return out;
}
const otpDecode = (text, key) => otpEncode(text, key, true);


// ============ 关键字密码 KeywordCipher ============
// Beta = 去重(关键字字母) + 剩余字母顺补；encode: Alpha[i]→Beta[i]，decode 反之。
function keywordAlphabet(keyword) {
  const kw = (keyword || "").toUpperCase().replace(/[^A-Z]/g, "");
  let beta = "";
  let gamma = AZ;
  for (const ch of kw) {
    if (gamma.includes(ch)) { beta += ch; gamma = gamma.replace(ch, ""); }
  }
  return beta + gamma; // 26 字符替换表
}
// caseMode: "keep"=保留原文大小写（默认）；"upper"=编码全大写/解码全小写（并入原 singleTable 行为）
function keywordEncode(text, keyword = "KEYWORD", caseMode = "keep") {
  const beta = keywordAlphabet(keyword);
  if (caseMode === "upper") {
    return [...text].map((c) => {
      const idx = AZ.indexOf(c.toUpperCase());
      return idx !== -1 ? beta[idx] : c;
    }).join("");
  }
  return text.replace(/[a-z]/gi, (ch) => keepCase(beta[AZ.indexOf(ch.toUpperCase())], ch));
}
function keywordDecode(text, keyword = "KEYWORD", caseMode = "keep") {
  const beta = keywordAlphabet(keyword);
  if (caseMode === "upper") {
    return [...text].map((c) => {
      const idx = beta.indexOf(c.toUpperCase());
      return idx !== -1 ? AZ[idx].toLowerCase() : c;
    }).join("");
  }
  return text.replace(/[a-z]/gi, (ch) => keepCase(AZ[beta.indexOf(ch.toUpperCase())], ch));
}

// ============ 简单替换 SimpleSubstitution（pycipher，26 字母置换表直给） ============
function simpleSubEncode(text, key = "AJPCZWRLFBDKOTYUQGENHXMIVS") {
  const k = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (k.length !== 26 || new Set(k).size !== 26)
    throw new Error("简单替换: 密钥须为 26 个不重复字母（A-Z 的一个排列）");
  return text.replace(/[a-z]/gi, (ch) => keepCase(k[AZ.indexOf(ch.toUpperCase())], ch));
}
function simpleSubDecode(text, key = "AJPCZWRLFBDKOTYUQGENHXMIVS") {
  const k = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (k.length !== 26 || new Set(k).size !== 26)
    throw new Error("简单替换: 密钥须为 26 个不重复字母（A-Z 的一个排列）");
  return text.replace(/[a-z]/gi, (ch) => keepCase(AZ[k.indexOf(ch.toUpperCase())], ch));
}

// ============ 滚动密钥 RunningKey（长文本作 key 的维吉尼亚） ============
// 与 vigenere 语义等价，惯用长文本（书页）作密钥。密钥字母流按明文字母推进，不足则循环。
function runningKeyEncode(text, key = "THEQUICKBROWNFOX", decrypt = false) {
  const kf = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!kf) throw new Error("滚动密钥: 密钥须含字母");
  let ki = 0;
  return text.replace(/[a-z]/gi, (ch) => {
    const pi = AZ.indexOf(ch.toUpperCase());
    const k = AZ.indexOf(kf[ki % kf.length]);
    ki++;
    const ci = decrypt ? (pi - k + 26) % 26 : (pi + k) % 26;
    return keepCase(AZ[ci], ch);
  });
}
const runningKeyDecode = (text, key) => runningKeyEncode(text, key, true);

// ---- 注册 ----
register({
  id: "otp", cat: "classic", name: "一次一密 OTP", desc: "模 26 密钥流加减（字母表，非字节异或）；密钥须 ≥ 明文字母数",
  params: [{ key: "key", label: "密钥（字母流）", type: "text", default: "SECRETKEY" }],
  encode: (t, p) => otpEncode(t, (p && p.key) || "SECRETKEY"),
  decode: (t, p) => otpDecode(t, (p && p.key) || "SECRETKEY"),
});

register({
  id: "keywordcipher", cat: "classic", name: "关键字密码", desc: "关键字去重打头 + 剩余字母顺补，构造单表替换（caseMode=upper 即原「单表置换密码」编大写/解小写行为）",
  params: [
    { key: "key", label: "关键字", type: "text", default: "KEYWORD" },
    { key: "caseMode", label: "大小写", type: "select", default: "keep",
      options: [
        { value: "keep", label: "保留原文大小写" },
        { value: "upper", label: "编大写/解小写（单表置换）" },
      ] },
  ],
  encode: (t, p) => keywordEncode(t, (p && p.key) || "KEYWORD", (p && p.caseMode) || "keep"),
  decode: (t, p) => keywordDecode(t, (p && p.key) || "KEYWORD", (p && p.caseMode) || "keep"),
});

register({
  id: "simplesub", cat: "classic", name: "简单替换", desc: "自定义 26 字母置换表单表替换（A-Z 依次映射到密钥表）",
  params: [{ key: "key", label: "26 字母置换表", type: "text", default: "AJPCZWRLFBDKOTYUQGENHXMIVS" }],
  encode: (t, p) => simpleSubEncode(t, (p && p.key) || "AJPCZWRLFBDKOTYUQGENHXMIVS"),
  decode: (t, p) => simpleSubDecode(t, (p && p.key) || "AJPCZWRLFBDKOTYUQGENHXMIVS"),
});

register({
  id: "runningkey", cat: "classic", name: "滚动密钥", desc: "长文本作密钥的维吉尼亚（密钥流按明文字母推进）",
  params: [{ key: "key", label: "密钥文本", type: "text", default: "THEQUICKBROWNFOX" }],
  encode: (t, p) => runningKeyEncode(t, (p && p.key) || "THEQUICKBROWNFOX"),
  decode: (t, p) => runningKeyDecode(t, (p && p.key) || "THEQUICKBROWNFOX"),
});

export {
  otpEncode, otpDecode,
  keywordEncode, keywordDecode, keywordAlphabet,
  simpleSubEncode, simpleSubDecode,
  runningKeyEncode, runningKeyDecode,
};
