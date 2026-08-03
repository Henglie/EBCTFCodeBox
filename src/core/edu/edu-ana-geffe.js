/*
 * edu-ana-geffe.js — Geffe 生成器 / 相关攻击 科普卡（analysis 类）。
 *
 * 覆盖 op：geffe
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 *
 * 示例数据由 工具/_geffe_probe.mjs 真机探针取自 src/core/geffe.js 实跑结果，
 * 非编造（铁律：算法正确性必须查证权威实现 + 示例必须可复现）。
 */
export default {
  geffe: {
    what: "Geffe 生成器——P. R. Geffe 1973 提出的 LFSR 组合生成器：3 个独立 LFSR 的输出经非线性函数 f(x1,x2,x3)=x1·x2⊕x2·x3⊕x3 组合成 keystream，曾被认为「非线性=安全」，但 Siegenthaler 1984 指出 f 与 x1/x3 有 3/4 相关性，可用相关攻击逐 LFSR 穷举恢复——CTF crypto 流密码高频考点。",
    principle:
      "LFSR（线性反馈移位寄存器）用反馈多项式 `x^L+...+1` 递推生成周期比特序列，初态 = 前 L 个比特。Fibonacci LFSR 递推：`s[n] = Σ s[n-t] (mod 2)`，t 取自抽头位置集合。如抽头 `[1,4]` = 多项式 `x^4+x+1`，级数 L=4。\n\n" +
      "Geffe 组合：3 个 LFSR 同步输出，组合函数 `f(x1,x2,x3) = x1·x2 ⊕ x2·x3 ⊕ x3`。等价地：x2=0 时 f=x3，x2=1 时 f=x1——x2 是「选择器」，把 L1 或 L3 的比特送到输出。\n\n" +
      "相关性漏洞：因 x2 是选择器，f 与 x1 的相关性 `P(f=x1) = P(x2=1) + P(x2=0)·P(x3=x1) = 1/2 + 1/2·1/2 = 3/4`，同理 `P(f=x3)=3/4`，而 `P(f=x2)=1/2`（x2 无线性相关性）。这是 Geffe 致命弱点——3/4 ≫ 1/2，统计可区分。\n\n" +
      "相关攻击（correlation attack）：对 LFSR1 穷举全部 2^L1 个初态，每个生成 N bit 序列与 keystream 按位比对。正确初态匹配率 ≈0.75，错误初态 ≈0.5（独立随机），N 足够大时统计区分明显。LFSR3 同理。LFSR2 因 P=0.5 无线性相关性，须穷举全部 2^L2 个初态，用已恢复的 L1/L3 生成完整 keystream 验证（bruteL2）。\n\n" +
      "复杂度对比：直接穷举 Geffe = `2^(L1+L2+L3)`；相关攻击 = `2^L1 + 2^L3 + 2^L2`（L2 部分）——指数级降低。如 L1=L2=L3=20，直接穷举 2^60 不可行，相关攻击 2^20+2^20+2^20≈3M 秒级。",
    usage:
      "选模式：generate（已知 3 LFSR 抽头+初态 → 生成 keystream，构造测试用）/ attack（已知 keystream+3 抽头 → 恢复 L1/L3 初态，可选穷举 L2）。\n\n" +
      "抽头格式：「1,4」或「1 4」或「x^4+x+1」，最高次 = 级数 L。初态填 bitstring（长度=L），如 L=4 填 0001；也支持 hex（0x..）。\n\n" +
      "attack 模式：把 keystream（0/1 串，容忍空格/换行/逗号）粘进输入框，3 个抽头参数照填，可选勾 bruteL2（L2 ≤ 22 时穷举+验证）。L>22 时穷举不可行（2^22≈4M），改用 `lfsrRecover`（Berlekamp-Massey）辅助。",
    examples: [
      {
        in: "",
        param: "mode=generate, lfsr1Taps=1,4 / lfsr2Taps=2,5 / lfsr3Taps=1,6, lfsr1Init=0001 / lfsr2Init=00001 / lfsr3Init=000001, length=40",
        out: "0000111110100010101111010100100001011010",
        desc: "3 个短 LFSR（L1=4 / L2=5 / L3=6 级）组合生成 40 bit keystream，组合函数 f=x1x2⊕x2x3⊕x3",
      },
      {
        in: "0000111110100010101111010100100001011010",
        param: "mode=attack, lfsr1Taps=1,4 / lfsr2Taps=2,5 / lfsr3Taps=1,6, bruteL2=true",
        out: "L1=0001(rate=0.8000)  L3=000001(rate=0.7250)  L2=00001(穷举命中)",
        desc: "40 bit keystream 即可成功恢复 3 个初态。L1/L3 用相关攻击（rate≈0.75），L2 用穷举+L1/L3 验证",
      },
    ],
    tips: [
      "CTF 流密码题给一段长 0/1 串 + 3 个反馈多项式（如 x^4+x+1 / x^5+x^2+1 / x^6+x+1），多半就是 Geffe——3 个 LFSR + 选择器结构是它的指纹。",
      "keystream 越长越准：统计区分 0.75 vs 0.5 需要足够样本，建议 N ≥ 10×max(L1,L3)。N=30 可能恢复错（短样本噪声），N≥40 通常稳定。",
      "LFSR2 P=0.5 无法用相关攻击直接恢复——必须勾 bruteL2 穷举+L1/L3 验证，或对 keystream 直接跑 lfsrRecover（Berlekamp-Massey）求等效 LFSR。",
      "级数 L>22 时 2^L 穷举不可行（2^22≈4M），需用代数攻击（Grobner 基 / BM + 已知明文）——本工具会显式提示「L 过大」。",
      "组合函数 f=x1x2⊕x2x3⊕x3 等价于「x2 是选择器」：x2=0 输出 x3，x2=1 输出 x1。看到这种结构立刻想到 Geffe。",
      "相关攻击思想可推广：任何 LFSR 组合生成器只要组合函数与某输入有 P>1/2 的相关性，都可逐 LFSR 穷举恢复（Siegenthaler 1984）。",
    ],
    aka: [
      "Geffe生成器", "Geffe generator", "Geffe 相关攻击", "correlation attack",
      "相关攻击", "LFSR组合生成器", "组合生成器", "非线性组合生成器",
      "Geffe 1973", "Siegenthaler", "P=3/4", "选择器函数",
      "流密码攻击", "LFSR攻击", "CTF crypto", "Geffe cipher",
      "stream cipher attack", "LFSR correlation",
    ],
  },
};
