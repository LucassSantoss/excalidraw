/**
 * The local notes API backed by SQLite: wires the layers together
 * (see `README.md` for the routes and the code layout).
 *
 * Exposes a connect-style middleware handling `/api/notes/*`, `/api/folders/*`,
 * `/api/library` and `/api/color-defaults/*`, used by the Vite dev server
 * (`vite.config.mts`), the standalone production server (`server.mts`) and
 * the macOS app (`desktop/`).
 */

import { createColorDefaultsService } from "./application/colorDefaultsService.mts";
import { createFoldersService } from "./application/foldersService.mts";
import { createLibraryService } from "./application/libraryService.mts";
import { createNotesService } from "./application/notesService.mts";
import { createColorDefaultsRepository } from "./infrastructure/sqlite/colorDefaultsRepository.mts";
import {
  createTransaction,
  openDatabase,
} from "./infrastructure/sqlite/database.mts";
import { createFoldersRepository } from "./infrastructure/sqlite/foldersRepository.mts";
import { createLibraryRepository } from "./infrastructure/sqlite/libraryRepository.mts";
import { createNotesRepository } from "./infrastructure/sqlite/notesRepository.mts";
import { createApiHandler } from "./presentation/http/apiHandler.mts";

export const createNotesApi = (dbFile: string) => {
  const db = openDatabase(dbFile);
  const transaction = createTransaction(db);

  const notes = createNotesRepository(db);
  const folders = createFoldersRepository(db);

  const foldersService = createFoldersService({ folders });
  return createApiHandler({
    notes: createNotesService({
      notes,
      folders,
      foldersService,
      transaction,
    }),
    folders: foldersService,
    library: createLibraryService({ library: createLibraryRepository(db) }),
    colorDefaults: createColorDefaultsService({
      colorDefaults: createColorDefaultsRepository(db),
      transaction,
    }),
  });
};
