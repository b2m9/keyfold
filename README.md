# @b2m9/keyfold

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

can corrupt the list into two `b` items. `keyfold` matches configured lists by identity instead:

```ts
import { createMerger } from "@b2m9/keyfold";

const merge = createMerger<typeof base>({ keyBy: { items: "id" } });

merge(base, delta).items;
// [{ id: "a", quantity: 1 }, { id: "b", quantity: 5 }]
```

It is JSON Merge Patch for keyed lists: a zero-dependency, immutable delta fold for plain state trees held outside a normalized cache. Objects merge, keyed lists reconcile, unkeyed arrays and scalars replace, and deletes are explicit.

Use it for websocket reducers, optimistic UI reconciliation, form autosave, configurator recalculation, and other places where one authoritative partial update meets an un-normalized keyed tree.

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

`keyBy` maps a list path to its identity field. Identity values must be stable, unique strings or numbers. Matching is strict—`1` and `"1"` are different—while `0` and `""` are valid. Missing, duplicate, `NaN`, and non-string/non-number identities throw.

`replace` makes a path swap wholesale instead of deep-merging or reconciling. The `"order.items[]"` form is the item-swap idiom: the list still matches by identity, but every matched item is replaced by its incoming value. Configure it on a merger that has no policies below the item, because those policies would be unreachable:

```ts
const replaceItems = createMerger<State>({
  keyBy: { "order.items": "id" },
  replace: ["order.items[]"],
});
```

`wireDeletes` recognizes the exported `DELETE_TOKEN` string at interpreted object fields. It is off by default.

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

Built-ins such as `Date`, `Map`, `Set`, `RegExp`, and promises are already atomic. Declare custom classes and other application-specific opaque types explicitly; otherwise TypeScript cannot distinguish their instances from structural object types. `Atomic` prevents deep-partial typing, but TypeScript is still structural: use a private field, as above, when actual class identity matters.

### Deletes

The three field operations are deliberately distinct:

```ts
merge(state, {
  coupon: DELETE, // remove the field
  note: null, // keep the field and set it to null
  title: undefined, // ignore this field
});
```

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

## Paths

Paths are dot-separated property names. `[]` means “inside each keyed item of the preceding list”:

```ts
"order.items";
"order.items[].components";
"order.items[].components[]";
```

There are no wildcards, indices, root tokens, or escaping. Properties containing `.`, `[`, or `]` are not addressable in v1. The root cannot be keyed; wrap a top-level array in an object when it needs reconciliation.

Configuration is checked for grammar, reserved names, dead `[]` paths, duplicates, and `keyBy`/`replace` conflicts when the merger is created. Paths are not checked against `T` or runtime data.

## Semantics

- Plain objects deep-merge using own enumerable fields.
- Keyed lists reconcile by identity; survivors retain base order and inserts append.
- Unkeyed arrays, scalars, and non-plain objects replace wholesale.
- A plain-object delta over a non-object base folds onto `{}`; a keyed-list delta over a non-array base reconciles against `[]`.
- `__proto__`, `constructor`, and `prototype` keys in deltas are ignored.
- The base is never mutated. A throw cannot leave a partial write behind.
- Empty object deltas return the base reference. Other no-op writes are only value-stable, not necessarily reference-stable.
- Every valid delta is deterministic and value-idempotent.

Replace values, unkeyed-array contents, and non-plain-object interiors are copied verbatim. Operators placed inside those uninterpreted values are outside the contract and are not scanned or rejected; this is what keeps replacement a cheap pointer swap.

## Honesty rails

`keyfold` folds one authoritative delta into a state tree. It is last-delta-wins—not a CRDT, operational transform, store, normalized cache, schema validator, or persistence layer.

Its cost model is bounded blast radius, not sublinear. A merge only descends into branches named by the delta, but every touched keyed list is scanned in full. Updating one item in a large list is O(list).

Config paths are trusted strings. Invalid grammar and internally contradictory policies throw, and a policy landing on the wrong runtime shape usually throws. A typo such as `"order.itmes"`, however, is valid syntax: the real `order.items` remains unkeyed and therefore replaces wholesale.

The JSON boundary belongs to the caller. `keyfold` does not validate untrusted input, and validating a delta is not the same as validating full state: deltas are partial and can contain tombstones or the wire token. `Delta<T>` prevents the in-memory `DELETE` symbol from deleting required fields, but that static protection cannot extend to `DELETE_TOKEN`: TypeScript cannot exclude one reserved literal from a general `string` field.

`Delta<T>` cannot know which arrays are keyed. It admits `$delete` on object array items, then runtime policy decides whether that operator is meaningful. Likewise, the type cannot prove that a newly inserted keyed item or a wholesale replacement contains every field your application needs.

Identity fields are the caller's central responsibility: they must remain stable and unique within each list. `$delete` cannot be a real field on keyed entities. With `wireDeletes: true`, `"@@keyfold/delete"` is reserved as data at interpreted field positions, and field deletes over JSON require the producer and consumer to share that protocol. A third-party producer needs a translation layer.

## License

MIT © 2026 Bob Massarczyk
