# StegSolve · All-frame export

> UI path: `StegSolve` toolbar → **Batch export frames / channels**, or **Export all as ZIP** inside the overview. Family: collection tools · export.

## L1 Quick reference

**What it is**: Packs **every animation frame**, the **first frame's 42 channel transforms** and a `manifest.txt` into one ZIP download. The product is a **single zip**, named `<source name without extension>_stegsolve_frames_channels.zip`, MIME `application/zip`.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Entry A: toolbar **Batch export frames / channels** | button | — | Disabled until an image is loaded |
| Entry B: overview **Export all as ZIP** | button | — | Same function, same naming as entry A |
| Export scope | fixed | all frames | Independent of the selected frame; always the full set |
| Size ceiling | constant | 256 MiB | Exceeding it aborts; nothing is downloaded (no partial zip) |
| Re-entry guard | fixed | single flight | Repeat clicks while exporting are ignored |

**ZIP layout** (a 4-frame image gives 47 entries):

| Order | Entry | Notes |
|---|---|---|
| 1..N | `frames/frame_001.png`, `frames/frame_002.png`, … | Frames 1..N, full canvas, RGBA 8-bit, 3-digit index |
| N+1..N+42 | `channels/01_原图.png` … `channels/42_灰度位_(R=G=B).png` | First frame's 42 transforms, 2-digit index, spaces/symbols in labels replaced by underscores |
| last | `manifest.txt` | Source / format / size / frames / channels / timestamp + 46 file lines |

**Minimal example**:

```
Input: anim4.png (APNG, 4 frames, 4×3)
Do:    click Batch export frames / channels
Product: anim4_stegsolve_frames_channels.zip (12520 B, 47 entries)
First: frames/frame_001.png ; Last: manifest.txt
```

## L2 Details

**Walkthrough**:
1. Load an image (a single-frame PNG also works and yields 1 frame + 42 channels).
2. Click **Batch export frames / channels**, or open the overview and click **Export all as ZIP**.
3. The status line counts up (`exporting i/47…`) and ends with `exported 4 frames + 42 channels (12 KiB)`.
4. When verifying: count the entries (N + 42 + 1), check the order and names above, then spot-check pixels.

**How it works**: each frame is encoded to PNG in turn (real deflate via `CompressionStream` when the browser has it, stored blocks otherwise), then written into a STORE-mode zip in the order frames → channels → manifest. The UTF-8 flag is set for non-ASCII names, and the writer refuses rather than emitting ZIP64 when the 65535-entry or 32-bit length limits would be exceeded. Channels always come from the first frame, so a multi-frame image gets exactly one channel set.

**Measured evidence** (4-frame 4×3 fixture):
- Both entries produced `anim4_stegsolve_frames_channels.zip` as the suggested file name, with product Blob MIME `application/zip`.
- 47 entries in exactly the order above; the four `frames/*.png` match the fixture frames pixel for pixel.
- `channels/01_原图.png` equals frame 1; `channels/02_颜色反转_(XOR).png` equals RGB inverted with alpha 255; `channels/36_完整_Red.png` equals `(R,0,0,255)`.
- All 42 channel entries decode independently as 4×3 RGBA (color type 6).
- `manifest.txt` lists 46 files and states `source: anim4.png`, `format: APNG`, `size: 4×3`, `frames: 4`, `channel transforms: 42 (first frame only)`.
- Exporting with frame 3 selected and again with frame 2 selected produced **byte-identical** `frames/*.png`; the packages differ only in the manifest timestamp.

**Common pitfalls**:
1. **It does not export “the selected frame”**: the selection is irrelevant to the range. Use **Save current frame** for a single frame.
2. **Two naming conventions**: the zip **strips** the extension (`anim4.png` → `anim4_stegsolve_...zip`), while single-frame saving **keeps** it (`anim4.png_frame3.png`). Do not apply one rule to both in scripts.
3. **Channel names are sanitised**: spaces and `\ / : * ? " < > |` become `_`, leading/trailing underscores are trimmed — hence `颜色反转_(XOR).png` and `完整_Alpha.png` rather than the raw labels.
4. **Two exports are never byte-identical**: the manifest carries a timestamp. Compare frames and channel entries, not whole-file hashes.
5. **A single-frame image yields 44 entries, not 47**: 1 frame + 42 channels + manifest.
6. **The ceiling aborts, it does not truncate**: exceeding 256 MiB raises an error and nothing is downloaded; reduce frames or use single-frame saving.
7. **Channels always describe the first frame**: a multi-frame image does not give you “the 42 channels of frame 2”.

## More examples

| Action | Input | Parameters | Product |
|---|---|---|---|
| Multi-frame export | 4-frame APNG (4×3) | defaults | 47 entries / 12520 B |
| Re-export on another frame | same, select frame 2 | defaults | 47 entries; `frames/*` byte-identical to the previous run |
| Single-frame export | `single.png` | defaults | 44 entries (1 + 42 + 1) |
| Nothing loaded | — | click the button | Button disabled, no download |
