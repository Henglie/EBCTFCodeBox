/*
 * falconOps.js — Falcon-512/1024 密钥生成与签名 op。
 *
 * 算法内核：falconKeygen.js（Berd/NTRU/公钥编码）与 falconSign.js（官方私钥、
 * ffSampling、签名编码）。本文件只做字节/参数/文本报告适配，不重复算法。
 * 随机：种子/nonce 缺省时由内核走 randSource.randomBytes；显式 seed 用于 KAT 复现。
 */
import { register } from "./registry.js";
import { falconKeygenCore, encodePublicKey } from "./falconKeygen.js";
import { encodePrivateKeyOfficial, falconSignCore } from "./falconSign.js";

const FALCON_L2 = { 9: "Falcon-512", 10: "Falcon-1024" };

function hexToBytes(s, name) {
  const v = String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
  if (v.length % 2 || !/^[0-9a-f]*$/.test(v)) throw new Error(`${name} 需为偶数长度 hex`);
  const out = new Uint8Array(v.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(v.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function bytesFrom(text, enc, name) {
  if (enc === "base64") {
    const v = String(text == null ? "" : text).replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(v) || v.length % 4) throw new Error(`${name} 不是合法 base64`);
    const bin = atob(v);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }
  return hexToBytes(text, name);
}
function messageBytes(text, mode) {
  return mode === "hex" ? hexToBytes(text, "消息") : new TextEncoder().encode(String(text ?? ""));
}

/** 取 acceptsBytes 真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}
function normLogn(v) {
  const n = Number(v);
  if (n !== 9 && n !== 10) throw new Error("Falcon 档位仅支持 512（logn=9）或 1024（logn=10）");
  return n;
}

register({
  id: "falconKeyGen", family: "falcon", familyLabel: "keygen",
  cat: "asym",
  name: "Falcon 密钥生成",
  desc: "Falcon/FN-DSA 密钥生成（规范 v1.2）：logn=9/10 → n=512/1024，采样 f,g，Berd 判界，解 NTRU 方程 f·G−g·F=q，输出公钥（0x09/0x0A + 14bit 系数流）与官方三段私钥（0x59/0x5A + trim_i8(f,g,F)）。纯 JS；1024 档通常 <2s。种子留空走统一随机源，固定 48B seed 可复现。",
  params: [
    { key: "logn", label: "参数档", type: "select", default: "9", options: [
      { value: "9", label: "Falcon-512（n=512，公钥 897B）" },
      { value: "10", label: "Falcon-1024（n=1024，公钥 1793B）" },
    ] },
    { sensitive: true, key: "seed", label: "种子（48B hex，可选）", type: "text", default: "", placeholder: "留空随机；固定种子用于复现/KAT" },
  ],
  run: (_text, p) => {
    const logn = normLogn(p && p.logn);
    const seedText = String((p && p.seed) || "").replace(/\s+/g, "");
    const seed = seedText ? hexToBytes(seedText, "种子") : undefined;
    if (seed && seed.length !== 48) throw new Error(`种子需恰好 48 字节（当前 ${seed.length}）`);
    const t0 = Date.now();
    const key = falconKeygenCore(logn, seed);
    const pk = encodePublicKey(key.h, logn);
    const sk = encodePrivateKeyOfficial(key);
    const ms = Date.now() - t0;
    const st = key.stats || {};
    const text = [
      "=== Falcon 密钥生成 ===",
      `参数档：${FALCON_L2[logn]}（n=${key.n}，q=12289）`,
      `采样：第 ${key.attempts} 次成功；coeff ${st.coeffPass ?? "?"} / norm ${st.normPass ?? "?"} / berd ${st.berdPass ?? "?"} / h ${st.hPass ?? "?"} / ntru ${st.ntruPass ?? "?"}`,
      `耗时：${ms} ms`,
      `种子：${bytesToHex(key.seed)}`,
      "",
      `公钥（hex，${pk.length}B）：${bytesToHex(pk)}`,
      `私钥（hex，${sk.length}B）：${bytesToHex(sk)}`,
      "",
      "⚠ 私钥是签名密钥，请本地保管；公钥交给「Falcon 验签」。",
    ].join("\n");
    return {
      text,
      files: [
        { name: `falcon-${key.n}-public.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(pk) + "\n") },
        { name: `falcon-${key.n}-private.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(sk) + "\n") },
      ],
    };
  },
});

register({
  id: "falconSign", family: "falcon", familyLabel: "sign",
  acceptsBytes: true,
  cat: "asym",
  name: "Falcon 签名",
  desc: "Falcon/FN-DSA 签名（规范 v1.2 算法 15）：输入消息与官方三段私钥（0x59/0x5A）或本工具四段私钥；SHAKE256 哈希到点，ffSampling 动态 LDL 取样，范数 ≤⌊β²⌋ 才输出。签名 = 0x39/0x3A ‖ nonce(40B) ‖ comp(s2)，直接交给「Falcon 验签」。nonce/种子留空走统一随机源；显式给出可复现 KAT。",
  params: [
    { sensitive: true, key: "privKey", label: "私钥（hex）", type: "textarea", default: "", placeholder: "0x59/0x5A 官方格式或本工具四段格式" },
    { key: "privEnc", label: "私钥编码", type: "select", default: "hex", options: [
      { value: "hex", label: "hex" },
      { value: "base64", label: "base64" },
    ] },
    { key: "nonce", label: "nonce（40B hex，可选）", type: "text", default: "", placeholder: "留空随机" },
    { key: "seed", label: "签名种子（48B hex，可选）", type: "text", default: "", placeholder: "留空随机；固定用于 KAT" },
  ],
  run: (text, p) => {
    if (p && p.msgMode != null && String(p.msgMode).toLowerCase() !== "text") {
      throw new Error("msgMode 该参数已废弃，请改用输入视图");
    }
    const privBytes = bytesFrom(p && p.privKey, (p && p.privEnc) === "base64" ? "base64" : "hex", "私钥");
    if (!privBytes.length) throw new Error("请填写 Falcon 私钥");
    const nonceText = String((p && p.nonce) || "").replace(/\s+/g, "");
    const seedText = String((p && p.seed) || "").replace(/\s+/g, "");
    const nonce = nonceText ? hexToBytes(nonceText, "nonce") : undefined;
    const seed = seedText ? hexToBytes(seedText, "种子") : undefined;
    if (nonce && nonce.length !== 40) throw new Error(`nonce 需恰好 40 字节（当前 ${nonce.length}）`);
    if (seed && seed.length !== 48) throw new Error(`种子需恰好 48 字节（当前 ${seed.length}）`);
    const raw = rawBytesOf(p);
    const msg = raw != null ? raw : messageBytes(text, "text");
    const t0 = Date.now();
    const r = falconSignCore(privBytes, msg, { nonce, seed });
    const ms = Date.now() - t0;
    const sigHex = bytesToHex(r.signature);
    return {
      text: [
        "=== Falcon 签名 ===",
        `参数档：${FALCON_L2[r.logn]}（n=${r.n}）`,
        `消息：${msg.length} 字节`,
        `范数：‖(s1,s2)‖² = ${r.norm.toLocaleString("en-US")} ≤ ⌊β²⌋ = ${r.beta2.toLocaleString("en-US")}`,
        `重采样：${r.attempts} 次；耗时：${ms} ms`,
        `nonce：${bytesToHex(r.nonce)}`,
        "",
        "签名（hex）：",
        sigHex,
        "",
        "把公钥、签名与原文交给「Falcon 验签」。",
      ].join("\n"),
      files: [{ name: `falcon-${r.n}.sig`, mime: "application/octet-stream", bytes: r.signature }],
    };
  },
});
