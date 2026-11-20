# Quoted-Printable

> UI path: **Text / transfer encodings** → `Quoted-Printable`. Family: Text transfer encodings.

## L1 Quick reference

**What it is**: The MIME encoding used by email (RFC 2045): non-ASCII bytes become `=XX`, and over-long lines use a trailing `=` as a soft line break. A wall of `=XX` means this encoding.

**Parameters**: none — encoding and decoding are fully automatic.

**Minimal example**:

```
Input:  two CJK characters, U+4F60 U+597D (UTF-8: E4 BD A0 E5 A5 BD)
Click Encode → Output: =E4=BD=A0=E5=A5=BD
```

## L2 Details

**Walkthrough**:
1. Pick **Text / transfer encodings** → `Quoted-Printable`.
2. Paste QP text and click Decode; the encode direction converts plaintext to QP.
3. If you see repeated three-byte groups such as `=E4=BD=A0`, the original text is UTF-8 Chinese.

**How it works**: Printable ASCII (33–126, plus space and tab when not at end of line) is kept as-is. Every other byte is written as `=` plus two uppercase hex digits; `=` itself becomes `=3D`. Lines are limited to 76 characters, and a trailing `=` marks a soft line break meaning "continue on the next line".

**Common pitfalls**:
1. **A trailing `=` is not data.** It is a soft line break and the next line must be joined to it. Treating it as `=3D` inserts extra bytes.
2. **A literal `=` must be written `=3D`.** If an unescaped `=` appears in the payload, the decoder consumes the following characters as an escape.
3. **Trailing spaces must be written `=20`.** SMTP may strip trailing whitespace in transit, so the standard requires escaping it explicitly at end of line.
4. **Similar to URL encoding but with a different prefix.** QP uses `=`, URL encoding uses `%`. `=E4=BD=A0` is QP; `%E4%BD%A0` is URL encoding — do not nest them by mistake.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `=E4=BD=A0=E5=A5=BD` | defaults | `\u4F60\u597D` |
| Encode (text) | `hello world` | defaults | `hello world` |
| Encode (bytes) | `e4 bd a0 e5 a5 bd` | defaults | `=E4=BD=A0=E5=A5=BD` |

> Note: non-ASCII input and output in the table are shown in `\uXXXX` form; the actual characters are the corresponding Unicode code points.
