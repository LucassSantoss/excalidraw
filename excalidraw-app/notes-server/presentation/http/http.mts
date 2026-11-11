import {
  ConflictError,
  DomainError,
  ForbiddenError,
  InvalidInputError,
  NotFoundError,
} from "../../domain/errors.mts";

import type { IncomingMessage, ServerResponse } from "node:http";

const MAX_BODY_SIZE = 200 * 1024 * 1024; // 200MB (scenes with images)

/** an error of the HTTP layer itself (unknown route, unreadable body…) */
// no TS parameter properties: this file runs in Node via type stripping
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** the HTTP status of an error thrown while handling a request */
export const getErrorStatus = (error: unknown) => {
  if (error instanceof HttpError) {
    return error.status;
  }
  if (error instanceof DomainError) {
    return error instanceof NotFoundError
      ? 404
      : error instanceof ForbiddenError
      ? 403
      : error instanceof InvalidInputError
      ? 400
      : error instanceof ConflictError
      ? 409
      : 500;
  }
  return 500;
};

export const readJSONBody = async (req: IncomingMessage) => {
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

export const sendJSON = (
  res: ServerResponse,
  status: number,
  body: unknown,
) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
};

export const sendNoContent = (res: ServerResponse) => {
  res.statusCode = 204;
  res.end();
};

export const methodNotAllowed = () => new HttpError(405, "method not allowed");

/** a request to a route: `/api/<resource>/<id>/<action>` */
export type RouteRequest = {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  id: string | undefined;
  action: string | undefined;
};
