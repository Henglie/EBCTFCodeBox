/*
 * pgp.js — PGP/GPG 全家（openpgp.js v5.11.2 封装，cat:'crypto'）。
 *
 * vendor：src/vendor/openpgp.min.js（OpenPGP.js v5.11.2，LGPL，UMD 尾部经 export default ESM 化；
 * 来源 https://cdn.jsdelivr.net/npm/openpgp@5.11.2/dist/openpgp.min.js）。动态 import() 懒加载，
 * 首次使用 PGP 功能才载入 ~550KB，不拖慢首屏。
 *
 * 8 op 对标 CyberChef PGP 分类（RFC 4880/6637/4880bis ECC）：
 *   pgpGenKeyPair / pgpEncrypt / pgpDecrypt / pgpSign / pgpVerify /
 *   pgpEncryptAndSign / pgpDecryptAndVerify / pgpParseKey
 *
 * 产物协议：{ text, files:[{name,mime,bytes}] }（T361 协议）；私钥产物标 ⚠ 敏感。
 * 北极星：算法实现交给经广泛使用的 openpgp.js（权威源），本文件只做参数封装与产物化。
 */
import { register } from "./registry.js";

let _lib = null;
async function lib() {
  if (!_lib) _lib = (await import("../vendor/openpgp.min.js")).default;
  return _lib;
}

const ENC_FILE = { name: "message.asc", mime: "application/pgp-encrypted" };
const SIG_FILE = { name: "signature.sig", mime: "application/pgp-signature" };
const enc = new TextEncoder();
const dec = new TextDecoder();

/** files 通道辅助：文本 → bytes 产物。 */
function fileOf(name, mime, text) {
  return { name, mime, bytes: enc.encode(text) };
}

/** 统一返回：text 报告（尾注产物行）+ files。 */
function emit(text, files, sensitive = false) {
  const tail = sensitive
    ? `\n\n产物：${files.length} 个文件可下载（含私钥 ⚠ 敏感请妥善保管，勿上传/外传）`
    : `\n\n产物：${files.length} 个文件可下载`;
  return { text: text + tail, files };
}

async function genKeys({ name, email, passphrase, alg }) {
  const o = await lib();
  const r = await o.generateKey({
    type: alg === "rsa3072" ? "rsa" : "ecc",
    curve: alg === "rsa3072" ? undefined : "curve25519",
    rsaBits: alg === "rsa3072" ? 3072 : undefined,
    // 实测：v5.11 只认对象形式且 email 需带 TLD（纯字符串形式报 Invalid user ID format）
    userIDs: [{ name: name || "EBCTFCodeBox", email: email || "user@local.dev" }],
    passphrase: passphrase || undefined,
    format: "armored",
  });
  return r;
}

async function readPriv(armored, passphrase) {
  const o = await lib();
  const k = await o.readKey({ armoredKey: armored });
  // 实测：无口令私钥调 decryptKey 抛 "Key packet is already decrypted"，跳过
  if (passphrase) return await o.decryptKey({ privateKey: k, passphrase });
  return k;
}

register({
  id: "pgpGenKeyPair", cat: "asym",
  family: "pgp", familyLabel: "keygen", name: "PGP 密钥对生成",
  desc: "PGP 密钥对生成（RFC 4880，openpgp.js v5.11.2）：Curve25519（默认）或 RSA-3072，可选口令保护私钥。输出 ASCII Armor 公/私钥块，公/私钥分开下载（私钥 ⚠ 敏感）",
  params: [
    { key: "name", label: "用户名", type: "text", default: "EBCTFCodeBox" },
    { key: "email", label: "邮箱", type: "text", default: "user@local.dev" },
    { key: "passphrase", label: "私钥口令（可空）", type: "text", default: "" },
    { key: "alg", label: "算法", type: "select", default: "ecc", options: [
      { value: "ecc", label: "Curve25519（ECDH/EdDSA，推荐）" },
      { value: "rsa3072", label: "RSA-3072（兼容老客户端）" },
    ] },
  ],
  run: async (_t, p) => {
    const { publicKey, privateKey } = await genKeys(p || {});
    const key = await (await lib()).readKey({ armoredKey: publicKey });
    const text = [
      "=== PGP 密钥对生成（RFC 4880）===",
      `算法: ${p?.alg === "rsa3072" ? "RSA-3072" : "Curve25519（ECDH+EdDSA）"}`,
      `KeyID: ${key.getKeyID().hex}`,
      `创建: ${key.getCreationTime().toISOString()}`,
      `用户: ${(key.getUserIDs()[0] || "")}`,
      `指纹: ${key.getFingerprint().toUpperCase().replace(/(.{4})/g, "$1 ").trim()}`,
      "",
      "— 公钥（可分发）—",
      publicKey,
      "",
      "— 私钥（⚠ 敏感" + (p?.passphrase ? "，口令保护" : "，无口令保护") + "）—",
      privateKey,
    ].join("\n");
    return emit(text, [fileOf("pgp_public.asc", "application/pgp-keys", publicKey), fileOf("pgp_private.asc", "application/pgp-keys", privateKey)], true);
  },
});

register({
  id: "pgpEncrypt", cat: "asym",
  family: "pgp", familyLabel: "encrypt", name: "PGP 加密",
  desc: "PGP 加密（RFC 4880 CFB/EAX，openpgp.js）：明文 + 公钥块 → ASCII Armor 密文；可选附带私钥签名（先签后加）",
  params: [
    { key: "pubKey", label: "对方公钥块（ASCII Armor）", type: "textarea", default: "", placeholder: "-----BEGIN PGP PUBLIC KEY BLOCK-----" },
    { key: "signPriv", label: "附带签名的私钥块（可选）", type: "textarea", default: "" },
    { key: "signPass", label: "签名私钥口令（可选）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const o = await lib();
    const opts = {
      message: await o.createMessage({ text: String(text ?? "") }),
      encryptionKeys: await o.readKey({ armoredKey: p.pubKey }),
      format: "armored",
    };
    if (p.signPriv && p.signPriv.trim()) {
      opts.signingKeys = await readPriv(p.signPriv, p.signPass || undefined);
    }
    const armored = await o.encrypt(opts);
    const text2 = [
      "=== PGP 加密" + (p.signPriv && p.signPriv.trim() ? "（附带签名）" : "") + " ===",
      `明文 ${enc.encode(String(text ?? "")).length} 字节 → 密文 ${armored.length} 字符`,
      "",
      armored,
    ].join("\n");
    return emit(text2, [fileOf(ENC_FILE.name, ENC_FILE.mime, armored)]);
  },
});

register({
  id: "pgpDecrypt", cat: "asym",
  family: "pgp", familyLabel: "decrypt", name: "PGP 解密",
  desc: "PGP 解密（openpgp.js）：ASCII Armor 密文 + 私钥块（+口令）→ 明文；密文若带签名顺带给出验签结果",
  params: [
    { key: "privKey", label: "私钥块（ASCII Armor）", type: "textarea", default: "" },
    { key: "passphrase", label: "私钥口令（可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const o = await lib();
    const msg = await o.readMessage({ armoredMessage: String(text ?? "") });
    const { data, signatures } = await o.decrypt({
      message: msg,
      decryptionKeys: await readPriv(p.privKey, p.passphrase || undefined),
      format: "utf8",
    });
    const lines = [
      "=== PGP 解密成功 ===",
      `明文 ${enc.encode(data).length} 字节：`,
      "",
      data,
    ];
    if (signatures && signatures.length) {
      for (const sig of signatures) {
        let s = "签名：未验证（无签名者公钥）";
        try { s = (await sig.verified) ? "签名：已验证 ✓（附带的签名有效）" : "签名：无效 ✗"; } catch { /* 保持未验证 */ }
        lines.push(s);
      }
    }
    return emit(lines.join("\n"), []);
  },
});

register({
  id: "pgpSign", cat: "asym",
  family: "pgp", familyLabel: "sign", name: "PGP 签名",
  desc: "PGP 签名（RFC 4880，openpgp.js）：明文 + 私钥块 → cleartext signed（可读签名文本）；产物 .sig",
  params: [
    { key: "privKey", label: "私钥块（ASCII Armor）", type: "textarea", default: "" },
    { key: "passphrase", label: "私钥口令（可空）", type: "text", default: "" },
    { key: "mode", label: "签名形态", type: "select", default: "clear", options: [
      { value: "clear", label: "Cleartext（原文可读）" },
      { value: "detached", label: "Detached（分离签名）" },
    ] },
  ],
  run: async (text, p) => {
    const o = await lib();
    const key = await readPriv(p.privKey, p.passphrase || undefined);
    const msg = await o.createMessage({ text: String(text ?? "") });
    if (p.mode === "detached") {
      const sig = await o.sign({ message: msg, signingKeys: key, format: "armored", detached: true });
      const text2 = ["=== PGP 分离签名 ===", "", sig].join("\n");
      return emit(text2, [fileOf(SIG_FILE.name, SIG_FILE.mime, sig)]);
    }
    // v5 实测：cleartext 块必须用 createCleartextMessage（普通 message 出的是 PGP MESSAGE 包）
    const clearMsg = await o.createCleartextMessage({ text: String(text ?? "") });
    const clearSigned = await o.sign({ message: clearMsg, signingKeys: key, format: "armored" });
    const text2 = ["=== PGP Cleartext 签名（原文可读）===", "", clearSigned].join("\n");
    return emit(text2, [fileOf("message_clearsigned.asc", "application/pgp-signature", clearSigned)]);
  },
});

register({
  id: "pgpVerify", cat: "asym",
  family: "pgp", familyLabel: "verify", name: "PGP 验签",
  desc: "PGP 验签（openpgp.js）：签名文本/分离签名 + 公钥块 → 合法/不合法 + 签名人",
  params: [
    { key: "signedOrSig", label: "签名文本 / 分离签名块", type: "textarea", default: "", placeholder: "-----BEGIN PGP SIGNED MESSAGE----- 或 -----BEGIN PGP SIGNATURE-----" },
    { key: "pubKey", label: "签名者公钥块", type: "textarea", default: "" },
  ],
  run: async (text, p) => {
    const o = await lib();
    const pub = await o.readKey({ armoredKey: p.pubKey });
    const isClear = String(text ?? "").includes("BEGIN PGP SIGNED MESSAGE");
    let data, sigs;
    if (isClear) {
      const msg = await o.readCleartextMessage({ cleartextMessage: String(text ?? "") });
      const r = await o.verify({ message: msg, verificationKeys: pub, format: "utf8" });
      data = r.data; sigs = r.signatures;
    } else {
      const msg = await o.readMessage({ armoredMessage: String(text ?? "") });
      const r = await o.verify({ message: msg, verificationKeys: pub, format: "utf8" });
      data = r.data; sigs = r.signatures;
    }
    const lines = [];
    for (const sig of sigs) {
      const valid = await sig.verified;
      lines.push(`${valid ? "✓ 签名有效" : "✗ 签名无效"}（KeyID ${sig.keyID.hex}）`);
    }
    if (!sigs.length) lines.push("✗ 未发现签名包");
    lines.push("", "原文：", data);
    return emit(lines.join("\n"), []);
  },
});

register({
  id: "pgpEncryptAndSign", cat: "asym",
  family: "pgp", familyLabel: "encSign", name: "PGP 加密并签名",
  desc: "PGP 加密并签名（先签后加密，openpgp.js）：明文 + 对方公钥 + 本方私钥 → 密文（内嵌签名）",
  params: [
    { key: "pubKey", label: "对方公钥块", type: "textarea", default: "" },
    { key: "signPriv", label: "本方私钥块（签名用）", type: "textarea", default: "" },
    { key: "signPass", label: "本方私钥口令（可空）", type: "text", default: "" },
  ],
  run: async (text, p) => {
    const o = await lib();
    const armored = await o.encrypt({
      message: await o.createMessage({ text: String(text ?? "") }),
      encryptionKeys: await o.readKey({ armoredKey: p.pubKey }),
      signingKeys: await readPriv(p.signPriv, p.signPass || undefined),
      format: "armored",
    });
    const text2 = ["=== PGP 加密并签名 ===", `密文 ${armored.length} 字符`, "", armored].join("\n");
    return emit(text2, [fileOf(ENC_FILE.name, ENC_FILE.mime, armored)]);
  },
});

register({
  id: "pgpDecryptAndVerify", cat: "asym",
  family: "pgp", familyLabel: "decVerify", name: "PGP 解密并验签",
  desc: "PGP 解密并验签（openpgp.js）：密文 + 本方私钥 + 签名者公钥 → 明文 + 验签结论",
  params: [
    { key: "privKey", label: "本方私钥块", type: "textarea", default: "" },
    { key: "passphrase", label: "私钥口令（可空）", type: "text", default: "" },
    { key: "pubKey", label: "签名者公钥块", type: "textarea", default: "" },
  ],
  run: async (text, p) => {
    const o = await lib();
    const r = await o.decrypt({
      message: await o.readMessage({ armoredMessage: String(text ?? "") }),
      decryptionKeys: await readPriv(p.privKey, p.passphrase || undefined),
      verificationKeys: p.pubKey && p.pubKey.trim() ? await o.readKey({ armoredKey: p.pubKey }) : undefined,
      format: "utf8",
    });
    const lines = ["=== PGP 解密并验签 ===", "", r.data, ""];
    for (const sig of r.signatures || []) {
      let s = "签名：未验证（未提供签名者公钥）";
      try { s = (await sig.verified) ? `✓ 签名有效（KeyID ${sig.keyID.hex}）` : "✗ 签名无效"; } catch { /* 保持 */ }
      lines.push(s);
    }
    return emit(lines.join("\n"), []);
  },
});

register({
  id: "pgpParseKey", cat: "asym",
  family: "pgp", familyLabel: "parse", name: "PGP 密钥解析",
  desc: "PGP 密钥解析（RFC 4880 包结构，openpgp.js）：公/私钥块 → KeyID/算法/创建时间/指纹/用户ID/子钥表/能力标志",
  params: [
    { key: "armored", label: "公钥或私钥块（ASCII Armor）", type: "textarea", default: "", placeholder: "-----BEGIN PGP PUBLIC KEY BLOCK-----" },
  ],
  run: async (_t, p) => {
    const o = await lib();
    const key = await o.readKey({ armoredKey: p.armored });
    const isPriv = key.isPrivate();
    const fmtKey = (k, indent) => {
      const algInfo = (() => { try { return k.getAlgorithmInfo().algorithm + " (" + k.getAlgorithmInfo().bits + " bit)"; } catch { return k.getAlgorithmInfo().algorithm; } })();
      // v5 实测无 canEncrypt/canSign 方法，按算法名推能力（RFC 4880 §5.5.2）
      const algo = (() => { try { return k.getAlgorithmInfo().algorithm; } catch { return ""; } })();
      const canE = /ecdh|rsaEncryptSign|^rsa$|elgamal|eax|ocb/i.test(algo);
      const canS = /eddsa|ed25519|rsaSignSign|^rsa$|dsa|ecdsa/i.test(algo);
      const cap = [canE ? "加密" : null, canS ? "签名" : null].filter(Boolean).join("/") || "—";
      return [
        `${indent}KeyID: ${k.getKeyID().hex}`,
        `${indent}算法: ${algInfo}`,
        `${indent}创建: ${k.getCreationTime().toISOString()}`,
        `${indent}能力: ${cap}`,
        `${indent}指纹: ${k.getFingerprint().toUpperCase()}`,
      ];
    };
    const lines = [
      `=== PGP ${isPriv ? "私钥" : "公钥"}解析（RFC 4880）===`,
      `用户ID: ${key.getUserIDs().join(" ; ")}`,
      ...fmtKey(key, "主钥: "),
      "",
      `子钥 ${key.subkeys.length} 个:`,
    ];
    key.subkeys.forEach((sk, i) => lines.push(...fmtKey(sk, `  [${i + 1}] `)));
    return emit(lines.join("\n"), []);
  },
});
