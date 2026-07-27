/*
 * edu-exe.js — exe/pyc 类工具科普补缺分片（T318）。
 *
 * 覆盖 1 个真实缺失 op 的科普卡：
 * analysis: pycExeDecompile
 *
 * 核查删除（已覆盖，不重复建）：
 * - sevenZipExtract — 已在 edu-batch6.js（已 import）覆盖
 * - exeBridge — 已在 edu-batch5-stego.js（已 import）覆盖
 *
 * 纯数据无副作用，无 import 无 register。M 在 eduContent.js 归并。
 * EduEntry 格式照 eduContent.js 头注释契约。
 */
export default {
  pycExeDecompile: {
    what: "pyc/exe 反编译——把 Python 编译后的 .pyc 字节码或 PyInstaller 打包的 .exe 还原成可读的 .py 源码。仅 Windows 可用。",
    principle:
      "Python 运行时跑的是 .pyc 字节码（CPython 解释器编译产物）。.pyc 文件头有 4 字节 magic number 标记 Python 版本（如 `42 0d 0d 0a` 是 3.8），用 xdis 查 magic 定版本后选对应反编器：3.4-3.8 走 `uncompyle6`/`decompyle3`，3.9+ 字节码改架构老工具不支持，走 `pylingual` 实验链路。\n\n" +
      "PyInstaller 打包的 .exe 本质是个自解压容器（PIA archive），先用 PyInstxtractor 解包出里面一堆 .pyc，再逐个反编。\n\n" +
      "本工具不直接在浏览器跑反编（那是 Python 生态的事），而是走本地桥 `bridge.py`（端口 8181）：前端把文件读成 base64 → POST 给桥 → 桥调本地 Python 工具链反编 → 返源码。零外发，样本不离开本机。",
    usage: "先在本地起桥 `python bridge.py`（仅 Windows）。然后拖入 .pyc 或 PyInstaller .exe 文件（或贴 base64），选类型（自动/pyc/exe，默认自动按文件头判定），点运行等反编结果。桥不可用时返回明确提示，不抛错。",
    examples: [
      { in: "(.pyc 文件的 base64)", out: "[input · via uncompyle6]\n# Decompiled source\ndef hello():\n    print('Hello')", desc: "pyc 反编为 Python 源码" },
      { in: "(PyInstaller .exe 的 base64)", out: "[input · via PyInstxtractor + decompyle3]\n# Extracted from exe archive\nimport os\nprint(os.getcwd())", desc: "exe 解包后逐 pyc 反编" },
    ],
    tips: [
      "仅 Windows + 需先起本地桥 `python bridge.py`，非 Windows 或桥没起会明确提示，不会白屏。",
      "Python 3.9+ 的字节码架构变了，uncompyle6 不支持，走 pylingual 实验链路（需手动装）。",
      "PyInstaller exe 先解包再反编，exe 里通常有多个 .pyc，逐个反编找主线逻辑。",
      "零外发：文件只在 localhost:8181 本地桥处理，不上传任何远端。",
    ],
    aka: ["pyc反编译", "pyc decompile", "exe反编", "pyinstaller extract", "python decompile", "uncompyle6", "decompyle3", "pyinstxtractor", "字节码反编译", "Python反编译", "pyc逆向", "exe逆向", "PyInstaller解包"],
  },
};
