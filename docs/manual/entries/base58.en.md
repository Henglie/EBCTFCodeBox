# Base58

> UI path: **Base encoding** → `Base58`. Family: Base encoding.

## L1 Quick reference

**What it is**: A radix encoding that removes visually ambiguous characters (`0`, `O`, `I`, `l`). It is the standard for Bitcoin addresses and short links. The whole byte string is treated as one big integer and repeatedly divided by 58.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Alphabet | select | `bitcoin` | `bitcoin` / `flickr` (lowercase first) / `ripple` (XRP order) / `custom` (use the table below) |
| Strip non-alphabet chars when decoding | toggle | off | Removes whitespace etc. |
| Custom alphabet (used when alphabet=custom) | text | Bitcoin table | 58 distinct characters |

**Minimal example**:

```
Input:  hello world
Params: bitcoin (default)
Click Encode → Output: StV1DL6CwTryKyV
```

## L2 Details

**Walkthrough**:
1. Pick **Base encoding** → `Base58`.
2. Keep the default bitcoin alphabet and paste the string; click Decode.
3. If the result is garbage, switch the alphabet. Flickr reorders upper/lowercase and Ripple uses its own permutation — trying all three costs almost nothing.

**How it works**: The byte string is read as one base-256 integer. Repeated division by 58 yields remainders that index the alphabet; the digits are emitted most-significant first. Leading zero bytes are not divided — each becomes a leading `1` (the first character of the Bitcoin alphabet).

**Common pitfalls**:
1. **`0`, `O`, `I` and `l` do not exist in Base58.** If a string contains them, it is not Base58 or it was copied incorrectly by hand.
2. **The three alphabets are incompatible and fail silently.** Bitcoin, Flickr and Ripple order the same 58 characters differently. Decoding with the wrong table produces plausible-looking bytes that are entirely wrong — with no error.
3. **Leading zeros are significant.** A leading `0x00` byte becomes a leading `1`; if you strip those `1`s before decoding, the recovered data is short by that many bytes.
4. **Base58Check is not plain Base58.** Bitcoin addresses append a 4-byte double-SHA-256 checksum. Decoding one as plain Base58 gives you four extra trailing bytes.

**Real-world cases**: No verified case available yet.

## More examples

| Direction | Input | Params | Output |
|---|---|---|---|
| Encode (text) | `hello world` | defaults | `StV1DL6CwTryKyV` |
| Decode (text) | `StV1DL6CwTryKyV` | defaults | `hello world` |
| Encode (bytes) | `61 62 63` | defaults | `ZiCa` |
