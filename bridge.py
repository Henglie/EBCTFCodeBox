#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bridge.py — 外部 exe 本地桥（独立本地服务，仅 Windows）。

为什么独立服务而非改 start.py：
  - 不碰 start.py，作为独立进程运行，可选启用。
  - 独立进程，可选启用；不起则前端 op 灰置提示，不影响纯前端功能。

安全红线（见库根安全约定）：
  - 白名单 exe（硬编码 tool→绝对路径，不接受任意命令）。
  - subprocess.run 参数数组，shell=False，绝不字符串拼接（防注入核心）。
  - 仅监听 127.0.0.1，CORS 只放行 localhost:8180（前端端口），不对外。
  - 超时 60s，临时文件用完即删。
  - 零外发：exe 在本机跑，不联网。

用法：
  python bridge.py            # 默认端口 8181
  python bridge.py 8181       # 固定端口
"""
import sys
import os
import json
import base64
import subprocess
import tempfile
import shutil
import platform
import time
try:
    import winreg  # Windows 注册表（读系统强调色）
except ImportError:
    winreg = None
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

def _force_utf8_stdio():
    """重定向到管道/文件时把 stdout/stderr 切到 UTF-8。

    原生启动器（原生启动器/src/modules/python_capability.c）用 bridge_cli.py 的
    stdout 作为 JSON 通道，并执行 ebctf_bridge_valid_utf8 校验；不合法就**静默丢弃**
    整个完成事件。Python 在 Windows 管道里默认按本地代码页（cp936）写中文，JSON 含
    中文错误/工具说明时即被丢弃 → 前端等满 90s 只看到 request timeout。
    这里在 import 时修正编码。TTY 保持原样，避免控制台乱码。
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            if stream is None or stream.isatty():
                continue
            enc = (getattr(stream, "encoding", "") or "").replace("-", "").lower()
            if enc in ("utf8", "utf8mb4"):
                continue
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

_force_utf8_stdio()

ROOT = os.path.dirname(os.path.abspath(__file__))
IS_WIN = platform.system() == "Windows"

# exe 根（已整合入库，随 clone/打包分发）。CLI 型在 cli/，GUI 型在 gui/。
EXE_BASE = os.path.join(ROOT, "tools", "exe")

# ---- 白名单 exe（tool → 绝对路径）。新增工具在此登记 ----
# 这里只放「有命令行、可无人值守跑（读 args/stdin，回 stdout）」的 CLI exe。
# 纯 GUI 程序（OurSecret/OpenPuff/Jphswin 等）见下方 LAUNCH_WHITELIST，走 /api/launch。
WHITELIST = {
    # ---- 新增 CLI 工具 ----
}

# ---- GUI 启动白名单（tool → 绝对路径）。仅「启动 exe 让用户手动操作」，不喂输入不取输出 ----
# 这些是纯 GUI 隐写/工具程序，无无人值守 CLI（或私有格式无法脚本化）。/api/launch 仅
# Popen 拉起进程即返回，用户在弹出窗口里自己操作。安全：仍走白名单，绝不启动名单外的东西。
LAUNCH_WHITELIST = {
    # watermarkH：已纯前端复刻为内置 op（watermarkhFft），exe 退场、条目移除。
    # JPHS for Windows：JPEG 图像隐写 GUI（jphide/jpseek）
    "jphswin":      os.path.join(EXE_BASE, "gui", "Jphswin.exe"),
    # NTFS 数据流编辑器（ADS 交换数据流查看/编辑）
    # OpenPuff：多载体隐写 GUI（图/音/视/PDF/flash 等）
    "openpuff":     os.path.join(EXE_BASE, "gui", "OpenPuff_release", "OpenPuff.exe"),
    # OurSecret：GUI 隐写工具，私有格式无法纯前端复刻，随项目入库
    "oursecret":    os.path.join(EXE_BASE, "gui", "OurSecret.exe"),
}

TIMEOUT = 60  # 秒
# 按 tool 给独立超时（秒）。默认 60s，特殊工具在此覆盖。
TOOL_TIMEOUTS = {
}
MAX_STDIN = 50 * 1024 * 1024  # 50MB
# 前端页面端口不固定（start.py 8180 起，用户也可能自己起别的端口），且可能用 127.0.0.1 或 localhost 打开。
# 故按请求 Origin 反射放行：只认本机来源（localhost/127.0.0.1/::1 任意端口），外部站点一律拒绝。
ALLOWED_ORIGIN_HOSTS = {"localhost", "127.0.0.1", "::1"}

# ---- 环境探测：CTF 常用本机工具版本，供顶栏「环境管理」面板懒检测 ----
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
    # 本地桥是否支持读系统强调色（Windows 注册表 AccentColorMenu）
    out["accent"] = read_accent_color() is not None
    return out

# ============================================================
# 读 Windows 系统强调色（注册表 AccentColorMenu\AccentColor）
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
# pyc/exe 自动反编译（新增端点）
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
        "uncompyle6",
    ],
    # decompyle3：支持 3.7-3.8（uncompyle6 的姊妹，部分样本更稳）
    "decompyle3": [
        "decompyle3",
    ],
    # pylingual：3.9+ 大模型反编（实验，需手动装 + HF_ENDPOINT 镜像）
    "pylingual": ["pylingual"],
    # pycdc（Decompyle++）：2.7/3.x 的兜底反编器。注意 PATH 上可能存在同名但完全
    # 无关的 pycdc（本机 Python314\Scripts\pycdc.exe 就是另一个产品），因此探测必须
    # 校验 `-h` 输出含 input.pyc；只靠「文件存在」会把假工具当成可用。
    "pycdc": [
        os.path.join(os.path.dirname(ROOT), "PyKC", "third_party", "bin", "pycdc.exe"),
        os.path.join(ROOT, "tools", "exe", "cli", "pycdc.exe"),
        "pycdc",
    ],
    # 7-Zip：容器解压（部分打包壳）
    "7z": [r"C:\Program Files\7-Zip\7z.exe", "7z"],
}

DECOMPILE_TIMEOUT = 120  # exe 分支（解包 + 多 pyc）的单个子进程上限（秒）
PYC_DECOMPILE_TIMEOUT = 30  # 单个 pyc 的单个反编工具上限（秒）
# 单个 pyc 的工具链总预算。原生启动器给 Python 能力 60s，留 5s 余量：
# 超预算就返回已有尝试结果和明确原因，而不是让上层等满 90s 黑箱超时。
PYC_TOTAL_BUDGET = 55

# D7：exe 分支的总体预算。真实样本解出上百个 pyc，每个各起一次子进程必然撞超时
#（实测 222 个 → 137 s）。这里改用「总体时间 + pyc 数量」双上限，达到即返回部分结果，
# 而不是无限延长超时（延长只会在更慢的样本上再次超时）。
EXE_TOTAL_BUDGET_SECONDS = 60
EXE_MAX_PYC = 32

# 可用性探测结果缓存：key = (路径, mtime)。只在 decompile-env / decompile 被显式调用时才
# 触发，**正常启动绝不拉起任何外部进程**（零外发 + 正常启动不拉 Python 的契约）。
_TOOL_PROBE_CACHE = {}
TOOL_PROBE_TIMEOUT = 8  # 秒；短超时，避免探测本身成为新的阻塞源

# 探测参数必须按工具给：统一的 `--version` 会产生**假阴性**——本机 7-Zip 明明可用，
# 但 `7z --version` 退出码是 7（它只认 `-h`/无参），会被误判成「坏了」。
TOOL_PROBE_ARGS = {
    "7z": ["-h"],
    "pycdc": ["-h"],  # Decompyle++ 只认 -h/--help；--version 会以 exit=2 被误判为坏工具
}
# 探测输出必须包含的标记。pycdc 同名工具太多（PATH 上的 Python 包也叫 pycdc），
# 仅看退出码会把无关程序当反编器。
TOOL_PROBE_EXPECT = {
    "pycdc": "input.pyc",
}

def _probe_executable(path, timeout=TOOL_PROBE_TIMEOUT, args=None, expect=None):
    """「路径存在」≠「能工作」。这里真的跑一次版本/帮助命令：退出码 0（且命中
    expect 标记）才算可用。返回 (ok, reason)；reason ∈
    {'ok','missing','broken:exit=N','broken:<异常类名>','broken:unexpected-output'}。

    背景：uncompyle6/decompyle3 3.9.3 与 xdis 5.0.13 的 API 不兼容，import 即
    ImportError: PYTHON_VERSION_TRIPLE —— 文件明明在，却一跑就崩。旧实现只判存在，
    于是把这些坏掉的工具报成「可用」，前端据此不灰置，误导用户。"""
    if not path:
        return False, "missing"
    try:
        mtime = os.path.getmtime(path) if os.path.isfile(path) else 0
    except Exception:
        mtime = 0
    if args is None:
        args = ["--version"]
    key = (path, mtime, tuple(args), expect)
    if key in _TOOL_PROBE_CACHE:
        return _TOOL_PROBE_CACHE[key]
    try:
        p = subprocess.run(
            [path] + list(args),
            stdout=subprocess.PIPE if expect else subprocess.DEVNULL,
            stderr=subprocess.PIPE if expect else subprocess.DEVNULL,
            timeout=timeout, shell=False,
        )
        if p.returncode != 0:
            res = (False, "broken:exit=%s" % p.returncode)
        elif expect:
            text = (p.stdout or b"").decode("utf-8", "replace") + \
                   (p.stderr or b"").decode("utf-8", "replace")
            res = ((True, "ok") if expect.lower() in text.lower()
                   else (False, "broken:unexpected-output"))
        else:
            res = (True, "ok")
    except Exception as exc:
        res = (False, "broken:%s" % type(exc).__name__)
    _TOOL_PROBE_CACHE[key] = res
    return res

def _locate_tool(key):
    """只做「定位」：返回首个存在的路径或 None（不做可用性判定）。"""
    for c in DECOMPILE_TOOLS.get(key, []):
        if os.path.isabs(c):
            if os.path.isfile(c):
                return c
        else:
            w = shutil.which(c)
            if w:
                return w
    return None

def _resolve_tool(key, usable_only=True):
    """解析白名单工具：先定位，再（默认）真跑一次确认可用。
    usable_only=False 退化为旧行为「只判存在」，仅用于对照/兼容。"""
    for c in DECOMPILE_TOOLS.get(key, []):
        path = c if (os.path.isabs(c) and os.path.isfile(c)) else (
            shutil.which(c) if not os.path.isabs(c) else None)
        if not path:
            continue
        if not usable_only:
            return path
        ok, _reason = _probe_executable(
            path, args=TOOL_PROBE_ARGS.get(key), expect=TOOL_PROBE_EXPECT.get(key))
        if ok:
            return path
    return None

def tool_diagnostics():
    """逐工具的可用性诊断（供 decompile-env 诚实上报）。"""
    out = {}
    for key in ("uncompyle6", "decompyle3", "pylingual", "pycdc", "7z"):
        path = _locate_tool(key)
        if not path:
            out[key] = {"found": False, "usable": False, "reason": "missing"}
            continue
        ok, reason = _probe_executable(
            path, args=TOOL_PROBE_ARGS.get(key), expect=TOOL_PROBE_EXPECT.get(key))
        out[key] = {"found": True, "usable": ok, "reason": reason}
    return out

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
    """据 (major,minor) 选首选反编工具。返回 (toolKey|None, note)。"""
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

def _candidate_tools(mm):
    """首选 + 兜底链。pycdc（Decompyle++）覆盖 2.7 与多数 3.x，作为最后兜底：
    - uncompyle6/decompyle3 在本机因 xdis 版本冲突全部不可用时，pycdc 仍可出源码；
    - 3.9+ pylingual 不可用时也有明确兜底，而不是直接放弃。
    返回 (chain, note)。"""
    primary, note = _pick_decompiler(mm)
    chain = []
    if primary:
        chain.append(primary)
    if mm and mm[0] == 3 and 7 <= mm[1] <= 8 and "decompyle3" not in chain:
        chain.append("decompyle3")
    if "pycdc" not in chain:
        chain.append("pycdc")
    return chain, note

def _decode_tool_output(raw):
    """解反编器输出：优先 UTF-8，失败回退 GB18030（中文 Windows 常见），最后替换。"""
    if not raw:
        return ""
    try:
        return raw.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        return raw.decode("gb18030")
    except UnicodeDecodeError:
        return raw.decode("utf-8", "replace")

def _run_decompiler(tool_key, pyc_path, workdir, timeout=None):
    """调白名单反编工具于单个 pyc。subprocess 参数数组 shell=False。"""
    exe = _resolve_tool(tool_key)
    if not exe:
        found = _locate_tool(tool_key)
        return {"ok": False, "tool": tool_key,
                "error": ("%s 已找到但不可用（探测失败）" % tool_key) if found
                         else ("%s 未安装（本机不可用，需手动安装）" % tool_key)}
    limit = timeout if timeout is not None else DECOMPILE_TIMEOUT
    env = dict(os.environ)
    env["PYTHONUTF8"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    if tool_key == "pylingual":
        # HF 镜像仅供 pylingual 自身模型拉取，绝不上传用户样本（零外发红线）
        env["HF_ENDPOINT"] = "https://hf-mirror.com"
        cmd = [exe, pyc_path]  # 注：pylingual CLI 形态待确认，骨架先占位
    else:
        # uncompyle6 / decompyle3 / pycdc：默认把反编源码写 stdout
        cmd = [exe, pyc_path]
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=limit,
            cwd=workdir, env=env, shell=False,
        )
        src = _decode_tool_output(proc.stdout)
        err = _decode_tool_output(proc.stderr)
        return {
            "ok": proc.returncode == 0 or bool(src.strip()),
            "tool": tool_key, "exe": exe, "exitCode": proc.returncode,
            "source": src, "stderr": err,
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "tool": tool_key, "error": "反编超时（%ds）" % limit}
    except Exception as e:
        return {"ok": False, "tool": tool_key, "error": "反编异常: %s" % e}

def _decompile_pyc_bytes(data, workdir, label="input.pyc"):
    """反编单个 pyc（字节）。按候选链逐个尝试，返回含 pyVersion/tool/source 的结果。"""
    if len(data) < 8:
        return {"ok": False, "error": "文件过小，非有效 pyc"}
    magic4 = data[:4]
    ver, mm = _pyc_version(magic4)
    chain, note = _candidate_tools(mm)
    fp = os.path.join(workdir, os.path.basename(label) or "input.pyc")
    with open(fp, "wb") as f:
        f.write(data)
    result = {"pyVersion": ver, "magic": magic4.hex(), "tool": None, "note": note}
    attempts = []
    deadline = time.time() + PYC_TOTAL_BUDGET
    for tool_key in chain:
        remain = deadline - time.time()
        if remain <= 1:
            attempts.append({"tool": tool_key, "error": "总预算耗尽，未尝试"})
            break
        r = _run_decompiler(tool_key, fp, workdir,
                            timeout=max(5, min(PYC_DECOMPILE_TIMEOUT, int(remain))))
        if r.get("ok") and (r.get("source") or "").strip():
            result.update(r)
            result["ok"] = True
            if attempts:
                result["attempts"] = attempts
            return result
        reason = r.get("error") or (r.get("stderr") or "").strip()[:300] or "无输出"
        attempts.append({"tool": tool_key, "error": reason})
    result["ok"] = False
    result["attempts"] = attempts
    detail = "; ".join("%s: %s" % (a["tool"], a["error"]) for a in attempts)
    result["error"] = (note + "；" if note else "") + ("反编失败（" + detail + "）" if detail else "无可用反编工具")
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
    # D7：真实样本可能解出上百个 pyc，逐个各起一次子进程必然撞超时（实测 222 个 → 137s）。
    # 这里给 exe 分支一个**总体预算**（时间 + 数量），达到任一上限就停止并返回**部分结果 +
    # 明确的截断原因**，而不是靠无限延长超时。
    budget_deadline = time.time() + EXE_TOTAL_BUDGET_SECONDS
    attempted = 0
    truncated = None
    if os.path.isdir(extracted):
        for root, _dirs, names in os.walk(extracted):
            for n in names:
                if not n.lower().endswith(".pyc"):
                    continue
                if len(files) >= EXE_MAX_PYC:
                    truncated = {"reason": "pyc_count_limit", "limit": EXE_MAX_PYC,
                                 "attempted": attempted, "produced": len(files)}
                    break
                if time.time() > budget_deadline:
                    truncated = {"reason": "total_budget_exhausted",
                                 "budget_seconds": EXE_TOTAL_BUDGET_SECONDS,
                                 "attempted": attempted, "produced": len(files)}
                    break
                attempted += 1
                try:
                    with open(os.path.join(root, n), "rb") as pf:
                        d = pf.read()
                except Exception as e:
                    files.append({"name": n, "ok": False, "error": "读取失败: %s" % e})
                    continue
                r = _decompile_pyc_bytes(d, workdir, label=n)
                r["name"] = n
                files.append(r)
            if truncated:
                break
    result = {
        "ok": bool(files),
        "files": files,
        "note": "PyInstaller 解包 + 逐 pyc 反编" if files else "未在解包结果中找到 pyc",
    }
    if truncated:
        # 部分结果也要说明产出不完整的原因，不伪装成完整反编
        result["truncated"] = truncated
        result["partial"] = True
        result["note"] = "已达总体预算，返回部分结果（未覆盖全部 pyc）"
    return result

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
    diag = tool_diagnostics()
    tools_bool = {k: bool(v["usable"]) for k, v in diag.items()}
    tools_bool["pyinstxtractor"] = bool(pk)
    decompile_keys = ("uncompyle6", "decompyle3", "pylingual", "pycdc")
    notes = []
    if xdis_ok and xver:
        # 如实声明已知的版本冲突：不修、不自动 pip，只告诉用户与前端。
        if not diag.get("uncompyle6", {}).get("usable") and \
           not diag.get("decompyle3", {}).get("usable"):
            notes.append(
                "uncompyle6/decompyle3 在本机不可用：其 3.9.3 与已装的 xdis %s 不兼容"
                "（ImportError: PYTHON_VERSION_TRIPLE）。已自动改用 pycdc（Decompyle++）"
                "兜底；本工具不会自动安装/降级第三方包。" % xver)
    if diag.get("pycdc", {}).get("usable"):
        notes.append("pycdc（Decompyle++）已纳入白名单并作为兜底反编器（2.7 / 多数 3.x）。")
    elif diag.get("pycdc", {}).get("found"):
        notes.append("pycdc 同名程序存在但探测失败（需 Decompyle++ 版 pycdc，支持 input.pyc 用法）。")
    return {
        "ok": True,
        "win": IS_WIN,
        "platform": platform.system(),
        "xdis": {"ok": xdis_ok, "version": xver},
        "tools": tools_bool,
        # 逐工具的「找到 / 可用 / 原因」，前端可据此精确灰置并给出原因
        "toolDetails": diag,
        # available 只统计反编工具，避免仅装了 7z 就误报「反编可用」
        "available": any(diag.get(k, {}).get("usable") for k in decompile_keys),
        "decompileAvailable": any(diag.get(k, {}).get("usable") for k in decompile_keys),
        "notes": notes,
    }

class BridgeHandler(BaseHTTPRequestHandler):
    def _cors(self):
        # 反射本机 Origin（修 127.0.0.1 vs localhost 不一致导致的 CORS 拦截）；无 Origin 请求（curl/同源）不带该头
        from urllib.parse import urlparse
        origin = self.headers.get("Origin", "")
        if origin:
            parts = urlparse(origin)
            host = (parts.hostname or "").lower()
            if parts.scheme in ("http", "https") and host in ALLOWED_ORIGIN_HOSTS:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
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
                # 供前端快速识别「本机 bridge.py」并确认反编能力（只读、不拉子进程）
                "product": "EBCTFCodeBox",
                "apiVersion": "1",
                "bridge": "python",
                "decompile": True,
            })
        elif path == "/api/tools":
            info = {}
            for t, p in WHITELIST.items():
                info[t] = {"exists": os.path.isfile(p), "path": p}
            self._send_json(200, {"tools": info, "win": IS_WIN})
        elif path == "/api/env":
            # 环境探测：本机 CTF 常用工具版本（懒检测，仅 GET 触发）
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
            # 读 Windows 注册表系统强调色（ARGB），供前端 M3 动态取色
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
        # 按 tool 取独立超时（默认 60s，长任务可在 TOOL_TIMEOUTS 覆盖；现 CLI 白名单已清空）。
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

def create_extension_server(web_origins=()):
    import importlib.util
    name = "_ebctf_extension_bridge"
    runtime = sys.modules.get(name)
    if runtime is None:
        spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, "mcp", "extension_bridge.py"))
        runtime = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runtime)
        sys.modules[name] = runtime
    return runtime.create_server(ROOT, BridgeHandler, web_origins)


def main():
    if any(a.isdigit() and a != "8181" for a in sys.argv[1:]):
        raise SystemExit("本地桥固定 127.0.0.1:8181，不支持端口漂移")
    try:
        httpd = create_extension_server(("http://localhost:8180", "http://127.0.0.1:8180"))
    except OSError as exc:
        raise SystemExit(str(exc))
    print("本地桥 http://127.0.0.1:8181/；按 Ctrl+C 停止")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
