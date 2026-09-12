/*
 * candidate_qqxiuzi_misc_T500.js — 千千秀字异构 3 op 修复候选（braille/chinese/music）。
 *
 * T500 候选 = T441 拒绝型候选基线 + T500 原版契约对齐（Wayback 快照证据）：
 *   1. T441 基线行为全部保留：
 *      - braille 无 key hi≥128（码点 ≥U+8000）显式拒绝（现用实测 B2：U+8000→U+0000 静默错值，
 *        常用逗号 U+FF0C→U+7F0C；参考移植同断）；带 key 高部上限 4351 与参考一致无损。
 *      - chinese SB/MT 空槽显式报错（现用实测 B3/B3b：𤬃 抛错、无 key 含「。」直接抛错）；
 *        decode 表外/截断显式报错（现用 C3：表外→"\0"）。
 *      - music 值域预检（现用实测 B4：𤬃 裸异常 "val must be 0-999, got 1503"）；
 *        decode 尾组不足显式报错（现用 C4：静默 break）。
 *      - BMP 密文零变化（原站向量逐字过）。
 *   2. T500 增量·原版密码契约（快照证据「密码可以是数字、字母和下划线，最多九位」）：
 *      现用实现 braille/music 非法字符密码静默降级无密钥且走有 key 格式（实测 D3/D4，安全风险），
 *      10 位密码静默接受（D1）。候选统一 checkKeyContract：>9 位或非法字符集显式报错。
 *      chinese 的 key 同样纳入契约（原版各 style 共用同一 key 输入框与约束）。
 *   3. 错误消息规范：U+XXXX 大写、中文可读、统一「千千秀字·X」前缀（现用小写 hex 且裸英文异常）。
 *   4. 主名/desc 对齐 T459 现用产品（千千秀字·盲文/汉字/音乐）。
 *
 * 行为变化清单（相对现用 src/core/qqxiuzi_misc.js，交 M 裁决）：
 *   - 密码 >9 位 / 非法字符集 → 报错（原：静默接受 / 静默降级无密钥）
 *   - braille 无 key encode 码点 ≥U+8000 → 报错（原：静默错值，如 ，→缌）
 *   - chinese/music decode 表外/截断 → 报错（原：静默 \0 / "?" / 丢尾组）
 *   - BMP + 合法密码全部输入：密文逐字节不变
 *
 * 单向依赖：仅 import registry.js。
 */
import { register } from "./registry.js";

// ============ 共享常量与密码契约 ============
const BRAILLE_BASE = 10240;
const XOR_BASE = 48;
const KEY_RE = /^[0-9A-Za-z_]+$/;

// 原版密码契约（T500，2015/2018/2020/2023/2026 快照一致）：
// 「密码可以是数字、字母和下划线，最多九位」，前端 key.length>9 报「错误：密码最多九位！」
function checkKeyContract(pwd) {
  if (pwd === undefined || pwd === null || pwd === "") return null;
  if (pwd.length > 9) {
    throw new Error("千千秀字：密码最多九位（原版工具页约束），当前 " + pwd.length + " 位");
  }
  if (!KEY_RE.test(pwd)) {
    throw new Error("千千秀字：密码只能包含数字、字母和下划线（原版工具页约束），当前含非法字符");
  }
  return null;
}

function deriveKey(pwd) {
  if (!pwd) return 0;
  checkKeyContract(pwd); // T500：非法字符不再静默返回 0（原为无密钥语义，安全风险）
  let s = 0;
  for (const c of pwd) s += c.codePointAt(0);
  return s ^ XOR_BASE;
}

// ============ braille（盲文，近亲变种） ============

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
      // 无 key 2 字符模式 hi|128 做续接标记、解码 hi&127 还原；hi≥128（码点 ≥U+8000 附近）
      // 时 bit7 被静默砍掉（现用实测 B2），参考移植同断。显式拒绝而非静默错值。
      const hiRaw = Math.floor(v / 256);
      if (hiRaw >= 128) {
        throw new Error(
          "千千秀字·盲文：无密钥模式下码点 U+" + (v ^ XOR_BASE).toString(16).toUpperCase() +
          " 的高字节 " + hiRaw + " 与续接标记位（|128）冲突，原版标记方案无法无损表示（现用实测静默错值，参考实现同断），已拒绝编码"
        );
      }
      const hi = hiRaw | 128, lo = v % 256;
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
    if (n % step !== 0) {
      throw new Error("千千秀字·盲文：密文长度不合法（去后缀后 " + n + " 个符号，非 " + step + " 的倍数），疑似截断或非本格式密文");
    }
    for (let i = 0; i < n; i += step) {
      const b1 = chars[i].codePointAt(0) - BRAILLE_BASE;
      // 带 key 2 字符模式高部上限 4351（=0x10FFFF>>8，覆盖增补平面，与参考移植互通）；
      // 1 字符模式与无 key 模式高部 ≤255（盲文区段 U+2800-U+28FF）
      const b1Max = step === 2 ? 4351 : 255;
      if (b1 < 0 || b1 > b1Max) {
        throw new Error("千千秀字·盲文：密文含盲文区段外/越界字符 " + JSON.stringify(chars[i]) + "，非本格式或已损坏");
      }
      let enc;
      if (step === 2) {
        const b2 = chars[i + 1].codePointAt(0) - BRAILLE_BASE;
        if (b2 < 0 || b2 > 255) {
          throw new Error("千千秀字·盲文：密文含盲文区段外字符 " + JSON.stringify(chars[i + 1]) + "，非本格式或已损坏");
        }
        enc = b1 * 256 + b2;
      } else {
        enc = b1;
      }
      r += String.fromCodePoint(enc ^ ek ^ XOR_BASE);
    }
  } else {
    let i = 0;
    while (i < n) {
      const b1 = chars[i].codePointAt(0) - BRAILLE_BASE;
      if (b1 < 0 || b1 > 255) {
        throw new Error("千千秀字·盲文：密文含盲文区段外字符 " + JSON.stringify(chars[i]) + "，非本格式或已损坏");
      }
      if (b1 >= 128) {
        if (i + 1 >= n) {
          throw new Error("千千秀字·盲文：密文以续接标记结尾但无后续字节，疑似截断或损坏（现用实现静默丢弃）");
        }
        const b2 = chars[i + 1].codePointAt(0) - BRAILLE_BASE;
        if (b2 < 0 || b2 > 255) {
          throw new Error("千千秀字·盲文：密文含盲文区段外字符 " + JSON.stringify(chars[i + 1]) + "，非本格式或已损坏");
        }
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
// SB(256 稀疏：空槽 0、28-31)/MB(256 满)/MT(7 项稀疏) + FIRST_EX(3)
// 表血统：T441 由 zbCrypto 反编译移植提取（内嵌原站实测向量）；原站服务端表完备性 BLOCKED。
const SB = [null,"亵","愀","埸","谲","揼","剃","啺","噤","棹","洇","荏","榍","洇","腚","弼","眵","篙","辈","饫","雯","烛","森","玷","坪","蕞","耽","揅",null,null,null,null,"疆","岌","蟊","娅","蒲","鲷","除","狃","恙","攘","酗","玲","贡","汴","牯","骘","怜","适","虬","皑","缬","正","恫","阒","衷","茂","辁","榧","刿","靓","温","悸","出","霄","笫","磕","渑","毕","柢","闶","捷","洗","稠","亢","葙","我","俐","妆","鹜","零","耜","幢","钠","渤","阴","苜","缠","蚓","蒺","痪","尻","掣","捭","足","眶","奴","舸","节","启","抡","圯","撺","指","枨","豳","懒","这","榻","喵","岁","停","咀","彤","嚼","铤","萋","纾","揪","亮","晕","薨","籍","榆","馑","馁","证","舨","溴","怒","邂","姘","石","逞","逍","闾","旎","碗","株","颀","雍","咕","濯","涞","度","嘧","澉","介","郛","鸠","曳","童","耄","涌","须","洳","栋","扩","锟","轷","稃","翳","笠","璨","厥","坫","址","佐","伴","钼","渔","懊","赶","佛","潘","岳","馊","笺","庄","多","镣","硌","嚎","馓","羰","芄","卫","皮","躇","践","蓉","容","颅","畜","僦","主","鲭","役","跟","床","阚","赠","耖","觅","赏","蕖","间","农","缺","堕","窆","鐾","藿","缈","昔","埂","呒","苁","漆","怆","嗾","猜","菽","晌","鲂","镒","披","謦","镓","胜","恼","鸶","倩","挎","想","祗","瑚","怡","斟","玛","荻","飓","慢","乾","琰","仿","蝉","侬","脍","筵","萄","戛","囔","锓","俳"];
const MB = ["只","酢","励","镔","轼","褪","赋","折","跖","篾","眷","赉","萦","溶","仅","驻","楔","懔","邝","虚","蠡","账","煸","徉","堆","顶","唇","搀","绵","赖","茕","轶","崽","铷","会","焦","凫","锄","荨","桕","步","隽","鞒","拊","锫","攉","哎","峒","燃","煨","啜","敲","旭","郾","腺","薰","舢","分","盲","铍","寐","纷","懦","挞","裾","脾","赀","檎","臆","囵","甑","耪","力","颛","咽","蛹","涵","瓮","胀","溯","瓷","囟","姓","溪","眄","鹎","龈","哨","盖","崦","隙","膈","陔","鬻","癞","线","喊","鹧","嗥","票","娶","玟","瞧","傈","蚯","逖","卞","坜","取","嘁","辋","盎","谴","婀","戈","炅","魔","揆","嫁","翰","末","眨","螃","镆","讯","兮","负","饼","逻","履","尤","棍","笪","莜","隧","筅","挣","酐","皖","锃","牝","蝌","爆","谰","龇","瞿","迂","泞","壅","技","疗","树","他","瘅","璞","笆","黛","羞","爸","学","擂","巯","唛","崃","谭","称","阔","筮","浑","探","辫","吉","酆","如","贤","其","荒","冁","铈","隼","崂","寓","淠","弊","颐","濡","谏","氤","写","跛","椹","咐","萘","锆","虔","舯","毒","漉","认","桧","徙","池","拟","傺","她","翊","戌","璃","船","匙","蝎","庚","绞","蕊","骀","谀","阌","生","跄","赘","魁","盱","氍","枕","瞢","泅","援","艰","薏","彗","甯","悚","脚","瘗","椟","铅","锞","氕","蒇","胨","珑","霸","饪","愍","闳","浍","唬","庠","绷","舁","黉","育","炒","范","盘","睐"];
const MT = {"0":"骊","1":"越","2":"赛","28":"庳","79":"溺","80":"菥","81":"科"};
const FIRST_EX = {"39":"玷","40":"坪","45":"溉"};
const REV_SB = new Map();
SB.forEach((ch, i) => { if (ch !== null) REV_SB.set(ch, i); }); // 注意：'洇' 在 10 与 13 双现，Map 取后者（与参考 _REV_SB enumerate 覆盖序一致）
const REV_MB = new Map();
MB.forEach((ch, i) => { if (ch !== null) REV_MB.set(ch, i); });
const REV_MT = new Map();
for (const [k, v] of Object.entries(MT)) REV_MT.set(v, parseInt(k, 10));
const REV_FIRST_EX = new Map();
for (const [k, v] of Object.entries(FIRST_EX)) REV_FIRST_EX.set(v, parseInt(k, 10));

// chinese key 推导: _key_int(k) = (sum>>8)<<8 | (sum&0xFF)^0x30（T500：先过密码契约校验）
function keyInt(k) {
  if (k === "" || k === undefined || k === null) k = "0";
  checkKeyContract(k);
  let s = 0;
  for (const c of k) s += c.codePointAt(0);
  return ((s >> 8) & 0xFF) << 8 | ((s & 0xFF) ^ 0x30);
}

function firstByte(byte) {
  const x = byte ^ 0x30;
  if (SB[x] !== null && SB[x] !== undefined) return SB[x];
  const ch = FIRST_EX[String(byte)];
  if (ch) return ch;
  throw new Error("千千秀字·汉字：字节 0x" + byte.toString(16).toUpperCase() + " 无法编码（首字节表空槽且无特例映射；现用实测无 key 下『。』即命中此错）");
}

function firstRev(ch) {
  const h = REV_FIRST_EX.get(ch);
  if (h !== undefined) return h;
  const sb = REV_SB.get(ch);
  if (sb === undefined) {
    throw new Error("千千秀字·汉字：密文含首字节表外字符 " + JSON.stringify(ch) + "，非本格式或已损坏");
  }
  return sb ^ 0x30;
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
      const sbIdx = cp ^ kL;
      if (SB[sbIdx] === null || SB[sbIdx] === undefined) {
        throw new Error("千千秀字·汉字：码点 U+" + cp.toString(16).toUpperCase() + " 经密钥异或后命中 SB 表空槽（索引 " + sbIdx + "），原版单字节表不含该值，已拒绝编码");
      }
      out.push(SB[sbIdx]);
    } else if (mode === 1) {
      out.push(firstByte((cp >> 8 & 0xFF) ^ kH));
      out.push(MB[(cp & 0xFF) ^ kL]);
    } else {
      const b0 = (cp >> 16) & 0xFF;
      const b1 = (cp >> 8) & 0xFF;
      const b2 = cp & 0xFF;
      const ch2 = MT[String(b2 ^ kL)];
      // MT 仅 7 项（0/1/2/28/79/80/81），系反编译移植提取的稀疏表；原站完备性 BLOCKED
      if (ch2 === undefined) throw new Error("千千秀字·汉字：码点 U+" + cp.toString(16).toUpperCase() + " 末字节 0x" + b2.toString(16).toUpperCase() + " 无三字节映射（MT 表稀疏，原版完备性不可考）");
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
    if (ct.length % 3 !== 0) {
      throw new Error("千千秀字·汉字：三字节密文长度不合法（" + ct.length + " 个符号，非 3 的倍数），疑似截断或非本格式密文");
    }
    const out = [];
    for (let i = 0; i < ct.length; i += 3) {
      const c0 = ct[i], c1 = ct[i + 1], c2 = ct[i + 2];
      const sbv = REV_SB.get(c0);
      if (sbv === undefined) {
        throw new Error("千千秀字·汉字：密文含首字节表外字符 " + JSON.stringify(c0) + "，非本格式或已损坏");
      }
      const b0 = sbv ^ 0x30;
      const b1 = REV_MB.get(c1);
      const b2 = REV_MT.get(c2);
      if (b1 === undefined) throw new Error("千千秀字·汉字：密文 " + JSON.stringify(c1) + " 无中字节映射，非本格式或已损坏");
      if (b2 === undefined) throw new Error("千千秀字·汉字：密文 " + JSON.stringify(c2) + " 无末字节映射，非本格式或已损坏");
      const cp = (b0 << 16) | ((b1 ^ 0x30) << 8) | (b2 ^ kL);
      out.push(String.fromCodePoint(cp));
    }
    return out.join("");
  }
  if (cipher.endsWith("==")) {
    const ct = Array.from(cipher.slice(0, -2));
    if (ct.length % 2 !== 0) {
      throw new Error("千千秀字·汉字：双字节密文长度不合法（" + ct.length + " 个符号，非 2 的倍数），疑似截断或非本格式密文");
    }
    const out = [];
    for (let i = 0; i < ct.length; i += 2) {
      const c0 = ct[i], c1 = ct[i + 1];
      const h = firstRev(c0) ^ kH;
      const l = REV_MB.get(c1);
      if (l === undefined) throw new Error("千千秀字·汉字：密文 " + JSON.stringify(c1) + " 无低字节映射，非本格式或已损坏");
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
    const sbv = REV_SB.get(ch);
    if (sbv === undefined) {
      throw new Error("千千秀字·汉字：密文含单字节表外字符 " + JSON.stringify(ch) + "，非本格式或已损坏（现用实现此处静默产 \\0）");
    }
    out.push(String.fromCodePoint(sbv ^ kL));
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
  const a = S2D.get(g[0]);
  const b = S2D.get(g[1]);
  const c = S2D.get(g[2]);
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error("千千秀字·音乐：密文含符号表外字符，非本格式或已损坏（现用实现此处静默产 \"?\"）");
  }
  return a * 100 + b * 10 + c;
}

function sym3(val) {
  if (val < 0 || val > 999) throw new Error("千千秀字·音乐：内部值 " + val + " 超出三位组 0-999（已由 encode 预检拦截，此处为防御）");
  return D2S[Math.floor(val / 100)] + D2S[Math.floor(val / 10) % 10] + D2S[val % 10];
}

function musicEncode(text, key) {
  if (!text) return "";
  const ek = deriveKey(key);
  const enc = Array.from(text).map(c => c.codePointAt(0) ^ XOR_BASE ^ ek);
  // 值域预检：三位组（≤999）与宽模式（≥10000）之间的空洞、宽模式 5 位十进制上限（≤99999）
  // 现用实测 B4：𤬃 编码值 150323 → sym3(1503) 裸异常 "val must be 0-999, got 1503"；参考移植同抛 ValueError
  for (const v of enc) {
    if (v > 999 && v < 10000) {
      throw new Error("千千秀字·音乐：编码值 " + v + " 落在标准三位组与宽模式之间的表达空洞（码点约 0x3E8-0x2717 区随密钥浮动），参考实现同样无法表示，已拒绝编码");
    }
    if (v > 99999) {
      const cp = v ^ ek ^ XOR_BASE;
      throw new Error(
        "千千秀字·音乐：码点 U+" + cp.toString(16).toUpperCase() +
        " 超出宽模式 5 位十进制表示上限（编码值 ≤99999，现用实现裸异常，参考移植同抛），原版行为不可考（算法在原站服务端，已下线），已拒绝编码"
      );
    }
  }
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
      if ((n - 1) % 5 !== 0) {
        throw new Error("千千秀字·音乐：宽模式密文长度不合法（剔除 ♪ 后 " + (n - 1) + " 个符号，非 5 的倍数），疑似截断或非本格式密文");
      }
      for (let i = 0; i + 5 <= n; i += 5) {
        const g5 = chars.slice(i, i + 5);
        const g0 = val3(g5.slice(0, 3));
        const s3 = S2D.get(g5[3]);
        const s4 = S2D.get(g5[4]);
        if (s3 === undefined || s4 === undefined) {
          throw new Error("千千秀字·音乐：宽模式密文含符号表外字符，非本格式或已损坏");
        }
        const g1pfx = s3 * 10 + s4;
        const cp = (g0 * 100 + g1pfx) ^ ek ^ XOR_BASE;
        r.push((cp >= 32 && cp < 1114112) ? String.fromCodePoint(cp) : "?");
      }
    } else {
      let i = 0;
      while (i < n) {
        if (i + 3 > n) {
          throw new Error("千千秀字·音乐：宽模式密文尾部不足一组，疑似截断或损坏（现用实现静默丢弃）");
        }
        const g0 = val3(chars.slice(i, i + 3));
        if (g0 < 100) {
          const cp = g0 ^ ek ^ XOR_BASE;
          r.push((cp >= 32 && cp < 127) ? String.fromCodePoint(cp) : (ASCII_DECODE.get(chars.slice(i, i + 3).join("")) || "?"));
          i += 3;
        } else {
          if (i + 5 > n) {
            throw new Error("千千秀字·音乐：宽模式密文尾部不足一组，疑似截断或损坏（现用实现静默丢弃）");
          }
          const s3 = S2D.get(chars[i + 3]);
          const s4 = S2D.get(chars[i + 4]);
          if (s3 === undefined || s4 === undefined) {
            throw new Error("千千秀字·音乐：宽模式密文含符号表外字符，非本格式或已损坏");
          }
          const encC = g0 * 100 + s3 * 10 + s4;
          const cp = encC ^ ek ^ XOR_BASE;
          r.push((cp >= 32 && cp < 1114112) ? String.fromCodePoint(cp) : "?");
          i += 5;
        }
      }
    }
  } else if (isShort) {
    if (n % 2 !== 0) {
      throw new Error("千千秀字·音乐：短模式密文长度不合法（" + n + " 个符号，非 2 的倍数），疑似截断或非本格式密文");
    }
    for (let i = 0; i + 2 <= n; i += 2) {
      const g = ["‖", chars[i], chars[i + 1]];
      const gStr = g.join("");
      // T500：无 key 分支符号表外字符原静默产 "?"（T441 候选遗留缺口），改为显式报错
      if (!S2D.has(chars[i]) || !S2D.has(chars[i + 1])) {
        throw new Error("千千秀字·音乐：短模式密文含符号表外字符，非本格式或已损坏");
      }
      if (hasKey) {
        const cp = val3(g) ^ ek ^ XOR_BASE;
        r.push((cp >= 32 && cp < 127) ? String.fromCodePoint(cp) : (ASCII_DECODE.get(gStr) || "?"));
      } else {
        r.push(ASCII_DECODE.get(gStr) || "?");
      }
    }
  } else {
    if (n % 3 !== 0) {
      throw new Error("千千秀字·音乐：密文长度不合法（去后缀后 " + n + " 个符号，非 3 的倍数），疑似截断或非本格式密文");
    }
    for (let i = 0; i + 3 <= n; i += 3) {
      const g = chars.slice(i, i + 3);
      const gStr = g.join("");
      // T500：无 key 分支符号表外字符原静默产 "?"（T441 候选遗留缺口），改为显式报错
      if (!S2D.has(g[0]) || !S2D.has(g[1]) || !S2D.has(g[2])) {
        throw new Error("千千秀字·音乐：密文含符号表外字符，非本格式或已损坏");
      }
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

// ============ detect 函数（与现用一致，零变化） ============

function detectBraille(text) {
  if (!text || typeof text !== "string") return 0;
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
  if (!text.endsWith("=") && !text.endsWith("==") && !text.endsWith("===")) return 0;
  const body = text.replace(/=+$/, "");
  if (!body) return 0;
  const chars = Array.from(body);
  let hit = 0;
  for (const c of chars) {
    if (REV_SB.has(c) || REV_MB.has(c) || REV_MT.has(c) || REV_FIRST_EX.has(c)) hit++;
  }
  const ratio = hit / chars.length;
  if (ratio === 1 && chars.length >= 2) return 0.3;
  return 0;
}

function detectMusic(text) {
  if (!text || typeof text !== "string") return 0;
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

// ============ 3 个 op 注册（名称/desc 对齐 T459 现用产品） ============

register({
  id: "qqxiuzi_braille", family: "qqxiuzi", familyLabel: "braille",
  cat: "fancy",
  name: "千千秀字·盲文",
  desc: "千千秀字盲文密码（原称「QQ秀盲文」；1 字符/字节 + |128 宽字符处理）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => brailleEncode(t, (p && p.key) || ""),
  decode: (t, p) => brailleDecode(t, (p && p.key) || ""),
  detect: detectBraille,
});

register({
  id: "qqxiuzi_chinese", family: "qqxiuzi", familyLabel: "chinese",
  cat: "fancy",
  name: "千千秀字·汉字",
  desc: "千千秀字汉字密码（原称「QQ秀汉字」；三表 SB/MB/MT + 三后缀 =/==/===）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，默认 0）", type: "text", default: "0", placeholder: "如 1" }],
  encode: (t, p) => chineseEncode(t, (p && p.key) || "0"),
  decode: (t, p) => chineseDecode(t, (p && p.key) || "0"),
  detect: detectChinese,
});

register({
  id: "qqxiuzi_music", family: "qqxiuzi", familyLabel: "music",
  cat: "fancy",
  name: "千千秀字·音乐",
  desc: "千千秀字音乐密码（原称「QQ秀音乐」；十进制 3 字符 + 10 项符号表 + 三种前缀后缀）",
  params: [{ key: "key", label: "密钥（数字/字母/下划线，最多九位，可空）", type: "text", default: "", placeholder: "如 key1" }],
  encode: (t, p) => musicEncode(t, (p && p.key) || ""),
  decode: (t, p) => musicDecode(t, (p && p.key) || ""),
  detect: detectMusic,
});
