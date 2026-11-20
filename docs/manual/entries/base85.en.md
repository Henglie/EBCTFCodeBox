# Base85 / Ascii85

> UI path: **Base encoding** → `Base85 / Ascii85`. Family: Base encoding.

## L1 Quick reference

**What it is**: A denser-than-Base64 encoding that represents 4 bytes with 5 characters. Adobe Ascii85 (usually wrapped in `<~ ~>`) and ZeroMQ's Z85 are both variants of it.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Alphabet | select | `Standard` | `Standard` (Adobe Ascii85) / `Z85` (ZeroMQ) / `IPv6` (RFC 1924) |
| Custom Alphabet (85 chars, empty = preset above) | text | empty | 85 distinct characters |
| Compat mode (output without `<~ ~>` wrapper) | toggle | off | Disables the wrapper |
| Output `<~ ~>` wrapper (Standard only) | toggle | on | Adds the boundary markers |
| All-zero group char (Standard) | text | `z` | A 4-byte zero group collapses to this character |
| Strip non-alphabet chars when decoding | toggle | off | Removes whitespace etc. |

**Minimal example**:

```
Input:  Hello
Params: Standard (default, with <~ ~>)
Click Encode → Output: <~87cURDZ~>
```

## L2 Details

**Walkthrough**:
1. Pick **Base encoding** → `Base85 / Ascii85`.
2. If the string starts with `<~` and ends with `~>`, it is Adobe Ascii85 — decode it directly.
3. If there is no wrapper, try *Compat mode* first; if it is still garbled, switch to `Z85` or `IPv6`. These three alphabets are not interchangeable.

**How it works**: Each 4-byte group is read as an unsigned 32-bit integer and written in base 85 as exactly 5 digits (85⁵ > 2³²). Adobe's version collapses an all-zero 4-byte group into a single `z` and marks the block boundaries with `<~ ~>`; Z85 neither compresses nor wraps — it only changes the alphabet.

**Common pitfalls**:
1. **`<~ ~>` is a marker, not data.** If the decoder does not strip or recognize the wrapper, `<~` participates in the arithmetic and every subsequent character is shifted.
2. **The `z` zero-group rule is Adobe-only.** Z85 has no such rule, so the same zero bytes produce a different length in the two variants; you cannot swap them.
3. **Input length must be a multiple of 4.** Ascii85 works in 4-byte groups and has a special rule for a short final group; feeding 3 bytes produces a result that differs from reference tools.
4. **Z85 puts `#`, `@`, `%`, `$` at the end of its table.** Ascii85 uses a contiguous `!`–`u` range. Visual similarity tells you nothing here — you have to try the variant.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Encode (text) | `Hello` | defaults | `<~87cURDZ~>` |
| Decode (text) | `<~87cURDZ~>` | defaults | `Hello` |
| Encode (bytes) | `61 62 63` | defaults | `<~@:E^~>` |
