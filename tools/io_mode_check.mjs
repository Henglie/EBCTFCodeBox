import assert from "node:assert/strict";
import { OPS, inferIoMode, getOp } from "../src/core/registry.js";
import "../src/core/registerAll.js";

let checks = 0;
const check = (op, expected, label) => { assert.equal(inferIoMode(op), expected, label); checks++; };
check({ run: function (input) { const n = input.length; return [n].map(x => x); } }, "text", "A nested arrow cannot hide an earlier input reference");
check({ run: p => p.length }, "text", "Single arrow and p-named input");
check({ run: async input => input }, "text", "Async single arrow");
check({ run(input) { return input; } }, "text", "Method shorthand");
check({ run: function* (input) { yield input; } }, "text", "Generator");
check({ run: ({ text }) => text }, "text", "Destructuring is conservatively visible");
check({ run: (_input, params) => params.n }, "none", "Unused first argument");
check({ run: () => 42 }, "none", "No-argument generator");
check({ acceptsBytes: true, run: (_input, params) => params.rawBytes }, "text", "Byte consumers retain the file drop area");
check({ io: "none", acceptsBytes: true, run: () => 1 }, "none", "Explicit metadata takes precedence");
check({ run: Math.abs.bind(null) }, "text", "Opaque bound functions stay visible");
const replaced = { run: () => 1 };
check(replaced, "none", "Initial cached generator");
replaced.run = input => input;
check(replaced, "text", "Replacing an implementation invalidates inference cache");
for (const id of ["freqDist", "trafficReadable", "entropy"]) {
  assert(getOp(id), `${id} registered`);
  check(getOp(id), "text", `${id} keeps its actual input`);
}
const missing = OPS.filter(op => op.acceptsBytes && op.io !== "none" && inferIoMode(op) !== "text");
check(getOp("rsaModinv"), "none", "Dual-direction parameter-only operation does not require dummy input");
assert.equal(getOp("rsaModinv").encode("", { a: "3", m: "11" }), "4"); checks++;
assert.equal(getOp("rsaModinv").decode("", { a: "4", m: "11" }), "3"); checks++;
assert.deepEqual(missing.map(op => op.id), [], "Every byte consumer has an input target"); checks++;
console.log(JSON.stringify({ verdict: "PASS", checks, operations: OPS.length, byteConsumers: OPS.filter(op => op.acceptsBytes).length }));
