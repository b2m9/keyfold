/** Thrown by `createMerger` when options are malformed or contradictory. */
export class KeyfoldConfigError extends Error {
  override readonly name = "KeyfoldConfigError";
}

/** Thrown during a merge when base or delta data violates the contract. */
export class KeyfoldMergeError extends Error {
  override readonly name = "KeyfoldMergeError";
}
