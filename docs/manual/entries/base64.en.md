# Base64

> UI path: **Base encoding** → `Base64`. Family: Base encoding.

## L1 Quick reference

**What it is**: A general-purpose encoding that turns arbitrary bytes into plain ASCII ("3 bytes → 4 characters"). It is the standard way to carry binary data through email, JSON and URL parameters. It is **not** encryption — anyone can decode it.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| URL-safe (+/ → -_) | toggle | off | Maps `+`→`-` and `/`→`_`; required by URLs and JWT |
| Pad with = (off = no padding, e.g. JWT) | toggle | on | When off, no trailing `=`; length may not be a multiple of 4 |
| Strip non-alphabet chars when decoding | toggle | off | Removes newlines/spaces before decoding |
| Strict mode (error on non-alphabet chars) | toggle | off | Mutually exclusive with stripping: no silent cleanup |
| Custom alphabet | text | `A-Za-z0-9+/` | Replaces the 64-char table (variant challenges) |
| Show all Base64 offsets | toggle | off | CyberChef-style offset view |
| Offset alphabet | text | `A-Za-z0-9+/=` | Alphabet used by the offset view |
| Offset: mark variable/padding chars | toggle | off | Highlights positions that may vary |
| Offset: input format | select | Raw | `Raw` / `Base64` |

**Minimal example**:

```
Input:  foobar
Params: defaults
Click Encode → Output: Zm9vYmFy
```

## L2 Details

**Walkthrough**:
1. Pick **Base encoding** → `Base64`.
2. Paste plaintext and click Encode; paste a Base64 string and click Decode for the reverse direction.
3. If decoding fails, check these three first: (a) hidden line breaks — enable *strip non-alphabet*; (b) it is the URL variant — enable *URL-safe*; (c) it is a JWT segment — turn *padding* off.

**How it works**: The input is split into 3-byte groups. Each 24-bit group is re-divided into four 6-bit values (0–63), and each value indexes the 64-character alphabet. A short final group is zero-padded and marked with `=`, which is why Base64 length is always a multiple of four and the number of trailing `=` tells you how many bytes were missing.

**Common pitfalls**:
1. **URL-safe and standard tables are not interchangeable.** In the standard table `+` and `/` must be percent-escaped inside URLs, so JWT and short links use `-` and `_`. Decoding a URL-safe string with the standard table breaks exactly at those characters — and usually without an error.
2. **Disabling padding breaks the "multiple of 4" check.** Every JWT segment has no `=`, so a strict length check will reject perfectly valid data.
3. **Newlines are legal noise.** Email Base64 wraps every 76 characters. Decoding a wrapped blob directly fails; strip whitespace first.
4. **`=` is a placeholder, not data.** The number of `=` must match the unused bits in the final character. One too many or too few can silently produce wrong bytes rather than an error.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `Zm9vYmFy` | defaults | `foobar` |
| Encode (text) | `(empty)` | defaults | `(empty)` |
| Encode (bytes) | `66 6f 6f 62 61 72` | defaults | `Zm9vYmFy` |
