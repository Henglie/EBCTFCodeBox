/*
 * falconVerify.js — Falcon（NIST FN-DSA 的前身）格签名：公钥解析与验签（仅验签方向）。
 *
 * 依据（常量与算法逐词对照，来源 URL 与访问日期见证据目录 SOURCES.md）：
 *   - 规范：Falcon Specification v1.2（2020-10-01）：
 *       §2.6/表 3.3  q = 12289；n = 512/1024；σ = 165.736617183 / 168.388571447；
 *                    ⌊β²⌋ = 34 034 726（Falcon-512）/ 70 265 242（Falcon-1024）；
 *                    公钥 897/1793 字节；签名 sbytelen 666/1280。
 *       §3.7  算法 3 HashToPoint：SHAKE-256，每 16 bit 大端采样，t < k·q（k=⌊2¹⁶/q⌋=5，
 *             即 t < 61445）才接受，c_i = t mod q。
 *       §3.10 算法 16 Verify：c ← HashToPoint(r‖m)；s2 ← Decompress(s)；s1 = c − s2·h mod q
 *             （逐系数归一到 [⌈−q/2⌉, ⌊q/2⌋]）；接受当且仅当 ‖(s1, s2)‖² ≤ ⌊β²⌋。
 *       §3.11.2/算法 17/18 高斯系数压缩：每系数 = 符号位 ‖ 低 7 位（高位在前）‖ 高位的
 *             一元编码（k 个 0 后接 1，k = |s_i|>>7）；Decompress 三项唯一性检查：
 *             定长、系数 0 的符号位必须为 0（禁「−0」）、末尾剩余位必须为 0。
 *       §3.11.3 签名头字节 0 c c 1 n n n n（cc=01 压缩 / 10 为 12bit 定长未压缩 CT 格式，
 *             −2048 禁用）；头后为 40 字节 nonce r，再接系数流；位序为 MSB-first。
 *       §3.11.4 公钥头字节 0 0 0 0 n n n n，随后每系数 14 bit 大端位流拼接。
 *   - 官方参考实现交叉核对：NIST Round-3 提交包 Reference_Implementation/.../{nist.c,
 *     vrfy.c,codec.c,common.c}（pk 头 0x00+logn、esig 头 0x30+logn、CT 0x50+logn、
 *     NIST API sm = [2 字节大端长度]‖nonce‖msg‖esig、esig 头 0x20+logn、
 *     hash_to_point 接受阈 61445、l2bound[9]=34034726 / l2bound[10]=70265242（含等号））
 *     与 Extra/c/falcon.c（PADDED 666/1280、CT 809/1577、尾部零字节容忍）。
 *
 * 支持的签名封装（自动识别）：
 *   ① 规范/falcon.c 格式：[0x30+logn 或 0x50+logn] + nonce(40) + 系数流；
 *      压缩流末尾未用位必须为 0，其后的整字节必须全为 0（PADDED 即补零到 666/1280）；
 *      未补零（unpadded，较短）同样接受。
 *   ② NIST API signed-message（KAT / PQClean 风格）：[2 字节大端 sig_len] + nonce(40) +
 *      msg + esig（esig 头 0x20+logn，系数流须恰好耗尽）；此格式消息取自 blob 内嵌，
 *      若另输入了不一致的消息则显式报错。
 *
 * 多项式乘法：负循环卷积（mod x^n+1, q）用学校卷积 O(n²)（n=1024 约 1.05e6 次乘加，
 * 中间值 < 2^53 双精度安全域内，无 NTT 依赖）；验签只做一次乘法，性能实测见证据报告。
 *
 * 红线：纯本地计算，零 UI/DOM/外发；验签为确定性计算，不取随机字节。
 */

import { register } from "./registry.js";
import { keccak } from "./hash.js";

const Q = 12289;
// k = ⌊2^16/q⌋ = 5；k·q = 61445（HashToPoint 16 bit 采样的接受上界，spec 算法 3 第 7 行）
const KQ = 61445;
const HALF_Q = (Q - 1) >> 1; // 6144：居中后系数范围 [-6144, 6144]

// 表 3.3 推荐参数（仅本工具支持的两档；σ 仅用于展示，验签数学只用 ⌊β²⌋）
// compMax = 参考 falcon.h FALCON_SIG_COMPRESSED_MAXSIZE(logn)：
//   logn=9 → ((11·512 + (101>>1)) + 7 >> 3) + 41 = 752；logn=10 → ((11·1024 + 101) + 7 >> 3) + 41 = 1462。
// 说明：规范算法 16/18 把压缩流定长在 sbytelen（666/1280，流 625/1239 字节），但官方 C 参考实现
// （Round-3 nist.c/comp_decode 与 Extra/c/falcon.c 自动档）不做该定长检查，官方 KAT 的
// Falcon-1024 #82 即含 1240 字节流（超规范 slen 1 字节）——严格按规范 slen 的验签器会拒绝
// 官方 C 参考实现自己产出的这条向量。本工具按 C 参考口径收流（上限 compMax），分歧在证据报告记录。
const PARAMS = {
  9: { n: 512, sigma: 165.736617183, beta2: 34034726, sbytelen: 666, pkLen: 897, ctLen: 809, compMax: 752 },
  10: { n: 1024, sigma: 168.388571447, beta2: 70265242, sbytelen: 1280, pkLen: 1793, ctLen: 1577, compMax: 1462 },
};

function fmtErr(msg) {
  return new Error(`Falcon 格式错误：${msg}`);
}

function hex2(v) {
  return v.toString(16).padStart(2, "0").toUpperCase();
}

function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// hex（容忍空白/0x 前缀/冒号分隔）或 base64 → 字节
function bytesFromInput(str, enc, label) {
  const s = String(str == null ? "" : str).trim();
  if (!s) return new Uint8Array(0);
  if (enc === "base64") {
    const norm = s.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(norm) || norm.length % 4 === 1) {
      throw fmtErr(`${label} base64 非法`);
    }
    const bin = atob(norm);
    return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
  }
  const hex = s.replace(/^0x/i, "").replace(/[\s:]+/g, "");
  if (!hex || hex.length % 2 || /[^0-9a-fA-F]/.test(hex)) {
    throw fmtErr(`${label} hex 非法：须为偶数个 hex 字符`);
  }
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.substr(i * 2, 2), 16));
}

function concatBytes(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// SHAKE256（FIPS 202；海绵复用 hash.js 的 Keccak-f[1600]，rate 136、域填充 0x1f）
function shake256(msg, outLen) {
  return keccak(136, 0x1f, msg, outLen);
}

// spec 算法 3 HashToPoint：SHAKE256 逐 16 bit 大端采样，t < k·q 才接受，c_i = t mod q
function hashToPoint(nonce, msg, n) {
  const input = concatBytes(nonce, msg);
  let outLen = 2 * n + 64;
  for (;;) {
    const h = shake256(input, outLen);
    const c = new Array(n);
    let i = 0;
    let pos = 0;
    let ok = true;
    while (i < n) {
      if (pos + 2 > h.length) {
        ok = false;
        break;
      }
      const w = (h[pos] << 8) | h[pos + 1];
      pos += 2;
      if (w < KQ) c[i++] = w % Q; // 隐式拒绝采样（t ≥ 61445 的 16bit 值丢弃）
    }
    if (ok) return c;
    outLen *= 2; // 理论上几乎不可达（接受率 ≈ 0.9376），保险起见扩长度重散
  }
}

// 规范 §3.11.4 / 参考 codec.c modq_decode：14 bit MSB-first 位流 → 系数（须 < q，尾位 0）
function modqDecode(bytes, n, base) {
  const c = new Array(n);
  let acc = 0;
  let accLen = 0;
  let pos = 0;
  let u = 0;
  while (u < n) {
    acc = (acc << 8) | bytes[pos++];
    accLen += 8;
    if (accLen >= 14) {
      accLen -= 14;
      const w = (acc >> accLen) & 0x3fff;
      if (w >= Q) {
        throw fmtErr(`公钥第 ${u} 个系数值 ${w} ≥ q=${Q}（14 bit 系数流非法）`);
      }
      c[u++] = w;
    }
  }
  if ((acc & ((1 << accLen) - 1)) !== 0) {
    throw fmtErr(`公钥末字节 ${base ? "（去掉头字节后）" : ""}低位填充位非零`);
  }
  return c;
}

// 解析公钥（含头字节与长度校验）；返回 { logn, P, h }
export function parsePublicKey(pkBytes) {
  if (!pkBytes.length) throw fmtErr("公钥为空");
  if ((pkBytes[0] & 0xf0) !== 0) {
    throw fmtErr(
      `公钥头字节 0x${hex2(pkBytes[0])} 不符（规范 §3.11.4：0000 nnnn，Falcon-512 → 0x09 / Falcon-1024 → 0x0A）`
    );
  }
  const logn = pkBytes[0] & 0x0f;
  if (logn !== 9 && logn !== 10) {
    throw fmtErr(`公钥档位 n = 2^${logn} 不在支持范围（本工具仅 Falcon-512 / Falcon-1024）`);
  }
  const P = PARAMS[logn];
  if (pkBytes.length !== P.pkLen) {
    throw fmtErr(`公钥长度 ${pkBytes.length} 字节 ≠ 头 1 字节 + ⌈14·${P.n}/8⌉ = ${P.pkLen} 字节`);
  }
  const h = modqDecode(pkBytes.subarray(1), P.n, 1);
  return { logn, P, h };
}

// 压缩系数流解码（spec 算法 18 + 参考 codec.c comp_decode）。
// exactEnd = true（NIST 格式）：字节流须被恰好耗尽；false（spec 格式）：剩余整字节须全为 0。
function decodeCompressed(stream, n, exactEnd) {
  const s = new Array(n);
  let acc = 0;
  let accLen = 0;
  let pos = 0;
  for (let u = 0; u < n; u++) {
    // 取 8 bit：符号位 + |s_i| 低 7 位
    while (accLen < 8) {
      if (pos >= stream.length) {
        throw fmtErr(`压缩系数流越界：解码第 ${u} 个系数时字节不足（流长度 ${stream.length}）`);
      }
      acc = (acc << 8) | stream[pos++];
      accLen += 8;
    }
    accLen -= 8;
    const b = (acc >> accLen) & 0xff;
    const sign = b & 128;
    let m = b & 127;
    // 一元编码：读到位 1 为止，每个 0 使高位段 +128
    for (;;) {
      if (accLen === 0) {
        if (pos >= stream.length) {
          throw fmtErr(`压缩系数流越界：第 ${u} 个系数的高位一元段无终结 1 位`);
        }
        acc = (acc << 8) | stream[pos++];
        accLen = 8;
      }
      accLen--;
      if (((acc >> accLen) & 1) !== 0) break;
      m += 128;
      if (m > 2047) {
        throw fmtErr(`压缩系数流非法：第 ${u} 个系数绝对值超过 12 位上限 2047`);
      }
    }
    if (sign !== 0 && m === 0) {
      throw fmtErr(`压缩系数流非法：第 ${u} 个系数是「−0」（规范禁止，唯一编码要求）`);
    }
    s[u] = sign ? -m : m;
  }
  // 末字节未用的低位必须为 0（Decompress 校验 3）
  if ((acc & ((1 << accLen) - 1)) !== 0) {
    throw fmtErr("压缩系数流非法：末字节未用的低位非零（尾部位必须为 0）");
  }
  if (exactEnd) {
    if (pos !== stream.length) {
      throw fmtErr(`压缩系数流长度不符：解码用去 ${pos} 字节，流共 ${stream.length} 字节（NIST 格式要求恰好耗尽）`);
    }
  } else {
    for (let i = pos; i < stream.length; i++) {
      if (stream[i] !== 0) {
        throw fmtErr(`压缩系数流后存在非零多余字节（偏移 ${i}；补零填充才允许尾随字节）`);
      }
    }
  }
  return { s, consumed: pos };
}

// CT（未压缩）格式：每系数恒定 12 bit 大端二进制补码，−2048 禁用（spec §3.11.3）
function decodeCt(stream, n) {
  const byteLen = (12 * n) >> 3;
  if (stream.length !== byteLen) {
    throw fmtErr(`CT（未压缩）系数流长度须为 12·n/8 = ${byteLen} 字节，实际 ${stream.length}`);
  }
  const s = new Array(n);
  let acc = 0;
  let accLen = 0;
  let pos = 0;
  for (let u = 0; u < n; u++) {
    while (accLen < 12) {
      acc = (acc << 8) | stream[pos++];
      accLen += 8;
    }
    accLen -= 12;
    let v = (acc >> accLen) & 0xfff;
    if (v >= 2048) v -= 4096;
    if (v === -2048) {
      throw fmtErr(`CT 格式非法：第 ${u} 个系数为 −2048（有效范围 −2047..+2047）`);
    }
    s[u] = v;
  }
  return s;
}

// 负循环卷积 (a·b) mod (x^n+1, q)，学校卷积 O(n²)；中间累加 < 2^53（双精度安全）
function mulNegacyclicModQ(a, b, n) {
  const out = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; j < n; j++) {
      const t = ai * b[j];
      const idx = i + j;
      if (idx >= n) out[idx - n] -= t;
      else out[idx] += t;
    }
  }
  for (let u = 0; u < n; u++) out[u] = ((out[u] % Q) + Q) % Q;
  return out;
}

function normSq(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return s;
}

// 验签核心（spec 算法 16）。msgBytes：用于哈希的消息字节；
// explicitMsgBytes：调用方显式给出的消息（NIST 内嵌消息与其不一致时报错），可为 null。
// 返回结构化结果；格式问题抛「Falcon 格式错误」，验证不通过返回 valid=false。
export function falconVerifyCore(pkBytes, sigBytes, msgBytes, explicitMsgBytes) {
  const pk = parsePublicKey(pkBytes);
  const { logn, P, h } = pk;
  const n = P.n;

  if (!sigBytes || sigBytes.length < 42) {
    throw fmtErr(`签名长度 ${sigBytes ? sigBytes.length : 0} 字节不足（最少 头 1 + nonce 40 + 系数流 ≥ 1 = 42）`);
  }
  const b0 = sigBytes[0];
  let format = null; // "spec" | "nist"
  let nonce = null;
  let stream = null;
  let ct = false;
  let msgUsed = msgBytes;
  let msgFromBlob = false;
  let padded = false;

  if (((b0 & 0xf0) === 0x30 || (b0 & 0xf0) === 0x50) && (b0 & 0x0f) === logn) {
    // ① 规范 / falcon.c 格式
    format = "spec";
    ct = (b0 & 0xf0) === 0x50;
    nonce = sigBytes.subarray(1, 41);
    stream = sigBytes.subarray(41);
    // CT（未压缩）定长档先判——其合法长度（809/1577）超过压缩档上限，顺序颠倒会误杀官方 CT 向量
    if (ct) {
      if (sigBytes.length !== P.ctLen) {
        throw fmtErr(`CT（未压缩）签名长度须恒为 1+40+12·n/8 = ${P.ctLen} 字节，实际 ${sigBytes.length}`);
      }
    } else if (sigBytes.length > P.compMax) {
      throw fmtErr(
        `签名长度 ${sigBytes.length} 超过压缩格式上限 ${P.compMax} 字节（参考实现 COMPRESSED_MAXSIZE；规范补零档为 ${P.sbytelen}）`
      );
    }
    padded = !ct && sigBytes.length === P.sbytelen;
  } else if (sigBytes.length > 43) {
    // ② NIST API signed-message：[2 字节大端 sig_len] + nonce(40) + msg + esig
    const sigLen = (sigBytes[0] << 8) | sigBytes[1];
    const esigOff = sigBytes.length - sigLen;
    const esig = sigBytes.subarray(esigOff);
    if (
      sigLen >= 42 &&
      sigLen <= P.compMax - 40 &&
      esigOff >= 42 &&
      (esig[0] & 0xf0) === 0x20 &&
      (esig[0] & 0x0f) === logn
    ) {
      format = "nist";
      nonce = sigBytes.subarray(2, 42);
      msgUsed = sigBytes.subarray(42, esigOff);
      msgFromBlob = true;
      stream = esig.subarray(1);
      if (
        explicitMsgBytes &&
        (explicitMsgBytes.length !== msgUsed.length ||
          !explicitMsgBytes.every((v, i) => v === msgUsed[i]))
      ) {
        throw fmtErr(
          "NIST API signed-message 内嵌消息与输入消息不一致（该格式消息取自 blob 自身，请核对输入）"
        );
      }
    }
  }
  if (format === null) {
    throw fmtErr(
      `签名头字节 0x${hex2(b0)} 无法识别（规范格式应为 0x${hex2(0x30 + logn)}/0x${hex2(
        0x50 + logn
      )} 且低 4 位与公钥档位一致；NIST API 格式前两字节应为长度且 esig 头 0x${hex2(0x20 + logn)}）`
    );
  }

  // 解码 s2
  let s2;
  if (ct) {
    s2 = decodeCt(stream, n);
  } else {
    s2 = decodeCompressed(stream, n, format === "nist").s;
  }

  // spec 算法 16：c ← HashToPoint(r‖m)；s1 = c − s2·h mod (x^n+1, q) 居中；范数判界
  const c0 = hashToPoint(nonce, msgUsed, n);
  const s2h = mulNegacyclicModQ(s2, h, n);
  const s1 = new Array(n);
  for (let u = 0; u < n; u++) {
    let w = (c0[u] - s2h[u]) % Q;
    if (w < 0) w += Q;
    if (w > HALF_Q) w -= Q; // 居中到 [-6144, 6144]
    s1[u] = w;
  }
  const sqn = normSq(s1) + normSq(s2);
  const valid = sqn <= P.beta2; // 含等号（参考 common.c is_short：s <= l2bound[logn]）

  let s2min = 0;
  let s2max = 0;
  for (let u = 0; u < n; u++) {
    if (s2[u] < s2min) s2min = s2[u];
    if (s2[u] > s2max) s2max = s2[u];
  }
  return {
    valid,
    sqn,
    beta2: P.beta2,
    logn,
    n,
    format,
    ct,
    padded,
    nonceHex: toHex(nonce),
    s2min,
    s2max,
    msgUsedHex: toHex(msgUsed),
    msgFromBlob,
  };
}

// ============ op 注册 ============

register({
  id: "falconPkParse",
  cat: "asym",
  name: "Falcon 公钥解析",
  desc: "解析 Falcon/FN-DSA 公钥（规范 v1.2 §3.11.4：头字节 0000nnnn + n×14bit 大端系数流，q=12289）：档位、长度、系数统计与合法性逐项报告。支持 Falcon-512（897 字节）与 Falcon-1024（1793 字节），hex 或 base64 输入",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "hex" },
      { value: "base64", label: "base64" },
    ] },
  ],
  run: (t, p) => {
    const enc = (p && p.inputEnc) === "base64" ? "base64" : "hex";
    const raw = p && p.rawBytes;
    const pkBytes = raw || bytesFromInput(t, enc, "公钥");
    const pk = parsePublicKey(pkBytes);
    const { logn, P, h } = pk;
    let min = Q;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < P.n; i++) {
      if (h[i] < min) min = h[i];
      if (h[i] > max) max = h[i];
      sum += h[i];
    }
    const lines = [
      "=== Falcon 公钥解析 ===",
      `结果：格式有效（Falcon-${P.n}）`,
      `头字节：0x${hex2(pkBytes[0])}（0000 ${logn.toString(2).padStart(4, "0")}，n = 2^${logn} = ${P.n}）`,
      `长度：${pkBytes.length} 字节 = 头 1 + 系数 ${P.pkLen - 1}（${P.n} 系数 × 14 bit，MSB-first 位流，⌈14·${P.n}/8⌉ = ${P.pkLen - 1}）`,
      `系数：${P.n} 个，全部 < q = ${Q} ✓；范围 [${min}, ${max}]，均值 ${(sum / P.n).toFixed(1)}（均匀分布期望 ≈ ${Q / 2}）`,
      `前 8 个系数（十进制）：${h.slice(0, 8).join(", ")}`,
      `多项式 h（hex，前 32 字节重打）：${toHex(Uint8Array.from(h.slice(0, 18).flatMap((v) => [v >> 8, v & 255])))} …`,
      "",
      `说明：公钥即 h = g/f mod (x^${P.n}+1, ${Q})（NTRU 格式）；验签用配套「Falcon 验签」op。`,
    ];
    return lines.join("\n");
  },
});

register({
  id: "falconVerify",
  cat: "asym",
  name: "Falcon 验签",
  desc: "Falcon/FN-DSA 格签名验证（规范 v1.2 算法 16）：c = SHAKE256(nonce‖消息) 哈希到点（16bit 大端采样、t<61445 接受）；s1 = c − s2·h mod (x^n+1, 12289) 居中；‖(s1,s2)‖² ≤ ⌊β²⌋（512 档 34034726 / 1024 档 70265242）则有效。自动识别规范格式（0x39/0x3A 压缩、0x59/0x5A CT）与 NIST API signed-message（KAT/PQClean 风格）；格式错与签名错分列报出",
  params: [
    { key: "publicKey", label: "公钥（hex/base64）", type: "text", default: "", placeholder: "Falcon 公钥字节（897/1793 字节，头 0x09/0x0A）" },
    { key: "signature", label: "签名（hex/base64）", type: "text", default: "", placeholder: "规范格式（0x39/0x3A + nonce40 + 系数流）或 NIST API signed-message" },
    { key: "inputEnc", label: "公钥/签名编码", type: "select", default: "hex", options: [
      { value: "hex", label: "hex" },
      { value: "base64", label: "base64" },
    ] },
    { key: "msgEnc", label: "消息编码", type: "select", default: "text", options: [
      { value: "text", label: "text（UTF-8）" },
      { value: "hex", label: "hex（原始字节）" },
    ] },
  ],
  run: (t, p) => {
    const enc = (p && p.inputEnc) === "base64" ? "base64" : "hex";
    const rawBytes = p && p.rawBytes;
    const pkBytes = bytesFromInput(p && p.publicKey, enc, "公钥");
    const sigBytes = bytesFromInput(p && p.signature, enc, "签名");
    const msgEnc = (p && p.msgEnc) === "hex" ? "hex" : "text";
    let msgBytes;
    if (msgEnc === "hex") {
      msgBytes = bytesFromInput(t, "hex", "消息");
    } else if (rawBytes) {
      msgBytes = rawBytes;
    } else {
      msgBytes = new TextEncoder().encode(String(t ?? ""));
    }
    // 空消息视为「未提供」（NIST 格式下消息取自 blob；提供了非空消息且不一致才报错）
    const r = falconVerifyCore(pkBytes, sigBytes, msgBytes, msgBytes.length ? msgBytes : null);
    const P = PARAMS[r.logn];
    const fmtName = r.format === "nist"
      ? "NIST API signed-message（KAT/PQClean 风格，消息取自 blob 内嵌）"
      : `规范格式 ${r.ct ? "CT/未压缩（0x" + hex2(0x50 + r.logn) + "）" : "压缩（0x" + hex2(0x30 + r.logn) + "）"}${r.padded ? "，补零到 sbytelen" : ""}`;
    const lines = [
      `=== Falcon 验签 ===`,
      `验证结果：${r.valid ? "有效 ✓" : "无效 ✗（签名错）"}`,
      `参数档：Falcon-${r.n}（q = ${Q}，⌊β²⌋ = ${P.beta2}）`,
      `签名封装：${fmtName}`,
      `nonce（40 字节）：${r.nonceHex}`,
      `解码系数：${r.n} 个，s2 范围 [${r.s2min}, ${r.s2max}]`,
      `消息（${r.msgUsedHex.length / 2} 字节）：${r.msgUsedHex.length > 96 ? r.msgUsedHex.slice(0, 96) + "…" : r.msgUsedHex}`,
      "",
      `验签方程（算法 16）：c = HashToPoint(nonce‖msg)；s1 = c − s2·h mod (x^${r.n}+1, ${Q})，居中 [-${HALF_Q}, ${HALF_Q}]`,
      `范数：‖(s1, s2)‖² = ${r.sqn.toLocaleString("en-US")} ${r.valid ? "≤" : ">"} ⌊β²⌋ = ${P.beta2.toLocaleString("en-US")} → ${r.valid ? "接受" : "拒绝"}`,
    ];
    if (!r.valid) {
      lines.push(
        "",
        r.sqn > P.beta2
          ? "失败类别：签名错（范数超界）——公钥/消息/签名三者不匹配，或签名被篡改。"
          : "失败类别：签名错。"
      );
    }
    return lines.join("\n");
  },
});
