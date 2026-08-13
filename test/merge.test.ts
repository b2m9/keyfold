import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { createMerger, DELETE, type Delta } from "../src/index.js";

interface Profile {
  name: string;
  nickname?: string;
  address: { line1: string; line2?: string; city: string };
  tags: string[];
  lastSeen: string | null;
}

function profile(): Profile {
  return {
    name: "Ada",
    nickname: "ada",
    address: { line1: "5 Main St", line2: "Attic", city: "Aarhus" },
    tags: ["admin"],
    lastSeen: "2026-07-01",
  };
}

describe("object folding", () => {
  const merge = createMerger<Profile>();

  test("deep-merges objects and preserves absent base fields", () => {
    const next = merge(profile(), {
      name: "Ada L.",
      address: { city: "Copenhagen" },
    });

    expect(next).toEqual({
      name: "Ada L.",
      nickname: "ada",
      address: { line1: "5 Main St", line2: "Attic", city: "Copenhagen" },
      tags: ["admin"],
      lastSeen: "2026-07-01",
    });
  });

  test("distinguishes DELETE, null, and undefined", () => {
    const next = merge(profile(), {
      nickname: DELETE,
      lastSeen: null,
      name: undefined,
    });

    expect(next).not.toHaveProperty("nickname");
    expect(next.lastSeen).toBeNull();
    expect(next.name).toBe("Ada");
  });

  test("replaces unkeyed arrays verbatim", () => {
    const tags = ["viewer", "editor"];
    expect(merge(profile(), { tags }).tags).toBe(tags);
  });

  test("replaces non-plain objects instead of recursing into them", () => {
    const mergeUnknown = createMerger<Record<string, unknown>>();
    const timestamp = new Date("2026-07-07");
    const next = mergeUnknown({ value: { year: 2025 } }, { value: timestamp });

    expect(next.value).toBe(timestamp);
  });

  test("replaces records built in another realm", () => {
    // Pins the documented realm limit rather than a desirable behavior. This
    // record is opaque only because its Object.prototype is not ours, and no
    // reliable test tells it apart from a class instance.
    const mergeUnknown = createMerger<Record<string, unknown>>();
    const foreign: unknown = runInNewContext("({ city: 'Copenhagen' })");
    const next = mergeUnknown(
      { address: { line1: "5 Main St", city: "Aarhus" } },
      { address: foreign },
    );

    expect(next.address).toBe(foreign);
  });

  test("passes a cycle through wherever the fold does not recurse", () => {
    // Pins the documented limit rather than a desirable behavior. Cyclic input
    // is outside the contract, but only a cycle the fold recurses through
    // costs anything; carrying one across adds no traversal.
    const mergeUnknown = createMerger<Record<string, unknown>>({ replace: ["cfg"] });
    const cyclic: Record<string, unknown> = { name: "c" };
    cyclic.self = cyclic;
    const unkeyed = [cyclic];

    expect(mergeUnknown({ cyclic, other: 1 }, { other: 2 }).cyclic).toBe(cyclic);
    expect(mergeUnknown({}, { cfg: cyclic } as Delta<Record<string, unknown>>).cfg).toBe(cyclic);
    expect(mergeUnknown({}, { unkeyed } as Delta<Record<string, unknown>>).unkeyed).toBe(unkeyed);
    expect(() => mergeUnknown({}, { deep: cyclic } as Delta<Record<string, unknown>>)).toThrow(
      RangeError,
    );
  });

  test("preserves and merges own enumerable symbol keys", () => {
    const metadata = Symbol("metadata");
    const mergeSymbols = createMerger<{
      name: string;
      [metadata]?: { kept: number; changed?: number };
    }>();
    const symbolValue = { kept: 1 };
    const base = { name: "before", [metadata]: symbolValue };

    expect(mergeSymbols(base, { name: "after" })[metadata]).toBe(symbolValue);
    expect(mergeSymbols(base, { [metadata]: { changed: 2 } })[metadata]).toEqual({
      kept: 1,
      changed: 2,
    });
  });

  test("folds a plain-object delta onto an empty object after a type mismatch", () => {
    const mergeUnknown = createMerger<Record<string, unknown>>();
    const next = mergeUnknown({ value: 5 }, { value: { kept: 1, removed: DELETE } } as Delta<
      Record<string, unknown>
    >);

    expect(next.value).toEqual({ kept: 1 });
  });

  test.each([
    ["an absent field", {}],
    ["an undefined field", { value: undefined }],
    ["a wrong-shaped field", { value: 5 }],
  ])(
    "does not materialize an object for an operator that finds nothing against %s",
    (_case, base) => {
      const mergeUnknown = createMerger<Record<string, unknown>>();
      const delta = { value: { removed: DELETE } } as Delta<Record<string, unknown>>;

      expect(mergeUnknown(base, delta)).toBe(base);
    },
  );

  test.each([
    ["an absent field", {}],
    ["an undefined field", { value: undefined }],
    ["a wrong-shaped field", { value: 5 }],
  ])("materializes an explicitly empty object over %s", (_case, base) => {
    const mergeUnknown = createMerger<Record<string, unknown>>();
    // A container of only unmentioned fields is empty for the same reason a
    // literal '{}' is: JSON.stringify erases those fields on the way out, so
    // the wire form and the in-memory form must agree.
    const deltas = [{ value: {} }, { value: { unmentioned: undefined } }] as Delta<
      Record<string, unknown>
    >[];

    for (const delta of deltas) expect(mergeUnknown(base, delta)).toEqual({ value: {} });
  });
});

describe("immutability and structural sharing", () => {
  const merge = createMerger<Profile>();

  test("does not mutate base and shares untouched subtrees", () => {
    const base = profile();
    const snapshot = structuredClone(base);
    const next = merge(base, { name: "Grace" });

    expect(base).toEqual(snapshot);
    expect(next.address).toBe(base.address);
    expect(next.tags).toBe(base.tags);
  });

  test("returns base itself for an empty object delta", () => {
    const base = profile();
    expect(merge(base, {})).toBe(base);
  });

  test("returns base itself when a delta restates current values", () => {
    const base = profile();
    const next = merge(base, {
      name: "Ada",
      nickname: undefined,
      address: { city: "Aarhus" },
      lastSeen: "2026-07-01",
    });

    expect(next).toBe(base);
  });
});

describe("replace paths", () => {
  test("materializes an explicitly replaced empty object", () => {
    const merge = createMerger<Record<string, unknown>>({ replace: ["settings"] });
    const settings = {};
    const next = merge({}, { settings });

    expect(next.settings).toBe(settings);
  });

  test("swap an object subtree wholesale", () => {
    const merge = createMerger<Profile>({ replace: ["address"] });
    const address = { line1: "1 New Road", city: "Berlin" };
    const next = merge(profile(), { address });

    expect(next.address).toBe(address);
    expect(next.address).not.toHaveProperty("line2");
  });

  test("copy nested operators verbatim in a replacement (documented UB)", () => {
    const merge = createMerger<Profile>({ replace: ["address"] });
    const address = { line1: "1 New Road", city: "Berlin", line2: DELETE };
    const next = merge(profile(), { address } as unknown as Delta<Profile>);

    expect((next.address as Record<string, unknown>).line2).toBe(DELETE);
  });

  test("still interprets a field delete at the replace path itself", () => {
    const merge = createMerger<{ note?: { text: string } }>({ replace: ["note"] });
    expect(merge({ note: { text: "hello" } }, { note: DELETE })).toEqual({});
  });
});

describe("plain-object safety", () => {
  const merge = createMerger<Record<string, unknown>>();

  test("drops unsafe delta keys without altering prototypes", () => {
    const delta = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"x":1},"prototype":{"y":2},"ok":3}',
    ) as Delta<Record<string, unknown>>;
    const next = merge({ kept: 1 }, delta);

    expect(next).toEqual({ kept: 1, ok: 3 });
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("preserves an unsafe own base key as inert data", () => {
    const base = JSON.parse('{"__proto__":{"x":1},"kept":1}') as Record<string, unknown>;
    const next = merge(base, { kept: 2 });

    expect(Object.hasOwn(next, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(next)).toBe(Object.prototype);
  });

  test("materializes a container of only unsafe keys as a safe empty object", () => {
    // Unsafe keys are skipped wherever a delta object is folded, so a
    // container holding nothing else is empty and materializes like any
    // other. What lands is a clean object, never the prototype the delta
    // tried to smuggle in.
    const delta = JSON.parse('{"value":{"__proto__":{"polluted":true}}}') as Delta<
      Record<string, unknown>
    >;
    const next = merge({}, delta);

    expect(next).toEqual({ value: {} });
    expect(Object.getPrototypeOf(next.value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("never reads an unsafe key, not even to decide whether a container is empty", () => {
    // Deciding emptiness must not become a second path that follows a key the
    // fold itself refuses to follow.
    let reads = 0;
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, "__proto__", {
      configurable: true,
      enumerable: true,
      get: () => {
        reads += 1;
        return { polluted: true };
      },
    });

    expect(merge({}, { value: hostile } as Delta<Record<string, unknown>>)).toEqual({ value: {} });
    expect(reads).toBe(0);
  });

  test("preserves the prototype of a null-prototype plain object", () => {
    const base = Object.assign(Object.create(null) as Record<string, unknown>, { kept: 1 });
    const next = merge(base, { kept: 2 });

    expect(Object.getPrototypeOf(next)).toBeNull();
    expect("toString" in next).toBe(false);
    expect(next.kept).toBe(2);
  });

  test("does not treat inherited properties as base data", () => {
    const next = merge({}, { toString: { custom: true } } as Delta<Record<string, unknown>>);
    expect(next["toString"]).toEqual({ custom: true });
  });
});

describe("trusted config paths", () => {
  test("a typo silently leaves the real array unkeyed", () => {
    const merge = createMerger<Record<string, unknown>>({ keyBy: { itmes: "id" } });
    const next = merge({ items: [{ id: "a" }, { id: "b" }] }, { items: [{ id: "b", value: 2 }] });

    expect(next.items).toEqual([{ id: "b", value: 2 }]);
  });

  test("a keyBy policy landing on primitives fails at merge time", () => {
    const merge = createMerger<Record<string, unknown>>({ keyBy: { items: "id" } });
    expect(() => merge({ items: [1, 2] }, { items: [3] })).toThrow(/not an object/);
  });

  test("a literal data key named [] never inherits list-item policy", () => {
    const merge = createMerger<Record<string, unknown>>({
      keyBy: { list: "id" },
      replace: ["list[]"],
    });
    const next = merge({ list: { "[]": { keep: 1, other: 2 } } }, { list: { "[]": { keep: 9 } } });

    expect(next.list).toEqual({ "[]": { keep: 9, other: 2 } });
  });
});
