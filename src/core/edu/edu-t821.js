/*
 * 21 个新 op 的中文科普卡（CyberChef 对齐）。
 * 纯数据，无 import、无副作用，export default { [opId]: EduEntry }。
 *
 * 权威依据（逐卡注明）：
 *   cartesianProduct — CyberChef「Cartesian Product」；集合论直积定义
 *   defangIp         — CyberChef「Defang IP Addresses」；SANS ISC「Defang all the things」
 *   defangUrl        — CyberChef「Defang URL」/ lib/Extract.mjs URL/DOMAIN 正则；SANS ISC
 *   fangUrl          — CyberChef「Fang URL」；SANS ISC
 *   fromCiRegex      — CyberChef「From Case Insensitive Regex」；正则字符类语义（ECMA-262）
 *   haversine        — CyberChef「Haversine distance」；Haversine 公式，R=6371000 m（IUGG 平均半径）
 *   powerSet         — CyberChef「Power Set」；集合论幂集定义
 *   stripIpv4        — RFC 791（IPv4 头 IHL 字段）；CyberChef「Strip IPv4 header」
 *   stripTcp         — RFC 9293（TCP Data Offset 字段）；CyberChef「Strip TCP header」
 *   stripUdp         — RFC 768（UDP 头固定 8 字节）；CyberChef「Strip UDP header」
 *   cssSelector      — CyberChef「CSS selector」；CSS Selectors / @xmldom/xmldom + nwmatcher
 *   jsBeautify       — CyberChef「JavaScript Beautify」；esprima + escodegen
 *   jsMinify         — CyberChef「JavaScript Minify」；terser
 *   jsParser         — CyberChef「JavaScript Parser」；esprima ESTree
 *   jsonataQuery     — CyberChef「Jsonata Query」；jsonata 2.x 文档
 *   sqlBeautify      — CyberChef「SQL Beautify」；sql-formatter（MySQL 方言）
 *   xpathQuery       — CyberChef「XPath expression」；W3C XPath 1.0
 *   jqQuery          — CyberChef「Jq」；jq 手册；jq-web 0.5.1
 *   yaraScan         — CyberChef「YARA Rules」；YARA 文档；libyara-wasm 1.2.1
 *   disasmArm        — CyberChef「Disassemble ARM」；Capstone ARM/Thumb/ARM64 文档
 *   disasmX86        — CyberChef「Disassemble x86」；Capstone x86/x86-64 文档
 *
 * 示例 out 均为对本仓库当前 src 的 registerAll 实测输出（含空格/换行/制表符）。
 * stripIpv4 / stripTcp / stripUdp 的示例按十六进制字节给出，验证脚本以 rawBytes 传入。
 */
export default {
  "cartesianProduct": {
    "what": "笛卡尔积：把两组或多组数据两两组合，列出所有有序搭配。比如集合 {1,2} 和 {a,b} 会得到 (1,a)、(1,b)、(2,a)、(2,b)。",
    "principle": "输入先按「样本分隔符」切成若干组，每组再按「元素分隔符」切成元素列表；然后按嵌套循环顺序做组合：第一组的每个元素依次与第二组的每个元素配对，结果再与第三组配对，依此类推。\n\n每个元组写成 `(元素1,元素2,...)`，元组之间用「元素分隔符」连接。注意：元组内部固定用英文逗号连接，不受元素分隔符影响。组合总数等于各组大小的乘积，组数或元素一多就会迅速膨胀。",
    "usage": "两个参数：样本分隔符默认 `\\n\\n`（两个换行），元素分隔符默认 `,`，都支持 `\\n`、`\\t`、`\\xNN` 这类转义。输入至少要能切成两组，否则报错 `Incorrect number of sets...`。\n空字符串组不会被丢弃：例如 `a\\n\\n` 的第二组是空串，会当成一个空元素参与组合。",
    "tips": [
      "输出顺序是嵌套循环顺序：最后一组变化最快，第一组变化最慢。",
      "元组内部固定用英文逗号；把元素分隔符改成 `|` 只影响元组之间的连接。",
      "组合数 = 各组元素数相乘；10 组 × 每组 10 个就是 100 亿条，不要在大输入上直接跑。",
      "输入里的空元素会保留为一个空位；需要时先清理输入再组合。",
      "CyberChef 的 Cartesian Product 同名同参，本 op 按它的实现逐行对齐。"
    ],
    "aka": [
      "笛卡尔积",
      "笛卡尔乘积",
      "直积",
      "集合直积",
      "笛卡尔积枚举",
      "Cartesian product",
      "Cartesian product of sets",
      "Product set",
      "Set product",
      "Cross product",
      "交叉积",
      "全组合枚举"
    ],
    "examples": [
      {
        "in": "1,2\n\na,b",
        "param": "默认分隔符",
        "out": "(1,a),(1,b),(2,a),(2,b)",
        "desc": "两个集合 {1,2} 与 {a,b} 组合出 4 个元组"
      }
    ]
  },
  "defangIp": {
    "what": "把 IPv4/IPv6 地址改写成「不可直接点击/直接使用」的形式：IPv4 的点变成 `[.]`，IPv6 的冒号变成 `[:]`。常用于安全报告、邮件和 IOC 清单，避免读者误点。",
    "principle": "用两条正则分别识别 IPv4 和 IPv6。IPv4 匹配四段 0–255 的十进制数，可带 `/数字` 形式的 CIDR 后缀；命中后把每个 `.` 换成 `[.]`。IPv6 正则覆盖完整写法、`::` 压缩写法和内嵌 IPv4 的写法；命中后把每个 `:` 换成 `[:]`。\n\n处理顺序是先 IPv4 后 IPv6，所以 IPv6 里内嵌的 IPv4 点会先被改写，后面的 IPv6 正则通常不再把它当作纯 IPv6 整体匹配。",
    "usage": "无参数，输入整段文本。只改写正则能匹配到的地址，周围文字原样保留；IPv4 的 CIDR 后缀（如 `/24`）会保留。",
    "tips": [
      "这不是加密，只是让地址/链接在聊天工具、邮件里不自动变成可点击链接。",
      "IPv4 每段超过 255（如 `999.1.1.1`）不会被当成完整地址改写。",
      "IPv6 用的是 CyberChef 同款正则，覆盖常见写法，但不等价于完整的 RFC 4291 解析器。",
      "没有专用的「还原 IP」op：IPv4 手动把 `[.]` 换回 `.`；URL 可用 Fang URL 还原。",
      "改写后的文本不可直接当 IP 用，适合贴报告和工单。"
    ],
    "aka": [
      "Defang IP",
      "Defang IP Addresses",
      "IP defanging",
      "IP address defanging",
      "去毒 IP 地址",
      "IP 去毒",
      "IP 地址去毒",
      "IOC 去毒",
      "恶意 IP 钝化",
      "拔牙 IP",
      "IP 钝化",
      "反自动链接 IP"
    ],
    "examples": [
      {
        "in": "192.168.1.1 8.8.8.8/24 2001:db8::1",
        "param": "无参数",
        "out": "192[.]168[.]1[.]1 8[.]8[.]8[.]8/24 2001[:]db8[:][:]1",
        "desc": "IPv4 的点与 IPv6 的冒号都被方括号包住，CIDR 后缀保留"
      }
    ]
  },
  "defangUrl": {
    "what": "把 URL 和域名改写成不能直接点击的 IOC 形式：点 → `[.]`、`http` → `hxxp`、`://` → `[://]`。三项可以分别开关，处理范围可选「域名与完整 URL / 仅完整 URL / 全文」。",
    "principle": "先用 CyberChef Extract 的 URL 正则（`协议://主机[:端口][/路径]`）找完整 URL，再用域名正则找裸域名；按「处理范围」决定改哪些。三个改写开关互相独立：\n\n1. `dots`：把 `.` 换成 `[.]`；\n2. `http`：不区分大小写地把子串 `http` 换成 `hxxp`，因此 `https` 会变成 `hxxps`；\n3. `slashes`：把 `://` 换成 `[://]`。\n\n选「全文」时不找链接，直接对整段文本做上述替换，可能改到非链接内容。",
    "usage": "四个参数：`dots`、`http`、`slashes` 三个布尔开关（默认全开），以及 `process`（默认「有效域名与完整 URL」）。只想改完整链接时把 `process` 切到「仅完整 URL」。",
    "tips": [
      "Fang URL 是它的逆操作，但 Fang 还原 `hxxp` 时区分大小写。",
      "`http` 是子串替换，`https` → `hxxps`、`HTTP` → `hxxp`（替换文本固定小写）。",
      "处理范围选「有效域名与完整 URL」时裸域名也会被改写；不想动裸域名就选「仅完整 URL」。",
      "`hxxp` 是安全圈的惯例写法，不是协议；改写后的文本不能直接访问。",
      "对恶意样本操作时，先确认文本里没有你还需要保留原样的正常 URL。"
    ],
    "aka": [
      "Defang URL",
      "URL defanging",
      "URL 去毒",
      "链接去毒",
      "恶意链接钝化",
      "IOC 链接去毒",
      "URL 消毒",
      "反自动链接 URL",
      "hxxp 化",
      "hxxp 替换",
      "禁用超链接",
      "URL 中性化"
    ],
    "examples": [
      {
        "in": "http://example.com/path",
        "param": "默认（域名与完整 URL，三项转义全开）",
        "out": "hxxp[://]example[.]com/path",
        "desc": "http → hxxp、:// → [://]、点 → [.]"
      }
    ]
  },
  "fangUrl": {
    "what": "Fang URL 是 Defang URL 的逆操作：把 `[.]` 还原成 `.`、`hxxp` 还原成 `http`、`[://]` 还原成 `://`，让被「去毒」的链接重新可用。",
    "principle": "按顺序做三次字符串替换：`[.]` → `.`、`hxxp` → `http`、`[://]` → `://`。三个开关分别控制对应替换，关掉某一项就保留该形态。\n\n注意 `hxxp` 的替换区分大小写，只认小写；Defang URL 生成时用的是小写 `hxxp`，所以正常往返没问题，但手写的 `HXXP` 不会被还原。",
    "usage": "三个布尔参数 `dots`、`http`、`slashes`（默认全开）。输入整段文本，只替换这三种固定标记，其他文字原样保留。",
    "tips": [
      "只还原这三种标记；`[dot]`、`hxxp://` 之外的自定义变形不会处理。",
      "还原后链接重新可点击，处理恶意样本时注意不要误点。",
      "不是解密：Defang 时若还改过其他字符，本 op 无法恢复。",
      "`HXXP` 这类大写需要先转成小写再还原。",
      "与 Defang URL 组合可做往返测试，验证文本里是否只有预期的去毒标记。"
    ],
    "aka": [
      "Fang URL",
      "URL fanging",
      "URL 还原",
      "链接还原",
      "去毒还原",
      "Defang 逆向",
      "反去毒",
      "hxxp 还原",
      "[.] 还原",
      "URL 复原",
      "URL 恢复",
      "还原 IOC 链接"
    ],
    "examples": [
      {
        "in": "hxxp[://]example[.]com/path",
        "param": "默认（三项还原全开）",
        "out": "http://example.com/path",
        "desc": "Defang URL 的逆操作"
      }
    ]
  },
  "fromCiRegex": {
    "what": "把 `[aA]`、`[mM]` 这种「为模拟大小写不敏感而展开」的正则字符类，折叠回一个字母，得到更短的正则字符串。",
    "principle": "正则 `\\[[a-z]{2}\\]`（忽略大小写）匹配由两个字母组成的字符类。如果两个字母忽略大小写后相同（如 `[aA]`、`[Gg]`），就返回字符类的第一个字符；否则原样保留（如 `[ab]` 是两个不同字母，`[0-9]` 不是两个字母，都不动）。\n\n因此输出的大小写由字符类里先写的字母决定：`[mM]` → `m`，`[Mm]` → `M`。CyberChef 文档示例写的是 `Mozilla`，但同一段代码实际输出 `mozilla`——以实际结果为准。",
    "usage": "无参数，输入正则源码字符串。它只做文本替换，不会编译或执行正则。",
    "tips": [
      "只处理两个字母的类；`[aA1]`、`[a-zA-Z]` 不处理。",
      "不保证还原原始大小写，只是把展开的类折叠成一个代表字符。",
      "字符类里先写的字母决定输出：`[mM]` → `m`，`[Mm]` → `M`。",
      "这个 op 处理的是正则源码，不会判断正则是否合法。",
      "得到的结果通常还要配合 `i` 标志或再手工调整大小写。"
    ],
    "aka": [
      "From Case Insensitive Regex",
      "大小写不敏感正则还原",
      "还原大小写不敏感正则",
      "正则去方括号",
      "字符类展开",
      "大小写展开",
      "正则简化",
      "case-insensitive regex 还原",
      "不区分大小写正则转换",
      "正则字符类合并",
      "[aA] 展开",
      "正则还原"
    ],
    "examples": [
      {
        "in": "[mM][oO][zZ][iI][lL][lL][aA]/[0-9].[0-9] .*",
        "param": "无参数",
        "out": "mozilla/[0-9].[0-9] .*",
        "desc": "字符类折叠成首字母；本输入首字母为小写，所以得到 mozilla；[0-9] 原样保留"
      }
    ]
  },
  "haversine": {
    "what": "Haversine（半正矢）球面距离：输入两个点的纬度和经度，按地球平均半径 6371000 米计算两点沿球面的最短距离，单位是米。",
    "principle": "公式：$a=\\sin^2(\\Delta\\varphi/2)+\\cos\\varphi_1\\cos\\varphi_2\\sin^2(\\Delta\\lambda/2)$，$d=2R\\arctan2(\\sqrt{a},\\sqrt{1-a})$。其中 $\\varphi$ 是纬度、$\\lambda$ 是经度，都要先由度转弧度；$R$ 固定为 6371000 m。\n\n输入格式必须严格是 `lat1, lng1, lat2, lng2`：四个可带负号和小数的数，逗号后最多一个空格，首尾不能有空格。纬度在前、经度在后。",
    "usage": "无参数。输出是 `String(metres)` 的完整十进制字符串，不取整、不加单位。格式不符（缺值、制表符、多余空格）会报错 `Input must in the format lat1, lng1, lat2, lng2`。",
    "tips": [
      "输入顺序是纬度、经度；写反会得到完全不同的距离。",
      "结果是米且未取整；球体模型与真实椭球相比误差可达约 0.3%，高精度场景应使用 Vincenty 等椭球公式。",
      "这是两点间的大圆距离，不是驾车/步行路径长度。",
      "跨 180° 经线时公式仍按经度差计算，正弦平方会处理周期性。",
      "输入限制很严格：四个值必须齐全，不能有多余空格或其他字符。"
    ],
    "aka": [
      "Haversine distance",
      "Haversine formula",
      "Haversine 公式",
      "半正矢公式",
      "半正矢距离",
      "球面距离",
      "大圆距离",
      "Great-circle distance",
      "经纬度距离",
      "GPS 距离",
      "地球表面距离",
      "两点间球面距离"
    ],
    "examples": [
      {
        "in": "51.487263,-0.124323, 38.9517,-77.1467",
        "param": "无参数",
        "out": "5902542.836307819",
        "desc": "伦敦到华盛顿的球面距离，约 5902.5 km"
      }
    ]
  },
  "powerSet": {
    "what": "幂集：把一个集合的所有子集全部列出来，包括空集和集合本身。比如 {1,2,3} 会得到 8 个子集。",
    "principle": "对 n 个元素，用 0 到 $2^n-1$ 的二进制位图表示子集：第 i 位是 1 就选第 i 个元素。这样能不重不漏地枚举全部 $2^n$ 个子集。结果按拼接后的字符串长度升序排序，再在每个子集后加换行。\n\n实现里先过滤空元素；输入为空或全是分隔符时直接返回空串。注意二进制转换用了 `(n >>> 0)`，元素数接近或超过 32 时会发生 32 位截断，实际可用规模远小于理论值。",
    "usage": "一个参数：元素分隔符，默认 `,`，支持 `\\n`、`\\t` 等转义。输出每个子集用该分隔符连接，然后加 `\\n`；空子集对应一行空行，所以输出通常以换行开头。",
    "tips": [
      "输出的第一行是空行，代表空集，不是 bug。",
      "排序按拼接后的字符串长度，不是严格的元素个数；元素长短不一时顺序可能反直觉。",
      "$2^n$ 增长极快：20 个元素约 104 万行，30 个就超过十亿行，不要在大输入上跑。",
      "输入里有重复元素时，不同位图会产生相同的子集文本，输出会出现重复行（Set 去重的是数组引用，不是内容）。",
      "只有分隔符或空输入返回空串，而不是一行空行。"
    ],
    "aka": [
      "Power Set",
      "Power set",
      "幂集",
      "集合的幂集",
      "所有子集",
      "子集枚举",
      "Subset enumeration",
      "Set of all subsets",
      "P(S)",
      "2^S",
      "子集族",
      "全部子集"
    ],
    "examples": [
      {
        "in": "1,2,3",
        "param": "元素分隔符=,",
        "out": "\n3\n2\n1\n2,3\n1,3\n1,2\n1,2,3\n",
        "desc": "输出 8 个子集；第一行空行代表空集，单元素子集顺序是 3、2、1"
      }
    ]
  },
  "stripIpv4": {
    "what": "剥掉 IPv4 头，只留下载荷。输入是一段 IPv4 报文字节，输出是跳过 IP 头之后的字节。",
    "principle": "IPv4 头第一个字节的高 4 位是版本（4），低 4 位是首部长度 IHL，单位是 4 字节；头部字节数 = IHL × 4，最小 5 × 4 = 20 字节。op 只读第一个字节的低 4 位，跳过该长度，把剩余字节按 Latin-1 原样输出。\n\n它不校验版本、总长度、校验和、分片和选项内容；IHL 小于 5（例如 4 → 16 字节）也会照跳，因为实现只做长度计算。",
    "usage": "无参数。输入走字节视图/`rawBytes`；没有真字节时按 UTF-8 文本编码。少于 20 字节报错；输入短于 IHL × 4 也报错。输出是 Latin-1 字符串，0x80–0xFF 会保留为对应码点。",
    "tips": [
      "这是「去头」不是「解析」：不检查 IPv4 版本和校验和。",
      "IHL 包含选项：带选项的 IPv4 头可能是 24/28… 字节，本 op 会按 IHL 正确跳过。",
      "输出按 Latin-1 保留原字节；载荷是二进制时继续用十六进制视图查看，别当 UTF-8。",
      "分片包只去掉当前分片的 IP 头，重组不在本 op 范围内。",
      "如果输入是完整以太网帧，要先剥掉 14 字节以太网头再交给本 op。"
    ],
    "aka": [
      "Strip IPv4 header",
      "剥离 IPv4 头",
      "去除 IPv4 头",
      "IPv4 头剥离",
      "IPv4 header stripping",
      "IPv4 载荷提取",
      "提取 IPv4 载荷",
      "IP 头剥离",
      "去掉 IP 头",
      "IPv4 数据报去头",
      "Strip IPv4",
      "IPv4 payload extraction"
    ],
    "examples": [
      {
        "in": "45 00 00 20 00 01 40 00 40 06 00 00 01 02 03 04 05 06 07 08 68 65 6c 6c 6f",
        "param": "字节输入（rawBytes=十六进制）",
        "out": "hello",
        "desc": "首字节 0x45 → IHL=5 → 跳过 20 字节头，载荷为 hello"
      }
    ]
  },
  "stripTcp": {
    "what": "剥掉 TCP 头，只留下 TCP 载荷。输入是一段 TCP 段字节，输出是跳过 TCP 头之后的字节。",
    "principle": "TCP 头最小 20 字节；第 13 个字节（下标 12）的高 4 位是 Data Offset，单位是 4 字节，所以头部字节数 = Data Offset × 4。op 读取这个值，跳过对应长度，把剩余字节按 Latin-1 输出。\n\n它不校验端口、序列号、标志位、校验和，也不检查 TCP 长度字段；只按数据偏移做切分。输入必须包含完整 TCP 头，不能带 IP 头。",
    "usage": "无参数。输入走字节视图/`rawBytes`；没有真字节时按 UTF-8 文本编码。少于 20 字节报错；输入短于 Data Offset × 4 也报错。输出是 Latin-1 字符串。",
    "tips": [
      "Data Offset 最小是 5（20 字节）；带选项时可到 15（60 字节），本 op 会按实际值跳过。",
      "输入应是 TCP 段而不是完整 IP 包；完整 IP 包要先用 Strip IPv4 header。",
      "输出按 Latin-1 保留原字节，二进制载荷用十六进制视图查看。",
      "不验证校验和与长度字段，所以畸形 TCP 段也可能被「成功」去头。",
      "UDP 用 Strip UDP header；两者头部长度规则不同。"
    ],
    "aka": [
      "Strip TCP header",
      "剥离 TCP 头",
      "去除 TCP 头",
      "TCP 头剥离",
      "TCP header stripping",
      "TCP 载荷提取",
      "提取 TCP 载荷",
      "去掉 TCP 头",
      "TCP 段去头",
      "TCP payload extraction",
      "Strip TCP",
      "TCP 数据去头"
    ],
    "examples": [
      {
        "in": "00 50 1f 90 00 00 00 01 00 00 00 00 50 02 20 00 00 00 00 00 68 65 6c 6c 6f",
        "param": "字节输入（rawBytes=十六进制）",
        "out": "hello",
        "desc": "第 12 字节 0x50 的高 4 位为 5 → 跳过 20 字节头，载荷为 hello"
      }
    ]
  },
  "stripUdp": {
    "what": "剥掉固定 8 字节的 UDP 头，只留下 UDP 载荷。输入是一段 UDP 数据报字节，输出是第 9 个字节起的剩余字节。",
    "principle": "UDP 头固定 8 字节：源端口 2 字节、目的端口 2 字节、长度 2 字节、校验和 2 字节。op 直接跳过前 8 字节，把剩余字节按 Latin-1 输出。\n\n它不读取 UDP 长度字段，也不校验端口和校验和；输入短于 8 字节直接报错。",
    "usage": "无参数。输入走字节视图/`rawBytes`；没有真字节时按 UTF-8 文本编码。输出是 Latin-1 字符串。",
    "tips": [
      "UDP 头长度固定，不存在 TCP 那种选项字段。",
      "输入应是 UDP 数据报而不是完整 IP 包；完整 IP 包要先用 Strip IPv4 header。",
      "UDP 长度字段可能小于实际字节数（尾部填充），本 op 不按长度截断，会原样保留尾部字节。",
      "输出是原始字节的 Latin-1 表示，二进制内容用十六进制视图查看。",
      "DNS、DHCP 等 UDP 协议可先去掉 8 字节头再解析载荷。"
    ],
    "aka": [
      "Strip UDP header",
      "剥离 UDP 头",
      "去除 UDP 头",
      "UDP 头剥离",
      "UDP header stripping",
      "UDP 载荷提取",
      "提取 UDP 载荷",
      "去掉 UDP 头",
      "UDP 数据报去头",
      "UDP payload extraction",
      "Strip UDP",
      "UDP 数据去头"
    ],
    "examples": [
      {
        "in": "04 d2 00 35 00 0d 00 00 68 65 6c 6c 6f",
        "param": "字节输入（rawBytes=十六进制）",
        "out": "hello",
        "desc": "UDP 头固定 8 字节，载荷为 hello"
      }
    ]
  },
  "cssSelector": {
    "what": "用 CSS 选择器从 HTML 文档里挑出节点。比如选 `a` 就取出所有链接元素，选 `.item` 就取出所有 class 为 item 的元素。",
    "principle": "输入先交给 @xmldom/xmldom 解析成 DOM，再用 nwmatcher 执行 CSS 选择器，最后对每个命中节点调用 `toString()`（序列化成标记文本），用分隔符连接。\n\nnwmatcher 实现的是 CSS2/CSS3 的常用子集（标签、类、ID、属性、后代/子代/兄弟、伪类等），不是浏览器里完整的 Selectors Level 4；xmldom 对 HTML 的容错也不如浏览器，畸形标签可能解析失败。",
    "usage": "两个参数：`query`（CSS 选择器）和 `delimiter`（结果分隔符，默认 `\\n`，支持转义）。`query` 或输入为空时直接返回空串。HTML 解析失败报 `Invalid input HTML.`；选择器语法错误报 `Invalid CSS Selector. Details:\\n...`。输出是命中节点的标记文本（含外层标签）。",
    "tips": [
      "`a` 提取所有链接；`#id`、`.class`、`[href]`、`div > span` 都可用。",
      "返回的是节点序列化文本，不是纯文本；只要文字可再接正则或 HTML 提取。",
      "xmldom 不是浏览器：HTML5 的隐式标签补全、大小写归一可能与页面里看到的不同。",
      "查询为空直接返回空串，不报错；选择器语法错才报错。",
      "要提取属性值，可在结果后接正则，或改用 XPath 表达式直接选属性节点。"
    ],
    "aka": [
      "CSS selector",
      "CSS 选择器",
      "CSS 选择符",
      "样式选择器",
      "Cascading Style Sheets selector",
      "CSS 节点提取",
      "HTML 节点提取",
      "CSS 查询",
      "querySelector",
      "CSS selector query",
      "CSS 元素选择",
      "层叠样式表选择器"
    ],
    "examples": [
      {
        "in": "<html><body><a href=\"/x\">One</a><a href=\"/y\">Two</a></body></html>",
        "param": "query=a, delimiter=\\n",
        "out": "<a href=\"/x\">One</a>\n<a href=\"/y\">Two</a>",
        "desc": "提取两个 a 元素，按换行连接"
      }
    ]
  },
  "jsBeautify": {
    "what": "JavaScript 美化：把挤在一起的 JS 代码重新排版，加上缩进、空格和换行，让结构一眼看清；可选引号风格、右花括号前分号和注释保留。",
    "principle": "先用 esprima 把源码解析成 AST（带 range、tokens、comment），再用 escodegen 从 AST 重新生成代码，并按选项控制缩进、引号风格、右花括号前是否补分号、是否保留注释。\n\n因为走的是「解析 → 重新生成」而不是简单加空格，注释位置、引号、换行可能被重排；语法错误会直接失败。esprima 的 `parseScript` 只按脚本解析，顶层 `import`/`export` 会报错。",
    "usage": "四个参数：`indent`（缩进字符串，默认 `\\t`）、`quotes`（auto/single/double）、`semicolons`（右花括号前是否补分号）、`comments`（是否保留注释）。解析失败报 `Unable to parse JavaScript.<br>...`。",
    "tips": [
      "只支持脚本（Script），不支持 ES Module 顶层 `import`/`export`。",
      "美化会重排注释和引号；不要把输出当成逐字节等价的原文件。",
      "顶层 JSON 对象直接 `{...}` 在脚本语法里会被当成块语句，可能报错；先包一层括号或改用 JSON 美化。",
      "缩进参数支持 `\\t`、两个空格等转义；空字符串会回退为制表符。",
      "需要保持原格式时不要用美化；它只保证语义结构，不保证排版不变。"
    ],
    "aka": [
      "JavaScript Beautify",
      "JS Beautify",
      "JavaScript 美化",
      "JS 美化",
      "JavaScript 格式化",
      "JS 格式化",
      "代码美化",
      "代码格式化",
      "Pretty print JavaScript",
      "JavaScript pretty printer",
      "美化 JS",
      "格式化 JS"
    ],
    "examples": [
      {
        "in": "function f(a){return a+1;}",
        "param": "indent=\\t, quotes=auto, semicolons=true, comments=true",
        "out": "function f(a) {\n\treturn a + 1;\n}",
        "desc": "默认参数下补空格、换行和缩进"
      }
    ]
  },
  "jsMinify": {
    "what": "JavaScript 压缩：用 terser 把 JS 代码里的空白、换行和注释删掉，并把局部变量名缩短，得到体积更小的等价代码。",
    "principle": "terser 先解析成 AST，再做压缩：删除空白和注释、缩短局部变量名、合并/简化常量与不可达代码等。默认不做属性名混淆，也不会删除顶层函数名。\n\n压缩是不可逆的：变量名和格式信息会丢失；需要调试时请保留原始源码。",
    "usage": "无参数。输入合法 JavaScript，输出压缩后的代码字符串。语法错误会报 `Error minifying JavaScript. (...)`。",
    "tips": [
      "terser 的变量重命名是作用域安全的，但依赖 `eval`/`with` 的代码可能被保守处理或报错。",
      "压缩不等于加密，逻辑仍可读；敏感信息不要靠压缩隐藏。",
      "需要 source map 时本 op 不提供，得在构建工具里配置。",
      "压缩后再美化通常无法恢复原变量名，只能恢复缩进。",
      "对已经压缩的代码再压缩收益很小，可能只做少量常量折叠。"
    ],
    "aka": [
      "JavaScript Minify",
      "JS Minify",
      "JavaScript 压缩",
      "JS 压缩",
      "JavaScript 最小化",
      "JS 最小化",
      "代码压缩",
      "代码最小化",
      "Minify JavaScript",
      "JavaScript minification",
      "terser",
      "压缩 JS"
    ],
    "examples": [
      {
        "in": "function add(a, b) { return a + b; }",
        "param": "无参数",
        "out": "function add(n,d){return n+d}",
        "desc": "terser 删除空白并把参数名缩短为 n、d"
      }
    ]
  },
  "jsParser": {
    "what": "JavaScript 解析：把 JS 源码解析成抽象语法树（AST），用 JSON 展示程序结构。适合看代码由哪些语句、表达式和标识符组成。",
    "principle": "esprima 的 `parseScript` 按 ECMAScript 脚本语法解析，输出 ESTree 风格的 AST。默认只含 `type`、`body`、`sourceType`；打开 `loc`/`range`/`tokens`/`comments` 会附加位置、字符区间、词法单元和注释数组。\n\n`tolerant=true` 时解析器会尽量继续并报告可恢复错误，但严重错误仍会抛异常。输出是 `JSON.stringify(result, null, 2)`，两空格缩进。",
    "usage": "五个布尔参数：`loc`（行列位置）、`range`（字符区间）、`tokens`（词法单元）、`comments`（注释）、`tolerant`（容错）。输入按 Script 解析；顶层 `import`/`export` 会报错。",
    "tips": [
      "AST 是语法结构，不含执行结果；要看语义得自己遍历节点。",
      "只支持 Script，不支持 Module 顶层 `import`/`export`。",
      "`loc` 的行从 1 开始、列从 0 开始，和大多数编辑器一致。",
      "JSON 输出可能很大；复杂文件建议先只开需要的选项。",
      "解析成功不代表代码能运行，只代表语法合法。"
    ],
    "aka": [
      "JavaScript Parser",
      "JS Parser",
      "JavaScript 解析器",
      "JS 解析器",
      "JavaScript 解析",
      "JS 解析",
      "AST 生成",
      "抽象语法树",
      "Abstract Syntax Tree",
      "esprima",
      "JavaScript AST",
      "语法树解析"
    ],
    "examples": [
      {
        "in": "var a=1;",
        "param": "所有选项关闭",
        "out": "{\n  \"type\": \"Program\",\n  \"body\": [\n    {\n      \"type\": \"VariableDeclaration\",\n      \"declarations\": [\n        {\n          \"type\": \"VariableDeclarator\",\n          \"id\": {\n            \"type\": \"Identifier\",\n            \"name\": \"a\"\n          },\n          \"init\": {\n            \"type\": \"Literal\",\n            \"value\": 1,\n            \"raw\": \"1\"\n          }\n        }\n      ],\n      \"kind\": \"var\"\n    }\n  ],\n  \"sourceType\": \"script\"\n}",
        "desc": "输出两空格缩进的 AST JSON；默认只含 type/body/sourceType"
      }
    ]
  },
  "jsonataQuery": {
    "what": "用 Jsonata 表达式查询和转换 JSON：可以取字段、过滤数组、求和、拼接字符串，最后输出 JSON 文本。可以把它理解成「JSON 界的公式语言」。",
    "principle": "Jsonata 是 JSON 查询/转换表达式语言：路径 `a.b` 取字段，`$sum(a)` 调内置函数，支持谓词、映射、聚合、字符串函数等。op 先 `JSON.parse` 输入，再编译并执行表达式，最后 `JSON.stringify` 结果；表达式无结果（undefined）时输出空字符串 `\"\"`。\n\n额外注册了 `base64encode`/`base64decode`，用浏览器的 `atob`/`btoa` 实现，避免 Worker 环境缺 Buffer。",
    "usage": "一个参数：`query`，默认 `string`（取名为 string 的字段，不是类型转换）。输入必须是合法 JSON；解析失败报 `Invalid input JSON: ...`，表达式错误报 `Invalid Jsonata Expression: ...`。",
    "tips": [
      "`string` 是字段名；想转字符串用 `$string(...)`。",
      "输出是紧凑 JSON，不是格式化；需要好看可再接 JSON 美化。",
      "表达式返回多个值时结果是数组；返回 undefined 时输出空串。",
      "Jsonata 与 jq 语法不同：字段用 `a.b`，函数以 `$` 开头。",
      "`base64encode`/`base64decode` 只适合短文本，且按 Latin-1/UTF-8 行为取决于浏览器实现。"
    ],
    "aka": [
      "Jsonata Query",
      "JSONata",
      "JSONata 查询",
      "Jsonata 查询",
      "JSON 查询语言",
      "JSON 转换查询",
      "JSONata expression",
      "JSONata 表达式",
      "JSON 查询",
      "JSON 转换",
      "JSONata query language",
      "JSONata 路径查询"
    ],
    "examples": [
      {
        "in": "{\"a\":[1,2,3]}",
        "param": "query=$sum(a)",
        "out": "6",
        "desc": "对数组求和，结果以 JSON 数字输出"
      }
    ]
  },
  "sqlBeautify": {
    "what": "SQL 美化：把一行到底的 SQL 重新缩进排版，按 SELECT、FROM、WHERE 等子句分层，并把 `:name` 形式的绑定变量原样保留。",
    "principle": "sql-formatter 按 MySQL 方言把 SQL 切成 token，再按关键字、子句和括号层级重新缩进。op 先把 `:name` 形式的绑定变量替换成 `__BIND_n__` 占位符，格式化后再换回，避免格式化器把冒号变量拆开或改写。\n\n关键字大小写保持原样（不强制大写）；它不是 SQL 语法校验器，畸形 SQL 也可能被排版。",
    "usage": "一个参数：`indent`（缩进字符串，默认 `\\t`）。填 `\\t` 时用制表符；填两个空格则按 2 空格缩进。输出保留绑定变量。",
    "tips": [
      "方言固定 mysql；其他数据库的方言差异（如 PostgreSQL 的 `::` 类型转换）可能被误排。",
      "缩进为 `\\t` 时用制表符；填两个空格则按 2 空格缩进。",
      "绑定变量会保留，但出现在字符串/注释里的 `:word` 也会被占位再还原。",
      "美化不改变语义，但会重排空白和换行；对比 SQL 差异时注意。",
      "要强制关键字大写，本 op 不支持；可在格式化后再手动/正则处理。"
    ],
    "aka": [
      "SQL Beautify",
      "SQL 美化",
      "SQL 格式化",
      "SQL 代码美化",
      "SQL 语句格式化",
      "SQL formatter",
      "sql-formatter",
      "SQL pretty print",
      "美化 SQL",
      "格式化 SQL",
      "SQL 缩进",
      "Structured Query Language Beautify"
    ],
    "examples": [
      {
        "in": "select * from users where id=:id",
        "param": "indent=\\t",
        "out": "select\n\t*\nfrom\n\tusers\nwhere\n\tid = :id",
        "desc": "按 MySQL 方言缩进；关键字保持输入的小写，绑定变量 :id 原样保留"
      }
    ]
  },
  "xpathQuery": {
    "what": "用 XPath 从 XML 文档里选节点。比如 `//item` 取所有 item 元素，`/root/a/@id` 取属性值。多个结果按分隔符连接。",
    "principle": "用 @xmldom/xmldom 解析 XML（遇到 fatalError 直接抛），再用 xpath 库编译并执行表达式，返回节点数组；每个节点 `toString()` 后用分隔符连接。\n\n`allowAnyNamespaceForNoPrefix: true` 让没有前缀的名称匹配任意命名空间，适合不想写 `ns:` 前缀的文档；但带前缀的表达式仍要求文档里声明了对应命名空间。",
    "usage": "两个参数：`query`（XPath 表达式）和 `delimiter`（结果分隔符，默认 `\\n`，支持转义）。XML 解析失败报 `Invalid input XML.`；表达式错误报 `Invalid XPath. Details:\\n...`。输出是节点序列化文本。",
    "tips": [
      "XPath 返回属性/文本节点时，`toString()` 得到的是值而不是标记。",
      "默认命名空间是 XPath 的常见坑：XML 有 `xmlns=...` 时，`//item` 可能匹配不到；本 op 的无前缀宽松匹配可缓解，但复杂文档仍要写前缀。",
      "查询为空会报 Invalid XPath，而不是返回空串（与 CSS 选择器不同）。",
      "只做提取，不执行 XSLT、不修改文档。",
      "要按属性筛选可用 `//item[@id='1']`，要取文本可用 `//item/text()`。"
    ],
    "aka": [
      "XPath expression",
      "XPath 表达式",
      "XPath 查询",
      "XPath",
      "XML 路径查询",
      "XML 节点提取",
      "XPath selector",
      "XPath 选择器",
      "XML XPath",
      "XPath query",
      "XML 查询",
      "路径表达式"
    ],
    "examples": [
      {
        "in": "<root><item id=\"1\">A</item><item id=\"2\">B</item></root>",
        "param": "query=//item, delimiter=\\n",
        "out": "<item id=\"1\">A</item>\n<item id=\"2\">B</item>",
        "desc": "提取两个 item 元素，按换行连接"
      }
    ]
  },
  "jqQuery": {
    "what": "用 jq 表达式查询 JSON。jq 是命令行里常用的 JSON 处理器：`.` 表示当前值，`.foo` 取字段，`.[]` 遍历数组/对象，`|` 把多个过滤器串起来。",
    "principle": "op 先 `JSON.parse` 输入文本，再把对象交给 jq-web 执行表达式。jq 的结果若是字符串且 `raw=true`，直接原样输出；否则用 `JSON.stringify` 输出 JSON。\n\njq 引擎是 asm.js 打包的完整 jq，首次使用才加载（约 1.75 MB），不联网。",
    "usage": "两个参数：`query`（jq 表达式，默认空）和 `raw`（布尔，默认关）。输入必须是单个合法 JSON；解析失败报 `输入不是合法 JSON：...`，表达式错误报 `jq 表达式错误：...`。",
    "tips": [
      "空查询在 jq 里等价于 `.`，原样输出输入对象。",
      "表达式产生多个结果时，jq-web 通常返回数组；用 `.[]` 展开后注意输出形态。",
      "`raw` 只对字符串结果生效；对象/数组仍输出 JSON。",
      "输入必须是单个合法 JSON；NDJSON 多行需要先拆行。",
      "`.foo // \"default\"` 可给缺失字段设默认值，`map(.name)` 可批量取字段。"
    ],
    "aka": [
      "Jq",
      "jq",
      "jq JSON 查询",
      "jq 查询",
      "JSON 查询",
      "JSON 处理器",
      "jq expression",
      "jq 表达式",
      "jq.json",
      "jq-web",
      "JSON processor",
      "命令行 JSON 处理器"
    ],
    "examples": [
      {
        "in": "{\"name\":\"flag\"}",
        "param": "query=.name, raw=true",
        "out": "flag",
        "desc": "Raw 开启时字符串结果不带引号"
      }
    ]
  },
  "yaraScan": {
    "what": "用 YARA 规则扫描字节，判断输入是否命中恶意样本/特征规则。规则里可以写文本、十六进制和正则模式，再用布尔条件组合。",
    "principle": "YARA 规则由 `rule 名称 { strings: ... condition: ... }` 组成：strings 定义文本/十六进制/正则模式，condition 用布尔表达式组合匹配。libyara 编译规则后扫描输入字节，返回命中的规则、匹配位置、长度、标识符和 meta。\n\nop 复用 libyara-wasm，wasm 以 base64 内嵌，首次使用才加载。规则编译错误会按行号报告；警告是否显示由开关控制。",
    "usage": "七个参数：`rules`（规则文本）、`showStrings`、`showLengths`、`showMeta`、`showCounts`、`showRuleWarns`、`showConsole`。输入走字节视图/`rawBytes`；没有真字节时按 UTF-8 文本编码。命中报告形如 `Input matches rule \"demo\"  (1 time).`——`demo` 与 `(1 time)` 之间有两个空格，末尾带换行。",
    "tips": [
      "规则写错会报 `YARA 规则错误（第 N 行）：...`；只是警告时可通过 Show rule warnings 控制显示。",
      "文本模式默认区分大小写；需要忽略大小写加 `nocase`，宽字符加 `wide`。",
      "十六进制模式用 `{ 4D 5A ?? 00 }`，`??` 是通配字节。",
      "零命中时输出空字符串，不是报错。",
      "输入是字节：文本按 UTF-8 编码，二进制请用字节视图。",
      "`console.log()` 的消息会混在报告前，调试规则时可用 Show console module messages 开关控制。"
    ],
    "aka": [
      "YARA Rules",
      "YARA",
      "YARA 规则",
      "YARA 规则扫描",
      "YARA 扫描",
      "YARA 匹配",
      "YARA rule matching",
      "libyara",
      "libyara-wasm",
      "恶意软件规则匹配",
      "恶意样本识别",
      "YARA rule scan"
    ],
    "examples": [
      {
        "in": "xxflagxx",
        "param": "rules=rule demo { strings: $a = \"flag\" condition: $a }；其余开关默认",
        "out": "Input matches rule \"demo\"  (1 time).\n",
        "desc": "命中 1 次；注意 demo 与 (1 time) 之间有两个空格，末尾有换行"
      }
    ]
  },
  "disasmArm": {
    "what": "把 ARM / Thumb / ARM64 机器码反汇编成汇编指令。输入是十六进制或 Base64 字节，输出每条指令的地址、机器码字节和汇编文本。",
    "principle": "反汇编是机器码 → 汇编文本的翻译：按架构/模式把字节流逐条解码，查指令表得到助记符和操作数，并按起始地址累加指令长度。op 复用仓库已有的 Capstone wasm（`public/wasm/vendor/disasm/`），支持 ARM、Thumb、ARM64（AArch64）三种模式；不复制引擎、不联网。\n\n它不做反编译，不恢复变量名/函数名/控制流；分支目标只按地址数值显示。",
    "usage": "三个参数：`arch`（arm / arm-thumb / arm64）、`enc`（hex / base64）、`base`（起始地址，默认 0）。hex 输入容忍空格、`0x` 前缀和冒号；base64 会去掉空白。空输入报 `输入为空`；非法 hex、奇数长度、未知架构都会明确报错。输出每行格式为「地址（补到 10 列） 指令字节（补到 20 列） 助记符 操作数」。",
    "tips": [
      "Thumb 指令是 2/4 字节混合，必须选 `arm-thumb`；用 ARM 模式解 Thumb 字节会得到错误指令。",
      "ARM64 与 ARM32 是不同架构，不能混用。",
      "hex 输入可以带空格/冒号/`0x`；base64 会忽略空白。",
      "起始地址只影响显示的地址和 PC 相对目标，不改变解码。",
      "没有有效指令时输出 `(无有效指令；请检查输入字节与架构是否匹配)`，不是空串。",
      "鸿蒙原生版不支持 WebAssembly，此 op 在该环境不可用（项目能力矩阵已登记）。"
    ],
    "aka": [
      "Disassemble ARM",
      "ARM 反汇编",
      "ARM disassembly",
      "反汇编 ARM",
      "ARM32 反汇编",
      "Thumb 反汇编",
      "ARM64 反汇编",
      "AArch64 反汇编",
      "Capstone ARM",
      "ARM 指令解码",
      "ARM 机器码转汇编",
      "ARM assembly"
    ],
    "examples": [
      {
        "in": "00 00 a0 e3",
        "param": "arch=arm, enc=hex, base=0",
        "out": "0x0        00 00 a0 e3          mov r0, #0",
        "desc": "ARM 小端：e3 a0 00 00 的字节序写成 00 00 a0 e3，解码为 mov r0, #0"
      }
    ]
  },
  "disasmX86": {
    "what": "把 x86 / x86-64 机器码反汇编成汇编指令。输入是十六进制或 Base64 字节，输出每条指令的地址、机器码字节和汇编文本，可选 Intel 或 AT&T 语法。",
    "principle": "与反汇编 ARM 共用同一套 Capstone wasm 引擎：按架构/位数解码字节流，查指令表得到助记符和操作数，并按起始地址累加指令长度。`syntax` 通过 Capstone 的语法选项切换 Intel 与 AT&T 输出。\n\n它不做反编译，不恢复符号、变量名或控制流；只支持 x86 32 位和 x86-64，不支持 16 位实模式。",
    "usage": "四个参数：`arch`（x86 / x86-64）、`syntax`（intel / att）、`enc`（hex / base64）、`base`（起始地址，默认 0）。hex 输入容忍空格、`0x` 前缀和冒号；base64 会去掉空白。空输入、非法 hex、奇数长度、未知架构都会明确报错。输出格式与反汇编 ARM 相同：地址、指令字节、助记符和操作数。",
    "tips": [
      "32 位和 64 位模式解码结果不同；shellcode 常需按实际加载位数选 `arch`。",
      "AT&T 语法操作数顺序是「源, 目的」，寄存器带 `%`、立即数带 `$`；Intel 语法顺序相反。",
      "起始地址只影响显示的地址和相对跳转目标，不改变解码。",
      "没有有效指令时输出 `(无有效指令；请检查输入字节与架构是否匹配)`。",
      "x86 指令长度可变，某条字节解错会导致后续指令错位；可从已知入口地址开始。",
      "鸿蒙原生版不支持 WebAssembly，此 op 在该环境不可用（项目能力矩阵已登记）。"
    ],
    "aka": [
      "Disassemble x86",
      "x86 反汇编",
      "x86 disassembly",
      "反汇编 x86",
      "x86-64 反汇编",
      "x64 反汇编",
      "Intel 语法反汇编",
      "AT&T 语法反汇编",
      "Capstone x86",
      "x86 指令解码",
      "x86 机器码转汇编",
      "x86 assembly"
    ],
    "examples": [
      {
        "in": "90",
        "param": "arch=x86, syntax=intel, enc=hex, base=0",
        "out": "0x0        90                   nop",
        "desc": "单字节 0x90 是 nop"
      }
    ]
  }
};
