<img src="assets/icon.svg" width="64" height="64" alt="">

# imdb-mal-mapping

Map IMDb ids to MyAnimeList ids with the season and episode range of each MAL entry. Context mode places a MAL entry inside a provider's own season layout, even when that layout disagrees with IMDb.

```sh
npm install imdb-mal-mapping
```

The package holds the code only. The dataset (about 8,000 MAL entries, 350 kB gzipped) is rebuilt every week and downloaded at runtime, so you get new data without updating the package. It works in Node 18+, Bun, Deno, browsers and edge runtimes: anywhere with `fetch`.

## Usage

```ts
import { loadMapping } from "imdb-mal-mapping";

const mapping = await loadMapping(); // downloads the dataset once per process
mapping.byMal(38524);
mapping.builtAt; // when the dataset was built
```

`loadMapping()` keeps the dataset in memory and checks for a newer one at most once a day: a 100-byte `manifest.json`, with the full dataset downloaded again only when it changed. If a check fails, the dataset it already has keeps being used.

### Keeping the dataset between runs

Without a cache, every new process downloads the dataset. A `DatasetClient` takes a cache and other options:

```ts
import { DatasetClient } from "imdb-mal-mapping";
import { fileCache } from "imdb-mal-mapping/node";

const client = new DatasetClient({
  cache: fileCache(".cache/imdb-mal-mapping.json"),
  maxAge: 7 * 24 * 60 * 60 * 1000, // check weekly; default: daily
});
const mapping = await client.mapping(); // call it per request: it's cheap
```

A cache is any `{ read(), write(snapshot) }` pair, sync or async, so the dataset can live in Redis, KV, IndexedDB or a database just as well. `DatasetClient` also takes `fetch`, `urls` (your own mirrors) and the resolver's `costs`.

### Doing it yourself

`fetchManifest()` and `fetchIndex()` download the files without any caching, and `AnimeMapping` from `imdb-mal-mapping/core` works over any index you have. This suits servers that refresh on a schedule:

```ts
import { AnimeMapping } from "imdb-mal-mapping/core";
import { fetchIndex, fetchManifest } from "imdb-mal-mapping";

const { hash } = await fetchManifest(); // compare with the hash you stored
const index = await fetchIndex(); // store it; then, anywhere:
const mapping = new AnimeMapping(index);
```

### Upgrading from 1.x

1.x bundled the dataset and needed a new release for every data change. In 2.x, `ImdbMalMapping.getInstance()` and the `byMal`/`byImdb`/`resolve` shortcuts are replaced by `await loadMapping()`, which returns the same `AnimeMapping` methods. `imdb-mal-mapping/core` is unchanged, and an `Index` now also carries `schema` and `hash`.

## Lookups

```ts
mapping.byMal(38524);
// { malId: 38524, imdbId: "tt2560140", season: 3, episodeOffset: 12, episodes: 10,
//   title: "Shingeki no Kyojin Season 3 Part 2", type: "TV", year: 2019,
//   tvdbId: 267440, tmdbId: 1429, tmdbSeason: 3, tmdbEpisodeOffset: 12, source: "fribb" }

mapping.byImdb("tt13293588");
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
const result = mapping.resolve({
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

## Tuning

The resolver's weights can be tuned; see `DEFAULT_COSTS`.

```ts
const strict = new DatasetClient({ costs: { merge: 2 } });
const alsoStrict = new AnimeMapping(index, { costs: { merge: 2 } });
```

## Data

### Where it is published

CI rebuilds the dataset every Monday and commits it to the [`data` branch](https://github.com/rosset-nocpes/imdb-mal-mapping/tree/data) when it changed. Changes to `data/overrides.json` are published within minutes of reaching `main`.

| URL                                                                                   | Cache             |
| ------------------------------------------------------------------------------------- | ----------------- |
| `https://raw.githubusercontent.com/rosset-nocpes/imdb-mal-mapping/data/v1/` (primary) | 5 min             |
| `https://cdn.jsdelivr.net/gh/rosset-nocpes/imdb-mal-mapping@data/v1/` (mirror)        | purged on publish |

Each holds `manifest.json` (`{ schema, hash, builtAt, count }`) and `index.json` (the same fields plus `anime`, one entry per line so the branch history shows what changed). Both send CORS headers. A build is only published if it loads, resolves known titles and keeps at least 90% of the published entries, so a broken upstream file can't empty it.

`/v1/` is the data format. Every 2.x release reads v1. A new format would be published under `/v2/` with a new major release, while `/v1/` keeps being updated for older installs.

### Sources

`scripts/build-index.ts` builds the dataset from these sources:

- [Fribb/anime-lists](https://github.com/Fribb/anime-lists): MAL ↔ IMDb/TVDB/TMDB ids, TVDB and TMDB seasons and episode offsets. Entries without an IMDb id inherit their TVDB/TMDB series' id. The repository has no license file.
- [manami-project/anime-offline-database](https://github.com/manami-project/anime-offline-database), under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/): titles, type, episode counts and air season.
- `data/overrides.json`: manual corrections keyed by MAL id. Fields replace the generated ones, and `null` removes an entry.

Matches may be incomplete or wrong. Corrections are welcome in `data/overrides.json`.

## Development

```sh
bun install
bun run build:index   # writes .data/v1/; add --cache .cache to reuse downloads
bun run check:dataset .data/v1  # the checks CI runs before publishing
bun run check         # oxfmt --check, oxlint, tsc, bun test
bun run format        # oxfmt
bun run build         # dist/
```

```
src/
  index.ts               entry: core plus downloading the dataset
  core.ts                entry without network code: AnimeMapping, types, DEFAULT_COSTS
  node.ts                entry for Node/Bun: fileCache
  remote/
    dataset-client.ts    DatasetClient, loadMapping, fetchManifest/fetchIndex, URLs
  mapping/
    anime-store.ts       AnimeStore: the dataset and its lookup tables
    anime-mapping.ts     AnimeMapping: public API over one dataset
  resolver/
    provider-layout.ts   ProviderLayout: a provider's seasons, teams merged
    cost-model.ts        CostModel: alignment weights (CostModel.default is shared)
    season-alignment.ts  SeasonAlignment: the dynamic program for one request
    season-resolver.ts   SeasonResolver: picks the franchise, builds the Resolution
scripts/
  build-index.ts         downloads sources, writes .data/v1/
  check-dataset.ts       guards a build before CI publishes it
  lib/                   SourceDownloader, IndexBuilder, DatasetFiles
.github/workflows/
  data.yml               weekly: build, check, commit to the data branch
  release.yml            npm release when package.json has a new version
```

## License

The code is MIT. The dataset keeps its sources' terms; see [Sources](#sources).
