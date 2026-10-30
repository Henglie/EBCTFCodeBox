/*
 * edu-regex.en.js — English edu card for the regexTool op.
 * Source: edu/edu-regex.js, translated 1:1. Example vectors (in/out) and TeX
 * formulas are copied verbatim; only prose is translated. Aka keeps every
 * Chinese alias and adds English ones.
 */
export default {
  regexTool: {
    what:
      "Extract or replace text with a regular expression: extract pulls out the whole match, the n-th capture group or all groups, optionally deduplicated and first-only, joined one per line; " +
      "replace rewrites matches with a template using $1..$9 / $& / $$. It is not another regex engine — it exposes the native JS RegExp safely as a chainable op. " +
      "The difference that matters: every pattern passes a structural whitelist **before compilation**, so patterns that cause catastrophic backtracking (ReDoS) never run.",
    principle:
      "**Why a whitelist**: JS `RegExp.exec` is synchronous and uninterruptible — once exponential backtracking starts, the main thread can only wait; `setTimeout`/`AbortSignal` cannot break in. " +
      "So \"timeout as a safety net\" is a fiction in a plain main thread; the only reliable option is to reject dangerous patterns **before** compilation.\n\n" +
      "**Whitelist rules (structural, not heuristic)**:\n" +
      "① **Backreferences** `\\1..\\9`, `\\k<name>`: matching cost grows with input length — rejected.\n" +
      "② **Dangerous nested quantifiers**: a group quantified by an unbounded quantifier (`*` / `+` / `{m,}`) whose body is **variable-length** (contains `*`/`+`/`{m,n}`/ambiguous alternation) → rejected. " +
      "Note the criterion is \"is the inner part variable-length\", not \"does the inner part contain a quantifier\": `(a+)+`, `(a*)*`, `(a|aa)+` are rejected, while `([0-9a-f]{2})+`, `(\\d{1,3}\\.){3}`, `(a{2})+` are allowed — " +
      "each iteration consumes a fixed (or bounded) number of characters, so the split is unique and there is no exponential branching.\n" +
      "③ **Lookbehind** `(?<=...)` / `(?<!...)`: requires scanning history backwards, cost unbounded — rejected.\n" +
      "④ **Empty-matchable patterns**: a pattern that matches the empty string (`a*`, `^`, `(a|)`) makes the global loop spin in place — rejected.\n" +
      "⑤ **Non-standard extensions**: `(?(`、`(?>`、`(?#`、`(?P<`、`(?i)` are all rejected; only `(?:`, `(?=`, `(?!`, `(?<name>` are supported.\n\n" +
      "**Budget guard for bounded nesting**: variable-length inner + `{m,n}` outer is estimated as the product of per-level upper bounds; above 10000 the pattern is rejected — " +
      "so `(\\d{1,3}\\.){3}` (3×3=9) passes while `(\\d{1,3}\\.){4000}` (12000) does not.\n\n" +
      "**Known residual risk (stated honestly)**: alternation is only compared by whether the **first characters** of the branches are pairwise distinct, so `(abc|abd)+` — same first char, separable suffix — is rejected as a conservative false positive; " +
      "conversely `(foo|bar)+` passes. The whitelist is a **conservative subset**, not a complete complexity decision: it guarantees that anything allowed is not in the known exponential family, not that everything allowed is linear.",
    usage:
      "**extract mode** (default): fill `pattern`, then pick what to take with `group` — `0` whole match (default), `1..n` the n-th capture group, `all` joins every group of one match with tabs; " +
      "`dedupe` removes duplicates keeping first-occurrence order, `firstOnly` keeps just the first, `sep` sets the joiner (accepts `\\n` `\\t` literal escapes).\n\n" +
      "**replace mode**: fill `pattern` and `replacement`; in the template `$1..$9` are capture groups, `$&` is the whole match, `$$` is a literal `$`. " +
      "A group index beyond the actual group count, or a `$` followed by anything unrecognised (`$0`, `` $` ``, a trailing lone `$`) is **kept verbatim**, never silently swallowed into an empty string.\n\n" +
      "**Typical uses**: pull flags (`flag\\{[^}]+\\}`), 32-hex hashes (`[0-9a-f]{32}`), IPs (`(\\d{1,3}\\.){3}\\d{1,3}`), split `key=value` fields, rewrite `2026-10-26` into `26/10/2026`.\n\n" +
      "**Bounds**: pattern ≤ 256 chars, input ≤ 100000 chars, at most 5000 matches/replacements. Empty pattern, invalid regex and **zero matches always raise explicitly** — " +
      "deliberately: in a recipe chain, \"no match so pass the text through\" hides an upstream error, so we stop and tell you nothing matched.",
    examples: [
      { in: "flag{a1b2} and flag{c3d4}", out: "flag{a1b2}\nflag{c3d4}", desc: "extract: pattern=flag\\{[0-9a-z]+\\}, default group=0, one per line" },
      { in: "k1=v1;k2=v2", out: "k1\nk2", desc: "extract: pattern=([a-z0-9]+)=([a-z0-9]+), group=1 keeps only the keys" },
      { in: "k1=v1", out: "k1\tv1", desc: "extract: group=all joins every group of one match with tabs" },
      { in: "a b a c", out: "a\nb\nc", desc: "extract: pattern=[a-c], dedupe=true removes duplicates keeping first order" },
      { in: "2026-10-26", out: "26/10/2026", desc: "replace: pattern=(\\d{4})-(\\d{2})-(\\d{2}), replacement=$3/$2/$1" },
      { in: "abc", out: "a[b]c", desc: "replace: pattern=b, replacement=[$&] where $& is the whole match" },
    ],
    formulas: [
      { tex: "\\text{extract}(s,p,g)=\\mathrm{join}(\\mathit{sep},\\ \\{m[g]\\mid m\\in\\mathrm{exec}_{g}(p,s)\\})", caption: "extract = repeated global matches, take group g from each, join by sep" },
      { tex: "\\text{replace}(s,p,r)=s_0\\,r^{\\ast}\\,s_1\\,r^{\\ast}\\cdots", caption: "replace = unmatched segments interleaved with expanded templates ($n = group n)" },
    ],
    tips: [
      "For flags prefer `flag\\{[^}]+\\}` over `flag\\{.*\\}`: `.*` does not cross newlines without the `s` flag.",
      "To take only the first hit, do not just drop the `g` flag — that leaves semantics tied to lastIndex. This op's `firstOnly` is an explicit parameter with predictable behaviour.",
      "When you see \"nested quantifier rejected\", check which kind: inner `*`/`+` is genuinely dangerous (split the extraction into steps); inner `{2}` is allowed; if the rejected pattern is `(abc|abd)+`, that is the conservative first-character rule biting — expand it to `abc|abd` instead.",
      "Zero-match errors are not bugs: silently passing text through in a chain would mask an upstream decoding error; raising tells you exactly which step failed to match.",
      "Write `$$` for a literal `$` in the template; `$0`, `` $` ``, `$'` are not supported here (kept verbatim), so do not expect JS `String.replace` semantics for them.",
      "Regex runs entirely on your machine; nothing is uploaded, and there is no eval or dynamic code.",
    ],
    aka: [
      "正则提取", "正则替换", "regex extract", "regex replace", "regexp", "regex tool",
      "通用正则", "正则表达式工具", "捕获组提取", "批量替换", "pattern match", "正则匹配",
      "grep 式提取", "正则去重", "ReDoS 安全正则", "regex capture group",
    ],
  },
};
