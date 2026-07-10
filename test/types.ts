import { DELETE, type Delta } from "../src/index.js";

interface Shape {
  required: string;
  requiredUndefined: string | undefined;
  optional?: string;
  nested: { required: number; optional?: number };
  items: Array<{ id: string; value: number; note?: string }>;
}

interface ErrorPayload {
  name: string;
  message: string;
  code?: number;
}

class Model {
  constructor(readonly value: number) {}

  read(): number {
    return this.value;
  }
}

const valid: Delta<Shape> = {
  required: undefined,
  requiredUndefined: undefined,
  optional: DELETE,
  nested: { optional: DELETE },
  items: [
    { id: "a", note: DELETE },
    { id: "b", $delete: true },
  ],
};
void valid;

const requiredDelete: Delta<Shape> = {
  // @ts-expect-error required properties cannot be deleted
  required: DELETE,
};
void requiredDelete;

const requiredUndefinedDelete: Delta<Shape> = {
  // @ts-expect-error a required key stays required even when its value includes undefined
  requiredUndefined: DELETE,
};
void requiredUndefinedDelete;

const nestedRequiredDelete: Delta<Shape> = {
  nested: {
    // @ts-expect-error nested required properties cannot be deleted
    required: DELETE,
  },
};
void nestedRequiredDelete;

const readonlyTags = ["a", "b"] as const;
const readonlyArrayDelta: Delta<{ tags: readonly string[] }> = { tags: readonlyTags };
void readonlyArrayDelta;

const mutableArrayDelta: Delta<{ tags: string[] }> = {
  // @ts-expect-error a readonly replacement cannot be returned as a mutable array
  tags: readonlyTags,
};
void mutableArrayDelta;

const atomicDelta: Delta<{ model: Model }, Model> = { model: new Model(2) };
void atomicDelta;

const partialAtomicDelta: Delta<{ model: Model }, Model> = {
  // @ts-expect-error caller-declared atomic values must be supplied whole
  model: { value: 2 },
};
void partialAtomicDelta;

const structuralErrorPayload: Delta<{ error: ErrorPayload }> = {
  error: { message: "updated" },
};
void structuralErrorPayload;
