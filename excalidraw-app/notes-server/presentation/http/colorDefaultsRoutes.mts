import { methodNotAllowed, readJSONBody, sendJSON } from "./http.mts";

import type { RouteRequest } from "./http.mts";
import type { ColorDefaultsService } from "../../application/colorDefaultsService.mts";

/** `/api/color-defaults`, `/api/color-defaults/:slot` */
export const createColorDefaultsRoutes =
  (colorDefaults: ColorDefaultsService) =>
  async ({ req, res, method, id: slot }: RouteRequest) => {
    if (!slot && method === "GET") {
      return sendJSON(res, 200, colorDefaults.list());
    }
    if (slot && method === "PUT") {
      // an unknown slot is a 404 before the body is even read
      colorDefaults.assertSlot(slot);
      const body = await readJSONBody(req);
      return sendJSON(res, 200, colorDefaults.replace(slot, body.defaults));
    }
    throw methodNotAllowed();
  };
