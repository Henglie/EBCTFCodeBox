# Morse code

> UI path: **Fun / classical encodings** → `Morse code`. Family: Fun encodings.

## L1 Quick reference

**What it is**: The telegraph code that represents letters and digits with dots `.` and dashes `-` (ITU-R M.1677). Characters are separated by spaces and words by ` / `.

**Parameters**: none.

**Minimal example**:

```
Input:  SOS
Click Encode → Output: ... --- ...
```

## L2 Details

**Walkthrough**:
1. Select `Morse code`.
2. Paste a string of `.` and `-` and click Decode; use Encode for the reverse direction.
3. If the separators are irregular, normalize them first: a single space separates characters, while a word gap may appear as several spaces or a slash.

**How it works**: Each letter maps to one to four dots/dashes, each digit to exactly five, and punctuation to five or six. This tool uses one space between characters and ` / ` between words. Unknown characters are preserved verbatim when encoding, and unknown tokens are preserved when decoding — nothing is silently dropped.

**Common pitfalls**:
1. **Spaces carry two levels of meaning.** One space separates characters; ` / ` separates words. Treating every space as a character gap turns `HELLO WORLD` into one long run-on string.
2. **Some challenges substitute `A`/`B` for `.`/`-`.** A common mnemonic writes `A` for dot and `B` for dash. This tool tries that mapping when the input contains no standard dots or dashes, but mixing both symbol sets in one string will decode incorrectly.
3. **Letters and digits share the same dot/dash alphabet.** `....` is `H` while `.....` is `5`; one missing dot changes the character. Hand-copying errors are common here.
4. **Non-standard punctuation has no unique mapping.** Extensions for `@` and `$` differ between references; if a token will not decode, check the table the challenge provided.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Decode (text) | `... --- ...` | defaults | `SOS` |
| Encode (text) | `HELLO WORLD` | defaults | `.... . .-.. .-.. --- / .-- --- .-. .-.. -..` |
