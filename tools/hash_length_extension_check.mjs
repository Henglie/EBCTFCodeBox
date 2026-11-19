import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getOp, defaultParams } from "../src/core/registry.js";
import "../src/core/hashLengthExtension.js";

let checks = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks++; };
const hash = (algo, bytes) => createHash(algo).update(bytes).digest("hex");
const op = getOp("hashLengthExtension");

for (const algo of ["md5", "sha1", "sha256"]) {
  const secret = Buffer.from("ISCC secret");
  const original = Buffer.from("user=guest");
  const append = Buffer.from("&role=admin");
  const output = op.run(append.toString(), {
    ...defaultParams(op),
    algo,
    originalHash: hash(algo, Buffer.concat([secret, original])),
    originalMessage: original.toString(),
    originalMessageEnc: "utf8",
    originalLength: secret.length + original.length,
    appendEnc: "utf8",
  });
  const newHash = output.match(/新哈希 new_hash = ([0-9a-f]+)/)?.[1];
  const newMessageHex = output.match(/完整新消息 new_message[^\n]*\n\s*hex: ([0-9a-f]+)/)?.[1];
  assert.ok(newHash && newMessageHex, `${algo} returns signature and complete message`);
  const newMessage = Buffer.from(newMessageHex, "hex");
  equal(newMessage.subarray(0, original.length).toString(), original.toString(), `${algo} retains original message`);
  equal(newMessage[original.length], 0x80, `${algo} includes glue padding`);
  equal(newMessage.subarray(-append.length).toString(), append.toString(), `${algo} retains appended data`);
  equal(hash(algo, Buffer.concat([secret, newMessage])), newHash, `${algo} signature matches secret || new_message`);
}

const secret = Buffer.from([0x00, 0x73, 0x65, 0x63, 0x72, 0x65, 0x74, 0xff]);
const original = Buffer.from([0x00, 0xff, 0x10, 0x80]);
const append = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
const output = op.run(append.toString("hex"), {
  ...defaultParams(op),
  algo: "sha256",
  originalHash: hash("sha256", Buffer.concat([secret, original])),
  originalMessage: original.toString("hex"),
  originalMessageEnc: "hex",
  originalLength: secret.length + original.length,
  appendEnc: "hex",
});
const newMessageHex = output.match(/完整新消息 new_message[^\n]*\n\s*hex: ([0-9a-f]+)/)?.[1];
assert.ok(newMessageHex, "binary original message returns hex");
equal(newMessageHex.startsWith(original.toString("hex")), true, "binary original message preserved byte-for-byte");
equal(newMessageHex.endsWith(append.toString("hex")), true, "binary append preserved byte-for-byte");

console.log(JSON.stringify({ reference: "OpenSSL via node:crypto", checks, verdict: "PASS" }));
