/**
 * HTTP server for the notes app: serves a production build of the web app
 * plus the SQLite-backed API. Shared by `server.mts` (`yarn start:notes`) and
 * the macOS app (`desktop/`).
 */

import { createNotesApi } from "./notesApi.mts";
import {
  assertBuildExists,
  createStaticServer,
} from "./presentation/http/staticServer.mts";

export const createNotesServer = ({
  buildDir,
  dbFile,
}: {
  buildDir: string;
  dbFile: string;
}) => {
  // before opening the database, which would create its file
  assertBuildExists(buildDir);
  return createStaticServer({ buildDir, api: createNotesApi(dbFile) });
};
