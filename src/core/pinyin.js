/*
 * pinyin.js — 数字转拼音 / 汉字转拼音（cat: 'cn'）。
 *
 * 拼音数据来源与覆盖范围（算法正确性铁律，务必看清）：
 * 1. 数字 0-9 拼音：硬编码 DIGITS，带调符号，逐位读（CTF 最常见）。
 * líng/yī/èr/sān/sì/wǔ/liù/qī/bā/jiǔ；门牌电话场景 1 可读 yāo（参数 yao）。
 * 2. 汉字→拼音：内置 PINYIN_MAP 约 300 个高频常用字（据《现代汉语常用字表》
 * 对应普通话读音），仅覆盖高频字。表外汉字按参数原样输出或标 "?"。
 * 3. 多音字：默认取最常见读音（如 长→cháng、了→le），不保证语境正确。
 * 声调形式：带调符号(mark，默认) / 数字调(number，如 nǐ→ni3) / 无调(none)。
 * 数值读法：整数经标准中文数字算法转汉字再查表，支持到「兆」级（10^16）。
 */
import { register } from "./registry.js";

// ============ 数字 0-9 拼音（带调符号，硬编码） ============
const DIGITS = ["líng", "yī", "èr", "sān", "sì", "wǔ", "liù", "qī", "bā", "jiǔ"];

// ============ 带调元音 → [基元音, 调号] 转换表 ============
const TONE_TABLE = {
  "ā": ["a", 1], "á": ["a", 2], "ǎ": ["a", 3], "à": ["a", 4],
  "ō": ["o", 1], "ó": ["o", 2], "ǒ": ["o", 3], "ò": ["o", 4],
  "ē": ["e", 1], "é": ["e", 2], "ě": ["e", 3], "è": ["e", 4],
  "ī": ["i", 1], "í": ["i", 2], "ǐ": ["i", 3], "ì": ["i", 4],
  "ū": ["u", 1], "ú": ["u", 2], "ǔ": ["u", 3], "ù": ["u", 4],
  "ǖ": ["ü", 1], "ǘ": ["ü", 2], "ǚ": ["ü", 3], "ǜ": ["ü", 4],
};

/** 单音节声调形式转换。mark 原样；none 去调号；number 去调号并把调号追加末尾（ü→v，轻声不加）。 */
function convTone(py, mode) {
  if (mode === "mark") return py;
  let base = "";
  let tone = 0;
  for (const ch of py) {
    const t = TONE_TABLE[ch];
    if (t) { base += t[0]; tone = t[1]; }
    else base += ch;
  }
  if (mode === "none") return base; // 保留 ü
  base = base.replace(/ü/g, "v"); // number 模式：ü 写作 v（CTF/输入法惯例）
  return base + (tone ? String(tone) : "");
}

// ============ 高频常用字拼音表（约 300 字，多音字取常见读音） ============
const PINYIN_MAP = {
 // 数字与单位（数值读法依赖这些字）
  "零": "líng", "一": "yī", "二": "èr", "两": "liǎng", "三": "sān", "四": "sì",
  "五": "wǔ", "六": "liù", "七": "qī", "八": "bā", "九": "jiǔ", "十": "shí",
  "百": "bǎi", "千": "qiān", "万": "wàn", "亿": "yì", "兆": "zhào",
  "点": "diǎn", "负": "fù",
 // 高频常用字
  "的": "de", "是": "shì", "不": "bù", "了": "le", "在": "zài", "人": "rén",
  "有": "yǒu", "我": "wǒ", "他": "tā", "她": "tā", "你": "nǐ", "这": "zhè",
  "中": "zhōng", "大": "dà", "来": "lái", "上": "shàng", "国": "guó", "个": "gè",
  "到": "dào", "说": "shuō", "们": "men", "为": "wèi", "子": "zǐ", "和": "hé",
  "地": "dì", "出": "chū", "道": "dào", "也": "yě", "时": "shí", "年": "nián",
  "得": "dé", "就": "jiù", "那": "nà", "要": "yào", "下": "xià", "以": "yǐ",
  "生": "shēng", "会": "huì", "自": "zì", "着": "zhe", "去": "qù", "之": "zhī",
  "过": "guò", "家": "jiā", "学": "xué", "对": "duì", "可": "kě", "里": "lǐ",
  "后": "hòu", "小": "xiǎo", "么": "me", "心": "xīn", "多": "duō", "天": "tiān",
  "而": "ér", "能": "néng", "好": "hǎo", "都": "dōu", "然": "rán", "没": "méi",
  "日": "rì", "于": "yú", "起": "qǐ", "还": "hái", "发": "fā", "成": "chéng",
  "事": "shì", "只": "zhǐ", "作": "zuò", "当": "dāng", "想": "xiǎng", "看": "kàn",
  "文": "wén", "无": "wú", "开": "kāi", "手": "shǒu", "用": "yòng", "主": "zhǔ",
  "行": "xíng", "方": "fāng", "又": "yòu", "如": "rú", "前": "qián", "所": "suǒ",
  "本": "běn", "见": "jiàn", "经": "jīng", "头": "tóu", "面": "miàn", "公": "gōng",
  "同": "tóng", "已": "yǐ", "老": "lǎo", "从": "cóng", "动": "dòng", "长": "cháng",
  "知": "zhī", "民": "mín", "样": "yàng", "现": "xiàn", "分": "fēn", "将": "jiāng",
  "外": "wài", "但": "dàn", "身": "shēn", "些": "xiē", "与": "yǔ", "高": "gāo",
  "意": "yì", "进": "jìn", "把": "bǎ", "法": "fǎ", "此": "cǐ", "实": "shí",
  "回": "huí", "理": "lǐ", "美": "měi", "业": "yè", "什": "shén", "政": "zhèng",
  "全": "quán", "情": "qíng", "定": "dìng", "相": "xiāng", "力": "lì", "明": "míng",
  "使": "shǐ", "关": "guān", "第": "dì", "军": "jūn", "最": "zuì", "女": "nǚ",
  "电": "diàn", "白": "bái", "教": "jiào", "位": "wèi", "系": "xì", "门": "mén",
  "应": "yīng", "提": "tí", "直": "zhí", "化": "huà", "世": "shì", "各": "gè",
  "通": "tōng", "加": "jiā", "常": "cháng", "果": "guǒ", "计": "jì", "义": "yì",
  "反": "fǎn", "平": "píng", "期": "qī", "车": "chē", "更": "gèng", "因": "yīn",
  "少": "shǎo", "由": "yóu", "打": "dǎ", "内": "nèi", "数": "shù", "几": "jǐ",
  "部": "bù", "度": "dù", "声": "shēng", "认": "rèn", "入": "rù", "场": "chǎng",
  "及": "jí", "或": "huò", "别": "bié", "员": "yuán", "联": "lián", "问": "wèn",
  "华": "huá", "京": "jīng", "水": "shuǐ", "火": "huǒ", "木": "mù", "金": "jīn",
  "土": "tǔ", "山": "shān", "石": "shí", "田": "tián", "王": "wáng", "目": "mù",
  "口": "kǒu", "耳": "ěr", "马": "mǎ", "鱼": "yú", "鸟": "niǎo", "花": "huā",
  "草": "cǎo", "树": "shù", "风": "fēng", "雨": "yǔ", "雪": "xuě", "云": "yún",
  "光": "guāng", "月": "yuè", "星": "xīng", "春": "chūn", "夏": "xià", "秋": "qiū",
  "冬": "dōng", "东": "dōng", "南": "nán", "西": "xī", "北": "běi", "左": "zuǒ",
  "右": "yòu", "红": "hóng", "黄": "huáng", "蓝": "lán", "绿": "lǜ", "黑": "hēi",
  "色": "sè", "爱": "ài", "习": "xí", "校": "xiào", "书": "shū", "字": "zì",
  "读": "dú", "写": "xiě", "听": "tīng", "话": "huà", "语": "yǔ", "词": "cí",
  "码": "mǎ", "密": "mì", "解": "jiě", "编": "biān", "译": "yì", "算": "suàn",
  "程": "chéng", "序": "xù", "网": "wǎng", "站": "zhàn", "登": "dēng", "录": "lù",
  "旗": "qí", "标": "biāo", "题": "tí", "答": "dá", "案": "àn", "错": "cuò",
  "真": "zhēn", "假": "jiǎ", "对": "duì", "错": "cuò", "秘": "mì", "藏": "cáng",
  "找": "zhǎo", "到": "dào", "藏": "cáng", "神": "shén", "明": "míng", "恒": "héng",
  "烈": "liè",
};

// ============ 整数 → 中文数字汉字（标准算法，含零/十规范化） ============
function intToChinese(numStr) {
  numStr = numStr.replace(/^0+/, "") || "0";
  if (numStr === "0") return "零";
  const digits = "零一二三四五六七八九";
  const small = ["", "十", "百", "千"];
  const big = ["", "万", "亿", "兆"]; // 每 4 位一组，最多支持到兆（10^16）
 // 从右每 4 位切一组
  const groups = [];
  for (let i = numStr.length; i > 0; i -= 4) {
    groups.unshift(numStr.slice(Math.max(0, i - 4), i));
  }
  const gc = groups.length;
  if (gc > big.length) throw new Error("数值过大（超过兆），请改用逐位读");
  let result = "";
  groups.forEach((g, gi) => {
    const bigIdx = gc - 1 - gi;
    let gstr = "";
    let zeroFlag = false;
    let allZero = true;
    const len = g.length;
    for (let i = 0; i < len; i++) {
      const d = +g[i];
      const pos = len - 1 - i; // 组内小单位位置 3..0
      if (d === 0) {
        zeroFlag = true;
      } else {
        allZero = false;
        if (zeroFlag) { gstr += "零"; zeroFlag = false; }
        gstr += digits[d] + small[pos];
      }
    }
    if (!allZero) {
      result += gstr + big[bigIdx];
    } else if (result && !result.endsWith("零") && gi < gc - 1) {
      result += "零"; // 整组为零且非末组：组间补一个零
    }
  });
  result = result.replace(/^一十/, "十"); // 十几 省首「一」
  result = result.replace(/零+$/, "");     // 去尾零
  return result || "零";
}

// ============ 数字 → 拼音 ============
function numToPinyinRun(text, p) {
  const mode = p.mode || "perDigit";
  const yao = !!p.yao;
  const tone = p.tone || "mark";
  const src = String(text ?? "");

  if (mode === "value") {
    const m = src.trim().match(/^(-|−)?(\d+)(?:\.(\d+))?$/);
    if (!m) throw new Error("数值读法仅支持单个整数或小数（如 1234 / 3.14 / -8）");
    const syl = [];
    if (m[1]) syl.push("fù");
    for (const ch of intToChinese(m[2])) syl.push(PINYIN_MAP[ch] ?? ch);
    if (m[3]) {
      syl.push("diǎn");
      for (const ch of m[3]) syl.push(DIGITS[+ch]);
    }
    return syl.map((s) => convTone(s, tone)).join(" ");
  }

 // 逐位读
  const out = [];
  for (const ch of src) {
    if (ch >= "0" && ch <= "9") {
      const d = +ch;
      out.push(convTone(d === 1 && yao ? "yāo" : DIGITS[d], tone));
    } else if (ch === ".") {
      out.push(convTone("diǎn", tone));
    } else if (ch === "-" || ch === "−") {
      out.push(convTone("fù", tone));
    } else if (/\s/.test(ch)) {
      continue; // 空白跳过（用统一空格重连）
    } else {
      out.push(ch); // 其它字符原样
    }
  }
  return out.join(" ");
}

// ============ 汉字 → 拼音 ============
function hanziToPinyinRun(text, p) {
  const tone = p.tone || "mark";
  const unknown = p.unknown || "keep"; // keep 原样 / mark 标 ?
  const src = String(text ?? "");
  const out = [];
  for (const ch of src) {
    if (/\s/.test(ch)) continue;
    const py = PINYIN_MAP[ch];
    if (py) out.push(convTone(py, tone));
    else if (unknown === "mark") out.push("?");
    else out.push(ch); // 表外字原样
  }
  return out.join(" ");
}

// ============ 注册 ============
register({
  id: "numToPinyin", cat: "cn", name: "数字转拼音",
  desc: "数字读拼音。逐位读(1 可选 yāo)或数值读(中文数字读法，支持到兆)。调号可切换",
  params: [
    { key: "mode", label: "读法", type: "select", default: "perDigit", options: [
      { value: "perDigit", label: "逐位读（1 2 3 → yī èr sān）" },
      { value: "value", label: "数值读（123 → yī bǎi èr shí sān）" },
    ] },
    { key: "yao", label: "逐位时 1 读 yāo", type: "bool", default: false },
    { key: "tone", label: "声调形式", type: "select", default: "mark", options: [
      { value: "mark", label: "带调符号（yī）" },
      { value: "number", label: "数字调（yi1）" },
      { value: "none", label: "无调（yi）" },
    ] },
  ],
  run: numToPinyinRun,
});

register({
  id: "hanziToPinyin", cat: "cn", name: "汉字转拼音",
  desc: "汉字转拼音（内置约300高频常用字，多音字取常见读音，表外字原样/标?）。调号可切换",
  params: [
    { key: "tone", label: "声调形式", type: "select", default: "mark", options: [
      { value: "mark", label: "带调符号（nǐ）" },
      { value: "number", label: "数字调（ni3）" },
      { value: "none", label: "无调（ni）" },
    ] },
    { key: "unknown", label: "表外字", type: "select", default: "keep", options: [
      { value: "keep", label: "原样保留" },
      { value: "mark", label: "标记为 ?" },
    ] },
  ],
  run: hanziToPinyinRun,
});

export {
  numToPinyinRun, hanziToPinyinRun,
  intToChinese, convTone, DIGITS, PINYIN_MAP,
};
