/*
 * snow.js — SNOW 行尾空白隐写（原版 mattkwan/snow 格式移植）。
 *
 * 本实现逐行对照 Matthew Kwan 的 snow 原版源码（Apache-2.0，20130616 版）移植：
 *   encode.c   行尾空白编码：前导 TAB 标记数据起点；每 3 bit 值 v 位反转后
 *              编码为「TAB + v 个空格」；tabpos 8 列对齐；line_length（默认 80）
 *              约束行宽，超宽自动换行，容器耗尽则追加空行。
 *   main.c     消息按字节 MSB-first 逐位送入管道（原版无长度头，靠 bit 残差自然截断）。
 *   compress.c -C 时按固定 Huffman 表（huffcode.h，256 项）压缩。
 *   encrypt.c  -p 时用 ICE 密码在 1-bit CFB 模式加密；密钥由密码每字符取低 7 位
 *              位packing而成，IV = ICE 加密(密钥材料前 8 字节)。
 *   ice.c      ICE 加密算法（S 盒/P 盒/key schedule 完整移植）。
 *
 * 与旧版自造方言（每 bit Space=0/Tab=1 + 32bit 长度头）完全不兼容；
 * 本文件已整体替换为原版格式，旧产物不可再解（取舍见版本更新记录）。
 *
 * 算法来源：github.com/mattkwan/snow（encode.c/main.c/compress.c/encrypt.c/ice.c）。
 * 对拍验证：与 tools/exe/cli/snow.exe 三档（明文 / -C / -p）双向互通，见回执。
 */
import { register } from "./registry.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

/* ------------------------------------------------------------------ *
 * ICE 加密算法（ice.c 完整移植）
 * ------------------------------------------------------------------ */

const ICE_SMOD = [
	[333, 313, 505, 369],
	[379, 375, 319, 391],
	[361, 445, 451, 397],
	[397, 425, 395, 505],
];

const ICE_SXOR = [
	[0x83, 0x85, 0x9b, 0xcd],
	[0xcc, 0xa7, 0xad, 0x41],
	[0x4b, 0x2e, 0xd4, 0x33],
	[0xea, 0xcb, 0x2e, 0x04],
];

const ICE_PBOX = [
	0x00000001, 0x00000080, 0x00000400, 0x00002000,
	0x00080000, 0x00200000, 0x01000000, 0x40000000,
	0x00000008, 0x00000020, 0x00000100, 0x00004000,
	0x00010000, 0x00800000, 0x04000000, 0x20000000,
	0x00000004, 0x00000010, 0x00000200, 0x00008000,
	0x00020000, 0x00400000, 0x08000000, 0x10000000,
	0x00000002, 0x00000040, 0x00000800, 0x00001000,
	0x00040000, 0x00100000, 0x02000000, 0x80000000,
];

const ICE_KEYROT = [0, 1, 2, 3, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 0, 2];

/* Galois Field (2^8) multiplication of a by b, modulo m. */
function gfMult(a, b, m) {
	let res = 0;
	while (b) {
		if (b & 1) res ^= a;
		a <<= 1;
		b >>= 1;
		if (a >= 256) a ^= m;
	}
	return res;
}

/* Galois Field exponentiation: base^7 mod m. */
function gfExp7(b, m) {
	if (b === 0) return 0;
	let x = gfMult(b, b, m);
	x = gfMult(b, x, m);
	x = gfMult(x, x, m);
	return gfMult(b, x, m);
}

/* ICE 32-bit P-box permutation. */
function icePerm32(x) {
	let res = 0;
	let i = 0;
	while (x) {
		if (x & 1) res |= ICE_PBOX[i];
		i++;
		x >>>= 1;
	}
	return res >>> 0;
}

let iceSbox = null;

function iceSboxesInit() {
	iceSbox = [[], [], [], []];
	for (let i = 0; i < 1024; i++) {
		const col = (i >> 1) & 0xff;
		const row = (i & 0x1) | ((i & 0x200) >> 8);
		let x = (gfExp7(col ^ ICE_SXOR[0][row], ICE_SMOD[0][row]) << 24) >>> 0;
		iceSbox[0][i] = icePerm32(x);
		x = (gfExp7(col ^ ICE_SXOR[1][row], ICE_SMOD[1][row]) << 16) >>> 0;
		iceSbox[1][i] = icePerm32(x);
		x = (gfExp7(col ^ ICE_SXOR[2][row], ICE_SMOD[2][row]) << 8) >>> 0;
		iceSbox[2][i] = icePerm32(x);
		x = gfExp7(col ^ ICE_SXOR[3][row], ICE_SMOD[3][row]) >>> 0;
		iceSbox[3][i] = icePerm32(x);
	}
}

/* 单轮 f 函数（32 位运算，结果为 int32 位型，与 C 一致由 >>> 提取字节） */
function iceF(p, sk) {
	/* 左半 40-bit 展开 */
	const tl = ((p >>> 16) & 0x3ff) | ((((p >>> 14) | (p << 18))) & 0xffc00);
	/* 右半 40-bit 展开 */
	const tr = (p & 0x3ff) | ((p << 2) & 0xffc00);
	/* salt 置换 */
	let al = (sk[2] & (tl ^ tr)) | 0;
	let ar = (al ^ tr) | 0;
	al = (al ^ tl) | 0;
	al = (al ^ sk[0]) | 0;
	ar = (ar ^ sk[1]) | 0;
	return (iceSbox[0][al >>> 10] | iceSbox[1][al & 0x3ff]
		| iceSbox[2][ar >>> 10] | iceSbox[3][ar & 0x3ff]) | 0;
}

class IceKey {
	constructor(n) {
		if (!iceSbox) iceSboxesInit();
		this.size = n < 1 ? 1 : n;
		this.rounds = n < 1 ? 8 : n * 16;
		this.keysched = [];
		for (let i = 0; i < this.rounds; i++) this.keysched.push([0, 0, 0]);
	}

	/* 设置 8 轮 [n, n+7] 的 key schedule */
	schedBuild(kb, n, keyrot) {
		for (let i = 0; i < 8; i++) {
			const kr = keyrot[i];
			const isk = this.keysched[n + i];
			isk[0] = isk[1] = isk[2] = 0;
			for (let j = 0; j < 15; j++) {
				const si = j % 3;
				for (let k = 0; k < 4; k++) {
					const ki = (kr + k) & 3;
					const bit = kb[ki] & 1;
					isk[si] = ((isk[si] << 1) | bit) | 0;
					kb[ki] = ((kb[ki] >> 1) | ((bit ^ 1) << 15)) & 0xffff;
				}
			}
		}
	}

	/* key: 字节数组（16 * size 字节） */
	set(key) {
		if (this.rounds === 8) {
			const kb = [0, 0, 0, 0];
			for (let i = 0; i < 4; i++)
				kb[3 - i] = (key[i * 2] << 8) | key[i * 2 + 1];
			this.schedBuild(kb, 0, ICE_KEYROT);
			return;
		}
		for (let i = 0; i < this.size; i++) {
			const kb = [0, 0, 0, 0];
			for (let j = 0; j < 4; j++)
				kb[3 - j] = (key[i * 8 + j * 2] << 8) | key[i * 8 + j * 2 + 1];
			this.schedBuild(kb, i * 8, ICE_KEYROT);
			this.schedBuild(kb, this.rounds - 8 - i * 8, ICE_KEYROT.slice(8));
		}
	}

	/* 加密 8 字节块 */
	encrypt(ptext, poff, ctext, coff) {
		let l = ((ptext[poff] << 24) | (ptext[poff + 1] << 16) | (ptext[poff + 2] << 8) | ptext[poff + 3]) | 0;
		let r = ((ptext[poff + 4] << 24) | (ptext[poff + 5] << 16) | (ptext[poff + 6] << 8) | ptext[poff + 7]) | 0;
		for (let i = 0; i < this.rounds; i += 2) {
			l = (l ^ iceF(r, this.keysched[i])) | 0;
			r = (r ^ iceF(l, this.keysched[i + 1])) | 0;
		}
		for (let i = 0; i < 4; i++) {
			ctext[coff + 3 - i] = r & 0xff;
			ctext[coff + 7 - i] = l & 0xff;
			r >>>= 8;
			l >>>= 8;
		}
	}
}

/* ------------------------------------------------------------------ *
 * 密码 → ICE 密钥 + IV（encrypt.c password_set 移植，仅取字符低 7 位）
 * ------------------------------------------------------------------ */

function makeIceKeyFromPassword(passwd) {
	const chars = [];
	for (const ch of passwd) {
		const c = ch.charCodeAt(0) & 0x7f;
		chars.push(c);
	}
	let level = Math.floor((chars.length * 7 + 63) / 64);
	if (level === 0) level = 1;
	else if (level > 128) level = 128;

	const key = new IceKey(level);

	const buf = new Uint8Array(1024);
	let i = 0;
	for (const c of chars) {
		const idx = Math.floor(i / 8);
		const bit = i & 7;
		if (bit === 0) {
			buf[idx] = (c << 1) & 0xff;
		} else if (bit === 1) {
			buf[idx] |= c;
		} else {
			buf[idx] |= (c >> (bit - 1)) & 0xff;
			buf[idx + 1] = (c << (9 - bit)) & 0xff;
		}
		i += 7;
		if (i > 8184) break;
	}

	key.set(buf);

	/* IV = 用密钥加密密钥材料前 8 字节 */
	const iv = new Uint8Array(8);
	key.encrypt(buf, 0, iv, 0);
	return { key, iv };
}

/* ------------------------------------------------------------------ *
 * Huffman 压缩（compress.c + huffcode.h 移植，256 项固定码表）
 * ------------------------------------------------------------------ */

const HUFFCODES = [
	"010011101110011001000", "010011101110011001001", "010011101110011001010", "010011101110011001011",
	"010011101110011001100", "010011101110011001101", "010011101110011001110", "010011101110011001111",
	"101100010101", "0100100", "101101", "010011101110011010000",
	"0100111011100111", "010011101110011010001", "010011101110011010010", "010011101110011010011",
	"010011101110011010100", "010011101110011010101", "010011101110011010110", "010011101110011010111",
	"010011101110011011000", "010011101110011011001", "010011101110011011010", "010011101110011011011",
	"010011101110011011100", "010011101110011011101", "010011101110011011110", "010011101110001",
	"010011101110011011111", "01001110111000000000", "01001110111000000001", "01001110111000000010",
	"111", "0100101000", "101100100", "10111111111",
	"101111010010", "1011000101000", "0010100010101", "00101011",
	"101111110", "00100011", "010010101", "101111010011",
	"1010110", "10111110", "101000", "101111001",
	"0010000", "01001011", "101100101", "001010101",
	"001010011", "1011110111", "1011001100", "0100101001",
	"1010011001", "001010000", "101111000", "10111111110",
	"01001110110", "10100101010", "10111101000", "1010010100",
	"0010100011", "01001111", "1011110110", "101100011",
	"101001101", "00100010", "001010010", "1011000000",
	"1011001101", "0111000", "10110000011", "10110001011",
	"001010100", "101100111", "101001011", "101100001",
	"010011100", "1010011110001", "101001110", "10100100",
	"10101110", "1011110101", "10100111101", "1011000100",
	"10110000010", "0100111010", "010011101111", "101001111001",
	"001010001011", "101001010111", "1011000101001", "10111111100",
	"00101000100", "0101", "001001", "110110",
	"01000", "1100", "101010", "011101",
	"10001", "0011", "1010011111", "0100110",
	"01111", "101110", "0001", "0110",
	"100001", "10111111101", "11010", "0000",
	"1001", "110111", "0111001", "001011",
	"10101111", "100000", "1010011000", "1010011110000",
	"101001010110", "0100111011101", "0010100010100", "01001110111000000011",
	"010011101110000001000", "010011101110000001001", "010011101110000001010", "010011101110000001011",
	"010011101110000001100", "010011101110000001101", "010011101110000001110", "010011101110000001111",
	"010011101110000010000", "010011101110000010001", "010011101110000010010", "010011101110000010011",
	"010011101110000010100", "010011101110000010101", "010011101110000010110", "010011101110000010111",
	"010011101110000011000", "010011101110000011001", "010011101110000011010", "010011101110000011011",
	"010011101110000011100", "010011101110000011101", "010011101110000011110", "010011101110000011111",
	"010011101110000100000", "010011101110000100001", "010011101110000100010", "010011101110000100011",
	"010011101110000100100", "010011101110000100101", "010011101110000100110", "010011101110000100111",
	"010011101110000101000", "010011101110000101001", "010011101110000101010", "010011101110000101011",
	"010011101110000101100", "010011101110000101101", "010011101110000101110", "010011101110000101111",
	"010011101110000110000", "010011101110000110001", "010011101110000110010", "010011101110000110011",
	"010011101110000110100", "010011101110000110101", "010011101110000110110", "010011101110000110111",
	"010011101110000111000", "010011101110000111001", "010011101110000111010", "010011101110000111011",
	"010011101110000111100", "010011101110000111101", "010011101110000111110", "010011101110000111111",
	"010011101110010000000", "010011101110010000001", "010011101110010000010", "010011101110010000011",
	"010011101110010000100", "010011101110010000101", "010011101110010000110", "010011101110010000111",
	"010011101110010001000", "010011101110010001001", "010011101110010001010", "010011101110010001011",
	"010011101110010001100", "010011101110010001101", "010011101110010001110", "010011101110010001111",
	"010011101110010010000", "010011101110010010001", "010011101110010010010", "010011101110010010011",
	"010011101110010010100", "010011101110010010101", "010011101110010010110", "010011101110010010111",
	"010011101110010011000", "010011101110010011001", "010011101110010011010", "010011101110010011011",
	"010011101110010011100", "010011101110010011101", "010011101110010011110", "010011101110010011111",
	"010011101110010100000", "010011101110010100001", "010011101110010100010", "010011101110010100011",
	"010011101110010100100", "010011101110010100101", "010011101110010100110", "010011101110010100111",
	"010011101110010101000", "010011101110010101001", "010011101110010101010", "010011101110010101011",
	"010011101110010101100", "010011101110010101101", "010011101110010101110", "010011101110010101111",
	"010011101110010110000", "010011101110010110001", "010011101110010110010", "010011101110010110011",
	"010011101110010110100", "010011101110010110101", "010011101110010110110", "010011101110010110111",
	"010011101110010111000", "010011101110010111001", "010011101110010111010", "010011101110010111011",
	"010011101110010111100", "010011101110010111101", "010011101110010111110", "010011101110010111111",
	"010011101110011000000", "010011101110011000001", "010011101110011000010", "010011101110011000011",
	"010011101110011000100", "010011101110011000101", "010011101110011000110", "010011101110011000111",
];

/* 解压用反查表：码串 → 字节 */
let HUFF_REV = null;
function huffRev() {
	if (!HUFF_REV) {
		HUFF_REV = new Map();
		for (let i = 0; i < 256; i++) HUFF_REV.set(HUFFCODES[i], i);
	}
	return HUFF_REV;
}

/* ------------------------------------------------------------------ *
 * 行尾空白编码（encode.c 移植）
 * ------------------------------------------------------------------ */

function tabpos(n) {
	return (n + 8) & ~7;
}

/* UTF-8 字节长度（容器列宽按字节计，与 C 行为一致） */
function utf8Len(ch) {
	const c = ch.charCodeAt(0);
	if (c < 0x80) return 1;
	if (c < 0x800) return 2;
	if (c >= 0xd800 && c <= 0xdbff) return 4; /* 代理对（按整体算 4 字节） */
	if (c >= 0xdc00 && c <= 0xdfff) return 0; /* 低位代理已被高位计入 */
	return 3;
}

/*
 * 空白编码器：把 3bit 值流写进容器行尾。
 * lines: 容器行数组（不含行尾符，行尾空白会被剥除，与 wsgets 一致）。
 * lineLength: 最大行宽（按 UTF-8 字节列计，默认 80）。
 */
function WhitespaceEncoder(lines, lineLength) {
	this.lines = lines.map((l) => l.replace(/[ \t\r]+$/, ""));
	this.lineIdx = 0;
	this.lineLength = lineLength;
	this.buf = "";
	this.len = 0;
	this.col = 0;
	this.loaded = false;
	this.needsTab = false;
	this.firstTab = false;
	this.out = [];
	this.value = 0;
	this.bitCount = 0;
}

WhitespaceEncoder.prototype.loadBuffer = function () {
	if (this.lineIdx < this.lines.length) {
		this.buf = this.lines[this.lineIdx++];
	} else {
		this.buf = "";
	}
	this.len = this.buf.length;
	this.col = 0;
	for (let i = 0; i < this.len; i++) {
		this.col = this.buf[i] === "\t" ? tabpos(this.col) : this.col + utf8Len(this.buf[i]);
	}
	this.loaded = true;
	this.needsTab = false;
};

WhitespaceEncoder.prototype.puts = function () {
	this.out.push(this.buf);
};

/* 追加一段空白；行宽放不下返回 false 由调用方换行重试 */
WhitespaceEncoder.prototype.appendWhitespace = function (nsp) {
	let c = this.col;
	if (this.needsTab) c = tabpos(c);
	if (nsp === 0) c = tabpos(c);
	else c += nsp;
	if (c >= this.lineLength) return false;
	if (this.needsTab) {
		this.buf += "\t";
		this.col = tabpos(this.col);
	}
	if (nsp === 0) {
		this.buf += "\t";
		this.col = tabpos(this.col);
		this.needsTab = false;
	} else {
		for (let i = 0; i < nsp; i++) this.buf += " ";
		this.col += nsp;
		this.needsTab = true;
	}
	return true;
};

WhitespaceEncoder.prototype.writeValue = function (val) {
	if (!this.loaded) this.loadBuffer();
	if (!this.firstTab) { /* TAB 标记数据起点 */
		while (tabpos(this.col) >= this.lineLength) {
			this.puts();
			this.loadBuffer();
		}
		this.buf += "\t";
		this.col = tabpos(this.col);
		this.firstTab = true;
	}
	/* 位反转：encode.c nspc = ((val&1)<<2) | (val&2) | ((val&4)>>2) */
	const nspc = ((val & 1) << 2) | (val & 2) | ((val & 4) >> 2);
	while (!this.appendWhitespace(nspc)) {
		this.puts();
		this.loadBuffer();
	}
};

WhitespaceEncoder.prototype.writeBit = function (bit) {
	this.value = ((this.value << 1) | bit) & 0xffffffff;
	if (++this.bitCount === 3) {
		this.writeValue(this.value);
		this.value = 0;
		this.bitCount = 0;
	}
};

WhitespaceEncoder.prototype.flush = function () {
	if (this.bitCount > 0) { /* 补零对齐 3bit */
		while (this.bitCount < 3) {
			this.value <<= 1;
			this.bitCount++;
		}
		this.writeValue(this.value);
	}
	if (this.loaded) {
		this.puts();
		this.loaded = false;
	}
	while (this.lineIdx < this.lines.length) {
		this.out.push(this.lines[this.lineIdx++]);
	}
	return this.out.join("\n") + "\n";
};

/* ------------------------------------------------------------------ *
 * 行尾空白解码（encode.c message_extract / decode_whitespace 移植）
 * ------------------------------------------------------------------ */

function WhitespaceDecoder(opts) {
	this.ice = null;
	this.iv = null;
	if (opts && opts.password) {
		const k = makeIceKeyFromPassword(opts.password);
		this.ice = k.key;
		this.iv = k.iv;
	}
	this.compress = !!(opts && opts.compress);
	this.collectRawBits = !!(opts && opts.collectRawBits);
	this.rawBits = this.collectRawBits ? [] : null;
	this.outBytes = [];
	this.outValue = 0;
	this.outCount = 0;
	this.uncAcc = "";
	this.startTabFound = false;
	this.bitsIn = 0;
	this.huffBits = 0;
}

/* ICE 1-bit CFB 解密一侧（encrypt.c decrypt_bit） */
WhitespaceDecoder.prototype.decryptBit = function (bit) {
	let nbit = bit;
	if (this.ice) {
		const ks = new Uint8Array(8);
		this.ice.encrypt(this.iv, 0, ks, 0);
		nbit = (ks[0] & 128) !== 0 ? (bit ? 0 : 1) : bit;
		/* IV 左旋 1 位，移入密文 bit */
		for (let i = 0; i < 8; i++) {
			this.iv[i] = (this.iv[i] << 1) & 0xff;
			if (i < 7 && (this.iv[i + 1] & 128) !== 0) this.iv[i] |= 1;
		}
		this.iv[7] |= bit;
	}
	this.uncompressBit(nbit);
};

WhitespaceDecoder.prototype.outputBit = function (bit) {
	this.outValue = ((this.outValue << 1) | bit) & 0xffffffff;
	if (++this.outCount === 8) {
		this.outBytes.push(this.outValue & 0xff);
		this.outValue = 0;
		this.outCount = 0;
	}
};

WhitespaceDecoder.prototype.uncompressBit = function (bit) {
	if (!this.compress) {
		this.outputBit(bit);
		return;
	}
	this.huffBits++;
	this.uncAcc += bit ? "1" : "0";
	const b = huffRev().get(this.uncAcc);
	if (b !== undefined) {
		for (let i = 0; i < 8; i++) {
			this.outputBit((b & (128 >> i)) !== 0 ? 1 : 0);
		}
		this.uncAcc = "";
	}
	if (this.uncAcc.length >= 255) {
		throw new Error("Huffman 解压缓冲溢出（数据不是压缩格式或密码错误）");
	}
};

WhitespaceDecoder.prototype.decodeBits = function (spc) {
	if (spc > 7) {
		throw new Error("非法编码：连续 " + spc + " 个空格（数据损坏或密码/参数错误）");
	}
	this.bitsIn += 3;
	const b0 = spc & 1;
	const b1 = (spc >> 1) & 1;
	const b2 = (spc >> 2) & 1;
	if (this.rawBits) this.rawBits.push(b0, b1, b2);
	this.decryptBit(b0);
	this.decryptBit(b1);
	this.decryptBit(b2);
};

WhitespaceDecoder.prototype.decodeWhitespace = function (s) {
	let spc = 0;
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === " ") {
			spc++;
		} else if (ch === "\t") {
			this.decodeBits(spc);
			spc = 0;
		}
	}
	if (spc > 0) this.decodeBits(spc);
};

/* 逐行提取；返回输出字节数组（可能为空 = 未找到数据起点） */
WhitespaceDecoder.prototype.extract = function (text) {
	const flat = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const lines = flat.split("\n");
	for (const line of lines) {
		/* 找最后一个连续空白串的起点（last_ws） */
		let lastWs = -1;
		for (let i = 0; i < line.length; i++) {
			const ch = line[i];
			if (ch !== " " && ch !== "\t") lastWs = -1;
			else if (lastWs === -1) lastWs = i;
		}
		if (lastWs === -1) continue;
		if (!this.startTabFound && line[lastWs] === " ") continue;
		if (!this.startTabFound && line[lastWs] === "\t") {
			this.startTabFound = true;
			lastWs++;
			if (lastWs >= line.length) continue;
		}
		this.decodeWhitespace(line.slice(lastWs));
	}
	return this.outBytes;
};

/*
 * 收尾状态：尚未组成整字节的残余位（仅作诊断，不作为解密成功依据）。
 *
 * 原版 encode_flush 最后只补 0~2 个「零位」把位流补齐到 3bit 组。
 * 明文模式下这些零位就是残余位（<=2 且全零）；-C 模式下解码器停在
 * 未完整的 Huffman 码前缀上，残余可为非零位（官方 uncompress_flush
 * 只在残余 >2 位时告警）。真正的判定是「回编码逐位比对 + 文本合理性门」，
 * 见 _snowAttempt 与 _snowTextPlausible。
 */
WhitespaceDecoder.prototype.finish = function () {
	if (this.compress) {
		const bits = this.uncAcc;
		return {
			bits,
			count: bits.length,
			allZero: bits.indexOf("1") < 0,
		};
	}
	const count = this.outCount;
	let bits = "";
	if (count > 0) {
		bits = (this.outValue >>> 0).toString(2);
		if (bits.length < count) bits = "0".repeat(count - bits.length) + bits;
		bits = bits.slice(-count);
	}
	return {
		bits,
		count,
		allZero: this.outValue === 0,
	};
};

/* ------------------------------------------------------------------ *
 * 管道组装：消息字节 → [Huffman] → [ICE CFB] → 空白编码
 * ------------------------------------------------------------------ */

function utf8ToBytes(str) {
	return Array.from(new TextEncoder().encode(str));
}

/*
 * 消息字节 → 比特数组。编码管道的单一实现：
 *   字节 →（-C）固定 Huffman 码 →（-p）ICE 1-bit CFB。
 * snowEncode 用它写空白；解码回编码校验也用它保证两侧完全同源。
 */
function _snowPayloadBits(msgBytes, password, compress) {
	let ice = null, iv = null;
	const passwd = password == null ? "" : String(password);
	if (passwd.length > 0) {
		const k = makeIceKeyFromPassword(passwd);
		ice = k.key;
		iv = k.iv;
	}
	const useCompress = !!compress;
	const bits = [];

	function encryptBit(bit) {
		if (!ice) {
			bits.push(bit);
			return;
		}
		const ks = new Uint8Array(8);
		ice.encrypt(iv, 0, ks, 0);
		if ((ks[0] & 128) !== 0) bit = bit ? 0 : 1;
		for (let i = 0; i < 8; i++) {
			iv[i] = (iv[i] << 1) & 0xff;
			if (i < 7 && (iv[i + 1] & 128) !== 0) iv[i] |= 1;
		}
		iv[7] |= bit;
		bits.push(bit);
	}

	const cState = { _v: 0, _n: 0 };
	function compressBitBound(bit) {
		if (!useCompress) {
			encryptBit(bit);
			return;
		}
		cState._v = ((cState._v << 1) | bit) & 0xffffffff;
		if (++cState._n === 8) {
			const code = HUFFCODES[cState._v & 0xff];
			for (const ch of code) encryptBit(ch === "1" ? 1 : 0);
			cState._v = 0;
			cState._n = 0;
		}
	}

	for (const c of msgBytes) {
		for (let i = 0; i < 8; i++) {
			compressBitBound((c & (128 >> i)) !== 0 ? 1 : 0);
		}
	}
	return bits;
}

/* 比特数组 + encode_flush 的 0~2 个零位补位（与容器文本/行宽无关） */
function _snowPaddedPayloadBits(msgBytes, password, compress) {
	const bits = _snowPayloadBits(msgBytes, password, compress);
	while (bits.length % 3 !== 0) bits.push(0);
	return bits;
}

function _snowBitsEqual(a, b) {
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false;
	}
	return true;
}

/*
 * 编码。message: string；opts: { text: 容器, password, compress, lineLength }
 * 返回隐写文本（与 snow.exe 输出一致，每行以 \n 结尾）。
 */
function snowEncode(message, opts) {
	opts = opts || {};
	const lineLength = Math.max(8, Math.floor(Number(opts.lineLength) || 80));
	const container = (opts.text === undefined || opts.text === null) ? "" : String(opts.text);
	const lines = container.length === 0 ? [] : container.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");

	const enc = new WhitespaceEncoder(lines, lineLength);

	// 修复：二进制负载（Uint8Array/Buffer）原字节直接入编码管道；
	// 字符串仍走 UTF-8（字面 "0,128,255" 是 9 个字符，不猜成字节数组）。
	// Array.from(视图) 尊重 byteOffset/length 子视图边界，且不修改输入。
	const msgBytes = message instanceof Uint8Array ? Array.from(message) : utf8ToBytes(String(message));

	const bits = _snowPayloadBits(msgBytes, opts.password, opts.compress);
	for (const bit of bits) enc.writeBit(bit);
	return enc.flush();
}

/* 文本合理性：合法 UTF-8 之外再排除 NUL/C0/C1 控制字符（防止随机字节伪装成文本） */
function _snowTextCheck(str) {
	if (typeof str !== "string" || str.length === 0) {
		return { ok: false, reason: "空文本" };
	}
	for (const ch of str) {
		const cp = ch.codePointAt(0);
		if (cp === 0) return { ok: false, reason: "含 NUL" };
		if (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d) {
			return { ok: false, reason: "含控制字符 U+" + cp.toString(16).padStart(4, "0") };
		}
		if (cp >= 0x7f && cp <= 0x9f) {
			return { ok: false, reason: "含 C1 控制字符 U+" + cp.toString(16).padStart(4, "0") };
		}
	}
	return { ok: true };
}

function _snowBinaryResult(u8) {
	return {
		text: "(二进制负载，" + u8.length + " 字节，点击下载)",
		files: [{ name: "snow_payload.bin", mime: "application/octet-stream", bytes: Array.from(u8) }],
	};
}

/* ------------------------------------------------------------------ *
 * 文本合理性（snow 无认证字段，错误密码可能解出「可打印乱码」）
 *
 * 官方格式没有 MAC/长度头：-C 模式下只要解密位流能完整切成 Huffman 码，
 * 任意密码都能「自洽」地解出一串字节并原样回编码。因此回编码只能校验
 * 位流一致性，不能证明密码正确。最终还需判断解出的明文是否像人写的内容：
 *   1) flag/URL/邮箱/JSON/JWT/hex/单 token/CJK 等结构化载荷直接放行；
 *   2) 普通文本用高频英文词覆盖率 + 高频双字母结构 + 最长辅音串判定。
 * 这仍是启发式（格式本身无解），但能挡住随机明文；极端的自定义明文可
 * 用 opts.looseText 跳过。
 * ------------------------------------------------------------------ */

const SNOW_COMMON_WORDS = new Set((
	"the be to of and a in that have it for not on with he as you do at this but his by from they we say her she or an will my one all would there their what so up out if about who get which go me when make can like time no just him know take people into year your good some could them see other than then now look only come its over think also back after use two how our work first well way even new want because any these give day most us is was are were been has had did does said going made many much more very where why while should might must shall may here thing things something nothing anything everyone someone world life hand part place case week company system program question government number night point home water room mother area money story fact month lot right study book eye job word business issue side kind head house service friend father power hour game line end member law car city community name president team minute idea kid body information parent face others level office door health person art war history party result change morning reason research girl guy moment air teacher force education foot boy age policy process music market sense nation plan college interest death experience effect class control care field development role effort rate heart drug show leader light voice wife police mind price report decision son view relationship town road arm difference value building action model season society tax director position player record paper space ground form event official matter center couple site project activity star table need court production eat teach oil situation cost industry figure street image phone data picture practice piece land product doctor wall patient worker news test movie north love support technology step baby computer type attention draw film tree source red nearly organization choose cause hair century evidence window difficult listen soon culture billion chance brother energy period course summer plant opportunity term letter condition choice single rule daughter administration south husband floor campaign material population economy hospital church close thousand risk current fire future wrong involve defense anyone increase security bank myself certainly west sport board seek per subject officer private rest behavior deal performance fight throw top quickly past goal second bed order author fill represent focus foreign drop blood upon agency push nature color recently store reduce sound note fine before near movement page enter share common poor natural race concern series significant similar hot language usually response dead rise animal factor decade article shoot east save seven artist away scene stock career despite central eight thus treatment beyond happy exactly protect approach lie size dog fund serious occur media ready sign thought list individual simple quality pressure accept answer hard resource identify left meeting determine prepare disease whatever success argue cup particularly amount ability staff recognize indicate character growth loss degree wonder attack herself region television box training pretty trade election everybody physical lay general feeling standard bill message fail outside arrive analysis benefit sex forward lawyer present section environmental glass skill sister professor operation financial crime stage ok compare authority miss design sort act ten knowledge gun station blue state strategy clearly discuss indeed truth song example democratic check environment leg dark various rather laugh guess executive set study prove hang entire rock forget claim remove manager enjoy network legal religious cold final main science green memory card above seat cell establish nice trial expert spring firm radio visit management avoid imagine tonight huge ball finish yourself theory impact respond statement maintain charge popular traditional onto reveal direction weapon employee cultural contain peace pain apply measure wide shake fly interview manage chair fish particular camera structure politics perform bit weight suddenly discover candidate treat trip evening affect inside conference unit best style adult worry range mention deep edge specific writer trouble necessary throughout challenge fear shoulder institution middle sea dream bar beautiful property instead improve stuff exist drive train immediately thank each through against between during without within along across behind toward towards upon among around since until although though unless however therefore perhaps maybe probably actually especially usually sometimes always never often already almost enough quite really together forward backward upward downward anywhere everywhere somewhere nowhere upstairs downstairs afternoon midnight today tomorrow yesterday tonight monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december flag ctf key secret password hidden found correct cipher encrypt decrypt snow stego welcome congratulations hello world please thanks sorry yes okay great nice love hate work play read write open close start stop end begin quick brown fox jumps jumped lazy dog over under alpha bravo charlie delta echo foxtrot compressed compress payload narrow line lines spread across truncate container plain binary data file text"
).split(/\s+/));

const SNOW_COMMON_BIGRAMS = new Set((
	"th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ve co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el ta la ns di fo ho pe ec pr no ct us ac ot il tr ly nc et"
).split(" "));

/* 无空格拼接词（如 secretmessage）能否切成常用词 */
function _snowSegmentWords(lower) {
	const n = lower.length;
	const ok = new Array(n + 1).fill(false);
	ok[0] = true;
	for (let i = 1; i <= n; i++) {
		for (let j = 0; j < i; j++) {
			if (ok[j] && i - j >= 3 && SNOW_COMMON_WORDS.has(lower.slice(j, i))) {
				ok[i] = true;
				break;
			}
		}
	}
	return ok[n];
}

function _snowTextPlausible(str) {
	const t = String(str).trim();
	if (!t) return { ok: false, reason: "空文本", rank: 0 };

	/* rank 用于同一份数据被 -C / 明文两种模式都解出时的择优（结构化 > 普通文本） */
	if (/[A-Za-z0-9_.-]{2,}\{[^{}\r\n]{1,300}\}/.test(t)) {
		return { ok: true, reason: "flag", rank: 100 };
	}
	if (/(?:https?|ftp):\/\/\S+/i.test(t)) return { ok: true, reason: "URL", rank: 95 };
	if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { ok: true, reason: "邮箱", rank: 95 };
	if (/^(?:[0-9a-fA-F]{2}[ :,-]?){4,}$/.test(t)) {
		return { ok: true, reason: "十六进制字节", rank: 92 };
	}
	if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) {
		return { ok: true, reason: "JWT", rank: 92 };
	}
	if (/^[\[{]/.test(t) && /[\]}]$/.test(t)) {
		try {
			JSON.parse(t);
			return { ok: true, reason: "JSON", rank: 92 };
		} catch (e) { /* 不是 JSON，继续 */ }
	}
	if ((t.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length >= 2) {
		return { ok: true, reason: "CJK 文本", rank: 90 };
	}
	/* 无空白单 token：只放行有明确形状的 key/hash/base64/重复串/密码样式；
	 * 其余（含纯字母词）继续走自然文本判定。不能无条件放行——错误密码
	 * 也可能解出一整串无空白的可打印乱码。 */
	if (!/\s/.test(t)) {
		if (/^[A-Za-z0-9+/]+={0,2}$/.test(t) && t.length >= 8 && t.length % 4 === 0) {
			return { ok: true, reason: "base64 token", rank: 75 };
		}
		if (/^[0-9a-fA-F]+$/.test(t) && t.length >= 8 && t.length % 2 === 0) {
			return { ok: true, reason: "hex token", rank: 75 };
		}
		if (/^[A-Za-z0-9_.-]{8,}$/.test(t)) {
			const classes = (/[a-z]/.test(t) ? 1 : 0) + (/[A-Z]/.test(t) ? 1 : 0)
				+ (/[0-9]/.test(t) ? 1 : 0);
			if (classes >= 2 || t.length >= 24) {
				return { ok: true, reason: "token", rank: 72 };
			}
		}
		if (/^(.)\1+$/.test(t)) return { ok: true, reason: "重复串", rank: 70 };
		if (/[\/\\]/.test(t) && /^[\w./\\-]+$/.test(t)) {
			return { ok: true, reason: "路径", rank: 72 };
		}
		if (t.length >= 6 && t.length <= 64 && /[A-Za-z]/.test(t) && /[0-9]/.test(t)
			&& /^[A-Za-z0-9!@#$%^&*_+\-.]{6,64}$/.test(t)) {
			return { ok: true, reason: "密码样式 token", rank: 70 };
		}
		if (/^[A-Za-z]{8,}$/.test(t) && _snowSegmentWords(t.toLowerCase())) {
			return { ok: true, reason: "拼接词 token", rank: 65 };
		}
	}
	/* "<flag|key|secret…> + 长 token" */
	if (/\b(?:flag|key|secret|password|answer|token|plaintext)\b/i.test(t)
		&& /[A-Za-z0-9_\-+\/=]{6,}/.test(t)) {
		return { ok: true, reason: "关键字+载荷", rank: 85 };
	}

	const letters = t.replace(/[^A-Za-z]/g, "");
	if (letters.length < 12) return { ok: true, reason: "短文本", rank: 60 };

	const lower = t.toLowerCase();
	const segs = lower.split(/[^a-z]+/);
	const words = segs.filter((w) => w.length >= 3);
	let pairs = 0;
	let known = 0;
	for (const w of segs) {
		for (let i = 0; i + 1 < w.length; i++) {
			pairs++;
			if (SNOW_COMMON_BIGRAMS.has(w.slice(i, i + 2))) known++;
		}
	}
	const bigram = pairs > 0 ? known / pairs : 1;
	const run = (t.match(/[bcdfghjklmnpqrstvwxz]{4,}/gi) || [])
		.reduce((m, r) => Math.max(m, r.length), 0);
	if (words.length === 0) return { ok: true, reason: "无字母词", rank: 60 };
	const common = words.filter((w) => SNOW_COMMON_WORDS.has(w)).length;
	const cov = common / words.length;
	if (cov >= 0.34) {
		return {
			ok: true,
			reason: "常用词覆盖 " + cov.toFixed(2),
			rank: 50 + Math.round(cov * 10),
		};
	}
	if (cov >= 0.15 && bigram >= 0.45) {
		return {
			ok: true,
			reason: "常用词+双字母结构 " + cov.toFixed(2) + "/" + bigram.toFixed(2),
			rank: 45 + Math.round(cov * 20) + Math.round(bigram * 10),
		};
	}
	/* 双字母结构仅在样本足够长时作为弱证据：短随机串（如错误密码产物）容易碰巧命中 */
	if (pairs >= 24 && bigram >= 0.65 && run <= 4) {
		return {
			ok: true,
			reason: "英文双字母结构 " + bigram.toFixed(2),
			rank: 40 + Math.round(bigram * 10),
		};
	}
	return {
		ok: false,
		rank: 0,
		reason: "疑似随机乱码（常用词 " + cov.toFixed(2) + "，双字母 " + bigram.toFixed(2)
			+ "，最长辅音串 " + run + "）",
	};
}

/*
 * 单模式尝试：按 -p / -C 组合各自解一遍。
 *
 * 官方 snow 无文件头、无密码校验字段，无法从容器判断是否用了 -C/-p。
 * 旧判定要求「收尾残余 0~2 个零位」，但：
 *   - -C 的正确解允许非零 Huffman 残余前缀（snow_5201314.txt 正确解残余为 1 位 "1"，
 *     见官方 compress.c uncompress_flush 只对 >2 位告警）；
 *   - 错误密码可能恰好留下 0 位残余并解出可打印乱码（123456 即如此）。
 * 第一层：确定性回编码校验——用同一密码/同一 -C 把解出的字节重新编码成位流
 * （含 encode_flush 的 0~2 个零位补位），与文件中实际提取的位流逐位比对。
 * 编码与解码管道同源（_snowPayloadBits），位流与容器文本、行宽、CRLF 均无关。
 * 注意：-C 的 Huffman 解码与编码互为逆运算，若错误密码恰好把位流完整切成码，
 * 回编码仍会逐位一致（实测 123456 即如此），所以它只能证明「位流自洽」。
 * 第二层：文本合理性门（_snowTextPlausible）——flag/URL/JSON/hex/token/CJK
 * 等结构化载荷放行，普通文本按常用词与双字母结构判定，拒绝可打印乱码。
 * padding 仅保留为诊断信息，不作为成功依据。
 */
function _snowAttempt(text, password, compress, looseText) {
	const dec = new WhitespaceDecoder({ password, compress, collectRawBits: true });
	let bytes;
	try {
		bytes = dec.extract(String(text));
	} catch (e) {
		return {
			compress,
			ok: false,
			error: (e && e.message) || String(e),
			bytes: null,
			roundTripOk: false,
		};
	}
	if (bytes.length === 0) {
		return {
			compress,
			ok: false,
			error: "未找到隐写数据（缺少行尾 TAB 数据起点标记）",
			bytes: null,
			roundTripOk: false,
		};
	}
	const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	const fin = dec.finish();
	/* 明文补位是零位；-C 残余是 Huffman 码前缀，官方只约束长度 <=2 */
	const paddingOk = compress ? fin.count <= 2 : (fin.count <= 2 && fin.allZero);
	const roundTripBits = _snowPaddedPayloadBits(u8, password, compress);
	const roundTripOk = _snowBitsEqual(dec.rawBits, roundTripBits);
	const utf = decodeUtf8Lossless(u8);
	let textVal = null;
	let textOk = false;
	let textError = null;
	let plausible = null;
	let textPlausible = false;
	let plausibleRank = 0;
	if (!utf.ok) {
		textError = "不是合法 UTF-8";
	} else {
		const sane = _snowTextCheck(utf.text);
		if (sane.ok) {
			textVal = utf.text;
			textOk = true;
			plausible = _snowTextPlausible(utf.text);
			textPlausible = plausible.ok || looseText;
			plausibleRank = plausible.ok ? plausible.rank : (looseText ? 1 : 0);
		} else {
			textError = sane.reason;
		}
	}
	return {
		compress,
		ok: true,
		bytes: u8,
		text: textVal,
		textOk,
		utf8Ok: !!utf.ok,
		textError,
		textPlausible,
		plausibleRank,
		plausibleReason: plausible ? plausible.reason : null,
		padding: fin,
		paddingOk,
		roundTripOk,
		fileBits: dec.rawBits ? dec.rawBits.length : 0,
	};
}

function _snowDecodeInternal(text, opts) {
	opts = opts || {};
	const password = opts.password == null ? "" : String(opts.password);
	const hasPassword = password.length > 0;
	const hintCompress = opts.compress === true;
	/* 二进制负载只能按「无密码 + 显式 allowBinary」解释：带密码时无法区分“正确的二进制
	 * 明文”和“错误密码解出的随机字节”，为避免假成功一律不返回二进制。 */
	const allowBinary = (opts.allowBinary === true || opts.binary === true) && !hasPassword;
	const looseText = opts.looseText === true || opts.allowSuspiciousText === true;
	/* compress 只是提示：false/未传时先按明文解，失败再自动尝试 -C（官方 -C 无法从容器识别） */
	const order = hintCompress ? [true, false] : [false, true];
	const attempts = order.map((compress) =>
		_snowAttempt(text, hasPassword ? password : "", compress, looseText));

	/* 两种模式可能同时自洽（如明文位流恰好也是合法 -C 流），按文本类型 rank 择优；
	 * rank 相同则按尝试顺序（显式 compress 提示优先）。 */
	let chosen = null;
	for (const a of attempts) {
		if (!(a.ok && a.textOk && a.textPlausible && a.roundTripOk)) continue;
		if (!chosen || a.plausibleRank > chosen.plausibleRank) chosen = a;
	}
	if (chosen) {
		return { ok: true, result: chosen.text, chosen, attempts, password: hasPassword };
	}

	/* 二进制负载：只接受「无密码 + 显式 allowBinary + 回编码自洽 + 确实不是文本」的候选。
	 * 可打印乱码（textOk 但合理性失败）不得走此分支，否则错误密码会被包装成下载文件。 */
	if (allowBinary) {
		const bin = attempts.find((a) => a.ok && a.roundTripOk && !a.textOk);
		if (bin) {
			return {
				ok: true,
				result: _snowBinaryResult(bin.bytes),
				chosen: bin,
				attempts,
				password: hasPassword,
				binary: true,
			};
		}
	}

	const details = attempts.map((a) => {
		const mode = a.compress ? "-C" : "明文";
		if (!a.ok) return mode + "：" + a.error;
		if (!a.roundTripOk) {
			return mode + "：回编码校验失败（解密位流与原文不一致）";
		}
		if (!a.textOk) return mode + "：" + (a.textError || "不是文本");
		if (!a.textPlausible) {
			return mode + "：" + (a.plausibleReason || "文本合理性校验失败");
		}
		return mode + "：未通过文本校验";
	}).join("；");
	const error = hasPassword
		? "密码错误或数据不匹配（snow -p 解密失败；" + details + "）"
		: "未找到有效的 snow 数据（可能是 -p 加密，请填写密码；原始字节负载需无密码且显式 allowBinary；"
			+ details + "）";
	return { ok: false, error, attempts, password: hasPassword };
}

/*
 * 解码。text: 含隐写的文本；opts: { password, compress, allowBinary, looseText }
 * 返回消息字符串（UTF-8）；无密码且 allowBinary 时，二进制负载返回
 * { text, files:[{name,mime,bytes}] }。
 * compress 未显式 true 时自动识别 -C；密码错误/文本乱码抛异常，不返回假负载。
 * looseText 跳过文本合理性门（仅供确实需要解出非常规明文的调用方）。
 */
function snowDecode(text, opts) {
	const r = _snowDecodeInternal(text, opts);
	if (r.ok) return r.result;
	throw new Error(r.error);
}

/* 自检导出：返回两种模式的中间结果与最终判定，不改变 snowDecode 的行为 */
function snowDecodeDetailed(text, opts) {
	const r = _snowDecodeInternal(text, opts);
	return {
		ok: r.ok,
		result: r.ok ? r.result : null,
		error: r.ok ? null : r.error,
		password: !!r.password,
		chosen: r.chosen ? {
			compress: r.chosen.compress,
			textOk: r.chosen.textOk,
			textPlausible: !!r.chosen.textPlausible,
			plausibleRank: r.chosen.plausibleRank || 0,
			plausibleReason: r.chosen.plausibleReason || null,
			paddingOk: r.chosen.paddingOk,
			padding: r.chosen.padding,
			roundTripOk: !!r.chosen.roundTripOk,
			fileBits: r.chosen.fileBits || 0,
			bytes: Array.from(r.chosen.bytes),
		} : null,
		attempts: r.attempts.map((a) => ({
			compress: a.compress,
			ok: a.ok,
			error: a.error || null,
			textOk: !!a.textOk,
			textPlausible: !!a.textPlausible,
			plausibleRank: a.plausibleRank || 0,
			plausibleReason: a.plausibleReason || null,
			utf8Ok: !!a.utf8Ok,
			textError: a.textError || null,
			paddingOk: !!a.paddingOk,
			padding: a.padding || null,
			roundTripOk: !!a.roundTripOk,
			fileBits: a.fileBits || 0,
			bytes: a.bytes ? Array.from(a.bytes) : null,
		})),
	};
}

/* ------------------------------------------------------------------ *
 * 注册
 * ------------------------------------------------------------------ */

register({
	id: "snow",
	cat: "stegoText",
	name: "SNOW 空白隐写",
	desc: "行尾空白隐写（原版 mattkwan/snow 格式）：TAB 标记数据起点，每 3bit 编码为 TAB+空格串，行宽 8 列对齐。支持 -C Huffman 压缩与 -p ICE 加密，与 snow.exe 双向互通。encode: 消息+容器→隐写文本；decode: 隐写文本→消息",
	params: [
		{ key: "text", label: "容器文本（隐写追加到各行尾）", type: "text", default: "" },
		{ key: "password", label: "密码（-p，留空不加密）", type: "text", default: "" },
		{ key: "compress", label: "Huffman 压缩（-C）", type: "bool", default: false },
		{ key: "lineLength", label: "最大行宽（默认 80，最小 8）", type: "number", default: 80 },
	],
	encode: (t, p) => snowEncode(t, p || {}),
	decode: (t, p) => snowDecode(t, p || {}),
});

export { snowEncode, snowDecode, snowDecodeDetailed, IceKey };
