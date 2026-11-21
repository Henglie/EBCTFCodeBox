# StegSolve · Multi-image combine export

> UI path: `StegSolve` → **Image combiner** tab. Family: collection tools · combine.

## L1 Quick reference

**What it is**: Combines the current image with a second image using one of 13 algorithms and exports the result as PNG. Different sizes are **not an error**: non-interlace modes pad the canvas to the larger width and height (out-of-range pixels participate as 0), while interlace modes first crop to the common minimum and then expand the canvas.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Choose second image | file | none | Only that image's **frame 1** takes part |
| Combine mode | select 0–12 | 0 = XOR | `XOR`/`OR`/`AND`/`ADD`/`ADD (R,G,B separate)`/`SUB`/`SUB (R,G,B separate)`/`MUL`/`MUL (R,G,B separate)`/`Lightest`/`Darkest`/`Horizontal Interlace`/`Vertical Interlace` |
| Size/mode label | text | — | e.g. `4×3 · XOR`, showing the **product** size |
| Save combined result | button | disabled until a result exists | Name `<primary name>_combine<mode>.png`, PNG / RGBA |

**Minimal example**:

```
Input:  pair_same_a.png (4×3) + pair_same_b.png (4×3), mode = XOR
Pixel 0: (1,2,3) XOR (255,254,253) = (254,252,254)
Product: pair_same_a.png_combine0.png, 4×3, MIME image/png
```

## L2 Details

**Walkthrough**:
1. Open the primary image and switch to **Image combiner**.
2. Choose the second image (a decode failure reports an error and leaves the save button disabled).
3. Pick a mode; the preview and label refresh to `product width×height · mode`.
4. Click **Save combined result**.
5. For unequal sizes, read the label first and decide whether an interlace mode is appropriate.

**How it works**:
- Non-interlace (0–10) uses `max(width)` × `max(height)`; a coordinate outside one image treats that side as pixel `0`, so the padded region equals “the larger image operated with 0”.
- Modes 3/5/7 operate on the **packed 24-bit value** (carries cross channel boundaries); 4/6/8/9/10 operate **per channel**. The two families give different results.
- Modes 11/12 crop to `min(width)` × `min(height)` and then interleave by row (11) or by column (12), doubling the canvas.
- Only R/G/B participate; **output alpha is always 255**, so input transparency is discarded.

**Measured evidence** (one equal-size 4×3 pair, one unequal 4×3 + 2×2 pair):
- All 13 modes matched the hand-computed expectations pixel for pixel on both fixtures, including the packed-versus-per-channel difference.
- Equal-size XOR: first pixel `(254,252,254,255)`, matching manual calculation.
- Unequal XOR: output `4×3`; `(0,0)` = `(194,112,44)` (the two images XORed) and `(2,0)` = `(70,80,90)` (second image out of range, treated as 0, so only the primary remains).
- Unequal + `Horizontal Interlace` → `2×4`; `Vertical Interlace` → `4×2` (both cropped to 2×2 first).
- All products are 4×3 / 2×4 / 4×2 RGBA 8-bit with MIME `image/png`.

**Common pitfalls**:
1. **Only frame 1 of the second image is used**: a multi-frame second image contributes its first frame, not the currently displayed one.
2. **Loading a new image keeps the previous mode**: after switching the primary image the select still holds the old choice, so `4×3 · ADD (R,G,B separate)` does not mean XOR is the default.
3. **Interlace crops instead of padding**: `4×3 + 2×2` yields `2×4` or `4×2`; the right/bottom pixels are dropped. Use a non-interlace mode to keep the full extent.
4. **Use the preview dimensions, not the label, to predict the canvas size**: `Horizontal Interlace` alternates rows and produces `2×4`; `Vertical Interlace` alternates columns and produces `4×2`.
5. **Alpha is dropped**: transparent inputs still produce an opaque result, so the product cannot be used to inspect the alpha channel.
6. **Same-name overwrite**: the name depends only on “primary name + mode number”. Saving twice with the same parameters yields the same name and the product adds no `(1)` suffix; whether it overwrites depends on the browser and save location.
7. **Unequal sizes are not an error here**: the older core helper named `combineImages` throws “size mismatch”, while this page uses the implementation that pads with 0. Do not mix the two behaviours in documentation.

## More examples

| Action | Input | Parameters | Product |
|---|---|---|---|
| Equal-size XOR | 4×3 + 4×3 | XOR (default) | `pair_same_a.png_combine0.png`, 4×3 |
| Per-channel add | same | ADD (R,G,B separate) | `pair_same_a.png_combine4.png`, 4×3 |
| Unequal XOR | 4×3 + 2×2 | XOR | `pair_diff_a.png_combine0.png`, 4×3 (zero-padded) |
| Unequal interlace | 4×3 + 2×2 | Horizontal Interlace | `pair_diff_a.png_combine11.png`, 2×4 (cropped then doubled) |
| Unequal interlace | 4×3 + 2×2 | Vertical Interlace | `pair_diff_a.png_combine12.png`, 4×2 |
