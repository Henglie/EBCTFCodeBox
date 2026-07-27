/*
 * difftool.js — 差异对比工具（T92，cat:'analysis'）。
 *
 * 定位：纯函数字节级 / 行级 diff，输出差异区间报告。CTF 找隐藏差异用
 * （两段看似相同的 hex / 文本，定位被改动的字节 / 行）。
 *
 * 覆盖（run 单向，返回多行报告文本）：
 * diffTool 差异对比（byte 逐字节 / line 逐行，LCS 对齐，等长快速路径）
 *
 * 算法（照公开算法实现，不编造）：
 * - 等长输入：逐位置比对，连续差异聚合成块，O(n) 精确（CTF「找一个被改字节」主场景）。
 * - 不等长输入：经典 LCS 动态规划回溯，产出 equal/del/ins 操作序列；n*m 过大时
 * 回退到前缀 / 后缀公共 + 中段 del/ins 的朴素 diff（O(n+m)，防内存炸）。
 * - 输入编码：auto / hex / base64 / utf8（byte 模式按编码转字节；auto 时以 A 探测
 * 出的编码同时套用到 B，避免两边解释不一致）。line 模式按 UTF-8 文本分行，忽略编码。
 *
 * 红线：
 * - 只新建本文件，只 import registry.js，不碰其他 core / main.js / i18n 主表。
 * - 纯函数，无 DOM / 无副作用，node 可直跑。
 * - 输入设上限（每段 256KB）；LCS 乘积超 2e6 回退朴素 diff。
 *
 * 不冲突现有 op id：analysis 现有 protobufParse/msgpackParse/cborParse/bsonParse/
 * phpSerializeParse/javaSerializeIdent（serial.js）等，无 diff* id。
 */
import { register } from "./registry.js";

// ---------------- 常量 ----------------
const MAX_INPUT = 256 * 1024; // 每段输入上限 256KB
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
  const textB = p.textB ?? "";
  const mode = p.mode || "byte";
  const context = Math.max(0, Math.floor(Number(p.context) || 0));

  if (textA.length > MAX_INPUT || textB.length > MAX_INPUT) {
    throw new Error(`单段输入超过 ${MAX_INPUT} 字节上限，请裁剪后重试`);
  }

  if (mode === "line") {
    const aLines = textA.length === 0 ? [] : textA.split(/\r?\n/);
    const bLines = textB.length === 0 ? [] : textB.split(/\r?\n/);
    const { ops, kind } = diffSeq(aLines, bLines);
    return renderLine(aLines, bLines, ops, context, kind);
  }

 // byte 模式
  let enc = p.inputEnc || "auto";
  if (enc === "auto") enc = detectEnc(textA);
  let aBytes;
  let bBytes;
  try {
    aBytes = toBytes(textA, enc);
  } catch (e) {
    throw new Error(`A 解码失败（${enc}）: ${e.message}`);
  }
  try {
    bBytes = toBytes(textB, enc);
  } catch (e) {
    throw new Error(`B 解码失败（${enc}）: ${e.message}`);
  }
  const { ops, kind } = diffSeq(aBytes, bBytes);
  return renderByte(aBytes, bBytes, ops, context, kind, p.inputEnc || "auto");
}

// ---------------- 注册 ----------------
register({
  id: "diffTool",
  cat: "data",
  name: "差异对比",
  desc: "两段输入逐字节 / 逐行 diff，定位差异区间（等长快速路径 + 不等长 LCS 对齐，CTF 找隐藏差异）",
  params: [
    {
      key: "textB",
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

export { diffSeq, lcsOps, equalLenOps, naiveOps, buildHunks, statOps, toBytes, detectEnc };
