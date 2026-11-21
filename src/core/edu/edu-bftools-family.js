/*
 * edu-bftools-family.js — bftools 图像变体科普卡（Brainloller / Braincopter 双向）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * 单入口后每个算法只保留一张卡；旧 4 个 id 的科普归属合并到两张卡。
 */
export default {
  brainloller: {
    what: "Brainloller 用像素颜色直接画 Brainfuck 程序：每个像素就是一条 BF 指令，整张 PNG 本身就是可执行源码。",
    principle:
      "Brainloller 用 10 种颜色承载信息：8 种指令色（红/深红=><，纯绿/深绿=+-，黄/深黄=[]，蓝/深蓝=.,）+ 黑色起点 + firebrick 终止色；左右边缘还有青色/深青「转向标记」，让读取路径像蛇一样折行（偶行向右、奇行向左）。\n\n" +
      "方向切换：编码把 BF 程序按蛇形路径逐格放指令色，起点 (0,0) 固定黑，每行容量 = 宽度−2（两端留给转向标记），程序放完后剩余格全部填 firebrick 终止色；解码沿同一蛇形路径逐像素读色、查表还原指令，遇终止色即停。本工具按 bftools 实测色表实现（与社区老规范色值不同）。",
    usage: "编码：输入 BF 程序（自动忽略非指令字符），设图像宽度（默认 16，最小夹到 4），运行得到 brainloller.png。解码：把 PNG 拖入输入框，或粘贴 data:image/png;base64,… 旧 data URL，运行得到 BF 文本；exec 默认关闭，只有显式勾选才执行程序并附带运行输出。",
    examples: [
      { in: "+++.", param: "方向=编码，width=16", out: "brainloller.png（16×1）", desc: "四条指令占一行，默认宽 16 像素" },
      { in: "上一步生成的 brainloller.png", param: "方向=解码，exec=false", out: "+++.", desc: "只还原程序文本，不执行" },
    ],
    tips: [
      "少数纯色和转向标记可作为识别线索，不能仅凭颜色确定格式。",
      "左/右边缘的青色像素不是指令，是转向标记，工具会自动跳过。",
      "宽度太小（如 2）会夹到 4，图又窄又长；CTF 出题常用 16 或 32。",
      "得到 BF 源码后想看输出：显式勾选 exec，或把源码粘到 Brainfuck 解码 op；默认不执行是安全边界。",
      "若图来自社区老工具且解出乱码，可能是非 bftools 色表版本——对照指令色顺序手动判断。",
    ],
    aka: ["Brainloller", "Brainloller 编码", "Brainloller 解码", "brainloller", "BF 图像编码", "BF 图像解码", "brainloller 转 brainfuck", "brainfuck 画图", "bftools brainloller", "BF 彩虹图", "brainloller image", "像素 brainfuck", "BF 蛇形图", "brainloller png", "图像化 brainfuck", "brainloller encode", "brainloller decode"],
  },
  braincopter: {
    what: "Braincopter 把 Brainfuck 程序藏进一张普通彩色图片：不靠固定指令色，而是靠每个像素算出的 f 值承载指令，载体肉眼看不出破绽。",
    principle:
      "Braincopter 按公式 $f = (-2R + 3G + B) \\bmod 11$ 从每个像素算出一个 0-10 的值：0-7 分别对应 > < + - . , [ ] 八条指令，8/9/10 是 nop/终止。\n\n" +
      "编码：对第 i 个像素，目标值 t = 指令值（0-7）或 10（终止）；当前 $f_0 = (-2R+3G+B) \\bmod 11$。取最小绝对改动 $d \\in [-5,5]$ 使 $f_0 + d \\equiv t \\pmod{11}$，只微调 B 通道，每像素最多改 ±5，视觉不可见；程序写完后填终止符到宽度整数倍，其余像素保持载体原样。解码逐像素算 f，遇 nop/终止即停。",
    usage: "编码：输入 BF 程序，设载体宽/高与基色（默认 64×48、#804020），运行得到 braincopter.png；基色非法时回退 #804020。解码：拖入 PNG 或粘贴旧 data URL，得到 BF 文本；exec 默认关闭。若图来自 bftools 且程序较长，可显式勾选 allowGap 跳过一段 nop 续读。",
    examples: [
      { in: "+++++[>+++++<-]>.", param: "方向=编码，width=64, height=48, baseColor=#804020", out: "braincopter.png（64×48）", desc: "程序写入后其余像素保持基色，肉眼近似纯色图" },
      { in: "上一步生成的 braincopter.png", param: "方向=解码，exec=false", out: "+++++[>+++++<-]>.", desc: "往返逐字符一致；默认不执行程序" },
    ],
    tips: [
      "解码器可以读取已有 PNG；当前编码入口生成指定纯色载体。",
      "解码提前断在很短的程序？八成是 bftools 长程序图，显式勾 allowGap 再跑；该开关只影响解码方向。",
      "默认只还原源代码。仅在明确选择执行时才运行它。",
      "f 公式里 R 的系数是 −2（不是 2），G 是 3——手算验证时别搞反。",
      "编码宽度/高度过小会被夹到 4×2；容量 = 宽×高 像素，一条指令一个像素。",
    ],
    aka: ["Braincopter", "Braincopter 编码", "Braincopter 解码", "braincopter", "BF 照片隐写", "braincopter 转 brainfuck", "bftools braincopter", "braincopter image", "照片藏 BF", "图像 BF 隐写", "braincopter encode", "braincopter decode", "brainfuck photo stego", "BF 藏照片", "braincopter png", "隐形 BF 图", "braincopter stego"],
  },
};
