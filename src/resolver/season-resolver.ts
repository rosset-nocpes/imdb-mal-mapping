/**
 * Context mode: given how a provider actually lays out a show —
 * its season folders and the episode numbers inside them — find which
 * provider season and episode range is a given MAL entry.
 *
 * The MAL franchise (every entry on the same IMDb series, in order) is aligned
 * against the provider seasons (see SeasonAlignment). Costs reward matching
 * episode counts and season numbers that agree with IMDb/TVDB, and tolerate
 * what providers really do: split cours shown as their own seasons or merged
 * into one, IMDb seasons merged or split (shifting every later season), extra
 * OVAs or an episode 0, dubs still in progress, teams that only have later
 * seasons or later episodes, and continuous numbering across seasons.
 */
import { AnimeStore } from "../mapping/anime-store.js";
import type { Anime } from "../types.js";
import { CostModel } from "./cost-model.js";
import { ProviderLayout } from "./provider-layout.js";
import { type Candidate, SeasonAlignment } from "./season-alignment.js";
import type {
  Confidence,
  Placement,
  Resolution,
  ResolveInput,
} from "./types.js";

export class SeasonResolver {
  readonly #store: AnimeStore;
  readonly #costs: CostModel;

  constructor(store: AnimeStore, costs: CostModel = CostModel.default) {
    this.#store = store;
    this.#costs = costs;
  }

  /** Null when the MAL id is unknown. */
  resolve(input: ResolveInput): Resolution | null {
    const target = this.#store.get(input.malId);
    if (!target) return null;

    const alignment = new SeasonAlignment(
      this.franchise(target, input.imdbId),
      ProviderLayout.from(input.seasons),
      target.malId,
      this.#costs,
    );
    const ranked = alignment.placements();
    const uncovered = alignment.uncoveredCost;
    const best =
      ranked[0] && ranked[0].cost <= uncovered ? ranked[0] : undefined;
    const bestCost = best?.cost ?? uncovered;
    const known = new Set(target.imdbIds ?? [target.imdbId]);

    return {
      malId: target.malId,
      imdbId: target.imdbId,
      imdbMismatch: input.imdbId !== undefined && !known.has(input.imdbId),
      episodes: target.episodes,
      confidence: this.#confidence(ranked, best, uncovered),
      match: best ? SeasonResolver.#placement(best) : null,
      alternatives: ranked.slice(best ? 1 : 0, best ? 4 : 3).map((candidate) =>
        Object.assign(SeasonResolver.#placement(candidate), {
          penalty: Math.round((candidate.cost - bestCost) * 100) / 100,
        }),
      ),
      alignment: best
        ? alignment.readingThrough(best)
        : alignment.readingWithoutTarget(),
    };
  }

  /** Every franchise entry the provider may show as a season, in watch order. */
  franchise(target: Anime, providerImdb?: string): Anime[] {
    const ids = new Set(target.imdbIds ?? [target.imdbId]);
    if (providerImdb) ids.add(providerImdb);
    const parts = new Map<number, Anime>();
    for (const id of ids) {
      for (const anime of this.#store.series(id)) {
        if (SeasonResolver.#isPart(anime) || anime.malId === target.malId) {
          parts.set(anime.malId, anime);
        }
      }
    }
    return [...parts.values()].toSorted(AnimeStore.watchOrder);
  }

  static #isPart(anime: Anime): boolean {
    return anime.season !== undefined
      ? anime.season >= 1
      : anime.type === "TV" || anime.type === "ONA";
  }

  /** How much better the answer scores than the next reading placing the entry elsewhere. */
  #confidence(
    ranked: readonly Candidate[],
    best: Candidate | undefined,
    uncovered: number,
  ): Confidence {
    let margin: number;
    if (best) {
      // Rivals must disagree on where the entry starts; a different end is a detail.
      const rival = ranked.find(
        (c) =>
          c.season !== best.season || c.episodeOffset !== best.episodeOffset,
      );
      margin = Math.min(rival?.cost ?? Infinity, uncovered) - best.cost;
    } else {
      margin = (ranked[0]?.cost ?? Infinity) - uncovered;
    }
    const { near, merge, mismatch } = this.#costs.weights;
    const strong = !best || best.own <= near + merge;
    if (margin >= 1 && strong) return "high";
    if (margin >= 0.4 && (!best || best.own < mismatch)) return "medium";
    return "low";
  }

  static #placement({
    season,
    episodeOffset,
    episodeEnd,
    covers,
  }: Candidate): Placement {
    return { season, episodeOffset, episodeEnd, covers };
  }
}
