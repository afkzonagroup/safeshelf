// Copyright 2026 MB AFKzona Group
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Minimal JSON Schema validator for the keywords used in schema/*.json
 * (type, const, enum, properties, required, additionalProperties, items,
 * minItems, maxItems, minLength, maxLength, pattern, minimum, oneOf).
 * Test-only; returns a list of error paths.
 */
type Schema = Record<string, unknown>;

const typeOf = (v: unknown): string => {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
};

const typeMatches = (want: string, v: unknown): boolean => {
  const t = typeOf(v);
  return want === t || (want === 'number' && t === 'integer');
};

export function validate(schema: Schema, value: unknown, path = '', root: Schema = schema): string[] {
  if (typeof schema.$ref === 'string') {
    const name = /^#\/\$defs\/([\w-]+)$/.exec(schema.$ref)?.[1];
    const defs = (root.$defs ?? {}) as Record<string, Schema>;
    const target = name === undefined ? undefined : defs[name];
    if (target === undefined) return [`${path}: unresolved $ref`];
    return validate(target, value, path, root);
  }
  const errors: string[] = [];
  const type = schema.type;
  if (typeof type === 'string' && !typeMatches(type, value)) return [`${path}: type ${typeOf(value)} != ${type}`];
  if (Array.isArray(type) && !type.some((t) => typeMatches(String(t), value))) return [`${path}: type`];
  if ('const' in schema && schema.const !== value) errors.push(`${path}: const`);
  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) errors.push(`${path}: enum ${String(value)}`);
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) errors.push(`${path}: minLength`);
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: pattern`);
  }
  if (typeof value === 'number' && typeof schema.minimum === 'number' && value < schema.minimum) errors.push(`${path}: minimum`);
  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) errors.push(`${path}: minItems`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (typeof schema.items === 'object' && schema.items !== null) {
      value.forEach((item, i) => errors.push(...validate(schema.items as Schema, item, `${path}/${String(i)}`, root)));
    }
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    for (const req of (schema.required ?? []) as string[]) if (!(req in obj)) errors.push(`${path}/${req}: required`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = props[k];
      if (sub !== undefined) errors.push(...validate(sub, v, `${path}/${k}`, root));
      else if (schema.additionalProperties === false) errors.push(`${path}/${k}: additional`);
      else if (typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties as Schema, v, `${path}/${k}`, root));
    }
  }
  if (Array.isArray(schema.oneOf)) {
    const passing = (schema.oneOf as Schema[]).filter((s) => validate(s, value, path, root).length === 0).length;
    if (passing !== 1) errors.push(`${path}: oneOf matched ${String(passing)}`);
  }
  return errors;
}
