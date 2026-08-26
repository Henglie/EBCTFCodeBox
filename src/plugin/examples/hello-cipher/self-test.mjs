/*
 * hello-cipher 自测（node 直跑）— T358：验证 registerCustomImpl 演示预设。
 * 断言四件事：
 *  1. 两个演示预设的 code 真能往返（encode → decode 复原原文）；
 *  2. 激活插件后 presetsFor("base64") 比加载前多 2 条（1 条绑定 base64 + 1 条全局可见）；
 *  3. 其他 op（md5）只多 1 条（只有全局那条）；
 *  4. 卸载插件后条数回到原数、无 hello-cipher/ 残留——disposers 真的把预设摘干净了。
 * 跑法：node src/plugin/examples/hello-cipher/self-test.mjs
 */
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..", "..");
const toUrl = (rel) => "file:///" + path.join(root, rel).replace(/\\/g, "/");

// node 里补齐浏览器全局（pluginHost / i18n 会用到 localStorage / navigator）
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", { value: { language: "zh-CN" }, configurable: true });
}

const CI = await import(toUrl("src/core/customImpl.js"));
const HOST = await import(toUrl("src/plugin/pluginHost.js"));
const plugin = await import(toUrl("src/plugin/examples/hello-cipher/index.js"));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  PASS " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
};
const run = (code, o = {}) => CI.runCustomImpl({
  code, dir: o.dir || "encode", input: o.input ?? "", params: o.params || {}, rawBytes: o.rawBytes || null,
});

const SAMPLE = "Hello CTF 2026";
const beforeBase64 = CI.presetsFor("base64").length;
const beforeOther = CI.presetsFor("md5").length;

console.log("== 1. 激活插件，取两个演示预设 ==");
await HOST.activate(plugin);
const all = CI.presetsFor("base64");
const pB64 = all.find((p) => p.id === "hello-cipher/b64-rev-table");
const pGlobal = all.find((p) => p.id === "hello-cipher/rot47-global");
ok("找到 hello-cipher/b64-rev-table（绑 base64）", !!pB64);
ok("找到 hello-cipher/rot47-global（全局）", !!pGlobal);
ok("两个预设 id 均带 hello-cipher/ 前缀", !!pB64 && !!pGlobal);

console.log("== 2. 预设 code 往返（真能跑） ==");
{
  const e = run(pB64.code, { dir: "encode", input: SAMPLE });
  const d = run(pB64.code, { dir: "decode", input: e.ok ? e.out : "" });
  ok("b64-rev-table 往返", d.ok && d.out === SAMPLE, JSON.stringify(e.ok ? e.out.slice(0, 24) : e.error));
}
{
  const e = run(pGlobal.code, { dir: "encode", input: SAMPLE });
  const d = run(pGlobal.code, { dir: "decode", input: e.ok ? e.out : "" });
  ok("rot47-global 往返", d.ok && d.out === SAMPLE, JSON.stringify(e.ok ? e.out.slice(0, 24) : e.error));
}

console.log("== 3. 可见性（opId 绑定） ==");
const afterBase64 = CI.presetsFor("base64").length;
ok("presetsFor(base64) 多 2 条", afterBase64 === beforeBase64 + 2, beforeBase64 + " → " + afterBase64);
const afterOther = CI.presetsFor("md5").length;
ok("presetsFor(md5) 只多 1 条（全局）", afterOther === beforeOther + 1, beforeOther + " → " + afterOther);

console.log("== 4. 卸载后摘净（disposers） ==");
HOST.deactivate("hello-cipher");
const backBase64 = CI.presetsFor("base64").length;
const residue = CI.presetsFor("base64").some((p) => p.id.startsWith("hello-cipher/"));
ok("卸载后 presetsFor(base64) 回到原数", backBase64 === beforeBase64, afterBase64 + " → " + backBase64);
ok("无 hello-cipher/ 残留预设", !residue);

console.log("\n== 结果 ==");
console.log("pass " + pass + " / fail " + fail);
if (fail) process.exitCode = 1;
