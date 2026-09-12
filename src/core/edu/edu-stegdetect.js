/*
 * edu-stegdetect.js — stegdetect JPEG 隐写检测科普卡（T391）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  stegdetect: {
    what: "JPEG 隐写检测（stegdetect 近似实现）：统计一张 JPEG 的 DCT 系数分布，用 chi-square 卡方攻击判断「是否做过 LSB 类隐写嵌入」（jsteg / jphide / F5 等），输出检出/未检出结论与全套统计指标供人工复核。",
    principle:
      "核心是 Westfeld & Pfitzmann（1999）的 chi-square 攻击。LSB 隐写把信息藏在 DCT 系数最低位，嵌入后系数对 (2i, 2i+1) 的出现次数趋于相等（嵌入把 2i 翻成 2i+1 或反之，统计上两边拉平）；而干净 JPEG 的直方图近似拉普拉斯分布，h(2i) 明显大于 h(2i+1)。\n\n" +
      "做法：对每对 PoV（pair of values）取期望 n(i)=(h(2i)+h(2i+1))/2，算 $\\chi^2 = \\sum (h(2i) - n(i))^{2}/n(i)$，自由度=有效对数−1，得到 p 值——p 越大说明「对内平衡」越明显，越像嵌过。把图从头到尾分比例累计攻击，还能看出嵌入区域是否连续（jsteg 是顺序嵌入，曲线前段 p 高、payload 用完就跌落）。\n\n" +
      "负系数按 m=−2c−1 映射（−1→1、−2→3…），使正负镜像落进同一 PoV 对，且 m 的最低位恰好等于含符号的 LSB 提取位。F5 的收缩嵌入（|c|−1，±1 跳到反号）则表现为 H(1)/H(2) 相对 H(2)/H(3) 抬升，可作第二类特征。",
    usage:
      "拖入 JPEG 文件（或粘 hex / base64 / dataURL），选分析分量（默认仅 Y 亮度）与阈值灵敏度（默认标准 $p \\ge 0.5$），点运行。输出：$\\chi^2$ 与 p 值、20 级累计卡方曲线、10 段分块 p 分布、直方特征（零系数/±1 占比、r12/r23/r34）、顺序嵌入与 F5 收缩特征判定、综合「疑似」结论。检出后可转 F5 提取档（需密钥）或 jsteg 工具继续。",
    examples: [
      { in: "拖入一张疑似 jsteg 隐写的 JPEG", param: "分量=仅 Y，灵敏度=标准", out: "✓ 检出：疑似 LSB 顺序嵌入（jsteg/jphide 系）——χ² p=0.98，嵌入区域连续（约前 35%）\n累计卡方曲线：5%:0.95 10%:0.97 …… 40%:0.12 45%:0.03", desc: "顺序嵌入的典型曲线：前段 p 高，payload 耗尽后跌落" },
      { in: "拖入一张干净的自然照片", param: "默认参数", out: "✗ 未检出（整体 p=0.001 < 0.5，PoV 对未趋平）", desc: "干净图 h(2i)≫h(2i+1)，p 值极低" },
    ],
    tips: [
      "p 值是「与干净假设的吻合度」——p 越大越可疑，方向别记反：p≈0 干净，p→1 疑似嵌入。",
      "累计曲线看「跌落点」：jsteg 顺序嵌入在 payload 用完后 p 立刻跌落，跌落点≈嵌入比例；全程高 p 说明整图嵌满或工具做了打散（F5 置乱）。",
      "本 op 是近似实现（chi-square + 特征启发式），不是原版 stegdetect（Provos 的 C 工具带训练校准）；结论一律带「疑似」，要定罪请再用原版工具或密钥提取验证。",
      "chi-square 只对「足够长的嵌入」敏感：几百字节的payload在百万级系数里拉不平 PoV 对，会漏检——这也是所有统计检测器的通病。",
      "检出「疑似 F5」后：拿密钥去 F5 提取档跑；密钥未知时先试空密钥/常见口令，再看提取头是否合理。",
      "EOI 后附加数据（tail）是另一条线索：DCT 检测没命中时，图里可能只是直接 appended 一个 zip/文本，去十六进制查看器翻文件尾。",
      "渐进式（progressive）JPEG 的块序不是光栅序，顺序特征仅供参考，但整体 $\\chi^2$ 仍然有效。",
    ],
    aka: ["stegdetect", "stegdetect 隐写检测", "JPEG 隐写检测", "JPEG 隐写分析", "steganalysis", "隐写分析", "卡方攻击", "chi-square attack", "卡方检验隐写", "Westfeld 攻击", "Westfeld-Pfitzmann 攻击", "PoV 对分析", "jsteg 检测", "jphide 检测", "F5 检测", "DCT 系数隐写检测", "JPEG steganography detection", "chi2 attack", "隐写图检测", "图种检测"],
  },
};
