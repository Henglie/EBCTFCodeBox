import assert from "node:assert/strict";
import { createHash, createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { extendSM3, sm3Padding } from "../src/core/sm3Extension.js";
import { sm4CbcFlip, recoverReusedStream, sm4EcbRecover } from "../src/core/sm4Attacks.js";
import { sm4Encrypt, sm4GcmEncrypt, sm4GcmDecrypt, sm4EncryptBlock } from "../src/core/modernExt.js";
import { sm3 } from "../src/core/hashExt.js";
import { cryptoTryAll } from "../src/core/cryptoTryAll.js";
import { hmacSM3 } from "../src/core/hashCrack.js";
import { getOp, defaultParams } from "../src/core/registry.js";
import { isExplicitRunOp } from "../src/core/explicitRun.js";
let checks = 0;
const equal = (a, b, message) => { assert.deepEqual(a, b, message); checks++; };
const bad = (fn, pattern) => { assert.throws(fn, pattern); checks++; };
const hash = bytes => createHash("sm3").update(bytes).digest("hex");
for (const length of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 128, 1000]) for (const size of [0, 1, 55, 56, 64, 130]) {
  const original = Buffer.from(Array.from({ length }, (_, i) => i % 251));
  const append = Buffer.from(Array.from({ length: size }, (_, i) => 255 - i % 251));
  const r = extendSM3(hash(original), String(length), append);
  equal(r.digest, hash(Buffer.concat([original, r.suffix])), `OpenSSL SM3 extension ${length}/${size}`);
  equal((length + r.glue.length) % 64, 0, "glue alignment");
}
bad(() => extendSM3("00", "3", new Uint8Array()), /32-byte/);
bad(() => extendSM3("00".repeat(32), "-1", new Uint8Array()), /integer/);
bad(() => sm3Padding(1n << 61n), /invalid/);
const glue = sm3Padding(1n << 32n);
equal(new DataView(glue.buffer).getBigUint64(glue.length - 8), (1n << 35n), "64-bit padding length preserved");
const secret = Buffer.from("secret"), original = Buffer.from("a=1"), extra = Buffer.from("&admin=1");
const hmac = createHmac("sm3", secret).update(original).digest("hex");
const invalid = extendSM3(hmac, String(secret.length + original.length), extra);
equal(invalid.digest !== createHmac("sm3", secret).update(Buffer.concat([original, invalid.suffix])).digest("hex"), true, "HMAC negative control");

const key = Buffer.from("0123456789abcdeffedcba9876543210", "hex"), iv = Buffer.alloc(16);
const cipher = (mode, plain, value = iv) => { const c = createCipheriv(`sm4-${mode}`, key, mode === "ecb" ? null : value); c.setAutoPadding(false); return Buffer.concat([c.update(plain), c.final()]); };
const decipher = (mode, bytes, value = iv) => { const c = createDecipheriv(`sm4-${mode}`, key, mode === "ecb" ? null : value); c.setAutoPadding(false); return Buffer.concat([c.update(bytes), c.final()]); };
for (const mode of ["ctr", "ofb"]) {
  const known = Buffer.from("known plaintext for SM4 stream reuse"), target = Buffer.from("flag{sm4_stream_reuse}"), c1 = cipher(mode, known), c2 = cipher(mode, target);
  equal(Buffer.from(recoverReusedStream(c1.toString("hex"), c2.toString("hex"), known.toString("hex")).bytes), target, `OpenSSL ${mode} recovery`);
  equal(Buffer.from(sm4Encrypt(known, key, { mode: mode.toUpperCase(), iv })), c1, `SM4 ${mode} primitive differential`);
}
const block = Buffer.from("0123456789abcdeffedcba9876543210", "hex");
equal(cipher("ecb", block).toString("hex"), "681edf34d206965e86b3e94f536e4246", "SM4 official vector");
const ct = cipher("ecb", Buffer.concat([block, block]));
const dictionary = `${block.toString("hex")}|${ct.subarray(0, 16).toString("hex")}`;
equal(sm4EcbRecover(ct.toString("hex"), dictionary).blocks.join(""), Buffer.concat([block, block]).toString("hex"), "ECB codebook");
equal(sm4EcbRecover("00".repeat(16), dictionary).complete, false, "Unknown ECB block retained");
bad(() => sm4EcbRecover(ct.toString("hex"), dictionary + "\n" + "00".repeat(16) + "|" + ct.subarray(0, 16).toString("hex")), /conflicting/);
for (const offset of [0, 4, 16, 20]) {
  const plain = Buffer.alloc(48, 65), c = cipher("cbc", plain), input = Buffer.concat([iv, c]);
  const result = sm4CbcFlip(input.toString("hex"), "4141", "4243", offset);
  const modified = Buffer.from(result.bytes), output = decipher("cbc", modified.subarray(16), modified.subarray(0, 16));
  equal(output.subarray(offset, offset + 2).toString(), "BC", `CBC bitflip ${offset}`);
  equal(result.damagedBlock, offset >= 16 ? 0 : null, "corruption range disclosed");
}
bad(() => sm4CbcFlip("00".repeat(48), "0000", "0101", 15), /crosses/);
bad(() => recoverReusedStream("00", "00", "0000"), /invalid/);

// Independent OpenSSL SM4-GCM, including official RFC 8998 A.1 vector.
const nonce = Buffer.from("00001234567800000000abcd", "hex"), aad = Buffer.from("feedfacedeadbeeffeedfacedeadbeefabaddad2", "hex");
const gcm = (plain, ad = aad) => { const c = createCipheriv("sm4-gcm", key, nonce); c.setAAD(ad); return { ct: Buffer.concat([c.update(plain), c.final()]), tag: c.getAuthTag() }; };
const official = Buffer.from("aaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbccccccccccccccccddddddddddddddddeeeeeeeeeeeeeeeeffffffffffffffffeeeeeeeeeeeeeeeeaaaaaaaaaaaaaaaa", "hex");
const officialEncrypted = gcm(official);
equal(officialEncrypted.tag.toString("hex"), "83de3541e4c2b58177e065a9bf7b62ec", "RFC8998 tag");
equal(Buffer.from(sm4GcmEncrypt(official, key, nonce, aad)), Buffer.concat([officialEncrypted.ct, officialEncrypted.tag]), "OpenSSL entire GCM output");
const samples = [Buffer.alloc(16, 0), Buffer.alloc(16, 1), Buffer.alloc(16, 2)].map(plain => { const out = gcm(plain, Buffer.alloc(0)); return `|${out.ct.toString("hex")}|${out.tag.toString("hex")}`; }).join("\n");
const target = gcm(Buffer.from("flag{forged_sm4!}"), Buffer.alloc(0));
const op = getOp("sm4GcmForgery");
equal(isExplicitRunOp("sm4GcmForgery") && isExplicitRunOp("gcmForbidden"), true, "GCM factorization uses the cancellable Worker channel");
const forged = op.run("", { ...defaultParams(op), samples, newCt: target.ct.toString("hex") });
const tags = [...forged.text.matchAll(/伪造 tag[^=]*= ([a-f0-9]{32})/g)].map(m => m[1]);
equal(tags.includes(target.tag.toString("hex")), true, "SM4 GCM forgery matches independent tag");
for (const tag of tags) equal(Buffer.from(sm4GcmDecrypt(Buffer.concat([target.ct, Buffer.from(tag, "hex")]), key, nonce, Buffer.alloc(0))).toString(), "flag{forged_sm4!}", "forged authentication passes");
equal(forged.text.includes(Buffer.from(sm4EncryptBlock(Buffer.alloc(16), key)).toString("hex")), true, "Recovered H equals independent E_K(0)");
const hashOp = getOp("hashDictCrack"), rainbow = getOp("rainbowQuery");
for (const [keyText, message] of [["", ""], ["admin", "message"], ["x".repeat(100), "中文消息"]]) equal(hmacSM3(keyText, message), createHmac("sm3", keyText).update(message).digest("hex"), "OpenSSL HMAC-SM3");
equal((await getOp("hmacKeyBrute").run(hmacSM3("admin", "message"), { algo: "SM3", message: "message", dict: "top1000" })).includes("密钥: admin"), true, "SM3 HMAC weak-key dictionary");
equal((await hashOp.run(sm3("password"), { ...defaultParams(hashOp), algo: "sm3" })).includes("明文: password"), true, "SM3 dictionary path");
equal((await rainbow.run(sm3("admin"), { algo: "sm3" })).includes("明文: admin"), true, "SM3 lookup path");
for (const mode of ["ECB", "CBC", "CFB", "OFB", "CTR"]) {
  const plain = Buffer.from("flag{sm4_try_all}"), encrypted = sm4Encrypt(plain, key, { mode, iv });
  equal(iv.toString("hex"), "00".repeat(16), `${mode} never mutates caller Buffer IV`);
  const results = await cryptoTryAll({ cipherText: Buffer.from(encrypted).toString("hex"), keyText: key.toString("hex"), ivText: iv.toString("hex"), crib: "flag{" }, { algos: ["sm4"], modes: [mode], encodings: ["hex"], minConfidence: 0 });
  equal(results.some(r => r.algo === "SM4" && r.plaintext === plain.toString()), true, `SM4 try-all ${mode}`);
}
console.log(JSON.stringify({ reference: "OpenSSL via node:crypto", checks, verdict: "PASS" }));
if (process.argv.includes("--example")) console.log(JSON.stringify({ sm3: extendSM3(hash(Buffer.from("abc")), "3", Buffer.from("d")).digest, samples, targetCt: target.ct.toString("hex"), targetTag: target.tag.toString("hex") }, null, 2));
