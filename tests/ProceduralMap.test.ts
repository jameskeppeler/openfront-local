import {
  ProceduralMap,
  RANDOM_MAP_HEIGHT,
  RANDOM_MAP_WIDTH,
} from "../src/core/game/ProceduralMapGenerator";
import { genTerrainFromBin } from "../src/core/game/TerrainMapLoader";

const IS_LAND = 0x80;
const SHORELINE = 0x40;
const OCEAN = 0x20;
const MAGNITUDE_MASK = 0x1f;

// Most assertions use the 16x LOD: it exercises the same generation code but is
// ~16x cheaper than full-res, so the suite stays fast and doesn't time out
// under parallel load. One test covers full-res + manifest with a wide timeout.

function countLand(terrain: Uint8Array): number {
  let n = 0;
  for (const b of terrain) if (b & IS_LAND) n++;
  return n;
}

describe("ProceduralMap", () => {
  it("is deterministic: same seed produces byte-identical terrain", () => {
    const a = new ProceduralMap(12345).terrainBin("16x");
    const b = new ProceduralMap(12345).terrainBin("16x");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("different seeds produce different terrain", () => {
    const a = new ProceduralMap(1).terrainBin("16x");
    const b = new ProceduralMap(2).terrainBin("16x");
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("nation count is deterministic and scales into a sane range", () => {
    expect(new ProceduralMap(777).nationCount).toBe(
      new ProceduralMap(777).nationCount,
    );
    for (const seed of [1, 2, 5, 42, 555]) {
      const n = new ProceduralMap(seed).nationCount;
      expect(n).toBeGreaterThanOrEqual(8);
      expect(n).toBeLessThanOrEqual(60);
    }
  });

  it("produces a sane land ratio near the target", () => {
    const terrain = new ProceduralMap(42, { landRatio: 0.5 }).terrainBin("16x");
    const ratio = countLand(terrain) / terrain.length;
    expect(ratio).toBeGreaterThan(0.25);
    expect(ratio).toBeLessThan(0.65);
  });

  it("never emits impassable land (31); has ocean and shoreline", () => {
    const terrain = new ProceduralMap(99).terrainBin("16x");
    let hasOcean = false;
    let hasShore = false;
    for (const b of terrain) {
      if (b & IS_LAND) expect(b & MAGNITUDE_MASK).toBeLessThanOrEqual(30);
      if (b & OCEAN) hasOcean = true;
      if (b & SHORELINE) hasShore = true;
    }
    expect(hasOcean).toBe(true);
    expect(hasShore).toBe(true);
  });

  // Full-resolution: manifest metadata, rivers, nation placement, and loading
  // through genTerrainFromBin. Wide timeout so it's robust under parallel load.
  it("produces a valid full-resolution map + manifest", async () => {
    const map = new ProceduralMap(31337);
    const manifest = map.manifest();
    const full = map.terrainBin("full");
    const mid = map.terrainBin("4x");
    const small = map.terrainBin("16x");

    // LOD byte lengths + land count match the manifest metadata.
    expect(full.length).toBe(manifest.map.width * manifest.map.height);
    expect(mid.length).toBe(manifest.map4x.width * manifest.map4x.height);
    expect(small.length).toBe(manifest.map16x.width * manifest.map16x.height);
    expect(countLand(full)).toBe(manifest.map.num_land_tiles);

    // Rivers/lakes: some interior (non-ocean) water was carved into the land.
    let interiorWater = 0;
    for (const b of full) {
      if (!(b & IS_LAND) && !(b & OCEAN)) interiorWater++;
    }
    expect(interiorWater).toBeGreaterThan(0);

    // Nations spawn on land, within bounds, and match the derived count.
    expect(manifest.nations.length).toBe(map.nationCount);
    for (const nation of manifest.nations) {
      const [x, y] = nation.coordinates!;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(RANDOM_MAP_WIDTH);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThan(RANDOM_MAP_HEIGHT);
      expect(full[y * RANDOM_MAP_WIDTH + x] & IS_LAND).toBeTruthy();
    }

    // Loads cleanly through the normal terrain loader.
    const gameMap = await genTerrainFromBin(manifest.map, full);
    expect(gameMap.width()).toBe(RANDOM_MAP_WIDTH);
    expect(gameMap.height()).toBe(RANDOM_MAP_HEIGHT);
    expect(gameMap.numLandTiles()).toBe(manifest.map.num_land_tiles);
  }, 30000);
});
