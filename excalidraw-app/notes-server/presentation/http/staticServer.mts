import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

type Middleware = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  next: () => void,
) => void;

export const assertBuildExists = (buildDir: string) => {
  if (!fs.existsSync(path.join(buildDir, "index.html"))) {
    throw new Error(
      `Build not found in ${buildDir}. Run \`yarn build:app:docker\` first.`,
    );
  }
};

/**
 * HTTP server serving a production build of the web app (a single-page app:
 * unknown paths get `index.html`), with `api` handling the requests it wants
 */
export const createStaticServer = ({
  buildDir,
  api,
}: {
  buildDir: string;
  api: Middleware;
}) => {
  const serveStatic = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    let decodedPathname: string;
    try {
      decodedPathname = decodeURIComponent(pathname);
    } catch {
      // malformed escapes (e.g. `%E0`): thrown here, it would take the
      // whole server (and the macOS app) down
      res.statusCode = 400;
      return res.end();
    }
    let filePath = path.join(buildDir, decodedPathname);
    if (!filePath.startsWith(buildDir)) {
      res.statusCode = 403;
      return res.end();
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA fallback
      filePath = path.join(buildDir, "index.html");
    }
    res.setHeader(
      "Content-Type",
      MIME_TYPES[path.extname(filePath)] ?? "application/octet-stream",
    );
    fs.createReadStream(filePath)
      // an unhandled stream error would crash the process
      .on("error", () => {
        if (!res.headersSent) {
          res.statusCode = 500;
        }
        res.end();
      })
      .pipe(res);
  };

  return http.createServer((req, res) =>
    api(req, res, () => serveStatic(req, res)),
  );
};
