/*
 * difftool.js — 差异对比工具（cat:'data'）。A/B 两个同等级输入。
 *
 * 定位：纯函数字节级 / 行级 diff，输出差异区间报告。CTF 找隐藏差异用
 * （两段看似相同的 hex / 文本，定位被改动的字节 / 行）。
 *
 * 覆盖（run 单向，返回多行报告文本）：
 * diffTool 差异对比（byte 逐字节 / line 逐行，LCS 对齐，等长快速路径）
 *
 * 输入契约：
 * - fields.A / fields.B：同等级、可交换。每项可为
 *     "文本"                                  → 文本槽（字面 UTF-8）
 *     { kind:"text",  value:"…", encoding? }  → 文本槽；encoding 只接受 "utf8"
 *     { kind:"bytes", value: Uint8Array|… }   → 字节槽
 *     Uint8Array / ArrayBuffer / number[]     → 字节槽（简写）
 * - 旧通道（保持不变）：主输入 = A（文本；或 params.rawBytes 作为 A 的真字节），
 *   params.textB = B 文本。inputContract 的显式别名 params.textB → fields.textB 也照收。
 * - 一个输入只允许一个来源：fields.A 与主输入同时给出、或 fields.B 与 params.textB
 *   同时给出且不一致 → 直接报错，不做优先级猜测。
 * - inputEnc（byte 模式）：auto / hex / base64 / utf8 四档语义——
 *   auto 只按 **A 的文本视图** 探测一档（hex → base64 → utf8），同一档同时套用到 A 和 B 的
 *   **文本槽**；字节槽绕过 inputEnc 直接参与 diff（即 params.rawBytes 通道）。
 *   不新增「按 B 探测」「按字段猜编码」等任何隐式规则。
 * - line 模式：文本按 /\r?\n/ 分行，忽略 inputEnc；字节槽先按 UTF-8 解码成文本再分行。
 *
 * 红线：
 * - 只 import registry.js，不碰 inputContract / main / 其他 core。
 * - 纯函数，无 DOM / 无副作用，node 可直跑。
 * - 输入上限（每段 256KB）按文本视图长度计（字节槽同）。
 * - LCS 乘积超 2e6 回退朴素 diff。
 */

import { register } from "./registry.js";

// ---------------- 常量 ----------------
const MAX_INPUT = 256 * 1024; // 每段输入上限 256KB

/** 取视图真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** 视图 text 模式字节与文本同构时让位给原文本层；真字节（hex/base64 视图、文件）原样优先。 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}

const TD = new TextDecoder("utf-8");
const LCS_CELL_CAP = 2_000_000; // LCS DP 格子数上限，超出回退朴素 diff

const INPUT_ENC_PARAM = {
  key: "inputEnc",
  label: "输入编码（byte 模式）",
  type: "select",
  default: "auto",
  options: [
    { value: "auto", label: "自动（hex/base64/UTF-8）" },
    { value: "hex", label: "Hex" },
    { value: "base64", label: "Base64" },
    { value: "utf8", label: "UTF-8 文本" },
  ],
};

// ---------------- 输入解码（自实现，低耦合，不依赖 compress.js） ----------------
function _strip(s) {
  return s.replace(/\s+/g, "");
}
function isHex(s) {
  const t = _strip(s);
  return t.length > 0 && t.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(t);
}
function isBase64(s) {
  const t = _strip(s);
  return t.length > 0 && t.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(t);
}
function hexToBytes(s) {
  const t = _strip(s);
  if (t.length % 2 !== 0) throw new Error("Hex 长度不是偶数");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(t.substr(i * 2, 2), 16);
  }
  return out;
}
function base64ToBytes(s) {
  const t = _strip(s);
  if (typeof atob !== "function") {
 // 极少数环境无 atob，用 Buffer 兜底（node 始终有）
    const buf = Buffer.from(t, "base64");
    return new Uint8Array(buf);
  }
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function utf8ToBytes(s) {
  return new TextEncoder().encode(s);
}
function bytesToHex(bytes, max = 64) {
  const n = Math.min(bytes.length, max);
  let s = "";
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += `…(${bytes.length}B)`;
  return s;
}
function bytesAscii(bytes, max = 16) {
  const n = Math.min(bytes.length, max);
  let s = "";
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    s += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·";
  }
  if (bytes.length > max) s += "…";
  return s;
}

/** 探测 auto 模式下应使用的编码（依据 A）。 */
function detectEnc(text) {
  if (isHex(text)) return "hex";
  if (isBase64(text)) return "base64";
  return "utf8";
}
function toBytes(text, enc) {
  if (enc === "hex") return hexToBytes(text);
  if (enc === "base64") return base64ToBytes(text);
  if (enc === "utf8") return utf8ToBytes(text);
  return utf8ToBytes(text);
}

// ---------------- A/B 同等级输入解析（旧通道语义不变） ----------------
const FIELD_KEYS = ["A", "B", "textB"]; // textB = inputContract 的显式旧别名，只作 B 的兜底

/** 字节槽取值：Uint8Array / ArrayBuffer / 任意视图 / number[] 一律按裸字节，不做编码解释。 */
function asBytes(v, label) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  throw new Error(`字段 ${label} 的字节槽需要 Uint8Array / ArrayBuffer / 字节数组`);
}

/** 归一一个输入槽；null/undefined → null（表示「未提供」，交给旧通道）。 */
function slotOf(v, label) {
  if (v == null) return null;
  if (typeof v === "string") return { kind: "text", value: v };
  if (v instanceof Uint8Array || v instanceof ArrayBuffer || ArrayBuffer.isView(v)) {
    return { kind: "bytes", value: asBytes(v, label) };
  }
  if (typeof v === "object") {
    const kind = v.kind;
    if (kind === "text") {
      if (typeof v.value !== "string") throw new Error(`字段 ${label} 的文本槽 value 必须是字符串`);
      const encoding = v.encoding ?? "utf8";
      if (encoding !== "utf8") {
        throw new Error(`字段 ${label} 的文本槽编码只接受 utf8（收到 ${encoding}）：字节请用字节槽，或统一走 inputEnc`);
      }
      return { kind: "text", value: v.value };
    }
    if (kind === "bytes") return { kind: "bytes", value: asBytes(v.value, label) };
  }
  throw new Error(`字段 ${label} 既不是文本槽也不是字节槽（拿到 ${JSON.stringify(v)}）`);
}

/**
 * 把「fields 新通道」与「主输入 + params.textB 旧通道」归一到 { aSlot, bSlot }。
 * 旧调用（无 fields 键）路径：A = rawBytes ?? 主输入文本，B = params.textB ?? ""。
 */
function resolvePair(textA, p) {
  const fields = p && p.fields;
  let aSlot = null;
  let bSlot = null;
  if (fields != null) {
    if (typeof fields !== "object") throw new Error("fields 必须是对象");
    for (const key of Object.keys(fields)) {
      if (!FIELD_KEYS.includes(key)) throw new Error(`未知输入字段: ${key}（本工具只接受 A / B / textB）`);
    }
    aSlot = slotOf(fields.A, "A");
    bSlot = slotOf(fields.B, "B");
    if (!bSlot) bSlot = slotOf(fields.textB, "textB");
    const legacyB = p.textB ?? "";
    if (bSlot && p.textB != null && !(bSlot.kind === "text" && bSlot.value === legacyB)) {
      throw new Error("fields.B 与 params.textB 同时给出且不一致：一个输入只允许一个来源");
    }
    if (aSlot && (String(textA == null ? "" : textA).length > 0 || rawBytesOf(p))) {
      throw new Error("fields.A 与主输入同时给出：一个输入只允许一个来源");
    }
  }
  if (!aSlot) {
    const raw = rawBytesOrNull(p, textA);
    aSlot = raw ? { kind: "bytes", value: raw } : { kind: "text", value: textA };
  }
  if (!bSlot) {
    bSlot = { kind: "text", value: p.textB ?? "" };
  }
  return { aSlot, bSlot };
}

// ---------------- diff 核心：操作序列 {t:'eq'|'del'|'ins', i?, j?} ----------------

/** 经典 LCS 回溯，返回完整操作序列。a/b 为数组（字节码 number[] 或行 string[]）。 */
function lcsOps(a, b) {
  const n = a.length;
  const m = b.length;
  const stride = m + 1;
  const dp = new Int32Array((n + 1) * stride);
  for (let i = n - 1; i >= 0; i--) {
    const rowBase = i * stride;
    const nextRow = (i + 1) * stride;
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[rowBase + j] = dp[nextRow + (j + 1)] + 1;
      } else {
        const down = dp[nextRow + j];
        const right = dp[rowBase + (j + 1)];
        dp[rowBase + j] = down >= right ? down : right;
      }
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: "eq", i, j });
      i++;
      j++;
    } else {
      const down = dp[(i + 1) * stride + j];
      const right = dp[i * stride + (j + 1)];
      if (down >= right) {
        ops.push({ t: "del", i });
        i++;
      } else {
        ops.push({ t: "ins", j });
        j++;
      }
    }
  }
  while (i < n) {
    ops.push({ t: "del", i });
    i++;
  }
  while (j < m) {
    ops.push({ t: "ins", j });
    j++;
  }
  return ops;
}

/** 等长快速路径：逐位比对，差异位产出 del+ins 对。 */
function equalLenOps(a, b) {
  const ops = [];
  for (let k = 0; k < a.length; k++) {
    if (a[k] === b[k]) {
      ops.push({ t: "eq", i: k, j: k });
    } else {
      ops.push({ t: "del", i: k });
      ops.push({ t: "ins", j: k });
    }
  }
  return ops;
}

/** 朴素 diff：公共前缀 + 公共后缀 + 中段 del/ins。O(n+m)，LCS 过大时回退用。 */
function naiveOps(a, b) {
  const n = a.length;
  const m = b.length;
  let pre = 0;
  while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const ops = [];
  for (let k = 0; k < pre; k++) ops.push({ t: "eq", i: k, j: k });
  for (let k = pre; k < n - suf; k++) ops.push({ t: "del", i: k });
  for (let k = pre; k < m - suf; k++) ops.push({ t: "ins", j: k });
  for (let k = 0; k < suf; k++) ops.push({ t: "eq", i: n - suf + k, j: m - suf + k });
  return ops;
}

/** 选择 diff 策略，返回 { ops, kind }。 */
function diffSeq(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === m) return { ops: equalLenOps(a, b), kind: "等长逐位" };
  if (n === 0 || m === 0) {
    const ops = [];
    for (let i = 0; i < n; i++) ops.push({ t: "del", i });
    for (let j = 0; j < m; j++) ops.push({ t: "ins", j });
    return { ops, kind: n === 0 ? "A 空" : "B 空" };
  }
  if (n * m > LCS_CELL_CAP) return { ops: naiveOps(a, b), kind: "朴素（输入过大）" };
  return { ops: lcsOps(a, b), kind: "LCS" };
}

// ---------------- 统计 + hunk 聚合 ----------------
function statOps(ops) {
  let eq = 0;
  let del = 0;
  let ins = 0;
  for (const o of ops) {
    if (o.t === "eq") eq++;
    else if (o.t === "del") del++;
    else ins++;
  }
  return { eq, del, ins };
}

/** 把 ops 按 change 聚合成 hunk，每个 hunk 含 context 个 eq 上下文。返回 hunk 数组。 */
function buildHunks(ops, context) {
  const changeIdx = [];
  for (let k = 0; k < ops.length; k++) {
    if (ops[k].t !== "eq") changeIdx.push(k);
  }
  if (changeIdx.length === 0) return [];
  const ranges = [];
  for (const k of changeIdx) {
    const start = Math.max(0, k - context);
    const end = Math.min(ops.length - 1, k + context);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }
  return ranges.map((r) => ops.slice(r.start, r.end + 1));
}

// ---------------- 渲染 ----------------
function hexOff(n) {
  return "0x" + n.toString(16).toUpperCase();
}

/** 把一个 hunk 内连续同类型 op 聚合成 run，便于成块显示。 */
function groupRuns(hunkOps) {
  const runs = [];
  for (const op of hunkOps) {
    const last = runs[runs.length - 1];
    if (last && last.t === op.t) last.items.push(op);
    else runs.push({ t: op.t, items: [op] });
  }
  return runs;
}

function renderByte(aBytes, bBytes, ops, context, kind, enc) {
  const st = statOps(ops);
  const lines = [];
  lines.push("差异对比 · byte 模式" + (enc === "auto" ? "" : `（编码: ${enc}）`));
  lines.push(
    `A = ${aBytes.length} 字节 | B = ${bBytes.length} 字节 | 策略: ${kind}`
  );
  lines.push(
    `相同 ${st.eq} | 仅 A ${st.del} | 仅 B ${st.ins} | 差异块计数见下`
  );
  if (st.del === 0 && st.ins === 0) {
    lines.push("");
    lines.push("✓ 两段输入完全一致，无差异。");
    return lines.join("\n");
  }
  const hunks = buildHunks(ops, context);
  lines.push("");
  lines.push(`差异块: ${hunks.length}`);
  lines.push("");
  hunks.forEach((hunk, idx) => {
 // hunk 覆盖的 A / B 区间
    let aMin = -1;
    let aMax = -1;
    let bMin = -1;
    let bMax = -1;
    for (const op of hunk) {
      if (op.i !== undefined) {
        if (aMin === -1) aMin = op.i;
        aMax = op.i;
      }
      if (op.j !== undefined) {
        if (bMin === -1) bMin = op.j;
        bMax = op.j;
      }
    }
    const aRange = aMin === -1 ? "∅" : `${hexOff(aMin)}-${hexOff(aMax)}`;
    const bRange = bMin === -1 ? "∅" : `${hexOff(bMin)}-${hexOff(bMax)}`;
    lines.push(`[${idx + 1}] @@ A:${aRange} | B:${bRange} @@`);
    const runs = groupRuns(hunk);
    for (const run of runs) {
      if (run.t === "eq") {
        const i0 = run.items[0].i;
        const i1 = run.items[run.items.length - 1].i;
        const slice = aBytes.slice(i0, i1 + 1);
        lines.push(
          `  = @${hexOff(i0)} (${slice.length}B)  ${bytesToHex(slice)}  '${bytesAscii(slice)}'`
        );
      } else if (run.t === "del") {
        const i0 = run.items[0].i;
        const i1 = run.items[run.items.length - 1].i;
        const slice = aBytes.slice(i0, i1 + 1);
        lines.push(
          `  - A @${hexOff(i0)} (${slice.length}B)  ${bytesToHex(slice)}  '${bytesAscii(slice)}'`
        );
      } else {
        const j0 = run.items[0].j;
        const j1 = run.items[run.items.length - 1].j;
        const slice = bBytes.slice(j0, j1 + 1);
        lines.push(
          `  + B @${hexOff(j0)} (${slice.length}B)  ${bytesToHex(slice)}  '${bytesAscii(slice)}'`
        );
      }
    }
    lines.push("");
  });
  return lines.join("\n");
}

function renderLine(aLines, bLines, ops, context, kind) {
  const st = statOps(ops);
  const lines = [];
  lines.push("差异对比 · line 模式");
  lines.push(`A = ${aLines.length} 行 | B = ${bLines.length} 行 | 策略: ${kind}`);
  lines.push(`相同 ${st.eq} | 仅 A ${st.del} | 仅 B ${st.ins}`);
  if (st.del === 0 && st.ins === 0) {
    lines.push("");
    lines.push("✓ 两段输入完全一致，无差异。");
    return lines.join("\n");
  }
  const hunks = buildHunks(ops, context);
  lines.push("");
  lines.push(`差异块: ${hunks.length}`);
  lines.push("");
  hunks.forEach((hunk, idx) => {
    let aMin = -1;
    let aMax = -1;
    let bMin = -1;
    let bMax = -1;
    for (const op of hunk) {
      if (op.i !== undefined) {
        if (aMin === -1) aMin = op.i;
        aMax = op.i;
      }
      if (op.j !== undefined) {
        if (bMin === -1) bMin = op.j;
        bMax = op.j;
      }
    }
    const aRange = aMin === -1 ? "∅" : `L${aMin + 1}-L${aMax + 1}`;
    const bRange = bMin === -1 ? "∅" : `L${bMin + 1}-L${bMax + 1}`;
    lines.push(`[${idx + 1}] @@ A:${aRange} | B:${bRange} @@`);
    const runs = groupRuns(hunk);
    for (const run of runs) {
      if (run.t === "eq") {
        const i0 = run.items[0].i;
        const i1 = run.items[run.items.length - 1].i;
        lines.push(`  = A L${i0 + 1}: ${aLines[i0]}`);
        if (i1 !== i0) lines.push(`    …至 L${i1 + 1}: ${aLines[i1]}`);
      } else if (run.t === "del") {
        for (const it of run.items) lines.push(`  - A L${it.i + 1}: ${aLines[it.i]}`);
      } else {
        for (const it of run.items) lines.push(`  + B L${it.j + 1}: ${bLines[it.j]}`);
      }
    }
    lines.push("");
  });
  return lines.join("\n");
}

// ---------------- run ----------------
function diffRun(textA, p) {
  const { aSlot, bSlot } = resolvePair(textA, p);
  // 文本视图：字节槽按 UTF-8 解码成文本视图（与 rawBytes 路径的 TD.decode 一致）。
  const aText = aSlot.kind === "bytes" ? TD.decode(aSlot.value) : aSlot.value;
  const bText = bSlot.kind === "bytes" ? TD.decode(bSlot.value) : bSlot.value;
  const mode = p.mode || "byte";
  const context = Math.max(0, Math.floor(Number(p.context) || 0));

  if (aText.length > MAX_INPUT || bText.length > MAX_INPUT) {
    throw new Error(`单段输入超过 ${MAX_INPUT} 字节上限，请裁剪后重试`);
  }

  if (mode === "line") {
    const aLines = aText.length === 0 ? [] : aText.split(/\r?\n/);
    const bLines = bText.length === 0 ? [] : bText.split(/\r?\n/);
    const { ops, kind } = diffSeq(aLines, bLines);
    return renderLine(aLines, bLines, ops, context, kind);
  }

 // byte 模式
  let enc = p.inputEnc || "auto";
  if (enc === "auto") enc = detectEnc(aText);
  let aBytes = aSlot.kind === "bytes" ? aSlot.value : null;
  let bBytes = bSlot.kind === "bytes" ? bSlot.value : null;
  if (aBytes == null) {
    try {
      aBytes = toBytes(aText, enc);
    } catch (e) {
      throw new Error(`A 解码失败（${enc}）: ${e.message}`);
    }
  }
  if (bBytes == null) {
    try {
      bBytes = toBytes(bText, enc);
    } catch (e) {
      throw new Error(`B 解码失败（${enc}）: ${e.message}`);
    }
  }
  const { ops, kind } = diffSeq(aBytes, bBytes);
  return renderByte(aBytes, bBytes, ops, context, kind, p.inputEnc || "auto");
}

// ---------------- 注册 ----------------
register({
  id: "diffTool",
  acceptsBytes: true,
  cat: "data",
  name: "差异对比",
  desc: "两段同等级输入逐字节 / 逐行 diff，定位差异区间（等长快速路径 + 不等长 LCS 对齐，CTF 找隐藏差异）",
 // A/B 两个同等级输入，各自可为文本槽或字节槽；fieldsJoin 不适用（两输入不拼串）。
 // params.textB 保留为旧通道（兼容既有配方 / CSV / MCP 调用），新调用走 fields.B。
  fieldsMode: "slots", // 各字段不拼串，原样作为 params.fields 交给 run
  fields: [
    {
      key: "A",
      label: "输入 A",
      accepts: ["text", "bytes"],
      placeholder: "文本；或按「输入编码」解释的 hex / base64",
      rows: 3,
    },
    {
      key: "B",
      mirrorParam: "textB", // 旧通道同步：批处理 / 配方 / 分享链接仍按 params.textB 取 B
      label: "输入 B",
      accepts: ["text", "bytes"],
      placeholder: "文本；或按「输入编码」解释的 hex / base64",
      rows: 3,
    },
  ],
  params: [
    {
      key: "textB",
      uiHidden: true, // 工作台用字段框 B；本参数只作旧调用通道
      label: "输入 B（对比基准）",
      type: "text",
      default: "",
      placeholder: "粘贴第二段文本 / hex / base64",
    },
    {
      key: "mode",
      label: "对比模式",
      type: "select",
      default: "byte",
      options: [
        { value: "byte", label: "逐字节（hex/base64/utf8）" },
        { value: "line", label: "逐行（文本）" },
      ],
    },
    INPUT_ENC_PARAM,
    {
      key: "context",
      label: "上下文（行/字节）",
      type: "number",
      default: 0,
      placeholder: "差异周围显示的等同样本数",
    },
  ],
  run: diffRun,
});

export { diffSeq, lcsOps, equalLenOps, naiveOps, buildHunks, statOps, toBytes, detectEnc, resolvePair, slotOf };
