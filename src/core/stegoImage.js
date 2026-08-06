// stegoImage.src.js — 图像隐写组
// 纯算法层：不依赖 Canvas API，操作 Uint8ClampedArray/Uint8Array 像素数据。
// UI 层负责 canvas.getImageData/putImageData 转换。
//
// 算法来源：
// lsbImage —— 通用 LSB 像素隐写（标准实现，参考 Steganography Wikipedia）
// pixelJihad —— res/html/PixelJihad/main.js（Owen Campbell-Moore, MIT）
// SHA-256 hash 种子 + 伪随机位置 LSB + 跳过 alpha 通道。
// sjcl.js 移到 src/core/lib/sjcl.js（本地，不引 CDN）。
// arnoldCat —— Arnold 猫脸变换（纯数学置乱，N×N 矩阵周期性置换）。
// imageBasic —— 图像基础操作（反色/翻转/改高度/RGB 通道分离/位平面提取）。
//
// 契约：
// encode(imageData: { width, height, data: Uint8ClampedArray }, text, params) → imageData
// decode(imageData, params) → text
// run(imageData, params) → imageData（单向变换）
// 注意：为兼容 registry 的 (text, p) 签名，图像类 op 的 text 参数实际是 base64 dataURL
// UI 层在 app.js 里特殊处理（文件上传 → dataURL → canvas → imageData → 调 op → 输出 dataURL）。
import { register } from "./registry.js";
import { dataURLToBytes, decodePNG, rgbaToDataURL } from "./stegoPixels.js";

// ============ lsbImage：通用 LSB 像素隐写 ============
// 每 channel 最低位藏 1 bit，前 32 bit 存消息字节长度（big-endian）
// 后续按 1 byte = 8 bit 顺序藏入。支持通道掩码（R/G/B/A 选哪些藏）。
const LSB_HEADER_BITS = 32; // 前 32 位 = 消息长度

function lsbImageEncode(imageData, text, p = {}) {
  const channels = p.channels || "RGB"; // 默认藏 RGB，跳过 A
  const chanMask = _lsbChannelMask(channels);
  const data = imageData.data;
  const bytes = new TextEncoder().encode(text);
  const totalBits = LSB_HEADER_BITS + bytes.length * 8;
  const capacity = Math.floor(data.length / 4) * chanMask.length;
  if (totalBits > capacity) {
    throw new Error(`消息过大：需要 ${totalBits} 位，容量 ${capacity} 位`);
  }
 // 构造 bit 流：32 位长度 + 消息字节
  const bits = new Uint8Array(totalBits);
 // 长度 big-endian 32 位
  const len = bytes.length;
  for (let i = 0; i < 32; i++) {
    bits[i] = (len >> (31 - i)) & 1;
  }
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 0; b < 8; b++) {
      bits[32 + i * 8 + b] = (bytes[i] >> (7 - b)) & 1;
    }
  }
 // 写入 LSB
  let bitIdx = 0;
  for (let px = 0; px < data.length && bitIdx < bits.length; px += 4) {
    for (const c of chanMask) {
      if (bitIdx >= bits.length) break;
      data[px + c] = (data[px + c] & 0xFE) | bits[bitIdx++];
    }
  }
  return imageData;
}

function lsbImageDecode(imageData, p = {}) {
  const channels = p.channels || "RGB";
  const chanMask = _lsbChannelMask(channels);
  const data = imageData.data;
 // 读 32 位长度
  let len = 0;
  let bitIdx = 0;
  for (let px = 0; px < data.length && bitIdx < 32; px += 4) {
    for (const c of chanMask) {
      if (bitIdx >= 32) break;
      len = (len << 1) | (data[px + c] & 1);
      bitIdx++;
    }
  }
  len >>>= 0; // 32 位无符号化：最高位为 1 时避免负长度绕过下面的上限检查
  if (len === 0 || len > Math.floor(data.length / 4) * chanMask.length / 8) {
    return ""; // 无消息或损坏
  }
 // 读消息字节
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) {
 // 找下一个 bit 位置
      const globalBit = 32 + i * 8 + j;
 // 重新计算 px/c（避免 bitIdx 漂移）
      const pxIdx = Math.floor(globalBit / chanMask.length) * 4;
      const cIdx = chanMask[globalBit % chanMask.length];
      b = (b << 1) | (data[pxIdx + cIdx] & 1);
    }
    bytes[i] = b;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function _lsbChannelMask(channels) {
  const map = { R: 0, G: 1, B: 2, A: 3 };
  const arr = [...channels.toUpperCase()].map((c) => map[c]).filter((c) => c !== undefined);
  return arr.length ? arr : [0, 1, 2];
}

// ============ pixelJihad：照抄 res/html/PixelJihad/main.js ============
// 算法核心：SHA-256(password) 作为 hash 种子，getNextLocation 伪随机选位
// 每 charCode 16 位编码，跳过 alpha 通道（% 4 === 0 的位置）。
// SJCL 库移到 src/core/lib/sjcl.js（本地），此处假设全局 window.sjcl 可用。
// 注意：原源 message 是 UTF-16 charCode（不是 UTF-8 字节），本卡照抄保持兼容。

const PJ_MAX_MESSAGE_SIZE = 1000;

function pjGetBit(number, location) {
  return (number >> location) & 1;
}

function pjSetBit(number, location, bit) {
  return (number & ~(1 << location)) | (bit << location);
}

function pjGetBitsFromNumber(number) {
  const bits = [];
  for (let i = 0; i < 16; i++) bits.push(pjGetBit(number, i));
  return bits;
}

function pjGetNumberFromBits(bytes, history, hash) {
  let number = 0, pos = 0;
  while (pos < 16) {
    const loc = pjGetNextLocation(history, hash, bytes.length);
    const bit = pjGetBit(bytes[loc], 0);
    number = pjSetBit(number, pos, bit);
    pos++;
  }
  return number;
}

function pjGetMessageBits(message) {
  let bits = [];
  for (let i = 0; i < message.length; i++) {
    const code = message.charCodeAt(i);
    bits = bits.concat(pjGetBitsFromNumber(code));
  }
  return bits;
}

function pjGetNextLocation(history, hash, total) {
  const pos = history.length;
  let loc = Math.abs(hash[pos % hash.length] * (pos + 1)) % total;
 // 容量护栏：可用位置耗尽（小图/已填满）时不能无限找，最多探测 total 次即抛错。
  let tries = 0;
  while (tries++ <= total) {
    if (loc >= total) {
      loc = 0;
    } else if (history.indexOf(loc) >= 0) {
      loc++;
    } else if ((loc + 1) % 4 === 0) {
 // 跳过 alpha 通道
      loc++;
    } else {
      history.push(loc);
      return loc;
    }
  }
  throw new Error("Pixel Jihad：图像容量不足，无可用像素位置");
}

function pjEncodeMessage(colors, hash, message) {
  let messageBits = pjGetBitsFromNumber(message.length);
  messageBits = messageBits.concat(pjGetMessageBits(message));
  const history = [];
  let pos = 0;
  while (pos < messageBits.length) {
    const loc = pjGetNextLocation(history, hash, colors.length);
    colors[loc] = pjSetBit(colors[loc], 0, messageBits[pos]);
 // alpha 设 255（premultiplied alpha 规避）
    let cur = loc;
    while ((cur + 1) % 4 !== 0) cur++;
    colors[cur] = 255;
    pos++;
  }
}

function pjDecodeMessage(colors, hash) {
  const history = [];
  const messageSize = pjGetNumberFromBits(colors, history, hash);
  if ((messageSize + 1) * 16 > colors.length * 0.75) return "";
  if (messageSize === 0 || messageSize > PJ_MAX_MESSAGE_SIZE) return "";
  const message = [];
  for (let i = 0; i < messageSize; i++) {
    const code = pjGetNumberFromBits(colors, history, hash);
    message.push(String.fromCharCode(code));
  }
  return message.join("");
}

// pixelJihad 对外：需要 sjcl 做 SHA-256 + AES-CCM 加密
// 如果无密码：消息包成 JSON {"text": message}
// 如果有密码：sjcl.encrypt(password, message) 返回 JSON 串（含 ct/iv/salt/adata）
function pixelJihadEncode(imageData, text, p = {}) {
  const password = p.password || "";
  const sjcl = (typeof window !== "undefined" && window.sjcl) || (typeof globalThis !== "undefined" && globalThis.sjcl);
  if (!sjcl || !sjcl.hash || !sjcl.hash.sha256) {
    throw new Error("pixelJihad 需要 sjcl.js（src/core/lib/sjcl.js），未检测到 window.sjcl");
  }
  let message;
  if (password.length > 0) {
    message = sjcl.encrypt(password, text);
  } else {
    message = JSON.stringify({ text });
  }
  const pixelCount = imageData.width * imageData.height;
  if ((message.length + 1) * 16 > pixelCount * 4 * 0.75) {
    throw new Error("消息对图像过大");
  }
  if (message.length > PJ_MAX_MESSAGE_SIZE) {
    throw new Error("消息超过上限 " + PJ_MAX_MESSAGE_SIZE);
  }
  const hash = sjcl.hash.sha256.hash(password);
  pjEncodeMessage(imageData.data, hash, message);
  return imageData;
}

function pixelJihadDecode(imageData, p = {}) {
  const password = p.password || "";
  const sjcl = (typeof window !== "undefined" && window.sjcl) || (typeof globalThis !== "undefined" && globalThis.sjcl);
  if (!sjcl || !sjcl.hash || !sjcl.hash.sha256) {
    throw new Error("pixelJihad 需要 sjcl.js（src/core/lib/sjcl.js），未检测到 window.sjcl");
  }
  const hash = sjcl.hash.sha256.hash(password);
  let message;
  try {
    message = pjDecodeMessage(imageData.data, hash);
  } catch (e) {
 // 图太小/可用位置耗尽 → pjGetNextLocation 抛错，视作无隐藏消息
    return "";
  }
  if (!message) return "";
  let obj = null;
  try { obj = JSON.parse(message); } catch (e) { return ""; }
  if (!obj) return "";
  if (obj.ct) {
    try { return sjcl.decrypt(password, message); } catch (e) { return ""; }
  }
  return obj.text || "";
}

// ============ arnoldCat：Arnold 猫脸变换置乱 ============
// 经典 Arnold 变换：N×N 图像，每像素 (x,y) → ((x+y) mod N, (x+2y) mod N)
// 周期 T 后回到原图。encode 跑 iterations 次正向，decode 跑 T-iterations 次（或反向）。
// 为简化：encode 跑 n 次，decode 跑 period-n 次（需先算 period）。
// 仅支持正方形图像（width===height），非方形抛错。

function arnoldCatTransform(imageData, p = {}) {
  const n = imageData.width;
  if (n !== imageData.height) {
    throw new Error("Arnold 变换需要正方形图像（当前 " + imageData.width + "x" + imageData.height + "）");
  }
  const iterations = Math.max(1, Number(p.iterations) || 1);
  const decode = !!p.decode;
  const a = Number(p.a) || 1;
  const b = Number(p.b) || 1;
  const data = imageData.data;
 // 复制源数据
  const src = new Uint8ClampedArray(data);
 // 通用 Arnold 矩阵 [[1,a],[b,ab+1]]（det=1 可逆）。a=b=1 时退化为标准版。
 // 正向：新坐标 = M·(x,y)；反向 = M⁻¹·(x,y)。
 // 与参考实现（参数化猫脸变换）一致：正向 nx=(x+a*y)%N、ny=(b*x+(ab+1)*y)%N，
 // 反向 nx=((ab+1)*x-a*y)%N、ny=(y-b*x)%N。像素写入方向 dst[(ny,nx)] = src[(y,x)]。
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let nx, ny;
        if (decode) {
          nx = (((a * b + 1) * x - a * y) % n + n) % n;
          ny = ((y - b * x) % n + n) % n;
        } else {
          nx = ((x + a * y) % n + n) % n;
          ny = ((b * x + (a * b + 1) * y) % n + n) % n;
        }
        const srcIdx = (y * n + x) * 4;
        const dstIdx = (ny * n + nx) * 4;
        data[dstIdx] = src[srcIdx];
        data[dstIdx + 1] = src[srcIdx + 1];
        data[dstIdx + 2] = src[srcIdx + 2];
        data[dstIdx + 3] = src[srcIdx + 3];
      }
    }
 // 下次迭代基于本次结果
    src.set(data);
  }
  return imageData;
}

// ============ imageBasic：图像基础操作 ============
// 单向变换（run），非双向。params.op 选择具体操作。

function imageBasicTransform(imageData, p = {}) {
  const op = p.op || "invert";
  const data = imageData.data;
  switch (op) {
    case "invert": {
 // 反色（RGB，alpha 不变）
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      break;
    }
    case "flipH": {
 // 水平翻转
      const w = imageData.width, h = imageData.height;
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < Math.floor(w / 2); x++) {
          const a = (y * w + x) * 4;
          const b = (y * w + (w - 1 - x)) * 4;
          for (let c = 0; c < 4; c++) {
            const t = data[a + c]; data[a + c] = data[b + c]; data[b + c] = t;
          }
        }
      }
      break;
    }
    case "flipV": {
 // 垂直翻转
      const w = imageData.width, h = imageData.height;
      for (let y = 0; y < Math.floor(h / 2); y++) {
        for (let x = 0; x < w; x++) {
          const a = (y * w + x) * 4;
          const b = ((h - 1 - y) * w + x) * 4;
          for (let c = 0; c < 4; c++) {
            const t = data[a + c]; data[a + c] = data[b + c]; data[b + c] = t;
          }
        }
      }
      break;
    }
    case "channelR": {
 // 只保留 R 通道
      for (let i = 0; i < data.length; i += 4) {
        data[i + 1] = 0; data[i + 2] = 0;
      }
      break;
    }
    case "channelG": {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0; data[i + 2] = 0;
      }
      break;
    }
    case "channelB": {
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 0; data[i + 1] = 0;
      }
      break;
    }
    case "bitplane": {
 // 位平面提取：提取 R 通道的第 bit 位（0-7），放大到 0/255
      const bit = Math.max(0, Math.min(7, Number(p.bit) || 0));
      const channel = Math.max(0, Math.min(2, Number(p.channel) || 0));
      for (let i = 0; i < data.length; i += 4) {
        const v = (data[i + channel] >> bit) & 1;
        data[i] = data[i + 1] = data[i + 2] = v * 255;
      }
      break;
    }
    default:
      throw new Error("未知 imageBasic 操作: " + op);
  }
  return imageData;
}

// ============ 辅助：dataURL ↔ imageData（浏览器 Canvas） ============
// 在 node 测试环境无 canvas，这些函数会抛错；浏览器 UI 层使用。
async function dataURLToImageData(dataURL) {
  if (typeof document === "undefined") {
    throw new Error("dataURLToImageData 需要浏览器环境（document/canvas）");
  }
  const img = new Image();
  img.src = dataURL;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, img.width, img.height);
}

function imageDataToDataURL(imageData, type = "image/png") {
  if (typeof document === "undefined") {
    throw new Error("imageDataToDataURL 需要浏览器环境（document/canvas）");
  }
  const canvas = document.createElement("canvas");
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext("2d");
 // putImageData 只吃真正的 ImageData 实例；bitplaneSlicing/imageDiff 产出的是
 // 普通对象 {width,height,data}，先复制进一块真 ImageData 再写入。
  let id = imageData;
  const isReal = typeof ImageData !== "undefined" && imageData instanceof ImageData;
  if (!isReal) {
    id = ctx.createImageData(imageData.width, imageData.height);
    id.data.set(imageData.data);
  }
  ctx.putImageData(id, 0, 0);
  return canvas.toDataURL(type);
}

// ============ 适配层：拖入的图片字节 → RGBA ImageData（浏览器 Canvas） ============
// acceptsBytes 约定：UI 把拖入文件的原始字节放进 p.rawBytes（Uint8Array），文件名放
// p.rawFileName，不再转 hex 灌进输入框。像素类算法要的是逐像素 RGBA ImageData，故此处
// 用 createImageBitmap 把字节解成位图、画到 canvas 后 getImageData 取真 RGBA（4 字节/像素，
// 通吃 PNG/JPG/BMP/GIF）。不填白底，尽量保留原像素——LSB/位平面提取依赖像素低位不被改动。
// 注意：半透明像素经 canvas 往返可能因预乘 alpha 有取整误差；隐写题多为不透明图，无碍。
async function _decodeImageToImageData(bytes) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("图像解码需要浏览器环境（createImageBitmap/canvas 不可用）");
  }
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bmp;
  try {
    bmp = await createImageBitmap(new Blob([u8]));
  } catch (e) {
    throw new Error("无法解码图片：格式不支持或文件损坏（支持 PNG/JPG/BMP/GIF）");
  }
  const w = bmp.width, h = bmp.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  if (bmp.close) bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

// 取图片字节：优先拖入的 rawBytes，其次把粘贴的 base64 / dataURL / hex 文本转字节。
function _imageInputBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text == null ? "" : text).trim();
  if (!s) return new Uint8Array(0);
  const hex = s.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length >= 8) {
    const out = new Uint8Array(hex.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
 // 粘贴文本非 hex → 当 base64/dataURL 试解；解不动就返回空，交由调用方给出「请拖入图片」提示。
  try {
    return _b64ToBytes(s);
  } catch (e) {
    return new Uint8Array(0);
  }
}

// 取输入图片 → RGBA ImageData。无字节（既没拖文件也没粘贴 base64）时给清晰中文提示，
// 不静默返回垃圾。像素类 op 的统一入口。
async function _inputImageData(text, p) {
  const bytes = _imageInputBytes(text, p);
  if (!bytes || !bytes.length) {
    throw new Error("请拖入或粘贴图片文件（支持 PNG/JPG/BMP/GIF）");
  }
  return _decodeImageToImageData(bytes);
}

// ============ (text, p) 适配层：把像素类算法接上 UI 的 acceptsBytes 管线 ============
// 约定：输入图片经拖入（p.rawBytes）或粘贴 base64/dataURL（text）进来；编码方向要隐藏
// 的文本从「待隐藏文本」参数（p.message）取——单输入框放不下「图片 + 文本」两份料，故
// 文本走参数栏。产图的 op 输出 PNG dataURL（UI 渲染成图），产文本的 op 直接返回字符串。
// 下列函数只做取字节→解像素→调原算法→包输出的搬运，算法本身（lsbMulti/pixelJihad/
// arnoldCat/imageBasic/bitplaneSlicing/imageDiff）一行不改。

async function lsbImageEncodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  const msg = p && p.message != null ? String(p.message) : "";
  if (!msg) throw new Error("请在「待隐藏文本」参数中填入要隐藏的内容");
  return imageDataToDataURL(lsbMultiEncode(imageData, msg, p));
}
async function lsbImageDecodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return lsbMultiDecode(imageData, p);
}

async function pixelJihadEncodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  const msg = p && p.message != null ? String(p.message) : "";
  if (!msg) throw new Error("请在「待隐藏文本」参数中填入要隐藏的内容");
  return imageDataToDataURL(pixelJihadEncode(imageData, msg, p));
}
async function pixelJihadDecodeOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return pixelJihadDecode(imageData, p);
}

async function arnoldCatOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return imageDataToDataURL(arnoldCatTransform(imageData, p));
}

async function imageBasicOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return imageDataToDataURL(imageBasicTransform(imageData, p));
}

async function bitplaneSlicingOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  return imageDataToDataURL(bitplaneSlicingTransform(imageData, p));
}

async function imageDiffOp(text, p = {}) {
  const imageData = await _inputImageData(text, p);
  const img2src = p && p.image2 ? String(p.image2).trim() : "";
  if (!img2src) throw new Error("请在「第二张图」参数中粘贴第二张图片的 base64/dataURL");
  let bytes2;
  try { bytes2 = _b64ToBytes(img2src); } catch (e) { bytes2 = new Uint8Array(0); }
  if (!bytes2.length) throw new Error("第二张图解析失败：请粘贴有效的 base64/dataURL");
  const image2 = await _decodeImageToImageData(bytes2);
  return imageDataToDataURL(imageDiffTransform(imageData, { ...p, image2 }));
}

// ============ register（图像类 op 特殊：text 实际是 dataURL，UI 层适配） ============
// 注意：图像 op 不走 registry 的标准 (text, p) 签名，UI 层 app.js 需特殊处理
// （文件上传 → canvas → imageData → 调 op → 输出 dataURL）。
// 这里注册主要是让 op 出现在分类树 + i18n key 有对应。
// C7-P12 合并：lsbImage 吸收 lsbMulti（bitDepth=1 时 lsbMulti 与 lsbImage 产出 bit-identical
// 已逐位核实）。改用 lsbMulti 的 encode/decode（depth 1 走同一 0xFE LSB 路径），加 bitDepth
// 参数（默认 1 = 原 lsbImage 行为）+ A 通道选项。lsbImageEncode/Decode 函数保留供测试/复用。
register({
  id: "lsbImage", cat: "stego", name: "LSB 像素隐写",
  desc: "最低有效位像素隐写（前 32 位存长度，支持 R/G/B/A 通道选择，多位深 1-3 位/通道）",
  params: [
    { key: "channels", label: "通道", type: "select", default: "RGB",
      options: [
        { value: "RGB", label: "RGB（默认，跳过 alpha）" },
        { value: "RGBA", label: "RGBA（含 alpha，容量翻倍）" },
        { value: "R", label: "仅 R 通道" },
        { value: "G", label: "仅 G 通道" },
        { value: "B", label: "仅 B 通道" },
        { value: "A", label: "仅 A（alpha）" },
      ],
    },
    { key: "bitDepth", label: "位深", type: "select", default: 1,
      options: [
        { value: 1, label: "1 位（LSB，最隐蔽）" },
        { value: 2, label: "2 位（容量翻倍）" },
        { value: 3, label: "3 位（容量 3 倍）" },
      ],
    },
    { key: "message", label: "待隐藏文本", type: "text", default: "", placeholder: "编码方向要藏进图片的文本" },
  ],
  encode: lsbImageEncodeOp, decode: lsbImageDecodeOp,
  acceptsBytes: true,
});

register({
  id: "pixelJihad", cat: "stego", name: "PixelJihad",
  desc: "PixelJihad 隐写（SHA-256 种子 + 伪随机 LSB + 可选 AES-CCM 加密）",
  params: [
    { key: "password", label: "密码", type: "text", default: "", placeholder: "可选密码（空则不加密）" },
    { key: "message", label: "待隐藏文本", type: "text", default: "", placeholder: "编码方向要藏进图片的文本" },
  ],
  encode: pixelJihadEncodeOp, decode: pixelJihadDecodeOp,
  acceptsBytes: true,
});

register({
  id: "arnoldCat", cat: "stego", name: "Arnold 猫脸变换",
  desc: "Arnold 猫脸变换置乱（正方形图像，参数化矩阵 [[1,a],[b,ab+1]]，a=b=1 为标准版）",
  params: [
    { key: "iterations", label: "迭代次数", type: "number", default: 1, placeholder: "1-100" },
    { key: "a", label: "参数 a", type: "number", default: 1, placeholder: "矩阵 [[1,a],[b,ab+1]]" },
    { key: "b", label: "参数 b", type: "number", default: 1, placeholder: "矩阵 [[1,a],[b,ab+1]]" },
    { key: "decode", label: "反向还原", type: "bool", default: false },
  ],
  run: arnoldCatOp, // 单向（decode 用 decode:true 参数）
  acceptsBytes: true,
});

// ---- Arnold 全参数暴力破解（a/b/次数三维遍历 → 候选网格拼图） ----
function arnoldCatBruteOp(text, p = {}) {
  const aStart = Math.max(1, Number(p.aStart) || 1);
  const aEnd = Math.max(aStart, Number(p.aEnd) || 3);
  const bStart = Math.max(1, Number(p.bStart) || 1);
  const bEnd = Math.max(bStart, Number(p.bEnd) || 3);
  const tStart = Math.max(1, Number(p.tStart) || 1);
  const tEnd = Math.max(tStart, Number(p.tEnd) || 5);
  const total = (aEnd - aStart + 1) * (bEnd - bStart + 1) * (tEnd - tStart + 1);
  if (total > 2000) {
    throw new Error("候选组合 " + total + " 超过上限 2000，请缩小范围（暴破结果全生成拼图，太多会卡）");
  }
  // 纯 JS 像素管线（node 可测）：dataURL → PNG 解码 → 逐组合逆变换 → 缩略拼图 → PNG 输出
  let imageData;
  try {
    imageData = decodePNG(dataURLToBytes(text));
  } catch (e) {
    throw new Error("图像解码失败（暴破走纯 JS PNG 管线）：" + e.message);
  }
  const src = new Uint8ClampedArray(imageData.data);
  const n = imageData.width;
  if (n !== imageData.height) throw new Error("Arnold 暴破需要正方形图像");
    // 候选缩略图（最近邻，固定高 96px）
    const THUMB_H = 96;
    const thScale = THUMB_H / n;
    const tw = Math.max(1, Math.round(n * thScale));
    const thumbs = [];
    for (let a = aStart; a <= aEnd; a++) {
      for (let b = bStart; b <= bEnd; b++) {
        for (let t = tStart; t <= tEnd; t++) {
          const cand = arnoldCatTransform(
            { width: n, height: n, data: new Uint8ClampedArray(src) },
            { iterations: t, a, b, decode: true }
          );
          // 缩略
          const th = new Uint8ClampedArray(tw * THUMB_H * 4);
          for (let y = 0; y < THUMB_H; y++) {
            const sy = Math.min(n - 1, Math.floor(y / thScale));
            for (let x = 0; x < tw; x++) {
              const sx = Math.min(n - 1, Math.floor(x / thScale));
              const si = (sy * n + sx) * 4;
              const di = (y * tw + x) * 4;
              th[di] = cand.data[si]; th[di + 1] = cand.data[si + 1];
              th[di + 2] = cand.data[si + 2]; th[di + 3] = cand.data[si + 3];
            }
          }
          thumbs.push(th);
        }
      }
    }
    // 网格拼图：每行 10 张，行间 6px 白缝，列间 6px 缝
    const perRow = Math.min(10, thumbs.length);
    const gap = 6;
    const gridW = perRow * tw + (perRow + 1) * gap;
    const rows = Math.ceil(thumbs.length / perRow);
    const gridH = rows * THUMB_H + (rows + 1) * gap;
    const grid = new Uint8ClampedArray(gridW * gridH * 4);
    for (let i = 0; i < grid.length; i += 4) { grid[i] = 255; grid[i + 1] = 255; grid[i + 2] = 255; grid[i + 3] = 255; }
    thumbs.forEach((th, idx) => {
      const row = Math.floor(idx / perRow);
      const col = idx % perRow;
      const ox = gap + col * (tw + gap);
      const oy = gap + row * (THUMB_H + gap);
      for (let y = 0; y < THUMB_H; y++) {
        for (let x = 0; x < tw; x++) {
          const si = (y * tw + x) * 4;
          const di = ((oy + y) * gridW + (ox + x)) * 4;
          grid[di] = th[si]; grid[di + 1] = th[si + 1]; grid[di + 2] = th[si + 2]; grid[di + 3] = th[si + 3];
        }
      }
    });
  return rgbaToDataURL(grid, gridW, gridH);
}

register({
  id: "arnoldCatBrute", cat: "stego", name: "Arnold 猫脸暴破",
  desc: "全参数暴力破解：a/b/迭代次数三维范围遍历反向还原，候选缩略图网格拼图输出（随参数范围增大耗时线性增长）",
  params: [
    { key: "aStart", label: "a 起始", type: "number", default: 1 },
    { key: "aEnd", label: "a 结束", type: "number", default: 3 },
    { key: "bStart", label: "b 起始", type: "number", default: 1 },
    { key: "bEnd", label: "b 结束", type: "number", default: 3 },
    { key: "tStart", label: "次数起始", type: "number", default: 1 },
    { key: "tEnd", label: "次数结束", type: "number", default: 5 },
  ],
  run: arnoldCatBruteOp,
  acceptsBytes: true,
});

register({
  id: "imageBasic", cat: "stego", name: "图像基础操作",
  desc: "反色/翻转/通道分离/位平面提取等图像基础变换",
  params: [
    { key: "op", label: "操作", type: "select", default: "invert",
      options: [
        { value: "invert", label: "反色" },
        { value: "flipH", label: "水平翻转" },
        { value: "flipV", label: "垂直翻转" },
        { value: "channelR", label: "只保留 R 通道" },
        { value: "channelG", label: "只保留 G 通道" },
        { value: "channelB", label: "只保留 B 通道" },
        { value: "bitplane", label: "位平面提取" },
      ],
    },
    { key: "channel", label: "位平面通道", type: "number", default: 0, placeholder: "0=R,1=G,2=B" },
    { key: "bit", label: "位序号", type: "number", default: 0, placeholder: "0-7" },
  ],
  run: imageBasicOp,
  acceptsBytes: true,
});
// ============ 图像隐写扩展组 ============
// 算法来源（参考常见图像隐写工具菜单）：
// lsbMulti —— LSB 多通道多位深（扩 lsbImage，1-3 位/通道）
// pngText —— PNG tEXt/zTXt/iTXt chunk 解析+写入（纯字节，对应 openstego/zsteg 的文本块）
// pngHeight —— PNG IHDR 高度修改（CTF 隐藏图层经典，对应 modify_png_height）
// exifExtract —— JPEG EXIF 元数据提取（对应 JPHS/EXIF 查看）
// bitplaneSlicing —— 位平面分解（对应 StegSolve LSB 的位平面视图）
// imageDiff —— 双图差异对比 XOR/差值（对应 双图组合 Image Combiner）
// 契约分两类：
// 像素类（lsbMulti/bitplaneSlicing/imageDiff）：首参 imageData {width,height,data}
// 与 lsbImage/arnoldCat/imageBasic 一致；UI 经 canvas 转换。
// 字节类（pngText/pngHeight/exifExtract）：首参为 base64 字符串（dataURL 或裸 base64）
// 操作文件原始字节（绝不经 canvas——canvas 重编码会丢 chunk/EXIF/LSB）。
// node 测试对两类算法层均可对拍；纯 Canvas IO 的（dataURLToImageData/imageDataToDataURL）
// 标注"浏览器实测待 UI 接入"。

// ---- CRC32（PNG chunk 校验，多项式 0xEDB88320）----
const _crc32Table = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function _crc32(bytes, start, end) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = _crc32Table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- base64 ↔ Uint8Array（兼容 dataURL 前缀；node 用 atob/btoa 或 Buffer 兜底）----
function _b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function _bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

// ---- 字节读写小工具 ----
function _readU32be(bytes, off) {
  return (((bytes[off] << 24) >>> 0) + (bytes[off + 1] << 16) + (bytes[off + 2] << 8) + bytes[off + 3]) >>> 0;
}
function _setU32be(arr, off, val) {
  arr[off] = (val >>> 24) & 0xFF;
  arr[off + 1] = (val >>> 16) & 0xFF;
  arr[off + 2] = (val >>> 8) & 0xFF;
  arr[off + 3] = val & 0xFF;
}
function _latin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}
function _latin1ToBytes(str) {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}
function _utf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
function _hex(bytes, max) {
  const n = Math.min(bytes.length, max == null ? bytes.length : max);
  let s = "";
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

// ============ lsbMulti：LSB 多通道多位深 ============
// 每 channel 样本藏 bitDepth 位（1-3），bit 流 = 32 位长度(big-endian) + 消息字节。
// 每 slot 贡献 bitDepth 位，bit0(LSB) 先写。容量 = 像素数 × 通道数 × bitDepth 位。
function lsbMultiEncode(imageData, text, p = {}) {
  const channels = p.channels || "RGB";
  const chanMask = _lsbChannelMask(channels);
  const bitDepth = Math.max(1, Math.min(3, Number(p.bitDepth) || 1));
  const data = imageData.data;
  const bytes = new TextEncoder().encode(text);
  const totalBits = LSB_HEADER_BITS + bytes.length * 8;
  const capacity = Math.floor(data.length / 4) * chanMask.length * bitDepth;
  if (totalBits > capacity) {
    throw new Error(`消息过大：需要 ${totalBits} 位，容量 ${capacity} 位`);
  }
  const bits = new Uint8Array(totalBits);
  const len = bytes.length;
  for (let i = 0; i < 32; i++) bits[i] = (len >>> (31 - i)) & 1;
  for (let i = 0; i < bytes.length; i++)
    for (let b = 0; b < 8; b++) bits[32 + i * 8 + b] = (bytes[i] >>> (7 - b)) & 1;
  const clearMask = bitDepth === 1 ? 0xFE : bitDepth === 2 ? 0xFC : 0xF8;
  let bitIdx = 0;
  for (let px = 0; px < data.length && bitIdx < bits.length; px += 4) {
    for (const c of chanMask) {
      if (bitIdx >= bits.length) break;
      let v = data[px + c] & clearMask;
      for (let k = 0; k < bitDepth && bitIdx + k < bits.length; k++) v |= bits[bitIdx + k] << k;
      data[px + c] = v;
      bitIdx += bitDepth;
    }
  }
  return imageData;
}

function lsbMultiDecode(imageData, p = {}) {
  const channels = p.channels || "RGB";
  const chanMask = _lsbChannelMask(channels);
  const bitDepth = Math.max(1, Math.min(3, Number(p.bitDepth) || 1));
  const data = imageData.data;
  const readBit = (g) => {
    const slot = Math.floor(g / bitDepth);
    const sub = g % bitDepth;
    const pxIdx = Math.floor(slot / chanMask.length) * 4;
    const cIdx = chanMask[slot % chanMask.length];
    return (data[pxIdx + cIdx] >> sub) & 1;
  };
  let len = 0;
  for (let i = 0; i < 32; i++) len = (len << 1) | readBit(i);
  len >>>= 0; // 32 位无符号化：最高位为 1 时避免负长度绕过下面的上限检查
  const maxLen = Math.floor(Math.floor(data.length / 4) * chanMask.length * bitDepth / 8);
  if (len === 0 || len > maxLen) return "";
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | readBit(32 + i * 8 + j);
    bytes[i] = b;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ============ PNG chunk 解析（纯字节）============
const _PNG_SIG = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
function _pngCheckSig(bytes) {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== _PNG_SIG[i]) return false;
  return true;
}
// 返回 [{type, len, dataOff, totalOff}]，到 IEND 为止
function _pngParseChunks(bytes) {
  const chunks = [];
  let off = 8;
  while (off + 8 <= bytes.length) {
    const len = _readU32be(bytes, off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const dataOff = off + 8;
    chunks.push({ type, len, dataOff, totalOff: off });
    if (type === "IEND") break;
    off = dataOff + len + 4;
  }
  return chunks;
}

// ============ pngText：PNG 文本块读写 ============
function pngTextDecode(text, p = {}) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : _b64ToBytes(text);
  if (!_pngCheckSig(bytes)) throw new Error("非 PNG 文件（签名不匹配）");
  const chunks = _pngParseChunks(bytes);
  const lines = [];
  for (const c of chunks) {
    if (c.type === "tEXt") {
      const data = bytes.subarray(c.dataOff, c.dataOff + c.len);
      const nul = data.indexOf(0);
      const kw = nul >= 0 ? _latin1(data.subarray(0, nul)) : _latin1(data);
      const val = nul >= 0 ? _latin1(data.subarray(nul + 1)) : "";
      lines.push(`[tEXt] ${kw}: ${val}`);
    } else if (c.type === "zTXt") {
      const data = bytes.subarray(c.dataOff, c.dataOff + c.len);
      const nul = data.indexOf(0);
      const kw = nul >= 0 ? _latin1(data.subarray(0, nul)) : "";
      const method = nul >= 0 ? data[nul + 1] : 0;
      const comp = nul >= 0 ? data.subarray(nul + 2) : new Uint8Array(0);
      let val = null;
      if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
        try { val = _utf8(globalThis.pako.inflate(comp)); } catch (e) { val = null; }
      }
      if (val === null) {
        lines.push(`[zTXt] ${kw}: (zlib 压缩，方法 ${method}，${comp.length} 字节；需 pako/zlib 解压，hex 前32: ${_hex(comp, 32)})`);
      } else {
        lines.push(`[zTXt] ${kw}: ${val}`);
      }
    } else if (c.type === "iTXt") {
      const data = bytes.subarray(c.dataOff, c.dataOff + c.len);
      const nul1 = data.indexOf(0);
      const kw = nul1 >= 0 ? _latin1(data.subarray(0, nul1)) : "";
      let val = "";
      if (nul1 >= 0) {
        const compFlag = data[nul1 + 1];
        let i = nul1 + 3;
        const nul2 = data.indexOf(0, i);
        i = nul2 >= 0 ? nul2 + 1 : i;
        const nul3 = data.indexOf(0, i);
        const textStart = nul3 >= 0 ? nul3 + 1 : i;
        const raw = data.subarray(textStart);
        if (compFlag === 0) val = _utf8(raw);
        else {
          let dec = null;
          if (typeof globalThis !== "undefined" && globalThis.pako && globalThis.pako.inflate) {
            try { dec = _utf8(globalThis.pako.inflate(raw)); } catch (e) {}
          }
          val = dec !== null ? dec : `(zlib 压缩，${raw.length} 字节；需 pako)`;
        }
      }
      lines.push(`[iTXt] ${kw}: ${val}`);
    }
  }
  return lines.length ? lines.join("\n") : "(无 tEXt/zTXt/iTXt 文本块)";
}

function pngTextEncode(text, p = {}) {
  const keyword = p.keyword || "Comment";
  const value = p.value != null ? String(p.value) : "";
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : _b64ToBytes(text);
  if (!_pngCheckSig(bytes)) throw new Error("非 PNG 文件（签名不匹配）");
  const kwBytes = _latin1ToBytes(keyword);
  if (kwBytes.length < 1 || kwBytes.length > 79) throw new Error("keyword 长度需 1-79 字节");
  const valBytes = _latin1ToBytes(value);
  const dataLen = kwBytes.length + 1 + valBytes.length;
  const chunk = new Uint8Array(8 + dataLen + 4);
  _setU32be(chunk, 0, dataLen);
  chunk[4] = 0x74; chunk[5] = 0x45; chunk[6] = 0x58; chunk[7] = 0x74; // "tEXt"（X 大写 = 0x58）
  chunk.set(kwBytes, 8);
  chunk[8 + kwBytes.length] = 0;
  chunk.set(valBytes, 8 + kwBytes.length + 1);
  _setU32be(chunk, 8 + dataLen, _crc32(chunk, 4, 8 + dataLen));
  const chunks = _pngParseChunks(bytes);
  const iend = chunks.find((c) => c.type === "IEND");
  if (!iend) throw new Error("PNG 无 IEND，结构损坏");
  const insertOff = iend.totalOff;
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, insertOff), 0);
  out.set(chunk, insertOff);
  out.set(bytes.subarray(insertOff), insertOff + chunk.length);
  return _bytesToB64(out);
}

// ============ pngHeight：PNG IHDR 高度修改 ============
// IHDR：sig(8) + len(4)[8..11] + type(4)[12..15] + data(13)[16..28] + crc(4)[29..32]
// data 内：width[16..19] height[20..23] bitDepth[24] colorType[25] ...
function pngHeightTransform(text, p = {}) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : _b64ToBytes(text);
  if (!_pngCheckSig(bytes)) throw new Error("非 PNG 文件（签名不匹配）");
  const origH = _readU32be(bytes, 20);
  let newH = Number(p.height);
  if (!newH || newH <= 0) newH = Math.floor(origH * 1.5);
  if (newH <= 0 || newH > 0xFFFFFFFF) throw new Error("新高度非法: " + newH);
  const out = new Uint8Array(bytes);
  _setU32be(out, 20, newH);
  _setU32be(out, 29, _crc32(out, 12, 29)); // 重算 IHDR CRC（type+data = [12,29)）
  return _bytesToB64(out);
}

// ============ exifExtract：JPEG EXIF 提取 ============
function _exifTypeSize(type) {
  const sizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8 };
  return sizes[type] || 1;
}
const _EXIF_TAG_NAMES = {
  0x0100: "ImageWidth", 0x0101: "ImageLength", 0x0103: "Compression", 0x0106: "PhotometricInterpretation",
  0x010F: "Make", 0x0110: "Model", 0x0112: "Orientation", 0x011A: "XResolution", 0x011B: "YResolution",
  0x011D: "HostComputer", 0x0131: "Software", 0x0132: "DateTime", 0x013B: "Artist", 0x8298: "Copyright",
  0x829A: "ExposureTime", 0x829D: "FNumber", 0x8769: "ExifOffset", 0x8825: "GPSInfo",
  0x9003: "DateTimeOriginal", 0x9004: "DateTimeDigitized", 0x9201: "ShutterSpeedValue",
  0x9202: "ApertureValue", 0x9204: "ExposureBiasValue", 0x9207: "MeteringMode", 0x9209: "Flash",
  0x920A: "FocalLength", 0xA002: "PixelXDimension", 0xA003: "PixelYDimension",
};
function _exifExtract(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error("非 JPEG 文件（缺 FFD8）");
  let i = 2;
  let exifStart = -1, exifLen = 0;
  while (i + 4 < bytes.length) {
    if (bytes[i] !== 0xFF) { i++; continue; }
    const marker = bytes[i + 1];
    if (marker === 0xD9 || marker === 0xDA) break; // EOI / SOS：图像数据开始，停止
    const segLen = (bytes[i + 2] << 8) + bytes[i + 3];
    if (marker === 0xE1 && segLen >= 8 &&
      bytes[i + 4] === 0x45 && bytes[i + 5] === 0x78 && bytes[i + 6] === 0x69 &&
      bytes[i + 7] === 0x66 && bytes[i + 8] === 0 && bytes[i + 9] === 0) {
      exifStart = i + 10;
      exifLen = segLen - 8;
      break;
    }
    i += 2 + segLen;
  }
  if (exifStart < 0) return "(未找到 EXIF APP1 段)";
  const tiff = bytes.subarray(exifStart, exifStart + exifLen);
  if (tiff.length < 8) return "(EXIF 段过短)";
  const bigEndian = (tiff[0] === 0x4D && tiff[1] === 0x4D);
  const rd16 = (off) => bigEndian ? (tiff[off] << 8) | tiff[off + 1] : (tiff[off + 1] << 8) | tiff[off];
  const rd32 = (off) => bigEndian
    ? (((tiff[off] << 24) >>> 0) + (tiff[off + 1] << 16) + (tiff[off + 2] << 8) + tiff[off + 3]) >>> 0
    : (((tiff[off + 3] << 24) >>> 0) + (tiff[off + 2] << 16) + (tiff[off + 1] << 8) + tiff[off]) >>> 0;
  if (rd16(2) !== 0x002A) return "(TIFF magic 非 42，非标准 EXIF)";
  const ifd0Off = rd32(4);
  const lines = [];
  function parseIfd(off, label) {
    if (off + 2 > tiff.length || off < 0) return;
    const count = rd16(off);
    let p = off + 2;
    for (let e = 0; e < count && p + 12 <= tiff.length; e++, p += 12) {
      const tag = rd16(p);
      const type = rd16(p + 2);
      const cnt = rd32(p + 4);
      const name = _EXIF_TAG_NAMES[tag] || ("Tag_0x" + tag.toString(16).toUpperCase().padStart(4, "0"));
      const totalBytes = cnt * _exifTypeSize(type);
      const dataOff = totalBytes <= 4 ? p + 8 : rd32(p + 8);
      let valStr;
      if (type === 2) { // ASCII
        let s = "";
        for (let k = 0; k < cnt && dataOff + k < tiff.length; k++) {
          const ch = tiff[dataOff + k];
          if (ch === 0) break;
          s += String.fromCharCode(ch);
        }
        valStr = s;
      } else if (type === 3) valStr = rd16(dataOff).toString();
      else if (type === 4) valStr = rd32(dataOff).toString();
      else if (type === 5) {
        const num = rd32(dataOff), den = rd32(dataOff + 4);
        valStr = den !== 0 ? (num + "/" + den) : (num + "/0");
      } else if (type === 1 || type === 7) valStr = "(" + cnt + " 字节)";
      else valStr = "(type " + type + ")";
      lines.push(`[${label}] ${name}: ${valStr}`);
    }
  }
  parseIfd(ifd0Off, "IFD0");
 // 跟随 ExifIFD / GPS 指针（一级）
  const cnt0 = rd16(ifd0Off);
  let p = ifd0Off + 2;
  for (let e = 0; e < cnt0 && p + 12 <= tiff.length; e++, p += 12) {
    const tag = rd16(p);
    if (tag === 0x8769) parseIfd(rd32(p + 8), "ExifIFD");
    else if (tag === 0x8825) parseIfd(rd32(p + 8), "GPS");
  }
  return lines.length ? lines.join("\n") : "(EXIF 段无可用字段)";
}
function exifExtractRun(text, p = {}) {
  const bytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : _b64ToBytes(text);
  return _exifExtract(bytes);
}

// ============ bitplaneSlicing：位平面分解 ============
// color 模式：每通道独立取 bit 位 → R-bit→R, G-bit→G, B-bit→B（放大该位平面）
// gray 模式：亮度 (0.299R+0.587G+0.114B) 取 bit 位 → 灰度图
function bitplaneSlicingTransform(imageData, p = {}) {
  const bit = Math.max(0, Math.min(7, Number(p.bit) || 0));
  const mode = p.mode || "color";
  const data = imageData.data;
  const out = { width: imageData.width, height: imageData.height, data: new Uint8ClampedArray(data.length) };
  for (let i = 0; i < data.length; i += 4) {
    if (mode === "gray") {
      const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
      const v = ((lum >> bit) & 1) * 255;
      out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
    } else {
      out.data[i] = ((data[i] >> bit) & 1) * 255;
      out.data[i + 1] = ((data[i + 1] >> bit) & 1) * 255;
      out.data[i + 2] = ((data[i + 2] >> bit) & 1) * 255;
    }
    out.data[i + 3] = data[i + 3];
  }
  return out;
}

// ============ imageDiff：双图差异对比 ============
// p.image2 = {width,height,data}；mode: xor/sub/add/and/or；裁到最小尺寸。
function imageDiffTransform(imageData, p = {}) {
  const img2 = p.image2;
  if (!img2 || !img2.data) throw new Error("imageDiff 需要第二张图（p.image2: {width,height,data}）");
  const mode = p.mode || "xor";
  const w = Math.min(imageData.width, img2.width);
  const h = Math.min(imageData.height, img2.height);
  const out = { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
  const d1 = imageData.data, d2 = img2.data, dO = out.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * imageData.width + x) * 4;
      const j = (y * img2.width + x) * 4;
      const o = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const a = d1[i + c], b = d2[j + c];
        let v;
        if (mode === "sub" || mode === "diff") v = Math.abs(a - b);
        else if (mode === "add") v = (a + b) & 0xFF;
        else if (mode === "and") v = a & b;
        else if (mode === "or") v = a | b;
        else v = a ^ b; // xor 默认
        dO[o + c] = v;
      }
    }
  }
  return out;
}

// ============ C7-P12 合并：lsbMulti 已并入 lsbImage（bitDepth 参数，depth=1 与旧 lsbImage bit-identical）。
// lsbMultiEncode/Decode 函数保留（lsbImage 现用它们做统一实现），此处注册删除。

register({
  id: "pngText", cat: "stego", name: "PNG 文本块读写",
  desc: "PNG tEXt/zTXt/iTXt chunk 解析与写入（操作文件字节，base64 输入输出，不经 canvas）",
  params: [
    { key: "keyword", label: "关键字", type: "text", default: "Comment", placeholder: "tEXt 关键字（1-79 字节）" },
    { key: "value", label: "文本", type: "text", default: "", placeholder: "要写入的文本（encode 用）" },
  ],
  encode: pngTextEncode, decode: pngTextDecode,
  acceptsBytes: true,
});

register({
  id: "pngHeight", cat: "stego", name: "PNG 高度修改",
  desc: "修改 PNG IHDR 高度（CTF 隐藏图层经典手法；操作文件字节，base64 输入输出）",
  params: [
    { key: "height", label: "新高度", type: "number", default: 0, placeholder: "0=自动 1.5 倍，或指定像素值" },
  ],
  run: pngHeightTransform,
  acceptsBytes: true,
});

register({
  id: "exifExtract", cat: "stego", name: "EXIF 提取",
  desc: "解析 JPEG APP1 EXIF 元数据（Make/Model/DateTime/GPS 等；操作文件字节，base64 输入）",
  params: [],
  run: exifExtractRun,
  acceptsBytes: true,
});

register({
  id: "bitplaneSlicing", cat: "stego", name: "位平面分解",
  desc: "提取指定比特位的位平面（color 按 RGB 各通道，gray 按亮度）",
  params: [
    { key: "bit", label: "位序号", type: "number", default: 0, placeholder: "0-7（0=LSB）" },
    { key: "mode", label: "模式", type: "select", default: "color",
      options: [
        { value: "color", label: "彩色（按 RGB 通道）" },
        { value: "gray", label: "灰度（按亮度）" },
      ],
    },
  ],
  run: bitplaneSlicingOp,
  acceptsBytes: true,
});

register({
  id: "imageDiff", cat: "stego", name: "图像差异对比",
  desc: "双图逐像素运算（XOR/差值/加/与/或），找隐藏层；第二张图从参数栏粘贴 base64/dataURL",
  params: [
    { key: "mode", label: "运算", type: "select", default: "xor",
      options: [
        { value: "xor", label: "XOR（异或，最常用）" },
        { value: "sub", label: "差值（绝对值）" },
        { value: "add", label: "相加" },
        { value: "and", label: "AND" },
        { value: "or", label: "OR" },
      ],
    },
    { key: "image2", label: "第二张图", type: "text", default: "", placeholder: "第二张图片的 base64/dataURL" },
  ],
  run: imageDiffOp,
  acceptsBytes: true,
});

export {
  lsbImageEncode, lsbImageDecode,
  pixelJihadEncode, pixelJihadDecode,
  arnoldCatTransform, arnoldCatBruteOp,
  imageBasicTransform,
  dataURLToImageData, imageDataToDataURL,
  PJ_MAX_MESSAGE_SIZE,
  lsbMultiEncode, lsbMultiDecode,
  pngTextEncode, pngTextDecode,
  pngHeightTransform,
  exifExtractRun,
  bitplaneSlicingTransform,
  imageDiffTransform,
};
