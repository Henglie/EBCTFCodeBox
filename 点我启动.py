#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
点我启动.py — 一键启动脚本（Python 版，只用标准库，跨平台）。

双击本脚本（或 `py 点我启动.py`）：
  1. 起一个本地静态服务器（默认 8180），用正确的 MIME 提供文件；
  2. 在同一进程的后台线程内拉起本地桥（bridge.py 的服务，固定 8181，仅 Windows）；
  3. 用系统默认浏览器打开工具箱。

为什么必须用服务器、不能直接双击 index.html（file://）：
  - 本项目是 ES module（<script type="module">），file:// 下会被 CORS 拦截。
  - WASM 计算层要求 http(s) 环境（.wasm 必须以 application/wasm 送出，
    浏览器才肯用流式编译加载）。
  - Web Worker（多线程并行）在 file:// 下同样受同源策略限制。

为什么桥走同进程后台线程、而非另起一个 cmd：
  - 用户只需双击一个脚本，静态服务 + 本地桥一起就绪，不弹第二个窗口。
  - 前端（envPanel.js / localBridge.js）硬编码连 localhost:8181，故桥端口
    固定 8181：若该端口已被占用（多半是已有桥在跑），静默跳过，不崩、不漂移。

零外发红线：桥只监听 127.0.0.1、只调白名单本地工具、绝不外发用户数据。

用法：
  py 点我启动.py            # 默认端口 8180，起服务 + 桥并自动开浏览器
  py 点我启动.py 9000       # 指定静态服务端口（桥仍固定 8181）
  py 点我启动.py --no-open  # 不自动开浏览器（远程/无头环境）
  py 点我启动.py --no-bridge# 不起本地桥（仅纯前端静态服务）
  py 点我启动.py --mcp-config# 打印各本地 AI 客户端的 MCP 接入配置（已填好本机绝对路径）
  py 点我启动.py --mcp       # 直接跑 MCP stdio server（供客户端拉起/手动调试）
"""

import sys
import os
import shutil
import threading
import webbrowser
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

# Windows 控制台默认 GBK，印中文/符号（⚠、·）会 UnicodeEncodeError。
# 无条件把 stdout/stderr 重配 UTF-8，文案原样不改。reconfigure 是 Python 3.7+。
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8")
    except Exception:
        pass  # 无 reconfigure（极旧 Python）或已是 utf-8：忽略

# MCP stdio server 入口（本地进程，供 Claude Code / Cursor / Trae / Codex 等本地 AI 接入）。
MCP_SERVER = os.path.join(ROOT, "mcp", "server.mjs")

# 本地桥固定端口。前端 envPanel.js / localBridge.js 硬编码连此端口，不可漂移。
BRIDGE_PORT = 8181


# 扩展名 → MIME。.js/.mjs 必须是 JS MIME，否则 ES module 被浏览器拒收；
# .wasm 必须 application/wasm，否则流式编译报错。
EXTRA_MIME = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".ttf": "font/ttf",
}


class Handler(SimpleHTTPRequestHandler):
    """静态文件处理器：修正 MIME + 可缓存重验（默认）/ 强制不缓存（--dev）。"""

    # HTTP/1.1 开 keep-alive：复用 TCP 连接，避免每个请求重连。
    # SimpleHTTPRequestHandler 静态文件已自动带正确 Content-Length，满足 1.1 要求。
    protocol_version = "HTTP/1.1"

    # 缓存策略开关：main() 按命令行 --dev 设置。
    #   False（默认）→ 只 no-cache，浏览器可吃 304 二次刷新秒开；
    #   True（--dev）→ no-store 强制每次全量重拉，供调试用。
    dev_mode = False

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in EXTRA_MIME:
            base = EXTRA_MIME[ext]
            if base.startswith("text/") or base == "application/json" or base == "image/svg+xml":
                return base + "; charset=utf-8"
            return base
        return super().guess_type(path)

    def end_headers(self):
        if self.dev_mode:
            # --dev：强制每次全量重拉，避免反复调试时浏览器复用旧缓存。
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        else:
            # 默认：只 no-cache（要求重验但允许命中 304），二次刷新大量 304 秒开。
            self.send_header("Cache-Control", "no-cache")
        # 跨源隔离头：启用 SharedArrayBuffer，供 Worker 池共享内存做高性能并行
        # （爆破 / 大文件分片）。不影响单文件本地使用。
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默访问日志，终端只留启动信息


def start_bridge_background(port=BRIDGE_PORT):
    """在后台 daemon 线程内起本地桥（复用 bridge.py 的 Handler，零新窗口）。

    端口固定 8181（前端硬编码）。若被占用（多半是已有桥在跑），静默跳过，不崩。
    daemon 线程随主进程退出而结束，无需手动清理。
    返回 True 表示已尝试启动，False 表示 bridge 模块不可用。
    """
    try:
        import bridge  # 同目录模块，顶层只有定义，main() 在 __main__ guard 下不执行
    except Exception as e:
        print("  本地桥模块加载失败，跳过（纯前端功能不受影响）：%s" % e)
        return False

    def _run():
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), bridge.BridgeHandler)
        except OSError:
            # 端口被占用：多半 8181 上已有桥在跑，直接复用，不再起第二个。
            return
        try:
            httpd.serve_forever()
        except Exception:
            pass  # 桥线程异常不应拖垮静态服务（前端会灰置桥相关功能）

    t = threading.Thread(target=_run, name="bridge", daemon=True)
    t.start()
    return True


def _find_node():
    """定位 node 可执行文件。PATH 优先；PATH 落空时扫常见安装路径兜底；找不到返回 None。

    某些启动上下文（双击 .py、精简 PATH 的服务进程）的 PATH 里没有 node，
    但机器其实装了。故 PATH 查不到时，再扫 Windows/类 Unix 的标准安装位置。
    """
    hit = shutil.which("node") or shutil.which("node.exe")
    if hit:
        return hit
    # PATH 落空：扫常见安装路径（Windows 官方安装器 / nvm / Program Files）。
    candidates = [
        r"C:\Program Files\nodejs\node.exe",
        r"C:\Program Files (x86)\nodejs\node.exe",
        "/usr/local/bin/node",
        "/usr/bin/node",
        "/opt/homebrew/bin/node",
    ]
    localappdata = os.environ.get("LOCALAPPDATA")
    if localappdata:
        # nvm-windows 默认把当前版本软链到 %LOCALAPPDATA%\nvm 或 Programs
        candidates.append(os.path.join(localappdata, "Programs", "nodejs", "node.exe"))
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None


def run_mcp_server():
    """--mcp：直接接管当前进程跑 MCP stdio server。

    MCP stdio 协议要求 stdin/stdout 直通承载 JSON-RPC。用 subprocess 拉起 node
    并继承本进程的 stdin/stdout/stderr（子进程直接读写同一对 fd，零额外管道、
    零 stdout 污染），跑完透传退出码。
    正常用法是 AI 客户端按 --mcp-config 的配置自行拉起 node，此模式仅供手动调试。

    为何不用 os.execv：Windows 上 execv 不给参数加引号，node 路径里的空格
    （C:\\Program Files\\nodejs\\node.exe）会被 C 运行时按空格重新拆分，导致
    node 拿到错误的脚本路径。subprocess 走 CreateProcess，参数引号正确。
    零外发红线：MCP server 是本地进程，纯 stdio，无网络出口。
    """
    import subprocess
    node = _find_node()
    if not node:
        print("未找到 node（MCP server 需 Node.js 18+）。请先装 Node 并加入 PATH。", file=sys.stderr)
        sys.exit(1)
    if not os.path.isfile(MCP_SERVER):
        print("未找到 MCP server：%s" % MCP_SERVER, file=sys.stderr)
        sys.exit(1)
    # 子进程继承本进程 stdin/stdout/stderr（不重定向即继承），满足 stdio 协议直通。
    try:
        proc = subprocess.run([node, MCP_SERVER])
        sys.exit(proc.returncode)
    except KeyboardInterrupt:
        sys.exit(0)


def print_mcp_config():
    """--mcp-config：打印各本地 AI 客户端的 MCP 接入配置（已填好本机绝对路径）。

    stdio MCP 由客户端自行拉起 node 子进程，用户无需常驻服务，只要把下面 JSON
    填进对应客户端配置即可。node 缺失只警告不阻断（用户可能在别处装）。
    """
    node = _find_node() or "node"
    server = MCP_SERVER
    if node == "node":
        print("⚠ 当前 PATH 未找到 node；下面配置用 \"node\"，请确认客户端环境能找到 Node.js 18+。")
        print("")
    # 各客户端配置结构一致（command + args），差别只在配置文件位置。
    block = (
        '{\n'
        '  "mcpServers": {\n'
        '    "ebctf-codebox": {\n'
        '      "command": %s,\n'
        '      "args": [%s]\n'
        '    }\n'
        '  }\n'
        '}'
    ) % (_json_str(node), _json_str(server))

    print("========== 恒烈CTF编码工具箱 · MCP 接入配置 ==========")
    print("")
    print("MCP 是本地 stdio 服务：AI 客户端按下面配置自行拉起 node 子进程，")
    print("纯本地、零外发、无网络出口。把对应 JSON 填进客户端配置即可。")
    print("")
    print("---- 通用配置（Claude Code / Cursor / Trae / Cline / Claude Desktop 通用）----")
    print(block)
    print("")
    print("各客户端配置文件位置：")
    print("  · Claude Code   : 项目根 .mcp.json，或 `claude mcp add ebctf-codebox -- %s %s`" % (node, server))
    print("  · Cursor        : 项目根 .cursor/mcp.json（或设置里 MCP 面板）")
    print("  · Trae          : MCP 设置面板，粘贴上面 mcpServers 块")
    print("  · Codex / Cline : 其 MCP 配置文件（settings），粘贴上面 mcpServers 块")
    print("  · Claude Desktop: claude_desktop_config.json")
    print("")
    print("自测（列出 6 个工具）：")
    print("  echo {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"tools/list\"} | %s %s" % (node, server))
    print("")


def _json_str(s):
    """把字符串转成合法 JSON 字符串字面量（处理 Windows 反斜杠等转义）。"""
    import json as _json
    return _json.dumps(s, ensure_ascii=False)


def main():
    args = sys.argv[1:]
    # MCP 模式：与静态服务/浏览器无关，优先处理后直接退出。
    if "--mcp" in args:
        run_mcp_server()
        return
    if "--mcp-config" in args:
        print_mcp_config()
        return
    no_open = "--no-open" in args
    no_bridge = "--no-bridge" in args
    dev_mode = "--dev" in args
    Handler.dev_mode = dev_mode
    port = 8180
    for a in args:
        if a.isdigit():
            port = int(a)
            break

    handler = functools.partial(Handler, directory=ROOT)

    # 端口被占用则自动 +1 重试（最多 20 次）。
    httpd = None
    for _ in range(20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
            break
        except OSError:
            port += 1
    if httpd is None:
        print("启动失败：找不到可用端口（8180~8199 都被占用）")
        sys.exit(1)

    # 静态服务就绪后，同进程后台线程拉起本地桥（固定 8181，仅 Windows 有实际能力）。
    bridge_started = False
    if not no_bridge:
        bridge_started = start_bridge_background()

    url = "http://localhost:%d/" % port
    print("")
    print("  恒烈CTF编码工具箱 已启动")
    print("  " + url)
    if bridge_started:
        print("  本地桥  http://localhost:%d/  （同进程后台线程，仅 Windows 可用）" % BRIDGE_PORT)
    elif no_bridge:
        print("  本地桥  已按 --no-bridge 跳过")
    print("")
    print("  按 Ctrl+C 停止。")
    print("")

    if not no_open:
        # 用系统默认浏览器打开（不再指定 Chrome/Edge）。
        try:
            webbrowser.open(url)
        except Exception:
            print("  自动打开失败，请手动在浏览器打开上面的地址。")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
        httpd.server_close()


if __name__ == "__main__":
    main()
