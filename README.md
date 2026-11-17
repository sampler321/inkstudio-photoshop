# InkStudio for Photoshop

Procreate-simple drawing and painting in Photoshop. One brush library panel and one slim rail; everything else in
Photoshop stays where it is, and every control drives Photoshop's own painting engine.

Brushes are **not** included. Point the panel at your own folder of `.abr` packs.

## The panel

**Brushes**: Packs, Favourites, Recent and Mine tabs (Mine = brushes you saved), filters by medium (pencil, ink and pen, marker, watercolour,
gouache and acrylic, oil, charcoal and pastel, spray and splatter, texture and grain, stamps) and search across packs,
makers, tags and brush names. Pack details stay collapsed until you open a pack: the maker's description, tags, and
every brush as its tip image (brushes without one, such as Photoshop's own computed brushes, show a stroke
painted by Photoshop).
A slider in the footer switches between a compact list, a two-per-row gallery of pack covers and one large cover
per row; brush tiles grow with it. Pack names drop marketing counts ("100 Watercolor ...") and show the real number
of brushes. Tapping a brush loads its pack once and selects it with the Brush tool at a sensible size for its medium.

**Rail** (docks beside Photoshop's toolbar)

- Brush, Wet paint (Mixer Brush), Smudge, Eraser. Smudge and wet paint use the brush you are painting with; the
  eraser is a plain round at the same size.
- Colour chip (Photoshop's picker) and recent colours; size and opacity faders. With Wet paint the second fader is
  **Wet**: dry = loaded paint, wet = a clean blender that only moves paint already on the canvas.
- **Pen sends**: Pressure, Tilt, Rotation, Wheel, Direction, Fade, Button, Eraser. These switch what the pen sends,
  for every brush; inputs your pen does not have are greyed out.
- Media: **Paper** (grain; brushes with their own grain keep it), **Wet** (wet edges), **Layer** (multiply).
- Undo, redo, and **Impasto**: Photoshop's Oil Paint filter on a merged copy layer in Soft Light.

**Brush panel** (every pen-driven setting of the current brush)

- **Feel** presets (pencil, fineliner, brush pen, chisel marker, calligraphy, charcoal, airbrush, the maker's
  original) and your own saved feels; **Test stroke** paints a light, heavy, light stroke so you see the result.
- **Pen controls**: size, opacity, flow, angle, roundness, grain depth, scatter, dab count and colour, each with what
  drives it (pressure, tilt, direction, rotation, fade, stylus wheel), its random amount and its minimum. Simple shows
  what the brush uses, All shows everything.
- **Pressure curve** per brush, applied by the optional pen relay [PenCast](https://github.com/sampler321/pencast) before Photoshop sees the pressure.
- **Tip** (including bristle and erodible tip physics), **Brush pose** overrides, **Tool & paint** (opacity, flow,
  mode, build-up, wet edges, noise, texture, smoothing, mixer wetness/load/mix).
- **Save brush to Photoshop** stores the brush with all its settings in Photoshop's Brushes panel.

`docs/brush-settings-reference.md` documents every setting, its descriptor key and how the pen drives it.

## Brush folder

```
My Brushes/
  some-pencil-pack/      any .abr files, nested folders are fine
  watercolour-set/
    pack.json            optional: {"title", "author", "description", "tags"}
  .inkstudio/            generated index: catalog.json, tips/, covers/, strokes/
```

Index it (Python 3 + Pillow), then render stroke previews with Photoshop running:

```
python3 tools/catalogue.py "My Brushes" [envato-meta.json covers/] [--only pack1,pack2]
python3 tools/render_previews.py "My Brushes" all --when-idle
```

`render_previews.py` loads each pack, paints one pressure stroke per brush and removes exactly the presets it added,
so the Brushes panel ends as it started. `--when-idle` only works while the computer has been idle for two minutes.

In Photoshop open **Plugins > InkStudio > InkStudio Brushes** and **InkStudio Rail**, press the gear and choose the
folder (or write its path into the plugin's data folder as `library.txt`).

## Workspace

`workspace/InkStudio.psw`: the rail docked beside Photoshop's toolbar, the brush library on the right above Layers,
Properties / Adjustments / Libraries / Color closed. Copy it into
`~/Library/Preferences/Adobe Photoshop 2026 Settings/WorkSpaces/` and pick Window > Workspace > InkStudio.

## Install (development)

`tools/dev-reload.sh` packages `plugin/` as a .ccx, installs it with Adobe's plugin installer and restarts Photoshop
(open documents are saved first). `tools/cmd.sh` sends test commands to the running panel.

## License

MIT for the code. Brush packs you add stay under their own licences.
