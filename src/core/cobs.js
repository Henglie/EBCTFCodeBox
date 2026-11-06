export const COBS_MAX_BLOCK = 254;
export const COBS_DELIMITER = 0x00;

function asBytes(input, name) {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) {
    const out = new Uint8Array(input.length);
    for (let i = 0; i < input.length; i++) {
      const b = input[i];
      if (!Number.isInteger(b) || b < 0 || b > 255) {
        throw new Error(name + " 第 " + i + " 项不是 0-255 整数");
      }
      out[i] = b;
    }
    return out;
  }
  throw new Error(name + " 须为 Uint8Array");
}

export function cobsEncode(input) {
  const src = asBytes(input, "cobsEncode input");
  const out = [];
  let codeIndex = 0;
  let code = 1;
  out.push(0);
  for (let i = 0; i < src.length; i++) {
    const b = src[i];
    if (b === 0) {
      out[codeIndex] = code;
      codeIndex = out.length;
      out.push(0);
      code = 1;
      continue;
    }
    out.push(b);
    code++;
    if (code === 0xff) {
      out[codeIndex] = code;
      code = 1;
      if (i + 1 < src.length) {
        codeIndex = out.length;
        out.push(0);
      } else {
        codeIndex = -1;
      }
    }
  }
  if (codeIndex >= 0) out[codeIndex] = code;
  return Uint8Array.from(out);
}

export function cobsDecode(input) {
  let src = asBytes(input, "cobsDecode input");
  if (src.length > 1 && src[src.length - 1] === 0) {
    src = src.subarray(0, src.length - 1);
  }
  if (src.length === 0) throw new Error("COBS 输入为空（缺少块头）");
  const out = [];
  let i = 0;
  while (i < src.length) {
    const headerAt = i;
    const code = src[i++];
    if (code === 0) {
      throw new Error("COBS 块头非法：位置 " + headerAt + " 为 0x00");
    }
    const n = code - 1;
    if (i + n > src.length) {
      throw new Error(
        "COBS 块长度越界：块头 0x" + code.toString(16).padStart(2, "0") +
        " 需要 " + n + " 字节，剩余 " + (src.length - i) + " 字节"
      );
    }
    for (let j = 0; j < n; j++) {
      const b = src[i++];
      if (b === 0) {
        throw new Error("COBS 数据区非法出现 0x00（位置 " + (i - 1) + "）");
      }
      out.push(b);
    }
    if (code !== 0xff && i < src.length) out.push(0);
  }
  return Uint8Array.from(out);
}
