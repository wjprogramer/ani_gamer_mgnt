import fs from 'node:fs';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createCoverQueue } from './covers.ts';
import { openDb } from './db.ts';
import { Store } from './store.ts';

const config = loadConfig();
fs.mkdirSync(config.coversDir, { recursive: true });

const store = new Store(openDb(config.dbFile));
const app = createApp({
  store,
  queueCover: createCoverQueue(store, config.coversDir),
  port: config.port,
  dataDir: config.dataDir,
});

app.use('/covers/*', serveStatic({ root: config.coversDir, rewriteRequestPath: (p) => p.replace(/^\/covers/, '') }));

if (fs.existsSync(config.webDistDir)) {
  app.use('/*', serveStatic({ root: config.webDistDir }));
} else {
  app.get('/', (c) => c.text('管理頁尚未建置，請執行 npm run build -w @agm/web，或用 npm run dev:web 開發。'));
}

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  console.log(`本機 server 已啟動：http://${config.host}:${info.port}`);
  console.log(`資料目錄：${config.dataDir}`);
});
