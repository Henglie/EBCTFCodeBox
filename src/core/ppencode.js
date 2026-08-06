/*
 * ppencode.js — PPEncode（Perl 关键字编码，cat:'text'）。
 *
 * 把任意字节流编码成由 perl 关键字组成的"伪程序"文本：
 *   #!/usr/bin/perl -w
 *   <随机前缀> and print chr <关键字串> and print chr <关键字串> ...
 *
 * 每个字节从预生成字典 codes[byte] 的 3 个候选中随机挑一个（每候选 2-4 字节，
 * 每字节是 words 数组的下标，hex 存储）。算法与参考实现（hiencode ppencode.js）
 * 逐字节一致；扩展为 UTF-8 字节流（参考仅 Latin-1）。
 *
 * decode 状态机：token 化后按 `and print chr` 三连锚点切分，
 * 首锚点前为随机前缀（丢弃），锚点后关键字 → words 下标 → 字节 → UTF-8 还原。
 *
 * 红线：算法层零 UI 依赖；零外发；件内自注册。
 * 契约：register({ id:"ppencode", cat:"text", name, desc, encode, decode })。
 */
import { register } from "./registry.js";
import { ppWords, ppCodes } from "./ppencodeData.js";

// 反向表：候选 hex 串 → 原始字节（768 项零冲突，构造期校验；键统一小写）
const ppRev = (() => {
  const m = new Map();
  for (let c = 0; c < 256; c++) {
    for (const cand of ppCodes[c]) {
      const k = cand.toLowerCase();
      if (m.has(k)) throw new Error("ppencode 字典冲突: " + cand);
      m.set(k, c);
    }
  }
  return m;
})();

/** 单字节 → 关键字串（随机候选）。返回 '' 表示字节越界（本实现按 0-255）。 */
function ppChar(byte) {
  const cands = ppCodes[byte];
  if (!cands || !cands.length) return "";
  const cand = cands[Math.floor(Math.random() * cands.length)];
  let s = "";
  for (let i = 0; i < cand.length; i += 2) {
    s += ppWords[parseInt(cand.substr(i, 2), 16)] + " ";
  }
  return s;
}

/** 编码：文本 → UTF-8 字节流 → perl 关键字伪程序。 */
export function ppEncode(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let r = ppChar(1 + Math.floor(Math.random() * 10)); // 随机前缀（无意义，参考实现行为）
  for (let i = 0; i < bytes.length; i++) {
    const code = ppChar(bytes[i]);
    if (!code) throw new Error("字节 " + bytes[i] + " 无编码候选");
    r += "and print chr " + code;
  }
  return "#!/usr/bin/perl -w\n" + r.trimEnd() + "\n";
}

/** 解码：perl 关键字伪程序 → 字节流 → UTF-8 文本。 */
export function ppDecode(src) {
  const lines = String(src || "").split(/\r?\n/);
  let startLine = 0;
  if (lines[0] && lines[0].trim().startsWith("#!")) startLine = 1; // 跳过 shebang 整行
  const tokens = lines.slice(startLine).join(" ").split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const bytes = [];
  let i = 0;
  // 找第一个 and print chr 锚点；其前为随机前缀（丢弃）
  const isAnchor = (j) => tokens[j] === "and" && tokens[j + 1] === "print" && tokens[j + 2] === "chr";
  while (i + 2 < tokens.length && !isAnchor(i)) i++;
  while (i + 2 < tokens.length) {
    if (!isAnchor(i)) throw new Error("结构错误：期望 and print chr 位于 token " + i);
    i += 3; // 消费 and print chr
    let hex = "";
    while (i < tokens.length && !isAnchor(i)) {
      const idx = ppWords.indexOf(tokens[i]);
      if (idx === -1) throw new Error("未知关键字: " + tokens[i]);
      hex += idx.toString(16).padStart(2, "0");
      i++;
    }
    if (!hex) throw new Error("结构错误：chr 后无关键字");
    const c = ppRev.get(hex);
    bytes.push(c);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}

register({
  id: "ppencode", cat: "text", name: "ppencode",
  desc: "Perl 关键字编码（PPEncode）：字节 → perl 关键字伪程序（256 关键字字典 + 随机候选），运行即输出原文",
  encode: ppEncode,
  decode: ppDecode,
});

export { ppChar };
