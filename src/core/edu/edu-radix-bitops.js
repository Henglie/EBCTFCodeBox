// 科普内容分片：radix 位运算 5 项。纯数据，无 import 无副作用。
// bitReverse/bitRotate/byteSwap/grayCodeBytes/bitPlaneExtract
export default {
  bitReverse: {
    what: "把每个字节的 8 个比特左右镜像翻转（第 0 位换到第 7 位，1 换 6……）。做两次会还原，所以是自逆变换。",
    principle:
      "对每字节做位镜像：`bit i` 移到 `bit 7-i`。实现上用分治交换（先换高低 4 位，再 2 位，再 1 位）。\n\n" +
      "文本先转 UTF-8 字节再逐字节翻转，输出成 Hex；解码把 Hex 转字节再翻一次即还原。",
    usage: "encode 把文本转成翻转后的 Hex，decode 把 Hex 翻回文本。无参数。",
    examples: [
      { in: "A", out: "82", desc: "'A'=0x41=01000001 → 10000010=0x82" },
      { in: "82", param: "解码", out: "A" },
    ],
    tips: ["某些串口/LSB-first 协议按低位在前发送，位反转能纠正这种「字节内位序颠倒」。", "自逆：编码解码是同一个操作，解不出来时试试反过来当编码。"],
    aka: ["位反转", "bit reverse", "位镜像", "字节内翻转", "bit mirror", "比特反转", "bit reversal", "位序反转", "反转位", "reverse bits", "bit flip镜像", "位倒序"],
  },

  bitRotate: {
    what: "把每个字节内的 8 位循环移位（移出去的位从另一头补回来），可左可右、移 1-7 位。encode 移、decode 反向移还原。",
    principle:
      "循环左移 n 位：`(b << n) | (b >> (8-n))` 再取低 8 位；循环右移反之。位不会丢，只是绕圈。\n\n" +
      "文本转 UTF-8 字节后逐字节旋转，输出 Hex。decode 用相反方向旋转同样位数。",
    usage: "选方向（左/右）和位数（1-7），encode 正向旋转，decode 反向旋转还原。文本↔Hex。",
    examples: [
      { in: "A", param: "左移 1 位", out: "82", desc: "01000001 循环左移1 →10000010" },
      { in: "82", param: "左移 1 位, 解码", out: "A" },
    ],
    tips: ["和普通移位区别：循环移位不丢比特，可逆。普通 `<<` 会把高位挤掉。", "ROL/ROR 是汇编常见指令，逆向题里数据混淆常用它。"],
    aka: ["位循环移位", "bit rotate", "循环移位", "rol", "ror", "位旋转", "循环左移", "循环右移", "bit rotation", "rotate left right", "字节内循环移位", "比特旋转"],
  },

  byteSwap: {
    what: "按 2/4/8 字节一组，把组内字节顺序整个倒过来。就是大端小端（字节序）互转。同组大小做两次会还原。",
    principle:
      "把字节流按组切分，每组内首尾字节对调（`0↔n-1, 1↔n-2`……）。2 字节组=16 位端序转换，4 字节=32 位，8 字节=64 位。\n\n" +
      "文本转 UTF-8 字节后分组反转，输出 Hex。",
    usage: "选分组字节数（2/4/8），encode 把文本转成字节序反转的 Hex，decode 同样操作即还原（自逆）。",
    examples: [
      { in: "AB", param: "2 字节组", out: "4241", desc: "41 42 → 42 41" },
      { in: "4241", param: "2 字节组, 解码", out: "AB" },
    ],
    tips: ["逆向里看到 `0x78563412` 这种「倒着的」十六进制数，多半是小端存储，用它转回 `0x12345678`。", "网络字节序是大端，x86 内存是小端，抓包/dump 对不上时试试它。"],
    aka: ["字节序反转", "byte swap", "大小端转换", "endian", "端序转换", "字节交换", "byte order swap", "大端小端", "big endian little endian", "字节反序", "bswap", "字节序转换"],
  },

  grayCodeBytes: {
    what: "对每个字节独立做格雷码变换（$g = b \\oplus (b\\gg1)$）。和数值级 grayNum 不同，这个是逐字节处理字节流。",
    principle:
      "逐字节：`g = b ^ (b>>1)` 编码；解码逐位向下异或累积（`g ^= g>>1; g ^= g>>2; g ^= g>>4`）还原。\n\n" +
      "文本转 UTF-8 字节后逐字节做，输出 Gray Hex。",
    usage: "encode 把文本转成逐字节格雷码 Hex，decode 反向。无参数。",
    examples: [
      { in: "A", out: "61", desc: "0x41=01000001 → 01100001=0x61" },
      { in: "61", param: "解码", out: "A" },
    ],
    tips: ["和 grayNum 区分：grayNum 把整个十进制数当一个整数，这个是对每个字节独立做，面向字节数据。", "图像/信号数据有时按字节做格雷码降低相邻噪声，逆向数据流时留意。"],
    aka: ["字节级格雷码", "gray code bytes", "逐字节格雷码", "字节格雷"],
  },

  bitPlaneExtract: {
    what: "从每个字节抽出指定的那一位（第 k 位），把所有字节的这一位拼成一个比特串。是有损的单向操作。",
    principle:
      "位平面：把数据的第 k 位（k=0 是最低位 LSB，7 是最高位 MSB）单独抽出来排成一串。默认输出全部 8 个位平面。\n\n" +
      "因为只取一位、丢掉其余 7 位，无法还原，故为单向。",
    usage: "选位平面（0-7 或全部），run 输出该位组成的比特串。图像 LSB 隐写分析的雏形。",
    examples: [
      { in: "Hi", param: "全部", out: "位 7 (MSB): 00\n位 0 (LSB): 01", desc: "H=0x48,i=0x69 各取第7位/第0位（节选）" },
    ],
    tips: ["图像隐写常把信息藏在像素的最低位（LSB），抽 bit 0 位平面能暴露隐藏图案。", "对文本字节抽 MSB 全 0，说明是纯 ASCII（每字节 <128）。"],
    aka: ["位平面提取", "bit plane", "位平面", "lsb平面", "比特平面", "bit plane extraction", "位平面分离", "lsb位平面", "图像位平面", "bit plane slicing", "msb位平面", "比特平面提取"],
  },
};
