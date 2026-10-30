/*
 * regexTool.js — 通用正则提取 / 替换（单向 run，cat=text）。
 *
 * 一个 op 承载两种形态（同 railFence 的 mode 参数惯例）：
 *   extract：按 pattern/flags 全局匹配，按 group 取整段/第 n 组/全部组，去重后以 sep 连接；
 *   replace：按 pattern/flags 匹配，用 replacement 展开 $1..$9 / $& / $$ 后替换全文。
 *
 * 产物协议：只返回字符串。本 op 不参与一键解码（无 detect/magicParams），
 * 因此不受「返回 {text,files} 会破坏 Worker 路径」的约束影响；仍坚持返回裸字符串，
 * 保证后续配方链与一键解码可以把它当普通文本 op 处理。
 *
 * 安全模型（本文件的核心）：主线程 RegExp.exec 一旦进入灾难性回溯就无法从 JS 侧中断，
 * 计时器/AbortSignal 都只能等 exec 返回后才生效，所以不能用「超时兜底」。这里改为
 * **编译前结构白名单**：先扫描 pattern 的语法结构，拒绝已知会产生指数/高次回溯的构造，
 * 再交给 V8 编译。白名单是保守子集，不是完备的复杂度判定（见报告「残留风险」）。
 *
 * 依据：
 *   - ECMA-262 §22.2.2 Pattern Semantics（量词、捕获组、断言、反向引用的语义）；
 *   - ECMA-262 §22.2.7.2 RegExp.prototype.exec（lastIndex 与零宽匹配推进规则）；
 *   - MDN RegExp / RegExp.prototype.exec（标志位与替换串 $ 语法）；
 *   - OWASP Regular expression Denial of Service（嵌套量词/反向引用/后行断言是典型 ReDoS 源）。
 *
 * 红线：纯本地计算，零外发；不读 DOM、不读存储、不取随机字节。
 */

import { register } from "./registry.js";

// 与 UI 层有界引擎（src/ui/targetRegexEngine.js 的 DEFAULT_LIMITS）保持同一口径：
// budgetMs 只属于 Worker 宿主，core 侧没有可中断的执行环境，故此处只对齐长度/条数上限。
const MAX_PATTERN_LEN = 256;
const MAX_INPUT_LEN = 100000;
const MAX_MATCHES = 5000;

// 允许的标志子集：g 全局、i 忽略大小写、m 多行、s 点匹配换行、u Unicode。
// y（sticky）会从 lastIndex 锚定，改变提取/替换语义；d（hasIndices）本工具用不到，均显式拒绝。
const ALLOWED_FLAG_CHARS = "gimsu";

/** 统一抛错：把规则名、位置、pattern 原文与原因拼成一条可读信息。 */
function reject(rule, pos, pattern, detail) {
  throw new Error(`${rule}（位置 ${pos}，模式 ${JSON.stringify(pattern)}）：${detail}`);
}

/**
 * 读取 at 处的量词并分类，返回 { end, kind, max } 或 null。
 *   kind='exact'     —— {m} / {m,m}：每次迭代消费的字符数固定，嵌套安全；
 *   kind='variable'  —— ? / {m,n}（m≠n）：长度可变但上界有限，嵌套时按预算乘积兜底；
 *   kind='unbounded' —— * / + / {m,}：上界随输入增长，嵌套在变长子表达式上即灾难。
 * 惰性修饰 ? 一并吞掉（ECMA-262 §22.2.2.1 Term）。
 */
function readQuantifier(pattern, at) {
  const ch = pattern[at];
  if (ch === "*" || ch === "+") {
    return { end: at + (pattern[at + 1] === "?" ? 2 : 1), kind: "unbounded", max: Infinity };
  }
  if (ch === "?") {
    return { end: at + (pattern[at + 1] === "?" ? 2 : 1), kind: "variable", max: 1 };
  }
  if (ch === "{") {
    const m = /^\{(\d+)(?:,(\d*))?\}/.exec(pattern.slice(at));
    if (m) {
      const bodyEnd = at + m[0].length;
      const end = bodyEnd + (pattern[bodyEnd] === "?" ? 1 : 0);
      const lo = Number(m[1]);
      if (m[2] === undefined) return { end, kind: "exact", max: lo };
      if (m[2] === "") return { end, kind: "unbounded", max: Infinity };
      const hi = Number(m[2]);
      return { end, kind: hi === lo ? "exact" : "variable", max: hi };
    }
  }
  return null;
}

// 嵌套量词的回溯预算上限：变长内层 × 有界外层时，最坏尝试次数 = 各层上界之积。
// 定长内层（{m}）不参与乘法判危——每轮消费长度固定，切分方式唯一。
const NESTED_BUDGET = 10000;

// 首字符判定用的「非字面量」字符集：命中即视为首字符未知（保守处理）。
const NOT_LITERAL = new Set([".", "[", "(", "\\", "^", "$", "|", ")", "*", "+", "?", "{", "}"]);

/**
 * 若 i 处是一个可确定的字面量首字符则返回它，否则返回 null（未知）。
 * 只认「裸字面量」：转义、字符类、分组、通配符、锚点一律返回 null。
 */
function firstLiteralChar(pattern, i) {
  const ch = pattern[i];
  if (ch === undefined || NOT_LITERAL.has(ch)) return null;
  return ch;
}

/**
 * 分支首字符是否两两不同。
 * 任一分支首字符未知（null/undefined）即视为可能重叠——宁可保守拒绝，不放过歧义。
 * 首字符互斥是「同一位置最多一条分支可行」的充分条件，故可据此排除歧义回溯。
 */
function altsDistinct(alts) {
  if (alts.length <= 1) return true;
  const seen = new Set();
  for (const a of alts) {
    if (a === null || a === undefined) return false;
    if (seen.has(a)) return false;
    seen.add(a);
  }
  return true;
}

/**
 * 结构白名单扫描：拒绝反向引用、危险嵌套量词、后行断言、非标准扩展，并统计捕获组数量。
 *
 * 判定依据（结构性，非启发式）：
 *   - 逐字符扫描，跳过转义序列与字符类，避免把字面量 * + ? { 误判成量词；
 *   - 每个分组帧记录 varLen（子树能否匹配不同长度的串）与 rep（有界上界之积）；
 *   - 分组被量词修饰时：
 *       · 内层 varLen 且外层 unbounded（* / + / {m,}）→ 指数回溯，拒绝；
 *       · 内层 varLen 且外层 variable（{m,n}）→ 按 rep 乘积超 NESTED_BUDGET 拒绝；
 *       · 内层定长（全是 {m}）→ 每轮消费长度固定，切分唯一，放行（([0-9a-f]{2})+ 属此类）；
 *   - 交替：分支首字符两两不同才视为无歧义；(a|a)* / (a|aa)+ 这类重叠分支在外层量词下拒绝；
 *   - 分组闭合后把 varLen 上抛，使 ((a{2})+)* 这种「危险藏在里层」的结构在祖先被量词修饰时同样命中。
 *
 * 这是保守子集白名单，不是完备的复杂度判定：交替只查首字符，`(abc|abd)+` 这类
 * 「首字符相同但后缀可分」的写法会被误拒（已如实记入报告残留风险）。
 *
 * @param {string} pattern 正则源文本
 * @param {string} flags 已校验的标志串（u 决定 \u{...} / \p{...} 是否按转义整体跳过）
 * @returns {number} 捕获组数量（含命名组，不含 (?: (?= (?!）
 */
function scanPattern(pattern, flags) {
  const unicode = flags.includes("u");
  let groupCount = 0;
  let i = 0;
  const n = pattern.length;
  // 根帧：代表整个模式这一层，start=-1 表示不是分组
  const stack = [{ varLen: false, rep: 1, start: -1, alts: [undefined], altOpen: false }];

  while (i < n) {
    const ch = pattern[i];
    const frame = stack[stack.length - 1];

    // 记录当前分支的首字符（只取第一个原子；锚点与量词不算原子）
    if (!frame.altOpen && ch !== "|" && ch !== ")" && ch !== "^" && ch !== "$" && !readQuantifier(pattern, i)) {
      frame.alts[frame.alts.length - 1] = firstLiteralChar(pattern, i);
      frame.altOpen = true;
    }

    // ---- 转义序列：整体跳过，避免把 \1、\{、\u{...} 误读 ----
    if (ch === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) {
        // 交给 V8 产出原始错误文本（compile 内部会带上 pattern 与 flags 再抛）
        compile(pattern, flags);
        throw new Error(`正则语法错误：模式以孤立反斜杠结尾（模式 ${JSON.stringify(pattern)}）`);
      }
      // 规则 1：反向引用 \1..\9（\0 是 NUL 转义，不在此列）。
      if (next >= "1" && next <= "9") {
        reject("不支持反向引用 \\" + next, i, pattern,
          "反向引用会让匹配代价随输入长度放大，可能触发灾难性回溯，已拒绝");
      }
      // 命名反向引用 \k<name> 与 \1 同源，一并拒绝。
      if (next === "k" && pattern[i + 2] === "<") {
        reject("不支持命名反向引用 \\k<...>", i, pattern,
          "按名反向引用与按序号反向引用同源，会让匹配代价随输入长度放大，已拒绝");
      }
      // u 模式下 \u{...} 与 \p{...}/\P{...} 是单个原子；不整体跳过会把 {41} 误当量词。
      if (unicode && (next === "u" || next === "p" || next === "P") && pattern[i + 2] === "{") {
        const close = pattern.indexOf("}", i + 3);
        i = close === -1 ? n : close + 1;
        continue;
      }
      // \cX 占 3 个字符，其余转义占 2 个。
      i += next === "c" && i + 2 < n ? 3 : 2;
      continue;
    }

    // ---- 字符类：整体跳过；类内的 \1 是八进制转义而不是反向引用 ----
    if (ch === "[") {
      i++;
      if (pattern[i] === "^") i++;
      // [] 是空类、[^] 是「任意字符」；首个 ] 直接闭合，不当作内容。
      if (pattern[i] === "]") {
        i++;
        continue;
      }
      while (i < n && pattern[i] !== "]") {
        i += pattern[i] === "\\" ? 2 : 1;
      }
      if (i >= n) {
        compile(pattern, flags);
        throw new Error(`正则语法错误：字符类缺少右方括号（模式 ${JSON.stringify(pattern)}）`);
      }
      i++;
      continue;
    }

    // ---- 交替：开一条新分支 ----
    if (ch === "|") {
      frame.alts.push(undefined);
      frame.altOpen = false;
      i++;
      continue;
    }

    // ---- 分组前缀 ----
    if (ch === "(") {
      if (pattern[i + 1] === "?") {
        const c2 = pattern[i + 2];
        if (c2 === ":" || c2 === "=" || c2 === "!") {
          stack.push({ varLen: false, rep: 1, start: i, alts: [undefined], altOpen: false });
          i += 3;
          continue;
        }
        if (c2 === "<") {
          const c3 = pattern[i + 3];
          // 规则 3：后行断言 (?<=...) / (?<!...)，回溯代价不可控。
          if (c3 === "=" || c3 === "!") {
            reject("不支持后行断言", i, pattern,
              "后行断言 (?<=...) / (?<!...) 需要反向扫描历史输入，回溯代价不可控，已拒绝");
          }
          const close = pattern.indexOf(">", i + 3);
          if (close === -1) {
            compile(pattern, flags);
            throw new Error(`正则语法错误：命名分组缺少右尖括号（模式 ${JSON.stringify(pattern)}）`);
          }
          groupCount++;
          stack.push({ varLen: false, rep: 1, start: i, alts: [undefined], altOpen: false });
          i = close + 1;
          continue;
        }
        // 规则 5：条件式 (?()、原子组 (?>)、注释组 (?#)、Python 命名组 (?P<)、内联修饰 (?i) 等。
        reject("不支持的语法 " + JSON.stringify(pattern.slice(i, i + 3)), i, pattern,
          "仅支持 (?: (?= (?! (?<name> 四种分组前缀，其余扩展语法一律拒绝");
      }
      groupCount++;
      stack.push({ varLen: false, rep: 1, start: i, alts: [undefined], altOpen: false });
      i++;
      continue;
    }

    // ---- 分组结束：按「内层是否变长」与「外层量词类别」判定 ----
    if (ch === ")") {
      if (stack.length === 1) {
        compile(pattern, flags);
        throw new Error(`正则语法错误：多余的右括号（位置 ${i}，模式 ${JSON.stringify(pattern)}）`);
      }
      const inner = stack.pop();
      i++;
      const q = readQuantifier(pattern, i);
      const ambiguous = !altsDistinct(inner.alts);
      const varLen = inner.varLen || ambiguous;
      if (q) {
        if (q.kind === "unbounded" && varLen) {
          throw new Error(
            `不支持嵌套量词（分组起点 ${inner.start}，量词位置 ${i}，模式 ${JSON.stringify(pattern)}）：` +
            "无界量词（* / + / {m,}）作用在长度可变的分组上（如 (a+)+ / (a*)* / (a|aa)+），" +
            "匹配尝试次数随输入指数增长，已拒绝"
          );
        }
        if (q.kind === "variable" && varLen) {
          const budget = inner.rep * q.max;
          if (!(budget <= NESTED_BUDGET)) {
            throw new Error(
              `不支持嵌套量词（分组起点 ${inner.start}，量词位置 ${i}，模式 ${JSON.stringify(pattern)}）：` +
              `有界嵌套的最坏尝试次数 ${inner.rep}×${q.max} 超过预算上限 ${NESTED_BUDGET}，已拒绝`
            );
          }
        }
        i = q.end;
      }
      const parent = stack[stack.length - 1];
      // varLen 上抛：分组被变长/无界量词修饰后，它本身也成了变长原子
      parent.varLen = parent.varLen || varLen || (q ? q.kind !== "exact" : false);
      if (q) parent.rep = parent.rep * (q.max === Infinity ? Infinity : q.max);
      // 分组作为父帧的一个原子：首字符未知
      if (!parent.altOpen) {
        parent.alts[parent.alts.length - 1] = null;
        parent.altOpen = true;
      }
      continue;
    }

    // ---- 普通量词：标记本层变长并累计有界上界 ----
    const q = readQuantifier(pattern, i);
    if (q) {
      frame.varLen = frame.varLen || q.kind !== "exact";
      if (q.max === Infinity) frame.rep = Infinity;
      else if (frame.rep !== Infinity) frame.rep = frame.rep * q.max;
      i = q.end;
      continue;
    }

    i++;
  }

  if (stack.length !== 1) {
    compile(pattern, flags);
    throw new Error(`正则语法错误：分组括号未配平（模式 ${JSON.stringify(pattern)}）`);
  }
  return groupCount;
}

/** 校验并归一 flags；y/d 与未知字符显式拒绝，重复字符也拒绝（避免 V8 的泛化报错）。 */
function normalizeFlags(raw) {
  const flags = raw == null ? "g" : String(raw);
  const seen = new Set();
  for (const ch of flags) {
    if (ch === "y") {
      throw new Error(
        `不支持 flags 中的 y（sticky，flags ${JSON.stringify(flags)}）：粘性匹配从 lastIndex 起锚定，` +
        "会改变提取/替换语义，已拒绝"
      );
    }
    if (ch === "d") {
      throw new Error(`不支持 flags 中的 d（hasIndices，flags ${JSON.stringify(flags)}）：本工具不使用匹配下标数组，已拒绝`);
    }
    if (!ALLOWED_FLAG_CHARS.includes(ch)) {
      throw new Error(`不支持的 flags 字符 ${JSON.stringify(ch)}（允许 g i m s u，flags ${JSON.stringify(flags)}）`);
    }
    if (seen.has(ch)) {
      throw new Error(`flags 重复字符 ${JSON.stringify(ch)}（flags ${JSON.stringify(flags)}）`);
    }
    seen.add(ch);
  }
  return flags;
}

/** 编译正则；失败时保留 V8 原始错误文本与 pattern 原文（不吞异常）。 */
function compile(pattern, flags) {
  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`正则语法错误：${reason}（模式 ${JSON.stringify(pattern)}，flags ${JSON.stringify(flags)}）`);
  }
}

/** sep 参数的字面量转义：\n \t \r \\ 各还原成对应字符，其余反斜杠原样保留。 */
function unescapeSeparator(raw) {
  const s = String(raw == null ? "\\n" : raw);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== "\\" || i + 1 >= s.length) {
      out += s[i];
      continue;
    }
    const next = s[i + 1];
    if (next === "n") { out += "\n"; i++; }
    else if (next === "t") { out += "\t"; i++; }
    else if (next === "r") { out += "\r"; i++; }
    else if (next === "\\") { out += "\\"; i++; }
    else out += s[i];
  }
  return out;
}

/**
 * 展开替换串：$$ → $，$& → 整段匹配，$1..$9 → 对应捕获组。
 * 组号超出模式实际捕获组数、或 $ 后不是上述形式时，**原样保留**（不静默吞成空串）。
 * 组存在但本次未参与匹配时按 JS 语义给空串（ECMA-262 §22.2.6.11 GetSubstitution）。
 */
function expandReplacement(template, match) {
  const captureCount = match.length - 1;
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template[i];
    if (ch !== "$") { out += ch; continue; }
    const next = template[i + 1];
    if (next === "$") { out += "$"; i++; continue; }
    if (next === "&") { out += match[0]; i++; continue; }
    if (next >= "1" && next <= "9") {
      const idx = Number(next);
      if (idx <= captureCount) {
        const value = match[idx];
        out += value == null ? "" : value;
      } else {
        out += "$" + next; // 未知引用原样保留
      }
      i++;
      continue;
    }
    out += "$"; // $0、$`、$'、末尾 $ 等一律原样保留
  }
  return out;
}

/** 零宽结果的统一报错：全局 exec 遇到空匹配会原地打转，必须显式失败而不是跳过。 */
function zeroWidthError(pattern, index) {
  return new Error(
    `匹配到零宽结果（位置 ${index}，模式 ${JSON.stringify(pattern)}）：` +
    "空匹配无法推进全局迭代，已拒绝；请给模式加上可消费字符的原子"
  );
}

register({
  id: "regexTool",
  cat: "text",
  name: "通用正则提取 / 替换",
  desc:
    "按正则做提取或替换。extract：全局匹配后按 group 取整段(0)/第 n 组(1..n)/全部组(all，\\t 连接)，" +
    "可选 dedupe 保首次顺序、firstOnly 只取首个，结果用 sep 连接（支持 \\n \\t 转义）；" +
    "replace：用 $1..$9、$&、$$ 展开替换全文，未知 $x 原样保留。空模式、非法正则、零匹配一律报错，" +
    "不静默返回原文；编译前结构白名单拒绝反向引用、嵌套量词、后行断言与非标准扩展",
  params: [
    { key: "mode", label: "模式", type: "select", default: "extract",
      options: [
        { value: "extract", label: "提取（extract）" },
        { value: "replace", label: "替换（replace）" },
      ] },
    { key: "pattern", label: "正则表达式", type: "text", default: "", placeholder: "如 [0-9a-f]{32}（不可为空）" },
    { key: "flags", label: "标志位", type: "text", default: "g", placeholder: "g i m s u 的子集" },
    { key: "group", label: "捕获组（extract）", type: "text", default: "0", placeholder: "0 / 1..n / all" },
    { key: "dedupe", label: "去重（extract）", type: "bool", default: false },
    { key: "firstOnly", label: "仅首个", type: "bool", default: false },
    { key: "sep", label: "结果分隔符（extract）", type: "text", default: "\\n", placeholder: "支持 \\n \\t 转义" },
    { key: "replacement", label: "替换串（replace）", type: "text", default: "", placeholder: "支持 $1..$9、$&、$$" },
  ],
  run(text, p) {
    const opts = p || {};
    const mode = opts.mode == null ? "extract" : String(opts.mode);
    if (mode !== "extract" && mode !== "replace") {
      throw new Error(`未知 mode ${JSON.stringify(mode)}：只支持 extract / replace`);
    }

    const pattern = opts.pattern == null ? "" : String(opts.pattern);
    if (pattern === "") {
      throw new Error("pattern 为空：空模式会在每个位置命中，已拒绝；请填写要提取或替换的正则");
    }
    if (pattern.length > MAX_PATTERN_LEN) {
      throw new Error(`pattern 长度 ${pattern.length} 超过上限 ${MAX_PATTERN_LEN} 字符`);
    }

    const input = text == null ? "" : String(text);
    if (input.length > MAX_INPUT_LEN) {
      throw new Error(`输入长度 ${input.length} 超过上限 ${MAX_INPUT_LEN} 字符`);
    }

    const flags = normalizeFlags(opts.flags);
    const groupCount = scanPattern(pattern, flags);
    const probe = compile(pattern, flags);
    // 规则 4：可空匹配。new RegExp(pattern, flags).test("") 为真 → 全局 exec 会零宽死循环。
    if (probe.test("")) {
      throw new Error(
        `模式可匹配空串（模式 ${JSON.stringify(pattern)}，flags ${JSON.stringify(flags)}）：` +
        "空输入即命中，全局迭代无法推进，已拒绝"
      );
    }

    const firstOnly = opts.firstOnly === true;
    const dedupe = opts.dedupe === true;

    if (mode === "extract") {
      const sep = unescapeSeparator(opts.sep);
      const groupSpec = opts.group == null ? "0" : String(opts.group).trim();
      let groupIndex;
      if (groupSpec === "all") {
        if (groupCount === 0) {
          throw new Error(`group=all 需要模式至少有一个捕获组（模式 ${JSON.stringify(pattern)} 没有捕获组）`);
        }
        groupIndex = -1;
      } else if (/^\d+$/.test(groupSpec)) {
        groupIndex = Number(groupSpec);
        if (groupIndex > groupCount) {
          throw new Error(
            `group=${groupIndex} 超过模式的捕获组数量 ${groupCount}（模式 ${JSON.stringify(pattern)}）`
          );
        }
      } else {
        throw new Error(`group 只支持 0 / 1..n / all（拿到 ${JSON.stringify(groupSpec)}）`);
      }

      // 提取语义要求全局迭代；用户未写 g 时内部补上，不影响 i/m/s/u。
      const re = compile(pattern, flags.includes("g") ? flags : flags + "g");
      const parts = [];
      const seen = new Set();
      let matchCount = 0;
      let m;
      while ((m = re.exec(input)) !== null) {
        if (m[0] === "") throw zeroWidthError(pattern, m.index);
        matchCount++;
        if (matchCount > MAX_MATCHES) {
          throw new Error(`匹配数超过上限 ${MAX_MATCHES} 条（模式 ${JSON.stringify(pattern)}）`);
        }
        let piece;
        if (groupIndex === 0) piece = m[0];
        else if (groupIndex === -1) piece = m.slice(1).map((v) => (v == null ? "" : v)).join("\t");
        else piece = m[groupIndex] == null ? "" : m[groupIndex];

        if (dedupe) {
          if (seen.has(piece)) {
            if (firstOnly) break;
            continue;
          }
          seen.add(piece);
        }
        parts.push(piece);
        if (firstOnly) break;
      }

      if (matchCount === 0) {
        throw new Error(
          `未匹配到任何结果（模式 ${JSON.stringify(pattern)}，flags ${JSON.stringify(flags)}，输入 ${input.length} 字符）`
        );
      }
      return parts.join(sep);
    }

    // replace：默认全局替换；firstOnly 时去掉 g，只替换第一处。
    const replacement = opts.replacement == null ? "" : String(opts.replacement);
    const replaceFlags = firstOnly ? flags.replace(/g/g, "") : (flags.includes("g") ? flags : flags + "g");
    const re = compile(pattern, replaceFlags);
    let out = "";
    let last = 0;
    let count = 0;
    let m;
    while ((m = re.exec(input)) !== null) {
      if (m[0] === "") throw zeroWidthError(pattern, m.index);
      count++;
      if (count > MAX_MATCHES) {
        throw new Error(`替换次数超过上限 ${MAX_MATCHES} 处（模式 ${JSON.stringify(pattern)}）`);
      }
      out += input.slice(last, m.index) + expandReplacement(replacement, m);
      last = m.index + m[0].length;
      if (firstOnly) break;
    }
    if (count === 0) {
      throw new Error(
        `未匹配到任何结果，替换未执行（模式 ${JSON.stringify(pattern)}，flags ${JSON.stringify(flags)}，输入 ${input.length} 字符）`
      );
    }
    return out + input.slice(last);
  },
});
