/*
 * wpaDecrypt.js — WPA/WPA2-PSK 离线握手校验与 CCMP 解密（cat:'forensic'，单向 run，预研档）。
 *
 * 固定单档口径（本卡明确不承诺其他）：
 * - WPA2-PSK（RSN）4 次握手解析：M1-M4 判别（KeyAck/KeyMIC/Install/Secure 位）、
 *   重放计数器单调性检查、ANonce/SNonce 提取
 * - 已知 SSID+口令 → PMK(PBKDF2-HMAC-SHA1,4096) → PTK(PRF-SHA1,802.11i) → KCK 校验
 *   M2/M4 的 MIC（HMAC-SHA1 截 16 字节），口令对错显式给结论
 * - CCMP（AES-CCM M=8/L=2，RFC 3610 档）数据帧认证解密，解密载荷重组为
 *   经典 pcap（linktype 1 Ethernet），可直接接 pcapParse/TCP 重组等已有流量链
 * - TKIP：显式拒绝（WEP/TKIP 不在本档）；组播 GTK 解密不做（M3 加密 Key Data
 *   需 KEK+AES-KeyWrap，登记为后续项，复用 keywrap.js 可行）
 *
 * 输入：radiotap(linktype 127) 或裸 802.11(linktype 105) pcap/pcapng。只处理用户
 * 提供的捕获文件，不调网卡、不注入、无联网；有限口令逐个验证，不做无界爆破。
 *
 * 密码学复用：AES 块加密复用 modern.js（NIST 向量验证过的纯 JS AES），
 * SHA-1 复用 shaExt.js 纯 JS 实现；HMAC/PBKDF2/PRF 按 RFC 2104 / 802.11i 自组。
 * CCM 核心导出（ccmRawDecrypt）供 RFC 3610 向量对拍（与 pcapDeep 导出 inflateRaw 同例）。
 */
import { register } from "./registry.js";
import { inputToBytes, parseContainer } from "./pcapParse.js";
import { aesEncrypt } from "./modern.js";
import { sha1Hex, sha256Hex } from "./shaExt.js";

// ============================================================
// 小工具
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
function hexToBytes(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function fmtMac(b, off) {
  return [0, 1, 2, 3, 4, 5].map((i) => b[off + i].toString(16).padStart(2, "0")).join(":");
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
function cmpBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ============================================================
// SHA-1 / HMAC-SHA1 / PBKDF2 / WPA PRF（RFC 2104 + 802.11i）
// ============================================================
function sha1Bytes(bytes) { return hexToBytes(sha1Hex(bytes)); }

function hmacSha1(key, msg) {
  const block = 64;
  let k = key.length > block ? sha1Bytes(key) : key;
  const ipad = new Uint8Array(block), opad = new Uint8Array(block);
  const kPad = new Uint8Array(block);
  kPad.set(k.subarray(0, Math.min(k.length, block)));
  for (let i = 0; i < block; i++) {
    ipad[i] = kPad[i] ^ 0x36;
    opad[i] = kPad[i] ^ 0x5c;
  }
  const inner = new Uint8Array(block + msg.length);
  inner.set(ipad); inner.set(msg, block);
  const ih = sha1Bytes(inner);
  const outer = new Uint8Array(block + ih.length);
  outer.set(opad); outer.set(ih, block);
  return sha1Bytes(outer);
}

export function pbkdf2Sha1(pass, salt, iter, dkLen) {
  const hLen = 20;
  const nBlocks = Math.ceil(dkLen / hLen);
  const out = new Uint8Array(nBlocks * hLen);
  for (let b = 1; b <= nBlocks; b++) {
    const saltInt = new Uint8Array(salt.length + 4);
    saltInt.set(salt);
    saltInt[salt.length] = (b >>> 24) & 0xff;
    saltInt[salt.length + 1] = (b >>> 16) & 0xff;
    saltInt[salt.length + 2] = (b >>> 8) & 0xff;
    saltInt[salt.length + 3] = b & 0xff;
    let u = hmacSha1(pass, saltInt);
    const t = u.slice();
    for (let i = 1; i < iter; i++) {
      u = hmacSha1(pass, u);
      for (let j = 0; j < hLen; j++) t[j] ^= u[j];
    }
    out.set(t, (b - 1) * hLen);
  }
  return out.subarray(0, dkLen);
}

// 802.11i PRF-X：HMAC-SHA1(key, label || 0x00 || data || i)
function prfWpa(key, label, data, outLen) {
  const out = [];
  let total = 0, i = 0;
  while (total < outLen) {
    const m = new Uint8Array(label.length + 1 + data.length + 1);
    m.set(label, 0);
    m[label.length] = 0;
    m.set(data, label.length + 1);
    m[m.length - 1] = i;
    const d = hmacSha1(key, m);
    out.push(d);
    total += d.length;
    i++;
  }
  const res = new Uint8Array(outLen);
  let off = 0;
  for (const c of out) {
    const n = Math.min(c.length, outLen - off);
    res.set(c.subarray(0, n), off);
    off += n;
  }
  return res;
}

function bytesLess(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i];
  }
  return a.length < b.length;
}

export function wpaPtk(pmk, aa, spa, anonce, snonce) {
  const minMax = (x, y) => bytesLess(x, y) ? [x, y] : [y, x];  // 字节序（Uint8Array 上 < 是字符串序，不可用）
  const [macA, macB] = minMax(aa, spa);
  const [anA, anB] = minMax(anonce, snonce);
  // 802.11i §H.4：直接拼接 min(AA)max(AA)min(ANonce)max(ANonce)，无对齐填充（6+6+32+32=76B）
  const data = new Uint8Array(macA.length + macB.length + anA.length + anB.length);
  let off = 0;
  data.set(macA, off); off += macA.length;
  data.set(macB, off); off += macB.length;
  data.set(anA, off); off += anA.length;
  data.set(anB, off);
  return prfWpa(pmk, new TextEncoder().encode("Pairwise key expansion"), data, 48);
}

// ============================================================
// CCM 核心（RFC 3610，M=8/L=2/13B nonce —— CCMP 档）
// ============================================================
const aesBlock = (key, block16) => aesEncrypt(block16, key, { mode: "ECB", pad: false });

export function ccmRawDecrypt(key, nonce13, aad, ctAndMic) {
  if (nonce13.length !== 13) throw new Error("ccm: nonce 须 13 字节");
  if (ctAndMic.length < 8) throw new Error("ccm: 密文过短");
  const ct = ctAndMic.subarray(0, ctAndMic.length - 8);
  const mic = ctAndMic.subarray(ctAndMic.length - 8);
  // CTR keystream（S0 计数器 0 给 MIC，S1.. 解密文）
  const ctr = (n) => {
    const c = new Uint8Array(16);
    c[0] = 0x01;
    c.set(nonce13, 1);
    c[14] = (n >> 8) & 0xff;
    c[15] = n & 0xff;
    return aesBlock(key, c);
  };
  const pt = new Uint8Array(ct.length);
  {
    let n = 1, off = 0;
    while (off < ct.length) {
      const ks = ctr(n++);
      const m = Math.min(16, ct.length - off);
      for (let i = 0; i < m; i++) pt[off + i] = ct[off + i] ^ ks[i];
      off += 16;
    }
  }
  // CBC-MAC 必须算在明文上（RFC 3610 §2.2：CBC-MAC over the message）
  const blocks = [];
  const b0 = new Uint8Array(16);
  b0[0] = 0x59;
  b0.set(nonce13, 1);
  b0[14] = (pt.length >> 8) & 0xff;
  b0[15] = pt.length & 0xff;
  blocks.push(b0);
  const la = new Uint8Array(2);
  la[0] = (aad.length >> 8) & 0xff;
  la[1] = aad.length & 0xff;
  const aadTotal = 2 + aad.length;
  const aadPadded = new Uint8Array(aadTotal + ((16 - (aadTotal % 16)) % 16));
  aadPadded.set(la, 0);
  aadPadded.set(aad, 2);
  for (let i = 0; i < aadPadded.length; i += 16) blocks.push(aadPadded.subarray(i, i + 16));
  const msgPadded = new Uint8Array(pt.length + ((16 - (pt.length % 16)) % 16));
  msgPadded.set(pt, 0);
  for (let i = 0; i < msgPadded.length; i += 16) blocks.push(msgPadded.subarray(i, i + 16));
  let x = new Uint8Array(16);
  for (const blk of blocks) {
    const xored = new Uint8Array(16);
    for (let i = 0; i < 16; i++) xored[i] = x[i] ^ blk[i];
    x = aesBlock(key, xored);
  }
  const s0 = ctr(0);
  const calcMic = new Uint8Array(8);
  for (let i = 0; i < 8; i++) calcMic[i] = x[i] ^ s0[i];
  const ok = cmpBytes(calcMic, mic);
  return { pt, ok };
}

// ============================================================
// 802.11 / radiotap / EAPOL 解析
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }

function parse80211(frame) {
  if (frame.length < 24) return null;
  const fc = u16le(frame, 0);
  const type = (fc >> 2) & 3;
  const subtype = (fc >> 4) & 15;
  if (type !== 2) return { kind: "nondata", type, subtype };
  const toDs = (fc >> 8) & 1;
  const fromDs = (fc >> 9) & 1;
  const protectedBit = (fc >> 14) & 1;
  const qos = (subtype & 8) !== 0;
  let hdrLen = 24 + (toDs && fromDs ? 6 : 0) + (qos ? 2 : 0);
  if (frame.length < hdrLen) return null;
  return {
    kind: "data", fc, subtype, toDs, fromDs, protectedBit, qos,
    addr1: frame.subarray(4, 10), addr2: frame.subarray(10, 16), addr3: frame.subarray(16, 22),
    sc: u16le(frame, 22), hdrLen,
    body: frame.subarray(hdrLen),
  };
}

function parseEapolKey(body) {
  // LLC/SNAP 头共 9 字节：AA AA AA 03 00 00 00 88 8E，EAPOL 从 body+9 起
  if (!(body[0] === 0xaa && body[1] === 0xaa && body[2] === 0xaa && body[3] === 0x03 &&
        body[4] === 0 && body[5] === 0 && body[6] === 0 && body[7] === 0x88 && body[8] === 0x8e)) return null;
  const e = body.subarray(9);
  if (e.length < 99 || e[1] !== 3) return null;
  const bodyLen = (e[2] << 8) | e[3];
  const descType = e[4];
  if (descType !== 2 && descType !== 254) return { descType };
  const ki = u16le(e, 5);
  const keyInfo = {
    ver: ki & 7, pairwise: ((ki >> 3) & 1) === 1, install: ((ki >> 6) & 1) === 1,
    ack: ((ki >> 7) & 1) === 1, mic: ((ki >> 8) & 1) === 1, secure: ((ki >> 9) & 1) === 1,
    encryptedKd: ((ki >> 12) & 1) === 1,
  };
  const replay = [];
  for (let i = 0; i < 8; i++) replay.push(e[9 + i]);
  const nonce = e.subarray(17, 49);
  const mic = e.subarray(81, 97);
  const kdLen = (e[97] << 8) | e[98];
  // M 判别：M1=ack无mic；M2=mic无ack且nonce 非零；M3=ack+mic(+install/secure)；M4=mic无ack且 nonce 全零
  let msgNo = null;
  const nonceNonZero = nonce.some((b) => b !== 0);
  if (keyInfo.ack && !keyInfo.mic) msgNo = 1;
  else if (keyInfo.mic && !keyInfo.ack && nonceNonZero) msgNo = 2;
  else if (keyInfo.ack && keyInfo.mic) msgNo = 3;
  else if (keyInfo.mic && !keyInfo.ack && !nonceNonZero) msgNo = 4;
  return { ver: e[0], descType, keyInfo, replay, nonce, mic, kdLen, bodyLen, msgNo,
    frame: e.subarray(0, 4 + bodyLen) /* MIC 计算范围：EAPOL 头+body */ };
}

// CCMP 解密（802.11i Annex / 802.11-2016 §12.5）
function ccmpDecrypt(df, tk) {
  const body = df.body;
  if (body.length < 16) return { error: "CCMP 体过短" };
  const extIv = body[0];
  if (extIv !== 0x20 && extIv !== 0x00) return { tkip: true };
  if ((extIv & 0x20) === 0) return { tkip: true }; // 无 ExtIV：TKIP/WEP 档
  const pn = body.subarray(1, 7); // PN5..PN0
  const ctMic = body.subarray(8);
  if (ctMic.length < 8) return { error: "CCMP 密文过短" };
  const fc = df.fc & ~(0x0010 | 0x0800 | 0x1000 | 0x2000 | 0x4000);
  const sc = df.sc & 0x000f;
  const aad = new Uint8Array(22);
  aad[0] = (fc >> 8) & 0xff; aad[1] = fc & 0xff;
  aad.set(df.addr1, 2); aad.set(df.addr2, 8); aad.set(df.addr3, 14);
  aad[20] = (sc >> 8) & 0xff; aad[21] = sc & 0xff;
  const nonce = new Uint8Array(13);
  nonce[0] = 0;
  nonce.set(pn, 1);
  nonce.set(df.addr2, 7);
  const { pt, ok } = ccmRawDecrypt(tk, nonce, aad, ctMic);
  return { pt, ok, pn: toHex(pn) };
}

// 解密帧 → Ethernet 帧（基础设施网络地址映射）
function toEth(df, llcPayload) {
  // LLC/SNAP 头 9 字节：AA AA AA 03 | OUI 00 00 00 | ethertype(2) at [7:9]
  if (llcPayload.length < 9 || llcPayload[0] !== 0xaa || llcPayload[1] !== 0xaa || llcPayload[2] !== 0xaa ||
      llcPayload[3] !== 0x03 || llcPayload[4] !== 0 || llcPayload[5] !== 0 || llcPayload[6] !== 0) return null;
  const ethertype = (llcPayload[7] << 8) | llcPayload[8];
  const payload = llcPayload.subarray(9);
  // ToDS(上行): addr2=STA(SA), addr3=DA；FromDS(下行): addr2=BSSID/AP(SA 桥), addr3=SA；addr1=DA
  const src = df.fromDs ? df.addr3 : df.addr2;
  const dst = df.fromDs ? df.addr1 : df.addr3;
  const eth = new Uint8Array(14 + payload.length);
  eth.set(dst, 0); eth.set(src, 6);
  eth[12] = (ethertype >> 8) & 0xff; eth[13] = ethertype & 0xff;
  eth.set(payload, 14);
  return eth;
}

// pcap 写出（经典 pcap，linktype 1）
function buildEthernetPcap(ethFrames) {
  const chunks = [new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1, 2, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff & 262144, 262144 >> 8, 0, 0, 1, 0, 0, 0])];
  ethFrames.forEach((fr, i) => {
    const rec = new Uint8Array(16 + fr.length);
    const ts = 1700000200 + i;
    rec[0] = ts & 0xff; rec[1] = (ts >> 8) & 0xff; rec[2] = (ts >> 16) & 0xff; rec[3] = (ts >> 24) & 0xff;
    const len = fr.length;
    rec[8] = len & 0xff; rec[9] = (len >> 8) & 0xff; rec[10] = (len >> 16) & 0xff; rec[11] = (len >> 24) & 0xff;
    rec[12] = len & 0xff; rec[13] = (len >> 8) & 0xff; rec[14] = (len >> 16) & 0xff; rec[15] = (len >> 24) & 0xff;
    rec.set(fr, 16);
    chunks.push(rec);
  });
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ============================================================
// run
// ============================================================
function wpaDecryptRun(text, p = {}) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return "（空输入）请输入 802.11 捕获（radiotap linktype 127 或裸 802.11 linktype 105）的 pcap/pcapng。";
  }
  let bytes;
  try {
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, p.inputEnc || "auto");
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  let container;
  try {
    container = parseContainer(bytes);
  } catch (e) {
    return "pcap/pcapng 解析失败：" + (e && e.message ? e.message : String(e));
  }
  const ssid = String(p.ssid || "").trim();
  const passphrase = String(p.passphrase || "");
  const doDecrypt = String(p.decrypt || "auto") === "auto" ? true : String(p.decrypt) === "on";

  // 链路层收集
  const frames = [];
  for (const pkt of container.packets) {
    const lt = pkt.linkType !== undefined ? pkt.linkType : container.linkType;
    let fr = pkt.raw;
    if (lt === 127) {
      if (fr.length < 8) continue;
      const rtLen = u16le(fr, 2);
      if (rtLen < 8 || rtLen > fr.length) continue;
      fr = fr.subarray(rtLen);
    } else if (lt !== 105) {
      return `链路类型不支持：linkType=${lt}（本 op 只吃 radiotap(127) / 802.11(105) 的无线捕获）。`;
    }
    frames.push(fr);
  }
  if (frames.length === 0) return "（空捕获）未解析到 802.11 帧。";

  // 逐帧分类
  const eapolMsgs = [];
  const dataFrames = [];
  const others = { mgmt: 0, ctrl: 0, nondata: 0, tkip: 0, open: 0 };
  for (const fr of frames) {
    const df = parse80211(fr);
    if (!df || df.kind !== "data") { others.nondata++; continue; }
    if (!df.protectedBit) {
      const ek = parseEapolKey(df.body);
      if (ek && ek.msgNo) eapolMsgs.push({ ...ek, df });
      else others.open++;
    } else {
      dataFrames.push(df);
    }
  }
  if (eapolMsgs.length === 0 && dataFrames.length === 0) {
    return `未发现 EAPOL-Key 握手消息或受保护数据帧（802.11 帧 ${frames.length} 个，非数据帧 ${others.nondata}）。此捕获不含 WPA/WPA2 握手或加密数据。`;
  }

  const lines = [];
  const files = [];
  lines.push("=== WPA/WPA2-PSK 离线握手校验与 CCMP 解密（802.11i 单档）===");
  lines.push(`802.11 帧: ${frames.length}  EAPOL-Key 消息: ${eapolMsgs.length}  受保护数据帧: ${dataFrames.length}`);
  lines.push("");

  // ---- 握手解析 ----
  lines.push("--- 4 次握手 ---");
  if (eapolMsgs.length === 0) lines.push("(无 EAPOL-Key 消息)");
  let m1 = null, m2 = null, m4 = null;
  let replayIssue = null;
  let lastReplay = null;
  for (const m of eapolMsgs) {
    const dir = m.df.toDs ? "STA→AP" : "AP→STA";
    const ki = m.keyInfo;
    lines.push(`M${m.msgNo ?? "?"} ${dir} replay=0x${m.replay.map((x) => x.toString(16).padStart(2, "0")).join("")} ` +
      `ver=${m.ver} ${ki.pairwise ? "Pairwise" : "Group"}${ki.install ? " Install" : ""}${ki.ack ? " Ack" : ""}${ki.mic ? " MIC" : ""}${ki.secure ? " Secure" : ""}${ki.encryptedKd ? " EncKD" : ""} kdLen=${m.kdLen}`);
    const rv = parseInt(m.replay.map((x) => x.toString(16).padStart(2, "0")).join(""), 16);
    if (lastReplay !== null && rv < lastReplay) replayIssue = `重放计数器回退（0x${rv.toString(16)} < 0x${lastReplay.toString(16)}），按同 key 周期可疑`;
    lastReplay = rv;
    if (m.msgNo === 1) m1 = m;
    if (m.msgNo === 2) m2 = m;
    if (m.msgNo === 4) m4 = m;
  }
  if (replayIssue) lines.push("⚠ " + replayIssue);

  // ---- PSK 校验 ----
  let ptk = null;
  if (!ssid || !passphrase) {
    lines.push("");
    lines.push("口令校验：未提供 SSID/口令，跳过（PMK=PBKDF2(口令, SSID, 4096)；口令错则 MIC 不匹配，CCMP 不可解）。");
  } else if (!m1 && !m2) {
    lines.push("");
    lines.push("口令校验：未捕获 M1/M2（无法取 ANonce/SNonce），跳过。");
  } else {
    // M1(ANonce) + M2(SNonce) 缺 M1 时用 M3 的 nonce 亦可；本档取已捕获的消息
    const anonce = m1 ? m1.nonce : (eapolMsgs.find((m) => m.msgNo === 3) || {}).nonce;
    const snonce = m2 ? m2.nonce : null;
    if (!anonce || !snonce) {
      lines.push("");
      lines.push("口令校验：SNonce 缺失（无 M2），无法派生 PTK。");
    } else {
      const aa = m1 ? (m1.df.fromDs ? m1.df.addr2 : m1.df.addr1) : (m2.df.toDs ? m2.df.addr1 : m2.df.addr2);
      const spa = m2.df.toDs ? m2.df.addr2 : m2.df.addr1;
      const pmk = pbkdf2Sha1(new TextEncoder().encode(passphrase), new TextEncoder().encode(ssid), 4096, 32);
      ptk = wpaPtk(pmk, aa, spa, anonce, snonce);
      lines.push("");
      lines.push("--- 口令校验（PMK→PTK→MIC）---");
      lines.push(`PMK: ${toHex(pmk)}  SHA-256: ${sha256Hex(pmk)}`);
      lines.push(`PTK: ${toHex(ptk)}  SHA-256: ${sha256Hex(ptk)}`);
      const kck = ptk.subarray(0, 16);
      const kek = ptk.subarray(16, 32);
      const tk = ptk.subarray(32, 48);
      void kek;
      let micOkAny = false;
      for (const m of [m2, m4].filter(Boolean)) {
        const frame = m.frame;
        const zeroed = new Uint8Array(frame.length);
        zeroed.set(frame);
        // frame 起点即 EAPOL version 字节，MIC 位于 EAPOL 偏移 81..97（802.11-2012 §12.7.2）
        zeroed.fill(0, 81, 97);
        const calc = hmacSha1(kck, zeroed).subarray(0, 16);
        const ok = cmpBytes(calc, m.mic);
        if (ok) micOkAny = true;
        lines.push(`M${m.msgNo} MIC: ${ok ? "✓ 匹配（口令正确）" : "✗ 不匹配（口令错误或帧损坏）"}`);
      }
      if (!micOkAny) ptk = null; // 口令错：不用于解密，避免伪造输出

      // ---- CCMP 解密 ----
      lines.push("");
      lines.push("--- CCMP 数据帧解密（TK 派生自上述 PTK）---");
      if (dataFrames.length === 0) lines.push("(无受保护数据帧)");
      const ethFrames = [];
      let decOk = 0, decFail = 0, tkipCnt = 0;
      for (const df of dataFrames) {
        if (!ptk) { decFail += dataFrames.length; break; }
        const r = ccmpDecrypt(df, ptk.subarray(32, 48));
        if (r.tkip) { tkipCnt++; continue; }
        if (r.error) { decFail++; continue; }
        if (!r.ok) { decFail++; lines.push(`✗ PN=0x${r.pn} MIC 认证失败（跳过，不输出不可信明文）`); continue; }
        const eth = toEth(df, r.pt);
        if (!eth) { decFail++; continue; }
        ethFrames.push(eth);
        decOk++;
        lines.push(`✓ PN=0x${r.pn} ${df.fromDs ? "AP→STA(下行)" : "STA→AP(上行)"} ${fmtMac(eth, 0)} ← ${fmtMac(eth, 6)} eth=0x${((eth[12] << 8) | eth[13]).toString(16)} ${eth.length - 14}B  ASCII: ${asciiPreview(eth.subarray(14), 96)}`);
      }
      if (tkipCnt) lines.push(`✗ TKIP/WEP 帧 ${tkipCnt} 个：TKIP（RC4+Michael）不在本档，显式拒绝。`);
      if (decOk > 0) {
        const pcapBytes = buildEthernetPcap(ethFrames);
        lines.push(`解密 ${decOk} 帧${decFail ? `，认证失败 ${decFail} 帧` : ""} → 重建 Ethernet pcap（linktype 1，${pcapBytes.length} 字节），可直接接 pcapParse/TCP 重组等已有流量链。`);
        files.push({ name: "wpa_decrypted.pcap", mime: "application/octet-stream", bytes: pcapBytes });
      } else if (!ptk && dataFrames.length > 0) {
        lines.push("口令错误 ⇒ 无法派生 TK，CCMP 不解密（不做无据猜测）。");
      }
    }
  }
  return files.length ? { text: lines.join("\n"), files } : lines.join("\n");
}

register({
  id: "wpaDecrypt",
  family: "pcap",
  familyLabel: "wpa",
  cat: "forensic",
  name: "WPA2 握手校验/CCMP 解密",
  desc: "离线解析 radiotap/802.11：EAPOL 4 次握手（M1-M4/重放计数器）+ 已知 SSID/口令 PBKDF2→PTK→MIC 校验 + CCMP 数据帧认证解密并重建 Ethernet pcap 接现有流量链。TKIP 显式拒绝，不调网卡不注入，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "ssid", label: "SSID", type: "text", default: "", placeholder: "无线网络名（PMK 派生用）" },
    { sensitive: true, key: "passphrase", label: "口令（逐个验证，不无界爆破）", type: "password", default: "", placeholder: "已知口令" },
    { key: "decrypt", label: "CCMP 解密", type: "select", default: "auto", options: [
      { value: "auto", label: "口令正确即解密" }, { value: "on", label: "强制解密" }, { value: "off", label: "仅握手分析" },
    ] },
  ],
  run: wpaDecryptRun,
  acceptsBytes: true,
});
