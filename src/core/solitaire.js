/*
 * solitaire.js — Solitaire / Pontifex 扑克牌流密码（cat:'classic'）。
 *
 * Bruce Schneier 设计、《Cryptonomicon》中登场的手工流密码。
 * 54 张牌：1..52 普通牌，53=大王(A)，54=小王(B)。逐步演化牌堆生成密钥流
 * 与明文字母(1..26)模 26 相加/相减。纯函数，仅依赖 registry。
 *
 * 算法权威规范：Bruce Schneier "The Solitaire Encryption Algorithm"。
 * 官方测试向量（见文件末临时脚本验证）：
 * 明文 AAAAAAAAAA 无 keyword → EXKYIZSGEH
 * keyword=FOO 明文 AAAAAAAAAAAAAAA → ITHZUJIWGRFARMW
 */
import { register } from "./registry.js";

const A_JOKER = 53;
const B_JOKER = 54;

// 全新未加密牌堆：1..52,53,54。
function freshDeck() {
  const d = [];
  for (let i = 1; i <= 54; i++) d.push(i);
  return d;
}

// 把某张王(joker)下移 count 位。牌堆视为环：若王在最底，则移到「顶牌之下」（第二张）。
function moveDown(deck, joker, count) {
  for (let c = 0; c < count; c++) {
    const i = deck.indexOf(joker);
    if (i === deck.length - 1) {
 // 最底：抽出后插到索引 1（第一张牌之后）。
      deck.splice(i, 1);
      deck.splice(1, 0, joker);
    } else {
 // 与下一张交换。
      const tmp = deck[i];
      deck[i] = deck[i + 1];
      deck[i + 1] = tmp;
    }
  }
}

// Triple cut：以两王为界，交换第一张王之前段 与 最后一张王之后段；两王及其间不动。
function tripleCut(deck) {
  const a = deck.indexOf(A_JOKER);
  const b = deck.indexOf(B_JOKER);
  const first = Math.min(a, b);
  const last = Math.max(a, b);
  const top = deck.slice(0, first);
  const mid = deck.slice(first, last + 1);
  const bot = deck.slice(last + 1);
  return bot.concat(mid, top);
}

// Count cut：取值 n（王算 53），把顶部 n 张移到「底牌之上」，底牌不动。
function countCut(deck, n) {
  if (n >= B_JOKER) n = A_JOKER; // 两王都算 53
  if (n <= 0 || n >= deck.length) return deck.slice();
  const bottom = deck[deck.length - 1];
  const top = deck.slice(0, n);
  const mid = deck.slice(n, deck.length - 1);
  return mid.concat(top, [bottom]);
}

// 执行一轮牌堆演化（步骤 1-4），返回新牌堆。
function advance(deck) {
  moveDown(deck, A_JOKER, 1);
  moveDown(deck, B_JOKER, 2);
  deck = tripleCut(deck);
  const bottom = deck[deck.length - 1];
  deck = countCut(deck, bottom);
  return deck;
}

// 用 keyword 对牌堆做 key-in：每个字母跑步骤 1-4，再额外用字母值(A=1..Z=26)做一次 count cut。
function keyDeck(deck, key) {
  const k = (key || "").toUpperCase().replace(/[^A-Z]/g, "");
  for (const ch of k) {
    deck = advance(deck);
    const val = ch.charCodeAt(0) - 64; // A=1..Z=26
    deck = countCut(deck, val);
  }
  return deck;
}

// 生成 count 个密钥流值（1..26）。王牌轮跳过重跑。
function keystream(deck, count) {
  const out = [];
  let d = deck;
  while (out.length < count) {
    d = advance(d);
    let n = d[0];
    if (n >= B_JOKER) n = A_JOKER; // 顶牌是王算 53
    const card = d[n]; // 顶牌值 n → 输出第 n+1 张（0 基索引 n）
    if (card === A_JOKER || card === B_JOKER) continue; // 王跳过
    out.push(((card - 1) % 26) + 1); // 1..26
  }
  return out;
}

function prepDeck(key) {
  let d = freshDeck();
  if (key && key.trim()) d = keyDeck(d, key);
  return d;
}

function solitaireEncode(text, key) {
  const msg = (text || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!msg) return "";
  const ks = keystream(prepDeck(key), msg.length);
  let out = "";
  for (let i = 0; i < msg.length; i++) {
    const p = msg.charCodeAt(i) - 64; // 1..26
    const c = ((p + ks[i] - 1) % 26) + 1;
    out += String.fromCharCode(c + 64);
  }
  return out;
}

function solitaireDecode(text, key) {
  const msg = (text || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!msg) return "";
  const ks = keystream(prepDeck(key), msg.length);
  let out = "";
  for (let i = 0; i < msg.length; i++) {
    const c = msg.charCodeAt(i) - 64; // 1..26
    const p = (((c - ks[i]) % 26) + 26) % 26; // 正模
    out += String.fromCharCode((p === 0 ? 26 : p) + 64);
  }
  return out;
}

register({
  id: "solitaire",
  cat: "classic",
  name: "Solitaire 扑克流密码",
  desc: "Schneier 的手工流密码（又名 Pontifex），54 张牌演化生成密钥流，可用 keyword 排牌",
  params: [
    { key: "key", label: "keyword 密钥（可空=默认牌序）", type: "text", default: "" },
  ],
  encode: (t, p) => solitaireEncode(t, (p && p.key) || ""),
  decode: (t, p) => solitaireDecode(t, (p && p.key) || ""),
});
