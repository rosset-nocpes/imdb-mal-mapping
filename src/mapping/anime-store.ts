import type { Anime, Entry, Index, Match } from "../types.js";

/** The dataset with its lookup tables: MAL id → entry, IMDb id → entries. */
export class AnimeStore {
  readonly hash: string;
  readonly builtAt: string;
  readonly count: number;
  readonly #anime: Record<string, Anime>;
  readonly #byImdb = new Map<string, Anime[]>();

  constructor(index: Index) {
    this.hash = index.hash;
    this.builtAt = index.builtAt;
    this.count = index.count;
    this.#anime = index.anime;

    for (const anime of Object.values(index.anime)) {
      for (const id of anime.imdbIds ?? [anime.imdbId]) {
        const list = this.#byImdb.get(id) ?? [];
        list.push(anime);
        this.#byImdb.set(id, list);
      }
    }
    for (const list of this.#byImdb.values()) {
      list.sort(
        (a, b) =>
          (a.season ?? 1e9) - (b.season ?? 1e9) ||
          (a.episodeOffset ?? 0) - (b.episodeOffset ?? 0) ||
          AnimeStore.watchOrder(a, b),
      );
    }
  }

  /** Order inside one TVDB series by season/offset, across series by air date. */
  static watchOrder(a: Anime, b: Anime): number {
    if (
      a.tvdbId &&
      a.tvdbId === b.tvdbId &&
      a.season !== undefined &&
      b.season !== undefined
    ) {
      return (
        a.season - b.season || (a.episodeOffset ?? 0) - (b.episodeOffset ?? 0)
      );
    }
    return (
      (a.year ?? 9999) - (b.year ?? 9999) ||
      (a.quarter ?? 0) - (b.quarter ?? 0) ||
      a.malId - b.malId
    );
  }

  /** IMDb titles with at least one MAL entry. */
  get imdbCount(): number {
    return this.#byImdb.size;
  }

  get(malId: number): Anime | undefined {
    return this.#anime[malId];
  }

  /** Every MAL entry on an IMDb title, in season order. */
  series(imdbId: string): readonly Anime[] {
    return this.#byImdb.get(imdbId) ?? [];
  }

  /** Where the next entry of the same season starts, if any. */
  episodeEnd(entry: Anime): number | undefined {
    if (entry.season === undefined) return undefined;
    const offset = entry.episodeOffset ?? 0;
    let end: number | undefined;
    for (const other of this.series(entry.imdbId)) {
      const otherOffset = other.episodeOffset ?? 0;
      if (
        other.season === entry.season &&
        otherOffset > offset &&
        (end === undefined || otherOffset < end)
      ) {
        end = otherOffset;
      }
    }
    return end;
  }

  entry(malId: number): Entry | undefined {
    const anime = this.get(malId);
    return anime && { ...anime, episodeEnd: this.episodeEnd(anime) };
  }

  matches(imdbId: string): Match[] {
    return this.series(imdbId).map((anime) => ({
      malId: anime.malId,
      season: anime.season,
      episodeOffset: anime.episodeOffset,
      episodeEnd: this.episodeEnd(anime),
      episodes: anime.episodes,
      title: anime.title,
      type: anime.type,
      year: anime.year,
    }));
  }
}
