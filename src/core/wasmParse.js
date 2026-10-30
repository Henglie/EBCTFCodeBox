/*
 * wasmParse.js — WebAssembly 二进制结构解析（只解析与字段展示，不做反编译）。
 *
 * 依据：WebAssembly Core Specification 2.0（W3C）§5 Binary Format ——
 *   magic = 00 61 73 6D（"\0asm"），version = 01 00 00 00（u32 LE，当前 1）；
 *   section = id(1B) + size(uleb128) + content；
 *   id：0 custom(name 可含 name 子节) / 1 type / 2 import / 3 function / 4 table /
 *       5 memory / 6 global / 7 export / 8 start / 9 element / 10 code / 11 data / 12 datacount。
 *   LEB128（§5.2.2）：无符号 uleb128 逐字节 7 位，最高位为续传标志；超 32 位/截断/超长报错。
 *   import/export 条目：module/name 双 uleb 串 + kind（0 func 1 table 2 mem 3 global）+ 类型。
 *
 * 只读结构解析：绝不执行 wasm、不做反编译（卡面口径）；零外发。
 */

import { register } from "./registry.js";

// ---- uleb128（严格：截断/超 32 位/单节超 5 字节报错） ----
function uleb(b, off, label) {
  let result = 0, shift = 0, i = off;
  for (;;) {
    if (i >= b.length) throw new Error(`WASM 解析失败（偏移 ${off}）：${label} 的 uleb128 被截断`);
    const byte = b[i];
    result += (byte & 0x7f) * (shift < 28 ? (1 << shift) : 2 ** shift);
    i++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
    if (shift > 35) throw new Error(`WASM 解析失败（偏移 ${off}）：${label} 的 uleb128 超过 5 字节`);
  }
  return [result >>> 0, i];
}

function name(b, off, label) {
  const [len, p1] = uleb(b, off, `${label} 长度`);
  if (p1 + len > b.length) throw new Error(`WASM 解析失败（偏移 ${off}）：${label} 越界（长度 ${len}，仅剩 ${b.length - p1}）`);
  return [new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(p1, p1 + len)), p1 + len];
}

const SECTION_NAMES = ["custom", "type", "import", "function", "table", "memory", "global", "export", "start", "element", "code", "data", "datacount"];
// 非 custom section 的逻辑顺序（spec module 语法 §5.3.13）：datacount(12) 合法位置在 code/data 之前
const LOGIC_RANK = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 12: 9, 10: 10, 11: 11 };
const KINDS = ["func", "table", "mem", "global"];
const VAL_TYPES = { 0x7f: "i32", 0x7e: "i64", 0x7d: "f32", 0x7c: "f64", 0x7b: "v128", 0x70: "funcref", 0x6f: "externref" };

function valType(b, off, label) {
  if (off >= b.length) throw new Error(`WASM 解析失败：${label} 值类型截断`);
  const t = b[off];
  const s = VAL_TYPES[t];
  if (!s) throw new Error(`WASM 解析失败（偏移 ${off}）：${label} 未知值类型 0x${t.toString(16)}`);
  return [s, off + 1];
}

/** 解析 wasm 字节 → 结构化摘要（行数组）。 */
function parseWasm(b) {
  if (b.length < 8) throw new Error(`WASM 解析失败：文件过短（${b.length} 字节，头部至少 8 字节）`);
  const magic = b[0] * 0x1000000 + b[1] * 0x10000 + b[2] * 0x100 + b[3];
  if (magic !== 0x0061736d) throw new Error(`WASM 解析失败：magic 非法（${b.subarray(0, 4).toString("hex")}，应为 0061736d "\\0asm"）`);
  const version = b.readUInt32LE(4);
  if (version !== 1) throw new Error(`WASM 解析失败：版本 ${version} 不支持（当前二进制规范版本 1）`);

  const lines = [
    "=== WebAssembly 结构解析 ===",
    `magic = 0061736d（"\\0asm"）✓`,
    `version = ${version}（u32 LE）`,
    `文件大小 = ${b.length} 字节`,
    "",
  ];
  const stats = { imports: [], exports: [], sections: [], types: 0, funcs: 0 };
  let off = 8;
  let lastId = -1, lastRank = -1; // 除 custom(0) 外按逻辑序检查（datacount 特例见 LOGIC_RANK）
  let secIdx = 0;
  while (off < b.length) {
    const secStart = off;
    const id = b[off++];
    if (id > 12) throw new Error(`WASM 解析失败（偏移 ${secStart}）：未知 section id ${id}（0-12）`);
    const [size, contentStart] = uleb(b, off, `section#${secIdx} size`);
    if (contentStart + size > b.length) throw new Error(`WASM 解析失败（偏移 ${secStart}）：section ${id}（${SECTION_NAMES[id]}）内容越界（声明 ${size} 字节，仅剩 ${b.length - contentStart}）`);
    if (id !== 0) {
      const rank = LOGIC_RANK[id];
      if (rank <= lastRank) throw new Error(`WASM 解析失败（偏移 ${secStart}）：section id ${id} 违反逻辑顺序（spec：type→import→…→element→datacount→code→data；前一个 = ${lastId}）`);
      lastRank = rank;
      lastId = id;
    }
    const cEnd = contentStart + size;
    let note = "";
    const c = b.subarray(contentStart, cEnd);

    if (id === 0) {
      const [nm, p] = name(c, 0, "custom section 名");
      note = `name="${nm}"`;
      if (nm === "name") {
        // name 子节（§二进制附加规范）：子 id + size；0=subsection funcnames
        try {
          let q = p;
          const details = [];
          while (q < c.length) {
            const subId = c[q++];
            const [sz, sp] = uleb(c, q, "name subsection size");
            q = sp;
            if (subId === 1) { // function names
              const [cnt, q1] = uleb(c, q, "names count");
              let qq = q1, first = "";
              for (let k = 0; k < cnt && k < 8; k++) {
                const [idx, qa] = uleb(c, qq, "func idx");
                const [nm2, qb] = name(c, qa, `func #${idx} 名`);
                if (k === 0) first = nm2;
                qq = qb;
              }
              details.push(`函数名 ${cnt} 条（如 #0="${first}"）`);
            } else if (subId === 0) {
              details.push(`module 名`);
            } else if (subId === 2 || subId === 4 || subId === 5 || subId === 6 || subId === 7) {
              details.push(`子节#${subId}`);
            } else if (subId === 3) {
              details.push(`local 名`);
            } else if (subId === 8 || subId === 9 || subId === 10 || subId === 11) {
              details.push(`子节#${subId}`);
            }
            q += sz;
          }
          if (details.length) note += `（${details.join("，")}）`;
        } catch { note += "（name 子节解析失败，不影响结构）"; }
      }
    } else if (id === 1) {
      const [cnt, q1] = uleb(c, 0, "type count");
      stats.types = cnt;
      const sigs = [];
      let q = q1;
      let parsed = 0, stopReason = "";
      for (let k = 0; k < cnt && sigs.length < 6; k++) {
        if (c[q] !== 0x60) { // 扩展类型（GC struct/array/sub、rec 等）：尽力即止，不硬报错
          stopReason = `；type #${k} 起为扩展类型（首字节 0x${c[q].toString(16)}，不展开）`;
          break;
        }
        q++;
        const [np, q2] = uleb(c, q, `type #${k} 参数数`);
        const params = [];
        let qq = q2;
        for (let j = 0; j < np; j++) { const [t, qa] = valType(c, qq, `type #${k} 参数${j}`); params.push(t); qq = qa; }
        const [nr, q3] = uleb(c, qq, `type #${k} 返回数`);
        const rets = [];
        qq = q3;
        for (let j = 0; j < nr; j++) { const [t, qa] = valType(c, qq, `type #${k} 返回${j}`); rets.push(t); qq = qa; }
        sigs.push(`(${params.join(",")})→(${rets.join(",")})`); parsed++;
      }
      note = `${cnt} 个类型条目，函数签名 ${parsed} 个${sigs.length ? `，如 ${sigs[0]}` : ""}${stopReason || (cnt > parsed ? `；其余 ${cnt - parsed} 条不展开` : (cnt > 6 ? " …" : ""))}`;
    } else if (id === 2) {
      const [cnt, q1] = uleb(c, 0, "import count");
      let q = q1;
      for (let k = 0; k < cnt; k++) {
        const [mod, qa] = name(c, q, `import #${k} module`);
        const [nm, nmEnd] = name(c, qa, `import #${k} name`);
        if (nmEnd >= c.length) throw new Error(`WASM 解析失败：import #${k} kind 越界`);
        const kind = c[nmEnd];
        let q2 = nmEnd + 1;
        if (kind > 3) throw new Error(`WASM 解析失败（偏移 ${contentStart + qb - 1}）：import #${k} 未知 kind ${kind}`);
        stats.imports.push(`${mod}.${nm} (${KINDS[kind]})`);
        // kind 后的类型索引/描述按宽度跳过（func: uleb；table/mem/global: 类型描述——此处只展示，不做完整类型树）
        if (kind === 0) { const [, qa2] = uleb(c, q2, `import #${k} typeidx`); q = qa2; }
        else if (kind === 3) { q = q2 + 2; } // valtype + mutability
        else { // table/mem：limits（flags uleb + min + [max]）
          const [flags, qa2] = uleb(c, q2, `import #${k} limits flags`);
          let qq = qa2;
          const [, qa3] = uleb(c, qq, "limits min"); qq = qa3;
          if (flags & 1) { const [, qa4] = uleb(c, qq, "limits max"); qq = qa4; }
          q = qq;
        }
      }
      note = `${cnt} 个导入${stats.imports.length ? `，前 3：${stats.imports.slice(0, 3).join("，")}${cnt > 3 ? " …" : ""}` : ""}`;
    } else if (id === 3) {
      const [cnt] = uleb(c, 0, "function count");
      stats.funcs = cnt;
      note = `${cnt} 个函数（typeidx 列表，实体在 code 段）`;
    } else if (id === 5) {
      const [cnt, q1] = uleb(c, 0, "memory count");
      const [flags, q2] = uleb(c, q1, "limits flags");
      const [min] = uleb(c, q2, "limits min");
      note = `${cnt} 个 memory，min=${min} 页（64KiB/页）${flags & 1 ? "（含 max）" : ""}`;
    } else if (id === 7) {
      const [cnt, q1] = uleb(c, 0, "export count");
      let q = q1;
      for (let k = 0; k < cnt; k++) {
        const [nm, nmEnd] = name(c, q, `export #${k} name`);
        const kind = c[nmEnd];
        const [idx, idxEnd] = uleb(c, nmEnd + 1, `export #${k} idx`);
        stats.exports.push(`${nm} (${KINDS[kind]} #${idx})`);
        q = idxEnd;
      }
      note = `${cnt} 个导出${stats.exports.length ? `，前 3：${stats.exports.slice(0, 3).join("，")}${cnt > 3 ? " …" : ""}` : ""}`;
    } else if (id === 8) {
      const [idx] = uleb(c, 0, "start func idx");
      note = `起始函数 #${idx}`;
    } else if (id === 11) {
      const [cnt] = uleb(c, 0, "data segment count");
      note = `${cnt} 个 data 段`;
    } else if (id === 10) {
      const [cnt] = uleb(c, 0, "code entry count");
      note = `${cnt} 个函数体（不做反编译）`;
    } else if (id === 9) {
      const [cnt] = uleb(c, 0, "element count");
      note = `${cnt} 个 element 段`;
    } else if (id === 4) {
      const [cnt] = uleb(c, 0, "table count");
      note = `${cnt} 个 table`;
    } else if (id === 6) {
      const [cnt] = uleb(c, 0, "global count");
      note = `${cnt} 个 global`;
    } else if (id === 12) {
      const [cnt] = uleb(c, 0, "datacount");
      note = `${cnt} 个 data 段（计数声明）`;
    }

    lines.push(`section #${secIdx}：id=${id}（${SECTION_NAMES[id]}）偏移 ${contentStart}..${cEnd}（${size} 字节）${note}`);
    stats.sections.push(id);
    off = cEnd;
    secIdx++;
  }
  lines.push("", `共 ${secIdx} 个 section；导入 ${stats.imports.length} / 导出 ${stats.exports.length} / 类型 ${stats.types} / 函数 ${stats.funcs}`);
  return lines.join("\n");
}

register({
  id: "wasmParse",
  cat: "filefmt",
  name: "WASM 结构解析",
  desc: "WebAssembly 二进制结构解析（W3C 规范 §5 Binary Format，只解析展示不反编译不执行）：magic/version、逐 section（id/偏移/大小，custom 段解 name 子节）、type 签名、import/export 清单（模块.名字/kind/索引）、memory/table/起始函数。LEB128 严格校验（截断/越界/section 顺序违规显式报错）。输入 wasm 文件字节或 hex",
  acceptsBytes: true,
  params: [],
  run: (t, p) => {
    const raw = p && p.rawBytes;
    let b;
    if (raw) b = raw;
    else {
      const s = String(t ?? "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
      if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error("输入非法：须为 wasm 文件字节或偶数位 hex");
      b = Buffer.from(s, "hex");
    }
    return parseWasm(b instanceof Uint8Array && !(b instanceof Buffer) ? Buffer.from(b) : b);
  },
});
