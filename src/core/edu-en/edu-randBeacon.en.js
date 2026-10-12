/*
 * edu-randBeacon.en.js — English edu shard for public randomness beacon verification (drand / NIST).
 *
 * Aligned with the op's actual parameter surface (provider/action/pubkey/prev/endpoint/round/allowNetwork);
 * examples use official real data (drand mainnet round 100).
 */
export default {
  randBeacon: {
    what: "Public randomness beacon verification: paste one record published by the drand / NIST public randomness beacon, and recompute its official signature (BLS12-381 / RSA) and hash chain offline to prove the random value really came from the beacon and has not been altered since publication. A beacon is a globally recomputable \"public lottery machine\" — this tool lets anyone produce that proof offline.",
    principle:
      "The value of a beacon is not \"more random\" but \"publicly verifiable and tamper-evident after the fact\":\n\n" +
      "- drand (league of entropy): each round's signature $\\sigma$ is a BLS12-381 signature (issued collectively by a threshold of nodes) over $\\mathrm{SHA\\text{-}256}(\\text{previous signature} \\parallel \\text{round number})$, and the randomness $= \\mathrm{SHA\\text{-}256}(\\sigma)$; the previous signature is baked into the next round's message, chaining the rounds — alter any historical round and every later round fails.\n" +
      "- NIST Randomness Beacon 2.0: each pulse is signed with RSA-PKCS#1 v1.5 / SHA-512 (RSA-4096) over a length-prefixed field serialization, and the output value $= \\mathrm{SHA\\text{-}512}(\\text{signed input} \\parallel \\text{signature})$; the previous pulse's output value is carried inside the next pulse, chaining them the same way.\n\n" +
      "The trust root is the beacon's official public key (the drand mainnet group key is built in; NIST uses the X.509 certificate matching the certificateId). This tool is fully isolated from key generation: NIST explicitly states beacon values must never be used as key material.",
    usage: "Pick the beacon source (drand / NIST); \"Verify (offline)\" — paste the record JSON (single object or an array) into the main input and run: drand can leave the key empty to use the built-in mainnet key, while NIST should include a certificate PEM or public-key PEM for RSA verification (without one only the hash chain is checked); \"Fetch (online)\" requires explicitly ticking \"Allow network fetch\" plus a round/pulse number before the tool contacts the official endpoint. Multiple records are automatically checked for round-by-round / pulse-by-pulse chain linkage.",
    examples: [
      { in: "{\"round\":100,\"randomness\":\"4bd45652d69c2060e3efcba3…\",\"signature\":\"82505eaf90b79cb29fcec082…\"}", param: "drand, Verify (offline), key left empty", out: "[drand] public randomness beacon verification (pedersen-bls-chained)\n  1) randomness = SHA-256(signature)  ✓\n  2) msg = SHA-256(round_be8) = …\n  3) BLS12-381 verify e(σ,G1)=e(H(msg),pk)  ✓\nResult: PASS (1 drand record authentic, complete and un-tampered)", desc: "Official real data from drand mainnet round 100; flipping any bit of the randomness fails immediately" },
      { in: "an array of two drand records (round 100, 101)", param: "Verify (offline)", out: "both verified ✓ + chain linkage: previous_signature linked across 2 rounds ✓", desc: "skipping a round (e.g. 100, 102) reports \"chain break\" with the exact position" },
    ],
    tips: [
      "Use cases: proving lottery fairness, auditable challenge-response, and post-hoc proof that \"this random value was exactly this at that time\" — the need is verifiability, not unpredictability.",
      "Verification is offline: paste the official record and it runs with zero network requests; only the \"Fetch\" action, after explicit consent, reaches the network.",
      "Three checks when verification fails: randomness/chain recomputation mismatch = the value was altered; BLS/RSA signature mismatch = the record was tampered with or the key does not match; chain break = a round or pulse is missing from the record.",
      "Never use beacon values as keys: the whole world can see them — NIST's own documentation forbids it; for secret randomness use the System / Mixed modes of Enhanced Random Security.",
    ],
    aka: ["public randomness beacon verify", "randomness beacon", "drand verify", "NIST beacon", "beacon verification", "verifiable randomness", "publicly verifiable random", "tamper-evident randomness", "BLS12-381 beacon", "league of entropy", "NIST randomness beacon 2.0", "beacon verify", "公开随机信标验证", "random beacon"],
  },
};
