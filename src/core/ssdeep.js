/*
 * ssdeep.js — SSDEEP 模糊哈希 / CTPH（context triggered piecewise hashing，cat:'hash'，单向 run）。
 *
 * 解决什么：判断两份数据「相似」而非「相等」——取证比对变种样本、恶意库匹配、
 * 找同源文件。输出签名 blocksize:hash1:hash2（base64 字母表），比对给 0-100 分。
 *
 * 算法（逐行对照 ssdeep 官方 fuzzy.c，GPL，ssdeep-project/ssdeep master，2026-09-22 取）：
 *   - 滚动哈希：Adler 型三态 h1/h2/h3，窗口 7（h1=窗口字节和、h2=加权和、h3=移位异或）；
 *     触发点条件：(roll_sum+1) % (3·2^i) == 0（blocksize i 档触发，i 从 bhstart 起）。
 *   - 块哈希：FNV-1 低 6 位等价闭式 sum_hash(c,h) = ((h*19)&63)^c（初值 0x27 =
 *     0x28021967 mod 64；官方 sum_table 4096 格全等于本闭式，自检锚点核对）。
 *   - 块尺寸自适应：MIN_BLOCKSIZE=3 起 2 的幂；fuzzy_set_total_input_length 定长档
 *     （fuzzy_hash_buf 路径）先估 bhendlimit；引擎按需 fork 下一档 / reduce 弃首档
 *     （rollmask 优化与 horg%3 前置判断均照抄）。
 *   - 收尾：hash1 = digest[dindex) + 尾字符（roll_sum!=0 取当前 h，否则取 digest[dindex]）；
 *     hash2 = digest 截断 31（SPAMSUM_LENGTH/2-1）+ 尾字符（定长档取 halfh/halfdigest）；
 *     小输入无第二档时 hash2 = 单字符（bh[0].h 或 lasth）。默认 flags=0：输出不去重
 *     连三相同字符（eliminate sequences 仅在比对读入时做）——与官方库默认行为一致。
 *   - 比对（fuzzy_compare）：块尺寸须相等或差 2 倍否则 0 分；读入时消除 ≥4 连同字符；
 *     需有长度 7 的公共子串（滚动哈希预筛 + 逐字节确认）才计分；编辑距离
 *     （插 1/删 1/换 2）→ score = 100 - 100*(64*dist/(len1+len2))/64；
 *     blocksize < 45 时封顶 (blocksize/3)*min(len)。畸形签名 → 抛错。
 *
 * 官方向量（python-ssdeep 测试集，由 C 库 libfuzzy 生成；ppdeep README 为纯 Python 独立
 * 实现算例；均 2026-09-22 核对，全文见 ref/SOURCES_A.md）：
 *   hash("Also called fuzzy hashes, Ctph can match inputs that have homologies.")
 *     = "3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C"
 *   hash("Also called fuzzy hashes, CTPH can match inputs that have homologies.")
 *     = "3:AXGBicFlIHBGcL6wCrFQEv:AXGH6xLsr2C"；compare(前两者) = 22
 *   流式（不预定长）update("Also called fuzzy hashes, ").digest() = "3:AXGBicFlF:AXGHR"
 *   ppdeep：mc² / MC2 两句 hash 与 compare=34（次级来源，编码 utf-8）
 *
 * 输入：hash 档 = hex / base64 / 原样 UTF-8（inputEnc 可指定；纯文本请选 utf8，
 *   auto 档会把偶长的纯 hex 字符串当 hex）；compare 档 = 两行签名，或签名 A 进
 *   主输入 + 签名 B 填参数 textB（仿 diffTool 双输入形态）。
 *   两签名现另有同等级字段通道 fields.sigA / fields.sigB（fieldsMode:"slots"）；
 *   字段缺省才读旧通道（主输入、params.textB、两行格式），显式空 sigB 表示「不给 B」。
 *
 * 红线：算法照 ssdeep 官方 C 源逐行移植不发明；加载期自检 IIFE 跑官方向量，
 *   任一失败抛错防错表静默运行。纯本地零外发；core 层零 UI 依赖（仅 registry）。
 */
import { register } from "./registry.js";

// ============================================================
// 双签名槽归一（fields 新通道 / 主输入 + params.textB 旧通道）
// 规则（与已落位的 diffTool 同口径，只在缺省时才读旧通道）：
//   - sigA 缺省 → 主输入文本（或拖入的 rawBytes）；sigA 与主输入同时给出即冲突（不比相等）。
//   - sigB 缺省 → params.textB（→ inputContract 的 fields.textB 别名）；非空则用。
//   - sigB 显式空串 = 「明确不给 B」：抑制旧 textB，回退「签名 A 两行」旧规则，不静默择一。
//   - sigB 与 textB 同时给出且不一致 → 冲突报错；相等接受。
//   - 未知字段键报错，避免拼错键被静默忽略。
// ============================================================
const SIG_FIELD_KEYS = ["sigA", "sigB", "textB"]; // textB = inputContract 的显式旧别名，只作 B 兜底

function sigBytesOf(v, label) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  throw new Error(`字段 ${label} 的字节槽需要 Uint8Array / ArrayBuffer / 字节数组`);
}

/** 归一一个签名槽；null/undefined → null（表示「未提供」，交给旧通道）。 */
function sigSlotOf(v, label) {
  if (v == null) return null;
  if (typeof v === "string") return { kind: "text", value: v };
  if (v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    return { kind: "bytes", value: sigBytesOf(v, label) };
  }
  if (typeof v === "object") {
    if (v.kind === "text") {
      if (typeof v.value !== "string") throw new Error(`字段 ${label} 的文本槽 value 必须是字符串`);
      const encoding = v.encoding ?? "utf8";
      if (encoding !== "utf8") throw new Error(`字段 ${label} 的文本槽编码只接受 utf8（收到 ${encoding}）：字节请用字节槽，或统一走 inputEnc`);
      return { kind: "text", value: v.value };
    }
    if (v.kind === "bytes") return { kind: "bytes", value: sigBytesOf(v.value, label) };
  }
  throw new Error(`字段 ${label} 既不是文本槽也不是字节槽（拿到 ${JSON.stringify(v)}）`);
}

/** @returns {{a:{kind:string,value:any}, b:null|{kind:string,value:any}, bSource:string}} */
function resolveSigPair(text, p) {
  const fields = p && p.fields;
  const primaryText = String(text || "");
  const raw = p && p.rawBytes != null ? sigBytesOf(p.rawBytes, "rawBytes") : null;
  const legacyB = p && p.textB != null ? String(p.textB) : "";
  let a = null, b = null, bSource = "none";
  if (fields != null) {
    if (typeof fields !== "object" || Array.isArray(fields)) throw new Error("fields 必须是对象");
    for (const key of Object.keys(fields)) {
      if (!SIG_FIELD_KEYS.includes(key)) throw new Error(`未知输入字段: ${key}（本算法只接受 sigA / sigB）`);
    }
    a = sigSlotOf(fields.sigA, "sigA");
    b = sigSlotOf(fields.sigB, "sigB");
    if (!b) b = sigSlotOf(fields.textB, "textB");
    if (a && (primaryText.length > 0 || raw)) throw new Error("fields.sigA 与主输入同时给出：一个输入只允许一个来源");
    if (b) {
      if (b.kind === "text" && b.value === "") {
        b = null; bSource = "field-empty"; // 显式空：抑制旧 textB，回退两行
      } else {
        if (legacyB !== "" && !(b.kind === "text" && b.value === legacyB)) {
          throw new Error("fields.sigB 与 params.textB 同时给出且不一致：一个输入只允许一个来源");
        }
        bSource = "field";
      }
    }
  }
  if (!a) a = raw ? { kind: "bytes", value: raw } : { kind: "text", value: primaryText };
  if (!b && bSource === "none" && legacyB !== "") { b = { kind: "text", value: legacyB }; bSource = "legacy-textB"; }
  return { a, b, bSource };
}

// ============================================================
// 常量（照 fuzzy.c）
// ============================================================
const ROLLING_WINDOW = 7;
const MIN_BLOCKSIZE = 3;
const HASH_INIT = 0x27; // = 0x28021967 mod 64
const NUM_BLOCKHASHES = 31;
const SPAMSUM_LENGTH = 64;
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const FUZZY_TOTAL_SIZE_MAX = 3 * 2 ** 30 * SPAMSUM_LENGTH; // BS(30)*64 = 206158430208
const FLAG_NEED_LASTHASH = 1;
const FLAG_SIZE_FIXED = 2;
const BS = (index) => MIN_BLOCKSIZE * 2 ** index;

/** 块哈希：官方 sum_table[h][c] 的闭式（sum_table.h 每 64×64 格 = ((h*19)&63)^c，自检核对锚点）。 */
function sumHash(c, h) {
  return ((((h & 63) * 19) & 63) ^ (c & 63)) & 63;
}

// ============================================================
// 滚动哈希（fuzzy.c roll_hash / roll_sum，uint32 环绕）
// ============================================================
function rollInit() {
  return { window: new Uint8Array(ROLLING_WINDOW), h1: 0, h2: 0, h3: 0, n: 0 };
}
function rollHash(s, c) {
  s.h2 = (s.h2 - s.h1 + ROLLING_WINDOW * c) >>> 0; // C: h2 -= h1; h2 += 7*c
  s.h1 = (s.h1 + c - s.window[s.n]) >>> 0; // C: h1 += c; h1 -= window[n]
  s.window[s.n] = c;
  s.n++;
  if (s.n === ROLLING_WINDOW) s.n = 0;
  s.h3 = ((s.h3 << 5) ^ c) >>> 0;
}
function rollSum(s) {
  return (s.h1 + s.h2 + s.h3) >>> 0;
}

// ============================================================
// 签名状态机（fuzzy_new / set_total_input_length / fork / reduce / engine_step / digest）
// ============================================================
function newBlockhash() {
  return { dindex: 0, digest: new Array(SPAMSUM_LENGTH).fill("\0"), halfdigest: "\0", h: 0, halfh: 0 };
}

function fuzzyNew() {
  const bh = [];
  for (let i = 0; i < NUM_BLOCKHASHES; i++) bh.push(newBlockhash());
  bh[0].h = HASH_INIT;
  bh[0].halfh = HASH_INIT;
  return {
    totalSize: 0,
    fixedSize: 0,
    reduceBorder: MIN_BLOCKSIZE * SPAMSUM_LENGTH, // 192
    bhstart: 0,
    bhend: 1,
    bhendlimit: NUM_BLOCKHASHES - 1,
    flags: 0,
    rollmask: 0,
    bh,
    roll: rollInit(),
    lasth: 0,
  };
}

/** 定长路径（fuzzy_hash_buf 同款）：先声明总长，估出块尺寸上限档。 */
function fuzzySetTotalInputLength(st, len) {
  if (len > FUZZY_TOTAL_SIZE_MAX) throw new Error("ssdeep: 输入超过 206158430208 字节上限");
  st.flags |= FLAG_SIZE_FIXED;
  st.fixedSize = len;
  let bi = 0;
  while (BS(bi) * SPAMSUM_LENGTH < len) {
    ++bi;
    if (bi === NUM_BLOCKHASHES - 2) break;
  }
  ++bi;
  st.bhendlimit = bi;
}

function tryForkBlockhash(st) {
  const obh = st.bh[st.bhend - 1];
  if (st.bhend <= st.bhendlimit) {
    const nbh = st.bh[st.bhend];
    nbh.h = obh.h;
    nbh.halfh = obh.halfh;
    nbh.digest[0] = "\0";
    nbh.halfdigest = "\0";
    nbh.dindex = 0;
    ++st.bhend;
  } else if (st.bhend === NUM_BLOCKHASHES && !(st.flags & FLAG_NEED_LASTHASH)) {
    st.flags |= FLAG_NEED_LASTHASH;
    st.lasth = obh.h;
  }
}

function tryReduceBlockhash(st) {
  if (st.bhend - st.bhstart < 2) return;
  const effSize = st.flags & FLAG_SIZE_FIXED ? st.fixedSize : st.totalSize;
  if (st.reduceBorder >= effSize) return;
  if (st.bh[st.bhstart + 1].dindex < SPAMSUM_LENGTH / 2) return;
  ++st.bhstart;
  st.reduceBorder *= 2;
  st.rollmask = st.rollmask * 2 + 1;
}

/** 引擎单步（fuzzy_engine_step 逐行对应）。 */
function fuzzyEngineStep(st, c) {
  rollHash(st.roll, c);
  const horg = rollSum(st.roll) + 1; // ≤ 2^32，Number 精确
  let h = Math.floor(horg / MIN_BLOCKSIZE);
  for (let i = st.bhstart; i < st.bhend; ++i) {
    st.bh[i].h = sumHash(c, st.bh[i].h);
    st.bh[i].halfh = sumHash(c, st.bh[i].halfh);
  }
  if (st.flags & FLAG_NEED_LASTHASH) st.lasth = sumHash(c, st.lasth);
  if (horg === 0) return; // 照 C 保留（horg≥1 恒真）
  if (h & st.rollmask) return;
  if (horg % MIN_BLOCKSIZE !== 0) return;
  h = Math.floor(h / 2 ** st.bhstart);
  let i = st.bhstart;
  do {
    const b = st.bh[i];
    if (b.dindex === 0) tryForkBlockhash(st); // 每档首字符触发时 fork 下一档
    b.digest[b.dindex] = B64[b.h];
    b.halfdigest = B64[b.halfh];
    if (b.dindex < SPAMSUM_LENGTH - 1) {
      b.digest[++b.dindex] = "\0";
      b.h = HASH_INIT;
      if (b.dindex < SPAMSUM_LENGTH / 2) {
        b.halfh = HASH_INIT;
        b.halfdigest = "\0";
      }
    } else {
      tryReduceBlockhash(st);
    }
    if (h & 1) break;
    h = Math.floor(h / 2);
  } while (++i < st.bhend);
}

/** 喂数据（fuzzy_update；不定长流式路径不设 fixed_size）。 */
function fuzzyUpdate(st, bytes) {
  st.totalSize += bytes.length;
  for (let k = 0; k < bytes.length; k++) fuzzyEngineStep(st, bytes[k]);
}

/** 收尾出签名（fuzzy_digest，flags=0：不去重连串、第二段截断 31）。 */
function fuzzyDigest(st) {
  if (st.totalSize > FUZZY_TOTAL_SIZE_MAX) throw new Error("ssdeep: 输入超上限");
  if (st.flags & FLAG_SIZE_FIXED && st.fixedSize !== st.totalSize) {
    throw new Error("ssdeep: 定长状态与实际长度不符");
  }
  let bi = st.bhstart;
  const h = rollSum(st.roll);
  while (BS(bi) * SPAMSUM_LENGTH < st.totalSize) ++bi; // 初始块尺寸猜测
  if (bi >= st.bhend) bi = st.bhend - 1;
  while (bi > st.bhstart && st.bh[bi].dindex < SPAMSUM_LENGTH / 2) --bi; // 按实际长度回退
  let out = String(BS(bi)) + ":";
  // hash1：digest[dindex) + 可选尾字符
  let d1 = st.bh[bi].digest.slice(0, st.bh[bi].dindex).join("");
  const ch1 = h !== 0 ? B64[st.bh[bi].h] : st.bh[bi].digest[st.bh[bi].dindex];
  if (ch1 !== "\0") d1 += ch1;
  out += d1 + ":";
  if (bi < st.bhend - 1) {
    // hash2（常见）：截断 31 + 尾字符（halfh / halfdigest）
    ++bi;
    let sz = st.bh[bi].dindex;
    if (sz > SPAMSUM_LENGTH / 2 - 1) sz = SPAMSUM_LENGTH / 2 - 1;
    let d2 = st.bh[bi].digest.slice(0, sz).join("");
    const ch2 = h !== 0 ? B64[st.bh[bi].halfh] : st.bh[bi].halfdigest;
    if (ch2 !== "\0") d2 += ch2;
    out += d2;
  } else if (h !== 0) {
    // hash2（小输入单档）：单字符
    out += bi === 0 ? B64[st.bh[0].h] : B64[st.lasth];
  }
  return out;
}

/** 整块哈希（fuzzy_hash_buf 路径：先声明总长）。 */
function ssdeepHash(bytes) {
  const st = fuzzyNew();
  fuzzySetTotalInputLength(st, bytes.length);
  fuzzyUpdate(st, bytes);
  return fuzzyDigest(st);
}

// ============================================================
// 比对（fuzzy_compare / score_strings / has_common_substring / edit_distn）
// ============================================================

/** 读一段并消除 ≥4 连同字符（copy_eliminate_sequences；上限 64 字符，超限返回 null=畸形）。 */
function copyEliminateSequences(s, pos, etoken) {
  let seq = 0;
  const prev = s[pos];
  if (prev === undefined || prev === "\0" || prev === etoken) return { ok: true, pos, out: "" };
  let out = prev;
  let i = pos + 1;
  for (;;) {
    const curr = s[i];
    if (curr === undefined || curr === "\0" || curr === etoken) return { ok: true, pos: i, out };
    ++i;
    if (curr === prev) {
      if (++seq >= 3) {
        seq = 3;
        continue;
      }
      if (out.length >= SPAMSUM_LENGTH) return { ok: false };
      out += curr;
    } else {
      if (out.length >= SPAMSUM_LENGTH) return { ok: false };
      out += curr;
      seq = 0;
    }
  }
}

/** 两串是否有长度 7 的公共子串（经典版：滚动哈希预筛 + 逐字节确认）。 */
function hasCommonSubstring(s1, s2) {
  const full1 = s1.length;
  if (full1 < ROLLING_WINDOW || s2.length < ROLLING_WINDOW) return false;
  const n1 = full1 - (ROLLING_WINDOW - 1);
  const hashes = new Array(n1);
  const st = rollInit();
  for (let i = 0; i < ROLLING_WINDOW - 1; i++) rollHash(st, s1.charCodeAt(i));
  for (let i = ROLLING_WINDOW - 1; i < full1; i++) {
    rollHash(st, s1.charCodeAt(i));
    hashes[i - (ROLLING_WINDOW - 1)] = rollSum(st);
  }
  const st2 = rollInit();
  for (let j = 0; j < ROLLING_WINDOW - 1; j++) rollHash(st2, s2.charCodeAt(j));
  for (let j = 0; j < s2.length - (ROLLING_WINDOW - 1); j++) {
    rollHash(st2, s2.charCodeAt(j + ROLLING_WINDOW - 1));
    const h = rollSum(st2);
    for (let i = 0; i < n1; i++) {
      if (hashes[i] === h && s1.substr(i, ROLLING_WINDOW) === s2.substr(j, ROLLING_WINDOW)) return true;
    }
  }
  return false;
}

/** 编辑距离（edit_dist.c：插 1 / 删 1 / 换 2）。 */
function editDistn(s1, s2) {
  let t1 = new Array(s2.length + 1);
  let t2 = new Array(s2.length + 1);
  for (let j = 0; j <= s2.length; j++) t1[j] = j;
  for (let i1 = 0; i1 < s1.length; i1++) {
    t2[0] = i1 + 1;
    for (let i2 = 0; i2 < s2.length; i2++) {
      const costA = t1[i2 + 1] + 1; // 插入
      const costD = t2[i2] + 1; // 删除
      const costR = t1[i2] + (s1[i1] === s2[i2] ? 0 : 2); // 替换
      t2[i2 + 1] = Math.min(costA, costD, costR);
    }
    const tmp = t1;
    t1 = t2;
    t2 = tmp;
  }
  return t1[s2.length];
}

/** 低层打分（score_strings）。 */
function scoreStrings(s1, s2, blockSize) {
  if (s1.length < ROLLING_WINDOW) return 0;
  if (s2.length < ROLLING_WINDOW) return 0;
  if (!hasCommonSubstring(s1, s2)) return 0;
  let score = editDistn(s1, s2);
  const minlen = Math.min(s1.length, s2.length);
  score = Math.floor((score * SPAMSUM_LENGTH) / (s1.length + s2.length));
  score = Math.floor((100 * score) / SPAMSUM_LENGTH);
  score = 100 - score;
  if (blockSize >= Math.floor((99 + ROLLING_WINDOW) / ROLLING_WINDOW) * MIN_BLOCKSIZE) return score;
  const cap = Math.floor(blockSize / MIN_BLOCKSIZE) * minlen;
  if (score > cap) score = cap;
  return score;
}

/**
 * 两签名比对 → 0..100；畸形签名抛错（C 返回 -1 语义）。
 * 块尺寸须相等或恰差 2 倍，否则 0 分（非错误，官方语义）。
 */
function ssdeepCompare(str1, str2) {
  if (typeof str1 !== "string" || typeof str2 !== "string") throw new Error("ssdeep: 签名必须是字符串");
  const m1 = /^\s*(\d+)\s*:/.exec(str1);
  const m2 = /^\s*(\d+)\s*:/.exec(str2);
  if (!m1 || !m2) throw new Error("ssdeep: 签名格式非法（应为 blocksize:hash1:hash2）");
  const bs1 = Number(m1[1]);
  const bs2 = Number(m2[1]);
  if (bs1 > Number.MAX_SAFE_INTEGER || bs2 > Number.MAX_SAFE_INTEGER) throw new Error("ssdeep: blocksize 超出可表示范围");
  if (bs1 !== bs2 && bs1 * 2 !== bs2 && !(bs1 % 2 === 0 && bs1 / 2 === bs2)) return 0;

  const p1 = { pos: m1[0].length };
  const r1 = copyEliminateSequences(str1, p1.pos, ":");
  if (!r1.ok) throw new Error("ssdeep: 签名 A 第一段消重后超 64 字符（畸形）");
  const s1b1 = r1.out;
  const p2 = { pos: r1.pos };
  if (str1[p2.pos] === undefined) throw new Error("ssdeep: 签名 A 缺第二段（blocksize:hash1:hash2）");
  const r2 = copyEliminateSequences(str1, p2.pos + 1, ",");
  if (!r2.ok) throw new Error("ssdeep: 签名 A 第二段消重后超 64 字符（畸形）");
  const s1b2 = r2.out;

  const q1 = { pos: m2[0].length };
  const t1 = copyEliminateSequences(str2, q1.pos, ":");
  if (!t1.ok) throw new Error("ssdeep: 签名 B 第一段消重后超 64 字符（畸形）");
  const s2b1 = t1.out;
  const q2 = { pos: t1.pos };
  if (str2[q2.pos] === undefined) throw new Error("ssdeep: 签名 B 缺第二段（blocksize:hash1:hash2）");
  const t2 = copyEliminateSequences(str2, q2.pos + 1, ",");
  if (!t2.ok) throw new Error("ssdeep: 签名 B 第二段消重后超 64 字符（畸形）");
  const s2b2 = t2.out;

  if (bs1 === bs2 && s1b1.length === s2b1.length && s1b2.length === s2b2.length &&
      s1b1 === s2b1 && s1b2 === s2b2) return 100;

  if (bs1 === bs2) {
    return Math.max(
      scoreStrings(s1b1, s2b1, bs1),
      scoreStrings(s1b2, s2b2, bs1 * 2)
    );
  }
  if (bs1 * 2 === bs2) return scoreStrings(s2b1, s1b2, bs2);
  return scoreStrings(s1b1, s2b2, bs1);
}

// ============================================================
// 输入解析（hex / base64 / utf8，auto 优先 hex→base64→utf8，与 compress.js 口径一致）
// ============================================================
const TE = new TextEncoder();
const B64C = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHexStr(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64Str(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64C.includes(c)) return false;
  return true;
}
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function ssdeepInputToBytes(text, p) {
  if (p && p.rawBytes != null) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const enc = (p && p.inputEnc) || "auto";
  const s = String(text).trim().replace(/\s+/g, "");
  if (enc === "hex") {
    if (!isHexStr(s)) throw new Error("ssdeep: 输入不是合法 hex（偶数长度 0-9a-f）");
    return hexToBytes(s);
  }
  if (enc === "base64") {
    try { return b64ToBytes(s); } catch { throw new Error("ssdeep: 输入不是合法 base64"); }
  }
  if (enc === "utf8") return TE.encode(String(text));
  if (isHexStr(s)) return hexToBytes(s);
  if (isB64Str(s)) {
    try { return b64ToBytes(s); } catch { /* fall through */ }
  }
  return TE.encode(String(text));
}

// ============================================================
// op 入口
// ============================================================
function ssdeepRun(text, p) {
  const mode = (p && p.mode) || "hash";
  if (mode === "compare") {
    const pair = resolveSigPair(text, p?.fields == null ? { ...p, rawBytes: null } : p);
    if (pair.a.kind !== "text") throw new Error("ssdeep 比对：签名 A 只接受文本槽（字节输入请走「生成签名」档）");
    const a = pair.a.value.trim();
    let sigB = "";
    if (pair.b) {
      if (pair.b.kind !== "text") throw new Error("ssdeep 比对：签名 B 只接受文本槽");
      sigB = pair.b.value.trim();
    }
    let sigA = a;
    if (!sigB) {
      const lines = a.split(/\r?\n/).map((x) => x.trim()).filter((x) => x.length > 0);
      if (lines.length !== 2) throw new Error("ssdeep 比对需要两条签名：每行一条，或签名 B 填入参数 textB");
      sigA = lines[0];
      sigB = lines[1];
    }
    if (!sigA) throw new Error("ssdeep 比对缺少签名 A");
    return String(ssdeepCompare(sigA, sigB));
  }
  // hash 档：字节槽原样入算法（不做 hex/base64 往返）；文本槽仍按 inputEnc / auto 解释。
  if (p?.fields == null) return ssdeepHash(ssdeepInputToBytes(text, p));
  const { a } = resolveSigPair(text, p);
  const bytes = a.kind === "bytes" ? a.value : ssdeepInputToBytes(a.value, { inputEnc: p.inputEnc });
  return ssdeepHash(bytes);
}

// ============================================================
// 加载期自检（官方向量 + sum_table 锚点；任一失败抛错）
// ============================================================
(function selfCheck() {
  const eq = (a, b, msg) => { if (a !== b) throw new Error("ssdeep 自检失败：" + msg + ` got=${JSON.stringify(a)}`); };
  // sum_table 闭式锚点（ssdeep sum_table.h 逐格抽取）
  eq(sumHash(0x00, 0x00), 0x00, "sum_table[0][0]");
  eq(sumHash(0x01, 0x00), 0x01, "sum_table[0][1]");
  eq(sumHash(0x00, 0x01), 0x13, "sum_table[1][0]");
  eq(sumHash(0x01, 0x01), 0x12, "sum_table[1][1]");
  eq(sumHash(0x03, 0x02), 0x25, "sum_table[2][3]");
  eq(sumHash(0x03, 0x03), 0x3a, "sum_table[3][3]");
  eq(sumHash(0x00, 0x04), 0x0c, "sum_table[4][0]");
  // C 库向量（python-ssdeep tests/test_lib.py，libfuzzy 生成）
  eq(ssdeepHash(TE.encode("Also called fuzzy hashes, Ctph can match inputs that have homologies.")),
    "3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C", "向量 Ctph 句");
  eq(ssdeepHash(TE.encode("Also called fuzzy hashes, CTPH can match inputs that have homologies.")),
    "3:AXGBicFlIHBGcL6wCrFQEv:AXGH6xLsr2C", "向量 CTPH 句");
  eq(ssdeepCompare("3:AXGBicFlgVNhBGcL6wCrFQEv:AXGHsNhxLsr2C",
    "3:AXGBicFlIHBGcL6wCrFQEv:AXGH6xLsr2C"), 22, "compare=22");
  // 流式不定长向量（Hash().update(30 字节).digest()）
  {
    const st = fuzzyNew();
    fuzzyUpdate(st, TE.encode("Also called fuzzy hashes, "));
    eq(fuzzyDigest(st), "3:AXGBicFlF:AXGHR", "流式半句向量");
  }
  // ppdeep README 向量（纯 Python 独立实现，次级来源；² 为 utf-8 两字节 c2 b2）
  eq(ssdeepHash(TE.encode("The equivalence of mass and energy translates into the well-known E = mc²")),
    "3:RC0qYX4LBFA0dxEq4z2LRK+oCKI9VnXn:RvqpLB60dx8ilK+owX", "ppdeep mc² 句");
  eq(ssdeepHash(TE.encode("The equivalence of mass and energy translates into the well-known E = MC2")),
    "3:RC0qYX4LBFA0dxEq4z2LRK+oCKI99:RvqpLB60dx8ilK+oA", "ppdeep MC2 句");
  eq(ssdeepCompare("3:RC0qYX4LBFA0dxEq4z2LRK+oCKI9VnXn:RvqpLB60dx8ilK+owX",
    "3:RC0qYX4LBFA0dxEq4z2LRK+oCKI99:RvqpLB60dx8ilK+oA"), 34, "ppdeep compare=34");
  // 空输入 = "3::"（fuzzy_hash_buf(0 字节) 行为）
  eq(ssdeepHash(new Uint8Array(0)), "3::", "空输入");
})();

register({
  id: "ssdeep",
  cat: "hash",
  name: "SSDEEP 模糊哈希",
  desc: "CTPH 上下文触发分段哈希（ssdeep 同源）：数据 → blocksize:hash1:hash2 签名，两签名比对出 0-100 相似度；找同源/变种样本（改几个字节分数仍高）。算法逐行对照 ssdeep 官方 fuzzy.c，过 C 库官方向量",
  // 两签名同等级、不拼串，原样作为 params.fields 交给 run；旧 params.textB 仍作签名 B 的兜底。
  fieldsMode: "slots",
  fields: [
    {
      key: "sigA",
      label: "输入 A（数据 / 签名 A）",
      labelKey: "op.ssdeep.field.a",
      legacyArea: "ioIn:0",
      accepts: ["text", "bytes"],
      placeholderKey: "op.ssdeep.field.hintA",
      rows: 3,
    },
    {
      key: "sigB",
      mirrorParam: "textB", // 旧通道同步：批处理 / 配方 / 分享链接仍按 params.textB 取 B
      label: "输入 B（签名 B）",
      labelKey: "op.ssdeep.field.b",
      accepts: ["text"],
      mode: "compare",
      placeholderKey: "op.ssdeep.field.hintB",
      rows: 3,
    },
  ],
  params: [
    {
      key: "mode",
      label: "模式",
      type: "select",
      default: "hash",
      options: [
        { value: "hash", label: "生成签名（输入 = 数据）" },
        { value: "compare", label: "比对两签名（0-100 分）" },
      ],
    },
    {
      key: "textB",
      uiHidden: true, // 工作台用字段框 B；本参数只作旧调用通道
      label: "签名 B（比对模式；留空则读输入第 2 行）",
      type: "text",
      default: "",
      placeholder: "3:AXGBicFl...:AXGH...",
    },
    {
      key: "inputEnc",
      label: "输入编码（生成签名时）",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
  ],
  run: ssdeepRun,
  acceptsBytes: true,
});

export { ssdeepRun, ssdeepHash, ssdeepCompare, fuzzyNew, fuzzyUpdate, fuzzyDigest, fuzzySetTotalInputLength, sumHash, scoreStrings, editDistn, hasCommonSubstring, B64, SPAMSUM_LENGTH, MIN_BLOCKSIZE, resolveSigPair, sigSlotOf };
