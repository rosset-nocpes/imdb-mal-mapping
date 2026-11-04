/** Publishes to npm when needed (see scripts/lib/npm-release.ts). Run after build:index. */
import { hash } from "../src/dataset.js";
import { NpmRelease } from "./lib/npm-release.js";

const release = new NpmRelease(
  new URL("../package.json", import.meta.url).pathname,
  hash,
);
process.exit(await release.run(process.argv.slice(2)));
