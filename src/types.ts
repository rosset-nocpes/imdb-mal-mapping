export type Anime = {
  malId: number;
  /** The series' IMDb id (the one shared with the rest of the franchise). */
  imdbId: string;
  /** Every known IMDb id, primary first. Only present when there are several. */
  imdbIds?: string[];
  title?: string;
  type?: string;
  /** MAL episode count; absent while unknown. While airing it may only count aired episodes. */
  episodes?: number;
  /** Still airing or upcoming: `episodes` is a lower bound. */
  airing?: true;
  year?: number;
  /** 1 = winter … 4 = fall. */
  quarter?: number;
  /** IMDb/TVDB season number. 0 = specials. Absent for movies. */
  season?: number;
  /** The entry starts after this episode of `season`. */
  episodeOffset?: number;
  tvdbId?: number;
  tmdbId?: number;
  tmdbSeason?: number;
  tmdbEpisodeOffset?: number;
  /** fribb: listed; inferred: IMDb id taken from the TVDB/TMDB series; manual: overrides.json. */
  source: "fribb" | "inferred" | "manual";
};

/** A MAL entry as returned by lookups. */
export type Entry = Anime & {
  /** Last episode of `season` this entry covers, when a later entry continues the season. */
  episodeEnd?: number;
};

/** A MAL entry as listed under an IMDb title. */
export type Match = Pick<
  Entry,
  | "malId"
  | "season"
  | "episodeOffset"
  | "episodeEnd"
  | "episodes"
  | "title"
  | "type"
  | "year"
>;

/** The dataset, as built by scripts/build-index.ts. */
export type Index = Manifest & {
  anime: Record<string, Anime>;
};

/** The dataset without its entries: what `manifest.json` holds. */
export type Manifest = {
  /** Dataset format version; this release reads `SCHEMA_VERSION`. */
  schema: number;
  /** Content hash of `anime`; changes only when the data does. */
  hash: string;
  /** When the dataset was built (ISO 8601). */
  builtAt: string;
  count: number;
};
