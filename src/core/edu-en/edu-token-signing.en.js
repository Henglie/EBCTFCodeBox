// JOSE, PASETO and BB84 educational contracts.
const PASETO_TOKEN = "v4.public.eyJkYXRhIjoidGhpcyBpcyBhIHNpZ25lZCBtZXNzYWdlIiwiZXhwIjoiMjAyMi0wMS0wMVQwMDowMDowMCswMDowMCJ9bg_XBBzds8lTZShVlwwKSgeKpLT3yukTw6JUz3W4h_ExsQV-P0V54zemZDcAxFaSeef1QlXEFtkqxT1ciiQEDA";
const PASETO_PAYLOAD = '{"data":"this is a signed message","exp":"2022-01-01T00:00:00+00:00"}';
const PASETO_SK = "b4cbfb43df4ce210727d953e4a713307fa19bb7d9f85041438d9e11b942a37741eb9dbbbbc047c03fd70604e0071f0987e16b28b757225c11f00415d0e20b1a2";
const PASETO_PK = "1eb9dbbbbc047c03fd70604e0071f0987e16b28b757225c11f00415d0e20b1a2";
const jwsAliases = ["jws", "JSON Web Signature", "JOSE signature", "RFC 7515", "HS256", "HS384", "HS512", "RS256", "ES256", "compact JWS", "signed token", "JWT signature"];
const jweAliases = ["jwe", "JSON Web Encryption", "JOSE encryption", "RFC 7516", "A256GCM", "direct encryption", "dir JWE", "compact JWE", "CEK", "authenticated encryption", "JWE token", "AES-GCM token"];
const pasetoAliases = ["paseto", "PASETO v4", "v4.public", "PASETO public", "Ed25519 token", "PAE", "pre-authentication encoding", "platform-agnostic security tokens", "PASETO signing", "PASETO verification", "implicit assertion", "PASETO footer"];
export default {
  jwsSign: {
    what: "Create compact JWS tokens with HS256/384/512, RS256 or ES256.",
    principle: "RFC 7515 compact serialization is header.payload.signature, with unpadded base64url segments. Sign the original encoded header and payload. HS uses HMAC; RS256 uses PKCS#1 v1.5/SHA-256 with an ASN.1 OBJECT IDENTIFIER (tag 0x06) inside DigestInfo; ES256 uses 64-byte raw r||s. Extra headers cannot override the selected alg. The HS256 example in RFC 7515 is Appendix A.1.",
    usage: "Enter the payload. Supply an HS passphrase (long base64url-shaped keys are decoded as bytes), two RSA n/d lines, or a P-256 private JWK. Download token.jws.",
    examples: [{ in: '{"sub":"1234567890","name":"John Doe"}', param: "alg=HS256, key=secret", out: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Q6CM1qIz2WTgTlhMzpFL8jI8xbu9FFfj5DY_bGVY98Y", desc: "Deterministic HMAC example" }],
    tips: ["JWS authenticates rather than encrypts the payload.", "Application algorithm allowlists and key identity checks remain separate from this CTF calculator."], aka: jwsAliases,
  },
  jwsVerify: {
    what: "Verify a compact JWS and display its header and payload.",
    principle: "HS signatures are recomputed; RS256 compares the recovered encoded message against complete EMSA-PKCS1-v1_5; ES256 passes JOSE raw r||s directly to WebCrypto verification. RSA verification takes n/e, not n/d. A signature verdict does not validate application claims or establish key identity.",
    usage: "Paste the complete token and an HS key, RSA n/e on two lines, or a P-256 public JWK.",
    examples: [{ in: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Q6CM1qIz2WTgTlhMzpFL8jI8xbu9FFfj5DY_bGVY98Y", param: "key=secret", out: "✓ 签名有效", desc: "Valid HS256 signature" }],
    tips: ["Use the matching public key for asymmetric algorithms.", "Decoded content is still shown for an invalid signature; inspect the verdict."], aka: jwsAliases,
  },
  jweEncrypt: {
    what: "Encrypt with compact JWE dir+A256GCM and a 32-byte hexadecimal CEK.",
    principle: "RFC 7516 uses five segments: protected_header.encrypted_key.iv.ciphertext.tag. In direct mode encrypted_key is empty. The encoded protected header is GCM AAD; IV and tag are 12 and 16 bytes. Extra headers must not override alg=dir or enc=A256GCM.",
    usage: "Enter plaintext and a 32-byte CEK; download token.jwe. A fresh IV makes output nondeterministic.",
    examples: [{ in: "attack at dawn", param: "cek=606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f", out: "Five-segment JWE, with an empty second segment", desc: "Random IV; no fixed ciphertext expected" }],
    tips: ["Do not reuse an IV with the same GCM key.", "This operation supports dir+A256GCM; it does not implement RSA-OAEP key transport."], aka: jweAliases,
  },
  jweDecrypt: {
    what: "Authenticate and decrypt compact dir+A256GCM JWE.",
    principle: "Require five segments, alg=dir, enc=A256GCM, empty encrypted_key, a 32-byte CEK, a 12-byte IV and a 16-byte tag. Verify GCM with the encoded protected header as AAD before displaying plaintext.",
    usage: "Paste the complete token and the matching hexadecimal CEK.",
    examples: [{ in: "A token.jwe artifact from the encrypt operation", param: "Same 32-byte CEK", out: "Original plaintext and protected header", desc: "Pass the token artifact unchanged" }],
    tips: ["A wrong CEK or modified authenticated data fails authentication.", "A nonempty encrypted_key is invalid for this direct mode."], aka: jweAliases,
  },
  pasetoV4Sign: {
    what: "Sign PASETO v4.public with a 64-byte Ed25519 seed||public-key value.",
    principle: "The wire format is v4.public.base64url(payload||signature)[.base64url(footer)], three or four segments. Sign PAE([\"v4.public.\", payload, footer, implicit]); PAE encodes both the piece count and byte lengths as 64-bit little-endian integers. The underlying Ed25519 signer receives the 32-byte seed. The supplied public-key half must match it. JSON payloads are compacted by this operation; non-JSON text is preserved.",
    usage: "Enter payload text, skHex, optional footer and implicit assertion. Footer/assertion UTF-8 bytes, including whitespace, are authenticated.",
    examples: [{ in: PASETO_PAYLOAD, param: "skHex=" + PASETO_SK, out: PASETO_TOKEN, desc: "Official PASETO vector 4-S-1; signature verification does not enforce expiration claims" }],
    tips: ["v4.public signs but does not encrypt.", "v4.local is outside this operation's scope."], aka: pasetoAliases,
  },
  pasetoV4Verify: {
    what: "Verify PASETO v4.public with the matching 32-byte public key.",
    principle: "Decode the third segment; its final 64 bytes are the Ed25519 signature and preceding bytes are the payload. Authenticate the original footer bytes and implicit assertion using little-endian PAE. Return the signature verdict plus payload/footer. Application claims and key identity are separate checks.",
    usage: "Paste the token, pkHex and the same implicit assertion used during signing.",
    examples: [{ in: PASETO_TOKEN, param: "pkHex=" + PASETO_PK, out: "✓ 签名有效", desc: "Official PASETO vector 4-S-1" }],
    tips: ["Reject an incorrect purpose or malformed body.", "The footer is authenticated but not encrypted."], aka: pasetoAliases,
  },
  bb84Qkd: {
    what: "A classical probability simulation of BB84 basis sifting and sample error detection.",
    principle: "With no disturbance, equal Alice/Bob bases yield equal bits. Full intercept-resend introduces a 25% sifted-bit error probability without channel noise. Independent bit-flip noise gives QBER=eve/4+(1-eve/2)*err. The displayed surviving Alice bits have not undergone reconciliation or privacy amplification and are not certified shared secure keys. This is not a physical quantum-channel implementation.",
    usage: "Set photon count, interception/noise probabilities, sampling ratio, threshold and optional reproducible seed.",
    examples: [{ in: "", param: "n=4096, eve=1, err=0.2, seed=independent-properties-2, tableRows=0", out: "Theoretical QBER=35.00%", desc: "Measured QBER is a sample statistic, not an exact theoretical value" }],
    tips: ["An observed error rate alone does not prove Eve caused the errors.", "A real QKD protocol also requires authenticated classical communication, reconciliation and privacy amplification."],
    aka: ["bb84", "BB84 simulation", "QKD", "quantum key distribution", "Bennett Brassard", "intercept resend", "basis sifting", "QBER", "quantum cryptography", "BB84 protocol", "photon basis", "privacy amplification"],
  },
};
