import {
  methodNotAllowed,
  readJSONBody,
  sendJSON,
  sendNoContent,
} from "./http.mts";

import type { RouteRequest } from "./http.mts";
import type { NotesService } from "../../application/notesService.mts";

/** `/api/notes`, `/api/notes/daily`, `/api/notes/:id[/duplicate|/thumbnail]` */
export const createNotesRoutes =
  (notes: NotesService) =>
  async ({ req, res, method, id, action }: RouteRequest) => {
    if (id === "search" && !action && method === "GET") {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      return sendJSON(res, 200, notes.search(query.get("q")));
    }
    if (id === "daily" && !action && method === "GET") {
      const query = new URL(req.url ?? "/", "http://localhost").searchParams;
      return sendJSON(res, 200, notes.findDaily(query.get("date")));
    }
    if (id === "daily" && !action && method === "POST") {
      const body = await readJSONBody(req);
      return sendJSON(res, 200, notes.getOrCreateDaily(body.date, body.title));
    }

    if (!id) {
      if (method === "GET") {
        return sendJSON(res, 200, notes.list());
      }
      if (method === "POST") {
        const body = await readJSONBody(req);
        return sendJSON(res, 201, notes.create(body.title, body.folderId));
      }
      if (method === "DELETE") {
        const body = await readJSONBody(req);
        return sendJSON(res, 200, notes.deleteMany(body.ids));
      }
    } else if (!action) {
      if (method === "GET") {
        return sendJSON(res, 200, notes.load(id));
      }
      if (method === "PUT") {
        return sendJSON(res, 200, notes.update(id, await readJSONBody(req)));
      }
      if (method === "DELETE") {
        notes.delete(id);
        return sendNoContent(res);
      }
    } else if (action === "duplicate" && method === "POST") {
      return sendJSON(res, 201, notes.duplicate(id));
    } else if (action === "thumbnail" && method === "PUT") {
      const body = await readJSONBody(req);
      return sendJSON(res, 200, notes.saveThumbnail(id, body));
    } else if (action === "thumbnail" && method === "GET") {
      const thumbnail = notes.findThumbnail(id);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "no-cache");
      return res.end(thumbnail);
    }

    throw methodNotAllowed();
  };
