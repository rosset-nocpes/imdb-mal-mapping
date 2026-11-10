import type { SourceDownloader } from "./source-downloader.js";

/** What Wikidata knows of one MAL id: its items' IMDb ids and series. */
export type WikidataEntry = {
  malId: number;
  /** IMDb ids on the items themselves (a show, film or OVA of its own). */
  imdbIds: string[];
  /** Series the items are a season of, with the season's ordinal. */
  series: Array<{ imdbId: string; season?: number }>;
};

const ENDPOINT = "https://query.wikidata.org/sparql";

/**
 * Every item with a MyAnimeList anime id (P4086), its IMDb id (P345), and
 * the IMDb id and ordinal of the series it is part of (P179 + P1545).
 */
const QUERY = `SELECT ?mal ?imdb ?seriesImdb ?ordinal WHERE {
  ?item wdt:P4086 ?mal .
  OPTIONAL { ?item wdt:P345 ?imdb . }
  OPTIONAL {
    ?item p:P179 ?part .
    ?part ps:P179 ?series .
    ?series wdt:P345 ?seriesImdb .
    OPTIONAL { ?part pq:P1545 ?ordinal . }
  }
}`;

type Binding = Record<string, { value: string } | undefined>;

const IMDB_TITLE = /^tt\d{7,}$/;

/** Wikidata, CC0: one SPARQL query for all anime items. */
export async function fetchWikidata(
  downloader: SourceDownloader,
): Promise<WikidataEntry[]> {
  const url = `${ENDPOINT}?${new URLSearchParams({ query: QUERY, format: "json" })}`;
  const response = await downloader.json<{
    results: { bindings: Binding[] };
  }>(url, "wikidata.json");
  return parseWikidata(response.results.bindings);
}

export function parseWikidata(bindings: Binding[]): WikidataEntry[] {
  const entries = new Map<number, WikidataEntry>();
  for (const binding of bindings) {
    const malId = Number(binding.mal?.value);
    if (!Number.isSafeInteger(malId) || malId <= 0) continue;
    const entry = entries.get(malId) ?? { malId, imdbIds: [], series: [] };
    entries.set(malId, entry);

    const imdb = binding.imdb?.value;
    if (imdb && IMDB_TITLE.test(imdb) && !entry.imdbIds.includes(imdb)) {
      entry.imdbIds.push(imdb);
    }
    const seriesImdb = binding.seriesImdb?.value;
    if (seriesImdb && IMDB_TITLE.test(seriesImdb)) {
      const ordinal = Number(binding.ordinal?.value);
      const season =
        Number.isSafeInteger(ordinal) && ordinal >= 1 ? ordinal : undefined;
      if (
        !entry.series.some(
          (known) => known.imdbId === seriesImdb && known.season === season,
        )
      ) {
        entry.series.push({ imdbId: seriesImdb, season });
      }
    }
  }
  return [...entries.values()];
}
