import { describe, expect, test } from "vitest";
import { createMerger } from "../src/index.js";

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
    expect(() => createMerger(options)).toThrow(TypeError);
  });

  test.each(["", "$delete", "__proto__", "constructor", "prototype", "id[]", "a.b"])(
    "rejects identity field %j",
    (identityField) => {
      expect(() => createMerger({ keyBy: { items: identityField } })).toThrow(TypeError);
    },
  );

  test("rejects a keyBy path ending in []", () => {
    expect(() => createMerger({ keyBy: { "items[]": "id" } })).toThrow(/addresses items/);
  });

  test("rejects duplicate replace paths", () => {
    expect(() => createMerger({ replace: ["a.b", "a.b"] })).toThrow(/duplicate/);
  });

  test.each([
    { keyBy: { "order.items": "id" }, replace: ["order.items"] },
    { keyBy: { "order.items": "id" }, replace: ["order"] },
    {
      keyBy: { "order.items": "id", "order.items[].components": "sku" },
      replace: ["order.items[]"],
    },
  ])("rejects a replace path that makes a keyBy policy unreachable", (options) => {
    expect(() => createMerger(options)).toThrow(/unreachable/);
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
});
