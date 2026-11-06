export default {
  falconKeyGen: {
    what: "Falcon/FN-DSA 密钥生成：在 NTRU 格上生成一对 Falcon-512（n=512）或 Falcon-1024（n=1024）密钥。公钥是 h=g/f mod (x^n+1,12289)，私钥是满足 f·G−g·F=q 的短多项式四元组。",
    principle: "先按高斯分布采样短多项式 f,g，检查系数界与 ‖(f,g)‖²，再用 Berd 判界确认对应的 NTRU 格有足够短的基；通过后解 f·G−g·F=q，得到 F,G，并计算 h=g/f。私钥按规范 trim_i8 编码，公钥按 14 bit 系数流编码。",
    usage: "选择 Falcon-512 或 Falcon-1024；种子留空时从统一随机源取 48 字节，填入固定 48 字节 hex 可复现同一密钥。输出公钥/私钥 hex 与两个下载文件。私钥只在本机使用，不要上传。",
    examples: [
      { in: "参数档 Falcon-512；种子留空", param: "logn=9", out: "公钥 897 B、私钥 1281 B；报告采样次数与耗时", desc: "常用档，通常远快于 1024" },
      { in: "参数档 Falcon-1024；固定 48B seed", param: "logn=10；seed=000102…2f", out: "公钥 1793 B、私钥 2305 B；同 seed 可复现", desc: "高安全档，keygen 通常 <2 s" },
      { in: "参数档 Falcon-512；把 seed 改成 47 B", param: "logn=9", out: "显式报错：种子需恰好 48 字节", desc: "长度错误不静默补齐" },
    ],
    tips: [
      "公钥可以公开；私钥是签名密钥，泄露即可伪造签名。",
      "Falcon 的 keygen 有拒绝采样，采样次数随种子与参数波动，不是固定耗时。",
      "本工具输出官方三段私钥，可直接交给 Falcon 签名；也保留四段兼容格式。",
    ],
    aka: [
      "Falcon keygen", "FN-DSA keygen", "Falcon 密钥生成", "Falcon 密钥对生成",
      "Falcon-512 key generation", "Falcon-1024 key generation", "格密码密钥生成",
      "NIST PQC Falcon keygen", "falcon keypair", "falcon sk pk", "FN-DSA key pair", "Falcon 密钥生成器",
    ],
  },
  falconSign: {
    what: "Falcon/FN-DSA 签名：用 Falcon 私钥对消息生成格签名。签名包含 40 字节 nonce 与压缩后的 s2，可直接交给 Falcon 验签。",
    principle: "先计算 c=HashToPoint(nonce‖消息)，把签名问题化为在 NTRU 格中寻找短向量 (s1,s2)，使 s1+s2·h=c；用 ffSampling 在 FFT/LDL 树上做高斯采样，若 ‖(s1,s2)‖² 超过 ⌊β²⌋ 就重采样。最终编码为 0x39/0x3A（Falcon-512/1024）‖ nonce ‖ comp(s2)。",
    usage: "消息可选 UTF-8 文本或 hex；私钥填官方三段（0x59/0x5A）或本工具四段格式。nonce 40 字节、签名种子 48 字节均可留空随机；显式填入可复现 KAT。输出签名 hex 与 .sig 文件。",
    examples: [
      { in: "消息 hello；Falcon-512 私钥；nonce/seed 留空", param: "msgMode=text", out: "签名 hex（约 666 B）；报告范数与重采样次数", desc: "常规签名" },
      { in: "同一消息与固定 nonce/seed", param: "msgMode=text；固定 40B nonce/48B seed", out: "签名逐字节可复现", desc: "KAT/对拍用" },
      { in: "把 nonce 改成 39 B", param: "msgMode=text", out: "显式报错：nonce 需恰好 40 字节", desc: "长度错误不静默" },
      { in: "消息含二进制字节", param: "msgMode=hex", out: "按原始字节签名，输出签名 hex", desc: "二进制消息" },
    ],
    tips: [
      "同一 nonce/种子只应用于复现测试；生产签名应留空让统一随机源生成。",
      "签名范数必须 ≤⌊β²⌋（512 档 34034726，1024 档 70265242）；超界会重采样。",
      "公钥、签名和原文必须匹配；篡改任意一项，验签会失败。",
    ],
    aka: [
      "Falcon signature", "FN-DSA sign", "Falcon 签名", "Falcon 签名生成",
      "Falcon-512 sign", "Falcon-1024 sign", "格密码签名", "NIST PQC Falcon sign",
      "falcon sign", "falcon sig", "FN-DSA signature", "Falcon 签名工具",
    ],
  },
};
