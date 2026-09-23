// frontend/src/services/utils.ts

/**
 * 将 snake_case 对象键转换为 camelCase
 */
export function snakeToCamel<T>(obj: Record<string, any>): T {
  if (obj === null || typeof obj !== 'object') {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => snakeToCamel(item)) as unknown as T;
  }

  const converted: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      converted[camelKey] = snakeToCamel(obj[key]);
    }
  }
  return converted as T;
}

/**
 * 将 camelCase 对象键转换为 snake_case
 */
export function camelToSnake<T>(obj: Record<string, any>): T {
  if (obj === null || typeof obj !== 'object') {
    return obj as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => camelToSnake(item)) as unknown as T;
  }

  const converted: Record<string, any> = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      converted[snakeKey] = camelToSnake(obj[key]);
    }
  }
  return converted as T;
}
