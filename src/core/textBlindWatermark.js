/*
 * textBlindWatermark.js — 文本盲水印 v1（guofei9987/text_blind_watermark 的 JS 版格式）。
 *
 * 算法来源：github.com/guofei9987/text_blind_watermark（PyPI: text-blind-watermark，MIT）。
 * 对拍基准 = 随波逐流打包的 v1 JS 移植页（CTFReBoxESS「文本隐水印.htm」，页内自述
 * 「作者 郭飞（guofei9987）」），逐步骤 1:1 行为复刻（str2bin/embed/extract/bin2str）。
 *
 * v1 格式（与 Python 原库 v2+ 多字符格式、本项目 zeroWidth（Misawa radix-4）均不兼容）：
 *   encode: 水印逐字符 charCodeAt().toString(2) 变长不补零，字符间以单空格分隔、
 *           末尾再补一个空格 → 逐位映射：'1' = 1 个 U+200C、' ' = 2 个 U+200C（分隔符）、
 *           '0' = 不加；每一位消耗 1 个掩护明文字符（零宽串插在该字符之后），容量不足报错。
 *   decode: 状态机扫描（单 ZWNJ=1、双 ZWNJ=分隔、普通字符=0）还原二进制串
 *           → 按空格切段 parseInt(_,2) → fromCharCode。
 *
 * 与原版的显式差异（仅 decode 增强，edu 卡已注明）：
 *   ① 原版 bin2str 把「尾空格之后的掩护残余段」（全 "0"）也 parseInt → 产出
 *      U+0000 尾巴（掩护越长 NUL 越多），本实现识别残余段并丢弃；
 *      无尾分隔符的畸形数据（尾段含 "1"）则保留原样兼容；
 *   ② 原版 embed 容量不足时在页面显示错误串，本实现抛 Error（错误不冒充结果）。
 *
 * BMP 外字符按 UTF-16 码元拆编（原版 split("")+charCodeAt 口径），成对代理码元
 * 解码后由 fromCharCode 重组，round-trip 自洽。
 *
 * 接线（M 串行）：src/main.js 与 src/core/registerAll.js 各加
 *   import "./core/textBlindWatermark.js"; / import "./textBlindWatermark.js";
 */
import { register } from "./registry.js";

const ZWNJ = "\u200c";

/* 水印 → 变长二进制串（原版 str2bin + main() 的 `wm_bin += " "` 合并：
 * 字符间单空格分隔，末尾恰一个空格；空水印返回 " " 与原版一致） */
function wmToBinary(wm) {
	const parts = [];
	const list = String(wm).split("");
	for (let i = 0; i < list.length; i++) {
		if (i !== 0) parts.push(" ");
		parts.push(list[i].charCodeAt(0).toString(2));
	}
	return parts.join("") + " ";
}

/* 二进制串 → 隐写文本（原版 embed 1:1；容量不足显式报错） */
function embed(text, wmBin) {
	if (wmBin.length > text.length) {
		throw new Error("掩护文本过短：该水印需要明文长度 ≥ " + wmBin.length + " 个字符（当前 " + text.length + "）");
	}
	let out = "";
	for (let idx = 0; idx < text.length; idx++) {
		out += text[idx];
		if (wmBin[idx] === "1") out += ZWNJ;
		else if (wmBin[idx] === " ") out += ZWNJ + ZWNJ;
	}
	return out;
}

/* 隐写文本 → 二进制串（原版 extract 状态机 1:1） */
function extract(text) {
	let bin = "";
	let idx = 0;
	let prevIsChar = false;
	while (idx < text.length) {
		if (prevIsChar) {
			if (text[idx] === ZWNJ) {
				if (text[idx + 1] === ZWNJ) {
					bin += " ";
					prevIsChar = false;
					idx++;
				} else {
					bin += "1";
					prevIsChar = false;
				}
			} else {
				bin += "0";
				prevIsChar = true;
			}
		} else {
			prevIsChar = true;
		}
		idx++;
	}
	return bin;
}

function tbwEncode(watermark, params) {
	const wm = watermark === undefined || watermark === null ? "" : String(watermark);
	if (wm.length === 0) throw new Error("水印为空：请提供要隐藏的水印文字");
	const cover = params && typeof params.cover === "string" ? params.cover : "";
	return embed(cover, wmToBinary(wm));
}

function tbwDecode(text) {
	const input = text === undefined || text === null ? "" : String(text);
	if (!input.includes(ZWNJ)) {
		throw new Error("未找到水印：文本中不含零宽字符 U+200C");
	}
	const bin = extract(input);
	const segs = bin.split(" ");
	/* wm_bin 以尾空格结束，其后是掩护文本残余产出的全 "0" 段（原版此处
	 * parseInt 残余段 → U+0000 尾巴；掩护越长得出的 NUL 越多——非空段 bug，
	 * 而是「残余段不属于水印数据」）。正常产物残余段必为空或全 "0"：
	 * 丢弃之；若尾段含 "1" 则是无尾分隔符的畸形数据，保留不丢。 */
	const last = segs[segs.length - 1];
	if (last === undefined || last === "" || /^0+$/.test(last)) segs.pop();
	let out = "";
	let count = 0;
	for (const seg of segs) {
		if (seg === "") continue;
		out += String.fromCharCode(parseInt(seg, 2));
		count++;
	}
	if (count === 0) throw new Error("未找到水印：零宽序列未构成有效水印数据");
	return out;
}

/* 一键解码置信度：双 ZWNJ 相邻（v1 分隔符特征）> 仅单 ZWNJ > 无 */
function tbwDetect(t) {
	let singles = 0, doubles = 0;
	for (let i = 0; i < t.length - 1; i++) {
		if (t[i] === ZWNJ) {
			if (t[i + 1] === ZWNJ) { doubles++; i++; }
			else singles++;
		}
	}
	if (doubles > 0) return 0.45;
	if (singles > 0) return 0.2;
	return 0;
}

register({
	id: "textBlindWatermark",
	cat: "stego",
	name: "文本盲水印",
	desc: "guofei9987/text_blind_watermark v1 JS 版格式：水印逐字符变长二进制（不补零），经单/双 U+200C 藏进掩护文本，每位消耗 1 个掩护字符；与「零宽字符隐写」（Misawa radix-4）互不兼容。encode: 水印+掩护文本→隐写文本；decode: 隐写文本→水印",
	params: [
		{ key: "cover", label: "掩护文本（编码用；长度需 ≥ 水印位数）", type: "text", default: "", placeholder: "可见外壳文本，编码时每位水印消耗 1 个字符" },
	],
	encode: (t, p) => tbwEncode(t, p || {}),
	decode: (t) => tbwDecode(t),
	detect: tbwDetect,
});

export { tbwEncode, tbwDecode, tbwDetect, wmToBinary, extract };
