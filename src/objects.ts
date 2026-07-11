/** Keys a recursive merge must never follow. */
export const UNSAFE_KEYS: ReadonlySet<string> = new Set(["__proto__", "constructor", "prototype"]);

/**
 * True for records that are safe to recurse into. Class instances and
 * built-ins are opaque values: replacing them is both safer and less
 * surprising than guessing at their internal structure.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Own enumerable string and symbol keys, matching object-spread semantics. */
export function enumerableOwnKeys(source: object): PropertyKey[] {
  return Reflect.ownKeys(source).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(source, key),
  );
}

/** Shallow-copy a plain record without changing its prototype. */
export function copyPlainObject(source: Record<string, unknown>): Record<string, unknown> {
  const target = Object.create(Object.getPrototypeOf(source)) as Record<string, unknown>;
  const sourceByKey = source as Record<PropertyKey, unknown>;

  for (const key of enumerableOwnKeys(source)) {
    Object.defineProperty(target, key, {
      configurable: true,
      enumerable: true,
      value: sourceByKey[key],
      writable: true,
    });
  }

  return target;
}
