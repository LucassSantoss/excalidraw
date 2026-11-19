import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createStaticServer } from "../notes-server/presentation/http/staticServer.mts";

import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

let buildDir: string;
let server: Server;
let baseURL: string;

beforeEach(async () => {
  buildDir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-build-"));
  fs.writeFileSync(path.join(buildDir, "index.html"), "<!doctype html>app");
  fs.writeFileSync(path.join(buildDir, "app.js"), "console.log(1)");
  server = createStaticServer({ buildDir, api: (_req, _res, next) => next() });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(buildDir, { recursive: true, force: true });
});

describe("notes static server", () => {
  it("serves files, and index.html for unknown paths", async () => {
    const file = await fetch(`${baseURL}/app.js`);
    expect(file.headers.get("content-type")).toMatch("text/javascript");
    expect(await file.text()).toBe("console.log(1)");
    expect(await (await fetch(`${baseURL}/some/route`)).text()).toBe(
      "<!doctype html>app",
    );
  });

  // a thrown error here would take down the server and, with it, the macOS
  // app's main process
  it("answers malformed paths with 400 and keeps serving", async () => {
    expect((await fetch(`${baseURL}/%E0%A4%A`)).status).toBe(400);
    expect((await fetch(`${baseURL}/app.js`)).status).toBe(200);
  });
});
