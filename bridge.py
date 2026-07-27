#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bridge.py — T18 外部 exe 本地桥（独立本地服务，仅 Windows，署名：外部4）。

为什么独立服务而非改 start.py：
  - 不碰主开发 M 的 start.py（机制四 + 用户要求「不影响主开发」）。
  - 独立进程，可选启用；不起则前端 op 灰置提示，不影响纯前端功能。

安全红线（见 T18 任务卡 + 库根安全约定）：
  - 白名单 exe（硬编码 tool→绝对路径，不接受任意命令）。
  - subprocess.run 参数数组，shell=False，绝不字符串拼接（防注入核心）。
  - 仅监听 127.0.0.1，CORS 只放行 localhost:8180（前端端口），不对外。
  - 超时 60s，临时文件用完即删。
  - 零外发：exe 在本机跑，不联网。

用法：
  python bridge.py            # 默认端口 8181
  python bridge.py 8199       # 指定端口
"""
import sys
import os
import json
import base64
import subprocess
import tempfile
import shutil
import platform
try:
    import winreg  # Windows 注册表（读系统强调色，MT42）
except ImportError:
    winreg = None
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
IS_WIN = platform.system() == "Windows"

# exe 根（已整合入库，随 clone/打包分发）。CLI 型在 cli/，GUI 型在 gui/。
EXE_BASE = os.path.join(ROOT, "tools", "exe")

# ---- 白名单 exe（tool → 绝对路径）。新增工具在此登记 ----
# 这里只放「有命令行、可无人值守跑（读 args/stdin，回 stdout）」的 CLI exe。
# 纯 GUI 程序（OurSecret/OpenPuff/Jphswin 等）见下方 LAUNCH_WHITELIST，走 /api/launch。
WHITELIST = {
    "dtmf2num": os.path.join(EXE_BASE, "cli", "dtmf2num.exe"),
    "foremost": os.path.join(EXE_BASE, "cli", "foremost", "foremost.exe"),
    "steghide": os.path.join(EXE_BASE, "cli", "steghide", "steghide.exe"),
    "snow":     os.path.join(EXE_BASE, "cli", "snow.exe"),
    "jsteg":    os.path.join(EXE_BASE, "cli", "jsteg.exe"),
    "bkcrack":  os.path.join(EXE_BASE, "cli", "bkcrack.exe"),
    "mp3stego": os.path.join(EXE_BASE, "cli", "mp3stego_Decode.exe"),
    # ---- 新增 CLI 工具（T18 补齐，署名：外部4）----
    # bftools：Brainfuck 工具集（run/encode/decode/enlarge/reduce），program 或 - 走 stdin
    "bftools":    os.path.join(EXE_BASE, "cli", "bftools", "bftools.exe"),
    # npiet：Piet 图像语言解释器，吃图像文件执行，回 stdout
    "npiet":      os.path.join(EXE_BASE, "cli", "npiet", "npiet.exe"),
    # stegdetect：JPEG 隐写检测（jsteg/jphide/outguess/…），吃 jpg 文件回检测报告
    "stegdetect": os.path.join(EXE_BASE, "cli", "stegdetect", "stegdetect.exe"),
}

# ---- GUI 启动白名单（tool → 绝对路径）。仅「启动 exe 让用户手动操作」，不喂输入不取输出 ----
# 这些是纯 GUI 隐写/工具程序，无无人值守 CLI（或私有格式无法脚本化）。/api/launch 仅
# Popen 拉起进程即返回，用户在弹出窗口里自己操作。安全：仍走白名单，绝不启动名单外的东西。
LAUNCH_WHITELIST = {
    # 吾爱破解版 GUI 隐写/水印工具
    "watermarkh":   os.path.join(EXE_BASE, "gui", "watermarkH.exe"),
    # JPHS for Windows：JPEG 图像隐写 GUI（jphide/jpseek）
    "jphswin":      os.path.join(EXE_BASE, "gui", "Jphswin.exe"),
    # NTFS 数据流编辑器（ADS 交换数据流查看/编辑）
    "ntfsstreams":  os.path.join(EXE_BASE, "gui", "ntfsstreamseditor.exe"),
    # OpenPuff：多载体隐写 GUI（图/音/视/PDF/flash 等）
    "openpuff":     os.path.join(EXE_BASE, "gui", "OpenPuff_release", "OpenPuff.exe"),
    # OurSecret：GUI 隐写工具，私有格式无法纯前端复刻，随项目入库
    "oursecret":    os.path.join(EXE_BASE, "gui", "OurSecret.exe"),
}

TIMEOUT = 60  # 秒
# 按 tool 给独立超时（秒）。默认 60s，特殊工具在此覆盖。
# bkcrack 已知明文攻击 CPU 密集，典型耗时几分钟~几十分钟，给 30 分钟（对齐 bkcrack.js wrapper 提示）。
TOOL_TIMEOUTS = {
    "bkcrack": 1800,
}
MAX_STDIN = 50 * 1024 * 1024  # 50MB
CORS_ORIGIN = "http://localhost:8180"  # 前端 start.py 默认端口

# ---- 环境探测（T159）：CTF 常用本机工具版本，供顶栏「环境管理」面板懒检测 ----
# (key, [候选命令名或绝对路径], [version 参数], 是否取 stderr)。
# shutil.which 逐个找可执行；找到则跑 version 参数，5s 超时；stdout/stderr 解析版本串。
ENV_PROBES = [
    ("python", ["python", "py"], ["--version"], False),
    ("node",   ["node"],          ["--version"], False),
    ("java",   ["java"],           ["-version"],  True),   # java -version 输出到 stderr
    ("7z",     ["7z", r"C:\Program Files\7-Zip\7z.exe"], [], False),
]
ENV_TIMEOUT = 5  # 版本探测超时秒数（短，防阻塞面板）

def probe_env():
    """探测本机 CTF 常用工具版本。返回 {key: {ok, version, path} | {ok:False, error}}。
    零外发：只跑本机命令的 --version 类参数，不联网、不执行任意命令。"""
    out = {}
    for key, candidates, vargs, use_stderr in ENV_PROBES:
        exe = None
        for c in candidates:
            # 绝对路径直接判存在；命令名走 shutil.which（跨平台 PATH 查找）
            if os.path.isabs(c):
                if os.path.isfile(c):
                    exe = c
                    break
            else:
                w = shutil.which(c)
                if w:
                    exe = w
                    break
        if not exe:
            out[key] = {"ok": False, "error": "未安装或不在 PATH"}
            continue
        try:
            # shell=False，参数数组，防注入（与 /api/run 同红线）
            proc = subprocess.run(
                [exe] + vargs,
                capture_output=True,
                timeout=ENV_TIMEOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            text = (proc.stderr if use_stderr else proc.stdout).strip()
            if not text:
                text = (proc.stdout if use_stderr else proc.stderr).strip()
            # 取首行（版本信息通常在第一行），过长截断
            first_line = text.splitlines()[0] if text else ""
            if len(first_line) > 200:
                first_line = first_line[:200] + "…"
            out[key] = {
                "ok": True,
                "version": first_line,
                "path": exe,
                "exitCode": proc.returncode,
            }
        except subprocess.TimeoutExpired:
            out[key] = {"ok": False, "error": "探测超时（%ds）" % ENV_TIMEOUT}
        except Exception as e:
            out[key] = {"ok": False, "error": "探测异常: %s" % e}
    # MT42：本地桥是否支持读系统强调色（Windows 注册表 AccentColorMenu）
    out["accent"] = read_accent_color() is not None
    return out


# ============================================================
# MT42：读 Windows 系统强调色（注册表 AccentColorMenu\AccentColor）
# ------------------------------------------------------------
# 注册表 DWORD 是 ARGB（0xAARRGGBB），非 ABGR（见 PROGRESS.md 第八批修正）。
# 红线：只读这一个键，不执行用户代码，不联网，仅 127.0.0.1；失败返回 None 降级。
# ============================================================
def read_accent_color():
    """读 Windows 注册表 AccentColorMenu\AccentColor（ARGB DWORD）。
    返回 {"accent":"#RRGGBB","argb":"AARRGGBB","source":"registry"} 或 None（不可用/读失败）。"""
    if not IS_WIN or winreg is None:
        return None
    try:
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\AccentColorMenu",
        )
        try:
            val, typ = winreg.QueryValueEx(key, "AccentColor")
        finally:
            winreg.CloseKey(key)
        if typ != winreg.REG_DWORD:
            return None
        # REG_DWORD 在 Python 中可能为负数（高位 alpha≥0x80 时），先转无符号
        val = val & 0xFFFFFFFF
        # ARGB 字节序（非 ABGR，见 PROGRESS.md 第八批修正）：高 8 位 alpha，其次 R/G/B
        a = (val >> 24) & 0xFF
        r = (val >> 16) & 0xFF
        g = (val >> 8) & 0xFF
        b = val & 0xFF
        return {
            "accent": "#%02X%02X%02X" % (r, g, b),
            "argb": "%02X%02X%02X%02X" % (a, r, g, b),
            "source": "registry",
        }
    except Exception:
        return None


# ============================================================
# MT7：pyc/exe 自动反编译（新增端点，署名：MT7）
# ------------------------------------------------------------
# 流程：前端拖入 .pyc/.exe → /api/decompile → 桥用 xdis 查 magic 定 Python 版本
#   → 3.4-3.8 走 uncompyle6/decompyle3；3.9+ 走 pylingual（实验，需手动装 + HF 镜像）
#   → PyInstaller exe 先 PyInstxtractor 解包再逐 pyc 反编。
# 安全红线：
#   - 只调白名单内本地工具（下方 DECOMPILE_TOOLS 硬编码），subprocess 参数数组 shell=False。
#   - 零外发：用户样本/反编结果绝不外发；pylingual 的 HF 镜像仅用于其自身模型拉取。
#   - 文件名 basename 化 + 拒绝路径穿越；临时目录用完送回收站（禁 rm -rf）。
#   - 仅 Windows；未装的工具（pylingual/pyinstxtractor）明确返回「需手动装」占位。
# ============================================================
import re

# 反编白名单（tool → 候选绝对路径/命令，按序取首个存在者，绝不接受任意命令）。
DECOMPILE_TOOLS = {
    # uncompyle6：支持 Python 1.x-3.8（本机 3.9.3 版）
    "uncompyle6": [
        r"C:\Users\Operater\AppData\Local\Programs\Python\Python311\Scripts\uncompyle6.exe",
        r"C:\Users\Operater\AppData\Local\Programs\Python\Python313\Scripts\uncompyle6.exe",
        "uncompyle6",
    ],
    # decompyle3：支持 3.7-3.8（uncompyle6 的姊妹，部分样本更稳）
    "decompyle3": [
        r"C:\Users\Operater\AppData\Local\Programs\Python\Python313\Scripts\decompyle3.exe",
        r"C:\Users\Operater\AppData\Local\Programs\Python\Python311\Scripts\decompyle3.exe",
        "decompyle3",
    ],
    # pylingual：3.9+ 大模型反编（实验，需手动装 + HF_ENDPOINT 镜像）
    "pylingual": ["pylingual"],
    # 7-Zip：容器解压（部分打包壳）
    "7z": [r"C:\Program Files\7-Zip\7z.exe", "7z"],
}

DECOMPILE_TIMEOUT = 120  # 反编较慢，独立超时（秒）


def _resolve_tool(key):
    """解析白名单工具首个存在的可执行路径；无则 None。"""
    for c in DECOMPILE_TOOLS.get(key, []):
        if os.path.isabs(c):
            if os.path.isfile(c):
                return c
        else:
            w = shutil.which(c)
            if w:
                return w
    return None


def _resolve_pyinstxtractor():
    """定位 PyInstxtractor：脚本文件优先，其次 pip 模块 pyinstxtractor_ng。
    返回 (kind, ref)：kind ∈ {'script','module',None}。"""
    for name in ("pyinstxtractor.py", "pyinstxtractor-ng.py", "pyinstxtractor_ng.py"):
        w = shutil.which(name)
        if w:
            return ("script", w)
    try:
        import importlib.util as _u
        if _u.find_spec("pyinstxtractor_ng"):
            return ("module", "pyinstxtractor_ng")
    except Exception:
        pass
    return (None, None)


def _pyc_version(magic4):
    """由 pyc 头 4 字节 magic 判 Python 版本。返回 (verstr, (major,minor)) 或 (None,None)。
    优先 xdis 权威表；无 xdis 时用常见 magic 兜底。"""
    try:
        from xdis import magics as _m
        v = _m.versions.get(magic4)
        if v:
            mm = re.match(r"^(\d+)\.(\d+)", v)
            return (v, (int(mm.group(1)), int(mm.group(2)))) if mm else (v, None)
    except Exception:
        pass
    # 兜底：常见 magic 高 2 字节 → 主次版本（xdis 缺席时的粗判）
    fb = {
        b"\xee\x0c": "3.4", b"\x16\x0d": "3.5", b"\x17\x0d": "3.5",
        b"\x33\x0d": "3.6", b"\x42\x0d": "3.7", b"\x55\x0d": "3.8",
        b"\x61\x0d": "3.9", b"\x6f\x0d": "3.10", b"\xa7\x0d": "3.11",
        b"\xcb\x0d": "3.12", b"\xf3\x0d": "3.13",
    }
    v = fb.get(magic4[:2])
    if v:
        mm = re.match(r"^(\d+)\.(\d+)", v)
        return v, (int(mm.group(1)), int(mm.group(2)))
    return None, None


def _pick_decompiler(mm):
    """据 (major,minor) 选反编工具。返回 (toolKey|None, note)。"""
    if not mm:
        return None, "无法识别 Python 版本"
    major, minor = mm
    if major == 2:
        return "uncompyle6", None
    if major == 3:
        if minor <= 8:
            return "uncompyle6", None
        return "pylingual", "Python 3.9+ 需 pylingual 大模型反编（实验，需手动安装）"
    return None, "不支持的 Python 版本 %d.%d" % (major, minor)


def _run_decompiler(tool_key, pyc_path, workdir):
    """调白名单反编工具于单个 pyc。subprocess 参数数组 shell=False。"""
    exe = _resolve_tool(tool_key)
    if not exe:
        return {"ok": False, "tool": tool_key,
                "error": "%s 未安装（本机不可用，需手动安装）" % tool_key}
    env = dict(os.environ)
    if tool_key == "pylingual":
        # HF 镜像仅供 pylingual 自身模型拉取，绝不上传用户样本（零外发红线）
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        env.setdefault("PYTHONUTF8", "1")
        cmd = [exe, pyc_path]  # 注：pylingual CLI 形态待确认，骨架先占位
    else:
        # uncompyle6 / decompyle3：默认把反编源码写 stdout
        env.setdefault("PYTHONUTF8", "1")
        cmd = [exe, pyc_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=DECOMPILE_TIMEOUT,
            cwd=workdir, env=env, shell=False,
        )
        src = proc.stdout.decode("utf-8", "replace")
        err = proc.stderr.decode("utf-8", "replace")
        return {
            "ok": proc.returncode == 0 or bool(src.strip()),
            "tool": tool_key, "exe": exe, "exitCode": proc.returncode,
            "source": src, "stderr": err,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "tool": tool_key, "error": "反编超时（%ds）" % DECOMPILE_TIMEOUT}
    except Exception as e:
        return {"ok": False, "tool": tool_key, "error": "反编异常: %s" % e}


def _decompile_pyc_bytes(data, workdir, label="input.pyc"):
    """反编单个 pyc（字节）。返回含 pyVersion/tool/source 的结果字典。"""
    if len(data) < 8:
        return {"ok": False, "error": "文件过小，非有效 pyc"}
    magic4 = data[:4]
    ver, mm = _pyc_version(magic4)
    tool_key, note = _pick_decompiler(mm)
    fp = os.path.join(workdir, os.path.basename(label) or "input.pyc")
    with open(fp, "wb") as f:
        f.write(data)
    result = {"pyVersion": ver, "magic": magic4.hex(), "tool": tool_key, "note": note}
    if not tool_key:
        result["ok"] = False
        result["error"] = note or "无可用反编工具"
        return result
    result.update(_run_decompiler(tool_key, fp, workdir))
    return result


def _decompile_exe_bytes(data, workdir, label="input.exe"):
    """反编 PyInstaller 打包 exe：解包 → 逐 pyc 反编。骨架：pyinstxtractor 未装时占位。"""
    kind_avail, ref = _resolve_pyinstxtractor()
    if not kind_avail:
        return {
            "ok": False, "experimental": True,
            "error": "PyInstxtractor 未安装（骨架占位：exe 解包需手动装 pyinstxtractor 或 pyinstxtractor-ng）",
        }
    fp = os.path.join(workdir, os.path.basename(label) or "input.exe")
    with open(fp, "wb") as f:
        f.write(data)
    if kind_avail == "script":
        cmd = [sys.executable, ref, fp]
    else:
        cmd = [sys.executable, "-m", ref, fp]
    try:
        subprocess.run(cmd, capture_output=True, timeout=DECOMPILE_TIMEOUT,
                       cwd=workdir, shell=False)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "解包超时（%ds）" % DECOMPILE_TIMEOUT}
    except Exception as e:
        return {"ok": False, "error": "解包失败: %s" % e}
    # pyinstxtractor 产出 <name>_extracted 目录
    extracted = fp + "_extracted"
    files = []
    if os.path.isdir(extracted):
        for root, _dirs, names in os.walk(extracted):
            for n in names:
                if not n.lower().endswith(".pyc"):
                    continue
                try:
                    with open(os.path.join(root, n), "rb") as pf:
                        d = pf.read()
                except Exception as e:
                    files.append({"name": n, "ok": False, "error": "读取失败: %s" % e})
                    continue
                r = _decompile_pyc_bytes(d, workdir, label=n)
                r["name"] = n
                files.append(r)
    return {
        "ok": bool(files),
        "files": files,
        "note": "PyInstaller 解包 + 逐 pyc 反编" if files else "未在解包结果中找到 pyc",
    }


def _safe_label(name, exts):
    """文件名安全化：basename + 拒路径穿越 + 校验扩展名。非法返回 None。"""
    base = os.path.basename(str(name or ""))
    if not base or ".." in base or "/" in base or "\\" in base:
        return None
    low = base.lower()
    if exts and not any(low.endswith(e) for e in exts):
        return None
    return base


def _recycle_dir(path):
    """把临时目录送回收站（PowerShell VisualBasic API），失败回退 shutil.rmtree（禁 rm -rf）。"""
    if not path or not os.path.isdir(path):
        return
    if IS_WIN:
        # path 由 mkdtemp 生成（受控），仍对单引号转义防 PS 注入
        p = os.path.abspath(path).replace("'", "''")
        ps = ("Add-Type -AssemblyName Microsoft.VisualBasic; "
              "[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory("
              "'%s','OnlyErrorDialogs','SendToRecycleBin')" % p)
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps],
                capture_output=True, timeout=15, shell=False,
            )
            if not os.path.isdir(path):
                return
        except Exception:
            pass
    shutil.rmtree(path, ignore_errors=True)


def decompile_env():
    """反编工具链可用性探测（供前端灰置/实验标记）。"""
    try:
        import xdis
        xdis_ok = True
        xver = getattr(xdis, "__version__", "")
    except Exception:
        xdis_ok, xver = False, ""
    pk, _ref = _resolve_pyinstxtractor()
    return {
        "ok": True,
        "win": IS_WIN,
        "platform": platform.system(),
        "xdis": {"ok": xdis_ok, "version": xver},
        "tools": {
            "uncompyle6": bool(_resolve_tool("uncompyle6")),
            "decompyle3": bool(_resolve_tool("decompyle3")),
            "pylingual": bool(_resolve_tool("pylingual")),
            "7z": bool(_resolve_tool("7z")),
            "pyinstxtractor": bool(pk),
        },
    }


class BridgeHandler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", CORS_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-cache")

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/health":
            self._send_json(200, {
                "ok": True,
                "platform": platform.system(),
                "win": IS_WIN,
                "tools": list(WHITELIST.keys()),
                "launch": list(LAUNCH_WHITELIST.keys()),
            })
        elif path == "/api/tools":
            info = {}
            for t, p in WHITELIST.items():
                info[t] = {"exists": os.path.isfile(p), "path": p}
            self._send_json(200, {"tools": info, "win": IS_WIN})
        elif path == "/api/env":
            # T159 环境探测：本机 CTF 常用工具版本（懒检测，仅 GET 触发）
            self._send_json(200, {
                "ok": True,
                "platform": platform.system(),
                "release": platform.release(),
                "machine": platform.machine(),
                "win": IS_WIN,
                "tools": probe_env(),
            })
        elif path == "/api/decompile-env":
            # MT7 反编工具链可用性探测（前端据此灰置/实验标记）
            self._send_json(200, decompile_env())
        elif path == "/api/accent":
            # MT42：读 Windows 注册表系统强调色（ARGB），供前端 M3 动态取色
            info = read_accent_color()
            if info:
                self._send_json(200, info)
            else:
                # 非 Windows 或注册表读失败：501 降级，让前端走预设色板
                self._send_json(501, {"error": "not_available", "accent": None})
        else:
            self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/decompile":
            self._handle_decompile()
            return
        if path == "/api/launch":
            self._handle_launch()
            return
        if path != "/api/run":
            self._send_json(404, {"ok": False, "error": "not found"})
            return
        if not IS_WIN:
            self._send_json(200, {
                "ok": False,
                "error": "本地桥仅支持 Windows（当前平台: %s）" % platform.system(),
            })
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            req = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "请求解析失败: %s" % e})
            return

        tool = req.get("tool", "")
        args = req.get("args", [])
        stdin_b64 = req.get("stdin")   # base64，可选
        files = req.get("files", {})   # {name: base64}，args 里用 {name} 占位替换为临时路径

        if tool not in WHITELIST:
            self._send_json(400, {
                "ok": False,
                "error": "工具不在白名单: %s（合法: %s）" % (tool, ", ".join(WHITELIST)),
            })
            return
        exe = WHITELIST[tool]
        if not os.path.isfile(exe):
            self._send_json(500, {"ok": False, "error": "exe 不存在: %s" % exe})
            return
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            self._send_json(400, {"ok": False, "error": "args 必须是字符串数组"})
            return

        stdin_bytes = b""
        if stdin_b64:
            try:
                stdin_bytes = base64.b64decode(stdin_b64)
                if len(stdin_bytes) > MAX_STDIN:
                    self._send_json(400, {"ok": False, "error": "stdin 超过 50MB 限制"})
                    return
            except Exception as e:
                self._send_json(400, {"ok": False, "error": "stdin base64 解码失败: %s" % e})
                return

        tmpdir = tempfile.mkdtemp(prefix="bridge_")
        # 按 tool 取独立超时（默认 60s；bkcrack 等长任务在 TOOL_TIMEOUTS 覆盖）。
        # 提到 try 块前定义，确保 except 块能安全访问。
        tool_timeout = TOOL_TIMEOUTS.get(tool, TIMEOUT)
        try:
            # 写输入文件，替换 args 里的 {name} 占位符 → 临时文件绝对路径
            file_map = {}
            for name, b64 in (files or {}).items():
                try:
                    data = base64.b64decode(b64)
                except Exception as e:
                    self._send_json(400, {"ok": False, "error": "文件 %s base64 解码失败: %s" % (name, e)})
                    return
                # 防路径穿越：只用 basename
                safe_name = os.path.basename(name)
                fp = os.path.join(tmpdir, safe_name)
                with open(fp, "wb") as f:
                    f.write(data)
                file_map[name] = fp

            real_args = []
            for a in args:
                for name, fp in file_map.items():
                    a = a.replace("{" + name + "}", fp)
                real_args.append(a)

            # subprocess.run 参数数组，shell=False（防注入核心）
            proc = subprocess.run(
                [exe] + real_args,
                input=stdin_bytes,
                capture_output=True,
                timeout=tool_timeout,
                cwd=tmpdir,
            )
            self._send_json(200, {
                "ok": True,
                "exitCode": proc.returncode,
                "stdout": base64.b64encode(proc.stdout).decode("ascii"),
                "stderr": base64.b64encode(proc.stderr).decode("ascii"),
            })
        except subprocess.TimeoutExpired:
            self._send_json(504, {"ok": False, "error": "执行超时（%ds）" % tool_timeout})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": "执行异常: %s" % e})
        finally:
            shutil.rmtree(tmpdir, ignore_errors=True)

    def _handle_decompile(self):
        """POST /api/decompile：pyc/exe 自动反编。
        请求体 {kind:'pyc'|'exe'|'auto', name, data(base64)}。
        零外发：样本只写本机临时目录，用完送回收站；只调白名单本地工具。"""
        if not IS_WIN:
            self._send_json(200, {
                "ok": False,
                "error": "反编仅支持 Windows（当前平台: %s）" % platform.system(),
            })
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length > MAX_STDIN:
                self._send_json(400, {"ok": False, "error": "文件超过 50MB 限制"})
                return
            raw = self.rfile.read(length) if length else b""
            req = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "请求解析失败: %s" % e})
            return

        kind = str(req.get("kind", "auto")).lower()
        data_b64 = req.get("data")
        if not data_b64:
            self._send_json(400, {"ok": False, "error": "缺少 data（文件 base64）"})
            return
        try:
            data = base64.b64decode(data_b64)
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "data base64 解码失败: %s" % e})
            return
        if len(data) > MAX_STDIN:
            self._send_json(400, {"ok": False, "error": "文件超过 50MB 限制"})
            return

        # 自动判形态：MZ 头 → exe；否则按 pyc。显式 kind 优先。
        if kind == "auto":
            kind = "exe" if data[:2] == b"MZ" else "pyc"

        label = _safe_label(req.get("name"), None) or ("input." + kind)
        # name 非法（路径穿越等）→ 用安全默认名，不直接拒绝（骨架从宽，安全从严）
        if _safe_label(req.get("name"), None) is None and req.get("name"):
            label = "input." + kind

        tmpdir = tempfile.mkdtemp(prefix="decompile_")
        try:
            if kind == "exe":
                result = _decompile_exe_bytes(data, tmpdir, label=label)
            else:
                result = _decompile_pyc_bytes(data, tmpdir, label=label)
            result.setdefault("kind", kind)
            self._send_json(200, result)
        except Exception as e:
            self._send_json(500, {"ok": False, "error": "反编异常: %s" % e})
        finally:
            _recycle_dir(tmpdir)

    def _handle_launch(self):
        """POST /api/launch：仅启动白名单 GUI exe（Popen 拉起即返回，不喂输入不取输出）。
        请求体 {tool}。用户在弹出的 GUI 窗口里自己操作。
        安全红线：
          - 仍走 LAUNCH_WHITELIST 白名单校验，绝不启动名单外的东西（防任意执行）。
          - subprocess.Popen 参数数组 shell=False（防注入）；不 wait、不管 stdout。
          - 仅 Windows；非 Win 直接拒绝。"""
        if not IS_WIN:
            self._send_json(200, {
                "ok": False,
                "error": "GUI 启动仅支持 Windows（当前平台: %s）" % platform.system(),
            })
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            req = json.loads(raw.decode("utf-8") or "{}")
        except Exception as e:
            self._send_json(400, {"ok": False, "error": "请求解析失败: %s" % e})
            return

        tool = req.get("tool", "")
        if tool not in LAUNCH_WHITELIST:
            self._send_json(400, {
                "ok": False,
                "error": "工具不在启动白名单: %s（合法: %s）" % (tool, ", ".join(LAUNCH_WHITELIST)),
            })
            return
        exe = LAUNCH_WHITELIST[tool]
        if not os.path.isfile(exe):
            self._send_json(500, {"ok": False, "error": "exe 不存在: %s" % exe})
            return
        try:
            # Popen 拉起 GUI 即返回，不 wait、不 capture。cwd 设为 exe 所在目录
            # （GUI 程序常依赖同目录 dll / 配置，如 OpenPuff 的 libObfuscate.dll）。
            subprocess.Popen([exe], cwd=os.path.dirname(exe), shell=False)
            self._send_json(200, {"ok": True, "tool": tool, "launched": True, "path": exe})
        except Exception as e:
            self._send_json(500, {"ok": False, "error": "启动失败: %s" % e})

    def log_message(self, fmt, *args):
        pass  # 静默访问日志


def main():
    argv = sys.argv[1:]
    port = 8181
    for a in argv:
        if a.isdigit():
            port = int(a)
            break
    if not IS_WIN:
        print("警告：本地桥仅支持 Windows（当前 %s），服务仍启动但 /api/run 会拒绝。" % platform.system())
    httpd = None
    for _ in range(20):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), BridgeHandler)
            break
        except OSError:
            port += 1
    if httpd is None:
        print("启动失败：8181~8200 端口都被占用")
        sys.exit(1)
    print("")
    print("  T18 本地桥已启动（仅 Windows，仅 127.0.0.1）")
    print("  http://localhost:%d/" % port)
    print("  白名单工具: %s" % ", ".join(WHITELIST))
    print("  按 Ctrl+C 停止。")
    print("")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
        httpd.server_close()


if __name__ == "__main__":
    main()
