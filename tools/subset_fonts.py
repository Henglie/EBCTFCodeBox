#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
subset_fonts.py — 把天珩 Unicode 全字库（cheonhyeong.com）切成按 Unicode 区块的
                  woff2 分片，供前端配 @font-face + unicode-range 按需懒加载。

为什么要切片：
  天珩全字库覆盖全 Unicode 表意文字，完整 TTF 单档几百 MB。web 直接 @font-face
  全量加载 → 首屏拖几百 MB、长白屏，与「轻量化」冲突。切成按区块的分片后，浏览器
  只在页面实际出现某区块字符时才下载对应那一片（unicode-range 的原生能力），平时
  只加载「基本汉字」那片（几 MB），出现甲骨文/西夏文等冷僻字才拉对应分片。

前置：
  pip install fonttools brotli    # brotli 是 woff2 压缩必需
  下载天珩全字库 TTF，放到 <项目根>/public/fonts/source/ 下（改下方 SRC）。
  官网：http://cheonhyeong.com/index.html

用法：
  python tools/subset_fonts.py
产物：
  public/fonts/cheonhyeong-<slice>.woff2   （每个 Unicode 区块一片）
  同时打印生成的 @font-face unicode-range，可核对 src/ui/fonts.css。

注意：只用标准库 + fonttools。切片是构建期一次性动作，运行期零依赖。
"""

import os
import sys
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "public", "fonts", "source", "cheonhyeong.ttf")
OUT_DIR = os.path.join(ROOT, "public", "fonts")

# 按 Unicode 区块切片：(片名, 起, 止)。范围对齐前端 fonts.css 的 unicode-range。
# 越常用的排越前（basic 平时就加载，其余按需）。范围取自 Unicode 官方块定义。
SLICES = [
    # 片名                起始      结束     说明
    ("basic",        0x4E00,  0x9FFF),   # CJK 统一表意文字（最常用，默认加载）
    ("ext-a",        0x3400,  0x4DBF),   # 扩展 A
    ("ext-b",        0x20000, 0x2A6DF),  # 扩展 B（大，冷僻字主力）
    ("ext-cdef",     0x2A700, 0x2EBEF),  # 扩展 C/D/E/F
    ("ext-gh",       0x30000, 0x323AF),  # 扩展 G/H
    ("compat",       0xF900,  0xFAFF),   # CJK 兼容表意
    ("radicals",     0x2E80,  0x2FDF),   # 康熙/中日部首
    ("symbols",      0x3000,  0x303F),   # CJK 符号标点
    ("oracle",       0x13000, 0x1342F),  # 埃及圣书体 / 甲骨占位（如库含则出片）
    ("tangut",       0x17000, 0x18AFF),  # 西夏文 + 部件
    ("yijing",       0x4DC0,  0x4DFF),   # 易经六十四卦符号
    ("kanbun",       0x3190,  0x319F),   # 汉文训读标记
]


def unicode_range(start, end):
    """生成 CSS unicode-range 片段，如 U+4E00-9FFF。"""
    return "U+%X-%X" % (start, end)


def run_subset(start, end, out_path):
    """调 fonttools 的 pyftsubset 切一片 woff2。"""
    unicodes = "%X-%X" % (start, end)
    cmd = [
        sys.executable, "-m", "fontTools.subset", SRC,
        "--unicodes=" + unicodes,
        "--output-file=" + out_path,
        "--flavor=woff2",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        "--drop-tables+=DSIG",
    ]
    subprocess.run(cmd, check=True)


def main():
    if not os.path.exists(SRC):
        print("找不到源字体：%s" % SRC)
        print("请从 http://cheonhyeong.com 下载全字库 TTF，")
        print("重命名为 cheonhyeong.ttf 放到 public/fonts/source/ 下。")
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    print("切片中（每片只保留该 Unicode 区块的字形）...\n")

    faces = []
    for name, start, end in SLICES:
        out_path = os.path.join(OUT_DIR, "cheonhyeong-%s.woff2" % name)
        try:
            run_subset(start, end, out_path)
        except subprocess.CalledProcessError:
            print("  [跳过] %-10s 该区块可能不在字库内" % name)
            continue
        size = os.path.getsize(out_path) / 1024.0
        rng = unicode_range(start, end)
        print("  [出片] %-10s %8.1f KB  %s" % (name, size, rng))
        faces.append((name, rng))

    print("\n对照 src/ui/fonts.css 的 @font-face（unicode-range 应与下方一致）：\n")
    for name, rng in faces:
        print('@font-face{font-family:"Cheonhyeong";'
              'src:url("../../public/fonts/cheonhyeong-%s.woff2") format("woff2");'
              'unicode-range:%s;font-display:swap;}' % (name, rng))


if __name__ == "__main__":
    main()
