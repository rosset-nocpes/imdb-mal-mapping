/* oxlint-disable no-await-in-loop -- requests are paced and retried in turn,
   and an entry's searches stop at the first match. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Anime } from "../../src/types.js";
import { EXTRA, type Found, type Listed } from "./index-builder.js";
import { USER_AGENT } from "./source-downloader.js";

/**
 * Matches MAL entries the other sources lack to TMDB, for their IMDb id:
 *  - by title: one of the entry's titles or synonyms (from the offline
 *    database) is one of the TMDB show's or film's names or alternative
 *    titles, the genre is animation and the year fits;
 *  - by relation: a related entry is mapped to a TMDB show that has a
 *    season airing when this entry did (a new season the lists lag behind).
 * A show's season is the one airing in the entry's year and quarter.
 * Results are cached between builds; misses are retried sooner than hits.
 */

const API = "https://api.themoviedb.org/3";
const ANIMATION = 16;
/** Search results whose titles are compared, per query. */
const CHECKED = 3;
const MAX_QUERIES = 3;
const CONCURRENCY = 8;
/** TMDB allows about 50 requests a second. */
const REQUEST_INTERVAL_MS = 25;
const DAY = 24 * 60 * 60 * 1000;
const RECHECK = { found: 90 * DAY, missed: 28 * DAY, airing: 7 * DAY };

/**
 * Bump when the matching rules change: entries checked under older rules
 * are looked up again (when a token allows it).
 */
export const RULES = 2;

export type TmdbCache = {
  schema: 1;
  /** The `RULES` the entries were checked under. */
  rules?: number;
  entries: Record<string, { checkedAt: string; found: Found | null }>;
};

type Season = { season_number?: number; air_date?: string | null };

type Show = {
  id: number;
  kind: "tv" | "movie";
  imdbId?: string;
  year?: number;
  titles: string[];
  seasons: Season[];
};

type SearchResult = {
  id?: number;
  genre_ids?: number[];
  first_air_date?: string;
  release_date?: string;
};

/** Compares titles across catalogues: case, accents, punctuation, ō/ou. */
export function titleKey(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replaceAll("×", "x")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/ou/g, "o")
    .replace(/uu/g, "u");
}

/** Short keys ("SAO", "K") name too many things; CJK titles are dense. */
const usableKey = (key: string) =>
  key.length >= 4 ||
  (key.length >= 2 &&
    /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(
      key,
    ));

const SEASON_MARKER =
  /[\s:,.-]+(?:(?:the\s+)?final\s+season|season\s*\d+|\d+(?:st|nd|rd|th)\s+season|(?:part|cour)\s*\d+|\d+(?:st|nd|rd|th)\s+(?:part|cour))(?=\s*(?:[:–-]\s|$))/iu;
const SEASON_NUMBER = /[\s:,.-]+(?:[2-9]|ii|iii|iv|v|vi|vii|viii|ix|x)$/iu;

/** The title without its season marker: "Kingdom 5th Season" → "Kingdom". */
export function seriesTitle(title: string): string | undefined {
  let base = title;
  for (let previous = ""; previous !== base;) {
    previous = base;
    const marker = base.match(SEASON_MARKER);
    base = (
      marker ? base.slice(0, marker.index) : base.replace(SEASON_NUMBER, "")
    ).trim();
  }
  return base.length >= 3 && base !== title ? base : undefined;
}

const QUARTERS = ["WINTER", "SPRING", "SUMMER", "FALL"];

/** Quarters since year 0 of a date ("2026-08-02") or an entry's season. */
function quarterOf(date?: string | null): number | undefined {
  const [year, month] = (date ?? "").split("-").map(Number);
  return year && month ? year * 4 + Math.floor((month - 1) / 3) : undefined;
}

function airedQuarter(entry: Listed): number | undefined {
  const year = entry.animeSeason?.year;
  const quarter = QUARTERS.indexOf(entry.animeSeason?.season ?? "");
  return year && quarter >= 0 ? year * 4 + quarter : undefined;
}

/**
 * The show's season airing when the entry did: the one starting in its
 * quarter, else the only one starting in its year.
 */
export function seasonAiring(
  seasons: Season[],
  entry: Listed,
): number | undefined {
  const numbered = seasons.filter(
    (season) => season.season_number && season.season_number >= 1,
  );
  const quarter = airedQuarter(entry);
  const inQuarter = numbered.filter(
    (season) => quarter !== undefined && quarterOf(season.air_date) === quarter,
  );
  if (inQuarter.length === 1) return inQuarter[0]!.season_number;
  if (inQuarter.length > 1) return undefined;
  const year = entry.animeSeason?.year;
  const inYear = numbered.filter(
    (season) => year && season.air_date?.startsWith(`${year}-`),
  );
  return inYear.length === 1 ? inYear[0]!.season_number : undefined;
}

class TmdbClient {
  readonly #token: string;
  readonly #shows = new Map<string, Promise<Show | undefined>>();
  #next = 0;
  requests = 0;

  constructor(token: string) {
    this.#token = token;
  }

  async search(kind: "tv" | "movie", query: string): Promise<SearchResult[]> {
    const data = await this.#get<{ results?: SearchResult[] }>(
      `/search/${kind}`,
      { query, include_adult: "false" },
    );
    return (data?.results ?? []).filter((result) =>
      result.genre_ids?.includes(ANIMATION),
    );
  }

  show(kind: "tv" | "movie", id: number): Promise<Show | undefined> {
    const key = `${kind}/${id}`;
    let show = this.#shows.get(key);
    if (!show) {
      show = this.#fetchShow(kind, id);
      this.#shows.set(key, show);
    }
    return show;
  }

  async #fetchShow(kind: "tv" | "movie", id: number) {
    const data = await this.#get<{
      name?: string;
      original_name?: string;
      title?: string;
      original_title?: string;
      first_air_date?: string;
      release_date?: string;
      imdb_id?: string | null;
      genres?: Array<{ id?: number }>;
      seasons?: Season[];
      external_ids?: { imdb_id?: string | null };
      alternative_titles?: {
        results?: Array<{ title?: string }>;
        titles?: Array<{ title?: string }>;
      };
    }>(`/${kind}/${id}`, {
      append_to_response:
        kind === "tv"
          ? "alternative_titles,external_ids"
          : "alternative_titles",
    });
    if (!data?.genres?.some((genre) => genre.id === ANIMATION))
      return undefined;
    const imdbId = data.imdb_id ?? data.external_ids?.imdb_id ?? undefined;
    return {
      id,
      kind,
      imdbId: imdbId && /^tt\d{7,}$/.test(imdbId) ? imdbId : undefined,
      year:
        Number((data.first_air_date ?? data.release_date)?.slice(0, 4)) ||
        undefined,
      titles: [
        data.name,
        data.original_name,
        data.title,
        data.original_title,
        ...(
          data.alternative_titles?.results ??
          data.alternative_titles?.titles ??
          []
        ).map((alternative) => alternative.title),
      ].filter((title): title is string => Boolean(title)),
      seasons: data.seasons ?? [],
    };
  }

  /** Paced and retried: TMDB answers bursts with 429s. */
  async #get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T | undefined> {
    const url = `${API}${path}?${new URLSearchParams(params)}`;
    for (let attempt = 0; ; attempt++) {
      const wait = Math.max(0, this.#next - Date.now());
      this.#next = Math.max(this.#next, Date.now()) + REQUEST_INTERVAL_MS;
      if (wait) await Bun.sleep(wait);
      this.requests++;
      const response = await fetch(url, {
        headers: {
          authorization: `Bearer ${this.#token}`,
          accept: "application/json",
          "user-agent": USER_AGENT,
        },
      }).catch(() => undefined);
      if (response?.ok) return (await response.json()) as T;
      if (response?.status === 404) return undefined;
      if (attempt >= 4) {
        throw new Error(`TMDB ${path}: ${response?.status ?? "network error"}`);
      }
      const retryAfter = Number(response?.headers.get("retry-after"));
      await Bun.sleep((retryAfter || 2 ** attempt) * 1000);
    }
  }
}

export class TmdbMatcher {
  readonly #client: TmdbClient | undefined;
  readonly #cache: TmdbCache;
  readonly #now: number;

  constructor(token: string | undefined, cache: TmdbCache, now = Date.now()) {
    this.#client = token ? new TmdbClient(token) : undefined;
    this.#cache = cache;
    this.#now = now;
  }

  static async loadCache(path: string): Promise<TmdbCache> {
    try {
      const cache = JSON.parse(await readFile(path, "utf8")) as TmdbCache;
      if (cache.schema === 1) return cache;
    } catch {
      // No cache yet.
    }
    return { schema: 1, entries: {} };
  }

  async saveCache(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const entries = Object.fromEntries(
      Object.entries(this.#cache.entries).toSorted(
        ([a], [b]) => Number(a) - Number(b),
      ),
    );
    await writeFile(
      path,
      `${JSON.stringify({
        schema: 1,
        // Without a token nothing was rechecked under the current rules.
        rules: this.#client ? RULES : this.#cache.rules,
        entries,
      })}\n`,
    );
  }

  get requests(): number {
    return this.#client?.requests ?? 0;
  }

  /**
   * Matches the unmapped entries; `mapped` is the dataset so far, `listed`
   * every entry of the offline database (for relations and durations).
   */
  async match(
    unmapped: Listed[],
    mapped: Readonly<Record<string, Anime>>,
    listed: ReadonlyMap<number, Listed>,
  ): Promise<Found[]> {
    const known = new Map<number, Found | Anime>(
      Object.values(mapped).map((anime) => [anime.malId, anime]),
    );
    const found = new Map<number, Found>();
    const record = (entry: Listed, match: Found | undefined) => {
      if (match) {
        found.set(entry.malId, match);
        known.set(entry.malId, match);
      }
    };

    const pending: Listed[] = [];
    for (const entry of unmapped) {
      const cached = this.#cache.entries[entry.malId];
      if (cached && (!this.#client || !this.#stale(cached, entry))) {
        record(entry, cached.found ?? undefined);
      } else if (this.#client) {
        pending.push(entry);
      }
    }

    // Titles first, so relations can lead to the shows they found.
    const byTitle = await this.#each(pending, (entry) => this.#byTitle(entry));
    const rest = pending.filter((entry, index) => {
      const candidate = byTitle[index];
      const match = candidate && settle(entry, candidate, known, listed, false);
      record(entry, match);
      return !match && (entry.type === "TV" || entry.type === "ONA");
    });
    const byRelation = await this.#each(rest, (entry) =>
      this.#byRelation(entry, known),
    );
    rest.forEach((entry, index) => {
      const candidate = byRelation[index];
      record(entry, candidate && settle(entry, candidate, known, listed, true));
    });

    const checkedAt = new Date(this.#now).toISOString();
    for (const entry of pending) {
      this.#cache.entries[entry.malId] = {
        checkedAt,
        found: found.get(entry.malId) ?? null,
      };
    }
    return [...found.values()];
  }

  #stale(cached: TmdbCache["entries"][string], entry: Listed): boolean {
    if (this.#cache.rules !== RULES) return true;
    const age = this.#now - Date.parse(cached.checkedAt);
    const airing = entry.status === "ONGOING" || entry.status === "UPCOMING";
    return (
      age >
      (cached.found ? RECHECK.found : airing ? RECHECK.airing : RECHECK.missed)
    );
  }

  async #each<T>(
    entries: Listed[],
    match: (entry: Listed) => Promise<T | undefined>,
  ): Promise<Array<T | undefined>> {
    const results: Array<T | undefined> = [];
    let next = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (next < entries.length) {
          const index = next++;
          results[index] = await match(entries[index]!);
          if (++done % 500 === 0) {
            console.log(`TMDB: ${done}/${entries.length} checked`);
          }
        }
      }),
    );
    return results;
  }

  async #byTitle(entry: Listed): Promise<Candidate | undefined> {
    const client = this.#client!;
    const year = entry.animeSeason?.year;
    if (!year) return undefined;
    const kind = entry.type === "MOVIE" ? "movie" : "tv";
    const names = [entry.title, ...entry.synonyms];
    const keys = new Set(names.map(titleKey).filter(usableKey));

    // The romanised title, a native one and an English-looking one.
    const native = entry.synonyms.find((name) =>
      /\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}/u.test(
        name,
      ),
    );
    const english = entry.synonyms.find(
      (name) => /^[\x20-\x7e]+$/.test(name) && /\s/.test(name),
    );
    const queries = [...new Set([entry.title, english, native])]
      .filter((query): query is string => Boolean(query))
      .slice(0, MAX_QUERIES)
      .map((query) => ({ query, keys, sequel: false }));
    if (kind === "tv") {
      const base = seriesTitle(entry.title);
      if (base && usableKey(titleKey(base))) {
        queries.push({
          query: base,
          keys: new Set([titleKey(base)]),
          sequel: true,
        });
      }
    }

    for (const { query, keys: wanted, sequel } of queries) {
      for (const result of (await client.search(kind, query)).slice(
        0,
        CHECKED,
      )) {
        const resultYear = Number(
          (result.first_air_date ?? result.release_date)?.slice(0, 4),
        );
        if (!result.id || !resultYear) continue;
        if (sequel ? resultYear > year : Math.abs(resultYear - year) > 1)
          continue;
        const show = await client.show(kind, result.id);
        if (
          !show?.imdbId ||
          !show.titles.some((title) => wanted.has(titleKey(title)))
        ) {
          continue;
        }
        if (kind === "movie") {
          return {
            found: {
              malId: entry.malId,
              imdbId: show.imdbId,
              tmdbId: show.id,
              tmdbType: "movie",
              source: "tmdb",
            },
            dated: true,
          };
        }
        // A show of its own starts with the entry; a sequel needs its season.
        const dated = seasonAiring(show.seasons, entry);
        const season =
          dated ??
          (!sequel && Math.abs((show.year ?? 0) - year) <= 1 ? 1 : undefined);
        if (season === undefined || (sequel && season === 1)) continue;
        return {
          found: {
            malId: entry.malId,
            imdbId: show.imdbId,
            season,
            tmdbId: show.id,
            tmdbType: "tv",
            tmdbSeason: season,
            source: "tmdb",
          },
          dated: dated !== undefined,
        };
      }
    }
    return undefined;
  }

  /** A new season of the show a related entry is mapped to. */
  async #byRelation(
    entry: Listed,
    known: ReadonlyMap<number, Found | Anime>,
  ): Promise<Candidate | undefined> {
    const shows = new Set(
      entry.relatedAnime.flatMap((url) => {
        const anime = known.get(
          Number(url.match(/myanimelist\.net\/anime\/(\d+)/)?.[1]),
        );
        return anime?.tmdbType === "tv" && anime.tmdbId ? [anime.tmdbId] : [];
      }),
    );
    if (shows.size !== 1) return undefined;
    const [tmdbId] = shows;
    const show = await this.#client!.show("tv", tmdbId!);
    const season = show && seasonAiring(show.seasons, entry);
    if (!season || season === 1) return undefined;
    return {
      found: {
        malId: entry.malId,
        imdbId: "",
        season,
        tmdbId,
        tmdbType: "tv",
        tmdbSeason: season,
        source: "tmdb",
      },
      dated: true,
    };
  }
}

/** A match, and whether its season was found by air date. */
type Candidate = { found: Found; dated: boolean };

/**
 * Checks a show's season against the dataset's other entries on that show.
 * A show the dataset lacks is new to it (only a title match can say so).
 * On a show it has, the entry must be a season airing when it did, with
 * episodes about as long as the show's (a chibi spin-off airing alongside a
 * season is not that season), and TMDB must number the seasons as the
 * show's IMDb title does; the entry joins that IMDb title.
 */
function settle(
  entry: Listed,
  { found, dated }: Candidate,
  known: ReadonlyMap<number, Found | Anime>,
  listed: ReadonlyMap<number, Listed>,
  related: boolean,
): Found | undefined {
  if (found.tmdbType !== "tv") return found;
  if (EXTRA.test(entry.title)) return undefined;
  // Seasons proper: films and specials filed under a show keep their own ids.
  const seasons = [...known.values()].filter(
    (anime) =>
      anime.malId !== entry.malId &&
      anime.tmdbType === "tv" &&
      anime.tmdbId === found.tmdbId &&
      (anime.season ?? 0) >= 1 &&
      (anime.tmdbSeason ?? 0) >= 1,
  );
  if (!seasons.length) return related ? undefined : found;
  if (!dated) return undefined;

  const lengths = seasons
    .map((anime) => listed.get(anime.malId)?.duration?.value)
    .filter((value): value is number => Boolean(value))
    .toSorted((a, b) => a - b);
  const typical = lengths[Math.floor(lengths.length / 2)];
  const length = entry.duration?.value;
  if (!typical || !length || length < typical / 2 || length > typical * 2) {
    return undefined;
  }

  if (seasons.some((anime) => anime.season !== anime.tmdbSeason)) {
    return undefined;
  }
  const imdbIds = new Set(seasons.map((anime) => anime.imdbId));
  return imdbIds.size === 1
    ? { ...found, imdbId: [...imdbIds][0]! }
    : undefined;
}
