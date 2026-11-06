/*
 * jefferson.js — 杰斐逊轮盘 Jefferson disk / Bazeries cylinder（cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 一组圆盘，每盘边缘刻一个 26 字母的乱序字母表（本实现要求每盘是 A-Z 的一个排列）。
 *  - 圆盘的排列顺序 = 密钥。加密：按密钥顺序装盘，逐盘转动使明文第 i 个字母落在
 *    基准行（本实现取「盘串索引 0」为基准行），再从另一行读出密文。
 *  - 读出行的偏移量 offset 双方共享：密文字母 = disk[(index(明文字母) + offset) mod 26]。
 *  - 解密：密文字母在盘上的索引减 offset 即得明文字母。offset 已知 → 双向严格可逆
 *    （古典用法是让接收者逐行试读，本实现把「读哪一行」固定成参数，消除歧义）。
 *
 * 权威来源：
 *  - Wikipedia「Jefferson disk」(https://en.wikipedia.org/wiki/Jefferson_disk)，访问日期 2026-09-20：
 *    给出 10 盘玩具例（key 7,9,5,10,1,6,3,8,2,4；明文 retreatnow；密文 OMKEGWPDFN；偏移 6 行）。
 *    本实现默认参数即该例，encode("retreatnow") = "OMKEGWPDFN"。
 *  - dCode「Cylindre de Jefferson」(https://www.dcode.fr/cylindre-jefferson)，访问日期 2026-09-20：
 *    其界面参数「Ligne à lire (rang 1 en dessous, -1 au dessus)」与本实现 offset 同义。
 *
 * 约定：
 *  - 字母表固定 A-Z；明文/密文只取 A-Z（其余字符丢弃），输出大写。
 *  - 明文长度 > 盘数时按盘数分块；末块只用前 k 个盘（k = 剩余长度），保证可逆。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Wikipedia 玩具例的 10 个盘（每盘 26 字母排列，原样照抄该条目）。
const DEFAULT_DISKS = [
  "ZWAXJGDLUBVIQHKYPNTCRMOSFE",
  "KPBELNACZDTRXMJQOYHGVSFUWI",
  "BDMAIZVRNSJUWFHTEQGYXPLOCK",
  "RPLNDVHGFCUKTEBSXQYIZMJWAO",
  "IHFRLABEUOTSGJVDKCPMNZQWXY",
  "AMKGHIWPNYCJBFZDRUSLOQXVET",
  "GWTHSPYBXIZULVKMRAFDCEONJQ",
  "NOZUTWDCVRJLXKISEFAPMYGHBQ",
  "XPLTDSRFHENYVUBMCQWAOIKZGJ",
  "UDNAJFBOWTGVRSCZQKELMXYIHP",
];
const DEFAULT_DISKS_TEXT = DEFAULT_DISKS.join("\n");
const DEFAULT_ORDER = "7,9,5,10,1,6,3,8,2,4";

/** 解析盘定义：每行一个（也接受逗号/空白分隔）。每个必须是 26 字母的排列。 */
function parseDisks(spec) {
  const parts = String(spec == null ? "" : spec)
    .split(/[\r\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) throw new Error("杰斐逊轮盘：圆盘定义为空——至少需要一个 26 字母的盘。");
  return parts.map((s, i) => {
    const up = s.toUpperCase();
    if (!/^[A-Z]+$/.test(up))
      throw new Error(`杰斐逊轮盘：第 ${i + 1} 个盘含非字母字符（"${s}"）。`);
    if (up.length !== 26)
      throw new Error(`杰斐逊轮盘：第 ${i + 1} 个盘长度 ${up.length}，必须恰好 26 个字母。`);
    if (new Set(up).size !== 26)
      throw new Error(`杰斐逊轮盘：第 ${i + 1} 个盘有重复字母，必须是 A-Z 的排列。`);
    return up;
  });
}

/** 解析密钥（盘序号序列，1 起）。返回 0 起的盘下标数组。 */
function parseOrder(spec, diskCount) {
  const parts = String(spec == null ? "" : spec)
    .split(/[^0-9]+/)
    .filter(Boolean);
  if (!parts.length) throw new Error("杰斐逊轮盘：圆盘顺序（密钥）为空。");
  return parts.map((s) => {
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > diskCount)
      throw new Error(`杰斐逊轮盘：圆盘序号 ${s} 越界（可用 1-${diskCount}）。`);
    return n - 1;
  });
}

/** 核心：按密钥顺序取盘，offset 行读出（decode=true 时反向）。 */
function jeffersonRun(text, orderSpec, disksSpec, offset, decode) {
  const disks = parseDisks(disksSpec);
  const order = parseOrder(orderSpec, disks.length);
  const off = Number(offset) || 0;
  const letters = [...String(text == null ? "" : text).toUpperCase()].filter((c) => AZ.includes(c));
  if (!letters.length) throw new Error("杰斐逊轮盘：输入不含任何 A-Z 字母。");
  const n = order.length;
  let out = "";
  for (let i = 0; i < letters.length; i++) {
    const blockPos = i % n; // 末块自动只用前 blockPos+1 个盘
    const disk = disks[order[blockPos]];
    const idx = disk.indexOf(letters[i]);
    const j = decode ? (idx - off) % 26 : (idx + off) % 26;
    out += disk[(j + 26) % 26];
  }
  return out;
}

register({
  id: "jefferson", cat: "classic", name: "杰斐逊轮盘",
  desc: "Jefferson/Bazeries 转轮密码：圆盘排列顺序为密钥，明文对齐基准行后从偏移行读出；offset 已知故双向可逆（默认即 Wikipedia 10 盘例）",
  params: [
    { key: "key", label: "圆盘顺序（密钥，1 起逗号分隔）", type: "text", default: DEFAULT_ORDER },
    { key: "disks", label: "圆盘定义（每行一个 26 字母排列）", type: "textarea", default: DEFAULT_DISKS_TEXT },
    { key: "offset", label: "密文行偏移（正=向字母表后方，负=前方）", type: "number", default: 6 },
  ],
  encode: (t, p) => jeffersonRun(t, (p && p.key != null) ? p.key : DEFAULT_ORDER, (p && p.disks != null) ? p.disks : DEFAULT_DISKS_TEXT, (p && p.offset != null) ? p.offset : 6, false),
  decode: (t, p) => jeffersonRun(t, (p && p.key != null) ? p.key : DEFAULT_ORDER, (p && p.disks != null) ? p.disks : DEFAULT_DISKS_TEXT, (p && p.offset != null) ? p.offset : 6, true),
});

export { jeffersonRun, parseDisks, parseOrder, DEFAULT_DISKS, DEFAULT_ORDER };
