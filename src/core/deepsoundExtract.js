/*
 * deepsoundExtract.js — DeepSound 音频隐写提取（cat:'forensic'，P1 批）。
 *
 * DeepSound（Windows 端音频隐写工具）把文件藏进 16-bit PCM WAV 采样的低位：
 * - 载体为 WAV data 块的原始字节；头 104 载体字节内藏 26 秘密字节（mode=4 提取）：
 *   "DSC2"/"DSCF"(4) + 质量模式 2/4/8(1) + AES 标志 0/1(1) + 20 字节密钥杂凑。
 * - 头之后是记录链，每条 = 32 字节头（"DSSF" + 20 字节文件名 + 4 字节大端长度）
 *   + 内容区（内容 + 零填充 + "DSSF" 结束标记，整体补到 16 的倍数）。
 * - 质量模式决定每字节占用的载体字节数与取位方式：
 *   mode 2：每 2 载体字节取 1 个整字节（取偶数位）；
 *   mode 4：每 4 载体字节取 2 个低 4 位拼 1 字节（第 0、2 个）；
 *   mode 8：每 8 载体字节取 4 个低 2 位拼 1 字节（第 0、2、4、6 个）。
 * - 加密记录为 AES-256-ECB（无填充，逐 16 字节块）。密钥派生：
 *   DSC2 = SHA-256(UTF-16LE(密码))；DSCF = ASCII 密码右补零到 32 字节。
 * - 明文头只占 24 载体字节（6 秘密字节），加密头占满 104。
 *
 * 红线：
 * - 只新建本文件；AES 块运算复用 modern.js 纯函数（aesEncrypt/aesDecrypt，ECB pad:false）。
 * - SHA-256 走 WebCrypto（同 hash.js 惯例），run 为 async（本项目有成熟先例）。
 * - 零外发：全部本地计算。
 * - 头扫描上限 352800 载体字节（与原工具行为一致），逐字节滑动（嵌入起点不必对齐）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";
import { aesEncrypt, aesDecrypt } from "./modern.js";

const HEAD_SCAN_LIMIT = 352800;
const HEAD_CARRIER = 104;      // 头部载体字节数（26 秘密字节 × mode4）
const PLAIN_HEAD_CARRIER = 24; // 明文头有效载体（6 秘密字节 × mode4）

// ============ WAV data 块定位 ============
/**
 * RIFF 块遍历找 data 块。返回 [payloadOffset, payloadLen] 或 null。
 * 块表 word-aligned（奇数长度补 1 字节）；data 长度按实际剩余截断。
 */
export function findDataChunk(wav) {
  if (wav.length < 12) return null;
  if (String.fromCharCode(wav[0], wav[1], wav[2], wav[3]) !== "RIFF") return null;
  if (String.fromCharCode(wav[8], wav[9], wav[10], wav[11]) !== "WAVE") return null;
  let o = 12;
  while (o + 8 <= wav.length) {
    const id = String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
    const sz = wav[o + 4] | (wav[o + 5] << 8) | (wav[o + 6] << 16) | (wav[o + 7] << 24);
    if (id.toLowerCase() === "data") {
      const start = o + 8;
      const len = Math.min(sz >>> 0, wav.length - start);
      return [start, len];
    }
    o = o + 8 + sz + (sz & 1);
  }
  return null;
}

// ============ 低位提取 ============
/**
 * 从载体字节恢复秘密字节（纯函数，decode 的正向）。
 * @param {Uint8Array} data 整个 WAV
 * @param {number} base 载体起始偏移
 * @param {number} carrierLen 载体字节数
 * @param {number} mode 2/4/8
 * @returns {Uint8Array} carrier_len/mode 个秘密字节
 */
export function decodeLowBits(data, base, carrierLen, mode) {
  const num = Math.floor(carrierLen / mode);
  const out = new Uint8Array(num);
  if (mode === 2) {
    for (let j = 0; j < num; j++) out[j] = data[base + j * 2];
  } else if (mode === 4) {
    for (let k = 0; k < num; k++) {
      const b = base + k * 4;
      out[k] = ((data[b] & 0xf) << 4) | (data[b + 2] & 0xf);
    }
  } else if (mode === 8) {
    for (let i = 0; i < num; i++) {
      const b = base + i * 8;
      out[i] = ((data[b] & 3) << 6) | ((data[b + 2] & 3) << 4) | ((data[b + 4] & 3) << 2) | (data[b + 6] & 3);
    }
  }
  return out;
}

// ============ 头扫描 ============
/**
 * 在 data 块前 HEAD_SCAN_LIMIT 载体字节内逐字节滑动找 DeepSound 头。
 * 每处以 mode=4 提取 104 载体字节（26 秘密字节），
 * 校验 版本 DSC2/DSCF + 模式 2/4/8 + AES 标志 0/1。
 * 返回 [头偏移(载体相对 data 起点), 版本串] 或 null。
 */
export function locateHead(data, base, len) {
  const scan = Math.min(len, HEAD_SCAN_LIMIT);
  for (let i = 0; i < scan; i++) {
    if (i + HEAD_CARRIER > len) break;
    const dec = decodeLowBits(data, base + i, HEAD_CARRIER, 4);
    const ver = String.fromCharCode(dec[0], dec[1], dec[2], dec[3]);
    if ((ver === "DSC2" || ver === "DSCF") && (dec[4] === 2 || dec[4] === 4 || dec[4] === 8) && (dec[5] === 0 || dec[5] === 1)) {
      return [i, ver];
    }
  }
  return null;
}

// ============ 密钥派生 ============
/** 字符串 → UTF-16LE 字节（含代理对拆分，与平台 encode_utf16 等价）。 */
function utf16leBytes(s) {
  const out = [];
  const push = (u) => out.push(u & 0xff, (u >>> 8) & 0xff);
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    if (c > 0xffff) {
      const v = c - 0x10000;
      push(0xd800 + (v >>> 10));
      push(0xdc00 + (v & 0x3ff));
    } else {
      push(c);
    }
  }
  return out;
}

/** DSC2 密钥：SHA-256(UTF-16LE(密码))，WebCrypto 异步。 */
export async function keyDsc2(pw) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto");
  const bytes = new Uint8Array(utf16leBytes(pw));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

/** DSCF 密钥：ASCII 密码（非 ASCII 记 '?'）右补零到 32 字节。 */
export function keyDscf(pw) {
  const k = new Uint8Array(32);
  const chars = Array.from(String(pw), (c) => (c.codePointAt(0) < 128 ? c.codePointAt(0) : 0x3f));
  for (let i = 0; i < Math.min(chars.length, 32); i++) k[i] = chars[i];
  return k;
}

// ============ 主提取 ============
/**
 * 从 WAV 载体提取 DeepSound 隐藏文件。
 * @param {Uint8Array} wav 整个 WAV 字节
 * @param {string} password 密码（加密文件必填）
 * @returns {Promise<{version:string, mode:number, encrypted:boolean,
 *   files:Array<{name:string, data:Uint8Array}>}>}
 * @throws 非 WAV / 无 DeepSound 头 / 加密缺密码 / 密码错误
 */
export async function extractDeepSound(wav, password) {
  const chunk = findDataChunk(wav);
  if (!chunk) throw new Error("不是有效的 WAV（缺少 data 块）。DeepSound 只支持 PCM WAV。");
  const [base, len] = chunk;
  const located = locateHead(wav, base, len);
  if (!located) throw new Error("未找到 DeepSound 头（DSC2/DSCF）。可能不是 DeepSound 文件，或不是 PCM WAV。");
  const [h, version] = located;

  const head = decodeLowBits(wav, base + h, HEAD_CARRIER, 4);
  const mode = head[4];
  const encrypted = head[5] === 1;

  let key = null;
  if (encrypted) {
    if (!password) {
      throw new Error(`DeepSound 文件已加密（${version}），请在参数里填入密码。`);
    }
    key = version === "DSCF" ? keyDscf(password) : await keyDsc2(password);
  }

  // 加密头占满 104 载体字节；明文头只有前 24 有效
  let pos = encrypted ? h + HEAD_CARRIER : h + PLAIN_HEAD_CARRIER;
  const files = [];
  for (;;) {
    const hdrCarrier = 32 * mode;
    if (pos + hdrCarrier > len) break;
    let hdr = decodeLowBits(wav, base + pos, hdrCarrier, mode);
    if (key) hdr = aesDecrypt(hdr, key, { mode: "ECB", pad: false });
    if (String.fromCharCode(hdr[0], hdr[1], hdr[2], hdr[3]) !== "DSSF") {
      if (encrypted && files.length === 0) {
        throw new Error("密码错误（解密后未出现 DSSF 记录）。");
      }
      break;
    }
    const td = new TextDecoder("utf-8", { fatal: false });
    const name = td.decode(hdr.slice(4, 24)).replace(/\0+$/g, "").replace(/\?/g, "X");
    const size = (hdr[24] << 24) | (hdr[25] << 16) | (hdr[26] << 8) | hdr[27]; // 大端

    const cstart = pos + hdrCarrier;
    const padLen = 16 - ((size + 4) % 16);        // 整除时也补 16（与原工具一致）
    const padded = size + padLen + 4;             // 内容 + 零填充 + "DSSF" 结束标记
    const contentCarrier = padded * mode;
    if (cstart + contentCarrier > len) break;     // 截断 / 长度非法
    let content = decodeLowBits(wav, base + cstart, contentCarrier, mode);
    if (key) content = aesDecrypt(content, key, { mode: "ECB", pad: false });
    files.push({ name, data: content.slice(0, size) });
    pos = cstart + contentCarrier;
  }

  return { version, mode, encrypted, files };
}

// ============ 测试构造器（正向嵌入，供回归构造已知载体） ============
/**
 * 构造带 DeepSound 数据的 WAV。嵌入为提取的精确逆：秘密字节按 mode 打散进
 * 载体低位（其余位取 0x80 模拟静音采样，提取只读低位故不影响）。
 * @param {object} o { version:"DSC2"|"DSCF", mode:2|4|8, password:"", files:[{name,data}] }
 * @returns {Promise<Uint8Array>} WAV 字节
 */
export async function makeDeepSoundWav(o = {}) {
  const version = o.version === "DSCF" ? "DSCF" : "DSC2";
  const mode = [2, 4, 8].includes(o.mode) ? o.mode : 4;
  const encrypted = !!o.password;
  const files = (o.files || []).map((f) => ({
    name: String(f.name || "file.bin"),
    data: f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data || []),
  }));

  // 头 26 秘密字节：版本(4)+模式(1)+标志(1)+杂凑区(20，原工具存密码杂凑，提取不校验，置 0)
  const headSecret = new Uint8Array(26);
  headSecret.set([...version].map((c) => c.charCodeAt(0)), 0);
  headSecret[4] = mode;
  headSecret[5] = encrypted ? 1 : 0;
  const key = encrypted ? (version === "DSCF" ? keyDscf(o.password) : await keyDsc2(o.password)) : null;

  // 每文件的秘密字节（头 32 + 内容区 padded）
  const secretParts = [];
  const td = new TextEncoder();
  for (const f of files) {
    const hdr = new Uint8Array(32);
    hdr.set([0x44, 0x53, 0x53, 0x46], 0); // "DSSF"
    const nameBytes = td.encode(f.name).slice(0, 20);
    hdr.set(nameBytes, 4);
    const size = f.data.length;
    hdr[24] = (size >>> 24) & 0xff; hdr[25] = (size >>> 16) & 0xff;
    hdr[26] = (size >>> 8) & 0xff; hdr[27] = size & 0xff;
    const padLen = 16 - ((size + 4) % 16);
    const padded = size + padLen + 4;
    const body = new Uint8Array(padded);
    body.set(f.data, 0);
    body[padded - 4] = 0x44; body[padded - 3] = 0x53; body[padded - 2] = 0x53; body[padded - 1] = 0x46;
    const hdrEnc = key ? aesEncrypt(hdr, key, { mode: "ECB", pad: false }) : hdr;
    const bodyEnc = key ? aesEncrypt(body, key, { mode: "ECB", pad: false }) : body;
    secretParts.push(hdrEnc, bodyEnc);
  }

  // 头部固定按 mode4 嵌入（头扫描永远用 mode4 提取，质量模式只作用于记录区）；
  // 明文头只嵌前 6 秘密字节（24 载体），加密头嵌满 26（104 载体）
  const headPart = encrypted ? headSecret : headSecret.slice(0, 6);
  const secret = concatBytes(secretParts);

  // 正向嵌入（decodeLowBits 的逆）：秘密字节按给定 mode 打散进载体低位
  const embed = (bytes, m) => {
    const carrier = new Uint8Array(bytes.length * m).fill(0x80);
    for (let j = 0; j < bytes.length; j++) {
      const b = bytes[j];
      const c = j * m;
      if (m === 2) {
        carrier[c] = b;
      } else if (m === 4) {
        carrier[c] = (carrier[c] & 0xf0) | ((b >> 4) & 0xf);
        carrier[c + 2] = (carrier[c + 2] & 0xf0) | (b & 0xf);
      } else {
        carrier[c] = (carrier[c] & 0xfc) | ((b >> 6) & 3);
        carrier[c + 2] = (carrier[c + 2] & 0xfc) | ((b >> 4) & 3);
        carrier[c + 4] = (carrier[c + 4] & 0xfc) | ((b >> 2) & 3);
        carrier[c + 6] = (carrier[c + 6] & 0xfc) | (b & 3);
      }
    }
    return carrier;
  };
  const headCarrier = embed(headPart, 4);
  const recCarrier = embed(secret, mode);
  const carrierLen = headCarrier.length + recCarrier.length;
  const carrier = new Uint8Array(carrierLen);
  carrier.set(headCarrier, 0);
  carrier.set(recCarrier, headCarrier.length);

  // WAV 外壳：RIFF + fmt(PCM 16bit mono 44100) + data（载体 + 256 字节静音余量）
  const tail = new Uint8Array(256).fill(0x80);
  const dataLen = carrierLen + tail.length;
  const fmt = [
    1, 0,                 // PCM
    1, 0,                 // 单声道
    0x44, 0xac, 0, 0,     // 44100
    0x88, 0x58, 0x1, 0,   // byte rate = 44100*1*2
    2, 0,                 // block align
    16, 0,                // 位深
  ];
  const totalLen = 4 + (8 + fmt.length) + (8 + dataLen);
  const out = new Uint8Array(8 + totalLen);
  const dv = new DataView(out.buffer);
  let p = 0;
  const wtag = (s) => { for (const ch of s) out[p++] = ch.charCodeAt(0); };
  const wu32 = (v) => { dv.setUint32(p, v, true); p += 4; };
  wtag("RIFF"); wu32(totalLen); wtag("WAVE");
  wtag("fmt "); wu32(fmt.length); for (const b of fmt) out[p++] = b;
  wtag("data"); wu32(dataLen);
  out.set(carrier, p); out.set(tail, p + carrierLen);
  return out;
}

function concatBytes(parts) {
  let n = 0;
  for (const x of parts) n += x.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const x of parts) { out.set(x, o); o += x.length; }
  return out;
}

// ============ op run 包装 ============
async function deepsoundRun(text, p) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : inputToBytes(text, p);
  const password = String((p && p.password) || "");
  const a = await extractDeepSound(bytes, password);

  const lines = [
    `DeepSound ${a.version} · 质量模式 ${a.mode} · ${a.encrypted ? "AES-256 加密" : "未加密"}`,
    `共 ${a.files.length} 个隐藏文件：`,
    ...a.files.map((f) => ` - ${f.name} (${f.data.length} 字节)`),
  ];
  if (a.files.length === 0) {
    lines.push("", "（头部有效但无完整记录——文件可能被截断）");
    return lines.join("\n");
  }
  const td = new TextDecoder("utf-8", { fatal: false });
  let bin = "";
  for (const b of a.files[0].data) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const preview = td.decode(a.files[0].data);
  lines.push(
    "",
    `[${a.files[0].name}] 文本预览:`,
    preview.length > 1024 ? preview.slice(0, 1024) + "…（截断）" : (preview || "(空/不可打印)"),
    "",
    `[${a.files[0].name}] Base64${b64.length > 4096 ? "（截断，全文 " + b64.length + " 字符）" : ""}:`,
    b64.length > 4096 ? b64.slice(0, 4096) + "…" : b64,
  );
  return lines.join("\n");
}

// ============ 注册 ============
register({
  id: "deepsoundExtract", cat: "forensic", name: "DeepSound 提取",
  desc: "从 PCM WAV 载体的采样低位提取 DeepSound 隐藏文件（DSC2/DSCF · 明文/AES-256）",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "password", label: "密码（加密时填）", type: "text", default: "", placeholder: "AES 加密的 DeepSound 填密码" },
  ],
  run: deepsoundRun,
  acceptsBytes: true,
});

// ============ 加载期自检（async，导出 Promise 供回归 await；失败未处理拒绝会非零退出） ============
export const deepsoundSelfTest = (async () => {
  const assert = (cond, msg) => { if (!cond) throw new Error("deepsoundExtract 自检失败: " + msg); };
  const td = new TextEncoder();

  // ① 明文 DSC2 mode4 单文件（用例对齐权威形态：mini_secret.txt / flagOK）
  {
    const wav = await makeDeepSoundWav({ files: [{ name: "mini_secret.txt", data: td.encode("flagOK") }] });
    const a = await extractDeepSound(wav, "");
    assert(a.version === "DSC2" && a.mode === 4 && !a.encrypted, "头解析错");
    assert(a.files.length === 1 && a.files[0].name === "mini_secret.txt" && new TextDecoder().decode(a.files[0].data) === "flagOK", "明文提取错");
  }
  // ②/③ mode 2 与 mode 8 提取一致
  for (const mode of [2, 8]) {
    const wav = await makeDeepSoundWav({ mode, files: [{ name: "m.bin", data: new Uint8Array([0, 1, 0xfe, 0xff, 0x55]) }] });
    const a = await extractDeepSound(wav, "");
    assert(a.mode === mode && a.files[0].data.length === 5 && a.files[0].data[2] === 0xfe, `mode ${mode} 提取错`);
  }
  // ④ DSC2 AES 加密：pw123 → flagOK
  {
    const wav = await makeDeepSoundWav({ password: "pw123", files: [{ name: "mini_secret.txt", data: td.encode("flagOK") }] });
    const a = await extractDeepSound(wav, "pw123");
    assert(a.encrypted && new TextDecoder().decode(a.files[0].data) === "flagOK", "AES 提取错");
  }
  // ⑤ 错密码被拒 / ⑥ 加密缺密码被拒
  {
    const wav = await makeDeepSoundWav({ password: "pw123", files: [{ name: "a.txt", data: td.encode("x") }] });
    let err1 = null, err2 = null;
    try { await extractDeepSound(wav, "not-the-password"); } catch (e) { err1 = e.message; }
    try { await extractDeepSound(wav, ""); } catch (e) { err2 = e.message; }
    assert(err1 && err1.includes("密码错误"), "错密码应拒");
    assert(err2 && err2.includes("已加密"), "缺密码应提示");
  }
  // ⑦ DSCF 加密（ASCII 密钥路径）+ 非 ASCII 字符按 '?' 处理
  {
    const wav = await makeDeepSoundWav({ version: "DSCF", password: "abc123", files: [{ name: "d.bin", data: td.encode("DSCF-OK") }] });
    const a = await extractDeepSound(wav, "abc123");
    assert(a.version === "DSCF" && new TextDecoder().decode(a.files[0].data) === "DSCF-OK", "DSCF 提取错");
    assert(keyDscf("密")[0] === 0x3f, "DSCF 非 ASCII 应记 '?'");
  }
  // ⑧ 多文件顺序提取
  {
    const wav = await makeDeepSoundWav({ files: [
      { name: "one.txt", data: td.encode("first") },
      { name: "two.txt", data: td.encode("second-file") },
    ] });
    const a = await extractDeepSound(wav, "");
    assert(a.files.length === 2 && a.files[0].name === "one.txt" && new TextDecoder().decode(a.files[1].data) === "second-file", "多文件错");
  }
  // ⑨ 非 WAV / 无 DeepSound 头
  {
    let e1 = null, e2 = null;
    try { await extractDeepSound(new Uint8Array(64), ""); } catch (e) { e1 = e.message; }
    try { await extractDeepSound(await makeDeepSoundWav({}), ""); } catch (e) { e2 = e.message; }
    assert(e1 && e1.includes("data 块"), "非 WAV 应拒");
    // 空文件表：头仍在（DSC2 头）→ 不该报"未找到头"，应给出 0 文件
    assert(e2 === null, "空表构造不应报错");
  }
  // ⑩ 纯 WAV（无 DeepSound 数据）报未找到头
  {
    const plain = new Uint8Array(44 + 1024);
    const dv = new DataView(plain.buffer);
    for (const [i, ch] of "RIFF".split("").entries()) plain[i] = ch.charCodeAt(0);
    dv.setUint32(4, plain.length - 8, true);
    for (const [i, ch] of "WAVEdata".split("").entries()) plain[8 + i] = ch.charCodeAt(0);
    dv.setUint32(16, 1024, true);
    let e = null;
    try { await extractDeepSound(plain, ""); } catch (err) { e = err.message; }
    assert(e && e.includes("未找到 DeepSound 头"), "纯 WAV 应报未找到头");
  }
  // ⑪ AES-256-ECB NIST SP 800-38A F.1.5 权威向量（链路保险）
  {
    const key = new Uint8Array("603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4".match(/../g).map((h) => parseInt(h, 16)));
    const pt = new Uint8Array("6bc1bee22e409f96e93d7e117393172a".match(/../g).map((h) => parseInt(h, 16)));
    const ct = aesEncrypt(pt, key, { mode: "ECB", pad: false });
    const hex = Array.from(ct, (b) => b.toString(16).padStart(2, "0")).join("");
    assert(hex === "f3eed1bdb5d2a03c064b5a7e3db181f8", "AES-256-ECB NIST 向量错: " + hex);
  }
  // ⑫ keyDsc2 UTF-16LE 派生：SHA-256 应与手工构造一致（"abc" → 已知摘要）
  {
    const k = await keyDsc2("abc");
    const sha = Array.from(k, (b) => b.toString(16).padStart(2, "0")).join("");
    assert(sha === "13e228567e8249fce53337f25d7970de3bd68ab2653424c7b8f9fd05e33caedf", "SHA-256(UTF16LE('abc')) 错: " + sha);
  }
  return true;
})();
