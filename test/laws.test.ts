import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { createMerger, DELETE, DELETE_TOKEN, type Delta } from "../src/index.js";

interface Component {
  sku: string;
  value?: number;
}

interface Item {
  id: string;
  label?: string;
  tags?: string[];
  components?: Component[];
}

interface Shape {
  title?: string;
  meta: { version?: number; note?: string };
  tags?: string[];
  items: Item[];
}

const options = {
  keyBy: { items: "id", "items[].components": "sku" },
  replace: ["meta"],
} as const;
const merge = createMerger<Shape>(options);
const identity = fc.string({ minLength: 1, maxLength: 12 });

const component = fc.record({ sku: identity, value: fc.integer() }, { requiredKeys: ["sku"] });
const item = fc.record(
  {
    id: identity,
    label: fc.string(),
    tags: fc.array(fc.string()),
    components: fc.uniqueArray(component, { selector: (value) => value.sku }),
  },
  { requiredKeys: ["id"] },
);
const baseArbitrary: fc.Arbitrary<Shape> = fc.record(
  {
    title: fc.string(),
    meta: fc.record({ version: fc.integer(), note: fc.string() }, { requiredKeys: [] }),
    tags: fc.array(fc.string()),
    items: fc.uniqueArray(item, { selector: (value) => value.id }),
  },
  { requiredKeys: ["meta", "items"] },
);

const componentPatch = fc.oneof(
  component,
  fc.record({ sku: identity, $delete: fc.constant(true as const) }),
);
const itemPatch = fc.oneof(
  fc.record(
    {
      id: identity,
      label: fc.string(),
      tags: fc.array(fc.string()),
      components: fc.uniqueArray(componentPatch, { selector: (value) => value.sku }),
    },
    { requiredKeys: ["id"] },
  ),
  fc.record({ id: identity, $delete: fc.constant(true as const) }),
);
const deltaArbitrary = fc.record(
  {
    title: fc.oneof(fc.string(), fc.constant(DELETE)),
    meta: fc.record({ version: fc.integer(), note: fc.string() }, { requiredKeys: [] }),
    tags: fc.array(fc.string()),
    items: fc.uniqueArray(itemPatch, { selector: (value) => value.id }),
  },
  { requiredKeys: [] },
) as fc.Arbitrary<Delta<Shape>>;

const invalidIdentity = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.boolean(),
  fc.constant(Number.NaN),
  fc.constant({}),
);
const invalidDeltaArbitrary = fc.oneof(
  identity.map((id) => ({ items: [{ id }, { id }] })),
  identity.map((id) => ({ items: [{ id, $delete: true, label: undefined }] })),
  invalidIdentity.map((id) => ({ items: [{ id }] })),
  fc.tuple(identity, identity).map(([id, sku]) => ({
    items: [
      {
        id,
        components: [
          { sku, value: 1 },
          { sku, value: 2 },
        ],
      },
    ],
  })),
) as fc.Arbitrary<Delta<Shape>>;

function containsOperator(value: unknown): boolean {
  if (value === DELETE) return true;
  if (Array.isArray(value)) return value.some(containsOperator);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).some(
      ([key, child]) => key === "$delete" || containsOperator(child),
    );
  }
  return false;
}

describe("algebraic laws", () => {
  test("is value-idempotent", () => {
    fc.assert(
      fc.property(baseArbitrary, deltaArbitrary, (base, delta) => {
        const once = merge(base, delta);
        expect(merge(once, delta)).toEqual(once);
      }),
      { numRuns: 200 },
    );
  });

  test("is deterministic", () => {
    fc.assert(
      fc.property(baseArbitrary, deltaArbitrary, (base, delta) => {
        expect(merge(base, delta)).toEqual(merge(base, delta));
      }),
      { numRuns: 200 },
    );
  });

  test("never mutates the base", () => {
    fc.assert(
      fc.property(baseArbitrary, deltaArbitrary, (base, delta) => {
        const snapshot = structuredClone(base);
        merge(base, delta);
        expect(base).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  test("returns base by reference for an empty object delta", () => {
    fc.assert(
      fc.property(baseArbitrary, (base) => {
        expect(merge(base, {})).toBe(base);
      }),
    );
  });

  test("does not leak operators from interpreted positions", () => {
    fc.assert(
      fc.property(baseArbitrary, deltaArbitrary, (base, delta) => {
        expect(containsOperator(merge(base, delta))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  test("throws for generated invalid deltas without mutating base", () => {
    fc.assert(
      fc.property(baseArbitrary, invalidDeltaArbitrary, (base, delta) => {
        const snapshot = structuredClone(base);
        expect(() => merge(base, delta)).toThrow();
        expect(base).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });
});

describe("wire safety", () => {
  const mergeWire = createMerger<Shape>({ ...options, wireDeletes: true });
  const wireString = fc.oneof(fc.string(), fc.constant(DELETE_TOKEN));
  const wireDelta = fc
    .record(
      {
        title: wireString,
        meta: fc.record({ version: fc.integer(), note: wireString }, { requiredKeys: [] }),
        tags: fc.array(wireString),
        items: fc.uniqueArray(itemPatch, { selector: (value) => value.id }),
      },
      { requiredKeys: [] },
    )
    .map((value) => JSON.parse(JSON.stringify(value)) as Delta<Shape>);

  test("no JSON-only delta can produce an in-memory operator", () => {
    fc.assert(
      fc.property(baseArbitrary, wireDelta, (base, delta) => {
        expect(containsOperator(mergeWire(base, delta))).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
