# StegSolve Scan Order (Row / Column)

> UI path: **File steganography** → `StegSolve image analysis` → **Data Extract** → **Direction**. Family: File steganography.

## L1 Quick reference

**What it is**: Chooses the order in which pixels are serialised into a bit stream. `Row` means "row 0 left to right, then row 1…"; `Column` means "column 0 top to bottom, then column 1…". Same image, same channel, same bit — a different direction can produce completely different bytes. If the payload was written column-major and you read row-major, you get garbage.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Direction | select | `Row` | `Row` (y outer, x inner) / `Column` (x outer, y inner) |
| Alpha/Red/Green/Blue bit buttons | button group | none | Bits per pixel come from channels and bit numbers; scan order only reorders pixels |
| Bit order | select | `MSB First` | Order among several bits of one channel; orthogonal to scan |
| Plane order | select | `RGB` | Channel order within one pixel; orthogonal to scan |
| Preview / Save text / Save Bin | buttons | — | Bin is complete; preview is capped at 64 KiB |

**Minimal example**: a 4×4 image whose B channel, row-major, is `00 80 C0 40 20 10 08 04 03 02 01 00 FF FE FD FB`. Select only Blue bit0 with `MSB First`:

- `Row` → `00ab` (2 bytes)
- `Column` → `3031` (2 bytes)

Both use the same 16 bits; only their order differs.

## L2 Details

**Walkthrough**:
1. Load an image and open **Data Extract**.
2. Press **Clear** on all four channel rows, then click only `0` on the Blue row.
3. Keep bit order `MSB First` and plane order `RGB`.
4. Choose `Row` under **Direction**, press **Preview**, note the hex.
5. Change only **Direction** to `Column`, press **Preview**; a different result proves the scan order took effect.

**Pixel criterion (hand-checkable)**: the 16 Blue values in row order are `00 80 C0 40 20 10 08 04 03 02 01 00 FF FE FD FB`, so bit0 is
`0 0 0 0 0 0 0 0 1 0 1 0 1 0 1 1` → first byte `00000000` = `00`, second `10101011` = `ab`; row output `00ab`.

In column order the pixels are `(0,0),(0,1),(0,2),(0,3),(1,0),…`, i.e. B values `00,20,03,FF, 80,10,02,FE, C0,08,01,FD, 40,04,00,FB`. Their bit0 values are
`0,0,1,1, 0,0,0,0, 0,0,1,1, 0,0,0,1` → `00110000` = `30`, `00110001` = `31`, hence `3031`.

Concatenation is continuous: there is no per-row padding. Sixteen bits fill exactly two bytes; only the final incomplete byte is zero-padded on the right.

**How it works**: the implementation uses `for y { for x }` for row and `for x { for y }` for column. For each pixel it emits bits in "Alpha → plane order" channel sequence, using the selected bit numbers. Bytes are always packed MSB-first, and the length is `ceil(width*height*selectedBits/8)`.

**Common pitfalls**:
1. **Direction and bit order are different axes.** Direction reorders pixels; bit order reorders multiple bits inside one channel of one pixel. Change one at a time.
2. **Direction and plane order are also different.** `BGR` changes the within-pixel channel sequence; it does not turn a row scan into a column scan.
3. **Odd dimensions need no row padding.** 1×4 or 3×5 are treated as one continuous bit stream; only the last byte can be padded.
4. **Width 1 makes direction unobservable.** On a 1×4 image row and column are the same sequence and must give the same result. Do not generalise "the two results must differ".
5. **Save text is not binary.** `Save text` writes a hex/ASCII preview; use `Save Bin` to feed other tools.
6. **Preview truncation.** The preview stops at 64 KiB; the byte count in the status line is the full length. Never infer total length from the preview.

**Limits and boundaries**:
- 1×4 image (B channel `01 02 04 08`, other channels not selected): Blue bit0 is `1 0 0 0`; both row and column produce `80`. Direction degenerates when width is 1.
- With no bit selected, preview shows "未选择任何位平面。" and status is `0 字节 · 0 bit/px`. **Save Bin** still downloads a 0-byte `grid4x4.png_extract.bin`.
- With no image loaded, **Preview** sets status "请先打开图像", leaves the placeholder text and produces no download.
- This run covered 4×4 and 1×4 fixtures; performance and 64 KiB truncation on large non-square images were not exercised per size.

**Download behaviour**: **Save Bin** → `<source>_extract.bin` (complete bytes); **Save text** → `<source>_extract.txt` (formatted preview); **Save current view** belongs to the transform page and downloads a PNG unrelated to extracted bytes.

**Real-world cases**: synthetic pixel cases and a real-page run only; no verified challenge case is claimed.

## More examples

| Case | Input | Params | Output |
|---|---|---|---|
| Row first | 4×4, B=`00 80 C0 40 20 10 08 04 03 02 01 00 FF FE FD FB` | Blue bit0 / MSB / Row / RGB | `00ab` |
| Column first | same | Blue bit0 / MSB / Column / RGB | `3031` |
| Width 1 | 1×4, B=`01 02 04 08` | Blue bit0 / MSB / Row | `80` |
| Width 1 (column) | same | Blue bit0 / MSB / Column | `80` (identical) |
| No selection | any loaded image | no bits selected | text "未选择任何位平面。", 0 bytes, 0-byte Bin |
| No image | none loaded | Preview | status "请先打开图像", no bytes |
