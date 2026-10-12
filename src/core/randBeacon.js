/*
 * randBeacon.js — 公开随机信标验证（drand / NIST Randomness Beacon）。
 *
 * 定位（务必读懂）：
 * - 本工具的价值**不是"更随机"**，而是**可公开验证、事后不可篡改**：给定一条已发布的信标记录，
 *   任何人都能用其**官方签名与链式结构**离线复算，证明它确由该信标发布、且发布后未被改动。
 *   适用于抽签、防操纵、教学演示等"事后可审计"的场景。
 * - 本工具**不是密钥随机源**，与密钥生成路径**完全隔离**：不参与、不影响任何 sk/seed 的产生。
 *   （NIST 官方原文：DO NOT USE BEACON GENERATED VALUES AS SECRET CRYPTOGRAPHIC KEYS.）
 * - **默认零网络请求**：加载与验证全程不发起任何网络请求；只有用户显式选择"拉取"并勾选
 *   "允许联网"后，才会向官方 endpoint 发起请求。
 *
 * 规范依据（URL、访问日期与许可见工程留存内「公开随机信标」一卡的规范来源清单）：
 * - drand（league of entropy，schemeID=pedersen-bls-chained）：
 *     msg        = SHA-256(previous_signature ‖ round_be8)   （chained；unchained 时去掉 previous_signature）
 *     signature  = BLS12-381(σ∈G2 96B, pk∈G1 48B)，DST = BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_
 *     randomness = SHA-256(signature)
 *   验签：e(σ, G1) == e(H(msg), pk)。BLS12-381 取 vendored @noble/curves@2.4.0（MIT）最小闭包，
 *   见 src/core/lib/noble/（文件头保留 MIT 署名；LICENSE.txt 原样保留）。
 * - NIST Randomness Beacon 2.0（cipherSuite=0）：
 *     sig_input  = 逐字段序列化（长度前缀 4B 大端；整数字段 cipherSuite/period/statusCode 4B，
 *                  chainIndex/pulseIndex 8B；hash 字段按其 hex 字节；字符串按 UTF-8 字节）
 *                  字段序：uri, version, cipherSuite, period, certificateId, chainIndex, pulseIndex,
 *                  timeStamp, localRandomValue, external.sourceId, external.statusCode, external.value,
 *                  listValues[](按序：previous/hour/day/month/year), precommitmentValue, statusCode
 *     signatureValue = RSA-PKCS#1 v1.5 / SHA-512 签名，签名对象为 sig_input（RSA-4096，512B）
 *     outputValue    = SHA-512(sig_input ‖ signatureValue)
 *   验签：用 certificateId 对应的 X.509 证书公钥做 RSA-PKCS#1 v1.5/SHA-512 验证。
 *   链：listValues[type=previous].value == 上一脉冲 outputValue。
 *
 * 契约：register({id, cat, name, desc, params, run})。run 为异步单向工具。
 * 失败一律 throw Error（显式带底层原因），成功返回多行报告字符串。
 *
 * core 层零 DOM 依赖：仅用 WebCrypto（crypto.subtle，Node/浏览器均可用）与 noble 纯计算；
 * 联网仅经 globalThis.fetch，且仅在用户显式开启后调用。
 */
import { register } from "./registry.js";
import { bls12_381 } from "./lib/noble/bls12-381.js";

// ---------- 官方 endpoint 与默认链公钥（仅作为默认值，用户可覆盖；不联网时仅用于离线验证） ----------
const DRAND_DEFAULT_ENDPOINT = "https://api.drand.sh";
const NIST_DEFAULT_ENDPOINT = "https://beacon.nist.gov/beacon/2.0";
// drand 主网（default 链，league of entropy）群公钥：GET https://api.drand.sh/info
// 2026-10-08 访问；schemeID=pedersen-bls-chained；48 字节压缩 G1。
const DRAND_MAINNET_PK =
  "868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31";
const DRAND_DST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_";

// ============================================================ 字节工具
function hexToBytes(hex) {
  const s = String(hex == null ? "" : hex).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(s)) throw new Error("非法 hex 字符串（含非十六进制字符）");
  if (s.length % 2 !== 0) throw new Error(`非法 hex 字符串（长度 ${s.length} 非偶数）`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
function beBytes(n, len) {
  const b = new Uint8Array(len);
  let v = BigInt(n);
  for (let i = len - 1; i >= 0; i--) {
    b[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  if (v !== 0n) throw new Error(`整数值 ${n} 超出 ${len} 字节`);
  return b;
}
const U32 = (n) => beBytes(n, 4);
const U64 = (n) => beBytes(n, 8);
const enc = new TextEncoder();

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("当前环境缺少 WebCrypto（crypto.subtle），无法做哈希/签名验证");
  return c.subtle;
}
async function digest(alg, bytes) {
  return new Uint8Array(await subtle().digest(alg, bytes));
}
const sha256 = (b) => digest("SHA-256", b);
const sha512 = (b) => digest("SHA-512", b);

// ============================================================ drand
/** 链式消息：msg = SHA-256(previous_signature ‖ round_be8)；unchained 时 msg = SHA-256(round_be8)。 */
async function drandMessage(round, prevSigBytes) {
  return prevSigBytes ? sha256(concatBytes(prevSigBytes, U64(round))) : sha256(U64(round));
}

/**
 * 验证一条 drand 记录。返回 { round }；失败 throw（带底层原因）。
 * rec: { round, randomness, signature, previous_signature? }
 */
async function verifyDrand(rec, pkHex, opts, out) {
  for (const k of ["round", "signature", "randomness"]) {
    if (rec[k] === undefined || rec[k] === null || rec[k] === "")
      throw new Error(`drand：记录缺少必需字段 ${k}（格式非法）`);
  }
  const round = Number(rec.round);
  if (!Number.isInteger(round) || round < 0) throw new Error(`drand：round 非法（${rec.round}）`);
  const pk = hexToBytes(pkHex);
  if (pk.length !== 48) throw new Error(`drand：链公钥应为 48 字节压缩 G1，实际 ${pk.length} 字节`);
  const sig = hexToBytes(rec.signature);
  if (sig.length !== 96) throw new Error(`drand：签名应为 96 字节压缩 G2，实际 ${sig.length} 字节`);
  const randomness = String(rec.randomness).toLowerCase();

  // ① randomness = SHA-256(signature)
  const rCalc = bytesToHex(await sha256(sig));
  if (rCalc !== randomness) {
    throw new Error(
      `drand：randomness 校验失败 —— SHA-256(signature)=${rCalc.slice(0, 16)}… ≠ 记录 randomness=${randomness.slice(0, 16)}…（随机值被篡改）`
    );
  }
  out.push("  1) randomness = SHA-256(signature)  ✓");

  // ② 链式消息 + BLS12-381 验签
  const prevHex = rec.previous_signature != null ? rec.previous_signature : opts.prevSig;
  const prev = prevHex ? hexToBytes(prevHex) : null;
  const msg = await drandMessage(round, prev);
  out.push(
    `  2) msg = SHA-256(${prev ? "previous_signature ‖ " : ""}round_be8) = ${bytesToHex(msg).slice(0, 16)}…`
  );
  let ok;
  try {
    ok = bls12_381.longSignatures.verify(sig, bls12_381.longSignatures.hash(msg), pk);
  } catch (e) {
    throw new Error(`drand：公钥/签名点解析失败（格式非法）：${e.message}`);
  }
  if (!ok) {
    throw new Error(
      `drand：BLS12-381 签名验证失败（round=${round}${prev ? " 与 previous_signature" : ""} 与 signature 不符，记录被篡改或非本链）`
    );
  }
  out.push(`  3) BLS12-381 验签 e(σ,G1)=e(H(msg),pk)  ✓  (DST ${DRAND_DST})`);
  return { round, prevSigHex: rec.signature };
}

// ============================================================ NIST Beacon 2.0
function pushStr(parts, s) {
  const b = enc.encode(String(s));
  parts.push(U32(b.length), b);
}
function pushHash(parts, hex) {
  const b = hexToBytes(hex);
  parts.push(U32(b.length), b);
}
/** 依 NIST.IR.8213 序列化签名字段序列（实测线上实现用 4B 长度前缀；见报告 §规范依据）。 */
function nistSerialize(p) {
  const parts = [];
  pushStr(parts, p.uri);
  pushStr(parts, p.version);
  parts.push(U32(p.cipherSuite));
  parts.push(U32(p.period));
  pushHash(parts, p.certificateId);
  parts.push(U64(p.chainIndex));
  parts.push(U64(p.pulseIndex));
  pushStr(parts, p.timeStamp);
  pushHash(parts, p.localRandomValue);
  if (p.external) {
    pushHash(parts, p.external.sourceId);
    parts.push(U32(p.external.statusCode));
    pushHash(parts, p.external.value);
  }
  for (const lv of p.listValues || []) pushHash(parts, lv.value);
  if (p.precommitmentValue != null) pushHash(parts, p.precommitmentValue);
  if (p.statusCode != null) parts.push(U32(p.statusCode));
  return concatBytes(...parts);
}

// ---- 极简 DER 读取（仅用于从 X.509 证书中取出 SubjectPublicKeyInfo） ----
function readTLV(buf, off) {
  if (off + 2 > buf.length) throw new Error("DER 越界");
  const tag = buf[off];
  let len = buf[off + 1];
  let lenBytes = 1;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER 长度字段非法");
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[off + 2 + i];
    lenBytes = 1 + n;
  }
  const contentStart = off + 1 + lenBytes;
  const end = contentStart + len;
  if (end > buf.length) throw new Error("DER 长度超出缓冲");
  return { start: off, tag, contentStart, end };
}
function extractSpki(der) {
  const cert = readTLV(der, 0); // Certificate SEQUENCE
  if (cert.tag !== 0x30) throw new Error("证书顶层不是 SEQUENCE");
  const tbs = readTLV(der, cert.contentStart); // TBSCertificate SEQUENCE
  if (tbs.tag !== 0x30) throw new Error("TBSCertificate 不是 SEQUENCE");
  let o = tbs.contentStart;
  let c = readTLV(der, o);
  if (c.tag === 0xa0) {
    o = c.end; // 跳过 [0] version
  }
  // 依次跳过 serialNumber, signature, issuer, validity, subject 共 5 个字段
  for (let i = 0; i < 5; i++) o = readTLV(der, o).end;
  const spkiStart = o;
  const spki = readTLV(der, o);
  if (spki.tag !== 0x30) throw new Error("SubjectPublicKeyInfo 不是 SEQUENCE");
  return der.slice(spkiStart, spki.end);
}
function pemToDer(pem) {
  const m = String(pem).match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END [A-Z0-9 ]+-----/);
  if (!m) throw new Error("PEM 格式非法：未找到 BEGIN/END 头");
  const label = m[1].trim();
  const b64 = m[2].replace(/\s+/g, "");
  let der;
  try {
    const bin = atob(b64);
    der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  } catch (e) {
    throw new Error("PEM base64 解码失败：" + e.message);
  }
  return { label, der };
}
/** 接受 X.509 证书 PEM 或 SPKI 公钥 PEM，返回 RSA PKCS#1 v1.5/SHA-512 验签公钥。 */
async function importNistKey(pem) {
  const { label, der } = pemToDer(pem);
  let spki;
  if (label === "CERTIFICATE") spki = extractSpki(der);
  else if (label === "PUBLIC KEY") spki = der;
  else throw new Error(`NIST：不支持的公钥 PEM 类型（${label}），请提供 CERTIFICATE 或 PUBLIC KEY`);
  try {
    return await subtle().importKey(
      "spki",
      spki,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" },
      false,
      ["verify"]
    );
  } catch (e) {
    throw new Error("NIST：导入 RSA 公钥失败（" + e.message + "）");
  }
}

/** 验证一条 NIST 脉冲。返回 { pulseIndex }；失败 throw。pulse 为 {pulse:{...}} 内层对象。 */
async function verifyNist(pulse, certPem, out) {
  const req = [
    "uri", "version", "cipherSuite", "period", "certificateId", "chainIndex",
    "pulseIndex", "timeStamp", "localRandomValue", "signatureValue", "outputValue",
  ];
  for (const k of req) {
    if (pulse[k] === undefined || pulse[k] === null)
      throw new Error(`NIST：脉冲缺少必需字段 ${k}（格式非法）`);
  }
  const sig = hexToBytes(pulse.signatureValue);
  const msg = nistSerialize(pulse);
  const outVal = String(pulse.outputValue).toLowerCase();

  // ① outputValue = SHA-512(sig_input ‖ signatureValue)
  const calc = bytesToHex(await sha512(concatBytes(msg, sig)));
  if (calc !== outVal) {
    throw new Error(
      `NIST：outputValue 哈希链校验失败 —— SHA-512(sig_input‖signatureValue)=${calc.slice(0, 16)}… ≠ outputValue=${outVal.slice(0, 16)}…（脉冲被篡改）`
    );
  }
  out.push("  1) outputValue = SHA-512(sig_input ‖ signatureValue)  ✓");

  // ② RSA 签名
  if (certPem && String(certPem).trim()) {
    const key = await importNistKey(certPem);
    let ok;
    try {
      ok = await subtle().verify("RSASSA-PKCS1-v1_5", key, sig, msg);
    } catch (e) {
      throw new Error("NIST：RSA 验签异常（" + e.message + "）");
    }
    if (!ok) throw new Error("NIST：RSA 签名验证失败（signatureValue 与脉冲字段不符，记录被篡改或公钥不匹配）");
    out.push("  2) RSA PKCS#1 v1.5 / SHA-512 验签  ✓");
  } else {
    out.push("  2) RSA 签名未验证（未提供证书/公钥 PEM）");
  }
  return { pulseIndex: pulse.pulseIndex, outputValue: pulse.outputValue };
}

// ============================================================ 记录规整 / 链校验
function unwrapPulse(obj) {
  // NIST 官方返回 {pulse:{...}}；也接受内层对象
  return obj && typeof obj === "object" && obj.pulse && typeof obj.pulse === "object" ? obj.pulse : obj;
}

function chainCheckDrand(recs) {
  for (let i = 1; i < recs.length; i++) {
    const prev = recs[i].previous_signature;
    const prevSig = recs[i - 1].signature;
    if (prev != null && prevSig != null && String(prev).toLowerCase() !== String(prevSig).toLowerCase()) {
      throw new Error(
        `drand：哈希链断裂 —— 第 ${recs[i].round} 轮 previous_signature=${String(prev).slice(0, 16)}… ≠ 第 ${recs[i - 1].round} 轮 signature=${String(prevSig).slice(0, 16)}…`
      );
    }
  }
}
function prevOfNist(pulse) {
  const lv = (pulse.listValues || []).find((x) => x && x.type === "previous");
  return lv ? lv.value : null;
}
function chainCheckNist(pulses) {
  for (let i = 1; i < pulses.length; i++) {
    const prev = prevOfNist(pulses[i]);
    const prevOut = pulses[i - 1].outputValue;
    if (prev != null && prevOut != null && String(prev).toLowerCase() !== String(prevOut).toLowerCase()) {
      throw new Error(
        `NIST：哈希链断裂 —— 脉冲 ${pulses[i].pulseIndex} 的 previous=${String(prev).slice(0, 16)}… ≠ 脉冲 ${pulses[i - 1].pulseIndex} 的 outputValue=${String(prevOut).slice(0, 16)}…`
      );
    }
  }
}

// ============================================================ 联网拉取（仅用户显式开启）
async function doFetch(provider, p, out) {
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== "function") throw new Error("当前环境不支持 fetch，无法联网拉取");
  if (provider === "drand") {
    const endpoint = (p.endpoint || "").trim() || DRAND_DEFAULT_ENDPOINT;
    const round = String(p.round || "").trim();
    if (!round) throw new Error("drand 拉取：请填写 round");
    const url = `${endpoint.replace(/\/$/, "")}/public/${encodeURIComponent(round)}`;
    out.push(`[联网] GET ${url}`);
    const resp = await fetchFn(url, { headers: { accept: "application/json" } });
    if (!resp.ok) throw new Error(`drand 拉取失败：HTTP ${resp.status} ${resp.statusText}`);
    const rec = await resp.json();
    out.push(`  已取回 round=${rec.round}`);
    const info = await verifyDrand(rec, p.pubkey || DRAND_MAINNET_PK, { prevSig: p.prev || null }, out);
    out.push(`结果：通过（已拉取并验证 drand round=${info.round}）`);
    return out.join("\n");
  }
  // NIST
  const endpoint = (p.endpoint || "").trim() || NIST_DEFAULT_ENDPOINT;
  const round = String(p.round || "").trim();
  const url = round
    ? `${endpoint.replace(/\/$/, "")}/chain/1/pulse/${encodeURIComponent(round)}`
    : `${endpoint.replace(/\/$/, "")}/pulse/last`;
  out.push(`[联网] GET ${url}`);
  const resp = await fetchFn(url, { headers: { accept: "application/json" } });
  if (!resp.ok) throw new Error(`NIST 拉取失败：HTTP ${resp.status} ${resp.statusText}`);
  const pulse = unwrapPulse(await resp.json());
  out.push(`  已取回 pulseIndex=${pulse.pulseIndex}`);
  let certPem = p.pubkey || "";
  if (!certPem) {
    const curl = `${endpoint.replace(/\/$/, "")}/certificate/${pulse.certificateId}`;
    out.push(`[联网] GET ${curl}`);
    const cr = await fetchFn(curl, { headers: { accept: "text/plain" } });
    if (!cr.ok) throw new Error(`NIST 证书拉取失败：HTTP ${cr.status} ${cr.statusText}`);
    certPem = await cr.text();
  }
  await verifyNist(pulse, certPem, out);
  out.push(`结果：通过（已拉取并验证 NIST pulseIndex=${pulse.pulseIndex}）`);
  return out.join("\n");
}

// ============================================================ op 注册
register({
  id: "randBeacon",
  cat: "radix",
  name: "公开随机信标验证",
  desc:
    "验证 drand / NIST 公开随机信标：用官方签名(BLS12-381 / RSA)与链式结构离线复算，证明记录真实且未被篡改。" +
    "价值在『可公开验证、事后不可篡改』，不是『更随机』；它不是密钥随机源，与密钥生成完全隔离。默认零网络请求，仅用户显式『拉取』才联网。",
  params: [
    { key: "provider", label: "信标来源", type: "select", default: "drand",
      options: [
        { value: "drand", label: "drand（league of entropy）" },
        { value: "nist", label: "NIST Randomness Beacon" },
      ] },
    { key: "action", label: "操作", type: "select", default: "verify",
      options: [
        { value: "verify", label: "验证（离线，默认）" },
        { value: "fetch", label: "拉取（联网，需显式允许）" },
      ] },
    { key: "pubkey", label: "链公钥 / 证书 PEM（留空用内置 drand 主网公钥）", type: "textarea", default: "",
      placeholder: "drand：48B G1 群公钥 hex；NIST：X.509 证书 PEM 或 SPKI 公钥 PEM（用于 RSA 验签）" },
    { key: "prev", label: "上一轮凭证（可选：drand previous_signature / NIST 上一脉冲 outputValue）", type: "text", default: "",
      placeholder: "留空则以记录内 previous_signature 为准" },
    { key: "endpoint", label: "拉取 endpoint（留空用官方默认）", type: "text", default: "",
      placeholder: "drand: https://api.drand.sh ；NIST: https://beacon.nist.gov/beacon/2.0" },
    { key: "round", label: "拉取 round / pulse 序号（拉取时必填）", type: "text", default: "",
      placeholder: "drand 例 100；NIST 例 1（留空=NIST last）" },
    { key: "allowNetwork", label: "允许联网拉取（默认关闭）", type: "bool", default: false },
  ],
  run: async (t, p = {}) => {
    const provider = p.provider || "drand";
    const action = p.action || "verify";
    const out = [];
    const head =
      provider === "drand"
        ? "[drand] 公开随机信标验证（pedersen-bls-chained）"
        : "[NIST] 公开随机信标验证（Beacon 2.0, cipherSuite=0）";
    out.push(head);

    if (action === "fetch") {
      if (!p.allowNetwork) {
        throw new Error(
          "默认不联网：本工具默认零网络请求。若确需拉取，请勾选『允许联网拉取』后再试（会向 endpoint 发起请求）。"
        );
      }
      return await doFetch(provider, p, out);
    }

    // ---- 离线验证 ----
    const raw = String(t == null ? "" : t).trim();
    if (!raw) throw new Error("请在主输入框粘贴信标记录 JSON（或改用『拉取』联网获取）");
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error("信标记录 JSON 解析失败：" + e.message);
    }

    if (provider === "drand") {
      const pk = p.pubkey || DRAND_MAINNET_PK;
      const list = Array.isArray(data) ? data : [data];
      if (!list.length) throw new Error("drand：输入为空数组");
      for (let i = 0; i < list.length; i++) {
        if (list.length > 1) out.push(`— 记录 ${i + 1}/${list.length} —`);
        await verifyDrand(list[i], pk, { prevSig: p.prev || null }, out);
      }
      if (list.length > 1) {
        chainCheckDrand(list);
        out.push(`  链式关系：${list.length} 轮 previous_signature 逐轮衔接  ✓`);
      } else if (p.prev) {
        const rec = list[0];
        if (rec.previous_signature != null &&
            String(rec.previous_signature).toLowerCase() !== String(p.prev).toLowerCase()) {
          throw new Error("drand：哈希链断裂 —— 记录 previous_signature ≠ 参数 prev");
        }
        out.push("  链式关系：previous_signature 与参数 prev 一致  ✓");
      }
      out.push(`结果：通过（${list.length} 条 drand 记录真实、完整、未被篡改）`);
      return out.join("\n");
    }

    // NIST
    const certPem = p.pubkey || "";
    const list = (Array.isArray(data) ? data : [data]).map(unwrapPulse);
    if (!list.length) throw new Error("NIST：输入为空数组");
    for (let i = 0; i < list.length; i++) {
      if (list.length > 1) out.push(`— 脉冲 ${i + 1}/${list.length} —`);
      await verifyNist(list[i], certPem, out);
    }
    if (list.length > 1) {
      chainCheckNist(list);
      out.push(`  链式关系：${list.length} 个脉冲 previous 逐脉冲衔接  ✓`);
    } else if (p.prev) {
      const prev = prevOfNist(list[0]);
      if (prev != null && String(prev).toLowerCase() !== String(p.prev).toLowerCase()) {
        throw new Error("NIST：哈希链断裂 —— 脉冲 previous ≠ 参数 prev");
      }
      out.push("  链式关系：previous 与参数 prev 一致  ✓");
    }
    if (!certPem) out.push("提示：未提供证书 PEM，本次仅完成哈希链校验（签名未验）。");
    out.push(`结果：通过（${list.length} 条 NIST 脉冲真实、完整、未被篡改）`);
    return out.join("\n");
  },
});

// 供 Node 直测/复跑使用（不参与 UI）
export { verifyDrand, verifyNist, nistSerialize, drandMessage, importNistKey, extractSpki, pemToDer };
