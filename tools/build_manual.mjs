// Build self-contained previews of the current manuscript. Both locales remain readable without JS.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { dirname, resolve, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { APP_VERSION } from "../src/core/version.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Locate project root by walking up to the file that owns version.js. */
export function findProjectRoot(start = HERE) {
  let d = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(d, "src", "core", "version.js")) && existsSync(join(d, "index.html"))) return d;
    const p = resolve(d, "..");
    if (p === d) break;
    d = p;
  }
  throw new Error("project root not found from " + start);
}

/* ------------------------------------------------------------------ escaping */
/** Escape for HTML text/attributes while PRESERVING author-intended entities. */
export function escText(s) {
  return String(s ?? "")
    .replace(/&(?!(?:[A-Za-z]+|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Inline markdown: `code` and **bold** only; no links (entries contain none). */
export function inline(raw) {
  let out = "", last = 0;
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g;
  let m;
  while ((m = re.exec(String(raw)))) {
    out += escText(String(raw).slice(last, m.index));
    if (m[1] !== undefined) out += "<code>" + escText(m[1]) + "</code>";
    else out += "<strong>" + escText(m[2]) + "</strong>";
    last = re.lastIndex;
  }
  out += escText(String(raw).slice(last));
  return out;
}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^\w\u4e00-\u9fa5]+/g, "-").replace(/^-|-$/g, "") || "s";
}

/* ------------------------------------------------------------ markdown blocks */
/** Minimal block converter: headings, tables, fenced code, blockquote, lists, paragraphs. */
export function mdToHtml(md, usedAnchors, anchorPrefix = "sec-") {
  const lines = String(md ?? "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const anchor = (title, prefix) => {
    let a = prefix + slug(title), n = 2;
    while (usedAnchors.has(a)) a = prefix + slug(title) + "-" + (n++);
    usedAnchors.add(a);
    return a;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*$/.test(line)) { i++; continue; }

    // fenced code
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      if (i < lines.length) i++;
      out.push("<pre><code>" + escText(buf.join("\n")) + "</code></pre>");
      continue;
    }
    // headings ####..#
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = Math.min(h[1].length + 1, 6);
      const id = level >= 3 ? ` id="${anchor(h[2], anchorPrefix)}"` : "";
      out.push(`<h${level}${id}>${inline(h[2])}</h${level}>`);
      i++; continue;
    }
    // table (header line + separator line)
    if (/^\|.*\|$/.test(line) && i + 1 < lines.length && /^\|[\s:|\-]+\|$/.test(lines[i + 1])) {
      const cells = (r) => r.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(line);
      i += 2;
      let body = "";
      while (i < lines.length && /^\|.*\|$/.test(lines[i])) {
        const c = cells(lines[i]);
        body += "<tr>" + c.map((x) => "<td>" + inline(x) + "</td>").join("") + "</tr>";
        i++;
      }
      out.push("<table><thead><tr>" + head.map((x) => "<th>" + inline(x) + "</th>").join("") + "</tr></thead><tbody>" + body + "</tbody></table>");
      continue;
    }
    // blockquote
    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
      out.push("<blockquote>" + inline(buf.join(" ")) + "</blockquote>");
      continue;
    }
    // ordered / unordered list
    const ol = /^\d+\.\s+/.test(line), ul = /^-\s+/.test(line);
    if (ol || ul) {
      const items = [];
      const rx = ol ? /^\d+\.\s+/ : /^-\s+/;
      while (i < lines.length && rx.test(lines[i])) { items.push(inline(lines[i].replace(rx, ""))); i++; }
      out.push((ol ? "<ol>" : "<ul>") + items.map((x) => "<li>" + x + "</li>").join("") + (ol ? "</ol>" : "</ul>"));
      continue;
    }
    // paragraph: consecutive plain lines until a block starter or blank
    const buf = [];
    const isStarter = (l) => /^\s*$/.test(l) || /^```/.test(l) || /^#{1,4}\s/.test(l) ||
      /^\|.*\|$/.test(l) || /^>\s?/.test(l) || /^\d+\.\s+/.test(l) || /^-\s+/.test(l);
    while (i < lines.length && !isStarter(lines[i])) { buf.push(lines[i]); i++; }
    if (buf.length) out.push("<p>" + inline(buf.join(" ")) + "</p>");
    else { out.push("<p>" + inline(line) + "</p>"); i++; }
  }
  return out.join("\n");
}

/* ------------------------------------------------------------- entry scanning */
const OP_RE = /^[A-Za-z0-9][A-Za-z0-9_\-./]*$/;

/** Recursively scan an entries root. Supports `<ns>/<op>.zh.md` two-level dirs. */
export function scanEntries(entriesRoot) {
  const diagnostics = [];
  const byOp = new Map();
  const walk = (dir, relPrefix) => {
    for (const name of readdirSync(dir).sort()) {
      const abs = join(dir, name);
      const st = statSync(abs);
      if (st.isDirectory()) { walk(abs, relPrefix ? relPrefix + "/" + name : name); continue; }
      if (!name.endsWith(".md")) {
        diagnostics.push({ code: "BAD_NAME", severity: "error", path: (relPrefix ? relPrefix + "/" : "") + name, detail: "non-.md file in entries root" });
        continue;
      }
      const rel = relPrefix ? relPrefix + "/" + name : name;
      const mLoc = /^(.*)\.(zh|en)\.md$/.exec(name);
      if (!mLoc) {
        diagnostics.push({ code: "BAD_NAME", severity: "error", path: rel, detail: "filename must be <op>.zh.md or <op>.en.md" });
        continue;
      }
      const stem = (relPrefix ? relPrefix + "/" : "") + mLoc[1];
      if (!OP_RE.test(stem)) {
        diagnostics.push({ code: "BAD_NAME", severity: "error", path: rel, detail: "opId contains invalid characters: " + stem });
        continue;
      }
      const locale = mLoc[2];
      if (!byOp.has(stem)) byOp.set(stem, { opId: stem, locales: {} });
      const rec = byOp.get(stem);
      if (rec.locales[locale]) {
        diagnostics.push({ code: "DUP_ANCHOR", severity: "error", path: rel, detail: "duplicate " + locale + " file for opId " + stem });
      }
      const raw = readFileSync(abs, "utf8");
      const escaping = countRawHazards(raw);
      if (escaping > 0) {
        diagnostics.push({ code: "ESCAPED", severity: "info", path: rel, detail: escaping + " raw hazard(s) neutralized by escText" });
      }
      rec.locales[locale] = { path: rel, raw, escaping };
    }
  };
  if (!existsSync(entriesRoot)) {
    diagnostics.push({ code: "BAD_NAME", severity: "error", path: entriesRoot, detail: "entries root missing" });
    return { ops: [], diagnostics };
  }
  walk(entriesRoot, "");
  // pairing check
  const ops = [];
  for (const [opId, rec] of [...byOp.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (!rec.locales.zh || !rec.locales.en) {
      diagnostics.push({ code: "MISSING_PAIR", severity: "error", path: opId,
        detail: "missing " + (!rec.locales.zh ? "zh" : "") + (!rec.locales.en ? " en" : "") });
      continue; // do not emit a half-paired entry as if complete
    }
    ops.push(rec);
  }
  return { ops, diagnostics };
}

/** Count raw HTML hazards that escText will neutralize (pre-escaped entities excluded). */
export function countRawHazards(raw) {
  const s = String(raw)
    .replace(/&(?:[A-Za-z]+|#\d+|#x[0-9a-fA-F]+);/g, ""); // remove author entities
  return (s.match(/</g) || []).length + (s.match(/>/g) || []).length;
}

/* ------------------------------------------------------------------ build book */
/** Import the CURRENT manuscript module (read-only). */
export async function loadManuscript(projectRoot) {
  const url = pathToFileURL(join(projectRoot, "docs", "manual", "manuscript.mjs")).href;
  const mod = await import(url + "?t=" + Date.now());
  return { revision: mod.revision, chapters: mod.chapters, opNotes: mod.opNotes,
    parameterNotes: mod.parameterNotes, verifiedSources: mod.verifiedSources };
}

/**
 * Build a book from manuscript + scanned entries.
 * 'defaultLocale' only decides which locale layer is unhidden by the JS; BOTH are embedded.
 */
export function buildBook(ms, entries, defaultLocale) {
  const coverage = { entries: [], chapterIds: [], notes: [], anchorCollisions: [] };
  const usedAnchors = new Set();
  const chapters = [];

  // 1) Author chapters FIRST, in manuscript order. Body rendered from current markdown.
  //    Every DOM id is locale-prefixed so zh+en can be embedded in ONE file with no
  //    duplicate ids (id="<loc>-<slug>").
  for (const loc of ["zh", "en"]) {
    const list = (ms.chapters && ms.chapters[loc]) || [];
    const arr = [];
    for (const ch of list) {
      arr.push({ id: loc + "-" + slug(ch.id), sourceId: ch.id, title: ch.title, review: "as-authored",
        body: mdToHtml(ch.body || "", usedAnchors, loc + "-sec-") });
      if (loc === "zh") coverage.chapterIds.push(ch.id);
    }
    chapters.push({ code: loc, sections: arr });
  }

  // 2) Entries as a generated trailing chapter, per locale, stable opId order.
  //    Namespace ops stay distinct: anchor uses full opId with '/' folded to '-'.
  for (const loc of ["zh", "en"]) {
    const target = chapters.find((c) => c.code === loc);
    const sections = [];
    for (const rec of entries.ops) {
      const opId = rec.opId;
      const anchor = loc + "-entry-" + slug(opId);
      if (usedAnchors.has(anchor)) {
        // Explicit diagnostic surfaced through coverage; do not merge with main op.
        coverage.anchorCollisions.push({ opId, anchor });
      }
      usedAnchors.add(anchor);
      const note = (ms.opNotes && ms.opNotes[opId]) || null;
      const params = Object.keys(ms.parameterNotes || {}).filter((k) => k === opId || k.startsWith(opId + "."));
      const linkedSources = (ms.verifiedSources || []).filter((v) => v.op === opId).map((v) => v.url);
      const raw = rec.locales[loc].raw;
      let body = mdToHtml(raw, usedAnchors, loc + "-entry-" + slug(opId) + "-");
      // Preserve source/revision metadata explicitly; never promote review state.
      const meta = [];
      if (note && note.source) meta.push("实现来源: " + escText(note.source));
      if (note && Array.isArray(note.standards) && note.standards.length) meta.push("标准: " + note.standards.map(escText).join(", "));
      if (linkedSources.length) meta.push("真题来源: " + linkedSources.map(escText).join(", "));
      if (params.length) meta.push("参数口径: " + params.map(escText).join(", "));
      if (meta.length) body += "\n<p class=\"manual__meta\">" + meta.join(" ｜ ") + "</p>";
      sections.push({ id: anchor, title: opId, review: "as-authored", kind: "entry", body });
      if (loc === "zh") {
        coverage.entries.push({ opId, hasNote: !!note, paramNotes: params.length,
          verifiedSources: linkedSources.length, rawHazards: rec.locales[loc].escaping,
          unreviewedMarker: /未实跑|待核|待补|示意/.test(raw) });
      }
    }
    target.sections.push({ id: loc + "-entries", title: loc === "zh" ? "条目详解（中英配对，按 opId 排序）" : "Entry reference (paired zh/en, sorted by opId)",
      review: "as-authored", sections });
  }

  return { project: "EBCrypto", version: APP_VERSION, revision: ms.revision,
    schemaVersion: 2, defaultLocale, chapters, coverage };
}

/* --------------------------------------------------------------- HTML template */
const CSS = `:root{
--m-bg:#fffdfc;--m-fg:#221f1d;--m-fg-soft:#5c5550;--m-outline:#e6dfda;--m-outline-strong:#d5cbc5;
--m-primary:#b3261e;--m-primary-soft:#fdf2f0;--m-code-bg:#f7f4f2;--m-code-inline:#f2ebe8;
--m-radius:12px;--m-measure:46em;
--m-sans:"Source Han Sans CN","Source Han Sans SC","Noto Sans SC","PingFang SC","Microsoft YaHei UI","Microsoft YaHei","Noto Sans CJK SC","WenQuanYi Micro Hei","Segoe UI Symbol",sans-serif;
--m-serif:"Source Han Serif SC","Noto Serif SC","Songti SC",SimSun,"Noto Serif CJK SC",serif;
--m-mono:"Cascadia Mono","Cascadia Code",Consolas,"Source Code Pro","LXGW WenKai Mono","Noto Sans Mono CJK SC",monospace}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--m-bg);color:var(--m-fg);font-family:var(--m-sans);font-size:16px;line-height:1.8;
font-kerning:normal;font-feature-settings:"kern" 1;text-rendering:optimizeLegibility;line-break:strict}
::selection{background:var(--m-primary-soft);color:var(--m-fg)}
.manual{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:100vh}
.manual__side{border-right:1px solid var(--m-outline);padding:20px 16px;position:sticky;top:0;height:100vh;overflow:auto;min-width:0}
.manual__main{padding:36px 40px 72px;width:100%;max-width:calc(var(--m-measure) + 80px);margin:0 auto;min-width:0}
.manual__title{font-size:30px;line-height:1.35;font-weight:700;letter-spacing:-.01em;margin:0 0 20px}
.manual__nav{margin:0 0 20px;padding:0 0 8px;border-bottom:1px solid var(--m-outline)}
.manual__nav a{display:block;padding:5px 8px;font-size:14px;line-height:1.5;color:var(--m-fg-soft);text-decoration:none;border-radius:8px;overflow-wrap:anywhere}
.manual__nav-top{font-weight:700;color:var(--m-fg);margin-top:6px}
.manual__nav a.manual__nav-sub{padding-left:22px!important;font-size:13.5px;color:var(--m-fg-soft)}
.manual__nav a[data-active="true"]{background:var(--m-primary-soft);color:var(--m-primary)}
.manual__nav a:hover,.manual__nav a:focus-visible{background:var(--m-code-bg);color:var(--m-fg);outline:2px solid var(--m-primary);outline-offset:-2px}
.manual__nav a[data-filtered="true"]{display:none}
.manual__section{scroll-margin-top:72px;padding-top:8px;border-bottom:1px solid var(--m-outline)}
.manual__section:last-child{border-bottom:0}
.manual__section h2{font-size:23px;line-height:1.45;font-weight:700;letter-spacing:-.005em;margin:30px 0 12px}
.manual__section h3{font-size:18.5px;line-height:1.5;font-weight:700;margin:24px 0 8px}
.manual__section h4{font-size:16px;line-height:1.55;font-weight:700;margin:18px 0 6px}
.manual__section h2.manual__entry-op{font-size:12.5px;line-height:1.4;letter-spacing:.06em;text-transform:uppercase;color:var(--m-fg-soft);font-weight:700;margin:10px 0 2px}
.manual__body{overflow-wrap:anywhere}
.manual__body>p:first-child{margin-top:0}
p{margin:0 0 .95em}
.manual__meta{font-size:13px;line-height:1.7;color:var(--m-fg-soft);overflow-wrap:anywhere}
a{color:var(--m-primary);text-underline-offset:2px}
a:hover{text-decoration-thickness:2px}
ul,ol{margin:0 0 .95em;padding-left:1.6em}
li+li{margin-top:.32em}
li>ul,li>ol{margin:.32em 0 0}
blockquote{margin:16px 0;padding:10px 16px;border-left:3px solid var(--m-primary);background:var(--m-primary-soft);border-radius:0 8px 8px 0;color:var(--m-fg-soft)}
blockquote p:last-child{margin-bottom:0}
code{font-family:var(--m-mono);font-size:.9em;background:var(--m-code-inline);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{overflow:auto;background:var(--m-code-bg);border:1px solid var(--m-outline);padding:14px 16px;border-radius:10px;margin:16px 0;max-width:100%;line-height:1.7}
pre code{background:transparent;padding:0;font-size:14.5px;overflow-wrap:normal;white-space:pre;tab-size:2}
table{border-collapse:collapse;margin:16px 0;max-width:100%;display:block;overflow-x:auto;font-size:15px;line-height:1.65}
th,td{border:1px solid var(--m-outline);padding:8px 12px;text-align:left;vertical-align:top}
th{background:var(--m-code-bg);font-weight:700;white-space:nowrap}
tbody tr:nth-child(even){background:rgba(0,0,0,.018)}
hr{border:0;border-top:1px solid var(--m-outline);margin:28px 0}
.manual__toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:0 0 16px;position:sticky;top:0;background:var(--m-bg);padding:10px 0;z-index:2;border-bottom:1px solid transparent}
.manual__toolbar button,.manual__toolbar input{min-height:38px;padding:0 12px;border:1px solid var(--m-outline-strong);border-radius:9px;background:var(--m-bg);color:inherit;font:inherit;font-size:14.5px}
.manual__toolbar input{min-width:200px;flex:1 1 200px}
.manual__toolbar button{cursor:pointer}
.manual__toolbar button:hover{border-color:var(--m-primary)}
.manual__toolbar button[aria-pressed="true"]{border-color:var(--m-primary);color:var(--m-primary);font-weight:700;background:var(--m-primary-soft)}
.manual__hits{font-size:13px;color:var(--m-fg-soft)}
.manual__empty{display:none;margin:8px 0 16px;padding:10px 14px;border:1px dashed var(--m-outline-strong);border-radius:8px;color:var(--m-fg-soft)}
.manual__empty[data-shown="true"]{display:block}
.locale[data-hidden-by-js="true"]{display:none}
.manual__section[hidden]{display:none}
@media screen and (prefers-color-scheme:dark){:root{--m-bg:#161412;--m-fg:#e9e4e0;--m-fg-soft:#b3a9a2;--m-outline:#38322e;--m-outline-strong:#4a433d;--m-primary:#f0a197;--m-primary-soft:#2a2220;--m-code-bg:#1e1b19;--m-code-inline:#2a2522}
tbody tr:nth-child(even){background:rgba(255,255,255,.03)}}
@media(max-width:720px){.manual{grid-template-columns:minmax(0,1fr)}.manual__side{position:static;height:auto;border-right:0;border-bottom:1px solid var(--m-outline)}.manual__main{padding:20px 16px 56px}.manual__title{font-size:25px}}
@page{margin:12mm}
@media print{:root{--m-bg:#fff;--m-fg:#000;--m-fg-soft:#333;--m-outline:#bbb;--m-code-bg:#f5f5f5;--m-code-inline:#eee;--m-primary:#000;--m-primary-soft:#f5f5f5}
.manual__side,.manual__toolbar,.manual__nav,.manual__hits,.manual__empty{display:none!important}
.manual{display:block}.manual__main{max-width:none;padding:0}
.manual__section{break-inside:avoid;border:0}
.manual__section h2{break-after:avoid}
.manual__section[hidden]{display:none!important}
body{font-family:var(--m-serif);font-size:11pt;line-height:1.7}
pre,table{break-inside:avoid}
table{display:table;width:100%;table-layout:fixed;font-size:9.5pt}
th,td{overflow-wrap:anywhere}
pre code{font-size:9pt;white-space:pre-wrap}
}`;

/**
 * Progressive enhancement: only hide the non-default locale AFTER JS runs.
 * Locale ids are `<loc>-<slug>`; a switch first tries the corresponding section.
 */
export function buildJs(defaultLocale) {
  return `(function(){
 var def=${JSON.stringify(defaultLocale)};
 var locales=Array.prototype.slice.call(document.querySelectorAll('.manual__locale'));
 var q=document.getElementById('m-q');
 var hits=document.getElementById('m-hits');
 var empty=document.getElementById('m-empty');
 function active(){
  for(var i=0;i<locales.length;i++){if(locales[i].getAttribute('data-hidden-by-js')!=='true')return locales[i];}
  return locales[0]||null;
 }
 function setLocale(want){
  for(var i=0;i<locales.length;i++){var L=locales[i];
   if(L.getAttribute('data-locale')===want)L.removeAttribute('data-hidden-by-js');
   else L.setAttribute('data-hidden-by-js','true');}
  var btns=document.querySelectorAll('[data-locale-btn]');
  for(var j=0;j<btns.length;j++){
   btns[j].setAttribute('aria-pressed',btns[j].getAttribute('data-locale-btn')===want?'true':'false');}
 }
 function visiblyShown(el){
  for(var n=el;n;n=n.parentElement){if(n.hasAttribute&&n.hasAttribute('hidden'))return false;}
  return true;
 }
 function applySearch(){
  var loc=active();if(!loc)return;
  var v=q?String(q.value||'').trim().toLowerCase():'';
  var n=0;
  var secs=loc.querySelectorAll('.manual__section');
  for(var i=0;i<secs.length;i++){var s=secs[i];
   if(!v){s.hidden=false;continue;}
   var hit=s.textContent.toLowerCase().indexOf(v)>=0;
   s.hidden=!hit;if(hit)n++;}
  var nav=loc.querySelector('.manual__nav');
  if(nav){var links=nav.querySelectorAll('a');
   for(var k=0;k<links.length;k++){var a=links[k];
    var id=(a.getAttribute('href')||'').replace(/^#/,'');
    var t=id?document.getElementById(id):null;
    a.setAttribute('data-filtered',(t&&!visiblyShown(t))?'true':'false');}}
  if(hits)hits.textContent=v?('命中 '+n+' 项'):'';
  if(empty){
   var none=!!(v&&n===0);
   empty.setAttribute('data-shown',none?'true':'false');
   empty.textContent=none?('没有匹配“'+(q?q.value:'')+'”的章节，按 Esc 清空。'):'';}
  if(typeof syncActive==='function')syncActive();
 }
 function jump(id){
  var el=id?document.getElementById(id):null;
  if(!el)return false;
  try{location.hash=el.id;}catch(e){}
  el.scrollIntoView();
  return true;
 }
 var raf=0;
 function syncActive(){
  var loc=active();if(!loc)return;
  var nav=loc.querySelector('.manual__nav');if(!nav)return;
  var links=nav.querySelectorAll('a');
  var y=window.scrollY+96,current='';
  for(var i=0;i<links.length;i++){
   var id=(links[i].getAttribute('href')||'').replace(/^#/,'');
   var el=id?document.getElementById(id):null;
   if(!el||el.hidden)continue;
   var top=el.getBoundingClientRect().top+window.scrollY;
   if(top<=y)current=id;
  }
  for(var j=0;j<links.length;j++){
   var lid=(links[j].getAttribute('href')||'').replace(/^#/,'');
   if(lid===current)links[j].setAttribute('data-active','true');
   else links[j].removeAttribute('data-active');
  }
 }
 window.addEventListener('scroll',function(){
  if(raf)return;raf=requestAnimationFrame(function(){raf=0;syncActive();});
 },{passive:true});
 if(q){q.addEventListener('input',applySearch);}
 if(q){q.addEventListener('keydown',function(e){
  if(e.key==='Escape'||e.key==='Esc'){q.value='';applySearch();e.preventDefault();return;}
  if(e.key==='Enter'){var loc=active();if(!loc)return;
   var secs=loc.querySelectorAll('.manual__section');var first=null;
   for(var i=0;i<secs.length;i++){if(!secs[i].hidden){first=secs[i];break;}}
   if(first)jump(first.id);
   e.preventDefault();}
 });}
 var btns=document.querySelectorAll('[data-locale-btn]');
 for(var b=0;b<btns.length;b++){(function(btn){
  btn.addEventListener('click',function(){
   var want=btn.getAttribute('data-locale-btn');
   var cur=active();
   var ratio=0;
   if(cur){var max=document.documentElement.scrollHeight-window.innerHeight;
    ratio=max>0?window.scrollY/max:0;}
   var m=/^#([a-z]{2})-(.*)$/.exec(location.hash||'');
   setLocale(want);
   var moved=false;
   if(m){moved=jump(want+'-'+m[2]);}
   if(!moved){var max2=document.documentElement.scrollHeight-window.innerHeight;
    window.scrollTo(0,Math.round(max2*ratio));
    if(location.hash){try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}}}
   applySearch();
  });
 })(btns[b]);}
 // deep link: #en-xxx must activate the en layer even when the default layer is zh
  var deep=/^#(zh|en)-(.*)$/.exec(location.hash||'');
 setLocale(deep&&deep[1]?deep[1]:def);
 if(deep)jump(deep[1]+'-'+deep[2]);
 applySearch();
})();`;
}

export function renderHtml(book) {
  const def = book.defaultLocale;
  const navHtml = (loc) => `<nav class="manual__nav" data-nav-locale="${escText(loc.code)}" aria-label="${loc.code === 'zh' ? '目录' : 'Contents'}">` + loc.sections.map((s) => {
    const inner = (s.sections || []).map((x) => `<a class="manual__nav-sub" href="#${escText(x.id)}">${escText(x.title)}</a>`).join("");
    return `<a class="manual__nav-top" href="#${escText(s.id)}">${escText(s.title)}</a>` + inner;
  }).join("") + `</nav>`;
  const bodies = book.chapters.map((loc) => `<div class="manual__locale locale" lang="${escText(loc.code)}" data-locale="${escText(loc.code)}">` +
    `<h1 class="manual__title">${escText(loc.code === "zh" ? "EBCrypto 离线手册预览" : "EBCrypto Offline Manual Preview")}</h1>` + navHtml(loc) +
    loc.sections.map((s) => `<section class="manual__section${s.kind === "entry" ? " manual__section--entry" : ""}" id="${escText(s.id)}"><h2${s.kind === "entry" ? ' class="manual__entry-op"' : ""}>${escText(s.title)}</h2>` +
      (s.sections ? s.sections.map((x) => `<section class="manual__section${x.kind === "entry" ? " manual__section--entry" : ""}" id="${escText(x.id)}">` +
        (x.kind === "entry" ? `<h2 class="manual__entry-op">${escText(x.title)}</h2>` : `<h3>${escText(x.title)}</h3>`) +
        `<div class="manual__body">${x.body}</div></section>`).join("") :
        `<div class="manual__body">${s.body}</div>`) +
      `</section>`).join("") + `</div>`).join("\n");
  const toolbar = `<div class="manual__toolbar">` +
    book.chapters.map((l) => `<button type="button" data-locale-btn="${escText(l.code)}" aria-pressed="false">${escText(l.code.toUpperCase())}</button>`).join("") +
    `<input id="m-q" type="search" placeholder="Search / 搜索" aria-label="搜索" autocomplete="off">` +
    `<span class="manual__hits" id="m-hits" role="status" aria-live="polite"></span>` +
    `<button type="button" onclick="window.print()">打印 / Print</button></div>` +
    `<p class="manual__empty" id="m-empty" role="status" aria-live="polite" data-shown="false"></p>`;
  return `<!DOCTYPE html>\n<html lang="${escText(def)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>${escText(book.project)} · ${def === 'zh' ? '离线手册预览' : 'Offline Manual Preview'} · v${escText(book.version)}</title><style>${CSS}</style></head><body>` +
    `<div class="manual"><aside class="manual__side"><p class="manual__meta">${escText(book.project)}<br>v${escText(book.version)}<br>书稿修订 ${escText(book.revision)}<br>默认语言 ${escText(def)}</p></aside>` +
    `<main class="manual__main">${toolbar}${bodies}<footer class="manual__meta"><p>正文静态内嵌；字体/样式本地；无网络请求。schemaVersion=${book.schemaVersion}</p></footer></main></div>` +
    `<script>${buildJs(def)}</script></body></html>\n`;
}

/** Check that both locale bodies and navigation work without external assets. */
export function auditHtml(html, book) {
  const v = [];
  if (/<script\b[^>]+src=/i.test(html)) v.push("external script");
  if (/<link\b[^>]+href=/i.test(html)) v.push("external link");
  if (/@import\b|@font-face\b/i.test(html)) v.push("remote font/@font-face");
  if (/type=["']module["']/i.test(html)) v.push("ESM script");
  if (/\bfetch\s*\(|XMLHttpRequest/.test(html)) v.push("fetch/XHR");
  // This card keeps provenance URLs as INERT TEXT (sources/standards must be preserved).
  // Reject only LOADABLE external resources: any href/src/url() pointing off-host.
  if (/<a\b[^>]+href=["']https?:/i.test(html)) v.push("external anchor href");
  if (/\b(?:src|href|action)\s*=\s*["']https?:/i.test(html)) v.push("external resource attr");
  if (/url\(\s*["']?https?:/i.test(html)) v.push("external css url()");
  if (!/@media print/.test(html)) v.push("no print CSS");
  if (!/data-locale-btn/.test(html)) v.push("no language switch");
  // BOTH locales must be static in the HTML (JS-disabled readable)
  if (!html.includes("EBCrypto 离线手册预览") || !html.includes("EBCrypto Offline Manual Preview")) v.push("a locale body not static");
  for (const loc of book.chapters) for (const s of loc.sections) {
    if (!html.includes('id="' + s.id + '"')) v.push("missing anchor " + s.id);
  }
  // No duplicate DOM ids: both locales embedded in one file must not collide.
  const idCounts = new Map();
  const idRe = /\sid="([^"]+)"/g;
  let mm;
  while ((mm = idRe.exec(html))) idCounts.set(mm[1], (idCounts.get(mm[1]) || 0) + 1);
  const dups = [...idCounts.entries()].filter(([, n]) => n > 1);
  if (dups.length) v.push("duplicate ids: " + dups.slice(0, 5).map(([k, n]) => k + "x" + n).join(","));

  // Navigation, search and print affordances.
  const printStart = html.indexOf("@media print{");
  const printBlock = printStart >= 0 ? html.slice(printStart, html.indexOf("</style>", printStart)) : "";
  if (!/manual__nav/.test(printBlock)) v.push("print block does not hide the body TOC");
  if (!/manual__toolbar/.test(printBlock)) v.push("print block does not hide the toolbar");
  if (!/manual__section\[hidden\]/.test(printBlock)) v.push("print block would print search-filtered sections");
  if (!/id="m-empty"/.test(html)) v.push("no empty-result state node");
  if (!/id="m-hits"/.test(html)) v.push("no hit-count node");
  if (!/data-filtered/.test(html)) v.push("no TOC filter rule");
  if (!/aria-pressed/.test(html)) v.push("no locale pressed state");
  return { violations: v, bytes: Buffer.byteLength(html), verdict: v.length === 0 ? "PASS" : "FAIL", duplicateIds: dups.length };
}

/* ----------------------------------------------------------------------- CLI */
async function main() {
  const [flag, dest, ...extra] = process.argv.slice(2);
  if (flag !== "--out-dir" || !dest || extra.length) throw new Error("Usage: node tools/build_manual.mjs --out-dir <existing directory>");
  const root = findProjectRoot();
  const outDir = resolve(dest);
  if (!statSync(outDir).isDirectory()) throw new Error("Output must be an existing directory");
  const entriesRoot = join(root, "docs", "manual", "entries");
  const ms = await loadManuscript(root);
  const scan = scanEntries(entriesRoot);
  const fatal = scan.diagnostics.filter((d) => d.severity === "error");
  if (fatal.length) throw new Error("entry diagnostics fatal: " + JSON.stringify(fatal));
  const outputs = {};
  const previews = ["zh", "en"].map(def => {
    const book = buildBook(ms, scan, def);
    const html = renderHtml(book);
    const audit = auditHtml(html, book);
    if (audit.verdict !== "PASS") throw new Error(def + " audit FAIL: " + audit.violations.join(", "));
    return { def, html, audit };
  });
  for (const { def, html, audit } of previews) {
    const file = join(outDir, "manual-preview." + def + ".html");
    writeFileSync(file, html, "utf8");
    outputs[def] = { file: relative(root, file).replace(/\\/g, "/"), bytes: audit.bytes, audit };
  }
  console.log(JSON.stringify({ revision: ms.revision, entries: scan.ops.length, diagnostics: scan.diagnostics,
    outputs }, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
