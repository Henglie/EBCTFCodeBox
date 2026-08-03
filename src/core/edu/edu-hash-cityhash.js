/*
 * edu-hash-cityhash.js — CityHash 科普卡（hash 类）。
 *
 * 覆盖 op：cityhash
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  cityhash: {
    what: "CityHash——Google 2011 年发布的极速非加密哈希族（Geoff Pike / Jyrki Alakuijala 设计，MIT 协议），含 CityHash32、CityHash64、CityHash128 等变体。为短字符串吞吐量而生，在哈希表、指纹去重场景比 MD5/SHA 快一个数量级。本工具实现 CityHash32 与 CityHash64。",
    principle:
      "CityHash 的设计思路是「按长度分档、每档用最省指令的混合公式」，而不是像 MD5 那样统一走压缩函数。三个 64 位质数常数贯穿全程：k0 = 0xc3a5c85c97cb3127、k1 = 0xb492b66fbe98f273、k2 = 0x9ae16a3b2f90404f。\n\n" +
      "CityHash64 按输入长度走五条互不相同的分支：\n" +
      "• len = 0：直接返回 k2；\n" +
      "• 1 ≤ len ≤ 3：只取首字节、中间字节、尾字节拼成两个 32 位量 y、z，做 `ShiftMix(y·k2 ^ z·k0)·k2`；\n" +
      "• 4 ≤ len ≤ 7：取首尾各 4 字节，交给 HashLen16 的 Murmur 式双轮混合；\n" +
      "• 8 ≤ len ≤ 16：取首尾各 8 字节，配合 `mul = k2 + 2·len` 做旋转-乘-加；\n" +
      "• 17 ≤ len ≤ 32 与 33 ≤ len ≤ 64：分别用 HashLen17to32 / HashLen33to64，读取更多重叠的 8 字节窗口，穿插 Rotate（右旋）、bswap_64（字节序翻转）、ShiftMix（`x ^ (x >> 47)`）。\n\n" +
      "len > 64 时进入主循环：先从末尾取 x、y、z 三个 64 位状态种子，再用 WeakHashLen32WithSeeds 把结尾 64 字节压成两对 (v, w)，然后每轮吃 64 字节、更新 x/y/z/v/w 并交换 z 与 x，最后两层 HashLen16 收尾。所有中间量都在 uint64 上自然回绕——JS 里必须每步 `& 0xFFFF...FFFF` 截断，否则 BigInt 无限精度会让高位污染结果。\n\n" +
      "CityHash32 是独立的一套，混合原语直接借自 Murmur3：常数 c1 = 0xcc9e2d51、c2 = 0x1b873593，`Mur(a, h)` 做「乘 c1 → 右旋 17 → 乘 c2 → 异或 → 右旋 19 → ×5 + 0xe6546b64」，`fmix` 做最终 avalanche。len ≤ 24 时按 0-4 / 5-12 / 13-24 三档处理；len > 24 走每轮吃 20 字节的循环，循环内用 PERMUTE3 三向轮换 f/h/g，尾部再做两轮旋转-乘法收束。",
    usage: "输入框填文本（或切 Hex 模式填十六进制字节），位宽选 CityHash64（输出 16 hex）或 CityHash32（输出 8 hex），点运行得摘要。单向不可逆，encode 与 decode 行为一致，都是算哈希。",
    examples: [
      { in: "", param: "bits=64", out: "9ae16a3b2f90404f", desc: "空串走 len=0 分支，直接返回常数 k2" },
      { in: "abc", param: "bits=64", out: "24a5b3a074e7f369", desc: "3 字节走「取首/中/尾字节」的最短分支" },
      { in: "Hello, world!", param: "bits=64", out: "307c26b3e0789a47", desc: "13 字节走 8~16 档，首尾 8 字节重叠读取" },
      { in: "abc", param: "bits=32", out: "2f635ec7", desc: "CityHash32 的 len≤4 档，Murmur3 风格混合" },
      { in: "The quick brown fox jumps over the lazy dog", param: "bits=64", out: "c268724928feca7d", desc: "43 字节走 HashLen33to64 分支" },
    ],
    tips: [
      "CityHash 不是密码学哈希：不抗碰撞、不抗原像，绝不能用于口令存储或签名。它的定位是哈希表键、数据去重指纹、分片路由。",
      "同一段数据用 CityHash32 和 CityHash64 算出来毫无关系——32 位版不是 64 位版的截断，是两套独立算法，别互相验证。",
      "CityHash 有多个版本（1.0.3 / 1.1），CityHash64 的短串分支在 1.1 里改过公式。本实现对齐官方 city-test.cc 的 300 组向量（含 1 MB 大输入），与 Crypto++ 一致。",
      "CTF 里看到 8 位或 16 位 hex，且题面提到 Google、哈希表、「快」「非加密」，优先试 CityHash / FarmHash / xxHash 三个。",
      "CityHash 后继者是 FarmHash（同作者，2014），Google 内部已多数迁移；遇到「新版 CityHash」的提示可能实际考的是 FarmHash。",
      "实现踩坑：官方 `Rotate` 是右旋不是左旋，`HashLen33to64` 变量名极易抄错位，CityHash32 尾部的 g/f 各要做两轮 `Rotate*c1`——少一轮长输入就全错但短输入照样过，务必用全量向量对拍。",
    ],
    aka: ["cityhash", "CityHash", "CityHash32", "CityHash64", "CityHash128", "city hash", "谷歌哈希", "Google哈希", "非加密哈希", "极速哈希", "fast hash", "哈希表哈希", "指纹哈希", "去重哈希", "Geoff Pike", "FarmHash前身", "Murmur后继", "k0k1k2", "HashLen16", "ShiftMix"],
  },
};
