/**
 * The mapping without the bundled dataset, for callers bringing their own
 * index (same shape; see scripts/build-index.ts).
 */
export { AnimeMapping, type MappingOptions } from "./mapping/anime-mapping.js";
export { DEFAULT_COSTS, type CostWeights } from "./resolver/cost-model.js";
export type {
  Confidence,
  ContextSeason,
  Placement,
  Resolution,
  ResolveInput,
  SeasonGroup,
} from "./resolver/types.js";
export type { Anime, Entry, Index, Match } from "./types.js";
