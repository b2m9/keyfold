# @b2m9/keyfold — agent guide

`@b2m9/keyfold` immutably folds partial deltas into plain state trees, with
identity-keyed list reconciliation. The public contract and limits are in
`README.md`; the type contract is in `src/types.ts`; the executable laws are in
`test/laws.test.ts`. Read those first. This file records the constraints the
compiler cannot enforce and how changes are made here.

## Toolchain

ESM-only, Node >=22. The project uses Vite+ (`vp`) with pnpm. Run
`vp test run` while iterating and `vp run check` before handing off; the full
check verifies formatting, lints, type-checks, tests, builds, and validates the
published package and types.

## Constraints to preserve

- **Zero runtime dependencies.** The published fold ships only its own code.
- **Immutable and failure-safe.** Never mutate the base or delta. A throw must
  not leave a partial write behind.
- **Structural sharing is observable.** Semantic no-ops return `base` by
  reference, and untouched sibling branches retain their references.
- **The fold stays deterministic and idempotent.** Reapplying a valid delta
  returns the previous result by reference.
- **Replacement is a boundary.** Unkeyed arrays, non-plain objects, and paths
  configured with `replace` swap wholesale. Do not traverse, clone, sanitize,
  or interpret operators inside them.
- **Keyed lists have stable order.** Match string and non-`NaN` number
  identities without coercion, retain surviving base order, and append new
  items in delta order. Missing or duplicate identities throw.
- **Deletes remain explicit and scoped.** `undefined` means unmentioned,
  `DELETE` removes an optional field, `DELETE_TOKEN` is interpreted only at
  object-field positions when `wireDeletes` is enabled, and `$delete` is only a
  keyed-item tombstone. Operators outside interpreted positions are data.
- **Policies compile once.** Reject malformed, contradictory, or unreachable
  path policy when the merger is created. A keyed-list item edge is entered
  only through reconciliation.
- **An empty container is data; a missed operator is not.** An empty object or
  keyed list ensures its field exists, at every position. An operator that
  finds nothing to do collapses to the base reference and never conjures a
  container. Emptiness counts the fields the fold interprets, so a JSON-safe
  delta means the same thing in memory as it does after a round trip.
- **Unsafe keys are never followed.** Recursive object folds ignore
  `__proto__`, `constructor`, and `prototype` from deltas, including when
  deciding whether a container is empty. Never read one to reach that decision.
- **Never recursively traverse an unmentioned subtree.** Do not add a
  full-state traversal. Cost still scales with the containers touched: a
  recursively merged plain object whose result changes is shallow-copied
  across its own enumerable fields, and keyed reconciliation indexes every
  delta item, scans every base item, and builds a candidate list. Both are
  deliberate; neither may grow into a state walk.

## Design principles

This library folds one authoritative delta. It is not a store, schema
validator, normalized cache, persistence layer, CRDT, operational transform,
or RFC 7396 implementation.

- Prefer removing code to adding it. A new option, operator, path feature, or
  public export must earn its maintenance cost.
- Compose behavior from `keyBy`, `replace`, and `wireDeletes` before adding a
  new primitive.
- Keep runtime behavior and `Delta<T>` honest about their different limits;
  do not claim static guarantees for path strings, keyed-array policy, parsed
  wire data, or complete inserted items.
- Preserve focused regression tests at semantic boundaries, and extend the law
  tests when a change affects a library-wide invariant.

## Comments

Match the comments already in `src/`:

- Explain why: the invariant being held or the failure being guarded, not a
  paraphrase of the code.
- Comment only at decision points such as a guard, non-obvious ordering, or
  deliberate no-op.
- Use terse, full sentences in the present tense. Imitate the nearest existing
  comment when in doubt.
