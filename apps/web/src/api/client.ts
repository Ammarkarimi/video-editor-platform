import type {
  ApiErrorBody,
  AssetDTO,
  ExportSettings,
  FontsResponse,
  ProjectDoc,
  ProjectDTO,
  ProjectSummaryDTO,
  RenderJobDTO,
  ServerEvent,
  ServerInfo,
  WaveformData,
} from '@vep/core';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: string[];

  constructor(status: number, body: Partial<ApiErrorBody> | null, fallback: string) {
    super(body?.message ?? fallback);
    this.name = 'ApiError';
    this.status = status;
    this.code = body?.error ?? 'error';
    this.details = body?.details ?? [];
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, null, 'Cannot reach the server. Check your connection.');
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok)
    throw new ApiError(
      response.status,
      json as ApiErrorBody | null,
      `Request failed (${response.status})`,
    );
  return json as T;
}

export interface CreateProjectInput {
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor?: string;
}

export const api = {
  info: () => request<ServerInfo>('GET', '/api/info'),
  fonts: () => request<FontsResponse>('GET', '/api/fonts'),

  listProjects: () => request<ProjectSummaryDTO[]>('GET', '/api/projects'),
  createProject: (input: CreateProjectInput) => request<ProjectDTO>('POST', '/api/projects', input),
  createDemoProject: () => request<ProjectDTO>('POST', '/api/demo'),
  getProject: (id: string) => request<ProjectDTO>('GET', `/api/projects/${id}`),
  saveDocument: (id: string, document: ProjectDoc, baseVersion: number | null) =>
    request<ProjectSummaryDTO>('PUT', `/api/projects/${id}/document`, { document, baseVersion }),
  renameProject: (id: string, name: string) =>
    request<ProjectSummaryDTO>('PATCH', `/api/projects/${id}`, { name }),
  duplicateProject: (id: string) => request<ProjectDTO>('POST', `/api/projects/${id}/duplicate`),
  deleteProject: (id: string) => request<void>('DELETE', `/api/projects/${id}`),

  listAssets: (projectId: string) =>
    request<AssetDTO[]>('GET', `/api/projects/${projectId}/assets`),
  renameAsset: (id: string, name: string) =>
    request<AssetDTO>('PATCH', `/api/assets/${id}`, { name }),
  deleteAsset: (id: string, force = false) =>
    request<void>('DELETE', `/api/assets/${id}${force ? '?force=1' : ''}`),
  waveform: (url: string) => request<WaveformData>('GET', url),

  listRenders: (projectId: string) =>
    request<RenderJobDTO[]>('GET', `/api/projects/${projectId}/renders`),
  createRender: (projectId: string, settings: ExportSettings) =>
    request<RenderJobDTO>('POST', `/api/projects/${projectId}/renders`, { settings }),
  cancelRender: (id: string) => request<RenderJobDTO>('POST', `/api/renders/${id}/cancel`),
  deleteRender: (id: string) => request<void>('DELETE', `/api/renders/${id}`),

  async exportStill(projectId: string, time: number, resolution?: number): Promise<Blob> {
    const response = await fetch(`/api/projects/${projectId}/still`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ time, resolution, format: 'png' }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new ApiError(response.status, body, 'Could not export the frame');
    }
    return response.blob();
  },
};

export interface UploadHandle {
  promise: Promise<AssetDTO>;
  abort(): void;
}

/** Uploads a file with progress reporting (fetch has no upload progress, so this uses XHR). */
export function uploadAsset(
  projectId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<AssetDTO>((resolve, reject) => {
    xhr.open('POST', `/api/projects/${projectId}/assets`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as AssetDTO);
      else reject(new ApiError(xhr.status, xhr.response as ApiErrorBody | null, 'Upload failed'));
    };
    xhr.onerror = () => reject(new ApiError(0, null, 'Upload failed: network error'));
    xhr.onabort = () =>
      reject(
        new ApiError(0, { error: 'aborted', message: 'Upload cancelled' }, 'Upload cancelled'),
      );
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

/** Subscribes to live project events (asset processing, export progress). */
export function subscribeToProject(
  projectId: string,
  onEvent: (event: ServerEvent) => void,
): () => void {
  const source = new EventSource(`/api/projects/${projectId}/events`);
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data as string) as ServerEvent);
    } catch {
      // Ignore malformed events.
    }
  };
  return () => source.close();
}
