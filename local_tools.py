#!/usr/bin/env python3
"""Local metadata inventory and bounded, fixed-catalog installation jobs.

Detection never imports third-party libraries, loads npm modules or contacts a registry.
Keep one LocalToolsService alive for the lifetime of the HTTP/native bridge.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parent
SCHEMA = 1
PROBE_SECONDS = 5
INSTALL_SECONDS = 180
OUTPUT_BYTES = 128 * 1024
MAX_JOBS = 16
MAX_INTERPRETERS = 8


def _catalog_data(name):
    text = (ROOT / "src/core/localToolCatalog.js").read_text(encoding="utf-8")
    prefix = "export const " + name + " = "
    return json.loads(text.split(prefix, 1)[1].split(";\n", 1)[0])


CATALOG = _catalog_data("LOCAL_TOOL_CATALOG")
MIRRORS = _catalog_data("LOCAL_TOOL_MIRRORS")
BY_ID = {item["id"]: item for item in CATALOG}
PIP_NAMES = [item["package"] for item in CATALOG if item["kind"] == "pip"]

# -I -S prevents cwd/PYTHONPATH/sitecustomize/.pth execution. Only stdlib is imported.
# Explicit site paths retain installed metadata visibility without initializing site.
PY_METADATA = r'''
import sys, os, json, sysconfig, site, importlib.metadata as md
from pathlib import Path
paths = list(dict.fromkeys(list(sysconfig.get_paths().values()) + site.getsitepackages() + [site.getusersitepackages()]))
exe = Path(sys.executable).resolve()
for prefix in (exe.parent, exe.parent.parent):
    if (prefix / 'pyvenv.cfg').is_file():
        paths = [str(prefix / 'Lib/site-packages'), str(prefix / ('lib/python%d.%d/site-packages' % sys.version_info[:2]))]
        cfg = (prefix / 'pyvenv.cfg').read_text(errors='replace').lower()
        if 'include-system-site-packages = true' in cfg:
            paths += site.getsitepackages()
        break
out = {}
for i, dist in enumerate(md.distributions(path=paths)):
    if i >= 8192: raise RuntimeError('metadata entry budget exceeded')
    name = dist.metadata.get('Name', '')
    if name:
        key = name.lower().replace('_', '-').replace('.', '-')
        out[key] = str(dist.version)[:256]
print(json.dumps({'version':sys.version.split()[0], 'packages':out, 'paths':paths, 'executable':sys.executable}))
'''


def _clean_env():
    env = {k: v for k, v in os.environ.items()
           if not k.upper().startswith(("PYTHON", "PIP_", "NPM_CONFIG_"))
           and k.upper() not in ("NODE_OPTIONS", "NODE_PATH", "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS")}
    env.update({"PYTHONIOENCODING": "utf-8", "PIP_CONFIG_FILE": os.devnull, "NO_COLOR": "1"})
    return env


def _stop_process(proc):
    if os.name == "nt" and proc.poll() is not None:
        return
    try:
        if os.name != "nt":
            os.killpg(proc.pid, signal.SIGKILL)
        else:
            # Only a trusted numeric PID; no cmd.exe, shell expansion or user input.
            taskkill = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/taskkill.exe"
            subprocess.run([str(taskkill), "/PID", str(proc.pid), "/T", "/F"],
                           shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=3)
    except (OSError, subprocess.SubprocessError):
        proc.kill()


def run_bounded(argv, timeout=PROBE_SECONDS, budget=OUTPUT_BYTES, cancel=None, on_chunk=None, cwd=None):
    """Drain a single merged pipe; kill on deadline, cancellation or total output limit."""
    proc = subprocess.Popen(argv, shell=False, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=_clean_env(), cwd=cwd or str(ROOT),
                            start_new_session=(os.name != "nt"),
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    chunks, count, lock, exceeded = [], [0], threading.Lock(), threading.Event()

    def drain():
        try:
            while True:
                chunk = proc.stdout.read1(2048)
                if not chunk:
                    break
                with lock:
                    kept = chunk[:max(0, budget - count[0])]
                    count[0] += len(chunk)
                    chunks.append(kept)
                    if kept and on_chunk:
                        on_chunk(kept.decode("utf-8", "replace"))
                    if count[0] > budget:
                        exceeded.set()
                        break
        except (OSError, ValueError):
            pass

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    deadline, reason = time.monotonic() + timeout, ""
    while proc.poll() is None or reader.is_alive():
        if cancel and cancel.is_set():
            reason = "cancelled"
        elif time.monotonic() >= deadline:
            reason = "timeout"
        elif exceeded.is_set():
            reason = "output_limit"
        if reason:
            _stop_process(proc)
            break
        time.sleep(0.02)
    try:
        proc.wait(timeout=4)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=4)
    reader.join(timeout=1)
    if not reader.is_alive():
        proc.stdout.close()
    # A fast producer may have exited before the controller observes its output overflow.
    if exceeded.is_set() and not reason:
        reason = "output_limit"
    with lock:
        text = b"".join(chunks).decode("utf-8", "replace")
    return {"exitCode": proc.returncode, "output": text, "reason": reason,
            "ok": proc.returncode == 0 and not reason}


def _resolve(name):
    path = shutil.which(name)
    if not path or "windowsapps" in path.lower():
        return None
    if os.name == "nt" and Path(path).suffix.lower() in (".cmd", ".bat"):
        return None
    return os.path.abspath(path)


def _node_candidates():
    candidates = [_resolve("node")]
    if os.name == "nt":
        candidates += [str(Path(os.environ.get("ProgramFiles", "")) / "nodejs/node.exe")]
    unique = {}
    for path in candidates:
        if path and Path(path).is_file():
            unique.setdefault(os.path.normcase(path), path)
    return list(unique.values())


def _npm_cli(node):
    base = Path(node).parent
    for path in (base / "node_modules/npm/bin/npm-cli.js", base / "../lib/node_modules/npm/bin/npm-cli.js"):
        if path.is_file():
            return str(path.resolve())
    return None


class LocalToolsError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class LocalToolsService:
    def __init__(self, runner=run_bounded):
        self.runner = runner
        self.lock = threading.RLock()
        self.detect_lock = threading.Lock()
        self.interpreters = {}
        self.nodes = {}
        self.jobs = {}
        self.workers = set()
        self.cache = {}
        self.discovered_at = 0
        # One explicit app-owned npm scope, never a request-supplied filesystem path.
        base = Path(os.environ.get("LOCALAPPDATA", "")) if os.name == "nt" else Path.home() / ".local/share"
        self.npm_prefix = base / "EBCrypto/local-tools/npm"

    def _discover(self):
        if self.interpreters and time.monotonic() - self.discovered_at < 30:
            return
        paths = [sys.executable]
        if os.name == "nt" and _resolve("py"):
            result = self.runner([_resolve("py"), "-0p"])
            for line in result["output"].splitlines():
                match = re.search(r"([A-Za-z]:\\.*?python(?:[0-9.]*)?\.exe)\s*$", line, re.I)
                if match:
                    paths.append(match.group(1))
        paths += [_resolve("python3"), _resolve("python")]
        if os.environ.get("VIRTUAL_ENV"):
            paths.append(str(Path(os.environ["VIRTUAL_ENV"]) / ("Scripts/python.exe" if os.name == "nt" else "bin/python")))
        found = {}
        for path in paths[:MAX_INTERPRETERS * 2]:
            if not path or not Path(path).is_file() or "windowsapps" in path.lower():
                continue
            # Keep a venv executable's path: resolving its symlink would select the base environment.
            path = os.path.abspath(path)
            key = "py-" + hashlib.sha256(os.path.normcase(path).encode()).hexdigest()[:16]
            if key in found or len(found) >= MAX_INTERPRETERS:
                continue
            try:
                result = self.runner([path, "-I", "-S", "-c", "import sys;print(sys.version.split()[0])"])
                if result["ok"] and re.fullmatch(r"\d+\.\d+\.\d+\S*", result["output"].strip()):
                    found[key] = {"id": key, "path": path, "version": result["output"].strip(), "default": not found}
            except (OSError, subprocess.SubprocessError):
                continue
        self.interpreters = found
        self.nodes = {"node-" + hashlib.sha256(p.encode()).hexdigest()[:16]: p for p in _node_candidates()[:4]}
        self.discovered_at = time.monotonic()

    def _python_metadata(self, interpreter):
        result = self.runner([interpreter["path"], "-I", "-S", "-c", PY_METADATA])
        if not result["ok"]:
            raise LocalToolsError("Python metadata probe failed: " + (result["reason"] or str(result["exitCode"])), 503)
        try:
            return json.loads(result["output"])
        except (ValueError, TypeError):
            raise LocalToolsError("Invalid Python metadata response", 503)

    def _npm_scopes(self, node_id):
        scopes = [{"id": "managed", "path": str(self.npm_prefix / "node_modules"), "writable": True}]
        node = self.nodes.get(node_id)
        if node:
            base = Path(node).parent
            paths = [ROOT / "node_modules", base / "node_modules", base / "../lib/node_modules"]
            if os.name == "nt" and os.environ.get("APPDATA"):
                paths.append(Path(os.environ["APPDATA"]) / "npm/node_modules")
            else:
                paths += [Path.home() / ".local/lib/node_modules", Path("/usr/local/lib/node_modules")]
            seen = {scopes[0]["path"]}
            for path in paths:
                path = path.resolve()
                if path.is_dir() and str(path) not in seen:
                    seen.add(str(path))
                    scopes.append({"id": "scope-" + hashlib.sha256(str(path).encode()).hexdigest()[:12],
                                   "path": str(path), "writable": False})
        return scopes

    @staticmethod
    def _npm_metadata(root, package):
        path = Path(root).joinpath(*package.split("/"), "package.json")
        try:
            with path.open("rb") as stream:
                raw = stream.read(65537)
            if len(raw) > 65536:
                raise ValueError("package.json exceeds 64 KiB")
            data = json.loads(raw)
            if data.get("name") != package or not isinstance(data.get("version"), str):
                raise ValueError("package metadata name/version mismatch")
            return {"status": "installed", "version": data["version"][:256], "path": str(path)}
        except FileNotFoundError:
            return {"status": "missing"}
        except (OSError, ValueError, TypeError, AttributeError) as exc:
            return {"status": "error", "error": str(exc)[:256]}

    def detect(self, request=None):
        req = request if request is not None else {}
        self._validate(req, {"pythonId", "nodeId", "npmScope", "refresh"})
        if "refresh" in req and type(req["refresh"]) is not bool:
            raise LocalToolsError("refresh must be boolean")
        if any(type(value) is not str for key, value in req.items() if key != "refresh"):
            raise LocalToolsError("Selection IDs must be strings")
        if not self.detect_lock.acquire(blocking=False):
            raise LocalToolsError("Detection already running", 409)
        try:
            self._discover()
            python_id = req.get("pythonId") or next(iter(self.interpreters), "")
            node_id = req.get("nodeId") or next(iter(self.nodes), "")
            if python_id and python_id not in self.interpreters:
                raise LocalToolsError("Unknown pythonId")
            if node_id and node_id not in self.nodes:
                raise LocalToolsError("Unknown nodeId")
            scopes = self._npm_scopes(node_id)
            scope_id = req.get("npmScope", "managed")
            scope = next((s for s in scopes if s["id"] == scope_id), None)
            if not scope:
                raise LocalToolsError("Unknown npmScope")
            key = (python_id, node_id, scope_id)
            cached = self.cache.get(key)
            if not req.get("refresh") and cached and time.monotonic() - cached[0] < 30:
                return cached[1]
            meta, py_error = {"packages": {}}, ""
            if python_id:
                try:
                    meta = self._python_metadata(self.interpreters[python_id])
                except LocalToolsError as exc:
                    py_error = str(exc)
            tools = {}
            for item in CATALOG:
                if item["kind"] == "pip":
                    name = item["package"].lower().replace("_", "-").replace(".", "-")
                    version = meta["packages"].get(name)
                    tools[item["id"]] = ({"status": "error", "error": py_error} if py_error else
                        {"status": "installed", "version": version} if version else
                        {"status": "missing" if python_id else "unavailable"})
                elif item["kind"] == "npm":
                    tools[item["id"]] = self._npm_metadata(scope["path"], item["package"])
            tools.update(self._runtimes(python_id, node_id))
            result = {"ok": True, "schema": SCHEMA, "catalogCount": len(CATALOG), "tools": tools,
                      "interpreters": list(self.interpreters.values()),
                      "nodes": [{"id": k, "path": v, "npmCli": _npm_cli(v)} for k, v in self.nodes.items()], "npmScopes": scopes,
                      "selected": {"pythonId": python_id, "nodeId": node_id, "npmScope": scope_id},
                      "metadataPaths": meta.get("paths", []), "pipAvailable": "pip" in meta["packages"],
                      "install": {"pip": bool(python_id and "pip" in meta["packages"]),
                                  "npm": bool(node_id and _npm_cli(self.nodes[node_id]) and scope_id == "managed"),
                                  "timeoutSeconds": INSTALL_SECONDS, "outputBytes": OUTPUT_BYTES}}
            self.cache[key] = (time.monotonic(), result)
            return result
        finally:
            self.detect_lock.release()

    def _runtimes(self, python_id, node_id):
        out = {"python": {"status": "installed", "version": self.interpreters[python_id]["version"],
                          "path": self.interpreters[python_id]["path"]} if python_id else {"status": "missing"}}
        probes = {"node": ([self.nodes[node_id], "--version"] if node_id else None),
                  "java": ([_resolve("java"), "-version"] if _resolve("java") else None),
                  "git": ([_resolve("git"), "--version"] if _resolve("git") else None),
                  "sage": ([_resolve("sage"), "--version"] if _resolve("sage") else None)}
        seven = _resolve("7z") or _resolve("7zz")
        if not seven and os.name == "nt":
            path = Path(os.environ.get("ProgramFiles", "")) / "7-Zip/7z.exe"
            seven = str(path) if path.is_file() else None
        probes["7z"] = [seven, "i"] if seven else None
        node = self.nodes.get(node_id)
        npm_cli = _npm_cli(node) if node else None
        # Read npm's own package metadata rather than invoke npm and load configuration.
        out["npm"] = self._npm_metadata(Path(npm_cli).parent.parent.parent, "npm") if npm_cli else {"status": "missing"}
        for key, argv in probes.items():
            if not argv:
                out[key] = {"status": "missing"}
                continue
            try:
                result = self.runner(argv, budget=16384)
                match = re.search(r"\d+(?:\.\d+)+(?:[\w.+-]*)", result["output"])
                out[key] = ({"status": "installed", "version": match.group(0), "path": argv[0]}
                            if result["ok"] and match else {"status": "error", "path": argv[0],
                            "error": result["reason"] or "Version probe failed"})
            except (OSError, subprocess.SubprocessError) as exc:
                out[key] = {"status": "error", "error": str(exc)[:256]}
        return out

    @staticmethod
    def _validate(req, allowed):
        if not isinstance(req, dict) or set(req) - allowed:
            raise LocalToolsError("Unknown request fields")
        if any(not isinstance(value, (str, bool)) for value in req.values()):
            raise LocalToolsError("Invalid field type")

    def plan(self, req):
        self._validate(req, {"id", "mirror", "pythonId", "nodeId", "npmScope"})
        if any(type(value) is not str for value in req.values()):
            raise LocalToolsError("Install fields must be strings")
        item = BY_ID.get(req.get("id"))
        mirror = MIRRORS.get(req.get("mirror", "default"))
        if not item or not mirror or item["kind"] == "runtime":
            raise LocalToolsError("Only fixed pip/npm catalog IDs and mirror enums can be installed")
        # Only already enumerated IDs are accepted; never execute a request-supplied path.
        if item["kind"] == "pip":
            if set(req) & {"nodeId", "npmScope"}:
                raise LocalToolsError("Unexpected npm selection for pip")
            interpreter = self.interpreters.get(req.get("pythonId"))
            if not interpreter:
                raise LocalToolsError("Select an enumerated Python interpreter")
            argv = [interpreter["path"], "-I", "-m", "pip", "--isolated", "--disable-pip-version-check",
                    "install", "--only-binary=:all:", "--no-input", "--retries", "1", "--timeout", "15",
                    "--index-url", mirror["pip"], "--", item["package"]]
            target = interpreter["path"]
        else:
            if "pythonId" in req or req.get("npmScope", "managed") != "managed":
                raise LocalToolsError("npm installs only target the app-managed scope")
            node = self.nodes.get(req.get("nodeId"))
            cli = _npm_cli(node) if node else None
            if not cli:
                raise LocalToolsError("Select an enumerated Node with npm")
            argv = [node, cli, "install", "--prefix", str(self.npm_prefix), "--ignore-scripts", "--no-audit",
                    "--no-fund", "--package-lock=false", "--save=false", "--fetch-retries=1",
                    "--userconfig=" + str(self.npm_prefix / ".ebcrypto-user.npmrc"),
                    "--globalconfig=" + str(self.npm_prefix / ".ebcrypto-global.npmrc"),
                    "--fetch-timeout=15000", "--registry=" + mirror["npm"], "--", item["package"]]
            target = str(self.npm_prefix)
        return {"id": item["id"], "kind": item["kind"], "mirror": req.get("mirror", "default"),
                "argv": argv, "target": target, "timeoutSeconds": INSTALL_SECONDS, "outputBytes": OUTPUT_BYTES}

    def start(self, req):
        plan = self.plan(req)
        with self.lock:
            if any(j["state"] in ("running", "cancelling") for j in self.jobs.values()):
                raise LocalToolsError("An installation is already running", 409)
            if len(self.jobs) >= MAX_JOBS:
                self.jobs.pop(next(iter(self.jobs)))
            job_id = uuid.uuid4().hex
            job = {"jobId": job_id, "id": plan["id"], "state": "running", "log": "", "plan": plan,
                   "cancel": threading.Event(), "startedAt": time.time(), "exitCode": None, "reason": ""}
            self.jobs[job_id] = job
            worker = threading.Thread(target=self._install, args=(job,), daemon=True)
            self.workers.add(worker)
            worker.start()
            return self.job({"jobId": job_id})

    def _install(self, job):
        def log(chunk):
            with self.lock:
                job["log"] = (job["log"] + chunk)[:OUTPUT_BYTES]
        try:
            if job["plan"]["kind"] == "npm":
                self.npm_prefix.mkdir(parents=True, exist_ok=True)
                # Distinct paths: npm rejects loading the same null device twice.
                # These two reserved files are app-owned, never caller-supplied.
                for name in (".ebcrypto-user.npmrc", ".ebcrypto-global.npmrc"):
                    path = self.npm_prefix / name
                    if path.is_symlink():
                        raise PermissionError("npm empty configuration must not be a symlink")
                    path.write_text("", encoding="utf-8")
            result = self.runner(job["plan"]["argv"], timeout=INSTALL_SECONDS, budget=OUTPUT_BYTES,
                                 cancel=job["cancel"], on_chunk=log)
            with self.lock:
                job["state"] = ("cancelled" if job["cancel"].is_set() or result["reason"] == "cancelled" else
                                "succeeded" if result["ok"] else "failed")
                job["reason"], job["exitCode"] = result["reason"], result["exitCode"]
        except Exception as exc:
            with self.lock:
                job["state"], job["reason"] = "failed", str(exc)[:512]
        finally:
            with self.lock:
                job["finishedAt"] = time.time()
                self.cache.clear()
                self.workers.discard(threading.current_thread())

    def job(self, req):
        self._validate(req, {"jobId"})
        with self.lock:
            job = self.jobs.get(req.get("jobId"))
            if not job:
                raise LocalToolsError("Unknown jobId", 404)
            return {"ok": True, "schema": SCHEMA, "job": {k: v for k, v in job.items() if k != "cancel"}}

    def cancel(self, req):
        self._validate(req, {"jobId"})
        with self.lock:
            job = self.jobs.get(req.get("jobId"))
            if not job:
                raise LocalToolsError("Unknown jobId", 404)
            if job["state"] == "running":
                job["state"] = "cancelling"
                job["cancel"].set()
            return self.job(req)

    def dispatch(self, action, req=None):
        methods = {"detect": self.detect, "plan": self.plan, "install": self.start,
                   "job": self.job, "cancel": self.cancel}
        if action not in methods:
            raise LocalToolsError("Unknown action", 404)
        result = methods[action](req if req is not None else {})
        return {"ok": True, "schema": SCHEMA, **result}

    def close(self):
        with self.lock:
            for job in self.jobs.values():
                if job["state"] in ("running", "cancelling"):
                    job["cancel"].set()
            workers = list(self.workers)
        deadline = time.monotonic() + 10
        for worker in workers:
            worker.join(timeout=max(0, deadline - time.monotonic()))


def serve_stdio(input_stream=None, output_stream=None):
    """One long-lived, private worker for a native bridge; no listener, no unsolicited events.

    Each line: {requestId: string, action: enum, payload: object}.
    Native host must apply its existing HTTP authentication/Origin checks before forwarding.
    """
    input_stream = input_stream or sys.stdin.buffer
    output_stream = output_stream or sys.stdout
    service = LocalToolsService()
    previous = {}
    if threading.current_thread() is threading.main_thread():
        def stop_signal(signum, frame):
            # Unwind any held service lock before the finally block closes jobs.
            raise SystemExit(0)
        for signum in (signal.SIGTERM, signal.SIGINT):
            previous[signum] = signal.signal(signum, stop_signal)
    try:
        while True:
            raw = input_stream.readline(4097)
            if not raw:
                break
            request_id, stop = None, len(raw) > 4096
            try:
                if stop:
                    raise LocalToolsError("Request exceeds 4096 bytes", 413)
                envelope = json.loads(raw.decode("utf-8"))
                if not isinstance(envelope, dict) or set(envelope) != {"requestId", "action", "payload"}:
                    raise LocalToolsError("Invalid worker envelope")
                if not isinstance(envelope["requestId"], str) or len(envelope["requestId"]) > 64:
                    raise LocalToolsError("Invalid requestId")
                request_id = envelope["requestId"]
                if not isinstance(envelope["action"], str) or not isinstance(envelope["payload"], dict):
                    raise LocalToolsError("Invalid action or payload")
                result = service.dispatch(envelope["action"], envelope["payload"])
                response = {"requestId": request_id, "status": 200, **result}
            except LocalToolsError as exc:
                response = {"requestId": request_id, "status": exc.status, "ok": False, "schema": SCHEMA, "error": str(exc)}
            except (ValueError, UnicodeError):
                response = {"requestId": request_id, "status": 400, "ok": False, "schema": SCHEMA, "error": "Invalid JSON request"}
            except Exception:
                response = {"requestId": request_id, "status": 500, "ok": False, "schema": SCHEMA, "error": "Local tools service failed"}
            output_stream.write(json.dumps(response, ensure_ascii=True) + "\n")
            output_stream.flush()
            if stop:
                break
    finally:
        service.close()
        for signum, handler in previous.items():
            signal.signal(signum, handler)


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--root" in args:
        index = args.index("--root")
        if index + 1 >= len(args):
            raise SystemExit("Missing --root directory")
        os.chdir(args[index + 1])
        del args[index:index + 2]
    if args != ["--stdio"]:
        raise SystemExit("Usage: local_tools.py [--root directory] --stdio")
    try:
        serve_stdio()
    except KeyboardInterrupt:
        pass
