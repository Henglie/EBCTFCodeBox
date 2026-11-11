/*
 * ftpExtract.js — FTP 控制/数据流配对与对象提取（cat:'forensic'，单向 run）。
 *
 * 建在 pcapDeep.js 的 TCP 重组之上（RFC 793 seq 排序去重 + 缺段诊断），按 RFC 959 / RFC 2428
 * 解析 FTP 控制通道（USER/PASS/TYPE/PORT/PASV/EPSV/RETR/STOR/LIST 与 227/229/150/226 应答），
 * 把控制命令与数据连接按 5 元组配对，导出数据连接承载的文件原字节。
 *
 * 能力与边界（照规范实现，不编造）：
 * 1) 主动模式 PORT h1,h2,h3,h4,p1,p2（客户端监听，RFC 959 §5.2）/ EPRT |1|ip|port|
 * 2) 被动模式 PASV → 227 Entering Passive Mode (h1,h2,h3,h4,p1,p2)（RFC 959）
 * 3) 扩展被动 EPSV → 229 Entering Extended Passive Mode (|||port|)（RFC 2428，IP 同控制连接服务器侧）
 * 4) 多会话：每个控制连接独立成会话，逐会话配对
 * 5) ASCII/二进制标注：TYPE A/I 跟踪；提取字节以线上捕获字节为准（ASCII 模式下行尾
 *    转换如已发生则以捕获为准，如实输出并标注）
 * 6) 单向取证：只解析已捕获流量，不建联网 FTP 客户端
 *
 * 配对口径（限制显式给出，不冒充确定事实）：
 * - 控制两方向独立成流，命令/应答的精确交错顺序不可恢复；按流内顺序将第 i 个数据端点
 *   公告（PORT/EPRT 命令或 227/229 应答）配给第 i 个传输命令（RETR/STOR/APPE/LIST/NLST/MLSD），
 *   数据连接按端点 5 元组匹配、按首见包序消费、每流只消费一次（同端口复用仅首个可见）。
 * - FTPS（控制通道加密）不做深度解析：控制流不可打印时显式报「疑似 FTPS」。
 *
 * 契约：件内自注册，只 import { register }；run 返回文本或 { text, files }（产物协议）。
 */
import { register } from "./registry.js";
import { decodePcap, reassembleFlows, reassembleDir } from "./pcapDeep.js";
import { sha256Hex } from "./shaExt.js";

// ============================================================
// 小工具（与 pcapDeep 同风格，件内私有）
// ============================================================
function toHex(bytes, start, end) {
  let s = "";
  const e = end === undefined ? bytes.length : end;
  for (let i = start || 0; i < e; i++) {
    const v = bytes[i];
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}
function latin1(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
  }
  return out;
}
function asciiPreview(bytes, limit) {
  const n = Math.min(bytes.length, limit || 64);
  let out = "";
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    out += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  return out;
}
function isMostlyText(bytes, limit) {
  const e = Math.min(bytes.length, limit || 512);
  if (e === 0) return true;
  let printable = 0;
  for (let i = 0; i < e; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) printable++;
    else if (b >= 0x80) printable += 0.5;
  }
  return printable / e > 0.85;
}
function sanitizeFileStem(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "out";
}

// 流字节按 CRLF 切行（容忍裸 LF，尾部残行丢弃并计数）
function splitLines(bytes) {
  const s = latin1(bytes);
  const lines = s.split(/\r\n|\n/);
  const truncatedTail = lines.length > 0 && lines[lines.length - 1] !== "";
  if (truncatedTail) lines.pop();
  return { lines: lines.filter((l) => l.length > 0), truncatedTail };
}

const FTP_CMDS = /^(USER|PASS|ACCT|TYPE|PORT|PASV|EPSV|EPRT|RETR|STOR|LIST|NLST|MLSD|APPE|REST|ABOR|QUIT|SYST|FEAT|PWD|CWD|CDUP|MKD|RMD|DELE|RNFR|RNTO|SIZE|MDTM|MODE|STRU|ALLO|NOOP|OPTS|AUTH|PBSZ|PROT|HELP|STAT|SITE)\b/i;

// ============================================================
// 控制流解析：命令/应答事件流
// ============================================================
function parseControl(clientBytes, serverBytes) {
  const c = splitLines(clientBytes);
  const s = splitLines(serverBytes);
  const cmds = [];
  for (const line of c.lines) {
    const m = line.match(/^([A-Za-z]{3,4})(?:[ \t]+(.*))?$/);
    if (!m || !FTP_CMDS.test(m[1])) continue;
    cmds.push({ cmd: m[1].toUpperCase(), arg: (m[2] || "").trim() });
  }
  const resps = [];
  for (const line of s.lines) {
    const m = line.match(/^(\d{3})([ -])(.*)$/);
    if (!m) continue;
    resps.push({ code: parseInt(m[1], 10), cont: m[2] === "-", text: m[3] });
  }
  return { cmds, resps, clientTruncated: c.truncatedTail, serverTruncated: s.truncatedTail };
}

// PORT h1,h2,h3,h4,p1,p2 → 主动模式数据端点（客户端侧）
function parsePortArg(arg) {
  const m = arg.match(/^(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3})$/);
  if (!m) return null;
  const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  const port = (parseInt(m[5], 10) << 8) | parseInt(m[6], 10);
  return (port > 0 && port < 65536) ? { ip, port } : null;
}
// EPRT |1|ip|port|（IPv4 档；IPv6 仅登记不配对）
function parseEprtArg(arg) {
  const m = arg.match(/^\|([12])\|([^|]+)\|(\d{1,5})\|$/);
  if (!m) return null;
  const port = parseInt(m[3], 10);
  if (port <= 0 || port >= 65536) return null;
  return m[1] === "1" ? { ip: m[2], port } : null;
}
// 227 应答文本 → 被动模式数据端点（服务器侧）
function parsePasvResp(text) {
  const m = text.match(/\((\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3}),(\d{1,3})\)/);
  if (!m) return null;
  const ip = `${m[1]}.${m[2]}.${m[3]}.${m[4]}`;
  const port = (parseInt(m[5], 10) << 8) | parseInt(m[6], 10);
  return (port > 0 && port < 65536) ? { ip, port } : null;
}
// 229 应答文本 → 扩展被动端口（RFC 2428：229 Entering Extended Passive Mode (|||port|)）
function parseEpsvResp(text) {
  const m = text.match(/\(([^)]*?)\)/);
  if (!m) return null;
  const pm = m[1].match(/^\|{3}(\d{1,5})\|?$/);
  if (!pm) return null;
  const port = parseInt(pm[1], 10);
  return (port > 0 && port < 65536) ? { port } : null;
}

const XFER_CMDS = new Set(["RETR", "STOR", "APPE", "LIST", "NLST", "MLSD"]);

// ============================================================
// run
// ============================================================
function ftpExtractRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;
  const ftpPort = parseInt(p.ftpPort, 10) || 21;
  const preview = parseInt(p.previewBytes, 10) || 400;
  const dumpSel = (p.dumpIndex === undefined || p.dumpIndex === null || String(p.dumpIndex).trim() === "") ? null : parseInt(p.dumpIndex, 10);

  const flows = reassembleFlows(res.dissected);
  if (flows.size === 0) return "未发现 TCP 段。FTP 提取依赖 TCP 重组，此流量中无 TCP。";

  // 有序流表 + 重组缓存
  const flowList = [];
  for (const [, flow] of flows) {
    const dirs = [];
    for (const [, dir] of flow.dirs) {
      const r = reassembleDir(dir, p);
      dirs.push({ label: `${dir.from} → ${dir.to}`, from: dir.from, to: dir.to, bytes: r.bytes, diag: r.diag });
    }
    flowList.push({ a: flow.a, b: flow.b, dirs, firstIndex: flow.firstIndex });
  }
  flowList.sort((x, y) => x.firstIndex - y.firstIndex);
  const usedFlows = new Set();

  // ---- 控制流识别：端口命中优先，其次内容特征（CTF 非标准端口）----
  const controlIdx = [];
  for (let i = 0; i < flowList.length; i++) {
    const f = flowList[i];
    const aPort = parseInt(f.a.split(":").pop(), 10);
    const bPort = parseInt(f.b.split(":").pop(), 10);
    if (aPort === ftpPort || bPort === ftpPort) { controlIdx.push({ i, basis: `端口 ${ftpPort}` }); continue; }
    if (!f.dirs.every((d) => d.bytes.length === 0 || isMostlyText(d.bytes, 2048))) continue;
    let hasCmd = false, hasResp = false;
    for (const d of f.dirs) {
      const head = latin1(d.bytes.subarray(0, Math.min(d.bytes.length, 256)));
      if (/^[A-Za-z]{3,4}[ \t]/.test(head) && FTP_CMDS.test(head)) hasCmd = true;
      if (/^\d{3}[ -]/.test(head)) hasResp = true;
    }
    if (hasCmd && hasResp) controlIdx.push({ i, basis: "内容特征（非标准端口）" });
  }

  if (controlIdx.length === 0) {
    const anyTextFlow = flowList.some((f) => f.dirs.some((d) => isMostlyText(d.bytes, 2048)));
    return anyTextFlow
      ? `未发现 FTP 控制连接（无端口 ${ftpPort} 命中，特征扫描无 FTP 命令/应答对）。若为非标准端口可调 ftpPort 参数。`
      : `未发现 FTP 控制连接（无端口 ${ftpPort} 命中；TCP 流均非明文——若为 FTPS（控制通道加密）则不支持深度解析，可用 TCP 流重组查看原始字节）。`;
  }

  // ---- 逐控制会话解析 + 配对 ----
  const sessions = [];
  for (const { i, basis } of controlIdx) {
    usedFlows.add(i);
    const f = flowList[i];
    // 方向判定：客户端方向首行是命令，服务器方向首行是应答
    let cDir = null, sDir = null;
    for (const d of f.dirs) {
      const head = latin1(d.bytes.subarray(0, Math.min(d.bytes.length, 128)));
      if (/^\d{3}[ -]/.test(head)) sDir = sDir || d;
      else if (/^[A-Za-z]{3,4}[ \t]/.test(head)) cDir = cDir || d;
    }
    if (!cDir || !sDir) {
      sessions.push({ flow: f, basis, error: "控制流方向判定失败（缺命令流或应答流），跳过深度解析", transfers: [] });
      continue;
    }
    const { cmds, resps, clientTruncated, serverTruncated } = parseControl(cDir.bytes, sDir.bytes);
    const serverIp = sDir.from.split(":").slice(0, -1).join(":");

    const creds = { user: null, pass: null };
    let type = "?"; // ASCII / binary
    const announcements = []; // 数据端点公告（流内顺序）
    const notes = [];
    if (clientTruncated) notes.push("命令流尾部有残行（未以 CRLF 结束）已丢弃");
    if (serverTruncated) notes.push("应答流尾部有残行（未以 CRLF 结束）已丢弃");

    for (const r of resps) {
      if (r.code === 227 && !r.cont) {
        const e = parsePasvResp(r.text);
        if (e) announcements.push({ kind: "PASV", ip: e.ip, port: e.port });
      } else if (r.code === 229 && !r.cont) {
        const e = parseEpsvResp(r.text);
        if (e) announcements.push({ kind: "EPSV", ip: serverIp, port: e.port });
      }
    }
    const xferCmds = [];
    for (const c of cmds) {
      if (c.cmd === "USER") creds.user = c.arg;
      else if (c.cmd === "PASS") creds.pass = c.arg;
      else if (c.cmd === "TYPE") {
        const t = (c.arg || "").toUpperCase().charAt(0);
        if (t === "A") type = "ASCII";
        else if (t === "I" || t === "L") type = "binary";
      } else if (c.cmd === "PORT") {
        const e = parsePortArg(c.arg);
        if (e) announcements.push({ kind: "PORT", ip: e.ip, port: e.port });
        else notes.push("PORT 参数无法解析: " + c.arg);
      } else if (c.cmd === "EPRT") {
        const e = parseEprtArg(c.arg);
        if (e) announcements.push({ kind: "EPRT", ip: e.ip, port: e.port });
        else if (c.arg) notes.push("EPRT 参数无法解析或不支持: " + c.arg);
      } else if (XFER_CMDS.has(c.cmd)) {
        xferCmds.push({ cmd: c.cmd, arg: c.arg });
      }
    }

    // 公告-传输命令位置配对（第 i 公告 ↔ 第 i 传输命令；交错不可恢复，口径已注）
    const transfers = [];
    for (let k = 0; k < xferCmds.length; k++) {
      const xc = xferCmds[k];
      const ann = announcements[k] || null;
      if (!ann) {
        transfers.push({ cmd: xc.cmd, arg: xc.arg, mode: "未捕获公告", data: null, note: "控制流中无对应 PORT/PASV/EPSV 公告（应答可能缺失）" });
        continue;
      }
      const key = `${ann.ip}:${ann.port}`;
      let matched = -1;
      for (let j = 0; j < flowList.length; j++) {
        if (usedFlows.has(j)) continue;
        const g = flowList[j];
        if (g.a === key || g.b === key) { matched = j; break; }
      }
      if (matched < 0) {
        transfers.push({ cmd: xc.cmd, arg: xc.arg, mode: `${ann.kind} ${key}`, data: null, note: "数据连接未捕获（公告端点无匹配 TCP 流）" });
        continue;
      }
      usedFlows.add(matched);
      const df = flowList[matched];
      // 方向按控制流服务器 IP 判侧（不依赖 key 语义：PORT 模式 key 在客户端侧，PASV 模式在服务器侧）
      const isUpload = xc.cmd === "STOR" || xc.cmd === "APPE";
      const ipOf = (ep) => ep.slice(0, ep.lastIndexOf(":"));
      const srvDir = df.dirs.find((d) => ipOf(d.from) === serverIp);
      const cliDir = df.dirs.find((d) => ipOf(d.from) !== serverIp);
      const dataDir = isUpload ? (cliDir || srvDir) : (srvDir || cliDir);
      transfers.push({
        cmd: xc.cmd, arg: xc.arg,
        mode: `${ann.kind} ${key}`,
        data: dataDir ? dataDir.bytes : new Uint8Array(0),
        diag: dataDir ? dataDir.diag : null,
        dataLabel: dataDir ? dataDir.label : "(无)",
        direction: isUpload ? "客户端→服务器（上传）" : "服务器→客户端（下载）",
        note: null,
      });
    }
    for (let k = xferCmds.length; k < announcements.length; k++) {
      notes.push(`多余数据端点公告未配对传输命令: ${announcements[k].kind} ${announcements[k].ip}:${announcements[k].port}`);
    }
    sessions.push({ flow: f, basis, cmds, resps, creds, type, transfers, notes, serverIp });
  }

  // ---- 输出 ----
  const allTransfers = [];
  for (const s of sessions) for (const t of s.transfers) allTransfers.push(t);

  if (dumpSel !== null) {
    if (dumpSel < 0 || dumpSel >= allTransfers.length) return `dumpIndex 越界：应为 0..${allTransfers.length - 1}`;
    const t = allTransfers[dumpSel];
    if (!t.data) return `传输 #${dumpSel} 无数据连接字节可导出（${t.note || "未捕获"}）`;
    const lines = [];
    lines.push(`=== FTP 传输对象 #${dumpSel} 原字节导出 ===`);
    lines.push(`命令: ${t.cmd} ${t.arg || ""}  数据连接: ${t.mode}`);
    lines.push(`方向: ${t.direction}  ${t.dataLabel}`);
    lines.push(`大小: ${t.data.length} 字节  SHA-256: ${sha256Hex(t.data)}`);
    lines.push("");
    if (isMostlyText(t.data, 4096)) { lines.push("[文本]"); lines.push(latin1(t.data)); }
    else { lines.push("[二进制 · hex 前 8192 字节]"); lines.push(toHex(t.data, 0, Math.min(t.data.length, 8192)) + (t.data.length > 8192 ? " …" : "")); }
    if (t.diag && t.diag.gaps && t.diag.gaps.length) lines.push(`⚠ 重组缺段: ${t.diag.gaps.length} 处，缺段区间字节为 0x00 占位（真实数据未捕获）`);
    const stem = sanitizeFileStem(t.arg || `${t.cmd}_${dumpSel}`);
    return { text: lines.join("\n"), files: [{ name: `ftp${dumpSel}_${stem}`, mime: "application/octet-stream", bytes: t.data }] };
  }

  const lines = [];
  lines.push("=== FTP 控制/数据流配对与对象提取（RFC 959 / RFC 2428，基于 TCP 重组）===");
  lines.push(`控制会话: ${sessions.length}（识别依据: ${[...new Set(sessions.map((s) => s.basis))].join("、")}）  传输: ${allTransfers.length}  TCP 流总数: ${flowList.length}`);
  lines.push("");
  let tSeq = 0;
  for (const s of sessions) {
    lines.push(`▼ 会话 #${sessions.indexOf(s)}  ${s.flow.a} ⇄ ${s.flow.b}`);
    if (s.error) { lines.push(`  ⚠ ${s.error}`); lines.push(""); continue; }
    if (s.creds.user != null || s.creds.pass != null) {
      const pp = s.creds.pass != null ? (s.creds.pass.length <= 24 ? s.creds.pass : s.creds.pass.slice(0, 24) + "…") : "—";
      lines.push(`  登录: USER ${s.creds.user ?? "—"}  PASS ${pp}`);
    }
    const cmdSeq = s.cmds.slice(0, 40).map((c) => c.cmd + (c.arg && !["USER", "PASS"].includes(c.cmd) ? " " + c.arg : "")).join(", ");
    lines.push(`  命令序列: ${cmdSeq || "(无)"}${s.cmds.length > 40 ? " …" : ""}`);
    lines.push(`  传输类型标注: ${s.type === "ASCII" ? "ASCII（TYPE A，线上字节原样输出）" : s.type === "binary" ? "二进制（TYPE I）" : "未捕获 TYPE 命令"}`);
    for (const t of s.transfers) {
      const idx = tSeq++;
      lines.push(`  ▼ 传输 #${idx}  ${t.cmd}${t.arg ? " " + t.arg : ""}`);
      lines.push(`    数据连接: ${t.mode}  ${t.direction || ""}`);
      if (t.note) { lines.push(`    ⚠ ${t.note}`); continue; }
      lines.push(`    ${t.dataLabel}  大小: ${t.data.length} 字节  SHA-256: ${sha256Hex(t.data)}`);
      const n = Math.min(t.data.length, preview);
      if (n > 0) {
        if (isMostlyText(t.data, n)) {
          lines.push(`    文本: ${latin1(t.data.subarray(0, n)).replace(/\r/g, "\\r").replace(/\n/g, "\\n")}${t.data.length > n ? " …" : ""}`);
        } else {
          lines.push(`    hex: ${toHex(t.data, 0, Math.min(n, 96))}${t.data.length > 96 ? " …" : ""}  ASCII: ${asciiPreview(t.data, 32)}`);
        }
      }
      if (t.diag) {
        const d = t.diag;
        const w = [];
        if (d.retransSegs) w.push(`重传${d.retransSegs}段`);
        if (d.oooSegs) w.push(`乱序${d.oooSegs}段`);
        if (d.conflictBytes) w.push(`冲突${d.conflictBytes}B`);
        if (d.gaps && d.gaps.length) w.push(`缺段${d.gaps.length}处[${d.gaps.map((g) => `[${g.from},${g.to})`).join(",")}]（0x00 占位）`);
        if (d.truncated) w.push("截断");
        if (w.length) lines.push(`    ⚠ 重组诊断: ${w.join("/")}`);
      }
    }
    for (const note of s.notes) lines.push(`  ⚠ ${note}`);
    lines.push("");
  }
  if (allTransfers.length > 0) lines.push("用 dumpIndex 导出指定传输的完整文件原字节（SHA-256 已在列表中给出）。");
  else lines.push("（无配对成功的数据传输）");
  return lines.join("\n");
}

register({
  id: "ftpExtract",
  family: "pcap",
  familyLabel: "ftp",
  cat: "forensic",
  name: "FTP 对象提取",
  desc: "FTP 控制/数据流配对：解析 USER/PASS/TYPE/PORT/PASV/EPSV/RETR/STOR 命令与 227/229 应答，按 5 元组配对数据连接，导出传输文件原字节（SHA-256 对拍）。主动/被动/扩展被动/多会话，纯前端零依赖",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "ftpPort", label: "FTP 控制端口", type: "number", default: 21, placeholder: "21" },
    { key: "dumpIndex", label: "导出传输号（空=列表）", type: "number", default: "", placeholder: "留空看列表，填号导出文件原字节" },
    { key: "previewBytes", label: "列表预览字节", type: "number", default: 400 },
  ],
  run: ftpExtractRun,
  acceptsBytes: true,
});
