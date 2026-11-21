# StegSolve Bit Planes and Bit Order

> UI path: **File steganography** → `StegSolve image analysis` → `bit plane n` transforms and the **Data Extract** bit buttons. Family: File steganography.

## L1 Quick reference

**What it is**: Isolates **bit k** of an 8-bit channel sample and paints 1 white, 0 black. LSB steganography writes payload into bit0, so the lowest plane often reveals text or a QR code. "Bit order (MSB/LSB First)" only chooses whether several selected bits are read high-to-low or low-to-high; it never renumbers the bits.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Bit plane (Image transforms) | fixed items among 42 | item 1, "Original" | 8 per channel, labelled `Alpha/Red/Green/Blue bit plane 0..7`; 0 = LSB, 7 = MSB |
| Channel bit buttons | button group | none selected | 8 per row, the label **is** the bit index; laid out 7…0 (MSB on the left) |
| Bit order | select | `MSB First` | `MSB First` walks selected bits 7→0; `LSB First` reverses. Same-channel multi-bit order only |
| Direction | select | `Row` | Changes pixel order, not bit numbering |
| Plane order | select | `RGB` | Channel order only; Alpha is always first |
| Invert / colour map (transform page) | internal | off / gray | Transform page emits 0/255 grey |

**Minimal example**: on a 4×4 image whose R channel is `01 02 04 08 10 20 40 80 FE FD FB F7 EF DF BF 7F`, choose **Red bit plane 0** (item 18, index 17). Only pixels with R bit0 = 1 turn white: pixel 1 white, pixels 2–9 black, pixels 10–16 white. **Red bit plane 7** (index 10) is the complement: pixels 8–15 white, all others black.

## L2 Details

**Walkthrough**:
1. Load an image, then step through **Image transforms** with ←/→ until the label reads `Red bit plane 0`; the counter shows `18 / 42`.
2. Channel index base: Alpha planes 7..0 are items 3–10 (indexes 2–9), Red 11–18 (10–17), Green 19–26 (18–25), Blue 27–34 (26–33).
3. For exact bytes switch to **Data Extract**, click the bit numbers, choose `MSB First`/`LSB First`, then **Preview** for hex and **Save Bin** for the complete stream.

**Pixel criterion (hand-checkable)**: for an 8-bit sample v, plane k outputs `v >> k & 1 ? 255 : 0`, with preview alpha forced to 255. For the R values above:

| Plane | 16 bits, pixel order | First two extracted bytes |
|---|---|---|
| Red bit0 | 1 0 0 0 0 0 0 0 0 1 1 1 1 1 1 1 | `807f` |
| Red bit7 | 0 0 0 0 0 0 0 1 1 1 1 1 1 1 1 0 | `01fe` |

So bit0 shows white at pixel 1 and pixels 10–16; bit7 shows white at pixels 8–15.

**Hand-computing bit order**: select Red bit0 **and** bit1 (2 bits/pixel), row scan over 16 pixels = 32 bits:

| Bit order | Bits emitted per pixel | First 4 bytes |
|---|---|---|
| `LSB First` | bit0, then bit1 | `90006fff` |
| `MSB First` | bit1, then bit0 | `60009fff` |

With only Red bit0 selected both orders must produce `807f`: there is only one bit, so order cannot matter. This is the distinction between bit order and bit plane — bit order never reinterprets bit0 as bit7.

**How it works**: a true-colour channel is an 8-bit unsigned sample. Extracting a bit is a right shift and an AND. Selected bits are appended to the output stream, and the stream is always packed MSB-first (`out[bitPos>>3] |= 1 << (7-(bitPos&7))`). Bit order therefore changes the traversal of source bits, not the packing of output bytes.

**Common pitfalls**:
1. **Bit order ≠ bit plane.** With `MSB First` selected and only bit0 checked, you still read bit0. Order only matters when one channel contributes several bits.
2. **Button position is not the bit number.** The row is laid out 7…0; treating the leftmost chip as bit0 shifts everything by seven.
3. **Bits are numbered from 0.** 0 is the least significant bit, 7 the most; there is no bit8.
4. **The transform page is fixed grey.** 1→255 and 0→0; it does not tint the channel. Use `Full Red/Green/Blue/Alpha` for a colour-preserving channel view.
5. **The preview is capped at 64 KiB.** With many bits or a large image the hexdump is truncated, but **Save Bin** contains everything; trust the byte count in the status line.
6. **Alpha planes are real data.** A pixel with alpha 0 simply has zeros in every Alpha plane; it is not skipped as "transparent".

**Limits and boundaries**:
- A 2×2 all-ones image (RGBA all `FF`): Red bit0 transform is four white pixels; extraction gives `f0` (four 1 bits padded into one byte).
- A 2×2 all-zero image: Red bit0 transform is four black pixels; extraction gives `00`. "No visible pattern" is a valid result, not a decode failure.
- Pressing **Preview** before loading an image leaves status "请先打开图像" and produces no bytes.
- With no bits selected the preview reads "未选择任何位平面。" and status is `0 字节 · 0 bit/px`.
- This entry only covers the 8-bit sample path; 16-bit PNG scaling belongs to the decoder layer and was not exercised in the page run.

**Download behaviour**: **Save current view** downloads `<source>_<index>.png` (e.g. `grid4x4.png_17.png`), a re-encoded plane image. **Save Bin** downloads `<source>_extract.bin`; **Save text** downloads `<source>_extract.txt` with a formatted hex/ASCII preview — different content types.

**Real-world cases**: synthetic pixel cases and a real-page run only; no verified challenge case is claimed.

## More examples

| Case | Input | Params | Output |
|---|---|---|---|
| Low plane | 4×4 above | Red bit plane 0 | pixel 1 white, 2–9 black, 10–16 white |
| High plane | 4×4 above | Red bit plane 7 | pixels 8–15 white, rest black |
| Multi-bit LSB order | 4×4 above | Red bit0+bit1 / LSB / Row | `90006fff` |
| Multi-bit MSB order | 4×4 above | Red bit0+bit1 / MSB / Row | `60009fff` |
| Single bit ignores order | 4×4 above | Red bit0 / LSB / Row | `807f` (same as MSB) |
| Boundary (all ones) | 2×2 all `FF` | Red bit0 | four white pixels; extract `f0` |
| Boundary (all zeros) | 2×2 all `00` | Red bit0 | four black pixels; extract `00` |
