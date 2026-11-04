export type ContextSeason = {
  /** Provider's season number ("Сезон 2" → 2). */
  season: number;
  /** Episode numbers present in that season, or just how many there are. */
  episodes: number[] | number;
};

export type ResolveInput = {
  malId: number;
  /** IMDb id the provider filed the show under, if it is not ours. */
  imdbId?: string;
  /**
   * The provider's seasons for the whole title. A season may repeat (one per
   * dub team): repeats are merged, since teams of one title share numbering.
   */
  seasons: ContextSeason[];
};

export type Confidence = "high" | "medium" | "low";

export type Placement = {
  /** Provider season holding the MAL entry. */
  season: number;
  /** Provider episode N+offset is MAL episode N. */
  episodeOffset?: number;
  /** Last provider episode of the entry, when the season continues past it. */
  episodeEnd?: number;
  /** MAL ids the provider season contains, in order. */
  covers: number[];
};

/** Which MAL entries one provider season holds. */
export type SeasonGroup = { season: number; covers: number[] };

export type Resolution = {
  malId: number;
  imdbId: string;
  /** The provider's IMDb id is not one we know for this entry. */
  imdbMismatch: boolean;
  episodes?: number;
  confidence: Confidence;
  /** Best placement, or null when the provider does not have the entry (yet). */
  match: Placement | null;
  /** Other plausible placements, best first, with how much worse they score. */
  alternatives: Array<Placement & { penalty: number }>;
  /** How every provider season lines up with MAL entries in the best reading. */
  alignment: SeasonGroup[];
};
