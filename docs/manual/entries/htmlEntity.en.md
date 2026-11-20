# HTML entities

> UI path: **Text / transfer encodings** → `HTML entities`. Family: Text transfer encodings.

## L1 Quick reference

**What it is**: The escaping scheme that writes characters with special meaning in HTML (`<`, `>`, `&`) as `&lt;`, `&#60;` and similar forms. It shows up constantly in XSS challenges and page source.

**Parameters**: none — encoding and decoding are both automatic.

**Minimal example**:

```
Input:  <a>&
Click Encode → Output: &lt;a&gt;&amp;
```

## L2 Details

**Walkthrough**:
1. Pick **Text / transfer encodings** → `HTML entities`.
2. Paste text containing `&...;` and click Decode.
3. The encode direction automatically escapes the five dangerous characters (`&` `<` `>` `"` `'`).

**How it works**: There are two forms — named entities (`&amp;`, `&lt;`) and numeric entities (decimal `&#60;` or hex `&#x3C;`). Numeric entities address the character's Unicode code point, so any character can be written this way; the decoder accepts both forms.

**Common pitfalls**:
1. **`&` must be escaped first.** If you escape `<` first you get `&lt;`, and then escaping `&` turns the `&` you just produced into `&amp;lt;` — double escaping.
2. **`&#39;` and `&apos;` are not the same thing.** `&apos;` is an XML entity and is not defined in HTML4; this tool emits `&#39;`.
3. **Numeric entities may be decimal or hexadecimal.** `&#102;` and `&#x66;` are both `f`. Matching only `&#x` misses the decimal form.
4. **The semicolon is not optional.** `&lt` without `;` is literal text under a strict parser. Browser error-recovery behaviour is not the standard.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `&lt;script&gt;` | defaults | `<script>` |
| Decode (text) | `&#102;&#108;&#97;&#103;` | defaults | `flag` |
