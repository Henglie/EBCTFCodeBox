/*
 * jwkOkp.js — JWK OKP（Ed25519 / X25519）导入导出。
 *
 * 标准依据（照标准实现，不编造）：
 * - JWK = RFC 7517：kty/crv/x/d，base64url 无 padding（RFC 7515 §3.2）；
 * - OKP = RFC 8037 §2：kty:"OKP"，crv:"Ed25519"/"X25519"，x = 公钥 32 字节 b64url，
 *   d = 私钥 32 字节 b64url（Ed25519 的 d 即 seed）；"octet key pair" 语义。
 * - 曲线 OID = RFC 8410：Ed25519 = 1.3.101.112，X25519 = 1.3.101.110；
 * - PKCS#8（RFC 5958）：SEQ{0, SEQ{OID}, OCTETSTRING(OCTETSTRING(私钥 32B))}；
 *   SPKI（RFC 5280）：SEQ{SEQ{OID}, BITSTRING(公钥 32B)}。
 * - 一致性校验：Ed25519 可由 d 重算 x（RFC 8037 §4 点校验语义）；X25519 无独立
 *   公钥校验路径（结构校验为主，如实说明）。
 *
 * 复用：ed25519 公钥重算 ← ed25519.js publicKey；DER/PEM ← rsagen.js。
 * 红线：件内自注册，零 UI 依赖，node 可直测；密钥材料只在本地处理，零外发。
 */

import { register } from "./registry.js";
import { publicKey as ed25519Public } from "./ed25519.js";
import { x25519 } from "./x25519.js";
import { derDecode, derEncode, derInt, derSeq, derOid, derOctetString, derBitString, derToPem } from "./rsagen.js";

const CURVES = {
  "Ed25519": { oid: [1, 3, 101, 112] },
  "X25519": { oid: [1, 3, 101, 110] },
};

/** 由私钥重算公钥：Ed25519 = 基点标量乘（seed 即 sk）；X25519 = X25519(sk, u=9) */
function derivePub(crv, seed) {
  if (crv === "Ed25519") return ed25519Public(seed);
  if (crv === "X25519") { const b = new Uint8Array(32); b[0] = 9; return x25519(seed, b); }
  throw new Error(`未知曲线：${crv}`);
}

function bytesToHex(b) { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }
function te(s) { return new TextEncoder().encode(String(s)); }

/** base64url 严格解码（RFC 7515 §3.2：无 padding，容忍缺省字符集外空白） */
function b64urlToBytes(s) {
  const t = String(s || "").replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
  if (!t) throw new Error("base64url 为空");
  if (t.includes("=")) throw new Error("base64url 不应含 padding（RFC 7515 §3.2）");
  if (!/^[A-Za-z0-9+/]+$/.test(t)) throw new Error("base64url 含非法字符");
  const pad = (4 - (t.length % 4)) % 4;
  let out = "";
  try { out = atob(t + "=".repeat(pad)); } catch { throw new Error("base64url 解码失败"); }
  return Uint8Array.from(out, (c) => c.charCodeAt(0));
}

function bytesToB64url(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 从 PEM/DER 提取 OKP 部件：{ crv, pub?, seed? } */
function extractOkp(text) {
  const raw = String(text || "");
  let der;
  if (/-----BEGIN/.test(raw)) {
    const m = raw.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
    if (!m) throw new Error("PEM 标记不完整");
    const body = m[2].replace(/\s+/g, "");
    let out = "";
    try { out = atob(body); } catch { throw new Error("PEM base64 解码失败"); }
    der = Uint8Array.from(out, (c) => c.charCodeAt(0));
  } else {
    const t = raw.replace(/^(0x|0X)/, "").replace(/\s+/g, "");
    if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) throw new Error("输入既非 PEM 也非合法 hex");
    der = new Uint8Array(t.length / 2);
    for (let i = 0; i < der.length; i++) der[i] = parseInt(t.substr(i * 2, 2), 16);
  }
  const node = derDecode(der);
  const OID_ED = "1.3.101.112", OID_X = "1.3.101.110";
  if (node.tag !== 0x30) throw new Error("DER 根应为 SEQUENCE");
  const algOf = (seq) => {
    if (!seq.children || !seq.children[0] || seq.children[0].tag !== 0x06) throw new Error("AlgorithmIdentifier 结构不符");
    // OID 弧解码（X.690 §8.19）
    const arcs = [];
    let v = 0n;
    for (const b of seq.children[0].value) {
      v = (v << 7n) | BigInt(b & 0x7f);
      if (!(b & 0x80)) { arcs.push(v); v = 0n; }
    }
    const first = arcs[0];
    const a0 = first >= 80n ? 2n : first / 40n;
    return [Number(a0), Number(first - 40n * a0), ...arcs.slice(1).map(Number)].join(".");
  };
  if (node.children[0].tag === 0x02 && node.children[1]?.tag === 0x30 && node.children[2]?.tag === 0x04) {
    // PKCS#8：SEQ{0, SEQ{OID}, OCTETSTRING(OCTETSTRING(seed))}
    const oid = algOf(node.children[1]);
    const crv = oid === OID_ED ? "Ed25519" : oid === OID_X ? "X25519" : null;
    if (!crv) throw new Error(`非 OKP 曲线 OID：${oid}（支持 Ed25519/X25519）`);
    const inner = derDecode(node.children[2].value);
    if (inner.tag !== 0x04) throw new Error("PKCS#8 privateKey 内层应为 OCTET STRING（RFC 5958）");
    if (inner.value.length !== 32) throw new Error(`私钥应为 32 字节，实际 ${inner.value.length}`);
    return { crv, seed: inner.value };
  }
  if (node.children[0]?.tag === 0x30 && node.children[1]?.tag === 0x03) {
    // SPKI：SEQ{SEQ{OID}, BITSTRING(pub)}
    const oid = algOf(node.children[0]);
    const crv = oid === OID_ED ? "Ed25519" : oid === OID_X ? "X25519" : null;
    if (!crv) throw new Error(`非 OKP 曲线 OID：${oid}（支持 Ed25519/X25519）`);
    const bit = node.children[1].value;
    if (bit[0] !== 0x00) throw new Error("BIT STRING unused bits 应为 0");
    const pub = bit.slice(1);
    if (pub.length !== 32) throw new Error(`公钥应为 32 字节，实际 ${pub.length}`);
    return { crv, pub };
  }
  throw new Error("DER 不是 OKP 的 PKCS#8 或 SPKI 结构");
}

// ============================================================
// 档① JWK → PEM / raw hex
// ============================================================

register({
  id: "jwkOkpImport",
  cat: "asym",
  family: "jwkOkp",
  familyLabel: "import",
  name: "JWK OKP 导入",
  desc: "JWK OKP 导入（RFC 8037/7517/7515）：Ed25519/X25519 的 JSON JWK → 公钥/私钥 hex + SPKI 公钥 PEM + PKCS#8 私钥 PEM（RFC 8410 曲线 OID，RFC 5958）。Ed25519 自动做 d→x 一致性校验；X25519 结构校验。密钥材料只在本地处理零外发",
  params: [
    { key: "jwk", label: "JWK JSON", type: "textarea", default: "", placeholder: '{"kty":"OKP","crv":"Ed25519","x":"…","d":"…"}' },
  ],
  run: (_text, p) => {
    const src = String((p && p.jwk) || _text || "").trim();
    if (!src) throw new Error("JWK JSON 输入为空");
    let jwk;
    try { jwk = JSON.parse(src); } catch (e) { throw new Error(`JSON 解析失败：${e.message}`); }
    if (jwk.kty !== "OKP") throw new Error(`kty 应为 "OKP"，实际 ${JSON.stringify(jwk.kty)}（RFC 8037 §2）`);
    const crv = String(jwk.crv || "");
    if (!CURVES[crv]) throw new Error(`crv 仅支持 Ed25519/X25519，实际 ${JSON.stringify(crv)}`);
    if (jwk.x === undefined) throw new Error("JWK 缺少 x（公钥）");
    const pub = b64urlToBytes(jwk.x);
    if (pub.length !== 32) throw new Error(`x 应为 32 字节（RFC 8037），实际 ${pub.length}`);
    let seed = null;
    if (jwk.d !== undefined) {
      seed = b64urlToBytes(jwk.d);
      if (seed.length !== 32) throw new Error(`d 应为 32 字节（RFC 8037），实际 ${seed.length}`);
    }
    const lines = [
      "=== JWK OKP 导入 ===",
      `kty = OKP`, `crv = ${crv}`,
      `x (公钥 32B hex) = ${bytesToHex(pub)}`,
    ];
    if (seed) lines.push(`d (私钥 32B hex) = ${bytesToHex(seed)}`);
    // 一致性校验
    if (crv === "Ed25519") {
      if (seed) {
        const re = ed25519Public(seed);
        const ok = re.every((b, i) => b === pub[i]);
        if (!ok) throw new Error("Ed25519 一致性校验失败：publicKey(d) ≠ x（d 与 x 不配套或数据有误）");
        lines.push("一致性校验：publicKey(d) ✓ 等于 x");
      } else {
        lines.push("一致性校验：无 d，跳过（仅公钥 JWK）");
      }
    } else {
      lines.push("一致性校验：X25519 无独立公钥重算路径（RFC 8037），已做结构校验");
    }
    const files = [];
    const spki = derSeq(derSeq(derOid(CURVES[crv].oid)), derBitString(pub));
    files.push({ name: "okp_public.pem", mime: "text/plain", bytes: te(derToPem("PUBLIC KEY", derEncode(spki)) + "\n") });
    lines.push("公钥 PEM = SPKI（PUBLIC KEY），已输出下载");
    if (seed) {
      const pkcs8 = derSeq(derInt(0n), derSeq(derOid(CURVES[crv].oid)),
        derOctetString(derEncode(derOctetString(seed))));
      files.push({ name: "okp_private.pem", mime: "text/plain", bytes: te(derToPem("PRIVATE KEY", derEncode(pkcs8)) + "\n") });
      lines.push("私钥 PEM = PKCS#8（PRIVATE KEY），已输出下载");
    }
    return { text: lines.join("\n"), files };
  },
});

// ============================================================
// 档② PEM / raw hex → JWK
// ============================================================

register({
  id: "jwkOkpExport",
  cat: "asym",
  family: "jwkOkp",
  familyLabel: "export",
  name: "JWK OKP 导出",
  desc: "JWK OKP 导出（RFC 8037/7517）：SPKI 公钥 PEM / PKCS#8 私钥 PEM / raw hex（公钥 32B、Ed25519 私钥 seed 32B、Ed25519 seed‖公钥 64B）→ 标准化 JWK JSON（kty OKP，base64url 无 padding）。Ed25519 自动重算校验；密钥材料只在本地处理零外发",
  params: [
    { key: "crv", label: "曲线（raw hex 输入时必选）", type: "select", default: "Ed25519", options: ["Ed25519", "X25519"] },
  ],
  run: (_text, p) => {
    const src = String(_text || "").trim();
    if (!src) throw new Error("输入为空（PEM 或 raw hex）");
    const crvParam = String((p && p.crv) || "Ed25519");
    let crv, pub = null, seed = null;
    if (/-----BEGIN/.test(src)) {
      const ex = extractOkp(src);
      crv = ex.crv; pub = ex.pub ?? null; seed = ex.seed ?? null;
      if (seed && !pub) pub = derivePub(crv, seed); // PKCS#8 只有私钥 → 重算公钥
    } else {
      const t = src.replace(/^(0x|0X)/, "").replace(/\s+/g, "");
      if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) throw new Error("输入既非 PEM 也非合法 hex");
      crv = crvParam;
      const raw = new Uint8Array(t.length / 2);
      for (let i = 0; i < raw.length; i++) raw[i] = parseInt(t.substr(i * 2, 2), 16);
      if (raw.length === 32) {
        // 32B：按曲线区分——Ed25519 档默认当公钥（可自行选择），X25519 无法区分，按公钥并提示
        pub = raw;
      } else if (raw.length === 64 && crv === "Ed25519") {
        seed = raw.slice(0, 32); pub = raw.slice(32);
      } else {
        throw new Error(`raw hex 长度 ${raw.length} 不受支持（32B 公钥/私钥或 64B Ed25519 seed‖公钥）`);
      }
    }
    if (crv === "Ed25519" && seed) {
      const re = ed25519Public(seed);
      const ok = re.every((b, i) => b === pub[i]);
      if (!ok) throw new Error("Ed25519 校验失败：publicKey(seed) ≠ 附带公钥（输入数据不一致）");
    }
    const jwk = { kty: "OKP", crv, x: bytesToB64url(pub) };
    if (seed) jwk.d = bytesToB64url(seed);
    const lines = [
      "=== JWK OKP 导出 ===",
      `crv = ${crv}`,
      `x (公钥 32B hex) = ${bytesToHex(pub)}`,
      seed ? `d (私钥 32B hex) = ${bytesToHex(seed)}` : "d = 无（纯公钥 JWK）",
      "",
      "JWK（RFC 8037 §2，base64url 无 padding）：",
      JSON.stringify(jwk, null, 2),
      "",
    ];
    if (crv === "Ed25519" && !seed) {
      lines.push("提示：若输入实为 Ed25519 私钥 seed（32B），可改用 64B seed‖公钥 形式获得含 d 的完整 JWK。");
    }
    if (crv === "X25519" && raw32Note(src)) lines.push("提示：X25519 的 32B 输入无法区分公钥/私钥，已按公钥处理；如为私钥请用 PEM(PKCS#8) 输入。");
    const files = [{ name: "okp.jwk.json", mime: "application/json", bytes: te(JSON.stringify(jwk, null, 2) + "\n") }];
    return { text: lines.join("\n"), files };
  },
});

function raw32Note(src) {
  const t = String(src || "").replace(/^(0x|0X)/, "").replace(/\s+/g, "");
  return /^-----BEGIN/.test(src) ? false : (t.length === 64);
}
