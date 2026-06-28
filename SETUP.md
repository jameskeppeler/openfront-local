# OpenFront — Local Setup & Custom Real-World Maps

This is a local copy of [OpenFront.io](https://github.com/openfrontio/OpenFrontIO)
set up to run offline **and** to add your own maps generated from real-world
elevation data (any region on Earth → a playable OpenFront map).

It works on **Windows and macOS/Linux**. Everything here is cross-platform
except the convenience launchers, which come in both `.bat` (Windows) and
`.command` (macOS/Linux) flavors.

---

## What's in this setup

There are **two repositories** that work together:

| Repo | What it is | Default URL |
| ---- | ---------- | ----------- |
| **This repo** (the game) | The OpenFront game + your custom maps baked in | forked from `openfrontio/OpenFrontIO` |
| **OpenFrontMapGenerator** (the Map Maker) | A web app to draw a region on a map and turn it into OpenFront terrain | forked from `TsProphet94/OpenFrontMapGenerator` |

Your finished maps live **inside this game repo** (`resources/maps/<name>/`
plus two small registration files), so once this repo is cloned anywhere they
are already there and playable — no Map Maker needed just to *play* them.

---

## Prerequisites

- **Node.js** ≥ 20 (includes `npm`) — for the game. <https://nodejs.org>
- **Python** ≥ 3.10 — for the Map Maker (only if you want to *make* new maps).
- A modern browser.
- A free **OpenTopography API key** (only for making maps):
  <https://portal.opentopography.org/myopentopo> → *myOpenTopo → Authorizations and API Key*.

macOS note: the first time you run a `.command` file you may need to make it
executable: open Terminal in the repo folder and run `chmod +x *.command`.

---

## Quick start — play the game

### Windows
Double-click **`Play-OpenFront.bat`** (or the desktop shortcut if you made one).

### macOS / Linux
Double-click **`Play-OpenFront.command`**.

Either way it will:
1. install dependencies on first run (`npm run inst`),
2. start the dev server,
3. open the game at <http://localhost:9000> once it's ready.

Keep the server window open while playing; **close it to stop** the game.
Closing only the browser tab leaves the server running (next launch is instant).

### Manual equivalent
```bash
npm run inst     # first time only (safe install: npm ci --ignore-scripts)
npm run dev      # serves on http://localhost:9000
```

> The `ECONNREFUSED "Error polling lobby"` / cosmetics errors in the server
> log are **normal** — they're calls to OpenFront's closed-source online API,
> which isn't part of local dev. **Singleplayer works fully offline.**

---

## Quick start — make a new map

1. **Start the Map Maker** (in the `OpenFrontMapGenerator` repo):
   - Windows: double-click **`Start-MapMaker.bat`**
   - macOS/Linux: double-click **`Start-MapMaker.command`**

   On first run it creates a Python virtual environment and installs the
   geospatial dependencies, then opens <http://localhost:5000>.

2. **Add your API key once.** Create `OpenFrontMapGenerator/webapp/.env`:
   ```
   OPENTOPO_API_KEY=your_key_here
   ```
   (This file is git-ignored — see *Security* below.)

3. **In the web app:**
   - Pick a basemap with the layers icon (top-right) — **Topographic** is the
     default; relief shading shows where the interesting elevation is.
   - Click the **▭ rectangle tool** (left edge of the map) and drag a box over
     your region.
   - Enter a **Map Name** and click **🚀 Generate Map**.
   - First generation is slower (~1–3 min): it downloads global nation data
     (Natural Earth admin-0/admin-1, for spawn points) and the elevation tiles,
     then caches them.

4. **Get it into the game** — see the pipeline below.

---

## How a region becomes a playable map (the pipeline)

```
  Draw a region in the Map Maker
            │  (downloads DEM elevation + Natural Earth nations)
            ▼
  webapp produces a styled  image.png  (+ a .json with nation points)
            │
            ▼
  scripts/map_generator.py  (Phase 2)  packs the PNG into the game's format:
            │     map.bin, map4x.bin, map16x.bin, manifest.json, thumbnail.webp
            ▼
  Copy that folder into  resources/maps/<name>/  in THIS repo
            │
            ▼
  Register the map (2 small edits)  →  it appears in the map picker
```

The Map Maker keys terrain off the **blue channel** of the PNG (water = a key
blue, higher blue = higher land), matching the game's own binary format
(bit 7 = land, bit 6 = shoreline, bit 5 = ocean, bits 0–4 = magnitude).

### Phase 2 + registration (manual steps)

After generating in the web app, find its output. The web app writes to a
temp folder and offers a **download** (a ZIP containing `image.png` and a
`<name>.json`). Then:

1. **Pack into game format** using the converter in the Map Maker repo. Put
   `image.png` and the json (renamed to `info.json`) into a folder named after
   your map, then run:
   ```bash
   # from the OpenFrontMapGenerator repo, with its venv active
   python scripts/map_generator.py "MyMap" --input <folder-containing-MyMap> --output generated
   ```
   This writes `generated/mymap/` (and a higher-res `generated/mymapbig/`) with
   `map.bin`, `map4x.bin`, `map16x.bin`, `manifest.json`, `thumbnail.webp`.

2. **Copy** `generated/mymap/` → this repo's `resources/maps/mymap/`
   (folder name must be the lowercase map name).

3. **Register** the map with two edits in this repo:

   - `src/core/game/Maps.gen.ts` — add an enum entry and a `maps[]` entry:
     ```ts
     // in the GameMapType enum:
     MyMap = "MyMap",

     // in the `maps` array:
     {
       id: "MyMap",
       type: GameMapType.MyMap,
       translationKey: "map.mymap",
       categories: ["custom"],       // "custom" => shows in the Custom tab
                                     // (or use new, europe, asia, africa, ...)
       multiplayerFrequency: 0,      // 0 = keep out of the public playlist
     },
     ```
   - `resources/lang/en.json` — add the display name in the `map` section:
     ```json
     "mymap": "MyMap",
     ```

4. **Reload** the game (hard-refresh the tab). Your map appears under its
   category (e.g. **New**) in the SOLO map picker.

> `Maps.gen.ts` is normally auto-generated by the repo's Go `map-generator`.
> We register by hand because that generator needs a C compiler to build its
> WebP dependency (absent on the original Windows box). **On macOS** the Go
> generator *does* build (clang ships with Xcode Command Line Tools), so there
> you can instead drop `image.png` + an `info.json` into
> `map-generator/assets/maps/<name>/` and run `npm run gen-maps` for automatic
> registration. Either path produces the same result.

### The Custom tab

The map picker (SOLO → **Custom**) has a dedicated **Custom** tab that lists
every map tagged `categories: ["custom"]` and a **Create a Map** button that
opens the Map Maker (<http://localhost:5000>). Tag your maps with `"custom"`
so they show up there.

---

## Stopping / restarting

- **Stop:** close the server window (the one titled "… close this window to stop").
- **Restart:** run the launcher again. If the server is already up, it just
  reopens the browser.

Ports: game = **9000**, Map Maker = **5000**.

---

## Security — do NOT commit these

These are git-ignored already; just don't force them in:

- **`OpenFrontMapGenerator/webapp/.env`** — your OpenTopography API key. A
  secret. If it ever leaks, revoke/rotate it on the OpenTopography portal.
- **`.venv/`, `node_modules/`** — platform-specific; recreated by the
  launchers / `npm run inst` / `pip install` on each machine.

---

## Pushing to your own GitHub

Both repos currently point at the **original** authors' GitHub, so you push to
your **own new repos**:

```bash
# create an empty repo on GitHub first (e.g. via the website or `gh repo create`)
git remote set-url origin https://github.com/<you>/<your-repo>.git
git add -A
git commit -m "Local setup + custom maps"
git push -u origin HEAD
```

Notes:
- This game repo was cloned shallow (`--depth 1`); pushing to a fresh repo is
  fine. (To get full history: `git fetch --unshallow` first.)
- OpenFront is **AGPL-3.0** and the Map Maker is **MIT** — keep their LICENSE
  files and notices when you publish.

---

## Cross-platform summary

| Thing | Windows | macOS / Linux |
| ----- | ------- | ------------- |
| The game | ✅ | ✅ |
| Custom maps (data) | ✅ | ✅ |
| Map Maker web app | ✅ | ✅ |
| Launchers | `.bat` | `.command` |
| Go map-generator (optional auto-register) | needs a C compiler | ✅ (Xcode CLT) |
