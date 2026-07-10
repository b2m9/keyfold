import { KeyfoldConfigError } from "./errors.js";
import { UNSAFE_KEYS } from "./objects.js";
import type { MergeOptions } from "./types.js";

/** The policy-tree edge used when recursion enters a keyed-list item. */
export const ITEM = "[]";

/** A node in the path policy compiled once by `createMerger`. */
export interface PolicyNode {
  keyField?: string;
  replace?: boolean;
  children?: Map<string, PolicyNode>;
}

export interface CompiledOptions {
  root: PolicyNode;
  wireDeletes: boolean;
}

const SEGMENT = /^([^.[\]]+)(\[\])?$/;
const PROPERTY = /^[^.[\]]+$/;
const RESERVED_IDENTITY_FIELDS = new Set(["$delete", ...UNSAFE_KEYS]);

/** Validate and compile path strings before any state is merged. */
export function compileOptions(options: MergeOptions): CompiledOptions {
  if (options.wireDeletes !== undefined && typeof options.wireDeletes !== "boolean") {
    throw new KeyfoldConfigError("wireDeletes must be a boolean");
  }

  const root: PolicyNode = {};
  const keyPolicies = Object.entries(options.keyBy ?? {}).map(([path, field]) => ({
    path,
    field,
    segments: parsePath(path, "keyBy"),
  }));
  const replacePolicies = (options.replace ?? []).map((path) => ({
    path,
    segments: parsePath(path, "replace"),
  }));

  for (const policy of keyPolicies) {
    validateIdentityField(policy.path, policy.field);
    if (policy.segments.at(-1) === ITEM) {
      throw new KeyfoldConfigError(
        `keyBy path '${policy.path}' addresses items, not a list; remove the trailing '[]'`,
      );
    }
    nodeAt(root, policy.segments).keyField = policy.field;
  }

  const seenReplacePaths = new Set<string>();
  for (const policy of replacePolicies) {
    if (seenReplacePaths.has(policy.path)) {
      throw new KeyfoldConfigError(`duplicate replace path '${policy.path}'`);
    }
    seenReplacePaths.add(policy.path);

    // A replace swaps its subtree verbatim and never recurses, so any policy
    // nested below one is provably dead config. Fail loud on the config
    // itself; the reverse nesting ('<list>[]' under a keyBy list) is the
    // load-bearing item-swap idiom and passes.
    for (const keyed of keyPolicies) {
      if (isPrefix(policy.segments, keyed.segments)) {
        throw new KeyfoldConfigError(
          `replace path '${policy.path}' makes keyBy path '${keyed.path}' unreachable`,
        );
      }
    }
    for (const other of replacePolicies) {
      if (
        other.segments.length < policy.segments.length &&
        isPrefix(other.segments, policy.segments)
      ) {
        throw new KeyfoldConfigError(
          `replace path '${other.path}' makes replace path '${policy.path}' unreachable`,
        );
      }
    }
    nodeAt(root, policy.segments).replace = true;
  }

  for (const policy of [...keyPolicies, ...replacePolicies]) {
    validateReachability(root, policy.path, policy.segments);
  }

  return { root, wireDeletes: options.wireDeletes === true };
}

function parsePath(path: string, source: "keyBy" | "replace"): string[] {
  const segments: string[] = [];

  for (const part of path.split(".")) {
    const match = SEGMENT.exec(part);
    if (match === null) {
      throw new KeyfoldConfigError(
        `invalid ${source} path '${path}'; use dot-separated properties with optional '[]' suffixes`,
      );
    }

    const property = match[1]!;
    if (UNSAFE_KEYS.has(property)) {
      throw new KeyfoldConfigError(`path '${path}' contains reserved property '${property}'`);
    }
    segments.push(property);
    if (match[2] !== undefined) segments.push(ITEM);
  }

  return segments;
}

function validateIdentityField(path: string, field: string): void {
  if (typeof field !== "string" || !PROPERTY.test(field) || RESERVED_IDENTITY_FIELDS.has(field)) {
    throw new KeyfoldConfigError(`keyBy path '${path}' must name a non-reserved identity field`);
  }
}

function validateReachability(root: PolicyNode, path: string, segments: readonly string[]): void {
  let node = root;
  let prefix = "";

  for (const segment of segments) {
    if (segment === ITEM) {
      if (node.keyField === undefined) {
        throw new KeyfoldConfigError(
          `path '${path}' addresses items of '${prefix}', but that list has no keyBy policy`,
        );
      }
    } else if (node.keyField !== undefined) {
      throw new KeyfoldConfigError(
        `path '${path}' steps through keyed list '${prefix}' without the '[]' suffix`,
      );
    }

    node = node.children!.get(segment)!;
    prefix = segment === ITEM ? `${prefix}[]` : prefix === "" ? segment : `${prefix}.${segment}`;
  }
}

function nodeAt(root: PolicyNode, segments: readonly string[]): PolicyNode {
  let node = root;
  for (const segment of segments) {
    node.children ??= new Map();
    let child = node.children.get(segment);
    if (child === undefined) {
      child = {};
      node.children.set(segment, child);
    }
    node = child;
  }
  return node;
}

function isPrefix(prefix: readonly string[], path: readonly string[]): boolean {
  return prefix.length <= path.length && prefix.every((segment, index) => segment === path[index]);
}
