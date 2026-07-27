/*
 * localBridge.js — 外部 exe 本地桥前端 op。
 *
 * 调用本地 bridge.py（独立服务，端口 8181，仅 Windows）执行白名单 exe。
 * bridge 未启动 / 非 Win 时，op 返回友好提示字符串，不抛错（灰置语义）。
 *
 * 约束：
 * - 仅调 localhost:8181，绝不外发。
 * - tool/args 透传 bridge 白名单校验（前端不自行执行 exe）。
 *
 * op：
 * exeBridge — 通用本地桥（tool/args/stdin/files 自由组合，cat:'bridgeForensic'，requiresBridge）
 */
import { register } from "./registry.js";

const BRIDGE_URL = "http://localhost:8181";
const BRIDGE_TIMEOUT = 70000; // 略大于 bridge 的 60s

// 探测 bridge 是否在线（GET /api/health）。不抛错，返回 {ok, win, tools} 或 {ok:false, error}。
async function bridgeHealth() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(`${BRIDGE_URL}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) return { ok: false, error: `health HTTP ${r.status}` };
    return await r.json();
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// 调用 bridge /api/run。返回 {ok, stdout, stderr, exitCode} 或 {ok:false, error}。
async function bridgeRun(tool, args, stdinBytes, filesMap) {
  const body = { tool, args: args || [] };
  if (stdinBytes && stdinBytes.length) {
    body.stdin = b64encode(stdinBytes);
  }
  if (filesMap) {
    const f = {};
    for (const [k, v] of Object.entries(filesMap)) f[k] = b64encode(v);
    body.files = f;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);
    const r = await fetch(`${BRIDGE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.error || "bridge error" };
    return {
      ok: true,
      exitCode: j.exitCode,
      stdout: b64decodeText(j.stdout),
      stderr: b64decodeText(j.stderr),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// bytes → base64
function b64encode(bytes) {
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}
// base64 → utf8 文本（容错）
function b64decodeText(b64) {
  try {
    const bin = atob(b64 || "");
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(o);
  } catch (e) {
    return "";
  }
}

const te = new TextEncoder();
function decodeInput(text, enc) {
  switch (enc) {
    case "base64": {
      const bin = atob((text || "").replace(/\s/g, ""));
      const o = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
      return o;
    }
    case "hex": {
      const c = (text || "").replace(/[^0-9a-fA-F]/g, "");
      const o = new Uint8Array(Math.floor(c.length / 2));
      for (let i = 0; i < o.length; i++) o[i] = parseInt(c.substr(i * 2, 2), 16);
      return o;
    }
    case "utf8":
    default:
      return te.encode(text || "");
  }
}

// 统一的 run 结果格式化
function fmtBridgeRun(r) {
  if (!r.ok) {
    return `● 本地桥未就绪：${r.error}\n（需先在本机运行 python bridge.py，仅 Windows。启动后刷新本页。）`;
  }
  const stderr = r.stderr ? `\n\n[stderr]\n${r.stderr}` : "";
  return `[exit ${r.exitCode}]\n${r.stdout}${stderr}`;
}

// ============================================================
// 把「通用命令行」select 里的 7 个白名单工具全部独立成各自的 op
// 每个预设 tool 名 + 贴切参数占位，按用途归入 bridge 细分类。
// 通用 exeBridge 保留为「高级/兜底」入口（任意白名单工具 + 自由参数）。
// 所有 op requiresBridge:true（显 EXE 徽章 + 被配方链/穷举解码剔除）。
// ============================================================
function makeBridgeToolOp({ id, cat, name, tool, desc, argsDefault, argsHint, fileKey, fileLabel, withStdin }) {
  const params = [
    { key: "args", label: `参数（空格分隔${fileKey ? `，{${fileKey}} 占位文件` : ""}）`, type: "text",
      default: argsDefault || "", placeholder: argsHint || "" },
  ];
  if (withStdin) {
    params.push(
      { key: "input", label: "输入文本 / stdin", type: "text", default: "", placeholder: "stdin 内容（按下方编码解析）" },
      { key: "inputEnc", label: "输入编码", type: "select", default: "utf8",
        options: [{ value: "utf8", label: "UTF-8" }, { value: "base64", label: "Base64" }, { value: "hex", label: "Hex" }] },
    );
  }
  if (fileKey) {
    params.push({ key: "file", label: `${fileLabel || "文件"} base64（{${fileKey}} 占位）`, type: "text",
      default: "", placeholder: "拖入文件后粘贴 base64" });
  }
  register({
    id, cat, name, desc,
    requiresBridge: true,
    params,
    run: async (text, p) => {
      const stdinBytes = withStdin
        ? ((p.input != null && p.input !== "") ? decodeInput(p.input, p.inputEnc || "utf8")
          : (text ? decodeInput(text, "utf8") : null))
        : null;
      const files = {};
      if (fileKey && p.file) files[fileKey] = decodeInput(p.file, "base64");
      const args = (p.args || argsDefault || "").trim().split(/\s+/).filter(Boolean);
      const r = await bridgeRun(tool, args, stdinBytes, Object.keys(files).length ? files : null);
      return fmtBridgeRun(r);
    },
  });
}

makeBridgeToolOp({
  id: "steghideBridge", cat: "bridgeStego", tool: "steghide", name: "steghide · 隐写",
  desc: "调本机 steghide.exe 往图/音里嵌入或提取数据。embed/extract 子命令，文件走 {cover} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "extract -sf {cover}", argsHint: "如 extract -sf {cover} -p 密码", fileKey: "cover", fileLabel: "载体",
});
makeBridgeToolOp({
  id: "foremostBridge", cat: "bridgeForensic", tool: "foremost", name: "foremost · 文件雕复",
  desc: "调本机 foremost.exe 按文件头/尾特征从数据流里雕复（carve）出内嵌文件。文件走 {in} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "-i {in} -o out", argsHint: "如 -i {in} -o out", fileKey: "in", fileLabel: "待雕复文件",
});
makeBridgeToolOp({
  id: "snowBridge", cat: "bridgeStego", tool: "snow", name: "snow · 空白隐写",
  desc: "调本机 snow.exe 用行尾空白字符（空格/Tab）在文本里藏数据。文件走 {in} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "-C {in}", argsHint: "如 -C {in} 或 -p 密码 -m \"消息\" in.txt out.txt", fileKey: "in", fileLabel: "文本",
});
makeBridgeToolOp({
  id: "jstegBridge", cat: "bridgeStego", tool: "jsteg", name: "jsteg · JPEG LSB",
  desc: "调本机 jsteg.exe 对 JPEG 做 LSB 隐写读写。文件走 {jpg} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "reveal {jpg}", argsHint: "如 reveal {jpg}", fileKey: "jpg", fileLabel: "JPEG",
});
makeBridgeToolOp({
  id: "mp3stegoBridge", cat: "bridgeStego", tool: "mp3stego", name: "MP3Stego · 解码",
  desc: "调本机 MP3Stego Decode 从 MP3 里还原藏入的数据。文件走 {mp3} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "-X {mp3}", argsHint: "如 -X {mp3} -P 密码", fileKey: "mp3", fileLabel: "MP3",
});
makeBridgeToolOp({
  id: "bkcrackBridge", cat: "bridgeForensic", tool: "bkcrack", name: "bkcrack · ZIP 明文攻击",
  desc: "调本机 bkcrack.exe 对 ZipCrypto 加密的 ZIP 做已知明文攻击求内部密钥。仅 Windows，需先起 python bridge.py。",
  argsDefault: "-C {zip} -c 文件名 -p 明文", argsHint: "如 -C {zip} -c inner.txt -p plain.bin", fileKey: "zip", fileLabel: "ZIP",
});
makeBridgeToolOp({
  id: "dtmf2numBridge", cat: "bridgeForensic", tool: "dtmf2num", name: "dtmf2num · DTMF 解码",
  desc: "调本机 dtmf2num.exe 从 WAV 拨号音里解出 DTMF 按键序列。文件走 {wav} 占位。仅 Windows，需先起 python bridge.py。",
  argsDefault: "{wav}", argsHint: "如 {wav}", fileKey: "wav", fileLabel: "WAV",
});

// 通用/高级入口保留：任意白名单工具 + 自由参数（拆分后仍留一个万能口子）
const TOOL_OPTS = [
  { value: "dtmf2num", label: "dtmf2num — DTMF 双音多频解码" },
  { value: "foremost", label: "foremost — 文件雕复" },
  { value: "steghide", label: "steghide — 隐写 embed/extract" },
  { value: "snow",     label: "snow — 空白字符隐写" },
  { value: "jsteg",    label: "jsteg — JPEG LSB 隐写" },
  { value: "bkcrack",  label: "bkcrack — ZIP 已知明文攻击" },
  { value: "mp3stego", label: "mp3stego — MP3Stego 解码" },
];

register({
  id: "exeBridge",
  cat: "bridgeForensic",
  name: "本地桥·通用命令行",
  requiresBridge: true, // 本地桥 op：显 EXE 徽章 + 被配方链/穷举解码剔除
  desc: "高级入口：手选白名单 exe + 自由参数（dtmf2num/foremost/steghide/snow/jsteg/bkcrack/mp3stego）。常用工具已各自独立成 op，本口子留给自定义参数。仅 Windows，需先起 python bridge.py。",
  params: [
    { key: "tool", label: "工具", type: "select", default: "steghide", options: TOOL_OPTS },
    { key: "args", label: "参数（空格分隔，{cover} 占位文件）", type: "text", default: "", placeholder: "如 extract -sf {cover} -p pass" },
    { key: "input", label: "输入文本/stdin", type: "text", default: "", placeholder: "stdin 内容（按下方编码解析）" },
    { key: "inputEnc", label: "输入编码", type: "select", default: "utf8",
      options: [{ value: "utf8", label: "UTF-8" }, { value: "base64", label: "Base64" }, { value: "hex", label: "Hex" }] },
    { key: "coverFile", label: "文件 base64（{cover} 占位）", type: "text", default: "", placeholder: "拖入文件后粘贴 base64" },
  ],
  run: async (text, p) => {
    const inputText = (p.input != null && p.input !== "") ? p.input : (text || "");
    const stdinBytes = inputText ? decodeInput(inputText, p.inputEnc || "utf8") : null;
    const files = {};
    if (p.coverFile) files.cover = decodeInput(p.coverFile, "base64");
    const args = (p.args || "").trim().split(/\s+/).filter(Boolean);
    const r = await bridgeRun(p.tool || "steghide", args, stdinBytes, Object.keys(files).length ? files : null);
    return fmtBridgeRun(r);
  },
});

export { bridgeHealth, bridgeRun };
