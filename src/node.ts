/// <reference types="node" />
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Snapshot, SnapshotCache } from "./remote/dataset-client.js";

/** Keeps the dataset in a JSON file, so restarts need no download. */
export function fileCache(path: string): SnapshotCache {
  return {
    async read() {
      try {
        return JSON.parse(await readFile(path, "utf8")) as Snapshot;
      } catch {
        return undefined;
      }
    },
    async write(snapshot) {
      await mkdir(dirname(path), { recursive: true });
      // Written aside and renamed, so a crash never leaves half a file.
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot));
      await rename(temporary, path);
    },
  };
}
