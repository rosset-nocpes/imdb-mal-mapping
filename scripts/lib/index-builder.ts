import { createHash } from "node:crypto";
import { SCHEMA_VERSION } from "../../src/remote/dataset-client.js";
import type { Anime, Index } from "../../src/types.js";
import type { WikidataEntry } from "./wikidata-source.js";

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
  synonyms: string[];
  relatedAnime: string[];
  /** Length of an episode. */
  duration?: { value?: number; unit?: string };
};

/** Corrections keyed by MAL id; `null` removes the entry, `$`-keys are comments. */
export type Overrides = Record<string, Partial<Anime> | null | string>;

/** An id found for a MAL entry Fribb lacks, by Wikidata or a TMDB match. */
export type Found = Pick<
  Anime,
  | "malId"
  | "imdbId"
  | "imdbIds"
  | "season"
  | "tmdbId"
  | "tmdbType"
  | "tmdbSeason"
> & { source: "wikidata" | "tmdb" };

/** A MAL entry of the offline database, with its MAL id. */
export type Listed = ManamiEntry & { malId: number };

const QUARTERS = ["WINTER", "SPRING", "SUMMER", "FALL"];

/**
 * Titles of extras aired alongside a show: specials, recaps, minis. They are
 * never one of its seasons, even when they air as one starts.
 */
export const EXTRA =
  /\b(?:specials?|recaps?|mini(?:\s+anime)?|extras?|omake|picture\s+drama|pv|cm|digest|soushuuhen|fanwai|tokubetsu-hen|bangai-hen)\b/i;

/**
 * Merges the sources into the dataset:
 *  - Fribb/anime-lists: MAL <-> IMDb/TVDB/TMDB ids, TVDB/TMDB season + episode offset
 *  - manami-project/anime-offline-database (ODbL): titles, type, episode counts, air season
 *  - Wikidata (CC0): IMDb ids of MAL entries Fribb lacks, seasons by ordinal
 *  - TMDB matches (scripts/lib/tmdb-source.ts) for the rest, added with `add`
 *  - overrides: hand-made corrections, applied last
 */
export class IndexBuilder {
  readonly #entries: FribbEntry[];
  readonly #overrides: Overrides;
  readonly #wikidata: WikidataEntry[];
  readonly #found: Found[] = [];
  readonly #meta = new Map<number, ManamiEntry>();
  /** How many entries use each IMDb id. */
  readonly #usage = new Map<string, number>();
  /** IMDb ids seen per TVDB/TMDB series, with counts. */
  readonly #bySeries = new Map<string, Map<string, number>>();

  constructor(
    fribb: FribbEntry[],
    manami: ManamiEntry[],
    overrides: Overrides,
    wikidata: WikidataEntry[] = [],
  ) {
    this.#entries = fribb.filter((entry) => entry.mal_id);
    this.#overrides = overrides;
    this.#wikidata = wikidata;
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

  /** Adds ids found for entries the sources lack; earlier ones win. */
  add(found: Iterable<Found>): this {
    this.#found.push(...found);
    return this;
  }

  /** Listed entries of these types that the dataset so far has no id for. */
  unmapped(types: readonly string[]): Listed[] {
    const anime = this.#mapped();
    const unmapped: Listed[] = [];
    for (const [malId, meta] of this.#meta) {
      if (!anime[malId] && types.includes(meta.type)) {
        unmapped.push({ ...meta, malId });
      }
    }
    return unmapped;
  }

  /** Every entry of the offline database, by MAL id. */
  listed(): Map<number, Listed> {
    return new Map(
      [...this.#meta].map(([malId, meta]) => [malId, { ...meta, malId }]),
    );
  }

  /** The entries mapped so far, overrides not applied. */
  mapped(): Readonly<Record<string, Anime>> {
    return this.#mapped();
  }

  build(builtAt = new Date().toISOString()): Index {
    const anime = this.#mapped();
    this.#applyOverrides(anime);
    return {
      schema: SCHEMA_VERSION,
      hash: IndexBuilder.hash(anime),
      builtAt,
      count: Object.keys(anime).length,
      anime,
    };
  }

  /** Ignores the build time, so unchanged data keeps its hash. */
  static hash(anime: Index["anime"]): string {
    return createHash("sha256")
      .update(JSON.stringify(anime))
      .digest("hex")
      .slice(0, 16);
  }

  #mapped(): Record<string, Anime> {
    const anime: Record<string, Anime> = {};
    for (const entry of this.#entries) {
      const built = this.#anime(entry);
      if (built) anime[built.malId] = built;
    }
    const seasons = new SeasonIndex(Object.values(anime));
    const found = [
      ...this.#wikidata.map((entry) => this.#fromWikidata(entry)),
      ...this.#found,
    ];
    for (const entry of found) {
      if (!entry || anime[entry.malId]) continue;
      const built = this.#place(entry, seasons);
      if (built) {
        anime[built.malId] = built;
        seasons.add(built);
      }
    }
    return anime;
  }

  /**
   * A season of a series when Wikidata numbers it (shows only: a special
   * filed under its series would play the series), else the item's own id.
   */
  #fromWikidata(entry: WikidataEntry): Found | undefined {
    const meta = this.#meta.get(entry.malId);
    const type = meta?.type;
    if (!type) return undefined;
    const seasons = entry.series.filter((series) => series.season);
    const distinct = new Set(
      seasons.map((series) => `${series.imdbId}:${series.season}`),
    );
    const [series] = seasons;
    if (
      (type === "TV" || type === "ONA") &&
      series &&
      distinct.size === 1 &&
      !EXTRA.test(meta.title)
    ) {
      const own = entry.imdbIds.filter((id) => id !== series.imdbId);
      return {
        malId: entry.malId,
        imdbId: series.imdbId,
        imdbIds: own.length ? [series.imdbId, ...own] : undefined,
        season: series.season,
        source: "wikidata",
      };
    }
    const [imdbId, ...others] = entry.imdbIds;
    if (!imdbId || others.length) return undefined;
    return {
      malId: entry.malId,
      imdbId,
      season: type === "MOVIE" ? undefined : 1,
      source: "wikidata",
    };
  }

  /**
   * Builds a found entry, starting its episodes after the entries already
   * in its season. Unless it aired after all of them and their episode
   * counts are known, where it starts is a guess, so it is left out.
   */
  #place(found: Found, seasons: SeasonIndex): Anime | undefined {
    const info = this.#meta.get(found.malId);
    const quarter = QUARTERS.indexOf(info?.animeSeason?.season ?? "");
    const anime: Anime = {
      ...found,
      title: info?.title,
      type: info?.type,
      episodes: info?.episodes || undefined,
      airing:
        info?.status === "ONGOING" || info?.status === "UPCOMING" || undefined,
      year: info?.animeSeason?.year || undefined,
      quarter: quarter >= 0 ? quarter + 1 : undefined,
    };
    const before = seasons.of(anime);
    if (before.length) {
      const aired = IndexBuilder.#aired(anime);
      if (
        aired === undefined ||
        before.some(
          (other) =>
            other.episodes === undefined ||
            (IndexBuilder.#aired(other) ?? Infinity) >= aired,
        )
      ) {
        return undefined;
      }
      const offset = Math.max(
        ...before.map(
          (other) => (other.episodeOffset ?? 0) + (other.episodes ?? 0),
        ),
      );
      anime.episodeOffset = offset || undefined;
      if (anime.tmdbSeason !== undefined && anime.tmdbSeason === anime.season) {
        anime.tmdbEpisodeOffset = anime.episodeOffset;
      }
    }
    return IndexBuilder.#clean(anime);
  }

  /** Quarters since year 0, for ordering by air date. */
  static #aired(anime: Anime): number | undefined {
    return anime.year ? anime.year * 4 + (anime.quarter ?? 1) - 1 : undefined;
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
      tmdbType: entry.themoviedb_id?.tv
        ? ("tv" as const)
        : entry.themoviedb_id?.movie
          ? ("movie" as const)
          : undefined,
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

/** Entries by IMDb title and season, to place new ones after them. */
class SeasonIndex {
  readonly #seasons = new Map<string, Anime[]>();

  constructor(anime: Iterable<Anime>) {
    for (const entry of anime) this.add(entry);
  }

  add(anime: Anime): void {
    if (anime.season === undefined) return;
    for (const id of anime.imdbIds ?? [anime.imdbId]) {
      const key = `${id}:${anime.season}`;
      this.#seasons.set(key, [...(this.#seasons.get(key) ?? []), anime]);
    }
  }

  /** The entries already in `anime`'s season of its IMDb title. */
  of(anime: Anime): Anime[] {
    return anime.season === undefined
      ? []
      : (this.#seasons.get(`${anime.imdbId}:${anime.season}`) ?? []);
  }
}
