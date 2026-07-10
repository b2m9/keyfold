import { describe, expect, test } from "vitest";
import { createMerger, DELETE, type Delta } from "../src/index.js";

interface Component {
  sku: string | number;
  label?: string;
  enabled?: boolean;
}

interface Item {
  id: string | number;
  sku: string;
  quantity: number;
  note?: string;
  components?: Component[];
}

interface State {
  items: Item[];
  untouched: { stable: true };
}

function state(): State {
  return {
    items: [
      {
        id: "a",
        sku: "WIDGET",
        quantity: 1,
        note: "fragile",
        components: [
          { sku: "CPU", label: "Old", enabled: true },
          { sku: "RAM", label: "16 GB", enabled: true },
        ],
      },
      { id: "b", sku: "GADGET", quantity: 3 },
    ],
    untouched: { stable: true },
  };
}

const merge = createMerger<State>({
  keyBy: { items: "id", "items[].components": "sku" },
});

describe("keyed-list reconciliation", () => {
  test("updates, deletes, and appends without disturbing survivor order", () => {
    const next = merge(state(), {
      items: [
        { id: "b", quantity: 5 },
        { id: "a", $delete: true },
        { id: "c", sku: "NEW", quantity: 1 },
      ],
    });

    expect(next.items).toEqual([
      { id: "b", sku: "GADGET", quantity: 5 },
      { id: "c", sku: "NEW", quantity: 1 },
    ]);
  });

  test("matches string and numeric ids strictly while accepting 0 and empty string", () => {
    const mergeIds = createMerger<{ items: Array<{ id: string | number; value: number }> }>({
      keyBy: { items: "id" },
    });
    const base = {
      items: [
        { id: 1, value: 1 },
        { id: "1", value: 2 },
        { id: 0, value: 3 },
        { id: "", value: 4 },
      ],
    };

    expect(
      mergeIds(base, {
        items: [
          { id: 1, value: 10 },
          { id: "1", value: 20 },
          { id: 0, value: 30 },
          { id: "", value: 40 },
        ],
      }).items,
    ).toEqual([
      { id: 1, value: 10 },
      { id: "1", value: 20 },
      { id: 0, value: 30 },
      { id: "", value: 40 },
    ]);
  });

  test("shares unmentioned items and sibling subtrees", () => {
    const base = state();
    const next = merge(base, { items: [{ id: "b", quantity: 8 }] });

    expect(next.items[0]).toBe(base.items[0]);
    expect(next.untouched).toBe(base.untouched);
  });

  test("reconciles nested keyed lists relative to their parent item", () => {
    const base = state();
    const next = merge(base, {
      items: [
        {
          id: "a",
          components: [
            { sku: "CPU", label: "New" },
            { sku: "RAM", $delete: true },
            { sku: "SSD", label: "1 TB", enabled: true },
          ],
        },
      ],
    });

    expect(next.items[0]?.components).toEqual([
      { sku: "CPU", label: "New", enabled: true },
      { sku: "SSD", label: "1 TB", enabled: true },
    ]);
    expect(next.items[1]).toBe(base.items[1]);
  });

  test("folds inserts so nested operators cannot leak", () => {
    const next = merge(state(), {
      items: [
        {
          id: "c",
          sku: "NEW",
          quantity: 1,
          note: DELETE,
          components: [
            { sku: "MISSING", $delete: true },
            { sku: "CPU", label: "3.8 GHz" },
          ],
        },
      ],
    });

    expect(next.items.at(-1)).toEqual({
      id: "c",
      sku: "NEW",
      quantity: 1,
      components: [{ sku: "CPU", label: "3.8 GHz" }],
    });
  });

  test("reconciles a keyed delta against an empty list after a type mismatch", () => {
    const mergeUnknown = createMerger<Record<string, unknown>>({ keyBy: { items: "id" } });
    const next = mergeUnknown({ items: "wrong shape" }, {
      items: [
        { id: "a", value: 1 },
        { id: "missing", $delete: true },
      ],
    } as Delta<Record<string, unknown>>);

    expect(next.items).toEqual([{ id: "a", value: 1 }]);
  });
});

describe("item replacement", () => {
  const replaceItems = createMerger<State>({
    keyBy: { items: "id" },
    replace: ["items[]"],
  });

  test("swaps matched items, preserves unmentioned items, and copies inserts verbatim", () => {
    const base = state();
    const inserted = { id: "c", sku: "NEW", quantity: 1 };
    const next = replaceItems(base, {
      items: [{ id: "b", quantity: 9 }, inserted],
    });

    expect(next.items[0]).toBe(base.items[0]);
    expect(next.items[1]).toEqual({ id: "b", quantity: 9 });
    expect(next.items[2]).toBe(inserted);
  });

  test("preserves DELETE as inert data inside a verbatim insert (documented UB)", () => {
    const next = replaceItems(state(), {
      items: [{ id: "c", sku: "NEW", quantity: 1, note: DELETE }],
    });

    expect(next.items.at(-1)?.note).toBe(DELETE);
  });
});

describe("ambiguity and failure safety", () => {
  test.each([
    ["missing identity", [{ quantity: 1 }]],
    ["null identity", [{ id: null }]],
    ["undefined identity", [{ id: undefined }]],
    ["NaN identity", [{ id: Number.NaN }]],
    ["object identity", [{ id: {} }]],
    ["duplicate delta identity", [{ id: "a" }, { id: "a" }]],
    [
      "tombstone then patch",
      [
        { id: "a", $delete: true },
        { id: "a", quantity: 2 },
      ],
    ],
    ["mixed tombstone", [{ id: "a", $delete: true, quantity: 2 }]],
    ["mixed tombstone with undefined field", [{ id: "a", $delete: true, quantity: undefined }]],
    ["non-true tombstone", [{ id: "a", $delete: false }]],
  ])("throws for %s without mutating base", (_case, items) => {
    const base = state();
    const snapshot = structuredClone(base);

    expect(() => merge(base, { items } as unknown as Delta<State>)).toThrow();
    expect(base).toEqual(snapshot);
  });

  test("detects duplicate ids in a touched base list, even for an empty list delta", () => {
    const base = state();
    base.items.push({ id: "a", sku: "DUPLICATE", quantity: 1 });

    expect(() => merge(base, { items: [] })).toThrow(/duplicate identity/);
  });

  test("detects nested duplicate ids while folding an inserted item", () => {
    expect(() =>
      merge(state(), {
        items: [
          {
            id: "c",
            sku: "NEW",
            quantity: 1,
            components: [
              { sku: "CPU", label: "first" },
              { sku: "CPU", label: "second" },
            ],
          },
        ],
      }),
    ).toThrow(/duplicate identity/);
  });

  test("deleting an absent item is a no-op", () => {
    const base = state();
    expect(merge(base, { items: [{ id: "missing", $delete: true }] })).toEqual(base);
  });

  test("rejects the reserved tombstone field in base data", () => {
    const base = state();
    (base.items[0] as unknown as Record<string, unknown>).$delete = false;
    expect(() => merge(base, { items: [{ id: "b", quantity: 4 }] })).toThrow(/reserved/);
  });
});
