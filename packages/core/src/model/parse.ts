import type { z } from 'zod';
import { ProjectDocSchema, SCHEMA_VERSION, type ProjectDoc } from './schema.js';

export class DocumentValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid project document: ${issues.slice(0, 5).join('; ')}`);
    this.name = 'DocumentValidationError';
    this.issues = issues;
  }
}

/**
 * Upgrades documents written by older versions of the editor. Each step receives the raw JSON of
 * version N and must return version N+1. There is only one version so far; the hook exists so the
 * storage format can evolve without breaking saved projects.
 */
const MIGRATIONS: Record<number, (doc: Record<string, unknown>) => Record<string, unknown>> = {};

export function migrateDocument(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  let doc = raw as Record<string, unknown>;
  let version = typeof doc.schemaVersion === 'number' ? doc.schemaVersion : SCHEMA_VERSION;
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (!step) break;
    doc = step(doc);
    version += 1;
    doc.schemaVersion = version;
  }
  return doc;
}

export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
    return `${path}: ${issue.message}`;
  });
}

/** Validates (and migrates) an untrusted project document. */
export function parseProjectDoc(raw: unknown): ProjectDoc {
  const result = ProjectDocSchema.safeParse(migrateDocument(raw));
  if (!result.success) throw new DocumentValidationError(formatZodIssues(result.error));
  return result.data;
}

export function safeParseProjectDoc(
  raw: unknown,
): { ok: true; doc: ProjectDoc } | { ok: false; issues: string[] } {
  const result = ProjectDocSchema.safeParse(migrateDocument(raw));
  return result.success
    ? { ok: true, doc: result.data }
    : { ok: false, issues: formatZodIssues(result.error) };
}
