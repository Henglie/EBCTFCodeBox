/*
 * edu-openssl.js — opensslDec 中文科普卡（纯数据，无 import / 无副作用）。
 * 向量由 OpenSSL 3.5.7 实跑生成；截断样例来自真实样本（缺 6 字节）。
 */
export default {
  opensslDec: {
    what:
      "OpenSSL 口令加解密：把 `U2FsdGVkX1…` 这种「Salted__ 头 + salt + 密文」的 base64 串，用一行口令直接解回明文；反过来也能把明文加密成同样的格式，交给系统 openssl 解开。",
    principle:
      "格式来自 OpenSSL `enc`（也是很多语言库的默认输出）：`\"Salted__\"`(8 字节) ‖ salt(8 字节) ‖ 密文。\n\n" +
      "key/iv 由 EVP_BytesToKey 派生，count=1：`D₁ = H(口令 ‖ salt)`，`Dᵢ = H(Dᵢ₋₁ ‖ 口令 ‖ salt)`，把各轮摘要首尾相接，取前 keyLen 字节作 key、接着 16 字节作 CBC 的 iv。哈希档有 MD5（`-md md5`，经典默认）与 SHA-256（`-md sha256`，OpenSSL 3 的默认）。\n\n" +
      "加密是 AES-128/192/256-CBC，填充为 PKCS#7：末字节给出填充长度 1..16，前面同样长度的字节必须全部等于该值。CBC 每块都与前一块异或，所以 key/iv 错一位，整段明文都会变。\n\n" +
      "auto 模式把 AES 三档 key 长度 × 2 种哈希档 + RC4 × 2 种哈希档共 8 组都跑一遍：分组密码先看 PKCS#7 是否合法，流密码直接看明文可信度（合法 UTF-8、ASCII 可打印率、已知文件魔数），最后按分数取最优，并把 8 组结果全部列出来。\n\n" +
      "**RC4 变体**：CryptoJS 的 RC4 也用同一套 Salted__ 封装，但它是流密码——密文长度不必是 16 的倍数，key 由 EVP_BytesToKey 派生 32 字节，无填充、无 drop。看到 42 字节这类「不合 AES 块长」的密文，先怀疑 RC4。",
    usage:
      "解密：口令填 `-k` 后面那串；算法与 KDF 不确定就留 auto。输入可以是 base64（可带 `data:…;base64,` 前缀）、hex，或直接把文件拖进来走真字节通道。\n" +
      "加密：方向选「加密」，口令 + 算法 + KDF，输出 `U2FsdGVkX1` 开头的 base64，可直接 `openssl enc -d` 解回。auto 加密固定用 AES-256-CBC + MD5（经典组合）；要与 OpenSSL 3 的默认行为一致，请显式选 `sha256`。\n" +
      "长度不是 16 的倍数会直接报「密文长度 N 字节不是 16 的倍数（缺 M 字节）」，不会截断、补零或输出乱码；没有 `Salted__` 头、填充非法、口令错误同样报错。",
    examples: [
      {
        in: "U2FsdGVkX1/+VhjF1yB94/NBL+GgUVpObI3orI+tfNFO3FbMpga9SjxqJ9omMUaR",
        param: "passphrase=HAPPYNEWYEAR2026, cipher=aes-256-cbc, kdf=md5, mode=decode",
        out: "Hello OpenSSL vector one",
      },
      {
        in: "hello",
        param: "passphrase=demo, cipher=auto, kdf=auto, mode=encode",
        out: "U2FsdGVkX1…（每次 salt 随机，结果不同；可交给 openssl enc -d -aes-256-cbc -md md5 -k demo 解回）",
      },
      {
        in: "U2FsdGVkX19j9ML+b3YCvo9YcSIpc1lJDhAooMzHrhN7xtMqjnejx2iYI+Usoq203Ry+tYp7R1ZaTQ==",
        param: "passphrase=任意",
        out: "报错：密文长度 42 字节不是 16 的倍数（缺 6 字节）",
      },
    ],
    tips: [
      "先看前缀：base64 以 `U2FsdGVkX1` 开头，基本就是 OpenSSL/CryptoJS 系 Salted__；解不开优先怀疑口令、KDF 摘要、key 长度三件事。",
      "OpenSSL 3 用 `-k` 时默认摘要已是 SHA-256；老资料里的命令多数是 `-md md5`。两种都试一遍最稳，auto 就是干这个的。",
      "本格式没有 MAC，口令错误只能靠填充与明文可信度拦住（填充偶然合法的概率约 1/256）；因此无魔数的纯二进制明文可能被判为可疑而报错，此时请用 aes op 直接喂 key/iv。",
      "命令行复现：`openssl enc -aes-256-cbc -salt -md md5 -k 口令 -in 明文 -out 密文`，解密加 `-d`；`-P` 可打印派生出的 key/iv，便于和工具结果对照。",
      "截断检测只针对「长度不是 16 的倍数」；正好少了 16 的整数倍时长度仍合法，只能靠解密结果异常发现。",
      "RC4 的 key 派生结果是 32 字节（CryptoJS 默认），不是 16；解不出先确认 cipher 选的是 auto 还是 rc4。明若是逗号分隔的 ASCII 码串，再做一次码值转字符即可。",
    ],
    aka: [
      "OpenSSL 解密", "openssl enc 解密", "Salted__ 解密", "U2FsdGVkX1 解密", "OpenSSL 口令解密",
      "EVP_BytesToKey", "openssl enc -d", "AES 口令解密", "AES 口令加密", "PKCS7 去填充",
      "OpenSSL passphrase decrypt", "openssl salted decrypt", "Salted__ cipher", "openssl enc ciphertext",
      "RC4 解密", "CryptoJS RC4", "rc4 salted", "Salted__ RC4",
    ],
  },
};
