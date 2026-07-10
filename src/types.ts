type Delete = typeof import("./sentinels.js").DELETE;

export interface MergeOptions {
  /**
   * Maps a list path to its identity field. Identity values must be strings
   * or numbers and are matched without coercion.
   *
   * @example `{ "order.items": "id" }`
   */
  readonly keyBy?: Readonly<Record<string, string>>;

  /**
   * Paths that replace wholesale instead of merging. A trailing `[]` swaps
   * matched keyed-list items while preserving identity reconciliation.
   */
  readonly replace?: readonly string[];

  /** Interpret `DELETE_TOKEN` as a field delete at interpreted positions. */
  readonly wireDeletes?: boolean;
}

/**
 * A recursive partial update of `T`.
 *
 * `DELETE` is intentionally limited to optional properties: deleting a
 * required property would make the promised `T` return type untrue. The type
 * cannot know which arrays are keyed, so object array items admit tombstones;
 * merge-time validation applies the configured policy. Pass custom class and
 * opaque value types as `Atomic` so deltas require their complete value.
 */
export type Delta<T, Atomic = never> = T extends Atomic
  ? T
  : T extends readonly unknown[]
    ? DeltaArray<T, Atomic>
    : T extends KnownOpaque
      ? T
      : T extends object
        ? DeltaObject<T, Atomic>
        : T;

type DeltaArray<ArrayType extends readonly unknown[], Atomic> = ArrayType extends (infer Element)[]
  ? DeltaItem<Element, Atomic>[]
  : readonly DeltaItem<ArrayType[number], Atomic>[];

type DeltaObject<T extends object, Atomic> = {
  readonly [Key in keyof T]?:
    | Delta<T[Key], Atomic>
    | undefined
    | ({} extends Pick<T, Key> ? Delete : never);
};

type DeltaItem<Element, Atomic> = Element extends Atomic
  ? Element
  : Element extends KnownOpaque
    ? Element
    : Element extends object
      ? Delta<Element, Atomic> & { readonly $delete?: true }
      : Element;

/** Built-ins whose data is opaque to both the runtime fold and `Delta<T>`. */
type KnownOpaque =
  | ((...args: never[]) => unknown)
  | ArrayBuffer
  | ArrayBufferView
  | Date
  | Promise<unknown>
  | ReadonlyMap<unknown, unknown>
  | ReadonlySet<unknown>
  | RegExp
  | WeakMap<object, unknown>
  | WeakSet<object>;
