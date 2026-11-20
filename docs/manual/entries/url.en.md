# URL encoding (percent-encoding)

> UI path: **Text / transfer encodings** → `URL encoding`. Family: Text transfer encodings.

## L1 Quick reference

**What it is**: The RFC 3986 encoding that writes characters which are illegal in a URL as `%` followed by two hex digits. A page full of `%XX` in a web challenge is almost always this.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Mode | select | `standard` | `standard` (matches encodeURIComponent, leaves `!*'()` alone) / `full` (encodes `!*'()` too) / `plus` (space→`+`, encodes `!*'()`) |

**Minimal example**:

```
Input:  a b&c
Params: standard (default)
Click Encode → Output: a%20b%26c
```

## L2 Details

**Walkthrough**:
1. Pick **Text / transfer encodings** → `URL encoding`.
2. Paste a string containing `%XX` and click Decode.
3. When encoding, choose by context: `standard` for ordinary parameters, `full` when everything must be escaped, `plus` for `application/x-www-form-urlencoded` form bodies.

**How it works**: The text is first converted to UTF-8 bytes. Each byte is then either kept (if it is URL-safe) or written as `%` plus two uppercase hex digits. That is why one Chinese character becomes three `%XX` groups — it occupies three UTF-8 bytes.

**Common pitfalls**:
1. **The three modes disagree on `!*'()`.** `standard` keeps them (matching browser `encodeURIComponent`), `full` encodes them. The decoded result is identical, so when comparing against another tool you must match its mode first.
2. **Spaces have two spellings.** `%20` is used in paths and general URLs; `+` is used in query strings of form submissions. Only `plus` mode turns `+` back into a space — the other modes treat it as a literal plus sign.
3. **Chinese is three UTF-8 bytes, not one Latin-1 byte.** A single CJK character such as U+4F60 occupies three UTF-8 bytes and becomes `%E4%BD%A0`. A two-byte form such as `%C4%E3` is GBK; decode the bytes as GBK before converting to text.
4. **Double encoding is common.** `%` itself becomes `%25`, so `%2520` decodes once to `%20` and twice to a space. Challenges often stack exactly two layers.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `flag%7Bh3ll0%7D` | defaults | `flag{h3ll0}` |
| Encode (text) | `\u4F60\u597D` | defaults | `%E4%BD%A0%E5%A5%BD` |
| Encode (bytes) | `61 20 62 26 63` | defaults | `a%20b%26c` |

> Note: non-ASCII input and output in the table are shown in `\uXXXX` form; the actual characters are the corresponding Unicode code points.
