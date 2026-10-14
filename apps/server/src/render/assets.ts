import { getReferencedAssetIds, type ProjectDoc } from '@vep/core';
import type { AssetRecord, AssetRepository } from '../db/repositories.js';
import type { Storage } from '../storage.js';
import type { RenderAsset } from './host.js';

export function toRenderAsset(record: AssetRecord, storage: Storage): RenderAsset | null {
  const m = record.metadata;
  if (record.status !== 'ready' || !m) return null;
  return {
    id: record.id,
    kind: record.kind,
    name: record.name,
    duration: m.duration,
    width: m.width,
    height: m.height,
    hasAudio: m.hasAudio,
    hasVideo: m.hasVideo,
    file: storage.assetPath(record.id, record.fileName),
  };
}

/**
 * Resolves the media a document needs. Only assets that belong to the project are considered, so
 * a crafted document cannot pull in another project's files.
 */
export function resolveRenderAssets(
  projectId: string,
  doc: ProjectDoc,
  assets: AssetRepository,
  storage: Storage,
): Map<string, RenderAsset> {
  const referenced = getReferencedAssetIds(doc);
  const map = new Map<string, RenderAsset>();
  for (const record of assets.listByProject(projectId)) {
    if (!referenced.has(record.id)) continue;
    const asset = toRenderAsset(record, storage);
    if (asset) map.set(asset.id, asset);
  }
  return map;
}
