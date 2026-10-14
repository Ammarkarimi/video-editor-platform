import {
  getProjectDuration,
  type AssetDTO,
  type AssetKind,
  type AssetMetadata,
  type AssetStatus,
  type ExportSettings,
  type FilmstripInfo,
  type ProjectDoc,
  type ProjectDTO,
  type ProjectSummaryDTO,
  type RenderJobDTO,
  type RenderStatus,
} from '@vep/core';
import type { Database } from './sqlite.js';

const now = () => new Date().toISOString();

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return JSON.parse(value) as T;
}

// ---------------------------------------------------------------------------------------------
// Projects

interface ProjectRow {
  id: string;
  name: string;
  document: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  document: ProjectDoc;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class ProjectRepository {
  constructor(private readonly db: Database) {}

  private toRecord(row: ProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      document: JSON.parse(row.document) as ProjectDoc,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  list(): ProjectRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM projects ORDER BY updated_at DESC')
      .all() as unknown as ProjectRow[];
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): ProjectRecord | null {
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as
      ProjectRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  create(id: string, name: string, document: ProjectDoc): ProjectRecord {
    const ts = now();
    this.db
      .prepare(
        'INSERT INTO projects (id, name, document, version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
      )
      .run(id, name, JSON.stringify(document), ts, ts);
    return this.get(id)!;
  }

  /**
   * Saves a new document if `baseVersion` matches the stored version (optimistic concurrency).
   * Returns null on a version conflict.
   */
  saveDocument(id: string, document: ProjectDoc, baseVersion: number | null): ProjectRecord | null {
    const result =
      baseVersion === null
        ? this.db
            .prepare(
              'UPDATE projects SET document = ?, version = version + 1, updated_at = ? WHERE id = ?',
            )
            .run(JSON.stringify(document), now(), id)
        : this.db
            .prepare(
              'UPDATE projects SET document = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
            )
            .run(JSON.stringify(document), now(), id, baseVersion);
    return result.changes > 0 ? this.get(id) : null;
  }

  rename(id: string, name: string): ProjectRecord | null {
    this.db
      .prepare('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, now(), id);
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0;
  }

  static toSummary(record: ProjectRecord): ProjectSummaryDTO {
    const { settings } = record.document;
    return {
      id: record.id,
      name: record.name,
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      duration: getProjectDuration(record.document),
      version: record.version,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      thumbnailUrl: `/api/projects/${record.id}/thumbnail?v=${record.version}`,
    };
  }

  static toDTO(record: ProjectRecord): ProjectDTO {
    return { ...ProjectRepository.toSummary(record), document: record.document };
  }
}

// ---------------------------------------------------------------------------------------------
// Assets

interface AssetRow {
  id: string;
  project_id: string;
  name: string;
  kind: AssetKind;
  mime_type: string;
  size: number;
  file_name: string;
  status: AssetStatus;
  error: string | null;
  metadata: string | null;
  filmstrip: string | null;
  has_thumbnail: number;
  has_waveform: number;
  proxy_file: string | null;
  preview_ready: number;
  created_at: string;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  name: string;
  kind: AssetKind;
  mimeType: string;
  size: number;
  fileName: string;
  status: AssetStatus;
  error: string | null;
  metadata: AssetMetadata | null;
  filmstrip: FilmstripInfo | null;
  hasThumbnail: boolean;
  hasWaveform: boolean;
  proxyFile: string | null;
  previewReady: boolean;
  createdAt: string;
}

export type AssetUpdate = Partial<
  Pick<
    AssetRecord,
    | 'name'
    | 'kind'
    | 'status'
    | 'error'
    | 'metadata'
    | 'filmstrip'
    | 'hasThumbnail'
    | 'hasWaveform'
    | 'proxyFile'
    | 'previewReady'
  >
>;

export class AssetRepository {
  constructor(private readonly db: Database) {}

  private toRecord(row: AssetRow): AssetRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      kind: row.kind,
      mimeType: row.mime_type,
      size: row.size,
      fileName: row.file_name,
      status: row.status,
      error: row.error,
      metadata: parseJson<AssetMetadata>(row.metadata),
      filmstrip: parseJson<FilmstripInfo>(row.filmstrip),
      hasThumbnail: row.has_thumbnail === 1,
      hasWaveform: row.has_waveform === 1,
      proxyFile: row.proxy_file,
      previewReady: row.preview_ready === 1,
      createdAt: row.created_at,
    };
  }

  listByProject(projectId: string): AssetRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at ASC')
      .all(projectId) as unknown as AssetRow[];
    return rows.map((r) => this.toRecord(r));
  }

  listByStatus(status: AssetStatus): AssetRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM assets WHERE status = ?')
      .all(status) as unknown as AssetRow[];
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): AssetRecord | null {
    const row = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id) as
      AssetRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  create(input: {
    id: string;
    projectId: string;
    name: string;
    kind: AssetKind;
    mimeType: string;
    size: number;
    fileName: string;
  }): AssetRecord {
    this.db
      .prepare(
        `INSERT INTO assets (id, project_id, name, kind, mime_type, size, file_name, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', ?)`,
      )
      .run(
        input.id,
        input.projectId,
        input.name,
        input.kind,
        input.mimeType,
        input.size,
        input.fileName,
        now(),
      );
    return this.get(input.id)!;
  }

  update(id: string, patch: AssetUpdate): AssetRecord | null {
    const columns: Record<string, unknown> = {};
    if (patch.name !== undefined) columns.name = patch.name;
    if (patch.kind !== undefined) columns.kind = patch.kind;
    if (patch.status !== undefined) columns.status = patch.status;
    if (patch.error !== undefined) columns.error = patch.error;
    if (patch.metadata !== undefined)
      columns.metadata = patch.metadata ? JSON.stringify(patch.metadata) : null;
    if (patch.filmstrip !== undefined)
      columns.filmstrip = patch.filmstrip ? JSON.stringify(patch.filmstrip) : null;
    if (patch.hasThumbnail !== undefined) columns.has_thumbnail = patch.hasThumbnail ? 1 : 0;
    if (patch.hasWaveform !== undefined) columns.has_waveform = patch.hasWaveform ? 1 : 0;
    if (patch.proxyFile !== undefined) columns.proxy_file = patch.proxyFile;
    if (patch.previewReady !== undefined) columns.preview_ready = patch.previewReady ? 1 : 0;
    const keys = Object.keys(columns);
    if (keys.length > 0) {
      const sql = `UPDATE assets SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...(Object.values(columns) as Array<string | number | null>), id);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM assets WHERE id = ?').run(id).changes > 0;
  }

  static toDTO(record: AssetRecord): AssetDTO {
    const base = `/api/assets/${record.id}`;
    return {
      id: record.id,
      projectId: record.projectId,
      name: record.name,
      kind: record.kind,
      mimeType: record.mimeType,
      size: record.size,
      status: record.status,
      error: record.error,
      metadata: record.metadata,
      filmstrip: record.filmstrip,
      hasWaveform: record.hasWaveform,
      hasProxy: record.proxyFile !== null,
      createdAt: record.createdAt,
      urls: {
        file: `${base}/file`,
        preview: record.previewReady
          ? `${base}/preview${record.proxyFile ? '?proxy=1' : ''}`
          : null,
        thumbnail: record.hasThumbnail ? `${base}/thumbnail` : null,
        filmstrip: record.filmstrip ? `${base}/filmstrip` : null,
        waveform: record.hasWaveform ? `${base}/waveform` : null,
      },
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Renders

interface RenderRow {
  id: string;
  project_id: string;
  status: RenderStatus;
  progress: number;
  settings: string;
  file_name: string;
  error: string | null;
  output_size: number | null;
  output_duration: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface RenderRecord {
  id: string;
  projectId: string;
  status: RenderStatus;
  progress: number;
  settings: ExportSettings;
  fileName: string;
  error: string | null;
  outputSize: number | null;
  outputDuration: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export type RenderUpdate = Partial<
  Pick<
    RenderRecord,
    'status' | 'progress' | 'error' | 'outputSize' | 'outputDuration' | 'startedAt' | 'finishedAt'
  >
>;

export class RenderRepository {
  constructor(private readonly db: Database) {}

  private toRecord(row: RenderRow): RenderRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      status: row.status,
      progress: row.progress,
      settings: JSON.parse(row.settings) as ExportSettings,
      fileName: row.file_name,
      error: row.error,
      outputSize: row.output_size,
      outputDuration: row.output_duration,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    };
  }

  listByProject(projectId: string): RenderRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM renders WHERE project_id = ? ORDER BY created_at DESC')
      .all(projectId) as unknown as RenderRow[];
    return rows.map((r) => this.toRecord(r));
  }

  listByStatus(...statuses: RenderStatus[]): RenderRecord[] {
    const placeholders = statuses.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM renders WHERE status IN (${placeholders}) ORDER BY created_at ASC`)
      .all(...statuses) as unknown as RenderRow[];
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): RenderRecord | null {
    const row = this.db.prepare('SELECT * FROM renders WHERE id = ?').get(id) as
      RenderRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  create(input: {
    id: string;
    projectId: string;
    settings: ExportSettings;
    fileName: string;
  }): RenderRecord {
    this.db
      .prepare(
        `INSERT INTO renders (id, project_id, status, progress, settings, file_name, created_at)
         VALUES (?, ?, 'queued', 0, ?, ?, ?)`,
      )
      .run(input.id, input.projectId, JSON.stringify(input.settings), input.fileName, now());
    return this.get(input.id)!;
  }

  update(id: string, patch: RenderUpdate): RenderRecord | null {
    const columns: Record<string, string | number | null> = {};
    if (patch.status !== undefined) columns.status = patch.status;
    if (patch.progress !== undefined) columns.progress = patch.progress;
    if (patch.error !== undefined) columns.error = patch.error;
    if (patch.outputSize !== undefined) columns.output_size = patch.outputSize;
    if (patch.outputDuration !== undefined) columns.output_duration = patch.outputDuration;
    if (patch.startedAt !== undefined) columns.started_at = patch.startedAt;
    if (patch.finishedAt !== undefined) columns.finished_at = patch.finishedAt;
    const keys = Object.keys(columns);
    if (keys.length > 0) {
      const sql = `UPDATE renders SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
      this.db.prepare(sql).run(...Object.values(columns), id);
    }
    return this.get(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM renders WHERE id = ?').run(id).changes > 0;
  }

  static toDTO(record: RenderRecord, eta: number | null = null): RenderJobDTO {
    return {
      id: record.id,
      projectId: record.projectId,
      status: record.status,
      progress: record.progress,
      settings: record.settings,
      fileName: record.fileName,
      error: record.error,
      outputSize: record.outputSize,
      outputDuration: record.outputDuration,
      createdAt: record.createdAt,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      eta,
      downloadUrl: record.status === 'completed' ? `/api/renders/${record.id}/download` : null,
    };
  }
}
