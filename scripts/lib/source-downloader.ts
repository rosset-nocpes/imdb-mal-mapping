import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const USER_AGENT =
  "imdb-mal-mapping index builder (https://github.com/rosset-nocpes/imdb-mal-mapping)";

/** Downloads source datasets, optionally keeping copies in a cache directory. */
export class SourceDownloader {
  constructor(private readonly cacheDir?: string) {}

  /** `cacheName` names the cached copy when the URL's path doesn't. */
  async json<T>(url: string, cacheName?: string): Promise<T> {
    return JSON.parse(
      new TextDecoder().decode(await this.bytes(url, cacheName)),
    ) as T;
  }

  /** A zstd-compressed JSON file. */
  async zstdJson<T>(url: string): Promise<T> {
    return JSON.parse(
      new TextDecoder().decode(Bun.zstdDecompressSync(await this.bytes(url))),
    ) as T;
  }

  async bytes(url: string, cacheName?: string): Promise<Uint8Array> {
    const file =
      this.cacheDir &&
      join(this.cacheDir, cacheName ?? new URL(url).pathname.split("/").pop()!);
    if (file) {
      try {
        return new Uint8Array(await readFile(file));
      } catch {
        // Not cached yet.
      }
    }
    const response = await fetch(url, {
      // Wikidata refuses clients that don't say who they are.
      headers: { "user-agent": USER_AGENT },
    });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (this.cacheDir && file) {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(file, bytes);
    }
    return bytes;
  }
}
