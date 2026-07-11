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

The original `state` is untouched. Unmentioned object fields and list items survive, matching items merge in place, new items append, and tombstones remove whole items. Untouched sibling subtrees retain their references.

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

`keyBy` maps a list path to its identity field. Identity values must be stable, unique strings or numbers. Matching is strict, so `1` and `"1"` are different items, while `0` and `""` are valid identities. Missing, duplicate, `NaN`, and non-string/non-number identities throw.

`replace` makes a path swap wholesale instead of deep-merging or reconciling. A wholesale swap never recurses, so `createMerger` rejects any policy nested below a replaced path. The `"order.items[]"` form is the item-swap idiom: the list still matches items by identity, but each matched item is replaced by its incoming value instead of merged:

```ts
const replaceItems = createMerger<State>({
  keyBy: { "order.items": "id" },
  replace: ["order.items[]"],
});
```

Replacement values are explicit data, so an empty object or array at a
`replace` path is materialized rather than treated as a recursive no-op.

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

Inside a keyed list, `{ id, $delete: true }` removes the whole item. `$delete` is reserved on keyed items; any other value or a tombstone carrying patch fields throws.

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
performs no item operations, so it preserves the original value and does not
materialize an absent list. To empty an existing keyed list, tombstone every
item, or leave the list unkeyed on a merger where wholesale replacement is
what you mean. A new keyed item is constructed from the fields it supplies, so
an explicit empty nested object or keyed list on that item remains present.

### Errors

`createMerger` throws `KeyfoldConfigError` for malformed or contradictory options. A merger throws `KeyfoldMergeError` when base or delta data violates the contract, such as duplicate identities or malformed tombstones. Both are exported for `instanceof` matching, and a throw never leaves a partially merged tree behind.

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
- Object and keyed-list deltas use empty working containers when the base has the wrong shape. A no-op preserves the original value and reference; a real field or item produces the correctly shaped result.
- New keyed items consume nested operators at interpreted positions while retaining explicitly supplied empty containers. A `replace` boundary or unkeyed array inside the item is still taken verbatim.
- `__proto__`, `constructor`, and `prototype` keys in deltas are ignored.
- The base is never mutated. A throw cannot leave a partial write behind.
- A merge that changes nothing returns the base reference. Merged values count as unchanged when they are equal by value; replaced values count as unchanged only when they are the very same reference.
- Every valid delta is deterministic and idempotent: re-applying the same delta returns the previous result by reference, so a store can drop duplicate frames with one equality check.

Replaced values, unkeyed arrays, and non-plain objects are taken as-is, never scanned or sanitized; that is what keeps replacement cheap. A `DELETE` or `$delete` inside such a value is not an operator, just data the caller put there.

## Guardrails

`keyfold` folds one authoritative delta into a state tree. It is last-delta-wins: not a CRDT, operational transform, store, normalized cache, schema validator, or persistence layer.

Nor is it an implementation of JSON Merge Patch; the tagline describes lineage, not wire compatibility. RFC 7396 spells deletion as `null`, which `keyfold` deliberately keeps as data, so feeding an actual merge-patch document to a merger sets fields to `null` instead of deleting them. If you need to consume real merge-patch documents, translate them before merging.

The cost of a merge scales with the delta, not with the state: branches the delta never mentions are never visited. Keyed lists are the exception, because a touched list is scanned in full to index its identities. Updating one item in a list of ten thousand costs O(list), not O(1).

Config paths are trusted strings. Bad grammar and contradictory policies throw when the merger is created, and a policy that lands on the wrong runtime shape usually throws during the merge. A typo such as `"order.itmes"`, however, is valid syntax: the real `order.items` stays unkeyed and quietly replaces wholesale.

Validating wire input is the caller's job. `keyfold` does not inspect untrusted data, and validating a delta is not the same as validating full state: deltas are partial and can carry tombstones or the wire token. `Delta<T>` prevents the in-memory `DELETE` symbol from deleting required fields, but that static protection cannot extend to `DELETE_TOKEN`: TypeScript cannot exclude one reserved literal from a general `string` field.

`Delta<T>` cannot know which arrays are keyed. It admits `$delete` on object array items, then runtime policy decides whether that operator is meaningful. Likewise, the type cannot prove that a newly inserted keyed item or a wholesale replacement contains every field your application needs.

Identity fields are the caller's central responsibility: they must remain stable and unique within each list. Two names are reserved in exchange: `$delete` cannot be a real field on keyed entities, and with `wireDeletes: true` the string `"@@keyfold/delete"` can no longer be stored as ordinary field data. Field deletes over JSON also require both ends to speak that protocol; a third-party producer needs a translation layer.

Inputs are assumed to be finite, JSON-shaped trees. A cyclic base or delta is outside the contract and overflows the call stack; `keyfold` spends no cycles detecting it.

## License

MIT © 2026 Bob Massarczyk
