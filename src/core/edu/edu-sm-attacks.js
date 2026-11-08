const c1 = "0432c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a011aa1c7617e415694b8339acabe65f78358eb279b2124fbe50cfcadb55037254ac673c75e0dc0c38bdd4e09ad3050579";
const c2 = "0432c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0d33fdeff7a244f5476bd7305f1be365bbd73c2b3fdfc1c0dcb1eac15d92849c7a1653265f58f116683cfeb9bc5185025";
const pub = c1.slice(0, 130);
const sig = { r1: "7a50ef8fcace56ee4a737aa160915c4d19df461dddbcb8096e5c4ec6a51bbbed", s1: "c2d788371a98d488dac642af4fb751d8e5143c5c32e7a9269c8dcca5e747632d", e1: "478c4163abb4d5d4eada765af65792b889fc3a5deb56ac27fd02093d71cf4726", k: "1" };
const samples = "|bd59335a26cd7f44a26b6722d27f00c6|41a5e0e86fc0211a93147052abb92ffa\n|bc58325b27cc7e45a36a6623d37e01c7|60981ad27d555fe21e877262a1bd2a44\n|bf5b315824cf7d46a0696520d07d02c4|03de149c4aeadceb88327432bfb12486";
export default {
  sm2KnownPlaintext: {
    what: "SM2 加密错误复用临时随机数 k 时的已知明文恢复。必须是同一接收方公钥，不能凭一组明密文破解正常 SM2。",
    principle: "GB/T 32918.4 加密满足 C1=[k]G，C2=M XOR KDF(x2||y2)。同一公钥和 k 生成同一密钥流，故 M2=C2_2 XOR C2_1 XOR M1。相同 C1 只能核对临时点，不能核对接收方公钥，也不能据此验证 C3。",
    usage: "选择完整密文或仅C2。主输入填目标密文，参数填已知密文与明文/片段，支持UTF-8/hex、字节偏移（默认0）。完整档检查两条C1，顺序各自选C1C3C2/C1C2C3，C1选65B带04或64B无前缀。仅C2档跳过C1检查，必须已有相同公钥/随机数的题设依据。只恢复覆盖字节并提供下载，每条输入上限1 MiB。",
    examples: [{ in: c2, param: `knownCipher=${c1}; known=known plaintext!; offset=0; 其余默认`, out: "UTF-8: flag{sm2_reuse!}", desc: "独立 gmssl 确定性测试，d=k=1 仅用于演示" },
      { in: "d87dc23dee4a1dc8d1df41f6c9083a28b2eeecbfe284b39c35fb102e243e473c819dc0e98b33", param: "cipherFormat=c2; knownCipher=e974cf39fa4541dd928300e690552e02e1bfe8b4a3aaeac939b2767f24605605d79094ffad371c637fc4912f1fd06a1a8e2fccdf1ee9b4ab9f2ac0cdc199; known=Welcome to the Hefei High-Tech Zone Cybersecurity Competition.", out: "UTF-8: flag{b9573ad184b67abaf02dd24c61c9c16e}", desc: "用户提供真题题面；62B已知明文恢复38B目标。未给C3，不声称认证通过" }],
    tips: ["不恢复私钥；不验证 C3。已知明文更短时只恢复前缀/指定片段，标 partial。", "仅支持 sm2p256v1 原始密文，不自动猜 DER/压缩点或接收方。来源：https://www.ietf.org/archive/id/draft-shen-sm2-ecdsa-02.txt §7.2.1（历史草案，非正式 RFC）。"],
    aka: ["SM2 已知明文攻击", "SM2 known plaintext", "SM2 KPA", "SM2 随机数复用", "SM2 encryption nonce reuse", "SM2 C1 重复", "SM2 密钥流复用", "SM2 C2 XOR", "国密已知明文恢复", "SM2 明文片段恢复", "SM2 repeated ephemeral key"],
  },
  sm2NonceRecover: {
    what: "SM2 签名的临时随机数泄露、复用、已知仿射关联时，恢复签名私钥。",
    principle: "GB/T 32918.2 签名满足 s(1+d)=k-rd (mod n)。已知 k：d=(k-s)/(r+s)；复用 k：d=(s2-s1)/(r1+s1-r2-s2)。若 k2=a*k1+b，则 d=(s2-a*s1-b)/(a*(r1+s1)-r2-s2)。恢复后逐条检查 r=(e+x([k]G)) mod n 与签名方程，可选 publicKey 再比对。",
    usage: "主输入 JSON，r1/s1/e1 与 r2/s2/e2 或 k 均为 hex 整数字符串；默认 reuse。known 只需第一条签名和 k；related 另填 a/b（hex）。e 必须是完整 e=SM3(ZA||M)，不是裸 SM3(M)。输出 d/k/公钥；退化分母或校验失败明确拒绝。",
    examples: [{ in: JSON.stringify(sig), param: "attackMode=known", out: "d = 0000000000000000000000000000000000000000000000000000000000000001", desc: "gmssl 对 known plaintext! 的签名，默认 ID=1234567812345678，演示 k=1" }],
    tips: ["SM2 同 k 不要求 r 相同，不套用 ECDSA 的重复 r 公式。默认 sm2p256v1，不接受 DER 签名；r/s 拆为 hex。", "仅验证所给 e 的方程，消息和 ZA 的绑定仍由输入者确认。来源：draft-shen-sm2-ecdsa-02 §5.2.1；公式直接移项推导。"],
    aka: ["SM2 签名随机数攻击", "SM2 nonce reuse", "SM2 k 泄露", "SM2 private key recovery", "SM2 重复签名随机数", "SM2 related nonce", "SM2 关联随机数", "SM2 affine nonce", "国密签名私钥恢复", "SM2 leaked k", "SM2 signing key extraction"],
  },
  sm2LeakedK: {
    what: "SM2 加密临时随机数 k 泄露后，凭公开接收方公钥恢复明文，并校验 C3。",
    principle: "计算 [k]P 得到 KDF 输入，再用 C2 XOR KDF 解密；先核对 [k]G=C1，再核对 SM3(x2||M||y2)=C3。此路径与仅凭已知明文恢复不同，能够核验完整密文的认证摘要。",
    usage: "主输入完整密文 hex；填泄露 k（hex）、接收方公钥（04||x||y 或 x||y）、密文顺序和 C1 编码。默认 C1C3C2/带 04。输出完整字节、UTF-8（有效时）与二进制下载。",
    examples: [{ in: c2, param: `k=1; publicKey=${pub}; 其余默认`, out: "UTF-8: flag{sm2_reuse!}", desc: "d=k=1 的确定性演示密文，C1/C3 均核验" }],
    tips: ["加密 k 不是接收方私钥；不因此恢复接收方长期私钥。", "错误 k、公钥、C3 与越界点均报错。来源：draft-shen-sm2-ecdsa-02 §7.2.1/7.3.1。"],
    aka: ["SM2 加密随机数泄露", "SM2 leaked encryption nonce", "SM2 known k decryption", "SM2 临时密钥泄露", "SM2 k 泄露解密", "SM2 ephemeral scalar leak", "SM2 公钥加 k 解密", "SM2 C3 校验解密", "国密随机数泄露解密", "SM2 encryption k compromise"],
  },
  sm3LengthExtension: {
    what: "SM3 的 Merkle–Damgård 长度扩展：从完整摘要继续压缩，构造追加数据后的摘要。",
    principle: "SM3 最终摘要就是 8 个 32 位内部状态字。已知原始总字节数，重建 0x80/零/64 位大端长度填充，以该状态继续压缩 append。输出 H(original||glue||append) 与 glue||append，无需知道 original。",
    usage: "主输入为追加数据；参数填原始 64 hex 摘要、含 secret 的总字节数（十进制文本，默认 0）、追加数据 UTF-8/hex（默认 UTF-8）。长度用 BigInt，追加最多 1 MiB；下载 suffix 后附在已知公开消息后。",
    examples: [{ in: "d", param: "digest=66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0; originalLength=3", out: "newHash: 631665d64651d487cb4a1efd330705bf5151b3e0db48691b62681d0758784e0f", desc: "原消息 abc；OpenSSL SM3 独立核对" }],
    tips: ["仅错误的 SM3(secret||message) 前缀 MAC 受此构造影响，不适用于 HMAC-SM3，也不是碰撞/原像破解。", "总长度须猜对；不确定密钥长度须分别尝试。来源：draft-sca-cfrg-sm3-02 §5.2/5.3（历史草案）。"],
    aka: ["SM3 长度扩展", "SM3 length extension", "SM3 prefix MAC", "SM3 前缀 MAC 伪造", "SM3 glue padding", "SM3 状态续算", "国密哈希长度扩展", "SM3 hash continuation", "SM3 secret-prefix attack", "SM3 padding append"],
  },
  sm4CtrReuse: {
    what: "SM4-CTR/OFB 在同一 key、同一初始 IV 和相同流位置复用密钥流时，已知明文解另一侧。",
    principle: "流式模式 C=P XOR S；S=C1 XOR P1，可解 P2=C2 XOR S。不需密钥，但成立条件必须由外部确认。",
    usage: "主输入目标 raw 密文 hex，不含 IV/tag。填已知密文 hex、已知明文片段 hex、字节偏移（默认 0）。输出覆盖字节和 partial，最多 1 MiB。",
    examples: [{ in: "01000302", param: "cipher1=00010203; known=61626364; offset=0", out: "Hex: 60636265", desc: "相同密钥流条件下的 XOR 构造示例" }],
    tips: ["不用于 CBC/ECB，不验证认证码，不恢复 SM4 key。", "不同初始计数器/IV 或偏移错位时结果无效。来源：NIST SP 800-38A CTR/OFB 方程。"],
    aka: ["SM4 CTR 重用", "SM4 OFB 重用", "SM4 nonce reuse", "SM4 keystream reuse", "SM4 已知明文攻击", "SM4 counter reuse", "SM4 IV 重复", "SM4 密钥流恢复", "国密流模式复用", "SM4 two-time pad"],
  },
  zucNonceReuse: {
    what: "ZUC 重用同一 key+IV 的两条密文，利用一侧已知明文恢复另一侧对应片段。",
    principle: "ZUC 是 XOR 密钥流加密，密钥流复用满足 P2=C2 XOR C1 XOR P1。不会恢复 ZUC 密钥或逆向 LFSR 内部状态。",
    usage: "主输入目标 raw 密文 hex；参数填已知密文/已知明文 hex、偏移（默认 0）。输入必须同流起点且不含 MAC。仅恢复已知覆盖范围。",
    examples: [{ in: "01000302", param: "cipher1=00010203; known=61626364", out: "Hex: 60636265", desc: "密钥流复用的 XOR 构造示例" }],
    tips: ["同 key 不同 IV 不满足前提。EEA3 的 COUNT/BEARER/DIRECTION 参与 IV 构造，必须一致。", "来源：GB/T 33133.1 ZUC 密钥流构造；不是 ZUC 本体破解。"],
    aka: ["ZUC nonce reuse", "ZUC IV 重用", "祖冲之密钥流复用", "ZUC known plaintext", "ZUC 已知明文攻击", "ZUC two-time pad", "ZUC keystream recovery", "ZUC 同密钥同 IV", "祖冲之明文恢复", "ZUC ciphertext XOR"],
  },
  sm4CbcBitflip: {
    what: "SM4-CBC 未认证密文的位翻转构造：修改 IV 或前一密文块，定点替换一段已知明文。",
    principle: "CBC 解密 P_i=D(C_i) XOR C_(i-1)。将前置块异或 known XOR desired 即可令当前片段变为 desired；首块前置块是 IV。若改密文块，会使其自身对应的前一明文块不可预测。",
    usage: "主输入 IV(16B)||完整密文 hex；填非空等长的 known/desired hex 与明文绝对字节偏移（默认 0）。一次片段不得跨 16B 块；输出修改后的 IV||ciphertext 与损坏块索引（从 0 起）。",
    examples: [{ in: "00".repeat(16) + "681edf34d206965e86b3e94f536e4246", param: "known=01; desired=00; offset=0", out: "IV 首字节变 01，其余不变", desc: "官方 SM4 块向量，IV=0；首明文字节 01→00" }],
    tips: ["不会绕过 MAC/AEAD，不保证篡改后业务格式/填充被接受。", "非首块会破坏前一明文块，报告明确列出。来源：NIST SP 800-38A CBC 解密方程。"],
    aka: ["SM4 CBC bit flipping", "SM4 CBC 位翻转", "SM4 IV 篡改", "SM4 CBC malleability", "国密 CBC 篡改", "SM4 明文定点替换", "SM4 CBC forgery", "SM4 前置块异或", "SM4 CBC 未认证攻击", "SM4 known plaintext modification"],
  },
  sm4EcbCodebook: {
    what: "同一 SM4-ECB 密钥下，把已知完整明密文块建成码本，恢复目标密文中的已知块。",
    principle: "ECB 每个 16B 块独立加密，同一 key 下相同明文块生成相同密文块。码本反查只恢复已知块，未匹配标 UNKNOWN，冲突明密文对拒绝。",
    usage: "主输入非空整块密文 hex。参数每行 16B plaintextHex|ciphertextHex，最多 4096 行。输出逐块 hex/UNKNOWN；全恢复才提供二进制下载，保留原始填充。",
    examples: [{ in: "681edf34d206965e86b3e94f536e4246", param: "pairs=0123456789abcdeffedcba9876543210|681edf34d206965e86b3e94f536e4246", out: "0: 0123456789abcdeffedcba9876543210", desc: "GB/T 32907 官方块向量" }],
    tips: ["非同 key、错块边界、CBC/CTR 都不能用。不能凭短明文推断整块。", "不包含在线 chosen-plaintext oracle，不恢复密钥。来源：NIST SP 800-38A ECB。"],
    aka: ["SM4 ECB 码本攻击", "SM4 ECB codebook", "SM4 已知分组恢复", "SM4 block dictionary", "SM4 ECB 已知明文", "SM4 重复块识别", "国密码本攻击", "SM4 plaintext block lookup", "SM4 deterministic block leak", "SM4 ECB pattern leak"],
  },
  sm4GcmForgery: {
    what: "SM4-GCM 同 key+nonce 重用时，恢复 GHASH 子密钥 H 与掩码，构造合法认证 tag。",
    principle: "GCM tag=E_K(J0) XOR GHASH_H(A,C)，与块密码是 AES 还是 SM4 无关。两条样本相减消去掩码，在 GF(2^128) 求根得到 H 候选，再用所有样本筛选；多个候选分别输出，不冒称唯一。",
    usage: "主输入每行 aadHex|ctHex|tagHex（aad 可空），或填 samples 参数。至少两条、推荐三条；仅 16B tag，最多 32 条/64 KiB。填 newAad/newCt 才伪造；每条最多 256 次多项式。",
    examples: [{ in: samples, param: "newCt=db35523d5dab1036c50e037da11234e7ee; newAad=空; samples=空", out: "伪造 tag（候选 H1）= 5ba2ff5ecca5a2b463e2914d481b4cda", desc: "OpenSSL SM4-GCM 同 key/nonce 独立生成与验签" }],
    tips: ["换 key 或 nonce 即失效；恢复的是 GHASH H，不是 SM4 key。未知/截断 tag 不支持。", "来源：RFC 8998 §3.5.1、SP 800-38D、Joux 2006 forbidden attack。"],
    aka: ["SM4 GCM nonce reuse", "SM4 GCM forbidden attack", "SM4 GCM 认证伪造", "SM4 GHASH 子密钥恢复", "SM4 GCM tag forgery", "国密 GCM 重用攻击", "SM4 authentication mask", "SM4 Joux attack", "SM4 GCM H recovery", "SM4 GCM 随机数复用"],
  },
};
