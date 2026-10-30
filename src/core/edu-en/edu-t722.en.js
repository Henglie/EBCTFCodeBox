/*
 * edu-t722.en.js — English edu card for sshsigVerify (OpenSSH SSHSIG verification).
 * Examples come from local ssh-keygen -Y sign/verify runs and verify_t722.
 */
export default {
  sshsigVerify: {
    what: "OpenSSH SSHSIG verification — verifies signatures produced by `ssh-keygen -Y sign` (armored or binary). SSHSIG is OpenSSH's signed-message format: the signature embeds the public key, namespace and message hash. This tool verifies Ed25519, RSA (rsa-sha2-256/512) and ECDSA P-256/384/521, and can confirm signer identity with an expected public key or SHA-256 fingerprint. It answers whether a message was signed by that SSH key; it never reads private keys and never uses the network.",
    principle:
      "**File layout (PROTOCOL.sshsig v1)**: 6-byte magic `SSHSIG`, uint32 version 1, SSH wire string publickey, string namespace, string reserved, string hash_algorithm and string signature. The signature itself contains the signature key type and signature bytes.\n\n" +
      "**Signed data**: `\"SSHSIG\" || string(namespace) || string(reserved) || string(hash_algorithm) || string(H(message))`, where H is sha256 or sha512 and string() is the SSH wire uint32 big-endian length prefix. The namespace is a domain separator (git, file, …); signatures from one namespace cannot be replayed into another.\n\n" +
      "**Algorithms**: ssh-ed25519 uses Ed25519 (SHA-512 internally); ssh-rsa accepts only rsa-sha2-256 / rsa-sha2-512 (PKCS#1 v1.5) and rejects SHA-1; ecdsa-sha2-nistp256/384/521 uses ECDSA on the matching curve.\n\n" +
      "**Trust model**: the embedded public key only proves who produced the signature. Identity is ANCHORED only when the caller supplies an expected public key (authorized_keys line) or SHA-256 fingerprint matching the embedded key; without it, the tool reports a valid signature but not a verified identity.",
    usage: "Input: an SSHSIG signature (paste armored text, or upload binary/hex). Parameters: signed message (text/hex/base64), expected public key (authorized_keys line or SHA256: fingerprint, optional), expected namespace (empty = use the signature's value). Output: key type/fingerprint, signature type, hash_algorithm, namespace, signature verdict, identity trust verdict and failure reasons.",
    examples: [
      { in: "ed25519.sig from ssh-keygen -Y sign -f ed25519 -n file msg.txt + message 'hello sshsig' + allowed_signers key", out: "Signature: pass; key trust: matches expected; namespace=file; hash=sha512", desc: "Official ssh-keygen round trip" },
      { in: "Same signature + tampered message", out: "Signature: fail (message hash mismatch)", desc: "Message integrity" },
      { in: "Same signature + another Ed25519 public key", out: "Signature: pass; key trust: does not match expected", desc: "A valid signature is not a trusted identity" },
    ],
    tips: [
      "The namespace is part of the signature: a git signature cannot verify as file.",
      "The public key is embedded; a valid signature only proves possession. Supply an expected key/fingerprint to establish identity trust.",
      "ssh-rsa SHA-1 signatures are explicitly rejected; only rsa-sha2-256/512 are supported.",
      "sk-* security keys, SSH certificate keys (*-cert-v01) and DSA are out of scope.",
      "Binary signatures start with the `SSHSIG` magic and can be uploaded or converted to hex.",
    ],
    aka: ["SSHSIG", "OpenSSH signature", "SSH signature verify", "ssh-keygen -Y sign", "signed message", "SSH signed message", "SSH file signature", "git commit signature", "SSH public key verify", "OpenSSH SSHSIG", "SSHSIG verify", "SSH signature file"],
  },
};
