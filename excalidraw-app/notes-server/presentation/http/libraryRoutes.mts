import {
  methodNotAllowed,
  readJSONBody,
  sendJSON,
  sendNoContent,
} from "./http.mts";

import type { RouteRequest } from "./http.mts";
import type { LibraryService } from "../../application/libraryService.mts";

/** `/api/library` */
export const createLibraryRoutes =
  (library: LibraryService) =>
  async ({ req, res, method }: RouteRequest) => {
    if (method === "GET") {
      return sendJSON(res, 200, library.load());
    }
    if (method === "PUT") {
      library.save(await readJSONBody(req));
      return sendNoContent(res);
    }
    throw methodNotAllowed();
  };
