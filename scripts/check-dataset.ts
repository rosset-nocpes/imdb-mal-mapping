/**
 * Guards a fresh build before CI publishes it: it must load, resolve known
 * entries and not lose more than 10% of the published dataset's entries (a
 * broken upstream file would otherwise wipe the data for everyone).
 *
 * Usage: bun scripts/check-dataset.ts <dir with index.json> [published dir]
 * Set ALLOW_SHRINK=1 to publish a smaller dataset on purpose.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { AnimeMapping } from "../src/core.js";
import { SCHEMA_VERSION } from "../src/remote/dataset-client.js";
import type { Index, Manifest } from "../src/types.js";
import { IndexBuilder } from "./lib/index-builder.js";

const MIN_COUNT = 5000;
const MAX_SHRINK = 0.1;

const [dir, publishedDir] = process.argv.slice(2);
if (!dir) throw new Error("usage: check-dataset.ts <dir> [published dir]");

const index = JSON.parse(
  await readFile(join(dir, "index.json"), "utf8"),
) as Index;
const manifest = JSON.parse(
  await readFile(join(dir, "manifest.json"), "utf8"),
) as Manifest;

const problems: string[] = [];
const check = (ok: boolean, problem: string) => ok || problems.push(problem);

check(index.schema === SCHEMA_VERSION, `schema ${index.schema}`);
check(manifest.hash === index.hash, "manifest and index hashes differ");
check(IndexBuilder.hash(index.anime) === index.hash, "hash does not match");
check(
  Object.keys(index.anime).length === index.count,
  "count does not match the entries",
);
check(index.count >= MIN_COUNT, `only ${index.count} entries`);

// Long-settled entries that every healthy build maps the same way.
const mapping = new AnimeMapping(index);
check(
  mapping.byMal(38524)?.imdbId === "tt2560140",
  "Attack on Titan S3P2 lost its IMDb id",
);
check(
  mapping.resolve({ malId: 1, seasons: [{ season: 1, episodes: 26 }] })?.match
    ?.season === 1,
  "Cowboy Bebop no longer resolves",
);

if (publishedDir) {
  const published = await readFile(join(publishedDir, "manifest.json"), "utf8")
    .then((text) => JSON.parse(text) as Manifest)
    .catch(() => undefined);
  if (published && !process.env.ALLOW_SHRINK) {
    check(
      index.count >= published.count * (1 - MAX_SHRINK),
      `${index.count} entries, down from ${published.count} (ALLOW_SHRINK=1 to publish anyway)`,
    );
  }
}

if (problems.length) {
  console.error(`Dataset check failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Dataset ok: ${index.count} entries, hash ${index.hash}`);
