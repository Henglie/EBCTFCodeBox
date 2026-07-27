/*
 * ssti.js — SSTI 服务端模板注入关键字/特征识别（T268，cat:'analysis'，单向 run）。
 *
 * 场景：CTF web / 代码审计里，给一段用户可控输入或页面回显，判断是否触及
 * 服务端模板注入（Server-Side Template Injection）。本 op 做纯静态特征扫描：
 * 识别各引擎的模板定界符、经典利用链关键字、探测性 payload，给出引擎推断。
 *
 * 红线：**只做静态关键字/特征识别，绝不执行任何模板或代码**。
 * 不 eval、不渲染、不解析表达式，只对文本做正则/子串匹配。零外发纯 JS。
 *
 * 契约：run(text, p) 忽略 p，扫描 text 返回报告文本（命中分组 / 引擎推断）。
 * detect(text)：含模板定界符时给低-中置信度（定界符也可能是正常内容）。
 *
 * 特征来源（各引擎真实利用链，非编造，均为公开 SSTI 研究常识）：
 * - Jinja2/Flask：Python 对象内省链 __class__/__mro__/__subclasses__/__globals__
 * /__builtins__、config/request 全局、lipsum/cycler/url_for 等可达内建的入口。
 * - Twig(PHP)：_self、registerUndefinedFilterCallback、getFilter 逃逸链。
 * - FreeMarker(Java)：freemarker.template.utility.Execute、?new 内建。
 * - Velocity(Java)：#set、$class.inspect、.getClass.forName 反射链。
 * - Smarty(PHP)：{php}...{/php}、Smarty_Internal_Write_File。
 * - 通用 Java 反射 RCE：getClass / getRuntime / Runtime.exec / ProcessBuilder。
 */
import { register } from "./registry.js";

// ============================================================
// 1) 模板定界符：正则 + 该语法可能对应的引擎
// 命中定界符只说明「像模板语法」，不代表一定可注入，故 detect 给分保守。
// ============================================================
const DELIMITERS = [
  { re: /\{\{[\s\S]*?\}\}/g,   sig: "{{ }}",     engines: "Jinja2 / Twig / Django / Nunjucks / Handlebars" },
  { re: /\{%[\s\S]*?%\}/g,     sig: "{% %}",     engines: "Jinja2 / Twig（语句块）" },
  { re: /\$\{[\s\S]*?\}/g,     sig: "${ }",      engines: "FreeMarker / Velocity(旧) / JSP EL / Thymeleaf / Groovy / Spring SpEL" },
  { re: /<%=[\s\S]*?%>/g,      sig: "<%= %>",    engines: "ERB(Ruby) / EJS(Node) / JSP(输出)" },
  { re: /<%[^=][\s\S]*?%>/g,   sig: "<% %>",     engines: "ERB / EJS / JSP（语句块）" },
  { re: /#\{[\s\S]*?\}/g,      sig: "#{ }",      engines: "Thymeleaf(消息) / Ruby 插值 / Slim" },
  { re: /@\{[\s\S]*?\}/g,      sig: "@{ }",      engines: "Razor(.NET) / Play(Scala)" },
  { re: /\*\{[\s\S]*?\}/g,     sig: "*{ }",      engines: "Thymeleaf（选择表达式）" },
  { re: /#[a-zA-Z_]\w*\s*\(/g, sig: "#directive()", engines: "Velocity（#set/#if 等指令）" },
];

// ============================================================
// 2) 危险利用链关键字：子串匹配（大小写敏感，按引擎经典 payload）
// engine 用于引擎推断加权；label 是给用户看的说明。
// ============================================================
const KEYWORDS = [
 // ---- Jinja2 / Python 对象内省链 ----
  { kw: "__class__",       engine: "Jinja2", label: "Python 对象内省（取类型）" },
  { kw: "__mro__",         engine: "Jinja2", label: "Python MRO（向上找基类 object）" },
  { kw: "__subclasses__",  engine: "Jinja2", label: "Python 子类枚举（找 Popen/warnings 等）" },
  { kw: "__globals__",     engine: "Jinja2", label: "Python 函数全局命名空间" },
  { kw: "__builtins__",    engine: "Jinja2", label: "Python 内建命名空间（可达 eval/import）" },
  { kw: "__base__",        engine: "Jinja2", label: "Python 基类（object 内省链）" },
  { kw: "__init__",        engine: "Jinja2", label: "Python __init__（self.__init__ 起手）" },
  { kw: "__import__",      engine: "Jinja2", label: "Python 动态导入（import os）" },
  { kw: "config.items",    engine: "Jinja2", label: "Flask config 泄露（config.items()）" },
  { kw: "request.application", engine: "Jinja2", label: "Flask request 全局逃逸链" },
  { kw: "lipsum",          engine: "Jinja2", label: "Jinja2 lipsum 全局（可达 __globals__）" },
  { kw: "cycler",          engine: "Jinja2", label: "Jinja2 cycler 全局（内省入口）" },
  { kw: "url_for",         engine: "Jinja2", label: "Flask url_for 全局（内省入口）" },
  { kw: "get_flashed_messages", engine: "Jinja2", label: "Flask 全局函数（内省入口）" },
  { kw: "self.__init__",   engine: "Jinja2", label: "Jinja2 self 逃逸起手" },
  { kw: "attr(",           engine: "Jinja2", label: "Jinja2 attr() 过滤器（绕过点号过滤）" },
 // ---- Twig (PHP) ----
  { kw: "_self",           engine: "Twig",   label: "Twig _self 环境对象（逃逸入口）" },
  { kw: "registerUndefinedFilterCallback", engine: "Twig", label: "Twig 注册未定义过滤器回调（RCE 链）" },
  { kw: "getFilter",       engine: "Twig",   label: "Twig getFilter（触发回调执行）" },
 // ---- FreeMarker (Java) ----
  { kw: "freemarker.template.utility.Execute", engine: "FreeMarker", label: "FreeMarker Execute 工具类（直接命令执行）" },
  { kw: "?new()",          engine: "FreeMarker", label: "FreeMarker ?new 内建（实例化任意类）" },
  { kw: "Execute()",       engine: "FreeMarker", label: "FreeMarker Execute 调用" },
 // ---- Velocity (Java) ----
  { kw: "#set",            engine: "Velocity", label: "Velocity #set 赋值指令" },
  { kw: "$class.inspect",  engine: "Velocity", label: "Velocity 反射内省（$class.inspect）" },
  { kw: ".getClass().forName", engine: "Velocity", label: "反射 Class.forName（加载任意类）" },
  { kw: "getClassLoader",  engine: "Velocity", label: "Java 取类加载器（反射链）" },
 // ---- Smarty (PHP) ----
  { kw: "{php}",           engine: "Smarty", label: "Smarty {php} 块（直接执行 PHP）" },
  { kw: "Smarty_Internal_Write_File", engine: "Smarty", label: "Smarty 写文件类（写马 RCE）" },
  { kw: "{literal}",       engine: "Smarty", label: "Smarty {literal}（辅助绕过）" },
  { kw: "system(",         engine: "Smarty", label: "PHP system() 调用" },
 // ---- 通用 Java 反射 / RCE ----
  { kw: "getRuntime",      engine: "Java",   label: "Runtime.getRuntime（命令执行入口）" },
  { kw: "Runtime.exec",    engine: "Java",   label: "Runtime.exec（执行系统命令）" },
  { kw: "ProcessBuilder",  engine: "Java",   label: "ProcessBuilder（执行系统命令）" },
  { kw: "getClass()",      engine: "Java",   label: "Java getClass()（反射起手）" },
  { kw: "T(java.lang",     engine: "Java",   label: "Spring SpEL T() 类型引用（java.lang.Runtime）" },
];

// ============================================================
// 3) 探测性 payload：命中说明有人在做 SSTI 探测（数学表达式回显法）
// 附带引擎归属；报告里统一提示「若返回 49 则存在注入」。
// ============================================================
const PROBES = [
  { re: /\{\{\s*7\s*\*\s*7\s*\}\}/g,  sig: "{{7*7}}",    engines: "Jinja2 / Twig / Django" },
  { re: /\$\{\s*7\s*\*\s*7\s*\}/g,    sig: "${7*7}",     engines: "FreeMarker / JSP EL / Groovy" },
  { re: /<%=\s*7\s*\*\s*7\s*%>/g,     sig: "<%= 7*7 %>", engines: "ERB / EJS / JSP" },
  { re: /#\{\s*7\s*\*\s*7\s*\}/g,     sig: "#{7*7}",     engines: "Thymeleaf / Ruby" },
  { re: /\*\{\s*7\s*\*\s*7\s*\}/g,    sig: "*{7*7}",     engines: "Thymeleaf" },
  { re: /@\{\s*7\s*\*\s*7\s*\}/g,     sig: "@{7*7}",     engines: "Razor" },
 // 字符串乘法探测（Twig/Jinja2 常用，回显 7777777 判定）
  { re: /\{\{\s*7\s*\*\s*['"]7['"]\s*\}\}/g, sig: "{{7*'7'}}", engines: "Jinja2(→7777777) / Twig(→49)" },
];

// 命中定界符时把每种签名出现的次数收进 Map
function scanDelimiters(text) {
  const found = [];
  for (const d of DELIMITERS) {
    const m = text.match(d.re);
    if (m && m.length) found.push({ sig: d.sig, engines: d.engines, count: m.length });
  }
  return found;
}

function scanKeywords(text) {
  const found = [];
  for (const k of KEYWORDS) {
 // 子串精确匹配（大小写敏感）；统计出现次数
    let idx = 0, count = 0;
    while ((idx = text.indexOf(k.kw, idx)) !== -1) { count++; idx += k.kw.length; }
    if (count) found.push({ kw: k.kw, engine: k.engine, label: k.label, count });
  }
  return found;
}

function scanProbes(text) {
  const found = [];
  for (const p of PROBES) {
    const m = text.match(p.re);
    if (m && m.length) found.push({ sig: p.sig, engines: p.engines, count: m.length });
  }
  return found;
}

// 依据命中的关键字/定界符给各引擎积分，推断最可能的引擎
function inferEngines(delims, keywords, probes) {
  const score = new Map();
  const add = (eng, w) => { if (!eng) return; score.set(eng, (score.get(eng) || 0) + w); };
 // 关键字权重最高（引擎特征最强），定界符/探测较弱
  for (const k of keywords) add(k.engine, 3 * k.count);
  for (const p of probes) {
 // 探测串的 engines 可能是 "A / B" 复合，拆开各加低权
    for (const e of String(p.engines).split(/[/(]/)) {
      const name = e.trim().replace(/[)→].*$/, "").split(/\s/)[0];
      if (name && /^[A-Za-z]/.test(name)) add(name, 1);
    }
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  return ranked;
}

// ============================================================
// run：产出文本报告
// ============================================================
function sstiScanRun(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return "（空输入）请粘贴疑似含模板注入的文本 / payload / 页面回显。";

  const delims = scanDelimiters(s);
  const keywords = scanKeywords(s);
  const probes = scanProbes(s);

  const out = [];
  out.push("# SSTI 服务端模板注入 · 特征识别（静态，只识别不执行）");
  const total = delims.length + keywords.length + probes.length;
  out.push(`输入长度: ${s.length} 字符  命中特征类别: ${total}`);
  out.push("");

  if (total === 0) {
    out.push("✓ 未检出任何 SSTI 特征（无模板定界符 / 危险关键字 / 探测 payload）。");
    out.push("  说明: 仅静态匹配，未命中不代表绝对安全；仍建议对可控输入做上下文测试。");
    return out.join("\n");
  }

 // ---- 探测 payload（最有指示性，置顶）----
  if (probes.length) {
    out.push(`▸ 探测型 payload ${probes.length} 类:`);
    for (const p of probes) {
      out.push(`  ● ${p.sig}  ×${p.count}  → 可能引擎: ${p.engines}`);
    }
    out.push("  提示: 若目标页面回显 49（或 7777777），则表达式被求值 → 确认存在 SSTI。");
    out.push("");
  }

 // ---- 危险利用链关键字 ----
  if (keywords.length) {
    out.push(`▸ 危险利用链关键字 ${keywords.length} 处:`);
    for (const k of keywords) {
      out.push(`  ● ${k.kw}  ×${k.count}  [${k.engine}] — ${k.label}`);
    }
    out.push("  说明: 命中经典 SSTI→RCE 利用链符号，反序列化/渲染此模板可能导致命令执行。");
    out.push("");
  }

 // ---- 模板定界符 ----
  if (delims.length) {
    out.push(`▸ 模板定界符 ${delims.length} 类:`);
    for (const d of delims) {
      out.push(`  ● ${d.sig}  ×${d.count}  → 可能引擎: ${d.engines}`);
    }
    out.push("  注意: 定界符也可能是正常文本/前端模板，需结合可控点与回显判断。");
    out.push("");
  }

 // ---- 引擎推断 ----
  const ranked = inferEngines(delims, keywords, probes);
  if (ranked.length) {
    out.push("▸ 引擎推断（按特征加权，分数越高越可能）:");
    ranked.slice(0, 5).forEach(([eng, sc], i) => {
      out.push(`  ${i + 1}. ${eng}  (score ${sc})`);
    });
  } else {
    out.push("▸ 引擎推断: 仅命中通用定界符，特征不足以定位具体引擎。");
  }

  return out.join("\n");
}

// ============================================================
// detect（供一键解码）：含模板定界符/探测串给低-中分。
// 定界符普遍存在于正常文本，故封顶偏保守；命中危险关键字或探测串才上调。
// ============================================================
function sstiDetect(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return 0;
  let hasDelim = false;
  for (const d of DELIMITERS) { d.re.lastIndex = 0; if (d.re.test(s)) { hasDelim = true; break; } }
  if (!hasDelim) return 0;
 // 命中探测 payload 或危险关键字 → 中等置信；仅裸定界符 → 低置信。
  let hasProbe = false;
  for (const p of PROBES) { p.re.lastIndex = 0; if (p.re.test(s)) { hasProbe = true; break; } }
  const hasKw = KEYWORDS.some((k) => s.indexOf(k.kw) !== -1);
  if (hasProbe) return 0.55;
  if (hasKw) return 0.45;
  return 0.2; // 仅定界符：低分（避免把普通含 {{ }} 的文本误判）
}

// ============================================================
// 注册
// ============================================================
register({
  id: "sstiKeyword",
  cat: "analysis",
  name: "SSTI 关键字识别",
  desc: "服务端模板注入（SSTI）静态特征扫描：识别 Jinja2/Twig/FreeMarker/Velocity/Smarty 等引擎的模板定界符、经典 RCE 利用链关键字与 7*7 探测 payload，给出引擎推断。只识别不执行",
  params: [],
  run: sstiScanRun,
  detect: sstiDetect,
});

export { sstiScanRun, sstiDetect, DELIMITERS, KEYWORDS, PROBES };
