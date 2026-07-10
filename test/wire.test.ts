import { describe, expect, test } from "vitest";
import { createMerger, DELETE, DELETE_TOKEN, type Delta } from "../src/index.js";

interface State {
  note?: string;
  literal: { value: string };
  tags: string[];
  items: Array<{ id: string; label?: string }>;
}

const base: State = {
  note: "remove me",
  literal: { value: "old" },
  tags: ["old"],
  items: [{ id: "a", label: "remove me" }],
};

describe("wire deletes", () => {
  test("the token is ordinary data by default", () => {
    const merge = createMerger<State>();
    expect(merge(base, { note: DELETE_TOKEN }).note).toBe(DELETE_TOKEN);
  });

  test("the token and symbol are equivalent at interpreted field positions", () => {
    const merge = createMerger<State>({ keyBy: { items: "id" }, wireDeletes: true });
    const tokenDelta = {
      note: DELETE_TOKEN,
      items: [{ id: "a", label: DELETE_TOKEN }],
    } as Delta<State>;
    const symbolDelta: Delta<State> = {
      note: DELETE,
      items: [{ id: "a", label: DELETE }],
    };

    expect(merge(base, tokenDelta)).toEqual(merge(base, symbolDelta));
    expect(merge(base, tokenDelta)).toEqual({
      literal: { value: "old" },
      tags: ["old"],
      items: [{ id: "a" }],
    });
  });

  test("keeps nested tokens inside replace values and unkeyed arrays as strings", () => {
    const merge = createMerger<State>({ replace: ["literal"], wireDeletes: true });
    const literal = { value: DELETE_TOKEN };
    const tags = [DELETE_TOKEN];
    const next = merge(base, { literal, tags });

    expect(next.literal).toBe(literal);
    expect(next.literal.value).toBe(DELETE_TOKEN);
    expect(next.tags).toBe(tags);
  });

  test("item tombstones work with wireDeletes on or off", () => {
    const options = { keyBy: { items: "id" } } as const;
    const delta = { items: [{ id: "a", $delete: true as const }] };

    expect(createMerger<State>(options)(base, delta).items).toEqual([]);
    expect(createMerger<State>({ ...options, wireDeletes: true })(base, delta).items).toEqual([]);
  });

  test("rejects DELETE_TOKEN as an identity when wire interpretation is enabled", () => {
    const merge = createMerger<State>({ keyBy: { items: "id" }, wireDeletes: true });
    expect(() => merge(base, { items: [{ id: DELETE_TOKEN, label: "ambiguous" }] })).toThrow(
      /wire token/,
    );
  });

  test("cannot statically protect required string fields from the reserved token", () => {
    interface RequiredState {
      note: string;
    }
    const merge = createMerger<RequiredState>({ wireDeletes: true });
    const delta: Delta<RequiredState> = { note: DELETE_TOKEN };

    // TypeScript cannot exclude one string literal from the broad `string`
    // type, so parsed wire deltas remain a caller-owned validation boundary.
    expect(merge({ note: "required" }, delta)).toEqual({});
  });
});
