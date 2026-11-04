import type { Anime } from "../types.js";
import { CostModel } from "./cost-model.js";
import type { ProviderLayout } from "./provider-layout.js";
import type { Placement, SeasonGroup } from "./types.js";

type Step =
  | { kind: "skipPart" }
  | { kind: "skipSeason" }
  | { kind: "segment"; from: number; to: number };

/**
 * F[j][i]: best cost with j provider seasons and i parts consumed, `back` how
 * we got there; B[j][i]: best cost from there to the end, `forth` the next step.
 */
type Solution = {
  F: number[][];
  B: number[][];
  back: Step[][];
  forth: Step[][];
};

type Segment = { cost: number; base: number };

/** A placement of the target with what it costs and where it sits in the grid. */
export type Candidate = Placement & {
  /** Total cost of the best reading through this placement. */
  cost: number;
  /** Cost of the provider season holding the target on its own. */
  own: number;
  j: number;
  a: number;
  b: number;
};

/**
 * Aligns a franchise's MAL entries (in watch order) with a provider's seasons.
 * Each provider season covers a contiguous run of entries; entries after the
 * last provider season are free, since the provider has not got that far.
 */
export class SeasonAlignment {
  readonly #parts: readonly Anime[];
  readonly #layout: ProviderLayout;
  readonly #target: number;
  readonly #episodes: Array<number | undefined>;
  readonly #canonical: Array<number | undefined>;
  readonly #memo = new Map<number, Segment>();
  readonly #costs: CostModel;
  readonly #withTarget: Solution;
  readonly #withoutTarget: Solution;

  constructor(
    parts: readonly Anime[],
    layout: ProviderLayout,
    targetMalId: number,
    costs: CostModel = CostModel.default,
  ) {
    this.#costs = costs;
    this.#parts = parts;
    this.#layout = layout;
    this.#target = parts.findIndex((p) => p.malId === targetMalId);
    this.#episodes = parts.map((p) => p.episodes);
    this.#canonical = parts.map((p) => p.season);
    this.#withTarget = this.#solve(true);
    this.#withoutTarget = this.#solve(false);
  }

  /** Cost of the best reading in which the provider does not have the target. */
  get uncoveredCost(): number {
    return this.#withoutTarget.B[0]![0]!;
  }

  /** Every distinct placement of the target, best first. */
  placements(): Candidate[] {
    const { F, B } = this.#withTarget;
    const t = this.#target;
    const n = this.#parts.length;
    const candidates = new Map<string, Candidate>();
    if (t < 0) return [];
    for (let j = 0; j < this.#layout.length; j++) {
      for (let a = 0; a <= t; a++) {
        if (F[j]![a] === Infinity) continue;
        const before = this.#episodes.slice(a, t);
        if (before.some((e) => e === undefined)) continue;
        const within = (before as number[]).reduce((sum, e) => sum + e, 0);
        for (let b = t; b < n; b++) {
          const { cost: own, base } = this.#segment(j, a, b);
          const cost = F[j]![a]! + own + B[j + 1]![b + 1]!;
          const offset = base + within;
          const length = this.#episodes[t];
          const end =
            b > t && length !== undefined ? offset + length : undefined;
          const key = `${this.#layout.at(j).season}:${offset}:${end}`;
          if ((candidates.get(key)?.cost ?? Infinity) <= cost) continue;
          candidates.set(key, {
            ...this.#group(j, a, b),
            episodeOffset: offset || undefined,
            episodeEnd: end,
            cost,
            own,
            j,
            a,
            b,
          });
        }
      }
    }
    return [...candidates.values()].toSorted((x, y) => x.cost - y.cost);
  }

  /** The best full reading passing through `candidate`. */
  readingThrough(candidate: Candidate): SeasonGroup[] {
    const { j, a, b } = candidate;
    return [
      ...this.#head(this.#withTarget.back, j, a),
      this.#group(j, a, b),
      ...this.#tail(this.#withTarget.forth, j + 1, b + 1),
    ];
  }

  /** The best full reading without the target. */
  readingWithoutTarget(): SeasonGroup[] {
    return this.#tail(this.#withoutTarget.forth, 0, 0);
  }

  #covers(a: number, b: number): boolean {
    return a <= this.#target && this.#target <= b;
  }

  #group(j: number, a: number, b: number): SeasonGroup {
    return {
      season: this.#layout.at(j).season,
      covers: this.#parts.slice(a, b + 1).map((p) => p.malId),
    };
  }

  /** Provider season j holding parts a..b, and where its numbering starts. */
  #segment(j: number, a: number, b: number): Segment {
    const n = this.#parts.length;
    const key = (j * (n + 1) + a) * (n + 1) + b;
    const cached = this.#memo.get(key);
    if (cached) return cached;

    const { season, min, max } = this.#layout.at(j);
    let numbering = 0;
    const start = this.#canonical[a];
    if (start !== undefined) {
      // A shift is expected only to continue the previous provider season's.
      const prior = j > 0 ? this.#layout.at(j - 1) : undefined;
      const previous = this.#canonical[a - 1];
      const expected =
        prior && prior.season === season - 1 && previous !== undefined
          ? prior.season - previous
          : 0;
      numbering += this.#costs.shift(Math.abs(season - start - expected));
    }
    const seasons = this.#canonical
      .slice(a, b + 1)
      .filter((s) => s !== undefined);
    if (new Set(seasons).size > 1) numbering += this.#costs.weights.merge;

    const episodes = this.#episodes.slice(a, b + 1);
    const lastSeason = j === this.#layout.length - 1;
    const airing = this.#parts[b]!.airing === true;
    let best: Segment = {
      cost:
        this.#costs.episodeCount(max, episodes, lastSeason, airing) + numbering,
      base: 0,
    };
    if (min > 1) {
      const span = max - min + 1;
      const cost =
        this.#costs.episodeCount(span, episodes, lastSeason, airing) +
        numbering +
        this.#costs.weights.continuous;
      if (cost < best.cost) best = { cost, base: min - 1 };
    }
    this.#memo.set(key, best);
    return best;
  }

  #solve(allowTarget: boolean): Solution {
    const m = this.#layout.length;
    const n = this.#parts.length;
    const { skipSeason } = this.#costs.weights;
    const grid = () =>
      Array.from({ length: m + 1 }, () =>
        Array.from({ length: n + 1 }, () => Infinity),
      );
    const steps = () =>
      Array.from({ length: m + 1 }, (): Step[] =>
        Array.from({ length: n + 1 }),
      );
    const F = grid();
    const B = grid();
    const back = steps();
    const forth = steps();
    const allowed = (a: number, b: number) =>
      allowTarget || !this.#covers(a, b);
    const relax = (j: number, i: number, cost: number, step: Step) => {
      if (cost < F[j]![i]!) {
        F[j]![i] = cost;
        back[j]![i] = step;
      }
    };

    F[0]![0] = 0;
    for (let j = 0; j <= m; j++) {
      for (let i = 0; i <= n; i++) {
        const cost = F[j]![i]!;
        if (cost === Infinity) continue;
        if (i < n)
          relax(j, i + 1, cost + this.#costs.skipPart(j === 0), {
            kind: "skipPart",
          });
        if (j === m) continue;
        relax(j + 1, i, cost + skipSeason, { kind: "skipSeason" });
        for (let b = i; b < n; b++) {
          if (!allowed(i, b)) continue;
          relax(j + 1, b + 1, cost + this.#segment(j, i, b).cost, {
            kind: "segment",
            from: i,
            to: b,
          });
        }
      }
    }

    B[m]!.fill(0);
    for (let j = m - 1; j >= 0; j--) {
      for (let i = n; i >= 0; i--) {
        let best = skipSeason + B[j + 1]![i]!;
        let step: Step = { kind: "skipSeason" };
        const skip = this.#costs.skipPart(j === 0);
        if (i < n && skip + B[j]![i + 1]! < best) {
          best = skip + B[j]![i + 1]!;
          step = { kind: "skipPart" };
        }
        for (let b = i; b < n; b++) {
          if (!allowed(i, b)) continue;
          const cost = this.#segment(j, i, b).cost + B[j + 1]![b + 1]!;
          if (cost < best) {
            best = cost;
            step = { kind: "segment", from: i, to: b };
          }
        }
        B[j]![i] = best;
        forth[j]![i] = step;
      }
    }
    return { F, B, back, forth };
  }

  /** Best path from the start to state (j, i). */
  #head(back: Step[][], j: number, i: number): SeasonGroup[] {
    const out: SeasonGroup[] = [];
    while (j > 0 || i > 0) {
      const step = back[j]![i]!;
      if (step.kind === "skipPart") i -= 1;
      else if (step.kind === "skipSeason") j -= 1;
      else {
        out.unshift(this.#group(j - 1, step.from, step.to));
        [j, i] = [j - 1, step.from];
      }
    }
    return out;
  }

  /** Best path from state (j, i) to the end. */
  #tail(forth: Step[][], j: number, i: number): SeasonGroup[] {
    const out: SeasonGroup[] = [];
    while (j < this.#layout.length) {
      const step = forth[j]![i]!;
      if (step.kind === "skipPart") i += 1;
      else if (step.kind === "skipSeason") j += 1;
      else {
        out.push(this.#group(j, step.from, step.to));
        [j, i] = [j + 1, step.to + 1];
      }
    }
    return out;
  }
}
