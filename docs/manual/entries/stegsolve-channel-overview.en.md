# StegSolve · First-frame channel overview

> UI path: `StegSolve` toolbar → **Frame / channel overview** → **Channel transforms** tab. Family: collection tools · overview.

## L1 Quick reference

**What it is**: A thumbnail wall of all 42 channel / bit-plane transforms, used to spot “which transform looks suspicious”. **All 42 are computed from the first frame**, independent of the currently selected frame, and the wall itself **produces no files**.

**Parameters**:

| Parameter | Type | Default | Notes |
|---|---|---|---|
| `Frames (N)` tab | tab | default when N > 1 | Every composited frame, each cell labelled `Frame i` and `width×height` |
| `Channel transforms (42)` tab | tab | default when N = 1 | 42 thumbnails; the status line states they are based on the first frame |
| Thumbnail | image | — | Fitted into a 168×120 box with nearest-neighbour scaling (a 4×3 image becomes 160×120) |
| Click a cell | button | — | Jumps back to the main view at that frame / transform |
| Zoom (top-right of a cell) | button | — | Opens the image viewer at original size |
| `Export all as ZIP` | button | — | Calls the same function as the toolbar batch export; see *StegSolve · All-frame export* |

**Minimal example**:

```
Input:  anim4.png (APNG, 4 frames, 4×3)
Do:     select frame 3 in Frame browser → open the overview → Channel transforms (42)
See:    status "42 channel transforms (first frame only)"; first cell "Original" 160×120
Check:  that thumbnail matches frame 1, not the selected frame 3
```

## L2 Details

**Walkthrough**:
1. Open the overview from the toolbar; the dialog has two tabs, `Frames (N)` and `Channel transforms (42)`.
2. With more than one frame it opens on **Frames**; a single-frame image opens on **Channel transforms**.
3. Scroll the channel wall — cells render lazily as they enter the viewport, so large images do not freeze the dialog.
4. Clicking a cell returns to the main view at that position; **Zoom** opens the viewer at full size.
5. If you need files, use **Export all as ZIP** — that is the whole package of all frames plus 42 channels, not a “first-frame only” bundle.

**Order of the 42 transforms** (identical to the main view's left/right order): original, colour inversion (XOR), Alpha bit planes 7→0, Red 7→0, Green 7→0, Blue 7→0, full Alpha / Red / Green / Blue, random colour maps 1/2/3, gray-bits (R=G=B).

**Why the first frame**: the item getter is “frame → current frame; transform → apply to the first frame”. The first frame is fixed at load time, so channel results stay stable; changing frames only affects the **Frames** tab and the main view. This is the easiest thing to misread: **spot an anomaly on frame 3, open the channel overview, and you are looking at frame 1's channels.**

**Measured evidence** (4-frame 4×3 fixture, overview opened while frame 3 was selected):
- Tab labels `Frames (4)` / `Channel transforms (42)`; 4 frame cells and 42 channel cells; status lines `4 frames total` and `42 channel transforms (first frame only)`.
- The first channel cell (Original) is 160×120: every opaque sample matches **frame 1** (0 mismatches) and differs from the selected **frame 3** at 5 samples.
- The third frame cell matches frame 3 under nearest-neighbour scaling, pixel for pixel.

**Common pitfalls**:
1. **The overview does not download anything**: the 42 thumbnails live only in canvases; there is no “save this thumbnail”. Files come from the batch export, and that is a whole package.
2. **Thumbnails are not evidence**: the long edge is squeezed into 168×120, so a one-pixel payload inside a bit plane is averaged away. Use the wall to narrow candidates, then zoom or export before concluding.
3. **Random colour maps are not reproducible**: maps 1/2/3 use random parameters per render, so two openings can look different. Do not compare screenshots as transform output.
4. **Single-frame images do not open on the frame tab**: `Frames (1)` exists but is not in front.
5. **Lazy rendering**: scroll fast and some cells may still be blank canvases; give it a frame before judging.

## More examples

| Action | Input | Parameters | Observation |
|---|---|---|---|
| Channel wall | 4-frame APNG (4×3) | open with frame 3 selected | 42 cells, status “42 channel transforms (first frame only)” |
| First cell check | same | zoom the **Original** cell | Matches frame 1, not frame 3 |
| Frame wall | same | **Frames** tab | 4 cells; the third matches frame 3 |
| Single frame | `single.png` | open overview | Defaults to `Channel transforms (42)`; frame tab reads `Frames (1)` |
