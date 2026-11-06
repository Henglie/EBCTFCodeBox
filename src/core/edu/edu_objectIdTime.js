/*
 * edu_objectIdTime.js — 科普卡候选（ObjectID 时间戳解析）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：BSON Specification 1.1、MongoDB Database Manual「BSON Types → ObjectId」「ObjectId.getTimestamp()」
 * 官方算例（均 2026-09-23 访问，全文与出处见 权威来源.md）。
 */
export default {
  objectIdTime: {
    what: "ObjectID 时间戳解析：把 MongoDB / BSON 的 12 字节 ObjectId（写成 24 位十六进制）拆开，读出它**是何时生成的**、以及同期的随机值与自增计数器。常用于取证时给一串 `_id` 排时间线。",
    principle:
      "ObjectId 是一个固定 **12 字节**（96 位）的值，按顺序分三段：\n" +
      "① **4 字节时间戳**——「自 Unix 纪元起的**秒数**」（注意是秒，不是毫秒）；\n" +
      "② **5 字节随机值**——每个客户端进程启动时生成一次；\n" +
      "③ **3 字节自增计数器**——同一进程内每生成一个 ObjectId 就 +1，溢出回绕。\n\n" +
      "关键坑点：BSON 的**其它数值**一律小端，唯独 ObjectId 的**时间戳与计数器是大端**（最高有效字节在前）。所以 24 位十六进制串的**前 8 个字符**就是那个 4 字节大端秒数，直接 `parseInt(前8位, 16)` 即得 Unix 秒，再转 UTC 就是生成时刻（秒级分辨率）。\n\n" +
      "后 8 字节（5 字节随机值 + 3 字节计数器）是随机的，所以**解析是单向的**：能从 hex 读出时间，但给不出「唯一还原」的 hex。本工具只做解析方向，并另导出确定性的构造函数供出题与对拍。",
    usage:
      "单输入：24 位十六进制字符串（大小写不敏感）。输出是一份**报告**（非密文）：字节分解、Unix 秒时间戳、UTC 生成时间、5 字节随机值、3 字节计数器、位拆分。\n\n" +
      "非 24 位、含非十六进制字符会显式报错，不做静默截断。因为是「解析」型算子（run 单向），没有反向参数。\n\n" +
      "自检：把官方样例 `507c7f79bcf86cd7994f6c0e` 贴进去，应得到生成时间 `2012-10-15T21:26:17Z`。",
    examples: [
      { in: "507c7f79bcf86cd7994f6c0e", param: "（解析）", out: "时间戳 1350336377 / 2012-10-15T21:26:17Z；随机值 bcf86cd799；计数器 5205006", desc: "MongoDB 官方 getTimestamp 算例：`ObjectId(\"507c7f79bcf86cd7994f6c0e\").getTimestamp()` → ISODate(\"2012-10-15T21:26:17Z\")" },
      { in: "64c13ab08edf48a008793cac", param: "（解析）", out: "时间戳 1690385072 / 2023-07-26T15:24:32Z；随机值 8edf48a008；计数器 7945388", desc: "MongoDB 官方 createFromHexString 样例，用于长度/格式口径" },
      { in: "5f3b8c1a2b3c4d5e6f708192", param: "（解析）", out: "时间戳 1597738010 / 2020-08-18T08:06:50Z；随机值 2b3c4d5e6f；计数器 7373202", desc: "普通样例：前 8 位 5f3b8c1a = 1597738010 秒" },
      { in: "1690385072 + a1b2c3d4e5 + 1193046", param: "（构造，反方向自检）", out: "64c13ab0a1b2c3d4e5123456", desc: "确定性构造：64c13ab0 = 1690385072 的大端十六进制；计数器 1193046 = 0x123456" },
    ],
    formulas: [
      { tex: "t = b_0 \\cdot 2^{24} + b_1 \\cdot 2^{16} + b_2 \\cdot 2^{8} + b_3", caption: "前 4 字节大端 → Unix 秒时间戳 t" },
      { tex: "\\text{hex} = \\text{BE}_4(t) \\,\\|\\, \\text{rand}_5 \\,\\|\\, \\text{BE}_3(\\text{ctr})", caption: "构造式：4 字节大端秒 ‖ 5 字节随机 ‖ 3 字节大端计数器" },
    ],
    tips: [
      "一句话记法：**前 8 位十六进制 = 生成时间**。看到 24 位 hex 的 `_id`，先取前 8 位转十进制就是 Unix 秒。",
      "单位坑：ObjectId 时间戳是**秒**不是毫秒；拿到 1350336377 直接当毫秒会得到 1970 年。转 UTC 前记得 ×1000。",
      "字节序坑：BSON 里别的数值是小端，ObjectId 的时间戳/计数器是**大端**。别顺手用小端解析，否则时间会错得离谱。",
      "取证用法：把一批 `_id` 的前 8 位批量转时间排序，就能还原文档的**插入时间线**（秒级）。",
      "精度与单调性边界：只有 **1 秒**分辨率；且时间来自**客户端时钟**，多机或多进程可能时钟不同步，因此「近似有序、非严格单调」，不能当严格时序凭据。",
      "别指望反向：后 8 字节随机，无法从时间反推唯一 ObjectId；解析本质上是单向信息提取。",
      "安全边界：ObjectId 会**泄露生成时间与机器/进程线索**（时间戳 + 随机值 + 计数器），对外暴露 `_id` 等于泄露时间侧信道，设计 API 时需留意。",
      "来源：BSON Specification 1.1（12 字节 ObjectId 元素定义）、MongoDB 手册「BSON Types → ObjectId」（三段布局与大端说明）、「ObjectId.getTimestamp()」官方算例（均 2026-09-23 访问）。",
    ],
    aka: ["objectid 时间戳", "objectid 解析", "mongodb objectid 生成时间", "bson objectid 时间",
      "objectid gettimestamp", "24位十六进制 时间戳", "mongodb _id 时间", "objectid 前8位",
      "objectid 随机值 计数器", "objectid 大端", "bson objectid 结构", "objectid 生成时间 换算",
      "mongodb id 时间提取", "objectid 秒级时间戳"],
  },
};
