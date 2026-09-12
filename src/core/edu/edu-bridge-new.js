/*
 * edu-bridge-new.js — 本地桥/exe 桥接类 op 的科普数据分片（纯数据，无副作用）。
 *
 * 覆盖 15 个「调本机 exe / 启动本机 GUI」的桥接 op。这些 op 本质是外部工具的包装：
 * - GUI 型（*Launch）：只调 bridge /api/launch 拉起本机 exe，用户在弹窗里手动操作
 * 工具箱不代喂输入、不代取结果。
 * - CLI 型（*Bridge / *Exe）：调 bridge /api/run 无人值守执行，文件走 {占位符} 传入。
 * 共同前提：仅 Windows、需先在本机跑 python bridge.py（监听 localhost:8181）
 * 桥未起 / 非 Win 时 op 返回友好提示、不抛错。零外发（只连 localhost）。
 *
 * 本文件只导出数据，由主控 eduContent.js 接线，无 import / register。
 */
export default {
 // ============================================================
 // GUI 启动器（bridgeStego）
 // ============================================================
  watermarkhLaunch: {
    what: "启动本机的 watermarkH 图像水印隐写工具（吾爱破解出品）的一个按钮。",
    principle:
      "watermarkH 是一款把文字/图片当作水印藏进载体图像、或从图像里提取水印的国产 GUI 隐写工具，" +
      "在吾爱破解论坛流传，CTF 图片 misc 题里常见。\n\n" +
      "本 op 不做任何图像处理：它只通过本地桥 bridge.py 的 /api/launch 接口把本机的 watermarkH.exe 拉起来，" +
      "真正的藏/取操作全在弹出的程序窗口里由你手动完成。",
    usage:
      "仅 Windows。先在本机运行 python bridge.py（监听 localhost:8181），刷新本页后点击本功能即可拉起 watermarkH 窗口。" +
      "这是纯 GUI 启动器：工具箱不接收输入、也不返回结果，所有隐写操作请在弹出的 watermarkH 窗口里手动做。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：watermarkH · 水印\n路径：...\n请在弹出的程序窗口里手动操作。",
        desc: "点击后桥拉起 watermarkH.exe，其余在原生窗口操作。",
      },
    ],
    tips: [
      "拿到一张可疑图片先用它试试有没有隐藏水印，很多国产 misc 题就靠它。",
      "桥没起会返回「本地桥未就绪」，先确认 python bridge.py 在跑、且是 Windows。",
    ],
    aka: [
      "watermarkH", "watermark", "图像水印", "图片水印", "水印隐写", "吾爱破解", "52pojie",
      "图片隐写", "watermarkH.exe", "image watermark", "steganography", "misc 隐写",
    ],
  },

  jphswinLaunch: {
    what: "启动本机的 JPHS for Windows（jphide/jpseek），把数据藏进 JPEG 或从中取出。",
    principle:
      "JPHS = JP Hide and Seek，由 Allan Latham 编写。jphide 把数据嵌入 JPEG 的 DCT 系数、" +
      "jpseek 反向提取，都是密码保护的经典 JPEG 隐写对。JPHSwin 是它的 Windows 图形版。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 JPHSwin.exe，藏/取由你在窗口里点。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 JPHSwin 窗口后，在里面 Open jpeg → Hide/Seek，" +
      "输入密码手动完成。纯 GUI 启动器，工具箱不代喂输入取结果。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：JPHS · JPEG 隐写\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 JPHSwin，在原生窗口做 jphide/jpseek。",
      },
    ],
    tips: [
      "stegdetect 报 jphide(*) 时，就用 JPHS 的 jpseek 配密码提取。",
      "jphide 只吃 JPEG，其它格式无效。",
    ],
    aka: [
      "JPHS", "JPHSwin", "jphide", "jpseek", "JP Hide and Seek", "JPEG 隐写",
      "DCT 隐写", "Allan Latham", "JPHS for Windows", "图像隐写", "jphide and seek", "misc",
    ],
  },

  openpuffLaunch: {
    what: "启动本机的 OpenPuff 多载体隐写工具（图/音/视/PDF/flash 等），支持多层密码。",
    principle:
      "OpenPuff 是 Cosimo Oliboni 的免费专业级隐写工具，可把数据分散嵌入多种载体（BMP/JPG/PNG/MP3/WAV/" +
      "MP4/PDF/SWF 等），支持三层密码、去重、伪装（decoy）等高级特性，抗检测能力较强。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 OpenPuff.exe，隐写/提取在窗口里手动做。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 OpenPuff 窗口后，Hide/Unhide 选载体、填三层密码手动操作。" +
      "纯 GUI 启动器，工具箱不代喂输入取结果。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：OpenPuff · 多载体\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 OpenPuff，多载体隐写在原生窗口完成。",
      },
    ],
    tips: [
      "题目给多个同类文件 + 提示多层密码时，优先怀疑 OpenPuff。",
      "三层密码全对才能取出，缺一不可；注意载体顺序也可能是密钥的一部分。",
    ],
    aka: [
      "OpenPuff", "openpuff", "多载体隐写", "Cosimo Oliboni", "carrier chain",
      "多层密码", "steganography", "隐写", "decoy", "OpenPuff.exe", "professional steganography", "misc 隐写",
    ],
  },

  oursecretLaunch: {
    what: "启动本机的 OurSecret GUI 隐写工具（私有格式，无法纯前端复刻）。",
    principle:
      "OurSecret（有时写作 Our Secret）是一款把文件/文本用密码加密后藏进图片或声音文件的 GUI 隐写工具，" +
      "采用私有嵌入格式，CTF 里若给出 .ourse 或提示 OurSecret 即用它提取。\n\n" +
      "本 op 只调桥的 /api/launch 拉起 OurSecret.exe，藏/取在窗口里手动做。",
    usage:
      "仅 Windows，需先起 python bridge.py。点击拉起 OurSecret 窗口后，选载体、填密码 Hide/Unhide 手动操作。" +
      "纯 GUI 启动器，工具箱不代喂输入取结果；因格式私有无法用其它工具替代。",
    examples: [
      {
        in: "（无输入，直接点击）",
        out: "● 已启动本机 exe：OurSecret · 隐写\n路径：...\n请在弹出的窗口里手动操作。",
        desc: "拉起 OurSecret，在原生窗口做私有格式提取。",
      },
    ],
    tips: [
      "题目明确点名 OurSecret 或载体用其它隐写工具都测不出时，试它。",
      "密码常藏在题目描述/图片 exif/附件里，逐一试。",
    ],
    aka: [
      "OurSecret", "Our Secret", "oursecret", "我们的秘密", "私有格式隐写", "图片隐写", "音频隐写",
      "密码隐写", "steganography", "隐写工具", "OurSecret.exe", "hide data", "misc",
    ],
  },};
