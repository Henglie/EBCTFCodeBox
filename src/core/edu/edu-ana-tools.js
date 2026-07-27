// 科普内容分片：analysis 哈希识别/爆破 + hex 查看/统计/diff 工具类。纯数据，无 import 无副作用。
export default {
  extractHashes: {
    what: "提取哈希串：从一大段日志、源码、dump 文本里，用正则把所有像哈希的十六进制串（32~128 位）自动揪出来。",
    principle:
      "哈希摘要是固定长度的纯 hex 串。用正则匹配 32/40/56/64/96/128 个连续 hex 字符的片段，从杂乱文本里批量抓取，再交给识别/爆破。",
    usage: "粘含哈希的文本（如泄露的数据库、配置文件），输出扫到的所有 hex 哈希串。",
    examples: [
      { in: "user=admin pass=21232f297a57a5a743894a0e4a801fc3 ...", out: "21232f297a57a5a743894a0e4a801fc3" },
    ],
    tips: ["取证/数据泄露题里先跑它把哈希捞干净，再逐个 hashTypeIdentify + 爆破。"],
    aka: ["提取哈希", "extract hashes", "哈希抓取", "hash extract", "哈希提取", "hash finder", "find hashes", "hash extractor", "哈希扫描", "hash grep", "摘要提取"],
  },

  rainbowQuery: {
    what: "彩虹表查询：对常见口令预先算好哈希建成表，拿摘要一查就能 O(1) 反推原文，比逐个爆破快。",
    principle:
      "哈希不可逆，但可以「提前算好一堆常见口令 → 摘要」存成表，查的时候拿目标摘要直接反查原文。工具内置 MD5/NTLM 预建表（约几百条小字典）走查表，SHA 系实时算表比对。真正的彩虹表用降维链压缩存储，这里是简化的直查表。",
    usage: "粘目标哈希，工具在内置小字典表里反查原文。查不到就说明不在弱口令表内。",
    examples: [
      { in: "21232f297a57a5a743894a0e4a801fc3", out: "admin", desc: "命中预建表" },
    ],
    tips: ["内置字典小，撞不中不代表破不了 → 换 hmacKeyBrute 或导入大字典爆破。弱口令题基本一查即中。"],
    aka: ["彩虹表", "rainbow table", "彩虹表查询", "哈希反查", "rainbow query", "hash lookup", "哈希查表", "彩虹表攻击", "rainbow table attack", "哈希破解", "查表破解", "预计算表"],
  },

  hmacKeyBrute: {
    what: "HMAC 密钥爆破：给一段消息和它的 HMAC 值，穷举密钥字典找出用的是哪把 key。JWT 弱密钥题的主力。",
    principle:
      "HMAC(key, message) 结果由密钥和消息共同决定。已知 message 和目标 HMAC，就拿字典里每个候选 key 算一遍 HMAC，撞中即为正确密钥。工具内置 top 常见口令 + 纯数字字典，支持 HMAC-SHA1/256/384/512。",
    usage: "填消息、目标 HMAC 值、选哈希算法，工具跑字典爆破密钥。",
    examples: [
      { in: "message + HMAC-SHA256 值", param: "字典爆破", out: "key=secret（若在字典内）" },
    ],
    tips: ["JWT（HS256）签名就是 HMAC：拿 header.payload 当消息、签名段当目标 HMAC，爆出 key 就能伪造任意 token。"],
    aka: ["hmac爆破", "hmac brute", "hmac密钥爆破", "jwt密钥爆破", "hmac key brute", "hmac密钥破解", "jwt secret brute", "jwt弱密钥", "hmac secret crack", "jwt签名爆破", "hmac字典爆破"],
  },

  hexView: {
    what: "十六进制查看器：把任意数据按经典 hexdump 格式排出来——左边偏移、中间 hex 字节、右边可打印 ASCII。看文件结构、找 magic 头必备。",
    principle:
      "每行 16 字节：行首是偏移地址，中间是 16 个字节的两位 hex，末尾把可打印字符原样显示、不可打印的用 `.` 占位。对照 hex 和 ASCII 两列，既能认文件签名又能扫出夹在二进制里的可读串。",
    usage: "粘数据（或 hex），输出 hexdump 视图，支持高亮指定区间。",
    examples: [
      { in: "PNG 文件字节", out: "00000000  89 50 4e 47 0d 0a 1a 0a  ...  .PNG....", desc: "开头 89 50 4E 47 是 PNG magic" },
    ],
    tips: ["认文件类型看开头几字节：89504E47=PNG、FFD8FF=JPEG、504B0304=ZIP、25504446=PDF。ASCII 列里常能瞄到藏的 flag。"],
    aka: ["hexdump", "十六进制查看", "hex view", "hex 视图", "hex viewer", "hex查看器", "十六进制查看器", "hex dump", "字节查看器", "十六进制转储", "hexdump视图", "hex显示"],
  },

  hexRange: {
    what: "Hex 区间提取：从数据里截出指定偏移范围的那几个字节，同时用 hex/十进制/八进制/二进制/ASCII/UTF-8 多种方式展示。",
    principle:
      "先定位到 [起始偏移, 结束偏移) 这段字节，再把同一段字节按不同基数/编码解读。同一串字节当整数、当 ASCII、当 UTF-8 可能是完全不同的信息，多格式对照帮你判断字段真实含义。",
    usage: "填起止偏移，工具截出该区间字节并多格式展示。",
    examples: [
      { in: "文件字节 + 区间 [16,20)", out: "hex=00 00 01 F4 / dec=500 / ...", desc: "把 4 字节当整数读出 500" },
    ],
    tips: ["配合 hexView 先定位再提取：先 dump 看清结构，锁定可疑字段偏移，再用它精确取值解读。"],
    aka: ["hex区间", "hex range", "字节提取", "区间提取", "hex range extract", "字节区间", "hex片段提取", "byte range", "偏移提取", "字节切片", "hex slice", "区段提取"],
  },

  hexStats: {
    what: "字节分布统计：数一数数据里 256 种字节各出现多少次，再算可打印率和香农熵，一眼判断这是文本、编码还是加密/压缩数据。",
    principle:
      "统计 0~255 每个字节值的频次（256 桶），并归成「可打印/控制/高位」3 桶。可打印率高 + 熵低 → 文本；分布均匀 + 熵接近 8 → 加密或压缩；某几个字节扎堆 → 编码或填充。附 top-N 高频字节。",
    usage: "粘数据，输出字节频次分布 + 可打印率 + 香农熵 + 高频字节 top-N。",
    examples: [
      { in: "加密数据块", out: "熵≈7.99, 分布均匀 → 像加密/压缩" },
      { in: "英文文本", out: "可打印率≈99%, 熵≈4.3 → 自然语言" },
    ],
    tips: ["熵接近 8 且分布平 → 加密块，别指望直接看懂；某字节异常高频常是 padding 或 XOR key=0 的痕迹。"],
    aka: ["字节统计", "byte stats", "字节分布", "hex 统计", "byte distribution", "字节频率", "香农熵", "shannon entropy", "byte frequency", "熵分析", "字节直方图", "byte histogram"],
  },

  diffTool: {
    what: "差异对比：把两段输入逐字节或逐行比对，标出哪里不一样。CTF 里找「两个几乎相同文件的隐藏差异」全靠它。",
    principle:
      "等长输入走快速路径逐位比对；不等长用 LCS（最长公共子序列）对齐，再标出插入/删除/替换的区间。既能字节级也能行级 diff，定位差异位置和内容。",
    usage: "粘两段输入（按工具约定分隔），选字节/行模式，输出差异区间。",
    examples: [
      { in: "原文件 vs 改动后文件", out: "偏移 0x1A 处：42 → 43", desc: "定位被篡改的字节" },
    ],
    tips: ["「找两张图/两个文件的不同」题：diff 一下差异区间往往就是藏 flag 的地方。等长时字节 diff 最快。"],
    aka: ["diff", "差异对比", "diff tool", "文件对比", "文本对比", "字节对比", "byte diff", "text diff", "比较工具", "差异比较", "文件比较", "diff比对"],
  },
};
