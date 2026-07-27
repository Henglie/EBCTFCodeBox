// English edu shard: modern segment, last 8 (idea/blowfish/rc6/jwt/jwtNone/jweIdentify/pasetoIdentify/b64urlJson). Pure data, no imports, no side effects.
export default {
  idea: {
    what: "International Data Encryption Algorithm, the core of PGP email encryption in the 90s. Its distinctive trait is mixing three 'algebraically incompatible' operations.",
    principle:
      "Block length 64 bits, key 128 bits, 8.5 rounds. It mixes three operations for security: multiplication mod $2^{16}+1$, addition mod $2^{16}$, and bitwise XOR. The three come from different algebraic structures and none can simplify the others, which is the source of its resistance to analysis. Decryption uses the multiplicative/additive inverses of encryption, with round keys in reverse order.",
    usage: "Enter a 16-byte key, select the mode (CBC needs an IV), input the ciphertext to decrypt; the encode direction encrypts.",
    formulas: [
      { tex: "\\text{multiplication mod } 2^{16}+1 = 65537", caption: "IDEA's signature modular-prime multiplication" },
    ],
    tips: [
      "64-bit block → ciphertext is a multiple of 8 bytes.",
      "Recognize the signature: multiplication mod 65537 means IDEA.",
    ],
    aka: ["idea", "国际数据加密算法", "pgp加密", "lai massey", "IDEA", "International Data Encryption Algorithm", "IDEA加密", "lai-massey结构", "IPES", "分组密码"],
  },

  blowfish: {
    what: "A free block cipher designed by Schneier, with a flexible key length (4-56 bytes); the bcrypt password hash grew out of it.",
    principle:
      "Block length 64 bits, 16 Feistel rounds. The core is a P-array (18 subkeys) and four S-boxes (256 entries each), all computed from the key through a fairly time-consuming initialization. Encryption is 16 rounds of 'F function + XOR subkey'. The slow initialization is exactly the source of bcrypt's brute-force resistance.",
    usage: "Enter a key (any length 4-56 bytes), select the mode (CBC needs an IV), input the ciphertext to decrypt; the encode direction encrypts.",
    tips: [
      "64-bit block → ciphertext is a multiple of 8 bytes.",
      "The variable-length key is its conspicuous feature distinguishing it from fixed-length AES/DES.",
    ],
    aka: ["blowfish", "河豚密码", "schneier", "Blowfish", "布劳菲什", "Blowfish加密", "变长密钥密码", "bcrypt基础", "Feistel分组密码", "Bruce Schneier"],
  },

  rc6: {
    what: "RC5's successor, once one of the AES finalists. The block widened to 128 bits and it processes two lanes of data in parallel.",
    principle:
      "The 128-bit block is split into four 32-bit words A/B/C/D, 20 rounds. Compared to RC5 it adds an integer multiplication for 'whitening' to speed up diffusion, while keeping the data-dependent rotation. The key is variable length (default 16 bytes).",
    usage: "Enter a key (default 16 bytes), select the mode (CBC needs an IV), input the ciphertext to decrypt; the encode direction encrypts.",
    tips: [
      "128-bit block (like AES) → ciphertext is a multiple of 16 bytes, unlike RC5's 64-bit block.",
      "It also has data-dependent rotation, plus a quadratic-function `B*(2B+1)`-style multiplicative whitening, which is the key to recognizing it.",
    ],
    aka: ["rc6", "rivest cipher 6", "aes候选", "RC6", "RC6加密", "RC5继任者", "RC6分组密码", "AES候选算法", "128位块密码", "数据依赖旋转"],
  },

  jwt: {
    what: "JSON Web Token — the 'pass' a website issues after you log in. Three segments separated by dots; the first two are plaintext JSON, the third is a signature.",
    principle:
      "Structure `header.payload.signature`, where the first two segments are each a base64url-encoded JSON, and the third is a signature over `header.payload`. HS256/384/512 use HMAC (symmetric key), while RS/ES use asymmetric private-key signing.\n\n" +
      "Key point: the payload is only base64-encoded, not encrypted — anyone can read it! The signature only guarantees 'not tampered with', not 'invisible'.",
    usage: "Parse direction: paste a JWT, split out header/payload and optionally verify the signature with a key. Issue direction: enter header/payload and an HS key to generate a signed token.",
    examples: [
      { in: "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiYWRtaW4ifQ.xxx", out: "header={alg:HS256}, payload={user:admin}", desc: "the first two segments are directly base64-decodable" },
    ],
    tips: [
      "A dot-separated three-segment string starting with `eyJ` is a JWT (`eyJ` is the base64 of `{\"`).",
      "Weak-key challenge: take header.payload and the signature, use hmacKeyBrute to crack the HS256 key.",
      "The payload is directly readable, don't expect it to hide anything.",
    ],
    aka: ["jwt", "json web token", "jot", "hs256", "JWT", "JSON Web Token", "RFC 7519", "json令牌", "web令牌", "token鉴权"],
  },

  jwtNone: {
    what: "JWT's most classic vulnerability trick: change the algorithm field to `none`, claiming 'this token needs no signature', to fool loosely-validated backends.",
    principle:
      "Change the `alg` in the header to `none` (or `None`/`NONE` for case bypass) and leave the third signature segment empty. If the server doesn't strictly validate the algorithm, it accepts this unsigned token — so you can forge any payload (e.g. change `user` to `admin`).",
    usage: "Construct direction: enter the payload you want, and the tool generates an `alg:none` unsigned token. Detect direction: paste a token to judge whether it uses the none attack.",
    examples: [
      { in: "{\"user\":\"admin\"}", out: "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJ1c2VyIjoiYWRtaW4ifQ.", desc: "note the empty signature after the trailing dot" },
    ],
    tips: [
      "Recognize the signature: the decoded `alg` is `none` and the third segment's signature is empty.",
      "The case-variation `nOnE` is a common technique to bypass certain blacklists.",
    ],
    aka: ["jwt none", "alg none", "jwt空签名攻击", "none算法", "JWT None攻击", "alg:none", "jwt none漏洞", "无签名jwt", "jwt绕过", "jwt算法混淆"],
  },

  jweIdentify: {
    what: "JWE is JWT's 'encrypted version' (JSON Web Encryption) — the payload is genuinely encrypted, unlike JWT's plaintext-readable one. This tool helps you split apart its five-segment structure.",
    principle:
      "JWE compact serialization is five dot-separated segments:\n\n" +
      "`protected header ‖ encrypted key ‖ IV ‖ ciphertext ‖ authentication tag` (RFC 7516). The first segment base64url-decodes into JSON, where you can see `alg` (how the key is wrapped) and `enc` (how the content is encrypted, e.g. A256GCM). The last four segments can't be decrypted without the key.",
    usage: "Paste a JWE token, and the tool splits it into five segments by dots and parses the first segment's header, reporting the algorithms used. This is identification/structure reporting, it does not decrypt.",
    examples: [
      { in: "eyJ…(5 dot-separated segments)", out: "5-segment breakdown + header alg/enc info" },
    ],
    tips: [
      "Count the dots: JWT is 3 segments, JWE is 5 segments, distinguishable at a glance.",
      "JWE's payload is truly encrypted, don't expect to base64-read it directly like JWT.",
    ],
    aka: ["jwe", "json web encryption", "rfc7516", "JWE", "JSON Web Encryption", "RFC 7516", "jwe识别", "加密jwt", "jwe结构解析", "五段令牌"],
  },

  pasetoIdentify: {
    what: "PASETO is a token format claiming to be 'safer than JWT', cutting out JWT's dangerous algorithm options. This tool identifies its version and purpose.",
    principle:
      "Format `version.purpose.payload[.footer]`, such as `v2.local.xxxx`. version is v1-v4, purpose is either `local` (symmetric encryption) or `public` (asymmetric signing). It hard-codes the algorithm into the version, blocking JWT's `alg:none`-type attacks at the root.",
    usage: "Paste a PASETO token, and the tool identifies the version (v1-v4) and purpose (local/public) and splits the structure. It identifies purpose, it does not decrypt or verify signatures.",
    examples: [
      { in: "v2.local.xxxxx", out: "version v2 / purpose local (symmetric encryption)" },
      { in: "v4.public.xxxxx", out: "version v4 / purpose public (signing)" },
    ],
    tips: [
      "Recognize the signature: starts with `v1`~`v4` plus `.local.` or `.public.`.",
      "A local payload is encrypted; a public one is signed + plaintext-readable.",
    ],
    aka: ["paseto", "platform agnostic security tokens", "jwt替代", "PASETO", "paseto令牌", "paseto识别", "v2.local", "v4.public", "安全令牌", "平台无关安全令牌"],
  },

  b64urlJson: {
    what: "A little tool for converting back and forth between Base64url and JSON, with pretty-printing on the side. Super handy for cracking open JWT-style 'base64url-wrapped JSON' payloads.",
    principle:
      "Base64url is the URL-safe variant of base64: `+/` become `-_`, and trailing `=` padding is dropped. Here it decodes base64url into text, parses it as JSON and pretty-prints with indentation; the reverse compacts the JSON then base64url-encodes it.",
    usage: "Decode direction: paste a base64url string, output the pretty-printed JSON. Encode direction: paste JSON, output a base64url string.",
    examples: [
      { in: "eyJ1c2VyIjoiYWRtaW4ifQ", out: "{\n  \"user\": \"admin\"\n}", desc: "a JWT payload segment looks exactly like this" },
    ],
    tips: [
      "When manually cracking a JWT, drop the middle segment in here to read the payload.",
      "base64url has no `+` `/` `=`; once you recognize it, don't decode it as standard base64.",
    ],
    aka: ["base64url json", "b64url", "jwt载荷解码", "Base64url JSON", "base64url转json", "jwt payload解码", "b64url json", "url安全base64", "json美化", "base64url decode"],
  },
};
