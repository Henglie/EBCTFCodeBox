/*
 * pinyinSearch.js — 拼音全拼/首字母搜索兼容层（T514，恒烈示例「ksmm=凯撒密码」）。
 *
 * 通用机制（非逐 op 硬编码）：对 op 中文名与含中文的别名逐字查 pinyinTable.js
 * （GB2312 全量 + 项目文本增补字；每字至多 2 个常见读音，ü 归一为 v），
 * 生成「全拼连串 + 首字母连串」的常见组合（多音字组合展开、封顶防爆炸），
 * 返回给 main.js buildSearchIndex 并入 hay —— ksmm / ksm m / kaisaimima 均可命中凯撒密码。
 *
 * 双轨约束：aka 数组只存真实别名；本层派生的拼音序列不入 aka，不污染别名数据。
 * 零外发零依赖；非中文输入串返回 null（英文界面/英文别名零开销）。
 * 数据表惰性解析一次（Map 缓存）；索引重建（切语言）只重算变体，表不重读。
 */
import { PINYIN_CHARS, PINYIN_READ } from "./pinyinTable.js";

let _map = null;
function tableMap() {
  if (_map) return _map;
  _map = new Map();
  const reads = PINYIN_READ.split(" ");
  for (let i = 0; i < PINYIN_CHARS.length; i++) {
    const r = reads[i];
    if (r) _map.set(PINYIN_CHARS[i], r.split(","));
  }
  return _map;
}

const MAX_COMBOS = 8; // 多音字组合封顶：超出后其余字只取首选音，防长串组合爆炸

// 单串 → 拼音键数组（全拼 + 首字母，去重）；无汉字返回 null
function keysOf(text) {
  const map = tableMap();
  const seq = []; // 每字：读音数组（含 latin 原样单“音”）
  let hasCJK = false;
  for (const ch of text) {
    if (map.has(ch)) { hasCJK = true; seq.push(map.get(ch)); }
    else if (/[a-zA-Z0-9]/.test(ch)) seq.push([ch.toLowerCase()]);
    // 空格/标点/符号跳过：避免把「·」「（」等拼进键里，中英段自然连拼
  }
  if (!hasCJK) return null;
  let combos = [[]];
  for (const readings of seq) {
    const expandAll = combos.length * readings.length <= MAX_COMBOS;
    const rs = expandAll ? readings : [readings[0]];
    const next = [];
    for (const c of combos) for (const r of rs) next.push([...c, r]);
    combos = next;
  }
  const out = new Set();
  for (const c of combos) {
    out.add(c.join(""));                       // 全拼连串
    out.add(c.map((s) => s[0]).join(""));      // 首字母连串
  }
  return [...out];
}

/** op 中文名 + 别名数组 → 并入搜索 hay 的拼音键全集（无中文则为 []）。 */
export function pinyinKeys(name, akas) {
  const out = [];
  const push = (keys) => { if (keys) for (const k of keys) if (!out.includes(k)) out.push(k); };
  push(keysOf(String(name)));
  if (Array.isArray(akas)) for (const a of akas) push(keysOf(String(a)));
  return out;
}
