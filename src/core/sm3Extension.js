// GB/T 32905 SM3 padding and compression; no key or message preimage required.
import { register } from "./registry.js";
import { sm3Compress } from "./hashExt.js";
import { hexToBytes, bytesToHex } from "./bytesIo.js";
const rot = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
export function sm3Padding(length) {
  const len = BigInt(length);
  if (len < 0n || len >= (1n << 61n)) throw new Error("SM3 字节长度须在 [0,2^61) / invalid byte length");
  const size = 64 - Number((len + 8n) % 64n) + 8;
  const pad = new Uint8Array(size); pad[0] = 0x80;
  new DataView(pad.buffer).setBigUint64(size - 8, len * 8n, false);
  return pad;
}
export function extendSM3(digest, originalLength, append) {
  const hash = hexToBytes(String(digest).replace(/\s+/g, ""));
  if (hash.length !== 32) throw new Error("SM3 摘要须为 32 字节 / 32-byte digest required");
  if (!/^\d+$/.test(String(originalLength))) throw new Error("原始总长度须为非负整数字节 / integer byte length required");
  const length = BigInt(originalLength), glue = sm3Padding(length);
  if (!(append instanceof Uint8Array) || append.length > 1024 * 1024) throw new Error("追加数据须为字节，最大 1 MiB / invalid append data");
  const tailPad = sm3Padding(length + BigInt(glue.length + append.length));
  const tail = new Uint8Array(append.length + tailPad.length); tail.set(append); tail.set(tailPad, append.length);
  const view = new DataView(hash.buffer, hash.byteOffset, 32);
  let state = Array.from({ length: 8 }, (_, i) => view.getUint32(i * 4));
  for (let off = 0; off < tail.length; off += 64) {
    const words = new Uint32Array(68), block = new DataView(tail.buffer, off, 64);
    for (let i = 0; i < 16; i++) words[i] = block.getUint32(i * 4);
    for (let i = 16; i < 68; i++) {
      const x = words[i - 16] ^ words[i - 9] ^ rot(words[i - 3], 15);
      words[i] = x ^ rot(x, 15) ^ rot(x, 23) ^ rot(words[i - 13], 7) ^ words[i - 6];
    }
    state = sm3Compress(state, words);
  }
  const suffix = new Uint8Array(glue.length + append.length); suffix.set(glue); suffix.set(append, glue.length);
  return { digest: state.map(v => v.toString(16).padStart(8, "0")).join(""), glue, suffix };
}
register({
  id: "sm3LengthExtension", cat: "crypto", name: "SM3 长度扩展攻击",
  desc: "已知 SM3(secret||message) 与原始总字节数，续算追加数据后的摘要及 glue||append。适用于错误的前缀 MAC，不适用于 HMAC-SM3。",
  io: "text", autoRun: false,
  params: [
    { key: "digest", label: "原始完整 SM3 摘要（64 hex）", type: "text", default: "" },
    { key: "originalLength", label: "原始总字节数（含未知 secret）", type: "text", default: "0" },
    { key: "appendEncoding", label: "主输入追加数据形式", type: "select", default: "text", options: [{ value: "text", label: "UTF-8" }, { value: "hex", label: "Hex" }] },
  ],
  run(text, params = {}) {
    if (!["text", "hex"].includes(params.appendEncoding || "text")) throw new Error("追加编码须为 text / hex");
    const append = params.appendEncoding === "hex" ? hexToBytes(String(text).replace(/\s+/g, "")) : new TextEncoder().encode(text);
    const r = extendSM3(params.digest, params.originalLength, append);
    return { text: `newHash: ${r.digest}\nglue: ${bytesToHex(r.glue)}\nsuffix: ${bytesToHex(r.suffix)}\n原消息后追加 suffix / Append suffix to the original message.\n前提：原始总字节数猜测正确；不适用于 HMAC-SM3 / NOT an HMAC attack.`, files: [{ name: "sm3-extension-suffix.bin", mime: "application/octet-stream", bytes: r.suffix }] };
  },
});
