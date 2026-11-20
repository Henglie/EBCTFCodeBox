# ROT13

> UI path: **Fun / classical encodings** → `ROT13`. Family: ROT shifts.

## L1 Quick reference

**What it is**: A substitution that shifts every English letter 13 places. Because the alphabet has 26 letters, applying it twice returns the original text — so encryption and decryption are the same operation (an involution).

**Parameters**: none.

**Minimal example**:

```
Input:  HELLO
Click Encode → Output: URYYB
```

## L2 Details

**Walkthrough**:
1. Select `ROT13`.
2. Paste text and click either Encode or Decode — the result is identical.
3. Only `A–Z` and `a–z` are transformed; digits, punctuation and spaces pass through unchanged.

**How it works**: `c → (c − 'A' + 13) mod 26`, with uppercase and lowercase handled in their own ranges and non-letters left untouched. Since 13 is half of 26, two applications restore the input.

**Common pitfalls**:
1. **Only 13 is self-inverse within 26 letters.** ROT5 (digits), ROT18 and ROT47 are different constructs. ROT47 is also an involution, but over the 94 printable ASCII characters, so its domain is completely different.
2. **ROT13 leaves digits and non-Latin text alone.** `flag{123}` becomes `synt{123}` — braces and digits unchanged. If punctuation changed too, you used a different ROT.
3. **It is not the same as a Caesar cipher.** Caesar allows an arbitrary shift of 1–25 with the shift amount as the key; ROT13 is the fixed case of shift 13.
4. **Uppercase and lowercase must be shifted separately.** Folding both cases into one 52-character table produces wrong output.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `URYYB` | defaults | `HELLO` |
| Encode (text) | `flag{abc}` | defaults | `synt{nop}` |
