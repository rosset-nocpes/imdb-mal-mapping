import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Index, Manifest } from "../../src/types.js";

/** The published files: `v<schema>/index.json` and its `manifest.json`. */
export class DatasetFiles {
  constructor(readonly index: Index) {}

  get manifest(): Manifest {
    const { schema, hash, builtAt, count } = this.index;
    return { schema, hash, builtAt, count };
  }

  /** One entry per line, so the data branch's diffs show what changed. */
  renderIndex(): string {
    const entries = Object.entries(this.index.anime).map(
      ([malId, anime]) => `${JSON.stringify(malId)}:${JSON.stringify(anime)}`,
    );
    const header = JSON.stringify(this.manifest).slice(0, -1);
    return `${header},"anime":{\n${entries.join(",\n")}\n}}\n`;
  }

  /** Writes the files under `dir/v<schema>/`; returns that directory. */
  async write(dir: string): Promise<string> {
    const target = join(dir, `v${this.index.schema}`);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "index.json"), this.renderIndex());
    await writeFile(
      join(target, "manifest.json"),
      `${JSON.stringify(this.manifest, null, 2)}\n`,
    );
    return target;
  }
}
