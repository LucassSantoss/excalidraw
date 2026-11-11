import type { DatabaseSync } from "node:sqlite";

import type { NotesRepository } from "../../application/ports.mts";
import type { NoteSummary } from "../../domain/notes.mts";

type NoteRow = {
  id: string;
  title: string;
  folder_id: string | null;
  daily_date: string | null;
  created_at: number;
  updated_at: number;
  has_thumbnail: number;
  thumbnail_stale: number;
  thumbnail_version: number;
};

type NoteSceneRow = NoteRow & { elements: string; app_state: string };

type FileRow = { id: string; data: string };

const SUMMARY_COLUMNS = `id, title, folder_id, daily_date, created_at, updated_at,
  thumbnail IS NOT NULL AS has_thumbnail, thumbnail_stale, thumbnail_version`;

const toNoteSummary = (row: NoteRow): NoteSummary => ({
  id: row.id,
  title: row.title,
  folderId: row.folder_id,
  isDaily: !!row.daily_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  hasThumbnail: !!row.has_thumbnail,
  needsThumbnail: !!row.thumbnail_stale,
  thumbnailVersion: row.thumbnail_version,
});

/** the stored column of each updatable field */
const UPDATE_COLUMNS = {
  title: "title",
  elements: "elements",
  appState: "app_state",
  thumbnail: "thumbnail",
} as const;

export const createNotesRepository = (db: DatabaseSync): NotesRepository => {
  const list = db.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM notes ORDER BY updated_at DESC`,
  );
  const find = db.prepare(`SELECT ${SUMMARY_COLUMNS} FROM notes WHERE id = ?`);
  const findWithScene = db.prepare(
    `SELECT ${SUMMARY_COLUMNS}, elements, app_state FROM notes WHERE id = ?`,
  );
  const findIdByDailyDate = db.prepare(
    `SELECT id FROM notes WHERE daily_date = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO notes (id, title, elements, app_state, thumbnail, folder_id,
       daily_date, created_at, updated_at)
     VALUES (?, ?, '[]', '{}', NULL, ?, ?, ?, ?)`,
  );
  const insertCopy = db.prepare(
    `INSERT INTO notes (id, title, elements, app_state, thumbnail, folder_id,
       daily_date, created_at, updated_at)
     SELECT ?, ?, elements, app_state, thumbnail, ?, NULL, ?, ?
     FROM notes WHERE id = ?`,
  );
  const copyThumbnailStale = db.prepare(
    `UPDATE notes SET thumbnail_stale =
       (SELECT thumbnail_stale FROM notes WHERE id = ?)
     WHERE id = ?`,
  );
  const copyFiles = db.prepare(
    `INSERT OR IGNORE INTO note_files (note_id, id, data)
     SELECT ?, id, data FROM note_files WHERE note_id = ?`,
  );
  const move = db.prepare(`UPDATE notes SET folder_id = ? WHERE id = ?`);
  const findFiles = db.prepare(
    `SELECT id, data FROM note_files WHERE note_id = ?`,
  );
  const findFileIds = db.prepare(`SELECT id FROM note_files WHERE note_id = ?`);
  const addFile = db.prepare(
    `INSERT OR IGNORE INTO note_files (note_id, id, data) VALUES (?, ?, ?)`,
  );
  const deleteFile = db.prepare(
    `DELETE FROM note_files WHERE note_id = ? AND id = ?`,
  );
  const deleteNote = db.prepare(`DELETE FROM notes WHERE id = ?`);
  const findThumbnail = db.prepare(`SELECT thumbnail FROM notes WHERE id = ?`);
  const saveThumbnail = db.prepare(
    `UPDATE notes SET thumbnail = ?, thumbnail_stale = 0,
       thumbnail_version = thumbnail_version + 1
     WHERE id = ?`,
  );

  return {
    list: () => (list.all() as NoteRow[]).map(toNoteSummary),
    find: (id) => {
      const row = find.get(id) as NoteRow | undefined;
      return row ? toNoteSummary(row) : null;
    },
    findWithScene: (id) => {
      const row = findWithScene.get(id) as NoteSceneRow | undefined;
      if (!row) {
        return null;
      }
      const files: Record<string, unknown> = {};
      for (const file of findFiles.all(id) as FileRow[]) {
        files[file.id] = JSON.parse(file.data);
      }
      return {
        ...toNoteSummary(row),
        elements: JSON.parse(row.elements),
        appState: JSON.parse(row.app_state),
        files,
      };
    },
    findIdByDailyDate: (date) =>
      (findIdByDailyDate.get(date) as { id: string } | undefined)?.id ?? null,
    insert: ({ id, title, folderId, dailyDate, now }) => {
      insert.run(id, title, folderId, dailyDate, now, now);
    },
    insertCopy: (sourceId, { id, title, folderId, now }) => {
      insertCopy.run(id, title, folderId, now, now, sourceId);
      copyThumbnailStale.run(sourceId, id);
      copyFiles.run(id, sourceId);
    },
    update: (id, fields, now) => {
      const assignments: string[] = [];
      const values: (string | Uint8Array | null)[] = [];
      for (const [field, column] of Object.entries(UPDATE_COLUMNS)) {
        const value = fields[field as keyof typeof fields];
        if (value === undefined) {
          continue;
        }
        assignments.push(`${column} = ?`);
        values.push(
          field === "elements" || field === "appState"
            ? JSON.stringify(value)
            : (value as string | Uint8Array | null),
        );
      }
      // the thumbnail is up to date when sent, outdated when the scene
      // changes without one
      if (fields.thumbnail !== undefined) {
        assignments.push(
          "thumbnail_stale = 0",
          "thumbnail_version = thumbnail_version + 1",
        );
      } else if (fields.elements !== undefined) {
        assignments.push("thumbnail_stale = 1");
      }
      db.prepare(
        `UPDATE notes SET ${assignments.join(", ")}, updated_at = ?
         WHERE id = ?`,
      ).run(...values, now, id);
    },
    move: (id, folderId) => {
      move.run(folderId, id);
    },
    addFiles: (id, files) => {
      for (const file of files) {
        addFile.run(id, file.id, JSON.stringify(file));
      }
    },
    removeFilesExcept: (id, keptFileIds) => {
      for (const { id: fileId } of findFileIds.all(id) as { id: string }[]) {
        if (!keptFileIds.has(fileId)) {
          deleteFile.run(id, fileId);
        }
      }
    },
    delete: (id) => {
      deleteNote.run(id);
    },
    saveThumbnail: (id, thumbnail) => {
      saveThumbnail.run(thumbnail, id);
    },
    findThumbnail: (id) =>
      (findThumbnail.get(id) as { thumbnail: Uint8Array | null } | undefined)
        ?.thumbnail ?? null,
  };
};
