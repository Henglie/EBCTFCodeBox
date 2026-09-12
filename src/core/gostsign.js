/*
 * gostsign.js — GOST R 34.10-2012 数字签名（RFC 7091，256/512 位两参数集）。
 *
 * 算法（RFC 7091 §6.1 Algorithm I，哈希用 Streebog GOST R 34.11-2012 / RFC 6986）：
 * - 曲线 y² = x³ + a·x + b (mod p)，基点 P 阶 q（素数），公钥 Q = d·P（§5.2，注意是正号）
 * - e = α mod q（α = Streebog(M) 按大端解释的整数；e = 0 时置 1）
 * - 随机 k ∈ (0, q)：r = x(kP) mod q；s = (r·d + k·e) mod q
 * - 签名 ζ = R || S（RFC 7091 §6.1 Step 6：R 在前 S 在后，各大端 32/64 字节）
 *   ⚠ pygost 等实现输出 s||r（两半互换），互通时注意顺序
 * - 验签（§6.2 Algorithm II）：v = e⁻¹ mod q；z1 = s·v mod q；z2 = −r·v mod q；
 *   C = z1·P + z2·Q；R = x(C) mod q；R = r 即有效
 * - 256 位参数集 → Streebog-256；512 位参数集 → Streebog-512（§5.2 约束 l 与 q 位数匹配）
 *
 * 参数集（hex）：
 * - 256：id-GostR3410-2001-TestParamSet（= RFC 7091 §7.1 官方测试示例全部数值）
 * - 512：id-tc26-gost-3410-12-512-paramSetA（TC 26 标准；与 pygost 同源互验）
 *
 * 红线：纯 BigInt 本地，零外发；随机 d/k 用 crypto.getRandomValues。
 * 验证：RFC 7091 §7.2/§7.3 官方向量（给定 e、k 复算 r/s/v/z1/z2/C）+ pygost 对拍 + 往返/篡改负例。
 */

import { register } from "./registry.js";
import { streebog } from "./streebog.js";

// ==================== 参数集 ====================

function h2i(hex) { return BigInt("0x" + hex); }

const PARAM_SETS = {
  "256": {
    id: "id-GostR3410-2001-TestParamSet",
    p: h2i("8000000000000000000000000000000000000000000000000000000000000431"),
    q: h2i("8000000000000000000000000000000150FE8A1892976154C59CFC193ACCF5B3"),
    a: 7n,
    b: h2i("5FBFF498AA938CE739B8E022FBAFEF40563F6E6A3472FC2A514C0CE9DAE23B7E"),
    x: 2n,
    y: h2i("8E2A8A0E65147D4BD6316030E16D19C85C97F0A9CA267122B96ABBCEA7E8FC8"),
    size: 32, hashBits: 256,
  },
  "512": {
    id: "id-tc26-gost-3410-12-512-paramSetA",
    p: h2i("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDC7"),
    q: h2i("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF27E69532F48D89116FF22B8D4E0560609B4B38ABFAD2B85DCACDB1411F10B275"),
    a: h2i("FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFDC4"),
    b: h2i("E8C2505DEDFC86DDC1BD0B2B6667F1DA34B82574761CB0E879BD081CFD0B6265EE3CB090F30D27614CB4574010DA90DD862EF9D4EBEE4761503190785A71C760"),
    x: 3n,
    y: h2i("7503CFE87A836AE3A61B8816E25450E6CE5E1C93ACF1ABC1778064FDCBEFA921DF1626BE4FD036E93D75E6A50E3A41E98028FE5FC235F5B889A589CB5215F2A4"),
    size: 64, hashBits: 512,
  },
};

// ==================== 椭圆曲线算术（RFC 7091 §5.1 式(4)(5)，仿射坐标） ====================

// 点用 [x, y] 数组，零点 O 用 null。

function modP(cv, a) { const r = a % cv.p; return r < 0n ? r + cv.p : r; }
function invP(cv, a) {
  // 扩展欧几里得（q 为素数也可用费马，这里求通用）
  let lm = 1n, hm = 0n, low = modP(cv, a), high = cv.p, r;
  while (low > 1n) {
    r = high / low;
    [lm, hm, low, high] = [hm - lm * r, lm, high - low * r, low];
  }
  return modP(cv, lm);
}

function ecAdd(cv, p1, p2) {
  if (!p1) return p2;
  if (!p2) return p1;
  const [x1, y1] = p1, [x2, y2] = p2;
  if (x1 === x2) {
    if (modP(cv, y1 + y2) === 0n) return null; // y1 = -y2 → O
    const lam = modP(cv, (3n * x1 * x1 + cv.a) * invP(cv, 2n * y1)); // 式(5)
    const x3 = modP(cv, lam * lam - 2n * x1);
    const y3 = modP(cv, lam * (x1 - x3) - y1);
    return [x3, y3];
  }
  const lam = modP(cv, (y1 - y2) * invP(cv, x1 - x2)); // 式(4)
  const x3 = modP(cv, lam * lam - x1 - x2);
  const y3 = modP(cv, lam * (x1 - x3) - y1);
  return [x3, y3];
}

function ecMul(cv, k, pt) {
  let acc = null, addend = pt;
  let s = BigInt(k) % cv.q;
  if (s < 0n) s += cv.q;
  while (s > 0n) {
    if (s & 1n) acc = ecAdd(cv, acc, addend);
    addend = ecAdd(cv, addend, addend);
    s >>= 1n;
  }
  return acc;
}

function onCurve(cv, pt) {
  if (!pt) return true;
  const [x, y] = pt;
  return modP(cv, y * y) === modP(cv, x * x * x + cv.a * x + cv.b);
}

// ==================== 签名 / 验签（RFC 7091 §6.1 / §6.2） ====================

/** 哈希 → e（式(15)：α 大端整数 mod q，0 置 1）。digestHex 为 Streebog 输出。 */
function digestToE(cv, digestHex) {
  const alpha = BigInt("0x" + (digestHex || "0"));
  let e = alpha % cv.q;
  if (e === 0n) e = 1n;
  return e;
}

/** 签名核心（给定 e 与 k，教学可固定 k 对拍官方向量）。返回 { r, s, C }。 */
function gostSignRaw(cv, d, e, k) {
  const C = ecMul(cv, k, [cv.x, cv.y]);
  const r = C ? C[0] % cv.q : 0n;
  const s = (r * d + k * e) % cv.q;
  return { r, s, C };
}

/** 验签核心（Algorithm II）。返回 { ok, v, z1, z2, C, R }。 */
function gostVerifyRaw(cv, Q, e, r, s) {
  if (r <= 0n || r >= cv.q || s <= 0n || s >= cv.q) {
    return { ok: false, reason: "0 < r,s < q 范围检查失败" };
  }
  const v = invP({ ...cv, p: cv.q }, e); // e^{-1} mod q
  const z1 = s * v % cv.q;
  const z2 = (cv.q - r * v % cv.q) % cv.q;
  const C = ecAdd(cv, ecMul(cv, z1, [cv.x, cv.y]), ecMul(cv, z2, Q));
  const R = C ? C[0] % cv.q : 0n;
  return { ok: R === r, v, z1, z2, C, R };
}

function i2h(v, size) { // 大端定长 hex
  let h = v.toString(16);
  if (h.length > size * 2) h = h.slice(-size * 2);
  return h.padStart(size * 2, "0");
}
function hexToBytes(hex) {
  const h = String(hex || "").trim().replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`非法 hex：${hex}`);
  if (h.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function randomBelow(q) {
  const bytes = Math.ceil(q.toString(2).length / 8) + 8;
  const buf = new Uint8Array(bytes);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
  } while (v >= q || v < 1n);
  return v;
}

function getSet(key) {
  const cv = PARAM_SETS[key === "512" ? "512" : "256"];
  return cv;
}

function msgToBytes(text, fmt) {
  if (fmt === "hex") {
    const b = hexToBytes(text);
    if (!b.length) throw new Error("hex 输入为空");
    return b;
  }
  return new TextEncoder().encode(String(text));
}

// ==================== op 注册 ====================

register({
  id: "gostSign",
  family: "gost", familyLabel: "sign",
  cat: "asym",
  name: "GOST R 34.10-2012 签名",
  desc: "俄罗斯国标 EC 签名（RFC 7091，哈希 Streebog-256/512 按参数集）：私钥留空随机生成，输出公钥 Q 与签名 ζ = R||S（大端）。k 可固定供教学复算。过 RFC 7091 §7.2 官方向量 + pygost 对拍",
  params: [
    { key: "set", label: "参数集", type: "select", default: "256", options: [
      { value: "256", label: "256 位（TestParamSet = RFC 7091 官方示例集）" },
      { value: "512", label: "512 位（id-tc26-gost-3410-12-512-paramSetA）" },
    ] },
    { key: "inputFormat", label: "消息格式", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "Hex" },
    ] },
    { key: "priv", label: "私钥 d (hex, 可选)", type: "text", default: "", placeholder: "32/64B hex，留空随机生成" },
    { key: "k", label: "随机数 k (hex, 教学)", type: "text", default: "", placeholder: "32/64B hex，留空随机（固定 k 仅供对拍教学）" },
  ],
  run: (text, p) => {
    const cv = getSet(p && p.set);
    const msg = msgToBytes(text, (p && p.inputFormat) || "text");
    const digestHex = streebog(msg, cv.hashBits);
    const e = digestToE(cv, digestHex);

    const privRaw = (p && p.priv && String(p.priv).trim()) || "";
    let d;
    if (privRaw) {
      const db = hexToBytes(privRaw);
      d = BigInt("0x" + bytesToHex(db));
      if (d <= 0n || d >= cv.q) throw new Error(`私钥 d 必须满足 0 < d < q`);
    } else {
      d = randomBelow(cv.q);
    }
    const Q = ecMul(cv, d, [cv.x, cv.y]);

    const kRaw = (p && p.k && String(p.k).trim()) || "";
    let k, res;
    if (kRaw) {
      const kb = hexToBytes(kRaw);
      k = BigInt("0x" + bytesToHex(kb));
      if (k <= 0n || k >= cv.q) throw new Error(`k 必须满足 0 < k < q`);
      res = gostSignRaw(cv, d, e, k);
    } else {
      for (let tries = 0; ; tries++) {
        k = randomBelow(cv.q);
        res = gostSignRaw(cv, d, e, k);
        if (res.r !== 0n && res.s !== 0n) break;
        if (tries > 1000) throw new Error("签名重试异常，请重跑");
      }
    }
    if (res.r === 0n || res.s === 0n) throw new Error("r 或 s 为 0（该 k 不可用，请换 k）");
    const sigHex = i2h(res.r, cv.size) + i2h(res.s, cv.size);
    const lines = [
      `=== GOST R 34.10-2012 签名（RFC 7091，${cv.id}）===`,
      `消息 (${msg.length}B) hex = ${bytesToHex(msg)}`,
      `Streebog-${cv.hashBits}(M) = ${digestHex}`,
      `e = α mod q = ${e}`,
      "",
      `私钥 d = ${d.toString(16)}`,
      `公钥 Q.x = ${i2h(Q ? Q[0] : 0n, cv.size)}`,
      `公钥 Q.y = ${i2h(Q ? Q[1] : 0n, cv.size)}`,
      kRaw ? `随机数 k（固定）= ${k.toString(16)}` : `随机数 k = ${k.toString(16)}`,
      `r = x(kP) mod q = ${i2h(res.r, cv.size)}`,
      `s = (rd + ke) mod q = ${i2h(res.s, cv.size)}`,
      "",
      `签名 ζ = R||S (${cv.size * 2}B hex) = ${sigHex}`,
      "",
      privRaw ? "" : "私钥为随机生成：⚠ 敏感请妥善保管。",
      "验签用「GOST R 34.10-2012 验签」op（注意本工具 ζ = R||S 大端；pygost 等库输出 s||r，互通需交换两半）。",
      "签名已生成二进制文件，点击下方按钮下载。",
    ].filter((x) => x !== "").join("\n");
    return {
      text: lines,
      files: [
        { name: "gost_r3410.sig", mime: "application/octet-stream",
          bytes: hexToBytes(sigHex) },
      ],
    };
  },
});

register({
  id: "gostVerify",
  family: "gost", familyLabel: "verify",
  cat: "asym",
  name: "GOST R 34.10-2012 验签",
  desc: "俄罗斯国标 EC 验签（RFC 7091 §6.2）：公钥 Q(x,y) + 签名 ζ = R||S + 原消息，复算 C = z1·P + z2·Q 比对 x(C) mod q。篡改任一环节即失败",
  params: [
    { key: "set", label: "参数集", type: "select", default: "256", options: [
      { value: "256", label: "256 位（TestParamSet = RFC 7091 官方示例集）" },
      { value: "512", label: "512 位（id-tc26-gost-3410-12-512-paramSetA）" },
    ] },
    { key: "inputFormat", label: "消息格式", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "Hex" },
    ] },
    { key: "pubx", label: "公钥 Q.x (hex)", type: "text", default: "", placeholder: "32/64B hex" },
    { key: "puby", label: "公钥 Q.y (hex)", type: "text", default: "", placeholder: "32/64B hex" },
    { key: "sig", label: "签名 ζ = R||S (hex)", type: "text", default: "", placeholder: "64/128B hex（R 在前 S 在后）" },
  ],
  run: (text, p) => {
    const cv = getSet(p && p.set);
    const msg = msgToBytes(text, (p && p.inputFormat) || "text");
    const qx = BigInt("0x" + (String(p && p.pubx || "").replace(/^0x/i, "") || "0"));
    const qy = BigInt("0x" + (String(p && p.puby || "").replace(/^0x/i, "") || "0"));
    const Q = [qx, qy];
    if (!onCurve(cv, Q)) throw new Error("公钥 Q 不在曲线上");
    const sigBytes = hexToBytes((p && p.sig) || "");
    if (sigBytes.length !== cv.size * 2) {
      throw new Error(`签名必须为 ${cv.size * 2} 字节（R、S 各 ${cv.size}），当前 ${sigBytes.length} 字节`);
    }
    const r = BigInt("0x" + bytesToHex(sigBytes.slice(0, cv.size)));
    const s = BigInt("0x" + bytesToHex(sigBytes.slice(cv.size)));

    const digestHex = streebog(msg, cv.hashBits);
    const e = digestToE(cv, digestHex);
    const out = gostVerifyRaw(cv, Q, e, r, s);

    const lines = [
      `=== GOST R 34.10-2012 验签（RFC 7091 §6.2，${cv.id}）===`,
      `消息 (${msg.length}B) hex = ${bytesToHex(msg)}`,
      `Streebog-${cv.hashBits}(M) = ${digestHex}`,
      `e = α mod q = ${e}`,
    ];
    if (out.reason) {
      lines.push("", `✗ 签名无效（${out.reason}）`);
      return lines.join("\n");
    }
    lines.push(
      `v = e^-1 mod q = ${out.v.toString(16)}`,
      `z1 = s·v mod q = ${out.z1.toString(16)}`,
      `z2 = -r·v mod q = ${out.z2.toString(16)}`,
      `C = z1·P + z2·Q：x(C) mod q = ${i2h(out.R, cv.size)}`,
      "",
      out.ok ? `✓ 签名有效（x(C) mod q = r = ${i2h(r, cv.size)}）` : `✗ 签名无效（x(C) mod q ≠ r）`,
    );
    return lines.join("\n");
  },
});

export { PARAM_SETS, ecAdd, ecMul, onCurve, digestToE, gostSignRaw, gostVerifyRaw, hexToBytes, bytesToHex };
