/**
 * Builds the dataset (see scripts/lib/index-builder.ts) into
 * `<out>/v<schema>/index.json` and `manifest.json`, the files CI publishes
 * to the `data` branch.
 *
 * Usage: bun scripts/build-index.ts [--out dir] [--cache dir] [--tmdb-cache file]
 * TMDB_TOKEN (a TMDB API read access token) enables new TMDB matches.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatasetFiles } from "./lib/dataset-files.js";
import {
  type FribbEntry,
  IndexBuilder,
  type ManamiEntry,
  type Overrides,
} from "./lib/index-builder.js";
import { SourceDownloader } from "./lib/source-downloader.js";
import { TmdbMatcher } from "./lib/tmdb-source.js";
import { fetchWikidata } from "./lib/wikidata-source.js";

const FRIBB =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const MANAMI =
  "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json.zst";

const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : undefined;
};

const root = join(import.meta.dir, "..");
const downloader = new SourceDownloader(flag("--cache"));

const [fribb, manami, overrides, wikidata] = await Promise.all([
  downloader.json<FribbEntry[]>(FRIBB),
  downloader.zstdJson<{ data: ManamiEntry[] }>(MANAMI).then((db) => db.data),
  readFile(join(root, "data/overrides.json"), "utf8").then(
    (text) => JSON.parse(text) as Overrides,
  ),
  fetchWikidata(downloader),
]);

const builder = new IndexBuilder(fribb, manami, overrides, wikidata);

// TMDB matches for what is still unmapped. Without TMDB_TOKEN only cached
// matches are used.
const tmdbCachePath = flag("--tmdb-cache") ?? join(root, ".cache/tmdb.json");
const tmdb = new TmdbMatcher(
  process.env.TMDB_TOKEN,
  await TmdbMatcher.loadCache(tmdbCachePath),
);
const matches = await tmdb.match(
  builder.unmapped(["TV", "ONA", "MOVIE"]),
  builder.mapped(),
  builder.listed(),
);
await tmdb.saveCache(tmdbCachePath);
console.log(`TMDB: ${matches.length} matches, ${tmdb.requests} requests`);

const files = new DatasetFiles(builder.add(matches).build());
const dir = await files.write(flag("--out") ?? join(root, ".data"));
console.log(`${dir}: ${files.index.count} anime, hash ${files.index.hash}`);
