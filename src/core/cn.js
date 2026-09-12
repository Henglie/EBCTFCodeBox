/*
 * cn.js — 中文 / 本土编码（cat: 'cn'）。
 *
 * 移植自 WhatsInYourClipboard/src/core/cnCiphers.js（ISC，鸣谢 Leon406）
 * 补 encode + 修元素周期表 bug（53 号 I 碘原误写 In、30 号 Zn 锌原误写 Zi）+ 新增佛曰。
 * 当铺密码已在 fancy2.js 注册（cat: 'cn'，id: 'pawnshop'），此处不重复。
 * 中文电码 / 汉字笔画需大数据码表，留后续卡。
 */
import { register } from "./registry.js";

const te = new TextEncoder();
const td = (bytes) => new TextDecoder("utf-8").decode(new Uint8Array(bytes));

// 通用 UTF-8 ↔ base64（自包含，循环构造避免 spread 栈溢出）
function b64Enc(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function b64Dec(str) {
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ============ 天干地支 base60（六十甲子表） ============
const STEM = "甲乙丙丁戊己庚辛壬癸";
const BRANCH = "子丑寅卯辰巳午未申酉戌亥";
const STEM_BRANCH = [];
for (let i = 0; i < 60; i++) STEM_BRANCH.push(STEM[i % 10] + BRANCH[i % 12]);

function stemBranchEncode(text) {
  const bytes = te.encode(text);
  if (bytes.length === 0) return "";
  let num = 0n;
  for (const b of bytes) num = (num << 8n) | BigInt(b);
  if (num === 0n) return STEM_BRANCH[0]; // 全 0 字节 → 甲子（最小位）
  const radix = 60n;
  let out = "";
  while (num > 0n) {
    out = STEM_BRANCH[Number(num % radix)] + out;
    num /= radix;
  }
  return out;
}

function stemBranchDecode(text) {
  const clean = text.replace(/\s/g, "");
  if (!clean) return "";
  if (clean.length % 2 !== 0) throw new Error("天干地支输入长度须为偶数");
  const tokens = [];
  for (let i = 0; i + 2 <= clean.length; i += 2) tokens.push(clean.slice(i, i + 2));
  const radix = BigInt(STEM_BRANCH.length);
  let num = 0n;
  for (const tk of tokens) {
    const idx = STEM_BRANCH.indexOf(tk);
    if (idx === -1) throw new Error("非法天干地支 token: " + tk);
    num = num * radix + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  return td(bytes);
}

// ============ 百家姓（汉字 ↔ base64 字符映射） ============
const BJX = {
  赵:"0",钱:"1",孙:"2",李:"3",周:"4",吴:"5",郑:"6",王:"7",冯:"8",陈:"9",
  褚:"a",卫:"b",蒋:"c",沈:"d",韩:"e",杨:"f",朱:"g",秦:"h",尤:"i",许:"j",
  何:"k",吕:"l",施:"m",张:"n",孔:"o",曹:"p",严:"q",华:"r",金:"s",魏:"t",
  陶:"u",姜:"v",戚:"w",谢:"x",邹:"y",喻:"z",福:"A",水:"B",窦:"C",章:"D",
  云:"E",苏:"F",潘:"G",葛:"H",奚:"I",范:"J",彭:"K",郎:"L",鲁:"M",韦:"N",
  昌:"O",马:"P",苗:"Q",凤:"R",花:"S",方:"T",俞:"U",任:"V",袁:"W",柳:"X",
  唐:"Y",罗:"Z",薛:".",伍:"-",余:"_",米:"+",贝:"=",姚:"/",孟:"?",顾:"#",
  尹:"%",江:"&",钟:"*",
};
const BJX_REV = {};
for (const [ch, c] of Object.entries(BJX)) BJX_REV[c] = ch;

function baiJiaXingEncode(text) {
  const b64 = b64Enc(te.encode(text));
  return [...b64].map((c) => BJX_REV[c] ?? c).join("");
}

function baiJiaXingDecode(text) {
  let mapped = "";
  for (const ch of text) mapped += BJX[ch] ?? ch;
  const clean = mapped.replace(/[^A-Za-z0-9+/=]/g, "");
  if (!clean) return mapped;
  try {
    return td(b64Dec(clean));
  } catch {
    return mapped; // 退化：仅显示替换结果
  }
}

// ============ 元素周期表（符号 ↔ 序号 ↔ 字符） ============
// 修正 cnCiphers.js bug：30 号 Zn 锌（原误写 Zi）、53 号 I 碘（原误写 In）
const PERIOD = "H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og".split(" ");

function elementEncode(text) {
  return [...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code < 1 || code > 118) throw new Error("字符码 " + code + " 超出元素范围 1-118");
    return PERIOD[code - 1];
  }).join(" ");
}

function elementDecode(text) {
  return text.trim().split(/\s+/).filter(Boolean).map((sym) => {
    const idx = PERIOD.indexOf(sym);
    if (idx === -1) throw new Error("未知元素: " + sym);
    return String.fromCharCode(idx + 1);
  }).join("");
}

// ROT8000 已迁至 core/rotspecial.js（逐字复刻 rottytooth/rot8000 权威 transitions 表）
// 此处旧的硬编码区间近似版本删除，避免重复注册 id 抛错。

// keyfc / TudouCode V1: UTF-16LE, fixed AES-256-CBC key/IV, byte alphabet.
import { aesEncrypt, aesDecrypt } from "./modern.js";
const FO_KEY = new TextEncoder().encode("XDXDtudou@KeyFansClub^_^Encode!!");
const FO_IV = new TextEncoder().encode("Potato@Key@_@=_=");
const FO_CHARS = "滅苦婆娑耶陀跋多漫都殿悉夜爍帝吉利阿無南那怛喝羯勝摩伽謹波者穆僧室藝尼瑟地彌菩提蘇醯盧呼舍佛參沙伊隸麼遮闍度蒙孕薩夷迦他姪豆特逝朋輸楞栗寫數曳諦羅曰咒即密若般故不實真訶切一除能等是上明大神知三藐耨得依諸世槃涅竟究想夢倒顛離遠怖恐有礙心所以亦智道。集盡死老至";
const FO_MARKS = "冥奢梵呐俱哆怯諳罰侄缽皤";

function foyuEncode(text) {
  text = String(text);
  if (!text.length) return "佛曰：";
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    bytes[i * 2] = text.charCodeAt(i) & 255;
    bytes[i * 2 + 1] = text.charCodeAt(i) >>> 8;
  }
  const encrypted = aesEncrypt(bytes, FO_KEY, { mode: "CBC", iv: FO_IV, pad: true });
  const random = new Uint32Array(1);
  let out = "佛曰：";
  for (const b of encrypted) {
    if (b >= 128) { crypto.getRandomValues(random); out += FO_MARKS[random[0] % FO_MARKS.length]; }
    out += FO_CHARS[b & 127];
  }
  return out;
}

function foyuDecode(text) {
  const body = String(text).trim();
  if (!/^佛曰[:：]/.test(body)) throw new Error("佛曰密文须以「佛曰：」开头");
  const chars = [...body.slice(3)], bytes = [];
  for (let i = 0; i < chars.length; i++) {
    let high = 0;
    if (FO_MARKS.includes(chars[i])) { high = 128; i++; }
    if (i >= chars.length) throw new Error("佛曰高位标记截断");
    const index = FO_CHARS.indexOf(chars[i]);
    if (index < 0) throw new Error("佛曰字表外字符：" + chars[i]);
    bytes.push(index + high);
  }
  if (!bytes.length || bytes.length % 16) throw new Error("佛曰密文字节须为非空16字节倍数");
  const plain = aesDecrypt(Uint8Array.from(bytes), FO_KEY, { mode: "CBC", iv: FO_IV, pad: true });
  if (plain.length % 2) throw new Error("佛曰 UTF-16LE 字节数异常");
  let out = "";
  for (let i = 0; i < plain.length; i += 2) out += String.fromCharCode(plain[i] | plain[i + 1] << 8);
  return out;
}

// ============ 注册 ============
// ---- 六十甲子编号映射版（era 模式，兼容参考实现：值 1-60 → chr(v+60)） ----
// 标准 60 甲子表：idx 0-59 = 甲子..癸亥，序号 = idx+1
const ERA_MAP = {};
for (let i = 0; i < 60; i++) ERA_MAP[STEM_BRANCH[i]] = i + 1;
// 参考实现字典的错别字兼容（值对字错）：王辰/王戌（壬的错字）、Z酉(22=乙酉)/Z巳(42=乙巳)、单字午(55)
ERA_MAP["王辰"] = 29; ERA_MAP["王戌"] = 59; ERA_MAP["Z酉"] = 22; ERA_MAP["Z巳"] = 42; ERA_MAP["午"] = 55;

// 中文（60 甲子，含错别字兼容）→ ASCII（'='~'x'，序号+60）
function stemBranchEraEncode(text) {
  const clean = String(text || "").replace(/[\s，。,.]/g, "");
  if (!clean) return "";
  if (clean.length % 2 !== 0) throw new Error("天干地支输入长度须为偶数");
  let out = "";
  for (let i = 0; i < clean.length; i += 2) {
    const tk = clean.slice(i, i + 2);
    const v = ERA_MAP[tk];
    if (v === undefined) throw new Error("非法天干地支 token: " + tk);
    out += String.fromCharCode(v + 60);
  }
  return out;
}
// ASCII → 中文（60 甲子）
function stemBranchEraDecode(text) {
  let out = "";
  for (const ch of String(text || "")) {
    const v = ch.charCodeAt(0) - 60;
    if (v < 1 || v > 60) throw new Error("非法字符（需 ASCII '='~'x'）: " + ch);
    out += STEM_BRANCH[v - 1];
  }
  return out;
}

function stemBranchOpEncode(text, p) {
  const mode = (p && p.mode) || "auto";
  if (mode === "era") return stemBranchEraEncode(text);
  return stemBranchEncode(text); // auto/base60 同默认大整数版
}

function stemBranchOpDecode(text, p) {
  const mode = (p && p.mode) || "auto";
  const clean = String(text || "").replace(/[\s，。,.]/g, "");
  if (!clean) return "";
  const isAsciiEra = /^[\x3d-\x78]+$/.test(clean); // '='~'x'（era 密文字符集）
  if (mode === "era") {
    return isAsciiEra ? stemBranchEraDecode(clean) : stemBranchEraEncode(clean);
  }
  // auto：ASCII → era 逆；中文先 base60（默认），失败（含错别字）→ era 兼容表
  if (isAsciiEra) return stemBranchEraDecode(clean);
  try {
    return stemBranchDecode(text);
  } catch (e) {
    try { return stemBranchEraEncode(clean); }
    catch (e2) { throw e; }
  }
}

register({
  id: "stemBranch", cat: "cn", name: "天干地支",
  desc: "六十甲子编码（mode 切 base60 大整数 / era 编号映射；era 兼容参考实现错别字字典并自动检测）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "auto",
      options: [
        { value: "auto", label: "auto（解码自动检测：ASCII=era 逆，中文先 base60，错别字自动回落 era）" },
        { value: "base60", label: "base60（UTF-8 大整数）" },
        { value: "era", label: "era（60 甲子编号映射 + 错别字兼容）" },
      ] },
  ],
  encode: stemBranchOpEncode, decode: stemBranchOpDecode,
  detect: (t) => {
    const clean = t.replace(/\s/g, "");
    if (!clean || clean.length % 2 !== 0 || clean.length < 4) return 0;
    return [...clean].every((c) => STEM.includes(c) || BRANCH.includes(c)) ? 0.4 : 0;
  },
});

register({
  id: "baiJiaXing", cat: "cn", name: "百家姓", desc: "汉字 ↔ base64 字符映射（赵钱孙李…）",
  encode: baiJiaXingEncode, decode: baiJiaXingDecode,
  detect: (t) => {
    const chars = t.replace(/\s/g, "");
    if (!chars || chars.length < 2) return 0;
    return [...chars].every((c) => c in BJX) ? 0.3 : 0;
  },
});

register({
  id: "element", cat: "cn", name: "元素周期表", desc: "元素符号 ↔ 序号 ↔ 字符（H=1…Og=118）",
  encode: elementEncode, decode: elementDecode,
  detect: (t) => {
    const tokens = t.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return 0;
    return tokens.every((tk) => PERIOD.includes(tk)) ? 0.3 : 0;
  },
});

register({
  id: "foyu", cat: "cn", name: "佛曰", desc: "keyfc 与佛论禅 V1：UTF-16LE + 固定密钥 AES-256-CBC + 咒字映射；不支持如是我闻V2及旧自创方言",
  encode: foyuEncode, decode: foyuDecode,
  detect: (t) => (t.trim().startsWith("佛曰：") || t.trim().startsWith("佛曰:") ? 0.7 : 0),
});

export {
  stemBranchEncode, stemBranchDecode,
  baiJiaXingEncode, baiJiaXingDecode,
  elementEncode, elementDecode,
  foyuEncode, foyuDecode,
  STEM_BRANCH, BJX, PERIOD, FO_CHARS,
};
