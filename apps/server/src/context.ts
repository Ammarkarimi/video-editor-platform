import type { Config } from './config.js';
import { AssetRepository, ProjectRepository, RenderRepository } from './db/repositories.js';
import { openDatabase, type Database } from './db/sqlite.js';
import { EventBus } from './events.js';
import { detectFfmpegVersion } from './ffmpeg/run.js';
import { registerFonts } from './fonts.js';
import { MediaService } from './media/service.js';
import { RenderService } from './render/service.js';
import { Storage } from './storage.js';

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface AppContext {
  config: Config;
  storage: Storage;
  db: Database;
  projects: ProjectRepository;
  assets: AssetRepository;
  renders: RenderRepository;
  events: EventBus;
  media: MediaService;
  rendering: RenderService;
  ffmpegVersion: string | null;
  close(): Promise<void>;
}

export async function createContext(config: Config, log: Logger): Promise<AppContext> {
  const storage = new Storage(config.dataDir);
  const db = openDatabase(storage.databaseFile);
  const projects = new ProjectRepository(db);
  const assets = new AssetRepository(db);
  const renders = new RenderRepository(db);
  const events = new EventBus();
  registerFonts(config.fontsDir);
  const ffmpegVersion = await detectFfmpegVersion(config.ffmpegPath);
  if (!ffmpegVersion)
    log.warn(
      {},
      `FFmpeg not found at "${config.ffmpegPath}"; media processing and exports will fail.`,
    );
  const media = new MediaService(config, storage, assets, events, log);
  const rendering = new RenderService(config, storage, assets, renders, events, log);

  return {
    config,
    storage,
    db,
    projects,
    assets,
    renders,
    events,
    media,
    rendering,
    ffmpegVersion,
    async close() {
      media.shutdown();
      await rendering.shutdown();
      db.close();
    },
  };
}
