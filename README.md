<img src="assets/icon.svg" width="64" height="64" alt="">

# imdb-mal-mapping

Map IMDb ids to MyAnimeList ids with the season and episode range of each MAL entry, offline. Context mode places a MAL entry inside a provider's own season layout, even when that layout disagrees with IMDb.

```sh
npm install imdb-mal-mapping
```

The dataset (about 8,000 MAL entries) ships with the package: 342 kB packed, parsed on first use in about 20 ms. A new patch version is published whenever the upstream data changes.

## Usage

`ImdbMalMapping` is a singleton over the bundled dataset. `byMal`, `byImdb` and `resolve` are shortcuts to its methods.

```ts
import { ImdbMalMapping } from "imdb-mal-mapping";

const mapping = ImdbMalMapping.getInstance(); // same instance every time
mapping.byMal(38524);
mapping.builtAt; // when the dataset was built
```

## Lookups

```ts
import { byImdb, byMal } from "imdb-mal-mapping";

byMal(38524);
// { malId: 38524, imdbId: "tt2560140", season: 3, episodeOffset: 12, episodes: 10,
//   title: "Shingeki no Kyojin Season 3 Part 2", type: "TV", year: 2019,
//   tvdbId: 267440, tmdbId: 1429, tmdbSeason: 3, tmdbEpisodeOffset: 12, source: "fribb" }

byImdb("tt13293588");
// [{ malId: 39535, season: 1, episodeEnd: 11, … },
//  { malId: 45576, season: 1, episodeOffset: 11, … },
//  { malId: 51179, season: 2, episodeEnd: 12, … }, …]
```

| Field           | Meaning                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------- |
| `season`        | IMDb/TVDB season. `0` means specials; absent for movies.                                                  |
| `episodeOffset` | The entry starts after this episode of the season. 12 means MAL episode 1 is S3E13.                       |
| `episodeEnd`    | Last episode of the season belonging to this entry, present when a later entry continues the same season. |
| `episodes`      | MAL episode count; absent while unknown.                                                                  |
| `airing`        | Still airing or upcoming; `episodes` may only count what has aired.                                       |
| `imdbIds`       | Every known IMDb id when there are several; `imdbId` is the series one.                                   |
| `source`        | `fribb` listed, `inferred` IMDb id taken from the TVDB/TMDB series, `manual` from `data/overrides.json`.  |

`byMal` returns `undefined` and `byImdb` returns `[]` for unknown ids.

## Context mode

Pass a provider's season layout for the whole title. Seasons may repeat (one per dub team); repeats are merged, because teams of one provider title share numbering. That matters: one team's layout can explain another's. `episodes` is the list of episode numbers present, or a count.

```ts
import { resolve } from "imdb-mal-mapping";

const result = resolve({
  malId: 51019, // Demon Slayer: Swordsmith Village
  imdbId: "tt9335498", // optional: the IMDb id the provider filed it under
  seasons: [
    { season: 1, episodes: [1, 2, /* … */ 26] },
    { season: 2, episodes: 18 },
    { season: 3, episodes: 11 },
    { season: 4, episodes: 8 },
  ],
});
// {
//   malId: 51019, imdbId: "tt9335498", imdbMismatch: false, episodes: 11,
//   confidence: "high",
//   match: { season: 3, covers: [51019] },
//   alternatives: [{ season: 4, covers: [51019], penalty: 2 }, …],
//   alignment: [
//     { season: 1, covers: [38000] },
//     { season: 2, covers: [49926, 47778] },
//     { season: 3, covers: [51019] },
//     { season: 4, covers: [55701] },
//   ],
// }
```

Using the result: provider episode `n` of `match.season` is MAL episode `n - (match.episodeOffset ?? 0)`, and episodes above `match.episodeEnd` belong to a later entry.

| Field          | Meaning                                                                                                                                                         |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `match`        | `{ season, episodeOffset?, episodeEnd?, covers }`. `covers` lists the MAL entries in that provider season. `null` when the provider doesn't have the entry yet. |
| `confidence`   | `high`, `medium` or `low`, from how much better the match scores than the next reading that would place the entry elsewhere.                                    |
| `alignment`    | The full reading: which MAL entries each provider season holds.                                                                                                 |
| `alternatives` | Next best placements, each with a `penalty` relative to the match.                                                                                              |
| `imdbMismatch` | The provider's IMDb id is not one known for this entry. Its franchise is still searched.                                                                        |

`resolve` returns `null` for an unknown MAL id.

How it works (`src/resolver/`): the franchise's MAL entries (everything on the same IMDb title, plus the provider's IMDb title if it differs) are aligned with the provider seasons by dynamic programming. Each provider season covers a contiguous run of entries. The costs reward matching episode counts and season numbers that follow IMDb/TVDB, and they tolerate these provider quirks:

- split cours shown as their own seasons, or merged into one
- two IMDb seasons merged into one, which shifts every later season
- appended OVAs and episode 0
- dubs that are still in progress
- teams that start later in the show or later in a season
- one IMDb season split into two
- airing entries whose episode count is behind the provider
- continuous episode numbering across seasons

## Your own data

`imdb-mal-mapping/core` has the `AnimeMapping` class without the bundled dataset (`ImdbMalMapping` extends it):

```ts
import { AnimeMapping } from "imdb-mal-mapping/core";

const mapping = new AnimeMapping(index); // an Index, as built by scripts/build-index.ts
mapping.byMal(38524);
mapping.resolve({ malId: 38524, seasons });

// The resolver's weights can be tuned; see DEFAULT_COSTS.
const strict = new AnimeMapping(index, { costs: { merge: 2 } });
```

## Data

`scripts/build-index.ts` builds the dataset from these sources:

- [Fribb/anime-lists](https://github.com/Fribb/anime-lists): MAL ↔ IMDb/TVDB/TMDB ids, TVDB and TMDB seasons and episode offsets. Entries without an IMDb id inherit their TVDB/TMDB series' id. The repository has no license file.
- [manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database), under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): titles, type, episode counts and air season.
- `data/overrides.json`: manual corrections keyed by MAL id. Fields replace the generated ones, and `null` removes an entry.

Matches may be incomplete or wrong. Corrections are welcome in `data/overrides.json`.

## Development

```sh
bun install
bun run build:index   # generates src/dataset.ts; add --cache .cache to reuse downloads
bun run check         # oxfmt --check, oxlint, tsc, bun test
bun run format        # oxfmt
bun run build         # dist/
```

```
src/
  index.ts               entry: ImdbMalMapping + byMal/byImdb/resolve shortcuts
  core.ts                entry without data: AnimeMapping, types, DEFAULT_COSTS
  mapping/
    anime-store.ts       AnimeStore: the dataset and its lookup tables
    anime-mapping.ts     AnimeMapping: public API over one dataset
    imdb-mal-mapping.ts  ImdbMalMapping: singleton over the bundled dataset
  resolver/
    provider-layout.ts   ProviderLayout: a provider's seasons, teams merged
    cost-model.ts        CostModel: alignment weights (CostModel.default is shared)
    season-alignment.ts  SeasonAlignment: the dynamic program for one request
    season-resolver.ts   SeasonResolver: picks the franchise, builds the Resolution
scripts/
  build-index.ts         downloads sources, writes src/dataset.ts
  release.ts             publishes to npm when needed
  lib/                   SourceDownloader, IndexBuilder, DatasetModule, NpmRelease
```

## License

The code is MIT. The bundled data keeps its sources' terms; see [Data](#data).
