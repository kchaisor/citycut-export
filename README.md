# CityCut

CityCut cuts a square out of a city and exports it as a 3D model and a 2D site plan. The default view opens on the Melbourne CBD.

It is a study tool for early architectural work: OpenStreetMap footprints, estimated heights, and a flat ground slab. It is not a survey and it does not use lidar.

## Live site

The production build is set up to publish to [https://kchaisor.github.io/citycut-export/](https://kchaisor.github.io/citycut-export/).

Pushes to `main` build `dist` and deploy it with GitHub Actions (`.github/workflows/pages.yml`). Vite’s `base` is `/citycut-export/`, so the built HTML, scripts, styles, and favicon resolve under that project path. The app has no client-side router, so there is no extra basename to set.

GitHub Pages still needs **Settings → Pages → Source: GitHub Actions** turned on once for this repo (the site source is not enabled yet). After that, the address above is the live app.

## Pipeline

1. **Choose a block.** A MapLibre map fills the screen. A fixed frame stays centered while you pan and zoom. The frame is a true square on the ground, from 0.25 km to 1.4 km on a side (about 2 km² at the top of the slider).
2. **Search.** Nominatim pans the map to a place. The frame still marks the area that will be exported.
3. **Choose layers.** Buildings, roads and rail, and water and green are sent to Overpass and become the model. Terrain, contours, and trees are listed as **Soon** and are not in the file. Satellite image only switches the basemap.
4. **Create model.** CityCut queries Overpass for that bounding box, clips every feature to the square, and opens the result.
5. **Review.** Three views of the same block:
   - **3D model** — extruded footprints in the browser (Three.js)
   - **Drawing** — SVG site plan, pan and zoom
   - **Satellite** — Esri imagery of the frame, preview only
6. **Download.** glTF binary (`.glb`) and SVG. Those two downloads are real. DXF, DAE, 3DM, and JPG are not offered.

Building height, in order:

- OSM `height` (feet are converted to meters)
- otherwise `building:levels` × 3 m
- otherwise 9 m

Heights are capped between 3 m and 420 m. The ground is a flat slab. Multipolygon buildings, parks, and water bodies are stitched when the relation is small enough to assemble (80 members or fewer).

## Run locally

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173/citycut-export/` (port 5173, same `/citycut-export/` base as Pages). Open that URL, leave the frame on Melbourne or search for a place, then press **Create model**. `npm run preview` serves the production build at `http://localhost:4173/citycut-export/`.

```bash
npm test
npm run build
npm run preview
```

No API key is required for the defaults.

## Environment

Copy `.env.example` if you want to override the public endpoints. Both variables are optional.

| Variable | Default | Role |
| --- | --- | --- |
| `VITE_OVERPASS_URL` | `https://overpass.openstreetmap.fr/api/interpreter` | First Overpass interpreter. On failure CityCut tries `overpass.kumi.systems`, then the Mail.ru public instance. |
| `VITE_NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Place search. |

Map tiles:

- **Map** — [OpenFreeMap](https://openfreemap.org/) Positron style (`https://tiles.openfreemap.org/styles/positron`). No key.
- **Satellite** — Esri World Imagery raster tiles. No key. The app must keep the Esri, Maxar, and Earthstar Geographics attribution, which the map control and the page footer both show.

Nominatim’s usage policy asks for an identifying User-Agent. Browsers set that themselves and will not let the page replace it. Fine for light use; put a small proxy in front of Nominatim if you expect real traffic.

## What is real, stubbed, or later

| Feature | Status |
| --- | --- |
| Map, search, square frame, area slider | Real |
| Buildings, roads and rail, water and green | Real, from Overpass, clipped to the frame |
| 3D orbit view | Real |
| Drawing tab (SVG, pan/zoom) | Real |
| glTF `.glb` download | Real |
| SVG download | Real |
| Satellite basemap and satellite tab | Real preview. Not embedded in the glTF or SVG |
| Terrain | Stub. Toggle is labeled Soon and does not affect the model |
| Contours | Stub, same as terrain |
| Trees | Stub. Tree counts are omitted because they are not loaded |
| Relief / terrain stats | Omitted. The ground is flat |
| DXF, DAE, 3DM, JPG | Not in this version. No placeholder downloads |
| Lidar, terrain mesh, detected trees | Not in this version |

## Limits

- Frame side is 0.25–1.4 km so the area stays under about 2 km².
- Live Overpass queries can be slow or refused when the public instances are busy. The app tries the next endpoint and shows an error rather than a partial fake model.
- Most Melbourne buildings have no `height` tag, so many blocks use levels × 3 m or the 9 m default.
- Indoor corridors, tunnels, and `building:part` outlines are skipped so they do not paint through the block.
- A very large multipolygon (more than 80 members) is skipped. Coastlines are not queried.
- Building count is capped at 4,000, keeping the largest footprints.
- Road kilometres are clipped centerline length, including rail and tram, not lane area.
- Relation holes are kept when a multipolygon stitches to a single outer ring.

## Attribution

Map data © OpenStreetMap contributors. Vector tiles © OpenFreeMap / OpenStreetMap. Satellite imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community.

CityCut is an original interface. Kelvin Chai, Melbourne.

## Layout

- `src/App.tsx` — select screen and model screen
- `src/lib/overpass.ts` — query and endpoint fallback
- `src/lib/parseOsm.ts` — footprints, roads, water, green
- `src/lib/buildCity.ts` — Three.js group shared by the viewport and the glTF export
- `src/lib/svgPlan.ts` — drawing tab and SVG download
