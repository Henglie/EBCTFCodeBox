// 科普内容分片：fancy 8（albam/blub/cow/carbonaro/emojiAes/pietExec/spoon/wabun）
// + modern 8（rc2/dlp/elgamal/knapsack/trivium/grainV1/grain128aead/simonSpeck）。
// 纯数据，无 import 无副作用。
export default {
 // ============ fancy ============
  albam: {
    what: "希伯来传统置换密码 Albam 的拉丁字母版：把 26 个字母平分两半，上下对位互换。",
    principle:
      "26 字母切成两半 `ABCDEFGHIJKLM` 和 `NOPQRSTUVWXYZ`，同位互换：A↔N、B↔O、……、M↔Z。\n\n" +
      "半长正好是 13，所以「移半个字母表」在数值上等价于偏移 13，也就是 $c \\equiv (c+13) \\bmod 26$ —— 结果和 ROT13 完全一样。它是对合（involution）：同一张表既能加密也能解密，做两遍回到原文。",
    usage: "encode 和 decode 用同一张表（对合），非字母原样透传，大小写各自保留。",
    examples: [
      { in: "HELLO", out: "URYYB", desc: "A↔N…M↔Z，等价 ROT13" },
      { in: "URYYB", out: "HELLO", desc: "再跑一遍即还原" },
    ],
    tips: [
      "拉丁版 Albam 的输出和 ROT13 逐字节相同，认出其一即认出另一。",
      "希伯来传统三式 Atbash / Albam / Atbah，Albam 是「半移位互换」那一式。",
    ],
    aka: ["albam", "albam cipher", "albam码", "希伯来albam", "אלב״ם", "半移位互换", "字母对半互换",
          "希伯来置换密码", "atbash albam atbah", "albam置换", "拉丁albam", "rot13等价"],
  },

  blub: {
    what: "Brainfuck 的 Ook 同族方言：把 BF 的 8 条指令换成 `Blub. Blub? Blub!` 三个 token 两两组合。",
    principle:
      "和 Ook! 一样，用三种记号（`Blub.`、`Blub?`、`Blub!`）两两配对，共 8 种组合，一一映射到 Brainfuck 的 8 条指令：\n\n" +
      "`Blub. Blub?`→`>`、`Blub? Blub.`→`<`、`Blub. Blub.`→`+`、`Blub! Blub!`→`-`、`Blub! Blub.`→`.`、`Blub. Blub!`→`,`、`Blub! Blub?`→`[`、`Blub? Blub!`→`]`。\n\n" +
      "本工具 encode 把文本编成 Blub 源码，decode 直接跑一个内置 BF 解释器（30000 字节纸带、8 位回绕、500 万步上限防死循环）执行并输出结果。",
    usage: "encode：文本→Blub 源码；decode：把 Blub 源码当程序执行，输出运行结果。token 数必须为偶数。",
    examples: [
      { in: "Hi", out: "Blub. Blub. …（一串成对 token）", desc: "encode 逐字节增减 + 输出" },
    ],
    tips: [
      "满屏 `Blub.` `Blub?` `Blub!` 就是它，Ook! 家族方言，只是把 Ook 换成 Blub。",
      "token 总数一定是偶数，两个一组解析。",
    ],
    aka: ["blub", "blub!", "blub语言", "blub方言", "ook同族", "ook家族", "brainfuck方言", "bf方言",
          "blub esolang", "深奥语言blub", "blub. blub? blub!", "brainfuck变体", "bf衍生"],
  },

  cow: {
    what: "COW（MOO）深奥语言，Sean Heber 2003 年设计，12 条指令全是 `moo` 的大小写变体，玩梗奶牛叫声。",
    principle:
      "12 条指令都由 m/o/O 的大小写拼成：`moo`（循环尾）、`mOo`（指针左移）、`moO`（指针右移）、`mOO`（把当前格值当指令码执行）、`Moo`（当前格为 0 读输入，否则按 ASCII 输出）、`MOo`（当前格减一）、`MoO`（当前格加一）、`MOO`（循环头，格为 0 则跳到配对 moo 之后）、`OOO`（清零）、`MMM`（寄存器存/取）、`oom`（读整数）、`OOM`（输出整数）。\n\n" +
      "大小写敏感。`MOO … moo` 构成 while 循环，`mOO` 让它有「自解释」能力。本工具 encode 用线性方式（调值到目标后 `Moo` 输出，不用循环）生成源码，decode 跑内置解释器执行（500 万步上限）。",
    usage: "encode：文本→COW 源码（线性版，无法编码 NUL 字节）；decode：执行 COW 程序输出结果。",
    examples: [
      { in: "Hi", out: "MoO MoO … Moo …", desc: "MoO 累加到目标 ASCII 再 Moo 输出" },
    ],
    tips: [
      "满屏 moo/mOo/moO/MOO 大小写混排就是 COW，别和普通 Brainfuck 混。",
      "本工具的线性 encode 遇 NUL 字节报错（Moo 见 0 会去读输入而非输出）。",
    ],
    aka: ["cow", "moo", "cow语言", "moo语言", "cow esolang", "奶牛语言", "sean heber", "cow深奥语言",
          "brainfuck衍生", "12指令", "moo指令集", "cowlang", "牛语言"],
  },

  carbonaro: {
    what: "19 世纪初那不勒斯烧炭党（Carboneria）秘密社团用的单表替换密码，基于意大利语 21 字母表。",
    principle:
      "意大利语字母表只有 21 个字母（无 J K W X Y）。明文表 `ABCDEFGHILMNOPQRSTUVZ` 与密文表 `OPGTIVCHERNMABQLZDUFS` 同位对应：A→O、B→P、C→G……\n\n" +
      "这张表恰好是对合的：A↔O、B↔P、C↔G、D↔T、E↔I、F↔V、L↔R、M↔N、S↔Z 成对互换，H/Q/U 是不动点。所以加密解密共用同一张表。表外字符（含 J K W X Y、数字、符号）原样透传。",
    usage: "encode 和 decode 用同一张对合表，大小写各自保留，21 字母外的字符不变。",
    examples: [
      { in: "CIAO", out: "GEOA", desc: "C→G I→E A→O O→A" },
      { in: "GEOA", out: "CIAO", desc: "同表还原" },
    ],
    tips: [
      "意大利语背景 + 21 字母（缺 J K W X Y）是它的招牌。",
      "本实现用公开权威历史表（thecipher 站 Carbonaro alphabet），非某工具内部表。",
    ],
    aka: ["carbonaro", "carbonaro cipher", "carbonaro码", "烧炭党密码", "carboneria", "烧炭党",
          "那不勒斯密码", "意大利单表替换", "carbonari cipher", "carbonaro alphabet", "共济会式社团密码", "意大利21字母"],
  },

  emojiAes: {
    what: "emoji-aes 完整版（对标 GitHub aaronhorler/emoji-aes）：先 AES 加密，再把 base64 密文逐字符换成 emoji。",
    principle:
      "两层：① 用 CryptoJS 的 OpenSSL `Salted__` 格式做 AES-256-CBC 加密 —— 随机 8 字节盐经 EVP_BytesToKey(MD5) 派生出 32 字节 key + 16 字节 IV，输出 `base64(\"Salted__\" + salt + 密文)`（带 `U2FsdGVk` 前缀）。② 把这段 base64 的 65 个可能字符（a-z A-Z 0-9 + / =）按固定 emoji 表逐一替换成 emoji。\n\n" +
      "还有一个 rotation 参数：把 65 个 emoji 的表整体旋转若干位，相当于给替换层再叠一层偏移。",
    usage: "填 password（AES 口令）和 rotation（0-64，emoji 表旋转，默认 0）。encode：明文→emoji 串；decode：emoji 串→明文。",
    examples: [
      { in: "flag{demo}", param: "password=key, rotation=0", out: "🍎🍏…（emoji 串）", desc: "AES 加密后转 emoji" },
    ],
    tips: [
      "反查 emoji 得到的 base64 若以 `U2FsdGVk`（即 Salted__）开头，几乎肯定是 emoji-aes。",
      "解不出先查密码，再查 rotation 是否对得上 —— 两个都要吻合。",
    ],
    aka: ["emoji-aes", "emojiaes", "emoji aes", "emoji加密", "表情加密", "aaron horler", "emoji-aes加密",
          "aes emoji", "表情符号加密", "salted emoji", "u2fsdgvk emoji", "cryptojs emoji", "emoji密文"],
  },

  pietExec: {
    what: "Piet 图形语言解释器：Piet 程序是一张彩色抽象画，本工具把色块网格当程序执行并输出结果（对标 npiet）。",
    principle:
      "Piet 用 18 种颜色（6 色相 × 3 明度）加黑、白共 20 种「codel」。程序从左上角出发，一个方向指针 DP（右/下/左/上）和一个 codel 选择器 CC（左/右）控制走位。每次从当前同色块走到下一块，指令由「色相变化步数(0-5) × 明度变化步数(0-2)」查表决定（push/pop/add/sub/…/outnum/outchar 等），push 压入的值是刚离开那个色块的大小。黑块阻挡、白块自由滑行不执行指令。\n\n" +
      "本工具输入是纯文本网格（避免依赖图像解码）：每个色块写色码 token，色相首字母 R/Y/G/C/B/M + 明度后缀 l(亮)/空(正常)/d(暗)，黑 K、白 W；也接受 6 位 hex 自动量化到最近的 Piet 色。图灵完备语言无逆运算，只执行（单向 run），带步数（100 万）+ 输出上限防死循环。",
    usage: "输入色块网格文本（每行 token 空格分隔，须矩形）。运行输出程序结果 + 执行摘要（步数、终栈）。仅执行，无逆向。",
    examples: [
      { in: "Rl R Rd\nR  W  R", out: "(程序输出) + 执行摘要", desc: "token: Rl=亮红 R=红 Rd=暗红 K=黑 W=白" },
    ],
    tips: [
      "记住指令由「相邻色块的色相差 × 明度差」决定，不是颜色本身。",
      "无 stdin，innum/inchar 读空；靠 (cx,cy,dp,cc) 状态重复来判停机。",
    ],
    aka: ["piet", "pietexec", "piet执行", "piet解释器", "piet语言", "npiet", "彩色深奥语言", "图形编程语言",
          "codel", "david morgan-mar", "piet interpreter", "色块语言", "抽象画程序"],
  },

  spoon: {
    what: "Spoon 深奥语言（Steven Goodwin 设计）：把 Brainfuck 的 8 条指令换成一套霍夫曼式前缀码，整段程序变成一串 0/1。",
    principle:
      "8 条 BF 指令各对应一个变长前缀码：`+`=`1`、`-`=`000`、`>`=`010`、`<`=`011`、`[`=`00100`、`]`=`0011`、`.`=`001010`、`,`=`0010110`，另有 Debug=`00101110`（BF 无对应，解码时消费但不产字符）。\n\n" +
      "这是前缀码（任一码都不是另一码的前缀），所以能逐位贪婪解析、无歧义。本工具 encode 把 BF 源码转成 0/1 串（非指令字符忽略），decode 把 0/1 串还原成 BF 源码（严格往返，遇非法比特或末尾残余报错）。注意：它做的是 BF↔Spoon 码转换，不执行程序。",
    usage: "encode：Brainfuck 源码→Spoon 二进制串；decode：Spoon 0/1 串→Brainfuck 源码。decode 会先剔除非 0/1 字符。",
    examples: [
      { in: "+-", out: "1000", desc: "+ → 1，- → 000" },
      { in: "1000", out: "+-", desc: "前缀码贪婪还原" },
    ],
    tips: [
      "一串纯 0/1 而不像 base 编码，试试 Spoon 前缀码解成 Brainfuck。",
      "Spoon 是 BF↔二进制的转换器，解出来的是 BF 源码，还要再跑 BF 才有明文。",
    ],
    aka: ["spoon", "spoon语言", "spoon esolang", "steven goodwin", "brainfuck前缀码", "bf二进制", "霍夫曼式前缀码",
          "spoon深奥语言", "brainfuck变体", "bf方言", "prefix code brainfuck", "01串brainfuck", "spoon码"],
  },

  wabun: {
    what: "和文摩尔斯（和文モールス符号 / Wabun code）：日语假名与摩尔斯电码的对应表。",
    principle:
      "和拉丁摩尔斯不同，Wabun 给每个假名一套点划码，例如 `イ`=`.-`、`ロ`=`.-.-`、`ハ`=`-...`。浊音/半浊音不单独编码，而是清音后跟一个独立记号：浊点 `゛`=`..`、半浊点 `゜`=`..--.`，另有长音 `ー`=`.--.-`、読点 `、` 等。\n\n" +
      "本工具 encode 先把输入 NFD 分解（ガ → カ + 组合浊点），平假名归一到片假名、小假名归一到大假名后逐个查表；decode 遇浊/半浊记号时补回组合记号再 NFC 合成回浊音。记号约定：假名的点划间用空格，词间用 ` / ` 分隔。",
    usage: "encode：假名→摩尔斯（点划空格分隔、词间 /）；decode：摩尔斯→假名。平/片假名皆可输入，内部统一处理。",
    examples: [
      { in: "イロハ", out: ".- .-.- -...", desc: "逐假名查 Wabun 表" },
      { in: "-... ..", out: "バ", desc: "ハ + 浊点 → バ（NFC 合成）" },
    ],
    tips: [
      "点划码但解成拉丁字母不通顺时，试和文摩尔斯（按假名解）。",
      "浊音靠「清音 + 浊点 `..`」两段表示，别当成一个整码。",
    ],
    aka: ["wabun", "wabun code", "和文摩尔斯", "和文モールス", "和文モールス符号", "日文摩尔斯", "假名摩尔斯",
          "日语摩尔斯电码", "kana morse", "japanese morse", "wabun摩尔斯", "片假名摩尔斯", "和文电码"],
  },

 // ============ modern ============
  rc2: {
    what: "RC2 对称分组密码（Rivest 1987，RFC 2268 公开），64 位块、可变长密钥，早年出口级加密常用。",
    principle:
      "块长 64 位（4 个 16 位字，小端），密钥 1..128 字节，还有一个「有效密钥位数」参数 T1 控制密钥真实强度（出口管制遗产，本工具默认 = 密钥字节数×8）。密钥先经一张官方 256 字节置换表 `PITABLE` 扩展成 64 个 16 位轮密钥字。\n\n" +
      "加密由两种轮交替：MIXING（混合，含加法、位与/与非组合、按 1/2/3/5 位循环左移）和 MASHING（用当前字低 6 位去索引轮密钥）。顺序是 5 轮 mix → mash → 6 轮 mix → mash → 5 轮 mix。本工具支持 ECB/CBC + PKCS#7 填充。",
    usage: "填密钥（可选编码 utf8/hex/base64/latin1）、有效密钥位数（0=自动）、模式（ECB/CBC，CBC 需 8 字节 IV）、密文编码。encode 加密 / decode 解密。",
    examples: [
      { in: "hello", param: "key=secret, mode=CBC, iv=0000000000000000", out: "base64 密文", desc: "RFC 2268 内核" },
    ],
    tips: [
      "块 64 位 → 密文长度是 8 字节的倍数。",
      "解不出先核对「有效密钥位数」—— RC2 的密文和这个参数绑定，不只是密钥本身。",
    ],
    aka: ["rc2", "rc2密码", "rivest cipher 2", "rfc 2268", "rfc2268", "arc2", "ron rivest rc2",
          "rc2分组密码", "rc2 cipher", "pitable", "可变密钥分组密码", "rc2算法"],
  },

  dlp: {
    what: "离散对数求解器：给定 g、h、p，求指数 x 使 $g^x \\equiv h \\pmod p$。离散对数是 DH / ElGamal / DSA 的安全基石。",
    principle:
      "提供两种算法（都是 $O(\\sqrt n)$ 时间，n 为子群阶，默认 p-1）：\n\n" +
      "① BSGS（Baby-step Giant-step，大步小步）：令 $m=\\lceil\\sqrt n\\rceil$，先把 $g^j\\,(j=0..m-1)$ 存进哈希表（baby step），再算 $h\\cdot(g^{-m})^i$ 查表（giant step），命中即 $x=i\\cdot m+j$。确定性，返回最小非负 x，但要 $O(\\sqrt n)$ 内存。\n\n" +
      "② Pollard's rho for logarithms：三分区可加游走 + Floyd 环检测找碰撞解出 x，$O(1)$ 空间，阶巨大时省内存。子群阶为素数时效果最佳。",
    usage: "params 填 g、h（留空则取输入框）、p、可选 order（子群阶，默认 p-1）、method（bsgs/rho）、步数上限。输出 x 及校验。",
    examples: [
      { in: "", param: "g=2, h=22, p=29", out: "x = ...（使 2^x ≡ 22 mod 29）", desc: "BSGS 小阶直接算" },
    ],
    tips: [
      "阶小或能分解成小素数幂时 DLP 好解；order 填对了能大幅缩小搜索。",
      "BSGS 吃内存、rho 省内存，都是 $O(\\sqrt n)$，别指望它破真实 2048 位 DH。",
    ],
    aka: ["dlp", "离散对数", "discrete logarithm", "discrete log", "离散对数问题", "bsgs", "baby step giant step",
          "大步小步", "pollard rho", "求离散对数", "discrete logarithm problem", "dlog", "离散对数求解"],
  },

  elgamal: {
    what: "ElGamal 公钥加密（1985）：基于离散对数难题的非对称加密，密文是一对数 (c1, c2)。",
    principle:
      "公开参数：大素数 p、原根 g。私钥 x，公钥 $y=g^x \\bmod p$。\n\n" +
      "加密（明文 $m<p$）：随机选 $k\\in[1,p-2]$，算 $c_1=g^k \\bmod p$、$c_2=m\\cdot y^k \\bmod p$，密文 = $(c_1,c_2)$。\n\n" +
      "解密：共享密钥 $s=c_1^x \\bmod p$，用 Fermat 小定理求逆 $s^{-1}=s^{p-2}\\bmod p$，明文 $m=c_2\\cdot s^{-1}\\bmod p$。本工具随机 k 用 crypto.getRandomValues，明文须 < p。",
    usage: "加密填 p、g、y（密文格式 `c1,c2` 逗号分隔）；解密填 p、x。明文/输出编码可选 dec/hex/base64/utf8。",
    examples: [
      { in: "5", param: "p=2357, g=2, y=1185", out: "c1,c2（如 1490,2042）", desc: "同一明文每次 c1/c2 都不同（随机 k）" },
    ],
    tips: [
      "同一明文加密多次密文不同（概率加密），因为每次随机 k。",
      "两条消息复用同一个 k 会泄露信息 —— 经典 ElGamal 攻击点。",
    ],
    aka: ["elgamal", "elgamal加密", "elgamal cipher", "elgamal encryption", "埃尔加莫尔", "taher elgamal",
          "公钥加密", "非对称加密", "离散对数加密", "elgamal公钥", "c1 c2密文", "elgamal算法"],
  },

  knapsack: {
    what: "Merkle-Hellman 背包公钥加密（1978）：最早的公钥方案之一，靠超递增序列的「陷门」，后被 Shamir 攻破。",
    principle:
      "私钥：超递增序列 $w=(w_1..w_n)$（每项大于前面所有项之和）、模数 $q>\\sum w_i$、乘数 r（gcd(r,q)=1）。公钥：$\\beta_i=(w_i\\cdot r)\\bmod q$，是个看似普通的背包。\n\n" +
      "加密：明文按 bit 取，每 n bit 一块，密文 $c=\\sum m_i\\beta_i$。解密：算 $c'=(c\\cdot r^{-1})\\bmod q$，因为 $c'\\equiv\\sum m_i w_i$ 且这个和 < q 不截断，对超递增序列贪心（从大到小）就能唯一还原每个 bit。\n\n" +
      "安全：密度 $d=n/\\log_2(\\max\\beta_i)$，$d<0.9408$ 时 LLL 格归约几乎必然破解。原始方案已被 Shamir(1984) 攻破，仅教学/CTF 用。",
    usage: "密钥来源选 demo（内置 n=8）/ gen（填项数 n 现场生成）/ manual（手填 w,q,r 或公钥 β）。encode 输出密文块+密钥报告，decode 需回填 w/q/r。密文=逗号分隔十进制块。",
    examples: [
      { in: "A", param: "keyMode=demo", out: "=== 加密报告 …CT: 逗号分隔块", desc: "内置 demo w=[2,3,6,13,27,52,105,210]" },
    ],
    tips: [
      "低密度背包（d<0.9408）用 LLL 格归约几乎秒解，CTF 常考这个点。",
      "解密贪心从大到小减，减完余量非零说明密钥/密文对不上。",
    ],
    aka: ["knapsack", "背包加密", "merkle hellman", "merkle-hellman", "背包密码", "背包公钥", "超递增背包",
          "knapsack cipher", "subset sum", "子集和加密", "背包公钥密码", "trapdoor knapsack", "mh背包"],
  },

  trivium: {
    what: "Trivium 流密码（eSTREAM 硬件组入选算法）：80 位密钥 + 80 位 IV，288 位内部状态，结构极简。",
    principle:
      "内部是 288 位状态，由三个非线性反馈移位寄存器串成环。初始化把 80 位 key 装入前段、80 位 IV 装入中段、末尾三位置 1，然后空跑 1152 轮（4×288）预热；之后每轮输出 1 个密钥流比特，与明文异或。流密码自反：同 key+IV 再跑一遍密文即得明文。\n\n" +
      "⚠ 本工具兼容目标是「风之暇想 fzxx/Trivium-Grain 在线站」（trivium-grain.js.org），位序约定（key/IV 不倒序、keystream MSB-first）与 eSTREAM 官方标准测试向量不一致 —— 即本箱产出与官方 KAT 不同，但与该作者库逐字节相同。",
    usage: "填 key（20 位 hex = 80 bit）、IV（20 位 hex = 80 bit）、明文侧编码。encode：明文→hex 密文；decode：hex→明文。对称可逆。",
    examples: [
      { in: "hello", param: "key=80000…(20hex), iv=00000…(20hex)", out: "hex 密文", desc: "异或密钥流，自反" },
    ],
    tips: [
      "认特征：80 位 key + 80 位 IV + 288 位状态 + 1152 轮预热。",
      "本箱按作者库位序，跟 eSTREAM 官方向量对不上是正常的（兼容在线站而非 KAT）。",
    ],
    aka: ["trivium", "trivium流密码", "trivium cipher", "estream", "estream trivium", "特里维姆", "轻量流密码",
          "288位流密码", "trivium stream cipher", "de canniere preneel", "硬件流密码", "trivium算法"],
  },

  grainV1: {
    what: "Grain v1 流密码（eSTREAM 硬件组入选）：80 位密钥 + 64 位 IV，一个 80 位 LFSR + 一个 80 位 NFSR + 滤波函数 h。",
    principle:
      "由 80 位线性反馈移位寄存器（LFSR）和 80 位非线性反馈移位寄存器（NFSR）加一个非线性滤波/输出函数 h 组成，硬件面积极小。初始化装入 key/IV 后空跑 160 拍（输出反馈回两个寄存器）预热，之后每拍出 1 比特密钥流与明文异或。对称可逆。\n\n" +
      "⚠ 与 Trivium 同库同注意事项：兼容「风之暇想 fzxx/Trivium-Grain 在线站」，位序约定（位数组→字节 LSB-first）与官方标准测试向量不同，但与该作者库字节互通。",
    usage: "填 key（20 位 hex = 80 bit）、IV（16 位 hex = 64 bit）、明文侧编码。encode：明文→hex 密文；decode：hex→明文。对称可逆。",
    examples: [
      { in: "hello", param: "key=80000…(20hex), iv=0000…(16hex)", out: "hex 密文", desc: "LFSR80+NFSR80+h，160 拍预热" },
    ],
    tips: [
      "认特征：80 位 key + 64 位 IV（比 Trivium 的 IV 短），LFSR+NFSR 双寄存器。",
      "同 Trivium：本箱位序对齐在线站，非 eSTREAM 官方 KAT。",
    ],
    aka: ["grain", "grain v1", "grainv1", "grain流密码", "grain cipher", "grain v1流密码", "estream grain",
          "轻量流密码", "lfsr nfsr", "hell johansson maximov", "grain stream cipher", "grain算法"],
  },

  grain128aead: {
    what: "Grain-128AEAD 认证加密（NIST 轻量密码标准化候选）：128 位密钥 + 96 位 nonce，加密同时产生 64 位认证 tag。",
    principle:
      "在 Grain-128 流密码骨架（128 位 LFSR + 128 位 NFSR）上加一个 64 位认证模块。既加密又认证（AEAD）：encode 输出 = 密文 + 尾部 8 字节（64 位）tag；decode 先解密再重算 tag 比对，tag 不匹配就报「认证失败」，拒绝输出。支持附加数据 AD（一起参与认证、不加密）。\n\n" +
      "⚠ 同库注意：兼容「风之暇想 fzxx/Trivium-Grain 在线站」，实现里全程 `swapBitsInByte` 逐字节位翻转，与 NIST 官方标准测试向量不一致，但与该作者库字节互通。",
    usage: "填 key（32 位 hex = 16 字节）、nonce（24 位 hex = 12 字节）、可选 AD（hex）、明文侧编码。encode：明文+AD→hex 密文(含尾 8 字节 tag)；decode：验 tag 后出明文，失败报错。非自反。",
    examples: [
      { in: "hello", param: "key=000102…0F(32hex), nonce=…(24hex)", out: "hex 密文 + 8 字节 tag", desc: "改一字节 tag 就对不上" },
    ],
    tips: [
      "AEAD 非自反：密文尾 8 字节是 tag，被篡改会认证失败拒绝解密。",
      "key/nonce/AD 任一不一致都会 tag 不匹配 —— 排错先逐个核对。",
    ],
    aka: ["grain128aead", "grain-128aead", "grain 128 aead", "grain128 aead", "认证加密", "aead", "nist轻量密码",
          "轻量级aead", "grain128", "认证加密流密码", "grain-128 aead", "lightweight aead", "grain aead"],
  },

  simonSpeck: {
    what: "NSA 的 Simon 与 Speck 两族轻量级分组密码（2013）：Simon 硬件友好、Speck 软件友好，一个 op 用参数切换。",
    principle:
      "两族共享同一组尺寸（分组 32/48/64/96/128 位 × 多种密钥长），命名 `分组位/密钥位`，如 Speck64/128。块由两个 n 位字 (x,y) 组成，走 Feistel 式结构：\n\n" +
      "Speck 是 ARX（加法-旋转-异或）：$x=(\\mathrm{ROR}(x,\\alpha)+y)\\oplus k,\\ y=\\mathrm{ROL}(y,\\beta)\\oplus x$，旋转常数 n=16 时 α=7,β=2 否则 α=8,β=3。\n\n" +
      "Simon 是 AND-rotate：$f(x)=(\\mathrm{ROL}(x,1)\\ \\&\\ \\mathrm{ROL}(x,8))\\oplus\\mathrm{ROL}(x,2)$，轮变换 $x'=y\\oplus f(x)\\oplus k$。密钥调度含 5 条 62 位常数序列 z。轮数随变体不同。本工具全程 BigInt（>32 位字避免溢出），ECB 单/多块，已过论文附录 C 官方测试向量。",
    usage: "选 algo（speck/simon）、variant（分组/密钥位如 64/128）、填 key（hex，高位字在前）。明文/密文均 hex。encode 加密 / decode 解密。数据须为块大小整数倍。",
    examples: [
      { in: "6574694c", param: "algo=speck, variant=32/64, key=1918111009080100", out: "a86842f2（论文向量）", desc: "Speck32/64 官方 KAT" },
    ],
    tips: [
      "NSA 出品，认 ARX(Speck)/AND-rotate(Simon) 结构；hex 明文块大小=分组位/8。",
      "本 op 与论文附录 C 官方测试向量对齐，可拿标准向量直接核对。",
    ],
    aka: ["simon", "speck", "simonspeck", "simon speck", "simon/speck", "nsa轻量密码", "simon cipher", "speck cipher",
          "轻量级分组密码", "arx密码", "and-rotate", "lightweight block cipher", "simon and speck", "beaulieu"],
  },
};
