import {
  afterEach,
  describe,
  expect,
  mock,
  setSystemTime,
  test,
} from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DatasetClient,
  fetchIndex,
  fetchManifest,
  type Snapshot,
} from "../src/index.js";
import { fileCache } from "../src/node.js";
import type { Index } from "../src/types.js";
import { DatasetFiles } from "../scripts/lib/dataset-files.js";
import fixture from "./fixture.json" with { type: "json" };

const MIRROR = "https://mirror.test/v1/";
const BACKUP = "https://backup.test/v1/";
const HOUR = 60 * 60 * 1000;

const version = (hash: string): Index => ({ ...(fixture as Index), hash });

/** A host serving one dataset version; `down` makes every request fail. */
function host(initial: Index) {
  const state = { index: initial, down: false };
  const fetch = mock(async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    if (state.down) throw new TypeError("network down");
    const files = new DatasetFiles(state.index);
    if (url.endsWith("manifest.json")) return Response.json(files.manifest);
    if (url.endsWith("index.json")) return new Response(files.renderIndex());
    return new Response(null, { status: 404 });
  });
  const requests = (file: string) =>
    fetch.mock.calls.filter(([input]) => String(input).endsWith(file)).length;
  return {
    state,
    fetch: fetch as unknown as typeof globalThis.fetch,
    requests,
  };
}

afterEach(() => setSystemTime());

describe("fetching the dataset", () => {
  test("reads the published files", async () => {
    const { fetch } = host(version("a"));
    const manifest = await fetchManifest({ urls: [MIRROR], fetch });
    expect(manifest).toEqual({
      schema: 1,
      hash: "a",
      builtAt: fixture.builtAt,
      count: fixture.count,
    });
    const index = await fetchIndex({ urls: [MIRROR], fetch });
    expect(index.anime).toEqual(fixture.anime as Index["anime"]);
  });

  test("falls back to the next mirror", async () => {
    const { fetch } = host(version("a"));
    const failing = (async (input: string | URL | Request) =>
      String(input).startsWith(MIRROR)
        ? new Response(null, { status: 503 })
        : fetch(input)) as typeof globalThis.fetch;
    await expect(
      fetchManifest({ urls: [MIRROR, BACKUP], fetch: failing }),
    ).resolves.toMatchObject({ hash: "a" });
  });

  test("rejects another schema, naming every mirror", async () => {
    const fetch = (async () =>
      Response.json({
        schema: 2,
        hash: "a",
      })) as unknown as typeof globalThis.fetch;
    const error = await fetchManifest({ urls: [MIRROR, BACKUP], fetch }).catch(
      (caught: Error) => caught,
    );
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as Error).message).toContain("mirror.test");
    expect((error as Error).message).toContain("backup.test");
    expect((error as Error).message).toContain("not a schema 1 dataset");
  });
});

describe("DatasetClient", () => {
  test("downloads once, then only checks the manifest after maxAge", async () => {
    setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { fetch, requests } = host(version("a"));
    const client = new DatasetClient({ urls: [MIRROR], fetch, maxAge: HOUR });

    const [first, concurrent] = await Promise.all([
      client.mapping(),
      client.mapping(),
    ]);
    expect(first).toBe(concurrent);
    expect(first.byMal(45576)?.season).toBe(1);
    expect(await client.mapping()).toBe(first);
    expect([requests("manifest.json"), requests("index.json")]).toEqual([1, 1]);

    setSystemTime(new Date("2026-11-01T02:00:00Z"));
    expect(await client.mapping()).toBe(first);
    expect([requests("manifest.json"), requests("index.json")]).toEqual([2, 1]);
  });

  test("switches to a newer dataset", async () => {
    setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { state, fetch } = host(version("a"));
    const client = new DatasetClient({ urls: [MIRROR], fetch, maxAge: HOUR });
    expect((await client.mapping()).hash).toBe("a");

    state.index = version("b");
    setSystemTime(new Date("2026-11-01T02:00:00Z"));
    expect((await client.mapping()).hash).toBe("b");
  });

  test("keeps the old dataset while the host is down", async () => {
    setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { state, fetch, requests } = host(version("a"));
    const client = new DatasetClient({ urls: [MIRROR], fetch, maxAge: HOUR });
    const first = await client.mapping();

    state.down = true;
    setSystemTime(new Date("2026-11-01T02:00:00Z"));
    expect(await client.mapping()).toBe(first);
    // Retries later, not on every call.
    expect(await client.mapping()).toBe(first);
    expect(requests("manifest.json")).toBe(2);
  });

  test("fails when there is nothing to fall back to", async () => {
    const { state, fetch } = host(version("a"));
    state.down = true;
    const client = new DatasetClient({ urls: [MIRROR], fetch });
    await expect(client.mapping()).rejects.toThrow("could not download");
  });

  test("starts from a fresh cached snapshot without downloading", async () => {
    setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { fetch, requests } = host(version("b"));
    const written: Snapshot[] = [];
    const cache = {
      read: () => ({ index: version("a"), checkedAt: Date.now() - 1000 }),
      write: (snapshot: Snapshot) => void written.push(snapshot),
    };
    const client = new DatasetClient({ urls: [MIRROR], fetch, cache });

    expect((await client.mapping()).hash).toBe("a");
    expect(requests("manifest.json")).toBe(0);
    expect(written).toEqual([]);
  });

  test("refreshes a stale cached snapshot and saves the new one", async () => {
    setSystemTime(new Date("2026-11-03T00:00:00Z"));
    const { fetch, requests } = host(version("a"));
    const written: Snapshot[] = [];
    const cache = {
      read: () => ({ index: version("a"), checkedAt: 0 }),
      write: (snapshot: Snapshot) => void written.push(snapshot),
    };
    const client = new DatasetClient({ urls: [MIRROR], fetch, cache });

    expect((await client.mapping()).hash).toBe("a");
    // Same hash: the cached entries are kept, nothing big is downloaded.
    expect([requests("manifest.json"), requests("index.json")]).toEqual([1, 0]);
    expect(written.map((snapshot) => snapshot.checkedAt)).toEqual([Date.now()]);
  });
});

describe("fileCache", () => {
  test("round-trips a snapshot and reads nothing from a missing file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "imdb-mal-mapping-"));
    try {
      const cache = fileCache(join(dir, "nested", "dataset.json"));
      expect(await cache.read()).toBeUndefined();
      const snapshot = { index: version("a"), checkedAt: 1 };
      await cache.write(snapshot);
      expect(await cache.read()).toEqual(snapshot);
      expect(
        JSON.parse(await readFile(join(dir, "nested", "dataset.json"), "utf8")),
      ).toEqual(snapshot);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("published files", () => {
  test("index.json is valid JSON with one entry per line", () => {
    const files = new DatasetFiles(version("a"));
    const text = files.renderIndex();
    expect(JSON.parse(text)).toEqual(version("a"));
    expect(text.split("\n").length).toBe(fixture.count + 3);
  });
});
