/*
 * hashCrack.js — 哈希爆破 / 彩虹表组（T56，cat:'analysis'，单向 run）。
 *。
 *
 * 覆盖：
 * - hashTypeIdentify 哈希类型识别器（长度 + 字符集 + 前缀 → 候选算法
 * 含 MD5/SHA1/SHA256/NTLM/bcrypt/MySQL/crypt 家族）
 * - hashDictCrack 字典爆破（MD5/SHA1/SHA256/NTLM 对 top 弱口令 + 纯数字 + 日期）
 * - rainbowQuery 彩虹表查询（本地预计算小字典，MD5/NTLM 预建表，SHA 系实时查）
 * - hmacKeyBrute HMAC 密钥爆破（给定消息 + HMAC 值，穷举密钥字典）
 *
 * 红线：
 * - 只新建本文件，不碰任何现有 core/*.js。
 * - 哈希计算复用 hash.js 的纯函数（import md5/ntlm/sha/hmac，不碰原文件）。
 * - 内置字典小（约 300 条 top 弱口令，非 rockyou 全量）；大字典需用户导入。
 * - 爆破类用 run 单向（输入哈希，输出明文或未命中）。
 * - 算法层纯函数零 UI 依赖；UI 接 workerPool 并行化由主开发接入（本卡只实现算法层）。
 * - 注册契约：register({id, cat:"analysis", name, desc, params, run})。
 * - 零外发：全部本地纯 JS 计算。
 *
 * 契约：单向 run(text, params) 返回报告文本（命中明文或未命中说明）。
 * 爆破范围防爆：numeric 默认 maxDigits=6（百万级，MD5 同步约 0.5s），上限 8（需 workerPool）。
 */
import { register } from "./registry.js";
import { md5, ntlm, sha, hmac } from "./hash.js";

// ============================================================
// 内置小字典（top 弱口令，约 300 条精选）
// 来源：常见弱密码榜单 + CTF 高频口令。非 rockyou 全量。
// 大字典（rockyou 等）需用户导入，本表只覆盖最高频弱口令。
// ============================================================
const TOP_DICT = [
 // ---- 数字类 ----
  "123456", "123456789", "12345678", "1234567890", "1234567", "12345", "1234", "123",
  "000000", "111111", "222222", "333333", "444444", "555555", "666666", "777777",
  "888888", "999999", "0123456789", "987654321", "87654321", "654321", "112233",
  "123123", "121212", "131313", "141414", "321321", "111222", "00000", "11111",
  "22222", "33333", "1q2w3e", "1q2w3e4r", "1qaz2wsx", "qaz123", "qwe123", "abc123",
 // ---- 常见单词 ----
  "password", "password1", "password123", "passw0rd", "passwd", "pass", "pass123",
  "admin", "admin123", "administrator", "admin888", "admin@123", "root", "toor",
  "test", "test123", "guest", "guest123", "user", "user123", "login", "super",
  "welcome", "welcome1", "letmein", "letmein123", "qwerty", "qwerty123", "qazwsx",
  "hello", "hello123", "monkey", "dragon", "master", "shadow", "superman", "batman",
  "trustno1", "iloveyou", "sunshine", "princess", "football", "baseball", "soccer",
  "hockey", "charlie", "donald", "michael", "jordan", "harley", "ranger", "thomas",
  "robert", "daniel", "andrew", "joshua", "jennifer", "nicole", "jessica", "pepper",
  "whatever", "freedom", "computer", "internet", "minecraft", "starwars", "pokemon",
  "digital", "matrix", "secret", "agent", "change", "default", "access", "oracle",
 // ---- CTF / 安全高频 ----
  "flag", "ctf", "hack", "hacker", "hacked", "pwn", "pwned", "shell", "shel",
  "exploit", "overflow", "buffer", "stack", "heap", "payload", "reverse", "crypto",
  "cipher", "decode", "encode", "token", "key", "keys", "admin1", "root123",
  "toor123", "test1234", "qwerty1", "abc", "abcdef", "abcdefg", "abc1234",
 // ---- 键盘序列 ----
  "qwertyuiop", "asdfghjkl", "zxcvbnm", "asdfasdf", "qwerqwer", "qweasd",
  "1q2w3e4r5t", "zaq12wsx", "p@ssw0rd", "P@ssw0rd", "P@ssword1", "passw0rd!",
 // ---- 中文拼音 / 常见 ----
  "woaini", "5201314", "521521", "520520", "5211314", "aini", "iloveu",
  "wangwang", "mima", "mima123", "woshiniba", "nihao", "nihao123",
 // ---- 带符号 / 变体 ----
  "password!", "admin!", "root!", "123!@#", "!@#$%", "pass@word", "admin@123",
  "Pa$$w0rd", "Password1", "Password123", "Welcome1", "Welcome123",
  "Admin123", "Admin@123", "Root123", "Test123", "Guest123",
 // ---- 短口令 ----
  "a", "1", "12", "abc", "aaa", "aaa111", "abc1", "qwe", "qaz", "zxc",
  "aa", "ab", "11", "01", "00", "999", "666", "888", "168", "520",
 // ---- 其他常见 ----
  "michael1", "robert1", "daniel1", "ashley", "buster", "george", "harley1",
  "jordan23", "jennifer1", "jonathan", "joshua1", "love", "maggie", "mango",
  "marshall", "matthew", "mercedes", "michael2", "michelle", "miller", "nathan",
  "nascar", "nicholas", "oliver", "orange", "peanut", "picture", "purple",
  "samantha", "scooter", "silver", "skippy", "slipknot", "snoopy", "sparky",
  "spring", "steelers", "sugar", "summer", "taylor", "tiger", "tigger",
  "trustno", "victor", "viking", "walter", "warrior", "william", "winston",
  "wizard", "xavier", "yellow", "zxcvbn", "zzzzzz", "zxcvbnm1",
];

// 去重（保持顺序）
const _seen = new Set();
const TOP_DICT_DEDUP = [];
for (const w of TOP_DICT) {
  if (!_seen.has(w)) { _seen.add(w); TOP_DICT_DEDUP.push(w); }
}

// ============================================================
// 哈希计算统一接口（复用 hash.js 纯函数）
// md5 / ntlm 同步纯 JS；sha / hmac 异步走 WebCrypto
// ============================================================
function calcHashSync(algo, text) {
  if (algo === "md5") return md5(text);
  if (algo === "ntlm") return ntlm(text).toLowerCase();
  return null; // sha 系需异步
}
async function calcHashAsync(algo, text) {
  if (algo === "md5") return md5(text);
  if (algo === "ntlm") return ntlm(text).toLowerCase();
  if (algo === "sha1") return await sha("SHA-1", text);
  if (algo === "sha256") return await sha("SHA-256", text);
  throw new Error("不支持的哈希算法: " + algo);
}

// ============================================================
// 候选口令生成器
// ============================================================
// 数字爆破：0 .. 10^maxDigits - 1
function* numericGen(maxDigits) {
  const limit = Math.pow(10, maxDigits);
  for (let n = 0; n < limit; n++) yield String(n);
}

// 日期爆破：常见日期格式（生日 / 弱口令常用日期）
// 格式：YYYYMMDD / YYYY-MM-DD / DDMMYYYY / MMDDYYYY
function* dateGen(yearStart, yearEnd) {
  for (let y = yearStart; y <= yearEnd; y++) {
    for (let m = 1; m <= 12; m++) {
      for (let d = 1; d <= 31; d++) {
        const ys = String(y);
        const ms = String(m).padStart(2, "0");
        const ds = String(d).padStart(2, "0");
        yield ys + ms + ds;          // 20200101
        yield ys + "-" + ms + "-" + ds; // 2020-01-01
        yield ds + ms + ys;          // 01012020
        yield ms + ds + ys;          // 01012020 (MMDDYYYY)
      }
    }
  }
}

// 串联多个可迭代对象
function* chain(...iters) {
  for (const it of iters) yield* it;
}

// 按字典名返回候选可迭代对象
function getDictIterable(name, maxDigits) {
  switch (name) {
    case "top1000": return TOP_DICT_DEDUP;
    case "numeric": return numericGen(maxDigits);
    case "date": return dateGen(1970, 2030);
    case "all": return chain(TOP_DICT_DEDUP, numericGen(maxDigits), dateGen(1970, 2030));
    default: return TOP_DICT_DEDUP;
  }
}

// ============================================================
// 哈希类型识别器（按长度 + 字符集 + 前缀判算法）
// 比 analysis.js 的 analyseHash 增强：支持 bcrypt/MySQL/crypt 前缀检测
// ============================================================
function hashTypeIdentify(text) {
  const s = text.trim();
  if (!s) return "（空输入）";
  const lines = [];
  lines.push(`输入: ${s}`);
  lines.push(`长度: ${s.length} 字符`);
  lines.push("");

  const lower = s.toLowerCase();
  let hit = false;

 // ---- 1. 前缀检测（crypt 家族 / bcrypt / MySQL / LDAP） ----
  if (/^\$2[aby]\$/.test(s)) {
    hit = true;
    lines.push("✓ bcrypt（前缀 $2a/$2b/$2y）");
    lines.push(`  标准长度 60 字符（当前 ${s.length}）`);
    lines.push("  结构: $2b$<cost>$<22 字节 salt><31 字节 hash>（Base64 变体）");
    lines.push("  说明: 慢哈希，不可字典爆破，需 bcrypt 专用工具（如 hashcat -m 3200）");
  }
  if (/^\$argon2(id|i|d)\$/.test(s)) {
    hit = true;
    lines.push("✓ Argon2（前缀 $argon2id$/$argon2i$/$argon2d$）");
    lines.push("  说明: 现代慢哈希，抗 GPU/ASIC，不可字典爆破");
  }
  if (/^\$1\$[!-~]{1,16}\$[!-~]{22}$/.test(s)) {
    hit = true;
    lines.push("✓ MD5 crypt（前缀 $1$，Linux /etc/shadow 常见）");
    lines.push("  结构: $1$<salt>$<hash>，hash 为 22 字节 Base64");
  }
  if (/^\$5\$/.test(s)) {
    hit = true;
    lines.push("✓ SHA-256 crypt（前缀 $5$，Linux /etc/shadow）");
  }
  if (/^\$6\$/.test(s)) {
    hit = true;
    lines.push("✓ SHA-512 crypt（前缀 $6$，Linux /etc/shadow 默认）");
  }
  if (/^\$apr1\$/.test(s)) {
    hit = true;
    lines.push("✓ APR1 / Apache MD5（前缀 $apr1$，htpasswd 用）");
  }
  if (/^\{SSHA\}/i.test(s)) {
    hit = true;
    lines.push("✓ SSHA（LDAP，{SSHA} + Base64(SHA-1(salt+pass)+salt)）");
  }
  if (/^\{SHA\}/i.test(s)) {
    hit = true;
    lines.push("✓ SHA-1 Base64（LDAP，{SHA} + Base64(SHA-1(pass))）");
  }
  if (/^\{MD5\}/i.test(s)) {
    hit = true;
    lines.push("✓ MD5 Base64（LDAP，{MD5} + Base64(MD5(pass))）");
  }
 // MySQL：* + 40 hex
  if (/^\*[0-9a-fA-F]{40}$/.test(s)) {
    hit = true;
    lines.push("✓ MySQL5 / MySQL 4.1 密码哈希（* + 40 hex = SHA1(SHA1(pass))）");
    lines.push("  说明: 41 字符总长，首字符 *，后 40 位为双重 SHA-1");
  }
 // PBKDF2
  if (/^\$pbkdf2-/.test(s)) {
    hit = true;
    lines.push("✓ PBKDF2（前缀 $pbkdf2-<algo>$）");
  }

 // ---- 2. 纯 hex 长度判断 ----
  const isHex = /^[0-9a-fA-F]+$/.test(s);
  if (isHex) {
    const len = s.length;
    const hexMap = {
      16: ["MySQL323（旧版 MySQL 密码，64 位）", "DES(Unix) 传统密码哈希", "CRC-64"],
      32: ["MD5", "MD4", "NTLM（Windows，MD4 of UTF-16LE）", "LM（旧 Windows）",
           "MD2", "RipeMD-128", "Haval-128", "Tiger-128", "Snefru-128",
           "MD5(WordPress phpass)", "MD5 phpBB3"],
      40: ["SHA-1", "SHA-0", "RipeMD-160", "Haval-160", "Tiger-160", "HAS-160",
           "MySQL5（无 * 前缀时）", "SHA-1 iX7"],
      56: ["SHA-224", "SHA3-224", "BLAKE2s-224", "Keccak-224", "Skein-256/224"],
      64: ["SHA-256", "SHA3-256", "BLAKE2b-256", "BLAKE2s-256", "Keccak-256",
           "GOST", "SM3（国密）", "Skein-256/256", "RipeMD-256"],
      96: ["SHA-384", "SHA3-384", "Keccak-384", "Skein-1024/384"],
      128: ["SHA-512", "SHA3-512", "Keccak-512", "BLAKE2b-512",
            "Skein-1024/512", "Whirlpool"],
    };
    const cands = hexMap[len];
    if (cands) {
      hit = true;
      lines.push(`✓ ${len} hex 字符 = ${len * 4} 位，可能算法:`);
      for (const c of cands) lines.push(`    - ${c}`);
 // 特别提示
      if (len === 32) {
        lines.push("  ★ 32 位无法仅凭长度区分 MD5 与 NTLM，需结合上下文（Windows 密码→NTLM，Web/通用→MD5）");
      }
      if (len === 64) {
        lines.push("  ★ 64 位含 SM3（国密），国内 CTF 常见");
      }
    }
  }

 // ---- 3. Base64 编码的哈希（无前缀） ----
  const isB64 = /^[A-Za-z0-9+/]+={0,2}$/.test(s);
  if (isB64 && !hit) {
 // 尝试解码看长度
    try {
      const raw = atob(s);
      const byteLen = raw.length;
      const b64Map = {
        16: ["MD5 Base64 / NTLM Base64（128 位）"],
        20: ["SHA-1 Base64（160 位）"],
        28: ["SHA-224 Base64"],
        32: ["SHA-256 Base64 / SM3 Base64（256 位）"],
        48: ["SHA-384 Base64"],
        64: ["SHA-512 Base64"],
      };
      if (b64Map[byteLen]) {
        hit = true;
        lines.push(`✓ 疑似 Base64 编码哈希（解码后 ${byteLen} 字节 = ${byteLen * 8} 位）:`);
        for (const c of b64Map[byteLen]) lines.push(`    - ${c}`);
      }
    } catch { /* 非 Base64，忽略 */ }
  }

 // ---- 4. NTLM 历史格式（user:hash） ----
  if (/^[!-~]+:[0-9a-fA-F]{32}$/.test(s)) {
    hit = true;
    lines.push("✓ 含用户名:NTLM 哈希对（user:32hex）");
  }

  if (!hit) {
    lines.push("✗ 未匹配常见哈希格式");
    lines.push("  支持: 16/32/40/56/64/96/128 hex、bcrypt、MySQL5(*)、");
    lines.push("        crypt 家族($1/$5/$6/$apr1$)、LDAP({SSHA}/{SHA}/{MD5})、Argon2、PBKDF2");
  }

  lines.push("");
  lines.push("提示: 字典爆破见 hashDictCrack，彩虹表查询见 rainbowQuery");
  return lines.join("\n");
}

// ============================================================
// 字典爆破（MD5/SHA1/SHA256/NTLM × top1000/numeric/date）
// ============================================================
async function hashDictCrackRun(hash, p) {
  const target = String(hash || "").trim().toLowerCase();
  if (!target) return "（空输入，请填入待爆破的哈希值）";
  let algo = (p && p.algo) || "auto";
  const dictName = (p && p.dict) || "top1000";
  const maxDigits = Math.max(1, Math.min(8, Number((p && p.maxDigits) || 6)));

 // auto 按长度猜算法
  if (algo === "auto") {
    if (/^[0-9a-f]{32}$/.test(target)) algo = "md5";      // 32 位先试 MD5
    else if (/^[0-9a-f]{40}$/.test(target)) algo = "sha1";
    else if (/^[0-9a-f]{64}$/.test(target)) algo = "sha256";
    else return `无法识别哈希长度（${target.length}），请手动指定算法`;
  }

 // 算法合法性
  if (!["md5", "ntlm", "sha1", "sha256"].includes(algo)) {
    return `不支持的算法: ${algo}（支持 md5/ntlm/sha1/sha256）`;
  }

 // 范围预估
  let estCount = 0;
  if (dictName === "top1000") estCount = TOP_DICT_DEDUP.length;
  else if (dictName === "numeric") estCount = Math.pow(10, maxDigits);
  else if (dictName === "date") estCount = 61 * 12 * 31 * 4;
  else if (dictName === "all") estCount = TOP_DICT_DEDUP.length + Math.pow(10, maxDigits) + 61 * 12 * 31 * 4;

  const candidates = getDictIterable(dictName, maxDigits);

 // 同步算法快速路径（md5 / ntlm 纯 JS，无 Promise 开销）
  if (algo === "md5" || algo === "ntlm") {
    let tried = 0;
    for (const pt of candidates) {
      tried++;
      const h = calcHashSync(algo, pt);
      if (h === target) {
        return `命中 ✓\n算法: ${algo}\n字典: ${dictName}\n明文: ${pt}\n尝试: ${tried} 次`;
      }
    }
    return `未命中 ✗\n算法: ${algo}\n字典: ${dictName}\n尝试: ${tried} 次\n建议: 换字典 / 增大 numeric 位数 / 导入大字典`;
  }

 // 异步算法（sha1 / sha256 走 WebCrypto）
  let tried = 0;
  for (const pt of candidates) {
    tried++;
    const h = await calcHashAsync(algo, pt);
    if (h === target) {
      return `命中 ✓\n算法: ${algo}\n字典: ${dictName}\n明文: ${pt}\n尝试: ${tried} 次`;
    }
 // SHA 系大范围防爆：超过 200 万次中断
    if (tried >= 2000000) {
      return `中止: 尝试次数超 200 万上限（已试 ${tried}）\n算法: ${algo}\n字典: ${dictName}\n建议: 缩小范围或走 workerPool 并行`;
    }
  }
  return `未命中 ✗\n算法: ${algo}\n字典: ${dictName}\n尝试: ${tried} 次\n建议: 换字典 / 增大 numeric 位数 / 导入大字典`;
}

// ============================================================
// 彩虹表查询（本地预计算小字典）
// MD5 / NTLM 模块加载时预建表（同步纯 JS，查询 O(1)）
// SHA 系列走实时字典搜索（无预建表，等同小字典爆破）
// ============================================================
const RAINBOW_MD5 = new Map();   // hash → plaintext
const RAINBOW_NTLM = new Map();
for (const pt of TOP_DICT_DEDUP) {
  RAINBOW_MD5.set(md5(pt), pt);
  RAINBOW_NTLM.set(ntlm(pt).toLowerCase(), pt);
}

async function rainbowQueryRun(hash, p) {
  const target = String(hash || "").trim().toLowerCase();
  if (!target) return "（空输入，请填入待查询的哈希值）";
  let algo = (p && p.algo) || "auto";

 // auto 按长度猜
  if (algo === "auto") {
    if (/^[0-9a-f]{32}$/.test(target)) algo = "md5";
    else if (/^[0-9a-f]{40}$/.test(target)) algo = "sha1";
    else if (/^[0-9a-f]{64}$/.test(target)) algo = "sha256";
    else return `无法识别哈希长度（${target.length}），请手动指定算法`;
  }

 // MD5 预建表查询
  if (algo === "md5") {
    if (RAINBOW_MD5.has(target)) {
      return `命中 ✓（MD5 彩虹表）\n明文: ${RAINBOW_MD5.get(target)}`;
    }
 // 32 位也试 NTLM 表
    if (RAINBOW_NTLM.has(target)) {
      return `命中 ✓（NTLM 彩虹表，32 位与 MD5 同长）\n明文: ${RAINBOW_NTLM.get(target)}`;
    }
    return `未命中 ✗（MD5/NTLM 彩虹表 ${TOP_DICT_DEDUP.length} 条无记录）\n建议: 用 hashDictCrack 跑完整字典或 numeric/date 爆破`;
  }

 // NTLM 预建表查询
  if (algo === "ntlm") {
    if (RAINBOW_NTLM.has(target)) {
      return `命中 ✓（NTLM 彩虹表）\n明文: ${RAINBOW_NTLM.get(target)}`;
    }
    return `未命中 ✗（NTLM 彩虹表 ${TOP_DICT_DEDUP.length} 条无记录）`;
  }

 // SHA 系列：实时查表（无预建表，因 WebCrypto 异步不便预建）
  if (algo === "sha1" || algo === "sha256") {
    for (const pt of TOP_DICT_DEDUP) {
      const h = await calcHashAsync(algo, pt);
      if (h === target) {
        return `命中 ✓（${algo} 实时查表）\n明文: ${pt}`;
      }
    }
    return `未命中 ✗（${algo} 字典 ${TOP_DICT_DEDUP.length} 条无记录）`;
  }

  return `不支持的算法: ${algo}（支持 auto/md5/ntlm/sha1/sha256）`;
}

// ============================================================
// HMAC 密钥爆破（给定消息 + HMAC 值，穷举密钥字典）
// 输入: HMAC 哈希值；参数: 消息 + 算法 + 字典
// ============================================================
async function hmacKeyBruteRun(hmacHash, p) {
  const target = String(hmacHash || "").trim().toLowerCase();
  if (!target) return "（空输入，请填入待爆破的 HMAC 值）";
  const algo = (p && p.algo) || "SHA-256";
  const message = (p && p.message != null) ? String(p.message) : "";
  const dictName = (p && p.dict) || "top1000";
  const maxDigits = Math.max(1, Math.min(8, Number((p && p.maxDigits) || 6)));

  const validAlgos = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
  if (!validAlgos.includes(algo)) {
    return `不支持的算法: ${algo}（支持 ${validAlgos.join("/")}）`;
  }

  if (message === "") {
    return "请填入被 HMAC 的消息（message 参数），否则无法验证密钥";
  }

  const candidates = getDictIterable(dictName, maxDigits);
  let tried = 0;
  for (const key of candidates) {
    tried++;
    const h = await hmac(algo, key, message);
    if (h === target) {
      return `命中 ✓\n算法: HMAC-${algo}\n字典: ${dictName}\n消息: ${message}\n密钥: ${key}\n尝试: ${tried} 次`;
    }
    if (tried >= 2000000) {
      return `中止: 尝试次数超 200 万上限（已试 ${tried}）\n建议: 缩小范围或走 workerPool 并行`;
    }
  }
  return `未命中 ✗\n算法: HMAC-${algo}\n字典: ${dictName}\n消息: ${message}\n尝试: ${tried} 次\n建议: 换字典 / 增大 numeric 位数 / 导入大字典`;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "hashTypeIdentify",
  cat: "crypto",
  name: "哈希类型识别",
  desc: "按长度+字符集+前缀识别哈希算法（MD5/SHA1/SHA256/NTLM/bcrypt/MySQL/crypt/Argon2/LDAP 等）",
  params: [],
  run: hashTypeIdentify,
});

register({
  id: "hashDictCrack",
  cat: "crypto",
  name: "哈希字典爆破",
  desc: "MD5/SHA1/SHA256/NTLM 字典爆破（top 弱口令 + 纯数字 + 日期，大字典需用户导入）",
  params: [
    { key: "algo", label: "算法", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（按长度猜）" },
      { value: "md5", label: "MD5" },
      { value: "sha1", label: "SHA-1" },
      { value: "sha256", label: "SHA-256" },
      { value: "ntlm", label: "NTLM" },
    ] },
    { key: "dict", label: "字典", type: "select", default: "top1000", options: [
      { value: "top1000", label: "top 弱口令（约 300 条）" },
      { value: "numeric", label: "纯数字（0-10^N）" },
      { value: "date", label: "日期（1970-2030）" },
      { value: "all", label: "全部（口令+数字+日期）" },
    ] },
    { key: "maxDigits", label: "数字最大位数", type: "number", default: 6, placeholder: "1-8（越大越慢）" },
  ],
  run: hashDictCrackRun,
});

register({
  id: "rainbowQuery",
  cat: "crypto",
  name: "彩虹表查询",
  desc: "本地预计算彩虹表查询（MD5/NTLM 预建表 O(1)，SHA 系实时查表，约 300 条小字典）",
  params: [
    { key: "algo", label: "算法", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（按长度猜）" },
      { value: "md5", label: "MD5" },
      { value: "ntlm", label: "NTLM" },
      { value: "sha1", label: "SHA-1" },
      { value: "sha256", label: "SHA-256" },
    ] },
  ],
  run: rainbowQueryRun,
});

register({
  id: "hmacKeyBrute",
  cat: "crypto",
  name: "HMAC 密钥爆破",
  desc: "给定消息 + HMAC 值，穷举密钥字典（top 口令 + 纯数字，爆破 HMAC-SHA1/256/384/512 密钥）",
  params: [
    { key: "algo", label: "算法", type: "select", default: "SHA-256", options: [
      { value: "SHA-1", label: "HMAC-SHA-1" },
      { value: "SHA-256", label: "HMAC-SHA-256" },
      { value: "SHA-384", label: "HMAC-SHA-384" },
      { value: "SHA-512", label: "HMAC-SHA-512" },
    ] },
    { key: "message", label: "被签消息", type: "text", default: "", placeholder: "HMAC 的消息内容" },
    { key: "dict", label: "密钥字典", type: "select", default: "top1000", options: [
      { value: "top1000", label: "top 弱口令（约 300 条）" },
      { value: "numeric", label: "纯数字（0-10^N）" },
    ] },
    { key: "maxDigits", label: "数字最大位数", type: "number", default: 6, placeholder: "1-8" },
  ],
  run: hmacKeyBruteRun,
});

export {
  hashTypeIdentify,
  hashDictCrackRun,
  rainbowQueryRun,
  hmacKeyBruteRun,
  TOP_DICT_DEDUP as TOP_DICT,
  RAINBOW_MD5,
  RAINBOW_NTLM,
  calcHashSync,
  calcHashAsync,
  numericGen,
  dateGen,
};
