---
name: ebctf-decode
description: 用恒烈CTF编码工具箱对疑似编码/加密文本做一键智能解码、智能识别编码类型、或调用其 500+ 编解码算法（可查参数 schema 并带自定义参数运行）。当用户给出看起来被编码的字符串（base64、hex、凯撒、morse、各类 CTF 花式编码等），或明确要求某种编解码时使用。
---

# EBCTF 解码技能

恒烈CTF编码工具箱（EBCTFCodeBox）的对外解码能力。纯本地 Node 进程，零外发。
底层复用工具箱能力面单一事实源（MCP_TOOLS / callMcpTool），零重写解码逻辑。

## 何时用

- 用户贴出疑似被编码的文本，问「这是什么 / 帮我解一下」
- 用户点名某种编码要 encode / decode
- 需要先判断「这是什么编码」再决定怎么解
- CTF 解题中遇到不认识的编码串

## 六个子命令

结果走 stdout，未知命令/缺参打印用法到 stderr 并 exit 1。

### 1. magic — 一键智能解码（最常用）

```
node skills/ebctf-decode/decode.mjs magic "SGVsbG8gd29ybGQ="
node skills/ebctf-decode/decode.mjs magic "..." --crib="flag\{" --depth=3 --intensive
```

- `--crib=xxx` 已知明文片段/正则，命中加权
- `--depth=N` 最大链式解码层数（默认 1，多层传 3）
- `--intensive` 开 1-byte XOR + 位旋转暴力

### 2. detect — 智能识别编码类型（不解码）

```
node skills/ebctf-decode/decode.mjs detect "SGVsbG8gd29ybGQ=" --limit=10
```

返回按置信度(0~1)排序的候选类型。判断「这是什么」时用，随后再 run/magic 解。

### 3. cats — 列分类

```
node skills/ebctf-decode/decode.mjs cats
```

列出全部功能分类（Base/文本/花式/古典/现代加密/哈希/进制/分析/隐写等），含每类 op 数。先看全景再下钻。

### 4. list — 列 op（可过滤）

```
node skills/ebctf-decode/decode.mjs list base
node skills/ebctf-decode/decode.mjs list --cat=classic
```

- 位置参数 = 关键词（匹配 id/名称/分类）
- `--cat=分类id` 按分类精确过滤（分类 id 见 cats）

每条含 id、分类、名称、方向(encode/decode/run)、是否带参(hasParams)。

### 5. schema — 查 op 参数

```
node skills/ebctf-decode/decode.mjs schema caesar
```

查指定 op 的参数 schema（key/类型/默认值/可选项）与支持方向。跑带参 op 前先用它了解怎么填 --params。

### 6. run — 精确跑 op

```
node skills/ebctf-decode/decode.mjs run base64 "SGVsbG8=" decode
node skills/ebctf-decode/decode.mjs run caesar "Khoor" decode --params='{"shift":3}'
```

- 第 3 位置参数 = 方向 encode/decode/run（缺省自动）
- `--params='{"k":v}'` 自定义参数（JSON 字符串，解析成对象传入；不合法给清晰报错）。未给的 key 用默认值，key 见 schema。

## 输出解读

`magic` 返回按置信度排序的候选，每条含解码链路 + conf%：

```
#1 [base64] conf=99% : Hello world
#2 [base64 > rot13] conf=40% : ...
```

取 #1，语义不通就看后续。链路里的 `>` 表示多层解码顺序。

`detect` 返回 candidates 数组（id/cat/name/confidence），置信度高的更可能。

`cats`/`list`/`schema` 返回 JSON，直接读字段。`run` 直接输出结果文本。
