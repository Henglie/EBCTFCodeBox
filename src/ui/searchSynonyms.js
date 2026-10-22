/*
 * searchSynonyms.js — 搜索语义同义词（只改检索，不改 op 名）。
 *
 * 目标（恒烈 2026-10-22）：搜「图像 / 图片 / 照片 / 截图」任意一个都能找到另一类；
 * 视频、音频、文本、编码、加密、哈希、压缩、隐写等同理。
 *
 * 两组数据：
 *   anchors —— 强特征词：op 名称/描述里出现它，才把整组别名注入该 op 的检索别名；
 *   words   —— 组内全部词（含 anchors + 弱别名 + 英文/简繁）。
 * 这样「片段」这种弱词只参与查询扩展，不会因为某条字符串描述含「片段」就误判成视频 op。
 */

const GROUPS = [
  {
    key: "image",
    anchors: ["图像", "图片", "照片", "截图", "image", "photo", "picture", "screenshot"],
    words: ["图像", "图片", "照片", "截图", "截屏", "相册", "圖像", "圖片", "照片", "截圖", "相冊", "image", "photo", "picture", "screenshot", "img", "pic"],
  },
  {
    key: "video",
    anchors: ["视频", "影片", "录像", "短片", "video", "movie", "clip", "film"],
    words: ["视频", "影片", "短片", "录像", "片段", "视频片段", "影像", "影视", "視頻", "錄像", "video", "movie", "clip", "film", "footage"],
  },
  {
    key: "audio",
    anchors: ["音频", "声音", "音乐", "录音", "语音", "audio", "sound", "music", "voice"],
    words: ["音频", "声音", "音乐", "录音", "语音", "音頻", "錄音", "audio", "sound", "music", "voice", "recording"],
  },
  {
    key: "text",
    anchors: ["文本", "文字", "字符串", "text", "string"],
    words: ["文本", "文字", "字符串", "字串", "纯文本", "純文本", "text", "string", "txt"],
  },
  {
    key: "encode",
    anchors: ["编码", "转码", "encode", "encoding", "transcode"],
    words: ["编码", "转码", "编码转换", "編碼", "轉碼", "encode", "encoding", "transcode", "convert"],
  },
  {
    key: "decode",
    anchors: ["解码", "译码", "decode"],
    words: ["解码", "还原", "反解", "译码", "解碼", "還原", "decode"],
  },
  {
    key: "code",
    anchors: ["代码", "源码", "脚本", "source", "script"],
    words: ["代码", "源码", "源代码", "脚本", "代碼", "源碼", "source", "script"],
  },
  {
    key: "encrypt",
    anchors: ["加密", "密码学", "加解密", "密文", "cipher", "encrypt", "crypto"],
    words: ["加密", "密码", "密码学", "加解密", "密文", "密碼", "密碼學", "cipher", "ciphertext", "encrypt", "crypto"],
  },
  {
    key: "decrypt",
    anchors: ["解密", "破译", "decrypt", "decipher"],
    words: ["解密", "破译", "破解", "解譯", "decrypt", "decipher", "crack"],
  },
  {
    key: "password",
    anchors: ["口令", "password", "pwd"],
    words: ["口令", "密码", "password", "pwd", "解压密码", "压缩包密码", "登录密码"],
  },
  {
    key: "hash",
    anchors: ["哈希", "摘要", "散列", "hash", "digest"],
    words: ["哈希", "摘要", "散列", "杂凑", "雜湊", "hash", "digest"],
  },
  {
    key: "compress",
    anchors: ["压缩", "解压", "归档", "compress", "zip", "archive"],
    words: ["压缩", "解压", "解压缩", "压缩包", "打包", "归档", "壓縮", "解壓", "歸檔", "compress", "decompress", "zip", "unzip", "archive"],
  },
  {
    key: "stego",
    anchors: ["隐写", "藏密", "水印", "stego", "steganography", "watermark"],
    words: ["隐写", "隐写术", "藏密", "信息隐藏", "水印", "盲水印", "隱寫", "隱寫術", "stego", "steganography", "watermark"],
  },
  {
    key: "qr",
    anchors: ["二维码", "条码", "qr", "barcode"],
    words: ["二维码", "条码", "条形码", "二维条码", "二維碼", "條碼", "qr", "qrcode", "barcode"],
  },
  {
    key: "radix",
    anchors: ["进制", "基数", "数制", "radix"],
    words: ["进制", "基数", "进位制", "数制", "進制", "基數", "radix", "base"],
  },
  {
    key: "key",
    anchors: ["密钥", "秘钥", "私钥", "公钥", "key"],
    words: ["密钥", "秘钥", "私钥", "公钥", "密鑰", "私鑰", "公鑰", "key", "private key"],
  },
  {
    key: "analysis",
    anchors: ["分析", "识别", "检测", "解析", "扫描", "analyze", "detect", "identify", "scan"],
    words: ["分析", "识别", "检测", "解析", "扫描", "检查", "識別", "檢測", "analyze", "detect", "identify", "scan"],
  },
  {
    key: "forensic",
    anchors: ["取证", "流量", "数据包", "pcap", "forensic", "traffic"],
    words: ["取证", "流量", "流量分析", "数据包", "抓包", "包分析", "取證", "數據包", "pcap", "forensic", "traffic"],
  },
];

const WORD_INDEX = new Map();
for (const g of GROUPS) {
  for (const w of new Set(g.words)) {
    const k = w.toLowerCase();
    const list = WORD_INDEX.get(k);
    if (list) { if (!list.includes(g)) list.push(g); }
    else WORD_INDEX.set(k, [g]);
  }
}

/** 查询词 → 同组全部词（原词保留）。单字符/未收录词原样返回。 */
export function synonymsOf(term) {
  const t = String(term == null ? "" : term).trim().toLowerCase();
  if (!t || t.length < 2) return [t];
  const groups = WORD_INDEX.get(t);
  if (!groups || !groups.length) return [t];
  const out = new Set([t]);
  for (const g of groups) for (const w of g.words) out.add(w);
  return [...out];
}

/** 按 op 名称/描述/原别名里的强特征词，把同组别名注入检索别名（不改 op 名）。 */
export function expandAliases(text, baseAka = []) {
  const hay = String(text == null ? "" : text).toLowerCase();
  const out = new Set(baseAka);
  for (const g of GROUPS) {
    if (g.anchors.some((w) => hay.includes(w.toLowerCase()))) {
      for (const w of g.words) out.add(w);
    }
  }
  return [...out];
}

export { GROUPS as SYNONYM_GROUPS };

export default { synonymsOf, expandAliases, SYNONYM_GROUPS: GROUPS };
