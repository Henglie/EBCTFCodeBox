/*
 * edu-hash-xxhash.js — xxHash 科普卡（hash 类）。
 *
 * 覆盖 op：xxhash
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  xxhash: {
    what: "xxHash——Yann Collet 设计的极速非加密哈希算法（BSD 开源协议），含 xxHash32（32 位）和 xxHash64（64 位）两个变体，速度远超 CRC32/MD5，广泛用于数据校验、文件去重、哈希表索引等场景。",
    principle:
      "xxHash32 核心是 4×32 位 striping 并行 + 算术混合。用 5 个质数常数（PRIME32_1~5）驱动乘法、循环左移、异或三类操作，把输入比特搅散成均匀分布的 32 位摘要。\n\n" +
      "大输入（>= 16 字节）：4 条 lane 各从一个初始值（含 seed）出发，每 16 字节块独立累加——lane 按 `v = ((v + 读4字节 × PRIME32_1) <<< 13) × PRIME32_2` 更新。块处理完后 4 条 lane 旋转归并成一个中间值，再逐字节吸收尾部，最后 avalange（3 次异或-乘-移位）消除统计偏差。\n\n" +
      "短输入（< 16 字节）：跳过 stripe 直接单路处理，从 seed+PRIME32_5 起步，吸收全部字节后走同样的 avalanche。\n\n" +
      "xxHash64 结构类似，但用 BigInt 保持 64 位精度、每 lane 处理 8 字节块、lane 归并时额外做 XOR-乘法-加法交叉混合，输出 64 位（16 hex）摘要。可选 seed 种子改变哈希起始值，同输入不同 seed 得不同输出，加盐抗哈希表碰撞攻击。",
    usage: "输入框填文本（或选 hex 模式填十六进制），variant 选 32/64 位变体，seed 填种子（十进制整数，默认 0，64 位也支持 0x 开头的 hex 写法）。点运行即输出 hex 摘要。单向不可逆，无解码。",
    examples: [
      { in: "", param: "variant=32, seed=0", out: "02cc5d05", desc: "xxHash32 空串官方测试向量" },
      { in: "abc", param: "variant=32, seed=0", out: "32d153ff", desc: "xxHash32 三字节经典测试向量" },
      { in: "a", param: "variant=64, seed=0", out: "d24ec4f1a98c6e5b", desc: "xxHash64 单字符测试向量" },
    ],
    tips: [
      "xxHash 不是密码学哈希（不抗碰撞/抗原像），只适合数据完整性校验和高速查重，别拿它当 SHA-256 用。",
      "seed 改任意值能得不同输出，CTF 题目若给了 seed 参数务必填上，否则对不上答案。",
      "CTF 题目给 8 位 hex（32 位）或 16 位 hex（64 位）且提示「极速」「非加密」→ 考 xxHash。",
      "xxHash64 输出固定 16 hex 字符，xxHash32 输出固定 8 hex 字符，输完直接比 hex 不用额外转换。",
    ],
    aka: ["xxhash", "xxHash", "xxHash32", "xxHash64", "xxh32", "xxh64", "极速哈希", "Yann Collet", "BSD哈希", "非加密哈希", "fast hash", "checksum", "CRC替代", "数据校验", "文件去重", "XXH3", "xxHash家族", "快速数据摘要"],
  },
};
