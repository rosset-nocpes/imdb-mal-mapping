import type { ContextSeason } from "./types.js";

/** One provider season: the lowest and highest episode number present. */
export type ProviderSeason = { season: number; min: number; max: number };

/** A provider's seasons for a title, one per season number, in order. */
export class ProviderLayout {
  private constructor(readonly seasons: readonly ProviderSeason[]) {}

  /** Merges repeated seasons (one per dub team): teams of a title share numbering. */
  static from(input: readonly ContextSeason[]): ProviderLayout {
    const seasons = new Map<number, ProviderSeason>();
    for (const { season, episodes } of input) {
      if (!Number.isInteger(season)) continue;
      const numbers = ProviderLayout.#episodeNumbers(episodes);
      if (!numbers.length) continue;
      const current = seasons.get(season);
      seasons.set(season, {
        season,
        min: Math.min(...numbers, current?.min ?? Infinity),
        max: Math.max(...numbers, current?.max ?? 0),
      });
    }
    return new ProviderLayout(
      [...seasons.values()].toSorted((a, b) => a.season - b.season),
    );
  }

  static #episodeNumbers(episodes: ContextSeason["episodes"]): number[] {
    if (typeof episodes === "number")
      return episodes >= 1 ? [1, Math.floor(episodes)] : [];
    return episodes.filter((n) => Number.isInteger(n) && n >= 1);
  }

  get length(): number {
    return this.seasons.length;
  }

  at(index: number): ProviderSeason {
    return this.seasons[index] as ProviderSeason;
  }
}
