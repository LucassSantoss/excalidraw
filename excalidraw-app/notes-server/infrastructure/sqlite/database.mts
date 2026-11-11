/**
 * The SQLite database (Node's built-in `node:sqlite`): schema, migrations of
 * databases created by older versions, and transactions.
 */

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DAILY_FOLDER_KIND } from "../../domain/folders.mts";
import { extractNoteText } from "../../domain/search.mts";

import type { RunInTransaction } from "../../application/ports.mts";

export const openDatabase = (dbFile: string) => {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL DEFAULT '',
      elements   TEXT NOT NULL DEFAULT '[]',
      app_state  TEXT NOT NULL DEFAULT '{}',
      thumbnail  BLOB,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- images, apart from the scene so that autosaves only need to send the
    -- ones the server doesn't have yet
    CREATE TABLE IF NOT EXISTS note_files (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      id      TEXT NOT NULL,
      data    TEXT NOT NULL,
      PRIMARY KEY (note_id, id)
    );

    -- single row holding the persisted shape library (\`LibraryPersistedData\`)
    CREATE TABLE IF NOT EXISTS library (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    -- single level of folders; \`kind\` marks app-managed folders (e.g. the
    -- daily notes one), which can't be renamed or deleted
    CREATE TABLE IF NOT EXISTS folders (
      id         TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      kind       TEXT UNIQUE,
      created_at INTEGER NOT NULL
    );

    -- default color of each top-pick position of the color pickers, used by
    -- notes without their own picks; a missing position keeps the built-in
    CREATE TABLE IF NOT EXISTS color_top_pick_defaults (
      slot     TEXT NOT NULL,
      position INTEGER NOT NULL,
      color    TEXT NOT NULL,
      PRIMARY KEY (slot, position)
    );
  `);

  // migrate databases created before folders existed
  const noteColumns = new Set(
    (db.prepare("PRAGMA table_info(notes)").all() as { name: string }[]).map(
      (column) => column.name,
    ),
  );
  if (!noteColumns.has("folder_id")) {
    db.exec(`ALTER TABLE notes ADD COLUMN folder_id TEXT
      REFERENCES folders(id) ON DELETE SET NULL`);
  }
  if (!noteColumns.has("daily_date")) {
    // YYYY-MM-DD of daily notes, so each day has a single one
    db.exec(`ALTER TABLE notes ADD COLUMN daily_date TEXT`);
  }
  if (!noteColumns.has("thumbnail_stale")) {
    // 1 when the scene changed since the thumbnail was rendered (or a scene
    // was saved without any, e.g. through the API)
    db.exec(`ALTER TABLE notes ADD COLUMN thumbnail_stale INTEGER NOT NULL
      DEFAULT 0`);
    db.exec(`UPDATE notes SET thumbnail_stale = 1
      WHERE thumbnail IS NULL AND elements <> '[]'`);
  }
  if (!noteColumns.has("content_text")) {
    // the text written in the drawing, for searching notes
    db.exec(`ALTER TABLE notes ADD COLUMN content_text TEXT NOT NULL
      DEFAULT ''`);
    const setContentText = db.prepare(
      `UPDATE notes SET content_text = ? WHERE id = ?`,
    );
    for (const { id, elements } of db
      .prepare(`SELECT id, elements FROM notes`)
      .all() as { id: string; elements: string }[]) {
      setContentText.run(extractNoteText(JSON.parse(elements)), id);
    }
  }
  if (!noteColumns.has("thumbnail_version")) {
    // bumped with each thumbnail saved, so clients don't show a cached one
    db.exec(`ALTER TABLE notes ADD COLUMN thumbnail_version INTEGER NOT NULL
      DEFAULT 0`);
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS notes_folder_id ON notes (folder_id);
    CREATE UNIQUE INDEX IF NOT EXISTS notes_daily_date ON notes (daily_date)
      WHERE daily_date IS NOT NULL;
  `);
  // the daily notes folder only holds daily notes (older versions allowed
  // any note in it): move others back to the root
  db.prepare(
    `UPDATE notes SET folder_id = NULL
     WHERE daily_date IS NULL
       AND folder_id IN (SELECT id FROM folders WHERE kind = ?)`,
  ).run(DAILY_FOLDER_KIND);
  return db;
};

export const createTransaction =
  (db: DatabaseSync): RunInTransaction =>
  (fn) => {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };
