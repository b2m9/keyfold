# @b2m9/keyfold

Fold partial deltas into a nested state tree: **JSON Merge Patch that understands your keyed lists.**

Partial payloads and arrays are an awkward combination. `lodash.merge` matches arrays by index, so this update:

```ts
const base = {
  items: [
    { id: "a", quantity: 1 },
    { id: "b", quantity: 3 },
  ],
};
const delta = { items: [{ id: "b", quantity: 5 }] };
```

can corrupt the list into two `b` items. JSON Merge Patch (RFC 7396) avoids the corruption only by treating every array as opaque and replacing it wholesale, so the standard abandons you the moment your state has keyed lists. `keyfold` matches configured lists by identity instead:

```ts
import { createMerger } from "@b2m9/keyfold";

const merge = createMerger<typeof base>({ keyBy: { items: "id" } });

merge(base, delta).items;
// [{ id: "a", quantity: 1 }, { id: "b", quantity: 5 }]
```

`keyfold` applies partial updates to plain state trees, immutably and with zero dependencies. Objects merge, keyed lists reconcile, unkeyed arrays and scalars replace, and deletes are explicit.

Use it for websocket reducers, optimistic UI reconciliation, form autosave, configurator recalculation, and other places where partial updates from a single authoritative source land in nested, keyed state. Normalizing caches such as Apollo, Relay, and RTK Query already do this internally; `keyfold` is for the state they don't hold.

## Install

```sh
npm install @b2m9/keyfold
```

`keyfold` is a typed, tree-shakeable ESM package with no runtime dependencies.

## Usage

```ts
import { createMerger, DELETE, type Delta } from "@b2m9/keyfold";

interface OrderState {
  order: {
    customer: { name: string; tier?: string };
    coupon?: string;
    items: Array<{
      id: string;
      sku: string;
      quantity: number;
      tags?: string[];
    }>;
  };
}

const merge = createMerger<OrderState>({
  keyBy: { "order.items": "id" },
});

const next = merge(state, {
  order: {
    customer: { tier: "platinum" },
    coupon: DELETE,
    items: [
      { id: "b", quantity: 5, tags: ["rush"] },
      { id: "a", $delete: true },
    ],
  },
});
```

The original `state` is untouched. Unmentioned object fields and list items survive, matching items are folded at their existing positions, new items append, and tombstones remove whole items. Untouched sibling subtrees retain their references.

## API

### `createMerger<T, Atomic = never>(options?)`

Creates a reusable `(base: T, delta: Delta<T, Atomic>) => T` function.

```ts
const merge = createMerger<State>({
  keyBy: {
    "order.items": "id",
    "order.items[].components": "sku",
  },
  replace: ["order.shippingAddress"],
  wireDeletes: true,
});
```

`options` and `keyBy` must be plain objects from the current realm, or null-prototype records; `replace` must be a dense array of strings. Maps, class instances, foreign-realm records, and holes in `replace` all throw `KeyfoldConfigError` when the merger is created, so a `Map` of paths is rejected rather than read as an empty policy. Normalize foreign configuration with `structuredClone` first; a spread only reaches the outermost container.

`keyBy` maps a list path to its identity field. Identity values must be stable, unique strings or numbers. Matching is strict, so `1` and `"1"` are different items, while `0` and `""` are valid identities. Missing, duplicate, `NaN`, and non-string/non-number identities throw.

`replace` makes a path swap wholesale instead of deep-merging or reconciling. A wholesale swap never recurses, so `createMerger` rejects any policy nested below a replaced path. The `"order.items[]"` form is the item-swap idiom: the list still matches items by identity, but each matched item is replaced by its incoming value instead of merged:

```ts
const replaceItems = createMerger<State>({
  keyBy: { "order.items": "id" },
  replace: ["order.items[]"],
});
```

Once a replacement boundary is reached the value is taken verbatim and its
contents are never traversed. At `items[]` the enclosing reconciliation still
reads the item's identity and tombstone syntax first, because that is what
decides which item the boundary applies to.

`wireDeletes` lets JSON deltas spell a field delete as the exported `DELETE_TOKEN` string. It is off by default and detailed under Deletes below.

The optional `Atomic` type parameter keeps custom non-plain values whole in the delta type, matching the runtime rule that class instances replace rather than merge:

```ts
class Money {
  readonly #nominal = true;

  constructor(readonly cents: number) {}
}

interface State {
  total: Money;
}

const mergeMoney = createMerger<State, Money>();
mergeMoney(state, { total: new Money(1999) });
```

Built-ins such as `Date`, `Error`, `Map`, `Set`, `RegExp`, and promises are already atomic. Declare custom classes and other application-specific opaque types explicitly; otherwise TypeScript cannot distinguish their instances from structural object types. `Atomic` only changes the delta type, and TypeScript matching stays structural, so give the class a private field, as above, when actual identity matters.

### Deletes

The three field operations are deliberately distinct:

```ts
merge(state, {
  coupon: DELETE, // remove the field
  note: null, // keep the field and set it to null
  title: undefined, // ignore this field
});
```

Deleting a missing field is a no-op all the way up the tree. For example,
deleting `profile.nickname` from `{}` returns the original `{}` instead of
creating `{ profile: {} }`.

Inside a keyed list, `{ id, $delete: true }` removes the whole item. `$delete` is reserved on keyed items: any value other than `true` throws, and so does a tombstone carrying any further interpreted field. Unsafe keys on a tombstone are ignored, as they are during recursive object folding.

For JSON transports, both sides can use the fixed exported token:

```ts
import { createMerger, DELETE_TOKEN, type Delta } from "@b2m9/keyfold";

const merge = createMerger<State>({ wireDeletes: true });
const json = JSON.stringify({ coupon: DELETE_TOKEN });
const delta = JSON.parse(json) as Delta<State>;

merge(state, delta); // removes coupon
```

The token is interpreted only as an object field value. Nested inside a wholesale `replace` value or an unkeyed array, it remains an ordinary string. Item tombstones are already JSON-native and do not require `wireDeletes`.

There is deliberately no "clear the list" operator: an empty keyed-list delta
performs no item operations, so an existing list keeps its items and its
reference. To empty an existing keyed list, tombstone every item, or leave the
list unkeyed on a merger where wholesale replacement is what you mean.

### Errors

`createMerger` throws `KeyfoldConfigError` for malformed or contradictory options. A merger throws `KeyfoldMergeError` for the keyed-list protocol violations it detects, such as invalid or duplicate identities, malformed tombstones, and reserved values. Other out-of-contract input is not necessarily detected, and some of it throws natively instead — a cycle the fold recurses through raises `RangeError`. Both classes are exported for `instanceof` matching, and a throw never leaves a partially merged tree behind.

## Paths

Paths are dot-separated property names. `[]` means “inside each keyed item of the preceding list”:

```ts
"order.items";
"order.items[].components";
"order.items[].components[]";
```

There are no wildcards, indices, root tokens, or escaping. Properties containing `.`, `[`, or `]` are not addressable in v1. The root cannot be keyed; wrap a top-level array in an object when it needs reconciliation.

All configuration is validated when the merger is created: bad grammar, reserved names, duplicates, `[]` segments under lists that have no key, and policies made unreachable by a broader `replace` all throw. Paths are never checked against `T` or runtime data.

## Semantics

- Plain objects deep-merge using own enumerable fields.
- Keyed lists reconcile by identity; survivors retain base order and inserts append.
- Unkeyed arrays, scalars, and non-plain objects replace wholesale.
- An empty object or keyed list in a delta is data: it ensures the field exists, replacing an absent or wrong-shaped value with an empty container. A container is empty when it mentions no field the fold interprets, so `{}` and `{ field: undefined }` mean the same thing here and survive JSON alike.
- An operator that finds nothing to do is not data. Deleting an absent field, or tombstoning an absent item, preserves the original value and reference all the way up the tree, and never conjures a container to operate on.
- New keyed items are folded onto nothing, so they follow those same rules. A `replace` boundary or unkeyed array inside the item is taken verbatim.
- `__proto__`, `constructor`, and `prototype` keys in deltas are ignored wherever a delta object is folded, and never read. Inside a replaced value they are data like anything else.
- The base is never mutated. A throw cannot leave a partial write behind.
- A merge that changes nothing returns the base reference. Merged values count as unchanged when they are equal by value; replaced values count as unchanged only when they are the very same reference.
- Every valid delta is deterministic and idempotent: re-applying the same delta returns the previous result by reference, so a store can drop duplicate frames with one equality check.

Once a replacement boundary is reached, replaced values, unkeyed arrays, and non-plain objects are taken as-is and their contents are never traversed or sanitized; that is what keeps replacement cheap. A `DELETE` or `$delete` inside such a value is not an operator, just data the caller put there. Before an `items[]` boundary, reconciliation still runs its normal item-shape, identity, uniqueness and tombstone checks, since that is what decides which item is being replaced.

## Guardrails

`keyfold` folds one authoritative delta into a state tree. It is last-delta-wins: not a CRDT, operational transform, store, normalized cache, schema validator, or persistence layer.

Nor is it an implementation of JSON Merge Patch; the tagline describes lineage, not wire compatibility. RFC 7396 spells deletion as `null`, which `keyfold` deliberately keeps as data, so feeding an actual merge-patch document to a merger sets fields to `null` instead of deleting them. If you need to consume real merge-patch documents, translate them before merging.

A merge recursively follows only the fields a delta names, so unmentioned subtrees are never traversed. Work still scales with the containers it touches. Every recursively merged plain object whose result changes is shallow-copied across its own enumerable fields, changed ancestors included, so changing one field of a five-hundred-field object copies five hundred. Keyed reconciliation indexes every delta item, scans every base item, and builds a candidate list, so updating one item in a list of ten thousand costs O(list), not O(1). Unkeyed arrays and replacement contents are not traversed at all.

Config paths are trusted strings. Bad grammar and contradictory policies throw when the merger is created. A `keyBy` policy then affects a merge only when the delta at that path is an array: reconciliation validates every delta item, and every base item too when the base is an array, treating a non-array base as empty. A non-array delta bypasses reconciliation entirely and follows ordinary merge semantics, so an object there merges rather than reconciles. A typo such as `"order.itmes"` is valid syntax, so the real `order.items` stays unkeyed and quietly replaces wholesale.

Validating wire input is the caller's job. During keyed-list reconciliation `keyfold` performs limited protocol checks — item shape, identity presence, type and uniqueness, tombstone form, reserved values — and recursive object folds ignore unsafe keys, while replacement boundaries keep them as data. It does not validate your application schema and cannot make untrusted input trusted, so it is not a schema validator or a trust boundary. Validating a delta is also not the same as validating full state: deltas are partial and can carry tombstones or the wire token. `Delta<T>` prevents the in-memory `DELETE` symbol from deleting required fields, but that static protection cannot extend to `DELETE_TOKEN`: TypeScript cannot exclude one reserved literal from a general `string` field.

`Delta<T>` cannot know which arrays are keyed. It admits `$delete` on object array items, then runtime policy decides whether that operator is meaningful. Likewise, the type cannot prove that a newly inserted keyed item or a wholesale replacement contains every field your application needs.

Identity fields are the caller's central responsibility: they must remain stable and unique within each list. Two names are reserved in exchange: `$delete` cannot be a real field on keyed entities, and with `wireDeletes: true` the string `"@@keyfold/delete"` can no longer be stored at an interpreted object-field position, though it stays ordinary data inside a replacement or an unkeyed array. Field deletes over JSON also require both ends to speak that protocol; a third-party producer needs a translation layer.

Inputs are assumed to be finite, JSON-shaped trees. A cycle the fold recurses through overflows the call stack, and `keyfold` spends no cycles detecting one. A cycle it never recurses through is simply data: one in a branch the delta leaves unmentioned, or inside a value taken verbatim, passes through untouched.

Inputs are also assumed to come from one JavaScript realm. A plain object is one carrying this realm's `Object.prototype`, or none at all; a record built in a `vm` context or an iframe carries that realm's `Object.prototype` instead, so `keyfold` reads it as an opaque value and replaces wholesale, dropping the fields the delta leaves unmentioned. No test reliably separates such a record from a class instance, because every available signal is either realm-scoped or writable by the object's author. Pass foreign data through `structuredClone` to bring it into the receiving realm before merging.

## License

MIT © 2026 Bob Massarczyk
