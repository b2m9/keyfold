/** Remove an object field when this symbol is used as its delta value. */
export const DELETE: unique symbol = Symbol("keyfold.DELETE");

/** The JSON spelling of a field delete when `wireDeletes` is enabled. */
export const DELETE_TOKEN = "@@keyfold/delete" as const;
