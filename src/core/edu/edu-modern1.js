// 科普内容分片：modern 段前 8（fernet/tea/xtea/xxtea/sm4/salsa20/chacha20/rc5）。纯数据，无 import 无副作用。
export default {
  fernet: {
    what: "一种「开箱即用」的对称加密令牌格式，Python cryptography 库带的那套。它把加密和防篡改打包好，你只管给 key 和数据。",
    principle:
      "内部是 AES-128-CBC 负责加密 + HMAC-SHA256 负责防篡改。令牌结构固定：\n\n" +
      "`版本(0x80) ‖ 时间戳(8字节) ‖ IV(16字节) ‖ 密文 ‖ HMAC(32字节)`，整体做一次 base64url。\n\n" +
      "key 是 32 字节的 base64url 串：前 16 字节当签名密钥（HMAC 用），后 16 字节当加密密钥（AES 用）。解密时先验 HMAC，过了才解 AES。",
    usage: "填 base64url 的 32 字节 key，输入令牌解密得明文；编码方向把明文封成令牌。",
    examples: [
      { in: "gAAAAABh…（base64url 令牌）", param: "key = base64url 32 字节", out: "明文", desc: "验签通过才解密" },
    ],
    tips: [
      "令牌几乎总以 `gAAAAA` 开头 —— 那是版本字节 0x80 经 base64url 的长相，一眼认出 Fernet。",
      "key 不对或数据被改，HMAC 校验先失败，根本走不到解密。",
    ],
    aka: ["fernet token", "对称令牌", "python fernet", "fernet", "fernet加密", "对称加密令牌", "cryptography fernet", "aes-cbc hmac令牌", "gaaaaa令牌", "fernet token格式", "认证加密令牌"],
  },

  tea: {
    what: "Tiny Encryption Algorithm —— 出了名的「代码短到能背下来」的分组密码，逆向题里露脸率极高。",
    principle:
      "块长 64 位（两个 32 位字），密钥 128 位（四个 32 位字），32 轮 Feistel。每轮把两个半块互相搅拌，累加一个魔数常量 delta = `0x9E3779B9`（黄金比例 $2^{32}/\\phi$）。\n\n" +
      "结构简单也带来弱点：存在等价密钥、相关密钥问题，别用在真实安全场景。",
    usage: "填 128 位密钥（16 字节），输入密文解密；编码方向加密。",
    formulas: [
      { tex: "\\text{sum} \\mathrel{+}= \\delta,\\quad \\delta = \\mathtt{0x9E3779B9}", caption: "每轮累加的黄金比例常数" },
    ],
    tips: [
      "看到源码里出现 `0x9E3779B9` 这个魔数，八成就是 TEA / XTEA / XXTEA 家族。",
      "块 64 位 → 密文长度是 8 字节的倍数。",
    ],
    aka: ["tiny encryption algorithm", "tea密码", "wheeler needham", "tea", "微型加密算法", "tea算法", "tea cipher", "feistel分组密码", "0x9e3779b9", "tea block cipher", "小型加密算法"],
  },

  xtea: {
    what: "TEA 的补丁版（eXtended TEA），修掉了 TEA 的相关密钥缺陷，密钥调度更讲究。逆向题常和 TEA 一起考。",
    principle:
      "同样 64 位块、128 位密钥、32 轮，仍用 delta = `0x9E3779B9`。区别在每轮用 sum 的不同位去挑密钥字（`key[(sum>>11)&3]` 这类），而不是像 TEA 那样固定顺序，密钥混得更均匀。",
    usage: "填 16 字节密钥，输入密文解密；编码方向加密。",
    tips: [
      "和 TEA 长得几乎一样，区分点在密钥索引：XTEA 用 `sum` 移位算下标，TEA 直接按 0/1 取。",
      "同样认 `0x9E3779B9`。",
    ],
    aka: ["extended tea", "xtea密码", "tean", "xtea", "扩展tea", "xtea算法", "xtea cipher", "extended tiny encryption algorithm", "tea补丁版", "0x9e3779b9", "xtea分组密码"],
  },

  xxtea: {
    what: "TEA 家族的「整块一起加密」版（Corrected Block TEA）。不是一块块处理，而是把整段数据当成一个大数组统一搅拌。",
    principle:
      "数据按 32 位字排成数组（至少 2 个字，即 ≥8 字节），128 位密钥。轮数随长度变：$6 + \\lfloor 52/n \\rfloor$ 轮（n 为字数）。核心是那个 MX 混合函数，同样带 delta = `0x9E3779B9`。因为全数组耦合，改一个字会扩散影响所有字。",
    usage: "填 16 字节密钥，输入密文（≥8 字节）解密；编码方向加密。",
    formulas: [
      { tex: "\\text{rounds} = 6 + \\lfloor 52/n \\rfloor", caption: "轮数随数据字数 n 变化" },
    ],
    tips: [
      "数据不足 8 字节它不干活，太短的输入直接原样返回。",
      "同一密钥，整段密文一处出错会导致大面积解不出 —— 因为全数组耦合。",
    ],
    aka: ["corrected block tea", "xxtea密码", "block tea", "xxtea", "修正块tea", "xxtea算法", "xxtea cipher", "整块tea", "0x9e3779b9", "corrected block tiny encryption algorithm", "块tea加密"],
  },

  sm4: {
    what: "国密分组密码（GB/T 32907-2016，前身 GM/T 0002-2012），中国自研的对称加密标准。国内 CTF 和合规系统里常出现，是 AES 的国产对位物。",
    principle:
      "块长 128 位、密钥 128 位、32 轮非线性迭代。每轮做一次「S 盒非线性替换 + 线性扩散」的合成变换 T，密钥扩展也用类似结构生成 32 个轮密钥。解密复用加密流程，只是轮密钥逆序。",
    usage: "填 16 字节密钥、选工作模式（ECB/CBC 等，CBC 要 IV），输入密文解密；编码方向加密。",
    tips: [
      "块 128 位，和 AES 一样密文长度是 16 字节倍数。",
      "题面出现「国密 / 商密 / GM/T」多半就是 SM4（加密）或 SM3（哈希）。",
    ],
    aka: ["sm4", "国密sm4", "商用密码", "gm/t 0002", "sm4分组密码", "sm4算法", "sm4 cipher", "国密算法", "商密sm4", "国产分组密码", "sms4", "gb/t 32907"],
  },

  salsa20: {
    what: "Bernstein 设计的流密码，速度快、结构清爽。ChaCha20 就是它的改良兄弟。",
    principle:
      "以 key（16 或 32 字节）+ nonce（8 字节）+ 块计数器搭一个 64 字节初始状态，反复跑 20 轮 quarter-round（加法、异或、循环移位）生成密钥流，再和明文逐字节异或。流密码天然自反：同参数再跑一遍密文即得明文。",
    usage: "填 key 与 8 字节 nonce，输入密文异或还原明文（编解码同形）。",
    tips: [
      "流密码，密文和明文等长（无填充），这点和分组密码不一样。",
      "nonce 8 字节是 Salsa20 特征；若 nonce 是 12 字节那多半是 ChaCha20。",
    ],
    aka: ["salsa20", "salsa", "bernstein流密码", "salsa20流密码", "salsa cipher", "djb salsa", "salsa20算法", "daniel bernstein", "quarter round流密码", "salsa流密码", "estream salsa"],
  },

  chacha20: {
    what: "Salsa20 的升级版流密码，扩散更好、软件实现更快，TLS、WireGuard、现代协议的常客（RFC 8439）。",
    principle:
      "state 是 4×4 的 32 位字矩阵：常量 `expand 32-byte k` + key(32 字节) + 计数器 + nonce(12 字节)。跑 20 轮 quarter-round 打乱后与初始态相加，输出 64 字节密钥流块，和明文异或。同样自反。",
    usage: "填 32 字节 key 与 12 字节 nonce，输入密文异或还原明文。",
    tips: [
      "认特征：32 字节 key + 12 字节 nonce + 常量串 `expand 32-byte k`。",
      "常和 Poly1305 组成 AEAD（ChaCha20-Poly1305），那种带 16 字节认证标签。",
    ],
    aka: ["chacha20", "chacha", "rfc8439", "chacha20-poly1305", "查查20", "chacha流密码", "chacha cipher", "rfc 8439", "chacha20 poly1305", "aead流密码", "expand 32-byte k", "chacha20算法"],
  },

  rc5: {
    what: "Rivest 设计的参数化分组密码，最大看点是「数据依赖的循环移位」—— 移多少位取决于数据本身。",
    principle:
      "记法 RC5-w/r/b：字长 w、轮数 r、密钥字节 b。本工具用常见的 RC5-32/12/16（32 位字、12 轮、16 字节密钥、块 64 位）。每轮混合加法、异或和「转多少由另一半决定」的循环移位，密钥扩展同样用了黄金比例与 e 相关的两个魔数常量。",
    usage: "填密钥、选模式（CBC 要 IV），输入密文解密；编码方向加密。",
    tips: [
      "数据依赖旋转是 RC5/RC6 的招牌，逆向里看到 `ROL(a, b & 31)` 这种可疑。",
      "块 64 位 → 密文 8 字节倍数；它的继任者 RC6 块是 128 位。",
    ],
    aka: ["rc5", "rivest cipher 5", "rc5-32/12/16", "ron rivest rc5", "rc5算法", "rc5 cipher", "数据依赖旋转密码", "rc5分组密码", "rc5-w/r/b", "rivest密码5", "参数化分组密码"],
  },
};
