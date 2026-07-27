/*
 * f5stego.js — F5 JPEG 隐写「提取」（cat:'stego'，run 型单向分析）。
 *
 * 做什么：从一张 F5 隐写的 JPEG 里，用密钥抽出隐藏字节流，输出 hex + ASCII/UTF-8
 * 解读 + 诊断信息（图像结构、DCT 系数统计、F5 容量估计、flag 命中）。
 *
 * ---- 算法来源与忠实度声明（红线：算法不许编造） ----
 * 本文件的 F5 提取逻辑「照抄」自 npm 包 f5stegojs（作者 desudesutalk
 * GitHub: desudesutalk/f5stegojs，MIT 许可，v0.1.2），其 JPEG 熵解码部分又源自
 * Owen Campbell-Moore 的 js-steg / notmasteryet 的 Adobe JPEG 解码器。
 * 逐段对应关系：
 * · shuffleInit = 参考的 f5stego.prototype.shuffleInit（RC4 变体 PRNG
 * 用 key 字节数组初始化 S-box，产出 randPool 伪随机字节流）。
 * · stegShuffle = 参考的 f5stego.prototype.stegShuffle（Fisher-Yates 置换
 * 用 randPool 的 Uint32 视图做随机源；typed-array 分支就地置换）。
 * · parseJpeg = 参考的 f5stego.prototype.parse + decodeScan（JPEG 熵解码
 * 解出各分量的 DCT 系数到 comp.blocks；DC 存 blocksDC 不入 blocks
 * 故 blocks 中每 64 的整数倍位置恒为 0，这正是 F5 跳过 DC 的依据）。
 * · f5extract = 参考的 f5stego.prototype.f5get（先抽 4 bit 定矩阵编码参数 k
 * 再按 (1,2^k-1,k) 矩阵编码提取 hash → 字节流，全程 XOR gamma；
 * 末尾按 2/3 字节长度头截取真实 payload）。
 * 我补充/改动的地方（非算法本身，仅工程适配）：
 * · randPool 大小：参考在构造时按 maxPixels*4.125 一次性分配（默认 66MB）。
 * 本实现改为「先解 JPEG 拿到系数个数 l，再按 l 自适应分配 randPool」
 * 因为 RC4 keystream 是顺序生成、与池总长无关（前缀一致），故置换与 gamma 完全等价。
 * · 输入：兼容项目 acceptsBytes 约定（params.rawBytes 拖入的真字节）+ hex/base64 文本。
 * · key 解析：参考直接吃整数字节数组；本实现按 keyFormat 从文本解析成字节数组。
 * · 只做「提取」；嵌入（embed/f5put/pack）未实现（工程量大且提取才是 CTF 主场景）。
 * 不确定处：F5 有多个互不兼容的实现（原始 Java F5 「F5 v1.1」的口令派生
 * stegdetect 家族等）。本 op 专门匹配 f5stegojs 系嵌入；其他实现产出的样本不保证可解。
 *
 * 红线遵守：
 * - 纯前端零外发：纯 JS，无 node 专属 API，浏览器可跑。
 * - 件内自注册（文件末尾 register(op)）；不改 main.js / i18n。
 * - 报告无 emoji，用黑白几何符号（● ✓ ▸ × ✗ ⚠）。
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析（hex / base64 → Uint8Array）。自备，不 import。
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度需为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function base64ToBytes(s) {
  let str = s.replace(/\s+/g, "");
  const comma = str.indexOf(",");
  if (comma >= 0 && str.slice(0, 5).toLowerCase() === "data:") str = str.slice(comma + 1);
  while (str.length % 4) str += "=";
  let bin;
  if (typeof atob === "function") bin = atob(str);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(str, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 文本 → 字节。inputEnc: 'auto'|'hex'|'base64'。（rawBytes 优先，不走这里） */
function parseInput(text, inputEnc) {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  if (inputEnc === "hex") return hexToBytes(s);
  if (inputEnc === "base64") return base64ToBytes(s);
 // auto：偶数长且全 hex → hex，否则 base64
  const stripped = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0 && stripped.length >= 4) {
    return hexToBytes(s);
  }
  return base64ToBytes(s);
}

// ============================================================
// key 解析：文本 → 字节数组（F5 PRNG 的种子）。
// keyFormat:
// 'auto' : 纯整数列表（逗号/空格分隔）当整数字节；否则当文本取 UTF-8 字节
// 'ints' : 逗号/空格分隔的整数（0-255），如 "1,2,3,4,5,6,7"（f5stegojs 常见写法）
// 'text' : 口令文本，取 UTF-8 字节
// 'hex' : 十六进制字节串
// ============================================================
function parseKey(keyStr, keyFormat) {
  const s = String(keyStr == null ? "" : keyStr);
  if (!s.trim()) throw new Error("F5 需要密钥（key），当前为空");

  const asInts = () => {
    const parts = s.trim().split(/[\s,]+/).filter((x) => x.length);
    const arr = [];
    for (const p of parts) {
      const n = parseInt(p, 10);
      if (!Number.isFinite(n) || n < 0 || n > 255) throw new Error(`key 整数越界或非法: "${p}"（需 0-255）`);
      arr.push(n & 255);
    }
    if (!arr.length) throw new Error("key 整数列表为空");
    return arr;
  };
  const asText = () => {
    if (typeof TextEncoder !== "undefined") return Array.from(new TextEncoder().encode(s));
    const arr = [];
    for (let i = 0; i < s.length; i++) arr.push(s.charCodeAt(i) & 255);
    return arr;
  };
  const asHex = () => Array.from(hexToBytes(s));

  if (keyFormat === "ints") return asInts();
  if (keyFormat === "text") return asText();
  if (keyFormat === "hex") return asHex();
 // auto
  if (/^[\s,]*\d[\d\s,]*$/.test(s)) return asInts();
  return asText();
}

// ============================================================
// F5 PRNG（RC4 变体）+ Fisher-Yates 置换
// 忠实移植自 f5stegojs：shuffleInit / stegShuffle。
// 与参考差异：randPool 尺寸按实际系数个数自适应（见文件头说明）。
// ============================================================
function makeShuffler(key, coeffLen) {
 // randPool 需容纳：Uint32 视图 coeffLen 项（= coeffLen*4 字节，供置换随机源）
 // + gamma 区（从偏移 coeffLen*4 起，长度 ≈ 输出上限 coeffLen/8 字节）。
 // 参考为 maxPixels*4.125；此处按 l*4 + l/8 + 余量，向上取 4 的倍数。
  const l = coeffLen;
  let poolBytes = l * 4 + Math.ceil(l / 8) + 512;
  poolBytes = Math.ceil(poolBytes / 4) * 4;

  const randPool = new ArrayBuffer(poolBytes);
  const rnd = new Uint8Array(randPool);

  if (!key.length) throw new Error("key needed");

  const S = new Uint8Array(256);
  let i = 0, j = 0, t = 0, k = 0;
  for (i = 0; i < 256; ++i) S[i] = i;
  for (i = 0; i < 256; ++i) {
    j = (j + S[i] + key[i % key.length]) & 255;
    t = S[i]; S[i] = S[j]; S[j] = t;
  }
  i = 0; j = 0;
 // 生成 keystream 填满整个 randPool（keystream 顺序生成，与池长无关）
  for (k = 0; k < rnd.length; ++k) {
    i = (i + 1) & 255;
    j = (j + S[i]) & 255;
    t = S[i]; S[i] = S[j]; S[j] = t;
    rnd[k] = S[(t + S[i]) & 255];
  }

  return {
    randPool,
 /**
 * stegShuffle：对传入的 typed 数组就地做 Fisher-Yates 置换
 * 返回 { pm: 同一数组(已置换), gamma: 置换后剩余 keystream 视图 }。
 * 忠实移植参考 typed-array 分支（random_index==k 时也交换，与参考一致）。
 */
    shuffle(pm) {
      const rand32Array = new Uint32Array(randPool);
      const len = pm.length;
      for (let kk = 1; kk < len; kk++) {
        const random_index = rand32Array[kk] % (kk + 1);
        const tmp = pm[kk];
        pm[kk] = pm[random_index];
        pm[random_index] = tmp;
      }
      return { pm, gamma: new Uint8Array(randPool, len * 4) };
    },
  };
}

// ============================================================
// F5 系数统计（忠实移植参考 _analyze），用于容量估计与诊断
// ============================================================
function f5analyze(coeff) {
  let _one = 0, _zero = 0;
  for (let i = 0; i < coeff.length; i++) {
    if (i % 64 === 0) continue;
    if (coeff[i] === 0) _zero++;
    if (coeff[i] === 1 || coeff[i] === -1) _one++;
  }
  const _large = coeff.length - _zero - _one - coeff.length / 64;
  const _ratio = _one / (_large + _one);

  const capacity = [0, ((_large + 0.49 * _one) >> 3) - 1];
  for (let i = 2; i < 17; i++) {
    let k = (1 << i) - 1;
    let usable = _large + _one;
    let embedded = 0;
    while (usable > k) {
      const matched = (usable / k / (1 << i) / (1 << i)) | 0;
      usable -= matched * k;
      const changed = ((usable * (1 - _ratio)) / k * 0.96) | 0;
      usable -= changed * k;
      embedded += changed + matched;
      k++;
    }
    capacity[i] = ((i * embedded) >> 3) - 1;
  }
  return {
    capacity,
    coeff_total: coeff.length,
    coeff_large: _large,
    coeff_zero: _zero,
    coeff_one: _one,
    coeff_one_ratio: _ratio,
  };
}

// ============================================================
// F5 提取（忠实移植参考 f5get）
// 前置：coeff = 目标分量 DCT 系数副本（Int16Array），DC 位（i%64==0）恒为 0。
// 步骤：stegShuffle 就地置换 coeff → 抽 4 bit 定 k → 矩阵编码提取 → XOR gamma
// → 按长度头截取真实 payload。
// ============================================================
function f5extract(coeffSrc, key) {
  const coeff = new Int16Array(coeffSrc.length);
  coeff.set(coeffSrc);

  const shuffler = makeShuffler(key, coeff.length);
  const res = shuffler.shuffle(coeff); // 就地置换 coeff
  const gamma = res.gamma;
  let gammaI = 0;

  let pos = -1;
  let extrBit = 0;
  const cCount = coeff.length - 1;

  let n, k = 0;
  const out = new Uint8Array((coeff.length / 8) | 0);
  let extrByte = 0, outPos = 0, bitsAvail = 0, code = 0, hash = 0;

 // 抽 4 bit 定 k
  while (bitsAvail < 4) {
    pos++;
    if (pos > cCount) throw new Error("系数不足以读出 F5 头（4 bit）——可能无 F5 隐写或密钥/格式不符");
    if (coeff[pos] === 0) continue;
    extrBit = coeff[pos] & 1;
    if (coeff[pos] < 0) extrBit = 1 - extrBit;
    k |= extrBit << bitsAvail;
    bitsAvail++;
  }
  k = (k ^ (gamma[gammaI++] & 15)) + 1;
  n = (1 << k) - 1;
  bitsAvail = 0;

  if (k === 1) {
    while (pos < cCount) {
      pos++;
      if (coeff[pos] === 0) continue;
      extrBit = coeff[pos] & 1;
      if (coeff[pos] < 0) extrBit = 1 - extrBit;
      extrByte |= extrBit << bitsAvail;
      bitsAvail++;
      if (bitsAvail === 8) {
        out[outPos++] = extrByte ^ gamma[gammaI++];
        extrByte = 0;
        bitsAvail = 0;
      }
    }
  } else {
    while (pos < cCount) {
      pos++;
      if (coeff[pos] === 0) continue;
      extrBit = coeff[pos] & 1;
      if (coeff[pos] < 0) extrBit = 1 - extrBit;
      hash ^= extrBit * ++code;
      if (code === n) {
        extrByte |= hash << bitsAvail;
        bitsAvail += k;
        code = 0;
        hash = 0;
        while (bitsAvail >= 8) {
          out[outPos++] = (extrByte & 0xff) ^ gamma[gammaI++];
          bitsAvail -= 8;
          extrByte = extrByte >> 8;
        }
      }
    }
  }
  while (bitsAvail > 0) {
    out[outPos++] = (extrByte & 0xff) ^ gamma[gammaI++];
    bitsAvail -= 8;
    extrByte = extrByte >> 8;
  }

 // 长度头：2 或 3 字节
  if (outPos < 2) throw new Error("提取字节不足，无法解析长度头");
  let s = 2;
  let l = out[0];
  if (out[1] & 128) {
    s++;
    if (outPos < 3) throw new Error("提取字节不足，无法解析 3 字节长度头");
    l += ((out[1] & 127) << 8) + (out[2] << 15);
  } else {
    l += out[1] << 8;
  }

  const declaredLen = l;
  const availLen = out.length - s;
  const payload = out.subarray(s, s + Math.min(l, availLen));
  return {
    payload,
    declaredLen,
    truncated: l > availLen,
    k,
    headerBytes: s,
    rawExtractedBytes: outPos,
  };
}

// ============================================================
// JPEG 熵解码器（忠实移植 f5stegojs 的 parse + decodeScan）
// 仅解出各分量 DCT 系数（comp.blocks）；不做反量化/IDCT/上采样。
// maxPixels：尺寸护栏（默认较大值），与 randPool 无关（randPool 后续按系数个数分配）。
// ============================================================
function parseJpeg(data, maxPixels) {
  maxPixels = maxPixels || 6000 * 6000;
  let offset = 0;

  function _buildHuffmanTable(nrcodes, values) {
    let codevalue = 0, pos_in_table = 0;
    const HT = new Uint16Array(65536);
    for (let k = 0; k < 16; k++) {
      for (let j = 0; j < nrcodes[k]; j++) {
        for (let i = codevalue << (15 - k), cntTo = (codevalue + 1) << (15 - k); i < cntTo; i++) {
          HT[i] = values[pos_in_table] + ((k + 1) << 8);
        }
        pos_in_table++;
        codevalue++;
      }
      codevalue *= 2;
    }
    return HT;
  }

  function decodeScan(data, offset0, frame, components, resetInterval, spectralStart, spectralEnd, successivePrev, successive) {
    const startOffset = offset0;
    offset = offset0;
    let bitsData = 0, bitsCount = 0, eobrun = 0;
    const p1 = 1 << successive;
    const m1 = -1 << successive;

    function decodeBaseline(component, pos) {
      while (bitsCount < 16) {
        bitsData = (bitsData << 8) + (data[offset] | 0);
        bitsCount += 8;
        if (data[offset] === 0xff) offset++;
        offset++;
      }
      let t = component.huffmanTableDC[(bitsData >>> (bitsCount - 16)) & 0xffff];
      if (!t) throw new Error("invalid huffman sequence");
      bitsCount -= t >>> 8;
      t &= 255;

      let diff = 0;
      if (t !== 0) {
        while (bitsCount < t) {
          bitsData = (bitsData << 8) + data[offset++];
          if ((bitsData & 0xff) === 0xff) offset++;
          bitsCount += 8;
        }
        diff = (bitsData >>> (bitsCount - t)) & ((1 << t) - 1);
        bitsCount -= t;
        if (diff < 1 << (t - 1)) diff += (-1 << t) + 1;
      }
      component.blocksDC[pos >> 6] = (component.pred += diff);

      let k = 1, s, r;
      while (k < 64) {
        while (bitsCount < 16) {
          bitsData = (bitsData << 8) + (data[offset] | 0);
          bitsCount += 8;
          if (data[offset] === 0xff) offset++;
          offset++;
        }
        s = component.huffmanTableAC[(bitsData >>> (bitsCount - 16)) & 0xffff];
        if (!s) throw new Error("invalid huffman sequence");
        bitsCount -= s >>> 8;
        r = (s >> 4) & 15;
        s &= 15;
        if (s === 0) {
          if (r < 15) break;
          k += 16;
          continue;
        }
        k += r;
        while (bitsCount < s) {
          bitsData = (bitsData << 8) + data[offset++];
          if ((bitsData & 0xff) === 0xff) offset++;
          bitsCount += 8;
        }
        component.blocks[pos + k] = (bitsData >>> (bitsCount - s)) & ((1 << s) - 1);
        bitsCount -= s;
        if (component.blocks[pos + k] < 1 << (s - 1)) component.blocks[pos + k] += (-1 << s) + 1;
        k++;
      }
    }

    function decodeDCFirst(component, pos) {
      let diff = 0;
      while (bitsCount < 16) {
        bitsData = (bitsData << 8) + (data[offset] | 0);
        bitsCount += 8;
        if (data[offset] === 0xff) offset++;
        offset++;
      }
      let t = component.huffmanTableDC[(bitsData >>> (bitsCount - 16)) & 0xffff];
      if (!t) throw new Error("invalid huffman sequence");
      bitsCount -= t >>> 8;
      t &= 255;
      if (t !== 0) {
        while (bitsCount < t) {
          bitsData = (bitsData << 8) + data[offset++];
          if ((bitsData & 0xff) === 0xff) offset++;
          bitsCount += 8;
        }
        diff = (bitsData >>> (bitsCount - t)) & ((1 << t) - 1);
        bitsCount -= t;
        if (diff < 1 << (t - 1)) diff += (-1 << t) + 1;
      }
      component.blocksDC[pos >> 6] = (component.pred += diff << successive);
    }

    function decodeDCSuccessive(component, pos) {
      if (!bitsCount) {
        bitsData = data[offset++];
        if (bitsData === 0xff) offset++;
        bitsCount = 8;
      }
      component.blocksDC[pos >> 6] |= ((bitsData >>> --bitsCount) & 1) << successive;
    }

    function decodeACFirst(component, pos) {
      if (eobrun > 0) { eobrun--; return; }
      let k = spectralStart, s, r;
      while (k <= spectralEnd) {
        while (bitsCount < 16) {
          bitsData = (bitsData << 8) + (data[offset] | 0);
          bitsCount += 8;
          if (data[offset] === 0xff) offset++;
          offset++;
        }
        s = component.huffmanTableAC[(bitsData >>> (bitsCount - 16)) & 0xffff];
        if (!s) throw new Error("invalid huffman sequence");
        bitsCount -= s >>> 8;
        r = (s >> 4) & 15;
        s &= 15;
        if (s === 0) {
          if (r !== 15) {
            eobrun = (1 << r) - 1;
            if (r) {
              while (bitsCount < r) {
                bitsData = (bitsData << 8) + data[offset++];
                if ((bitsData & 0xff) === 0xff) offset++;
                bitsCount += 8;
              }
              eobrun += (bitsData >>> (bitsCount - r)) & ((1 << r) - 1);
              bitsCount -= r;
            }
            break;
          }
          k += 16;
          continue;
        }
        k += r;
        while (bitsCount < s) {
          bitsData = (bitsData << 8) + data[offset++];
          if ((bitsData & 0xff) === 0xff) offset++;
          bitsCount += 8;
        }
        component.blocks[pos + k] = (bitsData >>> (bitsCount - s)) & ((1 << s) - 1);
        bitsCount -= s;
        if (component.blocks[pos + k] < 1 << (s - 1)) component.blocks[pos + k] += (-1 << s) + 1;
        component.blocks[pos + k] *= p1;
        k++;
      }
    }

    function decodeACSuccessive(component, pos) {
      let k = spectralStart, r, s;
      if (!eobrun) {
        while (k <= spectralEnd) {
          while (bitsCount < 16) {
            bitsData = (bitsData << 8) + (data[offset] | 0);
            bitsCount += 8;
            if (data[offset] === 0xff) offset++;
            offset++;
          }
          s = component.huffmanTableAC[(bitsData >>> (bitsCount - 16)) & 0xffff];
          if (!s) throw new Error("invalid huffman sequence");
          bitsCount -= s >>> 8;
          r = (s >> 4) & 15;
          s &= 15;
          if (s) {
            if (s !== 1) throw new Error("bad jpeg");
            if (!bitsCount) {
              bitsData = data[offset++];
              if (bitsData === 0xff) offset++;
              bitsCount = 8;
            }
            s = ((bitsData >>> --bitsCount) & 1) ? p1 : m1;
          } else {
            if (r !== 15) {
              eobrun = 1 << r;
              if (r) {
                while (bitsCount < r) {
                  bitsData = (bitsData << 8) + data[offset++];
                  if ((bitsData & 0xff) === 0xff) offset++;
                  bitsCount += 8;
                }
                eobrun += (bitsData >>> (bitsCount - r)) & ((1 << r) - 1);
                bitsCount -= r;
              }
              break;
            }
          }
          while (k <= spectralEnd) {
            if (component.blocks[pos + k]) {
              if (!bitsCount) {
                bitsData = data[offset++];
                if (bitsData === 0xff) offset++;
                bitsCount = 8;
              }
              component.blocks[pos + k] += ((bitsData >>> --bitsCount) & 1) * (component.blocks[pos + k] >= 0 ? p1 : m1);
            } else {
              if (--r < 0) break;
            }
            k++;
          }
          if (s) component.blocks[pos + k] = s;
          k++;
        }
      }
      if (eobrun) {
        while (k <= spectralEnd) {
          if (component.blocks[pos + k]) {
            if (!bitsCount) {
              bitsData = data[offset++];
              if (bitsData === 0xff) offset++;
              bitsCount = 8;
            }
            component.blocks[pos + k] += ((bitsData >>> --bitsCount) & 1) * (component.blocks[pos + k] >= 0 ? p1 : m1);
          }
          k++;
        }
        eobrun--;
      }
    }

    let decodeFn;
    if (frame.progressive) {
      if (spectralStart === 0) decodeFn = successivePrev === 0 ? decodeDCFirst : decodeDCSuccessive;
      else decodeFn = successivePrev === 0 ? decodeACFirst : decodeACSuccessive;
    } else {
      decodeFn = decodeBaseline;
    }

    let marker, mcuExpected, i, j, k, n, mcusPerLine, mcusPerRow, x, y;

    if (components.length === 1) {
      mcusPerLine = components[0].blocksPerLine;
      mcusPerRow = components[0].blocksPerColumn;
      mcuExpected = mcusPerRow * mcusPerLine;
      if (!resetInterval) resetInterval = mcuExpected;
      n = resetInterval;
      components[0].pred = 0;
      eobrun = 0;
      for (y = 0; y < mcusPerRow; y++) {
        for (x = 0; x < mcusPerLine; x++) {
          if (!n) {
            n = resetInterval;
            components[0].pred = 0;
            eobrun = 0;
            offset -= (bitsCount / 8) | 0;
            if (data[offset - 1] === 0xff) offset--;
            bitsCount = 0;
            marker = (data[offset] << 8) | data[offset + 1];
            if (marker >= 0xffd0 && marker <= 0xffd7) offset += 2;
            else { if (marker <= 0xff00) throw new Error("bad jpeg"); break; }
          }
          n--;
          for (i = 0; i < components.length; i++) {
            decodeFn(components[i], (y * components[i].blocksPerLineForMcu + x) * 64);
          }
        }
      }
    } else {
      mcusPerLine = frame.mcusPerLine;
      mcusPerRow = frame.mcusPerColumn;
      mcuExpected = mcusPerRow * mcusPerLine;
      if (!resetInterval) resetInterval = mcuExpected;
      n = resetInterval;
      for (i = 0; i < components.length; i++) components[i].pred = 0;
      eobrun = 0;
      for (y = 0; y < mcusPerRow; y++) {
        for (x = 0; x < mcusPerLine; x++) {
          if (!n) {
            n = resetInterval;
            for (i = 0; i < components.length; i++) components[i].pred = 0;
            eobrun = 0;
            offset -= (bitsCount / 8) | 0;
            if (data[offset - 1] === 0xff) offset--;
            bitsCount = 0;
            marker = (data[offset] << 8) | data[offset + 1];
            if (marker >= 0xffd0 && marker <= 0xffd7) offset += 2;
            else { if (marker <= 0xff00) throw new Error("bad jpeg"); break; }
          }
          n--;
          for (i = 0; i < components.length; i++) {
            for (j = 0; j < components[i].v; j++) {
              for (k = 0; k < components[i].h; k++) {
                decodeFn(components[i], ((y * components[i].v + j) * components[i].blocksPerLineForMcu + x * components[i].h + k) * 64);
              }
            }
          }
        }
      }
    }
    offset -= (bitsCount / 8) | 0;
    if (data[offset - 1] === 0xff) offset--;
    return offset - startOffset;
  }

  function readUint16() {
    const value = (data[offset] << 8) | data[offset + 1];
    offset += 2;
    return value;
  }
  function readDataBlock() {
    const length = readUint16();
    const array = data.subarray(offset, offset + length - 2);
    offset += array.length;
    return array;
  }

  const self = { _raw: data, jfif: null, APPn: [], qts: [], frame: null, tail: null };

  let markerHi, markerLo, i, j, resetInterval, component;
  const huffmanTablesAC = [], huffmanTablesDC = [];

  while (1) {
    if (offset >= data.length) throw new Error("unexpected EOF");
    markerHi = data[offset++];
    markerLo = data[offset++];

    if (markerHi === 0xff) {
      if (markerLo === 0xe0) self.jfif = readDataBlock();
      if ((markerLo > 0xe0 && markerLo < 0xf0) || markerLo === 0xfe) {
        self.APPn.push({ app: markerLo, data: readDataBlock() });
      }
      if (markerLo === 0xdb) self.qts.push(readDataBlock());

      if (markerLo >= 0xc0 && markerLo <= 0xc2) {
        if (self.frame) throw new Error("Only single frame JPEGs supported");
        readUint16();
        self.frame = {
          extended: markerLo === 0xc1,
          progressive: markerLo === 0xc2,
          precision: data[offset++],
          scanLines: readUint16(),
          samplesPerLine: readUint16(),
          components: [],
          componentIds: {},
          maxH: 1, maxV: 1,
        };
        if (self.frame.scanLines * self.frame.samplesPerLine > maxPixels) throw new Error("Image is too big.");
        const componentsCount = data[offset++];
        let componentId, maxH = 0, maxV = 0;
        for (i = 0; i < componentsCount; i++) {
          componentId = data[offset];
          const h = data[offset + 1] >> 4;
          const v = data[offset + 1] & 15;
          if (maxH < h) maxH = h;
          if (maxV < v) maxV = v;
          const qId = data[offset + 2];
          const l = self.frame.components.push({ componentId, h, v, quantizationTable: qId });
          self.frame.componentIds[componentId] = l - 1;
          offset += 3;
        }
        self.frame.maxH = maxH;
        self.frame.maxV = maxV;
        const mcusPerLine = Math.ceil(self.frame.samplesPerLine / 8 / maxH);
        const mcusPerColumn = Math.ceil(self.frame.scanLines / 8 / maxV);
        for (i = 0; i < self.frame.components.length; i++) {
          component = self.frame.components[i];
          const blocksPerLine = Math.ceil((Math.ceil(self.frame.samplesPerLine / 8) * component.h) / maxH);
          const blocksPerColumn = Math.ceil((Math.ceil(self.frame.scanLines / 8) * component.v) / maxV);
          const blocksPerLineForMcu = mcusPerLine * component.h;
          const blocksPerColumnForMcu = mcusPerColumn * component.v;
          component.blocks = new Int16Array(blocksPerColumnForMcu * blocksPerLineForMcu * 64);
          component.blocksDC = new Int16Array(blocksPerColumnForMcu * blocksPerLineForMcu);
          component.blocksPerLine = blocksPerLine;
          component.blocksPerColumn = blocksPerColumn;
          component.blocksPerLineForMcu = blocksPerLineForMcu;
          component.blocksPerColumnForMcu = blocksPerColumnForMcu;
        }
        self.frame.mcusPerLine = mcusPerLine;
        self.frame.mcusPerColumn = mcusPerColumn;
      }

      if (markerLo === 0xc4) {
        const huffmanLength = readUint16();
        for (i = 2; i < huffmanLength;) {
          const huffmanTableSpec = data[offset++];
          const codeLengths = new Uint8Array(16);
          let codeLengthSum = 0;
          for (j = 0; j < 16; j++, offset++) codeLengthSum += (codeLengths[j] = data[offset]);
          const huffmanValues = new Uint8Array(codeLengthSum);
          for (j = 0; j < codeLengthSum; j++, offset++) huffmanValues[j] = data[offset];
          i += 17 + codeLengthSum;
          ((huffmanTableSpec >> 4) === 0 ? huffmanTablesDC : huffmanTablesAC)[huffmanTableSpec & 15] =
            _buildHuffmanTable(codeLengths, huffmanValues);
        }
      }

      if (markerLo === 0xdd) resetInterval = readUint16();

      if (markerLo === 0xda) {
        readUint16();
        const selectorsCount = data[offset++];
        const components = [];
        for (i = 0; i < selectorsCount; i++) {
          const componentIndex = self.frame.componentIds[data[offset++]];
          component = self.frame.components[componentIndex];
          const tableSpec = data[offset++];
          component.huffmanTableDC = huffmanTablesDC[tableSpec >> 4];
          component.huffmanTableAC = huffmanTablesAC[tableSpec & 15];
          components.push(component);
        }
        const spectralStart = data[offset++];
        const spectralEnd = data[offset++];
        const successiveApproximation = data[offset++];
 // 注意：本 port 的 decodeScan 直接推进外层 offset（参考实现用参数遮蔽的局部 offset
 // 故参考需 offset += processed；此处 offset 已被推进到扫描末尾，不能再加，否则越界 EOF）。
        decodeScan(data, offset, self.frame, components, resetInterval,
          spectralStart, spectralEnd, successiveApproximation >> 4, successiveApproximation & 15);
      }

      if (markerLo === 0xd9) break;
    } else {
      if (data[offset - 3] === 0xff && data[offset - 2] >= 0xc0 && data[offset - 2] <= 0xfe) {
        offset -= 3;
      }
      while (data[offset] !== 0xff && offset < data.length) offset++;
      if (data[offset] !== 0xff) throw new Error("bad jpeg");
    }
  }

  if (!self.frame) throw new Error("bad jpeg");
  if (offset < data.length) self.tail = data.subarray(offset);
  return self;
}

/** 取 F5 目标分量（优先 componentId==1，即亮度 Y）。 */
function pickComponent(frame) {
  let comp = frame.components[0];
  if (comp.componentId !== 1) {
    for (let i = 0; i < frame.components.length; i++) {
      if (frame.components[i].componentId === 1) { comp = frame.components[i]; break; }
    }
  }
  return comp;
}

// ============================================================
// 报告小工具
// ============================================================
function bytesToHex(b, max) {
  const n = max == null ? b.length : Math.min(b.length, max);
  let s = "";
  for (let i = 0; i < n; i++) s += b[i].toString(16).padStart(2, "0");
  if (b.length > n) s += "…";
  return s;
}

function bytesToAsciiPreview(b, max) {
  const n = max == null ? b.length : Math.min(b.length, max);
  let s = "";
  for (let i = 0; i < n; i++) {
    const c = b[i];
    s += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : "·";
  }
  if (b.length > n) s += "…";
  return s;
}

function bytesToUtf8(b) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(b); }
  catch { let s = ""; for (const x of b) s += String.fromCharCode(x); return s; }
}

const FLAG_RE = /(?:flag|ctf|key|pass|secret)\s*\{[^}\n]{0,200}\}/gi;
const GENERIC_BRACE_RE = /[A-Za-z][A-Za-z0-9_]{1,20}\{[^}\n]{1,200}\}/g;
function findFlags(text) {
  const hits = new Set();
  let m;
  FLAG_RE.lastIndex = 0;
  while ((m = FLAG_RE.exec(text)) !== null) hits.add(m[0]);
  GENERIC_BRACE_RE.lastIndex = 0;
  while ((m = GENERIC_BRACE_RE.exec(text)) !== null) {
    if (/flag|ctf|key|pass|secret/i.test(m[0])) hits.add(m[0]);
  }
  return [...hits];
}

// ============================================================
// run 主入口
// ============================================================
function f5stegoRun(text, p) {
  const inputEnc = (p && p.inputEnc) || "auto";
  const keyFormat = (p && p.keyFormat) || "auto";
  const outEnc = (p && p.outEnc) || "auto";
  const maxHex = Math.max(16, Math.min(65536, parseInt((p && p.maxHex) || "512", 10) || 512));

  const L = [];
  L.push("=== F5 JPEG 隐写提取 ===");
  L.push("");

 // ---- 取字节：优先 rawBytes（acceptsBytes 拖入），否则 hex/base64 文本 ----
  let bytes;
  if (p && p.rawBytes && p.rawBytes.length) {
    bytes = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  } else {
    try {
      bytes = parseInput(text, inputEnc);
    } catch (e) {
      L.push("✗ 输入解析失败: " + (e.message || String(e)));
      L.push("  提示：拖入 JPEG 文件，或粘贴其 hex / base64。");
      return L.join("\n");
    }
  }
  if (!bytes || bytes.length === 0) {
    L.push("✗ 输入为空。请拖入 F5 隐写的 JPEG 文件，或粘贴其 hex / base64。");
    return L.join("\n");
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    L.push(`⚠ 未见 JPEG SOI(FF D8) 头（首字节 ${bytes[0].toString(16).padStart(2, "0")} ${(bytes[1] || 0).toString(16).padStart(2, "0")}）——可能非 JPEG，仍尝试解析。`);
  }

 // ---- 解析 key ----
  let key;
  try {
    key = parseKey(p && p.key, keyFormat);
  } catch (e) {
    L.push("✗ 密钥解析失败: " + (e.message || String(e)));
    L.push("  F5(f5stegojs) 用整数字节数组做种子。keyFormat=ints 时形如 \"1,2,3,4,5,6,7\"；");
    L.push("  =text 时按口令 UTF-8 字节；=hex 时按十六进制。");
    return L.join("\n");
  }
  L.push(`● 输入字节: ${bytes.length}`);
  L.push(`● 密钥: ${key.length} 字节 [${key.slice(0, 32).join(",")}${key.length > 32 ? ",…" : ""}]（keyFormat=${keyFormat}）`);
  L.push("");

 // ---- 解 JPEG ----
  let jpeg;
  try {
    jpeg = parseJpeg(bytes);
  } catch (e) {
    L.push("✗ JPEG 熵解码失败: " + (e.message || String(e)));
    L.push("  可能是：非 JPEG / 罕见特性 / 文件损坏。F5 提取需要能完整解出 DCT 系数。");
    return L.join("\n");
  }

  const fr = jpeg.frame;
  L.push("--- JPEG 结构 ---");
  L.push(`● 尺寸: ${fr.samplesPerLine} × ${fr.scanLines}  精度: ${fr.precision} bit`);
  L.push(`● 类型: ${fr.progressive ? "渐进式 Progressive" : fr.extended ? "扩展 Extended" : "基线 Baseline"}  分量数: ${fr.components.length}`);
  const compDesc = fr.components.map((c) => `id=${c.componentId}(${c.h}x${c.v})`).join("  ");
  L.push(`● 分量: ${compDesc}`);
  if (jpeg.tail && jpeg.tail.length) L.push(`● EOI 后附加数据(tail): ${jpeg.tail.length} 字节（F5 无关，但可能另藏数据）`);
  L.push("");

  const comp = pickComponent(fr);
  const coeff = comp.blocks;
  L.push(`--- F5 目标分量（Y, componentId=${comp.componentId}） ---`);
  L.push(`● DCT 系数总数: ${coeff.length}`);
  let stats;
  try {
    stats = f5analyze(coeff);
    L.push(`● 非零/±1/零: large=${stats.coeff_large}  one(±1)=${stats.coeff_one}  zero=${stats.coeff_zero}`);
    L.push(`● ±1 占比: ${(stats.coeff_one_ratio * 100).toFixed(2)}%`);
    const capK1 = stats.capacity[1];
    L.push(`● F5 容量估计: k=1 约 ${capK1} 字节；各 k 上限 [${stats.capacity.slice(1).map((x) => (x < 0 ? 0 : x)).join(",")}]`);
  } catch (e) {
    L.push(`⚠ 系数统计失败: ${e.message || e}`);
  }
  L.push("");

 // ---- F5 提取 ----
  L.push("--- F5 提取 ---");
  let ext;
  try {
    ext = f5extract(coeff, key);
  } catch (e) {
    L.push("✗ 提取失败: " + (e.message || String(e)));
    L.push("  常见原因：密钥/keyFormat 不对，或该 JPEG 非 f5stegojs 系 F5 隐写。");
    return L.join("\n");
  }

  const payload = ext.payload;
  L.push(`● 矩阵编码参数 k = ${ext.k}（(1, ${(1 << ext.k) - 1}, ${ext.k}) 编码）`);
  L.push(`● 长度头声明 payload = ${ext.declaredLen} 字节（头占 ${ext.headerBytes} 字节，原始抽出 ${ext.rawExtractedBytes} 字节）`);
  if (ext.truncated) {
    L.push(`  ⚠ 声明长度 > 实际可用，已截断到 ${payload.length} 字节。密钥可能不对，或数据被破坏。`);
  }
  L.push(`● 实取 payload: ${payload.length} 字节`);
  L.push("");

 // 合理性启发：声明长度是否离谱
  if (ext.declaredLen > coeff.length) {
    L.push("⚠ 声明长度大于系数总数，极可能密钥/格式不匹配（提取到的是噪声）。");
    L.push("");
  }

 // ---- 输出 ----
  L.push("--- 提取结果 ---");
  L.push(`● Hex（前 ${maxHex} 字节）:`);
  L.push("  " + bytesToHex(payload, maxHex));
  L.push("");

  const asciiPrev = bytesToAsciiPreview(payload, Math.min(payload.length, 1024));
  const utf8Str = bytesToUtf8(payload);
  if (outEnc === "hex") {
 // 只 hex，上面已给
  } else {
    L.push("● ASCII 预览:");
    L.push("  " + asciiPrev);
    L.push("");
    L.push("● UTF-8 解读:");
    L.push("  " + (utf8Str.length > 2048 ? utf8Str.slice(0, 2048) + " …" : utf8Str));
    L.push("");
  }

 // ---- flag 命中 ----
  const flagHits = new Set();
  for (const f of findFlags(asciiPrev)) flagHits.add(f);
  for (const f of findFlags(utf8Str)) flagHits.add(f);
  L.push("--- flag 命中 ---");
  if (flagHits.size) {
    for (const f of flagHits) L.push("  ✓✓ " + f);
  } else {
    L.push("  × 未命中 flag{}/ctf{} 等格式。");
    L.push("  提示：① 确认密钥与 keyFormat（ints/text/hex）② payload 可能是压缩包/图片，看 hex 魔数");
    L.push("        ③ 该样本可能非 f5stegojs 系 F5（原始 Java F5 口令派生不同，本 op 不解）。");
  }
  L.push("");
  L.push("说明:");
  L.push("  · 本 op 只做 F5 提取（run 型），纯本地计算、零外发。");
  L.push("  · 算法忠实移植自 f5stegojs（desudesutalk, MIT）；仅匹配该系嵌入。");
  L.push("  · 无隐写/密钥错误时，提取到的是伪随机噪声，长度头会显得离谱——据此判断成败。");
  return L.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "f5stego",
  cat: "stego",
  name: "F5 JPEG 隐写提取",
  desc: "从 F5(f5stegojs 系) 隐写的 JPEG 中用密钥提取隐藏字节流：熵解码取 DCT 系数 → 密钥置换 → (1,2^k-1,k) 矩阵编码提取 → 输出 hex/ASCII/UTF-8 + F5 容量诊断 + flag 命中。纯前端，仅提取不嵌入",
  acceptsBytes: true,
  params: [
    {
      key: "key", label: "密钥(F5 种子)", type: "text", default: "",
      placeholder: "整数列表如 1,2,3,4,5,6,7 或口令文本",
    },
    {
      key: "keyFormat", label: "密钥格式", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（纯数字→整数列表，否则文本）" },
        { value: "ints", label: "整数列表（逗号/空格分隔 0-255）" },
        { value: "text", label: "口令文本（UTF-8 字节）" },
        { value: "hex", label: "Hex 字节串" },
      ],
    },
    {
      key: "inputEnc", label: "文本输入编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
    {
      key: "outEnc", label: "输出偏好", type: "select", default: "auto",
      options: [
        { value: "auto", label: "hex + ASCII + UTF-8" },
        { value: "hex", label: "仅 hex" },
      ],
    },
    { key: "maxHex", label: "Hex 显示最大字节数", type: "number", default: 512, placeholder: "16-65536" },
  ],
  run: f5stegoRun,
});

export {
  f5stegoRun,
  parseInput,
  parseKey,
  makeShuffler,
  f5analyze,
  f5extract,
  parseJpeg,
  pickComponent,
  findFlags,
};
