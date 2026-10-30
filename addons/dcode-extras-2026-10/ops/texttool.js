/*
 * dcode-extras · 文本变换与数据处理批（对标 dCode Traitement de Texte / Traitement de Données / Stéganographie 文本向）
 */

import { runOp, shuffled, randInt, parseList, longestCommonSubstr, lineDiff } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-text";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

// 上下颠倒字符映射（社区标准翻转表；解码用逆表）
const FLIP = {
  a: "ɐ", b: "q", c: "ɔ", d: "p", e: "ǝ", f: "ɟ", g: "ƃ", h: "ɥ", i: "ᴉ", j: "ɾ", k: "ʞ", l: "l", m: "ɯ", n: "u", o: "o", p: "d", q: "b", r: "ɹ", s: "s", t: "ʇ", u: "n", v: "ʌ", w: "ʍ", x: "x", y: "ʎ", z: "z",
  A: "∀", B: "ᗺ", C: "Ɔ", D: "p", E: "Ǝ", F: "Ⅎ", G: "⅁", H: "H", I: "I", J: "ſ", K: "ʞ", L: "˥", M: "W", N: "N", O: "O", P: "Ԁ", Q: "Ό", R: "ᴚ", S: "S", T: "⊥", U: "∩", V: "Λ", W: "M", X: "X", Y: "⅄", Z: "Z",
  0: "0", 1: "Ɩ", 2: "ᄅ", 3: "Ɛ", 4: "ㄣ", 5: "ϛ", 6: "9", 7: "ㄥ", 8: "8", 9: "6",
  ".": "˙", ",": "'", "?": "¿", "!": "¡", "'": ",", '"': "„", "(": ")", ")": "(", "[": "]", "]": "[", "{": "}", "}": "{", "<": ">", ">": "<", "&": "⅋", "_": "‾",
};

const KB = {
  azerty: ["azertyuiop", "qsdfghjklm", "wxcvbn"],
  qwerty: ["qwertyuiop", "asdfghjkl", "zxcvbnm"],
};
function kbNeighbors(layout) {
  const rows = KB[layout] || KB.azerty;
  const map = {};
  for (let r = 0; r < rows.length; r++) {
    for (let i = 0; i < rows[r].length; i++) {
      const n = [];
      if (i > 0) n.push(rows[r][i - 1]);
      if (i < rows[r].length - 1) n.push(rows[r][i + 1]);
      if (r > 0) n.push(rows[r - 1][Math.min(i, rows[r - 1].length - 1)]);
      if (r < rows.length - 1) n.push(rows[r + 1][Math.min(i, rows[r + 1].length - 1)]);
      map[rows[r][i]] = n.join("");
    }
  }
  return map;
}

export const OPS = [
  runOp("dcode-extras-2026-10/txt-typoglycemia", CAT, "Typoglycémie（首尾不动打乱中间）", "单词首尾字母保留、中间打乱（剑桥效应梗）。fixe=是则中间按字典序（确定性、可复现）；否则随机打乱",
    (t, p) => {
      const fixed = String((p && p.mode) || "fixe") === "fixe";
      return String(t).replace(/[A-Za-zà-ÿ]{3,}/g, (w) => {
        const first = w[0], last = w[w.length - 1];
        let mid = [...w.slice(1, -1)];
        mid = fixed ? mid.sort() : shuffled(mid);
        return first + mid.join("") + last;
      });
    }, [SEL("mode", "模式", "fixe", [{ value: "fixe", label: "确定（中间排序）" }, { value: "random", label: "随机打乱" }])]),

  runOp("dcode-extras-2026-10/txt-boustrophedon", CAT, "牛耕式转行（Boustrophédon）", "按宽度 N 折行，偶数行正向、奇数行反向（如古代行文）；双向",
    (t, p) => {
      const w = Number((p && p.width) || 5);
      const s = String(t).replace(/\s+/g, " ").trim();
      if (!Number.isInteger(w) || w < 2 || w > 200) throw new Error("宽度需为 2..200");
      if (!s) return "";
      const out = [];
      for (let i = 0, ln = 0; i < s.length; i += w, ln++) {
        const seg = s.slice(i, i + w);
        out.push(ln % 2 === 0 ? seg : [...seg].reverse().join(""));
      }
      return out.join("\n");
    }, [P("width", "每行宽度", "5")]),

  runOp("dcode-extras-2026-10/txt-reverse", CAT, "整串反转（Sens Inverse）", "按 Unicode 码位反转整串文本（含组合字符时会拆开，见「上下颠倒」op 处理组合符）",
    (t) => [...String(t)].reverse().join("")),

  {
    id: "dcode-extras-2026-10/txt-updown", cat: CAT, name: "上下颠倒（À l'envers）",
    desc: "拉丁字母/数字/标点翻转为上下颠倒形态（社区标准翻转表 ɐqɔpǝ…），输出已整串反转；encode=翻转，decode=还原",
    params: [],
    encode(text) {
      return [...String(text)].reverse().map((c) => FLIP[c] ?? c).join("");
    },
    decode(text) {
      const rev = new Map(Object.entries(FLIP).map(([k, v]) => [v, k]));
      return [...String(text)].reverse().map((c) => rev.get(c) ?? c).join("");
    },
  },

  runOp("dcode-extras-2026-10/txt-case", CAT, "大小写变换", "UPPER / lower / 交替式 / 反转每字符 / 随机",
    (t, p) => {
      const mode = String((p && p.mode) || "upper");
      const s = String(t);
      let i = 0;
      return [...s].map((c) => {
        if (!/[a-zA-Zà-ÿÀ-Ÿ]/.test(c)) return c;
        const up = c.toUpperCase(), lo = c.toLowerCase();
        if (mode === "upper") return up;
        if (mode === "lower") return lo;
        if (mode === "alt") return (i++ % 2 === 0) ? up : lo;
        if (mode === "invert") return c === up ? lo : up;
        if (mode === "random") return randInt(2) ? up : lo;
        throw new Error(`未知模式 ${mode}`);
      }).join("");
    }, [SEL("mode", "模式", "upper", [{ value: "upper", label: "全部大写" }, { value: "lower", label: "全部小写" }, { value: "alt", label: "交替大写小写" }, { value: "invert", label: "逐字符反转" }, { value: "random", label: "随机" }])]),

  runOp("dcode-extras-2026-10/txt-sortchars", CAT, "字符排序（Tri de Lettres）", "把全部字符按码位排序（可选忽略大小写归并）",
    (t, p) => {
      const ci = String((p && p.ci) || "non") === "oui";
      const arr = [...String(t)];
      arr.sort(ci ? (a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0) : undefined);
      return arr.join("");
    }, [SEL("ci", "忽略大小写", "non", [{ value: "non", label: "区分大小写" }, { value: "oui", label: "忽略大小写" }])]),

  runOp("dcode-extras-2026-10/txt-sortlist", CAT, "列表排序（Tri de Liste）", "按行排序：字典序 / 数字序 / 长度序，可倒序、去重",
    (t, p) => {
      const mode = String((p && p.mode) || "lex");
      const desc = String((p && p.desc) || "non") === "oui";
      const dedup = String((p && p.dedup) || "non") === "oui";
      let items = parseList(t);
      if (mode === "num") items.sort((a, b) => Number(a) - Number(b) || a.localeCompare(b));
      else if (mode === "len") items.sort((a, b) => a.length - b.length || a.localeCompare(b));
      else items.sort((a, b) => a.localeCompare(b, "zh-Hans-u-co-pinyin"));
      if (desc) items.reverse();
      if (dedup) items = [...new Set(items)];
      return items.join("\n");
    }, [SEL("mode", "排序方式", "lex", [{ value: "lex", label: "字典序" }, { value: "num", label: "数字序" }, { value: "len", label: "长度序" }]), SEL("desc", "倒序", "non", [{ value: "non", label: "升序" }, { value: "oui", label: "降序" }]), SEL("dedup", "去重", "non", [{ value: "non", label: "保留重复" }, { value: "oui", label: "去重" }])]),

  runOp("dcode-extras-2026-10/txt-duplicates", CAT, "重复项检测（Doublons）", "找出列表中重复出现的项及次数；可选输出去重后的列表",
    (t, p) => {
      const items = parseList(t);
      if (!items.length) throw new Error("需要每行一项的列表");
      const cnt = new Map();
      for (const x of items) cnt.set(x, (cnt.get(x) || 0) + 1);
      const dups = [...cnt.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
      const uniq = [...cnt.keys()];
      return `共 ${items.length} 项，去重后 ${uniq.length} 项，重复 ${dups.length} 种：\n` +
        (dups.map(([x, c]) => `${x} × ${c}`).join("\n") || "（无重复）") +
        (String((p && p.uniq) || "non") === "oui" ? `\n\n去重列表：\n${uniq.join("\n")}` : "");
    }, [SEL("uniq", "附去重列表", "non", [{ value: "non", label: "不附" }, { value: "oui", label: "附上" }])]),

  runOp("dcode-extras-2026-10/txt-despace", CAT, "空白处理（Suppression des Espaces）", "删除全部空格 / 全部空白 / 压缩连续空格 / 每行首尾去空白",
    (t, p) => {
      const mode = String((p && p.mode) || "all");
      const s = String(t);
      if (mode === "spaces") return s.replace(/ /g, "");
      if (mode === "all") return s.replace(/\s+/g, "");
      if (mode === "squeeze") return s.replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
      if (mode === "trim") return s.split(/\r?\n/).map((l) => l.trim()).join("\n");
      throw new Error(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "all", [{ value: "spaces", label: "删空格" }, { value: "all", label: "删全部空白" }, { value: "squeeze", label: "压缩连续空白" }, { value: "trim", label: "逐行去首尾空白" }])]),

  runOp("dcode-extras-2026-10/txt-blocks", CAT, "分块切分（Blocs de Lettres）", "按每块 N 字符切分并用分隔符连接（可选反向：先去分隔再并回）",
    (t, p) => {
      const n = Number((p && p.size) || 5);
      const sep = String((p && p.sep) || " ");
      const dir = String((p && p.dir) || "cut");
      const s = String(t);
      if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("块大小需为 1..1000");
      if (dir === "cut") {
        const out = [];
        for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
        return out.join(sep);
      }
      return s.split(sep).join("");
    }, [P("size", "块大小", "5"), P("sep", "分隔符", " "), SEL("dir", "方向", "cut", [{ value: "cut", label: "切块" }, { value: "join", label: "并块" }])]),

  runOp("dcode-extras-2026-10/txt-joindelim", CAT, "换分隔符（Virgules 等）", "把多行列表用指定分隔符并成一行（默认逗号）；也可反向：按分隔符拆行",
    (t, p) => {
      const sep = String((p && p.sep) || ", ");
      const dir = String((p && p.dir) || "join");
      if (dir === "join") return parseList(t).join(sep);
      const first = [...sep][0] || ",";
      return String(t).split(first === "," ? /,\s*/ : new RegExp(sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")).map((x) => x.trim()).filter(Boolean).join("\n");
    }, [P("sep", "分隔符", ", "), SEL("dir", "方向", "join", [{ value: "join", label: "并成一行" }, { value: "split", label: "拆成多行" }])]),

  runOp("dcode-extras-2026-10/txt-zeropad", CAT, "前导零（Zéros Initiaux）", "把列表中每个数字补零到指定位数（可反向去前导零）",
    (t, p) => {
      const w = Number((p && p.width) || 4);
      const strip = String((p && p.dir) || "pad") === "strip";
      if (!Number.isInteger(w) || w < 1 || w > 64) throw new Error("位数需为 1..64");
      return String(t).split(/\r?\n/).map((line) =>
        line.replace(/-?\d+/g, (num) => {
          if (strip) return num.replace(/^(-?)0+(?=\d)/, "$1");
          const neg = num.startsWith("-");
          const body = neg ? num.slice(1) : num;
          if (body.length >= w) return num;
          return (neg ? "-" : "") + body.padStart(w, "0");
        })
      ).join("\n");
    }, [P("width", "位数", "4"), SEL("dir", "方向", "pad", [{ value: "pad", label: "补零" }, { value: "strip", label: "去前导零" }])]),

  runOp("dcode-extras-2026-10/txt-accents", CAT, "重音剥离（Accents/Diacritiques）", "NFD 分解后删除组合重音符（é→e、ç→c）；双向无（信息有损，只做正向）",
    (t) => String(t).normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC")),

  runOp("dcode-extras-2026-10/txt-vowelcons", CAT, "元音/辅音处理（Voyelles & Consonnes）", "统计/提取/删除元音与辅音（拉丁字母域）",
    (t, p) => {
      const mode = String((p && p.mode) || "stats");
      const s = String(t);
      const V = /[aeiouyà-ÿ]/i, C = /[a-zà-ÿ]/i;
      const vowels = [...s].filter((c) => V.test(c));
      const cons = [...s].filter((c) => C.test(c) && !V.test(c));
      if (mode === "stats") return `元音 ${vowels.length} 个：${vowels.join("")}\n辅音 ${cons.length} 个：${cons.join("")}\n（y 计入元音口径）`;
      if (mode === "keepV") return vowels.join("");
      if (mode === "keepC") return cons.join("");
      if (mode === "dropV") return [...s].filter((c) => !V.test(c)).join("");
      if (mode === "dropC") return [...s].filter((c) => !(C.test(c) && !V.test(c))).join("");
      throw new Error(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "stats", [{ value: "stats", label: "统计" }, { value: "keepV", label: "只留元音" }, { value: "keepC", label: "只留辅音" }, { value: "dropV", label: "删元音" }, { value: "dropC", label: "删辅音" }])]),

  runOp("dcode-extras-2026-10/txt-count", CAT, "文本统计（Compteur）", "字符数/去空白字符数/单词数/行数/段落数/句数",
    (t) => {
      const s = String(t);
      const chars = [...s].length;
      const noWs = [...s.replace(/\s+/g, "")].length;
      const words = (s.match(/[\p{L}\p{N}'’-]+/gu) || []).length;
      const lines = s === "" ? 0 : s.split(/\r?\n/).length;
      const paras = s.trim() ? s.trim().split(/\n\s*\n/).length : 0;
      const sents = (s.match(/[.!?。！？]+(\s|$)/g) || []).length;
      return `字符数（含空白）= ${chars}\n字符数（去空白）= ${noWs}\n单词数 = ${words}\n行数 = ${lines}\n段落数 = ${paras}\n句数（按标点计）= ${sents}`;
    }),

  runOp("dcode-extras-2026-10/txt-extract", CAT, "按位置取字符（Extraction de Lettres）", "取每第 N 个字符 / 取指定序号集 / 首字母 / 尾字母",
    (t, p) => {
      const mode = String((p && p.mode) || "every");
      const s = String(t).replace(/\r?\n/g, "\n");
      if (mode === "every") {
        const n = Number((p && p.n) || 2);
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new Error("步长需为 1..1000");
        const out = [];
        for (let i = 0; i < s.length; i += n) out.push(s[i]);
        return out.join("");
      }
      if (mode === "first") return s.split("\n").map((l) => l[0] ?? "").join("");
      if (mode === "last") return s.split("\n").map((l) => l[l.length - 1] ?? "").join("");
      if (mode === "indices") {
        const idx = String((p && p.n) || "1,3,5").split(/[,\s]+/).map(Number).filter((x) => Number.isInteger(x));
        if (!idx.length) throw new Error("需要序号列表，如 1,3,5（1 起）");
        return idx.map((i) => s[i - 1] ?? "").join("");
      }
      throw new Error(`未知模式 ${mode}`);
    }, [SEL("mode", "模式", "every", [{ value: "every", label: "每第 N 个" }, { value: "indices", label: "按序号集" }, { value: "first", label: "每行首字符" }, { value: "last", label: "每行尾字符" }]), P("n", "步长或序号集", "2")]),

  runOp("dcode-extras-2026-10/txt-acrostic", CAT, "藏头提取（Acrostiche）", "提取每行首字母 / 尾字母 / 第 N 字母拼串",
    (t, p) => {
      const mode = String((p && p.mode) || "first");
      const lines = parseList(t);
      if (!lines.length) throw new Error("需要多行文本");
      if (mode === "first") return lines.map((l) => l[0]).join("");
      if (mode === "last") return lines.map((l) => l[l.length - 1]).join("");
      const n = Number((p && p.n) || 2);
      return lines.map((l) => l[n - 1] ?? "").join("");
    }, [SEL("mode", "位置", "first", [{ value: "first", label: "首字母" }, { value: "last", label: "尾字母" }, { value: "nth", label: "第 N 字母" }]), P("n", "N（nth 模式）", "2")]),

  runOp("dcode-extras-2026-10/txt-setops", CAT, "列表交并差（Communs / Non Communs）", "两段列表（以 === 行分隔）求交集/并集/差集/对称差",
    (t, p) => {
      const mode = String((p && p.mode) || "inter");
      const parts = String(t).split(/^\s*={3,}\s*$/m);
      if (parts.length !== 2) throw new Error("两段列表用一行 === 分隔");
      const a = [...new Set(parseList(parts[0]))], b = [...new Set(parseList(parts[1]))];
      const sb = new Set(b);
      let res;
      if (mode === "inter") res = a.filter((x) => sb.has(x));
      else if (mode === "union") res = [...new Set([...a, ...b])];
      else if (mode === "diffAB") res = a.filter((x) => !sb.has(x));
      else if (mode === "diffBA") res = b.filter((x) => !new Set(a).has(x));
      else if (mode === "sym") res = [...a.filter((x) => !sb.has(x)), ...b.filter((x) => !new Set(a).has(x))];
      else throw new Error(`未知模式 ${mode}`);
      return `A ${a.length} 项 / B ${b.length} 项 → 结果 ${res.length} 项：\n${res.join("\n") || "（空）"}`;
    }, [SEL("mode", "集合运算", "inter", [{ value: "inter", label: "交集" }, { value: "union", label: "并集" }, { value: "diffAB", label: "A−B" }, { value: "diffBA", label: "B−A" }, { value: "sym", label: "对称差" }])]),

  runOp("dcode-extras-2026-10/txt-common", CAT, "最长公共子串（Point Commun）", "两段文本（以 === 行分隔）的最长公共子串",
    (t) => {
      const parts = String(t).split(/^\s*={3,}\s*$/m);
      if (parts.length !== 2) throw new Error("两段文本用一行 === 分隔");
      const r = longestCommonSubstr(parts[0].trim(), parts[1].trim());
      return r ? `最长公共子串（${[...r].length} 字符）：${r}` : "无公共子串";
    }),

  runOp("dcode-extras-2026-10/txt-diff", CAT, "文本差异（Différences）", "两段文本（以 === 行分隔）的行级 LCS diff：− 删除 / + 新增 / = 相同",
    (t) => {
      const parts = String(t).replace(/\r/g, "").split(/^\s*={3,}\s*$/m);
      if (parts.length !== 2) throw new Error("两段文本用一行 === 分隔");
      const clean = (s) => s.split("\n").map((x) => x.replace(/\s+$/, "")).filter((x, i, arr) => x !== "" || i < arr.length - 1);
      const d = lineDiff(clean(parts[0].replace(/^\n+/, "").replace(/\n+$/, "")), clean(parts[1].replace(/^\n+/, "").replace(/\n+$/, "")));
      return d.map((x) => (x.t === "=" ? "  " : x.t) + " " + x.line).join("\n") + `\n\n统计：相同 ${d.filter((x) => x.t === "=").length} 行，删除 ${d.filter((x) => x.t === "-").length} 行，新增 ${d.filter((x) => x.t === "+").length} 行`;
    }),

  runOp("dcode-extras-2026-10/txt-draw", CAT, "抽签/洗牌（Tirage au Sort）", "列表随机排序或无放回抽 K 个（统一随机源）",
    (t, p) => {
      const items = parseList(t);
      if (!items.length) throw new Error("需要每行一项的候选列表");
      if (items.length > 100000) throw new Error("最多 100000 项");
      const k = Number((p && p.k) || 0);
      const mixed = shuffled(items);
      if (!k) return mixed.join("\n");
      if (!Number.isInteger(k) || k < 1 || k > items.length) throw new Error(`抽取个数需为 1..${items.length}`);
      return mixed.slice(0, k).join("\n");
    }, [P("k", "抽取个数（0=全洗）", "0")]),

  runOp("dcode-extras-2026-10/txt-keysmash", CAT, "键盘乱敲生成（Keysmash）", "按 ASDF/JKL 行随机生成「手滑乱敲」串（长度可调，统一随机源）",
    (t, p) => {
      const len = Math.min(Number((p && p.len) || 20) || 20, 500);
      const chars = "asdfghjkl";
      let out = "";
      for (let i = 0; i < len; i++) out += chars[randInt(chars.length)];
      return out;
    }, [P("len", "长度 ≤500", "20")]),

  runOp("dcode-extras-2026-10/txt-typos", CAT, "打字错误生成（Fautes de Frappe）", "对输入文本注入邻键替换/相邻交换/重复字母类错字（AZERTY 或 QWERTY 布局）",
    (t, p) => {
      const layout = String((p && p.layout) || "azerty");
      const rate = Math.min(Number((p && p.rate) || 0.2) || 0.2, 0.9);
      const nb = kbNeighbors(layout);
      const s = [...String(t)];
      const out = [];
      for (let i = 0; i < s.length; i++) {
        const c = s[i], lo = c.toLowerCase();
        if (!nb[lo] || randInt(1000) / 1000 > rate) { out.push(c); continue; }
        const pick = nb[lo][randInt(nb[lo].length)];
        const r = randInt(3);
        if (r === 0) out.push(c === lo ? pick : pick.toUpperCase());
        else if (r === 1 && i + 1 < s.length && /[a-z]/i.test(s[i + 1])) { out.push(s[i + 1], c); i++; }
        else out.push(c, c);
      }
      return out.join("");
    }, [SEL("layout", "键盘布局", "azerty", [{ value: "azerty", label: "AZERTY" }, { value: "qwerty", label: "QWERTY" }]), P("rate", "错误率 0-0.9", "0.2")]),

  runOp("dcode-extras-2026-10/txt-mixletters", CAT, "逐词打乱字母（Lettres Mélangées）", "每个单词的字母随机打乱（保留分隔符）；确定性模式按字典序",
    (t, p) => {
      const fixed = String((p && p.mode) || "fixe") === "fixe";
      return String(t).replace(/[A-Za-zà-ÿ]{2,}/g, (w) => {
        const mid = [...w].sort((a, b) => (fixed ? (a < b ? -1 : 1) : randInt(2) * 2 - 1));
        return mid.join("");
      });
    }, [SEL("mode", "模式", "fixe", [{ value: "fixe", label: "确定（排序）" }, { value: "random", label: "随机" }])]),

  runOp("dcode-extras-2026-10/txt-mixwords", CAT, "词序打乱（Mélangeur de Mots）", "把文本按词切分后随机打乱词序、以单空格重组（分隔符归一化）",
    (t) => {
      const words = String(t).split(/\s+/).filter(Boolean);
      if (!words.length) throw new Error("需要含词的文本");
      return shuffled(words).join(" ");
    }),

  runOp("dcode-extras-2026-10/txt-wordpyramid", CAT, "单词金字塔（Pyramide de Mots）", "每行去掉一个字母（尾/首/随机）逐行缩短成塔",
    (t, p) => {
      const mode = String((p && p.mode) || "last");
      let w = String(t).trim();
      if (!w || /\s/.test(w)) throw new Error("需要单个单词");
      if (w.length > 60) throw new Error("单词过长（≤60）");
      const out = [w];
      while (w.length > 1) {
        const i = mode === "last" ? w.length - 1 : mode === "first" ? 0 : randInt(w.length);
        w = w.slice(0, i) + w.slice(i + 1);
        out.push(w);
      }
      return out.join("\n");
    }, [SEL("mode", "去掉哪个", "last", [{ value: "last", label: "末字母" }, { value: "first", label: "首字母" }, { value: "random", label: "随机" }])]),

  runOp("dcode-extras-2026-10/txt-piglatin", CAT, "Pig Latin（儿童黑话）", "辅音簇移尾 + ay（首个元音起算）；以元音开头只加 way；双向",
    (t, p) => {
      const dir = String((p && p.dir) || "enc");
      const VOW = "aeiouy";
      if (dir === "enc") {
        return String(t).replace(/[A-Za-z]+/g, (w) => {
          const lower = w.toLowerCase();
          const up = w[0] === w[0].toUpperCase();
          const m = lower.match(/^[^aeiouy]*/)[0];
          let res;
          if (m.length === 0) res = lower + "way";
          else res = lower.slice(m.length) + m + "ay";
          return up ? res[0].toUpperCase() + res.slice(1) : res;
        });
      }
      return String(t).replace(/[A-Za-z]+/g, (w) => {
        const lower = w.toLowerCase();
        const up = w[0] === w[0].toUpperCase();
        let res = lower;
        if (/way$/.test(lower) && VOW.includes(lower[0])) res = lower.slice(0, -3);
        else if (/ay$/.test(lower)) {
          const stem = lower.slice(0, -2);
          const mm = stem.match(/[^aeiouy]+$/);
          if (mm) res = mm[0] + stem.slice(0, -mm[0].length);
          else res = stem;
        } else throw new Error(`词「${w}」不像 Pig Latin（应以 ay/way 结尾）`);
        return up ? res[0].toUpperCase() + res.slice(1) : res;
      });
    }, [SEL("dir", "方向", "enc", [{ value: "enc", label: "编码" }, { value: "dec", label: "解码" }])]),

  runOp("dcode-extras-2026-10/txt-javanais", CAT, "Javanais（法语行话）", "在每个音节辅音后（词首辅音后也插）插入 «av»；解码删除；cat → cavat",
    (t, p) => {
      const dir = String((p && p.dir) || "enc");
      if (dir === "enc") {
        return String(t).replace(/[bcdfghjklmnpqrstvwxz]+(?=[aeiouy])/gi, (m) => m + "av");
      }
      // 解码只删「辅音后随且后接元音」的 av（词内原生 av 若不满足该形态则保留）
      return String(t).replace(/([bcdfghjklmnpqrstvwxz])av(?=[aeiouy])/gi, "$1");
    }, [SEL("dir", "方向", "enc", [{ value: "enc", label: "编码" }, { value: "dec", label: "解码" }])]),
];
