# Base32

> UI path: **Base encoding** → `Base32`. Family: Base encoding.

## L1 Quick reference

**What it is**: An encoding that uses 32 characters (`A-Z` plus `2-7` by default) to represent bytes. It is longer than Base64 but uses only uppercase letters and a few digits, which makes hand-copying less error-prone.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Variant | select | `rfc4648` | `rfc4648` (A-Z2-7, padded) / `hex` (0-9A-V, padded) / `crockford` (no I L O U, tolerant, unpadded) / `zbase32` (lowercase, unpadded) |
| Pad with = (rfc4648/hex only) | toggle | on | When off, no trailing `=` |
| Strip non-alphabet chars when decoding | toggle | off | Removes whitespace etc. |
| Custom alphabet (overrides variant) | text | empty | Must be exactly 32 characters |

**Minimal example**:

```
Input:  abc
Params: defaults (rfc4648, padded)
Click Encode → Output: MFRGG===
```

## L2 Details

**Walkthrough**:
1. Pick **Base encoding** → `Base32`.
2. Paste a Base32 string and click Decode; use Encode for the reverse direction.
3. Identify the variant before decoding: uppercase and only `A-Z2-7` → rfc4648; contains `0-9A-V` → hex; contains `0-9A-HJKMNP-TV-Z` with no `=` → Crockford; all lowercase → zbase32.

**How it works**: Every 5 bytes (40 bits) become eight 5-bit groups; each 5-bit value (0–31) indexes the alphabet. A short final group is zero-padded and marked with `=`, so the output length is a multiple of eight and trailing `=` can only be 1, 3, 4 or 6 characters.

**Common pitfalls**:
1. **The standard alphabet has no `0`, `1`, `8` or `9`.** If you see any of those four digits, it is not rfc4648 Base32 — most likely base32hex or a different encoding entirely.
2. **Crockford and rfc4648 are different alphabets, not different spellings.** Crockford drops `I`, `L`, `O`, `U` and folds `O`→`0`, `I`/`L`→`1` for tolerance. Using the wrong variant shifts the whole stream, not just a few characters.
3. **Trailing `=` only comes in counts of 1, 3, 4 or 6.** The length must be a multiple of eight. If it is not, check whether the copy lost trailing `=`.
4. **base32hex differs only by alphabet order.** `hex` uses `0-9A-V` while the standard uses `A-Z2-7`; they look equally plausible, so try the other variant before assuming corruption.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `NBSWY3DP` | defaults | `hello` |
| Decode (text) | `JBSWY3DPEBLW64TMMQ======` | defaults | `Hello World` |
| Encode (bytes) | `61 62 63` | defaults | `MFRGG===` |
