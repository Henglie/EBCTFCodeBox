// English edu shard: analysis serialization / key-structure identification family. Pure data, no imports, no side effects.
export default {
  pemParse: {
    what: "PEM/DER structure parsing: take that `-----BEGIN ...-----` key/certificate text apart to see whether it's an RSA or EC private key, public key, certificate, or CSR, and what each field is.",
    principle:
      "PEM is just 'header/footer markers + base64-encoded DER'. DER is the binary encoding of ASN.1. Parsing first strips the base64 to get DER, then recursively reads the ASN.1 structure to extract RSA's n/e/d, EC's curve and private key, an X.509 certificate's subject/issuer/validity, etc.",
    usage: "Paste PEM text (or the hex/base64 of DER); the tool identifies the type and lists the key fields.",
    examples: [
      { in: "-----BEGIN PUBLIC KEY----- ...", out: "type=RSA public key, n=..., e=65537" },
    ],
    tips: ["RSA private-key challenges often just hand you a PEM; parse out n, e and you can chain into factorization. Certificate challenges: look for the flag hidden in the validity/CN/SAN."],
    aka: ["pem", "der", "pem解析", "密钥解析", "证书解析", "privacy enhanced mail", "PEM格式", "DER编码", "x.509证书", "certificate parse", "PEM结构解析", "-----BEGIN-----"],
  },

  asn1Parse: {
    what: "ASN.1 TLV parsing: almost all certificates, keys, and protocol data are underlyingly ASN.1's nested 'Tag-Length-Value' structure; this tool expands it into a readable tree.",
    principle:
      "In DER encoding each node is a TLV triple: Tag (type, e.g. SEQUENCE/INTEGER/OID), Length (may be multi-byte), Value (content, which may nest further TLVs). Recursive parsing reconstructs the whole structure tree, and OIDs are translated into human-readable names (e.g. 1.2.840.113549.1.1.1 = rsaEncryption).",
    usage: "Paste the hex or base64 of DER; outputs a hierarchical tree of tag/length/value + OID names.",
    examples: [
      { in: "30 06 02 01 05 02 01 03", out: "SEQUENCE { INTEGER 5, INTEGER 3 }", desc: "a sequence containing two integers" },
    ],
    tips: ["For a binary key/protocol packet you can't read, throw it at ASN.1 parsing first to see the structure. Common tags: 0x30 SEQUENCE, 0x02 INTEGER, 0x06 OID."],
    aka: ["asn1", "asn.1", "tlv", "der解析", "x.690", "abstract syntax notation one", "抽象语法记法", "tag length value", "标签长度值", "ASN.1解析", "TLV解析", "DER TLV"],
  },

  ecCurveIdent: {
    what: "Elliptic-curve parameter identification: given a curve name, OID, or DER, recognize whether it's secp256k1, P-256, or Curve25519, and list the domain parameters p, a, b, base point G, order n, etc.",
    principle:
      "Elliptic-curve cryptography is built on the equation $y^2 = x^3 + ax + b \\pmod p$. Each standard curve is defined by a fixed set of parameters (p,a,b,G,n,h) and has a unique OID. The tool matches the built-in curve library by name/OID and fills in the full parameter set.",
    usage: "Enter a curve name (e.g. secp256k1), a dotted OID, or a DER OID; outputs that curve's domain parameters.",
    examples: [
      { in: "secp256k1", out: "p, a=0, b=7, G, n, h=1", desc: "the curve used by Bitcoin/Ethereum" },
    ],
    formulas: [
      { tex: "y^2 = x^3 + a x + b \\pmod p", caption: "short Weierstrass form elliptic-curve equation" },
    ],
    tips: ["For ECC challenges identify the curve first: secp256k1 (a=0,b=7) is the crypto-currency standard; P-256 is common in TLS; Curve25519 uses the Montgomery form."],
    aka: ["椭圆曲线", "ec curve", "secp256k1", "曲线识别", "ecc参数", "elliptic curve", "curve identification", "P-256", "curve25519", "曲线参数", "域参数", "曲线OID识别"],
  },

  sshPubkeyParse: {
    what: "SSH public-key parsing: take that `ssh-rsa AAAA...` line from authorized_keys apart to read the algorithm, internal fields (RSA's e/n etc.), and the SHA256 fingerprint.",
    principle:
      "The SSH public-key format is `algorithm-name base64blob comment`. Inside the blob is a concatenation of 'length prefix + field': first the algorithm name repeated, then each parameter in turn (ssh-rsa is e, n; ssh-ed25519 is a 32-byte public key). The fingerprint = SHA256 over the whole blob, then base64.",
    usage: "Paste one line of SSH public key; the tool extracts the algorithm, fields, and SHA256 fingerprint.",
    examples: [
      { in: "ssh-rsa AAAAB3Nza...", out: "algorithm=ssh-rsa, e=65537, n=..., SHA256 fingerprint" },
    ],
    tips: ["ssh-rsa lets you read n, e directly, chaining into RSA attacks. The fingerprint is used to compare identity against known_hosts."],
    aka: ["ssh公钥", "ssh pubkey", "authorized_keys", "ssh key", "ssh-rsa", "ssh-ed25519", "openssh公钥", "openssh public key", "ssh公钥解析", "ssh指纹", "ssh fingerprint", "id_rsa.pub"],
  },

  btcAddressIdent: {
    what: "Bitcoin address identification: recognize whether an address is P2PKH (starts with 1), P2SH (starts with 3), or SegWit/Taproot (starts with bc1), and validate whether it's legitimate.",
    principle:
      "Legacy addresses use Base58Check (version byte + data + first 4 bytes of double SHA-256 as checksum); the newer SegWit/Taproot use Bech32/Bech32m (bc1 prefix + BCH-code checksum). The tool classifies by prefix and length, and runs the corresponding checksum to verify authenticity.",
    usage: "Paste a Bitcoin address; outputs the type, mainnet/testnet determination, and validation result.",
    examples: [
      { in: "1A1zP1eP...", out: "type=P2PKH, mainnet, checksum passed" },
      { in: "bc1q...", out: "type=P2WPKH (SegWit)" },
    ],
    tips: ["1→P2PKH, 3→P2SH, bc1q→SegWit, bc1p→Taproot. A failing checksum usually means a typo or that the challenge deliberately altered a character."],
    aka: ["比特币地址", "btc address", "bitcoin地址", "base58check地址", "bitcoin address", "P2PKH", "P2SH", "SegWit", "Taproot", "bech32", "bc1地址", "比特币地址识别"],
  },

  ethAddressIdent: {
    what: "Ethereum address identification: recognize a 0x-prefixed 40-hex-digit address and use the EIP-55 mixed-case rule to check whether it was copied correctly.",
    principle:
      "An ETH address is 20 bytes (40 hex). The EIP-55 checksum takes the lowercased address, runs Keccak-256, and then, per each bit of the hash, decides whether the corresponding character of the original address is uppercase or lowercase — the case pattern itself is the checksum. Miscopy one character and the case pattern won't match.",
    usage: "Paste a 0x address; the tool validates EIP-55 and outputs the standard mixed-case address.",
    examples: [
      { in: "0x5aAeb6053F...(mixed case)", out: "EIP-55 check passed → standard address" },
    ],
    tips: ["An all-lowercase/all-uppercase address can't be EIP-55 validated (legal but with no checksum protection); mixed case lets you verify authenticity. Note it uses Keccak-256, not SHA3-256."],
    aka: ["以太坊地址", "eth address", "ethereum地址", "eip-55", "eip55", "ethereum address", "0x地址", "keccak校验", "以太坊地址校验", "混合大小写校验", "ETH地址识别", "checksum address"],
  },

  protobufParse: {
    what: "Protobuf wire parsing: even without a .proto schema you can brute-parse Google Protocol Buffers binary, prying out field numbers, types, and values.",
    principle:
      "In the Protobuf wire format each field is '(field number<<3 | wire type) + value'. There are 4 wire types: 0=varint (variable-length integer), 1=64-bit fixed, 2=length-delimited (string/bytes/nested message), 5=32-bit fixed. Without a schema it blind-parses by wire type, and for type 2 tries to recursively expand it as a nested message or string.",
    usage: "Paste the hex/base64 of a protobuf; outputs each field number, wire type, and the parsed value (including attempted nesting).",
    examples: [
      { in: "08 96 01", out: "field 1 (varint) = 150", desc: "0x08=field 1+varint, 0x9601=150" },
    ],
    tips: ["gRPC captures and serialized files are often protobuf. If a type-2 field can itself be parsed as protobuf, it's probably a nested message."],
    aka: ["protobuf", "protocol buffers", "protobuf解析", "pb", "谷歌协议缓冲", "protobuf wire", "wire格式", "protobuf decode", "pb解析", "gRPC序列化", "proto解码", "protobuf硬解"],
  },

  msgpackParse: {
    what: "MessagePack parsing: restore this 'binary JSON' into a readable structure. It's more compact than JSON and often appears in caches, RPC, and game saves.",
    principle:
      "MessagePack marks type and length with a single-byte prefix (format byte): e.g. 0x00-0x7f are small positive integers, 0xa0-0xbf are short strings, 0x80-0x8f are short maps, 0x90-0x9f are short arrays, and nil/bool/float/bin/ext each have their code. It reads out the complete data tree prefix by prefix.",
    usage: "Paste the hex/base64 of MessagePack; outputs the restored JSON-style structure.",
    examples: [
      { in: "82 a1 61 01 a1 62 02", out: '{ "a": 1, "b": 2 }', desc: "0x82=2-element map" },
    ],
    tips: ["Seeing compact binary with lots of 0xa?/0x8?/0x9? prefixes, try MessagePack. It looks like CBOR but has a different code table."],
    aka: ["messagepack", "msgpack", "msgpack解析", "message pack", "二进制JSON", "紧凑JSON", "msgpack decode", "MessagePack解码", "消息打包", "binary json格式", "msgpack反序列化", "mpack"],
  },

  cborParse: {
    what: "CBOR parsing: Concise Binary Object Representation, the binary data format in IoT/COSE/WebAuthn, an RFC 8949 standard.",
    principle:
      "In CBOR each data item's first byte has its high 3 bits as the major type (0 unsigned integer, 1 negative integer, 2 byte string, 3 text string, 4 array, 5 map, 6 tag, 7 simple value/float) and its low 5 bits as length or additional info. It supports indefinite length (0x1f terminator) and half-precision floats. Parse recursively accordingly.",
    usage: "Paste the hex/base64 of CBOR; outputs the restored structure (including tags, indefinite length, floats).",
    examples: [
      { in: "a2 01 02 03 04", out: "{1: 2, 3: 4}", desc: "0xa2=2-element map" },
    ],
    tips: ["WebAuthn/FIDO2 attestation and COSE keys are all CBOR. Major type 5 is a map, 4 is an array."],
    aka: ["cbor", "cbor解析", "rfc8949", "concise binary", "concise binary object representation", "简明二进制对象表示", "cbor decode", "CBOR解码", "COSE", "WebAuthn数据", "rfc7049", "cbor反序列化"],
  },

  bsonParse: {
    what: "BSON document parsing: the binary JSON used by MongoDB. Compared to JSON it adds types (ObjectId, date, binary, int32/int64, etc.) and length prefixes.",
    principle:
      "A BSON document starts with a 4-byte total length, followed by several 'type byte + field name (C string) + value', terminated by 0x00. The type code defines how the value is read: 0x02 string, 0x07 ObjectId (12 bytes), 0x09 UTC date, 0x10 int32, 0x12 int64, etc.",
    usage: "Paste the hex/base64 of BSON; outputs the restored document structure and each field's type.",
    examples: [
      { in: "BSON document bytes", out: '{ "_id": ObjectId(...), "age": 30 }' },
    ],
    tips: ["MongoDB exports/memory dumps commonly contain BSON. The leading 4-byte little-endian length + trailing 0x00 is the recognition signature."],
    aka: ["bson", "bson解析", "mongodb文档", "binary json", "binary son", "二进制JSON文档", "mongodb序列化", "bson decode", "BSON解码", "mongo dump", "ObjectId解析", "bson反序列化"],
  },

  phpSerializeParse: {
    what: "PHP serialize parsing: take apart a PHP `serialize()` string to see its structure. An essential tool for deserialization-vulnerability (PHP object injection) challenges.",
    principle:
      "PHP serialization uses text with type markers: `s:5:\"hello\"` is a 5-byte string, `i:42` an integer, `a:2:{...}` a 2-element array, `O:8:\"ClassName\":n:{...}` an object, `b:1` a boolean, `N` is null. It can nest recursively; `r`/`R` are references.",
    usage: "Paste a PHP serialize string; the tool recursively parses out all fields and types.",
    examples: [
      { in: 'a:1:{s:4:"user";s:5:"admin";}', out: '{ "user": "admin" }', desc: "1-element associative array" },
    ],
    tips: ["Core of deserialization-vuln challenges: see what properties are in the O: object, and pair with __wakeup/__destruct magic methods to build a payload. A wrong string length makes parsing fail."],
    aka: ["php serialize", "php序列化", "反序列化", "对象注入", "php unserialize", "php反序列化", "PHP对象注入", "POP链", "serialize解析", "__wakeup", "__destruct", "php serialization"],
  },

  javaSerializeIdent: {
    what: "Java serialization identification: recognize a Java object-serialization stream (magic 0xACED) and scan out the class names, strings, and other top-level markers inside. Common in ysoserial-style deserialization-vuln challenges.",
    principle:
      "A Java serialization stream starts with the magic `AC ED 00 05`, followed by a string of TC_* markers: TC_OBJECT(0x73), TC_CLASSDESC(0x72) with a class name, TC_STRING(0x74) with a string, TC_BLOCKDATA(0x77), etc. Scanning these markers reveals what class was serialized.",
    usage: "Paste data (hex/base64/raw); the tool confirms the 0xACED magic and lists the scanned TC_* markers and class names.",
    examples: [
      { in: "ac ed 00 05 73 72 ...", out: "Java serialization stream, class name=java.util.HashMap ..." },
    ],
    tips: ["Hex starting with `aced0005` = Java serialization, almost certainly a deserialization challenge. Class names like CommonsCollections/InvokerTransformer are gadget-chain signals."],
    aka: ["java序列化", "java serialize", "0xaced", "反序列化", "ysoserial", "java serialization", "java反序列化", "aced0005", "序列化魔数", "gadget chain", "commons collections", "java对象流"],
  },
};
