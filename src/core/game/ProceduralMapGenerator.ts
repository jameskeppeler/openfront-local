// Deterministic procedural map generator.
//
// Runs inside src/core, so it must be fully deterministic: every client
// generates a bit-identical map from the same seed, or the simulation
// desyncs. To guarantee that we use ONLY:
//   - a standalone 32-bit integer hash for the value-noise lattice, and
//   - the project PseudoRandom (integer-op sfc32) for seed-splitting, the
//     per-seed generation parameters, and spawn scattering.
// We deliberately avoid Math.sin/cos/pow/sqrt/exp/log: IEEE-754 does not
// mandate correctly-rounded results for those, so they can differ in the last
// ULP across platforms. Basic +,-,*,/ on doubles ARE correctly rounded and so
// are safe. Never use Math.random() here.
//
// Terrain shape uses standard techniques (see e.g. Red Blob Games "Making
// maps with noise functions" and Inigo Quilez "domain warping"):
//   - fractional Brownian motion (fBm): summed octaves of value noise with a
//     per-octave amplitude (persistence) and frequency (lacunarity),
//   - domain warping: the sample coordinates are displaced by a second noise
//     field so coastlines fracture into fjords/peninsulas instead of smooth
//     blobs — the warp strength is randomized per seed,
//   - the map is a rectangular CROP of a larger, unbounded noise field at a
//     random offset, so land runs off the edges naturally (no water frame),
//   - per-seed archetypes (archipelago / continents / mixed / pangaea / lone
//     island) vary land ratio + frequency so regenerating changes character,
//   - a ridged mountain layer plus elevation redistribution give a natural
//     plains -> foothills -> mountain-range spread on land,
//   - rivers via priority-flood + flow accumulation on that height field:
//     dendritic networks that rise in the highlands, follow valleys, merge,
//     and drain to the sea (see carveRivers).
//
// The produced terrain byte matches GameMapImpl's immutable layout
// (see GameMap.ts):
//   bit 7  = land
//   bit 6  = shoreline
//   bit 5  = ocean (edge-connected water; interior water is a lake)
//   bits 0-4 = magnitude (land: elevation 0-30; water: distance-to-land / 2)

import { PseudoRandom } from "../PseudoRandom";
import type { MapManifest, Nation } from "./TerrainMapLoader";

// Terrain bit layout — mirrors the private constants in GameMapImpl.
const IS_LAND = 0x80;
const SHORELINE = 0x40;
const OCEAN = 0x20;
const MAGNITUDE_MASK = 0x1f;
const MAX_LAND_MAGNITUDE = 30; // 31 is reserved for "impassable" — never emit it.

// Full-resolution dimensions of the generated map. The two lower LODs are
// derived at 1:2 and 1:4, matching the baked-map pipeline.
export const RANDOM_MAP_WIDTH = 1200;
export const RANDOM_MAP_HEIGHT = 800;

// Resolution at which the sea-level threshold is estimated. Fixed and small so
// the lobby preview and the in-game map derive an identical threshold cheaply,
// independent of the actual raster size.
const SEA_LEVEL_REF = 192;

// Explicit overrides. Anything omitted is randomized per seed so that
// "Regenerate" produces meaningfully different worlds each time.
export interface ProceduralMapOptions {
  /** Fraction of tiles that should be land (0..1). */
  landRatio?: number;
  /** fBm octaves — higher = more fine detail. */
  octaves?: number;
  /** Base frequency ~ number of landmasses across the map. */
  baseFrequency?: number;
  /** Radial falloff strength: ~0 = land reaches edges, high = isolated island. */
  islandStrength?: number;
  /** Number of AI nation spawn points to scatter on land. */
  nationCount?: number;
}

// ---- Value noise (resolution-independent, coordinate-hashed) --------------

// 32-bit integer avalanche hash of a lattice point. Returns [0,1).
function hashLattice(ix: number, iy: number, seed: number): number {
  let h = seed | 0;
  h = Math.imul(h ^ (ix | 0), 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h ^ (iy | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smoothstep (3t^2 - 2t^3) — polynomial, so deterministic across platforms.
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const v00 = hashLattice(ix, iy, seed);
  const v10 = hashLattice(ix + 1, iy, seed);
  const v01 = hashLattice(ix, iy + 1, seed);
  const v11 = hashLattice(ix + 1, iy + 1, seed);
  const ux = smooth(fx);
  const uy = smooth(fy);
  const a = v00 + (v10 - v00) * ux;
  const b = v01 + (v11 - v01) * ux;
  return a + (b - a) * uy;
}

// Fractional Brownian motion in [0,1).
function fbm(
  x: number,
  y: number,
  seed: number,
  octaves: number,
  persistence: number,
  lacunarity: number,
): number {
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    // Distinct per-octave seed so octaves don't align.
    const octaveSeed = (seed + Math.imul(o, 0x9e3779b1)) | 0;
    sum += amp * valueNoise(x * freq, y * freq, octaveSeed);
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / norm;
}

// ---- Generator ------------------------------------------------------------

interface Raster {
  terrain: Uint8Array;
  numLandTiles: number;
  land: Uint8Array; // 1 = land, 0 = water (kept for spawn placement)
}

export class ProceduralMap {
  private readonly rasterCache = new Map<string, Raster>();

  // Per-seed generation parameters (some overridable via options).
  private readonly noiseSeed: number;
  private readonly warpSeedX: number;
  private readonly warpSeedY: number;
  private readonly baseFrequency: number;
  private readonly octaves: number;
  private readonly persistence: number;
  private readonly lacunarity: number;
  private readonly warpStrength: number;
  // Ridged detail added ONLY to already-high ground (gated by base elevation)
  // so mountains form coherent ranges on the high interior instead of random
  // patches. mountainAmount controls how alpine the map is.
  private readonly ridgeSeed: number;
  private readonly ridgeFreq: number;
  private readonly mountainAmount: number;
  // Minimum upstream catchment (in full-res tiles) for a tile to become river.
  // Lower = denser river networks. Scaled by resolution for each LOD.
  private readonly riverCatchment: number;
  // How many river systems to keep (largest first) so maps aren't blanketed
  // with the full drainage network. Randomized per seed.
  private readonly riverCount: number;
  // The map is a rectangular CROP of a larger, unbounded noise field, offset
  // to a random region per seed. Land runs off the edges naturally instead of
  // being framed by a water border.
  private readonly offsetX: number;
  private readonly offsetY: number;
  // Pull toward a single central landmass. 0 => interior is pure noise, so
  // land forms multiple masses / archipelagos; high => one central island
  // (only used by the rare "lone island" archetype).
  private readonly centralBias: number;
  private readonly landRatio: number;
  // Target number of AI nation spawns, scaled by land area so small/islandy
  // maps get few nations and big continents get many (like the stock maps'
  // hand-authored counts). Public so the lobby can read it cheaply (just the
  // constructor, no rasterize) to show an accurate default, like stock maps
  // read manifest.nations.length.
  public readonly nationCount: number;
  private readonly seaLevel: number;

  constructor(
    public readonly seed: number,
    options: ProceduralMapOptions = {},
  ) {
    const prng = new PseudoRandom(seed | 0);
    this.noiseSeed = prng.nextInt(1, 0x7fffffff) | 0;
    this.warpSeedX = prng.nextInt(1, 0x7fffffff) | 0;
    this.warpSeedY = prng.nextInt(1, 0x7fffffff) | 0;

    // Pick a world archetype so regenerating varies the *character* of the
    // map, not just its details. Fragmentation into many landmasses comes
    // from frequency + land ratio; centralBias is only high for the classic
    // "single island" look. Ranges: [centralLo, centralHi], [landLo, landHi],
    // [freqLo, freqHi].
    const roll = prng.next();
    let central: [number, number];
    let land: [number, number];
    let freq: [number, number];
    if (roll < 0.3) {
      // Archipelago — lots of islands scattered across the whole map.
      central = [0.0, 0.15];
      land = [0.2, 0.32];
      freq = [7.0, 12.0];
    } else if (roll < 0.58) {
      // Continents — a few large masses with detailed coastlines.
      central = [0.0, 0.25];
      land = [0.4, 0.52];
      freq = [3.5, 5.5];
    } else if (roll < 0.78) {
      // Mixed — medium continents plus scattered islands.
      central = [0.0, 0.3];
      land = [0.33, 0.46];
      freq = [5.0, 8.0];
    } else if (roll < 0.92) {
      // Pangaea — one dominant landmass sprawling across most of the map.
      central = [0.0, 0.2];
      land = [0.55, 0.68];
      freq = [2.0, 3.5];
    } else {
      // Lone island — a single central landmass ringed by open ocean.
      central = [0.9, 1.5];
      land = [0.3, 0.42];
      freq = [3.0, 5.0];
    }

    this.centralBias =
      options.islandStrength ?? prng.nextFloat(central[0], central[1]);
    this.landRatio = options.landRatio ?? prng.nextFloat(land[0], land[1]);
    this.baseFrequency =
      options.baseFrequency ?? prng.nextFloat(freq[0], freq[1]);
    this.octaves = options.octaves ?? prng.nextInt(5, 8);
    // Randomize the "noise levels at each layer" per seed so coastline
    // roughness differs every regenerate.
    this.persistence = prng.nextFloat(0.45, 0.62);
    this.lacunarity = prng.nextFloat(1.85, 2.15);
    this.warpStrength = prng.nextFloat(0.6, 2.2); // in noise-cell units
    // Crop this map from a random region of the (unbounded) noise field.
    this.offsetX = prng.nextFloat(0, 4096);
    this.offsetY = prng.nextFloat(0, 4096);
    // Ridged detail for mountain ranges (gated by base elevation in reliefAt).
    this.ridgeSeed = prng.nextInt(1, 0x7fffffff) | 0;
    this.ridgeFreq = this.baseFrequency * prng.nextFloat(2.0, 3.5);
    this.mountainAmount = prng.nextFloat(0.15, 0.4);
    this.riverCatchment = prng.nextFloat(350, 900);
    // Two-level randomization: randomize the interval per seed, then pick a
    // count within it, so some maps are nearly dry and others river-rich. The
    // upper bound scales with land area — a sparse archipelago tops out around
    // 6, a full pangaea around 12 — so we never stipple tiny islands with the
    // full quota. (Capped again by however many systems actually exist.)
    {
      const landScaledMax = Math.round(4 + this.landRatio * 11); // ~6..12
      const lo = prng.nextInt(0, 5); // 0..4
      const hi = prng.nextInt(6, landScaledMax + 1); // 6..landScaledMax
      this.riverCount = prng.nextInt(lo, hi + 1); // lo..hi
    }
    // ~1 nation per land fraction; clamped to the range stock maps span.
    const scaledNations = Math.round(this.landRatio * 85);
    this.nationCount =
      options.nationCount ?? Math.max(8, Math.min(60, scaledNations));

    this.seaLevel = this.computeSeaLevel();
  }

  /** Continuous elevation in [0,1] at normalized coordinates (nx, ny). */
  private elevationAt(nx: number, ny: number): number {
    // Sample point in noise-cell space: a rectangular crop of the larger noise
    // field, offset per seed. Aspect-correct (x scaled by width/height) so
    // features stay round rather than stretched across the 3:2 map.
    const aspect = RANDOM_MAP_WIDTH / RANDOM_MAP_HEIGHT;
    const px = this.offsetX + nx * this.baseFrequency * aspect;
    const py = this.offsetY + ny * this.baseFrequency;

    // Domain warp: displace the sample point by a lower-frequency noise field
    // so coastlines fracture into peninsulas/bays instead of smooth ovals.
    const wx =
      fbm(px * 0.5 + 11.3, py * 0.5 + 3.1, this.warpSeedX, 4, 0.5, 2) - 0.5;
    const wy =
      fbm(px * 0.5 + 5.7, py * 0.5 + 19.2, this.warpSeedY, 4, 0.5, 2) - 0.5;

    let e = fbm(
      px + this.warpStrength * wx,
      py + this.warpStrength * wy,
      this.noiseSeed,
      this.octaves,
      this.persistence,
      this.lacunarity,
    );

    // Optional central bias — only meaningful for the "lone island" archetype;
    // pulls outlying land underwater to leave a single central mass.
    if (this.centralBias > 0) {
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      const d2 = (dx * dx + dy * dy) * 4; // 0 at center, ~2 at corners
      e -= this.centralBias * d2 * 0.55;
    }
    if (e < 0) e = 0;
    else if (e > 1) e = 1;
    return e;
  }

  // Raw land relief (pre-normalization) from the SAME elevation field used for
  // land/water, so highlands sit coherently on high ground. Base relief is the
  // height above sea level; a ridged term is added only where the base is
  // already high (gated by e), sharpening those interiors into mountain ranges
  // instead of placing peaks at random. rasterize() redistributes the result.
  private reliefAt(nx: number, ny: number, e: number): number {
    const base = e - this.seaLevel;

    // Gate: 0 across low/mid land, ramps to 1 on the highest ground.
    const gateLo = this.seaLevel + 0.45 * (1 - this.seaLevel);
    const gateHi = this.seaLevel + 0.85 * (1 - this.seaLevel);
    let gate = (e - gateLo) / (gateHi - gateLo || 1);
    if (gate <= 0) return base;
    if (gate > 1) gate = 1;
    gate = smooth(gate);

    // Ridged noise: 1 - |2n - 1| peaks along ridge lines; squared to sharpen.
    const aspect = RANDOM_MAP_WIDTH / RANDOM_MAP_HEIGHT;
    const rx = this.offsetX + nx * this.ridgeFreq * aspect;
    const ry = this.offsetY + ny * this.ridgeFreq;
    const rn = fbm(rx, ry, this.ridgeSeed, 5, 0.5, 2);
    let ridge = 1 - Math.abs(2 * rn - 1);
    ridge = ridge * ridge;

    return base + this.mountainAmount * gate * ridge;
  }

  // Pick the sea-level threshold that yields the target land ratio, estimated
  // on a fixed low-res grid so preview and game agree. Because elevationAt
  // already includes the falloff, the realized land ratio tracks the target
  // regardless of island strength.
  private computeSeaLevel(): number {
    const n = SEA_LEVEL_REF * SEA_LEVEL_REF;
    const vals = new Float64Array(n);
    let i = 0;
    for (let y = 0; y < SEA_LEVEL_REF; y++) {
      for (let x = 0; x < SEA_LEVEL_REF; x++) {
        vals[i++] = this.elevationAt(
          (x + 0.5) / SEA_LEVEL_REF,
          (y + 0.5) / SEA_LEVEL_REF,
        );
      }
    }
    vals.sort();
    const idx = Math.min(
      n - 1,
      Math.max(0, Math.floor((1 - this.landRatio) * n)),
    );
    return vals[idx];
  }

  /** Rasterize the map at the given resolution into packed terrain bytes. */
  rasterize(width: number, height: number): Raster {
    const key = `${width}x${height}`;
    const cached = this.rasterCache.get(key);
    if (cached !== undefined) return cached;

    const n = width * height;
    const land = new Uint8Array(n);
    const mag = new Uint8Array(n);
    const relief = new Float32Array(n);
    const landRelief: number[] = [];
    let numLandTiles = 0;

    // Pass 1: land/water classification + raw land relief.
    let idx = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const nx = (x + 0.5) / width;
        const ny = (y + 0.5) / height;
        const e = this.elevationAt(nx, ny);
        if (e > this.seaLevel) {
          land[idx] = 1;
          numLandTiles++;
          const r = this.reliefAt(nx, ny, e);
          relief[idx] = r;
          landRelief.push(r);
        }
        idx++;
      }
    }

    // Redistribute relief across the actual land tiles so every map uses the
    // full plains -> highland -> mountain range (raw fBm alone clusters near
    // its mean and reads as all-plains). Anchor to the 2nd/98th percentiles so
    // a few outliers don't flatten everything.
    if (landRelief.length > 0) {
      const sorted = Float64Array.from(landRelief).sort();
      const lo = sorted[Math.floor(0.02 * (sorted.length - 1))];
      const hi = sorted[Math.floor(0.98 * (sorted.length - 1))];
      const span = hi - lo || 1;
      for (let i = 0; i < n; i++) {
        if (!land[i]) continue;
        let t = (relief[i] - lo) / span;
        if (t < 0) t = 0;
        else if (t > 1) t = 1;
        // Mild ease-in keeps plains dominant while still yielding real peaks.
        let m = Math.floor(t * (0.35 + 0.65 * t) * MAX_LAND_MAGNITUDE);
        if (m > MAX_LAND_MAGNITUDE) m = MAX_LAND_MAGNITUDE;
        mag[i] = m;
      }
    }

    // Carve rivers into the land (mutates `land`) before ocean/shore passes so
    // they classify as water automatically.
    numLandTiles -= this.carveRivers(width, height, land, relief);

    const ocean = this.floodOcean(width, height, land);
    const waterDist = this.waterDistance(width, height, land);
    const terrain = new Uint8Array(n);

    for (let i = 0; i < n; i++) {
      let b: number;
      if (land[i]) {
        b = IS_LAND | (mag[i] & MAGNITUDE_MASK);
      } else {
        const wm = Math.min(31, waterDist[i] >> 1);
        b = wm & MAGNITUDE_MASK;
        if (ocean[i]) b |= OCEAN;
      }
      terrain[i] = b;
    }
    this.applyShoreline(width, height, land, terrain);

    const raster: Raster = { terrain, numLandTiles, land };
    this.rasterCache.set(key, raster);
    return raster;
  }

  // Carve hydrologically-plausible rivers and return the number of tiles
  // converted from land to water. Uses priority-flood (Barnes et al.) to give
  // every land tile a downstream receiver with no pits, then flow accumulation:
  // tiles whose upstream catchment exceeds a threshold become river water.
  // Deterministic: the heap breaks ties by tile index.
  private carveRivers(
    width: number,
    height: number,
    land: Uint8Array,
    relief: Float32Array,
  ): number {
    const n = width * height;
    const WATER_H = -1e9;

    const receiver = new Int32Array(n).fill(-1);
    const filled = new Float64Array(n);
    const inQ = new Uint8Array(n);

    // Binary min-heap over (key = filled elevation, val = tile index).
    const hKey = new Float64Array(n);
    const hVal = new Int32Array(n);
    let hSize = 0;
    const less = (i: number, j: number): boolean =>
      hKey[i] < hKey[j] || (hKey[i] === hKey[j] && hVal[i] < hVal[j]);
    const swap = (i: number, j: number): void => {
      const k = hKey[i];
      hKey[i] = hKey[j];
      hKey[j] = k;
      const v = hVal[i];
      hVal[i] = hVal[j];
      hVal[j] = v;
    };
    const push = (key: number, val: number): void => {
      let i = hSize++;
      hKey[i] = key;
      hVal[i] = val;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (less(i, p)) {
          swap(i, p);
          i = p;
        } else break;
      }
    };
    const pop = (): number => {
      const root = hVal[0];
      hSize--;
      hKey[0] = hKey[hSize];
      hVal[0] = hVal[hSize];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = 2 * i + 2;
        let s = i;
        if (l < hSize && less(l, s)) s = l;
        if (r < hSize && less(r, s)) s = r;
        if (s === i) break;
        swap(i, s);
        i = s;
      }
      return root;
    };

    // Seed outlets: all water tiles and all map-border tiles (drain off-map).
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const border =
          x === 0 || y === 0 || x === width - 1 || y === height - 1;
        if ((!land[i] || border) && !inQ[i]) {
          filled[i] = land[i] ? relief[i] : WATER_H;
          inQ[i] = 1;
          push(filled[i], i);
        }
      }
    }

    // Priority-flood inward, recording land tiles in pop order (ascending fill).
    const order = new Int32Array(n);
    let oLen = 0;
    while (hSize > 0) {
      const c = pop();
      if (land[c]) order[oLen++] = c;
      const cx = c % width;
      const cy = (c - cx) / width;
      const cf = filled[c];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nb = ny * width + nx;
          if (!land[nb] || inQ[nb]) continue;
          filled[nb] = relief[nb] > cf ? relief[nb] : cf;
          receiver[nb] = c;
          inQ[nb] = 1;
          push(filled[nb], nb);
        }
      }
    }

    // Flow accumulation: each land tile contributes 1; add to receiver going
    // upstream-first (reverse of the ascending pop order).
    const accum = new Float64Array(n);
    for (let k = 0; k < oLen; k++) accum[order[k]] = 1;
    for (let k = oLen - 1; k >= 0; k--) {
      const t = order[k];
      const r = receiver[t];
      if (r >= 0 && land[r]) accum[r] += accum[t];
    }

    // Threshold scaled from full-res catchment to this LOD's tile area.
    const scale = (width * height) / (RANDOM_MAP_WIDTH * RANDOM_MAP_HEIGHT);
    const threshold = Math.max(2, this.riverCatchment * scale);

    // Candidate river tiles. Because accumulation only grows downstream, a
    // candidate's whole path to its mouth is also candidate — so candidates
    // form connected systems.
    const isCand = new Uint8Array(n);
    for (let k = 0; k < oLen; k++) {
      if (accum[order[k]] >= threshold) isCand[order[k]] = 1;
    }

    // Group candidates by outlet (the mouth each drains to) so tributaries of
    // one river count as a single system. outlet[] doubles as a memo with path
    // compression to keep this near-linear.
    const outlet = new Int32Array(n).fill(-1);
    const findOutlet = (start: number): number => {
      if (outlet[start] >= 0) return outlet[start];
      const path: number[] = [];
      let c = start;
      while (outlet[c] < 0) {
        const r = receiver[c];
        if (r >= 0 && land[r] && isCand[r]) {
          path.push(c);
          c = r;
        } else {
          outlet[c] = c; // mouth: drains to water/edge
          break;
        }
      }
      const root = outlet[c];
      for (const p of path) outlet[p] = root;
      return root;
    };

    const sizeByOutlet = new Map<number, number>();
    for (let k = 0; k < oLen; k++) {
      const t = order[k];
      if (!isCand[t]) continue;
      const o = findOutlet(t);
      sizeByOutlet.set(o, (sizeByOutlet.get(o) ?? 0) + 1);
    }

    // Keep only the N largest systems (N randomized per seed), so maps get a
    // few prominent rivers instead of the entire drainage network.
    const ranked = [...sizeByOutlet.keys()].sort(
      (a, b) =>
        (sizeByOutlet.get(b) ?? 0) - (sizeByOutlet.get(a) ?? 0) || a - b,
    );
    const keep = new Set(ranked.slice(0, this.riverCount));

    let carved = 0;
    for (let k = 0; k < oLen; k++) {
      const t = order[k];
      if (isCand[t] && keep.has(outlet[t])) {
        land[t] = 0;
        carved++;
      }
    }
    return carved;
  }

  // Flood water connected to the map edge = ocean; interior water = lake.
  private floodOcean(
    width: number,
    height: number,
    land: Uint8Array,
  ): Uint8Array {
    const n = width * height;
    const ocean = new Uint8Array(n);
    const stack: number[] = [];
    const pushIfWater = (i: number) => {
      if (!land[i] && !ocean[i]) {
        ocean[i] = 1;
        stack.push(i);
      }
    };
    for (let x = 0; x < width; x++) {
      pushIfWater(x);
      pushIfWater((height - 1) * width + x);
    }
    for (let y = 0; y < height; y++) {
      pushIfWater(y * width);
      pushIfWater(y * width + width - 1);
    }
    while (stack.length > 0) {
      const i = stack.pop()!;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0) pushIfWater(i - 1);
      if (x < width - 1) pushIfWater(i + 1);
      if (y > 0) pushIfWater(i - width);
      if (y < height - 1) pushIfWater(i + width);
    }
    return ocean;
  }

  // Multi-source BFS from all land tiles; water tiles get graph distance to
  // the nearest land (used for the depth-shaded water magnitude).
  private waterDistance(
    width: number,
    height: number,
    land: Uint8Array,
  ): Int32Array {
    const n = width * height;
    const dist = new Int32Array(n).fill(0x7fffffff);
    // Queue as a flat array with a head pointer (avoids shift() cost).
    const queue = new Int32Array(n);
    let head = 0;
    let tail = 0;
    for (let i = 0; i < n; i++) {
      if (land[i]) {
        dist[i] = 0;
        queue[tail++] = i;
      }
    }
    while (head < tail) {
      const i = queue[head++];
      const d = dist[i] + 1;
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && dist[i - 1] > d) {
        dist[i - 1] = d;
        queue[tail++] = i - 1;
      }
      if (x < width - 1 && dist[i + 1] > d) {
        dist[i + 1] = d;
        queue[tail++] = i + 1;
      }
      if (y > 0 && dist[i - width] > d) {
        dist[i - width] = d;
        queue[tail++] = i - width;
      }
      if (y < height - 1 && dist[i + width] > d) {
        dist[i + width] = d;
        queue[tail++] = i + width;
      }
    }
    // Fully-water map (no land): leave distances at 0.
    for (let i = 0; i < n; i++) {
      if (dist[i] === 0x7fffffff) dist[i] = 0;
    }
    return dist;
  }

  // A tile is shoreline if any cardinal neighbor is the opposite land/water
  // type. Out-of-bounds neighbors are treated as same-type (no border ring).
  private applyShoreline(
    width: number,
    height: number,
    land: Uint8Array,
    terrain: Uint8Array,
  ): void {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        const self = land[i];
        let shore = false;
        if (x > 0 && land[i - 1] !== self) shore = true;
        else if (x < width - 1 && land[i + 1] !== self) shore = true;
        else if (y > 0 && land[i - width] !== self) shore = true;
        else if (y < height - 1 && land[i + width] !== self) shore = true;
        if (shore) terrain[i] |= SHORELINE;
      }
    }
  }

  // Scatter well-spaced nation spawn points on land (full-resolution coords).
  private generateNations(): Nation[] {
    const { land } = this.rasterize(RANDOM_MAP_WIDTH, RANDOM_MAP_HEIGHT);
    const prng = new PseudoRandom((this.seed ^ 0x5bd1e995) | 0);
    const count = this.nationCount;
    const nations: Nation[] = [];
    const chosen: Array<[number, number]> = [];
    // Minimum spacing scales with available land area per nation.
    const area = RANDOM_MAP_WIDTH * RANDOM_MAP_HEIGHT;
    const spacing = Math.floor(Math.sqrt(area / (count * 4)));
    const minDist2 = spacing * spacing;
    const maxAttempts = count * 300;
    let attempts = 0;
    while (nations.length < count && attempts < maxAttempts) {
      attempts++;
      const x = prng.nextInt(0, RANDOM_MAP_WIDTH);
      const y = prng.nextInt(0, RANDOM_MAP_HEIGHT);
      if (!land[y * RANDOM_MAP_WIDTH + x]) continue;
      let ok = true;
      for (const [cx, cy] of chosen) {
        const dx = cx - x;
        const dy = cy - y;
        if (dx * dx + dy * dy < minDist2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      chosen.push([x, y]);
      nations.push({
        name: `Nation ${nations.length + 1}`,
        coordinates: [x, y],
      });
    }
    return nations;
  }

  /** Full manifest for all three LODs plus scattered nation spawns. */
  manifest(): MapManifest {
    const full = this.rasterize(RANDOM_MAP_WIDTH, RANDOM_MAP_HEIGHT);
    const w4 = RANDOM_MAP_WIDTH >> 1;
    const h4 = RANDOM_MAP_HEIGHT >> 1;
    const w16 = RANDOM_MAP_WIDTH >> 2;
    const h16 = RANDOM_MAP_HEIGHT >> 2;
    const mid = this.rasterize(w4, h4);
    const small = this.rasterize(w16, h16);
    return {
      name: "Random",
      map: {
        width: RANDOM_MAP_WIDTH,
        height: RANDOM_MAP_HEIGHT,
        num_land_tiles: full.numLandTiles,
      },
      map4x: { width: w4, height: h4, num_land_tiles: mid.numLandTiles },
      map16x: { width: w16, height: h16, num_land_tiles: small.numLandTiles },
      nations: this.generateNations(),
      additionalNations: [],
    };
  }

  /** Packed terrain bytes for a given LOD ("full" | "4x" | "16x"). */
  terrainBin(lod: "full" | "4x" | "16x"): Uint8Array {
    switch (lod) {
      case "full":
        return this.rasterize(RANDOM_MAP_WIDTH, RANDOM_MAP_HEIGHT).terrain;
      case "4x":
        return this.rasterize(RANDOM_MAP_WIDTH >> 1, RANDOM_MAP_HEIGHT >> 1)
          .terrain;
      case "16x":
        return this.rasterize(RANDOM_MAP_WIDTH >> 2, RANDOM_MAP_HEIGHT >> 2)
          .terrain;
    }
  }
}
