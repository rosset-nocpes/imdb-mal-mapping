import { AnimeMapping, type MappingOptions } from "../mapping/anime-mapping.js";
import type { Index, Manifest } from "../types.js";

/** The dataset format this release reads. URLs carry it as `/v1/`. */
export const SCHEMA_VERSION = 1;

/**
 * Where the dataset is published, tried in order. Each URL holds
 * `manifest.json` and `index.json`. The data is rebuilt weekly from the `data`
 * branch, without a new package release.
 */
export const DATASET_URLS: readonly string[] = [
  `https://raw.githubusercontent.com/rosset-nocpes/imdb-mal-mapping/data/v${SCHEMA_VERSION}/`,
  `https://cdn.jsdelivr.net/gh/rosset-nocpes/imdb-mal-mapping@data/v${SCHEMA_VERSION}/`,
];

const DAY = 24 * 60 * 60 * 1000;
/** After a failed check, how long the old dataset is used before retrying. */
const RETRY_AFTER = 10 * 60 * 1000;

export type FetchOptions = {
  /** Base URLs, ending in `/`, tried in order. Default: `DATASET_URLS`. */
  urls?: readonly string[];
  /** Default: the global `fetch`. */
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

async function download(file: string, options: FetchOptions): Promise<object> {
  const { urls = DATASET_URLS, signal } = options;
  const fetchFile = options.fetch ?? fetch;
  const errors: Error[] = [];
  // Mirrors are fallbacks, so they are tried one at a time.
  /* oxlint-disable no-await-in-loop */
  for (const base of urls) {
    const url = new URL(file, base);
    try {
      const response = await fetchFile(url, { signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      if (
        !data ||
        typeof data !== "object" ||
        !("schema" in data) ||
        data.schema !== SCHEMA_VERSION ||
        !("hash" in data) ||
        typeof data.hash !== "string"
      ) {
        throw new Error(`not a schema ${SCHEMA_VERSION} dataset`);
      }
      return data;
    } catch (error) {
      if (signal?.aborted) throw error;
      errors.push(new Error(`${url}: ${(error as Error).message}`));
    }
  }
  /* oxlint-enable no-await-in-loop */
  throw new AggregateError(
    errors,
    `imdb-mal-mapping: could not download ${file}: ${errors.map((error) => error.message).join("; ")}`,
  );
}

/** The latest dataset's header: compare its `hash` to see if it changed. */
export async function fetchManifest(
  options: FetchOptions = {},
): Promise<Manifest> {
  return (await download("manifest.json", options)) as Manifest;
}

/** The latest dataset (about 2 MB, or 350 kB gzipped). */
export async function fetchIndex(options: FetchOptions = {}): Promise<Index> {
  const index = (await download("index.json", options)) as Index;
  if (!index.anime || typeof index.anime !== "object") {
    throw new Error("imdb-mal-mapping: index.json has no entries");
  }
  return index;
}

/** A downloaded dataset and when it was last confirmed to be the latest. */
export type Snapshot = { index: Index; checkedAt: number };

/** Somewhere to keep the dataset between runs: a file, KV store, database. */
export type SnapshotCache = {
  read(): Snapshot | undefined | Promise<Snapshot | undefined>;
  write(snapshot: Snapshot): void | Promise<void>;
};

export type DatasetClientOptions = FetchOptions &
  MappingOptions & {
    /** How long a dataset is used before checking for a newer one. Default: a day. */
    maxAge?: number;
    /** Keeps the dataset between runs. Without one it lives in memory only. */
    cache?: SnapshotCache;
  };

/**
 * The mapping over the latest published dataset. Downloads it on first use,
 * then checks the small manifest once per `maxAge` and downloads the dataset
 * again only when it changed. When a check fails, the dataset it has keeps
 * being used.
 */
export class DatasetClient {
  readonly #options: DatasetClientOptions;
  #snapshot: Snapshot | undefined;
  #mapping: AnimeMapping | undefined;
  #nextCheck = 0;
  #cacheRead = false;
  #pending: Promise<AnimeMapping> | undefined;

  constructor(options: DatasetClientOptions = {}) {
    this.#options = options;
  }

  get #maxAge(): number {
    return this.#options.maxAge ?? DAY;
  }

  /** The mapping, checked for a newer dataset at most once per `maxAge`. */
  mapping(): Promise<AnimeMapping> {
    if (this.#mapping && Date.now() < this.#nextCheck) {
      return Promise.resolve(this.#mapping);
    }
    this.#pending ??= this.#refresh().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  async #refresh(): Promise<AnimeMapping> {
    const { cache } = this.#options;
    if (!this.#cacheRead && cache) {
      this.#cacheRead = true;
      const cached = await Promise.resolve()
        .then(() => cache.read())
        .catch(() => undefined);
      if (cached?.index?.schema === SCHEMA_VERSION) {
        this.#use(cached);
        if (Date.now() < this.#nextCheck) return this.#mapping!;
      }
    }

    try {
      const manifest = await fetchManifest(this.#options);
      const index =
        this.#snapshot?.index.hash === manifest.hash
          ? this.#snapshot.index
          : await fetchIndex(this.#options);
      const snapshot = { index, checkedAt: Date.now() };
      this.#use(snapshot);
      await Promise.resolve()
        .then(() => cache?.write(snapshot))
        .catch(() => undefined);
      return this.#mapping!;
    } catch (error) {
      if (!this.#mapping) throw error;
      this.#nextCheck = Date.now() + Math.min(this.#maxAge, RETRY_AFTER);
      return this.#mapping;
    }
  }

  #use(snapshot: Snapshot): void {
    if (!this.#mapping || this.#snapshot?.index.hash !== snapshot.index.hash) {
      this.#mapping = new AnimeMapping(snapshot.index, this.#options);
    }
    this.#snapshot = snapshot;
    this.#nextCheck = snapshot.checkedAt + this.#maxAge;
  }
}

let shared: DatasetClient | undefined;

/**
 * The mapping over the latest published dataset, shared by every caller in
 * this process and kept in memory. Use a `DatasetClient` for other options.
 */
export function loadMapping(): Promise<AnimeMapping> {
  shared ??= new DatasetClient();
  return shared.mapping();
}
