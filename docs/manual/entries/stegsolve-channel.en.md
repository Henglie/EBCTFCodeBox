# StegSolve Channel Separation

> UI path: **File steganography** → `StegSolve image analysis` → **Image transforms** / **Data Extract**. Family: File steganography.

## L1 Quick reference

**What it is**: Shows one RGBA channel at a time — the chosen channel keeps its original value and the other colour channels are zeroed. Image challenges often hide the flag in a single channel while the other three are noise or flat, so channel isolation comes before bit-plane work.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Open image | file picker / drop | none loaded | PNG/APNG/GIF/JPEG/BMP/WebP; everything is decoded to RGBA, missing Alpha becomes 255 |
| Current transform | ← → / prev-next | item 1, "Original" | 42 items; `Full Alpha` is item 35 (index 34), `Full Red` 36 (35), `Full Green` 37 (36), `Full Blue` 38 (37) |
| Data Extract: Alpha/Red/Green/Blue | bit buttons | none selected | 8 buttons per row, labelled 7…0; the label **is** the bit index, 0 = LSB, 7 = MSB |
| Bit order | select | `MSB First` | `MSB First` / `LSB First`; only changes traversal among several bits of the same channel |
| Direction | select | `Row` | `Row` / `Column` |
| Plane order | select | `RGB` | `RGB / RBG / GRB / GBR / BRG / BGR`; Alpha is always emitted first |
| Preview includes hex dump | toggle | on | Off leaves only the ASCII column |
| Preview / Save text / Save Bin | buttons | — | Text is a formatted preview; Bin is the complete byte stream |

**Minimal example**: a 4×4 RGBA image, row-major pixels
`01 80 00 FF`, `02 40 80 00`, `04 20 C0 7F`, `08 10 40 80`,
`10 08 20 FF`, `20 04 10 00`, `40 02 08 7F`, `80 01 04 80`,
`FE FF 03 FF`, `FD FE 02 00`, `FB FD 01 7F`, `F7 FB 00 80`,
`EF F7 FF FF`, `DF EF FE 00`, `BF DF FD 7F`, `7F BF FB 80`.
With **Full Red**, pixel 1 becomes `01 00 00 FF` and pixel 9 becomes `FE 00 00 FF`: only R survives, G/B are zero, output alpha is forced to 255.

## L2 Details

**Walkthrough**:
1. **File steganography** → `StegSolve image analysis` (hash `#/op/stegSolve`), then **Open image** or drop a file on the dashed area.
2. Step through all 42 transforms with ←/→; the bar shows `n / 42`. Start with the four `Full …` entries, then the per-channel bit planes.
3. For exact bytes switch to **Data Extract**, click the bit numbers on the Alpha/Red/Green/Blue rows, choose bit order, direction and plane order, then **Preview**. **Save Bin** writes the complete bytes.

**Pixel criterion (hand-checkable)**: `Full Red` computes `out = (R, 0, 0, 255)`; `Full Green` `(0, G, 0, 255)`; `Full Blue` `(0, 0, B, 255)`. `Full Alpha` does **not** write the value back to alpha — it writes it into **Red**: `out = (A, 0, 0, 255)`. On the fixture, the first four pixels of **Full Alpha** are `FF 00 00 FF`, `00 00 00 FF`, `7F 00 00 FF`, `80 00 00 FF`. An alpha of 0 therefore renders as opaque black, not as "invisible".

Extracting one channel's bit0 (MSB order, row scan) on 16 pixels gives 1 bit per pixel, 2 bytes:

| Selected | bit0 per pixel | Output hex |
|---|---|---|
| Red bit0 | 1 0 0 0 0 0 0 0 0 1 1 1 1 1 1 1 | `807f` |
| Green bit0 | 0 0 0 0 0 0 0 1 1 0 1 1 1 1 1 1 | `01bf` |
| Blue bit0 | 0 0 0 0 0 0 0 0 1 0 1 0 1 0 1 1 | `00ab` |
| Alpha bit0 | 1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0 | `aaaa` |

Selecting R/G/B bit0 together (3 bits per pixel, 6 bytes) yields `80000273efbf` for `RGB` and `200002c7beff` for `BGR`. The only difference is the within-pixel channel order, proving that "plane order" is a channel order, not a bit-number order.

**How it works**: after decoding, each pixel is four 8-bit samples. A channel transform reads one sample by channel index, zeroes the other colour samples, and writes an opaque preview alpha. Data extraction takes one bit at a time in pixel order → channel order → bit order and packs bytes MSB-first.

**Common pitfalls**:
1. **`Full Alpha` lands in the Red channel** (matching StegSolve's jar transmask behaviour). Do not read it as an alpha output; the result image is always opaque.
2. **Alpha = 0 is not a missing channel.** The decoder keeps a readable 0, so Alpha bit0 extraction returns 0. Only formats without alpha (e.g. JPEG) get the 255 fill.
3. **UI row order is Alpha, Red, Green, Blue, but output order is Alpha first, then plane order.** Alpha bits precede RGB even when plane order is `BGR`. With RGB-only selections this is invisible; with A selected it shifts every byte.
4. **The preview is not the original image.** Saving the current view re-encodes the canvas as PNG. Use **Save Bin** for raw extracted bytes.
5. The `LSB B0` shortcut clears and selects **Blue bit0** only; bits already selected on Red/Green/Alpha are left untouched.

**Limits and boundaries**:
- On a 2×2 all-zero image (RGBA `00`), all four `Full …` transforms output `00 00 00 FF`: the channels are indistinguishable. That is the correct result, not a load failure. Alpha bit0 extraction on the same image is `00` (four zero bits padded into one byte).
- Pressing **Preview** before an image is loaded sets the status to "请先打开图像" and leaves the placeholder text "选择位平面后点「预览」。"; no bytes are produced.
- With no bit selected, preview shows "未选择任何位平面。" and the status is `0 字节 · 0 bit/px`. **Save Bin** still downloads a 0-byte `.bin`.

**Download behaviour**: **Save current view** downloads a re-encoded PNG named `<source>_<transformIndex>.png` (e.g. `grid4x4.png_35.png`); **Save Bin** downloads `<source>_extract.bin`; **Save text** downloads `<source>_extract.txt` containing the hex/ASCII preview, which is not the binary payload.

**Real-world cases**: this entry provides synthetic pixel cases and a real-page run only; no verified challenge case is claimed.

## More examples

| Case | Input | Params | Output |
|---|---|---|---|
| Channel isolation | 4×4 above | Full Red | pixel 1 `01 00 00 FF`, pixel 9 `FE 00 00 FF` |
| Channel isolation | 4×4 above | Full Alpha | pixel 1 `FF 00 00 FF`, pixel 2 `00 00 00 FF` |
| One-channel bit | 4×4 above | Green bit0 / MSB / Row / RGB | `01bf` |
| Channel order | 4×4 above | R+G+B bit0 / MSB / Row | `RGB`→`80000273efbf`, `BGR`→`200002c7beff` |
| Boundary | 2×2 all zero | Full Red/Green/Blue/Alpha | all `00 00 00 FF` |
