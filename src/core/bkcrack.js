/*
 * bkcrack.js — ZipCrypto 已知明文攻击（Biham-Kocher，cat:'analysis'，run 型）。
 *
 * 定位：ZIP 密码破解的杀手锏。传统 ZipCrypto（非 AES）只要拿到某条目 ≥12 字节
 * 连续已知明文，即可直接恢复内部密钥态 key0/key1/key2，**无视密码长度**
 * 进而解密整条数据流（拿到明文即赢）。是弱口令爆破之外的另一条线。
 *
 * 引擎：kimci86/bkcrack（C++17）经 emscripten 编成 public/wasm/bkcrack.js(+.wasm)
 * MODULARIZE 工厂产物（export default Bkcrack）。本文件套 sevenzip.js 的
 * 「懒加载 + 缺失静默降级」范式：虚拟 FS 写档案/明文 → callMain(argv) → 捕获 stdout。
 *
 * 三层能力：
 * 1) 输入解析 加密 ZIP（hex/base64）解码为字节，明文解码为字节（纯 JS，永远可用）
 * 2) 参数校验 明文 < 12 字节直接拒绝（Biham-Kocher 硬门槛）
 * 3) 密钥恢复/解密 懒加载 bkcrack.wasm → callMain → 抓 Keys / 解密条目（需 wasm，缺失降级）
 *
 * 缺失降级：public/wasm/bkcrack.js 不存在 / 加载失败时不报错不白屏
 * 输出参数回显 + 明确提示「bkcrack wasm 未随包或需本地桥（localBridge bkcrack.exe）」。
 *
 * 性能提示（desc + 输出均标注）：攻击 CPU 密集，典型耗时几分钟~几十分钟
 * 峰值内存 300-500MB（密钥表）。wasm 是多线程 pthread（bkcrack attack
 * 无条件 std::thread，关不掉），部署需 COOP/COEP 头启用 SharedArrayBuffer
 * （点我启动.py 的 end_headers 已下发 same-origin + require-corp）。
 *
 * 明文语义提示：ZipCrypto 加密的是**压缩后**字节。method=0(stored) 时已知明文=原文；
 * method=8(deflate) 时已知明文需是 deflate 后的字节（对已知原文做同参数 deflate 再取）。
 *
 * 红线：
 * - 只新建本文件；不碰 main.js / registry.js / i18n / eduContent / 他人文件。
 * - 零外发：wasm 仅从本地 public/wasm/ 懒加载，绝不 CDN，绝不外发用户数据。
 * - 件内自注册（register(op)）。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 */
import { register } from "./registry.js";

// ============================================================
// 输入文本 → 字节（hex / base64 / base64url / 原样 UTF-8）
// 自包含（不 import compress.js，遵守 低耦合红线）
// ============================================================
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function isB64Url(s) { return /^[A-Za-z0-9_-]+$/.test(s) && s.length >= 4; }
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function b64urlToBytes(s) {
  let str = s.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 把输入文本按 enc 解码为字节。enc: 'auto'|'hex'|'base64'|'utf8' */
function decodeToBytes(text, enc) {
  const mode = enc || "auto";
  const raw = String(text);
  const s = raw.trim().replace(/\s+/g, "");
  if (mode === "hex") { if (!isHex(s)) throw new Error("不是合法 hex（偶数长度 0-9a-f）"); return hexToBytes(s); }
  if (mode === "base64") { try { return b64ToBytes(s); } catch { throw new Error("不是合法 base64"); } }
  if (mode === "utf8") return new TextEncoder().encode(raw);
 // auto
  if (isHex(s)) return hexToBytes(s);
  if (isB64Url(s) && /[-_]/.test(s)) { try { return b64urlToBytes(s); } catch { /* fall */ } }
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall */ } }
  return new TextEncoder().encode(raw);
}

// ============================================================
// 字节小工具
// ============================================================
function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}
function bytesToOutput(bytes) {
  if (!bytes || bytes.length === 0) return { text: "(空)", mode: "text" };
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.1) return { text: s, mode: "text" };
  } catch { /* 非文本 */ }
  return { text: bytesToHex(bytes, 4096), mode: "hex" };
}

// ZIP 本地文件头签名 50 4B 03 04（仅用于友好提示，不强制）
function looksLikeZip(bytes) {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B &&
    bytes[2] === 0x03 && bytes[3] === 0x04;
}

// ============================================================
// wasm 懒加载（bkcrack emscripten MODULARIZE 产物：public/wasm/bkcrack.js + .wasm）
// 套 sevenzip.js 的 load7zWasm 范式：单例 promise + 缺失降级（_available=false 不抛）。
// 零外发：只从本地相对路径 import，绝不 CDN。
// ============================================================
const WASM_LOADER_URL = "../../public/wasm/bkcrack.js"; // export default Bkcrack（MODULARIZE 工厂）
let _modPromise = null;   // 单例：并发只加载一次（模块级缓存，避免重复实例化占内存）
let _available = null;    // null=未试 / true=就绪 / false=缺失降级

/** 懒加载 bkcrack wasm 工厂，返回 create 函数或 null（缺失/失败降级，不抛）。 */
async function loadBkcrackFactory() {
  if (_modPromise) return _modPromise;
  _modPromise = (async () => {
    try {
      const factory = await import(/* @vite-ignore */ WASM_LOADER_URL);
      const create = factory.default || factory.Bkcrack;
      if (typeof create !== "function") { _available = false; return null; }
      _available = true;
      return create;
    } catch {
      _available = false; // 未随包 / 加载失败 → 降级
      return null;
    }
  })();
  return _modPromise;
}

/** 是否已确认 wasm 可用（未试过返回 null）。供外部/测试探测。 */
function bkcrackWasmAvailable() { return _available; }

/**
 * 执行一次 bkcrack CLI（每次新建实例，跑完即弃 → 释放几百 MB 密钥表内存）。
 * @param {string[]} argv bkcrack 命令行参数（不含程序名）
 * @param {Array<{name,bytes}>} inputs 写入虚拟 FS 的输入文件
 * @param {string[]} readBack 跑完后从虚拟 FS 读回的文件名
 * @returns {{stdout:string, files:Object<string,Uint8Array>}|null} null=wasm 不可用
 */
async function runBkcrack(argv, inputs = [], readBack = []) {
  const create = await loadBkcrackFactory();
  if (!create) return null;
  const lines = [];
  const files = {};
  let mod;
  try {
 // MODULARIZE + noInitialRun：await 工厂拿到实例，print/printErr 收集到 buffer
    mod = await create({
      noInitialRun: true,
      print: (t) => lines.push(t),
      printErr: (t) => lines.push(t),
 // 抑制 emscripten 状态噪音
      setStatus: () => {},
    });
  } catch (e) {
    return { stdout: "(bkcrack wasm 实例化失败: " + (e && e.message ? e.message : String(e)) + ")", files };
  }
  const FS = mod.FS;
  try {
    for (const f of inputs) {
      try { FS.writeFile(f.name, f.bytes); } catch (e) {
        lines.push("(写入 " + f.name + " 失败: " + (e && e.message ? e.message : String(e)) + ")");
      }
    }
 // callMain 非 0 退出码时 emscripten 抛 ExitStatus；捕获但保留已收集 stdout
    try {
      mod.callMain(argv);
    } catch (e) {
      if (e && e.name !== "ExitStatus") {
        lines.push("(bkcrack 运行告警: " + (e && e.message ? e.message : String(e)) + ")");
      }
    }
    for (const name of readBack) {
      try { files[name] = FS.readFile(name); } catch { /* 未生成 */ }
    }
    return { stdout: lines.join("\n"), files };
  } catch (e) {
    return { stdout: "(bkcrack FS 操作失败: " + (e && e.message ? e.message : String(e)) + ")", files };
  }
}

// ============================================================
// stdout 解析：抓恢复出的内部密钥态
// bkcrack 成功时输出形如：
// [..] Keys
// 12345678 9abcdef0 0f1e2d3c
// ============================================================
function parseKeys(stdout) {
  if (!stdout) return null;
 // "Keys" 后可能同行或下一行给 3 个 8 位 hex
  const m = stdout.match(/Keys[^\n]*\n\s*([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})/);
  if (m) return [m[1], m[2], m[3]];
 // 兜底：全文找连续 3 个 8 位 hex
  const m2 = stdout.match(/\b([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})\s+([0-9a-fA-F]{8})\b/);
  return m2 ? [m2[1], m2[2], m2[3]] : null;
}

// ============================================================
// 主 op：run 单向
// 模式 recover : 仅恢复内部密钥态 key0/key1/key2
// 模式 decrypt : 恢复密钥并解密目标条目全部数据（一次 callMain 带 -d）
// ============================================================
const ENTRY_TMP = "target.zip";
const PLAIN_TMP = "plain.bin";
const OUT_TMP = "decrypted.bin";

async function bkcrackRun(text, p) {
  const lines = [];
  lines.push("=== ZipCrypto 已知明文攻击 (bkcrack / Biham-Kocher) ===");

 // ---- 解析加密 ZIP ----
  let zipBytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    zipBytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : decodeToBytes(text, (p && p.inputEnc) || "auto");
  } catch (e) {
    return "✗ 加密 ZIP 输入解析失败: " + (e && e.message ? e.message : String(e));
  }
  lines.push("加密 ZIP: " + zipBytes.length + " 字节，前 16 字节(hex): " + bytesToHex(zipBytes, 16));
  if (!looksLikeZip(zipBytes)) {
    lines.push("⚠ 未命中 ZIP 本地头签名 50 4B 03 04（可能不是标准 ZIP，或输入编码有误，仍尝试继续）");
  }

 // ---- 解析已知明文 ----
  const entry = (p && p.entryName ? String(p.entryName).trim() : "");
  const mode = (p && p.mode) || "recover";
  if (!entry && mode !== "recoverPassword") {
    lines.push("");
    lines.push("✗ 未填「目标条目名」。请填 ZIP 内被加密条目的完整路径名（如 flag.txt / dir/secret.bin）。");
    return lines.join("\n");
  }
  let plainBytes;
  try {
    plainBytes = decodeToBytes((p && p.plaintext) || "", (p && p.plainEnc) || "auto");
  } catch (e) {
    return lines.join("\n") + "\n\n✗ 已知明文解析失败: " + (e && e.message ? e.message : String(e));
  }
  const offset = Math.max(0, parseInt((p && p.plainOffset) || "0", 10) || 0);
  if (mode !== "recoverPassword") {
    lines.push("目标条目: " + entry);
    lines.push("已知明文: " + plainBytes.length + " 字节，偏移 " + offset + "，前 16 字节(hex): " + bytesToHex(plainBytes, 16));
  } else {
    lines.push("目标: 从密钥态暴力恢复原始密码（无需档案）");
  }
  lines.push("");

 // ---- 构造 bkcrack CLI ----
 // 模式 recover : 攻击恢复密钥 -C <zip> -c <entry> -p <plainfile> [-o <offset>]（可追加 -d 解密）
 // 模式 decrypt : 攻击 + 解密目标条目（同一次 callMain 带 -d）
 // 模式 decryptKeys : 已知密钥态解密 -C <zip> -c <entry> -k X Y Z -d <outfile>
 // 模式 recoverPassword : 密码暴力恢复 -k X Y Z -r <length> <charset>（无需档案）
  const keysStr = String((p && p.keys) || "").trim();
  let argv, inputs, readBack = [];
  if (mode === "decryptKeys" || mode === "recoverPassword") {
    const km = keysStr.split(/[\s,]+/).filter(Boolean);
    if (km.length !== 3 || km.some((k) => !/^[0-9a-fA-F]{8}$/.test(k))) {
      lines.push("✗ 密钥态格式非法：需 3 组 8 位 hex（如 `e8adb3d5 49151c56 08a55810`），当前: `" + keysStr + "`");
      return lines.join("\n");
    }
    if (mode === "decryptKeys") {
      if (!entry) { lines.push("✗ 已知密钥态解密仍需填「目标条目名」。"); return lines.join("\n"); }
      argv = ["-C", ENTRY_TMP, "-c", entry, "-k", ...km, "-d", OUT_TMP];
      inputs = [{ name: ENTRY_TMP, bytes: zipBytes }];
      readBack.push(OUT_TMP);
    } else {
      const maxLen = Math.max(1, parseInt((p && p.recLen) || "6", 10) || 6);
      const charset = String((p && p.charset) || "").trim();
      if (!charset) { lines.push("✗ 密码恢复需填「候选字符集」（如 0123456789 或 ?l?u?d 语义集的展开字符）。"); return lines.join("\n"); }
      argv = ["-k", ...km, "-r", String(maxLen), charset];
      inputs = [];
    }
  } else {
    if (plainBytes.length < 12) {
      lines.push("✗ 已知明文仅 " + plainBytes.length + " 字节，攻击需 **≥12 字节连续已知明文**（Biham-Kocher 硬门槛）。");
      lines.push("  CTF 明文来源：ZIP 内已知内容文件、文件头魔数（PNG 89504E47…、PDF %PDF、内嵌 ZIP 504B0304）、");
      lines.push("  或对已知原文做同参数 deflate 后的压缩流（method=8 场景，ZipCrypto 加密的是压缩后字节）。");
      lines.push("  （若已有密钥态，可改用「已知密钥态」模式，无需明文。）");
      return lines.join("\n");
    }
    argv = ["-C", ENTRY_TMP, "-c", entry, "-p", PLAIN_TMP];
    if (offset > 0) argv.push("-o", String(offset));
    inputs = [{ name: ENTRY_TMP, bytes: zipBytes }, { name: PLAIN_TMP, bytes: plainBytes }];
    if (mode === "decrypt") readBack.push(OUT_TMP), argv.push("-d", OUT_TMP);
  }

  lines.push("--- 执行 ---");
  lines.push("命令: bkcrack " + argv.join(" "));
  lines.push("⚠ CPU 密集：攻击/密码恢复典型耗时数秒~几十分钟，峰值内存 300-500MB（密钥表）。请耐心等待，勿关页面。");
  lines.push("");

  const res = await runBkcrack(argv, inputs, readBack);

  if (res === null) {
 // ---- wasm 缺失降级（不报错不白屏）----
    lines.push("--- 攻击引擎（wasm）能力 ---");
    lines.push("⚠ bkcrack 攻击引擎（wasm）未随包或加载失败，已降级为参数回显。");
    lines.push("  纯 JS 重写 Biham-Kocher 代码量大且慢数倍，本项目走 wasm 路线。");
    lines.push("  要启用攻击，请放置 wasm：");
    lines.push("    文件: public/wasm/bkcrack.js + public/wasm/bkcrack.wasm");
    lines.push("    来源: kimci86/bkcrack（C++17）经 emscripten 编译（MODULARIZE 产物）。");
    lines.push("  注: 旧本地桥 bkcrack.exe 通道已下线（2026-09-13 恒烈裁决删除）；WASM 版已覆盖 exe 三面基准（T411）。");
    lines.push("  零外发: wasm 资源随包本地分发，绝不 CDN。");
    return lines.join("\n");
  }

 // ---- wasm 可用：输出 bkcrack 结果 ----
  lines.push("--- bkcrack 输出 ---");
  if (res.stdout) lines.push(res.stdout);
  lines.push("");

  const keys = parseKeys(res.stdout);
  if (mode === "recoverPassword") {
    // -r 产出：[12:49:20] Password / as bytes: 38 36 34 32 / as text: 8642
    const pm = res.stdout.match(/as text:\s*(\S+)/);
    if (pm) {
      lines.push("✓ 已恢复原始密码: " + pm[1]);
      lines.push("  说明: 该密码可直接解密该 ZIP 全部 ZipCrypto 条目。");
    } else {
      lines.push("✗ 未恢复出密码（字符集/长度范围内无解）。可扩大字符集或长度上限后重试。");
    }
  } else if (keys) {
    lines.push("✓ 已恢复内部密钥态 key0 key1 key2:");
    lines.push("    " + keys.join(" "));
    lines.push("  说明: 内部态可解密该 ZIP 全部 ZipCrypto 条目（无视密码长度）。");
    lines.push("  可选进一步 `bkcrack -k " + keys.join(" ") + " -r <长度> <字符集>` 暴力还原原始密码字符串。");
  } else {
    lines.push("✗ 未从输出解析出密钥态。常见原因：");
    lines.push("  · 已知明文与该条目密文不匹配（内容/偏移错，或明文不是压缩后字节）；");
    lines.push("  · 目标条目名填错、该条目非 ZipCrypto（AES 加密无法用本攻击）；");
    lines.push("  · 明文连续已知长度不足。请核对上方 bkcrack 原始输出。");
  }

 // ---- 解密结果预览 ----
  if (mode === "decrypt" || mode === "decryptKeys") {
    lines.push("");
    lines.push("--- 解密条目「" + entry + "」---");
    const dec = res.files[OUT_TMP];
    if (dec && dec.length) {
      const r = bytesToOutput(dec);
      lines.push("解密后 " + dec.length + " 字节（" + r.mode + "）:");
      const preview = r.text.length > 2000 ? r.text.slice(0, 2000) + " …(截断)" : r.text;
      lines.push(preview);
      lines.push("");
      lines.push("提示: ZipCrypto 解密得到的是**压缩后**字节。若该条目 method=8(deflate)，");
      lines.push("  上方为 deflate 流，需再 inflate（用本工具箱压缩/解压 op）才得原文；method=0(stored) 则即为原文。");
    } else {
      lines.push("（未生成解密文件，通常因密钥未恢复成功，见上方原因）");
    }
  }

  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "bkcrackAttack",
  cat: "forensic",
  name: "ZipCrypto 已知明文攻击 (bkcrack)",
  desc: "ZIP 传统 ZipCrypto 加密的杀手锏：给出某条目 ≥12 字节连续已知明文，恢复内部密钥态并解密全档，无视密码长度（非 AES）。四种模式：明文攻击求密钥 / 攻击+解密 / 已知密钥态解密（-k）/ 已知密钥态暴力恢复密码（-k -r）。放置 public/wasm/bkcrack.js 后启用，wasm 缺失自动降级。⚠ CPU 密集，数秒~几十分钟、峰值内存 300-500MB。",
  params: [
    {
      key: "inputEnc", label: "加密 ZIP 编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
    { key: "entryName", label: "目标条目名", type: "text", default: "", placeholder: "如 flag.txt 或 dir/secret.bin" },
    { key: "plaintext", label: "已知明文（≥12 字节）", type: "text", default: "", placeholder: "已知内容/文件头魔数；method=8 时为 deflate 后字节" },
    {
      key: "plainEnc", label: "明文编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex（魔数常用）" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "plainOffset", label: "明文偏移", type: "text", default: "0", placeholder: "明文对应密文流的起始偏移，默认 0" },
    {
      key: "mode", label: "模式", type: "select", default: "recover",
      options: [
        { value: "recover", label: "已知明文攻击：恢复密钥态（key0/key1/key2）" },
        { value: "decrypt", label: "已知明文攻击：恢复密钥并解密目标条目" },
        { value: "decryptKeys", label: "已知密钥态：解密目标条目（-k，免明文）" },
        { value: "recoverPassword", label: "已知密钥态：暴力恢复原始密码（-k -r，免档案）" },
      ],
    },
    { key: "keys", label: "密钥态（3 组 8 位 hex）", type: "text", default: "", placeholder: "如 e8adb3d5 49151c56 08a55810（-k 模式用）" },
    { key: "recLen", label: "密码恢复长度上限", type: "number", default: 6, placeholder: "-r 长度上限，越长越慢（-k -r 模式用）" },
    { key: "charset", label: "密码恢复字符集", type: "text", default: "", placeholder: "如 0123456789 或 abcdef（-k -r 模式用）" },
  ],
  run: bkcrackRun,
  acceptsBytes: true,
});

export {
  decodeToBytes, looksLikeZip, parseKeys,
  loadBkcrackFactory, bkcrackWasmAvailable, runBkcrack,
  bkcrackRun,
};
