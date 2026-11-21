# StegSolve · Frame selection

> UI path: **File steganography** → `StegSolve` → **Frame browser** tab. Family: collection tools · frame browser.

## L1 Quick reference

**What it is**: Locate, inspect and save a **single frame** of a multi-frame image (APNG / GIF). It changes which frame you are looking at and which frame gets saved — it does **not** narrow the batch export, which always exports every frame (see *StegSolve · All-frame export*).

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| Previous / Next frame | buttons | — | Index ∓1, wrapping at both ends (previous on frame 1 jumps to the last frame) |
| Frame counter | text | `- / -` | e.g. `3 / 4 · 4×3`: 1-based frame number / total · canvas size |
| Save current frame | button | — | Writes the whole frame as PNG; name = original file name **including its extension** + `_frame<N>` + `.png` |

**Minimal example**:

```
Input:  anim4.png (APNG, 4 frames, 4×3)
Do:     Frame browser → click Next twice
Label:  3 / 4 · 4×3
Save →  anim4.png_frame3.png (4×3, RGBA 8-bit)
```

## L2 Details

**Walkthrough**:
1. Open a multi-frame image and switch to **Frame browser**; the meta line shows something like `APNG · 4×3 · 4 frames`.
2. Move with Previous / Next; the counter updates to `current / total · width×height`.
3. Use **Save current frame** to get a single PNG.
4. To decide whether a frame carries a payload, note its index and compare it with the **Frames** tab of the frame/channel overview.

**How it works**: every frame is retained as a **fully composited canvas** (GIF disposal and APNG dispose/blend are already applied), so saving frame N yields exactly what the viewer shows, not the small update rectangle stored in the file. Indices are 0-based internally and 1-based in the UI, and navigation wraps modulo the frame count.

**Measured evidence** (4-frame, 4×3 fixture):
- Next ×2 gives `1 / 4` → `2 / 4` → `3 / 4`; Previous ×3 from there gives `4 / 4` (wrap), then Next returns to `1 / 4`.
- The saved file for frame 3 matches the hand-written RGBA of frame 3 pixel for pixel; frame 4 likewise.
- A single-frame PNG also opens here and shows `1 / 1 · 4×3`.

**Common pitfalls**:
1. **The original extension survives**: saving frame 3 of `anim4.png` produces `anim4.png_frame3.png`, not `anim4_frame3.png`. Match files as `<original>_frame<N>.png`.
2. **Arrow keys drive the transform view, not frames**: the panel hint says “←/→ switch frames”, but pressing → only moved the main view from `1 / 42` to `2 / 42` while the frame counter stayed at `1 / 4`. Use the buttons to change frames (recorded as a defect candidate; this text follows observed behaviour).
3. **Zero-frame containers fail to load**: a GIF with only a header, logical screen descriptor and trailer reports “open failed: GIF contains no decodable frame”, and the overview/export buttons stay disabled. The title and meta line still show the *previous* image, so do not use them as proof that this load succeeded.
4. **Frame count picks the default overview tab**: more than one frame defaults to **Frames**; a single-frame image defaults to **Channel transforms**, while the `Frames (1)` tab still exists.
5. **Selection does not narrow the export**: the batch export iterates every frame, so exporting with frame 3 selected and with frame 2 selected produces byte-identical frame entries. To export exactly one frame, use **Save current frame**.

## More examples

| Action | Input | Parameters | Result |
|---|---|---|---|
| Save a middle frame | 4-frame APNG (4×3) | Next ×2 | `3 / 4 · 4×3` → `anim4.png_frame3.png` (113 B) |
| Wrap backwards | same, at `1 / 4` | Previous ×1 | Label becomes `4 / 4 · 4×3` |
| Single frame | `single.png` | open Frame browser | `1 / 1 · 4×3` → `single.png_frame1.png` |
| Zero frames | GIF with no image descriptor | open | “open failed: GIF contains no decodable frame”, buttons disabled |
