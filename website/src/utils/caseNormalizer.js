/**
 * Utility functions for normalizing JSON casing between Rust (snake_case) and JS (camelCase).
 *
 * This file exists (in addition to `caseNormalizer.ts`) so Node-based tests can import it
 * without TypeScript transpilation.
 */

function snakeToCamelKey(key) {
  return key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function snakeToCamel(obj) {
  if (Array.isArray(obj)) {
    return obj.map(snakeToCamel);
  }

  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Uint8Array || ArrayBuffer.isView(obj)) {
      return obj;
    }

    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = snakeToCamelKey(key);
      acc[camelKey] = snakeToCamel(obj[key]);
      return acc;
    }, {});
  }

  return obj;
}

function camelToSnakeKey(key) {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

export function camelToSnake(obj) {
  if (Array.isArray(obj)) {
    return obj.map(camelToSnake);
  }

  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Uint8Array || ArrayBuffer.isView(obj)) {
      return obj;
    }

    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = camelToSnakeKey(key);
      acc[snakeKey] = camelToSnake(obj[key]);
      return acc;
    }, {});
  }

  return obj;
}

