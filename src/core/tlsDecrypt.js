/*
 * tlsDecrypt.js — TLS1.2 已知密钥离线还原（cat:'forensic'，单向 run，预研档）。
 *
 * 固定单档口径（本卡明确不承诺其他）：
 * - TLS1.2 + AES-128-GCM 套件（PRF-SHA256 家族：0xc02b/0xc02f/0x009c 等）
 * - 密钥来源仅限 NSS keylog 的 CLIENT_RANDOM 行（客户端随机数 → master_secret）
 * - TLS1.3 / PRF-SHA384 套件（AES-256-GCM）/ CBC 套件 / 服务端私钥 RSA 解密：显式拒绝
 *
 * 流程（RFC 5246 + RFC 5288，照规范实现）：
 * 1) 复用 pcapDeep TCP 重组还原双向字节流
 * 2) TLS 记录层解析（type/ver/len），握手消息跨记录拼接
 * 3) ClientHello/ServerHello 提取 client_random / server_random / cipher_suite
 * 4) keylog 按 client_random 命中 master_secret
 * 5) key_block = PRF(master, "key expansion", server_random||client_random)
 *    → client_write_key(16) server_write_key(16) client_salt(4) server_salt(4)
 * 6) ChangeCipherSpec 后每方向独立 64bit 序号；application_data 记录
 *    nonce = salt(4)||explicit_nonce(8)，AAD = seq(8)||type(1)||ver(2)||明文长(2)，
 *    AES-128-GCM 认证解密（tag 验证失败按记录报错，不伪造明文）
 *
 * 诚实边界：服务端私钥路径不做（仅适用旧 RSA 明文握手）；无 keylog 明确不可解；
 * TLS1.3 密钥调度不同（HKDF + 多密钥期），不在本档。
 *
 * 契约：件内自注册；run 为 async（AES-GCM 走 WebCrypto）；返回文本或 { text, files }。
 */
import { register } from "./registry.js";
import { decodePcap, reassembleFlows, reassembleDir } from "./pcapDeep.js";
import { aesGcmDecrypt } from "./modern.js";
import { sha256Hex } from "./shaExt.js";

// ============================================================
// 小工具
// ============================================================
function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const v = bytes[i];
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}
function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
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

// ============================================================
// SHA-256 / HMAC-SHA256 / PRF（RFC 2104 + RFC 5246 §5）
// HMAC 用 shaExt 的纯 JS 压缩函数自组（sha256Hex 只出 hex，这里需要字节）
// ============================================================
function sha256Bytes(bytes) { return hexToBytes(sha256Hex(bytes)); }

function hmacSha256(key, msg) {
  const block = 64;
  let k = key.length > block ? sha256Bytes(key) : key;
  const ipad = new Uint8Array(block), opad = new Uint8Array(block);
  const kPad = new Uint8Array(block);
  kPad.set(k.subarray(0, Math.min(k.length, block)));
  for (let i = 0; i < block; i++) {
    ipad[i] = kPad[i] ^ 0x36;
    opad[i] = kPad[i] ^ 0x5c;
  }
  const inner = new Uint8Array(block + msg.length);
  inner.set(ipad); inner.set(msg, block);
  const ih = sha256Bytes(inner);
  const outer = new Uint8Array(block + ih.length);
  outer.set(opad); outer.set(ih, block);
  return sha256Bytes(outer);
}

// P_hash 展开：A(1)+seed, A(2)+seed, ... 直至取满 outLen
function prfSha256(secret, label, seed, outLen) {
  const labelSeed = new Uint8Array(label.length + seed.length);
  labelSeed.set(label); labelSeed.set(seed, label.length);
  let a = hmacSha256(secret, labelSeed); // A(1)
  const out = [];
  let total = 0;
  while (total < outLen) {
    const chunkIn = new Uint8Array(a.length + labelSeed.length);
    chunkIn.set(a); chunkIn.set(labelSeed, a.length);
    const chunk = hmacSha256(secret, chunkIn);
    out.push(chunk);
    total += chunk.length;
    a = hmacSha256(secret, a);
  }
  const res = new Uint8Array(outLen);
  let off = 0;
  for (const c of out) {
    const n = Math.min(c.length, outLen - off);
    res.set(c.subarray(0, n), off);
    off += n;
    if (off >= outLen) break;
  }
  return res;
}

// ============================================================
// TLS 记录层 / 握手层解析
// ============================================================
function parseRecords(bytes) {
  const recs = [];
  let pos = 0;
  while (pos + 5 <= bytes.length) {
    const type = bytes[pos];
    const ver = (bytes[pos + 1] << 8) | bytes[pos + 2];
    const len = (bytes[pos + 3] << 8) | bytes[pos + 4];
    if (type < 20 || type > 23 || ver < 0x0300 || ver > 0x0304 || pos + 5 + len > bytes.length) {
      return { recs, partial: true }; // 非记录结构/截断：如实停止
    }
    recs.push({ type, ver, payload: bytes.subarray(pos + 5, pos + 5 + len), offset: pos });
    pos += 5 + len;
  }
  return { recs, partial: pos !== bytes.length };
}

function parseHandshakes(recs) {
  // 拼接全部 handshake 记录载荷再切消息（消息可跨记录，RFC 5246 §6.2.1）
  let total = 0;
  for (const r of recs) if (r.type === 22) total += r.payload.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const r of recs) if (r.type === 22) { buf.set(r.payload, off); off += r.payload.length; }
  const msgs = [];
  let pos = 0;
  while (pos + 4 <= buf.length) {
    const mtype = buf[pos];
    const len = (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3];
    if (pos + 4 + len > buf.length) break;
    msgs.push({ mtype, body: buf.subarray(pos + 4, pos + 4 + len) });
    pos += 4 + len;
  }
  return msgs;
}

// 套件表：本档支持（PRF-SHA256 + AES-128-GCM）/ 显式拒绝理由
const SUITES = {
  0xc02b: { name: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256", ok: true },
  0xc02f: { name: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256", ok: true },
  0x009c: { name: "TLS_RSA_WITH_AES_128_GCM_SHA256", ok: true },
  0xcc14: { name: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256", ok: false, why: "ChaCha20-Poly1305 不在本档" },
  0xcc13: { name: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256", ok: false, why: "ChaCha20-Poly1305 不在本档" },
  0xc02c: { name: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384", ok: false, why: "PRF-SHA384 套件不在本档" },
  0xc030: { name: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384", ok: false, why: "PRF-SHA384 套件不在本档" },
  0x009d: { name: "TLS_RSA_WITH_AES_256_GCM_SHA384", ok: false, why: "PRF-SHA384 套件不在本档" },
};
// TLS1.3 套件（0x13xx）
function isTls13Suite(v) { return (v & 0xff00) === 0x1300; }

function parseHello(hsCli, hsSrv) {
  // ClientHello 在客户端方向；ServerHello（含协商套件）在服务器方向
  let ch = null, sh = null;
  for (const m of hsCli) {
    if (m.mtype === 1 && !ch && m.body.length >= 34) {
      ch = { random: m.body.subarray(2, 34) };
    }
  }
  for (const m of hsSrv) {
    if (m.mtype === 2 && !sh && m.body.length >= 36) {
      const ver = (m.body[0] << 8) | m.body[1];
      const random = m.body.subarray(2, 34);
      const sidLen = m.body[34];
      const csOff = 35 + sidLen;
      if (csOff + 2 <= m.body.length) {
        sh = { ver, random, cipher: (m.body[csOff] << 8) | m.body[csOff + 1] };
      }
    }
  }
  return { ch, sh };
}

// ============================================================
// keylog 解析（NSS 格式）
// ============================================================
function parseKeylog(text) {
  const byClientRandom = new Map();
  let tls13Labels = false;
  for (const line of String(text).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const parts = t.split(/\s+/);
    if (parts.length !== 3) continue;
    if (parts[0] === "CLIENT_RANDOM" && /^[0-9a-fA-F]{64}$/.test(parts[1]) && /^[0-9a-fA-F]{96}$/.test(parts[2])) {
      byClientRandom.set(parts[1].toLowerCase(), parts[2].toLowerCase());
    } else if (parts[0] !== "RSA") {
      tls13Labels = true; // CLIENT_HANDSHAKE_TRAFFIC_SECRET 等 1.3 标签
    }
  }
  return { byClientRandom, tls13Labels };
}

// ============================================================
// 记录解密（RFC 5288）
// ============================================================
async function decryptDirection(recs, writeKey, salt) {
  const seqArr = []; // 每记录的明文（按记录边界保留），null=认证失败
  let seq = 0;
  let ccsSeen = false;
  const stats = { total: recs.length, appData: 0, decrypted: 0, failed: 0 };
  for (const r of recs) {
    if (r.type === 20) { ccsSeen = true; seq = 0; continue; }
    if (!ccsSeen) continue; // CCS 前的明文握手：不占序号
    // CCS 后每条记录（含加密的 Finished(type22)/alert(type21)）都消耗序号，仅解密 app_data
    if (r.type !== 23) { seq++; continue; }
    stats.appData++;
    if (r.payload.length < 24) { // 最小 8B explicit_nonce + 16B tag（空密文=恰好 24）
      stats.failed++; seqArr.push(null); seq++; continue;
    }
    const nonce = new Uint8Array(12);
    nonce.set(salt, 0);
    nonce.set(r.payload.subarray(0, 8), 4);
    const ctWithTag = r.payload.subarray(8);
    const plainLen = ctWithTag.length - 16;
    const aad = new Uint8Array(13);
    for (let i = 0; i < 8; i++) aad[i] = Number((BigInt(seq) >> BigInt(56 - i * 8)) & 0xffn); // 64bit BE
    aad[8] = r.type;
    aad[9] = (r.ver >> 8) & 0xff;
    aad[10] = r.ver & 0xff;
    aad[11] = (plainLen >> 8) & 0xff;
    aad[12] = plainLen & 0xff;
    try {
      const pt = await aesGcmDecrypt(ctWithTag, writeKey, nonce, aad);
      seqArr.push(pt);
      stats.decrypted++;
    } catch {
      seqArr.push(null);
      stats.failed++;
    }
    seq++;
  }
  return { parts: seqArr, stats };
}

// ============================================================
// run
// ============================================================
async function tlsDecryptRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;
  const keylogText = String(p.keylog || "");
  const preview = parseInt(p.previewBytes, 10) || 400;

  const flows = reassembleFlows(res.dissected);
  if (flows.size === 0) return "未发现 TCP 段。TLS 还原依赖 TCP 重组，此流量中无 TCP。";
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

  // TLS 流识别 + 解析
  const tlsFlows = [];
  for (const f of flowList) {
    const parsed = f.dirs.map((d) => parseRecords(d.bytes));
    const isTls = parsed.some((r) => r.recs.length > 0 && !r.partial);
    if (!isTls) continue;
    const hsA = parseHandshakes(parsed[0].recs);
    const hsB = parseHandshakes(parsed[1].recs);
    tlsFlows.push({ flow: f, recsA: parsed[0].recs, recsB: parsed[1].recs, hsA, hsB });
  }
  if (tlsFlows.length === 0) {
    return "未发现 TLS 流量（无完整 TLS 记录结构的 TCP 流）。可能是明文协议（HTTP/FTP 等）或非 TCP 流量。";
  }

  const keylog = parseKeylog(keylogText);
  if (!keylogText.trim()) {
    return "未提供 keylog——无密钥明确不可解。本 op 仅支持 NSS keylog 的 CLIENT_RANDOM 行（TLS1.2 会话主密钥），请从抓包侧导出后粘贴。";
  }

  const lines = [];
  const files = [];
  lines.push("=== TLS1.2 已知密钥离线还原（AES-128-GCM + CLIENT_RANDOM keylog 单档）===");
  lines.push(`keylog: CLIENT_RANDOM ${keylog.byClientRandom.size} 条${keylog.tls13Labels ? "（含 TLS1.3 标签行，本档仅用 CLIENT_RANDOM）" : ""}`);
  lines.push(`TLS 流: ${tlsFlows.length} 条`);
  lines.push("");

  let anyDecrypted = false;
  for (const tf of tlsFlows) {
    const f = tf.flow;
    lines.push(`▼ TLS 流  ${f.a} ⇄ ${f.b}`);
    // 客户端方向 = 含 ClientHello 的方向（Hello 分属两个方向：CH 在客户端流，SH 在服务器流）
    let ci = -1;
    if (tf.hsA.some((m) => m.mtype === 1)) ci = 0;
    else if (tf.hsB.some((m) => m.mtype === 1)) ci = 1;
    const hsCli = ci === 0 ? tf.hsA : tf.hsB;
    const hsSrv = ci === 0 ? tf.hsB : tf.hsA;
    const { ch, sh } = parseHello(hsCli, hsSrv);
    if (!ch || !sh) {
      lines.push("  ⚠ 未同时捕获 ClientHello 与 ServerHello（会话中段抓包），无法绑定 keylog。");
      lines.push("");
      continue;
    }
    lines.push(`  ClientHello random: ${toHex(ch.random)}`);
    lines.push(`  ServerHello random: ${toHex(sh.random)}`);
    const suiteName = SUITES[sh.cipher] ? SUITES[sh.cipher].name :
      isTls13Suite(sh.cipher) ? `TLS1.3 套件 0x${sh.cipher.toString(16)}` :
      `0x${sh.cipher.toString(16).padStart(4, "0")}`;
    lines.push(`  协商套件: ${suiteName}（ServerHello legacy_version 0x${sh.ver.toString(16)}）`);
    if (isTls13Suite(sh.cipher) || sh.ver === 0x0304) {
      lines.push("  ✗ TLS1.3 显式拒绝：密钥调度为 HKDF 多密钥期，与 TLS1.2 keylog/PRF 不兼容，不在本档（预研边界，勿混用）。");
      lines.push("");
      continue;
    }
    const suiteInfo = SUITES[sh.cipher];
    if (!suiteInfo || !suiteInfo.ok) {
      lines.push(`  ✗ 套件不支持: ${suiteInfo ? suiteInfo.name + " — " + suiteInfo.why : "未知套件"}。本档固定 TLS1.2 + AES-128-GCM（PRF-SHA256）。`);
      lines.push("");
      continue;
    }
    const crHex = toHex(ch.random);
    const msHex = keylog.byClientRandom.get(crHex);
    if (!msHex) {
      lines.push("  ✗ keylog 未命中本会话（client_random 不匹配）：无对应 master_secret，明确不可解。切勿用其他会话密钥伪造明文。");
      lines.push("");
      continue;
    }
    lines.push("  keylog 命中: 是（CLIENT_RANDOM → master_secret）");

    // key_block（RFC 5246 §6.3 + RFC 5288 §3：AEAD 无 MAC 密钥）
    const masterSecret = hexToBytes(msHex);
    const seed = new Uint8Array(sh.random.length + ch.random.length);
    seed.set(sh.random); seed.set(ch.random, sh.random.length);
    const keyBlock = prfSha256(masterSecret, new TextEncoder().encode("key expansion"), seed, 48);
    const clientKey = keyBlock.subarray(0, 16);
    const serverKey = keyBlock.subarray(16, 32);
    const clientSalt = keyBlock.subarray(32, 36);
    const serverSalt = keyBlock.subarray(36, 40);

    const cliRecs = ci === 0 ? tf.recsA : tf.recsB;
    const srvRecs = ci === 0 ? tf.recsB : tf.recsA;
    const cliDir = ci === 0 ? f.dirs[0] : f.dirs[1];
    const srvDir = ci === 0 ? f.dirs[1] : f.dirs[0];
    const c2s = await decryptDirection(cliRecs, clientKey, clientSalt);
    const s2c = await decryptDirection(srvRecs, serverKey, serverSalt);
    lines.push(`  记录: c2s ${cliRecs.length} 条（app_data ${c2s.stats.appData}，解密成功 ${c2s.stats.decrypted}，认证失败 ${c2s.stats.failed}）/ s2c ${srvRecs.length} 条（app_data ${s2c.stats.appData}，解密成功 ${s2c.stats.decrypted}，认证失败 ${s2c.stats.failed}）`);
    if (c2s.stats.decrypted === 0 && s2c.stats.decrypted === 0) {
      lines.push("  ✗ 全部 app_data 认证失败：keylog 与会话不匹配或数据损坏，无可信明文输出。");
      lines.push("");
      continue;
    }
    for (const [tag, d, dec] of [["c2s（客户端→服务器）", cliDir, c2s], ["s2c（服务器→客户端）", srvDir, s2c]]) {
      const total = dec.parts.reduce((s, x) => s + (x ? x.length : 0), 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const part of dec.parts) if (part) { merged.set(part, off); off += part.length; }
      if (merged.length === 0) continue;
      anyDecrypted = true;
      lines.push(`  [${tag} 解密流] ${merged.length} 字节  SHA-256: ${sha256Hex(merged)}`);
      const n = Math.min(merged.length, preview);
      if (isMostlyText(merged, n)) {
        lines.push(`    文本: ${latin1(merged.subarray(0, n)).replace(/\r/g, "\\r").replace(/\n/g, "\\n")}${merged.length > n ? " …" : ""}`);
      } else {
        lines.push(`    ASCII: ${asciiPreview(merged, n)}`);
      }
      files.push({ name: `tls_${tlsFlows.indexOf(tf)}_${tag.startsWith("c2s") ? "c2s" : "s2c"}.bin`, mime: "application/octet-stream", bytes: merged });
    }
    lines.push("");
  }
  if (!anyDecrypted && tlsFlows.length > 0) lines.push("（无可信解密结果：见上方逐流拒绝原因）");
  return files.length ? { text: lines.join("\n"), files } : lines.join("\n");
}

register({
  id: "tlsDecrypt",
  family: "pcap",
  familyLabel: "tls",
  cat: "forensic",
  name: "TLS1.2 已知密钥还原",
  desc: "TLS1.2 + AES-128-GCM 单档离线还原：TCP 重组→记录/握手解析→keylog CLIENT_RANDOM 命中→key_block 派生→GCM 认证解密，导出双向明文（SHA-256）。TLS1.3/SHA384/CBC 套件与无密钥场景显式拒绝，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { acceptFile: "text", key: "keylog", label: "keylog（NSS CLIENT_RANDOM 行）", type: "textarea", default: "", placeholder: "CLIENT_RANDOM <64hex> <64hex>，每行一条" },
    { key: "previewBytes", label: "明文预览字节", type: "number", default: 400 },
  ],
  run: tlsDecryptRun,
  acceptsBytes: true,
});
