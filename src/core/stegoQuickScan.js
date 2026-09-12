import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";
import { productFileEntries } from "./productResult.js";
import { pngCheckSig, gifCheckSig, readU16be, readU16le, readU32be, latin1, hex } from "./stegoImage2.js";

// Structural scan only: no pixel decoding, decompression, interpreters or password search.
export function stegoQuickScan(text, p = {}) {
  if (!p.rawBytes && String(text).length > 24 * 1024 * 1024) throw new Error("扫描输入超限（8MiB字节）");
  if (p.rawBytes?.length > 8 * 1024 * 1024) throw new Error("扫描输入超限（8MiB字节）");
  const b = p.rawBytes === undefined ? inputToBytes(text, p) : productFileEntries({ files: [{ bytes: p.rawBytes }] })[0].bytes;
  if (b.length > 8 * 1024 * 1024) throw new Error("扫描输入超限（8MiB字节）");
  const format = pngCheckSig(b) ? "PNG" : gifCheckSig(b) ? "GIF" : b[0] === 255 && b[1] === 216 ? "JPEG" : "";
  if (!format) throw new Error("快速扫描仅支持 PNG/JPEG/GIF");
  const lines = [`${format} 快速结构扫描 · ${b.length} B`];
  let pos = 0, count = 0, end = -1;
  const check = (size = 0) => {
    if (++count > 4096) throw new Error("结构块超过4096，扫描中止；不代表文件损坏");
    if (pos + size > b.length) throw new Error(`结构截断 @${pos}`);
  };
  const metadata = (name, data) => {
    if (lines.length < 40) lines.push(`${name}: ${latin1(data.subarray(0, 96)).replace(/[\x00-\x1f\x7f]/g, ".")}${data.length > 96 ? " [preview truncated]" : ""}`);
  };
  try {
    if (format === "PNG") {
      pos = 8;
      while (pos < b.length) {
        check(12);
        const len = readU32be(b, pos), name = latin1(b.subarray(pos + 4, pos + 8));
        if (pos + 12 + len > b.length) throw new Error(`PNG ${name} 截断`);
        if (count === 1 && (name !== "IHDR" || len !== 13)) throw new Error("PNG 缺少合法首块 IHDR");
        if (name === "IHDR") lines.push(`${readU32be(b, pos + 8)}×${readU32be(b, pos + 12)} · depth=${b[pos + 16]} · color=${b[pos + 17]}`);
        if (["tEXt", "iTXt", "zTXt", "iCCP", "eXIf"].includes(name)) metadata(name + (["zTXt", "iCCP"].includes(name) ? " (compressed, not inflated)" : ""), b.subarray(pos + 8, pos + 8 + len));
        pos += 12 + len;
        if (name === "IEND") { if (len) throw new Error("PNG IEND 长度非法"); end = pos; break; }
      }
    } else if (format === "JPEG") {
      pos = 2;
      let entropy = false;
      while (pos < b.length) {
        if (entropy) { while (pos < b.length && b[pos] !== 255) pos++; if (pos >= b.length) break; }
        check(2);
        if (b[pos++] !== 255) throw new Error("JPEG marker 错乱");
        while (pos < b.length && b[pos] === 255) pos++;
        if (pos >= b.length) throw new Error("JPEG marker 截断");
        const marker = b[pos++];
        if (entropy && (marker === 0 || (marker >= 208 && marker <= 215))) continue;
        entropy = false;
        if (marker === 217) { end = pos; break; }
        if (marker === 1) continue;
        if (marker === 0 || marker === 216) throw new Error("JPEG marker 非法");
        if (pos + 2 > b.length) throw new Error("JPEG 段长度截断");
        const len = readU16be(b, pos);
        if (len < 2 || pos + len > b.length) throw new Error("JPEG 段截断");
        if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker) && len >= 8) lines.push(`${readU16be(b, pos + 5)}×${readU16be(b, pos + 3)} · SOF ${marker.toString(16)}`);
        if (marker === 254 || (marker >= 224 && marker <= 239)) metadata(marker === 254 ? "COM" : `APP${marker - 224}`, b.subarray(pos + 2, pos + len));
        pos += len;
        entropy = marker === 218;
      }
    } else {
      pos = 0; check(13);
      lines.push(`${readU16le(b, 6)}×${readU16le(b, 8)}`);
      pos = 13 + (b[10] & 128 ? 3 * (2 << (b[10] & 7)) : 0);
      let frames = 0;
      while (pos < b.length) {
        check(1);
        const tag = b[pos++];
        if (tag === 59) { end = pos; break; }
        let label = "";
        if (tag === 33) { check(1); const kind = b[pos++]; label = kind === 254 ? "Comment" : kind === 255 ? "Application" : ""; }
        else if (tag === 44) {
          check(9); frames++;
          const packed = b[pos + 8]; pos += 9;
          pos += packed & 128 ? 3 * (2 << (packed & 7)) : 0;
          check(1); pos++;
        } else throw new Error("GIF 块标记异常");
        for (;;) {
          check(1); const len = b[pos++];
          if (!len) break;
          check(len);
          if (label) { metadata(label, b.subarray(pos, pos + len)); label = ""; }
          pos += len;
        }
      }
      lines.push(`Image descriptors: ${frames} (not decoded)`);
    }
    if (end < 0) throw new Error("未找到结束标记，结构不完整");
    lines.push(`Structure: reached end marker · blocks/steps=${count}`);
    const tail = b.subarray(end);
    lines.push(`Trailing bytes: ${tail.length}`);
    if (tail.length) lines.push(`Preview (first ${Math.min(tail.length, 256)} B): ${hex(tail, 256)}`);
  } catch (e) { lines.push("FAILED/ABORTED: " + e.message); }
  lines.push("仅检查结构、元数据及尾随；未解压、未校验像素或全部校验和。LSB、位平面、密码、脚本与本地桥未执行。未检出不等于无隐写。");
  return lines.join("\n");
}

register({ id: "stegoQuickScan", cat: "stego", name: "图片隐写快速分析", desc: "PNG/JPEG/GIF 结构、元数据与尾随聚合；8MiB/4096步上限，不执行重度扫描", acceptsBytes: true, noAuto: true,
  params: [{ key: "inputEnc", label: "输入编码", type: "select", default: "base64", options: [{ value: "base64", label: "Base64" }, { value: "hex", label: "Hex" }] }], run: stegoQuickScan });
