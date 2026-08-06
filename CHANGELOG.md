# 更新日志

> 本文档记录完整更新历史。README.md「更新日志」仅保留最新版本变更。

## v0.1.2（已发布）

### 🆕 新增算法（全部通过官方向量验证后接线，585 op）
- **B 组流密码 8 项**：A5/2 / Spritz / VMPC / E0 / HC-128 / HC-256 / Sosemanuk / MICKEY-128 2.0。
- **哈希 3 项**：Skein / Grøstl / JH。
- **KDF 3 项**：Balloon / Lyra2 / yescrypt。
- **CAST-128**（RFC 2144）— 分组密码，密钥扩展 K1-K32 交替 z/x 索引模式，Crypto++ cast128v.txt 官方向量全 PASS。
- **CityHash** — Google 非加密高速哈希，CityHash32/64。Crypto++ 官方 299 组向量全量对拍通过。
- **Threefish** — Skein v1.3 内建可调分组密码，256/512/1024 位分组。
- **Skipjack** — NSA 1998 解密分组密码，NIST SP800-17 全部 11 组向量通过。
- **MARS** — IBM AES 决赛圈分组密码，Crypto++ marsval.dat 全部 10 组向量通过。

### ⚡ 一键解码（智能解码）
- **解码强度四件套**：强度档位 + 自定义算法池 + 暴力爆破独立通道（XOR/凯撒/哈希字典/彩虹表/HMAC/PBE/Playfair/ZIP/CRC32/bkcrack，结果单独归组展示不污染主排序）+ 解析层数 1~3 选择。
- **宽松判定模式（增强 / 极强 / 最强 / 自定义档）**：只判断输入字符种类数，不判定具体字符——变体编码题（「喵呜」表 0/1、emoji 表二进制）也能让相关算法参与解码；默认 / 快速档保持严格定义域识别。
- **拖入 pcap / pcapng 流量包自动跑协议级分析**：一键输出流量概览 + TCP 流重组 + HTTP 对象提取 + DNS 隧道检测 + ICMP 载荷提取四项协议级报告，含 flag 正则检测自动提级告警。

### 🛠 修复
- **一键解码「解码强度」弹窗参与算法选择消失**：CSS grid 布局未给「解析层数」段分配行位，auto-flow 把算法列表挤乱导致选项不可见；已显式定位 4 行布局并补全按钮组样式。
- **暴力爆破算法移入左侧算法列表**：作为虚拟分类与普通算法共用同一折叠 / 搜索 / 勾选 UI，右侧栏仅保留「我的方案」管理。
- **BrainFuck 括号宽容**：孤儿 `]` / 多余 `[` 不再报「括号不匹配」，按 NOP 处理。
- **本地桥 CORS 拦截**：白名单从写死 `localhost:8180` 改为按请求 Origin 反射，127.0.0.1 打开页面时本地桥不再失效。
- **MARS worker 侧注册缺失**：`registerAll.js` 漏注册导致一键解码静默少该算法，已补。

### 🎨 UI / 工程
- 左侧导航多分类同时展开、二级菜单整块深色填充、字体与间距收紧。
- **版本号全局变量化**：统一由 `src/core/version.js` 导出，main.js / mcpBridge.js / index.html 共用同一来源，消除版本号割裂。
- **随波逐流四点对齐**：ROT8000 加 offset 参数、Morse 兼容 BA 替代 + 0/1 数字形式、Caesar 加 mode 参数、天干地支加 mode 参数含错别字兼容字典。
- 纯 JS 快路径优化：base64 encode 12× 提速、hexEncode / byteReverse / xorCrypt 大文件性能优化。
- i18n 16 语言全 979 key 同构。

## v0.1.1（已发布）

- **首个公开发布版本**。
- 518 op 智能解码 + 插件 / MCP 体系 + 18 语言 i18n。
- 发布前基线全绿：op 520 / dup false / failed·orphan 0 / i18n 866 同构 / MCP 6 tools / 插件 18/18 / 真浏览器 magic 7·0 / node magic 35·0·1knownGap / 全路由页面加载 pageError 0。
