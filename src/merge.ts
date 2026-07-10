import { copyPlainObject, enumerableOwnKeys, isPlainObject, UNSAFE_KEYS } from "./objects.js";
import { compileOptions, ITEM, type PolicyNode } from "./paths.js";
import { reconcile, type FoldContext } from "./reconcile.js";
import { DELETE, DELETE_TOKEN } from "./sentinels.js";
import type { Delta, MergeOptions } from "./types.js";

/**
 * Configure an immutable delta fold for one state shape.
 *
 * The returned function has no held state. It builds a result before
 * returning, so invalid input can throw without ever partially mutating the
 * base tree, and a merge that changes nothing returns `base` by reference.
 */
export function createMerger<T, Atomic = never>(
  options: MergeOptions = {},
): (base: T, delta: Delta<T, Atomic>) => T {
  const compiled = compileOptions(options);
  const context: FoldContext = {
    wireDeletes: compiled.wireDeletes,
    fold: (base, delta, policy, path) => fold(base, delta, policy, context, path),
  };

  return (base, delta) => fold(base, delta, compiled.root, context, "") as T;
}

function fold(
  base: unknown,
  delta: unknown,
  policy: PolicyNode | undefined,
  context: FoldContext,
  path: string,
): unknown {
  // Replace is deliberately a pointer swap: no traversal or sanitizing pass.
  if (policy?.replace === true) return delta;

  if (Array.isArray(delta)) {
    if (policy?.keyField !== undefined) {
      return reconcile(
        Array.isArray(base) ? base : [],
        delta,
        policy.keyField,
        policy.children?.get(ITEM),
        context,
        path,
      );
    }
    return delta;
  }

  if (isPlainObject(delta)) {
    return foldObject(isPlainObject(base) ? base : {}, delta, policy, context, path);
  }

  return delta;
}

function foldObject(
  base: Record<string, unknown>,
  delta: Record<string, unknown>,
  policy: PolicyNode | undefined,
  context: FoldContext,
  path: string,
): Record<string, unknown> {
  const baseByKey = base as Record<PropertyKey, unknown>;
  const deltaByKey = delta as Record<PropertyKey, unknown>;
  // Copied lazily, on the first write that changes something, so a delta that
  // changes nothing returns the base object by reference.
  let next: Record<PropertyKey, unknown> | undefined;

  for (const key of enumerableOwnKeys(delta)) {
    if (typeof key === "string" && UNSAFE_KEYS.has(key)) continue;

    const value = deltaByKey[key];
    // undefined means "field not mentioned": spreading partials never clobbers.
    if (value === undefined) continue;

    const hasBase = Object.hasOwn(base, key);
    if (value === DELETE || (context.wireDeletes && value === DELETE_TOKEN)) {
      if (hasBase) {
        next ??= copyPlainObject(base) as Record<PropertyKey, unknown>;
        delete next[key];
      }
      continue;
    }

    const baseValue = hasBase ? baseByKey[key] : undefined;
    const folded = fold(
      baseValue,
      value,
      // The policy ITEM edge is entered only by reconciliation. A literal
      // data key named '[]' and symbol keys must not inherit item policy.
      typeof key === "string" && key !== ITEM ? policy?.children?.get(key) : undefined,
      context,
      typeof key === "string" ? (path === "" ? key : `${path}.${key}`) : `${path}[${String(key)}]`,
    );
    if (!hasBase || !Object.is(folded, baseValue)) {
      next ??= copyPlainObject(base) as Record<PropertyKey, unknown>;
      next[key] = folded;
    }
  }

  return next ?? base;
}
