/**
 * Builds src/dataset.ts, the bundled index (see scripts/lib/index-builder.ts).
 *
 * Usage: bun scripts/build-index.ts [--cache dir]
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatasetModule } from "./lib/dataset-module.js";
import {
  type FribbEntry,
  IndexBuilder,
  type ManamiEntry,
  type Overrides,
} from "./lib/index-builder.js";
import { SourceDownloader } from "./lib/source-downloader.js";

const FRIBB =
  "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-full.json";
const MANAMI =
  "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json.zst";

const root = join(import.meta.dir, "..");
const cacheFlag = process.argv.indexOf("--cache");
const downloader = new SourceDownloader(
  cacheFlag > 0 ? process.argv[cacheFlag + 1] : undefined,
);

const [fribb, manami, overrides] = await Promise.all([
  downloader.json<FribbEntry[]>(FRIBB),
  downloader.zstdJson<{ data: ManamiEntry[] }>(MANAMI).then((db) => db.data),
  readFile(join(root, "data/overrides.json"), "utf8").then(
    (text) => JSON.parse(text) as Overrides,
  ),
]);

const dataset = new DatasetModule(
  new IndexBuilder(fribb, manami, overrides).build(),
);
await dataset.write(join(root, "src/dataset.ts"));
console.log(
  `src/dataset.ts: ${dataset.index.count} anime, hash ${dataset.hash}`,
);
