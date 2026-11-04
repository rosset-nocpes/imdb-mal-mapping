import { describe, expect, test } from "bun:test";
import {
  AnimeMapping,
  byImdb,
  byMal,
  ImdbMalMapping,
  resolve,
} from "../src/index.js";

describe("bundled dataset", () => {
  test("is a single shared instance", () => {
    expect(ImdbMalMapping.getInstance()).toBe(ImdbMalMapping.getInstance());
    expect(ImdbMalMapping.getInstance()).toBeInstanceOf(AnimeMapping);
    expect(ImdbMalMapping.getInstance().count).toBeGreaterThan(5000);
  });

  test("cannot be constructed directly, even from plain JS", () => {
    const Constructor = ImdbMalMapping as unknown as new () => ImdbMalMapping;
    expect(() => new Constructor()).toThrow(TypeError);
  });

  test("shortcuts go through the shared instance", () => {
    const mapping = ImdbMalMapping.getInstance();
    expect(byMal(38524)).toEqual(mapping.byMal(38524));
    expect(byImdb("tt2560140")).toEqual(mapping.byImdb("tt2560140"));
    const input = { malId: 51019, seasons: [{ season: 3, episodes: 11 }] };
    expect(resolve(input)).toEqual(mapping.resolve(input));
  });
});
