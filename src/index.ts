import { ImdbMalMapping } from "./mapping/imdb-mal-mapping.js";
import type { Resolution, ResolveInput } from "./resolver/types.js";
import type { Entry, Match } from "./types.js";

export { ImdbMalMapping };
export * from "./core.js";

/** One MAL entry with its IMDb id, season and episode range (bundled dataset). */
export function byMal(malId: number): Entry | undefined {
  return ImdbMalMapping.getInstance().byMal(malId);
}

/** Every MAL entry on an IMDb title, in season order (bundled dataset). */
export function byImdb(imdbId: string): Match[] {
  return ImdbMalMapping.getInstance().byImdb(imdbId);
}

/** Where a MAL entry sits in a provider's own season layout (bundled dataset). */
export function resolve(input: ResolveInput): Resolution | null {
  return ImdbMalMapping.getInstance().resolve(input);
}
