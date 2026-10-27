import { DatabaseSync } from 'node:sqlite';

/** 依序執行；新增 schema 變更時只能往後加，不可修改既有項目 */
const migrations: string[] = [
  `
  CREATE TABLE anime (
    id            TEXT PRIMARY KEY,
    title         TEXT NOT NULL,
    alt_titles    TEXT NOT NULL DEFAULT '[]',
    cover_path    TEXT,
    hidden        INTEGER NOT NULL DEFAULT 0,
    hidden_at     TEXT,
    hidden_reason TEXT,
    created_at    TEXT NOT NULL,
    updated_at    TEXT NOT NULL
  );

  CREATE TABLE anime_source (
    anime_id      TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    source        TEXT NOT NULL,
    external_id   TEXT NOT NULL,
    url           TEXT,
    raw_meta      TEXT NOT NULL DEFAULT '{}',
    first_seen_at TEXT NOT NULL,
    PRIMARY KEY (source, external_id)
  );
  CREATE INDEX anime_source_anime ON anime_source(anime_id);

  CREATE TABLE episode (
    id          TEXT PRIMARY KEY,
    anime_id    TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    label       TEXT NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (source, external_id)
  );
  CREATE INDEX episode_anime ON episode(anime_id);

  CREATE TABLE watch_event (
    id           TEXT PRIMARY KEY,
    episode_id   TEXT NOT NULL REFERENCES episode(id) ON DELETE CASCADE,
    anime_id     TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    started_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    progress_sec REAL NOT NULL DEFAULT 0,
    duration_sec REAL NOT NULL DEFAULT 0,
    completed    INTEGER NOT NULL DEFAULT 0,
    source       TEXT NOT NULL DEFAULT 'auto'
  );
  CREATE INDEX watch_event_anime ON watch_event(anime_id);
  CREATE INDEX watch_event_started ON watch_event(started_at);

  CREATE TABLE review (
    id         TEXT PRIMARY KEY,
    anime_id   TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    episode_id TEXT REFERENCES episode(id) ON DELETE SET NULL,
    rating     INTEGER,
    content    TEXT NOT NULL,
    spoiler    INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX review_anime ON review(anime_id);

  CREATE TABLE sn_cache (
    source      TEXT NOT NULL,
    episode_sn  TEXT NOT NULL,
    anime_sn    TEXT NOT NULL,
    fetched_at  TEXT NOT NULL,
    PRIMARY KEY (source, episode_sn)
  );
  `,
  // 合併頁按「不是同一部」的組合；a_id < b_id
  `
  CREATE TABLE merge_dismissed (
    a_id         TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    b_id         TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    dismissed_at TEXT NOT NULL,
    PRIMARY KEY (a_id, b_id)
  );
  `,
  // 手動標記看完：NULL 自動判斷、1 看完、0 沒看完
  `
  ALTER TABLE anime ADD COLUMN manual_completed INTEGER;
  ALTER TABLE anime ADD COLUMN manual_completed_at TEXT;
  `,
  // 收藏與自訂分群（一部作品可屬於多個分群）
  `
  ALTER TABLE anime ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE anime ADD COLUMN favorited_at TEXT;

  CREATE TABLE anime_group (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE anime_group_member (
    group_id TEXT NOT NULL REFERENCES anime_group(id) ON DELETE CASCADE,
    anime_id TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    PRIMARY KEY (group_id, anime_id)
  );
  CREATE INDEX anime_group_member_anime ON anime_group_member(anime_id);
  `,
  // 相關作品：對象以來源 ID 記錄，尚未建檔的作品也能先記下；removed 為手動移除，重新讀取來源網站時不會再加回
  `
  CREATE TABLE anime_relation (
    anime_id    TEXT NOT NULL REFERENCES anime(id) ON DELETE CASCADE,
    source      TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title       TEXT NOT NULL,
    cover_url   TEXT,
    origin      TEXT NOT NULL,
    removed     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL,
    PRIMARY KEY (anime_id, source, external_id)
  );
  CREATE INDEX anime_relation_target ON anime_relation(source, external_id);
  ALTER TABLE anime_source ADD COLUMN relations_fetched_at TEXT;
  `,
];

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  migrate(db);
  return db;
}

function migrate(db: DatabaseSync) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < migrations.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(migrations[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
