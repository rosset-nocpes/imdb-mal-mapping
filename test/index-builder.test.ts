import { describe, expect, test } from "bun:test";
import { IndexBuilder } from "../scripts/lib/index-builder.js";

describe("IndexBuilder", () => {
  test("says whether the TMDB id is a show or a movie", () => {
    const { anime } = new IndexBuilder(
      [
        {
          mal_id: 1,
          imdb_id: ["tt0000001"],
          themoviedb_id: { tv: 10 },
          season: { tvdb: 1, tmdb: 1 },
        },
        {
          mal_id: 2,
          imdb_id: ["tt0000002"],
          themoviedb_id: { movie: [20, 21] },
        },
        { mal_id: 3, imdb_id: ["tt0000003"] },
      ],
      [],
      {},
    ).build("2026-11-04T00:00:00.000Z");

    expect(anime["1"]).toMatchObject({ tmdbId: 10, tmdbType: "tv" });
    expect(anime["2"]).toMatchObject({ tmdbId: 20, tmdbType: "movie" });
    expect(anime["3"]?.tmdbId).toBeUndefined();
    expect(anime["3"]?.tmdbType).toBeUndefined();
  });
});
