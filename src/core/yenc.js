/*
 * yenc.js — yEnc 编解码（text, 双向）。
 *
 * 算法照 yEnc 官方规范 (yEnc-1.3, Jürgen Helbing 2002) 实现，不编造：
 *
 * 编码（每字节）：
 *   E = (b + 42) mod 256
 *   若 E 为关键字节则转义：先输出 '='(0x3D)，再输出 (E + 64) mod 256。
 *   关键字节（必须转义）：NUL(0x00)、LF(0x0A)、CR(0x0D)、'='(0x3D)。
 *   本实现同时对行首出现的 TAB(0x09)/SPACE(0x20)/'.'(0x2E) 做保守转义（规范建议，
 *   避免行首空白被传输层裁剪、行首 '.' 被 NNTP 吞掉），确保往返稳健。
 *
 * 解码（每字节）：
 *   遇 '='：取下一字节 c，还原 E = (c - 64) mod 256，再 b = (E - 42) mod 256。
 *   否则：b = (E - 42) mod 256。忽略裸 CR/LF（行分隔，非数据）。
 *
 * 本实现产出 / 消费单块裸数据体（不含 =ybegin/=yend 头尾行）；若输入含这些控制行，
 * 解码时自动跳过（以 '=y' 开头的整行）。行宽默认 128（规范常用 128/256）。
 *
 * 红线：算法照 yEnc-1.3 规范；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 交付前跑 encode→decode 往返（含全 0..255 字节覆盖）验证。
 *
 * 文本 ↔ 字节：encode 取输入 UTF-8 字节；decode 输出按 UTF-8 解回文本。
 *
 * 契约：register({ id:"yenc", cat:"text", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// 关键字节：必须转义（NUL/LF/CR/'='）
const CRITICAL = new Set([0x00, 0x0a, 0x0d, 0x3d]);
// 行首保守转义：TAB/SPACE/'.'（规范建议，防传输层裁剪）
const LEADING = new Set([0x09, 0x20, 0x2e]);

function yencEncode(text, p = {}) {
  const bytes = te(text);
  let width = parseInt(p && p.width, 10);
  if (!Number.isFinite(width) || width <= 0) width = 128;

  const out = [];
  let col = 0;
  const push = (ch) => {
    out.push(ch);
    col++;
  };
  for (let i = 0; i < bytes.length; i++) {
    let e = (bytes[i] + 42) & 0xff;
    const atLineStart = col === 0;
    const needEsc = CRITICAL.has(e) || (atLineStart && LEADING.has(e));
    if (needEsc) {
      // '=' 前缀不换行拆散（转义对必须同行）
      out.push("=");
      out.push(String.fromCharCode((e + 64) & 0xff));
      col += 2;
    } else {
      push(String.fromCharCode(e));
    }
    if (col >= width) {
      out.push("\r\n");
      col = 0;
    }
  }
  return out.join("");
}

function yencDecode(text) {
  const s = String(text == null ? "" : text);
  const bytes = [];
  const lines = s.split(/\r?\n/);
  for (const line of lines) {
    // 跳过 yEnc 控制行（=ybegin/=ypart/=yend）
    if (/^=y/.test(line)) continue;
    for (let i = 0; i < line.length; i++) {
      let c = line.charCodeAt(i) & 0xff;
      if (c === 0x3d) {
        // 转义：取下一字符
        i++;
        if (i >= line.length) break; // 行尾孤立 '='：忽略
        const e = (line.charCodeAt(i) - 64) & 0xff;
        bytes.push((e - 42) & 0xff);
      } else {
        bytes.push((c - 42) & 0xff);
      }
    }
  }
  return td(bytes);
}

register({
  id: "yenc",
  cat: "text",
  name: "yEnc 编 / 解码",
  desc: "yEnc（Usenet 二进制传输编码，yEnc-1.3 规范）：每字节 +42 mod 256，关键字节 NUL/CR/LF/'=' 用 '=' 转义 +64。行首 TAB/空格/'.' 保守转义。encode 取 UTF-8 字节，decode 自动跳过 =ybegin/=yend 控制行。",
  params: [
    { key: "width", type: "number", label: "行宽", default: 128, placeholder: "每行字符数（规范常用 128/256）" },
  ],
  encode: yencEncode,
  decode: yencDecode,
});

export { yencEncode, yencDecode };
