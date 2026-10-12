/*
 * edu-randomSecure.en.js — English edu shard for the standalone "Enhanced Random
 * Security" op. Aligned with the op's actual parameter surface
 * (mode/seed/endpoint/auth/length/format) and the four-mode contract.
 */
export default {
  randomSecure: {
    what: "The \"Enhanced Random Security\" control panel: inspect the current random-source mode and status, switch between System / Mixed / Fully custom / Self-configured server, and get random bytes (hex or base64) at a chosen length. The 【Enhanced Random Security】 toggle in other tools' parameter areas shares the same mode.",
    principle:
      "Random bytes come from one thin abstraction with four modes:\n\n" +
      "- System (default): direct pass-through of crypto.getRandomValues — byte-for-byte identical to running without the enhancement;\n" +
      "- Mixed (hardened): each call draws 32 bytes of fresh system entropy as the IKM, your input is hashed with SHA-256 as the salt, and $\\mathrm{HKDF\\text{-}SHA\\text{-}256}$ derives the output — system entropy always participates (additive hardening only, never weaker than system mode);\n" +
      "- Fully custom: output is determined entirely by your input (same input always yields the same output, reproducible) and never touches system entropy — useful for reproducing experiments, but the strength is your responsibility;\n" +
      "- Self-configured server: draws bytes synchronously from the pre-fetch pool of a random-number server you configured and warmed up; if the pool is not ready it raises an error, never falls back silently.\n\n" +
      "Two hard rules: any failure to obtain randomness raises an explicit error with the underlying cause (no silent degradation); in non-system modes the affected operations run on the main thread (background workers cannot receive your input entropy, and it is never broadcast to them).",
    usage: "Pick a mode (the default \"Follow global\" only inspects without switching), optionally fill the user random input / server address / auth header, choose the byte count (0–4096, default 16) and output format (hex / base64), then run to get a status report and the random bytes. Once a non-system mode is active, the 【Enhanced Random Security】 toggle in other tools shows the same mode badge.",
    examples: [
      { in: "(no input, just run)", param: "mode=Follow global, length=16, format=hex", out: "Current mode: system — System (crypto.getRandomValues, default)\nRandom-source status: system mode; direct pass-through (byte-for-byte identical to the default)\nRequest: 16 bytes · format hex\n\n3f1c… (32 hex characters, random, different every time)", desc: "Default-mode behavior is identical to running without the enhancement" },
      { in: "(no input)", param: "mode=Fully custom, user input=my-seed, length=16", out: "status report (mode custom) + 16-byte hex", desc: "Running again with the same seed yields exactly the same bytes — reproducible; change the seed and everything changes" },
    ],
    tips: [
      "For reproducible CTF experiments pick \"Fully custom\": same input, same output. For real key generation stay on System or Mixed.",
      "The point of Mixed is \"your seasoning + system entropy\": even if your input is predictable, the system entropy keeps the output unpredictable — not the other way around.",
      "Server mode is networking you explicitly configure: you fill the address, it is off by default, and any failure raises an error instead of falling back. Leave it off to stay on the system source.",
      "Security-sensitive operations (signatures, key generation) care about randomness quality: in non-system modes the output carries a mode badge, so you never unknowingly generate keys from custom randomness.",
    ],
    aka: ["enhanced random security", "random source switch", "secure random", "random bytes", "random source mode", "custom random source", "reproducible random", "HKDF mixed randomness", "randomness server", "CSPRNG", "crypto.getRandomValues", "deterministic random", "random source"],
  },
};
