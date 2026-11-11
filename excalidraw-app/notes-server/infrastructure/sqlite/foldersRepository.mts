import type { DatabaseSync } from "node:sqlite";

import type { FoldersRepository } from "../../application/ports.mts";
import type { Folder } from "../../domain/folders.mts";

type FolderRow = {
  id: string;
  name: string;
  kind: string | null;
  created_at: number;
  note_count: number;
};

const toFolder = (row: FolderRow): Folder => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  createdAt: row.created_at,
  noteCount: row.note_count,
});

export const createFoldersRepository = (
  db: DatabaseSync,
): FoldersRepository => {
  const list = db.prepare(
    `SELECT f.id, f.name, f.kind, f.created_at, COUNT(n.id) AS note_count
     FROM folders f LEFT JOIN notes n ON n.folder_id = f.id
     GROUP BY f.id
     -- app-managed folders first, then alphabetically
     ORDER BY f.kind IS NULL, f.name COLLATE NOCASE`,
  );
  const find = db.prepare(
    `SELECT f.id, f.name, f.kind, f.created_at,
       (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id) AS note_count
     FROM folders f WHERE f.id = ?`,
  );
  const findIdByKind = db.prepare(`SELECT id FROM folders WHERE kind = ?`);
  const insert = db.prepare(
    `INSERT INTO folders (id, name, kind, created_at) VALUES (?, ?, ?, ?)`,
  );
  const rename = db.prepare(`UPDATE folders SET name = ? WHERE id = ?`);
  // notes inside move back to the root (ON DELETE SET NULL)
  const deleteFolder = db.prepare(`DELETE FROM folders WHERE id = ?`);

  return {
    list: () => (list.all() as FolderRow[]).map(toFolder),
    find: (id) => {
      const row = find.get(id) as FolderRow | undefined;
      return row ? toFolder(row) : null;
    },
    findIdByKind: (kind) =>
      (findIdByKind.get(kind) as { id: string } | undefined)?.id ?? null,
    insert: ({ id, name, kind, now }) => {
      insert.run(id, name, kind, now);
    },
    rename: (id, name) => {
      rename.run(name, id);
    },
    delete: (id) => {
      deleteFolder.run(id);
    },
  };
};
