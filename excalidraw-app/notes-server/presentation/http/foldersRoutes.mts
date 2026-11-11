import {
  methodNotAllowed,
  readJSONBody,
  sendJSON,
  sendNoContent,
} from "./http.mts";

import type { RouteRequest } from "./http.mts";
import type { FoldersService } from "../../application/foldersService.mts";

/** `/api/folders`, `/api/folders/:id` */
export const createFoldersRoutes =
  (folders: FoldersService) =>
  async ({ req, res, method, id }: RouteRequest) => {
    if (!id) {
      if (method === "GET") {
        return sendJSON(res, 200, folders.list());
      }
      if (method === "POST") {
        const body = await readJSONBody(req);
        return sendJSON(res, 201, folders.createFromInput(body.name));
      }
    } else {
      // an unknown folder is a 404 whatever the method
      folders.find(id);
      if (method === "PUT") {
        folders.assertEditable(id);
        const body = await readJSONBody(req);
        return sendJSON(res, 200, folders.rename(id, body.name));
      }
      if (method === "DELETE") {
        folders.delete(id);
        return sendNoContent(res);
      }
    }
    throw methodNotAllowed();
  };
