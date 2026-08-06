/*
 * spritz.js — Spritz 流密码（Rivest & Schuldt 2014《Spritz—a spongy RC4-like
 * stream cipher and hash function》论文 2014-10-27 版，modern，双向自反）。
 *
 * 算法照论文伪代码 + 论文字面参考实现 therealjampers/spritzjs（MIT）逐函数
 * 移植，不编造。与早期 spritz.c 版（2014-10-15）算法不同：本版用「a 计数器
 * 吸收」体系（absorb 走 S[a]↔S[128+nibble] 槽位交换，a=128 触发 shuffle），
 * k 在 update 中参与混合，crush 为条件交换，shuffle 为 3×whip+2×crush：
 *
 *   状态：i/j/k/z/a 五计数器 + w（步长，恒与 256 互素）+ S[256] 置换表。
 *   absorbNibble(x)：a==128 时 shuffle；swap(S[a], S[128+x])；a=(a+1) mod 256。
 *   absorbByte(b)：先低 4 位再高 4 位。
 *   update：i+=w；j = k+S[j+S[i]]；k = i+k+S[j]；swap(S[i],S[j])。
 *   output：z = S[j+S[i+S[z+k]]]。
 *   whip(r)：r 次 update 后 w 递增至 gcd(w,256)==1。
 *   squeeze(r)：a>0 时 shuffle；逐字节 drip（update+output）。
 *   keySetup = initialize + absorb(key)；IV 用法 = absorbStop + absorb(iv)。
 *
 * 权威向量（spritzjs 测试，论文版）：absorb("ABC") 后 drip 8 字节 =
 *   77 9A 8E 01 F9 E9 CB C0；absorb("spam") 后 = F0 60 9A 1D F1 43 CE BF。
 *
 * 本 op 加密 = 密钥流 XOR 明文（论文模加 C=M+Squeeze 的等价替代，官方注释
 * 认可；XOR 自反便于双向）；encode 文本→hex 密文，decode hex→文本。
 *
 * 红线：算法照官方参考，不编造；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 自检：node --input-type=module -e "import('./src/core/spritz.js').then(m=>m.selfCheck())"
 *
 * 契约：register({ id:"spritz", cat:"modern", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

const N = 256;
const N_OVER_TWO = 128;

function madd(a, b) { return (a + b) % N; }

function gcd(a, b) {
  let t;
  while (b !== 0) { t = b; b = a % b; a = t; }
  return a;
}

// ---- Spritz 状态机（照论文版参考实现逐函数） ----
function makeSpritz() {
  const st = { i: 0, j: 0, k: 0, z: 0, a: 0, w: 1, s: new Uint8Array(N) };
  return st;
}

function initializeState(st) {
  st.i = st.j = st.k = st.z = st.a = 0;
  st.w = 1;
  for (let v = 0; v < N; v++) st.s[v] = v;
}

function absorbNibble(st, x) {
  if (st.a === N_OVER_TWO) shuffle(st);
  const tmp = st.s[st.a];
  st.s[st.a] = st.s[madd(N_OVER_TWO, x)];
  st.s[madd(N_OVER_TWO, x)] = tmp;
  st.a = madd(st.a, 1);
}

function absorbByte(st, b) {
  absorbNibble(st, b & 0x0f);
  absorbNibble(st, (b >>> 4) & 0x0f);
}

function absorb(st, data) {
  for (let v = 0; v < data.length; v++) absorbByte(st, data[v]);
}

function absorbStop(st) {
  if (st.a === N_OVER_TWO) shuffle(st);
  st.a = madd(st.a, 1);
}

function shuffle(st) {
  whip(st, 2 * N);
  crush(st);
  whip(st, 2 * N);
  crush(st);
  whip(st, 2 * N);
  st.a = 0;
}

function whip(st, r) {
  for (let v = 0; v < r; v++) update(st);
  do { st.w = madd(st.w, 1); } while (gcd(st.w, N) !== 1);
}

function crush(st) {
  for (let v = 0; v < N_OVER_TWO; v++) {
    const idx = N - 1 - v;
    if (st.s[v] > st.s[idx]) {
      const tmp = st.s[v];
      st.s[v] = st.s[idx];
      st.s[idx] = tmp;
    }
  }
}

function update(st) {
  st.i = madd(st.i, st.w);
  const si = st.s[st.i];
  st.j = madd(st.k, st.s[madd(st.j, si)]);
  st.k = madd(st.i + st.k, st.s[st.j]);
  const sj = st.s[st.j];
  st.s[st.i] = sj;
  st.s[st.j] = si;
}

function output(st) {
  st.z = st.s[madd(st.j, st.s[madd(st.i, st.s[madd(st.z, st.k)])])];
  return st.z;
}

function drip(st) {
  if (st.a > 0) shuffle(st);
  update(st);
  return output(st);
}

function squeeze(st, r) {
  const out = new Uint8Array(r);
  if (st.a > 0) shuffle(st);
  for (let v = 0; v < r; v++) out[v] = drip(st);
  return out;
}

function keySetup(st, key) {
  initializeState(st);
  absorb(st, key);
}

function ivSetup(st, iv) {
  absorbStop(st);
  absorb(st, iv);
}

// 生成 n 字节密钥流（key + 可选 iv）
function genKeystream(keyBytes, ivBytes, n) {
  const st = makeSpritz();
  keySetup(st, keyBytes);
  if (ivBytes && ivBytes.length > 0) ivSetup(st, ivBytes);
  return squeeze(st, n);
}

// ---- 参数解析 ----
function parseBytes(p, keyName, label, allowEmpty) {
  const raw = String((p && p[keyName]) != null ? p[keyName] : "").trim();
  if (!raw) {
    if (allowEmpty) return new Uint8Array(0);
    throw new Error(`请填写 ${label}`);
  }
  if (/^[0-9a-fA-F\s]+$/.test(raw) && raw.replace(/\s/g, "").length % 2 === 0) {
    const hex = raw.replace(/^0x/i, "").replace(/\s+/g, "");
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  return new TextEncoder().encode(raw);
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

// encode：文本 → 密文 hex（key/iv 可文本或 hex 自动识别）
function spritzEncode(text, p = {}) {
  const key = parseBytes(p, "key", "密钥");
  const iv = parseBytes(p, "iv", "IV", true);
  const data = te(text);
  const ks = genKeystream(key, iv, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return bytesToHex(out);
}

// decode：密文 hex → 文本
function spritzDecode(text, p = {}) {
  const key = parseBytes(p, "key", "密钥");
  const iv = parseBytes(p, "iv", "IV", true);
  const data = hexToBytes(text);
  const ks = genKeystream(key, iv, data.length);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = data[i] ^ ks[i];
  return td(out);
}

register({
  id: "spritz",
  cat: "modern",
  name: "Spritz 流密码",
  desc: "Spritz 流密码（Rivest & Schuldt 2014 论文版）：a 计数器吸收 + 五索引状态海绵结构，输出双指针链式混合，抗 RC4 已知偏差。key（+ 可选 IV）文本或 hex 自动识别。自反 XOR：encode 文本→密文 hex，decode 密文 hex→文本。",
  params: [
    { key: "key", type: "text", label: "密钥 key", default: "ABC", placeholder: "文本或 hex（偶数长度 hex 自动按 hex 解析）" },
    { key: "iv", type: "text", label: "IV（可选）", default: "", placeholder: "文本或 hex" },
  ],
  encode: spritzEncode,
  decode: spritzDecode,
});

// ---- 自检（node 手动调用；浏览器加载不自动跑） ----
function selfCheck() {
  let fail = 0;
  const te1 = new TextEncoder().encode.bind(new TextEncoder());
  const hex = bytesToHex;
  // 权威向量 1：absorb("ABC") 后 drip 8 字节
  {
    const st = makeSpritz();
    initializeState(st);
    absorb(st, te1("ABC"));
    const got = hex([drip(st), drip(st), drip(st), drip(st), drip(st), drip(st), drip(st), drip(st)]);
    if (got === "779a8e01f9e9cbc0") console.log("PASS 权威向量 key=ABC keystream 8B");
    else { console.log("FAIL 权威向量 key=ABC\n  got      " + got + "\n  expected 779a8e01f9e9cbc0"); fail++; }
  }
  // 权威向量 2：absorb("spam") 后 drip 8 字节
  {
    const st = makeSpritz();
    initializeState(st);
    absorb(st, te1("spam"));
    const got = hex([drip(st), drip(st), drip(st), drip(st), drip(st), drip(st), drip(st), drip(st)]);
    if (got === "f0609a1df143cebf") console.log("PASS 权威向量 key=spam keystream 8B");
    else { console.log("FAIL 权威向量 key=spam\n  got      " + got + "\n  expected f0609a1df143cebf"); fail++; }
  }
  // 确定性 + IV 改变结果
  const ks1 = genKeystream(te1("ABC"), new Uint8Array(0), 16);
  const ks2 = genKeystream(te1("ABC"), new Uint8Array(0), 16);
  if (hex(ks1) === hex(ks2)) console.log("PASS 确定性");
  else { console.log("FAIL 确定性"); fail++; }
  const ksIv = genKeystream(te1("ABC"), te1("xyz"), 16);
  if (hex(ksIv) !== hex(ks1)) console.log("PASS IV 改变密钥流");
  else { console.log("FAIL IV 改变密钥流"); fail++; }
  // 往返（含中文）
  const rt = spritzDecode(spritzEncode("Hello Spritz 你好", { key: "ABC", iv: "iv" }), { key: "ABC", iv: "iv" });
  if (rt === "Hello Spritz 你好") {
    console.log("PASS 往返测试（文本→hex→文本）");
  } else {
    console.log("FAIL 往返测试: " + JSON.stringify(rt));
    fail++;
  }
  console.log(fail === 0 ? "Spritz selfCheck 全部 PASS" : `Spritz selfCheck ${fail} 项 FAIL`);
  return fail === 0;
}

export { genKeystream, makeSpritz, spritzEncode, spritzDecode, selfCheck };
