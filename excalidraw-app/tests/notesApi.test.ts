import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { createNotesApi } from "../notes-server/notesApi.mts";

import type { AddressInfo } from "node:net";

describe("notes API: deleting several notes", () => {
  let dir: string;
  let server: http.Server;
  let baseURL: string;

  const request = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(`${baseURL}${url}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  };

  const createNote = async (title: string) =>
    (await request("POST", "/api/notes", { title })).body.id as string;

  const listTitles = async () =>
    ((await request("GET", "/api/notes")).body as { title: string }[])
      .map((note) => note.title)
      .sort();

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-api-"));
    const api = createNotesApi(path.join(dir, "notes.db"));
    server = http.createServer((req, res) =>
      api(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
    );
    await new Promise<void>((resolve) => server.listen(0, resolve));
    baseURL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes all the given notes", async () => {
    const a = await createNote("A");
    await createNote("B");
    const c = await createNote("C");

    const response = await request("DELETE", "/api/notes", { ids: [a, c, a] });

    expect(response).toEqual({ status: 200, body: { deleted: 2 } });
    expect(await listTitles()).toEqual(["B"]);
  });

  it("deletes none if one of the notes doesn't exist", async () => {
    const a = await createNote("A");
    await createNote("B");

    const response = await request("DELETE", "/api/notes", {
      ids: [a, "missing"],
    });

    expect(response.status).toBe(404);
    expect(await listTitles()).toEqual(["A", "B"]);
  });

  it("rejects a missing or empty list of ids", async () => {
    await createNote("A");

    expect((await request("DELETE", "/api/notes", { ids: [] })).status).toBe(
      400,
    );
    expect((await request("DELETE", "/api/notes", {})).status).toBe(400);
    expect(await listTitles()).toEqual(["A"]);
  });
});
