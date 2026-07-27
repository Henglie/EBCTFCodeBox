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
