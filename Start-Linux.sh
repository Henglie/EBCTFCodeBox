#!/bin/sh
# 恒烈 CTF 编码工具箱 - Linux 双击启动（KDE 直接双击；GNOME 右键选"运行"或在文件管理器设置允许启动）
cd "$(dirname "$0")" || exit 1
exec ./bin/launcher-linux
