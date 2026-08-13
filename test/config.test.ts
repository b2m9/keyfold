import { describe, expect, test } from "vite-plus/test";
import { createMerger, KeyfoldConfigError, type MergeOptions } from "../src/index.js";

/** A `replace` array whose last index is a hole rather than a value. */
function withTrailingHole(...paths: string[]): unknown[] {
  const sparse: unknown[] = [...paths];
  sparse.length = paths.length + 1;
  return sparse;
}

/** The same array, with the hole resolving to an inherited value instead. */
function withInheritedHole(...paths: string[]): unknown[] {
  const sparse = withTrailingHole(...paths);
  const donor: unknown[] = [];
  donor[paths.length] = "injected.path";
  Object.setPrototypeOf(sparse, donor);
  return sparse;
}

describe("configuration validation", () => {
  test.each([
    ["empty", { keyBy: { "": "id" } }],
    ["empty segment", { keyBy: { "order..items": "id" } }],
    ["bare item marker", { replace: ["order.[]"] }],
    ["array index", { replace: ["items[0]"] }],
    ["text after item marker", { replace: ["items[]x"] }],
    ["double item marker", { replace: ["items[][]"] }],
    ["unsafe segment", { replace: ["constructor.name"] }],
  ])("rejects a %s path", (_case, options) => {
    expect(() => createMerger(options)).toThrow(KeyfoldConfigError);
  });

  test.each(["", "$delete", "__proto__", "constructor", "prototype", "id[]", "a.b"])(
    "rejects identity field %j",
    (identityField) => {
      expect(() => createMerger({ keyBy: { items: identityField } })).toThrow(KeyfoldConfigError);
    },
  );

  test("rejects a keyBy path ending in []", () => {
    expect(() => createMerger({ keyBy: { "items[]": "id" } })).toThrow(/addresses items/);
  });

  test("rejects duplicate replace paths", () => {
    expect(() => createMerger({ replace: ["a.b", "a.b"] })).toThrow(/duplicate/);
  });

  const unreachableOptions: MergeOptions[] = [
    { keyBy: { "order.items": "id" }, replace: ["order.items"] },
    { keyBy: { "order.items": "id" }, replace: ["order"] },
    {
      keyBy: { "order.items": "id", "order.items[].components": "sku" },
      replace: ["order.items[]"],
    },
  ];

  test.each(unreachableOptions)(
    "rejects a replace path that makes a keyBy policy unreachable",
    (options) => {
      expect(() => createMerger(options)).toThrow(/unreachable/);
    },
  );

  test("rejects a replace path shadowed by a broader replace path", () => {
    expect(() => createMerger({ replace: ["a", "a.b"] })).toThrow(/unreachable/);
    expect(() => createMerger({ replace: ["a.b", "a"] })).toThrow(/unreachable/);
  });

  test("accepts the keyed-list item replacement idiom", () => {
    expect(() =>
      createMerger({ keyBy: { "order.items": "id" }, replace: ["order.items[]"] }),
    ).not.toThrow();
  });

  test("rejects [] below an unkeyed array", () => {
    expect(() => createMerger({ replace: ["items[]"] })).toThrow(/no keyBy/);
    expect(() => createMerger({ keyBy: { "items[].components": "sku" } })).toThrow(/no keyBy/);
  });

  test("rejects paths that step through a keyed list without []", () => {
    expect(() => createMerger({ keyBy: { items: "id" }, replace: ["items.tags"] })).toThrow(
      /without the '\[\]' suffix/,
    );
  });

  test("rejects a non-boolean wireDeletes value from untyped JavaScript", () => {
    expect(() => createMerger({ wireDeletes: "yes" } as never)).toThrow(/boolean/);
  });

  test.each([
    ["null options", null],
    ["string options", "items"],
    ["array options", []],
    ["Map options", new Map()],
    ["null keyBy", { keyBy: null }],
    ["array keyBy", { keyBy: [] }],
    ["Map keyBy", { keyBy: new Map([["items", "id"]]) }],
    ["string replace", { replace: "items" }],
    ["non-string replace path", { replace: [1] }],
    // A hole is skipped by `map` but visited by `for...of`. Placing one after
    // a valid path also proves no policy compiles before the array is refused.
    ["trailing hole in replace", { replace: withTrailingHole("a.b") }],
    // Validation reads own indices, so an inherited value at the missing index
    // cannot disguise the hole as a path the caller supplied.
    ["hole shadowed by an inherited path", { replace: withInheritedHole("a.b") }],
  ])("rejects %s from untyped JavaScript", (_case, options) => {
    expect(() => createMerger(options as never)).toThrow(KeyfoldConfigError);
  });

  test("names a hole rather than reporting an undefined path", () => {
    expect(() => createMerger({ replace: withTrailingHole("a.b") } as never)).toThrow(/dense/);
    expect(() => createMerger({ replace: ["a.b", undefined] } as never)).toThrow(/got undefined/);
  });

  test("accepts a null-prototype options record", () => {
    const options = Object.assign(Object.create(null) as MergeOptions, {
      keyBy: { items: "id" },
    });
    expect(() => createMerger(options)).not.toThrow();
  });
});
