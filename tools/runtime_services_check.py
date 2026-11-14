import importlib.util
import json
import os
from pathlib import Path
import socket
import urllib.request

root = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("runtime_services", root / "runtime_services.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
service = module.McpService(str(root))
os.environ["EBCRYPTO_MCP_ENABLED"] = "true"
os.environ["EBCRYPTO_MCP_PORT"] = "0"
os.environ["EBCRYPTO_MCP_TOKEN"] = ""
checks = 0
try:
    for unused in range(2):
        state = service.start()
        assert state["state"] == "ready", state
        checks += 1
        url = state["url"]
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {
            "name": "ebctf_run_op", "arguments": {"opId": "base64", "direction": "decode", "input": "SGVsbG8="}}}).encode()
        req = urllib.request.Request(url, body, {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        with urllib.request.urlopen(req, timeout=5) as response:
            assert "Hello" in response.read().decode()
        checks += 1
        port = int(url.split(":")[-1].split("/")[0])
        service.stop()
        sock = socket.socket()
        try:
            assert sock.connect_ex(("127.0.0.1", port)) != 0
        finally:
            sock.close()
        checks += 1
    assert service.start(False)["state"] == "disabled"
    assert service.process is None
    checks += 1
finally:
    service.stop()
print(json.dumps({"result": "PASS", "checks": checks, "pythonMcpLifecycle": True, "actualOp": True}))
