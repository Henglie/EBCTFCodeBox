// decode.mjs — EBCTF 解码技能 CLI 入口（供 Claude Skill / Agent / 命令行调用）。
// 复用 mcp/ebctf-core-adapter 的 callMcpTool 单一事实源，零重写、本地进程、零外发。
//
// 覆盖全部 6 个 MCP 工具：
//   node skills/ebctf-decode/decode.mjs cats
//   node skills/ebctf-decode/decode.mjs list [关键词] [--cat=xxx]
//   node skills/ebctf-decode/decode.mjs schema <opId>
//   node skills/ebctf-decode/decode.mjs detect "<文本>" [--limit=N]
//   node skills/ebctf-decode/decode.mjs run <opId> "<输入>" [encode|decode|run] [--params='{"shift":3}']
//   node skills/ebctf-decode/decode.mjs magic "<文本>" [--crib=xxx] [--depth=N] [--intensive]
//
// ⚠ core 加载时有模块直接 console.log 到 stdout（detectExt 等），会污染 CLI 输出。
//   故加载 core 期间劫持 process.stdout.write 转 stderr，加载完恢复——只让结果走 stdout。
const _realStdoutWrite = process.stdout.write.bind(process.stdout);
process.stdout.write = (chunk, enc, cb) => process.stderr.write(chunk, enc, cb);
const { callMcpTool } = await import("../../mcp/ebctf-core-adapter.mjs");
process.stdout.write = _realStdoutWrite;

const USAGE = `用法：
  cats                                              列分类（含每类 op 数）
  list [关键词] [--cat=分类id]                       列 op（id/分类/名/方向/是否带参）
  schema <opId>                                     查 op 参数 schema
  detect "<文本>" [--limit=N]                        智能识别编码类型（按置信度排序）
  run <opId> "<输入>" [encode|decode|run] [--params='{"k":v}']
                                                    跑 op（params 为 JSON 字符串）
  magic "<文本>" [--crib=xxx] [--depth=N] [--intensive]
                                                    一键智能解码`;

const die = (msg) => {
  process.stderr.write(msg + "\n");
  process.exit(1);
};

// 朴素参数解析：分离 --k / --k=v 旗标与位置参数。
const [, , cmd, ...rawArgs] = process.argv;
const flags = {};
const pos = [];
for (const a of rawArgs) {
  if (a.startsWith("--")) {
    const eq = a.indexOf("=");
    if (eq === -1) flags[a.slice(2)] = true;
    else flags[a.slice(2, eq)] = a.slice(eq + 1);
  } else {
    pos.push(a);
  }
}

// 打结果到 stdout；isError 也照打（让用户看到错误文本），并以 exit 1 收场。
const out = (r) => {
  _realStdoutWrite((r.content?.[0]?.text ?? "") + "\n");
  if (r.isError) process.exit(1);
};

if (cmd === "cats") {
  out(await callMcpTool("ebctf_list_categories", {}));

} else if (cmd === "list") {
  const args = { keyword: pos[0] || "" };
  if (typeof flags.cat === "string") args.cat = flags.cat;
  out(await callMcpTool("ebctf_list_ops", args));

} else if (cmd === "schema") {
  if (!pos[0]) die("缺参：schema <opId>\n\n" + USAGE);
  out(await callMcpTool("ebctf_op_schema", { opId: pos[0] }));

} else if (cmd === "detect") {
  if (!pos[0]) die("缺参：detect \"<文本>\" [--limit=N]\n\n" + USAGE);
  const args = { input: pos[0] };
  if (flags.limit !== undefined) {
    const n = Number(flags.limit);
    if (!Number.isFinite(n)) die(`--limit 需为数字，收到：${flags.limit}`);
    args.limit = n;
  }
  out(await callMcpTool("ebctf_detect", args));

} else if (cmd === "run") {
  const [opId, input, direction] = pos;
  if (!opId || input === undefined) die("缺参：run <opId> \"<输入>\" [encode|decode|run] [--params='{...}']\n\n" + USAGE);
  const args = { opId, input };
  if (direction) {
    if (!["encode", "decode", "run"].includes(direction)) {
      die(`方向须为 encode/decode/run，收到：${direction}`);
    }
    args.direction = direction;
  }
  if (typeof flags.params === "string") {
    let parsed;
    try {
      parsed = JSON.parse(flags.params);
    } catch (e) {
      die(`--params 不是合法 JSON：${e.message}\n  示例：--params='{"shift":3}'`);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      die(`--params 须为 JSON 对象，收到：${flags.params}`);
    }
    args.params = parsed;
  }
  out(await callMcpTool("ebctf_run_op", args));

} else if (cmd === "magic") {
  if (!pos[0]) die("缺参：magic \"<文本>\" [--crib=xxx] [--depth=N] [--intensive]\n\n" + USAGE);
  const args = { input: pos[0] };
  if (typeof flags.crib === "string") args.crib = flags.crib;
  if (flags.depth !== undefined) {
    const n = Number(flags.depth);
    if (!Number.isFinite(n)) die(`--depth 需为数字，收到：${flags.depth}`);
    args.maxDepth = n;
  }
  if (flags.intensive) args.intensive = true;
  out(await callMcpTool("ebctf_magic_decode", args));

} else {
  die((cmd ? `未知命令：${cmd}\n\n` : "") + USAGE);
}
