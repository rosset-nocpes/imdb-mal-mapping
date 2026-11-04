import dataset from "../dataset.js";
import { AnimeMapping } from "./anime-mapping.js";

/** The mapping over the bundled dataset: one shared instance, parsed on first use. */
export class ImdbMalMapping extends AnimeMapping {
  static #instance: ImdbMalMapping | undefined;
  static #constructing = false;

  /** Use `ImdbMalMapping.getInstance()`; also enforced at runtime for plain JS callers. */
  private constructor() {
    if (!ImdbMalMapping.#constructing) {
      throw new TypeError(
        "ImdbMalMapping is a singleton: use ImdbMalMapping.getInstance()",
      );
    }
    super(JSON.parse(dataset));
  }

  static getInstance(): ImdbMalMapping {
    if (!ImdbMalMapping.#instance) {
      ImdbMalMapping.#constructing = true;
      try {
        ImdbMalMapping.#instance = new ImdbMalMapping();
      } finally {
        ImdbMalMapping.#constructing = false;
      }
    }
    return ImdbMalMapping.#instance;
  }
}
