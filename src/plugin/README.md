# EBCTFCodeBox 插件 SDK

给恒烈CTF编码工具箱写插件的开发指南。纯前端、零构建：一个插件 = 一个标准 ESM 模块，不 import 主项目任何内部模块，只面对 `setup(ctx)` 收到的受控 `ctx`。主项目重构不波及插件。

本文档只描述**真实契约**：字段名、行为、有无生产消费方，全部与 `src/plugin/` 源码一一对应。凡标「预留扩展点」的钩子表示已注册但当前无 UI/运行时消费方，写插件时请按此判断，别当核心能力依赖。

---

## 1. 最小插件

一个插件模块必须导出两样东西：

```js
export const manifest = {
  id: "my-plugin",          // 命名空间前缀，见 §3
  name: "我的插件",
  version: "1.0.0",
};

export default function setup(ctx) {
  ctx.registerOp({
    id: "my-plugin/rot13x",
    cat: "fancy",           // 用主项目现成分类，或先 ctx.addCategory
    name: "示例编码",
    params: [],
    encode: (text) => text,
    decode: (text) => text,
  });
}
```

`setup` 也可以具名导出 `export function setup(ctx){}`，`default` 与具名二选一。`setup` 可以是 async。

---

## 2. 加载与生命周期

宿主是 `pluginHost.js`。三种进场方式：

| 方式 | 函数 | 用途 |
|------|------|------|
| URL 动态加载 | `loadFromUrl(url)` | 用户在插件面板粘贴一个 ESM 模块 URL（同源直载，跨源需用户确认）。加载成功记入 `localStorage` 源表，下次启动自动恢复。 |
| 内置模块 | `enableBuiltin(mod)` | 随主项目分发、已 `import` 的模块，免 URL。 |
| 启动恢复 | `restoreEnabled(builtins)` | 主项目启动时按上次启用列表逐个恢复，单个失败跳过、不阻塞其余、不崩全站。 |

生命周期：

- `activate(mod)` → 校验 manifest → 构造受控 `ctx` → `await setup(ctx)`。
- `setup` **抛错** → 自动 `rollback`，回收该插件已注册的一切（op / cat / i18n / 订阅），主项目保持干净。
- `deactivate(id)` / `uninstall(id)` → 精确回收 + 从持久化移除。

所有注册动作都记进该插件的台账，卸载逐项回收，插件间互不残留。

---

## 3. manifest 契约

`validateManifest` 强校验：

| 字段 | 必填 | 约束 |
|------|------|------|
| `id` | 是 | `/^[a-z0-9-]{2,40}$/`，小写字母/数字/连字符。同时是全部 op/cat id 的**命名空间前缀**。 |
| `name` | 是 | 非空字符串。 |
| `version` | 是 | 非空字符串。 |
| `description` | 否 | 面板展示。 |
| `author` | 否 | 面板展示。 |
| `apiVersion` | 否 | 当前约定为 `1`。 |

**命名空间隔离**：`ctx.registerOp` / `ctx.addCategory` 的 id 必须以 `"<manifest.id>/"` 开头，否则抛错。这防止插件之间、插件与主项目撞 id。

---

## 4. ctx 契约面

`ctx` 由宿主为每个插件单独构造，带 id 前缀校验。它**不提供**文件系统 / 网络原语——纯前端零外发红线。网络只走 AI 层的用户自备通道（见 §7）。

### 4.1 核心能力（有生产消费方，主用这些）

**`ctx.registerOp(op)`** — 注册一个算法 op。注册后自动出现在左侧菜单、搜索。若 op 同时带 `detect` + `decode`，还会被一键智能解码（magic）自动遍历到（见 §5）。返回该 op。id 必须带命名空间前缀。

**`ctx.addCategory(cat)`** — 新增一个左侧分类，`{ id, name, icon? }`，id 带命名空间前缀。想把自己的 op 单独归类时用；也可以直接复用主项目现成分类 id（见 §6）。幂等：同 id 已存在直接返回旧的。

**`ctx.addMessages(dicts)`** — 注入/覆盖 i18n 文案，形如 `{ zh:{key:val}, en:{...}, ja:{...} }`。运行时可扩语言。op 显示名约定用 key `op.<命名空间opId>.name`，分类名用 `cat.<命名空间catId>`。卸载时自动 unmerge。

**`ctx.storage`** — 受控 `localStorage`，以 `ebctf_plugin:<pid>:` 为前缀，插件间互不可见。`get(key)` / `set(key,val)` / `remove(key)`，隐私模式静默忽略。

**`ctx.getLocale()`** — 当前语言码。

**`ctx.onLocaleChange(cb)`** — 订阅语言切换，返回取消函数；卸载时自动调用取消，无需手动清理。

**`ctx.listOps()`** — 只读浅拷贝当前全部 op（`{id,cat,name}`），想基于现有 op 组合时用。

**`ctx.getOp(id)`** — 取单个 op 引用。

**`ctx.toast(msg)`** — 复用主项目提示条，不自造 UI。

**`ctx.log(...args)`** — 带 `[plugin:<pid>]` 前缀的 console 日志，不外发。

**`ctx.plugin`** — 冻结的自身信息快照 `{id, name, version}`。

### 4.2 预留扩展点（已注册、当前无消费方）

以下钩子契约面存在、注册成功、卸载可回收，但当前**无生产消费方**，属预留扩展点，不要当核心卖点依赖：

**`ctx.registerDecoder(contrib)`** — `{id, label, when?, run}`，本意是显式登记一键解码贡献。但因为 magic 直接遍历 `OPS`，只要你的 op 带 `detect`+`decode` 就**已经**自动进入一键解码，无需再调本方法。聚合视图 `allDecoders()` 目前只被插件自测脚本读取，无 UI/内核消费。做 CTF 编码请优先给 op 加 `detect`（§5）。

**`ctx.registerAiProvider(provider)`** — `{id, label, endpoint, models, chat?}`。`aiClient.listProviders()` 会把它并入可选 provider 列表，插件面板 AI 区也会显示其 label，但当前没有面向用户的对话 UI 入口触发 `chatWithTools` / `analyzeWithAi`。这仍是现状：本工具箱的 AI 定位不是内置聊天，而是把能力面暴露给外部 AI 调用——对外主要走 MCP / skills（见 `mcp/`、`skills/`、§9），非本钩子。

---

## 5. op 字段契约（registerOp 的入参）

op 结构与主项目 `registry.js` 完全同构：

| 字段 | 说明 |
|------|------|
| `id` | 全局唯一短标识，插件必须带 `<pid>/` 前缀。 |
| `cat` | 分类 id，必须是合法分类（主项目现成 cat 或先 `addCategory` 挂的）。非法 cat 直接抛错。 |
| `name` | 显示名。会被 `addMessages` 的 `op.<id>.name` 覆盖为可切换语言。 |
| `desc` | 一句话说明，可空。 |
| `params` | 参数声明数组，无参填 `[]`。 |
| `encode(text, p)` / `decode(text, p)` | 双向；只有一向填一个。 |
| `run(text, p)` | 单向工具（哈希/分析类）。填了 `run` 不显示双向切换。 |
| `detect(text)` | 可选。一键解码识别指纹，返回 `0..1` 置信度。 |

`encode` / `decode` / `run` **至少有一个**，否则注册抛错。

**params 每项形状：**

```js
{ key, label, type: 'text'|'number'|'select'|'bool', default, options?, placeholder? }
```

UI 依此自动渲染参数表单，`defaultParams(op)` 用各项 `default` 构造初始参数对象传给你的函数。

**接入一键智能解码（magic）：** 给 op 同时写 `decode` + `detect`，它就会被 magic 的 BFS 自动遍历——无需任何额外注册。`detect(text)` 对疑似输入打分，`0` 表示不像、越接近 `1` 越自信。这是让自定义编码进「一键解码」的**唯一**正确路径。参考 `examples/hello-cipher/index.js` 的 `helloDetect`：先用字符集/长度做弱指纹，再试解、命中 `flag|ctf|key` 才给高分。

---

## 6. 可用的内置分类 id

`addCategory` 之外，可直接把 op 的 `cat` 指向这些主项目现成分类：

`home` `base` `text` `fancy` `cn` `classic` `modern` `hash` `radix` `analysis` `crypto` `forensic` `data` `stego`

（另有 `bridgeLang` / `bridgeStego` / `bridgeForensic` 为本地桥·外部 exe 专用，插件一般不用。）

CTF 自造编码通常归 `fancy`；中文本土编码归 `cn`；古典密码归 `classic`。

---

## 7. 红线

- **零外发**：`ctx` 不给网络/文件原语。插件不能发起任意联网。
- **命名空间**：所有 op/cat id 带 `<pid>/` 前缀，撞名即抛错。
- **不 import 主项目内部模块**：只用 `ctx`。主项目重构不波及你。
- **AI 网络**：唯一对外出口在 `aiClient`，且必须用户自备 endpoint + key，直连用户站点，主项目不中转、不记录。插件不要自建外发通道。

---

## 8. 完整参考插件

`src/plugin/examples/hello-cipher/index.js` 是活样板，演示 `registerOp` / `addCategory` / `addMessages`（含新语言 ja）/ `registerDecoder` / `registerAiProvider` 全部能力面。照抄改名即可起步。

在插件面板点「加载示例」即可启用它，验证注册、菜单出现、i18n 切换、卸载回收全链路。

---

## 9. MCP 能力面（给外部 AI 调用）

插件写的是「工具箱内部多一个 op」；MCP 是「把整个工具箱能力面暴露给外部 AI 客户端调用」。两者互补：你 `registerOp` 挂上的 op，只要带 `detect`+`decode`，就会一并出现在 MCP 的 `ebctf_list_ops` / `ebctf_run_op` / `ebctf_magic_decode` 结果里，无需额外接线。

**单一事实源**：能力面唯一定义在 `src/plugin/mcpBridge.js`，导出 `MCP_TOOLS`（工具描述数组）+ `callMcpTool`（本地 dispatch）。三端复用同一份，不各自重写工具列表或解码逻辑：

- `aiClient`（浏览器内 AI 工具调用）
- `mcp/server.mjs`（Node stdio server，桌面 MCP 客户端接入）
- `skills/`（Claude Code / CLI Agent）

加或改一个能力只动 `mcpBridge.js`，三端自动同步。

**当前暴露 6 个 MCP 工具：**

| 工具 | 入参 | 用途 |
|------|------|------|
| `ebctf_list_categories` | 无 | 列全部功能分类，含每类可见 op 数量。先看能力全景再下钻。 |
| `ebctf_list_ops` | `keyword?` / `cat?` | 列 op，含 `id` / `cat` / `name` / 支持方向 `dir` / 是否带参 `hasParams`。可按关键词或分类过滤。 |
| `ebctf_op_schema` | `opId` | 查指定 op 的完整参数 schema（`key`/`type`/`default`/`options`）与支持方向。跑带参 op 前先查它。 |
| `ebctf_detect` | `input` / `limit?` | 智能识别：对文本跑全部带指纹算法，返回按置信度(0~1)排序的编码类型候选。只判类型不解码。 |
| `ebctf_run_op` | `opId` / `input` / `direction?` / `params?` | 跑指定 op 的 encode/decode/run，支持传自定义 `params`（形状见 `ebctf_op_schema`）。 |
| `ebctf_magic_decode` | `input` / `crib?` / `maxDepth?` / `intensive?` | 一键智能解码，返回按可能性排序的候选明文与解码链路。可开多层链式(`maxDepth` 最大 3)与暴力(`intensive`)。 |

对外可见 op 排除了 `cryptoTryAll` 这个 UI 聚合虚拟 op，`ebctf_list_ops` / `ebctf_detect` / 统计口径一致。

桌面接入配置与自测命令见 [`mcp/README.md`](../../mcp/README.md)。零外发红线同样适用：MCP 是「描述 + 本地 dispatch」，本地进程内跑纯函数，不联网。
