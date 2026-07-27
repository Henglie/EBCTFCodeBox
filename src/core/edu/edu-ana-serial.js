// 科普内容分片：analysis 序列化 / 密钥结构识别类。纯数据，无 import 无副作用。
export default {
  pemParse: {
    what: "PEM/DER 结构解析：把 `-----BEGIN ...-----` 那种密钥/证书文本拆开，看清里面是 RSA 还是 EC 私钥、公钥、证书还是 CSR，各字段是什么。",
    principle:
      "PEM 就是「头尾标记 + base64 编码的 DER」。DER 是 ASN.1 的二进制编码。解析先剥 base64 得到 DER，再按 ASN.1 结构递归读出 RSA 的 n/e/d、EC 的曲线与私钥、X.509 证书的主体/颁发者/有效期等。",
    usage: "粘 PEM 文本（或 DER 的 hex/base64），工具识别类型并列出关键字段。",
    examples: [
      { in: "-----BEGIN PUBLIC KEY----- ...", out: "类型=RSA公钥, n=..., e=65537" },
    ],
    tips: ["RSA 私钥题常直接给 PEM，解析出 n、e 就能接因子分解；证书题看有效期/CN/SAN 里藏的 flag。"],
    aka: ["pem", "der", "pem解析", "密钥解析", "证书解析", "privacy enhanced mail", "PEM格式", "DER编码", "x.509证书", "certificate parse", "PEM结构解析", "-----BEGIN-----"],
  },

  asn1Parse: {
    what: "ASN.1 TLV 解析：几乎所有证书、密钥、协议数据底层都是 ASN.1 的「标签-长度-值」嵌套结构，这个工具把它展成一棵可读的树。",
    principle:
      "DER 编码里每个节点是 TLV 三段：Tag（类型，如 SEQUENCE/INTEGER/OID）、Length（长度，可能多字节）、Value（内容，可再嵌 TLV）。递归解析就还原出整棵结构树，OID 会翻成人类可读的名字（如 1.2.840.113549.1.1.1 = rsaEncryption）。",
    usage: "粘 DER 的 hex 或 base64，输出标签/长度/值的层级树 + OID 名称。",
    examples: [
      { in: "30 06 02 01 05 02 01 03", out: "SEQUENCE { INTEGER 5, INTEGER 3 }", desc: "一个含两整数的序列" },
    ],
    tips: ["看不懂的二进制密钥/协议包，先丢 ASN.1 解析看结构。常见标签：0x30 SEQUENCE、0x02 INTEGER、0x06 OID。"],
    aka: ["asn1", "asn.1", "tlv", "der解析", "x.690", "abstract syntax notation one", "抽象语法记法", "tag length value", "标签长度值", "ASN.1解析", "TLV解析", "DER TLV"],
  },

  ecCurveIdent: {
    what: "椭圆曲线参数识别：给曲线名、OID 或 DER，认出它是 secp256k1、P-256 还是 Curve25519，并列出域参数 p、a、b、基点 G、阶 n 等。",
    principle:
      "椭圆曲线密码建在方程 $y^2 = x^3 + ax + b \\pmod p$ 上。每条标准曲线由一组固定参数 (p,a,b,G,n,h) 定义，并有唯一 OID。工具按名字/OID 匹配内置曲线库，回填全套参数。",
    usage: "输入曲线名（如 secp256k1）、点分 OID 或 DER OID，输出该曲线的域参数。",
    examples: [
      { in: "secp256k1", out: "p, a=0, b=7, G, n, h=1", desc: "比特币/以太坊用的曲线" },
    ],
    formulas: [
      { tex: "y^2 = x^3 + a x + b \\pmod p", caption: "短 Weierstrass 形式椭圆曲线方程" },
    ],
    tips: ["ECC 题先认曲线：secp256k1(a=0,b=7) 是加密货币标配；P-256 是 TLS 常用；Curve25519 走 Montgomery 形式。"],
    aka: ["椭圆曲线", "ec curve", "secp256k1", "曲线识别", "ecc参数", "elliptic curve", "curve identification", "P-256", "curve25519", "曲线参数", "域参数", "曲线OID识别"],
  },

  sshPubkeyParse: {
    what: "SSH 公钥解析：把 authorized_keys 里那行 `ssh-rsa AAAA...` 拆开，读出算法、内部字段（RSA 的 e/n 等）和 SHA256 指纹。",
    principle:
      "SSH 公钥格式是 `算法名 base64blob 注释`。blob 内部是「长度前缀 + 字段」串联：先重复一遍算法名，再依次是各参数（ssh-rsa 是 e、n；ssh-ed25519 是 32 字节公钥）。指纹 = 对整个 blob 做 SHA256 再 base64。",
    usage: "粘一行 SSH 公钥，工具拆出算法、字段和 SHA256 指纹。",
    examples: [
      { in: "ssh-rsa AAAAB3Nza...", out: "算法=ssh-rsa, e=65537, n=..., SHA256指纹" },
    ],
    tips: ["ssh-rsa 能直接读出 n、e，接 RSA 攻击。指纹用来和 known_hosts 比对身份。"],
    aka: ["ssh公钥", "ssh pubkey", "authorized_keys", "ssh key", "ssh-rsa", "ssh-ed25519", "openssh公钥", "openssh public key", "ssh公钥解析", "ssh指纹", "ssh fingerprint", "id_rsa.pub"],
  },

  btcAddressIdent: {
    what: "比特币地址识别：认出一个地址是 P2PKH（1 开头）、P2SH（3 开头）还是 SegWit/Taproot（bc1 开头），并校验它是否合法。",
    principle:
      "老式地址用 Base58Check（版本字节 + 数据 + 双 SHA-256 前 4 字节校验），新式 SegWit/Taproot 用 Bech32/Bech32m（bc1 前缀 + BCH 码校验）。工具按前缀和长度分类型，并跑对应校验和验证真伪。",
    usage: "粘比特币地址，输出类型、主网/测试网判定和校验结果。",
    examples: [
      { in: "1A1zP1eP...", out: "类型=P2PKH, 主网, 校验通过" },
      { in: "bc1q...", out: "类型=P2WPKH (SegWit)" },
    ],
    tips: ["1→P2PKH，3→P2SH，bc1q→SegWit，bc1p→Taproot。校验不过多半是抄错或题目故意改字符。"],
    aka: ["比特币地址", "btc address", "bitcoin地址", "base58check地址", "bitcoin address", "P2PKH", "P2SH", "SegWit", "Taproot", "bech32", "bc1地址", "比特币地址识别"],
  },

  ethAddressIdent: {
    what: "以太坊地址识别：认出 0x 开头的 40 位十六进制地址，并用 EIP-55 混合大小写规则校验它抄得对不对。",
    principle:
      "ETH 地址是 20 字节（40 hex）。EIP-55 校验和把地址转小写做 Keccak-256，再按哈希每一位决定原地址对应字符是大写还是小写——大小写图案本身就是校验码。抄错一个字符，大小写图案就对不上。",
    usage: "粘 0x 地址，工具校验 EIP-55 并输出标准的混合大小写地址。",
    examples: [
      { in: "0x5aAeb6053F...（混合大小写）", out: "EIP-55 校验通过 → 标准地址" },
    ],
    tips: ["全小写/全大写地址无法用 EIP-55 校验（合法但无校验保护）；混合大小写就能验真伪。注意用的是 Keccak-256 不是 SHA3-256。"],
    aka: ["以太坊地址", "eth address", "ethereum地址", "eip-55", "eip55", "ethereum address", "0x地址", "keccak校验", "以太坊地址校验", "混合大小写校验", "ETH地址识别", "checksum address"],
  },

  protobufParse: {
    what: "Protobuf Wire 解析：没有 .proto schema 也能硬解 Google Protocol Buffers 二进制，把字段号、类型和值扒出来。",
    principle:
      "Protobuf wire 格式每个字段是「(字段号<<3 | 线型) + 值」。线型有 4 种：0=varint（变长整数）、1=64 位定长、2=length-delimited（字符串/字节/嵌套 message）、5=32 位定长。无 schema 时按线型盲解，2 型再试着当嵌套 message 或字符串递归展开。",
    usage: "粘 protobuf 的 hex/base64，输出各字段号、线型和解出的值（含尝试的嵌套）。",
    examples: [
      { in: "08 96 01", out: "字段1(varint) = 150", desc: "0x08=字段1+varint，0x9601=150" },
    ],
    tips: ["gRPC 抓包、序列化文件常是 protobuf。2 型字段若又能整段解成 protobuf，多半是嵌套 message。"],
    aka: ["protobuf", "protocol buffers", "protobuf解析", "pb", "谷歌协议缓冲", "protobuf wire", "wire格式", "protobuf decode", "pb解析", "gRPC序列化", "proto解码", "protobuf硬解"],
  },

  msgpackParse: {
    what: "MessagePack 解析：把这种「二进制版 JSON」还原成可读结构。它比 JSON 紧凑，常出现在缓存、RPC、游戏存档里。",
    principle:
      "MessagePack 用单字节前缀（format byte）标类型和长度：如 0x00-0x7f 是小正整数、0xa0-0xbf 是短字符串、0x80-0x8f 是短 map、0x90-0x9f 是短数组，nil/bool/float/bin/ext 各有码。按前缀逐个读出完整数据树。",
    usage: "粘 MessagePack 的 hex/base64，输出还原的 JSON 式结构。",
    examples: [
      { in: "82 a1 61 01 a1 62 02", out: '{ "a": 1, "b": 2 }', desc: "0x82=2 元素 map" },
    ],
    tips: ["看到紧凑二进制、含大量 0xa?/0x8?/0x9? 前缀，试 MessagePack。和 CBOR 长得像但码表不同。"],
    aka: ["messagepack", "msgpack", "msgpack解析", "message pack", "二进制JSON", "紧凑JSON", "msgpack decode", "MessagePack解码", "消息打包", "binary json格式", "msgpack反序列化", "mpack"],
  },

  cborParse: {
    what: "CBOR 解析：Concise Binary Object Representation，物联网/COSE/WebAuthn 里的二进制数据格式，RFC 8949 标准。",
    principle:
      "CBOR 每个数据项首字节高 3 位是 major type（0 无符号整数、1 负整数、2 字节串、3 文本串、4 数组、5 map、6 tag、7 简单值/浮点），低 5 位是长度或附加信息。支持不定长（0x1f 结尾）和半精度浮点。按此递归解析。",
    usage: "粘 CBOR 的 hex/base64，输出还原结构（含 tag、不定长、浮点）。",
    examples: [
      { in: "a2 01 02 03 04", out: "{1: 2, 3: 4}", desc: "0xa2=2 元素 map" },
    ],
    tips: ["WebAuthn/FIDO2 的 attestation、COSE 密钥都是 CBOR。major type 5 是 map、4 是数组。"],
    aka: ["cbor", "cbor解析", "rfc8949", "concise binary", "concise binary object representation", "简明二进制对象表示", "cbor decode", "CBOR解码", "COSE", "WebAuthn数据", "rfc7049", "cbor反序列化"],
  },

  bsonParse: {
    what: "BSON 文档解析：MongoDB 用的二进制 JSON。比 JSON 多了类型（ObjectId、日期、二进制、int32/int64 等）和长度前缀。",
    principle:
      "BSON 文档开头是 4 字节总长度，之后是若干「类型字节 + 字段名(C 字符串) + 值」，以 0x00 结尾。类型码定义值怎么读：0x02 字符串、0x07 ObjectId(12 字节)、0x09 UTC 日期、0x10 int32、0x12 int64 等。",
    usage: "粘 BSON 的 hex/base64，输出还原的文档结构和各字段类型。",
    examples: [
      { in: "BSON 文档字节", out: '{ "_id": ObjectId(...), "age": 30 }' },
    ],
    tips: ["MongoDB 导出/内存 dump 常见 BSON。开头 4 字节小端长度 + 结尾 0x00 是识别特征。"],
    aka: ["bson", "bson解析", "mongodb文档", "binary json", "binary son", "二进制JSON文档", "mongodb序列化", "bson decode", "BSON解码", "mongo dump", "ObjectId解析", "bson反序列化"],
  },

  phpSerializeParse: {
    what: "PHP serialize 解析：把 PHP 的 `serialize()` 字符串拆开看结构。反序列化漏洞（PHP 对象注入）题的必备工具。",
    principle:
      "PHP 序列化用带类型标记的文本：`s:5:\"hello\"` 是 5 字节字符串、`i:42` 整数、`a:2:{...}` 2 元素数组、`O:8:\"ClassName\":n:{...}` 对象、`b:1` 布尔、`N` 为 null。可递归嵌套，`r`/`R` 是引用。",
    usage: "粘 PHP serialize 字符串，工具递归解出全部字段与类型。",
    examples: [
      { in: 'a:1:{s:4:"user";s:5:"admin";}', out: '{ "user": "admin" }', desc: "1 元素关联数组" },
    ],
    tips: ["反序列化漏洞题核心：看 O: 对象里有哪些属性，配合 __wakeup/__destruct 魔术方法构造 payload。字符串长度写错会解析失败。"],
    aka: ["php serialize", "php序列化", "反序列化", "对象注入", "php unserialize", "php反序列化", "PHP对象注入", "POP链", "serialize解析", "__wakeup", "__destruct", "php serialization"],
  },

  javaSerializeIdent: {
    what: "Java 序列化识别：认出 Java 对象序列化流（魔数 0xACED），扫出里面的类名、字符串等顶层标记。ysoserial 类反序列化漏洞题常见。",
    principle:
      "Java 序列化流以 magic `AC ED 00 05` 开头，之后是一串 TC_* 标记：TC_OBJECT(0x73)、TC_CLASSDESC(0x72) 带类名、TC_STRING(0x74) 带字符串、TC_BLOCKDATA(0x77) 等。扫描这些标记就能看出序列化了什么类。",
    usage: "粘数据（hex/base64/原始），工具确认 0xACED 魔数并列出扫到的 TC_* 标记与类名。",
    examples: [
      { in: "ac ed 00 05 73 72 ...", out: "Java 序列化流, 类名=java.util.HashMap ..." },
    ],
    tips: ["hex 以 `aced0005` 开头 = Java 序列化，几乎必是反序列化题。类名里出现 CommonsCollections/InvokerTransformer 等是 gadget chain 信号。"],
    aka: ["java序列化", "java serialize", "0xaced", "反序列化", "ysoserial", "java serialization", "java反序列化", "aced0005", "序列化魔数", "gadget chain", "commons collections", "java对象流"],
  },
};
