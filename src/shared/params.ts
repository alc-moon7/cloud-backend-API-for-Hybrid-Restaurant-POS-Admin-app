import { badRequest } from './http-error.js';

export function requiredParam(value: string | string[] | undefined, name: string) {
  if (typeof value === 'string' && value.trim()) return value;
  throw badRequest(`${name} is required.`);
}
