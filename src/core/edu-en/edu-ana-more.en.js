/*
 * edu-ana-more.en.js — English edu cards (C-group ops: MIME/LCG/SHA extension/birthday). Pure data.
 */
export default {
  hnpRecover: {
    what: "Teaching recovery for ECDSA nonces k_i=t_i+x sharing one small unknown x. This is bounded enumeration, not a general lattice HNP solver.",
    principle: "For 0 <= x < xBound, solve s*k = h+r*d (mod n) for d using the first signature, then check all remaining signature equations.",
    usage: "Enter at least three h r s t rows. n is the group order; blank uses the secp256k1 order, not its coordinate-field prime. Output: shared x and candidate d in hex.",
    examples: [{ in: "7 3 36 11\n13 9 31 21\n17 13 10 30", param: "n=101 xBound=8", out: "x=1, d=7", desc: "Small signature-equation fixture, not a full curve-signature vector" }],
    tips: ["All nonces must share the same unknown offset. Different small offsets require a different attack."],
    aka: ["HNP", "hidden number problem", "shared nonce offset"],
  },
  babaiCvp: {
    what: "Babai nearest-plane approximation to the closest lattice vector, after LLL reduction.",
    principle: "Compute exact rational Gram–Schmidt vectors b_i*. Start with residual r=t and work backwards: c_i=round(<r,b_i*>/<b_i*,b_i*>), then r=r-c_i*b_i. Return v=t-r. Projection uses the orthogonalized basis; residual subtraction uses the original basis. This is approximate CVP, not a guarantee of the global nearest point.",
    usage: "Enter integer basis rows and the target vector in their respective fields.",
    examples: [{ in: "3 0\n1 3\n-5 2", out: "最近格点 v = [-5, 3]", desc: "Nonorthogonal, already LLL-reduced basis; exact rational nearest-plane projection" }],
    tips: ["A dependent basis is invalid.", "Inspect the residual to assess approximation quality."],
    aka: ["babai", "nearest plane", "CVP", "closest vector", "lattice vector", "Gram Schmidt", "GSO", "LLL CVP", "Babai algorithm", "approximate CVP", "最近平面", "最近格点"],
  },
  mimeMultipart: {
    what: "MIME multipart parsing: multipart/mixed bodies (email/HTTP) separate parts with a boundary — text parts, attachments, inline images. In CTF, flags often hide inside a base64 attachment part.",
    principle:
      "The header `Content-Type: multipart/mixed; boundary=\"xxx\"` declares the separator; `--xxx` lines delimit parts, each carrying its own Content-Type / Content-Transfer-Encoding (base64 / quoted-printable / 7bit) headers followed by a blank line and the body. The parser splits on the boundary, identifies each part's encoding and decodes it.",
    usage: "Paste multipart text; outputs each part's type/filename/decoded content. The encode direction joins parts separated by | into a multipart message.",
    examples: [
      { in: "raw multipart email", out: "part1 text + part2 base64 attachment decoded", desc: "bodies decoded per declared encoding" },
    ],
    tips: ["A part with Content-Transfer-Encoding: base64 → decode base64 directly; quoted-printable =XX sequences → bytes. A boundary ending with -- is the terminator."],
    aka: ["mime", "multipart", "邮件解析", "mime解析", "multipart/mixed", "邮件附件", "mime multipart", "邮件头解析", "boundary", "eml解析"],
  },

  randu: {
    what: "RANDU: the classic IBM weak random generator $x = 65539 \\cdot x \\bmod 2^{31}$. Teaching demo of its sequence and period — a textbook cautionary tale.",
    principle: "Linear congruential $x_{n+1} = (a \\cdot x_n + c) \\bmod m$ with a=65539, c=0, m=$2^{31}$. The poor choice of multiplier and modulus makes all 3D output points lie on just 15 planes (hyperplane structure), with terrible statistical properties.",
    usage: "Set a seed and count; outputs the sequence. Teaching: compare against modern PRNGs to understand LCG weaknesses.",
    examples: [
      { in: "seed 1, 10 terms", out: "65539 393225 1769499 …", desc: "RANDU sequence" },
    ],
    tips: ["RANDU 3D points all lie on 15 planes — seeing RANDU in a challenge means it can be broken. For weak LCG recovery in CTF see truncLcgRecover / prngAttack."],
    aka: ["randu", "弱随机数", "randu生成器", "65539", "ibm随机数", "randu演示", "randu序列", "弱lcg", "randu攻击", "randu 15平面"],
  },

  truncLcgRecover: {
    what: "Truncated LCG seed recovery: with an LCG $x = a \\cdot x + c \\bmod 2^{32}$ whose outputs only expose the top k bits, enumerate the unknown low bits to recover the seed. Common in CTF (e.g. Python random truncated output).",
    principle:
      "The first full state = first output << (32-k) | low, with $2^{32-k}$ candidates for low. Each candidate is iterated forward and checked against subsequent outputs; on a hit, step back ($x_0 = (x_1 - c) \\cdot a^{-1} \\bmod 2^{32}$) to recover the seed. Unknown low bits ≤ 24 are enumerable.",
    usage: "Input: consecutive truncated outputs (space separated). Params: a/c (default 1664525/1013904223, ANSI C), k (known high bits, default 24). Outputs candidate seeds.",
    examples: [
      { in: "1234567 8901234 …", param: "a=1664525 c=1013904223 k=24", out: "candidate seeds", desc: "seeds reproducing the sequence" },
    ],
    tips: ["Multiplier a must be odd to have a modular inverse (needed for the backtrack). More outputs shrink the candidate set. Pairs with prngAttack (unknown a/c recovery)."],
    aka: ["线性同余", "线性同余生成器", "lcg预测", "截断lcg", "truncated lcg", "lcg高位", "lcg种子恢复", "lcg截断", "python random高位", "lcg恢复", "truncated lcg attack", "lcg种子", "lcg爆破"],
  },

  shaLengthExtend: {
    what: "SHA length extension: SHA-1/SHA-256 are Merkle-Damgård — knowing H(secret||msg) and the message length lets you forge H(secret||msg||padding||append) without the secret. Any MAC built as a prefixed hash collapses.",
    principle:
      "A hash is a compression chain: H = compress(compress(...compress(IV, block1)...), blockN). Knowing the intermediate state H lets you keep compressing later blocks. The attacker builds msg2 = msg || pad(orig_len) || append and keeps compressing from the known H state (append carries victim-view padding with the extended total length). The victim's H(secret||msg2) verification pads identically, matching the forged value.",
    usage: "Input: original hash space original-message-byte-length space append-content. Outputs the extended hash. Choose SHA-256 or SHA-1.",
    examples: [
      { in: "<orighash> 9 &admin=true", param: "algo=sha256", out: "extended hash", desc: "matches full-length verification" },
    ],
    tips: ["Length extension requires knowing the original message length (usually inferable from format). MD5 version: hashLengthExtension op. Defense: HMAC or output truncation."],
    aka: ["长度扩展", "length extension", "sha长度扩展", "sha256扩展", "sha1扩展", "哈希长度扩展", "长度扩展攻击", "merkle-damgard", "mac伪造", "sha extension"],
  },

  birthdayCollision: {
    what: "Birthday collision demo: when a hash is truncated to b bits, finding a collision by random inputs takes $\\approx 2^{b/2}$ attempts (birthday paradox). Teaching demo of collision essence and security margins.",
    principle:
      "Birthday paradox: among n approximately uniform hash values a repeat occurs with probability ~$1/2$ when $n \\approx 1.18 \\cdot 2^{b/2}$. This demo hashes x0, x1, x2, ... and keys a Map by the leftmost b SHA-256 bits (8–40 bits). It checks at most 500000 inputs and explicitly reports no collision when that bound is exhausted.",
    usage: "Set the truncation bits (default 24); outputs a collision pair and attempt count. Compare with the theoretical $2^{b/2}$ to understand security parameters.",
    examples: [
      { in: "bitLen=24", out: "collision pair + attempts", desc: "≈2^12 attempts" },
    ],
    tips: ["$2^{24}$ truncation falls in ~4000 tries — that's why hashes need 128+ bits. Real MD5/SHA-1 collision construction: see the coll ops."],
    aka: ["生日攻击", "birthday attack", "生日悖论", "碰撞演示", "哈希碰撞", "截断哈希", "生日碰撞", "birthday collision", "碰撞对", "2的b/2"],
  },
};
