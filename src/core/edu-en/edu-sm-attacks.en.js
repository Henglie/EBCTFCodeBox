const c1 = "0432c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a011aa1c7617e415694b8339acabe65f78358eb279b2124fbe50cfcadb55037254ac673c75e0dc0c38bdd4e09ad3050579";
const c2 = "0432c4ae2c1f1981195f9904466a39c9948fe30bbff2660be1715a4589334c74c7bc3736a2f4f6779c59bdcee36b692153d0a9877cc62a474002df32e52139f0a0d33fdeff7a244f5476bd7305f1be365bbd73c2b3fdfc1c0dcb1eac15d92849c7a1653265f58f116683cfeb9bc5185025";
const pub = c1.slice(0, 130);
const sig = { r1: "7a50ef8fcace56ee4a737aa160915c4d19df461dddbcb8096e5c4ec6a51bbbed", s1: "c2d788371a98d488dac642af4fb751d8e5143c5c32e7a9269c8dcca5e747632d", e1: "478c4163abb4d5d4eada765af65792b889fc3a5deb56ac27fd02093d71cf4726", k: "1" };
const samples = "|bd59335a26cd7f44a26b6722d27f00c6|41a5e0e86fc0211a93147052abb92ffa\n|bc58325b27cc7e45a36a6623d37e01c7|60981ad27d555fe21e877262a1bd2a44\n|bf5b315824cf7d46a0696520d07d02c4|03de149c4aeadceb88327432bfb12486";
export default {
  sm2KnownPlaintext: {
    what: "Known-plaintext recovery when SM2 encryption reuses its ephemeral scalar k with the same recipient public key. A normal plaintext/ciphertext pair does not break SM2.",
    principle: "GB/T 32918.4 uses C1=[k]G and C2=M XOR KDF(x2||y2). Repeated k and recipient public key repeat the keystream, so M2=C2_2 XOR C2_1 XOR M1. Identical C1 confirms the ephemeral point, not recipient equality or C3 authentication.",
    usage: "Choose full ciphertext or C2-only. Main input is the target ciphertext; supply known ciphertext/plaintext, UTF-8/hex and byte offset (default 0). Full mode compares C1, with separate ciphertext orders and 65-byte 04-prefixed or 64-byte x||y points. C2-only cannot check C1: same key/nonce must be established externally. Each input is limited to 1 MiB. Covered bytes are downloadable.",
    examples: [{ in: c2, param: `knownCipher=${c1}; known=known plaintext!; offset=0; other defaults`, out: "UTF-8: flag{sm2_reuse!}", desc: "Independent gmssl fixture; d=k=1 for demonstration only" },
      { in: "d87dc23dee4a1dc8d1df41f6c9083a28b2eeecbfe284b39c35fb102e243e473c819dc0e98b33", param: "cipherFormat=c2; knownCipher=e974cf39fa4541dd928300e690552e02e1bfe8b4a3aaeac939b2767f24605605d79094ffad371c637fc4912f1fd06a1a8e2fccdf1ee9b4ab9f2ac0cdc199; known=Welcome to the Hefei High-Tech Zone Cybersecurity Competition.", out: "UTF-8: flag{b9573ad184b67abaf02dd24c61c9c16e}", desc: "User-provided challenge; 62 known bytes recover a 38-byte target. No C3 was supplied, so authentication is not claimed" }],
    tips: ["No private key recovery or C3 verification. A short known fragment yields partial output at the selected byte offset.", "Only raw sm2p256v1 ciphertext, no automatic DER/compressed-point guessing. Source: https://www.ietf.org/archive/id/draft-shen-sm2-ecdsa-02.txt section 7.2.1 (historical draft, not an RFC)."],
    aka: ["SM2 known-plaintext attack", "SM2 KPA", "SM2 encryption nonce reuse", "SM2 repeated C1", "SM2 keystream reuse", "SM2 C2 XOR recovery", "SM2 plaintext fragment recovery", "SM2 repeated ephemeral key", "SM2 known message recovery", "SM2 ciphertext reuse analysis"],
  },
  sm2NonceRecover: {
    what: "Recover an SM2 signing key from a leaked nonce, reused nonce, or known affine relationship between two nonces.",
    principle: "The signing equation is s(1+d)=k-rd modulo n. Known k gives d=(k-s)/(r+s); reused k gives d=(s2-s1)/(r1+s1-r2-s2). For k2=a*k1+b, d=(s2-a*s1-b)/(a*(r1+s1)-r2-s2). Recovered scalars are checked against the signing equations and r=(e+x([k]G)) mod n, with optional public-key matching.",
    usage: "Input JSON with hexadecimal integer strings r1/s1/e1 and r2/s2/e2 or k. Default reuse uses two signatures; known needs one and k; related additionally needs hex a/b. e must be SM3(ZA||M), not plain SM3(M). Output d/k/public key; degenerate denominators and mismatches are rejected. Maximum JSON size: 8 KiB.",
    examples: [{ in: JSON.stringify(sig), param: "attackMode=known", out: "d = 0000000000000000000000000000000000000000000000000000000000000001", desc: "gmssl signature of known plaintext!, ID=1234567812345678, demonstration k=1" }],
    tips: ["Reused SM2 k does not imply equal r. Do not apply the ECDSA repeated-r formula. Uses sm2p256v1 and split r/s integers, not DER signatures.", "The supplied digest is checked algebraically; message and ZA binding remains external. Source: draft-shen-sm2-ecdsa-02 section 5.2.1; formulas follow by rearranging the equation."],
    aka: ["SM2 signing nonce attack", "SM2 nonce reuse", "SM2 leaked k", "SM2 private key recovery", "SM2 repeated signing nonce", "SM2 related nonce", "SM2 affine nonce", "SM2 signing key extraction", "SM2 known nonce recovery", "SM2 signature equation attack"],
  },
  sm2LeakedK: {
    what: "Decrypt SM2 using a leaked encryption nonce k and the public recipient key, with C3 verification.",
    principle: "Compute [k]P and the KDF stream, XOR C2, and verify SM3(x2||M||y2)=C3. First require [k]G=C1. Unlike known-plaintext XOR recovery, this path authenticates the complete ciphertext digest.",
    usage: "Input full ciphertext hex. Supply leaked k in hex, recipient public key as 04||x||y or x||y, ciphertext order, and C1 encoding. Defaults: C1C3C2 and 04 prefix. Outputs full bytes, valid UTF-8 when available, and a binary download.",
    examples: [{ in: c2, param: `k=1; publicKey=${pub}; other defaults`, out: "UTF-8: flag{sm2_reuse!}", desc: "Deterministic d=k=1 fixture with C1 and C3 checks" }],
    tips: ["The encryption nonce is not the recipient's long-term private key; recovering plaintext does not extract that key.", "Incorrect k/key/C3 and invalid curve points are rejected. Source: draft-shen-sm2-ecdsa-02 sections 7.2.1 and 7.3.1."],
    aka: ["SM2 leaked encryption nonce", "SM2 known k decryption", "SM2 ephemeral scalar leak", "SM2 encryption k compromise", "SM2 public key nonce decryption", "SM2 C3 verified recovery", "SM2 ephemeral key disclosure", "SM2 encryption randomness leak", "SM2 ciphertext recovery with k", "SM2 nonce compromise decryption"],
  },
  sm3LengthExtension: {
    what: "SM3 Merkle–Damgård length extension: continue hashing from a full digest to authenticate an appended suffix in a vulnerable prefix-MAC construction.",
    principle: "The 256-bit digest is the final eight-word chaining state. Rebuild 0x80/zeros/64-bit big-endian length padding from the original total byte count and continue compression over append. This yields H(original||glue||append) and the glue||append suffix without learning original.",
    usage: "Main input is append data. Supply the original 64-hex digest, decimal total original byte length including any secret (default 0), and UTF-8/hex append encoding (default UTF-8). Lengths use BigInt. Append data is limited to 1 MiB; download suffix and append it to the public original message.",
    examples: [{ in: "d", param: "digest=66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0; originalLength=3", out: "newHash: 631665d64651d487cb4a1efd330705bf5151b3e0db48691b62681d0758784e0f", desc: "Original message abc; independently checked with OpenSSL SM3" }],
    tips: ["Applies to incorrect SM3(secret||message) prefix MACs, not HMAC-SM3. This is not collision or preimage recovery.", "The byte-length guess must be correct. Source: draft-sca-cfrg-sm3-02 sections 5.2/5.3 (historical draft)."],
    aka: ["SM3 length extension", "SM3 prefix MAC attack", "SM3 glue padding", "SM3 state continuation", "SM3 hash continuation", "SM3 secret-prefix attack", "SM3 padding append", "SM3 MAC suffix forgery", "SM3 Merkle-Damgard extension", "SM3 digest continuation"],
  },
  sm4CtrReuse: {
    what: "Recover covered plaintext from SM4-CTR/OFB ciphertexts that reuse the same keystream, key, initial IV and stream position.",
    principle: "C=P XOR S, so S=C1 XOR P1 and P2=C2 XOR S. The tool needs no key, but the repeated-stream condition must be established externally.",
    usage: "Input target raw ciphertext hex without IV/tag. Supply known ciphertext, known plaintext fragment in hex, and byte offset (default 0). Output recovered bytes, partial status and a binary download. Maximum input size: 1 MiB.",
    examples: [{ in: "01000302", param: "cipher1=00010203; known=61626364; offset=0", out: "Hex: 60636265", desc: "Algebraic example under the identical-keystream assumption" }],
    tips: ["Not for CBC/ECB; no MAC verification or SM4 key extraction.", "Different counter/IV starts or incorrect offsets invalidate recovery. Source: NIST SP 800-38A CTR/OFB equations."],
    aka: ["SM4 CTR reuse", "SM4 OFB reuse", "SM4 nonce reuse", "SM4 keystream reuse", "SM4 known-plaintext attack", "SM4 counter reuse", "SM4 repeated IV", "SM4 stream recovery", "SM4 two-time pad", "SM4 ciphertext XOR recovery"],
  },
  zucNonceReuse: {
    what: "Recover a plaintext fragment when two ZUC ciphertexts reuse the same key, IV and stream position.",
    principle: "ZUC encrypts using an XOR keystream. Reuse gives P2=C2 XOR C1 XOR P1. This does not recover the ZUC key or reverse its LFSR state.",
    usage: "Input target raw ciphertext hex. Supply known ciphertext/plaintext hex and byte offset (default 0). Exclude MAC bytes and align the keystream starts. Only covered bytes are recovered.",
    examples: [{ in: "01000302", param: "cipher1=00010203; known=61626364", out: "Hex: 60636265", desc: "Algebraic repeated-keystream example" }],
    tips: ["Same key with a different IV is insufficient. EEA3 COUNT/BEARER/DIRECTION contribute to the IV and must match.", "Source: GB/T 33133.1 ZUC keystream construction. This is misuse analysis, not a break of ZUC itself."],
    aka: ["ZUC nonce reuse", "ZUC IV reuse", "ZUC keystream reuse", "ZUC known plaintext", "ZUC two-time pad", "ZUC keystream recovery", "ZUC repeated key and IV", "ZUC plaintext recovery", "ZUC ciphertext XOR", "EEA3 repeated keystream"],
  },
  sm4CbcBitflip: {
    what: "Construct a chosen equal-length plaintext change in unauthenticated SM4-CBC by flipping IV or preceding ciphertext bytes.",
    principle: "CBC decryption is P_i=D(C_i) XOR C_(i-1). XOR known XOR desired into the preceding block to change the selected bytes. The first preceding block is the IV; modifying a ciphertext block additionally corrupts its own corresponding plaintext block.",
    usage: "Input IV(16B)||whole ciphertext blocks as hex. Supply nonempty equal-length known/desired hex and absolute plaintext byte offset (default 0). A replacement cannot cross a 16-byte boundary. Output modified IV||ciphertext and the damaged preceding plaintext block index, starting at 0.",
    examples: [{ in: "00".repeat(16) + "681edf34d206965e86b3e94f536e4246", param: "known=01; desired=00; offset=0", out: "First IV byte becomes 01; other bytes unchanged", desc: "Official SM4 block vector with zero IV; first plaintext byte changes 01 to 00" }],
    tips: ["Does not bypass MAC/AEAD and does not guarantee acceptable business format or padding.", "Changing a non-first block corrupts the preceding plaintext block; the report discloses it. Source: NIST SP 800-38A CBC equation."],
    aka: ["SM4 CBC bit flipping", "SM4 IV modification", "SM4 CBC malleability", "SM4 targeted plaintext change", "SM4 CBC forgery", "SM4 preceding-block XOR", "SM4 unauthenticated CBC attack", "SM4 known plaintext modification", "SM4 CBC IV attack", "SM4 ciphertext manipulation"],
  },
  sm4EcbCodebook: {
    what: "Recover known target blocks using a codebook of complete plaintext/ciphertext blocks under the same SM4-ECB key.",
    principle: "ECB encrypts each 16-byte block independently. Identical blocks under the same key produce identical ciphertext blocks. Codebook lookup only recovers known blocks; unmatched blocks remain UNKNOWN and conflicting mappings are rejected.",
    usage: "Input nonempty whole ciphertext blocks in hex. Each parameter line is 16-byte plaintextHex|ciphertextHex, at most 4096 rows. Output per-block hex or UNKNOWN. A binary download is provided only for complete recovery, with original padding retained.",
    examples: [{ in: "681edf34d206965e86b3e94f536e4246", param: "pairs=0123456789abcdeffedcba9876543210|681edf34d206965e86b3e94f536e4246", out: "0: 0123456789abcdeffedcba9876543210", desc: "Official GB/T 32907 block vector" }],
    tips: ["Different keys, wrong block alignment, CBC and CTR invalidate this lookup. Partial plaintext knowledge does not determine a whole block.", "No online chosen-plaintext oracle or key recovery. Source: NIST SP 800-38A ECB."],
    aka: ["SM4 ECB codebook", "SM4 known block recovery", "SM4 block dictionary", "SM4 ECB known plaintext", "SM4 repeated block identification", "SM4 plaintext block lookup", "SM4 deterministic block leak", "SM4 ECB pattern leak", "SM4 ciphertext block mapping", "SM4 codebook attack"],
  },
  sm4GcmForgery: {
    what: "Recover GHASH H and an authentication mask, then forge tags when SM4-GCM repeats a key and nonce.",
    principle: "A GCM tag is E_K(J0) XOR GHASH_H(A,C), independent of whether its block cipher is AES or SM4. Subtract two samples to remove the mask, solve for H in GF(2^128), and filter candidates with all samples. Multiple candidates are reported separately rather than claimed unique.",
    usage: "Input lines aadHex|ctHex|tagHex, or set samples. Empty AAD is allowed. At least two samples, preferably three; full 16-byte tags only, at most 32 samples/64 KiB and degree 256 per sample. Set newAad/newCt to request forged tags.",
    examples: [{ in: samples, param: "newCt=db35523d5dab1036c50e037da11234e7ee; empty newAad/samples", out: "5ba2ff5ecca5a2b463e2914d481b4cda", desc: "Independent OpenSSL SM4-GCM generation and authentication" }],
    tips: ["A different key/nonce invalidates the forgery. H is a GHASH subkey, not the SM4 key. Truncated tags are unsupported.", "Sources: RFC 8998 section 3.5.1, SP 800-38D, and Joux's 2006 forbidden attack."],
    aka: ["SM4 GCM nonce reuse", "SM4 GCM forbidden attack", "SM4 GCM authentication forgery", "SM4 GHASH subkey recovery", "SM4 GCM tag forgery", "SM4 authentication mask recovery", "SM4 Joux attack", "SM4 GCM H recovery", "SM4 repeated nonce analysis", "SM4 GHASH polynomial attack"],
  },
};
