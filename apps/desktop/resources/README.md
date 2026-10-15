# Desktop icons

`icon.svg` is the source of truth for the selected flat Indexed Journal design.
The artwork includes its rounded tile and transparent outer margin.

Regenerate the derived assets from the repository root:

```sh
pnpm --filter @memorilo/desktop icons:generate
```

- `icon.png`: 1024px application and renderer icon.
- `icon.icns`: macOS application bundle icon.
- `icon.ico`: Windows icon with PNG frames from 16px through 256px.
- `icons/`: PNG sizes for Linux packaging.
- `trayTemplate.png` and `trayTemplate@2x.png`: the same notebook mark without
  the tile, rendered in black with transparent cutouts for the macOS menu bar.

The generator uses the repository's existing Sharp dependency. macOS ICNS
generation uses `iconutil`; on other platforms the checked-in ICNS is retained.

Electron Vite bundles the runtime assets imported by
`main/src/app-icon-paths.ts`. Electron Builder reads the packaging assets from
this directory. The renderer HTML files use the same PNG as their favicon.
