/*
 * edu_xsalsa20.js — 科普卡候选（XSalsa20）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：D. J. Bernstein「Extending the Salsa20 nonce」原论文、NaCl crypto_stream_xsalsa20、
 * libsodium 官方测试向量 stream3/core4/core3（均 2026-09-23 访问，全文与出处见 权威来源.md）。
 */
export default {
  xsalsa20: {
    what: "XSalsa20：Salsa20 的「加长 nonce」版本。Salsa20 的 nonce 只有 8 字节，随机生成时易撞（生日界 2^32 条报文）；XSalsa20 先用 HSalsa20 从密钥与 24 字节 nonce 派生一个 32 字节子密钥，再用子密钥跑 Salsa20，把 nonce 空间从 2^64 扩到 2^192，可以放心随机生成 nonce。",
    principle:
      "两步构造：\n" +
      "① **HSalsa20 派生子密钥**：把 32 字节密钥、24 字节 nonce 的**前 16 字节**、以及 Salsa20 常数 `\"expand 32-byte k\"` 装进 16 字状态，跑 20 轮（10 个双轮），但**不加回初始状态**，只取第 0、5、10、15、6、7、8、9 这 8 个字拼成 32 字节子密钥。\n" +
      "② **Salsa20/20 PRGA**：用该子密钥 + nonce 的**后 8 字节** + 64 位块计数器，跑标准 Salsa20 密钥流；密文 = 明文 XOR 密钥流（自反）。\n\n" +
      "HSalsa20 与 Salsa20 核心的**唯一差别**就在这里：Salsa20 核心输出时要 `x + 初始状态`（带喂回的 PRF 块），HSalsa20 **不喂回**、只取部分字（是压缩函数）。这一处写错，XSalsa20 的整条密钥流就全错——所以必须用官方向量对拍。\n\n" +
      "与同库的 `salsa20` 算子区分：本算子是 24 字节 nonce 的扩展版，两者参数面不重叠（nonce 长度不同，互不误用）。",
    usage:
      "参数：密钥（**固定 32 字节**，UTF-8/Hex/Base64/Latin-1）、nonce（**24 字节**）、初始块计数器（64 位整数 ≥ 0，默认 0）、密文编码（Base64/Hex）。\n\n" +
      "自反：加密与解密是同一变换，encode/decode 同核。密钥非 32 字节、nonce 非 24 字节会显式报错，不静默截断/补零。\n\n" +
      "自检：密钥 `1b27…8389`、nonce `6969…0b37`，密钥流前 32 字节应等于 `eea6a7251c1e72916d11c2cb214d3c252539121d8e234e652d651fa4c8cff880`（libsodium stream3 向量）。",
    examples: [
      { in: "密钥 1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389", param: "nonce=69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37, counter=0", out: "密钥流前 32 字节 eea6a7251c1e72916d11c2cb214d3c252539121d8e234e652d651fa4c8cff880", desc: "libsodium 官方测试向量 stream3.exp（crypto_stream 前 32 字节）" },
      { in: "密钥 1b27…8389（同上）", param: "nonce 前 16 字节 6969…b73", out: "子密钥 dc908dda0b9344a953629b733820778880f3ceb421bb61b91cbd4c3e66256ce4", desc: "HSalsa20 派生的 32 字节子密钥（中间量，便于定位「不喂回」写错的位置）" },
      { in: "in=65666768696a6b6c6d6e6f7071727374, key=01..10‖c9..d8, c=\"expand 32-byte k\"", param: "Salsa20 核心（20 轮）", out: "45254427290f6bc1ff8b7a06aae9d962…ea67f64a（64 字节）", desc: "libsodium core4.exp：对拍块函数本体（带喂回的 Salsa20 核心）" },
      { in: "密钥 000102…1e1f, nonce 000102…1617", param: "counter=0", out: "密钥流前 16 字节 7cb660afdd9ec6468f57dd6d2433f934", desc: "普通样例：密钥与 nonce 均为递增字节，便于手工复算" },
    ],
    formulas: [
      { tex: "k' = \\mathrm{HSalsa20}_{k}(\\text{nonce}[0{:}16])", caption: "子密钥 = HSalsa20(密钥, nonce 前 16 字节)，输出 32 字节（不喂回初始状态）" },
      { tex: "K = \\mathrm{Salsa20\\!/20}_{k'}\\!\\left(\\text{nonce}[16{:}24],\\ \\text{ctr}\\right),\\quad C_i = P_i \\oplus K_i", caption: "用子密钥 + nonce 后 8 字节 + 64 位计数器跑 Salsa20，密文 = 明文 XOR 密钥流" },
    ],
    tips: [
      "**nonce 长度是首要判别特征**：24 字节 nonce + 32 字节密钥 = XSalsa20；8 字节 nonce = 普通 Salsa20。看错长度就会用错算子。",
      "**HSalsa20 不喂回**：这是 XSalsa20 最易写错的地方。Salsa20 核心最后要 `+ 初始状态`；HSalsa20 **不加**，只取 8 个字。若你的实现能得到 stream3 前 32 字节对、但换密钥就全错，多半是这里。",
      "**为什么要派生**：直接给 Salsa20 塞 24 字节 nonce 会破坏其状态布局；HSalsa20 把「密钥 + 前 16 字节 nonce」压成新密钥，剩下的 8 字节 nonce 正好填进 Salsa20 的 nonce 位，兼容原 PRGA。",
      "**计数器是 64 位**：一次密钥流可产出 2^64 个 64 字节块（约 2^70 字节），实际用不完；本工具允许指定起始计数器以复现 mid-stream 数据。",
      "**自反用法**：加密解密同式；只需保证密钥/nonce/计数器一致。这也是流密码的通病——**同一 (密钥, nonce) 绝不重复使用**，否则两段密文异或即得两段明文异或。",
      "**安全边界**：XSalsa20 只提供**机密性**，不提供认证。要防篡改须配 Poly1305（即 NaCl 的 secretbox / libsodium 的 crypto_secretbox）。CTF 里常见「XSalsa20 加密但无 MAC」的题，重点常是可预测 nonce 或重放。",
      "**对拍锚点**：本工具用 libsodium 的 stream3（密钥流）、core4（Salsa20 核心 64 字节）、core3（4 MiB 聚合 SHA-256）三层向量交叉验证，单层过不算过。",
      "来源：Bernstein「Extending the Salsa20 nonce」（XSalsa20 定义）、NaCl crypto_stream_xsalsa20、libsodium stream3/core4/core3 官方向量（均 2026-09-23 访问）。",
    ],
    aka: ["xsalsa20", "hsalsa20", "xsalsa20 加密", "salsa20 24字节nonce", "nacl crypto_stream_xsalsa20",
      "libsodium xsalsa20", "xsalsa20 子密钥派生", "hsalsa20 密钥派生", "salsa20 扩展nonce",
      "xsalsa20 流密码", "xsalsa20 计数器", "secretbox xsalsa20", "xsalsa20 测试向量",
      "salsa20 core 函数"],
  },
};
