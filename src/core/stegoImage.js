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
import { inflateRaw } from "./pcapDeep.js";

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

// 历史遗留入口：C7-P12 起 lsbMultiDecode(bitDepth=1) 与本函数逐位等价（当时已核实），
// 故直接委托，避免两份实现分叉 —— raw 流兜底、明确报错等修复只需维护一处。
function lsbImageDecode(imageData, p = {}) {
  return lsbMultiDecode(imageData, { ...p, bitDepth: 1 });
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
  const capacityChars = Math.floor(colors.length * 0.75 / 16);
  const messageSize = pjGetNumberFromBits(colors, history, hash);
 // 长度头不合理 → 大概率图内无载荷；但口令错误时定位序列错位同样会读出乱值，两种可能都要提示，不再静默返回空串。
  if (messageSize === 0) {
    throw new Error("未检出 PixelJihad 载荷：长度头实测为 0——图内没有隐藏数据；若原图带口令，口令不符也会读出乱值，请先确认口令为空或正确");
  }
  if (messageSize > PJ_MAX_MESSAGE_SIZE || (messageSize + 1) * 16 > colors.length * 0.75) {
    throw new Error("未检出 PixelJihad 载荷：长度头实测 " + messageSize + "，超出本图容量上限 " + capacityChars + " 字符——图内没有隐藏数据；若原图带口令，口令不符也会读出乱值，请先确认口令");
  }
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
 // 长度头不可信 / 可用位置耗尽（小图读大长度头）——按裁决①带实测数字明确抛错，不再静默吞成空串
    throw new Error("PixelJihad 解码失败：" + (e && e.message ? e.message : e));
  }
  let obj = null;
  try { obj = JSON.parse(message); } catch (e) { obj = null; }
  if (!obj || typeof obj !== "object") {
 // 长度头可信但内容解不出 JSON 结构：口令不符（解出乱文）或图非本工具编码生成
    throw new Error("PixelJihad 解码失败：按长度头读出 " + message.length + " 字符但不是有效载荷结构——口令错误的可能性最大"
      + (password ? "（请核对当前口令）" : "（原图若带口令请填入口令重试）") + "，其次该图可能不是 PixelJihad 编码生成");
  }
  if (obj.ct) {
    try {
      return sjcl.decrypt(password, message);
    } catch (e) {
 // AES-CCM 自带认证：结构完整但认证未通过 ⇒ 可明确定性为口令错误（或密文被改动）
      throw new Error("PixelJihad 口令错误：载荷为 AES-CCM 密文（" + (obj.ct ? obj.ct.length : 0) + " 字符），认证未通过——口令不符，或密文被改动");
    }
  }
  if (typeof obj.text !== "string") {
    throw new Error("PixelJihad 解码失败：载荷 JSON 缺少 text 字段，结构异常（非本工具生成的载荷）");
  }
  return obj.text;
}

// ============ arnoldCat：Arnold 猫脸变换置乱 ============
// 经典 Arnold 变换：N×N 图像，每像素 (x,y) → ((x+y) mod N, (x+2y) mod N)
// 周期 T 后回到原图。encode 跑 iterations 次正向，decode 跑 T-iterations 次（或反向）。
// 为简化：encode 跑 n 次，decode 跑 period-n 次（需先算 period）。
// 矩形 M×N：行模/列模分置（两次剪切 x'=(x+a·y) mod W、y'=(y+b·x') mod H，det=1 双射），
// 方阵路径与闭式矩阵 [[1,a],[b,ab+1]] mod N 逐字节一致。perChannel：R/G/B 各平面独立置乱、alpha 不动。

function arnoldCatTransform(imageData, p = {}) {
  const w = imageData.width;
  const h = imageData.height;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new Error("Arnold 变换需要非空图像（当前 " + w + "x" + h + "）");
  }
  if (imageData.data.length !== w * h * 4) {
    throw new Error("Arnold 变换输入像素数据长度与尺寸不符（期望 " + w * h * 4 + " 字节，实际 " + imageData.data.length + "）");
  }
  const iterations = Math.max(1, Number(p.iterations) || 1);
  const decode = !!p.decode;
  const rowFirst = !!p.rowFirst;
  const perChannel = !!p.perChannel;
  const a = Number(p.a) || 1;
  const b = Number(p.b) || 1;
  const data = imageData.data;
 // 复制源数据
  const src = new Uint8ClampedArray(data);
  const n = w;
 // 通用 Arnold 矩阵 [[1,a],[b,ab+1]]（det=1 可逆）。a=b=1 时退化为标准版。
 // 正向：新坐标 = M·(x,y)；反向 = M⁻¹·(x,y)。
 // 与参考实现（参数化猫脸变换）一致：正向 nx=(x+a*y)%N、ny=(b*x+(ab+1)*y)%N，
 // 反向 nx=((ab+1)*x-a*y)%N、ny=(y-b*x)%N。像素写入方向 dst[(ny,nx)] = src[(y,x)]。
 // 行优先约定：首坐标=行（img[row][col]，Python/参考实现常用）。
 // 正向 r'=r+b·c、c'=a·r+(ab+1)·c（与参考脚本逐字对齐），换算到本实现（列x,行y）即
 // x'=a·y+(ab+1)·x、y'=b·x+y；逆矩阵 [[1,-a],[-b,ab+1]]（det=1）。a/b 按参考值原样填，不换序。
 // 矩形 M×N（w≠h）：矩阵 det=1 分解为两次剪切，行模/列模分置各按本步模数归一——
 //   列优先：x'=(x+a·y) mod W，y'=(y+b·x') mod H；行优先：r'=(r+b·c) mod H，c'=(c+a·r') mod W。
 //   每步均为模平移双射，合成无条件双射；方阵时与上面闭式矩阵公式逐字节一致。
 // perChannel：R/G/B 三平面各自独立跑同一 2D 置乱（对齐流通脚本 img[:,:,i] 逐通道语义），alpha 不动。
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let nx, ny;
        if (w === h) {
          if (rowFirst) {
            if (decode) {
              nx = ((x - a * y) % n + n) % n;
              ny = (((a * b + 1) * y - b * x) % n + n) % n;
            } else {
              nx = ((a * y + (a * b + 1) * x) % n + n) % n;
              ny = ((b * x + y) % n + n) % n;
            }
          } else if (decode) {
            nx = (((a * b + 1) * x - a * y) % n + n) % n;
            ny = ((y - b * x) % n + n) % n;
          } else {
            nx = ((x + a * y) % n + n) % n;
            ny = ((b * x + (a * b + 1) * y) % n + n) % n;
          }
        } else if (rowFirst) {
          if (decode) {
            nx = ((x - a * y) % w + w) % w;
            ny = ((y - b * nx) % h + h) % h;
          } else {
            ny = ((y + b * x) % h + h) % h;
            nx = ((x + a * ny) % w + w) % w;
          }
        } else if (decode) {
          ny = ((y - b * x) % h + h) % h;
          nx = ((x - a * ny) % w + w) % w;
        } else {
          nx = ((x + a * y) % w + w) % w;
          ny = ((y + b * nx) % h + h) % h;
        }
        const srcIdx = (y * w + x) * 4;
        const dstIdx = (ny * w + nx) * 4;
        if (perChannel) {
 // 逐通道：R/G/B 独立置乱，A 通道原位不动（流通脚本语义）
          data[dstIdx] = src[srcIdx];
          data[dstIdx + 1] = src[srcIdx + 1];
          data[dstIdx + 2] = src[srcIdx + 2];
        } else {
          data[dstIdx] = src[srcIdx];
          data[dstIdx + 1] = src[srcIdx + 1];
          data[dstIdx + 2] = src[srcIdx + 2];
          data[dstIdx + 3] = src[srcIdx + 3];
        }
      }
    }
 // 下次迭代基于本次结果
    src.set(data);
  }
  return imageData;
}

// ============ imageBasic：图像基础操作 ============
// 单向变换（run），非双向。params.op 选择具体操作。
// solid 档（纯色图制作）为增强：无需输入图片，imageBasicOp 跳过解码直接出图。

function imageBasicTransform(imageData, p = {}) {
  const op = p.op || "invert";
  if (op === "solid") {
 // 纯色图制作（增强，2026-10）：宽×高 + RGBA 色 → 纯色图。无需输入图片，
 // imageBasicOp 对本档跳过图片解码。出题造载体 / 做对比参照图用。
    const sw = Number(p.solidW), sh = Number(p.solidH);
    const cr = Number(p.solidR), cg = Number(p.solidG), cb = Number(p.solidB);
    if (!Number.isInteger(sw) || !Number.isInteger(sh) || sw < 1 || sh < 1 || sw > 8192 || sh > 8192) {
      throw new Error("imageBasic：纯色图宽高需为 1-8192 的整数，当前 " + p.solidW + "×" + p.solidH);
    }
    if (![cr, cg, cb].every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) {
      throw new Error("imageBasic：纯色图颜色分量需为 0-255 的整数，当前 R=" + p.solidR +
        " G=" + p.solidG + " B=" + p.solidB);
    }
    const solid = new Uint8ClampedArray(sw * sh * 4);
    for (let i = 0; i < solid.length; i += 4) {
      solid[i] = cr; solid[i + 1] = cg; solid[i + 2] = cb; solid[i + 3] = 255;
    }
    return { width: sw, height: sh, data: solid };
  }
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
  const msg = p && p.message != null ? String(p.message) : "";
  if (!msg) throw new Error("请在「待隐藏文本」参数中填入要隐藏的内容");
  // 输入：PNG 载体优先纯 JS 解码（stegoPixels.decodePNG），半透明 PNG 的 RGB 低位
  // 不被 canvas drawImage 预乘破坏；非 PNG（JPG/BMP/GIF）或解码器不支持的 PNG 回退 canvas。
  let imageData;
  const bytes = _imageInputBytes(text, p);
  if (bytes && bytes.length) {
    try { imageData = decodePNG(bytes); }
    catch (e) { imageData = await _inputImageData(text, p); }
  } else {
    imageData = await _inputImageData(text, p);
  }
  const out = lsbMultiEncode(imageData, msg, p);
  // 输出：纯 JS PNG 编码（mcMap.encodePNG / rgbaToDataURL），绕过 canvas
  // putImageData→toDataURL 的预乘舍入，alpha 承载的消息位原样落盘（无能力降级）。
  return rgbaToDataURL(out.data, out.width, out.height);
}
async function lsbImageDecodeOp(text, p = {}) {
  // 解码：PNG 优先纯 JS 解码（decodePNG），绕过 canvas drawImage 预乘舍入，
  // alpha 通道承载的消息位可被精确读取；非 PNG 或不支持的 PNG 回退 canvas。
  const bytes = _imageInputBytes(text, p);
  if (bytes && bytes.length) {
    try {
      return lsbMultiDecode(decodePNG(bytes), p);
    } catch (e) { /* 非 PNG / 解码器不支持 → 回退 canvas */ }
  }
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
  // solid 档（纯色图制作）无需输入图片：跳过解码直接出图。
  // 输出走纯 JS PNG 编码（rgbaToDataURL），浏览器/Node 双环境一致可对拍。
  if ((p && p.op) === "solid") {
    const out = imageBasicTransform(null, p);
    return rgbaToDataURL(out.data, out.width, out.height);
  }
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
  id: "lsbImage", cat: "stegoFile", name: "LSB 像素隐写",
  desc: "最低有效位像素隐写（前 32 位存长度，支持 R/G/B/A 通道选择，多位深 1-3 位/通道）。提取时若图中不是本格式（位流无长度前缀），自动改按原始位流提取最长可读文本；两者都没有才报错并给出原因。",
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
  id: "pixelJihad", cat: "stegoFile", name: "PixelJihad",
  desc: "PixelJihad 隐写（SHA-256 种子 + 伪随机 LSB + 可选 AES-CCM 加密）",
  params: [
    { key: "password", label: "密码", type: "text", default: "", placeholder: "可选密码（空则不加密）" },
    { key: "message", label: "待隐藏文本", type: "text", default: "", placeholder: "编码方向要藏进图片的文本" },
  ],
  encode: pixelJihadEncodeOp, decode: pixelJihadDecodeOp,
  acceptsBytes: true,
});

register({
  id: "arnoldCat", family: "arnold", familyLabel: "transform", cat: "stegoFile", name: "Arnold 猫脸变换",
  desc: "Arnold 猫脸变换置乱（支持正方形与任意矩形 M×N，参数化矩阵 [[1,a],[b,ab+1]]，a=b=1 为标准版；矩形按行模/列模分置可逆）。行优先约定：对齐首坐标=行的参考实现（Python img[row][col] 类），勾选后 a/b 按原值填，无需换序。逐通道置乱：对齐流通脚本 R/G/B 各平面独立跑猫脸的语义，alpha 通道不动",
  params: [
    { key: "iterations", label: "迭代次数", type: "number", default: 1, placeholder: "1-100" },
    { key: "a", label: "参数 a", type: "number", default: 1, placeholder: "矩阵 [[1,a],[b,ab+1]]" },
    { key: "b", label: "参数 b", type: "number", default: 1, placeholder: "矩阵 [[1,a],[b,ab+1]]" },
    { key: "decode", label: "反向还原", type: "bool", default: false },
    { key: "rowFirst", label: "行优先约定", type: "bool", default: false },
    { key: "perChannel", label: "逐通道置乱", type: "bool", default: false },
  ],
  run: arnoldCatOp, // 单向（decode 用 decode:true 参数）
  acceptsBytes: true,
});

// ---- Arnold 全参数暴力破解（a/b/次数三维遍历 → 候选网格拼图） ----
// 图片字节魔数 → MIME（rawBytes 包 data:URL 用；认不出按 PNG 兜底，交给 Canvas 嗅探）。
function _sniffImageMime(b) {
  if (!b || !b.length) return "image/png";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return "image/png";
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x42 && b[1] === 0x4D) return "image/bmp";
  if (b.length >= 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return "image/png";
}

// 3×5 点阵字模（只需 0-9 + a/b/t）：暴破拼图每格缩略图下方的参数标签（如 a2b3t4）。
const _BRUTE_GLYPHS = {
  "0": ["111", "101", "101", "101", "111"],
  "1": ["010", "110", "010", "010", "111"],
  "2": ["111", "001", "111", "100", "111"],
  "3": ["111", "001", "111", "001", "111"],
  "4": ["101", "101", "111", "001", "001"],
  "5": ["111", "100", "111", "001", "111"],
  "6": ["111", "100", "111", "101", "111"],
  "7": ["111", "001", "010", "010", "010"],
  "8": ["111", "101", "111", "101", "111"],
  "9": ["111", "101", "111", "001", "111"],
  a: ["111", "101", "111", "101", "101"],
  b: ["110", "101", "110", "101", "110"],
  r: ["110", "101", "110", "101", "101"],
  t: ["111", "010", "010", "010", "010"],
};

// 把 label（a2b3t4 式）画进 grid 的标签条：深灰点阵 on 白底，水平居中于所在格。
function _drawBruteLabel(grid, gridW, ox, oy, cellW, labelH, label) {
  const s = cellW >= 52 ? 2 : 1; // 6 字符 ×2 倍字模宽 46px，格宽不够缩回 1 倍
  const totalW = (4 * label.length - 1) * s; // 每字符宽 3s + 字距 s
  const startX = ox + Math.max(0, Math.floor((cellW - totalW) / 2));
  const startY = oy + Math.max(0, Math.floor((labelH - 5 * s) / 2));
  for (let ci = 0; ci < label.length; ci++) {
    const g = _BRUTE_GLYPHS[label[ci]];
    if (!g) continue;
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (g[r][c] !== "1") continue;
        for (let dy = 0; dy < s; dy++) {
          for (let dx = 0; dx < s; dx++) {
            const di = ((startY + r * s + dy) * gridW + startX + ci * 4 * s + c * s + dx) * 4;
            grid[di] = 51; grid[di + 1] = 51; grid[di + 2] = 51; grid[di + 3] = 255;
          }
        }
      }
    }
  }
}

async function arnoldCatBruteOp(text, p = {}) {
  const aStart = Math.max(1, Number(p.aStart) || 1);
  const aEnd = Math.max(aStart, Number(p.aEnd) || 3);
  const bStart = Math.max(1, Number(p.bStart) || 1);
  const bEnd = Math.max(bStart, Number(p.bEnd) || 3);
  const tStart = Math.max(1, Number(p.tStart) || 1);
  const tEnd = Math.max(tStart, Number(p.tEnd) || 5);
  const rowFirstToo = !!p.rowFirstToo; // 约定枚举维：勾选后每个 (a,b,t) 列优先∪行优先各跑一遍
  const total = (aEnd - aStart + 1) * (bEnd - bStart + 1) * (tEnd - tStart + 1) * (rowFirstToo ? 2 : 1);
  if (total > 2000) {
    throw new Error("候选组合 " + total + " 超过上限 2000，请缩小范围（暴破结果全生成拼图，太多会卡）");
  }
  // 输入解码分流（修复「用户图进不去就崩」）：
  // ① 浏览器优先 Canvas（dataURLToImageData，通吃 JPEG/BMP/隔行 PNG/调色板 PNG）。
  //   拖入文件时 text 只是占位提示，真字节在 p.rawBytes（acceptsBytes 约定），
  //   先按魔数包成 data:URL 再喂 <img>。
  // ② Canvas 失败或非浏览器 → 纯 JS decodePNG（node 可测，仅支持非隔行 PNG）。
  // ③ 两层都失败 → 把两层原因一起报出（先 Canvas 后纯 JS）。
  const rawBytes = (p && p.rawBytes && p.rawBytes.length)
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : null;
  let imageData = null;
  let canvasReason = null;
  let pngReason = null;
  if (typeof document !== "undefined") {
    try {
      const srcStr = rawBytes
        ? "data:" + _sniffImageMime(rawBytes) + ";base64," + _bytesToB64(rawBytes)
        : String(text == null ? "" : text);
      imageData = await dataURLToImageData(srcStr);
    } catch (e) {
      canvasReason = (e && e.message) ? e.message : String(e);
    }
  } else {
    canvasReason = "非浏览器环境（无 document/canvas），未尝试";
  }
  if (!imageData) {
    try {
      imageData = decodePNG(rawBytes ? rawBytes : dataURLToBytes(text));
    } catch (e) {
      pngReason = (e && e.message) ? e.message : String(e);
    }
  }
  if (!imageData) {
    throw new Error("Arnold 暴破图像解码失败：[Canvas] " + canvasReason + "；[纯JS PNG] " + pngReason);
  }
  const src = new Uint8ClampedArray(imageData.data);
  const n = imageData.width;
  if (n !== imageData.height) throw new Error("Arnold 暴破需要正方形图像");
  // 候选缩略图（最近邻，固定高 96px）+ 每格下方参数标签条
  const THUMB_H = 96;
  const LABEL_H = 14;
  const thScale = THUMB_H / n;
  const tw = Math.max(1, Math.round(n * thScale));
  const thumbs = [];
  const labels = [];
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
        labels.push("a" + a + "b" + b + "t" + t);
        if (rowFirstToo) {
 // 行优先候选（同 a/b/t，反向还原按行优先约定），标签尾 r
          const candR = arnoldCatTransform(
            { width: n, height: n, data: new Uint8ClampedArray(src) },
            { iterations: t, a, b, decode: true, rowFirst: true }
          );
          const thR = new Uint8ClampedArray(tw * THUMB_H * 4);
          for (let y = 0; y < THUMB_H; y++) {
            const sy = Math.min(n - 1, Math.floor(y / thScale));
            for (let x = 0; x < tw; x++) {
              const sx = Math.min(n - 1, Math.floor(x / thScale));
              const si = (sy * n + sx) * 4;
              const di = (y * tw + x) * 4;
              thR[di] = candR.data[si]; thR[di + 1] = candR.data[si + 1];
              thR[di + 2] = candR.data[si + 2]; thR[di + 3] = candR.data[si + 3];
            }
          }
          thumbs.push(thR);
          labels.push("a" + a + "b" + b + "t" + t + "r");
        }
      }
    }
  }
  // 网格拼图：每行 10 张，行/列间 6px 白缝；格高 = 缩略图 96 + 标签条 14
  const perRow = Math.min(10, thumbs.length);
  const gap = 6;
  const cellH = THUMB_H + LABEL_H;
  const gridW = perRow * tw + (perRow + 1) * gap;
  const rows = Math.ceil(thumbs.length / perRow);
  const gridH = rows * cellH + (rows + 1) * gap;
  const grid = new Uint8ClampedArray(gridW * gridH * 4);
  for (let i = 0; i < grid.length; i += 4) { grid[i] = 255; grid[i + 1] = 255; grid[i + 2] = 255; grid[i + 3] = 255; }
  thumbs.forEach((th, idx) => {
    const row = Math.floor(idx / perRow);
    const col = idx % perRow;
    const ox = gap + col * (tw + gap);
    const oy = gap + row * (cellH + gap);
    for (let y = 0; y < THUMB_H; y++) {
      for (let x = 0; x < tw; x++) {
        const si = (y * tw + x) * 4;
        const di = ((oy + y) * gridW + (ox + x)) * 4;
        grid[di] = th[si]; grid[di + 1] = th[si + 1]; grid[di + 2] = th[si + 2]; grid[di + 3] = th[si + 3];
      }
    }
    _drawBruteLabel(grid, gridW, ox, oy + THUMB_H, tw, LABEL_H, labels[idx]);
  });
  return rgbaToDataURL(grid, gridW, gridH);
}

register({
  id: "arnoldCatBrute", family: "arnold", familyLabel: "crack", cat: "stegoFile", name: "Arnold 猫脸暴破",
  desc: "全参数暴力破解：a/b/迭代次数三维范围遍历反向还原，候选缩略图网格拼图输出（随参数范围增大耗时线性增长）。可勾「枚举行优先约定」加约定枚举维：列优先∪行优先各跑一遍，行优先候选标签尾带 r",
  params: [
    { key: "aStart", label: "a 起始", type: "number", default: 1 },
    { key: "aEnd", label: "a 结束", type: "number", default: 3 },
    { key: "bStart", label: "b 起始", type: "number", default: 1 },
    { key: "bEnd", label: "b 结束", type: "number", default: 3 },
    { key: "tStart", label: "次数起始", type: "number", default: 1 },
    { key: "tEnd", label: "次数结束", type: "number", default: 5 },
    { key: "rowFirstToo", label: "枚举行优先约定", type: "bool", default: false },
  ],
  run: arnoldCatBruteOp,
  acceptsBytes: true,
});

register({
  id: "imageBasic", cat: "image", name: "图像基础操作",
  desc: "反色/翻转/通道分离/位平面提取/纯色图制作等图像基础变换",
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
        { value: "solid", label: "纯色图制作（无需输入图片）" },
      ],
    },
    { key: "channel", label: "位平面通道", type: "number", default: 0, placeholder: "0=R,1=G,2=B" },
    { key: "bit", label: "位序号", type: "number", default: 0, placeholder: "0-7" },
    { key: "solidW", label: "纯色图宽（像素，仅纯色图档）", type: "number", default: 256 },
    { key: "solidH", label: "纯色图高（像素，仅纯色图档）", type: "number", default: 256 },
    { key: "solidR", label: "纯色图 R（0-255）", type: "number", default: 255 },
    { key: "solidG", label: "纯色图 G（0-255）", type: "number", default: 0 },
    { key: "solidB", label: "纯色图 B（0-255）", type: "number", default: 0 },
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

// ---- 原始 LSB 流兜底（无 32 位长度前缀）----
// 为什么需要：本 op 的编码格式是「前 32 位存长度」。若图里的 LSB 流**不是**本 op 写的
// （CTF 常见：直接把文本按位铺进 LSB，不带任何头），头 32 位就会被读成一个天文数字
// ——例：流首恰好是文本 "PWLS" ⇒ len = 0x50574C53 = 13.47 亿，远超图像容量，
// 旧实现于是**静默返回空串**：用户看到「不出结果」，而数据一直都在图里。
// 兜底：把全部槽位按位拼字节，遇 NUL 截断，按 UTF-8 解码；**仅当像文本时才返回**，
// 避免把普通照片的 LSB 噪声当成结果吐出来。
const LSB_RAW_CAP_BYTES = 65536;

/**
 * 文本可读性判据（原始位流兜底的闸门）。
 * 为什么不能只看「可打印率」：随机噪声的 LSB 里出现一段可打印 ASCII 游程并不罕见
 * （每字节 ~37%），只按比例判会把普通照片的噪声当成结果吐出来。
 * 故要求长度 ≥ 12（噪声出现 12 连续干净字节的概率 ~1e-5，可忽略），
 * 且**不含任何解码失败符/控制字符**（干净载荷不会有；噪声里非法 UTF-8 极常见）。
 */
function _lsbTextLooksReadable(text) {
  if (!text || text.length < 12) return false;
  for (let i = 0; i < text.length; i++) if (_lsbCharBad(text.charCodeAt(i))) return false;
  return true;
}
function _lsbCharBad(c) {
  return c === 0xFFFD || c === 0x7F || (c < 0x20 && c !== 9 && c !== 10 && c !== 13);
}

/** 原始位流 → 文本（无长度前缀假设）。readBit(g) 给第 g 个槽位的位值。 */
function lsbRawPayload(readBit, totalSlots) {
  const nBytes = Math.min(Math.floor(totalSlots / 8), LSB_RAW_CAP_BYTES);
  if (nBytes <= 0) return "";
  const bytes = new Uint8Array(nBytes);
  for (let i = 0; i < nBytes; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | readBit(i * 8 + j);
    bytes[i] = b;
  }
  const full = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  // 取**最长干净前缀**作为载荷：载荷之后是填充（NUL / 0xFF / 载体图自身的 LSB），
  // 其解码结果几乎立刻出现「解码失败符」或控制字符。这样不必假定终止符、也不必猜
  // 填充字节是什么；比「遇 NUL 截断」或「连续 3 个坏字符截断」都稳（实测后者会被
  // 0x55/0xAA 交替的填充骗过去）。
  let end = 0;
  while (end < full.length && !_lsbCharBad(full.charCodeAt(end))) end++;
  const text = full.slice(0, end);
  return _lsbTextLooksReadable(text) ? text : "";
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
  const totalSlots = Math.floor(data.length / 4) * chanMask.length * bitDepth;
  const maxLen = Math.floor(totalSlots / 8);
  if (len === 0 || len > maxLen) {
    // 不是本 op 的「32 位长度前缀」格式 ⇒ 按原始位流再试一次。
    const raw = lsbRawPayload(readBit, totalSlots);
    if (raw) return raw;
    // 头 32 位全零 = 图里确实没有 LSB 载荷，静默返回空（与既有语义一致）。
    if (len === 0) return "";
    // 头 32 位是个越界的大数 = 明确「不是本格式」，且原始位流也没读出文本 ⇒
    // 不再静默吞掉，给出可执行的结论（含实测数字与下一步）。
    throw new Error(
      "未找到 LSB 数据：头 32 位读作长度 = " + len + "，超过本图容量上限 " + maxLen +
      " 字节；按原始位流提取（不假定长度前缀）也没有得到可读文本。" +
      "该图可能本来就没有 LSB 隐写载荷，或不是本工具「前 32 位存长度」的格式。" +
      "若确认图中藏有 LSB 文本，请用「拖入图片」的 LSB 通道预览（含 12 种通道排列，可换 R/G/B 顺序）。"
    );
  }
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
// zlib 流解压（RFC 1950）：仓库内纯 JS inflate（pcapDeep.js），替代可选 globalThis.pako
function _inflateZlibLocal(zb) {
  if (!zb || zb.length < 6) throw new Error("zlib 数据过短");
  const cmf = zb[0], flg = zb[1];
  if ((cmf & 0x0f) !== 8 || (((cmf << 8) | flg) % 31) !== 0) throw new Error("zlib 头非法");
  return inflateRaw(zb.subarray(2, zb.length - 4));
}

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
      try { val = _utf8(_inflateZlibLocal(comp)); } catch (e) { val = null; }
      if (val === null) {
        lines.push(`[zTXt] ${kw}: (zlib 压缩，方法 ${method}，${comp.length} 字节，解压失败；hex 前32: ${_hex(comp, 32)})`);
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
          try { dec = _utf8(_inflateZlibLocal(raw)); } catch (e) { dec = null; }
          val = dec !== null ? dec : `(zlib 压缩，${raw.length} 字节，解压失败)`;
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
  // 产物协议 2026-09-02：写入后的 PNG 字节走 files 下载按钮，text 保留 base64 行（链式/复制兼容）。
  return { text: _bytesToB64(out), files: [{ name: "out.png", mime: "image/png", bytes: out }] };
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
  // 产物协议 2026-09-02：改高后的 PNG 字节走 files 下载按钮，text 保留 base64 行（链式/复制兼容）。
  return { text: _bytesToB64(out), files: [{ name: "out.png", mime: "image/png", bytes: out }] };
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
  id: "pngText", family: "png", familyLabel: "text", cat: "image", name: "PNG 文本块读写",
  desc: "PNG tEXt/zTXt/iTXt chunk 解析与写入（操作文件字节，base64 输入输出，不经 canvas）",
  params: [
    { key: "keyword", label: "关键字", type: "text", default: "Comment", placeholder: "tEXt 关键字（1-79 字节）" },
    { key: "value", label: "文本", type: "text", default: "", placeholder: "要写入的文本（encode 用）" },
  ],
  encode: pngTextEncode, decode: pngTextDecode,
  acceptsBytes: true,
});

register({
  id: "pngHeight", family: "png", familyLabel: "height", cat: "image", name: "PNG 高度修改",
  desc: "修改 PNG IHDR 高度（CTF 隐藏图层经典手法；操作文件字节，base64 输入输出）",
  params: [
    { key: "height", label: "新高度", type: "number", default: 0, placeholder: "0=自动 1.5 倍，或指定像素值" },
  ],
  run: pngHeightTransform,
  acceptsBytes: true,
});

register({
  id: "exifExtract", cat: "image", name: "EXIF 提取",
  desc: "解析 JPEG APP1 EXIF 元数据（Make/Model/DateTime/GPS 等；操作文件字节，base64 输入）",
  params: [],
  run: exifExtractRun,
  acceptsBytes: true,
});

register({
  id: "bitplaneSlicing", cat: "image", name: "位平面分解",
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
  id: "imageDiff", cat: "image", name: "图像差异对比",
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
