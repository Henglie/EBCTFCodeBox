/*
 * qqxiuzi_misc.js — QQ秀异构 3 op（braille/chinese/music）。
 *
 * 算法来源：QQ秀 braille/chinese/music 三种异形字加密算法。
 * chinese 的 SB/MB/MT/FIRST_EX 表由 gen_qqx_misc.cjs 提取。
 *
 * 3 个异构算法（各自独立，非同构）:
 *
 * == braille（盲文，近亲变种） ==
 * - BRAILLE_BASE = 10240，1 字符/字节（非 hex）
 * - _key(pwd) = sum(ord)^48（含正则校验，与 hex 族一致）
 * - 有 key: enc = ord^48^ek，max<256 用 1 字符 + "="，否则 2 字符（hi,lo）+ "=="
 * - 无 key: enc = ord^48，v<128 用 1 字符，否则 2 字符（hi|128, lo）+ "="（特殊 |128 处理）
 *
 * == chinese（汉字，完全异构） ==
 * - 三表 SB(256)/MB(256)/MT(7) + FIRST_EX(3) 特例
 * - 三后缀 "="（单字节）/"=="（双字节）/"==="（三字节）
 * - key 推导: _key_int(k) = (sum>>8)<<8 | (sum&0xFF)^0x30，拆 kH/kL 双分量
 * - 单字节: SB[cp^kL] + "="
 * - 双字节: SB[high^0x30^kH]（或 FIRST_EX 回退）+ MB[low^kL] + "=="
 * - 三字节: SB[b0^0x30] + MB[b1^0x30] + MT[b2^kL] + "==="
 *
 * == music（音乐符号，完全异构） ==
 * - _SYMBOLS = ['‖','♭','♯','§','∮','♪','♩','♫','♬','¶']（10 项，0-9）
 * - 十进制 3 字符编码: _sym(val) = _D2S[val//100] + _D2S[val//10%10] + _D2S[val%10]
 * - _key(pwd) = sum(ord)^48（含正则校验）
 * - 三种前缀后缀: ♯=（短，val<100）/ §=（标准，3 字符）/ ♪==（宽，val>=10000）
 * - 宽模式压缩: 5 字符 = _sym(v//100) + _sym(v%100*10+5)[:2]
 *
 * op 设计（双向 + 契约 + detect）:
 * - qqxiuzi_braille: encode/decode 用盲文算法
 * - qqxiuzi_chinese: encode/decode 用汉字算法
 * - qqxiuzi_music: encode/decode 用音乐符号算法
 *
 * 单向依赖：仅 import registry.js，不反向 import 上层。
 */
import { register } from "./registry.js";

// ============ braille（盲文，近亲变种） ============
const BRAILLE_BASE = 10240;
const XOR_BASE = 48;
const KEY_RE = /^[0-9A-Za-z_]+$/;

function deriveKey(pwd) {
  if (!pwd) return 0;
  if (!KEY_RE.test(pwd)) return 0;
  let s = 0;
  for (const c of pwd) s += c.codePointAt(0);
  return s ^ XOR_BASE;
}

function brailleEncode(text, key) {
  if (!text) return "";
  const ek = deriveKey(key);
  const hasKey = key !== undefined && key !== null && key !== "";
  const encVals = [];
  for (const ch of text) {
    const raw = ch.codePointAt(0) ^ XOR_BASE;
    const enc = hasKey ? (raw ^ ek) : raw;
    encVals.push(enc);
  }
  if (hasKey) {
    const maxEnc = Math.max(...encVals);
    if (maxEnc < 256) {
      return encVals.map(v => String.fromCodePoint(BRAILLE_BASE + v)).join("") + "=";
    }
    let r = "";
    for (const v of encVals) {
      const hi = Math.floor(v / 256), lo = v % 256;
      r += String.fromCodePoint(BRAILLE_BASE + hi) + String.fromCodePoint(BRAILLE_BASE + lo);
    }
    return r + "==";
  }
  let r = "";
  for (const v of encVals) {
    if (v < 128) {
      r += String.fromCodePoint(BRAILLE_BASE + v);
    } else {
      const hi = (Math.floor(v / 256) | 128), lo = v % 256;
      r += String.fromCodePoint(BRAILLE_BASE + hi) + String.fromCodePoint(BRAILLE_BASE + lo);
    }
  }
  return r + "=";
}

function brailleDecode(text, key) {
  if (!text) return "";
  const ek = deriveKey(key);
  const hasKey = key !== undefined && key !== null && key !== "";
  let suffix2 = false;
  if (text.endsWith("==")) { text = text.slice(0, -2); suffix2 = true; }
  else if (text.endsWith("=")) { text = text.slice(0, -1); }
  if (!text) return "";
  const chars = Array.from(text);
  const n = chars.length;
  let r = "";
  if (hasKey) {
    const step = suffix2 ? 2 : 1;
    for (let i = 0; i + step <= n; i += step) {
      let enc;
      if (step === 2) {
        const b1 = chars[i].codePointAt(0) - BRAILLE_BASE;
        const b2 = chars[i + 1].codePointAt(0) - BRAILLE_BASE;
        enc = b1 * 256 + b2;
      } else {
        enc = chars[i].codePointAt(0) - BRAILLE_BASE;
      }
      r += String.fromCodePoint(enc ^ ek ^ XOR_BASE);
    }
  } else {
    let i = 0;
    while (i < n) {
      const b1 = chars[i].codePointAt(0) - BRAILLE_BASE;
      if (b1 >= 128) {
        if (i + 1 >= n) break;
        const b2 = chars[i + 1].codePointAt(0) - BRAILLE_BASE;
        const raw = (b1 & 127) * 256 + b2;
        r += String.fromCodePoint(raw ^ XOR_BASE);
        i += 2;
      } else {
        r += String.fromCodePoint(b1 ^ XOR_BASE);
        i += 1;
      }
    }
  }
  return r;
}

// ============ chinese（汉字，完全异构） ============
// 表由 gen_qqx_misc.cjs 提取
const SB = [null,"亵","愀","埸","谲","揼","剃","啺","噤","棹","洇","荏","榍","洇","腚","弼","眵","篙","辈","饫","雯","烛","森","玷","坪","蕞","耽","揅",null,null,null,null,"疆","岌","蟊","娅","蒲","鲷","除","狃","恙","攘","酗","玲","贡","汴","牯","骘","怜","适","虬","皑","缬","正","恫","阒","衷","茂","辁","榧","刿","靓","温","悸","出","霄","笫","磕","渑","毕","柢","闶","捷","洗","稠","亢","葙","我","俐","妆","鹜","零","耜","幢","钠","渤","阴","苜","缠","蚓","蒺","痪","尻","掣","捭","足","眶","奴","舸","节","启","抡","圯","撺","指","枨","豳","懒","这","榻","喵","岁","停","咀","彤","嚼","铤","萋","纾","揪","亮","晕","薨","籍","榆","馑","馁","证","舨","溴","怒","邂","姘","石","逞","逍","闾","旎","碗","株","颀","雍","咕","濯","涞","度","嘧","澉","介","郛","鸠","曳","童","耄","涌","须","洳","栋","扩","锟","轷","稃","翳","笠","璨","厥","坫","址","佐","伴","钼","渔","懊","赶","佛","潘","岳","馊","笺","庄","多","镣","硌","嚎","馓","羰","芄","卫","皮","躇","践","蓉","容","颅","畜","僦","主","鲭","役","跟","床","阚","赠","耖","觅","赏","蕖","间","农","缺","堕","窆","鐾","藿","缈","昔","埂","呒","苁","漆","怆","嗾","猜","菽","晌","鲂","镒","披","謦","镓","胜","恼","鸶","倩","挎","想","祗","瑚","怡","斟","玛","荻","飓","慢","乾","琰","仿","蝉","侬","脍","筵","萄","戛","囔","锓","俳"];
const MB = ["只","酢","励","镔","轼","褪","赋","折","跖","篾","眷","赉","萦","溶","仅","驻","楔","懔","邝","虚","蠡","账","煸","徉","堆","顶","唇","搀","绵","赖","茕","轶","崽","铷","会","焦","凫","锄","荨","桕","步","隽","鞒","拊","锫","攉","哎","峒","燃","煨","啜","敲","旭","郾","腺","薰","舢","分","盲","铍","寐","纷","懦","挞","裾","脾","赀","檎","臆","囵","甑","耪","力","颛","咽","蛹","涵","瓮","胀","溯","瓷","囟","姓","溪","眄","鹎","龈","哨","盖","崦","隙","膈","陔","鬻","癞","线","喊","鹧","嗥","票","娶","玟","瞧","傈","蚯","逖","卞","坜","取","嘁","辋","盎","谴","婀","戈","炅","魔","揆","嫁","翰","末","眨","螃","镆","讯","兮","负","饼","逻","履","尤","棍","笪","莜","隧","筅","挣","酐","皖","锃","牝","蝌","爆","谰","龇","瞿","迂","泞","壅","技","疗","树","他","瘅","璞","笆","黛","羞","爸","学","擂","巯","唛","崃","谭","称","阔","筮","浑","探","辫","吉","酆","如","贤","其","荒","冁","铈","隼","崂","寓","淠","弊","颐","濡","谏","氤","写","跛","椹","咐","萘","锆","虔","舯","毒","漉","认","桧","徙","池","拟","傺","她","翊","戌","璃","船","匙","蝎","庚","绞","蕊","骀","谀","阌","生","跄","赘","魁","盱","氍","枕","瞢","泅","援","艰","薏","彗","甯","悚","脚","瘗","椟","铅","锞","氕","蒇","胨","珑","霸","饪","愍","闳","浍","唬","庠","绷","舁","黉","育","炒","范","盘","睐"];
const MT = {"0":"骊","1":"越","2":"赛","28":"庳","79":"溺","80":"菥","81":"科"};
const FIRST_EX = {"39":"玷","40":"坪","45":"溉"};
const REV_SB = new Map();
SB.forEach((ch, i) => { if (ch !== null) REV_SB.set(ch, i); });
const REV_MB = new Map();
MB.forEach((ch, i) => { if (ch !== null) REV_MB.set(ch, i); });
const REV_MT = new Map();
for (const [k, v] of Object.entries(MT)) REV_MT.set(v, parseInt(k, 10));
const REV_FIRST_EX = new Map();
for (const [k, v] of Object.entries(FIRST_EX)) REV_FIRST_EX.set(v, parseInt(k, 10));

// chinese key 推导: _key_int(k) = (sum>>8)<<8 | (sum&0xFF)^0x30
function keyInt(k) {
  if (k === "" || k === undefined || k === null) k = "0";
  let s = 0;
  for (const c of k) s += c.codePointAt(0);
  return ((s >> 8) & 0xFF) << 8 | ((s & 0xFF) ^ 0x30);
}

function firstByte(byte) {
  const x = byte ^ 0x30;
  if (SB[x] !== null && SB[x] !== undefined) return SB[x];
  const ch = FIRST_EX[String(byte)];
  if (ch) return ch;
  throw new Error("字节 0x" + byte.toString(16) + " 无法编码");
}

function firstRev(ch) {
  const h = REV_FIRST_EX.get(ch);
  if (h !== undefined) return h;
  return REV_SB.get(ch) ^ 0x30;
}

function chineseEncode(text, key) {
  if (!text) return "";
  if (key === "" || key === undefined || key === null) key = "0";
  const ik = keyInt(key);
  const kL = ik & 0xFF;
  const kH = ik >= 256 ? ((ik >> 8) & 0xFF) : 0;
  const cps = Array.from(text).map(c => c.codePointAt(0));
  const mc = cps.length ? Math.max(...cps) : 0;
  let mode;
  if (mc > 65535) mode = 2;
  else if (mc >= 256 || ik >= 256) mode = 1;
  else mode = 0;
  const out = [];
  for (const cp of cps) {
    if (mode === 0) {
      out.push(SB[cp ^ kL]);
    } else if (mode === 1) {
      out.push(firstByte((cp >> 8 & 0xFF) ^ kH));
      out.push(MB[(cp & 0xFF) ^ kL]);
    } else {
      const b0 = (cp >> 16) & 0xFF;
      const b1 = (cp >> 8) & 0xFF;
      const b2 = cp & 0xFF;
      const ch2 = MT[String(b2 ^ kL)];
      if (ch2 === undefined) throw new Error("U+" + cp.toString(16) + " 末字节 0x" + b2.toString(16) + " 无三字节映射");
      out.push(SB[b0 ^ 0x30]);
      out.push(MB[b1 ^ 0x30]);
      out.push(ch2);
    }
  }
  if (mode === 0) out.push("=");
  else if (mode === 1) out.push("==");
  else out.push("===");
  return out.join("");
}

function chineseDecode(cipher, key) {
  if (key === "" || key === undefined || key === null) key = "0";
  const ik = keyInt(key);
  const kL = ik & 0xFF;
  const kH = ik >= 256 ? ((ik >> 8) & 0xFF) : 0;
  if (cipher.endsWith("===")) {
    const ct = Array.from(cipher.slice(0, -3));
    const out = [];
    for (let i = 0; i + 2 < ct.length; i += 3) {
      const c0 = ct[i], c1 = ct[i + 1], c2 = ct[i + 2];
      const b0 = REV_SB.get(c0) ^ 0x30;
      const b1 = REV_MB.get(c1);
      const b2 = REV_MT.get(c2);
      if (b1 === undefined) throw new Error(JSON.stringify(c1) + " 无中字节映射");
      if (b2 === undefined) throw new Error(JSON.stringify(c2) + " 无末字节映射");
      const cp = (b0 << 16) | ((b1 ^ 0x30) << 8) | (b2 ^ kL);
      out.push(String.fromCodePoint(cp));
    }
    return out.join("");
  }
  if (cipher.endsWith("==")) {
    const ct = Array.from(cipher.slice(0, -2));
    const out = [];
    for (let i = 0; i + 1 < ct.length; i += 2) {
      const c0 = ct[i], c1 = ct[i + 1];
      const h = firstRev(c0) ^ kH;
      const l = REV_MB.get(c1);
      if (l === undefined) throw new Error(JSON.stringify(c1) + " 无低字节映射");
      const cp = (h << 8) | (l ^ kL);
      out.push(String.fromCodePoint(cp));
    }
    return out.join("");
  }
 // 单字节模式
  const body = cipher.replace(/=+$/, "");
  const ct = Array.from(body);
  const out = [];
  for (const ch of ct) {
    out.push(String.fromCodePoint(REV_SB.get(ch) ^ kL));
  }
  return out.join("");
}

// ============ music（音乐符号，完全异构） ============
const SYMBOLS = ["‖", "♭", "♯", "§", "∮", "♪", "♩", "♫", "♬", "¶"];
const S2D = new Map(SYMBOLS.map((s, i) => [s, i]));
const D2S = SYMBOLS;

// 预生成 ASCII 解码表（无 key 时 cp=32..126）
const ASCII_DECODE = new Map();
for (let cp = 32; cp < 127; cp++) {
  const val = cp ^ XOR_BASE;
  const g = D2S[Math.floor(val / 100)] + D2S[Math.floor(val / 10) % 10] + D2S[val % 10];
  ASCII_DECODE.set(g, String.fromCodePoint(cp));
}

function val3(g) {
  return S2D.get(g[0]) * 100 + S2D.get(g[1]) * 10 + S2D.get(g[2]);
}

function sym3(val) {
  if (val < 0 || val > 999) throw new Error("val must be 0-999, got " + val);
  return D2S[Math.floor(val / 100)] + D2S[Math.floor(val / 10) % 10] + D2S[val % 10];
}

function musicEncode(text, key) {
  if (!text) return "";
  const ek = deriveKey(key);
  const enc = Array.from(text).map(c => c.codePointAt(0) ^ XOR_BASE ^ ek);
  const hasWide = enc.some(v => Math.floor(v / 100) >= 100);
  if (hasWide) {
    const body = [];
    for (const v of enc) {
      if (Math.floor(v / 100) < 100) {
        body.push(sym3(v));
      } else {
        const g1v = (v % 100) * 10 + 5;
        body.push((sym3(Math.floor(v / 100)) + sym3(g1v)).slice(0, 5));
      }
    }
    return body.join("") + "♪==";
  }
  const allShort = enc.every(v => Math.floor(v / 100) === 0);
  if (allShort) {
    return enc.map(v => sym3(v).slice(1)).join("") + "♯=";
  }
  return enc.map(v => sym3(v)).join("") + "§=";
}

function musicDecode(text, key) {
  if (!text) return "";
  const ek = deriveKey(key);
  let hasKey = key !== undefined && key !== null && key !== "";
  let isShort = false, isWide = false;
  if (text.endsWith("§==")) { text = text.slice(0, -3); hasKey = true; }
  else if (text.endsWith("§=")) { text = text.slice(0, -2); }
  else if (text.endsWith("♯=")) { text = text.slice(0, -2); isShort = true; }
  else if (text.endsWith("==")) { text = text.slice(0, -2); isWide = true; }
  if (!text) return "";
  const chars = Array.from(text);
  const n = chars.length;
  const r = [];
  if (isWide) {
    if (n > 0 && chars[n - 1] === "♪") {
      for (let i = 0; i + 5 <= n; i += 5) {
        const g5 = chars.slice(i, i + 5);
        if (g5.length < 5) break;
        const g0 = val3(g5.slice(0, 3));
        const g1pfx = S2D.get(g5[3]) * 10 + S2D.get(g5[4]);
        const cp = (g0 * 100 + g1pfx) ^ ek ^ XOR_BASE;
        r.push((cp >= 32 && cp < 1114112) ? String.fromCodePoint(cp) : "?");
      }
    } else {
      let i = 0;
      while (i < n) {
        if (i + 3 > n) break;
        const g0 = val3(chars.slice(i, i + 3));
        if (g0 < 100) {
          const cp = g0 ^ ek ^ XOR_BASE;
          r.push((cp >= 32 && cp < 127) ? String.fromCodePoint(cp) : (ASCII_DECODE.get(chars.slice(i, i + 3).join("")) || "?"));
          i += 3;
        } else {
          if (i + 5 > n) break;
          const encC = g0 * 100 + S2D.get(chars[i + 3]) * 10 + S2D.get(chars[i + 4]);
          const cp = encC ^ ek ^ XOR_BASE;
          r.push((cp >= 32 && cp < 1114112) ? String.fromCodePoint(cp) : "?");
          i += 5;
        }
      }
    }
  } else if (isShort) {
    for (let i = 0; i + 2 <= n; i += 2) {
      const g = ["‖", chars[i], chars[i + 1]];
      const gStr = g.join("");
      if (hasKey) {
        const cp = val3(g) ^ ek ^ XOR_BASE;
        r.push((cp >= 32 && cp < 127) ? String.fromCodePoint(cp) : (ASCII_DECODE.get(gStr) || "?"));
      } else {
        r.push(ASCII_DECODE.get(gStr) || "?");
      }
    }
  } else {
    for (let i = 0; i + 3 <= n; i += 3) {
      const g = chars.slice(i, i + 3);
      const gStr = g.join("");
      if (hasKey) {
        const cp = val3(g) ^ ek ^ XOR_BASE;
        r.push((cp >= 32 && cp < 127) ? String.fromCodePoint(cp) : (ASCII_DECODE.get(gStr) || "?"));
      } else {
        r.push(ASCII_DECODE.get(gStr) || "?");
      }
    }
  }
  return r.join("");
}

// ============ detect 函数 ============

function detectBraille(text) {
  if (!text || typeof text !== "string") return 0;
 // 盲文区段 U+2800-U+28FF（BRAILLE_BASE=10240=0x2800）
  const body = text.endsWith("==") ? text.slice(0, -2) : text.endsWith("=") ? text.slice(0, -1) : text;
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) {
    const cp = c.codePointAt(0);
    if (cp >= 10240 && cp <= 10303) hit++;
  }
  const ratio = hit / chars.length;
  if (ratio === 1) {
    if (text.endsWith("==") || text.endsWith("=")) return 0.5;
    if (chars.length >= 4) return 0.3;
  }
  return 0;
}

function detectChinese(text) {
  if (!text || typeof text !== "string") return 0;
 // chinese 密文全是汉字 + = 后缀，但汉字太常见，必须有后缀且字符全在表内才给置信度
  if (!text.endsWith("=") && !text.endsWith("==") && !text.endsWith("===")) return 0;
  const body = text.replace(/=+$/, "");
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) {
    if (REV_SB.has(c) || REV_MB.has(c) || REV_MT.has(c) || REV_FIRST_EX.has(c)) hit++;
  }
  const ratio = hit / chars.length;
 // 全表内字符 + 有后缀 → 0.3（汉字表与中文文本重叠降权）
  if (ratio === 1 && chars.length >= 2) return 0.3;
  return 0;
}

function detectMusic(text) {
  if (!text || typeof text !== "string") return 0;
 // music 密文由 _SYMBOLS 10 项 + 后缀 ♯=/§=/♪==/§== 组成
  const symSet = new Set(SYMBOLS);
  const s2 = text.endsWith("§==") || text.endsWith("♪==");
  const s1 = text.endsWith("♯=") || text.endsWith("§=");
  if (!s2 && !s1) return 0;
  const body = s2 ? text.slice(0, -3) : text.slice(0, -2);
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) if (symSet.has(c)) hit++;
  const ratio = hit / chars.length;
  if (ratio === 1 && chars.length >= 3) return 0.45;
  return 0;
}

// ============ 3 个 op 注册 ============

register({
  id: "qqxiuzi_braille",
  cat: "fancy",
  name: "QQ秀·盲文",
  desc: "QQ秀盲文密码（1 字符/字节 + |128 宽字符处理）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => brailleEncode(t, (p && p.key) || ""),
  decode: (t, p) => brailleDecode(t, (p && p.key) || ""),
  detect: detectBraille,
});

register({
  id: "qqxiuzi_chinese",
  cat: "fancy",
  name: "QQ秀·汉字",
  desc: "QQ秀汉字密码（三表 SB/MB/MT + 三后缀 =/==/===）",
  params: [{ key: "key", label: "密钥（任意文本，可空）", type: "text", default: "0", placeholder: "如 1" }],
  encode: (t, p) => chineseEncode(t, (p && p.key) || "0"),
  decode: (t, p) => chineseDecode(t, (p && p.key) || "0"),
  detect: detectChinese,
});

register({
  id: "qqxiuzi_music",
  cat: "fancy",
  name: "QQ秀·音乐",
  desc: "QQ秀音乐密码（十进制 3 字符 + 10 项符号表 + 三种前缀后缀）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => musicEncode(t, (p && p.key) || ""),
  decode: (t, p) => musicDecode(t, (p && p.key) || ""),
  detect: detectMusic,
});
