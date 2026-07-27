/*
 * fenham.js — Fenham 密码（cat:'classic'）。
 *
 * 算法链路（fenhamencdoe/fenhamdecdoe）:
 * 1. Check_List: A-Z → 7 位二进制（即 ASCII 码 65-90 的 7 位表示）
 * 2. encode: txt 每字符转 7 位二进制，key 每字符转 7 位二进制，逐位 XOR（相同=0，不同=1），输出二进制串
 * 3. decode: txt 每 7 位一组，每组 XOR key 对应字符 ASCII，得明文字符
 *
 * 健壮性增强:
 * - key 循环使用（原算法要求 key 与 txt 等长，循环 key 更实用且往返可逆）
 * - 非 A-Z 字符抛错（Check_List 不含）
 *
 * 纯前端零外发。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 * params: [{id:"key", label:"字母密钥", type:"text"}]
 * encode(text, {key}) → 二进制串
 * decode(text, {key}) → 明文字符串
 */
import { register } from "./registry.js";

// ============================================================
// Check_List: A-Z → 7 位二进制
// 即 A=65=1000001, B=66=1000010, ... Z=90=1011010
// ============================================================
const CHECK_LIST = {
  A: "1000001", B: "1000010", C: "1000011", D: "1000100", E: "1000101",
  F: "1000110", G: "1000111", H: "1001000", I: "1001001", J: "1001010",
  K: "1001011", L: "1001100", M: "1001101", N: "1001110", O: "1001111",
  P: "1010000", Q: "1010001", R: "1010010", S: "1010011", T: "1010100",
  U: "1010101", V: "1010110", W: "1010111", X: "1011000", Y: "1011001",
  Z: "1011010",
};

// 反向表：7 位二进制 → 字母（decode 用）
const CHECK_LIST_REV = {};
for (const [ch, bin] of Object.entries(CHECK_LIST)) CHECK_LIST_REV[bin] = ch;

// ============================================================
// 加密（fenhamencdoe）
// ============================================================
function fenhamEncrypt(text, params = {}) {
  const key = params.key != null ? params.key : params;
  if (!key) throw new Error("Fenham 密钥不能为空");
 // txt 每字符转 7 位二进制（Check_List[ch.upper]）
  const txtBins = [];
  for (const ch of text) {
    const up = ch.toUpperCase();
    if (!CHECK_LIST[up]) throw new Error(`Fenham 仅支持 A-Z 字母，遇到非法字符: "${ch}"`);
    txtBins.push(CHECK_LIST[up]);
  }
 // key 循环使用（原算法要求等长，循环更健壮且往返可逆）
  const keyUp = key.toUpperCase();
  for (const ch of keyUp) {
    if (!CHECK_LIST[ch]) throw new Error(`Fenham 密钥仅支持 A-Z 字母，遇到非法字符: "${ch}"`);
  }
 // 逐位 XOR（相同=0，不同=1）
  let finish = "";
  for (let i = 0; i < txtBins.length; i++) {
    const txtBin = txtBins[i];
    const keyBin = CHECK_LIST[keyUp[i % keyUp.length]];
    for (let x = 0; x < 7; x++) {
      finish += txtBin[x] === keyBin[x] ? "0" : "1";
    }
  }
  return finish;
}

// ============================================================
// 解密（fenhamdecdoe）
// ============================================================
function fenhamDecrypt(text, params = {}) {
  const key = params.key != null ? params.key : params;
  if (!key) throw new Error("Fenham 密钥不能为空");
 // 密文必须是纯 0/1 串，长度为 7 的整数倍
  const clean = text.replace(/\s/g, "");
  if (!/^[01]*$/.test(clean)) throw new Error("Fenham 密文必须是纯二进制串（0/1）");
  if (clean.length % 7 !== 0) throw new Error("Fenham 密文长度必须是 7 的整数倍");
 // 每 7 位一组
  const mi = [];
  for (let i = 0; i < clean.length; i += 7) mi.push(clean.slice(i, i + 7));
 // key 循环（原算法 zip(mi, key) 会截断 key 不足的，循环更健壮）
  const keyUp = key.toUpperCase();
  for (const ch of keyUp) {
    if (!CHECK_LIST[ch]) throw new Error(`Fenham 密钥仅支持 A-Z 字母，遇到非法字符: "${ch}"`);
  }
 // 每组 XOR key 对应字符 ASCII，得明文字符
  let fruit = "";
  for (let m = 0; m < mi.length; m++) {
    const keyBin = CHECK_LIST[keyUp[m % keyUp.length]];
 // XOR 后的 7 位二进制 → 字母
    let xorBin = "";
    for (let x = 0; x < 7; x++) {
      xorBin += mi[m][x] === keyBin[x] ? "0" : "1";
    }
    const ch = CHECK_LIST_REV[xorBin];
    if (!ch) throw new Error(`Fenham 解密结果非 A-Z 字母: 二进制 ${xorBin}`);
    fruit += ch;
  }
  return fruit;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "fenham",
  cat: "classic",
  name: "Fenham 密码",
  desc: "A-Z 字母转 7 位 ASCII 二进制，与密钥逐位 XOR（二进制输出）",
  params: [{ id: "key", label: "字母密钥", type: "text" }],
  encode: fenhamEncrypt,
  decode: fenhamDecrypt,
});

export { fenhamEncrypt, fenhamDecrypt, CHECK_LIST, CHECK_LIST_REV };
