import { describe, expect, test } from "bun:test";
import { AnimeMapping, type ResolveInput } from "../src/core.js";
import type { Index } from "../src/types.js";
import fixture from "./fixture.json" with { type: "json" };

const mapping = new AnimeMapping(fixture as Index);
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);
const placed = (
  malId: number,
  seasons: ResolveInput["seasons"],
  imdbId?: string,
) => {
  const result = mapping.resolve({ malId, imdbId, seasons });
  return (
    result?.match && {
      season: result.match.season,
      episodeOffset: result.match.episodeOffset ?? 0,
      episodeEnd: result.match.episodeEnd,
    }
  );
};

describe("lookup", () => {
  test("IMDb → MAL entries in season order, with split-cour ranges", () => {
    const matches = mapping.byImdb("tt2560140");
    expect(matches.map((m) => m.malId)).toEqual([
      18397, 16498, 25777, 35760, 38524, 40028, 48583, 51535,
    ]);
    expect(matches[3]).toMatchObject({
      malId: 35760,
      season: 3,
      episodeEnd: 12,
    });
    expect(matches[4]).toMatchObject({
      malId: 38524,
      season: 3,
      episodeOffset: 12,
    });
  });

  test("MAL → IMDb id, season and range", () => {
    const entry = mapping.byMal(45576);
    expect(entry).toMatchObject({
      malId: 45576,
      imdbId: "tt13293588",
      season: 1,
      episodeOffset: 11,
    });
    expect(entry?.episodeEnd).toBeUndefined();
    expect(mapping.byMal(35760)?.episodeEnd).toBe(12);
  });

  test("unknown ids", () => {
    expect(mapping.byMal(1)).toBeUndefined();
    expect(mapping.byImdb("tt0000001")).toEqual([]);
    expect(
      mapping.resolve({ malId: 1, seasons: [{ season: 1, episodes: 3 }] }),
    ).toBeNull();
  });
});

describe("context mode (layouts seen on some provider)", () => {
  test("canonical layout with split cours", () => {
    const seasons = [
      { season: 1, episodes: range(1, 25) },
      { season: 2, episodes: range(1, 12) },
      { season: 3, episodes: range(1, 22) },
      { season: 4, episodes: range(1, 30) },
    ];
    expect(placed(38524, seasons)).toEqual({
      season: 3,
      episodeOffset: 12,
      episodeEnd: undefined,
    });
    expect(placed(40028, seasons)).toEqual({
      season: 4,
      episodeOffset: 0,
      episodeEnd: 16,
    });
    expect(placed(51535, seasons)).toEqual({
      season: 4,
      episodeOffset: 28,
      episodeEnd: undefined,
    });
  });

  test("merged season shifts every later season (Demon Slayer)", () => {
    const seasons = [
      { season: 1, episodes: 26 },
      { season: 2, episodes: 18 },
      { season: 3, episodes: 11 },
      { season: 4, episodes: 8 },
    ];
    expect(placed(49926, seasons)).toEqual({
      season: 2,
      episodeOffset: 0,
      episodeEnd: 7,
    });
    expect(placed(47778, seasons)).toEqual({
      season: 2,
      episodeOffset: 7,
      episodeEnd: undefined,
    });
    expect(placed(51019, seasons)).toEqual({
      season: 3,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
    expect(placed(55701, seasons)).toEqual({
      season: 4,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
  });

  test("teams are merged: one team's late episodes, another's full season", () => {
    const seasons = [
      { season: 4, episodes: [29, 30] },
      { season: 1, episodes: range(1, 25) },
      { season: 2, episodes: range(1, 12) },
      { season: 3, episodes: range(1, 22) },
      { season: 4, episodes: range(1, 16) },
    ];
    expect(placed(51535, seasons)).toEqual({
      season: 4,
      episodeOffset: 28,
      episodeEnd: undefined,
    });
  });

  test("each cour as its own season", () => {
    const seasons = [25, 12, 12, 10, 16].map((episodes, i) => ({
      season: i + 1,
      episodes,
    }));
    expect(placed(38524, seasons)).toEqual({
      season: 4,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
    expect(placed(40028, seasons)).toEqual({
      season: 5,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
  });

  test("absolute and continuous numbering", () => {
    expect(placed(38524, [{ season: 1, episodes: 87 }])).toEqual({
      season: 1,
      episodeOffset: 49,
      episodeEnd: 59,
    });
    const continuous = [
      { season: 1, episodes: range(1, 25) },
      { season: 2, episodes: range(26, 37) },
      { season: 3, episodes: range(38, 59) },
    ];
    expect(placed(38524, continuous)).toEqual({
      season: 3,
      episodeOffset: 49,
      episodeEnd: undefined,
    });
  });

  test("appended OVAs and episode 0 do not shift seasons (One Punch Man)", () => {
    const seasons = [
      { season: 1, episodes: range(1, 19) },
      { season: 2, episodes: range(0, 18) },
      { season: 3, episodes: range(0, 12) },
    ];
    expect(placed(34134, seasons)?.season).toBe(2);
    expect(placed(52807, seasons)?.season).toBe(3);
  });

  test("episode 0 inside split-cour seasons (Mushoku Tensei)", () => {
    const seasons = [
      { season: 1, episodes: range(1, 24) },
      { season: 2, episodes: range(0, 24) },
      { season: 3, episodes: range(1, 14) },
    ];
    expect(placed(45576, seasons)).toEqual({
      season: 1,
      episodeOffset: 11,
      episodeEnd: undefined,
    });
    expect(placed(55888, seasons)).toEqual({
      season: 2,
      episodeOffset: 12,
      episodeEnd: undefined,
    });
    expect(placed(59193, seasons)).toEqual({
      season: 3,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
  });

  test("a title with only a late season", () => {
    expect(placed(60098, [{ season: 8, episodes: 13 }])?.season).toBe(8);
    expect(placed(31964, [{ season: 8, episodes: 13 }])).toBeNull();
  });

  test("entries the provider has not reached yet are not matched", () => {
    const lagging = [
      { season: 1, episodes: 25 },
      { season: 2, episodes: 12 },
      { season: 3, episodes: 5 },
    ];
    expect(placed(38524, lagging)).toBeNull();
    expect(placed(35760, lagging)).toEqual({
      season: 3,
      episodeOffset: 0,
      episodeEnd: undefined,
    });
    const jjk = [
      { season: 1, episodes: 24 },
      { season: 2, episodes: 23 },
      { season: 3, episodes: 12 },
    ];
    expect(placed(63824, jjk)).toBeNull();
    expect(placed(57658, jjk)?.season).toBe(3);
  });

  test("split arc as two seasons shifts later parts; airing counts are lower bounds (JoJo)", () => {
    const seasons = [26, 24, 24, 39, 39, 38, 7].map((episodes, i) => ({
      season: i + 1,
      episodes,
    }));
    const expected: Array<[number, number, number, number | undefined]> = [
      [14719, 1, 0, undefined],
      [20899, 2, 0, undefined],
      [26055, 3, 0, undefined],
      [31933, 4, 0, undefined],
      [37991, 5, 0, undefined],
      [48661, 6, 0, 12],
      [51367, 6, 12, 24],
      [53273, 6, 24, undefined],
      [61469, 7, 0, undefined],
    ];
    for (const [malId, season, episodeOffset, episodeEnd] of expected) {
      expect([malId, placed(malId, seasons)]).toEqual([
        malId,
        { season, episodeOffset, episodeEnd },
      ]);
    }
  });

  test("reports confidence, alignment and IMDb mismatch", () => {
    const result = mapping.resolve({
      malId: 51019,
      imdbId: "tt0000001",
      seasons: [
        { season: 1, episodes: 26 },
        { season: 2, episodes: 18 },
        { season: 3, episodes: 11 },
      ],
    });
    expect(result).toMatchObject({
      malId: 51019,
      imdbId: "tt9335498",
      imdbMismatch: true,
      confidence: "high",
      match: { season: 3, covers: [51019] },
    });
    expect(result?.alignment).toEqual([
      { season: 1, covers: [38000] },
      { season: 2, covers: [49926, 47778] },
      { season: 3, covers: [51019] },
    ]);
  });

  test("cost weights can be tuned per mapping", () => {
    // Free extra episodes and costly merges force IMDb numbering: S3 is then Entertainment
    // District, and Swordsmith Village (IMDb S4) is not on the provider yet.
    const tuned = new AnimeMapping(fixture as Index, {
      costs: { over: 0, overScale: 0, merge: 5 },
    });
    const seasons = [26, 18, 11].map((episodes, i) => ({
      season: i + 1,
      episodes,
    }));
    expect(mapping.resolve({ malId: 51019, seasons })?.match?.season).toBe(3);
    expect(tuned.resolve({ malId: 51019, seasons })?.match).toBeNull();
  });

  test("ignores malformed seasons", () => {
    const seasons = [
      { season: 1, episodes: [1, Number.NaN, 2.5, -1, 25] },
      { season: Number.NaN, episodes: 3 },
      { season: 2, episodes: 12 },
    ];
    expect(placed(25777, seasons)?.season).toBe(2);
  });
});

describe("TMDB numbering", () => {
  // TVDB splits the cours into seasons 1 and 2; TMDB keeps one season.
  const index: Index = {
    schema: 1,
    hash: "tmdb",
    builtAt: "2026-11-04T00:00:00.000Z",
    count: 3,
    anime: {
      "1": {
        malId: 1,
        imdbId: "tt0000001",
        season: 1,
        tmdbId: 10,
        tmdbType: "tv",
        tmdbSeason: 1,
        source: "fribb",
      },
      "2": {
        malId: 2,
        imdbId: "tt0000001",
        season: 2,
        tmdbId: 10,
        tmdbType: "tv",
        tmdbSeason: 1,
        tmdbEpisodeOffset: 12,
        source: "fribb",
      },
      "3": {
        malId: 3,
        imdbId: "tt0000001",
        tmdbId: 30,
        tmdbType: "movie",
        source: "fribb",
      },
    },
  };
  const tmdb = new AnimeMapping(index);

  test("gives where an entry ends in TMDB's season", () => {
    expect(tmdb.byMal(1)).toMatchObject({
      episodeEnd: undefined,
      tmdbEpisodeEnd: 12,
    });
    expect(tmdb.byMal(2)?.tmdbEpisodeEnd).toBeUndefined();
  });

  test("has no TMDB episode range for movies", () => {
    expect(tmdb.byMal(3)?.tmdbEpisodeEnd).toBeUndefined();
  });
});
