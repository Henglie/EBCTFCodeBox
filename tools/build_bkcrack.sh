#!/usr/bin/env bash
# 可复现构建 bkcrack WASM 产物 -> public/wasm/bkcrack.{js,wasm}
# 用途：ZIP ZipCrypto 已知明文攻击 (Biham-Kocher)。本项目 A09 链。
#
# 依赖：
#   - emscripten (emcc 6.0.0 已验证)。本机在 C:/Users/Operater/emsdk
#   - cmake >= 3.23，ninja。本机用 pip 装的 cmake 4.4.0 + ninja 1.13
#       py -m pip install cmake ninja
#   - git
#
# 关键决策：
#   bkcrack 的 attack()/recoverPassword() 无条件 std::thread（Attack.cpp:194
#   即使 jobs==1 也建线程，无单线程快路径）→ 必须开 -pthread，关不掉。
#   上游 wasm 分支的 src/bkcrack/CMakeLists.txt 已带 -pthread/-fexceptions，保留。
#   仅把 cli 的 -sEXECUTABLE/-sNODERAWFS(node 专用) 换成本项目
#   MODULARIZE + EXPORT_ES6 浏览器懒加载范式（对齐 sevenzip.js）。
set -euo pipefail

# ---- 按机器调整 ----
EMSDK="${EMSDK:-C:/Users/Operater/emsdk}"
TOOLCHAIN="$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake"
NODE_EXE="$EMSDK/node/22.16.0_64bit/bin/node.exe"
REPO_BRANCH="wasm"   # 上游 emscripten 移植分支
WORKDIR="${WORKDIR:-/tmp/bkcrack_build}"
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/public/wasm"
# --------------------

# cmake / ninja 需在 PATH
export PATH="$HOME/AppData/Local/Programs/Python/Python313/Scripts:$PATH"

rm -rf "$WORKDIR"
git clone --depth 1 --branch "$REPO_BRANCH" https://github.com/kimci86/bkcrack "$WORKDIR"

# 把 cli 链接选项改成 MODULARIZE + ES6（覆盖上游 node 专用形态）
CLI_CMAKE="$WORKDIR/src/cli/CMakeLists.txt"
python - "$CLI_CMAKE" <<'PY'
import sys, re
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
new_block = '''if(EMSCRIPTEN)
    # MODULARIZE + ES6 lazy-load form to match project's sevenzip.js paradigm.
    # NODERAWFS dropped (browser target); use MEMFS via FS runtime API instead.
    # pthread kept: bkcrack unconditionally spawns std::thread (no single-job fast path).
    target_link_options(bkcrack PRIVATE
        -sMODULARIZE=1
        -sEXPORT_ES6=1
        -sEXPORT_NAME=Bkcrack
        -sALLOW_MEMORY_GROWTH=1
        -sENVIRONMENT=web,worker,node
        -sINVOKE_RUN=0
        -sEXIT_RUNTIME=0
        -sFORCE_FILESYSTEM=1
        "-sEXPORTED_RUNTIME_METHODS=FS,callMain,stringToUTF8,UTF8ToString,lengthBytesUTF8")
endif()'''
s = re.sub(
    r'if\(EMSCRIPTEN\)\s*\n\s*target_link_options\(bkcrack PRIVATE -sEXECUTABLE[^\n]*\n\s*endif\(\)',
    new_block, s, count=1)
open(p, "w", encoding="utf-8").write(s)
print("patched", p)
PY

# 配置 + 构建
cmake -S "$WORKDIR" -B "$WORKDIR/build-wasm" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
    -DCMAKE_CROSSCOMPILING_EMULATOR="$NODE_EXE"
cmake --build "$WORKDIR/build-wasm"

# 收产物
mkdir -p "$OUT_DIR"
cp "$WORKDIR/build-wasm/src/cli/bkcrack.js"   "$OUT_DIR/bkcrack.js"
cp "$WORKDIR/build-wasm/src/cli/bkcrack.wasm" "$OUT_DIR/bkcrack.wasm"
cp "$WORKDIR/license.txt"                     "$OUT_DIR/bkcrack.license.txt"

echo "== 产物 =="
ls -l "$OUT_DIR"/bkcrack.*

# smoke：ES module 实例化 + callMain --version
cat > "$WORKDIR/smoke.mjs" <<MJS
import Bkcrack from '${OUT_DIR}/bkcrack.js';
const m = await Bkcrack({ print: s => console.log('[out]', s),
                          printErr: s => console.error('[err]', s) });
m.callMain(['--version']);
MJS
"$NODE_EXE" "$WORKDIR/smoke.mjs"
echo "smoke OK"
