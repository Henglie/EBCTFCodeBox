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
	this.outBytes = [];
	this.outValue = 0;
	this.outCount = 0;
	this.uncAcc = "";
	this.startTabFound = false;
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
	this.decryptBit(spc & 1);
	this.decryptBit((spc >> 1) & 1);
	this.decryptBit((spc >> 2) & 1);
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

/* ------------------------------------------------------------------ *
 * 管道组装：消息字节 → [Huffman] → [ICE CFB] → 空白编码
 * ------------------------------------------------------------------ */

function utf8ToBytes(str) {
	return Array.from(new TextEncoder().encode(str));
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

	let ice = null, iv = null;
	if (opts.password) {
		const k = makeIceKeyFromPassword(String(opts.password));
		ice = k.key;
		iv = k.iv;
	}
	const useCompress = !!opts.compress;

	// T416 修复：二进制负载（Uint8Array/Buffer）原字节直接入编码管道；
	// 字符串仍走 UTF-8（字面 "0,128,255" 是 9 个字符，不猜成字节数组）。
	// Array.from(视图) 尊重 byteOffset/length 子视图边界，且不修改输入。
	const msgBytes = message instanceof Uint8Array ? Array.from(message) : utf8ToBytes(String(message));

	function encryptBit(bit) {
		if (!ice) {
			enc.writeBit(bit);
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
		enc.writeBit(bit);
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

	return enc.flush();
}

/*
 * 解码。text: 含隐写的文本；opts: { password, compress }
 * 返回消息字符串（UTF-8）；二进制负载返回 { text, files:[{name,mime,bytes}] }。
 */
function snowDecode(text, opts) {
	opts = opts || {};
	const dec = new WhitespaceDecoder(opts);
	const bytes = dec.extract(String(text));
	if (bytes.length === 0) {
		throw new Error("未找到隐写数据（缺少行尾 TAB 数据起点标记）");
	}
	const u8 = new Uint8Array(bytes);
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(u8);
	} catch (e) {
		return {
			text: "(二进制负载，" + u8.length + " 字节，点击下载)",
			files: [{ name: "snow_payload.bin", mime: "application/octet-stream", bytes: Array.from(u8) }],
		};
	}
}

/* ------------------------------------------------------------------ *
 * 注册
 * ------------------------------------------------------------------ */

register({
	id: "snow",
	cat: "stego",
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

export { snowEncode, snowDecode, IceKey };
