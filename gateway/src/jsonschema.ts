// Minimal JSON Schema (2020-12 subset) validator for the repository schemas (schemas/*.json).
// Supported keywords: type, const, enum, required, properties, additionalProperties, items, minItems,
// maxItems, uniqueItems, minimum, maximum, minLength, maxLength, pattern. Unknown keywords are ignored,
// so a schema using anything else must be checked by hand before relying on this module.

import { readFileSync } from 'node:fs';

export interface Schema {
  [key: string]: unknown;
}

const MAX_ERRORS = 20;

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    default:
      return false;
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

function codePoints(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

function walk(schema: Schema, value: unknown, path: string, errors: string[]): void {
  if (errors.length >= MAX_ERRORS) return;
  const push = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(`${path}: ${msg}`);
  };

  if ('const' in schema && !deepEqual(schema.const, value)) push(`must equal ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    push(`must be one of ${JSON.stringify(schema.enum)}`);
  }
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? (schema.type as string[]) : [schema.type as string];
    if (!types.some((t) => matchesType(value, t))) {
      push(`expected ${types.join('|')}, got ${typeOf(value)}`);
      return;
    }
  }

  if (typeof value === 'string') {
    const len = codePoints(value);
    if (typeof schema.minLength === 'number' && len < schema.minLength) push(`shorter than ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && len > schema.maxLength) push(`longer than ${schema.maxLength}`);
    if (typeof schema.pattern === 'string' && !new RegExp(schema.pattern, 'u').test(value)) {
      push(`does not match ${schema.pattern}`);
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) push(`below minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) push(`above maximum ${schema.maximum}`);
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) push(`fewer than ${schema.minItems} items`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) push(`more than ${schema.maxItems} items`);
    if (schema.uniqueItems === true) {
      for (let i = 0; i < value.length; i++) {
        for (let j = i + 1; j < value.length; j++) {
          if (deepEqual(value[i], value[j])) push(`items ${i} and ${j} are equal`);
        }
      }
    }
    if (schema.items && typeof schema.items === 'object') {
      value.forEach((item, i) => walk(schema.items as Schema, item, `${path}[${i}]`, errors));
    }
  }

  if (matchesType(value, 'object')) {
    const obj = value as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, Schema>;
    if (Array.isArray(schema.required)) {
      for (const key of schema.required as string[]) {
        if (!Object.hasOwn(obj, key)) push(`missing required property "${key}"`);
      }
    }
    for (const [key, child] of Object.entries(obj)) {
      if (Object.hasOwn(props, key)) {
        walk(props[key], child, `${path}.${key}`, errors);
      } else if (schema.additionalProperties === false) {
        push(`unknown property "${key}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        walk(schema.additionalProperties as Schema, child, `${path}.${key}`, errors);
      }
    }
  }
}

/** Returns a list of human-readable violations (empty when valid). */
export function validate(schema: Schema, value: unknown): string[] {
  const errors: string[] = [];
  walk(schema, value, '$', errors);
  return errors;
}

/** Repository schemas resolved relative to this file (gateway/src → repo root). */
export function loadRepoSchema(name: 'gateway_request' | 'gateway_result' | 'intent' | 'dialogue'): Schema {
  const url = new URL(`../../schemas/${name}.schema.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Schema;
}
