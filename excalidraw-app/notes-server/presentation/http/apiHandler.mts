import { createColorDefaultsRoutes } from "./colorDefaultsRoutes.mts";
import { createFoldersRoutes } from "./foldersRoutes.mts";
import { getErrorStatus, HttpError, sendJSON } from "./http.mts";
import { createLibraryRoutes } from "./libraryRoutes.mts";
import { createNotesRoutes } from "./notesRoutes.mts";

import type { RouteRequest } from "./http.mts";
import type { ColorDefaultsService } from "../../application/colorDefaultsService.mts";
import type { FoldersService } from "../../application/foldersService.mts";
import type { LibraryService } from "../../application/libraryService.mts";
import type { NotesService } from "../../application/notesService.mts";
import type { IncomingMessage, ServerResponse } from "node:http";

const API_PATH = /^\/api\/(notes|folders|library|color-defaults)(\/|\?|$)/;

/**
 * Connect-style middleware serving `/api/*`; other requests go to `next`.
 * Errors are sent as `{ error: message }` with their HTTP status.
 */
export const createApiHandler = (services: {
  notes: NotesService;
  folders: FoldersService;
  library: LibraryService;
  colorDefaults: ColorDefaultsService;
}) => {
  const notesRoutes = createNotesRoutes(services.notes);
  const foldersRoutes = createFoldersRoutes(services.folders);
  const libraryRoutes = createLibraryRoutes(services.library);
  const colorDefaultsRoutes = createColorDefaultsRoutes(services.colorDefaults);

  const route = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const [, , resource, id, action] = url.pathname.split("/");
    const request: RouteRequest = {
      req,
      res,
      method: req.method ?? "GET",
      id,
      action,
    };

    if (resource === "library" && !id) {
      return libraryRoutes(request);
    }
    if (resource === "color-defaults" && !action) {
      return colorDefaultsRoutes(request);
    }
    if (resource === "folders" && !action) {
      return foldersRoutes(request);
    }
    if (resource === "notes") {
      return notesRoutes(request);
    }
    throw new HttpError(404, "not found");
  };

  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (!API_PATH.test(req.url ?? "")) {
      return next();
    }
    route(req, res).catch((error) => {
      const status = getErrorStatus(error);
      if (status === 500) {
        console.error("[notes-api]", error);
      }
      sendJSON(res, status, { error: error.message });
    });
  };
};
