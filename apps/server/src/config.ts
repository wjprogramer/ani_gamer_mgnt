import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_PORT } from '@agm/shared';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  coversDir: string;
  dbFile: string;
  webDistDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const dataDir = path.resolve(env.AGM_DATA_DIR ?? path.join(repoRoot, 'data'));
  return {
    // 只接受本機連線
    host: '127.0.0.1',
    port: Number(env.AGM_PORT ?? DEFAULT_PORT),
    dataDir,
    coversDir: path.join(dataDir, 'covers'),
    dbFile: path.join(dataDir, 'app.db'),
    webDistDir: path.join(repoRoot, 'apps/web/dist'),
  };
}
