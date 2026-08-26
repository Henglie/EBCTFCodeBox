/*
 * zipCreate.js — 创建 ZIP 压缩包（出题）（cat:'forensic'，P1 批，单向 run）。
 *
 * 解决什么：把一段数据（文本或任意字节）打包成单文件 ZIP，可选内部文件名与
 * 压缩方式（Deflated / Stored）。出 misc 题的收口工具——把 flag 塞进压缩包，
 * 再接「ZIP 伪加密（置位）」（zipRepair 同文件的逆操作 op）做伪加密题，或直接
 * 给出压缩包。
 *
 * 解析路径（手写 ZIP 结构，纯 JS）：
 * - 数据即主输入（text/hex/base64 或 rawBytes 拖文件），`payload` 语义与参考
 *   zip_create.rs 的 `data` 端口一致
 * - 文件名 `filename`（默认 flag.txt，空则回退）；方法 `method`：Stored(0) 直存，
 *   Deflated(8) 用 self 的 fixed-Huffman literal-only raw deflate（RFC1951 BTYPE
 *   =01 固定哈夫曼、全字面量单块，任何标准 inflate 均可解回；核心无现成真实
 *   deflate 压缩器，stored 块 zlib 不合 method8，故自拼固定哈夫曼）
 * - 拼 LFH + CDH + EOCD（字节几何照 `zipRepair.makeStoredZip`），CRC32 复用
 *   `zipRepair.crc32Bytes`；文件名含非 ASCII 时置 UTF-8 标志位 0x0800（同参考
 *   路由 zip crate 对非 ASCII 文件名加 UTF-8 flag）
 * - 输出「报告 + ZIP base64」（对齐 zipRepair / zipPseudoEncrypt 的报告+产物形态）
 *
 * 零外发：纯字节拼装（deflate 亦纯拼，不引外部库）。
 *
 * 回归断言：加载期自检 IIFE（含参考单测 packs_data_into_readable_zip 形态：
 * "flag{zip_it}" 打包成 "secret.txt" Stored → 用独立 `ooxmlMeta.inflateRaw`
 * 解回 "flag{zip_it}"；及 Deflated/默认名/UTF-8 名/空输入/hex 输入）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";
import { crc32Bytes } from "./zipRepair.js";
import { zipEntries, zipReadEntry } from "./ooxmlMeta.js";

// ============ raw deflate：fixed Huffman、全字面量（RFC1951 BTYPE=01） ============
// 逐字节查固定表发码（0-143:8 位 0x30+b；144-255:9 位 0x190+(b-144)），单块，块尾 EOB=256(7 位 0)。
// 位流 LSB-first 写（deflate 规定）。不压缩（无 LZ77 回引），输出体积≈9bit/字节，
// 但结构合法、任意 inflate 可解——满足「出题打包」契约（参考单测只要求能回读）。
function deflateFixedRaw(data) {
  const acc = { bytes: [], bit: 0, n: 0 };
  const write = (val, nBits) => {
    for (let i = 0; i < nBits; i++) {
      acc.bit |= ((val >> i) & 1) << acc.n;
      if (++acc.n === 8) { acc.bytes.push(acc.bit & 0xff); acc.bit = 0; acc.n = 0; }
    }
  };
  // deflate 的 Huffman 码以 MSB-first 传输、位流 LSB-first 逐字节；write 按 val 的 LSB 输入，
  // 故发码前先反转码位（复用 = 码的 MSB 变成第 1 个进位流的位）。
  const rev8 = (v) => { let r = 0; for (let i = 0; i < 8; i++) r = (r << 1) | ((v >> i) & 1); return r; };
  const rev9 = (v) => { let r = 0; for (let i = 0; i < 9; i++) r = (r << 1) | ((v >> i) & 1); return r; };
  write(1, 1); write(1, 1); write(0, 1); // BFINAL=1, BTYPE=01(fixed)：低比特先 → 1,0
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (b <= 143) write(rev8(0x30 + b), 8);
    else write(rev9(0x190 + (b - 144)), 9);
  }
  write(0, 7); // EOB (长度码 256 → 固定表 7 位全 0，反转不变)
  if (acc.n > 0) acc.bytes.push(acc.bit & 0xff); // 冲刷末尾不足一字节的填充位（deflate 需补零到字节边界）
  return Uint8Array.from(acc.bytes);
}

// ============ 单文件 ZIP 拼装 ============

function pushInto(parts, ...bs) { for (const b of bs) parts.push(b & 0xFF); }
function pushU16(parts, v) { pushInto(parts, v & 0xFF, (v >>> 8) & 0xFF); }
function pushU32(parts, v) { pushInto(parts, v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }

/**
 * 生成单条目标文件的 ZIP。
 * @param {Uint8Array} data 打包内容字节
 * @param {string} filename 内部文件名（空/空白 → "flag.txt"）
 * @param {"Deflated"|"Stored"} methodName 压缩方式
 * @returns {{bytes:Uint8Array, method:number, name:string, size:number, compSize:number}}
 */
export function makeZip(data, filename, methodName) {
  const name = (filename && String(filename).trim()) ? String(filename) : "flag.txt";
  const method = methodName === "Stored" ? 0 : 8;
  const nameB = Array.from(name, (c) => c.charCodeAt(0) & 0xff);
  const crc = crc32Bytes(data);
  const comp = (typeof methodName === "string" && methodName === "Stored") ? data : deflateFixedRaw(data);
  const flag = nameB.some((b) => b > 127) ? 0x0800 : 0; // 非 ASCII 文件名 → UTF-8 标志

  const parts = [];
  // LFH
  const lfhOff = parts.length;
  pushInto(parts, 0x50, 0x4B, 0x03, 0x04);
  pushU16(parts, 0x0014); pushU16(parts, flag); pushU16(parts, method);
  pushU16(parts, 0x4800); pushU16(parts, 0x5987); // 时间/日期（任意合法值）
  pushU32(parts, crc); pushU32(parts, comp.length); pushU32(parts, data.length);
  pushU16(parts, nameB.length); pushU16(parts, 0);
  parts.push(...nameB, ...comp);

  // CDH
  const cdOff = parts.length;
  pushInto(parts, 0x50, 0x4B, 0x01, 0x02);
  pushU16(parts, 0x031E); pushU16(parts, 0x0014); // 版本 by/需要
  pushU16(parts, flag); pushU16(parts, method);
  pushU16(parts, 0x4800); pushU16(parts, 0x5987);
  pushU32(parts, crc); pushU32(parts, comp.length); pushU32(parts, data.length);
  pushU16(parts, nameB.length); pushU16(parts, 0); pushU16(parts, 0);
  pushU16(parts, 0); pushU16(parts, 0); pushU32(parts, 0); // 盘/内部/外部属性
  pushU32(parts, lfhOff);
  parts.push(...nameB);

  // EOCD
  const cdSize = parts.length - cdOff;
  pushInto(parts, 0x50, 0x4B, 0x05, 0x06);
  pushU16(parts, 0); pushU16(parts, 0); pushU16(parts, 1); pushU16(parts, 1);
  pushU32(parts, cdSize); pushU32(parts, cdOff);
  pushU16(parts, 0);

  return { bytes: Uint8Array.from(parts), method, name, size: data.length, compSize: comp.length };
}

// ============ base64（浏览器 btoa / node Buffer 兜底） ============
export function bytesToBase64(bytes) {
  if (typeof globalThis.btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
    }
    return globalThis.btoa(s);
  }
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 base64 编码器（btoa/Buffer 均不可用）");
}

// ============ op run ============

function zipCreateRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请在输入区粘贴要打包的内容（UTF-8 文本 / hex / base64），或拖入文件直接打包。";
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { return "输入解析失败：" + (e && e.message ? e.message : String(e)); }

  const z = makeZip(data, pp.filename, pp.method);
  const methodName = z.method === 0 ? "Stored" : "Deflated";
  return [
    `已打包 ${z.size} 字节到「${z.name}」（${methodName}），ZIP 共 ${z.bytes.length} 字节（压缩 ${z.compSize}）。`,
    "",
    "ZIP base64：",
    bytesToBase64(z.bytes),
  ].join("\n");
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出） ============

(() => {
  const enc = (s) => new TextEncoder().encode(s);
  const dec = (u) => new TextDecoder().decode(u);

  // 参考单测形态：flag{zip_it} 打包成 secret.txt（Stored）→ 独立读回 content == 原文
  {
    const z = makeZip(enc("flag{zip_it}"), "secret.txt", "Stored");
    const zr = zipEntries(z.bytes);
    if (!zr || zr.entries.length !== 1 || zr.entries[0].name !== "secret.txt") throw new Error("zipCreate 自检①-条目失败");
    if (zr.entries[0].method !== 0) throw new Error(`zipCreate 自检①-方法应 Stored: ${zr.entries[0].method}`);
    if (dec(zipReadEntry(z.bytes, zr.entries[0])) !== "flag{zip_it}") throw new Error("zipCreate 自检①-内容失真");
  }
  // ② Deflated：method8 + 独立 inflateRaw 解回原文
  {
    const z = makeZip(enc("flag{deflate_zip}"), "out.zip", "Deflated");
    const zr = zipEntries(z.bytes);
    if (!zr || zr.entries.length !== 1 || zr.entries[0].method !== 8) throw new Error("zipCreate 自检②-方法应 Deflated");
    if (dec(zipReadEntry(z.bytes, zr.entries[0])) !== "flag{deflate_zip}") throw new Error("zipCreate 自检②-内容失真");
  }
  // ③ 默认文件名 flag.txt（传空）
  {
    const z = makeZip(enc("x"), "", "Stored");
    if (z.name !== "flag.txt") throw new Error(`zipCreate 自检③应 flag.txt: ${z.name}`);
  }
  // ④ 非 ASCII 文件名 → UTF-8 标志位 0x0800（LFH flag@+6）
  {
    const z = makeZip(enc("x"), "谜题.txt", "Stored");
    const flag = (z.bytes[6] | (z.bytes[7] << 8)) & 0xffff;
    if ((flag & 0x0800) === 0) throw new Error("zipCreate 自检④应置 UTF-8 标志");
  }
  // ⑤ 空输入提示
  {
    const out = zipCreateRun("", {});
    if (!out.includes("空输入")) throw new Error("zipCreate 自检⑤-空输入失败");
  }
  // ⑥ hex 输入路径：把 "AB" 字节打包再解回
  {
    const out = zipCreateRun("4142", { filename: "bin.dat", method: "Deflated", inputEnc: "hex" });
    if (!out.includes("2 字节到「bin.dat」（Deflated）")) throw new Error(`zipCreate 自检⑥失败: ${out}`);
    const b64 = out.split("\n").pop();
    const zip = typeof Buffer !== "undefined" ? Uint8Array.from(Buffer.from(b64, "base64")) : null;
    if (zip) {
      const zr = zipEntries(zip);
      const content = zipReadEntry(zip, zr.entries[0]);
      if (content.length !== 2 || content[0] !== 0x41 || content[1] !== 0x42) throw new Error("zipCreate 自检⑥-内容失真");
    }
  }
  // ⑦ 默认参数（node 直跑）：makeZip Deflated 空内容也能出合法 ZIP（仅校验拼装不炸）
  {
    const z = makeZip(new Uint8Array(0), "empty.bin", "Deflated");
    const zr = zipEntries(z.bytes);
    if (!zr || zr.entries[0].name !== "empty.bin") throw new Error("zipCreate 自检⑦失败");
  }
})();

// ============ register ============

register({
  id: "zipCreate", cat: "forensic", name: "ZIP 创建（出题）",
  desc: "把一段数据（文本/任意字节）打包成单文件 ZIP，可选内部文件名与压缩方式（Deflated/Stored）；出 misc 题常接 ZIP 伪加密（置位）做伪加密题",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "filename", label: "内部文件名", type: "text", default: "flag.txt" },
    { key: "method", label: "压缩方式", type: "select", default: "Deflated",
      options: [
        { value: "Deflated", label: "Deflated（压缩）" },
        { value: "Stored", label: "Stored（不压缩）" },
      ],
    },
  ],
  run: zipCreateRun,
  acceptsBytes: true,
});

export { zipCreateRun };