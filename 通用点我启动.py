#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
通用点我启动.py — 一键启动脚本（Python 版，只用标准库，跨平台）。

双击本脚本（或 `py 通用点我启动.py`）：
  1. 起一个本地静态服务器（默认 8180），用正确的 MIME 提供文件；
  2. 在同一进程的后台线程内拉起本地桥（bridge.py 的服务，固定 8181，仅 Windows）；
  3. 用系统默认浏览器打开工具箱；
  4. 进入**控制面板**：打开即已启动，之后可用编号指令重启服务、清除占用端口、看本地桥设置。

为什么必须用服务器、不能直接双击 index.html（file://）：
  - 本项目是 ES module（<script type="module">），file:// 下会被 CORS 拦截。
  - WASM 计算层要求 http(s) 环境（.wasm 必须以 application/wasm 送出，
    浏览器才肯用流式编译加载）。
  - Web Worker（多线程并行）在 file:// 下同样受同源策略限制。

为什么桥走同进程后台线程、而非另起一个 cmd：
  - 用户只需双击一个脚本，静态服务 + 本地桥一起就绪，不弹第二个窗口。
  - 前端（envPanel.js / localBridge.js）硬编码连 localhost:8181，故桥端口
    固定 8181：若该端口已被占用（多半是已有桥在跑），静默跳过，不崩、不漂移。

与控制面板的分工（与原生启动器 `原生启动器/` 保持同一套指令与文案）：
  - 本文件 = 通用版的平台实现；**指令、编号、文案与原生版逐条对齐**。
  - 平台特色差异如实标注，不假装一致：
      · 原生版（Windows）菜单可直接鼠标点击；本版是行式输入（输入序号回车）。
      · 本地桥的实现不同：本版是 Python 桥（bridge.py），原生版是 C 桥；两者的
        允许来源规则各自在报告里如实列出，不互相代替。

零外发红线：静态服务与桥都只监听 127.0.0.1、桥只调白名单本地工具、绝不外发用户数据。

用法：
  py 通用点我启动.py            # 默认端口 8180，起服务 + 桥并自动开浏览器，然后进控制面板
  py 通用点我启动.py 9000       # 指定静态服务端口（桥仍固定 8181）
  py 通用点我启动.py --no-open  # 不自动开浏览器（远程/无头环境）
  py 通用点我启动.py --no-bridge# 不起本地桥（仅纯前端静态服务）
  py 通用点我启动.py --no-panel # 不进控制面板（旧行为：打印信息后阻塞在服务上）
  py 通用点我启动.py --panel    # 强制进控制面板（stdin 非终端也可，供脚本/CI 驱动）
  py 通用点我启动.py --mcp-config# 打印各本地 AI 客户端的 MCP 接入配置（已填好本机绝对路径）
  py 通用点我启动.py --mcp       # 直接跑 MCP stdio server（供客户端拉起/手动调试）
"""

import sys
import os
import shutil
import signal
import subprocess
import threading
import webbrowser
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

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

# 端口清理时硬性拒绝的 PID：0/4 是 Windows 的 Idle/System，1 是 init。
FORBIDDEN_PIDS = (0, 1, 4)


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


# 静态服务拒绝清单：授权工程 / VCS 元数据 / 备份 / 私钥类文件永不外露。
# 只影响直接 HTTP 访问，不移动/删除任何文件；前端正常资源（src/public/addons/…）不受影响。
DENY_DIR_NAMES = frozenset({
    ".git", ".svn", ".hg", ".ssh", "授权", "备份", "backup", "backups",
})
DENY_FILE_PREFIXES = (
    "private_key", "private-key", "id_rsa", "id_dsa", "id_ecdsa", "id_ed25519",
    "keygen", "encrypt_key",
)
DENY_FILE_SUFFIXES = (".pem", ".key", ".pfx", ".p12", ".keystore")
DENY_FILE_EXACT = frozenset({"sign.mjs", "private_key.enc", "ebcrypto.config.json"})


class Handler(SimpleHTTPRequestHandler):
    """静态文件处理器：修正 MIME + 可缓存重验（默认）/ 强制不缓存（--dev）。"""

    # HTTP/1.1 开 keep-alive：复用 TCP 连接，避免每个请求重连。
    # SimpleHTTPRequestHandler 静态文件已自动带正确 Content-Length，满足 1.1 要求。
    protocol_version = "HTTP/1.1"

    # 缓存策略开关：main() 按命令行 --dev 设置。
    #   False（默认）→ 只 no-cache，浏览器可吃 304 二次刷新秒开；
    #   True（--dev）→ no-store 强制每次全量重拉，供调试用。
    dev_mode = False

    def _host_ok(self):
        """只接受本机 Host（localhost / 127.0.0.1 / ::1），防 DNS rebinding。"""
        host = self.headers.get("Host", "")
        if not host:
            return False
        try:
            hostname = (urlsplit("//" + host.strip()).hostname or "").lower()
        except ValueError:
            return False
        return hostname in ("localhost", "127.0.0.1", "::1")

    def _path_allowed(self, raw_path):
        """拒绝授权目录 / VCS 元数据 / 备份 / 私钥类文件（含多重百分号编码与反斜杠变体）。"""
        try:
            clean = urlsplit(raw_path).path
        except (ValueError, UnicodeError):
            return False
        # 反复解码直到稳定：SimpleHTTPRequestHandler 会再做一次 unquote，
        # 只解一层会让 %252egit / %25E6%258E%2588... 变成 .git / 授权 后绕过。
        for _ in range(5):
            try:
                decoded = unquote(clean)
            except (ValueError, UnicodeError):
                return False
            if decoded == clean:
                break
            clean = decoded
        else:
            return False  # 嵌套编码过深，直接拒绝
        if "\x00" in clean:
            return False
        parts = [p for p in clean.replace("\\", "/").split("/") if p not in ("", ".")]
        if any(p == ".." for p in parts):
            return False
        low = [p.lower() for p in parts]
        if any(p in DENY_DIR_NAMES for p in low):
            return False
        if not low:
            return True
        name = low[-1]
        if name in DENY_FILE_EXACT:
            return False
        if name.startswith(DENY_FILE_PREFIXES) or name.endswith(DENY_FILE_SUFFIXES):
            return False
        return True

    def send_head(self):
        if not self._host_ok():
            self.send_error(403, "Forbidden Host")
            return None
        if not self._path_allowed(self.path):
            self.send_error(404, "Not Found")
            return None
        return super().send_head()

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
        pass  # 静默访问日志，面板只留状态与指令


# ============================ 服务状态（可重启） ============================

class Service:
    """静态服务 + 本地桥的可重启持有者。

    控制面板的「重启服务」要能整段停掉再起，所以必须把 httpd 与线程都留在状态里，
    不能像旧实现那样就地阻塞在 serve_forever 上。
    """

    def __init__(self, preferred_port, bridge_enabled, no_open, dev, no_mcp=False):
        self.preferred_port = preferred_port
        self.bridge_enabled = bridge_enabled
        self.no_open = no_open
        self.dev = dev
        self.httpd = None
        self.thread = None
        self.port = 0
        self.bridge_ok = False
        self.bridge_httpd = None
        self.bridge_thread = None
        self.last_error = ""
        from runtime_services import McpService
        self.mcp = McpService(ROOT)
        self.no_mcp = no_mcp

    # ---- 静态服务 ----
    def stop_static(self):
        self.mcp.stop()
        if self.bridge_httpd is not None:
            try:
                self.bridge_httpd.shutdown()
                self.bridge_httpd.server_close()
            except Exception:
                pass
            self.bridge_httpd = None
            self.bridge_ok = False
        if self.httpd is not None:
            try:
                self.httpd.shutdown()
            except Exception:
                pass
            if self.thread is not None:
                self.thread.join(timeout=10)
            try:
                self.httpd.server_close()
            except Exception:
                pass
        self.httpd = None
        self.thread = None
        self.port = 0

    def start(self):
        """起静态服务（必要时 + 桥）。桥挂不上只记错误，静态服务照常可用 —— 与原生版同一口径。"""
        self.last_error = ""
        self.stop_static()
        Handler.dev_mode = self.dev
        handler = functools.partial(Handler, directory=ROOT)
        port = self.preferred_port
        httpd = None
        for _ in range(20):
            if port == BRIDGE_PORT:
                port += 1
                continue
            try:
                httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
                break
            except OSError:
                port += 1
        if httpd is None:
            self.last_error = "静态服务起不来：起始端口后 20 个端口都被占用"
            return False
        self.httpd = httpd
        self.port = httpd.server_address[1]
        self.thread = threading.Thread(target=httpd.serve_forever, name="static", daemon=True)
        self.thread.start()

        if self.bridge_enabled:
            try:
                import bridge
                origins = ("http://localhost:%d" % self.port, "http://127.0.0.1:%d" % self.port)
                self.bridge_httpd = bridge.create_extension_server(origins)
                self.bridge_thread = threading.Thread(
                    target=self.bridge_httpd.serve_forever, name="bridge", daemon=True)
                self.bridge_thread.start()
                self.bridge_ok = True
            except Exception as exc:
                self.bridge_httpd = None
                self.bridge_ok = False
                self.last_error = ("本地桥 %d 被占用或起不来：静态服务照常可用，桥未挂载"
                                   "（按 2 可清理占用端口）｜%s" % (BRIDGE_PORT, exc))
        mcp = self.mcp.start(not self.no_mcp)
        if mcp["state"] == "ready":
            print("  MCP HTTP  %s（%s）" % (mcp["url"], "token" if mcp["tokenRequired"] else "no token"))
        elif mcp["state"] == "unavailable":
            self.last_error = " | ".join(filter(None, (self.last_error, mcp.get("error", "MCP unavailable"))))
        return True

    def stop_all(self):
        self.stop_static()


# ============================ 端口占用者查询与清理 ============================

def _port_owner(port):
    """查监听指定端口的进程。

    返回 (pid, name, reason)：
      pid > 0  查到占用者（name 为可执行文件名，拿不到给 "?"）；
      pid == 0 端口空闲，或本平台查不到（reason 说明原因）。
    与控制面板的硬性拒绝条件配套：拿不到进程名时不建议动手。
    """
    if sys.platform == "win32":
        try:
            out = subprocess.run(["netstat", "-ano"], capture_output=True, text=True,
                                 timeout=15, errors="replace").stdout
        except Exception as exc:
            return 0, "", "读取本机 TCP 监听表失败：%s" % exc
        for line in out.splitlines():
            parts = line.split()
            if len(parts) < 4:
                continue
            if not parts[1].endswith(":%d" % port):
                continue
            if parts[0].upper() not in ("TCP",):
                continue
            if "LISTEN" not in parts[3].upper():
                continue
            pid_txt = parts[-1]
            if not pid_txt.isdigit():
                continue
            pid = int(pid_txt)
            if pid == 0:
                continue
            name = _windows_image_name(pid)
            return pid, name, ""
        return 0, "", "回环地址上未发现监听者"

    # POSIX：lsof 优先（Linux/macOS 通用），无 lsof 时退回 Linux 的 /proc
    lsof = shutil.which("lsof")
    if lsof:
        try:
            out = subprocess.run([lsof, "-nP", "-iTCP:%d" % port, "-sTCP:LISTEN", "-t"],
                                 capture_output=True, text=True, timeout=15,
                                 errors="replace").stdout
            for line in out.splitlines():
                line = line.strip()
                if line.isdigit():
                    pid = int(line)
                    return pid, _posix_comm(pid), ""
        except Exception:
            pass
    if os.path.isdir("/proc"):
        pid = _linux_pid_of_port(port)
        if pid:
            return pid, _posix_comm(pid), ""
        return 0, "", "回环地址上未发现监听者"
    return 0, "", "本平台无 /proc 且无 lsof，无法自动定位占用者（可手动执行 lsof -i :%d）" % port


def _windows_image_name(pid):
    try:
        out = subprocess.run(["tasklist", "/FI", "PID eq %d" % pid, "/FO", "CSV", "/NH"],
                             capture_output=True, text=True, timeout=15,
                             errors="replace").stdout.strip()
        if out.startswith('"'):
            return out.split('","')[0].strip('"') or "?"
    except Exception:
        pass
    return "?"


def _posix_comm(pid):
    try:
        with open("/proc/%d/comm" % pid, "r", encoding="utf-8", errors="replace") as fp:
            return fp.read().strip() or "?"
    except Exception:
        pass
    try:
        out = subprocess.run(["ps", "-p", str(pid), "-o", "comm="],
                             capture_output=True, text=True, timeout=10,
                             errors="replace").stdout.strip()
        if out:
            return os.path.basename(out.splitlines()[0]) or "?"
    except Exception:
        pass
    return "?"


def _linux_pid_of_port(port):
    """/proc/net/tcp(+tcp6) → inode → /proc/*/fd 找持有该 socket 的进程。"""
    needle = None
    for table in ("/proc/net/tcp", "/proc/net/tcp6"):
        try:
            with open(table, "r", encoding="utf-8", errors="replace") as fp:
                next(fp, None)
                for line in fp:
                    f = line.split()
                    if len(f) < 10 or f[3] != "0A":     # 0A = LISTEN
                        continue
                    try:
                        lport = int(f[1].split(":")[1], 16)
                    except Exception:
                        continue
                    if lport == port:
                        needle = "socket:[%s]" % f[9]
                        break
        except Exception:
            continue
        if needle:
            break
    if not needle:
        return 0
    try:
        for entry in os.listdir("/proc"):
            if not entry.isdigit():
                continue
            fddir = "/proc/%s/fd" % entry
            try:
                for fd in os.listdir(fddir):
                    try:
                        if os.readlink(os.path.join(fddir, fd)) == needle:
                            return int(entry)
                    except OSError:
                        continue
            except OSError:
                continue
    except Exception:
        pass
    return 0


def _terminate(pid):
    """结束进程。返回 (ok, reason)。与控制面板的硬性拒绝条件一致。"""
    if pid in FORBIDDEN_PIDS:
        return False, "拒绝结束系统进程（Idle/System/init）"
    if pid == os.getpid():
        return False, "拒绝结束启动器自身进程"
    try:
        os.kill(pid, signal.SIGTERM)
        return True, ""
    except Exception as exc:
        return False, "结束进程失败（权限不足或已退出）：%s" % exc


# ============================ 控制面板 ============================

MENU = (
    ("1", "重启服务"),
    ("2", "清除占用端口"),
    ("3", "本地桥设置"),
    ("4", "在浏览器中打开"),
    ("5", "刷新状态"),
    ("0", "退出"),
)


def _panel_status_lines(svc):
    if svc.httpd is not None and svc.port:
        static_txt = "http://127.0.0.1:%d/   [运行中]" % svc.port
    else:
        static_txt = "-                          [未运行]"
    if svc.bridge_ok:
        bridge_txt = "http://127.0.0.1:%d/   [运行中]" % BRIDGE_PORT
    elif not svc.bridge_enabled:
        bridge_txt = "-                          [已关闭]"
    else:
        bridge_txt = "-                          [未挂载]"
    return static_txt, bridge_txt


def _panel_render(svc):
    static_txt, bridge_txt = _panel_status_lines(svc)
    print("")
    print("=" * 69)
    print(" 恒烈CTF编码工具箱 · 启动器（Python 通用版）")
    print("=" * 69)
    print(" 静态服务 : %s" % static_txt)
    print(" 本地桥   : %s" % bridge_txt)
    print(" 项目根   : %s" % ROOT)
    if svc.last_error:
        print(" 最近错误 : %s" % svc.last_error)
    print("=" * 69)
    for key, label in MENU:
        print(" %s  %s" % (key, label))
    print("=" * 69)
    print(" 提示: 输入序号后回车。（Windows 原生版另支持鼠标点菜单行）")
    sys.stdout.flush()


def _ask(prompt, default=""):
    try:
        got = input(prompt).strip()
    except (EOFError, KeyboardInterrupt):
        return None
    return got if got else default


def _pause():
    try:
        input("\n 按回车返回菜单…")
    except (EOFError, KeyboardInterrupt):
        pass


def _panel_restart(svc):
    print("")
    print(" 正在启动…")
    if svc.start():
        print(" 已启动：静态服务 http://127.0.0.1:%d/" % svc.port)
        if svc.bridge_ok:
            print(" 本地桥  http://127.0.0.1:%d/ 已挂载" % BRIDGE_PORT)
        else:
            print(" 本地桥  未挂载")
    else:
        print(" 启动失败：")
        print("   %s" % svc.last_error)
        print(" 可先按 2 清除占用端口，再按 1 重试。")


def _panel_clear_port(svc):
    import time
    default_port = svc.port or BRIDGE_PORT
    print("")
    got = _ask(" 要清理哪个端口？（回车 = %d）: " % default_port, "")
    if got is None:
        return
    port = default_port
    if got:
        if not got.isdigit() or not (1 <= int(got) <= 65535):
            print(" 端口不合法。")
            _pause()
            return
        port = int(got)

    pid, name, reason = _port_owner(port)
    if pid <= 0:
        print(" 端口 %d：%s" % (port, reason or "未发现占用者"))
        if not reason:
            print(" 说明：该端口当前空闲，直接按 1 重启服务即可。")
        _pause()
        return
    print(" 端口 %d 被占用：%s (PID %d)" % (port, name, pid))
    answer = _ask(" 结束该进程？(y/N) ", "n")
    if answer is None:
        print("")
        print(" 已取消。")
        _pause()
        return
    if answer.lower() != "y":
        print(" 已取消，未做任何改动。")
        _pause()
        return

    ok, why = _terminate(pid)
    if not ok:
        print(" 未能结束：%s" % why)
        _pause()
        return
    print(" 已发出结束请求，复查端口…")
    for _ in range(20):
        pid2, name2, _r = _port_owner(port)
        if pid2 <= 0:
            break
        time.sleep(0.1)
    pid2, name2, _r = _port_owner(port)
    if pid2 > 0:
        print(" 端口 %d 仍被 %s (PID %d) 占着。" % (port, name2, pid2))
    else:
        print(" 端口 %d 已空闲，可按 1 重启服务。" % port)
    _pause()


def _panel_bridge_menu(svc):
    while True:
        print("")
        print("本地桥设置")
        print("=" * 69)
        state = "已启用" if svc.bridge_enabled else "已关闭"
        mounted = "（本次运行已挂载 %d）" % BRIDGE_PORT if svc.bridge_ok else ""
        print(" 当前状态 : %s%s" % (state, mounted))
        print("-" * 69)
        print(" 1  显示本地桥策略（来源 / 端口 / 说明）")
        print(" 2  本地桥：%s（改完回上一级按 1 重启生效）" % ("关闭" if svc.bridge_enabled else "开启"))
        print(" 3  查找固定 %d 的占用者" % BRIDGE_PORT)
        print(" 0  返回")
        print("=" * 69)
        got = _ask(" > ", "")
        if got is None or got in ("0", "q"):
            return
        if got == "1":
            print(" 本地桥策略（本版为 Python 桥 bridge.py，规则以其实现为准）：")
            print("   监听地址 : 127.0.0.1:%d（固定，不漂移）" % BRIDGE_PORT)
            print("   允许来源 : Origin 的**主机名**落在本机回环白名单（localhost / 127.0.0.1 / [::1]）")
            print("              时按请求原样反射放行；无 Origin 的请求（curl / 同源）不带该头")
            print("   本次传入 : http://localhost:%d、http://127.0.0.1:%d" % (svc.port or 0, svc.port or 0))
            print("   说明     : 白名单是 bridge.py 里的编译期常量，没有可编辑的配置文件——")
            print("              这是权限最小集设计，不是遗漏；桥只服务本机回环。")
            print("   平台差异 : 原生启动器（C 桥）的来源规则更严（只认 http 且必须带端口，")
            print("              且 Host 头必须是 localhost/127.0.0.1/[::1]:%d）。" % BRIDGE_PORT)
            _pause()
        elif got == "2":
            svc.bridge_enabled = not svc.bridge_enabled
        elif got == "3":
            pid, name, reason = _port_owner(BRIDGE_PORT)
            if pid > 0:
                print(" %d 被占用：%s (PID %d)" % (BRIDGE_PORT, name, pid))
            else:
                print(" %d：%s" % (BRIDGE_PORT, reason or "未发现占用者"))
            print(" 需要清理请回上一级按 2（那里带二次确认）。")
            _pause()


def _panel_show_status(svc):
    static_txt, bridge_txt = _panel_status_lines(svc)
    print("")
    print("—— 运行状态 ——")
    print(" 静态服务 : %s" % static_txt)
    print(" 本地桥   : %s" % bridge_txt)
    print(" 最近错误 : %s" % (svc.last_error or "无"))
    if svc.httpd is None:
        print(" 处置建议 : 按 2 清除占用端口，再按 1 重启服务。")
    _pause()


def panel_run(svc):
    """控制面板主循环。返回进程退出码。

    本版的静态服务跑在后台线程，所以这里可以安心阻塞读输入；
    原生版（C）是单线程事件循环，用 httpd_poll 把「等服务」与「等按键」交错起来。
    """
    while True:
        _panel_render(svc)
        try:
            got = input(" > ").strip()
        except EOFError:
            svc.stop_all()
            print("\n 已退出。")
            return 0
        except KeyboardInterrupt:
            svc.stop_all()
            print("\n 已退出。")
            return 0
        if got in ("0", "q", "Q"):
            svc.stop_all()
            print(" 已退出。")
            return 0
        if got == "1":
            _panel_restart(svc)
        elif got == "2":
            _panel_clear_port(svc)
        elif got == "3":
            _panel_bridge_menu(svc)
        elif got == "4":
            url = "http://localhost:%d/" % svc.port if svc.port else ""
            if not url:
                print("")
                print(" 服务未运行，先按 1 启动。")
            else:
                try:
                    webbrowser.open(url)
                    print("")
                    print(" 已交给系统默认浏览器打开。")
                except Exception:
                    print("")
                    print(" 打开失败，请手动在浏览器访问 %s" % url)
            _pause()
        elif got == "5":
            _panel_show_status(svc)


# ============================ 既有入口（原样保留） ============================

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


def _stdin_is_tty():
    try:
        return sys.stdin is not None and sys.stdin.isatty()
    except Exception:
        return False


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
    no_panel = "--no-panel" in args
    force_panel = "--panel" in args
    dev_mode = "--dev" in args
    port = 8180
    for a in args:
        if a.isdigit():
            port = int(a)
            break

    svc = Service(port, not no_bridge, no_open, dev_mode, no_mcp="--no-mcp" in args)
    started = svc.start()
    if not started:
        # 与原生版同一口径：交互时进面板把原因摆出来（不闪退）；非交互保持旧行为。
        if not (force_panel or (not no_panel and _stdin_is_tty())):
            print("启动失败：%s" % svc.last_error)
            sys.exit(1)
    if started and not svc.no_open:
        try:
            webbrowser.open("http://localhost:%d/" % svc.port)
        except Exception:
            print("  自动打开失败，请手动在浏览器打开 http://localhost:%d/" % svc.port)

    # 交互终端 → 控制面板；管道/重定向（测试、E2E、MCP 拉起）→ 保持原有阻塞行为。
    if force_panel or (not no_panel and _stdin_is_tty()):
        try:
            sys.exit(panel_run(svc))
        except KeyboardInterrupt:
            svc.stop_all()
            print("\n已停止。")
            sys.exit(0)

    # 旧行为（非交互）：打印信息后阻塞在服务上，逐字不变。
    url = "http://localhost:%d/" % svc.port
    print("")
    print("  恒烈CTF编码工具箱 已启动")
    print("  " + url)
    if svc.bridge_ok:
        print("  本地桥  http://localhost:%d/  （同进程后台线程，仅 Windows 可用）" % BRIDGE_PORT)
    elif no_bridge:
        print("  本地桥  已按 --no-bridge 跳过")
    print("")
    print("  按 Ctrl+C 停止。")
    print("")
    try:
        while True:
            svc.thread.join(timeout=1)
            if not svc.thread.is_alive():
                break
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        svc.stop_all()


if __name__ == "__main__":
    main()
