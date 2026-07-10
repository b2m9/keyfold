import { KeyfoldMergeError } from "./errors.js";
import { isPlainObject } from "./objects.js";
import type { PolicyNode } from "./paths.js";
import { DELETE_TOKEN } from "./sentinels.js";

export interface FoldContext {
  readonly wireDeletes: boolean;
  fold(base: unknown, delta: unknown, policy: PolicyNode | undefined, path: string): unknown;
}

interface Patch {
  item: Record<string, unknown>;
  tombstone: boolean;
}

/** Reconcile one keyed list while preserving base order and appending inserts. */
export function reconcile(
  base: readonly unknown[],
  delta: readonly unknown[],
  identityField: string,
  itemPolicy: PolicyNode | undefined,
  context: FoldContext,
  path: string,
): readonly unknown[] {
  // The delta is indexed and validated before any output exists: the
  // immutability guarantee is the failure guarantee.
  const patches = indexDelta(delta, identityField, context.wireDeletes, path);
  const seenBaseIds = new Set<string | number>();
  const next: unknown[] = [];
  let changed = false;

  for (const rawItem of base) {
    const { id, item } = readKeyedItem(rawItem, identityField, context.wireDeletes, path, "base");
    if (seenBaseIds.has(id)) {
      throw new KeyfoldMergeError(`duplicate identity ${show(id)} in base list at '${path}'`);
    }
    seenBaseIds.add(id);

    if (Object.hasOwn(item, "$delete")) {
      throw new KeyfoldMergeError(
        `base item ${show(id)} at '${path}' contains the reserved '$delete' field`,
      );
    }

    const patch = patches.get(id);
    if (patch === undefined) {
      next.push(item);
      continue;
    }

    patches.delete(id);
    if (patch.tombstone) {
      changed = true;
      continue;
    }
    const folded = context.fold(item, patch.item, itemPolicy, `${path}[]`);
    if (!Object.is(folded, item)) changed = true;
    next.push(folded);
  }

  for (const patch of patches.values()) {
    // A tombstone whose target is absent is a no-op; deletes stay idempotent.
    if (!patch.tombstone) {
      // Folding onto an empty base consumes nested operators in inserts too.
      next.push(context.fold(undefined, patch.item, itemPolicy, `${path}[]`));
      changed = true;
    }
  }

  // A no-op delta — empty, all-absent tombstones, or patches that restate
  // current values — still validates the touched base list, then keeps its
  // reference. This preserves the cheap no-op without hiding corrupt ids.
  return changed ? next : base;
}

function indexDelta(
  delta: readonly unknown[],
  identityField: string,
  wireDeletes: boolean,
  path: string,
): Map<string | number, Patch> {
  const patches = new Map<string | number, Patch>();

  for (const rawItem of delta) {
    const { id, item } = readKeyedItem(rawItem, identityField, wireDeletes, path, "delta");
    if (patches.has(id)) {
      // No carve-out for tombstone+patch pairs: "delete then re-add" would
      // hinge on implicit ordering. The item-swap spelling is replace:
      // ['<list>[]'].
      throw new KeyfoldMergeError(`duplicate identity ${show(id)} in delta list at '${path}'`);
    }
    patches.set(id, { item, tombstone: isTombstone(item, identityField, path) });
  }

  return patches;
}

function readKeyedItem(
  value: unknown,
  identityField: string,
  wireDeletes: boolean,
  path: string,
  source: "base" | "delta",
): { id: string | number; item: Record<string, unknown> } {
  if (!isPlainObject(value)) {
    throw new KeyfoldMergeError(
      `${source} item at '${path}' is not an object with identity field '${identityField}'`,
    );
  }
  if (!Object.hasOwn(value, identityField)) {
    throw new KeyfoldMergeError(
      `${source} item at '${path}' has no identity field '${identityField}'`,
    );
  }

  const id = value[identityField];
  // Under the wire protocol the token cannot be an identity: the item fold
  // would consume it as a field delete and emit an item with no identity.
  if (wireDeletes && id === DELETE_TOKEN) {
    throw new KeyfoldMergeError(
      `identity field '${identityField}' at '${path}' cannot use the reserved wire token`,
    );
  }
  // Map keying is SameValueZero; with NaN banned it behaves exactly like ===,
  // so {id: 1} and {id: '1'} stay distinct items.
  if (typeof id === "string" || (typeof id === "number" && !Number.isNaN(id))) {
    return { id, item: value };
  }

  throw new KeyfoldMergeError(
    `identity field '${identityField}' of ${source} item at '${path}' must be a string or number, got ${show(id)}`,
  );
}

function isTombstone(item: Record<string, unknown>, identityField: string, path: string): boolean {
  if (!Object.hasOwn(item, "$delete")) return false;
  if (item.$delete !== true) {
    throw new KeyfoldMergeError(
      `'$delete' at '${path}' is reserved and must be true, got ${show(item.$delete)}`,
    );
  }

  for (const key of Object.keys(item)) {
    if (key === identityField || key === "$delete") continue;
    throw new KeyfoldMergeError(
      `tombstone at '${path}' must contain only '${identityField}' and '$delete'`,
    );
  }

  return true;
}

function show(value: unknown): string {
  return typeof value === "string" ? `'${value}'` : String(value);
}
