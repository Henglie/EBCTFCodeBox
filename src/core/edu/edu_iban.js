/*
 * edu_iban.js — 科普卡候选（IBAN mod-97 校验）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：ISO 13616-1 算法（Wikipedia IBAN 条目镜像）+ iban.com 结构页（均 2026-09-22 访问）。
 */
export default {
  iban: {
    what: "IBAN（International Bank Account Number，国际银行账号）——ISO 13616 定义的国际银行账号统一格式：国家代码（2 字母）+ 校验位（2 数字）+ 各国自定义的 BBAN 账号主体。校验用 ISO 7064 MOD 97-10：整个重排后的 IBAN 数值 mod 97 必须等于 1。CTF 里常见于金融取证/合规题与社工库数据清洗，和 Luhn 卡号校验、ISBN 校验位同一家族。",
    principle:
      "校验：① 检查总长是否等于该国的规定长度（如 GB 22、DE 22、FR 27）；② 把前 4 字符（国家+校验位）移到末尾；\n" +
      "③ 字母换成两位数字（A=10、B=11…Z=35），数字照抄；④ 把整串当十进制大数，mod 97 余 1 即合法。\n" +
      "大数用「逐段法」避免：首段取 9 位求余，把余数拼下 7 位再求余，直到取完（ISO 13616 附件 B 口径，Wikipedia 例：\n" +
      "321428291→70，702345698→29，297654321→24，2461182→1，合法）。\n" +
      "生成校验位：把校验位记 00 做同样的重排换数，得余 r，则校验位 = 98 − r（两位，标准生成域 02-98）。",
    usage:
      "编码：输入「国家代码 + BBAN」（空格随意），如 GB WEST 1234 5698 7654 32，输出完整 IBAN（电子格式无空格）。\n" +
      "解码：输入完整 IBAN，返回「合法（国家 mod-97 校验通过，长度 N 符合该国规定）」或「非法：校验位应为 XX」。\n" +
      "内置 89 国长度表（SWIFT IBAN Registry 镜像，2026-09-22 核对）；长度不符、含非法字符、国家未收录都会显式报错。",
    examples: [
      { in: "GB WEST 1234 5698 7654 32", param: "编码", out: "GB82WEST12345698765432", desc: "ISO 13616-1 规范示例（英国）" },
      { in: "GB82WEST12345698765432", param: "解码", out: "合法（GB IBAN mod-97 校验通过，长度 22 符合该国规定）", desc: "官方示例校验通过" },
      { in: "GB81WEST12345698765432", param: "解码", out: "非法：校验位应为 82（当前 81）", desc: "校验位被改坏（82→81）" },
      { in: "BE539007547034", param: "编码", out: "BE68539007547034", desc: "比利时经典注册表示例反推复现" },
    ],
    formulas: [
      { tex: "\\mathrm{IBAN}_{num} \\bmod 97 = 1", caption: "校验判据（重排换数后整串取模）" },
      { tex: "kk = 98 - \\big(\\mathrm{BBAN}\\Vert CC\\Vert 00\\big)_{num} \\bmod 97", caption: "校验位生成（ISO 13616）" },
    ],
    tips: [
      "识别：2 字母国家码开头 + 2 数字 + 10-30 位字母数字、每 4 字符分组的账号串，基本就是 IBAN；先过长度表再过 mod-97。",
      "手算捷径：重排换数后逐段取模（9 位起步、每次并 7 位），不需要大整数库；A=10 即 ASCII 码减 55。",
      "mod-97 能抓住所有单字符替换、单字符插入/删除和相邻换位——这是它相对简单加权和的优势（Luhn 抓不住部分换位）。",
      "常见坑：长度必须先按国家表核对，否则「结构错误但 mod 97 恰好为 1」的串会被漏判；BBAN 内部各国还有自己的校验位体系（本工具不校验 BBAN 内部规则）。",
      "安全边界：合法只代表格式与校验位正确，不代表账号真实存在——只有开户行能确认；不要用生成的 IBAN 做资金操作。",
      "来源：Wikipedia「International Bank Account Number」https://en.wikipedia.org/wiki/International_Bank_Account_Number ；iban.com https://www.iban.com/structure （访问日期 2026-09-22，均镜像 SWIFT IBAN Registry）。",
    ],
    aka: ["IBAN", "IBAN 校验", "国际银行账号", "International Bank Account Number", "mod-97",
      "ISO 13616", "IBAN validator", "IBAN check digit", "BBAN 校验", "iban number", "银行账号校验", "ISO 7064 MOD 97-10"],
  },
};
