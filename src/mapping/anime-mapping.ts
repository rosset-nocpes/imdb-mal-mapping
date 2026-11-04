import { CostModel, type CostWeights } from "../resolver/cost-model.js";
import type { Resolution, ResolveInput } from "../resolver/types.js";
import { SeasonResolver } from "../resolver/season-resolver.js";
import type { Entry, Index, Match } from "../types.js";
import { AnimeStore } from "./anime-store.js";

export type MappingOptions = {
  /** Overrides of the resolver's cost weights (see DEFAULT_COSTS). */
  costs?: Partial<CostWeights>;
};

/** IMDb ↔ MAL lookups and context-mode season resolution over one dataset. */
export class AnimeMapping {
  readonly #store: AnimeStore;
  readonly #resolver: SeasonResolver;

  constructor(index: Index, options: MappingOptions = {}) {
    this.#store = new AnimeStore(index);
    const costs = options.costs
      ? new CostModel(options.costs)
      : CostModel.default;
    this.#resolver = new SeasonResolver(this.#store, costs);
  }

  /** When the dataset was built (ISO 8601). */
  get builtAt(): string {
    return this.#store.builtAt;
  }

  /** MAL entries with an IMDb id. */
  get count(): number {
    return this.#store.count;
  }

  /** IMDb titles with at least one MAL entry. */
  get imdbCount(): number {
    return this.#store.imdbCount;
  }

  /** One MAL entry with its IMDb id, season and episode range. */
  byMal(malId: number): Entry | undefined {
    return this.#store.entry(malId);
  }

  /** Every MAL entry on an IMDb title, in season order. Empty when unknown. */
  byImdb(imdbId: string): Match[] {
    return this.#store.matches(imdbId);
  }

  /**
   * Context mode: where a MAL entry sits in a provider's own season layout.
   * Null when the MAL id is unknown.
   */
  resolve(input: ResolveInput): Resolution | null {
    return this.#resolver.resolve(input);
  }
}
