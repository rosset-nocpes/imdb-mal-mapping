/** Penalties of the alignment; lower total cost = better reading. */
export const DEFAULT_COSTS = {
  /** Provider starts later in the franchise (only has S3 onwards). */
  skipLead: 0.05,
  /** An entry between two provider seasons is missing. */
  skipPart: 0.5,
  /** A provider season matches nothing. */
  skipSeason: 1.5,
  /** Count is off by one or two: an episode 0, a recap. */
  near: 0.3,
  /** Fewer episodes than the entries hold: dub in progress. */
  partial: 0.8,
  partialNotLast: 0.7,
  /** More episodes than the entries hold: appended OVAs; grows with the excess. */
  over: 0.5,
  overScale: 1.5,
  mismatch: 2.5,
  unknownLast: 0.3,
  unknownInside: 1.5,
  /** Season number departs from the IMDb/TVDB shift so far; grows with the gap. */
  shift: 1,
  shiftScale: 0.3,
  /** One provider season spans several IMDb/TVDB seasons. */
  merge: 0.8,
  /** Reading episode numbers as continuing from the previous season. */
  continuous: 0.6,
} as const;

export type CostWeights = Record<keyof typeof DEFAULT_COSTS, number>;

/** Scores pieces of an alignment with a set of weights. */
export class CostModel {
  /** The tuned weights, shared by every mapping that does not bring its own. */
  static readonly default: CostModel = new CostModel();

  readonly weights: CostWeights;

  constructor(weights: Partial<CostWeights> = {}) {
    this.weights = { ...DEFAULT_COSTS, ...weights };
  }

  /**
   * How well `span` provider episodes fit entries with `episodes` counts.
   * `airing`: the last entry's count is only a lower bound.
   */
  episodeCount(
    span: number,
    episodes: ReadonlyArray<number | undefined>,
    lastSeason: boolean,
    airing: boolean,
  ): number {
    const w = this.weights;
    const last = episodes.at(-1);
    const inner = episodes.slice(0, -1);
    if (inner.some((e) => e === undefined)) return w.unknownInside;
    const before = (inner as number[]).reduce((sum, e) => sum + e, 0);
    if (last === undefined) return span > before ? w.unknownLast : w.mismatch;

    const total = before + last;
    if (span === total) return 0;
    if (Math.abs(span - total) <= (total >= 40 ? 2 : 1)) return w.near;
    if (span > total) {
      // An airing entry may already have more episodes than the data knows of.
      if (airing) return w.unknownLast;
      return w.over + w.overScale * Math.min(1, (span - total) / total);
    }
    if (span > before) return w.partial + (lastSeason ? 0 : w.partialNotLast);
    return w.mismatch + Math.min(2, ((total - span) / Math.max(total, 1)) * 3);
  }

  /** Provider season numbered `gap` away from the expected IMDb/TVDB shift. */
  shift(gap: number): number {
    return gap
      ? this.weights.shift + this.weights.shiftScale * Math.min(3, gap)
      : 0;
  }

  /** Skipping an entry before (`leading`) or between provider seasons. */
  skipPart(leading: boolean): number {
    return leading ? this.weights.skipLead : this.weights.skipPart;
  }
}
