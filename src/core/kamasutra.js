/*
 * kamasutra.js — Kamasutra 爱经密码（cat:'classic'）。
 *
 * Kamasutra 密码：配对替换，自反（加密=解密）。
 *
 * 算法链路（kamasutra_code）:
 * 1. 解析 dicstr 成配对列表 dic:
 * - 含空格 → split(" ")
 * - 含逗号 → split(",")
 * - 否则 → 每 2 字符一组
 * 2. 对明文每字符 c，遍历 dic 每个配对 cc:
 * - 若 c.upper 在 cc 中: num=cc.index(c.upper); num = 1 if num==0 else 0;
 * 替换为 cc[num]（配对中的另一个）; continue
 * 3. 非 dic 内字符被丢弃（continue 后无保留）
 *
 * 特点: 自反——kamasutra_code(kamasutra_code(text, dic), dic) == text（对 dic 内字符）
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 * params: [{key:"key", label:"配对表", type:"text", default:"AN BO CP ... MZ"}]
 * encode/decode 都调 kamasutraCode（自反）
 */
import { register } from "./registry.js";

// ============================================================
// 解析配对表
// ============================================================
function parsePairs(dicstr) {
  if (typeof dicstr !== "string" || dicstr.length === 0) {
    throw new Error("Kamasutra 配对表不能为空");
  }
  let dic;
  if (dicstr.includes(" ")) {
    dic = dicstr.split(" ");
  } else if (dicstr.includes(",")) {
    dic = dicstr.split(",");
  } else {
 // 每 2 字符一组
    dic = [];
    for (let i = 0; i < dicstr.length; i += 2) {
      dic.push(dicstr.slice(i, i + 2));
    }
  }
 // 过滤空串（split 可能产生空元素）
  dic = dic.filter((s) => s.length > 0);
  if (dic.length === 0) throw new Error("Kamasutra 配对表解析后为空");
  return dic;
}

// ============================================================
// Kamasutra 加密/解密（自反，kamasutra_code）
// ============================================================
function kamasutraCode(text, params = {}) {
  const dicstr = params.key != null ? params.key : params;
  const dic = parsePairs(dicstr);
  let cryptotext = "";
  for (const c of text) {
    let matched = false;
    for (const cc of dic) {
      const up = c.toUpperCase();
      const idx = cc.indexOf(up);
      if (idx !== -1) {
 // num = idx; num = 1 if num==0 else 0
        const num = idx === 0 ? 1 : 0;
        cryptotext += cc[num];
        matched = true;
        break; // 跳出 cc 循环，处理下一字符
      }
    }
 // 原算法非 dic 内字符会被丢弃
    if (!matched) {
 // 为实用性保留非 dic 字符（支持含空格/标点的明文往返）
      cryptotext += c;
    }
  }
  return cryptotext;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "kamasutra",
  cat: "classic",
  name: "Kamasutra 爱经密码",
  desc: "配对表替换（自反：A↔B, C↔D...，加密=解密）",
  params: [{
    key: "key", label: "配对表", type: "text",
    default: "AN BO CP DQ ER FS GT HU IV JW KX LY MZ",
    placeholder: "如 AM BN CO ... 或 AMBNCO 或 AM,BN,CO",
  }],
  encode: kamasutraCode,
  decode: kamasutraCode,
});

export { kamasutraCode, parsePairs };
