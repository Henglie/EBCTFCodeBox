/*
 * vmpc.js — VMPC 流密码（Zoltak 2004，modern，双向自反）。
 *
 * 算法照作者官网官方实现（vmpcfunction.com，VMPC-CipherMAC-C-ENG.txt）逐函数
 * 移植，不编造：
 *
 *   VMPCInitKeyRound(Data, Len, Src)：768 轮 KSA 一轮。
 *     Src==0 时 P=恒等置换、s=0 复位；k=0；n=0。
 *     每轮：s = P[(s + P[n] + Data[k]) & 255]；swap(P[n], P[s])；k 回绕；n 递增。
 *   VMPCInitKey（FULL）：Key→Vector→Key 三遍（VMPC-KSA3，更安全但慢 1/3）。
 *   VMPCInitKeyBASIC：Key→Vector 两遍（作者声明同样安全）。
 *   VMPCEncrypt：加解密同一函数（自反 XOR）——
 *     s = P[(s + P[n]) & 255]；Data[x] ^= P[(P[P[s]]+1) & 255]；swap(P[n], P[s])；n 递增。
 *
 * 官方向量（作者源码内置测试数据）：
 *   key=9661410AB797D8A9EB767C21172DF6C7 IV=4B5C2F003E67F39557A8D26F3DA2B155，
 *   BASIC 装载后加密 102400 个零字节，keystream 采样（0-3/252-255/1020-1023/
 *   102396-102399）= A82479F5 B8FC66A4 E05640A5 81CA499A；P 表采样 =
 *   3FA52267 75B3D2C3。FULL 版 keystream 采样 = B6EBAEFE 48172473 1DAEC35A
 *   1DA7E1DC。
 *
 * 本 op：encode 输入 UTF-8 字节 ⊕ keystream → hex；decode hex ⊕ 同 keystream
 * → UTF-8 文本。key/iv 支持 hex 或文本自动识别。
 *
 * 红线：算法照官方参考，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node --input-type=module -e "import('./src/core/vmpc.js').then(m=>m.selfCheck())"
 *
 * 契约：register({ id:"vmpc", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ---- VMPC 引擎（照官方 C 实现逐函数） ----
function makeVmpc() {
  const P = new Uint8Array(256);
  for (let i = 0; i < 256; i++) P[i] = i;
  return { P, s: 0, n: 0 };
}

// 一轮 KSA：Data 长度 1-64 字节；Src=0 复位 P/s
function initKeyRound(st, data, len, src) {
  if (src === 0) {
    for (let i = 0; i < 256; i++) st.P[i] = i;
    st.s = 0;
  }
  let k = 0;
  st.n = 0;
  for (let x = 0; x < 768; x++) {
    st.s = st.P[(st.s + st.P[st.n] + data[k]) & 255];
    const t = st.P[st.n];
    st.P[st.n] = st.P[st.s];
    st.P[st.s] = t;
    k++; if (k === len) k = 0;
    st.n = (st.n + 1) & 255; // C 里 n 是 unsigned char，255 回绕
  }
}

// 完整版：Key→Vector→Key 三遍
function initKey(st, key, iv) {
  initKeyRound(st, key, key.length, 0);
  initKeyRound(st, iv, iv.length, 1);
  initKeyRound(st, key, key.length, 1);
}

// 基础版：Key→Vector 两遍
function initKeyBasic(st, key, iv) {
  initKeyRound(st, key, key.length, 0);
  initKeyRound(st, iv, iv.length, 1);
}

// 生成 n 字节密钥流（不改变 op 输入输出语义：直接 XOR）
function genKeystream(keyBytes, ivBytes, n, mode) {
  const st = makeVmpc();
  if (mode === "full") initKey(st, keyBytes, ivBytes);
  else initKeyBasic(st, keyBytes, ivBytes);
  const out = new Uint8Array(n);
  for (let x = 0; x < n; x++) {
    st.s = st.P[(st.s + st.P[st.n]) & 255];
    out[x] = st.P[(st.P[st.P[st.s]] + 1) & 255];
    const t = st.P[st.n];
    st.P[st.n] = st.P[st.s];
    st.P[st.s] = t;
    st.n = (st.n + 1) & 255; // C 里 n 是 unsigned char，255 回绕
  }
  return out;
}

// ---- 参数解析 ----
function parseBytes(p, keyName, label) {
  const raw = String((p && p[keyName]) != null ? p[keyName] : "").trim();
  if (!raw) throw new Error(`请填写 ${label}`);
  if (/^[0-9a-fA-F\s]+$/.test(raw) && raw.replace(/\s/g, "").length % 2 === 0) {
    const hex = raw.replace(/^0x/i, "").replace(/\s+/g, "");
    if (hex.length > 128) throw new Error(`${label} 最长 64 字节`);
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  const out = new TextEncoder().encode(raw);
  if (out.length > 64) throw new Error(`${label} 最长 64 字节`);
  return out;
}

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}
function hexToBytes(s) {
  const clean = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("十六进制密文长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// encode：文本 → 密文 hex
function vmpcEncode(text, p = {}) {
  const key = parseBytes(p, "key", "密钥");
  const iv = parseBytes(p, "iv", "IV");
  const mode = (p.mode || "basic") === "full" ? "full" : "basic";
  const data = te(text);
  const ks = genKeystream(key, iv, data.length, mode);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

// decode：密文 hex → 文本
function vmpcDecode(text, p = {}) {
  const key = parseBytes(p, "key", "密钥");
  const iv = parseBytes(p, "iv", "IV");
  const mode = (p.mode || "basic") === "full" ? "full" : "basic";
  const data = hexToBytes(text);
  const ks = genKeystream(key, iv, data.length, mode);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

register({
  id: "vmpc",
  cat: "modern",
  name: "VMPC 流密码",
  desc: "VMPC 流密码（Zoltak 2004）：768 轮 KSA + 自反 XOR keystream，抗 RC4 已知攻击。模式 basic=Key→IV 两遍 / full=Key→IV→Key 三遍（更安全）。key/iv 文本或 hex 自动识别。encode 文本→密文 hex，decode 密文 hex→文本。",
  params: [
    { key: "key", type: "text", label: "密钥 key", default: "9661410AB797D8A9EB767C21172DF6C7", placeholder: "文本或 hex，最长 64 字节" },
    { key: "iv", type: "text", label: "初始化向量 IV", default: "4B5C2F003E67F39557A8D26F3DA2B155", placeholder: "文本或 hex，最长 64 字节（勿与同 key 复用）" },
    {
      key: "mode", type: "select", label: "初始化模式", default: "basic",
      options: [
        { value: "basic", label: "basic（Key→IV 两遍）" },
        { value: "full", label: "full（Key→IV→Key 三遍）" },
      ],
    },
  ],
  encode: vmpcEncode,
  decode: vmpcDecode,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑） ----
function selfCheck() {
  let fail = 0;
  const key = hexToBytes("9661410AB797D8A9EB767C21172DF6C7");
  const iv = hexToBytes("4B5C2F003E67F39557A8D26F3DA2B155");
  const check = (name, got, expected) => {
    if (got === expected) console.log("PASS " + name);
    else { console.log("FAIL " + name + "\n  got      " + got + "\n  expected " + expected); fail++; }
  };
  // 官方向量 1：BASIC 装载后 P 表采样（索引 0-3, 252-255）
  {
    const st = makeVmpc();
    initKeyBasic(st, key, iv);
    const idx = [0, 1, 2, 3, 252, 253, 254, 255];
    check("官方向量 BASIC P 表采样", bytesToHex(idx.map((i) => st.P[i])), "3fa5226775b3d2c3");
  }
  // 官方向量 2：BASIC keystream 采样（0-3/252-255/1020-1023/102396-102399）
  {
    const ks = genKeystream(key, iv, 102400, "basic");
    const idx = [0, 1, 2, 3, 252, 253, 254, 255, 1020, 1021, 1022, 1023, 102396, 102397, 102398, 102399];
    check("官方向量 BASIC keystream 采样", bytesToHex(idx.map((i) => ks[i])), "a82479f5b8fc66a4e05640a581ca499a");
  }
  // 官方向量 3：FULL 版 keystream 采样
  {
    const ks = genKeystream(key, iv, 102400, "full");
    const idx = [0, 1, 2, 3, 252, 253, 254, 255, 1020, 1021, 1022, 1023, 102396, 102397, 102398, 102399];
    check("官方向量 FULL keystream 采样", bytesToHex(idx.map((i) => ks[i])), "b6ebae fe".replace(/ /g, "") + "48172473" + "1daec35a" + "1da7e1dc");
  }
  // 往返（含中文）
  const rt = vmpcDecode(vmpcEncode("Hello VMPC 你好", { key: "ABC", iv: "1234" }), { key: "ABC", iv: "1234" });
  if (rt === "Hello VMPC 你好") console.log("PASS 往返测试（文本→hex→文本）");
  else { console.log("FAIL 往返测试: " + JSON.stringify(rt)); fail++; }
  console.log(fail === 0 ? "VMPC selfCheck 全部 PASS" : `VMPC selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { genKeystream, makeVmpc, vmpcEncode, vmpcDecode, selfCheck };
