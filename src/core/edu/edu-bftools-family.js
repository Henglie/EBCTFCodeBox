/*
 * edu-bftools-family.js — bftools 图像变体科普卡（T389：Brainloller / Braincopter 编解码）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  brainlollerDecode: {
    what: "把 Brainloller 图片（用像素颜色画出来的 Brainfuck 程序）还原成 BF 源码——图像里每个色块就是一条 BF 指令。",
    principle:
      "Brainloller 用 10 种颜色承载信息：8 种指令色（红/深红=><，纯绿/深绿=+-，黄/深黄=[]，蓝/深蓝=.,）+ 黑色起点 + firebrick 终止色，左右边缘还有青色/深青「转向标记」让读取路径像蛇一样折行（偶行向右、奇行向左）。\n\n" +
      "解码 = 沿蛇形路径逐像素读色 → 查色表还原指令，遇到终止色即停。本工具按 bftools 实测色表实现（与社区老规范色值不同）。",
    usage: "把 Brainloller PNG 拖入输入框（或粘贴 dataURL），直接运行得到 BF 程序文本；勾选「执行」会顺带跑 BF 并给出运行输出（如 Hello World）。",
    examples: [
      { in: "一张 Brainloller PNG（bftools encode 生成）", param: "exec=false", out: "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+…（BF 源码）", desc: "即 bftools decode brainloller 的输出口径" },
    ],
    tips: [
      "CTF 里看到「一张颜色很纯的 PNG + 题目提示 Brainfuck」八成就是 Brainloller/Braincopter——先看图是不是只有少数几种纯色。",
      "左/右边缘的青色像素不是指令，是转向标记，工具会自动跳过。",
      "得到 BF 源码后想看输出：勾选「执行」或把源码粘到 Brainfuck 解码 op。",
      "若图来自社区老工具且解出乱码，可能是非 bftools 色表版本——对照指令色顺序手动判断。",
    ],
    aka: ["Brainloller 解码", "brainloller", "BF 图像解码", "brainloller 转 brainfuck", "bftools brainloller", "BF 彩虹图", "brainloller image", "brainfuck 图像", "Brainloller 提取", "图像 BF 程序", "brainloller decode", "像素 brainfuck", "BF 蛇形图", "brainloller 图片还原"],
  },
  brainlollerEncode: {
    what: "把 Brainfuck 程序画成 Brainloller PNG——每个像素一种颜色代表一条指令，图像本身就是可执行程序。",
    principle:
      "按蛇形路径逐格放指令色：起点 (0,0) 固定黑，每行容量 = 宽度−2（两端留给转向标记），行末/行首放青色转向标记折行，程序放完后剩余格全部填 firebrick 终止色。\n\n" +
      "宽度决定行容量：宽 16 时每行 14 条指令，程序越长图越高。",
    usage: "输入框填 BF 程序（自动忽略非指令字符），参数设宽度（默认 16），运行生成 PNG 下载。宽 16、程序 106 条指令 → 约 8 行高的图。",
    examples: [
      { in: "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.…", param: "width=16", out: "brainloller.png（16×8）", desc: "bftools decode 可无损还原原程序" },
    ],
    tips: [
      "宽度太小（如 4）图会又窄又长；太大则像素稀疏——CTF 出题常用 16 或 32。",
      "生成后可用 Brainloller 解码 op 回读验证（往返应逐字符一致）。",
      "图像颜色非常「纯」（无渐变无噪声）是 brainloller 的明显特征，隐写强度弱、重在趣味。",
    ],
    aka: ["Brainloller 编码", "brainloller encode", "BF 图像编码", "brainfuck 画图", "BF 转图像", "brainloller 生成", "bftools brainloller encode", "brainfuck image encode", "BF 程序转 PNG", "brainloller png", "图像化 brainfuck", "BF 彩色编码", "brainloller 图片生成", "像素化 BF"],
  },
  braincopterDecode: {
    what: "把 Braincopter 图片（把 BF 指令藏进普通彩色照片的隐写变体）还原成 BF 源码——载体可以是一张毫无破绽的照片。",
    principle:
      "Braincopter 按公式 $f = (-2R + 3G + B) \\bmod 11$ 从每个像素算出一个 0-10 的值：0-7 分别对应 > < + - . , [ ] 八条指令，8/9/10 是 nop/终止。\n\n" +
      "与 Brainloller 不同，它没有固定「指令色」——任何图像都能当载体（编码时微调像素让 f 落到目标值），肉眼完全看不出破绽。解码就是逐像素算 f 直到碰上终止值。",
    usage: "把 PNG 拖入输入框运行得到 BF 程序；勾选「执行」直接看运行输出。若图来自 bftools 编码且程序较长（超过一行容量），勾选「exe 长图容错」跳过中段填充续读。",
    examples: [
      { in: "一张看似普通照片的 PNG", param: "exec=true", out: "BF 程序 + 执行输出（如 flag）", desc: "照片里藏的不是像素色而是每个像素的 f 值序列" },
    ],
    tips: [
      "Braincopter 的载体是任意图片——图「好不好看」与是否藏码无关，判定依据只能靠上下文提示。",
      "解码提前断在很短的程序？八成是 bftools 长程序图，勾「exe 长图容错」再跑。",
      "得到 BF 源码后通常还要再跑一遍 Brainfuck 才是最终 flag——braincopter 只是第一层。",
      "f 公式里 R 的系数是 −2（不是 2），G 是 3——手算验证时别搞反。",
    ],
    aka: ["Braincopter 解码", "braincopter", "BF 照片隐写", "braincopter 转 brainfuck", "bftools braincopter", "braincopter image", "照片藏 BF", "braincopter decode", "图像 BF 隐写", "braincopter 提取", "照片 brainfuck", "braincopter 图片还原", "隐形 BF 图", "braincopter stego"],
  },
  braincopterEncode: {
    what: "把 Brainfuck 程序藏进一张普通纯色/彩色 PNG——每个像素按公式微调，图像肉眼与原图几乎无异。",
    principle:
      "对第 i 个像素，目标值 t = 指令值（0-7）或 10（终止）；当前 $f_0 = (-2R+3G+B) \\bmod 11$。取最小改动 $d \\in [-5,5]$ 使 $f_0 + d \\equiv t \\pmod{11}$，只微调 B 通道 d——每像素最多改 ±5，视觉不可见。\n\n" +
      "程序写完后填终止符到宽度整数倍（对齐 bftools 口径），其余像素保持原样。",
    usage: "输入框填 BF 程序，参数设载体宽/高与基色（默认 64×48、#804020），运行生成 PNG 下载。载体基色越中性，图像观感越自然。",
    examples: [
      { in: "++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.…", param: "width=64, height=48, baseColor=#804020", out: "braincopter.png（64×48）", desc: "用 Braincopter 解码 op 回读可无损还原（往返一致）" },
    ],
    tips: [
      "载体容量 = 宽×高 像素，一条指令一个像素——64×48 能藏约三千条指令，绰绰有余。",
      "本工具生成纯色载体；若有指定照片要藏，先用图像工具读出像素再行计算（后续版本可扩展文件载体）。",
      "生成后用解码 op 验证往返；再用 bftools decode 交叉验证更稳（短程序双向兼容）。",
      "终止符填充只占一行宽度以内——长程序需要更大载体或更高高度。",
    ],
    aka: ["Braincopter 编码", "braincopter encode", "BF 藏照片", "brainfuck 照片隐写", "BF 转照片", "braincopter 生成", "bftools braincopter encode", "brainfuck photo stego", "BF 程序藏图", "braincopter png", "照片化 brainfuck", "braincopter 载体", "隐形 BF 编码", "braincopter 写入"],
  },
};
