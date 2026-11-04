import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Downloads source datasets, optionally keeping copies in a cache directory. */
export class SourceDownloader {
  constructor(private readonly cacheDir?: string) {}

  async json<T>(url: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.bytes(url))) as T;
  }

  /** A zstd-compressed JSON file. */
  async zstdJson<T>(url: string): Promise<T> {
    return JSON.parse(
      new TextDecoder().decode(Bun.zstdDecompressSync(await this.bytes(url))),
    ) as T;
  }

  async bytes(url: string): Promise<Uint8Array> {
    const file =
      this.cacheDir &&
      join(this.cacheDir, new URL(url).pathname.split("/").pop()!);
    if (file) {
      try {
        return new Uint8Array(await readFile(file));
      } catch {
        // Not cached yet.
      }
    }
    const response = await fetch(url, {
      headers: { "user-agent": "imdb-mal-mapping index builder" },
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
