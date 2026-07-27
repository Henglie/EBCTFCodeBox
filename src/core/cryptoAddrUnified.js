/*
 * cryptoAddrUnified.js — 加密货币地址解析归一（T263，cat:'analysis'，run 型）。
 * 归一 façade：自动识别 BTC(legacy/segwit/taproot) / ETH / 其他
 * 输出地址类型/校验和验证/网络/编码方式。
 *
 * 归并对象：
 * - eccdetect.js btcAddressIdent（P2PKH/P2SH/P2WPKH/P2WSH，Bech32）
 * - eccdetect.js ethAddressIdent（ETH EIP-55）
 * - 本文件补充 Bech32m（BIP350）用于 Taproot P2TR（eccdetect 的 bech32Decode 只支持 Bech32）
 *
 * 复用（import）：
 * - eccdetect.js identifyBtcAddress（BTC legacy Base58Check 分支直接复用）
 * - eccdetect.js identifyEthAddress（ETH EIP-55 分支直接复用）
 *
 * 红线：只做地址「解析/校验」，绝不生成私钥/助记词（同 cnidCheck 只算校验位）。
 * 契约：register({id, cat:"analysis", name, desc, params:[], run})。
 *
 * 参考：
 * - BIP173 Bech32（const=1，witver=0）
 * - BIP350 Bech32m（const=0x2bc830a3，witver=1+）
 * - EIP-55 ETH 地址混合大小写校验
 */
import { register } from "./registry.js";
import { identifyBtcAddress, identifyEthAddress } from "./eccdetect.js";

// ============================================================
// 工具
// ============================================================
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

// ============================================================
// Bech32 / Bech32m 统一解码（BIP173 + BIP350）
// ============================================================
// 与 eccdetect.js 的 bech32Decode 区别：本实现同时校验 Bech32(const=1) 和 Bech32m(const=0x2bc830a3)
// 返回 encoding 字段标识命中的是哪种编码，供 witver 交叉验证。

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

function bech32HrpExpand(hrp) {
  const ret = [];
  for (const ch of hrp) ret.push(ch.charCodeAt(0) >> 5);
  ret.push(0);
  for (const ch of hrp) ret.push(ch.charCodeAt(0) & 0x1f);
  return ret;
}

function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

// 统一解码：返回 { hrp, data, encoding }
function bech32UnifiedDecode(str) {
  const s = String(str).trim().toLowerCase();
  if (s.length < 8 || s.length > 90) throw new Error("Bech32 长度须 8-90（实为 " + s.length + "）");
 // 大小写一致性检查（BIP173：全大写或全小写）
  const orig = String(str).trim();
  if (orig !== orig.toLowerCase() && orig !== orig.toUpperCase()) {
    throw new Error("Bech32 大小写混合非法（须全大写或全小写）");
  }
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) throw new Error("Bech32 分隔符 '1' 位置非法");
  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);
  const data = [];
  for (const ch of dataPart) {
    const v = BECH32_CHARSET.indexOf(ch);
    if (v < 0) throw new Error("Bech32 非法字符: '" + ch + "'");
    data.push(v);
  }
  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data]);
  let encoding;
  if (polymod === BECH32_CONST) encoding = "Bech32";
  else if (polymod === BECH32M_CONST) encoding = "Bech32m";
  else throw new Error("Bech32/Bech32m 校验失败（地址损坏或拼错）");
  return { hrp, data: data.slice(0, -6), encoding };
}

// 5 位 → 8 位（Bech32 data → payload bytes）
function bech32ConvertBits8(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0;
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  const out = [];
  for (const v of data) {
    if (v < 0 || v >> fromBits !== 0) throw new Error("convertBits 值 " + v + " 超出 " + fromBits + " 位范围");
    acc = ((acc << fromBits) | v) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error("convertBits 非法填充");
  }
  return out;
}

// ============================================================
// BTC SegWit/Taproot 识别（支持 Bech32 + Bech32m）
// ============================================================
// eccdetect.js 的 identifyBtcAddress 只用 Bech32(const=1) 解码
// taproot(witver=1, Bech32m) 地址会校验失败。
// 本函数用统一解码器，支持两种编码 + BIP350 witver/encoding 交叉验证。

const BTC_HRP_MAP = { bc: "mainnet（主网）", tb: "testnet（测试网）", bcrt: "regtest（回归测试）" };

function identifyBtcSegWitUnified(addr) {
  const lower = addr.toLowerCase();
  if (!/^(bc|tb|bcrt)1/.test(lower)) return null;
  let decoded;
  try { decoded = bech32UnifiedDecode(addr); }
  catch (e) { return { ok: false, error: e.message }; }
  const hrp = decoded.hrp;
  const data = decoded.data;
  if (!data.length) return { ok: false, error: "空 witness 数据" };
  const witver = data[0];
  let witprog;
  try { witprog = bech32ConvertBits8(data.slice(1), 5, 8, false); }
  catch (e) { return { ok: false, error: "witness 程序转换失败: " + e.message }; }

 // BIP350 规则：witver=0 必须 Bech32，witver>=1 必须 Bech32m
  if (witver === 0 && decoded.encoding !== "Bech32") {
    return { ok: false, error: "witver=0 须用 Bech32 编码（实为 " + decoded.encoding + "）" };
  }
  if (witver >= 1 && decoded.encoding !== "Bech32m") {
    return { ok: false, error: "witver>=1 须用 Bech32m 编码（实为 " + decoded.encoding + "）" };
  }

 // 类型判定
  let segType = "未知 SegWit v" + witver;
  if (witver === 0 && witprog.length === 20) segType = "P2WPKH（原生 SegWit v0 付公钥哈希）";
  else if (witver === 0 && witprog.length === 32) segType = "P2WSH（原生 SegWit v0 付脚本哈希）";
  else if (witver === 1 && witprog.length === 32) segType = "P2TR（Taproot，SegWit v1）";

  const lines = [];
  lines.push("=== 加密货币地址解析 ===");
  lines.push("地址: " + addr);
  lines.push("链: Bitcoin（BTC）");
  lines.push("编码: " + decoded.encoding + (witver === 1 ? "（Taproot）" : ""));
  lines.push("网络: " + (BTC_HRP_MAP[hrp] || "?") + "  ·  HRP: " + hrp);
  lines.push("Witness 版本: " + witver);
  lines.push("Witness 程序: " + toHex(new Uint8Array(witprog)) + " (" + witprog.length + " 字节)");
  lines.push("类型: " + segType);
  lines.push("校验: ✓ " + decoded.encoding + " 校验通过");
  return { ok: true, lines: lines.join("\n"), type: segType, net: BTC_HRP_MAP[hrp] };
}

// ============================================================
// 归一入口：自动识别 BTC(legacy/segwit/taproot) / ETH / 其他
// ============================================================
function cryptoAddrUnifiedReport(text) {
  const addr = String(text || "").trim();
  if (!addr) throw new Error("空输入：请填入 BTC / ETH 地址");

  const lower = addr.toLowerCase();

 // 1. ETH：0x + 40 hex（或裸 40 hex）
  if (/^(0x)?[0-9a-f]{40}$/i.test(addr)) {
 // identifyEthAddress 内部做 EIP-55 校验，输出完整报告
    const r = identifyEthAddress(addr);
 // 归一抬头：把 eccdetect 的"以太坊地址识别（EIP-55）"改为统一格式
    const lines = r.lines.split("\n");
    if (lines.length && lines[0].startsWith("=== 以太坊")) {
      lines[0] = "=== 加密货币地址解析 ===";
 // 插入链标识
      lines.splice(1, 0, "链: Ethereum（ETH）");
    }
    return lines.join("\n");
  }

 // 2. BTC SegWit/Taproot：bc1/tb1/bcrt1 开头
  if (/^(bc|tb|bcrt)1/.test(lower)) {
 // 先用统一解码器（支持 Bech32 + Bech32m）
    const r = identifyBtcSegWitUnified(addr);
    if (r && r.ok) return r.lines;
 // 统一解码器失败，尝试 eccdetect 的 identifyBtcAddress（兼容旧 Bech32 实现）
    const r2 = identifyBtcAddress(addr);
    if (r2 && r2.lines) {
 // 归一抬头
      const lines = r2.lines.split("\n");
      if (lines.length && lines[0].startsWith("=== 比特币")) {
        lines[0] = "=== 加密货币地址解析 ===";
        lines.splice(1, 0, "链: Bitcoin（BTC）");
      }
      return lines.join("\n");
    }
    throw new Error((r && r.error) || (r2 && r2.error) || "BTC SegWit 地址识别失败");
  }

 // 3. BTC Legacy：1/3 开头（base58check，P2PKH/P2SH）
  if (/^[13]/.test(addr)) {
    const r = identifyBtcAddress(addr);
    if (r && r.lines) {
 // 归一抬头
      const lines = r.lines.split("\n");
      if (lines.length && lines[0].startsWith("=== 比特币")) {
        lines[0] = "=== 加密货币地址解析 ===";
        lines.splice(1, 0, "链: Bitcoin（BTC）");
      }
      return lines.join("\n");
    }
    throw new Error((r && r.error) || "BTC Legacy 地址识别失败");
  }

 // 4. 未识别
  throw new Error("未识别的地址格式（支持 BTC legacy/SegWit/Taproot + ETH）");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "cryptoAddrUnified",
  cat: "data",
  name: "加密货币地址解析",
  desc: "自动识别 BTC(P2PKH/P2SH/P2WPKH/P2WSH/P2TR) / ETH 地址类型 + 校验和验证 + 网络 + 编码方式（归一入口，只解析不生成私钥）",
  params: [],
  run: cryptoAddrUnifiedReport,
});

export {
  cryptoAddrUnifiedReport,
  identifyBtcSegWitUnified,
  bech32UnifiedDecode,
  bech32ConvertBits8,
};
