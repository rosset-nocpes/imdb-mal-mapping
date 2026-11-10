import { afterEach, describe, expect, test } from "bun:test";
import {
  type Found,
  IndexBuilder,
  type ManamiEntry,
} from "../scripts/lib/index-builder.js";
import {
  seasonAiring,
  seriesTitle,
  titleKey,
  TmdbMatcher,
} from "../scripts/lib/tmdb-source.js";
import { parseWikidata } from "../scripts/lib/wikidata-source.js";

const listed = (
  malId: number,
  fields: Partial<ManamiEntry> = {},
): ManamiEntry => ({
  sources: [`https://myanimelist.net/anime/${malId}`],
  title: `Anime ${malId}`,
  type: "TV",
  episodes: 12,
  synonyms: [],
  relatedAnime: [],
  animeSeason: { season: "SPRING", year: 2020 },
  duration: { value: 1440, unit: "SECONDS" },
  ...fields,
});

/** An entry that aired in this season of this year. */
const airing = (season: string, year: number) => ({
  ...listed(1, { animeSeason: { season, year } }),
  malId: 1,
});

const binding = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }]),
  );

describe("Wikidata", () => {
  test("groups an item's IMDb ids and series seasons by MAL id", () => {
    expect(
      parseWikidata([
        binding({ mal: "1", imdb: "tt0000001" }),
        binding({ mal: "2", seriesImdb: "tt0000009", ordinal: "3" }),
        binding({ mal: "2", seriesImdb: "tt0000009", ordinal: "3" }),
        binding({ mal: "3", imdb: "nm0000001" }),
      ]),
    ).toEqual([
      { malId: 1, imdbIds: ["tt0000001"], series: [] },
      {
        malId: 2,
        imdbIds: [],
        series: [{ imdbId: "tt0000009", season: 3 }],
      },
      { malId: 3, imdbIds: [], series: [] },
    ]);
  });

  test("files shows under their series; specials and films keep their own id", () => {
    const { anime } = new IndexBuilder(
      [],
      [
        listed(10),
        listed(11, { type: "SPECIAL" }),
        listed(12, { type: "MOVIE" }),
        listed(13, { title: "Show Specials" }),
      ],
      {},
      [
        {
          malId: 10,
          imdbIds: [],
          series: [{ imdbId: "tt0000009", season: 2 }],
        },
        {
          malId: 11,
          imdbIds: [],
          series: [{ imdbId: "tt0000009", season: 2 }],
        },
        { malId: 12, imdbIds: ["tt0000012"], series: [] },
        {
          malId: 13,
          imdbIds: [],
          series: [{ imdbId: "tt0000009", season: 3 }],
        },
      ],
    ).build("2026-11-10T00:00:00.000Z");

    expect(anime["10"]).toMatchObject({
      imdbId: "tt0000009",
      season: 2,
      source: "wikidata",
    });
    expect(anime["11"]).toBeUndefined();
    // Specials are TV entries on MAL too, but never a season.
    expect(anime["13"]).toBeUndefined();
    expect(anime["12"]).toMatchObject({
      imdbId: "tt0000012",
      source: "wikidata",
    });
    expect(anime["12"]?.season).toBeUndefined();
  });

  test("starts a later part after the season's earlier entries, or leaves it out", () => {
    const { anime } = new IndexBuilder(
      [{ mal_id: 1, imdb_id: ["tt0000009"], season: { tvdb: 1 } }],
      [
        listed(1, {
          episodes: 12,
          animeSeason: { season: "SPRING", year: 2020 },
        }),
        listed(2, {
          episodes: 12,
          animeSeason: { season: "FALL", year: 2020 },
        }),
        listed(3, { animeSeason: { season: "SPRING", year: 2020 } }),
      ],
      {},
      [2, 3].map((malId) => ({
        malId,
        imdbIds: [],
        series: [{ imdbId: "tt0000009", season: 1 }],
      })),
    ).build("2026-11-10T00:00:00.000Z");

    expect(anime["2"]).toMatchObject({ season: 1, episodeOffset: 12 });
    // Aired with the first part: where it starts is unknown.
    expect(anime["3"]).toBeUndefined();
    // Fribb's entries are never replaced.
    expect(anime["1"]?.source).toBe("fribb");
  });

  test("leaves entries Fribb maps to Fribb, and overrides win over both", () => {
    const { anime } = new IndexBuilder(
      [{ mal_id: 1, imdb_id: ["tt0000001"], season: { tvdb: 1 } }],
      [listed(1), listed(2)],
      { "2": { imdbId: "tt0000005" } },
      [
        { malId: 1, imdbIds: ["tt0000002"], series: [] },
        { malId: 2, imdbIds: ["tt0000003"], series: [] },
      ],
    ).build("2026-11-10T00:00:00.000Z");

    expect(anime["1"]?.imdbId).toBe("tt0000001");
    expect(anime["2"]).toMatchObject({ imdbId: "tt0000005", source: "manual" });
  });
});

describe("TMDB titles and seasons", () => {
  test("compares titles across romanisations and punctuation", () => {
    expect(titleKey("Tōkyō Revengers")).toBe(titleKey("Toukyou Revengers"));
    expect(titleKey("SPY×FAMILY")).toBe(titleKey("Spy x Family"));
  });

  test("names a season's series without its season marker", () => {
    expect(seriesTitle("Kingdom 5th Season")).toBe("Kingdom");
    expect(seriesTitle("Shingeki no Kyojin Season 3 Part 2")).toBe(
      "Shingeki no Kyojin",
    );
    expect(seriesTitle("Scissor Seven: Extra Episodes")).toBeUndefined();
    expect(seriesTitle("Mob Psycho 100")).toBeUndefined();
  });

  test("picks the season starting in the entry's quarter, else its year", () => {
    const seasons = [
      { season_number: 0, air_date: "2020-05-01" },
      { season_number: 1, air_date: "2020-04-05" },
      { season_number: 2, air_date: "2022-01-09" },
    ];
    expect(seasonAiring(seasons, airing("SPRING", 2020))).toBe(1);
    expect(seasonAiring(seasons, airing("SPRING", 2022))).toBe(2);
    expect(seasonAiring(seasons, airing("SPRING", 2021))).toBeUndefined();
  });
});

/** Answers with the first route whose key the URL contains. */
function stubTmdb(routes: Record<string, unknown>) {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = decodeURIComponent(String(input)).replaceAll("+", " ");
    const route = Object.keys(routes).find((key) => url.includes(key));
    return route
      ? Response.json(routes[route])
      : new Response(null, { status: 404 });
  }) as typeof fetch;
}

const show = (id: number, fields: Record<string, unknown>) => ({
  id,
  genres: [{ id: 16 }],
  first_air_date: "2026-08-02",
  seasons: [{ season_number: 1, air_date: "2026-08-02" }],
  ...fields,
});

describe("TMDB matcher", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("matches a new show by a native or romanised title", async () => {
    stubTmdb({
      "/search/tv?query=Jiyi Guanli Ju": {
        results: [
          { id: 280564, genre_ids: [16], first_air_date: "2026-08-02" },
        ],
      },
      "/tv/280564": show(280564, {
        name: "False Memory",
        original_name: "记忆管理局",
        external_ids: { imdb_id: "tt38754770" },
      }),
    });
    const entry = {
      ...listed(60568, {
        title: "Jiyi Guanli Ju",
        type: "ONA",
        synonyms: ["记忆管理局"],
        animeSeason: { season: "SUMMER", year: 2026 },
      }),
      malId: 60568,
    };
    const matcher = new TmdbMatcher("token", { schema: 1, entries: {} });

    expect(
      await matcher.match([entry], {}, new Map([[entry.malId, entry]])),
    ).toEqual([
      {
        malId: 60568,
        imdbId: "tt38754770",
        season: 1,
        tmdbId: 280564,
        tmdbType: "tv",
        tmdbSeason: 1,
        source: "tmdb",
      },
    ]);
  });

  test("files a new season under the show's IMDb title, unless it's a short", async () => {
    stubTmdb({
      "/tv/500": show(500, {
        name: "Show",
        seasons: [
          { season_number: 1, air_date: "2024-04-01" },
          { season_number: 2, air_date: "2026-07-01" },
        ],
      }),
    });
    const season1 = { ...listed(1), malId: 1 };
    const related = { relatedAnime: ["https://myanimelist.net/anime/1"] };
    const season2 = {
      ...listed(2, {
        ...related,
        animeSeason: { season: "SUMMER", year: 2026 },
      }),
      malId: 2,
    };
    const chibi = {
      ...listed(3, {
        ...related,
        animeSeason: { season: "SUMMER", year: 2026 },
        duration: { value: 180, unit: "SECONDS" },
      }),
      malId: 3,
    };
    const mapped = {
      1: {
        malId: 1,
        imdbId: "tt0000500",
        season: 1,
        tmdbId: 500,
        tmdbType: "tv" as const,
        tmdbSeason: 1,
        source: "fribb" as const,
      },
    };
    const matcher = new TmdbMatcher("token", { schema: 1, entries: {} });
    const found: Found[] = await matcher.match(
      [season2, chibi],
      mapped,
      new Map([season1, season2, chibi].map((entry) => [entry.malId, entry])),
    );

    expect(found).toEqual([
      {
        malId: 2,
        imdbId: "tt0000500",
        season: 2,
        tmdbId: 500,
        tmdbType: "tv",
        tmdbSeason: 2,
        source: "tmdb",
      },
    ]);
  });

  test("uses cached matches without a token", async () => {
    const entry = { ...listed(7), malId: 7 };
    const cached: Found = {
      malId: 7,
      imdbId: "tt0000007",
      source: "tmdb",
    };
    const matcher = new TmdbMatcher(undefined, {
      schema: 1,
      entries: { 7: { checkedAt: "2020-01-01T00:00:00.000Z", found: cached } },
    });
    expect(await matcher.match([entry], {}, new Map())).toEqual([cached]);
  });
});
