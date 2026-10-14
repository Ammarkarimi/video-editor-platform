import { mkdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { ID_PATTERN } from '@vep/core';

/** Filesystem layout for uploaded media, generated previews and rendered exports. */
export class Storage {
  readonly root: string;
  readonly assetsDir: string;
  readonly rendersDir: string;
  readonly cacheDir: string;
  readonly tmpDir: string;

  constructor(root: string) {
    this.root = root;
    this.assetsDir = path.join(root, 'assets');
    this.rendersDir = path.join(root, 'renders');
    this.cacheDir = path.join(root, 'cache');
    this.tmpDir = path.join(root, 'tmp');
    for (const dir of [root, this.assetsDir, this.rendersDir, this.cacheDir, this.tmpDir]) {
      mkdirSync(dir, { recursive: true });
    }
  }

  get databaseFile(): string {
    return path.join(this.root, 'db.sqlite');
  }

  private checkId(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`Refusing unsafe id: ${id}`);
    return id;
  }

  assetDir(assetId: string): string {
    return path.join(this.assetsDir, this.checkId(assetId));
  }

  assetPath(assetId: string, fileName: string): string {
    return path.join(this.assetDir(assetId), path.basename(fileName));
  }

  async ensureAssetDir(assetId: string): Promise<string> {
    const dir = this.assetDir(assetId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async removeAsset(assetId: string): Promise<void> {
    await rm(this.assetDir(assetId), { recursive: true, force: true });
  }

  renderDir(renderId: string): string {
    return path.join(this.rendersDir, this.checkId(renderId));
  }

  async removeRender(renderId: string): Promise<void> {
    await rm(this.renderDir(renderId), { recursive: true, force: true });
  }

  projectThumbnail(projectId: string, version: number): string {
    return path.join(this.cacheDir, `${this.checkId(projectId)}-v${version}.jpg`);
  }

  /** Path relative to the data root, for `reply.sendFile`. */
  relative(file: string): string {
    return path.relative(this.root, file);
  }
}
