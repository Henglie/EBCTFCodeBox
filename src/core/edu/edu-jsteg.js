/*
 * edu-jsteg.js — jsteg JPEG 隐写科普卡（T390/T391 配套）。
 * 格式契约见 eduContent.js 头注释：纯数据、无 import、无副作用。
 * aka 均 ≥10 条真实别名（_alias_verify 三件套红线）。
 */
export default {
  jsteg: {
    what: "jsteg 是最经典的 JPEG 频域 LSB 隐写：把消息逐位写进 DCT 量化系数的最低位，Encode 产出一张外观不变的 jpg，Decode 顺序读回系数 LSB 还原消息。本工具箱为编/解双向，产物兼容原版 jsteg CLI（jsteg reveal 直接可解）。",
    principle:
      "JPEG 压缩把 8×8 块做 DCT 再量化，得到大量绝对值很小（±1、±2、±3…）的系数——改这些整数的最低位，肉眼与统计直方图几乎无感，这就是频域 LSB。\n\n" +
      "jsteg 的规范口径（经学术文献、CTF 事实标准 lukechampine/jsteg 源码、本工具箱 stegdetect 检测口径三处交叉查证）：\n" +
      "① 顺序遍历：从扫描数据的第 1 个系数开始按流序嵌，不支持随机位选择——这也正是它被卡方攻击（Westfeld/Pfitzmann 1999）钉死的根因；\n" +
      "② 跳过 0 值系数：0 是 JPEG 直方图的绝对主力，动它图像立刻劣化；\n" +
      "③ 1 与 -1 之间禁止翻转、也不许翻成 0：实用口径为 $|c| \le 1$ 的系数一律不作载体（lukechampine/jsteg 源码 ac<-1||ac>1），幅值 LSB、符号不变——2↔3、-2↔-3、-5↔-4，值对 (2i,2i+1) 内翻转，避免产生 0 破坏 run-length 结构；\n" +
      "④ 封装：\"jsteg\" 魔数 5 字节 + 4 字节小端长度 + 消息体（与原版 CLI 逐字节一致）。\n\n" +
      "嵌入实现要点：不是改像素，而是「解出 DCT 系数 → 改系数 LSB → 重新 Huffman 编码回写扫描数据」——APPn/DQT/DHT 等标记段原样保留，图像尺寸画质不变。",
    usage:
      "encode：拖入基线 JPEG 作载体，输入框（或参数 message）填要隐藏的文本；输出 jsteg.jpg 下载。报告给出容量（载体位数）、填充率。\n" +
      "decode：拖入疑似 jsteg 隐写的 JPEG，直接提取——无密钥、无密码，谁都能解（这既是 jsteg 的易用性也是它的弱点）。同时给出 hex/UTF-8/flag 命中。\n" +
      "仅支持基线 Baseline 单扫描 JPEG；渐进式（Photoshop「连续」、部分手机直出）会明确报错。",
    examples: [
      {
        in: "flag{hl_jsteg_OK_中文测试}",
        param: "拖入一张 ≥200×200 的普通 JPG 照片",
        out: "产物 jsteg.jpg（外观与原图一致）\n容量 38608 位 · 已用 312 位",
        desc: "encode 档：中文按 UTF-8 字节嵌入，封装头 9 字节（魔数+长度）",
      },
      {
        in: "（拖入上一步的 jsteg.jpg）",
        param: "无需参数",
        out: "封装: \"jsteg\" 魔数 + LE32 长度\nUTF-8 解读: flag{hl_jsteg_OK_中文测试}",
        desc: "decode 档：顺序读 LSB 即还原；与 jsteg CLI 双向兼容",
      },
    ],
    tips: [
      "载体位容量 ≈ 图里 $|c| \\ge 2$ 的 AC 系数个数，经验值约文件大小的 10%~14%——小图/高压缩图（大量 0 和 ±1）容量骤减，嵌入超长消息会报「容量不足」。",
      "jsteg 顺序嵌入是它的死穴：stegdetect 的卡方攻击专打它（PoV 对 (2i,2i+1) 计数被嵌平、累计曲线前高后跌）。CTF 里拿到 jpg 先丢 stegdetect，若「检出：疑似 LSB 顺序嵌入」，八成就是 jsteg。",
      "与 F5 的核心区别：F5 用矩阵编码+置换且系数只减不增（卡方盲区），jsteg 是裸 LSB+顺序（卡方必中）；解出后若发现是 F5 特征（直方收缩、0 增多），换 F5 提取档并需要密钥。",
      "兼容性口径：本工具与 lukechampine/jsteg（Go，Aperi'Solve 等平台内置）双向兼容；原版 C jsteg 文献口径为跳过 {0,1}，实用工具链统一为跳过 $|c| \le 1$——两者对 ±1 的处理不同，极端样本可能对不上。",
      "载图被二次压缩/缩放/转存会直接毁掉载荷（系数全变）——CTF 交付时用原图文件，别截图。",
      "渐进式 JPEG 系数分多次扫描（Ss/Se 分段），顺序模型不成立，本工具明确拒绝；先另存为基线再操作。",
    ],
    aka: ["jsteg", "jsteg 隐写", "JSteg", "jsteg hide", "jsteg reveal", "jsteg-go", "lukechampine/jsteg", "JPEG LSB 隐写", "DCT 系数 LSB 隐写", "jsteg 工具", "jsteg 嵌入", "jsteg 提取", "JPEG 频域隐写", "jsteg 命令行", "stegdetect jsteg"],
  },
};
