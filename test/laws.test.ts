import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
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
  profile?: { nickname?: string };
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
    profile: fc.record({ nickname: fc.string() }, { requiredKeys: [] }),
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
    // Optional in the base and able to generate '{}', so every law below sees
    // an empty container materialize over an absent field.
    profile: fc.record({ nickname: fc.string() }, { requiredKeys: [] }),
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

  test("re-applying the same delta returns the same reference", () => {
    // Stronger than value-idempotence: the second application writes only
    // values that are already there, so nothing is copied and the previous
    // result comes back by reference. This applies the same delta object
    // twice; the law below marks where a separately parsed copy stops.
    fc.assert(
      fc.property(baseArbitrary, deltaArbitrary, (base, delta) => {
        const once = merge(base, delta);
        expect(merge(once, delta)).toBe(once);
      }),
      { numRuns: 200 },
    );
  });

  test("a re-decoded frame keeps the reference only for Object.is-equal replacements", () => {
    // Pins the documented limit rather than a desirable behavior. Merged
    // values are judged by value, so re-decoding them costs nothing. A
    // replacement is unchanged only under Object.is, which ordinary JSON
    // parsing satisfies for primitives and never for objects or arrays.
    const base: Shape = { meta: {}, items: [] };
    const reapply = (frame: string) => {
      const parse = () => JSON.parse(frame) as Delta<Shape>;
      const once = merge(base, parse());
      return { once, again: merge(once, parse()) };
    };

    const merged = reapply('{"title":"t","items":[{"id":"a"}]}');
    expect(merged.again).toBe(merged.once);

    // An unkeyed array and a configured replace path, so neither route to a
    // replacement can start comparing by value without failing here.
    for (const frame of ['{"tags":["x"]}', '{"meta":{"version":1}}']) {
      const { once, again } = reapply(frame);
      expect(again).not.toBe(once);
      expect(again).toEqual(once);
    }

    // A primitive replacement survives decoding, so the line falls at what
    // parsing allocates rather than at replacement itself.
    const mergePrimitive = createMerger<{ meta: string }>({ replace: ["meta"] });
    const parsePrimitive = () => JSON.parse('{"meta":"new"}') as Delta<{ meta: string }>;
    const primitive = mergePrimitive({ meta: "old" }, parsePrimitive());
    expect(mergePrimitive(primitive, parsePrimitive())).toBe(primitive);
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

  test("a delta and its JSON form agree", () => {
    // Serializing erases the fields a delta leaves unmentioned, so a container
    // of nothing but those fields arrives as an empty one. Emptiness is judged
    // by the fields the fold interprets precisely so the two cannot diverge.
    const unmentioned = <T>(arbitrary: fc.Arbitrary<T>) =>
      fc.oneof(arbitrary, fc.constant(undefined));
    const jsonSafeDelta = fc.record({
      title: unmentioned(fc.string()),
      profile: unmentioned(fc.record({ nickname: unmentioned(fc.string()) })),
      items: unmentioned(
        fc.uniqueArray(fc.record({ id: identity, label: unmentioned(fc.string()) }), {
          selector: (value) => value.id,
        }),
      ),
    }) as fc.Arbitrary<Delta<Shape>>;

    fc.assert(
      fc.property(baseArbitrary, jsonSafeDelta, (base, delta) => {
        const wire = JSON.parse(JSON.stringify(delta)) as Delta<Shape>;
        expect(mergeWire(base, wire)).toEqual(mergeWire(base, delta));
      }),
      { numRuns: 200 },
    );
  });
});
