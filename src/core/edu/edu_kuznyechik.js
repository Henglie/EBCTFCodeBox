/*
 * edu_kuznyechik.js — 科普卡候选（Kuznyechik / GOST R 34.12-2015）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：RFC 7801（GOST R 34.12-2015 正式英文镜像）+ Wikipedia「Kuznyechik」（均 2026-09-22 访问）。
 */
export default {
  kuznyechik: {
    what: "Kuznyechik（俄语「蚱蜢」，ГОСТ Р 34.12-2015）——俄罗斯联邦标准 128 位分组密码，2015 年与 64 位的 Magma 一同发布，是 Streebog 哈希的姊妹算法。分组 128 位、密钥 256 位、10 轮 LSX 代换-置换网络；S 盒与 Magma 的 4 位小盒不同，是整字节 256 项大表。俄罗斯 TLS/国密套件（GOST cipher suites）与信创赛题常见。",
    principle:
      "每轮做三件事：X（与轮密钥异或）、S（逐字节过 256 项非线性 S 盒 Pi'）、L（GF(2^8) 线性扩散）。\n" +
      "L 由 16 次 R 叠成：R 先对 16 字节做 l 线性组合——系数 148,32,133,16,194,192,1,251（自 a15 降序）与对称的 1,192,194,16,133,32,148,1，域多项式 x^8+x^7+x^6+x+1——再把结果字节循环右移一格。\n" +
      "加密 b = X[K10]·LSX[K9]…LSX[K1](a)（9 轮 LSX + 最后一轮只异或）；解密按 S^-1·L^-1·X 逆推。\n" +
      "密钥排程是 8 步 Feistel：F[C](k1,k2) = (LSX[C](k1) XOR k2, k1)，常数 C_i = L(Vec_128(i))，" +
      "i 取 1..32——第 1 对轮密钥用 C1..C8，第 2 对用 C9..C16，依此类推产出 K1..K10。",
    usage:
      "输入/输出均为 hex：明文按 16 字节（32 个 hex 字符）分块，可多块（ECB，不足一块报错，不自动填充）；密钥 256 位（64 个 hex 字符）。\n" +
      "编码 = 加密（明文 hex → 密文 hex），解码 = 解密（密文 hex → 明文 hex），同一密钥双向互逆。\n" +
      "默认密钥即官方测试向量密钥，直接粘 RFC §5.5 明文 1122334455667700ffeeddccbbaa9988 可复现官方向量。",
    examples: [
      { in: "1122334455667700ffeeddccbbaa9988", param: "默认密钥（RFC 7801 §5 例钥）", out: "7f679d90bebc24305a468d42b9d4edcd", desc: "官方测试向量（GOST R 34.12-2015 §A.1）" },
      { in: "7f679d90bebc24305a468d42b9d4edcd", param: "默认密钥，方向=解码", out: "1122334455667700ffeeddccbbaa9988", desc: "官方向量反向复原" },
      { in: "1122334455667700ffeeddccbbaa9988", param: "key=00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", out: "04d5c81f5e8f73c2805ceda600a6014e", desc: "换钥自算（与 Python 独立实现对拍一致）" },
    ],
    formulas: [
      { tex: "b = X[K_{10}]\\, LSX[K_9]\\cdots LSX[K_1](a)", caption: "加密：9 轮 LSX + 末轮异或" },
      { tex: "l(a_{15},\\ldots,a_0)=\\bigoplus_{i=0}^{15} c_i\\cdot a_i,\\quad p(x)=x^8+x^7+x^6+x+1", caption: "线性变换 l：GF(2^8) 系数组合" },
      { tex: "C_i = L(\\mathrm{Vec}_{128}(i))", caption: "密钥排程轮常数" },
    ],
    tips: [
      "识别：题目给出 256 位 hex 密钥 + 128 位分组的 SPN 密文、或提到 GOST R 34.12/Grasshopper/俄罗斯国密套件，即为本算法；64 位分组则是其姊妹 Magma（本工具另有 op）。",
      "默认密钥即 RFC 例钥：明文 1122334455667700ffeeddccbbaa9988 加密必须得到 7f679d90bebc24305a468d42b9d4edcd，可当快速自检。",
      "坑位：密钥排程的 32 个常数是 C1..C32 依次取用（每对轮密钥推进 8 个），不是 C1..C8 重复用——自实现时最常见的错误点。",
      "本工具仅 ECB 档（GOST R 34.13-2015 的 CTR/CGM 等工作模式未纳入，无可靠公开向量不硬造）；ECB 不隐藏模式，真实使用应上认证的工作模式。",
      "安全边界：S 盒经 Biryukov/Perrin/Udovenko 逆向出隐藏生成算法（非「无魔法数」声明），最佳公开攻击破 5 轮；10 轮全量目前无实际攻击，但作为俄罗斯标准算法在部分司法辖区的合规性需自行评估。",
      "来源：RFC 7801 https://www.rfc-editor.org/rfc/rfc7801.txt ；Wikipedia「Kuznyechik」https://en.wikipedia.org/wiki/Kuznyechik （访问日期 2026-09-22）。",
    ],
    aka: ["Kuznyechik", "Kuznyechik 密码", "Кузнечик", "Grasshopper", "蚱蜢密码", "GOST R 34.12-2015",
      "GOST 34.12", "kuznyechik decrypt", "kuznyechik online", "俄罗斯分组密码", "GOST 分组密码", "Kuznechik"],
  },
};
