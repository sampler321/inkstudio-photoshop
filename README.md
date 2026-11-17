# InkStudio for Photoshop

A Procreate-simple drawing setup for Photoshop: one brush library panel and one slim rail
(tools, colour, size, opacity, undo/redo). Everything else in Photoshop stays where it is.

Brushes are **not** included. Point the panel at your own folder of `.abr` packs.

## Brush folder

```
My Brushes/
  some-pencil-pack/      any .abr files, nested folders are fine
  watercolour-set/
  .inkstudio/            generated index: catalog.json, tips/, covers/
```

Index it once (Python 3 + Pillow):

```
python3 tools/catalogue.py "My Brushes"
# optional: Envato metadata and covers, matched by pack folder name
python3 tools/catalogue.py "My Brushes" envato-meta.json covers/
```

Then in Photoshop open **Plugins > InkStudio > InkStudio Brushes**, press the gear and choose `My Brushes`.

## Install (development)

1. Photoshop: Settings > Plugins > Enable Developer Mode, restart.
2. UXP Developer Tools: Add Plugin > `plugin/manifest.json` > Load.

## What the panel does

- Media / Favourites / Recent / Packs, plus medium filters (pencil, ink, marker, watercolour, ...).
- Pack details are collapsed by default; open a pack for its description, tags and brush tips.
- Tapping a brush loads its `.abr` into Photoshop once, then selects it with the Brush tool.
- The rail sets brush size (log scale), tool opacity, colour (with recent colours) and steps history.

## License

MIT for the code. Brush packs you add stay under their own licences.
