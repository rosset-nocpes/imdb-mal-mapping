/**
 * Builds the dataset (see scripts/lib/index-builder.ts) into
 * `<out>/v<schema>/index.json` and `manifest.json`, the files CI publishes
 * to the `data` branch.
 *
 * Usage: bun scripts/build-index.ts [--out dir] [--cache dir]
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

const [fribb, manami, overrides] = await Promise.all([
  downloader.json<FribbEntry[]>(FRIBB),
  downloader.zstdJson<{ data: ManamiEntry[] }>(MANAMI).then((db) => db.data),
  readFile(join(root, "data/overrides.json"), "utf8").then(
    (text) => JSON.parse(text) as Overrides,
  ),
]);

const files = new DatasetFiles(
  new IndexBuilder(fribb, manami, overrides).build(),
);
const dir = await files.write(flag("--out") ?? join(root, ".data"));
console.log(`${dir}: ${files.index.count} anime, hash ${files.index.hash}`);
