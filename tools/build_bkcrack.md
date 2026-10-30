# bkcrack WASM 构建说明（A09 链）

bkcrack = ZIP ZipCrypto 传统加密的已知明文攻击工具（Biham-Kocher）。
上游 https://github.com/kimci86/bkcrack ，`wasm` 分支专配 emscripten。

本次已在本机成功构建并产出，脚本见 `tools/build_bkcrack.sh`。本文档记录
决策与参数，供人工/CI 复现。

## 产物

| 文件 | 大小 | 说明 |
|------|------|------|
| `public/wasm/bkcrack.js` | ~89 KB | MODULARIZE ES6 胶水，默认导出 `Bkcrack` |
| `public/wasm/bkcrack.wasm` | ~370 KB | 核心 |
| `public/wasm/bkcrack.license.txt` | - | zlib/libpng，上游 license.txt |

版本：bkcrack 1.8.1 (2025-10-25)。无独立 `.worker.js`（新版 emscripten pthread 内联）。

## 环境依赖

- emscripten：emcc **6.0.0** 已验证。本机 `C:/Users/Operater/emsdk`。
- cmake >= 3.23 + ninja。本机无系统 cmake，用 pip 装：
  `py -m pip install cmake ninja`（装到 Python313/Scripts，需入 PATH）。
- git。
- toolchain：`$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake`

> 注意：本机 emcmake/emcc 是 `.exe` 而非 `.bat`，`emcmake` wrapper 在 bash 下
> 找 `.bat` 会失败。脚本改为直接 `cmake -DCMAKE_TOOLCHAIN_FILE=...` 绕过 wrapper。

## 核心决策：pthread 关不掉

bkcrack 的 `attack()`（src/bkcrack/Attack.cpp:194）和 `recoverPassword()`
无条件构造 `std::vector<std::thread>`，**即使 jobs==1 也建线程**，没有单线程
快路径。关掉 `-pthread` 会编译/链接失败或运行时 abort。因此：

- **保留**上游 `src/bkcrack/CMakeLists.txt` 里 EMSCRIPTEN 分支的
  `-fexceptions -pthread -sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency
  -sINITIAL_MEMORY=64mb -sSTACK_SIZE=1mb`，原样不动。
- pthread + wasm 意味着运行时需要 **crossOriginIsolated**（COOP/COEP 头），
  前端桥（A10）与部署需注意：页面必须带
  `Cross-Origin-Opener-Policy: same-origin` +
  `Cross-Origin-Embedder-Policy: require-corp`，否则 `SharedArrayBuffer`
  不可用，pthread 起不来。本项目 sw.js / bridge.py 若要跑 bkcrack 需补这两个头。

## 唯一改动：cli 链接选项换成本项目范式

只改 `src/cli/CMakeLists.txt` 的 EMSCRIPTEN 分支。上游是 node 专用
(`-sEXECUTABLE -sENVIRONMENT=node -sNODERAWFS`)，换成对齐 `sevenzip.js` 的
浏览器懒加载形态：

```cmake
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
```

- `NODERAWFS` 去掉（那是直读本机 fs 的 node 专用）；浏览器改用 MEMFS，
  文件通过 `FS` 运行时 API 写入虚拟盘，故加 `FORCE_FILESYSTEM`。
- `INVOKE_RUN=0`（=noInitialRun）+ 导出 `callMain`：懒加载后手动传 argv 调用，
  和 sevenzip.js 一致。
- `EXIT_RUNTIME=0`：callMain 后运行时保活，可多次调用。

## 复现步骤

```bash
bash tools/build_bkcrack.sh
# 或手动：
EMSDK=C:/Users/Operater/emsdk
git clone --depth 1 --branch wasm https://github.com/kimci86/bkcrack /tmp/bk
# 按上节改 /tmp/bk/src/cli/CMakeLists.txt
export PATH="$HOME/AppData/Local/Programs/Python/Python313/Scripts:$PATH"
cmake -S /tmp/bk -B /tmp/bk/build-wasm -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake \
  -DCMAKE_CROSSCOMPILING_EMULATOR=$EMSDK/node/22.16.0_64bit/bin/node.exe
cmake --build /tmp/bk/build-wasm
cp /tmp/bk/build-wasm/src/cli/bkcrack.{js,wasm} public/wasm/
```

## smoke 验证

```js
import Bkcrack from './public/wasm/bkcrack.js';
const m = await Bkcrack({ print: console.log });
m.callMain(['--version']);   // => bkcrack 1.8.1 - 2025-10-25
```

已在本机 node 22.16 通过（实例化 OK + 版本输出）。

## 前端桥 A10 待办（本卡不做）

- 用法：`callMain` 传 bkcrack CLI 参数。典型已知明文攻击：
  `bkcrack -C cipher.zip -c inner.ext -p plain.bin` 得三个 key，
  再 `bkcrack -C cipher.zip -k X Y Z -D out.zip` 解密。
- 文件经 `FS.writeFile` 写进 MEMFS 后再传路径给 callMain；产物用 `FS.readFile` 取回。
- stdout/stderr 走 `print`/`printErr` 回调，需解析 "Keys" 行拿 X Y Z。
- 部署务必配 COOP/COEP（见上「pthread」节），否则 pthread 无法启动。

## 本地运行页面（bkcrack op 的硬前置）

`public/wasm/bkcrack.js` 是 pthread 构建，**页面本身**必须处于 cross-origin isolated
上下文；只有 wasm 文件本身带 header 没有用。浏览器要求：

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

且页面是 `http://127.0.0.1|localhost` 或 HTTPS（安全上下文）。全部 JS/wasm/字体等
资源必须同源，或带 CORS/CORP，否则 COEP 会拦资源。

正确做法：

```bat
python 通用点我启动.py
```

它默认在 `127.0.0.1:8180` 起静态服务，`end_headers` 已对每个响应下发上面两个头。

**不满足的常见场景（会看到 op 的明确错误，不是攻击失败）**：

- `python -m http.server 8899` → 无 COOP/COEP；
- VS Code Live Server / 各类静态托管默认 → 无 COOP/COEP；
- 直接 `file://` 打开 → 不是安全上下文；
- 用 `bridge.py` 打开页面 → bridge.py 只提供 `/api/*`，不托管 UI，也不会给页面加头。

自检：页面 DevTools Console 执行 `crossOriginIsolated`，必须为 `true`；
`typeof SharedArrayBuffer === "function"` 也是必要条件。op 入口会先做这两个检查，
不满足时立即输出修复步骤并停止，不会加载 wasm、不会卡在“点击转换”。

已用 Playwright/Chromium（`serviceWorkers: "block"`）实测：
带上述两头的本地服务 `crossOriginIsolated=true`，bkcrack wasm `--version` 输出
`bkcrack 1.8.1 - 2025-10-25`；同一环境下 `-k` 已知密钥态解密真实 ZipCrypto 条目
成功（16 字节原文逐字节一致）；无头服务 `crossOriginIsolated=false`，op 只报错
不启动攻击。

已知明文攻击仍是 CPU 密集型，且 **浏览器 wasm 的多线程调度有坑**：同一 174B
Stored ZipCrypto 样本（`known` 区 727208 个候选）在 Chromium 里按默认线程数
（hardwareConcurrency）跑，10 分钟未完成；改用 `-j 1` 后 **约 130–150 s** 找到 key：
`fb6dee11 9733c503 63560e7a`。因此 op 现在把并行线程数做成参数（默认 **1**，
可调 1-64），并在执行区打印 `并行线程: N`。native `bkcrack.exe` 同一样本约 11 s，
可作为性能基线。不要把“多线程更慢/超时”当假成功。
