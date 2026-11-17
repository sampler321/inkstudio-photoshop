# Photoshop brush and painting-tool settings: pen-response reference

Scope: Photoshop 2024-2026 (verified against Photoshop 27.7.0, "Photoshop 2026", on macOS arm64, 2026-11-17).
Purpose: know every place a pen input (pressure, tilt, rotation/barrel, stylus wheel, stroke direction, fade, speed) can change a stroke, and the batchPlay key that holds it.

## How to read this

**Evidence tags** on every row:

- **[A]** Adobe help text (URL in the section header).
- **[P]** Probed in Photoshop 27.7 by ExtendScript in this session (`executeAction` set `currentToolOptions`, then Stroke Path with or without "Simulate Pressure"). Images in `docs/img/`.
- **[B]** Read from the Photoshop 27.7 binary: UI string table (`$$$/...` ZStrings) or menu order.
- **[F]** Seen in real `.abr` files: 67 packs in `~/inkdraw/brushpacks/library`, including Adobe's own `Default Brushes.abr` (Kyle T. Webster) and `Legacy Brushes.abr`, parsed with `tools/abrdesc.py`.
- **[3P]** Third-party ABR readers: ag-psd `src/abr.ts` (github.com/Agamnentzar/ag-psd), which maps the same descriptor keys.
- **[G]** Guess or memory of the UI, not confirmed. Treat as a hypothesis.

**Key spelling.** batchPlay returns keys with a known stringID as plain names (`minimumDiameter`), and keys that only have a 4-char code with a `$` prefix (`$szVr`). ExtendScript/ABR show the 4-char code (`szVr`, `Wtdg`). Where the batchPlay name has not been seen, the ABR code is given and the batchPlay spelling is marked [G].

**Adobe sources.** Adobe moved the Photoshop manual in 2025-2026 from `helpx.adobe.com/photoshop/using/*.html` to `helpx.adobe.com/photoshop/desktop/...`. The old URLs now 404 or redirect to thinner pages. The detailed old pages were read from the Internet Archive. The page names in the request ("Brush Settings panel", "Bristle tips", "Brush pose", ...) do not exist as separate pages; their content lives on the pages below.

| Id | Page | URL |
|---|---|---|
| A1 | Add brush dynamics (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/brush-dynamics-settings.html |
| A2 | Textured and dual brush settings (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/textured-and-dual-brush-settings.html |
| A3 | Paint with the Brush or Pencil tool (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/paint-with-brush-or-pencil-tool.html |
| A4 | Paint with the Mixer Brush (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/create-fill-with-patterns/paint-with-mixer-brush.html |
| A5 | Smudge image areas (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/fill-objects-selections-layers/smudge-image-areas.html |
| A6 | Stroke smoothing (2026) | https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/create-smoother-more-polished-brush-strokes-with-stroke-smoothing.html |
| A7 | Eraser tool (2026) | https://helpx.adobe.com/photoshop/desktop/repair-retouch/clean-restore-images/erase-parts-of-an-image-with-the-eraser-tool.html |
| A8 | Create tool presets (2026) | https://helpx.adobe.com/photoshop/desktop/get-started/set-up-toolbars-panels/create-tool-preset.html |
| A9 | Display the Brush Settings panel (2026) | https://helpx.adobe.com/photoshop/desktop/apply-painting-techniques/brushes-presets/display-brush-panel-brush-options.html |
| O1 | Create and modify brushes (tip shapes, bristle, erodible, airbrush, brush pose, other options, scattering, smoothing) | https://helpx.adobe.com/photoshop/using/creating-modifying-brushes.html (archived: https://web.archive.org/web/20251027052040/https://helpx.adobe.com/photoshop/using/creating-modifying-brushes.html) |
| O2 | Add dynamic elements to brushes (shape, color, transfer) | https://web.archive.org/web/20260415203604/https://helpx.adobe.com/photoshop/using/adding-dynamic-elements-brushes.html |
| O3 | Painting tools (options bar, tablet pressure buttons) | https://web.archive.org/web/20260921215646/https://helpx.adobe.com/photoshop/using/painting-tools.html |
| O4 | Paint with the Mixer Brush (old) | https://web.archive.org/web/20260910032748/https://helpx.adobe.com/photoshop/using/painting-mixer-brush.html |
| O5 | Erase parts of an image (old: eraser, background eraser) | https://web.archive.org/web/20251015035808/https://helpx.adobe.com/photoshop/using/erasing-parts-image.html |
| O6 | Draw or paint with a graphics tablet | https://web.archive.org/web/20260317004611/https://helpx.adobe.com/photoshop/using/drawing-painting-graphics-tablet.html |
| O7 | Brush presets | https://web.archive.org/web/20250809100632/https://helpx.adobe.com/photoshop/using/brush-presets.html |

Adobe publishes no scripting reference for these descriptor keys. The Photoshop JavaScript/UXP references document `batchPlay` and `executeAction` only generically; key names below come from batchPlay/ExtendScript reads [P], ABR files [F] and ag-psd [3P].

---

## 1. The dynamics object (`$brVr`) and control types

Every jitter/control pair is one object:

```json
{ "_obj": "$brVr", "$bVTy": 2, "$fStp": 25,
  "jitter":  { "_unit": "percentUnit", "_value": 0 },
  "minimum": { "_unit": "percentUnit", "_value": 0 } }
```

| Field | Meaning | Range | Ev. |
|---|---|---|---|
| `$bVTy` | Control (what drives the value) | integer, see table | [P][F][3P] |
| `$fStp` | Fade steps, used when control = Fade. One step = one dab | 1-9999 | [A O2][P] |
| `jitter` | Random variation per dab, as % of the setting's full range. 0% = none, 100% = max randomness. For angle: % of 360 deg | 0-100% (Scatter: 0-1000%) | [A A1] |
| `minimum` | Floor for the controlled value (Transfer: opacity/flow/wet/mix "Minimum" slider). For size the floor that counts is the separate `minimumDiameter` key; probe set `minimum` 0 and `minimumDiameter` 60 and the 60% floor applied | 0-100% | [P][G for Transfer UI label] |

Jitter and control combine: control sets the value between the setting and its minimum; jitter adds randomness on top. [A A1]

### `$bVTy` values (CORRECTED)

| Value | Control | Evidence |
|---|---|---|
| 0 | Off | [P][F] |
| 1 | Fade (over `$fStp` dabs) | [P]: angle swept 0 to 360 deg over 25 dabs (`img/probe-angle-control-2.png`, first column) |
| 2 | Pen Pressure | [F] (183 of 204 size controls), [3P], plugin observation |
| 3 | Pen Tilt | [F] (Kyle's "Spatter Bot Tilt" uses it for size and angle), [3P] |
| 4 | Stylus Wheel (airbrush pen thumbwheel) | [3P]; not probed (needs that pen) |
| 5 | **Initial Direction** | [P]: dabs kept the 45 deg angle of the first segment after the path turned vertical (`img/probe-angle-control.png`, column 3) |
| 6 | **Direction** | [P]: dabs turned with the path (column 4). [F]: Adobe's "rough comb w/ direction" and Kyle's Real Oils use 6 |
| 7 | "Initial Rotation" per [3P]; no such item in the UI menu. Behaves like Off without a pen [P] | unconfirmed |
| 8 | **Rotation** (barrel rotation, Wacom Art Pen) per [3P] | behaves like Off without a pen [P]; needs a rotation pen to confirm 7 vs 8 |
| 9, 10 | Accepted and read back unchanged by Photoshop, no visible effect [P]. Photoshop does not validate this field | - |

The earlier assumption "5 rotation, 6 initial direction, 7 direction" comes from the UI menu order, which the binary confirms is Off, Fade, Pen Pressure, Pen Tilt, Stylus Wheel, Rotation, Initial Direction, Direction [B]. **The stored value is not the menu index.** Fix `plugin/main.js` line 431 (`CONTROL`) and `tools/abrdesc.py` line 81: 5 = initial direction, 6 = direction, 8 = rotation (7 unknown, probably initial rotation).

Which controls each menu offers [A A1, O2]:
- Size, Opacity, Flow: Off, Fade, Pen Pressure, Pen Tilt, Stylus Wheel (Adobe text omits Rotation; [G] the UI may list it).
- Angle: all incl. Rotation, Initial Direction, Direction.
- Roundness, Scatter, Count, Texture Depth, Foreground/Background: Off, Fade, Pen Pressure, Pen Tilt, Stylus Wheel, Rotation.

Fade semantics differ per setting [A A1, A2, O2]: size fades from diameter to Minimum Diameter; angle 0 to 360 deg; roundness 100% to Minimum Roundness; opacity and flow from the options-bar value **to 0**; scatter from max to none; count from Count to 1; texture depth from Depth Jitter % to Minimum Depth; F/B from foreground to background.

Without a capable pen a warning icon appears: "Control by pen pressure requires the use of a pressure sensitive tablet", likewise tilt, thumbwheel, rotation [B][A A1].

The UI string table also contains `$$$/BrushDynamics/Speed=Speed` [B]. No menu shows it; it may be a dormant control value. Unconfirmed.

**Section enable switches.** Each Brush Settings group has a checkbox. Unchecked, its dynamics are ignored even if a control is set [P: Transfer opacity on pressure with `usePaintDynamics:false` gave no fade, `img/probe-pressure-overrides.png` row H].

| Group | Enable key |
|---|---|
| Shape Dynamics | `useTipDynamics` |
| Scattering | `useScatter` |
| Texture | `useTexture` |
| Dual Brush | `dualBrush.useDualBrush` |
| Color Dynamics | `useColorDynamics` |
| Transfer | `usePaintDynamics` |
| Brush Pose | `useBrushPose` |
| Noise / Wet Edges / Build-up / Smoothing / Protect Texture | the setting itself is the boolean |

---

## 2. Brush Tip Shape

Source: O1 (archived "Create and modify brushes"), O7. Tip object = `brush` in `currentToolOptions`, `_obj` gives the tip type.

| `brush._obj` | Tip type | Ev. |
|---|---|---|
| `computedBrush` | Round/elliptical, procedurally drawn | [P][F] |
| `sampledBrush` | Image tip (from Define Brush Preset; up to 2500x2500 px, converted to grayscale) | [A O1][F] |
| `dBrush` | Bristle tip ("Live Tip") | [P][F] |
| `dTips` | Erodible tip (`dtipsType:0`) or Airbrush tip (`dtipsType:1`) | [P][F][3P] |

### 2.1 Standard tips (computed and sampled)

| UI | Key (batchPlay / ABR) | Range | Effect on stroke | Pen-drivable? | Ev. |
|---|---|---|---|---|---|
| Size | `diameter` / `Dmtr` | 1-5000 px | Dab diameter | Via Shape Dynamics size, the toolbar size button, Brush Pose pressure | [A O1][B 5000 limit] |
| Use Sample Size | (action) | - | Resets sampled tip to its original size | No | [A O1] |
| Flip X / Flip Y | `brush.flipX`, `brush.flipY` | bool | Mirrors the tip | No (random flip is in Shape Dynamics) | [A O1] |
| Angle | `angle` / `Angl` | -180..180 deg | Rotation of the tip's long axis | Via Angle control, Brush Projection, Brush Pose | [A O1] |
| Roundness | `roundness` / `Rndn` | 0-100% | Short/long axis ratio | Via Roundness control, Brush Projection | [A O1] |
| Hardness | `hardness` / `Hrdn` (computed only) | 0-100% | Size of the hard core; soft edge = partial opacity at the rim. Not for sampled tips | No pen control. Shift+[ / ] in UI | [A O1, O7] |
| Spacing | `spacing` / `Spcn`; on/off = `Intr` [3P] | 1-1000% of diameter | Distance between dabs. **Off: cursor speed decides spacing** (fast strokes break up) | Speed only, when off | [A O1] |

Interplay: Brush Preset picker "Diameter" scales both primary and dual tip [A O7]. The Pencil tool always paints aliased hard edges regardless of hardness [A O7].

### 2.2 Bristle tips (`dBrush`): hidden pressure and tilt response

Source: O1 "Bristle tip shape options".

| UI | Key (batchPlay / ABR) | Range | Effect | Ev. |
|---|---|---|---|---|
| Shape | `shape` / `Shp ` (int) | 0-9: Round Point, Round Blunt, Round Curve, Round Angle, Round Fan, Flat Point, Flat Blunt, Flat Curve, Flat Angle, Flat Fan | Overall arrangement of bristles | [A O1][B names][3P order] |
| Bristles | `density` / `Dnst` | 1-100% (stored 0-1) | Bristle density | [A O1][F] |
| Length | `length` / `Lngt` | 25-500% (stored 0.25-5) | Bristle length | [A O1][F] |
| Thickness | `thickness` | 1-200% (stored 0.01-2) | Width of each bristle | [A O1][F] |
| Stiffness | `stiffness` | 1-100% (stored 0-1) | Flexibility. Low = tip deforms easily. Adobe: adjust to vary strokes "when using a mouse" | [A O1][F] |
| Angle | `angle` | deg | Tip angle when painting with a mouse | [A O1] |
| Spacing | `spacing` | % | As standard tips | [A O1] |
| (not in UI) Clumping | `clumping` | stored 0-1 | Bristles grouping. Not exposed in the panel | [F][3P][G] |
| (not in UI) Physics | `physics` | bool | Bristle simulation on | [F][3P][G] |
| Brush preview | (UI) | - | Live 3D preview of the tip showing current pressure and stroke angle. Click to rotate the view | [A O1] |

**Hidden pen response [P]** (`img/probe-live-tips.png` rows 1-2, all Shape Dynamics and Transfer off): a bristle tip changes width, splay and coverage with pressure on its own. Simulated pressure produced a stroke that tapers at both ends and splays wide in the middle; no pressure (equivalent to a mouse, full contact) produced a full-width, smeared stroke with stray bristles. Tilt deflects the tip like a real brush (deflection is shown in the preview; [G] not probed, needs a tilt pen). Stroke direction bends the bristles (lag). None of this appears under Shape Dynamics or Transfer.

Live Tip restrictions: "Symmetry painting and Pattern Preview are not supported with Live Tip brushes" [B]. Live Tips are bristle, erodible and airbrush tips.

### 2.3 Erodible tips (`dTips`, `dtipsType:0`): wear

Source: O1 "Erodible tip options". "behave similar to pencils and crayons, and wear down naturally as you draw" [A O1].

| UI | Key | Range | Effect | Ev. |
|---|---|---|---|---|
| Size | `diameter` / `Dmtr` | px | Size | [A O1] |
| Softness | `dtipsHardness` [G: the UI "Softness" maps to this key, possibly inverted] | % | Rate of wear | [A O1][F] |
| Shape | `shape` / `Shp ` | 0 Point, 1 Flat, 2 Round, 3 Square, 4 Triangle, 5 Custom | Tip shape | [B names][3P order][F Square Charcoal = 3] |
| Sharpen Tip | (button; also a keyboard-shortcut command "Sharpen Erodible Tips") | - | Restores the tip to its original sharpness | [A O1][B] |
| Spacing | `spacing` | % | As standard | [A O1] |
| Live Brush Tip Preview | (UI, upper left of canvas) | - | Shows current wear | [A O1] |
| (not in UI) | `dtipsLengthRatio`, `dtipsGridSize`, `dtipsErodibleTipHeightMap` (raw data) | - | Tip geometry and the stored worn height map | [F][3P] |

**Hidden pen response [P]** (`img/probe-live-tips.png` rows 3-4): with all dynamics off, the erodible point drew a thin line whose width followed simulated pressure (harder = more of the tip in contact = wider). Without pressure the line got progressively wider along the stroke as the point wore flat. The worn state is stored in the tip (`dtipsErodibleTipHeightMap`) and, per Adobe, persists until Sharpen Tip [A O1]; whether wear persists across strokes was not probed [G: it does]. Tilt changes which side of the tip touches [G].

### 2.4 Airbrush tips (`dTips`, `dtipsType:1`)

Source: O1 "Airbrush tip options". "Use a stylus to alter the spread of sprayed strokes by changing pen pressure" [A O1].

| UI | Key [mapping G unless noted] | Effect | Ev. |
|---|---|---|---|
| Size | `diameter` | Spray size | [A O1] |
| Hardness | `dtipsHardness` | Hard core size | [A O1][F] |
| Distortion | `dtipsAirbrushCutoffAngle` or `dtipsAirbrushStreakiness` [G] | Distortion of the spray | [A O1] |
| Granularity | `dtipsAirbrushGranularity` | Grain of the droplets | [A O1][F] |
| Spatter Size | `dtipsAirbrushSplatSize` | Droplet size | [A O1][F] |
| Spatter Amount | `dtipsAirbrushSplatCount` | Number of droplets | [A O1][F] |
| Spacing | `spacing` | Droplet spacing; off = by cursor speed | [A O1] |

**Hidden pen response [P]** (`img/probe-live-tips.png` rows 5-6): with all dynamics off, pressure changes the spray cone. Low pressure gave the widest spray and high pressure the narrowest (the probe stroke is wide at both ends and pinched in the middle). Without pressure (mouse) it drew a thin line. This is the inverse of a normal pressure-size brush. Tilt makes the cone elliptical like a real spray can [G, not probed].

---

## 3. Shape Dynamics

Source: A1, O2.

| UI | Key | Range | Effect | Pen inputs | Ev. |
|---|---|---|---|---|---|
| Size Jitter + Control | `$szVr` | jitter 0-100% | Dab size between diameter and Minimum Diameter | Fade, Pressure, Tilt, Stylus Wheel | [A A1] |
| Minimum Diameter | `minimumDiameter` | 0-100% of diameter | Floor for size jitter and size control. Also the floor for the toolbar size-pressure button [P] | - | [A A1][P] |
| Tilt Scale | `tiltScale` | 0-200% | Scale applied to the brush **height** before rotation when Size control = Pen Tilt | Tilt | [A A1] |
| Angle Jitter + Control | `angleDynamics` | jitter % of 360 deg | Dab angle | Fade, Pressure, Tilt, Wheel, Rotation, Initial Direction, Direction | [A A1][P] |
| Roundness Jitter + Control | `roundnessDynamics` | jitter % | Roundness between 100% and Minimum Roundness | Fade, Pressure, Tilt, Wheel, Rotation | [A A1] |
| Minimum Roundness | `minimumRoundness` | 0-100% | Floor for roundness jitter/control | - | [A A1] |
| Flip X Jitter / Flip Y Jitter | top-level `flipX`, `flipY` (distinct from `brush.flipX`) | bool | Random mirror per dab | none | [F][3P][G label] |
| Brush Projection | `brushProjection` | bool | "When enabled, tilt and rotation changes alter the tip shape as you paint with a stylus" | Tilt, Rotation | [A A1] |

Notes:
- Direction-type controls only exist for angle. Kyle's oils and blenders use Direction (6) so the bristles follow the stroke [F].
- Brush Projection is the realistic mode: tilt foreshortens the tip into an ellipse and rotation spins it, without any Angle/Roundness control set [A A1]. Not probed (needs a tilt pen).

---

## 4. Scattering

Source: O1 "Brush scattering".

| UI | Key | Range | Effect | Pen inputs | Ev. |
|---|---|---|---|---|---|
| Scatter + Control | `scatterDynamics` (`jitter` = scatter amount) | 0-1000% | Distance dabs are thrown from the path | Fade, Pressure, Tilt, Wheel, Rotation | [A O1][3P] |
| Both Axes | `bothAxes` | bool | On: radial scatter. Off: perpendicular to the stroke only | - | [A O1] |
| Count | `count` / `Cnt ` | 1-16 | Dabs per spacing interval. More dabs = denser, darker strokes | - | [A O1] |
| Count Jitter + Control | `countDynamics` | % | Variation of count; Fade goes from Count to 1 | Fade, Pressure, Tilt, Wheel, Rotation | [A O1] |

Hidden: pressure on Count makes a stroke denser and therefore darker with harder pressure, with no Transfer setting involved [A O1 behaviour; F: 6 presets use count on pressure].

---

## 5. Texture

Source: A2.

| UI | Key | Range | Effect | Pen inputs | Ev. |
|---|---|---|---|---|---|
| Pattern | `texture` {`name`,`ID`} | - | Pattern used as paper | - | [A A2][P] |
| Invert | `invertTexture` / `InvT` | bool | Swap high and low points | - | [A A2] |
| Scale | `textureScale` | 1-1000% | Pattern size | - | [A A2] |
| Brightness | `textureBrightness` | -150..150 [G range] | Pattern brightness | - | [P key][G] |
| Contrast | `textureContrast` | -50..100 [G range] | Pattern contrast | - | [P key][G] |
| Texture Each Tip | `TxtC` in ABR; batchPlay spelling probably `$TxtC` or a stringID [G] | bool | Texture applied per dab, not to the stroke as a whole. **Required for depth dynamics** | - | [A A2][F][3P] |
| Mode | `textureBlendMode` | Multiply, Subtract, Darken, Overlay, Color Dodge, Color Burn, Linear Burn, Hard Mix, Linear Height, Height [G list; Height/Linear Height strings exist B] | How pattern and paint combine | - | [A A2] |
| Depth | `textureDepth` | 0-100% | How deep paint goes into the pattern. 100% = low points get no paint; 0% = pattern hidden | - | [A A2] |
| Minimum Depth | `minimumDepth` | 0-100% | Floor for depth control (only with Texture Each Tip) | - | [A A2] |
| Depth Jitter + Control | `textureDepthDynamics` | % | Varies depth per dab | Fade, Pressure, Tilt, Wheel, Rotation | [A A2] |

Hidden darkness: Texture Depth on pressure is the natural-media "press harder and the grain fills in" response. It darkens and fills the stroke with pressure without any Transfer setting [A A2][F: 12 presets]. Without Texture Each Tip, depth is fixed and the pattern behaves like paper under the whole stroke [A A2].

Panel menu "Copy Texture to Other Tools" copies pattern and scale to Brush, Pencil, Clone Stamp, Pattern Stamp, History Brush, Art History Brush, Eraser, Dodge, Burn, Sponge [A A2][B].

---

## 6. Dual Brush

Source: A2. Object `dualBrush` (ABR keys from [3P]; batchPlay sub-key names [G]).

| UI | Key (ABR) | Range | Effect | Pen inputs | Ev. |
|---|---|---|---|---|---|
| on/off | `useDualBrush` | bool | Second tip; paint appears only where both tips overlap | - | [A A2][P key] |
| Tip | `Brsh` (a tip object) | - | Second tip | - | [A A2][3P] |
| Mode | `BlnM` | blend modes | How primary and dual marks combine | - | [A A2] |
| Flip | `Flip` | bool | Mirror dual tip | - | [3P] |
| Diameter / Use Sample Size | tip `Dmtr` | px | Dual tip size | - | [A A2] |
| Spacing | `Spcn` | % | Dual dab spacing | - | [A A2] |
| Scatter + Both Axes | `scatterDynamics`, `bothAxes`, `useScatter` | % | Dual dab scatter | Fade, Pressure, Tilt, Wheel, Rotation [3P structure; G UI] | [A A2] |
| Count | `Cnt `, `countDynamics` | int | Dual dabs per interval | as above [G] | [A A2] |

Interplay: the dual tip cuts holes into the primary stroke, so it lowers coverage (reads as lighter, broken strokes). Scaling the brush scales both tips [A O7]. Whether Shape Dynamics size also scales the dual tip per dab: not confirmed [G: it does not; only the preset diameter scales it]. In the 67 packs, dual scatter/count controls are always Off [F].

---

## 7. Color Dynamics

Source: A1, O2.

| UI | Key (ABR / batchPlay [G]) | Range | Effect | Pen inputs | Ev. |
|---|---|---|---|---|---|
| Apply Per Tip | `colorDynamicsPerTip` | bool | On: color changes every dab. Off: once per stroke | - | [A A1][F] |
| Foreground/Background Jitter + Control | `clVr` (`$clVr`) | % | Color between foreground and background | Fade, Pressure, Tilt, Wheel, Rotation | [A A1][F] |
| Hue Jitter | `H   ` (`hue` [G]) | 0-100% | Hue variation | none (random only) | [A A1][F] |
| Saturation Jitter | `Strt` | 0-100% | Saturation variation | none | [A A1][F] |
| Brightness Jitter | `Brgh` | 0-100% | Brightness variation | none | [A A1][F] |
| Purity | `purity` | -100..100% | Desaturate/saturate the color | none | [A A1][F] |

Hidden darkness: F/B on Pen Pressure with a white background color makes light pressure paint a lighter color, which on white paper looks exactly like an opacity curve [F: 3 Kyle presets]. Brightness Jitter per tip looks like random opacity speckle. Neither shows under Transfer. Note the color dynamics are random or F/B only; hue/saturation/brightness have no pen control.

---

## 8. Transfer

Source: A1, O2; tool-specific labels from [B].

| UI | Key | Effect | Pen inputs | Ev. |
|---|---|---|---|---|
| Opacity Jitter + Control (+ Minimum) | `$opVr` | Opacity per dab, up to but never above the options-bar Opacity. Fade goes from that opacity to 0 | Fade, Pressure, Tilt, Wheel | [A A1] |
| Flow Jitter + Control (+ Minimum) | `$prVr` | Flow per dab, up to the options-bar Flow | Fade, Pressure, Tilt, Wheel | [A A1] |
| Wetness Jitter + Control (Mixer Brush) | `$wtVr` | Wet per dab | as above [G list] | [F][3P][G UI] |
| Mix Jitter + Control (Mixer Brush) | `$mxVr` | Mix per dab | as above [G list] | [F][3P][G UI] |
| Strength Jitter (Smudge) | probably `$prVr` [G] | Smudge strength per dab | as above | [B label][F: smudge presets carry `prVr` on pressure] |
| Exposure Jitter (Dodge/Burn) | probably `$prVr` [G] | Exposure per dab | as above | [B label] |

The "Minimum" slider under each Transfer control is the `minimum` field of the `$brVr` [G: UI label from memory; key confirmed].

Opacity vs flow [A A3, O3]: within one stroke, paint never exceeds Opacity no matter how often you go over the same place; a new stroke adds another layer of that opacity. Flow is the per-dab rate; dabs build up within a stroke until they reach Opacity. Example: opacity 33% and flow 33% moves each pass 33% toward the color and stops at 33% for that stroke. So with low flow, overlap (small spacing, slow strokes, scatter count, build-up) raises darkness inside the stroke, and pressure on flow behaves like a soft, buildable pressure-opacity.

---

## 9. Brush Pose: overrides real pen input

Source: O1 "Brush pose options". Keys from [F][3P]; the plugin read only showed `useBrushPose` because it was off.

| UI | Key | Range | Effect | Ev. |
|---|---|---|---|---|
| Brush Pose on/off | `useBrushPose` | bool | | [A O1][P] |
| Tilt X + Override | `brushPoseTiltX`, `overridePoseTiltX` | -100..100% [3P, F] | Left-right tilt of the brush | [A O1] |
| Tilt Y + Override | `brushPoseTiltY`, `overridePoseTiltY` | -100..100% | Front-back tilt | [A O1] |
| Rotation + Override | `brushPoseAngle`, `overridePoseAngle` | 0-360 deg | Rotation of the bristles | [A O1] |
| Pressure + Override | `brushPosePressure`, `overridePosePressure` | 0-100% | Pressure on the canvas | [A O1] |

Adobe: "Get stylus-like effects... Enable Override options to maintain a static brush pose" [A O1]. Behaviour: without Override, the pose values stand in for inputs the device does not report (mouse: no pressure, no tilt) [G, standard reading]; with Override checked, the pose value **replaces** the real pen value. A preset with `overridePosePressure` paints at a fixed pressure: every pressure control and the bristle/erodible/airbrush pressure response stop reacting to the pen. Same for tilt and rotation. This is the strongest "my pen does nothing" cause that no Transfer or Shape Dynamics row shows.

---

## 10. Other brush options (bottom of the Brush Settings list)

Source: O1 "Other brush options".

| UI | Key | Effect | Pen | Ev. |
|---|---|---|---|---|
| Noise | `noise` / `Nose` | Adds randomness to each tip; most visible on soft tips (gray values) | none | [A O1][P key] |
| Wet Edges | `wetEdges` / `Wtdg` | Paint builds up at the stroke edges, centre stays more transparent (watercolor). Lowers interior opacity | none (its effect scales with whatever drives opacity/flow) | [A O1] |
| Build-up | `repeat` / `Rpt ` | Same switch as the options-bar Airbrush button. Paint keeps building while the pen rests or moves slowly; hardness, opacity and flow set how fast and how much | Time (dwell). Pressure only through flow/opacity controls | [A O1, O3, A3] |
| Smoothing (checkbox) | `smoothing` | Smoother curves when painting fast with a stylus; can lag | - | [A O1][F] |
| Protect Texture | `protectTexture` | All textured presets use the same pattern and scale (consistent canvas) | - | [A O1] |

---

## 11. Options bar settings

Source: A3, O3, A6.

| UI | Key | Range | Effect | Ev. |
|---|---|---|---|---|
| Mode | `mode` | blend modes | Paint blend with existing pixels | [A A3] |
| Opacity | `opacity` | 1-100 | Per-stroke maximum. Keys 1-0 set it | [A A3] |
| Flow | `flow` | 1-100 | Per-dab rate. Shift+number sets it | [A A3] |
| Airbrush | `repeat` | bool | Build-up (see section 10) | [A A3, O1] |
| Brush angle (options bar) | `brush.angle` [G] | deg | Same as tip Angle | [G] |
| Smoothing | `smoothingValue` | 0-100 | Intelligent stroke smoothing; 0 = legacy behaviour | [A O1, A6] |
| Smoothing gear: Pulled String Mode | `smoothingRadiusMode` | bool | Paints only when the string is taut; moves inside the radius leave no mark | [A O1] |
| Stroke Catch-Up | `smoothingCatchup` | bool | Paint keeps catching up with the cursor after a pause | [A O1] |
| Catch-up on Stroke End | `smoothingCatchupAtEnd` | bool | Completes the stroke to where the pen lifted | [A O1] |
| Adjust for Zoom | `smoothingZoomCompensation` | bool | Smoothing scales with zoom | [A O1] |
| (not in UI) | `pressureSmoothing` | bool | Not documented. Probably smooths pressure samples along with position [G] | [F] |
| (not in UI) | `smooth` / `Smoo` | int | Not documented [G: legacy smoothing amount] | [F] |
| (not in UI) | `useLegacy` | bool | Not documented [G: legacy brush engine/behaviour] | [F] |
| Pressure for Size button | `usePressureOverridesSize` | bool | See section 12 | [A O3, A3][P] |
| Pressure for Opacity button | `usePressureOverridesOpacity` | bool | See section 12 | [A O3, A3][P] |
| Auto Erase (Pencil) | - | bool | Starting on foreground color paints background color | [A A3] |

Smoothing interacts with pen input: with Pulled String Mode, short wiggles (and their pressure) inside the radius produce nothing; catch-up keeps painting after the pen stops moving.

---

## 12. Toolbar pressure-for-size and pressure-for-opacity buttons

Adobe: "Use stylus pressure to override opacity and size settings in the Brush Settings panel" [A O3]; "These controls integrate with the Brush Settings panel" [A A3]. Exact behaviour, probed with simulated pressure [P] (`img/probe-pressure-overrides.png`):

| Row | Setup | Result |
|---|---|---|
| A | no dynamics, buttons off | no taper |
| B | size button on, `$szVr` Off | tapers with pressure |
| C | size button on, Minimum Diameter 60% | tapers but never below 60%: **the button honours Minimum Diameter** |
| D | `$szVr` = Pen Tilt, size button on | pressure taper: **the button replaces the brush's size control** |
| E | opacity button on, `$opVr` Off | opacity follows pressure |
| F | size button on, Shape Dynamics unchecked (`useTipDynamics:false`) | still tapers: **the button works even with the section disabled** |
| G | `$szVr` = Pen Pressure, Minimum 60%, button off | same as C |
| H | `$opVr` = Pen Pressure, Transfer unchecked | no fade |

So: button on = size (or opacity) always follows pressure regardless of the panel. Button off = the panel decides. The opacity button was not tested against flow (`$prVr`) [G: it touches opacity only]. Both keys exist on Brush, Mixer Brush, Smudge and Eraser tool options [F]; which tools show which button in the UI is not confirmed [G: Smudge and Mixer show only the size button]. Keyboard-shortcut commands exist: "Toggle Brush Pressure Controls Size/Opacity" [B].

---

## 13. Mixer Brush

Source: A4, O4. Tool class `wetBrushTool` (ABR `MixB`).

| UI | Key | Range | Effect | Pen | Ev. |
|---|---|---|---|---|---|
| Current Brush Load (swatch): Load Brush / Clean Brush / Load Solid Colors Only | `loadSolidColorOnly` | - | Fill or empty the reservoir; solid colors only vs sampled variation | - | [A A4][F] |
| Load after each stroke | `autoFill` | bool | Refill reservoir every stroke | - | [A A4][F] |
| Clean after each stroke | `autoClean` | bool | Empty brush every stroke | - | [A A4][F] |
| Preset menu | (sets the three below) | Custom, Dry, Dry Light Load, Dry Heavy Load, Moist, Moist Light Mix, Moist Heavy Mix, Wet, Wet Light Mix, Wet Heavy Mix, Very Wet, Very Wet Light Mix, Very Wet Heavy Mix | - | - | [B] |
| Wet | `wetness` | 0-100% | Paint picked up from the canvas; higher = longer streaks | `$wtVr` | [A A4][F] |
| Load | `dryness` (ABR name; UI "Load") | 1-100% | Paint in the reservoir; low = strokes dry out sooner | none directly | [A A4][F][3P] |
| Mix | `mix` | 0-100% | Canvas paint vs reservoir paint ratio. 100% = all from canvas. Wet still decides how canvas paint mixes | `$mxVr` | [A A4][F] |
| Flow | `flow` | % | As brush | `$prVr` | [F] |
| Airbrush | `repeat` | bool | Build-up while holding | - | [A A4] |
| Sample All Layers | `sampleAllLayers` | bool | Pick up color from all visible layers | - | [A A4][F] |

Two paint wells: reservoir (deposits, larger capacity) and pickup (gets canvas paint, continuously mixed) [A A4]. Hidden responses: Load depletion is a built-in fade over stroke length with no control shown; Wet/Mix make darkness depend on what is already on the canvas. Kyle's Real Oils put flow on pressure in tool options (`prVr` 2) and leave Wet/Mix dynamics Off [F].

---

## 14. Smudge

Source: A5, O5. Tool class `smudgeTool` (ABR `SmTl`).

| UI | Key (ABR) | Range | Effect | Pen | Ev. |
|---|---|---|---|---|---|
| Strength | `Prs ` (batchPlay probably `pressure` [G]) | 0-100% | Smudge intensity; low 10-30% subtle, 50-100% strong | Strength Jitter in Transfer (`$prVr` [G]) | [A A5][F][B] |
| Mode | `mode` | | Blend of smudged pixels | - | [A A5] |
| Sample All Layers | `SmdS` | bool | Smudge from all visible layers | - | [A A5][F] |
| Finger Painting | `SmdF` | bool | Each stroke starts with the foreground color instead of the color under the pointer. Alt/Option while dragging toggles it | - | [A A5][F] |
| Size pressure | `usePressureOverridesSize`, `$szVr` | | Size follows pressure | Pressure | [F] |

The smudge tool uses the full Brush Settings tip, so bristle tips, texture etc. apply; Kyle's blenders use Direction (6) for angle and size on pressure [F].

---

## 15. Eraser (and relatives)

Source: A7, O5. Tool class `eraserTool` (ABR `ErTl`).

| UI | Key | Effect | Pen | Ev. |
|---|---|---|---|---|
| Mode: Brush / Pencil / Block | `ErsB` (int) [G mapping: Kyle's brush-mode eraser stores 1] | Brush = soft, uses brush tip and dynamics. Pencil = hard. Block = fixed square, no opacity/flow | Brush and Pencil modes: full Brush Settings dynamics, pressure buttons | [A A7, O5][F] |
| Opacity, Flow | `opacity`, `flow` | Erase strength; 100% erases fully | `$opVr`, `$prVr`, opacity button | [A A7] |
| Erase to History | `MgcE` [G] | Erases back to a History state; Alt/Option toggles temporarily | - | [A A7][F] |
| Smoothing | as section 11 | | | [A O1, A6] |

Erasing on Background or locked-transparency layers paints the background color [A A7].

Background Eraser: its brush popup has its own **Size** and **Tolerance** menus driven by Off / Pen Pressure / Stylus Wheel [A O5]. Limits (Discontiguous, Contiguous, Find Edges), Tolerance, Protect Foreground Color, Sampling (Continuous, Once, Background Swatch) [A O5][B]. Magic Eraser has no pen response.

---

## 16. Hidden pen responses (summary)

These change a stroke with pen input but show nothing in Shape Dynamics or Transfer:

1. **Bristle tips** spread, widen and fill with pressure, deflect with tilt and drag with direction, all with dynamics off [P][A O1].
2. **Erodible tips** widen with pressure and wear flat over the stroke; the wear is stored in the tip until Sharpen Tip [P][A O1].
3. **Airbrush tips** widen the spray cone at light pressure and narrow it at heavy pressure (inverse of normal) [P][A O1].
4. **Brush Projection** turns tilt and rotation into tip shape without any Angle/Roundness control [A A1].
5. **Tilt Scale** reshapes the tip height when size is on Pen Tilt [A A1].
6. **Brush Pose overrides** replace real pressure, tilt or rotation with fixed values [A O1].
7. **Toolbar pressure buttons** force size/opacity on pressure even when the panel says Off or the section is unchecked; they keep Minimum Diameter [P].
8. **Texture depth on pressure** (needs Texture Each Tip) fills the grain with pressure [A A2].
9. **Count on pressure** (Scattering) makes strokes denser and darker [A O1].
10. **Foreground/Background on pressure** lightens light-pressure color toward the background color; Brightness Jitter speckles. Both read as opacity [A A1].
11. **Build-up** adds paint with dwell time [A O1].
12. **Spacing off** makes dab spacing follow pen speed [A O1].
13. **Wet edges** lower the stroke interior [A O1].
14. **Mixer Load** runs out over stroke length; Wet/Mix pick up canvas paint [A A4].
15. **Smoothing** (Pulled String, catch-up) changes where and when pressure is applied; `pressureSmoothing` is undocumented [A A6][F].
16. **Brush presets with tool settings** can switch the tool or carry a color (section 19).

---

## 17. Everything that changes stroke darkness/opacity

| Source | Key | Pen-driven? |
|---|---|---|
| Options-bar Opacity | `opacity` | No (cap per stroke) |
| Options-bar Flow | `flow` | No (rate per dab) |
| Pressure-for-Opacity button | `usePressureOverridesOpacity` | Pressure (forced) |
| Transfer Opacity jitter/control/minimum | `$opVr` | Fade, Pressure, Tilt, Wheel |
| Transfer Flow jitter/control/minimum | `$prVr` | Fade, Pressure, Tilt, Wheel |
| Blend mode | `mode` | No |
| Build-up / Airbrush | `repeat` | Dwell time |
| Spacing (smaller = more overlap, darker with flow < 100) | `brush.spacing` | Speed when spacing off |
| Hardness (soft rim is partial opacity) | `brush.hardness` | No |
| Sampled tip gray values | `sampledBrush` | No |
| Noise | `noise` | No |
| Wet Edges | `wetEdges` | No |
| Texture depth, mode, brightness, contrast, invert | `textureDepth`, `textureBlendMode`, ... | Depth: Fade, Pressure, Tilt, Wheel, Rotation (Texture Each Tip) |
| Dual Brush (coverage cut by second tip) | `dualBrush` | Dual scatter/count controls |
| Scatter Count (overlap) | `count`, `countDynamics` | Fade, Pressure, Tilt, Wheel, Rotation |
| Color Dynamics F/B (toward background color) | `$clVr` | Fade, Pressure, Tilt, Wheel, Rotation |
| Brightness / Saturation jitter, Purity | `Brgh`, `Strt`, `purity` | No (random) |
| Bristle tip contact (density, thickness, pressure) | `dBrush` | Pressure, tilt (built in) |
| Erodible tip contact and wear | `dTips` type 0 | Pressure (built in), stroke length |
| Airbrush tip spray spread | `dTips` type 1 | Pressure (built in) |
| Brush Pose pressure override | `overridePosePressure`, `brushPosePressure` | Replaces pressure |
| Mixer Wet / Load / Mix and canvas content | `wetness`, `dryness`, `mix`, `$wtVr`, `$mxVr` | Wet, Mix: Fade, Pressure, Tilt, Wheel |
| Smudge Strength | `Prs ` | Strength Jitter control |
| Eraser opacity/flow (erase amount) | `opacity`, `flow` | as brush |
| Preset color included with the brush | `foregroundColor` in tool options [P key] | No |

## 18. Everything that changes stroke width/shape

| Source | Key | Pen-driven? |
|---|---|---|
| Size | `brush.diameter` | via below |
| Size jitter/control | `$szVr` | Fade, Pressure, Tilt, Wheel |
| Minimum Diameter | `minimumDiameter` | floor for control and size button |
| Pressure-for-Size button | `usePressureOverridesSize` | Pressure (forced) |
| Tilt Scale | `tiltScale` | Tilt (when size on tilt) |
| Angle + jitter/control | `brush.angle`, `angleDynamics` | Fade, Pressure, Tilt, Wheel, Rotation, Initial Direction, Direction |
| Roundness + jitter/control, Minimum Roundness | `brush.roundness`, `roundnessDynamics`, `minimumRoundness` | Fade, Pressure, Tilt, Wheel, Rotation |
| Brush Projection | `brushProjection` | Tilt, Rotation |
| Flip X/Y and Flip jitter | `brush.flipX/Y`, `flipX/Y` | No |
| Hardness (visible edge) | `brush.hardness` | No |
| Spacing | `brush.spacing` | Speed when off |
| Scatter, Both Axes, Count | `scatterDynamics`, `bothAxes`, `count` | Fade, Pressure, Tilt, Wheel, Rotation |
| Dual Brush tip, spacing, scatter, count | `dualBrush` | its own controls |
| Texture (edge breakup) | `useTexture`... | Depth controls |
| Bristle shape, density, length, thickness, stiffness | `dBrush` | Pressure, tilt, direction (built in) |
| Erodible shape, softness, wear | `dTips` type 0 | Pressure (built in), stroke length |
| Airbrush spray cone, distortion | `dTips` type 1 | Pressure (built in), tilt [G] |
| Brush Pose tilt/rotation/pressure overrides | `brushPose*`, `overridePose*` | Replaces pen |
| Smoothing (path shape) | `smoothingValue`, modes | Pen motion |
| Wet Edges (edge band) | `wetEdges` | No |

---

## 19. Brush presets, tool presets, and presets that switch the tool

Source: A8, O3, O7.

- **Brush preset** (Brushes panel, `.abr`): the tip plus Brush Settings. Optional parts chosen in the New Brush dialog: "Capture Brush Size in Preset" (`useBrushSize` [3P][G label]), "Include Tool Settings", "Include Color" [O7 mentions tool settings; color key `foregroundColor` seen in `currentToolOptions` [P]]. Changing size/hardness of a selected preset is temporary [A O7].
- **Tool preset** (Tool Presets panel, `.tpl`): one tool plus its options-bar settings and brush. Selecting it always selects that tool [A A8]. Options bar menu "Convert All To Brush Presets" turns Brush tool presets into brush presets [A O7].
- **Brush presets that include tool settings** store a `toolOptions` object whose class names the tool. Selecting such a brush switches the active tool.

ABR `toolOptions._class` values seen [F][3P]:

| Class | Tool (batchPlay class) | Examples in Default Brushes.abr |
|---|---|---|
| `PbTl` | Brush (`paintbrushTool`) | KYLE Ultimate Pencil Hard, Kyle's Spatter Bot Tilt, Screentones |
| `SmTl` | Smudge (`smudgeTool`) | Kyle's Paintbox - Wet Blender 50 (Strength 90%), Kyle's Impressionist Blender 1, Concept Brushes - All Purpose Blend (24%), Scratch Blend |
| `MixB` | Mixer Brush (`wetBrushTool`) | Kyle's Real Oils - 01 (Wet 90, Load 100, Mix 35), Real Oils Round Flex Wet, Concept Brushes - Foliage Mix 2 |
| `ErTl` | Eraser (`eraserTool`) | Kyle's Eraser - Natural Edge |
| `PcTl` | Pencil (`pencilTool`) | [G] |

Tool options inside a preset carry their own `szVr`, `opVr`, `prVr` (and `wtVr`, `mxVr` for the mixer) plus flow, opacity, mode, smoothing and the pressure-button states [F]. Kyle's spatter brushes put size on Pen Tilt (`szVr` 3) at tool level [F].

How to detect, before selecting: parse the preset (`tools/abrdesc.py`) and read `toolOptions._class`; anything other than `PbTl` switches the tool.
How to detect, live: after `select` of a brush preset, read `{_obj:'get', _target:[{_property:'tool'},{_ref:'application',_enum:'ordinal',_value:'targetEnum'}]}` (or ExtendScript `app.currentTool`) and compare with the tool before. Re-read `currentToolOptions` afterwards; the class determines which keys exist (smudge has `pressure`/strength instead of `opacity`; mixer adds `wetness`, `dryness`, `mix`). [G for the batchPlay `tool` property path; `app.currentTool` confirmed P].

---

## 20. Open questions

- `$bVTy` 7 vs 8 for Rotation, and 4 for Stylus Wheel: needs a rotation-capable pen and an airbrush pen.
- batchPlay spellings for Texture Each Tip (`TxtC`), color dynamics (`H   `, `Strt`, `Brgh`), dual brush sub-keys, smudge strength (`Prs `), eraser mode (`ErsB`), `MgcE`.
- Meaning of `pressureSmoothing`, `smooth`, `useLegacy`, `interpretation`, `clumping`, `physics`, `dtipsLengthRatio`, and the dormant "Speed" control string.
- Whether erodible wear persists across strokes and documents; whether tilt affects airbrush and erodible tips; whether Shape Dynamics size scales the dual tip.
- Mixer preset numeric values (Dry, Moist, Wet, Very Wet and variants).
- Whether the opacity pressure button also drives flow.
- Brush Pose without Override acting as the mouse default (standard reading, not probed).

## Appendix: probe method

ExtendScript run through `osascript -e 'tell application "Adobe Photoshop 2026" to do javascript ...'`: read `currentToolOptions`, set modified copies with `setd` on class `paintbrushTool`, stroke a path with `Strk` (`pressure` true = Photoshop's "Simulate Pressure", a 0 to full to 0 ramp), save PNG, close the document. Simulated pressure has no tilt, rotation or wheel, so those controls behave like Off in the probes.

- `img/probe-angle-control.png`: angle control 0, 3, 5, 6, 7, 8 on a 45 deg then vertical path.
- `img/probe-angle-control-2.png`: angle control 1, 2, 4, 9, 10, 7.
- `img/probe-pressure-overrides.png`: rows A-H of section 12.
- `img/probe-live-tips.png`: bristle, erodible point, airbrush, each without and with pressure.
