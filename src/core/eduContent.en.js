/*
 * eduContent.en.js — English edu content aggregation entry.
 *
 * Each edu-en/ shard file is a translated version of the corresponding
 * src/core/edu/*.js Chinese source. Shards are added here as they are translated.
 * Missing shards fall back to Chinese automatically (see getEdu in eduContent.js).
 *
 * Translation standards:
 * - what / principle / usage / tips: translate to natural English, keep technical terms
 * - examples: keep in/out/param values as-is (they are actual code/data), translate desc only
 * - formulas: keep TeX unchanged, translate caption to English
 * - aka: keep original aliases, add English aliases if applicable
 * - LaTeX math ($...$) and backtick code (`...`) syntax: unchanged
 */

import { registerEduEn } from "./eduContent.js";
import E_EN_CTF_CIPHER_EXT from "./edu-en/edu-ctf-cipher-ext.en.js";

// ---- Translated shards (add import here as each shard is completed) ----
import EDU_EN_BASE1 from "./edu-en/edu-base1.en.js";
import EDU_EN_BASE2 from "./edu-en/edu-base2.en.js";
import EDU_EN_CRYPTO_PG from "./edu-en/edu-crypto-pg.en.js"; // 18 个密码学扩充 op 英文科普卡
import EDU_EN_CRYPTO_B from "./edu-en/edu-crypto-b.en.js"; // a52/e0/hc128/hc256/sosemanuk/spritz/vmpc/balloon/lyra2/yescrypt 10
import EDU_EN_HASH_XXHASH from "./edu-en/edu-hash-xxhash.en.js"; // xxhash 1
import EDU_EN_HASH_CITYHASH from "./edu-en/edu-hash-cityhash.en.js"; // cityhash 1
import E_EN_EDU_ANA_CRYPTO_NEW from "./edu-en/edu-ana-crypto-new.en.js";
import EDU_EN_TEXT_BUBBLE from "./edu-en/edu-text-bubblebabble.en.js"; // bubblebabble 1
import EDU_EN_TEXT_JSESCAPE from "./edu-en/edu-text-jsescape.en.js"; // jsEscape 1
import EDU_EN_TEXT_PPENCODE from "./edu-en/edu-text-ppencode.en.js"; // ppencode 1
import EDU_EN_ANA_CRC32REV from "./edu-en/edu-analysis-crc32rev.en.js"; // crc32Reverse 1
import EDU_EN_ANA_GEFTE from "./edu-en/edu-ana-geffe.en.js";  // geffe 1
import E_EN_EDU_ANA_FREQ from "./edu-en/edu-ana-freq.en.js";
import E_EN_EDU_ANA_NEW from "./edu-en/edu-ana-new.en.js";
import E_EN_EDU_ANA_REST from "./edu-en/edu-ana-rest.en.js";
import E_EN_EDU_ANA_RSA1 from "./edu-en/edu-ana-rsa1.en.js";
import E_EN_EDU_ANA_RSA2 from "./edu-en/edu-ana-rsa2.en.js";
import E_EN_EDU_ANA_SERIAL from "./edu-en/edu-ana-serial.en.js";
import E_EN_EDU_ANA_TOOLS from "./edu-en/edu-ana-tools.en.js";
import E_EN_EDU_ANA_TOOLS2 from "./edu-en/edu-ana-tools2.en.js";
import E_EN_EDU_ANA_MORE from "./edu-en/edu-ana-more.en.js";
import E_EN_EDU_BATCH_NEW from "./edu-en/edu-batch-new.en.js";
import E_EN_EDU_BATCH5_MODERN from "./edu-en/edu-batch5-modern.en.js";
import E_EN_EDU_BATCH5_NEW from "./edu-en/edu-batch5-new.en.js";
import E_EN_EDU_BATCH5_STEGO from "./edu-en/edu-batch5-stego.en.js";
import E_EN_EDU_BATCH6 from "./edu-en/edu-batch6.en.js";
import E_EN_EDU_BRIDGE_NEW from "./edu-en/edu-bridge-new.en.js";
import E_EN_EDU_CLASSIC_NEW from "./edu-en/edu-classic-new.en.js";
import E_EN_EDU_CLASSIC_REST from "./edu-en/edu-classic-rest.en.js";
import E_EN_EDU_CLASSIC1 from "./edu-en/edu-classic1.en.js";
import E_EN_EDU_CLASSIC2 from "./edu-en/edu-classic2.en.js";
import E_EN_EDU_CRYPTO_PG from "./edu-en/edu-crypto-pg.en.js";
import E_EN_EDU_EXE from "./edu-en/edu-exe.en.js";
import E_EN_EDU_FANCY_CN from "./edu-en/edu-fancy-cn.en.js";
import E_EN_EDU_FANCY_MODERN_NEW from "./edu-en/edu-fancy-modern-new.en.js";
import EDU_EN_FANCY_ROAR from "./edu-en/edu-fancy-roar.en.js"; // roar 1
import E_EN_EDU_FANCY_NEW from "./edu-en/edu-fancy-new.en.js";
import E_EN_EDU_FANCY_REST from "./edu-en/edu-fancy-rest.en.js";
import E_EN_EDU_FORENSIC_NEW from "./edu-en/edu-forensic-new.en.js";
import E_EN_EDU_HASH_XXHASH from "./edu-en/edu-hash-xxhash.en.js";
import E_EN_EDU_HASH1 from "./edu-en/edu-hash1.en.js";
import E_EN_EDU_HASH2 from "./edu-en/edu-hash2.en.js";
import E_EN_EDU_HASH3 from "./edu-en/edu-hash3.en.js";
import E_EN_EDU_MISC2_NEW from "./edu-en/edu-misc2-new.en.js";
import E_EN_EDU_MODERN_NEW from "./edu-en/edu-modern-new.en.js";
import E_EN_EDU_MODERN_REST from "./edu-en/edu-modern-rest.en.js";
import E_EN_EDU_MODERN1 from "./edu-en/edu-modern1.en.js";
import E_EN_EDU_MODERN2 from "./edu-en/edu-modern2.en.js";
import E_EN_EDU_RADIX_BITOPS from "./edu-en/edu-radix-bitops.en.js";
import E_EN_EDU_RADIX_CHECK from "./edu-en/edu-radix-check.en.js";
import E_EN_EDU_RADIX_COLOR from "./edu-en/edu-radix-color.en.js";
import E_EN_EDU_RADIX_CONVERT from "./edu-en/edu-radix-convert.en.js";
import E_EN_EDU_RADIX_GEO from "./edu-en/edu-radix-geo.en.js";
import E_EN_EDU_RADIX_HAMMING from "./edu-en/edu-radix-hamming.en.js";
import E_EN_EDU_RADIX_MATH from "./edu-en/edu-radix-math.en.js";
import E_EN_EDU_RADIX_NET from "./edu-en/edu-radix-net.en.js";
import E_EN_EDU_RADIX_NUM from "./edu-en/edu-radix-num.en.js";
import E_EN_EDU_RADIX_NUMSYS from "./edu-en/edu-radix-numsys.en.js";
import E_EN_EDU_RADIX_TIME from "./edu-en/edu-radix-time.en.js";
import E_EN_EDU_STEGO_IMAGE from "./edu-en/edu-stego-image.en.js";
import E_EN_EDU_STEGO_QR_AUDIO from "./edu-en/edu-stego-qr-audio.en.js";
import E_EN_EDU_STEGO_TEXT from "./edu-en/edu-stego-text.en.js";
import E_EN_EDU_UNIFIED_MISC from "./edu-en/edu-unified-misc.en.js";
import E_EN_EDU_T508 from "./edu-en/edu-t508.en.js";
import E_EN_EDU_T508_B4 from "./edu-en/edu-t508-b4.en.js";
import E_EN_EDU_T508_B2 from "./edu-en/edu-t508-b2.en.js";
import E_EN_EDU_T508_B3 from "./edu-en/edu-t508-b3.en.js";

const EDU_EN = Object.assign(
  {},
  E_EN_EDU_T508,
  E_EN_EDU_T508_B4,
  E_EN_EDU_T508_B2,
  E_EN_EDU_T508_B3,
  E_EN_EDU_ANA_CRYPTO_NEW,
  EDU_EN_TEXT_BUBBLE,
  EDU_EN_TEXT_JSESCAPE,
  EDU_EN_TEXT_PPENCODE,
  EDU_EN_ANA_CRC32REV,
  EDU_EN_ANA_GEFTE,
  E_EN_EDU_ANA_FREQ,
  E_EN_EDU_ANA_NEW,
  E_EN_EDU_ANA_REST,
  E_EN_EDU_ANA_RSA1,
  E_EN_EDU_ANA_RSA2,
  E_EN_EDU_ANA_SERIAL,
  E_EN_EDU_ANA_TOOLS,
  E_EN_EDU_ANA_TOOLS2,
  E_EN_EDU_ANA_MORE,
  EDU_EN_BASE1,
  EDU_EN_BASE2,
  E_EN_EDU_BATCH_NEW,
  E_EN_EDU_BATCH5_MODERN,
  E_EN_EDU_BATCH5_NEW,
  E_EN_EDU_BATCH5_STEGO,
  E_EN_EDU_BATCH6,
  E_EN_EDU_BRIDGE_NEW,
  E_EN_EDU_CLASSIC_NEW,
  E_EN_EDU_CLASSIC_REST,
  E_EN_EDU_CLASSIC1,
  E_EN_EDU_CLASSIC2,
  EDU_EN_CRYPTO_PG,
  EDU_EN_CRYPTO_B,
  E_EN_EDU_EXE,
  E_EN_EDU_FANCY_CN,
  E_EN_EDU_FANCY_MODERN_NEW,
  EDU_EN_FANCY_ROAR,
  E_EN_EDU_FANCY_NEW,
  E_EN_EDU_FANCY_REST,
  E_EN_EDU_FORENSIC_NEW,
  EDU_EN_HASH_XXHASH,
  EDU_EN_HASH_CITYHASH,
  E_EN_EDU_HASH1,
  E_EN_EDU_HASH2,
  E_EN_EDU_HASH3,
  E_EN_EDU_MISC2_NEW,
  E_EN_EDU_MODERN_NEW,
  E_EN_EDU_MODERN_REST,
  E_EN_EDU_MODERN1,
  E_EN_EDU_MODERN2,
  E_EN_EDU_RADIX_BITOPS,
  E_EN_EDU_RADIX_CHECK,
  E_EN_EDU_RADIX_COLOR,
  E_EN_EDU_RADIX_CONVERT,
  E_EN_EDU_RADIX_GEO,
  E_EN_EDU_RADIX_HAMMING,
  E_EN_EDU_RADIX_MATH,
  E_EN_EDU_RADIX_NET,
  E_EN_EDU_RADIX_NUM,
  E_EN_EDU_RADIX_NUMSYS,
  E_EN_EDU_RADIX_TIME,
  E_EN_EDU_STEGO_IMAGE,
  E_EN_EDU_STEGO_QR_AUDIO,
  E_EN_EDU_STEGO_TEXT,
  E_EN_EDU_UNIFIED_MISC,
  E_EN_CTF_CIPHER_EXT,
);

import { EN as INTEGRATED, HASH_VECTORS, BASE_NOTES, EXTRA_ALIASES, CRC_PARAMS } from "./edu/edu-integrated.js";
for (const [id, [name, poly, init, reflect, xorout, out]] of Object.entries(CRC_PARAMS)) {
  EDU_EN[id] = { ...EDU_EN[id], what: `${name}: an independent CRC parameter set, not a cryptographic hash.`,
    principle: `poly=0x${poly}, init=0x${init}, refin=refout=${reflect}, xorout=0x${xorout}. Polynomial is written in normal form even for a reflected implementation.`,
    usage: "Enter UTF-8 text to compute the hexadecimal checksum with fixed parameters. Change CRC slots for another parameter set. Adler-32 is not in this family.", examples: [{ in: "123456789", out }],
    tips: ["CRC detects errors, not malicious tampering. CRC-64/ECMA-182 is not CRC-64/XZ.", "https://reveng.sourceforge.io/crc-catalogue/all.htm"] };
}
for (const id of ["md2", "md4", "md5", "md6"]) if (EDU_EN[id]) {
  EDU_EN[id] = { ...EDU_EN[id], usage: (EDU_EN[id].usage || "") + "\nThe MD slider changes display grouping only; IDs and parameters remain separate. MD6 retains bits and inputType.", tips: [...(EDU_EN[id].tips || []), "MD2/MD4/MD5 are unsuitable for new collision-resistant security uses. MD6 is a SHA-3 proposal, not standardized SHA-3 or a compatible MD5 upgrade."] };
}
for (const [id, [, en, input, output, dir, aka]] of Object.entries(BASE_NOTES)) {
  EDU_EN[id] = { ...EDU_EN[id], what: en, principle: en, usage: "Enter text and choose the matching direction. Example direction: " + dir + ", default parameters.",
    examples: [{ in: input, out: output, param: dir }], tips: ["Encoding is not encryption. Match the alphabet, direction and compound format."],
    aka: [...new Set([...(EDU_EN[id]?.aka || []).filter(w => !/encrypt|decrypt/i.test(w)), ...aka])] };
}
for (const [id, aka] of Object.entries(EXTRA_ALIASES)) {
  if (EDU_EN[id]) EDU_EN[id] = { ...EDU_EN[id], aka: [...new Set([...(id.startsWith("sm2") ? [] : EDU_EN[id].aka || []), ...aka])].filter(w => id !== "whitespace" || !/隐写|steganograph/i.test(w)) };
}
for (const [id, patch] of Object.entries(INTEGRATED)) {
  const old = EDU_EN[id] || {};
  EDU_EN[id] = { ...old, ...patch, aka: [...new Set([...(old.aka || []), ...(patch.aka || [])])] };
}
for (const [id, out] of Object.entries(HASH_VECTORS)) {
  const xof = id.startsWith("shake");
  EDU_EN[id] = { ...EDU_EN[id],
    what: `${id.toUpperCase()}: ${xof ? "extendable-output function" : `${out.length * 4}-bit message digest${id === "sha3" ? " at the default width (also 224/384/512)" : ""}`}. Sliders group independent operations, not HMAC/KDFs.`,
    principle: xof ? `FIPS 202 sponge XOF. For n output bits, generic collision strength is at most min(${id === "shake128" ? 128 : 256}, n/2), and preimage strength at most min(${id === "shake128" ? 128 : 256}, n). Shortening the output reduces security. Short outputs are prefixes of longer outputs.` : id === "sha3" ? "FIPS 202 Keccak-f[1600] sponge with SHA-3 domain separation, not the legacy Keccak hash." : id === "sha0" ? "Original 1993 FIPS 180; differs from SHA-1 in message-schedule rotation and is obsolete." : "FIPS 180 iterative message hashing, not reversible encryption. SHA-384 uses different initial values before truncation, not a prefix of SHA-512.",
    usage: xof ? "Enter text and select output bytes. The example requests 32 bytes." : "Enter text. SHA-0 also accepts inputType=hex; SHA-3 keeps its output-width parameter.",
    examples: [{ in: "abc", out, ...(xof ? {param: "32 output bytes"} : id === "sha3" ? {param: "bits=256"} : {}) }],
    tips: ["SHA-0/SHA-1 are unsuitable for new collision-resistant security uses. Fast hashes are not password-storage KDFs.", "References: FIPS 180 and FIPS 202. Digest length alone does not identify an algorithm."],
    aka: (EDU_EN[id]?.aka || []).filter(word => !/encrypt|keccak/i.test(word)),
  };
}
registerEduEn(EDU_EN);
export default EDU_EN;
