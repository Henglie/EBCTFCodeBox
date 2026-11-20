# Unicode escape

> UI path: **Text / transfer encodings** → `Unicode escape`. Family: Text transfer encodings.

## L1 Quick reference

**What it is**: The family of escapes that writes characters as `\uXXXX` or `U+XXXX`. It appears in JavaScript/JSON source and in obfuscated strings.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Format | select | `uXXXX` | `uXXXX` / `U+XXXX` / `&#xXXXX;` styles |
| Escape all | toggle | on | On = every character; off = only non-ASCII |
| Padding width | number | 4 | Minimum hex digits (4 inside the BMP) |
| Uppercase hex | toggle | on | `\u0041` vs `\u0041` casing |

**Minimal example**:

```
Input:  AB
Params: defaults (uXXXX, escape all, 4 digits, uppercase)
Click Encode → Output: \u0041\u0042
```

## L2 Details

**Walkthrough**:
1. Pick **Text / transfer encodings** → `Unicode escape`.
2. Paste `\uXXXX` text and click Decode.
3. When encoding, match the destination language: `uXXXX` for JS/JSON, `U+XXXX` for documentation, `&#xXXXX;` for HTML contexts.

**How it works**: Each character's Unicode code point is written as a fixed-width hexadecimal number. Code points inside the BMP (U+0000–U+FFFF) fit in four digits; characters outside it (emoji, for example) are written in JavaScript as a surrogate pair of two `\u` units.

**Common pitfalls**:
1. **Characters outside the BMP are surrogate pairs, not one `\u`.** `😀` (U+1F600) is written `\uD83D\uDE00`. Decoding each `\u` independently and concatenating the results produces mojibake; you must recombine the pair.
2. **`\u` is four hex digits, `\x` is two.** `\x41` is a byte escape (0–255 only) while `\u0041` is a character escape. Mixing them yields different results.
3. **Width and case affect string comparison.** `\u0041` and `\u41` are equivalent in some parsers and not in others. Normalize to four uppercase digits before exact matching.
4. **Not every `\u` is a Unicode escape.** In regular expressions `\u` is escape syntax, and some languages process `\u` during lexing rather than at runtime, with different semantics.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `\u0066\u006c\u0061\u0067` | defaults | `flag` |
| Encode (text) | `Hi` | defaults | `\u0048\u0069` |
