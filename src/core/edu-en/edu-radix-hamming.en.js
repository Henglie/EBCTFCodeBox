// English edu shard: radix "Hamming error-correction" closing group — 1 op
// hammingCode
// Pure data, no imports, no side effects. Sample values computed by hamming.js (including single-bit correction verification).
export default {
  hammingCode: {
    what: "Hamming Code: an encoding that can automatically detect and correct 1 bit error. Insert a few parity bits into the data, and even a transmission error can be recovered.",
    principle:
      "Place parity bits at positions that are powers of 2 (positions 1, 2, 4, 8…), and fill the rest with data bits.\n\n" +
      "Each parity bit `2^i` covers the positions \"whose number has bit i set to 1\", using even parity (its coverage XORs to 0).\n\n" +
      "When decoding, XOR together the position numbers of all bits that are 1 to get the \"syndrome\": 0 means no error; nonzero is exactly the number of the errored bit, and flipping that bit corrects it.",
    usage: "Encode direction takes a 0/1 data string (in blocks of k bits, padding the last block with 0); decode direction takes a codeword string to restore the data. Parameter k = data bits per block (default 4 for the classic (7,4) code, 11 for the (15,11) code).",
    examples: [
      { in: "1011", param: "k=4", out: "0110011", desc: "(7,4) Hamming code: 4 data bits + 3 parity bits" },
      { in: "0100011", param: "k=4 (bit 3 has been flipped in error)", out: "1011", desc: "decoding auto-corrects the 1-bit error and still restores 1011" },
      { in: "11111111111", param: "k=11", out: "111111111111111", desc: "(15,11) code: 11 data bits + 4 parity bits" },
    ],
    formulas: [
      { tex: "2^r \\ge k + r + 1", caption: "the minimum number of parity bits r needed for k data bits" },
    ],
    tips: [
      "(7,4) is the most classic Hamming code: every 4 data bits get 3 parity bits, correcting 1 bit error.",
      "A syndrome of 0 = no error; nonzero = the number of the errored bit — this is the essence of how Hamming codes \"locate errors\".",
      "It can only correct 1 bit error: if a block has 2 bit errors, correction actually makes things worse (the inherent limit of SEC single-error correction).",
    ],
    aka: ["海明码", "汉明码", "hamming code", "纠错码", "SEC", "(7,4)码", "海明纠错码", "hamming ecc", "单错纠正", "校验位编码", "error correcting code", "汉明距离编码", "(15,11)码", "奇偶校验纠错"],
  },
};
