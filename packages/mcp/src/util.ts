/**
 * Recursively strips keys whose value is explicitly `undefined`, at every nesting level. zod's
 * inferred type for an optional field is `{ k?: T | undefined }` (the key may be present with an
 * `undefined` value after parsing) — including inside nested objects like `style`/`label`/
 * `cardinality`. Every `@icad/core` options type is `{ k?: T }` under this repo's
 * `exactOptionalPropertyTypes: true` (tsconfig.base.json), which does not accept an explicit
 * `undefined` value for a present key. This bridges the two without loosening either side.
 */
type StripUndefinedDeep<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]: StripUndefinedDeep<Exclude<T[K], undefined>> }
    : T;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function omitUndefined<T extends object>(obj: T): StripUndefinedDeep<T> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key];
    if (value === undefined) continue;
    result[key] = isPlainObject(value) ? omitUndefined(value) : value;
  }
  return result as StripUndefinedDeep<T>;
}
