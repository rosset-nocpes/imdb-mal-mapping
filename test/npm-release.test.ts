import { describe, expect, test } from "bun:test";
import { NpmRelease } from "../scripts/lib/npm-release.js";

describe("release version", () => {
  const release = new NpmRelease("package.json", "abc");
  const manifest = { name: "imdb-mal-mapping", version: "0.2.0" };

  test("first release and code releases use package.json's version", () => {
    expect(release.nextVersion(manifest, {})).toBe("0.2.0");
    expect(
      release.nextVersion(manifest, { version: "0.1.4", dataHash: "abc" }),
    ).toBe("0.2.0");
  });

  test("data changes bump the published patch version", () => {
    expect(
      release.nextVersion(manifest, { version: "0.2.3", dataHash: "old" }),
    ).toBe("0.2.4");
    expect(release.nextVersion(manifest, { version: "0.2.0" })).toBe("0.2.1");
  });

  test("nothing new, nothing to publish", () => {
    expect(
      release.nextVersion(manifest, { version: "0.2.3", dataHash: "abc" }),
    ).toBeUndefined();
  });
});
