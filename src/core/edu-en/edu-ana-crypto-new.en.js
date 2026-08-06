// Edu content shard: analysis(10) + crypto(7) — new attack/analysis ops. Pure data, no import, no side effects.
export default {
 // ============================================================
 // analysis group (10)
 // ============================================================
  dictGen: {
    what: "Wordlist generator: builds candidate lists either as the Cartesian product of a charset and length, or from a mask template (@ lowercase, ! uppercase, # digit, $ symbol). Ammo depot for brute-force / dictionary attacks.",
    principle:
      "Two modes:\n\n" +
      "① Charset + length: given a charset C and length L, output all $|C|^L$ combinations (e.g. 26 lowercase letters × length 4 = $26^4=456976$ entries).\n\n" +
      "② Mask: each position gets its own candidate set — `@`=lowercase, `!`=uppercase, `#`=digit, `$`=common symbols, any other character is a fixed literal. For example `@@@#` means \"3 lowercase letters + 1 digit\".\n\n" +
      "Internally generated as a position-by-position expanding Cartesian product, with a hard cap of 1,000,000 output entries to prevent memory blow-up.",
    usage: "Pick a mode: charset takes a character set and length (1-6); mask takes a mask template. Output is one entry per line. Exceeding 1,000,000 combinations raises an error — shorten the length or trim the charset.",
    examples: [
      { in: "（charset 模式）", param: "charset=ab, length=3", out: "aaa aab aba abb baa bab bba bbb", desc: "2 chars × length 3 = 8 entries" },
      { in: "（mask 模式）", param: "mask=@#", out: "a0 a1 … z9（260 条）", desc: "1 lowercase letter + 1 digit" },
    ],
    tips: [
      "Write literals directly in the mask, e.g. `flag#` generates flag0..flag9.",
      "Length capped at 6, total capped at 1,000,000 — for genuinely large dictionaries use crunch/hashcat masks.",
      "When the password format is known (e.g. \"3 letters + 4 digits\"), a mask is far faster than a full charset.",
    ],
    aka: ["字典生成", "dict gen", "dictionary generator", "掩码生成", "mask attack", "笛卡尔积字典", "词表生成", "密码字典", "wordlist", "crunch", "字典爆破", "生成字典", "候选词表", "wordlist generator", "cartesian product wordlist"],
  },

  flagExtract: {
    what: "Automatic flag extractor: feeds the input into a batch of common decoders, decodes recursively, matches `flag{}` regex at each layer, and on a hit outputs the flag plus the full decode chain. One-click killer for deeply nested-encoded flags.",
    principle:
      "Essentially a \"find the flag only\" narrowing of the magic one-click decoder:\n\n" +
      "① Run a flag-format regex like `[a-z0-9_]{2,}\\{[^{}]+\\}` on the current text;\n" +
      "② Decode once with each of 26 lightweight whitelisted decode ops (base family, url, rot family, morse, bacon, etc.);\n" +
      "③ Recurse into the next layer for every result that decoded and changed (default maxDepth=3);\n" +
      "④ BFS beam-search pruning: each layer is scored by \"contains flag/ctf/key keywords first + high printable ratio first\", keeping only the top 32 candidates to prevent combinatorial explosion.\n\n" +
      "Only key-less decoders run; ones that need a key (like Vigenère) are skipped.",
    usage: "Paste suspected multi-layer ciphertext into the input box and set maxDepth (1-5, default 3). Output is the matched flag plus the decode chain (e.g. `base64 > rot13`).",
    examples: [
      { in: "ZmxhZ3toZWxsb30=", out: "flag{hello}\n解码链路: base64", desc: "single-layer base64" },
    ],
    tips: [
      "Only finds `flag{}` format; no need for this op if the flag is plainly visible.",
      "Encodings that need a key (Vigenère etc.) won't crack here — switch to magic for the full sweep.",
      "If depth isn't enough, raise maxDepth (max 5), but deeper layers run slower.",
    ],
    aka: ["flag提取", "flag extract", "自动提取flag", "递归解码", "flag finder", "找flag", "多层解码", "flag自动化", "auto decode", "ctf一键解", "提取flag", "flag搜索", "嵌套编码解码", "flag extractor", "recursive decode"],
  },

  lfsrRecover: {
    what: "LFSR sequence recovery: given a stream of 0/1 bits output by a linear-feedback shift register, uses the Berlekamp-Massey algorithm to recover the feedback polynomial, degree, and initial state, and can extrapolate to predict subsequent bits.",
    principle:
      "An LFSR is determined by its connection polynomial $c(x)=1+c_1x+\\dots+c_Lx^L$, with recurrence $s_n=\\bigoplus_{i=1}^{L}c_i\\,s_{n-i}$ (addition and subtraction over GF(2) are both XOR).\n\n" +
      "Berlekamp-Massey is the classic GF(2) algorithm for finding the \"shortest LFSR that generates a given sequence\": it computes the discrepancy $d=s_n\\oplus\\bigoplus_{i}c_i s_{n-i}$ bit by bit, and when $d=1$ it corrects the current polynomial using a previously backed-up polynomial, updating the linear complexity $L$ when necessary.\n\n" +
      "The output $L$ is the LFSR degree, and the nonzero terms of degree ≥1 in $c(x)$ are the tap positions. When $L$ approaches $N/2$ it usually means the source is not a simple LFSR.",
    usage: "Input a string of 0/1 (spaces/newlines/commas tolerated as separators). analyze mode outputs L / feedback polynomial / taps / initial state + a reproduction check; predict mode additionally extrapolates predictN more bits.",
    examples: [
      { in: "0011101", out: "L=3, 反馈多项式 x^3 + x^2 + 1", desc: "3-stage LFSR" },
    ],
    formulas: [
      { tex: "s_n = \\bigoplus_{i=1}^{L} c_i\\, s_{n-i} \\pmod 2", caption: "Fibonacci LFSR feedback recurrence (GF(2))" },
    ],
    tips: [
      "About 2L consecutive bits are needed to uniquely determine an L-stage LFSR.",
      "Reproduction check passes = this LFSR fully generates the input; failing usually means the source is not a pure LFSR output.",
      "Once the feedback polynomial is found, you can predict the subsequent keystream to any length.",
    ],
    aka: ["lfsr恢复", "berlekamp massey", "BM算法", "线性反馈移位寄存器", "反馈多项式", "线性复杂度", "lfsr破解", "lfsr攻击", "序列恢复", "linear feedback shift register", "抽头恢复", "lfsr预测", "b-m算法", "最短lfsr综合", "lfsr recovery", "shortest lfsr synthesis"],
  },

  nonogram: {
    what: "Nonogram (Picross) solver: given the \"run-length\" constraints for each row and column, solves the 0/1 grid. In CTF misc the solved picture is often a QR code, characters, or a flag shape.",
    principle:
      "Iterative convergence with a line solver:\n\n" +
      "① For each row/column, enumerate every legal arrangement satisfying that line's constraints (pruned by already-fixed cells);\n" +
      "② Take the intersection of all legal arrangements — if a cell is filled in every arrangement (or empty in every one), that cell is determined;\n" +
      "③ Repeatedly scan rows and columns until no new cells are determined.\n\n" +
      "It does no whole-board DFS backtracking, so boards with multiple solutions or requiring guessing only get a partial solution. Size capped at 40×40; a line whose combinations exceed 200,000 is skipped.",
    usage: "Provide two blocks separated by a line of `---`: the top block has one group of row constraints per line (run lengths, space-separated), the bottom block one group of column constraints per line. Fill/blank characters are customizable.",
    examples: [
      { in: "2\n1 1\n3\n---\n1\n1 1 1\n2", out: "3×3 点阵解", desc: "one block of row constraints / one of column constraints" },
    ],
    tips: [
      "An empty line (or 0) means that whole row/column is empty.",
      "Line solver only — boards that require guessing leave `?` undetermined cells.",
      "If the picture is recognizable (QR code / characters), you can read it off without fully solving.",
    ],
    aka: ["数织", "nonogram", "数independent", "描点方块", "picross", "日本谜题", "格子画", "行列约束求解", "hanjie", "griddler", "数织求解", "点阵谜题", "connect块约束", "nonogram solver", "line solver"],
  },

  pcapRepair: {
    what: "pcap file repair: in CTF traffic challenges pcaps are often deliberately broken — corrupted magic, missing global header, faked byte order, out-of-range incl_len. This op statically diagnoses and does its best to repair, outputting the fixed hex, which can then be fed to pcapParse.",
    principle:
      "Checks each item against the libpcap format (24-byte global header + 16-byte record header per packet):\n\n" +
      "① **Corrupted/missing magic**: only four legal values exist — `a1b2c3d4` (LE μs), `d4c3b2a1` (BE μs), `a1b2cd34` (LE ns), `34cdb2a1` (BE ns). When illegal, the correct magic + byte order is inferred from the plausibility of the subsequent record chain.\n" +
      "② **Entire global header missing**: probes the first record header and prepends a standard 24-byte header (snaplen 65535 / DLT 1 Ethernet).\n" +
      "③ **Byte-order marker inconsistent with content**: when the record chain resolves more packets under a flipped byte order, flip the magic.\n" +
      "④ **incl_len out of range** truncated, abnormal snaplen fixed to 65535, abnormal version fixed to 2.4.\n\n" +
      "The strategy is conservative: only the global header and clearly out-of-range incl_len are changed; packet bodies are never deleted or reordered.",
    usage: "Paste the pcap as hex/base64 into the input box (or drag in a file for raw bytes) and pick the input encoding. Output is a diagnostic report + the repaired pcap hex.",
    examples: [
      { in: "d4c3b2a1...(坏 magic 的 pcap hex)", out: "诊断报告 + 修复后 hex", desc: "identify byte order + rewrite magic" },
    ],
    tips: [
      "Record-header plausibility test: incl_len in (0, remaining bytes] and ≤ orig_len.",
      "pcapng (block structure) is outside this op's repair scope — try pcapParse directly.",
      "Copy the repaired hex into pcapParse to continue parsing packet contents.",
    ],
    aka: ["pcap修复", "pcap repair", "流量包修复", "pcap损坏", "修复pcap", "libpcap", "抓包文件修复", "magic修复", "pcap头修复", "wireshark文件修复", "pcap fix", "网络流量修复", "破损pcap", "corrupted pcap repair", "capture file repair"],
  },

  rc4Visualize: {
    what: "RC4 KSA/PRGA visualization: unrolls RC4's two internal phases step by step — the i/j/swap of each KSA step that scrambles the S box with the key, and the byte-by-byte keystream generation of PRGA. For teaching + recognizing RC4 signatures in reverse engineering.",
    principle:
      "RC4 has two phases (this op matches real RC4 exactly, only adding trace recording):\n\n" +
      "**KSA (key scheduling)**: the S box starts as the identity permutation 0..255, then runs 256 steps of $j=(j+S[i]+key[i\\bmod keylen])\\bmod 256$, swapping $S[i]\\leftrightarrow S[j]$ each step to \"load\" the key into the S box.\n\n" +
      "**PRGA (keystream generation)**: for each byte $i=(i+1)\\bmod 256$, $j=(j+S[i])\\bmod 256$, swap $S[i]\\leftrightarrow S[j]$, output $K=S[(S[i]+S[j])\\bmod 256]$, and XOR it with the plaintext. RC4 is self-inverse: encryption and decryption are the same operation.",
    usage: "Fill in the RC4 key (UTF-8 or hex), the number of KSA steps to show, and the number of PRGA bytes to generate. Optionally provide plaintext to see \"plaintext ⊕ keystream = ciphertext\". Output is KSA detail + S box + PRGA detail + keystream hex.",
    examples: [
      { in: "（可选明文）", param: "key=Key, prgaBytes=16", out: "S 表 + 密钥流 hex + 每步 i/j/swap", desc: "classic RC4 key Key" },
    ],
    tips: [
      "CTF signature: a 256-step KSA swap loop + the `S[(S[i]+S[j])&0xff]` PRGA loop.",
      "For actual encryption/decryption use the RC4 op under \"Modern crypto\"; this op is process visualization only.",
      "Keystream XOR plaintext gives ciphertext; XORing again with the same keystream restores it.",
    ],
    aka: ["rc4可视化", "rc4 visualize", "ksa", "prga", "rc4教学", "rc4过程", "key scheduling algorithm", "pseudo-random generation", "rc4 s盒", "rc4流密码", "rc4密钥流", "rc4分析", "rc4 sbox", "arcfour", "rc4 visualization"],
  },

  spiralMatrix: {
    what: "Spiral matrix reader: after a flag is scattered into an N×M grid, read it back in clockwise/counterclockwise spiral order. Very common in CTF misc. Also supports the reverse — filling plaintext into a matrix in spiral order.",
    principle:
      "Generates a rows×cols spiral visiting-coordinate sequence — clockwise starts at the top-left with \"right → down → left → up\", contracting ring by ring (the standard LeetCode 54/59 algorithm); counterclockwise goes \"down → right → up → left\".\n\n" +
      "decode (read): parse the input into a 2D grid, take characters in spiral order, and concatenate into plaintext.\n" +
      "encode (write): place plaintext characters into the matrix in spiral order and output it.",
    usage: "decode takes a matrix (multi-line text, or a single line + a specified column count cols to chunk it); pick a direction (clockwise/counterclockwise). encode takes plaintext, and cols=0 auto-picks an approximately square grid.",
    examples: [
      { in: "abc\nhid\ngfe", param: "dir=cw", out: "abcdefghi", desc: "3×3 clockwise spiral read" },
    ],
    tips: [
      "Start point is fixed at the top-left (most common in CTF).",
      "Single-line input needs a column count cols to be chunked into a matrix.",
      "If the clockwise/counterclockwise read comes out wrong, switch direction and retry.",
    ],
    aka: ["螺旋矩阵", "spiral matrix", "螺旋读取", "回形读取", "spiral order", "蛇形矩阵", "螺旋填充", "顺时针螺旋", "逆时针螺旋", "矩阵螺旋", "螺旋展开", "螺旋排列", "回旋矩阵", "spiral matrix reader", "clockwise spiral"],
  },

  ttlStego: {
    what: "TTL steganography: the sender sets each IP packet's TTL to one of 4 anchor values (0/64/128/255), each anchor encoding 2 bits, so 4 packets combine into 1 byte hiding an ASCII character. Common in network traffic forensics.",
    principle:
      "Encoding map: TTL 0→`00`, 64→`01`, 128→`10`, 255→`11`. Bits are MSB-first, and every 4 TTL values combine into 1 byte.\n\n" +
      "On decode, values are normalized to the \"nearest anchor\" — real captured TTLs jitter (63/65/127 etc.), so each is snapped to whichever anchor it is closest to, then regrouped into bytes 2 bits at a time.",
    usage: "decode takes a sequence of TTL integers separated by space/comma/newline → text. encode takes text → a space-separated TTL sequence.",
    examples: [
      { in: "64 128 64 255 ...", out: "还原的 ASCII 文本", desc: "every 4 TTLs make 1 byte" },
    ],
    tips: [
      "The TTL count should be a multiple of 4; trailing bits short of a full byte are ignored.",
      "Capture jitter in TTLs is fine — nearest-anchor normalization tolerates it.",
      "Just extract the TTL sequence of all packets from the pcap to decode.",
    ],
    aka: ["ttl隐写", "ttl stego", "ttl steganography", "ip ttl隐写", "生存时间隐写", "ttl编码", "流量隐写", "网络隐写", "ttl藏数据", "time to live", "ttl信道", "ttl隐藏", "ip包隐写", "ttl covert channel"],
  },

  xorAnalyze: {
    what: "All-in-one xortool: given a repeating-key XOR (Vigenère-style) ciphertext, automatically guesses the key length, recovers the key byte by byte, and outputs the decrypted result. A pure-frontend xortool.",
    principle:
      "The classic three steps (cryptopals Set 1 Challenge 6):\n\n" +
      "① **Guess key length**: for each candidate keylen, split the ciphertext into blocks and compute the normalized inter-block Hamming distance. At the correct keylen the key is the same at matching positions, so after XOR the distribution concentrates → lowest Hamming distance.\n" +
      "② **Recover key byte by byte**: collect all bytes at the same key position, try single-byte XOR against all 256 candidates, and score with English letter-frequency chi-square to pick the best.\n" +
      "③ **Combine and select**: take the top 5 candidates per position, rebuild the full plaintext, and score with bigrams (common digraphs like th/he/in) to pick the best, rescuing small samples from chi-square noise.\n\n" +
      "It also detects key periodicity (`KEYKEY`→`KEY`) and reduces the report.",
    usage: "Paste the ciphertext as hex/base64 into the input box and set the max key length (2-64). Output is keylen candidates + the best key (hex/ascii) + the decrypted result + a confidence score.",
    examples: [
      { in: "(hex 密文，重复密钥 XOR)", param: "maxKeyLen=32", out: "key + 明文 + 置信度", desc: "Hamming distance + chi-square break" },
    ],
    formulas: [
      { tex: "\\text{keylen} = \\arg\\min_{k}\\ \\frac{1}{k}\\,\\text{Hamming}(\\text{block}_i, \\text{block}_{i+1})", caption: "The keylen with the minimum normalized Hamming distance is most likely" },
    ],
    tips: [
      "The longer the ciphertext, the more accurate — aim for ≥ 10 × keylen bytes.",
      "Only works on English plaintext (chi-square/bigram use English frequencies).",
      "When confidence is low, raise maxKeyLen, or confirm the input really is a repeating-key XOR.",
    ],
    aka: ["xor分析", "xortool", "重复密钥xor", "多字节异或破解", "repeating key xor", "维吉尼亚xor", "xor破解", "vigenere xor", "异或分析", "汉明距离破解", "xor crack", "破解异或密钥", "single byte xor", "卡方xor", "xor analysis"],
  },

  xorCribDrag: {
    what: "XOR crib-drag known-plaintext: drag a known plaintext fragment (crib) position by position across a stream-cipher / repeating-key ciphertext, XORing at each offset, and use the printable ratio to find the correct alignment and recover the key fragment.",
    principle:
      "XOR encryption is $C=P\\oplus K$. If a known plaintext fragment crib appears at plaintext position $i$, then $C[i:i+L]\\oplus\\text{crib}=K[i:i+L]$ (the key fragment).\n\n" +
      "At each offset, XOR the crib against the ciphertext and output the candidate key/plaintext fragment + printable ratio for that position. When the key is printable text, the correct alignment shows a markedly higher printable ratio (fully printable marked ★, ≥80% marked ○).",
    usage: "Paste the ciphertext as hex/base64 into the input box, and put the known plaintext fragment (UTF-8) in the crib parameter. Output is the XOR result at each offset (hex + ASCII + printable ratio).",
    examples: [
      { in: "(hex 密文)", param: "crib=the", out: "各偏移 XOR + 可打印率 + ★标记", desc: "drag \"the\" to find the alignment" },
    ],
    formulas: [
      { tex: "C[i:i{+}L]\\oplus \\text{crib} = K[i:i{+}L]", caption: "XOR at the known-plaintext position gives the key fragment" },
    ],
    tips: [
      "Common cribs: `the `, `flag{`, ` the `, common words with leading/trailing spaces.",
      "The ★ (fully printable) position is most likely the correct alignment, and what you read off is the key fragment.",
      "Two ciphertexts using the same keystream (many-time-pad reuse) can also be crib-dragged by XORing them against each other.",
    ],
    aka: ["crib drag", "crib拖动", "已知明文攻击", "拖动异或", "known plaintext", "crib dragging", "xor拖拽", "密钥片段恢复", "many time pad", "一次一密复用", "crib攻击", "已知明文拖动", "xor known plaintext"],
  },

 // ============================================================
 // crypto group (7)
 // ============================================================
  dsa: {
    what: "DSA digital signatures (FIPS 186): sign, verify, and the CTF-favorite \"k (nonce) reuse attack\" — if two signatures use the same random k, the private key x can be recovered. Pure BigInt local computation.",
    principle:
      "DSA parameters: primes $p$, $q$ ($q\\mid p-1$), a generator $g$ of order $q$, private key $x$, public key $y=g^x\\bmod p$.\n\n" +
      "**Signing** (message hash denoted $z$): pick a per-message-unique random $k$, $r=(g^k\\bmod p)\\bmod q$, $s=k^{-1}(z+xr)\\bmod q$, signature $(r,s)$.\n\n" +
      "**Verifying**: $w=s^{-1}$, $u_1=zw$, $u_2=rw$, $v=((g^{u_1}y^{u_2})\\bmod p)\\bmod q$, valid $\\Leftrightarrow v=r$.\n\n" +
      "**k reuse attack**: two messages use the same $k$ (showing up as $r_1=r_2$); from $s_1-s_2=k^{-1}(z_1-z_2)$ solve $k=(z_1-z_2)(s_1-s_2)^{-1}\\bmod q$, then $x=(s_1k-z_1)r^{-1}\\bmod q$.",
    usage: "Pick a mode: sign (private key x → r,s) / verify (public key y + r,s) / attack_reuse_k (recover x from two signatures with the same r). The hash accepts a direct integer H(m) or SHA-1 over text. Attack mode takes r/s1/s2/z1/z2/q.",
    examples: [
      { in: "z1,s1,z2,s2,r,q（同 k 两签名）", param: "mode=attack_reuse_k", out: "恢复 k 和私钥 x", desc: "recover the private key from nonce reuse" },
    ],
    formulas: [
      { tex: "k=(z_1-z_2)(s_1-s_2)^{-1}\\bmod q,\\quad x=(s_1 k - z_1)\\,r^{-1}\\bmod q", caption: "k-reuse attack recovers the nonce and private key" },
    ],
    tips: [
      "k in a signature must be unique and secret every time — reusing or leaking k directly exposes the private key.",
      "Two signatures sharing the same r is the signal of k reuse — switch to attack mode immediately.",
      "ECDSA (e.g. Bitcoin) nonce reuse recovers the private key the same way (identical principle).",
    ],
    aka: ["dsa", "数字签名算法", "digital signature algorithm", "fips 186", "dsa签名", "dsa验签", "nonce重用", "k重用攻击", "nonce reuse", "dsa攻击", "签名验签", "dsa私钥恢复", "重用随机数攻击", "dsa破解", "dsa nonce reuse"],
  },

  hashLengthExtension: {
    what: "Hash length-extension attack: given H(secret) and the byte length of secret, you can compute H(secret‖padding‖append) without knowing secret. An inherent weakness of Merkle-Damgård hashes like MD5/SHA1/SHA256, very common in CTF web/crypto.",
    principle:
      "Merkle-Damgård hashes iteratively compress a message in 64-byte blocks, and the final internal state is the hash output.\n\n" +
      "The attacker reverses the hash back into the internal state (for MD5, 4 little-endian 32-bit words), treats it as the \"initial state\" of the compression function, and continues compressing the append data to obtain $H(\\text{secret}\\Vert\\text{padding}\\Vert\\text{append})$ — never needing to know secret.\n\n" +
      "The key is the glue padding: the original message's padding = `0x80` + some `0x00` bytes + a 64-bit message length, where the bit count in the length field is computed from $\\text{len(secret)}$. This op's MD5 is implemented in pure JS; SHA1/SHA256 go through WebCrypto which does not expose internal state, so it degrades with a hashpump hint.",
    usage: "Fill in the hex of the original hash H(secret), the secret byte length, and the data to append (input box, decoded per appendEnc). Output is the new hash new_hash + the new message suffix (padding‖append) as hex/base64.",
    examples: [
      { in: "append=admin", param: "originalHash=<md5>, originalLength=14", out: "new_hash + padding‖append", desc: "MD5 length extension" },
    ],
    formulas: [
      { tex: "H(\\text{secret}\\Vert\\text{pad}\\Vert\\text{append}) \\;\\text{可由}\\; H(\\text{secret}),\\ |\\text{secret}| \\;\\text{算出}", caption: "Extendable without knowing secret" },
    ],
    tips: [
      "Defense: don't use H(secret‖msg) as a MAC — use HMAC instead.",
      "When the secret length is unknown you can brute-force it (try 8/16/24… bytes).",
      "For SHA1/SHA256 use the command-line hashpump or the python hashpumpy library.",
    ],
    aka: ["长度扩展攻击", "hash length extension", "length extension attack", "哈希扩展", "md5长度扩展", "merkle damgard攻击", "hashpump", "hash扩展攻击", "sha1长度扩展", "hlea", "填充扩展", "md5扩展攻击", "hash伪造"],
  },

  lllAttack: {
    what: "Lattice-reduction LLL (Lenstra-Lenstra-Lovász) attack: two applications — a knapsack (Merkle-Hellman) low-density attack recovering the 0/1 plaintext from the public key + ciphertext, and general integer-matrix reduction to find a short vector. Exact BigInt rational arithmetic, no floating-point error.",
    principle:
      "LLL is a polynomial-time algorithm for finding an \"approximately shortest basis of a lattice\" (Cohen algorithm 2.6.3): it repeatedly does size-reduction (squashing the μ coefficients to $|\\mu_{i,j}|\\le 1/2$) and swaps adjacent basis vectors that satisfy the Lovász condition; the first vector of the output basis is an approximately shortest vector (approximation factor $\\le 2^{(n-1)/2}$). This implementation keeps Gram-Schmidt and μ in exact BigInt rationals throughout.\n\n" +
      "**Knapsack low-density attack (CJLOSS construction)**: the subset-sum problem is built into an $(n+1)\\times(n+1)$ lattice where the 0/1 plaintext bits correspond to a very short vector of norm about $\\sqrt n$. When the knapsack density $d=n/\\log_2(\\max\\beta)<0.9408$, the short vector after LLL reduction yields the ±1 values that restore the plaintext bits.",
    usage: "knapsack mode takes the public key β (comma-separated) + ciphertext c (may be multiple blocks) and recovers the 0/1 plaintext (paired with Merkle-Hellman). general mode takes an integer matrix (rows separated by newline/semicolon, elements by comma/space) and finds the reduced basis and shortest vector. δ can be 3/4 or 0.99.",
    examples: [
      { in: "β=公钥, c=子集和", param: "mode=knapsack", out: "0/1 明文位向量 + 还原字节", desc: "low-density knapsack attack" },
    ],
    formulas: [
      { tex: "d = \\frac{n}{\\log_2(\\max_i \\beta_i)} < 0.9408", caption: "CJLOSS attackable density bound" },
    ],
    tips: [
      "The knapsack attack needs density < 0.9408 (CJLOSS); the older Lagarias-Odlyzko bound is only 0.6463.",
      "If the attack fails, try δ=0.99 (stronger reduction).",
      "General mode can also solve HNP, hidden-number problems, and Coppersmith-related small-root lattices.",
    ],
    aka: ["lll", "格基归约", "lattice reduction", "lenstra lenstra lovasz", "格攻击", "背包攻击", "knapsack attack", "merkle hellman", "低密度攻击", "cjloss", "格约减", "lll算法", "lattice attack", "短向量", "shortest vector"],
  },

  prngAttack: {
    what: "PRNG cracking: LCG (linear congruential) parameter recovery + MT19937 (Python random engine) state recovery. Given a run of consecutive random outputs, recover the internal parameters/state and predict subsequent values. Very common in CTF crypto.",
    principle:
      "**LCG** $x_{n+1}=(ax_n+c)\\bmod m$: given ≥3 consecutive outputs, use the difference method — $t_n=x_{n+1}-x_n$, modulus $m=\\gcd(t_i,t_j,\\dots)$ (stable with ≥5 outputs, otherwise m must be given), $a=t_1 t_0^{-1}\\bmod m$, $c=x_1-ax_0\\bmod m$.\n\n" +
      "**MT19937**: the engine Python random uses, whose output goes through a tempering transform (4 shift-XOR steps 11/7/15/18). Given 624 consecutive 32-bit outputs, untemper each one (reversing the 4 steps) to recover the 624-word internal state, then run one twist to predict the 625th and all subsequent outputs.",
    usage: "Pick a mode: lcg (one output number per line, optionally a known modulus m) or mt19937 (624 consecutive 32-bit outputs). Output is the recovered parameters/state + the next predicted value + a consistency check.",
    examples: [
      { in: "624 个 getrandbits(32) 输出", param: "mode=mt19937", out: "恢复 state + 预测第 625 个", desc: "Python random prediction" },
    ],
    formulas: [
      { tex: "a = t_1\\,t_0^{-1}\\bmod m,\\quad c = x_1 - a x_0 \\bmod m", caption: "LCG difference method recovers the multiplier and increment" },
    ],
    tips: [
      "Common LCG moduli: $2^{31}$ (glibc rand), $2^{32}$, $2^{48}$, $2^{64}$.",
      "MT19937 needs exactly 624 consecutive 32-bit outputs with no skips in between.",
      "The m derived from the difference GCD may be a factor of the true modulus — if it looks off, fill in m by hand.",
    ],
    aka: ["prng破解", "prng attack", "随机数预测", "lcg破解", "linear congruential", "线性同余", "mt19937", "mersenne twister", "梅森旋转", "untemper", "random预测", "python random破解", "伪随机数攻击", "随机数恢复"],
  },

  rsaBatchGcd: {
    what: "RSA common-factor factorization (batch GCD): compute pairwise GCDs across many RSA moduli N, and if any two share a prime factor, both are factored at once. The classic attack when a bad random number generator makes different keys reuse a prime.",
    principle:
      "If two moduli $N_i=p\\cdot q_1$ and $N_j=p\\cdot q_2$ share a prime factor $p$, then $\\gcd(N_i,N_j)=p>1$, and a single GCD factors both moduli at once: $q_1=N_i/p$, $q_2=N_j/p$.\n\n" +
      "This op does $O(k^2)$ pairwise GCDs over all input moduli (plenty for CTF scale; for genuinely massive key sets use Bernstein's product-tree batch GCD at $O(k\\log^2 k)$). On finding a common factor it outputs p, q1, q2 with a verification.",
    usage: "Input several RSA moduli N (one per line or comma-separated, at least 2). Output is every pair of moduli sharing a prime factor, along with their factorization.",
    examples: [
      { in: "N1=91\nN2=143", out: "gcd=13, N1=13×7, N2=13×11", desc: "two moduli sharing prime factor 13" },
    ],
    formulas: [
      { tex: "\\gcd(N_i, N_j) = p > 1 \\;\\Rightarrow\\; N_i = p\\cdot\\frac{N_i}{p},\\ N_j = p\\cdot\\frac{N_j}{p}", caption: "A shared prime factor gives a double factorization in one GCD" },
    ],
    tips: [
      "The root cause is insufficient RNG entropy causing different keys to collide on a prime (in 2012 Lenstra et al. really did scan out large numbers of weak RSA public keys).",
      "If two moduli are coprime, gcd=1 and this attack doesn't apply.",
      "After factoring out p, q, use rsaParams to find d and decrypt.",
    ],
    aka: ["批量gcd", "batch gcd", "公共因子分解", "common factor attack", "rsa共因子", "共享素数攻击", "shared prime", "两两gcd", "rsa批量分解", "gcd攻击", "共模数因子", "rsa公因子", "弱rsa密钥", "batch gcd attack"],
  },

  rsaHastad: {
    what: "RSA Håstad broadcast attack: the same plaintext m is encrypted with the same small public exponent e and broadcast to e different recipients (each with their own modulus n_i); an attacker who collects e ciphertexts can recover the plaintext without any private key.",
    principle:
      "The same plaintext $m$ is encrypted with the same $e$ and $e$ pairwise-coprime $n_i$ to give $c_i=m^e\\bmod n_i$.\n\n" +
      "Merge these $e$ congruences with the Chinese Remainder Theorem (CRT) to get $M\\equiv c_i\\pmod{n_i}$ with $M<\\prod n_i$. Since $m<\\min(n_i)$, we have $m^e<\\prod n_i$, so $M=m^e$ is an exact integer value (never wrapped around by any modulus).\n\n" +
      "Finally take the integer $e$-th root of $M$ to obtain the plaintext $m$.",
    usage: "Input one group of `n,c` (comma-separated) per line, at least e groups. Set the public exponent e (default 3). Output is the CRT-merged M, the m obtained by the e-th root, and its ASCII.",
    examples: [
      { in: "n1,c1\nn2,c2\nn3,c3", param: "e=3", out: "m + ASCII", desc: "e=3 needs 3 ciphertexts" },
    ],
    formulas: [
      { tex: "M \\equiv c_i \\pmod{n_i} \\;\\Rightarrow\\; M = m^e,\\quad m = \\sqrt[e]{M}", caption: "After CRT merging, take the integer e-th root" },
    ],
    tips: [
      "You need at least e ciphertexts from different moduli; e=3 is the most common.",
      "The plaintext must satisfy $m<\\min(n_i)$ (no random padding) for the attack to hold.",
      "A failed root usually means too few ciphertexts or a plaintext too long (exceeding some n_i).",
    ],
    aka: ["hastad", "håstad广播攻击", "hastad broadcast", "广播攻击", "低指数广播", "rsa广播", "crt广播攻击", "低加密指数攻击", "small exponent attack", "hastad attack", "多密文攻击", "rsa低指数", "同明文广播"],
  },

  rsaPollardPm1: {
    what: "RSA Pollard p-1 factorization: when a prime factor p of the RSA modulus N satisfies \"p-1 is B-smooth\" (all prime factors of p-1 are small), p can be factored efficiently. Complementary to Pollard rho.",
    principle:
      "If a prime factor $p$ satisfies that $p-1$ is B-smooth (all prime-power factors $\\le B$), let $M=\\prod_{q\\le B}q^{\\lfloor\\log_q B\\rfloor}$; then $p-1\\mid M$.\n\n" +
      "By Fermat's little theorem $a^{p-1}\\equiv 1\\pmod p$, so $a^M\\equiv 1\\pmod p$, hence $p\\mid\\gcd(a^M-1,N)$. Compute $\\gcd(a^M-1,N)$; if the result falls in $(1,N)$ it is a non-trivial factor.\n\n" +
      "Two failure cases: $\\gcd=1$ (B too small, neither factor is B-smooth); $\\gcd=N$ (B too large, both factors are B-smooth — decrease B).",
    usage: "Input the modulus N to factor (one per line or comma-separated). Set the base a (usually 2) and the smoothness bound B (e.g. 1000/10000). Output is the factors p, q and a verification.",
    examples: [
      { in: "N=(p-1 光滑的合数)", param: "base=2, bound=1000", out: "p, q（p·q=N）", desc: "instant when p-1 is smooth" },
    ],
    formulas: [
      { tex: "a^M \\equiv 1 \\pmod p,\\quad p \\mid \\gcd(a^M - 1,\\ N)", caption: "M = ∏ q^⌊log_q B⌋; Fermat's little theorem yields the factor" },
    ],
    tips: [
      "If it won't factor, raise B (p-1 not smooth enough); if gcd=N, lower B.",
      "When p-1 or q-1 has a large prime factor, this algorithm fails — switch to rho or Fermat.",
      "Choosing strong primes (both p-1 and p+1 having large factors) defends against both p-1 and p+1 factorization.",
    ],
    aka: ["pollard p-1", "p减1分解", "pollard p minus 1", "p-1算法", "光滑数分解", "b-smooth", "pollard p-1 factorization", "费马小定理分解", "p-1光滑", "smooth factoring", "波拉德p-1", "rsa p-1攻击", "p-1 method"],
  },

  des2Mitm: {
    what: "2DES meet-in-the-middle attack: C = DES_k2(DES_k1(P)) looks like 112-bit security, but MITM reduces it to ~2^56 × 2 (with b-bit halves: 2^b × 2). CTF 2DES challenges usually constrain the keys to a small space; this op brute-recovers (k1, k2).",
    principle:
      "MITM: build a forward table { DES_k1(P) → k1 } over all k1 (2^b entries), then for each k2 compute DES_k2⁻¹(C) and look it up; hits are candidates. Verify each candidate with the full chain C'=DES_k2(DES_k1(P)) to filter table collisions. Complexity drops from 2^(2b) to 2^b × 2.\n\n" +
      "Key encoding: k1/k2 each occupy keyBits bits (default 16), big-endian into 8 bytes for DES. Note DES ignores the parity bit (bit 0) of each byte — the recovered key may be an equivalent (e.g. 0x619F ≈ 0x609E).",
    usage: "Input format: plaintext-hex space ciphertext-hex (8 bytes each). keyBits controls each half's key space (default 16, ≤20). Outputs the matching key pairs + timing.",
    examples: [
      { in: "0123456789abcdef ciphertext-hex", param: "keyBits=16", out: "hit: k1=... k2=...", desc: "recovers both keys (parity-bit tolerance)" },
    ],
    tips: ["Never use 2DES — MITM makes it barely stronger than single DES; CTF setters often shrink the key space to brute-forceable size. Try keyBits from small to large until it solves.", "Multiple hits are normal (DES parity bits + table collisions); the full-chain check filters false positives."],
    aka: ["2des攻击", "中间相遇", "meet in the middle", "2des破解", "双重des", "2des mitm", "中间相遇攻击", "双des攻击", "2des破解工具", "des2攻击", "meet-in-the-middle", "2des密码分析", "2des密钥恢复", "双重加密攻击", "2des爆破"],
  },
};
