"""Launcher-owned optional services. No network calls or installations on import."""
import json
import os
import queue
import shutil
import signal
import subprocess
import threading


class McpService:
    def __init__(self, root):
        self.root = os.path.realpath(root)
        self.process = None
        self.reader = None
        self.state = {"state": "stopped", "url": "", "tokenRequired": False}

    def _disabled(self):
        override = os.environ.get("EBCRYPTO_MCP_ENABLED")
        if override is not None:
            return override in ("0", "false")
        file = os.environ.get("EBCRYPTO_CONFIG", "ebcrypto.config.json")
        if not os.path.isabs(file):
            file = os.path.join(self.root, file)
        try:
            if os.path.getsize(file) > 65536:
                return False  # The Node validator reports the invalid configuration.
            with open(file, encoding="utf-8") as stream:
                data = json.load(stream)
            return data.get("services", {}).get("mcp", {}).get("enabled") is False
        except (OSError, ValueError, TypeError, AttributeError):
            return False

    def start(self, enabled=True):
        self.stop()
        if not enabled or self._disabled():
            self.state = {"state": "disabled", "url": "", "tokenRequired": False}
            return self.state
        node = shutil.which("node")
        script = os.path.join(self.root, "mcp", "launcher-service.mjs")
        if not node or not os.path.isfile(script):
            self.state = {"state": "unavailable", "url": "", "tokenRequired": False,
                          "error": "Node.js or MCP runtime files unavailable"}
            return self.state
        env = {key: value for key, value in os.environ.items()
               if key not in ("NODE_OPTIONS", "NODE_PATH", "PYTHONPATH", "PYTHONHOME")
               and not key.startswith(("LD_", "DYLD_"))}
        options = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
        results = queue.Queue(maxsize=1)
        try:
            self.process = subprocess.Popen([node, script, "--root", self.root], cwd=self.root,
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, **options)
            process = self.process

            def ready_record():
                try:
                    line = process.stdout.readline(4097)
                    if not line or len(line) > 4096:
                        raise ValueError("Invalid MCP ready record")
                    results.put(json.loads(line.decode("utf-8")))
                except (OSError, ValueError) as error:
                    results.put({"ok": False, "error": str(error)})

            self.reader = threading.Thread(target=ready_record, name="mcp-ready", daemon=True)
            self.reader.start()
            ready = results.get(timeout=8)
            if not ready.get("ok"):
                raise ValueError(ready.get("error", "MCP startup failed"))
            if not ready.get("enabled"):
                self.stop()
                self.state = {"state": "disabled", "url": "", "tokenRequired": False}
            else:
                self.state = {"state": "ready", "url": str(ready.get("url", "")),
                              "tokenRequired": bool(ready.get("tokenRequired"))}
        except (OSError, ValueError, queue.Empty) as error:
            self.stop()
            self.state = {"state": "unavailable", "url": "", "tokenRequired": False,
                          "error": str(error) or "MCP startup timed out"}
        return self.state

    def stop(self):
        process, self.process = self.process, None
        if process:
            try:
                if process.stdin:
                    process.stdin.close()
                process.wait(timeout=2)
            except (OSError, subprocess.TimeoutExpired):
                try:
                    if os.name == "nt":
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=2)
                except (OSError, subprocess.TimeoutExpired):
                    pass
            finally:
                if process.stdout:
                    process.stdout.close()
        if self.reader:
            self.reader.join(timeout=1)
            self.reader = None
        self.state = {"state": "stopped", "url": "", "tokenRequired": False}
