/*
 * edu-t359.en.js — English edu shard for the t359 group (RSA sign/verify + JWT/PASETO signing family).
 *
 * Partial shard by design: the English layer only covers ops that have been translated;
 * anything missing falls back to Chinese automatically (see getEdu in eduContent.js).
 * This shard currently covers: rsaSign (added 2026-10-11 together with the eNFS deployment tip).
 * The remaining ops of edu/edu-t359.js stay on the Chinese fallback until translated.
 *
 * Pure data, no side effects. Export contract matches eduContent.js header.
 */
export default {
  rsaSign: {
    what: "RSA signing: RSASSA-PKCS#1 v1.5 and PSS modes (RFC 8017); the private key may be given as decimal (n,d) or PEM.",
    principle:
      "v1.5 is \"build the template, then exponentiate\": hash the message, wrap it in a DigestInfo, prefix 0001 + a run of FF + 00 to form EM, and the signature is $s = EM^d \\bmod n$ — deterministic, so the same key and message always give the same result.\n\n" +
      "PSS is \"salt, then hash again\": EM embeds a random salt and DB is produced through an MGF1 mask, with the same final exponentiation — a different salt each time means two signatures differ, which is by design, not a bug (it resists certain chosen-ciphertext attacks).\n\n" +
      "Three private-key forms are accepted: decimal n,d; PKCS#1 RSA PRIVATE KEY PEM; PKCS#8 PRIVATE KEY PEM. The PSS salt length defaults to hLen and can be set to 0/16/20/32/max.",
    usage: "Message + private key (pick a form), with signature mode / hash / salt length as needed. Outputs the signature in hex and decimal, plus the full EM intermediate values.",
    examples: [
      { in: "attack at dawn", param: "PKCS#1 v1.5, SHA-256, 1024-bit PKCS#8 PEM private key", out: "signature s (hex, 128 bytes) = 798e63c8301652200538d6be40351785558719724596f24c4260bdb614481ce4e6b92886b70ee196a3fb9afc183d5fd7411d9700b7cd5817b5bf2c6130cc3d05969c973af3dd5e20b5a3567fa5a868d056d80da29cce3d76c722f9f2ee036bedf6ba96b23428befda5e0a5f043773749cf7610a12162be589d91d983ac3d80ee", desc: "Deterministic: re-running before the key changes is byte-for-byte identical, and it can be cross-checked with openssl dgst -sha256 -sign" },
      { in: "same message, PSS mode", param: "PSS, SHA-256, sLen=hLen", out: "two runs produce different signatures (random salt) — expected", desc: "PSS randomness" },
    ],
    tips: [
      "A 512-bit modulus cannot run PSS with SHA-256 or stronger (emLen < hLen+sLen+2 fails immediately) — use a bigger key or a shorter salt.",
      "The classic CTF \"Bleichenbacher'06 signature forgery\" targets verifiers that do not check the FF padding length — the RSA Verify output shows why byte-for-byte comparison on the verifying side matters.",
      "Signing is not encryption: what is signed is the encoded hash block, not the plaintext itself; do not use a decryption op to recover EM and pass it off as a signature.",
      "Deployment warning: if a server exposes a raw unpadded RSA signing/decryption oracle (e.g. raw PKCS#11 operations on an HSM, or blind-signature protocols), the 2026 eNFS attack (Shea / Haller / Suhl / Heninger / Thomé) lets an attacker forge arbitrary signatures offline for a long time, without factoring the modulus. Regular signatures that correctly use PKCS#1 v1.5 / PSS padding do not expose such an oracle.",
    ],
    aka: ["rsa签名", "rsa sign", "rsassa", "rsassa-pkcs1-v1_5", "pkcs1 v1.5", "rsassa-pss", "pss签名", "rsa私钥签名", "sha256withrsa", "rsa sha256签名", "openssl dgst -sign", "rsa signature", "消息签名", "数字签名rsa", "rsa signing", "pkcs#1 v1.5 signature", "rsa-pss signature"],
  },
};
