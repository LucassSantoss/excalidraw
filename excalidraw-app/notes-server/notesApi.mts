/**
 * Local notes storage backed by SQLite (Node's built-in `node:sqlite`).
 *
 * Exposes a connect-style middleware handling `/api/notes/*`, `/api/folders/*`,
 * `/api/library` (the editor's shape library, shared by all notes) and
 * `/api/color-defaults/*` (the color picker's default top picks), used by
 * the Vite dev server (see `vite.config.mts`), the standalone production
 * server (`server.mts`) and the macOS app (`desktop/`).
 *
 * Images (binary files) are stored in a separate table so that autosaves only
 * need to send files the server doesn't have yet.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_SIZE = 200 * 1024 * 1024; // 200MB (scenes with images)

const DAILY_FOLDER_KIND = "daily";
const DAILY_FOLDER_NAME = "Notas Diárias";

/** the color pickers whose top picks can get default colors
 * (`AppState["colorTopPicks"]` keys) */
const COLOR_TOP_PICKS_SLOTS = new Set([
  "elementStroke",
  "elementBackground",
  "bucketFill",
  "stickyNoteStroke",
  "stickyNoteBackground",
]);
const MAX_COLOR_TOP_PICKS = 20;
const MAX_COLOR_LENGTH = 64;

type NoteRow = {
  id: string;
  title: string;
  folder_id: string | null;
  daily_date: string | null;
  elements: string;
  app_state: string;
  created_at: number;
  updated_at: number;
  has_thumbnail: number;
};

type FileRow = { id: string; data: string };

type FolderRow = {
  id: string;
  name: string;
  kind: string | null;
  created_at: number;
  note_count: number;
};

type NoteUpdate = {
  title?: string;
  /** moves the note (`null`: out of any folder); doesn't bump `updatedAt` */
  folderId?: string | null;
  elements?: unknown[];
  appState?: Record<string, unknown>;
  files?: Record<string, { id: string }>;
  thumbnail?: string | null;
};

// no TS parameter properties: this file runs in Node via type stripping
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const openDatabase = (dbFile: string) => {
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

const toNoteSummary = (row: NoteRow) => ({
  id: row.id,
  title: row.title,
  folderId: row.folder_id,
  isDaily: !!row.daily_date,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  hasThumbnail: !!row.has_thumbnail,
});

const toFolder = (row: FolderRow) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  createdAt: row.created_at,
  noteCount: row.note_count,
});

const parseFolderName = (name: unknown) => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) {
    throw new HttpError(400, "folder name is required");
  }
  return trimmed;
};

/** validates the per-position defaults of a color picker (`null`: none) */
const parseColorDefaults = (defaults: unknown) => {
  if (!Array.isArray(defaults) || defaults.length > MAX_COLOR_TOP_PICKS) {
    throw new HttpError(
      400,
      `defaults must be an array of up to ${MAX_COLOR_TOP_PICKS} colors`,
    );
  }
  return defaults.map((color) => {
    if (color === null || color === "") {
      return null;
    }
    if (typeof color !== "string" || color.length > MAX_COLOR_LENGTH) {
      throw new HttpError(400, "invalid color");
    }
    return color;
  });
};

const decodeDataURL = (dataURL: string) => {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataURL);
  if (!match) {
    throw new HttpError(400, "invalid thumbnail");
  }
  return Buffer.from(match[3], match[2] ? "base64" : "utf8");
};

const readJSONBody = async (req: IncomingMessage) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_SIZE) {
      throw new HttpError(413, "payload too large");
    }
    chunks.push(chunk);
  }
  if (!size) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid JSON");
  }
};

const sendJSON = (res: ServerResponse, status: number, body: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export const createNotesApi = (dbFile: string) => {
  const db = openDatabase(dbFile);

  const SUMMARY_COLUMNS = `id, title, folder_id, daily_date, created_at, updated_at,
    thumbnail IS NOT NULL AS has_thumbnail`;

  const listNotes = db.prepare(
    `SELECT ${SUMMARY_COLUMNS} FROM notes ORDER BY updated_at DESC`,
  );
  const getNote = db.prepare(
    `SELECT ${SUMMARY_COLUMNS}, elements, app_state FROM notes WHERE id = ?`,
  );
  const getThumbnail = db.prepare(`SELECT thumbnail FROM notes WHERE id = ?`);
  const getFiles = db.prepare(
    `SELECT id, data FROM note_files WHERE note_id = ?`,
  );
  const getFileIds = db.prepare(`SELECT id FROM note_files WHERE note_id = ?`);
  const insertNote = db.prepare(
    `INSERT INTO notes (id, title, elements, app_state, thumbnail, folder_id,
       daily_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const moveNote = db.prepare(`UPDATE notes SET folder_id = ? WHERE id = ?`);
  const getDailyNoteId = db.prepare(
    `SELECT id FROM notes WHERE daily_date = ?`,
  );
  const upsertFile = db.prepare(
    `INSERT OR IGNORE INTO note_files (note_id, id, data) VALUES (?, ?, ?)`,
  );
  const deleteFile = db.prepare(
    `DELETE FROM note_files WHERE note_id = ? AND id = ?`,
  );
  const deleteNote = db.prepare(`DELETE FROM notes WHERE id = ?`);
  const listFolders = db.prepare(
    `SELECT f.id, f.name, f.kind, f.created_at, COUNT(n.id) AS note_count
     FROM folders f LEFT JOIN notes n ON n.folder_id = f.id
     GROUP BY f.id
     -- app-managed folders first, then alphabetically
     ORDER BY f.kind IS NULL, f.name COLLATE NOCASE`,
  );
  const getFolder = db.prepare(
    `SELECT f.id, f.name, f.kind, f.created_at,
       (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
     FROM folders f WHERE f.id = ?`,
  );
  const getFolderIdByKind = db.prepare(`SELECT id FROM folders WHERE kind = ?`);
  const insertFolder = db.prepare(
    `INSERT INTO folders (id, name, kind, created_at) VALUES (?, ?, ?, ?)`,
  );
  const renameFolder = db.prepare(`UPDATE folders SET name = ? WHERE id = ?`);
  const deleteFolder = db.prepare(`DELETE FROM folders WHERE id = ?`);
  const getLibrary = db.prepare(`SELECT data FROM library WHERE id = 1`);
  const saveLibrary = db.prepare(
    `INSERT INTO library (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data,
       updated_at = excluded.updated_at`,
  );

  const listColorDefaults = db.prepare(
    `SELECT slot, position, color FROM color_top_pick_defaults
     ORDER BY slot, position`,
  );
  const deleteColorDefaults = db.prepare(
    `DELETE FROM color_top_pick_defaults WHERE slot = ?`,
  );
  const insertColorDefault = db.prepare(
    `INSERT INTO color_top_pick_defaults (slot, position, color)
     VALUES (?, ?, ?)`,
  );

  const findNote = (id: string) => {
    const row = getNote.get(id) as NoteRow | undefined;
    if (!row) {
      throw new HttpError(404, "note not found");
    }
    return row;
  };

  const findFolder = (id: string) => {
    const row = getFolder.get(id) as FolderRow | undefined;
    if (!row) {
      throw new HttpError(404, "folder not found");
    }
    return row;
  };

  /**
   * validates a client-supplied folder id (`null`: no folder) for a note,
   * daily or not: the daily notes folder only accepts daily notes
   */
  const parseFolderId = (folderId: unknown, isDailyNote: boolean) => {
    if (folderId === null || folderId === undefined || folderId === "") {
      return null;
    }
    const folder =
      typeof folderId === "string"
        ? (getFolder.get(folderId) as FolderRow | undefined)
        : undefined;
    if (!folder) {
      throw new HttpError(400, "folder not found");
    }
    if (folder.kind === DAILY_FOLDER_KIND && !isDailyNote) {
      throw new HttpError(403, "only daily notes can be in this folder");
    }
    return folder.id;
  };

  const assertEditableFolder = (row: FolderRow) => {
    if (row.kind) {
      throw new HttpError(403, "this folder can't be renamed or deleted");
    }
  };

  const transaction = (fn: () => void) => {
    db.exec("BEGIN");
    try {
      fn();
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  };

  const loadNote = (id: string) => {
    const row = findNote(id);
    const files: Record<string, unknown> = {};
    for (const file of getFiles.all(id) as FileRow[]) {
      files[file.id] = JSON.parse(file.data);
    }
    return {
      ...toNoteSummary(row),
      elements: JSON.parse(row.elements),
      appState: JSON.parse(row.app_state),
      files,
    };
  };

  const createNote = (title: string, folderId: string | null) => {
    const id = randomUUID();
    const now = Date.now();
    insertNote.run(id, title, "[]", "{}", null, folderId, null, now, now);
    return toNoteSummary(findNote(id));
  };

  const createFolder = (name: string, kind: string | null = null) => {
    const id = randomUUID();
    insertFolder.run(id, name, kind, Date.now());
    return toFolder(findFolder(id));
  };

  /** per slot, the default color of each position (`null`: built-in) */
  const loadColorDefaults = () => {
    const defaults: Record<string, (string | null)[]> = {};
    for (const row of listColorDefaults.all() as {
      slot: string;
      position: number;
      color: string;
    }[]) {
      const slot = (defaults[row.slot] ??= []);
      while (slot.length < row.position) {
        slot.push(null);
      }
      slot[row.position] = row.color;
    }
    return defaults;
  };

  /** the note of the given day, created in the daily notes folder if needed */
  const getOrCreateDailyNote = (date: unknown, title: unknown) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpError(400, "date must be YYYY-MM-DD");
    }
    let noteId = (getDailyNoteId.get(date) as { id: string } | undefined)?.id;
    if (!noteId) {
      transaction(() => {
        const folderId =
          (
            getFolderIdByKind.get(DAILY_FOLDER_KIND) as
              | { id: string }
              | undefined
          )?.id ?? createFolder(DAILY_FOLDER_NAME, DAILY_FOLDER_KIND).id;
        noteId = randomUUID();
        const now = Date.now();
        insertNote.run(
          noteId,
          typeof title === "string" && title.trim() ? title.trim() : date,
          "[]",
          "{}",
          null,
          folderId,
          date,
          now,
          now,
        );
      });
    }
    return toNoteSummary(findNote(noteId!));
  };

  const duplicateNote = (sourceId: string) => {
    const source = findNote(sourceId);
    // a copy isn't a daily note, so it can't stay in the daily notes folder
    const folderId = source.daily_date ? null : source.folder_id;
    const id = randomUUID();
    const now = Date.now();
    transaction(() => {
      const thumbnail = getThumbnail.get(sourceId) as {
        thumbnail: Uint8Array | null;
      };
      insertNote.run(
        id,
        `${source.title || "Sem título"} (cópia)`,
        source.elements,
        source.app_state,
        thumbnail.thumbnail,
        folderId,
        null,
        now,
        now,
      );
      for (const file of getFiles.all(sourceId) as FileRow[]) {
        upsertFile.run(id, file.id, file.data);
      }
    });
    return toNoteSummary(findNote(id));
  };

  const updateNote = (id: string, update: NoteUpdate) => {
    const note = findNote(id);
    const folderId =
      update.folderId !== undefined
        ? parseFolderId(update.folderId, !!note.daily_date)
        : undefined;

    const assignments: string[] = [];
    const values: (string | number | Uint8Array | null)[] = [];
    const assign = (column: string, value: string | Uint8Array | null) => {
      assignments.push(`${column} = ?`);
      values.push(value);
    };

    if (typeof update.title === "string") {
      assign("title", update.title.trim());
    }
    if (Array.isArray(update.elements)) {
      assign("elements", JSON.stringify(update.elements));
    }
    if (update.appState && typeof update.appState === "object") {
      assign("app_state", JSON.stringify(update.appState));
    }
    if (update.thumbnail !== undefined) {
      assign(
        "thumbnail",
        update.thumbnail ? decodeDataURL(update.thumbnail) : null,
      );
    }

    transaction(() => {
      if (folderId !== undefined) {
        moveNote.run(folderId, id);
      }
      if (assignments.length) {
        db.prepare(
          `UPDATE notes SET ${assignments.join(", ")}, updated_at = ?
           WHERE id = ?`,
        ).run(...values, Date.now(), id);
      }

      for (const file of Object.values(update.files ?? {})) {
        upsertFile.run(id, file.id, JSON.stringify(file));
      }

      // drop images no longer referenced by any element (deleted elements
      // are kept in the scene for undo, so their images are kept too)
      if (Array.isArray(update.elements)) {
        const referenced = new Set(
          update.elements
            .map((element) => (element as { fileId?: string }).fileId)
            .filter(Boolean),
        );
        for (const { id: fileId } of getFileIds.all(id) as { id: string }[]) {
          if (!referenced.has(fileId)) {
            deleteFile.run(id, fileId);
          }
        }
      }
    });

    return toNoteSummary(findNote(id));
  };

  const routeLibrary = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === "GET") {
      const row = getLibrary.get() as { data: string } | undefined;
      return sendJSON(res, 200, row ? JSON.parse(row.data) : null);
    }
    if (req.method === "PUT") {
      const body = await readJSONBody(req);
      if (!Array.isArray(body.libraryItems)) {
        throw new HttpError(400, "libraryItems must be an array");
      }
      saveLibrary.run(JSON.stringify(body), Date.now());
      res.statusCode = 204;
      return res.end();
    }
    throw new HttpError(405, "method not allowed");
  };

  const routeColorDefaults = async (
    req: IncomingMessage,
    res: ServerResponse,
    slot: string | undefined,
  ) => {
    if (!slot && req.method === "GET") {
      return sendJSON(res, 200, loadColorDefaults());
    }
    if (slot && req.method === "PUT") {
      if (!COLOR_TOP_PICKS_SLOTS.has(slot)) {
        throw new HttpError(404, "unknown color picker");
      }
      const defaults = parseColorDefaults((await readJSONBody(req)).defaults);
      transaction(() => {
        deleteColorDefaults.run(slot);
        defaults.forEach((color, position) => {
          if (color) {
            insertColorDefault.run(slot, position, color);
          }
        });
      });
      return sendJSON(res, 200, loadColorDefaults());
    }
    throw new HttpError(405, "method not allowed");
  };

  const routeFolders = async (
    req: IncomingMessage,
    res: ServerResponse,
    id: string | undefined,
  ) => {
    const method = req.method ?? "GET";
    if (!id) {
      if (method === "GET") {
        return sendJSON(
          res,
          200,
          (listFolders.all() as FolderRow[]).map(toFolder),
        );
      }
      if (method === "POST") {
        const body = await readJSONBody(req);
        return sendJSON(res, 201, createFolder(parseFolderName(body.name)));
      }
    } else {
      const folder = findFolder(id);
      if (method === "PUT") {
        assertEditableFolder(folder);
        const body = await readJSONBody(req);
        renameFolder.run(parseFolderName(body.name), id);
        return sendJSON(res, 200, toFolder(findFolder(id)));
      }
      if (method === "DELETE") {
        assertEditableFolder(folder);
        // notes inside move back to the root (ON DELETE SET NULL)
        deleteFolder.run(id);
        res.statusCode = 204;
        return res.end();
      }
    }
    throw new HttpError(405, "method not allowed");
  };

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const [, , resource, id, action] = url.pathname.split("/");
    const method = req.method ?? "GET";

    if (resource === "library" && !id) {
      return routeLibrary(req, res);
    }
    if (resource === "color-defaults" && !action) {
      return routeColorDefaults(req, res, id);
    }
    if (resource === "folders" && !action) {
      return routeFolders(req, res, id);
    }
    if (resource !== "notes") {
      throw new HttpError(404, "not found");
    }

    if (id === "daily" && !action && method === "POST") {
      const body = await readJSONBody(req);
      return sendJSON(res, 200, getOrCreateDailyNote(body.date, body.title));
    }

    if (!id) {
      if (method === "GET") {
        return sendJSON(
          res,
          200,
          (listNotes.all() as NoteRow[]).map(toNoteSummary),
        );
      }
      if (method === "POST") {
        const body = await readJSONBody(req);
        return sendJSON(
          res,
          201,
          createNote(
            String(body.title ?? ""),
            parseFolderId(body.folderId, false),
          ),
        );
      }
    } else if (!action) {
      if (method === "GET") {
        return sendJSON(res, 200, loadNote(id));
      }
      if (method === "PUT") {
        return sendJSON(res, 200, updateNote(id, await readJSONBody(req)));
      }
      if (method === "DELETE") {
        findNote(id);
        deleteNote.run(id);
        res.statusCode = 204;
        return res.end();
      }
    } else if (action === "duplicate" && method === "POST") {
      return sendJSON(res, 201, duplicateNote(id));
    } else if (action === "thumbnail" && method === "GET") {
      const row = getThumbnail.get(id) as
        | { thumbnail: Uint8Array | null }
        | undefined;
      if (!row?.thumbnail) {
        throw new HttpError(404, "thumbnail not found");
      }
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache");
      return res.end(row.thumbnail);
    }

    throw new HttpError(405, "method not allowed");
  };

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (
      !/^\/api\/(notes|folders|library|color-defaults)(\/|\?|$)/.test(
        req.url ?? "",
      )
    ) {
      return next();
    }
    route(req, res).catch((error) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) {
        console.error("[notes-api]", error);
      }
      sendJSON(res, status, { error: error.message });
    });
  };
};
