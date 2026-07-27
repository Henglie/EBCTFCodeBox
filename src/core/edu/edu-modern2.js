// 科普内容分片：modern 段后 8（idea/blowfish/rc6/jwt/jwtNone/jweIdentify/pasetoIdentify/b64urlJson）。纯数据，无 import 无副作用。
export default {
  idea: {
    what: "国际数据加密算法，90 年代 PGP 邮件加密的核心。特点是把三种「代数上不兼容」的运算混在一起。",
    principle:
      "块长 64 位、密钥 128 位、8.5 轮。混合三种运算求安全：模 $2^{16}+1$ 乘法、模 $2^{16}$ 加法、逐位异或。三者来自不同代数结构，谁也化简不了谁，这就是它抗分析的底气。解密用加密的乘法/加法逆元，逆序轮密钥。",
    usage: "填 16 字节密钥、选模式（CBC 要 IV），输入密文解密；编码方向加密。",
    formulas: [
      { tex: "\\text{乘法运算模 } 2^{16}+1 = 65537", caption: "IDEA 招牌的模素数乘法" },
    ],
    tips: [
      "块 64 位 → 密文 8 字节倍数。",
      "认特征：出现 mod 65537 的乘法就是 IDEA。",
    ],
    aka: ["idea", "国际数据加密算法", "pgp加密", "lai massey", "IDEA", "International Data Encryption Algorithm", "IDEA加密", "lai-massey结构", "IPES", "分组密码"],
  },

  blowfish: {
    what: "Schneier 设计的免费分组密码，密钥长度灵活（4-56 字节），bcrypt 口令哈希就脱胎于它。",
    principle:
      "块长 64 位、16 轮 Feistel。核心是一张 P-array（18 个子密钥）和四张 S 盒（各 256 项），都由密钥经过一段较费时的初始化算出来。加密就是 16 轮「F 函数 + 异或子密钥」。初始化慢正是 bcrypt 抗暴力的来源。",
    usage: "填密钥（4-56 字节任意长）、选模式（CBC 要 IV），输入密文解密；编码方向加密。",
    tips: [
      "块 64 位 → 密文 8 字节倍数。",
      "密钥可变长是它区别于定长 AES/DES 的显眼特征。",
    ],
    aka: ["blowfish", "河豚密码", "schneier", "Blowfish", "布劳菲什", "Blowfish加密", "变长密钥密码", "bcrypt基础", "Feistel分组密码", "Bruce Schneier"],
  },

  rc6: {
    what: "RC5 的继任者，曾入围 AES 最终五强。块加宽到 128 位，并行处理两路数据。",
    principle:
      "128 位块拆成四个 32 位字 A/B/C/D，20 轮。相比 RC5 多用了一个整数乘法做「白化」让扩散更快，同样保留数据依赖的循环移位。密钥可变长（默认 16 字节）。",
    usage: "填密钥（默认 16 字节）、选模式（CBC 要 IV），输入密文解密；编码方向加密。",
    tips: [
      "块 128 位（同 AES）→ 密文 16 字节倍数，这点和 RC5 的 64 位块不同。",
      "同样有数据依赖旋转，外加一个二次函数 `B*(2B+1)` 式的乘法白化，是认它的关键。",
    ],
    aka: ["rc6", "rivest cipher 6", "aes候选", "RC6", "RC6加密", "RC5继任者", "RC6分组密码", "AES候选算法", "128位块密码", "数据依赖旋转"],
  },

  jwt: {
    what: "JSON Web Token —— 网站登录后发给你的那张「通行证」。三段用点隔开，前两段是明文 JSON，第三段是签名。",
    principle:
      "结构 `header.payload.signature`，前两段各是一个 base64url 编码的 JSON，第三段是对 `header.payload` 的签名。HS256/384/512 用 HMAC（对称密钥），RS/ES 系用非对称私钥签。\n\n" +
      "关键：payload 只是 base64 编码不是加密，谁都能读！签名只保证「没被篡改」，不保证「看不见」。",
    usage: "解析方向：粘 JWT，拆出 header/payload 并可用密钥验签。签发方向：填 header/payload 和 HS 密钥，生成带签名的 token。",
    examples: [
      { in: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.xxx", out: "header={alg:HS256}, payload={user:admin}", desc: "前两段直接 base64 解就能看" },
    ],
    tips: [
      "看到 `eyJ` 开头的点分三段串就是 JWT（`eyJ` 是 `{\"` 的 base64）。",
      "弱密钥题：拿 header.payload 和签名，用 hmacKeyBrute 爆 HS256 的 key。",
      "payload 能直接读，别指望它藏东西。",
    ],
    aka: ["jwt", "json web token", "jot", "hs256", "JWT", "JSON Web Token", "RFC 7519", "json令牌", "web令牌", "token鉴权"],
  },

  jwtNone: {
    what: "JWT 最经典的漏洞玩法：把算法字段改成 `none`，声称「这张令牌不需要签名」，骗过校验不严的后端。",
    principle:
      "把 header 里的 `alg` 改成 `none`（或 `None`/`NONE` 大小写绕过），第三段签名留空。如果服务端没强校验算法，就会接受这张无签名令牌 —— 于是你能任意伪造 payload（比如把 `user` 改成 `admin`）。",
    usage: "构造方向：填你想要的 payload，工具生成 `alg:none` 的无签名 token。检测方向：粘 token，判断它是否用了 none 攻击。",
    examples: [
      { in: "{\"user\":\"admin\"}", out: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4ifQ.", desc: "注意结尾那个点后面签名为空" },
    ],
    tips: [
      "认特征：解出来 `alg` 是 `none`，且第三段签名为空。",
      "大小写变形 `nOnE` 是绕过某些黑名单的常见手法。",
    ],
    aka: ["jwt none", "alg none", "jwt空签名攻击", "none算法", "JWT None攻击", "alg:none", "jwt none漏洞", "无签名jwt", "jwt绕过", "jwt算法混淆"],
  },

  jweIdentify: {
    what: "JWE 是 JWT 的「加密版」（JSON Web Encryption）—— payload 是真加密的，不像 JWT 那样明文可读。本工具帮你把它的五段结构拆开看。",
    principle:
      "JWE 紧凑序列化是五段点分：\n\n" +
      "`受保护头 ‖ 加密的密钥 ‖ IV ‖ 密文 ‖ 认证标签`（RFC 7516）。第一段 base64url 解开是 JSON，能看到 `alg`（密钥怎么包）和 `enc`（内容怎么加密，如 A256GCM）。后四段没密钥解不出。",
    usage: "粘 JWE 令牌，工具按点拆成五段并解析第一段的头部，报告使用的算法。这是识别/结构报告，不做解密。",
    examples: [
      { in: "eyJ…(5段点分)", out: "5 段拆解 + 头部 alg/enc 信息" },
    ],
    tips: [
      "数一下点：JWT 是 3 段，JWE 是 5 段，一眼区分。",
      "JWE 的 payload 真加密，别指望像 JWT 那样直接 base64 读出来。",
    ],
    aka: ["jwe", "json web encryption", "rfc7516", "JWE", "JSON Web Encryption", "RFC 7516", "jwe识别", "加密jwt", "jwe结构解析", "五段令牌"],
  },

  pasetoIdentify: {
    what: "PASETO 是号称「比 JWT 安全」的令牌格式，砍掉了 JWT 那些危险的算法可选项。本工具识别它的版本和用途。",
    principle:
      "格式 `version.purpose.payload[.footer]`，如 `v2.local.xxxx`。version 是 v1-v4，purpose 分 `local`（对称加密）和 `public`（非对称签名）。它把算法写死在版本里，从根上堵掉了 JWT 的 `alg:none` 那类攻击。",
    usage: "粘 PASETO 令牌，工具识别版本（v1-v4）和用途（local/public）并拆解结构。识别用途，不做解密验签。",
    examples: [
      { in: "v2.local.xxxxx", out: "版本 v2 / 用途 local（对称加密）" },
      { in: "v4.public.xxxxx", out: "版本 v4 / 用途 public（签名）" },
    ],
    tips: [
      "认特征：以 `v1`~`v4` 加 `.local.` 或 `.public.` 开头。",
      "local 的 payload 是加密的，public 的是签名+明文可读。",
    ],
    aka: ["paseto", "platform agnostic security tokens", "jwt替代", "PASETO", "paseto令牌", "paseto识别", "v2.local", "v4.public", "安全令牌", "平台无关安全令牌"],
  },

  b64urlJson: {
    what: "Base64url 和 JSON 之间来回转的小工具，顺带美化。拆 JWT 那种「base64url 包着 JSON」的载荷时超顺手。",
    principle:
      "Base64url 是 base64 的 URL 安全变体：`+/` 换成 `-_`，去掉尾部 `=` 填充。这里把 base64url 解成文本、按 JSON 解析并缩进美化；反向把 JSON 压紧再 base64url 编码。",
    usage: "解码方向：粘 base64url 串，输出美化后的 JSON。编码方向：粘 JSON，输出 base64url 串。",
    examples: [
      { in: "eyJ1c2VyIjoiYWRtaW4ifQ", out: "{\n  \"user\": \"admin\"\n}", desc: "JWT payload 段就长这样" },
    ],
    tips: [
      "手拆 JWT 时，把中间那段丢进来就能读 payload。",
      "base64url 没有 `+` `/` `=`，认出来别当标准 base64 去解。",
    ],
    aka: ["base64url json", "b64url", "jwt载荷解码", "Base64url JSON", "base64url转json", "jwt payload解码", "b64url json", "url安全base64", "json美化", "base64url decode"],
  },
};
