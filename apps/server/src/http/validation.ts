import { ID_PATTERN } from '@vep/core';
import type { z } from 'zod';
import { badRequest, notFound } from './errors.js';

export function parseWith<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw badRequest(
      'Invalid request',
      result.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`),
    );
  }
  return result.data;
}

/** Validates an id path parameter (a malformed id can never exist, so it is a 404). */
export function idParam(params: unknown, name = 'id'): string {
  const value = (params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw notFound('Resource');
  return value;
}

/** Builds a safe `Content-Disposition` header for downloads. */
export function contentDisposition(
  fileName: string,
  type: 'attachment' | 'inline' = 'attachment',
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
