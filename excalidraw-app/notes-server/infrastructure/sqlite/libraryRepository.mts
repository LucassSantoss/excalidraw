import type { DatabaseSync } from "node:sqlite";

import type { LibraryRepository } from "../../application/ports.mts";

export const createLibraryRepository = (
  db: DatabaseSync,
): LibraryRepository => {
  const find = db.prepare(`SELECT data FROM library WHERE id = 1`);
  const save = db.prepare(
    `INSERT INTO library (id, data, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET data = excluded.data,
       updated_at = excluded.updated_at`,
  );

  return {
    find: () => {
      const row = find.get() as { data: string } | undefined;
      return row ? JSON.parse(row.data) : null;
    },
    save: (library, now) => {
      save.run(JSON.stringify(library), now);
    },
  };
};
