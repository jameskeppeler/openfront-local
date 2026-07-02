import { simpleHash } from "../Util";
import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";
import { ProceduralMap, ProceduralMapOptions } from "./ProceduralMapGenerator";

// GameMapLoader that synthesizes terrain in-memory from a seed instead of
// fetching baked .bin files. Used for GameMapType.Random. Because generation
// is deterministic, every client that constructs this loader with the same
// seed produces an identical map (see ProceduralMapGenerator).
export class ProceduralGameMapLoader implements GameMapLoader {
  private readonly map: ProceduralMap;

  constructor(seed: number, options?: Partial<ProceduralMapOptions>) {
    this.map = new ProceduralMap(seed | 0, options);
  }

  getMapData(_map: GameMapType): MapData {
    return {
      mapBin: () => Promise.resolve(this.map.terrainBin("full")),
      map4xBin: () => Promise.resolve(this.map.terrainBin("4x")),
      map16xBin: () => Promise.resolve(this.map.terrainBin("16x")),
      manifest: () => Promise.resolve(this.map.manifest()),
      webpPath: "",
    };
  }
}

// Returns the procedural loader (seeded identically on every client) when the
// selected map is GameMapType.Random, otherwise the provided fetch-based base
// loader. Seed = the locked mapSeed, or a hash of gameID for "fully random".
export function selectMapLoader(
  base: GameMapLoader,
  gameMap: GameMapType,
  mapSeed: number | null | undefined,
  gameID: string,
): GameMapLoader {
  if (gameMap === GameMapType.Random) {
    return new ProceduralGameMapLoader(mapSeed ?? simpleHash(gameID));
  }
  return base;
}
