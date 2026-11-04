import type { Anime, Index } from "../../src/types.js";

export type FribbEntry = {
  type?: string;
  mal_id?: number;
  imdb_id?: string[];
  tvdb_id?: number;
  themoviedb_id?: { tv?: number; movie?: number | number[] };
  season?: { tvdb?: number; tmdb?: number };
  episode_offset?: { tvdb?: number; tmdb?: number };
};

export type ManamiEntry = {
  sources: string[];
  title: string;
  type: string;
  episodes: number;
  status?: string;
  animeSeason?: { season?: string; year?: number };
};

/** Corrections keyed by MAL id; `null` removes the entry, `$`-keys are comments. */
export type Overrides = Record<string, Partial<Anime> | null | string>;

const QUARTERS = ["WINTER", "SPRING", "SUMMER", "FALL"];

/**
 * Merges the sources into the dataset:
 *  - Fribb/anime-lists: MAL <-> IMDb/TVDB/TMDB ids, TVDB/TMDB season + episode offset
 *  - manami-project/anime-offline-database (ODbL): titles, type, episode counts, air season
 *  - overrides: hand-made corrections, applied last
 */
export class IndexBuilder {
  readonly #entries: FribbEntry[];
  readonly #overrides: Overrides;
  readonly #meta = new Map<number, ManamiEntry>();
  /** How many entries use each IMDb id. */
  readonly #usage = new Map<string, number>();
  /** IMDb ids seen per TVDB/TMDB series, with counts. */
  readonly #bySeries = new Map<string, Map<string, number>>();

  constructor(
    fribb: FribbEntry[],
    manami: ManamiEntry[],
    overrides: Overrides,
  ) {
    this.#entries = fribb.filter((entry) => entry.mal_id);
    this.#overrides = overrides;
    for (const entry of manami) {
      for (const source of entry.sources) {
        const malId = Number(
          source.match(/myanimelist\.net\/anime\/(\d+)/)?.[1],
        );
        if (malId) this.#meta.set(malId, entry);
      }
    }
    for (const entry of this.#entries) {
      const ids = IndexBuilder.#imdbIds(entry);
      for (const id of ids) this.#usage.set(id, (this.#usage.get(id) ?? 0) + 1);
      // Series ids let entries without an IMDb id inherit their show's.
      for (const key of IndexBuilder.#seriesKeys(entry)) {
        const counts = this.#bySeries.get(key) ?? new Map<string, number>();
        for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        this.#bySeries.set(key, counts);
      }
    }
  }

  build(builtAt = new Date().toISOString()): Index {
    const anime: Record<string, Anime> = {};
    for (const entry of this.#entries) {
      const built = this.#anime(entry);
      if (built) anime[built.malId] = built;
    }
    this.#applyOverrides(anime);
    return { builtAt, count: Object.keys(anime).length, anime };
  }

  #anime(entry: FribbEntry): Anime | undefined {
    const malId = entry.mal_id!;
    let ids = IndexBuilder.#imdbIds(entry);
    let source: Anime["source"] = "fribb";
    if (!ids.length && entry.season?.tvdb !== undefined) {
      const inherited = this.#seriesImdbId(entry);
      if (inherited) {
        ids = [inherited];
        source = "inferred";
      }
    }
    const primary = IndexBuilder.#mostCommon(this.#usage, ids);
    if (!primary) return undefined;

    const info = this.#meta.get(malId);
    const quarter = QUARTERS.indexOf(info?.animeSeason?.season ?? "");
    return IndexBuilder.#clean({
      malId,
      imdbId: primary,
      imdbIds:
        ids.length > 1
          ? [primary, ...ids.filter((id) => id !== primary)]
          : undefined,
      title: info?.title,
      type: info?.type ?? entry.type,
      episodes: info?.episodes || undefined,
      airing:
        info?.status === "ONGOING" || info?.status === "UPCOMING" || undefined,
      year: info?.animeSeason?.year || undefined,
      quarter: quarter >= 0 ? quarter + 1 : undefined,
      season: entry.season?.tvdb,
      episodeOffset: entry.episode_offset?.tvdb || undefined,
      tvdbId: entry.tvdb_id,
      tmdbId: entry.themoviedb_id?.tv ?? [entry.themoviedb_id?.movie].flat()[0],
      tmdbSeason: entry.season?.tmdb,
      tmdbEpisodeOffset: entry.episode_offset?.tmdb || undefined,
      source,
    });
  }

  #seriesImdbId(entry: FribbEntry): string | undefined {
    for (const key of IndexBuilder.#seriesKeys(entry)) {
      const counts = this.#bySeries.get(key);
      if (counts?.size)
        return IndexBuilder.#mostCommon(counts, [...counts.keys()]);
    }
    return undefined;
  }

  #applyOverrides(anime: Record<string, Anime>): void {
    for (const [key, override] of Object.entries(this.#overrides)) {
      if (key.startsWith("$") || typeof override === "string") continue;
      if (override === null) {
        delete anime[key];
        continue;
      }
      const malId = Number(key);
      const base = anime[key] ?? { malId, title: this.#meta.get(malId)?.title };
      anime[key] = IndexBuilder.#clean({
        ...base,
        ...override,
        malId,
        source: "manual",
      } as Anime);
    }
  }

  static #imdbIds(entry: FribbEntry): string[] {
    return (entry.imdb_id ?? []).filter((id) => /^tt\d{7,}$/.test(id));
  }

  static #seriesKeys(entry: FribbEntry): string[] {
    const keys: string[] = [];
    if (entry.tvdb_id) keys.push(`tvdb:${entry.tvdb_id}`);
    if (entry.themoviedb_id?.tv) keys.push(`tmdb:${entry.themoviedb_id.tv}`);
    return keys;
  }

  /** The id shared by the most entries: the series, not a one-off season page. */
  static #mostCommon(
    counts: Map<string, number>,
    candidates: string[],
  ): string | undefined {
    return candidates.toSorted(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0),
    )[0];
  }

  static #clean<T extends object>(value: T): T {
    return Object.fromEntries(
      Object.entries(value).filter(([, v]) => v !== undefined && v !== null),
    ) as T;
  }
}
